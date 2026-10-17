//go:build integration

package vehicles

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/sched" //nolint:depguard // integration test: holds of the vehicles through the scheduling core
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suite
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// list pages through listVehicles of ctx with params and returns the vehicles in the order of the pages.
func (e env) list(ctx context.Context, t *testing.T, p fleetapi.ListVehiclesParams) []fleetapi.Vehicle {
	t.Helper()
	var out []fleetapi.Vehicle
	for page := 0; ; page++ {
		require.Less(t, page, 100, "too many pages")
		resp, err := e.srv.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{TenantId: tenantOf(ctx, t), Params: p})
		require.NoError(t, err)
		ok, isOK := resp.(fleetapi.ListVehicles200JSONResponse)
		require.True(t, isOK, "%T", resp)
		require.Equal(t, "private, no-store", *ok.Headers.CacheControl)
		out = append(out, ok.Body.Items...)
		if ok.Body.NextCursor == nil {
			return out
		}
		p.Cursor = ok.Body.NextCursor
	}
}

func tenantOf(ctx context.Context, t *testing.T) uuid.UUID {
	t.Helper()
	tc, ok := tenantContext(ctx)
	require.True(t, ok)
	return tc
}

func ids(vs []fleetapi.Vehicle) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(vs))
	for _, v := range vs {
		out = append(out, v.Id)
	}
	return out
}

func find(t *testing.T, vs []fleetapi.Vehicle, vid uuid.UUID) fleetapi.Vehicle {
	t.Helper()
	i := slices.IndexFunc(vs, func(v fleetapi.Vehicle) bool { return v.Id == vid })
	require.GreaterOrEqual(t, i, 0, "vehicle %s is not in the list", vid)
	return vs[i]
}

func TestListVehiclesByScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	m1, m2, s2 := e.add(t, vehicle{unit: "msk1"}), e.add(t, vehicle{unit: "msk2"}), e.add(t, vehicle{unit: "smr2"})
	for _, c := range []struct {
		actor, tenant string
		see, hidden   []uuid.UUID
	}{
		{"a.manager-msk1", fixtures.TenantA, []uuid.UUID{m1}, []uuid.UUID{m2, s2}},
		{"a.two-roles", fixtures.TenantA, []uuid.UUID{m1, s2}, []uuid.UUID{m2}},
		{"a.region-msk", fixtures.TenantA, []uuid.UUID{m1, m2}, []uuid.UUID{s2}},
		{"a.driver-msk2", fixtures.TenantA, []uuid.UUID{m1}, []uuid.UUID{m2, s2}}, // temporary assignment on Москва-1
		{"a.owner", fixtures.TenantA, []uuid.UUID{m1, m2, s2}, nil},
		{"b.owner", fixtures.TenantB, nil, []uuid.UUID{m1, m2, s2}},
	} {
		got := ids(e.list(e.as(t, c.actor, c.tenant), t, fleetapi.ListVehiclesParams{}))
		for _, v := range c.see {
			require.Contains(t, got, v, c.actor)
		}
		for _, v := range c.hidden {
			require.NotContains(t, got, v, c.actor)
		}
	}
}

func TestListVehiclesNarrowsByUnitOnly(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	m1, m2, s2 := e.add(t, vehicle{unit: "msk1"}), e.add(t, vehicle{unit: "msk2"}), e.add(t, vehicle{unit: "smr2"})
	msk, smr2 := id(t, "unit:a.msk"), id(t, "unit:a.smr2")
	got := ids(e.list(e.as(t, "a.owner", fixtures.TenantA), t, fleetapi.ListVehiclesParams{OrgUnitId: &msk}))
	require.Contains(t, got, m1)
	require.Contains(t, got, m2)
	require.NotContains(t, got, s2)
	got = ids(e.list(e.as(t, "a.manager-msk1", fixtures.TenantA), t, fleetapi.ListVehiclesParams{OrgUnitId: &smr2}))
	require.NotContains(t, got, s2, "orgUnitId never widens the scope")
}

