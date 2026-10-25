//go:build isolation

package isolation

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// W4.90 (выход этапа 4, уточнение 24.10): rows of the guest of a public form the matrix of forms_w405.yaml does not
// carry — submitPublicForm and the uploads of a guest (initiatePublicUpload, completePublicUpload,
// getPublicUploadStatus). A token and a submission nonce are made at run time and a guest has no session (the runner
// of the YAML rows sends no Idempotency-Key without one), so these rows send their requests themselves, as
// forms_w405_body_test.go does for getPublicForm (W4.21):
//   - the nonce of one link opens no other link: another form of the same organization, a form of tenant B — 422
//     validation_failed on submissionNonce, the answer names nothing of the other form or organization;
//   - a version of tenant B in the body of a guest of tenant A — 409 form_version_changed, B is not named;
//   - an unknown token, an index row without its pair in the tenant, an index row that sends a token of A to tenant B
//     and a revoked link — 404 not_found as an unknown token, for the command and for the uploads;
//   - the upload of one guest is no business of another guest of the same form nor of a guest of tenant B: status and
//     completion answer 404 exactly as an unknown upload (AC-01), the file is not named;
//   - a refused request writes nothing: no response, no file in either organization; the accepted ones write in
//     their own organization only.

// guestForm is a published public form of the isolation run with its token.
type guestForm struct {
	id, version uuid.UUID
	token       string
}

// guestPage is what a guest receives opening a public form: the acting version and a submission nonce.
type guestPage struct {
	version uuid.UUID
	nonce   string
}

// w490Upload is the ticket of an upload of a guest.
type w490Upload struct {
	upload, file uuid.UUID
}

const w490SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

// publicFormW490 is a public form with a question «Файл или фото» that actor creates and publishes in tenant over HTTP.
func publicFormW490(t *testing.T, actor, tenant, name string) guestForm {
	t.Helper()
	forms := "/api/v1/tenants/{{" + tenant + "}}/forms"
	status, _, body := formsCall(t, actor, http.MethodPost, forms, `{"name":"`+name+`","orgUnitId":null,`+
		`"definition":{"pages":[{"id":"p1","title":"Страница 1"}],"fields":[{"key":"q-text","pageId":"p1","type":"text",`+
		`"label":"Отзыв","required":true},{"key":"q-photo","pageId":"p1","type":"photo","label":"Фото","required":false}]}}`, nil)
	var form struct {
		ID    uuid.UUID `json:"id"`
		Share struct {
			PublicToken string `json:"publicToken"`
		} `json:"share"`
	}
	if err := json.Unmarshal([]byte(body), &form); status != http.StatusCreated || err != nil {
		t.Fatalf("createForm %s: %d %s", name, status, body)
	}
	path := forms + "/" + form.ID.String()
	status, hdr, body := formsCall(t, actor, http.MethodPatch, path, `{"settings":{"access":"public"}}`,
		map[string]string{"If-Match": `"rev-1"`})
	if status != http.StatusOK {
		t.Fatalf("updateForm %s: %d %s", name, status, body)
	}
	status, _, body = formsCall(t, actor, http.MethodPost, path+"/publish", `{"draftRevision":1}`,
		map[string]string{"If-Match": hdr.Get("ETag")})
	if err := json.Unmarshal([]byte(body), &form); status != http.StatusOK || err != nil || form.Share.PublicToken == "" {
		t.Fatalf("publishForm %s: %d %s", name, status, body)
	}
	g := guestForm{id: form.ID, token: form.Share.PublicToken}
	g.version = openGuest(t, g).version
	return g
}

// openGuest opens the public form of g as a new guest (getPublicForm).
func openGuest(t *testing.T, g guestForm) guestPage {
	t.Helper()
	status, _, body := formsCall(t, "", http.MethodGet, "/api/v1/public/forms/"+g.token, "", nil)
	var p struct {
		VersionID       uuid.UUID `json:"versionId"`
		SubmissionNonce string    `json:"submissionNonce"`
		UploadAllowed   bool      `json:"uploadAllowed"`
	}
	if err := json.Unmarshal([]byte(body), &p); status != http.StatusOK || err != nil || p.SubmissionNonce == "" || !p.UploadAllowed {
		t.Fatalf("getPublicForm: %d %s, want the form with a nonce and uploads", status, body)
	}
	return guestPage{version: p.VersionID, nonce: p.SubmissionNonce}
}

