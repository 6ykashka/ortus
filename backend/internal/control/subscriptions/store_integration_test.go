//go:build integration

package subscriptions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

// stand is a migrated control DB: the store works as ortus_api, setup and checks as the migrator.
type stand struct {
	t     *testing.T
	admin *sql.DB
	store Store
	now   time.Time
}

func newStand(t *testing.T) *stand {
	t.Helper()
	name := cluster.NewDatabase(t, "subs")
	admin := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), admin, migrations.Control); err != nil {
		t.Fatal(err)
	}
	s := &stand{t: t, admin: admin, now: trialEnd.Add(-2 * day)}
	s.store = Store{DB: cluster.DB(t, name, migrations.RoleAPI), Now: func() time.Time { return s.now }}
	return s
}

// tenant registers a tenant in state since changed, with the plan of its creation request ("" — none).
func (s *stand) tenant(state string, changed time.Time, plan string) uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	s.exec(`insert into tenants (id, slug, display_name, industry_pack, state, state_changed_at)
		values ($1, $2, 'Организация', 'custom', $3::tenant_state, $4)`, id, "t-"+id.String()[:8], state, changed)
	if plan != "" {
		s.exec(`insert into platform_audit (actor_kind, action, target_type, target_id, result, request_id, details)
			values ('system', 'tenant.create', 'tenant', $1, 'ok', 'test', jsonb_build_object('planKey', $2::text))`, id, plan)
	}
	return id
}

func (s *stand) exec(q string, args ...any) {
	s.t.Helper()
	if _, err := s.admin.ExecContext(s.t.Context(), q, args...); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
}

