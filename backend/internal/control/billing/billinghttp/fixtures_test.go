package billinghttp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// The fixtures are the data of the examples of the contract 0.8.0-stage4 (snapshots of the scenario server of W4.07
// on the seed W0.12): the price book v1–v3, the requests SR-9, SR-12, SR-13 and their people.

var (
	now      = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	alta     = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa")
	lotos    = uuid.MustParse("e4f2195f-f5a3-5f61-98be-f6ed76ea565a")
	cargo    = uuid.MustParse("abdf3e10-8013-5327-af36-1bf84b2b72e7")
	lapteva  = billing.AccountRef{AccountID: new(uuid.MustParse("47575a90-6587-584f-bfe6-950866f7810c")), DisplayName: "Евгения Лаптева"}
	belova   = billing.AccountRef{AccountID: new(uuid.MustParse("b2d93da5-f9c0-59ca-994d-baa75ffd2ad8")), DisplayName: "Ирина Белова"}
	zimina   = billing.AccountRef{AccountID: new(uuid.MustParse("0281a55e-725e-53b1-920f-4189ab46e08a")), DisplayName: "Дарья Зимина"}
	shishkin = billing.AccountRef{AccountID: new(uuid.MustParse("60ad451f-8c47-5194-9224-f8918e54416f")), DisplayName: "Денис Шишкин"}
)

func terms(longDiscount int) []billing.Term {
	return []billing.Term{{Months: 1}, {Months: 4, DiscountPercent: 5}, {Months: 8, DiscountPercent: 10}, {Months: 12, DiscountPercent: longDiscount}}
}

func tier(code, name string, seats int, month int64) billing.Tier {
	return billing.Tier{Code: code, Name: name, SeatsLimit: new(seats), MonthMinor: new(month)}
}

var unlimited = billing.Tier{Code: "unl", Name: "Безлимит"}

func v1() billing.Version {
	return billing.Version{
		Number: 1, EffectiveFrom: time.Date(2026, 5, 31, 21, 0, 0, 0, time.UTC), EffectiveUntil: new(time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC)),
		Note: "Стартовая сетка пилота", Currency: billing.Currency, PublishedBy: &lapteva, SubscriptionCount: 3,
		Tiers: []billing.Tier{tier("start", "Старт", 10, 350000), tier("team", "Команда", 25, 850000), tier("biz", "Бизнес", 50, 1490000), unlimited},
		Terms: terms(20),
	}
}

func v2() billing.Version {
	return billing.Version{
		Number: 2, EffectiveFrom: time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC), Note: "Добавлена ступень «Сеть» до 100 мест, пересчитаны цены",
		Currency: billing.Currency, PublishedBy: &lapteva, SubscriptionCount: 1,
		Tiers: []billing.Tier{
			tier("start", "Старт", 10, 390000), tier("team", "Команда", 25, 890000), tier("biz", "Бизнес", 50, 1590000),
			tier("net", "Сеть", 100, 2790000), unlimited,
		},
		Terms: terms(20),
	}
}

func v3() billing.Version {
	v := v2()
	v.Number, v.EffectiveFrom, v.Note, v.Terms = 3, time.Date(2026, 10, 31, 21, 0, 0, 0, time.UTC), "Скидка за 12 месяцев — 25%", terms(25)
	v.PublishedAt, v.SubscriptionCount = new(now), 0
	return v
}

func sr12() billing.Request {
	return billing.Request{
		ID: uuid.MustParse("d5748522-e6b8-5df4-8a9f-1cbdfef46ed3"), Number: "SR-12", TenantID: lotos, TenantName: "SPA «Лотос»",
		FromTierCode: new("team"), FromTierName: new("Команда"), FromSeatsLimit: new(25), ToTierCode: "biz", ToTierName: "Бизнес",
		ToSeatsLimit: new(50), TermMonths: 12, PriceVersion: 1,
		Quote:     &billing.Quote{MonthlyMinor: 1192000, PeriodMinor: 14304000, SavingMinor: 3576000, DiscountPercent: 20},
		SeatsUsed: 23, Comment: "Открываем второй салон, нужно ещё 10–12 мест", Status: billing.StatusPending,
		RequestedAt: time.Date(2026, 9, 29, 13, 40, 0, 0, time.UTC), RequestedBy: belova, Revision: 1,
	}
}

func sr9() billing.Request {
	decided := time.Date(2026, 5, 12, 12, 20, 0, 0, time.UTC)
	return billing.Request{
		ID: uuid.MustParse("f6a45af4-762d-5d73-8cbe-356710cdbbeb"), Number: "SR-9", TenantID: cargo, TenantName: "Карго Сити",
		FromTierCode: new("start"), FromTierName: new("Старт"), FromSeatsLimit: new(10), ToTierCode: "team", ToTierName: "Команда",
		ToSeatsLimit: new(25), TermMonths: 4, PriceVersion: 1,
		Quote:     &billing.Quote{MonthlyMinor: 807500, PeriodMinor: 3230000, SavingMinor: 170000, DiscountPercent: 5},
		SeatsUsed: 10, Status: billing.StatusApproved, RequestedAt: time.Date(2026, 5, 12, 8, 2, 0, 0, time.UTC), RequestedBy: shishkin,
		DecidedAt: &decided, DecidedBy: &lapteva, DecisionNote: "Оплата по счёту получена", EffectiveAt: &decided, AppliedAt: &decided,
		Revision: 2,
	}
}

