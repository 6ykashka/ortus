package pool

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noticeDecided is the kind of the notification of the requesting logists (the event type without its version).
const noticeDecided = "fleet.driver_transfer.decided"

// Decide approves, rejects, revokes or extends a transfer (decideDriverTransfer, AUTH-07). Its trip and the transfer
// are locked first: two decisions of one request queue, the second sees the first (412 by its ETag or 409). endsAt
// without extend or extend without endsAt — 422 before the rest; invisible — 404; visible without approve over the
// releasing company — 403; If-Match of the settled revision; approve and reject need an open request, revoke and
// extend an approved transfer (else 409 «Запрос уже рассмотрен.»). An approval takes an advisory lock of the driver
// (approvals of one driver never overlap), rechecks the trip and the schedule of the driver and gives him the temporary
// assignment of the role «Временный водитель» (Q-W2.07-1); the decision is notified to the logists of the requesting
// company.
func (s *Service) Decide(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.DriverTransferDecision) (fleetapi.DriverTransfer, error) {
	switch b.Decision {
	case fleetapi.DriverTransferDecisionDecisionApprove, fleetapi.DriverTransferDecisionDecisionReject,
		fleetapi.DriverTransferDecisionDecisionRevoke, fleetapi.DriverTransferDecisionDecisionExtend,
		fleetapi.DriverTransferDecisionDecisionApproveDriverOnly:
	default:
		return fleetapi.DriverTransfer{}, problem.New(problem.CodeMalformedRequest, "")
	}
	if b.Comment != nil && utf8.RuneCountInString(*b.Comment) > maxComment {
		return fleetapi.DriverTransfer{}, kit.Invalid(textLimit)
	}
	if (b.EndsAt != nil) != (b.Decision == fleetapi.DriverTransferDecisionDecisionExtend) {
		return fleetapi.DriverTransfer{}, invalid(textWindow, violationExtend)
	}
	// W2.72 (S2-20, 1b; Q-W2.70-8, Q-W2.71-1): «Отклонить» — only with the reason in comment, before the other checks.
	if b.Decision == fleetapi.DriverTransferDecisionDecisionReject && (b.Comment == nil || strings.TrimSpace(*b.Comment) == "") {
		return fleetapi.DriverTransfer{}, invalid(textRejectReason, violationReason)
	}
	var out fleetapi.DriverTransfer
	err := s.run(ctx, tc, func(c *cmd) error {
		var err error
		out, err = c.decide(ctx, id, ifMatch, b)
		return err
	})
	return out, err
}

func (c *cmd) decide(ctx context.Context, id uuid.UUID, ifMatch string, b fleetapi.DriverTransferDecision) (fleetapi.DriverTransfer, error) {
	x, err := c.decidable(ctx, id, ifMatch, b.Decision)
	if err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	if b.Decision == fleetapi.DriverTransferDecisionDecisionApproveDriverOnly && !x.usualAsked() {
		return fleetapi.DriverTransfer{}, invalid(textCheckDecision, violationDriverOnly)
	}
	comment := b.Comment
	if comment != nil && *comment == "" {
		comment = nil
	}
	diff := map[string]any{"decision": string(b.Decision), keyPublication: x.publication, keySource: x.source,
		keyTarget: x.target}
	if err := c.apply(ctx, x, b, comment, diff); err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	ev, err := c.record(ctx, "fleet.driver_transfer.decide", eventDecided, targetTransfer, x.id, x.source, diff)
	if err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	if x, err = loadTransfer(ctx, c.tx, x.id, ""); err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	if err := attachParts(ctx, c.tx, []*transfer{&x}, c.now); err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	if err := c.announce(ctx, x, b.Decision, ev); err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	out := x.dto(c.now)
	return out, kit.Complete(ctx, c.tx, http.StatusOK, kit.ETag(out.Revision), out)
}

