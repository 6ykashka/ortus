package main

import (
	"context"
	"net/http"
	"slices"
	"sync"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// recorder is an authorizer that admits by a function and records what the gateway asked.
type recorder struct {
	mu    sync.Mutex
	ops   []authz.Operation
	admit func(authz.Operation) error
}

func (r *recorder) Permit(context.Context, tenantctx.TenantContext, []string, string) error {
	return problem.New(problem.CodeForbiddenAction, "the gateway must call Admit with the x-scope")
}

func (r *recorder) Admit(_ context.Context, _ tenantctx.TenantContext, op authz.Operation) error {
	r.mu.Lock()
	r.ops = append(r.ops, op)
	r.mu.Unlock()
	return r.admit(op)
}

// Шлюз передаёт оценщику x-permissions, x-permissions-mode и x-scope операции (W1.04): вид области гранта
// засчитывается, только если x-scope его допускает (PD-53 на шлюзе).
func TestGatewayAdmitsWithOperationScope(t *testing.T) {
	t.Parallel()
	rec := &recorder{admit: func(op authz.Operation) error {
		if op.Scope == "tenant-or-org-unit" {
			return nil
		}
		return problem.New(problem.CodeForbiddenAction, "")
	}}
	d := testDeps(testConfig())
	d.authz = rec
	c := newClient(t, newHandler(d)).login("manager")
	if got := c.do(http.MethodGet, members(alta.String()), "", nil); got.Code != http.StatusNotImplemented {
		t.Fatalf("listMembers admitted: %d %s", got.Code, got.Body)
	}
	if got := c.do(http.MethodGet, "/api/v1/tenants/"+alta.String()+"/roles", "", nil); got.Code != http.StatusForbidden ||
		codeOf(got) != problem.CodeForbiddenAction {
		t.Fatalf("listRoles (x-scope tenant) denied: %d %s", got.Code, got.Body)
	}
	want := []authz.Operation{
		{ID: "listMembers", Permissions: []string{"members.read"}, Mode: "all", Scope: "tenant-or-org-unit"},
		{ID: "listRoles", Permissions: []string{"roles.read"}, Mode: "all", Scope: "tenant"},
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if !slices.EqualFunc(rec.ops, want, func(a, b authz.Operation) bool {
		return a.ID == b.ID && slices.Equal(a.Permissions, b.Permissions) && a.Mode == b.Mode && a.Scope == b.Scope
	}) {
		t.Errorf("Admit calls = %+v, want %+v", rec.ops, want)
	}
}

// function_blocked оценщика доходит до клиента как 403 с этим кодом (errors.yaml).
func TestGatewayFunctionBlocked(t *testing.T) {
	t.Parallel()
	d := testDeps(testConfig())
	d.authz = &recorder{admit: func(authz.Operation) error { return problem.New(authz.CodeFunctionBlocked, "") }}
	got := newClient(t, newHandler(d)).login("manager").do(http.MethodGet, members(alta.String()), "", nil)
	if got.Code != http.StatusForbidden || codeOf(got) != authz.CodeFunctionBlocked {
		t.Fatalf("%d %s", got.Code, got.Body)
	}
}
