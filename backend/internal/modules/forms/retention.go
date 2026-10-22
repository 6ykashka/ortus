package forms

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// retainSQL selects the responses older than the retention of their forms at $1: «Хранить ответы» (90 days, a year,
// 3 years), or the former retention while a shortening is in its grace (Q-W4.00-forms-22: 7 days).
const retainSQL = `
select r.id, r.form_id, r.number, r.answers
  from forms.responses r
  join forms.forms f on f.id = r.form_id
 where r.submitted_at < $1::timestamptz - make_interval(days => greatest(f.retain_days,
         case when (f.settings->'shortened'->>'at')::timestamptz + interval '7 days' > $1::timestamptz
              then coalesce((f.settings->'shortened'->>'days')::int, 0) else 0 end))`

// heldSQL are the files of $2 (text ids) the answers of the responses of the form $1 that stay hold — read in the
// database, not in memory (return 2).
const heldSQL = `select distinct h.id from forms.responses r,
       lateral (select v #>> '{}' as id from jsonb_path_query(r.answers, '$[*] ? (@.value.type == "files").value.value[*]') v) h
 where r.form_id = $1 and h.id = any($2::text[])`

// lockFilesSQL takes the files $1 before they are checked: a submission taking one of them (filesOf, for share) has
// committed its response before — the file is held — or waits and then refuses the purged file (return 2).
const lockFilesSQL = `select id from files.objects where id = any($1) order by id for update`

// auditPurged is the audit line of «Хранить ответы» per form: how many responses went (no content).
const auditPurged = "forms.responses.purged"

// auditNumbers are the numbers of the deleted responses an audit line of the retention keeps (return 3): the first of
// them — a mass deletion of a form leaves a line of a bounded size, its count tells how many went.
const auditNumbers = 10

// errNoPurge stops a retention without its port: a response is never deleted leaving its rows of the knowledge base
// and the files of its answers behind (D-26).
var errNoPurge = errors.New("forms: retention without the purge of the knowledge base and of the files (Service.Purge)")

// expired are the responses of one form «Хранить ответы» deletes: their numbers and the files of their answers.
type expired struct {
	numbers []string
	files   []uuid.UUID
}

