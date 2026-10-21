//go:build integration

package main

import (
	"database/sql"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// W4.60: сид дважды — сетка v1 (архив) и v2 (действует) от Лаптевой, условия периода подписок, заявка SR-12 «Лотоса»
// (следующая заявка — SR-13), оформление «Лотоса» v3, «Ремстроя» v1 и «Карго» v2, снимки использования, заметка
// отключённого оператора; всё читается сервисами под ролью ortus_api.
func TestSeedBilling(t *testing.T) { //nolint:paralleltest // fixed tenant DB names (stand_integration_test.go)
	ctl := cluster.NewDatabase(t, "ctl_billing")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, ctl, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	for pass := 1; pass <= 2; pass++ {
		if code, out, errOut := runSeed(t, seedEnv(ctl)); code != exitOK {
			t.Fatalf("pass %d: code %d\nstdout: %s\nstderr: %s", pass, code, out, errOut)
		}
	}
	api := cluster.DB(t, ctl, migrations.RoleAPI)
	now := func() time.Time { return time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC) }
	store := billing.Store{DB: api, Subs: subscriptions.Store{DB: api, Now: now}, Now: now}
	checkPriceBook(t, store)
	checkTermsAndRequests(t, store)
	checkBrands(t, api)
	super := cluster.DB(t, ctl, migratetest.Super)
	for q, want := range map[string]int{
		`select count(*) from tenant_usage_daily`: 4,
		`select count(*) from platform_operators where disabled_reason = 'Отключён 15.08: перевод в другой отдел'`: 1,
		`select nextval('subscription_request_number_seq')::int`:                                                   13,
	} {
		if got := count(t, super, q); got != want {
			t.Errorf("%s = %d, want %d", q, got, want)
		}
	}
}

func checkPriceBook(t *testing.T, store billing.Store) {
	t.Helper()
	vs, err := store.Versions(t.Context(), true)
	if err != nil {
		t.Fatal(err)
	}
	type view struct {
		number, tiers, terms int
		state, by            string
	}
	var got []view
	for _, v := range vs {
		got = append(got, view{v.Number, len(v.Tiers), len(v.Terms), v.State(store.Now()), v.PublishedBy.DisplayName})
	}
	eqSeed(t, "versions", got, []view{{2, 5, 4, "current", "Евгения Лаптева"}, {1, 4, 4, "archived", "Евгения Лаптева"}})
}

func checkTermsAndRequests(t *testing.T, store billing.Store) {
	t.Helper()
	ctx := t.Context()
	got := map[string][3]any{}
	for _, proto := range []string{protoAlta, protoLotos, protoRemstroy, protoCargo} {
		sub, err := store.Subs.Current(ctx, seedID(scopePlatform, proto))
		if err != nil {
			t.Fatal(err)
		}
		terms, err := store.Terms(ctx, sub)
		if err != nil {
			t.Fatal(err)
		}
		var period int64
		if terms.PeriodMinor != nil {
			period = *terms.PeriodMinor
		}
		got[proto] = [3]any{sub.PlanKey, terms.TierName, period}
	}
	eqSeed(t, "terms", got, map[string][3]any{
		protoAlta: {"start", "Старт", int64(390000)}, protoLotos: {"team", "Команда", int64(8160000)},
		protoRemstroy: {"start", "Старт", int64(350000)}, protoCargo: {"team", "Команда", int64(3230000)},
	})
	page, err := store.Requests(ctx, billing.RequestQuery{Actor: seedID(scopePlatform, "account:op-1"), Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(page.Items))
	for _, r := range page.Items {
		ids = append(ids, r.ID.String()+" "+r.Number+" "+r.Status+" "+r.RequestedBy.DisplayName)
	}
	eqSeed(t, "requests", [2]any{ids, page.PendingCount},
		[2]any{[]string{"d5748522-e6b8-5df4-8a9f-1cbdfef46ed3 SR-12 pending Ирина Белова"}, 1})
}

func checkBrands(t *testing.T, api *sql.DB) {
	t.Helper()
	svc := branding.Service{Control: api}
	ids := []uuid.UUID{}
	for _, proto := range []string{protoAlta, protoLotos, protoRemstroy, protoCargo} {
		ids = append(ids, seedID(scopePlatform, proto))
	}
	marks, err := svc.Marks(t.Context(), ids)
	if err != nil {
		t.Fatal(err)
	}
	got := []branding.Mark{}
	for _, id := range ids {
		got = append(got, marks[id])
	}
	eqSeed(t, "marks", got, []branding.Mark{{AccentUsed: "#1F6B52"}, {ShortName: "Лотос", AccentUsed: "#7A3E79"},
		{ShortName: "Ремстрой", AccentUsed: "#9A4A1F"}, {ShortName: "Карго", AccentUsed: "#2B5479"}})
	lotos, err := svc.Current(t.Context(), ids[1])
	if err != nil {
		t.Fatal(err)
	}
	eqSeed(t, "Лотос", [4]any{lotos.Version, lotos.UpdatedBy.DisplayName, lotos.UpdatedAt.UTC().Format(time.RFC3339), lotos.Terms["visit"].Many},
		[4]any{3, "Ирина Белова", "2026-09-24T09:10:00Z", "сеансов"})
	cargo, err := svc.Current(t.Context(), ids[3])
	if err != nil {
		t.Fatal(err)
	}
	eqSeed(t, "Карго", [3]any{cargo.Version, cargo.PoweredBy, cargo.UpdatedBy.DisplayName}, [3]any{2, false, "Денис Шишкин"})
	if !slices.Equal(lotos.Menu.Order, []string{}) {
		t.Errorf("menu order %v", lotos.Menu.Order)
	}
}
