package routes

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// planBody is the Р-208 of the prototype: dry cargo 1,1 т · 12 м³ · 3 м, loaded at the depot and unloaded at two
// shops.
func planBody() *fleetapi.TripPlanCreate {
	start := time.Date(2026, 10, 20, 6, 0, 0, 0, time.UTC)
	at := start.Add(time.Hour)
	contact := "Ирина, +7 900 000-00-00"
	return &fleetapi.TripPlanCreate{
		OrgUnitId: uuid.New(), Title: "  Р-208 · Склад Север → ТЦ  ",
		PlannedWindow: fleetapi.TimeWindow{StartsAt: start, EndsAt: start.Add(6 * time.Hour), TimeZone: "Europe/Moscow"},
		Cargo:         fleetapi.TripCargo{Description: "Сухой груз · 14 паллет-мест", WeightKg: "1100", VolumeM3: "12", LengthM: "3"},
		Stops: []fleetapi.TripStop{
			{Sequence: 1, Op: "load", Address: "Склад Север", WeightKg: "1100", VolumeM3: "12", PlannedAt: &start},
			{Sequence: 2, Op: "unload", Address: "ТЦ Восток", WeightKg: "600", VolumeM3: "7.5", PlannedAt: &at, Contact: &contact},
			{Sequence: 3, Op: "unload", Address: "ТЦ Запад", WeightKg: "500", VolumeM3: "4.5"},
		},
	}
}

func TestCheckCreate(t *testing.T) {
	t.Parallel()
	b := planBody()
	dist := "84.25"
	b.DistanceKm = &dist
	lo, hi := "-18", "-2.25"
	b.Cargo.TemperatureMinC, b.Cargo.TemperatureMaxC = &lo, &hi
	in, err := checkCreate(b)
	require.NoError(t, err)
	assert.Equal(t, "Р-208 · Склад Север → ТЦ", in.title, "the title is trimmed")
	assert.Equal(t, b.OrgUnitId, in.unit)
	assert.Equal(t, "Europe/Moscow", in.zone)
	assert.Equal(t, b.PlannedWindow.StartsAt, in.window.Start)
	assert.Equal(t, int64(11000), in.cargo.weight, "0,1 kg")
	assert.Equal(t, int64(1200), in.cargo.volume, "0,01 m³")
	assert.Equal(t, int64(3000), in.cargo.lengthMM)
	require.NotNil(t, in.cargo.tempMin)
	assert.Equal(t, int64(-180), *in.cargo.tempMin, "0,1 °C")
	assert.Equal(t, int64(-23), *in.cargo.tempMax, "-2,25 °C rounds half away from zero to -2,3 (numeric(4,1))")
	require.NotNil(t, in.distance)
	assert.Equal(t, int64(843), *in.distance, "84,25 km rounds to 84,3 (numeric(8,1))")
	require.Len(t, in.stops, 3)
	assert.Equal(t, stopInput{seq: 2, op: "unload", address: "ТЦ Восток", at: b.Stops[1].PlannedAt, weight: 6000, volume: 750,
		contact: b.Stops[1].Contact}, in.stops[1])
	assert.Nil(t, in.driver)
}

func TestCheckCreateLegs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		stops [][3]string // op, kg, m³
		want  string
	}{
		{"unload of the whole load", [][3]string{{"load", "1100", "12"}, {"unload", "1100", "12"}}, ""},
		{"two loads, then two unloads", [][3]string{{"load", "300", "2.5"}, {"load", "200", "1.25"}, {"unload", "250", "2"}, {"unload", "250", "1.75"}}, ""},
		{"mass below zero", [][3]string{{"load", "500", "4"}, {"unload", "500.1", "4"}}, "Точка 2: выгрузка больше, чем в кузове после предыдущей точки (масса)."},
		{"volume below zero", [][3]string{{"load", "500", "4"}, {"unload", "100", "1"}, {"unload", "100", "3.01"}}, "Точка 3: выгрузка больше, чем в кузове после предыдущей точки (объём)."},
		{"unload first", [][3]string{{"unload", "1", "0"}}, "Точка 1: выгрузка больше, чем в кузове после предыдущей точки (масса)."},
		{"exact decimals, no float drift", [][3]string{{"load", "0.3", "0.1"}, {"load", "0.3", "0.2"}, {"unload", "0.6", "0.3"}}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			b := planBody()
			b.Stops = nil
			for i, s := range tc.stops {
				b.Stops = append(b.Stops, fleetapi.TripStop{Sequence: int64(i + 1), Op: fleetapi.TripStopOp(s[0]), Address: "Точка",
					WeightKg: s[1], VolumeM3: s[2]})
			}
			_, err := checkCreate(b)
			if tc.want == "" {
				require.NoError(t, err)
				return
			}
			requireInvalid(t, err, tc.want)
		})
	}
}

