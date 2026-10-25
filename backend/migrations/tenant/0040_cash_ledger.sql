-- W5.00 · tenant 0040 · «Касса»: кассы, статьи и журнал операций (контракт 0.12.0-stage5, W5.31): схема cash.
-- Номер выдал стюард контрактного PR этапа 5 (W5.00; план v2 §3.5, PD-59) — первый номер блока 0040–0049.
-- Разбор docs/plan/v2/analysis/dor/cash.md §2.1 (Q-W4.00-cash-3, -6, -8, -9, -12), docs/26-cash.md «Модель данных».
-- Модуль пишет только в свою схему (10-data-model): внешние ключи — на org и people; файл, визит, расход и рейс —
-- id без внешних ключей. Деньги — целые копейки (amount_minor) и код валюты. Касса: шесть видов, режим смен, ККТ,
-- лимит остатка, размен, допуск, ответственный, держатель подотчёта, терминал привязан к кассе точки; остаток
-- balance_minor ведёт сервер в одной транзакции с операцией, физическая касса не уходит в минус. Журнал неизменяем
-- (только INSERT для runtime-ролей, roles/grants.sql): исправление — сторно новой строкой, связь с источником — отдельной
-- записью. Один источник — одна операция или группа (source_claims, ключ идемпотентности «проведи предложение»);
-- № ФД уникален в паре «касса точки + смена ККТ» (Q-W4.00-cash-6). Статьи — сидовый справочник только для чтения.
-- +goose Up
create schema if not exists cash;

create table cash.categories (
  id                    text primary key check (id ~ '^[a-z][a-z0-9-]{1,63}$'),
  title                 text not null check (length(btrim(title)) between 2 and 120),
  group_name            text not null check (group_name in ('income', 'expense', 'transfer', 'adjustment')),
  direction             text check (direction is null or direction in ('in', 'out')),
  module_key            text check (module_key is null or module_key ~ '^[a-z][a-z0-9_-]{1,49}$'),
  expense_category_code text check (expense_category_code is null or length(expense_category_code) between 1 and 64),
  sort_order            integer not null default 0
);

