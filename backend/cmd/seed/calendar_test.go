package main

import (
	"slices"
	"testing"
	"time"
)

// The calendar of «Альта» (W4.40) is calendarSeed of the domain W0.12 (extra-data.js 14.10:4–23): eight resources
// and the bookings of the day — the maintenance of ГАЗон, three visits and the break of Анна Морозова. The trip Р-208
// is not a booking of the seed: the driver reserves its vehicle on the stand (W2.02) and the calendar shows that hold.
func TestCalendarSeedOfAlta(t *testing.T) {
	t.Parallel()
	c := calendarSeeds[protoAlta]
	labels := []string{}
	for _, r := range c.resources {
		labels = append(labels, r.label)
	}
	if want := []string{"ГАЗель Next · А 412 МР", "Mercedes Sprinter · Т 771 ЕХ", "ГАЗон Next · Е 905 НА",
		"Илья Васильев · водитель", "Анна Морозова · массажист", "Кабинет № 2", "Кабинет № 3", "Стол с подогревом"}; !slices.Equal(labels, want) {
		t.Fatalf("resources %v, want %v", labels, want)
	}
	want := []calBooking{
		{"b-to", "Плановое ТО", "maintenance", "v4", []string{"res-v4"}, "08:00", "20:00", 0, 0},
		{"b-a1", "Классический массаж · Мария К.", "appointment", "ap-1", []string{"res-am", "res-room2"}, "10:00", "11:00", 0, 15},
		{"b-a2", "SPA-ритуал · Ольга Р.", "appointment", "ap-2", []string{"res-am", "res-room2", "res-table"}, "11:30", "13:00", 15, 15},
		{"b-a3", "Массаж спины · Екатерина Л.", "appointment", "ap-3", []string{"res-am", "res-room2"}, "14:00", "14:45", 0, 15},
		{"b-br", "Перерыв", "break", "", []string{"res-am"}, "13:15", "14:00", 0, 0},
	}
	if len(c.bookings) != len(want) {
		t.Fatalf("bookings %+v", c.bookings)
	}
	for i, b := range c.bookings {
		if !sameBooking(b, want[i]) {
			t.Errorf("booking %d: %+v, want %+v", i, b, want[i])
		}
	}
	units := map[string]string{}
	for _, r := range c.resources {
		units[r.proto] = r.unit
	}
	// Q-W4.06-3: the salon of «Альта» is «Москва» (the org structure has no salon), the fleet — «Север Логистик».
	for proto, unit := range map[string]string{"res-v1": homeAlta, "res-iv": homeAlta, "res-am": regionMsk, "res-table": regionMsk} {
		if units[proto] != unit {
			t.Errorf("%s in %s, want %s", proto, units[proto], unit)
		}
	}
}

func sameBooking(a, b calBooking) bool {
	return a.proto == b.proto && a.title == b.title && a.kind == b.kind && a.source == b.source &&
		slices.Equal(a.resources, b.resources) && a.from == b.from && a.until == b.until && a.prep == b.prep && a.cleanup == b.cleanup
}

// «Лотос» gets the salon only — Анна Морозова, the rooms and the table at «Лотос · Арбат» — and the bookings on them:
// no vehicle, no driver, no trip of «Альта» (PD-27: the leak of the prototype is not repeated).
func TestCalendarSeedOfLotos(t *testing.T) {
	t.Parallel()
	c := calendarSeeds[protoLotos]
	var kinds, protos []string
	for _, r := range c.resources {
		kinds, protos = append(kinds, r.kind), append(protos, r.proto)
		if r.unit != "f-lotos-arb" {
			t.Errorf("%s in %s, want f-lotos-arb", r.proto, r.unit)
		}
	}
	if !slices.Equal(protos, []string{"res-am", "res-room2", "res-room3", "res-table"}) || slices.Contains(kinds, "vehicle") {
		t.Fatalf("resources of «Лотос» %v %v", protos, kinds)
	}
	var bookings []string
	for _, b := range c.bookings {
		bookings = append(bookings, b.proto)
	}
	if !slices.Equal(bookings, []string{"b-a1", "b-a2", "b-a3", "b-br"}) {
		t.Fatalf("bookings of «Лотос» %v", bookings)
	}
}

// Every resource of the seed points at a vehicle of the fleet seed or a member of its tenant, every booking at
// resources of the seed, and a booking stays inside the workday 08:00–20:00 with its buffers.
func TestCalendarSeedRefs(t *testing.T) {
	t.Parallel()
	for _, td := range tenantDBs() {
		c := calendarSeeds[td.tenant.proto]
		res := map[string]bool{}
		for _, r := range c.resources {
			res[r.proto] = true
			switch r.kind {
			case "vehicle":
				if !slices.ContainsFunc(fleetSeeds[td.tenant.proto], func(v vehicleSeed) bool { return v.proto == r.ref }) {
					t.Errorf("%s/%s: no vehicle %s", td.tenant.proto, r.proto, r.ref)
				}
			case "person":
				if _, ok := td.member(r.ref); !ok {
					t.Errorf("%s/%s: no member %s", td.tenant.proto, r.proto, r.ref)
				}
			}
			if !slices.ContainsFunc(td.units, func(u unit) bool { return u.proto == r.unit }) {
				t.Errorf("%s/%s: no unit %s", td.tenant.proto, r.proto, r.unit)
			}
		}
		day := time.Date(2026, 10, 1, 0, 0, 0, 0, msk)
		for _, b := range c.bookings {
			for _, r := range b.resources {
				if !res[r] {
					t.Errorf("%s/%s: no resource %s", td.tenant.proto, b.proto, r)
				}
			}
			from, until := calendarClock(day, b.from), calendarClock(day, b.until)
			if from.Add(-time.Duration(b.prep)*time.Minute).Before(day.Add(8*time.Hour)) ||
				until.Add(time.Duration(b.cleanup)*time.Minute).After(day.Add(20*time.Hour)) {
				t.Errorf("%s/%s: %s–%s out of the workday", td.tenant.proto, b.proto, b.from, b.until)
			}
		}
	}
}

// The bookings take the hours of the prototype on the day of the run of the seed (Moscow).
func TestCalendarClock(t *testing.T) {
	t.Parallel()
	day := calendarDay(time.Date(2026, 10, 18, 23, 40, 0, 0, time.UTC)) // 02:40 of the 19th in Moscow
	if want := time.Date(2026, 10, 19, 0, 0, 0, 0, msk); !day.Equal(want) {
		t.Fatalf("day %s, want %s", day, want)
	}
	if got := calendarClock(day, "11:30"); !got.Equal(time.Date(2026, 10, 19, 11, 30, 0, 0, msk)) {
		t.Fatalf("11:30 → %s", got)
	}
}
