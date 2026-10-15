package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	netmail "net/mail"
	"net/smtp"
	"net/textproto"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ErrNoTLS: the server offers no STARTTLS and the configuration does not allow plain SMTP.
var ErrNoTLS = errors.New("mail: the SMTP server offers no STARTTLS")

// errBadRecipient: the recipient is not one bare address.
var errBadRecipient = errors.New("mail: the recipient is not an e-mail address")

// SMTP sends messages through an SMTP server, one connection per message.
type SMTP struct{ Config Config }

// Send implements Sender: EHLO, STARTTLS when offered (required unless AllowPlain), AUTH PLAIN with a username,
// MAIL, RCPT, DATA, QUIT — all within Config.Timeout and ctx. The errors carry the masked recipient and the replies
// of the server with their addresses masked (reply), never the body.
func (s *SMTP) Send(ctx context.Context, m Message) error {
	to, err := recipient(m.To)
	if err != nil {
		return err
	}
	raw, err := compose(s.Config.From, to, m, time.Now())
	if err != nil {
		return err
	}
	timeout := s.Config.Timeout
	if timeout <= 0 {
		timeout = DefaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	addr := net.JoinHostPort(s.Config.Host, strconv.Itoa(s.Config.Port))
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("mail: to %s: dial %s: %w", Mask(to), addr, err)
	}
	defer conn.Close()
	// The deadline of ctx bounds every read and write; a cancellation interrupts a blocked one.
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stop()
	if err := s.converse(conn, to, raw); err != nil {
		if ctx.Err() != nil {
			err = errors.Join(ctx.Err(), err)
		}
		return fmt.Errorf("mail: to %s via %s: %w", Mask(to), addr, err)
	}
	return nil
}

// converse is the SMTP conversation of one message over conn.
func (s *SMTP) converse(conn net.Conn, to string, raw []byte) error {
	c, err := smtp.NewClient(conn, s.Config.Host)
	if err != nil {
		return reply("greeting", err)
	}
	defer c.Close()
	if err := c.Hello(helloName(s.Config.From)); err != nil {
		return reply("EHLO", err)
	}
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(s.tlsConfig()); err != nil {
			return reply("STARTTLS", err)
		}
	} else if !s.Config.AllowPlain {
		return ErrNoTLS
	}
	if s.Config.Username != "" {
		if err := c.Auth(smtp.PlainAuth("", s.Config.Username, s.Config.Password, s.Config.Host)); err != nil {
			return reply("AUTH", err)
		}
	}
	if err := c.Mail(s.Config.From); err != nil {
		return reply("MAIL", err)
	}
	if err := c.Rcpt(to); err != nil {
		return reply("RCPT", err)
	}
	w, err := c.Data()
	if err != nil {
		return reply("DATA", err)
	}
	if _, err := w.Write(raw); err != nil {
		return reply("DATA", err)
	}
	if err := w.Close(); err != nil {
		return reply("DATA", err)
	}
	// DATA is accepted (250): the message is queued, a failed QUIT does not undo it.
	_ = c.Quit()
	return nil
}

// addressRE is an e-mail address inside the text of a server reply.
var addressRE = regexp.MustCompile(`[^\s<>"'(),;:\[\]]+@[^\s<>"'(),;:\[\]]+`)

// reply wraps the error of an SMTP step. A reply of the server keeps its code and its text, every address in the
// text masked: servers echo the recipient («550 5.1.1 <ivan@example.com>: Recipient address rejected»), the sender
// or the login, and the request log writes the error. Other errors (the network, TLS) carry no text of the server.
func reply(step string, err error) error {
	if te, ok := errors.AsType[*textproto.Error](err); ok {
		masked := addressRE.ReplaceAllStringFunc(te.Msg, Mask)
		return fmt.Errorf("%s: %w", step, &textproto.Error{Code: te.Code, Msg: masked})
	}
	return fmt.Errorf("%s: %w", step, err)
}

func (s *SMTP) tlsConfig() *tls.Config {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if s.Config.TLS != nil {
		cfg = s.Config.TLS.Clone()
	}
	if cfg.ServerName == "" {
		cfg.ServerName = s.Config.Host
	}
	return cfg
}

// helloName is the domain of the sender address (EHLO wants the name of the client; the relay of the domain knows it).
func helloName(from string) string {
	if _, domain, ok := strings.Cut(from, "@"); ok && domain != "" {
		return domain
	}
	return "localhost"
}

// recipient is the bare address of to.
func recipient(to string) (string, error) {
	if strings.ContainsAny(to, "\r\n") {
		return "", errBadRecipient
	}
	a, err := netmail.ParseAddress(strings.TrimSpace(to))
	if err != nil || a.Name != "" {
		return "", fmt.Errorf("%w: %s", errBadRecipient, Mask(to))
	}
	return a.Address, nil
}

// oneLine keeps a header value on one line: CR and LF of the data become spaces.
func oneLine(s string) string {
	return strings.Join(strings.Fields(strings.NewReplacer("\r", " ", "\n", " ").Replace(s)), " ")
}

// compose renders the message: RFC 5322 headers (RFC 2047 words for non-ASCII), multipart/alternative of a
// quoted-printable text and HTML (text only without HTML), CRLF line ends.
func compose(from, to string, m Message, at time.Time) ([]byte, error) {
	id, err := messageID(from)
	if err != nil {
		return nil, err
	}
	var b bytes.Buffer
	header := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	header("From", (&netmail.Address{Name: oneLine(m.FromName), Address: from}).String())
	header("To", (&netmail.Address{Address: to}).String())
	header("Subject", mime.QEncoding.Encode("utf-8", oneLine(m.Subject)))
	header("Date", at.Format(time.RFC1123Z))
	header("Message-ID", id)
	header("MIME-Version", "1.0")
	if m.HTML == "" {
		header("Content-Type", "text/plain; charset=utf-8")
		header("Content-Transfer-Encoding", "quoted-printable")
		b.WriteString("\r\n")
		if err := qp(&b, m.Text); err != nil {
			return nil, err
		}
		return b.Bytes(), nil
	}
	mw := multipart.NewWriter(&b)
	header("Content-Type", "multipart/alternative; boundary="+mw.Boundary())
	b.WriteString("\r\n")
	for _, part := range []struct{ media, body string }{{"text/plain", m.Text}, {"text/html", m.HTML}} {
		w, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type": {part.media + "; charset=utf-8"}, "Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, err
		}
		if err := qp(w, part.body); err != nil {
			return nil, err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// qp writes body quoted-printable (lines ≤ 76 characters, CRLF line ends).
func qp(w io.Writer, body string) error {
	q := quotedprintable.NewWriter(w)
	if _, err := q.Write([]byte(body)); err != nil {
		return err
	}
	return q.Close()
}

// messageID is a random Message-ID in the domain of the sender.
func messageID(from string) (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("mail: message id: %w", err)
	}
	return "<" + hex.EncodeToString(b) + "@" + helloName(from) + ">", nil
}
