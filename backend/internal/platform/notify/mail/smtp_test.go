package mail_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
)

func sender(s *mailtest.Server, plain bool) *mail.SMTP {
	return &mail.SMTP{Config: mail.Config{Host: s.Host, Port: s.Port, From: "no-reply@ortus.local", Origin: "http://localhost:5202",
		AllowPlain: plain, Timeout: 5 * time.Second, TLS: s.TLS}}
}

// T-3. Письмо доходит до SMTP-сервера и разбирается: конверт, заголовки RFC 2047, текст и HTML в quoted-printable.
func TestSMTPSend(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{})
	letter := mail.Invitations{Origin: "http://localhost:5202"}.Letter(invitation())
	letter.Text += "\n.строка с точкой в начале\n" + strings.Repeat("длинная строка ", 20)
	if err := sender(srv, true).Send(t.Context(), letter); err != nil {
		t.Fatal(err)
	}
	got := srv.Wait(t, 1)[0]
	if got.From != "no-reply@ortus.local" || len(got.To) != 1 || got.To[0] != "i.testov@alta.example" || got.TLS {
		t.Errorf("envelope %+v", got)
	}
	checkLetter(t, got.Data, letter)
}

func checkLetter(t *testing.T, data []byte, letter mail.Message) {
	t.Helper()
	l := mailtest.Parse(t, data)
	if l.FromName != "Альта Групп · через Ортус" || l.From != "no-reply@ortus.local" || l.To != "i.testov@alta.example" ||
		l.Subject != "Приглашение в «Альта Групп»" {
		t.Errorf("headers %+v", l)
	}
	if l.Text != strings.ReplaceAll(letter.Text, "\r\n", "\n") || l.HTML != letter.HTML {
		t.Errorf("bodies differ:\n%q\n%q", l.Text, letter.Text)
	}
	if l.Token() != token {
		t.Errorf("token %q", l.Token())
	}
	for _, h := range []string{"Date", "Message-Id", "Mime-Version"} {
		if l.Header.Get(h) == "" {
			t.Errorf("no header %s", h)
		}
	}
	for line := range strings.SplitSeq(string(data), "\n") {
		if len(line) > 998 {
			t.Errorf("line of %d bytes", len(line))
		}
	}
}

// Без TLS письмо уходит только на стенде (dev, e2e); в prod сервер без STARTTLS — ошибка до MAIL FROM.
func TestSMTPRequiresTLS(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{})
	err := sender(srv, false).Send(t.Context(), mail.Invitations{Origin: "http://x"}.Letter(invitation()))
	if !errors.Is(err, mail.ErrNoTLS) {
		t.Fatalf("plain SMTP outside the stand: %v", err)
	}
	if n := len(srv.Messages()); n != 0 {
		t.Errorf("%d messages over plain SMTP", n)
	}
}

// STARTTLS — всегда, когда сервер его предлагает; AUTH PLAIN — только поверх TLS.
func TestSMTPStartTLS(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{StartTLS: true})
	s := sender(srv, false)
	s.Config.Username, s.Config.Password = "ortus", "secret"
	if err := s.Send(t.Context(), mail.Invitations{Origin: "http://x"}.Letter(invitation())); err != nil {
		t.Fatal(err)
	}
	got := srv.Wait(t, 1)[0]
	if !got.TLS || !strings.HasPrefix(got.Auth, "AUTH PLAIN") {
		t.Errorf("message %+v", got)
	}
}

// Отказ сервера на любом шаге — ошибка; письмо не принято.
func TestSMTPRefusals(t *testing.T) {
	t.Parallel()
	for _, verb := range []string{"MAIL", "RCPT", "DATA"} {
		srv := mailtest.Start(t, mailtest.Options{})
		srv.Refuse(verb, "451 4.3.0 try again later")
		err := sender(srv, true).Send(t.Context(), mail.Invitations{Origin: "http://x"}.Letter(invitation()))
		if err == nil || !strings.Contains(err.Error(), "451") {
			t.Errorf("%s refused: %v", verb, err)
			continue
		}
		if strings.Contains(err.Error(), token) {
			t.Errorf("%s: the token in the error", verb)
		}
		if n := len(srv.Messages()); n != 0 {
			t.Errorf("%s refused: %d messages", verb, n)
		}
	}
}

