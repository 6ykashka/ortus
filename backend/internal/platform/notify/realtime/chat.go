package realtime

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
)

// ChatAudience gives the current members of a chat: the accounts of the tenant that may read it (W7.11 owns the
// storage; cmd/api and cmd/worker plug in a reader of it). The hint names members, never the gateway.
type ChatAudience interface {
	Members(ctx context.Context, tenant, chat uuid.UUID) ([]uuid.UUID, error)
}

// HintSender publishes a hint to the gateways (Notifier).
type HintSender interface {
	Publish(ctx context.Context, h Hint) error
}

// ChatPublisher queues chat.changed for the members of a chat (the first check of the audience).
type ChatPublisher struct {
	Audience ChatAudience
	Sender   HintSender
}

// Publish queues chat.changed {chatId, lastSeq} for the members of chat of tenant. A chat without members has
// nobody to tell; an audience that fails queues nothing.
func (p ChatPublisher) Publish(ctx context.Context, tenant, chat uuid.UUID, lastSeq int64) error {
	h := Hint{Type: TypeChatChanged, TenantID: tenant, ChatID: chat, LastSeq: lastSeq}
	if tenant == uuid.Nil || chat == uuid.Nil || lastSeq <= 0 {
		return fmt.Errorf("%w: chat.changed needs tenant, chatId and lastSeq", ErrInvalidHint)
	}
	members, err := p.Audience.Members(ctx, tenant, chat)
	if err != nil {
		return fmt.Errorf("realtime: chat members: %w", err)
	}
	if len(members) == 0 {
		return nil
	}
	h.Accounts = members
	return p.Sender.Publish(ctx, h)
}

// ChatFanout wraps the sink of a Listener (the second check of the audience): chat.changed goes on only to the
// accounts that are members of the chat now, so a person who left between the queueing and the delivery gets
// nothing. If the audience cannot be read the hint is dropped (closed): clients re-read on the next hint or Resync.
// Other hints pass unchanged. A nil log is slog.Default.
func ChatFanout(next func(Hint), audience ChatAudience, log *slog.Logger) func(Hint) {
	if log == nil {
		log = slog.Default()
	}
	return func(h Hint) {
		if h.Type != TypeChatChanged {
			next(h)
			return
		}
		if h.TenantID == uuid.Nil || h.Validate() != nil {
			return
		}
		members, err := audience.Members(context.Background(), h.TenantID, h.ChatID)
		if err != nil {
			log.Error("realtime: chat members for chat.changed, hint dropped", "err", err)
			return
		}
		current := make(map[uuid.UUID]struct{}, len(members))
		for _, m := range members {
			current[m] = struct{}{}
		}
		kept := make([]uuid.UUID, 0, len(h.Accounts))
		for _, a := range h.Accounts {
			if _, ok := current[a]; ok {
				kept = append(kept, a)
			}
		}
		if len(kept) == 0 {
			return
		}
		h.Accounts = kept
		next(h)
	}
}
