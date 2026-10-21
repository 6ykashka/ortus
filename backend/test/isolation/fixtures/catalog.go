// Package fixtures is the one data set of every negative access test (design/docs/15-quality-security.md
// «Фикстуры изоляции», story S0-07): two tenants with namesake firms and roles, managers of neighbouring firms,
// a user with two roles in two units, drivers (one on a temporary assignment, one reaching earnings through a
// group) and one account that is a member of both tenants.
//
// The catalog is plain Go data; Load writes it into a control DB and one DB per tenant (migrations of W0.06), and
// the content of the tenants (imports, vehicles with files, notifications — W1.44) only WithContent.
// Rows of the isolation matrix refer to it by references (see ID). From step 1.4 the package is owned by W1.04,
// which extends the data; the reference format stays.
package fixtures

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Tenant keys and the pseudo-actor without a session.
const (
	TenantA   = "a"
	TenantB   = "b"
	Anonymous = "anonymous"
)

// IssuerDev is the OIDC issuer of the dev identities (W0.06 seed, dev sign-in of W0.09).
const IssuerDev = "urn:ortus:dev"

// Validity of the fixture grants relative to the «now» passed to Load.
const (
	// TemporaryFor is how long a temporary grant lasts after «now».
	TemporaryFor = 7 * 24 * time.Hour
	// temporarySince is how long ago a temporary grant started.
	temporarySince = 24 * time.Hour
	// grantedSince is how long ago permanent grants and work profiles started.
	grantedSince = 30 * 24 * time.Hour
)

// Scopes of a grant besides a unit key and an object. ScopeRelation (W4.02, tenant 0020) is the computed relation of
// the member with a record: like self, it names no object (scope_ref is null).
const (
	ScopeTenant   = "tenant"
	ScopeSelf     = "self"
	ScopeRelation = "relation"
)

// Catalog is the whole fixture data set.
type Catalog struct {
	Tenants []TenantDef
	Actors  []ActorDef
}

// MissingTenant references a tenant that exists in no database (Q-W1.02-7): rows «a tenantId that is nobody's».
const MissingTenant = "tenant:missing"

// TenantDef is one tenant: a business holding with its own database.
type TenantDef struct {
	Key, Slug, Name string
	Units           []UnitDef // parents first
	Roles           []RoleDef
	Groups          []GroupDef
	Objects         []ObjectDef  // targets of object-bound grants (PD-53): projects, warehouses, resources
	Content         Content      // objects of the modules for positive rows; Load writes them WithContent
	Requests        []RequestDef // tier requests of the control DB (W4.60, billing.go)
}

// Content is what the modules of stage 1 keep in the tenant DB and the rows of the matrix read (W1.44): people
// imports, vehicles with files attached to them, notifications. Keys are local to the tenant and to their kind.
type Content struct {
	Imports       []ImportDef
	Vehicles      []VehicleDef
	Files         []FileDef
	Notifications []NotificationDef
	// W4.11: the rows of tasks.projects of the object projects, tasks and rules of automation (content_tasks.go).
	Projects []ProjectDef
	Tasks    []TaskDef
	Rules    []RuleDef
}

// ImportDef is a CSV import of people in preview (people.imports): visible to members.manage over its default
// unit. Reference import:<tenant>.<key>.
type ImportDef struct {
	Key, DefaultUnit string // DefaultUnit — a unit key
	Rows             []ImportRowDef
}

// ImportRowDef is a row of an import that matched a person: an actor with a membership in the tenant (memberId of
// the row) and the unit of the row.
type ImportRowDef struct {
	Person, Unit string
}

// VehicleDef is a vehicle (fleet.vehicles) of a unit: a parent files attach to (files.FleetParents, the read
// action fleet.vehicles.read). Reference vehicle:<tenant>.<key>.
type VehicleDef struct {
	Key, Unit, Plate string
}

// FileDef is a checked (ready) file of the tenant (files.objects): an inspection photo attached to a vehicle, or
// (W4.11) an attachment of a task — Vehicle or Task, one of them. Reference file:<tenant>.<key>.
type FileDef struct {
	Key, Vehicle, Name string
	Task               string // a task key of the content (content_tasks.go)
}

