# Журнал контракта Ортус

Каждое отличие бандла `api/dist/ortus.bundle.yaml` от OpenAPI 0.1 (`design/docs/v0.1/ortus-openapi-v0.1.yaml`) объявлено в `api/openapi/source-delta.yaml` и записано здесь. После W0.07 контракт меняется только аддитивно (контрактный PR шага, стюард этапа).

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
