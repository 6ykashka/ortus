//go:build integration

package routes

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// S2-20 (W2.72; контракт assignTripVehicle 0.6.3-stage2, правила 8–9, Q-W2.70-1, Q-W2.70-6): вторая машина на выбор
// своему водителю, машина рейса временного водителя пула — сразу confirmed, смена машины логистом снимает прежнюю
// бронь с причиной manager.

func (e env) assignBoth(ctx context.Context, trip, vehicle, alt uuid.UUID, ifMatch string) (fleetapi.AssignTripVehicleResponseObject, error) {
	tc, _ := tenantctx.FromContext(ctx)
	return e.srv.AssignTripVehicle(ctx, fleetapi.AssignTripVehicleRequestObject{
		TenantId: tc.TenantID, TripId: trip, Params: fleetapi.AssignTripVehicleParams{IfMatch: ifMatch},
		Body: &fleetapi.TripVehicleAssignment{VehicleId: vehicle, AlternativeVehicleId: &alt},
	})
}

// offerRow is a reservation of the vehicle of a trip.
type offerRow struct {
	bundle             uuid.UUID
	state              string
	group, to          *uuid.UUID
	kind, reason       *string
	until, expires, at *time.Time
}

func (e env) offers(t *testing.T, trip uuid.UUID) map[uuid.UUID]offerRow {
	t.Helper()
	rows, err := e.pool(t).Query(t.Context(), `select s.ref_id, r.bundle_id, r.state, r.offer_group_id, r.offered_to,
		r.offer_kind, r.release_reason, r.choose_until, r.hold_expires_at, r.released_at
		  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
		 where r.source_type = 'fleet.trip' and r.source_id = $1`, trip)
	require.NoError(t, err)
	defer rows.Close()
	out := map[uuid.UUID]offerRow{}
	for rows.Next() {
		var (
			v uuid.UUID
			r offerRow
		)
		require.NoError(t, rows.Scan(&v, &r.bundle, &r.state, &r.group, &r.to, &r.kind, &r.reason, &r.until, &r.expires, &r.at))
		out[v] = r
	}
	require.NoError(t, rows.Err())
	return out
}

// Правило 9, Q-W2.70-6: логист предлагает своему водителю две машины — одна группа, hold до срока выбора, рейс без
// машины до выбора; без водителя и та же машина — 422 alternativeVehicleId; новое назначение снимает предложение.
func TestAssignAlternativeVehicle(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	driver := e.driver(t, "msk1")
	from, until := day(42, 6), day(42, 12)
	p := e.planned(ctx, t, plan(t, "msk1", from, until, &driver))
	host, alt := e.fits(t), e.fits(t)

	solo := e.planned(ctx, t, plan(t, "msk1", from, until, nil))
	resp, err := e.assignBoth(ctx, solo.Id, host, alt, `"1"`)
	requireViolation(t, resp, err, "alternativeVehicleId", "driver")
	resp, err = e.assignBoth(ctx, p.Id, host, host, `"1"`)
	requireViolation(t, resp, err, "alternativeVehicleId", "same")

	resp, err = e.assignBoth(ctx, p.Id, host, alt, `"1"`)
	require.NoError(t, err)
	got, ok := resp.(fleetapi.AssignTripVehicle200JSONResponse)
	require.True(t, ok, "%T", resp)
	assert.Equal(t, fleetapi.TripState("planned"), got.Body.State)
	assert.Nil(t, got.Body.VehicleId)
	deadline := from.Add(-30 * time.Minute)
	offers := e.offers(t, p.Id)
	require.Len(t, offers, 2)
	for v, kind := range map[uuid.UUID]string{host: "host", alt: "usual"} {
		r := offers[v]
		assert.Equal(t, "hold", r.state, kind)
		require.NotNil(t, r.group, kind)
		assert.Equal(t, *offers[host].group, *r.group, kind)
		assert.Equal(t, &driver, r.to, kind)
		assert.Equal(t, kind, *r.kind)
		assert.True(t, r.until != nil && r.until.Equal(deadline), kind)
		assert.True(t, r.expires != nil && r.expires.Equal(deadline), kind)
	}

	third := e.fits(t)
	e.assigned(ctx, t, p.Id, third, `"2"`)
	after := e.offers(t, p.Id)
	for _, v := range []uuid.UUID{host, alt} {
		assert.Equal(t, "released", after[v].state)
		require.NotNil(t, after[v].reason)
		assert.Equal(t, "manager", *after[v].reason)
	}
	assert.Equal(t, "hold", after[third].state)
}

// requireViolation requires the 422 of assignTripVehicle that names field with code.
func requireViolation(t *testing.T, resp fleetapi.AssignTripVehicleResponseObject, err error, field, code string) {
	t.Helper()
	require.NoError(t, err)
	res, ok := resp.(fleetapi.AssignTripVehicle422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "%T, want the 422 with its violation", resp)
	require.NotNil(t, res.Body.Violations)
	require.Len(t, *res.Body.Violations, 1)
	assert.Equal(t, field, (*res.Body.Violations)[0].Field)
	assert.Equal(t, code, (*res.Body.Violations)[0].Code)
}

// Q-W2.70-1, правило 8: машина рейса временного водителя пула — бронь сразу confirmed на окно рейса, предложенная ему;
// смена машины логистом — прежняя бронь снята (manager), новая confirmed.
func TestAssignTemporaryDriver(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1")
	driver := e.driver(t, "msk2")
	from, until := day(43, 6), day(43, 12)
	p := e.planned(ctx, t, plan(t, "msk1", from, until, nil))
	var pub, grant uuid.UUID
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into fleet.pool_publications (person_id, home_unit_id,
		available, published_by, display_name) values ($1, $2, tstzrange($3, $4), $1, $5) returning id`,
		driver, id(t, "unit:a.msk2"), from.Add(-time.Hour), until.Add(time.Hour), "Водитель #R-"+uuid.NewString()[:6]).Scan(&pub))
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `insert into access.role_assignments (principal_kind, principal_id,
		role_id, role_version, scope_kind, include_descendants, valid, source, granted_by)
		values ('person', $1, $2, 1, 'self', false, tstzrange($3, $4, '[)'), 'transfer', $1) returning id`,
		driver, id(t, "role:a.driver"), from, until).Scan(&grant))
	e.exec(t, `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
		requested_by, decided_by, decided_at, assignment_id) values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'approved',
		$7, $7, $5, $8)`, pub, id(t, "unit:a.msk2"), id(t, "unit:a.msk1"), p.Id, from, until, driver, grant)
	e.exec(t, `update fleet.trips set driver_person_id = $2 where id = $1`, p.Id, driver)

	first := e.fits(t)
	got := e.assigned(ctx, t, p.Id, first, `"1"`).Body
	assert.Equal(t, fleetapi.TripState("assigned"), got.State)
	r := e.offers(t, p.Id)[first]
	assert.Equal(t, "confirmed", r.state)
	require.NotNil(t, r.group)
	assert.Equal(t, &driver, r.to)
	assert.Nil(t, r.until)
	assert.True(t, r.expires != nil && r.expires.Equal(until))

	second := e.fits(t)
	e.assigned(ctx, t, p.Id, second, `"2"`)
	after := e.offers(t, p.Id)
	assert.Equal(t, "released", after[first].state)
	require.NotNil(t, after[first].reason)
	assert.Equal(t, "manager", *after[first].reason)
	assert.NotNil(t, after[first].at)
	assert.Equal(t, "confirmed", after[second].state)
}