// NotificationDef is a notification of the inbox (notify.notifications) and its audience: Recipient is an actor with
// a membership in the tenant; Permission over Unit and Sensitivity are checked again on every read. A notification
// without a permission and a unit is a system one. Reference notification:<tenant>.<key>.
type NotificationDef struct {
	Key, Recipient, Title string
	Permission, Unit      string // required_permission and a unit key
	Sensitivity           string // "" — normal; sensitive | restricted
}

// ObjectDef is an object a grant can be scoped to (scope kinds project | warehouse | resource of
// access.role_assignments). Reference <kind>:<tenant>.<key>. The fixtures hold no row for it: a grant only names
// its id (scope_ref), and the module that owns the table adds the row with its step.
type ObjectDef struct {
	Kind, Key, Name string
}

// UnitDef is an org unit (org.units). Key is local to the tenant: reference unit:<tenant>.<key>.
type UnitDef struct {
	Key, Parent, Kind, Name, TimeZone string
}

// RoleDef is a role with one version (access.roles, access.role_versions).
type RoleDef struct {
	Key, Name string
	Kind      string // system | template | custom
	Template  string // template_key (design/docs/11-permissions.yaml templates)
	Actions   []string
}

// GroupDef is a group of people with its own grants (access.groups).
type GroupDef struct {
	Key, Name string
	Grants    []GrantDef
}

// GrantDef is a role assignment. Scope is ScopeTenant, ScopeSelf, ScopeRelation, a unit key of the tenant or
// <kind>:<object key> of an object of the tenant.
type GrantDef struct {
	Role, Scope string
	Descendants bool
	Period      Period // "" — permanent
}

// Period is the validity of a fixture grant relative to the «now» passed to Load.
type Period string

// Periods of a grant besides the permanent one (since «now» − 30 days, open-ended).
const (
	// PeriodTemporary: from «now» − 1 day to «now» + TemporaryFor (a temporary assignment).
	PeriodTemporary Period = "temporary"
	// PeriodExpired: from «now» − 30 days to «now» − 1 day.
	PeriodExpired Period = "expired"
	// PeriodFuture: from «now» + 1 day, open-ended. It has already begun by the real clock of a run after that
	// day, so it tells whether the target compares periods with the suite clock (APP_FIXED_NOW) or with its own.
	PeriodFuture Period = "future"
)

var periods = []Period{"", PeriodTemporary, PeriodExpired, PeriodFuture}

// periodBounds returns the start and the end (nil: open-ended) of period p as offsets from «now».
func periodBounds(p Period) (since time.Duration, until *time.Duration) {
	at := func(d time.Duration) *time.Duration { return &d }
	switch p {
	case PeriodTemporary:
		return -temporarySince, at(TemporaryFor)
	case PeriodExpired:
		return -grantedSince, at(-temporarySince)
	case PeriodFuture:
		return temporarySince, nil
	}
	return -grantedSince, nil
}

// ActorDef is an account (control DB) with its memberships, one per tenant at most. Operator is the role of a
// platform operator (platform_operators.role: owner | admin | billing | support); an operator has no memberships.
type ActorDef struct {
	Key, Name   string
	Operator    string
	Memberships []MemberDef
}

// MemberDef is a membership and the person profile behind it.
type MemberDef struct {
	Tenant   string
	Home     string // unit key
	Owner    bool   // owner binding (ownership is not a role, AUTH-08)
	Function string // people.work_profiles.function, empty when none
	Grants   []GrantDef
	Groups   []string
}

// Actor is a resolved actor: the identity a target signs in with and its memberships.
type Actor struct {
	Key, Name       string
	Issuer, Subject string
	AccountID       uuid.UUID
	Operator        bool // a platform operator (platform_operators), not a member of any tenant
	Memberships     []Membership
}

// Membership is a resolved membership of an actor.
type Membership struct {
	Tenant                           string
	TenantID, MembershipID, PersonID uuid.UUID
	Owner                            bool
}

