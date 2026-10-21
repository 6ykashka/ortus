-- W4.05 · tenant 0026 · «Формы и опросы» (контракт 0.11.0-stage4, W4.21): схема forms.
-- Номер выдал стюард контрактного PR 4 этапа 4 (W4.05; план v2 §3.5, PD-59) — следующий свободный после W4.03 (0025).
-- Разбор docs/plan/v2/analysis/dor/forms.md §2 (Q-W4.00-forms-1, -2, -3, -7, -13, -18, -21, -22, -25). Модуль пишет
-- только в свою схему (10-data-model): страница и таблица «Базы знаний» и задача действия — id без внешних ключей.
-- Группы — общие для организации (FM-03), имя уникально без учёта регистра. Форма: область (org_unit_id null — вся
-- организация), модуль и шаблон, группа, владелец, статус (draft — без версии), действующая версия (отложенный FK на
-- forms.versions — версия и указатель в одной транзакции), настройки приёма — столбцы (их применяет сервер при
-- отправке), остальное — settings (jsonb), ревизия формы. Черновик — одна строка на форму с ревизией, не удаляется
-- при публикации (ревизия не повторяется). Версии неизменяемы (form_id, number). Правило — вид, версия, автор, условие
-- «Только если» и настройка своего вида (config). Ответ — номер R-… (последовательность тенанта), версия формы, канал,
-- автор (у гостя нет), объект CRM с подписью, ответы (FieldEntry), ключи из ссылки, баллы, проверка, ключ
-- дедупликации осмотра (trip:kind:rev, W4.24). Журнал действий ответа — одна строка на «ответ × правило», переживает
-- удаление правила. Публичная ссылка — дайджест токена и версия ключа, одна действующая на форму (Q-W4.00-forms-21);
-- сам токен выводится из id ссылки (HMAC-SHA256, FORMS_PUBLIC_LINK_KEY) — см. комментарий столбца token_digest;
-- тенант гостя находится по дайджесту в индексе control 0009 public_form_links (возврат 2).
-- +goose Up
create schema if not exists forms;

create table forms.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 2 and 80),
  created_by uuid references people.person_profiles (id),
  created_at timestamptz not null default now()
);
create unique index groups_name_idx on forms.groups (lower(btrim(name)));

create table forms.forms (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(btrim(name)) between 3 and 200),
  org_unit_id     uuid references org.units (id),
  module_key      text check (module_key is null or module_key ~ '^[a-z][a-z0-9_-]{1,49}$'),
  template_id     text check (template_id is null or template_id ~ '^[a-z][a-z0-9-]{1,49}$'),
  group_id        uuid references forms.groups (id),
  owner_id        uuid not null references people.person_profiles (id),
  status          text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  current_version integer check (current_version >= 1),
  access          text not null default 'members' check (access in ('members', 'public')),
  accept_until    date,
  response_limit  integer check (response_limit between 1 and 1000000),
  one_per_member  boolean not null default false,
  retain_days     integer not null default 365 check (retain_days in (90, 365, 1095)),
  settings        jsonb not null default '{}' check (jsonb_typeof(settings) = 'object'),
  revision        integer not null default 1 check (revision >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint forms_published check ((status = 'draft') = (current_version is null))
);
create unique index forms_name_idx on forms.forms (lower(btrim(name)));
create index forms_unit_idx on forms.forms (org_unit_id);
create index forms_group_idx on forms.forms (group_id) where group_id is not null;
create index forms_owner_idx on forms.forms (owner_id);

create table forms.drafts (
  form_id      uuid primary key references forms.forms (id),
  definition   jsonb not null check (jsonb_typeof(definition) = 'object'),
  base_version integer check (base_version >= 1),
  has_changes  boolean not null default false,
  revision     integer not null default 1 check (revision >= 1),
  saved_at     timestamptz,
  saved_by     uuid references people.person_profiles (id)
);

create table forms.versions (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid not null references forms.forms (id),
  number         integer not null check (number >= 1),
  definition     jsonb not null check (jsonb_typeof(definition) = 'object'),
  question_count integer not null check (question_count >= 0),
  published_at   timestamptz not null default now(),
  published_by   uuid references people.person_profiles (id)
);
create unique index versions_number_idx on forms.versions (form_id, number);
alter table forms.forms add constraint forms_current_version_fk
  foreign key (id, current_version) references forms.versions (form_id, number) deferrable initially deferred;

