//go:build integration

package fleet_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strconv"
	"testing"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data" //nolint:depguard // the server of the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	vehiclesSet = "fleet.vehicles"
	tripsSet    = "fleet.trips"
	expensesSet = "fleet.expenses"
)

// value is a cell as JSON: {"type": …, "value": …}.
type value struct {
	Type  string `json:"type"`
	Value any    `json:"value"`
}

func decode(t *testing.T, fv dataapi.FieldValue) value {
	t.Helper()
	raw, err := json.Marshal(fv)
	if err != nil {
		t.Fatal(err)
	}
	var v value
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// query runs raw (a DatasetQuery) over dataset id as actor of tenant.
func (e env) query(t *testing.T, actor, tenant, id, raw string) (dataapi.DatasetQueryResult, error) {
	t.Helper()
	var q dataapi.DatasetQuery
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return e.svc.Query(t.Context(), e.tc(t, actor, tenant), id, &q)
}

func (e env) rows(t *testing.T, actor, tenant, id, raw string) dataapi.DatasetQueryResult {
	t.Helper()
	res, err := e.query(t, actor, tenant, id, raw)
	if err != nil {
		t.Fatalf("%s %s: %v", actor, raw, err)
	}
	return res
}

// column returns the values of the cell key of every row: the text of a text, the number or code otherwise, "∅" for a
// null.
func column(t *testing.T, res dataapi.DatasetQueryResult, key string) []any {
	t.Helper()
	out := make([]any, 0, len(res.Rows))
	for _, r := range res.Rows {
		i := slices.IndexFunc(r.Cells, func(c dataapi.FieldEntry) bool { return c.FieldKey == key })
		if i < 0 {
			t.Fatalf("no cell %s in %v", key, r)
		}
		v := decode(t, r.Cells[i].Value)
		switch v.Type {
		case "null":
			out = append(out, "∅")
		case "choices":
			codes, _ := v.Value.([]any)
			out = append(out, codes[0])
		case "money":
			m, _ := v.Value.(map[string]any)
			out = append(out, m["amountMinor"])
		default:
			out = append(out, v.Value)
		}
	}
	return out
}

func records(res dataapi.DatasetQueryResult) []string {
	out := make([]string, 0, len(res.Rows))
	for _, r := range res.Rows {
		out = append(out, r.RecordId)
	}
	return out
}

func wantColumn(t *testing.T, res dataapi.DatasetQueryResult, key string, want ...any) {
	t.Helper()
	if got := column(t, res, key); !slices.Equal(got, want) {
		t.Fatalf("%s\n got %v\nwant %v", key, got, want)
	}
}

// S2-16, AC-14: a dataset is in the catalog of a member who holds its permission in some scope, while logistics is
// installed and not disabled; «Начисление» only with fleet.earnings.read and never for a driver (AC-05); «Выгрузить»
// with data.export.
func TestCatalog(t *testing.T) {
	t.Parallel()
	all := []string{vehiclesSet, tripsSet, expensesSet}
	cases := []struct {
		actor, tenant, state string
		want                 []string
		hidden               bool // «Начисление» is hidden in «Поездки»
		export               bool
	}{
		{"a.owner", "a", "active", all, false, true},
		{"a.owner", "a", "read_only", all, false, true},
		{"a.owner", "a", "draining", all, false, true},
		{"a.owner", "a", "disabled", nil, false, false},
		{"a.owner", "a", "", nil, false, false},
		{"a.manager-msk1", "a", "active", all, true, false},
		{"a.region-msk", "a", "active", all, false, false},
		{"ab.member", "a", "active", []string{vehiclesSet, tripsSet}, true, false},
		{"a.driver-msk1", "a", "active", []string{tripsSet, expensesSet}, true, false},
		{"a.driver-earnings", "a", "active", []string{tripsSet, expensesSet}, true, false},
		{"a.project-lead", "a", "active", nil, false, false},
		{"b.manager-msk1", "b", "active", all, true, false},
	}
	for _, c := range cases {
		t.Run(c.actor+"/"+c.state, func(t *testing.T) {
			t.Parallel()
			e := newEnv(t, c.state)
			cat, err := e.svc.Catalog(t.Context(), e.tc(t, c.actor, c.tenant))
			if err != nil {
				t.Fatal(err)
			}
			got := make([]string, 0, len(cat.Items))
			for _, d := range cat.Items {
				got = append(got, d.Id)
				checkDataset(t, d, c.export, c.hidden)
			}
			if !slices.Equal(got, c.want) && len(got)+len(c.want) > 0 {
				t.Fatalf("datasets %v, want %v", got, c.want)
			}
		})
	}
}

// checkDataset: the export flag, the version and the module of a dataset; the fields of «Поездки» with or without
// «Начисление» (hidden — only its label).
func checkDataset(t *testing.T, d dataapi.Dataset, export, hidden bool) {
	t.Helper()
	if d.ExportAllowed == nil || *d.ExportAllowed != export {
		t.Errorf("%s: exportAllowed %v, want %v", d.Id, d.ExportAllowed, export)
	}
	if d.PermissionVersion == "" || d.ModuleKey != "fleet" {
		t.Errorf("%s: permissionVersion %q, moduleKey %q", d.Id, d.PermissionVersion, d.ModuleKey)
	}
	if d.Id != tripsSet {
		return
	}
	keys := make([]string, 0, len(d.Fields))
	for _, f := range d.Fields {
		keys = append(keys, f.Key)
	}
	want, labels := []string{"trip", "driverName", "state", "mileageKm", "earnings"}, []string{}
	if hidden {
		want, labels = want[:4], []string{"Начисление"}
	}
	if !slices.Equal(keys, want) || d.HiddenFieldLabels == nil || !slices.Equal(*d.HiddenFieldLabels, labels) {
		t.Errorf("trips: fields %v, hidden %v", keys, d.HiddenFieldLabels)
	}
}

// «Автомобили»: the vehicles of the scope of fleet.vehicles.read, not archived, with the status of W2.02; the default
// order by name puts Cyrillic first (localeCompare 'ru' of MSW); search, filters, sort and pages (cases/data.ts W2.51).
func TestVehicles(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	q := func(extra string) dataapi.DatasetQueryResult {
		return e.rows(t, "a.manager-msk1", "a", vehiclesSet, `{"select": ["displayName", "status", "volumeM3"], "filters": [],
			"sort": [], "limit": 50`+extra+`}`)
	}
	all := q(`, "includeCount": true`)
	wantColumn(t, all, "displayName", "ГАЗель Next", "ГАЗон Next", "Ford Transit", "Hyundai Porter", "Mercedes Sprinter")
	wantColumn(t, all, "status", "available", "maintenance", "in_use", "blocked", "reserved")
	wantColumn(t, all, "volumeM3", "16", "30", "11", "9", "14")
	if all.VisibleCount == nil || *all.VisibleCount != 5 || all.VisibleCountCapped != nil || all.NextCursor != nil {
		t.Fatalf("count %v capped %v cursor %v", all.VisibleCount, all.VisibleCountCapped, all.NextCursor)
	}
	wantColumn(t, q(`, "search": "газ"`), "displayName", "ГАЗель Next", "ГАЗон Next")
	wantColumn(t, q(`, "search": "НЕДОСТУПНА"`), "displayName", "ГАЗон Next")
	wantColumn(t, q(`, "search": "газ", "filters": [{"fieldKey": "status", "operator": "eq", "values": [{"type": "text", "value": "available"}]}]`),
		"displayName", "ГАЗель Next")
	wantColumn(t, q(`, "filters": [{"fieldKey": "status", "operator": "in", "values": [{"type": "choices", "value": ["in_use", "blocked"]}]}]`),
		"displayName", "Ford Transit", "Hyundai Porter")
	wantColumn(t, q(`, "filters": [{"fieldKey": "volumeM3", "operator": "gte", "values": [{"type": "decimal", "value": "14"}]}]`),
		"displayName", "ГАЗель Next", "ГАЗон Next", "Mercedes Sprinter")
	page := `{"select": ["displayName"], "filters": [], "sort": [{"fieldKey": "volumeM3", "direction": "desc"}], "limit": 2%s}`
	first := e.rows(t, "a.manager-msk1", "a", vehiclesSet, sprintf(page, ""))
	wantColumn(t, first, "displayName", "ГАЗон Next", "ГАЗель Next")
	second := e.rows(t, "a.manager-msk1", "a", vehiclesSet, sprintf(page, `, "cursor": "`+deref(first.NextCursor)+`"`))
	wantColumn(t, second, "displayName", "Mercedes Sprinter", "Ford Transit")
	last := e.rows(t, "a.manager-msk1", "a", vehiclesSet, sprintf(page, `, "cursor": "`+deref(second.NextCursor)+`"`))
	wantColumn(t, last, "displayName", "Hyundai Porter")
	if last.NextCursor != nil {
		t.Fatalf("a cursor after the last page: %v", *last.NextCursor)
	}
	stats := e.rows(t, "a.manager-msk1", "a", vehiclesSet, `{"select": ["n", "total", "least", "most", "mean"], "filters": [], "sort": [],
		"aggregates": [{"function": "count", "alias": "n"}, {"function": "sum", "fieldKey": "volumeM3", "alias": "total"},
		{"function": "min", "fieldKey": "volumeM3", "alias": "least"}, {"function": "max", "fieldKey": "volumeM3", "alias": "most"},
		{"function": "avg", "fieldKey": "volumeM3", "alias": "mean"}], "limit": 50}`)
	for key, want := range map[string]any{"n": "5", "total": "80", "least": "9", "most": "30", "mean": "16"} {
		wantColumn(t, stats, key, want)
	}
	if !slices.Equal(records(stats), []string{"group-1"}) {
		t.Fatalf("records %v", records(stats))
	}
}

// The scope of the rows: the owner — the whole tenant (the vehicle with a blocking defect is «Недоступна»), two roles —
// both scopes, a namesake firm of tenant B — its own vehicle only (AC-02); an archived vehicle is never listed.
func TestVehiclesScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	const raw = `{"select": ["displayName", "orgUnitName", "status"], "filters": [], "sort": [], "limit": 50, "includeCount": true}`
	owner := e.rows(t, "a.owner", "a", vehiclesSet, raw)
	wantColumn(t, owner, "displayName", "ГАЗель Бизнес", "ГАЗель Next", "ГАЗон Next", "Ford Transit", "Hyundai Porter", "Isuzu Elf",
		"Mercedes Sprinter")
	wantColumn(t, owner, "status", "available", "available", "maintenance", "in_use", "blocked", "maintenance", "reserved")
	wantColumn(t, owner, "orgUnitName", "Самара-2", "Москва-1", "Москва-1", "Москва-1", "Москва-1", "Москва-2", "Москва-1")
	if slices.Contains(records(owner), seeded.vehicles["old"].String()) {
		t.Fatal("an archived vehicle is listed")
	}
	wantColumn(t, e.rows(t, "a.two-roles", "a", vehiclesSet, raw), "displayName", "ГАЗель Бизнес", "ГАЗель Next", "ГАЗон Next",
		"Ford Transit", "Hyundai Porter", "Mercedes Sprinter")
	b := e.rows(t, "b.manager-msk1", "b", vehiclesSet, raw)
	if !slices.Equal(records(b), []string{seeded.vehicles["b-gazel"].String()}) {
		t.Fatalf("tenant B: %v", records(b))
	}
	if n := e.rows(t, "ab.member", "a", vehiclesSet, raw); !slices.Equal(records(n), []string{seeded.vehicles["isuzu"].String()}) ||
		*n.VisibleCount != 1 {
		t.Fatalf("observer of Москва-2 sees %v", records(n))
	}
	capped := e.rows(t, "b.owner", "b", vehiclesSet, `{"select": ["displayName"], "filters": [], "sort": [], "limit": 200, "includeCount": true}`)
	if capped.VisibleCount == nil || *capped.VisibleCount != 10000 || capped.VisibleCountCapped == nil || !*capped.VisibleCountCapped ||
		len(capped.Rows) != 200 || capped.NextCursor == nil {
		t.Fatalf("10 002 vehicles: count %v capped %v rows %d", capped.VisibleCount, capped.VisibleCountCapped, len(capped.Rows))
	}
}

