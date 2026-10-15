package operators

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/platformhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// fakeCommands records the commands and answers with tn, sub, page or err.
type fakeCommands struct {
	mu   sync.Mutex
	got  []string
	tn   tenants.Tenant
	sub  subscriptions.Subscription
	page AuditPage
	err  error
}

func (f *fakeCommands) record(format string, a ...any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.got = append(f.got, fmt.Sprintf(format, a...))
}

func (f *fakeCommands) Suspend(_ context.Context, c StatusChange) (tenants.Tenant, error) {
	f.record("suspend %s %s %s %q %s", c.TenantID, c.ActorID, c.IfMatch, c.Reason, c.RequestID)
	return f.tn, f.err
}

func (f *fakeCommands) Resume(_ context.Context, c StatusChange) (tenants.Tenant, error) {
	f.record("resume %s %s %s %q %s", c.TenantID, c.ActorID, c.IfMatch, c.Reason, c.RequestID)
	return f.tn, f.err
}

func (f *fakeCommands) Rename(_ context.Context, c Rename) (tenants.Tenant, error) {
	reason := "<nil>"
	if c.Reason != nil {
		reason = *c.Reason
	}
	f.record("rename %s %s %s %q %q %s", c.TenantID, c.ActorID, c.IfMatch, c.Name, reason, c.RequestID)
	return f.tn, f.err
}

func (f *fakeCommands) ExtendTrial(_ context.Context, c TrialExtension) (subscriptions.Subscription, error) {
	f.record("extend %s %s %s %d %q %s", c.TenantID, c.ActorID, c.IfMatch, c.Days, c.Reason, c.RequestID)
	return f.sub, f.err
}

func (f *fakeCommands) AuditEvents(_ context.Context, q AuditQuery) (AuditPage, error) {
	tenant := "<nil>"
	if q.TenantID != nil {
		tenant = q.TenantID.String()
	}
	f.record("audit %s %s %q %d", q.ActorID, tenant, q.Cursor, q.Limit)
	return f.page, f.err
}

func (f *fakeCommands) calls() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.got...)
}

// serve mounts the strict server like cmd/api (router.go, ErrorHandlerFunc) behind a minimal gateway stand-in:
// request id and, when withSession, the session of an operator.
func serve(t *testing.T, srv platformapi.StrictServerInterface, withSession bool, method, target, body string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	requestError := func(w http.ResponseWriter, req *http.Request, err error) {
		problem.Write(w, req, problem.Wrap(problem.CodeMalformedRequest, err))
	}
	platformapi.HandlerWithOptions(platformapi.NewStrictHandlerWithOptions(srv, nil, platformapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: requestError, ResponseErrorHandlerFunc: problem.Write,
	}), platformapi.ChiServerOptions{BaseRouter: r, ErrorHandlerFunc: requestError})
	h := requestid.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if withSession {
			req = req.WithContext(session.WithSession(req.Context(), session.Session{AccountID: actorID}))
		}
		r.ServeHTTP(w, req)
	}))
	req := httptest.NewRequestWithContext(t.Context(), method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func commandHeaders(ifMatch string) map[string]string {
	return map[string]string{"Idempotency-Key": "op-key-0000000001", "If-Match": ifMatch}
}

func problemCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p problem.Body
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("problem body %q: %v", rec.Body.String(), err)
	}
	return p.Code
}

var (
	tenantPath = "/api/v1/platform/tenants/" + tenantID.String()
	createdAt  = time.Date(2026, time.September, 1, 7, 0, 0, 0, time.UTC)
	cardTenant = tenants.Tenant{
		ID: tenantID, Slug: "alta", Name: "Альта Групп", State: StateSuspended, OwnerAccountIDs: []uuid.UUID{actorID},
		CreatedAt: createdAt, Revision: 8,
	}
)

func newServer(f *fakeCommands) *Server { return &Server{Server: &platformhttp.Server{}, Commands: f} }

