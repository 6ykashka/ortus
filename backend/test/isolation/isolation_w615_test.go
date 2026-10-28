//go:build isolation

package isolation

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// W6.15: what the rows of repairs_w600.yaml cannot carry — a body that fails validation (a row has no 422) and the path
// of a request over the whole step 6.6 through HTTP. The fixtures are those of W6.11 (content_repairs.go): «Квартира на
// Лесной» (repair_project:a.flat, a.repairs-foreman) and «Дом на Речной» (repair_project:a.other, a.repairs-foreman-two).
//   - the path: a signed act of the object accrues the crew, the owner proposes the payout to the cash desks, reads the
//     finance, issues the link of the cabinet, the client (no session) reads the cabinet by the link, the owner revokes the
//     link and the cabinet answers 410 public_token_expired;
//   - a foreman: no finance, no accruals, no subcontractors, no link (403); the foreman of another object sees nothing;
//   - validation: a payout of an unknown accrual and an access without a term answer 422 with the field, after the access.

// Not parallel: the requests change the lists of the finance that the rows of repairs_w600.yaml read in parallel.
//
//nolint:paralleltest // see above
func TestIsolationRepairsW615(t *testing.T) {
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	s := w615Seed(t, w)
	t.Run("path", func(t *testing.T) { w615Path(t, s) })
	t.Run("foreman", func(t *testing.T) { w615Foreman(t, s) })
	t.Run("validation", func(t *testing.T) { w615Validation(t, s) })
}

// finance is what the DB of tenant A holds for the test: a worker of the crew, a signed act with a sum and a
// subcontractor of «Лесная».
type finance struct{ act, sub uuid.UUID }