create table cash.accounts (
  id                   uuid primary key default gen_random_uuid(),
  org_unit_id          uuid references org.units (id),
  name                 text not null check (length(btrim(name)) between 1 and 150),
  currency             char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  kind                 text not null check (kind in ('cash_drawer', 'safe', 'advance', 'acquiring', 'bank', 'virtual')),
  shift_mode           text not null default 'none' check (shift_mode in ('none', 'open', 'blind')),
  kkt_mode             text not null default 'none' check (kkt_mode in ('none', 'manual')),
  balance_limit_minor  bigint check (balance_limit_minor is null or balance_limit_minor >= 0),
  float_minor          bigint check (float_minor is null or float_minor >= 0),
  tolerance_minor      bigint check (tolerance_minor is null or tolerance_minor >= 0),
  responsible_id       uuid references people.person_profiles (id),
  holder_id            uuid references people.person_profiles (id),
  advance_limit_minor  bigint check (advance_limit_minor is null or advance_limit_minor >= 0),
  drawer_account_id    uuid references cash.accounts (id),
  settle_days          integer check (settle_days is null or settle_days between 0 and 30),
  fee_basis_points     integer check (fee_basis_points is null or fee_basis_points between 0 and 10000),
  category_ids         text[] not null default '{}',
  balance_minor        bigint not null default 0,
  revision             integer not null default 1 check (revision >= 1),
  created_by           uuid references people.person_profiles (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint accounts_advance_holder check (kind <> 'advance' or holder_id is not null),
  constraint accounts_terminal_drawer check (kind <> 'acquiring' or drawer_account_id is not null),
  constraint accounts_physical_not_negative check (kind in ('bank', 'acquiring', 'virtual') or balance_minor >= 0)
);
create unique index accounts_name_idx on cash.accounts (lower(btrim(name)));
create index accounts_unit_idx on cash.accounts (org_unit_id);
create index accounts_holder_idx on cash.accounts (holder_id) where holder_id is not null;
create index accounts_drawer_idx on cash.accounts (drawer_account_id) where drawer_account_id is not null;

create sequence cash.operation_number_seq;

create table cash.operations (
  id                    uuid primary key default gen_random_uuid(),
  number                bigint not null default nextval('cash.operation_number_seq'),
  account_id            uuid not null references cash.accounts (id),
  point_account_id      uuid not null references cash.accounts (id),
  type                  text not null check (type in ('in', 'out', 'refund', 'move_in', 'move_out', 'opening', 'adjust', 'storno')),
  direction             text not null check (direction in ('in', 'out')),
  amount_minor          bigint not null check (amount_minor > 0),
  currency              char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  category              text not null check (category in ('service_payment', 'expense', 'opening_balance', 'refund', 'adjustment')),
  category_id           text references cash.categories (id),
  method                text not null check (method in ('cash', 'card', 'sbp', 'transfer')),
  basis                 text check (basis is null or length(basis) <= 500),
  occurred_at           timestamptz not null,
  posted_at             timestamptz not null default now(),
  created_by            uuid not null references people.person_profiles (id),
  approved_by           uuid references people.person_profiles (id),
  origin                text not null default 'manual' check (origin in ('manual', 'proposal', 'import', 'integration')),
  related_module        text check (related_module is null or related_module ~ '^[a-z][a-z0-9_-]{1,49}$'),
  related_type          text check (related_type is null or related_type ~ '^[a-z][a-z0-9_]{1,49}$'),
  related_id            uuid,
  reverses_operation_id uuid references cash.operations (id),
  refunds_operation_id  uuid references cash.operations (id),
  own                   boolean not null default false,
  shift_id              uuid,
  group_id              uuid,
  transfer_id           uuid,
  source_key            text check (source_key is null or length(source_key) <= 128),
  source_kind           text check (source_kind is null or source_kind ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id             uuid,
  source_label          text check (source_label is null or length(source_label) <= 200),
  fd_number             text check (fd_number is null or fd_number ~ '^[0-9]{1,20}$'),
  kkt_shift             text check (kkt_shift is null or length(kkt_shift) <= 20),
  receipt_at            timestamptz,
  receipt_none          boolean not null default false,
  receipt_reason        text check (receipt_reason is null or length(receipt_reason) <= 300),
  seller_id             uuid references people.person_profiles (id),
  receipt_file_id       uuid,
  reconcile_status      text not null default 'unmatched' check (reconcile_status in ('unmatched', 'matched', 'mismatch')),
  constraint operations_storno check ((type = 'storno') = (reverses_operation_id is not null)),
  constraint operations_receipt check ((fd_number is null) = (kkt_shift is null)),
  constraint operations_receipt_none check (not receipt_none or receipt_reason is not null)
);
create unique index operations_number_idx on cash.operations (number);
create unique index operations_reverses_idx on cash.operations (reverses_operation_id) where reverses_operation_id is not null;
create unique index operations_receipt_idx on cash.operations (point_account_id, kkt_shift, fd_number) where fd_number is not null;
create index operations_account_idx on cash.operations (account_id, occurred_at desc);
create index operations_shift_idx on cash.operations (shift_id) where shift_id is not null;
create index operations_group_idx on cash.operations (group_id) where group_id is not null;
create index operations_duplicate_idx on cash.operations (point_account_id, amount_minor, method, type, occurred_at);

create table cash.source_claims (
  source_key text primary key check (length(source_key) between 3 and 128),
  group_id   uuid not null,
  claimed_by uuid references people.person_profiles (id),
  claimed_at timestamptz not null default now()
);

create table cash.operation_links (
  id           uuid primary key default gen_random_uuid(),
  operation_id uuid not null references cash.operations (id),
  source_key   text not null check (length(source_key) between 3 and 128),
  source_kind  text not null check (source_kind ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id    uuid not null,
  source_label text check (source_label is null or length(source_label) <= 200),
  linked_by    uuid not null references people.person_profiles (id),
  linked_at    timestamptz not null default now()
);
create unique index operation_links_source_idx on cash.operation_links (source_key);
create unique index operation_links_operation_idx on cash.operation_links (operation_id);

insert into cash.categories (id, title, group_name, direction, module_key, expense_category_code, sort_order) values
  ('revenue-spa', 'Выручка · услуги SPA', 'income', 'in', 'spa', null, 10),
  ('revenue-subscriptions', 'Выручка · абонементы и сертификаты', 'income', 'in', 'spa', null, 20),
  ('customer-payment', 'Оплата заказчика', 'income', 'in', 'repairs', null, 30),
  ('refund', 'Возврат клиенту', 'expense', 'out', null, null, 40),
  ('household', 'Хозяйственные расходы', 'expense', 'out', null, null, 50),
  ('fuel', 'Топливо', 'expense', 'out', 'logistics', 'fuel', 60),
  ('wash', 'Мойка', 'expense', 'out', 'logistics', null, 70),
  ('parking', 'Парковка', 'expense', 'out', 'logistics', null, 80),
  ('repair-small', 'Мелкий ремонт', 'expense', 'out', null, null, 90),
  ('materials', 'Материалы', 'expense', 'out', 'repairs', null, 100),
  ('payroll-crew', 'Выплаты бригаде', 'expense', 'out', 'repairs', null, 110),
  ('transfer', 'Перемещение', 'transfer', null, null, null, 120),
  ('opening', 'Ввод остатка', 'adjustment', null, null, null, 130),
  ('adjustment', 'Корректировка', 'adjustment', null, null, null, 140);

comment on table cash.operations is 'Журнал кассы неизменяем: runtime-роли — только INSERT (roles/grants.sql). Исправление — сторно (type storno, reverses_operation_id, не больше одного на операцию), связь с источником — cash.operation_links. Остаток кассы balance_minor меняется в той же транзакции; физическая касса не уходит в минус (accounts_physical_not_negative → 409 insufficient_funds).';
comment on table cash.source_claims is 'Ключ идемпотентности «провести предложение модуля»: один source_key — одна операция или группа операций (общий group_id); повтор — конфликт вставки → 409 duplicate_source.';
comment on column cash.operations.point_account_id is 'Касса точки: сама касса или, для эквайринга, касса, к которой привязан терминал; № ФД уникален в паре (point_account_id, kkt_shift) — Q-W4.00-cash-6.';

-- +goose Down
drop table cash.operation_links;
drop table cash.source_claims;
drop table cash.operations;
drop sequence cash.operation_number_seq;
drop table cash.accounts;
drop table cash.categories;
drop schema cash;
