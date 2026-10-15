package fleetrules

import (
	"encoding/json"
	"testing"
)

func TestInspMissing_Fixture(t *testing.T) {
	t.Parallel()
	var fx struct {
		Cases []struct {
			Name   string          `json:"name"`
			Draft  InspectionDraft `json:"draft"`
			Kind   InspectionKind  `json:"kind"`
			MinOdo float64         `json:"minOdo"`
			Want   json.RawMessage `json:"want"`
		} `json:"cases"`
	}
	loadFixture(t, "inspMissing", &fx)
	if len(fx.Cases) == 0 {
		t.Fatal("inspMissing.json: нет кейсов")
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			assertJSON(t, InspMissing(c.Draft, c.Kind, c.MinOdo), c.Want)
		})
	}
}

func TestOdoError_Fixture(t *testing.T) {
	t.Parallel()
	var fx struct {
		Cases []struct {
			Name   string  `json:"name"`
			Value  string  `json:"value"`
			MinOdo float64 `json:"minOdo"`
			Want   *string `json:"want"`
		} `json:"cases"`
	}
	loadFixture(t, "odoError", &fx)
	if len(fx.Cases) == 0 {
		t.Fatal("odoError.json: нет кейсов")
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			want := "" // null в фикстуре — ошибки нет
			if c.Want != nil {
				want = *c.Want
			}
			if got := OdoError(c.Value, c.MinOdo); got != want {
				t.Errorf("OdoError(%q, %v) = %q, want %q", c.Value, c.MinOdo, got, want)
			}
		})
	}
}

func TestInspMissing_GoValues(t *testing.T) {
	t.Parallel()
	ready := &Photo{State: PhotoReady}
	d := InspectionDraft{
		Photos: map[string]*Photo{
			"front": ready, "back": ready, "left": ready, "right": ready,
			"odo": {State: PhotoQueued},
		},
		Odometer: Number(84400),
		Fuel:     "h",
		Checks:   map[string]bool{"cargo": true, "personal": true},
	}
	got := InspMissing(d, InspectionReturn, 84370)
	if len(got) != 1 || got[0] != "1 пункт чек-листа" {
		t.Errorf("InspMissing = %q", got)
	}
	d.Odometer = FormValue{}
	if got := InspMissing(d, InspectionDeparture, 84370); len(got) != 2 || got[0] != "пробег" {
		t.Errorf("InspMissing без пробега = %q", got)
	}
}
