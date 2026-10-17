package finance

import (
	"context"
	"testing"

	"github.com/google/uuid"

	earningsapi "github.com/ortus/ortus-crm/backend/internal/api/earnings"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestServerWithoutTenant: without a tenant context every operation answers like a missing tenant (404).
func TestServerWithoutTenant(t *testing.T) {
	t.Parallel()
	h := Server{S: &Service{}}
	ctx := context.Background()
	for name, err := range map[string]error{
		"ListTripEarnings": second(h.ListTripEarnings(ctx, earningsapi.ListTripEarningsRequestObject{})),
		"GetTripEarnings":  second(h.GetTripEarnings(ctx, earningsapi.GetTripEarningsRequestObject{})),
		"SetTripEarnings":  second(h.SetTripEarnings(ctx, earningsapi.SetTripEarningsRequestObject{})),
	} {
		if !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
}

// TestServerRejectsRequests: a write without a body and a limit outside 1…200 are 400 before the service.
func TestServerRejectsRequests(t *testing.T) {
	t.Parallel()
	h := Server{S: &Service{}}
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	zero, big := 0, 201
	for name, err := range map[string]error{
		"SetTripEarnings": second(h.SetTripEarnings(ctx, earningsapi.SetTripEarningsRequestObject{TripId: uuid.New()})),
		"List 0": second(h.ListTripEarnings(ctx, earningsapi.ListTripEarningsRequestObject{
			Params: earningsapi.ListTripEarningsParams{Limit: &zero}})),
		"List 201": second(h.ListTripEarnings(ctx, earningsapi.ListTripEarningsRequestObject{
			Params: earningsapi.ListTripEarningsParams{Limit: &big}})),
	} {
		if !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v, want malformed_request", name, err)
		}
	}
}

func second[T any](_ T, err error) error { return err }
