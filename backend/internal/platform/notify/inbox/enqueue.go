package inbox

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// DB is a pgx pool, connection or transaction of a tenant DB.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Outcome is what Enqueue did.
type Outcome int

// Outcomes of Enqueue.
const (
	Enqueued      Outcome = iota + 1 // a row was written
	Duplicate                        // the recipient already has the notification of this source event
	NotInAudience                    // the recipient may not receive it now: nothing was written
)

func (o Outcome) String() string {
	switch o {
	case Enqueued:
		return "enqueued"
	case Duplicate:
		return "duplicate"
	case NotInAudience:
		return "not in audience"
	}
	return fmt.Sprintf("outcome(%d)", int(o))
}

const liveSQL = `select exists (select 1 from people.person_profiles where id = $1 and archived_at is null)`

const insertSQL = `
insert into notify.notifications (recipient_person_id, kind, severity, title, body, module_key, entity_type, entity_id,
                                  link, unit_id, sensitivity, required_permission, source_event_id)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
on conflict (recipient_person_id, source_event_id) do nothing
returning id`

// Enqueue writes n for the person of to through db, the transaction of the producer (the same tenant DB as
// to.TenantID). The recipient is checked first (S1-26, «проверка адресата при постановке»): a live person profile
// and aud admitting the rule of n now. A recipient outside the audience is NotInAudience — not an error, nothing
// is written. A second notice of the same source event for the same person is Duplicate. An invalid notice or a
// context without a person is an error wrapping ErrInvalid.
func Enqueue(ctx context.Context, db DB, aud Audience, to tenantctx.TenantContext, n Notice) (Outcome, uuid.UUID, error) {
	n, err := n.normalized()
	if err != nil {
		return 0, uuid.Nil, err
	}
	if to.PersonID == uuid.Nil || to.TenantID == uuid.Nil {
		return 0, uuid.Nil, invalid("a recipient without a tenant or a person")
	}
	var live bool
	if err := db.QueryRow(ctx, liveSQL, to.PersonID).Scan(&live); err != nil {
		return 0, uuid.Nil, fmt.Errorf("inbox: recipient profile: %w", err)
	}
	if !live {
		return NotInAudience, uuid.Nil, nil
	}
	ok, err := aud.Admits(ctx, to, n.rule())
	if err != nil {
		return 0, uuid.Nil, fmt.Errorf("inbox: audience: %w", err)
	}
	if !ok {
		return NotInAudience, uuid.Nil, nil
	}
	var id uuid.UUID
	err = db.QueryRow(ctx, insertSQL, append([]any{to.PersonID}, n.columns()...)...).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return Duplicate, uuid.Nil, nil
	case err != nil:
		return 0, uuid.Nil, fmt.Errorf("inbox: enqueue %s: %w", n.Kind, err)
	}
	return Enqueued, id, nil
}

// columns returns the values of insertSQL after the recipient; empty optional fields are NULL.
func (n Notice) columns() []any {
	var module, typ, entity any
	if n.Object != nil {
		module, typ, entity = n.Object.ModuleKey, n.Object.EntityType, n.Object.EntityID
	}
	return []any{
		n.Kind, n.Severity, n.Title, nullable(n.Body), module, typ, entity, nullable(n.Link),
		nullableID(n.Unit), n.Sensitivity, nullable(n.Permission), nullableID(n.SourceEvent),
	}
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
