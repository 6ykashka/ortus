// Package invitations is the invitation of a person into a business (W1.03, S1-06 «token → e-mail check →
// membership active»): the one-time token is issued here (Issue, for inviteMember of W1.06 and the owner invitation
// of a new business), described before sign-in (Inspect) and accepted by the signed-in identity (Accept).
//
// Data model. The control DB keeps the invitation (only the SHA-256 of the token, and the ids of its role
// assignments) and, after acceptance, the membership; the tenant DB keeps the person profile of the invitee and the
// role assignments of the invitation in state dormant. Acceptance writes the tenant DB first (idempotent: a repeat
// after a failed control commit redoes it) and then commits the control DB, so a membership never exists without its
// linked profile.
//
// Locks, all in the control transaction and in this order: FOR UPDATE of the business (tenants row: seats and
// memberships of a business; control 0002 and AUTH-08 take it first too), then of the invitation, then of the
// memberships of the account or the profile. Acceptance reads the invitation unlocked only to find its business and
// reads it again — with the state of the business — under the lock of the business. Issue takes the business first
// too. Other code that writes invitations, seats or memberships of a business (W1.06 revoke, resend, createMember,
// ownership transfer) must lock the business first as well. The locks of an acceptance are held while the tenant DB
// transaction runs: a slow tenant DB delays state changes of that one business, not of others.
package invitations

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultTTL is the lifetime of an invitation link.
const DefaultTTL = 7 * 24 * time.Hour

// mask replaces the local part of an e-mail but its first letter (InvitationPreview.invitedEmailMasked).
const mask = "•••••"

// DB is a control DB connection, pool or transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Control is the control DB of the service (*pgxpool.Pool).
type Control interface {
	DB
	Begin(ctx context.Context) (pgx.Tx, error)
}

// TenantDBs opens the tenant DB of a business (tenantctx.Pools: routing, sentinel).
type TenantDBs interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Service inspects and accepts invitations.
type Service struct {
	Control Control
	Tenants TenantDBs
}

// HashToken is the form in which the token is stored (invitations.token_hash).
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// NormalizeEmail is the form of invitations.email_norm and accounts.email_norm.
func NormalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

// MaskEmail keeps the first letter of the local part and the domain: o•••••@alta.example.
func MaskEmail(email string) string {
	local, domain, ok := strings.Cut(NormalizeEmail(email), "@")
	if !ok {
		return mask
	}
	r, _ := utf8.DecodeRuneInString(local)
	if r == utf8.RuneError {
		return mask + "@" + domain
	}
	return string(r) + mask + "@" + domain
}

// Draft is an invitation to issue.
type Draft struct {
	TenantID          uuid.UUID
	PersonProfileID   uuid.UUID // profile in the tenant DB; its dormant assignments become active on acceptance
	Email             string
	Owner             bool        // the acceptance creates an owner binding (owner of a new business)
	CreatedBy         *uuid.UUID  // membership of the inviter; nil only for an owner invitation
	CreatedByOperator *uuid.UUID  // platform operator of an owner invitation, if any
	RoleAssignmentIDs []uuid.UUID // dormant access.role_assignments of the profile that the acceptance activates
	TTL               time.Duration
}

// ErrInvalidDraft: the draft misses its tenant, profile or e-mail, or has no author but is not an owner invitation.
var ErrInvalidDraft = errors.New("invitations: invalid draft")

// ErrProfileBusy: the person profile already has a pending invitation (not accepted, not revoked, not expired) or an
// active or suspended membership in the business. W1.06 maps it to 409; a re-invitation revokes the pending one in
// the same transaction first.
var ErrProfileBusy = errors.New("invitations: the profile has a pending invitation or a live membership")

// Issue stores an invitation in the control DB (inside the caller's transaction) and returns the one-time token
// for the link (sent in the URL fragment) and the invitation id. Only the hash of the token is stored.
//
// One person profile, one way in: Issue takes FOR UPDATE of the business (tenants row, the first lock of the
// business — the caller must not hold locks of its invitations or memberships yet) and refuses a profile that already
// has a pending invitation or a live membership (ErrProfileBusy). An invited membership of the profile (seed
// placeholder) does not block: the acceptance takes it over.
func Issue(ctx context.Context, db DB, d Draft) (token string, id uuid.UUID, err error) {
	email := NormalizeEmail(d.Email)
	if d.TenantID == uuid.Nil || d.PersonProfileID == uuid.Nil || !strings.Contains(email, "@") || (d.CreatedBy == nil && !d.Owner) {
		return "", uuid.Nil, ErrInvalidDraft
	}
	ttl := d.TTL
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	if err := checkProfile(ctx, db, d); err != nil {
		return "", uuid.Nil, err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", uuid.Nil, fmt.Errorf("invitations: random: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	grants := d.RoleAssignmentIDs
	if grants == nil {
		grants = []uuid.UUID{}
	}
	err = db.QueryRow(ctx, `insert into invitations
  (tenant_id, email_norm, token_hash, person_profile_id, created_by, created_by_operator, grants_owner, expires_at,
   role_assignment_ids)
values ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval, $9) returning id`,
		d.TenantID, email, HashToken(token), d.PersonProfileID, d.CreatedBy, d.CreatedByOperator, d.Owner,
		fmt.Sprintf("%d seconds", int64(ttl/time.Second)), grants).Scan(&id)
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("invitations: %w", err)
	}
	return token, id, nil
}

// checkProfile locks the business and refuses a profile with a pending invitation or a live membership in it.
func checkProfile(ctx context.Context, db DB, d Draft) error {
	if _, err := db.Exec(ctx, `select id from tenants where id = $1 for update`, d.TenantID); err != nil {
		return fmt.Errorf("invitations: tenant: %w", err)
	}
	var busy bool
	err := db.QueryRow(ctx, `select exists (select 1 from invitations where tenant_id = $1 and person_profile_id = $2
	   and accepted_at is null and revoked_at is null and expires_at > now())
	or exists (select 1 from memberships where tenant_id = $1 and person_profile_id = $2 and status in ('active', 'suspended'))`,
		d.TenantID, d.PersonProfileID).Scan(&busy)
	switch {
	case err != nil:
		return fmt.Errorf("invitations: profile: %w", err)
	case busy:
		return ErrProfileBusy
	}
	return nil
}
