package docs

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
)

// Kinds, modes and statuses of the steps of a route (docs.route_steps), the decisions and their methods, the statuses
// of a route (docs.routes).
const (
	stepApprove  = "approve"
	stepSign     = "sign"
	stepAck      = "ack"
	stepExternal = "external"

	modeAll = "all"
	modeSeq = "seq"
	modeAny = "any"

	stepStatusWait   = "wait"
	stepStatusActive = "active"
	stepStatusDone   = "done"

	decisionOK   = "ok"
	decisionBack = "back"

	methodClick    = "click"
	methodPEPLogin = "pep_login"
	methodPEPSMS   = "pep_sms"
	methodSMSLink  = "sms_link"

	routeActive    = "active"
	routeReturned  = "returned"
	routeDone      = "done"
	routeCancelled = "cancelled"

	stepsMax = 6
	daysMax  = 90

	keyVersion = "version"
	keyRouteID = "routeId"
	keyStep    = "step"
)

// decision is a decision of a member on a step (docs.route_decisions).
type decision struct {
	member  uuid.UUID
	kind    string // ok | back
	method  string
	comment string
	at      time.Time
}

// extStep is the customer of a step «Подпись заказчика»: the name and the phone (the SMS link, D-31).
type extStep struct {
	name  string
	phone string
}

// routeStep is a step of a route with what decides it: the decisions, the acknowledgements, the customer.
type routeStep struct {
	pos       int
	kind      string
	name      string
	mode      string
	who       []uuid.UUID // the approvers, the signer, the addressees of an acknowledgement (resolved when the step starts)
	audience  []byte      // the entries of the audience of an acknowledgement (json)
	days      int
	status    string
	due       *time.Time
	ext       extStep
	closed    bool // an acknowledgement finished early
	decisions []decision
	acked     []uuid.UUID
}

// waiting are the members whose decision the active step waits for (stepWaiting): «все сразу» all that have not
// agreed, «по очереди» the first of them, «достаточно одного» nobody once one has agreed; a signature — the signer; an
// acknowledgement — those who have not acknowledged. The customer of an external step is no member: see externalWaiting.
func (s *routeStep) waiting() []uuid.UUID {
	if s == nil || s.status != stepStatusActive {
		return nil
	}
	switch s.kind {
	case stepApprove:
		left := s.left(s.agreed())
		switch s.mode {
		case modeSeq:
			return left[:min(1, len(left))]
		case modeAny:
			if len(s.agreed()) > 0 {
				return nil
			}
		}
		return left
	case stepSign:
		if len(s.agreed()) > 0 || len(s.who) == 0 {
			return nil
		}
		return s.who[:1]
	case stepAck:
		return s.left(s.acked)
	}
	return nil
}

// externalWaiting reports whether an active step of the customer waits for his signature.
func (s *routeStep) externalWaiting() bool {
	return s.kind == stepExternal && s.status == stepStatusActive && len(s.agreed()) == 0
}

// agreed are the members who decided «ok».
func (s *routeStep) agreed() []uuid.UUID {
	var out []uuid.UUID
	for _, d := range s.decisions {
		if d.kind == decisionOK {
			out = append(out, d.member)
		}
	}
	return out
}

// left are the members of the step not in done, in the order of the step.
func (s *routeStep) left(done []uuid.UUID) []uuid.UUID {
	var out []uuid.UUID
	for _, m := range s.who {
		if !slices.Contains(done, m) {
			out = append(out, m)
		}
	}
	return out
}

// addWorkdays is the day n working days after from (Saturday and Sunday are skipped; a step lasts a day at least).
func addWorkdays(from time.Time, n int) time.Time {
	d := from
	for i := max(n, 1); i > 0; {
		d = d.AddDate(0, 0, 1)
		if wd := d.Weekday(); wd != time.Saturday && wd != time.Sunday {
			i--
		}
	}
	return d
}

