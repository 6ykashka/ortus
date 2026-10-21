package data

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.50: shared command helpers of the modules (ETag, If-Match, Tx, Audit, Complete, cursors; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.50 (07-ux-and-data §3, contract 0.7.0-stage4 W4.06): the export of a dataset as a job with its journal. The job
// fixes the spec, the labels of the columns, the versions, the time zone and the author; the worker (Runner) takes the
// snapshot, rechecks the rights of the author and writes the CSV of exportDataset to the object storage; the file is
// kept 24 h; every download rechecks the rights again — narrowed rights revoke the job and delete its file.

// Texts and limits of the jobs (the descriptions of the operations; MSW W4.06 msw/data/exports.ts).
const (
	textJobNotFound = "Выгрузка не найдена."
	textJobBusy     = "Дождитесь завершения начатых выгрузок."
	textJobNotReady = "Выгрузка ещё не готова."
	textJobGone     = "Выгрузка недоступна: срок хранения истёк или её отозвали."
	textJobNarrowed = "Права изменились — выгрузка отозвана. Запустите её снова."
	textJobFinished = "Выгрузка уже завершена."
	codeRateLimited = "rate_limited"
	codeTransition  = "invalid_transition"
	targetJob       = "data.export_job"
	keyDataset      = "datasetId"    // the key of the dataset in the diffs of the audit
	JobRowLimit     = 100000         // DatasetExportJob.rowLimit
	JobKeep         = 24 * time.Hour // a ready file lives this long after finishedAt
	LinkTTL         = 5 * time.Minute
	activeJobs      = 3 // queued or running jobs of a member
	defaultZone     = "Europe/Moscow"
	CSVContentType  = "text/csv; charset=utf-8"
	reasonAuthor    = string(dataapi.Author)
	reasonOwner     = string(dataapi.Owner)
	reasonNarrowed  = string(dataapi.PermissionsChanged)
	reasonModuleOff = string(dataapi.ModuleDisabled)
	stateQueued     = string(dataapi.DatasetExportJobStateQueued)
	stateRunning    = string(dataapi.DatasetExportJobStateRunning)
	stateReady      = string(dataapi.DatasetExportJobStateReady)
	stateExpired    = string(dataapi.DatasetExportJobStateExpired)
	stateRevoked    = string(dataapi.DatasetExportJobStateRevoked)
	stateFailed     = string(dataapi.DatasetExportJobStateFailed)
)

// ExportFiles is what the API needs of the object storage of the export files (storage.Store of W1.09): a short link
// to a file and its deletion.
type ExportFiles interface {
	PresignGet(key, fileName string, ttl time.Duration) (string, error)
	Delete(ctx context.Context, key string) error
}

// jobRow is a row of data.export_jobs with the name of its author.
type jobRow struct {
	ID          uuid.UUID
	Dataset     string
	DatasetName string
	View        *uuid.UUID
	Author      uuid.UUID
	AuthorName  string
	State       string
	Spec        dataapi.DatasetExportCreate
	Labels      []string
	Version     string // the permission version of the tenant when the job was created
	Zone        string
	RowLimit    int64
	Snapshot    *time.Time
	Rows        *int64
	Truncated   *bool
	FileName    *string
	Key         *string
	Size        *int64
	Failure     *string
	Reason      *string
	Attempts    int
	Revision    int64
	Created     time.Time
	Started     *time.Time
	Finished    *time.Time
	Expires     *time.Time
	Revoked     *time.Time
}

const jobSelect = `select j.id, j.dataset_id, j.dataset_name, j.view_id, j.requested_by, coalesce(p.full_name, ''), j.state,
       j.spec, j.column_labels, j.permission_version, j.time_zone, j.row_limit, j.snapshot_at, j.row_count, j.truncated,
       j.file_name, j.object_key, j.size_bytes, j.failure_code, j.revoke_reason, j.attempts, j.revision, j.created_at,
       j.started_at, j.finished_at, j.expires_at, j.revoked_at
  from data.export_jobs j
  left join people.person_profiles p on p.id = j.requested_by`

func scanJob(r pgx.Row) (jobRow, error) {
	var (
		j        jobRow
		spec     []byte
		rows     *int32
		rowLimit int32
	)
	if err := r.Scan(&j.ID, &j.Dataset, &j.DatasetName, &j.View, &j.Author, &j.AuthorName, &j.State, &spec, &j.Labels,
		&j.Version, &j.Zone, &rowLimit, &j.Snapshot, &rows, &j.Truncated, &j.FileName, &j.Key, &j.Size, &j.Failure,
		&j.Reason, &j.Attempts, &j.Revision, &j.Created, &j.Started, &j.Finished, &j.Expires, &j.Revoked); err != nil {
		return jobRow{}, err
	}
	if err := json.Unmarshal(spec, &j.Spec); err != nil {
		return jobRow{}, fmt.Errorf("data: job %s spec: %w", j.ID, err)
	}
	j.RowLimit = int64(rowLimit)
	if rows != nil {
		n := int64(*rows)
		j.Rows = &n
	}
	return j, nil
}

// state is the state of the job at now: a ready job past expiresAt is expired (the worker deletes its file later).
func (j jobRow) state(now time.Time) string {
	if j.State == stateReady && j.Expires != nil && !now.Before(*j.Expires) {
		return stateExpired
	}
	return j.State
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// dto is the DatasetExportJob of the row at now; the key of the file never leaves the server.
func (j jobRow) dto(now time.Time) dataapi.DatasetExportJob {
	out := dataapi.DatasetExportJob{
		Id: j.ID, DatasetId: j.Dataset, DatasetName: j.DatasetName, ViewId: j.View, State: dataapi.DatasetExportJobState(j.state(now)),
		Spec: j.Spec, ColumnLabels: slices.Clone(j.Labels), TimeZone: j.Zone, SnapshotAt: utc(j.Snapshot), RowLimit: j.RowLimit,
		RowCount: j.Rows, Truncated: j.Truncated, FileName: j.FileName, SizeBytes: j.Size, RequestedByMemberId: j.Author,
		RequestedByDisplayName: j.AuthorName, CreatedAt: j.Created.UTC(), StartedAt: utc(j.Started), FinishedAt: utc(j.Finished),
		ExpiresAt: utc(j.Expires), RevokedAt: utc(j.Revoked), Revision: j.Revision,
	}
	if j.Failure != nil {
		c := dataapi.DatasetExportJobFailureCode(*j.Failure)
		out.FailureCode = &c
	}
	if j.Reason != nil {
		r := dataapi.DatasetExportJobRevokeReason(*j.Reason)
		out.RevokeReason = &r
	}
	if out.Spec.Filters == nil {
		out.Spec.Filters = []dataapi.QueryFilter{}
	}
	if out.Spec.Sort == nil {
		out.Spec.Sort = []dataapi.QuerySort{}
	}
	return out
}

// jobSpec is the spec of a job from its request, the lists never null.
func jobSpec(b *dataapi.DatasetExportJobCreate) dataapi.DatasetExportCreate {
	s := dataapi.DatasetExportCreate{Select: b.Select, Filters: b.Filters, Search: b.Search, Sort: b.Sort}
	if s.Filters == nil {
		s.Filters = []dataapi.QueryFilter{}
	}
	if s.Sort == nil {
		s.Sort = []dataapi.QuerySort{}
	}
	return s
}

// specQuery is the DatasetQuery of the spec (the checks of queryDataset).
func specQuery(s dataapi.DatasetExportCreate, limit int) *dataapi.DatasetQuery {
	return &dataapi.DatasetQuery{Select: s.Select, Filters: s.Filters, Search: s.Search, Sort: s.Sort, Limit: limit}
}

// zone is the time zone of the files of the member: his home unit (fleet units carry the zone of their region), else
// the root unit of the organization, else Europe/Moscow — as exportDataset (W2.50).
func (s *Service) zone(ctx context.Context, tc tenantctx.TenantContext) (string, error) {
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return "", dependency(err)
	}
	var name string
	err = pool.QueryRow(ctx, `select coalesce(
		(select u.time_zone from people.person_profiles p join org.units u on u.id = p.home_unit_id where p.id = $1),
		(select u.time_zone from org.units u where u.parent_id is null and u.archived_at is null order by u.name, u.id limit 1),
		$2)`, tc.PersonID, defaultZone).Scan(&name)
	if err != nil {
		return "", dependency(fmt.Errorf("data: time zone: %w", err))
	}
	return knownZone(name), nil
}

// knownZone is name when it is a time zone of the IANA database, else Europe/Moscow.
func knownZone(name string) string {
	if _, err := time.LoadLocation(name); err != nil {
		return defaultZone
	}
	return name
}

// columnLabels are the labels of the columns of spec in the dataset of v (parse checked every key).
func columnLabels(v view, spec dataapi.DatasetExportCreate) []string {
	out := make([]string, 0, len(spec.Select))
	for _, k := range spec.Select {
		f, _ := v.field(k)
		out = append(out, f.Label)
	}
	return out
}

// requested is the diff of the audit row data.export.requested: the dataset, the columns, the number of filters, the
// search and the view — never their values.
func requested(id string, spec dataapi.DatasetExportCreate, viewID *uuid.UUID) map[string]any {
	diff := map[string]any{keyDataset: id, "select": spec.Select, "filters": len(spec.Filters)}
	if spec.Search != nil && strings.TrimSpace(*spec.Search) != "" {
		diff["search"] = true
	}
	if viewID != nil {
		diff["viewId"] = viewID.String()
	}
	return diff
}

// CreateJob queues the export of the dataset id for the member of tc (createDatasetExportJob).
func (s *Service) CreateJob(ctx context.Context, tc tenantctx.TenantContext, id string, b *dataapi.DatasetExportJobCreate) (dataapi.DatasetExportJob, error) {
	v, err := s.open(ctx, tc, id, true)
	if err != nil {
		return dataapi.DatasetExportJob{}, err
	}
	if !v.export {
		return dataapi.DatasetExportJob{}, problem.New(problem.CodeForbiddenAction, "")
	}
	if b == nil {
		return dataapi.DatasetExportJob{}, malformed("Нет тела выгрузки.")
	}
	spec := jobSpec(b)
	if _, err := parse(v, specQuery(spec, 1), memberOf(tc)); err != nil {
		return dataapi.DatasetExportJob{}, err
	}
	zone, err := s.zone(ctx, tc)
	if err != nil {
		return dataapi.DatasetExportJob{}, err
	}
	raw, err := json.Marshal(spec)
	if err != nil {
		return dataapi.DatasetExportJob{}, dependency(err)
	}
	now := s.now()
	var body dataapi.DatasetExportJob
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		if err := checkStart(ctx, tx, tc, id, b.ViewId); err != nil {
			return err
		}
		var jid uuid.UUID
		// schema_version and permission_version are one value by design of the engine of W2.08: the datasets of the
		// registry carry no version of their own schema — Dataset.permissionVersion (access.policy_state.policy_version)
		// is what the client and the recheck compare; the columns stay apart for a dataset schema version to come.
		if err := tx.QueryRow(ctx, `insert into data.export_jobs (dataset_id, dataset_name, view_id, requested_by, spec,
			column_labels, schema_version, permission_version, time_zone, row_limit, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9,
				greatest($10::timestamptz, (select max(created_at) + interval '1 microsecond' from data.export_jobs))) returning id`,
			id, v.spec.Name, b.ViewId, tc.PersonID, raw, columnLabels(v, spec), v.version, zone, JobRowLimit, now).Scan(&jid); err != nil {
			return err
		}
		row, err := scanJob(tx.QueryRow(ctx, jobSelect+` where j.id = $1`, jid))
		if err != nil {
			return err
		}
		body = row.dto(now)
		if err := kit.Audit(ctx, tx, audit.Event{Action: "data.export.requested", TargetType: targetJob, TargetID: jid,
			Diff: requested(id, spec, b.ViewId)}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusAccepted, kit.ETag(body.Revision), body)
	})
	return body, dependency(err)
}