create table forms.rules (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references forms.forms (id),
  kind            text not null check (kind in ('task', 'notify', 'email', 'http', 'kb')),
  enabled         boolean not null default true,
  version         integer not null default 1 check (version >= 1),
  trigger         text not null check (trigger in ('submitted', 'accepted')),
  condition_field text check (condition_field is null or condition_field ~ '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$'),
  condition_value text check (condition_value is null or length(condition_value) <= 64),
  config          jsonb not null,
  author_id       uuid not null references people.person_profiles (id),
  revision        integer not null default 1 check (revision >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint rules_condition check ((condition_field is null) = (condition_value is null)),
  constraint rules_config check (jsonb_typeof(config) = 'object')
);
create index rules_form_idx on forms.rules (form_id, created_at, id);

create sequence forms.response_number_seq as integer minvalue 1 start with 1;

create table forms.responses (
  id              uuid primary key default gen_random_uuid(),
  form_id         uuid not null references forms.forms (id),
  number          integer not null default nextval('forms.response_number_seq') check (number >= 1),
  version_number  integer not null,
  channel         text not null check (channel in ('member', 'public', 'inspection')),
  author_id       uuid references people.person_profiles (id),
  subject_module  text check (subject_module is null or subject_module ~ '^[a-z][a-z0-9_-]{1,49}$'),
  subject_type    text check (subject_type is null or subject_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  subject_id      uuid,
  subject_label   text check (subject_label is null or length(subject_label) <= 200),
  answers         jsonb not null check (jsonb_typeof(answers) = 'array'),
  link_param_keys text[] not null default '{}',
  score_points    integer,
  score_max       integer check (score_max >= 0),
  score_passed    boolean,
  review_status   text not null check (review_status in ('pending', 'accepted', 'rejected')),
  assignee_id     uuid references people.person_profiles (id),
  review_comment  text check (review_comment is null or length(review_comment) <= 5000),
  dedup_key       text check (dedup_key is null or length(dedup_key) between 1 and 200),
  revision        integer not null default 1 check (revision >= 1),
  submitted_at    timestamptz not null default now(),
  foreign key (form_id, version_number) references forms.versions (form_id, number),
  constraint responses_author check ((channel = 'public') = (author_id is null)),
  constraint responses_subject check (
    (subject_module is null) = (subject_id is null)
    and (subject_type is null) = (subject_id is null)
    and (subject_label is null) = (subject_id is null)),
  constraint responses_score check ((score_points is null) = (score_max is null)
    and (score_passed is null or score_max is not null))
);
create unique index responses_number_idx on forms.responses (number);
create unique index responses_dedup_idx on forms.responses (form_id, dedup_key) where dedup_key is not null;
create index responses_form_idx on forms.responses (form_id, submitted_at desc, id desc);
create index responses_author_idx on forms.responses (form_id, author_id) where author_id is not null;
create index responses_subject_idx on forms.responses (subject_module, subject_type, subject_id)
  where subject_id is not null;

create table forms.response_actions (
  response_id  uuid not null references forms.responses (id),
  rule_id      uuid not null,
  rule_version integer not null check (rule_version >= 1),
  kind         text not null check (kind in ('task', 'notify', 'email', 'http', 'kb')),
  ok           boolean not null,
  at           timestamptz not null default now(),
  text         text check (text is null or length(text) <= 500),
  error        text check (error is null or length(error) between 1 and 500),
  kb_node_id   uuid,
  task_id      uuid,
  primary key (response_id, rule_id),
  constraint response_actions_result check (ok = (error is null))
);
create index response_actions_rule_idx on forms.response_actions (rule_id);

create table forms.public_links (
  id           uuid primary key default gen_random_uuid(),
  form_id      uuid not null references forms.forms (id),
  token_digest text not null check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  key_version  smallint not null default 1 check (key_version >= 1),
  created_by   uuid references people.person_profiles (id),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);
create unique index public_links_token_idx on forms.public_links (token_digest);
create unique index public_links_active_idx on forms.public_links (form_id) where revoked_at is null;

-- Возврат 1 (ревью W4.05): схема вывода публичного токена, порядок журнала действий и сериализация отправки — в
-- комментариях объектов (их читают W4.21 и W4.25; проверка — stage4_w405_test.go и integration-тест).
comment on column forms.public_links.token_digest is 'Публичный токен (Form.share.publicToken, publicToken тега PublicForms) не хранится, а выводится HMAC-SHA256 ключом FORMS_PUBLIC_LINK_KEY — секретом сервера версии key_version (base64, не короче 32 байт; без ключа публичные ссылки не выпускаются). Путь гостя не несёт тенанта (БД у каждого тенанта своя, ADR 0006): тенант находится по тому же дайджесту в индексе control public_form_links (control 0009: token_digest → tenant_id, form_id, link_id = id этой строки), эта строка — источник истины; выпуск — сначала строка индекса, затем эта; отзыв и смена ключа — сначала эта, затем индекс. token = base64url без дополнения (HMAC-SHA256(ключ, ''ortus.forms.public-link.v1'' || 0x00 || id тенанта || 0x00 || forms.public_links.id)). token_digest = ''sha256:'' || hex(SHA-256(token)) — поиск гостевой ссылки. Показ ссылки участнику с forms.publish — вывод заново из id; отзыв — revoked_at и новая строка (новый id — новый токен); смена ключа — новая key_version, прежние ключи сервер хранит, пока живы ссылки их версии.';
comment on table forms.response_actions is 'Журнал действий ответа: одна строка на «response × rule» (ответ × правило) — правило выполняется для ответа один раз; rule_version — версия правила, которая выполнялась последней; повтор и перенос переписывают строку невыполненного действия, новая версия правила выполненное не повторяет.';
comment on column forms.forms.response_limit is 'Лимит ответов (FormSettings.responseLimit) и one_per_member проверяются при отправке под блокировкой строки формы: select … for update по forms.forms в той же транзакции, что вставка forms.responses (две параллельные отправки не превышают лимит и не дают двух ответов сотрудника).';

-- +goose Down
drop table forms.public_links;
drop table forms.response_actions;
drop table forms.responses;
drop sequence forms.response_number_seq;
drop table forms.rules;
alter table forms.forms drop constraint forms_current_version_fk;
drop table forms.versions;
drop table forms.drafts;
drop table forms.forms;
drop table forms.groups;
drop schema forms;
