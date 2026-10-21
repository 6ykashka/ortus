package main

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
)

// W2.07 (Q-W2.51-4, Q-W2.51-15): досчёт пула проходит все организации на момент часов приложения — истекают открытые
// запросы, завершаются назначения; сбой одной не останавливает остальные и возвращается ошибкой с её id.
func TestPoolSettleOnce(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	at := time.Date(2026, 10, 1, 15, 0, 0, 0, time.UTC)
	var (
		mu   sync.Mutex
		seen []uuid.UUID
	)
	s := poolSettle{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{a, b, c}, nil },
		settle: func(_ context.Context, tenant uuid.UUID, now time.Time) (pool.Result, error) {
			mu.Lock()
			defer mu.Unlock()
			if !now.Equal(at) {
				return pool.Result{}, errors.New("not the clock of the application")
			}
			seen = append(seen, tenant)
			if tenant == b {
				return pool.Result{}, errors.New("tenant DB unreachable")
			}
			return pool.Result{Completed: 1}, nil
		},
		now: func() time.Time { return at }, every: time.Minute, log: slog.New(slog.DiscardHandler),
	}
	err := s.once(t.Context())
	if err == nil || !strings.Contains(err.Error(), b.String()) {
		t.Fatalf("once = %v, want the error of %s", err, b)
	}
	if !slices.Equal(seen, []uuid.UUID{a, b, c}) {
		t.Fatalf("settled %v, want every tenant", seen)
	}
	s.tenants = func(context.Context) ([]uuid.UUID, error) { return nil, errors.New("control DB down") }
	if err := s.once(t.Context()); err == nil {
		t.Fatal("no tenants: no error")
	}
}

// W2.72 (S2-20 правило 4): на каждом проходе досчёта пула закрываются предложения машин, у которых прошёл срок выбора,
// в каждой организации; сбой одной не останавливает остальные.
func TestPoolSettleOffers(t *testing.T) {
	t.Parallel()
	a, b := uuid.New(), uuid.New()
	var (
		mu   sync.Mutex
		seen []uuid.UUID
	)
	s := poolSettle{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{a, b}, nil },
		settle: func(context.Context, uuid.UUID, time.Time) (pool.Result, error) {
			return pool.Result{}, nil
		},
		offers: func(_ context.Context, tenant uuid.UUID) (int, error) {
			mu.Lock()
			defer mu.Unlock()
			seen = append(seen, tenant)
			if tenant == a {
				return 0, errors.New("tenant DB unreachable")
			}
			return 1, nil
		},
		now: time.Now, every: time.Minute, log: slog.New(slog.DiscardHandler),
	}
	err := s.once(t.Context())
	if err == nil || !strings.Contains(err.Error(), a.String()) {
		t.Fatalf("once = %v, want the error of the offers of %s", err, a)
	}
	if !slices.Equal(seen, []uuid.UUID{a, b}) {
		t.Fatalf("offers of %v, want every tenant", seen)
	}
}

// WORKER_POOL_INTERVAL: 30 s by default, 0 — off, anything else but a Go duration ≥ 0 — an error at start.
func TestPoolInterval(t *testing.T) {
	t.Parallel()
	for raw, want := range map[string]time.Duration{"": 30 * time.Second, "10s": 10 * time.Second, "0": 0} {
		got, err := poolInterval(func(k string) string {
			if k == "WORKER_POOL_INTERVAL" {
				return raw
			}
			return ""
		})
		if err != nil || got != want {
			t.Errorf("WORKER_POOL_INTERVAL=%q: %v %v, want %v", raw, got, err, want)
		}
	}
	for _, raw := range []string{"often", "-1s"} {
		if _, err := poolInterval(func(string) string { return raw }); err == nil {
			t.Errorf("WORKER_POOL_INTERVAL=%q: no error", raw)
		}
	}
}
