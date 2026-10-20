package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Control-миграции контрактного PR 6 этапа 4 (W4.07, 0.8.0-stage4; номера стюарда — api/README.md «Номера
// миграций»): тарифная сетка и заявки на тариф (0007), файлы оформления (0008). Up создаёт объекты шага, Down
// снимает ровно их, без cascade и без удаления строк.
func TestControlW407Migrations(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		file    string
		up      []string
		down    []string
		downNot []string
	}{
		{
			name: "0007 тарифная сетка и заявки на тариф",
			file: "0007_billing_requests_price_book.sql",
			up: []string{
				// Отмена запланированной версии; EXCLUDE — только по действующим (неотменённым) версиям.
				`alter table price_book_versions`,
				`add column cancelled_at\s+timestamptz`,
				`add column cancelled_by\s+uuid references platform_operators\(id\)`,
				`add constraint price_book_versions_cancel_chk check \(\(cancelled_at is null\) = \(cancelled_by is null\)\)`,
				`drop constraint price_book_versions_effective_excl`,
				`add constraint price_book_versions_effective_excl exclude using gist \(effective with &&\) where \(cancelled_at is null\)`,
				// Название ступени уникально в версии без учёта регистра.
				`create unique index price_tiers_name_uq on price_tiers \(version, lower\(name\)\)`,
				// Заявка: номер SR-N из последовательности, расчёт, отмена владельцем, срок применения, ревизия.
				`create sequence subscription_request_number_seq`,
				`alter column number set default 'SR-' \|\| nextval\('subscription_request_number_seq'\)`,
				`add constraint scr_number_chk check \(number ~ '\^SR-\[1-9\]\[0-9\]\{0,8\}\$'\)`,
				`add column monthly_minor\s+bigint`,
				`add column saving_minor\s+bigint`,
				`add column discount_pct\s+numeric\(4,1\)`,
				`add constraint scr_quote_chk check \(\(quoted_minor is null\) = \(monthly_minor is null\)\)`,
				`add column cancelled_at\s+timestamptz`,
				`add column cancelled_by\s+uuid references memberships\(id\)`,
				`add constraint scr_cancel_chk check \(\(status = 'cancelled'\) = \(cancelled_at is not null\)\)`,
				`add column effective_at\s+timestamptz`,
				`add column applied_at\s+timestamptz`,
				`add constraint scr_effective_chk check \(\(status = 'approved'\) = \(effective_at is not null\)\)`,
				`add constraint scr_applied_chk check \(applied_at is null or status = 'approved'\)`,
				`add column revision\s+integer not null default 1`,
				// Возврат 2: автор и отменивший заявку — участники той же организации (составной ключ участия).
				`alter table memberships\s+add constraint memberships_tenant_id_uq unique \(tenant_id, id\)`,
				`add constraint scr_requested_by_tenant_fk foreign key \(tenant_id, requested_by\) references memberships \(tenant_id, id\)`,
				`add constraint scr_cancelled_by_tenant_fk foreign key \(tenant_id, cancelled_by\) references memberships \(tenant_id, id\)`,
				// Операторы: причина отключения и ревизия (If-Match updatePlatformOperator).
				`alter table platform_operators`,
				`add column disabled_reason\s+text`,
				// Снимки использования для «Использования» (только метаданные).
				`create table tenant_usage_daily \(`,
				`primary key \(tenant_id, day\)`,
				`check \(active_members_7d <= active_members\)`,
			},
			down: []string{
				`drop table tenant_usage_daily;`,
				`drop column disabled_reason`,
				`drop constraint scr_effective_chk`,
				`drop constraint scr_cancelled_by_tenant_fk`,
				`drop constraint scr_requested_by_tenant_fk`,
				`alter table memberships\s+drop constraint memberships_tenant_id_uq;`,
				`drop column cancelled_by`,
				`drop sequence subscription_request_number_seq;`,
				`drop index price_tiers_name_uq;`,
				`add constraint price_book_versions_effective_excl exclude using gist \(effective with &&\)`,
				`drop column cancelled_at`,
			},
			downNot: []string{`delete from`},
		},
		{
			name: "0008 файлы оформления",
			file: "0008_branding_assets.sql",
			up: []string{
				`create table branding_assets \(`,
				`kind\s+text not null check \(kind in \('logo', 'mark'\)\)`,
				`content_type\s+text not null check \(content_type in \('image/png', 'image/svg\+xml', 'image/jpeg', 'image/webp'\)\)`,
				`size_bytes\s+integer not null check \(size_bytes between 1 and 1048576\)`,
				`sha256\s+bytea not null check \(length\(sha256\) = 32\)`,
				`uploaded_by\s+uuid not null references accounts\(id\)`,
				// Возврат 1: ссылка версии — на файл своей организации и своего вида (логотип — logo, знак — mark).
				`unique \(tenant_id, id, kind\)`,
				`add column logo_kind\s+text generated always as \('logo'\) stored`,
				`add column mark_kind\s+text generated always as \('mark'\) stored`,
				`add constraint tenant_branding_versions_logo_fk foreign key \(tenant_id, logo_file, logo_kind\) references branding_assets \(tenant_id, id, kind\)`,
				`add constraint tenant_branding_versions_mark_fk foreign key \(tenant_id, mark_file, mark_kind\) references branding_assets \(tenant_id, id, kind\)`,
				`alter column created_by drop not null`,
				`add column created_by_account\s+uuid references accounts\(id\)`,
				`add constraint tenant_branding_versions_author_chk check \(created_by is not null or created_by_account is not null\)`,
				// Возврат 1: представление 0003 раскрыло * при создании — пересоздаётся с новыми колонками.
				`create or replace view tenant_branding_current as\s+select distinct on \(tenant_id\) \* from tenant_branding_versions order by tenant_id, version desc;`,
			},
			down: []string{
				`drop view tenant_branding_current;`,
				`drop constraint tenant_branding_versions_author_chk`,
				`drop column created_by_account`,
				`alter column created_by set not null`,
				`drop constraint tenant_branding_versions_logo_fk`,
				`drop column logo_kind`,
				`drop column mark_kind`,
				`create view tenant_branding_current as\s+select distinct on \(tenant_id\) \* from tenant_branding_versions order by tenant_id, version desc;`,
				`drop table branding_assets;`,
			},
			downNot: []string{`delete from`},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Control, tt.file)
			wantHeader := "-- W4.07 · control " + tt.file[:4] + " · "
			if !strings.HasPrefix(text, wantHeader) {
				t.Errorf("first line must start with %q", wantHeader)
			}
			up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
			for _, re := range tt.up {
				if !regexp.MustCompile(re).MatchString(up) {
					t.Errorf("Up lacks /%s/", re)
				}
			}
			for _, re := range tt.down {
				if !regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down lacks /%s/", re)
				}
			}
			for _, re := range tt.downNot {
				if regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down must not contain /%s/", re)
				}
			}
			if strings.Contains(down, "cascade") {
				t.Error("Down must not use cascade")
			}
		})
	}
}
