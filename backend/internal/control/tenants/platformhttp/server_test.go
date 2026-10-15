package platformhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/provisioning"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

var operator = uuid.MustParse("6f1c2a4e-9d1b-5c3e-8a7f-0b1c2d3e4f50")

// fakeStore keeps tenants in creation order and records registrations.
type fakeStore struct {
	tenants  []tenants.Tenant
	requests []provisioning.Request
	err      error
	replayed bool
}

func (f *fakeStore) ListTenants(_ context.Context, after *tenants.Cursor, limit int) ([]tenants.Tenant, *tenants.Cursor, error) {
	if f.err != nil {
		return nil, nil, f.err
	}
	start := 0
	if after != nil {
		for i, tn := range f.tenants {
			if tn.ID == after.ID {
				start = i + 1
			}
		}
	}
	end := min(start+limit, len(f.tenants))
	page := f.tenants[start:end]
	if end == len(f.tenants) {
		return page, nil, nil
	}
	last := page[len(page)-1]
	return page, &tenants.Cursor{CreatedAt: last.CreatedAt, ID: last.ID}, nil
}

func (f *fakeStore) GetTenant(_ context.Context, id uuid.UUID) (tenants.Tenant, error) {
	for _, tn := range f.tenants {
		if tn.ID == id {
			return tn, nil
		}
	}
	return tenants.Tenant{}, tenants.ErrUnknownTenant
}

func (f *fakeStore) Register(_ context.Context, req provisioning.Request) (tenants.Tenant, bool, error) {
	if err := req.Validate(); err != nil {
		return tenants.Tenant{}, false, err
	}
	f.requests = append(f.requests, req)
	if f.err != nil {
		return tenants.Tenant{}, false, f.err
	}
	return tenants.Tenant{
		ID: provisioning.TenantID(req.ActorID, req.IdempotencyKey), Name: req.Name, State: "provisioning",
		OwnerAccountIDs: []uuid.UUID{}, CreatedAt: time.Date(2026, time.October, 15, 7, 0, 0, 0, time.UTC), Revision: 1,
	}, f.replayed, nil
}

func seeded(n int) *fakeStore {
	f := &fakeStore{}
	for i := range n {
		f.tenants = append(f.tenants, tenants.Tenant{
			ID: uuid.New(), Slug: "t", Name: "Организация", State: "trial", OwnerAccountIDs: []uuid.UUID{operator},
			CreatedAt: time.Date(2026, time.October, 1, 7, i, 0, 0, time.UTC), Revision: int64(i + 1),
		})
	}
	return f
}

// serve mounts the strict server like cmd/api (router.go) behind a minimal gateway stand-in: request id and the
// session of an operator.
func serve(t *testing.T, store Store, method, target, body string, header map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	requestError := func(w http.ResponseWriter, req *http.Request, err error) {
		problem.Write(w, req, problem.Wrap(problem.CodeMalformedRequest, err))
	}
	platformapi.HandlerWithOptions(platformapi.NewStrictHandlerWithOptions(&Server{Store: store}, nil, platformapi.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: requestError, ResponseErrorHandlerFunc: problem.Write,
	}), platformapi.ChiServerOptions{BaseRouter: r, ErrorHandlerFunc: requestError})
	h := requestid.Middleware(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ctx := session.WithSession(req.Context(), session.Session{AccountID: operator})
		r.ServeHTTP(w, req.WithContext(ctx))
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

func code(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var p problem.Body
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("not a problem body: %s", rec.Body)
	}
	return p.Code
}

const createBody = `{"name": "Альта Логистика", "ownerEmail": "owner@alta.example", "timeZone": "Europe/Moscow", "planKey": "pilot"}`

