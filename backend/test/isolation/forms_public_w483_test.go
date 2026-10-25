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

// W4.83 (Q-W4.90-1; critique/stage-4.md П-4): the contract PublicForms requires the Origin of a browser command of a
// guest to be one of the allowlist of the deployment (here ALLOWED_ORIGINS of the target — targetOrigin). Rows:
//   - a foreign site, the opaque «null» and the origin of the target on another port send none of the four commands of
//     a guest (submitPublicForm, initiatePublicUpload, completePublicUpload, getPublicUploadStatus) to a form of
//     tenant A or of tenant B: 403 origin_not_allowed, before the token and the nonce — the token and the nonce of
//     the other organization give the same answer, the answer names neither form nor organization;
//   - a refused command writes nothing: no response, no file in either organization;
//   - the allowed origin is served and writes in its own organization only; a request without Origin is no browser
//     one (Fetch sends Origin with every POST) and is served as the contract requires the header of browsers only.

// w483Call is a POST of a guest without a session from origin ("" — no Origin header).
func w483Call(t *testing.T, path, body, origin string) (int, string) {
	t.Helper()
	var hdr map[string]string
	if origin != "" {
		hdr = map[string]string{"Origin": origin}
	}
	status, _, out := formsCall(t, "", http.MethodPost, path, body, hdr)
	return status, out
}

// w483Initiate issues an upload of the photo question of g to the guest p from the allowed origin.
func w483Initiate(t *testing.T, g guestForm, p guestPage) w490Upload {
	t.Helper()
	status, body := w483Call(t, publicPath(g.token, "/uploads"), w490Initiate(p.version, p.nonce), targetOrigin)
	var tk struct {
		UploadID uuid.UUID `json:"uploadId"`
		FileID   uuid.UUID `json:"fileId"`
	}
	if err := json.Unmarshal([]byte(body), &tk); status != http.StatusCreated || err != nil || tk.UploadID == uuid.Nil {
		t.Fatalf("initiatePublicUpload from %s: %d %s", targetOrigin, status, body)
	}
	return w490Upload{upload: tk.UploadID, file: tk.FileID}
}

