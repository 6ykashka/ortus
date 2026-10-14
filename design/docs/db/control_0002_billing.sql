-- Ортус · Control DB · миграция 0002 billing (черновик v0.2, 01.10.2026)
-- Тарифная сетка по ступеням мест, подписка с лимитом мест, заявки владельца, блокировка аккаунта.
-- Цены — данные, не код. Документ: docs/17-users-and-billing.md.
-- Проверено на PostgreSQL 16.4. Публикация новой версии: в одной транзакции закрыть effective
-- текущей версии (upper = дата начала новой) и вставить новую — иначе сработает EXCLUDE.

create extension if not exists btree_gist;

-- Версия тарифной сетки неизменяема после публикации. Новая версия — новая строка.
create table price_book_versions (
  version      integer primary key,
  effective    tstzrange not null,                 -- [с, до); у действующей верхняя граница null
  note         text not null,
  published_by uuid not null references platform_operators(id),
  published_at timestamptz not null default now(),
  exclude using gist (effective with &&)           -- две версии не действуют одновременно
);

create table price_tiers (
  version     integer not null references price_book_versions(version),
  tier_code   text not null check (tier_code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null,
  seats_limit integer check (seats_limit is null or seats_limit > 0),   -- null = безлимит
  month_minor bigint check (month_minor is null or month_minor > 0),    -- null = индивидуальный расчёт
  currency    char(3) not null default 'RUB',
  sort        integer not null,
  primary key (version, tier_code),
  unique (version, sort),
  check ((seats_limit is null) = (month_minor is null))
);

create table price_terms (
  version      integer not null references price_book_versions(version),
  months       integer not null check (months in (1, 4, 8, 12)),
  discount_pct numeric(4,1) not null check (discount_pct >= 0 and discount_pct < 50),
  primary key (version, months)
);

-- Подписка организации: что куплено и по какой версии цен. Лимит мест хранится в entitlements
-- (feature_key = 'seats'), здесь — коммерческие условия периода.
alter table subscriptions
  add column tier_code      text,
  add column term_months    integer check (term_months in (1, 4, 8, 12)),
  add column price_version  integer references price_book_versions(version),
  add column amount_minor   bigint check (amount_minor is null or amount_minor >= 0),
  add constraint subscriptions_tier_fk foreign key (price_version, tier_code) references price_tiers(version, tier_code);

-- Заявка владельца на смену тарифа. Подтверждает оператор; одна открытая заявка на организацию.
create table subscription_change_requests (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,               -- SR-000021
  tenant_id       uuid not null references tenants(id),
  from_tier       text,
  to_tier         text not null,
  term_months     integer not null check (term_months in (1, 4, 8, 12)),
  price_version   integer not null references price_book_versions(version),
  quoted_minor    bigint,                             -- расчёт на момент заявки; null = индивидуально
  seats_used      integer not null check (seats_used >= 0),
  comment         text,
  requested_by    uuid not null references memberships(id),
  requested_at    timestamptz not null default now(),
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by      uuid references platform_operators(id),
  decided_at      timestamptz,
  decision_note   text,
  foreign key (price_version, to_tier) references price_tiers(version, tier_code),
  check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) > 0),
  check ((status in ('approved','rejected')) = (decided_by is not null))
);
create unique index scr_one_pending_uq on subscription_change_requests (tenant_id) where status = 'pending';

-- Глобальная блокировка входа (безопасность), не связана с неоплатой и не меняет членства.
alter table accounts
  add column locked_at     timestamptz,
  add column locked_by     uuid references platform_operators(id),
  add column lock_reason   text,
  add column mfa_enabled   boolean not null default false,
  add column last_login_at timestamptz,
  add constraint accounts_lock_reason_chk check (locked_at is null or length(trim(coalesce(lock_reason, ''))) > 0);

-- Занятые места = активные + приглашённые членства. Проекция для каталога и проверки лимита.
create view tenant_seat_usage as
  select t.id as tenant_id,
         count(m.id) filter (where m.status in ('active','invited'))::int as seats_used,
         count(m.id) filter (where m.status = 'invited')::int            as seats_invited
    from tenants t left join memberships m on m.tenant_id = t.id
   group by t.id;

-- Проверка лимита при приглашении выполняется в одной транзакции:
--   select ... from tenants where id = $1 for update;                        -- сериализует приглашения тенанта
--   select seats_used from tenant_seat_usage where tenant_id = $1;
--   select limit_value from entitlements where tenant_id = $1 and feature_key = 'seats' and effective @> now()
--     order by version desc limit 1;
--   seats_used >= limit_value → 409 seats_exhausted; иначе insert into memberships (status 'invited').
