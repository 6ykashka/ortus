//go:build integration

package pool_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
)

// S2-20 «Машина для временного водителя» (W2.72, D-35 комплекта; docs/29 «Решение», «Правила», «Данные и API»,
// «Приёмка»; контракт 0.7.1-stage4 W2.71, tenant 0023): обычная машина в публикации и каталоге, машина в запросе,
// решение фирмы водителя, брони предложения при одобрении, выбор водителем или логистом, срок выбора, конец перевода.

const (
	approveDriverOnly = fleetapi.DriverTransferDecisionDecisionApproveDriverOnly
	modeHome          = fleetapi.DriverTransferVehicleCreateModeHome
	modeHost          = fleetapi.DriverTransferVehicleCreateModeHost
	modeHostOrHome    = fleetapi.DriverTransferVehicleCreateModeHostOrHome
	textOfferClosed   = "Выбор машины уже закрыт."
	textResNotFound   = "Бронь не найдена."
	textVehicleNotFnd = "Машина не найдена."
)

// newCar registers a vehicle of company key (a van of 1.5 t, 12 m³, 3.2 m, without refrigeration).
func newCar(t *testing.T, key string) uuid.UUID {
	t.Helper()
	return scalar[uuid.UUID](t, `insert into fleet.vehicles (unit_id, plate, display_name, body_type, payload_kg, volume_m3,
		cargo_length_mm) values ($1, $2, $3, 'van', 1500, 12, 3200) returning id`, unit(key),
		fmt.Sprintf("О %03d ФР 77", seq.Add(1)%1000), "Фургон "+key)
}

// offerCase is a driver of Москва-2 published with his usual vehicle and a trip of Москва-1 with a vehicle of its
// own (the vehicle of the trip company, «Поставил логист»).
type offerCase struct {
	d, usual, host uuid.UUID
	w              pool.Window
	tr             trip
}

// newOffer publishes a driver of Москва-2 with a usual vehicle for [from, from+8h) and plans a trip of Москва-1 for
// [from+1h, from+5h).
func (e *env) newOffer(t *testing.T, name string, from time.Duration) offerCase {
	t.Helper()
	c := offerCase{d: newDriver(t, "msk2", name), usual: newCar(t, "msk2"), host: newCar(t, "msk1")}
	e.publishUsual(t, c.d, &c.usual, e.window(from, from+8*time.Hour))
	c.w = e.window(from+time.Hour, from+5*time.Hour)
	c.tr = newTrip(t, "msk1", c.w, uuid.Nil)
	return c
}

func (e *env) publishUsual(t *testing.T, d uuid.UUID, usual *uuid.UUID, w pool.Window) fleetapi.DriverPoolPublication {
	t.Helper()
	p, err := e.svc.Publish(t.Context(), e.tc(t, "a.manager-msk2"), fleetapi.DriverPoolPublicationCreate{
		DriverMemberId: d, HomeOrgUnitId: unit("msk2"), FreeWindow: api(w), Qualifications: []string{"Кат. C"},
		UsualVehicleId: usual,
	})
	if err != nil {
		t.Fatalf("publishDriverToPool with the usual vehicle: %v", err)
	}
	return p
}

// body is the request of the case with the vehicle mode (host — the vehicle of the trip company).
func (c offerCase) body(mode fleetapi.DriverTransferVehicleCreateMode) fleetapi.DriverTransferCreate {
	b := transferOf(c.d, "msk2", "msk1", c.w, &c.tr)
	v := &fleetapi.DriverTransferVehicleCreate{Mode: mode}
	if mode != modeHome {
		host := c.host
		v.HostVehicleId = &host
	}
	b.Vehicle = v
	return b
}

// requestOffer requests the driver of c with the vehicle mode and approves it with decision d.
func (e *env) requestOffer(t *testing.T, c offerCase, mode fleetapi.DriverTransferVehicleCreateMode, d fleetapi.DriverTransferDecisionDecision) fleetapi.DriverTransfer {
	t.Helper()
	x := e.request(t, e.tc(t, "a.manager-msk1"), c.body(mode))
	return e.decide(t, e.tc(t, "a.manager-msk2"), x, d)
}

