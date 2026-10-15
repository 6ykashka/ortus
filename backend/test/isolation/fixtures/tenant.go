package fixtures

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// scopeKindUnit is access.role_assignments.scope_kind of a grant on an org unit.
const scopeKindUnit = "unit"

// tenantLoader writes one tenant into its database inside one transaction.
type tenantLoader struct {
	ctx    context.Context //nolint:containedctx // lives for one Load call only
	tx     *sql.Tx
	t      TenantDef
	now    time.Time
	owner  uuid.UUID // person id of the owner: granted_by, created_by, updated_by
	actors []ActorDef
	seq    int
	// content: write TenantDef.Content too (WithContent).
	content bool
}

func (w *World) loadTenant(ctx context.Context, t TenantDef) (int64, error) {
	return w.migrate(ctx, w.TenantDBs[t.Key], migrations.Tenant, func(tx *sql.Tx) error {
		l := &tenantLoader{ctx: ctx, tx: tx, t: t, now: w.Now, owner: w.ownerPerson(t.Key), actors: w.Catalog.Actors, content: w.Content}
		return l.load()
	})
}

func (w *World) ownerPerson(t string) uuid.UUID {
	for _, a := range w.Catalog.Actors {
		for _, m := range a.Memberships {
			if m.Tenant == t && m.Owner {
				return nameID(memberRef(refPerson, a.Key, t))
			}
		}
	}
	return uuid.Nil // Validate guarantees an owner
}

func (l *tenantLoader) exec(what, q string, args ...any) error {
	if _, err := l.tx.ExecContext(l.ctx, q, args...); err != nil {
		return fmt.Errorf("%s: %w", what, err)
	}
	return nil
}

func (l *tenantLoader) load() error {
	steps := []func() error{
		func() error {
			return l.exec("tenant_identity", `insert into core.tenant_identity (tenant_id, sentinel) values ($1, $2)`,
				nameID(tenantRef(l.t.Key)), sentinel(l.t.Key))
		},
		func() error { return l.exec("policy_state", `insert into access.policy_state default values`) },
		l.units,
		l.roles,
		l.people,
		l.groups,
		func() error {
			return l.exec("modules", `insert into modules.installations (module_key, state, manifest_version, updated_by)
				values ('logistics', 'enabled', '0.2', $1)`, l.owner)
		},
	}
	if l.content {
		steps = append(steps, l.contentSteps()...)
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return err
		}
	}
	return nil
}

func (l *tenantLoader) unitID(key string) uuid.UUID { return nameID(localRef(refUnit, l.t.Key, key)) }

