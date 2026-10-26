-- W7.00 · tenant 0060 · «Чаты» (контракт 0.12.0-stage7, W7.11): схема chat.
-- Номер выдал стюард контрактного PR этапа 7 (W7.00; план v2 §3.5, PD-59; блок этапа 7 — 0060–0069).
-- Разбор docs/plan/v2/analysis/dor/chats.md и docs/25-chats.md. Модуль пишет только в свою схему (10-data-model):
-- задача, запись CRM, документ, файл, поездка и организация — id без внешних ключей к чужим схемам, кроме
-- people.person_profiles, org.units и files.objects (общие справочники ядра).
-- Чат — вид (direct, group, area, record, announce), статус, чувствительность (pdn маскирует номера и банковские
-- данные), политика (jsonb, пределы CHAT-10 проверяет сервер), ревизия. Источники состава — правила «кто входит»
-- (все, группа, роль, сотрудник, связь, водитель рейса); участник — строка с состоянием и ролью. Сообщения нумеруются
-- в чате (seq без дыр на чат — выдаёт сервер под блокировкой строки чата), правка — версии, удаление — признак с
-- хранением содержимого для журнала (deleted_days политики). Опрос — варианты и голоса; у анонимного опроса голос
-- хранится как voter_hash (HMAC от опроса и сотрудника), а не как сотрудник. Прочтения — одна строка на участника
-- (last_seq), подтверждения «ознакомлен» — по сообщению. Удержание (hold) блокирует очистку и срок хранения.
-- Журнал — действия администратора (ничего, кроме факта и автора; содержимое удалённого — только при праве).
-- +goose Up
create schema if not exists chat;

create table chat.chats (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('direct', 'group', 'area', 'record', 'announce')),
  title         text not null check (length(btrim(title)) between 1 and 120),
  org_unit_id   uuid references org.units (id),
  status        text not null default 'active' check (status in ('active', 'archived')),
  sensitivity   text not null default 'normal' check (sensitivity in ('normal', 'finance', 'pdn')),
  record_ref    jsonb check (record_ref is null or jsonb_typeof(record_ref) = 'object'),
  history       text not null default 'all' check (history in ('all', 'since_join', 'none')),
  policy        jsonb not null default '{}' check (jsonb_typeof(policy) = 'object'),
  overrides     jsonb not null default '{}' check (jsonb_typeof(overrides) = 'object'),
  last_seq      bigint not null default 0 check (last_seq >= 0),
  used_bytes    bigint not null default 0 check (used_bytes >= 0),
  archived_at   timestamptz,
  created_by    uuid references people.person_profiles (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  revision      integer not null default 1 check (revision >= 1),
  constraint chats_archived check ((status = 'archived') = (archived_at is not null))
);
create index chats_unit_idx on chat.chats (org_unit_id) where org_unit_id is not null;
create index chats_kind_idx on chat.chats (kind, status);
create unique index chats_record_uq on chat.chats ((record_ref ->> 'type'), (record_ref ->> 'id')) where kind = 'record' and record_ref is not null;

create table chat.chat_sources (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references chat.chats (id),
  who         text not null check (who in ('all', 'group', 'role', 'member', 'relation', 'trip_driver')),
  ref_id      uuid,
  org_unit_id uuid references org.units (id),
  object_ref  jsonb check (object_ref is null or jsonb_typeof(object_ref) = 'object'),
  trip_id     uuid,
  role        text not null default 'member' check (role in ('owner', 'moderator', 'member', 'reader')),
  created_at  timestamptz not null default now()
);
create index chat_sources_chat_idx on chat.chat_sources (chat_id);

create table chat.chat_members (
  chat_id    uuid not null references chat.chats (id),
  member_id  uuid not null references people.person_profiles (id),
  state      text not null default 'in' check (state in ('in', 'pending', 'out')),
  role       text check (role is null or role in ('owner', 'moderator', 'member', 'reader')),
  via        text,
  why        text,
  joined_at  timestamptz,
  left_at    timestamptz,
  muted      boolean not null default false,
  pinned     boolean not null default false,
  folder     text check (folder is null or folder in ('all', 'unread', 'mine', 'archive')),
  primary key (chat_id, member_id),
  constraint chat_members_role check ((state = 'in') = (role is not null) or state = 'pending')
);
create index chat_members_member_idx on chat.chat_members (member_id, state);

