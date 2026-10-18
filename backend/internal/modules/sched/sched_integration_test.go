//go:build integration

package sched

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: roles of the fixture databases
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: PostgreSQL in testcontainers
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: migrated tenant DB with units (W1.04)
)

var (
	pool *pgxpool.Pool // tenant DB of A as ortus_api
	home uuid.UUID     // unit Москва-1 of A
)

func TestMain(m *testing.M) { os.Exit(runMain(m)) }

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	world, err := fixtures.Load(ctx, c, "sched", harness.Now())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if home, err = world.ID("unit:a.msk1"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	if pool, err = pgxpool.New(ctx, world.TenantURL(fixtures.TenantA, migrations.RoleAPI)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer pool.Close()
	return m.Run()
}

// at is an instant of 2 October 2026 (UTC), hh:00.
func at(hh int) time.Time { return time.Date(2026, 10, 2, hh, 0, 0, 0, time.UTC) }

var now = at(5) // the clock of the application in these tests

func vehicle() Claim { return Claim{Kind: KindVehicle, Ref: uuid.New(), Home: home} }

func driver() Claim { return Claim{Kind: KindPerson, Ref: uuid.New(), Home: home} }

func request(window Window, claims ...Claim) HoldRequest {
	b := uuid.New()
	return HoldRequest{
		Bundle: b, Claims: claims, Window: window, ExpiresAt: now.Add(30 * time.Minute),
		SourceType: "fleet.reservation", SourceID: b, CreatedBy: uuid.New(), Now: now,
	}
}

// inTx runs fn in a transaction of the tenant DB and commits it when fn succeeds.
func inTx(t *testing.T, fn func(tx pgx.Tx) error) error {
	t.Helper()
	ctx := t.Context()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func hold(t *testing.T, r HoldRequest) error {
	t.Helper()
	return inTx(t, func(tx pgx.Tx) error { return Hold(t.Context(), tx, r) })
}

type row struct {
	kind, state, source string
	ref, sourceID       uuid.UUID
	start, end          time.Time
	expires             *time.Time
	revision            int64
}

func rows(t *testing.T, bundle uuid.UUID) []row {
	t.Helper()
	rs, err := pool.Query(t.Context(), `select s.kind, r.state, r.source_type, s.ref_id, r.source_id, lower(r.during),
		upper(r.during), r.hold_expires_at, r.revision
		  from sched.reservations r join sched.resources s on s.id = r.resource_id
		 where r.bundle_id = $1 order by s.kind desc`, bundle)
	require.NoError(t, err)
	out, err := pgx.CollectRows(rs, func(r pgx.CollectableRow) (row, error) {
		var v row
		err := r.Scan(&v.kind, &v.state, &v.source, &v.ref, &v.sourceID, &v.start, &v.end, &v.expires, &v.revision)
		return v, err
	})
	require.NoError(t, err)
	return out
}

func TestHoldBundle(t *testing.T) {
	t.Parallel()
	v, d := vehicle(), driver()
	r := request(Window{at(10), at(14)}, v, d)
	require.NoError(t, hold(t, r))
	got := rows(t, r.Bundle)
	require.Len(t, got, 2)
	for i, c := range []Claim{v, d} {
		require.Equal(t, string(c.Kind), got[i].kind)
		require.Equal(t, c.Ref, got[i].ref)
		require.Equal(t, StateHold, got[i].state)
		require.Equal(t, "fleet.reservation", got[i].source)
		require.Equal(t, r.Bundle, got[i].sourceID)
		require.True(t, at(10).Equal(got[i].start) && at(14).Equal(got[i].end), "during %v…%v", got[i].start, got[i].end)
		require.NotNil(t, got[i].expires)
		require.True(t, r.ExpiresAt.Equal(*got[i].expires))
		require.Equal(t, int64(1), got[i].revision)
	}
	var homeOf uuid.UUID
	require.NoError(t, pool.QueryRow(t.Context(), `select home_unit_id from sched.resources where kind = 'vehicle' and ref_id = $1`,
		v.Ref).Scan(&homeOf))
	require.Equal(t, home, homeOf)
}

func TestHoldReportsTheTakenClaim(t *testing.T) {
	t.Parallel()
	v, d := vehicle(), driver()
	require.NoError(t, hold(t, request(Window{at(10), at(14)}, v, d)))

	busyVehicle := request(Window{at(12), at(16)}, v, driver())
	err := hold(t, busyVehicle)
	var oe *OverlapError
	require.ErrorAs(t, err, &oe)
	require.ErrorIs(t, err, ErrOverlap)
	require.Equal(t, 0, oe.Index)
	require.Equal(t, v.Ref, oe.Claim.Ref)
	require.Empty(t, rows(t, busyVehicle.Bundle), "a refused bundle holds nothing")

	busyDriver := request(Window{at(9), at(11)}, vehicle(), d)
	err = hold(t, busyDriver)
	require.ErrorAs(t, err, &oe)
	require.Equal(t, 1, oe.Index)
	require.Equal(t, d.Ref, oe.Claim.Ref)
	require.Empty(t, rows(t, busyDriver.Bundle))
}

// A hold that replaces a bundle (Replaces: the earlier hold of a trip) releases its live rows itself, after the
// resources of both are locked: the new hold may take the same interval of the same vehicle, the resources of the
// replaced bundle that the new one does not claim are freed, and a replaced bundle that holds nothing is no error.
func TestHoldReplacesABundle(t *testing.T) {
	t.Parallel()
	v, d, d2 := vehicle(), driver(), driver()
	prior := request(Window{at(10), at(14)}, v, d)
	require.NoError(t, hold(t, prior))

	next := request(Window{at(10), at(14)}, v, d2)
	next.Replaces = prior.Bundle
	require.NoError(t, hold(t, next), "the replaced hold does not block its successor")
	for _, x := range rows(t, prior.Bundle) {
		require.Equal(t, StateReleased, x.state)
		require.Equal(t, int64(2), x.revision)
	}
	require.Len(t, rows(t, next.Bundle), 2)
	require.NoError(t, hold(t, request(Window{at(11), at(12)}, vehicle(), d)), "the driver of the replaced hold is free")

	again := request(Window{at(15), at(16)}, v)
	again.Replaces = prior.Bundle // released already: nothing to release
	require.NoError(t, hold(t, again))

	self := request(Window{at(17), at(18)}, v)
	self.Replaces = self.Bundle
	require.ErrorIs(t, hold(t, self), ErrInvalid)
}

// The row of the first claim (the vehicle of a reservation) has the id of the bundle: a reservation of the API is
// found by that row as well as by its bundle (fleet/inspections submitInspection, the parent fleet.reservation of the
// files W1.09); the other rows get their own ids.
func TestHoldTheFirstRowIsTheBundle(t *testing.T) {
	t.Parallel()
	v, d := vehicle(), driver()
	r := request(Window{at(19), at(20)}, v, d)
	require.NoError(t, hold(t, r))
	var kind string
	require.NoError(t, pool.QueryRow(t.Context(), `select s.kind from sched.reservations x join sched.resources s on s.id = x.resource_id
		 where x.id = $1 and x.bundle_id = $1`, r.Bundle).Scan(&kind))
	require.Equal(t, string(KindVehicle), kind)
	var others int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from sched.reservations where bundle_id = $1 and id <> $1`,
		r.Bundle).Scan(&others))
	require.Equal(t, 1, others)
}

func TestHoldHalfOpenWindows(t *testing.T) {
	t.Parallel()
	v := vehicle()
	require.NoError(t, hold(t, request(Window{at(10), at(14)}, v)))
	require.NoError(t, hold(t, request(Window{at(14), at(18)}, v)), "back to back windows do not overlap")
	require.NoError(t, hold(t, request(Window{at(6), at(10)}, v)))
	require.ErrorIs(t, hold(t, request(Window{at(13), at(15)}, v)), ErrOverlap)
}

func TestHoldExpiresStaleHolds(t *testing.T) {
	t.Parallel()
	v := vehicle()
	first := request(Window{at(10), at(14)}, v)
	require.NoError(t, hold(t, first))

	later := request(Window{at(11), at(12)}, v)
	later.Now = first.ExpiresAt // the first hold ended right now
	later.ExpiresAt = later.Now.Add(30 * time.Minute)
	require.NoError(t, hold(t, later), "an ended hold does not block")
	require.Equal(t, StateExpired, rows(t, first.Bundle)[0].state)
	require.Equal(t, int64(2), rows(t, first.Bundle)[0].revision)
	require.Equal(t, StateHold, rows(t, later.Bundle)[0].state)
}

func TestReleaseFreesTheInterval(t *testing.T) {
	t.Parallel()
	v, d := vehicle(), driver()
	r := request(Window{at(10), at(14)}, v, d)
	require.NoError(t, hold(t, r))

	var rev int64
	require.NoError(t, inTx(t, func(tx pgx.Tx) error {
		var err error
		rev, err = Release(t.Context(), tx, r.Bundle, now)
		return err
	}))
	require.Equal(t, int64(2), rev)
	for _, x := range rows(t, r.Bundle) {
		require.Equal(t, StateReleased, x.state)
		require.Equal(t, int64(2), x.revision)
	}
	require.NoError(t, hold(t, request(Window{at(10), at(14)}, v, d)), "a released hold does not block")

	err := inTx(t, func(tx pgx.Tx) error { _, err := Release(t.Context(), tx, r.Bundle, now); return err })
	require.ErrorIs(t, err, ErrNotHeld, "released twice")
	err = inTx(t, func(tx pgx.Tx) error { _, err := Release(t.Context(), tx, uuid.New(), now); return err })
	require.ErrorIs(t, err, ErrNotHeld, "unknown bundle")
}

func TestReleaseOfAnEndedHold(t *testing.T) {
	t.Parallel()
	r := request(Window{at(10), at(14)}, vehicle())
	require.NoError(t, hold(t, r))
	err := inTx(t, func(tx pgx.Tx) error { _, err := Release(t.Context(), tx, r.Bundle, r.ExpiresAt); return err })
	require.ErrorIs(t, err, ErrNotHeld)
	require.Equal(t, StateHold, rows(t, r.Bundle)[0].state, "a failed release changes nothing")
}

func TestConsume(t *testing.T) {
	t.Parallel()
	v, d := vehicle(), driver()
	r := request(Window{at(10), at(14)}, v, d)
	require.NoError(t, hold(t, r))
	var rev int64
	require.NoError(t, inTx(t, func(tx pgx.Tx) error {
		var err error
		rev, err = Consume(t.Context(), tx, r.Bundle, now.Add(time.Minute))
		return err
	}))
	require.Equal(t, int64(2), rev)
	for _, x := range rows(t, r.Bundle) {
		require.Equal(t, StateConsumed, x.state)
	}
	later := request(Window{at(12), at(13)}, v)
	later.Now, later.ExpiresAt = r.ExpiresAt.Add(time.Hour), r.ExpiresAt.Add(2*time.Hour)
	require.ErrorIs(t, hold(t, later), ErrOverlap, "a consumed reservation blocks after the end of the hold")

	err := inTx(t, func(tx pgx.Tx) error { _, err := Consume(t.Context(), tx, r.Bundle, now); return err })
	require.ErrorIs(t, err, ErrNotHeld, "consumed twice")

	ended := request(Window{at(15), at(16)}, vehicle())
	require.NoError(t, hold(t, ended))
	err = inTx(t, func(tx pgx.Tx) error { _, err := Consume(t.Context(), tx, ended.Bundle, ended.ExpiresAt); return err })
	require.ErrorIs(t, err, ErrExpired)
}

// consumed holds r and consumes it at started (the start of the trip, W2.05).
func consumed(t *testing.T, r HoldRequest, started time.Time) {
	t.Helper()
	require.NoError(t, hold(t, r))
	require.NoError(t, inTx(t, func(tx pgx.Tx) error { _, err := Consume(t.Context(), tx, r.Bundle, started); return err }))
}

func end(t *testing.T, r HoldRequest, started, until time.Time) (int64, error) {
	t.Helper()
	var n int64
	err := inTx(t, func(tx pgx.Tx) error {
		var err error
		n, err = End(t.Context(), tx, r.SourceType, r.SourceID, started, until)
		return err
	})
	return n, err
}

// requireDuring requires every row of the bundle to hold [from, until) in during and occupied.
func requireDuring(t *testing.T, bundle uuid.UUID, from, until time.Time, msg string) {
	t.Helper()
	rs, err := pool.Query(t.Context(), `select lower(during), upper(during), lower(occupied), upper(occupied)
		  from sched.reservations where bundle_id = $1`, bundle)
	require.NoError(t, err)
	got, err := pgx.CollectRows(rs, func(r pgx.CollectableRow) ([4]time.Time, error) {
		var v [4]time.Time
		err := r.Scan(&v[0], &v[1], &v[2], &v[3])
		return v, err
	})
	require.NoError(t, err)
	require.NotEmpty(t, got, msg)
	for _, v := range got {
		require.True(t, v[0].Equal(from) && v[1].Equal(until) && v[2].Equal(from) && v[3].Equal(until),
			"%s: during %v…%v, occupied %v…%v, want %v…%v", msg, v[0], v[1], v[2], v[3], from, until)
	}
}

// End closes the consumed reservation of a source at the acceptance (W2.06, Q-W2.53-4): a reservation whose window
// began keeps its start and ends at the acceptance; one whose window had not begun (the trip started early) holds
// the time the resources were in use, [started, acceptance). Either way the rest of the window is free for a new
// hold, and both rows of the bundle (the vehicle and the driver) end.
func TestEndConsumed(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		window          Window
		started, accept time.Time
		from            time.Time
	}{
		"окно началось до приёмки":       {Window{at(4), at(8)}, at(5), at(6), at(4)},
		"старт и приёмка до начала окна": {Window{at(10), at(14)}, at(5), at(7), at(5)},
	} {
		v, d := vehicle(), driver()
		r := request(c.window, v, d)
		consumed(t, r, c.started)
		n, err := end(t, r, c.started, c.accept)
		require.NoError(t, err, name)
		require.Equal(t, int64(2), n, name)
		requireDuring(t, r.Bundle, c.from, c.accept, name)
		for _, x := range rows(t, r.Bundle) {
			require.Equal(t, StateConsumed, x.state, name)
			require.Equal(t, int64(3), x.revision, name)
		}
		require.NoError(t, hold(t, request(Window{c.accept, c.window.End}, v, d)), "%s: the rest of the window is free", name)
	}
}

// A trip that started early was on the road with its vehicle from its start: a hold of that vehicle on the time it
// was in use that has already ended (still «hold» in the table until the next hold of the resource) is expired under
// the lock of the resource, as Hold does, and does not stop the reservation from ending. A live reservation of another
// bundle on that time keeps the reservation as it was: the acceptance never fails on reservations_no_overlap.
func TestEndConsumedBeforeItsWindow(t *testing.T) {
	t.Parallel()
	v := vehicle()
	stale := request(Window{at(6), at(7)}, v)
	require.NoError(t, hold(t, stale)) // ends at 05:30, before the acceptance
	r := request(Window{at(10), at(14)}, v, driver())
	consumed(t, r, at(5))
	_, err := end(t, r, at(5), at(8))
	require.NoError(t, err)
	requireDuring(t, r.Bundle, at(5), at(8), "the stale hold does not block")
	require.Equal(t, StateExpired, rows(t, stale.Bundle)[0].state)

	w := vehicle()
	live := request(Window{at(6), at(7)}, w)
	live.ExpiresAt = at(9)
	require.NoError(t, hold(t, live))
	busy := request(Window{at(10), at(14)}, w)
	consumed(t, busy, at(5))
	n, err := end(t, busy, at(5), at(8))
	require.NoError(t, err)
	require.Zero(t, n)
	requireDuring(t, busy.Bundle, at(10), at(14), "a live hold on the time in use keeps the reservation")

	n, err = end(t, request(Window{at(10), at(14)}, vehicle()), at(5), at(8))
	require.NoError(t, err)
	require.Zero(t, n, "a source without a consumed reservation ends nothing")
	held := request(Window{at(15), at(16)}, vehicle())
	require.NoError(t, hold(t, held))
	n, err = end(t, held, at(5), at(8))
	require.NoError(t, err)
	require.Zero(t, n, "a hold is not consumed: End leaves it")
	require.Equal(t, StateHold, rows(t, held.Bundle)[0].state)
}

func TestHoldRejectsInvalidRequests(t *testing.T) {
	t.Parallel()
	ok := request(Window{at(10), at(14)}, vehicle())
	for name, mut := range map[string]func(*HoldRequest){
		"пустое окно":         func(r *HoldRequest) { r.Window = Window{at(10), at(10)} },
		"нет ресурсов":        func(r *HoldRequest) { r.Claims = nil },
		"срок уже прошёл":     func(r *HoldRequest) { r.ExpiresAt = r.Now },
		"нет комплекта":       func(r *HoldRequest) { r.Bundle = uuid.Nil },
		"ресурс без id":       func(r *HoldRequest) { r.Claims = []Claim{{Kind: KindVehicle, Home: home}} },
		"ресурс дважды":       func(r *HoldRequest) { r.Claims = []Claim{r.Claims[0], r.Claims[0]} },
		"неизвестный вид":     func(r *HoldRequest) { r.Claims = []Claim{{Kind: "boat", Ref: uuid.New(), Home: home}} },
		"нет источника брони": func(r *HoldRequest) { r.SourceType = "" },
	} {
		r := ok
		r.Bundle = uuid.New()
		r.Claims = append([]Claim(nil), ok.Claims...)
		mut(&r)
		require.ErrorIs(t, hold(t, r), ErrInvalid, name)
	}
}

// Concurrent holds of one vehicle for one window: exactly one wins, the others see the overlap (AC-03 at the core).
func TestConcurrentHoldsOfOneResource(t *testing.T) {
	t.Parallel()
	const n = 20
	v := vehicle()
	var (
		wg              sync.WaitGroup
		mu              sync.Mutex
		ok, overlap     int
		others          []error
		start           = make(chan struct{})
		window          = Window{at(10), at(14)}
		ctx, cancelTest = context.WithTimeout(t.Context(), time.Minute)
	)
	defer cancelTest()
	for range n {
		wg.Go(func() {
			<-start
			err := func() error {
				tx, err := pool.Begin(ctx)
				if err != nil {
					return err
				}
				defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
				if err := Hold(ctx, tx, request(window, v, driver())); err != nil {
					return err
				}
				return tx.Commit(ctx)
			}()
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ErrOverlap):
				overlap++
			default:
				others = append(others, err)
			}
		})
	}
	close(start)
	wg.Wait()
	require.Empty(t, others)
	require.Equal(t, 1, ok)
	require.Equal(t, n-1, overlap)
}
