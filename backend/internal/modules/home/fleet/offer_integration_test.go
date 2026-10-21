//go:build integration

package fleet_test

import (
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry the source plugs into
	harness "github.com/ortus/ortus-crm/backend/test"          //nolint:depguard // integration test: clock of the suites
)

// S2-20 (W2.72; docs/29 «"Требует решения" у логиста», 1g; контракт DecisionItem.kind 0.6.3-stage2): «водитель ещё не
// выбрал машину» — за 15 минут до срока выбора, пока выбора нет; «нет машины» — одобренный запрос с машиной, рейс без
// машины и без живых броней. The seeds live in Москва-2 of tenant B (the other tests of the package read tenant A and
// Москва-1 of B with exact lists).

// offerVehicle writes a vehicle of unit of tenant b and its resource of the scheduling core.
func offerVehicle(t *testing.T, unit, name string) uuid.UUID {
	t.Helper()
	v := uuid.New()
	exec(t, "b", `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, display_name)
		values ($1, $2, $3, 'van', 1500, 12, 3200, $4)`, v, ref("unit:b."+unit), fmt.Sprintf("В %03d ТД 77", seq.Add(1)), name)
	exec(t, "b", `insert into sched.resources (kind, ref_id, home_unit_id) values ('vehicle', $1, $2)`, v, ref("unit:b."+unit))
	return v
}

// poolTrip plans a trip of Москва-2 of tenant B starting at from with a temporary driver of Москва-1 by an approved
// transfer of mode (nil — a request of 0.6.2 without a vehicle) and returns the trip, its number and the driver.
func poolTrip(t *testing.T, from time.Time, mode any, decision any) (uuid.UUID, string, uuid.UUID) {
	t.Helper()
	now := harness.Now()
	n := seq.Add(1)
	trip, number := uuid.New(), fmt.Sprintf("Р-S220-%d", n)
	driver := uuid.New()
	exec(t, "b", `insert into people.person_profiles (id, full_name, home_unit_id) values ($1, $2, $3)`, driver,
		fmt.Sprintf("Олег Тарасов %d", n), ref("unit:b.msk1"))
	exec(t, "b", `insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned)
		values ($1, $2, $3, 'planned', $4, tstzrange($5, $6))`, trip, number, ref("unit:b.msk2"), driver, from, from.Add(4*time.Hour))
	pub, grant := uuid.New(), uuid.New()
	exec(t, "b", `insert into fleet.pool_publications (id, person_id, home_unit_id, available, published_by, display_name)
		values ($1, $2, $3, tstzrange($4, $5), $2, $6)`, pub, driver, ref("unit:b.msk1"), now.Add(-time.Hour), from.Add(8*time.Hour),
		fmt.Sprintf("Водитель #S220-%d", n))
	exec(t, "b", `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind,
		include_descendants, valid, source, granted_by) values ($1, 'person', $2, $3, 1, 'self', false,
		tstzrange($4, $5, '[)'), 'transfer', $2)`, grant, driver, ref("role:b.driver"), now.Add(-time.Hour), from.Add(4*time.Hour))
	exec(t, "b", `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
		requested_by, decided_by, decided_at, assignment_id, vehicle_mode, host_vehicle_id, home_vehicle_id, vehicle_decision)
		values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'approved', $7, $7, $5, $8, $9::text,
		        case when $9::text in ('host', 'host_or_home') then $10::uuid end,
		        case when $9::text in ('home', 'host_or_home') then $11::uuid end, $12)`,
		pub, ref("unit:b.msk1"), ref("unit:b.msk2"), trip, now.Add(-time.Hour), from.Add(4*time.Hour), driver, grant, mode,
		offerVehicle(t, "msk2", "Ford Transit"), offerVehicle(t, "msk1", "Hyundai HD-35"), decision)
	return trip, number, driver
}

// hold offers vehicle of the trip to driver in group until the deadline (kind host or usual) and returns the
// reservation.
func hold(t *testing.T, trip, vehicle, group, driver uuid.UUID, kind string, from, until time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, "b", `insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at,
		source_type, source_id, created_by, offer_group_id, offered_to, offer_kind, choose_until)
		select $1, r.id, $1, tstzrange($3, $4), tstzrange($3, $4), 'hold', $5, 'fleet.trip', $6, $7, $8, $7, $9, $5
		  from sched.resources r where r.kind = 'vehicle' and r.ref_id = $2`,
		id, vehicle, from, from.Add(4*time.Hour), until, trip, driver, group, kind)
	return id
}

