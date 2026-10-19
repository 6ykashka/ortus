package data

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Modules reports the state of the installable modules of a tenant by module key (modulesreg: active, draining,
// read_only, disabled; a module without a row is not installed).
type Modules interface {
	States(ctx context.Context, tenantID uuid.UUID) (map[string]string, error)
}

// Hider names the objects closed to the member of tc whatever his grants say: a spec compares its column with
// HiddenParam to leave them out (W2.57, AC-06: cmd/api wires the driver pool — the trips of the transfers of a
// temporary driver outside his grant).
type Hider interface {
	Hidden(ctx context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error)
}

// Service answers the operations of the tag Data over the datasets of the registry.
type Service struct {
	Pools    scopeddb.Pools  // tenantctx.Pools
	Authz    scopeddb.Scoper // *authz.Evaluator
	Registry *Registry
	Modules  Modules          // nil: no installable module is installed
	Hidden   Hider            // nil: nothing is hidden
	Now      func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
	Timeout  time.Duration    // the longest query; 0 — DefaultTimeout
}

// DefaultTimeout bounds the statements of one query (contract: «Limits query time/rows»).
const DefaultTimeout = 10 * time.Second

// actionExport is the permission of «Выгрузить» (Dataset.exportAllowed).
const actionExport = "data.export"

// exportColumns weigh data.export: it is granted on the tenant or a unit (catalog: «tenant unit»), the statement is
// never run.
var exportColumns = authz.Columns{Unit: "unit_id"}

// sqlFalse is the predicate of the evaluator for an action the member does not hold in any scope.
const sqlFalse = "false"

// openStates are the module states whose datasets exist: an installed module that is not disabled (read_only and
// draining keep the history readable, as the reads of the module).
var openStates = []string{"active", "read_only", "draining"}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Service) timeout() time.Duration {
	if s.Timeout > 0 {
		return s.Timeout
	}
	return DefaultTimeout
}

// Catalog returns the datasets the member of tc may read (listDatasets): those of the open modules whose permission
// the member holds in some scope, in the order of the registry.
func (s *Service) Catalog(ctx context.Context, tc tenantctx.TenantContext) (dataapi.DatasetCatalog, error) {
	out := dataapi.DatasetCatalog{Items: []dataapi.Dataset{}}
	states, err := s.states(ctx, tc.TenantID)
	if err != nil {
		return out, err
	}
	var entries []entry
	for _, e := range s.Registry.all() {
		if slices.Contains(openStates, states[e.module]) {
			entries = append(entries, e)
		}
	}
	if len(entries) == 0 {
		return out, nil
	}
	version, err := s.version(ctx, tc)
	if err != nil {
		return out, err
	}
	export, err := s.holds(ctx, tc, actionExport, exportColumns)
	if err != nil {
		return out, err
	}
	for _, e := range entries {
		v, ok, err := s.resolve(ctx, tc, e, export, version)
		if err != nil {
			return dataapi.DatasetCatalog{}, err
		}
		if ok {
			out.Items = append(out.Items, v.dataset())
		}
	}
	return out, nil
}

// Query runs q over the dataset id for the member of tc (queryDataset): an unknown dataset or one of a closed module is
// 404, a dataset whose permission the member does not hold in any scope — 403; then the query is checked (parse) and
// run over the rows in the scope of the dataset permission.
func (s *Service) Query(ctx context.Context, tc tenantctx.TenantContext, id string, q *dataapi.DatasetQuery) (dataapi.DatasetQueryResult, error) {
	e, ok := s.Registry.lookup(id)
	if !ok {
		return dataapi.DatasetQueryResult{}, problem.New(problem.CodeNotFound, textNotFound)
	}
	states, err := s.states(ctx, tc.TenantID)
	if err != nil {
		return dataapi.DatasetQueryResult{}, err
	}
	if !slices.Contains(openStates, states[e.module]) {
		return dataapi.DatasetQueryResult{}, problem.New(problem.CodeNotFound, textNotFound)
	}
	version, err := s.version(ctx, tc)
	if err != nil {
		return dataapi.DatasetQueryResult{}, err
	}
	v, ok, err := s.resolve(ctx, tc, e, false, version)
	if err != nil {
		return dataapi.DatasetQueryResult{}, err
	}
	if !ok {
		return dataapi.DatasetQueryResult{}, problem.New(problem.CodeForbiddenAction, "")
	}
	p, err := parse(v, q, tc.TenantID.String()+"|"+tc.MembershipID.String())
	if err != nil {
		return dataapi.DatasetQueryResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout())
	defer cancel()
	return s.run(ctx, tc, p)
}

// hidden asks the Hider which ids it closes to the member of tc — a read of the DB, so only for a spec that compares
// with HiddenParam (nil: nothing is hidden).
func (s *Service) hidden(ctx context.Context, tc tenantctx.TenantContext, spec Spec) ([]uuid.UUID, error) {
	if s.Hidden == nil || !spec.hides() {
		return nil, nil
	}
	return s.Hidden.Hidden(ctx, tc)
}

