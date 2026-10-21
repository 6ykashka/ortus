package data

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// W4.50 (Q-W1.08-9, Q-W2.41-1): If-Match of the views and the export jobs is the ETag of the revision — «"N"» of the
// server or «"rev-N"» of the scenario server MSW W4.06 (the client builds it from DatasetView.revision and
// DatasetExportJob.revision: the lists carry no ETag of a row); both name the same revision.
func TestCheckRevision(t *testing.T) {
	t.Parallel()
	for _, ok := range []string{`"3"`, `"rev-3"`, ` "rev-3" `} {
		if err := checkRevision(ok, 3); err != nil {
			t.Errorf("If-Match %s: %v", ok, err)
		}
	}
	for raw, code := range map[string]string{
		``: "revision_required", `"2"`: "revision_mismatch", `"rev-2"`: "revision_mismatch", `W/"3"`: "revision_mismatch",
		`"rev-"`: "revision_mismatch", `*`: "revision_mismatch", `"rev-3", "3"`: "revision_mismatch",
	} {
		if err := checkRevision(raw, 3); !problem.Is(err, code) {
			t.Errorf("If-Match %q: %v, want %s", raw, err, code)
		}
	}
}
