package main

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// fleetFixture is a vehicle of testdata/fleet-rules/fleet.json (W2.01: the seed of «Альта» = logistics/seed.ts =
// mock-data.js 14.10).
type fleetFixture struct {
	Unit     string     `json:"unit"`
	Model    string     `json:"model"`
	Plate    string     `json:"plate"`
	Body     string     `json:"body"`
	PayloadT float64    `json:"payloadT"`
	VolumeM3 float64    `json:"volumeM3"`
	LengthM  float64    `json:"lengthM"`
	Temp     *[]float64 `json:"temp"`
	Odometer float64    `json:"odometer"`
	State    string     `json:"state"`
	Note     string     `json:"note"`
	Depot    string     `json:"depot"`
}

// The vehicles of the Go seed of «Альта» are the seven vehicles of the prototype, in its order (S2-01), with the
// units, bodies and measures of the shared fixtures of W2.01.
func TestFleetSeedMatchesPrototype(t *testing.T) {
	t.Parallel()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "fleet-rules", "fleet.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Vehicles map[string]fleetFixture `json:"vehicles"`
	}
	if err := json.Unmarshal(b, &fx); err != nil {
		t.Fatal(err)
	}
	seeds := fleetSeeds[protoAlta]
	want := []string{"v1", "v6", "v2", "v3", "v4", "v5", "v7"} // mock-data.js:189–228
	if len(seeds) != len(want) {
		t.Fatalf("seed vehicles: %d, want %d", len(seeds), len(want))
	}
	for i, s := range seeds {
		f, ok := fx.Vehicles[s.proto]
		switch {
		case s.proto != want[i]:
			t.Errorf("vehicle %d: %s, want %s", i, s.proto, want[i])
		case !ok:
			t.Errorf("%s: not in fleet.json", s.proto)
		default:
			compareVehicle(t, s, f)
		}
	}
	if len(fleetSeeds) != 1 {
		t.Errorf("tenants with a fleet: %d, want 1 (only «Альта» has vehicles in the prototype)", len(fleetSeeds))
	}
}

// compareVehicle compares a vehicle of the seed with its vehicle of the fixtures.
func compareVehicle(t *testing.T, s vehicleSeed, f fleetFixture) {
	t.Helper()
	labels := map[string]string{"tent": "Тент", "van": "Фургон", "reefer": "Рефрижератор"}
	temp := "…"
	if f.Temp != nil {
		temp = fmtNum((*f.Temp)[0]) + "…" + fmtNum((*f.Temp)[1])
	}
	service := "ok"
	if f.State == "unavailable" {
		service = "maintenance"
	}
	for what, c := range map[string][2]string{
		"unit":        {s.unit, f.Unit},
		"model":       {s.model, f.Model},
		"plate":       {s.plate, f.Plate},
		"body":        {labels[s.body], f.Body},
		"payload":     {s.payloadKg, fmtNum(f.PayloadT * 1000)},
		"volume":      {s.volumeM3, fmtNum(f.VolumeM3)},
		"length":      {strconv.Itoa(s.lengthMM), fmtNum(f.LengthM * 1000)},
		"odometer":    {s.odometerKm, fmtNum(f.Odometer)},
		"depot":       {s.depot, f.Depot},
		"note":        {s.note, f.Note},
		"temperature": {s.tempMin + "…" + s.tempMax, temp},
		"service":     {s.service, service}, // state unavailable of the prototype — maintenance
	} {
		if c[0] != c[1] {
			t.Errorf("%s %s: %q, want %q", s.proto, what, c[0], c[1])
		}
	}
}

// fmtNum prints a whole or decimal number without a trailing zero (as trim_scale in PostgreSQL).
func fmtNum(f float64) string {
	return strconv.FormatFloat(math.Round(f*1e6)/1e6, 'f', -1, 64)
}
