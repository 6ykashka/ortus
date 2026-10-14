# 10. Контракт API и архитектура — рабочая карта для реализующих агентов

Домен: OpenAPI-контракт 0.1, архитектурные границы, сессия/BFF, изоляция тенантов, файлы, outbox, наблюдаемость, топология. Все пути ниже — относительно `design/`. Ссылки вида `файл:строка–строка`. Текст, взятый из источников, приведён дословно (включая английские summary из YAML и русские подписи прототипа).

---

## 1. Источники

| Файл | Прочитано | Что взято |
|---|---|---|
| `docs/v0.1/02-architecture.md` | 1–403 (полностью) | Контуры, tenant resolver, DB-per-tenant, модель доступа, scheduling, Data Hub, файлы, подписки, Go-контракты, support/break-glass, NFR, ADR A-01…A-12, failure modes |
| `docs/v0.1/03-api-guide.md` | 1–170 (полностью) | Объём контракта, общие правила, вход/сессия, авторизация, идемпотентность, деньги/даты/пагинация, ошибки, последовательности водителя и SPA, «Что требуется допроектировать» |
| `docs/v0.1/05-technology-review.md` | 1–107 (полностью) | Рекомендуемый стек, монолит, БД, realms, файлы, маршрутизация, эксплуатация |
| `docs/v0.1/ortus-openapi-v0.1.yaml` | 1–11691 (полностью, 8 фрагментов) | 76 путей, 118 операций, 199 схем, 18 тегов, security schemes, параметры, заголовки, ответы, `x-*` расширения |
| `docs/v0.1/README.md` | 1–45 | Состав комплекта v0.1, границы готовности |
| `docs/README.md` | 1–55 | Комплект v0.2, «Что нужно сделать до первой строки кода», «Расхождения» |
| `docs/12-errors-and-events.md` | 1–100 | Реестр кодов `Problem.code`, доменные события outbox, соглашения API |
| `docs/14-engineering.md` | 1–127 | Стек, структура репозитория, поток контракта, CI, окружения, роли БД, перенос прототипа |
| `docs/11-permissions.yaml` | 1–191 | Каталог action keys, шаблоны ролей, `prototype_renames` |
| `docs/10-data-model.md` | 1–140 | Принципы схемы, жизненные циклы, инварианты, проверка на PostgreSQL 16.4 |
| `docs/15-quality-security.md` | 1–81 | Пирамида тестов, фикстуры изоляции, AC → тесты, STRIDE |
| `docs/13-backlog-s0-s2.md` | 1–140 | Истории S0–S2, DoR/DoD |
| `docs/16-raid-glossary.md` | 1–107 | Решения D-01…D-12, риски, глоссарий |
| `docs/17-users-and-billing.md` | 1–217 | PROPOSED-эндпоинты мест/тарифов/операторов, коды `seats_exhausted`, `request_pending`, `tier_below_usage` |
| `docs/18-branding.md` | 60–99 + grep | PROPOSED-эндпоинты оформления, права `branding.manage` / `branding.read` |
| `docs/19-construction.md` | grep строк 103–163 | PROPOSED-эндпоинты ремонта (`/accept`, `/return`, `/overview` и расширения) |
| `docs/v0.1/01-technical-spec.md` | grep AC-01…AC-15 (строки 272–286) | Критерии приёмки |
| `docs/repo-skeleton/docker-compose.yml` | 1–48 | Локальная топология |
| `ortus/api.js` | 1–627 (полностью) | `createMockAdapter` (115–568), `createHttpAdapter` (573–626) |
| `ortus/models.js` | 20–79 + grep | Ключи прав прототипа (`INDUSTRY.*.perms`, `CORE.*.perms`), `REASON` |
| `Ортус CRM.dc.html` | 2933–3022 | `navFor` / `navForBase` — идентификаторы и подписи экранов по персонам |
| `README.md` (прототип) | 1–189 | Структура прототипа, допущения, расхождения, «Следующая очередь» |

---

## 2. Сводка

- Контракт `ortus-openapi-v0.1.yaml` — OpenAPI 3.1.0, `info.version: 0.1.0-design`, `x-contract-status: design-proposal-not-implemented` (yaml:1–7, 11666). Сервер `https://api.example.invalid` — нерабочий placeholder (yaml:22–24).
- Объём: **76 шаблонов путей, 118 операций (57 GET, 43 POST, 12 PATCH, 4 PUT, 2 DELETE), 199 именованных схем, 18 тегов** (подтверждено подсчётом по YAML; совпадает с 03-api-guide.md:7 и docs/v0.1/README.md:14).
- Архитектура: модульный Go-монолит, один адаптивный web/PWA-клиент, Control PostgreSQL DB + отдельная PostgreSQL DB на каждого тенанта (02:7, ADR A-01/A-02 02:338–339).
- Процессы минимальной установки: web, Go API, Go worker, IdP (Keycloak), PostgreSQL, объектное хранилище (S3-совместимое); provisioner — отдельный процесс/полномочия (02:27–40, 05:81).
- Браузерный вход — Go BFF: OIDC Authorization Code + PKCE, cookie `__Host-ortus_session` (`HttpOnly`, `Secure`, `SameSite=Lax`), для cookie-мутаций обязательны `X-CSRF-Token` + проверка `Origin`; bearer и cookie одновременно отклоняются (yaml:11, 6438–6443; 03:40–42).
- **Auth-поверхность (login, callback, logout, CSRF bootstrap, принятие приглашения, восстановление) в контракте 0.1 ОТСУТСТВУЕТ** — объявлена «отдельной пока не полностью описанной» (03:40, 03:141; yaml:75–77; docs/README.md:39).
- Порядок авторизации зафиксирован расширением `x-authorization-order`: authenticate → tenant-membership-and-binding → tenant-state → module-installation → plan-entitlement → separation-of-duties → permission → resource-scope → relationship → field-policy (yaml:11667–11677).
- `tenantId` в URL — не право доступа; чужие и несуществующие ID дают одинаковый 404 (yaml:13, 6731; 03:34).
- Все изменяющие команды принимают `Idempotency-Key` (16–128 символов, `^[A-Za-z0-9._:-]+$`), scoped по tenant+actor+operation; повтор с другим payload → 409; in-flight → 409 + `Retry-After` (yaml:6628–6639; 03:60–62).
- Read-modify-write требует strong ETag в `If-Match` (`^"[^"\s]+"$`, `*` не принимается); отсутствие → 428, устаревший → 412 (yaml:6640–6650; 03:64).
- Деньги — `Money {amountMinor:int ≤ 9007199254740991, currency:^[A-Z]{3}$}`; количества — decimal strings (`^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`); время — RFC3339 UTC с `Z` + IANA `timeZone`; интервалы полуоткрытые `[startsAt, endsAt)` (yaml:6813–6872; 03:70–74).
- Пагинация только курсорная: `cursor` (≤2048), `limit` 1–200 (default 50); курсор привязан к tenant, principal, версии scope и запросу (yaml:6603–6620; 03:76).
- Ошибки — `application/problem+json`, схема `Problem` с обязательными `type, title, status, code, requestId`; `code` в 0.1 — свободная строка, реестр предложен в `12-errors-and-events.md` (yaml:6904–6935; docs/README.md:48).
- Водители не видят начисления ни по одному каналу; активный `workProfiles: driver` несовместим с `fleet.earnings.*` — `409 separation_of_duties_conflict` при назначении и fail-closed при чтении (yaml:13, 11678–11691; 02:137–139; ADR A-12).
- Начисления вынесены в отдельный путь `/fleet/trips/{tripId}/earnings` (тег `Earnings`, 2 операции), DTO `Trip` их не содержит (yaml:4538–4647, 10092).
- Файлы: резерв квоты → `UploadTicket` (PUT, TTL 15 мин, карантин) → `complete` (202, ещё не safe) → скан → `ready|rejected`; скачивание — короткий URL ≤ 60 с (yaml:2030–2032, 8518–8559, 8603–8605).
- Прототип `ortus/api.js` содержит 23 метода в `createHttpAdapter`, из них **13 помечены/являются PROPOSED** (нет в OpenAPI), и ещё ~14 методов mock-адаптера не имеют HTTP-аналога (api.js:573–626, 415–549).
- Ключи прав прототипа (`fleet.inspections.create`, `fleet.trips.manage`, `fleet.pool.request`, `fleet.export`, `fleet.settings`, `calendar.read`, `knowledge.write`, `data.read`, `tasks.manage`, `forms.responses.create`, `cash.operations.create`, `inventory.read`, `spa.completion.review`, `spa.export`, `spa.settings`, `repairs.worklogs.*`, `repairs.export`, `repairs.settings`) не совпадают с OpenAPI; канон — OpenAPI, таблица переименований — `11-permissions.yaml:180–190` (docs/README.md:47).
- `11-permissions.yaml` покрывает только core + logistics + repairs + platform; ключи `spa.*`, `inventory.*`, `cash.*`, `forms.responses.assign`, `cash.refund`, `cash.adjust`, `inventory.consumption.override`, используемые OpenAPI, в каталоге отсутствуют — CI-правило «каждый x-permissions обязан быть в каталоге» (11:3, 14:58) сейчас не выполнимо без расширения каталога.
- Realtime-канал (websocket/SSE) упоминается в архитектуре (02:30, 02:228, 02:320; события `access.policy.bumped.v1` 12:76), но **эндпоинта в OpenAPI нет**.

---

## 3. Архитектура

### 3.1 Контуры и границы компонентов (02:25–44, 05:77–83, 14:24–53)

| Компонент | Ответственность | Ограничение (дословно/сжато) | Источник |
|---|---|---|---|
| Web/PWA | Общая оболочка; рабочий стол водителя, мастера, прораба, менеджера; конструкторы | «Скрытие кнопок не заменяет серверную авторизацию» | 02:29 |
| Go API (BFF + API) | Tenant resolver, авторизация, бизнес-команды, запросы, подписки realtime | «Не выбирает БД по DSN или произвольному заголовку клиента» | 02:30 |
| Go worker | Outbox, импорты, экспорт, уведомления, миниатюры, пересчёты | «Работа всегда содержит tenant context и ограниченный actor/service principal» | 02:31 |
| Provisioner | Создание БД, миграции, назначение служебных ролей, резервное восстановление | «DDL-учётных данных нет у API» | 02:32; 05:81 |
| Control PostgreSQL DB | Реестр тенантов, routing, Account, Membership, OwnerBinding, подписки, лимиты, метаданные состояния | «Не содержит рейсов, клиентской базы салонов, смет и фотографий» | 02:33 |
| Tenant PostgreSQL DB | Core access, структура, профили, бизнес-модули, outbox, metadata, billing usage projection | «Отдельная БД и runtime identity на тенант; схемы по модулям» | 02:34 |
| Identity Provider (Keycloak) | OIDC, вход, MFA, восстановление аккаунта, SSO в будущем | «Не является хранилищем всех прикладных прав» | 02:35; D-03 16:11 |
| Объектное хранилище (S3-совместимое, MinIO локально) | Фото, документы, вложения, результаты экспортов | «Закрытые объекты, серверная проверка доступа перед выдачей» | 02:36; 14:15 |
| Observability (OpenTelemetry) | Метрики, трассировки, технические логи, алерты | «Секреты, фото, полные ответы форм и начисления в технические логи не попадают» | 02:37 |
| Redis — по необходимости | Краткоживущий кеш, rate limits, realtime coordination | «Не источник истины брони, остатка или прав» | 02:38; 05:32 |

Не вводить на старте: Kafka, Elasticsearch/OpenSearch, ClickHouse, отдельный policy server, service mesh, Kubernetes как обязательное условие (02:40–42; 05:85–89). Текстовый поиск и очереди — в PostgreSQL (02:42; 05:33).

Структура репозитория, которую должна соблюдать реализация (14:26–51):

```text
ortus/
├─ api/openapi/ortus.yaml  api/permissions.yaml  api/spectral.yaml
├─ backend/  cmd/{api,worker,provisioner,migrate}/
│            internal/platform/   # tenantctx, authz, scopeddb, storage, events, audit, idem, clock, httpx
│            internal/control/    # тенанты, аккаунты, подписки (control DB)
│            internal/modules/{access,org,people,modulesreg,files,sched,fleet}/  # manifest.yaml, http.go, service.go, queries/*.sql, migrations/
│            migrations/{control,tenant}/   test/{isolation,concurrency,contract}/
├─ frontend/ apps/web/   packages/{tokens,ui,api-client,domain}/
├─ deploy/{compose,helm}/
└─ docs/
```

Правила границ: «модуль импортирует только `platform/*` и публичные интерфейсы других модулей (`modules/x/api.go`), не их `internal`. Модуль не получает raw-пул БД — только `ScopedDB` своей схемы. Проверяется линтером `depguard`» (14:53). Платформенные capabilities: `Authz`, `ScopedDB`, `Storage`, `Directory`, `Scheduling`, `Events`, `Workflow`, `DataSets`, `Audit`, `Clock`, `Usage` (02:281).

### 3.2 Сессия и BFF

| Аспект | Правило | Источник |
|---|---|---|
| Поток входа | OIDC Authorization Code + PKCE через Go BFF; «browser JavaScript never stores refresh/access tokens» | yaml:11; 02:82; 03:40 |
| Cookie | `sessionCookie`: `type: apiKey, in: cookie, name: __Host-ortus_session` — «Secure HttpOnly SameSite=Lax host-only browser session issued after OIDC + PKCE» | yaml:6438–6443 |
| CSRF | `X-CSRF-Token` (16–256) обязателен для cookie-мутаций; `Origin` проверяется по allowlist; ошибка → 403; «Conditional requirement cannot be represented by OpenAPI required=true» | yaml:6651–6670; 6720–6722 |
| Маркер операций | `x-csrf-required-for-cookie: true` на каждой cookie-мутации (включая read-only POST `queryDataset`, `findCalendarAvailability`) | yaml:195, 1867, 2699 и далее |
| Bearer | `bearerAuth` JWT: «Validate signature, issuer, audience, exp, nbf and tenant binding. Platform tokens have distinct audience/capability from tenant tokens»; «Do not send this cookie with a bearer token» | yaml:6432–6437, 6443 |
| Глобальная security | `security: [bearerAuth, sessionCookie]` (OR) на документе; публичные формы — `security: []` | yaml:25–27; 3499, 3568, 3627, 3687, 5934 |
| CSRF bootstrap | «Browser CSRF token is established by the BFF bootstrap contract (listed as a deferred authentication surface in the notes)» | yaml:75–77 |
| Хранение прав | «Полные mutable business permissions в долгоживущий JWT не помещаются»; отзыв не зависит от TTL JWT | 02:82, 02:295 |
| Realms | Общий realm клиентов `ortus` + отдельный realm операторов `ortus-operators` (compose: `realm-ortus.json`, `realm-operators.json`) | 17:161; docker-compose.yml:34; D-03 |

### 3.3 Tenant resolver и TenantContext (02:46–60; 03:34)

1. Сервер проверяет сессию → Account → активный TenantMembership → состояние тенанта → создаёт immutable `TenantContext {tenant_id, membership_id, actor_id, policy_version, capability-based доступ к БД/хранилищу}` (02:48).
2. «Клиентский tenant_id выбирает желаемый контекст, но не предоставляет доступ. Отсутствие или неизвестный tenant_id не переводит запрос в „главную БД“» (02:48).
3. Routing в control DB: `tenant_id → shard/database/secret reference/schema version` (02:50). В tenant DB — `tenant identity sentinel` (`core.tenant_identity`, сверка с `tenant_routing.sentinel`), проверяется при открытии пула (02:52; 10:31).
4. Пул соединений: ленивый, idle TTL, общий бюджет на процесс/шард (02:50).
5. Миграции: migration controller canary → партии → остальные; версия схемы в `tenant_routing`; expand/contract (02:56; 13:S1-03).
6. Между control DB и tenant DB нет атомарной транзакции; при неизвестном состоянии control plane «sensitive writes fail closed» (02:295; 12:65 код `dependency_unavailable` 503).
7. Роли БД: `migrator` (DDL), `api_runtime` (DML своей tenant DB), `worker_runtime`, `provisioner` (CREATE DATABASE); «У API нет DDL» (14:81).
8. RLS в v1 не включается; главный барьер — DB-per-tenant (02:297; 10:131).

### 3.4 Модель доступа и `scopeQuery` (02:88–141, 02:283–291)

