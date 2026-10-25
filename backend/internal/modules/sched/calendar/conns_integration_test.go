//go:build integration

package calendar

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// heldStates is a module registry that notes how many connections of the tenant pool are held when it is asked
// (the real one, modulesreg.PGStore, reads the tenant DB through the same pool).
type heldStates struct{ held []int32 }

func (h *heldStates) States(ctx context.Context, tenant uuid.UUID) (map[string]string, error) {
	pool, err := pools.For(ctx, tenant)
	if err != nil {
		return nil, err
	}
	h.held = append(h.held, pool.Stat().AcquiredConns())
	return spaOnly, nil
}

// W4.82: an operation holds one connection of the tenant DB at most (W1.47). The module states are read before the
// transaction opens: a request that holds its transaction and asks the registry for one more connection waits forever
// once every connection of the pool (four, one of them held by the listener) is held so — the isolation suite hung.
//
//nolint:paralleltest // counts the connections held in the pool shared with the other tests of the package
func TestRunReadsModuleStatesBeforeItsTransaction(t *testing.T) {
	h := &heldStates{}
	svc := service(h)
	if _, err := svc.Resources(t.Context(), as(t, "a.manager-msk1"), ResourceQuery{}); err != nil {
		t.Fatal(err)
	}
	if len(h.held) == 0 {
		t.Fatal("the registry of modules was not asked")
	}
	for _, n := range h.held {
		if n != 0 {
			t.Errorf("the registry was asked with %d connection(s) of the pool held by the operation, want 0", n)
		}
	}
}
