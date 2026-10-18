package files

import (
	"testing"
	"time"

	"github.com/google/uuid"

	filesapi "github.com/ortus/ortus-crm/backend/internal/api/files"
)

// Модель данных 4 (ответ владельца 17.10): sha256 файла с предупреждением о повторе. fileDTO carries the warning of
// completeUpload and getFile as FileDuplicateWarning (code duplicate_sha256, UTC); without one the field is absent.
func TestFileDTODuplicate(t *testing.T) {
	t.Parallel()
	msk := time.FixedZone("MSK", 3*60*60)
	first := time.Date(2026, 10, 18, 10, 30, 0, 0, msk)
	f := File{ID: uuid.New(), FileName: "Р-208 · спереди.jpg", ContentType: "image/jpeg", SizeBytes: 2048, SHA256: "ab",
		Status: "scanning", CreatedAt: first.Add(time.Hour)}
	if got := fileDTO(f); got.DuplicateWarning != nil {
		t.Errorf("no duplicate: %+v", *got.DuplicateWarning)
	}
	f.Duplicate = &Duplicate{FirstSeenAt: first, PreviousCount: 2, SameOwner: true}
	w := fileDTO(f).DuplicateWarning
	switch {
	case w == nil:
		t.Fatal("duplicate is lost")
	case w.Code != filesapi.DuplicateSha256 || w.PreviousCount != 2 || !w.SameOwner:
		t.Errorf("warning %+v", *w)
	case !w.FirstSeenAt.Equal(first) || w.FirstSeenAt.Location() != time.UTC:
		t.Errorf("firstSeenAt %v, want %v in UTC", w.FirstSeenAt, first)
	}
}
