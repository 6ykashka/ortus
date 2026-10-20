package main

import (
	"time"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// newCalendar is the server of the tag Calendar (W4.40, CAL-01…05): the calendar of resources — the day and the week,
// the reschedule that rechecks every resource of a booking, the free slots — over the tenant pools, the evaluator of
// W1.04, the module states of the registry W1.08 (vehicles and trips need «Логистика», visits SPA) and the clock of
// the application (APP_FIXED_NOW outside prod).
func newCalendar(pools calendar.Pools, ev *authz.Evaluator, states calendar.Modules, now func() time.Time) calendarapi.StrictServerInterface {
	return calendar.Server{S: &calendar.Service{Pools: pools, Authz: ev, Modules: states, Now: now}}
}
