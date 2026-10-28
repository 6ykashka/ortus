//go:build isolation

package isolation

import (
	"context"
	"database/sql"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/service"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// W7.31 (backend «Обращений»): rows the matrix of service_w700.yaml cannot carry because they need the data of the
// module — the demo of the holding (4 directions, 8 requests, 3 ratings, a link for every request) is written into the
// databases of both tenants over SQL, the roles of the dispatcher and of the masseuse into tenant A, and the requests
// go through the real API of the target:
//   - tenant B reads, changes and rates nothing of tenant A, and the answer names nothing of A: 404 as for an id that
//     does not exist (AC-01);
//   - a role of one direction (a project of «Задачи») reaches nothing of another one: 404 by id, nothing in the lists,
//     the counters and the home queue (PD-53); a right the role does not hold is 403 only inside the direction;
//   - the complaint about an employee does not exist for him (404 like a missing id) and is nowhere in his lists;
//   - a phone of a client is a mask in every answer of the staff; the whole number comes by revealServiceClientPhone only;
//   - a personal link opens its own request and no other; a link of tenant A is no key to tenant B and the other way round;
//     an unknown link and an unknown page are 404, the answer names nothing.

var (
	serviceOnce sync.Once
	serviceA    service.DemoSet
	serviceB    service.DemoSet
)

func serviceIDs(w *fixtures.World, tenant string) service.DemoIDs {
	person := func(actor string) uuid.UUID {
		id, err := w.ID("person:" + actor + "@" + tenant)
		if err != nil {
			panic(err)
		}
		return id
	}
	return func(proto string) uuid.UUID {
		switch proto {
		case "m-owner":
			return person(tenant + ".owner")
		case "m-kotova", "m-kotelnikova", "m-morozova":
			if tenant == "a" {
				return person(map[string]string{"m-kotova": "a.manager-msk1", "m-kotelnikova": "a.manager-msk2", "m-morozova": "a.region-msk"}[proto])
			}
			return person("b.manager-msk1")
		}
		return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:iso-"+tenant+":"+proto))
	}
}

// serviceWorld writes the demo into both tenants and the control index once.
func serviceWorld(t *testing.T) {
	t.Helper()
	serviceOnce.Do(func() {
		w, ok := suite.Refs.(*fixtures.World)
		if !ok {
			t.Fatal("the suite has no fixtures")
		}
		control := w.Cluster.DB(t, w.ControlDB, "super")
		for _, tn := range []string{"a", "b"} {
			db := w.Cluster.DB(t, w.TenantDBs[tn], "super")
			ids := serviceIDs(w, tn)
			ex := func(ctx context.Context, q string, args ...any) error {
				_, err := db.ExecContext(ctx, q, args...)
				return err
			}
			if err := service.WriteDemo(t.Context(), ex, ids); err != nil {
				t.Fatalf("tenant %s: %v", tn, err)
			}
			if tn == "b" { // the slug of a page is unique in the control registry: the pages of B have their own
				if _, err := db.ExecContext(t.Context(), `update service.directions set public_slug = 'b-' || public_slug`); err != nil {
					t.Fatal(err)
				}
			}
			tenant := mustID(t, w, "tenant:"+tn)
			for _, row := range service.DemoTokens(ids) {
				if _, err := control.ExecContext(t.Context(), `insert into public_service_tokens (token_digest, tenant_id, request_id, token_id, key_version, expires_at)
					values ($1, $2, $3, $4, 1, $5)`, row.Digest, tenant, row.Request, row.ID, row.ExpiresAt); err != nil {
					t.Fatal(err)
				}
			}
			for _, slug := range []string{"mas", "kos", "otd", "grz"} {
				name := slug
				if tn == "b" {
					name = "b-" + slug
				}
				if _, err := control.ExecContext(t.Context(), `insert into public_service_slugs (slug, tenant_id, direction_id) values ($1, $2, $3)`, name, tenant, ids("d-"+slug)); err != nil {
					t.Fatal(err)
				}
			}
			if tn == "a" {
				agent(t, db, w, "a.manager-msk1", []string{"service.requests.read", "service.requests.create", "service.requests.reply", "service.requests.resolve"}, ids("svc-grz"))
				agent(t, db, w, "a.region-msk", []string{"service.requests.read", "service.requests.reply"}, ids("svc-mas"))
			}
			if tn == "a" {
				serviceA = service.Demo(ids)
			} else {
				serviceB = service.Demo(ids)
			}
		}
	})
}

func mustID(t *testing.T, w *fixtures.World, ref string) uuid.UUID {
	t.Helper()
	id, err := w.ID(ref)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// agent gives an actor of tenant A a role over the project of a direction.
func agent(t *testing.T, db *sql.DB, w *fixtures.World, actor string, actions []string, project uuid.UUID) {
	t.Helper()
	role, by := uuid.New(), mustID(t, w, "person:a.owner@a")
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, []any{role, "Обращения изоляции " + role.String()[:8]}},
		{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, []any{role, actions, by}},
		{`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, granted_by, valid)
		  values ('person', $1, $2, 1, 'project', $3, $4, tstzrange('2020-01-01', null))`, []any{mustID(t, w, "person:"+actor+"@a"), role, project, by}},
		// the permission cache of the target reuses a subject while policy_version holds
		{`update access.policy_state set policy_version = policy_version + 1`, nil},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
}

func svc(tenant string) string { return "/api/v1/tenants/{{tenant:" + tenant + "}}/service" }

func requestOf(d service.DemoSet, proto string) uuid.UUID {
	for _, r := range d.Requests {
		if r.Key == proto {
			return r.ID
		}
	}
	panic("no request " + proto)
}

func want(t *testing.T, what string, got, status int, body string, absent ...string) {
	t.Helper()
	if got != status {
		t.Errorf("%s: %d, want %d: %s", what, got, status, body)
	}
	for _, a := range absent {
		if a != "" && strings.Contains(body, a) {
			t.Errorf("%s: the answer names %q: %s", what, a, body)
		}
	}
}

func TestServiceTenantBReachesNothingOfA(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	serviceWorld(t)
	req57 := requestOf(serviceA, "ГРЗ-57")
	for name, c := range map[string]struct{ method, path, body string }{
		"getServiceRequest":        {http.MethodGet, svc("a") + "/requests/" + req57.String(), ""},
		"postServiceMessage":       {http.MethodPost, svc("a") + "/requests/" + req57.String() + "/messages", `{"kind":"public","text":"Здравствуйте"}`},
		"revealServiceClientPhone": {http.MethodPost, svc("a") + "/requests/" + req57.String() + "/client-phone/reveal", `{}`},
		"listServiceRequests":      {http.MethodGet, svc("a") + "/requests", ""},
		"getServiceDirection":      {http.MethodGet, svc("a") + "/directions/" + serviceA.Directions[3].ID.String(), ""},
	} {
		status, _, body := formsCall(t, "b.owner", c.method, c.path, c.body, nil)
		want(t, name, status, http.StatusNotFound, body, "ГРЗ-57", "Гусева", "Фермерская", req57.String())
	}
	// its own organization: the same requests exist there under their own ids, and A's ids are nowhere in the lists
	status, _, body := formsCall(t, "b.owner", http.MethodGet, svc("b")+"/requests?queue=open", "", nil)
	want(t, "listServiceRequests of B", status, http.StatusOK, body, req57.String(), requestOf(serviceA, "МАС-40").String())
	if !strings.Contains(body, requestOf(serviceB, "ГРЗ-57").String()) {
		t.Errorf("tenant B sees its own requests: %s", body)
	}
}

func TestServiceRoleOfOneDirectionReachesNothingOfAnother(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	serviceWorld(t)
	mas40, grz57 := requestOf(serviceA, "МАС-40"), requestOf(serviceA, "ГРЗ-57")
	status, _, body := formsCall(t, "a.manager-msk1", http.MethodGet, svc("a")+"/requests?queue=open", "", nil)
	want(t, "the list of the dispatcher", status, http.StatusOK, body, "МАС-", "КОС-", "ОТД-", mas40.String())
	if !strings.Contains(body, grz57.String()) {
		t.Errorf("the dispatcher sees her direction: %s", body)
	}
	for name, c := range map[string]struct{ method, path, body string }{
		"get":      {http.MethodGet, svc("a") + "/requests/" + mas40.String(), ""},
		"message":  {http.MethodPost, svc("a") + "/requests/" + mas40.String() + "/messages", `{"kind":"note","text":"Заметка"}`},
		"counts":   {http.MethodGet, svc("a") + "/queues?directionId=" + serviceA.Directions[0].ID.String(), ""},
		"template": {http.MethodGet, svc("a") + "/directions/" + serviceA.Directions[0].ID.String() + "/templates", ""},
		"rating":   {http.MethodPost, svc("a") + "/ratings/" + serviceA.Ratings[0].ID.String() + "/decision", `{"action":"seen"}`},
	} {
		status, _, body := formsCall(t, "a.manager-msk1", c.method, c.path, c.body, nil)
		want(t, name, status, http.StatusNotFound, body, "Массаж", "Лаврова", "Михеева")
	}
	// the right the role does not hold, inside the direction: 403, not 404
	status, _, body = formsCall(t, "a.manager-msk1", http.MethodPost, svc("a")+"/requests/"+grz57.String()+"/client-phone/reveal", `{}`, nil)
	want(t, "reveal without service.clients.contacts", status, http.StatusForbidden, body, "9162044412")
	status, _, body = formsCall(t, "a.manager-msk1", http.MethodGet, svc("a")+"/directions/"+serviceA.Directions[3].ID.String(), "", nil)
	want(t, "settings without service.directions.manage", status, http.StatusForbidden, body)
}

func TestServiceComplaintAboutAnEmployeeDoesNotExistForHim(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	serviceWorld(t)
	mas41 := requestOf(serviceA, "МАС-41")
	status, _, body := formsCall(t, "a.region-msk", http.MethodGet, svc("a")+"/requests/"+mas41.String(), "", nil)
	want(t, "the complaint about her", status, http.StatusNotFound, body, "Романова", "опоздание")
	// the same answer as for an id that does not exist
	status2, _, body2 := formsCall(t, "a.region-msk", http.MethodGet, svc("a")+"/requests/"+uuid.NewString(), "", nil)
	if status2 != http.StatusNotFound || codeOf(body) != codeOf(body2) {
		t.Errorf("a complaint about her and a missing id differ: %d %s / %d %s", status, body, status2, body2)
	}
	status, _, body = formsCall(t, "a.region-msk", http.MethodGet, svc("a")+"/requests?queue=open", "", nil)
	want(t, "her list", status, http.StatusOK, body, "МАС-41", "Романова", mas41.String())
	for _, op := range []string{"/messages", "/transitions", "/move"} {
		status, _, body := formsCall(t, "a.region-msk", http.MethodPost, svc("a")+"/requests/"+mas41.String()+op,
			`{"kind":"note","text":"Моя заметка","to":"work","directionId":"`+uuid.NewString()+`"}`, map[string]string{"If-Match": `"rev-1"`})
		want(t, op, status, http.StatusNotFound, body, "Романова")
	}
	// the owner sees it
	status, _, body = formsCall(t, "a.owner", http.MethodGet, svc("a")+"/requests/"+mas41.String(), "", nil)
	want(t, "the owner", status, http.StatusOK, body)
}

var codeRe = regexp.MustCompile(`"code"\s*:\s*"([a-z_]+)"`)

func codeOf(body string) string {
	if m := codeRe.FindStringSubmatch(body); m != nil {
		return m[1]
	}
	return ""
}

func TestServicePhoneIsAMaskInEveryAnswerOfTheStaff(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	serviceWorld(t)
	for _, c := range []struct{ actor, path string }{
		{"a.owner", svc("a") + "/requests?queue=open"},
		{"a.owner", svc("a") + "/requests/" + requestOf(serviceA, "ГРЗ-57").String()},
		{"a.manager-msk1", svc("a") + "/requests?queue=open"},
		{"a.manager-msk1", svc("a") + "/requests/" + requestOf(serviceA, "ГРЗ-55").String()},
	} {
		status, _, body := formsCall(t, c.actor, http.MethodGet, c.path, "", nil)
		want(t, c.actor+" "+c.path, status, http.StatusOK, body, "9162044412", "916 204-44-12", "4627", "8462127709", "846 212-77-09")
		if !strings.Contains(body, "phoneMasked") {
			t.Errorf("%s: no mask in %s", c.path, body)
		}
	}
	// the owner reveals: the whole number in the answer of the command and in the card of the one who asked, not in another's
	r57 := requestOf(serviceA, "ГРЗ-57").String()
	status, _, body := formsCall(t, "a.owner", http.MethodPost, svc("a")+"/requests/"+r57+"/client-phone/reveal", `{}`, nil)
	want(t, "reveal", status, http.StatusOK, body)
	if !strings.Contains(body, "+7 916 204-44-12") {
		t.Errorf("the whole number is the answer of the command: %s", body)
	}
	status, _, body = formsCall(t, "a.manager-msk1", http.MethodGet, svc("a")+"/requests/"+r57, "", nil)
	want(t, "another member after the reveal", status, http.StatusOK, body, "916 204-44-12")
}

func TestServicePersonalLinkOpensItsOwnRequestOnly(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	serviceWorld(t)
	tokenA, tokenB := service.DemoToken(requestOf(serviceA, "ГРЗ-57")), service.DemoToken(requestOf(serviceB, "ГРЗ-57"))
	status, _, body := formsCall(t, "", http.MethodGet, "/api/v1/public/service/requests/"+tokenA, "", nil)
	want(t, "link of A", status, http.StatusOK, body, "Гусева", "9162044412", "Фермерская", "directionId", "assignee")
	if !strings.Contains(body, "ГРЗ-57") || strings.Contains(body, "note") {
		t.Errorf("the client sees his request and no notes: %s", body)
	}
	status, _, body = formsCall(t, "", http.MethodGet, "/api/v1/public/service/requests/"+tokenB, "", nil)
	want(t, "link of B", status, http.StatusOK, body)
	for name, token := range map[string]string{"unknown": "tok_unknown00000000000000000000", "short": "tok_x"} {
		status, _, body := formsCall(t, "", http.MethodGet, "/api/v1/public/service/requests/"+token, "", nil)
		want(t, name+" link", status, http.StatusNotFound, body, "ГРЗ")
	}
	// the message of a client lands in his own organization only
	status, _, body = formsCall(t, "", http.MethodPost, "/api/v1/public/service/requests/"+tokenA+"/messages", `{"text":"Жду ответа"}`, nil)
	want(t, "message of the client", status, http.StatusCreated, body)
	status, _, body = formsCall(t, "a.owner", http.MethodGet, svc("a")+"/requests/"+requestOf(serviceA, "ГРЗ-57").String(), "", nil)
	want(t, "the staff reads it", status, http.StatusOK, body)
	if !strings.Contains(body, "Жду ответа") {
		t.Errorf("the message is in the feed: %s", body)
	}
	status, _, body = formsCall(t, "b.owner", http.MethodGet, svc("b")+"/requests/"+requestOf(serviceB, "ГРЗ-57").String(), "", nil)
	want(t, "tenant B", status, http.StatusOK, body, "Жду ответа")
}

func TestServicePageOfADirectionHasNoClientData(t *testing.T) { //nolint:paralleltest // the tests share one seeded database and run in the order of the files
	serviceWorld(t)
	status, _, body := formsCall(t, "", http.MethodGet, "/api/v1/public/service/grz", "", nil)
	want(t, "page of A", status, http.StatusOK, body, "Гусева", "Сафонов", "ГРЗ-5", "phone", "assignee")
	status, _, body = formsCall(t, "", http.MethodGet, "/api/v1/public/service/b-grz", "", nil)
	want(t, "page of B", status, http.StatusOK, body, "Гусева")
	status, _, body = formsCall(t, "", http.MethodGet, "/api/v1/public/service/nope", "", nil)
	want(t, "unknown page", status, http.StatusNotFound, body, "Грузоперевозки")
}
