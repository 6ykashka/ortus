package accounts

import (
	"cmp"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
)

// Audit actions of the catalogue (target type account, target id — the account).
const (
	ActionLocked     = "account.locked"
	ActionUnlocked   = "account.unlocked"
	ActionMFAReset   = "account.mfa_reset"
	targetAccount    = "account"
	invitationIssuer = "urn:ortus:operator-invitation" // accounts.issuer of an invited operator before the first sign-in
)

// catalogSQL reads the client accounts (no operator, not deleted, not an invitation of an operator; $2 — one account,
// null — every one) with the number of its memberships that are not ended, the names of its organizations (the
// search; lower-cased in Go, whatever the collation of the database) and whether it has a membership that is not
// ended in the tenant of $1.
const catalogSQL = `
select a.id, a.display_name, a.email_norm, a.status, a.mfa_enabled, a.last_login_at, a.locked_at, coalesce(a.lock_reason, ''),
       count(m.id) filter (where m.status <> 'ended'),
       coalesce(string_agg(t.display_name, E'\n'), ''),
       coalesce(bool_or(m.tenant_id = $1::uuid and m.status <> 'ended'), false)
  from accounts a
  left join memberships m on m.account_id = a.id
  left join tenants t on t.id = m.tenant_id
 where a.status <> 'deleted' and a.issuer <> '` + invitationIssuer + `'
   and not exists (select 1 from platform_operators o where o.account_id = a.id)
   and ($2::uuid is null or a.id = $2::uuid)
 group by a.id`

// entry is an account of the catalogue with what the search and the filters weigh.
type entry struct {
	User
	tenants  string // lower-case names of its organizations, one per line
	inTenant bool
	locked   bool
}

// statusOf is PlatformUser.status: a lock of sign-in — suspended; never signed in — invited; else active.
func statusOf(locked bool, lastLogin *time.Time) string {
	switch {
	case locked:
		return UserSuspended
	case lastLogin == nil:
		return UserInvited
	}
	return UserActive
}

func scanEntry(rows *sql.Rows) (entry, error) {
	var (
		e                entry
		status           string
		login, lockedAt  sql.NullTime
		email, tenantSet string
	)
	if err := rows.Scan(&e.ID, &e.DisplayName, &email, &status, &e.MFA, &login, &lockedAt, &e.LockReason, &e.TenantCount, &tenantSet, &e.inTenant); err != nil {
		return entry{}, fmt.Errorf("accounts: catalogue: %w", err)
	}
	e.Email, e.tenants = email, strings.ToLower(tenantSet)
	if login.Valid {
		e.LastSeenAt = new(login.Time.UTC())
	}
	e.locked = status == "locked" || lockedAt.Valid
	if lockedAt.Valid && e.locked {
		e.LockedAt = new(lockedAt.Time.UTC())
	}
	if !e.locked {
		e.LockReason = ""
	}
	e.Status = statusOf(e.locked, e.LastSeenAt)
	return e, nil
}

// entries reads the catalogue in q (tenant — the organization weighed by inTenant, nil — none; account — one account,
// nil — every one).
func entries(ctx context.Context, q queryer, tenant, account *uuid.UUID) ([]entry, error) {
	var t, a any
	if tenant != nil {
		t = *tenant
	}
	if account != nil {
		a = *account
	}
	rows, err := q.QueryContext(ctx, catalogSQL, t, a)
	if err != nil {
		return nil, fmt.Errorf("accounts: catalogue: %w", err)
	}
	defer rows.Close()
	var out []entry
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("accounts: catalogue: %w", err)
	}
	return out, nil
}

// matches reports whether e passes the filter.
func (e entry) matches(filter string) bool {
	switch filter {
	case FilterMultiTenant:
		return e.TenantCount > 1
	case FilterNoMFA:
		return e.Status == UserActive && !e.MFA
	case FilterLocked:
		return e.locked
	case FilterNeverSignedIn:
		return e.LastSeenAt == nil
	}
	return true
}

// found reports whether e matches the search q (lower case): the name, the e-mail or an organization.
func (e entry) found(q string) bool {
	return q == "" || strings.Contains(strings.ToLower(e.DisplayName), q) || strings.Contains(e.Email, q) || strings.Contains(e.tenants, q)
}

