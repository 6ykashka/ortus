//go:build integration

package pool_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W2.57 (решение Q-W2.07-1; D09, 08-domain-scenarios §4.6 п. 7–8, AC-06): после окна или отзыва начатый рейс — только
// продолжение; приёмка, отмена и снятие водителя с рейса гасят назначение сразу; события fleet.transfer.*.v1.

// events counts the outbox events of type about transfer id.
func events(t *testing.T, typ string, id uuid.UUID) int {
	t.Helper()
	return scalar[int](t, `select count(*) from outbox.events where type = $1 and payload->>'id' = $2`, typ, id.String())
}

// startedDecision is an approved transfer of a published driver of Москва-2 whose trip of Москва-1 with a vehicle the
// driver started in the window (W2.05), settled after the start: its grant is open.
func (e *env) startedDecision(t *testing.T, name string, from time.Duration) (decision, fleetapi.DriverTransfer) {
	t.Helper()
	c := e.newDecision(t, name, from)
	assignVehicle(t, c.tr, newVehicle(t, "msk1"))
	x := e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	e.clock.Set(c.w.Start.Add(30 * time.Minute))
	exec(t, `update fleet.trips set state = 'on_route', started_at = $2 where id = $1`, c.tr.ID, e.clock.Now())
	if _, err := e.svc.SettleTrip(t.Context(), ref("tenant:a"), c.tr.ID); err != nil {
		t.Fatal(err)
	}
	if g := grantOf(t, x); g.until != nil {
		t.Fatalf("grant of the started trip ends at %v, want open", *g.until)
	}
	return c, x
}

// Отзыв начатого рейса (08 §4.6 п. 8): статус revoked, назначение — только продолжение (closing, просрочка, пока рейс не
// сдан), машина закрыта моментом отзыва, водитель остаётся на рейсе; приёмка гасит назначение моментом приёмки.
func TestRevokeKeepsTheContinuation(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2 := e.tc(t, "a.manager-msk2")
	c, x := e.startedDecision(t, "Отзыв в рейсе", 640*time.Hour)
	at := e.clock.Now().Add(time.Hour)
	e.clock.Set(at)
	revoked := e.decide(t, mgr2, x, revoke)
	expect(t, "revoked with the continuation", revoked, revoked.Status == pool.StatusRevoked, revoked.Revision == 3,
		revoked.Grant != nil && revoked.Grant.State == fleetapi.TemporaryDriverGrantStateClosing,
		revoked.Grant.Overdue != nil && *revoked.Grant.Overdue, revoked.Grant.EndedAt == nil, revoked.Grant.VehicleId == nil)
	g := grantOf(t, revoked)
	expect(t, "assignment of the continuation", g, g.state == "active", g.until == nil)
	if v := vehicleGrant(t, x.Id); v == nil || !atMoment(v.until, at) {
		t.Fatalf("assignment of the vehicle after the revocation: %+v, want closed at %v", v, at)
	}
	if p := tripDriver(t, c.tr); p == nil || *p != c.d {
		t.Fatal("the started trip lost its driver at the revocation")
	}
	if a, err := e.svc.TripAccess(ctx, as(c.d), c.tr.ID); err != nil || a != pool.AccessContinuation {
		t.Fatalf("access to the trip after the revocation: %v %v, want the continuation", a, err)
	}
	if n := events(t, "fleet.transfer.revoked.v1", x.Id); n != 1 {
		t.Errorf("fleet.transfer.revoked.v1: %d, want 1", n)
	}

	e.acceptAfterRevocation(t, c, x, at)
}

