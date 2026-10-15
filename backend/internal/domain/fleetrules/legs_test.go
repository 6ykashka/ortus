package fleetrules

import (
	"encoding/json"
	"math"
	"testing"
)

func TestLegs_Fixture(t *testing.T) {
	t.Parallel()
	fleet := loadFleet(t)
	var fx struct {
		Cases []struct {
			Name    string          `json:"name"`
			Trip    string          `json:"trip"`
			Vehicle *string         `json:"vehicle"`
			Want    json.RawMessage `json:"want"`
		} `json:"cases"`
	}
	loadFixture(t, "legs", &fx)
	if len(fx.Cases) == 0 {
		t.Fatal("legs.json: нет кейсов")
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			t.Parallel()
			var v *Vehicle
			if c.Vehicle != nil {
				veh := fleet.vehicle(t, *c.Vehicle)
				v = &veh
			}
			assertJSON(t, Legs(fleet.trip(t, c.Trip), v), c.Want)
		})
	}
}

func TestJSRound(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   float64
		want float64
	}{
		{name: "половина вверх", in: 2.5, want: 3},
		{name: "отрицательная половина к +∞", in: -2.5, want: -2},
		{name: "чуть меньше половины", in: 0.49999999999999994, want: 0},
		{name: "12,5", in: 12.5, want: 13},
		{name: "целое", in: 73, want: 73},
		{name: "большое", in: 4503599627370497, want: 4503599627370497},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := jsRound(tt.in); got != tt.want {
				t.Errorf("jsRound(%v) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
	t.Run("NaN", func(t *testing.T) {
		t.Parallel()
		if got := jsRound(math.NaN()); !math.IsNaN(got) {
			t.Errorf("jsRound(NaN) = %v", got)
		}
	})
}
