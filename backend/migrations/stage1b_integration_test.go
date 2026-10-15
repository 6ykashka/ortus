//go:build integration

package migrations_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Ограничения миграций W1.00 (control 0004–0005, tenant 0007) на реальном сервере под runtime-ролями.
func TestStage1bConstraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}

		// control 0004: последний выбор — организация из реестра; удаление организации обнуляет выбор.
		ctlName, _ := migrated(t, c, migrations.Control)
		ctl := c.DB(t, ctlName, migrations.RoleAPI)
		ctx := t.Context()
		account := scalar[string](t, ctl, `insert into accounts (issuer, subject, email_norm, display_name)
			values ('urn:ortus:test', 'acc-4', 'a.morozova@alta.example', 'Анна Морозова') returning id::text`)
		tenant := scalar[string](t, ctl, `insert into tenants (slug, display_name, industry_pack)
			values ('lotos', 'SPA «Лотос»', 'spa') returning id::text`)
		_, err := ctl.ExecContext(ctx, `update accounts set last_tenant_id = gen_random_uuid(), last_tenant_at = now()
			where id = $1`, account)
		wantState("unknown tenant", err, "23503")
		if _, err := ctl.ExecContext(ctx, `update accounts set last_tenant_id = $2, last_tenant_at = now()
			where id = $1`, account, tenant); err != nil {
			t.Fatalf("select tenant: %v", err)
		}
		super := c.DB(t, ctlName, migratetest.Super)
		if _, err := super.ExecContext(ctx, `delete from tenants where id = $1`, tenant); err != nil {
			t.Fatalf("delete tenant: %v", err)
		}
		if n := scalar[int](t, ctl, `select count(*) from accounts where id = $1 and last_tenant_id is null`, account); n != 1 {
			t.Error("last_tenant_id must be set null when the tenant is deleted")
		}

		// control 0005: один ключ — одна команда в пространстве тенант + actor + operation; ключ 16–128 символов,
		// как параметр IdempotencyKey контракта.
		const (
			op    = "6f1c2a3b-0000-4000-8000-000000000001"
			orgA  = "6f1c2a3b-0000-4000-8000-00000000000a"
			orgB  = "6f1c2a3b-0000-4000-8000-00000000000b"
			idemK = "01J9Z4QK8M6T2V5X"
		)
		key := `insert into idempotency_keys (actor_id, tenant_id, operation, key, request_hash, state, expires_at)
			values ($1, $2, 'suspendPlatformTenant', $3, '\x00', 'in_progress', now() + interval '24 hours')`
		if _, err := ctl.ExecContext(ctx, key, op, orgA, idemK); err != nil {
			t.Fatalf("insert idempotency key: %v", err)
		}
		_, err = ctl.ExecContext(ctx, key, op, orgA, idemK)
		wantState("duplicate key, same tenant", err, "23505")
		// Тот же ключ и та же причина для другой организации — другая команда, а не повтор (ревью W1.00).
		if _, err := ctl.ExecContext(ctx, key, op, orgB, idemK); err != nil {
			t.Errorf("same key, other tenant: %v", err)
		}
		// Команда без организации (тенант null): null не отличается от null — повтор ловится.
		if _, err := ctl.ExecContext(ctx, key, op, nil, idemK); err != nil {
			t.Errorf("same key, no tenant: %v", err)
		}
		_, err = ctl.ExecContext(ctx, key, op, nil, idemK)
		wantState("duplicate key, no tenant", err, "23505")
		_, err = ctl.ExecContext(ctx, key, op, orgA, "01J9Z4QK8M6T2V5")
		wantState("15-char key", err, "23514")
		_, err = ctl.ExecContext(ctx, key, op, orgA, strings.Repeat("k", 129))
		wantState("129-char key", err, "23514")
		_, err = ctl.ExecContext(ctx, `update idempotency_keys set state = 'completed' where key = $1`, idemK)
		wantState("completed without response", err, "23514")

		// tenant 0007 (модель W1.01, Q-W1.01-3): аренда — только locked_until; мёртвое событие
		// (available_at = 'infinity') всегда несёт причину в last_error.
		tenName, _ := migrated(t, c, migrations.Tenant)
		worker := c.DB(t, tenName, migrations.RoleWorker)
		ev := scalar[int64](t, worker, `insert into outbox.events (type, aggregate, aggregate_id, payload)
			values ('access.policy.bumped.v1', 'access.policy', gen_random_uuid(), '{}') returning id`)
		if _, err := worker.ExecContext(ctx, `update outbox.events set locked_until = now() + interval '30 seconds',
			attempts = attempts + 1 where id = $1`, ev); err != nil {
			t.Fatalf("lease as W1.01 takes it: %v", err)
		}
		_, err = worker.ExecContext(ctx, `update outbox.events set available_at = 'infinity', locked_until = null
			where id = $1`, ev)
		wantState("dead-letter without reason", err, "23514")
		if _, err := worker.ExecContext(ctx, `update outbox.events set available_at = 'infinity', locked_until = null,
			last_error = 'timeout' where id = $1`, ev); err != nil {
			t.Fatalf("dead-letter: %v", err)
		}
	})
}

