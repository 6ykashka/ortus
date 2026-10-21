package main

// W4.60: the billing and the branding of the platform (control DB) as the MSW adapter of W4.07 projects
// design/ortus/mock-data.js baseSeed().platform: the price book v1 (archived) and v2 (in force), the terms of the paid
// periods, the request SR-12 of «Лотос», the branding versions (BRANDS), the usage snapshots and the note of the
// disabled operator. SR-9 of «Карго Сити» is not seeded: the tenant has no database and so no membership of its
// owner in the stand (subscription_change_requests.requested_by references memberships).

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
)

// Tier codes of the price book.
const (
	tierStart = "start"
	tierTeam  = "team"
)

// standardTerms are the payment terms of both versions.
var standardTerms = []billing.Term{{Months: 1}, {Months: 4, DiscountPercent: 5}, {Months: 8, DiscountPercent: 10}, {Months: 12, DiscountPercent: 20}}

func tier(code, name string, seats int, month int64) billing.Tier {
	return billing.Tier{Code: code, Name: name, SeatsLimit: &seats, MonthMinor: &month}
}

var unlimited = billing.Tier{Code: "unl", Name: "Безлимит"}

// priceVersions are the price book of the prototype (17-users-and-billing «Тарифная сетка», examples of
// listPriceBookVersions).
var priceVersions = []billing.Version{
	{
		Number: 1, EffectiveFrom: time.Date(2026, 5, 31, 21, 0, 0, 0, time.UTC), EffectiveUntil: new(time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC)),
		Note: "Стартовая сетка пилота", Currency: "RUB", Terms: standardTerms,
		Tiers: []billing.Tier{tier(tierStart, "Старт", 10, 350000), tier(tierTeam, "Команда", 25, 850000), tier("biz", "Бизнес", 50, 1490000), unlimited},
	},
	{
		Number: 2, EffectiveFrom: time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC),
		Note: "Добавлена ступень «Сеть» до 100 мест, пересчитаны цены", Currency: "RUB", Terms: standardTerms,
		Tiers: []billing.Tier{
			tier(tierStart, "Старт", 10, 390000), tier(tierTeam, "Команда", 25, 890000), tier("biz", "Бизнес", 50, 1590000),
			tier("net", "Сеть", 100, 2790000), unlimited,
		},
	},
}

// priceVersionOf is the version number of the price book.
func priceVersionOf(number int) billing.Version {
	for _, v := range priceVersions {
		if v.Number == number {
			return v
		}
	}
	panic(fmt.Sprintf("seed: no price book version %d", number)) // fixed data
}

// publisher is the operator who published the price book versions (Евгения Лаптева).
const publisher = "op-1"

// termsDef are the terms of the paid period of a subscription (TenantPlan of the prototype: tier, term, version).
type termsDef struct {
	tenant, tier    string
	months, version int
	paid            bool // a paid period: its amount is the quote of the tier and the term (a trial has none)
}

// amount is the amount of the paid period (nil for a trial).
func (d termsDef) amount() *int64 {
	if !d.paid {
		return nil
	}
	q, ok := billing.QuoteOf(priceVersionOf(d.version), d.tier, d.months)
	if !ok {
		panic("seed: no quote for " + d.tenant) // fixed data
	}
	return &q.PeriodMinor
}

var subscriptionTerms = []termsDef{
	{tenant: protoAlta, tier: tierStart, months: 1, version: 2},
	{tenant: protoLotos, tier: tierTeam, months: 12, version: 1, paid: true},
	{tenant: protoRemstroy, tier: tierStart, months: 1, version: 1},
	{tenant: protoCargo, tier: tierTeam, months: 4, version: 1, paid: true},
}

// requestDef is a tier request of the prototype.
type requestDef struct {
	number, tenant, from, to string
	months, version          int
	seatsUsed                int
	comment                  string
	at                       time.Time
	owner                    string // the account of the owner who sent it
}

// id is the id of the MSW adapter (seedUuid('platform', 'subscription-request:SR-N')).
func (r requestDef) id() uuid.UUID { return seedID(scopePlatform, "subscription-request:"+r.number) }

var requestDefs = []requestDef{{
	number: "SR-12", tenant: protoLotos, from: tierTeam, to: "biz", months: 12, version: 1, seatsUsed: 23,
	comment: "Открываем второй салон, нужно ещё 10–12 мест", at: time.Date(2026, 9, 29, 13, 40, 0, 0, time.UTC), owner: "acc-11",
}}

