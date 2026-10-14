# 09. Модель данных, права и контракт ошибок

Рабочая карта для агентов, реализующих backend-платформу (tenant resolver, authz, миграции), контракт (OpenAPI + `permissions.yaml`) и клиентскую обработку ошибок. Все пути ниже — относительно `design/`. Цитаты подписей и текстов — дословные. Пометка «⚠ не найдено в источниках» означает, что источники не дают ответа.

## 1. Источники

| Файл | Прочитано | Что взято |
|---|---|---|
| `docs/10-data-model.md` | 1–141 | СУБД и проверка миграций (5–24), принципы (26–39), ERD (41–80), жизненные циклы (82–109), инварианты (111–126), что не в схеме (128–133), вопросы (135–140) |
| `docs/db/control_0001_init.sql` | 1–162 | 11 таблиц control DB |
| `docs/db/control_0002_billing.sql` | 1–95 | тарифная сетка, заявки, блокировка аккаунта, view `tenant_seat_usage`, процедура проверки мест (89–95) |
| `docs/db/control_0003_branding.sql` | 1–35 | версии оформления, view, `accounts.ui_theme`, правила сервиса (31–35) |
| `docs/db/tenant_0001_core.sql` | 1–296 | 24 таблицы ядра tenant DB в 9 схемах |
| `docs/db/tenant_0002_fleet.sql` | 1–207 | 11 таблиц `fleet` + `finance.earnings` |
| `docs/11-permissions.yaml` | 1–191 | 77 action keys, 5 шаблонов ролей, `prototype_renames` |
| `docs/12-errors-and-events.md` | 1–100 | формат Problem, 36 кодов, 11 групп событий, соглашения API |
| `docs/17-users-and-billing.md` | 1–217 | места (30–46), сетка (48–78), заявки (80–96), каталог аккаунтов (98–118), права (120–130), API и новые коды (132–153), операторы (155–184) |
| `docs/18-branding.md` | 1–118 | ограничения полей (18–29), цвет (38–45), термины (47–53), меню (55–59), версии (61–63), API и права (73–83), изоляция (85–103) |
| `docs/19-construction.md` | 1–176 | заявки как задачи (15–29), карточка объекта (57–108), черновик схемы `repairs` (135–150), API (152–164) |
| `docs/v0.1/02-architecture.md` | 46–61, 88–141, 143–160, 161–185, 249–310 | изоляция, evaluator `permit()`, матрица холдинга, обмен и hold-бронь, подписки/квоты, инварианты Go-модулей, поддержка и break-glass |
| `docs/v0.1/03-api-guide.md` | 1–170 | общие правила (30–36), вход (38–44), авторизация (46–56), конкурентность (58–66), деньги/даты/страницы (68–76), ошибки (78–93), модули (129–135) |
| `docs/v0.1/ortus-openapi-v0.1.yaml` | 6904–6975 + выборка `x-permissions` | схемы `Problem`, `Scope`, `Permission`; 82 уникальных ключа в `x-permissions` |
| `docs/15-quality-security.md` | 1–62 | пирамида тестов, фикстуры изоляции, AC → тесты |
| `docs/13-backlog-s0-s2.md` | 1–140 | истории S1-11…S1-25, S2-03…S2-14 с размерами |
| `docs/14-engineering.md` | 1–127 | стек, схемы → модули, роли БД, перенос прототипа |
| `docs/16-raid-glossary.md` | 1–107 | решения D-03/D-05/D-06/D-09/D-10/D-12, глоссарий |
| `docs/README.md` | 45–51 | известные расхождения прототипа и v0.2 |
| `docs/design-system/components.md` | 24–25 | контракт `Banner`, `AccessGate` |
| `ortus/models.js` | 1–305 | `REASON`, состояния, `can()`, `canEarnings()`, `rolePermKeys()`, валидации |
| `ortus/mock-data.js` | 1–276 | все сущности сида «Альта» и «Лотос», platform |
| `ortus/extra-data.js` | 1–85 | календарь, база знаний, SPA, касса, ремонт |
| `ortus/api.js` | 1–627 | коды `ApiError` и тексты, `view()` (фильтрация ответа по правам), http-адаптер |
| `Ортус CRM.dc.html` | 59–69, 81, 115, 334–361, 2365–2367, 2440–2460, 2750–2762, 2903–2931, 3136, 3195–3238, 3437 | демо-флаги, тост/`run()`, вкладка «Проверка доступа», редактор роли, «Путь проверки» |
| `docs/plan/decisions.md`, `tdd-protocol.md`, `verification-protocol.md`, `orchestration.md` | целиком | формат чек-листа, фазы PD-15, сид PD-19, PostgreSQL 17 в testcontainers |

## 2. Сводка

- Две базы: **control DB** (тенанты, аккаунты, членства, владение, подписки, entitlements, операторы, поддержка, тарифы, заявки, оформление) и **одна tenant DB на клиента** (11 схем, 36 таблиц после 0001+0002). Control DB не хранит бизнес-данных (`10-data-model.md:30`, `control_0001_init.sql:3`).
- PostgreSQL ≥ 13, расширение `btree_gist` обязательно (`10-data-model.md:7`; `tenant_0001_core.sql:6`; `control_0002_billing.sql:7`). Миграции проверены на 16.4 (`10-data-model.md:9`); `tdd-protocol.md:25` задаёт testcontainers PostgreSQL 17 — несовпадение версий см. §9.
- Идентификаторы — UUID v4; человекочитаемые номера (`TR-2026-000123`, `SR-000021`) из `core.counters` через `UPDATE … RETURNING`, не `max()+1` (`tenant_0001_core.sql:40–45`; `control_0002_billing.sql:51`).
- Деньги — `bigint amount_minor + char(3) currency`; количества — `numeric`; время — `timestamptz` + IANA-зона подразделения; интервалы `tstzrange` полуоткрытые `[)` (`10-data-model.md:34–36`).
- Оптимистичная блокировка: `revision integer` → ETag / `If-Match`; отсутствие заголовка — 428, устаревший — 412 (`10-data-model.md:37`; `12-errors-and-events.md:58,63`).
- Неизменяемые записи (только INSERT): версии ролей, версии чек-листов, версии тарифной сетки, версии оформления, аудит, outbox, entitlements (`10-data-model.md:38`; `control_0001_init.sql:98`; `control_0002_billing.sql:9`; `control_0003_branding.sql:6`).
- Права: 77 action keys в 11 модулях; уровни `view/create/edit/review/export/settings`; чувствительность `normal/sensitive/restricted`; `restricted` запрещён функции `driver` и не входит в шаблоны по умолчанию (`11-permissions.yaml:5–10`).
- Владение — `owner_bindings`, не роль; инвариант «≥ 1 активный владелец» проверяет сервис под `SELECT … FOR UPDATE` строки `tenants` (`control_0001_init.sql:60–61`; `11-permissions.yaml:147`).
- Роль без wildcard (`CHECK (not ('*' = any(actions)))`, `tenant_0001_core.sql:129`); назначение всегда с областью (`CHECK ((scope_kind in ('tenant','self')) = (scope_ref is null))`, `:164`).
- Функция `driver` (`people.work_profiles`) блокирует `fleet.earnings.*` через любую роль, группу и OwnerBinding; конфликт при назначении — `409 separation_of_duties_conflict`, при вызове — `403 function_blocked` (`11-permissions.yaml:113–114`; `12-errors-and-events.md:39,50`; `02-architecture.md:139`).
- Ошибки — RFC 9457 `application/problem+json` с обязательными `type, title, status, code, requestId`; интерфейс выбирает текст по `code`, показывает `requestId` мелким шрифтом с кнопкой «Скопировать» (`12-errors-and-events.md:7–24`; OpenAPI `Problem` 6904–6935).
- 404 для чужих и несуществующих ID одинаково; 403 — только когда объект свой или не раскрывает существование (`12-errors-and-events.md:41`; `03-api-guide.md:86`; `02-architecture.md:293`).
- Идемпотентность всех изменяющих команд: `Idempotency-Key` (UUID v4), namespace `actor + operation + key`, хранится hash и ответ; тот же ключ + другой payload → `409 idempotency_key_reused`; выполняется → `409 idempotency_in_progress` + `Retry-After` (`tenant_0001_core.sql:27–38`; `12-errors-and-events.md:55–56,95`).
- Конкурентные инварианты в БД: `EXCLUDE USING gist` для брони (`reservations_no_overlap`), частичные unique-индексы для активных рейсов, условный `UPDATE files.usage` для квоты, `EXCLUDE` для пересекающихся функций и версий сетки (`tenant_0001_core.sql:105,201–204,250–252`; `tenant_0002_fleet.sql:57–60`; `control_0002_billing.sql:16`).
- `access.policy_state.policy_version` +1 при любом изменении ролей/назначений/модулей; права не кешируются без него в ключе; курсоры пагинации привязаны к версии scope (`tenant_0001_core.sql:109–112`; `10-data-model.md:130`; `03-api-guide.md:76`).
- Доменные события в `outbox.events` с именем `<модуль>.<сущность>.<событие>.v<версия>`, payload без restricted-полей, потребитель идемпотентен через `outbox.inbox` (`12-errors-and-events.md:71`; `tenant_0001_core.sql:274–295`).
- Прототип (`ortus/*.js`) содержит сущности, для которых SQL ещё нет: формы и ответы, задачи и проекты, база знаний, SPA (визиты, склад, списания, расхождения), касса, ремонт (объект, работы, бригада, материалы, отметки), уведомления/события, приёмка смены (решение/разделы), хранилище по модулям. См. §7.
- Прототипные ключи прав, состояния тенанта (`restricted`), коды ошибок (`conflict`, `role_conflict`, `last_owner`, `module_off`, …) и области (`region/firm`) не совпадают с каноном — таблицы соответствия в §4.4, §4.6, §5.3.

## 3. Каталог таблиц

Колонка «Владелец» — модуль/пакет по `14-engineering.md:35–39` (`internal/control`, `platform/*`, `modules/{access,org,people,modulesreg,files,sched,fleet}`); «Источник» — файл:строки DDL.

### 3.1 Control DB — `control_0001_init.sql`

| Таблица | Назначение | Ключевые колонки | Ограничения, enum, состояния | Владелец | Источник |
|---|---|---|---|---|---|
| тип `tenant_state` | enum состояний тенанта | — | `provisioning, trial, active, grace, read_only, suspended, closing, closed` (PLAT-02) | control | `control_0001_init.sql:8–9` |
| тип `membership_status` | enum членства | — | `invited, active, suspended, ended` | control | `:10` |
| `accounts` | Глобальный аккаунт (OIDC) | `id, issuer, subject, email_norm, display_name, status, created_at`; 0002 добавляет `locked_at, locked_by, lock_reason, mfa_enabled, last_login_at`; 0003 — `ui_theme` | `unique (issuer, subject)`; `status in ('active','locked','deleted')`; `accounts_lock_reason_chk`: при `locked_at` причина непустая; `ui_theme in ('system','light','dark')`; индекс по `email_norm` | control / accounts | `:12–22`; `control_0002_billing.sql:73–79`; `control_0003_branding.sql:29` |
| `tenants` | Реестр организаций | `id, slug, display_name, industry_pack, state, state_reason, state_changed_at, revision, created_at` | `slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'` unique; `industry_pack in ('logistics','spa','repair','custom')`; `state tenant_state default 'provisioning'` | control / tenants | `:24–34` |
| `tenant_routing` | tenant → БД | `tenant_id (PK, FK), cluster_ref, database_name (unique), secret_ref, schema_version bigint, sentinel uuid, updated_at` | `sentinel` должен совпасть с `core.tenant_identity.sentinel` при открытии пула (`02-architecture.md:52`) | control / tenantctx | `:37–45` |
| `memberships` | Аккаунт в организации | `id, tenant_id, account_id, status, person_profile_id (без FK — другая БД), created_at, ended_at, revision` | `unique (tenant_id, account_id)`; частичный индекс `status='active'` по `account_id` | control / memberships | `:47–58` |
| `owner_bindings` | Владение (не роль) | `id, tenant_id, membership_id, granted_at, granted_by, revoked_at, revoke_reason` | `owner_bindings_active_uq (tenant_id, membership_id) where revoked_at is null`; «≥ 1 активный владелец» — сервис под `FOR UPDATE` строки `tenants` (AUTH-08) | control / owners | `:60–71` |
| `invitations` | Приглашения | `id, tenant_id, email_norm, token_hash bytea (unique), person_profile_id, created_by (FK memberships), created_at, expires_at, accepted_at, accepted_account, revoked_at` | `check (expires_at > created_at)`; хранится только hash токена | control / invitations | `:73–86` |
| `subscriptions` | Коммерческий период | `id, tenant_id, plan_code, period tstzrange, state, created_at`; 0002 добавляет `tier_code, term_months, price_version, amount_minor` | `state in ('trial','active','grace','ended')`; `term_months in (1,4,8,12)`; `amount_minor >= 0`; FK `(price_version, tier_code) → price_tiers`; индекс `(tenant_id, lower(period) desc)` | control / billing | `:88–96`; `control_0002_billing.sql:41–46` |
| `entitlements` | Коммерческое право, версионируется | `id, tenant_id, feature_key ('module.logistics','seats','storage.bytes'), source_type, source_ref, limit_value (null = флаг), limit_unit, effective tstzrange, version, reason, actor_id, created_at` | `source_type in ('plan','addon','trial','manual')`; `limit_unit in ('seats','bytes','flag')`; `unique (tenant_id, feature_key, version)`; правки только новой строкой | control / billing | `:98–113` |
| `platform_operators` | Операторы платформы (realm `ortus-operators`) | `id, account_id (unique), role, status, invited_by, disabled_at, disabled_by, created_at` | `role in ('owner','admin','billing','support')`; `status in ('invited','active','disabled')`; `(status='disabled') = (disabled_at is not null)`; `role <> 'owner' or status <> 'invited'`; «≥ 2 активных owner, не себе» — сервис под `FOR UPDATE` | control / operators | `:115–129` |
| `support_grants` | Временный доступ поддержки | `id, tenant_id, operator_id, purpose, actions text[], approved_by (FK memberships, null только break-glass), break_glass, valid tstzrange, revoked_at, created_at` | `upper(valid) - lower(valid) <= interval '60 minutes' or break_glass`; `approved_by is not null or break_glass`; `not ('fleet.earnings.read' = any(actions))` | control / support | `:131–146` |
| `platform_audit` | Журнал платформы | `id bigserial, at, actor_kind, actor_id, action, target_type, target_id, reason, result, request_id, details jsonb` | `actor_kind in ('operator','owner','system')`; `result in ('ok','denied','failed')`; индекс `(target_type, target_id, at desc)` | control / audit | `:148–161` |

### 3.2 Control DB — `control_0002_billing.sql`, `control_0003_branding.sql`

| Таблица / view | Назначение | Ключевые колонки | Ограничения, enum | Владелец | Источник |
|---|---|---|---|---|---|
| `price_book_versions` | Версия тарифной сетки (неизменяема) | `version int PK, effective tstzrange, note, published_by (FK platform_operators), published_at` | `exclude using gist (effective with &&)` — две версии не действуют одновременно; публикация: закрыть `effective` текущей и вставить новую в одной транзакции | control / pricing | `control_0002_billing.sql:9–17`, комментарий `:4–5` |
| `price_tiers` | Ступень сетки | `version, tier_code, name, seats_limit (null = безлимит), month_minor (null = индивидуально), currency default 'RUB', sort` | `tier_code ~ '^[a-z][a-z0-9_]{1,30}$'`; `seats_limit > 0`; `month_minor > 0`; PK `(version, tier_code)`; `unique (version, sort)`; `(seats_limit is null) = (month_minor is null)` | control / pricing | `:19–30` |
| `price_terms` | Скидки за срок | `version, months, discount_pct numeric(4,1)` | `months in (1,4,8,12)`; `discount_pct >= 0 and < 50`; PK `(version, months)` | control / pricing | `:32–37` |
| `subscription_change_requests` | Заявка владельца на тариф | `id, number ('SR-000021', unique), tenant_id, from_tier, to_tier, term_months, price_version, quoted_minor, seats_used, comment, requested_by (FK memberships), requested_at, status, decided_by (FK platform_operators), decided_at, decision_note` | `status in ('pending','approved','rejected','cancelled')` default `pending`; FK `(price_version, to_tier) → price_tiers`; при `rejected` непустой `decision_note`; `(status in ('approved','rejected')) = (decided_by is not null)`; `scr_one_pending_uq (tenant_id) where status='pending'` | control / billing | `:49–70` |
| view `tenant_seat_usage` | Занятые места | `tenant_id, seats_used (active+invited), seats_invited` | — | control / billing | `:82–87` |
| процедура проверки мест | комментарий | `select … from tenants where id=$1 for update` → `seats_used` → `limit_value` из `entitlements(feature_key='seats', effective @> now()) order by version desc limit 1` → `seats_used >= limit_value → 409 seats_exhausted` | — | control / invitations | `:89–95` |
| `tenant_branding_versions` | Версия оформления (неизменяема) | `tenant_id, version, display_name, short_name, accent_hex, accent_used, logo_file, mark_file, terms jsonb, menu jsonb, powered_by, created_by (FK memberships), created_at` | PK `(tenant_id, version)`; `version > 0`; `length(trim(display_name)) between 1 and 60`; `short_name <= 16`; `accent_hex/accent_used ~ '^#[0-9A-Fa-f]{6}$'`; `jsonb_typeof(terms)='object' and jsonb_typeof(menu)='object'`; действующая = максимальная версия | control / branding | `control_0003_branding.sql:7–23` |
| view `tenant_branding_current` | Действующая версия | `distinct on (tenant_id) … order by version desc` | — | control / branding | `:25–26` |
| правила сервиса (не БД) | — | ключи `terms` только из каталога (`shift, vehicle, trip, visit, object`), четыре формы непустые, ≤ 40 символов; `menu.items.*.icon` из набора модуля; `hidden` игнорируется для `home/modules/users/billing/branding`; файлы PNG/SVG/JPEG/WebP ≤ 1 МБ, SVG санитизируется; смена `display_name` обновляет `tenants.display_name` в той же транзакции | — | control / branding | `:31–35` |

