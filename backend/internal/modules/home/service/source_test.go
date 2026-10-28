package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
)

func TestCardsAreKindsTonesAndTextsOfTheTerm(t *testing.T) { //nolint:gocyclo // the tests share one seeded database and run in the order of the files
	t.Parallel()
	id := uuid.New()
	at := time.Date(2026, 10, 1, 8, 14, 0, 0, time.UTC)
	for situation, want := range map[string]struct {
		kind string
		tone homeapi.DecisionItemTone
	}{
		SituationBreached:   {"service.sla_breached", homeapi.Danger},
		SituationRisk:       {"service.sla_risk", homeapi.Warn},
		SituationUnassigned: {"service.unassigned", homeapi.Warn},
	} {
		got := item(Card{Request: id, Key: "ГРЗ-57", Title: "Бой", Direction: "Грузоперевозки", Client: "Наталья", Situation: situation, Text: "осталось 48 мин",
			Until: "до 17:12", Term: "Первый ответ", At: at})
		if got.Kind != want.kind || got.Tone != want.tone || got.Key != want.kind+":"+id.String() || got.ModuleKey != "service" {
			t.Errorf("%s: %+v", situation, got)
		}
		if got.Params["requestKey"] != "ГРЗ-57" || got.Params["directionName"] != "Грузоперевозки" || got.Params["clientName"] != "Наталья" || got.Params["termText"] != "осталось 48 мин" {
			t.Errorf("%s params %v", situation, got.Params)
		}
		if got.Object == nil || got.Object.EntityType != "request" || got.Object.EntityId != id {
			t.Errorf("%s object %+v", situation, got.Object)
		}
		if _, ok := got.Params["assigneeName"]; ok {
			t.Errorf("%s: no assignee, no param", situation)
		}
	}
	if got := item(Card{Situation: SituationRisk, Assignee: "Дарья"}); got.Params["assigneeName"] != "Дарья" {
		t.Errorf("assignee %v", got.Params)
	}
}
