package accesstest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Now is «now» of the worlds: 01.10.2026 10:30 MSK, as harness.Now of the isolation suite.
var Now = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)

// World is one tenant: its tenant DB and a control DB with the tenant, accounts, memberships and owner bindings.
type World struct {
	TenantID uuid.UUID
	Tenant   *pgxpool.Pool
	Control  *pgxpool.Pool
	Now      time.Time
	tb       testing.TB
}

// NewWorld creates the databases of a fresh tenant (state active).
func (s *Server) NewWorld(tb testing.TB) *World {
	tb.Helper()
	w := &World{TenantID: uuid.New(), Tenant: s.NewDB(tb, Tenant), Control: s.NewDB(tb, Control), Now: Now, tb: tb}
	w.tenantExec(`insert into core.tenant_identity (tenant_id, sentinel) values ($1, $1)`, w.TenantID)
	w.tenantExec(`insert into access.policy_state default values`)
	w.controlExec(`insert into tenants (id, slug, display_name, industry_pack, state) values ($1, $2, 'Мир теста', 'logistics', 'active')`,
		w.TenantID, "t-"+w.TenantID.String()[:8])
	return w
}

func (w *World) ctx() context.Context { return context.WithoutCancel(w.tb.Context()) }

func (w *World) tenantExec(sql string, args ...any) {
	w.tb.Helper()
	if _, err := w.Tenant.Exec(w.ctx(), sql, args...); err != nil {
		w.tb.Fatalf("tenant: %s: %v", sql, err)
	}
}

func (w *World) controlExec(sql string, args ...any) {
	w.tb.Helper()
	if _, err := w.Control.Exec(w.ctx(), sql, args...); err != nil {
		w.tb.Fatalf("control: %s: %v", sql, err)
	}
}

// Unit adds an org unit under parent (uuid.Nil: top level) with its closure rows.
func (w *World) Unit(name string, parent uuid.UUID) uuid.UUID {
	w.tb.Helper()
	id := uuid.New()
	var p *uuid.UUID
	if parent != uuid.Nil {
		p = &parent
	}
	w.tenantExec(`insert into org.units (id, parent_id, kind, name, time_zone) values ($1, $2, 'company', $3, 'Europe/Moscow')`, id, p, name)
	w.tenantExec(`insert into org.unit_closure (ancestor_id, descendant_id, depth) values ($1, $1, 0)`, id)
	if parent != uuid.Nil {
		w.tenantExec(`insert into org.unit_closure (ancestor_id, descendant_id, depth)
			select ancestor_id, $1, depth + 1 from org.unit_closure where descendant_id = $2`, id, parent)
	}
	return id
}

// Card adds a person card without an account.
func (w *World) Card(name string, home uuid.UUID) uuid.UUID {
	w.tb.Helper()
	id := uuid.New()
	w.tenantExec(`insert into people.person_profiles (id, full_name, email, home_unit_id) values ($1, $2, $3, $4)`,
		id, name, id.String()[:8]+"@card.test", home)
	return id
}

// Member adds a person with an active account and membership; email is the account e-mail.
func (w *World) Member(name, email string, home uuid.UUID) uuid.UUID {
	w.tb.Helper()
	return w.MemberWith(name, email, home, "active", "active")
}

