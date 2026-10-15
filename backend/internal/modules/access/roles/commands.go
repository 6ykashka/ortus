package roles

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const targetRole = "access.role"

// CreateRole implements accessapi.StrictServerInterface: a custom role with version 1 (an empty list is the «Пустая
// роль»). Copying a template or a role is done by the client (getRole → createRole, 00-master-plan.md:452).
func (h *Handler) CreateRole(ctx context.Context, req accessapi.CreateRoleRequestObject) (accessapi.CreateRoleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	name, err := validateName(req.Body.Name)
	if err != nil {
		return nil, err
	}
	perms := req.Body.Permissions
	if perms == nil {
		perms = []string{}
	}
	if err := validateDescription(req.Body.Description); err != nil {
		return nil, err
	}
	if err := validatePermissions(h.d.Evaluator.Policy, perms); err != nil {
		return nil, err
	}
	if err := h.delegable(ctx, tc, perms); err != nil {
		return nil, err
	}
	r := role{ID: uuid.New(), Name: name, Kind: kindCustom, Revision: 1, Actions: perms}
	body := r.api()
	tag := kit.ETag(r.Revision)
	err = h.d.InPolicyTx(ctx, tc, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, r.ID, name); err != nil {
			if nameTaken(err) {
				return kit.Validation(detailNameTaken)
			}
			return kit.Store("insert role", err)
		}
		if _, err := tx.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
			r.ID, perms, tc.PersonID); err != nil {
			return kit.Store("insert role version", err)
		}
		diff, level := auditDiff(name, perms, nil)
		if err := kit.Audit(ctx, tx, kit.Change{Action: "access.role.create", TargetType: targetRole, TargetID: r.ID, Sensitivity: level, Diff: diff}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusCreated, tag, body)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.CreateRole201JSONResponse{Body: body, Headers: accessapi.CreateRole201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// lockRole reads a live role for update; a missing or archived one is 404.
func lockRole(ctx context.Context, tx pgx.Tx, id uuid.UUID) (role, error) {
	r, err := scanRole(tx.QueryRow(ctx, `select r.id, r.name, r.kind, coalesce(r.template_key, ''), r.current_version, v.actions, ''
		  from access.roles r
		  join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		 where r.id = $1 and r.archived_at is null
		   for update of r`, id))
	switch {
	case kit.NoRows(err):
		return role{}, kit.NotFound()
	case err != nil:
		return role{}, kit.Store("role", err)
	}
	return r, nil
}

// UpdateRole implements accessapi.StrictServerInterface: a new version of the role; its live assignments move to
// it; a change of rights bumps the policy version.
func (h *Handler) UpdateRole(ctx context.Context, req accessapi.UpdateRoleRequestObject) (accessapi.UpdateRoleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	var out role
	// A change of rights may give earnings to the holders of the role (D-10): they are locked before the policy row.
	holders := func(q kit.DB) ([]uuid.UUID, error) {
		if req.Body.Permissions == nil {
			return nil, nil
		}
		return kit.Holders(ctx, q, req.RoleId)
	}
	err = h.d.InPeopleTx(ctx, tc, holders, func(tx pgx.Tx) error {
		r, err := lockRole(ctx, tx, req.RoleId)
		if err != nil {
			return err
		}
		if err := kit.IfMatch(req.Params.IfMatch, r.Revision); err != nil {
			return err
		}
		if r.Kind == kindSystem {
			return kit.Conflict(kit.CodeInvalidTransition, detailSystemEdit)
		}
		next, err := h.patched(ctx, tx, tc, r, req.Body)
		if err != nil {
			return err
		}
		out = next
		return h.saveVersion(ctx, tx, tc, r, next)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	tag := kit.ETag(out.Revision)
	replayed := false
	return accessapi.UpdateRole200JSONResponse{Body: out.api(), Headers: accessapi.UpdateRole200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// patched validates a patch of r and returns the next version: name, rights (delegation of the added ones, D-10).
func (h *Handler) patched(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, r role, p *accessapi.RolePatch) (role, error) {
	next := r
	next.Revision = r.Revision + 1
	if p.Name != nil {
		name, err := validateName(*p.Name)
		if err != nil {
			return role{}, err
		}
		next.Name = name
	}
	if err := validateDescription(p.Description); err != nil {
		return role{}, err
	}
	if p.Permissions == nil {
		return next, nil
	}
	next.Actions = *p.Permissions
	if next.Actions == nil {
		next.Actions = []string{}
	}
	if err := validatePermissions(h.d.Evaluator.Policy, next.Actions); err != nil {
		return role{}, err
	}
	added, _ := diff(r.Actions, next.Actions)
	if err := h.delegable(ctx, tc, added); err != nil {
		return role{}, err
	}
	if err := h.delegableWhereHeld(ctx, tx, tc, r.ID, added); err != nil {
		return role{}, err
	}
	if len(kit.DriverClosed(h.d.Evaluator.Policy, next.Actions)) == 0 {
		return next, nil
	}
	if r.Template == kit.TemplateDriver {
		return role{}, kit.Conflict(kit.CodeSeparationOfDuties, kit.DetailDriverRole)
	}
	held, err := kit.RoleHeldByDriver(ctx, tx, r.ID, h.d.Clock())
	if err != nil {
		return role{}, err
	}
	if held {
		return role{}, kit.Conflict(kit.CodeSeparationOfDuties, kit.DetailRoleHeldByDriver)
	}
	return next, nil
}

// saveVersion writes version next of r, moves the live assignments to it and records the change.
func (h *Handler) saveVersion(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, r, next role) error {
	if _, err := tx.Exec(ctx, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, $2, $3, $4)`,
		r.ID, next.Revision, next.Actions, tc.PersonID); err != nil {
		return kit.Store("insert role version", err)
	}
	if _, err := tx.Exec(ctx, `update access.roles set name = $2, current_version = $3 where id = $1`, r.ID, next.Name, next.Revision); err != nil {
		if nameTaken(err) {
			return kit.Validation(detailNameTaken)
		}
		return kit.Store("update role", err)
	}
	if _, err := tx.Exec(ctx, `update access.role_assignments set role_version = $2 where role_id = $1 and state <> 'revoked'`,
		r.ID, next.Revision); err != nil {
		return kit.Store("move assignments", err)
	}
	added, removed := diff(r.Actions, next.Actions)
	if len(added)+len(removed) > 0 {
		holders, err := kit.Holders(ctx, tx, r.ID)
		if err != nil {
			return err
		}
		if len(holders) > 0 { // nobody holds the role: nobody's rights change
			if _, err := kit.BumpPolicy(ctx, tx, tc.TenantID, holders, "access.role.update"); err != nil {
				return err
			}
		}
	}
	d, level := auditDiff(next.Name, added, removed)
	if r.Name != next.Name {
		d["previousName"] = r.Name
	}
	if err := kit.Audit(ctx, tx, kit.Change{Action: "access.role.update", TargetType: targetRole, TargetID: r.ID, Sensitivity: level, Diff: d}); err != nil {
		return err
	}
	return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(next.Revision), next.api())
}

// DeleteRole implements accessapi.StrictServerInterface: archives an unused custom or template role. A system role
// and a role with live assignments stay (409): no member silently loses rights.
func (h *Handler) DeleteRole(ctx context.Context, req accessapi.DeleteRoleRequestObject) (accessapi.DeleteRoleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = h.d.InPolicyTx(ctx, tc, func(tx pgx.Tx) error {
		r, err := lockRole(ctx, tx, req.RoleId)
		if err != nil {
			return err
		}
		if err := kit.IfMatch(req.Params.IfMatch, r.Revision); err != nil {
			return err
		}
		if r.Kind == kindSystem {
			return kit.Conflict(kit.CodeInvalidTransition, detailSystemDelete)
		}
		var assigned bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from access.role_assignments
			where role_id = $1 and state <> 'revoked' and (upper_inf(valid) or upper(valid) > $2))`, r.ID, h.d.Clock()).Scan(&assigned); err != nil {
			return kit.Store("role assignments", err)
		}
		if assigned {
			return kit.Conflict(kit.CodeInvalidTransition, detailAssigned)
		}
		if _, err := tx.Exec(ctx, `update access.roles set archived_at = $2 where id = $1`, r.ID, h.d.Clock()); err != nil {
			return kit.Store("archive role", err)
		}
		if err := kit.Audit(ctx, tx, kit.Change{Action: "access.role.delete", TargetType: targetRole, TargetID: r.ID,
			Diff: map[string]any{"name": r.Name}}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusNoContent, "", nil)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.DeleteRole204Response{Headers: accessapi.DeleteRole204ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
