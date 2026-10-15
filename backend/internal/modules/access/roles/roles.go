// Package roles is the role editor of the access module (W1.06, S1-12, AUTH-03): listRoles, getRole, createRole
// (an empty role included), updateRole, deleteRole of the tag Access. Keys come only from the permission catalog;
// sensitive and restricted keys are kept apart in the audit; a member puts into a role only rights it holds itself
// (AUTH-08); the role «Водитель» and a role held by a driver never get earnings (D-10). A change of the rights of a
// role moves its live assignments to the new version and bumps the policy version.
package roles

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the operations.
const (
	actionRead   = "roles.read"
	actionManage = "roles.manage"
)

// Texts of the server of the prototype (ortus/api.js:427–443) and of the contract examples.
const (
	detailNameRequired  = "Укажите название роли"
	detailNameTaken     = "Роль с таким названием уже есть"
	detailNameTooLong   = "Название роли — не длиннее 100 символов"
	detailDescription   = "Описание роли — не длиннее 1000 символов"
	detailSystemEdit    = "Системная роль не редактируется"
	detailSystemDelete  = "Системную роль нельзя удалить."
	detailAssigned      = "Роль назначена: сначала снимите её назначения."
	detailUnknownRights = "Таких прав нет в каталоге: "
	detailDuplicate     = "Право указано дважды: "
	detailNotYours      = "Нельзя добавить в роль права, которых нет у вас: "
	detailNotYoursThere = "Роль назначена там, где у вас нет этих прав: "
)

const (
	kindSystem    = "system"
	kindCustom    = "custom"
	uniqueViolate = "23505"
	maxName       = 100
	maxDesc       = 1000
)

// Handler implements the role operations of accessapi.StrictServerInterface.
type Handler struct{ d kit.Deps }

// New returns the handler over d.
func New(d kit.Deps) *Handler { return &Handler{d: d} }

// role is a live role with the actions of its current version.
type role struct {
	ID       uuid.UUID
	Name     string
	Kind     string
	Template string
	Revision int64
	Actions  []string
	sortKey  string
}

func (r role) api() accessapi.Role {
	perms := r.Actions
	if perms == nil {
		perms = []string{}
	}
	return accessapi.Role{Id: r.ID, Name: r.Name, Description: "", BuiltIn: r.Kind == kindSystem, Permissions: perms, Revision: r.Revision}
}

const selectRoles = `select r.id, r.name, r.kind, coalesce(r.template_key, ''), r.current_version, v.actions,
       lower(r.name) collate "C"
  from access.roles r
  join access.role_versions v on v.role_id = r.id and v.version = r.current_version
 where r.archived_at is null and {{scope}}`

func scanRole(row pgx.Row) (role, error) {
	var r role
	err := row.Scan(&r.ID, &r.Name, &r.Kind, &r.Template, &r.Revision, &r.Actions, &r.sortKey)
	return r, err
}

