package subshttp

// W4.60 (contract 0.8.0-stage4, W4.07): the tier, the terms of the paid period and the seats of a subscription in
// getTenantSubscription and getPlatformSubscription (MSW subscriptionWithTerms).

import (
	"context"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// terms reads the terms of sub from src (nil — none); a failure is dependency_unavailable.
func terms(ctx context.Context, src TermsSource, sub subscriptions.Subscription) (billing.Terms, bool, error) {
	if src == nil {
		return billing.Terms{}, false, nil
	}
	t, err := src.Terms(ctx, sub)
	if err != nil {
		return billing.Terms{}, false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return t, true, nil
}

// platformTerms adds the fields of W4.07 to out: tierCode is the plan, the name of the tier and the amounts of the
// term come from the price book version of the paid period.
func platformTerms(out *platformapi.Subscription, sub subscriptions.Subscription, t billing.Terms) {
	out.TierCode = &sub.PlanKey
	if t.TierName != "" {
		out.TierName = &t.TierName
	}
	if sub.TermMonths != nil {
		out.TermMonths = new(platformapi.SubscriptionTermMonths(*sub.TermMonths))
	}
	out.PriceVersion = sub.PriceVersion
	if t.MonthlyMinor != nil && t.PeriodMinor != nil {
		out.MonthlyAmount = &platformapi.Money{AmountMinor: int(*t.MonthlyMinor), Currency: billing.Currency}
		out.PeriodAmount = &platformapi.Money{AmountMinor: int(*t.PeriodMinor), Currency: billing.Currency}
	}
	out.Seats = &platformapi.SeatUsage{
		Limit: t.Seats.Limit, Used: t.Seats.Used(), Active: t.Seats.Active, Invited: t.Seats.Invited, Available: t.Seats.Available(),
	}
}

// billingTerms adds the fields of W4.07 to out (see platformTerms; the types of both tags are the same schemas).
func billingTerms(out *billingapi.Subscription, sub subscriptions.Subscription, t billing.Terms) {
	var p platformapi.Subscription
	platformTerms(&p, sub, t)
	out.TierCode, out.TierName, out.PriceVersion = p.TierCode, p.TierName, p.PriceVersion
	out.TermMonths = (*billingapi.SubscriptionTermMonths)(p.TermMonths)
	out.MonthlyAmount, out.PeriodAmount = (*billingapi.Money)(p.MonthlyAmount), (*billingapi.Money)(p.PeriodAmount)
	out.Seats = (*billingapi.SeatUsage)(p.Seats)
}
