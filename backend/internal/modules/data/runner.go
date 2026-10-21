package data

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.50: shared command helpers of the modules (Tx, Audit; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.50 (07-ux-and-data §3): the worker of the export jobs (cmd/worker). It takes the queued jobs of a tenant (for
// update skip locked), rechecks the rights of the author at the moment of the snapshot — a narrowed right or an ended
// membership revoke the job (permissions_changed), a disabled module — module_disabled — and writes the CSV of
// exportDataset (W2.50: the same cells, «;», quotes, formula guard) with a BOM, up to the row limit of the job, to the
// object storage under exports/<tenant>/<job>.csv; the file is kept 24 h, then deleted. A failure ends the job failed
// with its code only (timeout, source_unavailable, internal); the cause stays in the log.

// Limits of the worker.
const (
	DefaultBatch   = 5                // jobs of a tenant taken by one Once
	DefaultRecheck = time.Minute      // how often the rights of the authors of the ready jobs of a tenant are rechecked
	JobTimeout     = 2 * time.Minute  // the snapshot and the upload of one job
	JobLease       = 10 * time.Minute // a running job older than this is taken again (the worker stopped)
	maxAttempts    = 3                // takes of a job; one more — failed timeout
	failTimeout    = string(dataapi.Timeout)
	failSource     = string(dataapi.SourceUnavailable)
	failInternal   = string(dataapi.Internal)
	bom            = "\xef\xbb\xbf" // spreadsheets read the file as UTF-8 (MSW W4.06: the file of the mock has it too)
)

// ExportStore is what the worker needs of the object storage: writing the file of a job and deleting it.
type ExportStore interface {
	Upload(ctx context.Context, key, contentType string, body []byte) error
	Delete(ctx context.Context, key string) error
}

// Members resolves the author of a job: his tenant context while his membership of the tenant is active (false — it
// is not: the job is revoked).
type Members interface {
	Member(ctx context.Context, tenantID, personID uuid.UUID) (tenantctx.TenantContext, bool, error)
}

// Format writes the CSV of rows of the columns sel of the dataset ds in the time zone loc (fleet/csv.File).
type Format func(ds dataapi.Dataset, sel []string, rows []dataapi.DatasetRow, loc *time.Location) (string, error)

// Runner is the worker of the export jobs over the tenant DBs of S (its evaluator narrows the rows of a dataset by
// data.export, as exportDataset does: fleet/csv.ExportScope).
type Runner struct {
	S       *Service
	Members Members
	Format  Format
	Store   ExportStore   // nil — the jobs fail with source_unavailable, the expired files stay
	Batch   int           // 0 — DefaultBatch
	Timeout time.Duration // 0 — JobTimeout
	Lease   time.Duration // 0 — JobLease
	Recheck time.Duration // 0 — DefaultRecheck: the ready jobs of a tenant are rechecked at most this often
	Log     *slog.Logger  // nil — slog.Default

	mu      sync.Mutex
	checked map[uuid.UUID]time.Time // the last recheck of the ready jobs of a tenant (the system clock)
}

// RunResult counts what one Once did in a tenant.
type RunResult struct{ Ready, Failed, Revoked, Expired int }

// ExportKey is the key of the file of the job in the object storage (never in the API).
func ExportKey(tenantID, jobID uuid.UUID) string {
	return "exports/" + tenantID.String() + "/" + jobID.String() + ".csv"
}

func (r *Runner) log() *slog.Logger {
	if r.Log != nil {
		return r.Log
	}
	return slog.Default()
}

func positive[T int | time.Duration](v, def T) T {
	if v > 0 {
		return v
	}
	return def
}

// Once deletes the expired files of the tenant, revokes the ready jobs whose authors lost the rights (at most once per
// Recheck), then takes up to Batch queued jobs one by one; an error of the tenant DB stops it (the next run continues).
func (r *Runner) Once(ctx context.Context, tenantID uuid.UUID) (RunResult, error) {
	var res RunResult
	n, err := r.expire(ctx, tenantID)
	res.Expired = n
	if err != nil {
		return res, err
	}
	if res.Revoked, err = r.recheck(ctx, tenantID); err != nil {
		return res, err
	}
	for range positive(r.Batch, DefaultBatch) {
		j, ok, err := r.claim(ctx, tenantID)
		if err != nil || !ok {
			return res, err
		}
		state, err := r.process(ctx, tenantID, j)
		if err != nil {
			return res, err
		}
		switch state {
		case stateReady:
			res.Ready++
		case stateFailed:
			res.Failed++
		case stateRevoked:
			res.Revoked++
		}
	}
	return res, nil
}

// expire deletes the files of the ready jobs past expiresAt, one job per transaction (the file goes before its row
// commits); without the storage nothing is deleted — the API reads such a job as expired anyway.
func (r *Runner) expire(ctx context.Context, tenantID uuid.UUID) (int, error) {
	if r.Store == nil {
		return 0, nil
	}
	now := r.S.now()
	for n := 0; ; n++ {
		found := false
		err := kit.Tx(ctx, r.S.Pools, tenantID, func(tx pgx.Tx) error {
			var (
				id  uuid.UUID
				key string
			)
			err := tx.QueryRow(ctx, `select id, object_key from data.export_jobs where state = 'ready' and expires_at <= $1
				order by expires_at, id limit 1 for update skip locked`, now).Scan(&id, &key)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil
			}
			if err != nil {
				return err
			}
			found = true
			if err := r.Store.Delete(ctx, key); err != nil {
				return fmt.Errorf("data: delete expired export %s: %w", id, err)
			}
			_, err = tx.Exec(ctx, `update data.export_jobs set state = 'expired', object_key = null, revision = revision + 1
				where id = $1`, id)
			return err
		})
		if err != nil || !found {
			return n, err
		}
	}
}

// due tells whether the ready jobs of the tenant are to be rechecked now and marks the recheck (the system clock: the
// fixed clock of the stand never moves).
func (r *Runner) due(tenantID uuid.UUID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	if last, ok := r.checked[tenantID]; ok && now.Sub(last) < positive(r.Recheck, DefaultRecheck) {
		return false
	}
	if r.checked == nil {
		r.checked = map[uuid.UUID]time.Time{}
	}
	r.checked[tenantID] = now
	return true
}

// recheck revokes the ready jobs of the tenant whose authors lost the rights since the snapshot — the membership,
// data.export, the permission version or a column (permissions_changed), the module (module_disabled) — and deletes
// their files. The download rechecks the rights too, but the gate of getDatasetExportDownload answers 403 to an author
// without data.export before it, and his ready file would stay in the storage till its expiry. A job whose author
// cannot be resolved now (the control DB) waits for the next recheck.
func (r *Runner) recheck(ctx context.Context, tenantID uuid.UUID) (int, error) {
	if r.Store == nil || !r.due(tenantID) {
		return 0, nil
	}
	pool, err := r.S.Pools.For(ctx, tenantID)
	if err != nil {
		return 0, err
	}
	rows, err := pool.Query(ctx, jobSelect+` where j.state = 'ready' and j.expires_at > $1 order by j.created_at, j.id`, r.S.now())
	if err != nil {
		return 0, fmt.Errorf("data: ready export jobs: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (jobRow, error) { return scanJob(row) })
	if err != nil {
		return 0, fmt.Errorf("data: ready export jobs: %w", err)
	}
	n := 0
	for _, j := range list {
		reason, err := r.authorNarrowed(ctx, tenantID, j)
		if err != nil {
			r.log().WarnContext(ctx, "data: rights of the author of a ready export are not rechecked",
				slog.String("job_id", j.ID.String()), slog.String("error", err.Error()))
			continue
		}
		if reason == "" {
			continue
		}
		done, err := r.revokeReady(ctx, tenantID, j.ID, reason)
		if err != nil {
			return n, err
		}
		if done {
			n++
		}
	}
	return n, nil
}

// authorNarrowed is why the rights of the author of j narrowed ("" — they hold): his membership ended, or narrowed.
func (r *Runner) authorNarrowed(ctx context.Context, tenantID uuid.UUID, j jobRow) (string, error) {
	tc, ok, err := r.Members.Member(ctx, tenantID, j.Author)
	switch {
	case err != nil:
		return "", err
	case !ok:
		return reasonNarrowed, nil
	}
	return r.S.narrowed(ctx, tc, j)
}

// revokeReady revokes the job id for reason by the server while it is still ready, its file deleted before the commit.
func (r *Runner) revokeReady(ctx context.Context, tenantID, id uuid.UUID, reason string) (bool, error) {
	now := r.S.now()
	done := false
	err := kit.Tx(ctx, r.S.Pools, tenantID, func(tx pgx.Tx) error {
		locked, err := scanJob(tx.QueryRow(ctx, jobSelect+` where j.id = $1 and j.state = 'ready' for update of j skip locked`, id))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := revokeJob(ctx, tx, r.Store, locked, reason, nil, now); err != nil {
			return err
		}
		done = true
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("data: revoke ready export job %s: %w", id, err)
	}
	return done, nil
}

// claim takes the oldest queued job of the tenant (or a running one past the lease) and marks it running.
func (r *Runner) claim(ctx context.Context, tenantID uuid.UUID) (jobRow, bool, error) {
	now := r.S.now()
	var (
		j     jobRow
		found bool
	)
	err := kit.Tx(ctx, r.S.Pools, tenantID, func(tx pgx.Tx) error {
		var id uuid.UUID
		err := tx.QueryRow(ctx, `select id from data.export_jobs
			where state = 'queued' or (state = 'running' and started_at < $1)
			order by created_at, id limit 1 for update skip locked`, now.Add(-positive(r.Lease, JobLease))).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update data.export_jobs set state = 'running', started_at = $2, attempts = attempts + 1,
			revision = revision + 1 where id = $1`, id, now); err != nil {
			return err
		}
		j, err = scanJob(tx.QueryRow(ctx, jobSelect+` where j.id = $1`, id))
		found = err == nil
		return err
	})
	if err != nil {
		return jobRow{}, false, fmt.Errorf("data: claim export job: %w", err)
	}
	return j, found, nil
}

// process runs a claimed job and returns the state it ended in ("" — it was revoked by a member while it ran).
func (r *Runner) process(ctx context.Context, tenantID uuid.UUID, j jobRow) (string, error) {
	if j.Attempts > maxAttempts {
		return r.fail(ctx, tenantID, j, failTimeout, errors.New("too many attempts"))
	}
	tc, ok, err := r.Members.Member(ctx, tenantID, j.Author)
	switch {
	case err != nil:
		return r.fail(ctx, tenantID, j, failSource, err)
	case !ok:
		return r.revoke(ctx, tenantID, j, reasonNarrowed)
	}
	reason, err := r.S.narrowed(ctx, tc, j)
	switch {
	case err != nil:
		return r.fail(ctx, tenantID, j, failSource, err)
	case reason != "":
		return r.revoke(ctx, tenantID, j, reason)
	case r.Store == nil:
		return r.fail(ctx, tenantID, j, failSource, errors.New("no object storage (S3_ENDPOINT)"))
	}
	w, err := r.write(ctx, tc, j)
	if err != nil {
		return r.fail(ctx, tenantID, j, failure(err), err)
	}
	return r.finish(ctx, tenantID, j, w)
}

// written is the file of a job in the storage.
type written struct {
	key, name string
	rows      int
	truncated bool
	size      int64
	at        time.Time // the snapshot
}

// errUpload marks a failure of the object storage.
var errUpload = errors.New("data: upload export file")

// write takes the snapshot of the job for the member of tc and uploads its file.
func (r *Runner) write(ctx context.Context, tc tenantctx.TenantContext, j jobRow) (written, error) {
	loc, err := time.LoadLocation(knownZone(j.Zone))
	if err != nil {
		return written{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, positive(r.Timeout, JobTimeout))
	defer cancel()
	at := r.S.now()
	ds, rows, truncated, err := r.S.Snapshot(ctx, tc, j.Dataset, j.Spec, int(j.RowLimit))
	if err != nil {
		return written{}, err
	}
	text, err := r.Format(ds, j.Spec.Select, rows, loc)
	if err != nil {
		return written{}, err
	}
	body := []byte(bom + text)
	key := ExportKey(tc.TenantID, j.ID)
	if err := r.Store.Upload(ctx, key, CSVContentType, body); err != nil {
		return written{}, fmt.Errorf("%w %s: %w", errUpload, key, err)
	}
	return written{key: key, name: j.DatasetName + "-" + at.In(loc).Format(time.DateOnly) + ".csv", rows: len(rows),
		truncated: truncated, size: int64(len(body)), at: at}, nil
}

// failure is the code of a failed job: the time of the job is over — timeout; the tenant DB or the storage did not
// answer — source_unavailable; anything else — internal.
func failure(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return failTimeout
	case errors.Is(err, errUpload):
		return failSource
	case problem.Is(err, problem.CodeDependencyUnavailable):
		return failSource
	}
	return failInternal
}

// finish makes the running job ready with its file for JobKeep; a job revoked while it ran keeps no file.
func (r *Runner) finish(ctx context.Context, tenantID uuid.UUID, j jobRow, w written) (string, error) {
	now := r.S.now()
	done := false
	err := kit.Tx(ctx, r.S.Pools, tenantID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `update data.export_jobs set state = 'ready', snapshot_at = $2, row_count = $3, truncated = $4,
			file_name = $5, object_key = $6, size_bytes = $7, finished_at = $8, expires_at = $9, revision = revision + 1
			where id = $1 and state = 'running'`, j.ID, w.at, w.rows, w.truncated, w.name, w.key, w.size, now, now.Add(JobKeep))
		done = err == nil && tag.RowsAffected() == 1
		return err
	})
	if err != nil {
		return "", fmt.Errorf("data: finish export job %s: %w", j.ID, err)
	}
	if done {
		return stateReady, nil
	}
	if err := r.Store.Delete(ctx, w.key); err != nil {
		r.log().WarnContext(ctx, "data: export file of a revoked job is kept", slog.String("job_id", j.ID.String()),
			slog.String("error", err.Error()))
	}
	return "", nil
}

// fail ends the running job failed with code; cause goes to the log only.
func (r *Runner) fail(ctx context.Context, tenantID uuid.UUID, j jobRow, code string, cause error) (string, error) {
	r.log().WarnContext(ctx, "data: export job failed", slog.String("tenant_id", tenantID.String()),
		slog.String("job_id", j.ID.String()), slog.String("code", code), slog.String("error", cause.Error()))
	err := kit.Tx(ctx, r.S.Pools, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `update data.export_jobs set state = 'failed', failure_code = $2, finished_at = $3,
			revision = revision + 1 where id = $1 and state = 'running'`, j.ID, code, r.S.now())
		return err
	})
	if err != nil {
		return "", fmt.Errorf("data: fail export job %s: %w", j.ID, err)
	}
	return stateFailed, nil
}

// revoke ends the running job revoked for reason by the server (audit data.export.revoked of the service).
func (r *Runner) revoke(ctx context.Context, tenantID uuid.UUID, j jobRow, reason string) (string, error) {
	now := r.S.now()
	err := kit.Tx(ctx, r.S.Pools, tenantID, func(tx pgx.Tx) error {
		locked, err := scanJob(tx.QueryRow(ctx, jobSelect+` where j.id = $1 and j.state = 'running' for update of j`, j.ID))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		_, err = revokeJob(ctx, tx, nil, locked, reason, nil, now)
		return err
	})
	if err != nil {
		return "", fmt.Errorf("data: revoke export job %s: %w", j.ID, err)
	}
	return stateRevoked, nil
}
