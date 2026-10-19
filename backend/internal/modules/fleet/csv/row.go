package csv

import (
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// textEquipment is the answer of createVehicle (W2.02) to equipment the fleet does not keep.
const textEquipment = "Это оснащение пока не хранится в автопарке: доступен только холодильник при температурном режиме."

// maxText is the longest registration number, name and depot (fleet.vehicles, tenant 0002 and 0012).
const maxText = 200

// Messages of the row errors (MSW W2.52 fleet/imports.ts; the screen is no-reference, B-6).
const (
	msgRequired  = "Обязательное поле"
	msgTooLong   = "Не длиннее 200 символов"
	msgBody      = "Неизвестный тип кузова"
	msgNumber    = "Число с точкой или запятой"
	msgPositive  = "Должно быть больше нуля"
	msgTooBig    = "Слишком большое значение"
	msgTempPair  = "Укажите обе температуры или ни одной"
	msgTempOrder = "Нижняя граница температуры выше верхней"
	msgEquipment = "Неизвестное оборудование"
	msgExtra     = "Лишние значения в строке"
)

var (
	quantityRE = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`)   // Quantity of the contract
	decimalRE  = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`) // Decimal of the contract
	spacesRE   = regexp.MustCompile(`\s+`)
)

// bodies maps the body_type column (codes of the contract and labels of the prototype, any case) to the body of the
// table and of the contract.
var bodies = func() map[string]body {
	van, flatbed, reefer, tent := body{"van", "van"}, body{"flatbed", "flatbed"}, body{"reefer", "refrigerated"},
		body{"tent", "tent"}
	return map[string]body{
		van.api: van, "box": {"box", "box"}, flatbed.api: flatbed, reefer.api: reefer, tent.api: tent,
		"фургон": van, "борт": flatbed, "рефрижератор": reefer, "тент": tent,
	}
}()

// body is a body type of the table (fleet.vehicles.body_type) and of the contract (VehicleBodyType).
type body struct{ db, api string }

// equipmentCodes are the codes of the column; the fleet keeps only the refrigerator of a temperature range.
var equipmentCodes = []string{"tail_lift", "side_loading", "pallet_jack", "refrigerator"}

// quantity describes a quantity column: the scale of its column and its largest value, and whether it must be
// positive after the rounding of the column (fleet.vehicles: numeric(10,1), numeric(8,2), integer millimetres).
type quantity struct {
	col      string
	scale    int
	max      float64
	positive bool
	dst      func(p *parsed) *string
}

var quantities = []quantity{
	{colPayload, 1, 999999999.9, true, func(p *parsed) *string { return &p.Payload }},
	{colVolume, 2, 999999.99, true, func(p *parsed) *string { return &p.Volume }},
	{colLength, 3, 2147483.647, true, func(p *parsed) *string { return &p.Length }},
	{colWidth, 3, 2147483.647, true, func(p *parsed) *string { return &p.Width }},
	{colHeight, 3, 2147483.647, true, func(p *parsed) *string { return &p.Height }},
	{colOdometer, 1, 999999999.9, false, func(p *parsed) *string { return &p.Odometer }},
}

// parsed are the checked values of a row in the form of fleet.vehicles: exact decimals with a point (metres, not
// millimetres), the body of the table and of the contract.
type parsed struct {
	Plate, Name, Body, BodyType            string
	Payload, Volume, Length, Width, Height string
	Odometer                               string
	TempMin, TempMax, Depot                *string
	OrgUnit                                string // the org_unit column as written
}

// plateKey is the registration number a match by number compares: trimmed, inner spaces collapsed, upper case
// (fleet.vehicles_plate_uq is upper(plate)).
func plateKey(s string) string { return strings.ToUpper(cleanPlate(s)) }

func cleanPlate(s string) string { return spacesRE.ReplaceAllString(strings.TrimSpace(s), " ") }

