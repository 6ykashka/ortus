package scopeddb

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

type fakeScoper struct {
	p   authz.Predicate
	err error
	got int // argStart of the last call
}

func (f *fakeScoper) ScopeQuery(_ context.Context, _ tenantctx.TenantContext, _ string, _ authz.Columns, argStart int) (authz.Predicate, error) {
	f.got = argStart
	return f.p, f.err
}

// Предикат встаёт на место {{scope}}, его аргументы нумеруются после аргументов запроса; запрос без {{scope}} или
// с двумя — отказ (предикат нельзя забыть).
func TestBuild(t *testing.T) {
	t.Parallel()
	s := &fakeScoper{p: authz.Predicate{SQL: "t.unit_id = $3", Args: []any{"u"}}}
	c := &Conn{scoper: s}
	sql, args, err := c.build(t.Context(), "fleet.vehicles.read", authz.Columns{Unit: "t.unit_id"},
		"select id from fleet.vehicles t where t.id = $1 and t.state = $2 and {{scope}}", []any{"id", "ready"})
	if err != nil {
		t.Fatal(err)
	}
	if sql != "select id from fleet.vehicles t where t.id = $1 and t.state = $2 and (t.unit_id = $3)" || s.got != 2 ||
		!slices.Equal(args, []any{"id", "ready", "u"}) {
		t.Errorf("build = %q %v (argStart %d)", sql, args, s.got)
	}
	for _, bad := range []string{"select 1", "select 1 where {{scope}} or {{scope}}"} {
		if _, _, err := c.build(t.Context(), "a", authz.Columns{}, bad, nil); !errors.Is(err, ErrNoScope) {
			t.Errorf("%q: %v, want ErrNoScope", bad, err)
		}
	}
	s.err = errors.New("boom")
	if _, _, err := c.build(t.Context(), "a", authz.Columns{}, "select 1 where {{scope}}", nil); !errors.Is(err, s.err) {
		t.Errorf("scoper failure: %v", err)
	}
}

// Аргументы вызывающего не портятся при добавлении аргументов предиката.
func TestBuildKeepsCallerArgs(t *testing.T) {
	t.Parallel()
	c := &Conn{scoper: &fakeScoper{p: authz.Predicate{SQL: "x = $2", Args: []any{"p"}}}}
	callerArgs := make([]any, 1, 4)
	callerArgs[0] = "a"
	_, args, err := c.build(t.Context(), "a", authz.Columns{}, "select {{scope}}", callerArgs)
	if err != nil {
		t.Fatal(err)
	}
	args[0] = "changed"
	if callerArgs[0] != "a" || len(args) != 2 {
		t.Errorf("caller args %v, built %v", callerArgs, args)
	}
}
