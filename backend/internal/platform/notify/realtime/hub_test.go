package realtime

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

// Тест R-3 брифа W1.07: хаб раздаёт подсказку только адресатам; переполнение очереди — разрыв seq, а не обрыв.

// received drains the queue of c without blocking.
func received(c *client) []ServerMessage {
	var out []ServerMessage
	for {
		select {
		case m := <-c.queue:
			out = append(out, m)
		default:
			return out
		}
	}
}

func mustRegister(t *testing.T, h *Hub, acc uuid.UUID, key string) *client {
	t.Helper()
	c, err := h.register(acc, key)
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	return c
}

// expect checks that c holds exactly hints of types, in order, and returns them.
func expect(t *testing.T, name string, c *client, types ...string) []ServerMessage {
	t.Helper()
	got := received(c)
	ok := len(got) == len(types)
	for i := 0; ok && i < len(got); i++ {
		ok = got[i].Type == types[i]
	}
	if !ok {
		t.Fatalf("%s got %+v, want %v", name, got, types)
	}
	return got
}

// deliver hands hint to h and checks how many connections it reached.
func deliver(t *testing.T, h *Hub, hint Hint, want int) {
	t.Helper()
	if n := h.Deliver(hint); n != want {
		t.Fatalf("Deliver(%+v) reached %d connections, want %d", hint, n, want)
	}
}

func TestHubDeliversToAddresseesOnly(t *testing.T) {
	t.Parallel()
	clk := newClock()
	h := NewHub(HubOptions{Clock: clk.Now})
	a, b := uuid.New(), uuid.New()
	a1 := mustRegister(t, h, a, SessionKey("a-1"))
	a2 := mustRegister(t, h, a, SessionKey("a-2"))
	b1 := mustRegister(t, h, b, SessionKey("b-1"))
	tenant := uuid.New()

	deliver(t, h, Hint{Type: TypeContextChanged, TenantID: tenant, Accounts: []uuid.UUID{a}}, 2)
	for _, c := range []*client{a1, a2} {
		m := expect(t, "account a", c, TypeContextChanged)[0]
		if m.TenantID == nil || *m.TenantID != tenant || !m.At.Equal(clk.Now()) {
			t.Fatalf("frame %+v, want tenant %s at the hub clock %v", m, tenant, clk.Now())
		}
	}
	expect(t, "account b", b1)

	// session.ended for one session: the other session of the same account keeps quiet.
	deliver(t, h, Hint{Type: TypeSessionEnded, Reason: ReasonLogout, Sessions: []string{SessionKey("a-2")}}, 1)
	if m := expect(t, "a-2", a2, TypeSessionEnded)[0]; m.Reason != ReasonLogout || m.TenantID != nil {
		t.Fatalf("a-2 got %+v", m)
	}
	expect(t, "a-1", a1)

	// Accounts ∪ Sessions, every connection at most once.
	deliver(t, h, Hint{Type: TypeNotificationsChanged, Accounts: []uuid.UUID{a}, Sessions: []string{SessionKey("a-1"), SessionKey("b-1")}}, 3)
	for _, c := range []*client{a1, a2, b1} {
		expect(t, "a ∪ {a-1, b-1}", c, TypeNotificationsChanged)
	}
	deliver(t, h, Hint{Type: TypeContextChanged, Accounts: []uuid.UUID{a, a}}, 2) // a repeated account counts once
	expect(t, "a-1", a1, TypeContextChanged)
	expect(t, "a-2", a2, TypeContextChanged)
	deliver(t, h, Hint{Type: TypeContextChanged, Accounts: []uuid.UUID{uuid.New()}}, 0)
	deliver(t, h, Hint{Type: TypePing, Accounts: []uuid.UUID{a}}, 0) // an invalid hint goes nowhere
}

func TestHubQueueOverflowMakesGap(t *testing.T) {
	t.Parallel()
	h := NewHub(HubOptions{Queue: 2})
	acc := uuid.New()
	c := mustRegister(t, h, acc, "k")
	hint := Hint{Type: TypeContextChanged, Accounts: []uuid.UUID{acc}}
	for range 4 {
		h.Deliver(hint)
	}
	got := received(c)
	if len(got) != 2 {
		t.Fatalf("queued %d, want 2 (queue size)", len(got))
	}
	// The writer stamps frames: the dropped hints show as a gap in seq.
	c.stamp(&got[0])
	c.stamp(&got[1])
	if got[0].Seq != 3 || got[1].Seq != 4 {
		t.Fatalf("seq = %d, %d; want 3, 4 (two hints dropped)", got[0].Seq, got[1].Seq)
	}
	ping := ServerMessage{Type: TypePing}
	c.stamp(&ping)
	if ping.Seq != 5 {
		t.Fatalf("next seq = %d, want 5", ping.Seq)
	}
}

func TestHubLimitsAndLifecycle(t *testing.T) {
	t.Parallel()
	h := NewHub(HubOptions{MaxPerAccount: 2})
	acc := uuid.New()
	c1 := mustRegister(t, h, acc, "k1")
	mustRegister(t, h, acc, "k2")
	if _, err := h.register(acc, "k3"); !errors.Is(err, ErrTooManyConnections) {
		t.Fatalf("third connection: %v, want ErrTooManyConnections", err)
	}
	if n := h.Connections(acc); n != 2 {
		t.Fatalf("Connections = %d", n)
	}
	h.unregister(c1)
	h.unregister(c1) // twice is harmless
	if n := h.Connections(acc); n != 1 {
		t.Fatalf("Connections after unregister = %d", n)
	}
	c3 := mustRegister(t, h, acc, "k3")

	h.Resync()
	if got := received(c3); len(got) != 2 || got[0].Type != TypeContextChanged || got[1].Type != TypeNotificationsChanged {
		t.Fatalf("Resync sent %+v", got)
	}

	h.Close()
	select {
	case <-c3.done:
	default:
		t.Fatal("Close did not signal the connection")
	}
	if _, err := h.register(uuid.New(), "k"); !errors.Is(err, ErrHubClosed) {
		t.Fatalf("register after Close: %v", err)
	}
	h.Close() // twice is harmless
}
