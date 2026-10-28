package docs

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// HomeWait is a thing of the documents that waits for the member (docWaits): the document, its title, the kind
// (approve, sign, ack, returned, mention, ocr), the term of the step, who asks (the author of a mention, who returned the
// document).
type HomeWait struct {
	Document uuid.UUID
	Title    string
	Kind     string
	Due      *time.Time
	By       string
}

// HomeWaits are the waits of the member for «Главная» (getMyDecisionQueue): the documents he sees, the newest first,
// at most limit waits. A document the member does not open (a finance one for the function «Водитель», a hidden one)
// gives none.
func (s *Service) HomeWaits(ctx context.Context, tc tenantctx.TenantContext, limit int) ([]HomeWait, error) {
	var out []HomeWait
	err := s.run(ctx, tc, false, func(r *req) error {
		for _, d := range r.w.sortedDocs() {
			if d.status == statusArchived {
				continue
			}
			if rt := r.w.rightsFor(r.me, d); !rt.view || rt.fn {
				continue
			}
			for _, w := range r.waits(d) {
				if len(out) >= limit {
					return nil
				}
				h := HomeWait{Document: d.id, Title: d.title, Kind: string(w.Kind)}
				if w.Due != nil {
					due := w.Due.Time
					h.Due = &due
				}
				if w.By != nil {
					h.By = *w.By
				}
				out = append(out, h)
			}
		}
		return nil
	})
	return out, err
}
