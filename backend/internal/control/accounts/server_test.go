package accounts

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// The fixtures are the people of the examples of the contract 0.8.0-stage4 (seed W0.12).
var (
	at        = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	alta      = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa")
	cargo     = uuid.MustParse("abdf3e10-8013-5327-af36-1bf84b2b72e7")
	laptevaID = uuid.MustParse("47575a90-6587-584f-bfe6-950866f7810c")
)

func membership(tenant uuid.UUID, name, tenantStatus, status string, owner bool) Membership {
	return Membership{TenantID: tenant, TenantName: name, TenantStatus: tenantStatus, Status: status, Owner: owner}
}

func kotova() User {
	return User{
		ID: uuid.MustParse("b8141e68-f387-5892-a685-e0d881eb3a40"), DisplayName: "Марина Котова", Email: "m.kotova@alta.example",
		Status: UserActive, LastSeenAt: new(time.Date(2026, 10, 1, 5, 40, 0, 0, time.UTC)), TenantCount: 1, MFA: true,
		Memberships: []Membership{
			membership(alta, "Альта Групп", "trial", "active", false), membership(cargo, "Карго Сити", "suspended", "ended", false),
		},
	}
}

func shishkin() User {
	return User{
		ID: uuid.MustParse("60ad451f-8c47-5194-9224-f8918e54416f"), DisplayName: "Денис Шишкин", Email: "d.shishkin@cargo.example",
		Status: UserSuspended, LastSeenAt: new(time.Date(2026, 9, 18, 20, 51, 0, 0, time.UTC)), TenantCount: 1, MFA: true,
		LockedAt: new(time.Date(2026, 9, 18, 21, 10, 0, 0, time.UTC)), LockReason: "Подозрительные входы из разных стран, 18.09",
		Memberships: []Membership{membership(cargo, "Карго Сити", "suspended", "active", true)},
	}
}

func operatorsPage() OperatorPage {
	op := func(id, account, name, email, role, status, mfa string, seen *time.Time) Operator {
		return Operator{
			ID: uuid.MustParse(id), AccountID: uuid.MustParse(account), DisplayName: name, Email: email, Role: role, Status: status, MFA: mfa,
			LastSeenAt: seen, Revision: 1,
		}
	}
	day := func(m time.Month, d, h, mi int) *time.Time {
		return new(time.Date(2026, m, d, h, mi, 0, 0, time.UTC))
	}
	items := []Operator{
		op("06fc21fb-6f58-541b-997a-5742de57a34d", laptevaID.String(), "Евгения Лаптева", "e.lapteva@ortus.example", "owner", "active", "webauthn", day(10, 2, 6, 5)),
		op("e572fef9-de74-5449-bf76-06cf6133e4d5", "b7ba8c18-52cf-5f8d-ba2b-eca902ee08fd", "Михаил Сорокин", "m.sorokin@ortus.example", "owner", "active", "totp", day(10, 1, 15, 22)),
		op("75d16aed-a03a-5d64-893d-e6b091f64efc", "93eb088d-4244-5c59-a8c1-e74afd312434", "Алёна Гусева", "a.guseva@ortus.example", "billing", "active", "totp", day(10, 2, 5, 40)),
		op("42f84478-f394-5e04-be48-fa5e6c11a0db", "19b57393-3886-5036-bf61-6b55db1ebf45", "Игорь Пахомов", "i.pakhomov@ortus.example", "support", "active", "totp", day(10, 2, 4, 58)),
		op("64e60d7a-2d02-5ab8-87c9-fdf671c2dbee", "a23949ec-8374-5be0-b96b-89329ccf4bb7", "Дина Валиева", "d.valieva@ortus.example", "support", "invited", "", nil),
		op("db0c0485-cd46-5acb-8a4e-3504759d7b0b", "952ed476-a887-5c63-b984-335701927b32", "Станислав Рябов", "s.ryabov@ortus.example", "admin", "disabled", "totp", day(8, 12, 14, 10)),
	}
	items[0].Me = true
	items[5].DisabledAt, items[5].DisabledReason = day(8, 14, 21, 0), "Отключён 15.08: перевод в другой отдел"
	return OperatorPage{Items: items, ActiveOwnerCount: 2}
}

// fake answers with its fields and records the commands.
type fake struct {
	page    UserPage
	user    User
	ops     OperatorPage
	op      Operator
	err     error
	query   UserQuery
	lock    Lock
	command AccountCommand
	invite  Invite
	change  OperatorChange
	reader  uuid.UUID
}

