//go:build integration

package inspections_test

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// S2-04: the current checklist of a kind for a visible vehicle; the built-in version 1 is published once. A vehicle
// of another firm or tenant is 404 (AC-01, AC-02), a vehicle seen without the inspection right — 403; a driver sees
// the checklist of the vehicle of his trip only.
func TestChecklist(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	smr := seedTrip(t, "a", "smr2", uuid.Nil)
	list, err := e.svc.Checklist(ctx, e.tc(t, "a.manager-msk1", "a"), tr.Vehicle, "departure")
	if err != nil {
		t.Fatal(err)
	}
	expect(t, "departure checklist", list, list.Kind == "departure", len(list.Items) == 3, list.Items[0].Key == "body",
		list.Items[0].Label == "Кузов и стёкла осмотрены", list.Items[0].Required,
		slices.Equal(list.RequiredPhotoRoles, []fleetapi.InspectionChecklistRequiredPhotoRoles{"front", "rear", "left", "right", "odometer"}))
	again, err := e.svc.Checklist(ctx, e.tc(t, "a.driver-msk1", "a"), tr.Vehicle, "departure")
	expect(t, "driver of the trip", err, err == nil, again.VersionId == list.VersionId)
	ret, err := e.svc.Checklist(ctx, e.tc(t, "a.owner", "a"), smr.Vehicle, "return")
	expect(t, "return checklist", ret, err == nil, ret.Kind == "return", ret.Items[0].Key == "cargo", ret.VersionId != list.VersionId)
	n := scalar[int](t, db(t, "a"), `select count(*) from fleet.checklist_versions where id = $1`, list.VersionId)
	expect(t, "published once", n, n == 1)
	cases := []struct {
		actor, tenant string
		vehicle       uuid.UUID
		code          string
	}{
		{"a.manager-msk2", "a", tr.Vehicle, "not_found"},
		{"a.driver-msk1", "a", smr.Vehicle, "not_found"},
		{"a.two-roles", "a", smr.Vehicle, "forbidden_action"},
		{"b.owner", "b", tr.Vehicle, "not_found"},
		{"a.owner", "a", uuid.New(), "not_found"},
	}
	for _, c := range cases {
		if _, err := e.svc.Checklist(ctx, e.tc(t, c.actor, c.tenant), c.vehicle, "departure"); !isCode(err, c.code) {
			t.Errorf("%s: %v, want %s", c.actor, err, c.code)
		}
	}
	if _, err := e.svc.Checklist(ctx, e.tc(t, "a.owner", "a"), tr.Vehicle, "repair"); !isCode(err, "validation_failed") {
		t.Errorf("unknown kind: %v", err)
	}
}

// S2-04, AC-04: a complete departure by the driver of the trip — five ready photos of the reservation, every item;
// the trip refers to it and still waits for startTrip (W2.05); the stored roles of tenant 0002 (back) and the
// exact fuel percentage come back as sent.
func TestSubmitDeparture(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	body := e.departure(t, tr)
	body.Photos = append(body.Photos, fleetapi.InspectionPhoto{Role: "damage", FileId: photoFile(t, "a", "fleet.reservation", tr.Reservation, "ready"),
		CapturedAt: harness.Now()})
	got, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), body)
	if err != nil {
		t.Fatal(err)
	}
	expect(t, "inspection", got, got.Status == "submitted", got.Kind == "departure", got.MemberId == person("a.driver-msk1"),
		got.TripId != nil && *got.TripId == tr.ID, got.Attempt != nil && *got.Attempt == 1, got.FuelPercent == 75,
		got.OdometerKm == "48250", len(got.Photos) == 6, len(got.Checks) == 3, got.Revision == 1,
		got.Defects != nil && len(*got.Defects) == 0, got.VehicleId == tr.Vehicle, got.ChecklistVersionId == body.ChecklistVersionId)
	d := db(t, "a")
	state := scalar[string](t, d, `select state||'/'||coalesce(departure_inspection_id::text, '-')||'/'||revision from fleet.trips where id = $1`, tr.ID)
	expect(t, "trip", state, state == "inspection/"+got.Id.String()+"/2")
	roles := scalar[string](t, d, `select string_agg(role, ',' order by role) from fleet.inspection_photos where inspection_id = $1`, got.Id)
	expect(t, "stored roles", roles, roles == "back,front,left,odometer,right")
	fuel := scalar[string](t, d, `select fuel_level from fleet.inspections where id = $1`, got.Id)
	expect(t, "fuel level", fuel, fuel == "three_quarters")
	events := scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.inspection.submitted.v1' and aggregate_id = $1`, got.Id)
	expect(t, "event", events, events == 1)
	read, err := e.svc.Inspection(ctx, e.tc(t, "a.manager-msk1", "a"), got.Id)
	expect(t, "read back", read, err == nil, read.Status == "submitted", len(read.Photos) == 6, read.Photos[1].Role == "rear",
		read.FuelPercent == 75)
	// The departure is done: a second one of the same trip waits for startTrip, not for another inspection.
	if _, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr)); !isCode(err, "invalid_transition") {
		t.Errorf("second departure: %v", err)
	}
}

