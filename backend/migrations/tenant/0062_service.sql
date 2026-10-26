-- W7.00 · tenant 0062 · «Обращения клиентов» (контракт 0.12.0-stage7, W7.31): схема service.
-- Номер выдал стюард контрактного PR этапа 7 (W7.00; план v2 §3.5, PD-59; блок этапа 7 — 0060–0069).
-- Разбор docs/plan/v2/analysis/dor/service.md и docs/22-client-requests.md. Направление — ключ (латиница, уникален),
-- цвет, модуль, подразделение, проект задач, календарь, руководитель, счётчик номеров, версия; настройка меняется
-- черновиком и публикуется версией (service.direction_versions). Тип обращения — вид, сроки реакции и решения,
-- юридический срок, приоритет. Клиент — имя, организация, телефон (хранится целиком, наружу — маской; полный номер
-- только при service.clients.contacts). Обращение — номер {ключ}-{N} (старые ключи — алиасы при переносе между
-- направлениями), статус, исполнитель, канал, ссылка на запись CRM, итог, компенсация. Таймеры SLA — по обращению и
-- виду срока (first, resolve), пауза в статусе «ждём клиента». Оценка клиента и опрос; публичный доступ клиента —
-- токен кабинета (только дайджест), отказ от опросов — по номеру клиента. Задача, проект, запись CRM — id без внешних
-- ключей к чужим схемам.
-- +goose Up
create schema if not exists service;

create table service.calendars (
  id        uuid primary key default gen_random_uuid(),
  name      text not null check (length(btrim(name)) between 1 and 80),
  days      smallint[] not null check (cardinality(days) between 1 and 7),
  time_from time not null,
  time_to   time not null,
  time_zone text not null default 'Europe/Moscow',
  constraint calendars_span check (time_from < time_to)
);

create table service.directions (
  id            uuid primary key default gen_random_uuid(),
  key           text not null check (key ~ '^[A-Z][A-Z0-9]{1,5}$'),
  name          text not null check (length(btrim(name)) between 2 and 80),
  color         text not null default '#4f46e5' check (color ~ '^#[0-9a-fA-F]{6}$'),
  module_key    text not null check (module_key ~ '^[a-z][a-z0-9_-]{1,49}$'),
  area_label    text not null default '',
  org_unit_id   uuid references org.units (id),
  project_id    uuid,
  calendar_id   uuid references service.calendars (id),
  lead_id       uuid references people.person_profiles (id),
  next_number   integer not null default 1 check (next_number >= 1),
  public_slug   text check (public_slug is null or (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(public_slug) <= 60)),
  status        text not null default 'active' check (status in ('active', 'archived')),
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index directions_key_uq on service.directions (key);
create unique index directions_public_slug_uq on service.directions (public_slug) where public_slug is not null;
create index directions_unit_idx on service.directions (org_unit_id) where org_unit_id is not null;

create table service.direction_versions (
  direction_id uuid not null references service.directions (id),
  number       integer not null check (number >= 1),
  body         jsonb not null check (jsonb_typeof(body) = 'object'),
  published_by uuid references people.person_profiles (id),
  published_at timestamptz not null default now(),
  primary key (direction_id, number)
);

create table service.direction_drafts (
  direction_id uuid primary key references service.directions (id),
  body         jsonb not null check (jsonb_typeof(body) = 'object'),
  base_version integer not null check (base_version >= 1),
  saved_by     uuid references people.person_profiles (id),
  saved_at     timestamptz not null default now()
);

create table service.direction_team (
  direction_id uuid not null references service.directions (id),
  member_id    uuid not null references people.person_profiles (id),
  role         text not null check (role in ('lead', 'specialist', 'observer')),
  primary key (direction_id, member_id)
);

create table service.request_types (
  id              text not null check (id ~ '^[a-z][a-z0-9_-]{1,49}$'),
  direction_id    uuid not null references service.directions (id),
  kind            text not null check (kind in ('complaint', 'claim', 'question', 'idea', 'thanks', 'warranty', 'cargo')),
  name            text not null check (length(btrim(name)) between 2 and 80),
  first_minutes   integer check (first_minutes is null or first_minutes >= 1),
  resolve_minutes integer check (resolve_minutes is null or resolve_minutes >= 1),
  legal_days      integer check (legal_days is null or legal_days >= 1),
  priority        text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  primary key (direction_id, id)
);

create table service.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 120),
  company    text,
  phone      text not null check (phone ~ '^\+[0-9]{10,15}$'),
  opted_out  boolean not null default false,
  since      date not null default current_date,
  created_at timestamptz not null default now()
);
create unique index clients_phone_uq on service.clients (phone);

create table service.requests (
  id             uuid primary key default gen_random_uuid(),
  direction_id   uuid not null references service.directions (id),
  number         integer not null check (number >= 1),
  key            text not null,
  kind           text not null check (kind in ('complaint', 'claim', 'question', 'idea', 'thanks', 'warranty', 'cargo')),
  type_id        text,
  title          text not null check (length(btrim(title)) between 1 and 200),
  status         text not null default 'new' check (status in ('new', 'work', 'wait', 'resolved', 'closed')),
  priority       text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  assignee_id    uuid references people.person_profiles (id),
  client_id      uuid not null references service.clients (id),
  channel        text not null check (channel in ('sms', 'bot', 'cabinet', 'widget', 'phone', 'qr')),
  link_ref       jsonb check (link_ref is null or jsonb_typeof(link_ref) = 'object'),
  labels         text[] not null default '{}',
  outcome        text,
  compensation   text,
  shared         jsonb check (shared is null or jsonb_typeof(shared) = 'object'),
  about_member_id uuid references people.person_profiles (id),
  from_rating_id uuid,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  updated_at     timestamptz not null default now(),
  revision       integer not null default 1 check (revision >= 1),
  foreign key (direction_id, type_id) references service.request_types (direction_id, id),
  constraint requests_resolved check ((status in ('resolved', 'closed')) = (resolved_at is not null)),
  unique (direction_id, number)
);
create unique index requests_key_uq on service.requests (key);
create index requests_queue_idx on service.requests (direction_id, status, created_at desc);
create index requests_assignee_idx on service.requests (assignee_id) where assignee_id is not null;
create index requests_client_idx on service.requests (client_id);

