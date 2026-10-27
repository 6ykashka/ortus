package spa

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // W5.20: quantities of the stock core (Q-W5.20-2)
)

func at(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func qty(t *testing.T, s string) inventory.Qty {
	t.Helper()
	q, err := inventory.ParseQuantity(s)
	if err != nil {
		t.Fatal(err)
	}
	return q
}

// The resources of a visit are busy from the preparation to the cleaning; the window of the visit is its duration.
func TestPlan(t *testing.T) {
	t.Parallel()
	w, o := Plan(at(t, "2026-10-05T09:00:00Z"), 60, 5, 15)
	if !w.From.Equal(at(t, "2026-10-05T09:00:00Z")) || !w.To.Equal(at(t, "2026-10-05T10:00:00Z")) {
		t.Fatalf("window %v", w)
	}
	if !o.From.Equal(at(t, "2026-10-05T08:55:00Z")) || !o.To.Equal(at(t, "2026-10-05T10:15:00Z")) {
		t.Fatalf("occupied %v", o)
	}
	if !o.Overlaps(Span{From: at(t, "2026-10-05T10:10:00Z"), To: at(t, "2026-10-05T11:00:00Z")}) {
		t.Fatal("the cleaning must hold the resource")
	}
	if o.Overlaps(Span{From: at(t, "2026-10-05T10:15:00Z"), To: at(t, "2026-10-05T11:00:00Z")}) {
		t.Fatal("intervals are half-open: the next visit may start when the cleaning ends")
	}
}

func TestConvertQty(t *testing.T) {
	t.Parallel()
	cases := []struct {
		q, from, to string
		want        string
		ok          bool
	}{
		{"25", "ml", "ml", "25", true},
		{"25", "ml", "litre", "0.025", true},
		{"1500", "g", "kg", "1.5", true},
		{"3", "piece", "piece", "3", true},
		{"0.0001", "ml", "litre", "", false}, // the sixth digit would be lost
		{"10", "ml", "g", "", false},         // no universal coefficient (SPA-02)
		{"10", "g", "ml", "", false},
		{"2", "piece", "ml", "", false},
		{"2", "litre", "ml", "", false}, // a recipe is written in ml, g, piece
	}
	for _, c := range cases {
		got, ok := ConvertQty(qty(t, c.q), c.from, c.to)
		if ok != c.ok || (ok && got.String() != c.want) {
			t.Errorf("%s %s -> %s: got %s %v, want %s %v", c.q, c.from, c.to, got, ok, c.want, c.ok)
		}
	}
}

func TestConsumptionLines(t *testing.T) {
	t.Parallel()
	oil, cream, towel := uuid.New(), uuid.New(), uuid.New()
	recipe := []RecipeLine{
		{Item: oil, Qty: qty(t, "25"), Unit: "ml"},
		{Item: cream, Qty: qty(t, "10"), Unit: "g"},
		{Item: towel, Qty: qty(t, "1"), Unit: "piece"},
	}
	units := map[uuid.UUID]string{oil: "ml", cream: "kg", towel: "piece"}

	lines, err := ConsumptionLines(recipe, units, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []Use{{oil, qty(t, "25")}, {cream, qty(t, "0.01")}, {towel, qty(t, "1")}}
	if len(lines) != len(want) {
		t.Fatalf("lines %v, want %v", lines, want)
	}
	for i := range want {
		if lines[i] != want[i] {
			t.Errorf("line %d: %v, want %v", i, lines[i], want[i])
		}
	}

	// The practitioner spent more oil and no towel: the actual quantity replaces the norm, zero drops the line.
	lines, err = ConsumptionLines(recipe, units, []Override{
		{Item: oil, Qty: qty(t, "30"), Reason: "густая кожа"}, {Item: towel, Qty: 0, Reason: "не понадобилось"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0] != (Use{oil, qty(t, "30")}) || lines[1] != (Use{cream, qty(t, "0.01")}) {
		t.Fatalf("lines %v", lines)
	}
}

func TestConsumptionLinesRefusals(t *testing.T) {
	t.Parallel()
	oil, other := uuid.New(), uuid.New()
	recipe := []RecipeLine{{Item: oil, Qty: qty(t, "25"), Unit: "ml"}}
	units := map[uuid.UUID]string{oil: "ml"}
	cases := []struct {
		name  string
		units map[uuid.UUID]string
		over  []Override
		field string
	}{
		{"override of a material outside the recipe", units, []Override{{Item: other, Qty: 1, Reason: "r"}}, "overrides[0].itemId"},
		{"the same material twice", units, []Override{{Item: oil, Qty: 1, Reason: "r"}, {Item: oil, Qty: 2, Reason: "r"}}, "overrides[1].itemId"},
		{"no reason", units, []Override{{Item: oil, Qty: 1, Reason: "  "}}, "overrides[0].reason"},
		{"the item is gone", map[uuid.UUID]string{}, nil, "recipe"},
		{"the unit does not convert", map[uuid.UUID]string{oil: "g"}, nil, "recipe"},
	}
	for _, c := range cases {
		_, err := ConsumptionLines(recipe, c.units, c.over)
		f, ok := errors.AsType[*RefusalError](err)
		if !ok || f.Code != codeValidation || f.Field != c.field {
			t.Errorf("%s: %v, want a 422 on %s", c.name, err, c.field)
		}
	}
}

func TestNextStatus(t *testing.T) {
	t.Parallel()
	allowed := map[[2]string]string{
		{"confirmed", ActionPerform}:                  "performed_pending_posting",
		{"confirmed", ActionCancel}:                   "cancelled",
		{"confirmed", ActionNoShow}:                   "no_show",
		{"confirmed", ActionReschedule}:               "confirmed",
		{"performed_pending_posting", ActionComplete}: "completed",
	}
	for _, status := range []string{"confirmed", "performed_pending_posting", "completed", "cancelled", "no_show"} {
		for _, action := range []string{ActionPerform, ActionComplete, ActionCancel, ActionNoShow, ActionReschedule} {
			want, ok := allowed[[2]string{status, action}]
			got, gotOK := NextStatus(status, action)
			if gotOK != ok || got != want {
				t.Errorf("%s + %s: %q %v, want %q %v", status, action, got, gotOK, want, ok)
			}
		}
	}
}

func TestWorkday(t *testing.T) {
	t.Parallel()
	msk, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	w := Workday{Start: 8 * time.Hour, End: 20 * time.Hour, Loc: msk}
	cases := []struct {
		from, to string
		want     bool
	}{
		{"2026-10-05T05:00:00Z", "2026-10-05T06:00:00Z", true},  // 08:00–09:00 Moscow
		{"2026-10-05T04:55:00Z", "2026-10-05T06:00:00Z", false}, // the preparation starts at 07:55
		{"2026-10-05T16:30:00Z", "2026-10-05T17:15:00Z", false}, // the cleaning ends at 20:15
		{"2026-10-05T16:00:00Z", "2026-10-05T17:00:00Z", true},  // until 20:00 sharp
		{"2026-10-05T20:00:00Z", "2026-10-05T21:30:00Z", false}, // night
	}
	for _, c := range cases {
		if got := w.Holds(Span{From: at(t, c.from), To: at(t, c.to)}); got != c.want {
			t.Errorf("%s–%s: %v, want %v", c.from, c.to, got, c.want)
		}
	}
}

func TestCleanService(t *testing.T) {
	t.Parallel()
	price := api.Money{AmountMinor: 450000, Currency: "RUB"}
	name, err := CleanService("  Массаж спины  ", 60, 5, 15, price)
	if err != nil || name != "Массаж спины" {
		t.Fatalf("%q %v", name, err)
	}
	bad := []struct {
		name          string
		dur, bef, aft int64
		price         api.Money
		field         string
	}{
		{"", 60, 0, 0, price, "name"},
		{"Массаж", 0, 0, 0, price, "durationMinutes"},
		{"Массаж", 1441, 0, 0, price, "durationMinutes"},
		{"Массаж", 60, -1, 0, price, "bufferBeforeMinutes"},
		{"Массаж", 60, 241, 0, price, "bufferBeforeMinutes"}, // sched.bookings holds up to 240 minutes
		{"Массаж", 60, 0, 241, price, "bufferAfterMinutes"},
		{"Массаж", 60, 0, 0, api.Money{AmountMinor: -1, Currency: "RUB"}, "price"},
		{"Массаж", 60, 0, 0, api.Money{AmountMinor: 1, Currency: "rub"}, "price"},
	}
	for _, c := range bad {
		_, err := CleanService(c.name, c.dur, c.bef, c.aft, c.price)
		f, ok := errors.AsType[*RefusalError](err)
		if !ok || f.Field != c.field {
			t.Errorf("%+v: %v, want a 422 on %s", c, err, c.field)
		}
	}
}

func TestCleanRecipe(t *testing.T) {
	t.Parallel()
	oil, cream := uuid.New(), uuid.New()
	units := map[uuid.UUID]string{oil: "ml", cream: "kg"}
	line := func(item uuid.UUID, q string, unit api.ConsumptionRecipeLineUnit) api.ConsumptionRecipeLine {
		return api.ConsumptionRecipeLine{ItemId: item, Quantity: q, Unit: unit}
	}
	got, err := CleanRecipe([]api.ConsumptionRecipeLine{line(oil, "25", api.Ml), line(cream, "10", api.G)}, units)
	if err != nil || len(got) != 2 || got[0].Item != oil || got[1].Unit != "g" || got[1].Qty != qty(t, "10") {
		t.Fatalf("%v %v", got, err)
	}
	bad := []struct {
		name  string
		in    []api.ConsumptionRecipeLine
		field string
	}{
		{"zero", []api.ConsumptionRecipeLine{line(oil, "0", api.Ml)}, "recipe[0].quantity"},
		{"not a number", []api.ConsumptionRecipeLine{line(oil, "много", api.Ml)}, "recipe[0].quantity"},
		{"unknown item", []api.ConsumptionRecipeLine{line(uuid.New(), "1", api.Ml)}, "recipe[0].itemId"},
		{"twice", []api.ConsumptionRecipeLine{line(oil, "1", api.Ml), line(oil, "2", api.Ml)}, "recipe[1].itemId"},
		{"ml for kg", []api.ConsumptionRecipeLine{line(cream, "1", api.Ml)}, "recipe[0].unit"},
		{"too many", make([]api.ConsumptionRecipeLine, 51), "recipe"},
	}
	for _, c := range bad {
		_, err := CleanRecipe(c.in, units)
		f, ok := errors.AsType[*RefusalError](err)
		if !ok || f.Code != codeValidation || f.Field != c.field {
			t.Errorf("%s: %v, want a 422 on %s", c.name, err, c.field)
		}
	}
}
