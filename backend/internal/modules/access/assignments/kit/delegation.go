package kit

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ActionAssign is the permission to give and take roles (roles.assign: «делегирует только то, что имеет сам»).
const ActionAssign = "roles.assign"

// DetailDelegation is the default detail of delegation_exceeds_grant.
const DetailDelegation = "Нельзя выдать больше, чем есть у вас: нет права назначать эту роль в этой области."

// Targets returns the resources an assignment scoped s reaches, which the assigning actor must cover (AUTH-08):
// the tenant — the zero resource (only grants of the whole tenant reach it); a unit — the unit and, with
// descendants, every unit of its subtree; self — the anchor (home unit of the principal; uuid.Nil — tenant-wide);
// an object — the object (PD-53: only the same object, or a grant of the whole tenant, covers it).
func Targets(ctx context.Context, q DB, s authz.Scope, anchor uuid.UUID) ([]authz.Resource, error) {
	switch s.Kind {
	case authz.KindTenant:
		return []authz.Resource{{}}, nil
	case authz.KindSelf:
		if anchor == uuid.Nil {
			return []authz.Resource{{}}, nil
		}
		return []authz.Resource{{Unit: anchor}}, nil
	case authz.KindUnit:
		if !s.Descendants {
			return []authz.Resource{{Unit: s.Ref}}, nil
		}
		rows, err := q.Query(ctx, `select descendant_id from org.unit_closure where ancestor_id = $1 order by depth, descendant_id`, s.Ref)
		if err != nil {
			return nil, Store("subtree", err)
		}
		units, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return nil, Store("subtree", err)
		}
		out := []authz.Resource{{Unit: s.Ref}}
		for _, u := range units {
			if u != s.Ref {
				out = append(out, authz.Resource{Unit: u})
			}
		}
		return out, nil
	}
	return []authz.Resource{{Objects: map[string]uuid.UUID{s.Kind: s.Ref}}}, nil
}

// Delegate requires that the actor of tc may assign roles over every target and holds every action there: the owner
// passes; any refusal of the evaluator is 409 delegation_exceeds_grant with detail ("" — DetailDelegation).
func Delegate(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, actions []string, targets []authz.Resource, detail string) error {
	if detail == "" {
		detail = DetailDelegation
	}
	return Cover(ctx, ev, tc, append([]string{ActionAssign}, actions...), targets, detail)
}

// Cover requires that the actor of tc holds every action over every target (AUTH-08: a member hands out only the
// rights and the scopes it has): the owner passes; a refusal of the evaluator is 409 delegation_exceeds_grant with
// detail.
func Cover(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, actions []string, targets []authz.Resource, detail string) error {
	if tc.Owner {
		return nil
	}
	for _, t := range targets {
		for _, a := range actions {
			err := ev.Permit(ctx, tc, a, t)
			switch {
			case err == nil:
			case Denied(err):
				return Conflict(CodeDelegation, detail)
			default:
				return err
			}
		}
	}
	return nil
}

// Reach returns the resources a grant of scope s given to people reaches, which the assigning actor must cover:
// Targets of s over anchor and, for a self scope, the home unit of each of people too — a self grant acts on every
// person it reaches (each member of a group in its own unit), not only on the anchor of the principal.
func Reach(ctx context.Context, q DB, s authz.Scope, anchor uuid.UUID, people []uuid.UUID) ([]authz.Resource, error) {
	targets, err := Targets(ctx, q, s, anchor)
	if err != nil || s.Kind != authz.KindSelf || len(people) == 0 {
		return targets, err
	}
	rows, err := q.Query(ctx, `select distinct coalesce(home_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
		from people.person_profiles where id = any($1) order by 1`, people)
	if err != nil {
		return nil, Store("homes", err)
	}
	homes, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, Store("homes", err)
	}
	for _, h := range homes {
		targets = append(targets, authz.Resource{Unit: h})
	}
	return distinct(targets), nil
}