func w490Submit(version uuid.UUID, nonce string) string {
	return `{"versionId":"` + version.String() + `","submissionNonce":"` + nonce + `",` +
		`"answers":[{"fieldKey":"q-text","value":{"type":"text","value":"Отзыв гостя W490"}}]}`
}

func w490Initiate(version uuid.UUID, nonce string) string {
	return `{"versionId":"` + version.String() + `","submissionNonce":"` + nonce + `","fieldKey":"q-photo",` +
		`"fileName":"guest-w490.jpg","contentType":"image/jpeg","sizeBytes":1024,"sha256":"` + w490SHA + `"}`
}

func w490Complete(nonce string) string {
	return `{"submissionNonce":"` + nonce + `","sha256":"` + w490SHA + `"}`
}

func w490Status(nonce string) string { return `{"submissionNonce":"` + nonce + `"}` }

func publicPath(token, rest string) string { return "/api/v1/public/forms/" + token + rest }

func uploadPath(token string, upload uuid.UUID, op string) string {
	return publicPath(token, "/uploads/"+upload.String()+"/"+op)
}

// initiateW490 issues an upload of the photo question of g to the guest p.
func initiateW490(t *testing.T, g guestForm, p guestPage) w490Upload {
	t.Helper()
	status, _, body := formsCall(t, "", http.MethodPost, publicPath(g.token, "/uploads"), w490Initiate(p.version, p.nonce), nil)
	var tk struct {
		UploadID uuid.UUID `json:"uploadId"`
		FileID   uuid.UUID `json:"fileId"`
	}
	if err := json.Unmarshal([]byte(body), &tk); status != http.StatusCreated || err != nil || tk.UploadID == uuid.Nil {
		t.Fatalf("initiatePublicUpload: %d %s", status, body)
	}
	return w490Upload{upload: tk.UploadID, file: tk.FileID}
}

// guestProblem is the status, the code and the detail of the answer to a POST of a guest: two refusals of AC-01 must
// not differ in them.
func guestProblem(t *testing.T, path, body string) [3]string {
	t.Helper()
	status, _, out := formsCall(t, "", http.MethodPost, path, body, nil)
	var p struct {
		Code   string `json:"code"`
		Detail string `json:"detail"`
	}
	_ = json.Unmarshal([]byte(out), &p)
	return [3]string{http.StatusText(status), p.Code, p.Detail}
}

// join is a new slice of the ids of lists (never shares their backing arrays).
func join(lists ...[]string) []string {
	var out []string
	for _, l := range lists {
		out = append(out, l...)
	}
	return out
}

func idsOf(t *testing.T, refs []string, extra ...uuid.UUID) []string {
	t.Helper()
	out := make([]string, 0, len(refs)+len(extra))
	for _, r := range refs {
		out = append(out, refID(t, r).String())
	}
	for _, id := range extra {
		out = append(out, id.String())
	}
	return out
}

