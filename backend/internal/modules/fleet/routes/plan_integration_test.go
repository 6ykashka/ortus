//go:build integration

package routes

import (
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suite
)

var numberRE = regexp.MustCompile(`^Р-(\d+)$`)

func numberOf(t *testing.T, p fleetapi.TripPlan) int {
	t.Helper()
	m := numberRE.FindStringSubmatch(p.Number)
	require.NotNil(t, m, "number %q", p.Number)
	n, err := strconv.Atoi(m[1])
	require.NoError(t, err)
	return n
}

func TestCreateTripPlan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	driver := id(t, "person:a.driver-msk1@a")
	from, until := day(19, 6), day(19, 12)
	resp, err := e.create(ctx, plan(t, "msk1", from, until, &driver))
	require.NoError(t, err)
	created, ok := resp.(fleetapi.CreateTripPlan201JSONResponse)
	require.True(t, ok, "%T", resp)
	p := created.Body
	require.NotNil(t, created.Headers.ETag)
	assert.Equal(t, `"1"`, *created.Headers.ETag)
	assert.Equal(t, "private, no-store", *created.Headers.CacheControl)

	assert.Equal(t, fleetapi.TripState("planned"), p.State)
	assert.Equal(t, "Склад Север → ТЦ", p.Title)
	assert.Equal(t, id(t, "unit:a.msk1"), p.OrgUnitId)
	assert.Equal(t, fleetapi.TimeWindow{StartsAt: from, EndsAt: until, TimeZone: "Europe/Moscow"}, p.PlannedWindow)
	assert.Equal(t, fleetapi.TripCargo{Description: "Сухой груз · 14 паллет-мест", WeightKg: "1100", VolumeM3: "12", LengthM: "3"}, p.Cargo)
	require.Len(t, p.Stops, 3)
	assert.Equal(t, fleetapi.TripStop{Sequence: 1, Op: fleetapi.Load, Address: "Склад Север", WeightKg: "1100", VolumeM3: "12", PlannedAt: &from}, p.Stops[0])
	assert.Equal(t, fleetapi.TripStop{Sequence: 2, Op: fleetapi.Unload, Address: "ТЦ Восток", WeightKg: "600", VolumeM3: "7.5"}, p.Stops[1])
	require.NotNil(t, p.DriverMemberId)
	assert.Equal(t, driver, *p.DriverMemberId)
	var name string
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select full_name from people.person_profiles where id = $1`, driver).Scan(&name))
	require.NotNil(t, p.DriverDisplayName)
	assert.Equal(t, name, *p.DriverDisplayName)
	assert.Nil(t, p.VehicleId)
	assert.Nil(t, p.ReservationId)
	assert.Nil(t, p.HoldExpiresAt)
	assert.Nil(t, p.LastReview)
	assert.Equal(t, int64(1), p.Revision)
	numberOf(t, p)

	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and state = 'planned' and number = $2
		and cargo_weight_kg = 1100 and cargo_volume_m3 = 12 and cargo_length_mm = 3000 and driver_person_id = $3`, p.Id, p.Number, driver))
	assert.Equal(t, 3, e.count(t, `select count(*) from fleet.trip_stops where trip_id = $1`, p.Id))
	assert.Equal(t, 1, e.count(t, `select count(*) from audit.events where action = 'fleet.trip.plan' and target_id = $1
		and unit_id = $2`, p.Id, id(t, "unit:a.msk1")))
	assert.Equal(t, 1, e.count(t, `select count(*) from outbox.events where type = 'fleet.trip.planned.v1' and aggregate_id = $1`, p.Id))

	// The next trip takes the next number; a trip without a driver has none.
	next := e.planned(ctx, t, plan(t, "msk1", from, until, nil))
	assert.Greater(t, numberOf(t, next), numberOf(t, p), "the counter goes up (other tests plan in parallel)")
	assert.Nil(t, next.DriverMemberId)
	assert.Nil(t, next.DriverDisplayName)
}

