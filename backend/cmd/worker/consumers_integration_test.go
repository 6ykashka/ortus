//go:build integration

package main

// Тесты W-2…W-4 брифа W1.42: cmd/worker на control DB с Go-сидом W0.06 (роль ortus_worker) — потребители outbox
// этапа 1 (realtime.Relay, inbox.Consumer) и уборка импортов по расписанию.

import (
	"bytes"
	"context"
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var (
	seedZimina = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:acc-1"))
	seedKotova = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:acc-2"))
	seedBelova = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:acc-11"))
)

func superDB(t *testing.T, db string) *sql.DB {
	t.Helper()
	return stack.DB(t, db, migratetest.Super)
}

// personOf returns the person profile of the membership of account in tenant (control DB).
func personOf(t *testing.T, account, tenant uuid.UUID) uuid.UUID {
	t.Helper()
	var p uuid.UUID
	if err := superDB(t, controlDB).QueryRowContext(t.Context(),
		`select person_profile_id from memberships where account_id = $1 and tenant_id = $2`, account, tenant).Scan(&p); err != nil {
		t.Fatal(err)
	}
	return p
}

// listen subscribes to the channel of the hints (realtime.Channel) and returns the hints it receives.
func listen(t *testing.T) <-chan realtime.Hint {
	t.Helper()
	conn, err := pgx.Connect(t.Context(), stack.URL(controlDB, migratetest.Super))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(t.Context(), "listen "+realtime.Channel); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.WithoutCancel(t.Context()))
	out := make(chan realtime.Hint, 64)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			n, err := conn.WaitForNotification(ctx)
			if err != nil {
				return
			}
			if h, err := realtime.DecodeHint(n.Payload); err == nil {
				out <- h
			}
		}
	}()
	t.Cleanup(func() {
		cancel()
		<-done
		_ = conn.Close(context.Background())
	})
	return out
}

// awaitHint returns the first hint of typ in tenant that addresses account, within d.
func awaitHint(hints <-chan realtime.Hint, typ string, tenant, account uuid.UUID, d time.Duration) (realtime.Hint, bool) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	for {
		select {
		case h := <-hints:
			if h.Type == typ && h.TenantID == tenant && slices.Contains(h.Accounts, account) {
				return h, true
			}
		case <-timer.C:
			return realtime.Hint{}, false
		}
	}
}

// runWorker runs `worker run` with extra environment until the test ends.
func runWorker(t *testing.T, extra map[string]string) *bytes.Buffer {
	t.Helper()
	ctx, cancel := context.WithCancel(context.WithoutCancel(t.Context()))
	done := make(chan int, 1)
	var out, errOut bytes.Buffer
	go func() { done <- run(ctx, []string{"run"}, workerEnv(extra), &out, &errOut) }()
	t.Cleanup(func() {
		cancel()
		if code := <-done; code != exitOK {
			t.Errorf("worker: exit %d, stderr %s", code, errOut.String())
		}
	})
	return &errOut
}