- Запись: `principal + role_version + scope + conditions + valid_from + valid_until`; роли additive, deny-конструктора нет (02:90, 02:116; ADR A-05).
- Scopes в API: `Scope.kind ∈ {tenant, org_unit, project, self, resource_pool}`, `resourceIds` (≤100, uniqueItems), `includeDescendants` — все три поля обязательны; «tenant/self require empty resourceIds; other kinds require IDs» (yaml:6936–6961).
- Формула `permit(c,a,r,f,t)` (02:96–110) и API авторизации: `authorize(action, resource)`, `scopeQuery(action, dataset)` — «проверенный предикат/план до пагинации и агрегации», `readFields/writeFields`, `explainAccess`, `previewPolicyChange` (02:285–289). ⚠ `explainAccess`/`previewPolicyChange` в OpenAPI 0.1 эндпоинтов не имеют.
- Правило SQL: «каждый запрос tenant-модуля принимает предикат `scopeQuery`; ревью отклоняет запросы без него» (14:111).
- `x-permissions` — AND (`x-permissions-mode: all` на всех 118 операциях); единственная операция с полевыми правами — `reviewFormResponse`: `x-field-permissions {assigneeMemberId: forms.responses.assign, reviewStatus: forms.responses.review, reviewComment: forms.responses.review}` (yaml:3398–3402, 3455–3458).
- Делегирование: назначающий должен иметь `roles.assign` и право делегировать весь набор (02:131); ошибка `delegation_exceeds_grant` 409 (12:51).
- Последний владелец: блокировка строки тенанта, минимум один активный владелец (02:86; код `last_owner_required` 12:52; `MemberPatch` «Cannot remove/suspend the last active business owner» yaml:7572).
- Ревокация: `policy_version` ↑, инвалидация кеша и realtime ≤ 5 с, незавершённые запросы ≤ 10 с (02:295, 02:320; события `access.assignment.revoked.v1`, `access.policy.bumped.v1` 12:75–76).

### 3.5 Outbox, идемпотентность, транзакции

- Transactional outbox, at-least-once, идемпотентные consumers через `outbox.inbox`; «Если разные модули сохраняют независимые транзакции, процесс имеет промежуточный статус и компенсацию» (02:206; ADR A-11).
- Worker: собственный на `FOR UPDATE SKIP LOCKED`; lease, retries, dead-letter, ручной повтор (14:13; 13:S1-24).
- Имена событий `<модуль>.<сущность>.<событие>.v<версия>`; payload без restricted-полей (12:71). Перечень событий — 12:73–85 (`fleet.reservation.held.v1`, `fleet.trip.started.v1`, `files.object.ready.v1`, `tenant.state_changed.v1` и др.).
- Idempotency-Key: «Retain record at least 7 days; financial deduplication also retains a durable tenant+actor+operation+key digest receipt» (yaml:6632–6634). «Idempotent replay is checked before current revision precondition» (yaml:6645). Ответ при повторе содержит `Idempotency-Replayed: true` (yaml:6687–6690).
- Для публичных форм namespace идемпотентности — tenant + publicToken digest + nonce + operation (yaml:9572–9573; 03:60).
- Атомарное ядро scheduling (Reservation, Approval, TemporaryAssignment) ко-лоцировано; бронь защищена `EXCLUDE USING gist` по `tstzrange` (02:176–182; 10:101). Hold имеет `holdExpiresAt`, проверяется сервером (02:182; yaml:9834–9835).

### 3.6 Файлы (02:235–241; yaml Files/PublicForms)

Поток: проверка доступа к действию/объекту → quota reservation → upload session → загрузка в quarantine → проверка типа/размера/целостности → malware/content validation → finalize → привязка к объекту и usage ledger (02:237).

| Шаг | Операция | Детали |
|---|---|---|
| 1 | `initiateUpload` `POST /tenants/{tenantId}/files/uploads` | `UploadCreate {fileName, contentType, sizeBytes, sha256, purpose ∈ {inspection, expense_receipt, knowledge_attachment, form_attachment, repair_evidence}, owner: ObjectRef}` → `UploadTicket {uploadId, fileId, method: PUT, uploadUrl, requiredContentType, requiredSha256, expiresAt, maxBytes}`; «15 minute TTL, private quarantine namespace. URL is a secret» (yaml:8484–8559) |
| 2 | PUT на `uploadUrl` | Вне контракта (presigned); «PUT upload URL привязан к уникальному ключу; нельзя выдать перезапись уже принятого файла» (02:237) |
| 3 | `completeUpload` `POST …/uploads/{uploadId}/complete` | `UploadComplete {sha256}` → **202** `File` «Accepted for asynchronous scanning; file is not yet safe» (yaml:1969–1971) |
| 4 | `getFile` `GET /files/{fileId}` | `File.status ∈ {pending_upload, quarantined, ready, rejected}`; доменные команды принимают только `ready` (yaml:8569–8605) |
| 5 | `getFileDownload` `GET /files/{fileId}/download` | `DownloadTicket {fileId, downloadUrl, expiresAt}`; «issued URLs last at most 60 seconds. Quarantined or rejected file returns 409 file_not_ready» (yaml:2030–2032) |

Допустимые переходы владельца файла (yaml:8518–8523): фото выезда → reservation, затем inspection; фото сдачи → trip; чеки → trip; фото ремонта → project до появления work log. Квота: `used + reserved + new_bytes <= limit` атомарно, TTL резерва (02:271); `StorageUsage {quotaBytes, committedBytes, reservedBytes, buckets[{kind ∈ attachments|database|versions|trash|reserved_uploads}], writeStatus ∈ allowed|blocked, pendingQuotaBytes, pendingEffectiveAt}` (yaml:7384–7431).

### 3.7 Realtime и уведомления

- Go API владеет «подписками realtime» (02:30); на enqueue и доставке проверяется audience; при отзыве закрываются подписки (02:228).
- Уведомления «входящие» с проверкой адресата — история S1-26 (13:101). Прототип показывает «уведомления (только адресованные участнику)» (README.md:48) и ленту `events` (api.js:27, 80).
- ⚠ не найдено в источниках: эндпоинт realtime (WS/SSE) и эндпоинт списка уведомлений в OpenAPI 0.1. Транспорт нужно допроектировать.

### 3.8 Наблюдаемость

- Обязательные сигналы: correlation/request id, tenant technical id, latency/error metrics, outbox lag, failed jobs, quota reservations, booking conflicts, authz deny classes, DB pool pressure, upload finalize failures (02:332).
- `X-Request-Id` — заголовок каждого ответа (yaml:6678–6681; 12:95); показывается в UI «мелким шрифтом с кнопкой «Скопировать»» (12:24).
- Логи `log/slog` JSON с `request_id`, `tenant_id` (технический), `actor_id`; «запрещены токены, тела форм, фото, суммы начислений» (14:21, 14:114). Метрики `ortus_<модуль>_<что>_<единица>`; `tenant_id` не label по умолчанию (14:115; 02:332).
- OpenTelemetry Go для traces/metrics (02:332 S8; 05:36; 14:21). Бэкенд хранения — решение D-07 (16:15).

### 3.9 Топология развёртывания

| Окружение | Назначение | Деплой | Источник |
|---|---|---|---|
| local | `docker compose`: `postgres:17`, `minio`, `keycloak` (`start-dev --import-realm`), `mailpit`, `otel-collector`; api/worker/web через `make dev` | `make up` / `make migrate` / `make seed` / `make dev` | docker-compose.yml:4–48; 14:96–106 |
| dev | Интеграция, синтетические данные | автоматически из `main` | 14:74–79 |
| stage | Приёмка, нагрузка, restore drill | тег `vX.Y.Z-rc` | 14:78 |
| prod-pilot | Пилот, реальные данные | тег `vX.Y.Z`, ручное подтверждение | 14:79 |

CI-конвейер: lint → contract (openapi validate, permissions check, codegen drift) → unit → integration (testcontainers: PostgreSQL, MinIO) → isolation + concurrency suites (блокирующие) → build (images, SBOM, подпись) → e2e (Playwright на эфемерном стенде compose) → deploy (14:85–94). ⚠ Расхождение: `10-data-model.md:7` требует PostgreSQL ≥ 13 (проверено на 16.4), compose использует `postgres:17`; версия закрепляется решением D-04 (16:12).

---

## 4. Общие правила контракта (сводка расширений и компонентов)

| Элемент | Значение | Источник |
|---|---|---|
| Базовые пути | `/api/v1/platform/...`, `/api/v1/tenants/{tenantId}/...`, `/api/v1/me/context`, `/api/v1/public/forms/{publicToken}/...` | 03:32 |
| Path-параметры | Все `*Id` — `Id` (uuid) «Opaque UUID; same-tenant and visibility checks are mandatory»; `moduleKey` `^[a-z][a-z0-9_-]{1,49}$`; `datasetId` `^[a-z][a-z0-9_.-]{1,99}$`; `publicToken` 32–256 символов | yaml:6445–6602 |
| Query | `cursor` ≤2048; `limit` 1–200 default 50; `orgUnitId` «Optional narrower scope, never an expansion beyond actor grants» | yaml:6603–6627 |
| Заголовки запроса | `Idempotency-Key` (required на 58 мутациях), `If-Match` (required на 26), `X-CSRF-Token`, `Origin` | yaml:6628–6670 |
| Заголовки ответа | `X-Request-Id` (всегда), `ETag` (на сущностях с revision), `Idempotency-Replayed`, `Retry-After` (409/429), `Cache-Control: private, no-store` (const на всех 2xx) | yaml:6671–6690; 85–89 |
| Ответы-ошибки | `BadRequest 400`, `Unauthenticated 401`, `PlanRequired 402` («never for ordinary RBAC denial… stable code plan_required»), `Forbidden 403`, `NotFound 404`, `Conflict 409` (+Retry-After), `Gone 410`, `PreconditionFailed 412`, `TooLarge 413`, `Validation 422`, `PreconditionRequired 428`, `RateLimited 429` (+Retry-After) | yaml:6691–6806 |
| `Problem` | required: `type, title, status, code, requestId`; optional `detail`, `violations[{field, code, message}]`; «No cross-tenant IDs, SQL, token values or storage keys in errors» | yaml:6890–6935 |
| Коды в YAML | `plan_required`, `reservation_overlap`, `resources_unavailable`, `idempotency_in_progress`, `quota_exceeded`, `downgrade_below_usage`, `file_not_ready`, `separation_of_duties_conflict`, `form_version_changed`, `driver_unavailable` | yaml:6712, 6933–6935, 2031, 13, 9570, 10357 |
| Реестр кодов v0.2 | 400 `malformed_request`, `unknown_field`; 401 `session_expired`; 402 `feature_requires_plan`; 403 `forbidden_action`, `module_not_installed`, `module_read_only`, `tenant_read_only`, `tenant_suspended`, `function_blocked`, `csrf_failed`/`origin_not_allowed`; 404 `not_found`; 409 `reservation_overlap`, `resources_unavailable`, `reservation_expired`, `vehicle_incompatible`, `inspection_incomplete`, `blocking_defect_open`, `photo_not_ready`, `invalid_transition`, `separation_of_duties_conflict`, `delegation_exceeds_grant`, `last_owner_required`, `quota_exceeded`, `downgrade_below_usage`, `idempotency_key_reused`, `idempotency_in_progress`; 410 `public_token_expired`/`nonce_used`; 412 `revision_mismatch`; 413 `payload_too_large`; 422 `validation_failed`, `odometer_decrease`, `amount_invalid`; 428 `revision_required`; 429 `rate_limited`; 503 `dependency_unavailable` | 12:28–65 |
| Дополнительно (PROPOSED) | 409 `seats_exhausted`, 409 `request_pending`, 422 `tier_below_usage` | 17:153 |
| JSON | camelCase; enum — snake_case; неизвестные поля тела отклоняются (`additionalProperties: false` на всех объектах) | 12:91; yaml:15 |

Легенда наборов кодов ошибок для каталога (§5): **R** = 400 401 403 404 422 429; **C** = R + 402 409 428; **U** = C + 412; **P** = R + 409 428 (платформа, без 402); **PU** = P + 412; **Pub** = 400 403 404 410 422 429 (публичные, без 401).

---

## 5. Каталог операций (все 118, по тегам)

Колонки: метод и путь (после `/api/v1`), `operationId`, summary (дословно), `x-permissions`, `x-scope`, тело → основной ответ, Idem/If-Match, ошибки, строки YAML. `x-permissions-mode: all` везде.

### 5.1 Context (1) — yaml:66–106

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/me/context` | `getMyContext` | Get identity and visible business contexts | — (пусто) | `identity` | — → `MeContext` 200 | — | R | 68–106 |

### 5.2 Platform (7) — yaml:107–455

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/platform/tenants` | `listPlatformTenants` | List tenant control-plane records | `platform.tenants.read` | `platform` | cursor,limit → `TenantPage` 200 | — | R | 109–149 |
| POST `/platform/tenants` | `createPlatformTenant` | Create a tenant and begin owner provisioning | `platform.tenants.create` | `platform` | `TenantCreate` → `Tenant` 201 (+ETag) | Idem | P | 150–206 |
| GET `/platform/tenants/{tenantId}` | `getPlatformTenant` | Read tenant control-plane status | `platform.tenants.read` | `platform` | — → `Tenant` 200 (+ETag) | — | R | 210–249 |
| PATCH `/platform/tenants/{tenantId}` | `updatePlatformTenant` | Rename, suspend or resume a tenant | `platform.tenants.manage` | `platform` | `TenantPatch` → `Tenant` 200 | Idem + If-Match | PU | 250–309 |
| GET `/platform/users` | `listPlatformUsers` | List identity support metadata | `platform.users.read` | `platform` | cursor,limit → `PlatformUserPage` 200 | — | R | 312–352 |
| GET `/platform/tenants/{tenantId}/subscription` | `getPlatformSubscription` | Read subscription and derived entitlements | `platform.billing.read` | `platform` | — → `Subscription` 200 (+ETag) | — | R | 356–395 |
| PUT `/platform/tenants/{tenantId}/subscription` | `updatePlatformSubscription` | Set subscription and audited manual entitlements | `platform.billing.manage` | `platform` | `PlatformSubscriptionUpdate` → `Subscription` 200 | Idem + If-Match | PU | 396–455 |

### 5.3 Billing (4) — yaml:456–664

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/subscription` | `getTenantSubscription` | Read own plan, trial and entitlements | `billing.read` | `tenant-owner-or-billing-manager` | — → `Subscription` 200 (+ETag) | — | R | 459–498 |
| PATCH `/tenants/{tenantId}/subscription` | `requestSubscriptionChange` | Request eligible trial, plan change or cancellation | `billing.manage` | `tenant-owner` | `SubscriptionChange` → `Subscription` 200 | Idem + If-Match | U | 499–560 |
| GET `/tenants/{tenantId}/storage` | `getStorageUsage` | Read billable storage and reserved upload bytes | `billing.read` | `tenant-owner-or-billing-manager` | — → `StorageUsage` 200 | — | R | 564–601 |
| POST `/tenants/{tenantId}/storage/changes` | `requestStorageChange` | Quote or commit a storage quota change | `billing.manage` | `tenant-owner` | `StorageChangeRequest` → `StorageChange` 201 | Idem | C | 605–664 |

### 5.4 Access (16) — yaml:665–1514

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/members` | `listMembers` | List visible tenant memberships | `members.read` | `tenant-or-org-unit` | cursor,limit,orgUnitId → `MemberPage` 200 | — | R | 668–709 |
| POST `/tenants/{tenantId}/invitations` | `inviteMember` | Invite a verified identity with constrained roles | `members.invite` | `tenant-or-org-unit` | `InvitationCreate` → `Invitation` 201 | Idem | C | 713–769 |
| PATCH `/tenants/{tenantId}/members/{memberId}` | `updateMember` | Suspend or move a membership within delegated scope | `members.manage` | `tenant-or-org-unit` | `MemberPatch` → `Member` 200 | Idem + If-Match | U | 774–835 |
| GET `/tenants/{tenantId}/members/{memberId}` | `getMember` | Read visible membership and revision | `members.read` | `tenant-or-org-unit` | — → `Member` 200 (+ETag) | — | R | 836–875 |
| GET `/tenants/{tenantId}/roles` | `listRoles` | List role definitions | `roles.read` | `tenant` | cursor,limit → `RolePage` 200 | — | R | 879–919 |
| POST `/tenants/{tenantId}/roles` | `createRole` | Create a role, including an empty template | `roles.manage` | `tenant` | `RoleCreate` → `Role` 201 (+ETag) | Idem | C | 920–986 |
| GET `/tenants/{tenantId}/roles/{roleId}` | `getRole` | Read a role and revision | `roles.read` | `tenant` | — → `Role` 200 (+ETag) | — | R | 991–1030 |
| PATCH `/tenants/{tenantId}/roles/{roleId}` | `updateRole` | Update permission keys in a role | `roles.manage` | `tenant` | `RolePatch` → `Role` 200 | Idem + If-Match | U | 1031–1092 |
| DELETE `/tenants/{tenantId}/roles/{roleId}` | `deleteRole` | Delete an unused custom role («409 if assigned or built-in») | `roles.manage` | `tenant` | — → 204 | Idem + If-Match | U | 1093–1142 |
| GET `/tenants/{tenantId}/assignments` | `listAssignments` | List visible role assignments and dormant grants | `roles.read` | `tenant-or-org-unit` | cursor,limit → `AssignmentPage` 200 | — | R | 1146–1186 |
| POST `/tenants/{tenantId}/assignments` | `createAssignment` | Assign a role to a member or group in a scope | `roles.assign` | `tenant-or-org-unit` | `AssignmentCreate` → `Assignment` 201 | Idem | C | 1187–1253 |
| DELETE `/tenants/{tenantId}/assignments/{assignmentId}` | `revokeAssignment` | Revoke a scoped role assignment («Revokes capability cache/version atomically and publishes an outbox event») | `roles.assign` | `tenant-or-org-unit` | — → 204 | Idem | C | 1258–1305 |
| GET `/tenants/{tenantId}/org-units` | `listOrgUnits` | List visible regions, companies, branches and teams | `org_units.read` | `tenant-or-org-unit` | cursor,limit → `OrgUnitPage` 200 | — | R | 1309–1349 |
| POST `/tenants/{tenantId}/org-units` | `createOrgUnit` | Create an organization unit | `org_units.manage` | `tenant-or-org-unit` | `OrgUnitCreate` → `OrgUnit` 201 (+ETag) | Idem | C | 1350–1408 |
| PATCH `/tenants/{tenantId}/org-units/{orgUnitId}` | `updateOrgUnit` | Rename, move or archive a unit | `org_units.manage` | `tenant-or-org-unit` | `OrgUnitPatch` → `OrgUnit` 200 | Idem + If-Match | U | 1413–1474 |
| GET `/tenants/{tenantId}/org-units/{orgUnitId}` | `getOrgUnit` | Read a visible unit and revision | `org_units.read` | `tenant-or-org-unit` | — → `OrgUnit` 200 (+ETag) | — | R | 1475–1514 |

