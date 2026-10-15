package mailtest

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	netmail "net/mail"
	"regexp"
	"strings"
	"testing"
)

// Letter is a parsed message: decoded headers and the text and HTML bodies.
type Letter struct {
	Header   netmail.Header
	FromName string // display name of From, decoded
	From     string // address of From
	To       string // address of To
	Subject  string // decoded
	Text     string // text/plain body, decoded, with LF line ends
	HTML     string // text/html body, decoded, with LF line ends
}

// errNoBoundary: a multipart message without its boundary.
var errNoBoundary = errors.New("mailtest: multipart without boundary")

// tokenInLink is the token of an invitation link (<origin>/auth/invitation#token=<token>).
var tokenInLink = regexp.MustCompile(`/auth/invitation#token=([A-Za-z0-9_-]+)`)

// Token returns the invitation token of the link in the text body ("" — none).
func (l Letter) Token() string {
	m := tokenInLink.FindStringSubmatch(l.Text)
	if m == nil {
		return ""
	}
	return m[1]
}

// Parse reads a message as the server received it.
func Parse(tb testing.TB, data []byte) Letter {
	tb.Helper()
	l, err := parse(data)
	if err != nil {
		tb.Fatalf("mailtest: %v\n%s", err, data)
	}
	return l
}

func parse(data []byte) (Letter, error) {
	msg, err := netmail.ReadMessage(bytes.NewReader(data))
	if err != nil {
		return Letter{}, err
	}
	l, err := headers(msg.Header)
	if err != nil {
		return Letter{}, err
	}
	media, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil {
		return Letter{}, fmt.Errorf("content type: %w", err)
	}
	if !strings.HasPrefix(media, "multipart/") {
		body, err := decode(msg.Body, msg.Header.Get("Content-Transfer-Encoding"))
		if err != nil {
			return Letter{}, err
		}
		l.assign(media, body)
		return l, nil
	}
	if params["boundary"] == "" {
		return Letter{}, errNoBoundary
	}
	mr := multipart.NewReader(msg.Body, params["boundary"])
	for {
		p, err := mr.NextPart() // decodes quoted-printable itself
		if errors.Is(err, io.EOF) {
			return l, nil
		}
		if err != nil {
			return Letter{}, err
		}
		body, err := io.ReadAll(p)
		if err != nil {
			return Letter{}, err
		}
		pm, _, err := mime.ParseMediaType(p.Header.Get("Content-Type"))
		if err != nil {
			return Letter{}, err
		}
		l.assign(pm, string(body))
	}
}

// headers decodes Subject, From and To.
func headers(h netmail.Header) (Letter, error) {
	l := Letter{Header: h}
	var (
		dec mime.WordDecoder
		err error
	)
	if l.Subject, err = dec.DecodeHeader(h.Get("Subject")); err != nil {
		return Letter{}, fmt.Errorf("subject: %w", err)
	}
	from, err := netmail.ParseAddress(h.Get("From"))
	if err != nil {
		return Letter{}, fmt.Errorf("from: %w", err)
	}
	to, err := netmail.ParseAddress(h.Get("To"))
	if err != nil {
		return Letter{}, fmt.Errorf("to: %w", err)
	}
	l.FromName, l.From, l.To = from.Name, from.Address, to.Address
	return l, nil
}

func (l *Letter) assign(media, body string) {
	body = strings.ReplaceAll(body, "\r\n", "\n")
	switch media {
	case "text/plain":
		l.Text = body
	case "text/html":
		l.HTML = body
	}
}

func decode(r io.Reader, encoding string) (string, error) {
	if strings.EqualFold(encoding, "quoted-printable") {
		r = quotedprintable.NewReader(r)
	}
	b, err := io.ReadAll(r)
	return string(b), err
}