func TestListVehiclesFilters(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	cold := e.add(t, vehicle{unit: "spb3", body: "reefer", payload: "1200", volume: "11", lengthMM: 3400, tempMin: new("-18"), tempMax: new("8")})
	big := e.add(t, vehicle{unit: "spb3", payload: "4500", volume: "30", lengthMM: 5100})
	small := e.add(t, vehicle{unit: "spb3", payload: "900", volume: "9", lengthMM: 3100})
	ctx, unit := e.as(t, "a.owner", fixtures.TenantA), id(t, "unit:a.spb3")
	body := fleetapi.ListVehiclesParamsBodyTypeRefrigerated
	require.Equal(t, []uuid.UUID{cold}, ids(e.list(ctx, t, fleetapi.ListVehiclesParams{OrgUnitId: &unit, BodyType: &body})))
	got := ids(e.list(ctx, t, fleetapi.ListVehiclesParams{OrgUnitId: &unit, MinPayloadKg: new("1200")}))
	require.ElementsMatch(t, []uuid.UUID{cold, big}, got)
	require.NotContains(t, got, small)
}

func TestListVehiclesPages(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	var want []uuid.UUID
	for i := range 5 {
		want = append(want, e.add(t, vehicle{unit: "spb2", createdAt: harness.Now().Add(time.Duration(i) * time.Minute)}))
	}
	unit, limit := id(t, "unit:a.spb2"), 2
	ctx := e.as(t, "a.owner", fixtures.TenantA)
	var pages [][]uuid.UUID
	p := fleetapi.ListVehiclesParams{OrgUnitId: &unit, Limit: &limit}
	for {
		resp, err := e.srv.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{TenantId: id(t, "tenant:a"), Params: p})
		require.NoError(t, err)
		ok := resp.(fleetapi.ListVehicles200JSONResponse) //nolint:forcetypeassert // the test fails on a panic anyway
		pages = append(pages, ids(ok.Body.Items))
		if ok.Body.NextCursor == nil {
			break
		}
		p.Cursor = ok.Body.NextCursor
	}
	require.Equal(t, [][]uuid.UUID{want[:2], want[2:4], want[4:]}, pages, "registration order, keyset pages")
}

func TestVehicleDTO(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	vid := e.add(t, vehicle{unit: "spb4", body: "reefer", payload: "1200.0", volume: "11.00", lengthMM: 3400,
		tempMin: new("-18.0"), tempMax: new("8"), depot: "Склад № 1"})
	unit := id(t, "unit:a.spb4")
	v := find(t, e.list(e.as(t, "a.owner", fixtures.TenantA), t, fleetapi.ListVehiclesParams{OrgUnitId: &unit}), vid)
	require.Equal(t, fleetapi.VehicleBodyTypeRefrigerated, v.BodyType)
	require.Equal(t, fleetapi.VehicleCapacity{PayloadKg: "1200", VolumeM3: "11", CargoLengthM: "3.4", CargoWidthM: "2", CargoHeightM: "2"}, v.Capacity)
	require.Equal(t, "-18", *v.TemperatureMinC)
	require.Equal(t, "8", *v.TemperatureMaxC)
	require.Equal(t, []fleetapi.VehicleEquipment{fleetapi.VehicleEquipmentRefrigerator}, v.Equipment)
	require.Equal(t, "84370", v.OdometerKm)
	require.Equal(t, "Склад № 1", *v.Depot)
	require.Equal(t, fleetapi.VehicleStatusAvailable, v.Status)
	require.Nil(t, v.StatusNote)
	require.Nil(t, v.HeldByTripId)
	require.Equal(t, int64(1), v.Revision)
	require.Equal(t, unit, v.OrgUnitId)
}

// at is an instant of 2 October 2026 (UTC), hh:00 — the day after the clock of the suite.
func at(hh int) time.Time { return time.Date(2026, 10, 2, hh, 0, 0, 0, time.UTC) }

// hold holds vehicle vid for [from, until) as the scheduling core does; the hold ends at expires (now: the clock of
// the hold).
func (e env) hold(t *testing.T, vid uuid.UUID, from, until, now, expires time.Time, trip *uuid.UUID) {
	t.Helper()
	ctx := t.Context()
	tx, err := e.pool(t, fixtures.TenantA).Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	b := uuid.New()
	src, srcID := "fleet.reservation", b
	if trip != nil {
		src, srcID = "fleet.trip", *trip
	}
	require.NoError(t, sched.Hold(ctx, tx, sched.HoldRequest{
		Bundle: b, Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: vid, Home: id(t, "unit:a.msk3")}},
		Window: sched.Window{Start: from, End: until}, ExpiresAt: expires, SourceType: src, SourceID: srcID,
		CreatedBy: uuid.New(), Now: now,
	}))
	require.NoError(t, tx.Commit(ctx))
}

