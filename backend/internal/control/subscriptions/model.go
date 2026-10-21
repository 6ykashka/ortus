package subscriptions

import (
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Statuses of the contract (Subscription.status).
const (
	StatusTrialing  = "trialing"
	StatusActive    = "active"
	StatusPastDue   = "past_due"
	StatusGrace     = "grace"
	StatusReadOnly  = "read_only"
	StatusCancelled = "cancelled"
)

// Lifecycle parameters (02-architecture §11: hypotheses, configurable).
const (
	TrialDays = 14
	GraceDays = 7
	// DefaultPlan is the plan of a tenant whose creation request names none.
	DefaultPlan = "start"
	// DefaultQuotaBytes is the storage quota of a new tenant (MSW W0.13: 100 GiB).
	DefaultQuotaBytes = int64(100) << 30
	// PriceBook is the version of the price book in sourceRef of plan entitlements (price-book:v2:<plan>).
	PriceBook = 2
)

// Entitlement keys written by the subscription.
const (
	KeySeats        = "seats"
	KeyStorageQuota = "storage_quota_bytes"
)

// Entitlement sources (Entitlement.sourceType).
const (
	SourcePlan   = "plan"
	SourceTrial  = "trial"
	SourceManual = "manual"
)

// Platform audit actions of the subscription (type subscription, target_id — the tenant).
const (
	ActionUpdated     = "subscription.updated"
	ActionTrialEnded  = "subscription.trial_ended"
	ActionPeriodEnded = "subscription.period_ended"
	ActionGraceEnded  = "subscription.grace_ended"
)

const oneDay = 24 * time.Hour

// Entitlement is one entitlement of the contract.
type Entitlement struct {
	Key, SourceType, SourceRef string
	Value                      int64
	ValidUntil                 *time.Time
}

// Subscription is the subscription of a tenant in terms of the contract.
type Subscription struct {
	TenantID                               uuid.UUID
	PlanKey, Status                        string
	TrialEndsAt, PeriodEndsAt, GraceEndsAt *time.Time
	CancelAtPeriodEnd                      bool
	Entitlements                           []Entitlement
	Revision                               int64
	Stored                                 bool // false: derived from the tenant (no row yet)
	// W4.60: the commercial terms of the paid period (subscriptions.term_months, price_version, amount_minor; control
	// 0002); nil — none stored (a trial, a subscription of stage 1).
	TermMonths, PriceVersion *int
	AmountMinor              *int64
}

// Tenant is what the subscription needs of tenants.
type Tenant struct {
	ID             uuid.UUID
	State          string // tenant_state
	StateChangedAt time.Time
	PlanKey        string // planKey of the tenant.create request ("" — none)
}

// Update is the change of an operator (updatePlatformSubscription).
type Update struct {
	PlanKey, Status                        string
	TrialEndsAt, PeriodEndsAt, GraceEndsAt *time.Time
	CancelAtPeriodEnd                      bool
	Manual                                 []Entitlement
	Reason                                 string
}

// Errors of the store.
var (
	ErrUnknownTenant = errors.New("subscriptions: unknown tenant")
	ErrRevision      = errors.New("subscriptions: revision mismatch")
)

// ValidationError lists what is wrong in an Update (validation_failed).
type ValidationError struct{ Fields []string }

func (e *ValidationError) Error() string {
	return "subscriptions: invalid " + strings.Join(e.Fields, ", ")
}

// Tenant states of the lifecycle (tenant_state, PLAT-02) and the stored states of subscriptions (trial, active,
// grace share the names).
const (
	stateTrial    = "trial"
	stateActive   = "active"
	stateGrace    = "grace"
	stateReadOnly = "read_only"
)

// TenantStateFor is the tenants.state a subscription status leads to (W1.11: resuming a tenant returns it).
func TenantStateFor(status string) string {
	switch status {
	case StatusTrialing:
		return stateTrial
	case StatusActive:
		return stateActive
	case StatusGrace, StatusPastDue:
		return stateGrace
	case StatusReadOnly, StatusCancelled:
		return stateReadOnly
	}
	return ""
}

// tiers are the seats of the plans of price book 2 (MSW W0.13 TIERS); a plan outside it has no seat limit.
var tiers = map[string]int64{"start": 10, "team": 25, "biz": 50, "net": 100}

// unlimitedSeats is the seat value of a plan without a limit (MSW: «Безлимит» and unknown plans).
const unlimitedSeats = 1_000_000

// PlanEntitlements are the entitlements of a plan: seats of its tier and the storage quota.
func PlanEntitlements(plan, source string, quota int64) []Entitlement {
	seats, ok := tiers[plan]
	if !ok {
		seats = unlimitedSeats
	}
	ref := "price-book:v" + strconv.Itoa(PriceBook) + ":" + plan
	return []Entitlement{
		{Key: KeySeats, SourceType: source, SourceRef: ref, Value: seats},
		{Key: KeyStorageQuota, SourceType: source, SourceRef: ref, Value: quota},
	}
}

// Derive is the subscription of a tenant without a row: a trial of TrialDays from the moment the tenant entered
// trial, a grace of GraceDays from the moment it entered grace, otherwise the status of its state.
func Derive(t Tenant) Subscription {
	plan := t.PlanKey
	if plan == "" {
		plan = DefaultPlan
	}
	sub := Subscription{TenantID: t.ID, PlanKey: plan, Revision: 1}
	source := SourcePlan
	switch t.State {
	case stateTrial:
		sub.Status, source = StatusTrialing, SourceTrial
		sub.TrialEndsAt = new(t.StateChangedAt.Add(TrialDays * oneDay))
	case stateGrace:
		sub.Status = StatusGrace
		sub.GraceEndsAt = new(t.StateChangedAt.Add(GraceDays * oneDay))
	case stateReadOnly:
		sub.Status = StatusReadOnly
	default:
		sub.Status = StatusActive
	}
	sub.Entitlements = PlanEntitlements(plan, source, DefaultQuotaBytes)
	return sub
}

// Transition is one step of the lifecycle.
type Transition struct {
	From, To string
	Action   string // platform_audit action
	At       time.Time
}

// Next returns the subscription after the next lifecycle step due at now (false: nothing is due): the end of a
// trial or of a paid period starts grace for GraceDays; the end of grace leaves read_only (PLAT-05).
func Next(s Subscription, now time.Time) (Subscription, Transition, bool) {
	ended := func(t *time.Time) bool { return t != nil && !now.Before(*t) }
	n := s
	n.TrialEndsAt, n.PeriodEndsAt, n.GraceEndsAt = nil, nil, nil
	switch {
	case s.Status == StatusTrialing && ended(s.TrialEndsAt):
		n.Status, n.GraceEndsAt = StatusGrace, new(s.TrialEndsAt.Add(GraceDays*oneDay))
		return n, Transition{From: s.Status, To: StatusGrace, Action: ActionTrialEnded, At: *s.TrialEndsAt}, true
	case s.Status == StatusActive && ended(s.PeriodEndsAt):
		n.Status, n.GraceEndsAt = StatusGrace, new(s.PeriodEndsAt.Add(GraceDays*oneDay))
		return n, Transition{From: s.Status, To: StatusGrace, Action: ActionPeriodEnded, At: *s.PeriodEndsAt}, true
	case s.Status == StatusGrace && ended(s.GraceEndsAt):
		n.Status = StatusReadOnly
		return n, Transition{From: s.Status, To: StatusReadOnly, Action: ActionGraceEnded, At: *s.GraceEndsAt}, true
	}
	return s, Transition{}, false
}

var planShape = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,63}$`) // as TenantCreate.planKey (W1.02)

// pilotStatuses are the statuses an operator sets in the pilot (D-33: no payments, so no past_due or cancelled).
var pilotStatuses = map[string]bool{StatusTrialing: true, StatusActive: true, StatusGrace: true, StatusReadOnly: true}

// Validate checks an update of an operator against the contract and the pilot (D-33); cur is the subscription
// it changes.
func Validate(u Update, cur Subscription) error {
	var bad []string
	if n := utf8.RuneCountInString(strings.TrimSpace(u.Reason)); n < 5 || n > 500 {
		bad = append(bad, "reason")
	}
	if !pilotStatuses[u.Status] {
		bad = append(bad, "status")
	}
	if u.CancelAtPeriodEnd {
		bad = append(bad, "cancelAtPeriodEnd")
	}
	if !planShape.MatchString(u.PlanKey) {
		bad = append(bad, "planKey")
	}
	if u.Status == StatusTrialing && u.TrialEndsAt == nil && (cur.Status != StatusTrialing || cur.TrialEndsAt == nil) {
		bad = append(bad, "trialEndsAt")
	}
	if slices.ContainsFunc(u.Manual, badManual) {
		bad = append(bad, "manualEntitlements")
	}
	if len(bad) > 0 {
		return &ValidationError{Fields: bad}
	}
	return nil
}

// badManual: a manual entitlement needs its source, an expiry, a key, a ticket or reason and a value ≥ 0.
func badManual(e Entitlement) bool {
	return e.SourceType != SourceManual || e.ValidUntil == nil || e.Key == "" || strings.TrimSpace(e.SourceRef) == "" ||
		e.Value < 0
}
