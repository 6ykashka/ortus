// Package assignments is the role assignments and the owners of the access module (W1.06): listAssignments,
// createAssignment, revokeAssignment (S1-13: a scope and a period, the delegation check of AUTH-08, the conflict of
// the work function driver D-10, the last owner) and listOwners, transferOwnership, revokeOwnership (S1-16: owner
// bindings of the control DB under FOR UPDATE of the tenant row). Its subpackage kit is shared by the whole module.
package assignments

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the operations.
const (
	actionRead       = "roles.read"
	actionMembers    = "members.read"
	targetAssignment = "access.assignment"
	principalPerson  = "person"
	principalGroup   = "group"
	templateOwner    = "owner"
	kindSystem       = "system"
	stateActive      = "active"
	keyPrincipal     = "principalId"
	keyRole          = "roleId"
)

// Texts of the server (prototype ortus/api.js:412–421, contract examples).
const (
	detailPeriodEnded    = "Срок назначения уже прошёл."
	detailPeriodInverted = "Срок окончания раньше начала."
	detailSystemRole     = "Системную роль не назначают: владение передаётся отдельно."
	detailLastOwnerRole  = "Нельзя снять роль с последнего владельца"
)

// Handler implements the assignment and owner operations of accessapi.StrictServerInterface.
type Handler struct {
	d    kit.Deps
	mail InvitationMail // W1.41: the letters of inviteMember; nil — none (invite.go)
}

// New returns the handler over d.
func New(d kit.Deps) *Handler { return &Handler{d: d} }

// assignment is a row of access.role_assignments with its anchor.
type assignment struct {
	ID            uuid.UUID
	PrincipalKind string
	Principal     uuid.UUID
	Role          uuid.UUID
	Scope         authz.Scope
	From          *time.Time
	Until         *time.Time
	State         string
	Created       time.Time
	Anchor        *uuid.UUID
	roleVersion   int64       // version of the role a new assignment gets
	sensitivity   string      // highest sensitivity of the role's actions (audit)
	people        []uuid.UUID // the people the principal reaches (policy event)
}