// apply writes decision b on the decidable transfer x; diff takes what the audit row and the event of the decision
// carry besides the decision.
func (c *cmd) apply(ctx context.Context, x transfer, b fleetapi.DriverTransferDecision, comment *string, diff map[string]any) error {
	switch b.Decision {
	case fleetapi.DriverTransferDecisionDecisionApprove, fleetapi.DriverTransferDecisionDecisionApproveDriverOnly:
		return c.approve(ctx, x, comment, b.Decision)
	case fleetapi.DriverTransferDecisionDecisionReject:
		_, err := c.tx.Exec(ctx, `update fleet.driver_transfers set state = 'rejected', decided_by = $2, decided_at = $3,
			decision_comment = $4, revision = revision + 1 where id = $1`, x.id, c.tc.PersonID, c.now, comment)
		return err
	case fleetapi.DriverTransferDecisionDecisionRevoke:
		return c.revoke(ctx, x)
	case fleetapi.DriverTransferDecisionDecisionExtend:
		until := b.EndsAt.UTC()
		diff[keyEndsAt], diff["previousEndsAt"] = until, x.period.End
		if comment != nil {
			diff["comment"] = *comment
		}
		return c.extend(ctx, x, until)
	}
	return problem.New(problem.CodeMalformedRequest, "")
}

// announce publishes what decision d of x tells beyond its event (event): fleet.transfer.approved.v1 or .revoked.v1 of
// the temporary assignment, the notification of the requesting logists about an approval or a rejection.
func (c *cmd) announce(ctx context.Context, x transfer, d fleetapi.DriverTransferDecisionDecision, event uuid.UUID) error {
	switch d {
	case fleetapi.DriverTransferDecisionDecisionApprove, fleetapi.DriverTransferDecisionDecisionApproveDriverOnly:
		if err := publishTransfer(ctx, c.tx, eventApproved, x, nil); err != nil {
			return err
		}
	case fleetapi.DriverTransferDecisionDecisionRevoke:
		return publishTransfer(ctx, c.tx, eventRevoked, x, map[string]any{"revokedAt": c.now})
	case fleetapi.DriverTransferDecisionDecisionReject:
	case fleetapi.DriverTransferDecisionDecisionExtend:
		return nil
	}
	return c.notifyDecided(ctx, x, d, event)
}

// decidable locks transfer id and checks that the subject may take decision d on it now: invisible — 404; without
// approve over the releasing company — 403; If-Match of the settled revision; the settled status — requested for
// approve and reject, approved for revoke (else 409). The trip of the transfer is locked before it — the lock order
// of the module (SettleTripTx): trip, then transfer.
func (c *cmd) decidable(ctx context.Context, id uuid.UUID, ifMatch string, d fleetapi.DriverTransferDecisionDecision) (transfer, error) {
	x, err := c.visible(ctx, id, "")
	if err != nil {
		return transfer{}, err
	}
	if x.trip != nil {
		if _, err := c.tx.Exec(ctx, `select id from fleet.trips where id = $1 for update`, *x.trip); err != nil {
			return transfer{}, err
		}
	}
	if x, err = loadTransfer(ctx, c.tx, id, " for update of x"); err != nil {
		return transfer{}, err
	}
	if err := c.ev.Permit(ctx, c.tc, actionApprove, authz.Resource{Unit: x.source}); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return transfer{}, problem.New(problem.CodeForbiddenAction, "")
		}
		return transfer{}, err
	}
	st := Settle(x.input(), c.now)
	if err := kit.CheckRevision(ifMatch, st.Revision); err != nil {
		return transfer{}, err
	}
	want := StatusRequested
	if d == fleetapi.DriverTransferDecisionDecisionRevoke || d == fleetapi.DriverTransferDecisionDecisionExtend {
		want = StatusApproved
	}
	if st.Status != want {
		return transfer{}, kit.Conflict(textDecided)
	}
	return x, nil
}