// tenant 0007 на живом outbox в формате W1.01 (ревью W1.00, возврат 2): Up не ломает аренду и очередь worker,
// мёртвое событие до 0007 без причины получает 'unknown error'; затем настоящий events.Outbox W1.01 проходит
// цикл аренда → dead-letter → список → ручной повтор → публикация. Down возвращает схему 0006.
func TestStage1bOutboxW101OnLiveRows(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		name := c.NewDatabase(t, "outbox")
		mig := c.DB(t, name, migrations.RoleMigrator)
		if _, err := migrations.UpTo(ctx, mig, migrations.Tenant, 6); err != nil {
			t.Fatalf("up to 6: %v", err)
		}
		worker := c.DB(t, name, migrations.RoleWorker)
		insert := `insert into outbox.events (type, aggregate, aggregate_id, payload, locked_until, available_at, attempts)
			values ('access.policy.bumped.v1', 'access.policy', gen_random_uuid(), '{}', $1, $2, $3) returning id`
		leased := scalar[int64](t, worker, insert, time.Now().Add(time.Minute), time.Now(), 1)
		deadOld := scalar[int64](t, worker, insert, nil, "infinity", 10)
		free := scalar[int64](t, worker, insert, nil, time.Now(), 0)
		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up 0007 over a live outbox: %v", err)
		}
		if got := scalar[string](t, worker, `select coalesce(last_error, '') from outbox.events where id = $1`, deadOld); got != "unknown error" {
			t.Errorf("last_error of a dead event without reason = %q, want unknown error", got)
		}
		indexes := `select string_agg(indexname, ',' order by indexname) from pg_indexes
			where schemaname = 'outbox' and tablename = 'events' and indexname like 'outbox\_%'`
		if got := scalar[string](t, mig, indexes); got != "outbox_dead_idx,outbox_pending_idx" {
			t.Errorf("outbox indexes after up = %s, want outbox_dead_idx,outbox_pending_idx", got)
		}

		if n := scalar[int](t, worker, `select count(*) from outbox.events where id = $1 and locked_until > now()`, leased); n != 1 {
			t.Error("the lease taken before 0007 must survive Up")
		}
		outboxCycleW101(t, c.URL(name, migrations.RoleWorker), deadOld, free)

		if _, err := migrations.DownTo(ctx, mig, migrations.Tenant, 6); err != nil {
			t.Fatalf("down to 6: %v", err)
		}
		if got := scalar[string](t, mig, indexes); got != "outbox_pending_idx" {
			t.Errorf("outbox indexes after down = %s, want outbox_pending_idx", got)
		}
	})
}

// Down control до 3 и tenant до 6 снимает ровно объекты W1.00.
func TestStage1bDown(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		_, ctl := migrated(t, c, migrations.Control)
		if res, err := migrations.DownTo(t.Context(), ctl, migrations.Control, 3); err != nil || res.To != 3 {
			t.Fatalf("control down to 3 = %+v, %v", res, err)
		}
		for q, want := range map[string]int{
			`select count(*) from information_schema.columns where table_name = 'accounts'
				and column_name in ('last_tenant_id', 'last_tenant_at')`: 0,
			`select count(*) from information_schema.tables where table_name = 'idempotency_keys'`: 0,
		} {
			if got := scalar[int](t, ctl, q); got != want {
				t.Errorf("%s = %d, want %d", q, got, want)
			}
		}
		_, ten := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(t.Context(), ten, migrations.Tenant, 6); err != nil || res.To != 6 {
			t.Fatalf("tenant down to 6 = %+v, %v", res, err)
		}
		if got := scalar[int](t, ten, `select count(*) from pg_constraint
			where conrelid = 'outbox.events'::regclass and conname = 'events_dead_has_error'`); got != 0 {
			t.Errorf("events_dead_has_error after down = %d, want 0", got)
		}
	})
}

// outboxCycleW101 проходит цикл настоящего events.Outbox W1.01 после 0007: Claim берёт только свободное
// событие, Failed переводит его в dead-letter, DeadLetters отдаёт оба мёртвых события, Retry и Published.
func outboxCycleW101(t *testing.T, url string, deadOld, free int64) {
	t.Helper()
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	o := &events.Outbox{DB: pool, MaxAttempts: 1}
	msg, lease := claimOne(t, o, free) // leased is locked, deadOld is in the dead-letter
	if dead, err := o.Failed(ctx, msg, lease, errors.New("handler: таймаут")); err != nil || !dead {
		t.Fatalf("Failed = %v, %v; want dead-letter", dead, err)
	}
	dl, err := o.DeadLetters(ctx, 10)
	if err != nil || len(dl) != 2 || dl[0].ID != deadOld || dl[1].ID != free {
		t.Fatalf("DeadLetters = %+v, %v; want [%d %d]", dl, err, deadOld, free)
	}
	if dl[0].LastError != "unknown error" || dl[1].LastError != "handler: таймаут" {
		t.Errorf("dead-letter reasons = %q, %q", dl[0].LastError, dl[1].LastError)
	}
	if err := o.Retry(ctx, dl[1].EventID); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	_, lease = claimOne(t, o, free)
	if err := o.Published(ctx, free, lease); err != nil {
		t.Fatalf("Published: %v", err)
	}
}

// claimOne leases due events and requires exactly the event want.
func claimOne(t *testing.T, o *events.Outbox, want int64) (events.Message, time.Time) {
	t.Helper()
	msgs, lease, err := o.Claim(t.Context(), 10)
	if err != nil || len(msgs) != 1 || msgs[0].ID != want {
		t.Fatalf("Claim = %+v, %v; want only event %d", msgs, err, want)
	}
	return msgs[0], lease
}
