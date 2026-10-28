//go:build integration

package service_test

import (
	"testing"
	"time"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service" //nolint:depguard // the package under test
)

func events(t *testing.T, typ string, id any) int {
	t.Helper()
	return scalar[int](t, `select count(*) from outbox.events where type = $1 and aggregate_id = $2`, typ, id)
}

func TestSweepWarnsOnceAndBreachesOnce(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	t0 := service.DemoBase
	x, err := e.at(t0).svc.CreateRequest(t.Context(), e.tc(t, owner), &api.ServiceRequestCreate{DirectionId: demoID("d-kos"), TypeId: "complaint",
		ClientName: "Ирина Сорокина", Phone: "+79031110101", Text: "Опоздали на сеанс"})
	if err != nil {
		t.Fatal(err)
	}
	// The whole tenant is swept, the demo too: the request of the test is told by its own events.
	pass := func(at time.Time) {
		if _, err := e.at(at).svc.Sweep(t.Context(), ref("tenant:a")); err != nil {
			t.Fatal(err)
		}
	}
	warn, breach := "service.request.sla_warning.v1", "service.request.sla_breached.v1"
	// КОС is open every day 10:00–21:00: the first reply is due at 18:24, the risk begins at 30 minutes left (25 % of the goal, 17:54)
	pass(t0.Add(80 * time.Minute))
	if events(t, warn, x.Id) != 0 || events(t, breach, x.Id) != 0 {
		t.Fatal("too early")
	}
	pass(t0.Add(100 * time.Minute))
	pass(t0.Add(101 * time.Minute))
	if n := events(t, warn, x.Id); n != 1 {
		t.Errorf("a warning, and only one: %d", n)
	}
	pass(t0.Add(130 * time.Minute))
	pass(t0.Add(131 * time.Minute))
	if n := events(t, breach, x.Id); n != 1 {
		t.Errorf("a breach, and only one: %d (details %s)", n, scalar[string](t, `select details::text from service.request_details where request_id = $1`, x.Id))
	}
}

// A missed goal goes to the lead at once and to the owner one working day later (22 «Эскалация», Q-W4.00-service-3).
func TestSweepEscalatesAMissedGoalToTheOwnerAWorkingDayLater(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	t0 := service.DemoBase
	x, err := e.at(t0).svc.CreateRequest(t.Context(), e.tc(t, owner), &api.ServiceRequestCreate{DirectionId: demoID("d-kos"), TypeId: "complaint",
		ClientName: "Ольга Власова", Phone: "+79031110103", Text: "Не вернули деньги"})
	if err != nil {
		t.Fatal(err)
	}
	pass := func(at time.Time) {
		if _, err := e.at(at).svc.Sweep(t.Context(), ref("tenant:a")); err != nil {
			t.Fatal(err)
		}
	}
	const kind = "service.request.sla_escalated"
	owned := func() int {
		return scalar[int](t, `select count(*) from notify.notifications where kind = $1 and recipient_person_id = $2 and entity_id = $3`, kind, person(owner), x.Id)
	}
	// КОС is open every day 10:00–21:00 (11 hours): the first reply was due at 18:24, a working day later is 18:24 of the next day.
	pass(t0.Add(131 * time.Minute))
	pass(t0.Add(20 * time.Hour)) // 12:24 of the next day: the day has not passed
	if n := events(t, kind+".v1", x.Id); n != 0 || owned() != 0 {
		t.Fatalf("too early: %d events, %d notices", n, owned())
	}
	pass(t0.Add(27 * time.Hour)) // 19:24 of the next day
	pass(t0.Add(28 * time.Hour))
	n := events(t, kind+".v1", x.Id)
	if n < 1 {
		t.Fatalf("no escalation after a working day (details %s)", scalar[string](t, `select details::text from service.request_details where request_id = $1`, x.Id))
	}
	if got := owned(); got != n {
		t.Errorf("the owner got %d notices for %d escalations", got, n)
	}
}

func TestSweepClosesWhatWasResolvedFiveDaysAgo(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	e := newEnv(t)
	x := e.call(t, kotova, "question", "+79031110102", "Нужна справка")
	done, err := e.svc.Transition(t.Context(), e.tc(t, kotova), x.Id, rev(x), &api.ServiceTransition{To: "resolved", Outcome: new("Разъяснено")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.at(e.now.Add(4*24*time.Hour)).svc.Sweep(t.Context(), ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	if got, _ := e.svc.GetRequest(t.Context(), e.tc(t, kotova), x.Id); got.Status != "resolved" {
		t.Fatalf("day 4: %s", got.Status)
	}
	if _, err := e.at(e.now.Add(5*24*time.Hour)).svc.Sweep(t.Context(), ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	got, err := e.svc.GetRequest(t.Context(), e.tc(t, kotova), x.Id)
	if err != nil || got.Status != "closed" || got.Revision <= done.Revision {
		t.Fatalf("closed: %s %v", got.Status, err)
	}
	if n := events(t, "service.request.closed.v1", x.Id); n != 1 {
		t.Errorf("closed events %d", n)
	}
}
