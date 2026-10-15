package matrix

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	harness "github.com/ortus/ortus-crm/backend/test"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

var cat = fixtures.Default()

func ref(t *testing.T, r string) string {
	t.Helper()
	id, err := cat.ID(r)
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func problem(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", harness.ProblemContentType)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(harness.Problem{Type: "about:blank", Title: http.StatusText(status), Status: status, Code: code, RequestID: "r1"})
}

func target(h http.HandlerFunc) Target {
	return Target{Handler: h, Authenticate: func(r *http.Request, a fixtures.Actor) error {
		r.Header.Set("X-Test-Subject", a.Subject)
		return nil
	}}
}

func suite(h http.HandlerFunc) *Suite { return &Suite{Refs: cat, Target: target(h)} }

var meEndpoint = Endpoint{Op: "getMyContext", Method: "GET", Path: "/api/v1/me/context", Channel: ChannelHTTP}

var unitEndpoint = Endpoint{Op: "getUnit", Method: "GET", Path: "/api/v1/units/{unitId}", Channel: ChannelHTTP}

func wantViolation(t *testing.T, got []string, substr ...string) {
	t.Helper()
	all := strings.Join(got, "\n")
	for _, s := range substr {
		if !strings.Contains(all, s) {
			t.Fatalf("violations %q must mention %q", got, s)
		}
	}
}

func TestCheckPassesMatchingRow(t *testing.T) {
	t.Parallel()
	body := fmt.Sprintf(`{"tenants":[{"tenantId":%q}]}`, ref(t, "tenant:b"))
	s := suite(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Test-Subject") != "iso-b.owner" {
			problem(w, 401, "unauthenticated")
			return
		}
		_, _ = io.WriteString(w, body)
	})
	row := Row{Actor: "b.owner", Status: 200, Present: []string{"tenant:b"}, Absent: []string{"tenant:a"}}
	if v := Check(t.Context(), s, meEndpoint, row); len(v) != 0 {
		t.Fatalf("violations: %q", v)
	}
}

func TestCheckStatusMismatch(t *testing.T) {
	t.Parallel()
	s := suite(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "{}") })
	v := Check(t.Context(), s, meEndpoint, Row{Actor: fixtures.Anonymous, Status: 401})
	wantViolation(t, v, "status 200", "want 401")
}

