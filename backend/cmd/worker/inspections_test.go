package main

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// W4.24 (D-30): the worker hands fleet.inspection.submitted.v1 to the module of forms — a broken event is an error of
// its handler (a retry, then the dead letter), not «delivered to nobody».
func TestRegisterInspections(t *testing.T) {
	t.Parallel()
	reg := events.NewRegistry()
	registerInspections(reg, inspectionDeps{now: time.Now})
	m := events.Message{TenantID: uuid.New(), EventID: uuid.New(), Type: forms.EventInspectionSubmitted, Payload: []byte(`not json`)}
	if err := reg.Dispatch(t.Context(), m); err == nil {
		t.Fatal("no handler of the inspections")
	}
}
