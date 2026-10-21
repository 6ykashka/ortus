package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
)

// Audit actions of the operators (target type operator, target id — platform_operators.id).
const (
	ActionInvited           = "operator.invited"
	ActionRoleChanged       = "operator.role_changed"
	ActionDisabled          = "operator.disabled"
	ActionEnabled           = "operator.enabled"
	ActionInvitationRevoked = "operator.invitation_revoked"
	targetOperator          = "operator"
)

// Operator statuses and roles (platform_operators).
const (
	statusActive   = "active"
	statusInvited  = "invited"
	statusDisabled = "disabled"
	roleOwner      = "owner"
	fieldRole      = "role"
)

// roles are the roles of an operator (PlatformOperator.role).
var roles = []string{roleOwner, "admin", "billing", "support"}

// Bounds of PlatformOperatorInvite.
const (
	maxName  = 200
	maxEmail = 254
)

// operatorSQL reads the operators: working ones first, then invited and disabled; by role (owner, admin, billing,
// support), then by name. The kind of the second factor is not stored: a configured one is reported as totp.
const operatorSQL = `
select o.id, o.account_id, a.display_name, a.email_norm, o.role, o.status, a.mfa_enabled, a.last_login_at, o.disabled_at,
       coalesce(o.disabled_reason, ''), o.revision
  from platform_operators o join accounts a on a.id = o.account_id`

const operatorOrder = `
 order by case o.status when 'active' then 0 when 'invited' then 1 else 2 end,
          case o.role when 'owner' then 0 when 'admin' then 1 when 'billing' then 2 else 3 end, a.display_name, o.id`

func scanOperator(row interface{ Scan(dest ...any) error }, me uuid.UUID) (Operator, error) {
	var (
		o              Operator
		mfa            bool
		seen, disabled sql.NullTime
	)
	if err := row.Scan(&o.ID, &o.AccountID, &o.DisplayName, &o.Email, &o.Role, &o.Status, &mfa, &seen, &disabled, &o.DisabledReason, &o.Revision); err != nil {
		return Operator{}, err
	}
	if mfa {
		o.MFA = "totp"
	}
	if seen.Valid {
		o.LastSeenAt = new(seen.Time.UTC())
	}
	if disabled.Valid {
		o.DisabledAt = new(disabled.Time.UTC())
	}
	o.Me = o.AccountID == me
	return o, nil
}

// operatorsOf reads every operator in q; me is the account of the reader.
func operatorsOf(ctx context.Context, q queryer, me uuid.UUID, lock string) ([]Operator, error) {
	rows, err := q.QueryContext(ctx, operatorSQL+operatorOrder+lock)
	if err != nil {
		return nil, fmt.Errorf("accounts: operators: %w", err)
	}
	defer rows.Close()
	out := []Operator{}
	for rows.Next() {
		o, err := scanOperator(rows, me)
		if err != nil {
			return nil, fmt.Errorf("accounts: operators: %w", err)
		}
		out = append(out, o)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("accounts: operators: %w", err)
	}
	return out, nil
}

func activeOwners(ops []Operator) int {
	n := 0
	for _, o := range ops {
		if o.Role == roleOwner && o.Status == statusActive {
			n++
		}
	}
	return n
}

// Operators lists the operators of the platform (listPlatformOperators) with the reader marked and the number of
// active owners.
func (s *Service) Operators(ctx context.Context, me uuid.UUID) (OperatorPage, error) {
	ops, err := operatorsOf(ctx, s.Control, me, "")
	if err != nil {
		return OperatorPage{}, err
	}
	return OperatorPage{Items: ops, ActiveOwnerCount: activeOwners(ops)}, nil
}

// operator reads one operator in q.
func operator(ctx context.Context, q queryer, id, me uuid.UUID) (Operator, error) {
	o, err := scanOperator(q.QueryRowContext(ctx, operatorSQL+` where o.id = $1`, id), me)
	if errors.Is(err, sql.ErrNoRows) {
		return Operator{}, ErrNotFound
	}
	if err != nil {
		return Operator{}, fmt.Errorf("accounts: operator: %w", err)
	}
	return o, nil
}

