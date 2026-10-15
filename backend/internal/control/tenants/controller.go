package tenants

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Audit actions of the controller in platform_audit (control_0001_init.sql:150).
const (
	ActionMigrate  = "tenant.schema.migrate"
	ActionRollback = "tenant.schema.rollback"
)

// Runner applies the tenant migrations to an open database.
type Runner interface {
	Version(ctx context.Context, db *sql.DB) (int64, error)
	UpTo(ctx context.Context, db *sql.DB, v int64) (migrations.Result, error)
	DownTo(ctx context.Context, db *sql.DB, v int64) (migrations.Result, error)
}

// GooseRunner runs the embedded tenant migrations (package migrations: goose, session lock, grants after Up).
type GooseRunner struct{}

// Version implements Runner.
func (GooseRunner) Version(ctx context.Context, db *sql.DB) (int64, error) {
	return migrations.Version(ctx, db, migrations.Tenant)
}

// UpTo implements Runner.
func (GooseRunner) UpTo(ctx context.Context, db *sql.DB, v int64) (migrations.Result, error) {
	return migrations.UpTo(ctx, db, migrations.Tenant, v)
}

// DownTo implements Runner.
func (GooseRunner) DownTo(ctx context.Context, db *sql.DB, v int64) (migrations.Result, error) {
	return migrations.DownTo(ctx, db, migrations.Tenant, v)
}

// Controller migrates tenant databases phase by phase. Control is the control DB as ortus_migrator: it reads
// tenant_routing, records schema_version and writes platform_audit. One tenant is migrated by one controller at a
// time: a session advisory lock in the control DB serialises concurrent runs.
type Controller struct {
	Control *sql.DB
	Connect Connector
	Runner  Runner       // nil: GooseRunner
	Latest  int64        // 0: the latest embedded tenant migration
	Log     *slog.Logger // nil: no log
	// Redact masks secrets in error texts written to platform_audit (defence in depth: errors carry no DSN).
	Redact func(string) string
}

// Report is the outcome of a rollout or a rollback.
type Report struct {
	RunID   string
	Target  int64
	DryRun  bool
	Phases  []Phase
	Done    []Result
	Failed  []Result
	Skipped []Result
}

func (c *Controller) runner() Runner {
	if c.Runner != nil {
		return c.Runner
	}
	return GooseRunner{}
}

func (c *Controller) latest() int64 {
	if c.Latest > 0 {
		return c.Latest
	}
	return migrations.Latest(migrations.Tenant)
}

// NewRunID returns the id of a run (platform_audit.request_id).
func NewRunID(prefix string) string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return prefix + "-" + uuid.NewString()
	}
	return prefix + "-" + hex.EncodeToString(b)
}

// Rollout brings the tenants to p.Target: the canary phase first, then batches. A failed canary stops the rollout
// before any batch (ErrCanaryFailed); a failed batch tenant stops the next batches unless ContinueOnFailure
// (ErrBatchFailed). Tenants ahead of the target fail without changes. DryRun returns the phases only.
func (c *Controller) Rollout(ctx context.Context, p Plan) (Report, error) {
	rep, err := c.plan(ctx, p)
	if err != nil || p.DryRun {
		return rep, err
	}
	for _, f := range rep.Failed {
		if slices.Contains(p.Canary, f.Ref.Slug) {
			return rep, fmt.Errorf("%w: %s: %w", ErrCanaryFailed, f.Ref.Slug, f.Err)
		}
	}
	var batchErr error
	for _, ph := range rep.Phases {
		if !c.runPhase(ctx, &rep, ph) {
			continue
		}
		cause := rep.Failed[len(rep.Failed)-1]
		if ph.Name == PhaseCanary {
			return rep, fmt.Errorf("%w: %s: %w", ErrCanaryFailed, cause.Ref.Slug, cause.Err)
		}
		batchErr = fmt.Errorf("%w: %s: %s: %w", ErrBatchFailed, ph.Name, cause.Ref.Slug, cause.Err)
		if !p.ContinueOnFailure {
			return rep, batchErr
		}
	}
	if batchErr == nil && len(rep.Failed) > 0 {
		return rep, fmt.Errorf("%d tenant(s) failed: %w", len(rep.Failed), rep.Failed[0].Err)
	}
	return rep, batchErr
}

// plan resolves the target (0: latest) and splits the registry into phases.
func (c *Controller) plan(ctx context.Context, p Plan) (Report, error) {
	if p.Target == 0 {
		p.Target = c.latest()
	}
	if p.Target < 1 || p.Target > c.latest() {
		return Report{}, fmt.Errorf("%w: %d (latest %d)", ErrBadTarget, p.Target, c.latest())
	}
	refs, err := List(ctx, c.Control)
	if err != nil {
		return Report{}, err
	}
	phases, skipped, failed, err := PlanPhases(refs, p)
	if err != nil {
		return Report{}, err
	}
	return Report{RunID: NewRunID("migrate"), Target: p.Target, DryRun: p.DryRun, Phases: phases, Skipped: skipped, Failed: failed}, nil
}

