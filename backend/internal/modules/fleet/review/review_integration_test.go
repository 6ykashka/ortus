//go:build integration

package review_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// activeTripsSQL counts the trips that hold a vehicle (W2.02 derives «на приёмке» / «в рейсе» from them).
const activeTripsSQL = `select count(*) from fleet.trips where vehicle_id = $1
  and state in ('assigned', 'inspection', 'defect_review', 'on_route', 'returning', 'submitted', 'rework')`

// TestReviewApprove: the manager of the unit accepts a submitted shift — the trip is accepted, the vehicle is free
// (no active trip, the odometer of the return inspection, the consumed reservation ends now), the claimed expenses are
// confirmed (Q-W2.21-5), the round is written to fleet.trip_reviews with the audit, the event and the notification
// of the driver; a second decision is 409.
func TestReviewApprove(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sh := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
	d := db(t, "a")
	manager := e.tc(t, "a.manager-msk1", "a")
	_, rev := state(t, sh)
	out, err := e.svc.Review(t.Context(), manager, sh.ID, etag(rev), fleetapi.TripReview{
		Decision: fleetapi.TripReviewDecisionApprove, Comment: new("Без замечаний")})
	if err != nil {
		t.Fatalf("Review: %v", err)
	}
	expect(t, "Trip", out, out.Id == sh.ID, out.Status == fleetapi.TripStatusApproved, out.Revision == rev+1,
		out.ReturnInspectionId != nil && *out.ReturnInspectionId == sh.Return, out.VehicleId == sh.Vehicle)
	var (
		st         string
		reviewedBy uuid.UUID
		reviewedAt time.Time
	)
	if err := d.QueryRowContext(t.Context(), `select state, reviewed_by, reviewed_at from fleet.trips where id = $1`, sh.ID).
		Scan(&st, &reviewedBy, &reviewedAt); err != nil {
		t.Fatal(err)
	}
	expect(t, "trip row", st, st == "accepted", reviewedBy == person("a.manager-msk1"), reviewedAt.Equal(e.now))
	var (
		attempt  int
		decision string
		comment  string
	)
	if err := d.QueryRowContext(t.Context(), `select attempt, decision, comment from fleet.trip_reviews where trip_id = $1`, sh.ID).
		Scan(&attempt, &decision, &comment); err != nil {
		t.Fatal(err)
	}
	expect(t, "trip_reviews", decision, attempt == 1, decision == "approve", comment == "Без замечаний")
	if n := scalar[int](t, d, `select count(*) from fleet.expenses where trip_id = $1 and state = 'verified' and reviewed_by = $2
	    and reviewed_at = $3`, sh.ID, person("a.manager-msk1"), e.now); n != 2 {
		t.Fatalf("confirmed expenses: %d, want 2", n)
	}
	if n := scalar[int](t, d, activeTripsSQL, sh.Vehicle); n != 0 {
		t.Fatalf("active trips of the vehicle after the acceptance: %d, want 0 (the vehicle is free)", n)
	}
	if km := scalar[float64](t, d, `select odometer_km::float8 from fleet.vehicles where id = $1`, sh.Vehicle); km != returnKm {
		t.Fatalf("odometer of the vehicle: %v, want %d (the return inspection)", km, returnKm)
	}
	if end := scalar[time.Time](t, d, `select upper(occupied) from sched.reservations where id = $1`, sh.Bundle); !end.Equal(e.now) {
		t.Fatalf("consumed reservation ends %v, want the acceptance %v", end, e.now)
	}
	for _, c := range []struct {
		q    string
		args []any
	}{
		{`select count(*) from audit.events where action = 'fleet.trip.review' and target_id = $1`, []any{sh.ID}},
		{`select count(*) from outbox.events where type = 'fleet.trip.reviewed.v1' and aggregate_id = $1`, []any{sh.ID}},
		{`select count(*) from notify.notifications where kind = 'fleet.trip.accepted' and entity_id = $1
		    and recipient_person_id = $2 and title = $3`, []any{sh.ID, sh.Driver, "Смена " + sh.Number + " принята. Машина свободна."}},
	} {
		if n := scalar[int](t, d, c.q, c.args...); n != 1 {
			t.Fatalf("%s: %d, want 1", c.q, n)
		}
	}
	_, err = e.svc.Review(t.Context(), manager, sh.ID, etag(out.Revision), fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove})
	wantProblem(t, err, "invalid_transition", "Смена уже обработана")
}

