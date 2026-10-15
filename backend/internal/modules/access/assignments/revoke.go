package assignments

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// RevokeAssignment implements accessapi.StrictServerInterface: an assignment the actor does not see is 404; one it
// sees but may not assign over its whole area is 403; the role «Владелец бизнеса» of the last owner stays (409).
// Revocation works at the next check (policy_version + 1, access.assignment.revoked.v1; the realtime of W1.07).
func (h *Handler) RevokeAssignment(ctx context.Context, req accessapi.RevokeAssignmentRequestObject) (accessapi.RevokeAssignmentResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = h.inRevokeTx(ctx, tc, req.AssignmentId, func(tx, ctl pgx.Tx) error {
		var locked uuid.UUID
		err := tx.QueryRow(ctx, `select id from access.role_assignments where id = $1 and state <> 'revoked' for update`, req.AssignmentId).Scan(&locked)
		switch {
		case kit.NoRows(err):
			return kit.NotFound()
		case err != nil:
			return kit.Store("assignment", err)
		}
		a, err := scanAssignment(tx.QueryRow(ctx, selectAssignments+` and x.id = $1`, locked))
		if err != nil {
			return kit.Store("assignment", err)
		}
		ev, err := kit.Within(ctx, h.d.Evaluator, tc, tx)
		if err != nil {
			return err
		}
		if err := h.authorizeRevoke(ctx, tx, ctl, ev, tc, a); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update access.role_assignments set state = 'revoked', revoked_at = $2 where id = $1`, a.ID, h.d.Clock()); err != nil {
			return kit.Store("revoke assignment", err)
		}
		people, err := persons(ctx, tx, a.PrincipalKind == principalGroup, a.Principal)
		if err != nil {
			return err
		}
		if err := bumpFor(ctx, tx, tc, people, "access.assignment.revoke"); err != nil {
			return err
		}
		if err := kit.Publish(ctx, tx, kit.EventAssignmentRevoked, kit.AggregateAssignment, a.ID, map[string]any{
			"assignmentId": a.ID, "principalType": a.PrincipalKind, keyPrincipal: a.Principal, keyRole: a.Role}); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, kit.Change{Action: "access.assignment.revoke", TargetType: targetAssignment, TargetID: a.ID,
			UnitID: a.anchorUnit(), Diff: map[string]any{keyPrincipal: a.Principal, keyRole: a.Role}}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusNoContent, "", nil)
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.RevokeAssignment204Response{Headers: accessapi.RevokeAssignment204ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// authorizeRevoke checks a revocation with ev, the evaluator of the transaction (kit.Within): the actor sees the
// assignment and may assign over its whole area; the role «Владелец бизнеса» of the last owner stays.
func (h *Handler) authorizeRevoke(ctx context.Context, tx, ctl pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, a assignment) error {
	seen, err := kit.Covers(ctx, ev, tc, actionRead, a.anchorUnit())
	switch {
	case err != nil:
		return err
	case !seen:
		return kit.NotFound()
	}
	targets, err := kit.Targets(ctx, tx, a.Scope, a.anchorUnit())
	if err != nil {
		return err
	}
	if err := kit.Delegate(ctx, ev, tc, nil, targets, ""); err != nil {
		if problem.Is(err, kit.CodeDelegation) {
			return kit.Forbidden()
		}
		return err
	}
	if a.PrincipalKind != principalPerson {
		return nil
	}
	r, err := loadRole(ctx, tx, a.Role)
	if problem.Is(err, problem.CodeNotFound) {
		return nil // an archived role: nothing protects it
	}
	if err != nil {
		return err
	}
	if r.Kind != kindSystem || r.Template != templateOwner {
		return nil
	}
	last, err := lastOwner(ctx, ctl, tc, a.Principal)
	if err != nil {
		return err
	}
	if last {
		return kit.Conflict(kit.CodeLastOwner, detailLastOwnerRole)
	}
	return nil
}

// inRevokeTx runs fn in the transaction of revokeAssignment. The role «Владелец бизнеса» of a person depends on the
// owner bindings of the control DB: its revocation runs in kit.InControlTx (FOR UPDATE of the tenant row first, the
// bindings are read under it); any other in kit.InPolicyTx with a nil ctl. The role of an assignment never changes,
// so the kind is read before the locks.
func (h *Handler) inRevokeTx(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, fn func(tx, ctl pgx.Tx) error) error {
	pool, err := h.d.Pool(ctx, tc)
	if err != nil {
		return err
	}
	var ownerRole bool
	err = pool.QueryRow(ctx, `select exists (select 1 from access.role_assignments ra join access.roles r on r.id = ra.role_id
		where ra.id = $1 and ra.principal_kind = 'person' and r.kind = 'system' and r.template_key = 'owner')`, id).Scan(&ownerRole)
	if err != nil {
		return kit.Store("assignment role", err)
	}
	if !ownerRole {
		return h.d.InPolicyTx(ctx, tc, func(tx pgx.Tx) error { return fn(tx, nil) })
	}
	return h.d.InControlTx(ctx, tc, func(tx, ctl pgx.Tx) (kit.Undo, error) { return nil, fn(tx, ctl) })
}

// lastOwner reports whether person is the only active owner of the tenant, read in ctl under the lock of the tenant
// row (inRevokeTx).
func lastOwner(ctx context.Context, ctl pgx.Tx, tc tenantctx.TenantContext, person uuid.UUID) (bool, error) {
	if ctl == nil {
		return false, kit.Unavailable(errors.New("assignments: the owner role without the lock of the tenant row"))
	}
	var (
		owners  int
		isOwner bool
	)
	err := ctl.QueryRow(ctx, `select count(*), coalesce(bool_or(m.person_profile_id = $2), false)
		  from owner_bindings ob join memberships m on m.id = ob.membership_id
		 where ob.tenant_id = $1 and ob.revoked_at is null`, tc.TenantID, person).Scan(&owners, &isOwner)
	if err != nil {
		return false, kit.Store("owners", err)
	}
	return isOwner && owners <= 1, nil
}
