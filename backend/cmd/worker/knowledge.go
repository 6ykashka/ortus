package main

// W4.31 (возврат 1): the scheduled check of the review dates of the knowledge base — the rule «Пора пересмотреть
// страницу → уведомить владельца» runs «По расписанию · каждый день в 09:00» (knowledge.js:291; Moscow, the clock of
// the application) in every space where it is on, as the member who switched it on with his rights checked at each
// run (knowledge.Service.ScheduledReview). The worker looks every WORKER_KB_REVIEW_INTERVAL: the first look after 09:00
// runs a rule, a line of its journal since 09:00 marks the check of the day done.
import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// defaultKBReviewInterval is WORKER_KB_REVIEW_INTERVAL by default: the check of the day runs at most a minute after
// 09:00.
const defaultKBReviewInterval = time.Minute

// kbReviewInterval reads WORKER_KB_REVIEW_INTERVAL: a Go duration ≥ 0 (0 — off).
func kbReviewInterval(getenv func(string) string) (time.Duration, error) {
	raw := orDefault(getenv("WORKER_KB_REVIEW_INTERVAL"), defaultKBReviewInterval.String())
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d < 0 {
		return 0, fmt.Errorf("WORKER_KB_REVIEW_INTERVAL=%q: want a Go duration ≥ 0 (1m, 30s; 0 — off)", raw)
	}
	return d, nil
}

// newKnowledge is the service of the knowledge base of the worker: the tenant pools of the worker (role
// ortus_worker), the memberships and owner bindings of the control DB (the author of a rule is an active member, the
// owner of the business), the inbox (recipients of the control DB) and the clock of the application.
func newKnowledge(pools knowledge.Pools, control *pgxpool.Pool, audience inbox.Audience, now func() time.Time) *knowledge.Service {
	return &knowledge.Service{
		Pools: pools, Memberships: knowledge.PGMemberships{DB: control}, Recipients: inbox.PGRecipients{Control: control},
		Audience: audience, Now: now,
	}
}

// kbReviewJob returns the scheduled check of the review dates over the tenants of the worker, or a job that returns
// at once when WORKER_KB_REVIEW_INTERVAL is 0; a malformed interval is an error of the configuration.
func kbReviewJob(getenv func(string) string, tenants func(context.Context) ([]uuid.UUID, error), svc *knowledge.Service,
	log *slog.Logger) (func(context.Context), error) {
	every, err := kbReviewInterval(getenv)
	if err != nil || every == 0 {
		return func(context.Context) {}, err
	}
	k := kbReview{tenants: tenants, check: svc.ScheduledReview, every: every, log: log}
	return k.run, nil
}

// kbReview runs the check of the review dates of the knowledge base in the tenant DBs on a schedule.
type kbReview struct {
	tenants func(ctx context.Context) ([]uuid.UUID, error) // the tenants of the outbox delivery (listTenants)
	check   func(ctx context.Context, tenantID uuid.UUID) ([]knowledge.ReviewRun, error)
	every   time.Duration
	log     *slog.Logger
}

// once checks every tenant; a failing tenant does not stop the others, its error is returned with its id.
func (k kbReview) once(ctx context.Context) error {
	ids, err := k.tenants(ctx)
	if err != nil {
		return fmt.Errorf("knowledge review: %w", err)
	}
	var errs []error
	for _, id := range ids {
		runs, err := k.check(ctx, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("knowledge review of tenant %s: %w", id, err))
		}
		for _, r := range runs {
			k.log.InfoContext(ctx, "worker: knowledge review", slog.String("tenant_id", id.String()),
				slog.String("space_id", r.Space.String()), slog.String("rule_id", r.Rule.String()), slog.Int("due", r.Due),
				slog.String("result", r.Result))
		}
	}
	return errors.Join(errs...)
}

// run checks at start and then every interval until ctx ends.
func (k kbReview) run(ctx context.Context) {
	ticker := time.NewTicker(k.every)
	defer ticker.Stop()
	for {
		if err := k.once(ctx); err != nil && ctx.Err() == nil {
			k.log.WarnContext(ctx, "worker: knowledge review", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
