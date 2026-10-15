package tenantctx

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// Defaults of Pools.
const (
	DefaultMaxConns    = 4               // pool size per tenant (TENANT_DB_POOL_MAX)
	DefaultOpenTimeout = 5 * time.Second // connect and sentinel check of one tenant DB
	DefaultRetryAfter  = 5 * time.Second // a failed open is answered from memory for this long
)

// Pools opens tenant DB pools lazily. A pool is cached only after its sentinel matched tenant_routing: a database
// that answers for another tenant is never used (02-architecture §3, 09 I-22).
//
// Opening is per tenant: the shared lock only guards the maps, so a hung tenant DB never delays the others.
// Concurrent requests for one tenant share one open (bounded by OpenTimeout and detached from the first request's
// cancellation); each waits no longer than its own context. A failed open is remembered for RetryAfter.
type Pools struct {
	dir         Directory
	env         func(string) string
	host        string // TENANT_DB_HOST: overrides the host of the secret DSN
	MaxConns    int32
	OpenTimeout time.Duration
	RetryAfter  time.Duration    // 0: retry on every request
	Now         func() time.Time // nil: time.Now

	mu      sync.Mutex
	pools   map[uuid.UUID]*pgxpool.Pool
	opening map[uuid.UUID]*opening
	failed  map[uuid.UUID]failure
	closed  bool
}

// opening is an open in flight; done is closed when pool or err is set.
type opening struct {
	done chan struct{}
	pool *pgxpool.Pool
	err  error
}

type failure struct {
	err   error
	until time.Time
}

// NewPools returns tenant DB pools resolved through dir; env reads the secrets named by tenant_routing.secret_ref.
func NewPools(dir Directory, env func(string) string, host string) *Pools {
	return &Pools{
		dir: dir, env: env, host: host,
		MaxConns: DefaultMaxConns, OpenTimeout: DefaultOpenTimeout, RetryAfter: DefaultRetryAfter,
		pools: map[uuid.UUID]*pgxpool.Pool{}, opening: map[uuid.UUID]*opening{}, failed: map[uuid.UUID]failure{},
	}
}

func (p *Pools) now() time.Time {
	if p.Now != nil {
		return p.Now()
	}
	return time.Now()
}

// For returns the pool of tenantID. Errors are dependency_unavailable and never carry the DSN.
func (p *Pools) For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error) {
	p.mu.Lock()
	if pool, ok := p.pools[tenantID]; ok {
		p.mu.Unlock()
		return pool, nil
	}
	if f, ok := p.failed[tenantID]; ok && p.now().Before(f.until) {
		p.mu.Unlock()
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, f.err)
	}
	o, inFlight := p.opening[tenantID]
	if !inFlight {
		o = &opening{done: make(chan struct{})}
		p.opening[tenantID] = o
		go p.run(context.WithoutCancel(ctx), tenantID, o)
	}
	p.mu.Unlock()

	select {
	case <-o.done:
		if o.err != nil {
			return nil, problem.Wrap(problem.CodeDependencyUnavailable, o.err)
		}
		return o.pool, nil
	case <-ctx.Done():
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("tenant %s: wait for pool: %w", tenantID, ctx.Err()))
	}
}

// run opens the pool of tenantID once for all waiters and records the outcome.
func (p *Pools) run(ctx context.Context, tenantID uuid.UUID, o *opening) {
	if p.OpenTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, p.OpenTimeout)
		defer cancel()
	}
	pool, err := p.open(ctx, tenantID)
	p.mu.Lock()
	delete(p.opening, tenantID)
	switch {
	case err != nil:
		if p.RetryAfter > 0 {
			p.failed[tenantID] = failure{err: err, until: p.now().Add(p.RetryAfter)}
		}
	case p.closed: // Close ran while opening
		pool.Close()
		err = fmt.Errorf("tenant %s: pools closed", tenantID)
		pool = nil
	default:
		delete(p.failed, tenantID)
		p.pools[tenantID] = pool
	}
	o.pool, o.err = pool, err
	p.mu.Unlock()
	close(o.done)
}

func (p *Pools) open(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error) {
	rt, err := p.dir.Routing(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("tenant %s: routing: %w", tenantID, err)
	}
	name, ok := strings.CutPrefix(rt.SecretRef, "env:")
	if !ok || name == "" {
		return nil, fmt.Errorf("tenant %s: unsupported secret_ref scheme", tenantID)
	}
	secret := p.env(name)
	if secret == "" {
		return nil, fmt.Errorf("tenant %s: secret %s is empty", tenantID, name)
	}
	dsn, err := migrations.TenantDSN(secret, p.host, rt.DatabaseName)
	if err != nil {
		return nil, fmt.Errorf("tenant %s: secret %s is not a URL", tenantID, name) // the parse error quotes the DSN
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("tenant %s: secret %s is not a valid DSN", tenantID, name)
	}
	cfg.MaxConns = p.MaxConns
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("tenant %s: open pool: %w", tenantID, err)
	}
	if err := checkSentinel(ctx, pool, rt); err != nil {
		pool.Close()
		return nil, fmt.Errorf("tenant %s: %w", tenantID, err)
	}
	return pool, nil
}

// errSentinel marks a tenant DB whose identity does not match tenant_routing.
var errSentinel = errors.New("sentinel mismatch: the database belongs to another tenant")

func checkSentinel(ctx context.Context, pool *pgxpool.Pool, rt Routing) error {
	var tenant, sentinel uuid.UUID
	err := pool.QueryRow(ctx, `select tenant_id, sentinel from core.tenant_identity`).Scan(&tenant, &sentinel)
	if err != nil {
		return fmt.Errorf("read core.tenant_identity: %w", err)
	}
	if tenant != rt.TenantID || sentinel != rt.Sentinel {
		return errSentinel
	}
	return nil
}

// Opened returns the tenants with an open pool, sorted.
func (p *Pools) Opened() []uuid.UUID {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]uuid.UUID, 0, len(p.pools))
	for id := range p.pools {
		out = append(out, id)
	}
	slices.SortFunc(out, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	return out
}

// Close closes every pool.
func (p *Pools) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	for id, pool := range p.pools {
		pool.Close()
		delete(p.pools, id)
	}
}
