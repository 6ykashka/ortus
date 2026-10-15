//go:build integration

package assignments_test

// W1.41: inviteMember sends the letter with the link of the invitation; the token of the link accepts it. The token
// lives only in the letter: the control DB keeps its SHA-256, the tenant DB, the audit and the errors never see it.

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"            //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations"            //nolint:depguard // the acceptance of W1.03 the letter leads to
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
)

const stand = "http://localhost:5202" // PUBLIC_ORIGIN of slot 2

// mailed is the handler of w that sends its letters to srv over plain SMTP (the stand).
func (w *world) mailed(srv *mailtest.Server) *assignments.Handler {
	return w.h.WithInvitationMail(mail.Invitations{Origin: stand, Sender: &mail.SMTP{Config: mail.Config{
		Host: srv.Host, Port: srv.Port, From: "no-reply@ortus.local", AllowPlain: true, Timeout: 5 * time.Second,
	}}})
}

func inviteVia(t *testing.T, w *world, h *assignments.Handler, body accessapi.InvitationCreate) (accessapi.Invitation, error) {
	t.Helper()
	resp, err := h.InviteMember(w.Ctx(w.owner), accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &body})
	if err != nil {
		return accessapi.Invitation{}, err
	}
	return accesstest.As[accessapi.InviteMember201JSONResponse](t, resp, nil).Body, nil
}

// T-5. Письмо по эталону «Оформление → Письмо» со ссылкой <PUBLIC_ORIGIN>/auth/invitation#token=…; токен из ссылки
// принимает приглашение (membership active, назначения приглашения активны); токена нет ни в одной таблице.
func TestInviteMemberSendsLetter(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	srv := mailtest.Start(t, mailtest.Options{})
	inv, err := inviteVia(t, w, w.mailed(srv), invitation("Иван Тестов", "I.Testov@alta.example", w.f1,
		accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)}))
	if err != nil {
		t.Fatal(err)
	}
	token := letterToken(t, srv, "i.testov@alta.example")
	if n := w.ControlCount(`select 1 from invitations where id = $1 and token_hash = $2`, inv.Id, invitations.HashToken(token)); n != 1 {
		t.Errorf("the link does not carry the token of invitation %s", inv.Id)
	}
	noToken(t, w, token)
	acceptAs(t, w, "i.testov@alta.example", token)
	noToken(t, w, token)
}

// acceptAs: an account of email accepts the invitation of token (W1.03) — its membership is active, the dormant
// assignment of the invitation is active.
func acceptAs(t *testing.T, w *world, email, token string) {
	t.Helper()
	account := uuid.New()
	if _, err := w.Control.Exec(t.Context(), `insert into accounts (id, issuer, subject, email_norm, display_name, status)
		values ($1, 'urn:ortus:dev', $2, $3, 'Иван Тестов', 'active')`, account, "w141-"+account.String()[:8], email); err != nil {
		t.Fatal(err)
	}
	svc := invitations.Service{Control: w.Control, Tenants: w.Pools()}
	acc, err := svc.Accept(t.Context(), account, token)
	if err != nil || acc.MembershipStatus != authapi.Active || acc.TenantId != w.TenantID {
		t.Fatalf("accept: %+v, %v", acc, err)
	}
	if n := w.ControlCount(`select 1 from memberships where tenant_id = $1 and account_id = $2 and status = 'active'`, w.TenantID, account); n != 1 {
		t.Errorf("active memberships of the invitee: %d", n)
	}
	if n := w.Count(`select 1 from access.role_assignments a join people.person_profiles p on p.id = a.principal_id
		where p.email = $1 and a.state = 'active' and a.role_id = $2`, email, w.trips); n != 1 {
		t.Errorf("active assignments of the invitee: %d", n)
	}
}

// letterToken checks the only letter of srv (to, the texts of the reference, the link) and returns the token of
// its link.
func letterToken(t *testing.T, srv *mailtest.Server, to string) string {
	t.Helper()
	got := srv.Wait(t, 1)
	if len(got) != 1 || len(got[0].To) != 1 || got[0].To[0] != to {
		t.Fatalf("envelopes %+v", got)
	}
	l := mailtest.Parse(t, got[0].Data)
	if l.FromName != "Мир теста · через Ортус" || l.Subject != "Приглашение в «Мир теста»" ||
		!strings.Contains(l.Text, "Дарья Зимина приглашает вас в «Мир теста». Приглашение действует 7 дней.") ||
		!strings.Contains(l.Text, "Принять приглашение: "+stand+"/auth/invitation#token=") {
		t.Errorf("letter %+v", l)
	}
	if l.Token() == "" {
		t.Fatalf("no token in the link:\n%s", l.Text)
	}
	return l.Token()
}

// noToken: the token is in no row of the tenant DB (audit, outbox, idempotency, people) and of the control DB.
func noToken(t *testing.T, w *world, token string) {
	t.Helper()
	for _, table := range []string{"audit.events", "outbox.events", "core.idempotency_keys", "people.person_profiles", "access.role_assignments"} {
		if n := w.Count(`select 1 from `+table+` r where r::text like '%' || $1 || '%'`, token); n != 0 {
			t.Errorf("the token in %s: %d rows", table, n)
		}
	}
	for _, table := range []string{"invitations", "memberships", "accounts", "tenants"} {
		if n := w.ControlCount(`select 1 from `+table+` r where r::text like '%' || $1 || '%'`, token); n != 0 {
			t.Errorf("the token in control %s: %d rows", table, n)
		}
	}
}

