// Package subshttp serves the subscription operations of W1.08 inside the strict servers of two OpenAPI tags it
// shares with other owners: Platform (getPlatformSubscription, updatePlatformSubscription; the tenant registry is
// W1.02, the operator commands W1.11) and Billing (getTenantSubscription; the storage operations are W1.09,
// requestSubscriptionChange is W4.60 by D-33). Each server embeds the base server of the tag and overrides only the
// operations of the subscription, so no file of the other owners changes.
package subshttp

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Subscriptions is the subscription store (subscriptions.Store).
type Subscriptions interface {
	Current(ctx context.Context, tenantID uuid.UUID) (subscriptions.Subscription, error)
	Update(ctx context.Context, tenantID uuid.UUID, u subscriptions.Update, ifMatch int64, actor uuid.UUID) (subscriptions.Subscription, error)
}

const noStore = "private, no-store"

// ETag is the strong entity tag of a revision ("rev-N", as MSW W0.13).
func ETag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

var etagRE = regexp.MustCompile(`^"(?:rev-)?([1-9][0-9]{0,17})"$`)

func parseIfMatch(raw string) (int64, error) {
	m := etagRE.FindStringSubmatch(raw)
	if m == nil {
		return 0, problem.New(problem.CodeMalformedRequest, "If-Match: нужен ETag последнего ответа.")
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	return n, nil
}

// storeError maps the store errors to Problem codes; anything unexpected is dependency_unavailable.
func storeError(err error) error {
	var ve *subscriptions.ValidationError
	switch {
	case errors.Is(err, subscriptions.ErrUnknownTenant):
		return problem.New(problem.CodeNotFound, "")
	case errors.Is(err, subscriptions.ErrRevision):
		return problem.New("revision_mismatch", "Подписку уже изменили. Обновите и повторите.")
	case errors.As(err, &ve):
		detail := "Неверные поля: " + strings.Join(ve.Fields, ", ")
		if len(ve.Fields) == 1 && ve.Fields[0] == "reason" {
			detail = "Укажите причину изменения."
		}
		return problem.New("validation_failed", detail)
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// TermsSource is the billing of the control DB (billing.Store, W4.60): the tier, the terms and the seats of a
// subscription.
type TermsSource interface {
	Terms(ctx context.Context, sub subscriptions.Subscription) (billing.Terms, error)
}

// PlatformServer is the tag Platform with the subscription operations of W1.08.
type PlatformServer struct {
	platformapi.StrictServerInterface
	Subs  Subscriptions
	Terms TermsSource // W4.60: the fields of W4.07 of getPlatformSubscription; nil — none
}

func platformSubscription(s subscriptions.Subscription) platformapi.Subscription {
	out := platformapi.Subscription{
		PlanKey: s.PlanKey, Status: platformapi.SubscriptionStatus(s.Status), TrialEndsAt: s.TrialEndsAt,
		PeriodEndsAt: s.PeriodEndsAt, GraceEndsAt: s.GraceEndsAt, CancelAtPeriodEnd: s.CancelAtPeriodEnd,
		Entitlements: make([]platformapi.Entitlement, 0, len(s.Entitlements)), Revision: s.Revision,
	}
	for _, e := range s.Entitlements {
		out.Entitlements = append(out.Entitlements, platformapi.Entitlement{
			Key: e.Key, SourceType: platformapi.EntitlementSourceType(e.SourceType), SourceRef: e.SourceRef,
			Value: e.Value, ValidUntil: e.ValidUntil,
		})
	}
	return out
}

// GetPlatformSubscription implements platformapi.StrictServerInterface (operators only: the gateway checked it).
func (s PlatformServer) GetPlatformSubscription(ctx context.Context, req platformapi.GetPlatformSubscriptionRequestObject) (platformapi.GetPlatformSubscriptionResponseObject, error) {
	sub, err := s.Subs.Current(ctx, req.TenantId)
	if err != nil {
		return nil, storeError(err)
	}
	body := platformSubscription(sub)
	if t, ok, err := terms(ctx, s.Terms, sub); err != nil {
		return nil, err
	} else if ok {
		platformTerms(&body, sub, t)
	}
	cc, rid, tag := noStore, requestid.FromContext(ctx), ETag(sub.Revision)
	return platformapi.GetPlatformSubscription200JSONResponse{
		Body:    body,
		Headers: platformapi.GetPlatformSubscription200ResponseHeaders{CacheControl: &cc, ETag: &tag, XRequestId: &rid},
	}, nil
}

// UpdatePlatformSubscription implements platformapi.StrictServerInterface: the audited change of an operator.
func (s PlatformServer) UpdatePlatformSubscription(ctx context.Context, req platformapi.UpdatePlatformSubscriptionRequestObject) (platformapi.UpdatePlatformSubscriptionResponseObject, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeSessionExpired, "")
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	ifMatch, err := parseIfMatch(req.Params.IfMatch)
	if err != nil {
		return nil, err
	}
	b := req.Body
	u := subscriptions.Update{
		PlanKey: b.PlanKey, Status: string(b.Status), TrialEndsAt: b.TrialEndsAt, PeriodEndsAt: b.PeriodEndsAt,
		GraceEndsAt: b.GraceEndsAt, CancelAtPeriodEnd: b.CancelAtPeriodEnd, Reason: b.Reason,
	}
	for _, e := range b.ManualEntitlements {
		u.Manual = append(u.Manual, subscriptions.Entitlement{
			Key: e.Key, SourceType: string(e.SourceType), SourceRef: e.SourceRef, Value: e.Value, ValidUntil: e.ValidUntil,
		})
	}
	sub, err := s.Subs.Update(ctx, req.TenantId, u, ifMatch, sess.AccountID)
	if err != nil {
		return nil, storeError(err)
	}
	cc, rid, tag, replayed := noStore, requestid.FromContext(ctx), ETag(sub.Revision), false
	return platformapi.UpdatePlatformSubscription200JSONResponse{
		Body: platformSubscription(sub),
		Headers: platformapi.UpdatePlatformSubscription200ResponseHeaders{
			CacheControl: &cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: &rid,
		},
	}, nil
}

// BillingServer is the tag Billing with the subscription operations of W1.08.
type BillingServer struct {
	billingapi.StrictServerInterface
	Subs  Subscriptions
	Terms TermsSource // W4.60: the fields of W4.07 of getTenantSubscription; nil — none
}

// NewBillingServer embeds base (nil: every other operation of the tag answers 501 until W1.09).
func NewBillingServer(base billingapi.StrictServerInterface, subs Subscriptions) BillingServer {
	if base == nil {
		base = unimplementedBilling{}
	}
	return BillingServer{StrictServerInterface: base, Subs: subs}
}

func billingSubscription(s subscriptions.Subscription) billingapi.Subscription {
	p := platformSubscription(s)
	out := billingapi.Subscription{
		PlanKey: p.PlanKey, Status: billingapi.SubscriptionStatus(p.Status), TrialEndsAt: p.TrialEndsAt,
		PeriodEndsAt: p.PeriodEndsAt, GraceEndsAt: p.GraceEndsAt, CancelAtPeriodEnd: p.CancelAtPeriodEnd,
		Entitlements: make([]billingapi.Entitlement, 0, len(p.Entitlements)), Revision: p.Revision,
	}
	for _, e := range p.Entitlements {
		out.Entitlements = append(out.Entitlements, billingapi.Entitlement{
			Key: e.Key, SourceType: billingapi.EntitlementSourceType(e.SourceType), SourceRef: e.SourceRef, Value: e.Value,
			ValidUntil: e.ValidUntil,
		})
	}
	return out
}

// GetTenantSubscription implements billingapi.StrictServerInterface: the subscription of the tenant of the request
// (owner or billing manager: the gateway checked x-scope).
func (s BillingServer) GetTenantSubscription(ctx context.Context, _ billingapi.GetTenantSubscriptionRequestObject) (billingapi.GetTenantSubscriptionResponseObject, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeNotFound, "")
	}
	sub, err := s.Subs.Current(ctx, tc.TenantID)
	if err != nil {
		return nil, storeError(err)
	}
	body := billingSubscription(sub)
	if t, ok, err := terms(ctx, s.Terms, sub); err != nil {
		return nil, err
	} else if ok {
		billingTerms(&body, sub, t)
	}
	cc, rid, tag := noStore, requestid.FromContext(ctx), ETag(sub.Revision)
	return billingapi.GetTenantSubscription200JSONResponse{
		Body:    body,
		Headers: billingapi.GetTenantSubscription200ResponseHeaders{CacheControl: &cc, ETag: &tag, XRequestId: &rid},
	}, nil
}

