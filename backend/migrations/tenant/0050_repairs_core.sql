-- W6.00 · tenant 0050 · «Ремонт и стройка», ядро (контракт 0.12.0-stage6, W6.11): схема repairs — объекты, бригада, работы, отметки, допработы, лента.
-- Номер выдал стюард контрактного PR этапа 6 (W6.00; план v2 §3.5, PD-59) — первый номер блока 0050–0059. Разбор
-- docs/plan/v2/analysis/dor/repair.md §2.1 (Q-W4.00-repair-1, -2, -3, -5, -14, -16, -21), design/docs/19-construction.md.
-- Сущность — repairs.projects (RS-08: RepairProject, в интерфейсе «Объект»). Объект-черновик (status draft) создаётся из
-- заявки на этапе «Замер» (lead_task_id — задача модуля «Задачи», без внешнего ключа: модуль пишет только в свою схему),
-- у него нет прораба; handed_over — сдан (дата сдачи обязательна, гарантия — warranty_until). Сумма договора
-- (budget_minor) и телефон заказчика отдаются только с repairs.finance.read. Бригада — карточки без входа (repairs.workers,
-- не занимают место). Работа объекта — план и принятый факт; факт растёт только приёмкой отметки (fact_qty). Отметка
-- прораба: одна работа — одна строка с объёмом, ≥ 1 фото (uuid файлов files.objects, без внешнего ключа — массив),
-- материалы из справочника расценок (jsonb), номер WL-n из последовательности тенанта; принята или возвращена
-- (reviewed_by обязателен вне «На проверке»). Допработа ДР-n — номер внутри объекта, ≥ 1 фото, отказ — с причиной из
-- четырёх. Лента объекта — журнал событий (только INSERT, roles/grants.sql).
-- +goose Up
create schema if not exists repairs;

