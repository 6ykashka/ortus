-- W7.00 · control 0011 · маршрут публичных путей этапа 7 к тенанту: токены внешних ссылок документов, токены портала обращений, slug публичных страниц направлений
-- +goose Up
-- Номер выдан стюардом контрактного PR этапа 7 (W7.00, возврат 1 ревью; api/README.md «Номера миграций», PD-59):
-- следующий свободный control после 0009. Контракт 0.12.0-stage7: openDocLink (/public/doc-links/{token}/open),
-- getPublicServicePage и submitPublicServiceRequest (/public/service/{slug}...), getPublicServiceRequest и операции
-- над обращением (/public/service/requests/{token}...) не несут tenantId в пути, а БД у каждого тенанта своя (ADR 0006).
-- Прецедент — control 0009 (public_form_links, W4.05) и invitations (token_hash → tenant_id, 0001): индекс «токен или
-- slug → тенант» здесь, источник истины — таблицы тенанта (docs.links, service.portal_tokens, service.directions).
-- Токен не хранится нигде, только дайджест sha256:hex(SHA-256(токен)); токен — не менее 20 случайных символов, поэтому
-- дайджест уникален во всём control (первичный ключ), а выпуск при коллизии повторяется с новым токеном.
create table public_doc_links (
  token_digest text primary key check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id    uuid not null references tenants(id),
  document_id  uuid not null,
  link_id      uuid not null,
  key_version  smallint not null default 1 check (key_version >= 1),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (tenant_id, link_id)
);
create index public_doc_links_document_idx on public_doc_links (tenant_id, document_id);

create table public_service_tokens (
  token_digest text primary key check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id    uuid not null references tenants(id),
  request_id   uuid not null,
  token_id     uuid not null,
  key_version  smallint not null default 1 check (key_version >= 1),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (tenant_id, token_id)
);
create index public_service_tokens_request_idx on public_service_tokens (tenant_id, request_id);

-- Slug публичной страницы направления глобально уникален (путь без тенанта); строка принадлежит одному направлению.
create table public_service_slugs (
  slug         text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  tenant_id    uuid not null references tenants(id),
  direction_id uuid not null,
  created_at   timestamptz not null default now(),
  unique (tenant_id, direction_id)
);

comment on table public_doc_links is 'Индекс token_digest → tenant_id, document_id, link_id внешних ссылок документов; источник истины — docs.links тенанта (tenant 0061). Маршрут гостя: POST /api/v1/public/doc-links/{token}/open без tenantId. Сервер считает token_digest = ''sha256:'' || hex(SHA-256(token)), находит строку с revoked_at is null и expires_at > now(), по tenant_id — БД тенанта (tenant_routing), затем ссылку в docs.links по id = link_id и тому же token_digest; не нашлась — 404, как неизвестный токен; отозвана или истекла — 410 public_token_expired. Выпуск: id ссылки задаёт сервер, сначала строка здесь, затем строка тенанта (не записалась строка тенанта — строка здесь удаляется). Отзыв и смена: сначала docs.links, затем revoked_at здесь. Удаление тенанта — до удаления строки tenants строки здесь удаляются.';
comment on table public_service_tokens is 'Индекс token_digest → tenant_id, request_id, token_id токенов портала клиента (персональная ссылка из СМС или кабинета); источник истины — service.portal_tokens тенанта (tenant 0062). Маршрут клиента: /api/v1/public/service/requests/{token}/... без tenantId. Порядок выпуска, отзыва и поиска — как у public_doc_links; просроченный или отозванный токен — 410 public_token_expired.';
comment on table public_service_slugs is 'Глобальный реестр slug публичных страниц направлений обращений → tenant_id, direction_id; источник истины — service.directions.public_slug тенанта (tenant 0062, уникален внутри тенанта). Маршрут: GET /api/v1/public/service/{slug} и POST /api/v1/public/service/{slug}/requests без tenantId. Публикация направления: сначала строка здесь (занятый slug — 409 conflict), затем строка тенанта; снятие с публикации или смена slug — сначала тенант, затем здесь. Не найден slug — 404.';
-- +goose Down
drop table public_service_slugs;
drop index public_service_tokens_request_idx;
drop table public_service_tokens;
drop index public_doc_links_document_idx;
drop table public_doc_links;
