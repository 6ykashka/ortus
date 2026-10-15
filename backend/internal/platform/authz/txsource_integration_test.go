//go:build integration

package authz_test

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test"
)

// W1.47 (Q-W1.41-9): команда модели доступа проверяет права в своей транзакции — TxSource поверх транзакции читает
// то же, что PGSource поверх пула: гранты (прямые и через группы), функции, подключённые модули, предков подразделения.
func TestTxSourceMatchesPGSource(t *testing.T) {
	t.Parallel()
	dir, p := pools(t, world)
	pg := authz.PGSource{Pools: p}
	tenant := ref(t, world, "tenant:a")
	pool, err := p.For(t.Context(), tenant)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(t.Context())) }()
	in := authz.TxSource{Q: tx}
	for _, actor := range []string{"a.two-roles", "a.driver-earnings", "a.driver-msk2", "a.project-lead", "a.manager-msk1", "a.owner"} {
		sameSubject(t, pg, in, tc(t, world, dir, actor))
	}
	owner := tc(t, world, dir, "a.owner")
	mods, err := in.InstalledModules(t.Context(), owner)
	if err != nil || !slices.Equal(mods, []string{"logistics"}) {
		t.Errorf("modules = %v %v", mods, err)
	}
	msk1 := ref(t, world, "unit:a.msk1")
	path, err := in.Ancestors(t.Context(), tenant, msk1)
	if err != nil || !slices.Equal(path, []uuid.UUID{msk1, ref(t, world, "unit:a.msk")}) {
		t.Errorf("ancestors of Москва-1 = %v %v", path, err)
	}
	unknown := uuid.New()
	if path, err := in.Ancestors(t.Context(), tenant, unknown); err != nil || !slices.Equal(path, []uuid.UUID{unknown}) {
		t.Errorf("ancestors of an unknown unit = %v %v", path, err)
	}
}

// sameSubject requires that in reads the subject of c as pg does, with and without grants.
func sameSubject(t *testing.T, pg, in authz.Source, c tenantctx.TenantContext) {
	t.Helper()
	for _, grants := range []bool{true, false} {
		want, err := pg.Subject(t.Context(), c, harness.Now(), grants)
		if err != nil {
			t.Fatal(err)
		}
		got, err := in.Subject(t.Context(), c, harness.Now(), grants)
		if err != nil {
			t.Fatalf("%s: %v", c.PersonID, err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s (grants %v): in the transaction %+v\nover the pool %+v", c.PersonID, grants, got, want)
		}
	}
}
