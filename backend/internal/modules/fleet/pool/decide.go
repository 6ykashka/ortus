package pool

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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

// Decide approves, rejects or revokes a transfer (decideDriverTransfer, AUTH-07). Its trip and the transfer are
// locked first: two decisions of one request queue, the second sees the first (412 by its ETag or 409). Invisible — 404; visible
// without approve over the releasing company — 403; If-Match of the settled revision; approve and reject need an open
// request, revoke an approved transfer (else 409 «Запрос уже рассмотрен.»). An approval takes an advisory lock of the
// driver (approvals of one driver never overlap), rechecks the trip and the schedule of the driver and gives him the
// temporary assignment; the decision is notified to the logists of the requesting company.
func (s *Service) Decide(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.DriverTransferDecision) (fleetapi.DriverTransfer, error) {
	switch b.Decision {
	case fleetapi.DriverTransferDecisionDecisionApprove, fleetapi.DriverTransferDecisionDecisionReject,
		fleetapi.DriverTransferDecisionDecisionRevoke:
	default:
		return fleetapi.DriverTransfer{}, problem.New(problem.CodeMalformedRequest, "")
	}
	if b.Comment != nil && utf8.RuneCountInString(*b.Comment) > maxComment {
		return fleetapi.DriverTransfer{}, kit.Invalid(textLimit)
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
	comment := b.Comment
	if comment != nil && *comment == "" {
		comment = nil
	}
	switch b.Decision {
	case fleetapi.DriverTransferDecisionDecisionApprove:
		err = c.approve(ctx, x, comment)
	case fleetapi.DriverTransferDecisionDecisionReject:
		_, err = c.tx.Exec(ctx, `update fleet.driver_transfers set state = 'rejected', decided_by = $2, decided_at = $3,
			decision_comment = $4, revision = revision + 1 where id = $1`, x.id, c.tc.PersonID, c.now, comment)
	case fleetapi.DriverTransferDecisionDecisionRevoke:
		err = c.revoke(ctx, x)
	}
	if err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	diff := map[string]any{"decision": string(b.Decision), "publicationId": x.publication, "sourceOrgUnitId": x.source,
		"targetOrgUnitId": x.target}
	ev, err := c.record(ctx, "fleet.driver_transfer.decide", eventDecided, targetTransfer, x.id, x.source, diff)
	if err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	if x, err = loadTransfer(ctx, c.tx, x.id, ""); err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	if b.Decision != fleetapi.DriverTransferDecisionDecisionRevoke {
		if err := c.notifyDecided(ctx, x, b.Decision, ev); err != nil {
			return fleetapi.DriverTransfer{}, err
		}
	}
	out := x.dto(c.now)
	return out, kit.Complete(ctx, c.tx, http.StatusOK, kit.ETag(out.Revision), out)
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
	if d == fleetapi.DriverTransferDecisionDecisionRevoke {
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
// other companies in the window (409 resources_unavailable). The assignment is the role «Водитель» over the unit of the
// trip (without a trip — the requesting company), never its subtree (Q-W2.07-1: no scope kind «trip» in the registry,
// the trips of the unit the driver does not drive stay closed by D22), valid for the window, source transfer; the trip
// gets the driver; policy_version is raised for him (W1.07).
func (c *cmd) approve(ctx context.Context, x transfer, comment *string) error {
	if err := LockDriver(ctx, c.tx, x.person); err != nil {
		return err
	}
	scope := x.target
	if x.trip != nil {
		unit, err := c.approveTrip(ctx, *x.trip, x.person)
		if err != nil {
			return err
		}
		scope = unit
	}
	if err := c.driverFree(ctx, x); err != nil {
		return err
	}
	var (
		role    uuid.UUID
		version int
	)
	err := c.tx.QueryRow(ctx, `select r.id, r.current_version from access.roles r
		  join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		 where r.template_key = $1 and r.archived_at is null order by r.created_at, r.id limit 1`, templateDriver).Scan(&role, &version)
	if errNoRows(err) {
		return kit.Conflict(textNoRole)
	}
	if err != nil {
		return err
	}
	var assignment uuid.UUID
	if err := c.tx.QueryRow(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, source, granted_by, reason, created_at)
		values ('person', $1, $2, $3, 'unit', $4, false, tstzrange($5, $6, '[)'), $7, $8, $9, $10) returning id`,
		x.person, role, version, scope, x.period.Start, x.period.End, sourceTransfer, c.tc.PersonID,
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
	_, err = realtime.BumpPolicy(ctx, c.tx, c.tc.TenantID, []uuid.UUID{x.person}, "fleet.driver_transfer.approve")
	return err
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
// водитель.»; started, accepted or cancelled — 409 «Рейс уже начат или закрыт.». It returns the unit of the trip.
func (c *cmd) approveTrip(ctx context.Context, id, person uuid.UUID) (uuid.UUID, error) {
	var (
		unit   uuid.UUID
		state  string
		driver *uuid.UUID
	)
	err := c.tx.QueryRow(ctx, `select unit_id, state, driver_person_id from fleet.trips where id = $1 for update`, id).
		Scan(&unit, &state, &driver)
	if err != nil {
		return uuid.Nil, err
	}
	switch {
	case driver != nil && *driver != person:
		return uuid.Nil, kit.Conflict(textTripDriver)
	case state != tripPlanned && state != tripAssigned:
		return uuid.Nil, kit.Conflict(textTripStarted)
	}
	return unit, nil
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
// did not start loses him.
func (c *cmd) revoke(ctx context.Context, x transfer) error {
	if x.assignment != nil {
		if _, err := c.tx.Exec(ctx, `update access.role_assignments set state = 'revoked', revoked_at = $2,
			valid = tstzrange(lower(valid), greatest(lower(valid), $2), '[)') where id = $1`, *x.assignment, c.now); err != nil {
			return fmt.Errorf("pool: revoke grant: %w", err)
		}
	}
	if _, err := c.tx.Exec(ctx, `update fleet.driver_transfers set state = 'revoked', revoked_by = $2, completed_at = $3,
		revision = revision + 1 where id = $1`, x.id, c.tc.PersonID, c.now); err != nil {
		return fmt.Errorf("pool: revoke: %w", err)
	}
	if x.trip != nil {
		if _, err := unassign(ctx, c.tx, *x.trip, x.person); err != nil {
			return err
		}
	}
	_, err := realtime.BumpPolicy(ctx, c.tx, c.tc.TenantID, []uuid.UUID{x.person}, "fleet.driver_transfer.revoke")
	return err
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
	owners := []uuid.UUID{}
	if c.s.Owners != nil {
		list, err := c.s.Owners.Owners(ctx, c.tc.TenantID)
		if err != nil {
			return nil, err
		}
		owners = append(owners, list...)
	}
	rows, err := c.tx.Query(ctx, candidatesSQL, c.now, actionRequest, owners)
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
	if d == fleetapi.DriverTransferDecisionDecisionApprove {
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
