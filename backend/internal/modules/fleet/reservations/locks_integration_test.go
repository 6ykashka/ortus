//go:build integration

package reservations

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched" //nolint:depguard // integration test: the holds of the core
	harness "github.com/ortus/ortus-crm/backend/test"           //nolint:depguard // integration test: the clock of the suite
)

// waitForLockWait waits until a backend of the tenant DB waits for a lock (the command under test reached its lock).
func (e env) waitForLockWait(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if e.count(t, `select count(*) from pg_stat_activity
			where datname = current_database() and wait_event_type = 'Lock' and state = 'active'`) > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("no command waits for a lock")
}

// waitForBlockedBy waits until a backend of the tenant DB waits for a lock the backend pid holds.
func (e env) waitForBlockedBy(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if e.count(t, `select count(*) from pg_stat_activity
			where datname = current_database() and $1 = any(pg_blocking_pids(pid))`, pid) > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no command waits for a lock of the backend %d", pid)
}

// A reservation of a trip with an earlier hold (an assignment of the logist, W2.03) releases that hold only after it
// locked its resources. A parallel reservation of the same vehicle holds the vehicle and waits, in its insert, for the
// rows of the earlier hold; a reservation that released those rows first and then waited for the vehicle deadlocked
// with it (40P01: 503 to one of them instead of 409 to the later one).
func TestReserveForTripReleasesThePriorHoldUnderTheLocks(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	me, msk1 := id(t, "person:a.driver-msk2@a"), id(t, "unit:a.msk1")
	v := e.vehicle(t)
	tr := e.trip(t, "msk1", me, "assigned", day(14, 12), day(14, 16), &v)
	prior := uuid.New()
	tx, err := e.pool(t).Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, sched.Hold(ctx, tx, sched.HoldRequest{
		Bundle: prior, Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: v, Home: msk1}},
		Window: sched.Window{Start: day(14, 12), End: day(14, 16)}, ExpiresAt: harness.Now().Add(time.Hour),
		SourceType: SourceTrip, SourceID: tr, CreatedBy: id(t, "person:a.manager-msk1@a"), Now: harness.Now(),
	}))
	_, err = tx.Exec(ctx, `update fleet.trips set reservation_bundle_id = $2 where id = $1`, tr, prior)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))

	// The parallel reservation of the vehicle has locked it (sched.Hold locks the resources first).
	other, err := e.pool(t).Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = other.Rollback(context.WithoutCancel(ctx)) }()
	var pid int
	require.NoError(t, other.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pid))
	_, err = other.Exec(ctx, `select 1 from sched.resources where kind = 'vehicle' and ref_id = $1 for update`, v)
	require.NoError(t, err)

	done, driver := make(chan error, 1), e.as(t, "a.driver-msk2")
	b := body(v, me, day(14, 12), day(14, 16))
	b.TripId = &tr
	go func() {
		_, err := e.reserve(driver, b)
		done <- err
	}()
	e.waitForBlockedBy(t, pid)

	// …and inserts its rows: the interval of the vehicle is still taken by the earlier hold of the trip.
	err = sched.Hold(ctx, other, sched.HoldRequest{
		Bundle: uuid.New(),
		Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: v, Home: msk1}, {Kind: sched.KindPerson, Ref: e.driver(t), Home: msk1}},
		Window: sched.Window{Start: day(14, 13), End: day(14, 15)}, ExpiresAt: harness.Now().Add(time.Hour),
		SourceType: SourceReservation, SourceID: uuid.New(), CreatedBy: id(t, "person:a.owner@a"), Now: harness.Now(),
	})
	require.ErrorIs(t, err, sched.ErrOverlap, "the parallel reservation gets 409, not a deadlock")
	require.NoError(t, other.Rollback(ctx))

	select {
	case err := <-done:
		require.NoError(t, err, "the reservation of the trip gets 201, not a deadlock")
	case <-time.After(30 * time.Second):
		t.Fatal("the reservation of the trip did not finish after the vehicle was unlocked")
	}
	require.Equal(t, 1, e.count(t, `select count(*) from sched.reservations where bundle_id = $1 and state = 'released'`, prior))
}

// The release of a hold of a trip takes the locks in the order of reserveVehicle — the trip first, then the rows of
// the hold. A reservation of the trip holds the trip and waits for the rows of its earlier hold to release them; a
// release holding those rows and waiting for the trip would deadlock with it (40P01 → 503 to one of them).
func TestReleaseLocksTheTripFirst(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	me := id(t, "person:a.driver-msk2@a")
	tr := e.trip(t, "msk1", me, "planned", day(12, 6), day(12, 12), nil)
	b := body(e.vehicle(t), me, day(12, 7), day(12, 9))
	b.TripId = &tr
	r := e.reserved(e.as(t, "a.driver-msk2"), t, b).Body

	ctx := t.Context()
	holder, err := e.pool(t).Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = holder.Rollback(context.WithoutCancel(ctx)) }()
	_, err = holder.Exec(ctx, `select 1 from fleet.trips where id = $1 for update`, tr) // a reservation of the trip runs
	require.NoError(t, err)

	done := make(chan error, 1)
	manager := e.as(t, "a.manager-msk1")
	go func() {
		_, err := e.release(manager, r.Id, `"1"`, fleetapi.Release)
		done <- err
	}()
	e.waitForLockWait(t)

	probe, err := e.pool(t).Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = probe.Rollback(context.WithoutCancel(ctx)) }() // before the holder: the pool closes after both
	_, err = probe.Exec(ctx, `select 1 from sched.reservations where bundle_id = $1 for update nowait`, r.Id)
	require.NoError(t, err, "the waiting release must not hold the rows of the hold")
	require.NoError(t, probe.Rollback(ctx))

	require.NoError(t, holder.Rollback(ctx))
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(30 * time.Second):
		t.Fatal("the release did not finish after the trip was unlocked")
	}
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'planned'`, tr))
}
