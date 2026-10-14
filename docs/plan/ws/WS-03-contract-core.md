# WS-03 · Контракт OpenAPI 0.2 core (auth, me, platform, billing, access, files, branding, fleet), `Problem.code` enum, `permissions.yaml`, split по тегам, `make gen`, Spectral, drift-CI, `screens.yaml`, примеры

Волна 0 · Размер L (≈ 4–6 сессий) · Вид `contract` · Зависит от: WS-01 (`00-master-plan.md` §5.1) · Блокирует: WS-15, WS-40, WS-42, WS-51 (DAG §6.1), транзитивно WS-40…50 (§5.1) · Ревью: 2 ревьюера (`orchestration.md` §3: второй — `api/permissions.yaml` по CODEOWNERS, `14-engineering.md:68`) · Slug `contract-core` · `args.ws`: `{ "id": "WS-03", "slug": "contract-core", "pages": [], "reviewers": 2, "suites": ["contract"] }` (§7.2).

## 1. Цель

После WS-03 в `main` лежит единственный источник контракта `api/openapi/ortus.yaml` версии `0.2.0-core`: все 118 операций OpenAPI 0.1 (10 §12 п.1) плюс 34 операции, закрывающие пробелы G-01, G-02, G-09, G-10, G-11, G-18, G-20, G-22 (10 §7.4) в составе, зафиксированном `00-master-plan.md` §4.1 «Core (WS-03, волна 0)» (PD-33); `Problem.code` — enum из 38 кодов реестра `12-errors-and-events.md:28–65` + 5 кодов PD-34; каталог прав `api/permissions.yaml` (77 ключей `11-permissions.yaml` + 16 ключей, без которых линтер «каждый `x-permissions` ∈ каталог» падает на 0.1 — 09 §4.5, §10 п.5); `make gen` детерминированно порождает strict-server по тегам в `backend/internal/api/<tag>/` с `notimpl` 501 (PD-47), TS-клиент `@ortus/api-client`, константы `PERM.*`/`ERR.*` в Go и TS; CI-job `contract` (Spectral + валидатор 3.1 + каталог + enum + ajv на примерах + drift) зелёный. Ничего «нарисованного» этот WS не рендерит: его «точно как нарисовано» — каждая страница §5.3 имеет в `api/openapi/screens.yaml` список операций, а каждый из 41 метода прототипа core-группы (§4.10) имеет операцию с `x-adapter-method`, чтобы WS-51 собрал http-адаптер без допроектирования.

## 2. Границы файлов

### 2.1 Создаёт (владеет; `00-master-plan.md` §3.3)

| Путь | Содержимое |
|---|---|
| `api/openapi/ortus.yaml` | корень: `openapi: 3.1.0`, `info.version: 0.2.0-core`, `tags` (20), `security`, `paths` как `$ref` на `paths/<tag>.yaml`, `x-contract-status`, `x-authorization-order` (yaml:11667–11677 дословно), `x-separation-of-duties` (yaml:11678–11690) |
| `api/openapi/paths/<tag>.yaml` ×20 | `auth, me, platform, billing, access, modules, data, files, branding, tasks, knowledge, calendar, forms, publicforms, fleet, earnings, spa, inventory, cash, repairs` — операции тега (ровно один тег на операцию) |
| `api/openapi/components/{schemas,parameters,headers,responses,securitySchemes}.yaml` | 199 схем 0.1 (10 §6) + новые (§4.2 ниже); параметры yaml:6444–6627; заголовки yaml:6628–6690; ответы yaml:6691–6806 |
| `api/openapi/examples/<operationId>/{ok,empty,<Problem.code>}.json` | рукописные примеры (PD-43), ≥ 2 на операцию |
| `api/openapi/screens.yaml` | «ключ страницы → operationId[]» (§5 ниже), core-часть |
| `api/permissions.yaml` | `11-permissions.yaml` 1:1 + модули `spa`, `inventory`, `cash`, `core.branding` + `prototype_renames` на 23 ключа (09 §4.4) |
| `api/errors.yaml` | реестр кодов: `code → {status, title, ui, retryable, source, prototype[]}` |
| `api/spectral.yaml`, `api/spectral-functions/*.js` | правила §6(г) |
| `api/dist/ortus.bundle.yaml`, `api/dist/components.3.0.yaml`, `api/dist/<tag>.3.0.yaml` ×20 | **генерируются и коммитятся** (входят в drift-проверку; потребители — WS-51 `handlersFromExamples(spec)`, WS-11 не трогает — читалка показывает копию 0.1) |
| `api/CHANGELOG.md`, `api/README.md` | журнал 0.1 → 0.2-core (все неаддитивные правки — только здесь, в волне 0; после — PD-47); команды |
| `tools/gen/{gen.js,split-by-tag.js,downconvert.js,constants.js,examples-check.js,screens-check.js,permissions-check.js,oapi-config.tmpl.yaml,notimpl.go.tmpl}` | конвейер `make gen` / `make contract` |
| `backend/internal/api/models/models.gen.go` | все схемы, один пакет (`generate: models`) |
| `backend/internal/api/<tag>/{api.gen.go,notimpl.gen.go}` ×20 | strict-server + chi по тегу (`import-mapping` на `models`), `NotImplemented` — 501 `not_implemented` |
| `backend/internal/api/perms/perms.gen.go`, `backend/internal/api/codes/codes.gen.go` | константы `PERM.*`, `ERR.*`, `codes.StatusOf(code)`, `codes.All()` |
| `backend/internal/api/apitest/{notimpl_test.go,codes_test.go,perms_test.go}` | рукописные Go-тесты генерации |
| `backend/test/contract/core_skeleton_test.go` | скелет контракта (§6(а2), (а3)); WS-53 позже кладёт рядом Schemathesis-раннер, не трогая этот файл |
| `frontend/packages/api-client/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/client.ts,src/schema.gen.ts,src/perms.gen.ts,src/codes.gen.ts,src/bundle.ts,test/**}` | `openapi-typescript` + фабрика `openapi-fetch`; тесты §6 |
| `docs/plan/evidence/contract-core/{spectral.txt,validate.txt,gen.txt,drift.txt,inventory.json,examples.txt}` | выводы прогонов (evidence для `kind: contract`, §8) |
| `docs/plan/reports/WS-03.md`; строка WS-03 в `docs/plan/status.md` | отчёт `orchestration.md` §5; своя строка |

### 2.2 Запрещено трогать

`design/**` (эталон); `docs/plan/analysis/**`, `decisions.md` (WS-00); `Makefile`, `package.json` корня, `.github/**`, `backend/go.mod`, `backend/.golangci.yml`, `CODEOWNERS` (WS-01); `backend/internal/platform/**`, `backend/cmd/**` (WS-40/41); `frontend/packages/{domain,adapter,ui,tokens,texts}/**` (WS-04…08); `frontend/apps/**`. Три точки стыка, которые правит **только интегратор** по заявке в отчёте (раздел «Контракты, которые я изменил»): (1) `Makefile`: `gen: ; node tools/gen/gen.js` и `contract: ; node tools/gen/gen.js --check` (если заглушка WS-01 не делегирует); (2) корневой `package.json`: скрипт `"contract": "node tools/gen/gen.js --check"` и `"gen:api": "node tools/gen/gen.js"`; (3) `backend/go.mod`: `github.com/oapi-codegen/runtime`, `github.com/go-chi/chi/v5` (если нет), `github.com/getkin/kin-openapi` — единственная заявка на зависимости, подать в первый день (12 §5 п.28). Тело CI-job `contract` = `pnpm contract` — текст шага приложить к отчёту, файл `.github/workflows/ci.yml` правит интегратор.

### 2.3 Worktree, ветка, окружение (Windows, `00-master-plan.md` §0.2, §7.4)

```powershell
git -C D:\work\test26042026_Kirill_3.0 worktree add ..\ortus-ws-03 -b ws/ws-03-contract-core main
cd D:\work\ortus-ws-03; pnpm install          # pnpm 9, Node 22 (PD-38); в каждом worktree отдельно
go -C backend version                          # Go последний стабильный (PD-38)
```

Порт исполнителя `5173 + 03 = 5176` не используется (dev-сервера нет); MCP-инстанс не нужен (§8.1: для `contract` MCP «—»). PowerShell 5.1: без `&&`, сообщения коммитов через `git commit -F <файл>` без BOM (12 §6 п.22), `.gitattributes eol=lf`. Коммиты Conventional Commits, первый — `test(api): …` (12 §6 п.21).

## 3. Входы

