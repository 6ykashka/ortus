package main

// W4.50 (07-ux-and-data §3): the export jobs of «Данные». cmd/api only queues a job (createDatasetExportJob); the
// worker takes it every WORKER_EXPORT_INTERVAL, rechecks the rights of its author (his membership and owner binding
// of the control DB, the evaluator of W1.04 narrowed by data.export as exportDataset of W2.50) and writes the CSV with
// a BOM to the object storage of S3_* (exports/<tenant>/<job>.csv, 24 h); the expired files are deleted. Without
// S3_ENDPOINT the jobs fail with source_unavailable.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	datafleet "github.com/ortus/ortus-crm/backend/internal/modules/data/fleet"
	dataforms "github.com/ortus/ortus-crm/backend/internal/modules/data/forms"
	datatasks "github.com/ortus/ortus-crm/backend/internal/modules/data/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/csv"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// defaultExportInterval is WORKER_EXPORT_INTERVAL by default.
const defaultExportInterval = 2 * time.Second

// exportInterval reads WORKER_EXPORT_INTERVAL: a Go duration ≥ 0 (0 — off).
func exportInterval(getenv func(string) string) (time.Duration, error) {
	raw := orDefault(getenv("WORKER_EXPORT_INTERVAL"), defaultExportInterval.String())
	d, err := time.ParseDuration(strings.TrimSpace(raw))
	if err != nil || d < 0 {
		return 0, fmt.Errorf("WORKER_EXPORT_INTERVAL=%q: want a Go duration ≥ 0 (2s, 1m; 0 — off)", raw)
	}
	return d, nil
}

// exportDeps are what the worker of the export jobs reads.
type exportDeps struct {
	getenv  func(string) string
	tenants func(context.Context) ([]uuid.UUID, error) // the tenants of the outbox delivery (listTenants)
	control *pgxpool.Pool                              // memberships and owner bindings of the authors
	pools   *tenantctx.Pools
	now     func() time.Time // the clock of the application (APP_FIXED_NOW outside prod)
	log     *slog.Logger
}

// exportJob returns the scheduled worker of the export jobs, or a job that returns at once when
// WORKER_EXPORT_INTERVAL is 0; a malformed interval or a half-configured storage is an error of the configuration.
func exportJob(d exportDeps) (func(context.Context), error) {
	every, err := exportInterval(d.getenv)
	if err != nil || every == 0 {
		return func(context.Context) {}, err
	}
	reg, err := exportRegistry()
	if err != nil {
		return nil, err
	}
	modules := &modulesreg.Service{Store: modulesreg.PGStore{Pools: d.pools}, Activity: modulesreg.DefaultRegistry(), Now: d.now}
	r := &data.Runner{
		S: &data.Service{
			Pools: d.pools, Authz: csv.ExportScope{Scoper: exportScoper(d.pools, d.now)}, Registry: reg,
			Modules: moduleStates{s: modules}, Hidden: poolHider{s: &pool.Service{Pools: d.pools, Now: d.now}}, Now: d.now,
		},
		Members: controlMembers{control: d.control}, Format: csv.File, Log: d.log,
	}
	cfg, ok, err := storage.ConfigFromEnv(d.getenv)
	switch {
	case err != nil:
		return nil, fmt.Errorf("object storage: %w", err)
	case ok:
		cfg.PublicEndpoint = cfg.Endpoint // the worker puts the file itself: the presigned PUT goes to the server-side endpoint
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return nil, err
		}
		r.Store = s3Store{s3: s3, client: &http.Client{Timeout: data.JobTimeout}}
	default:
		d.log.Warn("worker: S3_ENDPOINT is not set — export jobs of «Данные» fail with source_unavailable")
	}
	x := exportRun{tenants: d.tenants, runner: r, every: every, log: d.log}
	return x.run, nil
}

// exportRegistry is the registry of the datasets of the export jobs — that of cmd/api (dataRegistry, data.go): logistics,
// «Ответы на осмотр» of the forms and «Задачи» (W4.80).
func exportRegistry() (*data.Registry, error) {
	return data.NewRegistry(datafleet.Provider{}, dataforms.Provider{}, datatasks.Provider{})
}

// exportScoper is the evaluator of the export jobs on the clock of the application with the projects of tasks
// registered as in cmd/api (projectsIn): the rows of «Задачи» of a file follow the level of a project (W4.80).
func exportScoper(pools *tenantctx.Pools, now func() time.Time) *authz.Evaluator {
	src := authz.PGSource{Pools: pools}
	return projectsIn(authz.New(src, src, now), pools)
}