// ListRoles implements accessapi.StrictServerInterface: live roles by name (roles are tenant-wide: only a grant of
// the whole tenant reads them — the scope predicate of roles.read without columns).
func (h *Handler) ListRoles(ctx context.Context, req accessapi.ListRolesRequestObject) (accessapi.ListRolesResponseObject, error) {
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
	conn, err := h.d.Scoped(ctx, tc, h.d.Evaluator)
	if err != nil {
		return nil, err
	}
	key, id := "", uuid.Nil
	if after != nil {
		key, id = after.Key, after.ID
	}
	rows, err := conn.Query(ctx, actionRead, authz.Columns{}, selectRoles+`
		and (lower(r.name) collate "C", r.id) > ($1, $2) order by lower(r.name) collate "C", r.id limit $3`, key, id, limit+1)
	if err != nil {
		return nil, kit.Store("roles", err)
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (role, error) { return scanRole(row) })
	if err != nil {
		return nil, kit.Store("roles", err)
	}
	page := accessapi.RolePage{Items: make([]accessapi.Role, 0, min(len(items), limit))}
	for i, r := range items {
		if i == limit {
			next := kit.Cursor{Key: items[i-1].sortKey, ID: items[i-1].ID}.Encode()
			page.NextCursor = &next
			break
		}
		page.Items = append(page.Items, r.api())
	}
	cc, rid := kit.Meta(ctx)
	return accessapi.ListRoles200JSONResponse{Body: page, Headers: accessapi.ListRoles200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetRole implements accessapi.StrictServerInterface.
func (h *Handler) GetRole(ctx context.Context, req accessapi.GetRoleRequestObject) (accessapi.GetRoleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	conn, err := h.d.Scoped(ctx, tc, h.d.Evaluator)
	if err != nil {
		return nil, err
	}
	var r role
	if err := conn.One(ctx, actionRead, authz.Columns{}, func(row pgx.Row) (err error) { r, err = scanRole(row); return err },
		selectRoles+` and r.id = $1`, req.RoleId); err != nil {
		return nil, kit.Store("role", err)
	}
	cc, rid := kit.Meta(ctx)
	tag := kit.ETag(r.Revision)
	return accessapi.GetRole200JSONResponse{Body: r.api(), Headers: accessapi.GetRole200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// validateName trims and checks a role name (1…100 characters).
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

func validateDescription(d *string) error {
	if d != nil && utf8.RuneCountInString(*d) > maxDesc {
		return kit.Validation(detailDescription)
	}
	return nil
}

// validatePermissions checks keys against the tenant actions of the catalog: no unknown key, no key twice.
func validatePermissions(p authz.Policy, perms []string) error {
	var unknown []string
	seen := map[string]bool{}
	for _, a := range perms {
		if seen[a] {
			return kit.Validation(detailDuplicate + a)
		}
		seen[a] = true
		if !p.Known(a) {
			unknown = append(unknown, a)
		}
	}
	if len(unknown) > 0 {
		return kit.Validation(detailUnknownRights + strings.Join(unknown, ", "))
	}
	return nil
}

// added returns the actions of next that prev lacks, and removed — those of prev that next lacks.
func diff(prev, next []string) (added, removed []string) {
	for _, a := range next {
		if !slices.Contains(prev, a) {
			added = append(added, a)
		}
	}
	for _, a := range prev {
		if !slices.Contains(next, a) {
			removed = append(removed, a)
		}
	}
	return added, removed
}

// delegable requires that a member holds every action of added in one of its active grants, outside work-function
// blocks and owner_only (Capabilities of ev); the owner adds any key of the catalog.
func delegable(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, added []string) error {
	if tc.Owner || len(added) == 0 {
		return nil
	}
	caps, err := ev.Capabilities(ctx, tc)
	if err != nil {
		return kit.Unavailable(err)
	}
	held := map[string]bool{}
	for _, c := range caps {
		held[c.Action] = true
	}
	var missing []string
	for _, a := range added {
		if !held[a] {
			missing = append(missing, a)
		}
	}
	if len(missing) > 0 {
		return kit.Conflict(kit.CodeDelegation, detailNotYours+strings.Join(missing, ", "))
	}
	return nil
}

// delegableWhereHeld requires that a member holds every added action over everything the live assignments of role
// reach: its holders get the added rights there at once (AUTH-08 by scope); the owner adds anywhere.
func (h *Handler) delegableWhereHeld(ctx context.Context, q kit.DB, ev *authz.Evaluator, tc tenantctx.TenantContext, role uuid.UUID, added []string) error {
	if tc.Owner || len(added) == 0 {
		return nil
	}
	reach, err := kit.RoleReach(ctx, q, role, h.d.Clock())
	if err != nil {
		return err
	}
	return kit.Cover(ctx, ev, tc, added, reach, detailNotYoursThere+strings.Join(added, ", "))
}

// auditDiff is the diff of a change of rights: sensitive and restricted keys apart (AUTH-03).
func auditDiff(name string, added, removed []string) (map[string]any, string) {
	changed := slices.Concat(added, removed)
	sensitive, restricted := kit.SplitSensitivity(changed)
	d := map[string]any{"name": name}
	if added != nil {
		d["added"] = added
	}
	if removed != nil {
		d["removed"] = removed
	}
	if sensitive != nil {
		d["sensitive"] = sensitive
	}
	if restricted != nil {
		d["restricted"] = restricted
	}
	level := kit.MaxSensitivity(changed)
	if level == kit.Normal {
		level = kit.Sensitive // a change of a role is a change of access
	}
	return d, level
}

func nameTaken(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == uniqueViolate
}
