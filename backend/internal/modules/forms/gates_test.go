package forms

import (
	"context"
	"runtime"
	"testing"
	"time"
	"weak"

	"github.com/jackc/pgx/v5/pgxpool"
)

// lazyPool is a pool of size connections that never connects (no statement runs on it).
func lazyPool(t *testing.T, size string) *pgxpool.Pool {
	t.Helper()
	cfg, err := pgxpool.ParseConfig("postgres://w482@127.0.0.1:1/w482?pool_max_conns=" + size)
	if err != nil {
		t.Fatal(err)
	}
	p, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p
}

// W4.82: an operation holding its transaction takes one more connection of the pool for the port of objects, so at most
// MaxConns − portConns operations of a pool hold a transaction at once (one at least); the next waits for a turn and
// gives up with its context.
func TestTxGatesLeaveAConnectionForThePort(t *testing.T) {
	t.Parallel()
	var g txGates
	four, one := lazyPool(t, "4"), lazyPool(t, "1")
	if got := cap(g.of(four)); got != 4-portConns {
		t.Errorf("turns of a pool of 4 = %d, want %d", got, 4-portConns)
	}
	if first, again := g.of(four), g.of(four); first != again {
		t.Error("a pool has one gate")
	}
	if got := cap(g.of(one)); got != 1 {
		t.Errorf("turns of a pool of 1 = %d, want 1", got)
	}
	var leaves []func()
	for range 4 - portConns {
		leave, err := g.enter(t.Context(), four)
		if err != nil {
			t.Fatal(err)
		}
		leaves = append(leaves, leave)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	if _, err := g.enter(ctx, four); err == nil {
		t.Fatal("a turn beyond MaxConns − portConns was given")
	}
	leaves[0]()
	leave, err := g.enter(t.Context(), four)
	if err != nil {
		t.Fatalf("a freed turn was not given: %v", err)
	}
	leave()
}

// W4.82 return 1: the turns belong to the pool, not to a Service — cmd/api builds several Services over one pool
// (forms and formFilesAccess), and each with a gate of its own would let 2×(MaxConns − portConns) transactions in.
func TestTxGatesAreSharedByServicesOfOnePool(t *testing.T) {
	t.Parallel()
	a, b := &Service{}, &Service{}
	pool := lazyPool(t, "4")
	var leaves []func()
	for range 4 - portConns {
		leave, err := a.gates.enter(t.Context(), pool)
		if err != nil {
			t.Fatal(err)
		}
		leaves = append(leaves, leave)
	}
	defer func() {
		for _, l := range leaves {
			l()
		}
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	if leave, err := b.gates.enter(ctx, pool); err == nil {
		leave()
		t.Fatal("a second Service took a turn of a pool whose turns the first one holds")
	}
}

// hasGate reports whether the gate of the pool k points at is kept.
func hasGate(k weak.Pointer[pgxpool.Pool]) bool {
	sharedGates.mu.Lock()
	defer sharedGates.mu.Unlock()
	_, ok := sharedGates.by[k]
	return ok
}

// openAndLeave takes and gives back a turn of a pool nothing else refers to, then closes the pool.
func openAndLeave(t *testing.T) weak.Pointer[pgxpool.Pool] {
	t.Helper()
	cfg, err := pgxpool.ParseConfig("postgres://w482@127.0.0.1:1/w482?pool_max_conns=4")
	if err != nil {
		t.Fatal(err)
	}
	p, err := pgxpool.NewWithConfig(t.Context(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	var g txGates
	leave, err := g.enter(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	leave()
	p.Close()
	return weak.Make(p)
}

// W4.82 return 1: the gate of a pool that is gone (a tenant's pool is replaced) does not stay in memory.
func TestTxGatesForgetAClosedPool(t *testing.T) {
	t.Parallel()
	k := openAndLeave(t)
	deadline := time.Now().Add(5 * time.Second)
	for hasGate(k) && time.Now().Before(deadline) {
		runtime.GC()
		time.Sleep(10 * time.Millisecond)
	}
	if hasGate(k) {
		t.Error("the gate stays after the pool is collected")
	}
}
