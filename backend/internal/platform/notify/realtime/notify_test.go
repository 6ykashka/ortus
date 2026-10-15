package realtime

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
	"github.com/jackc/pgx/v5/pgconn"
)

// Тест R-5 брифа W1.07: подсказки через pg_notify — пачки < 8000 байт, строгий разбор, переподключение слушателя
// с ресинхронизацией.

func accounts(n int) []uuid.UUID {
	out := make([]uuid.UUID, n)
	for i := range out {
		out[i] = uuid.New()
	}
	return out
}

func TestEncodeHintSplitsLargeAudience(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	h := Hint{Type: TypeContextChanged, TenantID: tenant, Accounts: accounts(1000), Sessions: []string{SessionKey("a"), SessionKey("b")}}
	payloads, err := EncodeHint(h)
	if err != nil {
		t.Fatal(err)
	}
	if len(payloads) < 2 {
		t.Fatalf("1000 accounts fit one payload of %d bytes?", len(payloads[0]))
	}
	var gotAcc []uuid.UUID
	var gotSess []string
	for _, p := range payloads {
		if len(p) > MaxPayload {
			t.Fatalf("payload of %d bytes > %d", len(p), MaxPayload)
		}
		d, err := DecodeHint(p)
		if err != nil {
			t.Fatalf("DecodeHint: %v", err)
		}
		if d.Type != h.Type || d.TenantID != tenant {
			t.Fatalf("part %+v lost the type or the tenant", d)
		}
		gotAcc = append(gotAcc, d.Accounts...)
		gotSess = append(gotSess, d.Sessions...)
	}
	if !sameSet(gotAcc, h.Accounts) || !sameSet(gotSess, h.Sessions) {
		t.Fatalf("parts carry %d accounts and %v, want %d and %v", len(gotAcc), gotSess, len(h.Accounts), h.Sessions)
	}

	small, err := EncodeHint(Hint{Type: TypeNotificationsChanged, Accounts: accounts(1)})
	if err != nil || len(small) != 1 {
		t.Fatalf("one account: %d payloads, %v", len(small), err)
	}
	if _, err := EncodeHint(Hint{Type: TypePing, Accounts: accounts(1)}); !errors.Is(err, ErrInvalidHint) {
		t.Fatalf("ping: %v, want ErrInvalidHint", err)
	}
}

func sameSet[T comparable](a, b []T) bool {
	if len(a) != len(b) {
		return false
	}
	seen := map[T]int{}
	for _, v := range a {
		seen[v]++
	}
	for _, v := range b {
		if seen[v] == 0 {
			return false
		}
		seen[v]--
	}
	return true
}

func TestDecodeHintRejects(t *testing.T) {
	t.Parallel()
	acc := uuid.NewString()
	for _, p := range []string{
		``, `not json`, `[]`,
		`{"type":"context.changed","accounts":["` + acc + `"],"title":"Рейс"}`, // no data travels: unknown fields are refused
		`{"type":"ping","accounts":["` + acc + `"]}`,
		`{"type":"context.changed"}`,
		`{"type":"context.changed","accounts":["x"]}`,
		`{"type":"context.changed","accounts":["` + acc + `"]} {}`,
	} {
		if _, err := DecodeHint(p); err == nil {
			t.Errorf("DecodeHint(%q) accepted", p)
		}
	}
	h, err := DecodeHint(`{"type":"session.ended","reason":"revoked","accounts":["` + acc + `"]}`)
	if err != nil || h.Reason != ReasonRevoked || h.Accounts[0].String() != acc {
		t.Fatalf("DecodeHint = %+v, %v", h, err)
	}
}

// execRecorder is a fake Execer.
type execRecorder struct {
	mu    sync.Mutex
	calls [][]any
	err   error
}

func (e *execRecorder) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls = append(e.calls, append([]any{sql}, args...))
	return pgconn.CommandTag{}, e.err
}

