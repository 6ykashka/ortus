package main

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Tenant DB part of the seed: org structure and people. Roles, fleet, calendar and other modules are added
// by their steps as cmd/seed/<m>.go (plan §3.5).

type unit struct {
	proto, kind, parent, name string
	timeZone                  string
}

type member struct {
	proto, name, email, protoStatus, title, function string
	home                                             string // home unit (org.units) — not in the prototype
}

type tenantData struct {
	tenant  tenantDef
	units   []unit // parents first
	members []member
}

func (td tenantData) member(proto string) (member, bool) {
	for _, m := range td.members {
		if m.proto == proto {
			return m, true
		}
	}
	return member{}, false
}

func (td tenantData) unitID(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }

// tenantDBs lists the tenants that get a database in the local stand, in seeding order.
func tenantDBs() []tenantData { return []tenantData{alta, lotosData} }

func tenantDataOf(proto string) (tenantData, bool) {
	for _, td := range tenantDBs() {
		if td.tenant.proto == proto {
			return td, true
		}
	}
	return tenantData{}, false
}

func tenantByProto(proto string) tenantDef {
	for _, t := range tenants {
		if t.proto == proto {
			return t
		}
	}
	panic("seed: unknown tenant " + proto)
}

// seedTenantDB creates (dev) and migrates the tenant database, records the version in tenant_routing and
// writes the tenant rows in one transaction; objs holds the files the seed attaches (nil — none are attached).
func seedTenantDB(ctx context.Context, super, control *sql.DB, dsn string, td tenantData, objs objectStore) (migrations.Result, error) {
	if err := migrations.CreateDatabase(ctx, super, td.tenant.database); err != nil {
		return migrations.Result{}, err
	}
	db, err := open(ctx, "tenant DB "+td.tenant.database, dsn)
	if err != nil {
		return migrations.Result{}, err
	}
	defer db.Close()
	res, err := migrations.Up(ctx, db, migrations.Tenant)
	if err != nil {
		return res, err
	}
	if _, err := control.ExecContext(ctx, `update tenant_routing set schema_version = $2, updated_at = now()
		where tenant_id = $1 and schema_version <> $2`, td.tenant.id(), res.To); err != nil {
		return res, fmt.Errorf("tenant_routing: %w", err)
	}
	if err := writeTenant(ctx, db, td, objs); err != nil {
		return res, err
	}
	return res, writeServiceIndex(ctx, control, td) // W7.31: the control index of the personal links and the pages
}

func writeTenant(ctx context.Context, db *sql.DB, td tenantData, objs objectStore) (err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err = tx.ExecContext(ctx, `insert into core.tenant_identity (tenant_id, sentinel) values ($1, $2)
		on conflict (singleton) do nothing`, td.tenant.id(), td.tenant.sentinel()); err != nil {
		return fmt.Errorf("tenant_identity: %w", err)
	}
	tasks := func(ctx context.Context, tx *sql.Tx, td tenantData) error { return writeTasks(ctx, tx, td, objs) }
	for _, step := range []func(context.Context, *sql.Tx, tenantData) error{
		writeUnits,
		writePeople,
		writeAccess,     // roles, groups, assignments, modules (access.go, W1.04)
		writeFleet,      // vehicles (fleet.go, W2.02)
		writeFleetTrips, // trips of the demo (fleet_trips.go, W2.05)
		writeCalendar,   // the calendar of resources (calendar.go, W4.40)
		tasks,           // projects and tasks (tasks.go, W4.11)
		writeKnowledge,  // the knowledge base (knowledge.go, W4.31)
		writeForms,      // the forms and their responses (forms.go, W4.21)
		writeDocs,       // the documents of the demo (docs.go, W7.23)
		writeService,    // the directions and the requests of «Обращения» (service.go, W7.31)
		writeStand,      // «Логистика» of «Альта» on the stand (stand.go, W2.54)
	} {
		if err = step(ctx, tx, td); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func writeUnits(ctx context.Context, tx *sql.Tx, td tenantData) error {
	parent := map[string]string{}
	for _, u := range td.units {
		parent[u.proto] = u.parent
		var parentID *uuid.UUID
		if u.parent != "" {
			id := td.unitID(u.parent)
			parentID = &id
		}
		if _, err := tx.ExecContext(ctx, `insert into org.units (id, parent_id, kind, name, time_zone)
			values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
			td.unitID(u.proto), parentID, u.kind, u.name, u.timeZone); err != nil {
			return fmt.Errorf("unit %s: %w", u.proto, err)
		}
		// Transitive closure (scope_contains): the unit itself and every ancestor.
		for anc, depth := u.proto, 0; anc != ""; anc, depth = parent[anc], depth+1 {
			if _, err := tx.ExecContext(ctx, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
				values ($1, $2, $3) on conflict do nothing`, td.unitID(anc), td.unitID(u.proto), depth); err != nil {
				return fmt.Errorf("unit_closure %s→%s: %w", anc, u.proto, err)
			}
		}
	}
	return nil
}

func writePeople(ctx context.Context, tx *sql.Tx, td tenantData) error {
	membershipOf := map[string]uuid.UUID{}
	for _, m := range memberships() {
		if m.tenant == td.tenant.proto {
			membershipOf[m.member] = m.id()
		}
	}
	for _, m := range td.members {
		var membershipID *uuid.UUID
		if id, ok := membershipOf[m.proto]; ok {
			membershipID = &id
		}
		personID := seedID(td.tenant.proto, m.proto)
		if _, err := tx.ExecContext(ctx, `insert into people.person_profiles (id, membership_id, full_name, email, home_unit_id)
			values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
			personID, membershipID, m.name, m.email, td.unitID(m.home)); err != nil {
			return fmt.Errorf("person %s: %w", m.proto, err)
		}
		if m.function == "" {
			continue
		}
		// Профессиональная функция (driver блокирует начисления, AUTH-05) — с начала пилотного сентября.
		if _, err := tx.ExecContext(ctx, `insert into people.work_profiles (id, person_id, function, unit_id, valid)
			values ($1, $2, $3, $4, tstzrange('2026-09-01 00:00+03', null)) on conflict (id) do nothing`,
			seedID(td.tenant.proto, "work:"+m.proto+":"+m.function), personID, m.function, td.unitID(m.home)); err != nil {
			return fmt.Errorf("work profile %s: %w", m.proto, err)
		}
	}
	return nil
}
