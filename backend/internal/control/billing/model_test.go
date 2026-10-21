package billing

import (
	"slices"
	"testing"
	"time"
)

var seedNow = time.Date(2026, time.October, 1, 10, 30, 0, 0, time.FixedZone("MSK", 3*60*60)).UTC() // «сейчас» сида W0.12

// v1 и v2 — версии сетки сида (domain modules/platform/seed.ts priceVersions).
func v1() Version {
	return Version{
		Number: 1, EffectiveFrom: time.Date(2026, 5, 31, 21, 0, 0, 0, time.UTC), EffectiveUntil: new(time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC)),
		Note: "Стартовая сетка пилота", Currency: Currency,
		Tiers: []Tier{
			{Code: "start", Name: "Старт", SeatsLimit: new(10), MonthMinor: new(int64(350000))},
			{Code: "team", Name: "Команда", SeatsLimit: new(25), MonthMinor: new(int64(850000))},
			{Code: "biz", Name: "Бизнес", SeatsLimit: new(50), MonthMinor: new(int64(1490000))},
			{Code: "unl", Name: "Безлимит"},
		},
		Terms: seedTerms(),
	}
}

func v2() Version {
	return Version{
		Number: 2, EffectiveFrom: time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC),
		Note: "Добавлена ступень «Сеть» до 100 мест, пересчитаны цены", Currency: Currency,
		Tiers: []Tier{
			{Code: "start", Name: "Старт", SeatsLimit: new(10), MonthMinor: new(int64(390000))},
			{Code: "team", Name: "Команда", SeatsLimit: new(25), MonthMinor: new(int64(890000))},
			{Code: "biz", Name: "Бизнес", SeatsLimit: new(50), MonthMinor: new(int64(1590000))},
			{Code: "net", Name: "Сеть", SeatsLimit: new(100), MonthMinor: new(int64(2790000))},
			{Code: "unl", Name: "Безлимит"},
		},
		Terms: seedTerms(),
	}
}

func seedTerms() []Term {
	return []Term{{Months: 1, DiscountPercent: 0}, {Months: 4, DiscountPercent: 5}, {Months: 8, DiscountPercent: 10}, {Months: 12, DiscountPercent: 20}}
}

// PriceTerm: месяц со скидкой — до целых рублей, период — месяц × срок, выгода — (база − месяц) × срок; безлимит без
// цены не считается. Числа — заявки SR-12, SR-13, SR-9 примеров контракта.
func TestQuote(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		v      Version
		tier   string
		months int
		want   Quote
		ok     bool
	}{
		"SR-12: v1 «Бизнес» на 12 месяцев":  {v1(), "biz", 12, Quote{MonthlyMinor: 1192000, PeriodMinor: 14304000, SavingMinor: 3576000, DiscountPercent: 20}, true},
		"SR-13: v2 «Команда» на 12 месяцев": {v2(), "team", 12, Quote{MonthlyMinor: 712000, PeriodMinor: 8544000, SavingMinor: 2136000, DiscountPercent: 20}, true},
		"SR-9: v1 «Команда» на 4 месяца":    {v1(), "team", 4, Quote{MonthlyMinor: 807500, PeriodMinor: 3230000, SavingMinor: 170000, DiscountPercent: 5}, true},
		"месяц без скидки":                  {v2(), "start", 1, Quote{MonthlyMinor: 390000, PeriodMinor: 390000, DiscountPercent: 0}, true},
		"«Лотос»: v1 «Команда» на 12":       {v1(), "team", 12, Quote{MonthlyMinor: 680000, PeriodMinor: 8160000, SavingMinor: 2040000, DiscountPercent: 20}, true},
		"безлимит — индивидуально":          {v2(), "unl", 12, Quote{}, false},
		"нет ступени":                       {v1(), "net", 12, Quote{}, false},
		"нет срока":                         {v2(), "team", 6, Quote{}, false},
	} {
		got, ok := QuoteOf(c.v, c.tier, c.months)
		if got != c.want || ok != c.ok {
			t.Errorf("%s: %+v %v, want %+v %v", name, got, ok, c.want, c.ok)
		}
	}
	// Округление до целого рубля — половина вверх: 333 333 копеек × 95% = 316 666,35 → 316 700.
	v := v2()
	v.Tiers[0].MonthMinor = new(int64(333333))
	if got, _ := QuoteOf(v, "start", 4); got.MonthlyMinor != 316700 {
		t.Errorf("rounding: %d", got.MonthlyMinor)
	}
}

