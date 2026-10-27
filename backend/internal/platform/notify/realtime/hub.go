package realtime

import (
	"errors"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
)

// Defaults of the hub.
const (
	DefaultQueue         = 32 // hints waiting for the writer of one connection
	DefaultMaxPerAccount = 16 // connections of one account in one process
)

// Errors of Hub.register.
var (
	ErrTooManyConnections = errors.New("realtime: too many connections of the account")
	ErrHubClosed          = errors.New("realtime: the hub is closed")
)

// HubOptions configures a hub.
type HubOptions struct {
	Queue         int              // 0: DefaultQueue
	MaxPerAccount int              // 0: DefaultMaxPerAccount
	Clock         func() time.Time // the at of frames; nil: time.Now
}

// Hub keeps the connections of one process by account and hands hints to their writers. It never blocks a
// producer: a full queue drops the hint, and the connection shows the loss as a gap in seq.
type Hub struct {
	opts HubOptions

	mu     sync.Mutex
	conns  map[uuid.UUID]map[*client]struct{}
	closed bool
}

// NewHub returns an empty hub.
func NewHub(opts HubOptions) *Hub {
	return &Hub{opts: opts, conns: map[uuid.UUID]map[*client]struct{}{}}
}

func (h *Hub) now() time.Time {
	if h.opts.Clock != nil {
		return h.opts.Clock()
	}
	return time.Now()
}

// client is one authenticated socket.
type client struct {
	account uuid.UUID
	session string // SessionKey
	queue   chan ServerMessage
	done    chan struct{} // closed by Hub.Close

	skipped atomic.Int64 // hints dropped since the last frame
	seq     int64        // owned by the writer
}

// offer queues m without blocking; a full queue drops it.
func (c *client) offer(m ServerMessage) {
	select {
	case c.queue <- m:
	default:
		c.skipped.Add(1)
	}
}

// stamp gives m the next seq of the connection, skipping the seq of every dropped hint. Only the writer of the
// connection calls it, so frames leave in seq order.
func (c *client) stamp(m *ServerMessage) {
	c.seq += 1 + c.skipped.Swap(0)
	m.Seq = c.seq
}

// register adds a connection of account and session key.
func (h *Hub) register(account uuid.UUID, sessionKey string) (*client, error) {
	queue := h.opts.Queue
	if queue <= 0 {
		queue = DefaultQueue
	}
	limit := h.opts.MaxPerAccount
	if limit <= 0 {
		limit = DefaultMaxPerAccount
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil, ErrHubClosed
	}
	set := h.conns[account]
	if len(set) >= limit {
		return nil, ErrTooManyConnections
	}
	if set == nil {
		set = map[*client]struct{}{}
		h.conns[account] = set
	}
	c := &client{account: account, session: sessionKey, queue: make(chan ServerMessage, queue), done: make(chan struct{})}
	set[c] = struct{}{}
	return c, nil
}

// unregister removes c.
func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	set := h.conns[c.account]
	delete(set, c)
	if len(set) == 0 {
		delete(h.conns, c.account)
	}
}

// message is the frame of hint without seq.
func (h *Hub) message(hint Hint) ServerMessage {
	m := ServerMessage{Type: hint.Type, Reason: hint.Reason, LastSeq: hint.LastSeq, At: h.now().UTC()}
	if hint.ChatID != uuid.Nil {
		chat := hint.ChatID
		m.ChatID = &chat
	}
	if hint.TenantID != uuid.Nil {
		tenant := hint.TenantID
		m.TenantID = &tenant
	}
	return m
}

// Deliver hands h to its connections — every connection of h.Accounts and every connection whose session key is
// in h.Sessions, each at most once — and returns how many were offered it. An invalid hint goes nowhere.
func (h *Hub) Deliver(hint Hint) int {
	if hint.Validate() != nil {
		return 0
	}
	m := h.message(hint)
	h.mu.Lock()
	defer h.mu.Unlock()
	n := 0
	if len(hint.Sessions) == 0 { // the usual hint: only the connections of its accounts
		seen := make(map[uuid.UUID]bool, len(hint.Accounts))
		for _, account := range hint.Accounts {
			if seen[account] {
				continue
			}
			seen[account] = true
			for c := range h.conns[account] {
				c.offer(m)
				n++
			}
		}
		return n
	}
	for account, set := range h.conns {
		all := slices.Contains(hint.Accounts, account)
		for c := range set {
			if all || slices.Contains(hint.Sessions, c.session) {
				c.offer(m)
				n++
			}
		}
	}
	return n
}

// Resync tells every connection to re-read everything (context.changed and notifications.changed): hints may have
// been lost while the listener was reconnecting.
func (h *Hub) Resync() {
	ctx := ServerMessage{Type: TypeContextChanged, At: h.now().UTC()}
	inbox := ServerMessage{Type: TypeNotificationsChanged, At: ctx.At}
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, set := range h.conns {
		for c := range set {
			c.offer(ctx)
			c.offer(inbox)
		}
	}
}

// Close ends every connection («going away») and refuses new ones; for the shutdown of cmd/api.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return
	}
	h.closed = true
	for _, set := range h.conns {
		for c := range set {
			close(c.done)
		}
	}
}

// Connections returns the number of live connections of account.
func (h *Hub) Connections(account uuid.UUID) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns[account])
}
