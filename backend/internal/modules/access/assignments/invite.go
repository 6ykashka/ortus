package assignments

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations"     //nolint:depguard // the invitation of the access module (W1.03)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of inviteMember (prototype ortus/api.js:293–306 and the contract example).
const (
	actionInvite       = "members.invite"
	targetInvitation   = "access.invitation"
	detailName         = "Укажите имя"
	detailNameTooLong  = "Имя — не длиннее 150 символов"
	detailEmail        = "Проверьте адрес электронной почты"
	detailEmailTaken   = "Участник с таким адресом уже есть."
	detailUnits        = "Выберите подразделение"
	detailProfileBusy  = "У этого человека уже есть приглашение или членство."
	detailSeats        = "Свободных мест нет: занято %d из %d. Отзовите приглашение или запросите расширение тарифа."
	codeSeatsExhausted = "seats_exhausted"
	maxDisplayName     = 150
	maxEmail           = 254
)

// InvitationMail delivers the link of a new invitation (W1.41): mail.Invitations over the SMTP of the process.
type InvitationMail interface {
	SendInvitation(ctx context.Context, inv mail.Invitation) error
}

// WithInvitationMail returns a copy of the handler that sends the letter of every new invitation through m.
func (h *Handler) WithInvitationMail(m InvitationMail) *Handler {
	c := *h
	c.mail = m
	return &c
}

// invite is a validated inviteMember.
type invite struct {
	email string
	name  string
	units []uuid.UUID
	roles []accessapi.InvitationRole
}

func parseInvite(b *accessapi.InvitationCreate) (invite, error) {
	if b == nil {
		return invite{}, problem.New(problem.CodeMalformedRequest, "")
	}
	in := invite{email: invitations.NormalizeEmail(string(b.Email)), units: b.OrgUnitIds, roles: b.RoleAssignments}
	local, domain, ok := strings.Cut(in.email, "@")
	if !ok || local == "" || !strings.Contains(domain, ".") || strings.ContainsAny(in.email, " ,;") || len(in.email) > maxEmail {
		return invite{}, kit.Validation(detailEmail)
	}
	if b.DisplayName != nil {
		in.name = strings.TrimSpace(*b.DisplayName)
	}
	switch {
	case in.name == "":
		return invite{}, kit.Validation(detailName)
	case utf8.RuneCountInString(in.name) > maxDisplayName:
		return invite{}, kit.Validation(detailNameTooLong)
	case len(in.units) == 0:
		return invite{}, kit.Validation(detailUnits)
	}
	return in, nil
}

