package groups

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the group operations (contract examples, analysis 02 §6.5).
const (
	detailNameRequired = "Укажите название группы"
	detailNameTooLong  = "Название группы — не длиннее 100 символов"
	detailNameTaken    = "Группа с таким названием уже есть"
	detailDescription  = "Описание группы — не длиннее 1000 символов"
	detailDuplicate    = "Участник указан дважды"
	detailTooMany      = "В группе — не больше 500 участников"
	detailHasRoles     = "У группы «%s» есть назначения ролей. Сначала снимите их."
	detailDelegation   = "Группа даёт роль «%s», а у вас нет права назначать её в этой области."
	maxName            = 100
	maxDescription     = 1000
	maxMembers         = 500
	uniqueViolation    = "23505"
)

func validateName(name string) (string, error) {
	n := strings.TrimSpace(name)
	switch {
	case n == "":
		return "", kit.Validation(detailNameRequired)
	case utf8.RuneCountInString(n) > maxName:
		return "", kit.Validation(detailNameTooLong)
	}
	return n, nil
}

func validateDescription(d *string) (string, error) {
	if d == nil {
		return "", nil
	}
	if utf8.RuneCountInString(*d) > maxDescription {
		return "", kit.Validation(detailDescription)
	}
	return *d, nil
}

func nameTaken(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == uniqueViolation
}

// manages requires that the actor sees (members.read) and manages (members.manage) the home unit of a group (uuid.Nil:
// the tenant): a group the actor does not see is 404, like one that does not exist; one it only sees is 403.
func manages(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, home uuid.UUID) error {
	ok, err := kit.Covers(ctx, ev, tc, actionManage, home)
	if err != nil || ok {
		return err
	}
	if home == uuid.Nil {
		return kit.Forbidden() // the tenant itself is never «invisible»: a tenant-wide group needs a tenant grant
	}
	seen, err := kit.Covers(ctx, ev, tc, actionRead, home)
	switch {
	case err != nil:
		return err
	case seen:
		return kit.Forbidden()
	}
	return kit.NotFound()
}

// place checks a home unit of a new or moved group: it exists and the actor manages it.
func place(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, home *uuid.UUID) error {
	if home == nil {
		return manages(ctx, ev, tc, uuid.Nil)
	}
	if err := kit.UnitExists(ctx, tx, *home); err != nil {
		return err
	}
	return manages(ctx, ev, tc, *home)
}

// lock reads a live group for update (404 if there is none) and checks that the actor sees and manages it.
func lock(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, id uuid.UUID) (group, error) {
	var g group
	err := tx.QueryRow(ctx, `select id, name, description, home_unit_id, revision, created_at from access.groups
		where id = $1 and archived_at is null for update`, id).Scan(&g.ID, &g.Name, &g.Description, &g.Home, &g.Revision, &g.Created)
	switch {
	case kit.NoRows(err):
		return group{}, kit.NotFound()
	case err != nil:
		return group{}, kit.Store("group", err)
	}
	seen, err := kit.Covers(ctx, ev, tc, actionRead, g.home())
	switch {
	case err != nil:
		return group{}, err
	case !seen:
		return group{}, kit.NotFound()
	}
	return g, manages(ctx, ev, tc, g.home())
}

// command runs fn in a transaction of the tenant DB and answers the group as the actor sees it after the change,
// stored with the effect (Complete). people are the people the command may give the roles of the group to: they are
// locked before the policy row (kit.InPeopleTx, D-10).
func (h *Handler) command(ctx context.Context, status int, people []uuid.UUID, fn func(tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext) (uuid.UUID, error)) (accessapi.Group, string, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return accessapi.Group{}, "", err
	}
	var (
		out accessapi.Group
		tag string
	)
	locked := func(kit.DB) ([]uuid.UUID, error) { return people, nil }
	err = h.d.InPeopleTx(ctx, tc, locked, func(tx pgx.Tx) error {
		ev, err := kit.Within(ctx, h.d.Evaluator, tc, tx)
		if err != nil {
			return err
		}
		id, err := fn(tx, ev, tc)
		if err != nil {
			return err
		}
		if status == http.StatusNoContent {
			return kit.Complete(ctx, tx, status, "", nil)
		}
		g, err := h.read(ctx, kit.TxScope{Tx: tx, Ev: ev, TC: tc}, id)
		if err != nil {
			return err
		}
		out, tag = g.api(), kit.ETag(g.Revision)
		return kit.Complete(ctx, tx, status, tag, out)
	})
	return out, tag, err
}