// The moment of a job is the clock of the application; under a fixed clock (APP_FIXED_NOW of the stand) the jobs of
// one moment follow their order of creation a microsecond apart, so the journal (created_at desc) keeps it. Under the
// system clock it moves only a job of the same microsecond as the last one (or after a step back of the clock), as the
// defects of one inspection keep their order (fleet/inspections): no more than the precision the database keeps
// (Q-W4.50-4).

// checkStart checks in tx the view a job starts from (one the member does not see — 404) and the active jobs of the
// member (at most 3 queued or running — 429); the advisory lock serializes the starts of one member.
func checkStart(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id string, view *uuid.UUID) error {
	if view != nil {
		var ok bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from data.saved_views where id = $1 and dataset_id = $2
			and (visibility = 'shared' or owner_id = $3))`, *view, id, tc.PersonID).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return problem.New(problem.CodeNotFound, textViewNotFound)
		}
	}
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('data.export_jobs:' || $1::text, 0))`, tc.PersonID); err != nil {
		return err
	}
	var n int
	if err := tx.QueryRow(ctx, `select count(*) from data.export_jobs where requested_by = $1 and state in ('queued', 'running')`,
		tc.PersonID).Scan(&n); err != nil {
		return err
	}
	if n >= activeJobs {
		return problem.New(codeRateLimited, textJobBusy)
	}
	return nil
}

