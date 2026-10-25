-- W5.00 · tenant 0044 · «Салон и SPA»: услуги с техкартой, визиты, однократное списание (контракт 0.12.0-stage5, W5.20).
-- В прототипе экрана SPA нет (B-6) — по API 0.1 и плану v2 §4 (W5.20): услуга — длительность, буферы до и после, цена,
-- оборудование и техкарта (расход материалов на визит); при правке услуги растёт ревизия, снимок ревизии хранится
-- (визит записан по снимку). Визит — практик, кабинет, оборудование, окно, статус (confirmed → performed_pending_posting
-- → completed | cancelled | no_show), фактическая цена по факту после скидки (CASH-03) и бронь ресурсов в sched.
-- Завершение — одна строка на визит (completions: primary key — списание материалов выполняется один раз, AC-07).
-- Модуль пишет только в свою схему: внешние ключи — на people и себя; склад, клиент, бронь и материал — id без ключей.
-- +goose Up
create schema if not exists spa;

create table spa.services (
  id                    uuid primary key default gen_random_uuid(),
  org_unit_id           uuid not null references org.units (id),
  name                  text not null check (length(btrim(name)) between 1 and 150),
  duration_minutes      integer not null check (duration_minutes >= 1),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes  integer not null default 0 check (buffer_after_minutes >= 0),
  price_minor           bigint not null check (price_minor >= 0),
  currency              char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  required_equipment_ids uuid[] not null default '{}',
  revision              integer not null default 1 check (revision >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index services_name_idx on spa.services (org_unit_id, lower(btrim(name)));

create table spa.service_revisions (
  service_id uuid not null references spa.services (id),
  revision   integer not null check (revision >= 1),
  snapshot   jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  primary key (service_id, revision)
);

create table spa.service_recipe_lines (
  service_id uuid not null references spa.services (id),
  line_no    integer not null check (line_no >= 1),
  item_id    uuid not null,
  quantity   numeric(18, 6) not null check (quantity > 0),
  unit       text not null check (unit in ('ml', 'g', 'piece')),
  primary key (service_id, line_no)
);

create table spa.appointments (
  id                 uuid primary key default gen_random_uuid(),
  org_unit_id        uuid not null references org.units (id),
  service_id         uuid not null references spa.services (id),
  service_revision   integer not null check (service_revision >= 1),
  client_id          uuid not null,
  practitioner_id    uuid not null references people.person_profiles (id),
  room_id            uuid not null,
  equipment_ids      uuid[] not null default '{}',
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  time_zone          text not null,
  booking_id         uuid not null,
  status             text not null default 'confirmed' check (status in ('confirmed', 'performed_pending_posting', 'completed', 'cancelled', 'no_show')),
  performed_at       timestamptz,
  performance_note   text check (performance_note is null or length(performance_note) <= 2000),
  final_price_minor  bigint check (final_price_minor is null or final_price_minor >= 0),
  cancel_reason      text check (cancel_reason is null or length(cancel_reason) <= 500),
  service_snapshot   jsonb not null check (jsonb_typeof(service_snapshot) = 'object'),
  revision           integer not null default 1 check (revision >= 1),
  created_by         uuid not null references people.person_profiles (id),
  created_at         timestamptz not null default now(),
  constraint appointments_window check (starts_at < ends_at),
  constraint appointments_performed check ((status in ('performed_pending_posting', 'completed')) = (performed_at is not null)),
  constraint appointments_cancelled check (status not in ('cancelled', 'no_show') or cancel_reason is not null)
);
create index appointments_practitioner_idx on spa.appointments (practitioner_id, starts_at);
create index appointments_status_idx on spa.appointments (status) where status in ('confirmed', 'performed_pending_posting');
create unique index appointments_booking_idx on spa.appointments (booking_id);

create table spa.completions (
  appointment_id uuid primary key references spa.appointments (id),
  completed_at   timestamptz not null default now(),
  completed_by   uuid not null references people.person_profiles (id),
  warehouse_id   uuid not null,
  movement_ids   uuid[] not null default '{}',
  overrides      jsonb not null default '[]' check (jsonb_typeof(overrides) = 'array'),
  note           text check (note is null or length(note) <= 2000)
);

comment on table spa.completions is 'Завершение визита — одна строка на визит: списание материалов по техкарте выполняется один раз (AC-07). Нехватка материала оставляет визит в performed_pending_posting без строки (повтор после исправления остатка).';

-- +goose Down
drop table spa.completions;
drop table spa.appointments;
drop table spa.service_recipe_lines;
drop table spa.service_revisions;
drop table spa.services;
drop schema spa;
