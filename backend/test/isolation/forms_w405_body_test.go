//go:build isolation

package isolation

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// W4.21, return 1 (бриф §1.8, Q-W4.05-27): what the rows of forms_w405.yaml cannot carry. The matrix has no 422
// (matrix.statuses) and no headers, and a public link is made by commands with If-Match, so these checks send their
// requests themselves:
//   - «чужой id в теле»: the id of an object of tenant B in the body of a command of the owner of tenant A — the
//     source form and the group of createForm, the version of submitFormResponse, the project and the assignee of
//     a rule «задача», the page of a rule «в БЗ» — is refused exactly as an unknown id, names nothing of B and
//     writes nothing;
//   - PublicForms: the token of a public form of A opens that form only; a revoked link, an index row without its pair
//     in the tenant and an index row that sends the token of A to tenant B answer 404 as an unknown token.

var formsRefRe = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

// formsCall sends a request of actor ("" — a guest without a session) to the target and returns the status and the body.
func formsCall(t *testing.T, actor, method, path, body string, hdr map[string]string) (int, http.Header, string) {
	t.Helper()
	resolve := func(in string) string {
		return formsRefRe.ReplaceAllStringFunc(in, func(m string) string {
			id, err := suite.Refs.ID(m[2 : len(m)-2])
			if err != nil {
				t.Fatalf("%s: %v", m, err)
			}
			return id.String()
		})
	}
	req := httptest.NewRequestWithContext(t.Context(), method, resolve(path), strings.NewReader(resolve(body)))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if actor != "" {
		a, err := suite.Refs.Actor(actor)
		if err != nil {
			t.Fatal(err)
		}
		if err := suite.Target.Authenticate(req, a); err != nil {
			t.Fatal(err)
		}
	} else if method != http.MethodGet {
		req.Header.Set("Idempotency-Key", "isolation-"+uuid.NewString())
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	suite.Target.Handler.ServeHTTP(rec, req)
	return rec.Code, rec.Header(), rec.Body.String()
}

// tenantBIDs are the ids of tenant B the answers to tenant A must never name.
func tenantBIDs(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, r := range []string{"tenant:b", "form:b.insp", "form_version:b.insp", "form_group:b.checks", "form_rule:b.insp-notify",
		"form_response:b.insp-1", "project:b.fleet", "page:b.rules-intro", "person:b.owner@b"} {
		id, err := suite.Refs.ID(r)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, id.String())
	}
	return out
}

func noneOf(t *testing.T, what, body string, ids []string) {
	t.Helper()
	for _, id := range ids {
		if strings.Contains(strings.ToLower(body), strings.ToLower(id)) {
			t.Errorf("%s names %s of tenant B: %s", what, id, body)
		}
	}
}

func TestIsolationFormsW405Body(t *testing.T) {
	t.Parallel()
	const (
		forms   = "/api/v1/tenants/{{tenant:a}}/forms"
		insp    = forms + "/{{form:a.insp}}"
		invalid = "validation_failed"
	)
	foreign := tenantBIDs(t)
	task := func(project, assignee string) string {
		return `{"kind":"task","trigger":"submitted","task":{"projectId":"{{` + project + `}}","title":"Проверить машину",` +
			`"assigneeMemberId":"{{` + assignee + `}}"}}`
	}
	cases := []struct {
		name, method, path, body string
		want                     int
		code, field              string
	}{
		{"createForm: the source form of B", http.MethodPost, forms, `{"name":"Копия чужой W421","orgUnitId":null,` +
			`"sourceFormId":"{{form:b.insp}}"}`, http.StatusUnprocessableEntity, invalid, "sourceFormId"},
		{"createForm: a missing source form", http.MethodPost, forms, `{"name":"Копия несуществующей W421","orgUnitId":null,` +
			`"sourceFormId":"{{tenant:missing}}"}`, http.StatusUnprocessableEntity, invalid, "sourceFormId"},
		{"createForm: the group of B", http.MethodPost, forms, `{"name":"В чужой группе W421","orgUnitId":null,` +
			`"groupId":"{{form_group:b.checks}}"}`, http.StatusUnprocessableEntity, invalid, "groupId"},
		{"submitFormResponse: the version of B", http.MethodPost, insp + "/responses", `{"versionId":"{{form_version:b.insp}}",` +
			`"answers":[{"fieldKey":"q-text","value":{"type":"text","value":"чужая версия"}}]}`, http.StatusConflict, "invalid_transition", ""},
		{"createFormRule: the project of B", http.MethodPost, insp + "/rules", task("project:b.fleet", "person:a.owner@a"),
			http.StatusUnprocessableEntity, invalid, "task.projectId"},
		{"createFormRule: the assignee of B", http.MethodPost, insp + "/rules", task("project:a.fleet", "person:b.owner@b"),
			http.StatusUnprocessableEntity, invalid, "task.assigneeMemberId"},
		{"createFormRule: the page of B", http.MethodPost, insp + "/rules", `{"kind":"kb","trigger":"accepted","kb":{"nodeId":` +
			`"{{page:b.rules-intro}}","mode":"entry","position":"top","showLink":false,"allEmployeesConfirmed":true,` +
			`"fields":[{"name":"Комментарий","source":"q-text"}]}}`, http.StatusUnprocessableEntity, invalid, "kb.nodeId"},
	}
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	counts := func() (int, int, int) {
		var f, r, x int
		if err := db.QueryRowContext(t.Context(), `select (select count(*) from forms.forms where name like '%W421' and name like 'В %'
			or name like 'Копия %W421'), (select count(*) from forms.rules where config::text like '%Проверить машину%'
			or (kind = 'kb' and config::text like '%Комментарий%')),
			(select count(*) from forms.responses where answers::text like '%чужая версия%')`).Scan(&f, &r, &x); err != nil {
			t.Fatal(err)
		}
		return f, r, x
	}
	forms0, rules0, responses0 := counts()
	for _, c := range cases {
		status, _, body := formsCall(t, "a.owner", c.method, c.path, c.body, nil)
		if status != c.want || !strings.Contains(body, `"`+c.code+`"`) || (c.field != "" && !strings.Contains(body, `"`+c.field+`"`)) {
			t.Errorf("%s: %d %s, want %d %s on %q", c.name, status, body, c.want, c.code, c.field)
		}
		noneOf(t, c.name, body, foreign)
	}
	if f, r, x := counts(); f != forms0 || r != rules0 || x != responses0 {
		t.Errorf("a refused command wrote: forms %d→%d, rules %d→%d, responses %d→%d", forms0, f, rules0, r, responses0, x)
	}
	t.Run("public", func(t *testing.T) { formsPublicRows(t, w, foreign) })
}

