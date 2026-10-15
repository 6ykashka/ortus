package tenantctx

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// fakeDir is an in-memory Directory: memberships by account, routing by tenant.
type fakeDir struct {
	accounts    map[uuid.UUID]Account
	subjects    map[string]uuid.UUID // issuer + " " + subject
	operators   map[uuid.UUID]bool
	memberships map[uuid.UUID][]Membership
	routing     map[uuid.UUID]Routing
	err         error
}

func (d *fakeDir) AccountByID(_ context.Context, id uuid.UUID) (Account, error) {
	if a, ok := d.accounts[id]; ok {
		return a, d.err
	}
	return Account{}, ErrNotFound
}

func (d *fakeDir) AccountBySubject(_ context.Context, issuer, subject string) (Account, error) {
	if id, ok := d.subjects[issuer+" "+subject]; ok {
		return d.accounts[id], d.err
	}
	return Account{}, ErrNotFound
}

func (d *fakeDir) IsPlatformOperator(_ context.Context, id uuid.UUID) (bool, error) {
	return d.operators[id], d.err
}

func (d *fakeDir) Memberships(_ context.Context, id uuid.UUID) ([]Membership, error) {
	return d.memberships[id], d.err
}

func (d *fakeDir) Membership(_ context.Context, account, tenant uuid.UUID) (Membership, error) {
	if d.err != nil {
		return Membership{}, d.err
	}
	for _, m := range d.memberships[account] {
		if m.TenantID == tenant {
			return m, nil
		}
	}
	return Membership{}, ErrNotFound
}

func (d *fakeDir) Routing(_ context.Context, tenant uuid.UUID) (Routing, error) {
	if r, ok := d.routing[tenant]; ok {
		return r, nil
	}
	return Routing{}, ErrNotFound
}

var (
	acc    = uuid.MustParse("0281a55e-725e-53b1-920f-4189ab46e08a")
	tenant = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa")
	person = uuid.MustParse("b8df06ec-317e-5f46-b54c-e76603e41b5b")
)

func dirWith(status, state string, owner bool) *fakeDir {
	return &fakeDir{memberships: map[uuid.UUID][]Membership{acc: {{
		ID: uuid.New(), TenantID: tenant, TenantName: "Альта Групп", TenantState: state,
		Status: status, PersonProfileID: person, Owner: owner,
	}}}}
}

// 10 §3.3, 12 §5 п.2 (WS-40 K-10…K-14): членство проверяется до состояния организации; чужая, неизвестная,
// неактивная и невалидная организация неотличимы (404); suspended → 403; grace/read_only → только чтение.
func TestResolve(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, raw, status, state string
		mutating                 bool
		code                     string
		readOnly                 bool
	}{
		{"активное членство, trial", tenant.String(), "active", "trial", false, "", false},
		{"активное членство, active, изменение", tenant.String(), "active", "active", true, "", false},
		{"не UUID — 404, формат не раскрывается", "t-alta", "active", "active", false, problem.CodeNotFound, false},
		{"чужая организация", uuid.NewString(), "active", "active", false, problem.CodeNotFound, false},
		{"членство suspended", tenant.String(), "suspended", "active", false, problem.CodeNotFound, false},
		{"членство invited", tenant.String(), "invited", "active", false, problem.CodeNotFound, false},
		{"членство ended", tenant.String(), "ended", "active", false, problem.CodeNotFound, false},
		{"организация suspended", tenant.String(), "active", "suspended", false, problem.CodeTenantSuspended, false},
		{"организация provisioning", tenant.String(), "active", "provisioning", false, problem.CodeNotFound, false},
		{"организация closing", tenant.String(), "active", "closing", false, problem.CodeNotFound, false},
		{"организация closed", tenant.String(), "active", "closed", false, problem.CodeNotFound, false},
		{"read_only: чтение проходит", tenant.String(), "active", "read_only", false, "", true},
		{"grace: чтение проходит", tenant.String(), "active", "grace", false, "", true},
		{"read_only: изменение — 403", tenant.String(), "active", "read_only", true, problem.CodeTenantReadOnly, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tcx, err := Resolve(t.Context(), dirWith(tc.status, tc.state, true), acc, tc.raw, tc.mutating)
			if tc.code != "" {
				if !problem.Is(err, tc.code) {
					t.Fatalf("err = %v, want %s", err, tc.code)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if tcx.TenantID != tenant || tcx.AccountID != acc || tcx.PersonID != person || !tcx.Owner || tcx.ReadOnly != tc.readOnly {
				t.Fatalf("context = %+v", tcx)
			}
		})
	}
}