func TestCheckLeaks(t *testing.T) {
	t.Parallel()
	foreign := ref(t, "tenant:a")
	s := suite(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"tenants":[{"tenantId":"`+strings.ToUpper(foreign)+`"}]}`)
	})
	v := Check(t.Context(), s, meEndpoint, Row{Actor: "b.owner", Status: 200, Absent: []string{"tenant:a"}})
	wantViolation(t, v, "leak", "tenant:a")

	s = suite(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "/api/v1/tenants/"+foreign)
		_, _ = io.WriteString(w, "{}")
	})
	v = Check(t.Context(), s, meEndpoint, Row{Actor: "b.owner", Status: 200, Absent: []string{"tenant:a"}})
	wantViolation(t, v, "leak", "Location")
}

func TestCheckPresentMissing(t *testing.T) {
	t.Parallel()
	s := suite(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, `{"tenants":[]}`) })
	v := Check(t.Context(), s, meEndpoint, Row{Actor: "b.owner", Status: 200, Present: []string{"tenant:b"}, Absent: []string{"tenant:a"}})
	wantViolation(t, v, "present", "tenant:b")
}

func TestCheckErrorsAreProblems(t *testing.T) {
	t.Parallel()
	s := suite(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, "denied")
	})
	v := Check(t.Context(), s, meEndpoint, Row{Actor: fixtures.Anonymous, Status: 401})
	wantViolation(t, v, "problem")
}

// Строка с code проверяет Problem.code: 403 forbidden_action не засчитывается строке «403 function_blocked».
func TestCheckProblemCode(t *testing.T) {
	t.Parallel()
	s := suite(func(w http.ResponseWriter, _ *http.Request) { problem(w, 403, "forbidden_action") })
	v := Check(t.Context(), s, meEndpoint, Row{Actor: "a.driver-earnings", Status: 403, Code: "function_blocked"})
	wantViolation(t, v, "code forbidden_action", "want function_blocked")
	if v := Check(t.Context(), s, meEndpoint, Row{Actor: "a.driver-earnings", Status: 403, Code: "forbidden_action"}); len(v) != 0 {
		t.Fatalf("matching code: %q", v)
	}
	if v := Check(t.Context(), s, meEndpoint, Row{Actor: "a.driver-earnings", Status: 403}); len(v) != 0 {
		t.Fatalf("row without code: %q", v)
	}
}

func TestCheckNotFoundIsIndistinguishable(t *testing.T) {
	t.Parallel()
	foreign := ref(t, "unit:a.msk1")
	differs := suite(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, foreign) {
			problem(w, 404, "unit_hidden")
			return
		}
		problem(w, 404, "not_found")
	})
	row := Row{Actor: "b.owner", Params: map[string]string{"unitId": "unit:a.msk1"}, Status: 404}
	wantViolation(t, Check(t.Context(), differs, unitEndpoint, row), "AC-01", "unit_hidden", "not_found")

	same := suite(func(w http.ResponseWriter, _ *http.Request) { problem(w, 404, "not_found") })
	if v := Check(t.Context(), same, unitEndpoint, row); len(v) != 0 {
		t.Fatalf("violations: %q", v)
	}
}

// AC-01, вторая половина (Q-W0.15-4, обязательство W1.04): «время ответа не различается заметно». Раннер
// сравнивает медианы времени ответа на чужой и на несуществующий id; заметная разница — нарушение строки.
func TestCheckNotFoundTiming(t *testing.T) {
	t.Parallel()
	foreign := ref(t, "unit:a.msk1")
	slowForeign := suite(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, foreign) {
			time.Sleep(60 * time.Millisecond) // e.g. the object is read before the scope is checked
		}
		problem(w, 404, "not_found")
	})
	slowForeign.Timing = Timing{Samples: 3, Abs: 20 * time.Millisecond, Ratio: 2}
	row := Row{Actor: "b.owner", Params: map[string]string{"unitId": "unit:a.msk1"}, Status: 404}
	wantViolation(t, Check(t.Context(), slowForeign, unitEndpoint, row), "AC-01", "time")

	same := suite(func(w http.ResponseWriter, _ *http.Request) { problem(w, 404, "not_found") })
	same.Timing = Timing{Samples: 3, Abs: 20 * time.Millisecond, Ratio: 2}
	if v := Check(t.Context(), same, unitEndpoint, row); len(v) != 0 {
		t.Fatalf("violations: %q", v)
	}
	if d := DefaultTiming(); d.Samples < 3 || d.Abs < 100*time.Millisecond || d.Ratio < 2 {
		t.Errorf("default timing %+v must only catch a noticeable difference", d)
	}
}

func TestCheckPathParams(t *testing.T) {
	t.Parallel()
	want := "/api/v1/units/" + ref(t, "unit:a.msk1")
	s := suite(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != want {
			problem(w, 404, "not_found")
			return
		}
		_, _ = io.WriteString(w, `{"id":"`+ref(t, "unit:a.msk1")+`"}`)
	})
	row := Row{Actor: "a.manager-msk1", Params: map[string]string{"unitId": "unit:a.msk1"}, Status: 200, Present: []string{"unit:a.msk1"}}
	if v := Check(t.Context(), s, unitEndpoint, row); len(v) != 0 {
		t.Fatalf("violations: %q", v)
	}
}

func TestCheckBody(t *testing.T) {
	t.Parallel()
	ep := Endpoint{Op: "createTrip", Method: "POST", Path: "/api/v1/trips", Channel: ChannelHTTP}
	var got, contentType string
	s := suite(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got, contentType = string(b), r.Header.Get("Content-Type")
		problem(w, 404, "not_found")
	})
	row := Row{Actor: "b.manager-msk1", Status: 404, Body: `{"unitId":"{{unit:a.msk1}}"}`}
	if v := Check(t.Context(), s, ep, row); len(v) != 0 {
		t.Fatalf("violations: %q", v)
	}
	if want := `{"unitId":"` + ref(t, "unit:a.msk1") + `"}`; got != want || contentType != "application/json" {
		t.Fatalf("body %s (%s), want %s (application/json)", got, contentType, want)
	}
}

func TestCheckAnonymousIsNotAuthenticated(t *testing.T) {
	t.Parallel()
	var calls int
	var mu sync.Mutex
	s := &Suite{Refs: cat, Target: Target{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { problem(w, 401, "unauthenticated") }),
		Authenticate: func(*http.Request, fixtures.Actor) error {
			mu.Lock()
			calls++
			mu.Unlock()
			return nil
		},
	}}
	if v := Check(t.Context(), s, meEndpoint, Row{Actor: fixtures.Anonymous, Status: 401}); len(v) != 0 {
		t.Fatalf("violations: %q", v)
	}
	if calls != 0 {
		t.Fatalf("Authenticate called %d times for anonymous", calls)
	}
}

// pendingMe is /me/context before its handler: rows are written first (tdd-protocol §2 step 4).
var pendingMe = func() Endpoint {
	ep := meEndpoint
	ep.Pending = "W0.09"
	return ep
}()

var (
	pendingPositive  = Row{Actor: "b.owner", Status: 200, Present: []string{"tenant:b"}, Absent: []string{"tenant:a"}}
	pendingAnonymous = Row{Actor: fixtures.Anonymous, Status: 401}
)

func wantNoViolation(t *testing.T, got []string, what string) {
	t.Helper()
	if len(got) != 0 {
		t.Fatalf("%s: violations %q", what, got)
	}
}

func wantNoHint(t *testing.T, got []string) {
	t.Helper()
	if strings.Contains(strings.Join(got, "\n"), "remove `pending") {
		t.Fatalf("violations %q must not tell to remove pending: no handler answered", got)
	}
}

