package mehttp

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// selDir answers Membership from the memberships of fakeDir.
type selDir struct{ *fakeDir }

func (d selDir) Membership(_ context.Context, account, tenant uuid.UUID) (tenantctx.Membership, error) {
	for _, m := range d.memberships[account] {
		if m.TenantID == tenant {
			return m, nil
		}
	}
	return tenantctx.Membership{}, tenantctx.ErrNotFound
}

type memLast struct {
	mu   sync.Mutex
	last map[uuid.UUID]uuid.UUID
	err  error
}

func (l *memLast) LastTenant(_ context.Context, account uuid.UUID) (*uuid.UUID, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.err != nil {
		return nil, l.err
	}
	if t, ok := l.last[account]; ok {
		return &t, nil
	}
	return nil, nil
}

func (l *memLast) SetLastTenant(_ context.Context, account, tenant uuid.UUID) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.err != nil {
		return l.err
	}
	if l.last == nil {
		l.last = map[uuid.UUID]uuid.UUID{}
	}
	l.last[account] = tenant
	return nil
}

func selectServer(t *testing.T) (*Server, *memLast) {
	t.Helper()
	s, _ := newServer()
	dir, ok := s.Dir.(*fakeDir)
	if !ok {
		t.Fatalf("dir %T", s.Dir)
	}
	last := &memLast{}
	s.Dir, s.LastTenants = selDir{dir}, last
	return s, last
}

func selectTenant(t *testing.T, s *Server, account, tenant uuid.UUID) (contextapi.MeContext, error) {
	t.Helper()
	ctx := session.WithSession(t.Context(), session.Session{ID: "sid", AccountID: account})
	resp, err := s.SelectTenant(ctx, contextapi.SelectTenantRequestObject{Body: &contextapi.TenantSelection{TenantId: tenant}})
	if err != nil {
		return contextapi.MeContext{}, err
	}
	ok, isOK := resp.(contextapi.SelectTenant200JSONResponse)
	if !isOK {
		t.Fatalf("response %T", resp)
	}
	if ok.Headers.CacheControl == nil || *ok.Headers.CacheControl != "private, no-store" {
		t.Fatalf("Cache-Control = %v", ok.Headers.CacheControl)
	}
	return ok.Body, nil
}

// S1-07: the business chosen in the switcher is remembered and the refreshed context is returned.
func TestSelectTenant(t *testing.T) {
	t.Parallel()
	s, last := selectServer(t)
	mc, err := selectTenant(t, s, zimina, alta)
	if err != nil {
		t.Fatal(err)
	}
	if mc.LastTenantId == nil || *mc.LastTenantId != alta || len(mc.Tenants) != 2 || mc.UserId != zimina {
		t.Fatalf("context %+v", mc)
	}
	if last.last[zimina] != alta {
		t.Fatalf("stored %v", last.last)
	}
}

// Only an active membership of a business that exists for its people: anything else is the same 404 as an unknown id.
func TestSelectTenantRefuses(t *testing.T) {
	t.Parallel()
	s, last := selectServer(t)
	dir := s.Dir.(selDir) //nolint:forcetypeassert // set by selectServer
	ms := dir.memberships[zimina]
	for name, tenant := range map[string]uuid.UUID{
		"ended membership":   cargo,
		"invited membership": ms[3].TenantID,
		"closed business":    ms[4].TenantID,
		"foreign business":   uuid.New(),
	} {
		if _, err := selectTenant(t, s, zimina, tenant); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
	if len(last.last) != 0 {
		t.Fatalf("a refused selection was stored: %v", last.last)
	}
	if _, err := s.SelectTenant(t.Context(), contextapi.SelectTenantRequestObject{Body: &contextapi.TenantSelection{TenantId: alta}}); !problem.Is(err, problem.CodeSessionExpired) {
		t.Errorf("without session: %v", err)
	}
	last.err = errors.New("control DB down")
	if _, err := selectTenant(t, s, zimina, alta); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("store down: %v", err)
	}
}

// getMyContext returns lastTenantId only while it is a visible business of an active membership.
func TestGetMyContextLastTenant(t *testing.T) {
	t.Parallel()
	s, last := selectServer(t)
	last.last = map[uuid.UUID]uuid.UUID{zimina: lotos}
	mc, err := get(t, s, zimina)
	if err != nil || mc.LastTenantId == nil || *mc.LastTenantId != lotos {
		t.Fatalf("lastTenantId = %v, %v; want lotos", mc.LastTenantId, err)
	}
	last.last[zimina] = cargo // the membership ended since
	if mc, _ := get(t, s, zimina); mc.LastTenantId != nil {
		t.Fatalf("stale lastTenantId %v must be omitted", *mc.LastTenantId)
	}
	s.LastTenants = nil
	if mc, _ := get(t, s, zimina); mc.LastTenantId != nil {
		t.Fatal("without a store there is no lastTenantId")
	}
}
