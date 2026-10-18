//go:build integration

package vehicles

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // integration test: codes of the shared helpers
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"   //nolint:depguard // integration test: the first hold of a vehicle
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suite
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// history pages through listVehicleAssignments of vid for ctx and returns the periods in the order of the pages.
func (e env) history(ctx context.Context, t *testing.T, vid uuid.UUID, limit *int) [][]fleetapi.VehicleAssignment {
	t.Helper()
	var pages [][]fleetapi.VehicleAssignment
	p := fleetapi.ListVehicleAssignmentsParams{Limit: limit}
	for n := 0; ; n++ {
		require.Less(t, n, 100, "too many pages")
		resp, err := e.srv.ListVehicleAssignments(ctx, fleetapi.ListVehicleAssignmentsRequestObject{
			TenantId: tenantOf(ctx, t), VehicleId: vid, Params: p,
		})
		require.NoError(t, err)
		ok, isOK := resp.(fleetapi.ListVehicleAssignments200JSONResponse)
		require.True(t, isOK, "%T", resp)
		require.Equal(t, kit.NoStore, *ok.Headers.CacheControl)
		pages = append(pages, ok.Body.Items)
		if ok.Body.NextCursor == nil {
			return pages
		}
		p.Cursor = ok.Body.NextCursor
	}
}

// periods is the whole history of vid for ctx.
func (e env) periods(ctx context.Context, t *testing.T, vid uuid.UUID) []fleetapi.VehicleAssignment {
	t.Helper()
	var out []fleetapi.VehicleAssignment
	for _, p := range e.history(ctx, t, vid, nil) {
		out = append(out, p...)
	}
	return out
}

func units(ps []fleetapi.VehicleAssignment) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(ps))
	for _, p := range ps {
		out = append(out, p.OrgUnitId)
	}
	return out
}

func (e env) move(ctx context.Context, vid uuid.UUID, ifMatch string, b *fleetapi.VehicleMove) (fleetapi.MoveVehicleResponseObject, error) {
	tc, _ := tenantContext(ctx)
	return e.srv.MoveVehicle(ctx, fleetapi.MoveVehicleRequestObject{
		TenantId: tc, VehicleId: vid, Params: fleetapi.MoveVehicleParams{IdempotencyKey: uuid.NewString(), IfMatch: ifMatch}, Body: b,
	})
}

// moved moves vid to unit (a key of tenant A) at the revision ifMatch and requires a 200.
func (e env) moved(ctx context.Context, t *testing.T, vid uuid.UUID, ifMatch, unit string) fleetapi.MoveVehicle200JSONResponse {
	t.Helper()
	resp, err := e.move(ctx, vid, ifMatch, &fleetapi.VehicleMove{OrgUnitId: id(t, "unit:a."+unit), Reason: "Перевод в " + unit})
	require.NoError(t, err)
	ok, isOK := resp.(fleetapi.MoveVehicle200JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok
}

func (e env) unitName(t *testing.T, unit string) string {
	t.Helper()
	var name string
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `select name from org.units where id = $1`,
		id(t, "unit:a."+unit)).Scan(&name))
	return name
}

func (e env) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), sql, args...).Scan(&n))
	return n
}

// tripIn registers a trip of Москва-3 in state with vehicle vid, started an hour ago (the trips past the start keep
// started_at), and returns its id.
func (e env) tripIn(t *testing.T, vid uuid.UUID, state string) uuid.UUID {
	t.Helper()
	var tid uuid.UUID
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `insert into fleet.trips
		(number, unit_id, state, vehicle_id, planned, started_at)
		values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), $7) returning id`,
		"Р-"+uuid.NewString()[:8], id(t, "unit:a.msk3"), state, vid, at(6), at(10), harness.Now().Add(-time.Hour)).Scan(&tid))
	return tid
}

// requireProblem requires err to be a Problem with code and, if given, exactly the detail.
func requireProblem(t *testing.T, err error, code string, detail ...string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	require.True(t, ok, "not a Problem: %v", err)
	require.Equal(t, code, pe.Code, "%v", err)
	for _, d := range detail {
		require.Equal(t, d, pe.Detail)
	}
}