// TestCreateTripPlanNumberAfterExisting: the counter never hands out the number of a trip written without it (the seed,
// an import).
func TestCreateTripPlanNumberAfterExisting(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	e.exec(t, `insert into fleet.trips (number, unit_id, state, planned) values ('Р-9000', $1, 'planned', tstzrange($2, $3))`,
		id(t, "unit:a.msk1"), day(20, 6), day(20, 8))
	p := e.planned(e.as(t, "a.owner"), t, plan(t, "msk1", day(20, 6), day(20, 12), nil))
	assert.Greater(t, numberOf(t, p), 9000)
}

func TestCreateTripPlanTemperatureAndDistance(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	b := plan(t, "msk1", day(21, 6), day(21, 12), nil)
	lo, hi, dist := "-18", "-2.5", "84.25"
	b.Cargo.TemperatureMinC, b.Cargo.TemperatureMaxC, b.DistanceKm = &lo, &hi, &dist
	contact := "Ирина"
	b.Stops[1].Contact = &contact
	p := e.planned(e.as(t, "a.manager-msk1"), t, b)
	require.NotNil(t, p.Cargo.TemperatureMinC)
	assert.Equal(t, "-18", *p.Cargo.TemperatureMinC)
	assert.Equal(t, "-2.5", *p.Cargo.TemperatureMaxC)
	require.NotNil(t, p.DistanceKm)
	assert.Equal(t, "84.3", *p.DistanceKm, "numeric(8,1)")
	require.NotNil(t, p.Stops[1].Contact)
	assert.Equal(t, "Ирина", *p.Stops[1].Contact)
}

// TestCreateTripPlanLegalEntity: the legal entity of the trip is the one of its company by default (answer of the
// product owner 17.10): the nearest unit up the tree with a legal entity.
func TestCreateTripPlanLegalEntity(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var le uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into org.legal_entities (name) values ('ООО «Самара Логистик»')
		returning id`).Scan(&le))
	e.exec(t, `insert into org.unit_legal_entities (unit_id, legal_entity_id) values ($1, $2)`, id(t, "unit:a.smr"), le)
	p := e.planned(e.as(t, "a.owner"), t, plan(t, "smr2", day(22, 6), day(22, 12), nil))
	require.NotNil(t, p.LegalEntityId)
	assert.Equal(t, le, *p.LegalEntityId)
	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where id = $1 and legal_entity_id = $2`, p.Id, le))

	other := e.planned(e.as(t, "a.owner"), t, plan(t, "msk2", day(22, 6), day(22, 12), nil))
	assert.Nil(t, other.LegalEntityId, "no legal entity up the tree of Москва-2")
}

func TestCreateTripPlanRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	manager := e.as(t, "a.manager-msk1")
	at := func(n int) (time.Time, time.Time) { return day(23, 6+n), day(23, 7+n) }
	ptr := func(v uuid.UUID) *uuid.UUID { return &v }

	from, until := at(0)
	_, err := e.create(e.as(t, "a.manager-msk2"), plan(t, "msk1", from, until, nil))
	requireProblem(t, err, "validation_failed", textUnit) // the unit of the neighbouring firm is invisible (AC-01)

	b := plan(t, "msk1", from, until, nil)
	b.OrgUnitId = uuid.New()
	_, err = e.create(manager, b)
	requireProblem(t, err, "validation_failed", textUnit)

	_, err = e.create(e.as(t, "a.two-roles"), plan(t, "smr2", from, until, nil))
	requireProblem(t, err, problem.CodeForbiddenAction) // Самара-2 is visible to the observer, no fleet.routes.manage

	// A driver sees no unit (no org_units.read): the module answers like for a missing unit; the gateway refuses it first
	// (fleet_routes_gate.yaml: no fleet.routes.manage).
	_, err = e.create(e.as(t, "a.driver-msk1"), plan(t, "msk1", from, until, nil))
	requireProblem(t, err, "validation_failed", textUnit)

	for name, driver := range map[string]uuid.UUID{
		"a person of tenant B":                     id(t, "person:b.driver-msk1@b"),
		"a driver outside the area (Москва-2)":     id(t, "person:a.driver-msk2@a"),
		"a member without the function «Водитель»": id(t, "person:a.manager-msk1@a"),
		"nobody": uuid.New(),
		"a driver whose function starts after start": e.lateDriver(t),
	} {
		_, err = e.create(manager, plan(t, "msk1", from, until, ptr(driver)))
		requireProblem(t, err, "validation_failed", textDriver)
		_ = name
	}

	_, err = e.create(manager, &fleetapi.TripPlanCreate{OrgUnitId: id(t, "unit:a.msk1"), Title: " ",
		PlannedWindow: fleetapi.TimeWindow{StartsAt: from, EndsAt: until, TimeZone: "Europe/Moscow"}})
	requireProblem(t, err, "validation_failed", textTitle)

	assert.Equal(t, 0, e.count(t, `select count(*) from fleet.trips where planned && tstzrange($1, $2)`, day(23, 0), day(24, 0)))
}

