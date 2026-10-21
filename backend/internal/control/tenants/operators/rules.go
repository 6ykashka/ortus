// Package operators implements the commands of a platform operator over a tenant by the contract 0.4.0-stage1
// (W1.48, replacing the branch of W1.11; S1-04, PLAT-02, PLAT-05, S1-23): suspendPlatformTenant,
// resumePlatformTenant, extendPlatformTrial, the rename of updatePlatformTenant and the platform audit log
// listPlatformAuditEvents. Every command runs in one transaction of the control DB under a lock of the tenant row,
// checks the role of the operator, If-Match and the transition, and writes its platform_audit row in the same
// transaction; a refusal by role is recorded as denied.
package operators

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

// Audit actions of the commands (api/openapi/paths/platform.yaml, MSW W0.13 operator.ts).
const (
	ActionSuspended     = "tenant.suspended"
	ActionResumed       = "tenant.resumed"
	ActionRenamed       = "tenant.renamed"
	ActionTrialExtended = "subscription.trial_extended"
)

// Target types of platform_audit (PlatformAuditTarget.type).
const (
	TargetTenant       = "tenant"
	TargetSubscription = "subscription"
	TargetAccount      = "account"
	TargetOperator     = "operator"
	TargetPriceBook    = "price_book"
)

// Permissions of the platform (api/permissions.yaml, section platform).
const (
	PermTenantsRead     = "platform.tenants.read"
	PermTenantsCreate   = "platform.tenants.create"
	PermTenantsManage   = "platform.tenants.manage"
	PermUsersRead       = "platform.users.read"
	PermUsersManage     = "platform.users.manage"
	PermBillingRead     = "platform.billing.read"
	PermBillingManage   = "platform.billing.manage"
	PermPricingManage   = "platform.pricing.manage"
	PermOperatorsManage = "platform.operators.manage"
)

// Operator roles (platform_operators.role).
const (
	RoleOwner   = "owner"
	RoleAdmin   = "admin"
	RoleBilling = "billing"
	RoleSupport = "support"
)

// Tenant states (tenant_state, PLAT-02).
const (
	StateProvisioning = "provisioning"
	StateTrial        = "trial"
	StateActive       = "active"
	StateGrace        = "grace"
	StateReadOnly     = "read_only"
	StateSuspended    = "suspended"
	StateClosing      = "closing"
	StateClosed       = "closed"
)

// Errors of the commands.
var (
	ErrNotOperator       = errors.New("operators: not an active platform operator")
	ErrForbidden         = errors.New("operators: the role of the operator does not allow the command")
	ErrRevisionRequired  = errors.New("operators: If-Match is required")
	ErrRevisionMismatch  = errors.New("operators: If-Match is not the current revision")
	ErrInvalidTransition = errors.New("operators: transition is not allowed")
	ErrBadCursor         = errors.New("operators: malformed cursor")
)

// ValidationError lists the fields of a command that fail the contract.
type ValidationError struct{ Fields []string }

func (e *ValidationError) Error() string {
	return "operators: invalid fields: " + strings.Join(e.Fields, ", ")
}

func invalid(fields []string) error {
	if len(fields) == 0 {
		return nil
	}
	return &ValidationError{Fields: fields}
}

// Bounds of the contract: Tenant.name 1–150, reason 5–500 (after trim, in characters), TrialExtension.days 1–30.
const (
	nameMax   = 150
	reasonMin = 5
	reasonMax = 500
	daysMin   = 1
	daysMax   = 30
)

func runes(s string) int { return utf8.RuneCountInString(strings.TrimSpace(s)) }

func validReason(s string) bool { n := runes(s); return n >= reasonMin && n <= reasonMax }

// identity lists the missing ids of a command: the tenant of the path and the operator of the session.
func identity(tenant, actor uuid.UUID) []string {
	var bad []string
	if tenant == uuid.Nil {
		bad = append(bad, "tenantId")
	}
	if actor == uuid.Nil {
		bad = append(bad, "actor")
	}
	return bad
}

// StatusChange is suspendPlatformTenant or resumePlatformTenant (TenantStatusChange).
type StatusChange struct {
	TenantID, ActorID uuid.UUID // ActorID: the account of the operator (session)
	IfMatch           string    // ETag of the tenant
	Reason            string
	RequestID         string
}

// Validate checks the command: the reason is mandatory (Q-W1.00-1).
func (c StatusChange) Validate() error {
	bad := identity(c.TenantID, c.ActorID)
	if !validReason(c.Reason) {
		bad = append(bad, "reason")
	}
	return invalid(bad)
}

// Rename is updatePlatformTenant: since 0.4.0-stage1 only the name changes there.
type Rename struct {
	TenantID, ActorID uuid.UUID
	IfMatch           string
	Name              string
	Reason            *string // optional; checked when given
	RequestID         string
}

