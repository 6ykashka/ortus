//go:build integration

package events

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Тест E-2 брифа W1.01: outbox на tenant DB (testcontainers): API вставляет, worker арендует, повторяет,
// переводит в dead-letter, ручной повтор, inbox.

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

// tenantDB returns pools of ortus_api and ortus_worker on a fresh migrated tenant DB.
func tenantDB(t *testing.T) (api, worker *pgxpool.Pool) {
	t.Helper()
	name := cluster.NewDatabase(t, "events")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), migrations.Tenant); err != nil {
		t.Fatalf("migrate tenant: %v", err)
	}
	open := func(role string) *pgxpool.Pool {
		p, err := pgxpool.New(t.Context(), cluster.URL(name, role))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(p.Close)
		return p
	}
	return open(migrations.RoleAPI), open(migrations.RoleWorker)
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func publish(t *testing.T, db DB, typ string) uuid.UUID {
	t.Helper()
	id, err := Publish(t.Context(), db, Event{Type: typ, Aggregate: "trip", AggregateID: uuid.New(), Payload: map[string]any{"n": 1}})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	return id
}

func inTx(t *testing.T, pool *pgxpool.Pool, f func(pgx.Tx), commit bool) {
	t.Helper()
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	f(tx)
	if commit {
		if err := tx.Commit(t.Context()); err != nil {
			t.Fatal(err)
		}
	}
}

func count(t *testing.T, db DB, where string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(t.Context(), "select count(*) from outbox.events where "+where).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPublishInTransaction(t *testing.T) {
	t.Parallel()
	api, _ := tenantDB(t)
	inTx(t, api, func(tx pgx.Tx) { publish(t, tx, "fleet.trip.submitted.v1") }, false)
	if n := count(t, api, "true"); n != 0 {
		t.Fatalf("rolled back event stored: %d", n)
	}
	var id uuid.UUID
	inTx(t, api, func(tx pgx.Tx) { id = publish(t, tx, "fleet.trip.submitted.v1") }, true)
	var (
		typ, agg, payload string
		attempts          int
		due               bool
	)
	err := api.QueryRow(t.Context(), `select type, aggregate, payload::text, attempts, available_at <= now()
  from outbox.events where event_id = $1`, id).Scan(&typ, &agg, &payload, &attempts, &due)
	if err != nil {
		t.Fatal(err)
	}
	if typ != "fleet.trip.submitted.v1" || agg != "trip" || payload != `{"n": 1}` || attempts != 0 || !due {
		t.Fatalf("row = %s %s %s %d due=%v", typ, agg, payload, attempts, due)
	}
	later, err := Publish(t.Context(), api, Event{Type: "fleet.trip.reminded.v1", Aggregate: "trip", AggregateID: uuid.New(), AvailableAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if n := count(t, api, fmt.Sprintf("event_id = '%s' and available_at > now() + interval '59 minutes'", later)); n != 1 {
		t.Fatal("AvailableAt is not stored")
	}
	_, err = api.Exec(t.Context(), `update outbox.events set published_at = now()`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatalf("UPDATE outbox.events by ortus_api = %v, want insufficient_privilege", err)
	}
}

func ids(ms []Message) []int64 {
	out := make([]int64, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.ID)
	}
	return out
}

// checkClaimed: first delivery of the published events, ordered by id.
func checkClaimed(t *testing.T, ms []Message) {
	t.Helper()
	for _, m := range ms {
		if m.Attempts != 1 || m.Type != "fleet.trip.submitted.v1" || string(m.Payload) != `{"n": 1}` || m.EventID == uuid.Nil {
			t.Fatalf("message = %+v", m)
		}
	}
	if !slices.IsSortedFunc(ms, func(a, b Message) int { return int(a.ID - b.ID) }) {
		t.Fatal("claimed messages are not ordered by id")
	}
}

func TestClaimSkipLocked(t *testing.T) {
	t.Parallel()
	api, worker := tenantDB(t)
	for range 10 {
		publish(t, api, "fleet.trip.submitted.v1")
	}
	c := &clock{t: time.Now()}
	var (
		wg   sync.WaitGroup
		got  [2][]Message
		errs [2]error
	)
	for i := range 2 {
		wg.Go(func() {
			o := &Outbox{DB: worker, Now: c.now}
			got[i], _, errs[i] = o.Claim(t.Context(), 6)
		})
	}
	wg.Wait()
	if errs[0] != nil || errs[1] != nil {
		t.Fatal(errs)
	}
	all := append(ids(got[0]), ids(got[1])...)
	slices.Sort(all)
	if len(all) != 10 || len(slices.Compact(slices.Clone(all))) != 10 {
		t.Fatalf("two workers claimed %v: want 10 distinct events", all)
	}
	checkClaimed(t, got[0])
	checkClaimed(t, got[1])

	if more, _, err := (&Outbox{DB: worker, Now: c.now}).Claim(t.Context(), 10); err != nil || len(more) != 0 {
		t.Fatalf("leased events claimed again: %v %v", ids(more), err)
	}
}

func TestLeaseExpiry(t *testing.T) {
	t.Parallel()
	api, worker := tenantDB(t)
	publish(t, api, "fleet.trip.submitted.v1")
	c := &clock{t: time.Now()}
	first := &Outbox{DB: worker, Now: c.now, Lease: 30 * time.Second}
	ms, lease1, err := first.Claim(t.Context(), 10)
	if err != nil || len(ms) != 1 {
		t.Fatalf("Claim = %v, %v", ids(ms), err)
	}
	c.add(31 * time.Second)
	second := &Outbox{DB: worker, Now: c.now, Lease: 30 * time.Second}
	again, lease2, err := second.Claim(t.Context(), 10)
	if err != nil || len(again) != 1 || again[0].Attempts != 2 {
		t.Fatalf("expired lease not reclaimed: %+v %v", again, err)
	}
	if err := first.Published(t.Context(), ms[0].ID, lease1); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("Published with the old lease = %v, want ErrLeaseLost", err)
	}
	if _, err := first.Failed(t.Context(), ms[0], lease1, errors.New("late")); !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("Failed with the old lease = %v, want ErrLeaseLost", err)
	}
	if err := second.Published(t.Context(), again[0].ID, lease2); err != nil {
		t.Fatalf("Published: %v", err)
	}
	if n := count(t, worker, "published_at is not null and locked_until is null and last_error is null"); n != 1 {
		t.Fatal("event not marked published")
	}
}