// trip registers a trip of Москва-3 in state with vehicle vid and returns its id.
func (e env) trip(t *testing.T, vid uuid.UUID, state string) uuid.UUID {
	t.Helper()
	var tid uuid.UUID
	started := (*time.Time)(nil)
	if state == TripOnRoute {
		s := harness.Now().Add(-time.Hour)
		started = &s
	}
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `insert into fleet.trips
		(number, unit_id, state, vehicle_id, planned, started_at)
		values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), $7) returning id`,
		"Р-"+uuid.NewString()[:8], id(t, "unit:a.msk3"), state, vid, at(6), at(10), started).Scan(&tid))
	return tid
}

func TestListVehiclesStatus(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	free := e.add(t, vehicle{unit: "msk3"})
	service := e.add(t, vehicle{unit: "msk3", service: ServiceMaintenance, note: "Плановое ТО до 03.10"})
	held := e.add(t, vehicle{unit: "msk3"})
	e.hold(t, held, at(10), at(14), now, now.Add(30*time.Minute), nil)
	ended := e.add(t, vehicle{unit: "msk3"})
	e.hold(t, ended, at(10), at(14), now.Add(-2*time.Hour), now.Add(-time.Hour), nil)
	onRoute := e.add(t, vehicle{unit: "msk3"})
	e.trip(t, onRoute, TripOnRoute)
	assigned := e.add(t, vehicle{unit: "msk3"})
	tripOf := e.trip(t, assigned, TripAssigned)
	heldForTrip := e.add(t, vehicle{unit: "msk3"})
	plan := uuid.New()
	e.hold(t, heldForTrip, at(10), at(14), now, now.Add(30*time.Minute), &plan)
	defect := e.add(t, vehicle{unit: "msk3"})
	_, err := e.pool(t, fixtures.TenantA).Exec(t.Context(), `insert into fleet.defects (vehicle_id, zone, severity, description, state)
		values ($1, 'Стёкла', 'blocking', 'Скол', 'in_review')`, defect)
	require.NoError(t, err)

	unit := id(t, "unit:a.msk3")
	got := e.list(e.as(t, "a.manager-msk1", fixtures.TenantA), t, fleetapi.ListVehiclesParams{})
	require.NotContains(t, ids(got), free, "Москва-3 is outside the scope of Москва-1")
	got = e.list(e.as(t, "a.region-msk", fixtures.TenantA), t, fleetapi.ListVehiclesParams{OrgUnitId: &unit})
	for _, c := range []struct {
		name   string
		vid    uuid.UUID
		status fleetapi.VehicleStatus
		note   string
		held   *uuid.UUID
	}{
		{"свободна", free, fleetapi.VehicleStatusAvailable, "", nil},
		{"ТО", service, fleetapi.VehicleStatusMaintenance, "Плановое ТО до 03.10", nil},
		{"бронь", held, fleetapi.VehicleStatusReserved, "", nil},
		{"истёкшая бронь", ended, fleetapi.VehicleStatusAvailable, "", nil},
		{"на маршруте", onRoute, fleetapi.VehicleStatusInUse, "", nil},
		{"назначена", assigned, fleetapi.VehicleStatusReserved, "", &tripOf},
		{"бронь за рейсом", heldForTrip, fleetapi.VehicleStatusReserved, "", &plan},
		{"критический дефект", defect, fleetapi.VehicleStatusMaintenance, NoteDefectInReview, nil},
	} {
		v := find(t, got, c.vid)
		require.Equal(t, c.status, v.Status, c.name)
		if c.note == "" {
			require.Nil(t, v.StatusNote, c.name)
		} else {
			require.Equal(t, c.note, *v.StatusNote, c.name)
		}
		require.Equal(t, c.held, v.HeldByTripId, c.name)
	}
}

func TestListVehiclesFreeInInterval(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()
	free := e.add(t, vehicle{unit: "msk4"})
	held := e.add(t, vehicle{unit: "msk4"})
	e.hold(t, held, at(10), at(14), now, now.Add(30*time.Minute), nil)
	ended := e.add(t, vehicle{unit: "msk4"})
	e.hold(t, ended, at(10), at(14), now.Add(-2*time.Hour), now.Add(-time.Hour), nil)
	service := e.add(t, vehicle{unit: "msk4", service: ServiceMaintenance})
	onRoute := e.add(t, vehicle{unit: "msk4"})
	e.trip(t, onRoute, TripOnRoute)
	unit := id(t, "unit:a.msk4")
	ctx := e.as(t, "a.owner", fixtures.TenantA)
	free12 := func(from, until time.Time) []uuid.UUID {
		return ids(e.list(ctx, t, fleetapi.ListVehiclesParams{OrgUnitId: &unit, AvailableFrom: &from, AvailableUntil: &until}))
	}
	require.ElementsMatch(t, []uuid.UUID{free, ended}, free12(at(12), at(13)))
	require.ElementsMatch(t, []uuid.UUID{free, held, ended}, free12(at(14), at(15)), "the hold ends at 14:00")
	require.ElementsMatch(t, []uuid.UUID{free, held, ended}, free12(at(9), at(10)))
	require.NotContains(t, free12(at(9), at(10)), service)
	all := ids(e.list(ctx, t, fleetapi.ListVehiclesParams{OrgUnitId: &unit}))
	require.ElementsMatch(t, []uuid.UUID{free, held, ended, service, onRoute}, all, "without an interval — every vehicle")
}

