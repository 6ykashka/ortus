package data

import "testing"

// Cells of a row: the value of the type of the field; a null value is {"type": "null", "value": null}.
func TestCell(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name          string
		typ           ValueType
		raw, currency *string
		want          string
	}{
		{"text", Text, new("Р-208 · Северный маршрут"), nil, `{"type": "text", "value": "Р-208 · Северный маршрут"}`},
		{"decimal", Decimal, new("12.5"), nil, `{"type": "decimal", "value": "12.5"}`},
		{"money", Money, new("250000"), new("RUB"), `{"type": "money", "value": {"amountMinor": 250000, "currency": "RUB"}}`},
		{"date", Date, new("2026-10-01"), nil, `{"type": "date", "value": "2026-10-01"}`},
		{"choice", Choices, new("planned"), nil, `{"type": "choices", "value": ["planned"]}`},
		{"null", Text, nil, nil, `{"type": "null", "value": null}`},
		{"money of mixed currencies", Money, new("100"), nil, `{"type": "null", "value": null}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			v, err := cell(c.typ, c.raw, c.currency)
			if err != nil {
				t.Fatal(err)
			}
			sameJSON(t, v, c.want)
		})
	}
	for _, c := range []struct {
		name string
		typ  ValueType
		raw  string
	}{{"money", Money, "много"}, {"date", Date, "01.10.2026"}} {
		if _, err := cell(c.typ, &c.raw, new("RUB")); err == nil {
			t.Fatalf("%s %q: no error", c.name, c.raw)
		}
	}
}