| Источник | Что брать |
|---|---|
| `design/docs/v0.1/ortus-openapi-v0.1.yaml` (11 691 строка) | база: `paths` :66–6429, `components` :6430–11665, `x-authorization-order` :11667–11677, `x-separation-of-duties` :11678–11690 |
| 10 §4 «Общие правила контракта» | базовые пути, параметры, заголовки, наборы кодов R/C/U/P/PU/Pub (10 §4 «Легенда»), `Problem` (yaml:6890–6935) |
| 10 §5.1–5.19 | каталог 118 операций по тегам с `x-permissions`, `x-scope`, Idem/If-Match, строками YAML — проверочная таблица для теста инвентаря |
| 10 §6.1–6.11 | 199 схем, enum, required — для `components/schemas.yaml` и примеров |
| 10 §7.3 | экран → операции (основа `screens.yaml`); 10 §7.4 — пробелы G-01…G-22 (закрываем G-01, G-02, G-09, G-10, G-11, G-18, G-19 частично, G-20, G-22) |
| 10 §8 | статус auth-поверхности (всё ❌ — проектируем тег `auth`) |
| 10 §9 п.1–2, 7–11, 18, 23, 27 | инварианты, которые контракт обязан выражать (порядок проверок, 404, `additionalProperties: false`, Idempotency, If-Match, `Cache-Control`, 86 ключей прав) |
| 10 §10 A–H | чек-лист приёмки API-уровня → скелет §6(а3) |
| 10 §11 Q1–Q16 | открытые вопросы → §10 |
| 09 §4.2–4.6 | 77 ключей каталога (подписи дословно), шаблоны ролей, `prototype_renames` (10) + 13 ключей без соответствия, 14 ключей OpenAPI вне каталога + `branding.read/manage`, 4 словаря областей |
| 09 §5.1–5.3 | форма `Problem`, 36 строк реестра (38 кодов) дословно с колонкой «Что делает интерфейс», коды вне реестра, таблица «код прототипа → канон» |
| 07 §6, §7 | коды `ApiError` мока → канон (18 кодов); `createHttpAdapter` → пути 0.1 и PROPOSED (23 метода, 17 без HTTP-аналога) |
| 04 §9 Q1–Q3 | создание организации (нет UI → backend-only, PD-48), «Причина» (нет поля → backend-only), статусы тенанта (PD-35) |
| `design/docs/17-users-and-billing.md:132–153` | 16 PROPOSED-путей платформы/подписки и 3 кода (`seats_exhausted`, `request_pending`, `tier_below_usage`) |
| `design/docs/18-branding.md:77–83` | 5 PROPOSED-путей оформления, права `branding.manage`/`branding.read` |
| `design/docs/11-permissions.yaml` | копируется в `api/permissions.yaml` целиком (структура `modules.<key>.actions.<action>: {level,label,scopes,sensitivity,note}`, `role_templates`, `prototype_renames`) |
| `design/docs/14-engineering.md:24–61, 108–115` | структура `api/`, поток контракта, конвейер CI, соглашения (маппинг ошибок «в одном месте») |
| `00-master-plan.md` §4.1, §4.2, §4.10, §3.3, §7.4, §8.1 (строка `contract`), §8.4 (`contract`), §10.3 PD-33, PD-34, PD-35, PD-47; PD-17, PD-18, PD-43 | состав, правила после волны 0, карта методов → операции → владельцы |
| `decisions.md` | Q-01, Q-02, Q-04, Q-11, Q-16, Q-21, Q-45, Q-49, Q-82, Q-83, Q-84, Q-89, Q-90, Q-92, Q-94, Q-95, Q-96 (поведение по умолчанию — §10) |
| 12 §6 п.17–18 | тесты дрейфа и формы ошибки (дословно) |

## 4. Контракты

### 4.1 Что публикует WS-03 (потребители: WS-05 `errors/map.ts`, `renames.ts`; WS-15; WS-40…50; WS-51; WS-53)

**Новые операции 0.2-core (34).** Префикс путей `/api/v1`. «Idem» — заголовок `Idempotency-Key` обязателен; «IM» — `If-Match` обязателен (+ ответы 412 `revision_mismatch`, 428 `revision_required`); колонка «Коды» — значения `x-problem-codes` сверх базового набора R (10 §4 «Легенда»); `x-adapter-method` — метод прототипа (§4.10 мастер-плана).

| Тег | Метод, путь | operationId | `x-permissions` · `x-scope` | Тело → ответ | Idem/IM | Коды | `x-adapter-method` |
|---|---|---|---|---|---|---|---|
| auth | GET `/auth/login?returnTo=` | `startLogin` | `[]` · `public`, `security: []` | — → 302 `Location` (IdP; при `AUTH_PROVIDER=dev` → `/auth/dev`) | — | 400 | — |
| auth | GET `/auth/callback?code=&state=` | `authCallback` | `[]` · `public`, `security: []` | — → 302 `Location: returnTo` + `Set-Cookie: ortus_sid` | — | 400, 401 `session_expired` (state истёк) | — |
| auth | POST `/auth/logout` | `logout` | `[]` · `identity` | — → 204 (cookie сброшена) | — (CSRF) | 401, 403 `csrf_failed` | — |
| auth | GET `/auth/csrf` | `getCsrf` | `[]` · `identity` | — → 200 `CsrfToken {csrfToken}` + cookie `ortus_csrf` без `HttpOnly` (12 §6 п.24) | — | 401 | — |
| auth | POST `/auth/invitations/{invitationToken}/accept` | `acceptInvitation` | `[]` · `identity` | `{}` → 200 `MeContext` | Idem | 404, 403 `forbidden_action` (почта сессии ≠ почте приглашения), 409 `invalid_transition` (принято/отозвано), 410 `public_token_expired` | — |
| auth | POST `/auth/dev/login` | `devLogin` | `[]` · `public`, `security: []`, `x-dev-only: true` | `DevLogin {accountId?, email?, tenantId?}` → 204 + `Set-Cookie: ortus_sid` | — | 404 `not_found` при `AUTH_PROVIDER≠dev`, 422 | `setActor` |
| me | POST `/me/select-tenant` | `selectTenant` | `[]` · `identity` | `{tenantId}` → 200 `MeContext` (`lastTenantId` обновлён) | — (CSRF) | 404 (не член) | `setActor` |
| me | GET `/me/events?tenantId=&cursor=&limit=` | `listMyEvents` | `[]` · `identity` | → 200 `MyEventPage {items[{id, at, text, kind, tenantId, sensitive?, read}], nextCursor}` | — | 404 | `load` |
| platform | GET `/platform/usage` | `getPlatformUsage` | `platform.tenants.read` · `platform` | → 200 `PlatformUsage {summary{seatsUsed, seatsLimit, storageUsedBytes, storageQuotaBytes, accountsActive, accountsTotal}, signals[{tenantId, kind, text, tone}], modules[{moduleKey, tenantCount}], rows[{tenantId, name, status, seatsUsed, seatsLimit, storageUsedBytes, storageQuotaBytes, moduleKeys}]}` | — | — | `load` |
| platform | GET `/platform/subscription-requests?status=&cursor=&limit=` | `listSubscriptionRequests` | `platform.billing.read` · `platform` | → 200 `SubscriptionRequestPage` | — | — | `load` |
| platform | POST `/platform/subscription-requests/{requestId}/decision` | `decideSubscriptionRequest` | `platform.billing.manage` · `platform` | `SubscriptionRequestDecision {decision: approve\|reject, note?}` → 200 `SubscriptionRequest` | Idem + IM | 409 `invalid_transition` («Заявка уже рассмотрена или отменена»), 422 `validation_failed` (`violations[{field: note, code: required, message: «Укажите причину отказа»}]`) | `decideSeatRequest` |
| platform | GET `/platform/price-book/versions` | `listPriceBookVersions` | `platform.billing.read` · `platform` | → 200 `PriceBookVersionList {currentVersion, scheduledVersion, items[PriceBookVersion]}` | — | — | `load` |
| platform | POST `/platform/price-book/versions` | `publishPriceBookVersion` | `platform.pricing.manage` · `platform` | `PriceBookVersionCreate {tiers[{code, name, seatsLimit?, monthlyPrice?: Money}], terms[{months: 1\|4\|8\|12, discountPct 0–49}], effectiveFrom: date, note?}` → 201 `PriceBookVersion` | Idem | 422 `validation_failed` (9 правил `validateDraft`, 07 §4.2 — по `violations`), 409 `invalid_transition` («Уже запланирована версия vN…») | `publishPriceBook` |
| platform | DELETE `/platform/price-book/versions/scheduled` | `cancelScheduledPriceBookVersion` | `platform.pricing.manage` · `platform` | → 204 | Idem | 409 `invalid_transition` («Запланированной версии нет») | `cancelScheduledPriceBook` |
| platform | POST `/platform/users/{accountId}/lock` | `lockPlatformAccount` | `platform.users.manage` · `platform` | `AccountLock {locked, reason?}` → 200 `PlatformUser` | Idem + IM | 422 `validation_failed` (`reason` при `locked=true`, «Укажите причину блокировки») | `setAccountLock` |
| platform | POST `/platform/users/{accountId}/mfa-reset` | `resetPlatformAccountMfa` | `platform.users.manage` · `platform` | — → 200 `PlatformUser` | Idem | — | `resetMfa` |
| platform | GET `/platform/operators?cursor=&limit=` | `listPlatformOperators` | `platform.users.read` · `platform` | → 200 `PlatformOperatorPage` | — | — | `load` |
| platform | POST `/platform/operators` | `inviteOperator` | `platform.operators.manage` · `platform` | `OperatorInvite {displayName, email, role: owner\|admin\|billing\|support}` → 201 `PlatformOperator` | Idem | 422 `validation_failed` (`role=owner` → «Владельцем платформы назначают уже работающего оператора»; домен → «Оператором может быть только сотрудник платформы: почта в домене ortus.example»; дубликат → `violations[{field: email, code: already_exists}]`) | `inviteOperator` |
| platform | PATCH `/platform/operators/{operatorId}` | `updateOperator` | `platform.operators.manage` · `platform` | `OperatorPatch {role?, status?: active\|disabled}` → 200 `PlatformOperator` (invited + disabled → удаление, 204) | Idem + IM | 409 `invalid_transition` (себя), 409 `last_owner_required`, 422 `validation_failed` (владельцем — только активный со вторым фактором) | `setOperatorRole`, `setOperatorStatus` |
| platform | GET `/platform/audit?cursor=&limit=` | `listPlatformAudit` | `platform.tenants.read` · `platform` | → 200 `PlatformAuditPage {items[{id, at, text, actor}]}` | — | — | `load` |
| billing | POST `/tenants/{tenantId}/subscription/requests` | `createSeatRequest` | `billing.manage` · `tenant-owner` | `SeatRequestCreate {tierCode, termMonths, comment?}` → 201 `SubscriptionRequest` | Idem | 409 `request_pending`, 422 `tier_below_usage`, 422 `validation_failed` («Выберите тариф») | `requestSeats` |
| billing | POST `/tenants/{tenantId}/subscription/requests/{requestId}/cancel` | `cancelSeatRequest` | `billing.manage` · `tenant-owner` | — → 200 `SubscriptionRequest` | Idem | 409 `invalid_transition` («Заявка уже рассмотрена») | `cancelSeatRequest` |
| billing | GET `/price-book/current` | `getPriceBookCurrent` | `[]` · `identity` | → 200 `PriceBookVersion` | — | — | `load` |
| access | DELETE `/tenants/{tenantId}/invitations/{invitationId}` | `revokeInvitation` | `members.invite` · `tenant-or-org-unit` | → 204 | Idem | 409 `invalid_transition` («Приглашение уже принято или отозвано») | `revokeInvite` |
| access | GET `/tenants/{tenantId}/groups?cursor=&limit=` | `listGroups` | `members.read` · `tenant-or-org-unit` | → 200 `GroupPage {items[{id, name, memberIds, revision}], nextCursor}` | — | — | `load` |
| access | POST `/tenants/{tenantId}/access/explain` | `explainAccess` | `roles.read` · `tenant` | `AccessQuery {memberId, action, object?: ObjectRef}` → 200 `AccessExplanation {allowed, denyCode?: module_not_installed\|module_read_only\|forbidden_action\|not_found\|function_blocked, grant?: {roleId, roleName, scope, viaGroupId?}, moduleKey?}` | — (CSRF, `x-read-only-post: true`) | — | — (локальная «Проверка доступа» в фазе 1, Q-83) |
| files | GET `/tenants/{tenantId}/files?purpose=&owner=&cursor=&limit=` | `listFiles` | `files.read` · `owning-object-and-field-scope` | → 200 `FilePage` | — | — | `load` |
| branding | GET `/tenants/{tenantId}/branding` | `getBranding` | `branding.read` · `tenant` | → 200 `Branding` (+ `ETag` = `version`) | — | — | `load` |
| branding | PUT `/tenants/{tenantId}/branding` | `putBranding` | `branding.manage` · `tenant-owner` | `BrandingUpdate` → 200 `Branding` | Idem + IM | 422 `validation_failed` (4 сообщения 07 §4.3 как `violations`) | `saveBranding` |
| branding | POST `/tenants/{tenantId}/branding/files` | `uploadBrandingFile` | `branding.manage` · `tenant-owner` | multipart `{kind: logo\|mark, file}` → 201 `BrandingFile {fileId, url, kind, contentType, sizeBytes}` | Idem | 422 `validation_failed` (`violations[{field: file, code: unsafe_svg}]`), 413 `payload_too_large` | `saveBranding` |
| branding | GET `/public/branding/{slug}` | `getPublicBranding` | `[]` · `public`, `security: []` | → 200 `PublicBranding {name, shortName, accent, markUrl?}` | — | 404 | — |
| fleet | POST `/tenants/{tenantId}/fleet/trips/{tripId}/vehicle` | `assignTripVehicle` | `fleet.routes.manage` · `tenant-or-org-unit` | `TripVehicleAssign {vehicleId}` → 200 `Trip` | Idem + IM | 409 `vehicle_incompatible` (`violations[]` — причины через «; »), 409 `reservation_overlap` | `assignVehicle` |
| fleet | POST `/tenants/{tenantId}/fleet/inspections/{inspectionId}/defect-decision` | `decideInspectionDefect` | `fleet.inspections.review` · `responsible-manager-or-owner` | `DefectDecision {decision: allow\|deny, comment?}` → 200 `Inspection` | Idem + IM | 409 `invalid_transition` | `decideDefect` |
| fleet | POST `/tenants/{tenantId}/fleet/trips/{tripId}/finish-route` | `finishTripRoute` | `fleet.trips.return` · `tenant-org-unit-self` | — → 200 `Trip` (`status: returning`) | Idem + IM | 409 `invalid_transition` | `finishRoute` |

