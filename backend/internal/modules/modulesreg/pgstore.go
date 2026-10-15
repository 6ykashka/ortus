package modulesreg

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// PGStore is the Store over modules.installations of the tenant DBs (role ortus_api).
type PGStore struct{ Pools Pools }

var _ Store = PGStore{}

// dbEnabled is the stored name of StateActive (tenant 0001: enabled | draining | read_only | disabled).
const dbEnabled = "enabled"

func dbState(state string) string {
	if state == StateActive {
		return dbEnabled
	}
	return state
}

func contractState(stored string) string {
	if stored == dbEnabled {
		return StateActive
	}
	return stored
}

const installationsSQL = `
select module_key, state, retained_access, revision, settings::text from modules.installations order by module_key`

// Installations implements Store. A row stored under a catalog synonym (logistics) is read as the contract key;
// when both exist, the row of the contract key wins.
func (s PGStore) Installations(ctx context.Context, tenantID uuid.UUID) (map[string]Installation, error) {
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx, installationsSQL)
	if err != nil {
		return nil, fmt.Errorf("modules: installations: %w", err)
	}
	defer rows.Close()
	out := map[string]Installation{}
	for rows.Next() {
		var (
			in       Installation
			settings string
		)
		if err := rows.Scan(&in.StoredKey, &in.State, &in.RetainedAccess, &in.Revision, &settings); err != nil {
			return nil, fmt.Errorf("modules: installations: %w", err)
		}
		key, ok := Canonical(in.StoredKey)
		if !ok {
			continue
		}
		if prev, seen := out[key]; seen && prev.StoredKey == key {
			continue
		}
		in.Key, in.State = key, contractState(in.State)
		if settings != "{}" {
			in.Settings = []byte(settings)
		}
		out[key] = in
	}
	return out, rows.Err()
}

// Querier implements Store.
func (s PGStore) Querier(ctx context.Context, tenantID uuid.UUID) (Querier, error) {
	return s.Pools.For(ctx, tenantID)
}

// Apply implements Store: the row under a lock (or a new row), policy_version + 1 when the state changes and the
// audit record, in one transaction of the tenant DB.
func (s PGStore) Apply(ctx context.Context, tenantID uuid.UUID, ch Change) (Installation, error) {
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return Installation{}, err
	}
	out := Installation{Key: ch.Key, StoredKey: ch.StoredKey, State: ch.State, RetainedAccess: ch.Retained, Settings: ch.Settings}
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		from, rev, err := upsert(ctx, tx, ch)
		if err != nil {
			return err
		}
		out.Revision = rev + 1
		if ch.PolicyChange {
			if _, err := tx.Exec(ctx, `insert into access.policy_state (singleton, policy_version) values (true, 2)
				on conflict (singleton) do update set policy_version = access.policy_state.policy_version + 1`); err != nil {
				return fmt.Errorf("modules: policy version: %w", err)
			}
		}
		return record(ctx, tx, ch, from)
	})
	if err != nil {
		return Installation{}, err
	}
	return out, nil
}

// upsert writes the row of ch and returns the state and revision it replaced (uninstalled, revisionNone: no row).
func upsert(ctx context.Context, tx pgx.Tx, ch Change) (string, int64, error) {
	var (
		rev  int64
		from string
	)
	err := tx.QueryRow(ctx, `select revision, state from modules.installations where module_key = $1 for update`, ch.StoredKey).
		Scan(&rev, &from)
	settings := settingsArg(ch.Settings)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if ch.From != revisionNone {
			return "", 0, ErrConflict
		}
		tag, err := tx.Exec(ctx, `
insert into modules.installations (module_key, state, manifest_version, retained_access, settings, revision, updated_by)
values ($1, $2, $3, $4, coalesce($5::jsonb, '{}'::jsonb), $6, $7)
on conflict (module_key) do nothing`,
			ch.StoredKey, dbState(ch.State), manifestVersion, ch.Retained, settings, revisionNone+1, ch.ActorID)
		if err != nil {
			return "", 0, fmt.Errorf("modules: install: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return "", 0, ErrConflict
		}
		return StateUninstalled, revisionNone, nil
	case err != nil:
		return "", 0, fmt.Errorf("modules: installation: %w", err)
	case rev != ch.From:
		return "", 0, ErrConflict
	}
	if _, err := tx.Exec(ctx, `
update modules.installations
   set state = $2, retained_access = $3, settings = coalesce($4::jsonb, settings), revision = revision + 1,
       updated_by = $5, updated_at = now()
 where module_key = $1`, ch.StoredKey, dbState(ch.State), ch.Retained, settings, ch.ActorID); err != nil {
		return "", 0, fmt.Errorf("modules: update: %w", err)
	}
	return contractState(from), rev, nil
}

func settingsArg(b []byte) any {
	if b == nil {
		return nil
	}
	return string(b)
}

// record writes the audit.events row of ch (actor: the person, or the service when draining is settled).
func record(ctx context.Context, tx pgx.Tx, ch Change, from string) error {
	e := audit.Event{
		ActorKind: audit.ActorPerson, ActorID: ch.ActorID, Action: ch.Action, TargetType: "module", Reason: ch.Reason,
		Result: audit.OK, RequestID: requestid.FromContext(ctx),
		Diff: map[string]any{"moduleKey": ch.Key, "from": from, "to": ch.State, "retainedAccess": ch.Retained},
	}
	if ch.ActorID == uuid.Nil {
		e.ActorKind = audit.ActorService
	}
	if e.RequestID == "" {
		e.RequestID = "modules:" + uuid.NewString()
	}
	return audit.Record(ctx, tx, e)
}
