//go:build integration

package csv

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"                 //nolint:depguard // integration test: the engine of «Данные» (W2.08) the export reads through, as cmd/api wires it
	datafleet "github.com/ortus/ortus-crm/backend/internal/modules/data/fleet" //nolint:depguard // integration test: the datasets of logistics
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// logistics is the module registry of the tests: logistics is active in every tenant.
type logistics struct{}

func (logistics) States(context.Context, uuid.UUID) (map[string]string, error) {
	return map[string]string{datafleet.ModuleKey: "active"}, nil
}

// grantOnce gives the template «Менеджер логистики» of tenant A data.export, data.query and data.catalog.read, as
// design/docs/11-permissions.yaml does (the fixtures of W1.44 keep data.* to the owner, Q-W2.52-16): a.manager-msk1
// exports Москва-1; a.two-roles exports Москва-1 too, though it reads the vehicles of Самара-2 as an observer.
var grantOnce sync.Once

func (e env) grantExport(t *testing.T) {
	t.Helper()
	grantOnce.Do(func() {
		db, err := pgxpool.New(context.Background(), world.TenantURL(fixtures.TenantA, migratetest.Super))
		require.NoError(t, err)
		defer db.Close()
		_, err = db.Exec(context.Background(), `update access.role_versions rv
			set actions = rv.actions || array['data.export', 'data.query', 'data.catalog.read']
			from access.roles r where r.id = rv.role_id and r.name = 'Менеджер логистики'`)
		require.NoError(t, err)
		_, err = db.Exec(context.Background(), `update access.policy_state set policy_version = policy_version + 1`)
		require.NoError(t, err)
	})
}

// dataServers are the server of the tag Data and the export over it, as cmd/api wires them.
func (e env) dataServers(t *testing.T) (data.Server, DataServer) {
	t.Helper()
	reg, err := data.NewRegistry(datafleet.Provider{})
	require.NoError(t, err)
	svc := &data.Service{Pools: e.pools, Authz: e.ev, Registry: reg, Modules: logistics{}, Now: harness.Now, Timeout: time.Minute}
	rows := *svc
	rows.Authz = ExportScope{Scoper: e.ev}
	base := data.Server{S: svc}
	return base, NewDataServer(base, &Export{Catalog: base, Rows: data.Server{S: &rows}, Pools: e.pools, Now: harness.Now})
}

func plates(t *testing.T, res dataapi.QueryDatasetResponseObject) []string {
	t.Helper()
	ok, is := res.(dataapi.QueryDataset200JSONResponse)
	require.True(t, is, "200, got %T", res)
	var out []string
	for _, r := range ok.Body.Rows {
		for _, c := range r.Cells {
			v, err := c.Value.AsTextValue()
			require.NoError(t, err)
			out = append(out, v.Value)
		}
	}
	return out
}

// Q-W2.52-26: the file of a manager of one company has neither the labels nor the registration numbers of another
// company, and its row count equals queryDataset over the same scope; a member who reads more companies than it may
// export gets only the rows of data.export.
func TestExportDatasetScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.grantExport(t)
	base, srv := e.dataServers(t)
	token := strings.ToUpper(uuid.NewString()[:8]) // the rows of this test only: the other tests add vehicles in parallel
	mine, theirs := "Э "+token+" 1", "Э "+token+" 2"
	e.addVehicle(t, "msk1", mine, "0")
	e.addVehicle(t, "smr2", theirs, "0")
	body := dataapi.DatasetExportCreate{Select: []string{"registrationNumber", "orgUnitName"}, Filters: []dataapi.QueryFilter{},
		Sort: []dataapi.QuerySort{}, Search: &token}
	export := func(actor string) dataapi.DatasetExport {
		t.Helper()
		res, err := srv.ExportDataset(e.as(t, actor, fixtures.TenantA), dataapi.ExportDatasetRequestObject{DatasetId: "fleet.vehicles", Body: &body})
		require.NoError(t, err)
		ok, is := res.(dataapi.ExportDataset200JSONResponse)
		require.True(t, is, "%s: 200, got %T", actor, res)
		return ok.Body
	}
	query := func(actor string) []string {
		t.Helper()
		res, err := base.QueryDataset(e.as(t, actor, fixtures.TenantA), dataapi.QueryDatasetRequestObject{DatasetId: "fleet.vehicles",
			Body: &dataapi.DatasetQuery{Select: []string{"registrationNumber"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}, Limit: 200,
				Search: &token}})
		require.NoError(t, err)
		return plates(t, res)
	}

	f := export("a.manager-msk1")
	assert.True(t, strings.HasPrefix(f.Content, "Номер;Фирма\r\n"), f.Content)
	assert.Contains(t, f.Content, mine+";Москва-1\r\n")
	assert.NotContains(t, f.Content, theirs)
	assert.NotContains(t, f.Content, "Самара-2")
	assert.Equal(t, int64(len(query("a.manager-msk1"))), f.RowCount, "the rows of queryDataset")
	assert.Equal(t, int64(1), f.RowCount)

	two := query("a.two-roles")
	assert.Contains(t, two, theirs, "a.two-roles reads Самара-2 as an observer")
	f = export("a.two-roles")
	assert.Contains(t, f.Content, mine)
	assert.NotContains(t, f.Content, theirs, "but exports only where it holds data.export")
	assert.NotContains(t, f.Content, "Самара-2")
	assert.Equal(t, []any{int64(1), 2}, []any{f.RowCount, len(two)})

	var n int
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `select count(*) from audit.events
		where action = 'data.exported' and diff ->> 'datasetId' = 'fleet.vehicles' and (diff ->> 'rowCount')::int = $1`,
		f.RowCount).Scan(&n))
	assert.Positive(t, n, "the audit row data.exported with the number of rows, without the content")
	var leaked int
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `select count(*) from audit.events
		where action = 'data.exported' and diff::text like '%' || $1 || '%'`, mine).Scan(&leaked))
	assert.Zero(t, leaked, "the content never reaches the audit")
}

// A hidden field («Начисление» of a manager) — the same 422 as queryDataset; a dataset without the right of the member —
// 403; an unknown dataset — 404.
func TestExportDatasetRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.grantExport(t)
	_, srv := e.dataServers(t)
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	res, err := srv.ExportDataset(ctx, dataapi.ExportDatasetRequestObject{DatasetId: "fleet.trips", Body: &dataapi.DatasetExportCreate{
		Select: []string{"trip", "earnings"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}})
	require.NoError(t, err)
	bad, ok := res.(dataapi.ExportDataset422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "422, got %T", res)
	require.NotNil(t, bad.Body.Violations)
	assert.Equal(t, "unknown_field", (*bad.Body.Violations)[0].Code)

	_, err = srv.ExportDataset(ctx, dataapi.ExportDatasetRequestObject{DatasetId: "fleet.nothing", Body: &dataapi.DatasetExportCreate{
		Select: []string{"trip"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}})
	assert.True(t, problem.Is(err, problem.CodeNotFound), "an unknown dataset: %v", err)

	_, err = srv.ExportDataset(e.as(t, "a.project-lead", fixtures.TenantA), dataapi.ExportDatasetRequestObject{DatasetId: "fleet.vehicles",
		Body: &dataapi.DatasetExportCreate{Select: []string{"registrationNumber"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}})
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "no permission of the dataset: %v", err)
}
