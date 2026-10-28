package main

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	repairsapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// repairsImplemented follows the composed server of the tag Repairs: an operation without an owner answers 501 (the stub
// of repairsPending), an operation with one does not; every listed operation is an operation of the tag.
func TestRepairsImplementedFollowsServer(t *testing.T) {
	t.Parallel()
	v := reflect.ValueOf(newRepairs(nil, nil, "", time.Now))
	for m := range reflect.TypeFor[repairsapi.StrictServerInterface]().Methods() {
		op := strings.ToLower(m.Name[:1]) + m.Name[1:]
		if pending := answers501(v.MethodByName(m.Name), m.Type.In(1)); pending == repairsImplemented[op] {
			t.Errorf("%s: answers 501 = %v, but implemented = %v", op, pending, repairsImplemented[op])
		}
	}
	inTag := map[string]bool{}
	for _, op := range catalog.Operations {
		if op.Tag == "Repairs" {
			inTag[op.ID] = true
		}
	}
	for op := range repairsImplemented {
		if !inTag[op] {
			t.Errorf("%s is not an operation of the tag Repairs", op)
		}
	}
	if len(repairsImplemented) < 66 {
		t.Errorf("W6.11-W6.15 serve 66 operations, %d listed", len(repairsImplemented))
	}
}