func (s *stand) one(q string, args ...any) string {
	s.t.Helper()
	var v sql.NullString
	if err := s.admin.QueryRowContext(s.t.Context(), q, args...).Scan(&v); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

func TestCurrentDerivedTrial(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	since := trialEnd.Add(-TrialDays * day)
	id := s.tenant("trial", since, "team")
	sub, err := s.store.Current(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	if sub.Stored || sub.Status != StatusTrialing || sub.PlanKey != "team" || sub.Revision != 1 ||
		!sub.TrialEndsAt.Equal(trialEnd) || len(sub.Entitlements) != 2 {
		t.Errorf("derived %+v", sub)
	}
	if _, err := s.store.Current(t.Context(), uuid.New()); !errors.Is(err, ErrUnknownTenant) {
		t.Errorf("unknown tenant: %v", err)
	}
}

// Оператор меняет подписку: строка подписки, новая версия прав, состояние организации следует подписке, запись
// platform_audit с причиной; устаревшая ревизия — ErrRevision; ручные права заменяются следующим изменением.
func TestUpdate(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	id := s.tenant("trial", trialEnd.Add(-TrialDays*day), "")
	operator := uuid.New()
	manual := Entitlement{Key: KeyStorageQuota, SourceType: "manual", SourceRef: "SUP-42", Value: 200 << 30, ValidUntil: new(trialEnd.Add(30 * day))}
	u := Update{PlanKey: "start", Status: StatusActive, PeriodEndsAt: new(trialEnd.Add(365 * day)), Reason: "Оплата по счёту 17", Manual: []Entitlement{manual}}
	if _, err := s.store.Update(t.Context(), id, u, 2, operator); !errors.Is(err, ErrRevision) {
		t.Fatalf("stale revision: %v", err)
	}
	sub, err := s.store.Update(t.Context(), id, u, 1, operator)
	if err != nil {
		t.Fatal(err)
	}
	checkActiveWithManual(t, sub, *u.PeriodEndsAt)
	s.checkUpdated(id, operator)
	u2 := Update{PlanKey: "start", Status: StatusActive, Reason: "Снять ручную квоту"}
	sub, err = s.store.Update(t.Context(), id, u2, 2, operator)
	if err != nil || sub.Revision != 3 || len(sub.Entitlements) != 2 || sub.PeriodEndsAt != nil {
		t.Errorf("manual replaced: %+v %v", sub, err)
	}
	if _, err := s.store.Update(t.Context(), uuid.New(), u2, 1, operator); !errors.Is(err, ErrUnknownTenant) {
		t.Errorf("unknown tenant: %v", err)
	}
}

// checkActiveWithManual: the manual storage quota hides the plan one (one value per key and version).
func checkActiveWithManual(t *testing.T, sub Subscription, periodEnd time.Time) {
	t.Helper()
	if !sub.Stored || sub.Status != StatusActive || sub.Revision != 2 || !sub.PeriodEndsAt.Equal(periodEnd) ||
		sub.TrialEndsAt != nil || len(sub.Entitlements) != 2 || sub.Entitlements[1].SourceType != SourceManual ||
		sub.Entitlements[1].ValidUntil == nil {
		t.Fatalf("updated %+v", sub)
	}
}

// checkUpdated: the stored subscription, the tenant state that follows it and the audit row of the operator.
func (s *stand) checkUpdated(id, operator uuid.UUID) {
	s.t.Helper()
	if got, err := s.store.Current(s.t.Context(), id); err != nil || got.Revision != 2 || got.Status != StatusActive {
		s.t.Errorf("read back %+v %v", got, err)
	}
	if st := s.one(`select state::text from tenants where id = $1`, id); st != "active" {
		s.t.Errorf("tenant state %s", st)
	}
	if row := s.one(`select concat_ws('|', actor_kind, actor_id, target_type, reason, details->>'fromStatus', details->>'toStatus')
		from platform_audit where action = 'subscription.updated' and target_id = $1`, id); row !=
		"operator|"+operator.String()+"|subscription|Оплата по счёту 17|trialing|active" {
		s.t.Errorf("audit %q", row)
	}
}

// Приостановленная организация: подписка меняется, состояние организации — нет (его возвращает W1.11).
func TestUpdateKeepsSuspendedTenant(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	id := s.tenant("suspended", trialEnd.Add(-30*day), "team")
	sub, err := s.store.Update(t.Context(), id, Update{PlanKey: "team", Status: StatusGrace, GraceEndsAt: new(trialEnd), Reason: "Ждём оплату"}, 1, uuid.New())
	if err != nil || sub.Status != StatusGrace || !sub.GraceEndsAt.Equal(trialEnd) {
		t.Fatalf("%+v %v", sub, err)
	}
	if st := s.one(`select state::text from tenants where id = $1`, id); st != "suspended" {
		t.Errorf("tenant state %s", st)
	}
}

// AC-11: пробный период закончился → grace (7 дней) → read_only; tenants.state следует, platform_audit от системы.
func TestAdvance(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.now = trialEnd.Add(time.Hour)
	recent := s.tenant("trial", trialEnd.Add(-TrialDays*day), "start")            // trial ended an hour ago
	old := s.tenant("trial", trialEnd.Add(-(TrialDays+GraceDays+1)*day), "start") // trial and grace are over
	running := s.tenant("trial", trialEnd.Add(-day), "start")                     // 13 days left
	suspended := s.tenant("suspended", trialEnd.Add(-60*day), "start")            // derived active: nothing due
	n, err := s.store.Advance(t.Context())
	if err != nil || n != 3 {
		t.Fatalf("advance: %d %v", n, err)
	}
	for id, want := range map[uuid.UUID]string{recent: "grace", old: "read_only", running: "trial", suspended: "suspended"} {
		if st := s.one(`select state::text from tenants where id = $1`, id); st != want {
			t.Errorf("tenant %s: %s, want %s", id, st, want)
		}
	}
	sub, err := s.store.Current(t.Context(), recent)
	if err != nil || sub.Status != StatusGrace || !sub.GraceEndsAt.Equal(trialEnd.Add(GraceDays*day)) || sub.Revision != 2 {
		t.Errorf("recent %+v %v", sub, err)
	}
	if got := s.one(`select string_agg(action, ',' order by id) from platform_audit where target_id = $1 and actor_kind = 'system'
		and action like 'subscription.%'`, old); got != "subscription.trial_ended,subscription.grace_ended" {
		t.Errorf("audit of old: %s", got)
	}
	if n, err := s.store.Advance(t.Context()); err != nil || n != 0 {
		t.Errorf("second run: %d %v", n, err)
	}
}

// Оплаченный период: конец периода → grace.
func TestAdvancePaidPeriod(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.now = trialEnd.Add(time.Hour)
	paid := s.tenant("active", trialEnd.Add(-400*day), "team")
	if _, err := s.store.Update(t.Context(), paid, Update{PlanKey: "team", Status: StatusActive, PeriodEndsAt: new(trialEnd), Reason: "Оплата за год"}, 1, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if n, err := s.store.Advance(t.Context()); err != nil || n != 1 {
		t.Errorf("paid period: %d %v", n, err)
	}
	if st := s.one(`select state::text from tenants where id = $1`, paid); st != "grace" {
		t.Errorf("paid: %s", st)
	}
}

// Run: фоновый жизненный цикл (cmd/api) применяет переходы по тикам и выходит с отменой контекста.
func TestRun(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	s.now = trialEnd.Add(time.Hour)
	id := s.tenant("trial", trialEnd.Add(-TrialDays*day), "start")
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	go func() {
		s.store.Run(ctx, 20*time.Millisecond, slog.New(slog.DiscardHandler))
		close(done)
	}()
	deadline := time.Now().Add(10 * time.Second)
	for s.one(`select state::text from tenants where id = $1`, id) != "grace" {
		if time.Now().After(deadline) {
			t.Fatal("the tenant did not enter grace")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not stop with its context")
	}
}