// The period of the registration (tenant 0016 opens it): the company of the vehicle since its registration, no
// reason and no author; the vehicle has no orgUnitSince until it moves (Q-W2.52-6).
func TestVehicleHistoryOfRegistration(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	registered := harness.Now().Add(-48 * time.Hour)
	vid := e.add(t, vehicle{unit: "msk1", createdAt: registered})
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	got := e.periods(ctx, t, vid)
	require.Len(t, got, 1)
	p := got[0]
	require.Equal(t, vid, p.VehicleId)
	require.Equal(t, id(t, "unit:a.msk1"), p.OrgUnitId)
	require.Equal(t, e.unitName(t, "msk1"), *p.OrgUnitName)
	require.True(t, registered.Equal(p.ValidFrom), "valid from the registration: %s", p.ValidFrom)
	require.Equal(t, time.UTC, p.ValidFrom.Location())
	require.Nil(t, p.ValidTo)
	require.Nil(t, p.Reason)
	require.Nil(t, p.AssignedByMemberId)
	require.Nil(t, find(t, e.list(ctx, t, fleetapi.ListVehiclesParams{}), vid).OrgUnitSince)
}

// A vehicle outside the scope of fleet.vehicles.read, an archived one, a vehicle of another organization and an id
// that does not exist are one 404 (AC-01, AC-02).
func TestVehicleHistoryNotFound(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	smr2, msk1 := e.add(t, vehicle{unit: "smr2"}), e.add(t, vehicle{unit: "msk1"})
	archived := e.add(t, vehicle{unit: "msk1"})
	_, err := e.pool(t, fixtures.TenantA).Exec(t.Context(), `update fleet.vehicles set archived_at = $2 where id = $1`, archived, harness.Now())
	require.NoError(t, err)
	for _, c := range []struct {
		name, actor, tenant string
		vid                 uuid.UUID
	}{
		{"соседняя область", "a.manager-msk1", fixtures.TenantA, smr2},
		{"соседняя фирма", "a.manager-msk2", fixtures.TenantA, msk1},
		{"в архиве", "a.owner", fixtures.TenantA, archived},
		{"несуществующая", "a.owner", fixtures.TenantA, uuid.New()},
		{"машина другой организации", "b.owner", fixtures.TenantB, msk1},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			ctx := e.as(t, c.actor, c.tenant)
			_, err := e.srv.ListVehicleAssignments(ctx, fleetapi.ListVehicleAssignmentsRequestObject{TenantId: tenantOf(ctx, t), VehicleId: c.vid})
			requireProblem(t, err, problem.CodeNotFound, TextNotFound)
		})
	}
	_, err = e.srv.ListVehicleAssignments(t.Context(), fleetapi.ListVehicleAssignmentsRequestObject{VehicleId: smr2})
	requireProblem(t, err, problem.CodeNotFound)
}

// moveVehicle (W2.42): in one transaction the open period ends now, a new one starts in the target company with its
// reason and author, the vehicle changes its company with revision + 1 and its resource of the scheduling core
// follows it; an audit row and fleet.vehicle.moved.v1 are written.
func TestMoveVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	registered := now.Add(-30 * 24 * time.Hour)
	vid := e.add(t, vehicle{unit: "msk1", createdAt: registered})
	e.hold(t, vid, at(10), at(14), now.Add(-2*time.Hour), now.Add(-time.Hour), nil) // an ended hold: the resource exists
	owner := e.as(t, "a.owner", fixtures.TenantA)
	msk1, msk2 := id(t, "unit:a.msk1"), id(t, "unit:a.msk2")

	resp := e.moved(owner, t, vid, `"1"`, "msk2")
	v := resp.Body
	require.Equal(t, msk2, v.OrgUnitId)
	require.Equal(t, int64(2), v.Revision)
	require.Equal(t, `"2"`, *resp.Headers.ETag)
	require.False(t, *resp.Headers.IdempotencyReplayed)
	require.Equal(t, kit.NoStore, *resp.Headers.CacheControl)
	require.NotNil(t, v.OrgUnitSince)
	require.True(t, now.Equal(*v.OrgUnitSince), "orgUnitSince %s, want the clock of the application %s", v.OrgUnitSince, now)
	require.Equal(t, fleetapi.VehicleStatusAvailable, v.Status)

	got := e.periods(owner, t, vid)
	require.Equal(t, []uuid.UUID{msk2, msk1}, units(got), "newest first")
	require.Nil(t, got[0].ValidTo)
	require.True(t, now.Equal(got[0].ValidFrom))
	require.Equal(t, "Перевод в msk2", *got[0].Reason)
	require.Equal(t, id(t, "person:a.owner@a"), *got[0].AssignedByMemberId)
	require.Equal(t, e.unitName(t, "msk2"), *got[0].OrgUnitName)
	require.True(t, now.Equal(*got[1].ValidTo), "the period of Москва-1 ends at the move")
	require.True(t, registered.Equal(got[1].ValidFrom))

	require.Equal(t, 1, e.count(t, `select count(*) from fleet.vehicles where id = $1 and unit_id = $2 and revision = 2`, vid, msk2))
	require.Equal(t, 1, e.count(t, `select count(*) from sched.resources where kind = 'vehicle' and ref_id = $1 and home_unit_id = $2`, vid, msk2))
	require.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.vehicle.move'
		and target_type = 'fleet.vehicle' and target_id = $1 and unit_id = $2 and reason = 'Перевод в msk2'`, vid, msk2))
	require.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.vehicle.moved.v1' and aggregate_id = $1
		and payload->>'fromOrgUnitId' = $2 and payload->>'toOrgUnitId' = $3`, vid, msk1.String(), msk2.String()))

	listed := find(t, e.list(owner, t, fleetapi.ListVehiclesParams{}), vid)
	require.Equal(t, v, listed, "moveVehicle answers what listVehicles reads")
}