### 5.5 Modules (5) — yaml:1515–1780

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/modules` | `listModuleCatalog` | Read trusted module manifests and permission catalog | `modules.read` | `tenant` | — → `ModuleCatalog` 200 | — | R + 402 | 1518–1557 |
| PUT `/tenants/{tenantId}/modules/{moduleKey}` | `setModuleInstallation` | Install, enable or disable a module («Idempotent desired-state API… Disabling with active operations enters draining and exposes finish_only access») | `modules.manage` | `tenant-owner` | `ModuleInstallationUpdate` → `ModuleManifest` 200 | Idem + If-Match | U | 1562–1628 |
| GET `/tenants/{tenantId}/modules/{moduleKey}` | `getModuleInstallation` | Read installation state and revision | `modules.read` | `tenant` | — → `ModuleManifest` 200 (+ETag) | — | R + 402 | 1629–1670 |
| GET `/tenants/{tenantId}/modules/{moduleKey}/settings` | `getModuleSettings` | Read typed settings of an installed module | `modules.settings.read` | `tenant` | — → `ModuleSettings` 200 (+ETag) | — | R + 402 | 1675–1716 |
| PUT `/tenants/{tenantId}/modules/{moduleKey}/settings` | `updateModuleSettings` | Replace typed module settings at the current revision («PUT replaces one complete typed settings document; it is not JSON Merge Patch») | `modules.settings.manage` | `tenant` | `ModuleSettings` → `ModuleSettings` 200 | Idem + If-Match | U | 1717–1780 |

### 5.6 Data (2) — yaml:1781–1892

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/datasets` | `listDatasets` | Read authorized module datasets and visible fields | `data.catalog.read` | `effective-module-and-field-scopes` | — → `DatasetCatalog` 200 | — | R | 1784–1821 |
| POST `/tenants/{tenantId}/datasets/{datasetId}/query` | `queryDataset` | Query a dataset through a constrained typed query («Read-only POST. Requires data.query AND the dataset own permission (e.g. fleet.trips.read)») | `data.query` | `effective-module-and-field-scopes` | `DatasetQuery` → `DatasetQueryResult` 200 | — (только CSRF/Origin) | R + 409 | 1826–1892 |

### 5.7 Files (4) — yaml:1893–2063, 5839–5880

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| POST `/tenants/{tenantId}/files/uploads` | `initiateUpload` | Reserve quota and issue a private upload capability | `files.upload` | `owning-object-scope` | `UploadCreate` → `UploadTicket` 201 | Idem | C + 413 | 1896–1954 |
| POST `/tenants/{tenantId}/files/uploads/{uploadId}/complete` | `completeUpload` | Verify an uploaded object and queue malware scanning | `files.upload` | `owning-object-scope` | `UploadComplete` → `File` **202** | Idem | C + 413 | 1959–2017 |
| GET `/tenants/{tenantId}/files/{fileId}/download` | `getFileDownload` | Issue a short-lived URL for a ready authorized file | `files.read` | `owning-object-and-field-scope` | — → `DownloadTicket` 200 | — | R + 409 | 2022–2063 |
| GET `/tenants/{tenantId}/files/{fileId}` | `getFile` | Read authorized file metadata and scan state | `files.read` | `owning-object-and-field-scope` | — → `File` 200 | — | R | 5843–5880 |

### 5.8 Tasks (7) — yaml:2064–2444

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/projects` | `listTaskProjects` | List visible task projects | `tasks.projects.read` | `tenant-org-unit-project` | cursor,limit → `ProjectPage` 200 | — | R | 2067–2107 |
| POST `/tenants/{tenantId}/projects` | `createTaskProject` | Create a task project from a workflow template | `tasks.projects.manage` | `tenant-or-org-unit` | `ProjectCreate` → `Project` 201 (+ETag) | Idem | C | 2108–2166 |
| GET `/tenants/{tenantId}/tasks` | `listTasks` | List visible tasks with field filtering | `tasks.read` | `tenant-org-unit-project-self` | cursor,limit → `TaskPage` 200 | — | R | 2170–2210 |
| POST `/tenants/{tenantId}/tasks` | `createTask` | Create a task in a visible project | `tasks.create` | `tenant-org-unit-project` | `TaskCreate` → `Task` 201 (+ETag) | Idem | C | 2211–2269 |
| GET `/tenants/{tenantId}/tasks/{taskId}` | `getTask` | Read a task | `tasks.read` | `tenant-org-unit-project-self` | — → `Task` 200 (+ETag) | — | R | 2274–2313 |
| PATCH `/tenants/{tenantId}/tasks/{taskId}` | `updateTask` | Edit task attributes at a known revision | `tasks.update` | `tenant-org-unit-project-self` | `TaskPatch` → `Task` 200 | Idem + If-Match | U | 2314–2375 |
| POST `/tenants/{tenantId}/tasks/{taskId}/transitions` | `transitionTask` | Execute an allowed workflow transition | `tasks.transition` | `tenant-org-unit-project-self` | `TaskTransition` → `Task` 200 | Idem + If-Match | U | 2380–2444 |

### 5.9 Knowledge (4) — yaml:2445–2655

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/knowledge/pages` | `listKnowledgePages` | List visible pages | `knowledge.read` | `tenant-org-unit-project` | cursor,limit → `KnowledgePageList` 200 | — | R | 2448–2488 |
| POST `/tenants/{tenantId}/knowledge/pages` | `createKnowledgePage` | Create a scoped knowledge page | `knowledge.create` | `tenant-org-unit-project` | `KnowledgePageCreate` → `KnowledgePage` 201 (+ETag) | Idem | C | 2489–2547 |
| GET `/tenants/{tenantId}/knowledge/pages/{pageId}` | `getKnowledgePage` | Read latest visible page revision | `knowledge.read` | `tenant-org-unit-project` | — → `KnowledgePage` 200 (+ETag) | — | R | 2552–2591 |
| PATCH `/tenants/{tenantId}/knowledge/pages/{pageId}` | `updateKnowledgePage` | Save a page revision or publish it («Publishing additionally requires knowledge.publish») | `knowledge.update` | `tenant-org-unit-project` | `KnowledgePagePatch` → `KnowledgePage` 200 | Idem + If-Match | U | 2592–2655 |

### 5.10 Calendar (5) — yaml:2656–2918

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| POST `/tenants/{tenantId}/calendar/availability` | `findCalendarAvailability` | Find advisory slots satisfying all resources («Advisory only») | `calendar.availability.read` | `tenant-org-unit-self` | `AvailabilityQuery` → `AvailabilityResult` 200 | — (CSRF/Origin) | R + 409 | 2659–2709 |
| GET `/tenants/{tenantId}/calendar/bookings` | `listCalendarBookings` | List scoped calendar bookings | `calendar.bookings.read` | `tenant-org-unit-self` | cursor,limit → `BookingPage` 200 | — | R | 2713–2753 |
| POST `/tenants/{tenantId}/calendar/bookings` | `createCalendarBooking` | Atomically reserve multiple resources | `calendar.bookings.create` | `tenant-org-unit-self` | `BookingCreate` → `Booking` 201 (+ETag) | Idem | C | 2754–2812 |
| GET `/tenants/{tenantId}/calendar/bookings/{bookingId}` | `getCalendarBooking` | Read a booking and revision | `calendar.bookings.read` | `tenant-org-unit-self` | — → `Booking` 200 (+ETag) | — | R | 2817–2856 |
| PATCH `/tenants/{tenantId}/calendar/bookings/{bookingId}` | `updateCalendarBooking` | Reschedule or cancel a confirmed booking | `calendar.bookings.manage` | `tenant-org-unit-self` | `BookingPatch` → `Booking` 200 | Idem + If-Match | U | 2857–2918 |

### 5.11 Forms (10) — yaml:2919–3459

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/forms` | `listForms` | List scoped form definitions | `forms.read` | `tenant-org-unit-project` | cursor,limit → `FormPage` 200 | — | R | 2922–2962 |
| POST `/tenants/{tenantId}/forms` | `createForm` | Create a form and immutable initial version | `forms.create` | `tenant-org-unit-project` | `FormCreate` → `Form` 201 (+ETag) | Idem | C | 2963–3021 |
| GET `/tenants/{tenantId}/forms/{formId}` | `getForm` | Read form metadata and version pointers | `forms.read` | `tenant-org-unit-project` | — → `Form` 200 (+ETag) | — | R | 3026–3065 |
| PATCH `/tenants/{tenantId}/forms/{formId}` | `updateForm` | Rename or close submissions | `forms.manage` | `tenant-org-unit-project` | `FormPatch` → `Form` 200 | Idem + If-Match | U | 3066–3127 |
| GET `/tenants/{tenantId}/forms/{formId}/versions` | `listFormVersions` | List immutable schema versions | `forms.read` | `tenant-org-unit-project` | cursor,limit → `FormVersionPage` 200 | — | R | 3132–3172 |
| POST `/tenants/{tenantId}/forms/{formId}/versions` | `createFormVersion` | Create a new immutable version from a base version («If-Match refers to the parent form metadata revision») | `forms.manage` | `tenant-org-unit-project` | `FormVersionCreate` → `FormVersion` 201 | Idem + If-Match | U | 3173–3234 |
| POST `/tenants/{tenantId}/forms/{formId}/versions/{versionId}/publish` | `publishFormVersion` | Publish exactly one validated version («Public publishing additionally requires forms.publish_public») | `forms.publish` | `tenant-org-unit-project` | `FormPublish` → `FormPublication` 200 (+ETag) | Idem + If-Match | U | 3240–3302 |
| GET `/tenants/{tenantId}/forms/{formId}/responses` | `listFormResponses` | List visible responses, preserving submitted version | `forms.responses.read` | `tenant-org-unit-project-assigned` | cursor,limit → `FormResponsePage` 200 | — | R | 3307–3347 |
| GET `/tenants/{tenantId}/forms/{formId}/responses/{responseId}` | `getFormResponse` | Read a response permitted for review | `forms.responses.read` | `tenant-org-unit-project-assigned` | — → `FormResponse` 200 (+ETag) | — | R | 3353–3392 |
| PATCH `/tenants/{tenantId}/forms/{formId}/responses/{responseId}` | `reviewFormResponse` | Assign and review an immutable submission | `[]` + `x-field-permissions` (см. §3.4) | `tenant-org-unit-project-assigned` | `ResponseReviewPatch` → `FormResponse` 200 | Idem + If-Match | U | 3393–3459 |

### 5.12 PublicForms (5, `security: []`) — yaml:3460–3689, 5881–5936

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/public/forms/{publicToken}` | `getPublicForm` | Read a sanitized public form and submission nonce | `[]` | `public-form-capability` | — → `PublicForm` 200 | — | Pub | 3463–3501 |
| POST `/public/forms/{publicToken}/responses` | `submitPublicForm` | Submit one version-bound response | `[]` | `public-form-capability-and-nonce` | `PublicResponseCreate` → `PublicResponseReceipt` 201 | Idem + Origin (без CSRF) | Pub + 409 428 | 3505–3570 |
| POST `/public/forms/{publicToken}/uploads` | `initiatePublicUpload` | Issue a quarantined capability for one allowed form file | `[]` | `form-version-field-and-nonce` | `PublicUploadCreate` → `UploadTicket` 201 | Idem + Origin | Pub + 409 413 428 | 3574–3629 |
| POST `/public/forms/{publicToken}/uploads/{uploadId}/complete` | `completePublicUpload` | Complete only the nonce-owned upload and queue scanning | `[]` | `form-version-field-and-nonce` | `PublicUploadComplete` → `File` **202** | Idem + Origin | Pub + 409 413 428 | 3634–3689 |
| POST `/public/forms/{publicToken}/uploads/{uploadId}/status` | `getPublicUploadStatus` | Read only the nonce-owned upload scan state («Read-only POST keeps nonce out of URL logs») | `[]` | `form-version-field-and-nonce` | `PublicUploadStatusQuery` → `File` 200 | — (Origin) | Pub + 409 413 | 5885–5936 |

`x-public-capability: publicToken; submission nonce additionally required for submit/upload` на всех пяти (yaml:3500 и далее).

