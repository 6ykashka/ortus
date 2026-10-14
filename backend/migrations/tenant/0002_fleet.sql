-- W0.06 · копия design/docs/db/tenant_0002_fleet.sql · не редактировать (тест TestMirrorDesignSQL)
-- +goose Up
-- Ортус · Tenant DB · миграция 0002 fleet + finance (черновик v0.2, 01.10.2026)
-- Пилот S2: машины, бронь, осмотры, дефекты, рейсы, расходы, сдача, пул, закрытые начисления.

create schema if not exists fleet;
create schema if not exists finance;   -- отдельная схема: позже отдельная DB-роль для чтения начислений

create table fleet.vehicles (
  id              uuid primary key default gen_random_uuid(),
  unit_id         uuid not null references org.units(id),
  plate           text not null,
  vin             text,
  body_type       text not null check (body_type in ('van','box','reefer','tent','flatbed')),
  payload_kg      numeric(10,1) not null check (payload_kg > 0),
  volume_m3       numeric(8,2)  not null check (volume_m3 > 0),
  cargo_length_mm integer not null check (cargo_length_mm > 0),
  cargo_width_mm  integer,
  cargo_height_mm integer,
  temp_min_c      numeric(4,1),
  temp_max_c      numeric(4,1),
  odometer_km     numeric(10,1) not null default 0 check (odometer_km >= 0),
  service_state   text not null default 'ok' check (service_state in ('ok','maintenance','out_of_service')),
  archived_at     timestamptz,
  revision        integer not null default 1,
  created_at      timestamptz not null default now(),
  check ((temp_min_c is null) = (temp_max_c is null)),
  check (temp_min_c is null or temp_min_c <= temp_max_c)
);
create unique index vehicles_plate_uq on fleet.vehicles (upper(plate)) where archived_at is null;
create index vehicles_unit_idx on fleet.vehicles (unit_id) where archived_at is null;

create table fleet.trips (
  id                     uuid primary key default gen_random_uuid(),
  number                 text not null unique,         -- из core.counters
  unit_id                uuid not null references org.units(id),
  state                  text not null check (state in
    ('planned','assigned','inspection','defect_review','on_route','returning','submitted','rework','accepted','cancelled')),
  vehicle_id             uuid references fleet.vehicles(id),
  driver_person_id       uuid references people.person_profiles(id),
  reservation_bundle_id  uuid,
  planned                tstzrange not null,
  cargo_weight_kg        numeric(10,1) not null default 0,
  cargo_volume_m3        numeric(8,2)  not null default 0,
  cargo_length_mm        integer,
  cargo_temp_min_c       numeric(4,1),
  cargo_temp_max_c       numeric(4,1),
  departure_inspection_id uuid,
  return_inspection_id    uuid,
  started_at             timestamptz,
  returned_at            timestamptz,
  reviewed_at            timestamptz,
  reviewed_by            uuid,
  revision               integer not null default 1,
  created_at             timestamptz not null default now(),
  check (state not in ('on_route','returning','submitted','rework','accepted') or (vehicle_id is not null and started_at is not null))
);
-- Фактическая занятость (CAL-06): машина и водитель не могут быть в двух активных рейсах.
create unique index trips_active_vehicle_uq on fleet.trips (vehicle_id)
  where state in ('inspection','defect_review','on_route','returning','submitted','rework');
create unique index trips_active_driver_uq on fleet.trips (driver_person_id)
  where state in ('on_route','returning');
create index trips_unit_state_idx on fleet.trips (unit_id, state);

create table fleet.trip_stops (
  trip_id   uuid not null references fleet.trips(id),
  seq       integer not null check (seq > 0),
  op        text not null check (op in ('load','unload')),
  address   text not null,
  time_window tstzrange,
  weight_kg numeric(10,1) not null default 0 check (weight_kg >= 0),
  volume_m3 numeric(8,2)  not null default 0 check (volume_m3 >= 0),
  contact   text,
  primary key (trip_id, seq)
);

create table fleet.checklist_versions (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('departure','return')),
  version              integer not null,
  items                jsonb not null,                 -- [{key,label,required}]
  required_photo_roles text[] not null default array['front','back','left','right','odometer'],
  published_at         timestamptz not null default now(),
  unique (kind, version)
);

