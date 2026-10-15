//go:build integration

package operators

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
)

// T-04: приостановка из рабочих состояний — suspended, причина, ревизия + 1, часы приложения, аудит tenant.suspended
// в той же транзакции; производная подписка материализуется (Q-W1.08-13), её вид и ревизия не меняются.
func TestSuspend(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	for _, from := range []string{StateTrial, StateActive, StateGrace, StateReadOnly} {
		changed := now.Add(-3 * day)
		id := s.tenant("susp-"+from, from, changed)
		before := s.sub(id)
		cmd := reasonCmd(id, op, `"1"`, "  Неоплата счёта за октябрь  ")
		tn, err := s.svc.Suspend(t.Context(), cmd)
		must(t, err)
		eq(t, from+" tenant", [3]any{tn.ID, tn.State, tn.Revision}, [3]any{id, StateSuspended, int64(2)})
		eq(t, "row", s.read(id), tenantView{Name: "Организация susp-" + from, State: StateSuspended, Reason: "Неоплата счёта за октябрь",
			Revision: 2, ChangedAt: now})
		eq(t, "audit", s.audits(id), []auditRow{opRow(op, ActionSuspended, TargetTenant, id, "Неоплата счёта за октябрь", "ok",
			cmd.RequestID, "fromStatus", from, "toStatus", StateSuspended)})
		after := s.sub(id)
		want := viewOf(before)
		want.Stored = true
		eq(t, from+" subscription", viewOf(after), want)
		eq(t, from+" entitlements", sources(after), sources(before))
	}
}

// T-04: сохранённая подписка не переписывается при приостановке; If-Match в форме "rev-N" тоже принимается.
func TestSuspendStoredSubscription(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	id := s.tenant("susp-stored", StateActive, now.Add(-day))
	end := now.Add(30 * day)
	s.subscription(id, "team", "active", now.Add(-day), &end, map[string]string{"seats": "plan", "storage_quota_bytes": "plan"})
	_, err := s.svc.Suspend(t.Context(), reasonCmd(id, op, `"rev-1"`, "Неоплата счёта"))
	must(t, err)
	eq(t, "rows", [2]int{s.count(`select count(*) from subscriptions where tenant_id = $1`, id),
		s.count(`select count(*) from entitlements where tenant_id = $1`, id)}, [2]int{1, 2})
}

// T-04: отказы команды — 412, 428, 404, 409, 403 с записью denied, не оператор; ни ревизии, ни аудита изменения.
func TestCommandRefusals(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	owner, support, billing := s.operator(RoleOwner, "active"), s.operator(RoleSupport, "active"), s.operator(RoleBilling, "active")
	disabled, invited := s.operator(RoleAdmin, "disabled"), s.operator(RoleAdmin, "invited")
	id := s.tenant("refuse", StateTrial, now.Add(-day))
	const reason = "Неоплата счёта"
	supportCmd, billingCmd := reasonCmd(id, support, `"1"`, reason), reasonCmd(id, billing, `"1"`, reason)
	cases := []struct {
		name string
		cmd  StatusChange
		run  func(context.Context, StatusChange) (tenants.Tenant, error)
		want error
	}{
		{"stale If-Match", reasonCmd(id, owner, `"5"`, reason), s.svc.Suspend, ErrRevisionMismatch},
		{"weak If-Match", reasonCmd(id, owner, `W/"1"`, reason), s.svc.Suspend, ErrRevisionMismatch},
		{"no If-Match", reasonCmd(id, owner, ``, reason), s.svc.Suspend, ErrRevisionRequired},
		{"unknown tenant", reasonCmd(uuid.New(), owner, `"1"`, reason), s.svc.Suspend, tenants.ErrUnknownTenant},
		{"unknown tenant, junk If-Match", reasonCmd(uuid.New(), owner, `W/"1"`, reason), s.svc.Suspend, tenants.ErrUnknownTenant},
		{"not suspended", reasonCmd(id, owner, `"1"`, reason), s.svc.Resume, ErrInvalidTransition},
		{"support", supportCmd, s.svc.Suspend, ErrForbidden},
		{"billing", billingCmd, s.svc.Resume, ErrForbidden},
		{"disabled operator", reasonCmd(id, disabled, `"1"`, reason), s.svc.Suspend, ErrNotOperator},
		{"invited operator", reasonCmd(id, invited, `"1"`, reason), s.svc.Suspend, ErrNotOperator},
		{"not an operator", reasonCmd(id, uuid.New(), `"1"`, reason), s.svc.Suspend, ErrNotOperator},
	}
	for _, c := range cases {
		_, err := c.run(t.Context(), c.cmd)
		is(t, c.name, err, c.want)
	}
	_, err := s.svc.Suspend(t.Context(), reasonCmd(id, owner, `"1"`, "абв"))
	eq(t, "short reason", fieldsOf(err), []string{"reason"})
	eq(t, "tenant", s.read(id).Revision, int64(1))
	eq(t, "denied", s.audits(id), []auditRow{
		opRow(support, ActionSuspended, TargetTenant, id, reason, "denied", supportCmd.RequestID, "permission", PermTenantsManage),
		opRow(billing, ActionResumed, TargetTenant, id, reason, "denied", billingCmd.RequestID, "permission", PermTenantsManage),
	})
	for _, st := range []string{StateSuspended, StateProvisioning, StateClosing, StateClosed} {
		other := s.tenant("refuse-"+st, st, now.Add(-day))
		_, err := s.svc.Suspend(t.Context(), reasonCmd(other, owner, `"1"`, reason))
		is(t, "suspend from "+st, err, ErrInvalidTransition)
		eq(t, st+" audit", s.audits(other), []auditRow{})
	}
}

