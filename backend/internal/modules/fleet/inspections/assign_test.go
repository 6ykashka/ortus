package inspections

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// D-29 комплекта (W2.46): the body of assignInspectionDefect — the deadline is not in the past (the clock of the
// application), the comment fits 2000 characters; a deadline equal to now is allowed.
func TestValidateAssignment(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	long, limit := strings.Repeat("ж", maxAssignNote+1), strings.Repeat("ж", maxAssignNote)
	cases := []struct {
		name   string
		due    time.Time
		note   *string
		detail string // "" — valid
	}{
		{"срок в будущем", now.Add(2 * time.Hour), nil, ""},
		{"срок — сейчас", now, nil, ""},
		{"комментарий 2000 символов", now.Add(time.Hour), &limit, ""},
		{"срок в прошлом", now.Add(-time.Second), nil, "Срок решения уже прошёл."},
		{"срок не задан", time.Time{}, nil, "Срок решения уже прошёл."},
		{"комментарий длиннее 2000", now.Add(time.Hour), &long, "Комментарий — не длиннее 2000 символов."},
	}
	for _, c := range cases {
		err := validateAssignment(fleetapi.DefectAssignment{AssigneeMemberId: uuid.New(), DueAt: c.due, Comment: c.note}, now)
		switch {
		case c.detail == "" && err != nil:
			t.Errorf("%s: %v, want valid", c.name, err)
		case c.detail != "" && !problem.Is(err, codeValidation):
			t.Errorf("%s: %v, want validation_failed", c.name, err)
		case c.detail != "" && err.Error() != codeValidation+": "+c.detail:
			t.Errorf("%s: %q, want detail %q", c.name, err.Error(), c.detail)
		}
	}
}

// The notification of the assignee (MSW W2.52, fleet/inspections.ts): «Вам назначен дефект: {машина} {номер} —
// {зона}»; a missing vehicle name leaves no double space.
func TestAssignedTitle(t *testing.T) {
	t.Parallel()
	if got, want := assignedTitle("ГАЗель Next", "А 412 МР 77", "Стёкла"), "Вам назначен дефект: ГАЗель Next А 412 МР 77 — Стёкла"; got != want {
		t.Errorf("title %q, want %q", got, want)
	}
	if got, want := assignedTitle("", "А 412 МР 77", "Шины и колёса"), "Вам назначен дефект: А 412 МР 77 — Шины и колёса"; got != want {
		t.Errorf("title %q, want %q", got, want)
	}
}
