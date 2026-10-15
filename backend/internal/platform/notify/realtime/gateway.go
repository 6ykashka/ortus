package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// Defaults of the gateway.
const (
	DefaultHeartbeat   = 25 * time.Second // RealtimeTicket.heartbeatSeconds
	DefaultAuthTimeout = 10 * time.Second // the auth frame (ADR-0015)
	MaxClientFrame     = 1024             // bytes of a client frame: auth with a ticket ≤ 256 characters
	writeTimeout       = 10 * time.Second // a frame the client does not take within it closes the socket
	frameBuffer        = 4                // client frames waiting for the connection loop; more are dropped
)

// SessionStore reads BFF sessions (session.Store).
type SessionStore interface {
	Get(ctx context.Context, id string) (session.Session, error)
}

// Gateway is the WebSocket endpoint GET /api/v1/realtime (ADR-0015). cmd/api mounts it next to the generated
// router; the contract gateway of cmd/api must let the path through (its auth is the ticket of the first frame).
type Gateway struct {
	Hub            *Hub
	Tickets        Tickets
	Sessions       SessionStore
	AllowedOrigins []string         // ALLOWED_ORIGINS: exact origins of the SPA
	Heartbeat      time.Duration    // 0: DefaultHeartbeat
	AuthTimeout    time.Duration    // 0: DefaultAuthTimeout
	Clock          func() time.Time // session expiry and the at of frames; nil: time.Now
	Log            *slog.Logger     // nil: slog.Default()
}

func (g *Gateway) now() time.Time {
	if g.Clock != nil {
		return g.Clock()
	}
	return time.Now()
}

func (g *Gateway) log() *slog.Logger {
	if g.Log != nil {
		return g.Log
	}
	return slog.Default()
}

func (g *Gateway) heartbeat() time.Duration {
	if g.Heartbeat > 0 {
		return g.Heartbeat
	}
	return DefaultHeartbeat
}

func (g *Gateway) authTimeout() time.Duration {
	if g.AuthTimeout > 0 {
		return g.AuthTimeout
	}
	return DefaultAuthTimeout
}

// offersProtocol reports whether the upgrade request lists p in Sec-WebSocket-Protocol.
func offersProtocol(r *http.Request, p string) bool {
	for _, h := range r.Header.Values("Sec-WebSocket-Protocol") {
		for v := range strings.SplitSeq(h, ",") {
			if strings.TrimSpace(v) == p {
				return true
			}
		}
	}
	return false
}

// ServeHTTP implements http.Handler: Origin and subprotocol before the upgrade, then the connection.
func (g *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if o := r.Header.Get("Origin"); o == "" || !slices.Contains(g.AllowedOrigins, o) {
		problem.Write(w, r, problem.New(problem.CodeOriginNotAllowed, "")) // CSWSH: exact origins only
		return
	}
	if !offersProtocol(r, Protocol) {
		problem.Write(w, r, problem.New(problem.CodeMalformedRequest, "Sec-WebSocket-Protocol "+Protocol+" required"))
		return
	}
	// The read and write deadlines of http.Server stay on a hijacked connection: clear them, the heartbeat
	// watches the socket instead. A writer without deadlines (a test recorder) does not support it.
	rc := http.NewResponseController(w)
	_ = rc.SetReadDeadline(time.Time{})
	_ = rc.SetWriteDeadline(time.Time{})
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		Subprotocols: []string{Protocol},
		// The origin was checked above against the exact list; the library would only compare hosts.
		InsecureSkipVerify: true,
	})
	if err != nil {
		g.log().WarnContext(r.Context(), "realtime: upgrade", slog.String("error", err.Error()))
		return
	}
	defer func() { _ = conn.CloseNow() }()
	conn.SetReadLimit(MaxClientFrame)
	g.serve(r.Context(), conn)
}

// clientFrame is a parsed client frame; bad marks one that is not a RealtimeClientMessage.
type clientFrame struct {
	msg ClientMessage
	bad bool
}

// read feeds frames with the client frames until the socket fails, then closes frames. It never blocks on the
// connection loop: the close handshake needs a reader.
func read(ctx context.Context, conn *websocket.Conn, frames chan<- clientFrame) {
	defer close(frames)
	for {
		typ, b, err := conn.Read(ctx)
		if err != nil {
			return
		}
		f := clientFrame{bad: typ != websocket.MessageText}
		if !f.bad {
			dec := json.NewDecoder(bytes.NewReader(b))
			dec.DisallowUnknownFields()
			f.bad = dec.Decode(&f.msg) != nil || !slices.Contains(ClientTypes(), f.msg.Type)
		}
		select {
		case frames <- f:
		default: // the loop is busy: a pong more or less changes nothing
		}
	}
}

