//go:build integration

package tasks_test

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data" //nolint:depguard // the server of the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const all = `{"select": ["task", "assignee", "status", "due"], "filters": [], "sort": [], "limit": 50, "includeCount": true}`

func name(t *testing.T, actor, tenant string) string {
	t.Helper()
	var n string
	if err := dbs[tenant].QueryRowContext(t.Context(), `select full_name from people.person_profiles where id = $1`,
		person(actor, tenant)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// W4.80: «Задачи» is in the catalog of a member who holds tasks.read in some scope (the module of tasks is of the core —
// no installation), with «Выгрузить» for data.export; a member without tasks.read neither sees it nor queries it (403).
func TestCatalog(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	for _, c := range []struct {
		actor, tenant string
		visible       bool
		export        bool
	}{
		{"a.owner", "a", true, true},
		{"a.project-lead", "a", true, false},
		{"a.driver-msk1", "a", true, false},
		{"ab.member", "a", true, false},
		{"a.manager-msk1", "a", false, false},
		{"b.owner", "b", true, true},
	} {
		t.Run(c.actor, func(t *testing.T) {
			t.Parallel()
			e.checkCatalog(t, c.actor, c.tenant, c.visible, c.export)
		})
	}
}

// checkCatalog: «Задачи» in the catalog of actor (visible) with «Выгрузить» (export); not visible — a query is 403.
func (e env) checkCatalog(t *testing.T, actor, tenant string, visible, export bool) {
	t.Helper()
	cat, err := e.svc.Catalog(t.Context(), e.tc(t, actor, tenant))
	if err != nil {
		t.Fatal(err)
	}
	if !visible {
		if len(cat.Items) != 0 {
			t.Fatalf("catalog %v", cat.Items)
		}
		if _, err := e.query(t, actor, tenant, all); !problem.Is(err, problem.CodeForbiddenAction) {
			t.Fatalf("query without tasks.read: %v, want 403", err)
		}
		return
	}
	if len(cat.Items) != 1 {
		t.Fatalf("catalog %v", cat.Items)
	}
	d := cat.Items[0]
	if d.Id != "tasks" || d.ModuleKey != "tasks" || d.Name != "Задачи" || deref(d.PermissionKey) != "tasks.read" ||
		deref(d.EntityType) != "task" || d.ExportAllowed == nil || *d.ExportAllowed != export {
		t.Fatalf("dataset %+v", d)
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// The rows of «Задачи» are those of listTasks: the projects of the member at their level (TP-03 — the closed
// «Стройка» is shut to the owner too), his own tasks anywhere (scope self), no deleted task, no task of another tenant.
func TestRows(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	fleet1, fleet2, build1 := ref("task:a.fleet-1").String(), ref("task:a.fleet-2").String(), ref("task:a.build-1").String()
	for _, c := range []struct {
		actor, tenant string
		want          []string
	}{
		{"a.owner", "a", []string{fleet1, fleet2}},
		{"a.project-lead", "a", []string{fleet1, fleet2}},
		{"a.driver-msk1", "a", []string{fleet1, build1}},
		{"ab.member", "a", []string{}},
		{"b.owner", "b", []string{ref("task:b.fleet-1").String(), ref("task:b.fleet-2").String()}},
	} {
		t.Run(c.actor, func(t *testing.T) {
			t.Parallel()
			res, err := e.query(t, c.actor, c.tenant, all)
			if err != nil {
				t.Fatal(err)
			}
			want := slices.Clone(c.want)
			slices.Sort(want)
			if got := records(res); !slices.Equal(got, want) {
				t.Fatalf("records %v, want %v", got, want)
			}
			if res.VisibleCount == nil || *res.VisibleCount != int64(len(want)) {
				t.Fatalf("visible count %v, want %d", res.VisibleCount, len(want))
			}
		})
	}
}

// The cells: «KEY-N · название», the assignee, the name of the status in the workflow of the task, the due as the day
// by Moscow (the end of the day is the start of the next one); the default order by «Задача»; search over the visible
// cells; a filter of the status.
func TestCells(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	res, err := e.query(t, "a.owner", "a", all)
	if err != nil {
		t.Fatal(err)
	}
	driver, lead := name(t, "a.driver-msk1", "a"), name(t, "a.project-lead", "a")
	want := [][]string{
		{ref("task:a.fleet-1").String(), "АВТ-101 · Проверить тормоза", driver, "Новая", "2026-10-05"},
		{ref("task:a.fleet-2").String(), "АВТ-102 · Заменить шины", lead, "На проверке", "∅"},
	}
	if got := cells(t, res); !slices.EqualFunc(got, want, slices.Equal) {
		t.Fatalf("cells\n got %v\nwant %v", got, want)
	}
	found, err := e.query(t, "a.owner", "a", `{"select": ["task"], "filters": [], "sort": [], "limit": 50, "search": "ШИН"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := records(found); !slices.Equal(got, []string{ref("task:a.fleet-2").String()}) {
		t.Fatalf("search: %v", got)
	}
	filtered, err := e.query(t, "a.owner", "a", `{"select": ["task"], "filters": [{"fieldKey": "status", "operator": "eq",
		"values": [{"type": "text", "value": "Новая"}]}], "sort": [{"fieldKey": "due", "direction": "desc"}], "limit": 50}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := records(filtered); !slices.Equal(got, []string{ref("task:a.fleet-1").String()}) {
		t.Fatalf("filter: %v", got)
	}
}

// W4.50 for the new dataset: a personal view of «Задачи», and the snapshot of an export job (the worker reads it with
// the same checks as queryDataset).
func TestViewAndExport(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	srv := data.Server{S: e.svc}
	ctx := tenantctx.WithTenant(t.Context(), e.tc(t, "a.owner", "a"))
	q := dataapi.DatasetViewQuery{Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}
	search := "тормоз"
	q.Search = &search
	res, err := srv.CreateDatasetView(ctx, dataapi.CreateDatasetViewRequestObject{
		DatasetId: "tasks", Params: dataapi.CreateDatasetViewParams{IdempotencyKey: "w480-" + uuid.NewString()},
		Body: &dataapi.DatasetViewCreate{Name: "Задачи: «тормоз»", Query: q},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := res.(dataapi.CreateDatasetView201JSONResponse); !ok {
		t.Fatalf("createDatasetView: %#v", res)
	}
	list, err := srv.ListDatasetViews(ctx, dataapi.ListDatasetViewsRequestObject{DatasetId: "tasks"})
	if err != nil {
		t.Fatal(err)
	}
	if l, ok := list.(dataapi.ListDatasetViews200JSONResponse); !ok || len(l.Body.Items) != 1 || l.Body.Items[0].Name != "Задачи: «тормоз»" {
		t.Fatalf("listDatasetViews: %#v", list)
	}
	ds, rows, truncated, err := e.svc.Snapshot(t.Context(), e.tc(t, "a.owner", "a"), "tasks",
		dataapi.DatasetExportCreate{Select: []string{"task", "status"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}, 10)
	if err != nil {
		t.Fatal(err)
	}
	if ds.Id != "tasks" || len(rows) != 2 || truncated {
		t.Fatalf("snapshot %s: %d rows, truncated %v", ds.Id, len(rows), truncated)
	}
	if _, _, _, err := e.svc.Snapshot(t.Context(), e.tc(t, "a.manager-msk1", "a"), "tasks",
		dataapi.DatasetExportCreate{Select: []string{"task"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}, 10); !problem.Is(err, problem.CodeForbiddenAction) {
		t.Fatalf("snapshot without tasks.read: %v", err)
	}
}
