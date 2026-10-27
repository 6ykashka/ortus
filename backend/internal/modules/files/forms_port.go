package files

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// The port of the module «Формы» (W4.21, return 1): «Хранить ответы» deletes the files of the answers with the deleted
// responses (Q-W4.00-forms-22, D-26). files.quota_ledger is append-only and refers to the object (grants.sql), so the
// row of a file is not deleted: it becomes rejected with CodeRetention (a rejected file is never downloaded, its parent
// form shows it to nobody: no response refers to it), its committed bytes are released with a «release» in the ledger,
// and its bytes leave the object storage once the transaction of the caller is committed. cmd/worker adapts it to
// forms.Purge.

// CodeRetention is the rejected_code of a file of an answer deleted with its response («Хранить ответы» of the forms).
const CodeRetention = "retention_deleted"

// formOwner is the owner_type of the files of the answers (the parent forms/form).
const formOwner = "forms.form"

// PurgeFormFiles releases in tx the ready files ids of the answers of form (owner forms.form) — any other file, or one
// of another form, is left alone — and returns what removes their bytes from storage after the commit; without
// storage that is an error naming how many files keep their bytes.
func (s *Service) PurgeFormFiles(ctx context.Context, tx pgx.Tx, _, form uuid.UUID, ids []uuid.UUID) (func(context.Context) error, error) {
	none := func(context.Context) error { return nil }
	if len(ids) == 0 {
		return none, nil
	}
	rows, err := tx.Query(ctx, `update files.objects set state = 'rejected', rejected_code = $3
		 where id = any($1) and owner_type = $4 and owner_id = $2 and state = 'ready'
		returning id, object_key, coalesce(bytes, 0)`, ids, form, CodeRetention, formOwner)
	if err != nil {
		return nil, fmt.Errorf("files: purge of the files of a form: %w", err)
	}
	gone, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (purged, error) {
		var p purged
		return p, r.Scan(&p.id, &p.key, &p.size)
	})
	if err != nil {
		return nil, fmt.Errorf("files: purge of the files of a form: %w", err)
	}
	if err := release(ctx, tx, form, gone); err != nil {
		return nil, err
	}
	if len(gone) == 0 {
		return none, nil
	}
	keys := make([]string, 0, len(gone))
	for _, p := range gone {
		keys = append(keys, p.key)
	}
	return func(ctx context.Context) error {
		if s.Store == nil {
			return fmt.Errorf("files: object storage is not configured (S3_ENDPOINT): the bytes of %d purged files stay", len(keys))
		}
		var errs []error
		for _, k := range keys {
			if err := s.Store.Delete(ctx, k); err != nil {
				errs = append(errs, fmt.Errorf("files: delete %s: %w", k, err))
			}
		}
		return errors.Join(errs...)
	}, nil
}

// purged is a file of an answer «Хранить ответы» removed: its storage key and its committed bytes.
type purged struct {
	id   uuid.UUID
	key  string
	size int64
}

// release publishes the rejection of every purged file of form — its subscribers learn it is gone, as from a failed
// check (return 2, record) — and releases their committed bytes with a «release» in the ledger.
func release(ctx context.Context, tx pgx.Tx, form uuid.UUID, gone []purged) error {
	var total int64
	for _, p := range gone {
		payload := filePayload(p.id, string(PurposeFormAttachment), formOwner, form)
		payload["rejectedCode"] = CodeRetention
		if _, err := events.Publish(ctx, tx, events.Event{Type: EventRejected, Aggregate: aggregateFile, AggregateID: p.id, Payload: payload}); err != nil {
			return fmt.Errorf("files: event of a purged file: %w", err)
		}
		if p.size <= 0 {
			continue
		}
		total += p.size
		if _, err := tx.Exec(ctx, ledgerSQL, p.id, "release", p.size, nil); err != nil {
			return fmt.Errorf("files: release of a purged file: %w", err)
		}
	}
	if total == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, `update files.usage set committed_bytes = greatest(committed_bytes - $1, 0), updated_at = now()
		 where singleton`, total); err != nil {
		return fmt.Errorf("files: release of the purged files: %w", err)
	}
	return nil
}