func TestResolveDirectoryError(t *testing.T) {
	t.Parallel()
	d := dirWith("active", "active", false)
	d.err = errors.New("control DB down")
	if _, err := Resolve(t.Context(), d, acc, tenant.String(), false); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

type fakeGrants struct {
	grants []Grant
	err    error
	calls  int
}

func (f *fakeGrants) Grants(context.Context, TenantContext) ([]Grant, error) {
	f.calls++
	return f.grants, f.err
}

// Шаблон owner (permissions.yaml): «Владение — OwnerBinding, не роль. Шаблон даёт все tenant actions».
// Остальные — grants области tenant из tenant DB; области уже tenant (unit, project…) права на операцию без
// объекта не дают до оценщика W1.04 (fail-closed). x-permissions-mode: all — все ключи, any — хотя бы один.
func TestGrantAuthorizer(t *testing.T) {
	t.Parallel()
	unit := uuid.New()
	src := &fakeGrants{grants: []Grant{
		{Action: "members.read", ScopeKind: "tenant"},
		{Action: "roles.read", ScopeKind: "unit", ScopeRef: &unit},
	}}
	a := &GrantAuthorizer{Source: src, TenantActions: []string{"members.invite", "members.read", "roles.read"}}
	owner := TenantContext{TenantID: tenant, Owner: true}
	member := TenantContext{TenantID: tenant}
	cases := []struct {
		name  string
		tc    TenantContext
		perms []string
		mode  string
		ok    bool
	}{
		{"без x-permissions — пропускает", member, nil, "all", true},
		{"владелец: tenant action", owner, []string{"members.invite"}, "all", true},
		{"владелец: право платформы — нет", owner, []string{"platform.tenants.read"}, "all", false},
		{"участник: grant области tenant", member, []string{"members.read"}, "all", true},
		{"участник: grant области unit без объекта — нет", member, []string{"roles.read"}, "all", false},
		{"участник: нет grant", member, []string{"members.invite"}, "all", false},
		{"участник: all — нужны все", member, []string{"members.read", "members.invite"}, "all", false},
		{"участник: any — хватит одного", member, []string{"members.invite", "members.read"}, "any", true},
	}
	for _, tc := range cases {
		err := a.Permit(t.Context(), tc.tc, tc.perms, tc.mode)
		if tc.ok && err != nil || !tc.ok && !problem.Is(err, problem.CodeForbiddenAction) {
			t.Errorf("%s: %v", tc.name, err)
		}
	}
}

func TestGrantAuthorizerSourceError(t *testing.T) {
	t.Parallel()
	a := &GrantAuthorizer{Source: &fakeGrants{err: errors.New("tenant DB down")}}
	err := a.Permit(t.Context(), TenantContext{TenantID: tenant}, []string{"members.read"}, "all")
	if !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

// /me/context: владелец получает все tenant actions в области tenant; участник — свои grants.
func TestCapabilities(t *testing.T) {
	t.Parallel()
	src := &fakeGrants{grants: []Grant{{Action: "members.read", ScopeKind: "tenant"}}}
	a := &GrantAuthorizer{Source: src, TenantActions: []string{"b.x", "a.x"}}
	got, err := a.Capabilities(t.Context(), TenantContext{Owner: true})
	if err != nil || len(got) != 2 || got[0].Action != "a.x" || got[0].ScopeKind != "tenant" || src.calls != 0 {
		t.Fatalf("owner: %+v, %v (source calls %d)", got, err, src.calls)
	}
	got, err = a.Capabilities(t.Context(), TenantContext{})
	if err != nil || !slices.Equal(actions(got), []string{"members.read"}) {
		t.Fatalf("member: %+v, %v", got, err)
	}
}

func actions(gs []Grant) []string {
	out := make([]string, 0, len(gs))
	for _, g := range gs {
		out = append(out, g.Action)
	}
	return out
}

// K-32 (WS-40, 09 I-22): пул tenant DB открывается только по ссылке на секрет env:<VAR>; без маршрута, с иной
// схемой ссылки или пустой переменной — dependency_unavailable, DSN и пароль не попадают в текст ошибки.
func TestPoolsSecretRef(t *testing.T) {
	t.Parallel()
	d := &fakeDir{routing: map[uuid.UUID]Routing{
		tenant: {TenantID: tenant, DatabaseName: "t_alta", SecretRef: "vault:kv/t_alta", Sentinel: uuid.New()}, //nolint:gosec // G101: test fixture
	}}
	env := map[string]string{"TENANT_DB_URL": "postgres://ortus_api:p4ss@127.0.0.1:1/?sslmode=disable"} //nolint:gosec // G101: test fixture
	p := NewPools(d, func(k string) string { return env[k] }, "")
	p.RetryAfter = 0 // every call below must try to open again
	defer p.Close()
	for name, id := range map[string]uuid.UUID{"нет маршрута": uuid.New(), "не env:": tenant} {
		_, err := p.For(t.Context(), id)
		if !problem.Is(err, problem.CodeDependencyUnavailable) {
			t.Errorf("%s: %v", name, err)
		}
	}
	d.routing[tenant] = Routing{TenantID: tenant, DatabaseName: "t_alta", SecretRef: "env:EMPTY", Sentinel: uuid.New()}
	if _, err := p.For(t.Context(), tenant); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("empty variable: %v", err)
	}
	d.routing[tenant] = Routing{TenantID: tenant, DatabaseName: "t_alta", SecretRef: "env:TENANT_DB_URL", Sentinel: uuid.New()} //nolint:gosec // G101: test fixture
	_, err := p.For(t.Context(), tenant)                                                                                        // nothing listens on port 1
	if !problem.Is(err, problem.CodeDependencyUnavailable) || strings.Contains(err.Error(), "p4ss") {
		t.Errorf("unreachable DB: %v", err)
	}
	if len(p.Opened()) != 0 {
		t.Errorf("failed pools are cached: %v", p.Opened())
	}
}

// slowDir answers Routing of the tenant hung only when release is closed or the context ends; other tenants have
// no route. It counts Routing calls per tenant.
type slowDir struct {
	fakeDir
	hung    uuid.UUID
	entered chan struct{}
	release chan struct{}
	mu      sync.Mutex
	calls   map[uuid.UUID]int
}

func newSlowDir() *slowDir {
	return &slowDir{hung: tenant, entered: make(chan struct{}, 8), release: make(chan struct{}), calls: map[uuid.UUID]int{}}
}

func (d *slowDir) Routing(ctx context.Context, id uuid.UUID) (Routing, error) {
	d.mu.Lock()
	d.calls[id]++
	d.mu.Unlock()
	if id != d.hung {
		return Routing{}, ErrNotFound
	}
	d.entered <- struct{}{}
	select {
	case <-d.release:
	case <-ctx.Done():
		return Routing{}, ctx.Err()
	case <-time.After(5 * time.Second): // keeps a red test from hanging forever
	}
	return Routing{}, ErrNotFound
}

func (d *slowDir) count(id uuid.UUID) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.calls[id]
}