// T-03: команды над организацией — 200 Tenant, ETag "<ревизия>", Idempotency-Replayed: false, Cache-Control, X-Request-Id;
// команда собрана из пути, If-Match, тела и сессии.
func TestServerTenantCommands(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, method, path, body, want string
	}{
		{"suspend", http.MethodPost, tenantPath + "/suspend", `{"reason":"Неоплата счёта"}`,
			fmt.Sprintf(`suspend %s %s "7" "Неоплата счёта"`, tenantID, actorID)},
		{"resume", http.MethodPost, tenantPath + "/resume", `{"reason":"Оплата пришла"}`,
			fmt.Sprintf(`resume %s %s "7" "Оплата пришла"`, tenantID, actorID)},
		{"rename", http.MethodPatch, tenantPath, `{"name":"Альта"}`,
			fmt.Sprintf(`rename %s %s "7" "Альта" "<nil>"`, tenantID, actorID)},
		{"rename with reason", http.MethodPatch, tenantPath, `{"name":"Альта","reason":"Смена бренда"}`,
			fmt.Sprintf(`rename %s %s "7" "Альта" "Смена бренда"`, tenantID, actorID)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeCommands{tn: cardTenant}
			rec := serve(t, newServer(f), true, c.method, c.path, c.body, commandHeaders(`"7"`))
			if rec.Code != http.StatusOK {
				t.Fatalf("status %d: %s", rec.Code, rec.Body)
			}
			h := rec.Header()
			rid := h.Get("X-Request-Id")
			got := [3]string{h.Get("ETag"), h.Get("Cache-Control"), h.Get("Idempotency-Replayed")}
			if want := [3]string{`"8"`, "private, no-store", "false"}; got != want || rid == "" {
				t.Errorf("headers %v", h)
			}
			var body platformapi.Tenant
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			want := platformapi.Tenant{
				Id: tenantID, Name: "Альта Групп", Status: platformapi.TenantStatusSuspended, OwnerUserIds: []uuid.UUID{actorID},
				CreatedAt: createdAt, Revision: 8,
			}
			if !reflect.DeepEqual(body, want) {
				t.Errorf("body %+v, want %+v", body, want)
			}
			if calls := f.calls(); len(calls) != 1 || calls[0] != c.want+" "+rid {
				t.Errorf("calls %q, want %q", calls, c.want+" "+rid)
			}
		})
	}
}

// T-03: продление — 200 Subscription и ETag подписки "rev-N".
func TestServerExtendTrial(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, time.October, 27, 20, 59, 59, 0, time.UTC)
	until := time.Date(2026, time.December, 31, 0, 0, 0, 0, time.UTC)
	f := &fakeCommands{sub: subscriptions.Subscription{
		TenantID: tenantID, PlanKey: "start", Status: subscriptions.StatusTrialing, TrialEndsAt: &end, Revision: 3,
		Entitlements: []subscriptions.Entitlement{
			{Key: "seats", SourceType: "trial", SourceRef: "price-book:v2:start", Value: 10},
			{Key: "storage_quota_bytes", SourceType: "manual", SourceRef: "Тикет 42", Value: 1 << 30, ValidUntil: &until},
		},
	}}
	rec := serve(t, newServer(f), true, http.MethodPost, tenantPath+"/trial-extensions", `{"days":14,"reason":"Пилот продлён"}`,
		commandHeaders(`"rev-2"`))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if tag := rec.Header().Get("ETag"); tag != `"rev-3"` {
		t.Errorf("ETag %s", tag)
	}
	var body platformapi.Subscription
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	want := platformapi.Subscription{
		PlanKey: "start", Status: platformapi.SubscriptionStatusTrialing, TrialEndsAt: &end, Revision: 3,
		Entitlements: []platformapi.Entitlement{
			{Key: "seats", SourceType: "trial", SourceRef: "price-book:v2:start", Value: 10},
			{Key: "storage_quota_bytes", SourceType: "manual", SourceRef: "Тикет 42", Value: 1 << 30, ValidUntil: &until},
		},
	}
	if !reflect.DeepEqual(body, want) {
		t.Errorf("body %+v, want %+v", body, want)
	}
	if calls := f.calls(); len(calls) != 1 || !strings.HasPrefix(calls[0], fmt.Sprintf(`extend %s %s "rev-2" 14 "Пилот продлён" `, tenantID, actorID)) {
		t.Errorf("calls %q", calls)
	}
}

