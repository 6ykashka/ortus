-- W1.00 · control 0004 · последний выбранный бизнес аккаунта (S1-07, шаг 1.3) · номер выдал стюард (PD-59)
-- +goose Up
-- Переключатель бизнеса (selectTenant) запоминает выбор: MeContext.lastTenantId (контракт 0.3.0-stage1).
-- Хранится в control DB, потому что выбор делается до входа в tenant DB (Q-W0.08-1). Организация из реестра;
-- если её запись удалят, выбор обнуляется (момент выбора остаётся для аудита).
alter table accounts
  add column last_tenant_id uuid references tenants(id) on delete set null,
  add column last_tenant_at timestamptz;
-- +goose Down
alter table accounts
  drop column last_tenant_at,
  drop column last_tenant_id;