// AC-04, I-06: what the inspection lacks is 409 inspection_incomplete with the list of the prototype, a photo that
// is not ready 409 photo_not_ready, a photo of another parent 422; the odometer below the vehicle 422
// odometer_decrease; a stale checklist 422.
func TestSubmitRejects(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	other := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	driver := e.tc(t, "a.driver-msk1", "a")
	cases := []struct {
		name   string
		mutate func(*fleetapi.InspectionCreate)
		code   string
		detail string
	}{
		{"4 фото из 5", func(b *fleetapi.InspectionCreate) { b.Photos = b.Photos[:4] }, "inspection_incomplete", "Осмотр не завершён: 1 фото"},
		{"пункты", func(b *fleetapi.InspectionCreate) { b.Checks = checks("body") }, "inspection_incomplete", "Осмотр не завершён: 2 пункта чек-листа"},
		{"фото проверяется", func(b *fleetapi.InspectionCreate) {
			b.Photos[2].FileId = photoFile(t, "a", "fleet.reservation", tr.Reservation, "scanning")
		}, "photo_not_ready", "Не все фото загружены на сервер"},
		{"фото другой брони", func(b *fleetapi.InspectionCreate) {
			b.Photos[0].FileId = photoFile(t, "a", "fleet.reservation", other.Reservation, "ready")
		}, "validation_failed", "Фото не относится к этому осмотру."},
		{"нет файла", func(b *fleetapi.InspectionCreate) { b.Photos[0].FileId = uuid.New() }, "validation_failed", "Фото не относится"},
		{"чек вместо фото", func(b *fleetapi.InspectionCreate) {
			b.Photos[0].FileId = photoFile(t, "a", "fleet.reservation", tr.Reservation, "ready")
			exec(t, db(t, "a"), `update files.objects set purpose = 'expense_receipt' where id = $1`, b.Photos[0].FileId)
		}, "validation_failed", "Фото не относится"},
		{"пробег меньше", func(b *fleetapi.InspectionCreate) { b.OdometerKm = "48000" }, "odometer_decrease", "Пробег не может быть меньше 48"},
		{"версия чек-листа", func(b *fleetapi.InspectionCreate) { b.ChecklistVersionId = uuid.New() }, "validation_failed", "Чек-лист изменился. Обновите осмотр."},
		{"машина не брони", func(b *fleetapi.InspectionCreate) { b.VehicleId = other.Vehicle }, "not_found", ""},
	}
	for _, c := range cases {
		b := e.departure(t, tr)
		c.mutate(&b)
		_, err := e.svc.Submit(ctx, driver, b)
		if !isCode(err, c.code) || !strings.Contains(err.Error(), c.detail) {
			t.Errorf("%s: %v, want %s %q", c.name, err, c.code, c.detail)
		}
	}
	n := scalar[int](t, db(t, "a"), `select count(*) from fleet.inspections where trip_id = $1`, tr.ID)
	expect(t, "nothing written", n, n == 0)
}

