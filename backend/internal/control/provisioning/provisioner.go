package provisioning

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// Steps of the saga, recorded in platform_audit.details.step of a failed run.
const (
	StepLoad      = "load"
	StepDatabase  = "database"
	StepGrants    = "grants"
	StepMigrate   = "migrate"
	StepBootstrap = "bootstrap"
	StepActivate  = "activate"
)

// DefaultConnectRoles get CONNECT on every new tenant database besides the runtime roles (whose grants follow
// every Up): the monitoring role of PostgreSQL (Q-W0.06-2; backup roles — W3.02). ortus_provisioner never gets
// CONNECT on a tenant database: every step inside one runs as the migrator (roles.go: the provisioner role may
// SET ROLE ortus_migrator, so CONNECT would hand it the tenant data).
var DefaultConnectRoles = []string{"pg_monitor"}

// ErrForeignDatabase: a database with the name of the tenant exists and is not owned by ortus_migrator; it may hold
// another tenant's data, so the provisioner never adopts it.
var ErrForeignDatabase = errors.New("provisioning: a database with this name exists and is not owned by " + migrations.RoleMigrator)

// Provisioner runs the saga of tenants in state provisioning.
type Provisioner struct {
	Control      *sql.DB           // control DB as ortus_migrator
	Admin        *sql.DB           // maintenance database as ortus_provisioner: CREATE DATABASE
	Connect      tenants.Connector // tenant databases as ortus_migrator
	ConnectRoles []string          // nil: DefaultConnectRoles
	Log          *slog.Logger      // nil: no log
	Redact       func(string) string
}

// Outcome is the result of Provision for one tenant.
type Outcome struct {
	TenantID      uuid.UUID
	Slug          string
	Database      string
	SchemaVersion int64
	State         string
	// Skipped: nothing (more) to do here — the tenant was not in provisioning, another provisioner holds its lock,
	// or its state changed during the saga (State is then the new one and the tenant is not activated).
	Skipped bool
}

// request is what the saga needs: the route and the parameters of the registration (audit tenant.create).
type request struct {
	ref                              tenants.Ref
	state                            string
	name, ownerEmail, timeZone, plan string
}

