package fixtures

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenantSecretRef is tenant_routing.secret_ref, as in the seed of the stand (W0.06): the variable TENANT_DB_URL
// holds the DSN of ortus_api, and the API pool replaces its path with database_name (migrations.TenantDSN).
const tenantSecretRef = "env:TENANT_DB_URL" //nolint:gosec // G101: a variable name, not a credential

// World is a catalog loaded into databases of one PostgreSQL cluster.
type World struct {
	Catalog   Catalog
	Cluster   *migratetest.Cluster
	Name      string
	ControlDB string
	TenantDBs map[string]string // tenant key → database name
	Now       time.Time         // «now» the grant periods were computed from
}

// ID resolves a reference (see Catalog.ID).
func (w *World) ID(ref string) (uuid.UUID, error) { return w.Catalog.ID(ref) }

// Actor resolves an actor key (see Catalog.Actor).
func (w *World) Actor(key string) (Actor, error) { return w.Catalog.Actor(key) }

// ControlURL returns the DSN of the control DB for role (an Ortus role or migratetest.Super).
func (w *World) ControlURL(role string) string { return w.Cluster.URL(w.ControlDB, role) }

// TenantURL returns the DSN of the database of tenant t for role.
func (w *World) TenantURL(t, role string) string { return w.Cluster.URL(w.TenantDBs[t], role) }

// Env returns the environment of an API process against this world (keys of deploy/compose/.env.example):
// CONTROL_DB_URL and TENANT_DB_URL as ortus_api, MIGRATOR_DB_URL, APP_ENV=test, AUTH_PROVIDER=dev.
func (w *World) Env() map[string]string {
	return map[string]string{
		"CONTROL_DB_URL":  w.ControlURL(migrations.RoleAPI),
		"TENANT_DB_URL":   w.Cluster.URL("", migrations.RoleAPI),
		"TENANT_DB_HOST":  "",
		"MIGRATOR_DB_URL": w.ControlURL(migrations.RoleMigrator),
		"APP_ENV":         "test",
		"AUTH_PROVIDER":   "dev",
	}
}

var worldName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// ErrDatabaseExists is returned by Load when a database of the world already exists: worlds never share data.
var ErrDatabaseExists = errors.New("fixtures: database already exists")

// Load creates the databases <name>_control and <name>_t_<tenant> in cluster, migrates them as ortus_migrator
// and writes the Default catalog. Grant periods are computed from now.
func Load(ctx context.Context, c *migratetest.Cluster, name string, now time.Time) (*World, error) {
	if !worldName.MatchString(name) {
		return nil, fmt.Errorf("fixtures: world name %q must match %s", name, worldName)
	}
	cat := Default()
	if err := cat.Validate(); err != nil {
		return nil, err
	}
	w := &World{Catalog: cat, Cluster: c, Name: name, ControlDB: name + "_control", TenantDBs: map[string]string{}, Now: now}
	for _, t := range cat.Tenants {
		w.TenantDBs[t.Key] = name + "_t_" + t.Key
	}
	if err := w.createDatabases(ctx); err != nil {
		return nil, err
	}
	versions := map[string]int64{}
	for _, t := range cat.Tenants {
		v, err := w.loadTenant(ctx, t)
		if err != nil {
			return nil, fmt.Errorf("fixtures: tenant %s: %w", t.Key, err)
		}
		versions[t.Key] = v
	}
	if err := w.loadControl(ctx, versions); err != nil {
		return nil, fmt.Errorf("fixtures: control: %w", err)
	}
	return w, nil
}

func (w *World) createDatabases(ctx context.Context) error {
	super, err := open(ctx, w.Cluster.URL("postgres", migratetest.Super))
	if err != nil {
		return err
	}
	defer super.Close()
	names := []string{w.ControlDB}
	for _, t := range w.Catalog.Tenants {
		names = append(names, w.TenantDBs[t.Key])
	}
	for _, n := range names {
		var exists bool
		if err := super.QueryRowContext(ctx, `select exists (select 1 from pg_database where datname = $1)`, n).
			Scan(&exists); err != nil {
			return fmt.Errorf("fixtures: database %s: %w", n, err)
		}
		if exists {
			return fmt.Errorf("%w: %s", ErrDatabaseExists, n)
		}
		if err := migrations.CreateDatabase(ctx, super, n); err != nil {
			return err
		}
	}
	return nil
}