**Изменения существующих операций и схем 0.1 (неаддитивные допустимы только сейчас — PD-47; каждое — строка `api/CHANGELOG.md`):**

| Что | Изменение | Источник |
|---|---|---|
| Теги | имена → slug пакетов: `Context`→`me`, `PublicForms`→`publicforms`, остальные в нижний регистр; `description` сохраняется | §3.3 (`internal/api/<tag>/`), §4.1 «Тег» |
| `Problem` | `code` → `$ref: ProblemCode` (enum 43 значения из `api/errors.yaml`); `+ retryable?: boolean` (DP-01) | 09 §5.1; PD-34 |
| `MeContext` | `+ lastTenantId?: Id\|null`, `+ operator?: {id, role, permissions[]}`; `tenants[]` уже есть | §4.1 «me», PD-48, S1-07 |
| `TenantContext` | `+ tenantStatus: TenantStatus` (для баннеров `bannersVM`, 09 §5.4) | PD-35 |
| `Tenant.status` | enum → `provisioning\|trial\|active\|grace\|read_only\|suspended\|closing\|closed`; `+ trialEndsAt?`, `+ branding?: {shortName, accent, markUrl?}` | PD-35; Q-01 |
| `TenantPatch` | `status ∈ active\|suspended` без изменений; `reason` 5–500 остаётся обязательным при смене статуса (Q-04 — backend-only; демо передаёт «Демо-режим») | 04 §9 Q2 |
| `Subscription` | `+ trialEndsAt?`, `+ seats {limit?: int\|null, used, invited}`, `+ storageQuotaBytes`, `+ priceBookVersion`, `+ termMonths?`, `+ paidUntil?`, `+ requests: SubscriptionRequest[]` (новые первыми) | 17:136; 02 §7 |
| `PlatformSubscriptionUpdate` | `+ trialEndsAt?` (= `extendTrial`), `manualEntitlements[].key` enum `seats\|storage_quota_bytes` (= `setTenantQuota`); `x-adapter-method: [extendTrial, setTenantQuota, setTenantStatus]` | §4.10 |
| `listPlatformUsers` / `PlatformUser` | query `q`, `filter ∈ all\|locked\|no_mfa\|pending`, `tenantId`; `status` enum `+ locked`; `+ mfaEnabled`, `+ lastLoginAt?`, `+ lockReason?`, `+ memberships[{tenantId, tenantName, status: invited\|active\|suspended\|ended, owner}]` | 04 §6.1 `accounts[]`; 17:143 |
| `inviteMember` / `InvitationCreate` / `Invitation` | `+ 409 seats_exhausted`; `+ 422 validation_failed` с `violations[{field: email, code: already_exists}]` («Участник с таким адресом уже есть»); `InvitationCreate.displayName`; `Invitation.memberId` | 07 §4.4; 17:153 |
| `createAssignment` | `+ 409 separation_of_duties_conflict` (уже в yaml:11688), `+ 409 delegation_exceeds_grant`; `x-adapter-method: assign` | 09 §5.2 |
| `revokeAssignment` | `+ 409 last_owner_required`; `x-adapter-method: unassign` | 09 §5.2 |
| `Role` / `createRole` / `updateRole` | `Role + kind: system\|custom`, `+ workFunction?: driver\|foreman\|null`; `updateRole + 403 forbidden_action` (системная), `+ 409 separation_of_duties_conflict`; `ETag = current_version` (Q-92); `RoleCreate + sourceRoleId?` (клон на сервере — Q, по умолчанию клон на клиенте §4.10) | 07 §4.4 |
| `reviewTrip` / `TripReview` | `decision ∈ approve\|reject\|maintenance_required\|rework`; `+ comment?`, `+ steps?: string[1..20]` (подписи разделов, 03 §7.5); `rework` без `comment` → 422 `validation_failed` («Опишите, что нужно исправить»), без `steps` → («Отметьте хотя бы один раздел для доработки»); `+ 409 invalid_transition` («Смена уже обработана»); `x-adapter-method: reviewTrip` (приёмка + `setTripEarnings` в одной команде мока, Q-55) | 03 §7.5; G-11 |
| `Trip` | `status` → 9 состояний `TRIP_STATE`: `planned\|assigned\|inspection\|defect_review\|on_route\|returning\|submitted\|rework\|accepted` (Q-45; 07 §8.7); `+ title?`, `+ routeId?`, `+ reservationId?`, `+ plannedWindow?`, `+ distanceKm?`, `+ review?: {decision, comment?, steps?, at}`, `+ defect?`; `departureInspectionId` становится optional (рейс существует до `startTrip`); `listTrips + status` фильтр | 10 §11 Q4–Q5 |
| `Vehicle` | `+ heldByTripId?`, `+ note?`; enum `status` 0.1 без изменений (маппинг `VEHICLE_STATE` — WS-51) | 07 §8.7 |
| `startTrip` | описание: переводит существующий `Trip` `inspection → on_route`; `+ 409 blocking_defect_open` (есть в реестре) | 10 §9 п.13 |
| Коды в описаниях 0.1 вне реестра | `plan_required` → `feature_requires_plan`; `file_not_ready` → `photo_not_ready`; `driver_unavailable` → `resources_unavailable`; `form_version_changed` → `invalid_transition` (описание `PublicResponseCreate`) | 10 §4 «Коды в YAML» |
| Все операции | `+ x-problem-codes: [...]` (полный список кодов, которые операция может вернуть) и `+ x-adapter-method` (строка или массив) там, где есть метод прототипа (§4.10); `x-revisioned: true` на 26 + новых операциях с `If-Match` | §4.1 «общее» |
| `securitySchemes.sessionCookie.name` | `ortus_sid` (12 §6 п.23; WS-40); описание: в production с префиксом `__Host-` через конфигурацию | PD-18 |
| `x-scope` | словарь в `api/spectral.yaml`: 27 значений 10 §5.19 + `public` (= 28) | Q-96 |