// TestReviewRework: the manager sends the shift back by sections — the trip is in rework, the vehicle stays held
// and the expenses wait; the driver is told the comment. After the second return the next decision is round 2.
func TestReviewRework(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sh := seedShift(t, "a", "msk1", person("a.driver-msk2"), "submitted")
	d := db(t, "a")
	manager := e.tc(t, "a.manager-msk1", "a")
	_, rev := state(t, sh)
	out, err := e.svc.Review(t.Context(), manager, sh.ID, etag(rev), fleetapi.TripReview{
		Decision: fleetapi.TripReviewDecisionRework, Comment: new("Нет фото слева"),
		Steps: &[]fleetapi.ReworkStep{fleetapi.ReworkStepPhotos, fleetapi.ReworkStepExpenses}})
	if err != nil {
		t.Fatalf("Review(rework): %v", err)
	}
	expect(t, "Trip", out, out.Status == fleetapi.TripStatusInProgress, out.Revision == rev+1)
	if st, _ := state(t, sh); st != "rework" {
		t.Fatalf("state %s, want rework", st)
	}
	if steps := scalar[string](t, d, `select array_to_string(steps, ',') from fleet.trip_reviews where trip_id = $1 and attempt = 1
	    and decision = 'rework'`, sh.ID); steps != "photos,expenses" {
		t.Fatalf("steps %q, want photos,expenses", steps)
	}
	if n := scalar[int](t, d, activeTripsSQL, sh.Vehicle); n != 1 {
		t.Fatalf("active trips of the vehicle in rework: %d, want 1 (the vehicle stays held)", n)
	}
	if n := scalar[int](t, d, `select count(*) from fleet.expenses where trip_id = $1 and state = 'claimed'`, sh.ID); n != 2 {
		t.Fatalf("waiting expenses in rework: %d, want 2", n)
	}
	if end := scalar[time.Time](t, d, `select upper(occupied) from sched.reservations where id = $1`, sh.Bundle); !end.Equal(sh.PlannedEnd) {
		t.Fatalf("reservation in rework ends %v, want the planned end %v", end, sh.PlannedEnd)
	}
	if n := scalar[int](t, d, `select count(*) from notify.notifications where kind = 'fleet.trip.rework_requested'
	    and recipient_person_id = $1 and title = $2`, sh.Driver, "Смена "+sh.Number+" возвращена на доработку: Нет фото слева"); n != 1 {
		t.Fatalf("rework notifications of the driver: %d, want 1", n)
	}
	_, err = e.svc.Review(t.Context(), manager, sh.ID, etag(out.Revision), fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove})
	wantProblem(t, err, "invalid_transition", "Смена уже обработана")
	// The driver returns the vehicle again (returnTrip, W2.05): the next decision is the second round.
	exec(t, d, `update fleet.trips set state = 'submitted', revision = revision + 1 where id = $1`, sh.ID)
	_, rev = state(t, sh)
	if _, err := e.svc.Review(t.Context(), manager, sh.ID, etag(rev), fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove}); err != nil {
		t.Fatalf("Review after the rework: %v", err)
	}
	if n := scalar[int](t, d, `select count(*) from fleet.trip_reviews where trip_id = $1 and attempt = 2 and decision = 'approve'`, sh.ID); n != 1 {
		t.Fatalf("second round: %d rows, want 1", n)
	}
}

// TestReviewMaintenance: accepted with the vehicle sent to maintenance — «Недоступна · нужен ремонт» (Q-W2.00-5).
func TestReviewMaintenance(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sh := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
	_, rev := state(t, sh)
	out, err := e.svc.Review(t.Context(), e.tc(t, "a.owner", "a"), sh.ID, etag(rev),
		fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionMaintenanceRequired, Comment: new("Стучит подвеска")})
	if err != nil {
		t.Fatalf("Review(maintenance_required): %v", err)
	}
	expect(t, "Trip", out, out.Status == fleetapi.TripStatusApproved)
	var service, note string
	if err := db(t, "a").QueryRowContext(t.Context(), `select service_state, coalesce(service_note, '') from fleet.vehicles where id = $1`,
		sh.Vehicle).Scan(&service, &note); err != nil {
		t.Fatal(err)
	}
	expect(t, "vehicle", service, service == "maintenance", note == "нужен ремонт")
	if n := scalar[int](t, db(t, "a"), `select count(*) from notify.notifications where kind = 'fleet.trip.accepted'
	    and recipient_person_id = $1 and title = $2`, sh.Driver, "Смена "+sh.Number+" принята. Машина отправлена в ремонт."); n != 1 {
		t.Fatalf("notifications of the driver: %d, want 1", n)
	}
}

