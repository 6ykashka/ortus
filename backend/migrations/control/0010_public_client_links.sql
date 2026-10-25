-- W6.00 · control 0010 · индекс публичных ссылок кабинета заказчика: дайджест токена → тенант (маршрут гостя без tenantId)
-- +goose Up
-- Номер выдан стюардом контрактного PR этапа 6 (W6.00; api/README.md «Номера миграций», PD-59) — следующий свободный
-- после W4.05 (0009). Контракт 0.12.0-stage6: getClientCabinet, approveEstimateByClient и signDocumentByClient тега
-- Repairs — путь /api/v1/public/client/{clientToken} не несёт тенанта, а БД у каждого тенанта своя (ADR 0006).
-- Прецедент — public_form_links (0009) и invitations (token_hash → tenant_id, 0001). Источник истины ссылки —
-- repairs.client_links тенанта (tenant 0054); здесь — только маршрут: тенант, объект и id ссылки, версия ключа и отзыв.
create table public_client_links (
  token_digest text primary key check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id    uuid not null references tenants(id),
  project_id   uuid not null,
  link_id      uuid not null,
  key_version  smallint not null default 1 check (key_version >= 1),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (tenant_id, link_id)
);
create index public_client_links_project_idx on public_client_links (tenant_id, project_id);

comment on table public_client_links is 'Индекс token_digest → tenant_id, project_id, link_id публичных ссылок кабинета заказчика; источник истины — repairs.client_links тенанта (tenant 0054). Маршрут гостя (W6.00): /api/v1/public/client/{clientToken} без tenantId. Сервер считает token_digest = ''sha256:'' || hex(SHA-256(clientToken)), находит строку с revoked_at is null, по tenant_id — БД тенанта (tenant_routing), затем ссылку в repairs.client_links этой БД по id = link_id, тому же token_digest, revoked_at is null и сроку — источник истины; не нашлась или отозвана — 410 public_token_expired. Выпуск: id ссылки задаёт сервер, сначала строка здесь, затем строка тенанта (не записалась строка тенанта — строка здесь удаляется). Отзыв и сдача объекта: сначала repairs.client_links тенанта, затем revoked_at здесь. Удаление тенанта — до удаления строки tenants строки здесь удаляются.';
-- +goose Down
drop index public_client_links_project_idx;
drop table public_client_links;
