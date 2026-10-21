package billing

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
)

// Statuses of a request (SubscriptionChangeRequest.status).
const (
	StatusPending   = "pending"
	StatusApproved  = "approved"
	StatusRejected  = "rejected"
	StatusCancelled = "cancelled"
)

// Audit actions of the requests (target type subscription, target id — the tenant) and their details.
const (
	ActionRequested       = "subscription.change_requested"
	ActionRequestCanceled = "subscription.change_request_cancelled"
	ActionApproved        = "subscription.change_approved"
	ActionRejected        = "subscription.change_rejected"
	ActionApplied         = "subscription.change_applied"
	targetSubscription    = "subscription"
	keyRequest            = "request"
	keyTier               = "tier"
	keyTermMonths         = "termMonths"
)

// Texts of the refusals (contract 0.8.0-stage4, MSW billing/plans.ts, platform/pricing.ts).
const (
	detailPending      = "Заявка уже на рассмотрении. Отмените её, чтобы отправить новую."
	detailUnknownTier  = "Выберите тариф из тарифной сетки."
	detailSameTier     = "Этот тариф и срок уже подключены."
	detailBelowUsage   = "В тарифе «%s» %d мест, а занято %d"
	detailRequestCheck = "Проверьте заявку."
	detailDecided      = "Заявка уже рассмотрена."
	detailDecidedOp    = "Заявка уже рассмотрена или отменена."
	detailNote         = "Укажите причину отказа."
	maxComment         = 500
)

// downgradeShift is how far the billing scheduler moves an approved downgrade while the occupied seats exceed its
// limit (as PLAT-06 for storage).
const downgradeShift = 24 * time.Hour

// Notes of an approved change closed before it applied (return 1 of W4.60): a later approval of the tenant replaced
// it, or the tier of the subscription changed since the request (an operator changed it by hand).
const (
	noteSuperseded = "Заменена заявкой "
	noteStale      = "Тариф изменён до срока понижения"
)

// Request is a tier change request (subscription_change_requests) as the operator sees it; the owner's view drops
// DecidedBy of an approval or a rejection.
type Request struct {
	ID                       uuid.UUID
	Number                   string
	TenantID                 uuid.UUID
	TenantName               string
	FromTierCode             *string
	FromTierName             *string
	FromSeatsLimit           *int
	ToTierCode, ToTierName   string
	ToSeatsLimit             *int
	TermMonths, PriceVersion int
	Quote                    *Quote
	SeatsUsed                int
	Comment                  string
	Status                   string
	RequestedAt              time.Time
	RequestedBy              AccountRef
	DecidedAt                *time.Time
	DecidedBy                *AccountRef
	DecisionNote             string
	EffectiveAt, AppliedAt   *time.Time
	Revision                 int64
}

// requestSQL reads requests with their tiers (by the version of the quote), the author, the operator who decided and
// the owner who cancelled.
const requestSQL = `
select r.id, r.number, r.tenant_id, t.display_name, r.from_tier, ft.name, ft.seats_limit, r.to_tier, tt.name, tt.seats_limit,
       r.term_months, r.price_version, r.quoted_minor, r.monthly_minor, r.saving_minor, round(r.discount_pct)::int, r.seats_used,
       coalesce(r.comment, ''), r.status, r.requested_at, ra.id, ra.display_name, r.decided_at, oa.id, oa.display_name, ca.id,
       ca.display_name, coalesce(r.decision_note, ''), r.effective_at, r.applied_at, r.revision
  from subscription_change_requests r
  join tenants t on t.id = r.tenant_id
  left join price_tiers ft on ft.version = r.price_version and ft.tier_code = r.from_tier
  join price_tiers tt on tt.version = r.price_version and tt.tier_code = r.to_tier
  join memberships rm on rm.id = r.requested_by
  join accounts ra on ra.id = rm.account_id
  left join platform_operators o on o.id = r.decided_by
  left join accounts oa on oa.id = o.account_id
  left join memberships cm on cm.id = r.cancelled_by
  left join accounts ca on ca.id = cm.account_id`

