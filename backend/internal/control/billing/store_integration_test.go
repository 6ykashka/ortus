//go:build integration

package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

// world is a migrated control DB with the platform of the seed W0.12 in small: operators of every role, the price
// book v1 (01.06–01.10) and v2 (from 01.10), «Альта» (trial on «Старт» v2, 7 active and 2 invited members),
// «Лотос» (active on «Команда» v1 for 12 months, 23 members) and «Карго» (active on «Команда» v2 till +60 days,
// 5 members). The store works as ortus_api, setup and checks as the migrator.
type world struct {
	t                        *testing.T
	admin                    *sql.DB
	store                    Store
	now                      time.Time
	owner, billing, support  uuid.UUID // accounts of the operators
	ownerOp                  uuid.UUID // platform_operators.id of the owner
	alta, lotos, cargo       uuid.UUID
	zimina, belova, shishkin Owner
	cargoEnd                 time.Time
}

var now = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC) // 01.10 10:30 МСК

func newWorld(t *testing.T) *world {
	t.Helper()
	name := cluster.NewDatabase(t, "billing")
	admin := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), admin, migrations.Control); err != nil {
		t.Fatal(err)
	}
	w := &world{t: t, admin: admin, now: now}
	clock := func() time.Time { return w.now }
	api := cluster.DB(t, name, migrations.RoleAPI)
	w.store = Store{DB: api, Subs: subscriptions.Store{DB: api, Now: clock}, Now: clock}
	w.owner, w.ownerOp = w.operator("Евгения Лаптева", "owner")
	w.billing, _ = w.operator("Алёна Гусева", "billing")
	w.support, _ = w.operator("Игорь Пахомов", "support")
	w.priceBook()
	w.alta = w.tenant("Альта Групп", "trial")
	w.zimina = w.member(w.alta, "Дарья Зимина", "active", true)
	w.members(w.alta, "Сотрудник", "active", 6)
	w.members(w.alta, "Приглашённый", "invited", 2)
	w.subscription(w.alta, plan{tier: "start", state: "trial", from: w.now.Add(-2 * 24 * time.Hour), end: time.Date(2026, 10, 13, 21, 0, 0, 0, time.UTC),
		source: "trial", seats: 10, quotaGiB: 100, version: 2})
	w.lotos = w.tenant("SPA «Лотос»", "active")
	w.belova = w.member(w.lotos, "Ирина Белова", "active", true)
	w.members(w.lotos, "Мастер", "active", 22)
	w.subscription(w.lotos, plan{tier: "team", state: "active", from: time.Date(2026, 3, 31, 21, 0, 0, 0, time.UTC),
		end: time.Date(2027, 3, 31, 21, 0, 0, 0, time.UTC), source: "plan", seats: 25, quotaGiB: 50, version: 1, term: new(12), amount: new(int64(8160000))})
	w.cargo = w.tenant("Карго Сити", "active")
	w.shishkin = w.member(w.cargo, "Денис Шишкин", "active", true)
	w.members(w.cargo, "Водитель", "active", 4)
	w.cargoEnd = w.now.Add(60 * 24 * time.Hour)
	w.subscription(w.cargo, plan{tier: "team", state: "active", from: w.now.Add(-30 * 24 * time.Hour), end: w.cargoEnd, source: "plan",
		seats: 25, quotaGiB: 100, version: 2, term: new(4), amount: new(int64(3382000))})
	return w
}

func (w *world) exec(q string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.ExecContext(w.t.Context(), q, args...); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
}

func (w *world) one(q string, args ...any) string {
	w.t.Helper()
	var v sql.NullString
	if err := w.admin.QueryRowContext(w.t.Context(), q, args...).Scan(&v); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

func (w *world) account(name string) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.exec(`insert into accounts (id, issuer, subject, email_norm, display_name, last_login_at) values ($1, 'urn:test', $2, $3, $4, $5)`,
		id, id.String(), id.String()[:8]+"@test.example", name, w.now.Add(-time.Hour))
	return id
}

func (w *world) operator(name, role string) (uuid.UUID, uuid.UUID) {
	w.t.Helper()
	account, op := w.account(name), uuid.New()
	w.exec(`insert into platform_operators (id, account_id, role, status) values ($1, $2, $3, 'active')`, op, account, role)
	return account, op
}

