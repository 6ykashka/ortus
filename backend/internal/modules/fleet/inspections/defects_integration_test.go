//go:build integration

package inspections_test

import (
	"slices"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections" //nolint:depguard // the package under test
	harness "github.com/ortus/ortus-crm/backend/test"                       //nolint:depguard // integration test: clock of the suites
)

// wantNotice checks that the notification title about the trip reaches every actor of to and none of not.
func wantNotice(t *testing.T, tr trip, kind, title string, to, not []string) {
	t.Helper()
	for _, who := range to {
		if got := notices(t, tr.tenant, person(who), kind, tr.ID); !slices.Contains(got, title) {
			t.Errorf("%s: %v, want %q", who, got, title)
		}
	}
	for _, who := range not {
		if got := notices(t, tr.tenant, person(who), kind, tr.ID); slices.Contains(got, title) {
			t.Errorf("%s got %q", who, title)
		}
	}
}

func inspectionsQuery(limit int) inspections.PageQuery { return inspections.PageQuery{Limit: limit} }

func inspectionsCursor(c string) inspections.PageQuery { return inspections.PageQuery{Cursor: c} }

func etag(rev int64) string { return `"` + strconv.FormatInt(rev, 10) + `"` }

// S2-05, S2-17 п. 1: a blocking defect on departure puts the inspection to requires_review, the defect to the
// queue (in_review), the trip to «Дефект на проверке», the vehicle out of reach (note) and keeps the reservation for
// the trip; the managers of the area and the owner get «Критический дефект: …», the manager of the neighbouring
// firm and the driver do not.
func TestBlockingDefect(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	minor := fleetapi.InspectionDefectReport{Zone: "Кузов", Description: "Скол на бампере", Severity: "minor"}
	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr, critical("Шины и колёса"), minor))
	if err != nil {
		t.Fatal(err)
	}
	expect(t, "inspection", got, got.Status == "requires_review", got.Defects != nil && len(*got.Defects) == 2)
	defects := *got.Defects
	blocking := defects[slices.IndexFunc(defects, func(d fleetapi.InspectionDefect) bool { return d.Severity == "blocking" })]
	open := defects[slices.IndexFunc(defects, func(d fleetapi.InspectionDefect) bool { return d.Severity == "minor" })]
	expect(t, "defects", defects, blocking.State == "in_review", open.State == "open", blocking.TripId != nil && *blocking.TripId == tr.ID,
		blocking.ReportedByMemberId == person("a.driver-msk1"), blocking.Revision == 1, blocking.Zone == "Шины и колёса",
		blocking.TripNumber != nil && *blocking.TripNumber == tr.Number, blocking.RegistrationNumber != nil && *blocking.RegistrationNumber == tr.Plate,
		blocking.VehicleDisplayName != nil && *blocking.VehicleDisplayName == tr.VehicleName,
		blocking.DriverDisplayName != nil && *blocking.DriverDisplayName == "Водитель Москва-1")
	d := db(t, "a")
	trip := scalar[string](t, d, `select state from fleet.trips where id = $1`, tr.ID)
	note := scalar[string](t, d, `select coalesce(service_note, '') from fleet.vehicles where id = $1`, tr.Vehicle)
	hold := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
	expect(t, "trip, vehicle, reservation", []string{trip, note, hold}, trip == "defect_review", note == "критический дефект на проверке", hold == "confirmed")
	title := "Критический дефект: Газель Next " + tr.Plate + " — Шины и колёса. Выезд заблокирован."
	wantNotice(t, tr, "fleet.defect.blocking_reported", title, []string{"a.manager-msk1", "a.region-msk", "a.owner", "a.two-roles"},
		[]string{"a.manager-msk2", "a.driver-msk1", "ab.member"})
	events := scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.defect.blocking_reported.v1' and aggregate_id = $1`, blocking.Id)
	expect(t, "event", events, events == 1)
	// The queue of the manager (state in_review, oldest first) and the card read by the driver.
	page, err := e.svc.Defects(ctx, e.tc(t, "a.manager-msk1", "a"), inspections.DefectQuery{States: []string{"in_review"}, TripID: tr.ID})
	expect(t, "queue", page, err == nil, len(page.Items) == 1 && page.Items[0].Id == blocking.Id)
	page, err = e.svc.Defects(ctx, e.tc(t, "a.manager-msk2", "a"), inspections.DefectQuery{TripID: tr.ID})
	expect(t, "queue of the neighbouring firm", page, err == nil, len(page.Items) == 0)
	page, err = e.svc.Defects(ctx, e.tc(t, "a.owner", "a"), inspections.DefectQuery{VehicleID: tr.Vehicle})
	expect(t, "every state of the vehicle", page, err == nil, len(page.Items) == 2)
	card, err := e.svc.Defect(ctx, e.tc(t, "a.driver-msk1", "a"), blocking.Id)
	expect(t, "driver reads his defect", card, err == nil, card.State == "in_review")
	for _, c := range []struct{ actor, tenant string }{{"a.manager-msk2", "a"}, {"b.owner", "b"}} {
		if _, err := e.svc.Defect(ctx, e.tc(t, c.actor, c.tenant), blocking.Id); !isCode(err, "not_found") {
			t.Errorf("%s: %v, want not_found", c.actor, err)
		}
	}
	if _, err := e.svc.Defects(ctx, e.tc(t, "a.owner", "a"), inspections.DefectQuery{States: []string{"lost"}}); !isCode(err, "malformed_request") {
		t.Errorf("unknown state: %v", err)
	}
}