### 5.13 Fleet (27) — yaml:3690–4537, 4648–4919, 5937–6315

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/fleet/vehicles` | `listVehicles` | List scoped vehicles, optionally free for an interval («Supply both availability bounds or neither») | `fleet.vehicles.read` | `tenant-org-unit-resource-pool` | cursor,limit,orgUnitId,`availableFrom`,`availableUntil`,`bodyType ∈ van|box|flatbed|refrigerated`,`minPayloadKg` → `VehiclePage` 200 | — | R | 3693–3765 |
| POST `/tenants/{tenantId}/fleet/vehicles` | `createVehicle` | Register a vehicle and capacity/equipment | `fleet.vehicles.manage` | `tenant-or-org-unit` | `VehicleCreate` → `Vehicle` 201 (+ETag) | Idem | C | 3766–3824 |
| GET `/tenants/{tenantId}/fleet/reservations` | `listReservations` | List reservations visible in own scope | `fleet.reservations.read` | `tenant-org-unit-self` | cursor,limit → `ReservationPage` 200 | — | R | 3828–3868 |
| POST `/tenants/{tenantId}/fleet/reservations` | `reserveVehicle` | Atomically hold a compatible vehicle and driver | `fleet.reservations.create` | `tenant-org-unit-self` | `ReservationCreate` → `Reservation` 201 (+ETag) | Idem | C | 3869–3934 |
| GET `/tenants/{tenantId}/fleet/reservations/{reservationId}` | `getReservation` | Read a reservation, expiry and revision | `fleet.reservations.read` | `tenant-org-unit-self` | — → `Reservation` 200 (+ETag) | — | R | 3939–3978 |
| PATCH `/tenants/{tenantId}/fleet/reservations/{reservationId}` | `releaseReservation` | Release a still-held reservation | `fleet.reservations.manage` | `tenant-org-unit-self` | `ReservationPatch` → `Reservation` 200 | Idem + If-Match | U | 3979–4040 |
| GET `/tenants/{tenantId}/fleet/inspections` | `listInspections` | List visible departure and return inspections | `fleet.inspections.read` | `tenant-org-unit-self` | cursor,limit → `InspectionPage` 200 | — | R | 4044–4084 |
| POST `/tenants/{tenantId}/fleet/inspections` | `submitInspection` | Submit a versioned checklist and ready photo evidence | `fleet.inspections.submit` | `tenant-org-unit-self` | `InspectionCreate` → `Inspection` 201 (+ETag) | Idem | C | 4085–4143 |
| GET `/tenants/{tenantId}/fleet/trips` | `listTrips` | List operational trips without earnings fields | `fleet.trips.read` | `tenant-org-unit-self` | cursor,limit → `TripPage` 200 | — | R | 4147–4187 |
| POST `/tenants/{tenantId}/fleet/trips` | `startTrip` | Start a trip by consuming an inspected reservation | `fleet.trips.start` | `tenant-org-unit-self` | `TripStart` → `Trip` 201 (+ETag) | Idem | C | 4188–4249 |
| GET `/tenants/{tenantId}/fleet/trips/{tripId}` | `getTrip` | Read a trip and operational revision | `fleet.trips.read` | `tenant-org-unit-self` | — → `Trip` 200 (+ETag) | — | R | 4254–4293 |
| PATCH `/tenants/{tenantId}/fleet/trips/{tripId}` | `returnTrip` | Return a vehicle with a completed return inspection | `fleet.trips.return` | `tenant-org-unit-self` | `TripReturn` → `Trip` 200 | Idem + If-Match | U | 4294–4358 |
| POST `/tenants/{tenantId}/fleet/trips/{tripId}/review` | `reviewTrip` | Manager reviews return and vehicle release | `fleet.trips.review` | `responsible-manager-or-owner` | `TripReview` → `Trip` 200 | Idem + If-Match | U | 4363–4424 |
| GET `/tenants/{tenantId}/fleet/trips/{tripId}/expenses` | `listTripExpenses` | Read permitted trip expenses | `fleet.expenses.read` | `tenant-org-unit-self` | cursor,limit → `TripExpensePage` 200 | — | R | 4429–4469 |
| POST `/tenants/{tenantId}/fleet/trips/{tripId}/expenses` | `createTripExpense` | Record fuel, wash or another trip cost | `fleet.expenses.create` | `tenant-org-unit-self` | `TripExpenseCreate` → `TripExpense` 201 (+ETag) | Idem | C | 4470–4537 |
| GET `/tenants/{tenantId}/fleet/driver-transfer-requests` | `listDriverTransfers` | List relevant inter-unit driver requests | `fleet.driver_transfers.read` | `source-or-target-manager-owner` | cursor,limit → `DriverTransferPage` 200 | — | R | 4651–4691 |
| POST `/tenants/{tenantId}/fleet/driver-transfer-requests` | `requestDriverTransfer` | Request a free driver for a bounded interval | `fleet.driver_transfers.request` | `target-manager-or-owner` | `DriverTransferCreate` → `DriverTransfer` 201 (+ETag) | Idem | C | 4692–4750 |
| POST `/tenants/{tenantId}/fleet/driver-transfer-requests/{requestId}/decision` | `decideDriverTransfer` | Approve, reject or revoke a temporary driver assignment | `fleet.driver_transfers.approve` | `source-manager-or-owner` | `DriverTransferDecision` → `DriverTransfer` 200 | Idem + If-Match | U | 4755–4816 |
| GET `/tenants/{tenantId}/fleet/routes` | `listRoutes` | List scoped planned routes | `fleet.routes.read` | `tenant-org-unit-assigned-driver` | cursor,limit → `RoutePage` 200 | — | R | 4820–4860 |
| POST `/tenants/{tenantId}/fleet/routes` | `createRoute` | Validate stop order, cargo compatibility and per-leg load | `fleet.routes.manage` | `tenant-or-org-unit` | `RouteCreate` → `Route` 201 (+ETag) | Idem | C | 4861–4919 |
| GET `/tenants/{tenantId}/fleet/inspection-checklist` | `getInspectionChecklist` | Read the currently applicable inspection checklist | `fleet.inspections.read` | `tenant-org-unit-self` | `vehicleId` (required), `kind ∈ departure|return` (required) → `InspectionChecklist` 200 | — | R | 5940–5993 |
| GET `/tenants/{tenantId}/fleet/inspections/{inspectionId}` | `getInspection` | Read visible inspection and revision | `fleet.inspections.read` | `tenant-org-unit-self` | — → `Inspection` 200 (+ETag) | — | R | 5998–6037 |
| POST `/tenants/{tenantId}/fleet/inspections/{inspectionId}/review` | `reviewInspection` | Review an inspection before release where required | `fleet.inspections.review` | `responsible-manager-or-owner` | `InspectionReview` → `Inspection` 200 | Idem + If-Match | U | 6042–6103 |
| GET `/tenants/{tenantId}/fleet/trips/{tripId}/expenses/{expenseId}` | `getTripExpense` | Read permitted expense and revision | `fleet.expenses.read` | `tenant-org-unit-self` | — → `TripExpense` 200 (+ETag) | — | R | 6109–6148 |
| POST `/tenants/{tenantId}/fleet/trips/{tripId}/expenses/{expenseId}/review` | `reviewTripExpense` | Approve or reject a reported trip expense | `fleet.expenses.review` | `responsible-manager-or-owner` | `ExpenseReview` → `TripExpense` 200 | Idem + If-Match | U | 6154–6215 |
| GET `/tenants/{tenantId}/fleet/driver-pool` | `listAvailableDrivers` | Read the minimal published inter-unit driver pool | `fleet.driver_transfers.request` | `target-manager-or-owner` | cursor,limit,`availableFrom` (required),`availableUntil` (required) → `DriverAvailabilityPage` 200 | — | R | 6219–6271 |
| GET `/tenants/{tenantId}/fleet/driver-transfer-requests/{requestId}` | `getDriverTransfer` | Read a relevant transfer and current revision | `fleet.driver_transfers.read` | `source-or-target-manager-owner` | — → `DriverTransfer` 200 (+ETag) | — | R | 6276–6315 |

### 5.14 Earnings (2) — yaml:4538–4647

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/fleet/trips/{tripId}/earnings` | `getTripEarnings` | Read confidential driver earnings («Driver access is prohibited even to own earnings») | `fleet.earnings.read` | `responsible-manager-or-owner-only` | — → `TripEarnings` 200 (+ETag) | — | R | 4542–4583 |
| PUT `/tenants/{tenantId}/fleet/trips/{tripId}/earnings` | `setTripEarnings` | Set confidential earnings with an audited revision («Earnings record with zero amount/revision 1 is created with trip, so updates always use If-Match») | `fleet.earnings.manage` | `responsible-manager-or-owner-only` | `EarningsUpdate` → `TripEarnings` 200 | Idem + If-Match | U | 4584–4647 |

### 5.15 Spa (7) — yaml:4920–5208, 6316–6429

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/spa/services` | `listSpaServices` | List scoped service durations and material recipes | `spa.services.read` | `tenant-org-unit` | cursor,limit → `SpaServicePage` 200 | — | R | 4923–4963 |
| POST `/tenants/{tenantId}/spa/services` | `createSpaService` | Create a treatment with duration, buffers and recipe | `spa.services.manage` | `tenant-org-unit` | `SpaServiceCreate` → `SpaService` 201 (+ETag) | Idem | C | 4964–5022 |
| GET `/tenants/{tenantId}/spa/appointments` | `listAppointments` | List allowed appointments or own practitioner schedule | `spa.appointments.read` | `tenant-org-unit-self` | cursor,limit → `AppointmentPage` 200 | — | R | 5026–5066 |
| POST `/tenants/{tenantId}/spa/appointments` | `createAppointment` | Reserve practitioner, room and equipment atomically | `spa.appointments.create` | `tenant-org-unit-self` | `AppointmentCreate` → `Appointment` 201 (+ETag) | Idem | C | 5067–5134 |
| POST `/tenants/{tenantId}/spa/appointments/{appointmentId}/completion` | `completeAppointment` | Complete treatment and consume materials once | `spa.appointments.complete` + `inventory.consume` | `tenant-org-unit-self` | `AppointmentComplete` → `AppointmentCompletion` 200 | Idem + If-Match | U | 5139–5208 |
| GET `/tenants/{tenantId}/spa/appointments/{appointmentId}` | `getAppointment` | Read allowed appointment and revision | `spa.appointments.read` | `tenant-org-unit-self` | — → `Appointment` 200 (+ETag) | — | R | 6320–6359 |
| POST `/tenants/{tenantId}/spa/appointments/{appointmentId}/performance` | `recordAppointmentPerformance` | Record actual treatment before stock posting | `spa.appointments.perform` | `tenant-org-unit-self` | `AppointmentPerformance` → `Appointment` 200 | Idem + If-Match | U | 6364–6429 |

### 5.16 Inventory (4) — yaml:5209–5414

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/inventory/items` | `listInventoryItems` | List allowed stock item definitions | `inventory.items.read` | `tenant-org-unit-warehouse` | cursor,limit → `InventoryItemPage` 200 | — | R | 5212–5252 |
| POST `/tenants/{tenantId}/inventory/items` | `createInventoryItem` | Create a stock item with exact base unit | `inventory.items.manage` | `tenant-org-unit` | `InventoryItemCreate` → `InventoryItem` 201 (+ETag) | Idem | C | 5253–5311 |
| GET `/tenants/{tenantId}/inventory/movements` | `listInventoryMovements` | List immutable visible stock movements | `inventory.movements.read` | `tenant-org-unit-warehouse` | cursor,limit → `InventoryMovementPage` 200 | — | R | 5315–5355 |
| POST `/tenants/{tenantId}/inventory/movements` | `postInventoryMovement` | Atomically post receipt, issue, transfer or correction («Requires kind-specific permission») | `inventory.movements.post` | `tenant-org-unit-warehouse` | `InventoryMovementCreate` → `InventoryMovement` 201 | Idem | C | 5356–5414 |

