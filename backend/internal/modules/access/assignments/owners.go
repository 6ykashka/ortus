package assignments

import (
	"context"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var errNoControl = kit.ErrNoControl

// Texts of the owner operations (contract examples, Q-W0.08-3, Q-W0.08-6).
const (
	detailConfirmation = "Подтверждение не совпадает с почтой получателя."
	detailReason       = "Укажите причину: от 5 до 500 символов."
	detailNotActive    = "Получатель — только активный участник с действующим аккаунтом."
	detailAlreadyOwner = "Этот участник уже владелец."
	detailLastOwner    = "Нельзя снять последнего владельца: сначала передайте владение."
	reasonCompensation = "compensation: the tenant DB did not commit"
	targetOwner        = "access.owner"
	targetTenant       = "tenant"
	minReason          = 5
	maxReason          = 500
	maxConfirmation    = 254
)

// owner is an active owner binding with the account of its membership.
type owner struct {
	Person uuid.UUID
	Name   string
	Email  string
	Since  time.Time
}

const ownersSQL = `select m.person_profile_id, a.display_name, a.email_norm, ob.granted_at
  from owner_bindings ob
  join memberships m on m.id = ob.membership_id
  join accounts a on a.id = m.account_id
 where ob.tenant_id = $1 and ob.revoked_at is null
 order by ob.granted_at, m.person_profile_id`

func readOwners(ctx context.Context, q kit.DB, tenant uuid.UUID) (accessapi.OwnerList, []uuid.UUID, error) {
	rows, err := q.Query(ctx, ownersSQL, tenant)
	if err != nil {
		return accessapi.OwnerList{}, nil, kit.Store("owners", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (owner, error) {
		var o owner
		err := r.Scan(&o.Person, &o.Name, &o.Email, &o.Since)
		return o, err
	})
	if err != nil {
		return accessapi.OwnerList{}, nil, kit.Store("owners", err)
	}
	out := accessapi.OwnerList{Items: make([]accessapi.Owner, 0, len(list))}
	ids := make([]uuid.UUID, 0, len(list))
	for _, o := range list {
		item := accessapi.Owner{MemberId: o.Person, DisplayName: o.Name, Since: o.Since.UTC()}
		setString(&item.Email, o.Email)
		out.Items = append(out.Items, item)
		ids = append(ids, o.Person)
	}
	return out, ids, nil
}

// setString sets a string-based field of a generated type (openapi_types.Email: depguard keeps the runtime of the
// generator out of internal/modules).
func setString[T ~string](dst *T, s string) { *dst = T(s) }

// ListOwners implements accessapi.StrictServerInterface: the active owner bindings (AUTH-08: ownership is not a role).
func (h *Handler) ListOwners(ctx context.Context, _ accessapi.ListOwnersRequestObject) (accessapi.ListOwnersResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if h.d.Control == nil {
		return nil, kit.Unavailable(errNoControl)
	}
	list, _, err := readOwners(ctx, h.d.Control, tc.TenantID)
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	return accessapi.ListOwners200JSONResponse{Body: list, Headers: accessapi.ListOwners200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// ownerChange is a change of owner bindings made in the control DB.
type ownerChange struct {
	kind    string // transfer | revoke
	members []uuid.UUID
	persons []uuid.UUID // whose rights change: the members, and the owner who leaves
	reason  string
	details map[string]any
	apply   func(ctx context.Context, ctl pgx.Tx) (kit.Undo, error)
}

// change runs c in kit.InControlTx: FOR UPDATE of the tenant row first (owner changes of one tenant go one by one,
// AUTH-08, Q-W1.03-12), then the actor must still be an owner (the gateway checked it before the lock: 403 if its
// binding was revoked meanwhile), the change, the platform audit; the tenant DB records the policy version, the audit
// and the event. A failed tenant commit undoes the change of the bindings.
func (h *Handler) change(ctx context.Context, tc tenantctx.TenantContext, c ownerChange, status int, body func(accessapi.OwnerList) any) (accessapi.OwnerList, error) {
	var list accessapi.OwnerList
	err := h.d.InControlTx(ctx, tc, func(tx, ctl pgx.Tx) (kit.Undo, error) {
		if err := stillOwner(ctx, ctl, tc); err != nil {
			return nil, err
		}
		undo, err := c.apply(ctx, ctl)
		if err != nil {
			return nil, err
		}
		var ids []uuid.UUID
		if list, ids, err = readOwners(ctx, ctl, tc.TenantID); err != nil {
			return nil, err
		}
		if err := platformAudit(ctx, ctl, tc, c, audit.OK, c.reason); err != nil {
			return nil, err
		}
		if err := h.recordOwners(ctx, tx, tc, c, ids); err != nil {
			return nil, err
		}
		if err := kit.Complete(ctx, tx, status, "", body(list)); err != nil {
			return nil, err
		}
		return func(ctx context.Context, ctl pgx.Tx) error {
			if err := undo(ctx, ctl); err != nil {
				return err
			}
			return platformAudit(ctx, ctl, tc, c, audit.Failed, "compensation: the tenant DB did not commit")
		}, nil
	})
	return list, err
}

// stillOwner requires an active owner binding of the membership of the actor under the lock of the tenant row.
func stillOwner(ctx context.Context, ctl pgx.Tx, tc tenantctx.TenantContext) error {
	var ok bool
	if err := ctl.QueryRow(ctx, `select exists (select 1 from owner_bindings where tenant_id = $1 and membership_id = $2
		and revoked_at is null)`, tc.TenantID, tc.MembershipID).Scan(&ok); err != nil {
		return kit.Store("actor binding", err)
	}
	if !ok {
		return kit.Forbidden()
	}
	return nil
}

func platformAudit(ctx context.Context, ctl pgx.Tx, tc tenantctx.TenantContext, c ownerChange, result, reason string) error {
	err := audit.RecordPlatform(ctx, ctl, audit.PlatformEvent{ActorKind: audit.PlatformOwner, ActorID: tc.AccountID,
		Action: "access.owner." + c.kind, TargetType: targetTenant, TargetID: tc.TenantID, Reason: reason, Result: result,
		Details: c.details})
	return kit.Store("platform audit", err)
}
func (h *Handler) recordOwners(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, c ownerChange, owners []uuid.UUID) error {
	if _, err := kit.BumpPolicy(ctx, tx, tc.TenantID, c.persons, "access.owner."+c.kind); err != nil {
		return err
	}
	if err := kit.Publish(ctx, tx, kit.EventOwnerChanged, kit.AggregateOwner, tc.TenantID, map[string]any{
		"change": c.kind, "actorPersonId": tc.PersonID, "memberIds": c.members, "ownerIds": owners}); err != nil {
		return err
	}
	return kit.Audit(ctx, tx, kit.Change{Action: "access.owner." + c.kind, TargetType: targetOwner, TargetID: c.members[0],
		Reason: c.reason, Diff: c.details})
}

// TransferOwnership implements accessapi.StrictServerInterface (S1-16, Q-W0.08-3): one step, with the e-mail of the
// target as confirmation, a reason and a recent sign-in.
func (h *Handler) TransferOwnership(ctx context.Context, req accessapi.TransferOwnershipRequestObject) (accessapi.TransferOwnershipResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	b := *req.Body
	reason := strings.TrimSpace(b.Reason)
	if n := utf8.RuneCountInString(reason); n < minReason || n > maxReason {
		return nil, kit.Validation(detailReason)
	}
	if utf8.RuneCountInString(b.Confirmation) > maxConfirmation {
		return nil, kit.Validation(detailConfirmation)
	}
	if err := h.d.Fresh(ctx); err != nil {
		return nil, err
	}
	now := h.d.Clock()
	c := ownerChange{kind: "transfer", members: []uuid.UUID{b.ToMemberId}, persons: []uuid.UUID{b.ToMemberId}, reason: reason,
		details: map[string]any{"toMemberId": b.ToMemberId, "keepCurrentOwner": b.KeepCurrentOwner}}
	if !b.KeepCurrentOwner {
		c.persons = append(c.persons, tc.PersonID)
	}
	c.apply = h.transfer(tc, b, reason, now)
	list, err := h.change(ctx, tc, c, http.StatusOK, func(l accessapi.OwnerList) any { return l })
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.TransferOwnership200JSONResponse{Body: list, Headers: accessapi.TransferOwnership200ResponseHeaders{
		CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// transfer returns the change of the bindings of a transfer: the binding of the target, and the end of the binding
// of the actor unless it stays an owner; its undo reverts both.
func (h *Handler) transfer(tc tenantctx.TenantContext, b accessapi.OwnershipTransferCreate, reason string, now time.Time) func(context.Context, pgx.Tx) (kit.Undo, error) {
	return func(ctx context.Context, ctl pgx.Tx) (kit.Undo, error) {
		target, err := h.target(ctx, ctl, tc.TenantID, b.ToMemberId, b.Confirmation)
		if err != nil {
			return nil, err
		}
		var granted uuid.UUID
		if err := ctl.QueryRow(ctx, `insert into owner_bindings (tenant_id, membership_id, granted_at, granted_by) values ($1, $2, $3, $4)
			returning id`, tc.TenantID, target, now, tc.MembershipID).Scan(&granted); err != nil {
			return nil, kit.Store("owner binding", err)
		}
		left := []uuid.UUID{}
		if !b.KeepCurrentOwner {
			rows, err := ctl.Query(ctx, `update owner_bindings set revoked_at = $3, revoke_reason = $4
				where tenant_id = $1 and membership_id = $2 and revoked_at is null returning id`, tc.TenantID, tc.MembershipID, now, reason)
			if err != nil {
				return nil, kit.Store("leave ownership", err)
			}
			if left, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID]); err != nil {
				return nil, kit.Store("leave ownership", err)
			}
		}
		return func(ctx context.Context, ctl pgx.Tx) error {
			if _, err := ctl.Exec(ctx, `update owner_bindings set revoked_at = $2, revoke_reason = $3 where id = $1`,
				granted, now, reasonCompensation); err != nil {
				return err
			}
			_, err := ctl.Exec(ctx, `update owner_bindings set revoked_at = null, revoke_reason = null where id = any($1)`, left)
			return err
		}, nil
	}
}

// target checks the receiver of ownership under lock: a membership of the tenant (404 otherwise), active with an
// active account and not an owner yet (409), whose e-mail the owner typed (422). It returns the membership id.
func (h *Handler) target(ctx context.Context, ctl pgx.Tx, tenant, person uuid.UUID, confirmation string) (uuid.UUID, error) {
	var (
		membership             uuid.UUID
		mStatus, aStatus, mail string
		isOwner                bool
	)
	err := ctl.QueryRow(ctx, `select m.id, m.status::text, a.status, a.email_norm,
		       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
		  from memberships m join accounts a on a.id = m.account_id
		 where m.tenant_id = $1 and m.person_profile_id = $2
		   for update of m`, tenant, person).Scan(&membership, &mStatus, &aStatus, &mail, &isOwner)
	switch {
	case kit.NoRows(err):
		return uuid.Nil, kit.NotFound()
	case err != nil:
		return uuid.Nil, kit.Store("target membership", err)
	case mStatus != stateActive || aStatus != stateActive:
		return uuid.Nil, kit.Conflict(kit.CodeInvalidTransition, detailNotActive)
	case isOwner:
		return uuid.Nil, kit.Conflict(kit.CodeInvalidTransition, detailAlreadyOwner)
	case !strings.EqualFold(strings.TrimSpace(confirmation), mail):
		return uuid.Nil, kit.Validation(detailConfirmation)
	}
	return membership, nil
}

// RevokeOwnership implements accessapi.StrictServerInterface (Q-W0.08-6): an owner removes an owner binding, its own
// included; the last one stays (409). Membership and role assignments of the former owner are not changed.
func (h *Handler) RevokeOwnership(ctx context.Context, req accessapi.RevokeOwnershipRequestObject) (accessapi.RevokeOwnershipResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.d.Fresh(ctx); err != nil {
		return nil, err
	}
	now := h.d.Clock()
	c := ownerChange{kind: "revoke", members: []uuid.UUID{req.MemberId}, persons: []uuid.UUID{req.MemberId}, reason: "revokeOwnership",
		details: map[string]any{"memberId": req.MemberId}}
	c.apply = func(ctx context.Context, ctl pgx.Tx) (kit.Undo, error) {
		var binding uuid.UUID
		err := ctl.QueryRow(ctx, `select ob.id from owner_bindings ob join memberships m on m.id = ob.membership_id
			where ob.tenant_id = $1 and m.person_profile_id = $2 and ob.revoked_at is null for update of ob`, tc.TenantID, req.MemberId).Scan(&binding)
		switch {
		case kit.NoRows(err):
			return nil, kit.NotFound()
		case err != nil:
			return nil, kit.Store("owner binding", err)
		}
		var owners int
		if err := ctl.QueryRow(ctx, `select count(*) from owner_bindings where tenant_id = $1 and revoked_at is null`, tc.TenantID).Scan(&owners); err != nil {
			return nil, kit.Store("owners", err)
		}
		if owners <= 1 {
			return nil, kit.Conflict(kit.CodeLastOwner, detailLastOwner)
		}
		if _, err = ctl.Exec(ctx, `update owner_bindings set revoked_at = $2, revoke_reason = 'revokeOwnership' where id = $1`, binding, now); err != nil {
			return nil, kit.Store("revoke owner binding", err)
		}
		return func(ctx context.Context, ctl pgx.Tx) error {
			_, err := ctl.Exec(ctx, `update owner_bindings set revoked_at = null, revoke_reason = null where id = $1`, binding)
			return err
		}, nil
	}
	if _, err := h.change(ctx, tc, c, http.StatusNoContent, func(accessapi.OwnerList) any { return nil }); err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.RevokeOwnership204Response{Headers: accessapi.RevokeOwnership204ResponseHeaders{CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