func TestCheckCreateRefusals(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("я", 201)
	cases := []struct {
		name string
		edit func(b *fleetapi.TripPlanCreate)
		want string
	}{
		{"empty title", func(b *fleetapi.TripPlanCreate) { b.Title = "   " }, textTitle},
		{"long title", func(b *fleetapi.TripPlanCreate) { b.Title = long }, textTitle},
		{"window backwards", func(b *fleetapi.TripPlanCreate) { b.PlannedWindow.EndsAt = b.PlannedWindow.StartsAt }, textWindow},
		{"unknown zone", func(b *fleetapi.TripPlanCreate) { b.PlannedWindow.TimeZone = "Mars/Olympus" }, textTimeZone},
		{"local zone", func(b *fleetapi.TripPlanCreate) { b.PlannedWindow.TimeZone = "Local" }, textTimeZone},
		{"no cargo description", func(b *fleetapi.TripPlanCreate) { b.Cargo.Description = " " }, textCargo},
		{"mass not a quantity", func(b *fleetapi.TripPlanCreate) { b.Cargo.WeightKg = "-1" }, textCargoWeight},
		{"mass too large", func(b *fleetapi.TripPlanCreate) { b.Cargo.WeightKg = "1000000000" }, textCargoWeight},
		{"volume not a quantity", func(b *fleetapi.TripPlanCreate) { b.Cargo.VolumeM3 = "1,5" }, textCargoVolume},
		{"length not a quantity", func(b *fleetapi.TripPlanCreate) { b.Cargo.LengthM = "" }, textCargoLength},
		{"one temperature bound", func(b *fleetapi.TripPlanCreate) { v := "2"; b.Cargo.TemperatureMinC = &v }, textTempBoth},
		{"temperature backwards", func(b *fleetapi.TripPlanCreate) {
			lo, hi := "8", "2"
			b.Cargo.TemperatureMinC, b.Cargo.TemperatureMaxC = &lo, &hi
		}, textTempOrder},
		{"temperature not a decimal", func(b *fleetapi.TripPlanCreate) {
			lo, hi := "x", "2"
			b.Cargo.TemperatureMinC, b.Cargo.TemperatureMaxC = &lo, &hi
		}, textTempValue},
		{"distance not a quantity", func(b *fleetapi.TripPlanCreate) { v := "1e3"; b.DistanceKm = &v }, textDistance},
		{"no stops", func(b *fleetapi.TripPlanCreate) { b.Stops = nil }, textNoStops},
		{"too many stops", func(b *fleetapi.TripPlanCreate) {
			b.Stops = make([]fleetapi.TripStop, 101)
			for i := range b.Stops {
				b.Stops[i] = fleetapi.TripStop{Sequence: int64(i + 1), Op: "load", Address: "Склад", WeightKg: "1", VolumeM3: "1"}
			}
		}, textTooManyStops},
		{"sequence gap", func(b *fleetapi.TripPlanCreate) { b.Stops[1].Sequence = 3 }, textStopOrder},
		{"unknown op", func(b *fleetapi.TripPlanCreate) { b.Stops[0].Op = "pickup" }, "Точка 1: укажите погрузку или выгрузку."},
		{"empty address", func(b *fleetapi.TripPlanCreate) { b.Stops[2].Address = " " }, "Точка 3: укажите адрес."},
		{"stop mass", func(b *fleetapi.TripPlanCreate) { b.Stops[1].WeightKg = "abc" }, "Точка 2: проверьте массу и объём."},
		{"long contact", func(b *fleetapi.TripPlanCreate) { b.Stops[0].Contact = &long }, "Точка 1: контакт длиннее 200 символов."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			b := planBody()
			tc.edit(b)
			_, err := checkCreate(b)
			requireInvalid(t, err, tc.want)
		})
	}
	_, err := checkCreate(nil)
	assert.True(t, problem.Is(err, problem.CodeMalformedRequest), "%v", err)
}

func TestScaled(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in     string
		scale  int
		signed bool
		want   int64
		ok     bool
	}{
		{"0", 1, false, 0, true},
		{"12", 2, false, 1200, true},
		{"12.345", 2, false, 1235, true},
		{"12.344999", 2, false, 1234, true},
		{"0.05", 1, false, 1, true},
		{"-2.25", 1, true, -23, true},
		{"-0", 1, true, 0, true},
		{"-1", 1, false, 0, false},
		{"01", 1, false, 0, false},
		{"1.", 1, false, 0, false},
		{"1.1234567", 1, false, 0, false},
		{"9999999999999999999", 1, false, 0, false},
	}
	for _, tc := range cases {
		got, ok := scaled(tc.in, tc.scale, tc.signed)
		assert.Equal(t, tc.ok, ok, tc.in)
		if tc.ok {
			assert.Equal(t, tc.want, got, tc.in)
		}
	}
	assert.Equal(t, "1100", decimal(11000, 1))
	assert.Equal(t, "7.5", decimal(750, 2))
	assert.Equal(t, "-2.3", decimal(-23, 1))
	assert.Equal(t, "0.05", decimal(5, 2))
	assert.Equal(t, "0", decimal(0, 2))
}

func requireInvalid(t *testing.T, err error, detail string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	require.True(t, ok, "not a Problem: %v", err)
	assert.Equal(t, "validation_failed", pe.Code)
	assert.Equal(t, detail, pe.Detail)
}