// TestReviewRefusals: the body is checked first; a missing, foreign or invisible trip is one 404; the driver without
// the right is 403; the manager never accepts his own shift; If-Match is required and must be fresh; a shift that is
// not submitted is 409.
func TestReviewRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	sh := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
	_, rev := state(t, sh)
	approve := fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove}
	manager := e.tc(t, "a.manager-msk1", "a")
	_, err := e.svc.Review(t.Context(), manager, uuid.New(), etag(1), fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionRework,
		Steps: &[]fleetapi.ReworkStep{fleetapi.ReworkStepPhotos}})
	wantProblem(t, err, "validation_failed", "Опишите, что нужно исправить")
	_, err = e.svc.Review(t.Context(), manager, uuid.New(), etag(1), approve)
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.Review(t.Context(), e.tc(t, "a.manager-msk2", "a"), sh.ID, etag(rev), approve)
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.Review(t.Context(), e.tc(t, "b.owner", "b"), sh.ID, etag(rev), approve)
	wantProblem(t, err, problem.CodeNotFound, "")
	_, err = e.svc.Review(t.Context(), e.tc(t, "a.driver-msk1", "a"), sh.ID, etag(rev), approve)
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	_, err = e.svc.Review(t.Context(), manager, sh.ID, "", approve)
	wantProblem(t, err, "revision_required", "")
	_, err = e.svc.Review(t.Context(), manager, sh.ID, etag(rev+5), approve)
	wantProblem(t, err, "revision_mismatch", "Данные изменились. Обновите страницу и повторите.")
	own := seedShift(t, "a", "msk1", person("a.manager-msk1"), "submitted")
	_, orev := state(t, own)
	_, err = e.svc.Review(t.Context(), manager, own.ID, etag(orev), approve)
	wantProblem(t, err, problem.CodeForbiddenAction, "Свою смену принимает другой менеджер.")
	onRoute := seedShift(t, "a", "msk1", person("a.two-roles"), "on_route")
	_, rrev := state(t, onRoute)
	_, err = e.svc.Review(t.Context(), manager, onRoute.ID, etag(rrev), approve)
	wantProblem(t, err, "invalid_transition", "Смена уже обработана")
	if st, r := state(t, sh); st != "submitted" || r != rev {
		t.Fatalf("refused reviews changed the trip: %s %d", st, r)
	}
}

// TestReviewConcurrent: two managers accept one shift at once — exactly one decision, the other is 412 or 409.
func TestReviewConcurrent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	for round := range 3 {
		sh := seedShift(t, "a", "msk1", person("a.driver-msk1"), "submitted")
		_, rev := state(t, sh)
		var (
			wg   sync.WaitGroup
			mu   sync.Mutex
			errs []error
		)
		for _, actor := range []string{"a.manager-msk1", "a.owner"} {
			tc := e.tc(t, actor, "a")
			wg.Go(func() {
				_, err := e.svc.Review(t.Context(), tc, sh.ID, etag(rev), fleetapi.TripReview{Decision: fleetapi.TripReviewDecisionApprove})
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
			})
		}
		wg.Wait()
		ok := 0
		for _, err := range errs {
			switch {
			case err == nil:
				ok++
			case problem.Is(err, "revision_mismatch"), problem.Is(err, "invalid_transition"):
			default:
				t.Fatalf("round %d: unexpected error %v", round, err)
			}
		}
		if n := scalar[int](t, db(t, "a"), `select count(*) from fleet.trip_reviews where trip_id = $1`, sh.ID); ok != 1 || n != 1 {
			t.Fatalf("round %d: %d successes, %d reviews, want 1 and 1", round, ok, n)
		}
	}
}