// The trip decides who submits: an invisible trip is 404 like a missing reservation (AC-01), a visible one
// without fleet.inspections.submit 403; another tenant 404 (AC-02); an expired hold 409 reservation_expired.
func TestSubmitAccess(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	cases := []struct {
		actor, tenant, code string
	}{
		{"a.driver-msk2", "a", "forbidden_action"},
		{"a.manager-msk2", "a", "not_found"},
		{"a.manager-msk1", "a", "forbidden_action"},
		{"b.owner", "b", "not_found"},
	}
	for _, c := range cases {
		if _, err := e.svc.Submit(ctx, e.tc(t, c.actor, c.tenant), e.departure(t, tr)); !isCode(err, c.code) {
			t.Errorf("%s: %v, want %s", c.actor, err, c.code)
		}
	}
	missing := e.departure(t, tr)
	id := uuid.New()
	missing.ReservationId = &id
	if _, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), missing); !isCode(err, "not_found") {
		t.Errorf("missing reservation: %v", err)
	}
	exec(t, db(t, "a"), `update sched.reservations set hold_expires_at = $2 where id = $1`, tr.Reservation, harness.Now().Add(-time.Minute))
	if _, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr)); !isCode(err, "reservation_expired") {
		t.Errorf("expired hold: %v", err)
	}
	exec(t, db(t, "a"), `update sched.reservations set state = 'released' where id = $1`, tr.Reservation)
	if _, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr)); !isCode(err, "invalid_transition") {
		t.Errorf("released hold: %v", err)
	}
}

// returning moves a trip to «Сдача машины» after its departure, as finishTripRoute of W2.05 does.
func returning(t *testing.T, tr trip) {
	t.Helper()
	exec(t, db(t, tr.tenant), `update fleet.trips set state = 'returning', started_at = $2, route_completed_at = $3 where id = $1`,
		tr.ID, harness.Now(), harness.Now().Add(6*time.Hour))
}

func (e env) returnBody(t *testing.T, tr trip, odometer string) fleetapi.InspectionCreate {
	t.Helper()
	list, err := e.svc.Checklist(t.Context(), e.tc(t, "a.owner", tr.tenant), tr.Vehicle, "return")
	if err != nil {
		t.Fatal(err)
	}
	id := tr.ID
	return fleetapi.InspectionCreate{
		ChecklistVersionId: list.VersionId, VehicleId: tr.Vehicle, TripId: &id, Kind: "return", OdometerKm: odometer,
		FuelPercent: 40, Checks: checks(retChecks...), Photos: photos(t, tr.tenant, "fleet.trip", tr.ID),
		CapturedAt: harness.Now().Add(6 * time.Hour),
	}
}

// S2-08, LOG-09, Q-51: the return inspection of a returning trip — the odometer is not below the departure, a
// blocking severity is refused (422), a resubmission after rework is attempt 2 and the trip refers to it.
func TestSubmitReturn(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	driver := e.tc(t, "a.driver-msk1", "a")
	if _, err := e.svc.Submit(ctx, driver, e.returnBody(t, tr, "48500")); !isCode(err, "invalid_transition") {
		t.Errorf("before the route is finished: %v", err)
	}
	if _, err := e.svc.Submit(ctx, driver, e.departure(t, tr)); err != nil {
		t.Fatal(err)
	}
	returning(t, tr)
	if _, err := e.svc.Submit(ctx, driver, e.returnBody(t, tr, "48249")); !isCode(err, "odometer_decrease") ||
		!strings.Contains(err.Error(), "Пробег не может быть меньше 48") {
		t.Errorf("below the departure: %v", err)
	}
	bad := e.returnBody(t, tr, "48500")
	bad.Defects = &[]fleetapi.InspectionDefectReport{critical("Кузов")}
	if _, err := e.svc.Submit(ctx, driver, bad); !isCode(err, "validation_failed") {
		t.Errorf("blocking on return: %v", err)
	}
	other := e.returnBody(t, tr, "48500")
	other.VehicleId = uuid.New()
	if _, err := e.svc.Submit(ctx, driver, other); !isCode(err, "validation_failed") {
		t.Errorf("another vehicle on return: %v", err)
	}
	dep := e.departure(t, tr) // photos of the reservation: a return inspection takes photos of the trip
	body := e.returnBody(t, tr, "48500")
	body.Photos[0] = dep.Photos[0]
	if _, err := e.svc.Submit(ctx, driver, body); !isCode(err, "validation_failed") {
		t.Errorf("photo of the reservation on return: %v", err)
	}
	comment := "Стук в подвеске на скорости"
	body = e.returnBody(t, tr, "48500")
	body.Comment = &comment
	body.Defects = &[]fleetapi.InspectionDefectReport{{Zone: "Тормоза и ходовая", Description: comment, Severity: "minor"}}
	first, err := e.svc.Submit(ctx, driver, body)
	expect(t, "return", first, err == nil, first.Kind == "return", first.Attempt != nil && *first.Attempt == 1,
		first.Comment != nil && *first.Comment == comment, first.Defects != nil && len(*first.Defects) == 1 && (*first.Defects)[0].State == "open")
	exec(t, db(t, "a"), `update fleet.trips set state = 'rework' where id = $1`, tr.ID)
	second, err := e.svc.Submit(ctx, driver, e.returnBody(t, tr, "48500"))
	expect(t, "attempt 2", second, err == nil, second.Attempt != nil && *second.Attempt == 2)
	ref := scalar[string](t, db(t, "a"), `select return_inspection_id::text from fleet.trips where id = $1`, tr.ID)
	expect(t, "trip refers to the latest", ref, ref == second.Id.String())
}

