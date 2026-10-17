package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// A-1 (ADR-0015, возврат 1 W1.42): остановка cmd/api закрывает сокеты канала кадром 1001 и ждёт, пока их
// обработчики завершатся: http.Server.Shutdown перехваченные соединения не ждёт, а после run идёт os.Exit.
func TestChannelStopDrainsSockets(t *testing.T) {
	t.Parallel()
	store := session.NewMemStore()
	ch := newChannel(nil, nil, store, testConfig(), slog.New(slog.DiscardHandler))
	srv := httptest.NewServer(ch.handler())
	t.Cleanup(srv.Close)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	account := uuid.New()
	conn := channelSocket(ctx, t, ch, store, "ws"+strings.TrimPrefix(srv.URL, "http")+realtime.Path, account)
	closed := make(chan websocket.StatusCode, 1)
	go func() {
		for {
			if _, _, err := conn.Read(ctx); err != nil {
				closed <- websocket.CloseStatus(err)
				return
			}
		}
	}()

	if n := liveHandlers(ch); n != 1 {
		t.Fatalf("%d socket handlers in flight before stop, want 1", n)
	}
	ch.stop(ctx)
	// Возврат 2: stop ждёт сами обработчики сокетов (sockets.wait), а не только снятие с учёта в хабе.
	if n := liveHandlers(ch); n != 0 {
		t.Fatalf("stop returned with %d socket handlers in flight", n)
	}
	if n := ch.hub.Connections(account); n != 0 {
		t.Fatalf("stop returned with %d live sockets", n)
	}
	select {
	case code := <-closed:
		if code != websocket.StatusGoingAway {
			t.Fatalf("the socket closed with %d, want 1001", code)
		}
	case <-ctx.Done():
		t.Fatal("the socket was not closed")
	}
}

// liveHandlers is the number of the gateway handlers in flight, as the mounted counter sees it.
func liveHandlers(ch channel) int {
	ch.sockets.mu.Lock()
	defer ch.sockets.mu.Unlock()
	return ch.sockets.live
}

// channelSocket opens an authenticated socket of a new session of account and waits until the hub registers it.
func channelSocket(ctx context.Context, t *testing.T, ch channel, store session.Store, url string, account uuid.UUID) *websocket.Conn {
	t.Helper()
	s := session.Session{ID: uuid.NewString(), AccountID: account, IssuedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
	if err := store.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	tk, err := ch.tickets.tickets.Issue(ctx, realtime.Principal{AccountID: account, SessionID: s.ID})
	if err != nil {
		t.Fatal(err)
	}
	conn, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{
		Subprotocols: []string{realtime.Protocol}, HTTPHeader: http.Header{"Origin": {testOrigin}},
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	auth, err := json.Marshal(realtime.ClientMessage{Type: realtime.TypeAuth, Ticket: tk.Secret})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.Write(ctx, websocket.MessageText, auth); err != nil {
		t.Fatal(err)
	}
	for ch.hub.Connections(account) != 1 {
		if ctx.Err() != nil {
			t.Fatal("the gateway did not register the socket")
		}
		time.Sleep(10 * time.Millisecond)
	}
	return conn
}
