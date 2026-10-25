-- W5.00 · tenant 0041 · «Касса»: смены, попытки закрытия, перемещения (контракт 0.12.0-stage5, W5.31).
-- Разбор docs/plan/v2/analysis/dor/cash.md §2.1 (Q-W4.00-cash-4, -5, -15), docs/26-cash.md «Модель данных».
-- Смена: open → review (расхождение выше допуска) | closed; одна открытая на кассу (shifts_open_idx), номер — по кассе.
-- Попытка закрытия — неизменяемая запись (только INSERT для runtime-ролей): «Вернуть на пересчёт» её не стирает, смена
-- снова open (Q-W4.00-cash-4, PD-60). Перемещение двумя сторонами: transit → done | rejected (с причиной); операции
-- перемещения ссылаются на него (deferred FK: перемещение и его операции создаются в одной транзакции).
-- +goose Up
create table cash.shifts (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references cash.accounts (id),
  number                integer not null check (number >= 1),
  status                text not null check (status in ('open', 'review', 'closed')),
  opened_at             timestamptz not null default now(),
  opened_by             uuid not null references people.person_profiles (id),
  opening_float_minor   bigint not null default 0 check (opening_float_minor >= 0),
  opening_diff_minor    bigint,
  closed_at             timestamptz,
  closed_by             uuid references people.person_profiles (id),
  counted_minor         bigint check (counted_minor is null or counted_minor >= 0),
  counts                jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  coins_minor           bigint check (coins_minor is null or coins_minor >= 0),
  z_number              text check (z_number is null or length(z_number) <= 20),
  z_cash_minor          bigint check (z_cash_minor is null or z_cash_minor >= 0),
  z_card_minor          bigint check (z_card_minor is null or z_card_minor >= 0),
  term_card_minor       bigint check (term_card_minor is null or term_card_minor >= 0),
  term_sbp_minor        bigint check (term_sbp_minor is null or term_sbp_minor >= 0),
  expected              jsonb check (expected is null or jsonb_typeof(expected) = 'object'),
  diff                  jsonb check (diff is null or jsonb_typeof(diff) = 'object'),
  decision_kind         text check (decision_kind is null or decision_kind in ('auto', 'accepted')),
  decision_by           uuid references people.person_profiles (id),
  decision_at           timestamptz,
  decision_reason       text check (decision_reason is null or length(decision_reason) <= 500),
  decision_operation_id uuid references cash.operations (id),
  to_safe_transfer_id   uuid,
  revision              integer not null default 1 check (revision >= 1),
  constraint shifts_closed check (status = 'open' or (closed_at is not null and closed_by is not null and counted_minor is not null))
);
create unique index shifts_number_idx on cash.shifts (account_id, number);
create unique index shifts_open_idx on cash.shifts (account_id) where status = 'open';
create index shifts_status_idx on cash.shifts (status) where status <> 'closed';

create table cash.shift_close_attempts (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references cash.shifts (id),
  closed_at       timestamptz not null default now(),
  closed_by       uuid not null references people.person_profiles (id),
  counted_minor   bigint not null check (counted_minor >= 0),
  counts          jsonb not null default '{}' check (jsonb_typeof(counts) = 'object'),
  z               jsonb check (z is null or jsonb_typeof(z) = 'object'),
  terminal        jsonb check (terminal is null or jsonb_typeof(terminal) = 'object'),
  diff            jsonb check (diff is null or jsonb_typeof(diff) = 'object'),
  recount_reason  text check (recount_reason is null or length(recount_reason) <= 500)
);
create index shift_close_attempts_shift_idx on cash.shift_close_attempts (shift_id, closed_at);

create table cash.shift_reviews (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references cash.shifts (id),
  attempt_id  uuid not null references cash.shift_close_attempts (id),
  decision    text not null check (decision in ('accept', 'recount')),
  reason      text not null check (length(btrim(reason)) between 1 and 500),
  decided_by  uuid not null references people.person_profiles (id),
  decided_at  timestamptz not null default now()
);
create unique index shift_reviews_attempt_idx on cash.shift_reviews (attempt_id);

create table cash.transfers (
  id                  uuid primary key default gen_random_uuid(),
  from_account_id     uuid not null references cash.accounts (id),
  to_account_id       uuid not null references cash.accounts (id),
  amount_minor        bigint not null check (amount_minor > 0),
  currency            char(3) not null default 'RUB' check (currency ~ '^[A-Z]{3}$'),
  note                text check (note is null or length(note) <= 300),
  purpose             text not null check (purpose in ('transfer', 'shift_handover', 'advance_issue', 'advance_return')),
  status              text not null default 'transit' check (status in ('transit', 'done', 'rejected')),
  sent_by             uuid not null references people.person_profiles (id),
  sent_at             timestamptz not null default now(),
  decided_by          uuid references people.person_profiles (id),
  decided_at          timestamptz,
  reason              text check (reason is null or length(reason) <= 500),
  out_operation_id    uuid references cash.operations (id),
  in_operation_id     uuid references cash.operations (id),
  back_operation_id   uuid references cash.operations (id),
  revision            integer not null default 1 check (revision >= 1),
  constraint transfers_distinct check (from_account_id <> to_account_id),
  constraint transfers_rejected_reason check (status <> 'rejected' or reason is not null),
  constraint transfers_decided check ((status = 'transit') = (decided_at is null))
);
create index transfers_status_idx on cash.transfers (status) where status = 'transit';
create index transfers_from_idx on cash.transfers (from_account_id);
create index transfers_to_idx on cash.transfers (to_account_id);

alter table cash.shifts add constraint shifts_to_safe_fk foreign key (to_safe_transfer_id) references cash.transfers (id) deferrable initially deferred;
alter table cash.operations add constraint operations_shift_fk foreign key (shift_id) references cash.shifts (id);
alter table cash.operations add constraint operations_transfer_fk foreign key (transfer_id) references cash.transfers (id) deferrable initially deferred;

comment on table cash.shift_close_attempts is 'Попытки закрытия смены неизменяемы: «Вернуть на пересчёт» сохраняет попытку и возвращает смену в open (Q-W4.00-cash-4, PD-60). Только INSERT для runtime-ролей (roles/grants.sql).';
comment on table cash.shift_reviews is 'Решение по попытке закрытия (принять расхождение или вернуть на пересчёт) — отдельная неизменяемая запись, одна на попытку: CashShiftCloseAttempt.recountReason выводится из неё, а сама попытка не правится. Только INSERT для runtime-ролей.';

-- +goose Down
alter table cash.operations drop constraint operations_transfer_fk;
alter table cash.operations drop constraint operations_shift_fk;
alter table cash.shifts drop constraint shifts_to_safe_fk;
drop table cash.transfers;
drop table cash.shift_reviews;
drop table cash.shift_close_attempts;
drop table cash.shifts;