**Каталог прав `api/permissions.yaml` (93 ключа = 77 + 16).** Новые модули (подписи — по образцу `VERBS` прототипа, помечены `# PROPOSED: подпись не из источников`): `spa` (`industry: true`): `spa.services.read` view «Видеть услуги», `spa.services.manage` settings «Вести услуги», `spa.appointments.read` view «Видеть визиты», `spa.appointments.create` create «Записывать клиентов», `spa.appointments.perform` edit «Отмечать выполнение», `spa.appointments.complete` review «Завершать с учётом материалов»; `inventory`: `inventory.items.read`, `inventory.items.manage`, `inventory.movements.read`, `inventory.movements.post`, `inventory.consume`; `cash`: `cash.read` view «Видеть кассу» (sensitive), `cash.manage` settings «Вести счета», `cash.post` create «Проводить операции»; `core.branding`: `branding.read` view «Видеть оформление» (scopes `[tenant]`), `branding.manage` settings «Менять оформление» (`owner_only`, 18:83). `prototype_renames` дополняется 13 строками 09 §4.4: `tasks.manage: [tasks.update, tasks.transition]`, `forms.responses.create: null` (ответ создаёт сервер, 09 §4.3), `inventory.read: [inventory.items.read, inventory.movements.read]`, `inventory.movements.post: inventory.movements.post`, `cash.read: cash.read`, `cash.operations.create: cash.post`, `spa.appointments.read: spa.appointments.read`, `spa.appointments.create: spa.appointments.create`, `spa.services.manage: spa.services.manage`, `spa.completion.review: spa.appointments.complete`, `spa.export: data.export`, `spa.settings: modules.settings.manage`, `repairs.export: data.export`, `repairs.settings: modules.settings.manage`. Остальные ключи G-21 (`forms.responses.assign`, `cash.refund`, `cash.adjust`, `inventory.consumption.override`, `repairs.finance.read`) — WS-15.

**Реестр `api/errors.yaml` (43 кода).** 38 кодов из 36 строк `12-errors-and-events.md:28–65` (две строки содержат по два кода: `csrf_failed`/`origin_not_allowed`, `public_token_expired`/`nonce_used`) + `seats_exhausted` 409, `request_pending` 409, `tier_below_usage` 422, `upload_failed` 0 (клиентский, `status: null`, в HTTP не возвращается), `not_implemented` 501 (PD-34). Поля записи: `status`, `title` (дословно колонка «Когда»), `ui` (колонка «Что делает интерфейс»), `retryable` (true для `reservation_overlap`, `resources_unavailable`, `idempotency_in_progress`, `rate_limited`, `dependency_unavailable`), `source` (`12:NN`), `prototype` (коды мока по 07 §6, например `reservation_overlap: [conflict]`, `validation_failed: [validation]`, `tenant_read_only: [subscription_restricted]`).

**Генерируемые артефакты.** Go: `models.ProblemCode` (тип + 43 константы `ProblemCodeReservationOverlap…`), `codes.StatusOf(c) (int, bool)`, `perms.FleetTripsReview = "fleet.trips.review"` (93 константы), `<tag>.StrictServerInterface`, `<tag>.NotImplemented{}` (все методы → `models.Problem{Code: not_implemented, Status: 501, Type: "https://docs.ortus.example/errors/not_implemented", Title: "Не реализовано", RequestId: <из контекста или "">}`), `<tag>.Handler(si, opts)` на chi. TS: `paths`/`components` (`openapi-typescript`), `createClient<paths>({baseUrl})` обёртка `createApiClient({baseUrl, fetch, headers})`, `PERM` и `ERR` `as const`, `BUNDLE` — JSON бандла (`src/bundle.ts`, для MSW WS-51 и `screens.test.ts`).

**`api/openapi/screens.yaml`** — формат `screens: { <key>: { ws: 'WS-NN', operations: [operationId…] } }`; содержимое — §5.

### 4.2 Что потребляет

Только WS-01: `pnpm`-workspace (`frontend/packages/*` подхватывается `pnpm-workspace.yaml`), `backend/go.mod`, ESLint/Prettier, Makefile-заглушки `gen`/`contract`. Если на старте `Makefile` или корневой `package.json` не содержат делегирования — работать через `node tools/gen/gen.js` напрямую и записать заявку интегратору; ничего не ждать. Домен (WS-05) и адаптер (WS-06) не нужны: список методов прототипа для теста `x-adapter-method` берётся из фикстуры `frontend/packages/api-client/test/fixtures/adapter-methods.json` (41 имя core-группы по §4.10; WS-15 переключит на импорт `AdapterPort` из `@ortus/domain`).

## 5. Экраны, диалоги, состояния

У WS-03 нет страниц (`pages: []`): ничего не рендерится, e2e Playwright и MCP-проходка не применяются (`00-master-plan.md` §8.1, колонка `contract`). Вместо таблицы экранов — содержимое `api/openapi/screens.yaml` (core-часть): ключ §5.3 → дословная подпись пункта меню (10 §7.3) → персонажи → операции 0.2-core, которые страница вызывает в http-режиме → WS-владелец страницы. Delta-операции (WS-15) не включаются. Маршрут URL — §4.7 мастер-плана (PD-25).

