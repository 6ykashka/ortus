package subshttp

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	alta     = uuid.MustParse("2c1f0e2c-5c3b-5a9c-9a51-6e0d3c7d1a01")
	operator = uuid.MustParse("2c1f0e2c-5c3b-5a9c-9a51-6e0d3c7d1aff")
	trialEnd = time.Date(2026, 10, 13, 21, 0, 0, 0, time.UTC)
)

// altaTrial is the subscription of the example getPlatformSubscription/ok.
func altaTrial() subscriptions.Subscription {
	return subscriptions.Subscription{
		TenantID: alta, PlanKey: "start", Status: subscriptions.StatusTrialing, TrialEndsAt: &trialEnd, Revision: 2,
		Entitlements: subscriptions.PlanEntitlements("start", subscriptions.SourceTrial, subscriptions.DefaultQuotaBytes),
	}
}

type fakeSubs struct {
	sub     subscriptions.Subscription
	err     error
	updates []subscriptions.Update
	ifMatch int64
	actor   uuid.UUID
}

func (f *fakeSubs) Current(_ context.Context, id uuid.UUID) (subscriptions.Subscription, error) {
	if f.err != nil {
		return subscriptions.Subscription{}, f.err
	}
	if id != f.sub.TenantID {
		return subscriptions.Subscription{}, subscriptions.ErrUnknownTenant
	}
	return f.sub, nil
}

func (f *fakeSubs) Update(_ context.Context, _ uuid.UUID, u subscriptions.Update, ifMatch int64, actor uuid.UUID) (subscriptions.Subscription, error) {
	f.updates, f.ifMatch, f.actor = append(f.updates, u), ifMatch, actor
	if f.err != nil {
		return subscriptions.Subscription{}, f.err
	}
	next := f.sub
	next.TrialEndsAt, next.Revision = u.TrialEndsAt, f.sub.Revision+1
	return next, nil
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
	return normalized(t, raw)
}

func normalized(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(v)
	return string(out)
}

// withoutFields drops top-level fields of a normalized JSON object.
func withoutFields(t *testing.T, normalizedJSON string, fields ...string) string {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal([]byte(normalizedJSON), &v); err != nil {
		t.Fatal(err)
	}
	for _, f := range fields {
		delete(v, f)
	}
	return asJSON(t, v)
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return normalized(t, raw)
}

// Оператор читает подписку: тело = пример getPlatformSubscription/ok, ETag ревизии, без кеша.
func TestGetPlatformSubscription(t *testing.T) {
	t.Parallel()
	srv := PlatformServer{Subs: &fakeSubs{sub: altaTrial()}}
	resp, err := srv.GetPlatformSubscription(t.Context(), platformapi.GetPlatformSubscriptionRequestObject{TenantId: alta})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(platformapi.GetPlatformSubscription200JSONResponse)
	if !isOK || *ok.Headers.ETag != `"rev-2"` || *ok.Headers.CacheControl != "private, no-store" {
		t.Fatalf("%+v", resp)
	}
	// Поля W4.07 (тариф, версия цен, места) сервер отдаёт с W4.60; до него — тело примера без них.
	want := withoutFields(t, example(t, "getPlatformSubscription", "ok"), "tierCode", "tierName", "priceVersion", "seats")
	if got := asJSON(t, ok.Body); got != want {
		t.Errorf("body\n got %s\nwant %s", got, want)
	}
	_, err = srv.GetPlatformSubscription(t.Context(), platformapi.GetPlatformSubscriptionRequestObject{TenantId: uuid.New()})
	if !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("unknown tenant: %v", err)
	}
}

func TestUpdatePlatformSubscription(t *testing.T) {
	t.Parallel()
	subs := &fakeSubs{sub: altaTrial()}
	srv := PlatformServer{Subs: subs}
	ctx := session.WithSession(t.Context(), session.Session{AccountID: operator})
	newEnd := trialEnd.Add(14 * 24 * time.Hour)
	body := platformapi.PlatformSubscriptionUpdate{
		PlanKey: "start", Status: "trialing", TrialEndsAt: &newEnd, Reason: "Продление по просьбе клиента",
		ManualEntitlements: []platformapi.Entitlement{{Key: "storage_quota_bytes", SourceType: "manual", SourceRef: "SUP-7", Value: 1 << 40, ValidUntil: &newEnd}},
	}
	resp, err := srv.UpdatePlatformSubscription(ctx, platformapi.UpdatePlatformSubscriptionRequestObject{
		TenantId: alta, Params: platformapi.UpdatePlatformSubscriptionParams{IfMatch: `"rev-2"`}, Body: &body,
	})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(platformapi.UpdatePlatformSubscription200JSONResponse)
	if !isOK || *ok.Headers.ETag != `"rev-3"` || ok.Body.Revision != 3 || !ok.Body.TrialEndsAt.Equal(newEnd) {
		t.Fatalf("%+v", resp)
	}
	u := subs.updates[0]
	if subs.ifMatch != 2 || subs.actor != operator || u.Reason != body.Reason || u.Status != "trialing" ||
		len(u.Manual) != 1 || u.Manual[0].SourceRef != "SUP-7" || u.Manual[0].ValidUntil == nil {
		t.Errorf("update %+v ifMatch %d actor %s", u, subs.ifMatch, subs.actor)
	}
}

