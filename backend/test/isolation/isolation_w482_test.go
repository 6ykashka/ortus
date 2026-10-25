//go:build isolation

package isolation

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// W4.82: what the rows of calendar_w482.yaml, knowledge_w482.yaml and branding cannot carry — the commands with If-Match
// (the rows send no headers, README «Цель набора») and a list filtered by a hidden object. The fixtures are WithInTenant
// (content_inside.go):
//   - updateCalendarBooking: the booking of Москва-2 for the calendar of Москва-1 (a.calendar-msk1) answers exactly as a
//     booking that does not exist even with its right If-Match, and stays as it was; its own booking with a stale
//     If-Match reaches the precondition (412) — the 404 is not a blanket refusal (Q-W4.40-6);
//   - listCalendarBookings?resourceId= of the room of Москва-2 — an empty page, as of a resource that does not exist;
//   - publishKnowledgeNodeVersion: the node «Только выбранные» and the page of the closed space for a reader without
//     access (a.manager-msk1) — 404 as a node that does not exist, with the right If-Match; the reader in the list
//     (a.manager-msk2) sees the node and may not edit it — 403; no version is written (Q-W4.04-11);
//   - updateTenantBranding of the owner with the If-Match of the version in force — 200 without the ids of tenant B
//     (Q-W4.60-3; uploadBrandingAsset needs the storage the target of the suite lacks — integration tests with MinIO).

// problemOf is the status, the code and the detail of an answer (a Problem or not).
type problemOf struct {
	status       int
	code, detail string
}

func w482Problem(t *testing.T, actor, method, path, body string, hdr map[string]string) problemOf {
	t.Helper()
	status, _, raw := formsCall(t, actor, method, path, body, hdr)
	var p struct{ Code, Detail string }
	_ = json.Unmarshal([]byte(raw), &p) // not a Problem — the code stays empty and the comparison tells it
	return problemOf{status: status, code: p.Code, detail: p.Detail}
}

// TestIsolationInsideW482 is not parallel: it runs alone, before the parallel tests of the suite continue. Its
// concurrent reads of forms hold the whole pool of tenant A (three connections beside the listener) for a while, and a
// row of another file measured meanwhile would see the queue as a difference of response times (AC-01).
//
//nolint:paralleltest // see above
func TestIsolationInsideW482(t *testing.T) {
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	t.Run("calendar", func(t *testing.T) { w482Calendar(t, w) })
	t.Run("knowledge", func(t *testing.T) { w482Knowledge(t, w) })
	t.Run("branding", func(t *testing.T) { w482Branding(t) })
	t.Run("forms in parallel", func(t *testing.T) { w482FormsParallel(t) })
}

// w482FormsParallel: the rows of forms_w482.yaml run in parallel, and the responses about trips are read through the
// port of objects. Concurrent reads — more than the pool of the tenant (tenantctx.DefaultMaxConns): the responses of the
// logist (the port) and a response hidden from a.forms-self — must all answer. A read that waits for a connection of the
// pool for the port while it holds its transaction hangs once every connection is held so (the suite hung, W4.82).
func w482FormsParallel(t *testing.T) {
	t.Helper()
	type call struct {
		actor, path string
		want        int
		has         string
	}
	calls := []call{
		{"a.forms-logist", "/api/v1/tenants/{{tenant:a}}/forms/{{form:a.insp}}/responses", http.StatusOK, "form_response:a.insp-trip-msk1"},
		{"a.forms-self", "/api/v1/tenants/{{tenant:a}}/forms/{{form:a.insp}}/responses/{{form_response:a.insp-1}}", http.StatusNotFound, ""},
	}
	const copies = 12
	type result struct {
		c      call
		status int
		body   string
	}
	out, start := make(chan result, copies*len(calls)), make(chan struct{})
	for range copies {
		for _, c := range calls {
			actor, err := suite.Refs.Actor(c.actor)
			if err != nil {
				t.Fatal(err)
			}
			path := formsRefRe.ReplaceAllStringFunc(c.path, func(m string) string { return refID(t, m[2:len(m)-2]).String() })
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
			if err := suite.Target.Authenticate(req, actor); err != nil {
				t.Fatal(err)
			}
			go func() {
				<-start // all together: the reads meet in their transactions
				rec := httptest.NewRecorder()
				suite.Target.Handler.ServeHTTP(rec, req)
				out <- result{c, rec.Code, rec.Body.String()}
			}()
		}
	}
	close(start)
	deadline := time.After(45 * time.Second)
	for i := range copies * len(calls) {
		select {
		case r := <-out:
			if r.status != r.c.want || (r.c.has != "" && !strings.Contains(r.body, refID(t, r.c.has).String())) {
				t.Errorf("concurrent %s %s: %d %s, want %d with %s", r.c.actor, r.c.path, r.status, r.body, r.c.want, r.c.has)
			}
		case <-deadline:
			t.Fatalf("concurrent reads of forms: %d of %d answered in 45 s — the reads hang", i, copies*len(calls))
		}
	}
}

