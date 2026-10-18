package files

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// duplicateSQL counts the earlier files (by created_at, id) of the tenant with the bytes of file $1 (антифрод фото
// W2.43, модель данных 4; tenant 0017 files_sha256_idx): verified by completeUpload and not rejected (scanning,
// ready — the sha256 of reserved and uploaded files is a claim of the client, never checked bytes). Only the count,
// the first moment and «the same parent» leave the query: the earlier files may be outside the scope of the actor.
// The tenant DB of the request is the whole search space — another tenant never counts (AC-02).
const duplicateSQL = `
select count(*), min(e.created_at), coalesce(bool_or(e.owner_type = p.owner_type and e.owner_id = p.owner_id), false)
  from files.objects p
  join files.objects e on e.sha256 = p.sha256 and e.state <> 'rejected' and e.state in ('scanning', 'ready')
                      and (e.created_at, e.id) < (p.created_at, p.id)
 where p.id = $1`

// duplicateOf returns the warning of the earlier files with the bytes of file id; nil when there are none. It never
// blocks the upload: the manager sees it (FileDuplicateWarning).
func duplicateOf(ctx context.Context, q querier, id uuid.UUID) (*Duplicate, error) {
	var (
		d     Duplicate
		first *time.Time
	)
	if err := q.QueryRow(ctx, duplicateSQL, id).Scan(&d.PreviousCount, &first, &d.SameOwner); err != nil {
		return nil, fmt.Errorf("files: duplicate: %w", err)
	}
	if d.PreviousCount == 0 || first == nil {
		return nil, nil
	}
	d.FirstSeenAt = first.UTC()
	return &d, nil
}
