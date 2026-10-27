package docs

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// Statuses and operations of a job (docs.jobs).
const (
	jobQueued  = "queued"
	jobRunning = "running"
	jobDone    = "done"
	jobFailed  = "failed"
)

// jobRow is a row of docs.jobs.
type jobRow struct {
	id       uuid.UUID
	op       string
	docs     []uuid.UUID
	name     string
	status   string
	progress int
	params   []byte
	errText  string
	result   uuid.UUID
	by       uuid.UUID
	created  time.Time
	finished *time.Time
}

const jobCols = `id, op, doc_ids, name, status, progress, params, coalesce(error, ''), coalesce(result_document_id, ` + nilUUID + `),
	coalesce(created_by, ` + nilUUID + `), created_at, finished_at`

func scanJob(r pgx.Row) (jobRow, error) {
	var j jobRow
	err := r.Scan(&j.id, &j.op, &j.docs, &j.name, &j.status, &j.progress, &j.params, &j.errText, &j.result, &j.by, &j.created, &j.finished)
	return j, err
}

// jobDTO is a job in the contract.
func jobDTO(j jobRow) dapi.DocJob {
	p := int64(j.progress)
	out := dapi.DocJob{Id: j.id, Op: dapi.DocJobOp(j.op), DocIds: j.docs, Name: j.name, Status: dapi.DocJobStatus(j.status), Progress: &p,
		CreatedAt: instant(j.created), Params: decodeObject[map[string]any](j.params)}
	if j.errText != "" {
		e := j.errText
		out.Error = &e
	}
	if j.result != uuid.Nil {
		id := j.result
		out.ResultDocumentId = &id
	}
	if j.finished != nil {
		f := instant(*j.finished)
		out.FinishedAt = &f
	}
	return out
}

// jobsOf are the last n jobs that touch the document, newest first.
func (r *req) jobsOf(ctx context.Context, doc uuid.UUID, n int) ([]dapi.DocJob, error) {
	rows, err := r.tx.Query(ctx, `select `+jobCols+` from docs.jobs where $1 = any(doc_ids) order by created_at desc, id limit $2`, doc, n)
	if err != nil {
		return nil, fmt.Errorf("docs: jobs: %w", err)
	}
	jobs, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (jobRow, error) { return scanJob(x) })
	if err != nil {
		return nil, fmt.Errorf("docs: jobs: %w", err)
	}
	out := make([]dapi.DocJob, 0, len(jobs))
	for _, j := range jobs {
		out = append(out, jobDTO(j))
	}
	return out, nil
}