// acceptAfterRevocation hands over and accepts the trip of the revoked transfer x with the continuation open: handed
// over — not overdue; the acceptance ends the continuation at its moment (endedAt, endReason revoked), the trip
// answers 404 to the driver (AC-06), fleet.transfer.expired.v1 is published once.
func (e *env) acceptAfterRevocation(t *testing.T, c decision, x fleetapi.DriverTransfer, at time.Time) {
	t.Helper()
	ctx := t.Context()
	mgr1, mgr2 := e.tc(t, "a.manager-msk1"), e.tc(t, "a.manager-msk2")
	exec(t, `update fleet.trips set state = 'submitted' where id = $1`, c.tr.ID)
	got, err := e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "handed over: not overdue", got, err == nil, got.Grant.State == fleetapi.TemporaryDriverGrantStateClosing,
		got.Grant.Overdue != nil && !*got.Grant.Overdue)
	accepted := at.Add(2 * time.Hour)
	exec(t, `update fleet.trips set state = 'accepted', reviewed_at = $2 where id = $1`, c.tr.ID, accepted)
	e.clock.Set(accepted.Add(time.Minute))
	if _, err := e.svc.SettleTrip(ctx, ref("tenant:a"), c.tr.ID); err != nil {
		t.Fatal(err)
	}
	got, err = e.svc.Transfer(ctx, mgr2, x.Id)
	expect(t, "the continuation ended at the acceptance", got, err == nil, got.Status == pool.StatusRevoked,
		got.Grant.State == fleetapi.TemporaryDriverGrantStateEnded, atMoment(got.Grant.EndedAt, accepted),
		got.Grant.EndReason != nil && *got.Grant.EndReason == fleetapi.TemporaryDriverGrantEndReasonRevoked)
	if g := grantOf(t, x); !atMoment(g.until, accepted) {
		t.Fatalf("assignment after the acceptance ends at %v, want %v", g.until, accepted)
	}
	if a, err := e.svc.TripAccess(ctx, as(c.d), c.tr.ID); err != nil || a != pool.AccessNone {
		t.Fatalf("access to the accepted trip: %v %v, want none (AC-06)", a, err)
	}
	if n := events(t, "fleet.transfer.expired.v1", x.Id); n != 1 {
		t.Errorf("fleet.transfer.expired.v1 at the end of the continuation: %d, want 1", n)
	}
}

// Снятие водителя с рейса фирмой-получателем (W2.05) гасит назначение моментом досчёта, в окне (Q-W2.07-14).
func TestTakenOffTheTrip(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newDecision(t, "Снятый с рейса", 660*time.Hour)
	x := e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	e.clock.Set(c.w.Start.Add(time.Hour))
	exec(t, `update fleet.trips set driver_person_id = $2 where id = $1`, c.tr.ID, newDriver(t, "msk1", "Замена"))
	res, err := e.svc.SettleTrip(t.Context(), ref("tenant:a"), c.tr.ID)
	expect(t, "settlement of the trip", res, err == nil, res.Completed == 1, res.Closed == 1)
	got, err := e.svc.Transfer(t.Context(), e.tc(t, "a.manager-msk1"), x.Id)
	expect(t, "completed at the change of the driver", got, err == nil, got.Status == pool.StatusCompleted,
		got.CompletedAt != nil && got.CompletedAt.Equal(e.clock.Now()))
	if g := grantOf(t, x); g.until == nil || !g.until.Equal(e.clock.Now()) {
		t.Fatalf("assignment ends at %v, want %v", g.until, e.clock.Now())
	}
	if n := events(t, "fleet.transfer.expired.v1", x.Id); n != 1 {
		t.Errorf("fleet.transfer.expired.v1: %d, want 1", n)
	}
}