// History is shown by right (fleet.vehicles.read): the periods in companies outside the scope of the actor are left
// out — the answer never names a company the actor cannot see; after the move the former company no longer sees the
// vehicle at all.
func TestVehicleHistoryByRight(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	vid := e.add(t, vehicle{unit: "msk1", createdAt: harness.Now().Add(-time.Hour)})
	e.moved(e.as(t, "a.owner", fixtures.TenantA), t, vid, `"1"`, "msk2")
	msk1, msk2 := id(t, "unit:a.msk1"), id(t, "unit:a.msk2")
	for _, c := range []struct {
		actor string
		want  []uuid.UUID
	}{
		{"a.owner", []uuid.UUID{msk2, msk1}},
		{"a.region-msk", []uuid.UUID{msk2, msk1}},
		{"a.manager-msk2", []uuid.UUID{msk2}},
	} {
		require.Equal(t, c.want, units(e.periods(e.as(t, c.actor, fixtures.TenantA), t, vid)), c.actor)
	}
	former := e.as(t, "a.manager-msk1", fixtures.TenantA)
	_, err := e.srv.ListVehicleAssignments(former, fleetapi.ListVehicleAssignmentsRequestObject{TenantId: tenantOf(former, t), VehicleId: vid})
	requireProblem(t, err, problem.CodeNotFound, TextNotFound)
	require.NotContains(t, ids(e.list(former, t, fleetapi.ListVehiclesParams{})), vid, "the former company does not see the vehicle")
	got := find(t, e.list(e.as(t, "a.manager-msk2", fixtures.TenantA), t, fleetapi.ListVehiclesParams{}), vid)
	require.NotNil(t, got.OrgUnitSince)
}

// Two moves at the same instant of the application clock (APP_FIXED_NOW of the stand, or a vehicle registered by the
// clock of the database after it): every next period starts a microsecond after the previous one.
func TestMoveVehicleAtFixedClock(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	vid := e.add(t, vehicle{unit: "msk1", createdAt: now.Add(time.Hour)}) // registered after the clock of the application
	owner := e.as(t, "a.owner", fixtures.TenantA)
	e.moved(owner, t, vid, `"1"`, "msk2")
	back := e.moved(owner, t, vid, `"2"`, "msk1")
	require.Equal(t, int64(3), back.Body.Revision)
	got := e.periods(owner, t, vid)
	require.Equal(t, []uuid.UUID{id(t, "unit:a.msk1"), id(t, "unit:a.msk2"), id(t, "unit:a.msk1")}, units(got))
	start := now.Add(time.Hour)
	require.True(t, start.Equal(got[2].ValidFrom))
	require.True(t, start.Add(time.Microsecond).Equal(got[1].ValidFrom))
	require.True(t, start.Add(2*time.Microsecond).Equal(got[0].ValidFrom))
	require.True(t, got[0].ValidFrom.Equal(*back.Body.OrgUnitSince))
}

func TestVehicleHistoryPages(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	vid := e.add(t, vehicle{unit: "msk1", createdAt: harness.Now().Add(-time.Hour)})
	owner := e.as(t, "a.owner", fixtures.TenantA)
	// Самара-1, -3, -4: the parallel tests of listVehicles require exact lists of Москва-3, -4 and Петербург-2, -3.
	for i, unit := range []string{"smr1", "smr3", "smr4"} {
		e.moved(owner, t, vid, kit.ETag(int64(i+1)), unit)
	}
	limit := 2
	var got [][]uuid.UUID
	for _, p := range e.history(owner, t, vid, &limit) {
		got = append(got, units(p))
	}
	u := func(k string) uuid.UUID { return id(t, "unit:a."+k) }
	require.Equal(t, [][]uuid.UUID{{u("smr4"), u("smr3")}, {u("smr1"), u("msk1")}}, got)
}