// T-04: возобновление — в состояние по подписке (Q-W1.00-3), аудит tenant.resumed.
func TestResumeBySubscription(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleAdmin, "active")
	end := now.Add(10 * day)
	for state, want := range map[string]string{"trial": StateTrial, "active": StateActive, "grace": StateGrace, "ended": StateReadOnly} {
		id := s.tenant("res-"+state, StateSuspended, now.Add(-day))
		s.subscription(id, "team", state, now.Add(-20*day), &end, map[string]string{"seats": "plan"})
		cmd := reasonCmd(id, op, `"1"`, "Оплата пришла")
		tn, err := s.svc.Resume(t.Context(), cmd)
		must(t, err)
		eq(t, "resume over "+state, [2]any{tn.State, tn.Revision}, [2]any{want, int64(2)})
		eq(t, "audit over "+state, s.audits(id), []auditRow{opRow(op, ActionResumed, TargetTenant, id, "Оплата пришла", "ok", cmd.RequestID,
			"fromStatus", StateSuspended, "toStatus", want)})
	}
}

// T-04: приостановка во время производного trial и возобновление — снова trial со сроком прежнего; приостановленная
// до W1.48 без строки подписки — в details.fromStatus последней приостановки, иначе active.
func TestResumeAfterOwnAndLegacySuspension(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleAdmin, "active")
	id := s.tenant("res-own", StateTrial, now.Add(-4*day))
	trial := viewOf(s.sub(id))
	_, err := s.svc.Suspend(t.Context(), reasonCmd(id, op, `"1"`, "Неоплата счёта"))
	must(t, err)
	tn, err := s.svc.Resume(t.Context(), reasonCmd(id, op, `"2"`, "Оплата пришла"))
	must(t, err)
	eq(t, "own suspension", [2]any{tn.State, tn.Revision}, [2]any{StateTrial, int64(3)})
	trial.Stored = true
	eq(t, "trial after resume", viewOf(s.sub(id)), trial)

	legacy := s.tenant("res-legacy", StateSuspended, now.Add(-day))
	s.exec(`insert into platform_audit (actor_kind, actor_id, action, target_type, target_id, reason, result, request_id, details)
values ('operator', $1, 'tenant.suspended', 'tenant', $2, 'Неоплата', 'ok', 'legacy', '{"fromStatus": "grace", "toStatus": "suspended"}')`, op, legacy)
	bare := s.tenant("res-bare", StateSuspended, now.Add(-day))
	for id, want := range map[uuid.UUID]string{legacy: StateGrace, bare: StateActive} {
		tn, err := s.svc.Resume(t.Context(), reasonCmd(id, op, `"1"`, "Оплата пришла"))
		must(t, err)
		eq(t, "legacy resume", tn.State, want)
	}
}

// T-04: переименование — имя, ревизия, tenant.renamed; то же имя — без изменений и аудита; статус не трогает.
func TestRename(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	id := s.tenant("ren", StateSuspended, now.Add(-day))
	reason := "Смена бренда"
	tn, err := s.svc.Rename(t.Context(), Rename{TenantID: id, ActorID: op, IfMatch: `"1"`, Name: "  Альта Групп  ", Reason: &reason, RequestID: "req-rename"})
	must(t, err)
	eq(t, "renamed", [3]any{tn.Name, tn.Revision, tn.State}, [3]any{"Альта Групп", int64(2), StateSuspended})
	eq(t, "row", s.read(id), tenantView{Name: "Альта Групп", State: StateSuspended, Revision: 2, ChangedAt: now.Add(-day)})
	renamed := []auditRow{opRow(op, ActionRenamed, TargetTenant, id, reason, "ok", "req-rename", "from", "Организация ren", "to", "Альта Групп")}
	eq(t, "audit", s.audits(id), renamed)

	tn, err = s.svc.Rename(t.Context(), Rename{TenantID: id, ActorID: op, IfMatch: `"2"`, Name: "Альта Групп"})
	must(t, err)
	eq(t, "same name", tn.Revision, int64(2))
	eq(t, "same name audit", s.audits(id), renamed)
	_, err = s.svc.Rename(t.Context(), Rename{TenantID: id, ActorID: s.operator(RoleSupport, "active"), IfMatch: `"2"`, Name: "Чужое"})
	is(t, "support", err, ErrForbidden)
}

