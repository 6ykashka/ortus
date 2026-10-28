package service

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// autoCloseAfter is how long a resolved request waits for «Вопрос не решён» before it is closed (Q-W4.00-service-3).
const autoCloseAfter = 5 * 24 * time.Hour

// SweepResult is what a pass over a tenant did.
type SweepResult struct{ Warned, Breached, Escalated, Closed int }

// Sweep is the worker of the terms of a tenant (22 «Эскалация»): a goal that came to the risk — one warning to the
// performer (the lead of the direction when nobody works on it), a goal that was missed — one breach, a request resolved
// five days ago is closed; a goal still missed a working day after its term goes to the owner too. What was told is
// noted in the details of the request, so a second pass says nothing twice.
// Every change is one transaction with its event (PD-60).
func (s *Service) Sweep(ctx context.Context, tenantID uuid.UUID) (SweepResult, error) {
	var out SweepResult
	err := s.run(ctx, tenantctx.TenantContext{TenantID: tenantID}, func(r *req) error {
		dirs, err := r.directions(ctx, "d.status = 'active'")
		if err != nil {
			return err
		}
		list, err := r.requests(ctx, "r.status <> 'closed'")
		if err != nil {
			return err
		}
		for _, x := range list {
			d := find(dirs, x.DirectionID)
			if d == nil {
				continue
			}
			res, err := r.sweep(ctx, x, d)
			if err != nil {
				return err
			}
			out.Warned += res.Warned
			out.Breached += res.Breached
			out.Escalated += res.Escalated
			out.Closed += res.Closed
		}
		return nil
	})
	return out, err
}

func (r *req) sweep(ctx context.Context, x *Request, d *Direction) (SweepResult, error) {
	var out SweepResult
	if x.Status == StatusResolved {
		if x.ResolvedAt != nil && !r.now.Before(x.ResolvedAt.Add(autoCloseAfter)) {
			return SweepResult{Closed: 1}, r.autoClose(ctx, x)
		}
		return out, nil
	}
	changed := false
	for _, it := range SLAOf(x.sla(), d.Calendar, r.now) {
		got, err := r.sweepItem(ctx, x, d, it)
		if err != nil {
			return out, err
		}
		out.Warned += got.Warned
		out.Breached += got.Breached
		out.Escalated += got.Escalated
		changed = changed || got != SweepResult{}
	}
	if !changed {
		return out, nil
	}
	return out, r.saveDetails(ctx, x)
}

// sweepItem tells what the state of one goal asks for: a warning, a breach, the escalation to the owner.
func (r *req) sweepItem(ctx context.Context, x *Request, d *Direction, it SLAItem) (SweepResult, error) {
	var out SweepResult
	switch it.State {
	case stateRisk:
		if told(&x.Details.Warned, it.Key) {
			out.Warned++
			return out, r.alert(ctx, x, d, evWarning, it, "Срок под угрозой")
		}
	case stateLate:
		if told(&x.Details.Breached, it.Key) {
			out.Breached++
			if err := r.alert(ctx, x, d, evBreached, it, "Срок нарушен"); err != nil {
				return out, err
			}
		}
		if r.escalationDue(x, d, it) && told(&x.Details.Escalated, it.Key) {
			out.Escalated++
			return out, r.escalate(ctx, x, d, it)
		}
	}
	return out, nil
}

// told notes key in list and reports whether it was not there yet.
func told(list *[]string, key string) bool {
	if slices.Contains(*list, key) {
		return false
	}
	*list = append(*list, key)
	return true
}

// alert publishes the event of a term and tells the performer (or the lead).
func (r *req) alert(ctx context.Context, x *Request, d *Direction, typ string, it SLAItem, what string) error {
	ev, err := r.publish(ctx, typ, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: d.ID, "target": it.Key})
	if err != nil {
		return err
	}
	severity := inbox.SeverityWarning
	if typ == evBreached {
		severity = inbox.SeverityCritical
	}
	to := x.Assignee
	if to == uuid.Nil && d.LeadID != nil {
		to = *d.LeadID
	}
	return r.notify(ctx, to, inbox.Notice{Kind: inbox.KindOf(typ), Severity: severity, Title: what + ": " + x.Key + " · " + it.Label + " — " + it.Text,
		Object: &inbox.Object{ModuleKey: "service", EntityType: entityRequest, EntityID: x.ID}, Link: "/service?request=" + x.ID.String(), SourceEvent: ev})
}

