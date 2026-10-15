package mail_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
)

// token is a made-up invitation token: base64url, as invitations.Issue makes it.
const token = "Zm9vYmFyLXRva2VuLWZvci10ZXN0cy0wMTIzNDU2Nzg5" //nolint:gosec // G101: a test value, not a credential

func invitation() mail.Invitation {
	return mail.Invitation{To: "i.testov@alta.example", Token: token, Business: "Альта Групп", Inviter: "Дарья Зимина",
		Valid: 7 * 24 * time.Hour}
}

func TestInvitationLink(t *testing.T) {
	t.Parallel()
	for origin, want := range map[string]string{
		"http://localhost:5202":      "http://localhost:5202/auth/invitation#token=" + token,
		"https://app.ortus.example/": "https://app.ortus.example/auth/invitation#token=" + token,
	} {
		if got := mail.InvitationLink(origin, token); got != want {
			t.Errorf("%s: %s, want %s", origin, got, want)
		}
	}
}

// T-2. Тексты — эталон «Оформление → Письмо» (design-stage-1, «Ортус CRM.dc.html»:1424–1432); тема — Q-W1.41-2.
func TestInvitationLetter(t *testing.T) {
	t.Parallel()
	s := mail.Invitations{Origin: "http://localhost:5202"}
	m := s.Letter(invitation())
	link := "http://localhost:5202/auth/invitation#token=" + token
	if m.To != "i.testov@alta.example" || m.FromName != "Альта Групп · через Ортус" || m.Subject != "Приглашение в «Альта Групп»" {
		t.Errorf("headers: %+v", m)
	}
	for _, want := range []string{
		"Дарья Зимина приглашает вас в «Альта Групп». Приглашение действует 7 дней.",
		"Принять приглашение: " + link,
		"Письмо отправлено по поручению организации. Если вы не ждали приглашения, просто удалите его.",
		"Работает на Ортус",
	} {
		if !strings.Contains(m.Text, want) {
			t.Errorf("text has no %q:\n%s", want, m.Text)
		}
	}
	for _, want := range []string{`href="` + link + `"`, ">Принять приглашение</a>", "Дарья Зимина приглашает вас в «Альта Групп»."} {
		if !strings.Contains(m.HTML, want) {
			t.Errorf("HTML has no %q:\n%s", want, m.HTML)
		}
	}
}

// Без имени пригласившего — «Владелец» (эталон: me ? me.name : 'Владелец'); срок — по дням с правильным склонением;
// разметка в названии организации экранируется.
func TestInvitationLetterVariants(t *testing.T) {
	t.Parallel()
	s := mail.Invitations{Origin: "http://localhost:5202"}
	inv := invitation()
	inv.Inviter, inv.Business, inv.Valid = "", "<b>Карго</b> & Ко", 24*time.Hour
	m := s.Letter(inv)
	if !strings.Contains(m.Text, "Владелец приглашает вас в «<b>Карго</b> & Ко». Приглашение действует 1 день.") {
		t.Errorf("text:\n%s", m.Text)
	}
	if strings.Contains(m.HTML, "<b>Карго</b>") || !strings.Contains(m.HTML, "&lt;b&gt;Карго&lt;/b&gt; &amp; Ко") {
		t.Errorf("HTML is not escaped:\n%s", m.HTML)
	}
	for valid, want := range map[time.Duration]string{0: "7 дней", 2 * 24 * time.Hour: "2 дня", 21 * 24 * time.Hour: "21 день", 11 * 24 * time.Hour: "11 дней"} {
		inv.Valid = valid
		if m := s.Letter(inv); !strings.Contains(m.Text, "действует "+want+".") {
			t.Errorf("%v: want %q in\n%s", valid, want, m.Text)
		}
	}
}

type recorder struct {
	got []mail.Message
	err error
}

func (r *recorder) Send(_ context.Context, m mail.Message) error {
	r.got = append(r.got, m)
	return r.err
}

// Ошибка доставки называет адрес маской и не несёт токена.
func TestSendInvitation(t *testing.T) {
	t.Parallel()
	rec := &recorder{}
	s := mail.Invitations{Sender: rec, Origin: "http://localhost:5202"}
	if err := s.SendInvitation(t.Context(), invitation()); err != nil || len(rec.got) != 1 {
		t.Fatalf("send: %v, %d messages", err, len(rec.got))
	}
	rec.err = errors.New("451 4.3.0 try again later")
	err := s.SendInvitation(t.Context(), invitation())
	if err == nil || !errors.Is(err, rec.err) {
		t.Fatalf("send error: %v", err)
	}
	if msg := err.Error(); strings.Contains(msg, token) || strings.Contains(msg, "i.testov@") || !strings.Contains(msg, "i•••••@alta.example") {
		t.Errorf("error %q", msg)
	}
	for name, inv := range map[string]mail.Invitation{"без токена": {To: "a@b.example"}, "без адреса": {Token: token}} {
		if err := s.SendInvitation(t.Context(), inv); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
	if err := (mail.Invitations{Origin: "http://x"}).SendInvitation(t.Context(), invitation()); err == nil {
		t.Error("no sender: no error")
	}
}