// stepName is the name of a step the route shows (STEP_KINDS of the prototype).
func stepName(kind string) string {
	switch kind {
	case stepApprove:
		return "Согласовать"
	case stepSign:
		return "Утвердить"
	case stepAck:
		return "Ознакомить"
	case stepExternal:
		return "Подпись заказчика"
	}
	return kind
}

// maskPhone hides a phone but the first digits and the last two: «+7 9•• •••-••-42».
func maskPhone(phone string) string {
	var digits []rune
	for _, c := range phone {
		if unicode.IsDigit(c) {
			digits = append(digits, c)
		}
	}
	if len(digits) < 5 {
		return ""
	}
	return "+" + string(digits[0]) + " " + string(digits[1]) + "•• •••-••-" + string(digits[len(digits)-2:])
}

// phoneDigits is a phone as it is stored: digits only.
func phoneDigits(phone string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsDigit(r) {
			return r
		}
		return -1
	}, phone)
}

// The challenge of a signature: the second confirmation asked before docSign (docSignStart). It lives in the rules of
// the route (docs.routes.rules.sign) until it is used, expires or runs out of attempts.
const (
	signTTL   = 10 * time.Minute
	signTries = 3
)

// challenge is a challenge of a signature: who, by what method, the digest of the code (empty for the login), the
// term and the wrong attempts so far.
type challenge struct {
	method  string
	member  uuid.UUID
	hash    string
	expires time.Time
	tries   int
}

// signCode is the four-digit code of a challenge: a digest of the key and of the nonce of the challenge.
func signCode(key []byte, route, member uuid.UUID, nonce int) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("ortus.docs.sign.code|"))
	m.Write(route[:])
	m.Write(member[:])
	var n [8]byte
	binary.BigEndian.PutUint64(n[:], uint64(nonce)) //nolint:gosec // G115: the nonce is a counter of the time, never negative
	m.Write(n[:])
	v := binary.BigEndian.Uint32(m.Sum(nil)[:4])
	return itoa4(1000 + v%9000)
}

func itoa4(v uint32) string {
	b := []byte{'0', '0', '0', '0'}
	for i := 3; i >= 0; i-- {
		b[i] = byte('0' + v%10)
		v /= 10
	}
	return string(b)
}

// digest is what a challenge keeps of a code: the code itself is never stored.
func digest(key []byte, route, member uuid.UUID, code string) string {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("ortus.docs.sign.hash|"))
	m.Write(route[:])
	m.Write(member[:])
	m.Write([]byte(code))
	return hex.EncodeToString(m.Sum(nil))
}

// newChallenge starts a challenge at now; code is "" for the repeated sign-in.
func newChallenge(key []byte, route, member uuid.UUID, method, code string, now time.Time) challenge {
	c := challenge{method: method, member: member, expires: now.Add(signTTL)}
	if code != "" {
		c.hash = digest(key, route, member, code)
	}
	return c
}

// matches reports whether code is the code of the challenge.
func (c challenge) matches(key []byte, route, member uuid.UUID, code string) bool {
	return c.hash != "" && hmac.Equal([]byte(c.hash), []byte(digest(key, route, member, strings.TrimSpace(code))))
}

type challengeJSON struct {
	Method  string    `json:"method"`
	Member  uuid.UUID `json:"member"`
	Hash    string    `json:"hash,omitempty"`
	Expires time.Time `json:"expires"`
	Tries   int       `json:"tries"`
}

func (c challenge) marshal() []byte {
	raw, _ := json.Marshal(challengeJSON{Method: c.method, Member: c.member, Hash: c.hash, Expires: c.expires.UTC(), Tries: c.tries})
	return raw
}

// parseChallenge reads a stored challenge; false — none or broken.
func parseChallenge(raw []byte) (challenge, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return challenge{}, false
	}
	var j challengeJSON
	if err := json.Unmarshal(raw, &j); err != nil || j.Member == uuid.Nil || j.Method == "" {
		return challenge{}, false
	}
	return challenge{method: j.Method, member: j.Member, hash: j.Hash, expires: j.Expires, tries: j.Tries}, true
}
