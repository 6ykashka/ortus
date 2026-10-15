# Журнал контракта Ортус

Каждое отличие бандла `api/dist/ortus.bundle.yaml` от OpenAPI 0.1 (`design/docs/v0.1/ortus-openapi-v0.1.yaml`) объявлено в `api/openapi/source-delta.yaml` и записано здесь. После W0.07 контракт меняется только аддитивно (контрактный PR шага, стюард этапа).

## 0.4.0-stage1 — W1.00 (второй контрактный PR этапа 1)

Только добавления: 13 операций (11 новых путей и метод `POST` у пути `/tenants/{tenantId}/members` 0.1), 24 схемы, параметр `workProfileId`, необязательное поле `TenantContext.tenantState`. Новых тегов, ключей прав и кодов ошибок нет. Операции, пути и схемы 0.1, W0.07 и W0.08 не менялись. Каждое отличие — строка `source-delta.yaml` с источником `W1.00` (38 новых строк); итог `contract --check`: 156 операций, 108 путей, 19 тегов.

| Что                                                                | Операции                                                               | Источник                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------- |
| Оператор: приостановка, возобновление, продление пробного периода  | `suspendPlatformTenant`, `resumePlatformTenant`, `extendPlatformTrial` | S1-04; PLAT-02, PLAT-05; 04-platform §5.1 |
| Журнал действий платформы                                          | `listPlatformAuditEvents`                                              | S1-04, S1-23; NFR-05                      |
| Список файлов с родительским объектом                              | `listFiles`                                                            | S1-21; FILE-03; 06 §8                     |
| Разбивка занятого места по группам эталона и модулям               | `getStorageBreakdown`                                                  | S1-22; PLAT-06                            |
| «Затронет сейчас» перед отключением модуля                         | `previewModuleDeactivation`                                            | S1-18; AUTH-09, AC-12                     |
| Билет канала реального времени (WebSocket, подсказки без данных)   | `createRealtimeTicket`                                                 | S1-15, S1-26; ADR-0015 (PD-58)            |
| Карточка сотрудника без аккаунта                                   | `createMember`                                                         | S1-09; BUILD-03                           |
| Функции сотрудника с периодом                                      | `listWorkProfiles`, `createWorkProfile`, `updateWorkProfile`           | S1-09; AUTH-05                            |
| Перенос подразделения с предпросмотром влияния на доступ           | `previewOrgUnitMove`                                                   | S1-08                                     |
| Состояние организации в `/me/context` (баннеры без `billing.read`) | поле `TenantContext.tenantState` (`TenantState`)                       | S1-19; карточки W1.08, W1.20              |

Решения по умолчанию (бриф W1.00 §4, §10):

- Команды оператора — отдельные операции с обязательной причиной 5–500, `If-Match`, `Idempotency-Key` (пространство тенант + actor + операция, control 0005) и строкой `platform_audit` в той же транзакции; `updatePlatformTenant` 0.1 остаётся для переименования. «Ограничить новые операции» эталона = `suspended` (PLAT-02).
- Продление пробного периода — 1…30 дней, из `trialing`, `grace` или `read_only` после пробного периода; из оплаченной подписки — 409 `invalid_transition`.
- Канал реального времени — WebSocket `GET /api/v1/realtime` вне `paths` (OpenAPI не описывает 101): одноразовый билет 60 с первым кадром, сообщения — подсказки без данных; описан расширением `x-realtime` операции `createRealtimeTicket` и ADR-0015.
- `listFiles` фильтрует по доступу к родителю до пагинации; файл невидимого родителя не попадает в список.

Возврат 1 ревью W1.00 (до слияния, поэтому не нарушает аддитивность):

- `createRealtimeTicket` — без `Idempotency-Key`, `Idempotency-Replayed`, 409 и 428: одноразовый билет не хранится в `idempotency_keys` и не повторяется, каждый вызов выдаёт новый (ADR-0015; правило Spectral `ortus-idempotency-key`, список `singleUse`).
- `listPlatformAuditEvents` — строки фильтруются по праву на тип цели: `account` — `platform.users.read`, `operator` — `platform.operators.manage`, `price_book` — `platform.pricing.manage`; невидимые строки не попадают в страницу.
- `PlatformAuditTarget` — строки `subscription.*` имеют цель `subscription` (пример `listPlatformAuditEvents/ok` и MSW).
- `previewOrgUnitMove` — без права на старого или нового родителя 403 `forbidden_action`, верхний уровень требует права на всю организацию; люди вне области `members.read` — только в `hiddenCount`.
- control 0005 — пространство ключа тенант + actor + операция (`tenant_id`, `unique nulls not distinct`), ключ 16–128 как в контракте; tenant 0007 — аренда до 0007 получает владельца `pre-0007`, `outbox_ready_idx` заменяет `outbox_pending_idx`.

