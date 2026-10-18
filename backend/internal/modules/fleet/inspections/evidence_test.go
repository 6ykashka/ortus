package inspections

import (
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// forged is a photo as a client could send it: serverCapturedAt and duplicateWarning are readOnly in the contract
// (ignored in InspectionCreate), never evidence.
func forged(role string) fleetapi.InspectionPhoto {
	p := photo(role)
	at := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	p.ServerCapturedAt = &at
	p.DuplicateWarning = &fleetapi.FileDuplicateWarning{Code: fleetapi.DuplicateSha256, FirstSeenAt: at, PreviousCount: 9, SameOwner: true}
	return p
}

// carries reports whether p carries exactly the evidence e.
func carries(p fleetapi.InspectionPhoto, e evidence) bool {
	switch {
	case (p.ServerCapturedAt == nil) != (e.receivedAt == nil), (p.DuplicateWarning == nil) != (e.duplicate == nil):
		return false
	case p.ServerCapturedAt != nil && !p.ServerCapturedAt.Equal(*e.receivedAt):
		return false
	}
	return p.DuplicateWarning == nil || *p.DuplicateWarning == *e.duplicate
}

// Модель данных 4 (ответ владельца 17.10): время съёмки фиксирует сервер; повтор sha256 — предупреждение сервера.
// What the client claims is dropped; the server evidence is attached by fileId.
func TestSealed(t *testing.T) {
	t.Parallel()
	received := time.Date(2026, 10, 18, 7, 31, 0, 0, time.UTC)
	first := time.Date(2026, 10, 1, 6, 0, 0, 0, time.UTC)
	warning := &fleetapi.FileDuplicateWarning{Code: fleetapi.DuplicateSha256, FirstSeenAt: first, PreviousCount: 2}
	photos := []fleetapi.InspectionPhoto{forged("front"), forged("rear"), forged("damage")}
	want := []evidence{{receivedAt: &received, duplicate: warning}, {receivedAt: &received}, {}}
	found := map[uuid.UUID]evidence{photos[0].FileId: want[0], photos[1].FileId: want[1]}
	got := sealed(photos, found)
	if len(got) != 3 {
		t.Fatalf("%d photos", len(got))
	}
	for i, what := range []string{"photo with a duplicate", "photo without a duplicate", "photo the server knows nothing of"} {
		if !carries(got[i], want[i]) || got[i].FileId != photos[i].FileId || got[i].CapturedAt != photos[i].CapturedAt {
			t.Errorf("%s: %+v", what, got[i])
		}
	}
	if photos[0].ServerCapturedAt.Year() != 2020 || photos[1].DuplicateWarning == nil {
		t.Error("sealed changed the body of the request")
	}
}

// An inspection submitted before W2.43 kept InspectionCreate.photos as sent: their serverCapturedAt and
// duplicateWarning are the claims of the client and are not shown; answers written by W2.43 are trusted.
func TestTrustedPhotos(t *testing.T) {
	t.Parallel()
	legacy := answers{Photos: []fleetapi.InspectionPhoto{forged("front"), forged("damage")}}
	for _, p := range trustedPhotos(legacy) {
		if p.ServerCapturedAt != nil || p.DuplicateWarning != nil {
			t.Errorf("legacy %s: %+v", p.Role, p)
		}
	}
	sealedAnswers := answers{Photos: []fleetapi.InspectionPhoto{forged("damage")}, Evidence: true}
	if got := trustedPhotos(sealedAnswers); got[0].ServerCapturedAt == nil || got[0].DuplicateWarning == nil {
		t.Errorf("answers sealed by the server: %+v", got[0])
	}
}

// fleet.inspection_photos (tenant 0017) holds the evidence of the stored roles: a row replaces what answers hold
// (inspections before W2.43 got server_captured_at from the upload session); damage photos have no row.
func TestOverlaid(t *testing.T) {
	t.Parallel()
	received := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	front, damage := photo("front"), forged("damage")
	front.DuplicateWarning = &fleetapi.FileDuplicateWarning{Code: fleetapi.DuplicateSha256, PreviousCount: 1}
	got := overlaid([]fleetapi.InspectionPhoto{front, damage}, map[uuid.UUID]evidence{front.FileId: {receivedAt: &received}})
	if p := got[0]; p.ServerCapturedAt == nil || !p.ServerCapturedAt.Equal(received) || p.DuplicateWarning != nil {
		t.Errorf("stored role: %+v", p)
	}
	if p := got[1]; p.ServerCapturedAt == nil || p.DuplicateWarning == nil || p.DuplicateWarning.PreviousCount != 9 {
		t.Errorf("damage photo keeps answers: %+v", p)
	}
}

// FileDuplicateWarning: earlier files of the tenant with the same sha256 (rejected excluded) — never a refusal.
func TestDuplicateWarning(t *testing.T) {
	t.Parallel()
	first := time.Date(2026, 10, 1, 6, 0, 0, 0, time.UTC)
	if w := duplicateWarning(0, nil, nil); w != nil {
		t.Errorf("no earlier file: %+v", w)
	}
	if w := duplicateWarning(0, &first, new(false)); w != nil {
		t.Errorf("zero earlier files: %+v", w)
	}
	w := duplicateWarning(3, &first, new(true))
	if w == nil || w.Code != "duplicate_sha256" || !w.FirstSeenAt.Equal(first) || w.PreviousCount != 3 || !w.SameOwner {
		t.Errorf("three earlier files: %+v", w)
	}
	if w := duplicateWarning(1, &first, nil); w == nil || w.SameOwner {
		t.Errorf("unknown owner: %+v", w)
	}
}