//nolint:gocyclo,cyclop // one scenario of rows over the forms, guests and uploads of the run
func TestIsolationFormsPublicW483(t *testing.T) {
	t.Parallel()
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	dbA := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	dbB := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantB], migrations.RoleAPI)

	a := publicFormW490(t, "a.owner", "tenant:a", "Анкета W483 A")
	b := publicFormW490(t, "b.owner", "tenant:b", "Анкета W483 B")
	gA, gB := openGuest(t, a), openGuest(t, b)
	upA, upB := w483Initiate(t, a, gA), w483Initiate(t, b, gB)

	ofA := append(idsOf(t, []string{"tenant:a", "person:a.owner@a"}, a.id, a.version, upA.file, upA.upload), a.token)
	ofB := append(tenantBIDs(t), idsOf(t, nil, b.id, b.version, upB.file, upB.upload)...)
	ofB = append(ofB, b.token)
	both := join(ofA, ofB)

	counts := func() [4]int {
		t.Helper()
		var c [4]int
		if err := dbA.QueryRowContext(t.Context(), `select (select count(*) from forms.responses where form_id = $1),
			(select count(*) from files.objects where owner_type = 'forms.form' and owner_id = $1)`, a.id).Scan(&c[0], &c[1]); err != nil {
			t.Fatal(err)
		}
		if err := dbB.QueryRowContext(t.Context(), `select (select count(*) from forms.responses where form_id = $1),
			(select count(*) from files.objects where owner_type = 'forms.form' and owner_id = $1)`, b.id).Scan(&c[2], &c[3]); err != nil {
			t.Fatal(err)
		}
		return c
	}
	before := counts()

	type request struct{ name, path, body string }
	requests := []request{
		{"submit A", publicPath(a.token, "/responses"), w490Submit(gA.version, gA.nonce)},
		{"submit B", publicPath(b.token, "/responses"), w490Submit(gB.version, gB.nonce)},
		{"submit A with the nonce of B", publicPath(a.token, "/responses"), w490Submit(gB.version, gB.nonce)},
		{"initiate A", publicPath(a.token, "/uploads"), w490Initiate(gA.version, gA.nonce)},
		{"initiate B", publicPath(b.token, "/uploads"), w490Initiate(gB.version, gB.nonce)},
		{"initiate B with the nonce of A", publicPath(b.token, "/uploads"), w490Initiate(gA.version, gA.nonce)},
		{"complete A", uploadPath(a.token, upA.upload, "complete"), w490Complete(gA.nonce)},
		{"complete B", uploadPath(b.token, upB.upload, "complete"), w490Complete(gB.nonce)},
		{"complete the upload of B by the guest of A", uploadPath(a.token, upB.upload, "complete"), w490Complete(gA.nonce)},
		{"status A", uploadPath(a.token, upA.upload, "status"), w490Status(gA.nonce)},
		{"status B", uploadPath(b.token, upB.upload, "status"), w490Status(gB.nonce)},
		{"status of the upload of A to the guest of B", uploadPath(b.token, upA.upload, "status"), w490Status(gB.nonce)},
	}
	foreign := []string{"https://evil.example", "null", strings.Replace(targetOrigin, "http://", "https://", 1), targetOrigin + ":8080"}
	for _, origin := range foreign {
		var first string
		for _, r := range requests {
			status, body := w483Call(t, r.path, r.body, origin)
			if status != http.StatusForbidden || !strings.Contains(body, `"origin_not_allowed"`) {
				t.Errorf("%s from %s: %d %s, want 403 origin_not_allowed", r.name, origin, status, body)
			}
			noneOf(t, r.name+" from "+origin, body, both)
			// Before the token and the nonce: every refusal of an origin is the same answer.
			var p struct{ Code, Detail, Title string }
			_ = json.Unmarshal([]byte(body), &p)
			got := p.Code + "|" + p.Detail + "|" + p.Title
			if first == "" {
				first = got
			} else if got != first {
				t.Errorf("%s from %s: %q, want the answer of every refused origin %q", r.name, origin, got, first)
			}
		}
	}
	if after := counts(); after != before {
		t.Errorf("refused origins wrote: responses A %d→%d, files A %d→%d, responses B %d→%d, files B %d→%d",
			before[0], after[0], before[1], after[1], before[2], after[2], before[3], after[3])
	}

	// The allowed origin: the guest of A reads his upload and sends his response — in A only.
	status, body := w483Call(t, uploadPath(a.token, upA.upload, "status"), w490Status(gA.nonce), targetOrigin)
	if status != http.StatusOK || !strings.Contains(body, upA.file.String()) {
		t.Errorf("status from %s: %d %s, want the own upload", targetOrigin, status, body)
	}
	status, body = w483Call(t, publicPath(a.token, "/responses"), w490Submit(gA.version, gA.nonce), targetOrigin)
	if status != http.StatusCreated || !strings.Contains(body, `"receiptId"`) {
		t.Errorf("submit A from %s: %d %s, want 201", targetOrigin, status, body)
	}
	noneOf(t, "the receipt of A", body, ofB)
	// No Origin — no browser: the guest of B is served — in B only.
	status, body = w483Call(t, publicPath(b.token, "/responses"), w490Submit(gB.version, gB.nonce), "")
	if status != http.StatusCreated || !strings.Contains(body, `"receiptId"`) {
		t.Errorf("submit B without Origin: %d %s, want 201", status, body)
	}
	noneOf(t, "the receipt of B", body, ofA)
	if after := counts(); after != [4]int{before[0] + 1, before[1], before[2] + 1, before[3]} {
		t.Errorf("accepted guests: %v → %v, want one response in A and one in B, no file more", before, after)
	}
}