// failUntilDead fails every delivery of the only event: backoff between attempts, dead-letter after the third.
func failUntilDead(t *testing.T, o *Outbox, c *clock) {
	t.Helper()
	for attempt := 1; attempt <= 3; attempt++ {
		ms, lease, err := o.Claim(t.Context(), 10)
		if err != nil || len(ms) != 1 || ms[0].Attempts != attempt {
			t.Fatalf("attempt %d: Claim = %+v, %v", attempt, ms, err)
		}
		dead, err := o.Failed(t.Context(), ms[0], lease, fmt.Errorf("handler failed %d", attempt))
		if err != nil || dead != (attempt == 3) {
			t.Fatalf("attempt %d: Failed = %v, %v", attempt, dead, err)
		}
		if early, _, _ := o.Claim(t.Context(), 10); len(early) != 0 {
			t.Fatalf("attempt %d: event claimed before its backoff", attempt)
		}
		c.add(time.Minute)
	}
}

func TestRetriesAndDeadLetter(t *testing.T) {
	t.Parallel()
	api, worker := tenantDB(t)
	id := publish(t, api, "fleet.trip.submitted.v1")
	c := &clock{t: time.Now()}
	o := &Outbox{DB: worker, Now: c.now, MaxAttempts: 3, Backoff: func(int) time.Duration { return time.Minute }}
	failUntilDead(t, o, c)
	c.add(24 * time.Hour)
	if ms, _, _ := o.Claim(t.Context(), 10); len(ms) != 0 {
		t.Fatal("dead-letter event delivered")
	}
	dl, err := o.DeadLetters(t.Context(), 10)
	if err != nil || len(dl) != 1 || dl[0].EventID != id || dl[0].LastError != "handler failed 3" || dl[0].Attempts != 3 {
		t.Fatalf("DeadLetters = %+v, %v", dl, err)
	}

	retryDead(t, o, id)
}

// retryDead: a manual retry returns the dead-letter event to delivery once; unknown and published events are
// not in the dead-letter.
func retryDead(t *testing.T, o *Outbox, id uuid.UUID) {
	t.Helper()
	if err := o.Retry(t.Context(), uuid.New()); !errors.Is(err, ErrNotDead) {
		t.Fatalf("Retry of an unknown event = %v, want ErrNotDead", err)
	}
	if err := o.Retry(t.Context(), id); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	ms, lease, err := o.Claim(t.Context(), 10)
	if err != nil || len(ms) != 1 || ms[0].Attempts != 1 {
		t.Fatalf("after Retry: Claim = %+v, %v", ms, err)
	}
	if err := o.Published(t.Context(), ms[0].ID, lease); err != nil {
		t.Fatal(err)
	}
	if err := o.Retry(t.Context(), id); !errors.Is(err, ErrNotDead) {
		t.Fatalf("Retry of a published event = %v, want ErrNotDead", err)
	}
	if dl, _ := o.DeadLetters(t.Context(), 10); len(dl) != 0 {
		t.Fatalf("dead-letter after the retry: %+v", dl)
	}
}

func TestOnce(t *testing.T) {
	t.Parallel()
	_, worker := tenantDB(t)
	id := uuid.New()
	for i, want := range []bool{true, false} {
		first, err := Once(t.Context(), worker, "notify.inbox", id)
		if err != nil || first != want {
			t.Fatalf("delivery %d: Once = %v, %v; want %v", i+1, first, err, want)
		}
	}
	if first, err := Once(t.Context(), worker, "realtime", id); err != nil || !first {
		t.Fatalf("another consumer: Once = %v, %v", first, err)
	}
}
