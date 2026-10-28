// Package service is the source of the module «Обращения» for «Главная» (W7.31, contract 0.12.0-stage7; homeVM
// :4074–4080): the requests whose term is missed (service.sla_breached, danger) or at risk (service.sla_risk, warn) and
// the complaints, claims, damaged cargo and warranty cases with no performer (service.unassigned, warn). The requests
// come from the port of the module (service.Service.Home adapted in cmd/api); the client builds the texts.
package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Kinds of the cards (api/openapi/components/home/schemas.yaml DecisionItem.kind).
const (
	KindBreached   = "service.sla_breached"
	KindRisk       = "service.sla_risk"
	KindUnassigned = "service.unassigned"
)

// Kinds of the situations of the port.
const (
	SituationBreached   = "sla_breached"
	SituationRisk       = "sla_risk"
	SituationUnassigned = "unassigned"
)

// Card is a request that needs a decision.
type Card struct {
	Request   uuid.UUID
	Key       string
	Title     string
	Direction string
	Client    string
	Situation string
	Term      string
	Text      string
	Until     string
	Assignee  string
	At        time.Time
}

// Reader is the port of the module «Обращения».
type Reader interface {
	Home(ctx context.Context, tc tenantctx.TenantContext) ([]Card, error)
}

// Source is the source of requests.
type Source struct{ Requests Reader }

var _ home.Source = Source{}

// moduleService is the module key of the cards and of their object.
const moduleService = "service"

// Module implements home.Source: «Обращения» is not an installable module of the registry yet (a core source).
func (Source) Module() string { return "" }

// Cards implements home.Source.
func (s Source) Cards(ctx context.Context, q home.Query) ([]homeapi.DecisionItem, error) {
	cards, err := s.Requests.Home(ctx, q.Tenant)
	if err != nil {
		return nil, err
	}
	out := make([]homeapi.DecisionItem, 0, len(cards))
	for _, c := range cards {
		out = append(out, item(c))
	}
	return out, nil
}

func item(c Card) homeapi.DecisionItem {
	kind, tone := KindUnassigned, homeapi.Warn
	switch c.Situation {
	case SituationBreached:
		kind, tone = KindBreached, homeapi.Danger
	case SituationRisk:
		kind = KindRisk
	}
	params := map[string]string{"requestKey": c.Key, "directionName": c.Direction, "clientName": c.Client, "title": c.Title,
		"termLabel": c.Term, "termText": c.Text, "termUntil": c.Until}
	if c.Assignee != "" {
		params["assigneeName"] = c.Assignee
	}
	at := c.At.UTC()
	return homeapi.DecisionItem{Key: kind + ":" + c.Request.String(), Kind: kind, ModuleKey: moduleService, Tone: tone, Params: params,
		Object: &homeapi.ObjectRef{ModuleKey: moduleService, EntityType: "request", EntityId: c.Request}, OccurredAt: &at}
}