// T-6. Письмо не ушло — приглашение отозвано (возврат 1: письмо после COMMIT, сбой — компенсация): 503
// dependency_unavailable; приглашение в control отозвано (адрес и место свободны), карточки и спящих назначений нет,
// в аудите — создание и отзыв; ошибка называет адрес маской; после восстановления SMTP то же приглашение проходит.
func TestInviteMemberLetterFails(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	srv := mailtest.Start(t, mailtest.Options{})
	h := w.mailed(srv)
	body := invitation("Иван Тестов", "i.testov@alta.example", w.f1, accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)})
	dormant := w.Count(`select 1 from access.role_assignments where state = 'dormant'`)
	for _, verb := range []string{"RCPT", "DATA"} {
		srv.Refuse(verb, "451 4.3.0 try again later")
		_, err := inviteVia(t, w, h, body)
		if accesstest.Code(err) != "dependency_unavailable" {
			t.Fatalf("%s refused: %s", verb, accesstest.Problem(err))
		}
		if cause := causeOf(err); strings.Contains(cause, "i.testov@") || !strings.Contains(cause, "i•••••@alta.example") {
			t.Errorf("%s refused: cause %q", verb, cause)
		}
		srv.Refuse(verb, "")
	}
	if n := w.Count(`select 1 from people.person_profiles where email = 'i.testov@alta.example'`); n != 0 {
		t.Errorf("cards of failed invitations: %d", n)
	}
	if n := w.Count(`select 1 from access.role_assignments where state = 'dormant'`); n != dormant {
		t.Errorf("dormant assignments of failed invitations: %d, want %d", n, dormant)
	}
	if n := w.ControlCount(`select 1 from invitations where tenant_id = $1 and email_norm = 'i.testov@alta.example'
		and revoked_at is null`, w.TenantID); n != 0 {
		t.Errorf("live invitations without a letter: %d", n)
	}
	if n := w.ControlCount(`select 1 from invitations where tenant_id = $1 and email_norm = 'i.testov@alta.example'
		and revoked_at is not null and accepted_at is null`, w.TenantID); n != 2 {
		t.Errorf("revoked invitations without a letter: %d, want 2", n)
	}
	for action, want := range map[string]int{"access.invitation.create": 2, "access.invitation.revoke": 2} {
		if n := w.Count(`select 1 from audit.events where action = $1`, action); n != want {
			t.Errorf("audit %s: %d, want %d", action, n, want)
		}
	}
	if _, err := inviteVia(t, w, h, body); err != nil {
		t.Fatalf("retry: %v", err)
	}
	if got := srv.Wait(t, 1); len(got) != 1 {
		t.Errorf("letters after the retry: %d", len(got))
	}
}

// T-8 (возврат 1). Письмо уходит после COMMIT: пока SMTP-сервер медлит, строка tenants в control и строка
// access.policy_state свободны (команды доступа организации не ждут SMTP); клиент, ушедший во время разговора с
// SMTP, письмо не отменяет — приглашение живо, ссылка его принимает.
func TestInviteMemberLetterOutsideLocks(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	srv := mailtest.Start(t, mailtest.Options{})
	reached, release := srv.Hold("DATA")
	defer release()
	ctx, cancel := context.WithCancel(w.Ctx(w.owner))
	defer cancel()
	body := invitation("Иван Тестов", "i.testov@alta.example", w.f1, accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)})
	call := accesstest.Go(func() error {
		_, err := w.mailed(srv).InviteMember(ctx, accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &body})
		return err
	})
	select {
	case <-reached:
	case <-time.After(15 * time.Second):
		t.Fatal("the letter did not reach DATA")
	}
	if !w.PolicyFree() {
		t.Error("access.policy_state is locked while SMTP talks")
	}
	if !tenantRowFree(t, w) {
		t.Error("the tenants row of the control DB is locked while SMTP talks")
	}
	cancel() // the client goes away in the middle of the SMTP conversation
	release()
	if err := call.Wait(); err != nil {
		t.Fatalf("inviteMember after the client left: %s", accesstest.Problem(err))
	}
	token := letterToken(t, srv, "i.testov@alta.example")
	if n := w.ControlCount(`select 1 from invitations where token_hash = $1 and revoked_at is null`, invitations.HashToken(token)); n != 1 {
		t.Fatalf("the invitation of the letter is not live: %d", n)
	}
	acceptAs(t, w, "i.testov@alta.example", token)
}

// tenantRowFree reports whether nobody holds the tenants row of w in the control DB (FOR UPDATE NOWAIT succeeds).
func tenantRowFree(t *testing.T, w *world) bool {
	t.Helper()
	tx, err := w.Control.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	_, err = tx.Exec(t.Context(), `select id from tenants where id = $1 for update nowait`, w.TenantID)
	return err == nil
}

// causeOf is the whole error chain as text (the request log writes it).
func causeOf(err error) string {
	var b strings.Builder
	for e := err; e != nil; e = errors.Unwrap(e) {
		b.WriteString(e.Error() + " | ")
	}
	return b.String()
}