create table chat.topics (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references chat.chats (id),
  name       text not null check (length(btrim(name)) between 1 and 60),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index topics_name_uq on chat.topics (chat_id, lower(btrim(name)));

create table chat.messages (
  id            uuid primary key default gen_random_uuid(),
  chat_id       uuid not null references chat.chats (id),
  seq           bigint not null check (seq >= 1),
  kind          text not null default 'text' check (kind in ('text', 'poll', 'system', 'document')),
  author_id     uuid references people.person_profiles (id),
  topic_id      uuid references chat.topics (id),
  text          text not null default '' check (length(text) <= 10000),
  important     jsonb check (important is null or jsonb_typeof(important) = 'object'),
  ephemeral     jsonb check (ephemeral is null or jsonb_typeof(ephemeral) = 'object'),
  spoiler       text,
  system_card   jsonb check (system_card is null or jsonb_typeof(system_card) = 'object'),
  document_ref  uuid,
  reply_to      uuid references chat.messages (id),
  deleted_at    timestamptz,
  deleted_by    uuid references people.person_profiles (id),
  deleted_text  text,
  edited_at     timestamptz,
  visible_to    uuid references people.person_profiles (id),
  created_at    timestamptz not null default now(),
  unique (chat_id, seq),
  constraint messages_deleted check ((deleted_at is null) = (deleted_by is null) or kind = 'system')
);
create index messages_chat_seq_idx on chat.messages (chat_id, seq desc);
create index messages_topic_idx on chat.messages (topic_id) where topic_id is not null;
create index messages_ephemeral_idx on chat.messages ((ephemeral ->> 'expiresAt')) where ephemeral is not null;

create table chat.message_versions (
  message_id uuid not null references chat.messages (id),
  number     integer not null check (number >= 1),
  text       text not null,
  edited_at  timestamptz not null default now(),
  edited_by  uuid references people.person_profiles (id),
  primary key (message_id, number)
);

create table chat.attachments (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references chat.messages (id),
  file_id     uuid references files.objects (id),
  file_name   text not null,
  size_bytes  bigint not null check (size_bytes >= 0),
  kind        text not null check (kind in ('photo', 'video', 'voice', 'doc')),
  view_once   boolean not null default false,
  opened_by   uuid[] not null default '{}',
  gone_at     timestamptz,
  saved_to    jsonb check (saved_to is null or jsonb_typeof(saved_to) = 'object'),
  held        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index attachments_message_idx on chat.attachments (message_id);
create index attachments_file_idx on chat.attachments (file_id) where file_id is not null;

create table chat.receipts (
  chat_id   uuid not null references chat.chats (id),
  member_id uuid not null references people.person_profiles (id),
  last_seq  bigint not null default 0 check (last_seq >= 0),
  read_at   timestamptz,
  primary key (chat_id, member_id)
);

create table chat.acks (
  message_id uuid not null references chat.messages (id),
  member_id  uuid not null references people.person_profiles (id),
  acked_at   timestamptz not null default now(),
  primary key (message_id, member_id)
);

create table chat.polls (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null unique references chat.messages (id),
  question     text not null check (length(btrim(question)) between 1 and 300),
  options      jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 12),
  anonymous    boolean not null default false,
  multiple     boolean not null default false,
  closes_at    timestamptz not null,
  closed_at    timestamptz,
  reminded_at  timestamptz
);

-- Голос: у открытого опроса — сотрудник, у анонимного — только voter_hash (HMAC-SHA256 ключом CHAT_POLL_VOTER_KEY от
-- id опроса и сотрудника; по хэшу нельзя восстановить сотрудника без ключа сервера, но можно запретить повторный голос).
create table chat.poll_votes (
  poll_id     uuid not null references chat.polls (id),
  option_idx  smallint not null check (option_idx >= 0),
  voter_id    uuid references people.person_profiles (id),
  voter_hash  text check (voter_hash is null or voter_hash ~ '^[0-9a-f]{64}$'),
  voted_at    timestamptz not null default now(),
  constraint poll_votes_voter check ((voter_id is null) <> (voter_hash is null))
);
create unique index poll_votes_voter_uq on chat.poll_votes (poll_id, option_idx, coalesce(voter_id::text, voter_hash));

create table chat.pins (
  chat_id    uuid not null references chat.chats (id),
  message_id uuid not null references chat.messages (id),
  pinned_by  uuid references people.person_profiles (id),
  pinned_at  timestamptz not null default now(),
  primary key (chat_id, message_id)
);

create table chat.policies (
  id          uuid primary key default gen_random_uuid(),
  chat_kind   text not null unique check (chat_kind in ('direct', 'group', 'area', 'record', 'announce')),
  policy      jsonb not null check (jsonb_typeof(policy) = 'object'),
  updated_by  uuid references people.person_profiles (id),
  updated_at  timestamptz not null default now(),
  revision    integer not null default 1 check (revision >= 1)
);

create table chat.holds (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('chat', 'member', 'period')),
  chat_id     uuid references chat.chats (id),
  member_ids  uuid[] not null default '{}',
  period_from timestamptz,
  period_to   timestamptz,
  reason      text not null check (length(btrim(reason)) between 3 and 500),
  until       timestamptz,
  status      text not null default 'active' check (status in ('active', 'released')),
  created_by  uuid references people.person_profiles (id),
  created_at  timestamptz not null default now(),
  released_at timestamptz,
  released_by uuid references people.person_profiles (id),
  constraint holds_scope check ((scope = 'chat') = (chat_id is not null)),
  constraint holds_released check ((status = 'released') = (released_at is not null))
);
create index holds_active_idx on chat.holds (chat_id) where status = 'active';