func (l *tenantLoader) units() error {
	parent := map[string]string{}
	for _, u := range l.t.Units {
		parent[u.Key] = u.Parent
		var parentID *uuid.UUID
		if u.Parent != "" {
			id := l.unitID(u.Parent)
			parentID = &id
		}
		if err := l.exec("unit "+u.Key, `insert into org.units (id, parent_id, kind, name, time_zone) values ($1, $2, $3, $4, $5)`,
			l.unitID(u.Key), parentID, u.Kind, u.Name, u.TimeZone); err != nil {
			return err
		}
		// Transitive closure (scope_contains): the unit itself and every ancestor.
		for anc, depth := u.Key, 0; anc != ""; anc, depth = parent[anc], depth+1 {
			if err := l.exec("unit_closure "+u.Key, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
				values ($1, $2, $3)`, l.unitID(anc), l.unitID(u.Key), depth); err != nil {
				return err
			}
		}
	}
	return nil
}

func (l *tenantLoader) roles() error {
	for _, r := range l.t.Roles {
		id := nameID(localRef(refRole, l.t.Key, r.Key))
		var tmpl *string
		if r.Template != "" {
			tmpl = &r.Template
		}
		if err := l.exec("role "+r.Key, `insert into access.roles (id, name, kind, template_key, current_version)
			values ($1, $2, $3, $4, 1)`, id, r.Name, r.Kind, tmpl); err != nil {
			return err
		}
		if err := l.exec("role version "+r.Key, `insert into access.role_versions (role_id, version, actions, created_by)
			values ($1, 1, $2, $3)`, id, r.Actions, l.owner); err != nil {
			return err
		}
	}
	return nil
}

func (l *tenantLoader) people() error {
	for _, a := range l.actors {
		for _, m := range a.Memberships {
			if m.Tenant != l.t.Key {
				continue
			}
			at := a.Key + "@" + m.Tenant
			person := nameID(memberRef(refPerson, a.Key, m.Tenant))
			if err := l.exec("person "+at, `insert into people.person_profiles (id, membership_id, full_name, email, home_unit_id)
				values ($1, $2, $3, $4, $5)`, person, nameID(memberRef(refMembership, a.Key, m.Tenant)), a.Name, subject(a.Key)+"@isolation.test",
				l.unitID(m.Home)); err != nil {
				return err
			}
			if m.Function != "" {
				if err := l.exec("work profile "+at, `insert into people.work_profiles (id, person_id, function, unit_id, valid)
					values ($1, $2, $3, $4, tstzrange($5::timestamptz, null))`,
					nameID(memberRef("work", a.Key, m.Tenant)), person, m.Function, l.unitID(m.Home), l.now.Add(-grantedSince)); err != nil {
					return err
				}
			}
			if err := l.grants("person", person, m.Grants); err != nil {
				return fmt.Errorf("%s: %w", at, err)
			}
		}
	}
	return nil
}

func (l *tenantLoader) groups() error {
	for _, g := range l.t.Groups {
		id := nameID(localRef(refGroup, l.t.Key, g.Key))
		if err := l.exec("group "+g.Key, `insert into access.groups (id, name) values ($1, $2)`, id, g.Name); err != nil {
			return err
		}
		if err := l.grants("group", id, g.Grants); err != nil {
			return fmt.Errorf("group %s: %w", g.Key, err)
		}
	}
	return l.groupMembers()
}

func (l *tenantLoader) groupMembers() error {
	for _, a := range l.actors {
		for _, m := range a.Memberships {
			if m.Tenant != l.t.Key {
				continue
			}
			for _, g := range m.Groups {
				if err := l.exec("group member "+a.Key, `insert into access.group_members (group_id, person_id) values ($1, $2)`,
					nameID(localRef(refGroup, l.t.Key, g)), nameID(memberRef(refPerson, a.Key, m.Tenant))); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// scope returns scope_kind and scope_ref of a grant: tenant, self, a unit key or <kind>:<object key>.
func (l *tenantLoader) scope(s string) (string, *uuid.UUID) {
	switch {
	case s == ScopeTenant || s == ScopeSelf:
		return s, nil
	case l.t.hasUnit(s):
		id := l.unitID(s)
		return scopeKindUnit, &id
	}
	kind, key, _ := strings.Cut(s, ":") // Validate guarantees <kind>:<object of the tenant>
	id := nameID(localRef(kind, l.t.Key, key))
	return kind, &id
}

// grants writes role assignments of one principal. Scope: tenant, self, a unit or an object of the tenant.
func (l *tenantLoader) grants(kind string, principal uuid.UUID, grants []GrantDef) error {
	for _, g := range grants {
		l.seq++
		scopeKind, scopeRef := l.scope(g.Scope)
		since, until := periodBounds(g.Period)
		from, to := l.now.Add(since), (*time.Time)(nil)
		if until != nil {
			end := l.now.Add(*until)
			to = &end
		}
		if err := l.exec(fmt.Sprintf("assignment %d", l.seq), `insert into access.role_assignments
			(id, principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, include_descendants,
			 valid, granted_by, reason)
			values ($1, $2, $3, $4, 1, $5, $6, $7, tstzrange($8::timestamptz, $9::timestamptz), $10, 'isolation fixture')`,
			nameID(fmt.Sprintf("assignment:%s#%d", l.t.Key, l.seq)), kind, principal,
			nameID(localRef(refRole, l.t.Key, g.Role)), scopeKind, scopeRef, g.Descendants, from, to, l.owner); err != nil {
			return err
		}
	}
	return nil
}