### 3.3 Tenant DB — ядро, `tenant_0001_core.sql`

Схемы: `core, org, people, access, modules, files, sched, audit, outbox` (`:8–16`).

| Таблица | Назначение | Ключевые колонки | Ограничения, enum, состояния | Владелец | Источник |
|---|---|---|---|---|---|
| `core.tenant_identity` | Sentinel тенанта | `singleton bool PK default true, tenant_id, sentinel, created_at` | `check (singleton)` — одна строка; сверка с `tenant_routing.sentinel` | platform / tenantctx | `:19–24` |
| `core.idempotency_keys` | Идемпотентность команд | `actor_id, operation, key, request_hash bytea, state, response_status, response_body jsonb, created_at, expires_at` | PK `(actor_id, operation, key)`; `length(key) between 8 and 128`; `state in ('in_progress','completed')` | platform / idem | `:27–38` |
| `core.counters` | Атомарные номера | `name PK, value bigint` | `update core.counters set value = value + 1 where name = $1 returning value` | platform | `:41–45` |
| `org.units` | Подразделения | `id, parent_id, kind, name, time_zone, archived_at, revision, created_at` | `kind in ('region','company','branch','team')`; `time_zone not null` (`'Europe/Moscow'`) | org | `:48–58` |
| `org.unit_closure` | Транзитивное замыкание для `scope_contains` | `ancestor_id, descendant_id, depth` | PK `(ancestor_id, descendant_id)`; `depth >= 0`; перестраивается командой `move` в той же транзакции | org | `:61–67` |
| `org.legal_entities` | Юрлица | `id, name, inn, kpp, ogrn, created_at` | `inn ~ '^\d{10}(\d{2})?$'`; `kpp ~ '^\d{9}$'` | org | `:69–76` |
| `org.unit_legal_entities` | Связь подразделение–юрлицо | `unit_id, legal_entity_id` | PK пара | org | `:77–81` |
| `people.person_profiles` | Сотрудник (может быть без аккаунта, BUILD-03) | `id, membership_id (unique, без FK), full_name, phone, email, home_unit_id (FK, not null), archived_at, revision, created_at` | — | people | `:85–95` |
| `people.work_profiles` | Профессиональная функция с периодом | `id, person_id, function, unit_id, valid tstzrange default [now, ∞), created_at` | `function in ('driver','therapist','foreman','worker','dispatcher')`; `exclude using gist (person_id with =, function with =, valid with &&)` | people | `:98–106` |
| `access.policy_state` | Версия политики | `singleton PK, policy_version bigint default 1` | +1 при любом изменении ролей/назначений/модулей | access | `:109–112` |
| `access.roles` | Роль | `id, name, kind, template_key, current_version, archived_at, created_at` | `kind in ('system','template','custom')`; `roles_name_uq (lower(name)) where archived_at is null` | access | `:114–123` |
| `access.role_versions` | Версия роли (неизменяема) | `role_id, version, actions text[], created_by, created_at` | PK `(role_id, version)`; `check (not ('*' = any(actions)))` (A-05) | access | `:126–133` |
| `access.groups` / `access.group_members` | Группы | `id, name, created_at` / `group_id, person_id` | PK пара | access | `:135–144` |
| `access.role_assignments` | Назначение = кто + роль(версия) + где + когда | `id, principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref, include_descendants default true, valid tstzrange, state, source, granted_by, reason, created_at, revoked_at` | `principal_kind in ('person','group')`; `scope_kind in ('tenant','unit','project','warehouse','resource','self')`; `state in ('active','dormant','revoked')`; `source in ('manual','transfer','support')`; FK `(role_id, role_version) → role_versions`; `check ((scope_kind in ('tenant','self')) = (scope_ref is null))`; индекс по principal `where state='active'` | access | `:147–166` |
| `modules.installations` | Состояние модуля | `module_key PK, state, manifest_version, retained_access, settings jsonb, revision, updated_by, updated_at` | `state in ('enabled','draining','read_only','disabled')`; `retained_access in ('history_read','owner_export')` default `history_read` | modulesreg | `:169–178` |
| `files.objects` | Метаданные файла | `id, object_key (unique, формирует сервер), state, purpose ('inspection.front','expense.receipt'), owner_type, owner_id, declared_mime, detected_mime, bytes, sha256, capture_at, uploaded_by, created_at, ready_at, rejected_code` | `state in ('reserved','uploaded','scanning','ready','rejected')`; `bytes > 0`; индексы `(owner_type, owner_id)`, pending по `created_at` | files | `:181–199` |
| `files.usage` | Квота (singleton) | `committed_bytes, reserved_bytes, limit_bytes, activity_reserve_bytes, updated_at` | резерв атомарно: `update files.usage set reserved_bytes = reserved_bytes + $n where singleton and committed_bytes + reserved_bytes + $n <= limit_bytes + activity_reserve_bytes returning *` → 0 строк = `409 quota_exceeded` | files | `:201–212` |
| `files.quota_ledger` | Журнал квоты | `id bigserial, file_id, kind, bytes, expires_at, created_at` | `kind in ('reserve','commit','release')`; `bytes > 0` | files | `:214–221` |
| `sched.resources` | Ресурс расписания | `id, kind, ref_id, home_unit_id` | `kind in ('vehicle','person','room','equipment')`; `unique (kind, ref_id)` | sched | `:224–230` |
| `sched.reservations` | Бронь | `id, resource_id, bundle_id (комплект), during, occupied (= during ± подготовка/уборка, вычисляет сервис), state, hold_expires_at, source_type ('fleet.trip','spa.appointment'), source_id, created_by, revision, created_at` | `state in ('hold','confirmed','consumed','released','expired')`; `check (occupied @> during)`; `state <> 'hold' or hold_expires_at is not null`; `reservations_no_overlap exclude using gist (resource_id with =, occupied with &&) where (state in ('hold','confirmed','consumed'))` | sched | `:232–254` |
| `audit.events` | Аудит тенанта | `id, at, actor_kind, actor_id, action, target_type, target_id, unit_id, sensitivity, reason, result, request_id, diff jsonb` | `actor_kind in ('person','service','support')`; `sensitivity in ('normal','sensitive','restricted')`; `result in ('ok','denied','failed')`; restricted-поля в `diff` редактируются | platform / audit | `:257–272` |
| `outbox.events` | Исходящие события | `id, event_id uuid unique, type, aggregate, aggregate_id, payload jsonb (без restricted), occurred_at, available_at, attempts, locked_until, published_at, last_error` | индекс `(available_at) where published_at is null`; worker `FOR UPDATE SKIP LOCKED` (`14-engineering.md:13`) | platform / events | `:274–288` |
| `outbox.inbox` | Идемпотентность потребителя | `consumer, event_id, processed_at` | PK `(consumer, event_id)` | platform / events | `:290–295` |

### 3.4 Tenant DB — логистика и финансы, `tenant_0002_fleet.sql`

| Таблица | Назначение | Ключевые колонки | Ограничения, enum, состояния | Владелец | Источник |
|---|---|---|---|---|---|
| `fleet.vehicles` | Машина | `id, unit_id, plate, vin, body_type, payload_kg numeric(10,1), volume_m3 numeric(8,2), cargo_length_mm int, cargo_width_mm, cargo_height_mm, temp_min_c, temp_max_c numeric(4,1), odometer_km numeric(10,1), service_state, archived_at, revision, created_at` | `body_type in ('van','box','reefer','tent','flatbed')`; `payload_kg > 0`, `volume_m3 > 0`, `cargo_length_mm > 0`, `odometer_km >= 0`; `service_state in ('ok','maintenance','out_of_service')`; `(temp_min_c is null) = (temp_max_c is null)`; `temp_min_c <= temp_max_c`; `vehicles_plate_uq (upper(plate)) where archived_at is null` | fleet | `:7–29` |
| `fleet.trips` | Рейс | `id, number (unique, из counters), unit_id, state, vehicle_id, driver_person_id, reservation_bundle_id, planned tstzrange, cargo_weight_kg, cargo_volume_m3, cargo_length_mm, cargo_temp_min_c, cargo_temp_max_c, departure_inspection_id, return_inspection_id, started_at, returned_at, reviewed_at, reviewed_by, revision, created_at` | `state in ('planned','assigned','inspection','defect_review','on_route','returning','submitted','rework','accepted','cancelled')`; `check (state not in ('on_route','returning','submitted','rework','accepted') or (vehicle_id is not null and started_at is not null))`; `trips_active_vehicle_uq (vehicle_id) where state in ('inspection','defect_review','on_route','returning','submitted','rework')`; `trips_active_driver_uq (driver_person_id) where state in ('on_route','returning')` | fleet | `:31–61` |
| `fleet.trip_stops` | Остановки | `trip_id, seq, op, address, time_window tstzrange, weight_kg, volume_m3, contact` | PK `(trip_id, seq)`; `seq > 0`; `op in ('load','unload')`; веса/объёмы `>= 0` | fleet | `:63–73` |
| `fleet.checklist_versions` | Версия чек-листа (неизменяема) | `id, kind, version, items jsonb [{key,label,required}], required_photo_roles text[] default {front,back,left,right,odometer}, published_at` | `kind in ('departure','return')`; `unique (kind, version)` | fleet | `:75–83` |
| `fleet.inspections` | Осмотр | `id, trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level, answers jsonb, state, submitted_by, submitted_at, client_captured_at, revision` | `kind in ('departure','return')`; `fuel_level in ('quarter','half','three_quarters','full')`; `state in ('submitted','approved','blocked')`; `unique (trip_id, kind)`; FK из `trips.departure/return_inspection_id` (`:101–103`) | fleet | `:85–103` |
| `fleet.inspection_photos` | Фото осмотра | `inspection_id, role, file_id (FK files.objects)` | PK `(inspection_id, role)`; `role in ('front','back','left','right','odometer','interior','cargo')`; принимается только файл в `ready` (`10-data-model.md:103`) | fleet | `:107–112` |
| `fleet.defects` | Дефект | `id, vehicle_id, inspection_id, zone, severity, description, state, resolved_by, resolved_at, created_at` | `severity in ('minor','major','blocking')`; `state in ('open','in_review','resolved','confirmed_out_of_service')`; индекс `defects_blocking_open_idx (vehicle_id) where severity='blocking' and state in ('open','in_review')` | fleet | `:114–128` |
| `fleet.odometer_corrections` | Корректировка пробега с причиной | `id, vehicle_id, from_km, to_km, reason, approved_by, created_at` | единственный путь уменьшить пробег (LOG-09) | fleet | `:130–138` |
| `fleet.expenses` | Расход рейса (≠ выплата ≠ начисление) | `id, trip_id, category, amount_minor, currency default 'RUB', liters, odometer_km, occurred_on date, comment, receipt_file_id, state, claimed_by, reviewed_by, reviewed_at, revision, created_at` | `category in ('fuel','wash','parking','toll','other')` (D-12); `amount_minor > 0 and <= 9007199254740991`; `liters > 0`; `state in ('claimed','verified','rejected','reimbursed')`; `category <> 'fuel' or liters is not null` | fleet | `:140–160` |
| `fleet.pool_publications` | Публикация водителя в пул (AUTH-06) | `id, catalog_ref uuid unique (случайный), person_id, home_unit_id, qualifications text[], available tstzrange, published_by, created_at, withdrawn_at` | — | fleet | `:162–173` |
| `fleet.driver_transfers` | Передача водителя (AUTH-07) | `id, publication_id, source_unit_id, target_unit_id, trip_id, period tstzrange, state, assignment_id (FK access.role_assignments — временный grant), requested_by, decided_by, decided_at, revision, created_at` | `state in ('requested','approved','rejected','revoked','expired','completed')`; `check (source_unit_id <> target_unit_id)` | fleet / sched | `:175–190` |
| `finance.earnings` | Закрытое начисление | `id, trip_id (unique), person_id, unit_id (область работы, не текущая фирма), amount_minor default 0, currency, state, revision, updated_by, updated_at` | `amount_minor >= 0`; `state in ('draft','approved','corrected')`; читает только репозиторий finance при `fleet.earnings.read` И отсутствии функции `driver`; не входит в Trip DTO, datasets, outbox payload, поиск (AC-05) | fleet / finance (позже отдельная DB-роль, `:5`) | `:192–206` |

### 3.5 Жизненные циклы

| Сущность | Поле | Состояния и переходы | Источник |
|---|---|---|---|
| Тенант | `tenants.state` | `provisioning → trial → active ⇄ grace → read_only`; `suspended, closing, closed` — административные | `10-data-model.md:109`; `02-architecture.md:255` (grace 7 дней → read_only; `suspended` не наступает автоматически) |
| Членство | `memberships.status` | `invited → active → suspended / ended`; место занимают `active` и `invited` | `control_0001_init.sql:10`; `17-users-and-billing.md:32–39` |
| Аккаунт | `accounts.status` | `active / locked / deleted`; блокировка — мера безопасности, не неоплата, членства не меняет | `control_0001_init.sql:18`; `control_0002_billing.sql:72–79`; `17-users-and-billing.md:112` |
| Оператор | `platform_operators.status` | `invited → active → disabled`; приглашение сразу `owner` запрещено CHECK | `control_0001_init.sql:121–128` |
| Подписка | `subscriptions.state` | `trial / active / grace / ended` | `control_0001_init.sql:93` |
| Заявка на тариф | `subscription_change_requests.status` | `pending → approved / rejected / cancelled`; одна `pending` на тенант | `control_0002_billing.sql:62,70` |
| Версия сетки | `price_book_versions.effective` | опубликована с датой начала в будущем = «запланирована», одновременно одна; отмена до даты начала | `17-users-and-billing.md:62`; `api.js:219,228–236` |
| Модуль | `modules.installations.state` | `enabled → draining → read_only \| disabled`, обратно в `enabled` с предпросмотром восстанавливаемых прав (AUTH-09); назначения в `dormant` | `10-data-model.md:107`; `02-architecture.md:273` |
| Роль | `access.roles.current_version` | каждое изменение — новая строка `role_versions`; `archived_at` вместо удаления | `tenant_0001_core.sql:119,126–133` |
| Назначение | `role_assignments.state` | `active → dormant` (модуль отключён) / `revoked`; `source` = `manual / transfer / support` | `tenant_0001_core.sql:157–158` |
| Файл | `files.objects.state` | `reserved → uploaded → scanning → ready \| rejected` (FILE-02) | `10-data-model.md:103` |
| Бронь | `sched.reservations.state` | `hold (hold_expires_at) → confirmed → consumed (рейс начат) → released`; из `hold` также `expired`, `released`; занятость блокируют `hold/confirmed/consumed` | `10-data-model.md:101`; `tenant_0001_core.sql:241–252` |
| Рейс | `fleet.trips.state` | `planned → assigned → inspection → (defect_review →) on_route → returning → submitted → accepted \| rework → submitted`; любое до `on_route` → `cancelled`; переходы только сервером, каждый — команда с правом и If-Match | `10-data-model.md:84–99` |
| Осмотр | `fleet.inspections.state` | `submitted → approved \| blocked` | `tenant_0002_fleet.sql:94` |
| Дефект | `fleet.defects.state` | `open → in_review → resolved \| confirmed_out_of_service` | `tenant_0002_fleet.sql:121` |
| Расход | `fleet.expenses.state` | `claimed → verified \| rejected`, `verified → reimbursed` (касса, S4) | `10-data-model.md:105` |
| Передача водителя | `fleet.driver_transfers.state` | `requested → approved \| rejected`; `approved → revoked \| expired \| completed` | `tenant_0002_fleet.sql:182` |
| Начисление | `finance.earnings.state` | `draft → approved → corrected` | `tenant_0002_fleet.sql:203` |
| Оформление | `tenant_branding_versions.version` | каждое сохранение — новая версия; действующая — максимальная | `control_0003_branding.sql:6`; `18-branding.md:63` |

