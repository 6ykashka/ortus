//go:build integration

package assignments_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func (w *world) invite(t *testing.T, tc tenantctx.TenantContext, body accessapi.InvitationCreate) (accessapi.Invitation, error) {
	t.Helper()
	resp, err := w.h.InviteMember(w.Ctx(tc), accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &body})
	if err != nil {
		return accessapi.Invitation{}, err
	}
	return accesstest.As[accessapi.InviteMember201JSONResponse](t, resp, nil).Body, nil
}

func invitation(name, email string, unit uuid.UUID, roles ...accessapi.InvitationRole) accessapi.InvitationCreate {
	body := accessapi.InvitationCreate{OrgUnitIds: []uuid.UUID{unit}, RoleAssignments: roles}
	setString(&body.Email, email)
	if name != "" {
		body.DisplayName = &name
	}
	if body.RoleAssignments == nil {
		body.RoleAssignments = []accessapi.InvitationRole{}
	}
	return body
}

func setString[T ~string](dst *T, s string) { *dst = T(s) }

// Приглашение (S1-06, формат W1.03 Q-W1.03-5): карточка в tenant DB, назначения приглашения — dormant, приглашение
// в control с их id и сроком 7 дней; права появятся только после принятия (policy_version не меняется).
func TestInviteMember(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	inv, err := w.invite(t, w.owner, invitation("Иван Тестов", " I.Testov@Alta.Example ", w.f1,
		accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)}))
	if err != nil {
		t.Fatal(err)
	}
	if string(inv.Email) != "i.testov@alta.example" || inv.Status != accessapi.InvitationStatusPending ||
		inv.ExpiresAt.Sub(w.Now) < 6*24*time.Hour {
		t.Errorf("invitation %+v", inv)
	}
	var person uuid.UUID
	if err := w.Tenant.QueryRow(t.Context(), `select id from people.person_profiles where email = 'i.testov@alta.example'
		and full_name = 'Иван Тестов' and home_unit_id = $1 and membership_id is null`, w.f1).Scan(&person); err != nil {
		t.Fatalf("profile: %v", err)
	}
	if n := w.Count(`select 1 from access.role_assignments where principal_id = $1 and state = 'dormant' and role_id = $2`, person, w.trips); n != 1 {
		t.Errorf("dormant assignments: %d", n)
	}
	if n := w.ControlCount(`select 1 from invitations i where i.id = $1 and i.person_profile_id = $2 and i.email_norm = 'i.testov@alta.example'
		and cardinality(i.role_assignment_ids) = 1 and i.created_by = $3 and i.accepted_at is null`, inv.Id, person, w.owner.MembershipID); n != 1 {
		t.Errorf("control invitation: %d", n)
	}
	if w.PolicyVersion() != before {
		t.Errorf("policy version %d → %d: dormant assignments give nothing yet", before, w.PolicyVersion())
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.invitation.create' and target_id = $1`, inv.Id); n != 1 {
		t.Errorf("audit: %d", n)
	}
	// Администратор фирмы приглашает в свою фирму со своими правами.
	if _, err := w.invite(t, w.firmAdmin, invitation("Пётр", "p@alta.example", w.f1,
		accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, false)})); err != nil {
		t.Errorf("firm admin: %v", err)
	}
}