// jobsSQL lists the journal: $1 — the person (null — the owner: every job), $2 — the dataset (null — all), $3 — the
// states (null — all), $4 — now (the expiry), $5/$6 — the keyset after (created_at, id), $7 — the page size + 1.
const jobsSQL = jobSelect + `
 where ($1::uuid is null or j.requested_by = $1)
   and ($2::text is null or j.dataset_id = $2)
   and ($3::text[] is null or (case when j.state = 'ready' and j.expires_at <= $4 then 'expired' else j.state end) = any($3))
   and ($5::timestamptz is null or (j.created_at, j.id) < ($5, $6::uuid))
 order by j.created_at desc, j.id desc
 limit $7`

// jobStates are the states of the filter of the journal; an unknown one is 400.
func jobStates(in []dataapi.ListDatasetExportJobsParamsState) ([]string, error) {
	known := []string{stateQueued, stateRunning, stateReady, stateFailed, stateExpired, stateRevoked}
	out := make([]string, 0, len(in))
	for _, st := range in {
		if !slices.Contains(known, string(st)) {
			return nil, malformed("state: " + string(st))
		}
		out = append(out, string(st))
	}
	return out, nil
}

// jobCursor is the keyset position (created_at, id) of a cursor of the journal; anything else is 400.
func jobCursor(c string) (time.Time, uuid.UUID, error) {
	keys, err := kit.DecodeCursor(c, 2)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	at, err1 := time.Parse(time.RFC3339Nano, keys[0])
	jid, err2 := uuid.Parse(keys[1])
	if err1 != nil || err2 != nil {
		return time.Time{}, uuid.Nil, malformed(textBadCursor)
	}
	return at, jid, nil
}