Таблица переходов рейса с командой, правом и предусловиями — `10-data-model.md:92–99`:

| Переход | Команда | Право | Предусловия |
|---|---|---|---|
| `planned → assigned` | `POST /fleet/reservations` | `fleet.reservations.create` | машина совместима (LOG-05), нет пересечения брони |
| `assigned → inspection` | клиентский шаг, сервер фиксирует первым осмотром | `fleet.inspections.submit` | бронь `hold` не истекла |
| `inspection → defect_review` | автоматически при `severity = blocking` | — | создаётся задача менеджеру |
| `inspection → on_route` | `POST /fleet/trips` | `fleet.trips.start` | 5 фото `ready`, чек-лист, нет открытого блокирующего дефекта, бронь → `consumed` |
| `on_route → returning → submitted` | `PATCH /fleet/trips/{id}` `action=return` | `fleet.trips.return` | осмотр сдачи, пробег ≥ пробега выезда |
| `submitted → accepted / rework` | `POST /fleet/trips/{id}/review` | `fleet.trips.review` | машина освобождается только при `accepted` |

### 3.6 Покрытие `revision` (If-Match)

Есть `revision`: `tenants`, `memberships`, `org.units`, `people.person_profiles`, `modules.installations`, `sched.reservations`, `fleet.vehicles`, `fleet.trips`, `fleet.inspections`, `fleet.expenses`, `fleet.driver_transfers`, `finance.earnings`. Нет: `access.roles` (вместо него `current_version`), `access.role_assignments`, `fleet.defects`, `files.objects`, `subscription_change_requests`, `platform_operators`, `accounts`; у `tenant_branding_versions` If-Match — номер версии (`18-branding.md:78`). Прототипный http-адаптер шлёт `If-Match: r.etag` для `PATCH /roles/{id}` (`api.js:609`) — для ролей ETag должен строиться из `current_version` (⚠ в источниках не зафиксировано).

## 4. Каталог прав

### 4.1 Общие правила

| Правило | Значение | Источник |
|---|---|---|
| Уровни редактора роли | `view, create, edit, review, export, settings` (AUTH-03) | `11-permissions.yaml:10`; подписи прототипа `VERBS`: «Просматривать», «Создавать», «Изменять», «Проверять», «Выгружать», «Настраивать» (`models.js:19–22`) |
| `sensitivity` | `normal` — включается тумблером уровня; `sensitive` — отдельная галочка; `restricted` — отдельный блок, запрещён функции `driver`, не входит в шаблоны по умолчанию | `11-permissions.yaml:5–6` |
| `scopes` | где допустимо назначение; `self` = «назначено мне / создано мной» | `:7` |
| `owner_only` | только владелец (OwnerBinding): `modules.manage`, `billing.manage` | `:31,35` |
| `blocked_by_function: [driver]` | `fleet.earnings.read`, `fleet.earnings.manage` | `:113–114` |
| `depends_on` | `logistics → [core.calendar, core.files, core.forms]`; `repairs → [core.files, core.tasks]` | `:91,119` |
| `system: true` | модули `core.members`, `core.modules`, `core.files` — нельзя отключить | `:15,28,39` |
| Новые actions не добавляются в существующие роли автоматически (AUTH-09) | — | `:142`; `03-api-guide.md:133` |
| Платформенные права — отдельный контур, не назначаются в tenant | `platform.*` | `:130` |
| Каждый `x-permissions` в OpenAPI обязан быть в каталоге (линтер) | — | `:3`; `14-engineering.md:58` |

### 4.2 Полный реестр action keys (77)

`core.members` — «Пользователи и доступ», `system: true` (`11-permissions.yaml:13–24`):

| Ключ | Уровень | Подпись | Scopes | Чувствительность / примечание |
|---|---|---|---|---|
| `members.read` | view | «Просматривать участников» | tenant, unit | — |
| `members.invite` | create | «Приглашать» | tenant, unit | sensitive |
| `members.manage` | edit | «Приостанавливать и переводить» | tenant, unit | sensitive |
| `roles.read` | view | «Просматривать роли» | tenant, unit | — |
| `roles.manage` | settings | «Создавать и изменять роли» | tenant | sensitive |
| `roles.assign` | settings | «Назначать роли» | tenant, unit | sensitive; note: «делегирует только то, что имеет сам» |
| `org_units.read` | view | «Просматривать структуру» | tenant, unit | — |
| `org_units.manage` | settings | «Изменять структуру» | tenant, unit | sensitive |

`core.modules` — «Модули и подписка», `system: true` (`:26–35`):

| Ключ | Уровень | Подпись | Scopes | Чувствительность |
|---|---|---|---|---|
| `modules.read` | view | «Просматривать модули» | tenant | — |
| `modules.manage` | settings | «Подключать и отключать» | tenant | owner_only |
| `modules.settings.read` | view | «Читать настройки» | tenant | — |
| `modules.settings.manage` | settings | «Изменять настройки» | tenant | sensitive |
| `billing.read` | view | «Видеть подписку и место» | tenant | sensitive |
| `billing.manage` | settings | «Менять тариф и квоту» | tenant | owner_only |

`core.files` — «Файлы», `system: true` (`:37–42`):

| Ключ | Уровень | Подпись | Scopes | Примечание |
|---|---|---|---|---|
| `files.read` | view | «Открывать файлы» | tenant, unit, self | «плюс доступ к родительскому объекту» |
| `files.upload` | create | «Загружать» | tenant, unit, self | — |

`core.data` — «Данные» (`:44–49`):

| Ключ | Уровень | Подпись | Scopes | Примечание |
|---|---|---|---|---|
| `data.catalog.read` | view | «Видеть наборы данных» | tenant, unit | — |
| `data.query` | view | «Строить выборки» | tenant, unit | «AND право исходного набора» |
| `data.export` | export | «Выгружать» | tenant, unit | sensitive |

`core.tasks` — «Задачи» (`:51–59`):

| Ключ | Уровень | Подпись | Scopes |
|---|---|---|---|
| `tasks.projects.read` | view | «Видеть проекты» | tenant, unit, project |
| `tasks.projects.manage` | settings | «Управлять проектами» | tenant, unit |
| `tasks.read` | view | «Читать задачи» | tenant, unit, project, self |
| `tasks.create` | create | «Создавать задачи» | tenant, unit, project |
| `tasks.update` | edit | «Изменять задачи» | tenant, unit, project, self |
| `tasks.transition` | edit | «Менять статус» | tenant, unit, project, self |

`core.forms` — «Формы» (`:61–70`):

| Ключ | Уровень | Подпись | Scopes | Чувствительность |
|---|---|---|---|---|
| `forms.read` | view | «Видеть формы» | tenant, unit, project | — |
| `forms.create` | create | «Создавать формы» | tenant, unit, project | — |
| `forms.manage` | edit | «Изменять черновики» | tenant, unit, project | — |
| `forms.publish` | settings | «Публиковать версии» | tenant, unit, project | — |
| `forms.publish_public` | settings | «Публичные ссылки» | tenant, unit | sensitive |
| `forms.responses.read` | view | «Читать ответы» | tenant, unit, project, self | — |
| `forms.responses.review` | review | «Проверять ответы» | tenant, unit, project | — |

`core.calendar` — «Календарь» (`:72–78`):

| Ключ | Уровень | Подпись | Scopes |
|---|---|---|---|
| `calendar.availability.read` | view | «Видеть занятость» | tenant, unit, self |
| `calendar.bookings.read` | view | «Видеть записи» | tenant, unit, self |
| `calendar.bookings.create` | create | «Бронировать» | tenant, unit, self |
| `calendar.bookings.manage` | edit | «Переносить и отменять» | tenant, unit, self |

`core.knowledge` — «База знаний» (`:80–86`):

| Ключ | Уровень | Подпись | Scopes |
|---|---|---|---|
| `knowledge.read` | view | «Читать» | tenant, unit, project |
| `knowledge.create` | create | «Создавать» | tenant, unit, project |
| `knowledge.update` | edit | «Редактировать» | tenant, unit, project |
| `knowledge.publish` | settings | «Публиковать» | tenant, unit, project |

`logistics` — «Логистика», `industry: true`, `depends_on: [core.calendar, core.files, core.forms]` (`:88–114`):

| Ключ | Уровень | Подпись | Scopes | Чувствительность |
|---|---|---|---|---|
| `fleet.vehicles.read` | view | «Видеть машины» | tenant, unit, resource | — |
| `fleet.vehicles.manage` | settings | «Вести автопарк» | tenant, unit | — |
| `fleet.reservations.read` | view | «Видеть брони» | tenant, unit, self | — |
| `fleet.reservations.create` | create | «Бронировать машину» | tenant, unit, self | — |
| `fleet.reservations.manage` | edit | «Снимать брони» | tenant, unit, self | — |
| `fleet.inspections.read` | view | «Видеть осмотры» | tenant, unit, self | — |
| `fleet.inspections.submit` | create | «Проводить осмотр» | tenant, unit, self | — |
| `fleet.inspections.review` | review | «Решать по дефектам» | tenant, unit | — |
| `fleet.trips.read` | view | «Видеть рейсы» | tenant, unit, self | — |
| `fleet.trips.start` | create | «Начинать рейс» | tenant, unit, self | — |
| `fleet.trips.return` | create | «Сдавать машину» | tenant, unit, self | — |
| `fleet.trips.review` | review | «Принимать смены» | tenant, unit | — |
| `fleet.routes.read` | view | «Видеть маршруты» | tenant, unit, self | — |
| `fleet.routes.manage` | edit | «Планировать маршруты» | tenant, unit | — |
| `fleet.expenses.read` | view | «Видеть расходы» | tenant, unit, self | — |
| `fleet.expenses.create` | create | «Добавлять расходы» | tenant, unit, self | — |
| `fleet.expenses.review` | review | «Проверять расходы» | tenant, unit | — |
| `fleet.driver_transfers.read` | view | «Видеть запросы пула» | tenant, unit | — |
| `fleet.driver_transfers.request` | edit | «Запрашивать водителя» | tenant, unit | — |
| `fleet.driver_transfers.approve` | review | «Одобрять передачу» | tenant, unit | sensitive |
| `fleet.earnings.read` | view | «Видеть начисления» | tenant, unit | restricted, `blocked_by_function: [driver]` |
| `fleet.earnings.manage` | edit | «Изменять начисления» | tenant, unit | restricted, `blocked_by_function: [driver]` |

`repairs` — «Ремонт и стройка», `industry: true`, `depends_on: [core.files, core.tasks]`, `nav: { group: Ремонт и стройка, items: [objects] }` (`:116–127`):

| Ключ | Уровень | Подпись | Scopes | Примечание |
|---|---|---|---|---|
| `repairs.projects.read` | view | «Видеть объекты» | tenant, unit, project | — |
| `repairs.projects.manage` | settings | «Вести объекты» | tenant, unit | — |
| `repairs.work_logs.read` | view | «Видеть отметки» | tenant, unit, project | — |
| `repairs.work_logs.submit` | create | «Отмечать работу» | project | — |
| `repairs.work_logs.review` | review | «Принимать объём» | tenant, unit, project | `# PROPOSED: нет в OpenAPI 0.1` |
| `repairs.finance.read` | view | «Видеть финансы объекта» | tenant, unit, project | restricted; `# PROPOSED: цены, суммы, маржа` |

`platform` — «Платформа (отдельный контур операторов, не назначается в tenant)» (`:129–140`), без уровней и scopes:

| Ключ | Подпись | Примечание | Роль оператора (`17-users-and-billing.md:120–131,167–175`) |
|---|---|---|---|
| `platform.tenants.read` | «Видеть организации» | — | все |
| `platform.tenants.create` | «Создавать организации» | — | admin, owner |
| `platform.tenants.manage` | «Приостанавливать и возобновлять» | — | admin, owner |
| `platform.users.read` | «Видеть каталог аккаунтов» | — | оператор |
| `platform.users.manage` | «Блокировать вход и сбрасывать второй фактор» | «причина обязательна»; «(новый)» | support, admin |
| `platform.billing.read` | «Видеть подписки» | — | billing, admin |
| `platform.billing.manage` | «Рассматривать заявки, менять подписки и лимиты» | «причина обязательна» | billing, admin |
| `platform.pricing.manage` | «Публиковать тарифную сетку» | «(новый)» | admin, owner |
| `platform.operators.manage` | «Приглашать операторов и менять их роли» | «только role=owner; ≥2 активных владельца» | owner |

`17-users-and-billing.md:182`: «В макете роли операторов на остальных экранах платформы пока не ограничивают действия: демо-оператор — владелец».

### 4.3 Шаблоны ролей (`11-permissions.yaml:143–177`)

| Шаблон | Подпись | `default_scope` | `work_function` | Actions |
|---|---|---|---|---|
| `owner` | «Владелец бизнеса» | — | — | `kind: system`; note: «Владение — OwnerBinding, не роль. Шаблон даёт все tenant actions, кроме блокированных функцией.» |
| `logistics_manager` | «Менеджер логистики» | unit | — | `members.read, roles.read, org_units.read, files.read, files.upload, data.catalog.read, data.query, data.export, tasks.read, tasks.create, tasks.update, tasks.transition, forms.read, forms.responses.read, forms.responses.review, calendar.availability.read, calendar.bookings.read, knowledge.read, fleet.vehicles.read, fleet.vehicles.manage, fleet.reservations.read, fleet.reservations.manage, fleet.inspections.read, fleet.inspections.review, fleet.trips.read, fleet.trips.review, fleet.routes.read, fleet.routes.manage, fleet.expenses.read, fleet.expenses.review, fleet.driver_transfers.read, fleet.driver_transfers.request, fleet.driver_transfers.approve`; `optional_restricted: [fleet.earnings.read, fleet.earnings.manage]` — «отдельный финансовый блок» |
| `driver` | «Водитель» | self | driver | `files.read, files.upload, tasks.read, knowledge.read, calendar.availability.read, fleet.vehicles.read, fleet.reservations.read, fleet.reservations.create, fleet.inspections.read, fleet.inspections.submit, fleet.trips.read, fleet.trips.start, fleet.trips.return, fleet.routes.read, fleet.expenses.read, fleet.expenses.create` |
| `foreman` | «Прораб» | project | foreman | `files.read, files.upload, tasks.read, tasks.create, knowledge.read, repairs.projects.read, repairs.work_logs.read, repairs.work_logs.submit`; note: «Без repairs.finance.read: вкладки Смета, Финансы, Оплата бригады, Подрядчики и Кабинет заказчика скрыты.» |
| `observer` | «Наблюдатель» | unit | — | `org_units.read, data.catalog.read, data.query, tasks.read, knowledge.read, fleet.vehicles.read, fleet.trips.read` |

Расхождения шаблонов с прототипом (`mock-data.js:167–173`):

| Прототип | Канон | Разрыв |
|---|---|---|
| `r-owner` «Владелец бизнеса» `all: true, finance: {read, manage}` | OwnerBinding, не роль; `'*'` запрещён CHECK | в сиде backend владелец — `owner_bindings` + системная роль без wildcard (перечень actions генерируется из каталога) |
| `r-manager` «Менеджер логистики» `finance.read: true` | `optional_restricted`, по умолчанию выключено | в прототипе менеджер видит начисления по умолчанию (`view()` `api.js:78`), в каноне — только после включения restricted-блока ⚠ решение владельца |
| `r-driver` `forms: ['view','create']` → `forms.responses.create` (`models.js:66`) | ключа `forms.responses.create` в каталоге нет; ответ «Осмотр машины» создаёт сервер по событию `fleet.inspection.submitted.v1` | убрать из шаблона `driver` |
| `r-therapist` «Массажист» `spa: [view, create]` | в каталоге нет модуля `spa` | каталог нужно дополнить (§7) |
| `r-foreman` «Прораб» `repair: [view, create]` | `repairs.projects.read, repairs.work_logs.read, repairs.work_logs.submit` | совпадает |
| `observer` | нет в прототипе | только канон |
| `r-admin` «Администратор салона» (Лотос, `mock-data.js:65`) | custom; ключи `spa.*` отсутствуют | как у `r-therapist` |

### 4.4 `prototype_renames` (`11-permissions.yaml:179–191`)

