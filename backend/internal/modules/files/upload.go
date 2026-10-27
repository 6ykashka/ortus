package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Session states (files.upload_sessions.state).
const (
	stateIssued    = "issued"
	stateUploaded  = "uploaded"
	stateCompleted = "completed"
	stateExpired   = "expired"
	stateAborted   = "aborted"
)

// quotaText is QUOTA_TEXT of the prototype (initiateUpload/quota_exceeded).
const quotaText = "Место организации заполнено. Загрузка новых файлов недоступна."

const (
	ensureUsageSQL = `insert into files.usage (limit_bytes) values ($1) on conflict (singleton) do nothing`
	// reserveSQL is the atomic reservation of tenant 0001 over the one total of StorageUsage: committed file bytes,
	// the estimate of the database and the reservations (the row lock orders concurrent reservations); no row —
	// quota_exceeded (PLAT-07, A-10). activity_reserve_bytes (0; for closing started shifts, Q-12) stays the margin
	// of tenant 0001.
	reserveSQL = `update files.usage set reserved_bytes = reserved_bytes + $1, updated_at = now()
	               where singleton and committed_bytes + reserved_bytes + pg_database_size(current_database()) + $1
	                                   <= limit_bytes + activity_reserve_bytes`
	insertObjectSQL = `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes,
	                                         sha256, uploaded_by, created_at)
	                   values ($1, $2, 'reserved', $3, $4, $5, $6, $7, decode($8, 'hex'), $9, $10)`
	insertSessionSQL = `insert into files.upload_sessions (id, file_id, actor_id, state, reserved_bytes, ticket_expires_at,
	                                                  session_expires_at, created_at)
	                    values ($1, $2, $3, 'issued', $4, $5, $6, $7)`
	ledgerSQL = `insert into files.quota_ledger (file_id, kind, bytes, expires_at) values ($1, $2, $3, $4)`
	// sessionSQL reads a session of the actor with its file; %s is an optional lock.
	sessionSQL = `select s.id, s.file_id, s.state, s.reserved_bytes, s.ticket_expires_at, s.session_expires_at, s.created_at,
	                     f.state, f.purpose, f.owner_type, f.owner_id, f.bytes, f.object_key, f.declared_mime,
	                     encode(f.sha256, 'hex')
	                from files.upload_sessions s join files.objects f on f.id = s.file_id
	               where s.id = $1 and s.actor_id = $2 %s`
)

// Initiate reserves quota and issues the upload ticket (initiateUpload): body limits, the parent (visible, accepts
// the purpose, files.upload on it), the reservation, the file, the session, the ledger and the deadline event in one
// transaction, then a presigned PUT into quarantine.
func (s *Service) Initiate(ctx context.Context, tc tenantctx.TenantContext, u Upload) (Ticket, error) {
	if err := ValidateUpload(u); err != nil {
		return Ticket{}, err
	}
	kind, ok := s.Parents.Kind(u.Owner.Module, u.Owner.Entity)
	switch {
	case !ok:
		return Ticket{}, invalid("К объекту этого вида файлы не прикрепляются.")
	case !kind.Allows(u.Purpose):
		return Ticket{}, invalid("Назначение файла не подходит объекту.")
	}
	st, err := s.store()
	if err != nil {
		return Ticket{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return Ticket{}, err
	}
	if err := s.permitUpload(ctx, pool, tc, u.Owner); err != nil {
		return Ticket{}, err
	}
	now := s.now()
	t := Ticket{
		UploadID: uuid.New(), FileID: uuid.New(), ContentType: u.ContentType, SHA256: u.SHA256,
		ExpiresAt: now.Add(TicketTTL), MaxBytes: MaxBytes,
	}
	key := QuarantineKey(tc.TenantID, t.FileID)
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		return s.reserve(ctx, tx, tc, u, t, key, now)
	})
	if err != nil {
		return Ticket{}, err
	}
	if t.URL, err = st.PresignPut(key, u.ContentType, u.SizeBytes, TicketTTL); err != nil {
		return Ticket{}, problem.Wrap(codeDependency, err)
	}
	return t, nil
}