create table repairs.projects (
  id               uuid primary key default gen_random_uuid(),
  org_unit_id      uuid not null references org.units (id),
  name             text not null check (length(btrim(name)) between 1 and 150),
  address          text not null check (length(address) <= 1000),
  status           text not null default 'active' check (status in ('draft', 'planned', 'active', 'completed', 'archived', 'handed_over')),
  kind             text check (kind is null or length(kind) <= 100),
  stage            text check (stage is null or length(stage) <= 100),
  area_m2          numeric(12, 3) check (area_m2 is null or area_m2 >= 0),
  rooms            integer check (rooms is null or rooms >= 0),
  contract_no      text check (contract_no is null or length(contract_no) <= 40),
  start_on         date,
  due_on           date,
  client_name      text check (client_name is null or length(client_name) <= 150),
  client_phone     text check (client_phone is null or length(client_phone) <= 40),
  foreman_id       uuid references people.person_profiles (id),
  access           jsonb not null default '[]' check (jsonb_typeof(access) = 'array'),
  template_id      uuid,
  lead_task_id     uuid,
  budget_minor     bigint check (budget_minor is null or budget_minor between 0 and 9007199254740991),
  currency         char(3) not null default 'RUB',
  handed_over_on   date,
  warranty_until   date,
  revision         integer not null default 1 check (revision >= 1),
  created_by       uuid references people.person_profiles (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint projects_draft_no_foreman check (status <> 'draft' or foreman_id is null),
  constraint projects_handover check ((status = 'handed_over') = (handed_over_on is not null))
);
create index projects_unit_idx on repairs.projects (org_unit_id);
create index projects_foreman_idx on repairs.projects (foreman_id) where foreman_id is not null;
create index projects_status_idx on repairs.projects (status, due_on);
create unique index projects_lead_idx on repairs.projects (lead_task_id) where lead_task_id is not null;

create table repairs.workers (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references repairs.projects (id),
  display_name text not null check (length(btrim(display_name)) between 1 and 150),
  trade        text not null default '' check (length(trade) <= 100),
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   timestamptz not null default now()
);
create index workers_project_idx on repairs.workers (project_id);

create table repairs.works (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references repairs.projects (id),
  name             text not null check (length(btrim(name)) between 1 and 200),
  unit             text not null check (unit in ('hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter')),
  plan_qty         numeric(14, 3) not null check (plan_qty >= 0),
  fact_qty         numeric(14, 3) not null default 0 check (fact_qty >= 0),
  estimate_line_id uuid,
  sort             integer not null default 0
);
create index works_project_idx on repairs.works (project_id, sort);

create sequence repairs.work_log_number_seq;

create table repairs.work_logs (
  id                uuid primary key default gen_random_uuid(),
  number            text not null,
  project_id        uuid not null references repairs.projects (id),
  submitted_by      uuid not null references people.person_profiles (id),
  work_date         date not null,
  time_zone         text not null,
  status            text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected')),
  note              text check (note is null or length(note) <= 5000),
  crew_worker_ids   uuid[] not null default '{}',
  materials         jsonb not null default '[]' check (jsonb_typeof(materials) = 'array'),
  evidence_file_ids uuid[] not null check (cardinality(evidence_file_ids) >= 1),
  reviewed_by       uuid references people.person_profiles (id),
  reviewed_at       timestamptz,
  return_reason     text check (return_reason is null or length(return_reason) <= 500),
  revision          integer not null default 1 check (revision >= 1),
  created_at        timestamptz not null default now(),
  constraint work_logs_review check ((status = 'submitted') = (reviewed_by is null and reviewed_at is null)),
  constraint work_logs_return check ((status = 'rejected') = (return_reason is not null))
);
create unique index work_logs_number_idx on repairs.work_logs (number);
create index work_logs_project_idx on repairs.work_logs (project_id, status, created_at desc);

create table repairs.work_log_lines (
  work_log_id      uuid not null references repairs.work_logs (id),
  line_no          smallint not null check (line_no >= 1),
  work_id          uuid references repairs.works (id),
  quantity         numeric(14, 3) not null check (quantity > 0),
  unit             text not null check (unit in ('hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter')),
  description      text check (description is null or length(description) <= 2000),
  presence_minutes integer check (presence_minutes is null or presence_minutes >= 0),
  primary key (work_log_id, line_no)
);

create table repairs.change_orders (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references repairs.projects (id),
  seq             integer not null check (seq >= 1),
  title           text not null check (length(btrim(title)) between 1 and 300),
  quantity        numeric(14, 3) not null check (quantity > 0),
  unit            text not null check (unit in ('hour', 'm2', 'm3', 'm', 'piece', 'set', 'trip', 'mesh', 'liter')),
  note            text not null default '' check (length(note) <= 2000),
  photo_file_ids  uuid[] not null check (cardinality(photo_file_ids) >= 1),
  status          text not null default 'proposed' check (status in ('proposed', 'priced', 'sent', 'signed', 'rejected')),
  reject_reason   text check (reject_reason is null or reject_reason in ('already_in_estimate', 'client_refused', 'warranty', 'not_agreed_with_client')),
  agreement_no    integer check (agreement_no is null or agreement_no >= 1),
  estimate_version integer check (estimate_version is null or estimate_version >= 1),
  created_by      uuid not null references people.person_profiles (id),
  revision        integer not null default 1 check (revision >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint change_orders_reject check ((status = 'rejected') = (reject_reason is not null))
);
create unique index change_orders_seq_idx on repairs.change_orders (project_id, seq);

create table repairs.project_events (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references repairs.projects (id),
  at         timestamptz not null default now(),
  kind       text not null check (kind ~ '^[a-z][a-z0-9_.]{1,79}$'),
  text       text not null check (length(text) between 1 and 300),
  actor_id   uuid references people.person_profiles (id),
  payload    jsonb not null default '{}' check (jsonb_typeof(payload) = 'object')
);
create index project_events_project_idx on repairs.project_events (project_id, at desc, id desc);

-- +goose Down
drop table repairs.project_events;
drop table repairs.change_orders;
drop table repairs.work_log_lines;
drop table repairs.work_logs;
drop sequence repairs.work_log_number_seq;
drop table repairs.works;
drop table repairs.workers;
drop table repairs.projects;
drop schema repairs;
