//go:build integration

package fleet_test

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// hider closes trips to people (data.Hider as the pool of cmd/api: the trips of the transfers of the member closed to
// him now).
type hider map[uuid.UUID][]uuid.UUID

func (h hider) Hidden(_ context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	return h[tc.PersonID], nil
}

// W2.57 (AC-06, Q-W2.07-1 «только рейс»): a trip the pool closes to its driver leaves «Поездки» and «Расходы» of his
// «Данные» — the rows and visibleCount; the others keep it.
func TestHiddenTripsLeaveTheDatasets(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	e.svc.Hidden = hider{person("a.driver-msk1", "a"): {seeded.trips["Р-701"]}}
	const raw = `{"select": ["trip"], "filters": [], "sort": [], "limit": 50, "includeCount": true}`
	trips := e.rows(t, "a.driver-msk1", "a", tripsSet, raw)
	wantColumn(t, trips, "trip", "Р-703 · Лобня", "Р-706 · Королёв")
	if trips.VisibleCount == nil || *trips.VisibleCount != 2 {
		t.Fatalf("visibleCount %v, want 2", trips.VisibleCount)
	}
	wantColumn(t, e.rows(t, "a.driver-msk1", "a", expensesSet, raw), "trip", "Р-703")
	wantColumn(t, e.rows(t, "a.manager-msk1", "a", tripsSet, raw), "trip",
		"Р-701 · Северный маршрут", "Р-702 · Химки", "Р-703 · Лобня", "Р-704 · Мытищи", "Р-706 · Королёв")
}

// countingHider counts the reads of the Hider and hides nothing.
type countingHider struct{ n *atomic.Int64 }

func (h countingHider) Hidden(context.Context, tenantctx.TenantContext) ([]uuid.UUID, error) {
	h.n.Add(1)
	return nil, nil
}

// W2.57, return 2: the Hider is a read of the DB — «Автомобили» has no trip to hide and never asks it; «Поездки»
// asks it once per query.
func TestOnlyTripDatasetsAskTheHider(t *testing.T) {
	t.Parallel()
	e := newEnv(t, "active")
	n := &atomic.Int64{}
	e.svc.Hidden = countingHider{n: n}
	e.rows(t, "a.manager-msk1", "a", vehiclesSet, `{"select": ["displayName"], "filters": [], "sort": [], "limit": 10}`)
	if got := n.Load(); got != 0 {
		t.Fatalf("«Автомобили» read the Hider %d times, want 0", got)
	}
	e.rows(t, "a.manager-msk1", "a", tripsSet, `{"select": ["trip"], "filters": [], "sort": [], "limit": 10}`)
	if got := n.Load(); got != 1 {
		t.Fatalf("«Поездки» read the Hider %d times, want 1", got)
	}
}