// RequestSubscriptionChange implements billingapi.StrictServerInterface: plans of owners are step 4.6 (D-33, W4.60);
// in the pilot an operator changes the subscription.
func (s BillingServer) RequestSubscriptionChange(context.Context, billingapi.RequestSubscriptionChangeRequestObject) (billingapi.RequestSubscriptionChangeResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// unimplementedBilling answers 501 for the operations of the tag Billing without an owner yet.
type unimplementedBilling struct{}

func (unimplementedBilling) GetTenantSubscription(context.Context, billingapi.GetTenantSubscriptionRequestObject) (billingapi.GetTenantSubscriptionResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

func (unimplementedBilling) RequestSubscriptionChange(context.Context, billingapi.RequestSubscriptionChangeRequestObject) (billingapi.RequestSubscriptionChangeResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

func (unimplementedBilling) GetStorageUsage(context.Context, billingapi.GetStorageUsageRequestObject) (billingapi.GetStorageUsageResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

func (unimplementedBilling) RequestStorageChange(context.Context, billingapi.RequestStorageChangeRequestObject) (billingapi.RequestStorageChangeResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

func (unimplementedBilling) GetStorageBreakdown(context.Context, billingapi.GetStorageBreakdownRequestObject) (billingapi.GetStorageBreakdownResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
