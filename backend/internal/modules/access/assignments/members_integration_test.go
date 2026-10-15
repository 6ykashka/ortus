//go:build integration

package assignments_test

// W1.43 (Q-W1.05-11): updateMember — приостановка и восстановление участника, последний владелец, места тарифа,
// завершение сессий приостановленного, перенос в подразделение и набор рабочих функций.

import (
	"crypto/rand"
	"slices"
	"strconv"
	"testing"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// hr is a member with the role «Кадры» (members.read, members.manage) over the region Москва with its subtree.
func (w *world) hr(t *testing.T) tenantctx.TenantContext {
	t.Helper()
	person := w.Member("Кадровик", "hr@alta.example", w.region)
	role := w.Role("Кадры", "custom", "", "members.read", "members.manage")
	w.Assign(accesstest.Grant{Principal: person, Role: role, Kind: "unit", Ref: w.region, Descendants: true})
	return w.TC(person)
}

func (w *world) revision(t *testing.T, person uuid.UUID) int64 {
	t.Helper()
	var rev int64
	if err := w.Tenant.QueryRow(t.Context(), `select revision from people.person_profiles where id = $1`, person).Scan(&rev); err != nil {
		t.Fatal(err)
	}
	return rev
}

func etag(rev int64) string { return `"` + strconv.FormatInt(rev, 10) + `"` }

// patchMember calls updateMember as tc with If-Match of the current revision of person.
func (w *world) patchMember(t *testing.T, tc tenantctx.TenantContext, person uuid.UUID, body accessapi.MemberPatch) (accessapi.UpdateMember200JSONResponse, error) {
	t.Helper()
	return w.patchMemberIf(t, tc, person, etag(w.revision(t, person)), body)
}

func (w *world) patchMemberIf(t *testing.T, tc tenantctx.TenantContext, person uuid.UUID, ifMatch string, body accessapi.MemberPatch) (accessapi.UpdateMember200JSONResponse, error) {
	t.Helper()
	req := accessapi.UpdateMemberRequestObject{TenantId: w.TenantID, MemberId: person, Body: &body}
	req.Params.IfMatch = ifMatch
	resp, err := w.h.UpdateMember(w.Ctx(tc), req)
	if err != nil {
		return accessapi.UpdateMember200JSONResponse{}, err
	}
	return accesstest.As[accessapi.UpdateMember200JSONResponse](t, resp, nil), nil
}

func status(s accessapi.MemberPatchStatus) accessapi.MemberPatch {
	return accessapi.MemberPatch{Status: &s}
}

var (
	suspend = status(accessapi.MemberPatchStatusSuspended)
	restore = status(accessapi.MemberPatchStatusActive)
)

// account returns the account of the membership of person.
func (w *world) account(t *testing.T, person uuid.UUID) uuid.UUID {
	t.Helper()
	var acc uuid.UUID
	if err := w.Control.QueryRow(t.Context(), `select account_id from memberships where tenant_id = $1 and person_profile_id = $2`,
		w.TenantID, person).Scan(&acc); err != nil {
		t.Fatal(err)
	}
	return acc
}

// session adds a live BFF session of account (auth_sessions of W1.03).
func (w *world) session(t *testing.T, account uuid.UUID) {
	t.Helper()
	id := make([]byte, 32)
	_, _ = rand.Read(id)
	if _, err := w.Control.Exec(t.Context(), `insert into auth_sessions (id_hash, account_id, csrf_token, provider, auth_time, expires_at)
		values ($1, $2, 'csrf', '', now(), now() + interval '8 hours')`, id, account); err != nil {
		t.Fatal(err)
	}
}

func (w *world) liveSessions(t *testing.T, account uuid.UUID) int {
	t.Helper()
	return w.ControlCount(`select 1 from auth_sessions where account_id = $1 and revoked_at is null`, account)
}

// elsewhere gives the account of person an active membership in another business.
func (w *world) elsewhere(t *testing.T, person uuid.UUID) {
	t.Helper()
	other := uuid.New()
	ctx := t.Context()
	if _, err := w.Control.Exec(ctx, `insert into tenants (id, slug, display_name, industry_pack, state) values ($1, $2, 'Другая', 'spa', 'active')`,
		other, "o-"+other.String()[:8]); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Control.Exec(ctx, `insert into memberships (tenant_id, account_id, status, person_profile_id) values ($1, $2, 'active', $3)`,
		other, w.account(t, person), uuid.New()); err != nil {
		t.Fatal(err)
	}
}

func (w *world) membershipStatus(t *testing.T, person uuid.UUID) string {
	t.Helper()
	var s string
	if err := w.Control.QueryRow(t.Context(), `select status::text from memberships where tenant_id = $1 and person_profile_id = $2`,
		w.TenantID, person).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func (w *world) seatsUsed(t *testing.T) int {
	t.Helper()
	var n int
	if err := w.Control.QueryRow(t.Context(), `select seats_used from tenant_seat_usage where tenant_id = $1`, w.TenantID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// seatLimit sets the seats of the plan of the business.
func (w *world) seatLimit(t *testing.T, limit int) {
	t.Helper()
	if _, err := w.Control.Exec(t.Context(), `insert into entitlements (tenant_id, feature_key, source_type, limit_value, limit_unit,
		effective, version, reason, actor_id) values ($1, 'seats', 'manual', $2, 'seats', tstzrange(now() - interval '1 day', null), 1,
		'W1.43 test', $1)`, w.TenantID, limit); err != nil {
		t.Fatal(err)
	}
}

// T-1. Владелец приостанавливает участника: 200 suspended с новой ревизией; членство suspended, место свободно; живые
// сессии аккаунта отозваны (других членств нет), policy_version +1 с событием на человека, аудит. Восстановление —
// 200 active.
func TestUpdateMemberSuspendRestore(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	acc := w.account(t, w.m1)
	w.session(t, acc)
	w.session(t, acc)
	rev, seats, before := w.revision(t, w.m1), w.seatsUsed(t), w.PolicyVersion()

	got, err := w.patchMember(t, w.owner, w.m1, suspend)
	if err != nil {
		t.Fatalf("suspend: %s", accesstest.Problem(err))
	}
	checkMember(t, got, w.m1, accessapi.MemberStatusSuspended, rev+1, acc, w.f1)
	w.checkSuspended(t, w.m1, acc, seats-1, before+1)

	got, err = w.patchMember(t, w.owner, w.m1, restore)
	if err != nil {
		t.Fatalf("restore: %s", accesstest.Problem(err))
	}
	checkMember(t, got, w.m1, accessapi.MemberStatusActive, rev+2, acc, w.f1)
	if s := w.membershipStatus(t, w.m1); s != "active" {
		t.Errorf("membership %s", s)
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.member.restore' and target_id = $1`, w.m1); n != 1 {
		t.Errorf("audit access.member.restore: %d", n)
	}
}

// checkMember checks the response of updateMember: the person, its status, revision (and ETag), account and unit.
func checkMember(t *testing.T, got accessapi.UpdateMember200JSONResponse, person uuid.UUID, status accessapi.MemberStatus, rev int64, account, unit uuid.UUID) {
	t.Helper()
	m := got.Body
	if m.Id != person || m.Status != status || m.Revision != rev || m.UserId == nil || *m.UserId != account ||
		!slices.Equal(m.OrgUnitIds, []uuid.UUID{unit}) || m.DisplayName == "" {
		t.Errorf("member %+v", m)
	}
	if got.Headers.ETag == nil || *got.Headers.ETag != etag(rev) || got.Headers.IdempotencyReplayed == nil || *got.Headers.IdempotencyReplayed {
		t.Errorf("headers %+v", got.Headers)
	}
}

// checkSuspended: the membership of person is suspended, its account has no live session, seats are used, the
// policy version is version with an event for the person, the audit records the suspension.
func (w *world) checkSuspended(t *testing.T, person, account uuid.UUID, seats int, version int64) {
	t.Helper()
	if s := w.membershipStatus(t, person); s != "suspended" {
		t.Errorf("membership %s", s)
	}
	if n := w.liveSessions(t, account); n != 0 {
		t.Errorf("live sessions of the suspended account: %d", n)
	}
	if n := w.seatsUsed(t); n != seats {
		t.Errorf("seats used %d, want %d", n, seats)
	}
	if v := w.PolicyVersion(); v != version {
		t.Errorf("policy version %d, want %d", v, version)
	}
	w.CheckPolicyBump(w.LastPolicyBump(), version, person)
	if n := w.Count(`select 1 from audit.events where action = 'access.member.suspend' and target_id = $1`, person); n != 1 {
		t.Errorf("audit access.member.suspend: %d", n)
	}
}

// T-1. Участник другой организации сессий не теряет: они обслуживают и её, а приостановившая организация закрыта для
// него и так (tenantctx.Resolve отвечает 404 неактивному членству).
func TestUpdateMemberKeepsSessionsOfAnotherBusiness(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.elsewhere(t, w.m2)
	other := w.account(t, w.m2)
	w.session(t, other)
	if _, err := w.patchMember(t, w.owner, w.m2, suspend); err != nil {
		t.Fatalf("suspend m2: %s", accesstest.Problem(err))
	}
	if n := w.liveSessions(t, other); n != 1 {
		t.Errorf("live sessions of a member of another business: %d, want 1", n)
	}
}

// T-2. Последний активный владелец: владелец A приостанавливает владельца B (200), затем себя — 409
// last_owner_required; администратор с members.manage (не владелец) владельца не трогает — 403.
func TestUpdateMemberLastOwner(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	second := w.Member("Второй владелец", "owner2@alta.example", w.region)
	w.Owner(second)
	hr := w.hr(t)
	if _, err := w.patchMember(t, hr, second, suspend); accesstest.Code(err) != "forbidden_action" {
		t.Errorf("a non-owner suspends an owner: %s", accesstest.Problem(err))
	}
	if _, err := w.patchMember(t, w.owner, second, suspend); err != nil {
		t.Fatalf("an owner suspends another owner: %s", accesstest.Problem(err))
	}
	_, err := w.patchMember(t, w.owner, w.owner.PersonID, suspend)
	if accesstest.Problem(err) != "last_owner_required|Нельзя приостановить последнего владельца" {
		t.Errorf("the last active owner: %s", accesstest.Problem(err))
	}
	if s := w.membershipStatus(t, w.owner.PersonID); s != "active" {
		t.Errorf("the last owner is %s", s)
	}
	if _, err := w.patchMember(t, w.owner, second, restore); err != nil {
		t.Fatalf("restore the second owner: %s", accesstest.Problem(err))
	}
}

// T-3. Места тарифа: восстановление занимает место — при занятом лимите 409 seats_exhausted (текст мока).
func TestUpdateMemberSeats(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	used := w.seatsUsed(t)
	w.seatLimit(t, used)
	if _, err := w.patchMember(t, w.owner, w.m1, suspend); err != nil {
		t.Fatalf("suspend: %s", accesstest.Problem(err))
	}
	w.MemberWith("Приглашённый", "invited@alta.example", w.f1, "invited", "active") // takes the freed seat
	_, err := w.patchMember(t, w.owner, w.m1, restore)
	want := "seats_exhausted|Свободных мест нет: занято " + strconv.Itoa(used) + " из " + strconv.Itoa(used) +
		". Отзовите приглашение или запросите расширение тарифа."
	if accesstest.Problem(err) != want {
		t.Errorf("restore over the limit: %s, want %s", accesstest.Problem(err), want)
	}
	if s := w.membershipStatus(t, w.m1); s != "suspended" {
		t.Errorf("membership %s", s)
	}
}

// T-4. Недопустимые переходы и предусловия.
func TestUpdateMemberTransitions(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	hr := w.hr(t)
	invited := w.MemberWith("Приглашённый", "invited@alta.example", w.f1, "invited", "active")
	ended := w.MemberWith("Ушедший", "gone@alta.example", w.f1, "ended", "active")
	card := w.Card("Рабочий без входа", w.f1)
	samara := w.Member("Самарский", "samara@alta.example", w.samara)
	cases := []struct {
		name   string
		tc     tenantctx.TenantContext
		person uuid.UUID
		ifm    string // "" — the current revision; "-" — none
		body   accessapi.MemberPatch
		want   string
	}{
		{"invited", w.owner, invited, "", suspend, "invalid_transition|Участник ещё не принял приглашение."},
		{"ended", w.owner, ended, "", restore, "invalid_transition|Участие сотрудника завершено."},
		{"card without an account", w.owner, card, "", suspend, "invalid_transition|У сотрудника нет аккаунта: приостанавливать нечего."},
		{"self", hr, hr.PersonID, "", suspend, "invalid_transition|Нельзя приостановить себя."},
		{"no If-Match", w.owner, w.m1, "-", suspend, "revision_required|"},
		{"stale If-Match", w.owner, w.m1, `"999"`, suspend, "revision_mismatch|Данные изменились. Обновите страницу и повторите."},
		{"outside the scope", hr, samara, "", suspend, "not_found|"},
		{"unknown", hr, uuid.New(), `"1"`, suspend, "not_found|"},
		{"visible without members.manage", w.regionAdmin, w.m1, "", suspend, "forbidden_action|"},
		{"empty", w.owner, w.m1, "", accessapi.MemberPatch{}, "validation_failed|Укажите, что изменить."},
	}
	for _, c := range cases {
		ifm := c.ifm
		switch ifm {
		case "":
			ifm = etag(w.revision(t, c.person))
		case "-":
			ifm = ""
		}
		_, err := w.patchMemberIf(t, c.tc, c.person, ifm, c.body)
		if got := accesstest.Problem(err); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
	if s := w.membershipStatus(t, invited); s != "invited" {
		t.Errorf("invited membership %s", s)
	}
}

// T-5. Перенос в другое подразделение: одно подразделение в области members.manage актора.
func TestUpdateMemberMove(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	hr := w.hr(t)
	got, err := w.patchMember(t, w.owner, w.m1, accessapi.MemberPatch{OrgUnitIds: &[]uuid.UUID{w.f2}})
	if err != nil {
		t.Fatalf("move: %s", accesstest.Problem(err))
	}
	if !slices.Equal(got.Body.OrgUnitIds, []uuid.UUID{w.f2}) || got.Body.Status != accessapi.MemberStatusActive {
		t.Errorf("moved %+v", got.Body)
	}
	if n := w.Count(`select 1 from people.person_profiles where id = $1 and home_unit_id = $2`, w.m1, w.f2); n != 1 {
		t.Error("the home unit did not change")
	}
	for name, units := range map[string][]uuid.UUID{"unknown": {uuid.New()}, "outside the scope": {w.samara}, "two units": {w.f1, w.f2}} {
		want := "validation_failed|Подразделение не найдено."
		if name == "two units" {
			want = "validation_failed|Выберите одно подразделение: у сотрудника одно домашнее подразделение."
		}
		_, err := w.patchMember(t, hr, w.m2, accessapi.MemberPatch{OrgUnitIds: &units})
		if got := accesstest.Problem(err); got != want {
			t.Errorf("move %s: %s, want %s", name, got, want)
		}
	}
}

// T-5. Набор рабочих функций: снятая заканчивается сейчас, новая начинается сейчас; «Водитель» человеку с
// начислениями и владельцу — 409 SoD (D-10).
func TestUpdateMemberFunctions(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	foreman := []accessapi.MemberPatchWorkProfiles{"foreman"}
	got, err := w.patchMember(t, w.owner, w.driver, accessapi.MemberPatch{WorkProfiles: &foreman})
	if err != nil {
		t.Fatalf("functions: %s", accesstest.Problem(err))
	}
	if !slices.Equal(got.Body.WorkProfiles, []accessapi.MemberWorkProfiles{"foreman"}) {
		t.Errorf("work profiles %v", got.Body.WorkProfiles)
	}
	if n := w.Count(`select 1 from people.work_profiles where person_id = $1 and function = 'driver' and upper(valid) = $2`,
		w.driver, w.Now); n != 1 {
		t.Error("the driver function did not end now")
	}
	if n := w.Count(`select 1 from people.work_profiles where person_id = $1 and function = 'foreman' and lower(valid) = $2
		and upper_inf(valid)`, w.driver, w.Now); n != 1 {
		t.Error("the foreman function did not start now")
	}
	if v := w.PolicyVersion(); v != before+1 {
		t.Errorf("policy version %d, want %d", v, before+1)
	}

	w.Assign(accesstest.Grant{Principal: w.m2, Role: w.earnings, Kind: "unit", Ref: w.f2})
	driver := []accessapi.MemberPatchWorkProfiles{"driver"}
	_, err = w.patchMember(t, w.owner, w.m2, accessapi.MemberPatch{WorkProfiles: &driver})
	if got := accesstest.Code(err); got != "separation_of_duties_conflict" {
		t.Errorf("driver over earnings: %s", accesstest.Problem(err))
	}
	_, err = w.patchMember(t, w.owner, w.owner.PersonID, accessapi.MemberPatch{WorkProfiles: &driver})
	if got := accesstest.Code(err); got != "separation_of_duties_conflict" {
		t.Errorf("driver to the owner: %s", accesstest.Problem(err))
	}
}