func TestVehicleCards(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	now := harness.Now()

	// Срок выбора через 10 минут — пункт «водитель ещё не выбрал машину».
	from := now.Add(40 * time.Minute)
	pending, pendingNumber, pendingDriver := poolTrip(t, from, "host_or_home", "approved")
	host, usual := offerVehicle(t, "msk2", "Ford Transit"), offerVehicle(t, "msk1", "Hyundai HD-35")
	group := uuid.New()
	deadline := from.Add(-30 * time.Minute)
	hostRes := hold(t, pending, host, group, pendingDriver, "host", from, deadline)
	hold(t, pending, usual, group, pendingDriver, "usual", from, deadline)
	// Срок выбора через 40 минут — пункта ещё нет.
	later, _, laterDriver := poolTrip(t, now.Add(70*time.Minute), "host_or_home", "approved")
	lg := uuid.New()
	hold(t, later, offerVehicle(t, "msk2", "Ford Transit"), lg, laterDriver, "host", now.Add(70*time.Minute), now.Add(40*time.Minute))
	hold(t, later, offerVehicle(t, "msk1", "Hyundai HD-35"), lg, laterDriver, "usual", now.Add(70*time.Minute), now.Add(40*time.Minute))
	// «Только водителя» при своей обычной — рейс без машины.
	start := now.Add(5 * time.Hour)
	bare, bareNumber, _ := poolTrip(t, start, "home", "declined")
	// Запрос 0.6.2 без машины — пункта «нет машины» нет.
	poolTrip(t, now.Add(6*time.Hour), nil, nil)

	got, err := e.src.Cards(t.Context(), home.Query{Tenant: e.tc(t, "b.owner", "b"), ModuleState: "active", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	cards := vehicleCardsOf(got)
	keys := keys(cards)
	want := []string{"fleet.vehicle_choice_pending:" + pending.String(), "fleet.trip_without_vehicle:" + bare.String()}
	if !slices.Equal(keys, want) {
		t.Fatalf("cards\n got %v\nwant %v", keys, want)
	}
	byKey := map[string]homeapi.DecisionItem{}
	for _, c := range cards {
		byKey[c.Key] = c
	}
	wantCard(t, byKey, false, homeapi.DecisionItem{
		Key: want[0], Kind: "fleet.vehicle_choice_pending", ModuleKey: "fleet", Tone: homeapi.Warn,
		Object: &homeapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: pending},
		Params: map[string]string{"tripNumber": pendingNumber, "driverName": byKey[want[0]].Params["driverName"],
			"homeOrgUnitName": "Москва-1", "chooseUntil": deadline.UTC().Format(time.RFC3339),
			"hostVehicle": byKey[want[0]].Params["hostVehicle"], "homeVehicle": byKey[want[0]].Params["homeVehicle"],
			"reservationId": hostRes.String()},
	})
	if p := byKey[want[0]].Params; p["hostVehicle"] == "" || p["homeVehicle"] == "" || p["driverName"] == "" {
		t.Fatalf("names of the pending card: %v", p)
	}
	wantCard(t, byKey, false, homeapi.DecisionItem{
		Key: want[1], Kind: "fleet.trip_without_vehicle", ModuleKey: "fleet", Tone: homeapi.Danger,
		Object: &homeapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: bare},
		Params: map[string]string{"tripNumber": bareNumber, "driverName": byKey[want[1]].Params["driverName"],
			"homeOrgUnitName": "Москва-1", "startsAt": start.UTC().Format(time.RFC3339)},
	})
	// Логист другой фирмы этих пунктов не видит.
	other, err := e.src.Cards(t.Context(), home.Query{Tenant: e.tc(t, "b.manager-msk1", "b"), ModuleState: "active", Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if c := vehicleCardsOf(other); len(c) != 0 {
		t.Fatalf("cards of Москва-2 for the logist of Москва-1: %v", c)
	}
}

// vehicleCardsOf are the cards of S2-20 among items.
func vehicleCardsOf(items []homeapi.DecisionItem) []homeapi.DecisionItem {
	var out []homeapi.DecisionItem
	for _, it := range items {
		if it.Kind == "fleet.vehicle_choice_pending" || it.Kind == "fleet.trip_without_vehicle" {
			out = append(out, it)
		}
	}
	return out
}