// Users lists the catalogue (listPlatformUsers): the search by name, e-mail or organization (case-insensitive), the
// organization (memberships that are not ended; unknown — ErrNotFound), the filter; the counters are those of the
// search and the organization without the filter; by name. The cursor is bound to the operator and the filters.
//
// Scale (return 1 of W4.60): every call reads the whole catalogue of client accounts with their memberships and
// filters, counts and pages in Go — fine for the pilot (hundreds of accounts), not for real volumes. Before them the
// search (trigram index on display_name and email_norm), the counters and a keyset page move into SQL.
func (s *Service) Users(ctx context.Context, q UserQuery) (UserPage, error) {
	if q.TenantID != nil {
		var exists bool
		if err := s.Control.QueryRowContext(ctx, `select exists (select 1 from tenants where id = $1)`, *q.TenantID).Scan(&exists); err != nil {
			return UserPage{}, fmt.Errorf("accounts: tenant: %w", err)
		}
		if !exists {
			return UserPage{}, ErrNotFound
		}
	}
	search := strings.ToLower(strings.TrimSpace(q.Q))
	bind := binding(q.Actor.String(), search, fmt.Sprint(q.TenantID), q.Filter)
	offset, err := decodeCursor(q.Cursor, bind)
	if err != nil {
		return UserPage{}, err
	}
	all, err := entries(ctx, s.Control, q.TenantID, nil)
	if err != nil {
		return UserPage{}, err
	}
	base := slices.DeleteFunc(all, func(e entry) bool { return (q.TenantID != nil && !e.inTenant) || !e.found(search) })
	page := UserPage{Counts: countsOf(base), Items: []User{}}
	items := slices.DeleteFunc(base, func(e entry) bool { return !e.matches(q.Filter) })
	slices.SortFunc(items, func(a, b entry) int {
		return cmp.Or(cmp.Compare(strings.ToLower(a.DisplayName), strings.ToLower(b.DisplayName)), cmp.Compare(a.ID.String(), b.ID.String()))
	})
	limit := max(q.Limit, 1)
	for _, e := range items[min(offset, len(items)):min(offset+limit, len(items))] {
		page.Items = append(page.Items, e.User)
	}
	if offset+limit < len(items) {
		page.Next = encodeCursor(offset+limit, bind)
	}
	return page, nil
}

// countsOf are the counters of the filter chips of base.
func countsOf(base []entry) Counts {
	c := Counts{All: len(base)}
	for _, e := range base {
		for filter, n := range map[string]*int{
			FilterMultiTenant: &c.MultiTenant, FilterNoMFA: &c.NoMFA, FilterLocked: &c.Locked, FilterNeverSignedIn: &c.NeverSignedIn,
		} {
			if e.matches(filter) {
				*n++
			}
		}
	}
	return c
}

// User reads the card of a client account with every membership (getPlatformUser); an operator account or an unknown
// one is ErrNotFound.
func (s *Service) User(ctx context.Context, id uuid.UUID) (User, error) {
	return card(ctx, s.Control, id)
}

// card reads the card of a client account in q.
func card(ctx context.Context, q queryer, id uuid.UUID) (User, error) {
	es, err := entries(ctx, q, nil, &id)
	if err != nil {
		return User{}, err
	}
	if len(es) == 0 {
		return User{}, ErrNotFound
	}
	u := es[0].User
	if u.Memberships, err = memberships(ctx, q, id); err != nil {
		return User{}, err
	}
	return u, nil
}

