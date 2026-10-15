package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/dev"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx/mehttp"
)

const testOrigin = "http://127.0.0.1:5213"

var (
	alta     = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa")
	lotos    = uuid.New()
	cargo    = uuid.New()
	remstroy = uuid.New()
)

type person struct {
	subject, issuer string
	acc             tenantctx.Account
	operator        bool
	memberships     []tenantctx.Membership
}

// world of the unit tests: a slice of the seed W0.06 (owner, manager without roles, operator) plus a member of a
// suspended and of a read-only tenant.
var people = []person{
	{"acc-1", dev.IssuerUsers, tenantctx.Account{ID: uuid.New(), DisplayName: "Дарья Зимина", Status: "active"}, false,
		[]tenantctx.Membership{{ID: uuid.New(), TenantID: alta, TenantName: "Альта Групп", TenantState: "trial", Status: "active", Owner: true}}},
	{"acc-2", dev.IssuerUsers, tenantctx.Account{ID: uuid.New(), DisplayName: "Марина Котова", Status: "active"}, false,
		[]tenantctx.Membership{{ID: uuid.New(), TenantID: alta, TenantName: "Альта Групп", TenantState: "trial", Status: "active"}}},
	{"op-1", dev.IssuerOperators, tenantctx.Account{ID: uuid.New(), DisplayName: "Евгения Лаптева", Status: "active"}, true, nil},
	{"acc-99", dev.IssuerUsers, tenantctx.Account{ID: uuid.New(), DisplayName: "Тест Состояний", Status: "active"}, false,
		[]tenantctx.Membership{
			{ID: uuid.New(), TenantID: cargo, TenantName: "Карго Сити", TenantState: "suspended", Status: "active", Owner: true},
			{ID: uuid.New(), TenantID: remstroy, TenantName: "Ремстрой Плюс", TenantState: "read_only", Status: "active", Owner: true},
		}},
}

type world struct{}

func (world) find(match func(person) bool) (person, bool) {
	for _, p := range people {
		if match(p) {
			return p, true
		}
	}
	return person{}, false
}

func (w world) AccountByID(_ context.Context, id uuid.UUID) (tenantctx.Account, error) {
	if p, ok := w.find(func(p person) bool { return p.acc.ID == id }); ok {
		return p.acc, nil
	}
	return tenantctx.Account{}, tenantctx.ErrNotFound
}

func (w world) AccountBySubject(_ context.Context, issuer, subject string) (tenantctx.Account, error) {
	if p, ok := w.find(func(p person) bool { return p.issuer == issuer && p.subject == subject }); ok {
		return p.acc, nil
	}
	return tenantctx.Account{}, tenantctx.ErrNotFound
}

func (w world) IsPlatformOperator(_ context.Context, id uuid.UUID) (bool, error) {
	p, _ := w.find(func(p person) bool { return p.acc.ID == id })
	return p.operator, nil
}

func (w world) Memberships(_ context.Context, id uuid.UUID) ([]tenantctx.Membership, error) {
	p, _ := w.find(func(p person) bool { return p.acc.ID == id })
	return p.memberships, nil
}

func (w world) Membership(ctx context.Context, account, tenant uuid.UUID) (tenantctx.Membership, error) {
	ms, _ := w.Memberships(ctx, account)
	for _, m := range ms {
		if m.TenantID == tenant {
			return m, nil
		}
	}
	return tenantctx.Membership{}, tenantctx.ErrNotFound
}

func (world) Routing(context.Context, uuid.UUID) (tenantctx.Routing, error) {
	return tenantctx.Routing{}, tenantctx.ErrNotFound
}

// tenantDB of the unit tests: no grants for anybody (roles are seeded by W1.04/W1.06), one home unit.
type tenantDB struct{ *tenantctx.GrantAuthorizer }

func (tenantDB) Grants(context.Context, tenantctx.TenantContext) ([]tenantctx.Grant, error) {
	return nil, nil
}

func (tenantDB) Profile(context.Context, tenantctx.TenantContext) (tenantctx.Profile, error) {
	return tenantctx.Profile{PolicyVersion: 1}, nil
}

func testConfig() config {
	return config{
		AppEnv: "dev", AuthProvider: "dev", SessionCookie: "ortus_sid", SessionTTL: 12 * time.Hour,
		AllowedOrigins: []string{testOrigin}, LogLevel: slog.LevelInfo,
	}
}