// RoleReach returns the resources the live (not revoked, not ended) assignments of role reach — Reach of each scope
// over its anchor and the people of its principal — without repeats: a right added to the role works there for its
// holders at once.
func RoleReach(ctx context.Context, q DB, role uuid.UUID, now time.Time) ([]authz.Resource, error) {
	rows, err := q.Query(ctx, `select ra.scope_kind, ra.scope_ref, ra.include_descendants,
		       coalesce(`+Anchor("ra")+`, '00000000-0000-0000-0000-000000000000'::uuid),
		       case when ra.principal_kind = 'person' then array[ra.principal_id]
		            else array(select gm.person_id from access.group_members gm where gm.group_id = ra.principal_id) end
		  from access.role_assignments ra
		 where ra.role_id = $1 and ra.state <> 'revoked' and (upper_inf(ra.valid) or upper(ra.valid) > $2)
		 order by ra.created_at, ra.id`, role, now)
	if err != nil {
		return nil, Store("role reach", err)
	}
	type held struct {
		scope  authz.Scope
		anchor uuid.UUID
		people []uuid.UUID
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (held, error) {
		var (
			h   held
			ref *uuid.UUID
		)
		err := r.Scan(&h.scope.Kind, &ref, &h.scope.Descendants, &h.anchor, &h.people)
		if ref != nil {
			h.scope.Ref = *ref
		}
		return h, err
	})
	if err != nil {
		return nil, Store("role reach", err)
	}
	var out []authz.Resource
	for _, h := range list {
		targets, err := Reach(ctx, q, h.scope, h.anchor, h.people)
		if err != nil {
			return nil, err
		}
		out = append(out, targets...)
	}
	return distinct(out), nil
}

// distinct drops repeated resources, keeping the first of each.
func distinct(in []authz.Resource) []authz.Resource {
	out := make([]authz.Resource, 0, len(in))
	seen := map[string]bool{}
	for _, r := range in {
		var b strings.Builder
		b.WriteString(r.Unit.String())
		for kind, id := range r.Objects {
			b.WriteString("|" + kind + "=" + id.String())
		}
		if k := b.String(); !seen[k] {
			seen[k] = true
			out = append(out, r)
		}
	}
	return out
}

// Covers reports whether the actor of tc may apply action to a unit (uuid.Nil: the whole tenant — only a grant of
// the tenant or ownership covers it). A refusal is false, a failure an error.
func Covers(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, action string, unit uuid.UUID) (bool, error) {
	err := ev.Permit(ctx, tc, action, authz.Resource{Unit: unit})
	switch {
	case err == nil:
		return true, nil
	case Denied(err):
		return false, nil
	}
	return false, err
}

// Anchor returns the SQL expression of the unit an assignment of alias (access.role_assignments) is seen through:
// the unit of a unit scope; null (the tenant) for a tenant scope; the home unit of its principal — a person or a
// group (null: a tenant-wide group) — for self and object scopes. A grant over the anchor shows the assignment.
func Anchor(alias string) string {
	return strings.NewReplacer("ra.", alias+".").Replace(`case
	when ra.scope_kind = 'unit' then ra.scope_ref
	when ra.scope_kind = 'tenant' then null::uuid
	when ra.principal_kind = 'person' then (select p.home_unit_id from people.person_profiles p where p.id = ra.principal_id)
	else (select g.home_unit_id from access.groups g where g.id = ra.principal_id) end`)
}

// HomeUnit returns the home unit of a live person card, or of a live group (uuid.Nil: tenant-wide); not found is
// 404 not_found.
func HomeUnit(ctx context.Context, q DB, group bool, id uuid.UUID) (uuid.UUID, error) {
	sql := `select home_unit_id from people.person_profiles where id = $1 and archived_at is null`
	if group {
		sql = `select coalesce(home_unit_id, '00000000-0000-0000-0000-000000000000'::uuid) from access.groups where id = $1 and archived_at is null`
	}
	var home uuid.UUID
	err := q.QueryRow(ctx, sql, id).Scan(&home)
	switch {
	case err == nil:
		return home, nil
	case NoRows(err):
		return uuid.Nil, NotFound()
	}
	return uuid.Nil, Store(fmt.Sprintf("home unit of %s", id), err)
}

// UnitExists reports whether a live org unit exists (404 not_found otherwise).
func UnitExists(ctx context.Context, q DB, unit uuid.UUID) error {
	var ok bool
	if err := q.QueryRow(ctx, `select exists (select 1 from org.units where id = $1 and archived_at is null)`, unit).Scan(&ok); err != nil {
		return Store("unit", err)
	}
	if !ok {
		return NotFound()
	}
	return nil
}

// NoRows reports whether err is the «no row» of pgx.
func NoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