// lastRequestNumber is the number of the last request of the prototype: the next one is SR-13.
const lastRequestNumber = 12

// brandDef is a saved branding version of the prototype (BRANDS of the MSW domain).
type brandDef struct {
	tenant, short, accent string
	version               int
	poweredBy             bool
	terms                 map[string]branding.Term
	at, author            string // «DD.MM HH:MM» MSK; the account of the owner
	member                bool   // the author has a membership in the stand (its tenant has a database)
}

var brandDefs = []brandDef{
	{
		tenant: protoLotos, short: "Лотос", accent: "#7A3E79", version: 3, poweredBy: true, at: "24.09 12:10", author: "acc-11", member: true,
		terms: map[string]branding.Term{"visit": {One: "сеанс", Plural: "сеансы", Few: "сеанса", Many: "сеансов"}},
	},
	// The prototype keeps «Ремстрой» on version 1 without an author; a stored version has one: its owner, on the day
	// the trial began.
	{tenant: protoRemstroy, short: "Ремстрой", accent: "#9A4A1F", version: 1, poweredBy: true, at: "06.09 10:00", author: "acc-12"},
	{tenant: protoCargo, short: "Карго", accent: "#2B5479", version: 2, at: "02.06 09:40", author: "acc-13"},
}

// usageDef is the latest usage snapshot of a tenant (usedGb and seats of the prototype).
type usageDef struct {
	tenant                         string
	seatsUsed, seatsLimit          int
	usedBytes, quotaGiB            int64
	activeMembers, activeMembers7d int
}

var usageDefs = []usageDef{
	{protoAlta, 9, 10, 49606872269, 100, 7, 7},
	{protoLotos, 23, 25, 13314398618, 50, 23, 12},
	{protoRemstroy, 5, 10, 21260088115, 25, 5, 2},
	{protoCargo, 22, 25, 67645734912, 100, 22, 0},
}

// usageDay is the day of the snapshots (the prototype measures on 01.10.2026).
var usageDay = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)

// disabledNotes are the notes of the disabled operators.
var disabledNotes = map[string]string{"op-6": "Отключён 15.08: перевод в другой отдел"}

// seedBilling writes the price book, the terms, the requests, the branding, the snapshots and the operator notes;
// rows already in the database are kept.
func seedBilling(ctx context.Context, tx *sql.Tx) error {
	for _, step := range []func(context.Context, *sql.Tx) error{seedPriceBook, seedTerms, seedRequests, seedBrands, seedUsage, seedOperatorNotes} {
		if err := step(ctx, tx); err != nil {
			return err
		}
	}
	return nil
}

func seedPriceBook(ctx context.Context, tx *sql.Tx) error {
	by := seedID(scopePlatform, publisher)
	for _, v := range priceVersions {
		if _, err := tx.ExecContext(ctx, `insert into price_book_versions (version, effective, note, published_by, published_at)
values ($1, tstzrange($2, $3), $4, $5, $2) on conflict (version) do nothing`, v.Number, v.EffectiveFrom, v.EffectiveUntil, v.Note, by); err != nil {
			return fmt.Errorf("price book v%d: %w", v.Number, err)
		}
		for i, t := range v.Tiers {
			if _, err := tx.ExecContext(ctx, `insert into price_tiers (version, tier_code, name, seats_limit, month_minor, currency, sort)
values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`, v.Number, t.Code, t.Name, t.SeatsLimit, t.MonthMinor, v.Currency, i+1); err != nil {
				return fmt.Errorf("price book v%d tier %s: %w", v.Number, t.Code, err)
			}
		}
		for _, t := range v.Terms {
			if _, err := tx.ExecContext(ctx, `insert into price_terms (version, months, discount_pct) values ($1, $2, $3) on conflict do nothing`,
				v.Number, t.Months, t.DiscountPercent); err != nil {
				return fmt.Errorf("price book v%d term %d: %w", v.Number, t.Months, err)
			}
		}
	}
	return nil
}

// seedTerms sets the terms of the subscriptions that have none yet (a changed subscription keeps its own).
func seedTerms(ctx context.Context, tx *sql.Tx) error {
	for _, d := range subscriptionTerms {
		if _, err := tx.ExecContext(ctx, `update subscriptions set tier_code = $2, term_months = $3, price_version = $4, amount_minor = $5
 where tenant_id = $1 and price_version is null`, seedID(scopePlatform, d.tenant), d.tier, d.months, d.version, d.amount()); err != nil {
			return fmt.Errorf("terms %s: %w", d.tenant, err)
		}
	}
	return nil
}

