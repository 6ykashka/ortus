package idem

import (
	"context"
	"fmt"
	"net/http"
)

const completeSQL = `
update core.idempotency_keys
   set state = 'completed', response_status = $5, response_body = $6, expires_at = $7
 where actor_id = $1 and operation = $2 and key = $3 and request_hash = $4 and state = 'in_progress'`

// CompleteInTx stores the outcome of the command in tx, the transaction of its effect in the tenant DB (10 §3.5).
// If the record is no longer in progress (the lease was taken over), it returns ErrLeaseLost and the caller must
// roll the effect back. Outside Guard it returns ErrNoRecord.
func CompleteInTx(ctx context.Context, tx DB, status int, header http.Header, body []byte) error {
	b, ok := ctx.Value(ctxKey{}).(bound)
	if !ok {
		return ErrNoRecord
	}
	doc, err := encodeOutcome(Outcome{Status: status, Header: header, Body: body})
	if err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, completeSQL, b.rec.ActorID, b.rec.Operation, b.rec.Key, b.rec.Hash, status, doc, b.expires)
	if err != nil {
		return fmt.Errorf("idem: complete in tx: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}
