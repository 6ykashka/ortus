package tenants

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Tenant is the control-plane record of a tenant (OpenAPI Tenant): state by PLAT-02 (8 states), active owners
// as account ids.
type Tenant struct {
	ID              uuid.UUID
	Slug            string
	Name            string
	State           string
	OwnerAccountIDs []uuid.UUID
	CreatedAt       time.Time
	Revision        int64
}

// tenantSQL reads tenants with their active owners (owner_bindings → memberships.account_id), as text to stay
// independent of the array support of the driver.
const tenantSQL = `
select t.id, t.slug, t.display_name, t.state::text, t.created_at, t.revision,
       coalesce((select string_agg(m.account_id::text, ',' order by m.account_id::text)
                   from owner_bindings o join memberships m on m.id = o.membership_id
                  where o.tenant_id = t.id and o.revoked_at is null and m.status = 'active'), '')
  from tenants t`

func scanTenant(row interface{ Scan(dest ...any) error }) (Tenant, error) {
	var (
		tn     Tenant
		owners string
	)
	if err := row.Scan(&tn.ID, &tn.Slug, &tn.Name, &tn.State, &tn.CreatedAt, &tn.Revision, &owners); err != nil {
		return Tenant{}, err
	}
	tn.OwnerAccountIDs = []uuid.UUID{}
	for s := range strings.SplitSeq(owners, ",") {
		if s == "" {
			continue
		}
		id, err := uuid.Parse(s)
		if err != nil {
			return Tenant{}, fmt.Errorf("owner id %q: %w", s, err)
		}
		tn.OwnerAccountIDs = append(tn.OwnerAccountIDs, id)
	}
	return tn, nil
}

// GetTenant reads one tenant; a missing one is ErrUnknownTenant.
func GetTenant(ctx context.Context, control queryer, id uuid.UUID) (Tenant, error) {
	tn, err := scanTenant(control.QueryRowContext(ctx, tenantSQL+` where t.id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Tenant{}, fmt.Errorf("%w: %s", ErrUnknownTenant, id)
	}
	if err != nil {
		return Tenant{}, fmt.Errorf("tenants: get %s: %w", id, err)
	}
	return tn, nil
}

// ErrBadCursor: a cursor that this server did not issue.
var ErrBadCursor = errors.New("tenants: malformed cursor")

// Cursor is the position after the last tenant of a page: (created_at, id), the order of ListTenants.
type Cursor struct {
	CreatedAt time.Time
	ID        uuid.UUID
}

type cursorJSON struct {
	C time.Time `json:"c"`
	I uuid.UUID `json:"i"`
}

// maxCursor bounds a cursor (TenantPage.nextCursor maxLength).
const maxCursor = 2048

// Encode returns the opaque, URL-safe form of c.
func (c Cursor) Encode() string {
	b, _ := json.Marshal(cursorJSON{C: c.CreatedAt.UTC(), I: c.ID}) // a struct of time and uuid always marshals
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor parses a cursor of Encode.
func DecodeCursor(s string) (Cursor, error) {
	if s == "" || len(s) > maxCursor {
		return Cursor{}, ErrBadCursor
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, ErrBadCursor
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil || c.I == uuid.Nil || c.C.IsZero() {
		return Cursor{}, ErrBadCursor
	}
	return Cursor{CreatedAt: c.C, ID: c.I}, nil
}

// ListTenants returns up to limit tenants after the cursor (nil: from the first), ordered by creation and id, and
// the cursor of the next page (nil on the last one).
func ListTenants(ctx context.Context, control queryer, after *Cursor, limit int) ([]Tenant, *Cursor, error) {
	q, args := tenantSQL, []any{limit + 1}
	if after != nil {
		q += ` where (t.created_at, t.id) > ($2, $3)`
		args = append(args, after.CreatedAt, after.ID)
	}
	rows, err := control.QueryContext(ctx, q+` order by t.created_at, t.id limit $1`, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("tenants: list: %w", err)
	}
	defer rows.Close()
	out := make([]Tenant, 0, limit)
	for rows.Next() {
		tn, err := scanTenant(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("tenants: list: %w", err)
		}
		out = append(out, tn)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("tenants: list: %w", err)
	}
	if len(out) <= limit {
		return out, nil, nil
	}
	out = out[:limit]
	last := out[limit-1]
	return out, &Cursor{CreatedAt: last.CreatedAt, ID: last.ID}, nil
}
