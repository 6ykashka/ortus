package tasks_test

import (
	"slices"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/data"       //nolint:depguard // the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/modules/data/tasks" //nolint:depguard // the package under test
)

// W4.80 (dataVM :4189, SETS.tasks): «Задачи» — the source «Задачи · tasks», the columns «Задача» (KEY-N · название),
// «Исполнитель», «Статус», «Срок»; the rows of tasks.read (the projects of the member and his own tasks elsewhere), the
// row opens the card of the task. The module of tasks is a module of the core: its dataset exists in every tenant.
func TestDataset(t *testing.T) {
	t.Parallel()
	p := tasks.Provider{}
	if p.Module() != "tasks" {
		t.Fatalf("module %q", p.Module())
	}
	if c, ok := any(p).(interface{ Core() bool }); !ok || !c.Core() {
		t.Fatal("the module of tasks is a module of the core: its dataset does not wait for an installation")
	}
	specs := p.Datasets()
	if len(specs) != 1 {
		t.Fatalf("%d datasets, want 1", len(specs))
	}
	s := specs[0]
	if s.ID != "tasks" || s.Name != "Задачи" || s.Permission != "tasks.read" || s.EntityType != "task" {
		t.Fatalf("dataset %s %q %s %s", s.ID, s.Name, s.Permission, s.EntityType)
	}
	checkFields(t, s)
	checkColumns(t, s)
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
		if f.Restricted != nil {
			t.Errorf("%s: no field of «Задачи» is restricted", f.Key)
		}
	}
	want := []col{
		{"task", "Задача", data.Text, false},
		{"assignee", "Исполнитель", data.Text, true},
		{"status", "Статус", data.Text, false},
		{"due", "Срок", data.Date, true},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("fields\n got %v\nwant %v", got, want)
	}
	if !slices.Equal(s.DefaultSort, []data.Sort{{Field: "task"}}) {
		t.Fatalf("default sort %v", s.DefaultSort)
	}
}

// checkColumns: the scope of tasks.read is that of listTasks (taskColumns of the module): the unit of the project, the
// project (a role of the project replaces the inherited ones), the assignee (scope self) and the level of the project
// (TP-03).
func checkColumns(t *testing.T, s data.Spec) {
	t.Helper()
	c := s.Columns
	if c.Unit != "p.org_unit_id" || c.Objects["project"] != "t.project_id" || !slices.Equal(c.Persons, []string{"t.assignee_id"}) {
		t.Fatalf("columns %+v", c)
	}
	if k := c.Container; k == nil || k.Kind != "project" || !k.OwnerClosed || !k.RoleReplaces {
		t.Fatalf("container %+v", k)
	}
}
