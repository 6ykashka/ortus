package home

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// counter is a fake counter of tasks: its counts or its error, and the queries it got.
type counter struct {
	counts TaskCounts
	err    error
	got    []Query
}

func (c *counter) TaskCounts(_ context.Context, q Query) (TaskCounts, error) {
	c.got = append(c.got, q)
	return c.counts, c.err
}

func withTasks(s *Service, c TaskCounter) *Service {
	s.Tasks = c
	return s
}

// W4.81 · getMyTaskSummary: the tenant of the query is an active membership of the identity in a readable business,
// otherwise 404 not_found and the counter is not asked; the counter gets the member and the clock; no counter — zeros.
func TestTaskSummary(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		dir  directory
		code string
	}{
		{"no membership", directory{}, problem.CodeNotFound},
		{"suspended business", directory{m: membership("suspended", "active", true)}, problem.CodeNotFound},
		{"directory down", directory{err: errors.New("control DB down")}, problem.CodeDependencyUnavailable},
	} {
		cnt := &counter{}
		_, err := withTasks(service(t, c.dir, nil), cnt).TaskSummary(t.Context(), account, tenantA)
		wantCode(t, err, c.code)
		if len(cnt.got) != 0 {
			t.Fatalf("%s: counter asked for a refused tenant", c.name)
		}
	}

	dir := directory{m: membership("active", "active", false)}
	got, err := service(t, dir, nil).TaskSummary(t.Context(), account, tenantA)
	if err != nil {
		t.Fatal(err)
	}
	if want := (homeapi.TaskSummary{TenantId: tenantA, GeneratedAt: fixedNow}); got != want {
		t.Fatalf("no counter: %+v, want zeros %+v", got, want)
	}

	cnt := &counter{counts: TaskCounts{New: 2, InProgress: 3, Review: 4, MyNew: 1}}
	got, err = withTasks(service(t, dir, nil), cnt).TaskSummary(t.Context(), account, tenantA)
	if err != nil {
		t.Fatal(err)
	}
	want := homeapi.TaskSummary{TenantId: tenantA, New: 2, InProgress: 3, Review: 4, MyNew: 1, GeneratedAt: fixedNow}
	if got != want {
		t.Fatalf("summary %+v, want %+v", got, want)
	}
	tc := tenantctx.TenantContext{TenantID: tenantA, MembershipID: member, AccountID: account, PersonID: person}
	if len(cnt.got) != 1 || cnt.got[0].Tenant != tc || !cnt.got[0].Now.Equal(fixedNow) {
		t.Fatalf("queries %+v", cnt.got)
	}
}

// A failing counter fails the summary: a Problem keeps its code, anything else is dependency_unavailable.
func TestTaskSummaryFailures(t *testing.T) {
	t.Parallel()
	dir := directory{m: membership("active", "active", false)}
	_, err := withTasks(service(t, dir, nil), &counter{err: errors.New("tenant DB down")}).TaskSummary(t.Context(), account, tenantA)
	wantCode(t, err, problem.CodeDependencyUnavailable)
	_, err = withTasks(service(t, dir, nil), &counter{err: problem.New(problem.CodeForbiddenAction, "")}).TaskSummary(t.Context(), account, tenantA)
	wantCode(t, err, problem.CodeForbiddenAction)
}

// The server of getMyTaskSummary: the account of the session, never cached, the request id.
func TestServerTaskSummary(t *testing.T) {
	t.Parallel()
	cnt := &counter{counts: TaskCounts{New: 1, MyNew: 1}}
	srv := Server{S: withTasks(service(t, directory{m: membership("active", "active", false)}, nil), cnt)}
	req := homeapi.GetMyTaskSummaryRequestObject{Params: homeapi.GetMyTaskSummaryParams{TenantId: tenantA}}
	_, err := srv.GetMyTaskSummary(t.Context(), req)
	wantCode(t, err, problem.CodeSessionExpired)

	inRequest(session.WithSession(t.Context(), session.Session{AccountID: account}), "req-2", func(ctx context.Context) {
		resp, err := srv.GetMyTaskSummary(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		ok, isOK := resp.(homeapi.GetMyTaskSummary200JSONResponse)
		if !isOK || ok.Body.New != 1 || ok.Body.MyNew != 1 || ok.Body.TenantId != tenantA {
			t.Fatalf("response %#v", resp)
		}
		if ok.Headers.CacheControl == nil || *ok.Headers.CacheControl != noStore || ok.Headers.XRequestId == nil || *ok.Headers.XRequestId != "req-2" {
			t.Fatalf("headers %+v", ok.Headers)
		}
		_, err = srv.GetMyTaskSummary(ctx, homeapi.GetMyTaskSummaryRequestObject{Params: homeapi.GetMyTaskSummaryParams{TenantId: uuid.New()}})
		wantCode(t, err, problem.CodeNotFound)
	})
}
