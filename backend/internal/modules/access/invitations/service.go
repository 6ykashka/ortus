package invitations

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Problem codes of the contract (api/errors.yaml) used here.
const (
	codeInvalidTransition = "invalid_transition"
	codeExpired           = "public_token_expired"
	codeSeatsExhausted    = "seats_exhausted"
)

// Tenant states (tenant_state, PLAT-02) in which a business does not exist for its people.
var hiddenTenant = map[string]bool{"provisioning": true, "closing": true, "closed": true}

// invitation is a row of invitations with its business.
type invitation struct {
	id, tenantID, personID uuid.UUID
	email                  string
	expiresAt              time.Time
	accepted, revoked      bool
	expired, owner         bool
	tenantName, state      string
	grants                 []uuid.UUID // role_assignment_ids: dormant assignments the acceptance activates
}

const selectInvitation = `
select i.id, i.tenant_id, i.person_profile_id, i.email_norm, i.expires_at,
       i.accepted_at is not null, i.revoked_at is not null, i.expires_at <= now(), i.grants_owner,
       t.display_name, t.state::text, i.role_assignment_ids
  from invitations i
  join tenants t on t.id = i.tenant_id
 where i.token_hash = $1`

func scanInvitation(row pgx.Row) (invitation, error) {
	var v invitation
	err := row.Scan(&v.id, &v.tenantID, &v.personID, &v.email, &v.expiresAt, &v.accepted, &v.revoked, &v.expired, &v.owner,
		&v.tenantName, &v.state, &v.grants)
	if errors.Is(err, pgx.ErrNoRows) {
		return invitation{}, problem.New(problem.CodeNotFound, "")
	}
	if err != nil {
		return invitation{}, problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("invitations: %w", err))
	}
	if hiddenTenant[v.state] {
		return invitation{}, problem.New(problem.CodeNotFound, "")
	}
	return v, nil
}

func (v invitation) status() authapi.InvitationPreviewStatus {
	switch {
	case v.accepted:
		return authapi.Accepted
	case v.revoked:
		return authapi.Revoked
	case v.expired:
		return authapi.Expired
	}
	return authapi.Pending
}

// Inspect describes an invitation by its token before sign-in: business name, masked e-mail, status and expiry.
// An unknown token and a business that does not exist for its people give 404.
func (s *Service) Inspect(ctx context.Context, token string) (authapi.InvitationPreview, error) {
	v, err := scanInvitation(s.Control.QueryRow(ctx, selectInvitation, HashToken(token)))
	if err != nil {
		return authapi.InvitationPreview{}, err
	}
	return authapi.InvitationPreview{
		TenantName: v.tenantName, InvitedEmailMasked: MaskEmail(v.email), Status: v.status(), ExpiresAt: v.expiresAt.UTC(),
	}, nil
}

// check refuses an invitation the account cannot accept now (order: someone else's invitation, its state, the state
// of the business).
func (v invitation) check(accountEmail string) error {
	switch {
	case NormalizeEmail(accountEmail) != v.email:
		return problem.New(problem.CodeForbiddenAction, "")
	case v.accepted || v.revoked:
		return problem.New(codeInvalidTransition, "")
	case v.expired:
		return problem.New(codeExpired, "")
	}
	switch v.state {
	case "trial", "active":
		return nil
	case "suspended":
		return problem.New(problem.CodeTenantSuspended, "")
	case "grace", "read_only":
		return problem.New(problem.CodeTenantReadOnly, "")
	}
	return problem.New(problem.CodeNotFound, "")
}

// acceptance is the plan of an acceptance: the membership to activate or create.
type acceptance struct {
	inv          invitation
	accountID    uuid.UUID
	accountName  string
	membershipID uuid.UUID
	create       bool
	ended        []uuid.UUID // other invited memberships of the profile: they end, their seat passes to membershipID
}

