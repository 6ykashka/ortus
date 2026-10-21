package pool

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// publicationCols and publicationFrom read a publication with the name of its driver and its home company.
const (
	publicationCols = `p.id, p.person_id, pp.full_name, coalesce(p.display_name, ''), p.home_unit_id, u.name, u.time_zone,
	       p.qualifications, lower(p.available), upper(p.available), p.terms, p.published_by, p.created_at,
	       p.withdrawn_at, p.withdrawn_by, p.withdrawal_comment, p.revision, p.usual_vehicle_id`
	publicationFrom = `
	  from fleet.pool_publications p
	  join people.person_profiles pp on pp.id = p.person_id
	  join org.units u on u.id = p.home_unit_id`
)

// homeColumns are the columns the scope predicate filters publications on: the home company of the driver.
var homeColumns = authz.Columns{Unit: "p.home_unit_id"}

// publication is a row of fleet.pool_publications.
type publication struct {
	id, person, home      uuid.UUID
	name, label, homeName string
	zone                  string
	qualifications        []string
	free                  Window
	terms                 *string
	publishedBy           uuid.UUID
	publishedAt           time.Time
	withdrawnAt           *time.Time
	withdrawnBy           *uuid.UUID
	withdrawalComment     *string
	revision              int64
	usual                 *uuid.UUID // the usual vehicle of the driver (W2.72, S2-20 rule 1, TD-01)
}

func scanPublication(row pgx.Row) (publication, error) {
	var p publication
	err := row.Scan(&p.id, &p.person, &p.name, &p.label, &p.home, &p.homeName, &p.zone, &p.qualifications, &p.free.Start,
		&p.free.End, &p.terms, &p.publishedBy, &p.publishedAt, &p.withdrawnAt, &p.withdrawnBy, &p.withdrawalComment, &p.revision, &p.usual)
	return p, err
}

// state is the state of the publication at now.
func (p publication) state(now time.Time) fleetapi.DriverPoolPublicationState {
	return PublicationState(p.free, p.withdrawnAt != nil, now)
}

func (p publication) window() fleetapi.TimeWindow {
	return fleetapi.TimeWindow{StartsAt: p.free.Start, EndsAt: p.free.End, TimeZone: p.zone}
}

