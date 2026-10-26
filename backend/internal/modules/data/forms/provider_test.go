package forms_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/data"       //nolint:depguard // the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/modules/data/forms" //nolint:depguard // the package under test
)

// W4.80 (dataVM :4189, SETS.responses): «Ответы на осмотр» — the source «Формы · forms.responses», the columns «Ответ»,
// «Объект», «Автор», «Версия формы», «Топливо» (q-fuel or q-fuel-t); the responses of «Осмотр машины» the member reads
// as listFormResponses shows them (Q-W4.00-forms-9), the row opens the response in the editor of the form. The module of
// forms is a module of the core: its dataset exists in every tenant.
func TestDataset(t *testing.T) {
	t.Parallel()
	p := forms.Provider{}
	if p.Module() != "forms" {
		t.Fatalf("module %q", p.Module())
	}
	if c, ok := any(p).(interface{ Core() bool }); !ok || !c.Core() {
		t.Fatal("the module of forms is a module of the core: its dataset does not wait for an installation")
	}
	specs := p.Datasets()
	if len(specs) != 1 {
		t.Fatalf("%d datasets, want 1", len(specs))
	}
	s := specs[0]
	if s.ID != "forms.responses" || s.Name != "Ответы на осмотр" || s.Permission != "forms.responses.read" || s.EntityType != "form_response" {
		t.Fatalf("dataset %s %q %s %s", s.ID, s.Name, s.Permission, s.EntityType)
	}
	checkFields(t, s)
	checkRows(t, s)
	checkReaches(t, s)
}

type col struct {
	key, label string
	typ        data.ValueType
	nullable   bool
}

func checkFields(t *testing.T, s data.Spec) {
	t.Helper()
	got := make([]col, 0, len(s.Fields))
	for _, f := range s.Fields {
		got = append(got, col{f.Key, f.Label, f.Type, f.Nullable})
	}
	want := []col{
		{"response", "Ответ", data.Text, false},
		{"object", "Объект", data.Text, true},
		{"author", "Автор", data.Text, true},
		{"version", "Версия формы", data.Text, false},
		{"fuel", "Топливо", data.Text, true},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("fields\n got %v\nwant %v", got, want)
	}
	if !slices.Equal(s.DefaultSort, []data.Sort{{Field: "response"}}) {
		t.Fatalf("default sort %v", s.DefaultSort)
	}
}

// checkRows: the response is addressed inside its form («{formId}:{responseId}»); the form of the inspections is
// «Осмотр машины» by its name, as RecordInspection of W4.24; the scope of forms.responses.read — the area of the form,
// the own responses (scope self), the driver of the trip of the response (scope relation).
func checkRows(t *testing.T, s data.Spec) {
	t.Helper()
	if !strings.Contains(s.RecordID, "f.id") || !strings.Contains(s.RecordID, "x.id") {
		t.Fatalf("record id %q", s.RecordID)
	}
	if !strings.Contains(s.Where, "Осмотр машины") {
		t.Fatalf("where %q", s.Where)
	}
	if s.Columns.Unit != "f.org_unit_id" || !slices.Equal(s.Columns.Persons, []string{"x.author_id"}) ||
		!slices.Contains(s.Columns.Related, "t.driver_person_id") {
		t.Fatalf("columns %+v", s.Columns)
	}
}

// checkReaches: besides the area of the form — his own responses, those about a trip or a vehicle he sees (a trip the
// pool closes to him is left out — {{hidden}}, AC-06), those about a trip that is gone with fleet.trips.read anywhere.
func checkReaches(t *testing.T, s data.Spec) {
	t.Helper()
	perms := map[string]int{}
	anywhere := 0
	var whens strings.Builder
	for _, r := range s.Reaches {
		perms[r.Permission]++
		if r.Anywhere {
			anywhere++
		}
		whens.WriteString(r.When + " ")
	}
	if perms["forms.responses.read"] != 1 || perms["fleet.trips.read"] != 2 || perms["fleet.vehicles.read"] != 1 || anywhere != 2 {
		t.Fatalf("reaches %+v", s.Reaches)
	}
	if !strings.Contains(s.From+" "+s.Where+" "+whens.String(), data.HiddenParam) {
		t.Fatal("a trip the pool closes to the member is not left out")
	}
}