func (f *fake) Users(_ context.Context, q UserQuery) (UserPage, error) {
	f.query = q
	return f.page, f.err
}
func (f *fake) User(_ context.Context, id uuid.UUID) (User, error) {
	f.command.Account = id
	return f.user, f.err
}
func (f *fake) LockUser(_ context.Context, c Lock) (User, error) { f.lock = c; return f.user, f.err }
func (f *fake) UnlockUser(_ context.Context, c AccountCommand) (User, error) {
	f.command = c
	return f.user, f.err
}
func (f *fake) ResetMFA(_ context.Context, c AccountCommand) (User, error) {
	f.command = c
	return f.user, f.err
}
func (f *fake) Operators(_ context.Context, me uuid.UUID) (OperatorPage, error) {
	f.reader = me
	return f.ops, f.err
}
func (f *fake) Invite(_ context.Context, c Invite) (Operator, error) {
	f.invite = c
	return f.op, f.err
}
func (f *fake) UpdateOperator(_ context.Context, c OperatorChange) (Operator, error) {
	f.change = c
	return f.op, f.err
}

func ctxOf(t *testing.T) context.Context {
	t.Helper()
	return session.WithSession(t.Context(), session.Session{AccountID: laptevaID})
}

func example(t *testing.T, op, name string) string {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "..", "api", "openapi", "examples", op))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile(name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return canonical(t, raw, false)
}

func canonical(t *testing.T, raw []byte, withoutRequestID bool) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if m, ok := v.(map[string]any); ok && withoutRequestID {
		delete(m, "requestId")
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func jsonOf(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return canonical(t, raw, false)
}

func problemJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return canonical(t, raw, true)
}

func same(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s\n got %s\nwant %s", what, got, want)
	}
}

