//go:build integration

package billing

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

// Возврат 1 W4.60: одобренное, но ещё не применённое понижение не должно пережить более позднее решение.

// staleNote is the note of a downgrade closed because the tier changed before it was due.
const staleNote = "Тариф изменён до срока понижения"

// approved creates a request of o and approves it by the billing operator.
func (w *world) approved(o Owner, tier string, term int, reqID string) Request {
	w.t.Helper()
	r, err := w.store.CreateRequest(w.t.Context(), CreateRequest{Owner: o, Tier: tier, TermMonths: term})
	must(w.t, err)
	d, err := w.store.Decide(w.t.Context(), Decision{Actor: w.billing, ID: r.ID, Approve: true, RequestID: reqID})
	must(w.t, err)
	return d
}

// Повышение после запланированного понижения: одобрение повышения закрывает понижение (cancelled, «Заменена заявкой
// SR-N», журнал от оператора); в срок старого понижения планировщик тариф не меняет.
func TestUpgradeSupersedesScheduledDowngrade(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	down := w.approved(w.shishkin, "start", 1, "r-down")
	eq(t, "downgrade scheduled", [2]any{val(down.EffectiveAt), down.AppliedAt == nil}, [2]any{w.cargoEnd, true})
	w.now = w.now.Add(time.Hour)
	up := w.approved(w.shishkin, "unl", 12, "r-upgrade")
	eq(t, "upgrade applied at once", val(up.AppliedAt), w.now)
	old, err := request(ctx, w.store.DB, down.ID)
	must(t, err)
	eq(t, "downgrade superseded", [5]any{old.Status, old.EffectiveAt == nil, old.AppliedAt == nil, old.DecisionNote, old.Revision},
		[5]any{StatusCancelled, true, true, "Заменена заявкой " + up.Number, int64(3)})
	eq(t, "audit of the supersede", w.one(`select concat_ws('|', action, actor_kind, reason, details->>'request', details->>'tier')
		from platform_audit where request_id = 'r-upgrade' and action = $1`, ActionRequestCanceled),
		"subscription.change_request_cancelled|operator|Заменена заявкой "+up.Number+"|"+down.Number+"|start")
	w.now = w.cargoEnd.Add(time.Minute)
	changed, err := w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "nothing due at the end of the old period", len(changed), 0)
	sub, err := w.store.Subs.Current(ctx, w.cargo)
	must(t, err)
	eq(t, "the paid upgrade stays", [2]any{sub.PlanKey, val(sub.TermMonths)}, [2]any{"unl", 12})
}

// Два понижения с одним сроком: более позднее одобрение заменяет раннее — применяется ровно одно, последнее.
func TestLaterDowngradeSupersedesEarlier(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	first := w.approved(w.shishkin, "start", 1, "r-first")
	w.now = w.now.Add(time.Hour)
	second := w.approved(w.shishkin, "start", 12, "r-second")
	eq(t, "same effective date", val(second.EffectiveAt), val(first.EffectiveAt))
	old, err := request(ctx, w.store.DB, first.ID)
	must(t, err)
	eq(t, "first superseded", [2]any{old.Status, old.DecisionNote}, [2]any{StatusCancelled, "Заменена заявкой " + second.Number})
	w.now = w.cargoEnd.Add(time.Minute)
	changed, err := w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "applied once", changed, []uuid.UUID{w.cargo})
	sub, err := w.store.Subs.Current(ctx, w.cargo)
	must(t, err)
	eq(t, "the later decision", [2]any{sub.PlanKey, val(sub.TermMonths)}, [2]any{"start", 12})
	eq(t, "one applied", w.one(`select count(*)::text from subscription_change_requests where applied_at is not null`), "1")
}

// Тариф сменили вручную (оператор, updatePlatformSubscription) после одобрения понижения: в срок планировщик не
// применяет устаревшее понижение, а закрывает его (журнал от системы).
func TestApplyDueSkipsStaleDowngrade(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	down := w.approved(w.shishkin, "start", 1, "r-down")
	sub, err := w.store.Subs.Current(ctx, w.cargo)
	must(t, err)
	end := w.now.Add(365 * 24 * time.Hour)
	_, err = w.store.Subs.Update(ctx, w.cargo, subscriptions.Update{PlanKey: "biz", Status: subscriptions.StatusActive, PeriodEndsAt: &end,
		Reason: "Перевод по договору"}, sub.Revision, w.owner)
	must(t, err)
	w.now = w.cargoEnd.Add(time.Minute)
	changed, err := w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "nothing applied", len(changed), 0)
	sub, err = w.store.Subs.Current(ctx, w.cargo)
	must(t, err)
	eq(t, "manual tier stays", sub.PlanKey, "biz")
	old, err := request(ctx, w.store.DB, down.ID)
	must(t, err)
	eq(t, "stale downgrade closed", [2]any{old.Status, old.DecisionNote}, [2]any{StatusCancelled, staleNote})
	eq(t, "system audit", w.one(`select concat_ws('|', actor_kind, reason, details->>'request') from platform_audit
		where action = $1 and actor_kind = 'system'`, ActionRequestCanceled), "system|"+staleNote+"|"+down.Number)
	changed, err = w.store.ApplyDue(ctx)
	must(t, err)
	eq(t, "not picked up again", len(changed), 0)
}

// Сбой одной заявки не останавливает планировщик: следующие понижения применяются, ошибка возвращается.
func TestApplyDueContinuesAfterFailure(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	broken := w.tenant("Сломанная подписка", "active")
	owner := w.member(broken, "Пётр Сломов", "active", true)
	w.subscription(broken, plan{tier: "team", state: "active", from: w.now.Add(-30 * 24 * time.Hour), end: w.now.Add(30 * 24 * time.Hour),
		source: "plan", seats: 25, quotaGiB: 100, version: 2, term: new(1), amount: new(int64(890000))})
	first := w.approved(owner, "start", 1, "r-broken")
	w.approved(w.shishkin, "start", 1, "r-cargo")
	w.exec(`create function w460_broken() returns trigger language plpgsql as $$ begin raise exception 'broken subscription'; end $$`)
	w.exec(`create trigger w460_broken before update or insert on subscriptions for each row when (new.tenant_id = '` + broken.String() +
		`') execute function w460_broken()`)
	w.now = w.cargoEnd.Add(time.Minute)
	changed, err := w.store.ApplyDue(ctx)
	if err == nil {
		t.Fatal("ApplyDue: want the error of the broken request")
	}
	eq(t, "the next one applied", changed, []uuid.UUID{w.cargo})
	b, err := request(ctx, w.store.DB, first.ID)
	must(t, err)
	eq(t, "the broken one waits for the next run", [2]any{b.Status, b.AppliedAt == nil}, [2]any{StatusApproved, true})
}
