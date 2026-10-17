package review

import (
	"context"
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestServerOverlay: the operations of the module answer without a tenant context like a missing tenant (404), the
// other operations of the tag go to the base (nil: 501).
func TestServerOverlay(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := context.Background()
	if _, err := h.ReviewTrip(ctx, fleetapi.ReviewTripRequestObject{}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("ReviewTrip: %v, want not_found", err)
	}
	if _, err := h.ReviewTripExpense(ctx, fleetapi.ReviewTripExpenseRequestObject{}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("ReviewTripExpense: %v, want not_found", err)
	}
	if _, err := h.ReturnTrip(ctx, fleetapi.ReturnTripRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("ReturnTrip (W2.05): %v, want the base 501", err)
	}
}

// TestServerRejectsRequests: a tenant without a body is 400 before the service.
func TestServerRejectsRequests(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	if _, err := h.ReviewTrip(ctx, fleetapi.ReviewTripRequestObject{TripId: uuid.New()}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("ReviewTrip: %v, want malformed_request", err)
	}
	if _, err := h.ReviewTripExpense(ctx, fleetapi.ReviewTripExpenseRequestObject{TripId: uuid.New()}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("ReviewTripExpense: %v, want malformed_request", err)
	}
}
