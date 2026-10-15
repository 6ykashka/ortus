package inbox

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrBadCursor marks a cursor that is malformed or was issued for another selection (another tenant, person,
// filter or policy version).
var ErrBadCursor = errors.New("inbox: bad cursor")

// maxCursor is maxLength of the Cursor parameter of the contract.
const maxCursor = 2048

// cursor is the keyset position of a page (created_at desc, id desc) and the fingerprint of its selection
// (NotificationPage: «bound to tenant, principal, effective scopes, filters and sort»).
type cursor struct {
	At      time.Time `json:"t"`
	ID      uuid.UUID `json:"i"`
	Binding string    `json:"b"`
}

// encode returns the opaque form of c: base64url of its JSON.
func (c cursor) encode() string {
	b, _ := json.Marshal(c) // a struct of time, uuid and string always marshals
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(s string) (cursor, error) {
	if s == "" || len(s) > maxCursor {
		return cursor{}, ErrBadCursor
	}
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return cursor{}, fmt.Errorf("%w: %w", ErrBadCursor, err)
	}
	var c cursor
	if err := json.Unmarshal(b, &c); err != nil {
		return cursor{}, fmt.Errorf("%w: %w", ErrBadCursor, err)
	}
	if c.At.IsZero() || c.ID == uuid.Nil || c.Binding == "" {
		return cursor{}, ErrBadCursor
	}
	return c, nil
}

// binding is the fingerprint of a selection: tenant, person, filter and the policy version of the tenant
// (access.policy_state: +1 on any change of roles, assignments or modules), so a permission change invalidates the
// cursor. The sort is fixed (newest first).
func binding(tenantID, personID uuid.UUID, unreadOnly bool, policyVersion int64) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%s|%s|%t|%d", tenantID, personID, unreadOnly, policyVersion))
	return hex.EncodeToString(sum[:12])
}