// The refusals of moveVehicle in the order of the contract; a refused command writes nothing.
func TestMoveVehicleRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	mine := e.add(t, vehicle{unit: "msk1"})
	smr2 := e.add(t, vehicle{unit: "smr2"})
	manager, twoRoles := e.as(t, "a.manager-msk1", fixtures.TenantA), e.as(t, "a.two-roles", fixtures.TenantA)
	body := func(unit uuid.UUID) *fleetapi.VehicleMove {
		return &fleetapi.VehicleMove{OrgUnitId: unit, Reason: "Перевод"}
	}
	msk1, msk2, smr2Unit := id(t, "unit:a.msk1"), id(t, "unit:a.msk2"), id(t, "unit:a.smr2")

	_, err := e.move(manager, mine, `"1"`, nil)
	requireProblem(t, err, problem.CodeMalformedRequest)
	_, err = e.move(manager, mine, `"1"`, &fleetapi.VehicleMove{OrgUnitId: msk2, Reason: "  "})
	requireProblem(t, err, kit.CodeValidationFailed, textMoveReason)
	_, err = e.move(manager, smr2, `"1"`, body(msk1))
	requireProblem(t, err, problem.CodeNotFound, TextNotFound)
	_, err = e.move(manager, uuid.New(), `"1"`, body(msk1))
	requireProblem(t, err, problem.CodeNotFound, TextNotFound)
	_, err = e.move(twoRoles, smr2, `"1"`, body(msk1))
	requireProblem(t, err, problem.CodeForbiddenAction)
	_, err = e.move(manager, mine, "", body(msk2))
	requireProblem(t, err, kit.CodeRevisionRequired)
	_, err = e.move(manager, mine, `"7"`, body(msk2))
	requireProblem(t, err, kit.CodeRevisionMismatch)
	_, err = e.move(manager, mine, `"1"`, body(msk1))
	requireProblem(t, err, kit.CodeValidationFailed, textSameUnit)
	_, err = e.move(manager, mine, `"1"`, body(msk2))
	requireProblem(t, err, kit.CodeValidationFailed, textUnknownUnit)
	_, err = e.move(manager, mine, `"1"`, body(uuid.New()))
	requireProblem(t, err, kit.CodeValidationFailed, textUnknownUnit)
	_, err = e.move(twoRoles, mine, `"1"`, body(smr2Unit))
	requireProblem(t, err, problem.CodeForbiddenAction)

	busy := map[string]uuid.UUID{}
	busy["бронь"] = e.add(t, vehicle{unit: "msk1"})
	e.hold(t, busy["бронь"], at(10), at(14), now, now.Add(30*time.Minute), nil)
	for _, state := range []string{TripAssigned, TripInspection, TripOnRoute, TripSubmitted, TripRework} {
		busy[state] = e.add(t, vehicle{unit: "msk1"})
		e.tripIn(t, busy[state], state)
	}
	for name, vid := range busy {
		_, err := e.move(manager, vid, `"1"`, body(id(t, "unit:a.msk1")))
		requireProblem(t, err, kit.CodeValidationFailed, textSameUnit) // the same company comes first
		owner := e.as(t, "a.owner", fixtures.TenantA)
		_, err = e.move(owner, vid, `"1"`, body(msk2))
		requireProblem(t, err, codeUnavailable, textBusy)
		require.Equal(t, 1, e.count(t, `select count(*) from fleet.vehicle_assignments where vehicle_id = $1`, vid), name)
	}
	for _, vid := range []uuid.UUID{mine, smr2} {
		require.Equal(t, 1, e.count(t, `select count(*) from fleet.vehicle_assignments where vehicle_id = $1`, vid))
		require.Equal(t, 1, e.count(t, `select count(*) from fleet.vehicles where id = $1 and revision = 1`, vid))
	}
	require.Zero(t, e.count(t, `select count(*) from audit.events where action = 'fleet.vehicle.move' and target_id = any($1)`,
		[]uuid.UUID{mine, smr2}))
}

