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

// W6.12: what the rows of repairs_w600.yaml cannot carry — the commands with If-Match and the ids of rows the commands
// create (the rows send no headers and name only the objects of the fixtures, README «Цель набора»). Through the whole
// stack (gateway, strict server, module):
//   - estimates: the owner measures «Лесную» and builds a draft from a starter template; the foreman of the object
//     sees no estimates (no repairs.finance.read), the foreman of another object gets the answer of a missing object
//     for every read and command, and a refused command leaves the version as it was;
//   - change orders: the foreman proposes one, the foreman of another object cannot see, list or reject it, the owner
//     rejects it and the foreman reads the reason;
//   - the catalog: an item and a template of tenant A are missing for the owner of B and for a foreman of A who does
//     not keep the catalog.

// Not parallel: the draft estimate and the change orders change «Лесную» for the rows of the file that run later.
//
//nolint:paralleltest // see above
func TestIsolationRepairsW612(t *testing.T) {
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	t.Run("estimates", func(t *testing.T) { w612Estimates(t, w) })
	t.Run("change orders", func(t *testing.T) { w612Changes(t) })
	t.Run("catalog", w612Catalog)
}

type created struct {
	ID      uuid.UUID `json:"id"`
	Version int       `json:"version"`
	Source  string    `json:"source"`
}

func w612Do(t *testing.T, actor, method, path, body string, want int, hdr map[string]string) (http.Header, string) {
	t.Helper()
	status, h, raw := formsCall(t, actor, method, path, body, hdr)
	if status != want {
		t.Fatalf("%s %s %s: %d %s, want %d", actor, method, path, status, raw, want)
	}
	return h, raw
}

func ifMatch(h http.Header) map[string]string { return map[string]string{"If-Match": h.Get("ETag")} }

func w612Estimates(t *testing.T, w *fixtures.World) {
	t.Helper()
	flat := repairsA + "projects/{{repair_project:a.flat}}"
	w612Draft(t, flat)
	version := flat + "/estimates/1"
	w612Do(t, "a.owner", http.MethodGet, version, "", http.StatusOK, nil)

	// the foreman of the object sees the object and no prices; the foreman of another object sees nothing
	for _, path := range []string{flat + "/estimates", version, version + "/diff?to=1"} {
		w612Do(t, "a.repairs-foreman", http.MethodGet, path, "", http.StatusForbidden, nil)
		missing := w482Problem(t, "a.repairs-foreman-two", http.MethodGet, strings.Replace(path, "{{repair_project:a.flat}}", uuid.NewString(), 1), "", nil)
		got := w482Problem(t, "a.repairs-foreman-two", http.MethodGet, path, "", nil)
		if got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
			t.Errorf("GET %s by a foreign foreman: %+v, want as a missing object %+v", path, got, missing)
		}
	}
	w612Refused(t, w, flat)
	// the owner sends and recalls it: the owner is the one who may
	h, _ := w612Do(t, "a.owner", http.MethodGet, version, "", http.StatusOK, nil)
	sent, _ := w612Do(t, "a.owner", http.MethodPost, version+"/send", `{}`, http.StatusOK, ifMatch(h))
	w612Do(t, "a.owner", http.MethodPost, version+"/recall", `{}`, http.StatusOK, ifMatch(sent))
}

