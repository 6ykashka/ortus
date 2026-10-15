package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// Events of the module (outbox, events.Publish).
const (
	EventUploaded = "files.file.uploaded.v1"           // completeUpload: the file waits for its check
	EventReady    = "files.file.ready.v1"              // the check passed
	EventRejected = "files.file.rejected.v1"           // the check failed
	EventDeadline = "files.upload.deadline_reached.v1" // the session expires (available_at = session_expires_at)
)

// Worker handles the events of the module in cmd/worker (role ortus_worker): the check of uploaded files and the
// expiry of sessions. Every handler is idempotent: a repeated delivery finds the work done and does nothing.
type Worker struct {
	Pools   Pools
	Store   storage.Store
	Scanner Scanner
	Now     func() time.Time // nil: time.Now
	Log     *slog.Logger     // nil: slog.Default
}

// Register adds the handlers of the module to r.
func (w *Worker) Register(r *events.Registry) {
	r.Handle(EventUploaded, w.Scan)
	r.Handle(EventDeadline, w.Expire)
}

func (w *Worker) now() time.Time {
	if w.Now != nil {
		return w.Now().UTC()
	}
	return time.Now().UTC()
}

func (w *Worker) log() *slog.Logger {
	if w.Log != nil {
		return w.Log
	}
	return slog.Default()
}

// errDone ends a transaction whose work another delivery already did.
var errDone = errors.New("files: already done")

// scanned is a file waiting for its check.
type scanned struct {
	state, key, declared, purpose, ownerType, sha string
	ownerID                                       uuid.UUID
	size                                          int64
}

// Scan checks an uploaded file (EventUploaded, FILE-02): a clean file whose content is still the one completeUpload
// verified (size and SHA-256) is copied out of quarantine and becomes ready; a rejected one keeps its metadata, its
// bytes are released. Then the quarantined object is deleted.
func (w *Worker) Scan(ctx context.Context, m events.Message) error {
	pool, err := w.Pools.For(ctx, m.TenantID)
	if err != nil {
		return err
	}
	var f scanned
	err = pool.QueryRow(ctx, `select state, object_key, declared_mime, purpose, owner_type, owner_id, coalesce(bytes, 0),
	                                 coalesce(encode(sha256, 'hex'), '')
	                            from files.objects where id = $1`, m.AggregateID).
		Scan(&f.state, &f.key, &f.declared, &f.purpose, &f.ownerType, &f.ownerID, &f.size, &f.sha)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		w.log().WarnContext(ctx, "files: scan of an unknown file", slog.String("file_id", m.AggregateID.String()))
		return nil
	case err != nil:
		return fmt.Errorf("files: scan: %w", err)
	case f.state != "scanning":
		return nil
	case w.Store == nil:
		return errors.New("files: object storage is not configured (S3_ENDPOINT)")
	}
	v, err := w.check(ctx, f)
	if err != nil {
		return err
	}
	final := FileKey(m.TenantID, m.AggregateID)
	if v.Clean {
		if err := w.Store.Copy(ctx, f.key, final); err != nil {
			return fmt.Errorf("files: copy out of quarantine: %w", err)
		}
	}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		return w.record(ctx, tx, m.AggregateID, f, v, final)
	})
	if errors.Is(err, errDone) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := w.Store.Delete(ctx, f.key); err != nil {
		w.log().WarnContext(ctx, "files: quarantined object not deleted", slog.String("file_id", m.AggregateID.String()),
			slog.String("error", err.Error()))
	}
	return nil
}

