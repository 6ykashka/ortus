//go:build integration

package pool_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
)

// Возврат 1 W2.72 (S2-20, D-35): строки машин предложения — у каждого перевода свои; предложение, у которого логист
// снял одну бронь, остаётся открытым для оставшейся и закрывается сроком; проверка занятости при одобрении — под
// блокировками машин; фирма снятой после выбора машины узнаёт об освобождении.

// releaseByLogist releases reservation id as releaseReservation of the logist of the trip company does it
// (sched.Release, offers.MarkReleased with the reason manager).
func releaseByLogist(t *testing.T, id uuid.UUID, at time.Time) {
	t.Helper()
	exec(t, `update sched.reservations set state = 'released', released_at = $2, release_reason = 'manager',
		chosen_at = null, revision = revision + 1 where id = $1`, id, at)
}

// revision is the stored revision of transfer id.
func revision(t *testing.T, id uuid.UUID) int64 {
	t.Helper()
	return scalar[int64](t, `select revision from fleet.driver_transfers where id = $1`, id)
}

// Замечание ревью 1: строки области resource предложенных машин закрываются по своему переводу. Водителя одобрили на
// два рейса с одной обычной машиной: выбор на первом рейсе и отзыв первого перевода не закрывают машины второго.
func TestOfferGrantsOfTwoTransfers(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	d := newDriver(t, "msk2", "Два перевода")
	usual, host1, host2 := newCar(t, "msk2"), newCar(t, "msk1"), newCar(t, "msk1")
	e.publishUsual(t, d, &usual, e.window(900*time.Hour, 960*time.Hour))
	w1, w2 := e.window(901*time.Hour, 905*time.Hour), e.window(949*time.Hour, 953*time.Hour)
	c1 := offerCase{d: d, usual: usual, host: host1, w: w1, tr: newTrip(t, "msk1", w1, uuid.Nil)}
	c2 := offerCase{d: d, usual: usual, host: host2, w: w2, tr: newTrip(t, "msk1", w2, uuid.Nil)}
	x1 := e.requestOffer(t, c1, modeHostOrHome, approve)
	e.requestOffer(t, c2, modeHostOrHome, approve)
	seen := resourceGrants(t, d, e.clock.Now())
	expect(t, "the vehicles of both offers", seen, seen[host1], seen[host2], seen[usual])

	if _, err := e.svc.Choose(ctx, as(d), offersOf(t, c1.tr)[host1].id); err != nil {
		t.Fatalf("choice on the first trip: %v", err)
	}
	seen = resourceGrants(t, d, e.clock.Now())
	expect(t, "the choice on the first trip keeps the usual vehicle offered on the second", seen, seen[host1], seen[host2],
		seen[usual])

	x1.Revision = revision(t, x1.Id)
	e.decide(t, e.tc(t, "a.manager-msk2"), x1, revoke)
	seen = resourceGrants(t, d, e.clock.Now())
	expect(t, "the revocation of the first transfer keeps the vehicles of the second", seen, !seen[host1], seen[host2],
		seen[usual])
}