func open(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("fixtures: open: %w", err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("fixtures: connect: %w", err)
	}
	return db, nil
}

// migrate opens database name as ortus_migrator, applies the migrations of kind k and runs fill in one transaction.
func (w *World) migrate(ctx context.Context, name string, k migrations.Kind, fill func(*sql.Tx) error) (int64, error) {
	db, err := open(ctx, w.Cluster.URL(name, migrations.RoleMigrator))
	if err != nil {
		return 0, err
	}
	defer db.Close()
	res, err := migrations.Up(ctx, db, k)
	if err != nil {
		return 0, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	if err := fill(tx); err != nil {
		_ = tx.Rollback()
		return 0, err
	}
	return res.To, tx.Commit()
}

func (w *World) loadControl(ctx context.Context, versions map[string]int64) error {
	_, err := w.migrate(ctx, w.ControlDB, migrations.Control, func(tx *sql.Tx) error {
		for _, t := range w.Catalog.Tenants {
			id := nameID(tenantRef(t.Key))
			if _, err := tx.ExecContext(ctx, `insert into tenants (id, slug, display_name, industry_pack, state)
				values ($1, $2, $3, 'logistics', 'active')`, id, t.Slug, t.Name); err != nil {
				return fmt.Errorf("tenant %s: %w", t.Key, err)
			}
			if _, err := tx.ExecContext(ctx, `insert into tenant_routing
				(tenant_id, cluster_ref, database_name, secret_ref, schema_version, sentinel)
				values ($1, 'test', $2, $3, $4, $5)`,
				id, w.TenantDBs[t.Key], tenantSecretRef, versions[t.Key], sentinel(t.Key)); err != nil {
				return fmt.Errorf("tenant_routing %s: %w", t.Key, err)
			}
		}
		for _, a := range w.Catalog.Actors {
			if err := insertAccount(ctx, tx, a); err != nil {
				return err
			}
		}
		return nil
	})
	return err
}

func insertAccount(ctx context.Context, tx *sql.Tx, a ActorDef) error {
	accountID := nameID(accountRef(a.Key))
	if _, err := tx.ExecContext(ctx, `insert into accounts (id, issuer, subject, email_norm, display_name)
		values ($1, $2, $3, $4, $5)`, accountID, IssuerDev, subject(a.Key), subject(a.Key)+"@isolation.test", a.Name); err != nil {
		return fmt.Errorf("account %s: %w", a.Key, err)
	}
	if a.Operator != "" {
		if _, err := tx.ExecContext(ctx, `insert into platform_operators (id, account_id, role, status) values ($1, $2, $3, 'active')`,
			nameID("operator:"+a.Key), accountID, a.Operator); err != nil {
			return fmt.Errorf("operator %s: %w", a.Key, err)
		}
	}
	for _, m := range a.Memberships {
		at := a.Key + "@" + m.Tenant
		if _, err := tx.ExecContext(ctx, `insert into memberships (id, tenant_id, account_id, status, person_profile_id)
			values ($1, $2, $3, 'active', $4)`,
			nameID(memberRef(refMembership, a.Key, m.Tenant)), nameID(tenantRef(m.Tenant)), accountID, nameID(memberRef(refPerson, a.Key, m.Tenant))); err != nil {
			return fmt.Errorf("membership %s: %w", at, err)
		}
		if !m.Owner {
			continue
		}
		if _, err := tx.ExecContext(ctx, `insert into owner_bindings (id, tenant_id, membership_id) values ($1, $2, $3)`,
			nameID(memberRef("owner", a.Key, m.Tenant)), nameID(tenantRef(m.Tenant)), nameID(memberRef(refMembership, a.Key, m.Tenant))); err != nil {
			return fmt.Errorf("owner binding %s: %w", at, err)
		}
	}
	return nil
}

func sentinel(t string) uuid.UUID { return nameID("sentinel:" + t) }
