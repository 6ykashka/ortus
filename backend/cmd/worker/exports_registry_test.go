package main

import (
	"slices"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.80: the export jobs read the datasets of cmd/api — after logistics «Ответы на осмотр» and «Задачи» — through an
// evaluator with the projects of tasks registered (the reads of a limited project), so a file of «Задачи» keeps the
// rows the member sees in «Данные».
func TestExportRegistryAndScoper(t *testing.T) {
	t.Parallel()
	reg, err := exportRegistry()
	if err != nil {
		t.Fatal(err)
	}
	if got := reg.IDs(); !slices.Equal(got, []string{"fleet.vehicles", "fleet.trips", "fleet.expenses", "forms.responses", "tasks"}) {
		t.Fatalf("datasets %v", got)
	}
	ev := exportScoper(&tenantctx.Pools{}, time.Now)
	if !slices.Equal(ev.ContainerReads[authz.KindProject], tasks.ContainerReads()) {
		t.Fatalf("container reads %v", ev.ContainerReads)
	}
}
