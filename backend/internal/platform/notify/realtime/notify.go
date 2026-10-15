package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MaxPayload bounds one pg_notify payload (PostgreSQL: < 8000 bytes).
const MaxPayload = 7900

// Pauses of Listener between connection attempts.
const (
	minListenBackoff = 100 * time.Millisecond
	maxListenBackoff = 5 * time.Second
)

// Execer runs a statement (a pgx pool, connection or transaction).
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Notifier publishes hints to every gateway: pg_notify on Channel of the control DB, split into payloads of at most
// MaxPayload bytes. Inside a transaction the notifications leave on commit.
type Notifier struct{ DB Execer }

// Publish validates h and notifies it.
func (n Notifier) Publish(ctx context.Context, h Hint) error {
	payloads, err := EncodeHint(h)
	if err != nil {
		return err
	}
	for _, p := range payloads {
		if _, err := n.DB.Exec(ctx, `select pg_notify($1, $2)`, Channel, p); err != nil {
			return fmt.Errorf("realtime: pg_notify: %w", err)
		}
	}
	return nil
}

// EncodeHint splits h into pg_notify payloads of at most MaxPayload bytes each: the addressees are halved until
// every part fits, each part keeps the type, tenant and reason.
func EncodeHint(h Hint) ([]string, error) {
	if err := h.Validate(); err != nil {
		return nil, err
	}
	b, err := json.Marshal(h)
	if err != nil {
		return nil, fmt.Errorf("realtime: hint: %w", err)
	}
	if len(b) <= MaxPayload {
		return []string{string(b)}, nil
	}
	la := len(h.Accounts)
	total := la + len(h.Sessions)
	if total < 2 {
		return nil, fmt.Errorf("%w: %d bytes for one addressee", ErrInvalidHint, len(b))
	}
	mid := total / 2
	first, second := h, h
	first.Accounts, second.Accounts = h.Accounts[:min(mid, la)], h.Accounts[min(mid, la):]
	first.Sessions, second.Sessions = h.Sessions[:max(0, mid-la)], h.Sessions[max(0, mid-la):]
	a, err := EncodeHint(first)
	if err != nil {
		return nil, err
	}
	z, err := EncodeHint(second)
	if err != nil {
		return nil, err
	}
	return append(a, z...), nil
}

// DecodeHint parses and validates a payload of Channel: one JSON object with the fields of Hint and nothing else.
func DecodeHint(payload string) (Hint, error) {
	dec := json.NewDecoder(strings.NewReader(payload))
	dec.DisallowUnknownFields()
	var h Hint
	if err := dec.Decode(&h); err != nil {
		return Hint{}, fmt.Errorf("%w: %w", ErrInvalidHint, err)
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return Hint{}, fmt.Errorf("%w: trailing data", ErrInvalidHint)
	}
	if err := h.Validate(); err != nil {
		return Hint{}, err
	}
	return h, nil
}

// ListenConn is a dedicated connection to the control DB.
type ListenConn interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	WaitForNotification(ctx context.Context) (*pgconn.Notification, error)
	Close(ctx context.Context) error
}

// Listener receives the hints of Channel in cmd/api (LISTEN on a dedicated connection) and reconnects with a pause.
// After a reconnection it calls Resync: notifications sent meanwhile are lost.
type Listener struct {
	Dial      func(ctx context.Context) (ListenConn, error)
	Sink      func(Hint)
	Resync    func()                          // nil: nothing
	Listening func()                          // called after every successful LISTEN; nil: nothing
	Backoff   func(attempt int) time.Duration // nil: 100 ms, doubling up to 5 s
	Log       *slog.Logger                    // nil: slog.Default()
}

func (l *Listener) log() *slog.Logger {
	if l.Log != nil {
		return l.Log
	}
	return slog.Default()
}

func (l *Listener) backoff(attempt int) time.Duration {
	if l.Backoff != nil {
		return l.Backoff(attempt)
	}
	d := minListenBackoff << min(attempt-1, 6)
	return min(d, maxListenBackoff)
}

