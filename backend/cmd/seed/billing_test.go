package main

import (
	"reflect"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
)

func eqSeed(t *testing.T, what string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

// W4.60: заявка SR-12 сида — тот же id и расчёт, что в примерах listPlatformSubscriptionRequests (MSW W4.07); сумма
// оплаченного периода подписок — расчёт их ступени и срока по их версии сетки.
func TestSeedRequestsAndTerms(t *testing.T) {
	t.Parallel()
	sr := requestDefs[0]
	q, ok := billing.QuoteOf(priceVersionOf(sr.version), sr.to, sr.months)
	eqSeed(t, "SR-12", [4]any{sr.id().String(), sr.number, ok, q},
		[4]any{"d5748522-e6b8-5df4-8a9f-1cbdfef46ed3", "SR-12", true, billing.Quote{MonthlyMinor: 1192000, PeriodMinor: 14304000, SavingMinor: 3576000, DiscountPercent: 20}})
	amounts := map[string]any{}
	for _, s := range subscriptionTerms {
		amounts[s.tenant] = s.amount()
	}
	eqSeed(t, "amounts of the paid periods", amounts, map[string]any{
		protoAlta: (*int64)(nil), protoLotos: new(int64(8160000)), protoRemstroy: (*int64)(nil), protoCargo: new(int64(3230000)),
	})
}

// Оформление сида — как BRANDS прототипа: акцент уже контрастный (accent_used = accent), версии и знаки.
func TestSeedBrands(t *testing.T) {
	t.Parallel()
	got := map[string][4]any{}
	for _, b := range brandDefs {
		got[b.tenant] = [4]any{b.version, b.short, branding.FixAccent(b.accent), b.poweredBy}
	}
	eqSeed(t, "brands", got, map[string][4]any{
		protoLotos:    {3, "Лотос", "#7A3E79", true},
		protoRemstroy: {1, "Ремстрой", "#9A4A1F", true},
		protoCargo:    {2, "Карго", "#2B5479", false},
	})
}
