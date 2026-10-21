package main

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// W4.60 (Q-W4.07-3, MSW BILLING_ANY_STATE): сетка и заявки на тариф открыты владельцу и в «только чтении», и в
// приостановленной организации (запись тоже); подписка 0.1 и оформление там закрыты, как прежде. Хендлеров в
// unit-сборке нет — пропущенный шлюзом запрос получает 501.
func TestBillingInAnyTenantState(t *testing.T) {
	t.Parallel()
	c := newClient(t, newHandler(testDeps(testConfig()))).login("acc-99")
	hdr := map[string]string{"Origin": testOrigin, session.CSRFHeader: c.csrf}
	tenant := func(id uuid.UUID, rest string) string { return "/api/v1/tenants/" + id.String() + rest }
	request := uuid.NewString()
	cases := []struct {
		name, method, path, body string
		status                   int
		code                     string
	}{
		{"сетка в suspended", http.MethodGet, tenant(cargo, "/price-book"), "", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"заявки в suspended", http.MethodGet, tenant(cargo, "/subscription/change-requests"), "", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"заявка в suspended", http.MethodPost, tenant(cargo, "/subscription/change-requests"), `{"tierCode":"team","termMonths":12}`, http.StatusNotImplemented, problem.CodeNotImplemented},
		{"заявка в read_only", http.MethodPost, tenant(remstroy, "/subscription/change-requests"), `{"tierCode":"team","termMonths":12}`, http.StatusNotImplemented, problem.CodeNotImplemented},
		{"отмена в read_only", http.MethodPost, tenant(remstroy, "/subscription/change-requests/"+request+"/cancel"), "", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"отмена в suspended", http.MethodPost, tenant(cargo, "/subscription/change-requests/"+request+"/cancel"), "", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"подписка 0.1 в suspended закрыта", http.MethodGet, tenant(cargo, "/subscription"), "", http.StatusForbidden, problem.CodeTenantSuspended},
		{"оформление в suspended закрыто", http.MethodGet, tenant(cargo, "/branding"), "", http.StatusForbidden, problem.CodeTenantSuspended},
		{"файл оформления в read_only закрыт", http.MethodPost, tenant(remstroy, "/branding/assets"), `{}`, http.StatusForbidden, problem.CodeTenantReadOnly},
	}
	for _, tc := range cases {
		rec := c.do(tc.method, tc.path, tc.body, hdr)
		if rec.Code != tc.status || codeOf(rec) != tc.code {
			t.Errorf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
	}
}

// fakeRoles is the role of each operator account; err fails every lookup.
type fakeRoles struct {
	roles map[uuid.UUID]string
	err   error
}

func (f fakeRoles) PlatformRole(_ context.Context, account uuid.UUID) (string, error) {
	return f.roles[account], f.err
}

// operatorAccount is the account of the persona operator (op-1) of the unit world.
func operatorAccount(t *testing.T) uuid.UUID {
	t.Helper()
	p, ok := world{}.find(func(p person) bool { return p.operator })
	if !ok {
		t.Fatal("no operator in the unit world")
	}
	return p.acc.ID
}

// W4.60 (Q-W4.07-14, Q-W4.07-18): шлюз /platform/** сверяет x-permissions операции с ролью оператора до хендлера —
// другой роли 403 forbidden_action, как у tenant-операций; роль даёт право — хендлер (501 в unit-сборке).
func TestPlatformRoleGate(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, role, method, path string
		status                   int
		code                     string
	}{
		{"поддержка читает организации", "support", http.MethodGet, "/api/v1/platform/tenants", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"поддержка не видит очередь заявок", "support", http.MethodGet, "/api/v1/platform/subscription-requests", http.StatusForbidden, problem.CodeForbiddenAction},
		{"поддержка не видит подписку", "support", http.MethodGet, "/api/v1/platform/tenants/" + alta.String() + "/subscription", http.StatusForbidden, problem.CodeForbiddenAction},
		{"биллинг видит очередь заявок", "billing", http.MethodGet, "/api/v1/platform/subscription-requests", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"поддержка не публикует сетку", "support", http.MethodPost, "/api/v1/platform/price-book/versions", http.StatusForbidden, problem.CodeForbiddenAction},
		{"администратор публикует сетку", "admin", http.MethodPost, "/api/v1/platform/price-book/versions", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"биллинг не приглашает операторов", "billing", http.MethodPost, "/api/v1/platform/operators", http.StatusForbidden, problem.CodeForbiddenAction},
		{"владелец приглашает операторов", "owner", http.MethodPost, "/api/v1/platform/operators", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"поддержка сбрасывает второй фактор", "support", http.MethodPost, "/api/v1/platform/users/" + uuid.NewString() + "/mfa-reset", http.StatusNotImplemented, problem.CodeNotImplemented},
		{"биллинг не блокирует вход", "billing", http.MethodPost, "/api/v1/platform/users/" + uuid.NewString() + "/lock", http.StatusForbidden, problem.CodeForbiddenAction},
		{"оператор без роли", "", http.MethodGet, "/api/v1/platform/tenants", http.StatusForbidden, problem.CodeForbiddenAction},
	}
	account := operatorAccount(t)
	for _, tc := range cases {
		d := testDeps(testConfig())
		d.platformRoles = fakeRoles{roles: map[uuid.UUID]string{account: tc.role}}
		c := newClient(t, newHandler(d)).login("operator")
		hdr := map[string]string{"Origin": testOrigin, session.CSRFHeader: c.csrf}
		body := ""
		if tc.method != http.MethodGet {
			body = `{}`
		}
		rec := c.do(tc.method, tc.path, body, hdr)
		if rec.Code != tc.status || codeOf(rec) != tc.code {
			t.Errorf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
	}
	// Роль не прочитать — 503, запрос не проходит дальше.
	d := testDeps(testConfig())
	d.platformRoles = fakeRoles{err: errors.New("control DB down")}
	rec := newClient(t, newHandler(d)).login("operator").do(http.MethodGet, "/api/v1/platform/tenants", "", nil)
	if rec.Code != http.StatusServiceUnavailable || codeOf(rec) != problem.CodeDependencyUnavailable {
		t.Errorf("role lookup failed: %d %s", rec.Code, rec.Body)
	}
	// Участнику организации /platform/** по-прежнему не существует (404 до роли).
	d = testDeps(testConfig())
	d.platformRoles = fakeRoles{roles: map[uuid.UUID]string{account: "owner"}}
	if rec := newClient(t, newHandler(d)).login("owner").do(http.MethodGet, "/api/v1/platform/tenants", "", nil); rec.Code != http.StatusNotFound {
		t.Errorf("member: %d %s", rec.Code, rec.Body)
	}
}
