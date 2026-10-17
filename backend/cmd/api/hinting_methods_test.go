package main

import (
	"reflect"
	"slices"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
)

// Возврат 16.10 №1 W1.42 (Q-W1.48-12): набор методов operators.Commands сверяется с покрытыми подсказкой. Каждая
// команда оператора либо меняет состояние организации и даёт context.changed (hintingCommands её переопределяет, а
// TestHintingCommands вызывает), либо явно отнесена к командам, которые состояние не меняют. Иначе новая команда
// (например, закрытие организации) прошла бы через встроенный интерфейс без подсказки молча.
func TestHintingCommandsCoverEveryCommand(t *testing.T) {
	t.Parallel()
	hinted := []string{"ExtendTrial", "Rename", "Resume", "Suspend"} // as TestHintingCommands calls them
	readOnly := []string{"AuditEvents"}                              // the log of the platform

	var got []string
	for m := range reflect.TypeFor[operators.Commands]().Methods() {
		got = append(got, m.Name) // sorted by name
	}
	want := slices.Concat(hinted, readOnly)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("operators.Commands = %v, covered = %v: decide whether a new command changes the state of a tenant "+
			"(override it in hintingCommands and call it in TestHintingCommands) or only reads (list it as read-only)",
			got, want)
	}
}