// MemberWith adds a person whose membership and account have the given statuses.
func (w *World) MemberWith(name, email string, home uuid.UUID, membership, account string) uuid.UUID {
	w.tb.Helper()
	person, acc, m := uuid.New(), uuid.New(), uuid.New()
	w.tenantExec(`insert into people.person_profiles (id, membership_id, full_name, email, home_unit_id) values ($1, $2, $3, $4, $5)`,
		person, m, name, email, home)
	w.controlExec(`insert into accounts (id, issuer, subject, email_norm, display_name, status) values ($1, 'urn:ortus:dev', $2, lower($3), $4, $5)`,
		acc, acc.String(), email, name, account)
	w.controlExec(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, $4::membership_status, $5)`,
		m, w.TenantID, acc, membership, person)
	return person
}

// Owner gives the membership of person an owner binding.
func (w *World) Owner(person uuid.UUID) {
	w.tb.Helper()
	w.controlExec(`insert into owner_bindings (tenant_id, membership_id, granted_at)
		select tenant_id, id, $3 from memberships where tenant_id = $1 and person_profile_id = $2`, w.TenantID, person, w.Now.Add(-time.Hour))
}

// Role adds a role (kind system | template | custom) with version 1 of actions.
func (w *World) Role(name, kind, template string, actions ...string) uuid.UUID {
	w.tb.Helper()
	id := uuid.New()
	if actions == nil {
		actions = []string{}
	}
	w.tenantExec(`insert into access.roles (id, name, kind, template_key) values ($1, $2, $3, nullif($4, ''))`, id, name, kind, template)
	w.tenantExec(`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $1)`, id, actions)
	return id
}

// Group adds a group with a home unit (uuid.Nil: tenant-wide) and members.
func (w *World) Group(name string, home uuid.UUID, members ...uuid.UUID) uuid.UUID {
	w.tb.Helper()
	id := uuid.New()
	var h *uuid.UUID
	if home != uuid.Nil {
		h = &home
	}
	w.tenantExec(`insert into access.groups (id, name, home_unit_id, created_at) values ($1, $2, $3, $4)`, id, name, h, w.Now.Add(-time.Hour))
	for _, m := range members {
		w.tenantExec(`insert into access.group_members (group_id, person_id) values ($1, $2)`, id, m)
	}
	return id
}

// Grant is an assignment to add.
type Grant struct {
	Group       bool      // principal is a group
	Principal   uuid.UUID //
	Role        uuid.UUID
	Kind        string    // tenant | unit | self | project | resource | warehouse
	Ref         uuid.UUID // uuid.Nil for tenant and self
	Descendants bool
	From        time.Time // zero: Now − 1 day
	Until       *time.Time
	State       string // "" = active
}

// Assign adds an assignment and returns its id.
func (w *World) Assign(g Grant) uuid.UUID {
	w.tb.Helper()
	id := uuid.New()
	kind := "person"
	if g.Group {
		kind = "group"
	}
	var ref *uuid.UUID
	if g.Ref != uuid.Nil {
		ref = &g.Ref
	}
	if g.From.IsZero() {
		g.From = w.Now.Add(-24 * time.Hour)
	}
	if g.State == "" {
		g.State = "active"
	}
	w.tenantExec(`insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind,
		scope_ref, include_descendants, valid, state, granted_by, created_at)
		values ($1, $2, $3, $4, 1, $5, $6, $7, tstzrange($8::timestamptz, $9::timestamptz), $10, $3, $8)`,
		id, kind, g.Principal, g.Role, g.Kind, ref, g.Descendants, g.From, g.Until, g.State)
	return id
}

// Function gives person a work function from Now − 30 days (until: nil — open-ended).
func (w *World) Function(person uuid.UUID, fn string, home uuid.UUID, until *time.Time) {
	w.tb.Helper()
	w.tenantExec(`insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz))`,
		person, fn, home, w.Now.Add(-30*24*time.Hour), until)
}

// Install marks a module installed (modules.installations).
func (w *World) Install(module string) {
	w.tb.Helper()
	w.tenantExec(`insert into modules.installations (module_key, state, manifest_version, updated_by) values ($1, 'enabled', '0.2', $2)`,
		module, uuid.New())
}

// TC is the TenantContext of person (owner — by its active owner binding).
func (w *World) TC(person uuid.UUID) tenantctx.TenantContext {
	w.tb.Helper()
	tc := tenantctx.TenantContext{TenantID: w.TenantID, PersonID: person}
	err := w.Control.QueryRow(w.ctx(), `select m.id, m.account_id,
		exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
		from memberships m where m.tenant_id = $1 and m.person_profile_id = $2`, w.TenantID, person).
		Scan(&tc.MembershipID, &tc.AccountID, &tc.Owner)
	if err != nil {
		w.tb.Fatalf("membership of %s: %v", person, err)
	}
	return tc
}

// Pools reaches the tenant DB of the world.
func (w *World) Pools() Pools { return Pools{w.TenantID: w.Tenant} }

// Evaluator is the evaluator of W1.04 over the world, on the clock of the world.
func (w *World) Evaluator() *authz.Evaluator {
	src := authz.PGSource{Pools: w.Pools()}
	return authz.New(src, src, func() time.Time { return w.Now })
}

// Deps are the dependencies of the handlers over the world; the sign-in is always fresh.
func (w *World) Deps() kit.Deps {
	return kit.Deps{
		Pools: w.Pools(), Evaluator: w.Evaluator(), Control: w.Control, Now: func() time.Time { return w.Now },
		AuthTime:   func(context.Context) (time.Time, bool) { return w.Now, true },
		SessionNow: func() time.Time { return w.Now },
	}
}

// Ctx returns the context of a request of tc, with a request id (as requestid.Middleware sets it).
func (w *World) Ctx(tc tenantctx.TenantContext) context.Context {
	var req *http.Request
	requestid.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { req = r })).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(w.tb.Context(), http.MethodGet, "/", nil))
	return tenantctx.WithTenant(req.Context(), tc)
}

// Anyone is a TenantContext of an owner without a membership row: for helpers that only need an actor.
func (w *World) Anyone() tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: w.TenantID, PersonID: uuid.New(), Owner: true}
}

// PolicyVersion reads access.policy_state.
func (w *World) PolicyVersion() int64 {
	w.tb.Helper()
	var v int64
	if err := w.Tenant.QueryRow(w.ctx(), `select policy_version from access.policy_state`).Scan(&v); err != nil {
		w.tb.Fatal(err)
	}
	return v
}

// Count returns the number of rows of a query.
func (w *World) Count(sql string, args ...any) int {
	w.tb.Helper()
	var n int
	if err := w.Tenant.QueryRow(w.ctx(), "select count(*) from ("+sql+") x", args...).Scan(&n); err != nil {
		w.tb.Fatalf("count %s: %v", sql, err)
	}
	return n
}

// ControlCount is Count over the control DB.
func (w *World) ControlCount(sql string, args ...any) int {
	w.tb.Helper()
	var n int
	if err := w.Control.QueryRow(w.ctx(), "select count(*) from ("+sql+") x", args...).Scan(&n); err != nil {
		w.tb.Fatalf("count %s: %v", sql, err)
	}
	return n
}
