package docs

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry the source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

type fakeReader struct {
	waits []Wait
	limit int
}

func (f *fakeReader) HomeWaits(_ context.Context, _ tenantctx.TenantContext, limit int) ([]Wait, error) {
	f.limit = limit
	return f.waits, nil
}

// The items of docWaits become the cards of «Требует решения» (kinds of the contract 0.12.0-stage7: docs.approve,
// docs.sign, docs.ack, docs.returned, docs.mention, docs.ocr; params documentTitle, dueDate, byName; object — the document).
func TestCards(t *testing.T) { //nolint:gocyclo // one story: the checks follow the cards of one queue
	t.Parallel()
	doc := uuid.New()
	due := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	f := &fakeReader{waits: []Wait{
		{Document: doc, Title: "Договор № 7", Kind: "approve", Due: &due},
		{Document: doc, Title: "Договор № 7", Kind: "returned", By: "Пётр Лебедев"},
		{Document: uuid.New(), Title: "Скан", Kind: "ocr"},
	}}
	s := Source{Docs: f}
	if s.Module() != "" {
		t.Fatalf("module %q, want a core source", s.Module())
	}
	cards, err := s.Cards(t.Context(), home.Query{})
	if err != nil || len(cards) != 3 || f.limit != Limit {
		t.Fatalf("cards: %v %d, asked %d", err, len(cards), f.limit)
	}
	c := cards[0]
	if c.Kind != "docs.approve" || c.ModuleKey != "docs" || c.Key != "docs.approve:"+doc.String() || c.Params["documentTitle"] != "Договор № 7" ||
		c.Params["dueDate"] != "2026-10-20" || c.Object == nil || c.Object.EntityType != "document" || c.Object.EntityId != doc {
		t.Fatalf("card %+v", c)
	}
	if cards[1].Kind != "docs.returned" || cards[1].Params["byName"] != "Пётр Лебедев" || string(cards[1].Tone) != "warn" {
		t.Fatalf("returned card %+v", cards[1])
	}
	if cards[2].Kind != "docs.ocr" || cards[2].Params["dueDate"] != "" {
		t.Fatalf("ocr card %+v", cards[2])
	}
	if cards[0].Key == cards[1].Key {
		t.Fatal("two situations of one document share a key")
	}
}
