package mail_test

import (
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

// T-1. Стенд (dev, e2e): SMTP без TLS допустим, отправитель и адрес SPA — по умолчанию; prod требует всё и https.
func TestFromEnvStand(t *testing.T) {
	t.Parallel()
	c, err := mail.FromEnv(env(map[string]string{
		"SMTP_HOST": "localhost", "SMTP_PORT": "1225", "ALLOWED_ORIGINS": "http://localhost:5202, http://127.0.0.1:5202",
	}), "dev")
	if err != nil {
		t.Fatal(err)
	}
	want := mail.Config{Host: "localhost", Port: 1225, From: "no-reply@ortus.local", Origin: "http://localhost:5202",
		AllowPlain: true, Timeout: 10 * time.Second}
	if c != want {
		t.Fatalf("config %+v, want %+v", c, want)
	}
	if !c.Enabled() {
		t.Error("SMTP_HOST is set: delivery is on")
	}
	if _, ok := mail.New(c, slog.New(slog.DiscardHandler)).(*mail.SMTP); !ok {
		t.Error("New: want *mail.SMTP")
	}

	c, err = mail.FromEnv(env(map[string]string{
		"SMTP_HOST": "mailpit", "MAIL_FROM": "robot@alta.example", "PUBLIC_ORIGIN": "http://127.0.0.1:5213/",
	}), "e2e")
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 25 || c.From != "robot@alta.example" || c.Origin != "http://127.0.0.1:5213" || !c.AllowPlain {
		t.Errorf("e2e: %+v", c)
	}
}

// Без SMTP_HOST вне prod доставка выключена (набор изоляции, unit-стенды): письмо не уходит, ошибки нет.
func TestFromEnvOff(t *testing.T) {
	t.Parallel()
	c, err := mail.FromEnv(env(nil), "e2e")
	if err != nil {
		t.Fatal(err)
	}
	if c.Enabled() || c.Origin != "http://localhost:5173" {
		t.Fatalf("config %+v", c)
	}
	if _, ok := mail.New(c, slog.New(slog.DiscardHandler)).(mail.Off); !ok {
		t.Error("New: want mail.Off")
	}
}

func TestFromEnvProd(t *testing.T) {
	t.Parallel()
	c, err := mail.FromEnv(env(map[string]string{
		"SMTP_HOST": "smtp.ortus.example", "SMTP_PORT": "587", "MAIL_FROM": "no-reply@ortus.example",
		"PUBLIC_ORIGIN": "https://app.ortus.example", "SMTP_USERNAME": "ortus", "SMTP_PASSWORD": "secret",
	}), "prod")
	if err != nil {
		t.Fatal(err)
	}
	if c.AllowPlain || c.Port != 587 || c.Username != "ortus" || c.Password != "secret" {
		t.Errorf("prod: %+v", c)
	}
	for name, tc := range map[string]struct {
		env  map[string]string
		want []string
	}{
		"пусто":            {map[string]string{}, []string{"SMTP_HOST", "MAIL_FROM", "PUBLIC_ORIGIN"}},
		"http":             {map[string]string{"SMTP_HOST": "h", "MAIL_FROM": "a@b.example", "PUBLIC_ORIGIN": "http://app.example"}, []string{"PUBLIC_ORIGIN"}},
		"путь":             {map[string]string{"SMTP_HOST": "h", "MAIL_FROM": "a@b.example", "PUBLIC_ORIGIN": "https://app.example/x"}, []string{"PUBLIC_ORIGIN"}},
		"порт":             {map[string]string{"SMTP_HOST": "h", "MAIL_FROM": "a@b.example", "PUBLIC_ORIGIN": "https://a.example", "SMTP_PORT": "70000"}, []string{"SMTP_PORT"}},
		"адрес с именем":   {map[string]string{"SMTP_HOST": "h", "MAIL_FROM": "Ортус <a@b.example>", "PUBLIC_ORIGIN": "https://a.example"}, []string{"MAIL_FROM"}},
		"пароль без имени": {map[string]string{"SMTP_HOST": "h", "MAIL_FROM": "a@b.example", "PUBLIC_ORIGIN": "https://a.example", "SMTP_PASSWORD": "x"}, []string{"SMTP_USERNAME"}},
	} {
		_, err := mail.FromEnv(env(tc.env), "prod")
		if err == nil {
			t.Errorf("%s: no error", name)
			continue
		}
		for _, w := range tc.want {
			if !strings.Contains(err.Error(), w) {
				t.Errorf("%s: %v, want %s", name, err, w)
			}
		}
		if strings.Contains(err.Error(), "secret") {
			t.Errorf("%s: the password in the error", name)
		}
	}
}

// Кривые значения вне prod — тоже ошибка при старте, а не молчаливое «выключено».
func TestFromEnvInvalidStand(t *testing.T) {
	t.Parallel()
	for name, e := range map[string]map[string]string{
		"порт":   {"SMTP_HOST": "localhost", "SMTP_PORT": "abc"},
		"адрес":  {"SMTP_HOST": "localhost", "MAIL_FROM": "nobody"},
		"origin": {"SMTP_HOST": "localhost", "PUBLIC_ORIGIN": "localhost:5173"},
	} {
		if _, err := mail.FromEnv(env(e), "dev"); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}