// escalationDue reports whether a missed goal has stayed missed for a working day and the owner was not told yet.
func (r *req) escalationDue(x *Request, d *Direction, it SLAItem) bool {
	var t *Timer
	switch it.Key {
	case targetFirst:
		t = x.SLA.First
	case targetRes:
		t = x.SLA.Resolve
	case targetLegal:
		t = x.SLA.Legal
	}
	if t == nil || slices.Contains(x.Details.Escalated, it.Key) {
		return false
	}
	return !r.now.Before(escalateAt(d.Calendar, it.Key, t.Due))
}

// escalateAt is the moment the owner is told of a goal due at due: a working day later (the legal term has no pause,
// a calendar day).
func escalateAt(cal Calendar, key string, due time.Time) time.Time {
	if day := cal.To - cal.From; key != targetLegal && day > 0 {
		return cal.AddWorkMinutes(due, day)
	}
	return due.Add(24 * time.Hour)
}

// escalate publishes the event and tells the owners of the business.
func (r *req) escalate(ctx context.Context, x *Request, d *Direction, it SLAItem) error {
	ev, err := r.publish(ctx, evEscalated, aggRequest, x.ID, map[string]any{keyRequestID: x.ID, keyKey: x.Key, keyDirectionID: d.ID, "target": it.Key})
	if err != nil {
		return err
	}
	members, err := r.members(ctx)
	if err != nil {
		return err
	}
	owners := make([]uuid.UUID, 0, len(members))
	for id, m := range members {
		if m.Owner && m.Active {
			owners = append(owners, id)
		}
	}
	slices.SortFunc(owners, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	for _, to := range owners {
		err := r.notify(ctx, to, inbox.Notice{Kind: inbox.KindOf(evEscalated), Severity: inbox.SeverityCritical,
			Title:  "Срок не выполнен больше рабочего дня: " + x.Key + " · " + it.Label + " — " + it.Text,
			Object: &inbox.Object{ModuleKey: "service", EntityType: entityRequest, EntityID: x.ID}, Link: "/service?request=" + x.ID.String(), SourceEvent: ev})
		if err != nil {
			return err
		}
	}
	return nil
}

// autoClose closes a request resolved five days ago.
func (r *req) autoClose(ctx context.Context, x *Request) error {
	if err := r.system(ctx, x.ID, "Закрыто автоматически: прошло 5 дней после решения"); err != nil {
		return err
	}
	x.Status = StatusClosed
	if err := r.save(ctx, x); err != nil {
		return err
	}
	if err := r.record(ctx, "service.request.autoclose", targetRequest, x.ID, audit.Normal, nil); err != nil {
		return err
	}
	return r.transitionEvents(ctx, x, StatusResolved, StatusClosed)
}

// Worker runs Sweep over the tenants every Every.
type Worker struct {
	S       *Service
	Tenants func(ctx context.Context) ([]uuid.UUID, error)
	Every   time.Duration
	Log     *slog.Logger
}

// Run sweeps until ctx ends; a failed tenant is logged and the others go on.
func (w Worker) Run(ctx context.Context) {
	if w.Every <= 0 {
		return
	}
	t := time.NewTicker(w.Every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.once(ctx)
		}
	}
}

func (w Worker) once(ctx context.Context) {
	ids, err := w.Tenants(ctx)
	if err != nil {
		w.Log.WarnContext(ctx, "service: sweep: tenants", slog.Any("error", err))
		return
	}
	for _, id := range ids {
		if _, err := w.S.Sweep(ctx, id); err != nil {
			w.Log.WarnContext(ctx, "service: sweep", slog.String("tenant", id.String()), slog.Any("error", err))
		}
	}
}