// checkInvite checks an invitation without the database: a name, an e-mail of the platform domain, a role.
func (s *Service) checkInvite(c Invite) (name, email string, err error) {
	name, email = strings.TrimSpace(c.DisplayName), strings.ToLower(strings.TrimSpace(c.Email))
	switch {
	case runes(name) < 1 || runes(name) > maxName:
		return "", "", refuse(codeValidationFailed, "Укажите имя.", Violation{Field: "displayName", Code: "required", Message: "Укажите имя"})
	case len(email) > maxEmail || !strings.Contains(email, "@") || !strings.HasSuffix(email, "@"+s.domain()):
		return "", "", refuse(codeValidationFailed, "Проверьте почту оператора.", Violation{
			Field: "email", Code: "domain", Message: "Оператором может быть только сотрудник платформы: почта в домене " + s.domain(),
		})
	case !slices.Contains(roles, c.Role):
		return "", "", refuse(codeValidationFailed, "Проверьте роль.", Violation{Field: fieldRole, Code: fieldRole, Message: "Неизвестная роль"})
	}
	return name, email, nil
}

// Invite invites an employee of the platform (platform.operators.manage): an e-mail of the platform domain (422), not
// of an operator (409) nor of a client account (422 client_account), never as owner (422); a separate account waits
// for the first sign-in to the realm ortus-operators; operator.invited is audited.
func (s *Service) Invite(ctx context.Context, c Invite) (Operator, error) {
	name, email, err := s.checkInvite(c)
	if err != nil {
		return Operator{}, err
	}
	reqID := requestIDOf(ctx, c.RequestID)
	a, err := s.authorize(ctx, c.Actor, operators.PermOperatorsManage, ActionInvited, targetOperator, uuid.Nil, reqID)
	if err != nil {
		return Operator{}, err
	}
	tx, err := s.Control.BeginTx(ctx, nil)
	if err != nil {
		return Operator{}, fmt.Errorf("accounts: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	account, err := inviteAccount(ctx, tx, email, name, c.Role)
	if err != nil {
		return Operator{}, err
	}
	id := uuid.New()
	if _, err := tx.ExecContext(ctx, `insert into platform_operators (id, account_id, role, status, invited_by) values ($1, $2, $3, 'invited', $4)`,
		id, account, c.Role, a.op); err != nil {
		return Operator{}, fmt.Errorf("accounts: invite: %w", err)
	}
	if err := recordAudit(ctx, tx, a.event(ActionInvited, targetOperator, id, "", reqID, map[string]string{fieldRole: c.Role})); err != nil {
		return Operator{}, err
	}
	o, err := operator(ctx, tx, id, c.Actor)
	if err != nil {
		return Operator{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operator{}, fmt.Errorf("accounts: commit: %w", err)
	}
	return o, nil
}

// inviteAccount checks the e-mail against the operators and the client accounts and returns the account of the
// invitation (a new one, or the one of an earlier invitation of the same e-mail that was revoked).
func inviteAccount(ctx context.Context, tx *sql.Tx, email, name, role string) (uuid.UUID, error) {
	var operatorMail, clientMail bool
	if err := tx.QueryRowContext(ctx, `select
  exists (select 1 from platform_operators o join accounts a on a.id = o.account_id where a.email_norm = $1),
  exists (select 1 from accounts a where a.email_norm = $1 and a.issuer <> $2
            and not exists (select 1 from platform_operators o where o.account_id = a.id))`, email, invitationIssuer).
		Scan(&operatorMail, &clientMail); err != nil {
		return uuid.Nil, fmt.Errorf("accounts: e-mail: %w", err)
	}
	switch {
	case operatorMail:
		return uuid.Nil, refuse(codeInvalidTransition, "Оператор с такой почтой уже есть.")
	case clientMail:
		return uuid.Nil, refuse(codeValidationFailed, "Проверьте почту оператора.", Violation{
			Field: "email", Code: "client_account",
			Message: "Эта почта уже используется в организации клиента. Для оператора нужен отдельный рабочий аккаунт",
		})
	case role == roleOwner:
		return uuid.Nil, refuse(codeValidationFailed, "Владельцем платформы назначают уже работающего оператора.", Violation{
			Field: fieldRole, Code: "owner_invite", Message: "Владельцем платформы назначают уже работающего оператора",
		})
	}
	var account uuid.UUID
	err := tx.QueryRowContext(ctx, `insert into accounts (issuer, subject, email_norm, display_name) values ($1, $2, $2, $3)
on conflict (issuer, subject) do update set display_name = excluded.display_name returning id`, invitationIssuer, email, name).Scan(&account)
	if err != nil {
		return uuid.Nil, fmt.Errorf("accounts: invitation account: %w", err)
	}
	return account, nil
}

// UpdateOperator changes one operator (platform.operators.manage, If-Match): its role, or active. Under the lock of
// every operator row the author is checked again (a demoted owner — ErrForbidden), and the rules apply: exactly one of
// role and active (422); nobody changes the own role or disables himself (409); only an active operator with a second
// factor becomes owner (422); the last active owner is neither demoted nor disabled (409 last_owner_required). Disabling
// ends the sessions of the operator and revokes the support grants he issued; disabling an invitation removes it.
func (s *Service) UpdateOperator(ctx context.Context, c OperatorChange) (Operator, error) {
	want, etagErr := operators.ParseETag(c.IfMatch)
	if errors.Is(etagErr, operators.ErrRevisionRequired) {
		return Operator{}, ErrRevisionRequired
	}
	reqID := requestIDOf(ctx, c.RequestID)
	if _, err := s.authorize(ctx, c.Actor, operators.PermOperatorsManage, c.action(), targetOperator, c.ID, reqID); err != nil {
		return Operator{}, err
	}
	tx, err := s.Control.BeginTx(ctx, nil)
	if err != nil {
		return Operator{}, fmt.Errorf("accounts: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	ops, err := operatorsOf(ctx, tx, c.Actor, " for update of o")
	if err != nil {
		return Operator{}, err
	}
	author, target, err := parties(ops, c)
	if err != nil {
		return Operator{}, err
	}
	if etagErr != nil || target.Revision != want {
		return Operator{}, ErrRevisionMismatch
	}
	ch := change{tx: tx, c: c, author: author, target: target, owners: activeOwners(ops), now: s.now(), reqID: reqID}
	if err := ch.apply(ctx); err != nil {
		return Operator{}, err
	}
	o, err := ch.result(ctx)
	if err != nil {
		return Operator{}, err
	}
	if err := tx.Commit(); err != nil {
		return Operator{}, fmt.Errorf("accounts: commit: %w", err)
	}
	return o, nil
}

// action is the audit action of an operator change.
func (c OperatorChange) action() string {
	switch {
	case c.Role != nil:
		return ActionRoleChanged
	case c.Active != nil && *c.Active:
		return ActionEnabled
	}
	return ActionDisabled
}

// parties finds the author (still an active owner under the lock, else ErrForbidden) and the target (ErrNotFound) of c.
func parties(ops []Operator, c OperatorChange) (Operator, Operator, error) {
	ai := slices.IndexFunc(ops, func(o Operator) bool { return o.AccountID == c.Actor })
	if ai < 0 || ops[ai].Status != statusActive || !operators.Allowed(ops[ai].Role, operators.PermOperatorsManage) {
		return Operator{}, Operator{}, ErrForbidden
	}
	ti := slices.IndexFunc(ops, func(o Operator) bool { return o.ID == c.ID })
	if ti < 0 {
		return Operator{}, Operator{}, ErrNotFound
	}
	return ops[ai], ops[ti], nil
}

// change is an operator change inside its transaction.
type change struct {
	tx             *sql.Tx
	c              OperatorChange
	author, target Operator
	owners         int
	now            time.Time
	reqID          string
	removed        bool // an invitation was revoked: the row is gone
}

// lastOwner reports whether target is the last active owner of the platform.
func lastOwner(target Operator, owners int) bool {
	return target.Role == roleOwner && target.Status == statusActive && owners <= 1
}

// apply checks the rules and writes the change.
func (ch *change) apply(ctx context.Context) error {
	c := ch.c
	if (c.Role == nil) == (c.Active == nil) {
		return refuse(codeValidationFailed, "Измените роль или состояние — по одному.", Violation{Field: "active", Code: "one_of", Message: "Только роль или состояние"})
	}
	if c.Reason != nil && strings.TrimSpace(*c.Reason) != "" && !validReason(*c.Reason) {
		return refuse(codeValidationFailed, "Проверьте причину.", Violation{Field: "reason", Code: "length", Message: "От 5 до 500 символов"})
	}
	if ch.target.ID == ch.author.ID {
		if c.Role != nil {
			return refuse(codeInvalidTransition, "Свою роль менять нельзя: попросите другого владельца.")
		}
		return refuse(codeInvalidTransition, "Себя отключить нельзя.")
	}
	if c.Role != nil {
		return ch.role(ctx, *c.Role)
	}
	if *c.Active {
		return ch.enable(ctx)
	}
	return ch.disable(ctx)
}

// role changes the role of the target.
func (ch *change) role(ctx context.Context, role string) error {
	t := ch.target
	switch {
	case !slices.Contains(roles, role):
		return refuse(codeValidationFailed, "Проверьте роль.", Violation{Field: fieldRole, Code: fieldRole, Message: "Неизвестная роль"})
	case role == t.Role:
		return ch.bump(ctx)
	case role == roleOwner && (t.Status != statusActive || t.MFA == ""):
		return refuse(codeValidationFailed, "Владельцем может стать только работающий оператор.", Violation{
			Field: fieldRole, Code: "owner_requires_active_mfa", Message: "Владельцем может стать только активный оператор со вторым фактором",
		})
	case lastOwner(t, ch.owners):
		return refuse(codeLastOwnerRequired, "На платформе должен остаться хотя бы один активный владелец.")
	}
	if _, err := ch.tx.ExecContext(ctx, `update platform_operators set role = $2 where id = $1`, t.ID, role); err != nil {
		return fmt.Errorf("accounts: role: %w", err)
	}
	if err := ch.bump(ctx); err != nil {
		return err
	}
	return ch.audit(ctx, ActionRoleChanged, "", map[string]string{"from": t.Role, "to": role})
}

// enable returns a disabled operator to work.
func (ch *change) enable(ctx context.Context) error {
	if ch.target.Status != statusDisabled {
		return refuse(codeInvalidTransition, "Оператор уже работает.")
	}
	if _, err := ch.tx.ExecContext(ctx, `update platform_operators
   set status = 'active', disabled_at = null, disabled_by = null, disabled_reason = null where id = $1`, ch.target.ID); err != nil {
		return fmt.Errorf("accounts: enable: %w", err)
	}
	if err := ch.bump(ctx); err != nil {
		return err
	}
	return ch.audit(ctx, ActionEnabled, "", nil)
}

// disable disables a working operator (his sessions end, the support grants he issued are revoked) or revokes an
// invitation (the row is removed).
func (ch *change) disable(ctx context.Context) error {
	t := ch.target
	reason := ""
	if ch.c.Reason != nil {
		reason = strings.TrimSpace(*ch.c.Reason)
	}
	switch {
	case t.Status == statusDisabled:
		return refuse(codeInvalidTransition, "Оператор уже отключён.")
	case lastOwner(t, ch.owners):
		return refuse(codeLastOwnerRequired, "На платформе должен остаться хотя бы один активный владелец.")
	case t.Status == statusInvited:
		if _, err := ch.tx.ExecContext(ctx, `delete from platform_operators where id = $1`, t.ID); err != nil {
			return fmt.Errorf("accounts: revoke invitation: %w", err)
		}
		ch.removed = true
		return ch.audit(ctx, ActionInvitationRevoked, reason, nil)
	}
	if _, err := ch.tx.ExecContext(ctx, `update platform_operators
   set status = 'disabled', disabled_at = $2, disabled_by = $3, disabled_reason = nullif($4, '') where id = $1`,
		t.ID, ch.now, ch.author.ID, reason); err != nil {
		return fmt.Errorf("accounts: disable: %w", err)
	}
	if err := revokeSessions(ctx, ch.tx, t.AccountID, ch.now); err != nil {
		return err
	}
	if _, err := ch.tx.ExecContext(ctx, `update support_grants set revoked_at = $2 where operator_id = $1 and revoked_at is null`, t.ID, ch.now); err != nil {
		return fmt.Errorf("accounts: revoke support grants: %w", err)
	}
	if err := ch.bump(ctx); err != nil {
		return err
	}
	return ch.audit(ctx, ActionDisabled, reason, nil)
}

// bump increments the revision of the target.
func (ch *change) bump(ctx context.Context) error {
	if _, err := ch.tx.ExecContext(ctx, `update platform_operators set revision = revision + 1 where id = $1`, ch.target.ID); err != nil {
		return fmt.Errorf("accounts: revision: %w", err)
	}
	return nil
}

func (ch *change) audit(ctx context.Context, action, reason string, details map[string]string) error {
	a := actor{op: ch.author.ID, account: ch.author.AccountID, role: ch.author.Role}
	return recordAudit(ctx, ch.tx, a.event(action, targetOperator, ch.target.ID, reason, ch.reqID, details))
}

// result is the operator after the change; a revoked invitation answers its last state, disabled.
func (ch *change) result(ctx context.Context) (Operator, error) {
	if ch.removed {
		o := ch.target
		o.Status, o.DisabledAt, o.Revision = statusDisabled, &ch.now, o.Revision+1
		return o, nil
	}
	return operator(ctx, ch.tx, ch.target.ID, ch.c.Actor)
}