| Ключ прототипа (`models.js`) | Канонический ключ |
|---|---|
| `fleet.inspections.create` | `fleet.inspections.submit` |
| `fleet.trips.manage` | `fleet.trips.start`, `fleet.trips.return`, `fleet.routes.manage` |
| `fleet.pool.request` | `fleet.driver_transfers.request` |
| `fleet.export` | `data.export` («выгрузка — общее право Data Hub + право набора») |
| `fleet.settings` | `modules.settings.manage` |
| `calendar.read` | `calendar.bookings.read` |
| `knowledge.write` | `knowledge.create`, `knowledge.update` |
| `data.read` | `data.catalog.read`, `data.query` |
| `repairs.worklogs.create` | `repairs.work_logs.submit` |
| `repairs.worklogs.review` | `repairs.work_logs.review` |

Ключи прототипа без соответствия в `prototype_renames` и в каталоге: `tasks.manage` (`models.js:64`), `forms.responses.create` (`:66`), `inventory.read`, `inventory.movements.post` (`:69`), `cash.read`, `cash.operations.create` (`:70`), `spa.appointments.read/create`, `spa.services.manage`, `spa.completion.review`, `spa.export`, `spa.settings` (`:45–46`), `repairs.export`, `repairs.settings` (`:57`). Прототипные уровни «export/settings» у отраслевых модулей (`fleet.export`, `fleet.settings`) в каноне переведены в общие ключи `data.export`, `modules.settings.manage`.

### 4.5 Сверка с OpenAPI 0.1 (`x-permissions`, 82 уникальных ключа)

В OpenAPI, но **нет в `11-permissions.yaml`** (14): `cash.manage, cash.post, cash.read, inventory.consume, inventory.items.manage, inventory.items.read, inventory.movements.post, inventory.movements.read, spa.appointments.complete, spa.appointments.create, spa.appointments.perform, spa.appointments.read, spa.services.manage, spa.services.read`. Линтер «каждый `x-permissions` есть в каталоге» (`14-engineering.md:58`) на OpenAPI 0.1 упадёт.

В каталоге, но **нет в `x-permissions` OpenAPI** (9 + 2): `data.export, forms.publish_public, forms.responses.review, knowledge.publish, repairs.work_logs.review (PROPOSED), repairs.finance.read (PROPOSED), platform.users.manage, platform.pricing.manage, platform.operators.manage`; плюс `branding.read`, `branding.manage` из `18-branding.md:83`, которых нет ни в каталоге, ни в OpenAPI.

Все 22 ключа `logistics`, 8 `core.members`, 6 `core.modules`, 2 `core.files`, `data.catalog.read`, `data.query`, 6 `core.tasks`, 5 из 7 `core.forms`, 4 `core.calendar`, 3 из 4 `core.knowledge`, 4 из 6 `repairs`, 6 из 9 `platform` — совпадают.

### 4.6 Словари областей (scope) — четыре разных

| Источник | Значения |
|---|---|
| `tenant_0001_core.sql:153` (`role_assignments.scope_kind`) | `tenant, unit, project, warehouse, resource, self` |
| `11-permissions.yaml` (`scopes:`) | `tenant, unit, project, resource, self` |
| OpenAPI `Scope.kind` (6940–6947) | `tenant, org_unit, project, self, resource_pool`; `resourceIds[]` (≤ 100), `includeDescendants`; «tenant/self require empty resourceIds» |
| Прототип `Scope` (`models.js:5`) | `{type:'tenant'} \| {type:'region',id} \| {type:'firm',id} \| {type:'self'}`; подписи `scopeLabel`: «Вся организация», «Регион <name>», «<регион> / <фирма>», «Только назначенное лично» (`models.js:161–167`) |
| `org.units.kind` (`tenant_0001_core.sql:51`) / глоссарий (`16-raid-glossary.md:73`) | `region, company, branch, team` / «регион, фирма, филиал» = `org_unit (region, company, branch)` |

Прототипные `region`/`firm` = `unit` с `org.units.kind = region`/`company`; `scopeCovers` прототипа (`models.js:153–160`) покрывает только один уровень вложенности (регион → фирма), канон — `org.unit_closure` + `include_descendants`.

### 4.7 Evaluator и прототип

Канонический `permit(c,a,r,f,t)` (`02-architecture.md:96–110`): `trusted_tenant AND active_account_and_membership AND feature_access_mode_allows AND module_installation_and_state_allow AND mandatory_platform_and_tenant_boundaries AND EXISTS grant g: action_in_grant AND scope_contains AND conditions_match AND valid AND object_policy_admits AND field_policy_allows`. Каждый grant проверяется целиком: «Редактировать Москва-1» + «читать Самара-2» ≠ «редактировать обе» (`:114`). Интерфейс authz: `authorize`, `scopeQuery`, `readFields/writeFields`, `explainAccess`, `previewPolicyChange` (`:283–289`).

Прототип `can(db, memberId, mod, verb, unitId)` (`models.js:178–187`): модуль подключён → действие в роли → объект в области; `canEarnings` (`:190–198`): `function === 'driver'` → `driver_block` до любых ролей. Причины отказа `REASON` (`models.js:77–83`) — дословно, это тексты `AccessGate` (`components.md:25`):

| `reason` | `label` | `icon` | `tone` | `text` | Канонический код |
|---|---|---|---|---|---|
| `module_off` | «Модуль не подключён» | `extension_off` | neutral | «Модуль не подключён организацией. Подключить его может владелец бизнеса.» | 403 `module_not_installed` |
| `module_readonly` | «Модуль отключён · только чтение» | `history` | neutral | «Модуль отключён. История доступна для чтения, новые операции закрыты.» | 403 `module_read_only` |
| `no_permission` | «Нет права» | `lock` | warn | «Ни одна роль сотрудника не разрешает это действие.» | 403 `forbidden_action` |
| `no_scope` | «Нет доступа к объекту» | `visibility_off` | warn | «Право есть, но объект находится вне области назначения.» | 404 `not_found` (чужой объект неотличим от несуществующего) |
| `driver_block` | «Запрещено функцией «Водитель»» | `block` | danger | «Действующая функция «Водитель» запрещает начисления через любую роль и группу.» | 403 `function_blocked` («Не показывать пункт; при прямом вызове — общий отказ») |

Вкладка «Проверка доступа» (страница «Пользователи и роли», вкладки «Люди», «Группы», «Роли», «Проверка доступа» — `Ортус CRM.dc.html:3136`): селекты «участник / действие / объект», пресеты «Модуль не подключён», «Нет права», «Нет доступа к объекту», «Начисления водителю» (`:2367`); действия `ACTIONS`: «Просматривать машины», «Бронировать машину», «Принимать смены», «Видеть начисления», «Открыть расписание SPA», «Отмечать работы на объекте» (`:2365`); объекты: «ГАЗель Next · Север Логистик», «Isuzu Elf · Юг Транс», «ГАЗель Бизнес · Самара / Волга Логистик», «Рейс Р-208 · Север Логистик», «Без конкретного объекта» (`:2366`). Результат: чип «Разрешено» и заголовок «<Имя> может: <действие>», текст «Основание · роль «…» · <область>[ · через <группа>].» либо чип `REASON.label`, заголовок «<Имя> не может: <действие>», текст `REASON.text` + « Объект: <объект>.» для `no_scope` или « Модуль: Логистика.» для `module_off` (`:3217–3223`).

### 4.8 Владение, делегирование, операторы, поддержка

- OwnerBinding — не роль; владелец сохраняет доступ ко всему tenant, но не обходит чужой tenant, недоступность тарифа и серверные инварианты; «владелец видит всё» ≠ «может повредить ledger» (`02-architecture.md:123,127`). Инвариант «≥ 1 активный владелец» (AUTH-08) — `409 last_owner_required` (`12-errors-and-events.md:52`); передача владения требует подтверждённого аккаунта и аудита (`01-technical-spec.md:144`).
- Делегирование: назначающий должен иметь `roles.assign` и право делегировать весь набор действий/полей/областей/сроков роли; `can_perform ≠ can_delegate`; проверка при clone/edit роли, добавлении в привилегированную группу, переносе org unit; выдача больше, чем имеет, — `409 delegation_exceeds_grant` (`02-architecture.md:131`; `12-errors-and-events.md:51`).
- Операторы платформы: отдельный realm `ortus-operators` (D-03), не состоят в организациях клиентов (`control_0001_init.sql:115–117`; `17-users-and-billing.md:155–165`); правила: ≥ 2 активных владельца, свою роль менять и себя отключать нельзя, владельцем — только активный со вторым фактором, при отключении — сессии завершаются и выданные support_grants отзываются (`17-users-and-billing.md:176–180`). Прототип проверяет «хотя бы один активный владелец» (`api.js:257,265`) — слабее канона ⚠.
- Поддержка: запрос цели → одобрение владельца → временный `support_grant` (read-only, ≤ 60 мин, без начислений и массового экспорта) → баннер → аудит → отзыв; actor поддержки сохраняется (`audit.events.actor_kind = 'support'`, `role_assignments.source = 'support'`); break-glass — отдельная identity, MFA, ticket, второй оператор, внешняя запись (`02-architecture.md:303–305`; `tenant_0001_core.sql:158,260`).
- Временный доступ пула: при approve в одной транзакции — бронь на комплект, статус заявки, временные grants (`role_assignments.source = 'transfer'`), событие outbox; после срока новые рейсы запрещены, для начатого рейса — узкое continuation capability (`02-architecture.md:169–184`; `tenant_0002_fleet.sql:183`).

## 5. Контракт ошибок, события и соглашения API

### 5.1 Форма Problem (`12-errors-and-events.md:7–24`; OpenAPI 6904–6935)

```json
{ "type": "https://docs.ortus.example/errors/reservation_overlap", "title": "Машина уже забронирована", "status": 409,
  "code": "reservation_overlap", "detail": "Выберите другую машину или обновите список.", "requestId": "01J9Z4…",
  "violations": [{ "field": "window.until", "code": "before_start", "message": "Окончание раньше начала" }], "retryable": true }
```

- Обязательные в OpenAPI: `type, title, status (≥100), code, requestId`; `additionalProperties: false` — поле `retryable` из примера `12` схемой **не допускается** ⚠ (противоречие; см. §9). Описание схемы: «No cross-tenant IDs, SQL, token values or storage keys in errors. Retryable conflict codes: reservation_overlap, resources_unavailable, idempotency_in_progress; quota errors: quota_exceeded, downgrade_below_usage.»
- `title`/`detail` безопасны для показа; интерфейс выбирает текст по `code`, для неизвестного — общий текст статуса; `requestId` — мелким шрифтом с кнопкой «Скопировать» (`12:22–24`). ⚠ В прототипе `requestId` и «Скопировать» не реализованы (grep по HTML — нет); тост показывает `e.message` (`Ортус CRM.dc.html:2457`).
- `Problem.code` в OpenAPI 0.1 — свободная строка; реестр нужно добавить как `enum` и сгенерировать константы Go/TS (`12:3`; `docs/README.md:39,48`).

### 5.2 Реестр кодов (`12-errors-and-events.md:28–65`) — дословно

| HTTP | `code` | Когда | Что делает интерфейс |
|---|---|---|---|
| 400 | `malformed_request` | Неразбираемый JSON, неверный параметр | Общая ошибка, не повторять |
| 400 | `unknown_field` | В теле поле, которого нет в DTO | Ошибка разработки, логировать |
| 401 | `session_expired` | Нет или истекла сессия | Перелогин с возвратом на экран |
| 402 | `feature_requires_plan` | Функция недоступна по тарифу | Владельцу — «Продлить», остальным — «Обратитесь к владельцу» |
| 403 | `forbidden_action` | Нет действия ни в одной роли | AccessGate «Нет права» |
| 403 | `module_not_installed` | Модуль не подключён | AccessGate «Модуль не подключён» |
| 403 | `module_read_only` | Модуль в draining/read_only | Баннер «Только чтение» |
| 403 | `tenant_read_only` | Тенант в read_only | Баннер, разрешены чтение и экспорт |
| 403 | `tenant_suspended` | Тенант приостановлен | Экран блокировки |
| 403 | `function_blocked` | Функция `driver` закрывает действие | Не показывать пункт; при прямом вызове — общий отказ |
| 403 | `csrf_failed` / `origin_not_allowed` | Нет или неверен CSRF/Origin | Перезагрузить страницу |
| 404 | `not_found` | Нет объекта или он вне области | Одинаково для чужих и несуществующих ID |
| 409 | `reservation_overlap` | Интервал занят | Конфликт брони, «Обновить список» |
| 409 | `resources_unavailable` | Не весь комплект ресурсов свободен | Список недоступных без чужих деталей |
| 409 | `reservation_expired` | Hold истёк до выезда | «Бронь истекла, забронируйте снова» |
| 409 | `vehicle_incompatible` | Не проходит масса/объём/длина/температура | Причины по проверкам |
| 409 | `inspection_incomplete` | Нет обязательных фото/пунктов | Список недостающего |
| 409 | `blocking_defect_open` | Открыт блокирующий дефект | «Выезд заблокирован, ждёт менеджера» |
| 409 | `photo_not_ready` | Файл не в состоянии ready | Показать статус загрузки |
| 409 | `invalid_transition` | Переход статуса не разрешён | Перечитать объект |
| 409 | `separation_of_duties_conflict` | Финансовое право + функция driver | Объяснение в диалоге назначения |
| 409 | `delegation_exceeds_grant` | Назначающий выдаёт больше, чем имеет | Подсветить лишние права |
| 409 | `last_owner_required` | Попытка снять последнего владельца | Объяснение |
| 409 | `quota_exceeded` | Нет места под загрузку | Владельцу — увеличить, остальным — сообщить |
| 409 | `downgrade_below_usage` | Новая квота ниже занятого | Сколько освободить |
| 409 | `idempotency_key_reused` | Тот же ключ, другой payload | Ошибка клиента, новый ключ |
| 409 | `idempotency_in_progress` | Команда ещё выполняется | Ждать `Retry-After` |
| 410 | `public_token_expired` / `nonce_used` | Публичная ссылка истекла | Экран «Ссылка недействительна» |
| 412 | `revision_mismatch` | Устаревший If-Match | «Данные изменились», показать свежую версию |
| 413 | `payload_too_large` | Превышен размер | Лимит в тексте |
| 422 | `validation_failed` | Ошибки полей | Ошибки у полей из `violations` |
| 422 | `odometer_decrease` | Пробег меньше начального | Ошибка у поля «Пробег» |
| 422 | `amount_invalid` | Сумма ≤ 0 или вне границ | Ошибка у поля «Сумма» |
| 428 | `revision_required` | Нет If-Match | Ошибка разработки |
| 429 | `rate_limited` | Лимит запросов | Ждать `Retry-After` |
| 503 | `dependency_unavailable` | Недоступна control DB, хранилище или IdP | «Сервис временно недоступен»; sensitive writes fail closed |

Клиентские состояния без HTTP-ответа: `offline` (нет сети, черновик на устройстве) и `timeout` (результат неизвестен — перечитать перед повтором с тем же Idempotency-Key) (`12:67`).

### 5.3 Коды вне реестра и соответствие прототипных кодов

Коды, объявленные в других документах, но отсутствующие в реестре `12`:

| Код | HTTP | Где | Когда |
|---|---|---|---|
| `seats_exhausted` | 409 | `17-users-and-billing.md:41,153`; `control_0002_billing.sql:94` | нет свободных мест при приглашении/разблокировке |
| `request_pending` | 409 | `17:138,153` | уже есть открытая заявка на тариф |
| `tier_below_usage` | 422 | `17:153` | в тарифе мест меньше, чем занято |
| `conflict` | 409 | `19-construction.md:93` «Повтор отклоняется с `conflict`» | повторная приёмка объёма — должен быть `invalid_transition` ⚠ |
| 422 на `role=owner` при приглашении оператора; 409 «последний владелец и себя» | — | `17:149–150` | код не назван ⚠ |
| 422 на SVG с `<script>`; 422 ошибки оформления | — | `18-branding.md:78`; `15-quality-security.md:50` | код не назван (`validation_failed`?) ⚠ |

Коды `ApiError` mock-адаптера (`api.js`) → канон:

