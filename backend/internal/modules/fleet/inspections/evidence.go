package inspections

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// evidenceSQL reads what the server knows of the photo files $1 at submitInspection:
//   - the moment it received each — completeUpload of its upload session (files.upload_sessions.completed_at, the
//     clock of the server), a file without a session (written by a seed) — when it was recorded;
//   - its duplicates — earlier files of the tenant (by created_at, id) with the same sha256 that were verified by
//     completeUpload and not rejected (scanning, ready: reserved and uploaded ones are claims, never checked bytes),
//     through files_sha256_idx (tenant 0017); the same owner — an earlier file of the same reservation or trip, or a
//     photo of the same inspection. Nothing of the earlier files leaves the query but the count, the first moment and
//     the flag (FileDuplicateWarning: they may be outside the scope of the actor).
//
// The tenant DB of the request is the whole search space: another tenant never counts (AC-02).
const evidenceSQL = `
select p.id, coalesce(s.completed_at, p.created_at), d.n, d.first_seen, d.same
  from files.objects p
  left join files.upload_sessions s on s.file_id = p.id and s.state = 'completed'
  cross join lateral (
    select count(*) as n, min(e.created_at) as first_seen,
           bool_or((e.owner_type = p.owner_type and e.owner_id = p.owner_id) or e.id = any($1::uuid[])) as same
      from files.objects e
     where e.sha256 = p.sha256 and e.state <> 'rejected' and e.state in ('scanning', 'ready')
       and (e.created_at, e.id) < (p.created_at, p.id)) d
 where p.id = any($1::uuid[])`

