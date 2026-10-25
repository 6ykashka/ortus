package tasks

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// W4.24: the task of a blocking defect is made by the consumer of the inspection (forms.InspectionResponses with
// InspectionDefects), so fleet.defect.blocking_reported.v1 has no handler of the tasks any more (one task, no race of two
// consumers of one inspection); the assignment and the decision still move to the task — a broken event of theirs is
// an error of the handler (a retry, then the dead letter).
func TestDefectTasksRegister(t *testing.T) {
	t.Parallel()
	reg := events.NewRegistry()
	DefectTasks{}.Register(reg)
	broken := func(typ string) error {
		return reg.Dispatch(t.Context(), events.Message{TenantID: uuid.New(), EventID: uuid.New(), Type: typ, Payload: []byte(`not json`)})
	}
	if err := broken(EventDefectBlocking); err != nil {
		t.Errorf("blocking_reported is handled by the tasks: %v", err)
	}
	for _, typ := range []string{EventDefectAssigned, EventDefectDecided} {
		if err := broken(typ); err == nil {
			t.Errorf("%s: no handler of the tasks", typ)
		}
	}
}
