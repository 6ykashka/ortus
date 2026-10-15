//go:build integration

package audit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Тест A-2 брифа W1.01: запись аудита в транзакции изменения (testcontainers, роль ortus_api).

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

func apiPool(t *testing.T, k migrations.Kind) *pgxpool.Pool {
	t.Helper()
	name := cluster.NewDatabase(t, "audit")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), k); err != nil {
		t.Fatalf("migrate %s: %v", k, err)
	}
	pool, err := pgxpool.New(t.Context(), cluster.URL(name, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// inTx runs f in a transaction of pool and commits or rolls back; the connection is always returned (a leaked
// transaction would block pool.Close in the cleanup).
func inTx(t *testing.T, pool *pgxpool.Pool, f func(pgx.Tx) error, commit bool) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	if err := f(tx); err != nil {
		t.Fatalf("in transaction: %v", err)
	}
	if commit {
		if err := tx.Commit(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestRecordInTransaction(t *testing.T) {
	t.Parallel()
	pool := apiPool(t, migrations.Tenant)
	ctx := t.Context()
	e := valid()
	e.UnitID = uuid.New()
	e.Sensitivity = Restricted
	e.Reason = "Перевод в другой регион"
	e.Diff = Redact(map[string]any{"role": "Логист", "salary": 90000}, "salary")

	inTx(t, pool, func(tx pgx.Tx) error { return Record(ctx, tx, e) }, false)
	var n int
	if err := pool.QueryRow(ctx, `select count(*) from audit.events`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("after rollback: %d rows, %v", n, err)
	}

	inTx(t, pool, func(tx pgx.Tx) error { return Record(ctx, tx, e) }, true)
	var (
		kind, action, target, sens, reason, result, req string
		actor, targetID, unit                           uuid.UUID
		diff                                            map[string]any
	)
	err := pool.QueryRow(ctx, `select actor_kind, actor_id, action, target_type, target_id, unit_id, sensitivity,
       reason, result, request_id, diff from audit.events`).
		Scan(&kind, &actor, &action, &target, &targetID, &unit, &sens, &reason, &result, &req, &diff)
	if err != nil {
		t.Fatal(err)
	}
	got := fmt.Sprint(kind, actor, action, target, targetID, unit, sens, reason, result, req)
	want := fmt.Sprint(e.ActorKind, e.ActorID, e.Action, e.TargetType, e.TargetID, e.UnitID, e.Sensitivity, e.Reason, e.Result, e.RequestID)
	if got != want {
		t.Fatalf("row = %s, want %s", got, want)
	}
	if b, _ := json.Marshal(diff); string(b) != `{"role":"Логист","salary":"[restricted]"}` {
		t.Fatalf("diff = %s", b)
	}
}

func TestRecordNullables(t *testing.T) {
	t.Parallel()
	pool := apiPool(t, migrations.Tenant)
	e := Event{ActorKind: ActorService, Action: "outbox.event.retry", TargetType: "outbox.event", Result: OK, RequestID: "worker-1"}
	if err := Record(t.Context(), pool, e); err != nil {
		t.Fatalf("Record: %v", err)
	}
	var nulls bool
	if err := pool.QueryRow(t.Context(), `select actor_id is null and target_id is null and unit_id is null
   and reason is null and diff is null and sensitivity = 'normal' from audit.events`).Scan(&nulls); err != nil || !nulls {
		t.Fatalf("zero values must be stored as null (normal sensitivity): %v %v", nulls, err)
	}
}

func TestAuditIsAppendOnly(t *testing.T) {
	t.Parallel()
	pool := apiPool(t, migrations.Tenant)
	if err := Record(t.Context(), pool, valid()); err != nil {
		t.Fatal(err)
	}
	_, err := pool.Exec(t.Context(), `update audit.events set result = 'failed'`)
	var pgErr *pgconn.PgError
	if err == nil || !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatalf("UPDATE audit.events by ortus_api = %v, want insufficient_privilege", err)
	}
}

func TestRecordPlatform(t *testing.T) {
	t.Parallel()
	pool := apiPool(t, migrations.Control)
	e := PlatformEvent{
		ActorKind: PlatformOperator, ActorID: uuid.New(), Action: "platform.tenant.suspend", TargetType: "tenant",
		TargetID: uuid.New(), Reason: "Неоплата", Result: OK, RequestID: "req-p", Details: map[string]any{"from": "active"},
	}
	if err := RecordPlatform(t.Context(), pool, e); err != nil {
		t.Fatalf("RecordPlatform: %v", err)
	}
	var (
		action, reason, details string
		actor                   uuid.UUID
	)
	if err := pool.QueryRow(t.Context(), `select action, actor_id, reason, details::text from platform_audit`).
		Scan(&action, &actor, &reason, &details); err != nil {
		t.Fatal(err)
	}
	if action != e.Action || actor != e.ActorID || reason != e.Reason || details != `{"from": "active"}` {
		t.Fatalf("row = %s %s %s %s", action, actor, reason, details)
	}
	sys := PlatformEvent{ActorKind: PlatformSystem, Action: "platform.tenant.grace", TargetType: "tenant", Result: OK, RequestID: "job-1"}
	if err := RecordPlatform(t.Context(), pool, sys); err != nil {
		t.Fatalf("system event without details: %v", err)
	}
}
