package spa

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // W5.20: quantities of the stock core (Q-W5.20-2)
)

// Limits of a service (tenant 0044, sched.bookings: preparation and cleaning up to 240 minutes).
const (
	maxDurationMinutes = 24 * 60
	maxBufferMinutes   = 240
	maxRecipeLines     = 50
	maxMoneyMinor      = 9007199254740991
)

const (
	textNameRequired = "Укажите название услуги."
	textNameLong     = "Название услуги — не длиннее 150 символов."
	textDuration     = "Длительность — от 1 минуты до 24 часов."
	textBuffer       = "Подготовка и уборка — от 0 до 240 минут."
	textPrice        = "Цена — целое число копеек от 0 и код валюты из трёх латинских букв."
	textRecipeLong   = "В техкарте не больше 50 материалов."
	textQuantity     = "Количество — число больше нуля с точностью до шести знаков."
	textRecipeItem   = "Материал не найден или в архиве."
	textRecipeTwice  = "Материал указан в техкарте дважды."
	textRecipeUnit   = "Единица техкарты не подходит к единице материала: пересчёт только мл в л и г в кг."
	textRecipeStale  = "Материал техкарты больше недоступен или его единица изменилась: исправьте техкарту услуги."
	textOverrideItem = "Поправка относится к материалу, которого нет в техкарте визита, или указана дважды."
	textOverrideWhy  = "Укажите причину поправки."
)

// Span is a half-open interval [From, To).
type Span struct{ From, To time.Time }

// Overlaps reports whether the intervals share a moment.
func (s Span) Overlaps(o Span) bool { return s.From.Before(o.To) && o.From.Before(s.To) }

// Plan is the window of a visit and the time its resources are busy: the window grown by the buffers of the service.
func Plan(start time.Time, durationMin, beforeMin, afterMin int64) (window, occupied Span) {
	window = Span{From: start, To: start.Add(time.Duration(durationMin) * time.Minute)}
	occupied = Span{From: start.Add(-time.Duration(beforeMin) * time.Minute), To: window.To.Add(time.Duration(afterMin) * time.Minute)}
	return window, occupied
}

// Units of the recipes and of the items (tenant 0043, 0044).
const (
	unitMl    = "ml"
	unitG     = "g"
	unitLitre = "litre"
	unitKg    = "kg"
)

// ConvertQty converts a quantity of a recipe unit to the base unit of the item: only the declared conversions
// (litre = 1000 ml, kg = 1000 g), exactly (no sixth digit is lost); ml and g never convert into each other.
func ConvertQty(q inventory.Qty, from, to string) (inventory.Qty, bool) {
	switch {
	case from == to:
		return q, true
	case from == unitMl && to == unitLitre, from == unitG && to == unitKg:
		if q%1000 != 0 {
			return 0, false
		}
		return q / 1000, true
	}
	return 0, false
}

// RecipeLine is a line of the recipe in the unit of the recipe.
type RecipeLine struct {
	Item uuid.UUID
	Qty  inventory.Qty
	Unit string
}

// Override is the actual quantity of a recipe line (in the unit of the line) and the reason.
type Override struct {
	Item   uuid.UUID
	Qty    inventory.Qty
	Reason string
}

// Use is a quantity to issue in the base unit of the item.
type Use struct {
	Item uuid.UUID
	Qty  inventory.Qty
}

// ConsumptionLines turns the recipe of a visit and the corrections of the practitioner into the lines of the issue;
// units are the base units of the items. A line with the actual quantity zero is not issued.
func ConsumptionLines(recipe []RecipeLine, units map[uuid.UUID]string, overrides []Override) ([]Use, error) {
	actual := map[uuid.UUID]inventory.Qty{}
	inRecipe := map[uuid.UUID]bool{}
	for _, l := range recipe {
		inRecipe[l.Item] = true
	}
	for i, o := range overrides {
		field := fmt.Sprintf("overrides[%d]", i)
		if !inRecipe[o.Item] {
			return nil, invalid(field+".itemId", textOverrideItem)
		}
		if _, twice := actual[o.Item]; twice {
			return nil, invalid(field+".itemId", textOverrideItem)
		}
		if strings.TrimSpace(o.Reason) == "" {
			return nil, invalid(field+".reason", textOverrideWhy)
		}
		actual[o.Item] = o.Qty
	}
	var out []Use
	for _, l := range recipe {
		q := l.Qty
		if a, ok := actual[l.Item]; ok {
			q = a
		}
		base, known := units[l.Item]
		if !known {
			return nil, invalid("recipe", textRecipeStale)
		}
		conv, ok := ConvertQty(q, l.Unit, base)
		if !ok {
			return nil, invalid("recipe", textRecipeStale)
		}
		if conv > 0 {
			out = append(out, Use{Item: l.Item, Qty: conv})
		}
	}
	return out, nil
}

