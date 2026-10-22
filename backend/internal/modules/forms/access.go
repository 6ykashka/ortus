package forms

import (
	"context"
	"maps"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// req is one operation of a member: its transaction, the instant and what the operation reads once (the grants, the
// paths of units, the memberships, the names, the modules, the objects seen).
type req struct {
	s   *Service
	tc  tenantctx.TenantContext
	tx  pgx.Tx
	now time.Time

	grants  []authz.Grant
	loaded  bool
	paths   map[uuid.UUID][]uuid.UUID
	members map[uuid.UUID]Membership
	names   map[uuid.UUID]string
	active  map[string]bool
	seen    map[fapi.ObjectRef]string // labels of the objects the member sees ("" — not seen)
	gone    map[fapi.ObjectRef]bool   // the trips asked whether they exist: true — no row in the tenant
	events  []pendingNotice
	undo    []func(context.Context) // what to undo outside the transaction when it fails
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

// canIn reports whether the member holds action in the area unit (nil — the whole organization) — Q-W4.05-4: the
// owner; a grant of the organization; a grant of the unit (with its subtree when include_descendants); a form of the
// whole organization is seen and answered (forms.read) with a grant of any unit.
func (r *req) canIn(ctx context.Context, unit *uuid.UUID, action string) (bool, error) {
	if r.tc.Owner {
		return true, nil
	}
	if err := r.subject(ctx); err != nil {
		return false, err
	}
	var path []uuid.UUID
	if unit != nil {
		p, err := r.path(ctx, *unit)
		if err != nil {
			return false, err
		}
		path = p
	}
	return slices.ContainsFunc(r.grants, func(g authz.Grant) bool { return covers(g, unit, path, action) }), nil
}

// covers reports whether grant g gives action in the area unit with its ancestors path.
func covers(g authz.Grant, unit *uuid.UUID, path []uuid.UUID, action string) bool {
	switch {
	case !g.Has(action):
		return false
	case g.Scope.Kind == authz.KindTenant:
		return true
	case g.Scope.Kind != authz.KindUnit:
		return false
	case unit == nil:
		return action == actRead
	}
	return g.Scope.Ref == *unit || (g.Scope.Descendants && slices.Contains(path, g.Scope.Ref))
}

// can reports whether the member holds action in the area of f.
func (r *req) can(ctx context.Context, f *formRow, action string) (bool, error) {
	return r.canIn(ctx, f.unit, action)
}

// need requires action in the area of f: 403 with the label of the right otherwise.
func (r *req) need(ctx context.Context, f *formRow, action string) error {
	ok, err := r.can(ctx, f, action)
	if err != nil || ok {
		return err
	}
	return forbidden(need[action])
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

// visible reports whether the member sees f (forms.read in its area).
func (r *req) visible(ctx context.Context, f *formRow) (bool, error) { return r.can(ctx, f, actRead) }

// sees reports whether the member reads response x of f (Q-W4.00-forms-9): forms.responses.read in the area of the
// form — every response; with the key anywhere — his own and those about an object he sees, and, as MSW sees
// (msw/forms/state.ts «рейс сида, которого нет, — fleet.trips.read»), those about a trip that does not exist with
// fleet.trips.read anywhere (W4.21 return 4: R-0988 and R-1012 of the seed are about the past trips Р-171 and Р-196 of
// the prototype, Q-W4.21-17).
func (r *req) sees(ctx context.Context, f *formRow, x *responseRow) (bool, error) {
	if ok, err := r.can(ctx, f, actRespRead); err != nil || ok {
		return ok, err
	}
	if ok, err := r.anywhere(ctx, actRespRead); err != nil || !ok {
		return false, err
	}
	if x.author != nil && *x.author == r.me() {
		return true, nil
	}
	if x.subject == nil {
		return false, nil
	}
	label, err := r.objectLabel(ctx, x.subject.Ref)
	if err != nil || label != "" {
		return label != "", err
	}
	return r.pastTrip(ctx, x.subject.Ref)
}

// actTripsRead is the right that shows a response about a trip that does not exist (sees).
const actTripsRead = "fleet.trips.read"

// pastTrip reports whether ref is a trip with no row in the tenant and the member holds fleet.trips.read anywhere.
func (r *req) pastTrip(ctx context.Context, ref fapi.ObjectRef) (bool, error) {
	if ref.ModuleKey != moduleFleet || ref.EntityType != "trip" || r.s.Objects == nil {
		return false, nil
	}
	if ok, err := r.anywhere(ctx, actTripsRead); err != nil || !ok {
		return false, err
	}
	if gone, ok := r.gone[ref]; ok {
		return gone, nil
	}
	missing, err := r.s.Objects.Missing(ctx, r.tc, []fapi.ObjectRef{ref})
	if err != nil {
		return false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if r.gone == nil {
		r.gone = map[fapi.ObjectRef]bool{}
	}
	r.gone[ref] = slices.Contains(missing, ref)
	return r.gone[ref], nil
}

// mayReview is the right of a field of reviewFormResponse (Q-W4.05-16): the key in the area of the form; or the
// member is the assignee and holds the key in any role; or the form of the whole organization, the key in any role and
// the response seen by the relation to its object.
func (r *req) mayReview(ctx context.Context, f *formRow, x *responseRow, action string) (bool, error) {
	if ok, err := r.can(ctx, f, action); err != nil || ok {
		return ok, err
	}
	if ok, err := r.anywhere(ctx, action); err != nil || !ok {
		return false, err
	}
	if x.assignee != nil && *x.assignee == r.me() {
		return true, nil
	}
	if f.unit != nil {
		return false, nil
	}
	return r.sees(ctx, f, x)
}

// objectLabel is the label of an object the member sees ("" — not seen or missing): fleet and tasks through the port.
func (r *req) objectLabel(ctx context.Context, ref fapi.ObjectRef) (string, error) {
	if label, ok := r.seen[ref]; ok {
		return label, nil
	}
	if err := r.lookObjects(ctx, []fapi.ObjectRef{ref}); err != nil {
		return "", err
	}
	return r.seen[ref], nil
}

// lookObjects asks the port once for the objects of refs not asked yet.
func (r *req) lookObjects(ctx context.Context, refs []fapi.ObjectRef) error {
	if r.seen == nil {
		r.seen = map[fapi.ObjectRef]string{}
	}
	var ask []fapi.ObjectRef
	for _, x := range refs {
		if _, ok := r.seen[x]; !ok && !slices.Contains(ask, x) {
			ask = append(ask, x)
		}
	}
	if len(ask) == 0 {
		return nil
	}
	for _, x := range ask {
		r.seen[x] = ""
	}
	if r.s.Objects == nil {
		return nil
	}
	labels, err := r.s.Objects.Labels(ctx, r.tc, ask)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	maps.Copy(r.seen, labels)
	return nil
}

// memberships are the memberships of the people of the tenant (the control DB); without a directory the requesting
// member is the only active one.
func (r *req) memberships(ctx context.Context) (map[uuid.UUID]Membership, error) {
	if r.members != nil {
		return r.members, nil
	}
	out := map[uuid.UUID]Membership{}
	if r.s.Directory != nil {
		ms, err := r.s.Directory.Memberships(ctx, r.tc.TenantID)
		if err != nil {
			return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		out = ms
	}
	if r.me() != uuid.Nil {
		out[r.me()] = Membership{Status: statusActive, Owner: r.tc.Owner}
	}
	r.members = out
	return out, nil
}

// statusActive is the status of an active membership.
const statusActive = "active"

// active reports whether person is an active member.
func (r *req) activeMember(ctx context.Context, person uuid.UUID) (Membership, bool, error) {
	ms, err := r.memberships(ctx)
	if err != nil {
		return Membership{}, false, err
	}
	m, ok := ms[person]
	return m, ok && m.Status == statusActive, nil
}

// owners are the active owners of the business (the notices of the prototype owners()).
func (r *req) owners(ctx context.Context) ([]uuid.UUID, error) {
	ms, err := r.memberships(ctx)
	if err != nil {
		return nil, err
	}
	var out []uuid.UUID
	for id, m := range ms {
		if m.Owner && m.Status == statusActive {
			out = append(out, id)
		}
	}
	slices.SortFunc(out, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return out, nil
}

// moduleActive reports whether the module key is active in the tenant (an installation enabled): a template of it is
// available and a form of it accepts responses (Q-W4.00-forms-16).
func (r *req) moduleActive(ctx context.Context, key string) (bool, error) {
	if r.active == nil {
		rows, err := r.tx.Query(ctx, `select module_key from modules.installations where state = 'enabled'`)
		if err != nil {
			return false, store("modules", err)
		}
		keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return false, store("modules", err)
		}
		r.active = map[string]bool{}
		for _, k := range keys {
			if c, ok := synonyms[k]; ok {
				k = c
			}
			r.active[k] = true
		}
	}
	return r.active[key], nil
}

// synonyms are the keys of the catalogue stored for the modules of the contract (modulesreg: logistics — fleet, repair
// — repairs; the seed and the isolation fixtures store logistics).
var synonyms = map[string]string{"logistics": moduleFleet, "repair": moduleRepairs}

// nameOf is the full name of a person ("—" — unknown); names are read in one query per request and kept.
func (r *req) nameOf(ctx context.Context, id *uuid.UUID) (string, error) {
	if id == nil || *id == uuid.Nil {
		return textNobody, nil
	}
	if n, ok := r.names[*id]; ok {
		return n, nil
	}
	if err := r.loadNames(ctx, []uuid.UUID{*id}); err != nil {
		return "", err
	}
	if n, ok := r.names[*id]; ok {
		return n, nil
	}
	return textNobody, nil
}

// loadNames reads the full names of ids not read yet.
func (r *req) loadNames(ctx context.Context, ids []uuid.UUID) error {
	if r.names == nil {
		r.names = map[uuid.UUID]string{}
	}
	var ask []uuid.UUID
	for _, id := range ids {
		if _, ok := r.names[id]; !ok && id != uuid.Nil {
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

// textNobody is the name of an unknown person.
const textNobody = "—"
