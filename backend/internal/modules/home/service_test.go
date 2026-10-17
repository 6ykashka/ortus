package home

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	account  = uuid.MustParse("10000000-0000-4000-8000-0000000000a1")
	tenantA  = uuid.MustParse("10000000-0000-4000-8000-0000000000f1")
	person   = uuid.MustParse("10000000-0000-4000-8000-0000000000b1")
	member   = uuid.MustParse("10000000-0000-4000-8000-0000000000c1")
	fixedNow = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
)

// directory is a control-DB directory with one membership (or an error).
type directory struct {
	tenantctx.Directory // other methods are not used: nil, a call panics
	m                   *tenantctx.Membership
	err                 error
}

func (d directory) Membership(_ context.Context, accountID, tenantID uuid.UUID) (tenantctx.Membership, error) {
	switch {
	case d.err != nil:
		return tenantctx.Membership{}, d.err
	case d.m == nil || accountID != account || tenantID != d.m.TenantID:
		return tenantctx.Membership{}, tenantctx.ErrNotFound
	}
	return *d.m, nil
}

func membership(state, status string, owner bool) *tenantctx.Membership {
	return &tenantctx.Membership{ID: member, TenantID: tenantA, PersonProfileID: person, TenantState: state, Status: status, Owner: owner}
}

// source is a fake source: its cards or its error, and the queries it got.
type source struct {
	module string
	items  []homeapi.DecisionItem
	err    error
	got    []Query
}

func (s *source) Module() string { return s.module }

func (s *source) Cards(_ context.Context, q Query) ([]homeapi.DecisionItem, error) {
	s.got = append(s.got, q)
	return s.items, s.err
}

func card(kind string, tone homeapi.DecisionItemTone) homeapi.DecisionItem {
	return homeapi.DecisionItem{Key: kind + ":1", Kind: kind, ModuleKey: strings.Split(kind, ".")[0], Tone: tone, Params: map[string]string{}}
}

// modules are fixed module states (or an error).
type modules struct {
	states map[string]string
	err    error
	calls  int
}

func (m *modules) States(context.Context, uuid.UUID) (map[string]string, error) {
	m.calls++
	return m.states, m.err
}

func service(t *testing.T, dir tenantctx.Directory, mods Modules, sources ...Source) *Service {
	t.Helper()
	r, err := NewRegistry(sources...)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{Dir: dir, Registry: r, Modules: mods, Now: func() time.Time { return fixedNow }}
}

func wantCode(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Fatalf("error %v, want %s", err, code)
	}
}

func kinds(q homeapi.DecisionQueue) []string {
	out := make([]string, 0, len(q.Items))
	for _, it := range q.Items {
		out = append(out, it.Kind)
	}
	return out
}

// S2-18 п. 4: the tenant of the query is an active membership of the identity in a readable business, otherwise
// 404 not_found — like a tenant that does not exist; the sources are not asked.
func TestQueueMembership(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		dir  directory
		code string
	}{
		{"no membership", directory{}, problem.CodeNotFound},
		{"invited", directory{m: membership("active", "invited", false)}, problem.CodeNotFound},
		{"ended", directory{m: membership("active", "ended", false)}, problem.CodeNotFound},
		{"suspended business", directory{m: membership("suspended", "active", true)}, problem.CodeNotFound},
		{"provisioning business", directory{m: membership("provisioning", "active", true)}, problem.CodeNotFound},
		{"directory down", directory{err: errors.New("control DB down")}, problem.CodeDependencyUnavailable},
		{"trial", directory{m: membership("trial", "active", true)}, ""},
		{"active", directory{m: membership("active", "active", false)}, ""},
		{"grace", directory{m: membership("grace", "active", false)}, ""},
		{"read_only", directory{m: membership("read_only", "active", false)}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			core := &source{items: []homeapi.DecisionItem{card("tenant.trial_ending", homeapi.Neutral)}}
			q, err := service(t, c.dir, nil, core).Queue(t.Context(), account, tenantA, DefaultLimit)
			if c.code != "" {
				wantCode(t, err, c.code)
				if len(core.got) != 0 {
					t.Fatalf("source asked for a refused tenant: %+v", core.got)
				}
				if c.code == problem.CodeNotFound && !strings.Contains(err.Error(), "Организация не найдена.") {
					t.Errorf("detail of %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if q.TenantId != tenantA || q.Total != 1 || len(q.Items) != 1 {
				t.Fatalf("queue %+v", q)
			}
		})
	}
}

// limit is 1…50 (malformed_request outside, as MSW W2.00).
func TestQueueLimit(t *testing.T) {
	t.Parallel()
	dir := directory{m: membership("active", "active", false)}
	for _, n := range []int{0, -1, MaxLimit + 1} {
		_, err := service(t, dir, nil).Queue(t.Context(), account, tenantA, n)
		wantCode(t, err, problem.CodeMalformedRequest)
	}
	for _, n := range []int{1, MaxLimit} {
		if _, err := service(t, dir, nil).Queue(t.Context(), account, tenantA, n); err != nil {
			t.Fatalf("limit %d: %v", n, err)
		}
	}
}