// approve gives the driver of x the temporary assignment: under an advisory lock of the person (approvals of one
// driver are serialized — no exclusion constraint can see the person of a transfer), the trip locked and rechecked
// (another driver — 409, started or closed — 409), the driver free of other approved transfers and of the trips of
// other companies in the window (409 resources_unavailable). The assignment is the system role «Временный водитель»
// in scope self (Q-W2.07-1 «только рейс»: the trips the driver drives, their inspections, expenses, reservations and
// files), valid for the window, source transfer; the trip gets the driver, its vehicle — the second row of the role in
// scope resource (settleVehicle); policy_version is raised for him (W1.07).
func (c *cmd) approve(ctx context.Context, x transfer, comment *string, d fleetapi.DriverTransferDecisionDecision) error {
	if err := LockDriver(ctx, c.tx, x.person); err != nil {
		return err
	}
	if x.trip != nil {
		if err := c.approveTrip(ctx, *x.trip, x.person); err != nil {
			return err
		}
	}
	if err := c.driverFree(ctx, x); err != nil {
		return err
	}
	role, version, err := c.temporaryRole(ctx)
	if err != nil {
		return err
	}
	// W2.72 (S2-20, Q-W2.71-3): a request with a vehicle opens the grant at the approval — before the window the driver
	// reads his trip and chooses (the overlay narrows the trip to its preparation, AccessPrepare).
	from := x.period.Start
	if x.mode != nil && c.now.Before(from) {
		from = c.now
	}
	var assignment uuid.UUID
	if err := c.tx.QueryRow(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, include_descendants, valid, source, granted_by, reason, created_at)
		values ('person', $1, $2, $3, 'self', false, tstzrange($4, $5, '[)'), $6, $7, $8, $9) returning id`,
		x.person, role, version, from, x.period.End, sourceTransfer, c.tc.PersonID,
		"Пул водителей: запрос "+x.id.String(), c.now).Scan(&assignment); err != nil {
		return fmt.Errorf("pool: grant: %w", err)
	}
	if _, err := c.tx.Exec(ctx, `update fleet.driver_transfers set state = 'approved', decided_by = $2, decided_at = $3,
		decision_comment = $4, assignment_id = $5, revision = revision + 1 where id = $1`,
		x.id, c.tc.PersonID, c.now, comment, assignment); err != nil {
		return fmt.Errorf("pool: approve: %w", err)
	}
	if x.trip != nil {
		if _, err := c.tx.Exec(ctx, `update fleet.trips set driver_person_id = $2, revision = revision + 1 where id = $1`,
			*x.trip, x.person); err != nil {
			return fmt.Errorf("pool: driver of the trip: %w", err)
		}
	}
	x.decidedBy = &c.tc.PersonID
	if err := c.offer(ctx, x, d, role, version); err != nil {
		return err
	}
	return c.resettle(ctx, x.id, x.person, "fleet.driver_transfer.approve")
}

// resettle applies the settlement of transfer id at the moment of the command after its writes (the grant of the
// vehicle of the trip, the bounds of the grant) and raises policy_version for the driver person (W1.07).
func (c *cmd) resettle(ctx context.Context, id, person uuid.UUID, reason string) error {
	x, err := loadTransfer(ctx, c.tx, id, "")
	if err != nil {
		return err
	}
	if _, err := settleOne(ctx, c.tx, x, Settle(x.input(), c.now), c.now, &Result{}); err != nil {
		return err
	}
	_, err = realtime.BumpPolicy(ctx, c.tx, c.tc.TenantID, []uuid.UUID{person}, reason)
	return err
}

// temporaryRole returns the live system role «Временный водитель» of the tenant and its version with the actions of
// the template (TemporaryDriverActions), creating the role when there is none and a version when the template changed
// since (templateVersion). Two approvals that create it at once queue on the unique name of the roles: the second
// takes the role of the first. A role of the tenant with the same name (not the system one) — 409 with the canonical
// text of the code.
func (c *cmd) temporaryRole(ctx context.Context) (uuid.UUID, int, error) {
	id, version, err := c.temporaryRoleRow(ctx)
	if err != nil {
		return uuid.Nil, 0, err
	}
	version, err = c.templateVersion(ctx, id, version)
	return id, version, err
}

// sameActionsSQL reports whether version $2 of role $1 carries exactly the actions $3 (the order does not matter).
const sameActionsSQL = `select coalesce((select array(select unnest(v.actions) order by 1) =
	array(select unnest($3::text[]) order by 1) from access.role_versions v where v.role_id = $1 and v.version = $2), false)`

// templateVersion returns the version of the system role id (current: version) that carries the actions of the
// template: the current one, or a new one when the template changed after the role was created (Q-W2.57-7). The role
// row is locked before a version is added: two approvals add one version, the second sees it.
func (c *cmd) templateVersion(ctx context.Context, id uuid.UUID, version int) (int, error) {
	same := func(v int) (bool, error) {
		var ok bool
		err := c.tx.QueryRow(ctx, sameActionsSQL, id, v, TemporaryDriverActions).Scan(&ok)
		return ok, err
	}
	if ok, err := same(version); err != nil || ok {
		return version, err
	}
	if err := c.tx.QueryRow(ctx, `select current_version from access.roles where id = $1 for update`, id).Scan(&version); err != nil {
		return 0, fmt.Errorf("pool: lock role: %w", err)
	}
	if ok, err := same(version); err != nil || ok {
		return version, err
	}
	next := version + 1
	if _, err := c.tx.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, $2, $3, $4)`,
		id, next, TemporaryDriverActions, c.tc.PersonID); err != nil {
		return 0, fmt.Errorf("pool: role version: %w", err)
	}
	if _, err := c.tx.Exec(ctx, `update access.roles set current_version = $2 where id = $1`, id, next); err != nil {
		return 0, fmt.Errorf("pool: role version: %w", err)
	}
	return next, nil
}

