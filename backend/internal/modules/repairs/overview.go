package repairs

import (
	"context"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// planMarginPct is the margin of the plan card of the overview (27 % of the contract, the prototype and its MSW port);
// the finance of an object (W6.15) replaces it with the plan of the estimate.
const planMarginPct = 27

// feedLimit is the number of lines of the feed of the overview.
const feedLimit = 20

// Overview answers getRepairProjectOverview (variant 1a): the queue of decisions, the volumes, the photos of the marks,
// the people, the money (only with repairs.finance.read) and the feed.
func (s *Service) Overview(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.RepairProjectOverview, error) {
	var out rapi.RepairProjectOverview
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, id, false)
		if err != nil {
			return err
		}
		f, err := r.loadFacts(ctx, []uuid.UUID{p.id})
		if err != nil {
			return err
		}
		dto, todo, v, err := r.summarize(ctx, p, f)
		if err != nil {
			return err
		}
		out = rapi.RepairProjectOverview{Project: dto, Decisions: todo, Works: workDTOs(f.works[p.id])}
		if out.Photos, err = r.photos(ctx, p.id); err != nil {
			return err
		}
		if out.People, err = r.people(ctx, p, f); err != nil {
			return err
		}
		if out.Feed, err = r.feed(ctx, p.id); err != nil {
			return err
		}
		if v.finance && p.status != statusDraft {
			out.Money, err = r.money(ctx, p)
		}
		return err
	})
	return out, err
}

// photos are the photos of the marks that are not returned, the latest first; a photo of an accepted mark is accepted.
func (r *req) photos(ctx context.Context, project uuid.UUID) ([]rapi.RepairPhoto, error) {
	rows, err := r.tx.Query(ctx, `select g.id, g.created_at, g.status, f.file_id from repairs.work_logs g, unnest(g.evidence_file_ids) with ordinality as f(file_id, n)
		where g.project_id = $1 and g.status <> 'rejected' order by g.created_at desc, g.id, f.n`, project)
	if err != nil {
		return nil, store("photos", err)
	}
	defer rows.Close()
	out := []rapi.RepairPhoto{}
	for rows.Next() {
		var (
			ph     rapi.RepairPhoto
			status string
			at     time.Time
		)
		if err := rows.Scan(&ph.WorkLogId, &at, &status, &ph.FileId); err != nil {
			return nil, store("photos", err)
		}
		ph.TakenAt, ph.Status = at, rapi.RepairPhotoStatus("pending")
		if status == logAccepted {
			ph.Status = rapi.RepairPhotoStatus("accepted")
		}
		out = append(out, ph)
	}
	return out, store("photos", rows.Err())
}

// people are the client, the foreman and the crew of the object.
func (r *req) people(ctx context.Context, p *projectRow, f *facts) (rapi.RepairPeople, error) {
	crew := []rapi.Worker{}
	for _, w := range f.crew[p.id] {
		crew = append(crew, workerDTO(w))
	}
	out := rapi.RepairPeople{ClientName: p.clientName, ClientLinkActive: f.hasLink[p.id], Crew: crew}
	if p.foreman != nil {
		if err := r.loadNames(ctx, []uuid.UUID{*p.foreman}); err != nil {
			return out, err
		}
		if name := r.names[*p.foreman]; name != "" {
			fm := alloc(&out.Foreman)
			fm.DisplayName, fm.MemberId = name, *p.foreman
		}
	}
	return out, nil
}

// feed is the last lines of the feed of the object, the latest first.
func (r *req) feed(ctx context.Context, project uuid.UUID) ([]rapi.RepairFeedItem, error) {
	rows, err := r.tx.Query(ctx, `select at, text, actor_id from repairs.project_events where project_id = $1 order by at desc, id desc limit $2`, project, feedLimit)
	if err != nil {
		return nil, store("feed", err)
	}
	defer rows.Close()
	type line struct {
		at    time.Time
		text  string
		actor *uuid.UUID
	}
	var lines []line
	var actors []uuid.UUID
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.at, &l.text, &l.actor); err != nil {
			return nil, store("feed", err)
		}
		lines = append(lines, l)
		if l.actor != nil {
			actors = append(actors, *l.actor)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, store("feed", err)
	}
	if err := r.loadNames(ctx, actors); err != nil {
		return nil, err
	}
	out := make([]rapi.RepairFeedItem, 0, len(lines))
	for _, l := range lines {
		it := rapi.RepairFeedItem{At: l.at, Text: l.text}
		if l.actor != nil && r.names[*l.actor] != "" {
			it.ActorName = new(r.names[*l.actor])
		}
		out = append(out, it)
	}
	return out, nil
}

// money is the money card: the contract (the approved estimate, else the budget), what is received and spent (the
// finance of the object, W6.15, writes them; zero until then) and the margin of the plan.
func (r *req) money(ctx context.Context, p *projectRow) (*rapi.RepairMoneyCard, error) {
	contract := int64(0)
	total, _, err := r.approvedTotal(ctx, p.id)
	switch {
	case err != nil:
		return nil, err
	case total != nil:
		contract = *total
	case p.budget != nil:
		contract = *p.budget
	}
	return &rapi.RepairMoneyCard{
		Contract:   rapi.Money{AmountMinor: int(contract), Currency: p.currency},
		Received:   rapi.Money{AmountMinor: 0, Currency: p.currency},
		Expenses:   rapi.Money{AmountMinor: 0, Currency: p.currency},
		MarginPlan: rapi.RepairMoneyDelta{AmountMinor: (contract*planMarginPct + 50) / 100, Currency: p.currency},
	}, nil
}
