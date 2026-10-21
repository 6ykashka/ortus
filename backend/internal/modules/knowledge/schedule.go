package knowledge

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The daily check of the review dates: the rule «Пора пересмотреть страницу → уведомить владельца» has the trigger
// «По расписанию · каждый день в 09:00» (knowledge.js:291). From 09:00 of the day in Moscow (the clock of the
// application) the first call runs the check of runKnowledgeReviewCheck once in every space where the rule is on — as
// the member who switched it on (kb.rules.enabled_by), his rights checked at each run (the description of
// setKnowledgeRuleEnabled): an active lead of the space or the owner of the business. Without them the run is the
// line «error» of the journal and nothing changes. A line of the journal of the rule since 09:00 (of this check or of
// «Проверить сроки сейчас») means the check of the day is done; an advisory lock of the rule keeps two workers from
// running it twice.

// reviewHour is the hour of the scheduled check in Moscow.
const reviewHour = 9

// ReviewRun is the scheduled check of the review dates of one space: Due pages became «Пора пересмотреть», Result
// is the result of the line of its journal (ok, stopped, error).
type ReviewRun struct {
	Space, Rule uuid.UUID
	Due         int
	Result      string
}

// reviewSlot is the moment of the scheduled check of the day of now: 09:00 of that day in Moscow.
func reviewSlot(now time.Time) time.Time {
	y, m, d := now.In(moscow).Date()
	return time.Date(y, m, d, reviewHour, 0, 0, 0, moscow)
}

// dueRulesSQL are the rules «Пора пересмотреть» that are on and have no line of the journal since $1.
const dueRulesSQL = `select r.id from kb.rules r where r.kind = 'review' and r.enabled
	and not exists (select 1 from kb.runs x where x.rule_id = r.id and x.ran_at >= $1) order by r.created_at, r.id`

// ScheduledReview runs the daily check of the review dates of tenantID at the clock of the application and returns
// the checks it made: none before 09:00 in Moscow and none for a rule already run since. Each rule runs in its own
// transaction: a failing one does not stop the others, its error is returned with its id.
func (s *Service) ScheduledReview(ctx context.Context, tenantID uuid.UUID) ([]ReviewRun, error) {
	now := s.now()
	slot := reviewSlot(now)
	if now.Before(slot) {
		return nil, nil
	}
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("knowledge: scheduled review: %w", err)
	}
	rows, err := pool.Query(ctx, dueRulesSQL, slot)
	if err != nil {
		return nil, fmt.Errorf("knowledge: scheduled review: %w", err)
	}
	rules, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("knowledge: scheduled review: %w", err)
	}
	var (
		out  []ReviewRun
		errs []error
	)
	for _, id := range rules {
		run, ran, err := s.scheduledRule(ctx, pool, tenantID, id, slot)
		switch {
		case err != nil:
			errs = append(errs, fmt.Errorf("knowledge: scheduled review of rule %s: %w", id, err))
		case ran:
			out = append(out, run)
		}
	}
	return out, errors.Join(errs...)
}

// scheduledRule runs the rule id if it is still on and not run since slot; ran reports whether it did.
func (s *Service) scheduledRule(ctx context.Context, pool *pgxpool.Pool, tenantID, id uuid.UUID, slot time.Time) (ReviewRun, bool, error) {
	var (
		out ReviewRun
		ran bool
	)
	err := s.inTx(ctx, pool, tenantctx.TenantContext{TenantID: tenantID}, pgx.TxOptions{}, func(r *req) error {
		if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('kb.review:' || $1::text, 0))`, id); err != nil {
			return err
		}
		var by uuid.UUID
		err := r.tx.QueryRow(ctx, `select coalesce(enabled_by, '00000000-0000-0000-0000-000000000000') from kb.rules r
			where r.id = $1 and r.kind = 'review' and r.enabled
			  and not exists (select 1 from kb.runs x where x.rule_id = r.id and x.ran_at >= $2)`, id, slot).Scan(&by)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // switched off or run meanwhile
		}
		if err != nil {
			return err
		}
		if err := r.load(ctx); err != nil {
			return err
		}
		x := r.w.ruleOf(id)
		sp := r.w.space[x.space]
		r.tc.PersonID, r.me = by, r.w.author(by)
		out, ran = ReviewRun{Space: sp.id, Rule: id, Result: "ok"}, true
		if why := r.authorCannot(sp, by); why != "" {
			out.Result = "error"
			return r.logRun(ctx, sp.id, x, "error", "У автора правила "+namePrefix(r.me.name)+"нет права проверять сроки пересмотра: "+why, 0)
		}
		due, err := r.reviewDue(ctx, sp, x)
		if err != nil {
			return err
		}
		out.Due = due
		if due == 0 {
			out.Result = "stopped"
		}
		return nil
	})
	return out, ran, err
}

// author is the member who switched a rule on as the snapshot knows him: his membership decides his status and
// whether he owns the business (not the context of a request). A person without a membership is not active.
func (w *world) author(id uuid.UUID) *member {
	if m := w.member[id]; m != nil {
		return m
	}
	return &member{id: id, name: w.names[id]}
}

// authorCannot is why the author of the rule may not check the review dates of sp ("" — he may): an active lead of
// the space or the owner of the business.
func (r *req) authorCannot(sp *space, by uuid.UUID) string {
	switch {
	case by == uuid.Nil:
		return "правило никто не включал"
	case r.me.status == memberBlocked:
		return "сотрудник заблокирован"
	case r.me.status != memberActive:
		return "сотрудник не активен"
	case !r.w.spaceMy(r.me, sp).lead:
		return "это может руководитель пространства или владелец бизнеса"
	}
	return ""
}

// namePrefix is the name followed by a space, or nothing.
func namePrefix(name string) string {
	if name == "" {
		return ""
	}
	return name + " "
}
