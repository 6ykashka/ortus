package routes

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.03: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"   //nolint:depguard // W2.03: the scheduling core the trips hold their vehicles through (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Texts of the 422 of createTripPlan (the mock W2.00, trips.ts; the form «Планирование рейса» shows the detail).
const (
	textTitle        = "Укажите название рейса."
	textWindow       = "Проверьте время рейса: окончание должно быть позже начала."
	textTimeZone     = "Неизвестный часовой пояс рейса."
	textCargo        = "Опишите груз рейса."
	textCargoWeight  = "Проверьте массу груза."
	textCargoVolume  = "Проверьте объём груза."
	textCargoLength  = "Проверьте длину груза."
	textTempBoth     = "Укажите обе границы температуры груза или ни одной."
	textTempValue    = "Проверьте температуру груза."
	textTempOrder    = "Проверьте температуру груза: нижняя граница выше верхней."
	textDistance     = "Проверьте расстояние рейса."
	textNoStops      = "Добавьте хотя бы одну точку рейса."
	textTooManyStops = "В рейсе не больше 100 точек."
	textStopOrder    = "Точки нумеруются подряд с 1."
	// The texts of a stop take its number (TripStop.sequence).
	textStopOp      = "Точка %d: укажите погрузку или выгрузку."
	textStopAddress = "Точка %d: укажите адрес."
	textStopLoad    = "Точка %d: проверьте массу и объём."
	textStopContact = "Точка %d: контакт длиннее 200 символов."
	textUnloadMass  = "Точка %d: выгрузка больше, чем в кузове после предыдущей точки (масса)."
	textUnloadVol   = "Точка %d: выгрузка больше, чем в кузове после предыдущей точки (объём)."
)

// Limits of the columns (tenant 0002, 0012): numeric(10,1) of a mass, numeric(8,2) of a volume, numeric(8,1) of a
// distance, numeric(4,1) of a temperature, a cargo length in mm (integer; a body is never longer than 100 m).
const (
	maxWeight   = 999_999_999_9 // 0,1 kg
	maxVolume   = 999_999_99    // 0,01 m³
	maxDistance = 999_999_9     // 0,1 km
	maxTemp     = 999_9         // 0,1 °C
	maxLengthMM = 100_000
	maxStops    = 100
	maxTitle    = 200
	maxText     = 500
	maxContact  = 200
)

// stopInput is a checked TripStop: mass in 0,1 kg and volume in 0,01 m³ (fleet.trip_stops numeric(10,1), (8,2)).
type stopInput struct {
	seq            int
	op, address    string
	at             *time.Time
	weight, volume int64
	contact        *string
}

// cargoInput is the checked cargo of the trip in the units of fleet.trips: 0,1 kg, 0,01 m³, mm, 0,1 °C.
type cargoInput struct {
	description      string
	weight, volume   int64
	lengthMM         int64
	tempMin, tempMax *int64
}

// planInput is a checked TripPlanCreate.
type planInput struct {
	unit     uuid.UUID
	title    string
	window   sched.Window
	zone     string
	distance *int64 // 0,1 km
	cargo    cargoInput
	stops    []stopInput
	driver   *uuid.UUID
}

// checkCreate checks the body of createTripPlan before any read: the title, the window and its time zone, the cargo,
// the distance and the stops with the load per leg — mass and volume separately, exactly (no binary floats), a stop
// never unloading more than is on board after the previous one (Q-W2.00-6: 422, the prototype silently clamps at
// zero).
func checkCreate(b *fleetapi.TripPlanCreate) (planInput, error) {
	if b == nil {
		return planInput{}, problem.New(problem.CodeMalformedRequest, "")
	}
	in := planInput{
		unit: b.OrgUnitId, title: strings.TrimSpace(b.Title), zone: b.PlannedWindow.TimeZone, driver: b.DriverMemberId,
		window: sched.Window{Start: b.PlannedWindow.StartsAt.UTC(), End: b.PlannedWindow.EndsAt.UTC()},
	}
	switch n := utf8.RuneCountInString(in.title); {
	case n == 0 || n > maxTitle:
		return planInput{}, kit.Invalid(textTitle)
	case !in.window.Valid():
		return planInput{}, kit.Invalid(textWindow)
	}
	if _, err := time.LoadLocation(in.zone); err != nil || in.zone == "" || strings.EqualFold(in.zone, "local") {
		return planInput{}, kit.Invalid(textTimeZone)
	}
	var err error
	if in.cargo, err = checkCargo(b.Cargo); err != nil {
		return planInput{}, err
	}
	if b.DistanceKm != nil {
		d, ok := scaled(*b.DistanceKm, 1, false)
		if !ok || d > maxDistance {
			return planInput{}, kit.Invalid(textDistance)
		}
		in.distance = &d
	}
	if in.stops, err = checkStops(b.Stops); err != nil {
		return planInput{}, err
	}
	return in, nil
}