// Отказы приглашения: адрес уже занят участником или приглашением (422), имя и адрес обязательны, подразделение и
// роль — видимые и свои (404, 409 делегирование), мест нет (409 seats_exhausted).
func TestInviteMemberRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if _, err := w.invite(t, w.owner, invitation("Первый", "first@alta.example", w.f1)); err != nil {
		t.Fatal(err)
	}
	trips := accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)}
	earnings := accessapi.InvitationRole{RoleId: w.earnings, Scope: unitScope(w.f1, true)}
	driver := accessapi.InvitationRole{RoleId: w.driverRole, Scope: accessapi.Scope{Kind: accessapi.ScopeKindSelf, ResourceIds: []uuid.UUID{}}}
	const sod = "separation_of_duties_conflict|У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено."
	noUnits := invitation("Без фирмы", "nounit@alta.example", w.f1)
	noUnits.OrgUnitIds = []uuid.UUID{}
	for name, tc := range map[string]struct {
		actor tenantctx.TenantContext
		body  accessapi.InvitationCreate
		want  string
	}{
		"адрес участника":          {w.owner, invitation("Двойник", "M1@alta.example", w.f1), "validation_failed|Участник с таким адресом уже есть."},
		"адрес приглашения":        {w.owner, invitation("Второй", "first@alta.example", w.f1), "validation_failed|Участник с таким адресом уже есть."},
		"без имени":                {w.owner, invitation("", "noname@alta.example", w.f1), "validation_failed|Укажите имя"},
		"адрес без домена":         {w.owner, invitation("Кривой", "broken", w.f1), "validation_failed"},
		"без подразделения":        {w.owner, noUnits, "validation_failed"},
		"нет подразделения":        {w.owner, invitation("Пустота", "void@alta.example", uuid.New()), "not_found"},
		"фирма вне видимости":      {w.firmAdmin, invitation("Чужой", "alien@alta.example", w.f2), "not_found"},
		"роль шире своей области":  {w.firmAdmin, invitation("Широкий", "wide@alta.example", w.f1, accessapi.InvitationRole{RoleId: w.trips, Scope: tenantScope}), "delegation_exceeds_grant"},
		"чужое право":              {w.firmAdmin, invitation("Приёмщик", "review@alta.example", w.f1, accessapi.InvitationRole{RoleId: w.review, Scope: unitScope(w.f1, true)}), "delegation_exceeds_grant"},
		"системная роль":           {w.owner, invitation("Хозяин", "boss@alta.example", w.f1, accessapi.InvitationRole{RoleId: w.ownerRole, Scope: tenantScope}), "invalid_transition"},
		"нет роли":                 {w.owner, invitation("Безролевой", "norole@alta.example", w.f1, accessapi.InvitationRole{RoleId: uuid.New(), Scope: tenantScope}), "not_found"},
		"читатель без приглашений": {w.reader, invitation("Гость", "guest@alta.example", w.f1, trips), "forbidden_action"},
		// D-10 между ролями одного приглашения — как между прямыми назначениями, в любом порядке ролей.
		"начисления и «Водитель»": {w.owner, invitation("Кассир", "cashier@alta.example", w.f1, earnings, driver), sod},
		"«Водитель» и начисления": {w.owner, invitation("Шофёр", "chauffeur@alta.example", w.f1, driver, earnings), sod},
	} {
		_, err := w.invite(t, tc.actor, tc.body)
		if got := accesstest.Problem(err); got != tc.want && accesstest.Code(err) != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
	if n := w.Count(`select 1 from people.person_profiles where email in ('cashier@alta.example', 'chauffeur@alta.example')`); n != 0 {
		t.Errorf("cards of refused invitations: %d", n)
	}
}

// Места тарифа (S1-06, прототип api.js:160): приглашение занимает место сразу — занятые места и ожидающие
// приглашения не превышают лимит.
func TestInviteMemberSeats(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	var used int
	if err := w.Control.QueryRow(t.Context(), `select seats_used from tenant_seat_usage where tenant_id = $1`, w.TenantID).Scan(&used); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Control.Exec(t.Context(), `insert into entitlements (tenant_id, feature_key, source_type, limit_value, limit_unit,
		effective, version, reason, actor_id) values ($1, 'seats', 'plan', $2, 'seats', tstzrange(now() - interval '1 day', null), 1, 'тест', $1)`,
		w.TenantID, used+1); err != nil {
		t.Fatal(err)
	}
	if _, err := w.invite(t, w.owner, invitation("Последнее место", "last@alta.example", w.f1)); err != nil {
		t.Fatalf("the last seat: %v", err)
	}
	_, err := w.invite(t, w.owner, invitation("Лишний", "extra@alta.example", w.f1))
	if got := accesstest.Code(err); got != "seats_exhausted" {
		t.Errorf("no seats: %s", accesstest.Problem(err))
	}
}
