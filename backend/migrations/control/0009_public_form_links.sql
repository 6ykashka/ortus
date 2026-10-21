-- W4.05 · control 0009 · индекс публичных ссылок форм: дайджест токена → тенант (маршрут гостя без tenantId)
-- +goose Up
-- Номер выдан стюардом контрактного PR 4 этапа 4 (W4.05, возврат 2 ревью; api/README.md «Номера миграций», PD-59) —
-- следующий свободный после W4.07 (0008). Контракт 0.11.0-stage4: getPublicForm, submitPublicForm и загрузки тега
-- PublicForms (W4.25) — путь /api/v1/public/forms/{publicToken} не несёт тенанта, а БД у каждого тенанта своя
-- (ADR 0006). Прецедент — invitations (token_hash → tenant_id, 0001). Источник истины ссылки — forms.public_links
-- тенанта (tenant 0026); здесь — только маршрут: тенант, форма и id ссылки, версия ключа вывода токена и отзыв.
create table public_form_links (
  token_digest text primary key check (token_digest ~ '^sha256:[0-9a-f]{64}$'),
  tenant_id    uuid not null references tenants(id),
  form_id      uuid not null,
  link_id      uuid not null,
  key_version  smallint not null default 1 check (key_version >= 1),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (tenant_id, link_id)
);
create index public_form_links_form_idx on public_form_links (tenant_id, form_id);

comment on table public_form_links is 'Индекс token_digest → tenant_id, form_id, link_id публичных ссылок форм; источник истины — forms.public_links тенанта (tenant 0026). Маршрут гостя (W4.05, возврат 2): /api/v1/public/forms/{publicToken} без tenantId. Сервер считает token_digest = ''sha256:'' || hex(SHA-256(publicToken)), находит строку с revoked_at is null, по tenant_id — БД тенанта (tenant_routing), затем ссылку в forms.public_links этой БД по id = link_id, тому же token_digest и revoked_at is null — источник истины; не нашлась — 404, как неизвестный токен. Токен выводится по комментарию forms.public_links.token_digest (HMAC-SHA256 с id тенанта — у двух тенантов разные токены, дайджест уникален во всём control). Выпуск: id ссылки задаёт сервер, сначала строка здесь, затем строка тенанта (не записалась строка тенанта — строка здесь удаляется; оставшаяся строка без пары в тенанте ведёт в 404). Отзыв и смена ключа: сначала forms.public_links тенанта, затем revoked_at здесь. Удаление тенанта — до удаления строки tenants строки здесь удаляются.';
-- +goose Down
drop index public_form_links_form_idx;
drop table public_form_links;
