-- W4.06 · tenant 0021 · календарь ресурсов (контракт 0.7.0-stage4, W4.40, W4.41).
-- Номер выдал стюард контрактного PR 5 этапа 4 (W4.06; план v2 §3.5, PD-59) — первый номер блока этапа 4; при
-- вливании после других контрактных PR этапа 4 файл переименовывается в следующий свободный номер (интегратор).
-- Ресурс календаря (CalendarResource): подпись помещения и оборудования (у машины и сотрудника подпись берётся из
-- источника), пояс (null — пояс подразделения), рабочий день — сетка календаря и границы слотов и переноса (CAL-05;
-- эталон — 08:00–20:00), признак активности. Бронь календаря (Booking) — sched.bookings: подразделение, название, вид
-- источника (тон блока и запрет переноса эталона), объект источника, окно, подготовка и уборка (CAL-03), статус и
-- ревизия. Занятость ресурсов — по-прежнему sched.reservations (exclusion reservations_no_overlap по occupied):
-- бронь календаря — комплект резерваций с bundle_id = sched.bookings.id (без внешнего ключа: комплекты рейсов W2.02
-- живут без строки брони; календарь показывает их проекцией, W4.40). Одна подтверждённая бронь на объект источника.
-- У помещения и оборудования объекта-источника нет: ref_id необязателен (null; unique (kind, ref_id) таких строк не
-- ограничивает), у машины и сотрудника — обязателен, как в 0.1. Пояса ресурса и брони — имена IANA (Europe/Moscow).
-- +goose Up
alter table sched.resources
  alter column ref_id drop not null,
  add column label text check (label is null or length(btrim(label)) between 1 and 200),
  add column time_zone text,
  add column workday_start time not null default '08:00',
  add column workday_end time not null default '20:00',
  add column active boolean not null default true,
  add constraint resources_workday check (workday_start < workday_end),
  add constraint resources_label check (kind in ('vehicle', 'person') or label is not null),
  add constraint resources_ref check (kind in ('room', 'equipment') or ref_id is not null),
  add constraint resources_time_zone check (time_zone is null or time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$');

create table sched.bookings (
  id              uuid primary key default gen_random_uuid(),
  org_unit_id     uuid not null references org.units (id),
  title           text not null check (length(btrim(title)) between 1 and 200),
  source_kind     text not null check (source_kind in ('appointment', 'trip', 'maintenance', 'break', 'manual')),
  source_module   text check (source_module is null or source_module ~ '^[a-z][a-z0-9_-]{1,49}$'),
  source_type     text check (source_type is null or source_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id       uuid,
  during          tstzrange not null,
  time_zone       text not null,
  prep_minutes    integer not null default 0 check (prep_minutes between 0 and 240),
  cleanup_minutes integer not null default 0 check (cleanup_minutes between 0 and 240),
  status          text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  cancel_reason   text check (cancel_reason is null or length(cancel_reason) <= 1000),
  revision        integer not null default 1 check (revision >= 1),
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bookings_time_zone check (time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+)*$'),
  constraint bookings_window check (
    not isempty(during) and lower(during) is not null and upper(during) is not null
    and lower_inc(during) and not upper_inc(during)),
  constraint bookings_source check (
    (source_module is null) = (source_id is null) and (source_type is null) = (source_id is null)),
  constraint bookings_source_kind check (
    (source_kind in ('break', 'manual') and source_id is null)
    or (source_kind in ('appointment', 'trip', 'maintenance') and source_id is not null))
);
create index bookings_during_idx on sched.bookings using gist (during) where status = 'confirmed';
create index bookings_unit_idx on sched.bookings (org_unit_id, lower(during));
create unique index bookings_source_idx on sched.bookings (source_module, source_type, source_id)
  where status = 'confirmed' and source_id is not null;

-- +goose Down
drop table sched.bookings;

-- Помещение и оборудование без объекта-источника получают синтетический ref_id = id (NOT NULL 0.1).
update sched.resources set ref_id = id where ref_id is null;
alter table sched.resources
  alter column ref_id set not null,
  drop constraint resources_time_zone,
  drop constraint resources_ref,
  drop constraint resources_label,
  drop constraint resources_workday,
  drop column active,
  drop column workday_end,
  drop column workday_start,
  drop column time_zone,
  drop column label;