// serve runs one socket: the auth frame, then hints, pings and session checks until it closes.
func (g *Gateway) serve(ctx context.Context, conn *websocket.Conn) {
	frames := make(chan clientFrame, frameBuffer)
	go read(ctx, conn, frames)

	p, err := g.authenticate(ctx, frames)
	if err != nil {
		g.log().DebugContext(ctx, "realtime: auth failed", slog.String("error", err.Error()))
		_ = conn.Close(CloseUnauthorized, "unauthorized")
		return
	}
	c, err := g.Hub.register(p.AccountID, SessionKey(p.SessionID))
	if err != nil {
		_ = conn.Close(websocket.StatusTryAgainLater, "try again later")
		return
	}
	defer g.Hub.unregister(c)
	g.loop(ctx, conn, c, p, frames)
}

var errAuth = errors.New("realtime: no valid auth frame")

// authenticate waits for the auth frame and redeems its ticket; the session of the ticket must still be live.
func (g *Gateway) authenticate(ctx context.Context, frames <-chan clientFrame) (Principal, error) {
	timer := time.NewTimer(g.authTimeout())
	defer timer.Stop()
	var f clientFrame
	select {
	case got, ok := <-frames:
		if !ok {
			return Principal{}, fmt.Errorf("%w: socket closed", errAuth)
		}
		f = got
	case <-timer.C:
		return Principal{}, fmt.Errorf("%w: timeout", errAuth)
	}
	if f.bad || f.msg.Type != TypeAuth || f.msg.Ticket == "" {
		return Principal{}, fmt.Errorf("%w: first frame is not auth", errAuth)
	}
	p, err := g.Tickets.Redeem(ctx, f.msg.Ticket)
	if err != nil {
		return Principal{}, err
	}
	if reason, err := g.sessionEnded(ctx, p); err != nil || reason != "" {
		return Principal{}, fmt.Errorf("%w: session %s %s", errAuth, SessionKey(p.SessionID), reason)
	}
	return p, nil
}

// sessionEnded returns the reason of session.ended for p, empty while the session is live. A failure of the
// store is an error, not an ending: the socket outlives a short outage of the session store.
func (g *Gateway) sessionEnded(ctx context.Context, p Principal) (string, error) {
	s, err := g.Sessions.Get(ctx, p.SessionID)
	switch {
	case errors.Is(err, session.ErrNotFound):
		return ReasonLogout, nil
	case err != nil:
		return "", fmt.Errorf("realtime: session store: %w", err)
	case s.AccountID != p.AccountID:
		return ReasonLogout, nil
	case !g.now().Before(s.ExpiresAt):
		return ReasonExpired, nil
	}
	return "", nil
}

// loop is the writer of an authenticated socket.
func (g *Gateway) loop(ctx context.Context, conn *websocket.Conn, c *client, p Principal, frames <-chan clientFrame) {
	hb := g.heartbeat()
	ticker := time.NewTicker(hb)
	defer ticker.Stop()
	lastPong := time.Now() // liveness by the monotonic clock, never by Clock
	for {
		select {
		case f, ok := <-frames:
			if !ok {
				return
			}
			if !f.bad && f.msg.Type == TypePong {
				lastPong = time.Now()
			}
		case m := <-c.queue:
			if g.send(ctx, conn, c, m) != nil {
				return
			}
			if m.Type == TypeSessionEnded {
				_ = conn.Close(websocket.StatusNormalClosure, "session ended")
				return
			}
		case <-ticker.C:
			if time.Since(lastPong) > 2*hb {
				_ = conn.Close(websocket.StatusPolicyViolation, "no pong")
				return
			}
			if !g.tick(ctx, conn, c, p) {
				return
			}
		case <-c.done:
			_ = conn.Close(websocket.StatusGoingAway, "server shutting down")
			return
		}
	}
}

// tick checks the session and pings; it reports whether the socket stays open.
func (g *Gateway) tick(ctx context.Context, conn *websocket.Conn, c *client, p Principal) bool {
	reason, err := g.sessionEnded(ctx, p)
	if err != nil {
		g.log().WarnContext(ctx, "realtime: session check", slog.String("error", err.Error()))
	}
	if reason != "" {
		if g.send(ctx, conn, c, ServerMessage{Type: TypeSessionEnded, Reason: reason, At: g.now().UTC()}) == nil {
			_ = conn.Close(websocket.StatusNormalClosure, "session ended")
		}
		return false
	}
	return g.send(ctx, conn, c, ServerMessage{Type: TypePing, At: g.now().UTC()}) == nil
}

// send stamps m with the next seq of c and writes it.
func (g *Gateway) send(ctx context.Context, conn *websocket.Conn, c *client, m ServerMessage) error {
	c.stamp(&m)
	b, err := json.Marshal(m)
	if err != nil {
		return fmt.Errorf("realtime: frame: %w", err)
	}
	wctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	if err := conn.Write(wctx, websocket.MessageText, b); err != nil {
		return fmt.Errorf("realtime: write: %w", err)
	}
	return nil
}
