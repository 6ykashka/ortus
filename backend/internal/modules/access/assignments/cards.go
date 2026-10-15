package assignments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations"     //nolint:depguard // the invitation of the access module (W1.03)
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the invitations of an import (W1.43): the 422 and 409 of inviteMember with the line of the file.
const (
	detailLineEmailTaken  = "Строка %d: участник с таким адресом уже есть."
	detailLineProfileBusy = "Строка %d: у этого человека уже есть приглашение или членство."
)

// Invitee is a person card to invite without roles (commitPeopleImport with sendInvitations, W1.43): the card, its
// e-mail, its home unit and the line of the file it came from.
type Invitee struct {
	Person uuid.UUID
	Email  string
	Unit   uuid.UUID
	Line   int
}

// InviteCards invites the cards of an import (W1.43, Q-W1.05-10): the importer.Inviter of cmd/api.
//
// fn — the commit of the import — runs in a transaction of the tenant DB opened after FOR UPDATE of the tenant row
// of the control DB (kit.InControlNoPolicyTx: the commit takes its people and the policy row itself, as the commands
// of W1.05 do). For the cards fn returns, in the control transaction: members.invite of the actor over the unit of
// every card (403; the check runs in the transaction, kit.Within), the seats of all of them at once (409
// seats_exhausted: the import is refused, nothing is written), a free e-mail (422 with the line), then the invitation
// of W1.03 without roles and its audit record. Both databases commit (a failed tenant commit revokes the
// invitations), and only then the letters go, one by one, outside every lock (Q-W1.41-1); a failed letter withdraws
// its invitation, the card stays — it is the result of the import. complete runs in the tenant transaction when no
// letter leaves the process (no mail, mail.Off): the outcome is stored with the effect. It returns the number of
// invitations whose letter went (every invitation without mail).
func (h *Handler) InviteCards(ctx context.Context, tc tenantctx.TenantContext, fn func(tx pgx.Tx) ([]Invitee, error), complete func(tx pgx.Tx) error) (int, error) {
	var (
		made    []invited
		letters []mail.Invitation
	)
	err := h.d.InControlNoPolicyTx(ctx, tc, func(tx, ctl pgx.Tx) (kit.Undo, error) {
		var err error
		if made, letters, err = h.issueCards(ctx, tx, ctl, tc, fn); err != nil {
			return nil, err
		}
		if h.mail == nil {
			if err := complete(tx); err != nil {
				return nil, err
			}
		}
		ids := make([]uuid.UUID, 0, len(made))
		for _, m := range made {
			ids = append(ids, m.id)
		}
		return func(ctx context.Context, ctl pgx.Tx) error { // the cards did not commit
			_, err := ctl.Exec(ctx, `update invitations set revoked_at = now() where id = any($1) and accepted_at is null`, ids)
			return err
		}, nil
	})
	switch {
	case err != nil:
		return 0, err
	case h.mail == nil:
		return len(made), nil
	}
	return h.sendCards(context.WithoutCancel(ctx), tc, made, letters), nil // committed: the letters complete them
}

// issueCards runs fn in tx and invites the cards it returns in ctl: the checks of the actor, the seats, the
// invitations; with mail it returns the letters too.
func (h *Handler) issueCards(ctx context.Context, tx, ctl pgx.Tx, tc tenantctx.TenantContext, fn func(tx pgx.Tx) ([]Invitee, error)) ([]invited, []mail.Invitation, error) {
	ev, err := kit.Within(ctx, h.d.Evaluator, tc, tx)
	if err != nil {
		return nil, nil, err
	}
	people, err := fn(tx)
	if err != nil || len(people) == 0 {
		return nil, nil, err
	}
	for _, p := range people {
		if err := invites(ctx, ev, tc, p.Unit); err != nil {
			return nil, nil, err
		}
	}
	if err := freeSeats(ctx, ctl, tc.TenantID, int64(len(people))); err != nil {
		return nil, nil, err
	}
	var base mail.Invitation
	if h.mail != nil {
		if base, err = letterOf(ctx, tx, ctl, tc, "", ""); err != nil {
			return nil, nil, err
		}
	}
	made, letters := make([]invited, 0, len(people)), make([]mail.Invitation, 0, len(people))
	for _, p := range people {
		inv, token, err := issueCard(ctx, tx, ctl, tc, p)
		if err != nil {
			return nil, nil, err
		}
		letter := base
		letter.To, letter.Token = invitations.NormalizeEmail(p.Email), token
		made, letters = append(made, inv), append(letters, letter)
	}
	return made, letters, nil
}

// sendCards sends the letters of committed invitations one by one; a failed letter withdraws its invitation and is
// logged with the e-mail masked. It returns the number of letters sent.
func (h *Handler) sendCards(ctx context.Context, tc tenantctx.TenantContext, made []invited, letters []mail.Invitation) int {
	sent := 0
	for i, inv := range made {
		if err := h.send(ctx, tc, inv, letters[i]); err != nil {
			h.log().ErrorContext(ctx, "access: the letter of an invitation of an import is not sent, the invitation is withdrawn",
				slog.String("tenant_id", tc.TenantID.String()), slog.String("invitation_id", inv.id.String()), slog.String("error", err.Error()))
			continue
		}
		sent++
	}
	return sent
}

// issueCard writes the invitation of one card into the control DB in ctl (the tenant row is locked) and its audit
// record into the tenant DB in tx; it returns the token of the link.
func issueCard(ctx context.Context, tx, ctl pgx.Tx, tc tenantctx.TenantContext, p Invitee) (invited, string, error) {
	email := invitations.NormalizeEmail(p.Email)
	taken, err := emailTaken(ctx, ctl, tc.TenantID, email)
	switch {
	case err != nil:
		return invited{}, "", err
	case taken:
		return invited{}, "", kit.Validation(fmt.Sprintf(detailLineEmailTaken, p.Line))
	}
	membership := tc.MembershipID
	token, id, err := invitations.Issue(ctx, ctl, invitations.Draft{TenantID: tc.TenantID, PersonProfileID: p.Person, Email: email,
		CreatedBy: &membership})
	switch {
	case errors.Is(err, invitations.ErrProfileBusy):
		return invited{}, "", kit.Conflict(kit.CodeInvalidTransition, fmt.Sprintf(detailLineProfileBusy, p.Line))
	case err != nil:
		return invited{}, "", kit.Store("issue invitation", err)
	}
	if err := kit.Audit(ctx, tx, kit.Change{Action: "access.invitation.create", TargetType: targetInvitation, TargetID: id,
		UnitID: p.Unit, Diff: map[string]any{"personId": p.Person, "email": invitations.MaskEmail(email), "source": "import"}}); err != nil {
		return invited{}, "", err
	}
	return invited{id: id, person: p.Person, unit: p.Unit, keepCard: true}, token, nil
}

// log is the logger of the module (kit.Deps.Log).
func (h *Handler) log() *slog.Logger {
	if h.d.Log != nil {
		return h.d.Log
	}
	return slog.Default()
}
