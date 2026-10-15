// Package inbox is the notification inbox of Ortus (W1.10, step 1.9 of plan 27, story S1-26): the only way to
// write and read notify.notifications of a tenant DB (tenant 0003).
//
// The audience of a notification is checked twice (02-architecture «Уведомления/realtime»):
//   - when it is enqueued (Enqueue, Consumer): the recipient is a live person with an active membership and the
//     Audience admits the rule of the notice now; otherwise no row is written;
//   - when it is read (Inbox): every group «permission × unit × sensitivity» of the recipient's notifications is
//     checked again on every request, so a revoked role hides its notifications and their unread count at once.
//
// A notice carries no restricted fields (earnings, personal data beyond a display name); a notice about restricted
// data names the permission it needs, and an active driver work function never receives a sensitive one (AC-05).
package inbox

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Severities of Notification.severity.
const (
	SeverityInfo     = "info"
	SeverityWarning  = "warning"
	SeverityCritical = "critical"
)

// Sensitivities of notify.notifications.sensitivity.
const (
	SensitivityNormal     = "normal"
	SensitivitySensitive  = "sensitive"
	SensitivityRestricted = "restricted"
)

// Limits of the contract (Notification) and of the checks of tenant 0003.
const (
	maxTitle = 300
	maxBody  = 2000
	maxLink  = 512
)

// ErrInvalid marks a notice that breaks the contract or the checks of tenant 0003.
var ErrInvalid = errors.New("inbox: invalid notification")

var (
	kindRE    = regexp.MustCompile(`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
	versionRE = regexp.MustCompile(`\.v[1-9][0-9]*$`)
)

// Object is the record a notification is about (ObjectRef of the contract). It never grants access: the target
// is authorized again when it is opened.
type Object struct {
	ModuleKey  string
	EntityType string
	EntityID   uuid.UUID
}

// Notice is a notification to enqueue for one recipient.
type Notice struct {
	Kind     string // source event type without the version suffix: fleet.trip.submitted
	Severity string // info (default) | warning | critical
	Title    string // 1…300 characters
	Body     string // up to 2000 characters; "" — none
	Link     string // same-origin application path (/fleet/trips/R-102); "" — none
	Object   *Object
	// Unit is the org unit of the object: the recipient must hold Permission over it, now and on every read.
	Unit uuid.UUID
	// Permission is the action the recipient must hold to receive and read the notification; "" — anyone the
	// producer addresses (then Unit and a non-normal Sensitivity are not allowed).
	Permission  string
	Sensitivity string    // normal (default) | sensitive | restricted: never shown to an active driver
	SourceEvent uuid.UUID // outbox.events.event_id: a repeated delivery adds nothing; uuid.Nil — a system notice
}

// Validate reports whether n may be enqueued; every error wraps ErrInvalid.
func (n Notice) Validate() error {
	_, err := n.normalized()
	return err
}

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// normalized returns n with the default severity and sensitivity, or an error wrapping ErrInvalid.
func (n Notice) normalized() (Notice, error) {
	if n.Severity == "" {
		n.Severity = SeverityInfo
	}
	if n.Sensitivity == "" {
		n.Sensitivity = SensitivityNormal
	}
	for _, check := range []func(Notice) error{checkKinds, checkTexts, checkTarget} {
		if err := check(n); err != nil {
			return n, err
		}
	}
	return n, nil
}

var (
	severities    = []string{SeverityInfo, SeverityWarning, SeverityCritical}
	sensitivities = []string{SensitivityNormal, SensitivitySensitive, SensitivityRestricted}
)

// checkKinds checks the kind, the severity and the sensitivity.
func checkKinds(n Notice) error {
	switch {
	case !kindRE.MatchString(n.Kind) || versionRE.MatchString(n.Kind):
		return invalid("kind %q: want <domain>.<entity>[.<fact>] without a version", n.Kind)
	case !slices.Contains(severities, n.Severity):
		return invalid("severity %q", n.Severity)
	case !slices.Contains(sensitivities, n.Sensitivity):
		return invalid("sensitivity %q", n.Sensitivity)
	}
	return nil
}

// checkTexts checks the title, the body and the link.
func checkTexts(n Notice) error {
	switch {
	case n.Title == "" || !utf8.ValidString(n.Title) || utf8.RuneCountInString(n.Title) > maxTitle:
		return invalid("title: 1…%d characters", maxTitle)
	case !utf8.ValidString(n.Body) || utf8.RuneCountInString(n.Body) > maxBody:
		return invalid("body: up to %d characters", maxBody)
	case n.Link != "" && !safeLink(n.Link):
		return invalid("link %q: want a same-origin path", n.Link)
	}
	return nil
}

// checkTarget checks the object and the audience rule: a unit or a sensitivity needs a permission.
func checkTarget(n Notice) error {
	switch {
	case n.Object != nil && (n.Object.ModuleKey == "" || n.Object.EntityType == "" || n.Object.EntityID == uuid.Nil):
		return invalid("object: module, type and id are required")
	case n.Permission == "" && n.Unit != uuid.Nil:
		return invalid("a unit without a permission")
	case n.Permission == "" && n.Sensitivity != SensitivityNormal:
		return invalid("a %s notification without a permission", n.Sensitivity)
	}
	return nil
}

// safeLink is the rule of Notification.link and the CHECK of tenant 0003 (as returnTo of startLogin, CWE-601):
// a single leading slash, no backslash, no whitespace or control characters, at most 512 characters.
func safeLink(link string) bool {
	if !utf8.ValidString(link) || utf8.RuneCountInString(link) > maxLink || !strings.HasPrefix(link, "/") ||
		strings.HasPrefix(link, "//") || strings.Contains(link, `\`) {
		return false
	}
	return !strings.ContainsFunc(link, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
}

// rule is what decides who may receive and read n.
func (n Notice) rule() Rule {
	return Rule{Permission: n.Permission, Unit: n.Unit, Sensitivity: n.Sensitivity}
}

// KindOf returns the type of an outbox event without its version suffix (fleet.trip.submitted.v1 →
// fleet.trip.submitted), the kind of the notifications it produces.
func KindOf(eventType string) string {
	return versionRE.ReplaceAllString(eventType, "")
}