Возврат 2 ревью W1.00 (до слияния):

- tenant 0007 согласована с outbox W1.01 (Q-W1.01-3): аренда — только `locked_until`, dead-letter — `available_at = 'infinity'` с причиной в `last_error` (проверка `events_dead_has_error`, индекс `outbox_dead_idx`); `lease_owner`, `dead_at`, `retried_*` и `outbox_ready_idx` возврата 1 сняты, `outbox_pending_idx` остаётся.
- control 0005 — `tenant_id` задаёт шлюз (`namespace` в `cmd/api/gate.go`): у identity и платформенных операций — `null`; `request_hash` — метод, путь, строка запроса, тело.
- `catalog.Operation.Idempotent` — операция объявляет `Idempotency-Key` (Q-W1.01-2); у `createRealtimeTicket` — `false`.
- `OrgUnitMovePreview.hiddenCount` — число людей, а не назначений; `affectedPeople` — запись на человека и назначение.
  Вне бандла:

| Файл                                                  | Изменение                                                                                                                                                                                   | Источник               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `examples/**`, `seed-ids.yaml`                        | примеры 13 операций (`tools/gen/examples-w100.mjs`); `tenantState` в `getMyContext/*` и `selectTenant/ok`; П-15: `membershipId` и `userId` оператора как у сида, пересборка не меняет файлы | W1.00, критика этапа 0 |
| `openapi/screens.yaml`                                | `stories`, `reference` экранов этапа 1; экраны `tenant-switch`, `member-card`, `company-structure`, `modal-module-disable`, `platform-tenant-create`; `storiesWithoutScreen`                | DoR W1.00              |
| `backend/migrations/control/0004–0005`, `tenant/0007` | `accounts.last_tenant_id`; `idempotency_keys` control-plane; dead-letter `outbox.events` (модель W1.01)                                                                                     | PD-59, бриф W1.00 §4   |

## 0.3.0-stage1 — W0.08 (шаг 0.3 плана 27)

Контракт этапа 1, только добавления: 25 операций, 21 путь, тег `Auth`, 30 схем, параметры `groupId` и `importId`, ответ `DependencyUnavailable` (503), необязательное поле `MeContext.lastTenantId`. Операции, пути и схемы 0.1 и W0.07 не менялись. Каждое отличие — строка `source-delta.yaml` с источником (56 новых строк); итог `contract --check`: 143 операции, 97 путей, 19 тегов.

| Что                                                                   | Операции                                                                                 | Источник                                                 |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Вход через BFF (OIDC Code + PKCE), CSRF, выход — тег `Auth`           | `startLogin`, `completeLogin`, `getCsrfToken`, `logout`                                  | 03 «Вход…», «Что требуется допроектировать»; S1-05; G-01 |
| Приглашение: просмотр по токену (в теле) и принятие с проверкой почты | `inspectInvitation`, `acceptInvitation`                                                  | S1-06; G-01                                              |
| Переключатель бизнеса, `MeContext.lastTenantId`                       | `selectTenant`                                                                           | S1-07                                                    |
| Входящие уведомления                                                  | `listMyNotifications`, `getMyNotificationSummary`, `markMyNotificationsRead`             | S1-26; G-19; C п.2                                       |
| Группы (CRUD, состав с проверкой делегирования и SoD)                 | `listGroups`, `createGroup`, `getGroup`, `updateGroup`, `deleteGroup`, `setGroupMembers` | 03 «Группы и владельцы»; C п.17; G-02                    |
| Владельцы: передача с подтверждением, снятие, последний не снимается  | `listOwners`, `transferOwnership`, `revokeOwnership`                                     | S1-16; AUTH-08; G-02                                     |
| «Почему доступно»                                                     | `explainAccess`                                                                          | S1-14; AUTH-04; PD-53                                    |
| Импорт CSV людей с предпросмотром                                     | `createPeopleImport`, `getPeopleImport`, `commitPeopleImport`                            | S1-10                                                    |
| Сессия загрузки: статус и отмена                                      | `getUploadSession`, `abortUpload`                                                        | S1-20; G-10                                              |

Правила, уточнённые по ревью W0.08 (до слияния, в тех же новых схемах и операциях):