// exportRun runs the worker of the export jobs in every tenant on a schedule.
type exportRun struct {
	tenants func(ctx context.Context) ([]uuid.UUID, error)
	runner  *data.Runner
	every   time.Duration
	log     *slog.Logger
}

// once runs the jobs of every tenant; a failing tenant does not stop the others, its error is returned with its id.
func (x exportRun) once(ctx context.Context) error {
	ids, err := x.tenants(ctx)
	if err != nil {
		return fmt.Errorf("export jobs: %w", err)
	}
	var errs []error
	for _, id := range ids {
		res, err := x.runner.Once(ctx, id)
		if err != nil {
			errs = append(errs, fmt.Errorf("export jobs of tenant %s: %w", id, err))
		}
		if res != (data.RunResult{}) {
			x.log.InfoContext(ctx, "worker: export jobs", slog.String("tenant_id", id.String()), slog.Int("ready", res.Ready),
				slog.Int("failed", res.Failed), slog.Int("revoked", res.Revoked), slog.Int("expired", res.Expired))
		}
	}
	return errors.Join(errs...)
}

// run takes the jobs at start and then every interval until ctx ends.
func (x exportRun) run(ctx context.Context) {
	ticker := time.NewTicker(x.every)
	defer ticker.Stop()
	for {
		if err := x.once(ctx); err != nil && ctx.Err() == nil {
			x.log.WarnContext(ctx, "worker: export jobs", slog.String("error", err.Error()))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// s3Store is data.ExportStore over the storage of W1.09: the worker puts the file by a presigned PUT of its exact
// size and content type (the storage has no server-side write) and deletes it.
type s3Store struct {
	s3     *storage.S3
	client *http.Client
}

// presignTTL is the life of the presigned PUT of a file the worker uploads at once.
const presignTTL = 5 * time.Minute

// Upload implements data.ExportStore.
func (s s3Store) Upload(ctx context.Context, key, contentType string, body []byte) error {
	u, err := s.s3.PresignPut(key, contentType, int64(len(body)), presignTTL)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(body))
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("storage: PUT %s: %s", key, resp.Status)
	}
	return nil
}

// Delete implements data.ExportStore.
func (s s3Store) Delete(ctx context.Context, key string) error { return s.s3.Delete(ctx, key) }

// controlMembers resolves the author of a job by the memberships of the control DB: an active membership of a tenant
// that serves reads (trial, active, grace, read_only), the owner by his active owner binding.
type controlMembers struct{ control *pgxpool.Pool }

// memberSQL is the membership of the person $2 in the tenant $1.
const memberSQL = `
select m.id, m.account_id, m.status::text = 'active' and t.state::text in ('trial', 'active', 'grace', 'read_only'),
       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null),
       t.state::text in ('grace', 'read_only')
  from memberships m
  join tenants t on t.id = m.tenant_id
 where m.tenant_id = $1 and m.person_profile_id = $2`

// Member implements data.Members.
func (m controlMembers) Member(ctx context.Context, tenantID, personID uuid.UUID) (tenantctx.TenantContext, bool, error) {
	tc := tenantctx.TenantContext{TenantID: tenantID, PersonID: personID}
	var active bool
	err := m.control.QueryRow(ctx, memberSQL, tenantID, personID).Scan(&tc.MembershipID, &tc.AccountID, &active, &tc.Owner, &tc.ReadOnly)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return tenantctx.TenantContext{}, false, nil
	case err != nil:
		return tenantctx.TenantContext{}, false, fmt.Errorf("member of tenant %s: %w", tenantID, err)
	}
	return tc, active, nil
}

// moduleStates are the states of the installable modules of a tenant (the registry of W1.08), as cmd/api reads them.
type moduleStates struct{ s *modulesreg.Service }

// States implements data.Modules.
func (m moduleStates) States(ctx context.Context, tenantID uuid.UUID) (map[string]string, error) {
	inst, err := m.s.Installations(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(inst))
	for key, in := range inst {
		out[key] = in.State
	}
	return out, nil
}

// poolHider is data.Hider over the driver pool (W2.57, AC-06): the trips the transfers of the author close to him are
// left out of his files too.
type poolHider struct{ s *pool.Service }

// Hidden implements data.Hider.
func (p poolHider) Hidden(ctx context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	closed, err := p.s.HiddenTrips(ctx, tc)
	if err != nil {
		return nil, err
	}
	out := make([]uuid.UUID, 0, len(closed))
	for id := range closed {
		out = append(out, id)
	}
	return out, nil
}