// memberships are every membership of an account with its organization and the owner mark, by organization name.
func memberships(ctx context.Context, q queryer, account uuid.UUID) ([]Membership, error) {
	rows, err := q.QueryContext(ctx, `select m.tenant_id, t.display_name, t.state::text, m.status::text,
       exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
  from memberships m join tenants t on t.id = m.tenant_id
 where m.account_id = $1 order by t.display_name, t.id`, account)
	if err != nil {
		return nil, fmt.Errorf("accounts: memberships: %w", err)
	}
	defer rows.Close()
	out := []Membership{}
	for rows.Next() {
		var m Membership
		if err := rows.Scan(&m.TenantID, &m.TenantName, &m.TenantStatus, &m.Status, &m.Owner); err != nil {
			return nil, fmt.Errorf("accounts: memberships: %w", err)
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("accounts: memberships: %w", err)
	}
	return out, nil
}

// LockUser locks the sign-in of a client account (platform.users.manage): a security measure, not non-payment —
// memberships, roles and seats stay; the live sessions of the account end at once; the reason is mandatory (5–500,
// 422); an account already locked is 409; account.locked is audited with the reason.
func (s *Service) LockUser(ctx context.Context, c Lock) (User, error) {
	if !validReason(c.Reason) {
		return User{}, refuse(codeValidationFailed, "Укажите причину блокировки.", Violation{Field: "reason", Code: "length", Message: "Не короче 5 символов"})
	}
	return s.accountCommand(ctx, c.Actor, c.Account, ActionLocked, c.Reason, requestIDOf(ctx, c.RequestID),
		func(ctx context.Context, tx *sql.Tx, a actor, row accountRow, now time.Time) error {
			if row.locked {
				return refuse(codeInvalidTransition, "Вход уже заблокирован.")
			}
			if _, err := tx.ExecContext(ctx, `update accounts set status = 'locked', locked_at = $2, locked_by = $3, lock_reason = $4 where id = $1`,
				row.id, now, a.op, strings.TrimSpace(c.Reason)); err != nil {
				return fmt.Errorf("accounts: lock: %w", err)
			}
			return revokeSessions(ctx, tx, row.id, now)
		})
}

// UnlockUser unlocks the sign-in (platform.users.manage): an account that is not locked is 409; account.unlocked.
func (s *Service) UnlockUser(ctx context.Context, c AccountCommand) (User, error) {
	return s.accountCommand(ctx, c.Actor, c.Account, ActionUnlocked, "", requestIDOf(ctx, c.RequestID),
		flip(func(r accountRow) bool { return r.locked }, "Вход не заблокирован.",
			`update accounts set status = 'active', locked_at = null, locked_by = null, lock_reason = null where id = $1`))
}

// flip is a command of the catalogue that is refused (409) unless ready(row) and otherwise runs one update of the
// account ($1 — its id).
func flip(ready func(accountRow) bool, refusal, update string) func(context.Context, *sql.Tx, actor, accountRow, time.Time) error {
	return func(ctx context.Context, tx *sql.Tx, _ actor, row accountRow, _ time.Time) error {
		if !ready(row) {
			return refuse(codeInvalidTransition, refusal)
		}
		if _, err := tx.ExecContext(ctx, update, row.id); err != nil {
			return fmt.Errorf("accounts: %s: %w", update, err)
		}
		return nil
	}
}

// ResetMFA resets the second factor (platform.users.manage): on the next sign-in the person configures it again; an
// account without one is 409; account.mfa_reset. The factor itself lives at the identity provider (no admin API in
// the stand): the control DB keeps the flag.
func (s *Service) ResetMFA(ctx context.Context, c AccountCommand) (User, error) {
	return s.accountCommand(ctx, c.Actor, c.Account, ActionMFAReset, "", requestIDOf(ctx, c.RequestID),
		flip(func(r accountRow) bool { return r.mfa }, "Второй фактор не настроен.", `update accounts set mfa_enabled = false where id = $1`))
}

// accountRow is the locked row of a client account.
type accountRow struct {
	id          uuid.UUID
	locked, mfa bool
}

// accountCommand runs a command of the catalogue: the role of the operator (platform.users.manage), the lock of the
// account row (an operator account or an unknown one — ErrNotFound), the change, the audit row, the card.
func (s *Service) accountCommand(ctx context.Context, account, target uuid.UUID, action, reason, reqID string,
	change func(ctx context.Context, tx *sql.Tx, a actor, row accountRow, now time.Time) error,
) (User, error) {
	a, err := s.authorize(ctx, account, operators.PermUsersManage, action, targetAccount, target, reqID)
	if err != nil {
		return User{}, err
	}
	tx, err := s.Control.BeginTx(ctx, nil)
	if err != nil {
		return User{}, fmt.Errorf("accounts: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	row := accountRow{id: target}
	var status string
	var lockedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `select a.status, a.locked_at, a.mfa_enabled from accounts a
 where a.id = $1 and a.status <> 'deleted' and a.issuer <> '`+invitationIssuer+`'
   and not exists (select 1 from platform_operators o where o.account_id = a.id) for update`, target).Scan(&status, &lockedAt, &row.mfa)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, fmt.Errorf("accounts: lock account: %w", err)
	}
	row.locked = status == "locked" || lockedAt.Valid
	now := s.now()
	if err := change(ctx, tx, a, row, now); err != nil {
		return User{}, err
	}
	if err := recordAudit(ctx, tx, a.event(action, targetAccount, target, reason, reqID, nil)); err != nil {
		return User{}, err
	}
	u, err := card(ctx, tx, target)
	if err != nil {
		return User{}, err
	}
	if err := tx.Commit(); err != nil {
		return User{}, fmt.Errorf("accounts: commit: %w", err)
	}
	return u, nil
}

// maxCursor bounds a cursor (nextCursor, maxLength 2048).
const maxCursor = 2048

type cursorJSON struct {
	Offset int    `json:"o"`
	Bind   string `json:"b"`
}

func binding(parts ...string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return hex.EncodeToString(sum[:8])
}

func encodeCursor(offset int, bind string) string {
	b, _ := json.Marshal(cursorJSON{Offset: offset, Bind: bind}) // an int and a string always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

// decodeCursor returns the offset of a cursor of the same binding; "" is the first page; anything else ErrBadCursor.
func decodeCursor(s, bind string) (int, error) {
	if s == "" {
		return 0, nil
	}
	if len(s) > maxCursor {
		return 0, ErrBadCursor
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return 0, ErrBadCursor
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil || c.Offset < 1 || c.Bind != bind {
		return 0, ErrBadCursor
	}
	return c.Offset, nil
}