// checkRecord checks a row on its own: the required values, the lengths, the body, the quantities with a point or a
// comma within the columns of the table, the temperature range, the equipment the fleet keeps and the depot.
func checkRecord(r record) (parsed, []violation) {
	v := func(col string) string { return strings.TrimSpace(r.Values[col]) }
	var errs []violation
	add := func(field, code, msg string) { errs = append(errs, violation{Field: field, Code: code, Message: msg}) }
	text := func(col string) string {
		s := v(col)
		switch {
		case s == "":
			add(col, "required", msgRequired)
		case utf8.RuneCountInString(s) > maxText:
			add(col, "too_long", msgTooLong)
		}
		return s
	}
	p := parsed{Plate: cleanPlate(text(colPlate)), Name: text(colName), OrgUnit: v(colOrgUnit)}
	if b := v(colBody); b == "" {
		add(colBody, "required", msgRequired)
	} else if body, ok := bodies[strings.ToLower(b)]; ok {
		p.Body, p.BodyType = body.db, body.api
	} else {
		add(colBody, "unknown", msgBody)
	}
	for _, q := range quantities {
		s, code, msg := checkQuantity(v(q.col), q)
		if code != "" {
			add(q.col, code, msg)
		}
		*q.dst(&p) = s
	}
	p.TempMin, p.TempMax = checkTemperature(v(colTempMin), v(colTempMax), add)
	checkEquipment(v(colEquipment), p.TempMin != nil, add)
	if d := v(colDepot); utf8.RuneCountInString(d) > maxText {
		add(colDepot, "too_long", msgTooLong)
	} else if d != "" {
		p.Depot = &d
	}
	if r.Extra {
		add("line", "extra_values", msgExtra)
	}
	return p, errs
}

// number reads a decimal with a point or a comma; a leading plus and a typographic minus are accepted.
func number(s string, re *regexp.Regexp) (string, float64, bool) {
	s = strings.NewReplacer(",", ".", "−", "-").Replace(strings.TrimPrefix(s, "+"))
	if !re.MatchString(s) {
		return "", 0, false
	}
	f, err := strconv.ParseFloat(s, 64)
	return s, f, err == nil
}

// checkQuantity returns the value of a quantity column or the code and message of its error.
func checkQuantity(s string, q quantity) (value, code, msg string) {
	if s == "" {
		return "", "required", msgRequired
	}
	out, f, ok := number(s, quantityRE)
	if !ok {
		return "", "format", msgNumber
	}
	rounded := math.Round(f*math.Pow10(q.scale)) / math.Pow10(q.scale)
	switch {
	case rounded > q.max:
		return "", "too_large", msgTooBig
	case q.positive && rounded <= 0:
		return "", "positive", msgPositive
	}
	return out, "", ""
}

// checkTemperature returns both bounds or none.
func checkTemperature(lo, hi string, add func(field, code, msg string)) (*string, *string) {
	if (lo == "") != (hi == "") {
		add(colTempMin, "pair", msgTempPair)
		return nil, nil
	}
	if lo == "" {
		return nil, nil
	}
	a, fa, okA := number(lo, decimalRE)
	b, fb, okB := number(hi, decimalRE)
	switch {
	case !okA:
		add(colTempMin, "format", msgNumber)
	case !okB:
		add(colTempMax, "format", msgNumber)
	case math.Abs(fa) > 999.9 || math.Abs(fb) > 999.9:
		add(colTempMin, "too_large", msgTooBig)
	case fa > fb:
		add(colTempMin, "order", msgTempOrder)
	default:
		return &a, &b
	}
	return nil, nil
}

// checkEquipment checks the codes separated by «|»: unknown codes, then what the fleet does not keep (only the
// refrigerator of a vehicle with a temperature range, as createVehicle).
func checkEquipment(s string, cold bool, add func(field, code, msg string)) {
	var codes []string
	for e := range strings.SplitSeq(s, "|") {
		if e = strings.TrimSpace(e); e != "" {
			codes = append(codes, e)
		}
	}
	for _, e := range codes {
		if !slices.Contains(equipmentCodes, e) {
			add(colEquipment, "unknown", msgEquipment)
			return
		}
	}
	for _, e := range codes {
		if e != "refrigerator" || !cold {
			add(colEquipment, "not_stored", textEquipment)
			return
		}
	}
}
