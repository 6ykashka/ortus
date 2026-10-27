package main

// W7.23: the jobs of «Документы» — recognition (OCRmyPDF + Tesseract), compression, merge and split (qpdf),
// conversions and PDF/A. The worker looks every WORKER_DOCS_INTERVAL for queued jobs (docs.jobs) of every tenant and
// runs them one by one, at most docsBatch per tenant per look; the result is a new version or a new document, counted
// into the storage of the organization.
import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

const (
	// defaultDocsInterval is WORKER_DOCS_INTERVAL by default: a job waits a few seconds for the worker (the screen polls
	// every 450 ms while a job runs).
	defaultDocsInterval = 5 * time.Second
	// docsBatch is how many jobs of one tenant the worker runs in one look.
	docsBatch = 5
)

// docsInterval reads WORKER_DOCS_INTERVAL: a Go duration ≥ 0 (0 — off).
func docsInterval(getenv func(string) string) (time.Duration, error) {
	raw := orDefault(getenv("WORKER_DOCS_INTERVAL"), defaultDocsInterval.String())
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d < 0 {
		return 0, fmt.Errorf("WORKER_DOCS_INTERVAL=%q: want a Go duration ≥ 0 (5s, 1m; 0 — off)", raw)
	}
	return d, nil
}

// newDocs is the service of «Документы» of the worker: the tenant pools of the worker (role ortus_worker), the
// memberships of the control DB, the inbox, the object storage of S3_* and the programs of the jobs (DOCS_*).
func newDocs(pools docs.Pools, control *pgxpool.Pool, audience inbox.Audience, getenv func(string) string, now func() time.Time,
	log *slog.Logger) (*docs.Service, error) {
	svc := &docs.Service{
		Pools: pools, Memberships: docs.PGMemberships{DB: control}, Recipients: inbox.PGRecipients{Control: control}, Audience: audience, Now: now,
	}
	if p := docs.ExecProcessorFromEnv(getenv); p != nil {
		svc.Processor = p
	} else {
		log.Warn("worker: no program of the jobs of documents is installed (ocrmypdf, qpdf, soffice) — the jobs fail with a hint")
	}
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return nil, fmt.Errorf("object storage: %w", err)
	case ok:
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return nil, err
		}
		svc.Blobs = docs.PresignedBlobs{Store: s3}
	default:
		log.Warn("worker: S3_ENDPOINT is not set — the jobs of documents cannot read or write files")
	}
	return svc, nil
}

// docsJob returns the loop of the jobs of documents over the tenants of the worker, or a job that returns at once when
// WORKER_DOCS_INTERVAL is 0; a malformed interval is an error of the configuration.
func docsJob(getenv func(string) string, tenants func(context.Context) ([]uuid.UUID, error), svc *docs.Service,
	log *slog.Logger) (func(context.Context), error) {
	every, err := docsInterval(getenv)
	if err != nil {
		return nil, err
	}
	if every == 0 {
		return func(context.Context) {}, nil
	}
	var process func(context.Context, uuid.UUID, int) (int, error)
	if svc != nil {
		process = svc.ProcessJobs
	}
	return docsRunner{tenants: tenants, process: process, every: every, log: log}.run, nil
}

// docsLoop is the service of documents of the worker with its loop of jobs.
func docsLoop(pools docs.Pools, control *pgxpool.Pool, audience inbox.Audience, tenants func(context.Context) ([]uuid.UUID, error),
	getenv func(string) string, now func() time.Time, log *slog.Logger) (func(context.Context), error) {
	svc, err := newDocs(pools, control, audience, getenv, now, log)
	if err != nil {
		return nil, err
	}
	return docsJob(getenv, tenants, svc, log)
}

// docsRunner runs the queued jobs of documents in the tenant DBs on a schedule.
type docsRunner struct {
	tenants func(ctx context.Context) ([]uuid.UUID, error) // the tenants of the outbox delivery (listTenants)
	process func(ctx context.Context, tenant uuid.UUID, limit int) (int, error)
	every   time.Duration
	log     *slog.Logger
}

// once looks into every tenant; a failing tenant does not stop the others, its error is returned with its id.
func (d docsRunner) once(ctx context.Context) error {
	ids, err := d.tenants(ctx)
	if err != nil {
		return fmt.Errorf("document jobs: %w", err)
	}
	var errs []error
	for _, id := range ids {
		n, err := d.process(ctx, id, docsBatch)
		if err != nil {
			errs = append(errs, fmt.Errorf("document jobs of tenant %s: %w", id, err))
		}
		if n > 0 {
			d.log.InfoContext(ctx, "worker: document jobs", slog.String("tenant_id", id.String()), slog.Int("ran", n))
		}
	}
	return errors.Join(errs...)
}

// run looks at start and then every interval until ctx ends.
func (d docsRunner) run(ctx context.Context) {
	ticker := time.NewTicker(d.every)
	defer ticker.Stop()
	for {
		if err := d.once(ctx); err != nil && ctx.Err() == nil {
			d.log.WarnContext(ctx, "worker: document jobs", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