// ErrUnknownRef is returned by ID for a reference that is malformed or names nothing in the catalog.
var ErrUnknownRef = errors.New("fixtures: unknown reference")

// ErrInvalid is returned by Validate.
var ErrInvalid = errors.New("fixtures: invalid catalog")

// Unit kinds (org.units.kind) and role kinds (access.roles.kind).
const (
	KindRegion       = "region"
	KindCompany      = "company"
	RoleKindTemplate = "template"
	RoleKindCustom   = "custom"
)

// Kinds of objects an object-bound grant names (access.role_assignments.scope_kind with a scope_ref). The kinds of stages
// 4–7 (W4.02, tenant 0020) give nothing until the evaluator registers them (ADR-0014 п. 3).
const (
	ObjectProject       = "project"
	ObjectWarehouse     = "warehouse"
	ObjectResource      = "resource"
	ObjectSpace         = "space"
	ObjectPage          = "page"
	ObjectFolder        = "folder"
	ObjectDoc           = "doc"
	ObjectAccount       = "cash_account" // scope_kind account; the reference kind account is an actor's account
	ObjectChat          = "chat"
	ObjectRepairProject = "repair_project"
)

var (
	unitKinds   = []string{KindRegion, KindCompany, "branch", "team"}
	functions   = []string{"driver", "therapist", "foreman", "worker", "dispatcher"}
	roleKinds   = []string{"system", RoleKindTemplate, RoleKindCustom}
	objectKinds = []string{ObjectProject, ObjectWarehouse, ObjectResource, ObjectSpace, ObjectPage, ObjectFolder, ObjectDoc,
		ObjectAccount, ObjectChat, ObjectRepairProject}
	operatorRoles = []string{"owner", "admin", "billing", "support"}
)

// Reference kinds.
const (
	refTenant     = "tenant"
	refUnit       = "unit"
	refRole       = "role"
	refGroup      = "group"
	refAccount    = "account"
	refPerson     = "person"
	refMembership = "membership"
	// Content of the modules (W1.44).
	refImport       = "import"
	refVehicle      = "vehicle"
	refFile         = "file"
	refNotification = "notification"
	// Tier requests of the control DB (W4.60).
	refRequest = "subscription_request"
)

// localKinds are the reference kinds <kind>:<tenant>.<key>.
var localKinds = []string{
	refUnit, refRole, refGroup, ObjectProject, ObjectWarehouse, ObjectResource, ObjectSpace, ObjectPage, ObjectFolder,
	ObjectDoc, ObjectAccount, ObjectChat, ObjectRepairProject,
	refImport, refVehicle, refFile, refNotification, refRequest, refTask, refAutomation,
}

func tenantRef(t string) string              { return refTenant + ":" + t }
func localRef(kind, t, key string) string    { return kind + ":" + t + "." + key }
func memberRef(kind, actor, t string) string { return kind + ":" + actor + "@" + t }
func accountRef(actor string) string         { return refAccount + ":" + actor }

// ID returns the stable UUID of a reference:
//
//	tenant:<t> · unit:<t>.<unit> · role:<t>.<role> · group:<t>.<group>
//	project:<t>.<key> · warehouse:<t>.<key> · resource:<t>.<key>
//	space:<t>.<key> · page:<t>.<key> · folder:<t>.<key> · doc:<t>.<key> · cash_account:<t>.<key> · chat:<t>.<key>
//	repair_project:<t>.<key>
//	import:<t>.<key> · vehicle:<t>.<key> · file:<t>.<key> · notification:<t>.<key>
//	subscription_request:<t>.<key>
//	account:<actor> · person:<actor>@<t> · membership:<actor>@<t>
//	tenant:missing (MissingTenant) — a tenant of no database
//
// UUIDs are version 5 of «ortus:isolation:<reference>» in the URL namespace (as PD-30 for the seed).
func (c Catalog) ID(ref string) (uuid.UUID, error) {
	if ref != MissingTenant && !c.hasRef(ref) {
		return uuid.Nil, fmt.Errorf("%w %q", ErrUnknownRef, ref)
	}
	return nameID(ref), nil
}

