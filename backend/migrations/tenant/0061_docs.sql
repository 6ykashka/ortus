-- W7.00 · tenant 0061 · «Документы» (контракт 0.12.0-stage7, W7.21): схема docs.
-- Номер выдал стюард контрактного PR этапа 7 (W7.00; план v2 §3.5, PD-59; блок этапа 7 — 0060–0069).
-- Разбор docs/plan/v2/analysis/dor/documents.md и docs/24-documents.md; D-32 комплекта — сервер документов за
-- адаптером (ADR-0016), D-31 комплекта — подпись ПЭП. Папка — дерево с владельцем, режимом доступа (inherit, listed),
-- чувствительностью и шаблоном маршрута. Документ — вид (text, sheet, pdf), статус маршрута, действующая версия.
-- Версии неизменяемы (document_id, number): файл в files.objects, sha256, источник. Доступ — записи (кто, уровень,
-- срок); временные доступы — отдельно (причина, версия, «оставить»); внешние ссылки — дайджест токена и PIN (хэш),
-- журнал открытий. Комментарии и ответы привязаны к якорю. Маршрут — версия, шаги, решения (способ подписи);
-- ознакомления — по участнику. Задания (конвертация, OCR, склейка…) — очередь с результатом-документом; слова OCR
-- на проверке — отдельно. Шаблоны документов и маршрутов — каталог тенанта. Задача, проект, запись CRM, поездка —
-- id без внешних ключей к чужим схемам.
-- +goose Up
create schema if not exists docs;

create table docs.folders (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 1 and 120),
  parent_id     uuid references docs.folders (id),
  org_unit_id   uuid references org.units (id),
  mode          text not null default 'inherit' check (mode in ('inherit', 'listed')),
  owner_id      uuid not null references people.person_profiles (id),
  icon          text not null default 'folder',
  sensitivity   text not null default 'normal' check (sensitivity in ('normal', 'finance', 'pdn')),
  link_ref      jsonb check (link_ref is null or jsonb_typeof(link_ref) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  revision      integer not null default 1 check (revision >= 1),
  constraint folders_not_self check (parent_id is distinct from id)
);
create unique index folders_name_uq on docs.folders (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index folders_unit_idx on docs.folders (org_unit_id) where org_unit_id is not null;

create table docs.documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('text', 'sheet', 'pdf')),
  title         text not null check (length(btrim(title)) between 1 and 200),
  folder_id     uuid not null references docs.folders (id),
  owner_id      uuid not null references people.person_profiles (id),
  status        text not null default 'draft' check (status in ('draft', 'in_route', 'returned', 'agreed', 'approved', 'signed', 'archived')),
  sensitivity   text not null default 'normal' check (sensitivity in ('normal', 'finance', 'pdn')),
  mode          text not null default 'inherit' check (mode in ('inherit', 'listed')),
  current_version integer not null default 1 check (current_version >= 1),
  template_id   uuid,
  links         jsonb not null default '[]' check (jsonb_typeof(links) = 'array'),
  fields        jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  frozen        jsonb check (frozen is null or jsonb_typeof(frozen) = 'object'),
  pdfa_copy     boolean not null default false,
  scan          boolean not null default false,
  protected_ranges jsonb not null default '[]' check (jsonb_typeof(protected_ranges) = 'array'),
  ocr           jsonb check (ocr is null or jsonb_typeof(ocr) = 'object'),
  lock_key      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  revision      integer not null default 1 check (revision >= 1),
  constraint documents_archived check ((status = 'archived') = (archived_at is not null))
);
create index documents_folder_idx on docs.documents (folder_id, status);
create index documents_owner_idx on docs.documents (owner_id);
create index documents_links_idx on docs.documents using gin (links jsonb_path_ops);

create table docs.versions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references docs.documents (id),
  number      integer not null check (number >= 1),
  file_id     uuid references files.objects (id),
  size_bytes  bigint not null default 0 check (size_bytes >= 0),
  sha256      text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  source      text not null check (source in ('edit', 'upload', 'convert', 'ocr', 'restore', 'merge', 'route')),
  name        text check (name is null or length(btrim(name)) between 1 and 80),
  authors     uuid[] not null default '{}',
  forcesave   boolean not null default false,
  base_number integer check (base_number is null or base_number >= 1),
  engine_key  text,
  created_at  timestamptz not null default now(),
  unique (document_id, number)
);
-- Ключ версии сервера документов (callback): повтор того же ключа не создаёт новую версию (ADR-0016).
create unique index versions_engine_key_uq on docs.versions (document_id, engine_key) where engine_key is not null;

