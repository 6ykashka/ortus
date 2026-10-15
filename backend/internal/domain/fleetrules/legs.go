package fleetrules

import "math"

// Leg — остановка рейса с загрузкой машины после неё: масса и объём отдельно, проценты от
// грузоподъёмности и объёма кузова (nil без машины).
type Leg struct {
	Stop
	WAfter float64  `json:"wAfter"`
	VAfter float64  `json:"vAfter"`
	WPct   *float64 `json:"wPct"`
	VPct   *float64 `json:"vPct"`
}

// Legs считает загрузку после каждой остановки (legs эталона): погрузка прибавляет, выгрузка
// вычитает, не ниже нуля, с округлением до 0,01; проценты — только с машиной v.
func Legs(trip Trip, v *Vehicle) []Leg {
	out := make([]Leg, 0, len(trip.Stops))
	var w, vol float64
	for _, s := range trip.Stops {
		sign := -1.0
		if s.Op == StopLoad {
			sign = 1
		}
		w = round2(w + sign*s.W)
		vol = round2(vol + sign*s.V)
		leg := Leg{Stop: s, WAfter: w, VAfter: vol}
		if v != nil {
			wp := jsRound(w / v.PayloadT * 100)
			vp := jsRound(vol / v.VolumeM3 * 100)
			leg.WPct, leg.VPct = &wp, &vp
		}
		out = append(out, leg)
	}
	return out
}

// round2 — Math.max(0, Math.round(x * 100) / 100).
func round2(x float64) float64 {
	return math.Max(0, jsRound(x*100)/100)
}

// jsRound — Math.round: к ближайшему целому, половина — в сторону +∞.
func jsRound(x float64) float64 {
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}
