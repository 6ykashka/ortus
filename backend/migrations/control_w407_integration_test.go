//go:build integration

package migrations_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// control 0007–0008 (W4.07) на реальном сервере под runtime-ролью API: отменённая версия сетки не занимает период,
// название ступени уникально в версии, номер заявки SR-N из последовательности, одна открытая заявка, отмена
// владельцем и срок применения одобрения, снимки использования; файлы оформления своей организации.
func TestControlW407Constraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Control)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		exec := func(q string, args ...any) error {
			_, err := db.ExecContext(ctx, q, args...)
			return err
		}
		must := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Fatalf("%s: %v", what, err)
			}
		}
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}
		account := func(sub string) string {
			return scalar[string](t, db, `insert into accounts (issuer, subject, email_norm, display_name)
				values ('test', $1, $1 || '@ortus.example', $1) returning id::text`, sub)
		}

		op := scalar[string](t, db, `insert into platform_operators (account_id, role, status)
			values ($1, 'admin', 'active') returning id::text`, account("op"))
		tenant := scalar[string](t, db, `insert into tenants (slug, display_name, industry_pack)
			values ('lotos', 'SPA «Лотос»', 'spa') returning id::text`)
		other := scalar[string](t, db, `insert into tenants (slug, display_name, industry_pack)
			values ('alta', 'Альта Групп', 'spa') returning id::text`)
		owner := account("owner")
		member := scalar[string](t, db, `insert into memberships (tenant_id, account_id, status, person_profile_id)
			values ($1, $2, 'active', $3) returning id::text`, tenant, owner, uuid.NewString())

		// Тарифная сетка: v1 действует, v2 запланирована и отменена — v3 на тот же период проходит EXCLUDE.
		must("v1", exec(`insert into price_book_versions (version, effective, note, published_by)
			values (1, tstzrange('2026-06-01', '2026-11-01'), 'Стартовая сетка', $1)`, op))
		must("v1 tier", exec(`insert into price_tiers (version, tier_code, name, seats_limit, month_minor, sort)
			values (1, 'team', 'Команда', 25, 890000, 1)`))
		wantState("same tier name in another case", exec(`insert into price_tiers
			(version, tier_code, name, seats_limit, month_minor, sort) values (1, 'team2', 'КОМАНДА', 30, 990000, 2)`),
			"23505")
		must("v2", exec(`insert into price_book_versions (version, effective, note, published_by)
			values (2, tstzrange('2026-11-01', null), 'Новая', $1)`, op))
		wantState("cancel without author", exec(`update price_book_versions set cancelled_at = now() where version = 2`),
			"23514")
		must("cancel v2", exec(`update price_book_versions set cancelled_at = now(), cancelled_by = $1 where version = 2`, op))
		must("v3 over the cancelled v2", exec(`insert into price_book_versions (version, effective, note, published_by)
			values (3, tstzrange('2026-11-01', null), 'Другая', $1)`, op))
		wantState("v4 over v3 in force", exec(`insert into price_book_versions (version, effective, note, published_by)
			values (4, tstzrange('2026-12-01', null), 'Ещё', $1)`, op), "23P01")

		// Заявка: номер из последовательности, формат SR-N, расчёт целиком или без него, одна открытая.
		req := func(tenantID string) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into subscription_change_requests
				(tenant_id, to_tier, term_months, price_version, quoted_minor, monthly_minor, saving_minor, discount_pct,
				 seats_used, requested_by)
				values ($1, 'team', 12, 1, 8544000, 712000, 2136000, 20, 23, $2) returning id::text`,
				tenantID, member).Scan(&id)
			return id, err
		}
		first, err := req(tenant)
		must("request", err)
		if n := scalar[string](t, db, `select number from subscription_change_requests where id = $1`, first); n[:3] != "SR-" {
			t.Errorf("number %q, want SR-N", n)
		}
		_, err = req(tenant)
		wantState("second pending request", err, "23505")
		wantState("number format", exec(`update subscription_change_requests set number = 'SR-000021' where id = $1`, first),
			"23514")
		wantState("half a quote", exec(`update subscription_change_requests set monthly_minor = null where id = $1`, first),
			"23514")
		wantState("cancelled without the moment", exec(`update subscription_change_requests set status = 'cancelled'
			where id = $1`, first), "23514")
		// Возврат 2: отменить и подать заявку может только участник её организации — участие другой не встаёт.
		stranger := scalar[string](t, db, `insert into memberships (tenant_id, account_id, status, person_profile_id)
			values ($1, $2, 'active', $3) returning id::text`, other, account("stranger"), uuid.NewString())
		wantState("cancelled by a member of another tenant", exec(`update subscription_change_requests
			set status = 'cancelled', cancelled_at = now(), cancelled_by = $2 where id = $1`, first, stranger), "23503")
		wantState("requested by a member of another tenant", exec(`insert into subscription_change_requests
			(tenant_id, to_tier, term_months, price_version, seats_used, requested_by)
			values ($1, 'team', 12, 1, 3, $2)`, other, member), "23503")
		must("owner cancels", exec(`update subscription_change_requests set status = 'cancelled', cancelled_at = now(),
			cancelled_by = $2, revision = revision + 1 where id = $1`, first, member))
		second, err := req(tenant)
		must("new request after the cancel", err)
		wantState("approved without effective_at", exec(`update subscription_change_requests set status = 'approved',
			decided_by = $2, decided_at = now() where id = $1`, second, op), "23514")
		wantState("applied before approval", exec(`update subscription_change_requests set applied_at = now()
			where id = $1`, second), "23514")
		must("approved downgrade from the period end", exec(`update subscription_change_requests set status = 'approved',
			decided_by = $2, decided_at = now(), effective_at = now() + interval '30 days' where id = $1`, second, op))

		// Операторы: причина отключения и ревизия.
		must("disable with a reason", exec(`update platform_operators set status = 'disabled', disabled_at = now(),
			disabled_by = $1, disabled_reason = 'Перевод в другой отдел', revision = revision + 1 where id = $1`, op))

		// Снимки использования: 7 дней не больше активных, один снимок в день.
		snap := `insert into tenant_usage_daily (tenant_id, day, seats_used, seats_limit, storage_used_bytes,
			storage_quota_bytes, active_members, active_members_7d) values ($1, '2026-10-01', 23, 25, 1, 2, $2, $3)`
		wantState("7 days above active", exec(snap, tenant, 3, 4), "23514")
		must("snapshot", exec(snap, tenant, 23, 12))
		wantState("second snapshot of the day", exec(snap, tenant, 23, 12), "23505")

		// Оформление: файл своей организации, автор версии — аккаунт.
		asset := func(tenantID, kind string) string {
			return scalar[string](t, db, `insert into branding_assets (tenant_id, kind, content_type, size_bytes, sha256,
				storage_key, width, height, uploaded_by) values ($1, $2, 'image/png', 48213, sha256('x'::bytea),
				'brand-assets/x.png', 512, 512, $3) returning id::text`, tenantID, kind, owner)
		}
		mark := asset(tenant, "mark")
		logo := asset(tenant, "logo")
		foreign := asset(other, "logo")
		wantState("asset above 1 MiB", exec(`insert into branding_assets (tenant_id, kind, content_type, size_bytes,
			sha256, storage_key, uploaded_by) values ($1, 'logo', 'image/png', 1048577, sha256('y'::bytea), 'k', $2)`,
			tenant, owner), "23514")
		version := `insert into tenant_branding_versions (tenant_id, version, display_name, accent_hex, accent_used,
			logo_file, mark_file, created_by, created_by_account) values ($1, $2, 'SPA «Лотос»', '#C9A227', '#A3831F',
			$3, $4, $5, $6)`
		wantState("logo of another tenant", exec(version, tenant, 2, foreign, nil, nil, owner), "23503")
		// Возврат 1: вид файла держит БД — логотип не встаёт знаком, знак — логотипом.
		wantState("logo file as the mark", exec(version, tenant, 2, nil, logo, nil, owner), "23503")
		wantState("mark file as the logo", exec(version, tenant, 2, mark, nil, nil, owner), "23503")
		wantState("version without an author", exec(version, tenant, 2, nil, mark, nil, nil), "23514")
		must("version by the owner account", exec(version, tenant, 2, logo, mark, nil, owner))
		// Возврат 1: действующая версия из представления 0003 несёт автора-аккаунт (* раскрыт при создании).
		if got := scalar[string](t, db, `select coalesce(created_by_account::text, '') from tenant_branding_current
			where tenant_id = $1`, tenant); got != owner {
			t.Errorf("tenant_branding_current.created_by_account = %q, want %s", got, owner)
		}
	})
}
