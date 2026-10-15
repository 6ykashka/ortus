package realtime

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Тест R-6 брифа W1.07: кеш прав по policy_version со временем через Clock; отзыв ≤ 5 с.

const action = "fleet.inspections.read"

// tenantDB is a fake tenant DB: grants of people, installed modules and the policy version.
type tenantDB struct {
	mu       sync.Mutex
	grants   map[uuid.UUID][]authz.Grant // person → grants
	version  int64
	modules  []string
	subjects int // Subject calls
	versions int // PolicyVersion calls
	fail     error
}

type world struct {
	mu  sync.Mutex
	dbs map[uuid.UUID]*tenantDB
}

func (w *world) db(tenant uuid.UUID) *tenantDB {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.dbs[tenant] == nil {
		w.dbs[tenant] = &tenantDB{grants: map[uuid.UUID][]authz.Grant{}, version: 1}
	}
	return w.dbs[tenant]
}

func (w *world) Subject(_ context.Context, tc tenantctx.TenantContext, _ time.Time, grants bool) (authz.Subject, error) {
	d := w.db(tc.TenantID)
	d.mu.Lock()
	defer d.mu.Unlock()
	d.subjects++
	if d.fail != nil {
		return authz.Subject{}, d.fail
	}
	s := authz.Subject{TenantID: tc.TenantID, PersonID: tc.PersonID, Owner: tc.Owner}
	if grants {
		s.Grants = append([]authz.Grant(nil), d.grants[tc.PersonID]...)
	}
	return s, nil
}

func (w *world) InstalledModules(_ context.Context, tc tenantctx.TenantContext) ([]string, error) {
	d := w.db(tc.TenantID)
	d.mu.Lock()
	defer d.mu.Unlock()
	d.subjects++
	return append([]string(nil), d.modules...), nil
}

func (w *world) PolicyVersion(_ context.Context, tenant uuid.UUID) (int64, error) {
	d := w.db(tenant)
	d.mu.Lock()
	defer d.mu.Unlock()
	d.versions++
	if d.fail != nil {
		return 0, d.fail
	}
	return d.version, nil
}

// grant gives person the action in the whole tenant.
func (d *tenantDB) grant(person uuid.UUID) {
	d.mu.Lock()
	d.grants[person] = append(d.grants[person], authz.Grant{
		AssignmentID: uuid.New(), RoleID: uuid.New(), Actions: []string{action}, Scope: authz.Scope{Kind: "tenant"},
	})
	d.mu.Unlock()
}

// revoke drops the grants of person; bump also increments the policy version (BumpPolicy in the same transaction).
func (d *tenantDB) revoke(person uuid.UUID, bump bool) {
	d.mu.Lock()
	delete(d.grants, person)
	if bump {
		d.version++
	}
	d.mu.Unlock()
}

func (d *tenantDB) calls() (subjects, versions int) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.subjects, d.versions
}

type cacheRig struct {
	w     *world
	clk   *fakeClock
	cache *PolicyCache
	ev    *authz.Evaluator
	tc    tenantctx.TenantContext
	db    *tenantDB
}

func newCacheRig(versionMaxAge time.Duration) *cacheRig {
	w := &world{dbs: map[uuid.UUID]*tenantDB{}}
	clk := newClock()
	c := &PolicyCache{Inner: w, Versions: w, Clock: clk.Now, VersionMaxAge: versionMaxAge}
	appNow := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC) // APP_FIXED_NOW of the evaluator: never moves
	r := &cacheRig{w: w, clk: clk, cache: c, ev: authz.New(c, nil, func() time.Time { return appNow }),
		tc: tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()}}
	r.db = w.db(r.tc.TenantID)
	r.db.grant(r.tc.PersonID)
	return r
}

func (r *cacheRig) permit(t *testing.T) error {
	t.Helper()
	return r.ev.Permit(t.Context(), r.tc, action, authz.Resource{})
}

func isForbidden(err error) bool { return problem.Is(err, problem.CodeForbiddenAction) }

