//go:build integration

package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

var now = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)

// world is the platform of the seed W0.12 in small: the operators of «Ортус · Платформа» (two owners, billing,
// support, an invited support and a disabled admin) and client accounts of «Альта», «Лотос» and «Карго».
type world struct {
	t                                           *testing.T
	admin                                       *sql.DB
	svc                                         *Service
	lapteva, sorokin, guseva, pakhomov          uuid.UUID // operator accounts
	valieva, ryabov                             uuid.UUID
	opValieva, opRyabov, opGuseva, opPakhomov   uuid.UUID // platform_operators.id
	zimina, kotova, morozova, petrova, shishkin uuid.UUID
	alta, lotos, cargo                          uuid.UUID
}

func newWorld(t *testing.T) *world {
	t.Helper()
	name := cluster.NewDatabase(t, "accounts")
	admin := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), admin, migrations.Control); err != nil {
		t.Fatal(err)
	}
	w := &world{t: t, admin: admin}
	w.svc = &Service{Control: cluster.DB(t, name, migrations.RoleAPI), Now: func() time.Time { return now }}
	var lap, sor uuid.UUID
	w.lapteva, lap = w.operator("Евгения Лаптева", "e.lapteva@ortus.example", "owner", "active", true, "")
	w.sorokin, sor = w.operator("Михаил Сорокин", "m.sorokin@ortus.example", "owner", "active", true, "")
	w.guseva, w.opGuseva = w.operator("Алёна Гусева", "a.guseva@ortus.example", "billing", "active", true, "")
	w.pakhomov, w.opPakhomov = w.operator("Игорь Пахомов", "i.pakhomov@ortus.example", "support", "active", true, "")
	w.valieva, w.opValieva = w.operator("Дина Валиева", "d.valieva@ortus.example", "support", "invited", false, "")
	w.ryabov, w.opRyabov = w.operator("Станислав Рябов", "s.ryabov@ortus.example", "admin", "disabled", true, "Отключён 15.08: перевод в другой отдел")
	_, _ = lap, sor
	w.alta, w.lotos, w.cargo = w.tenant("Альта Групп", "trial"), w.tenant("SPA «Лотос»", "active"), w.tenant("Карго Сити", "suspended")
	w.zimina = w.client("Дарья Зимина", "d.zimina@alta.example", true, &now)
	w.kotova = w.client("Марина Котова", "m.kotova@alta.example", true, &now)
	w.morozova = w.client("Анна Морозова", "a.morozova@alta.example", false, &now)
	w.petrova = w.client("Олеся Петрова", "o.petrova@alta.example", false, nil)
	w.shishkin = w.client("Денис Шишкин", "d.shishkin@cargo.example", true, new(now.Add(-13*24*time.Hour)))
	w.exec(`update accounts set status = 'locked', locked_at = $2, lock_reason = 'Подозрительные входы из разных стран, 18.09' where id = $1`, w.shishkin, now.Add(-12*24*time.Hour))
	w.member(w.alta, w.zimina, "active", true)
	w.member(w.alta, w.kotova, "active", false)
	w.member(w.cargo, w.kotova, "ended", false)
	w.member(w.alta, w.morozova, "active", false)
	w.member(w.lotos, w.morozova, "active", false)
	w.member(w.alta, w.petrova, "invited", false)
	w.member(w.cargo, w.shishkin, "active", true)
	return w
}

func (w *world) exec(q string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.ExecContext(w.t.Context(), q, args...); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
}

func (w *world) one(q string, args ...any) string {
	w.t.Helper()
	var v sql.NullString
	if err := w.admin.QueryRowContext(w.t.Context(), q, args...).Scan(&v); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

func (w *world) account(name, email string, mfa bool, login *time.Time) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.exec(`insert into accounts (id, issuer, subject, email_norm, display_name, mfa_enabled, last_login_at) values ($1, 'urn:test', $2, $3, $4, $5, $6)`,
		id, id.String(), email, name, mfa, login)
	return id
}

