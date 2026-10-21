package billinghttp

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
)

// The views below are the shared schemas of the contract (common/schemas.yaml: PriceBookVersion,
// SubscriptionChangeRequest, SeatUsage…) with the JSON of the contract. The generated packages of the tags Billing and
// Platform each have their own copy of these types; a view is built once from the billing domain and recast into the
// type of the tag (recast: the same JSON), so the two tags cannot drift apart.

type moneyView struct {
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
}

func money(minor int64) moneyView { return moneyView{AmountMinor: minor, Currency: billing.Currency} }

type accountRefView struct {
	AccountID   *uuid.UUID `json:"accountId,omitempty"`
	DisplayName string     `json:"displayName"`
}

func accountRef(a *billing.AccountRef) *accountRefView {
	if a == nil {
		return nil
	}
	return &accountRefView{AccountID: a.AccountID, DisplayName: a.DisplayName}
}

type tierView struct {
	Code             string `json:"code"`
	Name             string `json:"name"`
	SeatsLimit       *int   `json:"seatsLimit"`
	MonthAmountMinor *int64 `json:"monthAmountMinor"`
}

type termView struct {
	Months          int `json:"months"`
	DiscountPercent int `json:"discountPercent"`
}

type versionView struct {
	Version           int             `json:"version"`
	State             string          `json:"state"`
	EffectiveFrom     time.Time       `json:"effectiveFrom"`
	EffectiveUntil    *time.Time      `json:"effectiveUntil,omitempty"`
	Note              string          `json:"note"`
	Currency          string          `json:"currency"`
	Tiers             []tierView      `json:"tiers"`
	Terms             []termView      `json:"terms"`
	PublishedAt       *time.Time      `json:"publishedAt,omitempty"`
	PublishedBy       *accountRefView `json:"publishedBy,omitempty"`
	CancelledAt       *time.Time      `json:"cancelledAt,omitempty"`
	SubscriptionCount *int            `json:"subscriptionCount,omitempty"`
}

// ownerVersion is a version for the owner's calculation: without authors, the publication and cancellation moments
// and the subscription count (TenantPriceBook).
func ownerVersion(v billing.Version, now time.Time) versionView {
	out := versionView{
		Version: v.Number, State: v.State(now), EffectiveFrom: v.EffectiveFrom, EffectiveUntil: v.EffectiveUntil, Note: v.Note,
		Currency: v.Currency, Tiers: make([]tierView, 0, len(v.Tiers)), Terms: make([]termView, 0, len(v.Terms)),
	}
	for _, t := range v.Tiers {
		out.Tiers = append(out.Tiers, tierView{Code: t.Code, Name: t.Name, SeatsLimit: t.SeatsLimit, MonthAmountMinor: t.MonthMinor})
	}
	for _, t := range v.Terms {
		out.Terms = append(out.Terms, termView(t))
	}
	return out
}

// operatorVersion is a version of the Тарифная сетка screen: with its author, publication, cancellation and
// subscription count.
func operatorVersion(v billing.Version, now time.Time) versionView {
	out := ownerVersion(v, now)
	out.PublishedAt, out.PublishedBy, out.CancelledAt = v.PublishedAt, accountRef(v.PublishedBy), v.CancelledAt
	out.SubscriptionCount = new(v.SubscriptionCount)
	return out
}

type tenantPriceBookView struct {
	Current    versionView  `json:"current"`
	Scheduled  *versionView `json:"scheduled,omitempty"`
	Subscribed *versionView `json:"subscribed,omitempty"`
}

func tenantPriceBook(pb billing.TenantPriceBook, now time.Time) tenantPriceBookView {
	out := tenantPriceBookView{Current: ownerVersion(pb.Current, now)}
	if pb.Scheduled != nil {
		out.Scheduled = new(ownerVersion(*pb.Scheduled, now))
	}
	if pb.Subscribed != nil {
		out.Subscribed = new(ownerVersion(*pb.Subscribed, now))
	}
	return out
}

type quoteView struct {
	MonthlyAmount   moneyView `json:"monthlyAmount"`
	PeriodAmount    moneyView `json:"periodAmount"`
	SavingAmount    moneyView `json:"savingAmount"`
	DiscountPercent int       `json:"discountPercent"`
}