// temporaryRoleRow returns the live system role «Временный водитель» of the tenant and its current version, creating
// it at version 1 with the actions of the template when there is none.
func (c *cmd) temporaryRoleRow(ctx context.Context) (uuid.UUID, int, error) {
	find := func() (uuid.UUID, int, bool, error) {
		var (
			id      uuid.UUID
			version int
		)
		err := c.tx.QueryRow(ctx, `select r.id, r.current_version from access.roles r
			  join access.role_versions v on v.role_id = r.id and v.version = r.current_version
			 where r.template_key = $1 and r.kind = 'system' and r.archived_at is null order by r.created_at, r.id limit 1`,
			templateTemporaryDriver).Scan(&id, &version)
		if errNoRows(err) {
			return uuid.Nil, 0, false, nil
		}
		return id, version, err == nil, err
	}
	if id, version, ok, err := find(); err != nil || ok {
		return id, version, err
	}
	var id uuid.UUID
	err := c.tx.QueryRow(ctx, `insert into access.roles (name, kind, template_key) values ($1, 'system', $2)
		on conflict do nothing returning id`, nameTemporaryDriver, templateTemporaryDriver).Scan(&id)
	if errNoRows(err) {
		if id, version, ok, err := find(); err != nil || ok {
			return id, version, err
		}
		return uuid.Nil, 0, kit.Conflict(textNoRole)
	}
	if err != nil {
		return uuid.Nil, 0, fmt.Errorf("pool: role: %w", err)
	}
	if _, err := c.tx.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		id, TemporaryDriverActions, c.tc.PersonID); err != nil {
		return uuid.Nil, 0, fmt.Errorf("pool: role version: %w", err)
	}
	return id, 1, nil
}

// LockDriver takes the transaction-scoped advisory lock of the pool on person in tx. An approval holds it while it
// rechecks the schedule of the driver and writes his assignment; a command that puts a driver on a trip (W2.05) takes
// it before its own check, so the two never interleave between a check and a write.
func LockDriver(ctx context.Context, tx pgx.Tx, person uuid.UUID) error {
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, "fleet.pool.driver:"+person.String()); err != nil {
		return fmt.Errorf("pool: lock driver %s: %w", person, err)
	}
	return nil
}

// approveTrip locks and rechecks the trip of an approval (Q-W2.51-12): another driver — 409 «У рейса уже есть
// водитель.»; started, accepted or cancelled — 409 «Рейс уже начат или закрыт.».
func (c *cmd) approveTrip(ctx context.Context, id, person uuid.UUID) error {
	var (
		state  string
		driver *uuid.UUID
	)
	if err := c.tx.QueryRow(ctx, `select state, driver_person_id from fleet.trips where id = $1 for update`, id).
		Scan(&state, &driver); err != nil {
		return err
	}
	switch {
	case driver != nil && *driver != person:
		return kit.Conflict(textTripDriver)
	case state != tripPlanned && state != tripAssigned:
		return kit.Conflict(textTripStarted)
	}
	return nil
}