func TestPolicyCacheReusesSubjectWhileVersionHolds(t *testing.T) {
	t.Parallel()
	r := newCacheRig(0)
	for range 3 {
		if err := r.permit(t); err != nil {
			t.Fatalf("Permit: %v", err)
		}
	}
	if subjects, versions := r.db.calls(); subjects != 1 || versions != 3 {
		t.Fatalf("subjects read %d times, versions %d; want 1 and 3 (the version on every check)", subjects, versions)
	}
	// MaxAge by the clock of the cache, although the clock of the evaluator (APP_FIXED_NOW) stands still.
	r.clk.Add(DefaultCacheMaxAge)
	_ = r.permit(t)
	if subjects, _ := r.db.calls(); subjects != 2 {
		t.Fatalf("an entry of age MaxAge was reused (%d reads)", subjects)
	}
}

// S1-15: «новые запросы после применения ревокации блокируются» — сразу после транзакции с BumpPolicy.
func TestPolicyCacheRevocationIsImmediate(t *testing.T) {
	t.Parallel()
	r := newCacheRig(0)
	if err := r.permit(t); err != nil {
		t.Fatal(err)
	}
	r.db.revoke(r.tc.PersonID, true)
	if err := r.permit(t); !isForbidden(err) {
		t.Fatalf("Permit right after the revocation = %v, want forbidden_action", err)
	}
}

// Изменение без смены версии (период гранта) видно не позже MaxAge по часам кеша.
func TestPolicyCacheMaxAgeBoundsUnversionedChange(t *testing.T) {
	t.Parallel()
	r := newCacheRig(0)
	_ = r.permit(t)
	r.db.revoke(r.tc.PersonID, false)
	r.clk.Add(DefaultCacheMaxAge - time.Millisecond)
	if err := r.permit(t); err != nil {
		t.Fatalf("within MaxAge the cached grant still counts: %v", err)
	}
	r.clk.Add(time.Millisecond)
	if err := r.permit(t); !isForbidden(err) {
		t.Fatalf("after MaxAge = %v, want forbidden_action", err)
	}
}

// Версия в кеше (нагрузка этапа 3): отказ не позже VersionMaxAge, а по подсказке context.changed — сразу.
func TestPolicyCacheVersionMaxAgeAndInvalidate(t *testing.T) {
	t.Parallel()
	r := newCacheRig(time.Second)
	_ = r.permit(t)
	r.db.revoke(r.tc.PersonID, true)
	if err := r.permit(t); err != nil {
		t.Fatalf("a cached version hides the bump until VersionMaxAge: %v", err)
	}
	if _, versions := r.db.calls(); versions != 1 {
		t.Fatalf("version read %d times within VersionMaxAge", versions)
	}
	r.clk.Add(time.Second)
	if err := r.permit(t); !isForbidden(err) {
		t.Fatalf("after VersionMaxAge = %v, want forbidden_action", err)
	}

	r2 := newCacheRig(time.Minute)
	_ = r2.permit(t)
	r2.db.revoke(r2.tc.PersonID, true)
	sink, _ := Fanout(nil, r2.cache)
	sink(Hint{Type: TypeNotificationsChanged, TenantID: r2.tc.TenantID, Accounts: accounts(1)})
	if err := r2.permit(t); err != nil {
		t.Fatalf("notifications.changed must not invalidate permissions: %v", err)
	}
	sink(Hint{Type: TypeContextChanged, TenantID: r2.tc.TenantID, Accounts: accounts(1)})
	if err := r2.permit(t); !isForbidden(err) {
		t.Fatalf("after context.changed = %v, want forbidden_action", err)
	}
	r2.db.grant(r2.tc.PersonID)
	r2.db.version++
	_, resync := Fanout(nil, r2.cache)
	resync()
	if err := r2.permit(t); err != nil {
		t.Fatalf("after Resync the cache is empty: %v", err)
	}
}