// digestOf is the digest of a public token in the databases (forms.tokenDigest).
func digestOf(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// formsPublicRows: the owner of A makes a public form; its token opens it, the forged index rows open nothing.
func formsPublicRows(t *testing.T, w *fixtures.World, foreign []string) {
	t.Helper()
	formID, token := publicFormOfA(t)
	status, _, body := formsCall(t, "", http.MethodGet, "/api/v1/public/forms/"+token, "", nil)
	if status != http.StatusOK || !strings.Contains(body, formID.String()) {
		t.Fatalf("the token of A: %d %s, want its form", status, body)
	}
	noneOf(t, "the public form of A", body, foreign)

	ctl := w.Cluster.DB(t, w.ControlDB, migrations.RoleAPI)
	tenantA := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	var link uuid.UUID
	if err := tenantA.QueryRowContext(t.Context(), `select id from forms.public_links where token_digest = $1`, digestOf(token)).
		Scan(&link); err != nil {
		t.Fatal(err)
	}
	index := func(token string, tenant, form, link uuid.UUID) {
		t.Helper()
		if _, err := ctl.ExecContext(t.Context(), `insert into public_form_links (token_digest, tenant_id, form_id, link_id, key_version)
			values ($1, $2, $3, $4, 1)`, digestOf(token), tenant, form, link); err != nil {
			t.Fatal(err)
		}
	}
	orphan, toB := "w421-orphan-"+uuid.NewString(), "w421-to-b-"+uuid.NewString()
	index(orphan, refID(t, "tenant:a"), formID, uuid.New())
	index(toB, refID(t, "tenant:b"), refID(t, "form:b.insp"), link)
	for name, tok := range map[string]string{"an index row without its pair in the tenant": orphan,
		"an index row that sends the link of A to tenant B": toB, "an unknown token": "w421-unknown-" + uuid.NewString()} {
		status, _, body := formsCall(t, "", http.MethodGet, "/api/v1/public/forms/"+tok, "", nil)
		if status != http.StatusNotFound || !strings.Contains(body, `"not_found"`) {
			t.Errorf("%s: %d %s, want 404 not_found", name, status, body)
		}
		noneOf(t, name, body, foreign)
	}
	if _, err := tenantA.ExecContext(t.Context(), `update forms.public_links set revoked_at = now() where id = $1`, link); err != nil {
		t.Fatal(err)
	}
	status, _, body = formsCall(t, "", http.MethodGet, "/api/v1/public/forms/"+token, "", nil)
	if status != http.StatusNotFound || !strings.Contains(body, `"not_found"`) {
		t.Errorf("a revoked link: %d %s, want 404 not_found", status, body)
	}
}

func refID(t *testing.T, r string) uuid.UUID {
	t.Helper()
	id, err := suite.Refs.ID(r)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// publicFormOfA is a public form the owner of A creates and publishes over HTTP, with its token.
func publicFormOfA(t *testing.T) (uuid.UUID, string) {
	t.Helper()
	const forms = "/api/v1/tenants/{{tenant:a}}/forms"
	status, _, body := formsCall(t, "a.owner", http.MethodPost, forms, `{"name":"Отзыв W421 изоляция","orgUnitId":null,`+
		`"definition":{"pages":[{"id":"p1","title":"Страница 1"}],"fields":[{"key":"q-text","pageId":"p1","type":"text",`+
		`"label":"Отзыв","required":true}]}}`, nil)
	var form struct {
		ID    uuid.UUID `json:"id"`
		Share struct {
			PublicToken string `json:"publicToken"`
		} `json:"share"`
	}
	if err := json.Unmarshal([]byte(body), &form); status != http.StatusCreated || err != nil {
		t.Fatalf("createForm: %d %s", status, body)
	}
	path := forms + "/" + form.ID.String()
	status, hdr, body := formsCall(t, "a.owner", http.MethodPatch, path, `{"settings":{"access":"public"}}`,
		map[string]string{"If-Match": `"rev-1"`})
	if status != http.StatusOK {
		t.Fatalf("updateForm: %d %s", status, body)
	}
	status, _, body = formsCall(t, "a.owner", http.MethodPost, path+"/publish", `{"draftRevision":1}`,
		map[string]string{"If-Match": hdr.Get("ETag")})
	if err := json.Unmarshal([]byte(body), &form); status != http.StatusOK || err != nil || form.Share.PublicToken == "" {
		t.Fatalf("publishForm: %d %s", status, body)
	}
	return form.ID, form.Share.PublicToken
}