| Ключ | Подпись (10 §7.3) | Персонажи | Операции core | WS |
|---|---|---|---|---|
| `shell` | — (оболочка, 01 §8) | все | `getMyContext`, `selectTenant`, `listMyEvents`, `getBranding`, `getCsrf`, `startLogin`, `authCallback`, `logout`, `devLogin` | WS-10 |
| `home` | «Главная» | owner, manager, owner@t-lotos | `getMyContext`, `listTrips`, `listInspections`, `listDriverTransfers`, `listAppointments`, `listWorkLogs`, `getTenantSubscription`, `getStorageUsage`, `listMembers`, `listAssignments`, `listTasks`, `listMyEvents` | WS-24 |
| `modules` | «Модули и место» | owner | `listModuleCatalog`, `getModuleInstallation`, `setModuleInstallation`, `getModuleSettings`, `updateModuleSettings`, `getStorageUsage`, `requestStorageChange`, `listAssignments` | WS-20 |
| `users` | «Пользователи и роли» | owner | `listMembers`, `getMember`, `updateMember`, `inviteMember`, `revokeInvitation`, `listGroups`, `listRoles`, `getRole`, `createRole`, `updateRole`, `deleteRole`, `listAssignments`, `createAssignment`, `revokeAssignment`, `listOrgUnits`, `explainAccess` | WS-20 |
| `billing` | «Подписка и места» | owner | `getTenantSubscription`, `getPriceBookCurrent`, `createSeatRequest`, `cancelSeatRequest`, `revokeInvitation`, `listMembers` | WS-20 |
| `branding` | «Оформление» | owner | `getBranding`, `putBranding`, `uploadBrandingFile` | WS-21 |
| `fleet` | «Рабочее место логиста» | owner, manager | `listVehicles`, `createVehicle`, `listTrips`, `getTrip`, `listRoutes`, `createRoute`, `listReservations`, `reserveVehicle`, `releaseReservation`, `listInspections`, `getInspection`, `reviewInspection`, `decideInspectionDefect`, `assignTripVehicle`, `listTripExpenses`, `reviewTripExpense`, `getTripEarnings`, `setTripEarnings` | WS-22 |
| `pool` | «Ресурсный пул» | owner, manager | `listAvailableDrivers`, `requestDriverTransfer`, `listDriverTransfers`, `getDriverTransfer`, `decideDriverTransfer`, `listTrips` | WS-22 |
| `review` | «Приёмка смен» | owner, manager | `listTrips`, `getTrip`, `getInspection`, `listTripExpenses`, `getFileDownload`, `reviewTrip`, `reviewTripExpense`, `setTripEarnings`, `decideInspectionDefect` | WS-22 |
| `today` | «Сегодня» | driver | `getMyContext`, `listTrips`, `getTrip`, `listReservations`, `releaseReservation`, `listRoutes`, `getInspectionChecklist`, `initiateUpload`, `completeUpload`, `getFile`, `submitInspection`, `startTrip`, `finishTripRoute`, `listTripExpenses`, `createTripExpense`, `returnTrip` | WS-23 |
| `cars` | «Автомобили» | driver | `listVehicles`, `reserveVehicle`, `listTrips` | WS-23 |
| `forms` | «Формы и опросы» | owner, manager | `listForms`, `getForm`, `createForm`, `updateForm`, `listFormVersions`, `createFormVersion`, `publishFormVersion`, `listFormResponses`, `getFormResponse`, `reviewFormResponse` | WS-25 |
| `tasks` | «Задачи» | все | `listTaskProjects`, `createTaskProject`, `listTasks`, `getTask`, `createTask`, `updateTask`, `transitionTask` | WS-26 |
| `calendar` | «Календарь» | все | `findCalendarAvailability`, `listCalendarBookings`, `getCalendarBooking`, `createCalendarBooking`, `updateCalendarBooking` | WS-29 |
| `knowledge` | «База знаний» | все | `listKnowledgePages`, `getKnowledgePage`, `createKnowledgePage`, `updateKnowledgePage` | WS-29 |
| `data` | «Данные» | owner, manager | `listDatasets`, `queryDataset` | WS-29 |
| `files` | «Файлы» | owner, manager | `listFiles`, `getFile`, `getFileDownload`, `getStorageUsage` | WS-29 |
| `spa` | «Салон и SPA» / «Мой день» | owner, therapist | `listSpaServices`, `createSpaService`, `listAppointments`, `getAppointment`, `createAppointment`, `recordAppointmentPerformance`, `completeAppointment`, `listInventoryItems`, `listInventoryMovements`, `postInventoryMovement` | WS-30 |
| `cash` | «Касса» (в §5.3 — «Внутренняя касса») | owner | `listCashAccounts`, `createCashAccount`, `listCashOperations`, `postCashOperation` | WS-30 |
| `repair` | «Объекты» | owner, foreman | `listRepairProjects`, `createRepairProject`, `listWorkLogs`, `submitWorkLog`, `initiateUpload`, `completeUpload`, `getFile` | WS-31 |
| `repair-tabs` | вкладки «Ремонт и стройка» (06b) | owner, foreman | `[]` (локальное состояние, 06b §20; операции — WS-15) | WS-32 |
| `tenants` | «Организации» | operator | `listPlatformTenants`, `getPlatformTenant`, `updatePlatformTenant`, `getPlatformSubscription`, `updatePlatformSubscription`, `listPlatformAudit` | WS-27 |
| `usage` | «Использование» | operator | `getPlatformUsage` | WS-27 |
| `requests` | «Заявки на тариф» | operator | `listSubscriptionRequests`, `decideSubscriptionRequest`, `listPriceBookVersions` | WS-27 |
| `accounts` | «Пользователи» | operator | `listPlatformUsers`, `lockPlatformAccount`, `resetPlatformAccountMfa`, `listPlatformOperators`, `inviteOperator`, `updateOperator` | WS-28 |
| `plans` | «Тарифная сетка» | operator | `listPriceBookVersions`, `publishPriceBookVersion`, `cancelScheduledPriceBookVersion` | WS-28 |
| `modal-confirm`, `modal-sheet` | диалог подтверждения, лист «Все разделы» | все | `[]` | WS-10 |
| `modal-assign` | «Назначить роль» | owner | `createAssignment`, `listRoles`, `listOrgUnits` | WS-14 |
| `modal-invite` | «Пригласить участника» | owner | `inviteMember`, `listRoles`, `getTenantSubscription` | WS-14 |
| `modal-createRole` | «Создать роль» | owner | `createRole`, `listRoles` | WS-14 |
| `modal-request` | «Запросить водителя» | manager | `listAvailableDrivers`, `requestDriverTransfer` | WS-22 |
| `docs-start`, `docs-search`, `docs-api`, `docs-permissions`, `docs-frames`, `docs-layout` | читалка документации | — | `[]` (нет API; `docs-api` показывает копию 0.1 — 11 §6.3) | WS-11 |

Итого 38 ключей (24 `pg.*` + `repair-tabs` + `shell` + 6 модалок + 6 `docs-*`), ровно список §4.8 мастер-плана.

## 6. Тесты первыми

Порядок по `tdd-protocol.md` §2 для `kind: contract` (§8.1): шаг 1 — скелет (`screens.test.ts` красный до операций + Go-скелет контракта с `t.Skip`); шаг 3 — контрактные проверки (Spectral, валидатор, каталог, enum, ajv, drift); unit — на инструменты генерации. Имена тестов — на русском, формулировка из источника (`tdd-protocol.md` §3).

### (а) Скелет — 111 пунктов

**(а1) `frontend/packages/api-client/test/screens.test.ts` — 38 реальных красных тестов** (один `test()` на ключ таблицы §5; падают на утверждении `expect(missing).toEqual([])`, пока в бандле нет операции; импорт бандла через `src/bundle.ts`, который до `make gen` экспортирует `null` → тест падает «по делу», а не по импорту). Имя теста: `ключ «<key>»: операции <op1, op2, …> существуют в api/dist/ortus.bundle.yaml`. Плюс два сводных: `все 38 ключей §5.3 присутствуют в screens.yaml` и `каждый из 41 метода прототипа core-группы имеет ≥ 1 операцию с x-adapter-method` (фикстура `adapter-methods.json`). Сводные не входят в число 38 — они в §6(б).

**(а2) `backend/test/contract/core_skeleton_test.go` — 34 `t.Skip` по одному на новую операцию** (`TestOp_startLogin`, `TestOp_authCallback`, … `TestOp_finishTripRoute` в порядке таблицы §4.1). Текст skip: `t.Skip("скелет WS-03: контракт <operationId> — снимает WS-NN")` с владельцем по §4.10 (`auth`/`me` → WS-40; `platform` → WS-43/WS-67; `billing`, `branding` → WS-67; `access` → WS-44; `files` → WS-45; `fleet` → WS-46/47). Каждый тест после снятия обязан проверить: тело запроса по схеме, все коды `x-problem-codes`, заголовки `X-Request-Id`/`Cache-Control: private, no-store`, `Idempotency-Replayed` для Idem-операций (§8.3 мастер-плана).

**(а3) там же — 39 `t.Skip` по чек-листу 10 §10 (API-уровень; дословно Given/When/Then, селекторы не нужны — это HTTP), имя `TestAcc_<буква><номер>`:**