// runPhase migrates every tenant of ph (a started phase finishes) and reports whether one of them failed.
func (c *Controller) runPhase(ctx context.Context, rep *Report, ph Phase) (failed bool) {
	for _, ref := range ph.Tenants {
		res := c.Migrate(ctx, ref, rep.Target, rep.RunID)
		c.log(ctx, rep.RunID, ph.Name, res)
		switch {
		case res.Err != nil:
			rep.Failed = append(rep.Failed, res)
			failed = true
		case res.From == res.To:
			rep.Skipped = append(rep.Skipped, res)
		default:
			rep.Done = append(rep.Done, res)
		}
	}
	return failed
}

func (c *Controller) log(ctx context.Context, runID, phase string, res Result) {
	if c.Log == nil {
		return
	}
	attrs := []slog.Attr{
		slog.String("run_id", runID), slog.String("phase", phase), slog.String("tenant_id", res.Ref.TenantID.String()),
		slog.String("database", res.Ref.Database), slog.Int64("from", res.From), slog.Int64("to", res.To),
	}
	if res.Err != nil {
		c.Log.LogAttrs(ctx, slog.LevelError, "tenant migration failed", append(attrs, slog.String("error", res.Err.Error()))...)
		return
	}
	c.Log.LogAttrs(ctx, slog.LevelInfo, "tenant migrated", attrs...)
}

// Migrate brings one tenant to target under the tenant lock and records the outcome: tenant_routing.schema_version
// and a platform_audit row (none when the tenant already was on target).
func (c *Controller) Migrate(ctx context.Context, ref Ref, target int64, runID string) Result {
	res := c.locked(ctx, ref, func(conn *sql.Conn, fresh Ref) Result { return c.up(ctx, conn, fresh, target) })
	if res.Err == nil && res.From == res.To {
		return res
	}
	if err := c.audit(ctx, ActionMigrate, runID, res); err != nil && res.Err == nil {
		res.Err = err
	}
	return res
}

// locked runs fn with the route of ref re-read under a session advisory lock of the tenant in the control DB.
func (c *Controller) locked(ctx context.Context, ref Ref, fn func(*sql.Conn, Ref) Result) Result {
	conn, err := c.Control.Conn(ctx)
	if err != nil {
		return Result{Ref: ref, From: ref.SchemaVersion, To: ref.SchemaVersion, Err: fmt.Errorf("control DB: %w", err)}
	}
	defer conn.Close()
	const key = `hashtextextended('ortus:tenant-schema:' || $1::text, 0)`
	if _, err := conn.ExecContext(ctx, `select pg_advisory_lock(`+key+`)`, ref.TenantID); err != nil {
		return Result{Ref: ref, From: ref.SchemaVersion, To: ref.SchemaVersion, Err: fmt.Errorf("tenant lock: %w", err)}
	}
	defer func() {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), `select pg_advisory_unlock(`+key+`)`, ref.TenantID)
	}()
	fresh, err := Lookup(ctx, conn, ref.TenantID)
	if err != nil {
		return Result{Ref: ref, From: ref.SchemaVersion, To: ref.SchemaVersion, Err: err}
	}
	return fn(conn, fresh)
}

// up migrates the tenant of fresh (its route as read under the lock).
func (c *Controller) up(ctx context.Context, conn *sql.Conn, fresh Ref, target int64) Result {
	res := Result{Ref: fresh, From: fresh.SchemaVersion, To: fresh.SchemaVersion}
	switch {
	case fresh.SchemaVersion == target:
		return res
	case fresh.SchemaVersion > target:
		res.Err = fmt.Errorf("%w: %s on %d, target %d", ErrVersionAhead, fresh.Slug, fresh.SchemaVersion, target)
		return res
	}
	db, err := c.Connect.Open(ctx, fresh)
	if err != nil {
		res.Err = err
		return res
	}
	defer db.Close()
	if res.Err = c.precheck(ctx, db, fresh); res.Err != nil {
		return res
	}
	out, err := c.runner().UpTo(ctx, db, target)
	res.To = out.To
	if err != nil {
		// goose applies migration by migration: record how far it got, so a failure leaves no drift behind.
		if v, verr := c.runner().Version(ctx, db); verr == nil {
			res.To = v
		}
		res.Err = err
		if res.To != res.From {
			if e := c.record(ctx, conn, db, fresh, res.To); e != nil {
				res.Err = errors.Join(err, e)
			}
		}
		return res
	}
	if err := c.record(ctx, conn, db, fresh, res.To); err != nil {
		res.Err = err
	}
	return res
}

