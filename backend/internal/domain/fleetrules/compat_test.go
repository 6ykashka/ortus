package fleetrules

import (
	"encoding/json"
	"testing"
)

type fleetFixture struct {
	Vehicles map[string]Vehicle `json:"vehicles"`
	Trips    map[string]Trip    `json:"trips"`
}

func loadFleet(t *testing.T) fleetFixture {
	t.Helper()
	var fx fleetFixture
	loadFixture(t, "fleet", &fx)
	if len(fx.Vehicles) == 0 || len(fx.Trips) == 0 {
		t.Fatal("fleet.json: нет машин или рейсов")
	}
	return fx
}

func (fx fleetFixture) vehicle(t *testing.T, id string) Vehicle {
	t.Helper()
	v, ok := fx.Vehicles[id]
	if !ok {
		t.Fatalf("fleet.json: нет машины %s", id)
	}
	return v
}

func (fx fleetFixture) trip(t *testing.T, id string) Trip {
	t.Helper()
	tr, ok := fx.Trips[id]
	if !ok {
		t.Fatalf("fleet.json: нет рейса %s", id)
	}
	return tr
}

func TestTempLabel_Fixture(t *testing.T) {
	t.Parallel()
	var fx struct {
		Cases []struct {
			Name string    `json:"name"`
			Temp TempRange `json:"temp"`
			Want string    `json:"want"`
		} `json:"cases"`
	}
	loadFixture(t, "tempLabel", &fx)
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			if got := TempLabel(c.Temp); got != c.Want {
				t.Errorf("TempLabel(%v) = %q, want %q", c.Temp, got, c.Want)
			}
		})
	}
}

func TestCompat_Fixture(t *testing.T) {
	t.Parallel()
	fleet := loadFleet(t)
	var fx struct {
		Cases []struct {
			Name    string          `json:"name"`
			Vehicle string          `json:"vehicle"`
			Trip    string          `json:"trip"`
			Want    json.RawMessage `json:"want"`
		} `json:"cases"`
	}
	loadFixture(t, "compat", &fx)
	if len(fx.Cases) == 0 {
		t.Fatal("compat.json: нет кейсов")
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			assertJSON(t, Compat(fleet.vehicle(t, c.Vehicle), fleet.trip(t, c.Trip)), c.Want)
		})
	}
}

// Эталон бросает исключение на неизвестном состоянии (VEHICLE_STATE[x].icon); Go не паникует
// и считает машину недоступной (бриф W2.01 §10 п. 3).
func TestCompat_UnknownState(t *testing.T) {
	t.Parallel()
	fleet := loadFleet(t)
	v := fleet.vehicle(t, "v1")
	v.State = "parked"
	got := Compat(v, fleet.trip(t, "Р-208"))
	if got.OK || !got.Fit {
		t.Errorf("Compat(parked) ok=%v fit=%v, want ok=false fit=true", got.OK, got.Fit)
	}
	avail := got.Checks[0]
	if avail.Key != CheckAvail || avail.OK || avail.Value != "parked" || avail.Icon != "" {
		t.Errorf("доступность = %+v", avail)
	}
	if len(got.Reasons) != 1 || got.Reasons[0] != "Доступность: parked" {
		t.Errorf("reasons = %q", got.Reasons)
	}
}

func TestVehicle_JSONRoundTrip(t *testing.T) {
	t.Parallel()
	fleet := loadFleet(t)
	for _, id := range []string{"v1", "v2", "v4", "v1-held-Р-208", "v1-held-null"} {
		v := fleet.vehicle(t, id)
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		var back Vehicle
		if err := json.Unmarshal(b, &back); err != nil {
			t.Fatal(err)
		}
		b2, _ := json.Marshal(back)
		if string(b) != string(b2) {
			t.Errorf("%s: %s != %s", id, b, b2)
		}
	}
}