// photoEvidence returns the evidence of the photo files ids (evidenceSQL) by file id.
func photoEvidence(ctx context.Context, q querier, ids []uuid.UUID) (map[uuid.UUID]evidence, error) {
	rows, err := q.Query(ctx, evidenceSQL, uuidStrings(ids))
	if err != nil {
		return nil, fmt.Errorf("inspections: photo evidence: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]evidence{}
	for rows.Next() {
		var (
			id       uuid.UUID
			received time.Time
			n        int64
			first    *time.Time
			same     *bool
		)
		if err := rows.Scan(&id, &received, &n, &first, &same); err != nil {
			return nil, fmt.Errorf("inspections: photo evidence: %w", err)
		}
		out[id] = evidence{receivedAt: &received, duplicate: duplicateWarning(n, first, same)}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspections: photo evidence: %w", err)
	}
	return out, nil
}

// sealPhotos returns the photos of an inspection with the evidence of the server at submit (sealed): frozen with
// the inspection, later uploads and checks do not change it. A duplicate is a warning for the manager, never a refusal.
func sealPhotos(ctx context.Context, q querier, photos []fleetapi.InspectionPhoto) ([]fleetapi.InspectionPhoto, error) {
	ids := make([]uuid.UUID, 0, len(photos))
	for _, p := range photos {
		ids = append(ids, p.FileId)
	}
	found, err := photoEvidence(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	return sealed(photos, found), nil
}

// storedEvidenceSQL reads the evidence frozen with the photos of the stored roles (tenant 0017).
const storedEvidenceSQL = `
select inspection_id, file_id, server_captured_at, duplicate_count, duplicate_first_seen_at, duplicate_same_owner
  from fleet.inspection_photos where inspection_id = any($1::uuid[])`

// attachEvidence puts the evidence of fleet.inspection_photos on the photos of list (one query).
func attachEvidence(ctx context.Context, q querier, list []fleetapi.Inspection) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(list))
	for _, i := range list {
		ids = append(ids, i.Id)
	}
	rows, err := q.Query(ctx, storedEvidenceSQL, uuidStrings(ids))
	if err != nil {
		return fmt.Errorf("inspections: evidence: %w", err)
	}
	defer rows.Close()
	stored := map[uuid.UUID]map[uuid.UUID]evidence{}
	for rows.Next() {
		var (
			inspection, file uuid.UUID
			received, first  *time.Time
			n                *int64
			same             *bool
		)
		if err := rows.Scan(&inspection, &file, &received, &n, &first, &same); err != nil {
			return fmt.Errorf("inspections: evidence: %w", err)
		}
		if stored[inspection] == nil {
			stored[inspection] = map[uuid.UUID]evidence{}
		}
		e := evidence{receivedAt: received}
		if n != nil {
			e.duplicate = duplicateWarning(*n, first, same)
		}
		stored[inspection][file] = e
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspections: evidence: %w", err)
	}
	for i := range list {
		list[i].Photos = overlaid(list[i].Photos, stored[list[i].Id])
	}
	return nil
}

// duplicateColumns are fleet.inspection_photos.duplicate_count, duplicate_first_seen_at, duplicate_same_owner of a
// warning (all NULL without one).
func duplicateColumns(w *fleetapi.FileDuplicateWarning) (count, first, same any) {
	if w == nil {
		return nil, nil, nil
	}
	return w.PreviousCount, w.FirstSeenAt.UTC(), w.SameOwner
}

// receivedColumn is fleet.inspection_photos.server_captured_at of a photo.
func receivedColumn(p fleetapi.InspectionPhoto) any {
	if p.ServerCapturedAt == nil {
		return nil
	}
	return p.ServerCapturedAt.UTC()
}

// evidence is what the server knows of a photo file (антифрод фото W2.43, модель данных 4: «время съёмки фиксирует
// сервер», «sha256 файла с предупреждением о повторе»): the moment it received the photo and the duplicate warning.
type evidence struct {
	receivedAt *time.Time
	duplicate  *fleetapi.FileDuplicateWarning
}

// apply puts the evidence on a photo in place of whatever it carried.
func (e evidence) apply(p *fleetapi.InspectionPhoto) {
	p.ServerCapturedAt, p.DuplicateWarning = nil, nil
	if e.receivedAt != nil {
		at := e.receivedAt.UTC()
		p.ServerCapturedAt = &at
	}
	if e.duplicate != nil {
		w := *e.duplicate
		w.FirstSeenAt = w.FirstSeenAt.UTC()
		p.DuplicateWarning = &w
	}
}

// sealed returns a copy of photos carrying the server evidence of found (by fileId) only: serverCapturedAt and
// duplicateWarning sent by the client are dropped (readOnly, ignored in InspectionCreate).
func sealed(photos []fleetapi.InspectionPhoto, found map[uuid.UUID]evidence) []fleetapi.InspectionPhoto {
	out := make([]fleetapi.InspectionPhoto, len(photos))
	for i, p := range photos {
		found[p.FileId].apply(&p)
		out[i] = p
	}
	return out
}

// trustedPhotos returns the photos of answers as evidence may be shown: an inspection submitted before W2.43 kept
// the photos as the client sent them, so their serverCapturedAt and duplicateWarning are dropped.
func trustedPhotos(a answers) []fleetapi.InspectionPhoto {
	if a.Evidence {
		return a.Photos
	}
	return sealed(a.Photos, nil)
}

// overlaid replaces the evidence of photos with the rows of fleet.inspection_photos (tenant 0017, the stored roles,
// by fileId); damage photos have no row and keep what answers hold.
func overlaid(photos []fleetapi.InspectionPhoto, rows map[uuid.UUID]evidence) []fleetapi.InspectionPhoto {
	out := make([]fleetapi.InspectionPhoto, len(photos))
	for i, p := range photos {
		if e, ok := rows[p.FileId]; ok {
			e.apply(&p)
		}
		out[i] = p
	}
	return out
}

// duplicateWarning is the warning of n earlier files of the tenant with the same sha256 (FileDuplicateWarning), the
// earliest seen at first; nil when there are none. It never blocks: the inspection goes on, the manager sees it.
func duplicateWarning(n int64, first *time.Time, same *bool) *fleetapi.FileDuplicateWarning {
	if n < 1 || first == nil {
		return nil
	}
	return &fleetapi.FileDuplicateWarning{Code: fleetapi.DuplicateSha256, FirstSeenAt: first.UTC(), PreviousCount: n,
		SameOwner: same != nil && *same}
}