func (w *world) priceBook() {
	w.t.Helper()
	w.exec(`insert into price_book_versions (version, effective, note, published_by) values
		(1, tstzrange('2026-05-31T21:00:00Z', '2026-09-30T21:00:00Z'), 'Стартовая сетка пилота', $1),
		(2, tstzrange('2026-09-30T21:00:00Z', null), 'Добавлена ступень «Сеть» до 100 мест, пересчитаны цены', $1)`, w.ownerOp)
	w.exec(`insert into price_tiers (version, tier_code, name, seats_limit, month_minor, sort) values
		(1, 'start', 'Старт', 10, 350000, 1), (1, 'team', 'Команда', 25, 850000, 2), (1, 'biz', 'Бизнес', 50, 1490000, 3),
		(2, 'start', 'Старт', 10, 390000, 1), (2, 'team', 'Команда', 25, 890000, 2), (2, 'biz', 'Бизнес', 50, 1590000, 3),
		(2, 'net', 'Сеть', 100, 2790000, 4)`)
	w.exec(`insert into price_tiers (version, tier_code, name, sort) values (1, 'unl', 'Безлимит', 4), (2, 'unl', 'Безлимит', 5)`)
	w.exec(`insert into price_terms (version, months, discount_pct) values
		(1, 1, 0), (1, 4, 5), (1, 8, 10), (1, 12, 20), (2, 1, 0), (2, 4, 5), (2, 8, 10), (2, 12, 20)`)
}

func (w *world) tenant(name, state string) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.exec(`insert into tenants (id, slug, display_name, industry_pack, state) values ($1, $2, $3, 'custom', $4::tenant_state)`,
		id, "t-"+id.String()[:8], name, state)
	return id
}

