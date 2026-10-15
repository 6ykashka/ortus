package oidc

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// DB is what the stores need from the control DB: *pgxpool.Pool or a transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// sweepEvery: every this many writes a store drops its expired rows.
const sweepEvery = 256

// PGSessionStore is the durable session.Store of the BFF (control DB auth_sessions, Q-W0.09-8). The table keeps
// the SHA-256 of the session id; a revoked session, an expired one and a session of an account that is no longer
// active do not authenticate.
type PGSessionStore struct {
	db     DB
	writes atomic.Uint64
}

var _ session.Store = (*PGSessionStore)(nil)

// NewPGSessionStore returns the store over the control DB (role ortus_api).
func NewPGSessionStore(db DB) *PGSessionStore { return &PGSessionStore{db: db} }

// Create implements session.Store.
func (s *PGSessionStore) Create(ctx context.Context, v session.Session) error {
	if s.writes.Add(1)%sweepEvery == 0 {
		// Expired sessions are useless even for a logout replay; a failed sweep is retried by the next one.
		_, _ = s.db.Exec(ctx, `delete from auth_sessions where expires_at < now()`)
	}
	_, err := s.db.Exec(ctx, `insert into auth_sessions (id_hash, account_id, csrf_token, provider, auth_time, issued_at, expires_at)
		values ($1, $2, $3, $4, $5, $6, $7)`,
		Hash(v.ID), v.AccountID, v.CSRF, v.Provider, v.AuthTime, v.IssuedAt, v.ExpiresAt)
	if err != nil {
		return fmt.Errorf("auth_sessions: %w", err)
	}
	return nil
}

// Get implements session.Store: a live session of an active account (expiry is checked by session.Manager).
func (s *PGSessionStore) Get(ctx context.Context, id string) (session.Session, error) {
	v := session.Session{ID: id}
	err := s.db.QueryRow(ctx, `
select s.account_id, s.csrf_token, s.provider, s.auth_time, s.issued_at, s.expires_at
  from auth_sessions s
  join accounts a on a.id = s.account_id and a.status = 'active'
 where s.id_hash = $1 and s.revoked_at is null`, Hash(id)).
		Scan(&v.AccountID, &v.CSRF, &v.Provider, &v.AuthTime, &v.IssuedAt, &v.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return session.Session{}, session.ErrNotFound
	}
	if err != nil {
		return session.Session{}, fmt.Errorf("auth_sessions: %w", err)
	}
	v.AuthTime, v.IssuedAt, v.ExpiresAt = v.AuthTime.UTC(), v.IssuedAt.UTC(), v.ExpiresAt.UTC()
	return v, nil
}

// Delete implements session.Store: the session is revoked (an unknown or revoked id is not an error).
func (s *PGSessionStore) Delete(ctx context.Context, id string) error {
	if _, err := s.db.Exec(ctx, `update auth_sessions set revoked_at = now() where id_hash = $1 and revoked_at is null`, Hash(id)); err != nil {
		return fmt.Errorf("auth_sessions: %w", err)
	}
	return nil
}