// check runs the scanner over the quarantined object while hashing it; a missing object is rejected, and so is one
// whose size or SHA-256 is not the verified one (checksum_mismatch).
func (w *Worker) check(ctx context.Context, f scanned) (Verdict, error) {
	rc, _, err := w.Store.Open(ctx, f.key)
	if errors.Is(err, storage.ErrNotFound) {
		return Verdict{Code: CodeObjectMissing}, nil
	}
	if err != nil {
		return Verdict{}, fmt.Errorf("files: open for check: %w", err)
	}
	defer rc.Close()
	scanner := w.Scanner
	if scanner == nil {
		scanner = BasicScanner{}
	}
	h := sha256.New()
	body := io.TeeReader(io.LimitReader(rc, MaxBytes+1), h)
	contentType, _ := DecodeMIME(f.declared)
	v, err := scanner.Scan(ctx, body, contentType)
	if err != nil {
		return Verdict{}, err
	}
	if _, err := io.Copy(io.Discard, body); err != nil { // the rest the scanner did not read
		return Verdict{}, fmt.Errorf("files: read for check: %w", err)
	}
	if hex.EncodeToString(h.Sum(nil)) != f.sha {
		return Verdict{Code: CodeChecksumMismatch, DetectedMIME: v.DetectedMIME}, nil
	}
	return v, nil
}

// record writes the verdict in tx: ready (the permanent key) or rejected (release of the bytes), and its event.
func (w *Worker) record(ctx context.Context, tx pgx.Tx, id uuid.UUID, f scanned, v Verdict, final string) error {
	event := EventReady
	tagSQL := `update files.objects set state = 'ready', ready_at = $2, detected_mime = $3, object_key = $4
	            where id = $1 and state = 'scanning'`
	args := []any{id, w.now(), orNil(v.DetectedMIME), final}
	if !v.Clean {
		event = EventRejected
		tagSQL = `update files.objects set state = 'rejected', rejected_code = $2, detected_mime = $3
		           where id = $1 and state = 'scanning'`
		args = []any{id, v.Code, orNil(v.DetectedMIME)}
	}
	tag, err := tx.Exec(ctx, tagSQL, args...)
	if err != nil {
		return fmt.Errorf("files: record verdict: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return errDone
	}
	if !v.Clean {
		if _, err := tx.Exec(ctx, `update files.usage set committed_bytes = committed_bytes - $1, updated_at = now()
		                            where singleton`, f.size); err != nil {
			return fmt.Errorf("files: release rejected bytes: %w", err)
		}
		if _, err := tx.Exec(ctx, ledgerSQL, id, "release", f.size, nil); err != nil {
			return fmt.Errorf("files: release rejected bytes: %w", err)
		}
	}
	payload := map[string]string{"fileId": id.String(), "purpose": f.purpose, "ownerType": f.ownerType, "ownerId": f.ownerID.String()}
	if !v.Clean {
		payload["rejectedCode"] = v.Code
	}
	_, err = events.Publish(ctx, tx, events.Event{Type: event, Aggregate: "files.file", AggregateID: id, Payload: payload})
	return err
}

// Expire closes an upload session whose deadline has come (EventDeadline): the reservation is released and the
// quarantined object deleted. A session that is not live any more is left alone; one whose deadline is still ahead
// (clock skew between the database and the worker) is retried.
func (w *Worker) Expire(ctx context.Context, m events.Message) error {
	pool, err := w.Pools.For(ctx, m.TenantID)
	if err != nil {
		return err
	}
	now := w.now()
	var key string
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		r, err := scanSession(tx.QueryRow(ctx, `select s.id, s.file_id, s.state, s.reserved_bytes, s.ticket_expires_at,
		        s.session_expires_at, s.created_at, f.state, f.purpose, f.owner_type, f.owner_id, f.bytes, f.object_key,
		        f.declared_mime, encode(f.sha256, 'hex')
		   from files.upload_sessions s join files.objects f on f.id = s.file_id
		  where s.id = $1 for update of s`, m.AggregateID))
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return errDone
		case err != nil:
			return fmt.Errorf("files: expire: %w", err)
		case !r.live():
			return errDone
		case now.Before(r.SessionExpiresAt):
			return fmt.Errorf("files: session %s expires at %s", r.ID, r.SessionExpiresAt.Format(time.RFC3339))
		}
		key = r.objectKey
		return closeSession(ctx, tx, r, stateExpired, now)
	})
	if errors.Is(err, errDone) {
		return nil
	}
	if err != nil {
		return err
	}
	if w.Store != nil {
		if err := w.Store.Delete(ctx, key); err != nil {
			w.log().WarnContext(ctx, "files: object of an expired upload not deleted", slog.String("error", err.Error()))
		}
	}
	return nil
}
