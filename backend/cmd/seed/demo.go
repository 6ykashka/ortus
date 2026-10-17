package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Demo part of the seed (W2.90, the show of 18.10): `go run ./cmd/seed demo` (stand.mjs seed demo) runs the base seed
// and then puts «Альта» into the state of the preset logistics-ready of MSW (adapter/src/msw/core/presets.ts):
// «Логистика» is on and Марина Котова is «Менеджер логистики» of «Север Логистик» with its subtree. Drivers, vehicles
// and the trips of today are the base seed (W2.02, W2.05). Without the argument nothing changes: the stack tests of
// cmd/api and e2e-stand run on the base seed, where logistics is off (access-gate @stand).

// demoArg is the argument of cmd/seed that adds the demo to the base seed.
const demoArg = "demo"

// demoGrant is an assignment of the preset; ids are those of MSW (seedUuid(scope, proto)).
type demoGrant struct {
	scope, proto, member, role, unit string
}

// kotovaManager is the assignment «a-kotova-manager» of logistics-ready.
var kotovaManager = demoGrant{
	scope: protoAlta + ":preset", proto: "a-kotova-manager", member: memberKotova, role: roleManager.proto, unit: homeAlta,
}

// memberKotova is Марина Котова, the logistician of the scenarios of the prototype.
const memberKotova = "m-kotova"

// demoModule is the stored key of «Логистика» (modulesreg catalog: fleet → logistics; MSW INSTALLABLE.fleet).
const demoModule = "logistics"

// demoManifest is the manifest version an installation through the modules page writes (modulesreg).
const demoManifest = "1.0.0"

func (g demoGrant) id() uuid.UUID { return seedID(g.scope, g.proto) }

// runDemo seeds the stand and then the demo; exit codes as run.
func runDemo(ctx context.Context, getenv func(string) string, stdout, stderr io.Writer) int {
	err := seed(ctx, getenv, stdout)
	if err == nil {
		err = seedDemo(ctx, getenv, stdout)
	}
	if err == nil {
		return exitOK
	}
	fmt.Fprintf(stderr, "seed: %v\n", err)
	if ce := (*configError)(nil); errors.As(err, &ce) {
		return exitConfig
	}
	return exitFailed
}

// seedDemo writes the demo into the tenant DB of «Альта» in one transaction.
func seedDemo(ctx context.Context, getenv func(string) string, out io.Writer) (err error) {
	dsn, err := migrations.TenantDSN(getenv("MIGRATOR_DB_URL"), getenv("TENANT_DB_HOST"), alta.tenant.database)
	if err != nil {
		return configErr("MIGRATOR_DB_URL: %v", err)
	}
	db, err := open(ctx, "tenant DB "+alta.tenant.database, dsn)
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
	if _, err = writeDemo(ctx, tx, alta); err != nil {
		return fmt.Errorf("demo %s: %w", alta.tenant.slug, err)
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	kotova, _ := alta.member(kotovaManager.member)
	fmt.Fprintf(out, "demo %s (%s): «Логистика» включена, %s — «%s» в «%s»\n",
		alta.tenant.slug, alta.tenant.database, kotova.name, roleManager.name, unitName(alta, kotovaManager.unit))
	return nil
}

func unitName(td tenantData, proto string) string {
	for _, u := range td.units {
		if u.proto == proto {
			return u.name
		}
	}
	return proto
}

// writeDemo switches «Логистика» on and writes the assignment of the preset; policy_version + 1 when anything
// changed (tenant 0001: «+1 при любом изменении ролей/назначений/модулей»). It returns the rows it changed: a second
// run changes nothing.
func writeDemo(ctx context.Context, tx *sql.Tx, td tenantData) (int64, error) {
	owner := seedID(td.tenant.proto, memberOwner)
	module, err := tx.ExecContext(ctx, `insert into modules.installations (module_key, state, manifest_version, updated_by)
		values ($1, 'enabled', $2, $3)
		on conflict (module_key) do update set state = 'enabled', revision = modules.installations.revision + 1,
		   updated_by = excluded.updated_by, updated_at = now()
		where modules.installations.state <> 'enabled'`, demoModule, demoManifest, owner)
	if err != nil {
		return 0, fmt.Errorf("module %s: %w", demoModule, err)
	}
	g := kotovaManager
	grant, err := tx.ExecContext(ctx, `insert into access.role_assignments
		(id, principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, include_descendants, valid,
		 granted_by, reason)
		values ($1, 'person', $2, $3, 1, 'unit', $4, true, tstzrange($5::timestamptz, null), $6, 'сид показа 18.10')
		on conflict (id) do nothing`,
		g.id(), seedID(td.tenant.proto, g.member), seedID(td.tenant.proto, g.role), seedID(td.tenant.proto, g.unit),
		grantsSince, owner)
	if err != nil {
		return 0, fmt.Errorf("assignment %s: %w", g.proto, err)
	}
	var changed int64
	for _, r := range []sql.Result{module, grant} {
		n, err := r.RowsAffected()
		if err != nil {
			return 0, err
		}
		changed += n
	}
	if changed > 0 {
		if _, err := tx.ExecContext(ctx, `update access.policy_state set policy_version = policy_version + 1`); err != nil {
			return 0, fmt.Errorf("policy_state: %w", err)
		}
	}
	return changed, nil
}