// «Поездки»: the trips of the scope of fleet.trips.read (unit or own), not cancelled; a member with the function
// «Водитель» sees only the trips he drives (D22), even with a unit grant; «Пробег, км» — return minus departure.
func TestTrips(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	const raw = `{"select": ["trip", "driverName", "state", "mileageKm"], "filters": [], "sort": [], "limit": 50}`
	m := e.rows(t, "a.manager-msk1", "a", tripsSet, raw)
	wantColumn(t, m, "trip", "Р-701 · Северный маршрут", "Р-702 · Химки", "Р-703 · Лобня", "Р-704 · Мытищи", "Р-706 · Королёв")
	wantColumn(t, m, "driverName", "Водитель Москва-1", "Водитель Москва-2", "Водитель Москва-1", "∅", "Водитель Москва-1")
	wantColumn(t, m, "state", "on_route", "submitted", "accepted", "assigned", "accepted")
	wantColumn(t, m, "mileageKm", "∅", "46", "60", "∅", "∅")
	if !slices.Contains(records(m), seeded.trips["Р-701"].String()) || slices.Contains(records(m), seeded.trips["Р-707"].String()) {
		t.Fatalf("records %v", records(m))
	}
	for actor, want := range map[string][]any{
		"a.driver-msk1": {"Р-701 · Северный маршрут", "Р-703 · Лобня", "Р-706 · Королёв"},
		"a.driver-msk2": {"Р-702 · Химки", "Р-705 · Юг"},
	} {
		wantColumn(t, e.rows(t, actor, "a", tripsSet, raw), "trip", want...)
	}
	wantColumn(t, e.rows(t, "a.manager-msk1", "a", tripsSet, `{"select": ["trip"], "filters": [{"fieldKey": "driverName", "operator": "is_null",
		"values": []}], "sort": [], "limit": 50}`), "trip", "Р-704 · Мытищи")
	wantColumn(t, e.rows(t, "a.manager-msk1", "a", tripsSet, `{"select": ["trip"], "filters": [{"fieldKey": "mileageKm", "operator": "gt",
		"values": [{"type": "decimal", "value": "50"}]}], "sort": [], "limit": 50}`), "trip", "Р-703 · Лобня")
	groups := e.rows(t, "a.owner", "a", tripsSet, `{"select": ["state", "n"], "filters": [], "sort": [{"fieldKey": "n", "direction": "desc"},
		{"fieldKey": "state", "direction": "asc"}], "groupBy": ["state"], "aggregates": [{"function": "count", "alias": "n"}], "limit": 50}`)
	// Equal counts go by the label of the state: «В рейсе», «Запланирован», «Машина назначена», «Ожидает приёмки».
	wantColumn(t, groups, "state", "accepted", "on_route", "planned", "assigned", "submitted")
	wantColumn(t, groups, "n", "3", "1", "1", "1", "1")
}