func TestNotifierPublish(t *testing.T) {
	t.Parallel()
	rec := &execRecorder{}
	n := Notifier{DB: rec}
	h := Hint{Type: TypeContextChanged, TenantID: uuid.New(), Accounts: accounts(400)}
	if err := n.Publish(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	want, _ := EncodeHint(h)
	if len(rec.calls) != len(want) {
		t.Fatalf("%d pg_notify calls, want %d", len(rec.calls), len(want))
	}
	for i, c := range rec.calls {
		if sql, _ := c[0].(string); !strings.Contains(sql, "pg_notify") || c[1] != Channel || c[2] != want[i] {
			t.Fatalf("call %d = %v", i, c[:2])
		}
	}
	if err := n.Publish(t.Context(), Hint{Type: TypeContextChanged}); !errors.Is(err, ErrInvalidHint) {
		t.Fatalf("invalid hint: %v", err)
	}
	rec.err = errors.New("control DB down")
	if err := n.Publish(t.Context(), Hint{Type: TypeContextChanged, Accounts: accounts(1)}); err == nil {
		t.Fatal("a failed pg_notify must fail Publish (the outbox retries)")
	}
}

// fakeListen is a ListenConn fed by a channel; a nil notification fails WaitForNotification (lost connection).
type fakeListen struct {
	ch     chan *pgconn.Notification
	execs  []string
	closed bool
	mu     sync.Mutex
}

func (f *fakeListen) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	f.mu.Lock()
	f.execs = append(f.execs, sql)
	f.mu.Unlock()
	return pgconn.CommandTag{}, nil
}

func (f *fakeListen) WaitForNotification(ctx context.Context) (*pgconn.Notification, error) {
	select {
	case n := <-f.ch:
		if n == nil {
			return nil, errors.New("conn lost")
		}
		return n, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (f *fakeListen) Close(context.Context) error {
	f.mu.Lock()
	f.closed = true
	f.mu.Unlock()
	return nil
}

// eventually waits up to 5 s for cond.
func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !cond(); time.Sleep(time.Millisecond) {
		if time.Now().After(deadline) {
			t.Fatalf("timeout: %s", what)
		}
	}
}

// listenScript plays the control DB for a Listener: connection 1, a failed dial, connection 2.
type listenScript struct {
	mu       sync.Mutex
	conns    []*fakeListen
	dials    int
	got      []Hint
	resyncs  int
	listened chan struct{}
}

func (s *listenScript) dial(context.Context) (ListenConn, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dials++
	switch s.dials {
	case 1:
		return s.conns[0], nil
	case 2:
		return nil, errors.New("control DB restarting")
	default:
		return s.conns[1], nil
	}
}

func (s *listenScript) hints() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.got)
}

func TestListenerDeliversAndResyncs(t *testing.T) {
	t.Parallel()
	s := &listenScript{
		conns:    []*fakeListen{{ch: make(chan *pgconn.Notification, 4)}, {ch: make(chan *pgconn.Notification, 4)}},
		listened: make(chan struct{}, 4),
	}
	l := &Listener{
		Dial:      s.dial,
		Sink:      func(h Hint) { s.mu.Lock(); s.got = append(s.got, h); s.mu.Unlock() },
		Resync:    func() { s.mu.Lock(); s.resyncs++; s.mu.Unlock() },
		Listening: func() { s.listened <- struct{}{} },
		Backoff:   func(int) time.Duration { return time.Millisecond },
		Log:       slog.New(slog.DiscardHandler),
	}
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan error, 1)
	go func() { done <- l.Run(ctx) }()

	<-s.listened
	acc := uuid.New()
	payloads, _ := EncodeHint(Hint{Type: TypeContextChanged, Accounts: []uuid.UUID{acc}})
	s.conns[0].ch <- &pgconn.Notification{Channel: Channel, Payload: "garbage"}
	s.conns[0].ch <- &pgconn.Notification{Channel: Channel, Payload: payloads[0]}
	s.conns[0].ch <- nil // the connection is lost
	<-s.listened         // a failed dial, then the second connection
	s.conns[1].ch <- &pgconn.Notification{Channel: Channel, Payload: payloads[0]}
	eventually(t, "two hints delivered", func() bool { return s.hints() == 2 })
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("Run = %v, want nil after cancel", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.resyncs != 1 || s.dials != 3 || s.got[0].Accounts[0] != acc {
		t.Fatalf("resyncs %d (want 1: after the reconnection only), dials %d, hints %+v", s.resyncs, s.dials, s.got)
	}
	for i, c := range s.conns {
		if !slices.Contains(c.execs, "listen "+Channel) || !c.closed {
			t.Fatalf("connection %d: execs %v, closed %v", i, c.execs, c.closed)
		}
	}
}
