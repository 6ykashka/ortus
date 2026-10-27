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

// W6.11 (возврат 1): what the rows of repairs_w600.yaml cannot carry — the fields a foreman does not read («прораб без
// цен»), the commands with If-Match (the rows send no headers, README «Цель набора») and the mark of the foreman through
// the whole path. The fixtures are WithInTenant (content_repairs.go): «Квартира на Лесной» (repair_project:a.flat) of
// a.repairs-foreman with a work, a worker and a mark on acceptance, «Дом на Речной» of a.repairs-foreman-two.
//   - prices: the foreman of an object reads it without the sum of the contract, the phone of the client and the money
//     card in the object, the overview and the list; the owner reads them (the control of the check);
//   - a foreign foreman: every command on «Лесная» with the right If-Match answers as on an object that does not exist,
//     and «Лесная» stays as it was;
//   - the mark: the foreman sends it (201), cannot accept it, the owner accepts it (200) and the fact of the work grows
//     by its volume; a second decision is 409.

const repairsA = "/api/v1/tenants/{{tenant:a}}/repairs/"

// Not parallel: the mark changes the fact of «Лесная» and the rows of repairs_w600.yaml run in parallel with the other tests
// of the suite after it.
//
//nolint:paralleltest // see above
func TestIsolationRepairsW611(t *testing.T) {
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	t.Run("prices", w611Prices)
	t.Run("foreign foreman", func(t *testing.T) { w611Foreign(t, w) })
	t.Run("mark", func(t *testing.T) { w611Mark(t, w) })
}

func w611Prices(t *testing.T) {
	t.Helper()
	const phone = "+7 900 000-11-22"
	project := repairsA + "projects/{{repair_project:a.flat}}"
	for _, path := range []string{project, project + "/overview", repairsA + "projects"} {
		status, _, own := formsCall(t, "a.repairs-foreman", http.MethodGet, path, "", nil)
		if status != http.StatusOK || !strings.Contains(own, refID(t, "repair_project:a.flat").String()) {
			t.Fatalf("foreman GET %s: %d %s", path, status, own)
		}
		for _, leak := range []string{`"budget"`, `"clientPhone"`, `"money"`, phone, "120000000"} {
			if strings.Contains(own, leak) {
				t.Errorf("foreman GET %s names %s: %s", path, leak, own)
			}
		}
		status, _, owner := formsCall(t, "a.owner", http.MethodGet, path, "", nil)
		if status != http.StatusOK || !strings.Contains(owner, phone) {
			t.Errorf("owner GET %s: %d, want the phone of the client (control of the check): %s", path, status, owner)
		}
	}
}

func w611Foreign(t *testing.T, w *fixtures.World) {
	t.Helper()
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	var log uuid.UUID
	if err := db.QueryRowContext(t.Context(), `select id from repairs.work_logs where project_id = $1 and status = 'submitted' limit 1`,
		refID(t, "repair_project:a.flat")).Scan(&log); err != nil {
		t.Fatal(err)
	}
	state := func() string {
		var s string
		if err := db.QueryRowContext(t.Context(), `select p.name || ' ' || p.revision || ' ' || p.status || ' ' || coalesce(p.foreman_id::text, '') || ' ' ||
			(select string_agg(g.status || g.revision, ',') from repairs.work_logs g where g.project_id = p.id) from repairs.projects p where p.id = $1`,
			refID(t, "repair_project:a.flat")).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := state()
	rev1 := map[string]string{"If-Match": `"rev-1"`}
	foreman := `{"foremanMemberId":"{{person:a.repairs-foreman-two@a}}"}`
	for _, c := range []struct {
		name, method, path, body string
	}{
		{"updateRepairProject", http.MethodPatch, "projects/%s", `{"name":"Захвачено"}`},
		{"activateRepairProject", http.MethodPost, "projects/%s/activate", `{}`},
		{"assignRepairForeman", http.MethodPost, "projects/%s/foreman", foreman},
	} {
		missing := w482Problem(t, "a.repairs-foreman-two", c.method, repairsA+strings.Replace(c.path, "%s", uuid.NewString(), 1), c.body, rev1)
		got := w482Problem(t, "a.repairs-foreman-two", c.method, repairsA+strings.Replace(c.path, "%s", "{{repair_project:a.flat}}", 1), c.body, rev1)
		if got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
			t.Errorf("%s on a.flat of a foreign foreman: %+v, want as on a missing object %+v (403 of the gate or 404)", c.name, got, missing)
		}
	}
	for _, op := range []string{"accept", "return"} {
		body := `{"reason":"чужое"}`
		missing := w482Problem(t, "a.repairs-foreman-two", http.MethodPost, repairsA+"work-logs/"+uuid.NewString()+"/"+op, body, rev1)
		got := w482Problem(t, "a.repairs-foreman-two", http.MethodPost, repairsA+"work-logs/"+log.String()+"/"+op, body, rev1)
		if got != missing || (got.status != http.StatusNotFound && got.status != http.StatusForbidden) {
			t.Errorf("%s of a mark of a.flat by a foreign foreman: %+v, want as of a missing mark %+v", op, got, missing)
		}
	}
	if after := state(); after != before {
		t.Errorf("a refused command changed a.flat: %q → %q", before, after)
	}
}