// «Начисление» (AC-05): only with fleet.earnings.read, the value in its scope (Москва-1 for a.region-msk through the
// group «Финансы»), 0 for an accepted trip without a ledger row, empty before the acceptance; closed for a driver and a
// member without the permission — the same 422 as an unknown field.
func TestTripEarnings(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	const raw = `{"select": ["trip", "earnings"], "filters": [], "sort": [], "limit": 50}`
	region := e.rows(t, "a.region-msk", "a", tripsSet, raw)
	wantColumn(t, region, "trip", "Р-701 · Северный маршрут", "Р-702 · Химки", "Р-703 · Лобня", "Р-704 · Мытищи", "Р-705 · Юг", "Р-706 · Королёв")
	wantColumn(t, region, "earnings", "∅", "∅", float64(250000), "∅", "∅", float64(0))
	owner := e.rows(t, "a.owner", "a", tripsSet, `{"select": ["earnings"], "filters": [{"fieldKey": "earnings", "operator": "gt",
		"values": [{"type": "money", "value": {"amountMinor": 0, "currency": "RUB"}}]}], "sort": [{"fieldKey": "earnings", "direction": "desc"}], "limit": 50}`)
	wantColumn(t, owner, "earnings", float64(250000), float64(120000))
	for _, actor := range []string{"a.manager-msk1", "a.driver-earnings"} {
		hidden := e.serve(t, actor, "a", tripsSet, raw)
		unknown := e.serve(t, actor, "a", tripsSet, `{"select": ["trip", "plate"], "filters": [], "sort": [], "limit": 50}`)
		h, ok1 := hidden.(dataapi.QueryDataset422ApplicationProblemPlusJSONResponse)
		u, ok2 := unknown.(dataapi.QueryDataset422ApplicationProblemPlusJSONResponse)
		if !ok1 || !ok2 || deref(h.Body.Detail) != "Поле недоступно: earnings." || deref(u.Body.Detail) != "Поле недоступно: plate." ||
			!maps.Equal(violation(h.Body), violation(u.Body)) {
			t.Fatalf("%s: hidden %#v, unknown %#v", actor, hidden, unknown)
		}
	}
}