// Jobs is the journal of export jobs (listDatasetExportJobs): the jobs of the member, the owner — of all members.
func (s *Service) Jobs(ctx context.Context, tc tenantctx.TenantContext, p dataapi.ListDatasetExportJobsParams) (dataapi.DatasetExportJobPage, error) {
	limit, err := kit.PageLimit(p.Limit)
	if err != nil {
		return dataapi.DatasetExportJobPage{}, err
	}
	args := []any{nil, p.DatasetId, nil, s.now(), nil, nil, limit + 1}
	if !tc.Owner {
		args[0] = tc.PersonID
	}
	if p.State != nil {
		if args[2], err = jobStates(*p.State); err != nil {
			return dataapi.DatasetExportJobPage{}, err
		}
	}
	if p.Cursor != nil {
		if args[4], args[5], err = jobCursor(*p.Cursor); err != nil {
			return dataapi.DatasetExportJobPage{}, err
		}
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return dataapi.DatasetExportJobPage{}, dependency(err)
	}
	rows, err := pool.Query(ctx, jobsSQL, args...)
	if err != nil {
		return dataapi.DatasetExportJobPage{}, dependency(fmt.Errorf("data: jobs: %w", err))
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (jobRow, error) { return scanJob(r) })
	if err != nil {
		return dataapi.DatasetExportJobPage{}, dependency(fmt.Errorf("data: jobs: %w", err))
	}
	out := dataapi.DatasetExportJobPage{Items: make([]dataapi.DatasetExportJob, 0, min(len(list), limit))}
	now := s.now()
	for _, j := range list[:min(len(list), limit)] {
		out.Items = append(out.Items, j.dto(now))
	}
	if len(list) > limit {
		last := list[limit-1]
		c := kit.EncodeCursor(last.Created.UTC().Format(time.RFC3339Nano), last.ID.String())
		out.NextCursor = &c
	}
	return out, nil
}