// Refs returns every reference of the catalog in a stable order.
func (c Catalog) Refs() []string {
	var out []string
	for _, t := range c.Tenants {
		out = append(out, tenantRef(t.Key))
		for _, u := range t.Units {
			out = append(out, localRef(refUnit, t.Key, u.Key))
		}
		for _, r := range t.Roles {
			out = append(out, localRef(refRole, t.Key, r.Key))
		}
		for _, g := range t.Groups {
			out = append(out, localRef(refGroup, t.Key, g.Key))
		}
		for _, o := range t.Objects {
			out = append(out, localRef(o.Kind, t.Key, o.Key))
		}
		out = append(out, t.Content.refs(t.Key)...)
		for _, r := range t.Requests {
			out = append(out, localRef(refRequest, t.Key, r.Key))
		}
	}
	for _, a := range c.Actors {
		out = append(out, accountRef(a.Key))
		for _, m := range a.Memberships {
			out = append(out, memberRef(refPerson, a.Key, m.Tenant), memberRef(refMembership, a.Key, m.Tenant))
		}
	}
	return out
}

// TenantIDs returns the UUIDs of every reference that belongs to tenant t (the tenant, its units, roles,
// groups, objects, content, and the people and memberships in it).
func (c Catalog) TenantIDs(t string) []uuid.UUID {
	var out []uuid.UUID
	for _, ref := range c.Refs() {
		if refTenantOf(ref) == t {
			out = append(out, nameID(ref))
		}
	}
	return out
}

// HasActor reports whether key names an actor of the catalog (Anonymous is not one).
func (c Catalog) HasActor(key string) bool {
	_, ok := c.actor(key)
	return ok
}

// Actor resolves an actor key.
func (c Catalog) Actor(key string) (Actor, error) {
	a, ok := c.actor(key)
	if !ok {
		return Actor{}, fmt.Errorf("%w: actor %q", ErrUnknownRef, key)
	}
	out := Actor{
		Key: a.Key, Name: a.Name, Issuer: IssuerDev, Subject: subject(a.Key), AccountID: nameID(accountRef(a.Key)),
		Operator: a.Operator != "",
	}
	for _, m := range a.Memberships {
		out.Memberships = append(out.Memberships, Membership{
			Tenant:       m.Tenant,
			TenantID:     nameID(tenantRef(m.Tenant)),
			MembershipID: nameID(memberRef(refMembership, a.Key, m.Tenant)),
			PersonID:     nameID(memberRef(refPerson, a.Key, m.Tenant)),
			Owner:        m.Owner,
		})
	}
	return out, nil
}

// failFunc collects a validation error.
type failFunc func(format string, args ...any)

// Validate checks the internal consistency of the catalog.
func (c Catalog) Validate() error {
	var errs []error
	fail := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	c.validateTenants(fail)
	c.validateActors(fail)
	if len(errs) > 0 {
		return fmt.Errorf("%w: %w", ErrInvalid, errors.Join(errs...))
	}
	return nil
}

func (c Catalog) validateTenants(fail failFunc) {
	seen := map[string]bool{}
	for _, t := range c.Tenants {
		if t.Key == "" || seen[t.Key] {
			fail("tenant %q: duplicate or empty key", t.Key)
		}
		seen[t.Key] = true
		validateUnits(t, fail)
		validateRoles(t, fail)
		validateObjects(t, fail)
		validateGroups(t, fail)
		c.validateContent(t, fail)
		c.validateRequests(t, fail)
		if !c.hasOwner(t.Key) {
			fail("tenant %s: no owner", t.Key)
		}
	}
}

func (c Catalog) hasOwner(t string) bool {
	return slices.ContainsFunc(c.Actors, func(a ActorDef) bool {
		return slices.ContainsFunc(a.Memberships, func(m MemberDef) bool { return m.Tenant == t && m.Owner })
	})
}