| Прототип (`api.js`) | Текст прототипа (дословно) | Канон |
|---|---|---|
| `not_found` (`:25–26`) | «Рейс не найден» / «Машина не найдена» | 404 `not_found` |
| `offline` (`:52,553,560`) | «Нет связи с сервером. Операция не выполнена.» / «Нет связи. Фото сохранено на устройстве и будет отправлено позже.» / «Связь прервалась во время загрузки.» | клиентское `offline` |
| `subscription_restricted` (`:55`) | «Пробный период завершён: новые операции недоступны. История доступна для чтения.» | 403 `tenant_read_only` (прототипный статус `restricted` = `grace`/`read_only`, `docs/README.md:49`) |
| `module_off` (`:64,308`) | «Модуль «Логистика» отключён: новые операции закрыты.» / «Модуль «Логистика» отключён» | 403 `module_not_installed` |
| `module_readonly` (через `REASON`) | «Модуль отключён. История доступна для чтения, новые операции закрыты.» | 403 `module_read_only` |
| `no_permission` / `no_scope` / `driver_block` (через `assertCan`, `:57–60`) | тексты `REASON` | 403 `forbidden_action` / 404 `not_found` / 403 `function_blocked` |
| `validation` (много) | например «Укажите имя», «Проверьте адрес электронной почты», «Осмотр не завершён: …», «Не все фото загружены на сервер», «Сумма должна быть больше нуля», «Укажите причину отказа» | 422 `validation_failed` с `violations`; для осмотра — 409 `inspection_incomplete` / 409 `photo_not_ready`; для суммы — 422 `amount_invalid` |
| `conflict` (бронь, `:312,314,327`) | «Машину только что забронировал другой сотрудник. Список на экране устарел.» / «Машина уже недоступна. Обновите список.» / «Машину только что забронировали. Обновите список.» | 409 `reservation_overlap` |
| `incompatible` (`:315,328`) | «Машина не подходит рейсу: <причины через «; »>» / «Нельзя назначить: …» | 409 `vehicle_incompatible` |
| `conflict` (участник, `:158,171`) | «Участник с таким адресом уже есть» / «Приглашение уже принято или отозвано» | 409 `invalid_transition` или 422 ⚠ не определено |
| `seats_exhausted` (`:160`) | «Свободных мест нет: занято N из M. Отзовите приглашение или запросите расширение тарифа.» | 409 `seats_exhausted` |
| `conflict` (заявка, `:181,193,198`) | «Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.» / «Заявка уже рассмотрена» / «Заявка уже рассмотрена или отменена» | 409 `request_pending` / 409 `invalid_transition` |
| `validation` (`:184`) | «В тарифе «<name>» N мест, а занято M» | 422 `tier_below_usage` |
| `conflict` (сетка, `:219,230`) | «Уже запланирована версия vN. Отмените её, чтобы подготовить другую.» / «Запланированной версии нет» | 409 `invalid_transition` ⚠ |
| `role_conflict` (`:278,279,299,301`) | «Функция «Водитель» несовместима с правом на начисления (правило MVP).» / «У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено.» / «Роль с функцией «Водитель» не может содержать начисления» / «Роль назначена водителю — финансовые права недоступны» | 409 `separation_of_duties_conflict` |
| `last_owner` (`:285`) | «Нельзя снять роль с последнего владельца» | 409 `last_owner_required` |
| `forbidden` (`:297`) | «Системная роль не редактируется» | 403 `forbidden_action` |
| `conflict` (приёмка, `:382,545,521`) | «Смена уже обработана» / «Отметка уже обработана» / «Операция уже исправлена» | 409 `invalid_transition` |
| `transition` (`:433`) | «Переход «<from> → <to>» не предусмотрен процессом» | 409 `invalid_transition` |
| `conflict` (календарь, `:461`) | «Конфликт ресурсов: <ресурс> занят («<бронь>»)[; …]» + `slots` | 409 `resources_unavailable` |
| `conflict` (БЗ, `:471`) | «Страницу уже изменили (vN). Обновите и повторите правку.» | 412 `revision_mismatch` |
| `quota_exceeded` (`:556`) | «Место организации заполнено. Загрузка новых файлов недоступна.» | 409 `quota_exceeded` |
| `upload_failed` (`:561`) | «Загрузка прервалась. Повторите попытку.» | клиентское (ошибка PUT по presigned URL) |
| `duplicate` — возврат, не ошибка (`:362,371,482`) | повтор с тем же `opId` | идемпотентный ответ 2xx с сохранённым результатом |

Обработка в прототипе (`Ортус CRM.dc.html:2445–2460`): `run()` ставит `busy`, при ошибке показывает тост `e.message || 'Ошибка'` с тоном `warn` для `offline` и `error` иначе; тост с `tone === 'error'` имеет `role="alert"`, остальные — `role="status"` (`:2900`); `quiet: [...]` подавляет тост, ошибка показывается в диалоге (`assign`: `quiet: ['role_conflict','validation']`, текст в `modal.err`, `:2758–2760`); конфликт брони → `state.conflict` и возврат на «today» (`:2590`); конфликт календаря → `calConflict` со `slots` (`:4143`); офлайн-фото → `state: 'queued'` (`:2512`); очередь отправки `outbox` со статусами `local`/`error` (`:2573`).

### 5.4 Баннеры и блокировки прототипа (дословно)

| Где | Текст | Источник |
|---|---|---|
| Главная, тенант `restricted/suspended` | «Пробный период завершён.» — «Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.» (у владельца кнопка «Демо: продлить как оператор») | `Ортус CRM.dc.html:3085` |
| Главная, офлайн | «Нет связи.» — «Черновики, фото и расходы сохраняются на устройстве[ (ожидают отправки: N)]. Бронь, выезд и приёмка требуют подтверждения сервера.» | `:3089` |
| Чип статуса в шапке | «Нет связи» (`role="status"`, иконка `cloud_off`) | `:115` |
| Подбор машины | «Нет связи: бронь требует подтверждения сервера.» / «Пробный период организации завершён: новые брони недоступны.» / «Модуль «Логистика» отключён: новые брони недоступны.» | `:3437` |
| Осмотр офлайн | «Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.» / «Нет связи: сдача сохранится на устройстве и отправится позже. До подтверждения сервера машина не считается сданной.» | `:3491` |
| Редактор роли (системная) | «Системная роль: все модули и области организации. Не редактируется и защищает от потери доступа последним владельцем.» | `:348` |
| Редактор роли (функция) | «Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.» | `:349` |
| Редактор роли, факты | «Подключение модуля организации само по себе не выдаёт права — их задаёт роль», «Область данных выбирается при назначении роли сотруднику», «Начисления видны в области назначения» / «Начисления скрыты», «Данные других организаций недоступны» | `:3200–3205` |
| Редактор роли, finNote | «Роль с функцией «Водитель» не может содержать начисления» / «Роль назначена водителю — финансовые права недоступны» | `:3196` |
| Тосты успеха | «Роль «<name>» назначена», «Назначение снято» | `:2758,2762` |
| Демо-панель | кнопка «Путь проверки» (`aria-expanded`), диалог `aria-label="Путь проверки"`, блок «Негативные проверки», флажки «Нет связи», «Конфликт брони», «Сбой загрузки фото» | `:59–81` |
| «Негативные проверки» (список) | «Несовместимая машина: Hyundai Porter и Ford Transit для Р-208 — кнопка брони недоступна, причина указана»; «Незавершённый осмотр: «Выехать» неактивна, показан список недостающего»; «Отрицательный расход: введите «-500» — ошибка «Сумма должна быть больше нуля»»; «Пробег при сдаче меньше начального — ошибка, сдача невозможна»; «Водитель: начислений нет ни в смене, ни в уведомлениях, ни в ответе mock-API»; «Флажок «Конфликт брони» → следующая бронь получает конфликт и предложение обновить список»; «Флажок «Нет связи» → расходы и сдача сохраняются на устройстве, бронь и выезд блокируются» | `:2921–2929` |

### 5.5 Доменные события (outbox) — `12-errors-and-events.md:69–85`

Имя `<модуль>.<сущность>.<событие>.v<версия>`; payload — ID и минимальные атрибуты, без restricted-полей; потребитель идемпотентен через `outbox.inbox`.

| Событие | Потребители |
|---|---|
| `access.assignment.granted.v1`, `access.assignment.revoked.v1` | Инвалидация кеша прав, realtime, аудит |
| `access.policy.bumped.v1` | Закрытие подписок realtime, сброс курсоров |
| `modules.installation.state_changed.v1` | Меню, Data Hub, автоматизации |
| `files.object.ready.v1`, `files.object.rejected.v1` | Осмотры, формы, usage |
| `fleet.reservation.held.v1` / `.confirmed.v1` / `.expired.v1` / `.released.v1` | Календарь, уведомления |
| `fleet.inspection.submitted.v1` | Формы (ответ «Осмотр машины»), задачи |
| `fleet.defect.blocking_reported.v1` | Задача менеджеру «Срочно», уведомление |
| `fleet.trip.started.v1` / `.submitted.v1` / `.accepted.v1` / `.rework_requested.v1` | Очередь приёмки, календарь, уведомления |
| `fleet.expense.claimed.v1` / `.verified.v1` | Касса (предложение операции, S4) |
| `fleet.transfer.approved.v1` / `.revoked.v1` / `.expired.v1` | Временные grants, уведомления |
| `tenant.state_changed.v1` (control plane) | Баннеры, режим чтения |

Прототип воспроизводит часть потребителей: `recordInspection` создаёт ответ формы `R-…` и задачу «Проверить осмотр <рейс> (выезд|сдача)» с приоритетом `urgent` при критическом дефекте (`api.js:39–50`); события-уведомления `db.events` с адресатами `to[]` и флагом `sensitive: 'earnings'` (`api.js:27,395`).

### 5.6 Соглашения API

| Тема | Правило | Источник |
|---|---|---|
| Пути | `/api/v1/platform/...`, `/api/v1/tenants/{tenantId}/...`, `/api/v1/me/context`, `/api/v1/public/forms/{publicToken}/...`; множественное число, kebab-case | `03-api-guide.md:32`; `12:92` |
| `tenantId` в URL — не право | проверка identity → членство → состояние бизнеса → режим функции → разрешение → область → объект; произвольный DSN/SQL-контекст не принимается | `03:34`; `02-architecture.md:48` |
| DTO | запрос и ответ различаются; неизвестные поля тела → 400 `unknown_field`; серверные суммы/статусы/owner IDs не присваиваются через PATCH; `owner_unit_id` меняется только командой transfer | `03:36`; `02:157` |
| Вход | Go BFF, OIDC Code + PKCE, cookie `HttpOnly, Secure, SameSite=Lax`; изменяющие запросы с cookie требуют Origin и `X-CSRF-Token`; интеграции — короткий bearer; bearer + cookie одновременно отклоняется | `03:40–42` |
| Авторизация в контракте | `x-permissions` (AND, `x-permissions-mode: all`), `x-scope`; Spectral: каждая операция имеет `operationId`, `x-permissions` из каталога, `x-scope`, 4xx через `Problem` | `03:48–50`; `12:99` |
| Идемпотентность | `Idempotency-Key` (UUID v4) на всех изменяющих; namespace тенант + actor + операция (публичная форма — тенант + токен + nonce + операция); одинаковый ключ и payload → прежний результат; другой payload → 409; выполняется → 409 + `Retry-After`; свежая авторизация до возврата сохранённого результата; финансовая операция — ещё и уникальность бизнес-основания | `03:60–62`; `12:95` |
| Ревизии | `If-Match` strong ETag на изменение; нет → 428, устаревший → 412; после записи клиент получает новую ревизию | `03:64`; `12:58,63` |
| 404 vs 403 | 404 одинаково для чужих и несуществующих ID (AC-01, AC-02); 403 «без раскрытия чужого объекта»; «информационные ошибки собственных объектов остаются полезными» | `12:41`; `03:85–86`; `02:293`; `15:35–36` |
| Деньги | `amountMinor` integer + `currency` ISO (`{"amountMinor":325000,"currency":"RUB"}` = 3 250 ₽); верхняя граница — точный JS integer; никакого float | `03:70`; `tenant_0002_fleet.sql:145` |
| Количества | decimal strings (`"50.000"`); пробег `numeric(10,1)` | `03:72`; `10:35` |
| Даты | RFC 3339 UTC; date-only `YYYY-MM-DD`; интервалы `[from, until)`; срок истекает по серверному времени | `03:74`; `12:98` |
| Списки | курсорная пагинация `?cursor=&limit=` (50 по умолчанию, максимум 200); курсор связан с actor, tenant, версией scope и запросом — после смены прав непригоден; фильтры применяются до пагинации и агрегации; `total` — только если дёшево и разрешено, не раскрывает скрытые строки | `12:96`; `03:76` |
| Фильтры и сортировка | `?filter[state]=on_route&sort=-startedAt`; набор объявлен в схеме | `12:97` |
| Имена | JSON camelCase; enum — snake_case строки | `12:91` |
| Версия | `/api/v1`; несовместимое изменение — новый путь/ресурс, `Deprecation` + `Sunset` за 90 дней; клиент игнорирует неизвестные поля ответа | `12:93–94` |
| Заголовки ответа | `X-Request-Id` всегда | `12:95` |
| Realtime/кеш | права не кешируются без `policy_version`; отзыв роли → инвалидация ≤ 5 с (S1-15) | `10:130`; `13-backlog-s0-s2.md:75` |
| Control ↔ tenant | между БД нет атомарной транзакции; блокировку membership/tenant проверяет gate; при неизвестном состоянии control plane sensitive writes fail closed (503 `dependency_unavailable`) | `02:295`; `12:65` |
| Публичные формы | `security: []`, но обязательны проверки токена, срока, nonce, антиспама, квоты; 410 `public_token_expired` / `nonce_used`; AC-08: публичный токен на `/vehicles` → 401/404 | `03:44,125–127`; `15:42` |
| Файлы | `POST /files/uploads` → presigned PUT → `POST /files/uploads/{id}/complete` → `GET /files/{fileId}` до `ready`; сервер не принимает чужой `fileId` или несовпадающую машину; `object_key` формирует сервер (FILE-01) | `03:101–102`; `api.js:621–625` |
| Модули | `enabled=false` → `retainedAccess=history_read` по умолчанию; `owner_export` → fully disabled с отдельным экспортом; `module.state`, `accessMode` и entitlement — разные значения | `03:131–133` |

## 6. Инварианты и правила конкурентности — с тестами

Уровни по `15-quality-security.md:5–17`: Integration (testcontainers), Isolation suite (блокирует merge), Concurrency suite (N горутин против реальной БД), Contract (Schemathesis), E2E (Playwright). Фикстура изоляции (`15:19–29`): тенант A «Холдинг» (Москва, Самара, Петербург × 4 фирмы), тенант B «Чужой клиент» с теми же названиями; менеджер Москва-1, менеджер Москва-2, руководитель региона Москва, владелец; водитель Москва-1; водитель Москва-2 во временном назначении на Москва-1; пользователь с двумя ролями («изменять» Москва-1 + «читать» Самара-2); пользователь с функцией driver и попыткой получить `fleet.earnings.read` через группу. Каждый эндпоинт добавляет строку в матрицу «актор × объект × 200/403/404» по каналам HTTP, Data Hub (count, фильтр, сортировка, агрегат), экспорт, поиск, файлы, уведомления, realtime, аудит.