// seenJob is the condition of a job the member $2 may read: his own; the owner (true in $3) — any.
const seenJob = ` where j.id = $1 and ($3 or j.requested_by = $2)`

// Job reads a job of the journal (getDatasetExportJob): the own one, the owner — any; another — 404.
func (s *Service) Job(ctx context.Context, tc tenantctx.TenantContext, jid uuid.UUID) (dataapi.DatasetExportJob, error) {
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return dataapi.DatasetExportJob{}, dependency(err)
	}
	j, err := scanJob(pool.QueryRow(ctx, jobSelect+seenJob, jid, tc.PersonID, tc.Owner))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return dataapi.DatasetExportJob{}, problem.New(problem.CodeNotFound, textJobNotFound)
	case err != nil:
		return dataapi.DatasetExportJob{}, dependency(err)
	}
	return j.dto(s.now()), nil
}

// lockJob locks a job the member of tc sees (author only — the download) or 404.
func lockJob(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, jid uuid.UUID, authorOnly bool) (jobRow, error) {
	j, err := scanJob(tx.QueryRow(ctx, jobSelect+seenJob+` for update of j`, jid, tc.PersonID, tc.Owner && !authorOnly))
	if errors.Is(err, pgx.ErrNoRows) {
		return jobRow{}, problem.New(problem.CodeNotFound, textJobNotFound)
	}
	return j, err
}

// narrowed tells why the rights of the author of j over its dataset narrowed since the job: the module is disabled
// (module_disabled); the dataset is closed to him, he lost data.export, the permission version of the tenant changed or
// a column of the job is hidden from him (permissions_changed); "" — the rights hold.
func (s *Service) narrowed(ctx context.Context, tc tenantctx.TenantContext, j jobRow) (string, error) {
	v, err := s.open(ctx, tc, j.Dataset, true)
	if _, ok := errors.AsType[*closedError](err); ok {
		return reasonModuleOff, nil
	}
	switch {
	case problem.Is(err, problem.CodeNotFound), problem.Is(err, problem.CodeForbiddenAction):
		return reasonNarrowed, nil
	case err != nil:
		return "", err
	case !v.export || v.version != j.Version:
		return reasonNarrowed, nil
	}
	for _, k := range j.Spec.Select {
		if _, ok := v.field(k); !ok {
			return reasonNarrowed, nil
		}
	}
	return "", nil
}

// fileRemover deletes the file of a job from the object storage (ExportFiles of the API, ExportStore of the worker).
type fileRemover interface {
	Delete(ctx context.Context, key string) error
}