// Run listens until ctx is done; it returns nil on cancellation.
func (l *Listener) Run(ctx context.Context) error {
	reconnect := false
	attempt := 0
	for ctx.Err() == nil {
		conn, err := l.listen(ctx)
		if err != nil {
			attempt++
			l.pause(ctx, attempt, err)
			continue
		}
		attempt = 0
		l.serve(ctx, conn, reconnect)
		reconnect = true
	}
	return nil
}

// pause logs a failed attempt and waits before the next one.
func (l *Listener) pause(ctx context.Context, attempt int, err error) {
	if ctx.Err() != nil {
		return
	}
	l.log().WarnContext(ctx, "realtime: listen", slog.Int("attempt", attempt), slog.String("error", err.Error()))
	select {
	case <-ctx.Done():
	case <-time.After(l.backoff(attempt)):
	}
}

// serve delivers the hints of a listening connection until it fails; after a reconnection it resyncs first.
func (l *Listener) serve(ctx context.Context, conn ListenConn, reconnect bool) {
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()
	if reconnect && l.Resync != nil {
		l.Resync()
	}
	if l.Listening != nil {
		l.Listening()
	}
	if err := l.receive(ctx, conn); ctx.Err() == nil {
		l.log().WarnContext(ctx, "realtime: listen connection lost", slog.String("error", err.Error()))
	}
}

// listen dials and subscribes to Channel.
func (l *Listener) listen(ctx context.Context) (ListenConn, error) {
	conn, err := l.Dial(ctx)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, "listen "+Channel); err != nil {
		_ = conn.Close(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("realtime: listen: %w", err)
	}
	return conn, nil
}

// receive hands the hints of conn to Sink until the connection fails.
func (l *Listener) receive(ctx context.Context, conn ListenConn) error {
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if n.Channel != Channel {
			continue
		}
		h, err := DecodeHint(n.Payload)
		if err != nil {
			l.log().WarnContext(ctx, "realtime: bad hint", slog.String("error", err.Error()))
			continue
		}
		l.Sink(h)
	}
}

// poolConn is a pool connection held for LISTEN.
type poolConn struct{ c *pgxpool.Conn }

func (p poolConn) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return p.c.Exec(ctx, sql, args...)
}

func (p poolConn) WaitForNotification(ctx context.Context) (*pgconn.Notification, error) {
	return p.c.Conn().WaitForNotification(ctx)
}

// Close closes the connection, so the pool destroys it instead of handing out a connection that still listens.
func (p poolConn) Close(ctx context.Context) error {
	err := p.c.Conn().Close(ctx)
	p.c.Release()
	return err
}

// PoolDialer dials by acquiring a connection of pool; closing it closes the connection (its LISTEN dies with it).
// The listener holds one connection of the pool for its whole life.
func PoolDialer(pool *pgxpool.Pool) func(ctx context.Context) (ListenConn, error) {
	return func(ctx context.Context) (ListenConn, error) {
		c, err := pool.Acquire(ctx)
		if err != nil {
			return nil, fmt.Errorf("realtime: acquire: %w", err)
		}
		return poolConn{c: c}, nil
	}
}

// Fanout is the Sink and Resync of a Listener in cmd/api: context.changed invalidates the permission cache of its
// tenant (all tenants without one; cache may be nil), every hint goes to the hub.
func Fanout(hub *Hub, cache *PolicyCache) (sink func(Hint), resync func()) {
	sink = func(h Hint) {
		if cache != nil && h.Type == TypeContextChanged {
			if h.TenantID != uuid.Nil {
				cache.Invalidate(h.TenantID)
			} else {
				cache.InvalidateAll()
			}
		}
		if hub != nil {
			hub.Deliver(h)
		}
	}
	resync = func() {
		if cache != nil {
			cache.InvalidateAll()
		}
		if hub != nil {
			hub.Resync()
		}
	}
	return sink, resync
}
