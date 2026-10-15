//go:build integration

package kit_test

// W1.47 (Q-W1.41-9): команда модели доступа проверяет права в своей транзакции. Оценщик kit.Within читает субъекта,
// модули и предков подразделения через транзакцию команды и не берёт второго соединения пула tenant: под LockPolicy
// второе соединение — взаимоблокировка, когда остальные соединения пула держат команды, ждущие строку политики.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit"        //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// commandWait bounds a command of the tests below: a check that waits for a second connection of a pool of one never
// gets it, and fails at this deadline instead of hanging the suite.
const commandWait = 10 * time.Second

// withinWorld: фирма с подразделением; участник (не владелец) с ролью «назначать, видеть участников, рейсы» на
// фирму с потомками; Самара вне его области. Пул tenant — одно соединение: его держит транзакция команды.
type withinWorld struct {
	*accesstest.World
	d                   kit.Deps
	tc                  tenantctx.TenantContext
	firm, depot, samara uuid.UUID
	admin, actions      uuid.UUID
}

func newWithinWorld(t *testing.T) withinWorld {
	t.Helper()
	w := withinWorld{World: server.NewWorld(t)}
	w.firm = w.Unit("Москва-1", uuid.Nil)
	w.depot = w.Unit("Склад Москва-1", w.firm)
	w.samara = w.Unit("Самара", uuid.Nil)
	w.admin = w.Member("Админ фирмы", "firm@alta.example", w.firm)
	w.actions = w.Role("Администратор доступа", "custom", "", "roles.assign", "members.read", "fleet.trips.read")
	w.Assign(accesstest.Grant{Principal: w.admin, Role: w.actions, Kind: "unit", Ref: w.firm, Descendants: true})
	w.Install("logistics")
	w.tc = w.TC(w.admin)
	w.d = w.DepsOver(w.SmallPool(1))
	return w
}

// command runs fn as a command of the module: in kit.InPolicyTx, with the evaluator of kit.Within.
func (w withinWorld) command(t *testing.T, fn func(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator) error) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(w.Ctx(w.tc), commandWait)
	defer cancel()
	return w.d.InPolicyTx(ctx, w.tc, func(tx pgx.Tx) error {
		ev, err := kit.Within(ctx, w.d.Evaluator, w.tc, tx)
		if err != nil {
			return err
		}
		return fn(ctx, tx, ev)
	})
}

// Permit (с предками подразделения), ScopeQuery и Capabilities оценщика команды отвечают, когда единственное
// соединение пула занято её транзакцией под LockPolicy.
func TestWithinReadsInTransaction(t *testing.T) {
	t.Parallel()
	w := newWithinWorld(t)
	start := time.Now()
	err := w.command(t, func(ctx context.Context, _ pgx.Tx, ev *authz.Evaluator) error {
		if err := kit.Delegate(ctx, ev, w.tc, []string{"fleet.trips.read"}, []authz.Resource{{Unit: w.depot}}, ""); err != nil {
			t.Errorf("delegation over the depot of the firm: %v", err)
		}
		if ok, err := kit.Covers(ctx, ev, w.tc, "roles.assign", w.samara); ok || err != nil {
			t.Errorf("roles.assign over Самара: %v %v, want a refusal", ok, err)
		}
		p, err := ev.ScopeQuery(ctx, w.tc, "members.read", authz.Columns{Unit: "p.home_unit_id"}, 0)
		if err != nil || p.SQL == "" || p.SQL == "false" {
			t.Errorf("scope of members.read: %+v %v", p, err)
		}
		caps, err := ev.Capabilities(ctx, w.tc)
		if err != nil || len(caps) != 3 {
			t.Errorf("capabilities: %+v %v", caps, err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("the command failed after %s: %s", time.Since(start).Round(time.Millisecond), accesstest.Problem(err))
	}
}

// Оценщик команды видит модель доступа такой, какой её застали блокировки: грант, который команда сама записала
// актору в своей транзакции (как setGroupMembers, добавивший актора в группу с ролями), его проверки не расширяет.
func TestWithinSeesModelAsLocked(t *testing.T) {
	t.Parallel()
	w := newWithinWorld(t)
	err := w.command(t, func(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator) error {
		if _, err := tx.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
			scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'unit', $3, true,
			tstzrange($4::timestamptz, null), $1)`, w.admin, w.actions, w.samara, w.Now.Add(-time.Hour)); err != nil {
			return err
		}
		ok, err := kit.Covers(ctx, ev, w.tc, "roles.assign", w.samara)
		if ok || err != nil {
			t.Errorf("roles.assign over Самара after the command wrote it to its actor: %v %v, want a refusal", ok, err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("the command failed: %s", accesstest.Problem(err))
	}
}