// precheck refuses a database whose version differs from tenant_routing (drift) or whose identity belongs to
// another tenant; a migrated database without an identity row gets it from the route. An empty database (version 0)
// has no identity yet: it must be owned by ortus_migrator (as every Ortus database), or it was not made for Ortus.
func (c *Controller) precheck(ctx context.Context, db *sql.DB, fresh Ref) error {
	actual, err := c.runner().Version(ctx, db)
	if err != nil {
		return err
	}
	if actual != fresh.SchemaVersion {
		return fmt.Errorf("%w: %s routing %d, database %d", ErrSchemaDrift, fresh.Slug, fresh.SchemaVersion, actual)
	}
	if actual >= 1 {
		return ensureIdentity(ctx, db, fresh)
	}
	var owner string
	if err := db.QueryRowContext(ctx, `select pg_get_userbyid(datdba) from pg_database where datname = current_database()`).
		Scan(&owner); err != nil {
		return fmt.Errorf("owner of %s: %w", fresh.Database, err)
	}
	if owner != migrations.RoleMigrator {
		return fmt.Errorf("%w: %s (owner %s)", ErrDatabaseOwner, fresh.Database, owner)
	}
	return nil
}

// record writes the identity (after 0001 the table exists) and moves tenant_routing.schema_version from the
// version read under the lock; 0 rows means the route changed meanwhile.
func (c *Controller) record(ctx context.Context, conn *sql.Conn, db *sql.DB, fresh Ref, to int64) error {
	if to >= 1 {
		if err := ensureIdentity(ctx, db, fresh); err != nil {
			return err
		}
	}
	r, err := conn.ExecContext(ctx, `update tenant_routing set schema_version = $3, updated_at = now()
		where tenant_id = $1 and schema_version = $2`, fresh.TenantID, fresh.SchemaVersion, to)
	if err != nil {
		return fmt.Errorf("tenant_routing: %w", err)
	}
	if n, err := r.RowsAffected(); err != nil || n != 1 {
		return fmt.Errorf("%w: %s", ErrRoutingRace, fresh.Slug)
	}
	return nil
}

// ensureIdentity writes core.tenant_identity from the route when it is empty and checks it otherwise
// (tenant_0001_core.sql:18: the API compares it with tenant_routing.sentinel when it opens a pool).
func ensureIdentity(ctx context.Context, db *sql.DB, fresh Ref) error {
	if _, err := db.ExecContext(ctx, `insert into core.tenant_identity (tenant_id, sentinel) values ($1, $2)
		on conflict (singleton) do nothing`, fresh.TenantID, fresh.Sentinel); err != nil {
		return fmt.Errorf("tenant_identity: %w", err)
	}
	var tenant, sentinel uuid.UUID
	if err := db.QueryRowContext(ctx, `select tenant_id, sentinel from core.tenant_identity`).Scan(&tenant, &sentinel); err != nil {
		return fmt.Errorf("tenant_identity: %w", err)
	}
	if tenant != fresh.TenantID || sentinel != fresh.Sentinel {
		return fmt.Errorf("%w: database %s", ErrSentinelMismatch, fresh.Database)
	}
	return nil
}

// audit writes the outcome of one tenant to platform_audit (actor: system, request_id: the run).
func (c *Controller) audit(ctx context.Context, action, runID string, res Result) error {
	details := map[string]any{"database": res.Ref.Database, "from": res.From, "to": res.To}
	result := "ok"
	if res.Err != nil {
		result = "failed"
		msg := res.Err.Error()
		if c.Redact != nil {
			msg = c.Redact(msg)
		}
		details["error"] = msg
	}
	b, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("audit details: %w", err)
	}
	if _, err := c.Control.ExecContext(context.WithoutCancel(ctx), `
insert into platform_audit (actor_kind, action, target_type, target_id, result, request_id, details)
values ('system', $1, 'tenant', $2, $3, $4, $5::jsonb)`, action, res.Ref.TenantID, result, runID, string(b)); err != nil {
		return fmt.Errorf("platform_audit: %w", err)
	}
	return nil
}

