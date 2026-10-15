package people

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// pgExclusionViolation is the SQLSTATE of the exclusion constraint of people.work_profiles (one function never
// has two overlapping periods).
const pgExclusionViolation = "23P01"

// profile is a row of people.work_profiles. Revision is xmin of the row: the table has no revision column, and
// xmin changes with every update of the row (optimistic locking until the steward adds the column).
type profile struct {
	ID       uuid.UUID
	Function string // people.work_profiles.function
	From     time.Time
	Until    *time.Time
	Revision int64
}

const profileReturning = `returning id, function, lower(valid), upper(valid), xmin::text::bigint`

func scanProfile(row pgx.Row) (profile, error) {
	var p profile
	err := row.Scan(&p.ID, &p.Function, &p.From, &p.Until, &p.Revision)
	return p, err
}

func (p profile) dto(now time.Time) accessapi.WorkProfile {
	api, _ := kit.FunctionFromDB(p.Function) // rows of unknown functions are filtered out before
	out := accessapi.WorkProfile{
		Id: p.ID, Function: accessapi.WorkProfileFunction(api), ValidFrom: p.From.UTC(),
		State: accessapi.WorkProfileState(kit.WorkState(p.From, p.Until, now)), Revision: p.Revision,
	}
	if p.Until != nil {
		u := p.Until.UTC()
		out.ValidUntil = &u
	}
	return out
}

// listProfilesSQL: the visible person $1 (one row without a profile if it has none) with its work functions,
// newest first.
const listProfilesSQL = `
select w.id, w.function, lower(w.valid), upper(w.valid), w.xmin::text::bigint
  from people.person_profiles p
  left join people.work_profiles w on w.person_id = p.id
 where p.id = $1 and p.archived_at is null and {{scope}}
 order by lower(w.valid) desc nulls last, w.id`

// ListWorkProfiles implements accessapi.StrictServerInterface: the work functions of a visible person with their
// periods, ended ones included.
func (s *Server) ListWorkProfiles(ctx context.Context, req accessapi.ListWorkProfilesRequestObject) (accessapi.ListWorkProfilesResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := c.Query(ctx, actionRead, persons, listProfilesSQL, req.MemberId)
	if err != nil {
		return nil, dbError(err)
	}
	type row struct {
		ID       *uuid.UUID
		Function *string
		From     *time.Time
		Until    *time.Time
		Revision *int64
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		err := r.Scan(&x.ID, &x.Function, &x.From, &x.Until, &x.Revision)
		return x, err
	})
	if err != nil {
		return nil, dbError(err)
	}
	if len(list) == 0 {
		return nil, problem.New(problem.CodeNotFound, "")
	}
	now := s.now()
	body := accessapi.WorkProfileList{MemberId: req.MemberId, Items: []accessapi.WorkProfile{}}
	for _, x := range list {
		if x.ID == nil {
			continue
		}
		if _, ok := kit.FunctionFromDB(*x.Function); !ok {
			continue
		}
		p := profile{ID: *x.ID, Function: *x.Function, From: *x.From, Until: x.Until, Revision: *x.Revision}
		body.Items = append(body.Items, p.dto(now))
	}
	return accessapi.ListWorkProfiles200JSONResponse{
		Body: body, Headers: accessapi.ListWorkProfiles200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}

