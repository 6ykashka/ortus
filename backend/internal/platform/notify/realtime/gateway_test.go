package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// Тест R-4 брифа W1.07: шлюз WebSocket — Origin, подпротокол, билет первым кадром (4401), ping/pong, конец сессии,
// дедлайны http.Server, адресность подсказок.

const spa = "http://127.0.0.1:5201"

// sessions is a fake session.Store.
type sessions struct {
	mu sync.Mutex
	m  map[string]session.Session
}

func (s *sessions) Get(_ context.Context, id string) (session.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[id]
	if !ok {
		return session.Session{}, session.ErrNotFound
	}
	return v, nil
}

func (s *sessions) put(v session.Session) {
	s.mu.Lock()
	s.m[v.ID] = v
	s.mu.Unlock()
}

func (s *sessions) drop(id string) {
	s.mu.Lock()
	delete(s.m, id)
	s.mu.Unlock()
}

type rig struct {
	t        *testing.T
	clk      *fakeClock
	hub      *Hub
	tickets  *MemTickets
	sessions *sessions
	gw       *Gateway
	url      string
}

// newRig starts the gateway on an httptest server; tune changes the gateway or the server before the start.
func newRig(t *testing.T, tune func(*Gateway, *http.Server)) *rig {
	t.Helper()
	clk := newClock()
	r := &rig{t: t, clk: clk, hub: NewHub(HubOptions{Clock: clk.Now}), tickets: NewMemTickets(clk.Now),
		sessions: &sessions{m: map[string]session.Session{}}}
	r.gw = &Gateway{
		Hub: r.hub, Tickets: r.tickets, Sessions: r.sessions, AllowedOrigins: []string{spa},
		Heartbeat: time.Minute, AuthTimeout: 2 * time.Second, Clock: clk.Now, Log: slog.New(slog.DiscardHandler),
	}
	srv := httptest.NewUnstartedServer(r.gw)
	if tune != nil {
		tune(r.gw, srv.Config)
	}
	srv.Start()
	t.Cleanup(srv.Close)
	t.Cleanup(r.hub.Close)
	r.url = "ws" + strings.TrimPrefix(srv.URL, "http") + Path
	return r
}

// login creates a live session of a new account and a ticket for it.
func (r *rig) login() (session.Session, Ticket) {
	r.t.Helper()
	s := session.Session{ID: uuid.NewString(), AccountID: uuid.New(), IssuedAt: r.clk.Now(), ExpiresAt: r.clk.Now().Add(time.Hour)}
	r.sessions.put(s)
	tk, err := r.tickets.Issue(r.t.Context(), Principal{AccountID: s.AccountID, SessionID: s.ID})
	if err != nil {
		r.t.Fatal(err)
	}
	return s, tk
}

func (r *rig) dial(origin string, protocols ...string) (*websocket.Conn, int, error) {
	return dialWS(r.t, r.url, origin, protocols...)
}

// dialWS opens a socket to url with Origin and subprotocols; it returns the HTTP status of the handshake. A handshake
// that times out is retried twice: on the Windows machine of the agents new loopback connections were seen to stall
// for seconds under the load of parallel sessions (also in @ortus/api-client), whereas every answer of the gateway
// is immediate; any real failure of the handshake is a status, not a timeout.
func dialWS(t *testing.T, url, origin string, protocols ...string) (*websocket.Conn, int, error) {
	t.Helper()
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	var (
		c      *websocket.Conn
		status int
		err    error
	)
	for attempt := 1; attempt <= 3; attempt++ {
		c, status, err = dialOnce(t.Context(), url, &websocket.DialOptions{Subprotocols: protocols, HTTPHeader: h})
		if !errors.Is(err, context.DeadlineExceeded) || t.Context().Err() != nil {
			break
		}
		t.Logf("dial %s: attempt %d timed out (loopback stall), retrying", url, attempt)
	}
	if c != nil {
		t.Cleanup(func() { _ = c.CloseNow() })
	}
	return c, status, err
}

func dialOnce(ctx context.Context, url string, opts *websocket.DialOptions) (*websocket.Conn, int, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, url, opts)
	status := 0
	if resp != nil {
		status = resp.StatusCode
		if resp.Body != nil {
			_ = resp.Body.Close()
		}
	}
	return c, status, err
}

// open dials and sends the auth frame of tk; it waits until the hub knows the connection.
func (r *rig) open(s session.Session, tk Ticket) *websocket.Conn {
	r.t.Helper()
	c, _, err := r.dial(spa, Protocol)
	if err != nil {
		r.t.Fatalf("dial: %v", err)
	}
	before := r.hub.Connections(s.AccountID)
	send(r.t, c, ClientMessage{Type: TypeAuth, Ticket: tk.Secret})
	deadline := time.Now().Add(5 * time.Second)
	for r.hub.Connections(s.AccountID) == before {
		if time.Now().After(deadline) {
			r.t.Fatal("the gateway did not register the connection")
		}
		time.Sleep(5 * time.Millisecond)
	}
	return c
}