// «Расходы»: the expenses of the trips of the scope of fleet.expenses.read; «Статус» — «Принят» after the acceptance of
// the shift (Q-W2.51-6); search by the category label, the amount in roubles and the date.
func TestExpenses(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	m := e.rows(t, "a.manager-msk1", "a", expensesSet, `{"select": ["trip", "kind", "occurredOn", "amount", "status"], "filters": [], "sort": [], "limit": 50}`)
	if !slices.Equal(records(m), []string{seeded.expenses["E1"].String(), seeded.expenses["E2"].String()}) {
		t.Fatalf("records %v", records(m))
	}
	raw, _ := json.Marshal(m.Rows[0].Cells)
	sameJSON(t, raw, `[{"fieldKey": "trip", "value": {"type": "text", "value": "Р-701"}},
		{"fieldKey": "kind", "value": {"type": "choices", "value": ["fuel"]}},
		{"fieldKey": "occurredOn", "value": {"type": "date", "value": "2026-09-30"}},
		{"fieldKey": "amount", "value": {"type": "money", "value": {"amountMinor": 250000, "currency": "RUB"}}},
		{"fieldKey": "status", "value": {"type": "choices", "value": ["claimed"]}}]`)
	wantColumn(t, m, "status", "claimed", "accepted")
	wantColumn(t, e.rows(t, "a.driver-msk1", "a", expensesSet, `{"select": ["trip"], "filters": [], "sort": [], "limit": 50}`), "trip", "Р-701", "Р-703")
	owner := func(extra string) dataapi.DatasetQueryResult {
		return e.rows(t, "a.owner", "a", expensesSet, `{"select": ["trip"], "filters": [], "sort": [], "limit": 50`+extra+`}`)
	}
	wantColumn(t, owner(""), "trip", "Р-701", "Р-703", "Р-705", "Р-708")
	wantColumn(t, owner(`, "search": "топливо"`), "trip", "Р-701")
	wantColumn(t, owner(`, "search": "2500"`), "trip", "Р-701")
	wantColumn(t, owner(`, "search": "2026-09-28"`), "trip", "Р-705")
	wantColumn(t, owner(`, "filters": [{"fieldKey": "amount", "operator": "gt", "values": [{"type": "money", "value": {"amountMinor": 50000, "currency": "RUB"}}]}]`),
		"trip", "Р-701", "Р-703")
	wantColumn(t, owner(`, "filters": [{"fieldKey": "kind", "operator": "in", "values": [{"type": "text", "value": "fuel"}, {"type": "text", "value": "toll"}]}]`),
		"trip", "Р-701", "Р-708")
	wantColumn(t, owner(`, "filters": [{"fieldKey": "occurredOn", "operator": "lte", "values": [{"type": "date", "value": "2026-09-28"}]}]`),
		"trip", "Р-705", "Р-708")
	sums := e.rows(t, "a.owner", "a", expensesSet, `{"select": ["kind", "spent"], "filters": [], "sort": [{"fieldKey": "spent", "direction": "desc"}],
		"groupBy": ["kind"], "aggregates": [{"function": "sum", "fieldKey": "amount", "alias": "spent"}], "limit": 50}`)
	wantColumn(t, sums, "kind", "fuel", "wash", "parking", "toll")
	wantColumn(t, sums, "spent", float64(250000), float64(80000), float64(30000), float64(15000))
	wantColumn(t, e.rows(t, "b.manager-msk1", "b", expensesSet, `{"select": ["trip"], "filters": [], "sort": [], "limit": 50}`), "trip", "Р-801")
}

