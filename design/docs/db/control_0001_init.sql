-- Ортус · Control DB · миграция 0001 (черновик v0.2, 01.10.2026)
-- Реестр тенантов, глобальные аккаунты, членства, подписки, лимиты, поддержка.
-- Бизнес-данных (рейсы, клиенты, фото) здесь нет — см. 02-architecture §2.
-- Применяется ролью migrator; у runtime-роли API только DML на перечисленные таблицы.

-- PostgreSQL ≥ 13: gen_random_uuid() встроена, pgcrypto не нужен. Проверено на PostgreSQL 16.4.

create type tenant_state as enum
  ('provisioning','trial','active','grace','read_only','suspended','closing','closed'); -- PLAT-02
create type membership_status as enum ('invited','active','suspended','ended');

create table accounts (
  id            uuid primary key default gen_random_uuid(),
  issuer        text not null,                      -- OIDC iss
  subject       text not null,                      -- OIDC sub
  email_norm    text not null,                      -- lower(trim(email)), только для поиска приглашений
  display_name  text not null,
  status        text not null default 'active' check (status in ('active','locked','deleted')),
  created_at    timestamptz not null default now(),
  unique (issuer, subject)
);
create index accounts_email_idx on accounts (email_norm);

create table tenants (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  display_name     text not null,
  industry_pack    text not null check (industry_pack in ('logistics','spa','repair','custom')),
  state            tenant_state not null default 'provisioning',
  state_reason     text,
  state_changed_at timestamptz not null default now(),
  revision         integer not null default 1,
  created_at       timestamptz not null default now()
);

-- Маршрутизация: tenant_id → БД. Секрет хранится во внешнем хранилище, здесь только ссылка.
create table tenant_routing (
  tenant_id      uuid primary key references tenants(id),
  cluster_ref    text not null,
  database_name  text not null unique,
  secret_ref     text not null,
  schema_version bigint not null default 0,         -- версия схемы tenant DB для migration controller
  sentinel       uuid not null,                     -- должен совпасть с core.tenant_identity.tenant_id
  updated_at     timestamptz not null default now()
);

create table memberships (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  account_id        uuid not null references accounts(id),
  status            membership_status not null default 'invited',
  person_profile_id uuid not null,                  -- ссылка в tenant DB (без FK: другая БД)
  created_at        timestamptz not null default now(),
  ended_at          timestamptz,
  revision          integer not null default 1,
  unique (tenant_id, account_id)
);
create index memberships_account_idx on memberships (account_id) where status = 'active';

-- Владение — не роль. Инвариант «≥1 активный владелец» проверяется в сервисе
-- под SELECT ... FOR UPDATE строки tenants (AUTH-08).
create table owner_bindings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  membership_id uuid not null references memberships(id),
  granted_at    timestamptz not null default now(),
  granted_by    uuid,                               -- membership или operator
  revoked_at    timestamptz,
  revoke_reason text
);
create unique index owner_bindings_active_uq on owner_bindings (tenant_id, membership_id) where revoked_at is null;

create table invitations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  email_norm        text not null,
  token_hash        bytea not null unique,          -- храним только hash одноразового токена
  person_profile_id uuid not null,
  created_by        uuid not null references memberships(id),
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  accepted_account  uuid references accounts(id),
  revoked_at        timestamptz,
  check (expires_at > created_at)
);

create table subscriptions (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  plan_code  text not null,
  period     tstzrange not null,
  state      text not null check (state in ('trial','active','grace','ended')),
  created_at timestamptz not null default now()
);
create index subscriptions_tenant_idx on subscriptions (tenant_id, lower(period) desc);

-- Entitlement: что разрешено коммерчески. Версионируется, правки только новой строкой (PLAT-02, A-10).
create table entitlements (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  feature_key   text not null,                      -- 'module.logistics', 'seats', 'storage.bytes'
  source_type   text not null check (source_type in ('plan','addon','trial','manual')),
  source_ref    text,
  limit_value   bigint,                             -- null = флаг без числового лимита
  limit_unit    text check (limit_unit in ('seats','bytes','flag')),
  effective     tstzrange not null,
  version       integer not null,
  reason        text not null,
  actor_id      uuid not null,
  created_at    timestamptz not null default now(),
  unique (tenant_id, feature_key, version)
);

-- Операторы — системная организация «Ортус · Платформа». Аккаунты операторов выдаёт отдельный realm
-- (accounts.issuer = realm ortus-operators) и они не состоят в организациях клиентов: проверка в сервисе.
-- Инварианты в сервисе под FOR UPDATE: ≥2 активных owner; нельзя менять роль себе и отключать себя.
create table platform_operators (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null unique references accounts(id),
  role        text not null check (role in ('owner','admin','billing','support')),
  status      text not null default 'invited' check (status in ('invited','active','disabled')),
  invited_by  uuid references platform_operators(id),
  disabled_at timestamptz,
  disabled_by uuid references platform_operators(id),
  created_at  timestamptz not null default now(),
  check ((status = 'disabled') = (disabled_at is not null)),
  check (role <> 'owner' or status <> 'invited')        -- владельцем назначают только работающего оператора
);

-- Временный доступ поддержки: по умолчанию read-only, ≤ 60 мин, без начислений (02-architecture §13).
create table support_grants (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  operator_id   uuid not null references platform_operators(id),
  purpose       text not null,
  actions       text[] not null,
  approved_by   uuid references memberships(id),    -- null только для break-glass
  break_glass   boolean not null default false,
  valid         tstzrange not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  check (upper(valid) - lower(valid) <= interval '60 minutes' or break_glass),
  check (approved_by is not null or break_glass),
  check (not ('fleet.earnings.read' = any(actions)))
);

create table platform_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_kind  text not null check (actor_kind in ('operator','owner','system')),
  actor_id    uuid,
  action      text not null,
  target_type text not null,
  target_id   uuid,
  reason      text,
  result      text not null check (result in ('ok','denied','failed')),
  request_id  text not null,
  details     jsonb not null default '{}'
);
create index platform_audit_target_idx on platform_audit (target_type, target_id, at desc);