// The race with the first hold of a vehicle (§10 of the brief): a vehicle that was never held has no resource of the
// scheduling core yet, and sched.Hold creates it. A move that runs while such a hold is not committed waits for it
// and then refuses with 409 — it never moves a vehicle a parallel reservation or trip assignment has just taken.
func TestMoveVehicleWaitsForAFirstHold(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	vid := e.add(t, vehicle{unit: "msk1"})
	pool := e.pool(t, fixtures.TenantA)
	require.Zero(t, e.count(t, `select count(*) from sched.resources where kind = 'vehicle' and ref_id = $1`, vid))

	ctx := t.Context()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	b := uuid.New()
	require.NoError(t, sched.Hold(ctx, tx, sched.HoldRequest{
		Bundle: b, Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: vid, Home: id(t, "unit:a.msk1")}},
		Window: sched.Window{Start: at(10), End: at(14)}, ExpiresAt: now.Add(30 * time.Minute),
		SourceType: "fleet.reservation", SourceID: b, CreatedBy: uuid.New(), Now: now,
	}))
	var holder int32
	require.NoError(t, tx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&holder))

	owner, body := e.as(t, "a.owner", fixtures.TenantA), &fleetapi.VehicleMove{OrgUnitId: id(t, "unit:a.msk2"), Reason: "Гонка с бронью"}
	done := make(chan error, 1)
	go func() {
		_, err := e.move(owner, vid, `"1"`, body)
		done <- err
	}()
	waitBlockedBy(t, pool, holder, done)
	require.NoError(t, tx.Commit(ctx))

	select {
	case err := <-done:
		requireProblem(t, err, codeUnavailable, textBusy)
	case <-time.After(30 * time.Second):
		require.FailNow(t, "the move did not finish after the hold was committed")
	}
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.vehicle_assignments where vehicle_id = $1`, vid))
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.vehicles where id = $1 and unit_id = $2 and revision = 1`,
		vid, id(t, "unit:a.msk1")))
}

// waitBlockedBy waits until a backend of pool waits for a lock the backend holder keeps; a command that finishes
// before it (done) did not wait and fails the test.
func waitBlockedBy(t *testing.T, pool *pgxpool.Pool, holder int32, done <-chan error) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			require.FailNow(t, "the move did not wait for the uncommitted hold", "it answered %v", err)
		default:
		}
		var n int
		require.NoError(t, pool.QueryRow(t.Context(),
			`select count(*) from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))`, holder).Scan(&n))
		if n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	require.FailNow(t, "no backend waits for the uncommitted hold")
}

// A trip that is closed (accepted or cancelled) and a hold that ended do not keep the vehicle.
func TestMoveVehicleAfterClosedTrip(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	owner := e.as(t, "a.owner", fixtures.TenantA)
	accepted := e.add(t, vehicle{unit: "msk1"})
	e.tripIn(t, accepted, "accepted")
	cancelled := e.add(t, vehicle{unit: "msk1"})
	e.tripIn(t, cancelled, "cancelled")
	ended := e.add(t, vehicle{unit: "msk1"})
	e.hold(t, ended, at(10), at(14), now.Add(-2*time.Hour), now.Add(-time.Hour), nil)
	for _, vid := range []uuid.UUID{accepted, cancelled, ended} {
		require.Equal(t, id(t, "unit:a.msk2"), e.moved(owner, t, vid, `"1"`, "msk2").Body.OrgUnitId)
	}
	require.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where vehicle_id = $1 and unit_id = $2`, accepted, id(t, "unit:a.msk3")),
		"the trip stays with the company it was made in")
}

// «Кто владел машиной на дату» (модель данных 2): UnitAt and UnitAtSQL answer the company of the period of the
// instant, the first company before the registration, the current one after the last move.
func TestUnitAt(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	registered := now.Add(-10 * 24 * time.Hour)
	vid := e.add(t, vehicle{unit: "msk1", createdAt: registered})
	e.moved(e.as(t, "a.owner", fixtures.TenantA), t, vid, `"1"`, "smr2")
	pool := e.pool(t, fixtures.TenantA)
	for name, c := range map[string]struct {
		at   time.Time
		unit string
	}{
		"до регистрации":       {registered.Add(-time.Hour), "msk1"},
		"в момент регистрации": {registered, "msk1"},
		"перед перемещением":   {now.Add(-time.Microsecond), "msk1"},
		"в момент перемещения": {now, "smr2"},
		"после":                {now.Add(48 * time.Hour), "smr2"},
	} {
		got, err := UnitAt(t.Context(), pool, vid, c.at)
		require.NoError(t, err, name)
		require.Equal(t, id(t, "unit:a."+c.unit), got, name)
		var bySQL uuid.UUID
		require.NoError(t, pool.QueryRow(t.Context(), `select `+UnitAtSQL("$1::uuid", "$2::timestamptz"), vid, c.at).Scan(&bySQL), name)
		require.Equal(t, got, bySQL, name)
	}
	_, err := UnitAt(t.Context(), pool, uuid.New(), now)
	requireProblem(t, err, problem.CodeNotFound)
}
