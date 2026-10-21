//go:build integration

package fleet_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data" //nolint:depguard // the server of the saved views (W4.50)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// exporter grants data.export over the whole tenant to the people of who — as a role with «Выгрузить» would (the
// fixtures give data.export to the owners only); the other actions go to the evaluator.
type exporter struct {
	scopeddb.Scoper
	who map[uuid.UUID]bool
}

func (x exporter) ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, start int) (authz.Predicate, error) {
	if action == "data.export" && x.who[tc.PersonID] {
		return authz.Predicate{SQL: "true"}, nil
	}
	return x.Scoper.ScopeQuery(ctx, tc, action, c, start)
}

// exporting grants data.export to the actors of tenant a in the service of e.
func (e env) exporting(actors ...string) env {
	who := map[uuid.UUID]bool{}
	for _, a := range actors {
		who[person(a, "a")] = true
	}
	e.svc.Authz = exporter{Scoper: e.svc.Authz, who: who}
	return e
}

// srv is the server of the tag Data over the service of e.
func (e env) srv() data.Server { return data.Server{S: e.svc} }

// ctx is the context of a request of actor in tenant, as the gateway builds it.
func (e env) ctx(t *testing.T, actor, tenant string) context.Context {
	t.Helper()
	return tenantctx.WithTenant(t.Context(), e.tc(t, actor, tenant))
}

// viewQuery decodes a DatasetViewQuery.
func viewQuery(t *testing.T, raw string) dataapi.DatasetViewQuery {
	t.Helper()
	var q dataapi.DatasetViewQuery
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return q
}

// uniq is a name of the test that no other test of the package takes (the views of the world are shared).
func uniq(t *testing.T, name string) string {
	t.Helper()
	return name + " · " + t.Name()
}

// createView saves a view of set as actor; the answer is the response object (201 or 422) or the error.
func (e env) createView(t *testing.T, actor, set, name string, shared bool, raw string) (dataapi.CreateDatasetViewResponseObject, error) {
	t.Helper()
	body := dataapi.DatasetViewCreate{Name: name, Query: viewQuery(t, raw)}
	if shared {
		v := dataapi.DatasetViewCreateVisibilityShared
		body.Visibility = &v
	}
	return e.srv().CreateDatasetView(e.ctx(t, actor, "a"), dataapi.CreateDatasetViewRequestObject{
		DatasetId: set, Params: dataapi.CreateDatasetViewParams{IdempotencyKey: "w450-" + uuid.NewString()}, Body: &body,
	})
}

// view saves a view as createView does and returns it (201) or fails.
func (e env) view(t *testing.T, actor, set, name string, shared bool, raw string) dataapi.DatasetView {
	t.Helper()
	res, err := e.createView(t, actor, set, name, shared, raw)
	if err != nil {
		t.Fatalf("createDatasetView: %v", err)
	}
	r, ok := res.(dataapi.CreateDatasetView201JSONResponse)
	if !ok {
		t.Fatalf("createDatasetView: %#v, want 201", res)
	}
	if r.Headers.ETag == nil || *r.Headers.ETag != `"1"` || r.Headers.CacheControl == nil || *r.Headers.CacheControl != "private, no-store" {
		t.Fatalf("headers %+v", r.Headers)
	}
	return r.Body
}

// listViews returns the views of set the actor sees.
func (e env) listViews(t *testing.T, actor, set string) []dataapi.DatasetView {
	t.Helper()
	res, err := e.srv().ListDatasetViews(e.ctx(t, actor, "a"), dataapi.ListDatasetViewsRequestObject{DatasetId: set})
	if err != nil {
		t.Fatalf("listDatasetViews: %v", err)
	}
	r, ok := res.(dataapi.ListDatasetViews200JSONResponse)
	if !ok {
		t.Fatalf("listDatasetViews: %#v", res)
	}
	return r.Body.Items
}

func viewByID(list []dataapi.DatasetView, id uuid.UUID) (dataapi.DatasetView, bool) {
	i := slices.IndexFunc(list, func(v dataapi.DatasetView) bool { return v.Id == id })
	if i < 0 {
		return dataapi.DatasetView{}, false
	}
	return list[i], true
}

