-- W1.00 · control 0005 · ключи идемпотентности команд control-plane (S1-25, шаг 1.1) · номер выдал стюард (PD-59)
-- +goose Up
-- Команды оператора (suspendPlatformTenant, extendPlatformTrial…) и /me (selectTenant, markMyNotificationsRead)
-- меняют control DB, поэтому их Idempotency-Key хранится здесь — как core.idempotency_keys в tenant DB.
-- Пространство ключа — тенант + actor + операция (параметр IdempotencyKey контракта, 03-api-guide,
-- 02-architecture «Изоляция … idempotency keys»): в tenant DB тенант задан самой базой, здесь — явно.
-- Пространство задаёт шлюз W1.01 (cmd/api/gate.go namespace → idem.Namespace): tenant_id — тенант контекста
-- tenantctx; у identity-операций (/me, в том числе selectTenant и markMyNotificationsRead) и операций
-- платформы (/platform/…, даже с tenantId в пути) тенанта контекста нет, uuid.Nil пишется как null.
-- null не отличается от null (nulls not distinct): повтор selectTenant после смены выбранной организации
-- попадает в то же пространство и отдаёт сохранённый ответ, а не выполняет команду снова.
-- request_hash — sha-256 (idem.requestHash W1.01): метод, путь, строка запроса, тело. Тот же ключ с другим
-- путём (другой tenantId платформенной команды), строкой запроса или телом — 409 idempotency_key_reused.
-- Повтор с тем же ключом и запросом отдаёт сохранённый ответ; незавершённая — 409 и Retry-After.
-- createRealtimeTicket сюда не пишет: одноразовый билет не хранится и не повторяется (ADR-0015).
-- Уборщик (W1.01) удаляет строки после expires_at.
create table idempotency_keys (
  id              bigint generated always as identity primary key,
  actor_id        uuid not null,                       -- accounts.id оператора или участника
  tenant_id       uuid,                                -- tenants.id команды; без FK: строка живёт до expires_at
  operation       text not null,                       -- operationId контракта
  key             text not null check (length(key) between 16 and 128),
  request_hash    bytea not null,
  state           text not null check (state in ('in_progress','completed')),
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  constraint idempotency_keys_scope_key unique nulls not distinct (actor_id, tenant_id, operation, key),
  check (state = 'in_progress' or response_status is not null)
);
create index idempotency_keys_expiry_idx on idempotency_keys (expires_at);
-- +goose Down
drop table idempotency_keys;
