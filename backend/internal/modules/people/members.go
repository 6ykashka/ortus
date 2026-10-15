package people

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// personColumns selects a person with the functions active at $1.
const personColumns = `select p.id, p.membership_id, p.full_name, p.email, p.home_unit_id, p.revision,
       array(select distinct w.function from people.work_profiles w
              where w.person_id = p.id and w.valid @> $1::timestamptz order by 1)
  from people.person_profiles p`

// listSQL pages the people the actor sees by (name, id): $2 — the unit filter (its subtree) or null, $3, $4 — the
// keyset position or null, $5 — the page size.
const listSQL = personColumns + `
 where p.archived_at is null and {{scope}}
   and ($2::uuid is null or p.home_unit_id in (select descendant_id from org.unit_closure where ancestor_id = $2))
   and ($3::text is null or (p.full_name, p.id) > ($3::text, $4::uuid))
 order by p.full_name, p.id
 limit $5`

// ListMembers implements accessapi.StrictServerInterface: the people in the scope of members.read; orgUnitId only
// narrows the list to a subtree, never widens it.
func (s *Server) ListMembers(ctx context.Context, req accessapi.ListMembersRequestObject) (accessapi.ListMembersResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	limit, err := kit.PageLimit(req.Params.Limit)
	if err != nil {
		return nil, err
	}
	var afterName, afterID *string
	if req.Params.Cursor != nil {
		keys, err := kit.DecodeCursor(*req.Params.Cursor, 2)
		if err != nil {
			return nil, err
		}
		if _, err := uuid.Parse(keys[1]); err != nil {
			return nil, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		afterName, afterID = &keys[0], &keys[1]
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := c.Query(ctx, actionRead, persons, listSQL, s.now(), req.Params.OrgUnitId, afterName, afterID, limit+1)
	if err != nil {
		return nil, dbError(err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (person, error) { return scanPerson(r) })
	if err != nil {
		return nil, dbError(err)
	}
	page := accessapi.MemberPage{Items: make([]accessapi.Member, 0, min(len(list), limit))}
	if len(list) > limit {
		last := list[limit-1]
		next := kit.EncodeCursor(last.Name, last.ID.String())
		page.NextCursor = &next
		list = list[:limit]
	}
	items, err := s.dtos(ctx, tc, list)
	if err != nil {
		return nil, err
	}
	page.Items = items
	return accessapi.ListMembers200JSONResponse{
		Body: page, Headers: accessapi.ListMembers200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}

// dtos joins the people with their memberships of the control DB.
func (s *Server) dtos(ctx context.Context, tc tenantctx.TenantContext, list []person) ([]accessapi.Member, error) {
	var ids []uuid.UUID
	for _, p := range list {
		if p.Membership != nil {
			ids = append(ids, *p.Membership)
		}
	}
	ms, err := s.memberships(ctx, tc.TenantID, ids)
	if err != nil {
		return nil, err
	}
	out := make([]accessapi.Member, 0, len(list))
	for _, p := range list {
		var m *kit.Membership
		if p.Membership != nil {
			if v, ok := ms[*p.Membership]; ok {
				m = &v
			}
		}
		out = append(out, p.dto(m))
	}
	return out, nil
}

// GetMember implements accessapi.StrictServerInterface: a person in the scope of members.read, else 404.
func (s *Server) GetMember(ctx context.Context, req accessapi.GetMemberRequestObject) (accessapi.GetMemberResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	var p person
	err = c.One(ctx, actionRead, persons, func(r pgx.Row) error {
		var err error
		p, err = scanPerson(r)
		return err
	}, personColumns+` where p.id = $2 and p.archived_at is null and {{scope}}`, s.now(), req.MemberId)
	if err != nil {
		return nil, dbError(err)
	}
	items, err := s.dtos(ctx, tc, []person{p})
	if err != nil {
		return nil, err
	}
	tag := kit.ETag(p.Revision)
	return accessapi.GetMember200JSONResponse{
		Body: items[0], Headers: accessapi.GetMember200ResponseHeaders{CacheControl: noStore(), ETag: &tag, XRequestId: rid(ctx)},
	}, nil
}

// CreateMember implements accessapi.StrictServerInterface: a person card without an account (S1-09, BUILD-03) in a
// unit the actor manages people of. It takes no seat and sends no invitation; the e-mail is only recorded.
func (s *Server) CreateMember(ctx context.Context, req accessapi.CreateMemberRequestObject) (accessapi.CreateMemberResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	name, err := kit.CleanName(req.Body.DisplayName, maxName)
	if err != nil {
		return nil, err
	}
	if len(req.Body.OrgUnitIds) != 1 {
		return nil, kit.Invalid(textOneUnit)
	}
	var email *string
	if req.Body.Email != nil {
		e := strings.TrimSpace(string(*req.Body.Email))
		if !kit.ValidEmail(e) {
			return nil, kit.Invalid(textBadEmail)
		}
		email = &e
	}
	home := req.Body.OrgUnitIds[0]
	if err := s.homeUnit(ctx, tc, home); err != nil {
		return nil, err
	}
	var p person
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		p, err = scanPerson(tx.QueryRow(ctx, `insert into people.person_profiles (full_name, email, home_unit_id)
			values ($1, $2, $3)
			returning id, membership_id, full_name, email, home_unit_id, revision, '{}'::text[]`, name, email, home))
		if err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "people.person.create", TargetType: targetPerson, TargetID: p.ID, UnitID: home,
			Sensitivity: audit.Sensitive, Diff: map[string]any{"withoutAccount": true},
		}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(p.Revision), p.dto(nil))
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(p.Revision), false
	return accessapi.CreateMember201JSONResponse{
		Body: p.dto(nil),
		Headers: accessapi.CreateMember201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// homeUnit checks the home unit of a new card: it exists, is not archived and the actor has members.manage over
// it. An unknown unit and a unit the actor cannot see are the same 422 (AC-01); a visible unit without the right
// is 403.
func (s *Server) homeUnit(ctx context.Context, tc tenantctx.TenantContext, unit uuid.UUID) error {
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	var archived bool
	err = pool.QueryRow(ctx, `select archived_at is not null from org.units where id = $1`, unit).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return kit.Invalid(textUnknownUnit)
	}
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	err = s.Authz.Permit(ctx, tc, actionManage, authz.Resource{Unit: unit, ReadAction: actionUnitsRead})
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return kit.Invalid(textUnknownUnit)
	case err != nil:
		return err
	case archived:
		return kit.Invalid(textUnitArchived)
	}
	return nil
}