// offerRow is a reservation of a trip (sched.reservations, the row of the vehicle).
type offerRow struct {
	id, vehicle                       uuid.UUID
	state                             string
	group, to                         *uuid.UUID
	kind, reason                      *string
	until, expires, chosen, releasedA *time.Time
}

// offersOf are the reservations of the trip by vehicle.
func offersOf(t *testing.T, tr trip) map[uuid.UUID]offerRow {
	t.Helper()
	rows, err := db(t).QueryContext(t.Context(), `select r.id, s.ref_id, r.state, r.offer_group_id, r.offered_to,
		r.offer_kind, r.release_reason, r.choose_until, r.hold_expires_at, r.chosen_at, r.released_at
		  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
		 where r.source_type = 'fleet.trip' and r.source_id = $1`, tr.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	out := map[uuid.UUID]offerRow{}
	for rows.Next() {
		var r offerRow
		if err := rows.Scan(&r.id, &r.vehicle, &r.state, &r.group, &r.to, &r.kind, &r.reason, &r.until, &r.expires,
			&r.chosen, &r.releasedA); err != nil {
			t.Fatal(err)
		}
		out[r.vehicle] = r
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// tripVehicle is the state, the vehicle and the reservation of a trip.
func tripVehicle(t *testing.T, tr trip) (string, *uuid.UUID, *uuid.UUID) {
	t.Helper()
	var (
		state           string
		vehicle, bundle *uuid.UUID
	)
	if err := db(t).QueryRowContext(t.Context(), `select state, vehicle_id, reservation_bundle_id from fleet.trips where id = $1`,
		tr.ID).Scan(&state, &vehicle, &bundle); err != nil {
		t.Fatal(err)
	}
	return state, vehicle, bundle
}

// resourceGrants are the vehicles the driver reads through his rows of scope resource valid at the moment at.
func resourceGrants(t *testing.T, d uuid.UUID, at time.Time) map[uuid.UUID]bool {
	t.Helper()
	rows, err := db(t).QueryContext(t.Context(), `select scope_ref from access.role_assignments where principal_id = $1
		and scope_kind = 'resource' and source = 'transfer' and state = 'active' and valid @> $2::timestamptz`, d, at)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	out := map[uuid.UUID]bool{}
	for rows.Next() {
		var v uuid.UUID
		if err := rows.Scan(&v); err != nil {
			t.Fatal(err)
		}
		out[v] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func wantViolation(t *testing.T, what string, err error, field, code string) {
	t.Helper()
	_, v, ok := pool.ViolationOf(err)
	if !ok || v.Field != field || v.Code != code {
		t.Fatalf("%s: %v (violation %+v), want 422 %s/%s", what, err, v, field, code)
	}
}

// partOf is the vehicle part of x with both vehicles asked by its mode; a part missing fails the test.
func partOf(t *testing.T, x fleetapi.DriverTransfer) *fleetapi.DriverTransferVehicle {
	t.Helper()
	v := x.Vehicle
	if v == nil || (v.Mode != fleetapi.DriverTransferVehicleModeHome && v.HostVehicle == nil) ||
		(v.Mode != fleetapi.DriverTransferVehicleModeHost && v.HomeVehicle == nil) {
		t.Fatalf("request %s: vehicle %+v, want its mode with the vehicles", x.Id, v)
	}
	return v
}

func same(a *uuid.UUID, b uuid.UUID) bool { return a != nil && *a == b }

func at(a *time.Time, b time.Time) bool { return a != nil && a.Equal(b) }

// Правило 1 (TD-01): обычная машина — активная машина домашней фирмы, видимая публикующему; чужая и неизвестная —
// один 422 usualVehicleId/vehicle.
func TestPublishUsualVehicle(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2 := e.tc(t, "a.manager-msk2")
	d := newDriver(t, "msk2", "С обычной машиной")
	usual := newCar(t, "msk2")
	p := e.publishUsual(t, d, &usual, e.window(500*time.Hour, 508*time.Hour))
	expect(t, "publication", p, same(p.UsualVehicleId, usual))
	for name, v := range map[string]uuid.UUID{"машина другой фирмы": newCar(t, "msk1"), "неизвестная": uuid.New()} {
		_, err := e.svc.Publish(t.Context(), mgr2, fleetapi.DriverPoolPublicationCreate{
			DriverMemberId: newDriver(t, "msk2", "Без машины "+name), HomeOrgUnitId: unit("msk2"),
			FreeWindow: api(e.window(500*time.Hour, 508*time.Hour)), Qualifications: []string{"Кат. C"}, UsualVehicleId: &v,
		})
		wantViolation(t, name, err, "usualVehicleId", "vehicle")
	}
}

// Правило 2: каталог для рейса показывает обычную машину с совместимостью и занятостью на окно рейса; невидимый рейс
// — 404.
func TestCatalogUsualVehicle(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr1 := e.tc(t, "a.manager-msk1")
	c := e.newOffer(t, "В каталоге", 510*time.Hour)
	cold := newTrip(t, "msk1", c.w, uuid.Nil)
	exec(t, `update fleet.trips set cargo_temp_min_c = 2, cargo_temp_max_c = 6 where id = $1`, cold.ID)
	list := func(tr uuid.UUID) *fleetapi.PoolUsualVehicle {
		t.Helper()
		page, err := e.svc.Catalog(t.Context(), mgr1, fleetapi.ListAvailableDriversParams{AvailableFrom: c.w.Start,
			AvailableUntil: c.w.End, TripId: &tr})
		if err != nil {
			t.Fatalf("listAvailableDrivers?tripId: %v", err)
		}
		for _, it := range page.Items {
			if it.DriverMemberId == c.d {
				return it.UsualVehicle
			}
		}
		t.Fatalf("the driver is not in the catalog: %+v", page.Items)
		return nil
	}
	u := list(c.tr.ID)
	if u == nil {
		t.Fatal("no usual vehicle in the catalog for the trip")
	}
	expect(t, "usual vehicle fitting the trip", u, u.VehicleId == c.usual, u.Fit != nil && u.Fit.Ok,
		u.Fit != nil && len(u.Fit.Reasons) == 0, u.FreeForWindow != nil && *u.FreeForWindow)
	u = list(cold.ID)
	if u == nil {
		t.Fatal("no usual vehicle in the catalog for the cold trip")
	}
	expect(t, "usual vehicle without refrigeration", u, u.Fit != nil && !u.Fit.Ok, len(u.Fit.Reasons) == 1)
	foreign := newTrip(t, "msk3", c.w, uuid.Nil)
	_, err := e.svc.Catalog(t.Context(), mgr1, fleetapi.ListAvailableDriversParams{AvailableFrom: c.w.Start,
		AvailableUntil: c.w.End, TripId: &foreign.ID})
	wantProblem(t, err, "not_found", "Рейс не найден.")
}

// 1a: машина в запросе — порядок проверок контракта; броней до одобрения нет.
func TestRequestVehicle(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr1 := e.tc(t, "a.manager-msk1")
	c := e.newOffer(t, "Запрос с машиной", 520*time.Hour)

	noTrip := c.body(modeHost)
	noTrip.TripId = nil
	_, err := e.svc.Request(ctx, mgr1, noTrip)
	wantViolation(t, "без рейса", err, "tripId", "required")
	noHost := c.body(modeHost)
	noHost.Vehicle.HostVehicleId = nil
	_, err = e.svc.Request(ctx, mgr1, noHost)
	wantViolation(t, "без машины фирмы рейса", err, "vehicle.hostVehicleId", "required")
	withHost := c.body(modeHome)
	withHost.Vehicle.HostVehicleId = &c.host
	_, err = e.svc.Request(ctx, mgr1, withHost)
	wantViolation(t, "своя обычная с машиной фирмы рейса", err, "vehicle.hostVehicleId", "home")
	foreign := c.body(modeHost)
	other := newCar(t, "msk2")
	foreign.Vehicle.HostVehicleId = &other
	_, err = e.svc.Request(ctx, mgr1, foreign)
	wantProblem(t, err, "not_found", textVehicleNotFnd)

	bare := newDriver(t, "msk2", "Без обычной машины")
	e.publishUsual(t, bare, nil, e.window(520*time.Hour, 528*time.Hour))
	noUsual := c.body(modeHostOrHome)
	noUsual.DriverMemberId = bare
	_, err = e.svc.Request(ctx, mgr1, noUsual)
	wantViolation(t, "нет обычной машины", err, "vehicle.mode", "usual_vehicle")

	exec(t, `update fleet.trips set cargo_temp_min_c = 2, cargo_temp_max_c = 6 where id = $1`, c.tr.ID)
	_, err = e.svc.Request(ctx, mgr1, c.body(modeHost))
	wantProblem(t, err, "vehicle_incompatible", "")
	exec(t, `update fleet.trips set cargo_temp_min_c = null, cargo_temp_max_c = null where id = $1`, c.tr.ID)
	busy := newTrip(t, "msk1", c.w, uuid.Nil)
	exec(t, `update fleet.trips set vehicle_id = $2, state = 'assigned' where id = $1`, busy.ID, c.host)
	_, err = e.svc.Request(ctx, mgr1, c.body(modeHost))
	wantProblem(t, err, "reservation_overlap", "")
	exec(t, `update fleet.trips set vehicle_id = null, state = 'planned' where id = $1`, busy.ID)

	x, err := e.svc.Request(ctx, mgr1, c.body(modeHostOrHome))
	if err != nil {
		t.Fatalf("request with the vehicle: %v", err)
	}
	v := partOf(t, x)
	expect(t, "request with the vehicle", x, v.Mode == fleetapi.DriverTransferVehicleModeHostOrHome,
		v.HostVehicle != nil && v.HostVehicle.VehicleId == c.host && v.HostVehicle.OrgUnitId == unit("msk1"),
		v.HomeVehicle != nil && v.HomeVehicle.VehicleId == c.usual && v.HomeVehicle.OrgUnitId == unit("msk2"),
		v.HomeVehicle.ReservationId == nil, v.HomeDecision == nil, v.OfferGroupId == nil)
	if n := len(offersOf(t, c.tr)); n != 0 {
		t.Fatalf("%d reservations before the approval, want none", n)
	}
}

// 1b (Q-W2.70-8): «Отклонить» — только с причиной, до остальных проверок; «Только водителя» — только при запрошенной
// обычной машине.
func TestDecideReasonAndDriverOnly(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newOffer(t, "Без причины", 530*time.Hour)
	x := e.request(t, e.tc(t, "a.manager-msk1"), c.body(modeHost))
	blank := "  "
	for _, comment := range []*string{nil, &blank} {
		_, err := e.svc.Decide(ctx, mgr2, uuid.New(), etag(1), fleetapi.DriverTransferDecision{Decision: reject, Comment: comment})
		wantViolation(t, "reject без причины", err, "comment", "required")
	}
	_, err := e.svc.Decide(ctx, mgr2, x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approveDriverOnly})
	wantViolation(t, "только водителя без обычной машины", err, "decision", "usual_vehicle")
}

// docs/29 «Решение» п. 1, правило 4: одобрение с машиной и «можно свою» — две брони hold одной группы до срока выбора
// (начало окна − 30 минут), рейс без машины до выбора; назначение — с одобрения, машины — строки области resource.
func TestApproveTwoOffers(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newOffer(t, "Две машины", 540*time.Hour)
	got := e.requestOffer(t, c, modeHostOrHome, approve)
	deadline := c.w.Start.Add(-pool.ChooseBefore)
	v := partOf(t, got)
	expect(t, "approved request", got, v.HomeDecision != nil && *v.HomeDecision == fleetapi.DriverTransferVehicleHomeDecisionApproved,
		v.OfferGroupId != nil, at(v.ChooseUntil, deadline),
		v.HostVehicle.ReservationState != nil && *v.HostVehicle.ReservationState == fleetapi.TransferVehicleReservationStateHeld,
		v.HomeVehicle.ReservationState != nil && *v.HomeVehicle.ReservationState == fleetapi.TransferVehicleReservationStateHeld)
	offers := offersOf(t, c.tr)
	for vehicle, kind := range map[uuid.UUID]string{c.host: "host", c.usual: "usual"} {
		r, ok := offers[vehicle]
		expect(t, "offer "+kind, r, ok, r.state == "hold", same(r.group, *v.OfferGroupId), same(r.to, c.d),
			r.kind != nil && *r.kind == kind, at(r.until, deadline), at(r.expires, deadline))
	}
	state, vehicle, _ := tripVehicle(t, c.tr)
	expect(t, "trip before the choice", state, state == "planned", vehicle == nil)
	row := grantOf(t, got)
	expect(t, "grant from the approval (Q-W2.71-3)", row, atMoment(row.from, e.clock.Now()), atMoment(row.until, c.w.End))
	seen := resourceGrants(t, c.d, e.clock.Now())
	expect(t, "offered vehicles readable", seen, seen[c.host], seen[c.usual])
	if n := scalar[int](t, `select count(*) from outbox.events where type = 'fleet.reservation.held.v1'
		and payload->>'offerGroupId' = $1`, v.OfferGroupId.String()); n != 2 {
		t.Fatalf("fleet.reservation.held.v1 of the offer: %d, want 2", n)
	}
	if a, err := e.svc.TripAccess(t.Context(), as(c.d), c.tr.ID); err != nil || a != pool.AccessPrepare {
		t.Fatalf("access before the window: %v %v, want prepare", a, err)
	}
}

// Q-W2.70-1, -2: одна предложенная машина — бронь сразу confirmed, рейс assigned с ней; «Только водителя» — обычная
// машина не бронируется; своя обычная и «Только водителя» — броней нет.
func TestApproveOneOffer(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	for i, k := range []struct {
		name     string
		mode     fleetapi.DriverTransferVehicleCreateMode
		decision fleetapi.DriverTransferDecisionDecision
		want     func(c offerCase) (uuid.UUID, bool) // the confirmed vehicle; false — none
		home     fleetapi.DriverTransferVehicleHomeDecision
	}{
		{"наша машина", modeHost, approve, func(c offerCase) (uuid.UUID, bool) { return c.host, true }, ""},
		{"наша и можно свою, только водителя", modeHostOrHome, approveDriverOnly,
			func(c offerCase) (uuid.UUID, bool) { return c.host, true }, fleetapi.DriverTransferVehicleHomeDecisionDeclined},
		{"своя обычная", modeHome, approve, func(c offerCase) (uuid.UUID, bool) { return c.usual, true },
			fleetapi.DriverTransferVehicleHomeDecisionApproved},
		{"своя обычная, только водителя", modeHome, approveDriverOnly, func(offerCase) (uuid.UUID, bool) { return uuid.Nil, false },
			fleetapi.DriverTransferVehicleHomeDecisionDeclined},
	} {
		c := e.newOffer(t, "Одна машина "+k.name, 550*time.Hour+time.Duration(i)*10*time.Hour)
		got := e.requestOffer(t, c, k.mode, k.decision)
		want, ok := k.want(c)
		v := partOf(t, got)
		offers := offersOf(t, c.tr)
		state, vehicle, bundle := tripVehicle(t, c.tr)
		if !ok {
			expect(t, k.name, offers, len(offers) == 0, state == "planned", vehicle == nil,
				v.HomeDecision != nil && *v.HomeDecision == k.home)
			continue
		}
		r := offers[want]
		expect(t, k.name, r, len(offers) == 1, r.state == "confirmed", r.until == nil, at(r.expires, c.w.End), r.group != nil,
			state == "assigned", same(vehicle, want), same(bundle, r.id), v.OfferGroupId != nil,
			k.home == "" || (v.HomeDecision != nil && *v.HomeDecision == k.home))
	}
}

// Q-W2.71-5: одобрение после срока выбора — подтверждается машина фирмы рейса, обычная не бронируется.
func TestApproveAfterDeadline(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newOffer(t, "Поздно", 600*time.Hour)
	x := e.request(t, e.tc(t, "a.manager-msk1"), c.body(modeHostOrHome))
	e.clock.Set(c.w.Start.Add(-20 * time.Minute))
	e.decide(t, e.tc(t, "a.manager-msk2"), x, approve)
	offers := offersOf(t, c.tr)
	r := offers[c.host]
	expect(t, "after the deadline", offers, len(offers) == 1, r.state == "confirmed", r.until == nil)
}

// Q-W2.70-11: занятость и совместимость комплекта перепроверяются при одобрении — 409 целиком, запрос не меняется;
// фирма может одобрить только водителя.
func TestApproveRechecksVehicles(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newOffer(t, "Перепроверка машин", 610*time.Hour)
	x := e.request(t, e.tc(t, "a.manager-msk1"), c.body(modeHostOrHome))
	other := newTrip(t, "msk2", c.w, uuid.Nil)
	exec(t, `update fleet.trips set vehicle_id = $2, state = 'assigned' where id = $1`, other.ID, c.usual)
	_, err := e.svc.Decide(t.Context(), mgr2, x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
	wantProblem(t, err, "reservation_overlap", "")
	if n := len(offersOf(t, c.tr)); n != 0 {
		t.Fatalf("%d reservations after the refused approval", n)
	}
	got := e.decide(t, mgr2, x, approveDriverOnly)
	offers := offersOf(t, c.tr)
	expect(t, "driver only", got, got.Status == pool.StatusApproved, len(offers) == 1, offers[c.host].state == "confirmed")
}

// docs/29 «Данные и API», правило 8, TD-04: выбор водителя подтверждает одну бронь и снимает остальные (chosen); рейс
// получает выбранную машину; второй выбор, выбор после срока — 409 offer_closed без изменений; не предложенная —
// 404; «Оставить …» логиста — manager; уведомления фирме машины и логисту.
func TestChoose(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	c := e.newOffer(t, "Выбирает", 620*time.Hour)
	e.requestOffer(t, c, modeHostOrHome, approve)
	offers := offersOf(t, c.tr)
	usual, host := offers[c.usual], offers[c.host]

	_, err := e.svc.Choose(ctx, as(newDriver(t, "msk2", "Чужой водитель")), usual.id)
	wantProblem(t, err, "not_found", textResNotFound)
	e.clock.Set(e.clock.Now().Add(10 * time.Minute))
	got, err := e.svc.Choose(ctx, as(c.d), usual.id)
	expect(t, "choice", got, err == nil, got.Chosen.Id == usual.id,
		got.Chosen.State == fleetapi.ReservationStateConfirmed, at(got.Chosen.ChosenAt, e.clock.Now()),
		got.Chosen.OfferKind != nil && *got.Chosen.OfferKind == fleetapi.ReservationOfferKindUsual,
		len(got.Released) == 1 && got.Released[0].Id == host.id && got.Released[0].State == fleetapi.ReservationStateReleased &&
			got.Released[0].ReleaseReason != nil && *got.Released[0].ReleaseReason == fleetapi.ReservationReleaseReasonChosen)
	state, vehicle, bundle := tripVehicle(t, c.tr)
	expect(t, "trip after the choice", state, state == "assigned", same(vehicle, c.usual), same(bundle, usual.id))
	seen := resourceGrants(t, c.d, e.clock.Now())
	expect(t, "released vehicle closed", seen, seen[c.usual], !seen[c.host])
	for _, id := range []uuid.UUID{usual.id, host.id} {
		_, err = e.svc.Choose(ctx, as(c.d), id)
		wantProblem(t, err, "offer_closed", textOfferClosed)
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'fleet.reservation.confirmed'
		and recipient_person_id = $1 and entity_id = $2`, person("a.manager-msk2"), c.tr.ID); n != 1 {
		t.Errorf("«машина выбрана» of the company of the usual vehicle: %d, want 1", n)
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'fleet.reservation.confirmed'
		and recipient_person_id = $1 and entity_id = $2`, person("a.manager-msk1"), c.tr.ID); n != 1 {
		t.Errorf("«водитель выбрал» of the logist of the trip: %d, want 1", n)
	}

	k := e.newOffer(t, "Оставляет логист", 630*time.Hour)
	e.requestOffer(t, k, modeHostOrHome, approve)
	ko := offersOf(t, k.tr)
	kept, err := e.svc.Choose(ctx, e.tc(t, "a.manager-msk1"), ko[k.host].id)
	expect(t, "«Оставить …» of the logist", kept, err == nil, kept.Chosen.Id == ko[k.host].id,
		len(kept.Released) == 1 && *kept.Released[0].ReleaseReason == fleetapi.ReservationReleaseReasonManager)

	l := e.newOffer(t, "Опоздал", 640*time.Hour)
	e.requestOffer(t, l, modeHostOrHome, approve)
	lo := offersOf(t, l.tr)
	e.clock.Set(l.w.Start.Add(-pool.ChooseBefore))
	_, err = e.svc.Choose(ctx, as(l.d), lo[l.usual].id)
	wantProblem(t, err, "offer_closed", textOfferClosed)
	after := offersOf(t, l.tr)
	expect(t, "nothing changes after the deadline", after, after[l.usual].state == "hold", after[l.host].state == "hold")
}

// Правило 4: срок выбора прошёл без выбора — машина фирмы рейса подтверждена (chosenAt = срок), обычная снята
// (deadline) и вернулась в свою фирму, уведомление её фирме; повтор ничего не меняет.
func TestOfferDeadline(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newOffer(t, "Не выбрал", 650*time.Hour)
	e.requestOffer(t, c, modeHostOrHome, approve)
	deadline := c.w.Start.Add(-pool.ChooseBefore)
	// The offers of the other tests of the tenant may be due too: the test reads its own.
	settle := func(what string) {
		t.Helper()
		if _, err := e.svc.SettleOffers(t.Context(), ref("tenant:a")); err != nil {
			t.Fatalf("%s: %v", what, err)
		}
	}
	e.clock.Set(deadline.Add(-time.Minute))
	settle("before the deadline")
	before := offersOf(t, c.tr)
	expect(t, "before the deadline", before, before[c.host].state == "hold", before[c.usual].state == "hold")
	e.clock.Set(deadline.Add(time.Minute))
	settle("at the deadline")
	offers := offersOf(t, c.tr)
	host, usual := offers[c.host], offers[c.usual]
	expect(t, "vehicle of the trip company kept", host, host.state == "confirmed", at(host.chosen, deadline))
	expect(t, "usual vehicle released", usual, usual.state == "released", usual.reason != nil && *usual.reason == "deadline")
	state, vehicle, _ := tripVehicle(t, c.tr)
	expect(t, "trip", state, state == "assigned", same(vehicle, c.host))
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'fleet.reservation.released'
		and recipient_person_id = $1 and entity_id = $2`, person("a.manager-msk2"), c.tr.ID); n != 1 {
		t.Errorf("«машина освобождена» of the company of the usual vehicle: %d, want 1", n)
	}
	settle("repeat")
	again := offersOf(t, c.tr)
	expect(t, "repeat", again, again[c.host].state == "confirmed", again[c.usual].state == "released")
}

// Перевод кончился до старта рейса (отзыв) — брони предложения сняты (transfer_ended), строки машин закрыты.
func TestTransferEndReleasesOffers(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newOffer(t, "Отозван", 660*time.Hour)
	got := e.requestOffer(t, c, modeHostOrHome, approve)
	e.decide(t, e.tc(t, "a.manager-msk2"), got, revoke)
	offers := offersOf(t, c.tr)
	if len(offers) != 2 {
		t.Fatalf("%d reservations of the offer, want 2", len(offers))
	}
	for v, r := range offers {
		expect(t, "released offer "+v.String(), r, r.state == "released", r.reason != nil && *r.reason == "transfer_ended",
			r.releasedA != nil, r.chosen == nil)
	}
	if seen := resourceGrants(t, c.d, e.clock.Now()); len(seen) != 0 {
		t.Fatalf("vehicles readable after the revocation: %v", seen)
	}
}

// Q-W2.71-3: до окна запрос S2-20 открывает водителю только подготовку (рейс, брони, выбор), запрос 0.6.2 — ничего.
func TestPrepareAccess(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	plain := e.newDecision(t, "Без машины", 670*time.Hour)
	e.decide(t, e.tc(t, "a.manager-msk2"), plain.x, approve)
	if a, err := e.svc.TripAccess(t.Context(), as(plain.d), plain.tr.ID); err != nil || a != pool.AccessNone {
		t.Fatalf("0.6.2 request before the window: %v %v, want none", a, err)
	}
	if !pool.Prepares("getTrip") || !pool.Prepares("chooseReservation") || pool.Prepares("startTrip") ||
		pool.Prepares("submitInspection") {
		t.Fatal("the operations of the preparation: the trip, its reservations and the choice only")
	}
}