func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	b, _ := json.Marshal(v)
	if err := c.Write(t.Context(), websocket.MessageText, b); err != nil {
		t.Fatalf("write: %v", err)
	}
}

// next reads one server frame within d.
func next(t *testing.T, c *websocket.Conn, d time.Duration) (ServerMessage, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), d)
	defer cancel()
	typ, b, err := c.Read(ctx)
	if err != nil {
		return ServerMessage{}, err
	}
	if typ != websocket.MessageText {
		t.Fatalf("frame type %v, want text", typ)
	}
	var m ServerMessage
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("frame %s: %v", b, err)
	}
	return m, nil
}

// closedWith reads until the socket closes and returns its close status.
func closedWith(t *testing.T, c *websocket.Conn) websocket.StatusCode {
	t.Helper()
	for {
		if _, err := next(t, c, 5*time.Second); err != nil {
			return websocket.CloseStatus(err)
		}
	}
}

func TestGatewayRejectsBeforeUpgrade(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	cases := []struct {
		name      string
		origin    string
		protocols []string
		status    int
	}{
		{"foreign origin", "https://evil.example", []string{Protocol}, http.StatusForbidden},
		{"no origin", "", []string{Protocol}, http.StatusForbidden},
		{"origin prefix", spa + ".evil.example", []string{Protocol}, http.StatusForbidden},
		{"no subprotocol", spa, nil, http.StatusBadRequest},
		{"other subprotocol", spa, []string{"chat"}, http.StatusBadRequest},
	}
	for _, tc := range cases {
		_, status, err := r.dial(tc.origin, tc.protocols...)
		if err == nil || status != tc.status {
			t.Errorf("%s: status %d, err %v; want %d", tc.name, status, err, tc.status)
		}
	}
}

func TestGatewayAuthFrame(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(g *Gateway, _ *http.Server) { g.AuthTimeout = 300 * time.Millisecond })
	s, used := r.login()
	if _, err := r.tickets.Redeem(t.Context(), used.Secret); err != nil { // consumes the ticket
		t.Fatal(err)
	}
	_, expired := r.login()
	r.clk.Add(TicketTTL)
	_, stranger := r.login()
	cases := []struct {
		name  string
		frame any // nil: send nothing
	}{
		{"silence past the auth timeout", nil},
		{"used ticket", ClientMessage{Type: TypeAuth, Ticket: used.Secret}},
		{"expired ticket", ClientMessage{Type: TypeAuth, Ticket: expired.Secret}},
		{"pong first", ClientMessage{Type: TypePong}},
		{"no ticket", ClientMessage{Type: TypeAuth}},
		{"not JSON", "auth please"},
		{"unknown field", map[string]string{"type": "auth", "ticket": stranger.Secret, "account": s.AccountID.String()}},
	}
	for _, tc := range cases {
		c, _, err := r.dial(spa, Protocol)
		if err != nil {
			t.Fatalf("%s: dial: %v", tc.name, err)
		}
		if c.Subprotocol() != Protocol {
			t.Errorf("%s: subprotocol %q", tc.name, c.Subprotocol())
		}
		switch f := tc.frame.(type) {
		case nil:
		case string:
			_ = c.Write(t.Context(), websocket.MessageText, []byte(f))
		default:
			send(t, c, f)
		}
		if code := closedWith(t, c); code != CloseUnauthorized {
			t.Errorf("%s: close %d, want 4401", tc.name, code)
		}
	}
}

// Сессия билета закончилась до подключения — 4401, а не канал без сессии.
func TestGatewayTicketOfEndedSession(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	s, tk := r.login()
	r.sessions.drop(s.ID)
	c, _, err := r.dial(spa, Protocol)
	if err != nil {
		t.Fatal(err)
	}
	send(t, c, ClientMessage{Type: TypeAuth, Ticket: tk.Secret})
	if code := closedWith(t, c); code != CloseUnauthorized {
		t.Fatalf("close %d, want 4401", code)
	}
}

