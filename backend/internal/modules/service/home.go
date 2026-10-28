package service

import (
	"context"
	"slices"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Kinds of the cards of «Требует решения» (homeVM :4074–4080); the source of «Главной» gives them their names.
const (
	HomeBreached   = "sla_breached"
	HomeRisk       = "sla_risk"
	HomeUnassigned = "unassigned"
)

// HomeLimit is the number of requests with a term at risk on «Главная» (homeVM: slice(0, 3)).
const HomeLimit = 3

// HomeCard is a request that needs a decision: the term is missed or at risk, or nobody works on a complaint.
type HomeCard struct {
	Request   uuid.UUID
	Key       string
	Title     string
	Direction string
	Client    string
	Kind      string // HomeBreached | HomeRisk | HomeUnassigned
	Term      string // the label of the term: «Первый ответ»
	Text      string // «просрочен на 1 ч 10 мин»
	Until     string // «был до 15:14»
	Assignee  string // "" — nobody
	At        time.Time
}

// unassignedKinds are the kinds that must not wait without a performer (homeVM: complaints, claims, damaged cargo,
// warranty cases).
var unassignedKinds = []string{KindComplaint, KindClaim, KindCargo, KindWarranty}

// Home is the port of «Главная» (W2.09): up to three open requests of the directions the actor reads whose term is
// missed or at risk (the most urgent first), and the requests of the kinds that must not wait that have no performer.
// A complaint about the actor does not exist for him.
func (s *Service) Home(ctx context.Context, tc tenantctx.TenantContext) ([]HomeCard, error) {
	var out []HomeCard
	err := s.run(ctx, tc, func(r *req) error {
		dirs, err := r.visible(ctx, actRead)
		if err != nil || len(dirs) == 0 {
			return err
		}
		list, err := r.requests(ctx, "r.direction_id = any($1) and r.about_member_id is distinct from $2 and r.status not in ('resolved', 'closed')",
			idsOf(dirs), r.meOrNil())
		if err != nil {
			return err
		}
		names, err := r.assigneeNamesOf(ctx, list)
		if err != nil {
			return err
		}
		out = homeCards(list, dirs, names, r.now)
		return nil
	})
	return out, err
}

func (r *req) assigneeNamesOf(ctx context.Context, list []*Request) (map[uuid.UUID]string, error) {
	var ids []uuid.UUID
	for _, x := range list {
		if x.Assignee != uuid.Nil {
			ids = append(ids, x.Assignee)
		}
	}
	return r.names(ctx, ids)
}

func homeCards(list []*Request, dirs []Direction, names map[uuid.UUID]string, now time.Time) []HomeCard {
	type scored struct {
		card HomeCard
		rank float64
	}
	var terms, loose []scored
	for _, x := range list {
		d := find(dirs, x.DirectionID)
		if d == nil {
			continue
		}
		h := SLAHeadOf(x.sla(), d.Calendar, now)
		card := HomeCard{Request: x.ID, Key: x.Key, Title: x.Title, Direction: d.Name, Client: x.Client.Name, Term: h.Label, Text: h.Text, Until: h.Until,
			Assignee: names[x.Assignee], At: x.CreatedAt}
		switch {
		case h.State == stateLate:
			card.Kind = HomeBreached
			terms = append(terms, scored{card, h.Rank})
		case h.State == stateRisk:
			card.Kind = HomeRisk
			terms = append(terms, scored{card, h.Rank})
		case x.Assignee == uuid.Nil && slices.Contains(unassignedKinds, x.Kind):
			card.Kind = HomeUnassigned
			loose = append(loose, scored{card, float64(x.CreatedAt.UnixMilli())})
		}
	}
	sort.SliceStable(terms, func(i, j int) bool { return terms[i].rank < terms[j].rank })
	sort.SliceStable(loose, func(i, j int) bool { return loose[i].rank < loose[j].rank })
	var out []HomeCard
	for _, t := range terms[:min(HomeLimit, len(terms))] {
		out = append(out, t.card)
	}
	for _, t := range loose[:min(HomeLimit, len(loose))] {
		out = append(out, t.card)
	}
	return out
}
