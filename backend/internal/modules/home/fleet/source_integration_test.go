//go:build integration

package fleet_test

import (
	"fmt"
	"maps"
	"reflect"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry the source plugs into
	harness "github.com/ortus/ortus-crm/backend/test"          //nolint:depguard // integration test: clock of the suites
)

var seq atomic.Int64

// trip is a seeded trip of a unit with its vehicle.
type trip struct {
	ID, Vehicle uuid.UUID
	Number      string
}

// seedTrip writes a vehicle of unit and a trip in state; driver uuid.Nil — no driver. A trip that has started gets
// started_at (and returned_at for a handed-in shift).
func seedTrip(t *testing.T, tenant, unit, state string, driver uuid.UUID) trip {
	t.Helper()
	n := seq.Add(1)
	tr := trip{ID: uuid.New(), Vehicle: uuid.New(), Number: fmt.Sprintf("Р-%d", 500+n)}
	now := harness.Now()
	exec(t, tenant, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm, display_name)
	                 values ($1, $2, $3, 'van', 1500, 12, 3200, 'Газель Next')`,
		tr.Vehicle, ref("unit:"+tenant+"."+unit), fmt.Sprintf("Г %03d ЛВ 77", n))
	var drv, started, returned any
	if driver != uuid.Nil {
		drv = driver
	}
	if state == "submitted" {
		started, returned = now.Add(-6*time.Hour), now.Add(-time.Duration(n)*time.Minute)
	}
	exec(t, tenant, `insert into fleet.trips (id, number, unit_id, state, vehicle_id, driver_person_id, planned, title,
	                                         cargo_description, started_at, returned_at)
	                 values ($1, $2, $3, $4, $5, $6, tstzrange($7, $8), 'Склад → магазин', 'Бытовая техника', $9, $10)`,
		tr.ID, tr.Number, ref("unit:"+tenant+"."+unit), state, tr.Vehicle, drv, now.Add(time.Duration(n)*time.Hour),
		now.Add(time.Duration(n+8)*time.Hour), started, returned)
	return tr
}

// defect writes a defect of the vehicle of tr reported on tr (no inspection row: the queue does not read it).
func defect(t *testing.T, tenant string, tr trip, state, severity string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	at := harness.Now().Add(time.Duration(seq.Add(1)) * time.Second) // reported in the order of the seed
	exec(t, tenant, `insert into fleet.defects (id, vehicle_id, trip_id, zone, severity, description, state, created_at)
	                 values ($1, $2, $3, 'Шины и колёса', $4, 'Порез боковины', $5, $6)`,
		id, tr.Vehicle, tr.ID, severity, state, at)
	if state == "resolved" {
		exec(t, tenant, `update fleet.defects set decision = 'allow_departure', resolved_by = $2, resolved_at = $3 where id = $1`,
			id, person("a.manager-msk1", tenant), harness.Now())
	}
	return id
}

// world of TestCards (tenant A unless said): Москва-1 — a blocking defect in review (trip of a.driver-msk1), a
// resolved defect, a shift handed in, a trip without a driver with a pool request from Москва-2, a planned trip
// with a driver; Москва-2 — a blocking defect in review; tenant B Москва-1 — a shift handed in.
type seeded struct {
	defectMsk1, defectMsk2               uuid.UUID
	reviewMsk1, freeMsk1, defectTripMsk1 trip
	reviewB                              trip
}

func seed(t *testing.T) seeded {
	t.Helper()
	var s seeded
	s.defectTripMsk1 = seedTrip(t, "a", "msk1", "defect_review", person("a.driver-msk1", "a"))
	s.defectMsk1 = defect(t, "a", s.defectTripMsk1, "in_review", "blocking")
	done := seedTrip(t, "a", "msk1", "inspection", person("a.driver-msk1", "a"))
	defect(t, "a", done, "resolved", "blocking")
	defect(t, "a", done, "open", "minor")
	s.reviewMsk1 = seedTrip(t, "a", "msk1", "submitted", person("a.driver-msk2", "a"))
	s.freeMsk1 = seedTrip(t, "a", "msk1", "planned", uuid.Nil)
	seedTrip(t, "a", "msk1", "planned", person("a.driver-msk1", "a"))
	pub := uuid.New()
	exec(t, "a", `insert into fleet.pool_publications (id, person_id, home_unit_id, available, published_by)
	              values ($1, $2, $3, tstzrange($4, $5), $2)`, pub, person("a.driver-msk2", "a"), ref("unit:a.msk2"),
		harness.Now(), harness.Now().Add(72*time.Hour))
	exec(t, "a", `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state, requested_by)
	              values ($1, $2, $3, $4, tstzrange($5, $6), 'requested', $7)`, pub, ref("unit:a.msk2"), ref("unit:a.msk1"),
		s.freeMsk1.ID, harness.Now(), harness.Now().Add(8*time.Hour), person("a.manager-msk1", "a"))
	msk2 := seedTrip(t, "a", "msk2", "defect_review", person("a.driver-msk2", "a"))
	s.defectMsk2 = defect(t, "a", msk2, "in_review", "blocking")
	s.reviewB = seedTrip(t, "b", "msk1", "submitted", person("b.driver-msk1", "b"))
	return s
}

func keys(items []homeapi.DecisionItem) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.Key)
	}
	return out
}

// S2-18 п. 2, 3: the kinds, tones and params of the cards; each member sees only the situations of the units of his
// permission (defects — fleet.inspections.review over the unit of the vehicle; shifts — fleet.trips.review and trips
// without a driver — fleet.routes.manage over the unit of the trip). A project role gives nothing (PD-53); a
// driver decides nothing; another tenant is never read (AC-02).
func TestCards(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	s := seed(t)
	bd := func(id uuid.UUID) string { return "fleet.blocking_defect:" + id.String() }
	tr := func(x trip) string { return "fleet.trip_review:" + x.ID.String() }
	wd := func(x trip) string { return "fleet.trip_without_driver:" + x.ID.String() }
	cases := []struct {
		actor, tenant, state string
		want                 []string
	}{
		{"a.manager-msk1", "a", "active", []string{bd(s.defectMsk1), tr(s.reviewMsk1), wd(s.freeMsk1)}},
		{"a.two-roles", "a", "active", []string{bd(s.defectMsk1), tr(s.reviewMsk1), wd(s.freeMsk1)}},
		{"a.manager-msk2", "a", "active", []string{bd(s.defectMsk2)}},
		{"a.region-msk", "a", "active", []string{bd(s.defectMsk1), bd(s.defectMsk2), tr(s.reviewMsk1), wd(s.freeMsk1)}},
		{"a.owner", "a", "active", []string{bd(s.defectMsk1), bd(s.defectMsk2), tr(s.reviewMsk1), wd(s.freeMsk1)}},
		{"a.owner", "a", "read_only", []string{bd(s.defectMsk1), bd(s.defectMsk2), tr(s.reviewMsk1)}},
		{"a.owner", "a", "draining", []string{bd(s.defectMsk1), bd(s.defectMsk2), tr(s.reviewMsk1)}},
		{"a.driver-msk1", "a", "active", []string{}},
		{"a.project-lead", "a", "active", []string{}},
		{"ab.member", "a", "active", []string{}},
		{"b.manager-msk1", "b", "active", []string{tr(s.reviewB)}},
	}
	for _, c := range cases {
		t.Run(c.actor+"/"+c.state+"/"+c.tenant, func(t *testing.T) {
			t.Parallel()
			got, err := e.src.Cards(t.Context(), home.Query{Tenant: e.tc(t, c.actor, c.tenant), ModuleState: c.state, Now: harness.Now()})
			if err != nil {
				t.Fatal(err)
			}
			if k := keys(got); !slices.Equal(k, c.want) {
				t.Fatalf("keys\n got %v\nwant %v", k, c.want)
			}
		})
	}
	t.Run("fields", func(t *testing.T) {
		t.Parallel()
		checkFields(t, e, s)
	})
}

// checkFields: the cards carry the fields the client composes the texts from (MSW W2.00, homeVM of the prototype).
func checkFields(t *testing.T, e env, s seeded) {
	t.Helper()
	got, err := e.src.Cards(t.Context(), home.Query{Tenant: e.tc(t, "a.manager-msk1", "a"), ModuleState: "active", Now: harness.Now()})
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]homeapi.DecisionItem{}
	for _, it := range got {
		byKey[it.Key] = it
	}
	wantCard(t, byKey, true, homeapi.DecisionItem{
		Key: "fleet.blocking_defect:" + s.defectMsk1.String(), Kind: "fleet.blocking_defect", ModuleKey: "fleet",
		Tone: homeapi.Danger, Object: tripObject(s.defectTripMsk1),
		Params: map[string]string{"tripNumber": s.defectTripMsk1.Number, "zone": "Шины и колёса",
			"description": "Порез боковины", "driverName": "Водитель Москва-1"},
	})
	wantCard(t, byKey, true, homeapi.DecisionItem{
		Key: "fleet.trip_review:" + s.reviewMsk1.ID.String(), Kind: "fleet.trip_review", ModuleKey: "fleet",
		Tone: homeapi.Warn, Object: tripObject(s.reviewMsk1),
		Params: map[string]string{"tripNumber": s.reviewMsk1.Number, "driverName": "Водитель Москва-2"},
	})
	free := byKey["fleet.trip_without_driver:"+s.freeMsk1.ID.String()]
	if at, err := time.Parse(time.RFC3339, free.Params["startsAt"]); err != nil || !strings.HasSuffix(free.Params["startsAt"], "Z") || at.IsZero() {
		t.Fatalf("startsAt %q: %v", free.Params["startsAt"], err)
	}
	wantCard(t, byKey, false, homeapi.DecisionItem{
		Key: "fleet.trip_without_driver:" + s.freeMsk1.ID.String(), Kind: "fleet.trip_without_driver", ModuleKey: "fleet",
		Tone: homeapi.Info, Object: tripObject(s.freeMsk1),
		Params: map[string]string{"tripNumber": s.freeMsk1.Number, "title": "Склад → магазин", "cargo": "Бытовая техника",
			"startsAt": free.Params["startsAt"], "poolRequest": "pending", "poolHome": "Москва-2"},
	})
}

func tripObject(x trip) *homeapi.ObjectRef {
	return &homeapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: x.ID}
}

// wantCard compares the card of want.Key with want; occurredAt is checked to be a UTC instant (withAt) or absent.
func wantCard(t *testing.T, byKey map[string]homeapi.DecisionItem, withAt bool, want homeapi.DecisionItem) {
	t.Helper()
	got, ok := byKey[want.Key]
	if !ok {
		t.Fatalf("no card %s in %v", want.Key, slices.Collect(maps.Keys(byKey)))
	}
	if (got.OccurredAt != nil) != withAt || (withAt && got.OccurredAt.Location() != time.UTC) {
		t.Fatalf("%s: occurredAt %v", want.Key, got.OccurredAt)
	}
	got.OccurredAt = nil
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("card\n got %+v\nwant %+v", got, want)
	}
}