// Замечания ревью (offers.Open, releaseReservation б): логист снял одну бронь открытого предложения — оставшуюся
// водитель выбирает; не выбрал — к сроку снимается и оставшаяся обычная (правило 4: остаётся машина логиста, а её
// логист снял; обычная возвращается в свою фирму, рейс без машины — «Требует решения», «нет машины»), уведомление её
// фирме.
func TestOfferAfterMemberReleased(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	c := e.newOffer(t, "Логист снял свою", 970*time.Hour)
	e.requestOffer(t, c, modeHostOrHome, approve)
	o := offersOf(t, c.tr)
	releaseByLogist(t, o[c.host].id, e.clock.Now())
	got, err := e.svc.Choose(ctx, as(c.d), o[c.usual].id)
	if err != nil {
		t.Fatalf("choice of the remaining reservation: %v", err)
	}
	expect(t, "choice of the remaining reservation", got, got.Chosen.Id == o[c.usual].id,
		got.Chosen.State == fleetapi.ReservationStateConfirmed, len(got.Released) == 0)
	state, vehicle, _ := tripVehicle(t, c.tr)
	expect(t, "trip after the choice", state, state == "assigned", same(vehicle, c.usual))
	_, err = e.svc.Choose(ctx, as(c.d), o[c.host].id)
	wantProblem(t, err, "offer_closed", textOfferClosed)

	k := e.newOffer(t, "Логист снял свою, срок", 980*time.Hour)
	e.requestOffer(t, k, modeHostOrHome, approve)
	ko := offersOf(t, k.tr)
	releaseByLogist(t, ko[k.host].id, e.clock.Now())
	e.clock.Set(k.w.Start.Add(-pool.ChooseBefore).Add(time.Minute))
	if _, err := e.svc.SettleOffers(ctx, ref("tenant:a")); err != nil {
		t.Fatalf("SettleOffers: %v", err)
	}
	after := offersOf(t, k.tr)
	u := after[k.usual]
	expect(t, "the remaining usual vehicle at the deadline", u, u.state == "released", u.reason != nil && *u.reason == "deadline",
		u.chosen == nil)
	state, vehicle, _ = tripVehicle(t, k.tr)
	expect(t, "trip without a vehicle", state, state == "planned", vehicle == nil)
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'fleet.reservation.released'
		and recipient_person_id = $1 and entity_id = $2`, person("a.manager-msk2"), k.tr.ID); n != 1 {
		t.Errorf("«машина освобождена» of the company of the usual vehicle: %d, want 1", n)
	}
	if n := scalar[int](t, `select count(*) from sched.reservations where offer_group_id = $1 and state = 'hold'`,
		*u.group); n != 0 {
		t.Errorf("%d held reservations of the offer after the deadline, want none", n)
	}
}

// Замечание ревью (pool/offer.go, гонка): занятость машин при одобрении проверяется под блокировками их ресурсов —
// рейс, взявший машину без брони, пока одобрение ждало ресурс, даёт 409 reservation_overlap, а не вторую бронь.
func TestApproveChecksUnderTheLocks(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newOffer(t, "Гонка проверки", 990*time.Hour)
	x := e.request(t, e.tc(t, "a.manager-msk1"), c.body(modeHostOrHome))
	exec(t, `insert into sched.resources (kind, ref_id, home_unit_id) values ('vehicle', $1, $2) on conflict do nothing`,
		c.usual, unit("msk2"))
	res := scalar[uuid.UUID](t, `select id from sched.resources where kind = 'vehicle' and ref_id = $1`, c.usual)
	_, release := hold(t, "sched.resources", res)
	done := make(chan error, 1)
	go func() {
		_, err := e.svc.Decide(context.WithoutCancel(t.Context()), mgr2, x.Id, etag(x.Revision),
			fleetapi.DriverTransferDecision{Decision: approve})
		done <- err
	}()
	time.Sleep(pause)
	other := newTrip(t, "msk2", c.w, uuid.Nil)
	exec(t, `update fleet.trips set vehicle_id = $2, state = 'assigned' where id = $1`, other.ID, c.usual)
	release()
	wantProblem(t, <-done, "reservation_overlap", "")
	if n := len(offersOf(t, c.tr)); n != 0 {
		t.Fatalf("%d reservations after the refused approval", n)
	}
}

// Замечание ревью (routes/offer.go): логист фирмы рейса снял выбранную обычную машину (правило 8, assignTripVehicle
// или releaseReservation) — её фирма получает «машина освобождена».
func TestNotifyReleasedAfterChoice(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr1 := e.tc(t, "a.manager-msk1")
	c := e.newOffer(t, "Сменили машину", 1000*time.Hour)
	e.requestOffer(t, c, modeHostOrHome, approve)
	o := offersOf(t, c.tr)
	if _, err := e.svc.Choose(ctx, as(c.d), o[c.usual].id); err != nil {
		t.Fatalf("choice: %v", err)
	}
	live, err := e.svc.ForeignOffers(ctx, mgr1, c.tr.ID)
	if err != nil {
		t.Fatalf("ForeignOffers: %v", err)
	}
	expect(t, "the live reservation of the usual vehicle", live, len(live) == 1 && live[0] == o[c.usual].id)
	releaseByLogist(t, o[c.usual].id, e.clock.Now())
	if err := e.svc.NotifyReleased(ctx, mgr1, c.tr.ID, live); err != nil {
		t.Fatalf("NotifyReleased: %v", err)
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'fleet.reservation.released'
		and recipient_person_id = $1 and entity_id = $2`, person("a.manager-msk2"), c.tr.ID); n != 1 {
		t.Errorf("«машина освобождена» of the company of the usual vehicle: %d, want 1", n)
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where kind = 'fleet.reservation.released'
		and recipient_person_id = $1 and entity_id = $2`, person("a.manager-msk1"), c.tr.ID); n != 0 {
		t.Errorf("«машина освобождена» of the trip company: %d, want none", n)
	}
}