func TestUpdatePlatformSubscriptionRefusals(t *testing.T) {
	t.Parallel()
	ctx := session.WithSession(t.Context(), session.Session{AccountID: operator})
	body := &platformapi.PlatformSubscriptionUpdate{PlanKey: "start", Status: "active", Reason: "Оплата по счёту"}
	for name, c := range map[string]struct {
		err     error
		ifMatch string
		code    string
	}{
		"ревизия":      {subscriptions.ErrRevision, `"rev-2"`, "revision_mismatch"},
		"поля":         {&subscriptions.ValidationError{Fields: []string{"reason"}}, `"rev-2"`, "validation_failed"},
		"организация":  {subscriptions.ErrUnknownTenant, `"rev-2"`, problem.CodeNotFound},
		"база":         {errors.New("connection reset"), `"rev-2"`, problem.CodeDependencyUnavailable},
		"слабый ETag":  {nil, `W/"rev-2"`, problem.CodeMalformedRequest},
		"без If-Match": {nil, ``, problem.CodeMalformedRequest},
	} {
		srv := PlatformServer{Subs: &fakeSubs{sub: altaTrial(), err: c.err}}
		_, err := srv.UpdatePlatformSubscription(ctx, platformapi.UpdatePlatformSubscriptionRequestObject{
			TenantId: alta, Params: platformapi.UpdatePlatformSubscriptionParams{IfMatch: c.ifMatch}, Body: body,
		})
		if !problem.Is(err, c.code) {
			t.Errorf("%s: %v, want %s", name, err, c.code)
		}
	}
	srv := PlatformServer{Subs: &fakeSubs{sub: altaTrial()}}
	_, err := srv.UpdatePlatformSubscription(t.Context(), platformapi.UpdatePlatformSubscriptionRequestObject{TenantId: alta, Body: body})
	if !problem.Is(err, problem.CodeSessionExpired) {
		t.Errorf("no session: %v", err)
	}
}

// Владелец читает подписку своей организации (организация — из контекста шлюза); смена тарифа — W4.60 (D-33).
func TestBillingServer(t *testing.T) {
	t.Parallel()
	srv := NewBillingServer(nil, &fakeSubs{sub: altaTrial()})
	ctx := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: alta, Owner: true})
	resp, err := srv.GetTenantSubscription(ctx, billingapi.GetTenantSubscriptionRequestObject{TenantId: alta})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(billingapi.GetTenantSubscription200JSONResponse)
	if !isOK || *ok.Headers.ETag != `"rev-2"` {
		t.Fatalf("%+v", resp)
	}
	// W4.07 (0.8.0-stage4): тариф, версия цен и места подписки отдаёт сервер W4.60; до него — пример без них.
	want := withoutFields(t, example(t, "getTenantSubscription", "ok"), "tierCode", "tierName", "priceVersion", "seats")
	if got := asJSON(t, ok.Body); got != want {
		t.Errorf("body\n got %s\nwant %s", got, want)
	}
	if _, err := srv.GetTenantSubscription(t.Context(), billingapi.GetTenantSubscriptionRequestObject{TenantId: alta}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("without tenant context: %v", err)
	}
	if _, err := srv.RequestSubscriptionChange(ctx, billingapi.RequestSubscriptionChangeRequestObject{TenantId: alta}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("requestSubscriptionChange: %v", err)
	}
	for name, call := range map[string]func() error{
		"getStorageUsage": func() error {
			_, err := srv.GetStorageUsage(ctx, billingapi.GetStorageUsageRequestObject{TenantId: alta})
			return err
		},
		"getStorageBreakdown": func() error {
			_, err := srv.GetStorageBreakdown(ctx, billingapi.GetStorageBreakdownRequestObject{TenantId: alta})
			return err
		},
		"requestStorageChange": func() error {
			_, err := srv.RequestStorageChange(ctx, billingapi.RequestStorageChangeRequestObject{TenantId: alta})
			return err
		},
	} {
		if err := call(); !problem.Is(err, problem.CodeNotImplemented) {
			t.Errorf("%s without a base server: %v", name, err)
		}
	}
}
