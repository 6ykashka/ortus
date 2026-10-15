package inbox

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Notification is a notification as its recipient reads it.
type Notification struct {
	ID        uuid.UUID
	Kind      string
	Severity  string
	Title     string
	Body      *string
	Link      *string
	Object    *Object
	CreatedAt time.Time
	ReadAt    *time.Time
}

// Query selects a page of the feed.
type Query struct {
	UnreadOnly bool
	Cursor     string // NextCursor of the previous page; "" — the first page
	Limit      int    // ≤ 0 — DefaultLimit
}

// DefaultLimit is the page size of a query without a limit (Limit of the contract).
const DefaultLimit = 50

// Page is one page of the feed, newest first.
type Page struct {
	Items      []Notification
	NextCursor string // "" — the last page
	Unread     int64  // unread notifications the person may see now, whatever the filter
}

// Counter is the unread counter of a person in one tenant.
type Counter struct {
	Unread   int64
	LatestAt *time.Time // the latest notification the person may see now; nil — none
}

// Mark selects the notifications to mark as read: exactly one of IDs and UpTo.
type Mark struct {
	IDs  []uuid.UUID
	UpTo *time.Time // everything created up to and including UpTo
}

// Inbox reads the notifications of the person of a tenant context (S1-26, «проверка адресата при доставке»): every
// group «permission × unit × sensitivity» of the person's notifications is checked by the Audience on every call,
// so only what the person may see now is listed, counted and marked.
type Inbox struct {
	Pools    Pools
	Audience Audience
}

// nilUnit stands for «no unit» in the groups of a view (unit_id is null).
const nilUnit = "00000000-0000-0000-0000-000000000000"

const groupsSQL = `
select coalesce(required_permission, ''), coalesce(unit_id, '` + nilUnit + `'::uuid), sensitivity,
       count(*) filter (where read_at is null), max(created_at)
  from notify.notifications
 where recipient_person_id = $1 and archived_at is null
 group by 1, 2, 3`

const policySQL = `select coalesce((select policy_version from access.policy_state), 0)`

// visibleSQL restricts n to the visible groups $2, $3, $4 of a view.
const visibleSQL = `(coalesce(n.required_permission, ''), coalesce(n.unit_id, '` + nilUnit + `'::uuid), n.sensitivity)
       in (select * from unnest($2::text[], $3::uuid[], $4::text[]))`

const listSQL = `
select n.id, n.kind, n.severity, n.title, n.body, n.module_key, n.entity_type, n.entity_id, n.link, n.created_at, n.read_at
  from notify.notifications n
 where n.recipient_person_id = $1 and n.archived_at is null and ` + visibleSQL + `
   and (not $5::bool or n.read_at is null)
   and ($6::timestamptz is null or (n.created_at, n.id) < ($6::timestamptz, $7::uuid))
 order by n.created_at desc, n.id desc
 limit $8`

const markIDsSQL = `
update notify.notifications n set read_at = now()
 where n.recipient_person_id = $1 and n.archived_at is null and n.read_at is null and ` + visibleSQL + `
   and n.id = any($5::uuid[])`

const markUpToSQL = `
update notify.notifications n set read_at = now()
 where n.recipient_person_id = $1 and n.archived_at is null and n.read_at is null and ` + visibleSQL + `
   and n.created_at <= $5::timestamptz`

const unreadSQL = `
select count(*) from notify.notifications n
 where n.recipient_person_id = $1 and n.archived_at is null and n.read_at is null and ` + visibleSQL

// view is what the person may see now: the visible groups (parallel slices for unnest), their unread count and
// latest notification, and the policy version of the tenant (the binding of cursors).
type view struct {
	perms  []string
	units  []uuid.UUID
	sens   []string
	unread int64
	latest *time.Time
	policy int64
}

func (v view) empty() bool { return len(v.perms) == 0 }

// args returns $1…$4 of the queries over the view.
func (v view) args(person uuid.UUID) []any { return []any{person, v.perms, v.units, v.sens} }

type group struct {
	rule   Rule
	unread int64
	latest time.Time
}

func unavailable(what string, err error) error {
	return problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("inbox: %s: %w", what, err))
}