create table chat.cleanups (
  id            uuid primary key default gen_random_uuid(),
  kinds         text[] not null,
  older_than_days integer check (older_than_days is null or older_than_days >= 1),
  exclude_saved boolean not null default true,
  dry_run       boolean not null default false,
  files         integer not null default 0 check (files >= 0),
  freed_bytes   bigint not null default 0 check (freed_bytes >= 0),
  skipped_held  integer not null default 0 check (skipped_held >= 0),
  created_by    uuid references people.person_profiles (id),
  created_at    timestamptz not null default now()
);

create table chat.journal (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references chat.chats (id),
  at         timestamptz not null default now(),
  actor_id   uuid references people.person_profiles (id),
  text       text not null,
  deleted_content text
);
create index journal_chat_idx on chat.journal (chat_id, at desc);

create table chat.exports (
  id         uuid primary key default gen_random_uuid(),
  chat_id    uuid not null references chat.chats (id),
  format     text not null check (format in ('csv', 'json')),
  period_from timestamptz,
  period_to   timestamptz,
  status     text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  file_id    uuid references files.objects (id),
  created_by uuid references people.person_profiles (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on column chat.messages.seq is 'Номер сообщения в чате: выдаёт сервер под блокировкой строки chat.chats (last_seq + 1) в той же транзакции, что вставка; подсказка realtime chat.changed несёт chatId и lastSeq (ADR-0016), клиент перечитывает listChatMessages?afterSeq=.';
comment on column chat.poll_votes.voter_hash is 'Анонимный опрос: HMAC-SHA256(CHAT_POLL_VOTER_KEY, poll_id || 0x00 || member_id) в hex. voter_id у анонимного голоса пуст всегда; результаты показывают только счётчики.';
comment on table chat.holds is 'Удержание: пока строка active и область совпадает, очистка (chat.cleanups) и сроки хранения не удаляют сообщения и файлы; снятие — status released (строка остаётся для журнала).';

-- +goose Down
drop table chat.exports;
drop table chat.journal;
drop table chat.cleanups;
drop table chat.holds;
drop table chat.policies;
drop table chat.pins;
drop table chat.poll_votes;
drop table chat.polls;
drop table chat.acks;
drop table chat.receipts;
drop table chat.attachments;
drop table chat.message_versions;
drop table chat.messages;
drop table chat.topics;
drop table chat.chat_members;
drop table chat.chat_sources;
drop table chat.chats;
drop schema chat;