// driverFree requires the driver of x without another approved transfer and without another open trip in its window
// («Free status is advisory; transfer approval rechecks scheduling»).
func (c *cmd) driverFree(ctx context.Context, x transfer) error {
	var busy bool
	err := c.tx.QueryRow(ctx, `select exists (select 1 from fleet.driver_transfers o
		  join fleet.pool_publications p on p.id = o.publication_id
		 where p.person_id = $1 and o.id <> $2 and o.state = 'approved' and o.period && tstzrange($3, $4, '[)'))
		 or exists (select 1 from fleet.trips t where t.driver_person_id = $1 and t.id is distinct from $5
		 and t.state not in ('accepted', 'cancelled') and t.planned && tstzrange($3, $4, '[)'))`,
		x.person, x.id, x.period.Start, x.period.End, x.trip).Scan(&busy)
	if err != nil {
		return err
	}
	if busy {
		return problem.New(codeUnavailable, textDriverBusy)
	}
	return nil
}

// revoke ends the temporary assignment of x now (AC-06: the driver gets 404 for the trip at once): the assignment is
// revoked with its validity closed at now, the transfer keeps its approver and stores who revoked it, a trip the driver
// did not start loses him. A started trip (D09, 08-domain-scenarios §4.6 п. 8) keeps only its continuation: the
// assignment stays open until the trip is accepted or cancelled, the driver stays on it. The vehicle of the trip closes
// at once either way (resettle).
func (c *cmd) revoke(ctx context.Context, x transfer) error {
	started := x.input().started()
	if x.assignment != nil {
		var err error
		if started {
			_, err = c.tx.Exec(ctx, `update access.role_assignments set valid = tstzrange(lower(valid), null, '[)')
				 where id = $1 and state = 'active' and not isempty(valid)`, *x.assignment)
		} else {
			_, err = c.tx.Exec(ctx, `update access.role_assignments set state = 'revoked', revoked_at = $2,
				valid = tstzrange(lower(valid), greatest(lower(valid), $2), '[)') where id = $1`, *x.assignment, c.now)
		}
		if err != nil {
			return fmt.Errorf("pool: revoke grant: %w", err)
		}
	}
	if _, err := c.tx.Exec(ctx, `update fleet.driver_transfers set state = 'revoked', revoked_by = $2, completed_at = $3,
		revision = revision + 1 where id = $1`, x.id, c.tc.PersonID, c.now); err != nil {
		return fmt.Errorf("pool: revoke: %w", err)
	}
	if x.trip != nil && !started {
		if _, err := unassign(ctx, c.tx, *x.trip, x.person); err != nil {
			return err
		}
	}
	// W2.72 (S2-20): the offer of a trip not started is released (transfer_ended); the offered vehicles close at once.
	if !started {
		if _, err := endOffer(ctx, c.tx, x, c.now); err != nil {
			return err
		}
	} else if _, err := closeOfferGrants(ctx, c.tx, x.person, []uuid.UUID{x.id}, nil, c.now); err != nil {
		return err
	}
	return c.resettle(ctx, x.id, x.person, "fleet.driver_transfer.revoke")
}

// extend moves the end of the window of the approved transfer x to until (decision extend, 08-domain-scenarios §4.6
// п. 7): later than the current end and than now and inside the free window of its publication (Extension, 422);
// under the advisory lock of the driver his schedule is rechecked for the new window (409 resources_unavailable). The
// grant and the grant of the vehicle of the trip follow the new end (resettle): a closing transfer is active again.
func (c *cmd) extend(ctx context.Context, x transfer, until time.Time) error {
	var free Window
	if err := c.tx.QueryRow(ctx, `select lower(available), upper(available) from fleet.pool_publications where id = $1`,
		x.publication).Scan(&free.Start, &free.End); err != nil {
		return fmt.Errorf("pool: publication of %s: %w", x.id, err)
	}
	w, err := Extension(x.period, free, until, c.now)
	if err != nil {
		return err
	}
	if err := LockDriver(ctx, c.tx, x.person); err != nil {
		return err
	}
	longer := x
	longer.period = w
	if err := c.driverFree(ctx, longer); err != nil {
		return err
	}
	if _, err := c.tx.Exec(ctx, `update fleet.driver_transfers set period = tstzrange($2, $3, '[)'), revision = revision + 1
		 where id = $1`, x.id, w.Start, w.End); err != nil {
		return fmt.Errorf("pool: extend: %w", err)
	}
	return c.resettle(ctx, x.id, x.person, "fleet.driver_transfer.extend")
}

