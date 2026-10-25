-- W5.00 · tenant 0042 · «Касса»: предложения модулей, подотчёт, заявки на согласование (контракт 0.12.0-stage5, W5.31).
-- Разбор docs/plan/v2/analysis/dor/cash.md §2.1 (Q-W4.00-cash-2, -12, -13, -16). Предложение — ключ «вид:источник»
-- (он же ключ идемпотентности проведения): open → posted | dismissed; отказ — отдельная строка с причиной. Чек
-- подотчёта: файл Files (id без внешнего ключа, срок хранения 5 лет — Files), статус review → accepted | rejected;
-- принятый чек — операция out подотчёта. Заявка сверх лимита роли: payload — запрос, который выполняется от имени
-- автора при согласовании (с повторной проверкой остатка и лимита).
-- +goose Up
create table cash.proposals (
  key                text primary key check (key ~ '^[a-z][a-z0-9_]*:[A-Za-z0-9_.-]{1,100}$'),
  kind               text not null check (kind in ('visit', 'expense', 'payroll', 'refund', 'purchase', 'invoice')),
  title              text not null check (length(title) between 1 and 300),
  amount_minor       bigint not null check (amount_minor > 0),
  currency           char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  direction          text not null check (direction in ('in', 'out')),
  default_account_id uuid references cash.accounts (id),
  category_id        text references cash.categories (id),
  source_kind        text not null check (source_kind ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id          uuid not null,
  source_label       text check (source_label is null or length(source_label) <= 200),
  parts              jsonb not null default '[]' check (jsonb_typeof(parts) = 'array'),
  status             text not null default 'open' check (status in ('open', 'posted', 'dismissed')),
  group_id           uuid,
  created_at         timestamptz not null default now(),
  posted_at          timestamptz,
  posted_by          uuid references people.person_profiles (id),
  constraint proposals_posted check ((status = 'posted') = (posted_at is not null))
);
create index proposals_status_idx on cash.proposals (status, created_at desc);
create index proposals_source_idx on cash.proposals (source_kind, source_id);

create table cash.proposal_dismissals (
  proposal_key text primary key references cash.proposals (key),
  reason       text not null check (length(btrim(reason)) between 3 and 500),
  dismissed_by uuid not null references people.person_profiles (id),
  dismissed_at timestamptz not null default now()
);

create table cash.advance_receipts (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references cash.accounts (id),
  amount_minor        bigint not null check (amount_minor > 0),
  currency            char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  category_id         text not null references cash.categories (id),
  link_kind           text check (link_kind is null or link_kind ~ '^[a-z][a-z0-9_]{1,49}$'),
  link_id             uuid,
  link_label          text check (link_label is null or length(link_label) <= 200),
  note                text check (note is null or length(note) <= 500),
  file_id             uuid not null,
  qr                  text check (qr is null or length(qr) <= 500),
  status              text not null default 'review' check (status in ('review', 'accepted', 'rejected')),
  reason              text check (reason is null or length(reason) <= 500),
  operation_id        uuid references cash.operations (id),
  submitted_by        uuid not null references people.person_profiles (id),
  submitted_at        timestamptz not null default now(),
  decided_by          uuid references people.person_profiles (id),
  decided_at          timestamptz,
  redo_of_receipt_id  uuid references cash.advance_receipts (id),
  revision            integer not null default 1 check (revision >= 1),
  constraint advance_receipts_decided check ((status = 'review') = (decided_at is null)),
  constraint advance_receipts_rejected check (status <> 'rejected' or reason is not null)
);
create index advance_receipts_account_idx on cash.advance_receipts (account_id, submitted_at desc);
create index advance_receipts_status_idx on cash.advance_receipts (status) where status = 'review';

create table cash.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references cash.accounts (id),
  type          text not null check (type in ('out', 'refund', 'issue')),
  amount_minor  bigint not null check (amount_minor > 0),
  currency      char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  method        text check (method is null or method in ('cash', 'card', 'sbp', 'transfer')),
  category_id   text references cash.categories (id),
  basis         text check (basis is null or length(basis) <= 500),
  source_kind   text check (source_kind is null or source_kind ~ '^[a-z][a-z0-9_]{1,49}$'),
  source_id     uuid,
  source_label  text check (source_label is null or length(source_label) <= 200),
  payload       jsonb not null check (jsonb_typeof(payload) = 'object'),
  limit_minor   bigint check (limit_minor is null or limit_minor >= 0),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by  uuid not null references people.person_profiles (id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references people.person_profiles (id),
  decided_at    timestamptz,
  reason        text check (reason is null or length(reason) <= 500),
  operation_id  uuid references cash.operations (id),
  transfer_id   uuid references cash.transfers (id),
  revision      integer not null default 1 check (revision >= 1),
  constraint approval_requests_decided check ((status = 'pending') = (decided_at is null)),
  constraint approval_requests_self check (decided_by is null or decided_by <> requested_by)
);
create index approval_requests_status_idx on cash.approval_requests (status, requested_at desc);

comment on table cash.approval_requests is 'Заявка сверх лимита роли (Q-W4.00-cash-2): payload — запрос постановки; согласование выполняет его от имени автора с approved_by, повторно проверяя остаток и лимит (409 insufficient_funds); автор не решает свою заявку (approval_requests_self → 403 self_approval).';

-- +goose Down
drop table cash.approval_requests;
drop table cash.advance_receipts;
drop table cash.proposal_dismissals;
drop table cash.proposals;