// w612Draft measures the object and builds its first draft from a starter template.
func w612Draft(t *testing.T, flat string) {
	t.Helper()
	h, _ := w612Do(t, "a.owner", http.MethodGet, flat+"/measurement", "", http.StatusOK, nil)
	_, raw := w612Do(t, "a.owner", http.MethodPut, flat+"/measurement",
		`{"rooms":[{"name":"Кухня","lengthM":"4","widthM":"3","heightM":"2.5","openingsM2":"2"}]}`, http.StatusOK, ifMatch(h))
	if !strings.Contains(raw, `"floorM2":"12"`) {
		t.Fatalf("measurement: %s", raw)
	}
	_, raw = w612Do(t, "a.owner", http.MethodGet, repairsA+"templates", "", http.StatusOK, nil)
	var templates struct{ Items []created }
	if err := json.Unmarshal([]byte(raw), &templates); err != nil {
		t.Fatal(err)
	}
	var starter uuid.UUID
	for _, tpl := range templates.Items {
		if tpl.Source == "ortus" {
			starter = tpl.ID
			break
		}
	}
	if starter == uuid.Nil {
		t.Fatalf("no starter template: %s", raw)
	}
	_, raw = w612Do(t, "a.owner", http.MethodPost, flat+"/estimate-drafts", `{"templateId":"`+starter.String()+`"}`, http.StatusCreated, nil)
	var est created
	if err := json.Unmarshal([]byte(raw), &est); err != nil || est.Version != 1 {
		t.Fatalf("draft: %s", raw)
	}
}

// w612Refused sends the commands on the draft with a revision to the foreman of the object (no estimates: 403) and to the
// foreman of another object (as a missing object); a refused command leaves the draft as it was.
func w612Refused(t *testing.T, w *fixtures.World, flat string) {
	t.Helper()
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	state := func() string {
		var s string
		if err := db.QueryRowContext(t.Context(), `select e.state || ' ' || e.revision || ' ' || e.discount_pct from repairs.estimates e where e.project_id = $1 and e.version = 1`,
			refID(t, "repair_project:a.flat")).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := state()
	rev1 := map[string]string{"If-Match": `"rev-1"`}
	for _, c := range []struct {
		name, method, path, body string
	}{
		{"updateEstimateDraft", http.MethodPatch, "estimates/1", `{"discountPct":50}`},
		{"sendEstimate", http.MethodPost, "estimates/1/send", `{}`},
		{"recallEstimate", http.MethodPost, "estimates/1/recall", `{}`},
		{"deleteEstimateDraft", http.MethodDelete, "estimates/1", ``},
		{"putMeasurement", http.MethodPut, "measurement", `{"rooms":[]}`},
	} {
		missing := w482Problem(t, "a.repairs-foreman-two", c.method, repairsA+"projects/"+uuid.NewString()+"/"+c.path, c.body, rev1)
		got := w482Problem(t, "a.repairs-foreman-two", c.method, flat+"/"+c.path, c.body, rev1)
		if got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
			t.Errorf("%s on a.flat of a foreign foreman: %+v, want as on a missing object %+v", c.name, got, missing)
		}
		// the foreman of the object measures (Q-W4.00-repair-17, here with a stale revision: 412), but never estimates
		own := w482Problem(t, "a.repairs-foreman", c.method, flat+"/"+c.path, c.body, rev1)
		if want := map[bool]int{true: http.StatusPreconditionFailed, false: http.StatusForbidden}[c.name == "putMeasurement"]; own.status != want {
			t.Errorf("%s by the foreman of the object: %+v, want %d", c.name, own, want)
		}
	}
	if after := state(); after != before {
		t.Errorf("a refused command changed the draft: %q → %q", before, after)
	}
}
func w612Changes(t *testing.T) {
	t.Helper()
	flat := repairsA + "projects/{{repair_project:a.flat}}"
	body := `{"title":"Доп. розетка","quantity":"2","unit":"piece","photoFileIds":["{{file:a.msk1}}"],"note":"В коридоре"}`
	h, raw := w612Do(t, "a.repairs-foreman", http.MethodPost, flat+"/change-orders", body, http.StatusCreated, nil)
	var c created
	if err := json.Unmarshal([]byte(raw), &c); err != nil || !strings.Contains(raw, `"number":"ДР-`) || strings.Contains(raw, "price") {
		t.Fatalf("proposed: %s", raw)
	}
	// the foreman of another object: as if the object and the change order were not there
	missing := w482Problem(t, "a.repairs-foreman-two", http.MethodPost, repairsA+"projects/"+uuid.NewString()+"/change-orders", body, nil)
	if got := w482Problem(t, "a.repairs-foreman-two", http.MethodPost, flat+"/change-orders", body, nil); got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
		t.Errorf("propose by a foreign foreman: %+v, want %+v", got, missing)
	}
	w612Do(t, "a.repairs-foreman-two", http.MethodGet, flat+"/change-orders", "", http.StatusNotFound, nil)
	reject := `{"reason":"warranty"}`
	one := w482Problem(t, "a.repairs-foreman-two", http.MethodPost, repairsA+"change-orders/"+c.ID.String()+"/reject", reject, ifMatch(h))
	none := w482Problem(t, "a.repairs-foreman-two", http.MethodPost, repairsA+"change-orders/"+uuid.NewString()+"/reject", reject, ifMatch(h))
	if one != none || (one.status != http.StatusNotFound && one.status != http.StatusForbidden) {
		t.Errorf("reject by a foreign foreman: %+v, want as of a missing change order %+v", one, none)
	}
	w612Do(t, "a.repairs-foreman", http.MethodPost, repairsA+"change-orders/"+c.ID.String()+"/reject", reject, http.StatusForbidden, ifMatch(h))
	_, raw = w612Do(t, "a.owner", http.MethodPost, repairsA+"change-orders/"+c.ID.String()+"/reject", reject, http.StatusOK, ifMatch(h))
	if !strings.Contains(raw, `"status":"rejected"`) {
		t.Fatalf("rejected: %s", raw)
	}
	_, raw = w612Do(t, "a.repairs-foreman", http.MethodGet, flat+"/change-orders", "", http.StatusOK, nil)
	if !strings.Contains(raw, `"rejectReason":"warranty"`) {
		t.Errorf("the foreman does not read the reason: %s", raw)
	}
}