type requestView struct {
	ID             uuid.UUID       `json:"id"`
	Number         string          `json:"number"`
	TenantID       uuid.UUID       `json:"tenantId"`
	TenantName     string          `json:"tenantName"`
	FromTierCode   *string         `json:"fromTierCode"`
	FromTierName   *string         `json:"fromTierName,omitempty"`
	FromSeatsLimit *int            `json:"fromSeatsLimit,omitempty"`
	ToTierCode     string          `json:"toTierCode"`
	ToTierName     string          `json:"toTierName"`
	ToSeatsLimit   *int            `json:"toSeatsLimit"`
	TermMonths     int             `json:"termMonths"`
	PriceVersion   int             `json:"priceVersion"`
	Quote          *quoteView      `json:"quote,omitempty"`
	SeatsUsed      int             `json:"seatsUsed"`
	Comment        string          `json:"comment,omitempty"`
	Status         string          `json:"status"`
	RequestedAt    time.Time       `json:"requestedAt"`
	RequestedBy    accountRefView  `json:"requestedBy"`
	DecidedAt      *time.Time      `json:"decidedAt,omitempty"`
	DecidedBy      *accountRefView `json:"decidedBy,omitempty"`
	DecisionNote   string          `json:"decisionNote,omitempty"`
	EffectiveAt    *time.Time      `json:"effectiveAt,omitempty"`
	AppliedAt      *time.Time      `json:"appliedAt,omitempty"`
	Revision       int64           `json:"revision"`
}

// operatorRequest is a request with the operator who decided it.
func operatorRequest(r billing.Request) requestView {
	out := requestView{
		ID: r.ID, Number: r.Number, TenantID: r.TenantID, TenantName: r.TenantName, FromTierCode: r.FromTierCode,
		FromTierName: r.FromTierName, FromSeatsLimit: r.FromSeatsLimit, ToTierCode: r.ToTierCode, ToTierName: r.ToTierName,
		ToSeatsLimit: r.ToSeatsLimit, TermMonths: r.TermMonths, PriceVersion: r.PriceVersion, SeatsUsed: r.SeatsUsed,
		Comment: r.Comment, Status: r.Status, RequestedAt: r.RequestedAt, RequestedBy: *accountRef(&r.RequestedBy),
		DecidedAt: r.DecidedAt, DecidedBy: accountRef(r.DecidedBy), DecisionNote: r.DecisionNote, EffectiveAt: r.EffectiveAt,
		AppliedAt: r.AppliedAt, Revision: r.Revision,
	}
	if q := r.Quote; q != nil {
		out.Quote = &quoteView{
			MonthlyAmount: money(q.MonthlyMinor), PeriodAmount: money(q.PeriodMinor), SavingAmount: money(q.SavingMinor),
			DiscountPercent: q.DiscountPercent,
		}
	}
	return out
}

// ownerRequest is a request as its owner sees it: the decision without the operator (decidedBy stays only for a
// cancellation by the owner).
func ownerRequest(r billing.Request) requestView {
	out := operatorRequest(r)
	if r.Status == billing.StatusApproved || r.Status == billing.StatusRejected {
		out.DecidedBy = nil
	}
	return out
}

type requestPageView struct {
	Items        []requestView `json:"items"`
	NextCursor   *string       `json:"nextCursor"`
	PendingCount int           `json:"pendingCount"`
}

func requestPage(p billing.RequestPage, view func(billing.Request) requestView) requestPageView {
	out := requestPageView{Items: make([]requestView, 0, len(p.Items)), PendingCount: p.PendingCount}
	for _, r := range p.Items {
		out.Items = append(out.Items, view(r))
	}
	if p.Next != "" {
		out.NextCursor = &p.Next
	}
	return out
}

type violationView struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type problemView struct {
	Type       string          `json:"type"`
	Title      string          `json:"title"`
	Status     int             `json:"status"`
	Code       string          `json:"code"`
	Detail     string          `json:"detail,omitempty"`
	RequestID  string          `json:"requestId"`
	Violations []violationView `json:"violations,omitempty"`
}

// recast converts a view into the generated type of a tag with the same JSON.
func recast[T any](v any) (T, error) {
	var out T
	raw, err := json.Marshal(v)
	if err != nil {
		return out, fmt.Errorf("billinghttp: %T: %w", v, err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("billinghttp: %T as %T: %w", v, out, err)
	}
	return out, nil
}