| # | Пункт 10 §10 (дословно) | Снимает |
|---|---|---|
| A1 | Given неавторизованный браузер, When `GET /api/v1/me/context`, Then 401 с `application/problem+json`, `code` = `session_expired` (12:32), заголовок `X-Request-Id` присутствует. | WS-40 |
| A2 | Given сессия с cookie, When POST-мутация без `X-CSRF-Token`, Then 403, `code ∈ {csrf_failed, origin_not_allowed}` (12:40; yaml:6655–6657). | WS-40 |
| A3 | Given cookie и `Authorization: Bearer …` одновременно, When любой запрос, Then отказ (yaml:6443 «Do not send this cookie with a bearer token»). | WS-40 |
| A4 | Given любой 2xx-ответ API, Then `Cache-Control: private, no-store` и `X-Request-Id` (yaml:85–89). | WS-40 |
| A5 | Given публичная форма, When `GET /api/v1/public/forms/{publicToken}` без cookie, Then 200 `PublicForm` с `submissionNonce`; When тот же токен на `GET /api/v1/tenants/{tenantId}/fleet/vehicles`, Then 401/404 (AC-08, 15:42). | WS-60 |
| B1 | Given менеджер фирмы A, When запросы к объектам фирмы B, Then 404 `not_found`, «время ответа не различается заметно» (AC-01; 15:35). | WS-42 |
| B2 | Given сессия тенанта A, When запрос с `tenantId` тенанта B, Then 404; пул B не открывается (AC-02; 15:36). | WS-40/56 |
| B3 | Given пользователь с ролями «изменять» в Москва-1 и «читать» в Самара-2, When PATCH объекта Самара-2, Then 403 `forbidden_action`; чтение — 200 (15:26; 02:114). | WS-42 |
| B4 | Given оператор платформы (`platformOperator: true`), When UI открыт, Then меню содержит только «Организации», «Использование», «Заявки на тариф», «Пользователи», «Тарифная сетка» (dc.html:2978) и шапка показывает «Отдельный вход · без доступа к данным клиентов» (dc.html:3009); When `GET /tenants/{anyId}/fleet/trips`, Then 403/404. | WS-42 (API-часть), WS-10 (UI) |
| C1 | Given водитель с завершённым рейсом, When `GET …/trips/{tripId}` Then в теле нет полей начислений; When `GET …/earnings` Then 403; When `GET /tenants/{t}/datasets` Then набор `fleet.earnings`/колонка «Начисление» отсутствует (AC-05). | WS-48/50 |
| C2 | Given владелец, When назначает роль с `fleet.earnings.read` сотруднику с функцией «Водитель», Then 409 `separation_of_duties_conflict`; в UI текст «Функция «Водитель» несовместима с правом на начисления (правило MVP).» (api.js:278; yaml:11688). | WS-44 |
| C3 | Given менеджер с `fleet.earnings.manage`, When `PUT …/earnings` без `If-Match`, Then 428; с устаревшим — 412; с актуальным — 200 и новый `ETag` (yaml:4592–4593). | WS-48 |
| D1 | Given `POST /fleet/reservations` с `Idempotency-Key: K`, When повтор с тем же телом, Then тот же статус/тело и `Idempotency-Replayed: true`; When повтор с другим телом, Then 409 `idempotency_key_reused` (yaml:15; 12:55). | WS-40/46 |
| D2 | Given 100 параллельных `POST /fleet/reservations` на одну машину и окно, Then ровно один 201, остальные 409 `reservation_overlap` (AC-03; 02:321). | WS-46 |
| D3 | Given 100 повторов `POST /spa/appointments/{id}/completion` с одним ключом, Then одно движение склада (AC-07; 02:322). | WS-64 |
| D4 | Given `PATCH /tenants/{t}/knowledge/pages/{id}` с устаревшим `If-Match`, Then 412 `revision_mismatch`; в UI текст «Страницу уже изменили (vN). Обновите и повторите правку.» (api.js:471; 12:58). | WS-62 |
| E1 | Given водитель на странице «Сегодня», When открывает «Автомобили», Then список из `GET /fleet/vehicles?availableFrom&availableUntil` показывает только совместимые машины своей области (README.md:55). | WS-46 |
| E2 | Given флаг «Конфликт брони», When «Забронировать», Then 409 и текст «Машину только что забронировал другой сотрудник. Список на экране устарел.» (api.js:312). | WS-46 (PD-31 `X-Test-Scenario`) |
| E3 | Given бронь `held`, When загружает 5 фото, Then каждый слот проходит «Загрузка N%» → «Принято сервером»; при флаге «Сбой загрузки фото» — «Ошибка — повторить»; API: `initiateUpload` 201 → PUT → `completeUpload` 202 → `getFile` `status: ready`. | WS-45 |
| E4 | Given не все фото `ready`, When «Выехать», Then отказ с текстом «Не все фото загружены на сервер» (api.js:335) / API 409 `photo_not_ready`/`inspection_incomplete` (12:46–48; AC-04). | WS-47 |
| E5 | Given осмотр с критическим дефектом, When отправлен, Then `Inspection.status = requires_review`, `startTrip` → 409 `blocking_defect_open`; в UI «Критический дефект … Выезд заблокирован.» (api.js:341). | WS-47 |
| E6 | Given рейс `in_progress`, When «Добавить расход» без готового чека, Then «Фото чека ещё не загружено» (api.js:364); с чеком — `POST …/expenses` 201, `reviewState: pending`. | WS-47 |
| E7 | Given return-осмотр отправлен, When `PATCH /fleet/trips/{id}` `{action: return, returnInspectionId}` + `If-Match`, Then 200, `status: returned_pending_review` (в 0.2 — `submitted`); пробег меньше начального → 422 `odometer_decrease` (12:61). | WS-47 |
| F1 | Given менеджер на «Приёмка смен», When «Принять», Then `POST /fleet/trips/{id}/review {decision: approve}` + `If-Match` → `status: approved` (в 0.2 — `accepted`), машина `available`; When повтор, Then «Смена уже обработана» (api.js:382) / 409 `invalid_transition`. | WS-48 |
| F2 | Given «Вернуть на доработку» без комментария, Then «Опишите, что нужно исправить» (api.js:384) — в 0.2 `rework` + 422 `validation_failed`. | WS-48 |
| F3 | Given менеджер на «Ресурсный пул», When `GET /fleet/driver-pool?availableFrom&availableUntil`, Then элементы содержат только `driverMemberId, displayName, homeOrgUnitId, qualifications, freeWindow` — без контактов и начислений (yaml:11632–11633). | WS-49 |
| G1 | Given владелец на «Модули и место», When отключает «Логистика» с активным рейсом, Then диалог последствий, затем `PUT /modules/fleet {enabled:false}` + `If-Match` → `state: draining`; новый рейс → 403 `module_read_only`; текущий сдаётся (AC-12). | WS-45 |
| G2 | Given роль с `professional: driver`, When сохраняют с `finance.read`, Then «Роль с функцией «Водитель» не может содержать начисления» (api.js:299). | WS-44 |
| G3 | Given попытка снять роль последнего владельца, Then «Нельзя снять роль с последнего владельца» (api.js:285) / 409 `last_owner_required` (12:52). | WS-44 |
| G4 | Given мест нет (`seatsUsed >= seatsLimit`), When «Пригласить», Then «Свободных мест нет: занято N из M. Отзовите приглашение или запросите расширение тарифа.» (api.js:160) / 409 `seats_exhausted` (17:153). | WS-44 |
| G5 | Given тенант `read_only`, When создание записи, Then 403 `tenant_read_only`; чтение и экспорт работают (AC-11; 12:37); текст прототипа «Пробный период завершён: новые операции недоступны. История доступна для чтения.» (api.js:55). | WS-45 |
| G6 | Given владелец, When `POST /storage/changes {mode: quote}`, Then 201 `StorageChange.state: quoted` с `quoteId`; When `commit` с `acceptedQuoteId` ниже занятого, Then 409 `downgrade_below_usage` (yaml:7450–7452). | WS-45 |
| H1 | Given форма v1 с ответами, When опубликована v2, Then старые ответы читаются по структуре v1 (`FormResponse.versionId` = v1) (AC-09; README.md:68). | WS-60 |
| H2 | Given задача со статусом «Новая», When переход в «Готово» при незакрытом чек-листе, Then «Нельзя завершить: в чек-листе есть невыполненные пункты» (api.js:434); неразрешённый переход → «Переход «X → Y» не предусмотрен процессом» (api.js:433) / 409 `invalid_transition`. | WS-61 |
| H3 | Given перенос визита в «Календарь» на занятый слот, Then 409 `resources_unavailable` с перечнем недоступных ресурсов без чужих деталей (12:43; api.js:461). | WS-63 |
| H4 | Given визит `confirmed`, When «Завершить» при нехватке материала, Then `performance` 200 → `completion` 409; статус `performed_pending_posting`; UI «SPA: услуга выполнена, учёт материалов не завершён — нужно решение» (api.js:493). | WS-64 |
| H5 | Given операция кассы, When «Исправить» без причины, Then «Укажите причину исправления» (api.js:519); повторное сторно → «Операция уже исправлена» (api.js:521). | WS-65 |
| H6 | Given прораб, When отметка с объёмом > план × 1.1, Then «Объём превышает план более чем на 10%…» (api.js:534); без фото — «Добавьте хотя бы одно фото» (api.js:536); API `submitWorkLog` требует `evidenceFileIds`. | WS-66 |
| H7 | Given прораб добавил рабочего (`Worker`), Then аккаунт и место не создаются (AC-13; yaml:11271–11272). | WS-66 |

Исключены со ссылкой: E8 (клиентское состояние «Нет связи», тест страницы `today` — WS-23/WS-68), I1 (`requestId` + «Скопировать» — Q-84 «как в прототипе, без»), I2 (логи стенда — WS-53/WS-69). Снятие `t.Skip` — только владельцем, по одному коммиту `test(<tag>): …` → `feat(<tag>): …`; WS-03 ничего из (а2)/(а3) не снимает.

### (б) Unit (Vitest, `frontend/packages/api-client/test/`; Go, `backend/internal/api/apitest/`)