- `startLogin.returnTo` и `Notification.link` — шаблон `^/(?:[^/\\\s\x00-\x1f\x7f][^\\\s\x00-\x1f\x7f]*)?$`: один ведущий `/`, без `//`, обратного слеша, пробелов и управляющих символов (CWE-601: `/\host` браузер читает как `//host`); без lookaround, чтобы Go (RE2) и ECMAScript проверяли одинаково. CHECK `link` в tenant 0003 — то же правило и длина 512.
- `NotificationReadRequest` — ровно одно из `notificationIds` и `upTo` выражено схемой (`minProperties: 2`, `maxProperties: 2` при `additionalProperties: false`), а не только описанием.
- `createPeopleImport` / `commitPeopleImport` — совпадение с человеком вне области `members.manage` действующего — ошибка строки без раскрытия совпадения и `memberId`; перенос домашнего подразделения — только с правом на старое и новое; проверка повторяется при commit. `PeopleImport.rowsPurgedAt`: строки с персональными данными удаляются через 30 дней после commit (Q-W0.08-5).
- `revokeOwnership` — свежий вход (как у `transferOwnership`) и уведомление снятого и остальных владельцев (Q-W0.08-6).
- `AccessExplanation.hiddenGrants` — назначения вне области действующего не перечисляются и не описываются, только флаг; `AccessCheck.check` — `$ref: AccessCheckStep`.
- `UploadSession.purpose` — те же значения, что `UploadCreate.purpose`, хранятся в `files.objects.purpose` один к одному.
- `screens.yaml` — экран `modal-upload` (бриф §5).

Вне бандла:

| Файл                                  | Изменение                                                                                                               | Источник         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `.spectral.yaml`                      | `inspectInvitation` — POST-чтение в `readOnly` правила `ortus-idempotency-key` (токен в теле, не в URL)                 | W0.08            |
| `permissions.yaml`, `errors.yaml`     | без изменений: новые операции используют `members.*`, `roles.read`, `files.upload` и существующие коды                  | бриф W0.08 §4    |
| `examples/**`, `seed-ids.yaml`        | примеры 25 операций (`tools/gen/examples-stage1.mjs`); пересборка добавила `forms.responses.assign` в примеры владельца | W0.08            |
| `backend/migrations/tenant/0003–0006` | `notify.notifications`, `files.upload_sessions`, `people.imports` и `import_rows`, расширение `access.groups`           | PD-59, бриф §4.2 |

## 0.2.0-stage0 — W0.07 (шаг 0.2 плана 27)

Раскладка (PD-56): `api/openapi/ortus.yaml`, `paths/<tag>.yaml` (18), `components/<группа>/<вид>.yaml`. Бандл собирается `node tools/gen/contract.mjs`; операции, пути, теги и схемы 0.1 не менялись, кроме строк ниже.

| Указатель                                           | Изменение                                                                                                                                                                  | Источник                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `/info/version`                                     | `0.1.0-design` → `0.2.0-stage0`                                                                                                                                            | PD-56                         |
| `/components/schemas/Tenant/properties/status/enum` | `provisioning, active, suspended, closing` → `provisioning, trial, active, grace, read_only, suspended, closing, closed`; `restricted` прототипа = `grace` или `read_only` | PLAT-02, PD-35                |
| `/components/schemas/ProblemCode`                   | новая схема: `enum` из 52 кодов `api/errors.yaml` (48 — реестр 12 версии 14.10, 4 — PD-34)                                                                                 | 12 «Реестр кодов», PD-34      |
| `/components/schemas/Problem/properties/code`       | `type: string` → `$ref: ProblemCode`                                                                                                                                       | 12, README v0.2 «Расхождения» |
| `/components/schemas/Problem/properties/retryable`  | новое необязательное `boolean`                                                                                                                                             | 12 «Формат ошибки»            |

Вне бандла (каталог прав и правила; на `api/dist/` не влияют):

| Файл               | Изменение                                                                                                                                                                                        | Источник                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `permissions.yaml` | 108 ключей 11 (14.10) + 14 `inventory.*`, `spa.*`, `cash.*` из `x-permissions` 0.1 + `forms.responses.assign` из `x-field-permissions` 0.1 (`reviewFormResponse`) = 123; все добавления PROPOSED | C, факт 3; G-21; ревью W0.07       |
| `.spectral.yaml`   | правила `ortus-*` (13): в т. ч. `ortus-x-field-permissions-in-catalog`, `ortus-x-permissions-empty`, `ortus-public-security`                                                                     | 12 «Линтер контракта»; ревью W0.07 |