// w611Mark is the path of a mark: the foreman sends it, the office decides.
func w611Mark(t *testing.T, w *fixtures.World) {
	t.Helper()
	db := w.Cluster.DB(t, w.TenantDBs[fixtures.TenantA], migrations.RoleAPI)
	var work, crew uuid.UUID
	if err := db.QueryRowContext(t.Context(), `select (select id from repairs.works where project_id = $1),
		(select id from repairs.workers where project_id = $1)`, refID(t, "repair_project:a.flat")).Scan(&work, &crew); err != nil {
		t.Fatal(err)
	}
	fact := func() string {
		var s string
		if err := db.QueryRowContext(t.Context(), `select fact_qty::text from repairs.works where id = $1`, work).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := fact()
	body := `{"projectId":"{{repair_project:a.flat}}","workDate":"2026-10-01","timeZone":"Europe/Moscow","crewWorkerIds":["` + crew.String() +
		`"],"lines":[{"workId":"` + work.String() + `","quantity":"3","unit":"m2"}],"evidenceFileIds":["{{file:a.msk1}}"]}`
	status, hdr, raw := formsCall(t, "a.repairs-foreman", http.MethodPost, repairsA+"work-logs", body, nil)
	var log struct {
		ID     uuid.UUID `json:"id"`
		Status string    `json:"status"`
	}
	if err := json.Unmarshal([]byte(raw), &log); status != http.StatusCreated || err != nil || log.Status != "submitted" {
		t.Fatalf("submitWorkLog by the foreman: %d %s", status, raw)
	}
	if after := fact(); after != before {
		t.Errorf("the fact moved on a mark on acceptance: %s → %s", before, after)
	}
	if status, _, raw = formsCall(t, "a.repairs-foreman", http.MethodPost, repairsA+"work-logs/"+log.ID.String()+"/accept", "",
		map[string]string{"If-Match": hdr.Get("ETag")}); status != http.StatusForbidden {
		t.Errorf("acceptWorkLog by the foreman: %d %s, want 403 (no repairs.work_logs.review)", status, raw)
	}
	if status, _, raw = formsCall(t, "a.owner", http.MethodPost, repairsA+"work-logs/"+log.ID.String()+"/accept", "",
		map[string]string{"If-Match": hdr.Get("ETag")}); status != http.StatusOK || !strings.Contains(raw, `"accepted"`) {
		t.Fatalf("acceptWorkLog by the owner: %d %s", status, raw)
	}
	if after := fact(); after == before {
		t.Errorf("the accepted mark did not grow the fact: %s", after)
	}
	if status, _, raw = formsCall(t, "a.owner", http.MethodPost, repairsA+"work-logs/"+log.ID.String()+"/accept", "",
		map[string]string{"If-Match": `"rev-2"`}); status != http.StatusConflict {
		t.Errorf("a second acceptWorkLog: %d %s, want 409", status, raw)
	}
}