// Pending lists the tenants waiting for the provisioner, oldest first.
func (p *Provisioner) Pending(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := p.Control.QueryContext(ctx, `select id from tenants where state = $1 order by created_at, id`, stateProvisioning)
	if err != nil {
		return nil, fmt.Errorf("provisioning: pending: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("provisioning: pending: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// Summary is the outcome of RunOnce.
type Summary struct {
	Provisioned, Failed int
	Errors              []error
}

// RunOnce provisions every pending tenant; a failed tenant does not stop the others and is retried next run.
func (p *Provisioner) RunOnce(ctx context.Context) (Summary, error) {
	ids, err := p.Pending(ctx)
	if err != nil {
		return Summary{}, err
	}
	var s Summary
	for _, id := range ids {
		if ctx.Err() != nil {
			return s, ctx.Err()
		}
		out, err := p.Provision(ctx, id)
		switch {
		case err != nil:
			s.Failed++
			s.Errors = append(s.Errors, fmt.Errorf("tenant %s: %w", id, err))
		case !out.Skipped:
			s.Provisioned++
		}
	}
	return s, nil
}

// lockKey is the session advisory lock of one tenant's saga in the control DB (another key than the schema lock of
// the controller, which the migrate step takes on its own connection).
const lockKey = `hashtextextended('ortus:tenant-provision:' || $1::text, 0)`

// Provision runs the saga for one tenant: database → grants → migrations (sentinel) → initial data → trial.
// Every step is idempotent; a failure is audited with its step and the tenant stays in provisioning. The saga runs
// under a lock of the tenant in the control DB: a tenant another provisioner is working on is skipped.
func (p *Provisioner) Provision(ctx context.Context, id uuid.UUID) (Outcome, error) {
	conn, err := p.Control.Conn(ctx)
	if err != nil {
		return Outcome{TenantID: id}, fmt.Errorf("provision %s: control DB: %w", id, err)
	}
	defer conn.Close()
	var locked bool
	if err := conn.QueryRowContext(ctx, `select pg_try_advisory_lock(`+lockKey+`)`, id).Scan(&locked); err != nil {
		return Outcome{TenantID: id}, fmt.Errorf("provision %s: tenant lock: %w", id, err)
	}
	if !locked {
		return Outcome{TenantID: id, State: stateProvisioning, Skipped: true}, nil
	}
	defer func() {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), `select pg_advisory_unlock(`+lockKey+`)`, id)
	}()
	return p.provision(ctx, id)
}

func (p *Provisioner) provision(ctx context.Context, id uuid.UUID) (Outcome, error) {
	req, err := p.load(ctx, id)
	if err != nil {
		return Outcome{TenantID: id}, p.failed(ctx, id, "", StepLoad, err)
	}
	out := Outcome{TenantID: id, Slug: req.ref.Slug, Database: req.ref.Database, SchemaVersion: req.ref.SchemaVersion, State: req.state}
	if req.state != stateProvisioning {
		out.Skipped = true
		return out, nil
	}
	runID := tenants.NewRunID("provision")
	steps := []struct {
		name string
		run  func() error
	}{
		{StepDatabase, func() error { return p.createDatabase(ctx, req.ref.Database) }},
		{StepGrants, func() error { return p.grantConnect(ctx, req.ref) }},
		{StepMigrate, func() (err error) { out.SchemaVersion, err = p.migrate(ctx, req.ref, runID); return err }},
		{StepBootstrap, func() error { return p.bootstrap(ctx, req) }},
		{StepActivate, func() (err error) { out.State, err = p.activate(ctx, req, runID, out.SchemaVersion); return err }},
	}
	for _, st := range steps {
		if err := st.run(); err != nil {
			return out, p.failed(ctx, id, runID, st.name, err)
		}
	}
	if out.State != stateTrial {
		// The state changed during the saga (an operator suspended the tenant): the database is ready, the tenant
		// keeps the new state and is not activated.
		out.Skipped = true
		if p.Log != nil {
			p.Log.WarnContext(ctx, "tenant state changed during provisioning, not activated", slog.String("run_id", runID),
				slog.String("tenant_id", id.String()), slog.String("state", out.State))
		}
		return out, nil
	}
	if p.Log != nil {
		p.Log.InfoContext(ctx, "tenant provisioned", slog.String("run_id", runID), slog.String("tenant_id", id.String()),
			slog.String("database", req.ref.Database), slog.Int64("schema_version", out.SchemaVersion))
	}
	return out, nil
}

func (p *Provisioner) load(ctx context.Context, id uuid.UUID) (request, error) {
	ref, err := tenants.Lookup(ctx, p.Control, id)
	if err != nil {
		return request{}, err
	}
	req := request{ref: ref}
	var details []byte
	err = p.Control.QueryRowContext(ctx, `select t.state::text,
		(select a.details from platform_audit a where a.action = $2 and a.target_id = t.id order by a.id limit 1)
		from tenants t where t.id = $1`, id, ActionCreate).Scan(&req.state, &details)
	if err != nil {
		return request{}, fmt.Errorf("tenant %s: %w", id, err)
	}
	if req.state != stateProvisioning {
		return req, nil
	}
	var d struct{ Name, OwnerEmail, TimeZone, PlanKey string }
	if len(details) == 0 || json.Unmarshal(details, &d) != nil || d.Name == "" || d.TimeZone == "" {
		return request{}, fmt.Errorf("tenant %s: no %s request in platform_audit", id, ActionCreate)
	}
	req.name, req.ownerEmail, req.timeZone, req.plan = d.Name, d.OwnerEmail, d.TimeZone, d.PlanKey
	return req, nil
}

// createDatabase creates the tenant database as ortus_provisioner, owned by ortus_migrator; an existing database
// is reused only when the migrator owns it (a previous run of the saga).
func (p *Provisioner) createDatabase(ctx context.Context, name string) error {
	if err := tenantctx.CheckDatabaseName(name); err != nil {
		return err
	}
	exists, err := p.ownedDatabase(ctx, name)
	if err != nil || exists {
		return err
	}
	stmt := fmt.Sprintf(`create database %s owner %s template template0 encoding 'UTF8'`,
		pgx.Identifier{name}.Sanitize(), pgx.Identifier{migrations.RoleMigrator}.Sanitize())
	if _, err := p.Admin.ExecContext(ctx, stmt); err != nil {
		if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok && pgErr.Code == "42P04" {
			// duplicate_database: created meanwhile (outside the tenant lock) — adopt it only on the same terms.
			if _, oerr := p.ownedDatabase(ctx, name); oerr != nil {
				return oerr
			}
			return nil
		}
		return fmt.Errorf("create database %s: %w", name, err)
	}
	return nil
}

// ownedDatabase reports whether database name exists owned by ortus_migrator; another owner is ErrForeignDatabase.
func (p *Provisioner) ownedDatabase(ctx context.Context, name string) (bool, error) {
	var owner string
	err := p.Admin.QueryRowContext(ctx, `select pg_get_userbyid(datdba) from pg_database where datname = $1`, name).Scan(&owner)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return false, nil
	case err != nil:
		return false, fmt.Errorf("database %s: %w", name, err)
	case owner != migrations.RoleMigrator:
		return true, fmt.Errorf("%w: %s (owner %s)", ErrForeignDatabase, name, owner)
	}
	return true, nil
}