// Rollback rolls the listed tenants back to target, one by one; there is no «all tenants» (down-guard,
// Q-W0.06-4: production fixes forward). Every slug must exist and be past provisioning (ErrProvisioning); the
// first failure stops the rollback.
func (c *Controller) Rollback(ctx context.Context, target int64, slugs []string) (Report, error) {
	if len(slugs) == 0 {
		return Report{}, ErrNoTenants
	}
	if target < 0 || target > c.latest() {
		return Report{}, fmt.Errorf("%w: %d", ErrBadTarget, target)
	}
	refs, err := List(ctx, c.Control)
	if err != nil {
		return Report{}, err
	}
	chosen, err := chooseTenants(refs, slugs)
	if err != nil {
		return Report{}, err
	}
	rep := Report{RunID: NewRunID("rollback"), Target: target, Phases: []Phase{{Name: "rollback", Tenants: chosen}}}
	for _, ref := range chosen {
		res := c.locked(ctx, ref, func(conn *sql.Conn, fresh Ref) Result { return c.down(ctx, conn, fresh, target) })
		c.log(ctx, rep.RunID, "rollback", res)
		if res.Err == nil && res.From == res.To {
			rep.Skipped = append(rep.Skipped, res)
			continue
		}
		if err := c.audit(ctx, ActionRollback, rep.RunID, res); err != nil && res.Err == nil {
			res.Err = err
		}
		if res.Err != nil {
			rep.Failed = append(rep.Failed, res)
			return rep, fmt.Errorf("rollback %s: %w", ref.Slug, res.Err)
		}
		rep.Done = append(rep.Done, res)
	}
	return rep, nil
}

// chooseTenants returns the tenants of slugs in their order: each must exist and be past provisioning.
func chooseTenants(refs []Ref, slugs []string) ([]Ref, error) {
	chosen := make([]Ref, 0, len(slugs))
	for _, slug := range slugs {
		i := slices.IndexFunc(refs, func(r Ref) bool { return r.Slug == slug })
		if i < 0 {
			return nil, fmt.Errorf("%w: %q", ErrUnknownTenant, slug)
		}
		if refs[i].Provisioning() {
			return nil, fmt.Errorf("%w: %q", ErrProvisioning, slug)
		}
		chosen = append(chosen, refs[i])
	}
	return chosen, nil
}

func (c *Controller) down(ctx context.Context, conn *sql.Conn, fresh Ref, target int64) Result {
	res := Result{Ref: fresh, From: fresh.SchemaVersion, To: fresh.SchemaVersion}
	if fresh.SchemaVersion <= target {
		return res
	}
	db, err := c.Connect.Open(ctx, fresh)
	if err != nil {
		res.Err = err
		return res
	}
	defer db.Close()
	if res.Err = c.precheck(ctx, db, fresh); res.Err != nil {
		return res
	}
	out, err := c.runner().DownTo(ctx, db, target)
	res.To = out.To
	if res.To == res.From && err != nil {
		res.Err = err
		return res
	}
	r, uerr := conn.ExecContext(ctx, `update tenant_routing set schema_version = $3, updated_at = now()
		where tenant_id = $1 and schema_version = $2`, fresh.TenantID, fresh.SchemaVersion, res.To)
	switch {
	case uerr != nil:
		err = errors.Join(err, fmt.Errorf("tenant_routing: %w", uerr))
	default:
		if n, _ := r.RowsAffected(); n != 1 {
			err = errors.Join(err, fmt.Errorf("%w: %s", ErrRoutingRace, fresh.Slug))
		}
	}
	res.Err = err
	return res
}

// Status is the schema state of one tenant: the version in tenant_routing and in the database.
type Status struct {
	Ref    Ref
	Actual int64 // -1: the database could not be read or was not opened (provisioning)
	Drift  bool
	Err    error
}

// StatusTimeout bounds the connection to one tenant database in Status.
const StatusTimeout = 5 * time.Second

// Status reads the actual version of every tenant database; an unreachable database is a drift. A tenant in
// provisioning is listed without opening its database (Actual -1, no drift): it belongs to the provisioner.
func (c *Controller) Status(ctx context.Context) ([]Status, error) {
	refs, err := List(ctx, c.Control)
	if err != nil {
		return nil, err
	}
	out := make([]Status, 0, len(refs))
	for _, r := range refs {
		if r.Provisioning() {
			out = append(out, Status{Ref: r, Actual: -1})
			continue
		}
		st := Status{Ref: r, Actual: -1, Drift: true}
		st.Actual, st.Err = c.version(ctx, r)
		if st.Err != nil {
			st.Actual = -1
		}
		st.Drift = st.Err != nil || st.Actual != r.SchemaVersion
		out = append(out, st)
	}
	return out, nil
}

func (c *Controller) version(ctx context.Context, r Ref) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, StatusTimeout)
	defer cancel()
	db, err := c.Connect.Open(ctx, r)
	if err != nil {
		return -1, err
	}
	defer db.Close()
	return c.runner().Version(ctx, db)
}