create table fleet.inspections (
  id                   uuid primary key default gen_random_uuid(),
  trip_id              uuid not null references fleet.trips(id),
  vehicle_id           uuid not null references fleet.vehicles(id),
  kind                 text not null check (kind in ('departure','return')),
  checklist_version_id uuid not null references fleet.checklist_versions(id),
  odometer_km          numeric(10,1) not null check (odometer_km >= 0),
  fuel_level           text not null check (fuel_level in ('quarter','half','three_quarters','full')),
  answers              jsonb not null,
  state                text not null check (state in ('submitted','approved','blocked')),
  submitted_by         uuid not null,
  submitted_at         timestamptz not null default now(),
  client_captured_at   timestamptz,
  revision             integer not null default 1,
  unique (trip_id, kind)
);
alter table fleet.trips
  add foreign key (departure_inspection_id) references fleet.inspections(id),
  add foreign key (return_inspection_id)    references fleet.inspections(id);
-- Правило «возвратный пробег ≥ пробега выезда» (LOG-09) проверяет команда return;
-- уменьшение возможно только через fleet.odometer_corrections.

create table fleet.inspection_photos (
  inspection_id uuid not null references fleet.inspections(id),
  role          text not null check (role in ('front','back','left','right','odometer','interior','cargo')),
  file_id       uuid not null references files.objects(id),
  primary key (inspection_id, role)
);

create table fleet.defects (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references fleet.vehicles(id),
  inspection_id uuid references fleet.inspections(id),
  zone          text not null,
  severity      text not null check (severity in ('minor','major','blocking')),
  description   text not null,
  state         text not null default 'open' check (state in ('open','in_review','resolved','confirmed_out_of_service')),
  resolved_by   uuid,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- Выезд запрещён при открытом блокирующем дефекте (LOG-04, AC-04).
create index defects_blocking_open_idx on fleet.defects (vehicle_id)
  where severity = 'blocking' and state in ('open','in_review');

create table fleet.odometer_corrections (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references fleet.vehicles(id),
  from_km     numeric(10,1) not null,
  to_km       numeric(10,1) not null,
  reason      text not null,
  approved_by uuid not null,
  created_at  timestamptz not null default now()
);

-- Расход рейса ≠ выплата ≠ начисление (LOG-08, LOG-10).
create table fleet.expenses (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references fleet.trips(id),
  category        text not null check (category in ('fuel','wash','parking','toll','other')),
  amount_minor    bigint not null check (amount_minor > 0 and amount_minor <= 9007199254740991),
  currency        char(3) not null default 'RUB',
  liters          numeric(8,2) check (liters is null or liters > 0),
  odometer_km     numeric(10,1),
  occurred_on     date not null,
  comment         text,
  receipt_file_id uuid references files.objects(id),
  state           text not null default 'claimed' check (state in ('claimed','verified','rejected','reimbursed')),
  claimed_by      uuid not null,
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  revision        integer not null default 1,
  created_at      timestamptz not null default now(),
  check (category <> 'fuel' or liters is not null)
);
create index expenses_trip_idx on fleet.expenses (trip_id);

-- Межфирменный пул: минимальная проекция, случайный catalog_ref (AUTH-06).
create table fleet.pool_publications (
  id             uuid primary key default gen_random_uuid(),
  catalog_ref    uuid not null unique default gen_random_uuid(),
  person_id      uuid not null references people.person_profiles(id),
  home_unit_id   uuid not null references org.units(id),
  qualifications text[] not null default '{}',
  available      tstzrange not null,
  published_by   uuid not null,
  created_at     timestamptz not null default now(),
  withdrawn_at   timestamptz
);

create table fleet.driver_transfers (
  id                uuid primary key default gen_random_uuid(),
  publication_id    uuid not null references fleet.pool_publications(id),
  source_unit_id    uuid not null references org.units(id),
  target_unit_id    uuid not null references org.units(id),
  trip_id           uuid references fleet.trips(id),
  period            tstzrange not null,
  state             text not null check (state in ('requested','approved','rejected','revoked','expired','completed')),
  assignment_id     uuid references access.role_assignments(id),  -- временный grant (AUTH-07)
  requested_by      uuid not null,
  decided_by        uuid,
  decided_at        timestamptz,
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  check (source_unit_id <> target_unit_id)
);

-- ── Закрытые начисления ───────────────────────────────────────────────────
-- Читает только репозиторий finance при fleet.earnings.read И отсутствии действующей функции driver.
-- Не входит в Trip DTO, datasets водителя, outbox payload и поисковые документы (AC-05).
create table finance.earnings (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null unique references fleet.trips(id),
  person_id    uuid not null references people.person_profiles(id),
  unit_id      uuid not null references org.units(id),   -- область работы, не текущая фирма водителя
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  currency     char(3) not null default 'RUB',
  state        text not null default 'draft' check (state in ('draft','approved','corrected')),
  revision     integer not null default 1,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
-- +goose Down
-- 0002 создаёт схемы fleet и finance целиком.
drop schema finance, fleet cascade;