// Accept accepts the invitation of token for the signed-in account (S1-06).
func (s *Service) Accept(ctx context.Context, accountID uuid.UUID, token string) (authapi.InvitationAcceptance, error) {
	tx, err := s.Control.Begin(ctx)
	if err != nil {
		return authapi.InvitationAcceptance{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op after Commit
	a, err := plan(ctx, tx, accountID, token)
	if err != nil {
		return authapi.InvitationAcceptance{}, err
	}
	if err := s.applyTenant(ctx, a); err != nil {
		return authapi.InvitationAcceptance{}, err
	}
	if err := applyControl(ctx, tx, a); err != nil {
		return authapi.InvitationAcceptance{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return authapi.InvitationAcceptance{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return authapi.InvitationAcceptance{
		TenantId: a.inv.tenantID, MembershipId: a.membershipID, TenantName: a.inv.tenantName, MembershipStatus: authapi.Active,
	}, nil
}

func dbErr(what string, err error) error {
	return problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("invitations: %s: %w", what, err))
}

// plan locks the business and the invitation, checks the invitation against the account and finds the membership to
// activate or the seat to take.
//
// Lock order (control 0002, AUTH-08): the business first, then the invitation, then the memberships. The invitation
// is first read unlocked only to find its business; after FOR UPDATE of the tenants row it is locked and read again
// together with the state of the business, so a revocation or a state change committed meanwhile is seen. Two
// acceptances in one business queue on the business, so the second one sees the membership the first one made.
func plan(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, token string) (acceptance, error) {
	hash := HashToken(token)
	var tenantID uuid.UUID
	err := tx.QueryRow(ctx, `select tenant_id from invitations where token_hash = $1`, hash).Scan(&tenantID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return acceptance{}, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return acceptance{}, dbErr("invitation", err)
	}
	if _, err := tx.Exec(ctx, `select id from tenants where id = $1 for update`, tenantID); err != nil {
		return acceptance{}, dbErr("tenant", err)
	}
	inv, err := scanInvitation(tx.QueryRow(ctx, selectInvitation+` for update of i`, hash))
	if err != nil {
		return acceptance{}, err
	}
	a := acceptance{inv: inv, accountID: accountID}
	var email, status string
	err = tx.QueryRow(ctx, `select email_norm, display_name, status from accounts where id = $1`, accountID).
		Scan(&email, &a.accountName, &status)
	switch {
	case errors.Is(err, pgx.ErrNoRows), err == nil && status != "active":
		return acceptance{}, problem.New(problem.CodeSessionExpired, "")
	case err != nil:
		return acceptance{}, dbErr("account", err)
	}
	if err := inv.check(email); err != nil {
		return acceptance{}, err
	}
	seated, err := a.findMembership(ctx, tx)
	if err != nil {
		return acceptance{}, err
	}
	if !seated {
		return a, takeSeat(ctx, tx, inv.tenantID)
	}
	return a, nil
}

// findMembership: one person profile, one live membership. A profile that is already an active or suspended member
// (of this or another account) is refused with 409 — otherwise two accounts would act as one person with its grants.
// Then the account's own membership in the business (invited or ended — reactivated; active or suspended — 409), else
// an invited membership of the invited profile (seed, earlier invitation), else a new one. Invited memberships of the
// profile held by another account end when the account's own membership is reactivated, and pass their seat to it.
// seated reports whether the membership to activate already holds a seat; an ended or a new one takes a seat.
func (a *acceptance) findMembership(ctx context.Context, tx pgx.Tx) (seated bool, err error) {
	var live bool
	err = tx.QueryRow(ctx, `select exists (select 1 from memberships where tenant_id = $1 and person_profile_id = $2
		and status in ('active', 'suspended'))`, a.inv.tenantID, a.inv.personID).Scan(&live)
	switch {
	case err != nil:
		return false, dbErr("membership", err)
	case live:
		return false, problem.New(codeInvalidTransition, "")
	}
	var status string
	err = tx.QueryRow(ctx, `select id, status::text from memberships where tenant_id = $1 and account_id = $2 for update`,
		a.inv.tenantID, a.accountID).Scan(&a.membershipID, &status)
	switch {
	case err == nil && (status == "active" || status == "suspended"):
		return false, problem.New(codeInvalidTransition, "")
	case err == nil:
		if err := a.supersede(ctx, tx); err != nil {
			return false, err
		}
		return status == "invited" || len(a.ended) > 0, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return false, dbErr("membership", err)
	}
	err = tx.QueryRow(ctx, `select id from memberships where tenant_id = $1 and person_profile_id = $2 and status = 'invited'
		order by created_at, id limit 1 for update`, a.inv.tenantID, a.inv.personID).Scan(&a.membershipID)
	switch {
	case err == nil:
		return true, a.supersede(ctx, tx)
	case !errors.Is(err, pgx.ErrNoRows):
		return false, dbErr("membership", err)
	}
	a.membershipID, a.create = uuid.New(), true
	return false, nil
}

// supersede locks the other invited memberships of the invited profile; applyControl ends them.
func (a *acceptance) supersede(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `select id from memberships where tenant_id = $1 and person_profile_id = $2 and status = 'invited'
		and id <> $3 for update`, a.inv.tenantID, a.inv.personID, a.membershipID)
	if err != nil {
		return dbErr("membership", err)
	}
	a.ended, err = pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return dbErr("membership", err)
	}
	return nil
}

// takeSeat checks the seat limit of the business for a membership that does not hold a seat yet (control 0002:
// seats = active + invited memberships; the limit is the entitlement seats in effect, none = no limit). The caller
// holds FOR UPDATE of the tenant.
func takeSeat(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID) error {
	var (
		used  int64
		limit *int64
	)
	err := tx.QueryRow(ctx, `
select coalesce((select seats_used from tenant_seat_usage where tenant_id = $1), 0),
       (select limit_value from entitlements where tenant_id = $1 and feature_key = 'seats' and effective @> now()
         order by version desc limit 1)`, tenantID).Scan(&used, &limit)
	if err != nil {
		return dbErr("seats", err)
	}
	if limit != nil && used >= *limit {
		return problem.New(codeSeatsExhausted, "")
	}
	return nil
}

// applyTenant links the profile to the membership, activates the dormant assignments the invitation names (of its
// profile, not expired; other dormant assignments — A-09 grants of a disabled module — stay dormant), bumps the
// policy version and writes the audit record — in one transaction of the tenant DB. Every statement is idempotent.
func (s *Service) applyTenant(ctx context.Context, a acceptance) error {
	pool, err := s.Tenants.For(ctx, a.inv.tenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return dbErr("tenant DB", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	p := a.inv.personID
	if _, err := tx.Exec(ctx, `update people.person_profiles set membership_id = null where membership_id = $2 and id <> $1`,
		p, a.membershipID); err != nil {
		return dbErr("profile", err)
	}
	tag, err := tx.Exec(ctx, `update people.person_profiles
   set membership_id = $2, archived_at = null, revision = revision + 1,
       full_name = case when full_name = email or full_name = '' then $3 else full_name end
 where id = $1`, p, a.membershipID, a.accountName)
	if err != nil {
		return dbErr("profile", err)
	}
	if tag.RowsAffected() == 0 {
		return dbErr("profile", fmt.Errorf("person profile %s of invitation %s is missing", p, a.inv.id))
	}
	if _, err := tx.Exec(ctx, `update access.role_assignments set state = 'active'
		where id = any($2) and principal_kind = 'person' and principal_id = $1 and state = 'dormant'
		  and (upper_inf(valid) or upper(valid) > now())`, p, a.inv.grants); err != nil {
		return dbErr("assignments", err)
	}
	if _, err := tx.Exec(ctx, `insert into access.policy_state (singleton, policy_version) values (true, 1)
		on conflict (singleton) do update set policy_version = access.policy_state.policy_version + 1`); err != nil {
		return dbErr("policy version", err)
	}
	e := audit.ForRequest(ctx)
	e.ActorKind, e.ActorID = audit.ActorPerson, p
	e.Action, e.TargetType, e.TargetID = "access.invitation.accept", "people.person", p
	e.Diff = map[string]any{"invitationId": a.inv.id.String(), "membershipId": a.membershipID.String(), "owner": a.inv.owner}
	if e.RequestID == "" {
		e.RequestID = "invitation-" + a.inv.id.String()
	}
	if err := audit.Record(ctx, tx, e); err != nil {
		return dbErr("audit", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dbErr("tenant DB", err)
	}
	return nil
}

// applyControl ends the superseded invited memberships of the profile, activates or creates the membership, binds the owner, closes the invitation and remembers the
// business as the account's lastTenantId.
func applyControl(ctx context.Context, tx pgx.Tx, a acceptance) error {
	membership := `update memberships set account_id = $3, status = 'active', person_profile_id = $4, ended_at = null,
		revision = revision + 1 where id = $1 and tenant_id = $2`
	if a.create {
		membership = `insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, 'active', $4)`
	}
	steps := []struct {
		what, sql string
		args      []any
	}{
		{"superseded memberships", `update memberships set status = 'ended', ended_at = now(), revision = revision + 1
			where id = any($1) and status = 'invited'`, []any{a.ended}},
		{"membership", membership, []any{a.membershipID, a.inv.tenantID, a.accountID, a.inv.personID}},
		{"invitation", `update invitations set accepted_at = now(), accepted_account = $2 where id = $1`, []any{a.inv.id, a.accountID}},
		{"account", `update accounts set last_tenant_id = $2, last_tenant_at = now() where id = $1`, []any{a.accountID, a.inv.tenantID}},
	}
	if a.inv.owner {
		steps = append(steps, struct {
			what, sql string
			args      []any
		}{"owner", `insert into owner_bindings (tenant_id, membership_id) values ($1, $2)
			on conflict (tenant_id, membership_id) where revoked_at is null do nothing`, []any{a.inv.tenantID, a.membershipID}})
	}
	for _, st := range steps {
		if _, err := tx.Exec(ctx, st.sql, st.args...); err != nil {
			return dbErr(st.what, err)
		}
	}
	return nil
}