-- Прежние ключи при переносе между направлениями: старый номер по-прежнему находит обращение.
create table service.key_aliases (
  key         text primary key,
  request_id  uuid not null references service.requests (id),
  created_at  timestamptz not null default now()
);

create table service.request_details (
  request_id uuid primary key references service.requests (id),
  details    jsonb not null default '{}' check (jsonb_typeof(details) = 'object')
);

create table service.messages (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references service.requests (id),
  kind        text not null check (kind in ('client', 'public', 'note', 'system', 'rating')),
  author_id   uuid references people.person_profiles (id),
  text        text not null check (length(text) <= 10000),
  channel     text check (channel is null or channel in ('sms', 'bot', 'cabinet', 'widget', 'phone', 'qr')),
  auto        boolean not null default false,
  delivery    text check (delivery is null or delivery in ('queued', 'sent', 'failed')),
  score       smallint check (score is null or score between 1 and 5),
  reasons     text[] not null default '{}',
  contact     boolean not null default false,
  files       uuid[] not null default '{}',
  at          timestamptz not null default now(),
  constraint messages_note_author check (kind not in ('note', 'public') or author_id is not null)
);
create index messages_request_idx on service.messages (request_id, at);

create table service.sla_timers (
  request_id  uuid not null references service.requests (id),
  target      text not null check (target in ('first', 'resolve', 'legal')),
  goal_minutes integer check (goal_minutes is null or goal_minutes >= 1),
  due_at      timestamptz not null,
  paused_at   timestamptz,
  paused_total_minutes integer not null default 0 check (paused_total_minutes >= 0),
  stopped_at  timestamptz,
  primary key (request_id, target)
);
create index sla_timers_due_idx on service.sla_timers (due_at) where stopped_at is null and paused_at is null;

create table service.ratings (
  id           uuid primary key default gen_random_uuid(),
  direction_id uuid not null references service.directions (id),
  request_id   uuid references service.requests (id),
  client_id    uuid not null references service.clients (id),
  score        smallint not null check (score between 1 and 5),
  reasons      text[] not null default '{}',
  comment      text not null default '',
  work         text not null default '',
  status       text not null default 'open' check (status in ('open', 'seen', 'request')),
  at           timestamptz not null default now()
);
create index ratings_direction_idx on service.ratings (direction_id, status, at desc);

create table service.surveys (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null unique references service.requests (id),
  sent_at     timestamptz not null default now(),
  answered_at timestamptz,
  rating_id   uuid references service.ratings (id)
);

-- Доступ клиента к своему обращению: токен не хранится, только дайджест (sha256:hex); ссылка из СМС или кабинет.
create table service.portal_tokens (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references service.requests (id),
  token_digest text not null check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_version  smallint not null default 1 check (key_version >= 1),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create unique index portal_tokens_digest_uq on service.portal_tokens (token_digest);
create index portal_tokens_request_idx on service.portal_tokens (request_id);

create table service.reply_templates (
  id           text not null check (id ~ '^[a-z][a-z0-9_-]{1,49}$'),
  direction_id uuid not null references service.directions (id),
  name         text not null check (length(btrim(name)) between 1 and 80),
  text         text not null check (length(btrim(text)) between 1 and 2000),
  primary key (direction_id, id)
);

comment on column service.clients.phone is 'Полный номер хранится только здесь; наружу — маска (ServiceClient.phoneMasked), полный номер — только по service.clients.contacts и с записью в журнал доступа (revealServiceClientPhone).';
comment on column service.portal_tokens.token_digest is 'Токен доступа клиента (публичный контур /api/v1/public/service) не хранится: показывается в СМС-ссылке; здесь sha256:hex(SHA-256(токен)). Ограничение частоты и размера тела — как у публичных форм (ADR-0016).';
comment on table service.key_aliases is 'Прежние номера обращения после переноса в другое направление: getServiceRequest по старому ключу находит то же обращение.';

comment on column service.directions.public_slug is 'Slug публичной страницы направления (/api/v1/public/service/{slug}): источник истины здесь, уникален внутри тенанта; глобальную уникальность и маршрут к тенанту даёт реестр control.public_service_slugs (control 0011): публикация занимает slug там первым, снятие освобождает последним. Пусто — страницы нет.';
-- +goose Down
drop table service.reply_templates;
drop table service.portal_tokens;
drop table service.surveys;
drop table service.ratings;
drop table service.sla_timers;
drop table service.messages;
drop table service.request_details;
drop table service.key_aliases;
drop table service.requests;
drop table service.clients;
drop table service.request_types;
drop table service.direction_team;
drop table service.direction_drafts;
drop table service.direction_versions;
drop table service.directions;
drop table service.calendars;
drop schema service;
