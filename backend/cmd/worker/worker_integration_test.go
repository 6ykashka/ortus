//go:build integration

package main

// Тест W-2 брифа W1.01: cmd/worker на control DB с Go-сидом W0.06 (tenant DB «Альты» и «Лотоса»), роль
// ortus_worker. Публикует API (ortus_api), доставляет и повторяет worker.

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var (
	stack     *migratetest.Cluster
	controlDB = "ortus_control_w101"
	seedAlta  = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:t-alta"))
	seedLotos = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:t-lotos"))
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	c, stop, err := migratetest.Start(ctx, migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	stack = c
	code := 1
	if err := prepare(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "stack:", err)
	} else {
		code = m.Run()
	}
	stop()
	os.Exit(code)
}

// prepare migrates a control DB and runs the Go seed of W0.06 (tenant DBs t_alta and t_lotos).
func prepare(ctx context.Context) error {
	super, err := sql.Open("pgx", stack.URL("postgres", migratetest.Super))
	if err != nil {
		return err
	}
	defer super.Close()
	if err := migrations.CreateDatabase(ctx, super, controlDB); err != nil {
		return err
	}
	mig, err := sql.Open("pgx", stack.URL(controlDB, migrations.RoleMigrator))
	if err != nil {
		return err
	}
	defer mig.Close()
	if _, err := migrations.Up(ctx, mig, migrations.Control); err != nil {
		return fmt.Errorf("migrate control: %w", err)
	}
	cmd := exec.CommandContext(ctx, "go", "run", "./cmd/seed")
	cmd.Dir = "../.."
	cmd.Env = append(os.Environ(),
		"MIGRATOR_DB_URL="+stack.URL(controlDB, migrations.RoleMigrator),
		"PG_SUPER_URL="+stack.URL(controlDB, migratetest.Super))
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("seed: %w\n%s", err, out)
	}
	return nil
}

// workerEnv is the environment of cmd/worker: control and tenant DBs as ortus_worker.
func workerEnv(extra map[string]string) func(string) string {
	m := map[string]string{
		"CONTROL_DB_URL":       stack.URL(controlDB, migrations.RoleWorker),
		"TENANT_DB_URL":        stack.URL("postgres", migrations.RoleWorker),
		"WORKER_POLL_INTERVAL": "50ms",
		"LOG_LEVEL":            "error",
	}
	maps.Copy(m, extra)
	return func(k string) string { return m[k] }
}

func tenantPool(t *testing.T, db, role string) *pgxpool.Pool {
	t.Helper()
	p, err := pgxpool.New(t.Context(), stack.URL(db, role))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

func publishOne(t *testing.T, api *pgxpool.Pool, typ string) uuid.UUID {
	t.Helper()
	id, err := events.Publish(t.Context(), api, events.Event{Type: typ, Aggregate: "trip", AggregateID: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestListTenants(t *testing.T) {
	t.Parallel()
	ctl, err := pgxpool.New(t.Context(), stack.URL(controlDB, migrations.RoleWorker))
	if err != nil {
		t.Fatal(err)
	}
	defer ctl.Close()
	got, err := listTenants(ctl)(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	// Ремстрой (read_only) и Карго (suspended) в стенде без tenant DB: у них нет tenant_routing.
	if len(got) != 2 || !slices.Contains(got, seedAlta) || !slices.Contains(got, seedLotos) {
		t.Fatalf("tenants = %v, want t-alta and t-lotos", got)
	}
}

//nolint:paralleltest // the worker delivers every seeded tenant: it would take the event of TestDeadAndRetry
func TestRunDelivers(t *testing.T) {
	api := tenantPool(t, "t_lotos", migrations.RoleAPI)
	id := publishOne(t, api, "spa.visit.completed.v1")
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan int, 1)
	var out, errOut bytes.Buffer
	go func() { done <- run(ctx, []string{"run"}, workerEnv(nil), &out, &errOut) }()
	deadline := time.Now().Add(10 * time.Second)
	for {
		var published bool
		if err := api.QueryRow(t.Context(), `select published_at is not null from outbox.events where event_id = $1`, id).
			Scan(&published); err != nil {
			t.Fatal(err)
		}
		if published {
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("event not delivered; stderr %s", errOut.String())
		}
		time.Sleep(50 * time.Millisecond)
	}
	cancel()
	if code := <-done; code != exitOK {
		t.Fatalf("run after SIGTERM: exit %d, stderr %s", code, errOut.String())
	}
}

// makeDead publishes an event in the tenant DB and fails its only delivery (MaxAttempts 1): it is dead-lettered.
func makeDead(t *testing.T, api, worker *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := publishOne(t, api, "fleet.trip.submitted.v1")
	o := &events.Outbox{DB: worker, MaxAttempts: 1}
	ms, lease, err := o.Claim(t.Context(), 100)
	if err != nil || len(ms) == 0 {
		t.Fatalf("Claim = %v, %v", len(ms), err)
	}
	for _, m := range ms {
		if _, err := o.Failed(t.Context(), m, lease, errors.New("consumer down")); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

// checkRetried: the event is due again with its attempts reset, and the manual retry is in audit.events.
func checkRetried(t *testing.T, worker *pgxpool.Pool, id uuid.UUID) {
	t.Helper()
	var due, audited bool
	err := worker.QueryRow(t.Context(), `select available_at <= now() and attempts = 0 from outbox.events where event_id = $1`, id).Scan(&due)
	if err != nil || !due {
		t.Fatalf("event not returned to delivery: %v %v", due, err)
	}
	err = worker.QueryRow(t.Context(), `select exists (select 1 from audit.events where action = 'outbox.event.retry'
   and target_type = 'outbox.event' and target_id = $1 and actor_kind = 'service' and result = 'ok'
   and diff ->> 'eventId' = $1::text)`, id).Scan(&audited)
	if err != nil || !audited {
		t.Fatalf("manual retry not audited: %v %v", audited, err)
	}
}

//nolint:paralleltest // shares the seeded tenant DB of «Альта» with TestRunDelivers
func TestDeadAndRetry(t *testing.T) {
	api := tenantPool(t, "t_alta", migrations.RoleAPI)
	worker := tenantPool(t, "t_alta", migrations.RoleWorker)
	id := makeDead(t, api, worker)
	alta := seedAlta.String()

	var out, errOut bytes.Buffer
	if code := run(t.Context(), []string{"dead", "--tenant", alta}, workerEnv(nil), &out, &errOut); code != exitOK {
		t.Fatalf("dead: exit %d, stderr %s", code, errOut.String())
	}
	if !strings.Contains(out.String(), id.String()) || !strings.Contains(out.String(), "consumer down") {
		t.Fatalf("dead output = %s", out.String())
	}
	args := []string{"retry", "--tenant", alta, "--event", id.String()}
	if code := run(t.Context(), args, workerEnv(nil), &out, &errOut); code != exitOK {
		t.Fatalf("retry: exit %d, stderr %s", code, errOut.String())
	}
	checkRetried(t, worker, id)
	if code := run(t.Context(), args, workerEnv(nil), &out, &errOut); code != exitNotDead {
		t.Fatalf("second retry: exit %d, want %d", code, exitNotDead)
	}
	unknown := []string{"dead", "--tenant", uuid.NewString()}
	if code := run(t.Context(), unknown, workerEnv(nil), &out, &errOut); code != exitFailed {
		t.Fatalf("dead of an unknown tenant: exit %d, want %d", code, exitFailed)
	}
}