// InviteMember implements accessapi.StrictServerInterface (S1-06; the format of W1.03, Q-W1.03-5): a person card
// in the tenant DB, the role assignments of the invitation in state dormant (the acceptance activates them), the
// invitation in the control DB with their ids. Every role is checked as a direct assignment (delegation; D-10
// against the other roles of the invitation, in any order); the invitation takes a seat at once (prototype:
// «Приглашение занимает место сразу, до принятия»).
//
// The letter with the link (W1.41, Q-W1.41-1) is sent after both databases commit, with no lock and no connection
// of the command held while SMTP talks (deliver). A failed letter is 503: the invitation is withdrawn, so the owner
// repeats it. The token lives only in the letter: the control DB keeps its SHA-256.
func (h *Handler) InviteMember(ctx context.Context, req accessapi.InviteMemberRequestObject) (accessapi.InviteMemberResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	in, err := parseInvite(req.Body)
	if err != nil {
		return nil, err
	}
	var (
		out    accessapi.Invitation
		made   invited
		letter mail.Invitation
	)
	err = h.d.InControlTx(ctx, tc, func(tx, ctl pgx.Tx) (kit.Undo, error) {
		ev := kit.Request(h.d.Evaluator)
		person, grants, err := h.prepareInvite(ctx, tx, ev, tc, in)
		if err != nil {
			return nil, err
		}
		var token string
		if out, token, err = issue(ctx, ctl, tc, in, person, grants); err != nil {
			return nil, err
		}
		made = invited{id: out.Id, person: person, grants: grants, unit: in.units[0]}
		if err := kit.Audit(ctx, tx, kit.Change{Action: "access.invitation.create", TargetType: targetInvitation, TargetID: out.Id,
			UnitID: in.units[0], Diff: map[string]any{"personId": person, "email": invitations.MaskEmail(in.email), "assignments": grants}}); err != nil {
			return nil, err
		}
		if h.mail == nil { // no letter: the outcome is stored with the effect (idem.CompleteInTx)
			if err := kit.Complete(ctx, tx, http.StatusCreated, "", out); err != nil {
				return nil, err
			}
		} else if letter, err = letterOf(ctx, tx, ctl, tc, in.email, token); err != nil {
			return nil, err
		}
		id := out.Id
		return func(ctx context.Context, ctl pgx.Tx) error { // the card and the assignments did not commit
			return revokeInvitation(ctx, ctl, id)
		}, nil
	})
	if err != nil {
		return nil, err
	}
	if err := h.deliver(ctx, tc, made, letter); err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	replayed := false
	return accessapi.InviteMember201JSONResponse{Body: out, Headers: accessapi.InviteMember201ResponseHeaders{
		CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// prepareInvite checks the units and the roles in tx and writes the card and its dormant assignments.
func (h *Handler) prepareInvite(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, in invite) (uuid.UUID, []uuid.UUID, error) {
	for _, u := range in.units {
		if err := kit.UnitExists(ctx, tx, u); err != nil {
			return uuid.Nil, nil, err
		}
		if err := invites(ctx, ev, tc, u); err != nil {
			return uuid.Nil, nil, err
		}
	}
	home := in.units[0]
	roles := make([]roleRow, 0, len(in.roles))
	scopes := make([]authz.Scope, 0, len(in.roles))
	for _, ir := range in.roles {
		r, scope, err := inviteRole(ctx, tx, ev, tc, ir, home)
		if err != nil {
			return uuid.Nil, nil, err
		}
		roles, scopes = append(roles, r), append(scopes, scope)
	}
	person := uuid.New()
	now := h.d.Clock()
	if _, err := tx.Exec(ctx, `insert into people.person_profiles (id, full_name, email, home_unit_id, created_at) values ($1, $2, $3, $4, $5)`,
		person, in.name, in.email, home, now); err != nil {
		return uuid.Nil, nil, kit.Store("person card", err)
	}
	grants := make([]uuid.UUID, 0, len(roles))
	for i, r := range roles {
		a := assignment{ID: uuid.New(), PrincipalKind: principalPerson, Principal: person, Role: in.roles[i].RoleId, Scope: scopes[i],
			From: &now, Created: now, roleVersion: r.Version}
		a.Scope.Descendants = a.Scope.Kind == authz.KindTenant || a.Scope.Descendants
		if err := insertState(ctx, tx, tc, a, "dormant"); err != nil {
			return uuid.Nil, nil, err
		}
		grants = append(grants, a.ID)
	}
	// D-10 between the roles of the invitation, checked over all its dormant assignments: the role «Водитель» with an
	// earnings role is refused in either order (the new card has no work function yet).
	for _, r := range roles {
		if err := kit.Separation(ctx, tx, h.d.Evaluator.Policy, r.Actions, r.Template, []uuid.UUID{person}, now, nil); err != nil {
			return uuid.Nil, nil, err
		}
	}
	return person, grants, nil
}

// inviteRole checks one role of an invitation as a direct assignment to a person of home: a live, not system role,
// a valid scope over an existing unit, the delegation of the actor.
func inviteRole(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, ir accessapi.InvitationRole, home uuid.UUID) (roleRow, authz.Scope, error) {
	r, err := loadRole(ctx, tx, ir.RoleId)
	if err != nil {
		return roleRow{}, authz.Scope{}, err
	}
	if r.Kind == kindSystem {
		return roleRow{}, authz.Scope{}, kit.Conflict(kit.CodeInvalidTransition, detailSystemRole)
	}
	scope, err := kit.ScopeFromAPI(ir.Scope)
	if err != nil {
		return roleRow{}, authz.Scope{}, err
	}
	if scope.Kind == authz.KindUnit {
		if err := kit.UnitExists(ctx, tx, scope.Ref); err != nil {
			return roleRow{}, authz.Scope{}, err
		}
	}
	targets, err := kit.Targets(ctx, tx, scope, home)
	if err != nil {
		return roleRow{}, authz.Scope{}, err
	}
	return r, scope, kit.Delegate(ctx, ev, tc, r.Actions, targets, "")
}

// invites requires members.invite over a unit: one the actor does not see (members.read) is 404, one it sees — 403.
func invites(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, unit uuid.UUID) error {
	ok, err := kit.Covers(ctx, ev, tc, actionInvite, unit)
	if err != nil || ok {
		return err
	}
	if err := visible(ctx, ev, tc, unit); err != nil {
		return err
	}
	return kit.Forbidden()
}

// issue writes the invitation into the control DB in ctl, under the lock of the business (kit.InControlTx): the
// e-mail is not a member or a pending invitation yet (422), a seat is free (409), then invitations.Issue of W1.03.
// It returns the one-time token of the link with the invitation (W1.41): for the letter only.
func issue(ctx context.Context, ctl pgx.Tx, tc tenantctx.TenantContext, in invite, person uuid.UUID, grants []uuid.UUID) (accessapi.Invitation, string, error) {
	if err := freeEmailAndSeat(ctx, ctl, tc.TenantID, in.email); err != nil {
		return accessapi.Invitation{}, "", err
	}
	membership := tc.MembershipID
	token, id, err := invitations.Issue(ctx, ctl, invitations.Draft{TenantID: tc.TenantID, PersonProfileID: person, Email: in.email,
		CreatedBy: &membership, RoleAssignmentIDs: grants})
	switch {
	case errors.Is(err, invitations.ErrProfileBusy):
		return accessapi.Invitation{}, "", kit.Conflict(kit.CodeInvalidTransition, detailProfileBusy)
	case err != nil:
		return accessapi.Invitation{}, "", kit.Store("issue invitation", err)
	}
	var expires time.Time
	if err := ctl.QueryRow(ctx, `select expires_at from invitations where id = $1`, id).Scan(&expires); err != nil {
		return accessapi.Invitation{}, "", kit.Store("invitation", err)
	}
	out := accessapi.Invitation{Id: id, Status: accessapi.InvitationStatusPending, ExpiresAt: expires.UTC()}
	setString(&out.Email, in.email)
	return out, token, nil
}

// letterOf is the letter of a new invitation (W1.41), read in the transaction of the command: the name of the inviter
// (its card in the tenant DB) and of the business (the control DB), the link with token.
func letterOf(ctx context.Context, tx, ctl pgx.Tx, tc tenantctx.TenantContext, email, token string) (mail.Invitation, error) {
	var inviter, business string
	err := tx.QueryRow(ctx, `select full_name from people.person_profiles where id = $1`, tc.PersonID).Scan(&inviter)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) { // no card: the letter names «Владелец» (the reference)
		return mail.Invitation{}, kit.Store("inviter", err)
	}
	if err := ctl.QueryRow(ctx, `select display_name from tenants where id = $1`, tc.TenantID).Scan(&business); err != nil {
		return mail.Invitation{}, kit.Store("business", err)
	}
	return mail.Invitation{To: email, Token: token, Business: business, Inviter: inviter, Valid: invitations.DefaultTTL}, nil
}

// invited is what inviteMember committed: the invitation (control DB), the card and its dormant assignments (tenant
// DB), the unit of the audit.
type invited struct {
	id, person, unit uuid.UUID
	grants           []uuid.UUID
}

// reasonNoLetter is the reason of the audit record of an invitation withdrawn because its letter was not sent.
const reasonNoLetter = "Письмо приглашения не отправлено"

// deliver sends the letter of a committed invitation (W1.41, Q-W1.41-1): the command holds no lock and no connection
// while SMTP talks (up to mail.DefaultTimeout), so the other commands of the business never wait for it. A client
// that goes away does not stop the letter (context.WithoutCancel): the invitation is committed, the letter completes
// it. A failed letter is 503 dependency_unavailable after the invitation is withdrawn (withdraw): the e-mail and the
// seat are free again and the owner repeats the invitation, with the same Idempotency-Key too — the outcome of a
// command with a letter is stored by the idempotency guard after the letter, never in the transaction (a 503 is not
// stored). Its cause names the e-mail masked and never the token (mail.Invitations); the request log writes it. A
// process that dies between the commit and the letter leaves a pending invitation without a letter (Q-W1.41-1).
func (h *Handler) deliver(ctx context.Context, tc tenantctx.TenantContext, inv invited, letter mail.Invitation) error {
	if h.mail == nil {
		return nil
	}
	ctx = context.WithoutCancel(ctx)
	sendErr := h.mail.SendInvitation(ctx, letter)
	if sendErr == nil {
		return nil
	}
	if err := h.withdraw(ctx, tc, inv); err != nil {
		return kit.Unavailable(errors.Join(sendErr, fmt.Errorf("the invitation %s without a letter is not withdrawn: %w", inv.id, err)))
	}
	return kit.Unavailable(sendErr)
}

// withdraw compensates an invitation whose letter was not sent, in one command under the locks of InControlTx: the
// invitation is revoked (control DB), its dormant assignments and the card are deleted (nobody else refers to them:
// they live only until the letter fails), and the audit records the revocation next to the creation.
func (h *Handler) withdraw(ctx context.Context, tc tenantctx.TenantContext, inv invited) error {
	return h.d.InControlTx(ctx, tc, func(tx, ctl pgx.Tx) (kit.Undo, error) {
		if err := revokeInvitation(ctx, ctl, inv.id); err != nil {
			return nil, kit.Store("revoke invitation", err)
		}
		if _, err := tx.Exec(ctx, `delete from access.role_assignments where id = any($1) and state = 'dormant'`, inv.grants); err != nil {
			return nil, kit.Store("dormant assignments", err)
		}
		if _, err := tx.Exec(ctx, `delete from people.person_profiles where id = $1 and membership_id is null`, inv.person); err != nil {
			return nil, kit.Store("person card", err)
		}
		return nil, kit.Audit(ctx, tx, kit.Change{Action: "access.invitation.revoke", TargetType: targetInvitation, TargetID: inv.id,
			UnitID: inv.unit, Reason: reasonNoLetter, Diff: map[string]any{"personId": inv.person, "assignments": inv.grants}})
	})
}

// revokeInvitation revokes an invitation nobody accepted.
func revokeInvitation(ctx context.Context, ctl pgx.Tx, id uuid.UUID) error {
	_, err := ctl.Exec(ctx, `update invitations set revoked_at = now() where id = $1 and accepted_at is null`, id)
	return err
}

// freeEmailAndSeat refuses an e-mail of a live member or of a pending invitation of the business (422) and an
// invitation over the seat limit: seats = active and invited memberships + pending invitations (409).
func freeEmailAndSeat(ctx context.Context, ctl pgx.Tx, tenant uuid.UUID, email string) error {
	var taken bool
	err := ctl.QueryRow(ctx, `select exists (select 1 from memberships m join accounts a on a.id = m.account_id
		    where m.tenant_id = $1 and a.email_norm = $2 and m.status in ('active', 'suspended', 'invited'))
		or exists (select 1 from invitations where tenant_id = $1 and email_norm = $2
		    and accepted_at is null and revoked_at is null and expires_at > now())`, tenant, email).Scan(&taken)
	switch {
	case err != nil:
		return kit.Store("e-mail", err)
	case taken:
		return kit.Validation(detailEmailTaken)
	}
	var (
		used  int64
		limit *int64
	)
	err = ctl.QueryRow(ctx, `select coalesce((select seats_used from tenant_seat_usage where tenant_id = $1), 0)
		     + (select count(*) from invitations i where i.tenant_id = $1 and i.accepted_at is null and i.revoked_at is null
		          and i.expires_at > now()
		          and not exists (select 1 from memberships m where m.tenant_id = $1 and m.person_profile_id = i.person_profile_id
		                            and m.status = 'invited')),
		       (select limit_value from entitlements where tenant_id = $1 and feature_key = 'seats' and effective @> now()
		         order by version desc limit 1)`, tenant).Scan(&used, &limit)
	switch {
	case err != nil:
		return kit.Store("seats", err)
	case limit != nil && used >= *limit:
		return problem.New(codeSeatsExhausted, fmt.Sprintf(detailSeats, used, *limit))
	}
	return nil
}
