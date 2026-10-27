package chats

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

// Tenants lists the tenants the jobs go through.
type Tenants interface {
	IDs(ctx context.Context) ([]uuid.UUID, error)
}

// Runner runs the jobs by term of the chats in all tenants on a timer: the sweep (temporary messages, files, terms, polls,
// exports) and the recomputation of the rosters. The recomputation stands in for the consumers of the events of the roster
// (a role of the area, a group, a block or dismissal, a foreman, a driver): a change reaches the chats within one period.
type Runner struct {
	S       *Service
	Tenants Tenants
	Log     *slog.Logger
}

// Once goes through all the tenants once; a failure of one tenant is logged and does not stop the others.
func (r Runner) Once(ctx context.Context) {
	ids, err := r.Tenants.IDs(ctx)
	if err != nil {
		if ctx.Err() == nil {
			r.Log.ErrorContext(ctx, "chats: tenants", slog.String("error", err.Error()))
		}
		return
	}
	for _, id := range ids {
		if _, err := r.S.RecomputeAll(ctx, id); err != nil && ctx.Err() == nil {
			r.Log.ErrorContext(ctx, "chats: recompute", slog.String("tenant_id", id.String()), slog.String("error", err.Error()))
		}
		if _, err := r.S.Sweep(ctx, id); err != nil && ctx.Err() == nil {
			r.Log.ErrorContext(ctx, "chats: sweep", slog.String("tenant_id", id.String()), slog.String("error", err.Error()))
		}
	}
}

// Run goes through the tenants every period until ctx ends.
func (r Runner) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		r.Once(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}
