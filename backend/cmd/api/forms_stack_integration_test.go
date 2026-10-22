//go:build integration

package main

import (
	"net/http"
	"net/url"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// W4.21 end to end: the owner of «Альта» makes a public form over HTTP (createForm with a definition, «Доступ —
// по ссылке» with an explicit null of the group, publishForm), a guest without a session reads it by its token and
// sends a response; AC-08 — the token of a public form opens nothing else: an operation of a tenant with the token
// (a header, a query, a path under the link) answers 401 or 404, never data.
func TestStackForms(t *testing.T) { //nolint:paralleltest // one seeded stack; creates a form of t_alta
	srv := server(t)
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String()
	body := `{"name":"Отзыв о доставке W421","definition":{"pages":[{"id":"p1","title":"Страница 1"}],
		"fields":[{"key":"q-text","pageId":"p1","type":"text","label":"Ваш отзыв","required":true}]}}`
	status, _, form := owner.do(http.MethodPost, base+"/forms", body, map[string]string{"Idempotency-Key": "w421-stack-create"})
	id, _ := form["id"].(string)
	if status != http.StatusCreated || id == "" {
		t.Fatalf("create: %d %v", status, form)
	}
	patch := `{"groupId":null,"settings":{"access":"public","acceptUntil":null}}`
	status, hdr, form := owner.do(http.MethodPatch, base+"/forms/"+id, patch, map[string]string{"Idempotency-Key": "w421-stack-public",
		"If-Match": `"rev-1"`})
	if settings, _ := form["settings"].(map[string]any); status != http.StatusOK || settings["access"] != "public" {
		t.Fatalf("public: %d %v", status, form)
	}
	status, _, form = owner.do(http.MethodPost, base+"/forms/"+id+"/publish", `{"draftRevision":1}`,
		map[string]string{"Idempotency-Key": "w421-stack-publish", "If-Match": hdr.Get("ETag")})
	share, _ := form["share"].(map[string]any)
	token, _ := share["publicToken"].(string)
	if status != http.StatusOK || len(token) < 32 {
		t.Fatalf("publish: %d %v", status, form)
	}
	stackGuest(t, newBrowser(t, srv), token)
	stackTokenScope(t, newBrowser(t, srv), base, token)
	stackSeedForms(t, owner, base)
}

// stackSeedForms reads the forms of the Go seed (cmd/seed/forms.go): «Осмотр машины» acting v3 with R-1012 and R-0988,
// the newest first, the line «в БЗ» in the journal of each.
func stackSeedForms(t *testing.T, owner *browser, base string) {
	t.Helper()
	insp := base + "/forms/" + uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fm-insp")).String()
	status, _, form := owner.do(http.MethodGet, insp, "", nil)
	if status != http.StatusOK || form["name"] != "Осмотр машины" || form["publishedVersionNumber"] != float64(3) {
		t.Fatalf("fm-insp: %d %v", status, form)
	}
	status, _, page := owner.do(http.MethodGet, insp+"/responses", "", nil)
	items, _ := page["items"].([]any)
	if status != http.StatusOK || len(items) != 2 {
		t.Fatalf("responses: %d %v", status, page)
	}
	first, _ := items[0].(map[string]any)
	actions, _ := first["actions"].([]any)
	if first["number"] != "R-1012" || len(actions) != 1 {
		t.Fatalf("R-1012: %v", first)
	}
}

// stackGuest reads the public form without a session and sends a response: it waits for the review.
func stackGuest(t *testing.T, guest *browser, token string) {
	t.Helper()
	status, _, pub := guest.do(http.MethodGet, "/api/v1/public/forms/"+token, "", nil)
	nonce, _ := pub["submissionNonce"].(string)
	version, _ := pub["versionId"].(string)
	if status != http.StatusOK || nonce == "" || pub["presentation"] == nil {
		t.Fatalf("public form: %d %v", status, pub)
	}
	body := `{"versionId":"` + version + `","submissionNonce":"` + nonce + `","answers":[{"fieldKey":"q-text","value":{"type":"text","value":"Всё вовремя"}}]}`
	key := map[string]string{"Idempotency-Key": "w421-stack-guest"}
	status, _, receipt := guest.do(http.MethodPost, "/api/v1/public/forms/"+token+"/responses", body, key)
	if status != http.StatusCreated || receipt["receiptId"] == nil {
		t.Fatalf("submit: %d %v", status, receipt)
	}
	status, hdr, again := guest.do(http.MethodPost, "/api/v1/public/forms/"+token+"/responses", body, key)
	if status != http.StatusCreated || hdr.Get("Idempotency-Replayed") != "true" || again["receiptId"] != receipt["receiptId"] {
		t.Fatalf("the same answers with the same nonce: %d %v, want the receipt again", status, again)
	}
}

// stackTokenScope: AC-08 — the token of a public link is no credential of a tenant.
func stackTokenScope(t *testing.T, guest *browser, base, token string) {
	t.Helper()
	for _, c := range []struct {
		path string
		hdr  map[string]string
		want []int
	}{
		{base + "/fleet/vehicles", map[string]string{"Authorization": "Bearer " + token}, []int{http.StatusUnauthorized}},
		{base + "/fleet/vehicles?publicToken=" + url.QueryEscape(token), nil, []int{http.StatusUnauthorized}},
		{base + "/forms", map[string]string{"X-Public-Token": token}, []int{http.StatusUnauthorized}},
		{"/api/v1/public/forms/" + token + "/fleet/vehicles", nil, []int{http.StatusNotFound}},
		{"/api/v1/public/forms/" + token + "/../../tenants/" + seedAlta.String() + "/fleet/vehicles", nil,
			[]int{http.StatusUnauthorized, http.StatusNotFound}},
	} {
		status, _, res := guest.do(http.MethodGet, c.path, "", c.hdr)
		if !slices.Contains(c.want, status) || res["items"] != nil {
			t.Fatalf("%s: %d %v, want %v", c.path, status, res, c.want)
		}
	}
}
