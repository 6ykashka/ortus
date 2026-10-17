//go:build integration

package trips_test

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/trips" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// onRoute seeds a trip of a.driver-msk1 and starts it.
func onRoute(t *testing.T, e env) trip {
	t.Helper()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	release(t, tr)
	if _, err := e.svc.Start(t.Context(), e.tc(t, "a.driver-msk1", "a"), start(tr)); err != nil {
		t.Fatalf("Start: %v", err)
	}
	return tr
}

func ret(id uuid.UUID) fleetapi.TripReturn {
	return fleetapi.TripReturn{Action: fleetapi.TripReturnActionReturn, ReturnInspectionId: id}
}

// TestFinishAndReturn: «Завершить рейс» (on_route → returning, If-Match) and «Сдать машину» with the return
// inspection (returning → submitted) — S2-07, S2-09; the managers learn about the submitted shift.
func TestFinishAndReturn(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	tr := onRoute(t, e)
	_, rev := state(t, tr)

	_, err := e.svc.Finish(ctx, drv, tr.ID, "")
	wantProblem(t, err, "revision_required", "")
	_, err = e.svc.Finish(ctx, drv, tr.ID, etag(rev-1))
	wantProblem(t, err, "revision_mismatch", "")
	_, err = e.svc.Finish(ctx, e.tc(t, "a.manager-msk1", "a"), tr.ID, etag(rev))
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	_, err = e.svc.Finish(ctx, e.tc(t, "a.driver-msk2", "a"), tr.ID, etag(rev))
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.Return(ctx, drv, tr.ID, etag(rev), ret(tr.Departure))
	wantProblem(t, err, "invalid_transition", "Сдать машину можно после «Завершить рейс».")

	plan, err := e.svc.Finish(ctx, drv, tr.ID, etag(rev))
	if err != nil {
		t.Fatalf("Finish: %v", err)
	}
	expect(t, "Finish", plan, plan.State == "returning", plan.RouteCompletedAt != nil,
		plan.RouteCompletedAt != nil && plan.RouteCompletedAt.Equal(e.now), plan.Revision == rev+1)
	_, err = e.svc.Finish(ctx, drv, tr.ID, etag(plan.Revision))
	wantProblem(t, err, "invalid_transition", "Рейс ещё не в пути.")

	returnShift(t, e, tr)
}

