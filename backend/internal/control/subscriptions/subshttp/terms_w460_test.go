package subshttp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// altaTerms are the terms of «Альта» of the example getPlatformSubscription/ok (trial on «Старт» v2, 7 active and 2
// invited of 10 seats) for any subscription.
type altaTerms struct{}

func (altaTerms) Terms(context.Context, subscriptions.Subscription) (billing.Terms, error) {
	return billing.Terms{TierName: "Старт", Seats: billing.Seats{Limit: new(10), Active: 7, Invited: 2}}, nil
}

// lotosTerms are the terms of «Лотос» of the examples */seats (paid «Команда» v1 for 12 months, 23 of 25 seats).
type lotosTerms struct{ err error }

func (l lotosTerms) Terms(context.Context, subscriptions.Subscription) (billing.Terms, error) {
	return billing.Terms{
		TierName: "Команда", MonthlyMinor: new(int64(680000)), PeriodMinor: new(int64(8160000)),
		Seats: billing.Seats{Limit: new(25), Active: 23},
	}, l.err
}

var lotos = uuid.MustParse("e4f2195f-f5a3-5f61-98be-f6ed76ea565a")

// lotosPaid is the subscription of the examples getTenantSubscription/seats and getPlatformSubscription/seats.
func lotosPaid() subscriptions.Subscription {
	end := time.Date(2027, 3, 31, 21, 0, 0, 0, time.UTC)
	ents := subscriptions.PlanEntitlements("team", subscriptions.SourcePlan, 50<<30)
	return subscriptions.Subscription{
		TenantID: lotos, PlanKey: "team", Status: subscriptions.StatusActive, PeriodEndsAt: &end, Revision: 1, Entitlements: ents,
		TermMonths: new(12), PriceVersion: new(1), AmountMinor: new(int64(8160000)),
	}
}

// W4.60: подписка оплаченного периода — тариф, срок, версия цен, суммы срока и места; тело = примеры */seats.
func TestSubscriptionTerms(t *testing.T) {
	t.Parallel()
	ps := PlatformServer{Subs: &fakeSubs{sub: lotosPaid()}, Terms: lotosTerms{}}
	pr, err := ps.GetPlatformSubscription(t.Context(), platformapi.GetPlatformSubscriptionRequestObject{TenantId: lotos})
	if err != nil {
		t.Fatal(err)
	}
	pok, isOK := pr.(platformapi.GetPlatformSubscription200JSONResponse)
	if got, want := asJSON(t, pok.Body), example(t, "getPlatformSubscription", "seats"); !isOK || got != want {
		t.Errorf("operator\n got %s\nwant %s", got, want)
	}
	bs := NewBillingServer(nil, &fakeSubs{sub: lotosPaid()})
	bs.Terms = lotosTerms{}
	ctx := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: lotos, Owner: true})
	br, err := bs.GetTenantSubscription(ctx, billingapi.GetTenantSubscriptionRequestObject{TenantId: lotos})
	if err != nil {
		t.Fatal(err)
	}
	bok, isOK := br.(billingapi.GetTenantSubscription200JSONResponse)
	if got, want := asJSON(t, bok.Body), example(t, "getTenantSubscription", "seats"); !isOK || got != want {
		t.Errorf("owner\n got %s\nwant %s", got, want)
	}
	// Условия не прочитать — ответ не отдаётся (503), а не подписка без мест.
	ps.Terms = lotosTerms{err: errors.New("control DB down")}
	if _, err := ps.GetPlatformSubscription(t.Context(), platformapi.GetPlatformSubscriptionRequestObject{TenantId: lotos}); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("terms failed: %v", err)
	}
}