| # | Инвариант | Где обеспечивается | Как тестировать | Источник |
|---|---|---|---|---|
| I-01 | Одна подтверждённая бронь на интервал ресурса (CAL-04, AC-03) | БД: `reservations_no_overlap` (EXCLUDE gist по `occupied`, состояния `hold/confirmed/consumed`) | Concurrency: 100 параллельных `POST /fleet/reservations` одного интервала → 1 × 201, 99 × 409 `reservation_overlap`; Integration: смежные `[10,12)` и `[12,14)` — обе приняты; `released` не блокирует; `hold` без `hold_expires_at` → отказ CHECK; `occupied` с буферами подготовки/уборки пересекается, `during` — нет → отказ | `tenant_0001_core.sql:235–253`; `10-data-model.md:13–16,115`; `15:37` |
| I-02 | Истёкшие `hold` переводятся в `expired` под блокировкой ресурса перед вставкой, без cron | Сервис в транзакции | Integration: hold с `hold_expires_at` в прошлом → новая бронь того же интервала принимается, старая стала `expired`; Concurrency: два клиента одновременно после истечения → один 201 | `tenant_0001_core.sql:234`; `02-architecture.md:182` |
| I-03 | Комплект ресурсов (`bundle_id`) подтверждается целиком | Сервис; EXCLUDE на каждом ресурсе | Integration: один из двух ресурсов занят → 409 `resources_unavailable`, ни одна строка комплекта не создана (`select count(*) where bundle_id = …` = 0) | `tenant_0001_core.sql:238`; `02:172` |
| I-04 | Машина в одном активном рейсе; водитель в одном рейсе на маршруте (CAL-06) | БД: `trips_active_vehicle_uq`, `trips_active_driver_uq` | Integration: второй рейс с той же машиной в `inspection` → unique violation → 409 (код ⚠ не задан: `resources_unavailable` или `invalid_transition`); затянувшийся рейс после конца `planned` всё ещё блокирует выдачу | `tenant_0002_fleet.sql:56–60`; `03:66` |
| I-05 | Рейс «в пути» без машины невозможен | БД: CHECK на `trips` | Integration: `UPDATE trips SET state='on_route'` без `vehicle_id`/`started_at` → отказ | `tenant_0002_fleet.sql:54`; `10:18` |
| I-06 | Нет выезда с блокирующим дефектом или без 5 фото `ready` (LOG-03/04, AC-04) | Сервис в транзакции `trips.start` (`POST /fleet/trips`), индекс `defects_blocking_open_idx` | Integration + E2E: 4 фото из 5 → 409 `inspection_incomplete`; фото в `scanning` → 409 `photo_not_ready`; открытый `blocking` дефект → 409 `blocking_defect_open`; одобрение осмотра менеджером не снимает блокирующий дефект | `tenant_0002_fleet.sql:126–128`; `10:97,117`; `15:38`; `03:103` |
| I-07 | Старт рейса атомарно потребляет бронь (`hold → consumed`); истёкший hold → 409 `reservation_expired` | Сервис в одной транзакции | Integration: после `POST /fleet/trips` бронь `consumed`, рейс `on_route`, `started_at` заполнен; повтор с тем же Idempotency-Key — тот же ответ, вторая бронь не создана (AC-07) | `10:97`; `12:44`; `13:123` |
| I-08 | Возвратный пробег ≥ пробега выезда (LOG-09); уменьшение только через `odometer_corrections` с причиной | Сервис команды `return` | Integration: `odometer_km` меньше → 422 `odometer_decrease`; коррекция создаёт строку `odometer_corrections` с `reason` и `approved_by` | `tenant_0002_fleet.sql:104–105,130–138`; `12:61` |
| I-09 | Машина освобождается только при `accepted`; `rework → submitted` | Сервис `review` | Integration: после `rework` машина остаётся занятой (`trips_active_vehicle_uq` действует); после `accepted` новая бронь той же машины принимается; повторный `review` → 409 `invalid_transition` | `10:99`; `api.js:382` |
| I-10 | ≥ 1 активный владелец (AUTH-08) | Сервис под `SELECT … FOR UPDATE` строки `tenants`; `owner_bindings_active_uq` | Concurrency: тенант с двумя владельцами, два параллельных отзыва → один 2xx, один 409 `last_owner_required`; последовательный отзыв единственного → 409 | `control_0001_init.sql:60–71`; `12:52`; `15:12` |
| I-11 | Функция `driver` блокирует начисления (AUTH-05, A-12, D-10) | БД: EXCLUDE на `work_profiles`; сервис при назначении (409 `separation_of_duties_conflict`) и при каждом чтении (403 `function_blocked`) | Isolation (AC-05): для водителя Trip DTO, `/earnings`, Data Hub, экспорт, поиск, аудит, уведомления не содержат суммы и метаданных; назначение финансовой роли водителю и функции `driver` обладателю финансов → 409; выдача через группу → тоже блок; старая «неверная» конфигурация (функция добавлена после роли) → чтение всё равно 403 | `tenant_0001_core.sql:97–106`; `tenant_0002_fleet.sql:192–194`; `02:139`; `15:39` |
| I-12 | Роль без wildcard (A-05) | БД: `CHECK (not ('*' = any(actions)))` | Integration: INSERT `role_versions` с `'*'` → отказ | `tenant_0001_core.sql:129`; `10:19` |
| I-13 | Назначение всегда с областью (AUTH-01) | БД: CHECK `scope_kind/scope_ref` | Integration: `scope_kind='unit'` с `scope_ref=null` → отказ; `scope_kind='tenant'` с `scope_ref` → отказ | `tenant_0001_core.sql:164`; `10:19` |
| I-14 | Каждый grant проверяется целиком; права не перемножаются | Evaluator `permit()` | Isolation: пользователь «изменять Москва-1» + «читать Самара-2» → PATCH объекта Самара-2 → 404/403, GET → 200; PATCH Москва-1 → 200 | `02:114`; `15:26` |
| I-15 | Делегирование не превышает права назначающего | Сервис `roles.assign` (delegation closure) | Isolation: менеджер с `roles.assign` создаёт роль с `fleet.earnings.read`, которого не имеет, и назначает себе → 409 `delegation_exceeds_grant` (STRIDE: Elevation of privilege) | `02:131`; `15:61` |
| I-16 | Квота не превышается параллельными загрузками (PLAT-07, A-10) | БД: условный `UPDATE files.usage … RETURNING`; `quota_ledger` reserve/commit/release с TTL | Concurrency: `limit_bytes` = used + 1 ГБ, два параллельных резерва по 1 ГБ → один 409 `quota_exceeded`; `activity_reserve_bytes` позволяет закрыть начатую смену при исчерпанной квоте; незавершённый резерв освобождается по `expires_at`; `finalize` сверяет реальный размер | `tenant_0001_core.sql:201–221`; `10:22,123`; `02:271` |
| I-17 | Уменьшение квоты — только на границе периода и при использовании ≤ нового лимита | Сервис | Integration: новый лимит < `committed_bytes` → 409 `downgrade_below_usage` с «сколько освободить»; файлы не удаляются | `12:54`; `02:267`; `03:135` |
| I-18 | Повтор команды не создаёт второй эффект (NFR-02, AC-07) | `core.idempotency_keys` (PK actor+operation+key, hash, state) + `outbox.inbox` | Concurrency: 100 повторов `POST /fleet/trips/{id}/expenses` с одним ключом → одна строка `expenses`, все ответы одинаковы; тот же ключ + другой payload → 409 `idempotency_key_reused`; во время выполнения → 409 `idempotency_in_progress` с `Retry-After`; ключ короче 8 или длиннее 128 символов → отказ CHECK | `tenant_0001_core.sql:27–38`; `03:60–62`; `15:41` |
| I-19 | Номер рейса уникален без гонок | `core.counters` `UPDATE … RETURNING` + `UNIQUE trips.number` | Concurrency: 100 параллельных стартов → 100 разных номеров, нет дублей | `tenant_0001_core.sql:40–45`; `tenant_0002_fleet.sql:33`; `10:125` |
| I-20 | `policy_version` +1 при изменении ролей/назначений/модулей; кеш прав и курсоры инвалидируются; realtime ≤ 5 с | `access.policy_state`; событие `access.policy.bumped.v1` | Integration: после `DELETE /assignments/{id}` `policy_version` вырос на 1; старый `cursor` → 4xx/пустой; AC-10: отзыв роли во время экспорта → выдача файла 403 | `tenant_0001_core.sql:109–112`; `12:76`; `13:75`; `15:44` |
| I-21 | Чужой тенант и чужая фирма → 404; время ответа не различается заметно (AC-01, AC-02) | Tenant resolver + `scopeQuery` в каждом запросе | Isolation: сессия тенанта A с `tenantId` B → 404, пул B не открывается; менеджер A подставляет ID машины фирмы Б → 404; те же проверки через count/фильтр/сортировку/агрегат Data Hub | `02:48`; `15:35–36`; `14-engineering.md:111` |
| I-22 | Sentinel tenant DB совпадает с `tenant_routing.sentinel` | Сервис при открытии пула | Integration: подменить `secret_ref` на другую БД → пул не открывается, 503 `dependency_unavailable` | `tenant_0001_core.sql:18–24`; `02:52` |
| I-23 | Места: `active + invited` ≤ `entitlements.seats`; проверка под `FOR UPDATE` тенанта | Сервис + view `tenant_seat_usage` | Concurrency: лимит 10, занято 9, два параллельных приглашения → один 201, один 409 `seats_exhausted`; разблокировка участника проходит ту же проверку; отзыв приглашения освобождает место; заблокированный владельцем участник и карточка без аккаунта место не занимают | `control_0002_billing.sql:82–95`; `17:30–46` |
| I-24 | Одна открытая заявка на тариф на организацию | БД: `scr_one_pending_uq` | Concurrency: два параллельных `POST …/change-requests` → один 201, один 409 `request_pending` | `control_0002_billing.sql:70`; `17:138` |
| I-25 | Версия тарифной сетки неизменяема; две версии не действуют одновременно; одна запланированная | БД: EXCLUDE `effective`; сервис | Integration: публикация без закрытия `effective` текущей → отказ EXCLUDE; вторая запланированная → 409; подписка хранит `price_version`, цена фиксируется на период | `control_0002_billing.sql:4–5,16`; `17:62–63` |
| I-26 | Операторы: ≥ 2 активных `owner`, не менять себе роль, не отключать себя; `owner` только из активного с MFA | Сервис под `FOR UPDATE`; CHECK `role <> 'owner' or status <> 'invited'` | Integration: приглашение с `role=owner` → 422; понижение последнего из двух владельцев → 409; `PATCH /platform/operators/{me}` → 409 | `control_0001_init.sql:117,128`; `17:149–150,176–180` |
| I-27 | Доступ поддержки ≤ 60 мин, без начислений, с одобрением владельца (кроме break-glass) | БД: три CHECK на `support_grants` | Integration: `valid` 61 мин без `break_glass` → отказ; `actions` с `fleet.earnings.read` → отказ; `approved_by null` без `break_glass` → отказ; ⚠ `fleet.earnings.manage` CHECK не блокирует | `control_0001_init.sql:143–145`; `10:126` |
| I-28 | Оформление изолировано по тенантам; `accent_used` ≥ 4.5:1; SVG с `<script>` → 422 (BR-T1…T3) | Сервис + CHECK hex | Isolation/Contract: владелец A сохраняет → `GET /tenants/B/branding` и `/public/branding/{slugB}` не меняются; PUT в чужой тенант → 404; аккаунт в двух тенантах после смены организации получает оформление только текущего | `15:48–50`; `18:85–103` |
| I-29 | Расход 0 ₽ и топливо без литров отклоняются | БД: CHECK на `expenses` | Integration: `amount_minor = 0` → отказ; `category='fuel', liters=null` → отказ; API — 422 `amount_invalid` / `validation_failed` | `tenant_0002_fleet.sql:145,158`; `10:21` |
| I-30 | Две пересекающиеся функции одного человека невозможны | БД: EXCLUDE на `work_profiles` | Integration: второй `driver` с пересекающимся `valid` → отказ | `tenant_0001_core.sql:105`; `10:20` |
| I-31 | Временный доступ пула: после срока — 404 на рейс, новые рейсы запрещены (AC-06); отмена отзывает grant и бронь | Сервис + `driver_transfers.assignment_id` | Isolation: временный водитель видит только согласованный рейс и срок; после `period` → 404; грант не открывает исторические рейсы и начисления | `tenant_0002_fleet.sql:175–190`; `02:173–184`; `15:40` |
| I-32 | Read-only тенант: чтение и экспорт работают, создание → 403 `tenant_read_only` (AC-11); отключение логистики с активным рейсом: новый рейс 403, текущий сдаётся (AC-12) | Gate состояния тенанта и модуля; `startedWork` в прототипе | E2E: см. §8 | `15:45–46`; `api.js:61–67` |
| I-33 | Между control DB и tenant DB нет атомарной транзакции: приглашение создаёт `person_profile` в tenant DB и `invitation`/`membership` в control DB последовательно | Сервис (saga/компенсация) | Integration: сбой после создания профиля → профиль без `membership_id` помечен/очищен; повтор с тем же Idempotency-Key не создаёт второй профиль | `control_0001_init.sql:52,78`; `tenant_0001_core.sql:87`; `02:295` |

## 7. Разрывы между прототипом и SQL-схемой

### 7.1 Сущности прототипа без таблиц (нужны миграции 0003+)

| Сущность прототипа | Поля прототипа (дословно) | Источник | Что есть в документах | Предложение по миграции (⚠ предложение плана, не источник) |
|---|---|---|---|---|
| Формы `forms[]` | `id, name, module, owner, status (published/draft), published (номер версии), versions[{v, at, by, fields[{id, label, type (photo/number/text/multi/choice/bool), required, section, options[], showIf{field, eq}}]}], automations[{id, text, version, on}], draft[]` | `mock-data.js:222–258` | OpenAPI: 10 операций форм + 5 публичных (`03:21–22`); права `core.forms` (7 ключей); коды 410 `public_token_expired`/`nonce_used`; «Пользовательские поля (jsonb с метаданными) — S3, вместе с формами» (`10:132`) | `forms.forms, forms.versions (items jsonb, неизменяемы), forms.automations, forms.responses (version_id, values jsonb, author, object_ref), forms.public_tokens (token_hash, nonce, expires_at)` |
| Ответы форм `responses[]` | `id ('R-0988'), formId, version, at, author, object ('Рейс Р-171'), status ('Принят'), values{}, key (идемпотентность)` | `mock-data.js:259–262`; `api.js:39–50` | AC-09: ответ v1 читается после публикации v2 по структуре v1 (`15:43`); «Ответ фиксирует ID версии и стабильные ключи вопросов» (`03:123`) | см. выше |
| Проекты задач `projects[]` | `id, key ('LOG','ЗАЯ','SPA'), name, flow ('tasks' \| 'leads'), unit, owner` | `mock-data.js:274`; `seedLotos:77` | `projects.flow` (`19:27`); права `tasks.projects.*`; scope `project` есть в `role_assignments.scope_kind` | `tasks.projects (key, name, flow, unit_id, owner_person_id, visibility_mode inherited/restricted — 02:120)` |
| Задачи `tasks[]` | `id ('T-61','L-31'), title, assignee (имя строкой), status (русская подпись «Новая»/«В работе»/«На проверке»/«Готово»/«Отменена»; для leads «Замер»/«Смета»/«Договор»/«Объект»/«Отказ»), source ('R-1012'), rule ('au-1 · v1'), priority (urgent/high/normal/low), due ('27.09'), project, checklist[{t, d}], comments[{by, at, text, system}], links[{kind (response/trip/vehicle/form), id, label}], lead{client, source, sum}` | `mock-data.js:263–273`; `models.js:124–138` | `WORKFLOWS` tasks/leads и `TASK_FLOW` (`models.js:125,128–136`); «Поля заявки — `tasks.lead jsonb` до появления пользовательских полей (S3)» (`19:27`); «Нельзя завершить: в чек-листе есть невыполненные пункты» (`api.js:434`); OpenAPI: 7 операций (`03:18`) | `tasks.tasks (number, project_id, assignee_person_id, status snake_case, priority, due_on, source_ref, lead jsonb, revision), tasks.checklist_items, tasks.comments (system bool), tasks.links` |
| База знаний `knowledge` | `spaces[{id, name}], pages[{id, space, title, access ('all' \| 'owner'), versions[{v, at, by, body}]}]` | `extra-data.js:24–41` | OpenAPI: 4 операции «Страницы и контроль ревизии» (`03:19`); права `core.knowledge` (4); конфликт базовой версии → 409 в прототипе (`api.js:471`), канон 412 | `knowledge.spaces, knowledge.pages (space_id, title, access), knowledge.page_versions (неизменяемы)` |
| Календарь `calendar` | `resources[{id, kind ('vehicle' \| 'staff' \| 'room' \| 'equipment'), name, unit, ref}], bookings[{id, title, source{kind ('trip' \| 'vehicle' \| 'appointment'), id} \| null, res[], start (часы, float), end, prep, clean}]` | `extra-data.js:4–23` | `sched.resources` (kind `person`, не `staff`; `ref_id uuid not null`), `sched.reservations` (`source_type/source_id not null`) | таблицы есть; разрывы: «Перерыв» (`source: null`) и «Плановое ТО» (`source.kind='vehicle'`) требуют `source_type` вида `sched.block`/`fleet.maintenance` ⚠; `staff`→`person`; `start/end` часы → `tstzrange` в зоне подразделения |
| SPA `spa` | `stock[{id, name, unit, qty}], appointments[{id, time, client, service, room, equipment, duration, prep, clean, recipe[[item, qty]], status ('confirmed' \| 'done' \| 'done_pending')}], movements[{id ('MV-…'), at, item, qty, unit, basis}], issues[{id ('IS-…'), ap, item, need, unit, missing, text, status ('open' \| 'resolved'), how}]` | `extra-data.js:42–54`; `api.js:479–504` | OpenAPI: SPA 7 операций, склад 4 (`03:25–26`); статусы контракта `performed_pending_posting` → `completion` (`03:113–117`); ключи `spa.*`, `inventory.*` только в OpenAPI; «Модель SPA, склада … появится в 0003+» (`10:3,133`) | `spa.services (versions), spa.appointments (bundle → sched), spa.performances, inventory.items, inventory.movements (неизменяемы), inventory.discrepancies` |
| Касса `cash` | `accounts[{id, name, unit}], ops[{id ('K-301'), account, type ('in' \| 'out' \| 'refund' \| 'storno'), amount, basis, at, by, src, reverses, reversedBy, sign}]` | `extra-data.js:55–63`; `api.js:507–526` | OpenAPI: 4 операции (`03:27`); ключи `cash.read/post/manage` только в OpenAPI; «Возмещение — отдельная операция кассы (S4)» (`10:105`); исправление — сторно, не удаление | `cash.accounts, cash.operations (amount_minor, kind, basis, reverses_id, неизменяемы)` |
| Ремонт `repair` | `object{id, name, address, stage, area, kind, contract, due, client, foreman, access[[icon, text]], sub{name, scope, until}}, works[{id, name, unit, plan, fact}], crew[{id, name, role, account:false}], materials[{id, name, unit, qty}], logs[{id ('WL-11'), at, work, volume, crew[], materials[[id, q]], photos (число), status ('На проверке' \| 'Принят'), by}]` | `extra-data.js:64–83`; `api.js:529–549` | Черновик схемы `repairs`: `leads, objects, measurements/rooms, price_items, estimates/estimate_lines, stages, documents, supply_requests, crew_accruals, client_links` (`19:135–150`); новые поля `objects`: `area_m2, rooms, kind, contract_no, due_on, client_name, foreman_id, access jsonb` (`19:99`); OpenAPI 4 операции; ⚠ в черновике нет таблиц `works` и `work_logs`, хотя `work_log` — ключевая сущность (`16:102`) и `addWorkLog`/`acceptWorkLog` — команды прототипа; имя `project` vs `object` не выбрано (RS-08) | `repairs.objects, repairs.works, repairs.work_logs (+ crew, materials jsonb, photos → files), repairs.crew (person_profiles без аккаунта), repairs.materials` в 0003; остальное из черновика — позже |
| Уведомления `events[]` | `id, at, text, to[] (member ids), sensitive ('earnings' \| null), unit` | `api.js:27,395`; `mock-data.js:221` | S1-26 «Уведомления «входящие» с проверкой адресата на enqueue и доставке» (`13:101`); AC-05 — у водителя нет уведомления с суммой | `notify.inbox (recipient_person_id, text, sensitivity, unit_id, read_at)` — таблицы нет |
| Приёмка смены `trip.review` | `{decision ('accept' \| 'rework'), comment, steps[] ('photos' \| 'odo' \| 'expenses' \| 'checklist'), at, resolved}`; `REV_STEPS`: «Фото при сдаче», «Пробег», «Расходы», «Чек-лист и дефекты» | `api.js:380–397`; `Ортус CRM.dc.html:2364` | `fleet.trips.reviewed_at/reviewed_by` — только факт; событие `fleet.trip.rework_requested.v1`; «вернуть по разделам» (S2-10, `13:127`) | ⚠ нет места для `comment` и `steps`: нужна `fleet.trip_reviews (trip_id, decision, comment, sections text[], created_by)` или jsonb |
| Хранилище по модулям `storage.breakdown` | `[['Фото осмотров и отчётов', 31.4], ['Документы', 9.8], …]` | `mock-data.js:148–150`; `seedLotos:59` | `files.usage` — только итоги; S1-22 «по модулям» (`13:92`); `tenant_usage_daily` «не сделано» (`17:205`) | агрегат по `files.objects.purpose` (prefix до точки) или счётчики по модулю |
| Очередь отправки `outbox` (клиент) | `{opId, label, state ('local' \| 'error'), error}` | `Ортус CRM.dc.html:2573` | клиентское (PWA, S2-15); серверная сторона — `core.idempotency_keys` | без таблицы |
| Операторская аналитика «Использование» | сводка, сигналы, модули, строки по организациям | `17:186–205` | источник — «только метаданные control DB: места, объём файлов, подключённые модули, `accounts.last_login_at`» (`17:188`), но объём файлов живёт в tenant DB `files.usage` ⚠ | нужен снимок в control DB (`tenant_usage_daily`) или периодическая репликация |

