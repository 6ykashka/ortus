//go:build integration

package kit_test

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit"        //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func displayName(t *testing.T, w *accesstest.World) string {
	t.Helper()
	var name string
	if err := w.Control.QueryRow(t.Context(), `select display_name from tenants where id = $1`, w.TenantID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

// rename is a command of InControlTx: the control DB renames the tenant, the tenant DB records action; the undo
// restores the name.
func rename(ctx context.Context, w *accesstest.World, name, action string, undo kit.Undo) func(tx, ctl pgx.Tx) (kit.Undo, error) {
	return func(tx, ctl pgx.Tx) (kit.Undo, error) {
		if _, err := ctl.Exec(ctx, `update tenants set display_name = $2 where id = $1`, w.TenantID, name); err != nil {
			return nil, err
		}
		return undo, kit.Audit(ctx, tx, kit.Change{Action: action, TargetType: "access.role", TargetID: uuid.New()})
	}
}

// InControlTx: control и tenant DB фиксируются вместе; ошибка команды откатывает обе.
func TestInControlTx(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	d, tc := w.Deps(), w.Anyone()
	ctx := w.Ctx(tc)
	if err := d.InControlTx(ctx, tc, rename(ctx, w, "Альта", "access.test.ok", nil)); err != nil || displayName(t, w) != "Альта" {
		t.Fatalf("commit: %v %q", err, displayName(t, w))
	}
	if w.Count(`select 1 from audit.events where action = 'access.test.ok'`) != 1 {
		t.Error("tenant part not committed")
	}
	failing := func(tx, ctl pgx.Tx) (kit.Undo, error) {
		if _, err := rename(ctx, w, "Откат", "access.test.ok", nil)(tx, ctl); err != nil {
			return nil, err
		}
		return nil, kit.Conflict(kit.CodeInvalidTransition, "")
	}
	if err := d.InControlTx(ctx, tc, failing); accesstest.Code(err) != kit.CodeInvalidTransition || displayName(t, w) != "Альта" {
		t.Errorf("rollback: %v %q", err, displayName(t, w))
	}
}

// Сбой COMMIT tenant DB после control DB запускает компенсацию; её отсутствие или сбой — 503 без отката control DB.
func TestInControlTxCompensation(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	w.FailTenantCommitOn("access.test.refused")
	d, tc := w.Deps(), w.Anyone()
	ctx := w.Ctx(tc)
	restore := func(ctx context.Context, ctl pgx.Tx) error {
		_, err := ctl.Exec(ctx, `update tenants set display_name = 'Мир теста' where id = $1`, w.TenantID)
		return err
	}
	if err := d.InControlTx(ctx, tc, rename(ctx, w, "Без tenant", "access.test.refused", restore)); accesstest.Code(err) != "dependency_unavailable" ||
		displayName(t, w) != "Мир теста" {
		t.Errorf("compensated: %v %q", err, displayName(t, w))
	}
	broken := func(context.Context, pgx.Tx) error { return errors.New("undo fails") }
	if err := d.InControlTx(ctx, tc, rename(ctx, w, "Не откатилось", "access.test.refused", broken)); accesstest.Code(err) != "dependency_unavailable" ||
		!strings.Contains(err.Error(), "undo fails") || displayName(t, w) != "Не откатилось" {
		t.Errorf("failed undo: %v %q", err, displayName(t, w))
	}
	if err := d.InControlTx(ctx, tc, rename(ctx, w, "Без отката", "access.test.refused", nil)); accesstest.Code(err) != "dependency_unavailable" ||
		displayName(t, w) != "Без отката" {
		t.Errorf("nothing to undo: %v %q", err, displayName(t, w))
	}
}

// Сбой COMMIT control DB (в том числе обрыв, после которого исход COMMIT неизвестен): tenant DB откатывается, ответ —
// 503, и расхождение двух БД не теряется — запись slog.Error с тенантом для ручного разбора, как при неудачной
// компенсации (Q-W1.06-11).
func TestInControlTxControlCommitFails(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	for _, sql := range []string{
		`create function public.accesstest_refuse_tenant() returns trigger language plpgsql as $$
			begin raise exception 'accesstest: the control DB refuses to commit'; end $$`,
		`create constraint trigger accesstest_refuse_tenant after update on tenants deferrable initially deferred
			for each row when (new.display_name = 'Сбой control') execute function public.accesstest_refuse_tenant()`,
	} {
		if _, err := w.Control.Exec(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
	}
	var log strings.Builder
	d, tc := w.Deps(), w.Anyone()
	d.Log = slog.New(slog.NewTextHandler(&log, nil))
	ctx := w.Ctx(tc)
	err := d.InControlTx(ctx, tc, rename(ctx, w, "Сбой control", "access.test.control_refused", nil))
	if accesstest.Code(err) != "dependency_unavailable" || displayName(t, w) != "Мир теста" {
		t.Errorf("control commit failed: %v %q", err, displayName(t, w))
	}
	if w.Count(`select 1 from audit.events where action = 'access.test.control_refused'`) != 0 {
		t.Error("the tenant DB committed without the control DB")
	}
	if out := log.String(); !strings.Contains(out, "level=ERROR") || !strings.Contains(out, w.TenantID.String()) ||
		!strings.Contains(out, "control DB commit") {
		t.Errorf("no error record for manual repair: %q", out)
	}
}

// Отказы InControlTx до команды: нет control DB, нет tenant DB, нет строки тенанта — 503.
func TestInControlTxUnavailable(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	noop := func(pgx.Tx, pgx.Tx) (kit.Undo, error) { return nil, nil }
	noControl := w.Deps()
	noControl.Control = nil
	stranger := uuid.New()
	orphan := w.Deps()
	orphan.Pools = accesstest.Pools{stranger: w.Tenant} // a tenant DB without a row in the control DB
	for name, tc := range map[string]struct {
		d  kit.Deps
		tc tenantctx.TenantContext
	}{
		"нет control DB":     {noControl, w.Anyone()},
		"нет tenant DB":      {w.Deps(), tenantctx.TenantContext{TenantID: uuid.New(), Owner: true}},
		"нет строки тенанта": {orphan, tenantctx.TenantContext{TenantID: stranger, Owner: true}},
	} {
		if err := tc.d.InControlTx(w.Ctx(tc.tc), tc.tc, noop); accesstest.Code(err) != "dependency_unavailable" {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// LockPolicy не меняет версию и создаёт строку в tenant DB без неё (версия 0); BumpPolicy W1.07 даёт затем 1.
func TestLockPolicy(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	before := w.PolicyVersion()
	tx(t, w, func(tx pgx.Tx) {
		if err := kit.LockPolicy(t.Context(), tx); err != nil {
			t.Fatal(err)
		}
	})
	if w.PolicyVersion() != before {
		t.Errorf("LockPolicy changed the version: %d → %d", before, w.PolicyVersion())
	}
	if _, err := w.Tenant.Exec(t.Context(), `delete from access.policy_state`); err != nil {
		t.Fatal(err)
	}
	tx(t, w, func(tx pgx.Tx) {
		if err := kit.LockPolicy(t.Context(), tx); err != nil {
			t.Fatal(err)
		}
		if v, err := kit.BumpPolicy(w.Ctx(w.Anyone()), tx, w.TenantID, []uuid.UUID{uuid.Nil, uuid.Nil}, "access.role.update"); err != nil || v != 1 {
			t.Errorf("first bump %d %v", v, err)
		}
	})
	w.CheckPolicyBump(w.LastPolicyBump(), 1, uuid.Nil) // repeated people once
}

// Держатели роли: прямо и через живую группу; снятые назначения и архивные группы не считаются.
func TestHolders(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	firm := w.Unit("Москва-1", uuid.Nil)
	direct, m1, m2, gone, archived := w.Card("Прямо", firm), w.Card("Группа 1", firm), w.Card("Группа 2", firm), w.Card("Снятый", firm), w.Card("Архив", firm)
	role := w.Role("Диспетчер", "custom", "", "fleet.routes.read")
	w.Assign(accesstest.Grant{Principal: direct, Role: role, Kind: "unit", Ref: firm})
	w.Assign(accesstest.Grant{Group: true, Principal: w.Group("Диспетчеры", firm, m1, m2), Role: role, Kind: "self"})
	w.Assign(accesstest.Grant{Principal: gone, Role: role, Kind: "tenant", State: "revoked"})
	old := w.Group("Старая", firm, archived)
	if _, err := w.Tenant.Exec(t.Context(), `update access.groups set archived_at = now() where id = $1`, old); err != nil {
		t.Fatal(err)
	}
	w.Assign(accesstest.Grant{Group: true, Principal: old, Role: role, Kind: "tenant"})
	got, err := kit.Holders(t.Context(), w.Tenant, role)
	if want := kit.Distinct([]uuid.UUID{direct, m1, m2}); err != nil || !slices.Equal(kit.Distinct(got), want) {
		t.Errorf("holders %v %v, want %v", got, err, want)
	}
}

// Reach: «своё» доходит до подразделения каждого человека; остальные области — Targets. RoleReach — цели всех
// действующих назначений роли без повторов; закончившиеся не считаются.
func TestReach(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	region := w.Unit("Москва", uuid.Nil)
	f1, f2, samara := w.Unit("Москва-1", region), w.Unit("Москва-2", region), w.Unit("Самара", uuid.Nil)
	p1, p2, p3 := w.Card("Москва-1", f1), w.Card("Москва-2", f2), w.Card("Ещё Москва-2", f2)
	self := authz.Scope{Kind: authz.KindSelf}
	got, err := kit.Reach(t.Context(), w.Tenant, self, f1, []uuid.UUID{p1, p2, p3})
	if want := []authz.Resource{{Unit: f1}, {Unit: f2}}; err != nil || !sameTargets(got, want) {
		t.Errorf("self of a group: %+v %v", got, err)
	}
	unit := authz.Scope{Kind: authz.KindUnit, Ref: f2}
	if got, err := kit.Reach(t.Context(), w.Tenant, unit, f1, []uuid.UUID{p1}); err != nil || !sameTargets(got, []authz.Resource{{Unit: f2}}) {
		t.Errorf("unit: %+v %v", got, err)
	}

	role := w.Role("Рейсы", "custom", "", "fleet.trips.read")
	w.Assign(accesstest.Grant{Principal: p1, Role: role, Kind: "unit", Ref: region, Descendants: true})
	w.Assign(accesstest.Grant{Principal: p1, Role: role, Kind: "unit", Ref: f1})
	w.Assign(accesstest.Grant{Group: true, Principal: w.Group("Москва-2", f2, p2, p3), Role: role, Kind: "self"})
	ended := w.Now.Add(-time.Hour)
	w.Assign(accesstest.Grant{Principal: p1, Role: role, Kind: "unit", Ref: samara, Until: &ended})
	got, err = kit.RoleReach(t.Context(), w.Tenant, role, w.Now)
	if want := []authz.Resource{{Unit: region}, {Unit: f1}, {Unit: f2}}; err != nil || !sameTargets(got, want) {
		t.Errorf("role reach: %+v %v, want %+v", got, err, want)
	}
}

// Зависимости хендлеров: нет TenantContext — 404, нет tenant DB — 503; InTx откатывает при ошибке команды;
// заголовки ответа, часы, коды ошибок.
func TestDeps(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	d := w.Deps()
	if _, err := kit.Tenant(context.Background()); accesstest.Code(err) != "not_found" {
		t.Errorf("no tenant context: %v", err)
	}
	stranger := tenantctx.TenantContext{TenantID: uuid.New()}
	if _, err := d.Scoped(t.Context(), stranger, d.Evaluator); accesstest.Code(err) != "dependency_unavailable" {
		t.Errorf("scoped without a tenant DB: %v", err)
	}
	if err := d.InPolicyTx(t.Context(), stranger, func(pgx.Tx) error { return nil }); accesstest.Code(err) != "dependency_unavailable" {
		t.Errorf("transaction without a tenant DB: %v", err)
	}
	role := uuid.New()
	err := d.InPolicyTx(t.Context(), w.Anyone(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(t.Context(), `insert into access.roles (id, name, kind) values ($1, 'Откат', 'custom')`, role); err != nil {
			return err
		}
		return kit.Forbidden()
	})
	if accesstest.Code(err) != "forbidden_action" || w.Count(`select 1 from access.roles where id = $1`, role) != 0 {
		t.Errorf("rollback: %v", err)
	}
	err = d.InTx(t.Context(), w.Anyone(), func(tx pgx.Tx) error {
		return kit.Publish(w.Ctx(w.Anyone()), tx, kit.EventAssignmentGranted, kit.AggregateAssignment, role, map[string]any{"assignmentId": role})
	})
	if err != nil || w.Count(`select 1 from outbox.events where aggregate_id = $1`, role) != 1 {
		t.Errorf("publish: %v", err)
	}
	if err := d.InTx(t.Context(), w.Anyone(), func(tx pgx.Tx) error {
		return kit.Publish(t.Context(), tx, "not an event", kit.AggregateAssignment, role, nil)
	}); accesstest.Code(err) != "dependency_unavailable" {
		t.Errorf("bad event: %v", err)
	}
}

// Помощники ответа и ошибок: заголовки, часы, коды, модули через Request.
func TestDepsHelpers(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	d := w.Deps()
	cc, rid := kit.Meta(w.Ctx(w.Anyone()))
	if *cc != kit.NoStore || *rid == "" {
		t.Errorf("meta %q %q", *cc, *rid)
	}
	if (kit.Deps{}).Clock().IsZero() || !d.Clock().Equal(w.Now) {
		t.Error("clock")
	}
	conflict := kit.Conflict(kit.CodeLastOwner, "")
	if !errors.Is(kit.Unavailable(conflict), conflict) || kit.Store("x", nil) != nil {
		t.Error("Unavailable keeps a problem, Store(nil) is nil")
	}
	if !kit.Denied(kit.NotFound()) || kit.Denied(conflict) {
		t.Error("Denied")
	}
	if _, err := kit.Request(d.Evaluator).Source.InstalledModules(t.Context(), w.Anyone()); err != nil {
		t.Errorf("installed modules: %v", err)
	}
}

// Complete под Idempotency-Key: исход хранится в транзакции эффекта; если аренду ключа перехватили (запись уже не
// in_progress), эффект откатывается с 409 idempotency_in_progress.
func TestCompleteUnderIdempotencyKey(t *testing.T) {
	t.Parallel()
	w := server.NewWorld(t)
	guard := &idem.Guard{Stores: idem.TenantStores{Pools: w.Pools()}}
	run := func(key string, takeOver bool) (int, error) {
		var err error
		ns := idem.Namespace{TenantID: w.TenantID, ActorID: uuid.New(), Operation: "createRole"}
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/roles", strings.NewReader(`{"name":"x"}`))
		req.Header.Set(idem.HeaderKey, key)
		rec := httptest.NewRecorder()
		guard.Serve(rec, req, ns, http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			if takeOver {
				if _, e := w.Tenant.Exec(r.Context(), `update core.idempotency_keys set state = 'completed', response_status = 201`); e != nil {
					t.Error(e)
				}
			}
			err = w.Deps().InTx(r.Context(), w.Anyone(), func(tx pgx.Tx) error {
				return kit.Complete(r.Context(), tx, http.StatusCreated, kit.ETag(1), map[string]string{"name": "x"})
			})
			rw.WriteHeader(http.StatusCreated)
		}))
		return rec.Code, err
	}
	if code, err := run("key-completed-0001", false); err != nil || code != http.StatusCreated {
		t.Fatalf("complete: %d %v", code, err)
	}
	if n := w.Count(`select 1 from core.idempotency_keys where key = 'key-completed-0001' and state = 'completed' and response_status = 201`); n != 1 {
		t.Errorf("stored outcome: %d", n)
	}
	if _, err := run("key-taken-over-0001", true); accesstest.Code(err) != kit.CodeInProgress {
		t.Errorf("lease lost: %v", err)
	}
}