// S2-17 п. 2: «Дефект некритичный — разрешить выезд» — the defect is resolved with the decision and its author, the
// inspection approved, the trip back to «Осмотр перед выездом» with the vehicle held again for 30 minutes; the
// driver is told; the decision is audited. A repeat after the decision is 409 «Дефект уже решён.» (п. 4).
func TestDecideAllow(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	insp := e.blocked(t, tr)
	defect := (*insp.Defects)[0]
	manager := e.tc(t, "a.manager-msk1", "a")
	comment := "Шина держит давление, до шиномонтажа доедет"
	got, err := e.svc.Decide(ctx, manager, defect.Id, etag(defect.Revision), fleetapi.DefectDecision{Decision: "allow_departure", Comment: &comment})
	if err != nil {
		t.Fatal(err)
	}
	expect(t, "defect", got, got.State == "resolved", got.Decision != nil && *got.Decision == "allow_departure",
		got.DecisionComment != nil && *got.DecisionComment == comment, got.DecidedByMemberId != nil && *got.DecidedByMemberId == person("a.manager-msk1"),
		got.DecidedAt != nil && got.DecidedAt.Equal(harness.Now()), got.Revision == 2)
	d := db(t, "a")
	state := scalar[string](t, d, `select t.state||'/'||i.state from fleet.trips t join fleet.inspections i on i.id = t.departure_inspection_id where t.id = $1`, tr.ID)
	note := scalar[string](t, d, `select coalesce(service_note, '')||'/'||service_state from fleet.vehicles where id = $1`, tr.Vehicle)
	hold := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
	until := scalar[time.Time](t, d, `select hold_expires_at from sched.reservations where id = $1`, tr.Reservation)
	expect(t, "trip, inspection, vehicle, reservation", []any{state, note, hold, until}, state == "inspection/approved", note == "/ok",
		hold == "hold", until.Equal(harness.Now().Add(30*time.Minute)))
	read, err := e.svc.Inspection(ctx, manager, insp.Id)
	expect(t, "inspection status", read, err == nil, read.Status == "approved")
	if got := notices(t, "a", person("a.driver-msk1"), "fleet.defect.decided", tr.ID); !slices.Equal(got, []string{"Менеджер разрешил выезд: дефект признан некритичным"}) {
		t.Errorf("driver notices %v", got)
	}
	audit := scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.defect.decide' and target_id = $1 and actor_id = $2`,
		defect.Id, person("a.manager-msk1"))
	events := scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.defect.decided.v1' and aggregate_id = $1`, defect.Id)
	expect(t, "audit and event", []int{audit, events}, audit == 1, events == 1)
	_, err = e.svc.Decide(ctx, e.tc(t, "a.owner", "a"), defect.Id, etag(got.Revision), fleetapi.DefectDecision{Decision: "confirm_out_of_service"})
	wantCode(t, err, "invalid_transition")
	_, err = e.svc.Decide(ctx, e.tc(t, "a.owner", "a"), defect.Id, etag(defect.Revision), fleetapi.DefectDecision{Decision: "confirm_out_of_service"})
	wantCode(t, err, "invalid_transition") // the state goes first: a stale If-Match after someone's decision is 409
}