// violationOf is the first violation of a 422 of the views.
func violationOf(t *testing.T, res any) dataapi.ProblemViolation {
	t.Helper()
	var p dataapi.Problem
	switch r := res.(type) {
	case dataapi.CreateDatasetView422ApplicationProblemPlusJSONResponse:
		p = r.Body
	case dataapi.UpdateDatasetView422ApplicationProblemPlusJSONResponse:
		p = r.Body
	case dataapi.CreateDatasetExportJob422ApplicationProblemPlusJSONResponse:
		p = r.Body
	default:
		t.Fatalf("%#v, want 422", res)
	}
	if p.Status != http.StatusUnprocessableEntity || p.Violations == nil || len(*p.Violations) == 0 {
		t.Fatalf("problem %+v", p)
	}
	return (*p.Violations)[0]
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Fatalf("error %v, want %s", err, code)
	}
}

// DATA-03 (W4.06, contract 0.7.0-stage4): a personal view is seen only by its author; a shared view — by every member
// who queries the dataset, with the name of its author; the views go by name.
func TestViewsPersonalAndShared(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	mine := e.view(t, "a.manager-msk1", tripsSet, uniq(t, "Поездки: «Р-70»"), false,
		`{"filters": [], "search": "Р-70", "sort": [{"fieldKey": "trip", "direction": "desc"}]}`)
	wantPersonal(t, mine, person("a.manager-msk1", "a"), "Менеджер Москва-1", "Р-70")
	shared := e.view(t, "a.owner", tripsSet, uniq(t, "Общий: «Р-7»"), true, `{"filters": [], "search": "Р-7", "sort": []}`)
	if shared.Visibility != dataapi.DatasetViewVisibilityShared {
		t.Fatalf("shared view %+v", shared)
	}
	if _, ok := viewByID(e.listViews(t, "a.manager-msk1", tripsSet), mine.Id); !ok {
		t.Fatal("the author does not see his personal view")
	}
	for _, actor := range []string{"a.manager-msk2", "a.owner"} {
		list := e.listViews(t, actor, tripsSet)
		if _, ok := viewByID(list, mine.Id); ok {
			t.Fatalf("%s sees the personal view of another member", actor)
		}
		if v, ok := viewByID(list, shared.Id); !ok || v.OwnerDisplayName != "Владелец Холдинга" {
			t.Fatalf("%s: shared view %+v, %v", actor, v, ok)
		}
	}
	if _, ok := viewByID(e.listViews(t, "a.manager-msk1", vehiclesSet), mine.Id); ok {
		t.Fatal("a view of «Поездки» in «Автомобили»")
	}
	list := e.listViews(t, "a.manager-msk1", tripsSet)
	if !slices.IsSortedFunc(list, func(a, b dataapi.DatasetView) int { return compareNames(a.Name, b.Name) }) {
		t.Fatalf("views not by name: %v", names(list))
	}
}

// wantPersonal checks a new personal view of owner (name ownerName) with the search q.
func wantPersonal(t *testing.T, v dataapi.DatasetView, owner uuid.UUID, ownerName, q string) {
	t.Helper()
	if v.Visibility != dataapi.DatasetViewVisibilityPersonal || v.Revision != 1 || v.OwnerMemberId != owner ||
		v.OwnerDisplayName != ownerName || v.Query.Search == nil || *v.Query.Search != q || v.HiddenFieldLabels != nil {
		t.Fatalf("personal view %+v", v)
	}
}

func names(list []dataapi.DatasetView) []string {
	out := make([]string, 0, len(list))
	for _, v := range list {
		out = append(out, v.Name)
	}
	return out
}

// compareNames is the order of listDatasetViews: the name without case (the id breaks ties).
func compareNames(a, b string) int { return strings.Compare(strings.ToLower(a), strings.ToLower(b)) }

// The fields hidden from the viewer by rights are cut out of the view and named in hiddenFieldLabels: «Начисление» of
// a shared view of the owner for a manager without fleet.earnings.read.
func TestViewHidesClosedFields(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	v := e.view(t, "a.owner", tripsSet, uniq(t, "Начисления"), true,
		`{"select": ["trip", "earnings"], "filters": [{"fieldKey": "earnings", "operator": "gt", "values": [{"type": "money", "value": {"amountMinor": 0, "currency": "RUB"}}]}], "sort": [{"fieldKey": "earnings", "direction": "desc"}]}`)
	if v.HiddenFieldLabels != nil || v.Query.Select == nil || len(*v.Query.Select) != 2 {
		t.Fatalf("the view of the owner %+v", v)
	}
	got, ok := viewByID(e.listViews(t, "a.manager-msk1", tripsSet), v.Id)
	if !ok {
		t.Fatal("the manager does not see the shared view")
	}
	if got.HiddenFieldLabels == nil || !slices.Equal(*got.HiddenFieldLabels, []string{"Начисление"}) ||
		got.Query.Select == nil || !slices.Equal(*got.Query.Select, []string{"trip"}) || len(got.Query.Filters) != 0 || len(got.Query.Sort) != 0 {
		t.Fatalf("the view of the manager %+v (hidden %v)", got, got.HiddenFieldLabels)
	}
}