func (c Catalog) validateActors(fail failFunc) {
	seen := map[string]bool{}
	for _, a := range c.Actors {
		switch {
		case a.Key == Anonymous:
			fail("actor %q: the key is reserved", a.Key)
		case a.Key == "" || strings.ContainsAny(a.Key, "@: ") || seen[a.Key]:
			fail("actor %q: duplicate or malformed key", a.Key)
		}
		seen[a.Key] = true
		if a.Operator != "" {
			validateOperator(a, fail)
			continue
		}
		tenants := map[string]bool{}
		for _, m := range a.Memberships {
			if tenants[m.Tenant] {
				fail("actor %s: duplicate membership in tenant %s", a.Key, m.Tenant)
			}
			tenants[m.Tenant] = true
			c.validateMember(a.Key, m, fail)
		}
	}
}

func validateUnits(t TenantDef, fail failFunc) {
	units := map[string]bool{}
	for _, u := range t.Units {
		switch {
		case u.Key == "" || units[u.Key]:
			fail("tenant %s: duplicate unit %q", t.Key, u.Key)
		case !slices.Contains(unitKinds, u.Kind):
			fail("unit %s.%s: kind %q is not one of %v", t.Key, u.Key, u.Kind, unitKinds)
		case u.Parent != "" && !units[u.Parent]:
			fail("unit %s.%s: parent %q is not defined before it", t.Key, u.Key, u.Parent)
		}
		units[u.Key] = true
	}
}

func validateRoles(t TenantDef, fail failFunc) {
	roles := map[string]bool{}
	for _, r := range t.Roles {
		switch {
		case r.Key == "" || roles[r.Key]:
			fail("tenant %s: duplicate role %q", t.Key, r.Key)
		case !slices.Contains(roleKinds, r.Kind):
			fail("role %s.%s: kind %q", t.Key, r.Key, r.Kind)
		case len(r.Actions) == 0 || slices.Contains(r.Actions, "*"):
			fail("role %s.%s: actions must be explicit (no wildcard, A-05)", t.Key, r.Key)
		}
		roles[r.Key] = true
	}
}

func validateOperator(a ActorDef, fail failFunc) {
	if !slices.Contains(operatorRoles, a.Operator) {
		fail("actor %s: operator role %q is not one of %v", a.Key, a.Operator, operatorRoles)
	}
	if len(a.Memberships) > 0 {
		fail("actor %s: an operator has no memberships (separate realm of platform operators)", a.Key)
	}
}

func validateObjects(t TenantDef, fail failFunc) {
	seen := map[string]bool{}
	for _, o := range t.Objects {
		key := o.Kind + ":" + o.Key
		switch {
		case !slices.Contains(objectKinds, o.Kind):
			fail("object %s.%s: kind %q is not one of %v", t.Key, o.Key, o.Kind, objectKinds)
		case o.Key == "" || strings.ContainsAny(o.Key, ".:@ ") || seen[key]:
			fail("tenant %s: duplicate or malformed object %q", t.Key, key)
		}
		seen[key] = true
	}
}

func validateGroups(t TenantDef, fail failFunc) {
	groups := map[string]bool{}
	for _, g := range t.Groups {
		if g.Key == "" || groups[g.Key] {
			fail("tenant %s: duplicate group %q", t.Key, g.Key)
		}
		groups[g.Key] = true
		for _, gr := range g.Grants {
			validateGrant("group "+t.Key+"."+g.Key, gr, t, fail)
		}
	}
}

func (c Catalog) validateMember(actor string, m MemberDef, fail failFunc) {
	t, ok := c.tenant(m.Tenant)
	if !ok {
		fail("actor %s: unknown tenant %q", actor, m.Tenant)
		return
	}
	if !t.hasUnit(m.Home) {
		fail("actor %s@%s: unknown home unit %q", actor, m.Tenant, m.Home)
	}
	if m.Function != "" && !slices.Contains(functions, m.Function) {
		fail("actor %s@%s: function %q is not one of %v", actor, m.Tenant, m.Function, functions)
	}
	for _, g := range m.Grants {
		validateGrant("actor "+actor+"@"+m.Tenant, g, t, fail)
	}
	for _, g := range m.Groups {
		if !t.hasGroup(g) {
			fail("actor %s@%s: unknown group %q", actor, m.Tenant, g)
		}
	}
}