// reserve writes the reservation of an upload in tx.
func (s *Service) reserve(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, u Upload, t Ticket, key string, now time.Time) error {
	if _, err := tx.Exec(ctx, ensureUsageSQL, DefaultQuotaBytes); err != nil {
		return fmt.Errorf("files: usage: %w", err)
	}
	tag, err := tx.Exec(ctx, reserveSQL, u.SizeBytes)
	if err != nil {
		return fmt.Errorf("files: reserve: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return problem.New(codeQuota, quotaText)
	}
	expires := now.Add(SessionTTL)
	steps := []struct {
		sql  string
		args []any
	}{
		{insertObjectSQL, []any{t.FileID, key, string(u.Purpose), u.Owner.Kind(), u.Owner.ID, EncodeMIME(u.ContentType, u.FileName),
			u.SizeBytes, u.SHA256, tc.PersonID, now}},
		{insertSessionSQL, []any{t.UploadID, t.FileID, tc.PersonID, u.SizeBytes, t.ExpiresAt, expires, now}},
		{ledgerSQL, []any{t.FileID, "reserve", u.SizeBytes, expires}},
	}
	for _, st := range steps {
		if _, err := tx.Exec(ctx, st.sql, st.args...); err != nil {
			return fmt.Errorf("files: initiate: %w", err)
		}
	}
	_, err = events.Publish(ctx, tx, events.Event{
		Type: EventDeadline, Aggregate: "files.upload", AggregateID: t.UploadID, AvailableAt: expires,
		Payload: map[string]string{"uploadId": t.UploadID.String(), "fileId": t.FileID.String()},
	})
	return err
}

// sessionRow is a session with its file.
type sessionRow struct {
	Session
	fileState, objectKey, declared, sha string
}

func (r sessionRow) live() bool { return r.State == stateIssued || r.State == stateUploaded }

func scanSession(row pgx.Row) (sessionRow, error) {
	var r sessionRow
	var purpose string
	err := row.Scan(&r.ID, &r.FileID, &r.State, &r.ReservedBytes, &r.TicketExpiresAt, &r.SessionExpiresAt, &r.CreatedAt,
		&r.fileState, &purpose, &r.Owner.Module, &r.Owner.ID, &r.SizeBytes, &r.objectKey, &r.declared, &r.sha)
	if err != nil {
		return sessionRow{}, err
	}
	r.Purpose = Purpose(purpose)
	r.Owner.Module, r.Owner.Entity, _ = strings.Cut(r.Owner.Module, ".")
	r.FileStatus = APIStatus(r.fileState)
	return r, nil
}

// loadSession reads a session of the actor; lock — «for update of s». Missing and foreign are one not_found.
func loadSession(ctx context.Context, q querier, tc tenantctx.TenantContext, id uuid.UUID, lock bool) (sessionRow, error) {
	suffix := ""
	if lock {
		suffix = "for update of s"
	}
	r, err := scanSession(q.QueryRow(ctx, fmt.Sprintf(sessionSQL, suffix), id, tc.PersonID))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return sessionRow{}, problem.New(codeNotFound, gone)
	case err != nil:
		return sessionRow{}, fmt.Errorf("files: session: %w", err)
	}
	return r, nil
}

// close ends a live session as expired or aborted and releases its reservation (usage, ledger) in tx.
func closeSession(ctx context.Context, tx pgx.Tx, r sessionRow, state string, at time.Time) error {
	steps := []struct {
		sql  string
		args []any
	}{
		{`update files.upload_sessions set state = $2, closed_at = $3, reserved_bytes = 0, revision = revision + 1
		   where id = $1`, []any{r.ID, state, at}},
		{`update files.usage set reserved_bytes = reserved_bytes - $1, updated_at = now() where singleton`, []any{r.ReservedBytes}},
		{ledgerSQL, []any{r.FileID, "release", r.ReservedBytes, nil}},
	}
	for _, st := range steps {
		if _, err := tx.Exec(ctx, st.sql, st.args...); err != nil {
			return fmt.Errorf("files: close session: %w", err)
		}
	}
	return nil
}

// expireIfDue closes a live session whose deadline has passed and returns its new state.
func (s *Service) expireIfDue(ctx context.Context, pool *pgxpool.Pool, tc tenantctx.TenantContext, r sessionRow) (sessionRow, error) {
	now := s.now()
	if !r.live() || now.Before(r.SessionExpiresAt) {
		return r, nil
	}
	err := inTx(ctx, pool, func(tx pgx.Tx) error {
		locked, err := loadSession(ctx, tx, tc, r.ID, true)
		if err != nil || !locked.live() {
			r = locked
			return err
		}
		if err := closeSession(ctx, tx, locked, stateExpired, now); err != nil {
			return err
		}
		r = locked
		r.State, r.ReservedBytes = stateExpired, 0
		return nil
	})
	if err != nil {
		return sessionRow{}, err
	}
	s.deleteQuietly(ctx, r.objectKey)
	return r, nil
}