func w482Calendar(t *testing.T, w *fixtures.World) {
	t.Helper()
	const bookings = "/api/v1/tenants/{{tenant:a}}/calendar/bookings/"
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	state := func() string {
		var s string
		if err := db.QueryRowContext(t.Context(), `select b.status || ' ' || b.revision || ' ' || lower(b.during)::text || ' ' ||
			(select string_agg(x.state, ',') from sched.reservations x where x.bundle_id = b.id) from sched.bookings b where b.id = $1`,
			refID(t, "booking:a.msk2")).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := state()
	rev1 := map[string]string{"If-Match": `"rev-1"`}
	for _, body := range []string{`{"action":"cancel"}`, `{"action":"reschedule","window":{"startsAt":"2026-10-01T12:00:00Z",` +
		`"endsAt":"2026-10-01T13:00:00Z","timeZone":"Europe/Moscow"},"resources":[{"kind":"room","resourceId":"{{cal_resource:a.room-msk2}}"}]}`} {
		missing := w482Problem(t, "a.calendar-msk1", http.MethodPatch, bookings+uuid.NewString(), body, rev1)
		got := w482Problem(t, "a.calendar-msk1", http.MethodPatch, bookings+"{{booking:a.msk2}}", body, rev1)
		if got != missing || got.status != http.StatusNotFound || got.code != "not_found" {
			t.Errorf("updateCalendarBooking %s of Москва-2: %+v, want as a missing booking %+v (404 not_found)", body, got, missing)
		}
	}
	if after := state(); after != before {
		t.Errorf("a refused command changed booking:a.msk2: %q → %q", before, after)
	}
	own := w482Problem(t, "a.calendar-msk1", http.MethodPatch, bookings+"{{booking:a.msk1}}", `{"action":"cancel"}`,
		map[string]string{"If-Match": `"rev-999"`})
	if own.status != http.StatusPreconditionFailed || own.code != "revision_mismatch" {
		t.Errorf("updateCalendarBooking of the own booking with a stale If-Match: %+v, want 412 revision_mismatch", own)
	}

	list := "/api/v1/tenants/{{tenant:a}}/calendar/bookings?resourceId="
	status, _, hidden := formsCall(t, "a.calendar-msk1", http.MethodGet, list+"{{cal_resource:a.room-msk2}}", "", nil)
	_, _, unknown := formsCall(t, "a.calendar-msk1", http.MethodGet, list+uuid.NewString(), "", nil)
	if status != http.StatusOK || !strings.Contains(hidden, `"items":[]`) || !strings.Contains(unknown, `"items":[]`) {
		t.Errorf("listCalendarBookings of the room of Москва-2: %d %s, want an empty page as of an unknown resource (%s)",
			status, hidden, unknown)
	}
	if id := refID(t, "booking:a.msk2").String(); strings.Contains(hidden, id) {
		t.Errorf("the bookings of the room of Москва-2 name booking:a.msk2: %s", hidden)
	}
}

func w482Knowledge(t *testing.T, w *fixtures.World) {
	t.Helper()
	const nodes = "/api/v1/tenants/{{tenant:a}}/knowledge/nodes/"
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	versions := func() int {
		var n int
		if err := db.QueryRowContext(t.Context(), `select count(*) from kb.versions where node_id = any($1)`,
			[]uuid.UUID{refID(t, "kb_node:a.listed"), refID(t, "kb_node:a.closed-page")}).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := versions()
	rev1 := map[string]string{"If-Match": `"rev-1"`}
	const body = `{"body":"Новый текст W482."}`
	missing := w482Problem(t, "a.manager-msk1", http.MethodPost, nodes+uuid.NewString()+"/versions", body, rev1)
	for _, node := range []string{"kb_node:a.listed", "kb_node:a.closed-page"} {
		got := w482Problem(t, "a.manager-msk1", http.MethodPost, nodes+"{{"+node+"}}/versions", body, rev1)
		if got != missing || got.status != http.StatusNotFound || got.code != "not_found" {
			t.Errorf("publishKnowledgeNodeVersion of %s by a reader without access: %+v, want as a missing node %+v (404)", node, got, missing)
		}
	}
	reader := w482Problem(t, "a.manager-msk2", http.MethodPost, nodes+"{{kb_node:a.listed}}/versions", body, rev1)
	if reader.status != http.StatusForbidden || reader.code != "forbidden_action" {
		t.Errorf("publishKnowledgeNodeVersion of kb_node:a.listed by its reader: %+v, want 403 forbidden_action", reader)
	}
	if after := versions(); after != before {
		t.Errorf("refused publications wrote versions: %d → %d", before, after)
	}
}

func w482Branding(t *testing.T) {
	t.Helper()
	const path = "/api/v1/tenants/{{tenant:a}}/branding"
	status, hdr, raw := formsCall(t, "a.owner", http.MethodGet, path, "", nil)
	var cur struct {
		AccentHex   string          `json:"accentHex"`
		DisplayName string          `json:"displayName"`
		ShortName   *string         `json:"shortName"`
		PoweredBy   bool            `json:"poweredBy"`
		Terms       json.RawMessage `json:"terms"`
		Menu        json.RawMessage `json:"menu"`
		Logo, Mark  *struct {
			ID uuid.UUID `json:"id"`
		}
		Version int `json:"version"`
	}
	if err := json.Unmarshal([]byte(raw), &cur); status != http.StatusOK || err != nil || hdr.Get("ETag") == "" {
		t.Fatalf("getTenantBranding: %d %s %v", status, raw, err)
	}
	asset := func(a *struct {
		ID uuid.UUID `json:"id"`
	}) *uuid.UUID {
		if a == nil {
			return nil
		}
		return &a.ID
	}
	update, err := json.Marshal(map[string]any{
		"displayName": cur.DisplayName, "shortName": cur.ShortName, "accentHex": cur.AccentHex, "logoAssetId": asset(cur.Logo),
		"markAssetId": asset(cur.Mark), "terms": cur.Terms, "menu": cur.Menu, "poweredBy": cur.PoweredBy,
	})
	if err != nil {
		t.Fatal(err)
	}
	status, _, raw = formsCall(t, "a.owner", http.MethodPut, path, string(update), map[string]string{"If-Match": hdr.Get("ETag")})
	var saved struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal([]byte(raw), &saved); status != http.StatusOK || err != nil || saved.Version != cur.Version+1 {
		t.Fatalf("updateTenantBranding of the owner: %d %s, want 200 with version %d", status, raw, cur.Version+1)
	}
	noneOf(t, "the branding of A", raw, []string{refID(t, "tenant:b").String(), refID(t, "account:b.owner").String()})
}
