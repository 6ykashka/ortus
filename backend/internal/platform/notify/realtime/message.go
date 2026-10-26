package realtime

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// The channel of the contract (createRealtimeTicket, x-realtime) and the PostgreSQL channel between cmd/worker and
// cmd/api.
const (
	Path     = "/api/v1/realtime"
	Protocol = "ortus.realtime.v1"
	Channel  = "ortus_realtime"
)

// Types of RealtimeServerMessage.
const (
	TypeContextChanged       = "context.changed"
	TypeNotificationsChanged = "notifications.changed"
	TypeSessionEnded         = "session.ended"
	TypePing                 = "ping"
	// TypeChatChanged is the chat hint of W7.00 (ADR-0015, ADR-0016): chatId and lastSeq, no text, names or files;
	// the addressees are the members of the chat (W7.12 checks them when the hint is queued and when it is delivered).
	TypeChatChanged = "chat.changed"
)

// Types of RealtimeClientMessage.
const (
	TypeAuth = "auth"
	TypePong = "pong"
)

// Reasons of session.ended.
const (
	ReasonLogout          = "logout"
	ReasonExpired         = "expired"
	ReasonRevoked         = "revoked"
	ReasonMembershipEnded = "membership_ended"
)

// CloseUnauthorized closes a socket without a valid auth frame within the auth timeout (ADR-0015).
const CloseUnauthorized websocket.StatusCode = 4401

// ErrInvalidHint is returned for a hint the gateway cannot deliver.
var ErrInvalidHint = errors.New("realtime: invalid hint")

// ServerTypes lists the types of RealtimeServerMessage.
func ServerTypes() []string {
	return []string{TypeContextChanged, TypeNotificationsChanged, TypeSessionEnded, TypePing, TypeChatChanged}
}

// ClientTypes lists the types of RealtimeClientMessage.
func ClientTypes() []string { return []string{TypeAuth, TypePong} }

// Reasons lists the reasons of session.ended.
func Reasons() []string {
	return []string{ReasonLogout, ReasonExpired, ReasonRevoked, ReasonMembershipEnded}
}

// ServerMessage is a frame of the gateway (RealtimeServerMessage): a hint without business data.
type ServerMessage struct {
	Type              string     `json:"type"`
	TenantID          *uuid.UUID `json:"tenantId,omitempty"`
	PermissionVersion string     `json:"permissionVersion,omitempty"`
	ChatID            *uuid.UUID `json:"chatId,omitempty"`
	LastSeq           int64      `json:"lastSeq,omitempty"`
	Reason            string     `json:"reason,omitempty"`
	Seq               int64      `json:"seq"`
	At                time.Time  `json:"at"`
}

// ClientMessage is a frame of the browser (RealtimeClientMessage).
type ClientMessage struct {
	Type   string `json:"type"`
	Ticket string `json:"ticket,omitempty"`
}

// Hint is what a producer asks the gateways to say: Type to every connection of Accounts and to every connection
// whose session key (SessionKey) is in Sessions. It carries identifiers only.
type Hint struct {
	Type     string      `json:"type"`
	TenantID uuid.UUID   `json:"tenantId,omitzero"`
	Accounts []uuid.UUID `json:"accounts,omitempty"`
	Sessions []string    `json:"sessions,omitempty"`
	Reason   string      `json:"reason,omitempty"`
}

// Validate reports whether h can be delivered: a hint type (not ping), a known reason only for session.ended and at
// least one addressee.
func (h Hint) Validate() error {
	switch h.Type {
	case TypeContextChanged, TypeNotificationsChanged:
		if h.Reason != "" {
			return fmt.Errorf("%w: reason %q on %s", ErrInvalidHint, h.Reason, h.Type)
		}
	case TypeSessionEnded:
		if !slices.Contains(Reasons(), h.Reason) {
			return fmt.Errorf("%w: session.ended reason %q", ErrInvalidHint, h.Reason)
		}
	default:
		return fmt.Errorf("%w: type %q", ErrInvalidHint, h.Type)
	}
	if len(h.Accounts) == 0 && len(h.Sessions) == 0 {
		return fmt.Errorf("%w: no addressee", ErrInvalidHint)
	}
	if slices.Contains(h.Accounts, uuid.Nil) || slices.Contains(h.Sessions, "") {
		return fmt.Errorf("%w: empty addressee", ErrInvalidHint)
	}
	return nil
}

// SessionKey is the public key of a BFF session: hints and logs name sessions by it, never by the cookie value.
func SessionKey(sessionID string) string {
	sum := sha256.Sum256([]byte("ortus.realtime.session:" + sessionID))
	return hex.EncodeToString(sum[:16])
}
