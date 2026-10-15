// Package explain is «Почему доступно» of the access module (W1.06, S1-14, AUTH-04): explainAccess runs the checks
// of x-authorization-order for a member, a permission and optionally an org unit or an object, up to the first one
// that fails, takes the decision from the evaluator of W1.04 (Evaluator.Explain) and lists every grant of the member
// that carries the permission with the reason it matches or not — PD-53 included. Grants outside the scope of the
// actor are never listed: they only set hiddenGrants. A member, a unit or an object the actor does not see is 404.
package explain

import (
	"context"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// actionRead is the permission of the operation: the actor sees members and grants over which it reads roles.
const actionRead = "roles.read"

// Texts of the checks (the prototype «Проверка доступа», analysis 02 §6.8; contract examples).
const (
	detailNoMembership = "У сотрудника нет активного членства в организации: войти и работать он не может."
	detailReadOnly     = "Организация в режиме только чтения: новые операции закрыты."
	detailModuleOff    = "Модуль не подключён организацией. Подключить его может владелец бизнеса."
	detailDriver       = "Действующая функция «Водитель» запрещает начисления через любую роль и группу."
	detailNoRole       = "Ни одна роль сотрудника не разрешает это действие."
	detailProjectOnly  = "Право есть только в роли на проект: без задачи этого проекта оно не действует (PD-53)."
	detailObjectOnly   = "Право есть только в роли на объект: без этого объекта оно не действует (PD-53)."
	detailOtherObject  = "Право есть только в роли на другой объект."
	detailOutOfScope   = "Право есть, но объект находится вне области назначения."
	detailUnknownRight = "Такого права нет в каталоге."
	detailHiddenOnly   = "Среди видимых вам назначений сотрудника нет подходящих: остальные вне вашей области."
	detailObjectParams = "Объект задают вместе: objectModule, objectType и objectId."
	detailObjectKind   = "Объяснение для объектов этого вида появится вместе с модулем."
	ownerRoleName      = "Владелец бизнеса"
)

var permissionRE = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)

// objectKinds maps objects of the contract (moduleKey/entityType) to the object-bound scope kinds of stage 1.
var objectKinds = map[[2]string]string{
	{"tasks", "project"}:           authz.KindProject,
	{"inventory", "warehouse"}:     authz.KindWarehouse,
	{"fleet", "resource_pool"}:     authz.KindResource,
	{"logistics", "resource_pool"}: authz.KindResource,
}

// Handler implements explainAccess of accessapi.StrictServerInterface.
type Handler struct{ d kit.Deps }

// New returns the handler over d.
func New(d kit.Deps) *Handler { return &Handler{d: d} }

// request is a validated explainAccess.
type request struct {
	member     uuid.UUID
	permission string
	unit       *uuid.UUID
	object     *accessapi.ObjectRef
	resource   authz.Resource
}

func parse(p authz.Policy, q accessapi.ExplainAccessParams) (request, error) {
	r := request{member: q.MemberId, permission: q.Permission, unit: q.OrgUnitId}
	if !permissionRE.MatchString(q.Permission) || !p.Known(q.Permission) {
		return request{}, kit.Validation(detailUnknownRight)
	}
	if q.OrgUnitId != nil {
		r.resource.Unit = *q.OrgUnitId
	}
	switch n := countSet(q.ObjectModule != nil, q.ObjectType != nil, q.ObjectId != nil); n {
	case 0:
		return r, nil
	case 3:
	default:
		return request{}, kit.Validation(detailObjectParams)
	}
	kind, ok := objectKinds[[2]string{*q.ObjectModule, *q.ObjectType}]
	if !ok {
		return request{}, kit.Validation(detailObjectKind)
	}
	r.object = &accessapi.ObjectRef{ModuleKey: *q.ObjectModule, EntityType: *q.ObjectType, EntityId: *q.ObjectId}
	r.resource.Objects = map[string]uuid.UUID{kind: *q.ObjectId}
	return r, nil
}

func countSet(flags ...bool) int {
	n := 0
	for _, f := range flags {
		if f {
			n++
		}
	}
	return n
}

