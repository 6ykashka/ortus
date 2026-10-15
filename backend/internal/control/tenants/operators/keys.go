package operators

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
)

// Keys is the idem.Store of identity and platform operations in idempotency_keys of the control DB (control 0005,
// S1-25): the namespace is tenant + actor + operation, a uuid.Nil tenant (the gateway gives none to /me and
// /platform operations) is stored as null, and «nulls not distinct» makes it one namespace. The tenantId of a
// platform command is in its path, so the same key with another tenant is another request (idempotency_key_reused).
// cmd/api passes it as idem.TenantStores.Platform instead of the process memory.
type Keys struct{ DB *sql.DB }

var _ idem.Store = Keys{}

const (
	keysClaimSQL = `
insert into idempotency_keys as k (actor_id, tenant_id, operation, key, request_hash, state, expires_at)
values ($1, $2, $3, $4, $5, 'in_progress', $6)
on conflict on constraint idempotency_keys_scope_key do update
   set request_hash = excluded.request_hash, state = 'in_progress', response_status = null,
       response_body = null, created_at = now(), expires_at = excluded.expires_at
 where k.expires_at <= $7
returning true`
	keysReadSQL = `
select request_hash, state, response_status, response_body::text
  from idempotency_keys
 where actor_id = $1 and tenant_id is not distinct from $2 and operation = $3 and key = $4`
	keysCompleteSQL = `
update idempotency_keys
   set state = 'completed', response_status = $6, response_body = $7::jsonb, expires_at = $8
 where actor_id = $1 and tenant_id is not distinct from $2 and operation = $3 and key = $4 and request_hash = $5
   and state = 'in_progress'`
	keysReleaseSQL = `
delete from idempotency_keys
 where actor_id = $1 and tenant_id is not distinct from $2 and operation = $3 and key = $4 and request_hash = $5
   and state = 'in_progress'`
)

// keysClaimAttempts bounds Begin when the record it found disappears before it is read (released concurrently).
const keysClaimAttempts = 3

// storedHeaders are the response headers kept with the body (as idem.Guard replays them).
var storedHeaders = []string{"Content-Type", "ETag", "Location"}

// storedOutcome is response_body: the body as bytes (base64 in JSON), since jsonb would reorder the keys of a JSON
// body and a replay must return the original bytes.
type storedOutcome struct {
	Header http.Header `json:"header,omitempty"`
	Body   []byte      `json:"body,omitempty"`
}

func tenantArg(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

// Begin implements idem.Store: one statement claims a new or expired record; a live one is read and compared.
func (k Keys) Begin(ctx context.Context, rec idem.Record, now, leaseUntil time.Time) (*idem.Outcome, error) {
	tenant := tenantArg(rec.TenantID)
	for range keysClaimAttempts {
		var claimed bool
		err := k.DB.QueryRowContext(ctx, keysClaimSQL, rec.ActorID, tenant, rec.Operation, rec.Key, rec.Hash, leaseUntil, now).Scan(&claimed)
		if err == nil {
			return nil, nil
		}
		if !errNoRows(err) {
			return nil, fmt.Errorf("operators: claim key: %w", err)
		}
		var (
			hash   []byte
			state  string
			status sql.NullInt64
			doc    sql.NullString
		)
		err = k.DB.QueryRowContext(ctx, keysReadSQL, rec.ActorID, tenant, rec.Operation, rec.Key).Scan(&hash, &state, &status, &doc)
		if errNoRows(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("operators: read key: %w", err)
		}
		switch {
		case !bytes.Equal(hash, rec.Hash):
			return nil, idem.ErrKeyReused
		case state != "completed" || !status.Valid:
			return nil, idem.ErrInProgress
		}
		var s storedOutcome
		if doc.Valid && doc.String != "" {
			if err := json.Unmarshal([]byte(doc.String), &s); err != nil {
				return nil, fmt.Errorf("operators: stored outcome: %w", err)
			}
		}
		if s.Header == nil {
			s.Header = http.Header{}
		}
		return &idem.Outcome{Status: int(status.Int64), Header: s.Header, Body: s.Body}, nil
	}
	return nil, idem.ErrInProgress
}

// Complete implements idem.Store.
func (k Keys) Complete(ctx context.Context, rec idem.Record, out idem.Outcome, expires time.Time) error {
	h := http.Header{}
	for _, name := range storedHeaders {
		if v := out.Header.Values(name); len(v) > 0 {
			h[http.CanonicalHeaderKey(name)] = v
		}
	}
	doc, err := json.Marshal(storedOutcome{Header: h, Body: out.Body})
	if err != nil {
		return fmt.Errorf("operators: encode outcome: %w", err)
	}
	if _, err := k.DB.ExecContext(ctx, keysCompleteSQL, rec.ActorID, tenantArg(rec.TenantID), rec.Operation, rec.Key, rec.Hash,
		out.Status, string(doc), expires); err != nil {
		return fmt.Errorf("operators: complete key: %w", err)
	}
	return nil
}

// Release implements idem.Store.
func (k Keys) Release(ctx context.Context, rec idem.Record) error {
	if _, err := k.DB.ExecContext(ctx, keysReleaseSQL, rec.ActorID, tenantArg(rec.TenantID), rec.Operation, rec.Key, rec.Hash); err != nil {
		return fmt.Errorf("operators: release key: %w", err)
	}
	return nil
}