// Refusals: an unknown dataset and a dataset of a closed module — 404 «Набор не найден.»; a known dataset without its
// permission — 403; a cursor of another member — 400.
func TestRefusals(t *testing.T) {
	t.Parallel()
	const raw = `{"select": ["trip"], "filters": [], "sort": [], "limit": 50}`
	active := newEnv(t, "active")
	for _, c := range []struct {
		name, actor, id, state, code, detail string
	}{
		{"unknown dataset", "a.owner", "fleet.earnings", "active", problem.CodeNotFound, "Набор не найден."},
		{"module disabled", "a.owner", tripsSet, "disabled", problem.CodeNotFound, "Набор не найден."},
		{"module not installed", "a.owner", tripsSet, "", problem.CodeNotFound, "Набор не найден."},
		{"no dataset permission", "ab.member", expensesSet, "active", problem.CodeForbiddenAction, ""},
		{"no fleet permission", "a.project-lead", tripsSet, "active", problem.CodeForbiddenAction, ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := newEnv(t, c.state).query(t, c.actor, "a", c.id, raw)
			pe, ok := errorsAs(err)
			if !ok || pe.Code != c.code || pe.Detail != c.detail {
				t.Fatalf("%v", err)
			}
		})
	}
	first := active.rows(t, "a.manager-msk1", "a", vehiclesSet, `{"select": ["displayName"], "filters": [], "sort": [], "limit": 1}`)
	_, err := active.query(t, "a.two-roles", "a", vehiclesSet, `{"select": ["displayName"], "filters": [], "sort": [], "limit": 1, "cursor": "`+
		deref(first.NextCursor)+`"}`)
	if pe, ok := errorsAs(err); !ok || pe.Code != problem.CodeMalformedRequest || pe.Detail != "Курсор не подходит к выборке." {
		t.Fatalf("cursor of another member: %v", err)
	}
}