// run executes a checked plan: the page of rows, then visibleCount when asked.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, p plan) (dataapi.DatasetQueryResult, error) {
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	restrict := func(r Restriction, start int) (authz.Predicate, error) {
		return s.Authz.ScopeQuery(ctx, tc, r.Permission, r.Columns, start)
	}
	if p.hidden, err = s.hidden(ctx, tc, p.view.spec); err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	now := s.now()
	spec := p.view.spec
	st, types, err := p.rows(tc.PersonID, now, restrict)
	if err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	rows, err := conn.Query(ctx, spec.Permission, spec.Columns, st.sql, st.args...)
	if err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	page, err := collect(rows, p, types)
	if err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	out := dataapi.DatasetQueryResult{Rows: page, SchemaVersion: p.view.version}
	if len(out.Rows) > p.limit {
		out.Rows = out.Rows[:p.limit]
		if next := p.offset + p.limit; next <= countCap {
			c := encodeCursor(next, p.binding)
			out.NextCursor = &c
		}
	}
	if !p.count {
		return out, nil
	}
	ct, err := p.counted(tc.PersonID, now, restrict)
	if err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	var n int64
	if err := conn.QueryRow(ctx, spec.Permission, spec.Columns, ct.sql, ct.args...).Scan(&n); err != nil {
		return dataapi.DatasetQueryResult{}, dependency(err)
	}
	if n > countCap {
		capped := true
		n, out.VisibleCountCapped = countCap, &capped
	}
	out.VisibleCount = &n
	return out, nil
}

// collect scans the rows of a page: the record id (a group gets «group-N» by its place in the whole selection), then
// the cells in the order of select.
func collect(rows pgx.Rows, p plan, types []ValueType) ([]dataapi.DatasetRow, error) {
	defer rows.Close()
	width := 1
	for _, t := range types {
		width++
		if t == Money {
			width++
		}
	}
	out := []dataapi.DatasetRow{}
	raw := make([]*string, width)
	dest := make([]any, width)
	for i := range raw {
		dest[i] = &raw[i]
	}
	for rows.Next() {
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		row := dataapi.DatasetRow{Cells: make([]dataapi.FieldEntry, 0, len(types))}
		if p.grouped() {
			row.RecordId = "group-" + strconv.Itoa(p.offset+len(out)+1)
		} else if raw[0] != nil {
			row.RecordId = *raw[0]
		}
		at := 1
		for i, t := range types {
			var currency *string
			if t == Money {
				currency = raw[at+1]
			}
			v, err := cell(t, raw[at], currency)
			if err != nil {
				return nil, err
			}
			row.Cells = append(row.Cells, dataapi.FieldEntry{FieldKey: p.selects[i], Value: v})
			at++
			if t == Money {
				at++
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// resolve returns the view of e for the member of tc and whether the member holds the dataset permission in some
// scope; export is data.export of the member, version the permission version of the tenant.
func (s *Service) resolve(ctx context.Context, tc tenantctx.TenantContext, e entry, export bool, version string) (view, bool, error) {
	ok, err := s.holds(ctx, tc, e.spec.Permission, e.spec.Columns)
	if err != nil || !ok {
		return view{}, false, err
	}
	v := view{module: e.module, spec: e.spec, export: export, version: version}
	for _, f := range e.spec.Fields {
		if f.OptionsSQL != "" {
			if f.Options, err = s.options(ctx, tc, f.OptionsSQL); err != nil {
				return view{}, false, err
			}
		}
		if f.Restricted != nil {
			open, err := s.holds(ctx, tc, f.Restricted.Permission, f.Restricted.Columns)
			if err != nil {
				return view{}, false, err
			}
			if !open {
				v.hidden = append(v.hidden, f.Label)
				continue
			}
		}
		v.fields = append(v.fields, f)
	}
	return v, true, nil
}

// options reads the codes and labels of a choices field from the catalogue of the tenant of tc (Field.OptionsSQL).
func (s *Service) options(ctx context.Context, tc tenantctx.TenantContext, sql string) ([]Option, error) {
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, dependency(err)
	}
	rows, err := pool.Query(ctx, sql)
	if err != nil {
		return nil, dependency(fmt.Errorf("data: options: %w", err))
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Option, error) {
		var o Option
		err := r.Scan(&o.Key, &o.Label)
		return o, err
	})
	if err != nil {
		return nil, dependency(fmt.Errorf("data: options: %w", err))
	}
	return out, nil
}

// holds reports whether the member holds action in some scope over cols (the predicate of the evaluator is not
// «false»: a work function and owner_only close it there too).
func (s *Service) holds(ctx context.Context, tc tenantctx.TenantContext, action string, cols authz.Columns) (bool, error) {
	p, err := s.Authz.ScopeQuery(ctx, tc, action, cols, 0)
	if err != nil {
		return false, dependency(err)
	}
	return p.SQL != sqlFalse, nil
}

// version is the permission version of the tenant (access.policy_state: +1 on any change of roles, assignments or
// modules) — Dataset.permissionVersion and the binding of cursors.
func (s *Service) version(ctx context.Context, tc tenantctx.TenantContext) (string, error) {
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return "", dependency(err)
	}
	var v int64
	if err := pool.QueryRow(ctx, `select coalesce((select policy_version from access.policy_state), 0)`).Scan(&v); err != nil {
		return "", dependency(fmt.Errorf("data: policy version: %w", err))
	}
	return strconv.FormatInt(v, 10), nil
}

func (s *Service) states(ctx context.Context, tenantID uuid.UUID) (map[string]string, error) {
	if s.Modules == nil {
		return map[string]string{}, nil
	}
	states, err := s.Modules.States(ctx, tenantID)
	if err != nil {
		return nil, dependency(err)
	}
	if states == nil {
		states = map[string]string{}
	}
	return states, nil
}

// dependency keeps a Problem error and reports anything else as dependency_unavailable (the cause stays in the log).
func dependency(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}
