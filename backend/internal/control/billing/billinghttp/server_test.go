package billinghttp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func clock() time.Time { return now }

// owner is the request context of the owner of «Лотос» (the TenantContext of the gateway).
func owner(t *testing.T, tenant uuid.UUID) context.Context {
	t.Helper()
	return tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{
		TenantID: tenant, MembershipID: uuid.MustParse("6f1b8e2a-3c4d-5e6f-8a9b-0c1d2e3f4a5b"), AccountID: *belova.AccountID, Owner: true,
	})
}

// operator is the request context of the operator Лаптева.
func operator(t *testing.T) context.Context {
	t.Helper()
	return session.WithSession(t.Context(), session.Session{AccountID: *lapteva.AccountID})
}

// Сетка владельца: действующая версия без авторов; запланированная и версия оплаченного периода — когда есть.
func TestGetTenantPriceBook(t *testing.T) {
	t.Parallel()
	store := &fakeStore{priceBook: billing.TenantPriceBook{Current: v2()}}
	srv := TenantServer{Store: store, Now: clock}
	resp, err := srv.GetTenantPriceBook(owner(t, alta), billingapi.GetTenantPriceBookRequestObject{TenantId: alta})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(billingapi.GetTenantPriceBook200JSONResponse)
	if !isOK || *ok.Headers.CacheControl != "private, no-store" || store.tenant != alta {
		t.Fatalf("%+v", resp)
	}
	same(t, "ok", asJSON(t, ok.Body), example(t, "getTenantPriceBook", "ok"))
	cur := v2()
	cur.EffectiveUntil = new(v3().EffectiveFrom)
	store.priceBook = billing.TenantPriceBook{Current: cur, Scheduled: new(v3()), Subscribed: new(v1())}
	resp, err = srv.GetTenantPriceBook(owner(t, lotos), billingapi.GetTenantPriceBookRequestObject{TenantId: lotos})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ = resp.(billingapi.GetTenantPriceBook200JSONResponse)
	same(t, "subscribed", asJSON(t, ok.Body), example(t, "getTenantPriceBook", "subscribed"))
	if _, err := srv.GetTenantPriceBook(t.Context(), billingapi.GetTenantPriceBookRequestObject{TenantId: alta}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("without tenant context: %v", err)
	}
}

