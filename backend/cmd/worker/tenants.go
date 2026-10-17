package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
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

// registryDeps are what the consumers of the outbox need.
type registryDeps struct {
	control  *pgxpool.Pool    // control DB: memberships of the hints and of the recipients, pg_notify
	pools    *tenantctx.Pools // tenant DBs
	audience inbox.Audience
	log      *slog.Logger
}

// newRegistry lists the consumers of the outbox explicitly (no init()); an event without a handler is marked
// delivered. W1.42 registers those of stage 1:
//   - realtime.Relay (W1.07): access.policy.bumped.v1 → pg_notify → context.changed of the affected accounts;
//   - inbox.Consumer (W1.10) of the owner changes: the notices of the inbox, then notifications.changed.
//
// W1.09 adds the files handlers next to them (registerFiles).
func newRegistry(d registryDeps) *events.Registry {
	reg := events.NewRegistry()
	relay := realtime.Relay{Control: d.control, Notifier: realtime.Notifier{DB: d.control}, Log: d.log}
	relay.Register(reg)
	owners := &inbox.Consumer{
		Name: "notify.inbox.owner", Pools: d.pools, Recipients: inbox.PGRecipients{Control: d.control},
		Audience: d.audience, Route: ownerNotices, Log: d.log,
	}
	reg.Handle(eventOwnerChanged, hinted(owners, func(ctx context.Context, tenantID uuid.UUID, persons []uuid.UUID) error {
		return relay.HintPersons(ctx, tenantID, persons, realtime.TypeNotificationsChanged)
	}))
	return reg
}
