-- W4.06 · tenant 0022 · сохранённые виды и выгрузка заданием «Данных» (контракт 0.7.0-stage4, W4.50).
-- Номер выдал стюард контрактного PR 5 этапа 4 (W4.06; план v2 §3.5, PD-59); при вливании после других контрактных
-- PR этапа 4 файл переименовывается в следующий свободный номер (интегратор).
-- Схема data — модуль «Данные» (10-data-model: модуль пишет только в свою схему). Вид (DatasetView) хранит
-- спецификацию выборки, не строки (DATA-03): личный — уникальное имя у автора и набора, общий — у набора (без
-- регистра). Задание выгрузки (DatasetExportJob, 07-ux-and-data §3) — строка журнала: спецификация, подписи колонок,
-- версии схемы и прав, пояс (имя IANA), автор; снимок, файл (ключ хранилища — только у сервера), срок 24 ч, сбой, отзыв.
-- Журнал не удаляется вместе с видом (view_id → null). Готовое задание — только с файлом, сбой — с кодом, отзыв — с
-- причиной и моментом; при отзыве и истечении файл удаляется (object_key → null).
-- +goose Up
create schema if not exists data;

create table data.saved_views (
  id             uuid primary key default gen_random_uuid(),
  dataset_id     text not null check (dataset_id ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  name           text not null check (length(btrim(name)) between 1 and 120),
  visibility     text not null default 'personal' check (visibility in ('personal', 'shared')),
  owner_id       uuid not null references people.person_profiles (id),
  query          jsonb not null check (jsonb_typeof(query) = 'object'),
  schema_version text not null,
  revision       integer not null default 1 check (revision >= 1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index saved_views_personal_name on data.saved_views (owner_id, dataset_id, lower(name))
  where visibility = 'personal';
create unique index saved_views_shared_name on data.saved_views (dataset_id, lower(name))
  where visibility = 'shared';
create index saved_views_dataset_idx on data.saved_views (dataset_id, owner_id);

create table data.export_jobs (
  id                 uuid primary key default gen_random_uuid(),
  dataset_id         text not null check (dataset_id ~ '^[a-z][a-z0-9_.-]{1,99}$'),
  dataset_name       text not null check (length(dataset_name) between 1 and 200),
  view_id            uuid references data.saved_views (id) on delete set null,
  requested_by       uuid not null references people.person_profiles (id),
  state              text not null default 'queued'
    check (state in ('queued', 'running', 'ready', 'failed', 'expired', 'revoked')),
  spec               jsonb not null check (jsonb_typeof(spec) = 'object'),
  column_labels      text[] not null check (cardinality(column_labels) between 1 and 100),
  schema_version     text not null,
  permission_version text not null,
  time_zone          text not null,
  row_limit          integer not null default 100000 check (row_limit between 1 and 100000),
  snapshot_at        timestamptz,
  row_count          integer check (row_count between 0 and 100000),
  truncated          boolean,
  file_name          text check (file_name is null or length(file_name) between 1 and 255),
  object_key         text,
  size_bytes         bigint check (size_bytes >= 0),
  failure_code       text check (failure_code in ('timeout', 'too_large', 'source_unavailable', 'internal')),
  revoke_reason      text check (revoke_reason in ('author', 'owner', 'permissions_changed', 'module_disabled')),
  revoked_by         uuid,
  attempts           integer not null default 0 check (attempts >= 0),
  revision           integer not null default 1 check (revision >= 1),
  created_at         timestamptz not null default now(),
  started_at         timestamptz,
  finished_at        timestamptz,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  constraint export_jobs_ready check (
    state <> 'ready' or (snapshot_at is not null and row_count is not null and truncated is not null
      and file_name is not null and object_key is not null and size_bytes is not null
      and finished_at is not null and expires_at is not null)),
  constraint export_jobs_failed check ((state = 'failed') = (failure_code is not null)),
  constraint export_jobs_revoked check ((state = 'revoked') = (revoke_reason is not null and revoked_at is not null)),
  constraint export_jobs_time_zone check (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$')
);
create index export_jobs_requester_idx on data.export_jobs (requested_by, created_at desc, id desc);
create index export_jobs_journal_idx on data.export_jobs (created_at desc, id desc);
create index export_jobs_active_idx on data.export_jobs (state, created_at)
  where state in ('queued', 'running');
create index export_jobs_expiry_idx on data.export_jobs (expires_at) where state = 'ready';

-- +goose Down
drop table data.export_jobs;
drop table data.saved_views;
drop schema data;
