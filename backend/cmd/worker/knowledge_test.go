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

	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
)

// W4.31 (возврат 1): проверка сроков пересмотра «Базы знаний» по расписанию проходит все организации; сбой одной не
// останавливает остальные и возвращается ошибкой с её id.
func TestKBReviewOnce(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	var (
		mu   sync.Mutex
		seen []uuid.UUID
	)
	k := kbReview{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{a, b, c}, nil },
		check: func(_ context.Context, tenant uuid.UUID) ([]knowledge.ReviewRun, error) {
			mu.Lock()
			defer mu.Unlock()
			seen = append(seen, tenant)
			if tenant == b {
				return nil, errors.New("tenant DB unreachable")
			}
			return []knowledge.ReviewRun{{Space: uuid.New(), Rule: uuid.New(), Due: 1, Result: "ok"}}, nil
		},
		every: time.Minute, log: slog.New(slog.DiscardHandler),
	}
	err := k.once(t.Context())
	if err == nil || !strings.Contains(err.Error(), b.String()) {
		t.Fatalf("once = %v, want the error of %s", err, b)
	}
	if !slices.Equal(seen, []uuid.UUID{a, b, c}) {
		t.Fatalf("checked %v, want every tenant", seen)
	}
	k.tenants = func(context.Context) ([]uuid.UUID, error) { return nil, errors.New("control DB down") }
	if err := k.once(t.Context()); err == nil {
		t.Fatal("no tenants: no error")
	}
}

// The job checks at start and then every interval until its context ends.
func TestKBReviewRun(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	calls := make(chan struct{}, 8)
	k := kbReview{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{uuid.New()}, nil },
		check: func(context.Context, uuid.UUID) ([]knowledge.ReviewRun, error) {
			calls <- struct{}{}
			return nil, nil
		},
		every: 10 * time.Millisecond, log: slog.New(slog.DiscardHandler),
	}
	done := make(chan struct{})
	go func() { k.run(ctx); close(done) }()
	for range 2 {
		select {
		case <-calls:
		case <-time.After(5 * time.Second):
			t.Fatal("the job does not check")
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the job does not stop with its context")
	}
}

// WORKER_KB_REVIEW_INTERVAL: 1 min by default, 0 — off (the job returns at once), anything else but a Go duration ≥ 0
// — an error at start.
func TestKBReviewInterval(t *testing.T) {
	t.Parallel()
	env := func(raw string) func(string) string {
		return func(k string) string {
			if k == "WORKER_KB_REVIEW_INTERVAL" {
				return raw
			}
			return ""
		}
	}
	for raw, want := range map[string]time.Duration{"": time.Minute, "10s": 10 * time.Second, "0": 0} {
		got, err := kbReviewInterval(env(raw))
		if err != nil || got != want {
			t.Errorf("WORKER_KB_REVIEW_INTERVAL=%q: %v %v, want %v", raw, got, err, want)
		}
	}
	for _, raw := range []string{"often", "-1s"} {
		if _, err := kbReviewInterval(env(raw)); err == nil {
			t.Errorf("WORKER_KB_REVIEW_INTERVAL=%q: no error", raw)
		}
		if _, err := kbReviewJob(env(raw), nil, nil, slog.New(slog.DiscardHandler)); err == nil {
			t.Errorf("job with WORKER_KB_REVIEW_INTERVAL=%q: no error", raw)
		}
	}
	job, err := kbReviewJob(env("0"), nil, nil, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}
	job(t.Context()) // off: returns at once
}

// The service of the worker reads the memberships and the recipients of the control DB at the clock of the
// application.
func TestNewKnowledge(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)
	s := newKnowledge(nil, nil, nil, func() time.Time { return at })
	if s.Now == nil || !s.Now().Equal(at) {
		t.Fatal("not the clock of the application")
	}
	if _, ok := s.Memberships.(knowledge.PGMemberships); !ok {
		t.Fatalf("memberships %T, want knowledge.PGMemberships", s.Memberships)
	}
	if s.Recipients == nil {
		t.Fatal("no recipients: the owners of pages would not be notified")
	}
}
