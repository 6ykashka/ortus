//go:build integration

package fleet_test

import (
	"context"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
)

// W2.41 (D-12 комплекта, integratorNotes W2.52 п. 3а): the options of «Категория» of «Расходы» are the catalogue of
// expense categories of the tenant (fleet.expense_categories, tenant 0015) — the six seed categories, then those of the
// owner, archived ones too (their expenses keep them), in the order of the catalogue; the label of a code of the owner
// is found by the search. Not parallel: it writes a category and an expense of tenant B and removes them before the
// parallel tests of the package run.
func TestExpenseCategoryOptions(t *testing.T) { //nolint:paralleltest // writes to the world the other tests only read
	ctx := t.Context()
	writeCategoriesB(t)
	e := newEnv(t, "active")
	cat, err := e.svc.Catalog(ctx, e.tc(t, "b.manager-msk1", "b"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"fuel=Топливо", "wash=Мойка", "parking=Парковка", "toll=Платная дорога",
		"tire_service=Шиномонтаж и мелкий ремонт", "other=Прочее", "w241_night=Стоянка на ночь", "w241_old=Ремни и стяжки"}
	if got := kindOptions(t, cat); !slices.Equal(got, want) {
		t.Fatalf("options\n got %v\nwant %v", got, want)
	}
	found := e.rows(t, "b.manager-msk1", "b", expensesSet,
		`{"select": ["trip", "kind"], "filters": [], "sort": [], "limit": 50, "search": "стоянка на ночь"}`)
	wantColumn(t, found, "kind", "w241_night")
	// The tenant A keeps its own catalogue: the categories of B are not among its options.
	catA, err := e.svc.Catalog(ctx, e.tc(t, "a.owner", "a"))
	if err != nil {
		t.Fatal(err)
	}
	if got := kindOptions(t, catA); slices.ContainsFunc(got, func(o string) bool { return strings.HasPrefix(o, "w241_") }) {
		t.Fatalf("tenant A sees the categories of B: %v", got)
	}
}

// writeCategoriesB writes a category of the owner, an archived one and an expense of the first in tenant B and
// removes them after the test.
func writeCategoriesB(t *testing.T) {
	t.Helper()
	d := dbs["b"]
	by := person("b.owner", "b")
	expense := uuid.New()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into fleet.expense_categories (code, label, comment_required, sort_order, created_by)
		    values ('w241_night', 'Стоянка на ночь', true, 70, $1)`, []any{by}},
		{`insert into fleet.expense_categories (code, label, sort_order, created_by, archived_at, archived_by)
		    values ('w241_old', 'Ремни и стяжки', 80, $1, now(), $1)`, []any{by}},
		{`insert into fleet.expenses (id, trip_id, category, amount_minor, occurred_on, comment, claimed_by)
		    values ($1, $2, 'w241_night', 70000, '2026-09-30', 'Охраняемая стоянка', $3)`, []any{expense, seeded.trips["Р-801"], by}},
	} {
		if _, err := d.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		if _, err := d.ExecContext(ctx, `delete from fleet.expenses where id = $1`, expense); err != nil {
			t.Errorf("expense: %v", err)
		}
		if _, err := d.ExecContext(ctx, `delete from fleet.expense_categories where code in ('w241_night', 'w241_old')`); err != nil {
			t.Errorf("categories: %v", err)
		}
	})
}

// kindOptions returns «code=label» of the options of «Категория» of «Расходы» in a catalog.
func kindOptions(t *testing.T, cat dataapi.DatasetCatalog) []string {
	t.Helper()
	i := slices.IndexFunc(cat.Items, func(x dataapi.Dataset) bool { return x.Id == expensesSet })
	if i < 0 {
		t.Fatalf("no «Расходы» in %v", cat.Items)
	}
	ds := cat.Items[i]
	j := slices.IndexFunc(ds.Fields, func(f dataapi.FieldDescriptor) bool { return f.Key == "kind" })
	if j < 0 || ds.Fields[j].Options == nil {
		t.Fatalf("«Категория» without options: %+v", ds.Fields)
	}
	var out []string
	for _, o := range *ds.Fields[j].Options {
		out = append(out, o.Key+"="+o.Label)
	}
	return out
}