// T-04: два запроса с одним If-Match — один выполняется, второй получает 412; одна запись аудита.
func TestConcurrentSuspendOneWins(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	id := s.tenant("race", StateActive, now.Add(-day))
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		errs []error
	)
	for range 2 {
		wg.Go(func() {
			_, err := s.svc.Suspend(context.Background(), reasonCmd(id, op, `"1"`, "Неоплата счёта"))
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		})
	}
	wg.Wait()
	ok := slices.ContainsFunc(errs, func(err error) bool { return err == nil })
	stale := slices.ContainsFunc(errs, func(err error) bool { return errors.Is(err, ErrRevisionMismatch) })
	eq(t, "one wins, one stale", [2]bool{ok, stale}, [2]bool{true, true})
	eq(t, "audit rows", len(s.audits(id)), 1)
}

// T-04: продление trialing — срок + N дней от текущего, начало trial прежнее, ревизия подписки + 1, права trial
// заново, аудит subscription.trial_extended с целью subscription; организация остаётся trial; второе продление — от
// нового срока.
func TestExtendTrialFromTrialing(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleBilling, "active")
	changed := now.Add(-10 * day)
	id := s.tenant("ext-trial", StateTrial, changed) // производный trial: до changed + 14 дней
	cmd := extendCmd(id, op, `"rev-1"`, 14)
	sub, err := s.svc.ExtendTrial(t.Context(), cmd)
	must(t, err)
	wantEnd := changed.Add(14*day).AddDate(0, 0, 14)
	want := subView{Status: subscriptions.StatusTrialing, TrialEnd: stamp(wantEnd), Revision: 2, Stored: true}
	eq(t, "answer", viewOf(sub), want)
	eq(t, "plan", sub.PlanKey, subscriptions.DefaultPlan)
	eq(t, "stored", viewOf(s.sub(id)), want)
	eq(t, "entitlements", sources(s.sub(id)), map[string]string{"seats": "trial:price-book:v2:start", "storage_quota_bytes": "trial:price-book:v2:start"})
	eq(t, "tenant", [2]any{s.read(id).State, s.read(id).Revision}, [2]any{StateTrial, int64(1)})
	eq(t, "trial start", s.lower(id), changed)
	eq(t, "audit", s.audits(id), []auditRow{opRow(op, ActionTrialExtended, TargetSubscription, id, "Пилот продлён", "ok", cmd.RequestID,
		"days", "14", "trialEndsAt", stamp(wantEnd), "fromStatus", "trialing", "toStatus", "trialing")})

	sub, err = s.svc.ExtendTrial(t.Context(), extendCmd(id, op, `"rev-2"`, 1))
	must(t, err)
	eq(t, "second", viewOf(sub), subView{Status: subscriptions.StatusTrialing, TrialEnd: stamp(wantEnd.AddDate(0, 0, 1)), Revision: 3, Stored: true})
}

// T-04: после неоплаченного trial (grace, read_only) — новый trial от «сейчас», истёкшая строка назад не
// растягивается (ревью W1.11); организация → trial; ручные права сохраняются.
func TestExtendTrialAfterTrial(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	graceEnd := now.Add(2 * day)
	for _, c := range []struct {
		state, row, from string
		end              *time.Time
	}{{StateGrace, "grace", subscriptions.StatusGrace, &graceEnd}, {StateReadOnly, "ended", subscriptions.StatusReadOnly, nil}} {
		id := s.tenant("ext-"+c.state, c.state, now.Add(-5*day))
		s.subscription(id, "start", c.row, now.Add(-30*day), c.end, map[string]string{"seats": "manual", "storage_quota_bytes": "trial"})
		cmd := extendCmd(id, op, `"rev-1"`, 14)
		sub, err := s.svc.ExtendTrial(t.Context(), cmd)
		must(t, err)
		end := now.AddDate(0, 0, 14)
		eq(t, "answer", viewOf(sub), subView{Status: subscriptions.StatusTrialing, TrialEnd: stamp(end), Revision: 2, Stored: true})
		eq(t, "trial start", s.lower(id), now)
		eq(t, "entitlements", sources(s.sub(id)), map[string]string{"seats": "manual:Тикет 42", "storage_quota_bytes": "trial:price-book:v2:start"})
		eq(t, "tenant", s.read(id), tenantView{Name: "Организация ext-" + c.state, State: StateTrial, Reason: "Пилот продлён", Revision: 2, ChangedAt: now})
		eq(t, "audit", s.audits(id), []auditRow{opRow(op, ActionTrialExtended, TargetSubscription, id, "Пилот продлён", "ok", cmd.RequestID,
			"days", "14", "trialEndsAt", stamp(end), "fromStatus", c.from, "toStatus", "trialing")})
	}
}

