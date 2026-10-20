-- W4.07 · control 0008 · файлы оформления (логотип и знак), ссылки версии на них, автор версии — аккаунт
-- +goose Up
-- Номер выдан стюардом контракта этапа 4 (api/README.md «Номера миграций», PD-59). Контракт 0.8.0-stage4:
-- uploadBrandingAsset, updateTenantBranding (design/docs/18-branding.md «Что можно менять», «Заметки по реализации»).

-- Файл оформления: байты — в публичном хранилище объектов по адресу содержимого (storage_key), здесь — метаданные.
-- Файлы оформления не входят в квоту места организации. Файл без ссылки из версий удаляется через 24 часа.
create table branding_assets (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  kind         text not null check (kind in ('logo', 'mark')),
  content_type text not null check (content_type in ('image/png', 'image/svg+xml', 'image/jpeg', 'image/webp')),
  size_bytes   integer not null check (size_bytes between 1 and 1048576),
  sha256       bytea not null check (length(sha256) = 32),
  storage_key  text not null check (length(storage_key) between 1 and 512),
  width        integer check (width is null or width > 0),
  height       integer check (height is null or height > 0),
  uploaded_by  uuid not null references accounts(id),
  created_at   timestamptz not null default now(),
  unique (tenant_id, id, kind)
);
create index branding_assets_created_idx on branding_assets (created_at);

-- Версия ссылается только на файлы своей организации и своего вида: логотип — файл kind = 'logo', знак — 'mark'
-- (вид — постоянные вычисляемые колонки в составном FK; null файла FK не проверяет). Автор версии — аккаунт владельца
-- (created_by_account: членство 0003 кончается, аккаунт остаётся в журнале); хотя бы одно из created_by и
-- created_by_account задано.
alter table tenant_branding_versions
  add column logo_kind text generated always as ('logo') stored,
  add column mark_kind text generated always as ('mark') stored,
  add constraint tenant_branding_versions_logo_fk foreign key (tenant_id, logo_file, logo_kind) references branding_assets (tenant_id, id, kind),
  add constraint tenant_branding_versions_mark_fk foreign key (tenant_id, mark_file, mark_kind) references branding_assets (tenant_id, id, kind),
  alter column created_by drop not null,
  add column created_by_account uuid references accounts(id),
  add constraint tenant_branding_versions_author_chk check (created_by is not null or created_by_account is not null);

-- Представление 0003 объявлено как «select … *», а Postgres раскрывает * при создании: без пересоздания в нём нет
-- новых колонок (автора-аккаунта). Новые колонки — в конце таблицы, поэтому create or replace допустим.
create or replace view tenant_branding_current as
  select distinct on (tenant_id) * from tenant_branding_versions order by tenant_id, version desc;
-- +goose Down
-- Версию, автор которой — только аккаунт, не вернуть под NOT NULL created_by: Down не удаляет такие версии, а падает
-- на set not null и откатывается целиком (сначала перенесите автора в created_by вручную). Представление зависит от
-- снимаемых колонок: оно снимается и создаётся заново по определению 0003.
drop view tenant_branding_current;
alter table tenant_branding_versions
  drop constraint tenant_branding_versions_author_chk,
  drop column created_by_account,
  alter column created_by set not null,
  drop constraint tenant_branding_versions_mark_fk,
  drop constraint tenant_branding_versions_logo_fk,
  drop column mark_kind,
  drop column logo_kind;
create view tenant_branding_current as
  select distinct on (tenant_id) * from tenant_branding_versions order by tenant_id, version desc;
drop index branding_assets_created_idx;
drop table branding_assets;
