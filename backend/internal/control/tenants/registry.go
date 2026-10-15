package tenants

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"
)

const refSQL = `
select t.id, t.slug, r.database_name, r.schema_version, r.sentinel, t.created_at, t.state::text
  from tenant_routing r
  join tenants t on t.id = r.tenant_id`

// queryer is a *sql.DB, *sql.Conn or *sql.Tx.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func scanRef(row interface{ Scan(dest ...any) error }) (Ref, error) {
	var r Ref
	err := row.Scan(&r.TenantID, &r.Slug, &r.Database, &r.SchemaVersion, &r.Sentinel, &r.CreatedAt, &r.State)
	return r, err
}

// List returns every tenant with a route, ordered by creation, then id; tenants in provisioning included (Ref.State).
func List(ctx context.Context, control queryer) ([]Ref, error) {
	rows, err := control.QueryContext(ctx, refSQL+` order by t.created_at, t.id`)
	if err != nil {
		return nil, fmt.Errorf("tenants: list: %w", err)
	}
	defer rows.Close()
	var out []Ref
	for rows.Next() {
		r, err := scanRef(rows)
		if err != nil {
			return nil, fmt.Errorf("tenants: list: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenants: list: %w", err)
	}
	return out, nil
}

// Lookup re-reads the route of one tenant; a missing one is ErrUnknownTenant.
func Lookup(ctx context.Context, control queryer, id uuid.UUID) (Ref, error) {
	r, err := scanRef(control.QueryRowContext(ctx, refSQL+` where t.id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Ref{}, fmt.Errorf("%w: %s", ErrUnknownTenant, id)
	}
	if err != nil {
		return Ref{}, fmt.Errorf("tenants: route of %s: %w", id, err)
	}
	return r, nil
}

// LookupDatabase finds the tenant routed to database name; no such route (or no tenant_routing yet: an empty
// control DB) is ErrUnknownTenant.
func LookupDatabase(ctx context.Context, control queryer, name string) (Ref, error) {
	var ready bool
	if err := control.QueryRowContext(ctx, `select to_regclass('public.tenant_routing') is not null`).Scan(&ready); err != nil {
		return Ref{}, fmt.Errorf("tenants: route of database %s: %w", name, err)
	}
	if !ready {
		return Ref{}, fmt.Errorf("%w: no tenant_routing in the control DB", ErrUnknownTenant)
	}
	r, err := scanRef(control.QueryRowContext(ctx, refSQL+` where r.database_name = $1`, name))
	if errors.Is(err, sql.ErrNoRows) {
		return Ref{}, fmt.Errorf("%w: database %s", ErrUnknownTenant, name)
	}
	if err != nil {
		return Ref{}, fmt.Errorf("tenants: route of database %s: %w", name, err)
	}
	return r, nil
}

// Connector opens a tenant database for the controller (as ortus_migrator).
type Connector interface {
	Open(ctx context.Context, ref Ref) (*sql.DB, error)
}

// DSNConnector opens tenant databases with the credentials of DSN (MIGRATOR_DB_URL): the same user and options,
// the path replaced by the database of the route and the host by Host (TENANT_DB_HOST) when set. A route to a
// service database is refused before dialing (tenantctx.CheckDatabaseName).
type DSNConnector struct {
	DSN      string
	Host     string
	Reserved []string // databases that are never tenant databases, e.g. the control DB
}

// Open implements Connector.
func (c DSNConnector) Open(ctx context.Context, ref Ref) (*sql.DB, error) {
	if err := tenantctx.CheckDatabaseName(ref.Database, c.Reserved...); err != nil {
		return nil, fmt.Errorf("tenant %s: %w", ref.Slug, err)
	}
	dsn, err := migrations.TenantDSN(c.DSN, c.Host, ref.Database)
	if err != nil {
		return nil, fmt.Errorf("tenant %s: migrator DSN is not a URL", ref.Slug) // the parse error quotes the DSN
	}
	return OpenDB(ctx, "tenant DB "+ref.Database, dsn)
}

// OpenDB connects to dsn and pings it. Errors name label, host and database but never the DSN: they end up in
// platform_audit and in logs.
func OpenDB(ctx context.Context, label, dsn string) (*sql.DB, error) {
	u, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(u.Scheme, "postgres") {
		return nil, fmt.Errorf("%s: not a postgres:// URL", label)
	}
	target := u.Host + u.Path
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("%s (%s): %w", label, target, err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect %s (%s): %w", label, target, err)
	}
	return db, nil
}
