//go:build concurrency

// A shift of a driver through the API (S2-01…S2-12, the path of the demo): the logist registers a vehicle and plans
// a trip, the driver reserves the vehicle for the trip, submits the departure inspection, starts the trip, records an
// expense, finishes the route, returns the vehicle with the return inspection, the manager accepts the shift and the
// owner sets the earnings. Photos and receipts are ready rows of files.objects (no object storage in the suite).

package concurrency

import (
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// Actors of the fixtures (backend/test/isolation/README.md).
//
// The driver of the shifts is a.driver-msk2: his role «Водитель» on Москва-1 (a temporary assignment, the clock of
// the suite is inside it) opens the vehicles of the firm, as the group «Водители Север» does on the stand. The role of
// a.driver-msk1 is on «своё» only: fleet.vehicles.read has no column of «своё» (W2.02), so he sees no vehicle to
// reserve — he is a driver seat of the negatives (and gets a role on Москва-1 only for the race of two drivers,
// reserve_test.go). A temporary driver is not in members.read of the logist (Q-W2.03-3), so the owner plans the trips.
const (
	owner      = "a.owner"
	logist     = "a.manager-msk1" // Менеджер логистики Москвы-1: приёмка, расходы, решения по дефектам
	region     = "a.region-msk"   // менеджер региона Москва с потомками
	driver     = "a.driver-msk2"  // водитель смен: роль «Водитель» на Москва-1 (временное назначение)
	selfDriver = "a.driver-msk1"  // водитель Москвы-1 с ролью на «своё»
	neighbour  = "a.manager-msk2" // менеджер соседней фирмы Москва-2
	observer   = "ab.member"      // наблюдатель Москвы-2 в A и в B
	foreign    = "b.owner"        // владелец другой организации
	namesake   = "b.manager-msk1" // менеджер фирмы-тёзки Москва-1 в B
)

// ref resolves a reference of the fixtures.
func ref(t *testing.T, r string) uuid.UUID {
	t.Helper()
	id, err := world.ID(r)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// person is the person of actor in tenant A.
func person(t *testing.T, actor string) uuid.UUID { t.Helper(); return ref(t, "person:"+actor+"@a") }

// fleetOf is the base path of the fleet operations of tenant («a» or «b»).
func fleetOf(t *testing.T, tenant string) string {
	t.Helper()
	return "/api/v1/tenants/" + ref(t, "tenant:"+tenant).String() + "/fleet"
}

// fleet is the base path of the fleet operations of tenant A.
func fleet(t *testing.T) string { t.Helper(); return fleetOf(t, fixtures.TenantA) }

// db is the tenant DB of tenant as the superuser.
func db(t *testing.T, tenant string) *sql.DB {
	t.Helper()
	d, ok := dbs[tenant]
	if !ok {
		t.Fatalf("no tenant %q", tenant)
	}
	return d
}

func execSQL(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := db(t, fixtures.TenantA).ExecContext(t.Context(), q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func scalar[T any](t *testing.T, q string, args ...any) T {
	t.Helper()
	var v T
	if err := db(t, fixtures.TenantA).QueryRowContext(t.Context(), q, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return v
}

// str is a string field of a JSON object.
func str(m map[string]any, k string) string { s, _ := m[k].(string); return s }

// items are the items of a page.
func items(r reply) []map[string]any {
	raw, _ := r.Body["items"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, it := range raw {
		if m, ok := it.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

var days atomic.Int64

// window is a planned window of its own day after «now» of the suite (01.10.2026): 06:00–14:00 UTC. Every trip and
// every race takes a new day, so that the drivers of the fixtures are free in it.
type window struct{ from, until time.Time }

func newWindow() window {
	from := time.Date(2026, time.October, 2, 6, 0, 0, 0, time.UTC).AddDate(0, 0, int(days.Add(1)))
	return window{from: from, until: from.Add(8 * time.Hour)}
}

// hold is the window of a reservation inside the planned window.
func (w window) hold() window {
	return window{from: w.from.Add(30 * time.Minute), until: w.from.Add(6 * time.Hour)}
}

func (w window) json() map[string]any {
	return map[string]any{"startsAt": w.from.Format(time.RFC3339), "endsAt": w.until.Format(time.RFC3339), "timeZone": "Europe/Moscow"}
}

// vehicle registers a vehicle of Москва-1 by the logist (createVehicle) and returns its id.
func vehicle(t *testing.T) string {
	t.Helper()
	plate := "К " + strings.ToUpper(uuid.NewString()[:6]) + " 77"
	rep := want(t, http.StatusCreated, req{Actor: logist, Method: http.MethodPost, Path: fleet(t) + "/vehicles", Body: map[string]any{
		"orgUnitId": ref(t, "unit:a.msk1"), "registrationNumber": plate, "displayName": "ГАЗель Next", "bodyType": "van",
		"capacity": map[string]any{
			"payloadKg": "1500", "volumeM3": "16", "cargoLengthM": "4.2", "cargoWidthM": "1.9", "cargoHeightM": "2",
		},
		"equipment": []string{}, "odometerKm": "48210",
	}})
	id := str(rep.Body, "id")
	if id == "" {
		t.Fatalf("createVehicle: %s", rep)
	}
	return id
}

// crew is who makes a shift: by — the actor who reserves, inspects, starts, spends and returns; who — the driver of
// the trip. The shifts of the suite are those of the driver himself (ours); the objects of another driver of the firm
// (the negatives of the driver of the shifts, isolation_test.go) are made by the owner for a driver of Москва-1
// without an account (theirs): the owner drives any trip (start.go, submit.go, expenses.go: «the owner for anyone»).
type crew struct {
	by  string
	who uuid.UUID
}

// ours is the crew of the driver of the shifts.
func ours(t *testing.T) crew { t.Helper(); return crew{by: driver, who: person(t, driver)} }

// theirs is the crew of another driver of Москва-1: a new person with the function «Водитель», driven by the owner.
func theirs(t *testing.T) crew { t.Helper(); return crew{by: owner, who: seedDriver(t)} }

// shift is a trip of a driver of Москва-1 and what its shift made.
type shift struct {
	crew
	win                    window
	vehicle, trip, number  string
	reservation, departure string
	expense, ret           string // ret: the return inspection
}

// newShift registers a vehicle and plans a trip of the driver of the shifts on a new day (createTripPlan by the
// owner).
func newShift(t *testing.T) *shift { t.Helper(); return newShiftOf(t, ours(t)) }

// newShiftOf registers a vehicle and plans a trip of the driver of c on a new day (createTripPlan by the owner).
func newShiftOf(t *testing.T, c crew) *shift {
	t.Helper()
	s := &shift{crew: c, win: newWindow(), vehicle: vehicle(t)}
	rep := want(t, http.StatusCreated, req{Actor: owner, Method: http.MethodPost, Path: fleet(t) + "/trip-plans", Body: map[string]any{
		"orgUnitId": ref(t, "unit:a.msk1"), "title": "Склад Север → ТЦ Восток", "driverMemberId": c.who,
		"plannedWindow": s.win.json(),
		"cargo":         map[string]any{"description": "Сухой груз · 14 паллет-мест", "weightKg": "1100", "volumeM3": "12", "lengthM": "3"},
		"stops": []map[string]any{
			{"sequence": 1, "op": "load", "address": "Склад Север", "weightKg": "1100", "volumeM3": "12"},
			{"sequence": 2, "op": "unload", "address": "ТЦ Восток", "weightKg": "1100", "volumeM3": "12"},
		},
	}})
	s.trip, s.number = str(rep.Body, "id"), str(rep.Body, "number")
	if s.trip == "" {
		t.Fatalf("createTripPlan: %s", rep)
	}
	return s
}

// reserveBody is the reservation of the vehicle of s for its trip and its driver.
func (s *shift) reserveBody(t *testing.T) map[string]any {
	t.Helper()
	return map[string]any{"vehicleId": s.vehicle, "driverMemberId": s.who, "tripId": s.trip, "window": s.win.hold().json()}
}

// reserve: the crew reserves the vehicle for the trip — 201, the trip goes to the inspection.
func (s *shift) reserve(t *testing.T) {
	t.Helper()
	rep := want(t, http.StatusCreated, req{Actor: s.by, Method: http.MethodPost, Path: fleet(t) + "/reservations", Body: s.reserveBody(t)})
	if s.reservation = str(rep.Body, "id"); s.reservation == "" {
		t.Fatalf("reserveVehicle: %s", rep)
	}
}

// files writes n ready files of purpose (inspection | expense_receipt) of the parent ownerType/ownerID, uploaded by
// the driver of the shifts (no module checks the uploader), and returns their ids.
func files(t *testing.T, purpose, ownerType, ownerID string, n int) []string {
	t.Helper()
	out := make([]string, 0, n)
	for range n {
		id := uuid.NewString()
		execSQL(t, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes,
		                                    uploaded_by, ready_at)
		         values ($1::uuid, 'files/'||$1::text, 'ready', $2, $3, $4::uuid, 'image/jpeg', 2048, $5, now())`,
			id, purpose, ownerType, ownerID, person(t, driver))
		out = append(out, id)
	}
	return out
}

// shots are the five photos of an inspection (front, rear, left, right, odometer).
func shots(ids []string) []map[string]any {
	out := []map[string]any{}
	for i, role := range []string{"front", "rear", "left", "right", "odometer"} {
		out = append(out, map[string]any{"role": role, "fileId": ids[i], "capturedAt": "2026-10-01T07:20:00Z"})
	}
	return out
}

// checklist is the id of the current checklist version of kind for the vehicle of s.
func (s *shift) checklist(t *testing.T, kind string) string {
	t.Helper()
	rep := want(t, http.StatusOK, req{Actor: s.by, Method: http.MethodGet,
		Path: fleet(t) + "/inspection-checklist?vehicleId=" + s.vehicle + "&kind=" + kind})
	return str(rep.Body, "versionId")
}

// blocking is a blocking defect of zone for a departure inspection.
func blocking(zone string) map[string]any {
	return map[string]any{"zone": zone, "description": "Порез боковины", "severity": "blocking"}
}

// inspectDeparture: five ready photos of the reservation and the departure inspection by the crew — 201. With
// blocking defects the inspection waits for the manager (requires_review).
func (s *shift) inspectDeparture(t *testing.T, defects ...map[string]any) reply {
	t.Helper()
	body := map[string]any{
		"checklistVersionId": s.checklist(t, "departure"), "vehicleId": s.vehicle, "reservationId": s.reservation, "kind": "departure",
		"odometerKm": "48250", "fuelPercent": 75, "capturedAt": "2026-10-01T07:20:00Z",
		"photos": shots(files(t, "inspection", "fleet.reservation", s.reservation, 5)),
		"checks": []map[string]any{{"key": "body", "result": "pass"}, {"key": "tires", "result": "pass"}, {"key": "docs", "result": "pass"}},
	}
	if len(defects) > 0 {
		body["defects"] = defects
	}
	rep := want(t, http.StatusCreated, req{Actor: s.by, Method: http.MethodPost, Path: fleet(t) + "/inspections", Body: body})
	s.departure = str(rep.Body, "id")
	return rep
}

// ready plans, reserves and inspects a trip of the driver of the shifts: it is ready for its start.
func ready(t *testing.T) *shift { t.Helper(); return readyOf(t, ours(t)) }

// readyOf plans, reserves and inspects a trip of crew c.
func readyOf(t *testing.T, c crew) *shift {
	t.Helper()
	s := newShiftOf(t, c)
	s.reserve(t)
	s.inspectDeparture(t)
	return s
}

// startReq is the start of the trip of s by its crew with key.
func (s *shift) startReq(t *testing.T, key string) req {
	t.Helper()
	return req{Actor: s.by, Method: http.MethodPost, Path: fleet(t) + "/trips", Key: key,
		Body: map[string]any{"reservationId": s.reservation, "departureInspectionId": s.departure}}
}

// start: the driver starts the trip — 201 in_progress.
func (s *shift) start(t *testing.T) {
	t.Helper()
	rep := want(t, http.StatusCreated, s.startReq(t, ""))
	if str(rep.Body, "status") != "in_progress" {
		t.Fatalf("startTrip: %s", rep)
	}
}

// path is the path of the trip of s (getTrip, returnTrip).
func (s *shift) path(t *testing.T) string { t.Helper(); return fleet(t) + "/trips/" + s.trip }

// plan reads the trip card as actor: 200, its state and ETag.
func (s *shift) plan(t *testing.T, actor string) (state, etag string) {
	t.Helper()
	rep := want(t, http.StatusOK, req{Actor: actor, Method: http.MethodGet, Path: fleet(t) + "/trip-plans/" + s.trip})
	return str(rep.Body, "state"), rep.ETag()
}

// spend: the crew records an expense «прочее» with a comment and a receipt — 201 pending.
func (s *shift) spend(t *testing.T) {
	t.Helper()
	rep := want(t, http.StatusCreated, req{Actor: s.by, Method: http.MethodPost, Path: s.path(t) + "/expenses", Body: map[string]any{
		"kind": "other", "occurredAt": "2026-10-01T07:30:00Z", "comment": "Замена лампы фары",
		"amount":         map[string]any{"amountMinor": 30000, "currency": "RUB"},
		"receiptFileIds": files(t, "expense_receipt", "fleet.trip", s.trip, 1),
	}})
	if s.expense = str(rep.Body, "id"); s.expense == "" {
		t.Fatalf("createTripExpense: %s", rep)
	}
}

// finish: the crew finishes the route — the trip is returning.
func (s *shift) finish(t *testing.T) {
	t.Helper()
	_, tag := s.plan(t, s.by)
	want(t, http.StatusOK, req{Actor: s.by, Method: http.MethodPost, Path: s.path(t) + "/route-completion", IfMatch: tag})
}

// giveBack: the return inspection with five photos of the trip and returnTrip — the shift waits for the acceptance.
func (s *shift) giveBack(t *testing.T) {
	t.Helper()
	insp := want(t, http.StatusCreated, req{Actor: s.by, Method: http.MethodPost, Path: fleet(t) + "/inspections", Body: map[string]any{
		"checklistVersionId": s.checklist(t, "return"), "vehicleId": s.vehicle, "tripId": s.trip, "kind": "return",
		"odometerKm": "48296", "fuelPercent": 50, "capturedAt": "2026-10-01T07:25:00Z",
		"photos": shots(files(t, "inspection", "fleet.trip", s.trip, 5)),
		"checks": []map[string]any{{"key": "cargo", "result": "pass"}, {"key": "personal", "result": "pass"}, {"key": "keys", "result": "pass"}},
	}})
	s.ret = str(insp.Body, "id")
	_, tag := s.plan(t, s.by)
	rep := want(t, http.StatusOK, req{Actor: s.by, Method: http.MethodPatch, Path: s.path(t), IfMatch: tag,
		Body: map[string]any{"action": "return", "returnInspectionId": s.ret}})
	if str(rep.Body, "status") != "returned_pending_review" {
		t.Fatalf("returnTrip: %s", rep)
	}
}

// submitted runs a whole shift of the driver of the shifts up to the acceptance: the trip is submitted with one
// pending expense.
func submitted(t *testing.T) *shift { t.Helper(); return submittedOf(t, ours(t)) }

// submittedOf runs a whole shift of crew c up to the acceptance.
func submittedOf(t *testing.T, c crew) *shift {
	t.Helper()
	s := readyOf(t, c)
	s.start(t)
	s.spend(t)
	s.finish(t)
	s.giveBack(t)
	if state, _ := s.plan(t, logist); state != "submitted" {
		t.Fatalf("trip %s after the return: %s, want submitted", s.number, state)
	}
	return s
}

// reviewReq is a decision on the shift of s by actor with the ETag of the trip card.
func (s *shift) reviewReq(t *testing.T, actor, tag string, body map[string]any) req {
	t.Helper()
	return req{Actor: actor, Method: http.MethodPost, Path: s.path(t) + "/review", IfMatch: tag, Body: body}
}

// accept: the logist accepts the shift — 200, the trip is accepted.
func (s *shift) accept(t *testing.T) {
	t.Helper()
	_, tag := s.plan(t, logist)
	want(t, http.StatusOK, s.reviewReq(t, logist, tag, map[string]any{"decision": "approve"}))
}

// earnings is the path of the earnings of the trip of s in tenant A.
func (s *shift) earnings(t *testing.T) string { t.Helper(); return s.path(t) + "/earnings" }

// close ends the active trip of the driver at the end of a race round: one driver has one trip on the route at a time
// (trips_active_driver_uq). It is not a path of the API: the round only needs the driver free again.
func (s *shift) close(t *testing.T) {
	t.Helper()
	execSQL(t, `update fleet.trips set state = 'accepted' where id = $1 and state in ('on_route', 'returning', 'submitted', 'rework')`, s.trip)
}

// vehicleStatus is the status of the vehicle of s in listVehicles of the logist.
func (s *shift) vehicleStatus(t *testing.T) string {
	t.Helper()
	for _, rep := range pages(t, req{Actor: logist, Method: http.MethodGet, Path: fleet(t) + "/vehicles"}) {
		if rep.Status != http.StatusOK {
			t.Fatalf("listVehicles: %s", rep)
		}
		for _, it := range items(rep) {
			if str(it, "id") == s.vehicle {
				return str(it, "status")
			}
		}
	}
	t.Fatalf("vehicle %s is not listed", s.vehicle)
	return ""
}

// expect fails the test unless every check holds.
func expect(t *testing.T, what string, got any, checks ...bool) {
	t.Helper()
	for i, ok := range checks {
		if !ok {
			t.Fatalf("%s: check %d of %d failed: %v", what, i+1, len(checks), got)
		}
	}
}

// wantTally fails the test unless the answers tally exactly to w.
func wantTally(t *testing.T, what string, rs []reply, w map[string]int) {
	t.Helper()
	got := tally(rs)
	if fmt.Sprint(got) != fmt.Sprint(w) {
		for _, r := range rs {
			t.Log(r)
		}
		t.Fatalf("%s: answers %v, want %v", what, got, w)
	}
}
