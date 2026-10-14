-- W0.06 · копия design/docs/db/tenant_0001_core.sql · не редактировать (тест TestMirrorDesignSQL)
-- +goose Up
-- Ортус · Tenant DB · миграция 0001 core (черновик v0.2, 01.10.2026)
-- Одна БД на тенант. Схемы по модулям; модуль пишет только в свою схему.
-- Деньги — bigint minor units; количества — numeric; время — timestamptz (UTC) + IANA zone.

-- PostgreSQL ≥ 13 (gen_random_uuid() встроена). Проверено на PostgreSQL 16.4.
create extension if not exists btree_gist;   -- contrib: EXCLUDE по uuid/text + tstzrange

create schema if not exists core;
create schema if not exists org;
create schema if not exists people;
create schema if not exists access;
create schema if not exists modules;
create schema if not exists files;
create schema if not exists sched;
create schema if not exists audit;
create schema if not exists outbox;

-- Sentinel: API проверяет совпадение с tenant_routing.sentinel при открытии пула (02-architecture §3).
create table core.tenant_identity (
  singleton  boolean primary key default true check (singleton),
  tenant_id  uuid not null,
  sentinel   uuid not null,
  created_at timestamptz not null default now()
);

-- Идемпотентность команд: namespace actor + operation + key (03-api-guide).
create table core.idempotency_keys (
  actor_id        uuid not null,
  operation       text not null,
  key             text not null check (length(key) between 8 and 128),
  request_hash    bytea not null,
  state           text not null check (state in ('in_progress','completed')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  primary key (actor_id, operation, key)
);

-- Атомарные человекочитаемые номера (TR-2026-000123). Не max()+1.
create table core.counters (
  name  text primary key,
  value bigint not null default 0
);
-- update core.counters set value = value + 1 where name = $1 returning value;

-- ── Структура ─────────────────────────────────────────────────────────────
create table org.units (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references org.units(id),
  kind        text not null check (kind in ('region','company','branch','team')),
  name        text not null,
  time_zone   text not null,                         -- 'Europe/Moscow', 'Europe/Samara'
  archived_at timestamptz,
  revision    integer not null default 1,
  created_at  timestamptz not null default now()
);
create index units_parent_idx on org.units (parent_id);

-- Транзитивное замыкание для scope_contains; перестраивается командой move в той же транзакции.
create table org.unit_closure (
  ancestor_id   uuid not null references org.units(id),
  descendant_id uuid not null references org.units(id),
  depth         integer not null check (depth >= 0),
  primary key (ancestor_id, descendant_id)
);
create index unit_closure_desc_idx on org.unit_closure (descendant_id);

create table org.legal_entities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  inn        text check (inn ~ '^\d{10}(\d{2})?$'),
  kpp        text check (kpp ~ '^\d{9}$'),
  ogrn       text,
  created_at timestamptz not null default now()
);
create table org.unit_legal_entities (
  unit_id         uuid not null references org.units(id),
  legal_entity_id uuid not null references org.legal_entities(id),
  primary key (unit_id, legal_entity_id)
);

-- ── Люди ──────────────────────────────────────────────────────────────────
-- PersonProfile может не иметь аккаунта (рабочие стройки) — BUILD-03.
create table people.person_profiles (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid unique,                          -- control DB, без FK
  full_name     text not null,
  phone         text,
  email         text,
  home_unit_id  uuid not null references org.units(id),
  archived_at   timestamptz,
  revision      integer not null default 1,
  created_at    timestamptz not null default now()
);

-- Профессиональная функция. Действующая 'driver' блокирует начисления (AUTH-05, A-12).
create table people.work_profiles (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people.person_profiles(id),
  function   text not null check (function in ('driver','therapist','foreman','worker','dispatcher')),
  unit_id    uuid not null references org.units(id),
  valid      tstzrange not null default tstzrange(now(), null),
  created_at timestamptz not null default now(),
  exclude using gist (person_id with =, function with =, valid with &&)
);

-- ── Доступ ────────────────────────────────────────────────────────────────
create table access.policy_state (
  singleton      boolean primary key default true check (singleton),
  policy_version bigint not null default 1           -- +1 при любом изменении ролей/назначений/модулей
);

create table access.roles (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  kind            text not null check (kind in ('system','template','custom')),
  template_key    text,
  current_version integer not null default 1,
  archived_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index roles_name_uq on access.roles (lower(name)) where archived_at is null;

-- Версия роли неизменяема. Wildcard запрещён (A-05).
create table access.role_versions (
  role_id    uuid not null references access.roles(id),
  version    integer not null,
  actions    text[] not null check (not ('*' = any(actions))),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (role_id, version)
);

create table access.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);
create table access.group_members (
  group_id  uuid not null references access.groups(id),
  person_id uuid not null references people.person_profiles(id),
  primary key (group_id, person_id)
);

-- Назначение = кто + роль(версия) + где + когда. Роль без области не назначается (AUTH-01).
create table access.role_assignments (
  id                  uuid primary key default gen_random_uuid(),
  principal_kind      text not null check (principal_kind in ('person','group')),
  principal_id        uuid not null,
  role_id             uuid not null,
  role_version        integer not null,
  scope_kind          text not null check (scope_kind in ('tenant','unit','project','warehouse','resource','self')),
  scope_ref           uuid,
  include_descendants boolean not null default true,
  valid               tstzrange not null default tstzrange(now(), null),
  state               text not null default 'active' check (state in ('active','dormant','revoked')),
  source              text not null default 'manual' check (source in ('manual','transfer','support')),
  granted_by          uuid not null,
  reason              text,
  created_at          timestamptz not null default now(),
  revoked_at          timestamptz,
  foreign key (role_id, role_version) references access.role_versions(role_id, version),
  check ((scope_kind in ('tenant','self')) = (scope_ref is null))
);
create index role_assignments_principal_idx on access.role_assignments (principal_kind, principal_id) where state = 'active';