func (w *world) member(tenant uuid.UUID, name, status string, owner bool) Owner {
	w.t.Helper()
	account, membership := w.account(name), uuid.New()
	w.exec(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, $4::membership_status, $5)`,
		membership, tenant, account, status, uuid.New())
	if owner {
		w.exec(`insert into owner_bindings (tenant_id, membership_id) values ($1, $2)`, tenant, membership)
	}
	return Owner{TenantID: tenant, MembershipID: membership, AccountID: account}
}

func (w *world) members(tenant uuid.UUID, name, status string, n int) {
	w.t.Helper()
	for i := range n {
		w.member(tenant, fmt.Sprintf("%s %d", name, i), status, false)
	}
}

// plan is the stored subscription of a tenant of the world.
type plan struct {
	tier, state, source string
	from, end           time.Time
	seats, quotaGiB     int64
	version             int
	term                *int
	amount              *int64
}

func (w *world) subscription(tenant uuid.UUID, p plan) {
	w.t.Helper()
	w.exec(`insert into subscriptions (tenant_id, plan_code, state, period, tier_code, term_months, price_version, amount_minor)
		values ($1, $2, $3, tstzrange($4, $5, '[]'), $2, $6, $7, $8)`, tenant, p.tier, p.state, p.from, p.end, p.term, p.version, p.amount)
	ref := fmt.Sprintf("price-book:v%d:%s", p.version, p.tier)
	w.exec(`insert into entitlements (tenant_id, feature_key, source_type, source_ref, limit_value, limit_unit, effective, version, reason, actor_id)
		values ($1, 'seats', $2, $3, $4, 'seats', tstzrange($5, null), 1, 'test', $6),
		       ($1, 'storage_quota_bytes', $2, $3, $7, 'bytes', tstzrange($5, null), 1, 'test', $6)`,
		tenant, p.source, ref, p.seats, p.from, uuid.Nil, p.quotaGiB<<30)
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// refused checks that err is a RefusalError with code and (when not "") detail and returns it.
func refused(t *testing.T, err error, code, detail string) *RefusalError {
	t.Helper()
	r, ok := errors.AsType[*RefusalError](err)
	if !ok || r.Code != code || (detail != "" && r.Detail != detail) {
		t.Fatalf("err = %v, want %s %q", err, code, detail)
	}
	return r
}

func fieldsOfRefusal(r *RefusalError) []string {
	out := []string{}
	for _, v := range r.Violations {
		out = append(out, v.Field+":"+v.Code)
	}
	return out
}

func versionStates(vs []Version, at time.Time) []string {
	out := []string{}
	for _, v := range vs {
		out = append(out, fmt.Sprintf("v%d:%s", v.Number, v.State(at)))
	}
	return out
}

// Сетка: версии сверху вниз со состоянием и числом подписок оплаченного периода; сетка владельца — действующая и
// версия его оплаченного периода, если она другая.
func TestPriceBook(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	vs, err := w.store.Versions(t.Context(), false)
	must(t, err)
	eq(t, "versions", versionStates(vs, w.now), []string{"v2:current", "v1:archived"})
	type versionView struct {
		Subscriptions, Tiers int
		By                   string
		ByAccount            uuid.UUID
		LastTierUnlimited    bool
		LongTerm             Term
		Ended                bool
	}
	view := func(v Version) versionView {
		return versionView{
			Subscriptions: v.SubscriptionCount, Tiers: len(v.Tiers), By: v.PublishedBy.DisplayName, ByAccount: val(v.PublishedBy.AccountID),
			LastTierUnlimited: v.Tiers[len(v.Tiers)-1].SeatsLimit == nil, LongTerm: v.Terms[3], Ended: v.EffectiveUntil != nil,
		}
	}
	eq(t, "v2", view(vs[0]), versionView{2, 5, "Евгения Лаптева", w.owner, true, Term{Months: 12, DiscountPercent: 20}, false})
	eq(t, "v1", view(vs[1]), versionView{1, 4, "Евгения Лаптева", w.owner, true, Term{Months: 12, DiscountPercent: 20}, true})
	numbers := func(pb TenantPriceBook) [3]int {
		out := [3]int{pb.Current.Number}
		if pb.Scheduled != nil {
			out[1] = pb.Scheduled.Number
		}
		if pb.Subscribed != nil {
			out[2] = pb.Subscribed.Number
		}
		return out
	}
	pb, err := w.store.PriceBook(t.Context(), w.lotos)
	must(t, err)
	eq(t, "lotos: current, scheduled, subscribed", numbers(pb), [3]int{2, 0, 1})
	pb, err = w.store.PriceBook(t.Context(), w.alta)
	must(t, err)
	eq(t, "alta", numbers(pb), [3]int{2, 0, 0})
	if _, err := w.store.PriceBook(t.Context(), uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown tenant: %v", err)
	}
}

func scheduledDraft() Draft {
	return Draft{
		EffectiveFrom: "2026-11-01", Note: "Скидка за 12 месяцев — 25%",
		Tiers: []DraftTier{
			{Code: "start", Name: "Старт", SeatsLimit: new(10), MonthMinor: new(int64(390000))},
			{Code: "team", Name: "Команда", SeatsLimit: new(25), MonthMinor: new(int64(890000))},
			{Code: "unl", Name: "Безлимит"},
		},
		Terms: []Term{{Months: 1}, {Months: 4, DiscountPercent: 5}, {Months: 8, DiscountPercent: 10}, {Months: 12, DiscountPercent: 25}},
	}
}

// Публикация с даты: роль (отказ записан как denied), проверки черновика, одна запланированная; действующая версия
// получает конец, сетка владельца — запланированную.
func TestPublish(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	_, err := w.store.Publish(ctx, Publish{Actor: w.support, Draft: scheduledDraft(), RequestID: "r-denied"})
	eq(t, "support", errors.Is(err, ErrForbidden), true)
	eq(t, "denied audit", w.one(`select concat_ws('|', action, result, details->>'permission') from platform_audit where request_id = 'r-denied'`),
		"price_book.published|denied|platform.pricing.manage")
	bad := scheduledDraft()
	bad.Tiers[1].MonthMinor = new(int64(100))
	_, err = w.store.Publish(ctx, Publish{Actor: w.owner, Draft: bad})
	eq(t, "violations", fieldsOfRefusal(refused(t, err, CodeValidationFailed, "Проверьте ступени сетки.")), []string{"tiers[1].monthAmountMinor:not_increasing"})
	v3, err := w.store.Publish(ctx, Publish{Actor: w.owner, Draft: scheduledDraft(), RequestID: "r-publish"})
	must(t, err)
	eq(t, "v3", [4]any{v3.Number, v3.State(w.now), v3.EffectiveFrom, v3.PublishedBy.DisplayName},
		[4]any{3, StateScheduled, time.Date(2026, 10, 31, 21, 0, 0, 0, time.UTC), "Евгения Лаптева"})
	eq(t, "v3 published now", val(v3.PublishedAt), w.now)
	_, err = w.store.Publish(ctx, Publish{Actor: w.owner, Draft: scheduledDraft()})
	refused(t, err, CodeInvalidTransition, "Уже запланирована версия v3. Отмените её, чтобы подготовить другую.")
	vs, err := w.store.Versions(ctx, false)
	must(t, err)
	eq(t, "after publish", versionStates(vs, w.now), []string{"v3:scheduled", "v2:current", "v1:archived"})
	eq(t, "end of v2", val(vs[1].EffectiveUntil), v3.EffectiveFrom)
	pb, err := w.store.PriceBook(ctx, w.alta)
	must(t, err)
	eq(t, "scheduled of the owner", pb.Scheduled != nil && pb.Scheduled.Number == 3, true)
	eq(t, "audit", w.one(`select concat_ws('|', action, actor_kind, target_type, details->>'version', details->>'effectiveFrom')
		from platform_audit where request_id = 'r-publish'`), "price_book.published|operator|price_book|3|2026-11-01")
}

// Отмена до начала: действующая и неизвестная версии — отказ, роль; отменённая остаётся в журнале, действующая снова
// бессрочна, можно запланировать другую.
func TestCancelVersion(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	_, err := w.store.Publish(ctx, Publish{Actor: w.owner, Draft: scheduledDraft()})
	must(t, err)
	_, err = w.store.CancelVersion(ctx, CancelVersion{Actor: w.owner, Number: 2})
	refused(t, err, CodeInvalidTransition, "Запланированной версии нет.")
	_, err = w.store.CancelVersion(ctx, CancelVersion{Actor: w.owner, Number: 99})
	eq(t, "unknown version", errors.Is(err, ErrNotFound), true)
	_, err = w.store.CancelVersion(ctx, CancelVersion{Actor: w.billing, Number: 3})
	eq(t, "billing cancels", errors.Is(err, ErrForbidden), true)
	c, err := w.store.CancelVersion(ctx, CancelVersion{Actor: w.owner, Number: 3, RequestID: "r-cancel"})
	must(t, err)
	eq(t, "cancelled", [2]any{c.State(w.now), val(c.CancelledAt)}, [2]any{StateCancelled, w.now})
	vs, err := w.store.Versions(ctx, false)
	must(t, err)
	eq(t, "after cancel", versionStates(vs, w.now), []string{"v2:current", "v1:archived"})
	eq(t, "v2 open again", vs[0].EffectiveUntil == nil, true)
	vs, err = w.store.Versions(ctx, true)
	must(t, err)
	eq(t, "with cancelled", versionStates(vs, w.now), []string{"v3:cancelled", "v2:current", "v1:archived"})
	v4, err := w.store.Publish(ctx, Publish{Actor: w.owner, Draft: scheduledDraft()})
	must(t, err)
	eq(t, "publish after cancel", v4.Number, 4)
	eq(t, "audit", w.one(`select concat_ws('|', action, details->>'version') from platform_audit where request_id = 'r-cancel'`), "price_book.cancelled|3")
}

// requestView is what a request shows of its tiers, quote and author.
type requestView struct {
	Number, Tenant, From, FromName, To, ToName, Comment, Status, By string
	FromSeats, ToSeats, Version, Used                               int
	Quote                                                           Quote
	Priced                                                          bool
	Revision                                                        int64
}

func requestViewOf(r Request) requestView {
	return requestView{
		Number: r.Number, Tenant: r.TenantName, From: val(r.FromTierCode), FromName: val(r.FromTierName), To: r.ToTierCode,
		ToName: r.ToTierName, Comment: r.Comment, Status: r.Status, By: r.RequestedBy.DisplayName, FromSeats: val(r.FromSeatsLimit),
		ToSeats: val(r.ToSeatsLimit), Version: r.PriceVersion, Used: r.SeatsUsed, Quote: val(r.Quote), Priced: r.Quote != nil,
		Revision: r.Revision,
	}
}

// Заявка владельца: расчёт по действующей версии, номер SR-N, места на момент заявки; журнал от владельца;
// безлимит — без расчёта.
func TestCreateRequest(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	comment := "  Подключаем Самару, нужно ещё 8 мест "
	r, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.zimina, Tier: "team", TermMonths: 12, Comment: &comment, RequestID: "r-create"})
	must(t, err)
	eq(t, "request", requestViewOf(r), requestView{
		Number: "SR-1", Tenant: "Альта Групп", From: "start", FromName: "Старт", To: "team", ToName: "Команда",
		Comment: "Подключаем Самару, нужно ещё 8 мест", Status: StatusPending, By: "Дарья Зимина", FromSeats: 10, ToSeats: 25, Version: 2, Used: 9,
		Quote: Quote{MonthlyMinor: 712000, PeriodMinor: 8544000, SavingMinor: 2136000, DiscountPercent: 20}, Priced: true, Revision: 1,
	})
	eq(t, "requested", [2]any{r.RequestedAt, val(r.RequestedBy.AccountID)}, [2]any{w.now, w.zimina.AccountID})
	eq(t, "audit", w.one(`select concat_ws('|', actor_kind, actor_id, target_type, target_id, details->>'request', details->>'tier',
		details->>'termMonths') from platform_audit where request_id = 'r-create'`), fmt.Sprintf("owner|%s|subscription|%s|SR-1|team|12", w.zimina.AccountID, w.alta))
	u, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "unl", TermMonths: 12})
	must(t, err)
	eq(t, "unlimited", [4]any{u.Number, u.Quote == nil, u.ToSeatsLimit == nil, val(u.FromTierName)}, [4]any{"SR-2", true, true, "Команда"})
}

// Отказы заявки: одна открытая; мест меньше занятых; неизвестный тариф; уже подключённые тариф и срок; длинный
// комментарий; срок вне 1, 4, 8, 12.
func TestCreateRequestRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	_, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.zimina, Tier: "team", TermMonths: 12})
	must(t, err)
	long := string(make([]rune, 501))
	for name, c := range map[string]struct {
		req          CreateRequest
		code, detail string
		fields       []string
	}{
		"вторая заявка":       {CreateRequest{Owner: w.zimina, Tier: "biz", TermMonths: 1}, CodeRequestPending, detailPending, []string{}},
		"мест меньше занятых": {CreateRequest{Owner: w.belova, Tier: "start", TermMonths: 12}, CodeTierBelowUsage, "В тарифе «Старт» 10 мест, а занято 23", []string{"tierCode:tier_below_usage"}},
		"нет тарифа":          {CreateRequest{Owner: w.belova, Tier: "gold", TermMonths: 12}, CodeValidationFailed, detailUnknownTier, []string{"tierCode:tier"}},
		"уже подключён":       {CreateRequest{Owner: w.belova, Tier: "team", TermMonths: 12}, CodeValidationFailed, detailSameTier, []string{"tierCode:tier"}},
		"длинный комментарий": {CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 12, Comment: &long}, CodeValidationFailed, detailRequestCheck, []string{"comment:length"}},
		"срок 6 месяцев":      {CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 6}, CodeValidationFailed, detailRequestCheck, []string{"termMonths:terms"}},
	} {
		_, err := w.store.CreateRequest(ctx, c.req)
		eq(t, name, fieldsOfRefusal(refused(t, err, c.code, c.detail)), c.fields)
	}
	eq(t, "no request written", w.one(`select count(*)::text from subscription_change_requests`), "1")
}

// Отмена владельцем: чужая заявка — нет; отменённую — 409; после отмены — новая заявка.
func TestCancelRequest(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	r, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 12})
	must(t, err)
	_, err = w.store.CancelRequest(ctx, CancelRequest{Owner: w.zimina, ID: r.ID})
	eq(t, "foreign", errors.Is(err, ErrNotFound), true)
	c, err := w.store.CancelRequest(ctx, CancelRequest{Owner: w.belova, ID: r.ID, RequestID: "r-cancel"})
	must(t, err)
	eq(t, "cancelled", [4]any{c.Status, c.Revision, val(c.DecidedAt), val(c.DecidedBy).DisplayName}, [4]any{StatusCancelled, int64(2), w.now, "Ирина Белова"})
	_, err = w.store.CancelRequest(ctx, CancelRequest{Owner: w.belova, ID: r.ID})
	refused(t, err, CodeInvalidTransition, detailDecided)
	_, err = w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 8})
	must(t, err)
	eq(t, "audit", w.one(`select concat_ws('|', action, actor_kind, details->>'request') from platform_audit where request_id = 'r-cancel'`),
		"subscription.change_request_cancelled|owner|"+r.Number)
}

// subscriptionView is what the decision changes in a subscription.
type subscriptionView struct {
	Plan, Status  string
	Seats         int64
	Term, Version int
	Amount        int64
	PeriodEnd     time.Time
	Revision      int64
}

func subscriptionViewOf(s subscriptions.Subscription) subscriptionView {
	return subscriptionView{
		Plan: s.PlanKey, Status: s.Status, Seats: s.Entitlements[0].Value, Term: val(s.TermMonths), Version: val(s.PriceVersion),
		Amount: val(s.AmountMinor), PeriodEnd: val(s.PeriodEndsAt), Revision: s.Revision,
	}
}

// Решение оператора: роль, неизвестная заявка, причина отказа; повышение применяется сразу — пробная организация
// становится active, места и условия периода; повторное решение — 409; журнал.
func TestDecideUpgrade(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	up, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.zimina, Tier: "team", TermMonths: 12})
	must(t, err)
	_, err = w.store.Decide(ctx, Decision{Actor: w.support, ID: up.ID, Approve: true})
	eq(t, "support", errors.Is(err, ErrForbidden), true)
	_, err = w.store.Decide(ctx, Decision{Actor: w.billing, ID: uuid.New(), Approve: true})
	eq(t, "unknown request", errors.Is(err, ErrNotFound), true)
	_, err = w.store.Decide(ctx, Decision{Actor: w.billing, ID: up.ID, Note: new("  ")})
	eq(t, "note", fieldsOfRefusal(refused(t, err, CodeValidationFailed, detailNote)), []string{"note:required"})
	note := "Оплата по счёту получена"
	a, err := w.store.Decide(ctx, Decision{Actor: w.billing, ID: up.ID, Approve: true, Note: &note, RequestID: "r-approve"})
	must(t, err)
	eq(t, "approved", [6]any{a.Status, val(a.EffectiveAt), val(a.AppliedAt), val(a.DecidedBy).DisplayName, a.DecisionNote, a.Revision},
		[6]any{StatusApproved, w.now, w.now, "Алёна Гусева", note, int64(2)})
	sub, err := w.store.Subs.Current(ctx, w.alta)
	must(t, err)
	eq(t, "subscription", subscriptionViewOf(sub), subscriptionView{
		Plan: "team", Status: subscriptions.StatusActive, Seats: 25, Term: 12, Version: 2, Amount: 8544000,
		PeriodEnd: time.Date(2027, 9, 30, 21, 0, 0, 0, time.UTC), Revision: 2,
	})
	eq(t, "alta", w.one(`select state::text from tenants where id = $1`, w.alta), "active")
	_, err = w.store.Decide(ctx, Decision{Actor: w.billing, ID: up.ID, Approve: true})
	refused(t, err, CodeInvalidTransition, detailDecidedOp)
	eq(t, "audit", w.one(`select concat_ws('|', action, actor_kind, reason, details->>'request', details->>'tier') from platform_audit
		where request_id = 'r-approve'`), "subscription.change_approved|operator|"+note+"|"+up.Number+"|team")
	rej, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 12})
	must(t, err)
	d, err := w.store.Decide(ctx, Decision{Actor: w.owner, ID: rej.ID, Note: new("Нет оплаты")})
	must(t, err)
	eq(t, "rejected", [3]any{d.Status, d.DecisionNote, d.EffectiveAt == nil}, [3]any{StatusRejected, "Нет оплаты", true})
}

// Понижение «Карго» с «Команды» на «Старт» — с конца оплаченного периода: планировщик ждёт срока, сдвигает на сутки,
// пока занятые места больше нового лимита, и применяет, когда они умещаются.
func TestDecideDowngrade(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	down, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.shishkin, Tier: "start", TermMonths: 1})
	must(t, err)
	d, err := w.store.Decide(ctx, Decision{Actor: w.billing, ID: down.ID, Approve: true})
	must(t, err)
	eq(t, "downgrade", [2]any{val(d.EffectiveAt), d.AppliedAt == nil}, [2]any{w.cargoEnd, true})
	sub, err := w.store.Subs.Current(ctx, w.cargo)
	must(t, err)
	eq(t, "not yet", sub.PlanKey, "team")
	changed, err := w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "not due", len(changed), 0)
	w.members(w.cargo, "Новый", "active", 6) // 11 of the new 10
	w.now = w.cargoEnd.Add(time.Minute)
	changed, err = w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "seats over the new limit", len(changed), 0)
	eq(t, "moved by a day", w.one(`select (effective_at = $2::timestamptz)::text from subscription_change_requests where id = $1`,
		down.ID, w.cargoEnd.Add(24*time.Hour)), "true")
	w.exec(`update memberships set status = 'ended', ended_at = now() where tenant_id = $1 and status = 'active' and id <> $2`, w.cargo, w.shishkin.MembershipID)
	w.now = w.cargoEnd.Add(25 * time.Hour)
	changed, err = w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "applied", changed, []uuid.UUID{w.cargo})
	sub, err = w.store.Subs.Current(ctx, w.cargo)
	must(t, err)
	eq(t, "cargo", [3]any{sub.PlanKey, sub.Entitlements[0].Value, val(sub.TermMonths)}, [3]any{"start", int64(10), 1})
	eq(t, "applied_at", w.one(`select (applied_at is not null)::text from subscription_change_requests where id = $1`, down.ID), "true")
	eq(t, "system audit", w.one(`select concat_ws('|', actor_kind, details->>'request') from platform_audit where action = 'subscription.change_applied'`),
		"system|"+down.Number)
}

func numbers(p RequestPage) []string {
	out := []string{}
	for _, r := range p.Items {
		out = append(out, r.Number)
	}
	return out
}

// Списки: владелец видит заявки своей организации, оператор — все; фильтры, счётчик открытых, курсор.
func TestRequests(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	a, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.zimina, Tier: "team", TermMonths: 12})
	must(t, err)
	w.now = w.now.Add(time.Minute)
	b, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 12})
	must(t, err)
	w.now = w.now.Add(time.Minute)
	_, err = w.store.CancelRequest(ctx, CancelRequest{Owner: w.belova, ID: b.ID})
	must(t, err)
	c, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 8})
	must(t, err)
	p, err := w.store.Requests(ctx, RequestQuery{Actor: w.belova.AccountID, TenantID: &w.lotos, Owner: true, Limit: 50})
	must(t, err)
	eq(t, "lotos", [3]any{numbers(p), p.PendingCount, p.Next}, [3]any{[]string{c.Number, b.Number}, 1, ""})
	p, err = w.store.Requests(ctx, RequestQuery{Actor: w.billing, Limit: 50, Status: StatusPending})
	must(t, err)
	eq(t, "pending", [2]any{numbers(p), p.PendingCount}, [2]any{[]string{c.Number, a.Number}, 2})
	p, err = w.store.Requests(ctx, RequestQuery{Actor: w.billing, TenantID: &w.lotos, Limit: 50})
	must(t, err)
	eq(t, "operator, one tenant: the badge counts all", [2]any{numbers(p), p.PendingCount}, [2]any{[]string{c.Number, b.Number}, 2})
	p, err = w.store.Requests(ctx, RequestQuery{Actor: w.billing, Limit: 1})
	must(t, err)
	eq(t, "page 1", [2]any{numbers(p), p.Next != ""}, [2]any{[]string{c.Number}, true})
	p2, err := w.store.Requests(ctx, RequestQuery{Actor: w.billing, Limit: 1, Cursor: p.Next})
	must(t, err)
	eq(t, "page 2", numbers(p2), []string{b.Number})
	_, err = w.store.Requests(ctx, RequestQuery{Actor: w.owner, Limit: 1, Cursor: p.Next})
	eq(t, "cursor of another operator", errors.Is(err, ErrBadCursor), true)
	_, err = w.store.Requests(ctx, RequestQuery{Actor: w.billing, TenantID: new(uuid.New()), Limit: 50})
	eq(t, "unknown tenant", errors.Is(err, ErrNotFound), true)
}

// Условия подписки и места для экранов: тариф по версии оплаченного периода, суммы срока, места; факты для списков
// оператора.
func TestTermsAndFacts(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	type termsView struct {
		Tier                   string
		Monthly, Period        int64
		Limit, Active, Invited int
		Available              int
	}
	view := func(id uuid.UUID) termsView {
		sub, err := w.store.Subs.Current(ctx, id)
		must(t, err)
		terms, err := w.store.Terms(ctx, sub)
		must(t, err)
		s := terms.Seats
		return termsView{terms.TierName, val(terms.MonthlyMinor), val(terms.PeriodMinor), val(s.Limit), s.Active, s.Invited, val(s.Available())}
	}
	eq(t, "lotos", view(w.lotos), termsView{"Команда", 680000, 8160000, 25, 23, 0, 2})
	eq(t, "alta", view(w.alta), termsView{"Старт", 0, 0, 10, 7, 2, 1})
	facts, err := w.store.Facts(ctx, []uuid.UUID{w.alta, w.lotos, uuid.New()})
	must(t, err)
	type factsView struct {
		Tier          string
		Members, Used int
	}
	got := map[uuid.UUID]factsView{}
	for id, f := range facts {
		got[id] = factsView{f.TierCode, f.MemberCount, f.Seats.Used()}
	}
	eq(t, "facts", got, map[uuid.UUID]factsView{w.alta: {"start", 9, 9}, w.lotos: {"team", 23, 23}})
}

// «Использование»: строки организаций из метаданных control DB (снимок места, входы не позже «сейчас»), модули —
// из хука; заявка «Лотоса» — у строки.
func TestUsage(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	r, err := w.store.CreateRequest(ctx, CreateRequest{Owner: w.belova, Tier: "biz", TermMonths: 12})
	must(t, err)
	w.exec(`insert into tenant_usage_daily (tenant_id, day, seats_used, seats_limit, storage_used_bytes, storage_quota_bytes, active_members, active_members_7d)
		values ($1, '2026-09-30', 23, 25, $2, $3, 23, 12), ($1, '2026-09-29', 23, 25, 1, $3, 23, 12)`, w.lotos, int64(12)<<30, int64(50)<<30)
	// Вход «из будущего» сида не считается (Q-W4.07-7).
	w.exec(`update accounts set last_login_at = $2 where id = $1`, w.belova.AccountID, w.now.Add(10*time.Hour))
	modules := func(_ context.Context, tenant uuid.UUID, _ string) ([]string, error) {
		if tenant == w.lotos {
			return []string{"spa"}, nil
		}
		return []string{"fleet"}, nil
	}
	u, err := w.store.Usage(ctx, modules, []string{"fleet", "spa", "repairs"})
	must(t, err)
	type rowView struct {
		Status, Tier, Owner       string
		Used, Quota               int64
		Members, Active, Active7d int
		Pending                   uuid.UUID
		Modules                   []string
		SignedIn, Trial           bool
	}
	got := map[string]rowView{}
	for _, row := range u.Tenants {
		v := rowView{row.Status, row.TierName, row.OwnerName, row.StorageUsed, row.StorageQuota, row.MemberCount, row.ActiveMembers,
			row.ActiveMembers7d, uuid.Nil, row.ModuleKeys, row.LastSignIn != nil && !row.LastSignIn.After(w.now), row.TrialEndsAt != nil}
		if row.Pending != nil {
			v.Pending = row.Pending.ID
		}
		got[row.Name] = v
	}
	eq(t, "rows", got, map[string]rowView{
		"SPA «Лотос»": {"active", "Команда", "Ирина Белова", 12 << 30, 50 << 30, 23, 23, 22, r.ID, []string{"spa"}, true, false},
		"Альта Групп": {"trial", "Старт", "Дарья Зимина", 0, 100 << 30, 9, 7, 7, uuid.Nil, []string{"fleet"}, true, true},
		"Карго Сити":  {"active", "Команда", "Денис Шишкин", 0, 100 << 30, 5, 5, 5, uuid.Nil, []string{"fleet"}, true, false},
	})
	eq(t, "summary", [3]any{u.Summary.TenantCount, len(u.Modules), u.MeasuredAt}, [3]any{3, 2, w.now})
}
