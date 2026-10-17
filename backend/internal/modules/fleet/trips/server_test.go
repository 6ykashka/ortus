package trips

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestServerOverlay: the operations of the module answer without a tenant context like a missing tenant (404), the
// other operations of the tag go to the base (nil: 501), the trip card of W2.03 too.
func TestServerOverlay(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := context.Background()
	calls := map[string]func() error{
		"StartTrip": func() error { _, err := h.StartTrip(ctx, fleetapi.StartTripRequestObject{}); return err },
		"GetTrip":   func() error { _, err := h.GetTrip(ctx, fleetapi.GetTripRequestObject{}); return err },
		"ListTrips": func() error { _, err := h.ListTrips(ctx, fleetapi.ListTripsRequestObject{}); return err },
		"FinishTripRoute": func() error {
			_, err := h.FinishTripRoute(ctx, fleetapi.FinishTripRouteRequestObject{})
			return err
		},
		"ReturnTrip": func() error { _, err := h.ReturnTrip(ctx, fleetapi.ReturnTripRequestObject{}); return err },
	}
	for name, call := range calls {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
	if _, err := h.ReviewTrip(ctx, fleetapi.ReviewTripRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("ReviewTrip (W2.06): %v, want the base 501", err)
	}
}

// TestServerRejectsRequests: a tenant without a body or with a limit outside 1…200 is 400 before the service.
func TestServerRejectsRequests(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	zero, big := 0, 201
	for name, err := range map[string]error{
		"StartTrip":     second(h.StartTrip(ctx, fleetapi.StartTripRequestObject{})),
		"ReturnTrip":    second(h.ReturnTrip(ctx, fleetapi.ReturnTripRequestObject{TripId: uuid.New()})),
		"ListTrips":     second(h.ListTrips(ctx, fleetapi.ListTripsRequestObject{Params: fleetapi.ListTripsParams{Limit: &zero}})),
		"ListTrips 201": second(h.ListTrips(ctx, fleetapi.ListTripsRequestObject{Params: fleetapi.ListTripsParams{Limit: &big}})),
	} {
		if !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v, want malformed_request", name, err)
		}
	}
}

func second[T any](_ T, err error) error { return err }

// planBase stands for the base of the tag in main, where the trip card is the read of W2.03 (fleet/routes).
type planBase struct{ unimplemented }

var errPlanBase = errors.New("trip card of the base")

func (planBase) GetTripPlan(context.Context, fleetapi.GetTripPlanRequestObject) (fleetapi.GetTripPlanResponseObject, error) {
	return nil, errPlanBase
}

func (planBase) ListTripPlans(context.Context, fleetapi.ListTripPlansRequestObject) (fleetapi.ListTripPlansResponseObject, error) {
	return nil, errPlanBase
}

// TestServerLeavesTripCardToBase: getTripPlan and listTripPlans are W2.03's reads in the base of the tag; the overlay
// passes them down, with and without a tenant context, so main keeps one copy of them (review of W2.05, round 1).
func TestServerLeavesTripCardToBase(t *testing.T) {
	t.Parallel()
	h := NewServer(planBase{}, &Service{})
	for name, ctx := range map[string]context.Context{
		"no tenant": context.Background(),
		"tenant":    tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()}),
	} {
		if _, err := h.GetTripPlan(ctx, fleetapi.GetTripPlanRequestObject{TripId: uuid.New()}); !errors.Is(err, errPlanBase) {
			t.Errorf("%s: GetTripPlan %v, want the base", name, err)
		}
		if _, err := h.ListTripPlans(ctx, fleetapi.ListTripPlansRequestObject{}); !errors.Is(err, errPlanBase) {
			t.Errorf("%s: ListTripPlans %v, want the base", name, err)
		}
	}
}
