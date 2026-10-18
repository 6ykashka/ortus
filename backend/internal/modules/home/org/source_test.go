package org

import (
	"context"
	"errors"
	"maps"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	tenant = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa") // «Альта» of the examples
	now    = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)          // 01.10.2026 10:30 MSK
)

// one returns the only card of items, failing otherwise.
func one(t *testing.T, items []homeapi.DecisionItem) homeapi.DecisionItem {
	t.Helper()
	if len(items) != 1 {
		t.Fatalf("cards %+v, want one", items)
	}
	return items[0]
}

// The source of the organization is a core source of the registry (asked always, no module of the registry W1.08).
func TestModule(t *testing.T) {
	t.Parallel()
	if m := (Source{}).Module(); m != "" {
		t.Fatalf("module %q, want a core source", m)
	}
}

// MSW tenantSource (fleet/home.ts): a grace or read_only business — «Пробный период завершён» (danger, no params); a
// trial ending in 0…14 whole days — «Пробный период: осталось N дней» (neutral) with daysLeft and trialEndsAt (the
// example getMyDecisionQueue/ok: 12 days, 2026-10-13T21:00:00Z); anything else gives no card.
func TestTrialCards(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 10, 13, 21, 0, 0, 0, time.UTC)
	ending := func(days string, end time.Time) map[string]string {
		return map[string]string{"daysLeft": days, "trialEndsAt": end.Format(time.RFC3339)}
	}
	for _, c := range []struct {
		name   string
		sub    Subscription
		kind   string
		tone   homeapi.DecisionItemTone
		params map[string]string
	}{
		{"12 days as the example", Subscription{Status: "trialing", TrialEndsAt: &end}, "tenant.trial_ending", homeapi.Neutral, ending("12", end)},
		{"14 days and some hours", Subscription{Status: "trialing", TrialEndsAt: new(now.Add(14*24*time.Hour + 23*time.Hour))},
			"tenant.trial_ending", homeapi.Neutral, ending("14", now.Add(14*24*time.Hour+23*time.Hour))},
		{"the last hours", Subscription{Status: "trialing", TrialEndsAt: new(now.Add(5 * time.Hour))},
			"tenant.trial_ending", homeapi.Neutral, ending("0", now.Add(5*time.Hour))},
		{"grace", Subscription{Status: "grace"}, "tenant.trial_ended", homeapi.Danger, map[string]string{}},
		{"read_only", Subscription{Status: "read_only"}, "tenant.trial_ended", homeapi.Danger, map[string]string{}},
	} {
		got := one(t, trialCards(tenant, c.sub, now))
		if got.Kind != c.kind || got.Key != c.kind+":"+tenant.String() || got.ModuleKey != "billing" || got.Tone != c.tone ||
			!maps.Equal(got.Params, c.params) || got.Object != nil {
			t.Errorf("%s: %+v, want %s %s %v", c.name, got, c.kind, c.tone, c.params)
		}
	}
	for _, c := range []struct {
		name string
		sub  Subscription
	}{
		{"15 days left", Subscription{Status: "trialing", TrialEndsAt: new(now.Add(15 * 24 * time.Hour))}},
		{"ended an hour ago, not yet moved by the lifecycle", Subscription{Status: "trialing", TrialEndsAt: new(now.Add(-time.Hour))}},
		{"trial without an end", Subscription{Status: "trialing"}},
		{"paid", Subscription{Status: "active", TrialEndsAt: &end}},
	} {
		if got := trialCards(tenant, c.sub, now); len(got) != 0 {
			t.Errorf("%s: %+v, want no card", c.name, got)
		}
	}
}

// «Место занято на N %» above 85 % of the limit: warn, danger from 100 %; percent rounded, bytes as strings.
func TestStorageCard(t *testing.T) {
	t.Parallel()
	const gib = int64(1) << 30
	for _, c := range []struct {
		used, quota int64
		tone        homeapi.DecisionItemTone
		percent     string
	}{
		{86 * gib, 100 * gib, homeapi.Warn, "86"},
		{999 * gib / 10, 100 * gib, homeapi.Warn, "100"},
		{100 * gib, 100 * gib, homeapi.Danger, "100"},
		{120 * gib, 100 * gib, homeapi.Danger, "120"},
	} {
		got := one(t, storageCard(tenant, c.used, c.quota))
		want := map[string]string{"percent": c.percent, "usedBytes": strconv.FormatInt(c.used, 10), "quotaBytes": strconv.FormatInt(c.quota, 10)}
		if got.Kind != "tenant.storage_high" || got.Key != "tenant.storage_high:"+tenant.String() || got.ModuleKey != "billing" ||
			got.Tone != c.tone || !maps.Equal(got.Params, want) {
			t.Errorf("%d of %d: %+v, want %s %v", c.used, c.quota, got, c.tone, want)
		}
	}
	for _, c := range [][2]int64{{85 * gib, 100 * gib}, {0, 100 * gib}, {gib, 0}} {
		if got := storageCard(tenant, c[0], c[1]); len(got) != 0 {
			t.Errorf("%d of %d: %+v, want no card", c[0], c[1], got)
		}
	}
}

// «N сотрудников без роли»: count and the names joined as MSW does (the example: three names); the count is that of
// all the members without a role, also beyond the names on the card; nobody — no card.
func TestMembersCard(t *testing.T) {
	t.Parallel()
	got := one(t, membersCard(tenant, 3, []string{"Марина Котова", "Вера Котельникова", "Тимур Ахмедов"}))
	want := map[string]string{"count": "3", "names": "Марина Котова, Вера Котельникова, Тимур Ахмедов"}
	if got.Kind != "access.members_without_role" || got.Key != "access.members_without_role:"+tenant.String() ||
		got.ModuleKey != "members" || got.Tone != homeapi.Neutral || !maps.Equal(got.Params, want) {
		t.Errorf("card %+v, want %v", got, want)
	}
	bounded := one(t, membersCard(tenant, 201, []string{"Марина Котова"}))
	if want := map[string]string{"count": "201", "names": "Марина Котова"}; !maps.Equal(bounded.Params, want) {
		t.Errorf("count beyond the names: %v, want %v", bounded.Params, want)
	}
	if got := membersCard(tenant, 0, nil); len(got) != 0 {
		t.Errorf("nobody: %+v, want no card", got)
	}
}

type subs struct {
	sub Subscription
	err error
}

func (s subs) Subscription(context.Context, uuid.UUID) (Subscription, error) { return s.sub, s.err }

// The cards are the owner's (S2-18 п. 1, MSW: only the owner): a member who is not the owner gets none and the
// source reads nothing — the subscription, the control DB and the tenant DB are not asked.
func TestOnlyTheOwner(t *testing.T) {
	t.Parallel()
	items, err := Source{}.Cards(t.Context(), home.Query{Tenant: tenantctx.TenantContext{TenantID: tenant}, Now: now})
	if err != nil || len(items) != 0 {
		t.Fatalf("member: %+v %v, want no cards", items, err)
	}
	down := errors.New("control DB down")
	owner := home.Query{Tenant: tenantctx.TenantContext{TenantID: tenant, Owner: true}, Now: now}
	if _, err := (Source{Subscriptions: subs{err: down}}).Cards(t.Context(), owner); !errors.Is(err, down) {
		t.Fatalf("owner with the subscription down: %v, want %v", err, down)
	}
}