### 7.2 Сущности с таблицами, но с расхождениями полей и enum

| Прототип | SQL | Разрыв |
|---|---|---|
| `platform.tenants[].status`: `trial / active / restricted / suspended` (`models.js:111–116`, подписи «Пробный период», «Действует», «Ограничен», «Приостановлен») | `tenant_state` 8 значений | `restricted` = `grace`/`read_only` (`docs/README.md:49`); подписей для `provisioning/grace/read_only/closing/closed` в прототипе нет ⚠ |
| `tenants[]`: `trialEnds ('13.10.2026'), trialDaysLeft, quotaGb, usedGb, members, modules[], plan{tier, term, paidUntil, version}, seatsLimit, seatsUsed` | `tenants` + `subscriptions (tier_code, term_months, price_version, period)` + `entitlements ('seats','storage.bytes','module.*')` + view `tenant_seat_usage` + tenant DB `files.usage` | `quotaGb/usedGb` — байты; `usedGb` в другой БД; `trialEnds` = `upper(subscriptions.period)` при `state='trial'` |
| `members[]`: `id, name, email, status ('active' \| 'invited' \| 'blocked'), title ('Логист', 'Водитель', 'Диспетчер · Самара'), function ('driver'), invitedNote ('Приглашение до 06.10')` (`mock-data.js:151–162`) | `people.person_profiles (full_name, phone, email, home_unit_id not null)` + control `memberships.status (invited/active/suspended/ended)` + `people.work_profiles.function` + `invitations.expires_at` | `blocked` → `suspended`; ⚠ колонки для `title` (должность) нет; у участников прототипа нет `home_unit_id` (обязателен) |
| `groups[]`: `{id, name, members[]}` | `access.groups` + `group_members` | совпадает; «Создать группу · следующая итерация» (`Ортус CRM.dc.html:331`) |
| `roles[]`: `{id, name, kind ('system' \| 'template' \| 'custom'), all, professional ('driver'), actions{module: [verbs]}, finance{read, manage}}` (`mock-data.js:167–173`) | `access.roles (kind, template_key, current_version)` + `role_versions.actions text[]` | `all: true` → OwnerBinding; `actions{mod:[verbs]}` → плоские ключи через `rolePermKeys` + `prototype_renames`; `finance.read/manage` → `fleet.earnings.read/manage`; ⚠ `professional` (функция роли) в SQL не хранится — функция принадлежит человеку (`work_profiles`), а в каталоге шаблон имеет `work_function` |
| `assignments[]`: `{id, member, role, scope{type, id}, via ('группа «Водители Север»'), until}` (`mock-data.js:174–179`) | `role_assignments (principal_kind person/group, role_version, scope_kind, scope_ref, include_descendants, valid, state, source, granted_by)` | `via` → `principal_kind='group'`; `until` → `upper(valid)`; `region/firm` → `unit` |
| `units[]`: `{id, type ('region' \| 'firm'), name, parent}` (`mock-data.js:143–146`) | `org.units (kind region/company/branch/team, time_zone not null)` + `unit_closure` | `firm` → `company`; ⚠ `time_zone` в прототипе нет (сид backend должен задать `Europe/Moscow`/`Europe/Samara`, `tenant_0001_core.sql:53`) |
| `modules`: `{logistics: {enabled, history}, spa, repair}` (`mock-data.js:147`) | `modules.installations (state enabled/draining/read_only/disabled, retained_access, settings)` | `history: true` ≈ `read_only`; ядровые модули прототип считает всегда включёнными (`moduleOn`, `models.js:169`) |
| `vehicles[]`: `{id, unit, model, plate ('А 412 МР 77'), body ('Тент' \| 'Фургон' \| 'Рефрижератор'), payloadT, volumeM3, lengthM, temp [min,max] \| null, odometer, state ('free' \| 'reserved' \| 'on_route' \| 'review' \| 'unavailable'), heldBy, note, depot}` (`mock-data.js:180–188`; `models.js:85–91`) | `fleet.vehicles (plate, vin, body_type van/box/reefer/tent/flatbed, payload_kg, volume_m3, cargo_length_mm, temp_min_c, temp_max_c, odometer_km, service_state ok/maintenance/out_of_service)` | ⚠ `model`, `depot` — колонок нет; `VehicleState` прототипа — проекция из `service_state` + активной брони/рейса, в БД не хранится; единицы: т → кг, м → мм; `body` подписи → enum |
| `trips[]`: `{id ('Р-208'), unit, title, date ('01.10.2026'), window ('09:00–13:00'), distanceKm, driverId, driverName, vehicleId, status (без 'cancelled'), earnings (число!), cargo{weightT, volumeM3, lengthM, temp, kind}, stops[{time, name, op, w, v}], dep, ret, expenses[], review, defect, reservedUntil}` (`mock-data.js:189–212`; `models.js:93–103`) | `fleet.trips (number 'TR-2026-000123', planned tstzrange, cargo_* в кг/мм, driver_person_id, reservation_bundle_id, departure/return_inspection_id)` + `trip_stops (seq, address, time_window, weight_kg, volume_m3, contact)` | `earnings` внутри рейса запрещено AC-05 → `finance.earnings`; ⚠ `title`, `distanceKm`, `cargo.kind` — колонок нет; `cancelled` нет в `TRIP_STATE` прототипа; `reservedUntil` = `reservations.hold_expires_at` |
| Осмотр `dep/ret`: `{odometer, fuel ('q' \| 'h' \| 'tq' \| 'f'), defects[{zone (русская подпись из DEFECT_ZONES), text, critical, downgraded}], photos{front/back/left/right/odo: {state, fileId}}, comment, at}` (`api.js:337,374`; `models.js:118–122`) | `fleet.inspections (fuel_level quarter/half/three_quarters/full, answers jsonb, state submitted/approved/blocked)` + `inspection_photos (role …/odometer)` + `defects (zone, severity minor/major/blocking, state)` + `checklist_versions` | `odo` → `odometer`; `critical: true` → `severity='blocking'`; `downgraded` → `defects.state='resolved'` + аудит; чек-листы `DEP_CHECKS`/`RET_CHECKS` («Кузов и стёкла осмотрены», «Шины и световые приборы исправны», «Документы и комплект на месте» / «Груз выгружен полностью», «Личные вещи забраны», «Ключи и документы на месте») → `checklist_versions.items` |
| Расходы `expenses[]`: `{id, category ('fuel' \| 'wash'), amount (₽ float), date, comment, liters, receipt{fileId, url}, at}` (`api.js:365`; `models.js:123`) | `fleet.expenses (category fuel/wash/parking/toll/other, amount_minor, currency, occurred_on, receipt_file_id, state)` | категорий в прототипе 2 из 5 (D-12); ⚠ состояния `verified/rejected/reimbursed` в прототипе нет (S2-11) |
| Начисления `earnings[]`: `{id, tripId, unit, member, amount, status ('Начислено')}` (`api.js:392`) | `finance.earnings (state draft/approved/corrected)` | `'Начислено'` ≈ `approved`; создаётся при `accepted` |
| Пул `pool.drivers[]`: `{id ('d-104'), code ('Водитель #104'), qual ('Кат. C · рефрижератор'), home, unit, window, terms}`; `pool.requests[]`: `{id, driverId, tripId, comment, status ('pending' \| 'approved' \| 'declined'), home, at, until, decidedAt}` (`mock-data.js:213–219`; `api.js:401–412`) | `fleet.pool_publications (catalog_ref, qualifications[], available)` + `driver_transfers (state requested/approved/rejected/revoked/expired/completed, assignment_id)` | `declined` → `rejected`; `code` «Водитель #104» — производное от `catalog_ref`; `terms` («По соглашению фирм группы») ⚠ колонки нет |
| Аккаунты `platform.accounts[]`: `{id, name, email, status ('active' \| 'pending' \| 'locked'), mfa (bool), lastLogin, lockReason, memberships[{tenantId, status (active/invited/suspended/ended), owner}]}` (`mock-data.js:114–128`) | `accounts (status active/locked/deleted, mfa_enabled, last_login_at, locked_at, lock_reason)` + `memberships` + `owner_bindings` | `pending` → `last_login_at is null`; `owner` → активный `owner_binding` |
| Операторы `platform.operators[]`: `{id, name, email, role, status, mfa ('аппаратный ключ' \| 'приложение' \| null), lastLogin, me, disabledNote}` (`mock-data.js:130–137`) | `platform_operators (role, status, disabled_at, disabled_by)` + `accounts` | ⚠ тип второго фактора (текст) в SQL не хранится — только `mfa_enabled`; `disabledNote` → `platform_audit.reason` |
| Тарифная сетка `priceBook`: `{current, scheduled, versions[{v, from ('01.10.2026'), to, note, by, scheduled, tiers[{id, name, seats, month}], terms[{months, off}]}]}` (`mock-data.js:98–108`) | `price_book_versions (effective, note, published_by)` + `price_tiers (tier_code, name, seats_limit, month_minor, sort)` + `price_terms (months, discount_pct)` | `month` ₽ → `month_minor` копейки; `scheduled` → `lower(effective) > now()`; `current` → `effective @> now()` |
| Заявки `platform.requests[]`: `{id ('SR-12'), tenantId, from, to, term, used, by, at, status, comment, decidedBy, decidedAt, decision}` (`mock-data.js:109–112`) | `subscription_change_requests` | совпадает, `number` формата `SR-000021` |
| Аудит `platform.audit[]`: `{at, text, by}` (`mock-data.js:138–141`) | `platform_audit` структурированный | текст прототипа → `details`/`reason` |
| Оформление `tenant.brand`: `{name, short, accent, logo, mark, terms{key:{one, plural, few, many}}, items{}, order[], poweredBy, version, updatedAt, updatedBy}` (`mock-data.js:10–19`) | `tenant_branding_versions (display_name, short_name, accent_hex, accent_used, logo_file, mark_file, terms, menu {items, order}, powered_by, created_by, created_at)` | `items + order` → `menu`; `accent_used` вычисляет сервер (прототип `fixAccent`, `Ортус CRM.dc.html:2355`) |
| Файлы: `upload()` возвращает `{fileId, state: 'ready', name}` (`api.js:567`) | `files.objects` полный цикл `reserved → uploaded → scanning → ready` | прототип пропускает `scanning`; квота проверяется по `usedGb >= quotaGb` без резерва (`api.js:556`) |

### 7.3 Сиды для тестов (PD-19)

Идентификаторы прототипа, которые должны совпасть в TS- и Go-сиде (`tdd-protocol.md:56`): тенанты `t-alta`, `t-lotos`, `t-remstroy`, `t-cargo`; участники `m-owner`, `m-kotova`, `m-vasiliev`, `m-morozova`, `m-sokolov`, `m-petrova`, `m-gromov`, `m-kotelnikova`, `m-akhmedov`, `m-ilyin`; роли `r-owner`, `r-manager`, `r-driver`, `r-therapist`, `r-foreman`, `r-admin`; рейсы `Р-208`, `Р-211`; машины `v1`–`v7`; подразделения `r-msk`, `r-smr`, `r-spb`, `f-msk-sever` … (`mock-data.js:82–86`); аккаунты `acc-1`…`acc-13`; операторы `op-1`…`op-6`; заявки `SR-12`, `SR-9`. В SQL первичные ключи — UUID, поэтому прототипные строки должны стать детерминированными UUID (например, v5 от строки) ⚠ способ не зафиксирован. ID `m-owner`, `m-morozova` намеренно совпадают в двух тенантах (`18:94`).

## 8. Чек-лист приёмки (Playwright)

Формат — один `test()` на пункт (`tdd-protocol.md:22`); селекторы `getByRole`/`getByLabel`/`getByText` с дословными подписями; проекты `mobile-390` и `desktop-1440`. Фаза 1 — против mock-адаптера (демо-сид), фаза 2 — против стенда; пункты с «API:» проверяются перехватом ответа (`page.waitForResponse`) и в фазе 2 обязательны.

Страница `users` (вкладки «Люди», «Группы», «Роли», «Проверка доступа»):

| # | Given | When | Then |
|---|---|---|---|
| P-01 | персонаж «Владелец», вкладка «Проверка доступа» | нажать пресет «Нет права» | чип «Нет права», заголовок «Илья Васильев не может: принимать смены», текст «Ни одна роль сотрудника не разрешает это действие.» |
| P-02 | та же вкладка | пресет «Модуль не подключён» | чип «Модуль не подключён», текст «Модуль не подключён организацией. Подключить его может владелец бизнеса. Модуль: Ремонт и стройка.» |
| P-03 | та же вкладка | пресет «Нет доступа к объекту» | чип «Нет доступа к объекту», текст «Право есть, но объект находится вне области назначения. Объект: Isuzu Elf · Юг Транс.» |
| P-04 | та же вкладка | пресет «Начисления водителю» | чип «Запрещено функцией «Водитель»», текст «Действующая функция «Водитель» запрещает начисления через любую роль и группу.»; в блоке навигации нет пункта «Начисления» |
| P-05 | та же вкладка, участник «Марина Котова», действие «Принимать смены», объект «Рейс Р-208 · Север Логистик» (после назначения роли) | — | чип «Разрешено», заголовок «Марина Котова может: принимать смены», текст начинается с «Основание · роль «Менеджер логистики» · » |
| P-06 | вкладка «Роли», выбрана «Владелец бизнеса» | — | поле «Название роли» `disabled`; текст «Системная роль: все модули и области организации. Не редактируется и защищает от потери доступа последним владельцем.»; кнопка «Сохранить роль» отсутствует/неактивна |
| P-07 | вкладка «Роли», выбрана «Водитель» | — | текст «Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.»; факт «Начисления скрыты»; примечание «Роль с функцией «Водитель» не может содержать начисления»; переключатель финансового блока `disabled` |
| P-08 | вкладка «Роли», выбрана «Менеджер логистики» | — | факты (по порядку): «Подключение модуля организации само по себе не выдаёт права — их задаёт роль», «Область данных выбирается при назначении роли сотруднику», «Начисления видны в области назначения», «Данные других организаций недоступны» |
| P-09 | вкладка «Люди», диалог назначения роли Илье Васильеву (функция «Водитель») | выбрать роль с начислениями («Менеджер логистики»), сохранить | в диалоге текст «Функция «Водитель» несовместима с правом на начисления (правило MVP).»; тоста нет; диалог не закрыт; API: 409 `separation_of_duties_conflict` |
| P-10 | диалог назначения, роль не выбрана | сохранить | в диалоге «Выберите роль»; запрос не отправлен |
| P-11 | диалог назначения Марине Котовой, роль «Менеджер логистики», область «Север Логистик» | сохранить | тост `role="status"` «Роль «Менеджер логистики» назначена»; диалог закрыт; в «Пути проверки» шаг «Назначить Марине Котовой роль и область» отмечен «✓» |
| P-12 | назначение владельца (`r-owner`) единственное | снять назначение | тост `role="alert"` «Нельзя снять роль с последнего владельца»; назначение на месте; API: 409 `last_owner_required` |
| P-13 | назначение не владельца | снять | тост «Назначение снято» |
| P-14 | лимит мест исчерпан (тенант `t-alta`: 9 из 10 → пригласить одного, затем ещё одного) | отправить приглашение | тост `role="alert"` «Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.»; API: 409 `seats_exhausted` |
| P-15 | участник с адресом уже есть | пригласить тот же email | тост «Участник с таким адресом уже есть» |
| P-16 | приглашённый участник | отозвать приглашение | участник исчез из списка, место освобождено (счётчик мест уменьшился на 1) |