// Review round 1, AC-04: five photos are five files of this inspection — one file on two roles is 422, and a file
// already attached to another inspection of the trip (the departure, an earlier attempt of the return) is 422 too,
// whether as a role or as a damage photo. Nothing is written by a refused submit.
func TestSubmitPhotoOnce(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	const (
		sameFile = "Одно фото прикреплено дважды. Сделайте отдельный снимок."
		usedFile = "Фото уже прикреплено к другому осмотру. Сделайте новый снимок."
	)
	// The driver of msk2: TestSubmitReturn returns a trip of a.driver-msk1 at the same time (trips_active_driver_uq).
	driver := e.tc(t, "a.driver-msk2", "a")
	tr := seedTrip(t, "a", "msk2", person("a.driver-msk2"))
	twice := e.departure(t, tr)
	twice.Photos[1].FileId = twice.Photos[0].FileId
	if _, err := e.svc.Submit(ctx, driver, twice); !isCode(err, "validation_failed") || !strings.Contains(err.Error(), sameFile) {
		t.Errorf("one file on two roles: %v, want %q", err, sameFile)
	}
	n := scalar[int](t, db(t, "a"), `select count(*) from fleet.inspections where trip_id = $1`, tr.ID)
	expect(t, "nothing written", n, n == 0)

	dep := e.departure(t, tr)
	dep.Photos = photos(t, "a", "fleet.trip", tr.ID) // files of the trip: a return could take them, but must not
	damage := fleetapi.InspectionPhoto{Role: "damage", FileId: photoFile(t, "a", "fleet.trip", tr.ID, "ready"), CapturedAt: harness.Now()}
	dep.Photos = append(dep.Photos, damage)
	if _, err := e.svc.Submit(ctx, driver, dep); err != nil {
		t.Fatal(err)
	}
	returning(t, tr)
	for name, reuse := range map[string]func(*fleetapi.InspectionCreate){
		"ракурс выезда":      func(b *fleetapi.InspectionCreate) { b.Photos[0] = dep.Photos[0] },
		"повреждение выезда": func(b *fleetapi.InspectionCreate) { b.Photos[2].FileId = damage.FileId },
		"ракурс как повреждение": func(b *fleetapi.InspectionCreate) {
			b.Photos = append(b.Photos, fleetapi.InspectionPhoto{Role: "damage", FileId: dep.Photos[3].FileId, CapturedAt: harness.Now()})
		},
	} {
		body := e.returnBody(t, tr, "48500")
		reuse(&body)
		if _, err := e.svc.Submit(ctx, driver, body); !isCode(err, "validation_failed") || !strings.Contains(err.Error(), usedFile) {
			t.Errorf("%s: %v, want %q", name, err, usedFile)
		}
	}
	first := e.returnBody(t, tr, "48500")
	if _, err := e.svc.Submit(ctx, driver, first); err != nil {
		t.Fatal(err)
	}
	exec(t, db(t, "a"), `update fleet.trips set state = 'rework' where id = $1`, tr.ID)
	again := e.returnBody(t, tr, "48500")
	again.Photos[4] = first.Photos[4]
	if _, err := e.svc.Submit(ctx, driver, again); !isCode(err, "validation_failed") || !strings.Contains(err.Error(), usedFile) {
		t.Errorf("photo of attempt 1 in attempt 2: %v, want %q", err, usedFile)
	}
	if _, err := e.svc.Submit(ctx, driver, e.returnBody(t, tr, "48500")); err != nil {
		t.Errorf("attempt 2 with new photos: %v", err)
	}
	n = scalar[int](t, db(t, "a"), `select count(*) from fleet.inspections where trip_id = $1`, tr.ID)
	expect(t, "departure and two returns", n, n == 3)
}