// Заявки владельца: только своей организации (Owner), решение без оператора; фильтр и страница.
func TestListSubscriptionChangeRequests(t *testing.T) {
	t.Parallel()
	store := &fakeStore{page: billing.RequestPage{Items: []billing.Request{sr12()}, PendingCount: 1}}
	srv := TenantServer{Store: store, Now: clock}
	status := billingapi.ListSubscriptionChangeRequestsParamsStatus("pending")
	resp, err := srv.ListSubscriptionChangeRequests(owner(t, lotos), billingapi.ListSubscriptionChangeRequestsRequestObject{
		TenantId: lotos, Params: billingapi.ListSubscriptionChangeRequestsParams{Status: &status, Limit: new(20), Cursor: new("c1")},
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(billingapi.ListSubscriptionChangeRequests200JSONResponse)
	same(t, "ok", asJSON(t, ok.Body), example(t, "listSubscriptionChangeRequests", "ok"))
	eq(t, "query", store.query, billing.RequestQuery{Actor: *belova.AccountID, TenantID: &lotos, Owner: true, Status: "pending", Cursor: "c1", Limit: 20})
	// Одобренная заявка: владелец видит решение без оператора.
	store.page = billing.RequestPage{Items: []billing.Request{sr9()}}
	resp, err = srv.ListSubscriptionChangeRequests(owner(t, cargo), billingapi.ListSubscriptionChangeRequestsRequestObject{TenantId: cargo})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ = resp.(billingapi.ListSubscriptionChangeRequests200JSONResponse)
	item := ok.Body.Items[0]
	eq(t, "approved for the owner: no operator, the note, default limit", [3]any{item.DecidedBy == nil, item.DecisionNote != nil, store.query.Limit},
		[3]any{true, true, 50})
	for name, params := range map[string]billingapi.ListSubscriptionChangeRequestsParams{
		"неизвестный статус": {Status: new(billingapi.ListSubscriptionChangeRequestsParamsStatus("lost"))},
		"limit 0":            {Limit: new(0)},
		"limit 201":          {Limit: new(201)},
	} {
		_, err := srv.ListSubscriptionChangeRequests(owner(t, lotos), billingapi.ListSubscriptionChangeRequestsRequestObject{TenantId: lotos, Params: params})
		if !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v", name, err)
		}
	}
	store.err = billing.ErrBadCursor
	if _, err := srv.ListSubscriptionChangeRequests(owner(t, lotos), billingapi.ListSubscriptionChangeRequestsRequestObject{TenantId: lotos}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("bad cursor: %v", err)
	}
}

// Заявка владельца: 201 = пример; команда несёт владельца из контекста шлюза; после — событие (уведомления).
// Отказы: 409 request_pending (problem), 422 tier_below_usage — тело примера с violations.
func TestCreateSubscriptionChangeRequest(t *testing.T) {
	t.Parallel()
	ev := &events{}
	store := &fakeStore{request: sr13()}
	srv := TenantServer{Store: store, Events: ev, Now: clock}
	comment := "Подключаем Самару, нужно ещё 8 мест"
	resp, err := srv.CreateSubscriptionChangeRequest(owner(t, alta), billingapi.CreateSubscriptionChangeRequestRequestObject{
		TenantId: alta, Body: &billingapi.SubscriptionChangeRequestCreate{TierCode: "team", TermMonths: 12, Comment: &comment},
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(billingapi.CreateSubscriptionChangeRequest201JSONResponse)
	if !isOK || *ok.Headers.IdempotencyReplayed {
		t.Fatalf("%+v", resp)
	}
	same(t, "ok", asJSON(t, ok.Body), example(t, "createSubscriptionChangeRequest", "ok"))
	eq(t, "command", store.create, billing.CreateRequest{
		Owner: billing.Owner{TenantID: alta, MembershipID: store.create.Owner.MembershipID, AccountID: *belova.AccountID},
		Tier:  "team", TermMonths: 12, Comment: &comment,
	})
	eq(t, "events", ev.created, []string{"SR-13"})
	text := "В тарифе «Старт» 10 мест, а занято 23"
	store.err = &billing.RefusalError{Code: billing.CodeTierBelowUsage, Detail: text,
		Violations: []billing.Violation{{Field: "tierCode", Code: billing.CodeTierBelowUsage, Message: text}}}
	resp, err = srv.CreateSubscriptionChangeRequest(owner(t, lotos), billingapi.CreateSubscriptionChangeRequestRequestObject{
		TenantId: lotos, Body: &billingapi.SubscriptionChangeRequestCreate{TierCode: "start", TermMonths: 12},
	})
	if err != nil {
		t.Fatal(err)
	}
	refused, isOK := resp.(billingapi.CreateSubscriptionChangeRequest422ApplicationProblemPlusJSONResponse)
	if !isOK {
		t.Fatalf("%+v", resp)
	}
	same(t, "tier_below_usage", problemJSON(t, refused.Body), exampleProblem(t, "createSubscriptionChangeRequest", "tier_below_usage"))
	store.err = &billing.RefusalError{Code: billing.CodeRequestPending, Detail: "Заявка уже на рассмотрении. Отмените её, чтобы отправить новую."}
	_, err = srv.CreateSubscriptionChangeRequest(owner(t, lotos), billingapi.CreateSubscriptionChangeRequestRequestObject{
		TenantId: lotos, Body: &billingapi.SubscriptionChangeRequestCreate{TierCode: "biz", TermMonths: 12},
	})
	eq(t, "request_pending", problemOf(err), [2]string{"request_pending", "Заявка уже на рассмотрении. Отмените её, чтобы отправить новую."})
	eq(t, "a refused command has no events", len(ev.created), 1)
	if _, err := srv.CreateSubscriptionChangeRequest(owner(t, lotos), billingapi.CreateSubscriptionChangeRequestRequestObject{TenantId: lotos}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("no body: %v", err)
	}
}

// Отмена владельцем: 200 = пример (decidedBy — владелец); 409 — пример; чужая заявка — 404.
func TestCancelSubscriptionChangeRequest(t *testing.T) {
	t.Parallel()
	r := sr12()
	r.Status, r.Revision, r.DecidedAt, r.DecidedBy = billing.StatusCancelled, 2, new(now), &belova
	store := &fakeStore{request: r}
	srv := TenantServer{Store: store, Now: clock}
	resp, err := srv.CancelSubscriptionChangeRequest(owner(t, lotos), billingapi.CancelSubscriptionChangeRequestRequestObject{TenantId: lotos, ChangeRequestId: r.ID})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(billingapi.CancelSubscriptionChangeRequest200JSONResponse)
	same(t, "ok", asJSON(t, ok.Body), example(t, "cancelSubscriptionChangeRequest", "ok"))
	if store.cancel.ID != r.ID || store.cancel.Owner.TenantID != lotos {
		t.Errorf("command %+v", store.cancel)
	}
	store.err = &billing.RefusalError{Code: billing.CodeInvalidTransition, Detail: "Заявка уже рассмотрена."}
	_, err = srv.CancelSubscriptionChangeRequest(owner(t, lotos), billingapi.CancelSubscriptionChangeRequestRequestObject{TenantId: lotos, ChangeRequestId: r.ID})
	if pe, isPE := errors.AsType[*problem.Error](err); !isPE || pe.Code != "invalid_transition" || pe.Detail != "Заявка уже рассмотрена." {
		t.Errorf("invalid_transition: %v", err)
	}
	store.err = billing.ErrNotFound
	_, err = srv.CancelSubscriptionChangeRequest(owner(t, lotos), billingapi.CancelSubscriptionChangeRequestRequestObject{TenantId: lotos, ChangeRequestId: uuid.New()})
	if !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("not found: %v", err)
	}
}

// Очередь оператора: заявки всех организаций с оператором решения; фильтр организации и статуса.
func TestListPlatformSubscriptionRequests(t *testing.T) {
	t.Parallel()
	store := &fakeStore{page: billing.RequestPage{Items: []billing.Request{sr12(), sr9()}, PendingCount: 1}}
	srv := PlatformServer{Store: store, Now: clock}
	resp, err := srv.ListPlatformSubscriptionRequests(operator(t), platformapi.ListPlatformSubscriptionRequestsRequestObject{
		Params: platformapi.ListPlatformSubscriptionRequestsParams{TenantId: &lotos},
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(platformapi.ListPlatformSubscriptionRequests200JSONResponse)
	same(t, "ok", asJSON(t, ok.Body), example(t, "listPlatformSubscriptionRequests", "ok"))
	if store.query.Owner || *store.query.TenantID != lotos || store.query.Actor != *lapteva.AccountID {
		t.Errorf("query %+v", store.query)
	}
	store.err = billing.ErrNotFound
	if _, err := srv.ListPlatformSubscriptionRequests(operator(t), platformapi.ListPlatformSubscriptionRequestsRequestObject{}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("unknown tenant: %v", err)
	}
}

// Решение: 200 = пример, событие; 422 причины — тело примера; 409 — пример; роль — 403.
func TestDecidePlatformSubscriptionRequest(t *testing.T) {
	t.Parallel()
	r := sr12()
	r.Status, r.Revision, r.DecidedAt, r.DecidedBy, r.DecisionNote, r.EffectiveAt, r.AppliedAt =
		billing.StatusApproved, 2, new(now), &lapteva, "Оплата по счёту получена", new(now), new(now)
	ev := &events{}
	store := &fakeStore{request: r}
	srv := PlatformServer{Store: store, Events: ev, Now: clock}
	note := "Оплата по счёту получена"
	resp, err := srv.DecidePlatformSubscriptionRequest(operator(t), platformapi.DecidePlatformSubscriptionRequestRequestObject{
		ChangeRequestId: r.ID, Body: &platformapi.SubscriptionRequestDecision{Decision: "approve", Note: &note},
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(platformapi.DecidePlatformSubscriptionRequest200JSONResponse)
	same(t, "ok", asJSON(t, ok.Body), example(t, "decidePlatformSubscriptionRequest", "ok"))
	if d := store.decision; !d.Approve || *d.Note != note || d.ID != r.ID || d.Actor != *lapteva.AccountID || len(ev.decided) != 1 {
		t.Errorf("decision %+v events %v", d, ev.decided)
	}
	store.err = &billing.RefusalError{Code: billing.CodeValidationFailed, Detail: "Укажите причину отказа.",
		Violations: []billing.Violation{{Field: "note", Code: "required", Message: "Укажите причину отказа"}}}
	resp, err = srv.DecidePlatformSubscriptionRequest(operator(t), platformapi.DecidePlatformSubscriptionRequestRequestObject{
		ChangeRequestId: r.ID, Body: &platformapi.SubscriptionRequestDecision{Decision: "reject"},
	})
	if err != nil {
		t.Fatal(err)
	}
	refused, isOK := resp.(platformapi.DecidePlatformSubscriptionRequest422ApplicationProblemPlusJSONResponse)
	if !isOK || store.decision.Approve {
		t.Fatalf("%+v", resp)
	}
	same(t, "validation_failed", problemJSON(t, refused.Body), exampleProblem(t, "decidePlatformSubscriptionRequest", "validation_failed"))
	store.err = billing.ErrForbidden
	_, err = srv.DecidePlatformSubscriptionRequest(operator(t), platformapi.DecidePlatformSubscriptionRequestRequestObject{
		ChangeRequestId: r.ID, Body: &platformapi.SubscriptionRequestDecision{Decision: "approve"},
	})
	if !problem.Is(err, problem.CodeForbiddenAction) {
		t.Errorf("role: %v", err)
	}
	if _, err := srv.DecidePlatformSubscriptionRequest(operator(t), platformapi.DecidePlatformSubscriptionRequestRequestObject{
		ChangeRequestId: r.ID, Body: &platformapi.SubscriptionRequestDecision{Decision: "maybe"},
	}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("unknown decision: %v", err)
	}
	if _, err := srv.DecidePlatformSubscriptionRequest(t.Context(), platformapi.DecidePlatformSubscriptionRequestRequestObject{ChangeRequestId: r.ID}); !problem.Is(err, problem.CodeSessionExpired) {
		t.Errorf("no session: %v", err)
	}
}

// Версии сетки: список = пример (оператор видит авторов и число подписок); публикация и отмена = примеры;
// черновик доходит до хранилища как есть.
func TestPriceBookVersions(t *testing.T) {
	t.Parallel()
	store := &fakeStore{versions: []billing.Version{v2(), v1()}}
	srv := PlatformServer{Store: store, Now: clock}
	resp, err := srv.ListPriceBookVersions(operator(t), platformapi.ListPriceBookVersionsRequestObject{
		Params: platformapi.ListPriceBookVersionsParams{IncludeCancelled: new(true)},
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(platformapi.ListPriceBookVersions200JSONResponse)
	same(t, "list", asJSON(t, ok.Body), example(t, "listPriceBookVersions", "ok"))
	if !store.included {
		t.Error("includeCancelled")
	}
	v := v3()
	v.PublishedBy = &lapteva
	store.version = v
	start := openapi_types.Date{Time: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)}
	body := &platformapi.PriceBookVersionCreate{EffectiveFrom: start, Note: v.Note,
		Tiers: []platformapi.PriceTierDraft{{Code: new("start"), Name: "Старт", SeatsLimit: new(10), MonthAmountMinor: new(390000)}, {Name: "Безлимит"}},
		Terms: []platformapi.PriceTerm{{Months: 1}, {Months: 4, DiscountPercent: 5}, {Months: 8, DiscountPercent: 10}, {Months: 12, DiscountPercent: 25}},
	}
	presp, err := srv.PublishPriceBookVersion(operator(t), platformapi.PublishPriceBookVersionRequestObject{Body: body})
	if err != nil {
		t.Fatal(err)
	}
	pok, _ := presp.(platformapi.PublishPriceBookVersion201JSONResponse)
	same(t, "publish", asJSON(t, pok.Body), example(t, "publishPriceBookVersion", "ok"))
	eq(t, "publish", store.publish, billing.Publish{Actor: *lapteva.AccountID, Draft: billing.Draft{
		EffectiveFrom: "2026-11-01", Note: v.Note,
		Tiers: []billing.DraftTier{{Code: "start", Name: "Старт", SeatsLimit: new(10), MonthMinor: new(int64(390000))}, {Name: "Безлимит"}},
		Terms: terms(25),
	}})
	v.CancelledAt = new(now)
	store.version = v
	cresp, err := srv.CancelPriceBookVersion(operator(t), platformapi.CancelPriceBookVersionRequestObject{Version: 3})
	if err != nil {
		t.Fatal(err)
	}
	cok, _ := cresp.(platformapi.CancelPriceBookVersion200JSONResponse)
	same(t, "cancel", asJSON(t, cok.Body), example(t, "cancelPriceBookVersion", "ok"))
	if store.cancelV.Number != 3 {
		t.Errorf("cancel %+v", store.cancelV)
	}
}

// Отказы сетки: 422 черновика — тело примера; 409 запланированной — пример; неизвестная версия — 404.
func TestPriceBookRefusals(t *testing.T) {
	t.Parallel()
	store := &fakeStore{}
	srv := PlatformServer{Store: store, Now: clock}
	body := &platformapi.PriceBookVersionCreate{EffectiveFrom: openapi_types.Date{Time: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)}}
	store.err = &billing.RefusalError{Code: billing.CodeValidationFailed, Detail: "Проверьте ступени сетки.",
		Violations: []billing.Violation{{Field: "tiers[1].monthAmountMinor", Code: "not_increasing", Message: "Цена должна расти от ступени к ступени"}}}
	resp, err := srv.PublishPriceBookVersion(operator(t), platformapi.PublishPriceBookVersionRequestObject{Body: body})
	if err != nil {
		t.Fatal(err)
	}
	refused, isOK := resp.(platformapi.PublishPriceBookVersion422ApplicationProblemPlusJSONResponse)
	if !isOK {
		t.Fatalf("%+v", resp)
	}
	same(t, "validation_failed", problemJSON(t, refused.Body), exampleProblem(t, "publishPriceBookVersion", "validation_failed"))
	store.err = &billing.RefusalError{Code: billing.CodeInvalidTransition, Detail: "Уже запланирована версия v3. Отмените её, чтобы подготовить другую."}
	_, err = srv.PublishPriceBookVersion(operator(t), platformapi.PublishPriceBookVersionRequestObject{Body: body})
	if pe, isPE := errors.AsType[*problem.Error](err); !isPE || pe.Detail != "Уже запланирована версия v3. Отмените её, чтобы подготовить другую." {
		t.Errorf("scheduled: %v", err)
	}
	store.err = billing.ErrNotFound
	if _, err := srv.CancelPriceBookVersion(operator(t), platformapi.CancelPriceBookVersionRequestObject{Version: 99}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("unknown version: %v", err)
	}
}
