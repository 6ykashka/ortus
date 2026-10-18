package main

import (
	"slices"
	"testing"
	"time"
)

// Q-W2.02-5 (W2.54): the base seed of the stand switches «Логистика» on in «Альта» — the module of the demo of W2.90
// (the stored key of MSW INSTALLABLE.fleet), so that the drivers of «Альта» see their trips of today without the
// owner switching it on; «Лотос» stays without it.
func TestStandSwitchesLogisticsOnInAlta(t *testing.T) {
	t.Parallel()
	if got := standModules[protoAlta]; !slices.Equal(got, []string{demoModule}) {
		t.Errorf("modules of the stand in «Альта» = %v, want [%s]", got, demoModule)
	}
	if got := standModules[protoLotos]; len(got) != 0 {
		t.Errorf("modules of the stand in «Лотос» = %v, want none", got)
	}
}

// The subscriptions of the operator registry live on the day of the run of the seed as the prototype lives on
// 01.10.2026: the trial of «Альта» ends 12 days after the day of the run (MSW: 13.10), every date of the seed moves by
// the same number of days; a run on 01.10.2026 keeps the dates of the prototype.
func TestSubscriptionsFollowTheRun(t *testing.T) {
	t.Parallel()
	for _, now := range []time.Time{
		time.Date(2026, 10, 18, 0, 1, 0, 0, msk),
		time.Date(2026, 10, 18, 13, 0, 0, 0, msk),
		time.Date(2026, 10, 18, 23, 59, 0, 0, msk),
	} {
		got := byTenant(subscriptionsAt(now))
		alta := got[protoAlta]
		if want := time.Date(2026, 10, 30, 21, 0, 0, 0, time.UTC); alta.end == nil || !alta.end.Equal(want) {
			t.Errorf("%v: trial of «Альта» ends %v, want %v", now, alta.end, want)
		}
		if left := int(alta.end.Sub(now) / (24 * time.Hour)); left != 12 {
			t.Errorf("%v: %d days of trial left, want 12", now, left)
		}
		if want := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC); !alta.from.Equal(want) {
			t.Errorf("%v: trial of «Альта» from %v, want %v", now, alta.from, want)
		}
		if lotos := got[protoLotos]; !lotos.end.Equal(time.Date(2027, 4, 17, 21, 0, 0, 0, time.UTC)) {
			t.Errorf("%v: «Лотос» paid till %v, want 17.04.2027 (31.03.2027 + 17 days)", now, lotos.end)
		}
		if rem := got[protoRemstroy]; rem.end != nil || !rem.from.Equal(time.Date(2026, 10, 7, 21, 0, 0, 0, time.UTC)) {
			t.Errorf("%v: «Ремстрой» ended %v…%v, want from 07.10.2026 21:00Z without an end", now, rem.from, rem.end)
		}
	}
	// The defs of the prototype are not changed by a shift.
	if !subscriptionDefs[0].end.Equal(*mskEndOfDay("13.10.2026")) {
		t.Errorf("prototype trial of «Альта» moved to %v", subscriptionDefs[0].end)
	}
}

// A run on the day of the prototype keeps its dates.
func TestSubscriptionsOnThePrototypeDay(t *testing.T) {
	t.Parallel()
	got := byTenant(subscriptionsAt(time.Date(2026, 10, 1, 10, 30, 0, 0, msk)))
	for _, d := range subscriptionDefs {
		s := got[d.tenant]
		if !equalTime(s.from, d.from) || !equalTime(s.end, d.end) {
			t.Errorf("%s on 01.10.2026: %v…%v, want %v…%v", d.tenant, s.from, s.end, d.from, d.end)
		}
	}
}

func byTenant(defs []subscriptionDef) map[string]subscriptionDef {
	out := map[string]subscriptionDef{}
	for _, d := range defs {
		out[d.tenant] = d
	}
	return out
}

func equalTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Equal(*b)
}