### 5.17 Cash (4) — yaml:5415–5632

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/cash/accounts` | `listCashAccounts` | Read internal cash accounts and balances | `cash.read` | `tenant-org-unit-account` | cursor,limit → `CashAccountPage` 200 | — | R | 5418–5458 |
| POST `/tenants/{tenantId}/cash/accounts` | `createCashAccount` | Create a zero-balance internal cash account | `cash.manage` | `tenant-org-unit` | `CashAccountCreate` → `CashAccount` 201 (+ETag) | Idem | C | 5459–5517 |
| GET `/tenants/{tenantId}/cash/operations` | `listCashOperations` | List visible append-only ledger postings | `cash.read` | `tenant-org-unit-account` | cursor,limit → `CashOperationPage` 200 | — | R | 5521–5561 |
| POST `/tenants/{tenantId}/cash/operations` | `postCashOperation` | Record an internal receipt, expense or linked reversal («Refund/adjustment additionally requires cash.refund/cash.adjust») | `cash.post` | `tenant-org-unit-account` | `CashOperationCreate` → `CashOperation` 201 | Idem | C | 5562–5632 |

### 5.18 Repairs (4) — yaml:5633–5838

| Метод, путь | operationId | summary | x-permissions | x-scope | Тело → ответ | Idem / If-Match | Ошибки | yaml |
|---|---|---|---|---|---|---|---|---|
| GET `/tenants/{tenantId}/repairs/projects` | `listRepairProjects` | List visible repair projects and non-login workers | `repairs.projects.read` | `tenant-org-unit-project-assigned-foreman` | cursor,limit → `RepairProjectPage` 200 | — | R | 5636–5676 |
| POST `/tenants/{tenantId}/repairs/projects` | `createRepairProject` | Create a repair project and non-login worker records | `repairs.projects.manage` | `tenant-org-unit` | `RepairProjectCreate` → `RepairProject` 201 (+ETag) | Idem | C | 5677–5735 |
| GET `/tenants/{tenantId}/repairs/work-logs` | `listWorkLogs` | List visible work, presence and evidence logs | `repairs.work_logs.read` | `tenant-org-unit-project-assigned-foreman` | cursor,limit → `WorkLogPage` 200 | — | R | 5739–5779 |
| POST `/tenants/{tenantId}/repairs/work-logs` | `submitWorkLog` | Submit work and attendance for a foreman project | `repairs.work_logs.submit` | `tenant-org-unit-project-assigned-foreman` | `WorkLogCreate` → `WorkLog` 201 (+ETag) | Idem | C | 5780–5838 |

### 5.19 Сводка по операциям

- 58 операций требуют `Idempotency-Key`; 26 — `If-Match` (все с кодом 412 в таблицах); 3 POST без идемпотентности — `queryDataset`, `findCalendarAvailability`, `getPublicUploadStatus` (read-only POST).
- 2 операции возвращают 204 (`deleteRole`, `revokeAssignment`); 2 — 202 (`completeUpload`, `completePublicUpload`).
- Значения `x-scope` (27 различных): `identity`(1), `platform`(7), `tenant`(9), `tenant-owner`(3), `tenant-owner-or-billing-manager`(2), `tenant-or-org-unit`(14), `tenant-org-unit`(5), `tenant-org-unit-self`(25), `tenant-org-unit-project`(13), `tenant-org-unit-project-self`(4), `tenant-org-unit-project-assigned`(3), `tenant-org-unit-project-assigned-foreman`(3), `tenant-org-unit-resource-pool`(1), `tenant-org-unit-assigned-driver`(1), `tenant-org-unit-warehouse`(3), `tenant-org-unit-account`(3), `responsible-manager-or-owner`(3), `responsible-manager-or-owner-only`(2), `source-manager-or-owner`(1), `source-or-target-manager-owner`(2), `target-manager-or-owner`(2), `owning-object-scope`(2), `owning-object-and-field-scope`(2), `effective-module-and-field-scopes`(2), `public-form-capability`(1), `public-form-capability-and-nonce`(1), `form-version-field-and-nonce`(3). ⚠ Семантика каждого значения описана только в description операций и в 02-architecture; формального словаря `x-scope` в источниках нет.
- 86 различных ключей `x-permissions` используются в контракте (см. список в §7 «Инварианты», п. 18).

---

## 6. Каталог схем (199)

Формат: `Имя` (yaml:строка) — назначение; **required**: поля. Enum приводятся там, где они задают состояния.

### 6.1 Примитивы и общие (16)

| Схема | yaml | Назначение | required / ограничения |
|---|---|---|---|
| `Id` | 6808 | uuid | — |
| `Instant` | 6813 | RFC3339 UTC, `pattern: Z$` | — |
| `TimeZone` | 6821 | IANA zone, «checked against the deployed tz database» | — |
| `Decimal` | 6826 | `^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$`, maxLength 40 | — |
| `Quantity` | 6833 | неотрицательный decimal, тот же формат без знака | — |
| `Money` | 6840 | `amountMinor` 0…9007199254740991, `currency ^[A-Z]{3}$` | **amountMinor, currency** |
| `SignedMoney` | 11506 | то же со знаком (балансы) | **amountMinor, currency** |
| `TimeWindow` | 6857 | `[startsAt, endsAt)` + timeZone | **startsAt, endsAt, timeZone** |
| `ObjectRef` | 6873 | `{moduleKey, entityType, entityId}` «A reference never grants access» | **moduleKey, entityType, entityId** |
| `ProblemViolation` | 6890 | ошибка поля | **field, code, message** |
| `Problem` | 6904 | RFC Problem Details | **type, title, status, code, requestId** |
| `Scope` | 6936 | `kind ∈ tenant|org_unit|project|self|resource_pool` | **kind, resourceIds (≤100), includeDescendants** |
| `Permission` | 6962 | элемент каталога прав; `sensitivity ∈ standard|personal|financial` | **key, moduleKey, description, allowedScopeKinds, sensitivity** |
| `ScopedCapability` | 6995 | право + область (для UI) | **permission, scope** |
| `ModuleAvailability` | 7006 | `state ∈ uninstalled|active|draining|read_only|disabled|suspended`; `accessMode ∈ none|read|write|finish_only`; `reason ∈ available|not_installed|disabled|plan_expired|permission_denied|tenant_suspended|draining` | **moduleKey, state, accessMode, reason** |
| `TenantContext` | 7043 | контекст одного бизнеса; `membershipStatus ∈ active|suspended` | **tenantId, name, membershipId, membershipStatus, orgUnitIds, modules, capabilities** |

### 6.2 Контекст, платформа, подписка, хранилище (15)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `MeContext` | 7078 | ответ `/me/context`; «No tenant is selected implicitly for writes» | **userId, displayName, platformOperator, tenants, permissionVersion** |
| `Tenant` | 7102 | `status ∈ provisioning|active|suspended|closing`; «ownerUserIds may be empty only during provisioning» | **id, name, status, ownerUserIds, createdAt, revision** |
| `TenantCreate` | 7136 | создание + provisioning job | **name (1–150), ownerEmail, timeZone, planKey** |
| `TenantPatch` | 7158 | `status ∈ active|suspended`, `reason` 5–500 | — |
| `TenantPage` | 7177 | страница | **items, nextCursor** |
| `PlatformUser` | 7195 | «Platform support metadata only»; `status ∈ invited|active|suspended` | **id, displayName, email, status, tenantCount** |
| `PlatformUserPage` | 7226 | страница | **items, nextCursor** |
| `Entitlement` | 7244 | `sourceType ∈ plan|addon|trial|manual` | **key, sourceType, sourceRef, value** |
| `Subscription` | 7270 | `status ∈ trialing|active|past_due|grace|read_only|cancelled` | **planKey, status, cancelAtPeriodEnd, entitlements, revision** |
| `PlatformSubscriptionUpdate` | 7307 | «Privileged, audited operation»; manual entitlements с `sourceType=manual` | **planKey, status, cancelAtPeriodEnd, manualEntitlements, reason (5–500)** |
| `SubscriptionChange` | 7346 | `action ∈ start_trial|change_plan|cancel_at_period_end|resume`; «Paid changes require a valid server quote» | **action** |
| `QuotaBucket` | 7365 | `kind ∈ attachments|database|versions|trash|reserved_uploads` | **kind, bytes** |
| `StorageUsage` | 7384 | «Only one billable total: committedBytes + reservedBytes»; `consistency ∈ estimated`; `writeStatus ∈ allowed|blocked` | **quotaBytes, committedBytes, reservedBytes, buckets, measuredAt, consistency, writeStatus** |
| `StorageChangeRequest` | 7432 | `mode ∈ quote|commit`; commit требует `acceptedQuoteId`; 409 `downgrade_below_usage` | **requestedQuotaBytes (≥1), mode** |
| `StorageChange` | 7453 | `state ∈ quoted|scheduled|applied|rejected` | **id, state, requestedQuotaBytes** |

### 6.3 Участники, роли, назначения, подразделения (17)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `Member` | 7484 | `status ∈ invited|active|suspended`; `workProfiles[] ∈ driver|practitioner|foreman|manager` (uniqueItems) | **id, displayName, status, orgUnitIds, revision, workProfiles** |
| `MemberPage` | 7530 | страница | **items, nextCursor** |
| `MemberPatch` | 7548 | `status ∈ active|suspended`, `orgUnitIds`, `workProfiles`; «Cannot remove/suspend the last active business owner» | — |
| `InvitationCreate` | 7577 | приглашение | **email, orgUnitIds, roleAssignments** |
| `InvitationRole` | 7599 | роль + область | **roleId, scope** |
| `Invitation` | 7610 | `status ∈ pending|accepted|expired|revoked`; «Invitation secret is never returned» | **id, email, status, expiresAt** |
| `Role` | 7635 | роль | **id, name, description, builtIn, permissions, revision** |
| `RoleCreate` | 7662 | «Empty permission list is allowed» | **name (1–100), permissions** |
| `RolePatch` | 7683 | name/description/permissions | — |
| `RolePage` | 7699 | страница | **items, nextCursor** |
| `Assignment` | 7717 | `principalType ∈ member|group`; `state ∈ active|expired|dormant` | **id, principalType, principalId, roleId, scope, state** |
| `AssignmentCreate` | 7753 | validFrom/validUntil опциональны | **principalType, principalId, roleId, scope** |
| `AssignmentPage` | 7777 | страница | **items, nextCursor** |
| `OrgUnit` | 7795 | `kind ∈ region|company|branch|team`; `status ∈ active|archived`; `parentId` nullable | **id, parentId, name, kind, status, revision** |
| `OrgUnitCreate` | 7831 | — | **parentId, name (1–150), kind** |
| `OrgUnitPatch` | 7855 | «Tree moves require authorization over old and new branches and must not create cycles» | — |
| `OrgUnitPage` | 7874 | страница | **items, nextCursor** |

### 6.4 Модули и настройки (8)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `ModuleManifest` | 7892 | «Registry-provided trusted manifests»; `state` как в `ModuleAvailability` | **moduleKey, version, name, dependencies, permissions, datasets, state, revision** |
| `ModuleCatalog` | 7938 | список манифестов | **items** |
| `ModuleInstallationUpdate` | 7948 | `retainedAccess ∈ history_read|owner_export`; «Core modules cannot be uninstalled» | **enabled** |
| `LogisticsSettings` | 7969 | `moduleKey: fleet`; `reservationTtlMinutes` 5–120; `requirePhotoRoles[] ∈ front|rear|left|right|odometer|cargo|damage`; `maxOfflineDraftHours` 1–72 | **moduleKey, reservationTtlMinutes, requirePhotoRoles, managerApprovalForRelease, maxOfflineDraftHours** |
| `SpaSettings` | 8005 | `moduleKey: spa`; `allowNegativeStock: const false` | **moduleKey, cancellationMinutes, allowNegativeStock, defaultTimeZone** |
| `FormsSettings` | 8026 | `moduleKey: forms` | **moduleKey, allowPublicForms, maxPublicUploadBytes, defaultRetentionDays** |
| `TasksSettings` | 8048 | `moduleKey: tasks` | **moduleKey, allowUnassignedTasks** |
| `ModuleSettings` | 8062 | `oneOf` 4 типов, `discriminator: moduleKey` (`fleet|spa|forms|tasks`) | — |

### 6.5 Типизированные значения и Data Hub (21)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `TextValue` | 8077 | `type: text`, value ≤10000 | **type, value** |
| `DecimalValue` | 8090 | `type: decimal` | **type, value** |
| `BooleanValue` | 8102 | `type: boolean` | **type, value** |
| `DateValue` | 8114 | `type: date` (format date) | **type, value** |
| `InstantValue` | 8127 | `type: instant` | **type, value** |
| `ReferenceValue` | 8139 | `type: reference` → `ObjectRef` | **type, value** |
| `MoneyValue` | 8151 | `type: money` | **type, value** |
| `FilesValue` | 8163 | `type: files`, ≤20 Id | **type, value** |
| `ChoicesValue` | 8178 | `type: choices`, ≤100 строк | **type, value** |
| `NullValue` | 8194 | `type: 'null'` | **type, value** |
| `FieldValue` | 8206 | `oneOf` 10 типов, `discriminator: type` | — |
| `FieldEntry` | 8231 | `{fieldKey, value}` | **fieldKey, value** |
| `FieldDescriptor` | 8242 | `valueType` (9), `filterOperators[] ∈ eq|ne|lt|lte|gt|gte|in|contains|is_null`, `sensitivity` | **key, label, valueType, nullable, filterOperators, sortable, aggregatable, sensitivity** |
| `Dataset` | 8297 | «fleet.earnings is absent from driver catalog»; `allowedAggregations ∈ count|sum|avg|min|max` | **id, moduleKey, name, fields, allowedAggregations, permissionVersion** |
| `DatasetCatalog` | 8332 | — | **items** |
| `QueryFilter` | 8342 | «is_null requires no values; eq etc. one value; in multiple values» | **fieldKey, operator, values (≤100)** |
| `QuerySort` | 8371 | `direction ∈ asc|desc` | **fieldKey, direction** |
| `QueryAggregate` | 8385 | `alias ^[a-z][a-z0-9_]{0,49}$` | **function, alias** |
| `DatasetQuery` | 8405 | «Only AND filters in v0.1»; select 1–100, filters ≤50, sort ≤5, groupBy ≤5, aggregates ≤20, limit 1–200 | **select, filters, sort, limit** |
| `DatasetRow` | 8451 | — | **recordId, cells** |
| `DatasetQueryResult` | 8464 | «No unrestricted total count» | **rows, nextCursor, schemaVersion** |

### 6.6 Файлы (5)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `UploadCreate` | 8484 | `purpose ∈ inspection|expense_receipt|knowledge_attachment|form_attachment|repair_evidence`; `sha256 ^[a-f0-9]{64}$` | **fileName (1–255), contentType, sizeBytes (≥1), sha256, purpose, owner** |
| `UploadTicket` | 8524 | `method: const PUT`; TTL 15 мин | **uploadId, fileId, method, uploadUrl, requiredContentType, requiredSha256, expiresAt, maxBytes** |
| `UploadComplete` | 8560 | — | **sha256** |
| `File` | 8569 | `status ∈ pending_upload|quarantined|ready|rejected` | **id, fileName, contentType, sizeBytes, sha256, status, createdAt** |
| `DownloadTicket` | 8606 | — | **fileId, downloadUrl, expiresAt** |

### 6.7 Задачи и знания (12)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `Project` | 8623 | `status ∈ active|archived` | **id, name, orgUnitId, key, status, workflowKey, revision** |
| `ProjectCreate` | 8654 | `key ^[A-Z][A-Z0-9]{1,9}$` | **name, orgUnitId, key, workflowKey** |
| `ProjectPage` | 8674 | — | **items, nextCursor** |
| `Task` | 8692 | `status` — свободная строка workflow | **id, projectId, title, status, relatedObjects, customFields, revision** |
| `TaskCreate` | 8732 | title 1–200, descriptionMarkdown ≤50000 | **projectId, title** |
| `TaskPatch` | 8762 | «Status changes are accepted only by the transitions endpoint» | — |
| `TaskTransition` | 8790 | comment ≤5000 | **transitionKey** |
| `TaskPage` | 8801 | — | **items, nextCursor** |
| `KnowledgePage` | 8819 | `status ∈ draft|published|archived` | **id, title, bodyMarkdown, scope, status, revision, updatedAt** |
| `KnowledgePageCreate` | 8853 | bodyMarkdown ≤200000 | **title, bodyMarkdown, scope** |
| `KnowledgePagePatch` | 8872 | title/bodyMarkdown/status | — |
| `KnowledgePageList` | 8889 | — | **items, nextCursor** |

### 6.8 Календарь (9)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `ResourceRequirement` | 8907 | `kind ∈ member|room|vehicle|equipment`; «SPA needs practitioner + room + optional equipment; fleet needs driver + vehicle» | **kind, resourceIds (≥1), requiredCount (≥1)** |
| `AvailabilityQuery` | 8935 | durationMinutes 5–10080, stepMinutes 5–120, requirements 1–10 | **orgUnitId, window, durationMinutes, stepMinutes, requirements** |
| `ResourceSelection` | 8963 | — | **kind, resourceId** |
| `AvailabilitySlot` | 8979 | «Advisory availability only, never a reservation» | **window, resources, availabilityToken, tokenExpiresAt** |
| `AvailabilityResult` | 9000 | — | **slots, calculatedAt** |
| `Booking` | 9013 | `status ∈ confirmed|cancelled` | **id, orgUnitId, title, window, resources, status, revision** |
| `BookingCreate` | 9048 | resources 1–20; «A token is a freshness hint, not authorization» | **orgUnitId, title, window, resources** |
| `BookingPatch` | 9077 | `action ∈ reschedule|cancel` | **action** |
| `BookingPage` | 9101 | — | **items, nextCursor** |

### 6.9 Формы и публичные формы (23)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `ChoiceOption` | 9119 | — | **key, label** |
| `FormField` | 9130 | `key ^[a-z][a-z0-9_]{0,63}$`; `type ∈ text|textarea|number|date|datetime|single_choice|multi_choice|boolean|file|reference`; maxFiles 1–10; maxFileBytes ≤26214400 | **key, label, type, required** |
| `VisibilityCondition` | 9188 | `operator ∈ equals|not_equals|contains` | **sourceFieldKey, operator, value** |
| `FieldVisibility` | 9206 | «AND conditions only in v0.1» | **fieldKey, conditions (≥1)** |
| `FormDefinition` | 9222 | fields 1–200, visibility ≤200 | **title, description, fields, visibility, confirmationText** |
| `Form` | 9253 | `status ∈ draft|published|closed` | **id, orgUnitId, name, status, latestVersionId, revision** |
| `FormCreate` | 9284 | — | **orgUnitId, name, definition** |
| `FormPatch` | 9300 | `status: const closed` | — |
| `FormPage` | 9313 | — | **items, nextCursor** |
| `FormVersion` | 9331 | неизменяемая версия | **id, formId, number, definition, createdAt** |
| `FormVersionPage` | 9353 | — | **items, nextCursor** |
| `FormVersionCreate` | 9371 | — | **baseVersionId, definition** |
| `FormPublish` | 9382 | `access ∈ members|public` | **access, allowFileUploads, retainResponsesDays** |
| `FormPublication` | 9412 | — | **formId, versionId, access, publishedAt, revision** |
| `FormResponse` | 9440 | `reviewStatus ∈ pending|accepted|rejected` | **id, formId, versionId, submittedAt, answers, reviewStatus, revision** |
| `ResponseReviewPatch` | 9478 | «No arbitrary editing of original answers» | — |
| `FormResponsePage` | 9498 | — | **items, nextCursor** |
| `PublicForm` | 9516 | «Only a sanitized published definition» | **formId, versionId, definition, acceptingResponses, uploadAllowed, uploadMaxBytes, submissionNonce, nonceExpiresAt** |
| `PublicResponseCreate` | 9549 | answers ≤200; 409 `form_version_changed`; nonce single-use | **versionId, submissionNonce, answers** |
| `PublicResponseReceipt` | 9574 | «not a response-read capability» | **receiptId, submittedAt, message** |
| `PublicUploadCreate` | 9589 | — | **versionId, submissionNonce, fieldKey, fileName, contentType, sizeBytes, sha256** |
| `PublicUploadComplete` | 9627 | — | **submissionNonce, sha256** |
| `PublicUploadStatusQuery` | 11585 | nonce 16–256 | **submissionNonce** |

### 6.10 Логистика (34)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `VehicleCapacity` | 9639 | — | **payloadKg, volumeM3, cargoLengthM, cargoWidthM, cargoHeightM** |
| `Vehicle` | 9659 | `bodyType ∈ van|box|flatbed|refrigerated`; `equipment[] ∈ tail_lift|side_loading|pallet_jack|refrigerator`; `status ∈ available|reserved|in_use|maintenance|blocked` | **id, orgUnitId, registrationNumber, displayName, bodyType, capacity, equipment, status, odometerKm, revision** |
| `VehicleCreate` | 9720 | — | **orgUnitId, registrationNumber, displayName, bodyType, capacity, equipment, odometerKm** |
| `VehiclePage` | 9762 | — | **items, nextCursor** |
| `ReservationCreate` | 9780 | «Driver self-service can only reserve for their own memberId» | **vehicleId, driverMemberId, window** |
| `Reservation` | 9799 | `state ∈ held|released|expired|consumed` | **id, vehicleId, driverMemberId, window, state, holdExpiresAt, revision** |
| `ReservationPatch` | 9836 | `action: const release` | **action** |
| `ReservationPage` | 9848 | — | **items, nextCursor** |
| `InspectionPhoto` | 9866 | `role ∈ front|rear|left|right|odometer|cargo|damage` | **role, fileId, capturedAt** |
| `InspectionCheck` | 9888 | `result ∈ pass|fail|not_applicable` | **key, result** |
| `InspectionCreate` | 9906 | «Departure requires reservationId; return requires tripId»; photos 1–30; fuelPercent 0–100 | **checklistVersionId, vehicleId, kind, odometerKm, fuelPercent, checks, photos, capturedAt** |
| `Inspection` | 9957 | `status ∈ submitted|requires_review|approved|rejected` | **checklistVersionId, id, vehicleId, memberId, kind, status, odometerKm, fuelPercent, checks, photos, capturedAt, submittedAt, revision** |
| `InspectionPage` | 10017 | — | **items, nextCursor** |
| `TripStart` | 10035 | «Single online transaction: consume unexpired reservation… confirm no blocking damage… create in_progress trip and outbox event» | **reservationId, departureInspectionId** |
| `Trip` | 10050 | `status ∈ in_progress|returned_pending_review|approved|rejected`; «No earnings, payroll totals, manager remarks» | **id, vehicleId, driverMemberId, orgUnitId, departureInspectionId, status, startedAt, revision** |
| `TripReturn` | 10095 | `action: const return` | **action, returnInspectionId** |
| `TripReview` | 10109 | `decision ∈ approve|reject|maintenance_required` | **decision** |
| `TripPage` | 10126 | — | **items, nextCursor** |
| `TripExpenseCreate` | 10144 | `kind ∈ fuel|wash|parking|toll|other`; receiptFileIds ≤10 | **kind, occurredAt, amount, receiptFileIds** |
| `TripExpense` | 10178 | `reviewState ∈ pending|approved|rejected` | **id, tripId, kind, occurredAt, amount, receiptFileIds, reviewState, revision** |
| `TripExpensePage` | 10223 | — | **items, nextCursor** |
| `EarningsUpdate` | 10241 | — | **amount** |
| `TripEarnings` | 10252 | «FINANCIAL / manager-only» | **tripId, driverMemberId, amount, updatedByMemberId, updatedAt, revision** |
| `DriverTransferCreate` | 10282 | reason 1–2000 | **driverMemberId, sourceOrgUnitId, targetOrgUnitId, window, reason** |
| `DriverTransfer` | 10307 | `status ∈ requested|approved|rejected|expired|revoked` | **id, driverMemberId, sourceOrgUnitId, targetOrgUnitId, window, status, revision** |
| `DriverTransferDecision` | 10341 | `decision ∈ approve|reject|revoke`; 409 `driver_unavailable` | **decision** |
| `DriverTransferPage` | 10358 | — | **items, nextCursor** |
| `GeoPoint` | 10376 | lat −90…90, lon −180…180 (type number) | **latitude, longitude** |
| `Cargo` | 10391 | — | **id, description, weightKg, volumeM3, lengthM, widthM, heightM, requiredEquipment, stackable** |
| `RouteStop` | 10429 | `kind ∈ pickup|delivery|depot` | **sequence, kind, address, point, serviceMinutes, loadCargoIds, unloadCargoIds** |
| `RouteCreate` | 10468 | stops 2–100; «does not promise automatic VRP/3D packing optimization» | **orgUnitId, vehicleId, plannedStartAt, timeZone, cargo, stops** |
| `RouteLeg` | 10501 | — | **fromSequence, toSequence, loadedWeightKg, loadedVolumeM3** |
| `Route` | 10530 | `status ∈ draft|planned`; `estimateStatus ∈ available|provider_unavailable|not_configured` | **id, orgUnitId, vehicleId, status, cargo, stops, legs, estimateStatus, warnings, revision** |
| `RoutePage` | 10582 | — | **items, nextCursor** |
| `InspectionReview` | 11520 | `decision ∈ approve|reject`; «Manager approval is not a vehicle-release command» | **decision** |
| `InspectionChecklistItem` | 11536 | — | **key, label, required, failureBlocksRelease** |
| `InspectionChecklist` | 11553 | `kind ∈ departure|return`; `requiredPhotoRoles[]` | **versionId, kind, items, requiredPhotoRoles** |
| `ExpenseReview` | 11595 | «Approval does not automatically post cash» | **decision** |
| `DriverAvailability` | 11610 | «Only explicitly published exchange-pool participants» | **driverMemberId, displayName, homeOrgUnitId, qualifications, freeWindow** |
| `DriverAvailabilityPage` | 11634 | — | **items, nextCursor** |

(в этой группе 40 строк: 34 «логистика» + 6 схем, объявленных после Repairs: `InspectionReview`, `InspectionChecklistItem`, `InspectionChecklist`, `ExpenseReview`, `DriverAvailability`, `DriverAvailabilityPage`.)

### 6.11 SPA, склад, касса, ремонт (33)

| Схема | yaml | Назначение | required |
|---|---|---|---|
| `ConsumptionRecipeLine` | 10600 | `unit ∈ ml|g|piece` | **itemId, quantity, unit** |
| `SpaService` | 10620 | — | **id, orgUnitId, name, durationMinutes, bufferBeforeMinutes, bufferAfterMinutes, price, requiredEquipmentIds, recipe, revision** |
| `SpaServiceCreate` | 10667 | — | **orgUnitId, name, durationMinutes, bufferBeforeMinutes, bufferAfterMinutes, price, requiredEquipmentIds, recipe** |
| `SpaServicePage` | 10708 | — | **items, nextCursor** |
| `AppointmentCreate` | 10726 | «reserves practitioner+room+equipment atomically and snapshots service/recipe/price versions» | **orgUnitId, serviceId, clientId, practitionerMemberId, roomId, equipmentIds, startsAt, timeZone** |
| `Appointment` | 10760 | `status ∈ confirmed|performed_pending_posting|completed|cancelled|no_show` | **id, orgUnitId, serviceId, serviceRevision, clientId, practitionerMemberId, roomId, equipmentIds, window, bookingId, status, revision** |
| `AppointmentPage` | 10818 | — | **items, nextCursor** |
| `ConsumptionOverride` | 10836 | — | **itemId, actualQuantity, reason** |
| `AppointmentComplete` | 10852 | «Requires performed_pending_posting… A stock shortage returns 409»; overrides требуют `inventory.consumption.override` | **warehouseId, overrides** |
| `AppointmentCompletion` | 10873 | — | **appointment, inventoryMovementIds** |
| `AppointmentPerformance` | 11652 | «moves to performed_pending_posting. No materials or money are posted» | **performedAt** |
| `InventoryItem` | 10886 | `baseUnit ∈ ml|g|piece|litre|kg` | **id, orgUnitId, name, sku, baseUnit, trackLots, revision** |
| `InventoryItemCreate` | 10920 | — | **orgUnitId, name, sku, baseUnit, trackLots** |
| `InventoryItemPage` | 10949 | — | **items, nextCursor** |
| `InventoryMovementLine` | 10967 | — | **itemId, quantity** |
| `InventoryMovementCreate` | 10983 | `kind ∈ receipt|issue|transfer|adjustment|reversal`; lines 1–200; «Negative stock is disabled in v0.1» | **kind, warehouseId, lines** |
| `InventoryMovement` | 11026 | — | **id, kind, warehouseId, lines, postedAt** |
| `InventoryMovementPage` | 11058 | — | **items, nextCursor** |
| `CashAccount` | 11076 | `kind ∈ cash|internal_virtual`; balance `SignedMoney` | **id, orgUnitId, name, currency, kind, balance, revision** |
| `CashAccountCreate` | 11108 | «not fiscalization, bank acquiring or tax accounting» | **orgUnitId, name, currency, kind** |
| `CashAccountPage` | 11133 | — | **items, nextCursor** |
| `CashOperationCreate` | 11151 | `direction ∈ in|out`; `category ∈ service_payment|expense|opening_balance|refund|adjustment` | **accountId, direction, amount, category, occurredAt** |
| `CashOperation` | 11191 | — | **id, accountId, direction, amount, category, occurredAt, postedAt, createdByMemberId** |
| `CashOperationPage` | 11233 | — | **items, nextCursor** |
| `Worker` | 11251 | «Non-login person record… must never consume a user seat» | **id, displayName, trade, status** |
| `WorkerCreate` | 11273 | — | **displayName, trade** |
| `RepairProject` | 11287 | `status ∈ planned|active|completed|archived` | **id, orgUnitId, name, address, foremanMemberId, budget, status, workers, revision** |
| `RepairProjectCreate` | 11328 | workers ≤100 | **orgUnitId, name, address, foremanMemberId, budget, workers** |
| `RepairProjectPage` | 11359 | — | **items, nextCursor** |
| `WorkLogLine` | 11377 | `unit ∈ hour|m2|m3|m|piece` | **workerId, workCode, quantity, unit** |
| `WorkLogCreate` | 11409 | lines 1–100, evidenceFileIds ≤20 | **projectId, workDate, timeZone, lines, evidenceFileIds** |
| `WorkLog` | 11442 | `status ∈ submitted|accepted|rejected` | **id, projectId, submittedByMemberId, workDate, timeZone, lines, evidenceFileIds, status, createdAt, revision** |
| `WorkLogPage` | 11488 | — | **items, nextCursor** |

Итого: 16 + 15 + 17 + 8 + 21 + 5 + 12 + 9 + 23 + 40 + 33 = **199**.

---

## 7. Экраны прототипа → операции; адаптер → operationId; пробелы

### 7.1 Методы `createHttpAdapter` (api.js:573–626) → контракт

| Метод прототипа (api.js) | Что шлёт прототип | operationId в контракте | Статус |
|---|---|---|---|
| `load` (586) | `GET /me/context` | `getMyContext` | ✅ совпадает |
| `extendTrial` (587) | `PATCH /platform/tenants/{id}/subscription {trialExtendDays}` | `updatePlatformSubscription` (PUT, `PlatformSubscriptionUpdate.trialEndsAt`, If-Match, `reason` обязателен) | ⚠ метод и тело не совпадают — адаптировать |
| `setTenantQuota` (588) | `PATCH …/subscription {storageQuotaGb}` | `updatePlatformSubscription` (`manualEntitlements[]`, sourceType=manual) | ⚠ адаптировать (байты, entitlement key не задан в YAML) |
| `setTenantStatus` (589) | `PATCH /platform/tenants/{id} {status}` | `updatePlatformTenant` (`TenantPatch.status ∈ active|suspended`, `reason`) | ⚠ прототип использует `trial/restricted` — канон ТЗ `provisioning/trial/active/grace/read_only/suspended/closing/closed` (docs/README.md:49) |
| `revokeInvite` (591) | `DELETE /invitations/{id}` | — | ❌ PROPOSED (17:140) |
| `requestSeats` (592) | `POST /subscription/change-requests` | — (`requestSubscriptionChange` имеет иную модель: `action` + `acceptedQuoteId`) | ❌ PROPOSED (17:138) |
| `cancelSeatRequest` (593) | `POST …/change-requests/{id}/cancel` | — | ❌ PROPOSED (17:139) |
| `decideSeatRequest` (594) | `POST /platform/subscription-requests/{id}/decision` | — | ❌ PROPOSED (17:142) |
| `publishPriceBook` (595) | `POST /platform/price-book/versions` | — | ❌ PROPOSED (17:146) |
| `cancelScheduledPriceBook` (596) | `DELETE /platform/price-book/versions/scheduled` | — | ❌ PROPOSED (17:147) |
| `setAccountLock` (597) | `PATCH /platform/accounts/{id} {locked, reason}` | — (есть только `listPlatformUsers`) | ❌ PROPOSED (17:144) |
| `resetMfa` (598) | `POST /platform/accounts/{id}/mfa-reset` | — | ❌ PROPOSED (17:145) |
| `inviteOperator` / `setOperatorRole` / `setOperatorStatus` (599–601) | `/platform/operators` | — | ❌ PROPOSED (17:148–150) |
| `setModule` (602) | `PATCH /modules/{key} {enabled}` | `setModuleInstallation` (PUT, `ModuleInstallationUpdate`, If-Match) | ⚠ метод + If-Match |
| `saveBranding` (603) | `PUT /branding` | — | ❌ PROPOSED (18:77–81) |
| `setStorageQuota` (604) | `POST /storage/changes {quotaGb, mode:'apply'}` | `requestStorageChange` (`requestedQuotaBytes`, `mode ∈ quote|commit`, `acceptedQuoteId`) | ⚠ двухшаговый quote→commit, байты |
| `invite` (605) | `POST /invitations {name,email,roleId,scope}` | `inviteMember` (`InvitationCreate {email, orgUnitIds, roleAssignments[{roleId, scope}]}`) | ⚠ форма тела |
| `assign` (606) | `POST /assignments {memberId, roleId, scope{type,id}, until}` | `createAssignment` (`principalType/principalId/roleId/scope{kind,resourceIds,includeDescendants}/validUntil`) | ⚠ модель scope |
| `unassign` (607) | `DELETE /assignments/{id}` | `revokeAssignment` | ✅ (+Idempotency-Key) |
| `createRole` (608) | `POST /roles {name, mode, sourceId}` | `createRole` (`RoleCreate {name, description, permissions[]}`) | ⚠ клонирование — на клиенте (`getRole` → permissions) |
| `saveRole` (609) | `PATCH /roles/{id}` + `If-Match: r.etag` | `updateRole` (`RolePatch`) | ⚠ тело прототипа — `actions/finance` объект; нужен маппинг в ключи через `prototype_renames` |
| `reserve` (610) | `POST /fleet/reservations {tripId, vehicleId}` | `reserveVehicle` (`ReservationCreate {vehicleId, driverMemberId, window, routeId?}`) | ⚠ в контракте нет «запланированного рейса»: `Trip` создаётся только `startTrip`; «рейс» прототипа до выезда = `Route` + `Reservation` |
| `cancelReservation` (611) | `PATCH /fleet/reservations/{tripId} {status:'cancelled'}` | `releaseReservation` (`{action:'release'}`, If-Match, по `reservationId`) | ⚠ |
| `assignVehicle` (612) | `PATCH /fleet/trips/{tripId} {vehicleId}` | — (`returnTrip` принимает только `action: return`) | ❌ нет операции «менеджер назначает машину»; ближайшее — `reserveVehicle` менеджером или `createRoute` с `vehicleId` |
| `submitDeparture` (613) | `POST /fleet/inspections {tripId, kind:'departure', …}` | `getInspectionChecklist` → `submitInspection` (`reservationId`, `checklistVersionId`, `photos[{role,fileId,capturedAt}]`) → `startTrip` (`{reservationId, departureInspectionId}`) | ⚠ одна команда прототипа = 2–3 вызова; результат `'blocked'` = `Inspection.status requires_review` / `startTrip` 409 `blocking_defect_open` |
| `decideDefect` (614) | `POST /fleet/trips/{tripId}/defect-decision` | частично `reviewInspection` (`approve|reject`) | ❌ PROPOSED (README.md:161); сценарий «неисправность подтверждена → машина `unavailable`, рейс обратно в `planned`» не покрыт (нет PATCH `Vehicle`) |
| `addExpense` (615) | `POST /fleet/trips/{id}/expenses` + idem | `createTripExpense` (`kind`, `amount: Money`, `quantity`, `receiptFileIds[]`) | ⚠ поля: прототип `category, amount(число), date, liters, comment, receipt{fileId}` |
| `finishRoute` (616) | `PATCH /fleet/trips/{id} {status:'returning'}` | — | ❌ нет операции; состояние `returning` — клиентское (не в `Trip.status`) |
| `submitReturn` (617) | `POST /fleet/inspections {tripId, kind:'return'}` | `submitInspection` (`tripId`, kind `return`) → `returnTrip` (`{action:'return', returnInspectionId}`, If-Match) | ⚠ два вызова |
| `reviewTrip` (618) | `POST /fleet/trips/{id}/review {decision: accept|rework, comment, steps[]}` | `reviewTrip` (`decision ∈ approve|reject|maintenance_required`, If-Match) | ⚠ нет `rework`/`steps` и нет состояния «на доработке» в `Trip.status`; начисление в прототипе создаётся при accept (api.js:392) — в контракте отдельный `setTripEarnings` |
| `requestDriver` (619) | `POST /fleet/driver-transfer-requests {driverId, tripId, comment}` | `listAvailableDrivers` + `requestDriverTransfer` (`driverMemberId, sourceOrgUnitId, targetOrgUnitId, window, reason`) | ⚠ тело |
| `decideRequest` (620) | `POST …/{id}/decision {approve}` | `decideDriverTransfer` (`decision ∈ approve|reject|revoke`, If-Match) | ⚠ |
| `upload` (621–625) | `POST /files/uploads {name,size}` → `…/complete {}` | `initiateUpload` (`fileName, contentType, sizeBytes, sha256, purpose, owner`) → PUT `uploadUrl` → `completeUpload {sha256}` (202) → poll `getFile` до `ready` | ⚠ нет sha256/purpose/owner и шага PUT; «реальный прогресс — через XHR/PUT по выданной ссылке» (api.js:623) |

### 7.2 Методы только mock-адаптера (api.js:115–568) → контракт

| Метод mock | Экран | operationId | Статус |
|---|---|---|---|
| `publishForm(formId, fields)` (415) | «Формы и опросы» | `createFormVersion` → `publishFormVersion` | ⚠ 2 вызова, оба с If-Match по форме |
| `moveTask(taskId, to)` (430) | «Задачи» | `transitionTask {transitionKey}` + If-Match | ⚠ статусы прототипа «Новая → В работе → На проверке → Готово» → `transitionKey`; guard «чек-лист закрыт» — серверный workflow, чек-листа в `Task` нет |
| `toggleTaskCheck` (438) | «Задачи» | — | ❌ чек-лист отсутствует в `Task` (только `customFields`) |
| `commentTask` (439) | «Задачи» | — | ❌ 03:147 «Комментарии» не спроектированы |
| `createTask` (445) | «Задачи» | `createTask` | ⚠ `priority`, `project` по умолчанию — через `customFields`/`TasksSettings.defaultProjectId` |
| `moveBooking(bookingId, start)` (454) | «Календарь» | `updateCalendarBooking {action: reschedule, window, resources}` + If-Match; подсказка слотов — `findCalendarAvailability` | ⚠ прототип возвращает `slots` в ошибке; контракт — отдельный запрос |
| `saveKbPage(pageId, body, baseVersion)` (467) | «База знаний» | `updateKnowledgePage {bodyMarkdown}` + If-Match (412 при устаревшей) | ✅ семантика совпадает |
| `completeAppointment(apId)` (479) | «Салон и SPA» / «Мой день» | `recordAppointmentPerformance` → `completeAppointment` (409 при нехватке; статус остаётся `performed_pending_posting`) | ⚠ 2 вызова |
| `resolveIssue(issueId, how)` (499) | «Салон и SPA» | — (исправление остатков → `postInventoryMovement`, затем повтор `completeAppointment`) | ❌ сущности «issue» нет |
| `addCashOp` (507) | «Касса» | `postCashOperation` | ✅ (`direction`, `category`, `Money`) |
| `reverseCashOp` (517) | «Касса» | `postCashOperation {reversesOperationId, category: refund|adjustment}` (+`cash.refund`/`cash.adjust`) | ✅ |
| `addWorkLog` (529) | «Объекты» | `submitWorkLog` | ⚠ материалы (`material, materialQty`) отсутствуют в `WorkLogLine` |
| `acceptWorkLog` (542) | «Объекты» / «Главная» | — | ❌ PROPOSED `POST /repairs/work-logs/{id}/accept` (19:106); право `repairs.work_logs.review` PROPOSED (11:126) |
| `resetTrip`, `setFlag`, `setActor`, `tenantIds`, `defaultBranding` | демо | — | демо-инструменты, в API не нужны |

### 7.3 Экраны (ключи `navForBase`, dc.html:2960–3001) → операции

| Персона | id / подпись (дословно) | Операции контракта | Пробелы |
|---|---|---|---|
| operator | `tenants` «Организации» | `listPlatformTenants`, `getPlatformTenant`, `createPlatformTenant`, `updatePlatformTenant`, `getPlatformSubscription`, `updatePlatformSubscription` | полоса мест/заявка — PROPOSED (17) |
| operator | `usage` «Использование» | — | ❌ `GET /platform/usage` PROPOSED (17:151) |
| operator | `requests` «Заявки на тариф» | — | ❌ PROPOSED (17:141–142) |
| operator | `accounts` «Пользователи» | `listPlatformUsers` | ❌ lock/mfa-reset/operators PROPOSED (17:143–150) |
| operator | `plans` «Тарифная сетка» | — | ❌ PROPOSED (17:146–147) |
| owner/manager | `home` «Главная» | `getMyContext`, `listTrips`, `listInspections`, `listDriverTransfers`, `listAppointments`, `listWorkLogs`, `getTenantSubscription`, `getStorageUsage`, `listMembers`, `listAssignments`, `listTasks` | ❌ лента событий/уведомлений — нет операции |
| owner | `modules` «Модули и место» | `listModuleCatalog`, `getModuleInstallation`, `setModuleInstallation`, `getModuleSettings`, `updateModuleSettings`, `getStorageUsage`, `requestStorageChange` | «сколько сотрудников имеют доступ через роли» — считать из `listAssignments` |
| owner | `users` «Пользователи и роли» | `listMembers`, `getMember`, `updateMember`, `inviteMember`, `listRoles`, `getRole`, `createRole`, `updateRole`, `deleteRole`, `listAssignments`, `createAssignment`, `revokeAssignment`, `listOrgUnits` | ❌ «Проверка доступа» (`explainAccess`), отзыв приглашения, группы (03:142) |
| owner | `billing` «Подписка и места» | `getTenantSubscription`, `requestSubscriptionChange` | ❌ заявки на места, `price-book/current` PROPOSED |
| owner | `branding` «Оформление» | — | ❌ PROPOSED (18:77–81) |
| owner/manager | `fleet` «Рабочее место логиста» | `listVehicles`, `createVehicle`, `listTrips`, `getTrip`, `listRoutes`, `createRoute`, `listReservations`, `reserveVehicle`, `releaseReservation`, `listInspections`, `getInspection`, `reviewInspection`, `listTripExpenses`, `reviewTripExpense`, `getTripEarnings`/`setTripEarnings` (только с правом) | ❌ назначение машины на плановый рейс, решение по дефекту, PATCH машины (03:151) |
| owner/manager | `pool` «Ресурсный пул» | `listAvailableDrivers`, `requestDriverTransfer`, `listDriverTransfers`, `getDriverTransfer`, `decideDriverTransfer` | публикация водителя в пул (`AvailabilityPublication` 02:165) — нет операции |
| owner/manager | `review` «Приёмка смен» | `listTrips` (`returned_pending_review`), `getTrip`, `getInspection` ×2, `listTripExpenses`, `getFileDownload`, `reviewTrip`, `reviewTripExpense`, `setTripEarnings` | ❌ «вернуть по разделам» (`rework`, `steps`) |
| driver | `today` «Сегодня» | `getMyContext`, `listReservations`, `listRoutes`, `getInspectionChecklist`, `initiateUpload`/`completeUpload`/`getFile`, `submitInspection`, `startTrip`, `listTripExpenses`, `createTripExpense`, `returnTrip` | клиентские состояния «На устройстве · ждёт связи» и т. п. — offline-очередь без API |
| driver | `cars` «Автомобили» | `listVehicles?availableFrom&availableUntil[&bodyType&minPayloadKg]`, `reserveVehicle` | — |
| owner/foreman | `repair` «Объекты» | `listRepairProjects`, `createRepairProject`, `listWorkLogs`, `submitWorkLog`, `initiateUpload` (`repair_evidence`) | ❌ `/accept`, `/return`, `/overview`, смета/акты/снабжение (19:104–163) |
| owner/therapist | `spa` «Салон и SPA» / «Мой день» | `listSpaServices`, `createSpaService`, `listAppointments`, `getAppointment`, `createAppointment`, `recordAppointmentPerformance`, `completeAppointment`, `listInventoryItems`, `listInventoryMovements`, `postInventoryMovement` | ❌ клиенты, кабинеты, оборудование, склады (03:144), перенос/отмена/check-in (03:152), «issues» |
| все | `tasks` «Задачи» | `listTaskProjects`, `createTaskProject`, `listTasks`, `getTask`, `createTask`, `updateTask`, `transitionTask` | ❌ комментарии, чек-лист, фильтр «Мои задачи» (query-параметры не описаны) |
| owner/manager | `forms` «Формы и опросы» | `listForms`, `getForm`, `createForm`, `updateForm`, `listFormVersions`, `createFormVersion`, `publishFormVersion`, `listFormResponses`, `getFormResponse`, `reviewFormResponse` | ❌ автоматизация «ответ → задача», внутренняя отправка ответа (03:145) |
| все | `calendar` «Календарь» | `findCalendarAvailability`, `listCalendarBookings`, `getCalendarBooking`, `createCalendarBooking`, `updateCalendarBooking` | ❌ справочник ресурсов (кабинеты, оборудование) |
| все | `knowledge` «База знаний» | `listKnowledgePages`, `getKnowledgePage`, `createKnowledgePage`, `updateKnowledgePage` | ❌ пространства, поиск, чтение старой версии (03:146) |
| owner/manager | `data` «Данные» | `listDatasets`, `queryDataset` | ❌ сохранённые виды, выгрузка (`data.export`), дашборды (03:148) |
| owner/manager | `files` «Файлы» | `getFile`, `getFileDownload` | ❌ список файлов по объекту/тенанту — операции нет |
| owner | `cash` «Касса» | `listCashAccounts`, `createCashAccount`, `listCashOperations`, `postCashOperation` | ❌ «предложения кассовых операций из принятых расходов» (12:83 событие `fleet.expense.verified.v1`, S4) |

### 7.4 Полный перечень пробелов контракта (из 03 «Что требуется допроектировать», docs/README «Расхождения», 17/18/19 PROPOSED, прототип)

| # | Поверхность | Чего нет | Источник |
|---|---|---|---|
| G-01 | Auth | OIDC callback, logout, bootstrap CSRF, восстановление, принятие приглашения | 03:141; docs/README.md:39; 13:S1-05/06 |
| G-02 | Группы и владельцы | CRUD групп, состав, передача владения, проверка effective access (`explainAccess`) | 03:142; 02:288 |
| G-03 | Профессиональные назначения | Временная история функций вместо `workProfiles` | 03:143; 03:54 |
| G-04 | Справочники | Клиенты, склады, кабинеты, оборудование, юрлица | 03:144 |
| G-05 | Формы | Авторизованная внутренняя отправка, collections, задания, редактура ответа; автоматизация «ответ → задача» | 03:145; README.md:70 |
| G-06 | Знания | Пространства, публикация, комментарии, старые версии | 03:146 |
| G-07 | Задачи | Комментарии, чек-листы, конструктор процессов, массовые операции | 03:147; api.js:438–444 |
| G-08 | Данные | CRUD сохранённых видов, dashboards, export jobs (`data.export`) | 03:148; 11:49 |
| G-09 | Подписки | Provider webhooks, возвраты, счета, налоги; заявки на места, тарифная сетка, операторы, каталог аккаунтов, `/platform/usage` | 03:149; 17:132–153 |
| G-10 | Файлы | Удаление, архив, версии, owner export; список файлов | 03:150 |
| G-11 | Логистика | CRUD документов/дефектов/ремонта авто, поздние корректировки, маршрутные этапы; решение по дефекту; назначение машины менеджером; «вернуть на доработку»; PATCH `Vehicle` | 03:151; README.md:161; api.js:612–618 |
| G-12 | SPA | Перенос/отмена, check-in, прерывание, составные услуги, частичное выполнение; issues | 03:152 |
| G-13 | Склад | Партии, инвентаризация, резервы, FEFO, подтверждение перемещений | 03:153 |
| G-14 | Касса | Атомарный перевод, распределение оплат, закрытие периодов | 03:154 |
| G-15 | Начисления | Общий ledger начислений/корректировок и выплаты | 03:155 |
| G-16 | Ремонт | `/work-logs/{id}/accept|return`, `/projects/{id}/overview`, смета, акты, снабжение, кабинет заказчика | 03:156; 19:104–163 |
| G-17 | Интеграции | Webhooks, подписи, retries, inbox | 03:157 |
| G-18 | Оформление | `/branding`, `/branding/files`, `/public/branding/{slug}`, `PATCH /me {uiTheme}`; права `branding.manage`/`branding.read` | 18:77–83 |
| G-19 | Realtime/уведомления | WS/SSE, inbox уведомлений | 02:30, 02:228; 13:S1-26 |
| G-20 | Коды ошибок | `Problem.code` — свободная строка; `enum` из 12 не внесён | docs/README.md:48; 12:3 |
| G-21 | Каталог прав | `spa.*`, `inventory.*`, `cash.*`, `forms.responses.assign`, `cash.refund`, `cash.adjust`, `inventory.consumption.override` не в `11-permissions.yaml` | 11:12–140 vs yaml |
| G-22 | Состояния тенанта | Прототип `trial/active/restricted/suspended`; `Tenant.status` в YAML `provisioning/active/suspended/closing`; ТЗ `provisioning/trial/active/grace/read_only/suspended/closing/closed` | docs/README.md:49; yaml:7110–7116 |

---

## 8. Auth-эндпоинты и сессия: статус

| Шаг | Где описан | Статус в OpenAPI 0.1 |
|---|---|---|
| Начало входа (redirect на IdP с PKCE) | 02:82; 03:40; 13:S1-05 | ❌ отсутствует |
| OIDC callback (code → session cookie `__Host-ortus_session`) | yaml:6438–6443; 03:40 | ❌ отсутствует (cookie описана как securityScheme, выдача — нет) |
| CSRF bootstrap (получение `X-CSRF-Token`) | yaml:75–77 «deferred authentication surface»; 03:40 | ❌ отсутствует |
| Logout (сброс cookie, удаление локальных кэшей/очереди — 02:247) | 03:40, 03:141 | ❌ отсутствует |
| Принятие приглашения (одноразовый токен, проверка ожидаемой идентичности → membership `active`) | 02:80; 13:S1-06; `Invitation.status` yaml:7619–7625 | ❌ отсутствует |
| Восстановление аккаунта | 02:35; 03:141 | ❌ отсутствует (ответственность IdP) |
| Переключатель бизнеса | 13:S1-07; `MeContext.tenants` | ✅ через `getMyContext` + URL `tenantId` (без отдельной операции) |
| Контекст после входа | `getMyContext` | ✅ присутствует |
| Bearer для интеграций | yaml:6432–6437 | ✅ схема есть; выдача токенов — IdP |
| Публичный токен формы | yaml:6594–6602; 03:44 | ✅ (5 операций `security: []`) |
| Support grant / break-glass | 02:303–305; 10:126 (`support_grants`) | ❌ эндпоинтов нет |

Правило docs/README.md:39: «Добавить в OpenAPI `enum` кодов ошибок из `12`, недостающие auth-эндпоинты (callback, logout, CSRF, принятие приглашения…)» — обязательный шаг до S1.

---

## 9. Инварианты и правила, которые реализация обязана сохранить

1. Порядок проверок `x-authorization-order` (yaml:11667–11677) неизменен; «Права на роуте — первый guard. Object checks, field checks, transition preconditions и источник scope обязательны» (02:291).
2. `tenantId` в URL никогда не устанавливает авторизацию; чужие и несуществующие ID → одинаковый 404 (yaml:13, 6731; 02:293).
3. Нет fallback в «главную БД»; sentinel сверяется при открытии пула (02:48–52).
4. Все списки фильтруются **до** пагинации/агрегации; `total` не раскрывает скрытые строки; курсор привязан к tenant/principal/scope version/query (yaml:7193–7194; 03:76; 02:218).
5. Поле без права чтения отсутствует в body/экспорте/поисковом документе; ограничение срабатывает до DTO serialization (02:231).
6. Водитель (активный `workProfiles: driver`) не читает начисления ни по одному каналу, включая Data Hub, экспорт, уведомления, аудит, кэш (yaml:4550–4552, 10279–10281, 11689–11690; 02:137–139); конфликт назначения → `409 separation_of_duties_conflict`.
7. Все write-body `additionalProperties: false`; неизвестные поля → 400 `unknown_field` (yaml:15; 12:31). Серверные суммы, статусы, owner IDs через PATCH не меняются (03:36).
8. `Idempotency-Key` обязателен на 58 мутациях; hash+outcome сохраняются в одной транзакции с доменным эффектом и outbox; повтор → тот же ответ + `Idempotency-Replayed: true`; другой payload → 409 `idempotency_key_reused`; in-flight → 409 `idempotency_in_progress` + `Retry-After` (yaml:15, 6628–6639; 12:55–56).
9. `If-Match` — strong ETag, `*` не принимается; 428 при отсутствии, 412 при устаревшем; replay проверяется до precondition (yaml:6640–6650).
10. Деньги — только `Money/SignedMoney` в minor units; «никаких float-операций над суммами» (14:113; yaml:6840–6856). Количества — decimal strings (yaml:6826–6839).
11. Время — UTC `Z` + IANA zone; интервалы `[from, until)`; «Срок истекает по серверному времени» (03:74; yaml:6871).
12. Бронь: одна подтверждённая на интервал ресурса (`EXCLUDE USING gist`), 100 конкурентных попыток → ровно 1 успех, остальные 409 `reservation_overlap` (02:180, 02:321; 10:115; AC-03).
13. `startTrip` — одна онлайн-транзакция: потребить неистёкший hold, проверить `ready`-фото и чек-лист, нет блокирующего дефекта, захватить operational lock, создать `in_progress` + outbox (yaml:10046–10049). «Offline-черновик не выдаётся за подтверждённый выезд» (03:109; D-09).
14. Активный рейс удерживает машину даже после планового окна (03:66; 02:178).
15. `completeAppointment`: требует `performed_pending_posting`, списание и завершение в одной транзакции, нехватка → 409 без отрицательного остатка, факт процедуры сохраняется (yaml:10868–10872; 03:115–117; AC-07).
16. Финансовая операция неизменяема; исправление — сторно/корректировка со ссылкой на оригинал (`reversesOperationId`), «cumulative refunds cannot exceed its amount» (yaml:11187–11190; 02:204).
17. Движения склада — immutable ledger; «Negative stock is disabled in v0.1» (yaml:11021–11025; `SpaSettings.allowNegativeStock const false`).
18. Используемые в контракте ключи прав (86): `billing.manage, billing.read, calendar.availability.read, calendar.bookings.create, calendar.bookings.manage, calendar.bookings.read, cash.manage, cash.post, cash.read, data.catalog.read, data.query, files.read, files.upload, fleet.driver_transfers.approve, fleet.driver_transfers.read, fleet.driver_transfers.request, fleet.earnings.manage, fleet.earnings.read, fleet.expenses.create, fleet.expenses.read, fleet.expenses.review, fleet.inspections.read, fleet.inspections.review, fleet.inspections.submit, fleet.reservations.create, fleet.reservations.manage, fleet.reservations.read, fleet.routes.manage, fleet.routes.read, fleet.trips.read, fleet.trips.return, fleet.trips.review, fleet.trips.start, fleet.vehicles.manage, fleet.vehicles.read, forms.create, forms.manage, forms.publish, forms.read, forms.responses.read, inventory.consume, inventory.items.manage, inventory.items.read, inventory.movements.post, inventory.movements.read, knowledge.create, knowledge.read, knowledge.update, members.invite, members.manage, members.read, modules.manage, modules.read, modules.settings.manage, modules.settings.read, org_units.manage, org_units.read, platform.billing.manage, platform.billing.read, platform.tenants.create, platform.tenants.manage, platform.tenants.read, platform.users.read, repairs.projects.manage, repairs.projects.read, repairs.work_logs.read, repairs.work_logs.submit, roles.assign, roles.manage, roles.read, spa.appointments.complete, spa.appointments.create, spa.appointments.perform, spa.appointments.read, spa.services.manage, spa.services.read, tasks.create, tasks.projects.manage, tasks.projects.read, tasks.read, tasks.transition, tasks.update` + только в description/x-field-permissions: `forms.responses.assign, forms.responses.review, forms.publish_public, knowledge.publish, cash.refund, cash.adjust, inventory.consumption.override`. Wildcard `module.*` в пользовательских ролях запрещён (02:133; 10:121).
19. Новые actions после обновления не добавляются в старые роли автоматически (02:133; 11:142).
20. Отключение модуля: `enabled=false` → `retainedAccess=history_read` (по умолчанию) → draining → `read_only`; `owner_export` → `disabled`; данные и dormant grants сохраняются (yaml:1570–1575, 7964–7968; 03:131).
21. Trial 14 дней / 10 мест / 5 ГиБ / grace 7 дней — гипотезы, настраиваются (02:255; 16:41). «Неуспешный платёж и уменьшение квоты не запускают автоматическое удаление данных» (02:255).
22. Квота: `used + reserved + new_bytes <= limit` атомарно; `UploadTicket` TTL 15 мин; `DownloadTicket` ≤ 60 с; 202 после complete ≠ ready (02:271; yaml:8558, 2031, 8603).
23. Кэш ответов: `Cache-Control: private, no-store` на всех 2xx (yaml:85–89 и далее).
24. Ревокация: policy_version ↑, кеш/realtime ≤ 5 с, незавершённые запросы ≤ 10 с; sensitive writes fail closed при недоступности control plane (02:295, 02:320; 12:65).
25. Логи без токенов, тел форм, фото, сумм начислений; `tenant_id` не label метрик по умолчанию (14:114–115; 02:332).
26. Структура репо и `depguard`: модуль не импортирует `internal` других модулей, не получает raw-пул БД (14:53).
27. Контракт — единственный источник: изменения начинаются с PR в `api/openapi/ortus.yaml`; CI: Spectral, полный валидатор OpenAPI 3.1, проверка `x-permissions` в каталоге, codegen drift (14:55–61; 12:99).

---

## 10. Чек-лист приёмки (Playwright e2e + API-уровень)

Селекторы/подписи — дословно из прототипа (`navForBase`, api.js, README.md). Где UI-подписи реализации ещё не зафиксированы, указан API-признак.

**A. Сессия и защита**

- A1. Given неавторизованный браузер, When `GET /api/v1/me/context`, Then 401 с `application/problem+json`, `code` = `session_expired` (12:32), заголовок `X-Request-Id` присутствует.
- A2. Given сессия с cookie `__Host-ortus_session`, When POST-мутация без `X-CSRF-Token`, Then 403, `code ∈ {csrf_failed, origin_not_allowed}` (12:40; yaml:6655–6657).
- A3. Given cookie и `Authorization: Bearer …` одновременно, When любой запрос, Then отказ (yaml:6443 «Do not send this cookie with a bearer token»).
- A4. Given любой 2xx-ответ API, Then `Cache-Control: private, no-store` и `X-Request-Id` (yaml:85–89).
- A5. Given публичная форма, When `GET /api/v1/public/forms/{publicToken}` без cookie, Then 200 `PublicForm` с `submissionNonce`; When тот же токен на `GET /api/v1/tenants/{tenantId}/fleet/vehicles`, Then 401/404 (AC-08, 15:42).

**B. Изоляция тенантов и область**

- B1. Given менеджер фирмы A, When `GET /tenants/{tenantId}/fleet/vehicles/{idФирмыB}`-подобные запросы (объекты фирмы B), Then 404 `not_found`, «время ответа не различается заметно» (AC-01; 15:35).
- B2. Given сессия тенанта A, When запрос с `tenantId` тенанта B, Then 404; пул B не открывается (AC-02; 15:36).
- B3. Given пользователь с ролями «изменять» в Москва-1 и «читать» в Самара-2, When PATCH объекта Самара-2, Then 403 `forbidden_action`; чтение — 200 (15:26; 02:114).
- B4. Given оператор платформы (`platformOperator: true`), When UI открыт, Then меню содержит только «Организации», «Использование», «Заявки на тариф», «Пользователи», «Тарифная сетка» (dc.html:2978) и шапка показывает «Отдельный вход · без доступа к данным клиентов» (dc.html:3009); When `GET /tenants/{anyId}/fleet/trips`, Then 403/404.

**C. Начисления и разделение обязанностей**

- C1. Given водитель (`workProfiles: [driver]`) с завершённым рейсом, When `GET /tenants/{t}/fleet/trips/{tripId}` Then в теле нет полей начислений; When `GET …/earnings` Then 403; When `GET /tenants/{t}/datasets` Then набор `fleet.earnings`/колонка «Начисление» отсутствует (AC-05; yaml:8330–8331; README.md:87).
- C2. Given владелец, When назначает роль с `fleet.earnings.read` сотруднику с функцией «Водитель», Then 409 `separation_of_duties_conflict`; в UI текст «Функция «Водитель» несовместима с правом на начисления (правило MVP).» (api.js:278; yaml:11688).
- C3. Given менеджер с `fleet.earnings.manage`, When `PUT …/earnings` без `If-Match`, Then 428; с устаревшим — 412; с актуальным — 200 и новый `ETag` (yaml:4592–4593).

**D. Идемпотентность и ревизии**

- D1. Given `POST /fleet/reservations` с `Idempotency-Key: K`, When повтор с тем же телом, Then тот же статус/тело и `Idempotency-Replayed: true`; When повтор с другим телом, Then 409 `idempotency_key_reused` (yaml:15; 12:55).
- D2. Given 100 параллельных `POST /fleet/reservations` на одну машину и окно, Then ровно один 201, остальные 409 `reservation_overlap` (AC-03; 02:321).
- D3. Given 100 повторов `POST /spa/appointments/{id}/completion` с одним ключом, Then одно движение склада (AC-07; 02:322).
- D4. Given `PATCH /tenants/{t}/knowledge/pages/{id}` с устаревшим `If-Match`, Then 412 `revision_mismatch`; в UI текст «Страницу уже изменили (vN). Обновите и повторите правку.» (api.js:471; 12:58).

**E. Путь водителя (03:97–109)**

- E1. Given водитель на странице «Сегодня» (nav id `today`), When открывает «Автомобили» (`cars`), Then список из `GET /fleet/vehicles?availableFrom&availableUntil` показывает только совместимые машины своей области (README.md:55).
- E2. Given флаг «Конфликт брони» (панель «Демо-режим»), When «Забронировать», Then 409 и текст «Машину только что забронировал другой сотрудник. Список на экране устарел.» (api.js:312).
- E3. Given бронь `held`, When загружает 5 фото, Then каждый слот проходит состояния «Загрузка N%» → «Принято сервером»; при флаге «Сбой загрузки фото» — «Ошибка — повторить» (README.md:13, 56); API: `initiateUpload` 201 → PUT → `completeUpload` 202 → `getFile` `status: ready`.
- E4. Given не все фото `ready`, When «Выехать», Then отказ с текстом «Не все фото загружены на сервер» (api.js:335) / API 409 `photo_not_ready`/`inspection_incomplete` (12:46–48; AC-04).
- E5. Given осмотр с критическим дефектом, When отправлен, Then `Inspection.status = requires_review`, `startTrip` → 409 `blocking_defect_open`; в UI «Критический дефект … Выезд заблокирован.» (api.js:341).
- E6. Given рейс `in_progress`, When «Добавить расход» без готового чека, Then «Фото чека ещё не загружено» (api.js:364); с чеком — `POST …/expenses` 201, `reviewState: pending`.
- E7. Given return-осмотр отправлен, When `PATCH /fleet/trips/{id}` `{action: return, returnInspectionId}` + `If-Match`, Then 200, `status: returned_pending_review`; пробег меньше начального → 422 `odometer_decrease` (12:61).
- E8. Given флаг «Нет связи», When любая команда брони/выезда/сдачи, Then текст «Нет связи с сервером. Операция не выполнена.» и баннер «Нет связи» (api.js:52; README.md:50); черновик помечен «На устройстве · ждёт связи».

**F. Менеджер**

- F1. Given менеджер на «Приёмка смен» (nav id `review`, badge = число смен `submitted|defect_review`, dc.html:2963–2971), When «Принять», Then `POST /fleet/trips/{id}/review {decision: approve}` + `If-Match` → `status: approved`, машина `available`; When повтор, Then «Смена уже обработана» (api.js:382) / 409 `invalid_transition`.
- F2. Given «Вернуть на доработку» без комментария, Then «Опишите, что нужно исправить» (api.js:384). ⚠ серверный эквивалент `rework` не спроектирован (G-11).
- F3. Given менеджер на «Ресурсный пул» (`pool`), When `GET /fleet/driver-pool?availableFrom&availableUntil`, Then элементы содержат только `driverMemberId, displayName, homeOrgUnitId, qualifications, freeWindow` — без контактов и начислений (yaml:11632–11633).

**G. Владелец: модули, роли, подписка**

- G1. Given владелец на «Модули и место» (`modules`), When отключает «Логистика» с активным рейсом, Then диалог последствий, затем `PUT /modules/fleet {enabled:false}` + `If-Match` → `state: draining`; новый рейс → 403 `module_read_only`; текущий сдаётся (AC-12; api.js:61–67; 12:36).
- G2. Given роль с `professional: driver`, When сохраняют с `finance.read`, Then «Роль с функцией «Водитель» не может содержать начисления» (api.js:299).
- G3. Given попытка снять роль последнего владельца, Then «Нельзя снять роль с последнего владельца» (api.js:285) / 409 `last_owner_required` (12:52).
- G4. Given мест нет (`seatsUsed >= seatsLimit`), When «Пригласить», Then «Свободных мест нет: занято N из M. Отзовите приглашение или запросите расширение тарифа.» (api.js:160) / 409 `seats_exhausted` (17:153, PROPOSED).
- G5. Given тенант `read_only`, When создание записи, Then 403 `tenant_read_only`; чтение и экспорт работают (AC-11; 12:37); текст прототипа «Пробный период завершён: новые операции недоступны. История доступна для чтения.» (api.js:55).
- G6. Given владелец, When `POST /storage/changes {mode: quote}`, Then 201 `StorageChange.state: quoted` с `quoteId`; When `commit` с `acceptedQuoteId` ниже занятого, Then 409 `downgrade_below_usage` (yaml:7450–7452).

**H. Формы, задачи, календарь, SPA, касса, ремонт**

- H1. Given форма v1 с ответами, When опубликована v2, Then старые ответы читаются по структуре v1 (`FormResponse.versionId` = v1) (AC-09; README.md:68).
- H2. Given задача со статусом «Новая», When переход в «Готово» при незакрытом чек-листе, Then «Нельзя завершить: в чек-листе есть невыполненные пункты» (api.js:434); неразрешённый переход → «Переход «X → Y» не предусмотрен процессом» (api.js:433) / 409 `invalid_transition`.
- H3. Given перенос визита в «Календарь» на занятый слот, Then 409 `resources_unavailable` с перечнем недоступных ресурсов без чужих деталей (12:43; api.js:461).
- H4. Given визит `confirmed`, When «Завершить» при нехватке материала, Then `performance` 200 → `completion` 409; статус `performed_pending_posting`; UI «SPA: услуга выполнена, учёт материалов не завершён — нужно решение» (api.js:493; yaml:10868–10871).
- H5. Given операция кассы, When «Исправить» без причины, Then «Укажите причину исправления» (api.js:519); повторное сторно → «Операция уже исправлена» (api.js:521).
- H6. Given прораб, When отметка с объёмом > план × 1.1, Then «Объём превышает план более чем на 10%…» (api.js:534); без фото — «Добавьте хотя бы одно фото» (api.js:536); API `submitWorkLog` требует `evidenceFileIds`.
- H7. Given прораб добавил рабочего (`Worker`), Then аккаунт и место не создаются (AC-13; yaml:11271–11272).

**I. Наблюдаемость**

- I1. Given любая ошибка в UI, Then показан `requestId` «мелким шрифтом с кнопкой «Скопировать»» (12:24).
- I2. Given логи стенда после сценария E, Then отсутствуют токены, тела форм, суммы начислений (14:114).

---

## 11. Открытые вопросы

1. Состояния тенанта: три разные модели — YAML `Tenant.status` (4 значения), ТЗ PLAT-02 (8), прототип (4 с `restricted`) — какая каноническая для API (docs/README.md:49)?
2. `Subscription.status` (`trialing|active|past_due|grace|read_only|cancelled`) и `Tenant.status` — как связаны `read_only` подписки и состояние тенанта? ⚠ не найдено в источниках.
3. Entitlement-ключи (`seats`, storage) не перечислены в YAML; `Entitlement.key` — свободная строка; `17:41` ссылается на `entitlements(feature_key = 'seats')`.
4. Как представить «плановый рейс» прототипа (`planned/assigned`) в контракте, где `Trip` появляется только при `startTrip`? Через `Route` + `Reservation` или новая сущность?
5. Нужен ли `rework` в `TripReview.decision` и состояние «на доработке» в `Trip.status` (прототип api.js:383–388)?
6. Решение по блокирующему дефекту (`decideDefect`) — расширить `reviewInspection` (downgrade/confirm) или отдельный эндпоинт + PATCH `Vehicle.status`?
7. Чек-лист и комментарии задач — `customFields` или отдельные ресурсы (G-07)?
8. Realtime-транспорт (WS/SSE) и inbox уведомлений — где в контракте (G-19)?
9. Версия PostgreSQL: compose `postgres:17` vs проверка на 16.4 vs «≥ 13» (D-04).
10. `x-scope` — нужен ли формальный словарь значений (27 штук) в `api/spectral.yaml`, чтобы линтер проверял их?
11. `Problem.code` — внести `enum` из 12-errors + 17 (`seats_exhausted`, `request_pending`, `tier_below_usage`) до генерации констант?
12. Каталог прав: расширять `11-permissions.yaml` ключами `spa.*`, `inventory.*`, `cash.*`, `forms.responses.assign`, `cash.refund/adjust`, `inventory.consumption.override` до CI-проверки (G-21)?
13. `GeoPoint` использует `type: number` (float) при общем правиле «не float» — допустимо для координат? ⚠ не обсуждается в источниках.
14. Публикация водителя в межфирменный пул (`AvailabilityPublication`, 02:165) — операции нет; как попадают записи в `listAvailableDrivers`?
15. Поддержка/break-glass (`support_grants`) — нужны ли эндпоинты в v0.1 или только оператором через control DB?
16. Запрос мест/тарифов: сохранять модель 17 (заявка → решение оператора) или модель YAML (`requestSubscriptionChange` с server quote)? Обе существуют параллельно.

---

## 12. Факты для плана

1. OpenAPI 0.1: 76 путей / 118 операций / 199 схем / 18 тегов; 58 операций с `Idempotency-Key`, 26 с `If-Match`, 5 публичных (`security: []`), 7 платформенных.
2. Контракт — «design-proposal-not-implemented»; «Реального backend нет» (03:165); полный OpenAPI/JSON Schema валидатор не прогонялся (03:165) — первый CI-шаг S0-02.
3. Auth-поверхность (login/callback/logout/CSRF/приглашение) отсутствует — блокирует S1-05/S1-06; до неё ни один e2e через BFF не пройдёт.
4. Структура репо задана `14-engineering.md:26–51`; backend `cmd/{api,worker,provisioner,migrate}`, `internal/platform`, `internal/control`, `internal/modules/*`; frontend pnpm workspace `apps/web`, `packages/{tokens,ui,api-client,domain}`.
5. Стек: Go `net/http` + chi, `oapi-codegen` strict server, `pgx/v5` + `sqlc`, `goose`, Keycloak, MinIO; React + TS + Vite, TanStack Router/Query, `openapi-typescript` + `openapi-fetch`, Playwright, Schemathesis, k6 (14:7–22).
6. Роли БД: `migrator`, `api_runtime`, `worker_runtime`, `provisioner`; у API нет DDL (14:81).
7. DB-схемы tenant DB: `org, people, access, modules, files, sched, fleet, finance, audit, outbox` + `core` (10:32); SQL для S1–S2 уже есть: `docs/db/control_0001_init.sql`, `control_0002_billing.sql`, `control_0003_branding.sql`, `tenant_0001_core.sql`, `tenant_0002_fleet.sql` (проверены на PostgreSQL 16.4, конкурентность не прогонялась — 10:9–24).
8. Миграции SPA/склада/кассы/ремонта (0003–0006) — «после расширения OpenAPI» (10:133): эти модули в S3+ (13:139).
9. Пилот — логистика: полная смена водителя + приёмка менеджером (docs/v0.1/README.md:5; 16:38); S2 — 16 историй логистики (13:114–135).
10. `11-permissions.yaml` и OpenAPI расходятся (G-21); `prototype_renames` (11:180–190) — обязательный маппинг при переносе `models.js`.
11. Прототипные ключи `INDUSTRY.*.perms`/`CORE.*.perms` (models.js:24–72) нельзя переносить как есть.
12. 13 из 23 методов `createHttpAdapter` — PROPOSED; ещё ~14 mock-методов без HTTP-аналога (§7.1–7.2) — объём допроектирования контракта до реализации экранов «Подписка и места», «Оформление», «Заявки на тариф», «Тарифная сетка», «Пользователи» (оператор), «Использование».
13. Один вызов прототипа часто = 2–3 операции контракта (`submitDeparture`, `submitReturn`, `publishForm`, `completeAppointment`, `upload`) — учитывать при переносе `api.js` в `apps/web/mocks` (MSW) и в хуки `use*Query` (14:112, 14:123).
14. Перенос доменных функций `compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`, `bookingConflicts` в `packages/domain` + серверная копия в Go (14:121; S0-06).
15. Isolation suite + concurrency suite блокируют merge (14:90; 15:11–12); фикстуры: тенанты A/B, менеджеры Москва-1/2, пользователь с двумя ролями, водитель с попыткой `fleet.earnings.read` через группу (15:21–27).
16. NFR-цели: p95 ≤ 500 мс (список 50 строк/карточка), ≤ 800 мс (команда); ревокация ≤ 5 с; RPO ≤ 15 мин, RTO ≤ 4 ч (02:315–328).
17. `Cache-Control: private, no-store` и `X-Request-Id` — на каждом ответе; middleware должен ставить их централизованно.
18. Исключающее ограничение брони по полю `occupied` (буферы считает сервис, выражение не IMMUTABLE) (docs/README.md:50; 10:101).
19. События outbox именуются `<модуль>.<сущность>.<событие>.v<версия>`; перечень 12:73–85 — минимальный набор consumers (кеш прав, realtime, формы, задачи, календарь, уведомления, касса).
20. Решения D-01…D-12 (16:7–20) нужно закрыть в S0-08; без D-05 (размещение, ПДн) и D-08 (профиль пилота) не начинать S1 (docs/README.md:37).
21. D-09: «Выдача машины без связи — Нет: бронь и выезд только онлайн»; D-10: совмещение водителя и менеджера с начислениями запрещено в v1 (16:17–18).
22. Compose-стенд: `postgres:17`, `minio`, `keycloak` (`realm-ortus.json`, `realm-operators.json`), `mailpit`, `otel-collector`; версии образов закрепить по digest (docker-compose.yml:48).
23. Keycloak: общий realm `ortus` для клиентов + отдельный `ortus-operators` для операторов (17:161; D-03); операторы — почта только в домене платформы (api.js:247 `@ortus.example`; 17:165).
24. `ModuleSettings` типизированы только для `fleet|spa|forms|tasks`; «Additional modules add named schema branches before release» (yaml:8075–8076).
25. `DatasetQuery` v0.1: только AND-фильтры, без join/SQL; агрегации только по видимым строкам (yaml:8448–8450, 8482–8483).
26. Публичные формы: nonce single-use, idempotency namespace tenant+publicToken digest+nonce+operation; `antiAbuseToken` по порогам риска (yaml:9568–9573, 9622–9626).
27. Прототип фиксирует «сегодня» = 01.10.2026 (README.md:163) — сид для e2e должен это учитывать или параметризовать дату.
28. Realtime и уведомления — отдельная допроектировка (G-19); до неё UI-лента событий `db.events` прототипа не имеет серверного источника.