// The query of a view is checked as queryDataset; the name is unique per author (personal) or dataset (shared)
// without case; at most 50 personal views of a member in a dataset; a shared view needs data.export or the owner.
func TestViewChecks(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active").exporting("a.manager-msk2")
	res, err := e.createView(t, "a.manager-msk1", tripsSet, uniq(t, "Начисление"), false,
		`{"select": ["earnings"], "filters": [], "sort": []}`)
	if err != nil {
		t.Fatal(err)
	}
	if v := violationOf(t, res); v.Field != "select[0]" || v.Code != "unknown_field" {
		t.Fatalf("hidden field %+v", v)
	}
	name := uniq(t, "Поездки: «Химки»")
	e.view(t, "a.manager-msk1", tripsSet, name, false, `{"filters": [], "search": "Химки", "sort": []}`)
	res, err = e.createView(t, "a.manager-msk1", tripsSet, " "+strings.ToUpper(name)+" ", false, `{"filters": [], "sort": []}`)
	if err != nil {
		t.Fatal(err)
	}
	if v := violationOf(t, res); v.Field != "name" || v.Code != "taken" || v.Message != "Вид с таким именем уже есть." {
		t.Fatalf("taken name %+v", v)
	}
	// Another member may take the name for his own personal view.
	e.view(t, "a.manager-msk2", tripsSet, name, false, `{"filters": [], "sort": []}`)
	res, err = e.createView(t, "a.manager-msk1", tripsSet, "  ", false, `{"filters": [], "sort": []}`)
	if err != nil {
		t.Fatal(err)
	}
	if v := violationOf(t, res); v.Field != "name" || v.Code != "required" {
		t.Fatalf("empty name %+v", v)
	}
	_, err = e.createView(t, "a.manager-msk1", tripsSet, uniq(t, "Общий"), true, `{"filters": [], "sort": []}`)
	wantCode(t, err, problem.CodeForbiddenAction)
	e.view(t, "a.manager-msk2", tripsSet, uniq(t, "Общий"), true, `{"filters": [], "sort": []}`)
	_, err = e.createView(t, "a.manager-msk1", "fleet.unknown", uniq(t, "Нет набора"), false, `{"filters": [], "sort": []}`)
	wantCode(t, err, problem.CodeNotFound)
	_, err = e.createView(t, "a.project-lead", tripsSet, uniq(t, "Без права"), false, `{"filters": [], "sort": []}`)
	wantCode(t, err, problem.CodeForbiddenAction)
}

// At most 50 personal views of a member per dataset (422 too_many).
func TestViewPersonalLimit(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	for i := range 50 {
		e.view(t, "a.region-msk", expensesSet, uniq(t, "Вид "+strconv.Itoa(i)), false, `{"filters": [], "sort": []}`)
	}
	res, err := e.createView(t, "a.region-msk", expensesSet, uniq(t, "Вид 50"), false, `{"filters": [], "sort": []}`)
	if err != nil {
		t.Fatal(err)
	}
	if v := violationOf(t, res); v.Field != "name" || v.Code != "too_many" || v.Message != "Не больше 50 личных видов набора." {
		t.Fatalf("limit %+v", v)
	}
}

// updateView changes the view id of «Поездки» as actor with If-Match ifMatch and the patch raw.
func (e env) updateView(t *testing.T, actor string, id uuid.UUID, ifMatch, raw string) (dataapi.UpdateDatasetViewResponseObject, error) {
	t.Helper()
	var p dataapi.DatasetViewPatch
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	return e.srv().UpdateDatasetView(e.ctx(t, actor, "a"), dataapi.UpdateDatasetViewRequestObject{
		DatasetId: tripsSet, ViewId: id, Body: &p,
		Params: dataapi.UpdateDatasetViewParams{IdempotencyKey: "w450-" + uuid.NewString(), IfMatch: ifMatch},
	})
}

