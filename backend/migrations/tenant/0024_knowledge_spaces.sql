-- W4.04 · tenant 0024 · «База знаний»: пространства, дерево узлов, версии, доступ, ознакомление, запросы, правила.
-- Номер выдал стюард контрактного PR 3 этапа 4 (W4.04; план v2 §3.5, PD-59) — следующий свободный в main: в ветке 0023,
-- после вливания W2.71 (tenant 0023) — 0024; при вливании после W4.03 (tasks) — следующий свободный (api/README.md).
-- Схема kb — модуль «База знаний» (10-data-model: модуль пишет только в свою схему; docs/23-knowledge-spaces.md
-- «Набросок данных», knowledge.md §2.1). Пространство — область доступа: область (подразделение, null — вся
-- организация) и уровень open | limited | closed. Узел — страница, папка, таблица, схема, файл или запись CRM в дереве
-- пространства: родитель — из того же пространства, глубина 1…6 (KB-06) и ровно на единицу больше глубины родителя
-- (составной FK, отложенный до конца транзакции: перенос ветки меняет глубины потомков; цикл в дереве невозможен),
-- главная страница «Обзор» — одна на пространство, без родителя. Свой доступ узла: режим и записи (роль с областью,
-- группа, сотрудник, связь «прораб объекта» — KB-01); журнал доступа. Ознакомление — одно на узел, журнал
-- подтверждений хранится и после новой версии и увольнения (KB-03). Запрос доступа — один открытый на узел и
-- сотрудника, пространство запроса — пространство узла (составной FK; по нему строится список руководителя); срок — у
-- одобренного запроса чтения (30 дней, назначение kb_space_reader с областью page пишет модуль). Запуск правила — в
-- пространстве правила (составной FK). Роли пространства — назначения
-- access.role_assignments со scope_kind space и page (tenant 0020), не здесь. Таблицы и записи страниц — из ответов
-- форм (D-26 комплекта). Версии текста хранятся без срока (KB-08).
-- +goose Up
create schema if not exists kb;

create table kb.spaces (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 2 and 120),
  icon         text not null default 'menu_book' check (icon ~ '^[a-z_]{2,40}$'),
  color        text not null default '#2B5479' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  org_unit_id  uuid references org.units (id),
  access       text not null check (access in ('open', 'limited', 'closed')),
  template_key text check (template_key in ('regs', 'staff', 'objects', 'blank')),
  revision     integer not null default 1 check (revision >= 1),
  created_by   uuid references people.person_profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index spaces_name_uq on kb.spaces (lower(btrim(name)));

create table kb.nodes (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references kb.spaces (id),
  parent_id       uuid,
  position        integer not null default 0 check (position >= 0),
  depth           smallint not null check (depth between 1 and 6),
  parent_depth    smallint generated always as (depth - 1) stored,
  is_home         boolean not null default false,
  kind            text not null check (kind in ('page', 'folder', 'table', 'diagram', 'file', 'link')),
  title           text not null check (length(btrim(title)) between 1 and 200),
  status          text not null default 'draft' check (status in ('draft', 'review', 'active', 'outdated')),
  access_mode     text not null default 'inherit' check (access_mode in ('inherit', 'edit_listed', 'listed')),
  access_revision integer not null default 1 check (access_revision >= 1),
  sensitivity     text not null default 'normal' check (sensitivity in ('normal', 'finance')),
  owner_id        uuid references people.person_profiles (id),
  review_by       date,
  diagram         jsonb,
  file_id         uuid references files.objects (id),
  link            jsonb,
  section_project uuid,
  archived_at     timestamptz,
  archived_by     uuid references people.person_profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (space_id, id),
  unique (space_id, id, depth),
  foreign key (space_id, parent_id, parent_depth) references kb.nodes (space_id, id, depth)
    deferrable initially deferred,
  constraint nodes_parent check (parent_id is null or parent_id <> id),
  constraint nodes_depth check ((parent_id is null) = (depth = 1)),
  constraint nodes_home check (not is_home or (parent_id is null and kind = 'page')),
  constraint nodes_diagram check (diagram is null or (kind = 'diagram' and jsonb_typeof(diagram) = 'object')),
  constraint nodes_link check (link is null or (kind = 'link' and jsonb_typeof(link) = 'object')),
  constraint nodes_file check (file_id is null or kind = 'file')
);
create unique index nodes_home_uq on kb.nodes (space_id) where is_home;
create index nodes_tree_idx on kb.nodes (space_id, parent_id, position);
create index nodes_review_idx on kb.nodes (space_id, review_by) where review_by is not null and archived_at is null;

create table kb.versions (
  node_id      uuid not null references kb.nodes (id),
  version      integer not null check (version >= 1),
  title        text not null check (length(btrim(title)) between 1 and 200),
  body         text not null default '' check (length(body) <= 200000),
  steps        text[] check (steps is null or cardinality(steps) <= 8),
  published_by uuid references people.person_profiles (id),
  author_name  text not null check (length(author_name) between 1 and 200),
  published_at timestamptz not null default now(),
  primary key (node_id, version)
);