func w615Seed(t *testing.T, w *fixtures.World) finance {
	t.Helper()
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migratetest.Super)
	f := finance{act: uuid.New(), sub: uuid.New()}
	project := refID(t, "repair_project:a.flat")
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into repairs.workers (project_id, display_name, trade) values ($1, $2, 'Маляр')`, []any{project, "Рабочий изоляции " + uuid.NewString()[:8]}},
		{`insert into repairs.documents (id, project_id, kind, title, state, act_no, amount_minor, signed_at) values ($1, $2, 'act', 'Акт № 1 изоляции', 'signed', 1, 1000000, now())`,
			[]any{f.act, project}},
		{`insert into repairs.subcontractors (id, project_id, name, scope, contract_minor) values ($1, $2, 'ООО Изоляция', 'Электрика', 80000)`, []any{f.sub, project}},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	return f
}

func w615Do(t *testing.T, actor, method, path, body string, want int) string {
	t.Helper()
	status, _, raw := formsCall(t, actor, method, path, body, nil)
	if status != want {
		t.Fatalf("%s %s by %q: %d %s, want %d", method, path, actor, status, raw, want)
	}
	return raw
}

func w615Path(t *testing.T, f finance) { //nolint:gocyclo // one path through HTTP: each step is a check
	t.Helper()
	flat := repairsA + "projects/{{repair_project:a.flat}}/"
	raw := w615Do(t, "a.owner", http.MethodPost, repairsA+"acts/"+f.act.String()+"/accruals", "", http.StatusCreated)
	var acc struct{ Items []struct{ ID uuid.UUID } }
	if err := json.Unmarshal([]byte(raw), &acc); err != nil || len(acc.Items) == 0 || !strings.Contains(raw, `"state":"accrued"`) {
		t.Fatalf("accruals: %s (%v)", raw, err)
	}
	if again := w615Do(t, "a.owner", http.MethodPost, repairsA+"acts/"+f.act.String()+"/accruals", "", http.StatusCreated); again != raw {
		t.Errorf("the second accrual by the same act differs:\n%s\n%s", raw, again)
	}
	if listed := w615Do(t, "a.owner", http.MethodGet, flat+"accruals", "", http.StatusOK); !strings.Contains(listed, acc.Items[0].ID.String()) {
		t.Errorf("the accrual is not listed: %s", listed)
	}
	paid := w615Do(t, "a.owner", http.MethodPost, repairsA+"accruals/payout", `{"accrualIds":["`+acc.Items[0].ID.String()+`"]}`, http.StatusOK)
	if !strings.Contains(paid, `"proposalId"`) || !strings.Contains(paid, `"proposed"`) {
		t.Errorf("payout: %s", paid)
	}
	w615Do(t, "a.owner", http.MethodPost, repairsA+"accruals/payout", `{"accrualIds":["`+acc.Items[0].ID.String()+`"]}`, http.StatusConflict)
	if fin := w615Do(t, "a.owner", http.MethodGet, flat+"finance", "", http.StatusOK); !strings.Contains(fin, `"movements"`) || !strings.Contains(fin, `"accrual"`) {
		t.Errorf("finance: %s", fin)
	}

	// the link and the cabinet of the client: no session, the token names the tenant
	issued := w615Do(t, "a.owner", http.MethodPost, flat+"client-link", "", http.StatusCreated)
	var link struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(issued), &link); err != nil || !strings.Contains(link.URL, "/c/") {
		t.Fatalf("issued link: %s (%v)", issued, err)
	}
	token := link.URL[strings.LastIndex(link.URL, "/c/")+3:]
	cabinet := w615Do(t, "", http.MethodGet, "/api/v1/public/client/"+token, "", http.StatusOK)
	if !strings.Contains(cabinet, `"projectName"`) || !strings.Contains(cabinet, `"readinessPct"`) {
		t.Errorf("cabinet: %s", cabinet)
	}
	if got := w615Do(t, "a.owner", http.MethodGet, flat+"client-link", "", http.StatusOK); !strings.Contains(got, `"active":true`) {
		t.Errorf("link: %s", got)
	}
	w615Do(t, "a.owner", http.MethodDelete, flat+"client-link", "", http.StatusNoContent)
	if gone := w615Do(t, "", http.MethodGet, "/api/v1/public/client/"+token, "", http.StatusGone); !strings.Contains(gone, "public_token_expired") {
		t.Errorf("revoked link: %s", gone)
	}
	w615Do(t, "", http.MethodGet, "/api/v1/public/client/no-such-token", "", http.StatusNotFound)
	// the commands of the guest: an unknown link is 404, a revoked one 410 (the guest gets an Idempotency-Key from formsCall)
	unknown := strings.Repeat("x", 43)
	w615Do(t, "", http.MethodPost, "/api/v1/public/client/"+unknown+"/estimates/1/approve", "", http.StatusNotFound)
	w615Do(t, "", http.MethodPost, "/api/v1/public/client/"+unknown+"/documents/"+uuid.NewString()+"/sign", `{"smsCode":"123456"}`, http.StatusNotFound)
	w615Do(t, "", http.MethodPost, "/api/v1/public/client/"+token+"/estimates/1/approve", "", http.StatusGone)
	w615Do(t, "", http.MethodPost, "/api/v1/public/client/"+token+"/documents/"+uuid.NewString()+"/sign", `{"smsCode":"123456"}`, http.StatusGone)
}

func w615Foreman(t *testing.T, f finance) {
	t.Helper()
	flat := repairsA + "projects/{{repair_project:a.flat}}/"
	for _, c := range []struct{ name, method, path, body string }{
		{"finance", http.MethodGet, flat + "finance", ""},
		{"accruals", http.MethodGet, flat + "accruals", ""},
		{"accrue", http.MethodPost, repairsA + "acts/" + f.act.String() + "/accruals", ""},
		{"payout", http.MethodPost, repairsA + "accruals/payout", `{"accrualIds":["` + uuid.NewString() + `"]}`},
		{"subcontractors", http.MethodGet, flat + "subcontractors", ""},
		{"access", http.MethodPut, flat + "subcontractors/" + f.sub.String(), `{"active":false}`},
		{"link", http.MethodGet, flat + "client-link", ""},
		{"issue", http.MethodPost, flat + "client-link", ""},
		{"revoke", http.MethodDelete, flat + "client-link", ""},
	} {
		for _, actor := range []string{"a.repairs-foreman", "a.repairs-foreman-two"} {
			status, _, raw := formsCall(t, actor, c.method, c.path, c.body, nil)
			if status != http.StatusForbidden && status != http.StatusNotFound {
				t.Errorf("%s by %s: %d %s, want 403 or 404", c.name, actor, status, raw)
			}
		}
	}
	// the documents of the object: the foreman of another object sees none, the foreman of the object has no sums
	w615Do(t, "a.repairs-foreman-two", http.MethodGet, flat+"documents", "", http.StatusNotFound)
	if docs := w615Do(t, "a.repairs-foreman", http.MethodGet, flat+"documents", "", http.StatusOK); strings.Contains(docs, `"amount"`) {
		t.Errorf("the foreman reads the sums of the documents: %s", docs)
	}
}

func w615Validation(t *testing.T, f finance) {
	t.Helper()
	flat := repairsA + "projects/{{repair_project:a.flat}}/"
	for _, c := range []struct{ name, method, path, body, field string }{
		{"payout", http.MethodPost, repairsA + "accruals/payout", `{"accrualIds":["` + uuid.Nil.String() + `"]}`, "accrualIds[0]"},
		{"access without a term", http.MethodPut, flat + "subcontractors/" + f.sub.String(), `{"active":true}`, "until"},
		{"access in the past", http.MethodPut, flat + "subcontractors/" + f.sub.String(), `{"active":true,"until":"2001-01-01"}`, "until"},
	} {
		status, _, raw := formsCall(t, "a.owner", c.method, c.path, c.body, nil)
		if status != http.StatusUnprocessableEntity || !strings.Contains(raw, `"`+c.field+`"`) {
			t.Errorf("%s: %d %s, want 422 on %s", c.name, status, raw, c.field)
		}
	}
}