-- ── Модули ────────────────────────────────────────────────────────────────
create table modules.installations (
  module_key       text primary key,
  state            text not null check (state in ('enabled','draining','read_only','disabled')),
  manifest_version text not null,
  retained_access  text not null default 'history_read' check (retained_access in ('history_read','owner_export')),
  settings         jsonb not null default '{}',
  revision         integer not null default 1,
  updated_by       uuid not null,
  updated_at       timestamptz not null default now()
);

-- ── Файлы и квота ─────────────────────────────────────────────────────────
create table files.objects (
  id             uuid primary key default gen_random_uuid(),
  object_key     text not null unique,                -- формирует сервер (FILE-01)
  state          text not null check (state in ('reserved','uploaded','scanning','ready','rejected')),
  purpose        text not null,                       -- 'inspection.front', 'expense.receipt'
  owner_type     text not null,
  owner_id       uuid not null,
  declared_mime  text not null,
  detected_mime  text,
  bytes          bigint check (bytes > 0),
  sha256         bytea,
  capture_at     timestamptz,                         -- заявлено устройством, не доказательство
  uploaded_by    uuid not null,
  created_at     timestamptz not null default now(),
  ready_at       timestamptz,
  rejected_code  text
);
create index files_owner_idx on files.objects (owner_type, owner_id);
create index files_pending_idx on files.objects (created_at) where state in ('reserved','uploaded','scanning');

-- Счётчик квоты. Резерв атомарно:
-- update files.usage set reserved_bytes = reserved_bytes + $n
--  where singleton and committed_bytes + reserved_bytes + $n <= limit_bytes + activity_reserve_bytes
--  returning *;   -- 0 строк → 409 quota_exceeded
create table files.usage (
  singleton              boolean primary key default true check (singleton),
  committed_bytes        bigint not null default 0 check (committed_bytes >= 0),
  reserved_bytes         bigint not null default 0 check (reserved_bytes >= 0),
  limit_bytes            bigint not null,
  activity_reserve_bytes bigint not null default 0,  -- для закрытия начатых смен (PLAT-07)
  updated_at             timestamptz not null default now()
);

create table files.quota_ledger (
  id         bigserial primary key,
  file_id    uuid not null references files.objects(id),
  kind       text not null check (kind in ('reserve','commit','release')),
  bytes      bigint not null check (bytes > 0),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Ядро расписания (A-06) ────────────────────────────────────────────────
create table sched.resources (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('vehicle','person','room','equipment')),
  ref_id       uuid not null,
  home_unit_id uuid not null references org.units(id),
  unique (kind, ref_id)
);

-- occupied = [начало − подготовка, конец + уборка), вычисляет сервис:
-- выражение timestamptz ± interval не IMMUTABLE и не годится для EXCLUDE напрямую.
-- Истёкшие holds переводятся в 'expired' под блокировкой ресурса в той же транзакции перед вставкой.
create table sched.reservations (
  id              uuid primary key default gen_random_uuid(),
  resource_id     uuid not null references sched.resources(id),
  bundle_id       uuid not null,                       -- комплект ресурсов подтверждается целиком
  during          tstzrange not null,
  occupied        tstzrange not null,
  state           text not null check (state in ('hold','confirmed','consumed','released','expired')),
  hold_expires_at timestamptz,
  source_type     text not null,                       -- 'fleet.trip', 'spa.appointment'
  source_id       uuid not null,
  created_by      uuid not null,
  revision        integer not null default 1,
  created_at      timestamptz not null default now(),
  check (occupied @> during),
  check (state <> 'hold' or hold_expires_at is not null),
  constraint reservations_no_overlap
    exclude using gist (resource_id with =, occupied with &&)
    where (state in ('hold','confirmed','consumed'))
);
create index reservations_source_idx on sched.reservations (source_type, source_id);

-- ── Аудит, outbox, inbox ──────────────────────────────────────────────────
create table audit.events (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_kind  text not null check (actor_kind in ('person','service','support')),
  actor_id    uuid,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  unit_id     uuid,
  sensitivity text not null default 'normal' check (sensitivity in ('normal','sensitive','restricted')),
  reason      text,
  result      text not null check (result in ('ok','denied','failed')),
  request_id  text not null,
  diff        jsonb                                  -- restricted-поля редактируются по field policy
);
create index audit_target_idx on audit.events (target_type, target_id, at desc);

create table outbox.events (
  id           bigserial primary key,
  event_id     uuid not null unique default gen_random_uuid(),
  type         text not null,                         -- 'fleet.trip.submitted.v1'
  aggregate    text not null,
  aggregate_id uuid not null,
  payload      jsonb not null,                        -- без restricted-полей
  occurred_at  timestamptz not null default now(),
  available_at timestamptz not null default now(),
  attempts     integer not null default 0,
  locked_until timestamptz,
  published_at timestamptz,
  last_error   text
);
create index outbox_pending_idx on outbox.events (available_at) where published_at is null;

create table outbox.inbox (
  consumer     text not null,
  event_id     uuid not null,
  processed_at timestamptz not null default now(),
  primary key (consumer, event_id)
);
-- +goose Down
-- 0001 создаёт схемы целиком: откат — удаление схем со всеми объектами.
drop schema outbox, audit, sched, files, modules, access, people, org, core cascade;
drop extension if exists btree_gist;
