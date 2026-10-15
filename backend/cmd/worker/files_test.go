package main

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

var errNoPool = errors.New("no tenant pool in this test")

type noPools struct{}

func (noPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) { return nil, errNoPool }

// W1.09: the worker checks uploaded files and closes expired upload sessions — both event types reach a handler
// of the module (it asks for the tenant pool); other types still go to nobody.
func TestRegisterFiles(t *testing.T) {
	t.Parallel()
	log := slog.New(slog.DiscardHandler)
	reg := events.NewRegistry()
	if err := registerFiles(reg, noPools{}, func(string) string { return "" }, log); err != nil {
		t.Fatal(err)
	}
	for _, typ := range []string{files.EventUploaded, files.EventDeadline} {
		err := reg.Dispatch(t.Context(), events.Message{TenantID: uuid.New(), Type: typ, AggregateID: uuid.New()})
		if !errors.Is(err, errNoPool) {
			t.Errorf("%s: %v, want the handler of the module", typ, err)
		}
	}
	if err := reg.Dispatch(t.Context(), events.Message{Type: files.EventReady}); err != nil {
		t.Errorf("%s: %v", files.EventReady, err)
	}
	bad := map[string]string{"S3_ENDPOINT": "http://127.0.0.1:19015"}
	err := registerFiles(events.NewRegistry(), noPools{}, func(k string) string { return bad[k] }, log)
	if err == nil || !strings.Contains(err.Error(), "S3_BUCKET") {
		t.Fatalf("half-configured storage: %v", err)
	}
}
