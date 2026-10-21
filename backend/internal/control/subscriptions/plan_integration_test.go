//go:build integration

package subscriptions

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

// priceBook writes version 2 of the price book (start, team, unl) published by an operator of the stand.
func (s *stand) priceBook() {
	s.t.Helper()
	account, operator := uuid.New(), uuid.New()
	s.exec(`insert into accounts (id, issuer, subject, email_norm, display_name) values ($1, 'urn:test', $2, 'op@ortus.example', 'Оператор')`, account, account.String())
	s.exec(`insert into platform_operators (id, account_id, role, status) values ($1, $2, 'owner', 'active')`, operator, account)
	s.exec(`insert into price_book_versions (version, effective, note, published_by) values (2, tstzrange($1, null), 'v2', $2)`,
		trialEnd.Add(-30*day), operator)
	s.exec(`insert into price_tiers (version, tier_code, name, seats_limit, month_minor, sort) values
		(2, 'start', 'Старт', 10, 390000, 1), (2, 'team', 'Команда', 25, 890000, 2)`)
	s.exec(`insert into price_tiers (version, tier_code, name, sort) values (2, 'unl', 'Безлимит', 3)`)
}

// change runs ChangePlan in its own transaction under the lock of Locked.
func (s *stand) change(id uuid.UUID, c PlanChange) (Subscription, Subscription, error) {
	s.t.Helper()
	tx, err := s.store.DB.BeginTx(s.t.Context(), nil)
	if err != nil {
		s.t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	cur, err := s.store.Locked(s.t.Context(), tx, id)
	if err != nil {
		return Subscription{}, Subscription{}, err
	}
	next, err := s.store.ChangePlan(s.t.Context(), tx, id, c)
	if err != nil {
		return cur, Subscription{}, err
	}
	return cur, next, tx.Commit()
}

func eqPlan[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

func deref[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}

// planView is what ChangePlan changes in a subscription.
type planView struct {
	Plan, Status  string
	PeriodEnd     time.Time
	Revision      int64
	Term, Version int
	Amount        int64
	Entitlements  []Entitlement
}

func planViewOf(s Subscription) planView {
	ents := make([]Entitlement, 0, len(s.Entitlements))
	for _, e := range s.Entitlements {
		if e.ValidUntil != nil {
			e.ValidUntil = new(e.ValidUntil.UTC())
		}
		ents = append(ents, e)
	}
	return planView{s.PlanKey, s.Status, deref(s.PeriodEndsAt), s.Revision, deref(s.TermMonths), deref(s.PriceVersion), deref(s.AmountMinor), ents}
}

// W4.60: одобренная заявка меняет тариф — подписка active с условиями периода (тариф, срок, версия цен, сумма),
// новая версия прав мест и квоты (квота — из истории плана), ручные права, которые ещё действуют, остаются;
// пробная организация становится active, revision + 1.
func TestChangePlan(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.priceBook()
	id := s.tenant("trial", trialEnd.Add(-TrialDays*day), "start")
	manual := Entitlement{Key: "module.fleet", SourceType: SourceManual, SourceRef: "SUP-1", Value: 1, ValidUntil: new(trialEnd.Add(90 * day))}
	if _, err := s.store.Update(t.Context(), id, Update{PlanKey: "start", Status: StatusTrialing, Reason: "Ручное право", Manual: []Entitlement{manual}}, 1, uuid.New()); err != nil {
		t.Fatal(err)
	}
	end := trialEnd.Add(365 * day)
	cur, next, err := s.change(id, PlanChange{
		Tier: "team", Seats: 25, TermMonths: 12, PriceVersion: 2, AmountMinor: new(int64(8544000)), PeriodEndsAt: end,
		Reason: "Заявка SR-13", Actor: uuid.New(),
	})
	if err != nil {
		t.Fatal(err)
	}
	eqPlan(t, "locked", [2]any{cur.Status, cur.Revision}, [2]any{StatusTrialing, int64(2)})
	want := planView{
		Plan: "team", Status: StatusActive, PeriodEnd: end, Revision: 3, Term: 12, Version: 2, Amount: 8544000,
		Entitlements: []Entitlement{
			{Key: KeySeats, SourceType: SourcePlan, SourceRef: "price-book:v2:team", Value: 25},
			{Key: KeyStorageQuota, SourceType: SourcePlan, SourceRef: "price-book:v2:team", Value: DefaultQuotaBytes},
			manual,
		},
	}
	eqPlan(t, "next", planViewOf(next), want)
	got, err := s.store.Current(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	eqPlan(t, "read back", planViewOf(got), want)
	eqPlan(t, "tenant and tier", [2]string{s.one(`select state::text from tenants where id = $1`, id), s.one(`select tier_code from subscriptions where tenant_id = $1`, id)},
		[2]string{"active", "team"})
}

// W4.60, возврат 2: условия периода пишутся в текущую строку подписки, а не во все строки организации — прежняя
// (историческая) строка сохраняет свой тариф, срок и сумму.
func TestChangePlanKeepsHistoricalRows(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.priceBook()
	id := s.tenant("active", trialEnd.Add(-400*day), "start")
	old := uuid.New()
	s.exec(`insert into subscriptions (id, tenant_id, plan_code, state, period, created_at, tier_code, term_months, price_version, amount_minor)
		values ($1, $2, 'start', 'ended', tstzrange($3, $4, '[]'), $3, 'start', 1, 2, 390000)`, old, id, trialEnd.Add(-400*day), trialEnd.Add(-370*day))
	s.exec(`insert into subscriptions (tenant_id, plan_code, state, period, created_at, tier_code, term_months, price_version, amount_minor)
		values ($1, 'start', 'active', tstzrange($2, $3, '[]'), $2, 'start', 1, 2, 390000)`, id, trialEnd.Add(-10*day), trialEnd.Add(20*day))
	if _, _, err := s.change(id, PlanChange{Tier: "team", Seats: 25, TermMonths: 12, PriceVersion: 2, AmountMinor: new(int64(8544000)),
		PeriodEndsAt: trialEnd.Add(365 * day), Reason: "Заявка SR-14", Actor: uuid.New()}); err != nil {
		t.Fatal(err)
	}
	eqPlan(t, "historical row", s.one(`select concat_ws('/', tier_code, term_months, amount_minor) from subscriptions where id = $1`, old),
		"start/1/390000")
	eqPlan(t, "current row", s.one(`select concat_ws('/', tier_code, term_months, amount_minor) from subscriptions where tenant_id = $1 and id <> $2`, id, old),
		"team/12/8544000")
}

// Приостановленная организация остаётся приостановленной (её возвращает оператор), подписка — active; безлимит —
// место-«безлимит» и без суммы; read_only после пробного периода становится active.
func TestChangePlanStates(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.priceBook()
	suspended := s.tenant("suspended", trialEnd.Add(-60*day), "team")
	_, next, err := s.change(suspended, PlanChange{Tier: "unl", Seats: UnlimitedSeats, TermMonths: 4, PriceVersion: 2, PeriodEndsAt: trialEnd, Reason: "SR", Actor: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	eqPlan(t, "unlimited", [3]any{next.Status, next.AmountMinor == nil, next.Entitlements[0].Value}, [3]any{StatusActive, true, int64(UnlimitedSeats)})
	eqPlan(t, "suspended tenant", s.one(`select state::text from tenants where id = $1`, suspended), "suspended")
	readOnly := s.tenant("read_only", trialEnd.Add(-60*day), "start")
	if _, _, err := s.change(readOnly, PlanChange{Tier: "start", Seats: 10, TermMonths: 1, PriceVersion: 2, PeriodEndsAt: trialEnd, Reason: "SR", Actor: uuid.New()}); err != nil {
		t.Fatal(err)
	}
	eqPlan(t, "read_only tenant", s.one(`select state::text from tenants where id = $1`, readOnly), "active")
	_, _, err = s.change(uuid.New(), PlanChange{Tier: "start", Seats: 10, TermMonths: 1, PriceVersion: 2, PeriodEndsAt: trialEnd})
	eqPlan(t, "unknown tenant", errors.Is(err, ErrUnknownTenant), true)
	// Тариф вне версии цен — отказ базы (FK subscriptions_tier_fk), ничего не меняется.
	id := s.tenant("trial", trialEnd.Add(-day), "start")
	_, _, err = s.change(id, PlanChange{Tier: "net", Seats: 100, TermMonths: 1, PriceVersion: 2, PeriodEndsAt: trialEnd, Reason: "SR", Actor: uuid.New()})
	eqPlan(t, "a tier outside the version fails", err != nil, true)
	eqPlan(t, "rolled back", s.one(`select count(*)::text from subscriptions where tenant_id = $1`, id), "0")
}