// S2-18 п. 2: tone first (danger → warn → info → neutral), then the registration order of the sources and the
// order of each source; total counts the cards before the limit.
func TestQueueOrder(t *testing.T) {
	t.Parallel()
	fleet := &source{module: "fleet", items: []homeapi.DecisionItem{
		card("fleet.trip_review", homeapi.Warn), card("fleet.blocking_defect", homeapi.Danger),
		card("fleet.trip_without_driver", homeapi.Info), card("fleet.blocking_defect_2", homeapi.Danger),
	}}
	core := &source{items: []homeapi.DecisionItem{card("tenant.trial_ending", homeapi.Neutral), card("tenant.trial_ended", homeapi.Danger)}}
	mods := &modules{states: map[string]string{"fleet": "active"}}
	svc := service(t, directory{m: membership("trial", "active", true)}, mods, fleet, core)
	q, err := svc.Queue(t.Context(), account, tenantA, DefaultLimit)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"fleet.blocking_defect", "fleet.blocking_defect_2", "tenant.trial_ended", "fleet.trip_review",
		"fleet.trip_without_driver", "tenant.trial_ending"}
	if got := kinds(q); !slices.Equal(got, want) || q.Total != 6 {
		t.Fatalf("kinds %v total %d, want %v total 6", got, q.Total, want)
	}
	q, err = svc.Queue(t.Context(), account, tenantA, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got := kinds(q); !slices.Equal(got, want[:2]) || q.Total != 6 {
		t.Fatalf("limit 2: kinds %v total %d", got, q.Total)
	}
	if !q.GeneratedAt.Equal(fixedNow) || q.GeneratedAt.Location() != time.UTC {
		t.Errorf("generatedAt %v", q.GeneratedAt)
	}
}

// S2-18 п. 3: a source of an installable module is asked only while the module is installed and not disabled; it
// gets the state of its module, the member and the clock.
func TestQueueModuleStates(t *testing.T) {
	t.Parallel()
	dir := directory{m: membership("active", "active", true)}
	for state, asked := range map[string]bool{"active": true, "read_only": true, "draining": true, "disabled": false, "uninstalled": false, "": false} {
		fleet := &source{module: "fleet", items: []homeapi.DecisionItem{card("fleet.trip_review", homeapi.Warn)}}
		mods := &modules{states: map[string]string{}}
		if state != "" {
			mods.states["fleet"] = state
		}
		q, err := service(t, dir, mods, fleet).Queue(t.Context(), account, tenantA, DefaultLimit)
		if err != nil {
			t.Fatalf("%q: %v", state, err)
		}
		if got := len(fleet.got) == 1; got != asked || (q.Total == 1) != asked {
			t.Fatalf("state %q: asked %v, total %d, want asked %v", state, got, q.Total, asked)
		}
		if asked {
			g := fleet.got[0]
			want := tenantctx.TenantContext{TenantID: tenantA, MembershipID: member, AccountID: account, PersonID: person, Owner: true}
			if g.ModuleState != state || g.Tenant != want || !g.Now.Equal(fixedNow) {
				t.Fatalf("query %+v", g)
			}
		}
	}
}

// A core source is asked without reading the modules; nil Modules means no installable module.
func TestQueueCoreOnly(t *testing.T) {
	t.Parallel()
	dir := directory{m: membership("active", "active", true)}
	core := &source{items: []homeapi.DecisionItem{card("tenant.storage_high", homeapi.Warn)}}
	fleet := &source{module: "fleet"}
	q, err := service(t, dir, nil, core, fleet).Queue(t.Context(), account, tenantA, DefaultLimit)
	if err != nil || q.Total != 1 || len(fleet.got) != 0 || core.got[0].ModuleState != "" {
		t.Fatalf("queue %+v, %v; fleet asked %d", q, err, len(fleet.got))
	}
	mods := &modules{}
	if _, err := service(t, dir, mods, core).Queue(t.Context(), account, tenantA, DefaultLimit); err != nil || mods.calls != 0 {
		t.Fatalf("modules read %d times without a module source: %v", mods.calls, err)
	}
}

// A failing module registry or source fails the queue: the page shows its error state, not a silently short list.
func TestQueueFailures(t *testing.T) {
	t.Parallel()
	dir := directory{m: membership("active", "active", false)}
	_, err := service(t, dir, &modules{err: errors.New("tenant DB down")}, &source{module: "fleet"}).
		Queue(t.Context(), account, tenantA, DefaultLimit)
	wantCode(t, err, problem.CodeDependencyUnavailable)
	mods := &modules{states: map[string]string{"fleet": "active"}}
	_, err = service(t, dir, mods, &source{module: "fleet", err: errors.New("query failed")}).
		Queue(t.Context(), account, tenantA, DefaultLimit)
	wantCode(t, err, problem.CodeDependencyUnavailable)
	_, err = service(t, dir, mods, &source{module: "fleet", err: problem.New(problem.CodeForbiddenAction, "")}).
		Queue(t.Context(), account, tenantA, DefaultLimit)
	wantCode(t, err, problem.CodeForbiddenAction)
}

// An empty queue is items: [] in JSON, never null (required array of the contract).
func TestQueueEmpty(t *testing.T) {
	t.Parallel()
	q, err := service(t, directory{m: membership("active", "active", false)}, nil, &source{}).
		Queue(t.Context(), account, tenantA, DefaultLimit)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"items":[]`) || !strings.Contains(string(b), `"total":0`) {
		t.Fatalf("body %s", b)
	}
}

func TestNewRegistry(t *testing.T) {
	t.Parallel()
	if _, err := NewRegistry(&source{}, nil); !errors.Is(err, ErrNilSource) {
		t.Fatalf("nil source: %v", err)
	}
	a, b := &source{module: "fleet"}, &source{}
	r, err := NewRegistry(a, b)
	if err != nil {
		t.Fatal(err)
	}
	if got := r.Sources(); len(got) != 2 || got[0] != Source(a) || got[1] != Source(b) {
		t.Fatalf("sources %v", got)
	}
	if (*Registry)(nil).Sources() != nil {
		t.Fatal("nil registry has sources")
	}
}
