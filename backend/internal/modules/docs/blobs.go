package docs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

const (
	// defaultQuotaBytes is the quota of an organization without a row of files.usage (as the files module).
	defaultQuotaBytes int64 = 100 << 30
	// maxFileBytes bounds a file the module reads into memory for a job or writes from the engine (FILE-02: 50 MB).
	maxFileBytes    int64 = 50 << 20
	quotaText             = "Место организации заполнено. Новая версия не сохранена."
	purposeDocument       = "document"
	ownerDocument         = "docs.document"
	ownerFolder           = "docs.folder"
)

// fileKey is the object key of a checked file (FILE-01: formed by the server).
func fileKey(tenant, file uuid.UUID) string { return "files/" + tenant.String() + "/" + file.String() }

// storeFile writes data as a ready file of the document into the object storage and files.objects, counts it into
// the quota and returns its id. The bytes are written first and removed again when the database rejects the file; the
// caller commits the transaction, so a rollback leaves an orphan the cleaner of the files removes (quota is not
// counted for it: the usage row is part of the transaction).
func (r *req) storeFile(ctx context.Context, doc uuid.UUID, name, contentType string, data []byte) (uuid.UUID, error) {
	if r.s.Blobs == nil {
		return uuid.Nil, problem.Wrap(problem.CodeDependencyUnavailable, errors.New("docs: object storage is not configured"))
	}
	size := int64(len(data))
	if size == 0 || size > maxFileBytes {
		return uuid.Nil, problem.New(codeTooLarge, "Файл пустой или больше 50 МБ")
	}
	if _, err := r.tx.Exec(ctx, `insert into files.usage (limit_bytes) values ($1) on conflict (singleton) do nothing`, defaultQuotaBytes); err != nil {
		return uuid.Nil, fmt.Errorf("docs: usage: %w", err)
	}
	tag, err := r.tx.Exec(ctx, `update files.usage set committed_bytes = committed_bytes + $1, updated_at = now()
		where singleton and committed_bytes + reserved_bytes + pg_database_size(current_database()) + $1 <= limit_bytes + activity_reserve_bytes`, size)
	if err != nil {
		return uuid.Nil, fmt.Errorf("docs: quota: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return uuid.Nil, problem.New(codeQuota, quotaText)
	}
	id := r.s.newID()
	key := fileKey(r.tc.TenantID, id)
	sum := sha256.Sum256(data)
	if err := r.s.Blobs.Put(ctx, key, contentType, bytes.NewReader(data), size); err != nil {
		return uuid.Nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if _, err := r.tx.Exec(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime,
		bytes, sha256, uploaded_by, created_at, ready_at) values ($1, $2, 'ready', $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
		id, key, purposeDocument, ownerDocument, doc, encodeMIME(contentType, name), contentType, size, sum[:], r.actorID(), r.now); err != nil {
		_ = r.s.Blobs.Delete(context.WithoutCancel(ctx), key)
		return uuid.Nil, fmt.Errorf("docs: file: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `insert into files.quota_ledger (file_id, kind, bytes) values ($1, 'commit', $2)`, id, size); err != nil {
		return uuid.Nil, fmt.Errorf("docs: ledger: %w", err)
	}
	return id, nil
}

// actorID is the person of the request (the service person of a worker job is the owner of the document).
func (r *req) actorID() uuid.UUID {
	if r.me != nil {
		return r.me.id
	}
	return r.tc.PersonID
}

// readFile reads a ready file of the tenant into memory (at most maxFileBytes).
func (r *req) readFile(ctx context.Context, id uuid.UUID) ([]byte, fileRow, error) {
	f, ok, err := r.fileOf(ctx, id)
	if err != nil {
		return nil, f, err
	}
	if !ok || f.state != stateReady {
		return nil, f, failed("Файл версии не найден или ещё проверяется")
	}
	if r.s.Blobs == nil {
		return nil, f, problem.Wrap(problem.CodeDependencyUnavailable, errors.New("docs: object storage is not configured"))
	}
	rc, _, err := r.s.Blobs.Open(ctx, f.key)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, f, failed("Файл версии потерян в хранилище")
	}
	if err != nil {
		return nil, f, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxFileBytes+1))
	if err != nil {
		return nil, f, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if int64(len(data)) > maxFileBytes {
		return nil, f, problem.New(codeTooLarge, "Файл больше 50 МБ")
	}
	return data, f, nil
}

// claimFiles checks the files of a new document (ready, uploaded by the member for documents, not used by another
// document) and moves them under the document.
func (r *req) claimFiles(ctx context.Context, doc uuid.UUID, ids []uuid.UUID) ([]fileRow, error) {
	out := make([]fileRow, 0, len(ids))
	seen := map[uuid.UUID]bool{}
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		f, err := r.claimable(ctx, id)
		if err != nil {
			return nil, err
		}
		if _, err := r.tx.Exec(ctx, `update files.objects set owner_type = $2, owner_id = $3 where id = $1`, id, ownerDocument, doc); err != nil {
			return nil, fmt.Errorf("docs: claim file: %w", err)
		}
		out = append(out, f)
	}
	return out, nil
}

// claimable reads a file a member offers to a new document: his own, for documents, not yet under a document of
// another owner, and ready.
func (r *req) claimable(ctx context.Context, id uuid.UUID) (fileRow, error) {
	var purpose, owner string
	var by uuid.UUID
	err := r.tx.QueryRow(ctx, `select purpose, owner_type, uploaded_by from files.objects where id = $1`, id).Scan(&purpose, &owner, &by)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (purpose != purposeDocument || by != r.me.id || (owner != ownerDocument && owner != ownerFolder))) {
		return fileRow{}, invalid("fileIds", "Файл не найден")
	}
	if err != nil {
		return fileRow{}, fmt.Errorf("docs: file owner: %w", err)
	}
	f, _, err := r.fileOf(ctx, id)
	if err != nil {
		return fileRow{}, err
	}
	if f.state != stateReady {
		return fileRow{}, invalid("fileIds", "Файл ещё проверяется")
	}
	return f, nil
}
