package finance

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the module (api/permissions.yaml, fleet).
const (
	actionRead      = "fleet.earnings.read"
	actionManage    = "fleet.earnings.manage"
	actionTripsRead = "fleet.trips.read"
)

// Audit names of the ledger.
const (
	targetEarnings = "finance.earnings"
	actionSet      = "finance.earnings.set"
)

const (
	stateAccepted    = "accepted"
	defaultPageLimit = 50
)

// columns are the columns the scope of fleet.earnings.* filters trips on: the unit of the trip only — no «own»
// person, a driver never reads his earnings through a self scope (AC-05).
var columns = authz.Columns{Unit: "t.unit_id"}

// querier is what a pool and a transaction share.
type querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// trip is the trip of earnings.
type trip struct {
	id, unit   uuid.UUID
	state      string
	driver     *uuid.UUID
	reviewer   *uuid.UUID
	reviewedAt *time.Time
}

// accepted reports whether the trip has earnings: accepted, with its driver and its reviewer.
func (t trip) accepted() bool {
	return t.state == stateAccepted && t.driver != nil && t.reviewer != nil && t.reviewedAt != nil
}

const tripSQL = `select id, unit_id, state, driver_person_id, reviewed_by, reviewed_at from fleet.trips where id = $1`

// driverOnly reports whether the subject has the work function «Водитель» now: it closes the earnings (D-10), the
// evaluator says so too — the module does not rely on it alone.
func driverOnly(ctx context.Context, q querier, tc tenantctx.TenantContext, now time.Time) (bool, error) {
	if tc.PersonID == uuid.Nil {
		return false, nil
	}
	var yes bool
	err := q.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		 where person_id = $1 and function = 'driver' and valid @> $2::timestamptz)`, tc.PersonID, now).Scan(&yes)
	if err != nil {
		return false, fmt.Errorf("finance: work functions: %w", err)
	}
	return yes, nil
}

func blocked() error { return problem.New(codeFunctionBlocked, textDriver) }

// access reads trip id through q (lock: for update) and checks action of the subject on its earnings: the driver
// function — 403 function_blocked first; a missing or invisible trip — 404; a visible one without the right — 403;
// a trip without earnings (not accepted) — 404.
func (s *Service) access(ctx context.Context, q querier, ev Authorizer, tc tenantctx.TenantContext, id uuid.UUID, action string, lock bool) (trip, error) {
	only, err := driverOnly(ctx, q, tc, s.now())
	if err != nil {
		return trip{}, err
	}
	if only {
		return trip{}, blocked()
	}
	sql := tripSQL
	if lock {
		sql += ` for update`
	}
	var t trip
	err = q.QueryRow(ctx, sql, id).Scan(&t.id, &t.unit, &t.state, &t.driver, &t.reviewer, &t.reviewedAt)
	if errNoRows(err) {
		return trip{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return trip{}, fmt.Errorf("finance: trip: %w", err)
	}
	err = ev.Permit(ctx, tc, action, authz.Resource{Unit: t.unit, ReadAction: actionTripsRead})
	if problem.Is(err, problem.CodeNotFound) {
		return trip{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return trip{}, err
	}
	if !t.accepted() {
		return trip{}, problem.New(problem.CodeNotFound, textNoEarnings)
	}
	return t, nil
}

// noteSQL is the calculation note of earnings e.id: the one of its latest write in the ledger.
const noteSQL = `(select a.diff->>'calculationNote' from audit.events a
   where e.id is not null and a.target_type = 'finance.earnings' and a.target_id = e.id and a.action = 'finance.earnings.set'
   order by a.id desc limit 1)`

const earningsSQL = `
select e.id, e.amount_minor, e.currency, coalesce(e.updated_by, $2), e.updated_at, e.revision, ` + noteSQL + `
  from finance.earnings e where e.trip_id = $1`

// read is the earnings of the accepted trip t: its row, or the draft of 0 ₽ at revision 1 by the reviewer at the
// acceptance while the manager has written nothing.
func read(ctx context.Context, q querier, t trip) (earningsapi.TripEarnings, *uuid.UUID, error) {
	out := earningsapi.TripEarnings{TripId: t.id, DriverMemberId: *t.driver, Amount: earningsapi.Money{AmountMinor: 0, Currency: currency},
		UpdatedByMemberId: *t.reviewer, UpdatedAt: t.reviewedAt.UTC(), Revision: 1}
	var id uuid.UUID
	err := q.QueryRow(ctx, earningsSQL, t.id, *t.reviewer).Scan(&id, &out.Amount.AmountMinor, &out.Amount.Currency,
		&out.UpdatedByMemberId, &out.UpdatedAt, &out.Revision, &out.CalculationNote)
	if errNoRows(err) {
		return out, nil, nil
	}
	if err != nil {
		return earningsapi.TripEarnings{}, nil, fmt.Errorf("finance: earnings: %w", err)
	}
	out.Amount.Currency, out.UpdatedAt = strings.TrimSpace(out.Amount.Currency), out.UpdatedAt.UTC()
	return out, &id, nil
}

// Earnings returns the earnings of an accepted trip (getTripEarnings) to the owner or a manager with
// fleet.earnings.read over the unit of the trip.
func (s *Service) Earnings(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (earningsapi.TripEarnings, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return earningsapi.TripEarnings{}, err
	}
	t, err := s.access(ctx, pool, s.Authz, tc, id, actionRead, false)
	if err != nil {
		return earningsapi.TripEarnings{}, dbError(err)
	}
	out, _, err := read(ctx, pool, t)
	return out, dbError(err)
}

// checkRevision compares If-Match with the current revision: missing — 428; anything but the strong ETag — 412.
func checkRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	switch {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != etag(current):
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

const (
	insertSQL = `
