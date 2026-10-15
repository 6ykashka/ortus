//go:build integration

package assignments_test

// W1.43 (Q-W1.05-10): приглашения карточек импорта (commitPeopleImport с sendInvitations). Карточки пишет команда
// импорта в транзакции tenant под блокировкой строки tenants (control); приглашения W1.03 — в той же транзакции
// control, места проверяются для всех сразу; письма уходят только после COMMIT обеих БД (Q-W1.41-1).

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"            //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations"            //nolint:depguard // the acceptance of W1.03 the letter leads to
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// card is a row of an import: a new person card with an e-mail ("" — none) in a unit.
type card struct {
	name, email string
	unit        uuid.UUID
}

// importCards is the commit of an import in tx: it writes the cards and returns those with an e-mail to invite
// (line = 2 + index, as in a file with a header).
func importCards(cards ...card) func(tx pgx.Tx) ([]assignments.Invitee, error) {
	return func(tx pgx.Tx) ([]assignments.Invitee, error) {
		var out []assignments.Invitee
		for i, c := range cards {
			var email *string
			if c.email != "" {
				email = &c.email
			}
			var id uuid.UUID
			if err := tx.QueryRow(context.Background(), `insert into people.person_profiles (full_name, email, home_unit_id)
				values ($1, $2, $3) returning id`, c.name, email, c.unit).Scan(&id); err != nil {
				return nil, err
			}
			if c.email != "" {
				out = append(out, assignments.Invitee{Person: id, Email: c.email, Unit: c.unit, Line: i + 2})
			}
		}
		return out, nil
	}
}

// completes counts the calls of complete in a live transaction.
type completes struct{ n int }

func (c *completes) fn(tx pgx.Tx) error {
	c.n++
	_, err := tx.Exec(context.Background(), `select 1`)
	return err
}

func (w *world) inviteCards(tc tenantctx.TenantContext, h *assignments.Handler, done *completes, cards ...card) (int, error) {
	return h.InviteCards(w.Ctx(tc), tc, importCards(cards...), done.fn)
}

// acceptCard: an account of email accepts the invitation of token; its membership is active and linked to the card.
func acceptCard(t *testing.T, w *world, email, token string) {
	t.Helper()
	account := uuid.New()
	if _, err := w.Control.Exec(t.Context(), `insert into accounts (id, issuer, subject, email_norm, display_name, status)
		values ($1, 'urn:ortus:dev', $2, $3, 'Импортированный', 'active')`, account, "w143-"+account.String()[:8], email); err != nil {
		t.Fatal(err)
	}
	svc := invitations.Service{Control: w.Control, Tenants: w.Pools()}
	acc, err := svc.Accept(t.Context(), account, token)
	if err != nil || acc.MembershipStatus != authapi.Active || acc.TenantId != w.TenantID {
		t.Fatalf("accept %s: %+v, %v", email, acc, err)
	}
	if n := w.Count(`select 1 from people.person_profiles where lower(email) = $1 and membership_id is not null`, email); n != 1 {
		t.Errorf("the card of %s is not linked to the membership", email)
	}
}

// Карточки с почтой получают приглашения и письма после COMMIT: пока SMTP держит DATA, приглашения уже видны в
// control, строки tenants и access.policy_state свободны; токен письма принимает приглашение; complete не вызывается
// (исход сохраняет guard после писем).
func TestInviteCardsLetters(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	srv := mailtest.Start(t, mailtest.Options{})
	reached, release := srv.Hold("DATA")
	defer release()
	done := &completes{}
	call := accesstest.Go(func() error {
		n, err := w.inviteCards(w.owner, w.mailed(srv), done,
			card{"Иван Первый", "first@alta.example", w.f1}, card{"Без почты", "", w.f1}, card{"Пётр Второй", "Second@Alta.example", w.f2})
		if err == nil && n != 2 {
			t.Errorf("invited %d, want 2", n)
		}
		return err
	})
	select {
	case <-reached:
	case <-time.After(15 * time.Second):
		t.Fatal("no letter reached DATA")
	}
	if n := w.ControlCount(`select 1 from invitations where tenant_id = $1 and revoked_at is null`, w.TenantID); n != 2 {
		t.Errorf("committed invitations while the first letter waits: %d, want 2", n)
	}
	if !w.PolicyFree() || !tenantRowFree(t, w) {
		t.Error("a lock is held while SMTP talks")
	}
	release()
	if err := call.Wait(); err != nil {
		t.Fatalf("invite cards: %s", accesstest.Problem(err))
	}
	if done.n != 0 {
		t.Errorf("complete ran %d times with a network SMTP", done.n)
	}
	acceptLetters(t, w, srv, 2)
	if n := w.Count(`select 1 from audit.events where action = 'access.invitation.create'`); n != 2 {
		t.Errorf("audit access.invitation.create: %d", n)
	}
}

