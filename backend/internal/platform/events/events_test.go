package events

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Тест E-1 брифа W1.01: тип события, реестр обработчиков, пауза повторов.

func TestPublishValidation(t *testing.T) {
	t.Parallel()
	for _, e := range []Event{
		{Type: "", Aggregate: "trip", AggregateID: uuid.New()},
		{Type: "fleet.trip.submitted", Aggregate: "trip", AggregateID: uuid.New()},
		{Type: "trip.v1", Aggregate: "trip", AggregateID: uuid.New()},
		{Type: "Fleet.Trip.Submitted.v1", Aggregate: "trip", AggregateID: uuid.New()},
		{Type: "fleet.trip.submitted.v0", Aggregate: "trip", AggregateID: uuid.New()},
		{Type: "fleet.trip.submitted.v1", Aggregate: "", AggregateID: uuid.New()},
		{Type: "fleet.trip.submitted.v1", Aggregate: "trip", AggregateID: uuid.Nil},
		{Type: "fleet.trip.submitted.v1", Aggregate: "trip", AggregateID: uuid.New(), Payload: func() {}},
		{Type: "fleet.trip.submitted.v1", Aggregate: "trip", AggregateID: uuid.New(), Payload: []int{1}},
	} {
		// A nil DB panics if Publish reaches it: an invalid event must be refused before the insert.
		if _, err := Publish(t.Context(), nil, e); !errors.Is(err, ErrInvalid) {
			t.Errorf("Publish(%+v) = %v, want ErrInvalid", e, err)
		}
	}
}

func TestRegistryDispatch(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	var calls []string
	r.Handle("a.b.c.v1", func(context.Context, Message) error { calls = append(calls, "first"); return nil })
	r.Handle("a.b.c.v1", func(context.Context, Message) error { calls = append(calls, "second"); return nil })
	r.Handle("x.y.z.v1", func(context.Context, Message) error { calls = append(calls, "other"); return nil })
	if err := r.Dispatch(t.Context(), Message{Type: "a.b.c.v1"}); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 2 || calls[0] != "first" || calls[1] != "second" {
		t.Fatalf("calls = %v, want first, second", calls)
	}
	if err := r.Dispatch(t.Context(), Message{Type: "no.handlers.here.v1"}); err != nil {
		t.Fatalf("type without handlers: %v", err)
	}

	boom := errors.New("boom")
	f := NewRegistry()
	ran := false
	f.Handle("a.b.c.v1", func(context.Context, Message) error { return boom })
	f.Handle("a.b.c.v1", func(context.Context, Message) error { ran = true; return nil })
	if err := f.Dispatch(t.Context(), Message{Type: "a.b.c.v1"}); !errors.Is(err, boom) {
		t.Fatalf("Dispatch = %v, want the first error", err)
	}
	if ran {
		t.Fatal("handlers after a failed one must not run")
	}

	p := NewRegistry()
	p.Handle("a.b.c.v1", func(context.Context, Message) error { panic("handler bug") })
	if err := p.Dispatch(t.Context(), Message{Type: "a.b.c.v1"}); err == nil {
		t.Fatal("a panicking handler must give an error")
	}
}

func TestDefaultBackoff(t *testing.T) {
	t.Parallel()
	for attempt, want := range map[int]time.Duration{
		1: time.Second, 2: 2 * time.Second, 3: 4 * time.Second, 10: 512 * time.Second,
		13: time.Hour, 40: time.Hour, 1000: time.Hour,
	} {
		if got := DefaultBackoff(attempt); got != want {
			t.Errorf("DefaultBackoff(%d) = %v, want %v", attempt, got, want)
		}
	}
}

func TestOutboxDefaults(t *testing.T) {
	t.Parallel()
	o := &Outbox{}
	if o.lease() != DefaultLease || o.maxAttempts() != DefaultMaxAttempts || o.backoff(3) != DefaultBackoff(3) {
		t.Fatalf("defaults: lease %v, attempts %d, backoff %v", o.lease(), o.maxAttempts(), o.backoff(3))
	}
	if now := o.now(); time.Since(now) > time.Minute {
		t.Fatalf("now() = %v, want the wall clock", now)
	}
	custom := &Outbox{Lease: time.Minute, MaxAttempts: 2, Backoff: func(int) time.Duration { return time.Hour }}
	if custom.lease() != time.Minute || custom.maxAttempts() != 2 || custom.backoff(1) != time.Hour {
		t.Fatal("explicit settings ignored")
	}
	if (&Worker{}).batch() != DefaultBatch || (&Worker{Batch: 7}).batch() != 7 {
		t.Fatal("worker batch default")
	}
}
