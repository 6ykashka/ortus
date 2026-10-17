//go:build integration

package trips_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func start(tr trip) fleetapi.TripStart {
	return fleetapi.TripStart{ReservationId: tr.Reservation, DepartureInspectionId: tr.Departure}
}

// TestStartTrip: the driver starts the trip by its reservation (S2-06) — one transaction consumes the hold, the trip
// goes on the route, the audit and the outbox get their rows, the managers of the area are notified.
func TestStartTrip(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	release(t, tr)
	got, err := e.svc.Start(t.Context(), e.tc(t, "a.driver-msk1", "a"), start(tr))
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	expect(t, "Start", got, got.Id == tr.ID, got.Status == fleetapi.TripStatusInProgress, got.VehicleId == tr.Vehicle,
		got.DriverMemberId == tr.Driver, got.DepartureInspectionId == tr.Departure, got.OrgUnitId == tr.Unit,
		got.StartedAt.Equal(e.now), got.ReturnInspectionId == nil)
	d := db(t, "a")
	s, rev := state(t, tr)
	expect(t, "trip", s, s == "on_route", rev == got.Revision)
	count := func(q string, args ...any) int { t.Helper(); return scalar[int](t, d, q, args...) }
	expect(t, "consumed rows of the bundle", nil,
		count(`select count(*) from sched.reservations where bundle_id = $1 and state = 'consumed'`, tr.Reservation) == 1)
	expect(t, "audit rows", nil, count(`select count(*) from audit.events where action = 'fleet.trip.start' and target_id = $1`, tr.ID) == 1)
	expect(t, "outbox rows", nil,
		count(`select count(*) from outbox.events where type = 'fleet.trip.started.v1' and aggregate_id = $1`, tr.ID) == 1)
	titles := scalar[string](t, d, `select coalesce(string_agg(distinct title, '|'), '') from notify.notifications
	   where kind = 'fleet.trip.started' and entity_id = $1`, tr.ID)
	expect(t, "notification titles", titles, titles == "Рейс "+tr.Number+" начат · ГАЗель Next")
	const notices = `select count(*) from notify.notifications where kind = 'fleet.trip.started' and entity_id = $1
	   and recipient_person_id = $2`
	expect(t, "notification of the manager of the unit", nil, count(notices, tr.ID, person("a.manager-msk1")) == 1)
	expect(t, "notification of the neighbouring firm", nil, count(notices, tr.ID, person("a.manager-msk2")) == 0)
	plan, err := e.svc.Plan(t.Context(), e.tc(t, "a.driver-msk1", "a"), tr.ID)
	if err != nil {
		t.Fatalf("Plan after the start: %v", err)
	}
	expect(t, "Plan after the start", plan, plan.State == "on_route", plan.StartedAt != nil, plan.Revision == got.Revision,
		plan.HoldExpiresAt == nil)
}

// TestStartTripLegalEntity: the trip takes the legal entity of its company by default (answer of 17.10, data model
// item 1): the nearest unit up the tree that has one.
func TestStartTripLegalEntity(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	d := db(t, "a")
	region, firm := uuid.New(), uuid.New()
	exec(t, d, `insert into org.legal_entities (id, name, inn) values ($1, 'ООО «Холдинг»', '7701000001'), ($2, 'ООО «Москва-3»', '7701000003')`, region, firm)
	exec(t, d, `insert into org.unit_legal_entities (unit_id, legal_entity_id) values ($1, $2), ($3, $4)`,
		ref("unit:a.msk"), region, ref("unit:a.msk3"), firm)
	tr := seedTrip(t, "a", "msk3", person("a.driver-msk1"))
	release(t, tr)
	if _, err := e.svc.Start(t.Context(), e.tc(t, "a.owner", "a"), start(tr)); err != nil {
		t.Fatalf("Start by the owner: %v", err)
	}
	if got := scalar[uuid.UUID](t, d, `select legal_entity_id from fleet.trips where id = $1`, tr.ID); got != firm {
		t.Fatalf("legal entity %s, want the one of the company %s", got, firm)
	}
	plan, err := e.svc.Plan(t.Context(), e.tc(t, "a.owner", "a"), tr.ID)
	if err != nil || plan.LegalEntityId == nil || *plan.LegalEntityId != firm {
		t.Fatalf("Plan.legalEntityId = %+v, %v", plan.LegalEntityId, err)
	}
}