// Actions of a visit for NextStatus.
const (
	ActionPerform    = "perform"
	ActionComplete   = "complete"
	ActionCancel     = "cancel"
	ActionNoShow     = "no_show"
	ActionReschedule = "reschedule"
)

// Statuses of a visit (tenant 0044).
const (
	statusConfirmed = "confirmed"
	statusPerformed = "performed_pending_posting"
	statusCompleted = "completed"
	statusCancelled = "cancelled"
	statusNoShow    = "no_show"
)

var transitions = map[[2]string]string{
	{statusConfirmed, ActionPerform}:    statusPerformed,
	{statusConfirmed, ActionCancel}:     statusCancelled,
	{statusConfirmed, ActionNoShow}:     statusNoShow,
	{statusConfirmed, ActionReschedule}: statusConfirmed,
	{statusPerformed, ActionComplete}:   statusCompleted,
}

// NextStatus is the status after an action; false when the action is not allowed in the status.
func NextStatus(status, action string) (string, bool) {
	next, ok := transitions[[2]string{status, action}]
	return next, ok
}

// Workday is the working day of a resource: the local start and end in its zone.
type Workday struct {
	Start, End time.Duration
	Loc        *time.Location
}

// Holds reports whether occ lies inside the working day of the local day of its start.
func (w Workday) Holds(occ Span) bool {
	l := occ.From.In(w.Loc)
	day := time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, w.Loc)
	return !occ.From.Before(day.Add(w.Start)) && !occ.To.After(day.Add(w.End))
}

var currencyRE = regexp.MustCompile(`^[A-Z]{3}$`)

// CleanService checks the scalar fields of a service and returns the clean name.
func CleanService(name string, duration, before, after int64, price api.Money) (string, error) {
	n := strings.TrimSpace(name)
	switch {
	case n == "":
		return "", invalid("name", textNameRequired)
	case utf8.RuneCountInString(n) > 150:
		return "", invalid("name", textNameLong)
	case duration < 1 || duration > maxDurationMinutes:
		return "", invalid("durationMinutes", textDuration)
	case before < 0 || before > maxBufferMinutes:
		return "", invalid("bufferBeforeMinutes", textBuffer)
	case after < 0 || after > maxBufferMinutes:
		return "", invalid("bufferAfterMinutes", textBuffer)
	case price.AmountMinor < 0 || int64(price.AmountMinor) > maxMoneyMinor || !currencyRE.MatchString(price.Currency):
		return "", invalid("price", textPrice)
	}
	return n, nil
}

// CleanRecipe checks the lines of a recipe against the base units of the items.
func CleanRecipe(in []api.ConsumptionRecipeLine, units map[uuid.UUID]string) ([]RecipeLine, error) {
	if len(in) > maxRecipeLines {
		return nil, invalid("recipe", textRecipeLong)
	}
	out := make([]RecipeLine, 0, len(in))
	seen := map[uuid.UUID]bool{}
	for i, l := range in {
		field := fmt.Sprintf("recipe[%d]", i)
		q, err := inventory.ParseQuantity(l.Quantity)
		if err != nil || q == 0 {
			return nil, invalid(field+".quantity", textQuantity)
		}
		base, known := units[l.ItemId]
		switch {
		case !known:
			return nil, invalid(field+".itemId", textRecipeItem)
		case seen[l.ItemId]:
			return nil, invalid(field+".itemId", textRecipeTwice)
		}
		seen[l.ItemId] = true
		if _, ok := ConvertQty(q, string(l.Unit), base); !ok {
			return nil, invalid(field+".unit", textRecipeUnit)
		}
		out = append(out, RecipeLine{Item: l.ItemId, Qty: q, Unit: string(l.Unit)})
	}
	return out, nil
}
