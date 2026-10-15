package subscriptions

import (
	"context"
	"log/slog"
	"time"
)

// Run advances the lifecycle every interval until ctx ends (cmd/api, SUBSCRIPTION_SWEEP_INTERVAL); a failed run is
// logged and the next tick tries again. Several replicas may run it: a tenant locked by one is skipped by the others.
func (s Store) Run(ctx context.Context, every time.Duration, log *slog.Logger) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		n, err := s.Advance(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			log.WarnContext(ctx, "subscriptions: lifecycle run failed", slog.String("error", err.Error()))
		case n > 0:
			log.InfoContext(ctx, "subscriptions: lifecycle steps applied", slog.Int("steps", n))
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