// TestStartTripRefusals: what the start refuses, with the texts of the mock W2.00.
func TestStartTripRefusals(t *testing.T) { //nolint:paralleltest // starts a trip of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	drv := e.tc(t, "a.driver-msk1", "a")
	ctx := t.Context()

	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	release(t, tr)
	_, err := e.svc.Start(ctx, drv, fleetapi.TripStart{ReservationId: uuid.New(), DepartureInspectionId: tr.Departure})
	wantProblem(t, err, problem.CodeNotFound, "Бронь не найдена.")
	_, err = e.svc.Start(ctx, e.tc(t, "a.driver-msk2", "a"), start(tr))
	wantProblem(t, err, problem.CodeNotFound, "Бронь не найдена.") // a driver sees only his trips
	_, err = e.svc.Start(ctx, e.tc(t, "a.manager-msk2", "a"), start(tr))
	wantProblem(t, err, problem.CodeNotFound, "Бронь не найдена.") // the neighbouring firm
	_, err = e.svc.Start(ctx, e.tc(t, "a.manager-msk1", "a"), start(tr))
	wantProblem(t, err, problem.CodeForbiddenAction, "") // the manager sees the trip, the start is the driver's
	_, err = e.svc.Start(ctx, e.tc(t, "b.owner", "b"), start(tr))
	wantProblem(t, err, problem.CodeNotFound, "Бронь не найдена.") // another tenant (AC-02)

	other := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	_, err = e.svc.Start(ctx, drv, fleetapi.TripStart{ReservationId: tr.Reservation, DepartureInspectionId: other.Departure})
	wantProblem(t, err, "validation_failed", "Нужен осмотр перед выездом этого рейса.")

	d := db(t, "a")
	exec(t, d, `insert into fleet.defects (vehicle_id, inspection_id, trip_id, zone, severity, description, state, reported_by)
	            values ($1, $2, $3, 'Шины и колёса', 'blocking', 'Порез боковины', 'in_review', $4)`,
		other.Vehicle, other.Departure, other.ID, person("a.driver-msk1"))
	_, err = e.svc.Start(ctx, drv, start(other))
	wantProblem(t, err, "blocking_defect_open", "Выезд заблокирован: дефект на проверке менеджера.")

	expired := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	exec(t, d, `update sched.reservations set hold_expires_at = $2 where bundle_id = $1`, expired.Reservation, e.now.Add(-time.Minute))
	_, err = e.svc.Start(ctx, drv, start(expired))
	wantProblem(t, err, "reservation_expired", "Бронь истекла. Забронируйте машину снова.")

	if _, err := e.svc.Start(ctx, drv, start(tr)); err != nil {
		t.Fatalf("Start: %v", err)
	}
	_, err = e.svc.Start(ctx, drv, start(tr))
	wantProblem(t, err, "invalid_transition", "Бронь уже использована или снята.")

	// The driver is on the route already: a second trip of his is 409 (trips_active_driver_uq).
	busy := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	_, err = e.svc.Start(ctx, drv, start(busy))
	wantProblem(t, err, "resources_unavailable", "Водитель уже в другом рейсе.")
	if s, _ := state(t, busy); s != "inspection" {
		t.Fatalf("refused trip moved to %s", s)
	}
}

// TestStartTripConcurrent: two starts of one reservation at once — exactly one succeeds, the other is 409
// invalid_transition; the hold is consumed once (AC-03 for the start, W2.30).
func TestStartTripConcurrent(t *testing.T) { //nolint:paralleltest // starts trips of a.driver-msk1: one trip on the route per driver
	e := newEnv(t)
	drv := e.tc(t, "a.driver-msk1", "a")
	for round := range 5 {
		tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
		var (
			wg   sync.WaitGroup
			errs = make([]error, 2)
		)
		for i := range errs {
			wg.Go(func() {
				_, errs[i] = e.svc.Start(t.Context(), drv, start(tr))
			})
		}
		wg.Wait()
		ok, conflicts := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				ok++
			case problem.Is(err, "invalid_transition"):
				conflicts++
			default:
				t.Fatalf("round %d: unexpected error %v", round, err)
			}
		}
		if ok != 1 || conflicts != 1 {
			t.Fatalf("round %d: %d starts, %d conflicts; want 1 and 1", round, ok, conflicts)
		}
		if n := scalar[int](t, db(t, "a"), `select count(*) from audit.events where action = 'fleet.trip.start' and target_id = $1`, tr.ID); n != 1 {
			t.Fatalf("round %d: %d audit rows of the start", round, n)
		}
		exec(t, db(t, "a"), `update fleet.trips set state = 'accepted' where id = $1`, tr.ID)
	}
}