func checkCargo(c fleetapi.TripCargo) (cargoInput, error) {
	out := cargoInput{description: strings.TrimSpace(c.Description)}
	if n := utf8.RuneCountInString(out.description); n == 0 || n > maxText {
		return cargoInput{}, kit.Invalid(textCargo)
	}
	var ok bool
	if out.weight, ok = scaled(c.WeightKg, 1, false); !ok || out.weight > maxWeight {
		return cargoInput{}, kit.Invalid(textCargoWeight)
	}
	if out.volume, ok = scaled(c.VolumeM3, 2, false); !ok || out.volume > maxVolume {
		return cargoInput{}, kit.Invalid(textCargoVolume)
	}
	if out.lengthMM, ok = scaled(c.LengthM, 3, false); !ok || out.lengthMM > maxLengthMM {
		return cargoInput{}, kit.Invalid(textCargoLength)
	}
	var err error
	if out.tempMin, out.tempMax, err = checkTemp(c.TemperatureMinC, c.TemperatureMaxC); err != nil {
		return cargoInput{}, err
	}
	return out, nil
}

// checkTemp checks the temperature bounds of the cargo: both or none, the lower one not above the upper one.
func checkTemp(minC, maxC *string) (lo, hi *int64, err error) {
	switch {
	case (minC == nil) != (maxC == nil):
		return nil, nil, kit.Invalid(textTempBoth)
	case minC == nil:
		return nil, nil, nil
	}
	l, okLo := scaled(*minC, 1, true)
	h, okHi := scaled(*maxC, 1, true)
	switch {
	case !okLo || !okHi || abs(l) > maxTemp || abs(h) > maxTemp:
		return nil, nil, kit.Invalid(textTempValue)
	case l > h:
		return nil, nil, kit.Invalid(textTempOrder)
	}
	return &l, &h, nil
}

// checkStops checks the stops in their order and the load after each of them.
func checkStops(stops []fleetapi.TripStop) ([]stopInput, error) {
	switch {
	case len(stops) == 0:
		return nil, kit.Invalid(textNoStops)
	case len(stops) > maxStops:
		return nil, kit.Invalid(textTooManyStops)
	}
	out := make([]stopInput, 0, len(stops))
	var weight, volume int64 // on board after the stop
	for i, s := range stops {
		n := i + 1
		st, err := checkStop(s, n)
		if err != nil {
			return nil, err
		}
		sign := int64(1)
		if st.op == string(fleetapi.Unload) {
			sign = -1
		}
		weight, volume = weight+sign*st.weight, volume+sign*st.volume
		switch {
		case weight < 0:
			return nil, kit.Invalid(fmt.Sprintf(textUnloadMass, n))
		case volume < 0:
			return nil, kit.Invalid(fmt.Sprintf(textUnloadVol, n))
		}
		out = append(out, st)
	}
	return out, nil
}

// checkStop checks the stop number n on its own: its place, operation, address, contact, mass and volume.
func checkStop(s fleetapi.TripStop, n int) (stopInput, error) {
	if s.Sequence != int64(n) {
		return stopInput{}, kit.Invalid(textStopOrder)
	}
	st := stopInput{seq: n, op: string(s.Op), address: strings.TrimSpace(s.Address), at: utc(s.PlannedAt), contact: s.Contact}
	if st.op != string(fleetapi.Load) && st.op != string(fleetapi.Unload) {
		return stopInput{}, kit.Invalid(fmt.Sprintf(textStopOp, n))
	}
	if c := utf8.RuneCountInString(st.address); c == 0 || c > maxText {
		return stopInput{}, kit.Invalid(fmt.Sprintf(textStopAddress, n))
	}
	if s.Contact != nil && utf8.RuneCountInString(*s.Contact) > maxContact {
		return stopInput{}, kit.Invalid(fmt.Sprintf(textStopContact, n))
	}
	var okW, okV bool
	st.weight, okW = scaled(s.WeightKg, 1, false)
	st.volume, okV = scaled(s.VolumeM3, 2, false)
	if !okW || !okV || st.weight > maxWeight || st.volume > maxVolume {
		return stopInput{}, kit.Invalid(fmt.Sprintf(textStopLoad, n))
	}
	return st, nil
}

// quantityRE is Quantity of the contract with an optional sign (Decimal): the strict server does not check patterns.
var quantityRE = regexp.MustCompile(`^(-?)(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$`)

// scaled parses an exact decimal (Quantity, or Decimal when signed) into an integer of 10^-scale units, rounding half
// away from zero as numeric(p, scale) does. Integer parts longer than 12 digits are refused (they exceed every column).
func scaled(s string, scale int, signed bool) (int64, bool) {
	m := quantityRE.FindStringSubmatch(s)
	if m == nil || (m[1] == "-" && !signed) {
		return 0, false
	}
	frac := m[3] + strings.Repeat("0", 7)
	v, err := strconv.ParseInt(m[2]+frac[:scale], 10, 64)
	if err != nil {
		return 0, false
	}
	if frac[scale] >= '5' {
		v++
	}
	if m[1] == "-" {
		v = -v
	}
	return v, true
}

// decimal prints v of 10^-scale units without trailing zeros.
func decimal(v int64, scale int) string {
	sign := ""
	if v < 0 {
		sign, v = "-", -v
	}
	digits := strconv.FormatInt(v, 10)
	if len(digits) <= scale {
		digits = strings.Repeat("0", scale-len(digits)+1) + digits
	}
	whole, frac := digits[:len(digits)-scale], strings.TrimRight(digits[len(digits)-scale:], "0")
	if frac == "" {
		return sign + whole
	}
	return sign + whole + "." + frac
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