// unassign takes the temporary driver off trip if he has not started it.
func unassign(ctx context.Context, tx pgx.Tx, trip, person uuid.UUID) (bool, error) {
	tag, err := tx.Exec(ctx, `update fleet.trips set driver_person_id = null, revision = revision + 1
		 where id = $1 and driver_person_id = $2 and state in ('planned', 'assigned')`, trip, person)
	if err != nil {
		return false, fmt.Errorf("pool: unassign: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// candidatesSQL lists the live people who may receive the decision: the holders of $2 at $1 in an active assignment of
// a live role (directly or through a group — the grants the evaluator reads, authz.PGSource) and the people of $3 (the
// owners). Enqueue checks each of them over the requesting company.
const candidatesSQL = `select p.id from people.person_profiles p
 where p.archived_at is null and (p.id = any($3::uuid[]) or exists (
   select 1 from access.role_assignments ra
     join access.roles r on r.id = ra.role_id and r.archived_at is null
     join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
    where ra.state = 'active' and ra.valid @> $1::timestamptz and $2 = any(rv.actions)
      and ((ra.principal_kind = 'person' and ra.principal_id = p.id)
        or (ra.principal_kind = 'group'
            and ra.principal_id in (select group_id from access.group_members where person_id = p.id)))))
 order by p.id`

// candidates returns the people notifyDecided resolves through the control DB: the holders of
// fleet.driver_transfers.request now and the owners of the tenant — not every person of the tenant.
func (c *cmd) candidates(ctx context.Context) ([]uuid.UUID, error) {
	return c.holders(ctx, actionRequest)
}

// holders returns the holders of action now and the owners of the tenant: the people a notification of the module is
// resolved for (Enqueue checks each of them over the unit of the notice).
func (c *cmd) holders(ctx context.Context, action string) ([]uuid.UUID, error) {
	owners := []uuid.UUID{}
	if c.s.Owners != nil {
		list, err := c.s.Owners.Owners(ctx, c.tc.TenantID)
		if err != nil {
			return nil, err
		}
		owners = append(owners, list...)
	}
	rows, err := c.tx.Query(ctx, candidatesSQL, c.now, action, owners)
	if err != nil {
		return nil, fmt.Errorf("pool: recipients: %w", err)
	}
	people, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("pool: recipients: %w", err)
	}
	return people, nil
}

// notifyDecided tells the logists of the requesting company (fleet.driver_transfers.request over it now, checked when
// enqueued, W1.10) and the owners that the releasing company decided: «Запрос водителя Водитель #104 одобрен фирмой
// Юг Транс».
func (c *cmd) notifyDecided(ctx context.Context, x transfer, d fleetapi.DriverTransferDecisionDecision, event uuid.UUID) error {
	s := c.s
	if s.Recipients == nil || s.Audience == nil {
		return nil
	}
	verb := "отклонён"
	if d == fleetapi.DriverTransferDecisionDecisionApprove || d == fleetapi.DriverTransferDecisionDecisionApproveDriverOnly {
		verb = "одобрен"
	}
	audience := s.Audience
	if _, ok := audience.(inbox.AuthzAudience); ok {
		audience = inbox.AuthzAudience{E: c.ev}
	}
	people, err := c.candidates(ctx)
	if err != nil {
		return err
	}
	n := inbox.Notice{
		Kind: noticeDecided, Severity: inbox.SeverityInfo,
		Title:  "Запрос водителя " + x.label + " " + verb + " фирмой " + x.sourceName,
		Object: &inbox.Object{ModuleKey: "fleet", EntityType: "driver_transfer", EntityID: x.id},
		Unit:   x.target, Permission: actionRequest, SourceEvent: event,
	}
	for _, p := range people {
		to, err := s.Recipients.Recipient(ctx, c.tc.TenantID, p)
		if errors.Is(err, inbox.ErrNoRecipient) {
			continue
		}
		if err != nil {
			return fmt.Errorf("pool: recipient: %w", err)
		}
		if _, _, err := inbox.Enqueue(ctx, c.tx, audience, to, n); err != nil {
			return fmt.Errorf("pool: notify: %w", err)
		}
	}
	return nil
}
