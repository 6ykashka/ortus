package mehttp

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	zimina   = uuid.MustParse("0281a55e-725e-53b1-920f-4189ab46e08a")
	operator = uuid.New()
	alta     = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa")
	lotos    = uuid.MustParse("e4f2195f-0000-5000-8000-000000000000")
	cargo    = uuid.New()
	home     = uuid.New()
)

type fakeDir struct {
	accounts    map[uuid.UUID]tenantctx.Account
	operators   map[uuid.UUID]bool
	memberships map[uuid.UUID][]tenantctx.Membership
	accErr      error // AccountByID fails with it (control DB down)
}

func (d *fakeDir) AccountByID(_ context.Context, id uuid.UUID) (tenantctx.Account, error) {
	if d.accErr != nil {
		return tenantctx.Account{}, d.accErr
	}
	if a, ok := d.accounts[id]; ok {
		return a, nil
	}
	return tenantctx.Account{}, tenantctx.ErrNotFound
}

func (d *fakeDir) AccountBySubject(context.Context, string, string) (tenantctx.Account, error) {
	return tenantctx.Account{}, tenantctx.ErrNotFound
}

func (d *fakeDir) IsPlatformOperator(_ context.Context, id uuid.UUID) (bool, error) {
	return d.operators[id], nil
}

func (d *fakeDir) Memberships(_ context.Context, id uuid.UUID) ([]tenantctx.Membership, error) {
	return d.memberships[id], nil
}

func (d *fakeDir) Membership(context.Context, uuid.UUID, uuid.UUID) (tenantctx.Membership, error) {
	return tenantctx.Membership{}, tenantctx.ErrNotFound
}

func (d *fakeDir) Routing(context.Context, uuid.UUID) (tenantctx.Routing, error) {
	return tenantctx.Routing{}, tenantctx.ErrNotFound
}

// fakeTenantDB answers Profile and Capabilities per tenant; a tenant listed in down fails.
type fakeTenantDB struct {
	policy map[uuid.UUID]int64
	down   map[uuid.UUID]bool
	calls  []uuid.UUID
}

func (f *fakeTenantDB) Profile(_ context.Context, tc tenantctx.TenantContext) (tenantctx.Profile, error) {
	f.calls = append(f.calls, tc.TenantID)
	if f.down[tc.TenantID] {
		return tenantctx.Profile{}, errors.New("tenant DB down")
	}
	h := home
	return tenantctx.Profile{HomeUnitID: &h, PolicyVersion: f.policy[tc.TenantID]}, nil
}

func (f *fakeTenantDB) Capabilities(_ context.Context, tc tenantctx.TenantContext) ([]tenantctx.Grant, error) {
	if tc.Owner {
		return []tenantctx.Grant{{Action: "members.read", ScopeKind: "tenant"}}, nil
	}
	unit := home
	return []tenantctx.Grant{
		{Action: "fleet.trips.read", ScopeKind: "unit", ScopeRef: &unit},
		{Action: "stock.read", ScopeKind: "warehouse", ScopeRef: &unit},
	}, nil
}

func m(tenant uuid.UUID, name, state, status string, owner bool) tenantctx.Membership {
	return tenantctx.Membership{
		ID: uuid.New(), TenantID: tenant, PersonProfileID: uuid.New(), TenantName: name,
		TenantState: state, Status: status, Owner: owner,
	}
}

func newServer() (*Server, *fakeTenantDB) {
	db := &fakeTenantDB{policy: map[uuid.UUID]int64{alta: 1, lotos: 1}, down: map[uuid.UUID]bool{}}
	dir := &fakeDir{
		accounts: map[uuid.UUID]tenantctx.Account{
			zimina:   {ID: zimina, DisplayName: "Дарья Зимина", Status: "active"},
			operator: {ID: operator, DisplayName: "Евгения Лаптева", Status: "active"},
		},
		operators: map[uuid.UUID]bool{operator: true},
		memberships: map[uuid.UUID][]tenantctx.Membership{zimina: {
			m(lotos, "SPA «Лотос»", "active", "active", false),
			m(alta, "Альта Групп", "trial", "active", true),
			m(cargo, "Карго Сити", "suspended", "ended", false),
			m(uuid.New(), "Ремстрой Плюс", "read_only", "invited", false),
			m(uuid.New(), "Закрыта", "closed", "active", false),
		}},
	}
	return &Server{Dir: dir, TenantDB: db}, db
}