// T-03: ошибки сервиса → Problem-коды контракта; неизвестная ошибка не раскрывает текста.
func TestServerErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{&ValidationError{Fields: []string{"reason"}}, http.StatusUnprocessableEntity, "validation_failed"},
		{ErrRevisionRequired, http.StatusPreconditionRequired, "revision_required"},
		{ErrRevisionMismatch, http.StatusPreconditionFailed, "revision_mismatch"},
		{fmt.Errorf("%w: suspend from closed", ErrInvalidTransition), http.StatusConflict, "invalid_transition"},
		{ErrForbidden, http.StatusForbidden, problem.CodeForbiddenAction},
		{ErrNotOperator, http.StatusNotFound, problem.CodeNotFound},
		{fmt.Errorf("%w: %s", tenants.ErrUnknownTenant, tenantID), http.StatusNotFound, problem.CodeNotFound},
		{ErrBadCursor, http.StatusBadRequest, problem.CodeMalformedRequest},
		{errors.New("pq: connection refused to secret-host"), http.StatusServiceUnavailable, problem.CodeDependencyUnavailable},
	}
	requests := []struct{ method, path, body string }{
		{http.MethodPost, tenantPath + "/suspend", `{"reason":"Неоплата счёта"}`},
		{http.MethodPost, tenantPath + "/resume", `{"reason":"Оплата пришла"}`},
		{http.MethodPost, tenantPath + "/trial-extensions", `{"days":14,"reason":"Пилот продлён"}`},
		{http.MethodPatch, tenantPath, `{"name":"Альта"}`},
		{http.MethodGet, "/api/v1/platform/audit-events", ""},
	}
	for _, c := range cases {
		for _, r := range requests {
			t.Run(c.code+" "+r.method+" "+r.path, func(t *testing.T) {
				t.Parallel()
				rec := serve(t, newServer(&fakeCommands{err: c.err}), true, r.method, r.path, r.body, commandHeaders(`"3"`))
				if rec.Code != c.status || problemCode(t, rec) != c.code {
					t.Errorf("%v → %d %s", c.err, rec.Code, rec.Body)
				}
				if strings.Contains(rec.Body.String(), "secret-host") {
					t.Errorf("leak: %s", rec.Body)
				}
			})
		}
	}
	rec := serve(t, newServer(&fakeCommands{err: &ValidationError{Fields: []string{"days", "reason"}}}), true, http.MethodPost,
		tenantPath+"/trial-extensions", `{"days":0,"reason":""}`, commandHeaders(`"rev-1"`))
	if !strings.Contains(rec.Body.String(), "days, reason") {
		t.Errorf("detail: %s", rec.Body)
	}
}

// T-03: updatePlatformTenant с 0.4.0-stage1 только переименовывает: status в теле и пустой patch — 422 без вызова сервиса;
// без сессии — 401; битое тело — 400.
func TestServerRequestChecks(t *testing.T) {
	t.Parallel()
	f := &fakeCommands{tn: cardTenant}
	srv := newServer(f)
	for body, field := range map[string]string{
		`{"status":"suspended","reason":"Неоплата счёта"}`:            "status",
		`{"name":"Альта","status":"active","reason":"Оплата пришла"}`: "status",
		`{}`: "name",
	} {
		rec := serve(t, srv, true, http.MethodPatch, tenantPath, body, commandHeaders(`"1"`))
		if rec.Code != http.StatusUnprocessableEntity || problemCode(t, rec) != "validation_failed" || !strings.Contains(rec.Body.String(), field) {
			t.Errorf("%s: %d %s", body, rec.Code, rec.Body)
		}
	}
	for _, r := range []struct{ method, path, body string }{
		{http.MethodPost, tenantPath + "/suspend", `{"reason":"Неоплата счёта"}`},
		{http.MethodPost, tenantPath + "/resume", `{"reason":"Неоплата счёта"}`},
		{http.MethodPost, tenantPath + "/trial-extensions", `{"days":14,"reason":"Пилот продлён"}`},
		{http.MethodPatch, tenantPath, `{"name":"Альта"}`},
		{http.MethodGet, "/api/v1/platform/audit-events", ""},
	} {
		if rec := serve(t, srv, false, r.method, r.path, r.body, commandHeaders(`"1"`)); rec.Code != http.StatusUnauthorized ||
			problemCode(t, rec) != problem.CodeSessionExpired {
			t.Errorf("no session %s %s: %d %s", r.method, r.path, rec.Code, rec.Body)
		}
	}
	if rec := serve(t, srv, true, http.MethodPost, tenantPath+"/suspend", `{"reason":`, commandHeaders(`"1"`)); rec.Code != http.StatusBadRequest {
		t.Errorf("broken JSON: %d %s", rec.Code, rec.Body)
	}
	if calls := f.calls(); len(calls) != 0 {
		t.Errorf("service called: %q", calls)
	}
}