// dto is the publication for the source company: with the name of the driver (AUTH-06: the catalog never shows it).
func (p publication) dto(now time.Time) fleetapi.DriverPoolPublication {
	name, homeName := p.name, p.homeName
	out := fleetapi.DriverPoolPublication{
		Id: p.id, DriverMemberId: p.person, DriverDisplayName: &name, DisplayName: p.label, HomeOrgUnitId: p.home,
		HomeOrgUnitName: &homeName, Qualifications: nonNil(p.qualifications), FreeWindow: p.window(), Terms: p.terms,
		State: p.state(now), PublishedAt: p.publishedAt.UTC(), WithdrawnAt: utc(p.withdrawnAt),
		WithdrawnByMemberId: p.withdrawnBy, WithdrawalComment: p.withdrawalComment, Revision: p.revision,
		UsualVehicleId: p.usual,
	}
	if p.publishedBy != uuid.Nil {
		by := p.publishedBy
		out.PublishedByMemberId = &by
	}
	return out
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// loadPublication reads publication id (lock: "" or a locking clause of p); missing — 404.
func loadPublication(ctx context.Context, q pgx.Tx, id uuid.UUID, lock string) (publication, error) {
	p, err := scanPublication(q.QueryRow(ctx, `select `+publicationCols+publicationFrom+` where p.id = $1`+lock, id))
	if errNoRows(err) {
		return publication{}, problem.New(problem.CodeNotFound, textPublicationFound)
	}
	return p, err
}

// checkPublish checks the body of publishDriverToPool before the database.
func checkPublish(b fleetapi.DriverPoolPublicationCreate) (Window, error) {
	if len(b.Qualifications) > maxQualifications {
		return Window{}, kit.Invalid(textLimit)
	}
	for _, q := range b.Qualifications {
		if n := utf8.RuneCountInString(q); n < 1 || n > maxQualification {
			return Window{}, kit.Invalid(textLimit)
		}
	}
	if b.Terms != nil && utf8.RuneCountInString(*b.Terms) > maxTerms {
		return Window{}, kit.Invalid(textLimit)
	}
	return Window{Start: b.FreeWindow.StartsAt.UTC(), End: b.FreeWindow.EndsAt.UTC()}, nil
}

// Publish publishes a driver of the home company for a free window (publishDriverToPool; order of checks of the
// contract, Q-W2.51-14): no approve in any company — 403; an unknown company and a company outside org_units.read —
// the same 422; a visible company without approve — 403; an unknown, archived, foreign member or a member without the
// function «Водитель» at the start of the window — the same 422; an empty or past window — 422; a window overlapping
// a not withdrawn publication of the driver or a trip of his — 409 resources_unavailable. The pool label is the next
// number of the tenant under an advisory lock of the tenant. Writes the audit row and fleet.pool.published.v1 (ids
// only).
func (s *Service) Publish(ctx context.Context, tc tenantctx.TenantContext, b fleetapi.DriverPoolPublicationCreate) (fleetapi.DriverPoolPublication, error) {
	w, err := checkPublish(b)
	if err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	var out fleetapi.DriverPoolPublication
	err = s.run(ctx, tc, func(c *cmd) error {
		var err error
		out, err = c.publish(ctx, b, w)
		return err
	})
	return out, err
}

func (c *cmd) publish(ctx context.Context, b fleetapi.DriverPoolPublicationCreate, w Window) (fleetapi.DriverPoolPublication, error) {
	if ok, err := c.anywhere(ctx, actionApprove, homeColumns); err != nil || !ok {
		return fleetapi.DriverPoolPublication{}, firstErr(err, problem.New(problem.CodeForbiddenAction, ""))
	}
	if err := c.home(ctx, b.HomeOrgUnitId); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	if err := c.publishable(ctx, b.DriverMemberId, b.HomeOrgUnitId, w); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	if err := c.usualVehicle(ctx, b.UsualVehicleId, b.HomeOrgUnitId); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	if err := c.free(ctx, b.DriverMemberId, w); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	label, err := c.label(ctx)
	if err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	var id uuid.UUID
	err = c.tx.QueryRow(ctx, `insert into fleet.pool_publications (person_id, home_unit_id, qualifications, available,
		published_by, created_at, display_name, terms, usual_vehicle_id)
		values ($1, $2, $3, tstzrange($4, $5, '[)'), $6, $7, $8, $9, $10) returning id`,
		b.DriverMemberId, b.HomeOrgUnitId, nonNil(b.Qualifications), w.Start, w.End, c.tc.PersonID, c.now, label, b.Terms,
		b.UsualVehicleId).Scan(&id)
	if violates(err, codeExclusionViolation, "") {
		return fleetapi.DriverPoolPublication{}, problem.New(codeUnavailable, textPublished)
	}
	if err != nil {
		return fleetapi.DriverPoolPublication{}, fmt.Errorf("pool: publish: %w", err)
	}
	diff := map[string]any{"driverMemberId": b.DriverMemberId, "homeOrgUnitId": b.HomeOrgUnitId, "displayName": label,
		keyStartsAt: w.Start, keyEndsAt: w.End}
	if b.UsualVehicleId != nil {
		diff["usualVehicleId"] = *b.UsualVehicleId
	}
	if _, err := c.record(ctx, "fleet.pool.publish", eventPublished, targetPublication, id, b.HomeOrgUnitId, diff); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	p, err := loadPublication(ctx, c.tx, id, "")
	if err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	out := p.dto(c.now)
	return out, kit.Complete(ctx, c.tx, http.StatusCreated, kit.ETag(out.Revision), out)
}

func firstErr(err, otherwise error) error {
	if err != nil {
		return err
	}
	return otherwise
}

// home checks the home company of a publication under a share lock: unknown or outside org_units.read — 422 (the
// answer never reveals which companies exist), visible without approve — 403.
func (c *cmd) home(ctx context.Context, unit uuid.UUID) error {
	var found uuid.UUID
	err := c.tx.QueryRow(ctx, `select id from org.units where id = $1 and archived_at is null for share`, unit).Scan(&found)
	if errNoRows(err) {
		return kit.Invalid(textUnit)
	}
	if err != nil {
		return err
	}
	err = c.ev.Permit(ctx, c.tc, actionApprove, authz.Resource{Unit: unit, ReadAction: actionUnitsRead})
	return denied(err, kit.Invalid(textUnit))
}

// publishable checks the driver of a publication under a lock of his row (two publications of one driver queue): a
// live person of the home company with the function «Водитель» at the start of the window; anything else is the same
// 422 — the answer never reveals the members of other companies.
func (c *cmd) publishable(ctx context.Context, person, home uuid.UUID, w Window) error {
	var (
		at     uuid.UUID
		driver bool
	)
	err := c.tx.QueryRow(ctx, `select p.home_unit_id, exists (select 1 from people.work_profiles f
		 where f.person_id = p.id and f.function = $2 and f.valid @> $3::timestamptz)
		  from people.person_profiles p where p.id = $1 and p.archived_at is null for no key update of p`,
		person, functionDriver, w.Start).Scan(&at, &driver)
	switch {
	case errNoRows(err):
		return kit.Invalid(textDriver)
	case err != nil:
		return err
	case at != home || !driver:
		return kit.Invalid(textDriver)
	case !w.Valid():
		return kit.Invalid(textWindow)
	case !w.End.After(c.now):
		return kit.Invalid(textWindowPast)
	}
	return nil
}

// free requires the window free of the not withdrawn publications (active or expired — tenant 0014
// pool_publications_no_overlap) and of the trips of the driver that are neither accepted nor cancelled.
func (c *cmd) free(ctx context.Context, person uuid.UUID, w Window) error {
	var published bool
	if err := c.tx.QueryRow(ctx, `select exists (select 1 from fleet.pool_publications where person_id = $1
		 and withdrawn_at is null and available && tstzrange($2, $3, '[)'))`, person, w.Start, w.End).Scan(&published); err != nil {
		return err
	}
	if published {
		return problem.New(codeUnavailable, textPublished)
	}
	var number string
	err := c.tx.QueryRow(ctx, `select number from fleet.trips where driver_person_id = $1
		 and state not in ('accepted', 'cancelled') and planned && tstzrange($2, $3, '[)')
		 order by lower(planned), id limit 1`, person, w.Start, w.End).Scan(&number)
	switch {
	case errNoRows(err):
		return nil
	case err != nil:
		return err
	}
	return problem.New(codeUnavailable, textDriverOnTrip+number+".")
}

// label takes the next pool label of the tenant under an advisory lock (two publications never get one number).
func (c *cmd) label(ctx context.Context) (string, error) {
	if err := c.lock(ctx, "fleet.pool_publications.display_name"); err != nil {
		return "", err
	}
	var n int
	err := c.tx.QueryRow(ctx, `select coalesce(max(substring(display_name from '#([0-9]{1,9})$')::int), 0)
		  from fleet.pool_publications`).Scan(&n)
	return NextLabel(n), err
}

// record writes the audit row and the outbox event of a command of the actor and returns the id of the event.
func (c *cmd) record(ctx context.Context, action, event, target string, id, unit uuid.UUID, diff map[string]any) (uuid.UUID, error) {
	if err := kit.Audit(ctx, c.tx, audit.Event{Action: action, TargetType: target, TargetID: id, UnitID: unit, Diff: diff}); err != nil {
		return uuid.Nil, err
	}
	payload := map[string]any{"id": id, "unitId": unit}
	maps.Copy(payload, diff)
	ev, err := events.Publish(ctx, c.tx, events.Event{Type: event, Aggregate: target, AggregateID: id, Payload: payload})
	if err != nil {
		return uuid.Nil, fmt.Errorf("pool: event %s: %w", event, err)
	}
	return ev, nil
}

// Withdraw removes a publication from the catalog (withdrawDriverPoolPublication): invisible — 404; visible without
// approve — 403; If-Match; a publication that is not active — 409. Open requests of it expire; approved transfers keep
// their grant until the window end or the revocation. Writes the audit row and fleet.pool.withdrawn.v1.
func (s *Service) Withdraw(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.DriverPoolWithdrawal) (fleetapi.DriverPoolPublication, error) {
	if b.Comment != nil && utf8.RuneCountInString(*b.Comment) > maxComment {
		return fleetapi.DriverPoolPublication{}, kit.Invalid(textLimit)
	}
	var out fleetapi.DriverPoolPublication
	err := s.run(ctx, tc, func(c *cmd) error {
		var err error
		out, err = c.withdraw(ctx, id, ifMatch, b)
		return err
	})
	return out, err
}

func (c *cmd) withdraw(ctx context.Context, id uuid.UUID, ifMatch string, b fleetapi.DriverPoolWithdrawal) (fleetapi.DriverPoolPublication, error) {
	p, err := loadPublication(ctx, c.tx, id, " for update of p")
	if err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	notFound := problem.New(problem.CodeNotFound, textPublicationFound)
	if err := c.ev.Permit(ctx, c.tc, actionApprove, authz.Resource{Unit: p.home, ReadAction: actionRead}); err != nil {
		return fleetapi.DriverPoolPublication{}, denied(err, notFound)
	}
	if err := kit.CheckRevision(ifMatch, p.revision); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	if p.state(c.now) != fleetapi.DriverPoolPublicationStateActive {
		return fleetapi.DriverPoolPublication{}, kit.Conflict(textWithdrawn)
	}
	var comment *string
	if b.Comment != nil && strings.TrimSpace(*b.Comment) != "" {
		comment = b.Comment
	}
	if _, err := c.tx.Exec(ctx, `update fleet.pool_publications set withdrawn_at = $2, withdrawn_by = $3,
		withdrawal_comment = $4, revision = revision + 1 where id = $1`, id, c.now, c.tc.PersonID, comment); err != nil {
		return fleetapi.DriverPoolPublication{}, fmt.Errorf("pool: withdraw: %w", err)
	}
	tag, err := c.tx.Exec(ctx, `update fleet.driver_transfers set state = 'expired', revision = revision + 1
		 where publication_id = $1 and state = 'requested'`, id)
	if err != nil {
		return fleetapi.DriverPoolPublication{}, fmt.Errorf("pool: expire requests: %w", err)
	}
	diff := map[string]any{"withdrawnAt": c.now, "expiredRequests": tag.RowsAffected()}
	if _, err := c.record(ctx, "fleet.pool.withdraw", eventWithdrawn, targetPublication, id, p.home, diff); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	if p, err = loadPublication(ctx, c.tx, id, ""); err != nil {
		return fleetapi.DriverPoolPublication{}, err
	}
	out := p.dto(c.now)
	return out, kit.Complete(ctx, c.tx, http.StatusOK, kit.ETag(out.Revision), out)
}

// Publication reads a publication of a home company the actor reads pool requests of (getDriverPoolPublication);
// another company — 404, as a missing one (AC-01).
func (s *Service) Publication(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.DriverPoolPublication, error) {
	var out fleetapi.DriverPoolPublication
	err := s.run(ctx, tc, func(c *cmd) error {
		p, err := loadPublication(ctx, c.tx, id, "")
		if err != nil {
			return err
		}
		if err := c.ev.Permit(ctx, c.tc, actionRead, authz.Resource{Unit: p.home}); err != nil {
			return denied(err, problem.New(problem.CodeNotFound, textPublicationFound))
		}
		out = p.dto(c.now)
		return nil
	})
	return out, err
}

// Publications lists the publications of the home companies the actor reads pool requests of, filtered by scope
// before the page; the newest window first, then the id (listDriverPoolPublications).
func (s *Service) Publications(ctx context.Context, tc tenantctx.TenantContext, params fleetapi.ListDriverPoolPublicationsParams) (fleetapi.DriverPoolPublicationPage, error) {
	limit, err := kit.PageLimit(params.Limit)
	if err != nil {
		return fleetapi.DriverPoolPublicationPage{}, err
	}
	out := fleetapi.DriverPoolPublicationPage{Items: []fleetapi.DriverPoolPublication{}}
	err = s.run(ctx, tc, func(c *cmd) error {
		var a sqlArgs
		where, fp, err := c.publicationFilter(ctx, &a, params)
		if err != nil {
			return err
		}
		if params.Cursor != nil {
			at, id, err := keyset(*params.Cursor, fp)
			if err != nil {
				return err
			}
			s, i := a.add(at), a.add(id)
			where = append(where, "(lower(p.available) < "+s+" or (lower(p.available) = "+s+" and p.id > "+i+"))")
		}
		rows, err := c.tx.Query(ctx, `select `+publicationCols+publicationFrom+` where `+strings.Join(where, " and ")+
			` order by lower(p.available) desc, p.id limit `+a.add(limit+1), a.vals...)
		if err != nil {
			return err
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (publication, error) { return scanPublication(r) })
		if err != nil {
			return err
		}
		if len(list) > limit {
			last := list[limit-1]
			next := encodeCursor(fp, last.free.Start.UTC().Format(time.RFC3339Nano), last.id.String())
			out.NextCursor, list = &next, list[:limit]
		}
		for _, p := range list {
			out.Items = append(out.Items, p.dto(c.now))
		}
		return nil
	})
	return out, err
}

// publicationFilter is the condition of listDriverPoolPublications — read over the home company, the state at now
// and the home company asked — and the fingerprint of its cursor.
func (c *cmd) publicationFilter(ctx context.Context, a *sqlArgs, params fleetapi.ListDriverPoolPublicationsParams) ([]string, string, error) {
	pred, err := a.scope(ctx, c, actionRead, homeColumns)
	if err != nil {
		return nil, "", err
	}
	where := []string{pred}
	state, home := "", ""
	if params.State != nil {
		state = string(*params.State)
		switch *params.State {
		case fleetapi.ListDriverPoolPublicationsParamsStateActive:
			where = append(where, "p.withdrawn_at is null and upper(p.available) > "+a.add(c.now))
		case fleetapi.ListDriverPoolPublicationsParamsStateWithdrawn:
			where = append(where, "p.withdrawn_at is not null")
		case fleetapi.ListDriverPoolPublicationsParamsStateExpired:
			where = append(where, "p.withdrawn_at is null and upper(p.available) <= "+a.add(c.now))
		default:
			return nil, "", problem.New(problem.CodeMalformedRequest, "")
		}
	}
	if params.HomeOrgUnitId != nil {
		home = params.HomeOrgUnitId.String()
		where = append(where, "p.home_unit_id = "+a.add(*params.HomeOrgUnitId))
	}
	return where, c.fingerprint("publications", state, home), nil
}

// keyset decodes a cursor of a moment and an id bound to fingerprint.
func keyset(cursor, fingerprint string) (time.Time, uuid.UUID, error) {
	keys, err := decodeCursor(cursor, fingerprint, 2)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	at, err := time.Parse(time.RFC3339Nano, keys[0])
	if err != nil {
		return time.Time{}, uuid.Nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	id, err := uuid.Parse(keys[1])
	if err != nil {
		return time.Time{}, uuid.Nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	return at, id, nil
}
