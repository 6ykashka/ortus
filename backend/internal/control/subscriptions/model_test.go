package subscriptions

import (
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

var (
	day      = 24 * time.Hour
	trialEnd = time.Date(2026, 10, 13, 21, 0, 0, 0, time.UTC) // «до 13.10.2026» «Альты»
)

func TestTenantStateFor(t *testing.T) {
	t.Parallel()
	for status, want := range map[string]string{
		StatusTrialing: "trial", StatusActive: "active", StatusGrace: "grace", StatusPastDue: "grace",
		StatusReadOnly: "read_only", StatusCancelled: "read_only", "weird": "",
	} {
		if got := TenantStateFor(status); got != want {
			t.Errorf("TenantStateFor(%s) = %q, want %q", status, got, want)
		}
	}
}

// Организация без строки подписки: пробный период 14 дней от перехода в trial (провиженер W1.02 строку не пишет),
// тариф заявки tenant.create, права пробного тарифа — как createPlatformTenant MSW W0.13.
func TestDerive(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	id := uuid.New()
	trial := Derive(Tenant{ID: id, State: "trial", StateChangedAt: since, PlanKey: "team"})
	want := []Entitlement{
		{Key: KeySeats, SourceType: "trial", SourceRef: "price-book:v2:team", Value: 25},
		{Key: KeyStorageQuota, SourceType: "trial", SourceRef: "price-book:v2:team", Value: DefaultQuotaBytes},
	}
	if trial.TenantID != id || trial.PlanKey != "team" || trial.Status != StatusTrialing || trial.TrialEndsAt == nil ||
		!trial.TrialEndsAt.Equal(since.Add(TrialDays*day)) || trial.Revision != 1 || trial.Stored ||
		!slices.EqualFunc(trial.Entitlements, want, entEqual) {
		t.Errorf("trial: %+v", trial)
	}
}

func TestDeriveDefaultsAndStates(t *testing.T) {
	t.Parallel()
	since := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	if d := Derive(Tenant{State: "trial", StateChangedAt: since}); d.PlanKey != DefaultPlan || d.Entitlements[0].Value != 10 {
		t.Errorf("default plan: %+v", d)
	}
	if d := Derive(Tenant{State: "trial", StateChangedAt: since, PlanKey: "pilot"}); d.Entitlements[0].Value != 1_000_000 {
		t.Errorf("unknown tier: seats %+v", d.Entitlements)
	}
	grace := Derive(Tenant{State: "grace", StateChangedAt: since})
	if grace.Status != StatusGrace || grace.GraceEndsAt == nil || !grace.GraceEndsAt.Equal(since.Add(GraceDays*day)) {
		t.Errorf("grace: %+v", grace)
	}
	for state, status := range map[string]string{"active": StatusActive, "read_only": StatusReadOnly, "suspended": StatusActive} {
		if d := Derive(Tenant{State: state, StateChangedAt: since}); d.Status != status || d.Entitlements[0].SourceType != "plan" {
			t.Errorf("%s: %+v", state, d)
		}
	}
}

func entEqual(a, b Entitlement) bool {
	return a.Key == b.Key && a.SourceType == b.SourceType && a.SourceRef == b.SourceRef && a.Value == b.Value &&
		(a.ValidUntil == nil) == (b.ValidUntil == nil) && (a.ValidUntil == nil || a.ValidUntil.Equal(*b.ValidUntil))
}

// PLAT-05: конец пробного или оплаченного периода → grace на 7 дней → read_only.
func TestNextTrial(t *testing.T) {
	t.Parallel()
	trial := Subscription{Status: StatusTrialing, TrialEndsAt: new(trialEnd), Revision: 2}
	if _, _, due := Next(trial, trialEnd.Add(-time.Second)); due {
		t.Error("trial is not over yet")
	}
	g, tr, due := Next(trial, trialEnd.Add(time.Hour))
	if !due || g.Status != StatusGrace || g.GraceEndsAt == nil || !g.GraceEndsAt.Equal(trialEnd.Add(GraceDays*day)) {
		t.Fatalf("trial → grace: %+v", g)
	}
	checkTransition(t, tr, Transition{From: StatusTrialing, To: StatusGrace, Action: "subscription.trial_ended", At: trialEnd})
	r, tr, due := Next(g, trialEnd.Add(GraceDays*day))
	if !due || r.Status != StatusReadOnly || r.GraceEndsAt != nil || tr.Action != "subscription.grace_ended" ||
		!tr.At.Equal(trialEnd.Add(GraceDays*day)) {
		t.Fatalf("grace → read_only: %+v %+v", r, tr)
	}
	if _, _, due := Next(r, trialEnd.Add(100*day)); due {
		t.Error("read_only is final")
	}
}

func checkTransition(t *testing.T, got, want Transition) {
	t.Helper()
	if got.From != want.From || got.To != want.To || got.Action != want.Action || !got.At.Equal(want.At) {
		t.Errorf("transition %+v, want %+v", got, want)
	}
}

func TestNextPaidPeriod(t *testing.T) {
	t.Parallel()
	paid := Subscription{Status: StatusActive, PeriodEndsAt: new(trialEnd)}
	g, tr, due := Next(paid, trialEnd)
	if !due || g.Status != StatusGrace || tr.Action != "subscription.period_ended" || !g.GraceEndsAt.Equal(trialEnd.Add(GraceDays*day)) {
		t.Fatalf("active → grace: %+v %+v", g, tr)
	}
	if _, _, due := Next(Subscription{Status: StatusActive}, trialEnd.Add(1000*day)); due {
		t.Error("active without an end of period never ends")
	}
}

func TestValidate(t *testing.T) {
	t.Parallel()
	trial := Subscription{Status: StatusTrialing, PlanKey: "start", TrialEndsAt: new(trialEnd)}
	ok := Update{PlanKey: "start", Status: StatusTrialing, Reason: "Продление по договору", TrialEndsAt: new(trialEnd.Add(14 * day))}
	if err := Validate(ok, trial); err != nil {
		t.Fatalf("valid: %v", err)
	}
	manual := Entitlement{Key: KeyStorageQuota, SourceType: "manual", SourceRef: "SUP-42", Value: 1 << 40, ValidUntil: new(trialEnd)}
	cases := map[string]struct {
		mutate func(*Update)
		field  string
	}{
		"короткая причина":             {func(u *Update) { u.Reason = "ok" }, "reason"},
		"длинная причина":              {func(u *Update) { u.Reason = string(make([]rune, 501)) }, "reason"},
		"past_due в пилоте":            {func(u *Update) { u.Status = StatusPastDue }, "status"},
		"cancelled в пилоте":           {func(u *Update) { u.Status = StatusCancelled }, "status"},
		"неизвестный статус":           {func(u *Update) { u.Status = "frozen" }, "status"},
		"отмена в конце периода":       {func(u *Update) { u.CancelAtPeriodEnd = true }, "cancelAtPeriodEnd"},
		"пустой тариф":                 {func(u *Update) { u.PlanKey = "" }, "planKey"},
		"ручное право не manual":       {func(u *Update) { m := manual; m.SourceType = "plan"; u.Manual = []Entitlement{m} }, "manualEntitlements"},
		"ручное право без срока":       {func(u *Update) { m := manual; m.ValidUntil = nil; u.Manual = []Entitlement{m} }, "manualEntitlements"},
		"ручное право без ключа":       {func(u *Update) { m := manual; m.Key = ""; u.Manual = []Entitlement{m} }, "manualEntitlements"},
		"ручное право без основания":   {func(u *Update) { m := manual; m.SourceRef = ""; u.Manual = []Entitlement{m} }, "manualEntitlements"},
		"trialing без срока из active": {func(u *Update) { u.TrialEndsAt = nil }, "trialEndsAt"},
	}
	active := Subscription{Status: StatusActive, PlanKey: "start"}
	for name, c := range cases {
		u := ok
		c.mutate(&u)
		var ve *ValidationError
		if err := Validate(u, active); !errors.As(err, &ve) || !slices.Contains(ve.Fields, c.field) {
			t.Errorf("%s: %v, want field %s", name, err, c.field)
		}
	}
	keep := ok
	keep.TrialEndsAt = nil
	if err := Validate(keep, trial); err != nil {
		t.Errorf("trialing keeps the current end of trial: %v", err)
	}
	withManual := ok
	withManual.Manual = []Entitlement{manual}
	if err := Validate(withManual, trial); err != nil {
		t.Errorf("manual entitlement: %v", err)
	}
}

func TestPlanEntitlements(t *testing.T) {
	t.Parallel()
	got := PlanEntitlements("biz", "plan", 5<<30)
	want := []Entitlement{
		{Key: KeySeats, SourceType: "plan", SourceRef: "price-book:v2:biz", Value: 50},
		{Key: KeyStorageQuota, SourceType: "plan", SourceRef: "price-book:v2:biz", Value: 5 << 30},
	}
	if !slices.EqualFunc(got, want, entEqual) {
		t.Errorf("%+v", got)
	}
}

// W4.84: строка журнала изменения оператора несёт квоту места (деталь quotaBytes, operators.PublicDetails), когда
// действующая квота меняется — «{организация}: квота N ГБ» эталона (:3566); иначе квоты в деталях нет.
func TestUpdateDetails(t *testing.T) {
	t.Parallel()
	plan := PlanEntitlements("start", SourceTrial, DefaultQuotaBytes)
	cur := Subscription{PlanKey: "start", Status: StatusTrialing, TrialEndsAt: new(trialEnd), Entitlements: plan}
	manual := Entitlement{Key: KeyStorageQuota, SourceType: SourceManual, SourceRef: "SUP-42", Value: 25 << 30, ValidUntil: new(trialEnd.Add(365 * day))}
	next := cur
	next.Entitlements = []Entitlement{plan[0], manual}
	got := UpdateDetails(cur, next)
	want := map[string]string{
		"fromStatus": StatusTrialing, "toStatus": StatusTrialing, "planKey": "start",
		"trialEndsAt": "2026-10-13T21:00:00Z", "periodEndsAt": "", "graceEndsAt": "", "quotaBytes": "26843545600",
	}
	if len(got) != len(want) {
		t.Fatalf("details %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
	same := UpdateDetails(next, next)
	if _, ok := same["quotaBytes"]; ok {
		t.Errorf("quota unchanged: %v", same)
	}
	back := UpdateDetails(next, cur)
	if back["quotaBytes"] != "107374182400" {
		t.Errorf("manual quota removed — plan quota: %v", back)
	}
}
