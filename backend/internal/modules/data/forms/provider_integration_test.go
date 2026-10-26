//go:build integration

package forms_test

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

const all = `{"select": ["response", "object", "author", "version", "fuel"], "filters": [], "sort": [], "limit": 50, "includeCount": true}`

func name(t *testing.T, actor string) string {
	t.Helper()
	var n string
	if err := dbs["a"].QueryRowContext(t.Context(), `select full_name from people.person_profiles where id = $1`,
		person(actor, "a")).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// W4.80: «Ответы на осмотр» is in the catalog of a member who holds forms.responses.read in some scope (the module of
// forms is of the core); a member without it neither sees it nor queries it (403).
func TestCatalog(t *testing.T) {
	t.Parallel()
	e := newEnv(t, nil)
	for _, c := range []struct {
		actor, tenant   string
		visible, export bool
	}{
		{"a.owner", "a", true, true},
		{"a.manager-msk1", "a", true, false},
		{"a.driver-msk1", "a", false, false},
		{"ab.member", "a", false, false},
		{"b.owner", "b", true, true},
	} {
		t.Run(c.actor, func(t *testing.T) {
			t.Parallel()
			e.checkCatalog(t, c.actor, c.tenant, c.visible, c.export)
		})
	}
}

// checkCatalog: «Ответы на осмотр» in the catalog of actor (visible) with «Выгрузить» (export); not visible — a query
// is 403.
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
			t.Fatalf("query without forms.responses.read: %v, want 403", err)
		}
		return
	}
	if len(cat.Items) != 1 {
		t.Fatalf("catalog %v", cat.Items)
	}
	d := cat.Items[0]
	if d.Id != "forms.responses" || d.ModuleKey != "forms" || d.Name != "Ответы на осмотр" || d.ExportAllowed == nil ||
		*d.ExportAllowed != export || d.EntityType == nil || *d.EntityType != "form_response" {
		t.Fatalf("dataset %+v", d)
	}
}

// The rows are the responses of «Осмотр машины» as listFormResponses shows them (Q-W4.00-forms-9): the owner — all of
// them; a manager of a unit (the form is of the whole organization) — only the responses about the trips of his unit
// and, as the stub of the prototype, about a trip that is gone (fleet.trips.read anywhere, Q-W4.21-17); a trip the
// pool closes to him (AC-06) is left out; another form and another tenant never.
func TestRows(t *testing.T) {
	t.Parallel()
	insp1 := rec(ref("form_response:a.insp-1"))
	r1, r2, r3 := rec(answer["5001"]), rec(answer["5002"]), rec(answer["5003"])
	for _, c := range []struct {
		name, actor string
		hider       pool
		want        []string
	}{
		{"owner", "a.owner", pool{}, []string{insp1, r1, r2, r3}},
		{"manager of Москва-1", "a.manager-msk1", pool{}, []string{r1, r3}},
		{"manager of Москва-2", "a.manager-msk2", pool{}, []string{r2, r3}},
		{"manager of the region", "a.region-msk", pool{}, []string{r1, r2, r3}},
		{"trip closed by the pool", "a.manager-msk1", pool{who: person("a.manager-msk1", "a"), hidden: []uuid.UUID{trips["Р-901"]}}, []string{r3}},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			e := newEnv(t, c.hider)
			res, err := e.query(t, c.actor, "a", all)
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
	t.Run("tenant B", func(t *testing.T) {
		t.Parallel()
		res, err := newEnv(t, nil).query(t, "b.owner", "b", all)
		if err != nil {
			t.Fatal(err)
		}
		want := ref("form:b.insp").String() + ":" + ref("form_response:b.insp-1").String()
		if got := records(res); !slices.Equal(got, []string{want}) {
			t.Fatalf("records %v, want %v", got, want)
		}
	})
}

// The cells: «R-NNNN», the object of the response, its author, «v{N}» of its version, «Топливо» — the label of the
// option of q-fuel in the version of the response, else the text of q-fuel-t; the default order by «Ответ».
func TestCells(t *testing.T) {
	t.Parallel()
	e := newEnv(t, nil)
	res, err := e.query(t, "a.manager-msk1", "a", all)
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{rec(answer["5001"]), "R-5001", "Рейс Р-901 · выезд", name(t, "a.driver-msk1"), "v2", "¾"},
		{rec(answer["5003"]), "R-5003", "Рейс Р-171", name(t, "a.owner"), "v1", "∅"},
	}
	if got := cells(t, res); !slices.EqualFunc(got, want, slices.Equal) {
		t.Fatalf("cells\n got %v\nwant %v", got, want)
	}
	owner, err := e.query(t, "a.owner", "a", `{"select": ["response", "fuel"], "filters": [], "sort": [], "limit": 50, "search": "ПОЧТИ"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := cells(t, owner); !slices.EqualFunc(got, [][]string{{rec(answer["5002"]), "R-5002", "почти полный"}}, slices.Equal) {
		t.Fatalf("search over «Топливо»: %v", got)
	}
	sorted, err := e.query(t, "a.owner", "a", `{"select": ["version"], "filters": [{"fieldKey": "version", "operator": "eq",
		"values": [{"type": "text", "value": "v2"}]}], "sort": [{"fieldKey": "response", "direction": "desc"}], "limit": 50}`)
	if err != nil {
		t.Fatal(err)
	}
	if got := records(sorted); !slices.Equal(got, []string{rec(answer["5001"])}) {
		t.Fatalf("filter of the version: %v", got)
	}
}

// W4.50 for the new dataset: the snapshot of an export job keeps the rows of the member.
func TestExportSnapshot(t *testing.T) {
	t.Parallel()
	e := newEnv(t, nil)
	_, rows, truncated, err := e.svc.Snapshot(t.Context(), e.tc(t, "a.owner", "a"), "forms.responses",
		dataapi.DatasetExportCreate{Select: []string{"response", "fuel"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || !truncated {
		t.Fatalf("snapshot of 2 of 4: %d rows, truncated %v", len(rows), truncated)
	}
}
