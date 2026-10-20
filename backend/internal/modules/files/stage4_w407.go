// Code below: W4.07 (contract 0.8.0-stage4, step 4.6) — operations without an owner yet answer 501
// not_implemented until W4.60 implements them.

package files

import (
	"context"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// GetTenantPriceBook implements billingapi.StrictServerInterface: 501 until W4.60.
func (Billing) GetTenantPriceBook(context.Context, billingapi.GetTenantPriceBookRequestObject) (billingapi.GetTenantPriceBookResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListSubscriptionChangeRequests implements billingapi.StrictServerInterface: 501 until W4.60.
func (Billing) ListSubscriptionChangeRequests(context.Context, billingapi.ListSubscriptionChangeRequestsRequestObject) (billingapi.ListSubscriptionChangeRequestsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// CreateSubscriptionChangeRequest implements billingapi.StrictServerInterface: 501 until W4.60.
func (Billing) CreateSubscriptionChangeRequest(context.Context, billingapi.CreateSubscriptionChangeRequestRequestObject) (billingapi.CreateSubscriptionChangeRequestResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// CancelSubscriptionChangeRequest implements billingapi.StrictServerInterface: 501 until W4.60.
func (Billing) CancelSubscriptionChangeRequest(context.Context, billingapi.CancelSubscriptionChangeRequestRequestObject) (billingapi.CancelSubscriptionChangeRequestResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
