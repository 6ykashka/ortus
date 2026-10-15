package realtime

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
)

// TicketTTL is the lifetime of a ticket (createRealtimeTicket: «expires in 60 seconds»).
const TicketTTL = 60 * time.Second

// DefaultMaxTickets bounds MemTickets: beyond it the ticket that expires first is evicted.
const DefaultMaxTickets = 100_000

// Heartbeat bounds of RealtimeTicket.heartbeatSeconds.
const (
	minHeartbeat = 5 * time.Second
	maxHeartbeat = 120 * time.Second
)

// ErrTicket is returned for an unknown, used or expired ticket.
var ErrTicket = errors.New("realtime: unknown, used or expired ticket")

// Principal is who a ticket opens the channel for: the account and the BFF session that asked for it.
type Principal struct {
	AccountID uuid.UUID
	SessionID string
}

// Ticket is a single-use secret for the first frame of a socket.
type Ticket struct {
	Secret    string
	ExpiresAt time.Time
}

// Tickets issues and redeems tickets (createRealtimeTicket in the BFF, auth frame in the gateway).
type Tickets interface {
	Issue(ctx context.Context, p Principal) (Ticket, error)
	// Redeem consumes secret: a ticket opens one connection at most.
	Redeem(ctx context.Context, secret string) (Principal, error)
}

type ticketEntry struct {
	p   Principal
	exp time.Time
}

// MemTickets keeps tickets of one process in memory, by SHA-256 of the secret only. A ticket must be redeemed by
// the process that issued it; with several API instances the BFF store of W1.03 replaces it.
type MemTickets struct {
	clock func() time.Time
	max   int

	mu sync.Mutex
	m  map[[sha256.Size]byte]ticketEntry
}

var _ Tickets = (*MemTickets)(nil)

// NewMemTickets returns an empty store on clock (nil: time.Now) bounded by DefaultMaxTickets.
func NewMemTickets(clock func() time.Time) *MemTickets {
	if clock == nil {
		clock = time.Now
	}
	return &MemTickets{clock: clock, max: DefaultMaxTickets, m: map[[sha256.Size]byte]ticketEntry{}}
}

func ticketHash(secret string) [sha256.Size]byte { return sha256.Sum256([]byte(secret)) }

// Issue implements Tickets.
func (m *MemTickets) Issue(_ context.Context, p Principal) (Ticket, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return Ticket{}, fmt.Errorf("realtime: ticket: %w", err)
	}
	t := Ticket{Secret: base64.RawURLEncoding.EncodeToString(b), ExpiresAt: m.clock().Add(TicketTTL)}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.m) >= m.max {
		m.sweep()
	}
	if len(m.m) >= m.max {
		m.evictFirstToExpire()
	}
	m.m[ticketHash(t.Secret)] = ticketEntry{p: p, exp: t.ExpiresAt}
	return t, nil
}

// Redeem implements Tickets.
func (m *MemTickets) Redeem(_ context.Context, secret string) (Principal, error) {
	if secret == "" {
		return Principal{}, ErrTicket
	}
	h := ticketHash(secret)
	m.mu.Lock()
	e, ok := m.m[h]
	delete(m.m, h)
	m.mu.Unlock()
	if !ok || !m.clock().Before(e.exp) {
		return Principal{}, ErrTicket
	}
	return e.p, nil
}

// sweep drops expired tickets; the caller holds the lock.
func (m *MemTickets) sweep() {
	now := m.clock()
	for h, e := range m.m {
		if !now.Before(e.exp) {
			delete(m.m, h)
		}
	}
}

// evictFirstToExpire drops the ticket closest to expiry; the caller holds the lock.
func (m *MemTickets) evictFirstToExpire() {
	var (
		victim [sha256.Size]byte
		at     time.Time
		found  bool
	)
	for h, e := range m.m {
		if !found || e.exp.Before(at) {
			victim, at, found = h, e.exp, true
		}
	}
	delete(m.m, victim)
}

// len returns the number of stored tickets.
func (m *MemTickets) len() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.m)
}

// TicketResponse is the body of createRealtimeTicket for t; heartbeat is clamped to the contract (5…120 s), zero
// means DefaultHeartbeat.
func TicketResponse(t Ticket, heartbeat time.Duration) authapi.RealtimeTicket {
	if heartbeat == 0 {
		heartbeat = DefaultHeartbeat
	}
	heartbeat = min(max(heartbeat, minHeartbeat), maxHeartbeat)
	return authapi.RealtimeTicket{
		Ticket:           t.Secret,
		Path:             authapi.Apiv1realtime,
		Protocol:         authapi.OrtusRealtimeV1,
		ExpiresAt:        t.ExpiresAt.UTC(),
		HeartbeatSeconds: int(heartbeat / time.Second),
	}
}
