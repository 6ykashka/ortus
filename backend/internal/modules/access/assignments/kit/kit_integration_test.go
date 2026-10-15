//go:build integration

package kit_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit"        //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var server *accesstest.Server

func TestMain(m *testing.M) {
	s, stop, err := accesstest.Start(context.Background())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	server = s
	code := m.Run()
	stop()
	os.Exit(code)
}

func tx(t *testing.T, w *accesstest.World, fn func(pgx.Tx)) {
	t.Helper()
	ctx := w.Ctx(w.Anyone())
	tx, err := w.Tenant.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	fn(tx)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

// sodWorld: водитель, бывший водитель, менеджер с начислениями прямо, участник группы с начислениями, участник
// группы со снятым назначением.
type sodWorld struct {
	w                                                 *accesstest.World
	firm, driver, manager, viaGroup, revoked, retired uuid.UUID
	earnings                                          uuid.UUID
}

func newSoDWorld(t *testing.T) sodWorld {
	t.Helper()
	w := server.NewWorld(t)
	s := sodWorld{w: w}
	s.firm = w.Unit("Москва-1", uuid.Nil)
	s.driver, s.manager, s.viaGroup = w.Card("Водитель", s.firm), w.Card("Менеджер", s.firm), w.Card("Через группу", s.firm)
	s.revoked, s.retired = w.Card("Снятая группа", s.firm), w.Card("Бывший водитель", s.firm)
	ended := w.Now.Add(-24 * time.Hour)
	w.Function(s.driver, "driver", s.firm, nil)
	w.Function(s.retired, "driver", s.firm, &ended)
	s.earnings = w.Role("Начисления", "custom", "", "fleet.earnings.read")
	w.Assign(accesstest.Grant{Principal: s.manager, Role: s.earnings, Kind: "unit", Ref: s.firm})
	finance := w.Group("Финансы", uuid.Nil, s.viaGroup)
	w.Assign(accesstest.Grant{Group: true, Principal: finance, Role: s.earnings, Kind: "unit", Ref: s.firm})
	old := w.Group("Старые финансы", uuid.Nil, s.revoked)
	w.Assign(accesstest.Grant{Group: true, Principal: old, Role: s.earnings, Kind: "tenant", State: "revoked"})
	return s
}

// D-10: функция driver в сроке назначения.
func TestDriverConflict(t *testing.T) {
	t.Parallel()
	s := newSoDWorld(t)
	now := s.w.Now
	for name, tc := range map[string]struct {
		persons []uuid.UUID
		from    time.Time
		want    bool
	}{
		"действующий водитель":            {[]uuid.UUID{s.driver}, now, true},
		"водитель среди нескольких":       {[]uuid.UUID{s.manager, s.driver}, now, true},
		"не водитель":                     {[]uuid.UUID{s.manager}, now, false},
		"функция закончилась до срока":    {[]uuid.UUID{s.retired}, now, false},
		"срок пересекает прошлую функцию": {[]uuid.UUID{s.retired}, now.Add(-48 * time.Hour), true},
		"нет людей":                       {nil, now, false},
	} {
		got, err := kit.DriverConflict(t.Context(), s.w.Tenant, tc.persons, tc.from, nil)
		if err != nil || got != tc.want {
			t.Errorf("%s: %v %v, want %v", name, got, err, tc.want)
		}
	}
}

// D-10 в обратную сторону: начисления прямо и через живую группу; снятое назначение не считается.
func TestEarningsConflict(t *testing.T) {
	t.Parallel()
	s := newSoDWorld(t)
	closed := kit.ClosedByDriver(authz.DefaultPolicy())
	for name, tc := range map[string]struct {
		persons []uuid.UUID
		closed  []string
		want    bool
	}{
		"прямое назначение":              {[]uuid.UUID{s.manager}, closed, true},
		"через группу":                   {[]uuid.UUID{s.viaGroup}, closed, true},
		"снятое назначение не считается": {[]uuid.UUID{s.revoked}, closed, false},
		"без начислений":                 {[]uuid.UUID{s.driver}, closed, false},
		"нет закрытых действий":          {[]uuid.UUID{s.manager}, nil, false},
	} {
		got, err := kit.EarningsConflict(t.Context(), s.w.Tenant, tc.persons, tc.closed, s.w.Now, nil)
		if err != nil || got != tc.want {
			t.Errorf("%s: %v %v, want %v", name, got, err, tc.want)
		}
	}
}

// Роль, назначенная водителю прямо или через группу, — «роль назначена водителю».
func TestRoleHeldByDriver(t *testing.T) {
	t.Parallel()
	s := newSoDWorld(t)
	w := s.w
	plain := w.Role("Рейсы", "custom", "", "fleet.trips.read")
	other := w.Role("Ещё роль", "custom", "")
	w.Assign(accesstest.Grant{Principal: s.driver, Role: plain, Kind: "self"})
	drivers := w.Group("Водители", s.firm, s.driver)
	w.Assign(accesstest.Grant{Group: true, Principal: drivers, Role: other, Kind: "unit", Ref: s.firm, Descendants: true})
	for role, want := range map[uuid.UUID]bool{s.earnings: false, plain: true, other: true} {
		if held, err := kit.RoleHeldByDriver(t.Context(), w.Tenant, role, w.Now); err != nil || held != want {
			t.Errorf("role %s: %v %v, want %v", role, held, err, want)
		}
	}
}

// policy_version + 1 и событие access.policy.bumped.v1 в той же транзакции; аудит изменения доступа.
func TestBumpPolicyAuditAndPublish(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	before := w.PolicyVersion()
	var v int64
	tx(t, w, func(tx pgx.Tx) {
		var err error
		if v, err = kit.BumpPolicy(w.Ctx(w.Anyone()), tx, w.TenantID, nil, "role.update"); err != nil {
			t.Fatal(err)
		}
		if err := kit.Audit(w.Ctx(w.Anyone()), tx, kit.Change{Action: "access.role.update", TargetType: "access.role",
			TargetID: uuid.New(), Diff: map[string]any{"added": []string{"fleet.earnings.read"}}}); err != nil {
			t.Fatal(err)
		}
	})
	version := strconv.FormatInt(v, 10)
	if v != before+1 || w.PolicyVersion() != v {
		t.Errorf("policy version %d → %d (stored %d)", before, v, w.PolicyVersion())
	}
	if n := w.Count(`select 1 from outbox.events where type = 'access.policy.bumped.v1' and payload->>'policyVersion' = $1
		and payload->>'reason' = 'role.update'`, version); n != 1 {
		t.Errorf("policy events: %d", n)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.role.update' and sensitivity = 'sensitive' and request_id <> ''`); n != 1 {
		t.Errorf("audit: %d", n)
	}
	if got, err := kit.PolicyVersion(t.Context(), w.Tenant); err != nil || got != version {
		t.Errorf("PolicyVersion = %q %v", got, err)
	}
}

// Цели делегирования: поддерево подразделения — каждое подразделение; без поддерева — одно; своё — домашнее
// подразделение; объект — объект; организация — нулевой ресурс.
func TestTargets(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	region := w.Unit("Москва", uuid.Nil)
	f1, f2 := w.Unit("Москва-1", region), w.Unit("Москва-2", region)
	project := uuid.New()
	tenantWide := authz.Resource{}
	onProject := authz.Resource{Objects: map[string]uuid.UUID{authz.KindProject: project}}
	for name, tc := range map[string]struct {
		scope  authz.Scope
		anchor uuid.UUID
		want   []authz.Resource
	}{
		"поддерево":            {authz.Scope{Kind: authz.KindUnit, Ref: region, Descendants: true}, uuid.Nil, []authz.Resource{{Unit: region}, {Unit: f1}, {Unit: f2}}},
		"подразделение":        {authz.Scope{Kind: authz.KindUnit, Ref: region}, uuid.Nil, []authz.Resource{{Unit: region}}},
		"своё":                 {authz.Scope{Kind: authz.KindSelf}, f1, []authz.Resource{{Unit: f1}}},
		"своё группы без дома": {authz.Scope{Kind: authz.KindSelf}, uuid.Nil, []authz.Resource{tenantWide}},
		"организация":          {authz.Scope{Kind: authz.KindTenant}, f1, []authz.Resource{tenantWide}},
		"проект (PD-53)":       {authz.Scope{Kind: authz.KindProject, Ref: project}, f1, []authz.Resource{onProject}},
	} {
		got, err := kit.Targets(t.Context(), w.Tenant, tc.scope, tc.anchor)
		if err != nil || !sameTargets(got, tc.want) {
			t.Errorf("%s: %+v %v, want %+v", name, got, err, tc.want)
		}
	}
}

func sameTargets(got, want []authz.Resource) bool {
	key := func(r authz.Resource) string { return r.Unit.String() + "|" + r.Object(authz.KindProject).String() }
	a, b := make([]string, 0, len(got)), make([]string, 0, len(want))
	for _, r := range got {
		a = append(a, key(r))
	}
	for _, r := range want {
		b = append(b, key(r))
	}
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}
func TestHomeUnitAndUnitExists(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	firm := w.Unit("Москва-1", uuid.Nil)
	person := w.Card("Карточка", firm)
	group := w.Group("Вся организация", uuid.Nil)
	local := w.Group("Москва-1", firm)
	ctx := t.Context()
	if h, err := kit.HomeUnit(ctx, w.Tenant, false, person); err != nil || h != firm {
		t.Errorf("person: %s %v", h, err)
	}
	if h, err := kit.HomeUnit(ctx, w.Tenant, true, group); err != nil || h != uuid.Nil {
		t.Errorf("tenant-wide group: %s %v", h, err)
	}
	if h, err := kit.HomeUnit(ctx, w.Tenant, true, local); err != nil || h != firm {
		t.Errorf("group: %s %v", h, err)
	}
	for _, id := range []uuid.UUID{uuid.New(), firm} {
		if _, err := kit.HomeUnit(ctx, w.Tenant, false, id); code(err) != "not_found" {
			t.Errorf("unknown person %s: %v", id, err)
		}
	}
	if err := kit.UnitExists(ctx, w.Tenant, firm); err != nil {
		t.Error(err)
	}
	if err := kit.UnitExists(ctx, w.Tenant, person); code(err) != "not_found" {
		t.Errorf("not a unit: %v", err)
	}
}

// Без записи Idempotency-Key (вызов вне шлюза) Complete ничего не делает.
func TestCompleteWithoutRecord(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	tx(t, w, func(tx pgx.Tx) {
		if err := kit.Complete(t.Context(), tx, 201, kit.ETag(1), map[string]string{"a": "b"}); err != nil {
			t.Fatal(err)
		}
	})
}

// TxScope ставит предикат области в транзакции команды, как scopeddb: менеджер фирмы видит строки своей фирмы,
// запрос без {{scope}} отклоняется.
func TestTxScope(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	f1, f2 := w.Unit("Москва-1", uuid.Nil), w.Unit("Москва-2", uuid.Nil)
	manager := w.Card("Менеджер", f1)
	role := w.Role("Участники", "custom", "", "members.read")
	w.Assign(accesstest.Grant{Principal: manager, Role: role, Kind: "unit", Ref: f1, Descendants: true})
	p1, p2 := w.Card("Москва-1", f1), w.Card("Москва-2", f2)
	tc := tenantctx.TenantContext{TenantID: w.TenantID, PersonID: manager}
	tx(t, w, func(tx pgx.Tx) {
		s := kit.TxScope{Tx: tx, Ev: w.Evaluator(), TC: tc}
		rows, err := s.Query(t.Context(), "members.read", authz.Columns{Unit: "p.home_unit_id"},
			`select p.id from people.person_profiles p where p.id = any($1) and {{scope}}`, []uuid.UUID{p1, p2})
		if err != nil {
			t.Fatal(err)
		}
		got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil || !slices.Equal(got, []uuid.UUID{p1}) {
			t.Errorf("rows %v %v, want only Москва-1", got, err)
		}
		var n int
		if err := s.QueryRow(t.Context(), "members.read", authz.Columns{Unit: "p.home_unit_id"},
			`select count(*) from people.person_profiles p where {{scope}}`).Scan(&n); err != nil || n != 2 {
			t.Errorf("count %d %v (the manager and Москва-1)", n, err)
		}
		if bad, err := s.Query(t.Context(), "members.read", authz.Columns{}, `select 1`); !errors.Is(err, scopeddb.ErrNoScope) {
			if bad != nil {
				bad.Close()
			}
			t.Errorf("without {{scope}}: %v", err)
		}
		if err := s.QueryRow(t.Context(), "members.read", authz.Columns{}, `select 1`).Scan(&n); !errors.Is(err, scopeddb.ErrNoScope) {
			t.Errorf("QueryRow without {{scope}}: %v", err)
		}
	})
}

// kit.Separation: роль с начислениями — водителю нельзя; роль «Водитель» — финансисту нельзя; остальным — можно.
func TestSeparation(t *testing.T) {
	t.Parallel()
	s := newSoDWorld(t)
	p := authz.DefaultPolicy()
	for name, tc := range map[string]struct {
		actions  []string
		template string
		person   uuid.UUID
		want     string
	}{
		"начисления водителю":      {[]string{"fleet.earnings.read"}, "", s.driver, "separation_of_duties_conflict|" + kit.DetailDriverGetsEarnings},
		"роль водителя финансисту": {[]string{"fleet.trips.read"}, kit.TemplateDriver, s.manager, "separation_of_duties_conflict|" + kit.DetailEarningsGetsDriver},
		"роль водителя водителю":   {[]string{"fleet.trips.read"}, kit.TemplateDriver, s.driver, ""},
		"начисления не водителю":   {[]string{"fleet.earnings.read"}, "", s.manager, ""},
		"обычная роль кому угодно": {[]string{"fleet.trips.read"}, "", s.driver, ""},
	} {
		err := kit.Separation(t.Context(), s.w.Tenant, p, tc.actions, tc.template, []uuid.UUID{tc.person}, s.w.Now, nil)
		if got := accesstest.Problem(err); got != tc.want {
			t.Errorf("%s: %q, want %q", name, got, tc.want)
		}
	}
}