func get(t *testing.T, s *Server, account uuid.UUID) (contextapi.MeContext, error) {
	t.Helper()
	ctx := session.WithSession(t.Context(), session.Session{ID: "sid", AccountID: account})
	resp, err := s.GetMyContext(ctx, contextapi.GetMyContextRequestObject{})
	if err != nil {
		return contextapi.MeContext{}, err
	}
	ok, isOK := resp.(contextapi.GetMyContext200JSONResponse)
	if !isOK {
		t.Fatalf("response %T", resp)
	}
	if ok.Headers.CacheControl == nil || *ok.Headers.CacheControl != "private, no-store" {
		t.Fatalf("Cache-Control = %v", ok.Headers.CacheControl)
	}
	return ok.Body, nil
}

// K-16…K-18 (WS-40; yaml:75 «Only active/recovery memberships»): в tenants[] — членства active и suspended,
// без invited/ended и без организаций provisioning/closing/closed; порядок — как у каталога (по имени);
// подразделение и возможности — из tenant DB; modules — [] до W1.07.
func TestMeContextMemberships(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	me, err := get(t, s, zimina)
	if err != nil {
		t.Fatal(err)
	}
	if me.DisplayName != "Дарья Зимина" || me.PlatformOperator || me.UserId != zimina || me.PermissionVersion == "" {
		t.Fatalf("me = %+v", me)
	}
	names := make([]string, 0, len(me.Tenants))
	for _, x := range me.Tenants {
		names = append(names, x.Name)
	}
	if strings.Join(names, ", ") != "SPA «Лотос», Альта Групп" {
		t.Fatalf("tenants = %v", names)
	}
}

func TestMeContextTenantFromTenantDB(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	me, err := get(t, s, zimina)
	if err != nil || len(me.Tenants) != 2 {
		t.Fatalf("me = %+v, %v", me, err)
	}
	a := me.Tenants[1]
	if a.TenantId != alta || a.MembershipStatus != contextapi.TenantContextMembershipStatusActive || a.Modules == nil || len(a.Modules) != 0 {
		t.Fatalf("alta = %+v", a)
	}
	if !slices.Equal(a.OrgUnitIds, []uuid.UUID{home}) {
		t.Fatalf("orgUnitIds = %v", a.OrgUnitIds)
	}
	if got := describe(a.Capabilities); got != "members.read@tenant[]" {
		t.Fatalf("owner capabilities = %s", got)
	}
	if got := describe(me.Tenants[0].Capabilities); got != "fleet.trips.read@org_unit["+home.String()+"]" {
		t.Fatalf("member capabilities (unit → org_unit, warehouse skipped) = %s", got)
	}
}

func describe(cs []contextapi.ScopedCapability) string {
	out := make([]string, 0, len(cs))
	for _, c := range cs {
		ids := make([]string, 0, len(c.Scope.ResourceIds))
		for _, id := range c.Scope.ResourceIds {
			ids = append(ids, id.String())
		}
		out = append(out, fmt.Sprintf("%s@%s[%s]", c.Permission, c.Scope.Kind, strings.Join(ids, ",")))
	}
	return strings.Join(out, " ")
}

// K-18: членство suspended видно со статусом, но tenant DB не читается — подразделений и возможностей нет.
func TestMeContextSuspendedMembership(t *testing.T) {
	t.Parallel()
	s, db := newServer()
	d, _ := s.Dir.(*fakeDir)
	d.memberships[zimina] = []tenantctx.Membership{m(alta, "Альта Групп", "active", "suspended", false)}
	me, err := get(t, s, zimina)
	if err != nil {
		t.Fatal(err)
	}
	if len(me.Tenants) != 1 || me.Tenants[0].MembershipStatus != contextapi.TenantContextMembershipStatusSuspended ||
		len(me.Tenants[0].OrgUnitIds) != 0 || len(me.Tenants[0].Capabilities) != 0 || len(db.calls) != 0 {
		t.Fatalf("tenants = %+v, tenant DB calls %v", me.Tenants, db.calls)
	}
}