// grantConnect makes CONNECT explicit: none for PUBLIC and for the provisioner (revoked even when granted by an
// earlier version), the monitoring roles that exist (runtime roles get theirs from migrations.Grant after every Up).
func (p *Provisioner) grantConnect(ctx context.Context, ref tenants.Ref) error {
	db, err := p.Connect.Open(ctx, ref)
	if err != nil {
		return err
	}
	defer db.Close()
	roles := p.ConnectRoles
	if roles == nil {
		roles = DefaultConnectRoles
	}
	quoted := pgx.Identifier{ref.Database}.Sanitize()
	for _, from := range []string{"public", pgx.Identifier{migrations.RoleProvisioner}.Sanitize()} {
		if _, err := db.ExecContext(ctx, `revoke connect, temporary on database `+quoted+` from `+from); err != nil {
			return fmt.Errorf("revoke connect from %s: %w", from, err)
		}
	}
	for _, role := range roles {
		if role == migrations.RoleProvisioner {
			continue
		}
		var exists bool
		if err := db.QueryRowContext(ctx, `select exists (select 1 from pg_roles where rolname = $1)`, role).Scan(&exists); err != nil {
			return fmt.Errorf("role %s: %w", role, err)
		}
		if !exists {
			continue
		}
		if _, err := db.ExecContext(ctx, `grant connect on database `+quoted+` to `+pgx.Identifier{role}.Sanitize()); err != nil {
			return fmt.Errorf("grant connect to %s: %w", role, err)
		}
	}
	return nil
}

// migrate brings the database to the latest version through the controller: the identity (sentinel) is written
// from tenant_routing right after 0001.
func (p *Provisioner) migrate(ctx context.Context, ref tenants.Ref, runID string) (int64, error) {
	ctrl := &tenants.Controller{Control: p.Control, Connect: p.Connect, Log: p.Log, Redact: p.Redact}
	res := ctrl.Migrate(ctx, ref, migrations.Latest(migrations.Tenant), runID)
	return res.To, res.Err
}