func eqv[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

func problemOf(err error) [2]string {
	pe, ok := errors.AsType[*problem.Error](err)
	if !ok {
		return [2]string{}
	}
	return [2]string{pe.Code, pe.Detail}
}

// Каталог: страница со счётчиками = пример locked (фильтр, организация, поиск доходят до сервиса); неверные
// параметры — 400.
func TestListPlatformUsers(t *testing.T) {
	t.Parallel()
	u := shishkin()
	u.Memberships = nil
	f := &fake{page: UserPage{Items: []User{u}, Counts: Counts{All: 58, MultiTenant: 2, NoMFA: 36, Locked: 1, NeverSignedIn: 2}}}
	srv := Server{Service: f}
	filter := platformapi.ListPlatformUsersParamsFilter("locked")
	resp, err := srv.ListPlatformUsers(ctxOf(t), platformapi.ListPlatformUsersRequestObject{Params: platformapi.ListPlatformUsersParams{
		Filter: &filter, TenantId: &cargo, Q: new(" Шиш "), Limit: new(20), Cursor: new("c"),
	}})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(platformapi.ListPlatformUsers200JSONResponse)
	same(t, "locked", jsonOf(t, ok.Body), example(t, "listPlatformUsers", "locked"))
	eqv(t, "query", f.query, UserQuery{Actor: laptevaID, Q: " Шиш ", TenantID: &cargo, Filter: "locked", Cursor: "c", Limit: 20})
	for name, p := range map[string]platformapi.ListPlatformUsersParams{
		"фильтр":    {Filter: new(platformapi.ListPlatformUsersParamsFilter("vip"))},
		"пустой q":  {Q: new("")},
		"limit 300": {Limit: new(300)},
	} {
		_, err := srv.ListPlatformUsers(ctxOf(t), platformapi.ListPlatformUsersRequestObject{Params: p})
		eqv(t, name, problem.Is(err, problem.CodeMalformedRequest), true)
	}
	f.err = ErrNotFound
	_, err = srv.ListPlatformUsers(ctxOf(t), platformapi.ListPlatformUsersRequestObject{})
	eqv(t, "unknown tenant", problem.Is(err, problem.CodeNotFound), true)
}

// Карточка и команды каталога: тела = примеры; отказы — коды и тексты.
func TestUserCardAndCommands(t *testing.T) {
	t.Parallel()
	f := &fake{user: kotova()}
	srv := Server{Service: f}
	resp, err := srv.GetPlatformUser(ctxOf(t), platformapi.GetPlatformUserRequestObject{AccountId: kotova().ID})
	if err != nil {
		t.Fatal(err)
	}
	gok, _ := resp.(platformapi.GetPlatformUser200JSONResponse)
	same(t, "card", jsonOf(t, gok.Body), example(t, "getPlatformUser", "ok"))
	f.user = shishkin()
	resp, _ = srv.GetPlatformUser(ctxOf(t), platformapi.GetPlatformUserRequestObject{AccountId: shishkin().ID})
	gok, _ = resp.(platformapi.GetPlatformUser200JSONResponse)
	same(t, "locked card", jsonOf(t, gok.Body), example(t, "getPlatformUser", "locked"))

	vasiliev := User{
		ID: uuid.MustParse("3a6fb150-d26a-5454-b74b-22ce783af784"), DisplayName: "Илья Васильев", Email: "i.vasiliev@alta.example",
		Status: UserSuspended, LastSeenAt: new(time.Date(2026, 10, 1, 4, 55, 0, 0, time.UTC)), TenantCount: 1, LockedAt: &at,
		LockReason: "Потерян телефон с открытой сессией, 01.10", Memberships: []Membership{membership(alta, "Альта Групп", "trial", "active", false)},
	}
	f.user = vasiliev
	lresp, err := srv.LockPlatformUser(ctxOf(t), platformapi.LockPlatformUserRequestObject{AccountId: vasiliev.ID,
		Body: &platformapi.PlatformUserLock{Reason: vasiliev.LockReason}})
	if err != nil {
		t.Fatal(err)
	}
	lok, _ := lresp.(platformapi.LockPlatformUser200JSONResponse)
	same(t, "lock", jsonOf(t, lok.Body), example(t, "lockPlatformUser", "ok"))
	eqv(t, "lock command", f.lock, Lock{Actor: laptevaID, Account: vasiliev.ID, Reason: vasiliev.LockReason})

	unlocked := shishkin()
	unlocked.Status, unlocked.LockedAt, unlocked.LockReason = UserActive, nil, ""
	f.user = unlocked
	uresp, err := srv.UnlockPlatformUser(ctxOf(t), platformapi.UnlockPlatformUserRequestObject{AccountId: unlocked.ID})
	if err != nil {
		t.Fatal(err)
	}
	uok, _ := uresp.(platformapi.UnlockPlatformUser200JSONResponse)
	same(t, "unlock", jsonOf(t, uok.Body), example(t, "unlockPlatformUser", "ok"))

	zimina := User{
		ID: uuid.MustParse("0281a55e-725e-53b1-920f-4189ab46e08a"), DisplayName: "Дарья Зимина", Email: "d.zimina@alta.example",
		Status: UserActive, LastSeenAt: new(time.Date(2026, 10, 1, 6, 12, 0, 0, time.UTC)), TenantCount: 1,
		Memberships: []Membership{membership(alta, "Альта Групп", "trial", "active", true)},
	}
	f.user = zimina
	mresp, err := srv.ResetPlatformUserMfa(ctxOf(t), platformapi.ResetPlatformUserMfaRequestObject{AccountId: zimina.ID})
	if err != nil {
		t.Fatal(err)
	}
	mok, _ := mresp.(platformapi.ResetPlatformUserMfa200JSONResponse)
	same(t, "mfa-reset", jsonOf(t, mok.Body), example(t, "resetPlatformUserMfa", "ok"))

	f.err = &RefusalError{Code: "invalid_transition", Detail: "Вход уже заблокирован."}
	_, err = srv.LockPlatformUser(ctxOf(t), platformapi.LockPlatformUserRequestObject{AccountId: zimina.ID, Body: &platformapi.PlatformUserLock{Reason: "Ещё раз"}})
	eqv(t, "already locked", problemOf(err), [2]string{"invalid_transition", "Вход уже заблокирован."})
	f.err = &RefusalError{Code: "validation_failed", Detail: "Укажите причину блокировки.", Violations: []Violation{{Field: "reason", Code: "length", Message: "Не короче 5 символов"}}}
	lresp, err = srv.LockPlatformUser(ctxOf(t), platformapi.LockPlatformUserRequestObject{AccountId: zimina.ID, Body: &platformapi.PlatformUserLock{Reason: "нет"}})
	if err != nil {
		t.Fatal(err)
	}
	refused, _ := lresp.(platformapi.LockPlatformUser422ApplicationProblemPlusJSONResponse)
	same(t, "reason", problemJSON(t, refused.Body), canonical(t, []byte(example(t, "lockPlatformUser", "validation_failed")), true))
	f.err = ErrForbidden
	_, err = srv.ResetPlatformUserMfa(ctxOf(t), platformapi.ResetPlatformUserMfaRequestObject{AccountId: zimina.ID})
	eqv(t, "role", problem.Is(err, problem.CodeForbiddenAction), true)
}

// Операторы: список, приглашение и изменение — тела = примеры; ETag «rev-N»; If-Match и тело доходят до сервиса;
// отказы 409/412/428/422 — коды примеров.
func TestOperatorsServer(t *testing.T) {
	t.Parallel()
	f := &fake{ops: operatorsPage()}
	srv := Server{Service: f}
	resp, err := srv.ListPlatformOperators(ctxOf(t), platformapi.ListPlatformOperatorsRequestObject{})
	if err != nil {
		t.Fatal(err)
	}
	lok, _ := resp.(platformapi.ListPlatformOperators200JSONResponse)
	same(t, "list", jsonOf(t, lok.Body), example(t, "listPlatformOperators", "ok"))
	eqv(t, "reader", f.reader, laptevaID)

	f.op = Operator{
		ID: uuid.MustParse("a246f07b-5c1b-50c3-b7a6-95cd28c04445"), AccountID: uuid.MustParse("495958c4-cca8-595c-9028-e8eb0c168d80"),
		DisplayName: "Ольга Миронова", Email: "o.mironova@ortus.example", Role: "support", Status: "invited", Revision: 1,
	}
	iresp, err := srv.InvitePlatformOperator(ctxOf(t), platformapi.InvitePlatformOperatorRequestObject{Body: &platformapi.PlatformOperatorInvite{
		DisplayName: "Ольга Миронова", Email: "o.mironova@ortus.example", Role: "support",
	}})
	if err != nil {
		t.Fatal(err)
	}
	iok, _ := iresp.(platformapi.InvitePlatformOperator201JSONResponse)
	same(t, "invite", jsonOf(t, iok.Body), example(t, "invitePlatformOperator", "ok"))
	eqv(t, "etag", *iok.Headers.ETag, `"rev-1"`)
	eqv(t, "invite command", f.invite, Invite{Actor: laptevaID, DisplayName: "Ольга Миронова", Email: "o.mironova@ortus.example", Role: "support"})

	guseva := operatorsPage().Items[2]
	guseva.Role, guseva.Revision = "admin", 2
	f.op = guseva
	role := platformapi.PlatformOperatorPatchRole("admin")
	uresp, err := srv.UpdatePlatformOperator(ctxOf(t), platformapi.UpdatePlatformOperatorRequestObject{OperatorId: guseva.ID,
		Params: platformapi.UpdatePlatformOperatorParams{IfMatch: `"rev-1"`}, Body: &platformapi.PlatformOperatorPatch{Role: &role}})
	if err != nil {
		t.Fatal(err)
	}
	uok, _ := uresp.(platformapi.UpdatePlatformOperator200JSONResponse)
	same(t, "update", jsonOf(t, uok.Body), example(t, "updatePlatformOperator", "ok"))
	eqv(t, "update command", [3]any{f.change.IfMatch, *f.change.Role, f.change.ID}, [3]any{`"rev-1"`, "admin", guseva.ID})
	eqv(t, "etag", *uok.Headers.ETag, `"rev-2"`)

	for name, c := range map[string]struct {
		err  error
		code string
	}{
		"последний владелец": {&RefusalError{Code: "last_owner_required", Detail: "На платформе должен остаться хотя бы один активный владелец."}, "last_owner_required"},
		"ревизия":            {ErrRevisionMismatch, "revision_mismatch"},
		"без If-Match":       {ErrRevisionRequired, "revision_required"},
		"нет оператора":      {ErrNotFound, problem.CodeNotFound},
	} {
		f.err = c.err
		_, err := srv.UpdatePlatformOperator(ctxOf(t), platformapi.UpdatePlatformOperatorRequestObject{OperatorId: guseva.ID, Body: &platformapi.PlatformOperatorPatch{Role: &role}})
		eqv(t, name, problemOf(err)[0], c.code)
	}
	f.err = &RefusalError{Code: "validation_failed", Detail: "Владельцем может стать только работающий оператор.", Violations: []Violation{
		{Field: "role", Code: "owner_requires_active_mfa", Message: "Владельцем может стать только активный оператор со вторым фактором"},
	}}
	uresp, err = srv.UpdatePlatformOperator(ctxOf(t), platformapi.UpdatePlatformOperatorRequestObject{OperatorId: guseva.ID, Body: &platformapi.PlatformOperatorPatch{Role: &role}})
	if err != nil {
		t.Fatal(err)
	}
	refused, _ := uresp.(platformapi.UpdatePlatformOperator422ApplicationProblemPlusJSONResponse)
	same(t, "owner", problemJSON(t, refused.Body), canonical(t, []byte(example(t, "updatePlatformOperator", "validation_failed")), true))
	f.err = &RefusalError{Code: "validation_failed", Detail: "Проверьте почту оператора.", Violations: []Violation{
		{Field: "email", Code: "domain", Message: "Оператором может быть только сотрудник платформы: почта в домене ortus.example"},
	}}
	iresp, err = srv.InvitePlatformOperator(ctxOf(t), platformapi.InvitePlatformOperatorRequestObject{Body: &platformapi.PlatformOperatorInvite{
		DisplayName: "Кто-то", Email: "x@gmail.example", Role: "support",
	}})
	if err != nil {
		t.Fatal(err)
	}
	irefused, _ := iresp.(platformapi.InvitePlatformOperator422ApplicationProblemPlusJSONResponse)
	same(t, "domain", problemJSON(t, irefused.Body), canonical(t, []byte(example(t, "invitePlatformOperator", "validation_failed")), true))
}