func sr13() billing.Request {
	return billing.Request{
		ID: uuid.MustParse("9b60c414-c428-5628-86a3-bd1fe9bbfdfe"), Number: "SR-13", TenantID: alta, TenantName: "Альта Групп",
		FromTierCode: new("start"), FromTierName: new("Старт"), FromSeatsLimit: new(10), ToTierCode: "team", ToTierName: "Команда",
		ToSeatsLimit: new(25), TermMonths: 12, PriceVersion: 2,
		Quote:     &billing.Quote{MonthlyMinor: 712000, PeriodMinor: 8544000, SavingMinor: 2136000, DiscountPercent: 20},
		SeatsUsed: 9, Comment: "Подключаем Самару, нужно ещё 8 мест", Status: billing.StatusPending, RequestedAt: now,
		RequestedBy: zimina, Revision: 1,
	}
}

// fakeStore answers with the fields it holds and records the commands.
type fakeStore struct {
	priceBook billing.TenantPriceBook
	page      billing.RequestPage
	request   billing.Request
	versions  []billing.Version
	version   billing.Version
	usage     billing.Usage
	facts     map[uuid.UUID]billing.Facts
	err       error

	query    billing.RequestQuery
	create   billing.CreateRequest
	cancel   billing.CancelRequest
	decision billing.Decision
	publish  billing.Publish
	cancelV  billing.CancelVersion
	included bool
	tenant   uuid.UUID
}

func (f *fakeStore) PriceBook(_ context.Context, id uuid.UUID) (billing.TenantPriceBook, error) {
	f.tenant = id
	return f.priceBook, f.err
}

func (f *fakeStore) Requests(_ context.Context, q billing.RequestQuery) (billing.RequestPage, error) {
	f.query = q
	return f.page, f.err
}

func (f *fakeStore) CreateRequest(_ context.Context, c billing.CreateRequest) (billing.Request, error) {
	f.create = c
	return f.request, f.err
}

func (f *fakeStore) CancelRequest(_ context.Context, c billing.CancelRequest) (billing.Request, error) {
	f.cancel = c
	return f.request, f.err
}

func (f *fakeStore) Decide(_ context.Context, c billing.Decision) (billing.Request, error) {
	f.decision = c
	return f.request, f.err
}

func (f *fakeStore) Versions(_ context.Context, includeCancelled bool) ([]billing.Version, error) {
	f.included = includeCancelled
	return f.versions, f.err
}

func (f *fakeStore) Publish(_ context.Context, c billing.Publish) (billing.Version, error) {
	f.publish = c
	return f.version, f.err
}

func (f *fakeStore) CancelVersion(_ context.Context, c billing.CancelVersion) (billing.Version, error) {
	f.cancelV = c
	return f.version, f.err
}

func (f *fakeStore) Usage(context.Context, billing.Modules, []string) (billing.Usage, error) {
	return f.usage, f.err
}

func (f *fakeStore) Facts(context.Context, []uuid.UUID) (map[uuid.UUID]billing.Facts, error) {
	return f.facts, f.err
}

// events records what followed the commands.
type events struct{ created, decided []string }

func (e *events) RequestCreated(_ context.Context, r billing.Request) {
	e.created = append(e.created, r.Number)
}
func (e *events) RequestDecided(_ context.Context, r billing.Request) {
	e.decided = append(e.decided, r.Number)
}

func example(t *testing.T, op, name string) string {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "..", "..", "api", "openapi", "examples", op))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile(name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return normalized(t, raw, false)
}

// normalized is the canonical JSON of raw (sorted keys); withoutRequestID drops requestId of a Problem.
func normalized(t *testing.T, raw []byte, withoutRequestID bool) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if m, ok := v.(map[string]any); ok && withoutRequestID {
		delete(m, "requestId")
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return normalized(t, raw, false)
}

// problemJSON is a Problem body without its requestId, to compare with an example.
func problemJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return normalized(t, raw, true)
}

func exampleProblem(t *testing.T, op, name string) string {
	t.Helper()
	return normalized(t, []byte(example(t, op, name)), true)
}

// eq reports a difference of got and want (reflect.DeepEqual).
func eq[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

// problemOf is the code and the detail of a Problem error ("" when err is not one).
func problemOf(err error) [2]string {
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok {
		return [2]string{}
	}
	return [2]string{pe.Code, pe.Detail}
}

func same(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s\n got %s\nwant %s", what, got, want)
	}
}
