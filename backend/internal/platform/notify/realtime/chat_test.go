package realtime

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Тесты W7.12: подсказка chat.changed доходит только до участников чата — при постановке и при доставке (ADR-0015, ADR-0016).

type audience struct {
	members map[uuid.UUID][]uuid.UUID // chat -> accounts
	err     error
	calls   int
	tenants []uuid.UUID
}

func (a *audience) Members(_ context.Context, tenant, chat uuid.UUID) ([]uuid.UUID, error) {
	a.calls++
	a.tenants = append(a.tenants, tenant)
	if a.err != nil {
		return nil, a.err
	}
	return slices.Clone(a.members[chat]), nil
}

type sender struct {
	hints []Hint
	err   error
}

func (s *sender) Publish(_ context.Context, h Hint) error {
	if s.err != nil {
		return s.err
	}
	s.hints = append(s.hints, h)
	return nil
}

func TestHubDeliversChatChanged(t *testing.T) {
	t.Parallel()
	h := NewHub(HubOptions{Clock: newClock().Now})
	member, other := uuid.New(), uuid.New()
	cm := mustRegister(t, h, member, SessionKey("m"))
	co := mustRegister(t, h, other, SessionKey("o"))
	chat := uuid.New()
	deliver(t, h, Hint{Type: TypeChatChanged, TenantID: uuid.New(), ChatID: chat, LastSeq: 42, Accounts: []uuid.UUID{member}}, 1)
	m := expect(t, "member", cm, TypeChatChanged)[0]
	if m.ChatID == nil || *m.ChatID != chat || m.LastSeq != 42 {
		t.Fatalf("frame %+v, want chat %s lastSeq 42", m, chat)
	}
	expect(t, "not a member", co)
}

func TestHintChatRoundTrip(t *testing.T) {
	t.Parallel()
	in := Hint{Type: TypeChatChanged, TenantID: uuid.New(), ChatID: uuid.New(), LastSeq: 9, Accounts: []uuid.UUID{uuid.New()}}
	parts, err := EncodeHint(in)
	if err != nil || len(parts) != 1 {
		t.Fatalf("EncodeHint: %v, %d parts", err, len(parts))
	}
	out, err := DecodeHint(parts[0])
	if err != nil || out.ChatID != in.ChatID || out.LastSeq != 9 {
		t.Fatalf("DecodeHint = %+v, %v", out, err)
	}
	// A big audience is split, and every part keeps the chat.
	big := in
	big.Accounts = nil
	for range 400 {
		big.Accounts = append(big.Accounts, uuid.New())
	}
	parts, err = EncodeHint(big)
	if err != nil || len(parts) < 2 {
		t.Fatalf("EncodeHint(big): %v, %d parts", err, len(parts))
	}
	for _, p := range parts {
		h, err := DecodeHint(p)
		if err != nil || h.ChatID != in.ChatID || h.LastSeq != 9 {
			t.Fatalf("part = %+v, %v", h, err)
		}
	}
}

func TestChatPublisher(t *testing.T) {
	t.Parallel()
	tenant, chat := uuid.New(), uuid.New()
	a, b := uuid.New(), uuid.New()
	aud := &audience{members: map[uuid.UUID][]uuid.UUID{chat: {a, b}}}
	s := &sender{}
	p := ChatPublisher{Audience: aud, Sender: s}
	if err := p.Publish(t.Context(), tenant, chat, 5); err != nil {
		t.Fatal(err)
	}
	if len(s.hints) != 1 {
		t.Fatalf("hints = %+v", s.hints)
	}
	h := s.hints[0]
	if h.Type != TypeChatChanged || h.TenantID != tenant || h.ChatID != chat || h.LastSeq != 5 || !slices.Equal(h.Accounts, []uuid.UUID{a, b}) {
		t.Fatalf("hint = %+v", h)
	}
	if len(aud.tenants) != 1 || aud.tenants[0] != tenant {
		t.Fatalf("audience asked for tenants %v, want %s", aud.tenants, tenant)
	}
}

func TestChatPublisherNothingToSend(t *testing.T) {
	t.Parallel()
	tenant, chat := uuid.New(), uuid.New()
	aud := &audience{members: map[uuid.UUID][]uuid.UUID{chat: {uuid.New()}}}
	// A chat without members: nobody to tell, no hint, no error.
	s2 := &sender{}
	if err := (ChatPublisher{Audience: &audience{}, Sender: s2}).Publish(t.Context(), tenant, uuid.New(), 1); err != nil || len(s2.hints) != 0 {
		t.Fatalf("empty chat: err = %v, hints = %+v", err, s2.hints)
	}
	// The audience fails: no hint (closed), the error is returned.
	boom := errors.New("boom")
	s3 := &sender{}
	if err := (ChatPublisher{Audience: &audience{err: boom}, Sender: s3}).Publish(t.Context(), tenant, chat, 1); !errors.Is(err, boom) || len(s3.hints) != 0 {
		t.Fatalf("audience error: err = %v, hints = %+v", err, s3.hints)
	}
	// The sender fails: the error is returned.
	if err := (ChatPublisher{Audience: aud, Sender: &sender{err: boom}}).Publish(t.Context(), tenant, chat, 1); !errors.Is(err, boom) {
		t.Fatalf("sender error: %v", err)
	}
}

