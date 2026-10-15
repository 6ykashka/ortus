package matrix

import (
	"reflect"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

const validYAML = `# комментарий
module: fleet_units
endpoints:
  - op: getUnit
    method: GET
    path: /api/v1/tenants/{tenantId}/units/{unitId}
    pending: W1.05
    rows:
      - actor: a.manager-msk1
        params: {tenantId: tenant:a, unitId: unit:a.msk1}
        status: 200
        present: [unit:a.msk1]
      - actor: b.owner
        params: {tenantId: tenant:a, unitId: unit:a.msk1}
        status: 404
        note: чужой тенант
  - op: getMyContext
    method: GET
    path: /api/v1/me/context
    channel: http
    rows:
      - actor: anonymous
        status: 401
      - actor: b.owner
        status: 200
        absent: [tenant:a]
`

func TestParseValid(t *testing.T) {
	t.Parallel()
	f, err := Parse("fleet_units.yaml", []byte(validYAML), fixtures.Default())
	if err != nil {
		t.Fatal(err)
	}
	want := File{
		Module: "fleet_units",
		Endpoints: []Endpoint{
			{
				Op: "getUnit", Method: "GET", Path: "/api/v1/tenants/{tenantId}/units/{unitId}", Channel: "http", Pending: "W1.05",
				Rows: []Row{
					{
						Actor: "a.manager-msk1", Params: map[string]string{"tenantId": "tenant:a", "unitId": "unit:a.msk1"},
						Status: 200, Present: []string{"unit:a.msk1"},
					},
					{
						Actor: "b.owner", Params: map[string]string{"tenantId": "tenant:a", "unitId": "unit:a.msk1"},
						Status: 404, Note: "чужой тенант",
					},
				},
			},
			{
				Op: "getMyContext", Method: "GET", Path: "/api/v1/me/context", Channel: "http",
				Rows: []Row{
					{Actor: "anonymous", Status: 401},
					{Actor: "b.owner", Status: 200, Absent: []string{"tenant:a"}},
				},
			},
		},
	}
	if !reflect.DeepEqual(f, want) {
		t.Fatalf("Parse =\n%#v\nwant\n%#v", f, want)
	}
}

// code — Problem.code ответа строки-ошибки (errors.yaml): function_blocked отличается от forbidden_action при том же 403.
func TestParseCode(t *testing.T) {
	t.Parallel()
	f, err := Parse("fleet_units.yaml", []byte(replace(t, "note: чужой тенант", "code: not_found\n        note: чужой тенант")), fixtures.Default())
	if err != nil {
		t.Fatal(err)
	}
	if got := f.Endpoints[0].Rows[1].Code; got != "not_found" {
		t.Fatalf("Code = %q, want not_found", got)
	}
}

// replace returns validYAML with the first old replaced by repl (old must occur).
func replace(t *testing.T, old, repl string) string {
	t.Helper()
	return replaceIn(t, validYAML, old, repl)
}

func replaceIn(t *testing.T, src, old, repl string) string {
	t.Helper()
	if !strings.Contains(src, old) {
		t.Fatalf("source has no %q", old)
	}
	return strings.Replace(src, old, repl, 1)
}

func TestParseErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, file, yaml, want string
	}{
		{"not yaml", "fleet_units.yaml", "module: [", "fleet_units.yaml"},
		{"unknown field", "fleet_units.yaml", replace(t, "    pending: W1.05\n", "    pending: W1.05\n    owner: x\n"), "owner"},
		{"module differs from file", "units.yaml", validYAML, "module"},
		{"module name", "Fleet.yaml", replace(t, "module: fleet_units", "module: Fleet"), "module name"},
		{"reserved module", "main.yaml", replace(t, "module: fleet_units", "module: main"), "reserved"},
		{"no endpoints", "fleet_units.yaml", "module: fleet_units\nendpoints: []\n", "endpoints"},
		{"duplicate op", "fleet_units.yaml", replace(t, "op: getMyContext", "op: getUnit"), "duplicate op"},
		{"bad op", "fleet_units.yaml", replace(t, "op: getMyContext", "op: get-context"), "op"},
		{"bad method", "fleet_units.yaml", replace(t, "method: GET\n    path: /api/v1/me", "method: FETCH\n    path: /api/v1/me"), "method"},
		{"bad path", "fleet_units.yaml", replace(t, "path: /api/v1/me/context", "path: /me/context"), "path"},
		{"unknown channel", "fleet_units.yaml", replace(t, "channel: http", "channel: fax"), "channel"},
		{"channel not supported", "fleet_units.yaml", replace(t, "channel: http", "channel: export"), "not supported yet"},
		{"bad pending", "fleet_units.yaml", replace(t, "pending: W1.05", "pending: soon"), "pending"},
		{"no rows", "fleet_units.yaml", "module: fleet_units\nendpoints:\n  - op: x\n    method: GET\n    path: /api/v1/x\n", "rows"},
		{"unknown actor", "fleet_units.yaml", replace(t, "actor: b.owner\n        status: 200", "actor: c.owner\n        status: 200"), "actor"},
		{"missing param", "fleet_units.yaml", replace(t, "params: {tenantId: tenant:a, unitId: unit:a.msk1}\n        status: 200",
			"params: {tenantId: tenant:a}\n        status: 200"), "param"},
		{"extra param", "fleet_units.yaml", replace(t, "actor: anonymous\n", "actor: anonymous\n        params: {id: tenant:a}\n"), "param"},
		{"unknown param ref", "fleet_units.yaml", replace(t, "unitId: unit:a.msk1}\n        status: 200", "unitId: unit:a.nope}\n        status: 200"), "unknown reference"},
		{"unknown present ref", "fleet_units.yaml", replace(t, "present: [unit:a.msk1]", "present: [unit:c.msk1]"), "unknown reference"},
		{"unknown absent ref", "fleet_units.yaml", replace(t, "absent: [tenant:a]", "absent: [tenant:z]"), "unknown reference"},
		{"bad status", "fleet_units.yaml", replace(t, "status: 401", "status: 302"), "status"},
		{"present on error", "fleet_units.yaml", replace(t, "status: 404\n", "status: 404\n        present: [tenant:a]\n"), "present"},
		{"duplicate row", "fleet_units.yaml", replace(t, "actor: anonymous", "actor: b.owner"), "duplicate row"},
		{"no negative row", "fleet_units.yaml", replaceIn(t, replace(t, "status: 401", "status: 200"), "absent: [tenant:a]", "present: [tenant:b]"), "negative"},
		{"code on success", "fleet_units.yaml", replace(t, "present: [unit:a.msk1]", "present: [unit:a.msk1]\n        code: not_found"), "code"},
		{"bad code", "fleet_units.yaml", replace(t, "note: чужой тенант", "code: Not-Found\n        note: чужой тенант"), "code"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := Parse(tc.file, []byte(tc.yaml), fixtures.Default())
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("Parse error = %v, want it to mention %q", err, tc.want)
			}
			if !strings.Contains(err.Error(), tc.file) {
				t.Fatalf("Parse error %q must name the file %s", err, tc.file)
			}
		})
	}
}

func TestParseErrorsPointAtRow(t *testing.T) {
	t.Parallel()
	_, err := Parse("fleet_units.yaml", []byte(replace(t, "status: 401", "status: 302")), fixtures.Default())
	if err == nil || !strings.Contains(err.Error(), "fleet_units.yaml: endpoints[1].rows[0]") {
		t.Fatalf("error = %v, want the location fleet_units.yaml: endpoints[1].rows[0]", err)
	}
}

func TestPathParams(t *testing.T) {
	t.Parallel()
	got := PathParams("/api/v1/tenants/{tenantId}/units/{unitId}")
	if !reflect.DeepEqual(got, []string{"tenantId", "unitId"}) {
		t.Fatalf("PathParams = %v", got)
	}
	if got := PathParams("/api/v1/me/context"); len(got) != 0 {
		t.Fatalf("PathParams without params = %v", got)
	}
}
