package data

import (
	"context"
	"slices"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// scoper answers ScopeQuery with a predicate per action; an action it does not know is «false».
type scoper map[string]string

func (s scoper) ScopeQuery(_ context.Context, _ tenantctx.TenantContext, action string, _ authz.Columns, _ int) (authz.Predicate, error) {
	if p, ok := s[action]; ok {
		return authz.Predicate{SQL: p}, nil
	}
	return authz.Predicate{SQL: "false"}, nil
}

// The dataset is visible when the member holds its permission in some scope; a restricted field is open only with its
// permission somewhere (the evaluator closes fleet.earnings.read for a driver), otherwise its label is hidden.
func TestResolve(t *testing.T) {
	t.Parallel()
	e := entry{module: "fleet", spec: itemsSpec()}
	for _, c := range []struct {
		name          string
		scopes        scoper
		export        bool
		visible       bool
		fields        []string
		hidden        []string
		exportAllowed bool
	}{
		{"no dataset permission", scoper{"fleet.earnings.read": "true"}, true, false, nil, nil, false},
		{"unit scope, field closed", scoper{"fleet.vehicles.read": "(x.unit_id = $1)"}, true, true,
			[]string{"name", "kind", "size", "price", "day"}, []string{"Секрет"}, true},
		{"field open", scoper{"fleet.vehicles.read": "true", "fleet.earnings.read": "(x.unit_id = $1)"}, false, true,
			[]string{"name", "kind", "size", "price", "day", "secret"}, nil, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := &Service{Authz: c.scopes}
			v, visible, err := s.resolve(t.Context(), tenantctx.TenantContext{}, e, c.export, "3")
			if err != nil {
				t.Fatal(err)
			}
			if visible != c.visible {
				t.Fatalf("visible %v", visible)
			}
			if !visible {
				return
			}
			keys := make([]string, 0, len(v.fields))
			for _, f := range v.fields {
				keys = append(keys, f.Key)
			}
			if !slices.Equal(keys, c.fields) || !slices.Equal(v.hidden, c.hidden) || v.export != c.exportAllowed ||
				v.version != "3" || v.module != "fleet" {
				t.Fatalf("view %+v", v)
			}
		})
	}
}