func testDeps(cfg config) deps {
	dir := world{}
	db := tenantDB{}
	db.GrantAuthorizer = &tenantctx.GrantAuthorizer{Source: db, TenantActions: catalog.TenantActions}
	return deps{
		cfg: cfg,
		log: slog.New(slog.DiscardHandler),
		dir: dir,
		sessions: &session.Manager{
			CookieName: cfg.SessionCookie, CSRFCookieName: csrfCookie, TTL: cfg.SessionTTL,
			AllowedOrigins: cfg.AllowedOrigins, Store: session.NewMemStore(),
		},
		authz:   db.GrantAuthorizer,
		servers: Servers{Context: &mehttp.Server{Dir: dir, TenantDB: db}},
	}
}

type client struct {
	t       *testing.T
	h       http.Handler
	cookies []*http.Cookie
	csrf    string
}

func newClient(t *testing.T, h http.Handler) *client {
	t.Helper()
	return &client{t: t, h: h}
}

func (c *client) do(method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	c.t.Helper()
	req := httptest.NewRequestWithContext(c.t.Context(), method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, ck := range c.cookies {
		req.AddCookie(ck)
	}
	rec := httptest.NewRecorder()
	c.h.ServeHTTP(rec, req)
	return rec
}

func (c *client) login(persona string) *client {
	c.t.Helper()
	rec := c.do(http.MethodPost, dev.LoginPath, `{"persona":"`+persona+`"}`, map[string]string{"Origin": testOrigin})
	if rec.Code != http.StatusOK {
		c.t.Fatalf("login %s: %d %s", persona, rec.Code, rec.Body)
	}
	c.cookies = rec.Result().Cookies()
	for _, ck := range c.cookies {
		if ck.Name == csrfCookie {
			c.csrf = ck.Value
		}
	}
	return c
}

func codeOf(rec *httptest.ResponseRecorder) string {
	var b problem.Body
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	return b.Code
}

func members(tenant string) string { return "/api/v1/tenants/" + tenant + "/members" }

// K-01, K-07 (WS-40): без сессии — 401 session_expired problem+json; X-Request-Id и Cache-Control на ответе.
func TestMeContextRequiresSession(t *testing.T) {
	t.Parallel()
	rec := newClient(t, newHandler(testDeps(testConfig()))).do(http.MethodGet, "/api/v1/me/context", "", nil)
	if rec.Code != http.StatusUnauthorized || codeOf(rec) != problem.CodeSessionExpired ||
		rec.Header().Get("Content-Type") != problem.ContentType || rec.Header().Get(requestid.Header) == "" ||
		rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("%d %v %s", rec.Code, rec.Header(), rec.Body)
	}
}

// S0-04: dev-вход → GET /me/context через шлюз и strict server тега Context.
func TestMeContextAfterDevLogin(t *testing.T) {
	t.Parallel()
	c := newClient(t, newHandler(testDeps(testConfig()))).login("owner")
	rec := c.do(http.MethodGet, "/api/v1/me/context", "", nil)
	var me struct {
		DisplayName string
		Tenants     []struct{ Name string }
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &me); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if me.DisplayName != "Дарья Зимина" || len(me.Tenants) != 1 || me.Tenants[0].Name != "Альта Групп" {
		t.Fatalf("me = %+v", me)
	}
}

// K-31 (WS-40), критерий этапа 0 «с проверкой права»: listMembers требует members.read — владелец проходит
// шлюз и получает 501 (тег не реализован), менеджер без ролей — 403 forbidden_action, без сессии — 401.
func TestTenantPermissionCheck(t *testing.T) {
	t.Parallel()
	h := newHandler(testDeps(testConfig()))
	cases := []struct {
		persona string
		status  int
		code    string
	}{
		{"owner", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"manager", http.StatusForbidden, problem.CodeForbiddenAction},
		{"", http.StatusUnauthorized, problem.CodeSessionExpired},
	}
	for _, tc := range cases {
		c := newClient(t, h)
		if tc.persona != "" {
			c.login(tc.persona)
		}
		rec := c.do(http.MethodGet, members(alta.String()), "", nil)
		if rec.Code != tc.status || codeOf(rec) != tc.code {
			t.Errorf("%q: %d %s", tc.persona, rec.Code, rec.Body)
		}
	}
}

// K-09 (WS-40; 12 §5 п.1): неизвестная, чужая, не-UUID организация, оператор на tenant-маршруте и несуществующий
// маршрут дают байт-в-байт одинаковые 404 при одном X-Request-Id.
func TestFourNotFoundsAreEqual(t *testing.T) {
	t.Parallel()
	h := newHandler(testDeps(testConfig()))
	owner, op, anon := newClient(t, h).login("owner"), newClient(t, h).login("operator"), newClient(t, h)
	rid := map[string]string{requestid.Header: "k09-fixed"}
	bodies := map[string]*httptest.ResponseRecorder{
		"неизвестная":  owner.do(http.MethodGet, members(uuid.NewString()), "", rid),
		"чужая":        owner.do(http.MethodGet, members(lotos.String()), "", rid),
		"не UUID":      owner.do(http.MethodGet, members("t-alta"), "", rid),
		"оператор":     op.do(http.MethodGet, members(alta.String()), "", rid),
		"нет маршрута": anon.do(http.MethodGet, "/api/v1/nope", "", rid),
	}
	want := bodies["нет маршрута"]
	for name, rec := range bodies {
		if rec.Code != http.StatusNotFound || !bytes.Equal(rec.Body.Bytes(), want.Body.Bytes()) {
			t.Errorf("%s: %d %q, want %q", name, rec.Code, rec.Body, want.Body)
		}
	}
}