// Состояние версии: отменённая, запланированная (начало в будущем), архивная (конец прошёл), действующая.
func TestVersionState(t *testing.T) {
	t.Parallel()
	scheduled := v2()
	scheduled.Number, scheduled.EffectiveFrom = 3, time.Date(2026, 10, 31, 21, 0, 0, 0, time.UTC)
	cancelled := scheduled
	cancelled.CancelledAt = new(seedNow)
	for name, c := range map[string]struct {
		v    Version
		want string
	}{
		"v1 в архиве":         {v1(), StateArchived},
		"v2 действует":        {v2(), StateCurrent},
		"v3 запланирована":    {scheduled, StateScheduled},
		"отменённая v3":       {cancelled, StateCancelled},
		"конец ровно сейчас":  {Version{EffectiveFrom: seedNow.Add(-time.Hour), EffectiveUntil: new(seedNow)}, StateArchived},
		"начало ровно сейчас": {Version{EffectiveFrom: seedNow}, StateCurrent},
	} {
		if got := c.v.State(seedNow); got != c.want {
			t.Errorf("%s: %s, want %s", name, got, c.want)
		}
	}
}

func draft() Draft {
	return Draft{
		EffectiveFrom: "2026-11-01", Note: "Скидка за 12 месяцев — 25%",
		Tiers: []DraftTier{
			{Code: "start", Name: "Старт", SeatsLimit: new(10), MonthMinor: new(int64(390000))},
			{Code: "team", Name: "Команда", SeatsLimit: new(25), MonthMinor: new(int64(890000))},
			{Name: "Безлимит"},
		},
		Terms: []Term{{Months: 12, DiscountPercent: 25}, {Months: 1}, {Months: 4, DiscountPercent: 5}, {Months: 8, DiscountPercent: 10}},
	}
}

func fieldsOf(vs []Violation) []string {
	out := make([]string, 0, len(vs))
	for _, v := range vs {
		out = append(out, v.Field+":"+v.Code)
	}
	return out
}