// S1-01: оператор создаёт организацию — 201 Tenant в provisioning без владельцев, заголовки ETag, no-store,
// X-Request-Id, Idempotency-Replayed; в хранилище уходят тело, оператор, ключ и id запроса.
func TestCreateTenant(t *testing.T) {
	t.Parallel()
	store := &fakeStore{}
	rec := serve(t, store, http.MethodPost, "/api/v1/platform/tenants", createBody,
		map[string]string{"Idempotency-Key": "create-alta-0001-key", "X-Request-Id": "req-1"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var tn platformapi.Tenant
	if err := json.Unmarshal(rec.Body.Bytes(), &tn); err != nil {
		t.Fatal(err)
	}
	if tn.Status != "provisioning" || tn.Name != "Альта Логистика" || len(tn.OwnerUserIds) != 0 || tn.Revision != 1 {
		t.Errorf("tenant %+v", tn)
	}
	checkHeaders(t, rec, map[string]string{"ETag": `"1"`, "Cache-Control": "private, no-store", "X-Request-Id": "req-1", "Idempotency-Replayed": "false"})
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"ownerUserIds":[]`)) {
		t.Errorf("ownerUserIds must be an empty array: %s", rec.Body)
	}
	if len(store.requests) != 1 || store.requests[0].ActorID != operator || store.requests[0].IdempotencyKey != "create-alta-0001-key" ||
		store.requests[0].RequestID != "req-1" || store.requests[0].OwnerEmail != "owner@alta.example" {
		t.Errorf("requests %+v", store.requests)
	}
}

func checkHeaders(t *testing.T, rec *httptest.ResponseRecorder, want map[string]string) {
	t.Helper()
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
}

func decodePage(t *testing.T, rec *httptest.ResponseRecorder) platformapi.TenantPage {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var page platformapi.TenantPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	return page
}

// Повтор с тем же ключом — тот же ответ и Idempotency-Replayed: true; другой запрос с тем же ключом — 409
// idempotency_key_reused; невалидное тело — 422 validation_failed; сбой хранилища — 503 без текста причины.
func TestCreateTenantErrors(t *testing.T) {
	t.Parallel()
	hdr := map[string]string{"Idempotency-Key": "create-alta-0001-key"}
	replay := serve(t, &fakeStore{replayed: true}, http.MethodPost, "/api/v1/platform/tenants", createBody, hdr)
	if replay.Code != http.StatusCreated || replay.Header().Get("Idempotency-Replayed") != "true" {
		t.Errorf("replay: %d %q", replay.Code, replay.Header().Get("Idempotency-Replayed"))
	}
	conflict := serve(t, &fakeStore{err: provisioning.ErrIdempotencyConflict}, http.MethodPost, "/api/v1/platform/tenants", createBody, hdr)
	if conflict.Code != http.StatusConflict || code(t, conflict) != "idempotency_key_reused" {
		t.Errorf("conflict: %d %s", conflict.Code, conflict.Body)
	}
	invalid := serve(t, &fakeStore{}, http.MethodPost, "/api/v1/platform/tenants",
		`{"name": "", "ownerEmail": "x@y.z", "timeZone": "Mars/Base", "planKey": "pilot"}`, hdr)
	if invalid.Code != http.StatusUnprocessableEntity || code(t, invalid) != "validation_failed" ||
		!strings.Contains(invalid.Body.String(), "timeZone") {
		t.Errorf("invalid: %d %s", invalid.Code, invalid.Body)
	}
	shortKey := serve(t, &fakeStore{}, http.MethodPost, "/api/v1/platform/tenants", createBody, map[string]string{"Idempotency-Key": "short"})
	if shortKey.Code != http.StatusUnprocessableEntity {
		t.Errorf("short key: %d %s", shortKey.Code, shortKey.Body)
	}
	broken := serve(t, &fakeStore{err: context.DeadlineExceeded}, http.MethodPost, "/api/v1/platform/tenants", createBody, hdr)
	if broken.Code != http.StatusServiceUnavailable || strings.Contains(broken.Body.String(), "deadline") {
		t.Errorf("store failure: %d %s", broken.Code, broken.Body)
	}
}

// listPlatformTenants: страницы по курсору (limit 1…200, по умолчанию 50), на последней nextCursor = null.
func TestListTenants(t *testing.T) {
	t.Parallel()
	store := seeded(3)
	page := decodePage(t, serve(t, store, http.MethodGet, "/api/v1/platform/tenants?limit=2", "", nil))
	if len(page.Items) != 2 || page.NextCursor == nil || page.Items[0].Id != store.tenants[0].ID {
		t.Fatalf("first page %+v", page)
	}
	rec := serve(t, store, http.MethodGet, "/api/v1/platform/tenants?limit=2&cursor="+*page.NextCursor, "", nil)
	page = decodePage(t, rec)
	if len(page.Items) != 1 || page.NextCursor != nil || page.Items[0].Id != store.tenants[2].ID {
		t.Fatalf("second page %+v", page)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"nextCursor":null`)) {
		t.Errorf("nextCursor must be null on the last page: %s", rec.Body)
	}
	if page := decodePage(t, serve(t, seeded(60), http.MethodGet, "/api/v1/platform/tenants", "", nil)); len(page.Items) != 50 {
		t.Errorf("default limit: %d items", len(page.Items))
	}
}

// Испорченный курсор и limit вне диапазона — 400 malformed_request.
func TestListTenantsRejectsBadParams(t *testing.T) {
	t.Parallel()
	for _, q := range []string{"?cursor=!!!", "?limit=0", "?limit=201", "?limit=many"} {
		bad := serve(t, seeded(1), http.MethodGet, "/api/v1/platform/tenants"+q, "", nil)
		if bad.Code != http.StatusBadRequest || code(t, bad) != "malformed_request" {
			t.Errorf("%s: %d %s", q, bad.Code, bad.Body)
		}
	}
}

// getPlatformTenant: 200 с ETag; неизвестная организация — 404 not_found.
func TestGetTenant(t *testing.T) {
	t.Parallel()
	store := seeded(2)
	rec := serve(t, store, http.MethodGet, "/api/v1/platform/tenants/"+store.tenants[1].ID.String(), "", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("ETag") != `"2"` {
		t.Fatalf("get: %d %q %s", rec.Code, rec.Header().Get("ETag"), rec.Body)
	}
	missing := serve(t, store, http.MethodGet, "/api/v1/platform/tenants/"+uuid.NewString(), "", nil)
	if missing.Code != http.StatusNotFound || code(t, missing) != "not_found" {
		t.Errorf("missing: %d %s", missing.Code, missing.Body)
	}
}

// Операции тега у других владельцев (W1.11 — updatePlatformTenant, W1.08 — подписки) отвечают 501.
func TestOtherOperationsNotImplemented(t *testing.T) {
	t.Parallel()
	id := uuid.NewString()
	for _, c := range []struct{ method, path, body string }{
		{http.MethodPatch, "/api/v1/platform/tenants/" + id, `{"status": "suspended", "reason": "долг по оплате"}`},
		{http.MethodGet, "/api/v1/platform/tenants/" + id + "/subscription", ""},
		{http.MethodPut, "/api/v1/platform/tenants/" + id + "/subscription", `{"planKey": "p", "status": "active", "cancelAtPeriodEnd": false, "manualEntitlements": [], "reason": "причина"}`},
		{http.MethodGet, "/api/v1/platform/users", ""},
	} {
		rec := serve(t, seeded(1), c.method, c.path, c.body, map[string]string{"Idempotency-Key": "k-0000000000000001", "If-Match": `"1"`})
		if rec.Code != http.StatusNotImplemented {
			t.Errorf("%s %s: %d %s", c.method, c.path, rec.Code, rec.Body)
		}
	}
}