// revokeJob revokes the locked job j in tx for reason (by — who revoked it; nil — the server) and deletes its file
// from files before the commit: a file that cannot be deleted keeps the job as it was (the transaction rolls back).
func revokeJob(ctx context.Context, tx pgx.Tx, files fileRemover, j jobRow, reason string, by *uuid.UUID, now time.Time) (jobRow, error) {
	if _, err := tx.Exec(ctx, `update data.export_jobs set state = 'revoked', revoke_reason = $2, revoked_by = $3, revoked_at = $4,
		object_key = null, revision = revision + 1 where id = $1`, j.ID, reason, by, now); err != nil {
		return jobRow{}, err
	}
	if j.Key != nil {
		if files == nil {
			return jobRow{}, problem.New(problem.CodeDependencyUnavailable, "")
		}
		if err := files.Delete(ctx, *j.Key); err != nil {
			return jobRow{}, fmt.Errorf("data: delete export file: %w", err)
		}
	}
	diff := map[string]any{keyDataset: j.Dataset, "reason": reason}
	e := audit.Event{Action: "data.export.revoked", TargetType: targetJob, TargetID: j.ID, Diff: diff}
	if by == nil {
		e.ActorKind = audit.ActorService
	}
	if err := kit.Audit(ctx, tx, e); err != nil {
		return jobRow{}, err
	}
	return scanJob(tx.QueryRow(ctx, jobSelect+` where j.id = $1`, j.ID))
}

// Download gives the author a short link to the file of his ready job (getDatasetExportDownload) after rechecking his
// rights; narrowed rights revoke the job (the revocation is committed) and answer 409.
func (s *Service) Download(ctx context.Context, tc tenantctx.TenantContext, jid uuid.UUID) (dataapi.DatasetExportDownload, error) {
	now := s.now()
	var (
		out     dataapi.DatasetExportDownload
		revoked bool
	)
	err := kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		j, err := lockJob(ctx, tx, tc, jid, true)
		if err != nil {
			return err
		}
		switch j.state(now) {
		case stateQueued, stateRunning:
			return kit.Conflict(textJobNotReady)
		case stateReady:
		default:
			return kit.Conflict(textJobGone)
		}
		reason, err := s.narrowed(ctx, tc, j)
		if err != nil {
			return err
		}
		if reason != "" {
			revoked = true
			_, err := revokeJob(ctx, tx, s.Files, j, reason, nil, now)
			return err
		}
		if s.Files == nil || j.Key == nil || j.FileName == nil || j.Size == nil {
			return problem.New(problem.CodeDependencyUnavailable, "")
		}
		link, err := s.Files.PresignGet(*j.Key, *j.FileName, LinkTTL)
		if err != nil {
			return err
		}
		out = dataapi.DatasetExportDownload{ExportJobId: j.ID, DownloadUrl: link, ExpiresAt: now.Add(LinkTTL), FileName: *j.FileName,
			ContentType: CSVContentType, SizeBytes: *j.Size}
		return kit.Audit(ctx, tx, audit.Event{Action: "data.export.downloaded", TargetType: targetJob, TargetID: j.ID,
			Diff: map[string]any{keyDataset: j.Dataset, "rowCount": j.Rows}})
	})
	if err == nil && revoked {
		return dataapi.DatasetExportDownload{}, kit.Conflict(textJobNarrowed)
	}
	return out, dependency(err)
}

// Revoke stops a queued or running job or revokes a ready one (revokeDatasetExportJob): the author (author) or the
// owner (owner) by If-Match; the file is deleted, the journal row stays.
func (s *Service) Revoke(ctx context.Context, tc tenantctx.TenantContext, jid uuid.UUID, ifMatch string) (dataapi.DatasetExportJob, error) {
	now := s.now()
	var body dataapi.DatasetExportJob
	err := kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		j, err := lockJob(ctx, tx, tc, jid, false)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, j.Revision); err != nil {
			return err
		}
		if st := j.state(now); st == stateFailed || st == stateExpired || st == stateRevoked {
			return kit.Conflict(textJobFinished)
		}
		reason := reasonOwner
		if j.Author == tc.PersonID {
			reason = reasonAuthor
		}
		by := tc.PersonID
		if j, err = revokeJob(ctx, tx, s.Files, j, reason, &by, now); err != nil {
			return err
		}
		body = j.dto(now)
		return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(body.Revision), body)
	})
	return body, dependency(err)
}