// deleteQuietly removes a quarantined object after its session closed; a failure leaves an orphan for the
// lifecycle rule of the bucket, never a wrong answer.
func (s *Service) deleteQuietly(ctx context.Context, key string) {
	if s.Store != nil && key != "" {
		_ = s.Store.Delete(context.WithoutCancel(ctx), key)
	}
}

// Session returns an upload session of the actor (getUploadSession): an expired one is closed on read, an issued
// one becomes uploaded when its object is in quarantine.
func (s *Service) Session(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (Session, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return Session{}, err
	}
	r, err := loadSession(ctx, pool, tc, id, false)
	if err != nil {
		return Session{}, err
	}
	if r, err = s.expireIfDue(ctx, pool, tc, r); err != nil {
		return Session{}, err
	}
	if r.State == stateIssued && s.Store != nil {
		if _, err := s.Store.Stat(ctx, r.objectKey); err == nil {
			if err := markUploaded(ctx, pool, r); err != nil {
				return Session{}, err
			}
			r.State, r.FileStatus = stateUploaded, APIStatus(stateUploaded)
		}
	}
	return r.Session, nil
}

func markUploaded(ctx context.Context, pool *pgxpool.Pool, r sessionRow) error {
	return inTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update files.upload_sessions set state = 'uploaded', revision = revision + 1
		                            where id = $1 and state = 'issued'`, r.ID); err != nil {
			return fmt.Errorf("files: mark uploaded: %w", err)
		}
		_, err := tx.Exec(ctx, `update files.objects set state = 'uploaded' where id = $1 and state = 'reserved'`, r.FileID)
		return err
	})
}

// Complete checks files.upload on the parent again, verifies the uploaded object (checksum of the body, presence,
// size, type, SHA-256 of the content) and
// queues its check in one transaction: the session is completed, the reservation becomes committed bytes, the file
// waits in quarantine (completeUpload, 202). A repeated complete is 409 — one effect (AC-07). The object is first
// copied to a key no ticket covers (VerifiedKey): the copy is what is verified, recorded and checked, so a PUT
// through the still valid ticket cannot swap the content after the verification.
func (s *Service) Complete(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, sha string) (File, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return File{}, err
	}
	r, err := loadSession(ctx, pool, tc, id, false)
	if err != nil {
		return File{}, err
	}
	if r, err = s.expireIfDue(ctx, pool, tc, r); err != nil {
		return File{}, err
	}
	if err := completable(r); err != nil {
		return File{}, err
	}
	if sha != r.sha {
		return File{}, invalid("Контрольная сумма не совпадает.")
	}
	// The role may have been revoked since the ticket: the parent decides again (FILE-03).
	if err := s.permitUpload(ctx, pool, tc, r.Owner); err != nil {
		return File{}, err
	}
	st, err := s.store()
	if err != nil {
		return File{}, err
	}
	contentType, name := DecodeMIME(r.declared)
	verified := VerifiedKey(tc.TenantID, r.FileID, uuid.New())
	if err := snapshot(ctx, st, r.objectKey, verified); err != nil {
		return File{}, err
	}
	if err := verifyObject(ctx, st, verified, r, contentType); err != nil {
		s.deleteQuietly(ctx, verified)
		return File{}, err
	}
	dup, err := s.commit(ctx, pool, tc, r, verified)
	if err != nil {
		s.deleteQuietly(ctx, verified)
		return File{}, err
	}
	s.deleteQuietly(ctx, r.objectKey)
	return File{
		ID: r.FileID, FileName: name, ContentType: contentType, SizeBytes: r.SizeBytes, SHA256: r.sha,
		Status: APIStatus("scanning"), CreatedAt: r.CreatedAt, Purpose: r.Purpose, Owner: r.Owner, Duplicate: dup,
	}, nil
}

// commit completes the verified upload of session r in one transaction (the session locked and checked again) and
// returns the warning of earlier files of the tenant with the same bytes (W2.43).
func (s *Service) commit(ctx context.Context, pool *pgxpool.Pool, tc tenantctx.TenantContext, r sessionRow, verified string) (*Duplicate, error) {
	now := s.now()
	var dup *Duplicate
	err := inTx(ctx, pool, func(tx pgx.Tx) error {
		locked, err := loadSession(ctx, tx, tc, r.ID, true)
		if err != nil {
			return err
		}
		if err := completable(locked); err != nil {
			return err
		}
		if err := commitUpload(ctx, tx, locked, verified, now); err != nil {
			return err
		}
		dup, err = duplicateOf(ctx, tx, r.FileID)
		return err
	})
	return dup, err
}

// completable: a live session; a completed one is 409, a closed one does not exist any more.
func completable(r sessionRow) error {
	switch r.State {
	case stateIssued, stateUploaded:
		return nil
	case stateCompleted:
		return problem.New(codeTransition, "Загрузка уже завершена.")
	}
	return problem.New(codeNotFound, gone)
}

// snapshot copies the uploaded object to the key that completeUpload verifies.
func snapshot(ctx context.Context, st storage.Store, src, dst string) error {
	err := st.Copy(ctx, src, dst)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return problem.New(codeTransition, "Файл ещё не загружен в хранилище.")
	case err != nil:
		return problem.Wrap(codeDependency, err)
	}
	return nil
}

// verifyObject checks the object at key against the session (FILE-02).
func verifyObject(ctx context.Context, st storage.Store, key string, r sessionRow, contentType string) error {
	info, err := st.Stat(ctx, key)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return problem.New(codeTransition, "Файл ещё не загружен в хранилище.")
	case err != nil:
		return problem.Wrap(codeDependency, err)
	case info.Size != r.SizeBytes:
		return invalid("Размер файла не совпадает с заявленным.")
	}
	if got, _, err := mime.ParseMediaType(info.ContentType); err != nil || got != contentType {
		return invalid("Тип файла не совпадает с заявленным.")
	}
	rc, _, err := st.Open(ctx, key)
	if err != nil {
		return problem.Wrap(codeDependency, err)
	}
	defer rc.Close()
	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(rc, r.SizeBytes+1)); err != nil {
		return problem.Wrap(codeDependency, err)
	}
	if hex.EncodeToString(h.Sum(nil)) != r.sha {
		return invalid("Содержимое файла не совпадает с контрольной суммой.")
	}
	return nil
}

// commitUpload turns the reservation of a verified upload into committed bytes, records the verified copy as the
// object of the file and queues its check.
func commitUpload(ctx context.Context, tx pgx.Tx, r sessionRow, verified string, now time.Time) error {
	steps := []struct {
		sql  string
		args []any
	}{
		{`update files.upload_sessions set state = 'completed', completed_at = $2, attempts = attempts + 1,
		         revision = revision + 1 where id = $1`, []any{r.ID, now}},
		{`update files.objects set state = 'scanning', object_key = $2 where id = $1`, []any{r.FileID, verified}},
		{`update files.usage set reserved_bytes = reserved_bytes - $1, committed_bytes = committed_bytes + $2,
		         updated_at = now() where singleton`, []any{r.ReservedBytes, r.SizeBytes}},
		{ledgerSQL, []any{r.FileID, "commit", r.SizeBytes, nil}},
	}
	for _, st := range steps {
		if _, err := tx.Exec(ctx, st.sql, st.args...); err != nil {
			return fmt.Errorf("files: complete: %w", err)
		}
	}
	_, err := events.Publish(ctx, tx, events.Event{
		Type: EventUploaded, Aggregate: aggregateFile, AggregateID: r.FileID,
		Payload: map[string]string{"fileId": r.FileID.String(), "purpose": string(r.Purpose), "ownerType": r.Owner.Kind(),
			"ownerId": r.Owner.ID.String()},
	})
	return err
}

// Abort cancels a live upload session of the actor (abortUpload): the reservation is released and the object
// deleted in one transaction; a completed session is 409, a closed one is already released (204).
func (s *Service) Abort(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) error {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return err
	}
	now := s.now()
	var key string
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		r, err := loadSession(ctx, tx, tc, id, true)
		if err != nil {
			return err
		}
		switch {
		case r.State == stateCompleted:
			return problem.New(codeTransition, "Загрузка уже завершена: файл на проверке.")
		case !r.live():
			return nil
		}
		key = r.objectKey
		state := stateAborted
		if !now.Before(r.SessionExpiresAt) {
			state = stateExpired
		}
		return closeSession(ctx, tx, r, state, now)
	})
	if err != nil {
		return err
	}
	s.deleteQuietly(ctx, key)
	return nil
}
