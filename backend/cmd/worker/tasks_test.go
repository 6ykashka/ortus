package main

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// W4.11 (S2-17 → задача, D-29): the worker hands the events of the queue of blocking defects to the module of tasks —
// a broken event of each type is an error of its handler (a retry, then the dead letter), not «delivered to nobody».
// W4.24: the task of a blocking defect is made with the response of its inspection (inspections.go), so
// blocking_reported has no handler of the tasks.
func TestRegisterTasks(t *testing.T) {
	t.Parallel()
	reg := events.NewRegistry()
	registerTasks(reg, nil, time.Now)
	broken := func(typ string) error {
		return reg.Dispatch(t.Context(), events.Message{TenantID: uuid.New(), EventID: uuid.New(), Type: typ, Payload: []byte(`not json`)})
	}
	for _, typ := range []string{tasks.EventDefectAssigned, tasks.EventDefectDecided} {
		if err := broken(typ); err == nil {
			t.Errorf("%s: no handler of the tasks", typ)
		}
	}
	if err := broken(tasks.EventDefectBlocking); err != nil {
		t.Errorf("blocking_reported is handled by the tasks: %v", err)
	}
}

// The evaluator of the worker (the audience of the inbox) knows the projects of tasks as the one of cmd/api: the reads
// of a limited project and the place of a project (W4.01, RS-08).
func TestProjectsIn(t *testing.T) {
	t.Parallel()
	ev := projectsIn(authz.New(nil, nil, time.Now), nil)
	if !slices.Equal(ev.ContainerReads[authz.KindProject], tasks.ContainerReads()) {
		t.Fatalf("container reads %v", ev.ContainerReads)
	}
	if _, ok := ev.Places[authz.KindProject].(tasks.ProjectPlaces); !ok {
		t.Fatalf("places %#v", ev.Places)
	}
}