// Validate checks the rename: a name of 1–150 characters; a reason, when given, of 5–500.
func (c Rename) Validate() error {
	bad := identity(c.TenantID, c.ActorID)
	if n := runes(c.Name); n < 1 || n > nameMax {
		bad = append(bad, "name")
	}
	if c.Reason != nil && !validReason(*c.Reason) {
		bad = append(bad, "reason")
	}
	return invalid(bad)
}

// TrialExtension is extendPlatformTrial.
type TrialExtension struct {
	TenantID, ActorID uuid.UUID
	IfMatch           string // ETag of the subscription
	Days              int
	Reason            string
	RequestID         string
}

// Validate checks the extension: 1–30 days and a reason.
func (c TrialExtension) Validate() error {
	bad := identity(c.TenantID, c.ActorID)
	if c.Days < daysMin || c.Days > daysMax {
		bad = append(bad, "days")
	}
	if !validReason(c.Reason) {
		bad = append(bad, "reason")
	}
	return invalid(bad)
}

// grants: design/docs/17-users-and-billing.md «Права» and «Роли», the description of PlatformOperator.role of the
// contract 0.8.0-stage4 and PLATFORM_GRANTS of MSW (Q-W4.07-14; TestGrantsMatchMSW). Every operator sees tenants
// and accounts; the platform owner and the administrator create and manage tenants and the price book; support
// locks sign-in and resets the second factor; billing reads and decides tier requests and subscriptions; only the
// owner manages operators.
var grants = map[string][]string{
	PermTenantsRead:     {RoleOwner, RoleAdmin, RoleBilling, RoleSupport},
	PermUsersRead:       {RoleOwner, RoleAdmin, RoleBilling, RoleSupport},
	PermTenantsCreate:   {RoleOwner, RoleAdmin},
	PermTenantsManage:   {RoleOwner, RoleAdmin},
	PermPricingManage:   {RoleOwner, RoleAdmin},
	PermUsersManage:     {RoleOwner, RoleAdmin, RoleSupport},
	PermBillingRead:     {RoleOwner, RoleAdmin, RoleBilling},
	PermBillingManage:   {RoleOwner, RoleAdmin, RoleBilling},
	PermOperatorsManage: {RoleOwner},
}

// Allowed reports whether an operator role grants permission.
func Allowed(role, permission string) bool { return slices.Contains(grants[permission], role) }

// AllowedAll reports whether an operator role grants the x-permissions of an operation (W4.60, the gateway of
// /platform/**): every permission for x-permissions-mode all (the default), at least one for any. An operation
// without permissions is closed (fail-closed).
func AllowedAll(role string, permissions []string, mode string) bool {
	if len(permissions) == 0 {
		return false
	}
	allowed := func(p string) bool { return Allowed(role, p) }
	if mode == "any" {
		return slices.ContainsFunc(permissions, allowed)
	}
	return !slices.ContainsFunc(permissions, func(p string) bool { return !allowed(p) })
}

// targetPermission is the right a journal row of each target type needs (listPlatformAuditEvents).
var targetPermission = map[string]string{
	TargetTenant: PermTenantsRead, TargetSubscription: PermTenantsRead, TargetAccount: PermUsersRead,
	TargetOperator: PermOperatorsManage, TargetPriceBook: PermPricingManage,
}

// VisibleTargets are the target types whose journal rows role may see, sorted.
func VisibleTargets(role string) []string {
	out := []string{}
	for target, perm := range targetPermission {
		if Allowed(role, perm) {
			out = append(out, target)
		}
	}
	slices.Sort(out)
	return out
}

var etagRE = regexp.MustCompile(`^"(?:rev-)?([1-9][0-9]{0,17})"$`)

// ParseETag returns the revision of a strong ETag: "<revision>" of a tenant (getPlatformTenant, W1.02) or
// "rev-<revision>" of a subscription (W1.08); both forms are accepted for both (Q-W1.08-9). An empty one is
// ErrRevisionRequired; anything else is ErrRevisionMismatch (it is never the current revision).
func ParseETag(s string) (int64, error) {
	if strings.TrimSpace(s) == "" {
		return 0, ErrRevisionRequired
	}
	m := etagRE.FindStringSubmatch(s)
	if m == nil {
		return 0, ErrRevisionMismatch
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return 0, ErrRevisionMismatch
	}
	return n, nil
}

// TenantETag is the ETag of a tenant revision, as getPlatformTenant sends it.
func TenantETag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

// SubscriptionETag is the ETag of a subscription revision, as getPlatformSubscription sends it.
func SubscriptionETag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// suspendable are the states a tenant may be suspended from (PLAT-02): the working lifecycle.
var suspendable = []string{StateTrial, StateActive, StateGrace, StateReadOnly}