// serve runs the query through the server of the tag (the 422 of a field error with its violation).
func (e env) serve(t *testing.T, actor, tenant, id, raw string) dataapi.QueryDatasetResponseObject {
	t.Helper()
	var q dataapi.DatasetQuery
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatal(err)
	}
	ctx := tenantctx.WithTenant(t.Context(), e.tc(t, actor, tenant))
	resp, err := data.Server{S: e.svc}.QueryDataset(ctx, dataapi.QueryDatasetRequestObject{DatasetId: id, Body: &q})
	if err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return resp
}

func violation(p dataapi.Problem) map[string]string {
	if p.Violations == nil || len(*p.Violations) != 1 {
		return nil
	}
	v := (*p.Violations)[0]
	return map[string]string{"field": v.Field, "code": v.Code, "message": v.Message, "status": strconv.FormatInt(p.Status, 10),
		"problem": string(p.Code)}
}

func sprintf(format string, a ...any) string { return fmt.Sprintf(format, a...) }

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// sameJSON compares raw with the JSON want as values.
func sameJSON(t *testing.T, raw []byte, want string) {
	t.Helper()
	var got, exp any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(want), &exp); err != nil {
		t.Fatalf("want: %v", err)
	}
	if !reflect.DeepEqual(got, exp) {
		t.Fatalf("got\n%s\nwant\n%s", raw, want)
	}
}

func errorsAs(err error) (*problem.Error, bool) { return errors.AsType[*problem.Error](err) }