func audit(ctx context.Context, tx pgx.Tx, action string, g group, diff map[string]any) error {
	return kit.Audit(ctx, tx, kit.Change{Action: "access.group." + action, TargetType: targetGroup, TargetID: g.ID, UnitID: g.home(), Diff: diff})
}

// CreateGroup implements accessapi.StrictServerInterface: an empty group (members — setGroupMembers).
func (h *Handler) CreateGroup(ctx context.Context, req accessapi.CreateGroupRequestObject) (accessapi.CreateGroupResponseObject, error) {
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	name, err := validateName(req.Body.Name)
	if err != nil {
		return nil, err
	}
	desc, err := validateDescription(req.Body.Description)
	if err != nil {
		return nil, err
	}
	out, tag, err := h.command(ctx, http.StatusCreated, nil, func(tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext) (uuid.UUID, error) {
		if err := place(ctx, tx, ev, tc, req.Body.HomeUnitId); err != nil {
			return uuid.Nil, err
		}
		g := group{ID: uuid.New(), Name: name, Description: desc, Home: req.Body.HomeUnitId}
		now := h.d.Clock()
		if _, err := tx.Exec(ctx, `insert into access.groups (id, name, description, home_unit_id, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $5)`, g.ID, name, desc, g.Home, now); err != nil {
			if nameTaken(err) {
				return uuid.Nil, kit.Validation(detailNameTaken)
			}
			return uuid.Nil, kit.Store("insert group", err)
		}
		return g.ID, audit(ctx, tx, "create", g, map[string]any{"name": name, "homeUnitId": g.Home})
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.CreateGroup201JSONResponse{Body: out, Headers: accessapi.CreateGroup201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// UpdateGroup implements accessapi.StrictServerInterface: a move needs manage scope over the old and the new home;
// the scopes of the role assignments of the group never change with it.
func (h *Handler) UpdateGroup(ctx context.Context, req accessapi.UpdateGroupRequestObject) (accessapi.UpdateGroupResponseObject, error) {
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	p := *req.Body
	out, tag, err := h.command(ctx, http.StatusOK, nil, func(tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext) (uuid.UUID, error) {
		g, err := lock(ctx, tx, ev, tc, req.GroupId)
		if err != nil {
			return uuid.Nil, err
		}
		if err := kit.IfMatch(req.Params.IfMatch, g.Revision); err != nil {
			return uuid.Nil, err
		}
		next, diff, err := patched(ctx, tx, ev, tc, g, p)
		if err != nil {
			return uuid.Nil, err
		}
		if _, err := tx.Exec(ctx, `update access.groups set name = $2, description = $3, home_unit_id = $4, revision = revision + 1,
			updated_at = $5 where id = $1`, g.ID, next.Name, next.Description, next.Home, h.d.Clock()); err != nil {
			if nameTaken(err) {
				return uuid.Nil, kit.Validation(detailNameTaken)
			}
			return uuid.Nil, kit.Store("update group", err)
		}
		return g.ID, audit(ctx, tx, "update", next, diff)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.UpdateGroup200JSONResponse{Body: out, Headers: accessapi.UpdateGroup200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// patched validates a patch of g. GroupPatch cannot carry homeUnitId: null apart from its absence (the generated type
// omits both), so a move to the whole tenant is not expressible yet (brief §10 п.16).
func patched(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, g group, p accessapi.GroupPatch) (group, map[string]any, error) {
	next, diff := g, map[string]any{}
	if p.Name != nil {
		name, err := validateName(*p.Name)
		if err != nil {
			return group{}, nil, err
		}
		next.Name, diff["name"] = name, name
	}
	if p.Description != nil {
		desc, err := validateDescription(p.Description)
		if err != nil {
			return group{}, nil, err
		}
		next.Description, diff["description"] = desc, desc
	}
	if p.HomeUnitId != nil && (g.Home == nil || *g.Home != *p.HomeUnitId) {
		if err := place(ctx, tx, ev, tc, p.HomeUnitId); err != nil {
			return group{}, nil, err
		}
		next.Home, diff["homeUnitId"], diff["previousHomeUnitId"] = p.HomeUnitId, *p.HomeUnitId, g.Home
	}
	return next, diff, nil
}

// liveRoles are the active and dormant, not ended assignments of a group with their roles.
type liveRole struct {
	Name     string
	Template string
	Actions  []string
	Scope    authz.Scope
	From     time.Time
	Until    *time.Time
}

func liveRoles(ctx context.Context, tx pgx.Tx, group uuid.UUID, now time.Time) ([]liveRole, error) {
	rows, err := tx.Query(ctx, `select r.name, coalesce(r.template_key, ''), v.actions, ra.scope_kind, ra.scope_ref,
		       ra.include_descendants, coalesce(lower(ra.valid), ra.created_at), upper(ra.valid)
		  from access.role_assignments ra
		  join access.roles r on r.id = ra.role_id
		  join access.role_versions v on v.role_id = ra.role_id and v.version = ra.role_version
		 where ra.principal_kind = 'group' and ra.principal_id = $1 and ra.state <> 'revoked'
		   and (upper_inf(ra.valid) or upper(ra.valid) > $2)
		 order by ra.created_at, ra.id`, group, now)
	if err != nil {
		return nil, kit.Store("group roles", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (liveRole, error) {
		var (
			l   liveRole
			ref *uuid.UUID
		)
		err := r.Scan(&l.Name, &l.Template, &l.Actions, &l.Scope.Kind, &ref, &l.Scope.Descendants, &l.From, &l.Until)
		if ref != nil {
			l.Scope.Ref = *ref
		}
		return l, err
	})
	return out, kit.Store("group roles", err)
}

// DeleteGroup implements accessapi.StrictServerInterface: archives a group without live role assignments (409
// otherwise: no member silently loses access). Membership history stays in the audit log.
func (h *Handler) DeleteGroup(ctx context.Context, req accessapi.DeleteGroupRequestObject) (accessapi.DeleteGroupResponseObject, error) {
	_, _, err := h.command(ctx, http.StatusNoContent, nil, func(tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext) (uuid.UUID, error) {
		g, err := lock(ctx, tx, ev, tc, req.GroupId)
		if err != nil {
			return uuid.Nil, err
		}
		if err := kit.IfMatch(req.Params.IfMatch, g.Revision); err != nil {
			return uuid.Nil, err
		}
		roles, err := liveRoles(ctx, tx, g.ID, h.d.Clock())
		if err != nil {
			return uuid.Nil, err
		}
		if len(roles) > 0 {
			return uuid.Nil, kit.Conflict(kit.CodeInvalidTransition, fmt.Sprintf(detailHasRoles, g.Name))
		}
		if _, err := tx.Exec(ctx, `update access.groups set archived_at = $2, revision = revision + 1, updated_at = $2 where id = $1`,
			g.ID, h.d.Clock()); err != nil {
			return uuid.Nil, kit.Store("archive group", err)
		}
		return g.ID, audit(ctx, tx, "archive", g, map[string]any{"name": g.Name})
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.DeleteGroup204Response{Headers: accessapi.DeleteGroup204ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// SetGroupMembers implements accessapi.StrictServerInterface: replaces the members the actor sees; the hidden ones
// stay. Every added member of a group with roles is checked as a direct assignment of each role (delegation, D-10).
func (h *Handler) SetGroupMembers(ctx context.Context, req accessapi.SetGroupMembersRequestObject) (accessapi.SetGroupMembersResponseObject, error) {
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	requested := req.Body.MemberIds
	if len(requested) > maxMembers {
		return nil, kit.Validation(detailTooMany)
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range requested {
		if seen[id] {
			return nil, kit.Validation(detailDuplicate)
		}
		seen[id] = true
	}
	out, tag, err := h.command(ctx, http.StatusOK, requested, func(tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext) (uuid.UUID, error) {
		g, err := lock(ctx, tx, ev, tc, req.GroupId)
		if err != nil {
			return uuid.Nil, err
		}
		if err := kit.IfMatch(req.Params.IfMatch, g.Revision); err != nil {
			return uuid.Nil, err
		}
		return g.ID, h.replaceMembers(ctx, tx, ev, tc, g, requested)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.SetGroupMembers200JSONResponse{Body: out, Headers: accessapi.SetGroupMembers200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// members returns the current members of a group split by visibility to the actor.
func members(ctx context.Context, s kit.Scoped, group uuid.UUID) (visible, hidden []uuid.UUID, err error) {
	rows, err := s.Query(ctx, actionRead, authz.Columns{Unit: "p.home_unit_id"}, `select gm.person_id, {{scope}}
		  from access.group_members gm join people.person_profiles p on p.id = gm.person_id
		 where gm.group_id = $1`, group)
	if err != nil {
		return nil, nil, kit.Store("group members", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			person uuid.UUID
			seen   bool
		)
		if err := rows.Scan(&person, &seen); err != nil {
			return nil, nil, kit.Store("group members", err)
		}
		if seen {
			visible = append(visible, person)
		} else {
			hidden = append(hidden, person)
		}
	}
	return visible, hidden, kit.Store("group members", rows.Err())
}

// newcomers requires that every added person is a live card the actor sees (404 otherwise).
func newcomers(ctx context.Context, s kit.Scoped, added []uuid.UUID) error {
	if len(added) == 0 {
		return nil
	}
	var n int
	err := s.QueryRow(ctx, actionRead, authz.Columns{Unit: "p.home_unit_id"}, `select count(*) from people.person_profiles p
		 where p.id = any($1) and p.archived_at is null and {{scope}}`, added).Scan(&n)
	switch {
	case err != nil:
		return kit.Store("new members", err)
	case n != len(added):
		return kit.NotFound()
	}
	return nil
}

// split returns the requested people the group lacks and the visible members the request drops (hidden members
// stay whatever the request says).
func split(requested, visible, hidden []uuid.UUID) (added, removed []uuid.UUID) {
	for _, p := range requested {
		if !slices.Contains(visible, p) && !slices.Contains(hidden, p) {
			added = append(added, p)
		}
	}
	for _, p := range visible {
		if !slices.Contains(requested, p) {
			removed = append(removed, p)
		}
	}
	return added, removed
}

func (h *Handler) replaceMembers(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, g group, requested []uuid.UUID) error {
	scope := kit.TxScope{Tx: tx, Ev: ev, TC: tc}
	visible, hidden, err := members(ctx, scope, g.ID)
	if err != nil {
		return err
	}
	added, removed := split(requested, visible, hidden)
	if err := newcomers(ctx, scope, added); err != nil {
		return err
	}
	now := h.d.Clock()
	roles, err := liveRoles(ctx, tx, g.ID, now)
	if err != nil {
		return err
	}
	if err := h.admit(ctx, tx, ev, tc, g, roles, added); err != nil {
		return err
	}
	if err := write(ctx, tx, tc, g.ID, added, removed, now); err != nil {
		return err
	}
	if len(roles) > 0 && len(added)+len(removed) > 0 {
		if _, err := kit.BumpPolicy(ctx, tx, tc.TenantID, slices.Concat(added, removed), "access.group.members_set"); err != nil {
			return err
		}
	}
	return audit(ctx, tx, "members_set", g, map[string]any{"added": added, "removed": removed})
}

// write applies a change of members and the next revision of the group.
func write(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, group uuid.UUID, added, removed []uuid.UUID, now time.Time) error {
	if _, err := tx.Exec(ctx, `delete from access.group_members where group_id = $1 and person_id = any($2)`, group, removed); err != nil {
		return kit.Store("remove members", err)
	}
	if _, err := tx.Exec(ctx, `insert into access.group_members (group_id, person_id, added_at, added_by)
		select $1, p, $3, $4 from unnest($2::uuid[]) as p`, group, added, now, tc.PersonID); err != nil {
		return kit.Store("add members", err)
	}
	_, err := tx.Exec(ctx, `update access.groups set revision = revision + 1, updated_at = $2 where id = $1`, group, now)
	return kit.Store("group revision", err)
}

// admit checks the added people against every live role of the group: the actor may give the role there
// (delegation) and none of them gets earnings with the work function driver or the reverse (D-10).
func (h *Handler) admit(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, g group, roles []liveRole, added []uuid.UUID) error {
	if len(added) == 0 {
		return nil
	}
	for _, r := range roles {
		targets, err := kit.Reach(ctx, tx, r.Scope, g.home(), added)
		if err != nil {
			return err
		}
		if err := kit.Delegate(ctx, ev, tc, r.Actions, targets, fmt.Sprintf(detailDelegation, r.Name)); err != nil {
			return err
		}
		if err := kit.Separation(ctx, tx, h.d.Evaluator.Policy, r.Actions, r.Template, added, r.From, r.Until); err != nil {
			return err
		}
	}
	return nil
}