// lateDriver is a driver of Москва-1 whose function «Водитель» starts after the windows of TestCreateTripPlanRefusals.
func (e env) lateDriver(t *testing.T) uuid.UUID {
	t.Helper()
	var pid uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into people.person_profiles (full_name, home_unit_id)
		values ('Водитель с понедельника', $1) returning id`, id(t, "unit:a.msk1")).Scan(&pid))
	e.exec(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		pid, id(t, "unit:a.msk1"), day(24, 0))
	return pid
}

// TestCreateTripPlanDriverBusy: a driver in an overlapping trip that is neither accepted nor cancelled is 409
// resources_unavailable; windows are half-open.
func TestCreateTripPlanDriverBusy(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	driver := e.driver(t, "msk1")
	e.planned(ctx, t, plan(t, "msk1", day(25, 6), day(25, 10), &driver))

	_, err := e.create(ctx, plan(t, "msk1", day(25, 9), day(25, 12), &driver))
	requireProblem(t, err, codeUnavailable, textDriverBusy)

	e.planned(ctx, t, plan(t, "msk1", day(25, 10), day(25, 12), &driver)) // right after the first trip

	e.exec(t, `update fleet.trips set state = 'cancelled' where driver_person_id = $1`, driver)
	e.planned(ctx, t, plan(t, "msk1", day(25, 7), day(25, 11), &driver)) // the cancelled trips free the driver
}

// TestCreateTripPlanParallelForOneDriver: concurrent plans of one driver for one window give one trip.
func TestCreateTripPlanParallelForOneDriver(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	driver := e.driver(t, "msk1")
	const n = 8
	errs := make(chan error, n)
	b := plan(t, "msk1", day(26, 6), day(26, 12), &driver)
	for range n {
		go func() {
			_, err := e.create(ctx, b)
			errs <- err
		}()
	}
	created := 0
	for range n {
		if err := <-errs; err == nil {
			created++
		} else {
			requireProblem(t, err, codeUnavailable)
		}
	}
	assert.Equal(t, 1, created)
	assert.Equal(t, 1, e.count(t, `select count(*) from fleet.trips where driver_person_id = $1`, driver))
}

func TestGetTripPlan(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	driver := id(t, "person:a.driver-msk1@a")
	p := e.planned(e.as(t, "a.manager-msk1"), t, plan(t, "msk1", day(27, 6), day(27, 12), &driver))

	for _, actor := range []string{"a.manager-msk1", "a.region-msk", "a.owner", "a.driver-msk1"} {
		resp, err := e.get(e.as(t, actor), p.Id)
		require.NoError(t, err, actor)
		got, ok := resp.(fleetapi.GetTripPlan200JSONResponse)
		require.True(t, ok, "%s: %T", actor, resp)
		assert.Equal(t, p, got.Body, actor)
		assert.Equal(t, `"1"`, *got.Headers.ETag, actor)
	}
	for _, actor := range []string{"a.manager-msk2", "a.driver-msk2"} {
		_, err := e.get(e.as(t, actor), p.Id)
		requireProblem(t, err, problem.CodeNotFound, textTripNotFound) // the neighbouring firm; another driver (D22)
	}
	_, err := e.get(e.as(t, "a.owner"), uuid.New())
	requireProblem(t, err, problem.CodeNotFound, textTripNotFound)
}

// TestGetTripPlanProjection: the hold, the inspections, the blocking defect in review and the latest review of a trip.
func TestGetTripPlanProjection(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner")
	driver := e.driver(t, "msk1")
	vid := e.vehicle(t, "msk1", "1500", "16", 4200)

	blocked := e.planned(ctx, t, plan(t, "msk1", day(28, 6), day(28, 12), &driver))
	var checklist, insp, defect uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.checklist_versions (kind, version, items)
		values ('departure', 9028, '[]') returning id`).Scan(&checklist))
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.inspections (trip_id, vehicle_id, kind,
		checklist_version_id, odometer_km, fuel_level, answers, state, submitted_by)
		values ($1, $2, 'departure', $3, 1000, 'full', '{}', 'blocked', $4) returning id`,
		blocked.Id, vid, checklist, driver).Scan(&insp))
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.defects (vehicle_id, inspection_id, zone, severity,
		description, state) values ($1, $2, 'Кузов', 'blocking', 'Трещина', 'in_review') returning id`, vid, insp).Scan(&defect))
	e.exec(t, `update fleet.trips set state = 'defect_review', vehicle_id = $2, departure_inspection_id = $3,
		revision = revision + 1 where id = $1`, blocked.Id, vid, insp)

	resp, err := e.get(ctx, blocked.Id)
	require.NoError(t, err)
	got := gotPlan(t, resp)
	assert.Equal(t, fleetapi.TripState("defect_review"), got.State)
	assert.Equal(t, &vid, got.VehicleId)
	assert.Equal(t, &insp, got.DepartureInspectionId)
	assert.Equal(t, &defect, got.BlockingDefectId)
	assert.Equal(t, int64(2), got.Revision)

	rework := e.planned(ctx, t, plan(t, "msk1", day(29, 6), day(29, 12), &driver))
	started, returned := harness.Now().Add(-3*time.Hour), harness.Now().Add(-time.Hour)
	e.exec(t, `update fleet.trips set state = 'rework', vehicle_id = $2, started_at = $3, returned_at = $4,
		route_completed_at = $4 where id = $1`, rework.Id, e.vehicle(t, "msk1", "1500", "16", 4200), started, returned)
	reviewed := harness.Now().Add(-30 * time.Minute)
	e.exec(t, `insert into fleet.trip_reviews (trip_id, attempt, decision, steps, reviewed_by, reviewed_at)
		values ($1, 1, 'approve', '{}', $2, $3)`, rework.Id, driver, reviewed.Add(-time.Hour))
	e.exec(t, `insert into fleet.trip_reviews (trip_id, attempt, decision, comment, steps, reviewed_by, reviewed_at)
		values ($1, 2, 'rework', 'Нет фото кузова', '{photos,odometer}', $2, $3)`, rework.Id, driver, reviewed)
	resp, err = e.get(ctx, rework.Id)
	require.NoError(t, err)
	got = gotPlan(t, resp)
	require.NotNil(t, got.LastReview)
	comment := "Нет фото кузова"
	assert.Equal(t, fleetapi.TripReviewSummary{Attempt: 2, Decision: "rework", Comment: &comment,
		Steps: &[]fleetapi.ReworkStep{"photos", "odometer"}, ReviewerMemberId: driver, ReviewedAt: reviewed.UTC()}, *got.LastReview)
	assert.Equal(t, started.UTC(), *got.StartedAt)
	assert.Equal(t, returned.UTC(), *got.ReturnedAt)
	assert.Equal(t, returned.UTC(), *got.RouteCompletedAt)
	assert.Nil(t, got.AcceptedAt)
	assert.Nil(t, got.BlockingDefectId)
}

