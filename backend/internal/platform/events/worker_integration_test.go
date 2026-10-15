//go:build integration

package events

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Тест E-3 брифа W1.01: Worker.RunOnce по нескольким организациям.

type pools map[uuid.UUID]*pgxpool.Pool

func (p pools) For(_ context.Context, id uuid.UUID) (*pgxpool.Pool, error) {
	if pool, ok := p[id]; ok {
		return pool, nil
	}
	return nil, errors.New("dependency_unavailable: tenant DB")
}

type delivered struct {
	mu   sync.Mutex
	seen map[uuid.UUID][]string
}

func (d *delivered) handler(_ context.Context, m Message) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.seen[m.TenantID] = append(d.seen[m.TenantID], m.Type)
	return nil
}

func TestWorkerRunOnce(t *testing.T) {
	t.Parallel()
	apiA, workerA := tenantDB(t)
	apiB, workerB := tenantDB(t)
	tenantA, tenantB, broken := uuid.New(), uuid.New(), uuid.New()
	publish(t, apiA, "fleet.trip.submitted.v1")
	publish(t, apiA, "fleet.trip.submitted.v1")
	publish(t, apiA, "test.always.fails.v1")
	publish(t, apiB, "fleet.trip.submitted.v1")
	publish(t, apiB, "nobody.listens.here.v1")

	d := &delivered{seen: map[uuid.UUID][]string{}}
	reg := NewRegistry()
	reg.Handle("fleet.trip.submitted.v1", d.handler)
	reg.Handle("test.always.fails.v1", func(context.Context, Message) error { return errors.New("consumer down") })
	w := &Worker{
		Tenants:  func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{tenantA, broken, tenantB}, nil },
		Pools:    pools{tenantA: workerA, tenantB: workerB},
		Registry: reg,
		Batch:    2, // several batches per tenant
		Backoff:  func(int) time.Duration { return time.Hour },
		Log:      slog.New(slog.DiscardHandler),
	}
	stats, err := w.RunOnce(t.Context())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	want := Stats{Tenants: 2, Published: 4, Retried: 1, Errors: 1}
	if stats != want {
		t.Fatalf("stats = %+v, want %+v", stats, want)
	}
	if len(d.seen[tenantA]) != 2 || len(d.seen[tenantB]) != 1 {
		t.Fatalf("delivered = %v", d.seen)
	}
	if n := count(t, workerA, "published_at is null and last_error = 'consumer down' and available_at > now()"); n != 1 {
		t.Fatal("failed event not scheduled for a retry")
	}
	if n := count(t, workerB, "published_at is null"); n != 0 {
		t.Fatal("event without handlers left undelivered")
	}
	if _, err := (&Worker{Tenants: func(context.Context) ([]uuid.UUID, error) { return nil, errors.New("control DB") }}).RunOnce(t.Context()); err == nil {
		t.Fatal("RunOnce must fail when the tenants cannot be listed")
	}
}

func TestWorkerRunStops(t *testing.T) {
	t.Parallel()
	_, worker := tenantDB(t)
	tenant := uuid.New()
	ctx, cancel := context.WithCancel(t.Context())
	passes := make(chan struct{}, 10)
	w := &Worker{
		Tenants: func(context.Context) ([]uuid.UUID, error) {
			select {
			case passes <- struct{}{}:
			default:
			}
			return []uuid.UUID{tenant}, nil
		},
		Pools: pools{tenant: worker}, Registry: NewRegistry(), Interval: 10 * time.Millisecond,
		Log: slog.New(slog.DiscardHandler),
	}
	done := make(chan error, 1)
	go func() { done <- w.Run(ctx) }()
	for range 2 {
		select {
		case <-passes:
		case err := <-done:
			t.Fatalf("Run returned before cancel: %v", err)
		case <-time.After(5 * time.Second):
			t.Fatal("Run makes no passes")
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run = %v, want nil after cancel", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop")
	}
}