func w612Catalog(t *testing.T) {
	t.Helper()
	item := `{"section":"Стены","name":"Изоляция: утеплитель","unit":"m2","kind":"material","price":{"amountMinor":42000,"currency":"RUB"}}`
	h, raw := w612Do(t, "a.owner", http.MethodPost, repairsA+"price-items", item, http.StatusCreated, nil)
	var it created
	if err := json.Unmarshal([]byte(raw), &it); err != nil {
		t.Fatal(err)
	}
	patch := `{"archived":false}`
	path := repairsA + "price-items/" + it.ID.String()
	for _, actor := range []string{"b.owner", "a.repairs-foreman"} {
		got := w482Problem(t, actor, http.MethodPatch, path, patch, ifMatch(h))
		missing := w482Problem(t, actor, http.MethodPatch, repairsA+"price-items/"+uuid.NewString(), patch, ifMatch(h))
		if got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
			t.Errorf("PATCH an item by %s: %+v, want as of a missing one %+v", actor, got, missing)
		}
	}
	_, raw = w612Do(t, "a.owner", http.MethodGet, repairsA+"templates", "", http.StatusOK, nil)
	var tpls struct{ Items []created }
	if err := json.Unmarshal([]byte(raw), &tpls); err != nil || len(tpls.Items) == 0 {
		t.Fatalf("templates: %s", raw)
	}
	copyPath := repairsA + "templates/" + tpls.Items[0].ID.String() + "/copy"
	for _, actor := range []string{"b.owner", "a.repairs-foreman"} {
		got := w482Problem(t, actor, http.MethodPost, copyPath, `{}`, nil)
		missing := w482Problem(t, actor, http.MethodPost, repairsA+"templates/"+uuid.NewString()+"/copy", `{}`, nil)
		if got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
			t.Errorf("copy a template by %s: %+v, want as of a missing one %+v", actor, got, missing)
		}
	}
	w612Do(t, "a.owner", http.MethodPost, copyPath, `{"name":"Копия изоляции"}`, http.StatusCreated, nil)
}