// Ревью W0.09: %2F в сегменте пути не обходит шлюз. chi маршрутизирует по r.URL.RawPath, и шлюз сопоставляет
// операцию по тому же пути: аноним получает 401, менеджер без роли — 403, владелец проходит к обработчику (501).
func TestEncodedSlashDoesNotBypassGateway(t *testing.T) {
	t.Parallel()
	h := newHandler(testDeps(testConfig()))
	booking := "/api/v1/tenants/" + alta.String() + "/calendar/bookings/a%2Fb"
	cases := []struct {
		persona, path string
		status        int
		code          string
	}{
		{"", "/api/v1/tenants/x%2Fy/members", http.StatusUnauthorized, problem.CodeSessionExpired},
		{"", "/api/v1/platform/tenants/x%2Fy", http.StatusUnauthorized, problem.CodeSessionExpired},
		{"", booking, http.StatusUnauthorized, problem.CodeSessionExpired},
		{"manager", booking, http.StatusForbidden, problem.CodeForbiddenAction},
		{"owner", booking, http.StatusNotImplemented, problem.CodeNotImplemented},
		{"owner", "/api/v1/tenants/" + alta.String() + "%2Fx/members", http.StatusNotFound, problem.CodeNotFound},
		{"owner", "/api/v1/platform/tenants/x%2Fy", http.StatusNotFound, problem.CodeNotFound},
		{"operator", "/api/v1/platform/tenants/x%2Fy", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"", "/api/v1/me%2Fcontext", http.StatusNotFound, problem.CodeNotFound},
	}
	for _, tc := range cases {
		c := newClient(t, h)
		if tc.persona != "" {
			c.login(tc.persona)
		}
		rec := c.do(http.MethodGet, tc.path, "", nil)
		if rec.Code != tc.status || codeOf(rec) != tc.code {
			t.Errorf("%q %s: %d %s", tc.persona, tc.path, rec.Code, rec.Body)
		}
	}
}

// Шлюз fail-closed: запрос под /api/v1/, не совпавший ни с операцией каталога, ни со служебным маршрутом
// (dev-вход), не доходит до роутера — 404, даже если роутер нашёл бы обработчик.
func TestGatewayFailsClosed(t *testing.T) {
	t.Parallel()
	reached := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	d := testDeps(testConfig())
	g := &gateway{ops: newOpIndex(nil), sessions: d.sessions, dir: d.dir, authz: d.authz, extra: []string{dev.LoginPath}}
	h := requestid.Middleware(g.middleware(reached))
	cases := map[string]int{
		"/api/v1/me/context": http.StatusNotFound,
		"/api/v1/anything":   http.StatusNotFound,
		dev.LoginPath:        http.StatusTeapot,
		"/healthz":           http.StatusTeapot,
	}
	for path, want := range cases {
		rec := newClient(t, h).do(http.MethodGet, path, "", nil)
		if rec.Code != want {
			t.Errorf("%s: %d, want %d", path, rec.Code, want)
		}
	}
}

