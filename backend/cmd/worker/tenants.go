package main

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// tenantsSQL lists the tenants with a database: every state except provisioning (the database is not ready) and
// closed (it is gone); a suspended, read-only or closing tenant still drains its outbox.
const tenantsSQL = `
select t.id
  from tenants t
  join tenant_routing r on r.tenant_id = t.id
 where t.state::text not in ('provisioning', 'closed')
 order by t.id`

// listTenants returns the tenants whose outbox the worker delivers.
func listTenants(control *pgxpool.Pool) func(ctx context.Context) ([]uuid.UUID, error) {
	return func(ctx context.Context) ([]uuid.UUID, error) {
		rows, err := control.Query(ctx, tenantsSQL)
		if err != nil {
			return nil, fmt.Errorf("tenants: %w", err)
		}
		defer rows.Close()
		var out []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				return nil, fmt.Errorf("tenants: %w", err)
			}
			out = append(out, id)
		}
		return out, rows.Err()
	}
}

// newRegistry lists the consumers of the outbox explicitly (no init()). Stage 1 has none yet: an event without a
// handler is marked delivered. W1.10 (inbox notifications) and W1.07 (realtime) add theirs here.
func newRegistry() *events.Registry {
	return events.NewRegistry()
}
