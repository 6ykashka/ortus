-- W6.00 · tenant 0052 · «Ремонт и стройка», график (контракт 0.12.0-stage6, W6.14, W6.17): этапы, связи, базовый план, журнал переносов, календарь.
-- Номер выдал стюард контрактного PR этапа 6 (W6.00; план v2 §3.5, PD-59). Разбор repair.md §2.1, Q-W4.00-repair-15, -19,
-- -20; design/docs/19-construction.md «График работ». Этап — раздел сметы с выработкой и длительностью в рабочих днях
-- (duration_wd), смещением от начала (offset_wd), фактическим началом (начавшийся этап не сдвигается) и исполнителем
-- (участник или имя без входа). Связь «окончание → начало» с паузой в календарных днях (lag_days < 0 — опережение).
-- Базовый план — снимок при утверждении, новый — только допсоглашением. Журнал переносов — только INSERT: причина из
-- семи, изменение и список уведомлённых. Версия графика для If-Match — projects.schedule_revision. Рабочий календарь —
-- дни недели и праздники региона (производственный календарь; сегодня — инжектируемые часы).
-- +goose Up
alter table repairs.projects add column schedule_revision integer not null default 1 check (schedule_revision >= 1);

create table repairs.schedule_stages (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references repairs.projects (id),
  phase               text not null default '' check (length(phase) <= 100),
  name                text not null check (length(btrim(name)) between 1 and 200),
  estimate_section_id uuid references repairs.estimate_sections (id),
  volume              numeric(14, 3) check (volume is null or volume >= 0),
  rate_per_day        numeric(14, 3) check (rate_per_day is null or rate_per_day > 0),
  duration_wd         integer not null check (duration_wd >= 1),
  offset_wd           integer not null default 0 check (offset_wd >= 0),
  actual_start        date,
  status              text not null default 'planned' check (status in ('planned', 'started', 'done')),
  executor_member_id  uuid references people.person_profiles (id),
  executor_name       text check (executor_name is null or length(executor_name) <= 150),
  sort                integer not null default 0
);
create index schedule_stages_project_idx on repairs.schedule_stages (project_id, sort);

create table repairs.schedule_links (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references repairs.projects (id),
  from_stage_id uuid not null references repairs.schedule_stages (id),
  to_stage_id   uuid not null references repairs.schedule_stages (id),
  kind          text not null default 'FS' check (kind = 'FS'),
  lag_days      integer not null default 0 check (lag_days between -60 and 60),
  note          text check (note is null or length(note) <= 200),
  constraint schedule_links_distinct check (from_stage_id <> to_stage_id)
);
create unique index schedule_links_pair_idx on repairs.schedule_links (from_stage_id, to_stage_id);
create index schedule_links_project_idx on repairs.schedule_links (project_id);

create table repairs.schedule_baselines (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references repairs.projects (id),
  version      integer not null check (version >= 1),
  due_on       date not null,
  approved_at  timestamptz not null default now(),
  approved_by  uuid references people.person_profiles (id),
  agreement_no integer check (agreement_no is null or agreement_no >= 1),
  snapshot     jsonb not null check (jsonb_typeof(snapshot) = 'object')
);
create unique index schedule_baselines_version_idx on repairs.schedule_baselines (project_id, version);

create table repairs.schedule_changes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references repairs.projects (id),
  at         timestamptz not null default now(),
  author_id  uuid references people.person_profiles (id),
  text       text not null check (length(text) between 1 and 500),
  reason     text check (reason is null or reason in ('client_request', 'material_delay', 'executor_busy', 'rework', 'weather_or_drying', 'scope_change', 'other')),
  change     jsonb not null default '{}' check (jsonb_typeof(change) = 'object'),
  notified   jsonb not null default '[]' check (jsonb_typeof(notified) = 'array')
);
create index schedule_changes_project_idx on repairs.schedule_changes (project_id, at desc, id desc);

create table repairs.work_calendars (
  id       uuid primary key default gen_random_uuid(),
  region   text not null default 'RU' check (length(region) between 1 and 20),
  workdays smallint[] not null default '{1,2,3,4,5}',
  holidays date[] not null default '{}'
);
create unique index work_calendars_region_idx on repairs.work_calendars (region);

-- +goose Down
drop table repairs.work_calendars;
drop table repairs.schedule_changes;
drop table repairs.schedule_baselines;
drop table repairs.schedule_links;
drop table repairs.schedule_stages;
alter table repairs.projects drop column schedule_revision;