// Приёмка в окне гасит назначение моментом приёмки и завершает перевод сразу (бриф W2.57 §2 п. 3).
func TestAcceptanceInsideTheWindow(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c, x := e.startedDecision(t, "Принят в окне", 680*time.Hour)
	accepted := e.clock.Now().Add(time.Hour)
	exec(t, `update fleet.trips set state = 'accepted', reviewed_at = $2 where id = $1`, c.tr.ID, accepted)
	e.clock.Set(accepted.Add(time.Minute))
	if _, err := e.svc.SettleTenant(t.Context(), ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	wantStored(t, x.Id, "completed", 3)
	if g := grantOf(t, x); g.until == nil || !g.until.Equal(accepted) {
		t.Fatalf("assignment ends at %v, want the acceptance %v", g.until, accepted)
	}
	if v := vehicleGrant(t, x.Id); v == nil || v.until == nil || !v.until.Equal(accepted) {
		t.Fatalf("assignment of the vehicle: %+v, want closed at the acceptance", v)
	}
}

// Доступ временного водителя к рейсу перевода (правило надстройки пула, AC-06, D09): до окна и после него — нет
// (404), в окне — решают модули рейса, начатый рейс после окна — только продолжение; рейсы без перевода и владелец —
// без правила пула. Списки скрывают рейсы, закрытые водителю.
func TestTripAccess(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	c := e.newDecision(t, "Доступ к рейсу", 700*time.Hour)
	x := e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	d := as(c.d)
	access := func(want pool.Access, at time.Time, what string) {
		t.Helper()
		e.clock.Set(at)
		if a, err := e.svc.TripAccess(ctx, d, c.tr.ID); err != nil || a != want {
			t.Fatalf("%s: %v %v, want %v", what, a, err, want)
		}
	}
	access(pool.AccessNone, c.w.Start.Add(-time.Minute), "before the window")
	access(pool.AccessBase, c.w.Start.Add(time.Minute), "in the window")
	if a, err := e.svc.TripAccess(ctx, e.tc(t, "a.owner"), c.tr.ID); err != nil || a != pool.AccessBase {
		t.Fatalf("the owner: %v %v, want the base", a, err)
	}
	if a, err := e.svc.TripAccess(ctx, d, newTrip(t, "msk1", c.w, c.d).ID); err != nil || a != pool.AccessBase {
		t.Fatalf("a trip without a transfer: %v %v, want the base", a, err)
	}
	expense := scalar[uuid.UUID](t, `insert into fleet.expenses (trip_id, category, amount_minor, occurred_on, claimed_by)
		values ($1, 'wash', 50000, current_date, $2) returning id`, c.tr.ID, c.d)
	if trip, err := e.svc.TripOf(ctx, d, pool.ObjectExpense, expense); err != nil || trip != c.tr.ID {
		t.Fatalf("trip of the expense: %v %v, want %v", trip, err, c.tr.ID)
	}
	if trip, err := e.svc.TripOf(ctx, d, pool.ObjectExpense, uuid.New()); err != nil || trip != uuid.Nil {
		t.Fatalf("trip of a missing expense: %v %v, want none", trip, err)
	}
	hidden, err := e.svc.HiddenTrips(ctx, d)
	expect(t, "hidden trips in the window", hidden, err == nil, !hidden[c.tr.ID])
	accesses(t, e, d, c.tr.ID, pool.AccessBase, "in the window")

	exec(t, `update fleet.trips set state = 'on_route', started_at = $2, vehicle_id = $3 where id = $1`, c.tr.ID,
		c.w.Start.Add(time.Hour), newVehicle(t, "msk1"))
	access(pool.AccessContinuation, c.w.End.Add(time.Hour), "a started trip after the window")
	hidden, err = e.svc.HiddenTrips(ctx, d)
	expect(t, "hidden trips in the continuation", hidden, err == nil, !hidden[c.tr.ID])
	accesses(t, e, d, c.tr.ID, pool.AccessContinuation, "in the continuation")
	exec(t, `update fleet.trips set state = 'accepted', reviewed_at = $2 where id = $1`, c.tr.ID, c.w.End.Add(2*time.Hour))
	access(pool.AccessNone, c.w.End.Add(3*time.Hour), "an accepted trip")
	hidden, err = e.svc.HiddenTrips(ctx, d)
	expect(t, "hidden trips after the acceptance", hidden, err == nil, hidden[c.tr.ID])
	accesses(t, e, d, c.tr.ID, pool.AccessNone, "after the acceptance")
	if got, err := e.svc.Transfer(ctx, e.tc(t, "a.manager-msk1"), x.Id); err != nil || got.Status != pool.StatusCompleted {
		t.Fatalf("transfer after the acceptance: %v %+v", err, got)
	}
}

// accesses requires TripAccesses of d to leave trip at want (AccessBase — no entry): the files close the reservation
// of a trip in its continuation and every parent of a closed one (W2.57, return 2).
func accesses(t *testing.T, e *env, d tenantctx.TenantContext, trip uuid.UUID, want pool.Access, what string) {
	t.Helper()
	got, err := e.svc.TripAccesses(t.Context(), d)
	a, listed := got[trip]
	if err != nil || listed == (want == pool.AccessBase) || listed && a != want {
		t.Fatalf("trip accesses %s: %v %v, want %v", what, got, err, want)
	}
}

// События временного назначения (12-errors-and-events «fleet.transfer.*.v1 — временные grants»): одобрение и
// завершение по сроку; в нагрузке нет имени водителя.
func TestTransferEvents(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newDecision(t, "События назначения", 720*time.Hour)
	x := e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	if n := events(t, "fleet.transfer.approved.v1", x.Id); n != 1 {
		t.Errorf("fleet.transfer.approved.v1: %d, want 1", n)
	}
	e.clock.Set(c.w.End.Add(time.Minute))
	if _, err := e.svc.SettleTrip(t.Context(), ref("tenant:a"), c.tr.ID); err != nil {
		t.Fatal(err)
	}
	if n := events(t, "fleet.transfer.expired.v1", x.Id); n != 1 {
		t.Errorf("fleet.transfer.expired.v1 at the end of the window: %d, want 1", n)
	}
	if n := scalar[int](t, `select count(*) from outbox.events where type like 'fleet.transfer.%' and payload->>'id' = $1
		and payload::text like '%' || $2 || '%'`, x.Id.String(), "События назначения"); n != 0 {
		t.Errorf("events of the transfer carry a name: %d", n)
	}
}
