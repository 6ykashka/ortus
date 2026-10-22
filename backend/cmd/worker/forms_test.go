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
)

// W4.21: «Хранить ответы» of the forms — the worker deletes the old responses of every tenant every
// WORKER_FORMS_RETENTION_INTERVAL (1h by default, 0 — off); a failing tenant does not stop the others.
func TestFormsRetentionOnce(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	var (
		mu   sync.Mutex
		seen []uuid.UUID
	)
	r := formsRetention{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{a, b, c}, nil },
		retain: func(_ context.Context, tenant uuid.UUID) (int, error) {
			mu.Lock()
			defer mu.Unlock()
			seen = append(seen, tenant)
			if tenant == b {
				return 0, errors.New("tenant DB unreachable")
			}
			return 2, nil
		},
		every: time.Hour, log: slog.New(slog.DiscardHandler),
	}
	if err := r.once(t.Context()); err == nil || !strings.Contains(err.Error(), b.String()) {
		t.Fatalf("once = %v, want the error of %s", err, b)
	}
	if !slices.Equal(seen, []uuid.UUID{a, b, c}) {
		t.Fatalf("retained %v, want every tenant", seen)
	}
	r.tenants = func(context.Context) ([]uuid.UUID, error) { return nil, errors.New("control DB down") }
	if err := r.once(t.Context()); err == nil {
		t.Fatal("no tenants: no error")
	}
}

// The module of forms of the worker (return 1): the retention deletes the rows and the records of the knowledge base
// and the files of the answers of the deleted responses, so its port is wired.
func TestNewFormsService(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	svc, err := newFormsService(nil, func(string) string { return "" }, func() time.Time { return at }, slog.New(slog.DiscardHandler))
	if err != nil || svc.Purge == nil || svc.Now == nil || !svc.Now().Equal(at) {
		t.Fatalf("service %+v %v, want the purge of the knowledge base and of the files", svc, err)
	}
	if _, err := newFormsService(nil, func(k string) string {
		return map[string]string{"S3_ENDPOINT": "http://127.0.0.1:9"}[k]
	}, time.Now, slog.New(slog.DiscardHandler)); err == nil {
		t.Fatal("an incomplete S3_* configuration starts")
	}
}

func TestFormsRetentionInterval(t *testing.T) {
	t.Parallel()
	for raw, want := range map[string]time.Duration{"": time.Hour, "0": 0, "15m": 15 * time.Minute} {
		got, err := formsRetentionInterval(func(string) string { return raw })
		if err != nil || got != want {
			t.Fatalf("%q: %v %v, want %v", raw, got, err, want)
		}
	}
	if _, err := formsRetentionInterval(func(string) string { return "-1s" }); err == nil {
		t.Fatal("a negative interval")
	}
	job, err := formsRetentionJob(func(string) string { return "0" }, nil, nil, slog.New(slog.DiscardHandler))
	if err != nil || job == nil {
		t.Fatalf("off: %v", err)
	}
	job(t.Context()) // returns at once
}