// returnShift submits the shift of tr waiting for its return inspection: a lower odometer and an older inspection
// are refused, the latest one is accepted.
func returnShift(t *testing.T, e env, tr trip) {
	t.Helper()
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	low := inspect(t, tr, "return", startKm-1, e.now)
	_, rev := state(t, tr)
	_, err := e.svc.Return(ctx, drv, tr.ID, etag(rev), ret(low))
	wantProblem(t, err, "odometer_decrease", "Пробег не может быть меньше 48 250 км")

	good := inspect(t, tr, "return", startKm+46, e.now.Add(time.Minute))
	_, rev = state(t, tr)
	_, err = e.svc.Return(ctx, drv, tr.ID, etag(rev), ret(low))
	wantProblem(t, err, "validation_failed", "Сдача не завершена: нужен последний осмотр при сдаче.")
	got, err := e.svc.Return(ctx, drv, tr.ID, etag(rev), ret(good))
	if err != nil {
		t.Fatalf("Return: %v", err)
	}
	expect(t, "Return", got, got.Status == fleetapi.TripStatusReturnedPendingReview,
		got.ReturnInspectionId != nil && *got.ReturnInspectionId == good,
		got.ReturnedAt != nil && got.ReturnedAt.Equal(e.now), got.Revision == rev+1)
	d := db(t, "a")
	expect(t, "outbox rows", nil,
		scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.trip.submitted.v1' and aggregate_id = $1`, tr.ID) == 1)
	expect(t, "audit rows", nil, scalar[int](t, d, `select count(*) from audit.events
	   where action in ('fleet.trip.finish_route', 'fleet.trip.return') and target_id = $1`, tr.ID) == 2)
	title := scalar[string](t, d, `select coalesce(max(title), '') from notify.notifications
	   where kind = 'fleet.trip.submitted' and entity_id = $1 and recipient_person_id = $2`, tr.ID, person("a.manager-msk1"))
	expect(t, "notification of the manager", title, title == "Смена "+tr.Number+" сдана на приёмку · ГАЗель Next "+tr.Plate)
	_, err = e.svc.Return(ctx, drv, tr.ID, etag(got.Revision), ret(good))
	wantProblem(t, err, "invalid_transition", "Сдать машину можно после «Завершить рейс».")
}

// TestReturnAfterRework: a shift sent back for rework is submitted again only with a new return inspection
// (attempt + 1, TripReview.steps of 0.5.0-stage2).
func TestReturnAfterRework(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	tr := onRoute(t, e)
	d := db(t, "a")
	old := inspect(t, tr, "return", startKm+40, e.now.Add(-time.Hour))
	exec(t, d, `update fleet.trips set state = 'rework', route_completed_at = $2, returned_at = $2, revision = revision + 1 where id = $1`,
		tr.ID, e.now.Add(-time.Hour))
	exec(t, d, `insert into fleet.trip_reviews (trip_id, attempt, decision, comment, steps, reviewed_by, reviewed_at)
	            values ($1, 1, 'rework', 'Нет фото одометра', array['photos'], $2, $3)`, tr.ID, person("a.manager-msk1"), e.now.Add(-30*time.Minute))
	_, rev := state(t, tr)
	_, err := e.svc.Return(ctx, drv, tr.ID, etag(rev), ret(old))
	wantProblem(t, err, "validation_failed", "Сдача не завершена: после доработки нужен новый осмотр при сдаче.")
	fresh := inspect(t, tr, "return", startKm+46, e.now)
	_, rev = state(t, tr)
	got, err := e.svc.Return(ctx, drv, tr.ID, etag(rev), ret(fresh))
	if err != nil || got.Status != fleetapi.TripStatusReturnedPendingReview {
		t.Fatalf("Return after rework = %+v, %v", got, err)
	}
	plan, err := e.svc.Plan(ctx, drv, tr.ID)
	if err != nil || plan.LastReview == nil {
		t.Fatalf("Plan = %+v, %v", plan, err)
	}
	r := plan.LastReview
	expect(t, "Plan.lastReview", r, r.Decision == "rework", r.Steps != nil && slices.Equal(*r.Steps, []fleetapi.ReworkStep{"photos"}),
		r.ReviewerMemberId == person("a.manager-msk1"), r.Attempt == 1)
}

// TestPlanReads: the trip card of the driver and the logist (getTripPlan, listTripPlans, S2-07): the scope of
// fleet.trips.read before pagination; a member with the driver function sees only his trips (D22); a foreign, an
// invisible and a missing trip are one 404.
func TestPlanReads(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	mine := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	theirs := seedTrip(t, "a", "msk1", person("a.driver-msk2"))
	far := seedTrip(t, "a", "msk2", person("a.driver-msk2"))
	checkPlan(t, e, mine)
	for _, c := range []struct {
		actor, tenant string
		id            uuid.UUID
	}{
		{"a.driver-msk2", "a", mine.ID},    // another driver of the unit (D22)
		{"a.manager-msk2", "a", mine.ID},   // the neighbouring firm
		{"a.driver-msk1", "a", uuid.New()}, // missing
		{"a.owner", "a", mine.Vehicle},     // not a trip
		{"b.owner", "b", mine.ID},          // another tenant (AC-02)
		{"a.driver-msk1", "a", theirs.ID},  // not his
		{"a.manager-msk1", "a", far.ID},    // outside the area
		{"a.driver-msk2", "a", uuid.Nil},   // nothing
	} {
		_, err := e.svc.Plan(t.Context(), e.tc(t, c.actor, c.tenant), c.id)
		wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	}
	sees := func(actor string, q trips.PlanQuery, want, not []uuid.UUID) {
		t.Helper()
		got := planIDs(t, e, actor, q)
		for _, id := range want {
			expect(t, actor+" sees", got, slices.Contains(got, id))
		}
		for _, id := range not {
			expect(t, actor+" does not see", got, !slices.Contains(got, id))
		}
	}
	sees("a.driver-msk1", trips.PlanQuery{}, []uuid.UUID{mine.ID}, []uuid.UUID{theirs.ID, far.ID})
	sees("a.driver-msk2", trips.PlanQuery{Limit: 1}, []uuid.UUID{theirs.ID, far.ID}, []uuid.UUID{mine.ID})
	sees("a.manager-msk1", trips.PlanQuery{Limit: 2}, []uuid.UUID{mine.ID, theirs.ID}, []uuid.UUID{far.ID})
	sees("a.region-msk", trips.PlanQuery{Driver: person("a.driver-msk2")}, []uuid.UUID{theirs.ID, far.ID}, []uuid.UUID{mine.ID})
	sees("a.region-msk", trips.PlanQuery{Unit: ref("unit:a.msk2")}, []uuid.UUID{far.ID}, []uuid.UUID{mine.ID})
	sees("a.owner", trips.PlanQuery{States: []string{"on_route"}}, nil, []uuid.UUID{mine.ID})
	_, err := e.svc.Plans(t.Context(), e.tc(t, "a.owner", "a"), trips.PlanQuery{Cursor: "garbage"})
	wantProblem(t, err, problem.CodeMalformedRequest, "")
	_, err = e.svc.Plans(t.Context(), e.tc(t, "a.owner", "a"), trips.PlanQuery{States: []string{"flying"}})
	wantProblem(t, err, problem.CodeMalformedRequest, "")
}

// checkPlan reads the seeded trip mine as its driver and checks the projection.
func checkPlan(t *testing.T, e env, mine trip) {
	t.Helper()
	p, err := e.svc.Plan(t.Context(), e.tc(t, "a.driver-msk1", "a"), mine.ID)
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	expect(t, "Plan", p, p.Number == mine.Number, p.Title == "Северный маршрут", p.State == "inspection",
		p.OrgUnitId == mine.Unit, p.VehicleId != nil && *p.VehicleId == mine.Vehicle,
		p.DriverMemberId != nil && *p.DriverMemberId == mine.Driver,
		p.DriverDisplayName != nil && *p.DriverDisplayName == "Водитель Москва-1",
		p.ReservationId != nil && *p.ReservationId == mine.Reservation,
		p.HoldExpiresAt != nil && p.HoldExpiresAt.Equal(e.now.Add(30*time.Minute)),
		p.DepartureInspectionId != nil && *p.DepartureInspectionId == mine.Departure,
		p.PlannedWindow.TimeZone == "Europe/Moscow", p.PlannedWindow.StartsAt.Equal(e.now.Add(-90*time.Minute)),
		p.DistanceKm != nil && *p.DistanceKm == "46", p.BlockingDefectId == nil, p.LastReview == nil)
	expect(t, "Plan.cargo", p.Cargo,
		p.Cargo == fleetapi.TripCargo{Description: "Сухой груз · 14 паллет-мест", WeightKg: "1100", VolumeM3: "12", LengthM: "3"})
	if len(p.Stops) != 2 {
		t.Fatalf("Plan.stops = %+v", p.Stops)
	}
	s0, s1 := p.Stops[0], p.Stops[1]
	expect(t, "Plan.stops", p.Stops, s0.Sequence == 1, s0.Op == "load", s0.Address == "Склад № 1, Лобня", s0.WeightKg == "1100",
		s1.Op == "unload", s1.VolumeM3 == "8", s1.PlannedAt != nil && s1.PlannedAt.Equal(e.now.Add(-15*time.Minute)))
}

// planIDs lists every page of listTripPlans of actor.
func planIDs(t *testing.T, e env, actor string, q trips.PlanQuery) []uuid.UUID {
	t.Helper()
	var out []uuid.UUID
	for {
		page, err := e.svc.Plans(t.Context(), e.tc(t, actor, "a"), q)
		if err != nil {
			t.Fatalf("Plans(%s): %v", actor, err)
		}
		for _, it := range page.Items {
			out = append(out, it.Id)
		}
		if page.NextCursor == nil {
			return out
		}
		q.Cursor = *page.NextCursor
	}
}

// TestTripReads: the 0.1 Trip exists from the start on (getTrip, listTrips).
func TestTripReads(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	waiting := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	_, err := e.svc.Trip(ctx, drv, waiting.ID)
	wantProblem(t, err, problem.CodeNotFound, "Рейс ещё не начат.")
	tr := onRoute(t, e)
	got, err := e.svc.Trip(ctx, drv, tr.ID)
	if err != nil || got.Id != tr.ID || got.Status != fleetapi.TripStatusInProgress {
		t.Fatalf("Trip = %+v, %v", got, err)
	}
	_, err = e.svc.Trip(ctx, e.tc(t, "a.manager-msk2", "a"), tr.ID)
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	page, err := e.svc.Trips(ctx, drv, trips.PageQuery{})
	if err != nil {
		t.Fatalf("Trips: %v", err)
	}
	seen := make([]uuid.UUID, 0, len(page.Items))
	for _, it := range page.Items {
		seen = append(seen, it.Id)
	}
	expect(t, "Trips", seen, slices.Contains(seen, tr.ID), !slices.Contains(seen, waiting.ID))
}

// TestPlanHoldAndDefect: the card shows the reservation of the trip while its hold is not released, and the blocking
// defect of its departure while the trip waits for the manager (defect_review) — as the TripPlan of W2.03.
func TestPlanHoldAndDefect(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	d := db(t, "a")
	owner := e.tc(t, "a.owner", "a")
	released := seedTrip(t, "a", "msk1", person("a.driver-msk2"))
	exec(t, d, `update sched.reservations set state = 'released' where bundle_id = $1`, released.Reservation)
	p, err := e.svc.Plan(t.Context(), owner, released.ID)
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	expect(t, "released hold", p, p.ReservationId == nil, p.HoldExpiresAt == nil)

	review := seedTrip(t, "a", "msk1", person("a.driver-msk2"))
	defect := uuid.New()
	exec(t, d, `insert into fleet.defects (id, vehicle_id, inspection_id, trip_id, zone, severity, description, state, reported_by)
	            values ($1, $2, $3, $4, 'Шины и колёса', 'blocking', 'Порез боковины', 'in_review', $5)`,
		defect, review.Vehicle, review.Departure, review.ID, person("a.driver-msk2"))
	p, err = e.svc.Plan(t.Context(), owner, review.ID)
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	expect(t, "defect outside defect_review", p, p.BlockingDefectId == nil)
	exec(t, d, `update fleet.trips set state = 'defect_review' where id = $1`, review.ID)
	p, err = e.svc.Plan(t.Context(), owner, review.ID)
	if err != nil {
		t.Fatalf("Plan: %v", err)
	}
	expect(t, "defect in defect_review", p, p.BlockingDefectId != nil && *p.BlockingDefectId == defect)
}