// T-04: приостановленная организация остаётся приостановленной, подписка — trialing от текущего срока.
func TestExtendTrialOfSuspended(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	op := s.operator(RoleOwner, "active")
	id := s.tenant("ext-suspended", StateSuspended, now.Add(-day))
	end := now.Add(3 * day)
	s.subscription(id, "start", "trial", now.Add(-11*day), &end, map[string]string{"seats": "trial", "storage_quota_bytes": "trial"})
	sub, err := s.svc.ExtendTrial(t.Context(), extendCmd(id, op, `"1"`, 7))
	must(t, err)
	eq(t, "subscription", viewOf(sub), subView{Status: subscriptions.StatusTrialing, TrialEnd: stamp(end.AddDate(0, 0, 7)), Revision: 2, Stored: true})
	eq(t, "tenant", [2]any{s.read(id).State, s.read(id).Revision}, [2]any{StateSuspended, int64(1)})
}

// T-04: продление оплаченной подписки и организации вне жизненного цикла — 409; 412, 428, 422, 403 + denied, 404.
func TestExtendTrialRefusals(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	owner, support := s.operator(RoleOwner, "active"), s.operator(RoleSupport, "active")
	end := now.Add(30 * day)
	paid := s.tenant("ext-paid", StateActive, now.Add(-day))
	s.subscription(paid, "team", "active", now.Add(-day), &end, map[string]string{"seats": "plan", "storage_quota_bytes": "plan"})
	cargo := s.tenant("ext-cargo", StateGrace, now.Add(-day)) // grace после оплаченного периода
	s.subscription(cargo, "team", "grace", now.Add(-day), nil, map[string]string{"seats": "plan", "storage_quota_bytes": "plan"})
	derivedActive := s.tenant("ext-derived", StateActive, now.Add(-day))
	provisioning := s.tenant("ext-prov", StateProvisioning, now.Add(-day))
	trial := s.tenant("ext-ok", StateTrial, now.Add(-day))
	denied := extendCmd(trial, support, `"rev-1"`, 14)
	for name, c := range map[string]struct {
		cmd  TrialExtension
		want error
	}{
		"paid":                    {extendCmd(paid, owner, `"rev-1"`, 14), ErrInvalidTransition},
		"grace after paid period": {extendCmd(cargo, owner, `"rev-1"`, 14), ErrInvalidTransition},
		"derived active":          {extendCmd(derivedActive, owner, `"rev-1"`, 14), ErrInvalidTransition},
		"provisioning":            {extendCmd(provisioning, owner, `"rev-1"`, 14), ErrInvalidTransition},
		"stale":                   {extendCmd(trial, owner, `"rev-5"`, 14), ErrRevisionMismatch},
		"no If-Match":             {extendCmd(trial, owner, ``, 14), ErrRevisionRequired},
		"unknown tenant":          {extendCmd(uuid.New(), owner, `"rev-1"`, 14), tenants.ErrUnknownTenant},
		"support":                 {denied, ErrForbidden},
	} {
		_, err := s.svc.ExtendTrial(t.Context(), c.cmd)
		is(t, name, err, c.want)
	}
	_, err := s.svc.ExtendTrial(t.Context(), extendCmd(trial, owner, `"rev-1"`, 31))
	eq(t, "31 days", fieldsOf(err), []string{"days"})
	for _, id := range []uuid.UUID{paid, cargo, derivedActive, provisioning} {
		eq(t, "no audit", s.audits(id), []auditRow{})
	}
	eq(t, "denied", s.audits(trial), []auditRow{opRow(support, ActionTrialExtended, TargetSubscription, trial, "Пилот продлён", "denied",
		denied.RequestID, "permission", PermBillingManage)})
	eq(t, "trial unchanged", viewOf(s.sub(trial)).Stored, false)
}
