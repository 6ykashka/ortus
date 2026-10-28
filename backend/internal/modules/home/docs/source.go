// Package docs is the source of the module «Документы» for «Главная» (W7.24, contract 0.12.0-stage7; docWaits of the
// prototype): what waits for the member — a step of a route to approve or sign, a document to acknowledge, a document
// returned for rework, a mention to answer, a scan to check (docs.approve, docs.sign, docs.ack, docs.returned,
// docs.mention, docs.ocr). The waits come from the port of the module (docs.Service.HomeWaits adapted in cmd/api); the
// client builds the texts.
package docs

import (
	"context"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Limit is the number of waits of the documents in «Требует решения».
const Limit = 5

// moduleDocs is the module key of the cards and of their object.
const moduleDocs = "docs"

// Wait is a wait of the member: the document, its title, the kind (approve, sign, ack, returned, mention, ocr), the term
// of the step and who asks.
type Wait struct {
	Document uuid.UUID
	Title    string
	Kind     string
	Due      *time.Time
	By       string
}

// Reader is the port of the module «Документы».
type Reader interface {
	HomeWaits(ctx context.Context, tc tenantctx.TenantContext, limit int) ([]Wait, error)
}

// Source is the source of documents.
type Source struct {
	Docs Reader
}

var _ home.Source = Source{}

// Module implements home.Source: a core source — the documents have no row in the registry of installable modules.
func (Source) Module() string { return "" }

// tones are the tones of the cards by kind: a signature, a return and a scan to check ask for more than the rest.
var tones = map[string]homeapi.DecisionItemTone{
	"sign": homeapi.Warn, "returned": homeapi.Warn, "ocr": homeapi.Warn,
	"approve": homeapi.Info, "ack": homeapi.Info, "mention": homeapi.Info,
}

// Cards implements home.Source: the first Limit waits of the member in the order of the port.
func (s Source) Cards(ctx context.Context, q home.Query) ([]homeapi.DecisionItem, error) {
	waits, err := s.Docs.HomeWaits(ctx, q.Tenant, Limit)
	if err != nil {
		return nil, err
	}
	out := make([]homeapi.DecisionItem, 0, len(waits))
	for _, w := range waits {
		out = append(out, card(w))
	}
	return out, nil
}

// card is the card of a wait (params of the contract: documentTitle, dueDate, byName).
func card(w Wait) homeapi.DecisionItem {
	kind := "docs." + w.Kind
	tone, ok := tones[w.Kind]
	if !ok {
		tone = homeapi.Neutral
	}
	params := map[string]string{"documentTitle": w.Title}
	if w.Due != nil {
		params["dueDate"] = w.Due.UTC().Format(time.DateOnly)
	}
	if w.By != "" {
		params["byName"] = w.By
	}
	return homeapi.DecisionItem{
		Key: kind + ":" + w.Document.String(), Kind: kind, ModuleKey: moduleDocs, Tone: tone, Params: params,
		Object: &homeapi.ObjectRef{ModuleKey: moduleDocs, EntityType: "document", EntityId: w.Document},
	}
}