// CreateWorkProfile implements accessapi.StrictServerInterface: a work function from validFrom until validUntil or
// open-ended. Overlap with the same function — 409 invalid_transition; the driver function over an earnings grant
// at any moment of the period — 409 separation_of_duties_conflict. Raises policy_version; audited.
func (s *Server) CreateWorkProfile(ctx context.Context, req accessapi.CreateWorkProfileRequestObject) (accessapi.CreateWorkProfileResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	fn, ok := kit.FunctionToDB(string(req.Body.Function))
	if !ok {
		return nil, kit.Invalid(textUnknownFn)
	}
	t, err := s.manageable(ctx, tc, req.MemberId)
	if err != nil {
		return nil, err
	}
	now := s.now()
	from, until := req.Body.ValidFrom, req.Body.ValidUntil
	if err := kit.CheckPeriod(from, until, now, t.Zone); err != nil {
		return nil, err
	}
	owner, err := s.isOwner(ctx, tc.TenantID, t.Membership)
	if err != nil {
		return nil, err
	}
	var p profile
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		if p, err = addProfile(ctx, tx, t, fn, from, until, owner); err != nil {
			return err
		}
		if err := kit.BumpPolicy(ctx, tx); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "people.work_profile.create", TargetType: targetProfile, TargetID: p.ID, UnitID: t.Home,
			Diff: map[string]any{"personId": t.ID, "function": fn, "validFrom": from, "validUntil": until},
		}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(p.Revision), p.dto(now))
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(p.Revision), false
	return accessapi.CreateWorkProfile201JSONResponse{
		Body: p.dto(now),
		Headers: accessapi.CreateWorkProfile201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// overlapText is the conflict of a period with another period of the same function.
func overlapText(fn string) string {
	api, _ := kit.FunctionFromDB(fn)
	return "У сотрудника уже есть функция «" + labels[api] + "» в этот период."
}

// addProfile inserts a work function of t in tx under the lock of the person: no overlap with the same function,
// no driver function over an earnings grant.
func addProfile(ctx context.Context, tx pgx.Tx, t target, fn string, from time.Time, until *time.Time, owner bool) (profile, error) {
	if _, err := tx.Exec(ctx, `select 1 from people.person_profiles where id = $1 for update`, t.ID); err != nil {
		return profile{}, err
	}
	var overlap bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		where person_id = $1 and function = $2 and valid && tstzrange($3::timestamptz, $4::timestamptz))`,
		t.ID, fn, from, until).Scan(&overlap); err != nil {
		return profile{}, err
	}
	if overlap {
		return profile{}, kit.Conflict(overlapText(fn))
	}
	if fn == kit.FunctionDriver {
		conflict, err := kit.DriverConflict(ctx, tx, t.ID, owner, from, until)
		if err != nil {
			return profile{}, err
		}
		if conflict {
			return profile{}, problem.New(kit.CodeSeparationOfDuties, textSoD)
		}
	}
	p, err := scanProfile(tx.QueryRow(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid)
		values ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz)) `+profileReturning, t.ID, fn, t.Home, from, until))
	if isExclusion(err) {
		return profile{}, kit.Conflict(overlapText(fn))
	}
	return p, err
}

func isExclusion(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == pgExclusionViolation
}

// UpdateWorkProfile implements accessapi.StrictServerInterface: sets validUntil of a work function by If-Match —
// ends it now or later, or shortens a scheduled period. An ended period is 409; an end before the start or in the
// past is 422. Extending a driver period checks the earnings over the added time. Raises policy_version; audited.
func (s *Server) UpdateWorkProfile(ctx context.Context, req accessapi.UpdateWorkProfileRequestObject) (accessapi.UpdateWorkProfileResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	t, err := s.manageable(ctx, tc, req.MemberId)
	if err != nil {
		return nil, err
	}
	owner, err := s.isOwner(ctx, tc.TenantID, t.Membership)
	if err != nil {
		return nil, err
	}
	now, until := s.now(), req.Body.ValidUntil
	var p profile
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		cur, err := scanProfile(tx.QueryRow(ctx, `select id, function, lower(valid), upper(valid), xmin::text::bigint
			from people.work_profiles where id = $1 and person_id = $2 for update`, req.WorkProfileId, t.ID))
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, "")
		}
		if err != nil {
			return err
		}
		if err := kit.CheckRevision(req.Params.IfMatch, cur.Revision); err != nil {
			return err
		}
		if p, err = endProfile(ctx, tx, t, cur, until, now, owner); err != nil {
			return err
		}
		if err := kit.BumpPolicy(ctx, tx); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "people.work_profile.end", TargetType: targetProfile, TargetID: p.ID, UnitID: t.Home,
			Diff: map[string]any{"personId": t.ID, "function": p.Function, "from": cur.Until, "to": until},
		}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(p.Revision), p.dto(now))
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(p.Revision), false
	return accessapi.UpdateWorkProfile200JSONResponse{
		Body: p.dto(now),
		Headers: accessapi.UpdateWorkProfile200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// endProfile sets the end of the locked period cur to until in tx.
func endProfile(ctx context.Context, tx pgx.Tx, t target, cur profile, until, now time.Time, owner bool) (profile, error) {
	switch {
	case kit.WorkState(cur.From, cur.Until, now) == kit.StateEnded:
		return profile{}, kit.Conflict(textEnded)
	case !until.After(cur.From) || until.Before(now):
		return profile{}, kit.Invalid(kit.TextPeriod)
	}
	if cur.Function == kit.FunctionDriver && cur.Until != nil && until.After(*cur.Until) {
		conflict, err := kit.DriverConflict(ctx, tx, t.ID, owner, *cur.Until, &until)
		if err != nil {
			return profile{}, err
		}
		if conflict {
			return profile{}, problem.New(kit.CodeSeparationOfDuties, textSoD)
		}
	}
	p, err := scanProfile(tx.QueryRow(ctx, `update people.work_profiles set valid = tstzrange(lower(valid), $2::timestamptz)
		where id = $1 `+profileReturning, cur.ID, until))
	if isExclusion(err) {
		return profile{}, kit.Conflict(overlapText(cur.Function))
	}
	return p, err
}