func TestListVehiclesRejectsParameters(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner", fixtures.TenantA)
	from, zero, boat := at(10), 0, fleetapi.ListVehiclesParamsBodyType("boat")
	bad := "eyJ4Ijox" // base64 of a JSON object, not of a list of keys
	for name, c := range map[string]struct {
		p    fleetapi.ListVehiclesParams
		code string
	}{
		"одна граница":      {fleetapi.ListVehiclesParams{AvailableFrom: &from}, "validation_failed"},
		"пустой интервал":   {fleetapi.ListVehiclesParams{AvailableFrom: &from, AvailableUntil: &from}, "validation_failed"},
		"запятая в массе":   {fleetapi.ListVehiclesParams{MinPayloadKg: new("1,5")}, problem.CodeMalformedRequest},
		"неизвестный кузов": {fleetapi.ListVehiclesParams{BodyType: &boat}, problem.CodeMalformedRequest},
		"лимит 0":           {fleetapi.ListVehiclesParams{Limit: &zero}, problem.CodeMalformedRequest},
		"чужой курсор":      {fleetapi.ListVehiclesParams{Cursor: &bad}, problem.CodeMalformedRequest},
	} {
		_, err := e.srv.ListVehicles(ctx, fleetapi.ListVehiclesRequestObject{TenantId: id(t, "tenant:a"), Params: c.p})
		require.True(t, problem.Is(err, c.code), "%s: %v", name, err)
	}
}

func createBody(unit uuid.UUID, plate string) *fleetapi.VehicleCreate {
	return &fleetapi.VehicleCreate{
		OrgUnitId: unit, RegistrationNumber: plate, DisplayName: "ГАЗель Next", BodyType: fleetapi.VehicleCreateBodyTypeTent,
		Capacity:  fleetapi.VehicleCapacity{PayloadKg: "1500", VolumeM3: "16", CargoLengthM: "4.2", CargoWidthM: "2", CargoHeightM: "2.1"},
		Equipment: []fleetapi.VehicleCreateEquipment{}, OdometerKm: "84370", Depot: new("Склад № 1"),
	}
}

func (e env) create(ctx context.Context, b *fleetapi.VehicleCreate) (fleetapi.CreateVehicleResponseObject, error) {
	tc, _ := tenantContext(ctx)
	return e.srv.CreateVehicle(ctx, fleetapi.CreateVehicleRequestObject{TenantId: tc, Body: b})
}

func TestCreateVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx, msk1 := e.as(t, "a.manager-msk1", fixtures.TenantA), id(t, "unit:a.msk1")
	plate := "AB " + uuid.NewString()[:6]
	resp, err := e.create(ctx, createBody(msk1, " "+plate+" "))
	require.NoError(t, err)
	created, ok := resp.(fleetapi.CreateVehicle201JSONResponse)
	require.True(t, ok, "%T", resp)
	v := created.Body
	require.Equal(t, `"1"`, *created.Headers.ETag)
	require.False(t, *created.Headers.IdempotencyReplayed)
	require.Equal(t, plate, v.RegistrationNumber)
	require.Equal(t, "ГАЗель Next", v.DisplayName)
	require.Equal(t, fleetapi.VehicleBodyTypeTent, v.BodyType)
	require.Equal(t, fleetapi.VehicleCapacity{PayloadKg: "1500", VolumeM3: "16", CargoLengthM: "4.2", CargoWidthM: "2", CargoHeightM: "2.1"}, v.Capacity)
	require.Equal(t, fleetapi.VehicleStatusAvailable, v.Status)
	require.Empty(t, v.Equipment)
	require.Equal(t, msk1, v.OrgUnitId)

	pool := e.pool(t, fixtures.TenantA)
	var lengthMM, heightMM, audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select cargo_length_mm, cargo_height_mm from fleet.vehicles where id = $1`, v.Id).
		Scan(&lengthMM, &heightMM))
	require.Equal(t, []int{4200, 2100}, []int{lengthMM, heightMM})
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit.events
		where action = 'fleet.vehicle.create' and target_type = 'fleet.vehicle' and target_id = $1 and unit_id = $2`, v.Id, msk1).Scan(&audits))
	require.Equal(t, 1, audits)

	listed := find(t, e.list(ctx, t, fleetapi.ListVehiclesParams{}), v.Id)
	require.Equal(t, v, listed, "createVehicle answers what listVehicles reads")

	_, err = e.create(ctx, createBody(msk1, "ab "+plate[3:]))
	require.True(t, problem.Is(err, "validation_failed"), "a plate of the fleet in another case: %v", err)
}

func TestCreateRefrigeratedVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	b := createBody(id(t, "unit:a.msk1"), "RF "+uuid.NewString()[:6])
	b.BodyType, b.TemperatureMinC, b.TemperatureMaxC = fleetapi.VehicleCreateBodyTypeRefrigerated, new("-18"), new("8")
	b.Equipment = []fleetapi.VehicleCreateEquipment{fleetapi.VehicleCreateEquipmentRefrigerator}
	resp, err := e.create(e.as(t, "a.owner", fixtures.TenantA), b)
	require.NoError(t, err)
	v := resp.(fleetapi.CreateVehicle201JSONResponse).Body //nolint:forcetypeassert // the test fails on a panic anyway
	require.Equal(t, fleetapi.VehicleBodyTypeRefrigerated, v.BodyType)
	require.Equal(t, []fleetapi.VehicleEquipment{fleetapi.VehicleEquipmentRefrigerator}, v.Equipment)
	var body string
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(), `select body_type from fleet.vehicles where id = $1`, v.Id).Scan(&body))
	require.Equal(t, "reefer", body)
}

func TestCreateVehicleRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	msk1, msk2, smr2 := id(t, "unit:a.msk1"), id(t, "unit:a.msk2"), id(t, "unit:a.smr2")
	plate := func() string { return "RX " + uuid.NewString()[:6] }
	rounded := createBody(msk1, plate())
	rounded.Capacity.PayloadKg = "0.04" // numeric(10,1): zero after rounding
	huge := createBody(msk1, plate())
	huge.Capacity.VolumeM3 = "99999999"
	for name, c := range map[string]struct {
		actor string
		body  *fleetapi.VehicleCreate
		code  string
	}{
		"наблюдатель Самары-2":      {"a.two-roles", createBody(smr2, plate()), problem.CodeForbiddenAction},
		"соседняя фирма":            {"a.manager-msk1", createBody(msk2, plate()), "validation_failed"},
		"неизвестное подразделение": {"a.owner", createBody(uuid.New(), plate()), "validation_failed"},
		"ноль после округления":     {"a.owner", rounded, "validation_failed"},
		"слишком большой объём":     {"a.owner", huge, "validation_failed"},
		"без тела":                  {"a.owner", nil, problem.CodeMalformedRequest},
	} {
		_, err := e.create(e.as(t, c.actor, fixtures.TenantA), c.body)
		require.True(t, problem.Is(err, c.code), "%s: %v", name, err)
	}
	var n int
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(),
		`select count(*) from fleet.vehicles where plate like 'RX %'`).Scan(&n))
	require.Zero(t, n, "a refused command writes nothing")
}

// Get reads by id in the transaction of a command, without a scope: the caller authorizes.
func TestGet(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	vid := e.add(t, vehicle{unit: "smr2", depot: "Самара · склад"})
	pool := e.pool(t, fixtures.TenantA)
	r, err := Get(t.Context(), pool, vid, harness.Now())
	require.NoError(t, err)
	require.Equal(t, id(t, "unit:a.smr2"), r.Unit)
	require.Equal(t, "Europe/Samara", r.TimeZone)
	require.True(t, r.Available())
	rules := r.Rules()
	require.InDelta(t, 1.5, rules.PayloadT, 1e-9)
	require.InDelta(t, 3.2, rules.LengthM, 1e-9)
	require.Equal(t, "Самара · склад", rules.Depot)
	_, err = Get(t.Context(), pool, uuid.New(), harness.Now())
	require.True(t, problem.Is(err, problem.CodeNotFound), "%v", err)
}
