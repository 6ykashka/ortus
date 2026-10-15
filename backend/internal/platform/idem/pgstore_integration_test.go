//go:build integration

package idem

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Тесты I-10, I-11 брифа W1.01: PGStore на tenant DB (testcontainers, миграции W0.06, роль ortus_api).

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

// apiPool returns a pool of role ortus_api on a fresh migrated tenant DB.
func apiPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	name := cluster.NewDatabase(t, "idem")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), migrations.Tenant); err != nil {
		t.Fatalf("migrate tenant: %v", err)
	}
	pool, err := pgxpool.New(t.Context(), cluster.URL(name, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

type fixedPools map[uuid.UUID]*pgxpool.Pool

func (f fixedPools) For(_ context.Context, id uuid.UUID) (*pgxpool.Pool, error) {
	if p, ok := f[id]; ok {
		return p, nil
	}
	return nil, errors.New("no pool")
}

var t0 = time.Date(2026, time.October, 1, 7, 30, 0, 0, time.UTC)

func state(t *testing.T, pool *pgxpool.Pool, rec Record) (string, int) {
	t.Helper()
	var (
		st     string
		status *int
	)
	err := pool.QueryRow(t.Context(),
		`select state, response_status from core.idempotency_keys where actor_id = $1 and operation = $2 and key = $3`,
		rec.ActorID, rec.Operation, rec.Key).Scan(&st, &status)
	if err != nil {
		return "", 0
	}
	if status == nil {
		return st, 0
	}
	return st, *status
}

// begin calls st.Begin at the instant at with the default lease and checks the error.
func begin(t *testing.T, st Store, rec Record, at time.Time, want error) *Outcome {
	t.Helper()
	out, err := st.Begin(t.Context(), rec, at, at.Add(DefaultLease))
	if !errors.Is(err, want) {
		t.Fatalf("Begin(%s) = %v, %v; want error %v", rec.Hash, out, err, want)
	}
	return out
}

// checkStored: the replay keeps the original bytes of the body and only the stored headers.
func checkStored(t *testing.T, got *Outcome, body []byte) {
	t.Helper()
	if got == nil || got.Status != http.StatusCreated || string(got.Body) != string(body) {
		t.Fatalf("replay = %+v, want the original bytes %s", got, body)
	}
	if got.Header.Get("ETag") != `"rev-1"` || got.Header.Get("Content-Type") != "application/json" || got.Header.Get("X-Other") != "" {
		t.Fatalf("replay headers = %v", got.Header)
	}
}

func TestPGStoreLifecycle(t *testing.T) {
	t.Parallel()
	pool := apiPool(t)
	st := NewPGStore(pool)
	rec := Record{Namespace: nsA1, Key: testKey, Hash: []byte("hash-1")}
	other := Record{Namespace: nsA1, Key: testKey, Hash: []byte("hash-2")}
	if out := begin(t, st, rec, t0, nil); out != nil {
		t.Fatalf("first Begin replayed %v", out)
	}
	begin(t, st, rec, t0, ErrInProgress)
	begin(t, st, other, t0, ErrKeyReused)
	body := []byte(`{"z":1,"a":{"y":2,"b":3}}`)
	out := Outcome{Status: http.StatusCreated, Header: http.Header{"Content-Type": {"application/json"}, "Etag": {`"rev-1"`}, "X-Other": {"x"}}, Body: body}
	if err := st.Complete(t.Context(), rec, out, t0.Add(DefaultTTL)); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if s, code := state(t, pool, rec); s != "completed" || code != http.StatusCreated {
		t.Fatalf("row = %s %d", s, code)
	}
	if err := st.Release(t.Context(), rec); err != nil {
		t.Fatalf("Release of a completed record: %v", err)
	}
	checkStored(t, begin(t, st, rec, t0.Add(time.Hour), nil), body)

	// The record expires after the TTL and is claimed again, then released.
	if out := begin(t, st, other, t0.Add(DefaultTTL), nil); out != nil {
		t.Fatalf("Begin after expiry replayed %v", out)
	}
	if err := st.Release(t.Context(), other); err != nil {
		t.Fatal(err)
	}
	if s, _ := state(t, pool, rec); s != "" {
		t.Fatalf("released record still present: %s", s)
	}
}
func TestPGStoreStaleLease(t *testing.T) {
	t.Parallel()
	st := NewPGStore(apiPool(t))
	rec := Record{Namespace: nsA1, Key: testKey, Hash: []byte("crashed")}
	if _, err := st.Begin(t.Context(), rec, t0, t0.Add(DefaultLease)); err != nil {
		t.Fatal(err)
	}
	retry := Record{Namespace: nsA1, Key: testKey, Hash: []byte("crashed")}
	if out, err := st.Begin(t.Context(), retry, t0.Add(DefaultLease), t0.Add(2*DefaultLease)); out != nil || err != nil {
		t.Fatalf("Begin after the lease = %v, %v; want a new claim", out, err)
	}
}

// guardOn serves next under a Guard whose tenant store is pool.
func guardOn(pool *pgxpool.Pool, now func() time.Time) *Guard {
	return &Guard{Stores: TenantStores{Pools: fixedPools{tenantA: pool, tenantB: pool}, Platform: NewMemStore()}, Now: now}
}

func countRows(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(t.Context(), "select count(*) from "+table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// effect inserts an outbox event in tx and stores the outcome with it (the pattern of W1.03+ services).
func effect(pool *pgxpool.Pool, commit bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		tx, err := pool.Begin(ctx)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
		var id int64
		if err := tx.QueryRow(ctx, `insert into outbox.events (type, aggregate, aggregate_id, payload)
values ('test.thing.created.v1', 'thing', gen_random_uuid(), '{}') returning id`).Scan(&id); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		body := fmt.Appendf(nil, `{"id":%d,"source":"service"}`, id)
		if err := CompleteInTx(ctx, tx, http.StatusCreated, http.Header{"Content-Type": {"application/json"}}, body); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		if !commit {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = io.WriteString(w, `{"source":"handler"}`)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write(body)
	}
}

func TestCompleteInTx(t *testing.T) {
	t.Parallel()
	pool := apiPool(t)
	g := guardOn(pool, func() time.Time { return t0 })
	first := do(g, nsA1, testKey, `{}`, effect(pool, true))
	if first.Code != http.StatusCreated {
		t.Fatalf("first: %d %s", first.Code, first.Body)
	}
	again := do(g, nsA1, testKey, `{}`, effect(pool, true))
	if again.Header().Get(HeaderReplayed) != "true" || again.Body.String() != first.Body.String() {
		t.Fatalf("replay: %d %s", again.Code, again.Body)
	}
	if n := countRows(t, pool, "outbox.events"); n != 1 {
		t.Fatalf("outbox.events = %d, want 1", n)
	}
	// Rolled back: the outcome written in the transaction is gone, the middleware stores the handler response.
	ns := nsA1
	ns.Operation = "rolledBack"
	do(g, ns, testKey, `{}`, effect(pool, false))
	replayed := do(g, ns, testKey, `{}`, effect(pool, true))
	if replayed.Code != http.StatusUnprocessableEntity || replayed.Body.String() != `{"source":"handler"}` {
		t.Fatalf("after rollback: %d %s", replayed.Code, replayed.Body)
	}
	if n := countRows(t, pool, "outbox.events"); n != 1 {
		t.Fatalf("outbox.events after rollback = %d, want 1", n)
	}
}

func TestCompleteInTxLeaseLost(t *testing.T) {
	t.Parallel()
	pool := apiPool(t)
	g := guardOn(pool, func() time.Time { return t0 })
	var got error
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec, _ := FromContext(r.Context())
		// Another request took the record over after the lease.
		if _, err := pool.Exec(r.Context(), `update core.idempotency_keys set request_hash = 'other' where key = $1`, rec.Key); err != nil {
			t.Error(err)
		}
		tx, err := pool.Begin(r.Context())
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = tx.Rollback(r.Context()) }()
		got = CompleteInTx(r.Context(), tx, http.StatusCreated, nil, nil)
		w.WriteHeader(http.StatusConflict)
	})
	do(g, nsA1, testKey, `{}`, h)
	if !errors.Is(got, ErrLeaseLost) {
		t.Fatalf("CompleteInTx after takeover = %v, want ErrLeaseLost", got)
	}
}

// I-11: один ключ одного актора в двух организациях — два эффекта (пространство tenant = своя БД).
func TestTenantNamespaces(t *testing.T) {
	t.Parallel()
	poolA, poolB := apiPool(t), apiPool(t)
	g := &Guard{Stores: TenantStores{Pools: fixedPools{tenantA: poolA, tenantB: poolB}}, Now: func() time.Time { return t0 }}
	nsB := Namespace{TenantID: tenantB, ActorID: actor1, Operation: nsA1.Operation}
	if w := do(g, nsA1, testKey, `{}`, effect(poolA, true)); w.Code != http.StatusCreated {
		t.Fatalf("tenant A: %d %s", w.Code, w.Body)
	}
	if w := do(g, nsB, testKey, `{"other":1}`, effect(poolB, true)); w.Code != http.StatusCreated || w.Header().Get(HeaderReplayed) != "" {
		t.Fatalf("tenant B: %d %s", w.Code, w.Body)
	}
	if a, b := countRows(t, poolA, "outbox.events"), countRows(t, poolB, "outbox.events"); a != 1 || b != 1 {
		t.Fatalf("effects: A=%d B=%d, want 1 and 1", a, b)
	}
}

func TestTenantStores(t *testing.T) {
	t.Parallel()
	pool := apiPool(t)
	platform := NewMemStore()
	ts := TenantStores{Pools: fixedPools{tenantA: pool}, Platform: platform}
	if st, err := ts.For(t.Context(), uuid.Nil); err != nil || st != Store(platform) {
		t.Fatalf("For(Nil) = %v, %v; want the platform store", st, err)
	}
	st, err := ts.For(t.Context(), tenantA)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := st.(*PGStore); !ok {
		t.Fatalf("For(tenant) = %T, want *PGStore", st)
	}
	if _, err := ts.For(t.Context(), tenantB); err == nil || !strings.Contains(err.Error(), "no pool") {
		t.Fatalf("For(unknown tenant) = %v", err)
	}
	if _, err := (TenantStores{Pools: fixedPools{}}).For(t.Context(), uuid.Nil); err == nil {
		t.Fatal("For(Nil) without a platform store must fail")
	}
}