func TestChatPublisherRejectsBadArguments(t *testing.T) {
	t.Parallel()
	tenant, chat := uuid.New(), uuid.New()
	aud := &audience{}
	p := ChatPublisher{Audience: aud, Sender: &sender{}}
	cases := []struct {
		name         string
		tenant, chat uuid.UUID
		seq          int64
	}{{"no tenant", uuid.Nil, chat, 1}, {"no chat", tenant, uuid.Nil, 1}, {"no seq", tenant, chat, 0}}
	for _, tc := range cases {
		if err := p.Publish(t.Context(), tc.tenant, tc.chat, tc.seq); !errors.Is(err, ErrInvalidHint) {
			t.Errorf("%s: err = %v, want ErrInvalidHint", tc.name, err)
		}
	}
	if aud.calls != 0 {
		t.Fatalf("audience called %d times for bad arguments", aud.calls)
	}
}

func TestChatFanout(t *testing.T) {
	t.Parallel()
	tenant, chat := uuid.New(), uuid.New()
	member, left, outsider := uuid.New(), uuid.New(), uuid.New()
	// "left" was a member when the hint was queued, but is not any more.
	aud := &audience{members: map[uuid.UUID][]uuid.UUID{chat: {member}}}
	var got []Hint
	var logs bytes.Buffer
	sink := ChatFanout(func(h Hint) { got = append(got, h) }, aud, slog.New(slog.NewTextHandler(&logs, nil)))

	sink(Hint{Type: TypeChatChanged, TenantID: tenant, ChatID: chat, LastSeq: 3, Accounts: []uuid.UUID{member, left, outsider}})
	if len(got) != 1 || !slices.Equal(got[0].Accounts, []uuid.UUID{member}) || got[0].ChatID != chat || got[0].LastSeq != 3 {
		t.Fatalf("delivered %+v, want only the current member", got)
	}
	if aud.tenants[0] != tenant {
		t.Fatalf("audience asked for tenant %s, want %s", aud.tenants[0], tenant)
	}

	// Nobody is a member any more: nothing goes on.
	got = nil
	sink(Hint{Type: TypeChatChanged, TenantID: tenant, ChatID: chat, LastSeq: 4, Accounts: []uuid.UUID{left}})
	if len(got) != 0 {
		t.Fatalf("delivered %+v to a non-member", got)
	}

	// Other hints pass unchanged and do not touch the audience.
	calls := aud.calls
	other := Hint{Type: TypeContextChanged, TenantID: tenant, Accounts: []uuid.UUID{left}}
	sink(other)
	if len(got) != 1 || got[0].Type != TypeContextChanged || aud.calls != calls {
		t.Fatalf("context.changed: got %+v, audience calls %d -> %d", got, calls, aud.calls)
	}

	// The audience fails: closed, the hint is dropped and logged without identifiers of people.
	got = nil
	aud.err = errors.New("db down")
	sink(Hint{Type: TypeChatChanged, TenantID: tenant, ChatID: chat, LastSeq: 5, Accounts: []uuid.UUID{member}})
	if len(got) != 0 || !bytes.Contains(logs.Bytes(), []byte("db down")) {
		t.Fatalf("audience error: delivered %+v, log %q", got, logs.String())
	}
}

func TestGatewayChatChangedMembersOnly(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	sa, ta := r.login()
	sb, tb := r.login()
	ca, cb := r.open(sa, ta), r.open(sb, tb)
	tenant, chat := uuid.New(), uuid.New()
	aud := &audience{members: map[uuid.UUID][]uuid.UUID{chat: {sa.AccountID}}}
	sink := ChatFanout(func(h Hint) { r.hub.Deliver(h) }, aud, nil)
	// The hint names both accounts (a stale queue), the chat has account a only.
	sink(Hint{Type: TypeChatChanged, TenantID: tenant, ChatID: chat, LastSeq: 11, Accounts: []uuid.UUID{sa.AccountID, sb.AccountID}})
	m, err := next(t, ca, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if m.Type != TypeChatChanged || m.ChatID == nil || *m.ChatID != chat || m.LastSeq != 11 || m.TenantID == nil || *m.TenantID != tenant {
		t.Fatalf("frame %+v", m)
	}
	if m, err := next(t, cb, 300*time.Millisecond); err == nil {
		t.Fatalf("a non-member received %+v", m)
	}
}