// T-03: журнал — страница строк, курсор следующей, фильтр и лимит переданы сервису; лимит вне 1…200 — 400.
func TestServerAuditEvents(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, time.October, 5, 6, 0, 0, 0, time.UTC)
	f := &fakeCommands{page: AuditPage{
		Items: []AuditEvent{
			{
				ID: 42, At: at, ActorKind: "operator", ActorID: &actorID, ActorName: "Оператор", Action: ActionSuspended,
				TargetType: TargetTenant, TargetID: &tenantID, TargetTenantID: &tenantID, TargetName: "Альта Групп",
				Reason: "Неоплата счёта", Result: "ok", Details: map[string]string{"fromStatus": "trial", "toStatus": "suspended"},
			},
			{ID: 41, At: at, ActorKind: "system", Action: "subscription.trial_ended", TargetType: TargetSubscription,
				TargetTenantID: &tenantID, TargetName: "Альта Групп", Result: "ok"},
		},
		Next: "next-cursor",
	}}
	rec := serve(t, newServer(f), true, http.MethodGet, "/api/v1/platform/audit-events?tenantId="+tenantID.String()+"&cursor=abc&limit=2", "", nil)
	eq(t, "answer", [3]any{rec.Code, rec.Header().Get("Cache-Control"), rec.Header().Get("X-Request-Id") != ""},
		[3]any{http.StatusOK, "private, no-store", true})
	var page platformapi.PlatformAuditPage
	must(t, json.Unmarshal(rec.Body.Bytes(), &page))
	reason, actorName, name, next := "Неоплата счёта", "Оператор", "Альта Групп", "next-cursor"
	details := map[string]string{"fromStatus": "trial", "toStatus": "suspended"}
	want := platformapi.PlatformAuditPage{Items: []platformapi.PlatformAuditEvent{
		{
			Id: "42", At: at, Action: ActionSuspended, Reason: &reason, Result: platformapi.Ok, Details: &details,
			Actor:  platformapi.PlatformAuditActor{Kind: platformapi.PlatformAuditActorKindOperator, AccountId: &actorID, DisplayName: &actorName},
			Target: platformapi.PlatformAuditTarget{Type: platformapi.PlatformAuditTargetTypeTenant, Id: &tenantID, TenantId: &tenantID, Name: &name},
		},
		{
			Id: "41", At: at, Action: "subscription.trial_ended", Result: platformapi.Ok,
			Actor:  platformapi.PlatformAuditActor{Kind: platformapi.PlatformAuditActorKindSystem},
			Target: platformapi.PlatformAuditTarget{Type: platformapi.PlatformAuditTargetTypeSubscription, TenantId: &tenantID, Name: &name},
		},
	}, NextCursor: &next}
	eq(t, "page", page, want)
	eq(t, "calls", f.calls(), []string{fmt.Sprintf(`audit %s %s "abc" 2`, actorID, tenantID)})

	empty := &fakeCommands{}
	rec = serve(t, newServer(empty), true, http.MethodGet, "/api/v1/platform/audit-events", "", nil)
	eq(t, "empty page", [2]any{rec.Code, rec.Body.String()}, [2]any{http.StatusOK, `{"items":[],"nextCursor":null}` + "\n"})
	eq(t, "defaults", empty.calls(), []string{fmt.Sprintf(`audit %s <nil> "" 50`, actorID)})
	for _, q := range []string{"limit=0", "limit=201"} {
		rec := serve(t, newServer(empty), true, http.MethodGet, "/api/v1/platform/audit-events?"+q, "", nil)
		eq(t, q, rec.Code, http.StatusBadRequest)
	}
}

// Остальные операции тега — от реестра W1.02 (встроенный platformhttp.Server).
func TestServerKeepsRegistry(t *testing.T) {
	t.Parallel()
	rec := serve(t, newServer(&fakeCommands{}), true, http.MethodGet, tenantPath+"/subscription", "", nil)
	if rec.Code != http.StatusNotImplemented {
		t.Errorf("getPlatformSubscription: %d %s", rec.Code, rec.Body)
	}
}
