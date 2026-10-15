package main

import (
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

type noPools struct{}

func (noPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) { return nil, context.Canceled }

func envOf(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

// W1.09: the tags Files and Billing are served by the module files (not 501). Without S3_* the servers still
// mount (reads work, uploads and downloads answer 503); a half-configured storage stops the start.
func TestFilesServers(t *testing.T) {
	t.Parallel()
	log := slog.New(slog.DiscardHandler)
	ev := authz.New(nil, nil, time.Now)
	full := map[string]string{
		"S3_ENDPOINT": "http://127.0.0.1:19015", "S3_BUCKET": "ortus-files", "S3_ACCESS_KEY": "ortus", "S3_SECRET_KEY": "secret",
	}
	for name, vars := range map[string]map[string]string{"without S3": nil, "with S3": full} {
		fs, bs, err := filesServers(noPools{}, ev, envOf(vars), log)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		f, ok := fs.(files.Server)
		if !ok || f.S == nil || f.S.Parents == nil {
			t.Fatalf("%s: files server %#v", name, fs)
		}
		if b, ok := bs.(files.Billing); !ok || b.S != f.S {
			t.Fatalf("%s: billing server %#v", name, bs)
		}
		if (f.S.Store != nil) != (vars != nil) {
			t.Fatalf("%s: store %v", name, f.S.Store)
		}
	}
	_, _, err := filesServers(noPools{}, ev, envOf(map[string]string{"S3_ENDPOINT": "http://127.0.0.1:19015"}), log)
	if err == nil || !strings.Contains(err.Error(), "S3_BUCKET") {
		t.Fatalf("half-configured storage: %v", err)
	}
}
