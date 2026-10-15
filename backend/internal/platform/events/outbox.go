package events

import (
	"cmp"
	"context"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Defaults of Outbox and Worker.
const (
	DefaultLease       = 30 * time.Second
	DefaultMaxAttempts = 10
	DefaultBatch       = 100
	DefaultInterval    = time.Second
)

// Outbox is the worker side of outbox.events in one tenant DB (role ortus_worker).
type Outbox struct {
	DB          DB
	Now         func() time.Time                // nil: time.Now
	Lease       time.Duration                   // 0: DefaultLease
	MaxAttempts int                             // 0: DefaultMaxAttempts
	Backoff     func(attempt int) time.Duration // nil: DefaultBackoff
}

// DeadLetter is an event that exhausted its attempts.
type DeadLetter struct {
	Message
	LastError string
}

func (o *Outbox) now() time.Time {
	if o.Now != nil {
		return o.Now()
	}
	return time.Now()
}

func (o *Outbox) lease() time.Duration {
	if o.Lease > 0 {
		return o.Lease
	}
	return DefaultLease
}

func (o *Outbox) maxAttempts() int {
	if o.MaxAttempts > 0 {
		return o.MaxAttempts
	}
	return DefaultMaxAttempts
}

func (o *Outbox) backoff(attempt int) time.Duration {
	if o.Backoff != nil {
		return o.Backoff(attempt)
	}
	return DefaultBackoff(attempt)
}

const (
	claimSQL = `
with due as materialized (
  select id from outbox.events
   where published_at is null and available_at <= greatest($1, now()) and (locked_until is null or locked_until <= $1)
   order by id
   limit $3
   for update skip locked
)
update outbox.events e
   set locked_until = $2, attempts = e.attempts + 1
  from due
 where e.id = due.id
returning e.id, e.event_id, e.type, e.aggregate, e.aggregate_id, e.payload, e.occurred_at, e.attempts`
	publishedSQL = `
update outbox.events set published_at = $3, locked_until = null, last_error = null
 where id = $1 and locked_until = $2 and published_at is null`
	failedSQL = `
update outbox.events set available_at = $3, locked_until = null, last_error = $4
 where id = $1 and locked_until = $2 and published_at is null`
	deadSQL = `
update outbox.events set available_at = 'infinity', locked_until = null, last_error = $3
 where id = $1 and locked_until = $2 and published_at is null`
	deadLettersSQL = `
select id, event_id, type, aggregate, aggregate_id, payload, occurred_at, attempts, coalesce(last_error, '')
  from outbox.events
 where published_at is null and available_at = 'infinity'
 order by id
 limit $1`
	retrySQL = `
update outbox.events set available_at = $2, attempts = 0, locked_until = null
 where event_id = $1 and published_at is null and available_at = 'infinity'`
)

// maxErrorLen bounds last_error: the text of a handler error, not a dump.
const maxErrorLen = 1000

// Claim leases up to limit due events (FOR UPDATE SKIP LOCKED) and returns them, ordered by id, with the lease
// token: the locked_until value that Published and Failed must match. An event is due by the worker clock or by the
// clock of the database that stamped it (available_at defaults to now() of the API transaction), whichever is later,
// so a worker clock slightly behind the database does not hold fresh events back.
func (o *Outbox) Claim(ctx context.Context, limit int) ([]Message, time.Time, error) {
	now := o.now()
	lease := now.Add(o.lease()).Truncate(time.Microsecond) // the precision of timestamptz: the token compares equal
	rows, err := o.DB.Query(ctx, claimSQL, now, lease, limit)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("events: claim: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.EventID, &m.Type, &m.Aggregate, &m.AggregateID, &m.Payload, &m.OccurredAt, &m.Attempts); err != nil {
			return nil, time.Time{}, fmt.Errorf("events: claim: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, time.Time{}, fmt.Errorf("events: claim: %w", err)
	}
	slices.SortFunc(out, func(a, b Message) int { return cmp.Compare(a.ID, b.ID) })
	return out, lease, nil
}

func leased(tag pgconn.CommandTag, err error, what string) error {
	if err != nil {
		return fmt.Errorf("events: %s: %w", what, err)
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

// Published marks a leased event delivered.
func (o *Outbox) Published(ctx context.Context, id int64, lease time.Time) error {
	tag, err := o.DB.Exec(ctx, publishedSQL, id, lease, o.now())
	return leased(tag, err, "published")
}

// Failed schedules the next attempt of a leased event after the backoff, or moves it to the dead-letter
// (available_at = 'infinity', brief W1.01 §10 item 3) once it was delivered MaxAttempts times.
func (o *Outbox) Failed(ctx context.Context, m Message, lease time.Time, cause error) (bool, error) {
	msg := "unknown error"
	if cause != nil {
		msg = cause.Error()
	}
	if len(msg) > maxErrorLen {
		msg = msg[:maxErrorLen]
	}
	if m.Attempts >= o.maxAttempts() {
		tag, err := o.DB.Exec(ctx, deadSQL, m.ID, lease, msg)
		return true, leased(tag, err, "dead-letter")
	}
	tag, err := o.DB.Exec(ctx, failedSQL, m.ID, lease, o.now().Add(o.backoff(m.Attempts)), msg)
	return false, leased(tag, err, "failed")
}

// DeadLetters lists the dead-letter, oldest first.
func (o *Outbox) DeadLetters(ctx context.Context, limit int) ([]DeadLetter, error) {
	rows, err := o.DB.Query(ctx, deadLettersSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("events: dead letters: %w", err)
	}
	defer rows.Close()
	var out []DeadLetter
	for rows.Next() {
		var d DeadLetter
		if err := rows.Scan(&d.ID, &d.EventID, &d.Type, &d.Aggregate, &d.AggregateID, &d.Payload, &d.OccurredAt, &d.Attempts, &d.LastError); err != nil {
			return nil, fmt.Errorf("events: dead letters: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("events: dead letters: %w", err)
	}
	return out, nil
}

// Retry returns a dead-letter event to delivery at once with its attempts reset (manual retry). The last error
// stays until the next delivery.
func (o *Outbox) Retry(ctx context.Context, eventID uuid.UUID) error {
	tag, err := o.DB.Exec(ctx, retrySQL, eventID, o.now())
	if err != nil {
		return fmt.Errorf("events: retry: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrNotDead
	}
	return nil
}

// PoolSource opens the sentinel-checked pool of a tenant DB (tenantctx.Pools).
type PoolSource interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Stats counts one pass of the worker.
type Stats struct {
	Tenants   int // tenants processed
	Published int
	Retried   int // failed deliveries scheduled again
	Dead      int // moved to the dead-letter
	Errors    int // tenants or events the worker could not process
}

// Worker delivers the outbox of every tenant.
type Worker struct {
	Tenants     func(ctx context.Context) ([]uuid.UUID, error)
	Pools       PoolSource
	Registry    *Registry
	Batch       int           // 0: DefaultBatch
	Interval    time.Duration // 0: DefaultInterval
	Lease       time.Duration
	MaxAttempts int
	Backoff     func(attempt int) time.Duration
	Now         func() time.Time
	Log         *slog.Logger
}

func (w *Worker) log() *slog.Logger {
	if w.Log != nil {
		return w.Log
	}
	return slog.Default()
}

func (w *Worker) batch() int {
	if w.Batch > 0 {
		return w.Batch
	}
	return DefaultBatch
}

// RunOnce makes one pass over all tenants: each tenant's due events are claimed in batches and dispatched until
// fewer than a batch is due. A tenant whose DB is unavailable is counted in Errors and skipped; only a failure to
// list the tenants is an error.
func (w *Worker) RunOnce(ctx context.Context) (Stats, error) {
	var st Stats
	tenants, err := w.Tenants(ctx)
	if err != nil {
		return st, fmt.Errorf("events: list tenants: %w", err)
	}
	for _, id := range tenants {
		w.tenant(ctx, id, &st) // after cancellation the pool and the claim fail fast
	}
	return st, nil
}

// tenant opens the DB of one tenant and drains its outbox.
func (w *Worker) tenant(ctx context.Context, id uuid.UUID, st *Stats) {
	pool, err := w.Pools.For(ctx, id)
	if err != nil {
		st.Errors++
		w.log().WarnContext(ctx, "worker: tenant DB", slog.String("tenant_id", id.String()), slog.String("error", err.Error()))
		return
	}
	st.Tenants++
	w.drain(ctx, id, &Outbox{DB: pool, Now: w.Now, Lease: w.Lease, MaxAttempts: w.MaxAttempts, Backoff: w.Backoff}, st)
}

// drain delivers the due events of one tenant.
func (w *Worker) drain(ctx context.Context, tenant uuid.UUID, o *Outbox, st *Stats) {
	for ctx.Err() == nil {
		msgs, lease, err := o.Claim(ctx, w.batch())
		if err != nil {
			st.Errors++
			w.log().ErrorContext(ctx, "worker: claim", slog.String("tenant_id", tenant.String()), slog.String("error", err.Error()))
			return
		}
		for _, m := range msgs {
			m.TenantID = tenant
			w.deliver(ctx, o, m, lease, st)
		}
		if len(msgs) < w.batch() {
			return
		}
	}
}

func (w *Worker) deliver(ctx context.Context, o *Outbox, m Message, lease time.Time, st *Stats) {
	attrs := []any{slog.String("tenant_id", m.TenantID.String()), slog.String("event_id", m.EventID.String()), slog.String("type", m.Type)}
	cause := w.Registry.Dispatch(ctx, m)
	if cause == nil {
		if err := o.Published(ctx, m.ID, lease); err != nil {
			st.Errors++
			w.log().ErrorContext(ctx, "worker: mark published", append(attrs, slog.String("error", err.Error()))...)
			return
		}
		st.Published++
		return
	}
	dead, err := o.Failed(ctx, m, lease, cause)
	switch {
	case err != nil:
		st.Errors++
		w.log().ErrorContext(ctx, "worker: mark failed", append(attrs, slog.String("error", err.Error()))...)
	case dead:
		st.Dead++
		w.log().ErrorContext(ctx, "worker: dead-letter", append(attrs, slog.Int("attempts", m.Attempts), slog.String("error", cause.Error()))...)
	default:
		st.Retried++
		w.log().WarnContext(ctx, "worker: retry", append(attrs, slog.Int("attempts", m.Attempts), slog.String("error", cause.Error()))...)
	}
}

// Run passes over all tenants every Interval until ctx is done; it returns nil on cancellation.
func (w *Worker) Run(ctx context.Context) error {
	interval := w.Interval
	if interval <= 0 {
		interval = DefaultInterval
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		st, err := w.RunOnce(ctx)
		if err != nil {
			w.log().ErrorContext(ctx, "worker: pass", slog.String("error", err.Error()))
		} else if st.Published+st.Retried+st.Dead+st.Errors > 0 {
			w.log().InfoContext(ctx, "worker: pass", slog.Int("tenants", st.Tenants), slog.Int("published", st.Published),
				slog.Int("retried", st.Retried), slog.Int("dead", st.Dead), slog.Int("errors", st.Errors))
		}
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
		}
	}
}