// bootstrap writes the initial data of the tenant: the root unit (name and time zone of the request) and the
// person profile of the owner-to-be (e-mail; the name comes with the accepted invitation, W1.03).
func (p *Provisioner) bootstrap(ctx context.Context, req request) (err error) {
	db, err := p.Connect.Open(ctx, req.ref)
	if err != nil {
		return err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	root, owner := RootUnitID(req.ref.TenantID), OwnerPersonID(req.ref.TenantID)
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into org.units (id, kind, name, time_zone) values ($1, 'company', $2, $3) on conflict (id) do nothing`,
			[]any{root, req.name, req.timeZone}},
		{`insert into org.unit_closure (ancestor_id, descendant_id, depth) values ($1, $1, 0) on conflict do nothing`, []any{root}},
		{`insert into people.person_profiles (id, full_name, email, home_unit_id) values ($1, $2, $2, $3) on conflict (id) do nothing`,
			[]any{owner, req.ownerEmail, root}},
		{`insert into access.policy_state (singleton) values (true) on conflict do nothing`, nil},
	} {
		if _, err = tx.ExecContext(ctx, q.sql, q.args...); err != nil {
			return fmt.Errorf("bootstrap: %w", err)
		}
	}
	return tx.Commit()
}

// activate moves the tenant from provisioning to trial (PLAT-02) and audits the run. When the tenant left
// provisioning meanwhile (0 rows), it writes nothing and returns the state the tenant has now.
func (p *Provisioner) activate(ctx context.Context, req request, runID string, version int64) (state string, err error) {
	tx, err := p.Control.BeginTx(ctx, nil)
	if err != nil {
		return stateProvisioning, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	err = tx.QueryRowContext(ctx, `update tenants set state = 'trial', state_changed_at = now(), revision = revision + 1
		where id = $1 and state = 'provisioning' returning state::text`, req.ref.TenantID).Scan(&state)
	if errors.Is(err, sql.ErrNoRows) {
		if err = tx.QueryRowContext(ctx, `select state::text from tenants where id = $1`, req.ref.TenantID).Scan(&state); err != nil {
			return stateProvisioning, fmt.Errorf("tenants: %w", err)
		}
		return state, tx.Rollback()
	}
	if err != nil {
		return stateProvisioning, fmt.Errorf("tenants: %w", err)
	}
	details, _ := json.Marshal(map[string]any{"database": req.ref.Database, "schemaVersion": version, "planKey": req.plan})
	if _, err = tx.ExecContext(ctx, `insert into platform_audit (actor_kind, action, target_type, target_id, result, request_id, details)
		values ('system', $1, 'tenant', $2, 'ok', $3, $4::jsonb)`, ActionProvision, req.ref.TenantID, runID, string(details)); err != nil {
		return stateProvisioning, fmt.Errorf("platform_audit: %w", err)
	}
	return state, tx.Commit()
}

// failed audits a failed step (the error text carries no DSN: connections name host and database only) and returns
// err with the step.
func (p *Provisioner) failed(ctx context.Context, id uuid.UUID, runID, step string, err error) error {
	msg := err.Error()
	if p.Redact != nil {
		msg = p.Redact(msg)
	}
	if runID == "" {
		runID = tenants.NewRunID("provision")
	}
	details, _ := json.Marshal(map[string]any{"step": step, "error": msg})
	if _, aerr := p.Control.ExecContext(context.WithoutCancel(ctx), `insert into platform_audit
		(actor_kind, action, target_type, target_id, result, request_id, details)
		select 'system', $1, 'tenant', $2, 'failed', $3, $4::jsonb where exists (select 1 from tenants where id = $2)`,
		ActionProvision, id, runID, string(details)); aerr != nil {
		err = errors.Join(err, fmt.Errorf("platform_audit: %w", aerr))
	}
	if p.Log != nil {
		p.Log.ErrorContext(ctx, "tenant provisioning failed", slog.String("run_id", runID), slog.String("tenant_id", id.String()),
			slog.String("step", step), slog.String("error", msg))
	}
	return fmt.Errorf("provision %s: step %s: %w", id, step, err)
}

// Steps names the steps of the saga in order (help texts and logs).
func Steps() string {
	return strings.Join([]string{StepDatabase, StepGrants, StepMigrate, StepBootstrap, StepActivate}, " → ")
}