func validateGrant(who string, g GrantDef, t TenantDef, fail failFunc) {
	if !t.hasRole(g.Role) {
		fail("%s: unknown role %q", who, g.Role)
	}
	if !slices.Contains(periods, g.Period) {
		fail("%s: period %q is not one of %q", who, g.Period, periods)
	}
	if g.Scope == ScopeTenant || g.Scope == ScopeSelf || g.Scope == ScopeRelation || t.hasUnit(g.Scope) {
		return
	}
	if kind, key, ok := strings.Cut(g.Scope, ":"); ok && t.hasObject(kind, key) {
		return
	}
	fail("%s: unknown scope %q (tenant, self, relation, a unit key or <kind>:<object key>)", who, g.Scope)
}

func (c Catalog) hasRef(ref string) bool {
	kind, key, ok := strings.Cut(ref, ":")
	if !ok || key == "" {
		return false
	}
	switch kind {
	case refTenant:
		_, ok := c.tenant(key)
		return ok
	case refAccount:
		return c.HasActor(key)
	case refPerson, refMembership:
		actor, tk, ok := strings.Cut(key, "@")
		a, found := c.actor(actor)
		return ok && found && slices.ContainsFunc(a.Memberships, func(m MemberDef) bool { return m.Tenant == tk })
	}
	if slices.Contains(localKinds, kind) {
		tk, local, ok := strings.Cut(key, ".")
		t, found := c.tenant(tk)
		return ok && found && t.hasLocal(kind, local)
	}
	return false
}

func (c Catalog) tenant(key string) (TenantDef, bool) {
	i := slices.IndexFunc(c.Tenants, func(t TenantDef) bool { return t.Key == key })
	if i < 0 {
		return TenantDef{}, false
	}
	return c.Tenants[i], true
}

func (c Catalog) actor(key string) (ActorDef, bool) {
	i := slices.IndexFunc(c.Actors, func(a ActorDef) bool { return a.Key == key })
	if i < 0 {
		return ActorDef{}, false
	}
	return c.Actors[i], true
}

func (t TenantDef) hasLocal(kind, key string) bool {
	switch kind {
	case refUnit:
		return t.hasUnit(key)
	case refRole:
		return t.hasRole(key)
	case refGroup:
		return t.hasGroup(key)
	case refImport, refVehicle, refFile, refNotification, refTask, refAutomation:
		return t.Content.has(kind, key)
	case refRequest:
		return slices.ContainsFunc(t.Requests, func(r RequestDef) bool { return r.Key == key })
	default:
		return t.hasObject(kind, key)
	}
}

func (t TenantDef) hasUnit(key string) bool {
	return slices.ContainsFunc(t.Units, func(u UnitDef) bool { return u.Key == key })
}

func (t TenantDef) hasRole(key string) bool {
	return slices.ContainsFunc(t.Roles, func(r RoleDef) bool { return r.Key == key })
}

func (t TenantDef) hasGroup(key string) bool {
	return slices.ContainsFunc(t.Groups, func(g GroupDef) bool { return g.Key == key })
}

func (t TenantDef) hasObject(kind, key string) bool {
	return slices.ContainsFunc(t.Objects, func(o ObjectDef) bool { return o.Kind == kind && o.Key == key })
}

// refTenantOf returns the tenant a reference belongs to ("" for accounts, which live in the control DB only).
func refTenantOf(ref string) string {
	kind, key, _ := strings.Cut(ref, ":")
	switch kind {
	case refTenant:
		return key
	case refPerson, refMembership:
		_, t, _ := strings.Cut(key, "@")
		return t
	}
	if slices.Contains(localKinds, kind) {
		t, _, _ := strings.Cut(key, ".")
		return t
	}
	return ""
}

func nameID(name string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:isolation:"+name))
}

func subject(actor string) string { return "iso-" + actor }