type rowScanner interface{ Scan(dest ...any) error }

func scanRequest(row rowScanner) (Request, error) {
	var (
		r                             Request
		from, fromName                sql.NullString
		fromSeats, toSeats            sql.NullInt64
		quoted, monthly, saving       sql.NullInt64
		discount                      sql.NullInt64
		requestedBy                   uuid.UUID
		decidedAt, effective, applied sql.NullTime
		opID, ownerID                 uuid.NullUUID
		opName, ownerName             sql.NullString
	)
	err := row.Scan(&r.ID, &r.Number, &r.TenantID, &r.TenantName, &from, &fromName, &fromSeats, &r.ToTierCode, &r.ToTierName, &toSeats,
		&r.TermMonths, &r.PriceVersion, &quoted, &monthly, &saving, &discount, &r.SeatsUsed, &r.Comment, &r.Status, &r.RequestedAt,
		&requestedBy, &r.RequestedBy.DisplayName, &decidedAt, &opID, &opName, &ownerID, &ownerName, &r.DecisionNote, &effective,
		&applied, &r.Revision)
	if err != nil {
		return Request{}, err
	}
	r.RequestedAt, r.RequestedBy.AccountID = r.RequestedAt.UTC(), &requestedBy
	r.FromTierCode, r.FromTierName = stringOf(from), stringOf(fromName)
	r.FromSeatsLimit, r.ToSeatsLimit = intOf(fromSeats), intOf(toSeats)
	if quoted.Valid && monthly.Valid {
		r.Quote = &Quote{MonthlyMinor: monthly.Int64, PeriodMinor: quoted.Int64, SavingMinor: saving.Int64, DiscountPercent: int(discount.Int64)}
	}
	r.DecidedAt, r.EffectiveAt, r.AppliedAt = timeOf(decidedAt), timeOf(effective), timeOf(applied)
	switch {
	case opID.Valid:
		r.DecidedBy = &AccountRef{AccountID: new(opID.UUID), DisplayName: opName.String}
	case ownerID.Valid:
		r.DecidedBy = &AccountRef{AccountID: new(ownerID.UUID), DisplayName: ownerName.String}
	}
	return r, nil
}

func stringOf(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return new(v.String)
}

func intOf(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	return new(int(v.Int64))
}

func timeOf(v sql.NullTime) *time.Time {
	if !v.Valid {
		return nil
	}
	return new(v.Time.UTC())
}

