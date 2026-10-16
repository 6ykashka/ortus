package invitations

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Reader is a control DB connection, pool or transaction that reads rows.
type Reader interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Pending returns the pending invitations of person profiles of a business — not accepted, not revoked, not expired
// at the clock of the control DB, the predicate of the seats (inviteMember) and of Issue: the profile id → the expiry
// of its latest pending invitation (W1.52). It only reads; no profiles — no query.
func Pending(ctx context.Context, db Reader, tenantID uuid.UUID, persons []uuid.UUID) (map[uuid.UUID]time.Time, error) {
	out := make(map[uuid.UUID]time.Time, len(persons))
	if len(persons) == 0 {
		return out, nil
	}
	rows, err := db.Query(ctx, `select person_profile_id, max(expires_at) from invitations
		where tenant_id = $1 and person_profile_id = any($2)
		  and accepted_at is null and revoked_at is null and expires_at > now()
		group by person_profile_id`, tenantID, persons)
	if err != nil {
		return nil, fmt.Errorf("invitations: pending: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			person  uuid.UUID
			expires time.Time
		)
		if err := rows.Scan(&person, &expires); err != nil {
			return nil, fmt.Errorf("invitations: pending: %w", err)
		}
		out[person] = expires
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("invitations: pending: %w", err)
	}
	return out, nil
}