func (w *world) operator(name, email, role, status string, mfa bool, note string) (uuid.UUID, uuid.UUID) {
	w.t.Helper()
	var login *time.Time
	if status != "invited" {
		login = new(now.Add(-time.Hour))
	}
	account, op := w.account(name, email, mfa, login), uuid.New()
	var disabled *time.Time
	if status == "disabled" {
		disabled = new(time.Date(2026, 8, 14, 21, 0, 0, 0, time.UTC))
	}
	w.exec(`insert into platform_operators (id, account_id, role, status, disabled_at, disabled_reason) values ($1, $2, $3, $4, $5, nullif($6, ''))`,
		op, account, role, status, disabled, note)
	return account, op
}

func (w *world) client(name, email string, mfa bool, login *time.Time) uuid.UUID {
	w.t.Helper()
	return w.account(name, email, mfa, login)
}

func (w *world) tenant(name, state string) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.exec(`insert into tenants (id, slug, display_name, industry_pack, state) values ($1, $2, $3, 'custom', $4::tenant_state)`,
		id, "t-"+id.String()[:8], name, state)
	return id
}

func (w *world) member(tenant, account uuid.UUID, status string, owner bool) {
	w.t.Helper()
	id := uuid.New()
	w.exec(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, $4::membership_status, $5)`,
		id, tenant, account, status, uuid.New())
	if owner {
		w.exec(`insert into owner_bindings (tenant_id, membership_id) values ($1, $2)`, tenant, id)
	}
}

func (w *world) session(account uuid.UUID) []byte {
	w.t.Helper()
	hash := []byte(uuid.NewString())
	w.exec(`insert into auth_sessions (id_hash, account_id, csrf_token, provider, auth_time, expires_at) values ($1, $2, 'csrf', '', now(), now() + interval '1 hour')`,
		hash, account)
	return hash
}

func eq[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func refused(t *testing.T, err error, code, detail string) []string {
	t.Helper()
	r, ok := errors.AsType[*RefusalError](err)
	if !ok || r.Code != code || (detail != "" && r.Detail != detail) {
		t.Fatalf("err = %v, want %s %q", err, code, detail)
	}
	out := []string{}
	for _, v := range r.Violations {
		out = append(out, v.Field+":"+v.Code)
	}
	return out
}

func names(p UserPage) []string {
	out := []string{}
	for _, u := range p.Items {
		out = append(out, u.DisplayName)
	}
	return out
}

// Каталог: только аккаунты клиентов (операторов нет), по имени; счётчики фильтров — без самого фильтра; поиск по
// имени, почте и названию организации; организация — участия, которые не завершены; неизвестная — 404.
func TestUsers(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	p, err := w.svc.Users(ctx, UserQuery{Actor: w.lapteva, Limit: 50})
	must(t, err)
	eq(t, "all", names(p), []string{"Анна Морозова", "Дарья Зимина", "Денис Шишкин", "Марина Котова", "Олеся Петрова"})
	eq(t, "counts", p.Counts, Counts{All: 5, MultiTenant: 1, NoMFA: 1, Locked: 1, NeverSignedIn: 1})
	for filter, want := range map[string][]string{
		FilterLocked: {"Денис Шишкин"}, FilterMultiTenant: {"Анна Морозова"}, FilterNeverSignedIn: {"Олеся Петрова"}, FilterNoMFA: {"Анна Морозова"},
	} {
		p, err := w.svc.Users(ctx, UserQuery{Actor: w.lapteva, Filter: filter, Limit: 50})
		must(t, err)
		eq(t, filter, [2]any{names(p), p.Counts.All}, [2]any{want, 5})
	}
	p, err = w.svc.Users(ctx, UserQuery{Actor: w.lapteva, Q: "ЛОТОС", Limit: 50})
	must(t, err)
	eq(t, "by tenant name", names(p), []string{"Анна Морозова"})
	p, err = w.svc.Users(ctx, UserQuery{Actor: w.lapteva, Q: "kotova", Limit: 50})
	must(t, err)
	eq(t, "by e-mail", names(p), []string{"Марина Котова"})
	p, err = w.svc.Users(ctx, UserQuery{Actor: w.lapteva, TenantID: &w.cargo, Limit: 50})
	must(t, err)
	eq(t, "cargo: ended memberships out", [2]any{names(p), p.Counts.All}, [2]any{[]string{"Денис Шишкин"}, 1})
	p, err = w.svc.Users(ctx, UserQuery{Actor: w.lapteva, Limit: 2})
	must(t, err)
	p2, err := w.svc.Users(ctx, UserQuery{Actor: w.lapteva, Limit: 2, Cursor: p.Next})
	must(t, err)
	eq(t, "page 2", names(p2), []string{"Денис Шишкин", "Марина Котова"})
	_, err = w.svc.Users(ctx, UserQuery{Actor: w.sorokin, Limit: 2, Cursor: p.Next})
	eq(t, "cursor of another operator", errors.Is(err, ErrBadCursor), true)
	_, err = w.svc.Users(ctx, UserQuery{Actor: w.lapteva, TenantID: new(uuid.New()), Limit: 50})
	eq(t, "unknown tenant", errors.Is(err, ErrNotFound), true)
}

// Карточка: участия со статусом и отметкой владельца (завершённые тоже), без ролей; аккаунт оператора — 404.
func TestUserCard(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u, err := w.svc.User(t.Context(), w.kotova)
	must(t, err)
	eq(t, "kotova", [4]any{u.Status, u.TenantCount, u.MFA, u.LastSeenAt != nil}, [4]any{UserActive, 1, true, true})
	eq(t, "memberships", u.Memberships, []Membership{
		{TenantID: w.alta, TenantName: "Альта Групп", TenantStatus: "trial", Status: "active"},
		{TenantID: w.cargo, TenantName: "Карго Сити", TenantStatus: "suspended", Status: "ended"},
	})
	s, err := w.svc.User(t.Context(), w.shishkin)
	must(t, err)
	eq(t, "locked", [3]any{s.Status, s.LockReason, s.Memberships[0].Owner}, [3]any{UserSuspended, "Подозрительные входы из разных стран, 18.09", true})
	p, err := w.svc.User(t.Context(), w.petrova)
	must(t, err)
	eq(t, "never signed in", p.Status, UserInvited)
	_, err = w.svc.User(t.Context(), w.lapteva)
	eq(t, "operator", errors.Is(err, ErrNotFound), true)
	_, err = w.svc.User(t.Context(), uuid.New())
	eq(t, "unknown", errors.Is(err, ErrNotFound), true)
}

// Блокировка входа: причина обязательна; сессии аккаунта отзываются; повтор — 409; роль без users.manage — 403
// с записью denied; разблокировка — active или invited; журнал.
func TestLockUnlock(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	sess := w.session(w.zimina)
	_, err := w.svc.LockUser(ctx, Lock{Actor: w.pakhomov, Account: w.zimina, Reason: "  нет "})
	eq(t, "short reason", refused(t, err, "validation_failed", ""), []string{"reason:length"})
	_, err = w.svc.LockUser(ctx, Lock{Actor: w.guseva, Account: w.zimina, Reason: "Потерян телефон", RequestID: "r-denied"})
	eq(t, "billing", errors.Is(err, ErrForbidden), true)
	eq(t, "denied", w.one(`select concat_ws('|', action, result) from platform_audit where request_id = 'r-denied'`), "account.locked|denied")
	u, err := w.svc.LockUser(ctx, Lock{Actor: w.pakhomov, Account: w.zimina, Reason: "Потерян телефон с открытой сессией, 01.10", RequestID: "r-lock"})
	must(t, err)
	eq(t, "locked", [4]any{u.Status, u.LockReason, u.LockedAt != nil && u.LockedAt.Equal(now), len(u.Memberships)},
		[4]any{UserSuspended, "Потерян телефон с открытой сессией, 01.10", true, 1})
	eq(t, "session revoked", w.one(`select (revoked_at is not null)::text from auth_sessions where id_hash = $1`, sess), "true")
	eq(t, "audit", w.one(`select concat_ws('|', action, target_type, target_id, reason) from platform_audit where request_id = 'r-lock'`),
		"account.locked|account|"+w.zimina.String()+"|Потерян телефон с открытой сессией, 01.10")
	_, err = w.svc.LockUser(ctx, Lock{Actor: w.pakhomov, Account: w.zimina, Reason: "Ещё раз, пожалуйста"})
	refused(t, err, "invalid_transition", "Вход уже заблокирован.")
	u, err = w.svc.UnlockUser(ctx, AccountCommand{Actor: w.pakhomov, Account: w.zimina})
	must(t, err)
	eq(t, "unlocked", [3]any{u.Status, u.LockedAt == nil, u.LockReason}, [3]any{UserActive, true, ""})
	_, err = w.svc.UnlockUser(ctx, AccountCommand{Actor: w.pakhomov, Account: w.zimina})
	refused(t, err, "invalid_transition", "Вход не заблокирован.")
	_, err = w.svc.LockUser(ctx, Lock{Actor: w.pakhomov, Account: w.petrova, Reason: "Проверка входа"})
	must(t, err)
	u, err = w.svc.UnlockUser(ctx, AccountCommand{Actor: w.pakhomov, Account: w.petrova})
	must(t, err)
	eq(t, "never signed in → invited", u.Status, UserInvited)
	_, err = w.svc.LockUser(ctx, Lock{Actor: w.pakhomov, Account: w.guseva, Reason: "Оператора не блокируют"})
	eq(t, "operator account", errors.Is(err, ErrNotFound), true)
}

// Сброс второго фактора: флаг снимается; без второго фактора — 409; журнал.
func TestResetMFA(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u, err := w.svc.ResetMFA(t.Context(), AccountCommand{Actor: w.pakhomov, Account: w.zimina, RequestID: "r-mfa"})
	must(t, err)
	eq(t, "mfa", u.MFA, false)
	eq(t, "audit", w.one(`select action from platform_audit where request_id = 'r-mfa'`), "account.mfa_reset")
	_, err = w.svc.ResetMFA(t.Context(), AccountCommand{Actor: w.pakhomov, Account: w.zimina})
	refused(t, err, "invalid_transition", "Второй фактор не настроен.")
}

func operatorNames(p OperatorPage) []string {
	out := []string{}
	for _, o := range p.Items {
		out = append(out, o.DisplayName+":"+o.Role+":"+o.Status)
	}
	return out
}

// Операторы: работающие, приглашённые, отключённые; владельцы, админы, биллинг, поддержка; «это я»; активных
// владельцев — 2; заметка отключённого.
func TestOperators(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	p, err := w.svc.Operators(t.Context(), w.lapteva)
	must(t, err)
	eq(t, "operators", operatorNames(p), []string{
		"Евгения Лаптева:owner:active", "Михаил Сорокин:owner:active", "Алёна Гусева:billing:active", "Игорь Пахомов:support:active",
		"Дина Валиева:support:invited", "Станислав Рябов:admin:disabled",
	})
	eq(t, "me, owners, revision", [3]any{p.Items[0].Me, p.ActiveOwnerCount, p.Items[0].Revision}, [3]any{true, 2, int64(1)})
	eq(t, "mfa", [2]string{p.Items[0].MFA, p.Items[4].MFA}, [2]string{"totp", ""})
	eq(t, "disabled", [2]any{p.Items[5].DisabledReason, p.Items[5].DisabledAt != nil}, [2]any{"Отключён 15.08: перевод в другой отдел", true})
}

// Приглашение: домен платформы, почта оператора — 409, почта клиента — 422 client_account, владельцем не
// приглашают — 422; только владелец платформы; журнал.
func TestInvite(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	o, err := w.svc.Invite(ctx, Invite{Actor: w.lapteva, DisplayName: " Ольга Миронова ", Email: "O.Mironova@ortus.example", Role: "support", RequestID: "r-invite"})
	must(t, err)
	eq(t, "invited", [5]any{o.DisplayName, o.Email, o.Role, o.Status, o.Revision}, [5]any{"Ольга Миронова", "o.mironova@ortus.example", "support", "invited", int64(1)})
	eq(t, "audit", w.one(`select concat_ws('|', action, target_type, target_id, details->>'role') from platform_audit where request_id = 'r-invite'`),
		"operator.invited|operator|"+o.ID.String()+"|support")
	for name, c := range map[string]struct {
		inv          Invite
		code, detail string
		fields       []string
	}{
		"домен":           {Invite{Actor: w.lapteva, DisplayName: "Кто-то", Email: "x@gmail.example", Role: "support"}, "validation_failed", "Проверьте почту оператора.", []string{"email:domain"}},
		"почта оператора": {Invite{Actor: w.lapteva, DisplayName: "Гусева", Email: "a.guseva@ortus.example", Role: "billing"}, "invalid_transition", "Оператор с такой почтой уже есть.", []string{}},
		"владелец":        {Invite{Actor: w.lapteva, DisplayName: "Новый", Email: "new@ortus.example", Role: "owner"}, "validation_failed", "Владельцем платформы назначают уже работающего оператора.", []string{"role:owner_invite"}},
		"пустое имя":      {Invite{Actor: w.lapteva, DisplayName: " ", Email: "new@ortus.example", Role: "support"}, "validation_failed", "", []string{"displayName:required"}},
	} {
		_, err := w.svc.Invite(ctx, c.inv)
		eq(t, name, refused(t, err, c.code, c.detail), c.fields)
	}
	w.client("Клиент на домене платформы", "client@ortus.example", false, nil)
	_, err = w.svc.Invite(ctx, Invite{Actor: w.lapteva, DisplayName: "Клиент", Email: "client@ortus.example", Role: "support"})
	eq(t, "client account", refused(t, err, "validation_failed", "Проверьте почту оператора."), []string{"email:client_account"})
	_, err = w.svc.Invite(ctx, Invite{Actor: w.guseva, DisplayName: "Ещё", Email: "more@ortus.example", Role: "support"})
	eq(t, "billing invites", errors.Is(err, ErrForbidden), true)
}

// Смена роли: If-Match; себя — 409; владелец — только активный со вторым фактором; журнал; ревизия.
func TestUpdateOperatorRole(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	admin := "admin"
	_, err := w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opGuseva, Role: &admin})
	eq(t, "no If-Match", errors.Is(err, ErrRevisionRequired), true)
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opGuseva, IfMatch: `"rev-7"`, Role: &admin})
	eq(t, "stale", errors.Is(err, ErrRevisionMismatch), true)
	o, err := w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opGuseva, IfMatch: `"rev-1"`, Role: &admin, RequestID: "r-role"})
	must(t, err)
	eq(t, "guseva", [3]any{o.Role, o.Revision, o.Me}, [3]any{"admin", int64(2), false})
	eq(t, "audit", w.one(`select concat_ws('|', action, details->>'from', details->>'to') from platform_audit where request_id = 'r-role'`), "operator.role_changed|billing|admin")
	owner := "owner"
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opValieva, IfMatch: `"rev-1"`, Role: &owner})
	eq(t, "invited owner", refused(t, err, "validation_failed", "Владельцем может стать только работающий оператор."), []string{"role:owner_requires_active_mfa"})
	self := w.one(`select id from platform_operators where account_id = $1`, w.lapteva)
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: uuid.MustParse(self), IfMatch: `"rev-1"`, Role: &admin})
	refused(t, err, "invalid_transition", "Свою роль менять нельзя: попросите другого владельца.")
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opGuseva, IfMatch: `"rev-2"`, Role: &admin, Active: new(false)})
	eq(t, "both", refused(t, err, "validation_failed", ""), []string{"active:one_of"})
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.guseva, ID: w.opPakhomov, IfMatch: `"rev-1"`, Role: &admin})
	eq(t, "admin manages operators", errors.Is(err, ErrForbidden), true)
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: uuid.New(), IfMatch: `"rev-1"`, Role: &admin})
	eq(t, "unknown", errors.Is(err, ErrNotFound), true)
}

// Отключение и включение: сессии отключённого и выданный им доступ поддержки отзываются; отзыв приглашения удаляет
// строку; себя отключить нельзя; владелец, которого понизил другой владелец, больше не меняет операторов (403).
func TestUpdateOperatorActive(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	sess := w.session(w.pakhomov)
	w.exec(`insert into support_grants (tenant_id, operator_id, purpose, actions, approved_by, valid) values ($1, $2, 'Проверка', '{fleet.trips.read}',
		(select id from memberships where tenant_id = $1 and account_id = $3), tstzrange(now(), now() + interval '30 minutes'))`, w.alta, w.opPakhomov, w.zimina)
	o, err := w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opPakhomov, IfMatch: `"rev-1"`, Active: new(false), Reason: new("Уволен 01.10"), RequestID: "r-off"})
	must(t, err)
	eq(t, "disabled", [3]any{o.Status, o.DisabledReason, o.DisabledAt != nil}, [3]any{"disabled", "Уволен 01.10", true})
	eq(t, "session and grants", [2]string{
		w.one(`select (revoked_at is not null)::text from auth_sessions where id_hash = $1`, sess),
		w.one(`select bool_and(revoked_at is not null)::text from support_grants where operator_id = $1`, w.opPakhomov),
	}, [2]string{"true", "true"})
	eq(t, "audit", w.one(`select concat_ws('|', action, reason) from platform_audit where request_id = 'r-off'`), "operator.disabled|Уволен 01.10")
	o, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opRyabov, IfMatch: `"rev-1"`, Active: new(true)})
	must(t, err)
	eq(t, "enabled", [3]any{o.Status, o.DisabledAt == nil, o.DisabledReason}, [3]any{"active", true, ""})
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opRyabov, IfMatch: `"rev-2"`, Active: new(true)})
	refused(t, err, "invalid_transition", "Оператор уже работает.")
	o, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: w.opValieva, IfMatch: `"rev-1"`, Active: new(false), RequestID: "r-revoke"})
	must(t, err)
	eq(t, "invitation revoked", [2]any{o.Status, w.one(`select count(*)::text from platform_operators where id = $1`, w.opValieva)}, [2]any{"disabled", "0"})
	eq(t, "audit", w.one(`select action from platform_audit where request_id = 'r-revoke'`), "operator.invitation_revoked")
	self := uuid.MustParse(w.one(`select id from platform_operators where account_id = $1`, w.lapteva))
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: self, IfMatch: `"rev-1"`, Active: new(false)})
	refused(t, err, "invalid_transition", "Себя отключить нельзя.")
	// Гонка двух владельцев (Q-W4.07-15): Лаптева понизила Сорокина — его команда после этого — 403.
	sorokin := uuid.MustParse(w.one(`select id from platform_operators where account_id = $1`, w.sorokin))
	admin := "admin"
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.lapteva, ID: sorokin, IfMatch: `"rev-1"`, Role: &admin})
	must(t, err)
	_, err = w.svc.UpdateOperator(ctx, OperatorChange{Actor: w.sorokin, ID: self, IfMatch: `"rev-1"`, Active: new(false)})
	eq(t, "demoted owner", errors.Is(err, ErrForbidden), true)
}
