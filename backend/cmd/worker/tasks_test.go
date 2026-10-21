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
func TestRegisterTasks(t *testing.T) {
	t.Parallel()
	reg := events.NewRegistry()
	registerTasks(reg, nil, time.Now)
	for _, typ := range []string{tasks.EventDefectBlocking, tasks.EventDefectAssigned, tasks.EventDefectDecided} {
		m := events.Message{TenantID: uuid.New(), EventID: uuid.New(), Type: typ, Payload: []byte(`not json`)}
		if err := reg.Dispatch(t.Context(), m); err == nil {
			t.Errorf("%s: no handler of the tasks", typ)
		}
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
