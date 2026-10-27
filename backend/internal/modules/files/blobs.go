package files

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// W7.11, return 1: what other modules ask of the files without touching files.objects, files.usage and the ledger
// themselves (cmd/api adapters call these inside the transaction of the operation).

const (
	aggregateFile = "files.file" // the aggregate of the events of a file
	ledgerRelease = "release"
	ledgerCommit  = "commit"
	// removedCode is rejected_code of a file its owner removed (the cleaning of a chat, a view-once file after its term).
	removedCode = "owner_removed"
)

// Release removes the checked or waiting files ids in tx: they become rejected (rejected_code owner_removed), their bytes
// leave the committed bytes of the organization (usage, ledger release). It returns the keys of their objects to delete
// from the object storage after the commit. A file that is not live (rejected already, unknown) is skipped.
func Release(ctx context.Context, tx pgx.Tx, fileIDs []uuid.UUID) ([]string, error) {
	rows, err := tx.Query(ctx, `update files.objects set state = 'rejected', rejected_code = $2
		 where id = any($1) and state in ('scanning', 'ready') returning id, object_key, coalesce(bytes, 0)`, fileIDs, removedCode)
	if err != nil {
		return nil, fmt.Errorf("files: release: %w", err)
	}
	type gone struct {
		id    uuid.UUID
		key   string
		bytes int64
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (gone, error) {
		var g gone
		err := r.Scan(&g.id, &g.key, &g.bytes)
		return g, err
	})
	if err != nil {
		return nil, fmt.Errorf("files: release: %w", err)
	}
	keys := make([]string, 0, len(list))
	for _, g := range list {
		if _, err := tx.Exec(ctx, `update files.usage set committed_bytes = greatest(0, committed_bytes - $1), updated_at = now()
			where singleton`, g.bytes); err != nil {
			return nil, fmt.Errorf("files: release bytes: %w", err)
		}
		if _, err := tx.Exec(ctx, ledgerSQL, g.id, ledgerRelease, g.bytes, nil); err != nil {
			return nil, fmt.Errorf("files: release ledger: %w", err)
		}
		keys = append(keys, g.key)
	}
	return keys, nil
}

// Reparent gives a ready file to another parent (owner_type «module.entity», owner_id): «save to the record» of a chat.
// The bytes stay committed; the file is read as its new parent from now on.
func Reparent(ctx context.Context, tx pgx.Tx, fileID uuid.UUID, to Ref) error {
	tag, err := tx.Exec(ctx, `update files.objects set owner_type = $2, owner_id = $3 where id = $1 and state = 'ready'`,
		fileID, to.Kind(), to.ID)
	if err != nil {
		return fmt.Errorf("files: reparent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return problem.New(codeNotFound, "")
	}
	return nil
}

// ReadyKey is the object key of a ready file (a short link to a view-once file of a chat).
func ReadyKey(ctx context.Context, q querier, fileID uuid.UUID) (string, error) {
	var key string
	if err := q.QueryRow(ctx, `select object_key from files.objects where id = $1 and state = 'ready'`, fileID).Scan(&key); err != nil {
		return "", err
	}
	return key, nil
}

// NewFile is a file the server makes itself (an export): the bytes, the parent and the person it is made for.
type NewFile struct {
	Owner       Ref
	Purpose     Purpose
	Name        string
	ContentType string
	Data        []byte
	By          uuid.UUID
}

// Put writes a file the server made to the object storage and records it ready in tx: the bytes count for the quota of
// the organization (quota_exceeded when it is full, as for an upload), the key is the permanent one of FileKey. The
// object is written before the commit; when tx fails an orphan object stays (an export is made again).
func Put(ctx context.Context, tx pgx.Tx, up storage.Uploader, tenant uuid.UUID, now time.Time, f NewFile) (uuid.UUID, error) {
	size := int64(len(f.Data))
	switch {
	case up == nil:
		return uuid.Nil, problem.New(codeDependency, "")
	case size < 1 || size > MaxBytes:
		return uuid.Nil, invalid("Файл пустой или больше допустимого размера.")
	}
	if _, err := tx.Exec(ctx, ensureUsageSQL, DefaultQuotaBytes); err != nil {
		return uuid.Nil, fmt.Errorf("files: usage: %w", err)
	}
	tag, err := tx.Exec(ctx, `update files.usage set committed_bytes = committed_bytes + $1, updated_at = now()
		 where singleton and committed_bytes + reserved_bytes + pg_database_size(current_database()) + $1
		                     <= limit_bytes + activity_reserve_bytes`, size)
	if err != nil {
		return uuid.Nil, fmt.Errorf("files: commit bytes: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return uuid.Nil, problem.New(codeQuota, quotaText)
	}
	id := uuid.New()
	key := FileKey(tenant, id)
	if err := up.Upload(ctx, key, f.ContentType, f.Data); err != nil {
		return uuid.Nil, problem.Wrap(codeDependency, err)
	}
	if _, err := tx.Exec(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime,
		        bytes, sha256, uploaded_by, created_at, ready_at)
		 values ($1, $2, 'ready', $3, $4, $5, $6, $7, $8, sha256($9), $10, $11, $11)`,
		id, key, string(f.Purpose), f.Owner.Kind(), f.Owner.ID, EncodeMIME(f.ContentType, f.Name), f.ContentType, size, f.Data, f.By, now); err != nil {
		return uuid.Nil, fmt.Errorf("files: put: %w", err)
	}
	if _, err := tx.Exec(ctx, ledgerSQL, id, ledgerCommit, size, nil); err != nil {
		return uuid.Nil, fmt.Errorf("files: put ledger: %w", err)
	}
	_, err = events.Publish(ctx, tx, events.Event{Type: EventReady, Aggregate: aggregateFile, AggregateID: id,
		Payload: filePayload(id, string(f.Purpose), f.Owner.Kind(), f.Owner.ID)})
	return id, err
}
