package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"
)

// tripFixture is a trip of testdata/fleet-rules/fleet.json (W2.01: = logistics/seed.ts = mock-data.js 14.10).
type tripFixture struct {
	Unit  string `json:"unit"`
	Title string `json:"title"`
	Cargo struct {
		WeightT  float64   `json:"weightT"`
		VolumeM3 float64   `json:"volumeM3"`
		LengthM  float64   `json:"lengthM"`
		Temp     []float64 `json:"temp"`
		Kind     string    `json:"kind"`
	} `json:"cargo"`
	Stops []struct {
		Time string  `json:"time"`
		Name string  `json:"name"`
		Op   string  `json:"op"`
		W    float64 `json:"w"`
		V    float64 `json:"v"`
	} `json:"stops"`
}

func num(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }

// The trips of «Альта» (W2.05) are the trips of the prototype: Р-208 of Илья Васильев and Р-211 without a driver,
// with their cargo and stops as testdata/fleet-rules/fleet.json, ids of PD-30 (MSW seedUuid of t-alta).
func TestTripSeedsMatchPrototype(t *testing.T) {
	t.Parallel()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "testdata", "fleet-rules", "fleet.json"))
	if err != nil {
		t.Fatal(err)
	}
	var data struct {
		Trips map[string]tripFixture `json:"trips"`
	}
	if err := json.Unmarshal(b, &data); err != nil {
		t.Fatal(err)
	}
	seeds := tripSeeds[protoAlta]
	if len(seeds) != 2 || seeds[0].proto != "Р-208" || seeds[1].proto != "Р-211" || seeds[0].driver != "m-vasiliev" || seeds[1].driver != "" {
		t.Fatalf("trips of «Альта»: %+v", seeds)
	}
	for _, s := range seeds {
		f, ok := data.Trips[s.proto]
		if !ok {
			t.Fatalf("%s: not in fleet.json", s.proto)
		}
		compareTrip(t, s, f)
	}
	if len(tripSeeds) != 1 {
		t.Errorf("tenants with trips: %d, want 1", len(tripSeeds))
	}
}

func compareTrip(t *testing.T, s tripSeed, f tripFixture) {
	t.Helper()
	if s.unit != f.Unit || s.title != f.Title || s.cargo != f.Cargo.Kind || s.weightKg != num(f.Cargo.WeightT*1000) ||
		s.volumeM3 != num(f.Cargo.VolumeM3) || s.lengthMM != int(f.Cargo.LengthM*1000) {
		t.Errorf("%s: %+v, want %+v", s.proto, s, f)
	}
	temp := []string{}
	for _, x := range f.Cargo.Temp {
		temp = append(temp, num(x))
	}
	if got := []string{s.tempMin, s.tempMax}; s.tempMin == "" && len(temp) != 0 || s.tempMin != "" && !slices.Equal(got, temp) {
		t.Errorf("%s: temperature %v, want %v", s.proto, got, temp)
	}
	compareStops(t, s, f)
}

func compareStops(t *testing.T, s tripSeed, f tripFixture) {
	t.Helper()
	if len(s.stops) != len(f.Stops) {
		t.Fatalf("%s: %d stops, want %d", s.proto, len(s.stops), len(f.Stops))
	}
	for i, st := range s.stops {
		w := f.Stops[i]
		want := stopSeed{at: w.Time, address: w.Name, op: w.Op, weightKg: num(w.W * 1000), volumeM3: num(w.V)}
		if st != want {
			t.Errorf("%s stop %d: %+v, want %+v", s.proto, i+1, st, want)
		}
	}
}

// The windows of the trips follow the run of the seed: Р-208 started an hour before the hour of the run and lasts
// four hours as in the prototype (09:00–13:00 at 10:30), Р-211 starts five hours after it; the stops keep their
// offsets, so a reservation of the trip works on the day of the demo.
func TestTripWindows(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 18, 12, 40, 0, 0, msk)
	at := tripClock(now)
	if len(tripSeeds[protoAlta]) != 2 {
		t.Fatalf("trips of «Альта»: %d, want 2", len(tripSeeds[protoAlta]))
	}
	r208, r211 := tripSeeds[protoAlta][0], tripSeeds[protoAlta][1]
	for _, c := range []struct {
		label string
		got   time.Time
		want  time.Time
	}{
		{"Р-208 from", at(r208.from), time.Date(2026, 10, 18, 11, 0, 0, 0, msk)},
		{"Р-208 until", at(r208.until), time.Date(2026, 10, 18, 15, 0, 0, 0, msk)},
		{"Р-208 stop 2", at(r208.stops[1].at), time.Date(2026, 10, 18, 12, 15, 0, 0, msk)},
		{"Р-211 from", at(r211.from), time.Date(2026, 10, 18, 16, 0, 0, 0, msk)},
		{"Р-211 until", at(r211.until), time.Date(2026, 10, 18, 20, 0, 0, 0, msk)},
	} {
		if !c.got.Equal(c.want) {
			t.Errorf("%s = %s, want %s", c.label, c.got.In(msk), c.want)
		}
	}
	// At 01:20 the trip started at 00:00 of the same day.
	if got := tripClock(time.Date(2026, 10, 18, 1, 20, 0, 0, msk))(r208.from); !got.Equal(time.Date(2026, 10, 18, 0, 0, 0, 0, msk)) {
		t.Errorf("Р-208 at night from %s", got.In(msk))
	}
}
