package tasks

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Membership is what the module needs of the membership of a person in the control DB: its status (invited, active,
// suspended, ended) and an active owner binding.
type Membership struct {
	Status string
	Owner  bool
}

// Directory reads the memberships of the people of a tenant from the control DB, by person profile id.
type Directory interface {
	Memberships(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]Membership, error)
}

// Service answers the operations of the tag Tasks.
type Service struct {
	Pools     Pools
	Authz     *authz.Evaluator
	Directory Directory        // nil: the requesting member is the only active member known
	Audience  inbox.Audience   // the audience of the notices to the owners; nil — no notices
	Now       func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// request is one operation of a member: its transaction, the evaluator reading through it with the clock frozen at
// the start and the caches of what the operation reads.
type request struct {
	s   *Service
	tc  tenantctx.TenantContext
	tx  pgx.Tx
	ev  *authz.Evaluator
	now time.Time

	people       map[uuid.UUID]*member
	self         *member              // the requesting member alone, before people are read (self)
	memberStatus map[uuid.UUID]string // the status of the membership of a person ("" — none)
	unitName     map[uuid.UUID]string
	paths        map[uuid.UUID][]uuid.UUID
	projects     []*project
	versions     map[versionKey]*version
	mine         map[uuid.UUID]*access
	notices      []notice
	seq          int  // rows written by the request (tick)
	firing       bool // a rule of automation is running (depth 1)
}

type versionKey struct {
	project uuid.UUID
	number  int
}

// run runs fn in one transaction of the tenant DB of tc (read only unless write) with the evaluator over it; an error
// rolls it back, a Problem error or a failure keeps its code and anything else is dependency_unavailable.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*request) error) error {
	if tc.TenantID == uuid.Nil {
		return problem.New(codeNotFound, "")
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	opts := pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	if write {
		opts = pgx.TxOptions{}
	}
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := s.request(tc, tx)
	if err := fn(r); err != nil {
		return dependency(err)
	}
	if err := r.flushNotices(ctx); err != nil {
		return dependency(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dependency(err)
	}
	return nil
}

// request returns a request of tc over tx.
func (s *Service) request(tc tenantctx.TenantContext, tx pgx.Tx) *request {
	now := s.now()
	return &request{s: s, tc: tc, tx: tx, ev: s.within(tx, now), now: now, versions: map[versionKey]*version{},
		mine: map[uuid.UUID]*access{}, paths: map[uuid.UUID][]uuid.UUID{}}
}

// within is the evaluator of s reading through q with the clock frozen at now (W1.47) and the reads of a limited
// project registered (the module owns the container; cmd/api registers the same).
func (s *Service) within(q authz.Querier, now time.Time) *authz.Evaluator {
	if s.Authz == nil {
		return nil
	}
	cp := *s.Authz
	src := authz.TxSource{Q: q}
	cp.Now = func() time.Time { return now }
	cp.Source = src
	if s.Authz.Units != nil {
		cp.Units = src
	}
	cp.Places = nil // the module places its rows itself (Columns.Container); a resolver would take another connection
	if len(cp.ContainerReads[authz.KindProject]) == 0 {
		reads := maps.Clone(s.Authz.ContainerReads)
		if reads == nil {
			reads = map[string][]string{}
		}
		reads[authz.KindProject] = ContainerReads()
		cp.ContainerReads = reads
	}
	return &cp
}

// dependency keeps a failure or a Problem error and reports anything else as dependency_unavailable.
func dependency(err error) error {
	if _, ok := asFailure(err); ok {
		return err
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// store wraps a failure of a statement of the module.
func store(what string, err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("tasks: %s: %w", what, err)
}

func noRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// ---------------------------------------------------------------------------------------------------------------------
// People and their grants.

// grantsAllSQL: the active assignments at $1 of live roles of every person, directly or through a group (the source
// of the evaluator, PGSource), with the names of the role and the group.
const grantsAllSQL = `
select x.person_id, ra.id, ra.role_id, r.name, coalesce(r.template_key, ''),
       case when ra.principal_kind = 'group' then ra.principal_id end, coalesce(g.name, ''),
       rv.actions, ra.scope_kind, ra.scope_ref, ra.include_descendants
  from access.role_assignments ra
  join access.roles r on r.id = ra.role_id and r.archived_at is null
  join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
  left join access.groups g on ra.principal_kind = 'group' and g.id = ra.principal_id
  join lateral (
        select ra.principal_id as person_id where ra.principal_kind = 'person'
        union all
        select gm.person_id from access.group_members gm where ra.principal_kind = 'group' and gm.group_id = ra.principal_id
       ) x on true
 where ra.state = 'active' and ra.valid @> $1::timestamptz
 order by ra.created_at, ra.id`

// loadPeople reads every live person of the tenant with its grants, its driver function and its membership.
func (r *request) loadPeople(ctx context.Context) error {
	if r.people != nil {
		return nil
	}
	rows, err := r.tx.Query(ctx, `select id, full_name, membership_id is not null from people.person_profiles where archived_at is null`)
	if err != nil {
		return store("people", err)
	}
	people := map[uuid.UUID]*member{}
	accounts := map[uuid.UUID]bool{}
	for rows.Next() {
		var (
			m       member
			account bool
		)
		if err := rows.Scan(&m.ID, &m.Name, &account); err != nil {
			rows.Close()
			return store("people", err)
		}
		accounts[m.ID] = account
		people[m.ID] = &m
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("people", err)
	}
	if err := r.loadGrants(ctx, people); err != nil {
		return err
	}
	drivers, err := collect[uuid.UUID](ctx, r.tx, `select distinct person_id from people.work_profiles
		where function = 'driver' and valid @> $1::timestamptz`, r.now)
	if err != nil {
		return store("work functions", err)
	}
	for _, id := range drivers {
		if m := people[id]; m != nil {
			m.Driver = true
		}
	}
	if err := r.memberships(ctx, people, accounts); err != nil {
		return err
	}
	r.people = people
	return nil
}

// grantsOfSQL is grantsAllSQL of one person ($2).
var grantsOfSQL = strings.Replace(grantsAllSQL, " where ra.state = 'active'", " where x.person_id = $2 and ra.state = 'active'", 1)

func (r *request) loadGrants(ctx context.Context, people map[uuid.UUID]*member) error {
	return r.scanGrants(ctx, people, grantsAllSQL, r.now)
}

// scanGrants adds the grants of the query sql to people.
func (r *request) scanGrants(ctx context.Context, people map[uuid.UUID]*member, sql string, args ...any) error {
	rows, err := r.tx.Query(ctx, sql, args...)
	if err != nil {
		return store("grants", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			person     uuid.UUID
			g          grant
			group, ref *uuid.UUID
		)
		if err := rows.Scan(&person, &g.Assignment, &g.Role, &g.RoleName, &g.Template, &group, &g.GroupName, &g.Actions,
			&g.Kind, &ref, &g.Descendants); err != nil {
			return store("grants", err)
		}
		if group != nil {
			g.Group = *group
		}
		if ref != nil {
			g.Ref = *ref
		}
		if m := people[person]; m != nil {
			m.Grants = append(m.Grants, g)
		}
	}
	return store("grants", rows.Err())
}

// memberships marks the active members and the owners: the control DB through the directory; without one, every
// person with an account is active and the requesting member keeps the owner binding of its context.
func (r *request) memberships(ctx context.Context, people map[uuid.UUID]*member, accounts map[uuid.UUID]bool) error {
	r.memberStatus = map[uuid.UUID]string{}
	if r.s.Directory == nil {
		for id, m := range people {
			if m.Active = accounts[id]; m.Active {
				r.memberStatus[id] = statusActive
			}
		}
	} else {
		ms, err := r.s.Directory.Memberships(ctx, r.tc.TenantID)
		if err != nil {
			return problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		for id, m := range people {
			if x, ok := ms[id]; ok {
				m.Active, m.Owner = x.Status == statusActive, x.Owner
				r.memberStatus[id] = x.Status
			}
		}
	}
	if m := people[r.tc.PersonID]; m != nil { // the gateway resolved the requester: an active member
		m.Active, m.Owner = true, r.tc.Owner
		r.memberStatus[m.ID] = statusActive
	}
	return nil
}

// statusActive is the status of an active membership (control DB memberships.status).
const statusActive = "active"

// me is the requesting member (with no person, as the worker — an inactive nobody).
func (r *request) me(ctx context.Context) (*member, error) {
	if err := r.loadPeople(ctx); err != nil {
		return nil, err
	}
	if m := r.people[r.tc.PersonID]; m != nil {
		return m, nil
	}
	return &member{ID: r.tc.PersonID, Active: r.tc.PersonID != uuid.Nil, Owner: r.tc.Owner}, nil
}

// requester is the requesting member alone — its grants and function, the membership of its context — without the
// people of the tenant and the directory: the access of a request to a project needs no more, so a project or a task
// the member does not see answers 404 as fast as an unknown id (AC-01).
func (r *request) requester(ctx context.Context) (*member, error) {
	switch {
	case r.people != nil:
		return r.me(ctx)
	case r.self != nil:
		return r.self, nil
	}
	m := &member{ID: r.tc.PersonID, Active: r.tc.PersonID != uuid.Nil, Owner: r.tc.Owner}
	if m.ID != uuid.Nil {
		err := r.tx.QueryRow(ctx, `select full_name, exists (select 1 from people.work_profiles w where w.person_id = p.id
			and w.function = 'driver' and w.valid @> $2::timestamptz) from people.person_profiles p where p.id = $1`,
			m.ID, r.now).Scan(&m.Name, &m.Driver)
		if err != nil && !noRows(err) {
			return nil, store("requester", err)
		}
		if err := r.scanGrants(ctx, map[uuid.UUID]*member{m.ID: m}, grantsOfSQL, r.now, m.ID); err != nil {
			return nil, err
		}
	}
	r.self = m
	return m, nil
}

// person returns a person of the tenant (nil — unknown).
func (r *request) person(ctx context.Context, id uuid.UUID) (*member, error) {
	if r.people == nil { // an unknown id answers without reading the people of the tenant (AC-01)
		var known bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from people.person_profiles where id = $1 and archived_at is null)`,
			id).Scan(&known); err != nil {
			return nil, store("person", err)
		}
		if !known {
			return nil, nil
		}
	}
	if err := r.loadPeople(ctx); err != nil {
		return nil, err
	}
	return r.people[id], nil
}

// nameOf is the display name of a person, «—» for an unknown one.
func (r *request) nameOf(ctx context.Context, id *uuid.UUID) string {
	if id == nil {
		return unknownName
	}
	if m, err := r.person(ctx, *id); err == nil && m != nil {
		return m.Name
	}
	return unknownName
}

// owners are the active owners of the organization (the notices of the prototype owners()).
func (r *request) owners(ctx context.Context) ([]uuid.UUID, error) {
	if err := r.loadPeople(ctx); err != nil {
		return nil, err
	}
	var out []uuid.UUID
	for id, m := range r.people {
		if m.Owner && m.Active {
			out = append(out, id)
		}
	}
	slices.SortFunc(out, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return out, nil
}

// ---------------------------------------------------------------------------------------------------------------------
// Units.

func (r *request) loadUnits(ctx context.Context) error {
	if r.unitName != nil {
		return nil
	}
	rows, err := r.tx.Query(ctx, `select id, name from org.units`)
	if err != nil {
		return store("units", err)
	}
	defer rows.Close()
	names := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			id   uuid.UUID
			name string
		)
		if err := rows.Scan(&id, &name); err != nil {
			return store("units", err)
		}
		names[id] = name
	}
	if err := rows.Err(); err != nil {
		return store("units", err)
	}
	r.unitName = names
	return nil
}

// unitPath is the unit and its ancestors from the nearest (org.unit_closure), nil for the whole organization.
func (r *request) unitPath(ctx context.Context, unit *uuid.UUID) ([]uuid.UUID, error) {
	if unit == nil {
		return nil, nil
	}
	if p, ok := r.paths[*unit]; ok {
		return p, nil
	}
	path, err := collect[uuid.UUID](ctx, r.tx, `select ancestor_id from org.unit_closure where descendant_id = $1 order by depth`, *unit)
	if err != nil {
		return nil, store("unit path", err)
	}
	if len(path) == 0 {
		path = []uuid.UUID{*unit}
	}
	r.paths[*unit] = path
	return path, nil
}

// ---------------------------------------------------------------------------------------------------------------------
// Access.

// scene returns p with its unit path, the names of the units and the people of the tenant.
func (r *request) scene(ctx context.Context, p *project) (*scene, error) {
	if err := r.loadPeople(ctx); err != nil {
		return nil, err
	}
	if err := r.loadUnits(ctx); err != nil {
		return nil, err
	}
	path, err := r.unitPath(ctx, p.Unit)
	if err != nil {
		return nil, err
	}
	return &scene{p: p, path: path, names: r.unitName, people: r.people}, nil
}

// access is projAccess of the requesting member to p (nil — none).
func (r *request) access(ctx context.Context, p *project) (*access, error) {
	if a, ok := r.mine[p.ID]; ok {
		return a, nil
	}
	if err := r.loadUnits(ctx); err != nil {
		return nil, err
	}
	path, err := r.unitPath(ctx, p.Unit)
	if err != nil {
		return nil, err
	}
	me, err := r.requester(ctx)
	if err != nil {
		return nil, err
	}
	a := projAccess(p, me, path, r.unitName)
	r.mine[p.ID] = a
	return a, nil
}

// forget drops what the request knows of the grants (an assignment of the request changed them).
func (r *request) forget() {
	r.people, r.self = nil, nil
	r.mine = map[uuid.UUID]*access{}
}

// need requires action of the requesting member in p: 403 «Нет права «Y» в проекте «X»: причина» of the prototype.
func (r *request) need(ctx context.Context, p *project, action string) (*access, error) {
	if err := r.loadUnits(ctx); err != nil {
		return nil, err
	}
	path, err := r.unitPath(ctx, p.Unit)
	if err != nil {
		return nil, err
	}
	me, err := r.requester(ctx)
	if err != nil {
		return nil, err
	}
	ok, why, a := canIn(p, me, action, path, r.unitName)
	if !ok {
		return nil, forbidden("Нет права «" + verb(action) + "» в проекте «" + p.Name + "»: " + why)
	}
	return a, nil
}

// canTask reports whether the requesting member may apply action to t: in its project, or as its assignee with the
// scope «своё» (x-scope …-self).
func (r *request) canTask(ctx context.Context, p *project, t *task, action string) (bool, error) {
	a, err := r.access(ctx, p)
	if err != nil {
		return false, err
	}
	if a.has(action) {
		return true, nil
	}
	if !t.assignedTo(r.tc.PersonID) {
		return false, nil
	}
	me, err := r.requester(ctx)
	if err != nil {
		return false, err
	}
	return selfGrant(me, action), nil
}

// visible reports whether the requesting member sees t.
func (r *request) visible(ctx context.Context, t *task) (bool, error) {
	if t.Deleted {
		return false, nil
	}
	p, err := r.project(ctx, t.Project)
	if err != nil || p == nil {
		return false, err
	}
	return r.canTask(ctx, p, t, actRead)
}

// needTask requires action on t (in its project or as its assignee): 403 with the reason of the project otherwise.
func (r *request) needTask(ctx context.Context, p *project, t *task, action string) error {
	ok, err := r.canTask(ctx, p, t, action)
	if err != nil || ok {
		return err
	}
	_, err = r.need(ctx, p, action)
	return err
}

// collect runs a query of one column.
func collect[T any](ctx context.Context, q pgx.Tx, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[T])
}