// ExplainAccess implements accessapi.StrictServerInterface.
func (h *Handler) ExplainAccess(ctx context.Context, req accessapi.ExplainAccessRequestObject) (accessapi.ExplainAccessResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	ev := kit.Request(h.d.Evaluator)
	r, err := parse(ev.Policy, req.Params)
	if err != nil {
		return nil, err
	}
	pool, err := h.d.Pool(ctx, tc)
	if err != nil {
		return nil, err
	}
	if err := h.visible(ctx, pool, ev, tc, r); err != nil {
		return nil, err
	}
	target, member, err := h.target(ctx, tc, r.member)
	if err != nil {
		return nil, err
	}
	x := accessapi.AccessExplanation{MemberId: r.member, Permission: r.permission, OrgUnitId: r.unit, Object: r.object,
		Checks: []accessapi.AccessCheck{}, Grants: []accessapi.AccessGrantTrace{}}
	list, seen, err := h.grants(ctx, pool, ev, tc, target.PersonID, r.permission)
	if err != nil {
		return nil, err
	}
	verdicts, err := h.decide(ctx, ev, tc, target, member, r, seen, &x)
	if err != nil {
		return nil, err
	}
	if err := h.traces(ctx, pool, ev, target, list, seen, verdicts, &x); err != nil {
		return nil, err
	}
	if x.PolicyVersion, err = kit.PolicyVersion(ctx, pool); err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	return accessapi.ExplainAccess200JSONResponse{Body: x, Headers: accessapi.ExplainAccess200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// visible requires that the actor reads roles over the home unit of the member, over the unit of the request and,
// for an object, over the whole tenant (objects have no tables in stage 1: their unit is unknown); 404 otherwise.
func (h *Handler) visible(ctx context.Context, q kit.DB, ev *authz.Evaluator, tc tenantctx.TenantContext, r request) error {
	home, err := kit.HomeUnit(ctx, q, false, r.member)
	if err != nil {
		return err
	}
	units := []uuid.UUID{home}
	if r.unit != nil {
		if err := kit.UnitExists(ctx, q, *r.unit); err != nil {
			return err
		}
		units = append(units, *r.unit)
	}
	if r.object != nil {
		units = append(units, uuid.Nil)
	}
	for _, u := range units {
		ok, err := kit.Covers(ctx, ev, tc, actionRead, u)
		switch {
		case err != nil:
			return err
		case !ok:
			return kit.NotFound()
		}
	}
	return nil
}

// membership is what the control DB says about the member.
type membership struct {
	active bool
}

// target returns the TenantContext of the member as the gateway would build it (owner — its active binding).
func (h *Handler) target(ctx context.Context, tc tenantctx.TenantContext, person uuid.UUID) (tenantctx.TenantContext, membership, error) {
	t := tenantctx.TenantContext{TenantID: tc.TenantID, PersonID: person}
	if h.d.Control == nil {
		return t, membership{}, kit.Unavailable(problem.New(problem.CodeDependencyUnavailable, "no control DB"))
	}
	var status string
	err := h.d.Control.QueryRow(ctx, `select m.id, m.account_id, m.status::text,
		       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
		  from memberships m where m.tenant_id = $1 and m.person_profile_id = $2`, tc.TenantID, person).
		Scan(&t.MembershipID, &t.AccountID, &status, &t.Owner)
	switch {
	case kit.NoRows(err):
		return t, membership{}, nil
	case err != nil:
		return t, membership{}, kit.Store("membership", err)
	}
	t.ReadOnly = tc.ReadOnly
	return t, membership{active: status == "active"}, nil
}

// decide appends the checks of x-authorization-order up to the first failed one and sets the decision.
func (h *Handler) decide(ctx context.Context, ev *authz.Evaluator, tc, target tenantctx.TenantContext, m membership, r request, seen map[uuid.UUID]bool, x *accessapi.AccessExplanation) (map[uuid.UUID]authz.GrantVerdict, error) {
	fail := func(step accessapi.AccessCheckStep, code, detail string) {
		x.Checks = append(x.Checks, accessapi.AccessCheck{Check: step, Passed: false, Detail: &detail})
		c := accessapi.ProblemCode(code)
		x.DecisiveCheck, x.DenyCode, x.Allowed = step, &c, false
	}
	pass := func(step accessapi.AccessCheckStep, detail string) {
		c := accessapi.AccessCheck{Check: step, Passed: true}
		if detail != "" {
			c.Detail = &detail
		}
		x.Checks = append(x.Checks, c)
	}
	if !m.active {
		fail(accessapi.TenantMembershipAndBinding, problem.CodeNotFound, detailNoMembership)
		return nil, nil
	}
	pass(accessapi.TenantMembershipAndBinding, "")
	readOnly := ""
	if tc.ReadOnly {
		readOnly = detailReadOnly
	}
	pass(accessapi.TenantState, readOnly)
	keys, err := ev.Source.InstalledModules(ctx, tc)
	if err != nil {
		return nil, kit.Unavailable(err)
	}
	if !authz.Installed(keys)[authz.ModuleOf(r.permission)] {
		fail(accessapi.ModuleInstallation, "module_not_installed", detailModuleOff)
		return nil, nil
	}
	pass(accessapi.ModuleInstallation, "")
	pass(accessapi.PlanEntitlement, "")
	sub, err := ev.Source.Subject(ctx, target, ev.Now(), false)
	if err != nil {
		return nil, kit.Unavailable(err)
	}
	explained, err := ev.Explain(ctx, target, r.permission, r.resource)
	if err != nil {
		return nil, err
	}
	verdicts := map[uuid.UUID]authz.GrantVerdict{}
	for _, v := range explained.Grants {
		verdicts[v.Grant.AssignmentID] = v
	}
	if ev.Policy.Blocked(r.permission, sub.Functions) {
		fail(accessapi.SeparationOfDuties, authz.CodeFunctionBlocked, detailDriver)
		return verdicts, nil
	}
	pass(accessapi.SeparationOfDuties, "")
	h.permission(explained, r, seen, fail, pass)
	if explained.Allowed {
		x.Allowed, x.DecisiveCheck = true, accessapi.Permission
	}
	return verdicts, nil
}

// permission appends «permission» (and «resource-scope» for a request with a unit or an object).
func (h *Handler) permission(x authz.Explanation, r request, seen map[uuid.UUID]bool, fail func(accessapi.AccessCheckStep, string, string), pass func(accessapi.AccessCheckStep, string)) {
	scoped := !r.resource.IsZero()
	if !scoped {
		if x.Allowed {
			pass(accessapi.Permission, "")
			return
		}
		fail(accessapi.Permission, problem.CodeForbiddenAction, reason(x, seen))
		return
	}
	if !x.Owner && len(x.Grants) == 0 {
		fail(accessapi.Permission, problem.CodeForbiddenAction, detailNoRole)
		return
	}
	pass(accessapi.Permission, "")
	if x.Allowed {
		pass(accessapi.ResourceScope, "")
		return
	}
	fail(accessapi.ResourceScope, problem.CodeForbiddenAction, reason(x, seen))
}

// reason explains a refusal by the mismatches of the grants that carry the permission and that the actor sees: a
// hidden grant never tells its kind (out of scope, a role on a project or an object) — only hiddenGrants does.
func reason(x authz.Explanation, seen map[uuid.UUID]bool) string {
	visible := make([]authz.GrantVerdict, 0, len(x.Grants))
	for _, v := range x.Grants {
		if seen[v.Grant.AssignmentID] {
			visible = append(visible, v)
		}
	}
	switch {
	case len(visible) == 0 && len(x.Grants) > 0:
		return detailHiddenOnly
	case len(visible) == 0:
		return detailNoRole
	}
	project, object, other := true, true, false
	for _, v := range visible {
		switch v.Mismatch {
		case authz.MismatchObjectWithoutObject:
			project = project && v.Grant.Scope.Kind == authz.KindProject
		case authz.MismatchOtherObject:
			other = true
			object, project = false, false
		default:
			object, project = false, false
		}
	}
	switch {
	case project:
		return detailProjectOnly
	case object:
		return detailObjectOnly
	case other:
		return detailOtherObject
	}
	return detailOutOfScope
}

// grantRow is an assignment of the member that carries the permission.
type grantRow struct {
	ID       uuid.UUID
	Role     uuid.UUID
	RoleName string
	Group    *uuid.UUID
	Source   string
	Scope    authz.Scope
	From     time.Time
	Until    *time.Time
	State    string
	Anchor   *uuid.UUID
}

// grantsSQL: assignments of the person ($1) directly and through live groups, not revoked, whose role version
// carries the permission ($2), with their anchor.
var grantsSQL = `select ra.id, ra.role_id, r.name, case when ra.principal_kind = 'group' then ra.principal_id end, ra.source,
       ra.scope_kind, ra.scope_ref, ra.include_descendants, coalesce(lower(ra.valid), ra.created_at), upper(ra.valid), ra.state, ` +
	kit.Anchor("ra") + `
  from access.role_assignments ra
  join access.roles r on r.id = ra.role_id
  join access.role_versions v on v.role_id = ra.role_id and v.version = ra.role_version
 where ra.state <> 'revoked' and $2 = any(v.actions)
   and ((ra.principal_kind = 'person' and ra.principal_id = $1)
     or (ra.principal_kind = 'group' and ra.principal_id in (
          select gm.group_id from access.group_members gm join access.groups g on g.id = gm.group_id and g.archived_at is null
           where gm.person_id = $1)))
 order by ra.created_at, ra.id`

// grants returns the assignments of the member that carry the permission and which of them the actor sees (roles.read
// over their anchor).
func (h *Handler) grants(ctx context.Context, q kit.DB, ev *authz.Evaluator, tc tenantctx.TenantContext, person uuid.UUID, permission string) ([]grantRow, map[uuid.UUID]bool, error) {
	rows, err := q.Query(ctx, grantsSQL, person, permission)
	if err != nil {
		return nil, nil, kit.Store("grants", err)
	}
	list, err := pgx.CollectRows(rows, scanGrant)
	if err != nil {
		return nil, nil, kit.Store("grants", err)
	}
	seen := make(map[uuid.UUID]bool, len(list))
	for _, g := range list {
		anchor := uuid.Nil
		if g.Anchor != nil {
			anchor = *g.Anchor
		}
		ok, err := kit.Covers(ctx, ev, tc, actionRead, anchor)
		if err != nil {
			return nil, nil, err
		}
		seen[g.ID] = ok
	}
	return list, seen, nil
}

// traces lists the grants of the member with the permission: the owner binding first, then the assignments the
// actor sees (the others only set hiddenGrants).
func (h *Handler) traces(ctx context.Context, q kit.DB, ev *authz.Evaluator, target tenantctx.TenantContext, list []grantRow, seen map[uuid.UUID]bool, verdicts map[uuid.UUID]authz.GrantVerdict, x *accessapi.AccessExplanation) error {
	blocked := false
	for _, c := range x.Checks {
		blocked = blocked || (c.Check == accessapi.SeparationOfDuties && !c.Passed)
	}
	if target.Owner {
		role, err := ownerRole(ctx, q)
		if err != nil {
			return err
		}
		t := accessapi.AccessGrantTrace{RoleId: role, RoleName: ownerRoleName, Via: accessapi.AccessGrantTraceViaOwner,
			Scope: kit.ScopeToAPI(authz.Scope{Kind: authz.KindTenant}), Matches: !blocked}
		if blocked {
			m := accessapi.AccessGrantTraceMismatchFunctionBlocked
			t.Mismatch = &m
		}
		x.Grants = append(x.Grants, t)
	}
	now := ev.Now()
	for _, g := range list {
		if !seen[g.ID] {
			x.HiddenGrants = true
			continue
		}
		x.Grants = append(x.Grants, trace(g, verdicts, blocked, now))
	}
	return nil
}

func scanGrant(row pgx.CollectableRow) (grantRow, error) {
	var (
		g   grantRow
		ref *uuid.UUID
	)
	err := row.Scan(&g.ID, &g.Role, &g.RoleName, &g.Group, &g.Source, &g.Scope.Kind, &ref, &g.Scope.Descendants, &g.From, &g.Until, &g.State, &g.Anchor)
	if ref != nil {
		g.Scope.Ref = *ref
	}
	return g, err
}

// trace is the line of one assignment: why it applies or not.
func trace(g grantRow, verdicts map[uuid.UUID]authz.GrantVerdict, blocked bool, now time.Time) accessapi.AccessGrantTrace {
	id := g.ID
	t := accessapi.AccessGrantTrace{AssignmentId: &id, RoleId: g.Role, RoleName: g.RoleName, Via: accessapi.AccessGrantTraceViaDirect,
		Scope: kit.ScopeToAPI(g.Scope)}
	switch {
	case g.Group != nil:
		t.Via, t.GroupId = accessapi.AccessGrantTraceViaGroup, g.Group
	case g.Source == "transfer":
		t.Via = accessapi.AccessGrantTraceViaTemporary
	}
	if g.Until != nil {
		u := g.Until.UTC()
		t.ValidUntil = &u
	}
	var mismatch string
	v, active := verdicts[g.ID]
	switch {
	case g.State == "dormant":
		mismatch = string(accessapi.AccessGrantTraceMismatchDormantModule)
	case now.Before(g.From) || (g.Until != nil && !now.Before(*g.Until)):
		mismatch = string(accessapi.AccessGrantTraceMismatchExpired)
	case blocked:
		mismatch = string(accessapi.AccessGrantTraceMismatchFunctionBlocked)
	case !active:
		mismatch = string(accessapi.AccessGrantTraceMismatchOutOfScope) // a kind of a later stage: gives nothing yet
	default:
		mismatch = v.Mismatch
	}
	t.Matches = mismatch == ""
	if !t.Matches {
		m := accessapi.AccessGrantTraceMismatch(mismatch)
		t.Mismatch = &m
	}
	return t
}

// ownerRole returns the id of the system role «Владелец бизнеса» of the tenant (uuid.Nil if the tenant has none):
// ownership itself is an owner binding, the role only names it.
func ownerRole(ctx context.Context, q kit.DB) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `select id from access.roles where kind = 'system' and template_key = 'owner' and archived_at is null
		order by created_at limit 1`).Scan(&id)
	switch {
	case kit.NoRows(err):
		return uuid.Nil, nil
	case err != nil:
		return uuid.Nil, kit.Store("owner role", err)
	}
	return id, nil
}
