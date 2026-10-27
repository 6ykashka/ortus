package repairs

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// req is one operation of a member: its transaction, the instant and what the operation reads once (the grants, the
// paths of units, the names).
type req struct {
	s   *Service
	tc  tenantctx.TenantContext
	tx  pgx.Tx
	now time.Time

	grants []authz.Grant
	loaded bool
	paths  map[uuid.UUID][]uuid.UUID
	names  map[uuid.UUID]string
}

// me is the requesting member.
func (r *req) me() uuid.UUID { return r.tc.PersonID }

// subject loads the grants of the requesting member active now (through the transaction, W1.47).
func (r *req) subject(ctx context.Context) error {
	if r.loaded || r.tc.Owner {
		r.loaded = true
		return nil
	}
	sub, err := authz.TxSource{Q: r.tx}.Subject(ctx, r.tc, r.now, true)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	r.grants = slices.DeleteFunc(sub.Grants, func(g authz.Grant) bool { return !g.ActiveAt(r.now) })
	r.loaded = true
	return nil
}

// path is the unit and its ancestors from the nearest (org.unit_closure).
func (r *req) path(ctx context.Context, unit uuid.UUID) ([]uuid.UUID, error) {
	if p, ok := r.paths[unit]; ok {
		return p, nil
	}
	p, err := authz.TxSource{Q: r.tx}.Ancestors(ctx, r.tc.TenantID, unit)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if r.paths == nil {
		r.paths = map[uuid.UUID][]uuid.UUID{}
	}
	r.paths[unit] = p
	return p, nil
}

// covers reports whether grant g gives action on the object p (its unit with the ancestors path): the organization;
// the unit of the object or, with its subtree, a unit above it; the object itself (the scope repair_project); «своё» —
// the objects whose foreman is who. A relation covers nothing: it is computed by the later steps (Q-W4.00-repair-2).
func covers(g authz.Grant, p *projectRow, path []uuid.UUID, who uuid.UUID, action string) bool {
	if !g.Has(action) {
		return false
	}
	switch g.Scope.Kind {
	case authz.KindTenant:
		return true
	case authz.KindUnit:
		return g.Scope.Ref == p.unit || (g.Scope.Descendants && slices.Contains(path, g.Scope.Ref))
	case authz.KindRepairProject:
		return g.Scope.Ref == p.id
	case authz.KindSelf:
		return p.isForeman(who)
	}
	return false
}

// can reports whether the member holds action on the object p: the owner always, else a grant that covers it.
func (r *req) can(ctx context.Context, p *projectRow, action string) (bool, error) {
	if r.tc.Owner {
		return true, nil
	}
	if err := r.subject(ctx); err != nil {
		return false, err
	}
	if !slices.ContainsFunc(r.grants, func(g authz.Grant) bool { return g.Has(action) }) {
		return false, nil
	}
	path, err := r.path(ctx, p.unit)
	if err != nil {
		return false, err
	}
	return slices.ContainsFunc(r.grants, func(g authz.Grant) bool { return covers(g, p, path, r.me(), action) }), nil
}

// anywhere reports whether the member holds action in any of his roles.
func (r *req) anywhere(ctx context.Context, action string) (bool, error) {
	if r.tc.Owner {
		return true, nil
	}
	if err := r.subject(ctx); err != nil {
		return false, err
	}
	return slices.ContainsFunc(r.grants, func(g authz.Grant) bool { return g.Has(action) }), nil
}

// officeActions make a member «the office» of an object: he sees every object of his area, a draft too (the prototype
// view(): office = edit or estimates, supply, catalog); the others see only the objects of which they are the foreman.
var officeActions = []string{actManage, actEstimates, actSupply, actCatalog}

func (r *req) office(ctx context.Context, p *projectRow) (bool, error) {
	for _, a := range officeActions {
		ok, err := r.can(ctx, p, a)
		if err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

// sees reports whether the member reads the object p: projects.read in its area and, outside the office, only the
// object of which he is the foreman and which is not a draft. Hidden objects are as if missing (404).
func (r *req) sees(ctx context.Context, p *projectRow) (bool, error) {
	if ok, err := r.can(ctx, p, actRead); err != nil || !ok {
		return false, err
	}
	if p.status != statusDraft && p.isForeman(r.me()) {
		return true, nil
	}
	return r.office(ctx, p)
}

// need requires action on p: 403 with the text otherwise.
func (r *req) need(ctx context.Context, p *projectRow, action, text string) error {
	ok, err := r.can(ctx, p, action)
	if err != nil || ok {
		return err
	}
	return forbidden(text)
}

// loadNames reads the full names of the people ids not read yet (r.names; "" — unknown), in one query.
func (r *req) loadNames(ctx context.Context, ids []uuid.UUID) error {
	if r.names == nil {
		r.names = map[uuid.UUID]string{}
	}
	var ask []uuid.UUID
	for _, id := range ids {
		if _, ok := r.names[id]; !ok && id != uuid.Nil && !slices.Contains(ask, id) {
			ask = append(ask, id)
		}
	}
	if len(ask) == 0 {
		return nil
	}
	rows, err := r.tx.Query(ctx, `select id, full_name from people.person_profiles where id = any($1)`, ask)
	if err != nil {
		return store("names", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id   uuid.UUID
			name string
		)
		if err := rows.Scan(&id, &name); err != nil {
			return store("names", err)
		}
		r.names[id] = name
	}
	return store("names", rows.Err())
}
