package operators

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
)

// journalSQL reads the platform audit log newest first: $1 — the visible target types (comma-separated), $2 — the
// tenant filter (tenant and subscription rows of one tenant), $3 — the id after which the page starts (0: from the
// newest), $4 — the page size + 1. The names are the current ones: the log does not keep the name at the time.
const journalSQL = `
select a.id, a.at, a.actor_kind, a.actor_id, coalesce(acc.display_name, ''), a.action, a.target_type, a.target_id,
       coalesce(a.reason, ''), a.result, a.details::text,
       coalesce(case when a.target_type in ('tenant', 'subscription') then t.display_name
                     when a.target_type = 'account' then ta.email_norm
                     when a.target_type = 'operator' then oa.display_name end, '')
  from platform_audit a
  left join accounts acc on acc.id = a.actor_id and a.actor_kind <> 'system'
  left join tenants t on t.id = a.target_id and a.target_type in ('tenant', 'subscription')
  left join accounts ta on ta.id = a.target_id and a.target_type = 'account'
  left join platform_operators po on po.id = a.target_id and a.target_type = 'operator'
  left join accounts oa on oa.id = po.account_id
 where a.target_type = any(string_to_array($1, ','))
   and ($2::uuid is null or (a.target_type in ('tenant', 'subscription') and a.target_id = $2::uuid))
   and ($3::bigint = 0 or a.id < $3::bigint)
 order by a.id desc
 limit $4`

// AuditEvents runs listPlatformAuditEvents: the rows the role of the operator may see by target type (filtered
// before the page), of one tenant when TenantID is set (an unknown tenant is tenants.ErrUnknownTenant), newest first.
func (s *Service) AuditEvents(ctx context.Context, q AuditQuery) (AuditPage, error) {
	op, err := lookupOperator(ctx, s.Control, q.ActorID)
	if err != nil {
		return AuditPage{}, err
	}
	types := VisibleTargets(op.role)
	var tenant any
	if q.TenantID != nil {
		if _, err := tenants.GetTenant(ctx, s.Control, *q.TenantID); err != nil {
			return AuditPage{}, err
		}
		tenant = *q.TenantID
		types = slices.DeleteFunc(types, func(t string) bool { return t != TargetTenant && t != TargetSubscription })
	}
	var after int64
	if q.Cursor != "" {
		if after, err = DecodeCursor(q.Cursor, q.ActorID, q.TenantID); err != nil {
			return AuditPage{}, err
		}
	}
	limit := q.Limit
	if limit < 1 {
		limit = defaultLimit
	}
	rows, err := s.Control.QueryContext(ctx, journalSQL, strings.Join(types, ","), tenant, after, limit+1)
	if err != nil {
		return AuditPage{}, fmt.Errorf("operators: journal: %w", err)
	}
	defer rows.Close()
	page := AuditPage{Items: make([]AuditEvent, 0, limit)}
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return AuditPage{}, err
		}
		page.Items = append(page.Items, e)
	}
	if err := rows.Err(); err != nil {
		return AuditPage{}, fmt.Errorf("operators: journal: %w", err)
	}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.Next = EncodeCursor(page.Items[limit-1].ID, q.ActorID, q.TenantID)
	}
	return page, nil
}

func scanEvent(rows *sql.Rows) (AuditEvent, error) {
	var (
		e              AuditEvent
		actor, target  uuid.NullUUID
		details        string
		actorName, tgt string
	)
	if err := rows.Scan(&e.ID, &e.At, &e.ActorKind, &actor, &actorName, &e.Action, &e.TargetType, &target, &e.Reason, &e.Result,
		&details, &tgt); err != nil {
		return AuditEvent{}, fmt.Errorf("operators: journal: %w", err)
	}
	e.At = e.At.UTC()
	if actor.Valid && e.ActorKind != "system" {
		id := actor.UUID
		e.ActorID, e.ActorName = &id, actorName
	}
	e.TargetName = tgt
	if target.Valid {
		id := target.UUID
		switch e.TargetType {
		case TargetTenant:
			e.TargetID, e.TargetTenantID = &id, &id
		case TargetSubscription: // the contract does not expose the id of the subscription
			e.TargetTenantID = &id
		default:
			e.TargetID = &id
		}
	}
	e.Details = PublicDetails([]byte(details))
	return e, nil
}

// errNoRows reports sql.ErrNoRows.
func errNoRows(err error) bool { return errors.Is(err, sql.ErrNoRows) }