| Файл | Тест (имя дословно) | Входы → ожидание |
|---|---|---|
| `split-by-tag.test.ts` | `операция с двумя тегами отклоняется` | фикстура op `tags: [fleet, earnings]` → throw `операция <id>: ровно один тег` |
| | `операция с неизвестным тегом отклоняется` | `tags: [Context]` (старое имя) → throw «неизвестный тег Context; допустимы: auth, me, …» |
| | `в файл тега попадают только его пути, компоненты — внешними ссылками` | бандл 3 ops/2 тега → `fleet.3.0.yaml` содержит 2 пути; `$ref: './components.3.0.yaml#/components/schemas/Trip'`; нет инлайн-схем |
| | `вывод детерминирован` | два прогона → байт-в-байт равны (ключи отсортированы, LF, без timestamp) |
| | `x-расширения сохраняются` | `x-permissions`, `x-scope`, `x-problem-codes`, `x-adapter-method`, `x-revisioned` присутствуют в выходе |
| `downconvert.test.ts` | `type: [string, 'null'] → nullable: true` | `{type: ['string','null']}` → `{type: 'string', nullable: true}` |
| | `const → enum` | `{const: 'PUT'}` → `{enum: ['PUT']}` (`UploadTicket.method`, yaml:8524) |
| | `examples[] → example` | массив из 2 → первый элемент |
| | `jsonSchemaDialect и $schema удаляются; openapi = 3.0.3` | заголовок |
| | `3.1-только ключевые слова отсутствуют в выходе` | grep по `unevaluatedProperties`, `$dynamicRef`, `contentMediaType` → пусто (иначе throw с путём) |
| `errors.test.ts` | `реестр содержит 43 кода` | `Object.keys(errors.codes).length === 43` |
| | `каждая строка 12-errors-and-events.md:28–65 представлена в реестре` | фикстура `fixtures/12-errors-rows.json` (36 строк, 38 кодов, статусы) → каждый код есть и статус совпадает |
| | `Problem.code enum в бандле равен реестру` | `components.schemas.ProblemCode.enum` ≡ `Object.keys(errors.codes)` (порядок как в реестре) |
| | `retryable только у пяти кодов` | список `reservation_overlap, resources_unavailable, idempotency_in_progress, rate_limited, dependency_unavailable` |
| | `коды прототипа 07 §6 все замаплены` | 18 кодов мока (фикстура) ⊆ объединение `prototype[]` |
| `permissions.test.ts` | `каталог содержит 93 ключа` | 77 (фикстура `11-permissions-keys.json`, выгрузка из `design/docs/11-permissions.yaml`) + 16 новых |
| | `77 ключей 11-permissions.yaml сохранены с подписями дословно` | для каждого: `label`, `level`, `scopes`, `sensitivity` равны исходнику |
| | `каждый x-permissions бандла ∈ каталог` | 86 ключей 10 §9 п.18 + новые → `missing = []` (это же — Spectral-функция, тест на фикстуре с «левым» ключом → 1 ошибка) |
| | `prototype_renames покрывает 23 ключа прототипа` | фикстура 23 ключей (09 §4.4) → все есть; значения — ключи каталога или `null` |
| | `platform.* не имеют scopes` | 9 ключей |
| `x-scope.test.ts` | `словарь x-scope = 28 значений` и `каждая операция имеет x-scope из словаря` | 10 §5.19 + `public` |
| `idempotency.test.ts` | `каждая изменяющая операция имеет Idempotency-Key` | все POST/PUT/PATCH/DELETE кроме allowlist `[queryDataset, findCalendarAvailability, getPublicUploadStatus, explainAccess, selectTenant, logout, getCsrf, startLogin, authCallback, devLogin]` (все с `x-read-only-post: true` или `auth`) → `missing = []`; счётчик `58 + 24` новых Idem-операций |
| | `каждая операция с x-revisioned имеет If-Match, 412 и 428` | 26 + 8 новых (`decideSubscriptionRequest`, `lockPlatformAccount`, `updateOperator`, `putBranding`, `assignTripVehicle`, `decideInspectionDefect`, `finishTripRoute`, `updateRole` уже) |
| `inventory.test.ts` | `бандл содержит 152 операции и 107 путей` | 118 + 34; 76 + 31 |
| | `все 118 operationId 0.1 сохранены` | фикстура `fixtures/openapi-0.1-operations.json` (список из grep `operationId:` исходника) |
| | `каждая операция имеет x-problem-codes ⊆ enum и ответ на каждый из них` | для каждого кода статус из `errors.yaml` ∈ ключам `responses` |
| | `каждый 4xx/5xx ответ — application/problem+json с $ref Problem` | — |
| | `каждый 2xx ответ объявляет Cache-Control: private, no-store` | заголовок yaml:85–89 |
| | `x-adapter-method: 41 метод core-группы покрыт` | фикстура `adapter-methods.json` → каждый встречается ≥ 1 раз; `resetTrip`, `setFlag`, `kind`, `flags` отсутствуют |
| `examples.test.ts` | `у каждой операции есть пример ok для основного 2xx` | 152 файла `ok.json` |
| | `у каждой операции ≥ 2 примеров` | список → `empty` или Problem-код |
| | `каждый пример валиден по схеме ответа (ajv 2020-12, strict)` | `ok`/`empty` → схема 2xx; `<code>.json` → `Problem` и `code === имя файла`, `status === errors.yaml[code].status` |
| | `примеры сида совпадают с прототипом` | `getMyContext/ok.json` содержит `t-alta`/«Альта Групп», `listTrips/ok.json` — `Р-208`, `listPlatformTenants/ok.json` — 4 организации (07 §9.1) |
| `screens.test.ts` (сводные) | `все 38 ключей присутствуют`, `41 метод покрыт` | см. (а1) |
| `client.test.ts` | `createApiClient собирает путь и заголовки` | `GET /api/v1/me/context` через MSW-less `fetch`-стаб (локальный `Response`): `Idempotency-Key` и `If-Match` прокидываются из `headers` |
| Go `codes_test.go` | `каждый код реестра имеет статус и уникален`, `StatusOf неизвестного → false`, `константы = 43` | читает `../../../../api/errors.yaml` |
| Go `perms_test.go` | `93 константы; значения уникальны; совпадают с api/permissions.yaml` | — |

### (в) Компонентные — нет (UI отсутствует). Клавиатура/axe не применимы (§8.1).

### (г) Контрактные и интеграционные

| Тест | Что проверяет |
|---|---|
| `spectral.test.ts` (fixtures `api/test-fixtures/bad-*.yaml`) | каждое правило `api/spectral.yaml` ловит свой фикстурный нарушитель и молчит на `ortus.yaml`: `ortus-operation-id`, `ortus-tag-known`, `ortus-x-permissions-present`, `ortus-x-permissions-in-catalog`, `ortus-x-scope-known`, `ortus-x-problem-codes`, `ortus-idempotency-key`, `ortus-if-match`, `ortus-problem-json-errors`, `ortus-examples-min-two`, `ortus-write-body-no-additional-properties`, `ortus-cache-control-2xx`, `ortus-x-adapter-method-core` (warn) |
| `validate.test.ts` | полный валидатор OpenAPI 3.1 (`@seriousme/openapi-schema-validator`) на `api/dist/ortus.bundle.yaml` → 0 ошибок (первый прогон вообще — 10 §12 п.2); 3.0-файлы `api/dist/*.3.0.yaml` валидны по 3.0.3 |
| Go `go build ./... && go vet ./...` | 20 пакетов `internal/api/<tag>` компилируются; `models` один; `import-mapping` работает |
| Go `notimpl_test.go` | для каждого тега: `chi` + `<tag>.Handler(<tag>.NotImplemented{})`; запрос первого пути тега → `501`, `Content-Type: application/problem+json`, тело `{"code":"not_implemented","status":501,"title":"Не реализовано","type":"https://docs.ortus.example/errors/not_implemented","requestId":""}` (поле `requestId` пустое — ставит middleware WS-40); 20 кейсов таблично; `publicforms` и `auth` без заголовка `Authorization` тоже 501 (auth не проверяется в заглушке) |
| drift (`gen.js --check`) | `node tools/gen/gen.js` → `git diff --exit-code -- api/dist backend/internal/api frontend/packages/api-client/src/*.gen.ts frontend/packages/api-client/src/bundle.ts` пуст (12 §6 п.17); добавление операции без `x-permissions` из каталога → проверка красная |
| Форма ошибки (12 §6 п.18) | в `notimpl_test.go`: тело содержит `code`, `requestId`, `status`; `code ∈ реестру` |
## 7. Шаги реализации (TDD-циклы в порядке выполнения)

Единица = один цикл Red → Green → Refactor (`tdd-protocol.md` §1); коммиты `test(api): …` → `feat(api): …` → `refactor(api): …`. Оценка — часы работы агента; сумма ≈ 5 сессий (L).