func TestListTripPlans(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	manager2 := e.as(t, "a.manager-msk2")
	driver := e.driver(t, "msk2") // the trips of this test only
	var ids []uuid.UUID
	for _, d := range []int{33, 31, 32} {
		ids = append(ids, e.planned(manager2, t, plan(t, "msk2", day(d, 6), day(d, 12), &driver)).Id)
	}
	want := []uuid.UUID{ids[1], ids[2], ids[0]} // by the start of the window
	unit := id(t, "unit:a.msk2")
	limit := 2
	resp, err := e.list(manager2, fleetapi.ListTripPlansParams{OrgUnitId: &unit, DriverMemberId: &driver, Limit: &limit})
	require.NoError(t, err)
	page := gotPage(t, resp)
	require.Len(t, page.Items, 2)
	got := []uuid.UUID{page.Items[0].Id, page.Items[1].Id}
	assert.Equal(t, want[:2], got)
	require.NotNil(t, page.NextCursor)
	resp, err = e.list(manager2, fleetapi.ListTripPlansParams{OrgUnitId: &unit, DriverMemberId: &driver, Limit: &limit,
		Cursor: page.NextCursor})
	require.NoError(t, err)
	page = gotPage(t, resp)
	require.Len(t, page.Items, 1)
	assert.Equal(t, want[2], page.Items[0].Id)
	assert.Nil(t, page.NextCursor)

	states := []fleetapi.TripState{"assigned"}
	resp, err = e.list(manager2, fleetapi.ListTripPlansParams{OrgUnitId: &unit, State: &states})
	require.NoError(t, err)
	for _, it := range gotPage(t, resp).Items {
		assert.NotContains(t, ids, it.Id, "the state filter")
	}

	// The manager of Москва-1 does not see the trips of Москва-2.
	resp, err = e.list(e.as(t, "a.manager-msk1"), fleetapi.ListTripPlansParams{Limit: new(200)})
	require.NoError(t, err)
	for _, it := range gotPage(t, resp).Items {
		assert.NotEqual(t, unit, it.OrgUnitId)
	}

	// A driver sees the trips it drives only, even with fleet.trips.read over Москва-1 (a.driver-msk2, D22).
	own := id(t, "person:a.driver-msk2@a")
	mine := e.planned(e.as(t, "a.owner"), t, plan(t, "msk1", day(34, 6), day(34, 12), &own))
	e.planned(e.as(t, "a.owner"), t, plan(t, "msk1", day(34, 6), day(34, 12), nil))
	resp, err = e.list(e.as(t, "a.driver-msk2"), fleetapi.ListTripPlansParams{Limit: new(200)})
	require.NoError(t, err)
	items := gotPage(t, resp).Items
	require.Len(t, items, 1)
	assert.Equal(t, mine.Id, items[0].Id)

	resp, err = e.list(e.as(t, "a.owner"), fleetapi.ListTripPlansParams{DriverMemberId: &own, Limit: new(200)})
	require.NoError(t, err)
	items = gotPage(t, resp).Items
	require.Len(t, items, 1)
	assert.Equal(t, mine.Id, items[0].Id)

	bad := "not-a-cursor"
	_, err = e.list(manager2, fleetapi.ListTripPlansParams{Cursor: &bad})
	requireProblem(t, err, problem.CodeMalformedRequest)
	_, err = e.list(manager2, fleetapi.ListTripPlansParams{State: &[]fleetapi.TripState{"lost"}})
	requireProblem(t, err, problem.CodeMalformedRequest)
}

func gotPlan(t *testing.T, resp fleetapi.GetTripPlanResponseObject) fleetapi.TripPlan {
	t.Helper()
	ok, isOK := resp.(fleetapi.GetTripPlan200JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok.Body
}

func gotPage(t *testing.T, resp fleetapi.ListTripPlansResponseObject) fleetapi.TripPlanPage {
	t.Helper()
	ok, isOK := resp.(fleetapi.ListTripPlans200JSONResponse)
	require.True(t, isOK, "%T", resp)
	return ok.Body
}
