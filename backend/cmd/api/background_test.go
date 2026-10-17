package main

import (
	"context"
	"log/slog"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

// Возврат 16.10 №1 W1.42: фоновые задания run (жизненный цикл подписок и LISTEN канала) идут на своём контексте.
// runServer отменяет их и дожидается до closeDeps на обоих путях. На пути сбоя сервера сигнальный ctx не отменён, а
// LISTEN держит соединение пула control: pgxpool.Pool.Close ждёт возврата всех соединений, и процесс завис бы вместо
// выхода с кодом 1.
func TestRunServerStopsBackgroundBeforeCloseDeps(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name     string
		addr     string
		signal   bool
		wantCode int
	}{
		{name: "server failure", addr: "127.0.0.1:-1", wantCode: exitFailed},
		{name: "signal", addr: "127.0.0.1:0", signal: true, wantCode: exitOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			started, ended := make(chan struct{}), make(chan struct{})
			job := func(ctx context.Context) {
				close(started)
				<-ctx.Done() // as the LISTEN waits for a notification on the held connection
				close(ended)
			}
			var endedBeforeClose, closed atomic.Bool
			closeDeps := func() {
				select {
				case <-ended:
					endedBeforeClose.Store(true)
				default:
				}
				closed.Store(true)
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			srv := &http.Server{Addr: tc.addr, Handler: http.NotFoundHandler(), ReadHeaderTimeout: time.Second}
			d := deps{log: slog.New(slog.DiscardHandler), background: job}

			codec := make(chan int, 1)
			go func() { codec <- runServer(ctx, d, srv, closeDeps) }()
			select {
			case <-started:
			case <-time.After(5 * time.Second):
				t.Fatal("the background job did not start")
			}
			if tc.signal {
				cancel()
			}
			select {
			case code := <-codec:
				if code != tc.wantCode {
					t.Fatalf("exit code %d, want %d", code, tc.wantCode)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("runServer did not return: the background job holds on")
			}
			if !closed.Load() {
				t.Fatal("the dependencies were not closed")
			}
			if !endedBeforeClose.Load() {
				t.Fatal("the dependencies were closed before the background job ended")
			}
		})
	}
}

// Without background jobs (unit stacks) runServer still serves and closes the dependencies.
func TestRunServerWithoutBackground(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	var closed atomic.Bool
	srv := &http.Server{Addr: "127.0.0.1:0", Handler: http.NotFoundHandler(), ReadHeaderTimeout: time.Second}
	code := runServer(ctx, deps{log: slog.New(slog.DiscardHandler)}, srv, func() { closed.Store(true) })
	if code != exitOK {
		t.Fatalf("exit code %d, want %d", code, exitOK)
	}
	if !closed.Load() {
		t.Fatal("the dependencies were not closed")
	}
}
