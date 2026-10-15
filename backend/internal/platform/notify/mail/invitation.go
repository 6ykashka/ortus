package mail

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html/template"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Texts of the invitation letter: the reference «Оформление → Письмо» (design-stage-1, «Ортус CRM.dc.html»:1424–1432;
// the inviter is the current user, me ? me.name : 'Владелец', :3736). The reference has no subject (Q-W1.41-2).
const (
	invitationPath   = "/auth/invitation"
	textFromSuffix   = " · через Ортус"
	textInvites      = "%s приглашает вас в «%s». Приглашение действует %s."
	textAccept       = "Принять приглашение"
	textOnBehalf     = "Письмо отправлено по поручению организации. Если вы не ждали приглашения, просто удалите его."
	textPoweredBy    = "Работает на Ортус" // BRAND_DEFAULT.poweredBy = true: the branding of a business is not on the server yet
	textSubject      = "Приглашение в «%s»"
	textOwner        = "Владелец"
	defaultValidDays = 7
	accent           = "#1F6B52" // BRAND_DEFAULT.accent
)

// Invitation is the letter of a new invitation into a business.
type Invitation struct {
	To       string        // e-mail of the invited person
	Token    string        // the one-time token of the link: only in the body of the message
	Business string        // name of the business
	Inviter  string        // full name of the person who invites; "" — «Владелец»
	Valid    time.Duration // lifetime of the link; 0 — 7 days
}

// Invitations sends invitation letters.
type Invitations struct {
	Sender Sender
	Origin string // PUBLIC_ORIGIN
}

// InvitationLink is the link of a letter: the token goes in the URL fragment, so it never reaches a server log or a
// Referer (inspectInvitation and acceptInvitation take it in the body).
func InvitationLink(origin, token string) string {
	return strings.TrimRight(origin, "/") + invitationPath + "#token=" + url.QueryEscape(token)
}

// letterHTML is the HTML part: the card of the reference with the accent of the default branding.
var letterHTML = template.Must(template.New("invitation").Parse(`<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>{{.Subject}}</title></head>
<body style="margin:0;padding:24px 16px;background:#F2F3EF;font-family:Arial,Helvetica,sans-serif;color:#1C2A26;">
<div style="max-width:520px;margin:0 auto;padding:20px;border-radius:10px;background:#FFFFFF;border-top:4px solid ` + accent + `;">
<p style="margin:0 0 12px;font-size:16px;font-weight:600;">{{.Business}}</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;">{{.Invites}}</p>
<p style="margin:0 0 16px;"><a href="{{.Link}}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:` + accent + `;color:#FFFFFF;font-weight:500;text-decoration:none;">{{.Accept}}</a></p>
<p style="margin:0 0 8px;font-size:11px;line-height:1.5;color:#5C6964;">{{.OnBehalf}}</p>
<p style="margin:0;font-size:11px;color:#5C6964;">{{.PoweredBy}}</p>
</div>
</body>
</html>
`))

// Letter is the message of inv.
func (s Invitations) Letter(inv Invitation) Message {
	inviter := strings.TrimSpace(inv.Inviter)
	if inviter == "" {
		inviter = textOwner
	}
	link := InvitationLink(s.Origin, inv.Token)
	subject := fmt.Sprintf(textSubject, inv.Business)
	invites := fmt.Sprintf(textInvites, inviter, inv.Business, days(inv.Valid))
	text := strings.Join([]string{invites, textAccept + ": " + link, textOnBehalf, textPoweredBy}, "\n\n") + "\n"
	var html bytes.Buffer
	_ = letterHTML.Execute(&html, map[string]string{ // the data are strings: the template cannot fail
		"Subject": subject, "Business": inv.Business, "Invites": invites, "Link": link, "Accept": textAccept,
		"OnBehalf": textOnBehalf, "PoweredBy": textPoweredBy,
	})
	return Message{FromName: inv.Business + textFromSuffix, To: inv.To, Subject: subject, Text: text, HTML: html.String()}
}

// SendInvitation sends the letter of inv. Its error names the recipient masked and never carries the token.
func (s Invitations) SendInvitation(ctx context.Context, inv Invitation) error {
	switch {
	case s.Sender == nil:
		return errors.New("mail: no sender of the invitation letters")
	case strings.TrimSpace(inv.To) == "" || inv.Token == "":
		return errors.New("mail: an invitation letter needs the recipient and the token")
	}
	if err := s.Sender.Send(ctx, s.Letter(inv)); err != nil {
		return fmt.Errorf("mail: invitation letter to %s: %w", Mask(inv.To), err)
	}
	return nil
}

// days is «N день|дня|дней» of a lifetime, rounded up to whole days.
func days(valid time.Duration) string {
	n := defaultValidDays
	if valid > 0 {
		n = int((valid + 24*time.Hour - 1) / (24 * time.Hour))
	}
	word := "дней"
	switch mod10, mod100 := n%10, n%100; {
	case mod10 == 1 && mod100 != 11:
		word = "день"
	case mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14):
		word = "дня"
	}
	return strconv.Itoa(n) + " " + word
}
