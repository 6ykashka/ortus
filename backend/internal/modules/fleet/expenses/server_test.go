package expenses

import (
	"context"
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestServerOverlay: the operations of the module answer without a tenant context like a missing tenant (404),
// reviewTripExpense (W2.06) and the rest go to the base (nil: 501); a body is required, a limit is 1…200.
func TestServerOverlay(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := context.Background()
	for name, err := range map[string]error{
		"CreateTripExpense": second(h.CreateTripExpense(ctx, fleetapi.CreateTripExpenseRequestObject{})),
		"ListTripExpenses":  second(h.ListTripExpenses(ctx, fleetapi.ListTripExpensesRequestObject{})),
		"GetTripExpense":    second(h.GetTripExpense(ctx, fleetapi.GetTripExpenseRequestObject{})),
	} {
		if !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
	if _, err := h.ReviewTripExpense(ctx, fleetapi.ReviewTripExpenseRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("ReviewTripExpense (W2.06): %v, want the base 501", err)
	}
	tc := tenantctx.WithTenant(ctx, tenantctx.TenantContext{TenantID: uuid.New()})
	big := 201
	for name, err := range map[string]error{
		"CreateTripExpense": second(h.CreateTripExpense(tc, fleetapi.CreateTripExpenseRequestObject{TripId: uuid.New()})),
		"ListTripExpenses": second(h.ListTripExpenses(tc, fleetapi.ListTripExpensesRequestObject{
			Params: fleetapi.ListTripExpensesParams{Limit: &big}})),
	} {
		if !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v, want malformed_request", name, err)
		}
	}
}

func second[T any](_ T, err error) error { return err }