// Отзыв ≤ 5 с по часам: худшая настройка (версия в кеше 1 с) + опрос worker (1 с) + доставка подсказки.
func TestRevocationWithinFiveSecondsByClock(t *testing.T) {
	t.Parallel()
	const budget = 5 * time.Second
	r := newCacheRig(time.Second)
	hub := NewHub(HubOptions{Clock: r.clk.Now})
	acc := uuid.New()
	c := mustRegister(t, hub, acc, "k")
	sink, _ := Fanout(hub, r.cache)
	_ = r.permit(t)

	t0 := r.clk.Now()
	r.db.revoke(r.tc.PersonID, true) // the transaction of the revocation with BumpPolicy

	// The server: denied by the version at the latest after VersionMaxAge, without any hint.
	var serverAt time.Time
	for step := 0; serverAt.IsZero(); step++ {
		if step > 100 {
			t.Fatal("never denied")
		}
		if isForbidden(r.permit(t)) {
			serverAt = r.clk.Now()
			break
		}
		r.clk.Add(100 * time.Millisecond)
	}
	// The interface: the worker picks the outbox event up within its interval, the hint reaches the socket.
	r.clk.Add(events.DefaultInterval)
	sink(Hint{Type: TypeContextChanged, TenantID: r.tc.TenantID, Accounts: []uuid.UUID{acc}})
	got := received(c)
	if len(got) != 1 || got[0].Type != TypeContextChanged {
		t.Fatalf("the socket got %+v", got)
	}
	if d := serverAt.Sub(t0); d > time.Second {
		t.Fatalf("server denied after %v, want ≤ 1 s", d)
	}
	if d := got[0].At.Sub(t0); d > budget {
		t.Fatalf("context.changed after %v, want ≤ %v", d, budget)
	}
}

func TestPolicyCacheKeysAndErrors(t *testing.T) {
	t.Parallel()
	r := newCacheRig(0)
	ctx := t.Context()
	other := r.tc
	other.TenantID = uuid.New() // the same person id in another tenant
	if err := r.ev.Permit(ctx, other, action, authz.Resource{}); !isForbidden(err) {
		t.Fatalf("a subject of tenant A leaked into tenant B: %v", err)
	}
	owner := r.tc
	owner.Owner = true
	s, err := r.cache.Subject(ctx, owner, time.Now(), true)
	if err != nil || !s.Owner {
		t.Fatalf("owner binding of tc lost: %+v, %v", s, err)
	}

	// A caller that modifies the result does not modify the cache.
	s, _ = r.cache.Subject(ctx, r.tc, time.Now(), true)
	s.Grants[0].Actions[0] = "billing.manage"
	s.Functions = append(s.Functions, "driver")
	again, _ := r.cache.Subject(ctx, r.tc, time.Now(), true)
	if again.Grants[0].Actions[0] != action || len(again.Functions) != 0 {
		t.Fatalf("the cache returned a shared subject: %+v", again)
	}

	// A different moment of the check (far from the cached one) reloads.
	before, _ := r.db.calls()
	_, _ = r.cache.Subject(ctx, r.tc, time.Now().Add(time.Hour), true)
	if after, _ := r.db.calls(); after != before+1 {
		t.Fatal("a subject loaded for another moment was reused")
	}

	// Failures are not cached and fail closed.
	r.db.mu.Lock()
	r.db.fail = errors.New("tenant DB down")
	r.db.mu.Unlock()
	if _, err := r.cache.Subject(ctx, r.tc, time.Now(), true); err == nil {
		t.Fatal("a version failure must fail the check")
	}
	r.db.mu.Lock()
	r.db.fail = nil
	r.db.mu.Unlock()

	r.db.mu.Lock()
	r.db.modules = []string{"fleet"}
	r.db.mu.Unlock()
	m1, _ := r.cache.InstalledModules(ctx, r.tc)
	m1[0] = "spa"
	m2, _ := r.cache.InstalledModules(ctx, r.tc)
	subjects, _ := r.db.calls()
	r.db.mu.Lock()
	r.db.modules = []string{"fleet", "spa"}
	r.db.version++
	r.db.mu.Unlock()
	m3, _ := r.cache.InstalledModules(ctx, r.tc)
	if len(m2) != 1 || m2[0] != "fleet" || len(m3) != 2 {
		t.Fatalf("modules %v then %v", m2, m3)
	}
	if after, _ := r.db.calls(); after != subjects+1 {
		t.Fatal("modules were not reloaded after the version changed")
	}
}

func TestPolicyCacheBounded(t *testing.T) {
	t.Parallel()
	r := newCacheRig(0)
	r.cache.MaxEntries = 4
	for range 20 {
		tc := r.tc
		tc.PersonID = uuid.New()
		if _, err := r.cache.Subject(t.Context(), tc, time.Now(), true); err != nil {
			t.Fatal(err)
		}
	}
	if n := r.cache.len(); n > 4 {
		t.Fatalf("cache holds %d subjects, want ≤ 4", n)
	}
}
