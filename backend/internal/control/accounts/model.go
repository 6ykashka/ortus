// Package accounts is the catalogue of accounts and the operators of the system organization «Ортус · Платформа»
// of the platform operator (W4.60, contract 0.8.0-stage4 of W4.07; 17-users-and-billing «Каталог пользователей у
// оператора», «Организация платформы»): search and filters with counters, the memberships of an account, the lock of
// sign-in with a reason, the reset of the second factor; the operators with their roles, the invitation, the change
// of a role, disabling and enabling under the rules of the owners.
package accounts

import (
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Errors of the service.
var (
	ErrNotFound         = errors.New("accounts: not found")
	ErrForbidden        = errors.New("accounts: the role of the operator does not allow the command")
	ErrRevisionRequired = errors.New("accounts: If-Match is required")
	ErrRevisionMismatch = errors.New("accounts: If-Match is not the current revision")
	ErrBadCursor        = errors.New("accounts: malformed cursor")
)

// Violation is one field error of a 422 (ProblemViolation).
type Violation struct {
	Field, Code, Message string
}

// RefusalError is a refused command with its Problem code (409 or 422), the detail and the field violations.
type RefusalError struct {
	Code, Detail string
	Violations   []Violation
}

func (r *RefusalError) Error() string {
	parts := []string{"accounts: " + r.Code, r.Detail}
	for _, v := range r.Violations {
		parts = append(parts, v.Field+": "+v.Message)
	}
	return strings.Join(parts, "; ")
}

// Statuses of an account of the catalogue (PlatformUser.status).
const (
	UserActive    = "active"
	UserInvited   = "invited"
	UserSuspended = "suspended"
)

// Filters of the catalogue (listPlatformUsers filter).
const (
	FilterMultiTenant   = "multi_tenant"
	FilterNoMFA         = "no_mfa"
	FilterLocked        = "locked"
	FilterNeverSignedIn = "never_signed_in"
)

// Membership is one organization of an account (PlatformUserMembership).
type Membership struct {
	TenantID                         uuid.UUID
	TenantName, TenantStatus, Status string
	Owner                            bool
}

// User is an account of the catalogue (PlatformUser): support metadata only, never roles or data of organizations.
type User struct {
	ID                         uuid.UUID
	DisplayName, Email, Status string
	LastSeenAt                 *time.Time
	TenantCount                int
	MFA                        bool
	LockedAt                   *time.Time
	LockReason                 string
	Memberships                []Membership // nil in the list; the card has every membership
}

// Counts are the counters of the filter chips (PlatformUserCounts).
type Counts struct {
	All, MultiTenant, NoMFA, Locked, NeverSignedIn int
}

// UserQuery is listPlatformUsers.
type UserQuery struct {
	Actor    uuid.UUID
	Q        string
	TenantID *uuid.UUID
	Filter   string
	Cursor   string
	Limit    int
}

// UserPage is a page of the catalogue with the counters of its search and organization.
type UserPage struct {
	Items  []User
	Next   string
	Counts Counts
}

// Operator is an operator of the platform (PlatformOperator).
type Operator struct {
	ID, AccountID                    uuid.UUID
	DisplayName, Email, Role, Status string
	MFA                              string // totp | webauthn; "" — none
	LastSeenAt, DisabledAt           *time.Time
	DisabledReason                   string
	Me                               bool
	Revision                         int64
}

// OperatorPage is the list of operators with the number of active owners.
type OperatorPage struct {
	Items            []Operator
	ActiveOwnerCount int
}

// Lock is lockPlatformUser.
type Lock struct {
	Actor, Account uuid.UUID
	Reason         string
	RequestID      string
}

// AccountCommand is unlockPlatformUser or resetPlatformUserMfa.
type AccountCommand struct {
	Actor, Account uuid.UUID
	RequestID      string
}

// Invite is invitePlatformOperator.
type Invite struct {
	Actor                    uuid.UUID
	DisplayName, Email, Role string
	RequestID                string
}

// OperatorChange is updatePlatformOperator: exactly one of Role and Active.
type OperatorChange struct {
	Actor, ID uuid.UUID
	IfMatch   string
	Role      *string
	Active    *bool
	Reason    *string
	RequestID string
}