// request reads one request.
func request(ctx context.Context, q queryer, id uuid.UUID) (Request, error) {
	r, err := scanRequest(q.QueryRowContext(ctx, requestSQL+` where r.id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, fmt.Errorf("billing: request: %w", err)
	}
	return r, nil
}

// RequestQuery is a list of requests: of one tenant for its owner (Owner), of every tenant or of the TenantID filter
// for an operator.
type RequestQuery struct {
	Actor    uuid.UUID
	TenantID *uuid.UUID
	Owner    bool   // the owner's list: pendingCount counts the pending request of the tenant
	Status   string // "" — every status
	Cursor   string
	Limit    int
}

// RequestPage is a page of requests, newest first; PendingCount is the pending requests the reader sees regardless
// of the filter (the badge of the operator menu, 0 or 1 for an owner).
type RequestPage struct {
	Items        []Request
	Next         string
	PendingCount int
}

// Requests lists requests newest first (listSubscriptionChangeRequests, listPlatformSubscriptionRequests); an unknown
// tenant filter is ErrNotFound; the cursor is bound to the reader, the filter and the sort.
func (s Store) Requests(ctx context.Context, q RequestQuery) (RequestPage, error) {
	var tenant any
	if q.TenantID != nil {
		if err := tenantExists(ctx, s.DB, *q.TenantID); err != nil {
			return RequestPage{}, err
		}
		tenant = *q.TenantID
	}
	bind := binding(q.Actor.String(), fmt.Sprint(tenant), q.Status, strconv.FormatBool(q.Owner), "requested_at desc")
	offset, err := decodeCursor(q.Cursor, bind)
	if err != nil {
		return RequestPage{}, err
	}
	limit := max(q.Limit, 1)
	page, err := requestPage(ctx, s.DB, tenant, q.Status, offset, limit)
	if err != nil {
		return RequestPage{}, err
	}
	if len(page.Items) > limit {
		page.Items, page.Next = page.Items[:limit], encodeCursor(offset+limit, bind)
	}
	var pendingOf any
	if q.Owner {
		pendingOf = tenant
	}
	err = s.DB.QueryRowContext(ctx, `select count(*) from subscription_change_requests
 where status = 'pending' and ($1::uuid is null or tenant_id = $1::uuid)`, pendingOf).Scan(&page.PendingCount)
	if err != nil {
		return RequestPage{}, fmt.Errorf("billing: pending requests: %w", err)
	}
	return page, nil
}

// requestPage reads limit + 1 requests from offset (the extra one tells that a next page exists).
func requestPage(ctx context.Context, q queryer, tenant any, status string, offset, limit int) (RequestPage, error) {
	rows, err := q.QueryContext(ctx, requestSQL+`
 where ($1::uuid is null or r.tenant_id = $1::uuid) and ($2 = '' or r.status = $2)
 order by r.requested_at desc, r.id desc
 offset $3 limit $4`, tenant, status, offset, limit+1)
	if err != nil {
		return RequestPage{}, fmt.Errorf("billing: requests: %w", err)
	}
	defer rows.Close()
	page := RequestPage{Items: []Request{}}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			return RequestPage{}, fmt.Errorf("billing: requests: %w", err)
		}
		page.Items = append(page.Items, r)
	}
	if err := rows.Err(); err != nil {
		return RequestPage{}, fmt.Errorf("billing: requests: %w", err)
	}
	return page, nil
}

// Owner is the owner of a tenant acting on its requests (the TenantContext of the gateway).
type Owner struct {
	TenantID, MembershipID, AccountID uuid.UUID
}

// CreateRequest is createSubscriptionChangeRequest.
type CreateRequest struct {
	Owner      Owner
	Tier       string
	TermMonths int
	Comment    *string
	RequestID  string
}

// CreateRequest is the request of the owner for a tier and a term: under the lock of the tenant row — one pending
// request per tenant (409 request_pending), a tier of the version in force (422), no fewer seats than occupied (422
// tier_below_usage), not the paid tier and term already in force (422); the quote of the version in force, the
// occupied seats and the number SR-N are fixed; subscription.change_requested is audited from the owner.
func (s Store) CreateRequest(ctx context.Context, c CreateRequest) (Request, error) {
	comment, err := requestComment(c.Comment)
	if err != nil {
		return Request{}, err
	}
	if !slices.Contains(fixedTerms, c.TermMonths) {
		return Request{}, refuse(CodeValidationFailed, detailRequestCheck, Violation{Field: "termMonths", Code: "terms", Message: termsMessage})
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Request{}, fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	sub, err := s.Subs.Locked(ctx, tx, c.Owner.TenantID)
	if err != nil {
		return Request{}, subscriptionError(err)
	}
	var pending bool
	if err := tx.QueryRowContext(ctx, `select exists (select 1 from subscription_change_requests where tenant_id = $1 and status = 'pending')`,
		c.Owner.TenantID).Scan(&pending); err != nil {
		return Request{}, fmt.Errorf("billing: pending request: %w", err)
	}
	if pending {
		return Request{}, refuse(CodeRequestPending, detailPending)
	}
	id, err := s.insertRequest(ctx, tx, c, sub, comment)
	if err != nil {
		return Request{}, err
	}
	r, err := request(ctx, tx, id)
	if err != nil {
		return Request{}, err
	}
	e := event(audit.PlatformOwner, c.Owner.AccountID, ActionRequested, targetSubscription, c.Owner.TenantID, "", requestIDOf(ctx, c.RequestID),
		map[string]string{keyRequest: r.Number, keyTier: r.ToTierCode, keyTermMonths: strconv.Itoa(r.TermMonths)})
	if err := audit.RecordPlatform(ctx, auditExec{tx}, e); err != nil {
		return Request{}, err
	}
	if err := tx.Commit(); err != nil {
		return Request{}, fmt.Errorf("billing: commit: %w", err)
	}
	return r, nil
}

// requestComment trims the comment of a request ("" — none); longer than 500 characters is 422.
func requestComment(c *string) (string, error) {
	if c == nil {
		return "", nil
	}
	comment := strings.TrimSpace(*c)
	if utf8.RuneCountInString(comment) > maxComment {
		return "", refuse(CodeValidationFailed, detailRequestCheck, Violation{Field: "comment", Code: "length", Message: "Не длиннее 500 символов"})
	}
	return comment, nil
}

// insertRequest checks the tier of c against the version in force and the seats of sub and writes the request.
func (s Store) insertRequest(ctx context.Context, tx *sql.Tx, c CreateRequest, sub subscriptions.Subscription, comment string) (uuid.UUID, error) {
	vs, err := loadVersions(ctx, tx)
	if err != nil {
		return uuid.Nil, err
	}
	now := s.now()
	cur, ok := currentOf(vs, now)
	if !ok {
		return uuid.Nil, errNoVersion
	}
	to, ok := cur.Tier(c.Tier)
	if !ok {
		return uuid.Nil, refuse(CodeValidationFailed, detailUnknownTier, Violation{Field: "tierCode", Code: "tier", Message: "Нет такого тарифа в действующей сетке"})
	}
	seats, err := seatsOf(ctx, tx, sub, vs, now)
	if err != nil {
		return uuid.Nil, err
	}
	if to.SeatsLimit != nil && *to.SeatsLimit < seats.Used() {
		text := fmt.Sprintf(detailBelowUsage, to.Name, *to.SeatsLimit, seats.Used())
		return uuid.Nil, refuse(CodeTierBelowUsage, text, Violation{Field: "tierCode", Code: CodeTierBelowUsage, Message: text})
	}
	if sub.Status == subscriptions.StatusActive && sub.PlanKey == c.Tier && sub.TermMonths != nil && *sub.TermMonths == c.TermMonths {
		return uuid.Nil, refuse(CodeValidationFailed, detailSameTier, Violation{Field: "tierCode", Code: "tier", Message: "Уже подключён"})
	}
	var quoted, monthly, saving, discount any
	if q, ok := QuoteOf(cur, c.Tier, c.TermMonths); ok {
		quoted, monthly, saving, discount = q.PeriodMinor, q.MonthlyMinor, q.SavingMinor, q.DiscountPercent
	}
	id := uuid.New()
	_, err = tx.ExecContext(ctx, `insert into subscription_change_requests (id, tenant_id, from_tier, to_tier, term_months, price_version,
  quoted_minor, monthly_minor, saving_minor, discount_pct, seats_used, comment, requested_by, requested_at)
values ($1, $2, nullif($3, ''), $4, $5, $6, $7, $8, $9, $10, $11, nullif($12, ''), $13, $14)`,
		id, c.Owner.TenantID, sub.PlanKey, c.Tier, c.TermMonths, cur.Number, quoted, monthly, saving, discount, seats.Used(), comment,
		c.Owner.MembershipID, now)
	if err != nil {
		return uuid.Nil, fmt.Errorf("billing: insert request: %w", err)
	}
	return id, nil
}

// CancelRequest is cancelSubscriptionChangeRequest.
type CancelRequest struct {
	Owner     Owner
	ID        uuid.UUID
	RequestID string
}

// CancelRequest cancels a pending request of the tenant of the owner before the operator decides: a request of
// another tenant is ErrNotFound, a decided one 409; subscription.change_request_cancelled is audited from the owner.
func (s Store) CancelRequest(ctx context.Context, c CancelRequest) (Request, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Request{}, fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := lockTenant(ctx, tx, c.Owner.TenantID); err != nil {
		return Request{}, err
	}
	var status, number string
	err = tx.QueryRowContext(ctx, `select status, number from subscription_change_requests where id = $1 and tenant_id = $2 for update`,
		c.ID, c.Owner.TenantID).Scan(&status, &number)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, fmt.Errorf("billing: request: %w", err)
	}
	if status != StatusPending {
		return Request{}, refuse(CodeInvalidTransition, detailDecided)
	}
	now := s.now()
	if _, err := tx.ExecContext(ctx, `update subscription_change_requests
   set status = 'cancelled', cancelled_at = $2, cancelled_by = $3, decided_at = $2, revision = revision + 1
 where id = $1`, c.ID, now, c.Owner.MembershipID); err != nil {
		return Request{}, fmt.Errorf("billing: cancel request: %w", err)
	}
	e := event(audit.PlatformOwner, c.Owner.AccountID, ActionRequestCanceled, targetSubscription, c.Owner.TenantID, "",
		requestIDOf(ctx, c.RequestID), map[string]string{keyRequest: number})
	if err := audit.RecordPlatform(ctx, auditExec{tx}, e); err != nil {
		return Request{}, err
	}
	r, err := request(ctx, tx, c.ID)
	if err != nil {
		return Request{}, err
	}
	if err := tx.Commit(); err != nil {
		return Request{}, fmt.Errorf("billing: commit: %w", err)
	}
	return r, nil
}

// Decision is decidePlatformSubscriptionRequest.
type Decision struct {
	Actor     uuid.UUID // the account of the operator
	ID        uuid.UUID
	Approve   bool
	Note      *string
	RequestID string
}

// action is the audit action of the decision.
func (c Decision) action() string {
	if c.Approve {
		return ActionApproved
	}
	return ActionRejected
}

// Decide approves or rejects a pending request (platform.billing.manage). A rejection needs a note (422). An approval
// fixes when it applies (EffectiveAt): an upgrade at once — the tier, its seats and the terms of the period change
// now (Store.Subs.ChangePlan) and a trial, grace or read_only tenant becomes active; a downgrade at the end of the
// paid period, applied then by ApplyDue. A request that is not pending is 409. Both decisions are audited.
func (s Store) Decide(ctx context.Context, c Decision) (Request, error) {
	reqID := requestIDOf(ctx, c.RequestID)
	tenant, op, note, err := s.decision(ctx, c, reqID)
	if err != nil {
		return Request{}, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Request{}, fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	sub, err := s.Subs.Locked(ctx, tx, tenant)
	if err != nil {
		return Request{}, subscriptionError(err)
	}
	r, err := lockedRequest(ctx, tx, c.ID)
	if err != nil {
		return Request{}, err
	}
	if r.Status != StatusPending {
		return Request{}, refuse(CodeInvalidTransition, detailDecidedOp)
	}
	if err := s.decide(ctx, tx, r, sub, op, c.Approve, note, reqID); err != nil {
		return Request{}, err
	}
	details := map[string]string{keyRequest: r.Number}
	if c.Approve {
		details[keyTier], details[keyTermMonths] = r.ToTierCode, strconv.Itoa(r.TermMonths)
	}
	if err := audit.RecordPlatform(ctx, auditExec{tx}, event(audit.PlatformOperator, c.Actor, c.action(), targetSubscription, tenant, note, reqID, details)); err != nil {
		return Request{}, err
	}
	out, err := request(ctx, tx, c.ID)
	if err != nil {
		return Request{}, err
	}
	if err := tx.Commit(); err != nil {
		return Request{}, fmt.Errorf("billing: commit: %w", err)
	}
	return out, nil
}

// decision finds the tenant of the request (ErrNotFound), checks the role of the operator (ErrForbidden, audited as
// denied) and the note of the decision (422).
func (s Store) decision(ctx context.Context, c Decision, reqID string) (uuid.UUID, operator, string, error) {
	var tenant uuid.UUID
	err := s.DB.QueryRowContext(ctx, `select tenant_id from subscription_change_requests where id = $1`, c.ID).Scan(&tenant)
	if errors.Is(err, sql.ErrNoRows) {
		return uuid.Nil, operator{}, "", ErrNotFound
	}
	if err != nil {
		return uuid.Nil, operator{}, "", fmt.Errorf("billing: request: %w", err)
	}
	op, err := s.authorize(ctx, c.Actor, operators.PermBillingManage, c.action(), targetSubscription, tenant, reqID)
	if err != nil {
		return uuid.Nil, operator{}, "", err
	}
	note, err := decisionNote(c)
	return tenant, op, note, err
}

// decisionNote trims the note of a decision: mandatory on a rejection, up to 500 characters.
func decisionNote(c Decision) (string, error) {
	note := ""
	if c.Note != nil {
		note = strings.TrimSpace(*c.Note)
	}
	switch {
	case !c.Approve && note == "":
		return "", refuse(CodeValidationFailed, detailNote, Violation{Field: "note", Code: "required", Message: "Укажите причину отказа"})
	case utf8.RuneCountInString(note) > maxComment:
		return "", refuse(CodeValidationFailed, detailRequestCheck, Violation{Field: "note", Code: "length", Message: "Не длиннее 500 символов"})
	}
	return note, nil
}

// lockedRequest reads a request under the lock of its row (the tenant row is locked first).
func lockedRequest(ctx context.Context, tx *sql.Tx, id uuid.UUID) (Request, error) {
	var locked uuid.UUID
	err := tx.QueryRowContext(ctx, `select id from subscription_change_requests where id = $1 for update`, id).Scan(&locked)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, ErrNotFound
	}
	if err != nil {
		return Request{}, fmt.Errorf("billing: lock request: %w", err)
	}
	return request(ctx, tx, id)
}

// decide writes the decision of op on r. An approval closes the earlier approved changes of the tenant not applied
// yet (the last decision wins: an older scheduled downgrade never undoes a paid upgrade, two downgrades never race at
// one date) and, when due now, is applied to the subscription at once.
func (s Store) decide(ctx context.Context, tx *sql.Tx, r Request, sub subscriptions.Subscription, op operator, approve bool, note, reqID string) error {
	now := s.now()
	if !approve {
		_, err := tx.ExecContext(ctx, `update subscription_change_requests
   set status = 'rejected', decided_by = $2, decided_at = $3, decision_note = $4, revision = revision + 1
 where id = $1`, r.ID, op.id, now, note)
		if err != nil {
			return fmt.Errorf("billing: reject: %w", err)
		}
		return nil
	}
	var periodEnd *time.Time
	if sub.Status == subscriptions.StatusActive {
		periodEnd = sub.PeriodEndsAt
	}
	effective := EffectiveAt(r.FromSeatsLimit, r.ToSeatsLimit, periodEnd, now)
	if _, err := tx.ExecContext(ctx, `update subscription_change_requests
   set status = 'approved', decided_by = $2, decided_at = $3, decision_note = nullif($4, ''), effective_at = $5, revision = revision + 1
 where id = $1`, r.ID, op.id, now, note, effective); err != nil {
		return fmt.Errorf("billing: approve: %w", err)
	}
	err := closeApproved(ctx, tx, closing{
		tenant: r.TenantID, keep: r.ID, note: noteSuperseded + r.Number, now: now,
		event: func(note string, details map[string]string) audit.PlatformEvent {
			return event(audit.PlatformOperator, op.account, ActionRequestCanceled, targetSubscription, r.TenantID, note, reqID, details)
		},
	})
	if err != nil {
		return err
	}
	if effective.After(now) {
		return nil
	}
	return s.apply(ctx, tx, r, op.account)
}

// closing names the approved changes of a tenant not applied yet that closeApproved closes: every one but keep, or
// only the one request.
type closing struct {
	tenant, keep, only uuid.UUID // keep and only — uuid.Nil when none
	note               string
	now                time.Time
	event              func(note string, details map[string]string) audit.PlatformEvent
}

// closeApproved closes approved changes before they apply. The statuses of a request have no «superseded», so they
// become cancelled with the note (the constraints of control 0002/0007: no decided_by and effective_at for a cancelled
// one; the approval itself stays in platform_audit): cancelled_by is the author of keep — the owner whose newer
// request replaced them — or their own author without one. Each is audited as subscription.change_request_cancelled.
func closeApproved(ctx context.Context, tx *sql.Tx, c closing) error {
	var only any
	if c.only != uuid.Nil {
		only = c.only
	}
	rows, err := tx.QueryContext(ctx, `update subscription_change_requests o
   set status = 'cancelled', cancelled_at = $3,
       cancelled_by = coalesce((select n.requested_by from subscription_change_requests n where n.id = $2), o.requested_by),
       decided_by = null, decided_at = $3, effective_at = null, decision_note = $4, revision = o.revision + 1
 where o.tenant_id = $1 and o.status = 'approved' and o.applied_at is null and o.id <> $2 and ($5::uuid is null or o.id = $5::uuid)
 returning o.number, o.to_tier`, c.tenant, c.keep, c.now, c.note, only)
	if err != nil {
		return fmt.Errorf("billing: close approved: %w", err)
	}
	closed, err := numbersAndTiers(rows)
	if err != nil {
		return fmt.Errorf("billing: close approved: %w", err)
	}
	for _, r := range closed {
		if err := audit.RecordPlatform(ctx, auditExec{tx}, c.event(c.note, map[string]string{keyRequest: r[0], keyTier: r[1]})); err != nil {
			return err
		}
	}
	return nil
}

// numbersAndTiers reads the rows (number, to_tier) of closed requests.
func numbersAndTiers(rows *sql.Rows) ([][2]string, error) {
	defer rows.Close()
	var out [][2]string
	for rows.Next() {
		var number, tier string
		if err := rows.Scan(&number, &tier); err != nil {
			return nil, err
		}
		out = append(out, [2]string{number, tier})
	}
	return out, rows.Err()
}

// apply changes the subscription to the tier and term of r for a paid period that starts now, and marks r applied.
func (s Store) apply(ctx context.Context, tx *sql.Tx, r Request, actor uuid.UUID) error {
	now := s.now()
	seats := int64(subscriptions.UnlimitedSeats)
	if r.ToSeatsLimit != nil {
		seats = int64(*r.ToSeatsLimit)
	}
	var amount *int64
	if r.Quote != nil {
		amount = &r.Quote.PeriodMinor
	}
	if _, err := s.Subs.ChangePlan(ctx, tx, r.TenantID, subscriptions.PlanChange{
		Tier: r.ToTierCode, Seats: seats, TermMonths: r.TermMonths, PriceVersion: r.PriceVersion, AmountMinor: amount,
		PeriodEndsAt: PeriodEnd(now, r.TermMonths), Reason: "Заявка " + r.Number, Actor: actor,
	}); err != nil {
		return subscriptionError(err)
	}
	if _, err := tx.ExecContext(ctx, `update subscription_change_requests set applied_at = $2 where id = $1`, r.ID, now); err != nil {
		return fmt.Errorf("billing: applied: %w", err)
	}
	return nil
}

// ApplyDue applies the approved downgrades due now (the billing scheduler, cmd/api) and returns the tenants whose
// subscription changed: under the lock of the tenant row, a downgrade whose limit the occupied seats exceed moves a
// day further; a downgrade whose tier the subscription no longer has (changed by hand since the request) is closed;
// otherwise the subscription changes and subscription.change_applied is audited from the system. A tenant locked by
// another transaction is skipped until the next run. A request that fails does not stop the run: the others are
// applied and the failures are returned joined (the next run retries them).
func (s Store) ApplyDue(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.DB.QueryContext(ctx, `select id from subscription_change_requests
 where status = 'approved' and applied_at is null and effective_at <= $1 order by effective_at, id`, s.now())
	if err != nil {
		return nil, fmt.Errorf("billing: due requests: %w", err)
	}
	due, err := idsOf(rows)
	if err != nil {
		return nil, fmt.Errorf("billing: due requests: %w", err)
	}
	run, changed := "billing-scheduler:"+uuid.NewString(), []uuid.UUID{}
	var errs []error
	for _, id := range due {
		if ctx.Err() != nil {
			errs = append(errs, ctx.Err())
			break
		}
		tenant, ok, err := s.applyDue(ctx, id, run)
		if err != nil {
			errs = append(errs, fmt.Errorf("billing: apply request %s: %w", id, err))
			continue
		}
		if ok {
			changed = append(changed, tenant)
		}
	}
	return changed, errors.Join(errs...)
}

// applyDue applies one due request (see ApplyDue); ok — the subscription changed.
func (s Store) applyDue(ctx context.Context, id uuid.UUID, run string) (uuid.UUID, bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("billing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	r, ok, err := s.dueRequest(ctx, tx, id)
	if err != nil || !ok {
		return uuid.Nil, false, err
	}
	if later, err := s.notNow(ctx, tx, r, run); err != nil || later {
		if err != nil {
			return uuid.Nil, false, err
		}
		return uuid.Nil, false, tx.Commit()
	}
	if err := s.apply(ctx, tx, r, uuid.Nil); err != nil {
		return uuid.Nil, false, err
	}
	e := event(audit.PlatformSystem, uuid.Nil, ActionApplied, targetSubscription, r.TenantID, "", run,
		map[string]string{keyRequest: r.Number, keyTier: r.ToTierCode, keyTermMonths: strconv.Itoa(r.TermMonths)})
	if err := audit.RecordPlatform(ctx, auditExec{tx}, e); err != nil {
		return uuid.Nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return uuid.Nil, false, fmt.Errorf("billing: commit: %w", err)
	}
	return r.TenantID, true, nil
}

// notNow reports whether a due request r does not apply in this run: closed as stale (closeStale) or moved a day
// further while the occupied seats exceed its limit.
func (s Store) notNow(ctx context.Context, tx *sql.Tx, r Request, run string) (bool, error) {
	if stale, err := s.closeStale(ctx, tx, r, run); err != nil || stale {
		return true, err
	}
	used, err := usedSeats(ctx, tx, r.TenantID)
	if err != nil {
		return false, err
	}
	if r.ToSeatsLimit == nil || used <= *r.ToSeatsLimit {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx, `update subscription_change_requests set effective_at = effective_at + make_interval(secs => $2) where id = $1`,
		r.ID, downgradeShift.Seconds()); err != nil {
		return false, fmt.Errorf("billing: move downgrade: %w", err)
	}
	return true, nil
}

// closeStale closes r when the subscription no longer has the tier r was requested from (an operator changed it by
// hand after the approval): a stale downgrade must not undo that change. Audited from the system.
func (s Store) closeStale(ctx context.Context, tx *sql.Tx, r Request, run string) (bool, error) {
	sub, err := s.Subs.Locked(ctx, tx, r.TenantID)
	if err != nil {
		return false, subscriptionError(err)
	}
	from := ""
	if r.FromTierCode != nil {
		from = *r.FromTierCode
	}
	if from == sub.PlanKey {
		return false, nil
	}
	return true, closeApproved(ctx, tx, closing{
		tenant: r.TenantID, only: r.ID, note: noteStale, now: s.now(),
		event: func(note string, details map[string]string) audit.PlatformEvent {
			return event(audit.PlatformSystem, uuid.Nil, ActionRequestCanceled, targetSubscription, r.TenantID, note, run, details)
		},
	})
}

// dueRequest locks the tenant of a request (skipped while another transaction holds it) and the request, and reports
// whether it is still an approved change due now and not applied.
func (s Store) dueRequest(ctx context.Context, tx *sql.Tx, id uuid.UUID) (Request, bool, error) {
	r, err := request(ctx, tx, id)
	if err != nil {
		return Request{}, false, err
	}
	var locked bool
	err = tx.QueryRowContext(ctx, `select true from tenants where id = $1 for update skip locked`, r.TenantID).Scan(&locked)
	if errors.Is(err, sql.ErrNoRows) {
		return Request{}, false, nil // locked now: the next run takes it
	}
	if err != nil {
		return Request{}, false, fmt.Errorf("billing: lock tenant: %w", err)
	}
	if r, err = lockedRequest(ctx, tx, id); err != nil {
		return Request{}, false, err
	}
	due := r.Status == StatusApproved && r.AppliedAt == nil && r.EffectiveAt != nil && !r.EffectiveAt.After(s.now())
	return r, due, nil
}