insert into finance.earnings (trip_id, person_id, unit_id, amount_minor, currency, state, revision, updated_by, updated_at)
values ($1, $2, $3, $4, $5, 'approved', 2, $6, $7) returning id`
	updateSQL = `
update finance.earnings set amount_minor = $2, currency = $3, state = 'corrected', revision = revision + 1, updated_by = $4,
       updated_at = $5
 where id = $1`
)

// Set writes the earnings of an accepted trip (setTripEarnings) with the If-Match of its current revision (the draft
// is revision 1): the owner or a manager with fleet.earnings.manage over the unit of the trip. The first write
// creates the row (approved, revision 2), the next ones correct it; each is a restricted row of the ledger.
func (s *Service) Set(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b earningsapi.EarningsUpdate) (earningsapi.TripEarnings, error) {
	if err := checkUpdate(&b); err != nil {
		return earningsapi.TripEarnings{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return earningsapi.TripEarnings{}, err
	}
	var out earningsapi.TripEarnings
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		t, err := s.access(ctx, tx, s.through(tx), tc, id, actionManage, true)
		if err != nil {
			return err
		}
		cur, row, err := read(ctx, tx, t)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, cur.Revision); err != nil {
			return err
		}
		now := s.now()
		if row == nil {
			var created uuid.UUID
			if err := tx.QueryRow(ctx, insertSQL, t.id, *t.driver, t.unit, b.Amount.AmountMinor, currency, tc.PersonID, now).
				Scan(&created); err != nil {
				return fmt.Errorf("finance: create: %w", err)
			}
			row = &created
		} else if _, err := tx.Exec(ctx, updateSQL, *row, b.Amount.AmountMinor, currency, tc.PersonID, now); err != nil {
			return fmt.Errorf("finance: correct: %w", err)
		}
		if err := ledger(ctx, tx, tc, t, *row, cur, b); err != nil {
			return err
		}
		if out, _, err = read(ctx, tx, t); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, dbError(err)
}

// ledger writes the restricted audit row of a write (the minimal ledger of S2-12): the amount before and after, the
// revision it makes and the calculation note. The row is restricted: it is never shown to a driver or put into an
// event, a notification or a dataset (AC-05).
func ledger(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t trip, row uuid.UUID, before earningsapi.TripEarnings, b earningsapi.EarningsUpdate) error {
	diff := map[string]any{"tripId": t.id, "driverMemberId": *t.driver, "previousAmountMinor": before.Amount.AmountMinor,
		"amountMinor": b.Amount.AmountMinor, "currency": currency, "revision": before.Revision + 1}
	if n := note(b); n != nil {
		diff["calculationNote"] = *n
	}
	err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: actionSet,
		TargetType: targetEarnings, TargetID: row, UnitID: t.unit, Sensitivity: audit.Restricted, Result: audit.OK,
		RequestID: requestID(ctx), Diff: diff})
	if err != nil {
		return fmt.Errorf("finance: ledger: %w", err)
	}
	return nil
}

const listSQL = `
select t.id, t.driver_person_id, coalesce(e.amount_minor, 0), coalesce(e.currency, 'RUB'), coalesce(e.updated_by, t.reviewed_by),
       coalesce(e.updated_at, t.reviewed_at), coalesce(e.revision, 1), ` + noteSQL + `
  from fleet.trips t
  left join finance.earnings e on e.trip_id = t.id
 where t.state = 'accepted' and t.driver_person_id is not null and t.reviewed_at is not null
   and coalesce(e.updated_by, t.reviewed_by) is not null
   and ($1::uuid is null or t.unit_id in (select descendant_id from org.unit_closure where ancestor_id = $1::uuid))
   and ($2::timestamptz is null or (coalesce(e.updated_at, t.reviewed_at), t.id) < ($2::timestamptz, $3::uuid))
   and ` + scopeddb.Placeholder + `
 order by coalesce(e.updated_at, t.reviewed_at) desc, t.id desc
 limit $4`

// List lists the earnings of the accepted trips the subject reads (listTripEarnings): the scope of fleet.earnings.read
// filters before pagination, newest change first; the unit filter takes its descendants.
func (s *Service) List(ctx context.Context, tc tenantctx.TenantContext, q ListQuery) (earningsapi.TripEarningsPage, error) {
	limit := q.Limit
	if limit == 0 {
		limit = defaultPageLimit
	}
	var at, after any
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor)
		if err != nil {
			return earningsapi.TripEarningsPage{}, err
		}
		at, after = c.At, c.ID
	}
	var unit any
	if q.Unit != uuid.Nil {
		unit = q.Unit
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return earningsapi.TripEarningsPage{}, err
	}
	only, err := driverOnly(ctx, pool, tc, s.now())
	if err != nil {
		return earningsapi.TripEarningsPage{}, dbError(err)
	}
	if only {
		return earningsapi.TripEarningsPage{}, blocked()
	}
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return earningsapi.TripEarningsPage{}, dbError(err)
	}
	rows, err := conn.Query(ctx, actionRead, columns, listSQL, unit, at, after, limit+1)
	if err != nil {
		return earningsapi.TripEarningsPage{}, dbError(err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (earningsapi.TripEarnings, error) {
		var e earningsapi.TripEarnings
		err := row.Scan(&e.TripId, &e.DriverMemberId, &e.Amount.AmountMinor, &e.Amount.Currency, &e.UpdatedByMemberId,
			&e.UpdatedAt, &e.Revision, &e.CalculationNote)
		e.Amount.Currency, e.UpdatedAt = strings.TrimSpace(e.Amount.Currency), e.UpdatedAt.UTC()
		return e, err
	})
	if err != nil {
		return earningsapi.TripEarningsPage{}, dbError(err)
	}
	page := earningsapi.TripEarningsPage{Items: items}
	if len(items) > limit {
		page.Items = items[:limit]
		last := page.Items[limit-1]
		next := encodeCursor(pageCursor{At: last.UpdatedAt, ID: last.TripId})
		page.NextCursor = &next
	}
	return page, nil
}