// view reads the groups of the person's notifications and keeps those the audience admits now.
func (in *Inbox) view(ctx context.Context, db DB, tc tenantctx.TenantContext) (view, error) {
	var v view
	if err := db.QueryRow(ctx, policySQL).Scan(&v.policy); err != nil {
		return view{}, unavailable("policy version", err)
	}
	rows, err := db.Query(ctx, groupsSQL, tc.PersonID)
	if err != nil {
		return view{}, unavailable("groups", err)
	}
	groups, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (group, error) {
		var g group
		err := row.Scan(&g.rule.Permission, &g.rule.Unit, &g.rule.Sensitivity, &g.unread, &g.latest)
		return g, err
	})
	if err != nil {
		return view{}, unavailable("groups", err)
	}
	for _, g := range groups {
		ok, err := in.Audience.Admits(ctx, tc, g.rule)
		if err != nil {
			return view{}, err
		}
		if !ok {
			continue
		}
		v.perms, v.units, v.sens = append(v.perms, g.rule.Permission), append(v.units, g.rule.Unit), append(v.sens, g.rule.Sensitivity)
		v.unread += g.unread
		if v.latest == nil || g.latest.After(*v.latest) {
			at := g.latest
			v.latest = &at
		}
	}
	return v, nil
}

// List returns a page of the feed of the person of tc, newest first. A cursor of another selection (tenant,
// person, filter, policy version) or a malformed one is ErrBadCursor.
func (in *Inbox) List(ctx context.Context, tc tenantctx.TenantContext, q Query) (Page, error) {
	pool, err := in.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return Page{}, err
	}
	v, err := in.view(ctx, pool, tc)
	if err != nil {
		return Page{}, err
	}
	bind := binding(tc.TenantID, tc.PersonID, q.UnreadOnly, v.policy)
	var afterAt, afterID any
	if q.Cursor != "" {
		c, err := decodeCursor(q.Cursor)
		if err != nil {
			return Page{}, err
		}
		if c.Binding != bind {
			return Page{}, fmt.Errorf("%w: issued for another selection", ErrBadCursor)
		}
		afterAt, afterID = c.At, c.ID
	}
	page := Page{Items: []Notification{}, Unread: v.unread}
	if v.empty() {
		return page, nil
	}
	limit := q.Limit
	if limit <= 0 {
		limit = DefaultLimit
	}
	rows, err := pool.Query(ctx, listSQL, append(v.args(tc.PersonID), q.UnreadOnly, afterAt, afterID, limit+1)...)
	if err != nil {
		return Page{}, unavailable("list", err)
	}
	items, err := pgx.CollectRows(rows, scanNotification)
	if err != nil {
		return Page{}, unavailable("list", err)
	}
	if len(items) > limit {
		items = items[:limit]
		last := items[limit-1]
		page.NextCursor = cursor{At: last.CreatedAt, ID: last.ID, Binding: bind}.encode()
	}
	page.Items = append(page.Items, items...)
	return page, nil
}

func scanNotification(row pgx.CollectableRow) (Notification, error) {
	var (
		n           Notification
		module, typ *string
		entity      *uuid.UUID
	)
	err := row.Scan(&n.ID, &n.Kind, &n.Severity, &n.Title, &n.Body, &module, &typ, &entity, &n.Link, &n.CreatedAt, &n.ReadAt)
	if module != nil && typ != nil && entity != nil {
		n.Object = &Object{ModuleKey: *module, EntityType: *typ, EntityID: *entity}
	}
	return n, err
}

// Summary returns the unread counter of the person of tc and the time of the latest notification it may see.
func (in *Inbox) Summary(ctx context.Context, tc tenantctx.TenantContext) (Counter, error) {
	pool, err := in.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return Counter{}, err
	}
	v, err := in.view(ctx, pool, tc)
	if err != nil {
		return Counter{}, err
	}
	return Counter{Unread: v.unread, LatestAt: v.latest}, nil
}

// MarkRead marks as read the listed notifications or those created up to m.UpTo, among the unread ones the person
// of tc may see now (ids of other people, of other tenants and of hidden notifications are ignored without
// disclosure; read ones keep their readAt), and returns the unread count after it.
func (in *Inbox) MarkRead(ctx context.Context, tc tenantctx.TenantContext, m Mark) (int64, error) {
	if (len(m.IDs) == 0) == (m.UpTo == nil) {
		return 0, invalid("mark: exactly one of ids and upTo")
	}
	pool, err := in.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return 0, err
	}
	v, err := in.view(ctx, pool, tc)
	if err != nil || v.empty() {
		return 0, err
	}
	sql, arg := markIDsSQL, any(m.IDs)
	if m.UpTo != nil {
		sql, arg = markUpToSQL, *m.UpTo
	}
	var unread int64
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, sql, append(v.args(tc.PersonID), arg)...); err != nil {
			return err
		}
		return tx.QueryRow(ctx, unreadSQL, v.args(tc.PersonID)...).Scan(&unread)
	})
	if err != nil {
		return 0, unavailable("mark read", err)
	}
	return unread, nil
}