// K-19: оператор платформы — platformOperator: true, tenants: [].
func TestMeContextOperator(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	me, err := get(t, s, operator)
	if err != nil || !me.PlatformOperator || me.Tenants == nil || len(me.Tenants) != 0 {
		t.Fatalf("me = %+v, %v", me, err)
	}
}

// Fail-closed: tenant DB недоступна (или sentinel не совпал) — организация в списке без подразделений
// и возможностей; ответ остальных организаций не ломается.
func TestMeContextTenantDBDown(t *testing.T) {
	t.Parallel()
	s, db := newServer()
	db.down[alta] = true
	me, err := get(t, s, zimina)
	if err != nil {
		t.Fatal(err)
	}
	if len(me.Tenants[1].OrgUnitIds) != 0 || len(me.Tenants[1].Capabilities) != 0 || len(me.Tenants[0].OrgUnitIds) != 1 {
		t.Fatalf("tenants = %+v", me.Tenants)
	}
}

// permissionVersion меняется вместе с access.policy_state любой организации.
func TestMeContextPermissionVersion(t *testing.T) {
	t.Parallel()
	s, db := newServer()
	v1, _ := get(t, s, zimina)
	db.policy[alta] = 2
	v2, _ := get(t, s, zimina)
	if v1.PermissionVersion == v2.PermissionVersion {
		t.Fatalf("permissionVersion did not change: %q", v1.PermissionVersion)
	}
}

// Операции тега Context этапа 1 (контракт 0.3.0-stage1: входящие уведомления) — у своего владельца W1.10; до него
// strict server отвечает 501 not_implemented, как нереализованный тег. selectTenant — W1.03 (select_tenant_test.go).
func TestStageOneContextOperationsNotImplemented(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	ctx := session.WithSession(t.Context(), session.Session{ID: "sid", AccountID: zimina})
	calls := map[string]func() error{
		"listMyNotifications": func() error {
			_, err := s.ListMyNotifications(ctx, contextapi.ListMyNotificationsRequestObject{})
			return err
		},
		"markMyNotificationsRead": func() error {
			_, err := s.MarkMyNotificationsRead(ctx, contextapi.MarkMyNotificationsReadRequestObject{})
			return err
		},
		"getMyNotificationSummary": func() error {
			_, err := s.GetMyNotificationSummary(ctx, contextapi.GetMyNotificationSummaryRequestObject{})
			return err
		},
	}
	for name, call := range calls {
		if err := call(); !problem.Is(err, problem.CodeNotImplemented) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// K-01: без сессии (или с удалённым аккаунтом) — session_expired.
func TestMeContextWithoutSession(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	if _, err := s.GetMyContext(t.Context(), contextapi.GetMyContextRequestObject{}); !problem.Is(err, problem.CodeSessionExpired) {
		t.Fatalf("no session: %v", err)
	}
	if _, err := get(t, s, uuid.New()); !problem.Is(err, problem.CodeSessionExpired) {
		t.Fatalf("unknown account: %v", err)
	}
}

// Ревью W0.09: сбой control DB при чтении аккаунта — 503 dependency_unavailable («Нет связи»), а не 401;
// неизвестный и не-active аккаунт — 401 session_expired.
func TestMeContextAccountLookup(t *testing.T) {
	t.Parallel()
	s, _ := newServer()
	d, _ := s.Dir.(*fakeDir)
	d.accounts[operator] = tenantctx.Account{ID: operator, DisplayName: "Евгения Лаптева", Status: "blocked"}
	if _, err := get(t, s, operator); !problem.Is(err, problem.CodeSessionExpired) {
		t.Fatalf("blocked account: %v", err)
	}
	d.accErr = errors.New("control DB: connection refused")
	if _, err := get(t, s, zimina); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Fatalf("control DB down: %v", err)
	}
}
