// Package billing is the billing of the control DB (W4.60, step 4.6; design/docs/17-users-and-billing.md): the price
// book by seats with its immutable versions, quotes, the tier change requests of owners and the decisions of the
// operators, the seats of a tenant and the usage of the platform. The rules are those of the scenario server of
// W4.07 (frontend/packages/adapter/src/msw/billing/plans.ts, platform/pricing.ts, platform/usage.ts).
package billing

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Currency of the price book (price_tiers.currency).
const Currency = "RUB"

// States of a price book version (PriceBookVersion.state).
const (
	StateCurrent   = "current"
	StateScheduled = "scheduled"
	StateArchived  = "archived"
	StateCancelled = "cancelled"
)

// msk is Europe/Moscow (UTC+3 without DST): the price book and paid periods count days there.
var msk = time.FixedZone("MSK", 3*60*60)

// Tier is one step of the price book; SeatsLimit and MonthMinor are both nil for the unlimited tier (priced
// individually by the operator).
type Tier struct {
	Code, Name string
	SeatsLimit *int
	MonthMinor *int64
}

// Term is a payment term (1, 4, 8 or 12 months) and its discount in whole percent.
type Term struct {
	Months, DiscountPercent int
}

// AccountRef is who acted, as shown at the time of the action (AccountRef of the contract).
type AccountRef struct {
	AccountID   *uuid.UUID
	DisplayName string
}

// Version is an immutable version of the price book (price_book_versions, price_tiers, price_terms).
type Version struct {
	Number            int
	EffectiveFrom     time.Time
	EffectiveUntil    *time.Time // nil: in force without a successor
	Note, Currency    string
	Tiers             []Tier
	Terms             []Term
	PublishedAt       *time.Time
	PublishedBy       *AccountRef
	CancelledAt       *time.Time
	SubscriptionCount int
}

// State is the state of v at now: cancelled, scheduled (starts later), archived (ended) or current.
func (v Version) State(now time.Time) string {
	switch {
	case v.CancelledAt != nil:
		return StateCancelled
	case v.EffectiveFrom.After(now):
		return StateScheduled
	case v.EffectiveUntil != nil && !v.EffectiveUntil.After(now):
		return StateArchived
	}
	return StateCurrent
}

// Tier returns the tier of v with code.
func (v Version) Tier(code string) (Tier, bool) {
	i := slices.IndexFunc(v.Tiers, func(t Tier) bool { return t.Code == code })
	if i < 0 {
		return Tier{}, false
	}
	return v.Tiers[i], true
}

// Quote is the calculation of a tier and a term (SubscriptionQuote).
type Quote struct {
	MonthlyMinor, PeriodMinor, SavingMinor int64
	DiscountPercent                        int
}

// QuoteOf calculates a tier and a term of v (PriceTerm): the monthly price with the discount rounded half up to whole
// roubles, the period — that × months, the saving — (base − monthly) × months. The unlimited tier, a missing tier
// and a missing term have no quote.
func QuoteOf(v Version, tier string, months int) (Quote, bool) {
	t, ok := v.Tier(tier)
	ti := slices.IndexFunc(v.Terms, func(x Term) bool { return x.Months == months })
	if !ok || t.MonthMinor == nil || ti < 0 {
		return Quote{}, false
	}
	base, off := *t.MonthMinor, int64(v.Terms[ti].DiscountPercent)
	// base × (100 − off) / 100 kopecks, rounded half up to whole roubles (× 100 kopecks).
	monthly := (base*(100-off) + 5000) / 10000 * 100
	return Quote{
		MonthlyMinor: monthly, PeriodMinor: monthly * int64(months), SavingMinor: (base - monthly) * int64(months),
		DiscountPercent: int(off),
	}, true
}

// Violation is one field error of a 422 (ProblemViolation).
type Violation struct {
	Field, Code, Message string
}

// DraftTier is a tier of a new version; Code is "" for a new tier (the server assigns one).
type DraftTier struct {
	Code, Name string
	SeatsLimit *int
	MonthMinor *int64
}

// Draft is the body of publishPriceBookVersion (PriceBookVersionCreate).
type Draft struct {
	EffectiveFrom string // YYYY-MM-DD, Europe/Moscow
	Note          string
	Tiers         []DraftTier
	Terms         []Term
}