// Retain deletes the responses of the tenant older than the retention of their forms (the worker, every
// WORKER_FORMS_RETENTION_INTERVAL) and returns how many: in one transaction their journal, the responses, the rows and
// the records of the knowledge base written for them and the files of their answers no other response holds (Purge);
// the bytes of the files leave the object storage after the commit — a failure there is returned with the count.
func (s *Service) Retain(ctx context.Context, tenantID uuid.UUID) (int, error) {
	if s.Purge == nil {
		return 0, errNoPurge
	}
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return 0, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	var (
		n     int
		after []func(context.Context) error
	)
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		n, after = 0, nil
		ids, byForm, err := expiredOf(ctx, tx, s.now())
		if err != nil || len(ids) == 0 {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from forms.response_actions where response_id = any($1)`, ids); err != nil {
			return fmt.Errorf("forms: retention of the journal: %w", err)
		}
		tag, err := tx.Exec(ctx, `delete from forms.responses where id = any($1)`, ids)
		if err != nil {
			return fmt.Errorf("forms: retention: %w", err)
		}
		n = int(tag.RowsAffected())
		after, err = s.purge(ctx, tx, tenantID, byForm)
		return err
	})
	if err != nil {
		return 0, err
	}
	var errs []error
	for _, fn := range after {
		if err := fn(ctx); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		return n, fmt.Errorf("forms: retention: the bytes of files of answers: %w", errors.Join(errs...))
	}
	return n, nil
}

// expiredOf are the ids of the responses past their retention at now and, by form, their numbers and files.
func expiredOf(ctx context.Context, tx pgx.Tx, now time.Time) ([]uuid.UUID, map[uuid.UUID]*expired, error) {
	rows, err := tx.Query(ctx, retainSQL, now)
	if err != nil {
		return nil, nil, fmt.Errorf("forms: retention: %w", err)
	}
	defer rows.Close()
	var ids []uuid.UUID
	byForm := map[uuid.UUID]*expired{}
	for rows.Next() {
		var (
			id, form uuid.UUID
			number   int
			raw      []byte
		)
		if err := rows.Scan(&id, &form, &number, &raw); err != nil {
			return nil, nil, fmt.Errorf("forms: retention: %w", err)
		}
		e := byForm[form]
		if e == nil {
			e = &expired{}
			byForm[form] = e
		}
		ids = append(ids, id)
		e.numbers = append(e.numbers, numberOf(number))
		for _, f := range fileIDs(raw) {
			if !slices.Contains(e.files, f) {
				e.files = append(e.files, f)
			}
		}
	}
	return ids, byForm, rows.Err()
}

// purge removes, form by form, the rows and the records of the knowledge base of the deleted responses and the files of
// their answers the responses left do not hold; it returns what removes the bytes after the commit.
func (s *Service) purge(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, byForm map[uuid.UUID]*expired) ([]func(context.Context) error, error) {
	forms := make([]uuid.UUID, 0, len(byForm))
	for f := range byForm {
		forms = append(forms, f)
	}
	slices.SortFunc(forms, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	var after []func(context.Context) error
	for _, form := range forms {
		e := byForm[form]
		if _, err := s.Purge.FormRecords(ctx, tx, form, e.numbers); err != nil {
			return nil, fmt.Errorf("forms: retention of the knowledge base: %w", err)
		}
		free, err := unheld(ctx, tx, form, e.files)
		if err != nil {
			return nil, err
		}
		if len(free) > 0 {
			fn, err := s.Purge.FormFiles(ctx, tx, tenant, form, free)
			if err != nil {
				return nil, fmt.Errorf("forms: retention of the files: %w", err)
			}
			after = append(after, fn)
		}
		if err := auditRetention(ctx, tx, form, e, len(free)); err != nil {
			return nil, err
		}
	}
	return after, nil
}

// auditRetention writes the audit line of the responses of form the retention deleted, by the service: their count,
// the first auditNumbers of their numbers, how many files of their answers went.
func auditRetention(ctx context.Context, tx pgx.Tx, form uuid.UUID, e *expired, files int) error {
	rid := requestid.FromContext(ctx)
	if rid == "" {
		rid = "forms-retention-" + uuid.NewString()
	}
	diff := map[string]any{keyFormID: form, "count": len(e.numbers), "numbers": e.numbers[:min(len(e.numbers), auditNumbers)], "files": files}
	err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorService, Action: auditPurged, TargetType: aggForm, TargetID: form,
		Result: audit.OK, RequestID: rid, Diff: diff})
	if err != nil {
		return fmt.Errorf("forms: audit of the retention: %w", err)
	}
	return nil
}

// unheld are the files of ids no response of form left holds; they are locked first (lockFilesSQL).
func unheld(ctx context.Context, tx pgx.Tx, form uuid.UUID, ids []uuid.UUID) ([]uuid.UUID, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if _, err := tx.Exec(ctx, lockFilesSQL, ids); err != nil {
		return nil, fmt.Errorf("forms: retention of the files: %w", err)
	}
	texts := make([]string, 0, len(ids))
	for _, id := range ids {
		texts = append(texts, id.String())
	}
	rows, err := tx.Query(ctx, heldSQL, form, texts)
	if err != nil {
		return nil, fmt.Errorf("forms: retention of the files: %w", err)
	}
	held, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("forms: retention of the files: %w", err)
	}
	return slices.DeleteFunc(slices.Clone(ids), func(id uuid.UUID) bool { return slices.Contains(held, id.String()) }), nil
}

// fileIDs are the ids of the files of the answers raw (forms.responses.answers).
func fileIDs(raw []byte) []uuid.UUID {
	var es []entry
	if json.Unmarshal(raw, &es) != nil {
		return nil
	}
	return entryFiles(es)
}

// entryFiles are the ids of the files of the answers es.
func entryFiles(es []entry) []uuid.UUID {
	var out []uuid.UUID
	for _, e := range es {
		if e.Value.Type != vFiles {
			continue
		}
		for _, s := range e.Value.list() {
			if id, err := uuid.Parse(s); err == nil {
				out = append(out, id)
			}
		}
	}
	return out
}
