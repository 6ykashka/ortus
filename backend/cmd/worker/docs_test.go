package main

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
)

func quietLog() *slog.Logger { return slog.New(slog.DiscardHandler) }

func envOf(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

// WORKER_DOCS_INTERVAL: a duration, 5 s by default, 0 turns the jobs of documents off.
func TestDocsInterval(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		in   string
		want time.Duration
		bad  bool
	}{{"", defaultDocsInterval, false}, {"30s", 30 * time.Second, false}, {"0", 0, false}, {"-1s", 0, true}, {"often", 0, true}} {
		got, err := docsInterval(envOf(map[string]string{"WORKER_DOCS_INTERVAL": c.in}))
		if (err != nil) != c.bad || got != c.want {
			t.Errorf("%q: %v %v, want %v (error %v)", c.in, got, err, c.want, c.bad)
		}
	}
}

// A tenant that fails does not stop the others; its error names it.
func TestDocsRunnerOnce(t *testing.T) {
	t.Parallel()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	var seen []uuid.UUID
	d := docsRunner{
		tenants: func(context.Context) ([]uuid.UUID, error) { return []uuid.UUID{a, b, c}, nil },
		process: func(_ context.Context, id uuid.UUID, limit int) (int, error) {
			seen = append(seen, id)
			if limit != docsBatch {
				t.Errorf("limit %d, want %d", limit, docsBatch)
			}
			if id == b {
				return 0, errors.New("boom")
			}
			return 2, nil
		},
		every: time.Minute, log: quietLog(),
	}
	err := d.once(t.Context())
	if err == nil || len(seen) != 3 {
		t.Fatalf("once: %v, tenants %v, want all three looked at and the error of one", err, seen)
	}
	d.tenants = func(context.Context) ([]uuid.UUID, error) { return nil, errors.New("no tenants") }
	if err := d.once(t.Context()); err == nil {
		t.Fatal("the list of tenants failed and once did not")
	}
}

func TestDocsJobOff(t *testing.T) {
	t.Parallel()
	run, err := docsJob(envOf(map[string]string{"WORKER_DOCS_INTERVAL": "0"}), nil, nil, quietLog())
	if err != nil {
		t.Fatal(err)
	}
	run(t.Context()) // returns at once
	if _, err := docsJob(envOf(map[string]string{"WORKER_DOCS_INTERVAL": "x"}), nil, nil, quietLog()); err == nil {
		t.Fatal("a malformed interval was accepted")
	}
}