//nolint:gocyclo,cyclop,maintidx // one scenario of rows over shared forms, guests and uploads of the run
func TestIsolationFormsPublicW490(t *testing.T) {
	t.Parallel()
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	dbA := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	dbB := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantB], migrations.RoleAPI)
	ctl := w.Cluster.DB(t, w.ControlDB, migrations.RoleAPI)

	a1 := publicFormW490(t, "a.owner", "tenant:a", "Анкета W490 A1")
	a2 := publicFormW490(t, "a.owner", "tenant:a", "Анкета W490 A2")
	b := publicFormW490(t, "b.owner", "tenant:b", "Анкета W490 B")
	gA1, gA1b, gA2, gB := openGuest(t, a1), openGuest(t, a1), openGuest(t, a2), openGuest(t, b)

	ofB := append(tenantBIDs(t), idsOf(t, nil, b.id, b.version)...)
	ofA := idsOf(t, []string{"tenant:a", "form:a.insp", "form_version:a.insp", "person:a.owner@a"}, a1.id, a1.version, a2.id, a2.version)
	ofA2 := idsOf(t, nil, a2.id, a2.version)

	upA := initiateW490(t, a1, gA1)
	upB := initiateW490(t, b, gB)
	ofB = append(ofB, upB.file.String())
	ofA = append(ofA, upA.file.String())

	// The uploads are files of their own organization only: the form is the parent, nothing in the other tenant.
	var n int
	for _, c := range []struct {
		name string
		got  func() (int, error)
		want int
	}{
		{"the upload of A1 in tenant A", func() (int, error) {
			err := dbA.QueryRowContext(t.Context(), `select count(*) from files.objects where id = $1 and owner_type = 'forms.form'
				and owner_id = $2 and purpose = 'form_attachment'`, upA.file, a1.id).Scan(&n)
			return n, err
		}, 1},
		{"the upload of A1 in tenant B", func() (int, error) {
			err := dbB.QueryRowContext(t.Context(), `select count(*) from files.objects where id = $1`, upA.file).Scan(&n)
			return n, err
		}, 0},
		{"the upload of B in tenant B", func() (int, error) {
			err := dbB.QueryRowContext(t.Context(), `select count(*) from files.objects where id = $1 and owner_id = $2`, upB.file, b.id).Scan(&n)
			return n, err
		}, 1},
		{"the upload of B in tenant A", func() (int, error) {
			err := dbA.QueryRowContext(t.Context(), `select count(*) from files.objects where id = $1`, upB.file).Scan(&n)
			return n, err
		}, 0},
	} {
		if got, err := c.got(); err != nil || got != c.want {
			t.Errorf("%s: %d %v, want %d", c.name, got, err, c.want)
		}
	}

	// Forged index rows of the control DB (as forms_w405_body_test.go): one without its pair in the tenant, one that
	// sends a token to tenant B with the link of A1.
	var linkA1 uuid.UUID
	if err := dbA.QueryRowContext(t.Context(), `select id from forms.public_links where token_digest = $1`, digestOf(a1.token)).
		Scan(&linkA1); err != nil {
		t.Fatal(err)
	}
	index := func(token string, tenant, form, link uuid.UUID) {
		t.Helper()
		if _, err := ctl.ExecContext(t.Context(), `insert into public_form_links (token_digest, tenant_id, form_id, link_id, key_version)
			values ($1, $2, $3, $4, 1)`, digestOf(token), tenant, form, link); err != nil {
			t.Fatal(err)
		}
	}
	orphan, toB, unknown := "w490-orphan-"+uuid.NewString(), "w490-to-b-"+uuid.NewString(), "w490-unknown-"+uuid.NewString()
	index(orphan, refID(t, "tenant:a"), a1.id, uuid.New())
	index(toB, refID(t, "tenant:b"), b.id, linkA1)

	counts := func() [4]int {
		t.Helper()
		var c [4]int
		if err := dbA.QueryRowContext(t.Context(), `select (select count(*) from forms.responses where form_id = any($1)),
			(select count(*) from files.objects where owner_type = 'forms.form' and owner_id = any($1))`,
			[]uuid.UUID{a1.id, a2.id}).Scan(&c[0], &c[1]); err != nil {
			t.Fatal(err)
		}
		if err := dbB.QueryRowContext(t.Context(), `select (select count(*) from forms.responses where form_id = $1),
			(select count(*) from files.objects where owner_type = 'forms.form' and owner_id = $1)`, b.id).Scan(&c[2], &c[3]); err != nil {
			t.Fatal(err)
		}
		return c
	}
	before := counts()

	const (
		invalid  = "validation_failed"
		notFound = "not_found"
		moved    = "invalid_transition"
	)
	submit, uploads := "/responses", "/uploads"
	cases := []struct {
		name, path, body string
		want             int
		code, field      string
		foreign          []string
	}{
		// submitPublicForm
		{"submit: the token of A1 with the nonce of B", publicPath(a1.token, submit), w490Submit(gB.version, gB.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", ofB},
		{"submit: the token of A1 with the nonce of A2", publicPath(a1.token, submit), w490Submit(a1.version, gA2.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", join(ofB, ofA2)},
		{"submit: the token of B with the nonce of A1", publicPath(b.token, submit), w490Submit(b.version, gA1.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", ofA},
		{"submit: the version of B with the token and the nonce of A1", publicPath(a1.token, submit), w490Submit(b.version, gA1b.nonce),
			http.StatusConflict, moved, "", ofB},
		{"submit: an unknown token", publicPath(unknown, submit), w490Submit(a1.version, gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		{"submit: an index row without its pair in the tenant", publicPath(orphan, submit), w490Submit(a1.version, gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		{"submit: an index row that sends the link of A1 to tenant B", publicPath(toB, submit), w490Submit(a1.version, gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		// initiatePublicUpload
		{"initiate: the token of A1 with the nonce of B", publicPath(a1.token, uploads), w490Initiate(a1.version, gB.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", ofB},
		{"initiate: the token of B with the nonce of A1", publicPath(b.token, uploads), w490Initiate(b.version, gA1b.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", ofA},
		{"initiate: the token of A1 with the nonce of A2", publicPath(a1.token, uploads), w490Initiate(a1.version, gA2.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", join(ofB, ofA2)},
		{"initiate: the version of B with the token and the nonce of A1", publicPath(a1.token, uploads), w490Initiate(b.version, gA1b.nonce),
			http.StatusConflict, moved, "", ofB},
		{"initiate: an unknown token", publicPath(unknown, uploads), w490Initiate(a1.version, gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		{"initiate: an index row without its pair in the tenant", publicPath(orphan, uploads), w490Initiate(a1.version, gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		{"initiate: an index row that sends the link of A1 to tenant B", publicPath(toB, uploads), w490Initiate(a1.version, gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		// getPublicUploadStatus
		{"status: the upload of A1 to another guest of A1", uploadPath(a1.token, upA.upload, "status"), w490Status(gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofB, []string{upA.file.String()})},
		{"status: the upload of A1 to a guest of B", uploadPath(b.token, upA.upload, "status"), w490Status(gB.nonce),
			http.StatusNotFound, notFound, "", ofA},
		{"status: the upload of B to a guest of A1", uploadPath(a1.token, upB.upload, "status"), w490Status(gA1.nonce),
			http.StatusNotFound, notFound, "", ofB},
		{"status: the token of A1 with the nonce of B", uploadPath(a1.token, upB.upload, "status"), w490Status(gB.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", ofB},
		{"status: an unknown token", uploadPath(unknown, upA.upload, "status"), w490Status(gA1.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		{"status: an index row that sends the link of A1 to tenant B", uploadPath(toB, upA.upload, "status"), w490Status(gA1.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		// completePublicUpload
		{"complete: the upload of A1 by another guest of A1", uploadPath(a1.token, upA.upload, "complete"), w490Complete(gA1b.nonce),
			http.StatusNotFound, notFound, "", join(ofB, []string{upA.file.String()})},
		{"complete: the upload of A1 by a guest of B", uploadPath(b.token, upA.upload, "complete"), w490Complete(gB.nonce),
			http.StatusNotFound, notFound, "", ofA},
		{"complete: the upload of B by a guest of A1", uploadPath(a1.token, upB.upload, "complete"), w490Complete(gA1.nonce),
			http.StatusNotFound, notFound, "", ofB},
		{"complete: the token of A1 with the nonce of B", uploadPath(a1.token, upB.upload, "complete"), w490Complete(gB.nonce),
			http.StatusUnprocessableEntity, invalid, "submissionNonce", ofB},
		{"complete: an unknown token", uploadPath(unknown, upA.upload, "complete"), w490Complete(gA1.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
		{"complete: an index row without its pair in the tenant", uploadPath(orphan, upA.upload, "complete"), w490Complete(gA1.nonce),
			http.StatusNotFound, notFound, "", join(ofA, ofB)},
	}
	for _, c := range cases {
		status, _, body := formsCall(t, "", http.MethodPost, c.path, c.body, nil)
		if status != c.want || !strings.Contains(body, `"`+c.code+`"`) || (c.field != "" && !strings.Contains(body, `"`+c.field+`"`)) {
			t.Errorf("%s: %d %s, want %d %s %s", c.name, status, body, c.want, c.code, c.field)
		}
		if c.code == moved && !strings.Contains(body, `"form_version_changed"`) {
			t.Errorf("%s: %s, want the reason form_version_changed", c.name, body)
		}
		noneOf(t, c.name, body, c.foreign)
	}

	// AC-01: the upload of another guest or of another organization answers exactly as an upload that does not exist.
	for _, op := range []string{"status", "complete"} {
		body := func(nonce string) string {
			if op == "status" {
				return w490Status(nonce)
			}
			return w490Complete(nonce)
		}
		missing := guestProblem(t, uploadPath(a1.token, uuid.New(), op), body(gA1b.nonce))
		if got := guestProblem(t, uploadPath(a1.token, upA.upload, op), body(gA1b.nonce)); got != missing {
			t.Errorf("%s: the upload of another guest %v, an unknown upload %v", op, got, missing)
		}
		if got := guestProblem(t, uploadPath(a1.token, upB.upload, op), body(gA1.nonce)); got != missing {
			t.Errorf("%s: the upload of tenant B %v, an unknown upload %v", op, got, missing)
		}
	}

	if after := counts(); after != before {
		t.Errorf("refused requests of guests wrote: responses A %d→%d, files A %d→%d, responses B %d→%d, files B %d→%d",
			before[0], after[0], before[1], after[1], before[2], after[2], before[3], after[3])
	}

	// Accepted: the guest reads the state of his own upload, his response is written in his organization only.
	status, _, body := formsCall(t, "", http.MethodPost, uploadPath(a1.token, upA.upload, "status"), w490Status(gA1.nonce), nil)
	if status != http.StatusOK || !strings.Contains(body, upA.file.String()) {
		t.Errorf("status of the own upload: %d %s, want the file %s", status, body, upA.file)
	}
	noneOf(t, "status of the own upload", body, ofB)
	status, _, body = formsCall(t, "", http.MethodPost, publicPath(a1.token, submit), w490Submit(gA1.version, gA1.nonce), nil)
	if status != http.StatusCreated || !strings.Contains(body, `"receiptId"`) {
		t.Errorf("submitPublicForm of the guest of A1: %d %s, want 201", status, body)
	}
	noneOf(t, "the receipt of A1", body, ofB)
	if after := counts(); after[0] != before[0]+1 || after[2] != before[2] {
		t.Errorf("the response of the guest of A1: responses A %d→%d, B %d→%d, want +1 in A only", before[0], after[0], before[2], after[2])
	}

	// A revoked link opens neither the command nor the uploads of its guest.
	if _, err := dbA.ExecContext(t.Context(), `update forms.public_links set revoked_at = now() where form_id = $1`, a2.id); err != nil {
		t.Fatal(err)
	}
	for name, req := range map[string][2]string{
		"submit":   {publicPath(a2.token, submit), w490Submit(gA2.version, gA2.nonce)},
		"initiate": {publicPath(a2.token, uploads), w490Initiate(gA2.version, gA2.nonce)},
		"status":   {uploadPath(a2.token, upA.upload, "status"), w490Status(gA2.nonce)},
	} {
		status, _, body := formsCall(t, "", http.MethodPost, req[0], req[1], nil)
		if status != http.StatusNotFound || !strings.Contains(body, `"not_found"`) {
			t.Errorf("%s by a revoked link: %d %s, want 404 not_found", name, status, body)
		}
	}
}