func seedRequests(ctx context.Context, tx *sql.Tx) error {
	for _, r := range requestDefs {
		q, ok := billing.QuoteOf(priceVersionOf(r.version), r.to, r.months)
		if !ok {
			return fmt.Errorf("request %s: no quote", r.number)
		}
		if _, err := tx.ExecContext(ctx, `insert into subscription_change_requests (id, number, tenant_id, from_tier, to_tier, term_months,
  price_version, quoted_minor, monthly_minor, saving_minor, discount_pct, seats_used, comment, requested_by, requested_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) on conflict (id) do nothing`,
			r.id(), r.number, seedID(scopePlatform, r.tenant), r.from, r.to, r.months, r.version, q.PeriodMinor, q.MonthlyMinor, q.SavingMinor,
			q.DiscountPercent, r.seatsUsed, r.comment, seedID(scopePlatform, "membership:"+r.tenant+":"+r.owner), r.at); err != nil {
			return fmt.Errorf("request %s: %w", r.number, err)
		}
	}
	// The next request of the stand is SR-13; a sequence that went further stays where it is.
	if _, err := tx.ExecContext(ctx, `select setval('subscription_request_number_seq', greatest($1::bigint,
  (select case when is_called then last_value else last_value - 1 end from subscription_request_number_seq)))`, lastRequestNumber); err != nil {
		return fmt.Errorf("request numbers: %w", err)
	}
	return nil
}

func seedBrands(ctx context.Context, tx *sql.Tx) error {
	for _, b := range brandDefs {
		terms, err := json.Marshal(brandTerms(b.terms))
		if err != nil {
			return err
		}
		var member *uuid.UUID
		if b.member {
			member = new(seedID(scopePlatform, "membership:"+b.tenant+":"+b.author))
		}
		if _, err := tx.ExecContext(ctx, `insert into tenant_branding_versions (tenant_id, version, display_name, short_name, accent_hex, accent_used,
  terms, menu, powered_by, created_by, created_by_account, created_at)
select t.id, $2, t.display_name, $3, $4, $5, $6::jsonb, '{"items": {}, "order": []}'::jsonb, $7, $8, $9, $10 from tenants t where t.id = $1
on conflict (tenant_id, version) do nothing`, seedID(scopePlatform, b.tenant), b.version, b.short, b.accent, branding.FixAccent(b.accent),
			string(terms), b.poweredBy, member, seedID(scopePlatform, b.author), protoTime(b.at)); err != nil {
			return fmt.Errorf("branding %s: %w", b.tenant, err)
		}
	}
	return nil
}

// brandTerms are the terms as tenant_branding_versions.terms stores them.
func brandTerms(terms map[string]branding.Term) map[string]map[string]string {
	out := make(map[string]map[string]string, len(terms))
	for k, t := range terms {
		out[k] = map[string]string{"one": t.One, "plural": t.Plural, "few": t.Few, "many": t.Many}
	}
	return out
}

func seedUsage(ctx context.Context, tx *sql.Tx) error {
	for _, u := range usageDefs {
		if _, err := tx.ExecContext(ctx, `insert into tenant_usage_daily (tenant_id, day, seats_used, seats_limit, storage_used_bytes,
  storage_quota_bytes, active_members, active_members_7d, measured_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict do nothing`, seedID(scopePlatform, u.tenant), usageDay, u.seatsUsed, u.seatsLimit,
			u.usedBytes, u.quotaGiB<<30, u.activeMembers, u.activeMembers7d, usageDay.Add(7*time.Hour+30*time.Minute)); err != nil {
			return fmt.Errorf("usage %s: %w", u.tenant, err)
		}
	}
	return nil
}

func seedOperatorNotes(ctx context.Context, tx *sql.Tx) error {
	for proto, note := range disabledNotes {
		if _, err := tx.ExecContext(ctx, `update platform_operators set disabled_reason = $2 where id = $1 and disabled_reason is null`,
			seedID(scopePlatform, proto), note); err != nil {
			return fmt.Errorf("operator note %s: %w", proto, err)
		}
	}
	return nil
}