// removeView deletes the view id of «Поездки» as actor with If-Match ifMatch.
func (e env) removeView(t *testing.T, actor string, id uuid.UUID, ifMatch string) (dataapi.DeleteDatasetViewResponseObject, error) {
	t.Helper()
	return e.srv().DeleteDatasetView(e.ctx(t, actor, "a"), dataapi.DeleteDatasetViewRequestObject{
		DatasetId: tripsSet, ViewId: id,
		Params: dataapi.DeleteDatasetViewParams{IdempotencyKey: "w450-" + uuid.NewString(), IfMatch: ifMatch},
	})
}

// updateDatasetView and deleteDatasetView of a personal view: its author only (another member — 404, as a missing
// view); If-Match is the revision (428, 412); a member without data.export does not share it.
func TestPersonalViewUpdateAndDelete(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	mine := e.view(t, "a.manager-msk1", tripsSet, uniq(t, "Мой"), false, `{"filters": [], "search": "Р", "sort": []}`)
	_, err := e.updateView(t, "a.manager-msk2", mine.Id, `"1"`, `{"name": "Чужой"}`)
	wantCode(t, err, problem.CodeNotFound)
	_, err = e.removeView(t, "a.owner", mine.Id, `"1"`)
	wantCode(t, err, problem.CodeNotFound)
	_, err = e.updateView(t, "a.manager-msk1", mine.Id, "", `{"name": "Без ревизии"}`)
	wantCode(t, err, "revision_required")
	_, err = e.updateView(t, "a.manager-msk1", mine.Id, `"7"`, `{"name": "Старая ревизия"}`)
	wantCode(t, err, "revision_mismatch")
	res, err := e.updateView(t, "a.manager-msk1", mine.Id, `"1"`, `{"query": {"filters": [], "search": "Химки", "sort": []}}`)
	if err != nil {
		t.Fatal(err)
	}
	r, ok := res.(dataapi.UpdateDatasetView200JSONResponse)
	if !ok || r.Body.Revision != 2 || r.Body.Query.Search == nil || *r.Body.Query.Search != "Химки" || r.Body.Name != mine.Name ||
		r.Headers.ETag == nil || *r.Headers.ETag != `"2"` {
		t.Fatalf("update %#v", res)
	}
	_, err = e.updateView(t, "a.manager-msk1", mine.Id, `"2"`, `{"visibility": "shared"}`)
	wantCode(t, err, problem.CodeForbiddenAction)
	if _, err := e.removeView(t, "a.manager-msk1", mine.Id, `"2"`); err != nil {
		t.Fatalf("the author deletes his view: %v", err)
	}
	if _, ok := viewByID(e.listViews(t, "a.manager-msk1", tripsSet), mine.Id); ok {
		t.Fatal("a deleted view is listed")
	}
}

// A shared view is changed and deleted by its author with data.export or by the owner (another member — 403).
func TestSharedViewUpdateAndDelete(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active").exporting("a.manager-msk2")
	shared := e.view(t, "a.manager-msk2", tripsSet, uniq(t, "Общий"), true, `{"filters": [], "sort": []}`)
	_, err := e.updateView(t, "a.manager-msk1", shared.Id, `"1"`, `{"name": "Переименован чужим"}`)
	wantCode(t, err, problem.CodeForbiddenAction)
	_, err = e.removeView(t, "a.manager-msk1", shared.Id, `"1"`)
	wantCode(t, err, problem.CodeForbiddenAction)
	if _, err := e.updateView(t, "a.owner", shared.Id, `"1"`, `{"name": "`+uniq(t, "Переименован владельцем")+`"}`); err != nil {
		t.Fatalf("the owner renames a shared view: %v", err)
	}
	if _, err := e.removeView(t, "a.manager-msk2", shared.Id, `"1"`); !problem.Is(err, "revision_mismatch") {
		t.Fatalf("delete by a stale revision: %v", err)
	}
	d, err := e.removeView(t, "a.manager-msk2", shared.Id, `"2"`)
	if _, ok := d.(dataapi.DeleteDatasetView204Response); err != nil || !ok {
		t.Fatalf("delete: %#v, %v", d, err)
	}
	if _, ok := viewByID(e.listViews(t, "a.manager-msk1", tripsSet), shared.Id); ok {
		t.Fatal("a deleted view is listed")
	}
}