// Проверки черновика сетки (publishPriceBookVersion, MSW pricing.ts publishChecks): поля — пути вида tiers[1].name,
// тексты — эталона.
func TestDraftChecks(t *testing.T) {
	t.Parallel()
	if vs := draft().Check(seedNow); len(vs) != 0 {
		t.Fatalf("valid draft: %v", fieldsOf(vs))
	}
	for name, c := range map[string]struct {
		edit func(*Draft)
		want []string
	}{
		"цена не растёт (пример контракта)": {func(d *Draft) { d.Tiers[1].MonthMinor = new(int64(390000)) }, []string{"tiers[1].monthAmountMinor:not_increasing"}},
		"мест не больше":                    {func(d *Draft) { d.Tiers[1].SeatsLimit = new(10) }, []string{"tiers[1].seatsLimit:not_increasing"}},
		"пустое название":                   {func(d *Draft) { d.Tiers[0].Name = "  " }, []string{"tiers[0].name:required"}},
		"название повторяется без регистра": {func(d *Draft) { d.Tiers[1].Name = "старт" }, []string{"tiers[1].name:unique"}},
		"название длиннее 40":               {func(d *Draft) { d.Tiers[0].Name = string(make([]rune, 41)) }, []string{"tiers[0].name:length"}},
		"код повторяется":                   {func(d *Draft) { d.Tiers[1].Code = "start" }, []string{"tiers[1].code:unique"}},
		"код не по шаблону":                 {func(d *Draft) { d.Tiers[1].Code = "Team" }, []string{"tiers[1].code:pattern"}},
		"безлимит не последний": {func(d *Draft) {
			d.Tiers = []DraftTier{{Name: "Безлимит"}, {Name: "Старт", SeatsLimit: new(10), MonthMinor: new(int64(1))}}
		}, []string{"tiers[0].seatsLimit:unlimited_last"}},
		"места без цены":       {func(d *Draft) { d.Tiers[1].MonthMinor = nil }, []string{"tiers[1].seatsLimit:unlimited"}},
		"нет ступени с ценой":  {func(d *Draft) { d.Tiers = []DraftTier{{Name: "Безлимит"}} }, []string{"tiers:priced"}},
		"нет ступеней":         {func(d *Draft) { d.Tiers = nil }, []string{"tiers:priced", "tiers:count"}},
		"сроки не 1, 4, 8, 12": {func(d *Draft) { d.Terms[0].Months = 6 }, []string{"terms:terms"}},
		"срок дважды":          {func(d *Draft) { d.Terms[0].Months = 1 }, []string{"terms:terms"}},
		"скидка 50%":           {func(d *Draft) { d.Terms[0].DiscountPercent = 50 }, []string{"terms[0].discountPercent:range"}},
		"дата сегодня":         {func(d *Draft) { d.EffectiveFrom = "2026-10-01" }, []string{"effectiveFrom:future"}},
		"дата не дата":         {func(d *Draft) { d.EffectiveFrom = "01.11.2026" }, []string{"effectiveFrom:date"}},
		"заметка длиннее 200":  {func(d *Draft) { d.Note = string(make([]rune, 201)) }, []string{"note:length"}},
		"места меньше 1":       {func(d *Draft) { d.Tiers[0].SeatsLimit = new(0) }, []string{"tiers[0].seatsLimit:range"}},
		"цена больше 2^53 − 1": {func(d *Draft) { d.Tiers[1].MonthMinor = new(int64(1) << 53) }, []string{"tiers[1].monthAmountMinor:range"}},
		"больше 12 ступеней":   {func(d *Draft) { d.Tiers = manyTiers(13) }, []string{"tiers:count"}},
	} {
		d := draft()
		c.edit(&d)
		if got := fieldsOf(d.Check(seedNow)); !slices.Equal(got, c.want) {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
	// Тексты эталона.
	d := draft()
	d.Tiers[1].MonthMinor = new(int64(390000))
	if vs := d.Check(seedNow); len(vs) != 1 || vs[0].Message != "Цена должна расти от ступени к ступени" {
		t.Errorf("message: %+v", vs)
	}
}

func manyTiers(n int) []DraftTier {
	out := make([]DraftTier, 0, n)
	for i := range n {
		out = append(out, DraftTier{Name: "Ступень " + string(rune('A'+i)), SeatsLimit: new(i + 1), MonthMinor: new(int64(i + 1))})
	}
	return out
}

// Начало версии — 00:00 по Москве выбранного дня; новые ступени без кода получают tier_<версия>_<номер>, имена и
// заметка — без пробелов по краям, пустая заметка — «Изменение цен», сроки — по возрастанию.
func TestDraftVersion(t *testing.T) {
	t.Parallel()
	d := draft()
	d.Note = "  "
	d.Tiers[0].Name = " Старт "
	v := d.Version(3)
	if !v.EffectiveFrom.Equal(time.Date(2026, 10, 31, 21, 0, 0, 0, time.UTC)) || v.Note != "Изменение цен" || v.Currency != Currency {
		t.Errorf("version: %+v", v)
	}
	codes := []string{}
	for _, tier := range v.Tiers {
		codes = append(codes, tier.Code+"/"+tier.Name)
	}
	if !slices.Equal(codes, []string{"start/Старт", "team/Команда", "tier_3_3/Безлимит"}) {
		t.Errorf("tiers: %v", codes)
	}
	if len(v.Terms) != 4 || v.Terms[0].Months != 1 || v.Terms[3].Months != 12 || v.Terms[3].DiscountPercent != 25 {
		t.Errorf("terms: %+v", v.Terms)
	}
}

// Повышение (больше мест или безлимит) применяется при одобрении, понижение — с конца оплаченного периода; без
// периода или после его конца — сразу (MSW pricing.ts).
func TestEffectiveAt(t *testing.T) {
	t.Parallel()
	end := seedNow.AddDate(0, 3, 0)
	past := seedNow.Add(-time.Hour)
	for name, c := range map[string]struct {
		from, to *int
		period   *time.Time
		want     time.Time
	}{
		"25 → 50: сразу":              {new(25), new(50), &end, seedNow},
		"25 → безлимит: сразу":        {new(25), nil, &end, seedNow},
		"безлимит → 25: сразу (MSW)":  {nil, new(25), &end, seedNow},
		"50 → 25: с конца периода":    {new(50), new(25), &end, end},
		"25 → 25: с конца периода":    {new(25), new(25), &end, end},
		"50 → 25 без периода: сразу":  {new(50), new(25), nil, seedNow},
		"50 → 25 после конца: сразу":  {new(50), new(25), &past, seedNow},
		"50 → 25, конец ровно сейчас": {new(50), new(25), &seedNow, seedNow},
	} {
		if got := EffectiveAt(c.from, c.to, c.period, seedNow); !got.Equal(c.want) {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
}

// Конец оплаченного периода — начало московских суток момента одобрения + срок (MSW mskDayPlusMonths).
func TestPeriodEnd(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		at     time.Time
		months int
		want   time.Time
	}{
		"01.10 10:30 + 12": {seedNow, 12, time.Date(2027, 9, 30, 21, 0, 0, 0, time.UTC)},
		"01.10 01:00 МСК (30.09 UTC) + 1": {time.Date(2026, 9, 30, 22, 0, 0, 0, time.UTC), 1,
			time.Date(2026, 10, 31, 21, 0, 0, 0, time.UTC)},
		"31.01 + 1 → 03.03 (как Date.UTC)": {time.Date(2027, 1, 31, 9, 0, 0, 0, time.UTC), 1, time.Date(2027, 3, 2, 21, 0, 0, 0, time.UTC)},
	} {
		if got := PeriodEnd(c.at, c.months); !got.Equal(c.want) {
			t.Errorf("%s: %v, want %v", name, got, c.want)
		}
	}
}

// Места: занято = активные + приглашённые; безлимит — limit и available null; свободно — не меньше 0.
func TestSeats(t *testing.T) {
	t.Parallel()
	s := Seats{Limit: new(10), Active: 7, Invited: 2}
	if s.Used() != 9 || s.Available() == nil || *s.Available() != 1 {
		t.Errorf("alta: used %d available %v", s.Used(), s.Available())
	}
	over := Seats{Limit: new(10), Active: 12}
	if a := over.Available(); a == nil || *a != 0 {
		t.Errorf("over the limit: %v", a)
	}
	if (Seats{Active: 3}).Available() != nil {
		t.Error("unlimited: available must be null")
	}
}