// Ревью W0.09: открытие пула одной организации не блокирует пулы других — зависшая tenant DB (здесь — зависший
// маршрут) не держит общий замок.
func TestPoolsOpenIsPerTenant(t *testing.T) {
	t.Parallel()
	d := newSlowDir()
	p := NewPools(d, func(string) string { return "" }, "")
	defer p.Close()
	defer close(d.release)
	go func() { _, _ = p.For(context.WithoutCancel(t.Context()), tenant) }()
	<-d.entered
	done := make(chan error, 1)
	go func() {
		_, err := p.For(t.Context(), uuid.New())
		done <- err
	}()
	select {
	case err := <-done:
		if !problem.Is(err, problem.CodeDependencyUnavailable) {
			t.Fatalf("other tenant: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("another tenant waits for the hung one")
	}
}

// Открытие пула ограничено OpenTimeout, даже если у запроса нет дедлайна; запрос с дедлайном не ждёт дольше
// своего контекста.
func TestPoolsOpenTimeout(t *testing.T) {
	t.Parallel()
	p := NewPools(newSlowDir(), func(string) string { return "" }, "")
	p.OpenTimeout = 50 * time.Millisecond
	defer p.Close()
	start := time.Now()
	if _, err := p.For(t.Context(), tenant); !problem.Is(err, problem.CodeDependencyUnavailable) || time.Since(start) > time.Second {
		t.Fatalf("OpenTimeout: %v after %s", err, time.Since(start))
	}

	p2 := NewPools(newSlowDir(), func(string) string { return "" }, "")
	defer p2.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	start = time.Now()
	if _, err := p2.For(ctx, tenant); !problem.Is(err, problem.CodeDependencyUnavailable) || time.Since(start) > time.Second {
		t.Fatalf("request deadline: %v after %s", err, time.Since(start))
	}
}

// Неудачное открытие запоминается на RetryAfter: повторный запрос в этом окне не идёт в БД снова; после окна —
// новая попытка. Одновременные запросы к одной организации открывают пул один раз.
func TestPoolsFailureIsCachedBriefly(t *testing.T) {
	t.Parallel()
	d := newSlowDir()
	d.hung = uuid.Nil
	now := time.Unix(0, 0)
	var mu sync.Mutex
	p := NewPools(d, func(string) string { return "" }, "")
	p.Now = func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
	p.RetryAfter = 5 * time.Second
	defer p.Close()
	other := uuid.New()
	for range 3 {
		if _, err := p.For(t.Context(), other); !problem.Is(err, problem.CodeDependencyUnavailable) {
			t.Fatal(err)
		}
	}
	if got := d.count(other); got != 1 {
		t.Fatalf("Routing calls within RetryAfter = %d, want 1", got)
	}
	mu.Lock()
	now = now.Add(6 * time.Second)
	mu.Unlock()
	_, _ = p.For(t.Context(), other)
	if got := d.count(other); got != 2 {
		t.Fatalf("Routing calls after RetryAfter = %d, want 2", got)
	}
}

func TestContext(t *testing.T) {
	t.Parallel()
	if _, ok := FromContext(t.Context()); ok {
		t.Fatal("empty context has a tenant")
	}
	tc := TenantContext{TenantID: tenant}
	if got, ok := FromContext(WithTenant(t.Context(), tc)); !ok || got.TenantID != tenant {
		t.Fatalf("FromContext = %+v, %v", got, ok)
	}
}
