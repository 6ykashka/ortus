package main

// W4.60 (step 4.6): the billing of the control DB in cmd/api — seats, the price book, tier requests, usage.

// billingAnyState are the billing operations the owner keeps in grace, read_only and suspended tenants (Q-W4.07-3,
// contract 0.8.0-stage4 «Allowed in trial, active, grace, read_only and suspended tenants», MSW BILLING_ANY_STATE):
// x-permissions and x-scope are checked as usual, only the state of the tenant does not close them.
var billingAnyState = map[string]bool{
	"getTenantPriceBook":              true,
	"listSubscriptionChangeRequests":  true,
	"createSubscriptionChangeRequest": true,
	"cancelSubscriptionChangeRequest": true,
}