// eventually polls cond every 50 ms for d.
func eventually(t *testing.T, d time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("%s: not within %v", what, d)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func count(t *testing.T, db *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRowContext(t.Context(), q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// W-2 (S1-26, Q-W0.08-3; строки изоляции): передача владения в «Альте» → уведомление во «Входящих» нового владельца
// (одно, повтор доставки не дублирует) и подсказка notifications.changed его аккаунту. Профиль «Лотоса» в событии
// «Альты» ни в одной базе уведомления не получает: адресат — только активный участник организации события.
//
//nolint:paralleltest // the worker delivers every seeded tenant
func TestRunOwnerNotice(t *testing.T) {
	api, alta := tenantPool(t, "t_alta", migrations.RoleAPI), superDB(t, "t_alta")
	owner, manager := personOf(t, seedZimina, seedAlta), personOf(t, seedKotova, seedAlta)
	stranger := personOf(t, seedBelova, seedLotos)
	hints := listen(t)
	publish := func(member uuid.UUID) uuid.UUID {
		id, err := events.Publish(t.Context(), api, events.Event{Type: eventOwnerChanged, Aggregate: "access.owner", AggregateID: seedAlta,
			Payload: map[string]any{"change": "transfer", "actorPersonId": owner, "memberIds": []uuid.UUID{member},
				"ownerIds": []uuid.UUID{owner, member}}})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	mine, foreign := publish(manager), publish(stranger)
	t.Cleanup(func() {
		_, _ = alta.ExecContext(context.WithoutCancel(t.Context()),
			`delete from notify.notifications where source_event_id = any($1)`, []uuid.UUID{mine, foreign})
	})
	runWorker(t, nil)

	const rows = `select count(*) from notify.notifications where source_event_id = $1 and recipient_person_id = $2`
	eventually(t, 10*time.Second, "the notice of the new owner", func() bool { return count(t, alta, rows, mine, manager) == 1 })
	if _, ok := awaitHint(hints, realtime.TypeNotificationsChanged, seedAlta, seedKotova, 5*time.Second); !ok {
		t.Fatal("no notifications.changed for the account of the new owner")
	}
	var title, kind string
	if err := alta.QueryRowContext(t.Context(), `select title, kind from notify.notifications where source_event_id = $1`, mine).
		Scan(&title, &kind); err != nil || title != "Вам передано владение бизнесом" || kind != "access.owner.changed" {
		t.Fatalf("notice %q %q: %v", title, kind, err)
	}
	const delivered = `select count(*) from outbox.events where event_id = $1 and published_at is not null`
	eventually(t, 10*time.Second, "the foreign event delivered", func() bool { return count(t, alta, delivered, foreign) == 1 })
	for name, db := range map[string]*sql.DB{"t_alta": alta, "t_lotos": superDB(t, "t_lotos")} {
		if n := count(t, db, `select count(*) from notify.notifications where recipient_person_id = $1`, stranger); n != 0 {
			t.Errorf("%s: %d notices of a person of another tenant", name, n)
		}
	}
	if n := count(t, alta, `select count(*) from notify.notifications where source_event_id = $1`, mine); n != 1 {
		t.Errorf("notices of one event: %d", n)
	}
}

// W-2 (возврат 1 W1.42): notifications.changed получают только те, кому потребитель действительно поставил
// уведомление. Приостановленный участник «Альты» в memberIds события уведомления не получает (адресат —
// активный участник), значит и подсказки ему нет, хотя маршрут его называет.
//
//nolint:paralleltest // the worker delivers every seeded tenant
func TestRunOwnerNoticeHintsEnqueuedOnly(t *testing.T) {
	api, alta, control := tenantPool(t, "t_alta", migrations.RoleAPI), superDB(t, "t_alta"), superDB(t, controlDB)
	owner, manager := personOf(t, seedZimina, seedAlta), personOf(t, seedKotova, seedAlta)
	const status = `update memberships set status = $3 where account_id = $1 and tenant_id = $2`
	if _, err := control.ExecContext(t.Context(), status, seedKotova, seedAlta, "suspended"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := control.ExecContext(context.WithoutCancel(t.Context()), status, seedKotova, seedAlta, "active"); err != nil {
			t.Error(err)
		}
	})
	hints := listen(t)
	id, err := events.Publish(t.Context(), api, events.Event{Type: eventOwnerChanged, Aggregate: "access.owner", AggregateID: seedAlta,
		Payload: map[string]any{"change": "transfer", "actorPersonId": owner, "memberIds": []uuid.UUID{manager},
			"ownerIds": []uuid.UUID{owner, manager}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = alta.ExecContext(context.WithoutCancel(t.Context()), `delete from notify.notifications where source_event_id = $1`, id)
	})
	runWorker(t, nil)

	const delivered = `select count(*) from outbox.events where event_id = $1 and published_at is not null`
	eventually(t, 10*time.Second, "the event delivered", func() bool { return count(t, alta, delivered, id) == 1 })
	if n := count(t, alta, `select count(*) from notify.notifications where source_event_id = $1`, id); n != 0 {
		t.Fatalf("%d notices for a suspended member", n)
	}
	if h, ok := awaitHint(hints, realtime.TypeNotificationsChanged, seedAlta, seedKotova, 2*time.Second); ok {
		t.Fatalf("notifications.changed %+v for a member who got no notice", h)
	}
}

// W-3 (S1-15): access.policy.bumped.v1 → pg_notify context.changed аккаунтам затронутых людей этой организации.
//
//nolint:paralleltest // the worker delivers every seeded tenant
func TestRunRelaysPolicy(t *testing.T) {
	api := tenantPool(t, "t_alta", migrations.RoleAPI)
	manager := personOf(t, seedKotova, seedAlta)
	hints := listen(t)
	err := pgx.BeginFunc(t.Context(), api, func(tx pgx.Tx) error {
		_, err := realtime.BumpPolicy(t.Context(), tx, seedAlta, []uuid.UUID{manager}, "w142.test")
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	runWorker(t, nil)
	h, ok := awaitHint(hints, realtime.TypeContextChanged, seedAlta, seedKotova, 10*time.Second)
	if !ok {
		t.Fatal("no context.changed for the account of the person")
	}
	if slices.Contains(h.Accounts, seedZimina) || slices.Contains(h.Accounts, seedBelova) {
		t.Fatalf("hint %+v addresses people the change did not touch", h)
	}
}

// W-4 (Q-W1.05-17, Q-W0.08-5): уборка по расписанию — у предпросмотра, истёкшего час назад, строки (ПДн) удалены и
// state = expired; предпросмотр, истёкший больше недели назад, удалён целиком; живой — не тронут.
//
//nolint:paralleltest // the worker cleans every seeded tenant
func TestRunPurgesImports(t *testing.T) {
	alta := superDB(t, "t_alta")
	var unit, person uuid.UUID
	if err := alta.QueryRowContext(t.Context(), `select home_unit_id, id from people.person_profiles where email = 'd.zimina@alta.example'`).
		Scan(&unit, &person); err != nil {
		t.Fatal(err)
	}
	preview := func(expires string) uuid.UUID {
		id := uuid.New()
		if _, err := alta.ExecContext(t.Context(), `insert into people.imports (id, state, file_name, default_unit_id, created_by,
			created_at, expires_at) values ($1, 'previewed', 'w142.csv', $2, $3, now() - interval '30 days', now() + $4::interval)`,
			id, unit, person, expires); err != nil {
			t.Fatal(err)
		}
		if _, err := alta.ExecContext(t.Context(), `insert into people.import_rows (import_id, line, action, data)
			values ($1, 2, 'create', '{"fullName": "Иван Петров", "email": "i.petrov@example.com"}')`, id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	stale, old, fresh := preview("-1 hour"), preview("-8 days"), preview("23 hours")
	t.Cleanup(func() {
		_, _ = alta.ExecContext(context.WithoutCancel(t.Context()), `delete from people.imports where id = any($1)`, []uuid.UUID{stale, old, fresh})
	})
	runWorker(t, map[string]string{"WORKER_PURGE_INTERVAL": "100ms"})

	eventually(t, 10*time.Second, "the expired preview cleaned", func() bool {
		return count(t, alta, `select count(*) from people.imports where id = $1 and state = 'expired'`, stale) == 1
	})
	for _, c := range []struct {
		what  string
		q     string
		id    uuid.UUID
		count int
	}{
		{"rows of the expired preview", `select count(*) from people.import_rows where import_id = $1`, stale, 0},
		{"the preview expired a week ago", `select count(*) from people.imports where id = $1`, old, 0},
		{"the live preview", `select count(*) from people.imports where id = $1 and state = 'previewed'`, fresh, 1},
		{"rows of the live preview", `select count(*) from people.import_rows where import_id = $1`, fresh, 1},
	} {
		if n := count(t, alta, c.q, c.id); n != c.count {
			t.Errorf("%s: %d, want %d", c.what, n, c.count)
		}
	}
}
