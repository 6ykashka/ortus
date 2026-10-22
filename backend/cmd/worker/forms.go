package main

// W4.21: «Хранить ответы» of the forms (Q-W4.00-forms-22) — the worker deletes the responses older than the
// retention of their forms in every tenant every WORKER_FORMS_RETENTION_INTERVAL (forms.Service.Retain) with the rows
// and the records of the knowledge base and the files of their answers (return 1).
import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// newFormsService is the module of forms of the worker: «Хранить ответы» with the purge of what a response left
// outside the module (return 1, D-26) — the rows and the records of the knowledge base (knowledge/forms_port.go) and
// the files of the answers (files/forms_port.go) over the object storage of S3_*; without S3_ENDPOINT the files are
// released but keep their bytes (the job says so in its log).
func newFormsService(pools *tenantctx.Pools, getenv func(string) string, now func() time.Time, log *slog.Logger) (*forms.Service, error) {
	fs := &files.Service{Pools: pools}
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return nil, fmt.Errorf("object storage: %w", err)
	case ok:
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return nil, err
		}
		fs.Store = s3
	default:
		log.Warn("worker: S3_ENDPOINT is not set — the files of the responses of forms past «Хранить ответы» keep their bytes")
	}
	return &forms.Service{Pools: pools, Purge: formsPurge{kb: &knowledge.Service{}, files: fs}, Now: now}, nil
}

// formsPurge adapts the ports of the knowledge base and of the files to forms.Purge.
type formsPurge struct {
	kb    *knowledge.Service
	files *files.Service
}

var _ forms.Purge = formsPurge{}

// FormRecords implements forms.Purge.
func (p formsPurge) FormRecords(ctx context.Context, tx pgx.Tx, form uuid.UUID, numbers []string) (int, error) {
	return p.kb.FormPurge(ctx, tx, form, numbers)
}

// FormFiles implements forms.Purge.
func (p formsPurge) FormFiles(ctx context.Context, tx pgx.Tx, tenant, form uuid.UUID, ids []uuid.UUID) (func(context.Context) error, error) {
	return p.files.PurgeFormFiles(ctx, tx, tenant, form, ids)
}

// defaultFormsRetentionInterval is WORKER_FORMS_RETENTION_INTERVAL by default.
const defaultFormsRetentionInterval = time.Hour

// formsRetentionInterval reads WORKER_FORMS_RETENTION_INTERVAL: a Go duration ≥ 0 (0 — off).
func formsRetentionInterval(getenv func(string) string) (time.Duration, error) {
	raw := orDefault(getenv("WORKER_FORMS_RETENTION_INTERVAL"), defaultFormsRetentionInterval.String())
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d < 0 {
		return 0, fmt.Errorf("WORKER_FORMS_RETENTION_INTERVAL=%q: want a Go duration ≥ 0 (1h, 15m; 0 — off)", raw)
	}
	return d, nil
}

// formsRetentionJob returns the retention of the responses over the tenants of the worker, or a job that returns at
// once when WORKER_FORMS_RETENTION_INTERVAL is 0; a malformed interval is an error of the configuration.
func formsRetentionJob(getenv func(string) string, tenants func(context.Context) ([]uuid.UUID, error), svc *forms.Service,
	log *slog.Logger) (func(context.Context), error) {
	off := func(context.Context) {}
	switch every, err := formsRetentionInterval(getenv); {
	case err != nil:
		return off, err
	case every > 0:
		return formsRetention{tenants: tenants, retain: svc.Retain, every: every, log: log}.run, nil
	}
	return off, nil
}

// formsRetention deletes the old responses of the forms of the tenant DBs on a schedule.
type formsRetention struct {
	tenants func(ctx context.Context) ([]uuid.UUID, error) // the tenants of the outbox delivery (listTenants)
	retain  func(ctx context.Context, tenantID uuid.UUID) (int, error)
	every   time.Duration
	log     *slog.Logger
}

// once retains every tenant; a failing tenant does not stop the others, its error is returned with its id.
func (r formsRetention) once(ctx context.Context) error {
	ids, err := r.tenants(ctx)
	if err != nil {
		return fmt.Errorf("forms retention: %w", err)
	}
	var errs []error
	for _, id := range ids {
		n, err := r.retain(ctx, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("forms retention of tenant %s: %w", id, err))
			continue
		}
		if n > 0 {
			r.log.InfoContext(ctx, "worker: forms retention", slog.String("tenant_id", id.String()), slog.Int("deleted", n))
		}
	}
	return errors.Join(errs...)
}

// run retains at start and then every interval until ctx ends.
func (r formsRetention) run(ctx context.Context) {
	ticker := time.NewTicker(r.every)
	defer ticker.Stop()
	for {
		if err := r.once(ctx); err != nil && ctx.Err() == nil {
			r.log.WarnContext(ctx, "worker: forms retention", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
