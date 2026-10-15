package realtime

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Тест R-2 брифа W1.07: билет канала — одноразовый, 60 секунд по часам, хранится только хэш.

// fakeClock is a settable clock.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 10, 15, 9, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

func TestTicketSingleUse(t *testing.T) {
	t.Parallel()
	clk := newClock()
	m := NewMemTickets(clk.Now)
	p := Principal{AccountID: uuid.New(), SessionID: "sid-1"}
	tk, err := m.Issue(t.Context(), p)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(tk.Secret); n < 32 || n > 256 {
		t.Fatalf("secret length %d outside the contract (32…256)", n)
	}
	if !tk.ExpiresAt.Equal(clk.Now().Add(TicketTTL)) {
		t.Fatalf("expiresAt = %v, want now + 60 s", tk.ExpiresAt)
	}
	got, err := m.Redeem(t.Context(), tk.Secret)
	if err != nil || got != p {
		t.Fatalf("Redeem = %+v, %v; want %+v", got, err, p)
	}
	if _, err := m.Redeem(t.Context(), tk.Secret); !errors.Is(err, ErrTicket) {
		t.Fatalf("second Redeem = %v, want ErrTicket", err)
	}
	other, _ := m.Issue(t.Context(), p)
	if other.Secret == tk.Secret {
		t.Fatal("two tickets share a secret")
	}
}

func TestTicketExpiresByClock(t *testing.T) {
	t.Parallel()
	clk := newClock()
	m := NewMemTickets(clk.Now)
	p := Principal{AccountID: uuid.New(), SessionID: "sid"}
	fresh, _ := m.Issue(t.Context(), p)
	stale, _ := m.Issue(t.Context(), p)
	clk.Add(TicketTTL - time.Second)
	if _, err := m.Redeem(t.Context(), fresh.Secret); err != nil {
		t.Fatalf("59 s old ticket: %v", err)
	}
	clk.Add(time.Second)
	if _, err := m.Redeem(t.Context(), stale.Secret); !errors.Is(err, ErrTicket) {
		t.Fatalf("60 s old ticket: %v, want ErrTicket", err)
	}
	for _, s := range []string{"", "unknown-ticket-unknown-ticket-unknown"} {
		if _, err := m.Redeem(t.Context(), s); !errors.Is(err, ErrTicket) {
			t.Fatalf("Redeem(%q) = %v, want ErrTicket", s, err)
		}
	}
}

// В памяти — только хэш билета: секрет не найти ни в ключах, ни в значениях хранилища.
func TestTicketStoresHashOnly(t *testing.T) {
	t.Parallel()
	m := NewMemTickets(nil)
	tk, _ := m.Issue(t.Context(), Principal{AccountID: uuid.New(), SessionID: "s"})
	m.mu.Lock()
	dump := fmt.Sprintf("%#v %s", m.m, fmt.Sprint(m.m))
	m.mu.Unlock()
	if strings.Contains(dump, tk.Secret) {
		t.Fatal("the store keeps the secret in clear")
	}
}

// Переполненное хранилище вытесняет билет, который истекает первым, и не растёт.
func TestTicketStoreBounded(t *testing.T) {
	t.Parallel()
	clk := newClock()
	m := NewMemTickets(clk.Now)
	m.max = 3
	p := Principal{AccountID: uuid.New(), SessionID: "s"}
	first, _ := m.Issue(t.Context(), p)
	clk.Add(time.Second)
	var last Ticket
	for range 3 {
		last, _ = m.Issue(t.Context(), p)
	}
	if n := m.len(); n != 3 {
		t.Fatalf("store holds %d tickets, want 3", n)
	}
	if _, err := m.Redeem(t.Context(), first.Secret); !errors.Is(err, ErrTicket) {
		t.Fatalf("the oldest ticket survived: %v", err)
	}
	if _, err := m.Redeem(t.Context(), last.Secret); err != nil {
		t.Fatalf("the newest ticket: %v", err)
	}
}

func TestTicketResponse(t *testing.T) {
	t.Parallel()
	exp := time.Date(2026, 10, 15, 9, 1, 0, 0, time.FixedZone("MSK", 3*3600))
	cases := []struct {
		hb   time.Duration
		want int
	}{{25 * time.Second, 25}, {time.Second, 5}, {10 * time.Minute, 120}, {0, 25}}
	for _, c := range cases {
		r := TicketResponse(Ticket{Secret: strings.Repeat("x", 43), ExpiresAt: exp}, c.hb)
		if r.HeartbeatSeconds != c.want {
			t.Errorf("heartbeat %v → %d, want %d", c.hb, r.HeartbeatSeconds, c.want)
		}
		if string(r.Path) != Path || string(r.Protocol) != Protocol || r.Ticket != strings.Repeat("x", 43) {
			t.Errorf("response = %+v", r)
		}
		if r.ExpiresAt.Location() != time.UTC || !r.ExpiresAt.Equal(exp) {
			t.Errorf("expiresAt = %v, want UTC %v", r.ExpiresAt, exp)
		}
	}
}