func TestCheckPendingStub(t *testing.T) {
	t.Parallel()
	stub := &Suite{Refs: cat, Target: NotImplemented()}
	wantNoViolation(t, Check(t.Context(), stub, pendingMe, pendingPositive), "positive row against the 501 stub")
	wantNoViolation(t, Check(t.Context(), stub, pendingMe, pendingAnonymous), "anonymous row against the 501 stub")
}

// gatewayTarget is the strict server of W0.09 before the handler: the operation gateway answers first
// (session 401 → membership 404 → right 403), and only a request it lets through gets 501.
func gatewayTarget() *Suite {
	return suite(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Header.Get("X-Test-Subject") == "":
			problem(w, http.StatusUnauthorized, "unauthenticated")
		case strings.HasPrefix(r.URL.Path, "/api/v1/units/"):
			problem(w, http.StatusNotFound, "not_found")
		default:
			problem(w, http.StatusNotImplemented, CodeNotImplemented)
		}
	})
}

func TestCheckPendingGateway(t *testing.T) {
	t.Parallel()
	gw := gatewayTarget()
	wantNoViolation(t, Check(t.Context(), gw, pendingMe, pendingAnonymous), "anonymous row answered 401 by the gateway")
	wantNoViolation(t, Check(t.Context(), gw, pendingMe, pendingPositive), "positive row let through to 501")

	unit := unitEndpoint
	unit.Pending = "W1.05"
	foreign := Row{Actor: "b.owner", Params: map[string]string{"unitId": "unit:a.msk1"}, Status: 404, Absent: []string{"unit:a.msk1"}}
	wantNoViolation(t, Check(t.Context(), gw, unit, foreign), "foreign row answered 404 by the gateway (AC-01 holds)")
}

