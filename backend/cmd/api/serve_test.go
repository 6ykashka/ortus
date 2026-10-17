package main

import (
	"context"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"
)

// Возврат 2 W1.42: run останавливает канал реального времени (deps.stopping) на обоих путях — по сигналу и при сбое
// сервера — в пределах бюджета остановки и до srv.Shutdown: перехваченные сокеты http.Server не ждёт, а после run идёт
// os.Exit. Возврат 16.10 №2: srv.Shutdown идёт и на пути сбоя сервера — обычные HTTP-обработчики в полёте дожидаются
// до closeDeps, которая закрывает пулы.
func TestServeStopsChannelOnBothPaths(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name     string
		addr     string
		cancel   bool
		wantCode int
		want     []string // the order of the stopping steps
	}{
		{name: "signal", addr: "127.0.0.1:0", cancel: true, wantCode: exitOK, want: []string{"stopping", "shutdown"}},
		{name: "server failure", addr: "127.0.0.1:-1", wantCode: exitFailed, want: []string{"stopping", "shutdown"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var (
				mu    sync.Mutex
				steps []string
			)
			step := func(s string) {
				mu.Lock()
				defer mu.Unlock()
				steps = append(steps, s)
			}
			shut := make(chan struct{})
			srv := &http.Server{Addr: tc.addr, Handler: http.NotFoundHandler(), ReadHeaderTimeout: time.Second}
			srv.RegisterOnShutdown(func() { step("shutdown"); close(shut) })
			var budget time.Duration
			stopping := func(ctx context.Context) {
				if dl, ok := ctx.Deadline(); ok {
					budget = time.Until(dl)
				}
				step("stopping")
			}
			ctx, cancel := context.WithCancel(t.Context())
			if tc.cancel {
				cancel()
			} else {
				defer cancel()
			}

			code := serve(ctx, srv, stopping, slog.New(slog.DiscardHandler))
			if code != tc.wantCode {
				t.Fatalf("exit code %d, want %d", code, tc.wantCode)
			}
			if slices.Contains(tc.want, "shutdown") {
				select {
				case <-shut:
				case <-time.After(5 * time.Second):
					t.Fatal("the server was not shut down")
				}
			}
			mu.Lock()
			got := slices.Clone(steps)
			mu.Unlock()
			if !slices.Equal(got, tc.want) {
				t.Fatalf("steps = %v, want %v", got, tc.want)
			}
			if budget <= 0 || budget > shutdownTimeout {
				t.Fatalf("stopping got %v of the budget, want a live deadline of at most %v", budget, shutdownTimeout)
			}
		})
	}
}

// Without the channel (unit stacks) nothing is stopped and the server still stops.
func TestServeWithoutChannel(t *testing.T) {
	t.Parallel()
	srv := &http.Server{Addr: "127.0.0.1:0", Handler: http.NotFoundHandler(), ReadHeaderTimeout: time.Second}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if code := serve(ctx, srv, nil, slog.New(slog.DiscardHandler)); code != exitOK {
		t.Fatalf("exit code %d, want %d", code, exitOK)
	}
}