// Reads: the manager of the firm and the owner see inspections of its vehicles, the driver — his own; another firm
// and another tenant — 404 like a missing id (AC-01, AC-02); lists filter before pagination, the cursor pages.
func TestInspectionVisibility(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	tr2 := seedTrip(t, "a", "msk1", person("a.driver-msk1"))
	i1, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr))
	if err != nil {
		t.Fatal(err)
	}
	i2, err := e.svc.Submit(ctx, e.tc(t, "a.driver-msk1", "a"), e.departure(t, tr2))
	if err != nil {
		t.Fatal(err)
	}
	for _, actor := range []string{"a.owner", "a.manager-msk1", "a.region-msk", "a.driver-msk1"} {
		if _, err := e.svc.Inspection(ctx, e.tc(t, actor, "a"), i1.Id); err != nil {
			t.Errorf("%s: %v", actor, err)
		}
	}
	for _, c := range []struct{ actor, tenant string }{{"a.manager-msk2", "a"}, {"b.owner", "b"}} {
		if _, err := e.svc.Inspection(ctx, e.tc(t, c.actor, c.tenant), i1.Id); !isCode(err, "not_found") {
			t.Errorf("%s: %v, want not_found", c.actor, err)
		}
	}
	for _, actor := range []string{"a.manager-msk1", "a.driver-msk1", "a.owner"} {
		got := e.allInspections(t, actor)
		expect(t, actor, got, slices.Contains(got, i1.Id), slices.Contains(got, i2.Id))
	}
	for _, actor := range []string{"a.manager-msk2", "ab.member"} {
		got := e.allInspections(t, actor)
		expect(t, actor, got, !slices.Contains(got, i1.Id), !slices.Contains(got, i2.Id))
	}
	if _, err := e.svc.Inspections(ctx, e.tc(t, "a.owner", "a"), inspectionsCursor("bogus")); !isCode(err, "malformed_request") {
		t.Errorf("bad cursor: %v", err)
	}
}

// W2.78, возврат 1: the owner of tenant A sees every inspection of the parallel tests of the package, so paging his
// list by one item takes more than 50 pages; allInspections pages to the end and fails only on a cursor that does not
// advance (TestInspectionVisibility failed with «a.owner: endless pages» once the release tests added their trips).
func TestInspectionsPageBeyondFifty(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	driver := e.tc(t, "a.driver-msk1", "a")
	var seeded []uuid.UUID
	for range 51 {
		got, err := e.svc.Submit(t.Context(), driver, e.departure(t, seedTrip(t, "a", "msk1", person("a.driver-msk1"))))
		if err != nil {
			t.Fatal(err)
		}
		seeded = append(seeded, got.Id)
	}
	got := e.allInspections(t, "a.owner")
	for _, id := range seeded {
		if !slices.Contains(got, id) {
			t.Fatalf("a.owner: inspection %s missing from %d paged items", id, len(got))
		}
	}
}

// maxInspectionPages bounds allInspections far above what the parallel tests of the package write to tenant A.
const maxInspectionPages = 10000

// allInspections pages listInspections of actor in tenant A by one item and returns the ids. The parallel tests share
// tenant A, so the number of pages is not fixed: the walk fails only when the cursor does not advance.
func (e env) allInspections(t *testing.T, actor string) []uuid.UUID {
	t.Helper()
	var out []uuid.UUID
	q := inspectionsQuery(1)
	tc := e.tc(t, actor, "a")
	seen := map[string]bool{}
	for range maxInspectionPages {
		page, err := e.svc.Inspections(t.Context(), tc, q)
		if err != nil {
			t.Fatalf("%s: %v", actor, err)
		}
		for _, it := range page.Items {
			out = append(out, it.Id)
		}
		if page.NextCursor == nil {
			return out
		}
		if seen[*page.NextCursor] {
			t.Fatalf("%s: the cursor does not advance after %d items", actor, len(out))
		}
		seen[*page.NextCursor] = true
		q.Cursor = *page.NextCursor
	}
	t.Fatalf("%s: endless pages (%d)", actor, maxInspectionPages)
	return nil
}