func (a assignment) api(now time.Time) accessapi.Assignment {
	out := accessapi.Assignment{
		Id: a.ID, PrincipalType: accessapi.AssignmentPrincipalTypeMember, PrincipalId: a.Principal, RoleId: a.Role,
		Scope: kit.ScopeToAPI(a.Scope), ValidFrom: utc(a.From), ValidUntil: utc(a.Until), State: accessapi.AssignmentStateActive,
	}
	if a.PrincipalKind == principalGroup {
		out.PrincipalType = accessapi.AssignmentPrincipalTypeGroup
	}
	switch {
	case a.State == "dormant":
		out.State = accessapi.AssignmentStateDormant
	case a.Until != nil && !now.Before(*a.Until):
		out.State = accessapi.AssignmentStateExpired
	}
	return out
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// anchorUnit is the unit the assignment is seen through (uuid.Nil: the tenant).
func (a assignment) anchorUnit() uuid.UUID {
	if a.Anchor == nil {
		return uuid.Nil
	}
	return *a.Anchor
}

var selectAssignments = `select x.id, x.principal_kind, x.principal_id, x.role_id, x.scope_kind, x.scope_ref, x.include_descendants,
       lower(x.valid), upper(x.valid), x.state, x.created_at, x.anchor
  from (select ra.*, ` + kit.Anchor("ra") + ` as anchor from access.role_assignments ra) x
 where x.state <> 'revoked'`

func scanAssignment(row pgx.Row) (assignment, error) {
	var (
		a   assignment
		ref *uuid.UUID
	)
	err := row.Scan(&a.ID, &a.PrincipalKind, &a.Principal, &a.Role, &a.Scope.Kind, &ref, &a.Scope.Descendants, &a.From, &a.Until,
		&a.State, &a.Created, &a.Anchor)
	if ref != nil {
		a.Scope.Ref = *ref
	}
	return a, err
}

// ListAssignments implements accessapi.StrictServerInterface: the assignments the actor sees with roles.read over
// their anchor (scopeddb), revoked ones excluded, by creation.
func (h *Handler) ListAssignments(ctx context.Context, req accessapi.ListAssignmentsRequestObject) (accessapi.ListAssignmentsResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	limit, err := kit.Limit(req.Params.Limit)
	if err != nil {
		return nil, err
	}
	after, err := kit.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	from, id := time.Time{}, uuid.Nil
	if after != nil {
		if from, err = time.Parse(time.RFC3339Nano, after.Key); err != nil {
			return nil, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		id = after.ID
	}
	conn, err := h.d.Scoped(ctx, tc, h.d.Evaluator)
	if err != nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, actionRead, authz.Columns{Unit: "x.anchor"}, selectAssignments+` and {{scope}}
		and (x.created_at, x.id) > ($1, $2) order by x.created_at, x.id limit $3`, from, id, limit+1)
	if err != nil {
		return nil, kit.Store("assignments", err)
	}
	items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (assignment, error) { return scanAssignment(r) })
	if err != nil {
		return nil, kit.Store("assignments", err)
	}
	now := h.d.Clock()
	page := accessapi.AssignmentPage{Items: make([]accessapi.Assignment, 0, min(len(items), limit))}
	for i, a := range items {
		if i == limit {
			last := items[i-1]
			next := kit.Cursor{Key: last.Created.UTC().Format(time.RFC3339Nano), ID: last.ID}.Encode()
			page.NextCursor = &next
			break
		}
		page.Items = append(page.Items, a.api(now))
	}
	cc, rid := kit.Meta(ctx)
	return accessapi.ListAssignments200JSONResponse{Body: page, Headers: accessapi.ListAssignments200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// roleRow is what an assignment needs of its role.
type roleRow struct {
	Kind, Template string
	Version        int64
	Actions        []string
}

func loadRole(ctx context.Context, q kit.DB, id uuid.UUID) (roleRow, error) {
	var r roleRow
	err := q.QueryRow(ctx, `select r.kind, coalesce(r.template_key, ''), r.current_version, v.actions
		  from access.roles r join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		 where r.id = $1 and r.archived_at is null`, id).Scan(&r.Kind, &r.Template, &r.Version, &r.Actions)
	switch {
	case kit.NoRows(err):
		return roleRow{}, kit.NotFound()
	case err != nil:
		return roleRow{}, kit.Store("role", err)
	}
	return r, nil
}

// persons returns the people a principal reaches: the person, or the members of a live group.
func persons(ctx context.Context, q kit.DB, group bool, id uuid.UUID) ([]uuid.UUID, error) {
	if !group {
		return []uuid.UUID{id}, nil
	}
	rows, err := q.Query(ctx, `select person_id from access.group_members where group_id = $1 order by person_id`, id)
	if err != nil {
		return nil, kit.Store("group members", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	return out, kit.Store("group members", err)
}

// period validates [validFrom, validUntil): from defaults to now; the end must be after the start and after now.
func period(now time.Time, from, until *time.Time) (time.Time, *time.Time, error) {
	start := now
	if from != nil {
		start = from.UTC()
	}
	if until == nil {
		return start, nil, nil
	}
	end := until.UTC()
	switch {
	case !end.After(start):
		return time.Time{}, nil, kit.Validation(detailPeriodInverted)
	case !end.After(now):
		return time.Time{}, nil, kit.Validation(detailPeriodEnded)
	}
	return start, &end, nil
}

// visible requires that the actor sees the principal (members.read over its home unit; a tenant-wide group — over
// the tenant): an invisible principal is 404, like one that does not exist.
func visible(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, home uuid.UUID) error {
	ok, err := kit.Covers(ctx, ev, tc, actionMembers, home)
	switch {
	case err != nil:
		return err
	case !ok:
		return kit.NotFound()
	}
	return nil
}

// CreateAssignment implements accessapi.StrictServerInterface.
func (h *Handler) CreateAssignment(ctx context.Context, req accessapi.CreateAssignmentRequestObject) (accessapi.CreateAssignmentResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	body := *req.Body
	scope, err := kit.ScopeFromAPI(body.Scope)
	if err != nil {
		return nil, err
	}
	now := h.d.Clock()
	from, until, err := period(now, body.ValidFrom, body.ValidUntil)
	if err != nil {
		return nil, err
	}
	group := body.PrincipalType == accessapi.AssignmentCreatePrincipalTypeGroup
	if !group && body.PrincipalType != accessapi.AssignmentCreatePrincipalTypeMember {
		return nil, kit.Validation("principalType: member или group")
	}
	a := assignment{ID: uuid.New(), PrincipalKind: principalPerson, Principal: body.PrincipalId, Role: body.RoleId, Scope: scope,
		From: &from, Until: until, State: stateActive}
	if group {
		a.PrincipalKind = principalGroup
	}
	var out accessapi.Assignment
	reached := func(q kit.DB) ([]uuid.UUID, error) { return persons(ctx, q, group, a.Principal) }
	err = h.d.InPeopleTx(ctx, tc, reached, func(tx pgx.Tx) error {
		unit, err := h.authorizeNew(ctx, tx, tc, &a)
		if err != nil {
			return err
		}
		if err := insert(ctx, tx, tc, a); err != nil {
			return err
		}
		out = a.api(now)
		return h.recordGrant(ctx, tx, tc, a, unit, out)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.CreateAssignment201JSONResponse{Body: out, Headers: accessapi.CreateAssignment201ResponseHeaders{
		CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// authorizeNew checks a new assignment in tx: role, principal and unit exist and are visible, delegation, D-10.
// It returns the unit of the audit record.
func (h *Handler) authorizeNew(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a *assignment) (uuid.UUID, error) {
	r, err := loadRole(ctx, tx, a.Role)
	if err != nil {
		return uuid.Nil, err
	}
	if r.Kind == kindSystem {
		return uuid.Nil, kit.Conflict(kit.CodeInvalidTransition, detailSystemRole)
	}
	group := a.PrincipalKind == principalGroup
	home, err := kit.HomeUnit(ctx, tx, group, a.Principal)
	if err != nil {
		return uuid.Nil, err
	}
	ev := kit.Request(h.d.Evaluator)
	if err := visible(ctx, ev, tc, home); err != nil {
		return uuid.Nil, err
	}
	unit := home
	if a.Scope.Kind == authz.KindUnit {
		if err := kit.UnitExists(ctx, tx, a.Scope.Ref); err != nil {
			return uuid.Nil, err
		}
		unit = a.Scope.Ref
	}
	people, err := persons(ctx, tx, group, a.Principal)
	if err != nil {
		return uuid.Nil, err
	}
	targets, err := kit.Reach(ctx, tx, a.Scope, home, people)
	if err != nil {
		return uuid.Nil, err
	}
	if err := kit.Delegate(ctx, ev, tc, r.Actions, targets, ""); err != nil {
		return uuid.Nil, err
	}
	if err := kit.Separation(ctx, tx, h.d.Evaluator.Policy, r.Actions, r.Template, people, *a.From, a.Until); err != nil {
		return uuid.Nil, err
	}
	a.Scope.Descendants = a.Scope.Kind == authz.KindTenant || a.Scope.Descendants
	a.Created = h.d.Clock()
	a.State = stateActive
	a.Anchor = nil
	a.roleVersion = r.Version
	a.sensitivity = kit.MaxSensitivity(r.Actions)
	a.people = people
	return unit, nil
}

func insert(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a assignment) error {
	return insertState(ctx, tx, tc, a, stateActive)
}

// insertState writes a new assignment in state (active; dormant — an invitation, activated on its acceptance).
func insertState(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a assignment, state string) error {
	var ref *uuid.UUID
	if a.Scope.Ref != uuid.Nil {
		ref = &a.Scope.Ref
	}
	_, err := tx.Exec(ctx, `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, state, source, granted_by, created_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, tstzrange($9::timestamptz, $10::timestamptz), $13, 'manual', $11, $12)`,
		a.ID, a.PrincipalKind, a.Principal, a.Role, a.roleVersion, a.Scope.Kind, ref, a.Scope.Descendants, a.From, a.Until,
		tc.PersonID, a.Created, state)
	return kit.Store("insert assignment", err)
}

// recordGrant bumps the policy version, publishes access.assignment.granted.v1, records the audit and the outcome.
func (h *Handler) recordGrant(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a assignment, unit uuid.UUID, body accessapi.Assignment) error {
	if err := bumpFor(ctx, tx, tc, a.people, "access.assignment.create"); err != nil {
		return err
	}
	payload := map[string]any{"assignmentId": a.ID, "principalType": a.PrincipalKind, keyPrincipal: a.Principal, keyRole: a.Role}
	if err := kit.Publish(ctx, tx, kit.EventAssignmentGranted, kit.AggregateAssignment, a.ID, payload); err != nil {
		return err
	}
	level := a.sensitivity
	if level == kit.Normal {
		level = kit.Sensitive
	}
	if err := kit.Audit(ctx, tx, kit.Change{Action: "access.assignment.create", TargetType: targetAssignment, TargetID: a.ID,
		UnitID: unit, Sensitivity: level, Diff: map[string]any{"principalType": a.PrincipalKind, keyPrincipal: a.Principal,
			keyRole: a.Role, "scope": a.Scope.Kind, "validUntil": a.Until}}); err != nil {
		return err
	}
	return kit.Complete(ctx, tx, http.StatusCreated, "", body)
}

// bumpFor raises the policy version for the people whose rights an assignment changes. An empty group changes no
// one's rights: no bump, no event (an empty personIds would send context.changed to every member, realtime of W1.07).
func bumpFor(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, people []uuid.UUID, reason string) error {
	if len(people) == 0 {
		return nil
	}
	_, err := kit.BumpPolicy(ctx, tx, tc.TenantID, people, reason)
	return err
}