// acceptLetters waits for n letters of srv and accepts the invitation of each by the token of its link.
func acceptLetters(t *testing.T, w *world, srv *mailtest.Server, n int) {
	t.Helper()
	letters := srv.Wait(t, n)
	if len(letters) != n {
		t.Fatalf("letters %d, want %d", len(letters), n)
	}
	for _, l := range letters {
		parsed := mailtest.Parse(t, l.Data)
		if !strings.Contains(parsed.Text, "Дарья Зимина приглашает вас в «Мир теста».") || parsed.Token() == "" {
			t.Errorf("letter %+v", parsed)
		}
		acceptCard(t, w, l.To[0], parsed.Token())
	}
}

// Места — на всех сразу; адрес участника — 422 со строкой файла; актор без members.invite — 403. Ничего не записано.
func TestInviteCardsRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	srv := mailtest.Start(t, mailtest.Options{})
	h := w.mailed(srv)
	cards := w.Count(`select 1 from people.person_profiles`)

	_, err := w.inviteCards(w.owner, h, &completes{}, card{"Один", "one@alta.example", w.f1}, card{"Менеджер", "M1@alta.example", w.f1})
	if got := accesstest.Problem(err); got != "validation_failed|Строка 3: участник с таким адресом уже есть." {
		t.Errorf("an e-mail of a member: %s", got)
	}
	w.seatLimit(t, w.seatsUsed(t)+1)
	_, err = w.inviteCards(w.owner, h, &completes{}, card{"Один", "one@alta.example", w.f1}, card{"Два", "two@alta.example", w.f1})
	if accesstest.Code(err) != "seats_exhausted" {
		t.Errorf("two invitations over one free seat: %s", accesstest.Problem(err))
	}
	_, err = w.inviteCards(w.reader, h, &completes{}, card{"Один", "one@alta.example", w.f1})
	if accesstest.Code(err) != "forbidden_action" {
		t.Errorf("an actor without members.invite: %s", accesstest.Problem(err))
	}
	if n := w.Count(`select 1 from people.person_profiles`); n != cards {
		t.Errorf("cards of refused commits: %d, want %d", n, cards)
	}
	if n := w.ControlCount(`select 1 from invitations where tenant_id = $1`, w.TenantID); n != 0 {
		t.Errorf("invitations of refused commits: %d", n)
	}
	if got := srv.Messages(); len(got) != 0 {
		t.Errorf("letters of refused commits: %d", len(got))
	}
}

// Письмо не ушло — его приглашение отозвано (адрес и место свободны), карточка остаётся результатом импорта;
// число приглашённых — без него.
func TestInviteCardsLetterFails(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	srv := mailtest.Start(t, mailtest.Options{})
	srv.Refuse("RCPT", "451 4.3.0 try again later")
	n, err := w.inviteCards(w.owner, w.mailed(srv), &completes{}, card{"Один", "one@alta.example", w.f1})
	if err != nil {
		t.Fatalf("invite cards: %s", accesstest.Problem(err))
	}
	if n != 0 {
		t.Errorf("invited %d, want 0", n)
	}
	if c := w.ControlCount(`select 1 from invitations where tenant_id = $1 and revoked_at is not null`, w.TenantID); c != 1 {
		t.Errorf("revoked invitations: %d, want 1", c)
	}
	if c := w.Count(`select 1 from people.person_profiles where email = 'one@alta.example'`); c != 1 {
		t.Errorf("cards: %d, want 1", c)
	}
	if c := w.Count(`select 1 from audit.events where action = 'access.invitation.revoke'`); c != 1 {
		t.Errorf("audit access.invitation.revoke: %d", c)
	}
}

// Почта выключена (mail.Off): complete — в транзакции эффекта, приглашения выданы.
func TestInviteCardsMailOff(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	done := &completes{}
	h := w.h.WithInvitationMail(mail.Invitations{Origin: stand, Sender: mail.Off{}})
	n, err := w.inviteCards(w.owner, h, done, card{"Один", "one@alta.example", w.f1}, card{"Два", "two@alta.example", w.f2})
	if err != nil {
		t.Fatalf("invite cards: %s", accesstest.Problem(err))
	}
	if n != 2 || done.n != 1 {
		t.Errorf("invited %d, complete ran %d times; want 2 and 1", n, done.n)
	}
	if c := w.ControlCount(`select 1 from invitations where tenant_id = $1 and revoked_at is null`, w.TenantID); c != 2 {
		t.Errorf("invitations: %d", c)
	}
}