// Revoke ends a live session by logout with its Idempotency-Key and result; session.ErrNotFound when the session
// is unknown or already revoked.
func (s *PGSessionStore) Revoke(ctx context.Context, id, logoutKey string, endSessionURL *string) error {
	tag, err := s.db.Exec(ctx, `update auth_sessions set revoked_at = now(), logout_key = $2, end_session_url = $3
		where id_hash = $1 and revoked_at is null`, Hash(id), logoutKey, endSessionURL)
	if err != nil {
		return fmt.Errorf("auth_sessions: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return session.ErrNotFound
	}
	return nil
}

// RevokedSession is what a logout replay needs of a revoked, not yet expired session.
type RevokedSession struct {
	AccountID     uuid.UUID
	CSRF          string
	LogoutKey     string // "" when revoked otherwise than by logout
	EndSessionURL *string
}

// Revoked returns a revoked session that has not expired; session.ErrNotFound otherwise.
func (s *PGSessionStore) Revoked(ctx context.Context, id string) (RevokedSession, error) {
	var (
		v   RevokedSession
		key *string
	)
	err := s.db.QueryRow(ctx, `select account_id, csrf_token, logout_key, end_session_url from auth_sessions
		where id_hash = $1 and revoked_at is not null and expires_at > now()`, Hash(id)).
		Scan(&v.AccountID, &v.CSRF, &key, &v.EndSessionURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return RevokedSession{}, session.ErrNotFound
	}
	if err != nil {
		return RevokedSession{}, fmt.Errorf("auth_sessions: %w", err)
	}
	if key != nil {
		v.LogoutKey = *key
	}
	return v, nil
}

// MemSessionStore is an in-memory session.Store with the revocation of PGSessionStore, for tests of the BFF.
type MemSessionStore struct {
	mu      sync.Mutex
	live    map[string]session.Session
	revoked map[string]RevokedSession
}

var _ session.Store = (*MemSessionStore)(nil)

// Create implements session.Store.
func (s *MemSessionStore) Create(_ context.Context, v session.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.live == nil {
		s.live = map[string]session.Session{}
	}
	s.live[v.ID] = v
	return nil
}

// Get implements session.Store.
func (s *MemSessionStore) Get(_ context.Context, id string) (session.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.live[id]
	if !ok {
		return session.Session{}, session.ErrNotFound
	}
	return v, nil
}

// Delete implements session.Store (revocation without a logout key).
func (s *MemSessionStore) Delete(ctx context.Context, id string) error {
	if err := s.Revoke(ctx, id, "", nil); err != nil && !errors.Is(err, session.ErrNotFound) {
		return err
	}
	return nil
}

// Revoke is PGSessionStore.Revoke.
func (s *MemSessionStore) Revoke(_ context.Context, id, logoutKey string, endSessionURL *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.live[id]
	if !ok {
		return session.ErrNotFound
	}
	delete(s.live, id)
	if s.revoked == nil {
		s.revoked = map[string]RevokedSession{}
	}
	s.revoked[id] = RevokedSession{AccountID: v.AccountID, CSRF: v.CSRF, LogoutKey: logoutKey, EndSessionURL: endSessionURL}
	return nil
}

// Revoked is PGSessionStore.Revoked.
func (s *MemSessionStore) Revoked(_ context.Context, id string) (RevokedSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.revoked[id]
	if !ok {
		return RevokedSession{}, session.ErrNotFound
	}
	return v, nil
}

// LoginState is the one-time record of a sign-in between startLogin and completeLogin.
type LoginState struct {
	State     string
	Nonce     string
	Verifier  string // PKCE code_verifier
	Provider  string // provider key: users | operators
	ReturnTo  string
	ExpiresAt time.Time
}

// ErrLoginNotFound: no sign-in record for the handle — unknown, already used or expired.
var ErrLoginNotFound = errors.New("oidc: sign-in record not found")

// LoginStore keeps sign-in records under the handle of the pre-auth cookie.
type LoginStore interface {
	Put(ctx context.Context, handle string, s LoginState) error
	// Take returns and deletes the record (single use); ErrLoginNotFound when there is none or it expired.
	Take(ctx context.Context, handle string) (LoginState, error)
}

// PGLoginStore is the LoginStore of the control DB (auth_login_states).
type PGLoginStore struct {
	db     DB
	writes atomic.Uint64
}

// NewPGLoginStore returns the store over the control DB.
func NewPGLoginStore(db DB) *PGLoginStore { return &PGLoginStore{db: db} }

// Put implements LoginStore.
func (s *PGLoginStore) Put(ctx context.Context, handle string, v LoginState) error {
	if s.writes.Add(1)%sweepEvery == 0 {
		_, _ = s.db.Exec(ctx, `delete from auth_login_states where expires_at < now()`)
	}
	_, err := s.db.Exec(ctx, `insert into auth_login_states (id_hash, state, nonce, code_verifier, provider, return_to, expires_at)
		values ($1, $2, $3, $4, $5, $6, $7)`, Hash(handle), v.State, v.Nonce, v.Verifier, v.Provider, v.ReturnTo, v.ExpiresAt)
	if err != nil {
		return fmt.Errorf("auth_login_states: %w", err)
	}
	return nil
}

// Take implements LoginStore.
func (s *PGLoginStore) Take(ctx context.Context, handle string) (LoginState, error) {
	var (
		v    LoginState
		live bool
	)
	err := s.db.QueryRow(ctx, `delete from auth_login_states where id_hash = $1
		returning state, nonce, code_verifier, provider, return_to, expires_at, expires_at > now()`, Hash(handle)).
		Scan(&v.State, &v.Nonce, &v.Verifier, &v.Provider, &v.ReturnTo, &v.ExpiresAt, &live)
	if errors.Is(err, pgx.ErrNoRows) {
		return LoginState{}, ErrLoginNotFound
	}
	if err != nil {
		return LoginState{}, fmt.Errorf("auth_login_states: %w", err)
	}
	if !live {
		return LoginState{}, ErrLoginNotFound
	}
	return v, nil
}

// MemLoginStore is an in-memory LoginStore for unit tests.
type MemLoginStore struct {
	Now func() time.Time
	mu  sync.Mutex
	m   map[string]LoginState
}

// Put implements LoginStore.
func (s *MemLoginStore) Put(_ context.Context, handle string, v LoginState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.m == nil {
		s.m = map[string]LoginState{}
	}
	s.m[string(Hash(handle))] = v
	return nil
}

// Take implements LoginStore.
func (s *MemLoginStore) Take(_ context.Context, handle string) (LoginState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := string(Hash(handle))
	v, ok := s.m[k]
	delete(s.m, k)
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	if !ok || !now.Before(v.ExpiresAt) {
		return LoginState{}, ErrLoginNotFound
	}
	return v, nil
}

// Len returns the number of records (tests).
func (s *MemLoginStore) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.m)
}

// AccountRef is the account of a provider identity.
type AccountRef struct {
	ID     uuid.UUID
	Status string // active | locked | deleted
}

// PGAccounts finds or creates the account of a provider identity (control DB accounts).
type PGAccounts struct{ db DB }

// NewPGAccounts returns the account store over the control DB.
func NewPGAccounts(db DB) *PGAccounts { return &PGAccounts{db: db} }

// Upsert returns the account of (issuer, subject), creating it on the first sign-in (without memberships). An
// active account follows the e-mail of the provider and records the sign-in; its display name, edited in Ortus,
// stays. A locked or deleted account is returned as is.
func (a *PGAccounts) Upsert(ctx context.Context, id Identity) (AccountRef, error) {
	var ref AccountRef
	err := a.db.QueryRow(ctx, `
insert into accounts (issuer, subject, email_norm, display_name, last_login_at)
values ($1, $2, $3, $4, now())
on conflict (issuer, subject) do update
   set email_norm    = case when accounts.status = 'active' then excluded.email_norm else accounts.email_norm end,
       last_login_at = case when accounts.status = 'active' then now() else accounts.last_login_at end
returning id, status`, id.Issuer, id.Subject, NormalizeEmail(id.Email), id.Name).Scan(&ref.ID, &ref.Status)
	if err != nil {
		return AccountRef{}, fmt.Errorf("accounts: %w", err)
	}
	return ref, nil
}
