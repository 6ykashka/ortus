package main

import (
	"context"
	"io"
	"net/http"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/dev"
)

// Тест G-1 брифа W1.01: шлюз выполняет изменяющую операцию под Idempotency-Key после проверки права (S1-25).

// spyStores records the tenants Guard asked a store for; every tenant shares one MemStore.
type spyStores struct {
	mu      sync.Mutex
	tenants []uuid.UUID
	store   *idem.MemStore
}

func (s *spyStores) For(_ context.Context, tenant uuid.UUID) (idem.Store, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tenants = append(s.tenants, tenant)
	return s.store, nil
}

func (s *spyStores) asked() []uuid.UUID {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]uuid.UUID(nil), s.tenants...)
}

// idemGateway is the gateway of cmd/api over a handler that creates something (201) instead of the 501 router.
func idemGateway(t *testing.T) (http.Handler, *spyStores, *atomic.Int64) {
	t.Helper()
	d := testDeps(testConfig())
	stores := &spyStores{store: idem.NewMemStore()}
	calls := &atomic.Int64{}
	created := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"id":"inv-1"}`)
	})
	g := &gateway{
		ops: newOpIndex(catalog.Operations), sessions: d.sessions, dir: d.dir, authz: d.authz,
		extra: []string{dev.LoginPath}, idem: &idem.Guard{Stores: stores},
	}
	r := newRouter(d)
	mux := http.NewServeMux()
	mux.Handle(dev.LoginPath, r)
	mux.Handle("/", created)
	return requestid.Middleware(g.middleware(mux)), stores, calls
}

func TestGatewayIdempotency(t *testing.T) {
	t.Parallel()
	h, stores, calls := idemGateway(t)
	owner := newClient(t, h).login("owner")
	hdr := map[string]string{"Origin": testOrigin, session.CSRFHeader: owner.csrf, idem.HeaderKey: "invite-0123456789abcdef"}
	path := "/api/v1/tenants/" + alta.String() + "/invitations"
	body := `{"email":"o.petrova@alta.example"}`

	first := owner.do(http.MethodPost, path, body, hdr)
	again := owner.do(http.MethodPost, path, body, hdr)
	if first.Code != http.StatusCreated || again.Code != http.StatusCreated || again.Body.String() != first.Body.String() {
		t.Fatalf("first %d %s, again %d %s", first.Code, first.Body, again.Code, again.Body)
	}
	if again.Header().Get(idem.HeaderReplayed) != "true" || calls.Load() != 1 {
		t.Fatalf("repeat not replayed: replayed=%q, handler calls %d", again.Header().Get(idem.HeaderReplayed), calls.Load())
	}
	if other := owner.do(http.MethodPost, path, `{"email":"k.gromov@alta.example"}`, hdr); other.Code != http.StatusConflict ||
		codeOf(other) != "idempotency_key_reused" {
		t.Fatalf("another body with the key: %d %s", other.Code, other.Body)
	}
	if got := stores.asked(); len(got) == 0 || got[0] != alta {
		t.Fatalf("store asked for %v, want the tenant of the path", got)
	}
}

func TestGatewayIdempotencyScope(t *testing.T) {
	t.Parallel()
	h, stores, calls := idemGateway(t)
	key := map[string]string{idem.HeaderKey: "scope-0123456789abcdef"}
	path := "/api/v1/tenants/" + alta.String() + "/invitations"

	// The permission check comes first: a refused command never touches the store.
	manager := newClient(t, h).login("manager")
	refused := manager.do(http.MethodPost, path, `{}`, map[string]string{
		"Origin": testOrigin, session.CSRFHeader: manager.csrf, idem.HeaderKey: key[idem.HeaderKey],
	})
	if refused.Code != http.StatusForbidden || len(stores.asked()) != 0 || calls.Load() != 0 {
		t.Fatalf("refused: %d, store asked %v, handler %d", refused.Code, stores.asked(), calls.Load())
	}
	// A read is never idempotency-guarded.
	owner := newClient(t, h).login("owner")
	if rec := owner.do(http.MethodGet, members(alta.String()), "", key); rec.Code != http.StatusCreated || len(stores.asked()) != 0 {
		t.Fatalf("GET with a key: %d, store asked %v", rec.Code, stores.asked())
	}
	// Without the key the handler runs every time (the strict server enforces the required header).
	csrf := map[string]string{"Origin": testOrigin, session.CSRFHeader: owner.csrf}
	owner.do(http.MethodPost, path, `{}`, csrf)
	owner.do(http.MethodPost, path, `{}`, csrf)
	if calls.Load() != 3 || len(stores.asked()) != 0 {
		t.Fatalf("without a key: handler %d, store asked %v", calls.Load(), stores.asked())
	}
	// An identity operation keeps its keys outside any tenant (uuid.Nil).
	hdr := map[string]string{"Origin": testOrigin, session.CSRFHeader: owner.csrf, idem.HeaderKey: key[idem.HeaderKey]}
	if rec := owner.do(http.MethodPut, "/api/v1/me/selected-tenant", `{"tenantId":"`+alta.String()+`"}`, hdr); rec.Code != http.StatusCreated {
		t.Fatalf("selectTenant: %d %s", rec.Code, rec.Body)
	}
	if got := stores.asked(); len(got) != 1 || got[0] != uuid.Nil {
		t.Fatalf("identity operation: store asked %v, want [uuid.Nil]", got)
	}
}
