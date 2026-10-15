package idem

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGStore keeps records in core.idempotency_keys of a tenant DB (role ortus_api). The tenant is the database, so
// the key of the table (actor_id, operation, key) is the whole namespace.
type PGStore struct{ db DB }

// NewPGStore returns a store over a tenant DB pool.
func NewPGStore(db DB) *PGStore { return &PGStore{db: db} }

const (
	claimSQL = `
insert into core.idempotency_keys as k (actor_id, operation, key, request_hash, state, expires_at)
values ($1, $2, $3, $4, 'in_progress', $5)
on conflict (actor_id, operation, key) do update
   set request_hash = excluded.request_hash, state = 'in_progress', response_status = null,
       response_body = null, created_at = now(), expires_at = excluded.expires_at
 where k.expires_at <= $6
returning true`
	readSQL = `
select request_hash, state, response_status, response_body
  from core.idempotency_keys
 where actor_id = $1 and operation = $2 and key = $3`
	releaseSQL = `
delete from core.idempotency_keys
 where actor_id = $1 and operation = $2 and key = $3 and request_hash = $4 and state = 'in_progress'`
)

// claimAttempts bounds Begin when the record it found disappears before it is read (released concurrently).
const claimAttempts = 3

// Begin implements Store: one statement claims a new or expired record; a live one is read and compared.
func (s *PGStore) Begin(ctx context.Context, rec Record, now, leaseUntil time.Time) (*Outcome, error) {
	for range claimAttempts {
		var claimed bool
		err := s.db.QueryRow(ctx, claimSQL, rec.ActorID, rec.Operation, rec.Key, rec.Hash, leaseUntil, now).Scan(&claimed)
		if err == nil {
			return nil, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("idem: claim: %w", err)
		}
		var (
			hash   []byte
			state  string
			status *int
			doc    []byte
		)
		err = s.db.QueryRow(ctx, readSQL, rec.ActorID, rec.Operation, rec.Key).Scan(&hash, &state, &status, &doc)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("idem: read: %w", err)
		}
		switch {
		case !bytes.Equal(hash, rec.Hash):
			return nil, ErrKeyReused
		case state != "completed" || status == nil:
			return nil, ErrInProgress
		}
		out, err := decodeOutcome(*status, doc)
		if err != nil {
			return nil, err
		}
		return &out, nil
	}
	return nil, ErrInProgress
}

// Complete implements Store.
func (s *PGStore) Complete(ctx context.Context, rec Record, out Outcome, expires time.Time) error {
	doc, err := encodeOutcome(out)
	if err != nil {
		return err
	}
	if _, err := s.db.Exec(ctx, completeSQL, rec.ActorID, rec.Operation, rec.Key, rec.Hash, out.Status, doc, expires); err != nil {
		return fmt.Errorf("idem: complete: %w", err)
	}
	return nil
}

// Release implements Store.
func (s *PGStore) Release(ctx context.Context, rec Record) error {
	if _, err := s.db.Exec(ctx, releaseSQL, rec.ActorID, rec.Operation, rec.Key, rec.Hash); err != nil {
		return fmt.Errorf("idem: release: %w", err)
	}
	return nil
}

// PoolSource opens the sentinel-checked pool of a tenant DB (tenantctx.Pools).
type PoolSource interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// TenantStores implements Stores: a tenant operation keeps its keys in its tenant DB, an identity or platform
// operation (uuid.Nil) in Platform.
type TenantStores struct {
	Pools    PoolSource
	Platform Store
}

// errNoPlatformStore is returned for an identity or platform operation when TenantStores has no Platform store.
var errNoPlatformStore = errors.New("idem: no store for identity and platform operations")

// For implements Stores.
func (t TenantStores) For(ctx context.Context, tenantID uuid.UUID) (Store, error) {
	if tenantID == uuid.Nil {
		if t.Platform == nil {
			return nil, errNoPlatformStore
		}
		return t.Platform, nil
	}
	pool, err := t.Pools.For(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return NewPGStore(pool), nil
}
