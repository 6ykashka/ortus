-- W1.03 · control 0006 · вход BFF (S1-05, S1-06): durable-сессии, записи входа OIDC, автор приглашения владельца
-- +goose Up
-- Номер — следующий из резерва этапа 1 «0006+: сессии BFF W1.03» (api/README.md «Номера миграций», PD-59);
-- accounts.last_tenant_id (S1-07) выдан стюардом W1.00 в control 0004.

-- Q-W0.09-8: сессии BFF. Cookie несёт случайный идентификатор, здесь — только его SHA-256: утечка таблицы не даёт
-- живых сессий. Отзыв мягкий (revoked_at): повтор logout с тем же Idempotency-Key отвечает тем же результатом.
create table auth_sessions (
  id_hash         bytea primary key,
  account_id      uuid not null references accounts(id),
  csrf_token      text not null,                       -- синхронизирующий токен сессии (getCsrfToken)
  provider        text not null,                       -- issuer провайдера входа; '' — dev-вход
  auth_time       timestamptz not null,                -- время аутентификации у IdP (свежий вход, AUTH-08)
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  logout_key      text,                                -- Idempotency-Key выхода, отозвавшего сессию
  end_session_url text,                                -- результат выхода для повтора
  check (expires_at > issued_at),
  check ((logout_key is null) or (revoked_at is not null))
);
create index auth_sessions_account_idx on auth_sessions (account_id) where revoked_at is null;
create index auth_sessions_expiry_idx on auth_sessions (expires_at);

-- Одноразовая запись входа OIDC Authorization Code + PKCE (startLogin → completeLogin). Pre-auth cookie несёт
-- случайный дескриптор, здесь — его SHA-256. Запись удаляется при первом чтении и живёт 10 минут.
create table auth_login_states (
  id_hash       bytea primary key,
  state         text not null,
  nonce         text not null,
  code_verifier text not null,
  provider      text not null,                         -- ключ провайдера: users | operators
  return_to     text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  check (expires_at > created_at)
);
create index auth_login_states_expiry_idx on auth_login_states (expires_at);

-- Приглашение владельца новой организации выпускает оператор или система (провиженер): членства-автора у них нет
-- (отчёт W1.02, решение 3). Принятие такого приглашения создаёт owner_bindings.
alter table invitations
  alter column created_by drop not null,
  add column created_by_operator uuid references platform_operators(id),
  add column grants_owner        boolean not null default false,
  add constraint invitations_author_chk check (created_by is not null or grants_owner),
  -- Назначения приглашения в tenant DB (access.role_assignments, state dormant): принятие делает active только их,
  -- а не любые dormant-назначения профиля (dormant — ещё и права отключённого модуля, A-09). Без FK: другая БД.
  add column role_assignment_ids uuid[] not null default '{}';
-- +goose Down
-- Приглашение владельца без автора не вернуть под NOT NULL created_by: Down не удаляет такие приглашения, а падает на
-- set not null («column created_by contains null values»), миграция откатывается целиком. Сначала отзовите или
-- удалите приглашения владельцев вручную.
alter table invitations
  drop column role_assignment_ids,
  drop constraint invitations_author_chk,
  drop column created_by_operator,
  drop column grants_owner,
  alter column created_by set not null;
drop table auth_login_states;
drop table auth_sessions;
