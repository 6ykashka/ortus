package main

import (
	"context"
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// told records the notices and the hints of ownerNotices.
type told struct {
	notices map[uuid.UUID]inbox.Notice // by the account of the recipient
	hints   []uuid.UUID
}

func newTold(t *testing.T, owners ...uuid.UUID) (*told, ownerNotices) {
	t.Helper()
	rec := &told{notices: map[uuid.UUID]inbox.Notice{}}
	return rec, ownerNotices{
		owners: func(_ context.Context, tenant uuid.UUID) ([]tenantctx.TenantContext, error) {
			out := make([]tenantctx.TenantContext, 0, len(owners))
			for _, a := range owners {
				out = append(out, tenantctx.TenantContext{TenantID: tenant, AccountID: a, PersonID: uuid.New(), Owner: true})
			}
			return out, nil
		},
		enqueue: func(_ context.Context, to tenantctx.TenantContext, n inbox.Notice) error {
			rec.notices[to.AccountID] = n
			return nil
		},
		hint: func(_ context.Context, tenant uuid.UUID) error {
			rec.hints = append(rec.hints, tenant)
			return nil
		},
		log: slog.New(slog.DiscardHandler),
	}
}

func eqv(t *testing.T, what string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

// W4.60, возврат 1 — тексты контракта 0.8.0-stage4 (= design/ortus/api.js, event(…, owners())): новая заявка —
// «Заявка SR-N на тариф «{tier}» отправлена оператору» всем владельцам без context.changed; решение — «Тариф «{tier}»
// подключён: {seats} мест» («без ограничения мест» у безлимита) / «Заявка SR-N отклонена: {note}» всем владельцам
// (billing.read, ссылка на «Тариф и оплату») и context.changed организации.
func TestBillingEvents(t *testing.T) {
	t.Parallel()
	tenant, belova, second := uuid.New(), uuid.New(), uuid.New()
	rec, notices := newTold(t, belova, second)
	ev := billingEvents{notices}
	link := "/t/" + tenant.String() + "/billing"
	ev.RequestCreated(t.Context(), billing.Request{Number: "SR-13", TenantID: tenant, ToTierName: "Команда", Status: billing.StatusPending})
	eqv(t, "created", rec.notices, map[uuid.UUID]inbox.Notice{
		belova: {Kind: "billing.subscription_request.created", Title: "Заявка SR-13 на тариф «Команда» отправлена оператору", Link: link, Permission: "billing.read"},
		second: {Kind: "billing.subscription_request.created", Title: "Заявка SR-13 на тариф «Команда» отправлена оператору", Link: link, Permission: "billing.read"},
	})
	eqv(t, "no hint for a new request", len(rec.hints), 0)
	from := time.Date(2026, 10, 2, 21, 0, 0, 0, time.UTC)
	ev.RequestDecided(t.Context(), billing.Request{Number: "SR-12", TenantID: tenant, ToTierName: "Бизнес", ToSeatsLimit: new(50), TermMonths: 12,
		Status: billing.StatusApproved, EffectiveAt: &from})
	eqv(t, "approved", rec.notices[second], inbox.Notice{Kind: "billing.subscription_request.approved", Title: "Тариф «Бизнес» подключён: 50 мест",
		Link: link, Permission: "billing.read"})
	eqv(t, "the hint", rec.hints, []uuid.UUID{tenant})
	ev.RequestDecided(t.Context(), billing.Request{Number: "SR-15", TenantID: tenant, ToTierName: "Безлимит", TermMonths: 12, Status: billing.StatusApproved})
	eqv(t, "unlimited", rec.notices[belova].Title, "Тариф «Безлимит» подключён: без ограничения мест")
	ev.RequestDecided(t.Context(), billing.Request{Number: "SR-14", TenantID: tenant, ToTierName: "Команда", TermMonths: 1,
		Status: billing.StatusRejected, DecisionNote: "Сначала погасите счёт за сентябрь"})
	eqv(t, "rejected", rec.notices[belova], inbox.Notice{Kind: "billing.subscription_request.rejected", Severity: inbox.SeverityWarning,
		Title: "Заявка SR-14 отклонена: Сначала погасите счёт за сентябрь", Link: link, Permission: "billing.read"})
	long := strings.Repeat("я", 500)
	ev.RequestDecided(t.Context(), billing.Request{Number: "SR-16", TenantID: tenant, Status: billing.StatusRejected, DecisionNote: long})
	got := rec.notices[belova]
	eqv(t, "long note: the title is clipped, the body keeps the whole text", [3]any{utf8.RuneCountInString(got.Title), strings.HasSuffix(got.Title, "…"), got.Body},
		[3]any{300, true, "Заявка SR-16 отклонена: " + long})
	if err := got.Validate(); err != nil {
		t.Errorf("long note: %v", err)
	}
}

// Новая версия оформления — «Оформление обновлено (версия {N}). Изменения видны всем сотрудникам» всем владельцам,
// автору тоже (контракт, design/ortus/api.js), и context.changed: тема оболочки у всех участников обновляется.
func TestBrandingEvents(t *testing.T) {
	t.Parallel()
	tenant, belova, second := uuid.New(), uuid.New(), uuid.New()
	rec, notices := newTold(t, belova, second)
	brandingEvents{notices}.BrandingUpdated(t.Context(), tenant, branding.Branding{Version: 4, DisplayName: "SPA «Лотос»",
		UpdatedBy: &branding.AccountRef{AccountID: &belova, DisplayName: "Ирина Белова"}})
	n := inbox.Notice{Kind: "branding.updated", Title: "Оформление обновлено (версия 4). Изменения видны всем сотрудникам",
		Link: "/t/" + tenant.String() + "/branding"}
	eqv(t, "notices", rec.notices, map[uuid.UUID]inbox.Notice{belova: n, second: n})
	eqv(t, "hint", rec.hints, []uuid.UUID{tenant})
}

// Сбой рассылки не роняет команду: подсказка всё равно уходит.
func TestOwnerNoticesBestEffort(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	rec, notices := newTold(t, uuid.New())
	notices.owners = func(context.Context, uuid.UUID) ([]tenantctx.TenantContext, error) {
		return nil, errors.New("control DB down")
	}
	brandingEvents{notices}.BrandingUpdated(t.Context(), tenant, branding.Branding{Version: 2})
	eqv(t, "hint despite the failure", rec.hints, []uuid.UUID{tenant})
}

// installedModules: модули из реестра организации (без выключенных); организация без доступной БД — модуль её отрасли.
func TestInstalledModules(t *testing.T) {
	t.Parallel()
	alta, down := uuid.New(), uuid.New()
	mods := installedModules(func(_ context.Context, id uuid.UUID) (map[string]modulesreg.Installation, error) {
		if id == down {
			return nil, errors.New("no tenant DB")
		}
		return map[string]modulesreg.Installation{
			"fleet": {Key: "fleet", State: modulesreg.StateActive}, "spa": {Key: "spa", State: modulesreg.StateDisabled},
			"tasks": {Key: "tasks", State: modulesreg.StateActive},
		}, nil
	})
	got := map[string][]string{}
	for name, c := range map[string]struct {
		id       uuid.UUID
		industry string
	}{"alta": {alta, "logistics"}, "spa down": {down, "spa"}, "repair down": {down, "repair"}, "custom down": {down, "custom"}} {
		keys, err := mods(t.Context(), c.id, c.industry)
		if err != nil {
			t.Fatal(err)
		}
		got[name] = keys
	}
	eqv(t, "modules", got, map[string][]string{"alta": {"fleet"}, "spa down": {"spa"}, "repair down": {"repairs"}, "custom down": {}})
}