// Bounds of PriceBookVersionCreate and PriceTier.
const (
	maxTiers     = 12
	maxTierName  = 40
	maxNote      = 200
	maxMoney     = 1<<53 - 1
	maxDiscount  = 49
	dateLayout   = "2006-01-02"
	defaultNote  = "Изменение цен"
	termsMessage = "Сроки — 1, 4, 8 и 12 месяцев, каждый один раз"
)

// fixedTerms are the payment terms of every version.
var fixedTerms = []int{1, 4, 8, 12}

var tierCodeRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,30}$`)

// Check returns the violations of d at now in the order of the screen: the date, the note, every tier, the tiers as a
// whole, the terms (MSW pricing.ts publishChecks and the bounds of the schema).
func (d Draft) Check(now time.Time) []Violation {
	var out []Violation
	add := func(field, code, message string) {
		out = append(out, Violation{Field: field, Code: code, Message: message})
	}
	switch from, err := time.ParseInLocation(dateLayout, d.EffectiveFrom, msk); {
	case err != nil:
		add("effectiveFrom", "date", "Дата в формате ГГГГ-ММ-ДД")
	case !from.After(dayStart(now)):
		add("effectiveFrom", "future", "Дата начала — не раньше завтрашнего дня")
	}
	if utf8.RuneCountInString(d.Note) > maxNote {
		add("note", "length", "Не длиннее 200 символов")
	}
	out = append(out, checkTiers(d.Tiers)...)
	if !slices.ContainsFunc(d.Tiers, func(t DraftTier) bool { return t.MonthMinor != nil }) {
		add("tiers", "priced", "Нужна хотя бы одна ступень с ценой")
	}
	if len(d.Tiers) < 1 || len(d.Tiers) > maxTiers {
		add("tiers", "count", "От 1 до 12 ступеней")
	}
	months := make([]int, 0, len(d.Terms))
	for i, t := range d.Terms {
		months = append(months, t.Months)
		if t.DiscountPercent < 0 || t.DiscountPercent > maxDiscount {
			add(fmt.Sprintf("terms[%d].discountPercent", i), "range", "Скидка от 0 до 49%")
		}
	}
	slices.Sort(months)
	if !slices.Equal(months, fixedTerms) {
		add("terms", "terms", termsMessage)
	}
	return out
}

// checkTiers checks every tier: a non-blank unique name of up to 40 characters, a unique code of the pattern, seats and
// price both set (the unlimited tier — both null, only the last), each growing strictly from the previous tier.
func checkTiers(tiers []DraftTier) []Violation {
	var out []Violation
	names, codes := map[string]bool{}, map[string]bool{}
	for i, t := range tiers {
		at := "tiers[" + strconv.Itoa(i) + "]"
		add := func(field, code, message string) {
			out = append(out, Violation{Field: at + "." + field, Code: code, Message: message})
		}
		name := strings.ToLower(strings.TrimSpace(t.Name))
		switch {
		case name == "":
			add("name", "required", "Укажите название")
		case utf8.RuneCountInString(strings.TrimSpace(t.Name)) > maxTierName:
			add("name", "length", "Не длиннее 40 символов")
		case names[name]:
			add("name", "unique", "Название ступени повторяется")
		}
		names[name] = true
		if t.Code != "" {
			switch {
			case !tierCodeRE.MatchString(t.Code):
				add("code", "pattern", "Код — латинские строчные буквы, цифры и «_»")
			case codes[t.Code]:
				add("code", "unique", "Код ступени повторяется")
			}
			codes[t.Code] = true
		}
		out = append(out, tierBounds(at, t, i == len(tiers)-1)...)
		if i > 0 {
			out = append(out, growth(at, tiers[i-1], t)...)
		}
	}
	return out
}

// tierBounds checks the seats and the price of one tier.
func tierBounds(at string, t DraftTier, last bool) []Violation {
	unlimited := t.SeatsLimit == nil
	switch {
	case unlimited != (t.MonthMinor == nil):
		return []Violation{{Field: at + ".seatsLimit", Code: "unlimited", Message: "У безлимитной ступени нет ни мест, ни цены"}}
	case unlimited && !last:
		return []Violation{{Field: at + ".seatsLimit", Code: "unlimited_last", Message: "Безлимитная ступень — только последняя"}}
	case unlimited:
		return nil
	case *t.SeatsLimit < 1:
		return []Violation{{Field: at + ".seatsLimit", Code: "range", Message: "Не меньше 1 места"}}
	case *t.MonthMinor < 1 || *t.MonthMinor > maxMoney:
		return []Violation{{Field: at + ".monthAmountMinor", Code: "range", Message: "Цена вне допустимого диапазона"}}
	}
	return nil
}

// growth checks that the seats and the price of t grow strictly from prev.
func growth(at string, prev, t DraftTier) []Violation {
	var out []Violation
	if prev.SeatsLimit != nil && t.SeatsLimit != nil && *t.SeatsLimit <= *prev.SeatsLimit {
		out = append(out, Violation{Field: at + ".seatsLimit", Code: "not_increasing", Message: "Мест должно быть больше, чем в предыдущей ступени"})
	}
	if prev.MonthMinor != nil && t.MonthMinor != nil && *t.MonthMinor <= *prev.MonthMinor {
		out = append(out, Violation{Field: at + ".monthAmountMinor", Code: "not_increasing", Message: "Цена должна расти от ступени к ступени"})
	}
	return out
}

// Version is d as version number (after Check): the start is 00:00 Europe/Moscow of the day; names and the note are
// trimmed, a blank note is «Изменение цен»; a new tier gets the code tier_<version>_<position>; the terms are sorted.
func (d Draft) Version(number int) Version {
	from, _ := time.ParseInLocation(dateLayout, d.EffectiveFrom, msk) // checked by Check
	v := Version{Number: number, EffectiveFrom: from.UTC(), Note: strings.TrimSpace(d.Note), Currency: Currency}
	if v.Note == "" {
		v.Note = defaultNote
	}
	for i, t := range d.Tiers {
		code := t.Code
		if code == "" {
			code = "tier_" + strconv.Itoa(number) + "_" + strconv.Itoa(i+1)
		}
		v.Tiers = append(v.Tiers, Tier{Code: code, Name: strings.TrimSpace(t.Name), SeatsLimit: t.SeatsLimit, MonthMinor: t.MonthMinor})
	}
	v.Terms = slices.Clone(d.Terms)
	slices.SortFunc(v.Terms, func(a, b Term) int { return a.Months - b.Months })
	return v
}

// EffectiveAt is when an approved change applies (MSW pricing.ts): an upgrade — more seats, the unlimited tier, or a
// tier from an unlimited one — at once; a downgrade at the end of the paid period, or at once without a period or
// after its end.
func EffectiveAt(fromSeats, toSeats *int, periodEnd *time.Time, now time.Time) time.Time {
	upgrade := toSeats == nil || fromSeats == nil || *toSeats > *fromSeats
	if upgrade || periodEnd == nil || !periodEnd.After(now) {
		return now
	}
	return *periodEnd
}

// PeriodEnd is the end of a paid period of months started at: the start of the Moscow day of at, months later
// (MSW mskDayPlusMonths; the overflow of a short month normalizes forward, as Date.UTC).
func PeriodEnd(at time.Time, months int) time.Time {
	day := dayStart(at).In(msk)
	return time.Date(day.Year(), day.Month()+time.Month(months), day.Day(), 0, 0, 0, 0, msk).UTC()
}

// dayStart is 00:00 Europe/Moscow of the day of t.
func dayStart(t time.Time) time.Time {
	l := t.In(msk)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, msk)
}

// Seats are the seats of a tenant (control view tenant_seat_usage, SeatUsage): Limit nil — the unlimited tier.
type Seats struct {
	Limit           *int
	Active, Invited int
}

// Used is the occupied seats: active and invited memberships.
func (s Seats) Used() int { return s.Active + s.Invited }

// Available is max(0, limit − used); nil without a limit.
func (s Seats) Available() *int {
	if s.Limit == nil {
		return nil
	}
	free := max(0, *s.Limit-s.Used())
	return &free
}