func TestCheckPendingGatewayBreaksRow(t *testing.T) {
	t.Parallel()
	forbidden := suite(func(w http.ResponseWriter, _ *http.Request) { problem(w, http.StatusForbidden, "forbidden_action") })
	v := Check(t.Context(), forbidden, pendingMe, pendingAnonymous)
	wantViolation(t, v, "pending W0.09", "status 403", "want 401")
	wantNoHint(t, v)

	plain := suite(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, "denied")
	})
	v = Check(t.Context(), plain, pendingMe, pendingAnonymous)
	wantViolation(t, v, "pending W0.09", "problem")
	wantNoHint(t, v)

	unit := unitEndpoint
	unit.Pending = "W1.05"
	foreign := Row{Actor: "b.owner", Params: map[string]string{"unitId": "unit:a.msk1"}, Status: 404}
	differs := suite(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ref(t, "unit:a.msk1")) {
			problem(w, http.StatusNotFound, "unit_hidden")
			return
		}
		problem(w, http.StatusNotFound, "not_found")
	})
	v = Check(t.Context(), differs, unit, foreign)
	wantViolation(t, v, "pending W1.05", "AC-01")
	wantNoHint(t, v)
}

func TestCheckPendingHandlerExists(t *testing.T) {
	t.Parallel()
	broken := suite(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "{}") })
	v := Check(t.Context(), broken, pendingMe, pendingPositive)
	wantViolation(t, v, "W0.09", "remove `pending: W0.09`", "go generate", "present tenant:b")

	body := fmt.Sprintf(`{"tenants":[{"tenantId":%q}]}`, ref(t, "tenant:b"))
	working := suite(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, body) })
	v = Check(t.Context(), working, pendingMe, pendingPositive)
	wantViolation(t, v, "W0.09", "remove `pending: W0.09`", "go generate")
}

func TestCheckPendingStrict(t *testing.T) {
	t.Parallel()
	strict := &Suite{Refs: cat, Target: NotImplemented(), Strict: true}
	wantViolation(t, Check(t.Context(), strict, pendingMe, pendingPositive), "status 501", "want 200")

	gw := gatewayTarget()
	gw.Strict = true
	wantNoViolation(t, Check(t.Context(), gw, pendingMe, pendingAnonymous), "strict anonymous row answered 401 by the gateway")
	wantViolation(t, Check(t.Context(), gw, pendingMe, pendingPositive), "status 501", "want 200")
}

func TestNotImplemented(t *testing.T) {
	t.Parallel()
	tg := NotImplemented()
	a, _ := cat.Actor("a.owner")
	req, _ := http.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/me/context", http.NoBody)
	if err := tg.Authenticate(req, a); err != nil {
		t.Fatal(err)
	}
	rec := record(tg.Handler, req)
	p, err := harness.ParseProblem(rec.Header().Get("Content-Type"), rec.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusNotImplemented || p.Status != http.StatusNotImplemented || p.Code != "not_implemented" {
		t.Fatalf("NotImplemented answered %d %+v", rec.Code, p)
	}
}

func TestStrictPendingDefault(t *testing.T) {
	t.Parallel()
	s := NewSuite(cat, NotImplemented())
	if s.Strict != strictPending {
		t.Fatalf("NewSuite Strict = %v, want the build-tag default %v", s.Strict, strictPending)
	}
}

func TestRunPassingFile(t *testing.T) {
	t.Parallel()
	f := File{Module: "me", Endpoints: []Endpoint{func() Endpoint {
		ep := meEndpoint
		ep.Pending = "W0.09"
		ep.Rows = []Row{{Actor: fixtures.Anonymous, Status: 401}, {Actor: "a.owner", Status: 200, Absent: []string{"tenant:b"}}}
		return ep
	}()}}
	Run(t, &Suite{Refs: cat, Target: NotImplemented()}, f)
}

func TestParseBodyRefs(t *testing.T) {
	t.Parallel()
	src := "module: trips\nendpoints:\n  - op: createTrip\n    method: POST\n    path: /api/v1/trips\n    rows:\n" +
		"      - actor: b.owner\n        status: 404\n        body: '{\"unitId\": \"{{unit:a.nope}}\"}'\n"
	if _, err := Parse("trips.yaml", []byte(src), cat); err == nil || !strings.Contains(err.Error(), "body: unknown reference") {
		t.Fatalf("Parse error = %v, want body: unknown reference", err)
	}
	if _, err := Parse("trips.yaml", []byte(strings.Replace(src, "a.nope", "a.msk1", 1)), cat); err != nil {
		t.Fatal(err)
	}
}