func TestGatewayDeliversHintsInOrder(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	sa, ta := r.login()
	sb, tb := r.login()
	ca, cb := r.open(sa, ta), r.open(sb, tb)
	tenant := uuid.New()
	r.hub.Deliver(Hint{Type: TypeContextChanged, TenantID: tenant, Accounts: []uuid.UUID{sa.AccountID}})
	r.hub.Deliver(Hint{Type: TypeNotificationsChanged, Accounts: []uuid.UUID{sa.AccountID}})
	m1, err := next(t, ca, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	m2, err := next(t, ca, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if m1.Type != TypeContextChanged || *m1.TenantID != tenant || m1.Seq != 1 || m2.Type != TypeNotificationsChanged || m2.Seq != 2 {
		t.Fatalf("frames %+v, %+v", m1, m2)
	}
	if !m1.At.Equal(r.clk.Now()) || m1.At.Location() != time.UTC {
		t.Fatalf("at = %v, want UTC clock %v", m1.At, r.clk.Now())
	}
	// Isolation: the other account got nothing (the read times out; the socket is unusable afterwards).
	if m, err := next(t, cb, 300*time.Millisecond); err == nil {
		t.Fatalf("account b received a hint of account a: %+v", m)
	}
}

func TestGatewayHeartbeat(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(g *Gateway, srv *http.Server) {
		g.Heartbeat = 100 * time.Millisecond
		// The deadlines of http.Server must not kill a hijacked socket.
		srv.ReadTimeout, srv.WriteTimeout = 250*time.Millisecond, 250*time.Millisecond
	})
	s, tk := r.login()
	c := r.open(s, tk)
	start := time.Now()
	var last int64
	for time.Since(start) < 800*time.Millisecond {
		m, err := next(t, c, 5*time.Second)
		if err != nil {
			t.Fatalf("socket closed after %v: %v", time.Since(start), err)
		}
		if m.Type != TypePing || m.Seq != last+1 {
			t.Fatalf("frame %+v after seq %d", m, last)
		}
		last = m.Seq
		send(t, c, ClientMessage{Type: TypePong})
	}

	// A client that stops answering is dropped.
	s2, tk2 := r.login()
	quiet := r.open(s2, tk2)
	if code := closedWith(t, quiet); code != websocket.StatusPolicyViolation {
		t.Fatalf("silent client closed with %d, want 1008", code)
	}
}

func TestGatewayEndsSession(t *testing.T) {
	t.Parallel()
	r := newRig(t, func(g *Gateway, _ *http.Server) { g.Heartbeat = 30 * time.Millisecond })
	pong := func(c *websocket.Conn) ServerMessage {
		for {
			m, err := next(t, c, 5*time.Second)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if m.Type != TypePing {
				return m
			}
			send(t, c, ClientMessage{Type: TypePong})
		}
	}

	out, tk := r.login()
	c := r.open(out, tk)
	r.sessions.drop(out.ID)
	if m := pong(c); m.Type != TypeSessionEnded || m.Reason != ReasonLogout {
		t.Fatalf("logged out: %+v", m)
	}
	if code := closedWith(t, c); code != websocket.StatusNormalClosure {
		t.Fatalf("close %d, want 1000", code)
	}

	exp, tk2 := r.login()
	c2 := r.open(exp, tk2)
	r.clk.Add(time.Hour) // the session expires by the clock of the gateway
	if m := pong(c2); m.Type != TypeSessionEnded || m.Reason != ReasonExpired {
		t.Fatalf("expired: %+v", m)
	}

	// A hint to a session key: session.ended membership_ended, then the socket closes.
	r.clk.Add(-time.Hour)
	ms, tk3 := r.login()
	c3 := r.open(ms, tk3)
	r.hub.Deliver(Hint{Type: TypeSessionEnded, Reason: ReasonMembershipEnded, Sessions: []string{SessionKey(ms.ID)}})
	if m := pong(c3); m.Type != TypeSessionEnded || m.Reason != ReasonMembershipEnded {
		t.Fatalf("hint: %+v", m)
	}
	if code := closedWith(t, c3); code != websocket.StatusNormalClosure {
		t.Fatalf("close %d, want 1000", code)
	}
}

func TestGatewayLimitsAndShutdown(t *testing.T) {
	t.Parallel()
	r := newRig(t, nil)
	r.hub.opts.MaxPerAccount = 1
	s, tk := r.login()
	c := r.open(s, tk)
	tk2, _ := r.tickets.Issue(t.Context(), Principal{AccountID: s.AccountID, SessionID: s.ID})
	extra, _, err := r.dial(spa, Protocol)
	if err != nil {
		t.Fatal(err)
	}
	send(t, extra, ClientMessage{Type: TypeAuth, Ticket: tk2.Secret})
	if code := closedWith(t, extra); code != websocket.StatusTryAgainLater {
		t.Fatalf("connection over the limit closed with %d, want 1013", code)
	}
	// A client frame over MaxClientFrame closes the socket (1009).
	big, tk3 := r.login()
	cb := r.open(big, tk3)
	send(t, cb, ClientMessage{Type: TypePong, Ticket: strings.Repeat("x", MaxClientFrame)})
	if code := closedWith(t, cb); code != websocket.StatusMessageTooBig {
		t.Fatalf("big frame closed with %d, want 1009", code)
	}

	r.hub.Close()
	if code := closedWith(t, c); code != websocket.StatusGoingAway {
		t.Fatalf("shutdown closed with %d, want 1001", code)
	}
}
