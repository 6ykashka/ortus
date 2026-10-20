package authz

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// PGSource reads subjects, installed modules and unit ancestors from the tenant DB of a request (role ortus_api).
// Periods are compared with the moment passed by the evaluator (the clock of the application), never with now()
// of the database.
type PGSource struct{ Pools Pools }

var (
	_ Source      = PGSource{}
	_ UnitTree    = PGSource{}
	_ GroupSource = PGSource{}
)

// grantsSQL: active assignments of live roles at $2, of the person ($1) directly and through groups, with the
// actions of the assigned role version.
const grantsSQL = `
select ra.id, ra.role_id, case when ra.principal_kind = 'group' then ra.principal_id end,
       rv.actions, ra.scope_kind, ra.scope_ref, ra.include_descendants, lower(ra.valid), upper(ra.valid)
  from access.role_assignments ra
  join access.roles r on r.id = ra.role_id and r.archived_at is null
  join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
 where ra.state = 'active' and ra.valid @> $2::timestamptz
   and ((ra.principal_kind = 'person' and ra.principal_id = $1)
     or (ra.principal_kind = 'group'
         and ra.principal_id in (select group_id from access.group_members where person_id = $1)))
 order by ra.created_at, ra.id`

// functionsSQL: work functions of the person active at $2 (AUTH-05).
const functionsSQL = `
select distinct function from people.work_profiles where person_id = $1 and valid @> $2::timestamptz order by 1`

func (s PGSource) pool(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error) {
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return pool, nil
}

// Subject implements Source.
func (s PGSource) Subject(ctx context.Context, tc tenantctx.TenantContext, at time.Time, grants bool) (Subject, error) {
	pool, err := s.pool(ctx, tc.TenantID)
	if err != nil {
		return Subject{}, err
	}
	return TxSource{Q: pool}.Subject(ctx, tc, at, grants)
}

func queryGrants(ctx context.Context, q Querier, person uuid.UUID, at time.Time) ([]Grant, error) {
	rows, err := q.Query(ctx, grantsSQL, person, at)
	if err != nil {
		return nil, fmt.Errorf("grants: %w", err)
	}
	out, err := pgx.CollectRows(rows, scanGrant)
	if err != nil {
		return nil, fmt.Errorf("grants: %w", err)
	}
	return out, nil
}

func scanGrant(row pgx.CollectableRow) (Grant, error) {
	var (
		g          Grant
		group, ref *uuid.UUID
		from       *time.Time
	)
	err := row.Scan(&g.AssignmentID, &g.RoleID, &group, &g.Actions, &g.Scope.Kind, &ref, &g.Scope.Descendants, &from, &g.Until)
	if group != nil {
		g.Group = *group
	}
	if ref != nil {
		g.Scope.Ref = *ref
	}
	if from != nil {
		g.From = *from
	}
	return g, err
}

// InstalledModules implements Source.
func (s PGSource) InstalledModules(ctx context.Context, tc tenantctx.TenantContext) ([]string, error) {
	pool, err := s.pool(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	return TxSource{Q: pool}.InstalledModules(ctx, tc)
}

// Ancestors implements UnitTree: the unit and its ancestors from the nearest; a unit the closure does not know
// is only itself.
func (s PGSource) Ancestors(ctx context.Context, tenantID, unit uuid.UUID) ([]uuid.UUID, error) {
	pool, err := s.pool(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return TxSource{Q: pool}.Ancestors(ctx, tenantID, unit)
}

// Groups implements GroupSource.
func (s PGSource) Groups(ctx context.Context, tenantID, person uuid.UUID) ([]uuid.UUID, error) {
	pool, err := s.pool(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return TxSource{Q: pool}.Groups(ctx, tenantID, person)
}

// Querier runs the reads of a source: a pool, a connection or a transaction of the tenant DB.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// TxSource is PGSource over one querier of the tenant DB of a request, usually the transaction of a command that
// checks access under its own locks (W1.47, Q-W1.41-9): its reads take no other connection of the pool — a second
// connection taken while the command holds access.policy_state deadlocks a full pool — and see what the transaction
// sees, its own uncommitted writes included. Q must be the DB of the tenant of the request: the tenant of tc and
// tenantID are not checked again.
type TxSource struct{ Q Querier }

var (
	_ Source      = TxSource{}
	_ UnitTree    = TxSource{}
	_ GroupSource = TxSource{}
)

// Subject implements Source.
func (s TxSource) Subject(ctx context.Context, tc tenantctx.TenantContext, at time.Time, grants bool) (Subject, error) {
	sub := Subject{TenantID: tc.TenantID, PersonID: tc.PersonID, Owner: tc.Owner}
	var err error
	if sub.Functions, err = queryList[string](ctx, s.Q, functionsSQL, tc.PersonID, at); err != nil {
		return Subject{}, fmt.Errorf("work functions: %w", err)
	}
	if grants {
		if sub.Grants, err = queryGrants(ctx, s.Q, tc.PersonID, at); err != nil {
			return Subject{}, err
		}
	}
	return sub, nil
}

// InstalledModules implements Source.
func (s TxSource) InstalledModules(ctx context.Context, _ tenantctx.TenantContext) ([]string, error) {
	keys, err := queryList[string](ctx, s.Q,
		`select module_key from modules.installations where state in ('enabled', 'draining', 'read_only') order by 1`)
	if err != nil {
		return nil, fmt.Errorf("installed modules: %w", err)
	}
	return keys, nil
}

// Ancestors implements UnitTree (see PGSource.Ancestors).
func (s TxSource) Ancestors(ctx context.Context, _, unit uuid.UUID) ([]uuid.UUID, error) {
	path, err := queryList[uuid.UUID](ctx, s.Q,
		`select ancestor_id from org.unit_closure where descendant_id = $1 order by depth`, unit)
	if err != nil {
		return nil, fmt.Errorf("unit ancestors: %w", err)
	}
	if len(path) == 0 {
		return []uuid.UUID{unit}, nil
	}
	return path, nil
}

// Groups implements GroupSource: the live (not archived) groups of person, read only when an access list names a
// group.
func (s TxSource) Groups(ctx context.Context, _, person uuid.UUID) ([]uuid.UUID, error) {
	groups, err := queryList[uuid.UUID](ctx, s.Q, `select gm.group_id from access.group_members gm
		join access.groups g on g.id = gm.group_id and g.archived_at is null
	 where gm.person_id = $1 order by 1`, person)
	if err != nil {
		return nil, fmt.Errorf("groups: %w", err)
	}
	return groups, nil
}

// queryList returns the single column of every row.
func queryList[T any](ctx context.Context, q Querier, sql string, args ...any) ([]T, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[T])
	if len(out) == 0 {
		out = nil
	}
	return out, err
}
