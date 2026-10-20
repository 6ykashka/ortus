-- W4.07 · control 0007 · тарифная сетка и заявки на тариф (шаг 4.6): отмена версии, номер SR-N, расчёт, отмена владельцем, снимки использования
-- +goose Up
-- Номер выдан стюардом контракта этапа 4 (api/README.md «Номера миграций», PD-59). Контракт 0.8.0-stage4:
-- publishPriceBookVersion, cancelPriceBookVersion, create/cancelSubscriptionChangeRequest,
-- decidePlatformSubscriptionRequest, updatePlatformOperator, getPlatformUsage (design/docs/17-users-and-billing.md).

-- Запланированную версию можно отменить до начала: строка остаётся для журнала, период не занимает.
alter table price_book_versions
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references platform_operators(id),
  add constraint price_book_versions_cancel_chk check ((cancelled_at is null) = (cancelled_by is null));
alter table price_book_versions
  drop constraint price_book_versions_effective_excl,
  add constraint price_book_versions_effective_excl exclude using gist (effective with &&) where (cancelled_at is null);

-- Название ступени уникально в версии без учёта регистра («Названия ступеней не должны повторяться»).
create unique index price_tiers_name_uq on price_tiers (version, lower(name));

-- Заявка: человеческий номер SR-N, расчёт на момент заявки целиком (месяц, период, выгода, скидка), отмена
-- владельцем (до решения оператора), срок применения одобрения (повышение — сразу, понижение — с конца
-- оплаченного периода), момент применения и ревизия.
create sequence subscription_request_number_seq;
alter table subscription_change_requests
  alter column number set default 'SR-' || nextval('subscription_request_number_seq'),
  add constraint scr_number_chk check (number ~ '^SR-[1-9][0-9]{0,8}$'),
  add column monthly_minor bigint check (monthly_minor is null or monthly_minor > 0),
  add column saving_minor  bigint check (saving_minor is null or saving_minor >= 0),
  add column discount_pct  numeric(4,1) check (discount_pct is null or (discount_pct >= 0 and discount_pct < 50)),
  add constraint scr_quote_chk check ((quoted_minor is null) = (monthly_minor is null)),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references memberships(id),
  add constraint scr_cancel_chk check ((status = 'cancelled') = (cancelled_at is not null)),
  add constraint scr_cancel_by_chk check ((cancelled_at is null) = (cancelled_by is null)),
  add column effective_at timestamptz,
  add column applied_at   timestamptz,
  add constraint scr_effective_chk check ((status = 'approved') = (effective_at is not null)),
  add constraint scr_applied_chk check (applied_at is null or status = 'approved'),
  add column revision integer not null default 1 check (revision > 0);
-- Автор и отменивший заявку — участники той же организации (возврат 2 W4.07): составной ключ участия. Ссылка
-- на memberships(id) из 0002 остаётся, составная добавляет проверку организации (NULL cancelled_by не проверяется).
alter table memberships
  add constraint memberships_tenant_id_uq unique (tenant_id, id);
alter table subscription_change_requests
  add constraint scr_requested_by_tenant_fk foreign key (tenant_id, requested_by) references memberships (tenant_id, id),
  add constraint scr_cancelled_by_tenant_fk foreign key (tenant_id, cancelled_by) references memberships (tenant_id, id);
-- Очередь оператора и история заявок организации.
create index scr_tenant_requested_idx on subscription_change_requests (tenant_id, requested_at desc);
create index scr_requested_idx on subscription_change_requests (requested_at desc);

-- Операторы платформы: заметка отключённого оператора и ревизия строки (If-Match updatePlatformOperator).
alter table platform_operators
  add column disabled_reason text check (disabled_reason is null or length(disabled_reason) <= 500),
  add column revision integer not null default 1 check (revision > 0);

-- Снимки использования для «Использования» (только метаданные control DB, без содержимого организаций):
-- один снимок в день на организацию; динамика по месяцам — из этой таблицы.
create table tenant_usage_daily (
  tenant_id           uuid not null references tenants(id),
  day                 date not null,
  seats_used          integer not null check (seats_used >= 0),
  seats_limit         integer check (seats_limit is null or seats_limit > 0),   -- null = безлимит
  storage_used_bytes  bigint not null check (storage_used_bytes >= 0),
  storage_quota_bytes bigint not null check (storage_quota_bytes >= 0),
  active_members      integer not null check (active_members >= 0),
  active_members_7d   integer not null check (active_members_7d >= 0),
  measured_at         timestamptz not null default now(),
  primary key (tenant_id, day),
  check (active_members_7d <= active_members)
);
create index tenant_usage_daily_day_idx on tenant_usage_daily (day);
-- +goose Down
-- Down не удаляет строки: отменённые версии, период которых пересекается с действующими, не вернуть под EXCLUDE без
-- условия — Down падает на add constraint и откатывается целиком (сначала удалите отменённые версии вручную).
drop table tenant_usage_daily;
alter table platform_operators
  drop column revision,
  drop column disabled_reason;
drop index scr_requested_idx;
drop index scr_tenant_requested_idx;
alter table subscription_change_requests
  drop constraint scr_cancelled_by_tenant_fk,
  drop constraint scr_requested_by_tenant_fk;
alter table memberships
  drop constraint memberships_tenant_id_uq;
alter table subscription_change_requests
  drop column revision,
  drop constraint scr_applied_chk,
  drop constraint scr_effective_chk,
  drop column applied_at,
  drop column effective_at,
  drop constraint scr_cancel_by_chk,
  drop constraint scr_cancel_chk,
  drop column cancelled_by,
  drop column cancelled_at,
  drop constraint scr_quote_chk,
  drop column discount_pct,
  drop column saving_minor,
  drop column monthly_minor,
  drop constraint scr_number_chk,
  alter column number drop default;
drop sequence subscription_request_number_seq;
drop index price_tiers_name_uq;
alter table price_book_versions
  drop constraint price_book_versions_effective_excl,
  add constraint price_book_versions_effective_excl exclude using gist (effective with &&);
alter table price_book_versions
  drop constraint price_book_versions_cancel_chk,
  drop column cancelled_by,
  drop column cancelled_at;