// SuspendTo is the state after suspendPlatformTenant: suspended from trial, active, grace or read_only; any other
// state (already suspended, provisioning, closing, closed) is ErrInvalidTransition.
func SuspendTo(from string) (string, error) {
	if !slices.Contains(suspendable, from) {
		return from, ErrInvalidTransition
	}
	return StateSuspended, nil
}

// ResumeTo is the state after resumePlatformTenant: only a suspended tenant resumes, into the state of its
// subscription status (Q-W1.00-3: trialing → trial, past_due → grace…); an unknown status resumes active.
func ResumeTo(from, subscriptionStatus string) (string, error) {
	if from != StateSuspended {
		return from, ErrInvalidTransition
	}
	if to := subscriptions.TenantStateFor(subscriptionStatus); to != "" {
		return to, nil
	}
	return StateActive, nil
}

// CanExtendTrial checks extendPlatformTrial (Q-W1.00-6): the tenant is in its lifecycle (or suspended), and the
// subscription is trialing, or grace / read_only after an unpaid trial — its plan entitlements come from the trial.
// A paid subscription (active, past_due, cancelled, or grace / read_only after a paid period) is
// ErrInvalidTransition.
func CanExtendTrial(tenantState string, sub subscriptions.Subscription) error {
	if !slices.Contains(suspendable, tenantState) && tenantState != StateSuspended {
		return ErrInvalidTransition
	}
	switch sub.Status {
	case subscriptions.StatusTrialing:
		return nil
	case subscriptions.StatusGrace, subscriptions.StatusReadOnly:
		if afterTrial(sub.Entitlements) {
			return nil
		}
	}
	return ErrInvalidTransition
}

// afterTrial reports whether the plan entitlements (all but manual) exist and all come from the trial.
func afterTrial(es []subscriptions.Entitlement) bool {
	plan := 0
	for _, e := range es {
		switch e.SourceType {
		case subscriptions.SourceManual:
		case subscriptions.SourceTrial:
			plan++
		default:
			return false
		}
	}
	return plan > 0
}

// NextTrialEnd is the new trialEndsAt: days after the later of the current trialEndsAt and now (MSW W0.13). Only a
// trialing subscription has a current end to extend; after the trial (grace, read_only) the new trial starts now.
func NextTrialEnd(sub subscriptions.Subscription, now time.Time, days int) time.Time {
	base := now
	if sub.Status == subscriptions.StatusTrialing && sub.TrialEndsAt != nil && sub.TrialEndsAt.After(now) {
		base = *sub.TrialEndsAt
	}
	return base.AddDate(0, 0, days)
}

// publicKeys are the details a journal row may show (PlatformAuditEvent.details: scalar parameters of the action;
// never business content of a tenant, e-mails, request hashes or error texts). W4.60 (step 4.6): the number of a
// tier request, its tier and term, the version of the price book and its start, the roles of an operator.
var publicKeys = []string{
	"days", "trialEndsAt", "periodEndsAt", "graceEndsAt", "quotaBytes", "fromStatus", "toStatus", "planKey", "at", "permission",
	"request", "tier", "termMonths", "version", "effectiveFrom", "role", "from", "to",
}

// PublicDetails returns the public scalar details of a platform_audit.details document (nil when there are none).
func PublicDetails(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var doc map[string]any
	if err := dec.Decode(&doc); err != nil {
		return nil
	}
	out := map[string]string{}
	for _, k := range publicKeys {
		switch v := doc[k].(type) {
		case string:
			if v != "" {
				out[k] = v
			}
		case json.Number:
			out[k] = v.String()
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// maxCursor bounds a cursor (PlatformAuditPage.nextCursor).
const maxCursor = 2048

// cursorJSON is the position after the last row of a page and what it is bound to: the operator and the filter.
type cursorJSON struct {
	ID     int64     `json:"i"`
	Actor  uuid.UUID `json:"o"`
	Tenant string    `json:"t,omitempty"`
}

func filterKey(tenant *uuid.UUID) string {
	if tenant == nil {
		return ""
	}
	return tenant.String()
}

// EncodeCursor returns the opaque cursor after row id for the operator actor and the tenant filter.
func EncodeCursor(id int64, actor uuid.UUID, tenant *uuid.UUID) string {
	b, _ := json.Marshal(cursorJSON{ID: id, Actor: actor, Tenant: filterKey(tenant)}) // ints and strings always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor returns the row id of a cursor of EncodeCursor issued to the same operator with the same filter;
// anything else is ErrBadCursor.
func DecodeCursor(s string, actor uuid.UUID, tenant *uuid.UUID) (int64, error) {
	if s == "" || len(s) > maxCursor {
		return 0, ErrBadCursor
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return 0, ErrBadCursor
	}
	var c cursorJSON
	if err := json.Unmarshal(b, &c); err != nil || c.ID < 1 || c.Actor != actor || c.Tenant != filterKey(tenant) {
		return 0, ErrBadCursor
	}
	return c.ID, nil
}