// S2-17 п. 3: «Подтвердить неисправность» — the defect confirmed_out_of_service, the inspection rejected, the vehicle
// «Недоступна · неисправность подтверждена», the reservation released, the trip «Запланирован» without a vehicle; the
// driver is told to choose another vehicle; a new departure of the trip with another vehicle is attempt 2.
func TestDecideConfirm(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	insp := e.blocked(t, tr)
	defect := (*insp.Defects)[0]
	got, err := e.svc.Decide(ctx, e.tc(t, "a.region-msk", "a"), defect.Id, etag(defect.Revision), fleetapi.DefectDecision{Decision: "confirm_out_of_service"})
	expect(t, "defect", got, err == nil, got.State == "confirmed_out_of_service", got.Decision != nil && *got.Decision == "confirm_out_of_service")
	d := db(t, "a")
	trip := scalar[string](t, d, `select state||'/'||coalesce(vehicle_id::text, '-')||'/'||coalesce(departure_inspection_id::text, '-') from fleet.trips where id = $1`, tr.ID)
	vehicle := scalar[string](t, d, `select service_state||'/'||coalesce(service_note, '') from fleet.vehicles where id = $1`, tr.Vehicle)
	hold := scalar[string](t, d, `select state from sched.reservations where id = $1`, tr.Reservation)
	expect(t, "trip, vehicle, reservation", []string{trip, vehicle, hold}, trip == "planned/-/-", vehicle == "out_of_service/неисправность подтверждена", hold == "released")
	read, err := e.svc.Inspection(ctx, e.tc(t, "a.owner", "a"), insp.Id)
	expect(t, "inspection status", read, err == nil, read.Status == "rejected")
	want := "Неисправность подтверждена. Выберите другую машину для рейса " + tr.Number
	if got := notices(t, "a", person("a.driver-msk1"), "fleet.defect.decided", tr.ID); !slices.Equal(got, []string{want}) {
		t.Errorf("driver notices %v, want %q", got, want)
	}
	// Another vehicle for the same trip (what reserveVehicle of W2.02 does): the departure is attempt 2.
	next := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	exec(t, d, `delete from sched.reservations where id = $1`, next.Reservation)
	exec(t, d, `delete from fleet.trips where id = $1`, next.ID)
	exec(t, d, `update fleet.trips set state = 'inspection', vehicle_id = $2 where id = $1`, tr.ID, next.Vehicle)
	exec(t, d, `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at, source_type, source_id, created_by)
	            values ($1, $2, gen_random_uuid(), tstzrange($3, $4), tstzrange($3, $4), 'hold', $5, 'fleet.trip', $6, $7)`,
		next.Reservation, next.resource, harness.Now(), harness.Now().Add(8*time.Hour), harness.Now().Add(30*time.Minute), tr.ID, person("a.driver-msk1"))
	again := tr
	again.Vehicle, again.Reservation = next.Vehicle, next.Reservation
	second, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, again))
	expect(t, "attempt 2", second, err == nil, second.Attempt != nil && *second.Attempt == 2, second.Status == "submitted")
}

// If-Match (428, 412), the scope (another firm 404, the driver who sees his defect but cannot decide 403, another
// tenant 404) and the body (422) of a decision; a defect that is not blocking never waits in the queue (409).
func TestDecideRejects(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	insp := e.blocked(t, tr)
	defect := (*insp.Defects)[0]
	allow := fleetapi.DefectDecision{Decision: "allow_departure"}
	manager := e.tc(t, "a.manager-msk1", "a")
	cases := []struct {
		name    string
		actor   string
		tenant  string
		ifMatch string
		body    fleetapi.DefectDecision
		code    string
	}{
		{"без If-Match", "a.manager-msk1", "a", "", allow, "revision_required"},
		{"устаревший If-Match", "a.manager-msk1", "a", etag(defect.Revision + 1), allow, "revision_mismatch"},
		{"соседняя фирма", "a.manager-msk2", "a", etag(defect.Revision), allow, "not_found"},
		{"водитель", "a.driver-msk1", "a", etag(defect.Revision), allow, "forbidden_action"},
		{"другой тенант", "b.owner", "b", etag(defect.Revision), allow, "not_found"},
		{"решение", "a.manager-msk1", "a", etag(defect.Revision), fleetapi.DefectDecision{Decision: "repair"}, "validation_failed"},
	}
	for _, c := range cases {
		if _, err := e.svc.Decide(ctx, e.tc(t, c.actor, c.tenant), defect.Id, c.ifMatch, c.body); !isCode(err, c.code) {
			t.Errorf("%s: %v, want %s", c.name, err, c.code)
		}
	}
	if _, err := e.svc.Decide(ctx, manager, uuid.New(), etag(1), allow); !isCode(err, "not_found") {
		t.Errorf("missing defect: %v", err)
	}
	minorTrip := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	minor, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, minorTrip,
		fleetapi.InspectionDefectReport{Zone: "Салон", Description: "Порван чехол", Severity: "minor"}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Decide(ctx, manager, (*minor.Defects)[0].Id, etag(1), allow); !isCode(err, "invalid_transition") {
		t.Errorf("open minor defect: %v", err)
	}
	still := scalar[string](t, db(t, "a"), `select state from fleet.defects where id = $1`, defect.Id)
	expect(t, "defect untouched", still, still == "in_review")
}

// S2-17 п. 4: two managers decide at once — exactly one decision, the others 409 invalid_transition.
func TestDecideConcurrent(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	defect := (*e.blocked(t, tr).Defects)[0]
	actors := []string{"a.manager-msk1", "a.region-msk", "a.owner", "a.two-roles", "a.manager-msk1", "a.region-msk"}
	decisions := []string{"allow_departure", "confirm_out_of_service"}
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		ok   int
		lost int
	)
	for i, actor := range actors {
		tc := e.tc(t, actor, "a")
		wg.Go(func() {
			_, err := e.svc.Decide(t.Context(), tc, defect.Id, etag(defect.Revision),
				fleetapi.DefectDecision{Decision: fleetapi.DefectDecisionDecision(decisions[i%2])})
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case isCode(err, "invalid_transition"):
				lost++
			default:
				t.Errorf("%s: %v", actor, err)
			}
		})
	}
	wg.Wait()
	expect(t, "one decision", []int{ok, lost}, ok == 1, lost == len(actors)-1)
	n := scalar[int](t, db(t, "a"), `select count(*) from audit.events where action = 'fleet.defect.decide' and target_id = $1`, defect.Id)
	expect(t, "one audit row", n, n == 1)
}
