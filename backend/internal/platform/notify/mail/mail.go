// Package mail sends the e-mail of the platform (W1.41): the invitation letter of a person invited into a business
// (S1-06). It is stdlib only: net/smtp with STARTTLS when the server offers it (required outside APP_ENV dev and
// e2e), quoted-printable bodies and RFC 2047 headers.
//
// A secret a letter carries (the one-time token of an invitation) leaves the process only in the body of the
// message: errors and log records name the recipient masked and never the body.
package mail

import (
	"context"
	"log/slog"
	"strings"
	"unicode/utf8"
)

// Message is one e-mail.
type Message struct {
	FromName string // display name of the sender; the address is Config.From
	To       string // one recipient address
	Subject  string
	Text     string // text/plain body
	HTML     string // text/html body; "" — text only
}

// Sender delivers a message.
type Sender interface {
	Send(ctx context.Context, m Message) error
}

// Off is the sender of a deployment without SMTP (no SMTP_HOST outside prod): it drops the message and logs only the
// masked recipient and the subject.
type Off struct{ Log *slog.Logger }

// Send implements Sender.
func (o Off) Send(ctx context.Context, m Message) error {
	log := o.Log
	if log == nil {
		log = slog.Default()
	}
	log.InfoContext(ctx, "mail: delivery is off (SMTP_HOST is not set), the message is dropped",
		slog.String("to", Mask(m.To)), slog.String("subject", m.Subject))
	return nil
}

// mask replaces the local part of an address but its first letter.
const mask = "•••••"

// Mask hides an address but the first letter of its local part: d•••••@alta.example.
func Mask(addr string) string {
	local, domain, ok := strings.Cut(strings.TrimSpace(addr), "@")
	if !ok {
		return mask
	}
	r, _ := utf8.DecodeRuneInString(local)
	if r == utf8.RuneError {
		return mask + "@" + domain
	}
	return string(r) + mask + "@" + domain
}