| # | Единица | Красный тест (что падает) | Green (что реализовать) | Refactor | Оценка |
|---|---|---|---|---|---|
| 1 | Скелет и пакет | `screens.test.ts` 38 красных (бандла нет), `inventory.test.ts` «152/107» падает; Go `core_skeleton_test.go` 73 `t.Skip` компилируются (`go vet ./test/contract/`) | `frontend/packages/api-client/{package.json (name @ortus/api-client), vitest.config.ts, src/bundle.ts → null}`, фикстуры `fixtures/{openapi-0.1-operations.json, adapter-methods.json, 12-errors-rows.json, 11-permissions-keys.json}` (выгрузки из `design/docs/**` скриптом `tools/gen/fixtures-from-design.js`, коммитятся), `api/openapi/screens.yaml` по §5 | — | 3 ч |
| 2 | Разрез 0.1 на файлы | `split-by-tag.test.ts` 5 кейсов красные | `tools/gen/split-by-tag.js` (вход: бандл; выход: `paths/`-разбиение по тегу и `dist/*.3.0.yaml`); первичное разложение `ortus-openapi-v0.1.yaml` → `api/openapi/{ortus.yaml, paths/*.yaml, components/*.yaml}` скриптом `tools/gen/unbundle-0.1.js` (одноразовый, остаётся в репо); переименование тегов | ключи отсортированы, общий `writeYaml` с LF | 5 ч |
| 3 | Бандл и валидатор | `validate.test.ts` красный (нет `api/dist/ortus.bundle.yaml`); `inventory.test.ts` «118 operationId 0.1 сохранены» | `tools/gen/gen.js` шаг `bundle` (`@redocly/cli bundle`, pinned) + `validate` (3.1); `api/README.md` | единый `run(step)` с логом в `docs/plan/evidence/contract-core/*.txt` | 3 ч |
| 4 | Реестр ошибок | `errors.test.ts` 5 тестов; `inventory.test.ts` «x-problem-codes ⊆ enum» | `api/errors.yaml` (43), `components/schemas.yaml#ProblemCode`, `Problem.code → $ref`, `Problem.retryable`; `x-problem-codes` на 118 операциях по наборам R/C/U/P/PU/Pub 10 §4 + 09 §5.2; замена 4 кодов в описаниях (`plan_required` и др.) | — | 4 ч |
| 5 | Каталог прав | `permissions.test.ts` 5 тестов; `x-scope.test.ts` 2 | `api/permissions.yaml` (копия + 16 ключей + 13 переименований); `api/spectral.yaml` со словарём `x-scope` (28) | — | 3 ч |
| 6 | Spectral | `spectral.test.ts` 13 правил на фикстурах `bad-*.yaml` | правила + функции `api/spectral-functions/{inCatalog,inEnum,inScopeDictionary,idempotency,ifMatch,examples}.js`; шаг `lint` в `gen.js` | — | 4 ч |
| 7 | Тег `auth` + `me` | `t.Skip`-скелет не меняется; красные: `inventory.test.ts` (счётчики), `screens.test.ts` ключ `shell`, `idempotency.test.ts` allowlist | 6 + 2 операции §4.1; `MeContext`, `TenantContext.tenantStatus`, `CsrfToken`, `DevLogin`, `MyEventPage`; `sessionCookie.name = ortus_sid`; примеры `ok`/`empty`/`session_expired` | — | 4 ч |
| 8 | Тег `platform` | `screens.test.ts` `tenants/usage/requests/accounts/plans`; `inventory` | 12 операций; схемы `PlatformUsage`, `SubscriptionRequest{Page,Decision}`, `PriceBookVersion{,Create,List}`, `PlatformUser` (+поля), `AccountLock`, `PlatformOperator{,Page,Invite,Patch}`, `PlatformAuditPage`; `Tenant.status` PD-35; `PlatformSubscriptionUpdate.trialEndsAt`; примеры из сида 07 §9.1 (4 организации, SR-12/SR-9, v1/v2 сетки, 6 операторов, 2 строки аудита) | вынести `Money`-примеры в `examples/_shared/` | 6 ч |
| 9 | Тег `billing` + `branding` + `files` | `screens.test.ts` `billing`, `branding`, `files`, `modal-invite` | 3 + 4 + 1 операции; `Subscription` расширение; `SeatRequestCreate`; `Branding{,Update,File}`, `PublicBranding` (поля `BRAND_DEFAULT`, 07 §9.1); `FilePage`; примеры: `tier_below_usage` «В тарифе «Старт» 10 мест, а занято 23», `request_pending`, `seats_exhausted` «Свободных мест нет: занято 10 из 10…» | — | 5 ч |
| 10 | Тег `access` | `screens.test.ts` `users`, `modal-assign`, `modal-createRole`; `idempotency.test.ts` (`revokeInvitation`) | `revokeInvitation`, `listGroups`, `explainAccess`; расширения `inviteMember`, `createAssignment`, `revokeAssignment`, `Role`, `updateRole`; примеры `separation_of_duties_conflict` (текст api.js:278), `last_owner_required` (api.js:285), `delegation_exceeds_grant` | — | 4 ч |
| 11 | Тег `fleet` | `screens.test.ts` `fleet`, `review`, `today`, `cars`, `pool`, `modal-request`; `inventory` «x-adapter-method 41» | `assignTripVehicle`, `decideInspectionDefect`, `finishTripRoute`; `Trip.status` 9 состояний; `TripReview.rework/steps/comment`; `Vehicle` поля; `x-adapter-method` на всех операциях §4.10 (включая 0.1: `setModuleInstallation → setModule`, `requestStorageChange → setStorageQuota`, `reserveVehicle → reserve`, `submitInspection → [submitDeparture, submitReturn]`, `updateCalendarBooking → moveBooking`, `updateKnowledgePage → saveKbPage`, `transitionTask → moveTask`, `createTask`, `createFormVersion/publishFormVersion → publishForm`, `recordAppointmentPerformance/completeAppointment → completeAppointment`, `postCashOperation → [addCashOp, reverseCashOp]`, `submitWorkLog → addWorkLog`) | — | 5 ч |
| 12 | Примеры — покрытие | `examples.test.ts` 4 теста: «ok у каждой», «≥ 2», «ajv», «сид» | добить `examples/<op>/` для всех 152 операций (`empty` для 40 списков; Problem-пример на каждую мутацию по первому коду `x-problem-codes`); шаг `examples` в `gen.js` (`tools/gen/examples-check.js`) | генератор `empty.json` для `*Page` схем — `tools/gen/examples-scaffold.js` (создаёт файл, если нет; содержимое проверяется руками) | 6 ч |
| 13 | Down-convert + Go-генерация | `downconvert.test.ts` 5; `go build ./internal/api/...` красный (пакетов нет) | `tools/gen/downconvert.js` (`@apiture/openapi-down-convert`, pinned, + пост-обработка `const`); `oapi-config.tmpl.yaml` (`package: <tag>`, `generate: {strict-server: true, chi-server: true, embedded-spec: false}`, `import-mapping: {"./components.3.0.yaml": "<module>/internal/api/models"}`, `output-options: {skip-prune: true}`); `models` из `components.3.0.yaml` (`generate: {models: true}`); `go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@<pin>` ×21; заявка на `go.mod` интегратору (§2.2) | `gen.js` запускает кодоген параллельно по тегам (`Promise.all`, лимит 4) | 6 ч |
| 14 | `notimpl` 501 | `notimpl_test.go` 20 кейсов красные (нет `NotImplemented`) | `tools/gen/notimpl.go.tmpl` → `<tag>/notimpl.gen.go`: тип `NotImplemented struct{}` реализует `StrictServerInterface`, каждый метод возвращает `(nil, &NotImplementedError{Op: "<operationId>"})`; `<tag>.Handler(si)` с `StrictHTTPServerOptions.ResponseErrorHandlerFunc`, пишущей `models.Problem{Code: ProblemCodeNotImplemented, Status: 501, …}` в `application/problem+json` | общий хелпер `internal/api/problemjson/write.go` (рукописный, WS-03) — единственное место формирования 501; WS-40 использует его же из `problem.From` | 4 ч |
| 15 | Константы Go/TS + TS-клиент | `codes_test.go`, `perms_test.go`; `client.test.ts` | `tools/gen/constants.js` → `perms.gen.go`, `codes.gen.go`, `perms.gen.ts`, `codes.gen.ts`; `openapi-typescript` → `schema.gen.ts`; `src/client.ts` (`openapi-fetch`), `src/bundle.ts` (JSON бандла как `const`) | `index.ts` экспорт-лист заморожен: `createApiClient`, `paths`, `components`, `PERM`, `ERR`, `BUNDLE` | 4 ч |
| 16 | `--check` и drift | тест `gen.js --check` на фикстурной ветке с «лишним» изменением в `api.gen.go` → exit 1; с операцией без `x-permissions` → exit 1 | `gen.js --check` = lint + validate + permissions + examples + screens + `git diff --exit-code`; `api/CHANGELOG.md`; тексты для `Makefile`/`package.json`/CI (заявка интегратору) | — | 2 ч |
| 17 | Отчёт | — | `docs/plan/reports/WS-03.md` по `orchestration.md` §5 (таблица red → green по 16 единицам; вывод `pnpm --filter @ortus/api-client test`, `go -C backend test ./internal/api/... ./test/contract/...`, `node tools/gen/gen.js --check` — последние 40 строк); evidence `docs/plan/evidence/contract-core/`; строка `status.md` → «на проверке» | — | 1 ч |

Порядок обязателен: 1–6 (инструменты и правила) до 7–11 (содержимое), иначе содержимое пишется без линтера. Единицы 7–11 можно выполнять в двух сессиях параллельно только одним агентом (один владелец `api/openapi/*`, `orchestration.md` §1).

## 8. Проверка

Страниц нет — `verification-protocol.md` §1 (e2e), §3 (визуальная сверка) и §4 (MCP) **не применяются** (`00-master-plan.md` §8.1, колонка `contract`: E2E-скелет = `screens.test.ts`; визуальная — «—»; MCP — «—»). Проверяющий страниц не назначается (`pages: []`); работают два ревьюера (§8.4 `contract`: аддитивность — не требуется в волне 0, но каждая неаддитивная правка 0.1 обязана быть строкой `api/CHANGELOG.md`; примеры на каждую операцию; `x-adapter-method`). Что именно запускается и что должно быть в выводе:

| Команда (из корня worktree) | Ожидаемый результат (дословно/числа) | Evidence |
|---|---|---|
| `node tools/gen/gen.js` | лог шагов `bundle → validate → lint → permissions → split → downconvert → codegen(21) → constants → ts → examples → screens`; строка `OK: 152 operations, 107 paths, 20 tags, 43 codes, 93 permissions, 38 screens` | `docs/plan/evidence/contract-core/gen.txt` |
| `node tools/gen/gen.js --check` | то же + `drift: clean`; exit 0 | `drift.txt` |
| `pnpm --filter @ortus/api-client test` | все тесты §6(б), (г), `screens.test.ts` 38/38 зелёные; `Tests  N passed` без `skipped` | `vitest.txt` |
| `npx spectral lint api/dist/ortus.bundle.yaml -r api/spectral.yaml` | `No results with a severity of 'error' found!` (warn допустимы только `ortus-x-adapter-method-core` для delta-операций) | `spectral.txt` |
| `go -C backend build ./... ; go -C backend vet ./...` | exit 0 | `gen.txt` |
| `go -C backend test ./internal/api/... ./test/contract/...` | `ok … internal/api/apitest`; `test/contract`: 73 `--- SKIP` (скелет), 0 FAIL | `go-test.txt` |
| `git -C backend status --porcelain internal/api` после повторного `make gen` | пусто | `drift.txt` |
| `node tools/gen/gen.js --inventory > docs/plan/evidence/contract-core/inventory.json` | JSON: по тегу — число операций, Idem, If-Match, коды; сравнить с 10 §5.19 (58 → 82 Idem; 26 → 34 If-Match) | `inventory.json` |

Эталон (`127.0.0.1:4173`) для этого WS не используется: прототип не содержит HTTP-слоя (10 §12 п.2 «Реального backend нет»); источник истины для подписей в примерах — сид 07 §9 и тексты 09 §5.3. Для ревьюера №2 (`permissions.yaml`, CODEOWNERS): сверить 77 ключей дословно с `design/docs/11-permissions.yaml` командой `node tools/gen/permissions-check.js --diff-design` (вывод: `0 changed, 16 added`), убедиться, что `owner_only` сохранён у `modules.manage`, `billing.manage`, `branding.manage`, а `blocked_by_function: [driver]` — у `fleet.earnings.*`.