// Ответ сервера повторяет адрес («550 5.1.1 <ivan@x>: Recipient address rejected»): в ошибке (её пишет журнал
// запроса) остаются код и текст ответа, адреса — только маской; адрес отправителя и логин AUTH — тоже маской.
func TestSMTPRefusalMasksAddresses(t *testing.T) {
	t.Parallel()
	for verb, reply := range map[string]string{
		"RCPT": "550 5.1.1 <i.testov@alta.example>: Recipient address rejected: User unknown",
		"DATA": "554 5.7.1 message to I.Testov@Alta.example from no-reply@ortus.local refused",
		"MAIL": "553 5.7.1 sender no-reply@ortus.local rejected for i.testov@alta.example",
		"AUTH": "535 5.7.8 authentication failed for ortus@alta.example",
	} {
		srv := mailtest.Start(t, mailtest.Options{})
		srv.Refuse(verb, reply)
		s := sender(srv, true)
		s.Config.Username, s.Config.Password = "ortus@alta.example", "secret"
		err := s.Send(t.Context(), mail.Invitations{Origin: "http://x"}.Letter(invitation()))
		if err == nil {
			t.Errorf("%s refused: no error", verb)
			continue
		}
		msg := err.Error()
		if !strings.Contains(msg, reply[:3]) || !strings.Contains(msg, verb) {
			t.Errorf("%s refused: no code of the reply in %q", verb, msg)
		}
		for _, addr := range []string{"i.testov@", "I.Testov@", "no-reply@", "ortus@alta"} {
			if strings.Contains(msg, addr) {
				t.Errorf("%s refused: %q in %q", verb, addr, msg)
			}
		}
		if verb == "RCPT" && !strings.Contains(msg, "i•••••@alta.example") {
			t.Errorf("RCPT refused: no masked recipient in %q", msg)
		}
	}
}

// Молчащий сервер и недоступный адрес — ошибка не позже срока, без зависания запроса.
func TestSMTPTimeout(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{Silent: true})
	s := sender(srv, true)
	s.Config.Timeout = 300 * time.Millisecond
	start := time.Now()
	err := s.Send(t.Context(), mail.Invitations{Origin: "http://x"}.Letter(invitation()))
	// The bound is loose: a loaded Windows runner cancels a loopback dial seconds late (the timeout is 300 ms).
	if err == nil || time.Since(start) > 8*time.Second {
		t.Fatalf("silent server: %v after %v", err, time.Since(start))
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err := sender(srv, true).Send(ctx, mail.Message{To: "a@b.example", Subject: "x", Text: "x"}); err == nil {
		t.Error("cancelled context: no error")
	}
}

// Заголовки не разрываются переводом строки из данных; кривой адрес получателя — ошибка до соединения.
func TestSMTPHeaderInjection(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{})
	s := sender(srv, true)
	m := mail.Message{FromName: "Альта\r\nBcc: spy@evil.example", To: "a@b.example", Subject: "Тема\nBcc: spy@evil.example", Text: "x"}
	if err := s.Send(t.Context(), m); err != nil {
		t.Fatal(err)
	}
	got := srv.Wait(t, 1)[0]
	if len(got.To) != 1 || strings.Contains(strings.ToLower(string(got.Data)), "\nbcc:") {
		t.Errorf("injected header:\n%s", got.Data)
	}
	if err := s.Send(t.Context(), mail.Message{To: "a@b.example\r\nRCPT TO:<spy@evil.example>", Text: "x"}); err == nil {
		t.Error("recipient with CRLF: no error")
	}
}

// T-4. Доставка выключена: ошибки нет, в журнале — маска адреса и тема, без токена.
func TestOff(t *testing.T) {
	t.Parallel()
	var logs bytes.Buffer
	off := mail.Off{Log: slog.New(slog.NewJSONHandler(&logs, nil))}
	if err := off.Send(t.Context(), mail.Invitations{Origin: "http://x"}.Letter(invitation())); err != nil {
		t.Fatal(err)
	}
	out := logs.String()
	if !strings.Contains(out, "i•••••@alta.example") || !strings.Contains(out, "Приглашение в «Альта Групп»") ||
		strings.Contains(out, token) || strings.Contains(out, "i.testov@") {
		t.Errorf("log %s", out)
	}
}

func TestMask(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"d.zimina@alta.example": "d•••••@alta.example",
		"Ёжик@почта.рф":         "Ё•••••@почта.рф",
		"broken":                "•••••",
		"@alta.example":         "•••••@alta.example",
	} {
		if got := mail.Mask(in); got != want {
			t.Errorf("%s: %s, want %s", in, got, want)
		}
	}
}