// K-12, K-13 (WS-40): организация suspended → 403 tenant_suspended; read_only: чтение проходит, изменение — 403.
func TestTenantStates(t *testing.T) {
	t.Parallel()
	c := newClient(t, newHandler(testDeps(testConfig()))).login("acc-99")
	csrf := map[string]string{"Origin": testOrigin, session.CSRFHeader: c.csrf}
	invite := `{"email":"x@example.com"}`
	cases := []struct {
		name, method, path, body string
		status                   int
		code                     string
	}{
		{"suspended", http.MethodGet, members(cargo.String()), "", http.StatusForbidden, problem.CodeTenantSuspended},
		{"read_only чтение", http.MethodGet, members(remstroy.String()), "", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"read_only изменение", http.MethodPost, "/api/v1/tenants/" + remstroy.String() + "/invitations", invite, http.StatusForbidden, problem.CodeTenantReadOnly},
	}
	for _, tc := range cases {
		rec := c.do(tc.method, tc.path, tc.body, csrf)
		if rec.Code != tc.status || codeOf(rec) != tc.code {
			t.Errorf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
	}
}

// K-04, K-05 (WS-40): изменяющая операция с cookie без X-CSRF-Token или с чужим Origin — 403.
func TestMutationNeedsCSRF(t *testing.T) {
	t.Parallel()
	c := newClient(t, newHandler(testDeps(testConfig()))).login("owner")
	path := "/api/v1/tenants/" + alta.String() + "/invitations"
	if rec := c.do(http.MethodPost, path, `{}`, map[string]string{"Origin": testOrigin}); codeOf(rec) != problem.CodeCSRFFailed {
		t.Errorf("no token: %d %s", rec.Code, rec.Body)
	}
	evil := map[string]string{"Origin": "https://evil.example", session.CSRFHeader: c.csrf}
	if rec := c.do(http.MethodPost, path, `{}`, evil); codeOf(rec) != problem.CodeOriginNotAllowed {
		t.Errorf("evil origin: %d %s", rec.Code, rec.Body)
	}
	ok := map[string]string{"Origin": testOrigin, session.CSRFHeader: c.csrf}
	if rec := c.do(http.MethodPost, path, `{}`, ok); codeOf(rec) != problem.CodeNotImplemented {
		t.Errorf("valid CSRF: %d %s", rec.Code, rec.Body)
	}
}

// K-15 (WS-40): платформенные операции — только оператору (501: тег не реализован); остальным — 404.
func TestPlatformOperations(t *testing.T) {
	t.Parallel()
	h := newHandler(testDeps(testConfig()))
	if rec := newClient(t, h).login("operator").do(http.MethodGet, "/api/v1/platform/tenants", "", nil); rec.Code != http.StatusNotImplemented {
		t.Errorf("operator: %d %s", rec.Code, rec.Body)
	}
	if rec := newClient(t, h).login("owner").do(http.MethodGet, "/api/v1/platform/tenants", "", nil); rec.Code != http.StatusNotFound {
		t.Errorf("owner: %d %s", rec.Code, rec.Body)
	}
}

// Публичная форма (security: [], x-public-capability) не требует сессии: шлюз её пропускает.
func TestPublicOperation(t *testing.T) {
	t.Parallel()
	rec := newClient(t, newHandler(testDeps(testConfig()))).do(http.MethodGet, "/api/v1/public/forms/tok", "", nil)
	if rec.Code != http.StatusNotImplemented || codeOf(rec) != problem.CodeNotImplemented {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// K-20 (WS-40, PD-18): dev-вход монтируется только при AUTH_PROVIDER=dev вне prod; иначе — 404.
func TestDevLoginOnlyWithDevProvider(t *testing.T) {
	t.Parallel()
	for _, tweak := range []func(*config){
		func(c *config) { c.AuthProvider = "oidc" },
		func(c *config) { c.AppEnv = "prod" },
	} {
		cfg := testConfig()
		tweak(&cfg)
		rec := newClient(t, newHandler(testDeps(cfg))).do(http.MethodPost, dev.LoginPath, `{"persona":"owner"}`, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%+v: %d %s", cfg, rec.Code, rec.Body)
		}
	}
}

// Каждая операция контракта смонтирована (реализация или 501), служебные маршруты — /healthz, /readyz и dev.
func TestEveryOperationIsMounted(t *testing.T) {
	t.Parallel()
	r := newRouter(testDeps(testConfig()))
	routes := map[string]bool{}
	err := chi.Walk(r, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		routes[method+" "+route] = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, op := range catalog.Operations {
		if !routes[op.Method+" "+op.Path] {
			t.Errorf("not mounted: %s %s (%s)", op.Method, op.Path, op.ID)
		}
	}
	for _, extra := range []string{"GET /healthz", "GET /readyz", "POST " + dev.LoginPath, "POST " + dev.LogoutPath} {
		if !routes[extra] {
			t.Errorf("not mounted: %s", extra)
		}
	}
	if want := len(catalog.Operations) + 4; len(routes) != want {
		t.Errorf("%d routes, want %d", len(routes), want)
	}
}

// K-36 (WS-40): /healthz — 200 без сессии и БД; /readyz — 503 dependency_unavailable, если control DB недоступна.
func TestHealth(t *testing.T) {
	t.Parallel()
	d := testDeps(testConfig())
	d.ready = func(context.Context) error { return io.ErrUnexpectedEOF }
	c := newClient(t, newHandler(d))
	if rec := c.do(http.MethodGet, "/healthz", "", nil); rec.Code != http.StatusOK {
		t.Errorf("healthz: %d", rec.Code)
	}
	if rec := c.do(http.MethodGet, "/readyz", "", nil); rec.Code != http.StatusServiceUnavailable || codeOf(rec) != problem.CodeDependencyUnavailable {
		t.Errorf("readyz: %d %s", rec.Code, rec.Body)
	}
}