create table docs.shares (
  id          uuid primary key default gen_random_uuid(),
  folder_id   uuid references docs.folders (id),
  document_id uuid references docs.documents (id),
  who         text not null check (who in ('all', 'member', 'group', 'role', 'relation')),
  ref_id      uuid,
  org_unit_id uuid references org.units (id),
  object_ref  jsonb check (object_ref is null or jsonb_typeof(object_ref) = 'object'),
  level       text not null check (level in ('view', 'comment', 'suggest', 'edit', 'manage')),
  until       timestamptz,
  by_id       uuid references people.person_profiles (id),
  at          timestamptz not null default now(),
  constraint shares_target check ((folder_id is null) <> (document_id is null))
);
create index shares_folder_idx on docs.shares (folder_id) where folder_id is not null;
create index shares_document_idx on docs.shares (document_id) where document_id is not null;

create table docs.temp_grants (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references docs.documents (id),
  member_id    uuid not null references people.person_profiles (id),
  level        text not null check (level in ('view', 'comment', 'suggest', 'edit', 'manage')),
  why          text not null check (length(btrim(why)) between 3 and 300),
  only_version integer check (only_version is null or only_version >= 1),
  keep         boolean not null default false,
  granted_by   uuid references people.person_profiles (id),
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create index temp_grants_active_idx on docs.temp_grants (document_id, member_id) where revoked_at is null;

-- Внешняя ссылка: токен не хранится, только дайджест (sha256:hex) и ключ его версии; PIN — только хэш (argon2id).
create table docs.links (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references docs.documents (id),
  level        text not null check (level in ('view', 'comment', 'fill')),
  expires_at   timestamptz not null,
  pin_hash     text,
  watermark    boolean not null default true,
  download     boolean not null default false,
  token_digest text not null check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_version  smallint not null default 1 check (key_version >= 1),
  created_by   uuid references people.person_profiles (id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create unique index links_token_idx on docs.links (token_digest);
create index links_document_idx on docs.links (document_id);

create table docs.link_opens (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references docs.links (id),
  opened_at   timestamptz not null default now(),
  ip_hash     text,
  pin_failed  boolean not null default false
);
create index link_opens_link_idx on docs.link_opens (link_id, opened_at desc);

create table docs.comments (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references docs.documents (id),
  author_id   uuid not null references people.person_profiles (id),
  text        text not null check (length(btrim(text)) between 1 and 4000),
  anchor      jsonb not null check (jsonb_typeof(anchor) = 'object'),
  mention     uuid[] not null default '{}',
  resolved    boolean not null default false,
  resolved_by uuid references people.person_profiles (id),
  created_at  timestamptz not null default now()
);
create index comments_document_idx on docs.comments (document_id, created_at);

create table docs.replies (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references docs.comments (id),
  author_id   uuid not null references people.person_profiles (id),
  text        text not null check (length(btrim(text)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index replies_comment_idx on docs.replies (comment_id, created_at);

create table docs.routes (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references docs.documents (id),
  version       integer not null check (version >= 1),
  started_by    uuid not null references people.person_profiles (id),
  started_at    timestamptz not null default now(),
  status        text not null default 'active' check (status in ('active', 'returned', 'done', 'cancelled')),
  current_step  integer not null default 0 check (current_step >= 0),
  project_id    uuid,
  task_id       uuid,
  rules         jsonb not null default '{}' check (jsonb_typeof(rules) = 'object'),
  back          jsonb check (back is null or jsonb_typeof(back) = 'object'),
  finished_at   timestamptz
);
create unique index routes_active_uq on docs.routes (document_id) where status = 'active';

create table docs.route_steps (
  route_id   uuid not null references docs.routes (id),
  position   integer not null check (position >= 0),
  kind       text not null check (kind in ('approve', 'sign', 'ack', 'external')),
  name       text not null,
  mode       text not null default 'all' check (mode in ('all', 'seq', 'any')),
  who        uuid[] not null default '{}',
  audience   jsonb check (audience is null or jsonb_typeof(audience) = 'array'),
  days       integer not null default 3 check (days between 1 and 90),
  status     text not null default 'wait' check (status in ('wait', 'active', 'done')),
  due_at     timestamptz,
  external   jsonb check (external is null or jsonb_typeof(external) = 'object'),
  primary key (route_id, position)
);

-- Решение шага: способ подписи — клик, ПЭП по логину и паролю, ПЭП по коду СМС (D-31 комплекта), СМС-ссылка.
create table docs.route_decisions (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid not null,
  position   integer not null,
  member_id  uuid not null references people.person_profiles (id),
  decision   text not null check (decision in ('ok', 'back')),
  method     text not null check (method in ('click', 'pep_login', 'pep_sms', 'sms_link')),
  comment    text,
  at         timestamptz not null default now(),
  foreign key (route_id, position) references docs.route_steps (route_id, position),
  unique (route_id, position, member_id)
);

create table docs.acks (
  document_id uuid not null references docs.documents (id),
  member_id   uuid not null references people.person_profiles (id),
  version     integer not null check (version >= 1),
  device      text not null default '',
  at          timestamptz not null default now(),
  primary key (document_id, member_id, version)
);

create table docs.jobs (
  id            uuid primary key default gen_random_uuid(),
  op            text not null check (op in ('convert', 'ocr', 'merge', 'split', 'compress', 'pdfa', 'to_docx', 'to_xlsx', 'to_pdf')),
  doc_ids       uuid[] not null check (cardinality(doc_ids) >= 1),
  name          text not null,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  progress      smallint not null default 0 check (progress between 0 and 100),
  params        jsonb not null default '{}' check (jsonb_typeof(params) = 'object'),
  error         text,
  result_document_id uuid references docs.documents (id),
  created_by    uuid references people.person_profiles (id),
  created_at    timestamptz not null default now(),
  finished_at   timestamptz,
  constraint jobs_finished check ((status in ('done', 'failed')) = (finished_at is not null))
);
create index jobs_queue_idx on docs.jobs (status, created_at) where status in ('queued', 'running');

create table docs.ocr_words (
  document_id uuid not null references docs.documents (id),
  id          text not null,
  row_number  integer not null default 0,
  text        text not null,
  suggestion  text,
  confidence  numeric(4, 3) not null check (confidence between 0 and 1),
  why         text,
  state       text not null default 'doubtful' check (state in ('doubtful', 'accepted', 'kept', 'fixed')),
  primary key (document_id, id)
);

create table docs.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 120),
  kind        text not null check (kind in ('text', 'sheet', 'pdf')),
  icon        text not null default 'file',
  hint        text not null default '',
  link        text check (link is null or link in ('trip', 'object')),
  folder_id   uuid not null references docs.folders (id),
  fields      jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  file_id     uuid references files.objects (id),
  created_at  timestamptz not null default now(),
  revision    integer not null default 1 check (revision >= 1)
);
create unique index templates_name_uq on docs.templates (lower(btrim(name)));

create table docs.route_templates (
  id          uuid primary key default gen_random_uuid(),
  folder_id   uuid not null unique references docs.folders (id),
  name        text not null,
  project_id  uuid,
  steps       jsonb not null check (jsonb_typeof(steps) = 'array'),
  rules       jsonb not null default '{}' check (jsonb_typeof(rules) = 'object'),
  revision    integer not null default 1 check (revision >= 1)
);

alter table docs.documents add constraint documents_template_fk foreign key (template_id) references docs.templates (id);

comment on column docs.versions.engine_key is 'Ключ версии сервера документов из callback (docServerCallback): повтор с тем же ключом отвечает «принято», новую версию не создаёт; подпись callback — JWT, секрет DOCS_SERVER_JWT_SECRET (ADR-0016).';
comment on column docs.links.token_digest is 'Токен внешней ссылки не хранится: показывается один раз при выпуске; здесь sha256:hex(SHA-256(токен)). PIN — только pin_hash. Открытие — openDocLink без сессии, ограничение частоты и счётчик ошибок PIN — в docs.link_opens.';
comment on column docs.route_decisions.method is 'Способ подписи: click — простое согласие; pep_login — подтверждение логином и паролем; pep_sms — код по СМС (порт доставки, D-31 комплекта; без канала — dependency_unavailable); sms_link — ссылка из СМС внешнему подписанту.';

-- +goose Down
alter table docs.documents drop constraint documents_template_fk;
drop table docs.route_templates;
drop table docs.templates;
drop table docs.ocr_words;
drop table docs.jobs;
drop table docs.acks;
drop table docs.route_decisions;
drop table docs.route_steps;
drop table docs.routes;
drop table docs.replies;
drop table docs.comments;
drop table docs.link_opens;
drop table docs.links;
drop table docs.temp_grants;
drop table docs.shares;
drop table docs.versions;
drop table docs.documents;
drop table docs.folders;
drop schema docs;
