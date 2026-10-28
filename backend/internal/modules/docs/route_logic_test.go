package docs

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

func ids(n int) []uuid.UUID {
	out := make([]uuid.UUID, n)
	for i := range out {
		out[i] = uuid.New()
	}
	return out
}

func ok(m uuid.UUID) decision { return decision{member: m, kind: decisionOK, method: methodClick} }

// Who waits at an active step (stepWaiting of the prototype): «все сразу», «по очереди», «достаточно одного».
func TestStepWaitingApprove(t *testing.T) {
	t.Parallel()
	who := ids(3)
	for _, c := range []struct {
		name string
		mode string
		done []decision
		want []uuid.UUID
	}{
		{"all, nobody yet", modeAll, nil, who},
		{"all, one agreed", modeAll, []decision{ok(who[1])}, []uuid.UUID{who[0], who[2]}},
		{"seq, the first of the queue", modeSeq, nil, who[:1]},
		{"seq, the next one", modeSeq, []decision{ok(who[0])}, who[1:2]},
		{"any, nobody yet", modeAny, nil, who},
		{"any, one agreed — nobody waits", modeAny, []decision{ok(who[2])}, nil},
		{"all, everyone agreed", modeAll, []decision{ok(who[0]), ok(who[1]), ok(who[2])}, nil},
	} {
		s := routeStep{kind: stepApprove, mode: c.mode, who: who, status: stepStatusActive, decisions: c.done}
		if got := s.waiting(); !slices.Equal(got, c.want) {
			t.Errorf("%s: waiting %v, want %v", c.name, got, c.want)
		}
	}
	s := routeStep{kind: stepApprove, mode: modeAll, who: who, status: stepStatusWait}
	if got := s.waiting(); len(got) != 0 {
		t.Errorf("a step that has not started waits for %v", got)
	}
}

func TestStepWaitingSignExternalAck(t *testing.T) {
	t.Parallel()
	who := ids(3)
	sign := routeStep{kind: stepSign, who: who[:1], status: stepStatusActive}
	if got := sign.waiting(); !slices.Equal(got, who[:1]) {
		t.Errorf("sign waits for %v, want the signer", got)
	}
	sign.decisions = []decision{ok(who[0])}
	if got := sign.waiting(); len(got) != 0 {
		t.Errorf("a signed step waits for %v", got)
	}
	ext := routeStep{kind: stepExternal, status: stepStatusActive}
	if !ext.externalWaiting() || len(ext.waiting()) != 0 {
		t.Error("the external step waits for the customer, not for a member")
	}
	ext.decisions = []decision{{member: who[0], kind: decisionOK, method: methodSMSLink}}
	if ext.externalWaiting() {
		t.Error("a signed external step still waits")
	}
	ack := routeStep{kind: stepAck, who: who, status: stepStatusActive, acked: []uuid.UUID{who[1]}}
	if got := ack.waiting(); !slices.Equal(got, []uuid.UUID{who[0], who[2]}) {
		t.Errorf("ack waits for %v, want those who have not acknowledged", got)
	}
}

// The term of a step counts working days from the day of the start (addWork, DOC_TODAY).
func TestAddWorkdays(t *testing.T) {
	t.Parallel()
	day := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }
	for _, c := range []struct {
		from time.Time
		n    int
		want time.Time
	}{
		{day(2026, 10, 14), 1, day(2026, 10, 15)}, // Wednesday → Thursday
		{day(2026, 10, 16), 1, day(2026, 10, 19)}, // Friday → Monday
		{day(2026, 10, 17), 1, day(2026, 10, 19)}, // Saturday → Monday
		{day(2026, 10, 14), 5, day(2026, 10, 21)},
		{day(2026, 10, 14), 0, day(2026, 10, 15)}, // a step lasts at least a day
	} {
		if got := addWorkdays(c.from, c.n); !got.Equal(c.want) {
			t.Errorf("addWorkdays(%s, %d) = %s, want %s", c.from.Format(time.DateOnly), c.n, got.Format(time.DateOnly), c.want.Format(time.DateOnly))
		}
	}
}

func TestStepNameAndPhone(t *testing.T) {
	t.Parallel()
	for kind, want := range map[string]string{stepApprove: "Согласовать", stepSign: "Утвердить", stepAck: "Ознакомить", stepExternal: "Подпись заказчика"} {
		if got := stepName(kind); got != want {
			t.Errorf("stepName(%s) = %q, want %q", kind, got, want)
		}
	}
	if got := maskPhone("+7 (916) 123-45-42"); got != "+7 9•• •••-••-42" {
		t.Errorf("maskPhone = %q", got)
	}
	if got := maskPhone(""); got != "" {
		t.Errorf("maskPhone of nothing = %q", got)
	}
}

// The code of a signature: four digits, checked by its digest, three attempts (docSign).
func TestSignChallenge(t *testing.T) { //nolint:gocyclo // one story: the checks follow the life of a challenge
	t.Parallel()
	key := []byte("0123456789abcdef0123456789abcdef")
	route, member := uuid.New(), uuid.New()
	code := signCode(key, route, member, 7)
	if len(code) != 4 || code != signCode(key, route, member, 7) || code == signCode(key, route, member, 8) {
		t.Fatalf("code %q is not four digits of a nonce", code)
	}
	c := newChallenge(key, route, member, methodPEPSMS, code, time.Unix(1000, 0))
	if !c.matches(key, route, member, code) || c.matches(key, route, member, "0000") && code != "0000" {
		t.Fatal("the digest does not tell the code from another")
	}
	if c.tries != 0 || c.expires.Sub(time.Unix(1000, 0)) != signTTL {
		t.Fatalf("a new challenge %+v", c)
	}
	raw := c.marshal()
	back, okk := parseChallenge(raw)
	if !okk || back.method != methodPEPSMS || back.member != member || back.hash != c.hash {
		t.Fatalf("round trip %+v from %s", back, raw)
	}
	if _, okk := parseChallenge(nil); okk {
		t.Fatal("an empty challenge parses")
	}
}