create table kb.node_access (
  id            uuid primary key default gen_random_uuid(),
  node_id       uuid not null references kb.nodes (id),
  position      smallint not null check (position >= 0),
  who           text not null check (who in ('member', 'group', 'role', 'relation')),
  ref_id        uuid,
  relation      text check (relation in ('foreman')),
  object_module text,
  object_type   text,
  object_id     uuid,
  org_unit_id   uuid references org.units (id),
  can           text not null check (can in ('view', 'edit')),
  unique (node_id, position),
  constraint node_access_ref check ((who = 'relation') = (ref_id is null)),
  constraint node_access_relation check ((who = 'relation') = (relation is not null and object_module is not null
    and object_type is not null and object_id is not null)),
  constraint node_access_unit check (org_unit_id is null or who = 'role')
);

create table kb.access_history (
  id         uuid primary key default gen_random_uuid(),
  node_id    uuid not null references kb.nodes (id),
  changed_by uuid references people.person_profiles (id),
  changed_at timestamptz not null default now(),
  mode       text not null check (mode in ('inherit', 'edit_listed', 'listed')),
  entries    jsonb not null check (jsonb_typeof(entries) = 'array'),
  text       text not null check (length(text) between 1 and 2000)
);
create index access_history_node_idx on kb.access_history (node_id, changed_at desc);

create table kb.acks (
  node_id       uuid primary key references kb.nodes (id),
  version       integer not null check (version >= 1),
  audience_who  text not null check (audience_who in ('all', 'role', 'group', 'member')),
  audience_ref  uuid,
  audience_unit uuid references org.units (id),
  constraint acks_audience check ((audience_who = 'all') = (audience_ref is null))
);

create table kb.ack_log (
  id        uuid primary key default gen_random_uuid(),
  node_id   uuid not null references kb.nodes (id),
  member_id uuid not null references people.person_profiles (id),
  version   integer not null check (version >= 1),
  acked_at  timestamptz not null default now(),
  unique (node_id, member_id, version)
);

create table kb.requests (
  id           uuid primary key default gen_random_uuid(),
  node_id      uuid not null references kb.nodes (id),
  space_id     uuid not null references kb.spaces (id),
  member_id    uuid not null references people.person_profiles (id),
  can          text not null check (can in ('view', 'edit')),
  status       text not null default 'open' check (status in ('open', 'approved', 'denied')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references people.person_profiles (id),
  until        date,
  foreign key (space_id, node_id) references kb.nodes (space_id, id),
  constraint requests_decided check ((status = 'open') = (decided_at is null)),
  constraint requests_until check (until is null or (status = 'approved' and can = 'view'))
);
create unique index requests_open_uq on kb.requests (node_id, member_id) where status = 'open';
create index requests_space_idx on kb.requests (space_id, status, requested_at desc);

create table kb.rules (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references kb.spaces (id),
  kind       text not null check (kind in ('ack', 'review', 'section')),
  name       text not null check (length(name) between 1 and 200),
  trigger    text not null check (length(trigger) between 1 and 200),
  enabled    boolean not null default true,
  enabled_by uuid references people.person_profiles (id),
  revision   integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  unique (space_id, id)
);

create table kb.runs (
  id       uuid primary key default gen_random_uuid(),
  space_id uuid not null references kb.spaces (id),
  rule_id  uuid not null,
  ran_at   timestamptz not null default now(),
  result   text not null check (result in ('ok', 'warn', 'stopped', 'error')),
  text     text not null check (length(text) between 1 and 500),
  foreign key (space_id, rule_id) references kb.rules (space_id, id)
);
create index runs_space_idx on kb.runs (space_id, ran_at desc, id desc);

create table kb.tables (
  id         uuid primary key default gen_random_uuid(),
  node_id    uuid not null references kb.nodes (id),
  title      text not null check (length(btrim(title)) between 2 and 120),
  columns    jsonb not null check (jsonb_typeof(columns) = 'array'),
  created_at timestamptz not null default now()
);
create unique index tables_title_uq on kb.tables (node_id, lower(btrim(title)));

create table kb.table_rows (
  id              uuid primary key default gen_random_uuid(),
  table_id        uuid not null references kb.tables (id),
  added_at        timestamptz not null default now(),
  cells           jsonb not null check (jsonb_typeof(cells) = 'object'),
  form_id         uuid,
  response_number text check (response_number is null or length(response_number) between 1 and 40),
  form_version    integer check (form_version >= 1)
);
create index table_rows_table_idx on kb.table_rows (table_id, added_at desc);

create table kb.entries (
  id              uuid primary key default gen_random_uuid(),
  node_id         uuid not null references kb.nodes (id),
  added_at        timestamptz not null default now(),
  head            text not null check (length(head) between 1 and 200),
  lines           jsonb not null check (jsonb_typeof(lines) = 'array'),
  form_id         uuid not null,
  response_number text not null check (length(response_number) between 1 and 40),
  form_version    integer not null check (form_version >= 1)
);
create index entries_node_idx on kb.entries (node_id, added_at desc);

-- +goose Down
drop table kb.entries;
drop table kb.table_rows;
drop table kb.tables;
drop table kb.runs;
drop table kb.rules;
drop table kb.requests;
drop table kb.ack_log;
drop table kb.acks;
drop table kb.access_history;
drop table kb.node_access;
drop table kb.versions;
drop table kb.nodes;
drop table kb.spaces;
drop schema kb;