Страница `modules` («Модули и место») и состояния тенанта:

| # | Given | When | Then |
|---|---|---|---|
| T-01 | владелец, «Логистика» выключена | персонаж «Водитель» → «Мой день» | подпись подбора машины «Модуль «Логистика» отключён: новые брони недоступны.»; кнопка брони `disabled` |
| T-02 | владелец, нажата «Демо: завершить пробный период» (тенант `restricted`) | открыть «Главная» | баннер «Пробный период завершён.» с текстом «Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.»; кнопка «Демо: продлить как оператор» |
| T-03 | тенант `restricted`, водитель с рейсом в `on_route` (AC-12/I-32) | сдать машину | сдача проходит (тост успеха); новая бронь → «Пробный период организации завершён: новые брони недоступны.»; API: 403 `tenant_read_only` на создание, 2xx на return |
| T-04 | тенант `restricted` | переключатели модулей | `disabled`; изменение квоты `disabled` |
| T-05 | фаза 2: тенант `read_only` | `GET` списков и экспорт | 200; `POST /fleet/reservations` → 403 `tenant_read_only` (AC-11) |

Страница `driver-today` (негативные проверки «Пути проверки»):

| # | Given | When | Then |
|---|---|---|---|
| D-01 | рейс Р-208, подбор машины | — | у «Hyundai Porter» и «Ford Transit» кнопка брони `disabled`, причина указана (например «Грузоподъёмность: 0,9 т, нужно от 1,1 т») |
| D-02 | флажок «Конфликт брони» включён в панели «Демо-режим» | забронировать совместимую машину | текст конфликта «Машину только что забронировал другой сотрудник. Список на экране устарел.»; возврат на «Мой день»; флажок сброшен; API (фаза 2): 409 `reservation_overlap` |
| D-03 | флажок «Нет связи» | открыть «Мой день» | чип `role="status"` «Нет связи»; баннер «Нет связи.» «Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.»; подпись подбора «Нет связи: бронь требует подтверждения сервера.» |
| D-04 | осмотр с 4 фото из 5 | — | кнопка «Выехать» `disabled`; список недостающего содержит «1 фото» (I-06; API: 409 `inspection_incomplete`) |
| D-05 | фото в состоянии загрузки | «Выехать» | тост «Не все фото загружены на сервер» (API: 409 `photo_not_ready`) |
| D-06 | флажок «Сбой загрузки фото» | загрузить фото | ошибка «Загрузка прервалась. Повторите попытку.»; повтор проходит |
| D-07 | расход, сумма «-500» | сохранить | ошибка у поля «Сумма должна быть больше нуля» (API: 422 `amount_invalid`) |
| D-08 | сдача, пробег меньше начального | ввести | ошибка «Пробег не может быть меньше N км» (N = пробег выезда); сдача невозможна (API: 422 `odometer_decrease`) |
| D-09 | дефект «критический» в осмотре выезда | «Выехать» | статус «Дефект на проверке»; тост/событие «Критический дефект: … Выезд заблокирован.»; у менеджера задача с приоритетом «Срочно» (API: 409 `blocking_defect_open` при повторном старте) |
| D-10 | водитель (AC-05) | весь путь смены | нигде нет суммы начисления: ни в карточке рейса, ни в уведомлениях, ни в ответе адаптера (`db.trips[*].earnings` отсутствует, `db.earnings` пуст) |
| D-11 | офлайн, расход сохранён | включить связь | очередь отправки доставляет расход один раз (повтор `opId` → «duplicate», второй записи нет) (AC-07) |

Страница `review` («Приёмка смен»):

| # | Given | When | Then |
|---|---|---|---|
| R-01 | смена `submitted` | «Вернуть» без комментария | «Опишите, что нужно исправить»; без разделов — «Отметьте хотя бы один раздел для доработки» |
| R-02 | смена уже принята (вторая вкладка/повтор) | «Принять» | тост «Смена уже обработана» (API: 409 `invalid_transition`) |
| R-03 | менеджер без права `fleet.earnings.read` | принять смену | уведомление «Начисление по рейсу …: N ₽» ему не приходит (`sensitive: 'earnings'`) |

Платформа (`operator`):

| # | Given | When | Then |
|---|---|---|---|
| O-01 | заявка `SR-12` | отклонить без причины | «Укажите причину отказа» |
| O-02 | заявка `t-lotos` на тариф с местами меньше занятого | владелец отправляет | «В тарифе «Старт» 10 мест, а занято 23» (API: 422 `tier_below_usage`) |
| O-03 | заявка `pending` уже есть | владелец отправляет вторую | «Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.» (API: 409 `request_pending`) |
| O-04 | оператор `me` | изменить свою роль / отключить себя | «Свою роль менять нельзя: попросите другого владельца» / «Себя отключить нельзя» |
| O-05 | единственный активный владелец платформы | понизить / отключить | «На платформе должен остаться хотя бы один активный владелец» / «Нельзя отключить последнего активного владельца» (канон ≥ 2 — см. §9) |
| O-06 | приглашение оператора | `role = owner` | «Владельцем платформы назначают уже работающего оператора» (API: 422) |
| O-07 | блокировка входа | без причины | «Укажите причину блокировки»; с причиной — запись в журнале «<email>: вход заблокирован — <причина>» |
| O-08 | запланирована версия сетки | опубликовать ещё одну | «Уже запланирована версия vN. Отмените её, чтобы подготовить другую.» |

Общие (фаза 2, контракт): каждый `Problem` содержит `type, title, status, code, requestId`; интерфейс показывает `requestId` мелким шрифтом с кнопкой «Скопировать»; неизвестный `code` → общий текст статуса; `offline` — тост `warn`, прочие — `alert`.

## 9. Открытые вопросы

| # | Вопрос | Источники в противоречии |
|---|---|---|
| DP-01 | `Problem.retryable` есть в примере `12`, но OpenAPI `Problem` имеет `additionalProperties: false` без этого поля. Добавить в схему или убрать из примера? | `12-errors-and-events.md:18`; OpenAPI 6904–6935 |
| DP-02 | Коды `seats_exhausted` (409), `request_pending` (409), `tier_below_usage` (422), `conflict` (19) отсутствуют в реестре `12`; коды для «участник уже есть», «приглашение уже принято», «версия уже запланирована», 422 оформления/SVG не названы | `17:153`; `19:93`; `18:78`; `api.js` |
| DP-03 | Права `branding.read` / `branding.manage` объявлены в `18`, но нет ни в `11-permissions.yaml`, ни в OpenAPI | `18-branding.md:83` |
| DP-04 | 14 ключей `spa.*`, `inventory.*`, `cash.*` есть в OpenAPI `x-permissions`, но не в каталоге → линтер `14:58` упадёт; каталог нужно дополнить до S3 или исключить операции | §4.5 |
| DP-05 | Четыре словаря областей (`scope_kind` SQL: `unit/warehouse/resource`; каталог: `unit/resource`; OpenAPI: `org_unit/resource_pool`; прототип: `region/firm`) — выбрать один | §4.6 |
| DP-06 | Шаблон «Менеджер логистики»: в прототипе начисления видны по умолчанию (`finance.read: true`), в каноне — `optional_restricted` | `mock-data.js:169`; `11:158` |
| DP-07 | Операторы платформы: канон «≥ 2 активных владельца», прототип проверяет «хотя бы один» | `17:177`; `control_0001_init.sql:117`; `api.js:257,265` |
| DP-08 | `support_grants` CHECK запрещает только `fleet.earnings.read`, но не `fleet.earnings.manage` и не «массовый экспорт» из `02:303` | `control_0001_init.sql:145` |
| DP-09 | Нет места для комментария и разделов возврата смены (`review.comment`, `steps`) и для `title` (должность), `model`, `depot`, `trip.title`, `distanceKm`, `pool.terms`, типа второго фактора оператора | §7.2 |
| DP-10 | Код ошибки для нарушения `trips_active_vehicle_uq` / `trips_active_driver_uq` не задан | `tenant_0002_fleet.sql:57–60` |
| DP-11 | Операторская аналитика «Использование» заявлена на «только control DB», но объём файлов — в tenant DB; `tenant_usage_daily` не сделана | `17:188,205` |
| DP-12 | Черновик схемы `repairs` не содержит `works`/`work_logs`; имя сущности `project` vs `object` (RS-08) | `19:135–150,108` |
| DP-13 | Бронь без источника («Перерыв») и ТО машины не ложатся в `sched.reservations.source_type/source_id not null` | `extra-data.js:17,21`; `tenant_0001_core.sql:243–244` |
| DP-14 | Версия PostgreSQL: миграции проверены на 16.4, план TDD задаёт testcontainers PostgreSQL 17 (D-04 «последние стабильные») | `10:9`; `tdd-protocol.md:25` |
| DP-15 | Способ детерминированной генерации UUID из прототипных ID для сида (PD-19) не описан | `tdd-protocol.md:56`; `decisions.md:13` |
| DP-16 | В прототипе нет `requestId` и кнопки «Скопировать», нет подписей для состояний `provisioning/grace/read_only/closing/closed` — реализация должна добавить их (отклонение от «точно как нарисовано», требует решения) | `12:24`; `models.js:111–116` |
| DP-17 | Для ролей ETag/If-Match строится из `current_version` (прототип шлёт `r.etag`) — не зафиксировано | `api.js:609`; `tenant_0001_core.sql:119` |
| DP-18 | Вопросы модели из `10`: `legal_entity_id` у рейса; история перемещения машины между фирмами; категории расходов пилота (D-12 отвечает: топливо, мойка, парковка, платная дорога, прочее); антифрод фото (EXIF, sha256) | `10:135–140`; `16:20` |

## 10. Факты для плана

1. Control DB: 16 таблиц + 2 view в трёх миграциях; tenant DB: 36 таблиц в 11 схемах в двух миграциях; все применены на PostgreSQL 16.4, конкурентные сценарии не прогонялись (`10:9–24`).
2. Нужно расширение `btree_gist` в обеих БД (`control_0002_billing.sql:7`; `tenant_0001_core.sql:6`) — проверить у провайдера managed PostgreSQL (D-05).
3. Роли БД: `migrator` (DDL), `api_runtime` (DML своей tenant DB), `worker_runtime`, `provisioner` (CREATE DATABASE); у API нет DDL (`14:81`). Инструмент миграций — goose + собственный контроллер по тенантам (D-06), версия схемы в `tenant_routing.schema_version`.
4. Миграции 0003+ (формы, задачи, БЗ, календарные блоки, SPA, склад, касса, ремонт, уведомления, приёмка смен) не написаны — объём §7.1; порядок зависит от PD-15 (фаза 3).
5. Каталог прав — 77 ключей, из них 68 назначаемых в tenant; к нему нужно добавить ≥ 16 ключей (`spa.*`, `inventory.*`, `cash.*`, `branding.*`) до линтера `x-permissions` (DP-03, DP-04).
6. `prototype_renames` покрывает 10 ключей; ещё 13 прототипных ключей без соответствия (§4.4) — учесть при портировании `models.js` в `packages/domain` (S0-06).
7. Реестр ошибок — 36 кодов + 2 клиентских состояния; его нужно внести в OpenAPI как `enum` и сгенерировать константы Go/TS (`docs/README.md:39`); плюс ≥ 4 кода из других документов (DP-02). Маппинг доменных ошибок Go → `Problem.code` в одном месте (`14:110`).
8. Каждый `Problem.code` должен быть покрыт хотя бы одним тестом (`tdd-protocol.md:63`) — таблица §5.2 задаёт минимум 36 тестов контракта.
9. Evaluator `permit()` + `scopeQuery()` — история S1-11 размера L; каждый SQL-запрос tenant-модуля принимает предикат `scopeQuery`, ревью отклоняет запросы без него (`14:111`); CODEOWNERS на `authz/**`, `migrations/**`, `finance*`, `permissions.yaml` (`14:68`).
10. Isolation и concurrency suites блокируют merge (`15:11–12`); фикстура — два тенанта с одинаковыми названиями; матрица «актор × объект × 200/403/404» растёт с каждым эндпоинтом.
11. Шесть конкурентных инвариантов обеспечены БД (бронь, активные рейсы, квота, функции, сетка, одна заявка), пять — сервисом под `FOR UPDATE` (последний владелец, места, операторы, старт рейса, hold-expiry) — §6.
12. Между control и tenant DB нет транзакции: приглашение, принятие, передача владения — саги с идемпотентностью (I-33); sensitive writes fail closed при недоступном control plane.
13. `policy_version` обязателен в ключе кеша прав и в курсоре пагинации; отзыв роли → realtime ≤ 5 с (S1-15).
14. Начисления — отдельная схема `finance`, отдельный репозиторий, позже отдельная DB-роль; не входят в Trip DTO, datasets, outbox payload, поиск, уведомления (AC-05); водитель не видит даже свои (`02:137`).
15. 404 для чужих объектов везде, включая Data Hub count/агрегаты; время ответа не должно выдавать существование (AC-01).
16. Idempotency-Key на всех изменяющих командах, If-Match на 12 таблицах с `revision`; роли — через `current_version` (DP-17).
17. Деньги в копейках `bigint`, на клиенте `amountMinor: number` + `Intl.NumberFormat('ru-RU')`; прототип хранит рубли float (`api.js:365`) — пересчёт в сиде.
18. Единицы прототипа (т, м, часы float) → SQL (кг, мм, `tstzrange`); состояния `fuel`, `photos.odo`, `critical`, `blocked`, `firm`, `staff`, `declined`, `restricted` переименовываются — таблица §7.2 задаёт конвертер сида (PD-19).
19. Прототип фильтрует ответ по правам в `view()` (`api.js:70–97`): удаляет `platform.audit/accounts/operators`, `trips[].earnings`, чужие рейсы и машины, чужие проекты/задачи/ответы, страницы БЗ `access='owner'`, кассу, брони машин — это спецификация field policy и `scopeQuery` для MSW-моков фазы 1.
20. Демо-флаги `online`, `conflictNext`, `failUploadNext` (`api.js:20`) и панель «Демо-режим» — единственный способ воспроизвести офлайн/конфликт/сбой в e2e фазы 1; в фазе 2 нужны эквиваленты (MSW-сценарии или тестовые хуки).
21. Хранилище прототипа — `usedGb >= quotaGb` без резерва; реальный цикл `reserve → PUT → complete → scan → ready` (S1-20, L) и `activity_reserve_bytes` для закрытия начатой смены.
22. Операторский контур — отдельный realm `ortus-operators` (D-03), в фазе 1 без Keycloak (PD-18); права `platform.*` в прототипе не ограничивают действия (`17:182`).
23. Оформление — control DB (нужно до входа): `GET /public/branding/{slug}` без авторизации, `accent_used` считает сервер (контраст ≥ 4.5:1, шаг 4% к чёрному), SVG санитизируется; тесты BR-T1…T3.
24. Прототипный ID рейса «Р-208» (кириллица) vs канонический `TR-2026-000123` из `core.counters` — e2e фазы 1 опирается на «Р-208», фазы 2 — на номер из сида (DP-15).
25. Открытые вопросы DP-01…DP-18 должны попасть в `docs/plan/decisions.md`; до решения реализуется поведение прототипа (`orchestration.md:86`), кроме случаев, где прототип нарушает инвариант безопасности (DP-06, DP-07 — канон строже).
