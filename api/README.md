# api/ — контракт Ортус CRM

Единственный источник контракта API. Пишет только стюард контракта этапа (план v2 §3.4–3.5, PD-56); `api/permissions.yaml` и `api/errors.yaml` — два ревьюера (CODEOWNERS). После W0.07 контракт меняется только аддитивно: контрактный PR шага добавляет пути, схемы, права, коды, примеры и строки `screens.yaml`.

## Раскладка

| Путь                                        | Что                                                                                                                               | Правится                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `openapi/ortus.yaml`                        | корень: `info`, `servers`, `security`, `tags`, пути — `$ref` на `paths/<tag>.yaml`                                                | стюард                               |
| `openapi/paths/<tag>.yaml`                  | пути и операции тега (`<tag>` — имя тега в нижнем регистре)                                                                       | стюард, PR шага                      |
| `openapi/components/<tag>/schemas.yaml`     | схемы, которые использует один тег                                                                                                | стюард, PR шага                      |
| `openapi/components/common/*.yaml`          | общие схемы, параметры, заголовки, ответы, схемы безопасности                                                                     | только стюард                        |
| `openapi/components/errors/schemas.yaml`    | `ProblemCode` — **генерируется** из `errors.yaml`; единственная группа вне правила `<tag>`/`common`                               | не править                           |
| `openapi/source-delta.yaml`                 | объявленные отличия бандла от OpenAPI 0.1 (`design/docs/v0.1`)                                                                    | стюард                               |
| `openapi/examples/<operationId>/<имя>.json` | примеры ответов: `ok`, персонаж (`getMyContext`), `empty`, `<Problem.code>`                                                       | стюард; `make examples` — интегратор |
| `openapi/examples/seed-ids.yaml`            | id прототипа → UUID v5 `ortus:<scope>:<id>` — **генерируется** `tools/gen/examples-seed.mjs`                                      | не править                           |
| `openapi/screens.yaml`                      | экран → операции                                                                                                                  | стюард                               |
| `errors.yaml`                               | реестр кодов ошибок (12, PD-34), клиентские состояния, коды прототипа → канон                                                     | стюард, только добавление            |
| `permissions.yaml`                          | каталог прав (11 + `inventory`, `spa`, `cash`, `forms.responses.assign`), шаблоны ролей, `prototype_renames`, `prototype_pending` | стюард, только добавление            |
| `.spectral.yaml`, `spectral/functions/*.js` | правила Spectral (`ortus-*`)                                                                                                      | стюард                               |
| `spectral/functions/_dictionaries.gen.js`   | словари правил (ES-модуль) — **генерируется**                                                                                     | не править                           |
| `dist/ortus.bundle.yaml`                    | бандл OpenAPI 3.1 — **генерируется**, вход кодогенерации (W0.09) и MSW (W0.13)                                                    | не править                           |
| `CHANGELOG.md`                              | журнал изменений контракта                                                                                                        | стюард                               |

Ссылки в исходнике относительные (`../components/common/schemas.yaml#/Problem`), включая значения `discriminator.mapping` (`./schemas.yaml#/TextValue`); бандлер переписывает их во внутренние (`#/components/schemas/Problem`). Имя компонента уникально внутри вида во всех группах. Группы `components/`: `<tag>` — схемы одного тега, `common` — общие, `errors` — генерируемая (`ProblemCode`); новую группу добавляет только стюард с записью здесь.

## Что линтуется

Линтеры и валидаторы OpenAPI запускаются **только по бандлу** `dist/ortus.bundle.yaml`. Корень исходника `openapi/ortus.yaml` по PD-56 не содержит `components`: `securitySchemes` лежат в `components/common/` и попадают в документ только при сборке, поэтому линтер по корню выдаёт `security-defined`. Самодостаточность ссылок исходника проверяет тест `tools/gen/bundle.test.mjs`. CI W0.04 вызывает крючки `lint:api` и `validate:api` (план v2 §4 W0.04).

## Команды (из корня репозитория)

| Команда                                                                                                                      | Что делает                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `corepack pnpm run contract` (`node tools/gen/contract.mjs`)                                                                 | генерирует `ProblemCode`, словари Spectral и бандл                                                                                                                                                                                   |
| `corepack pnpm run contract:check` (`node tools/gen/contract.mjs --check`)                                                   | без записи: дрейф генерируемых файлов, равенство 0.1 вне `source-delta.yaml` (все 118 операций 0.1 на месте), валидатор OpenAPI 3.1, реестр ошибок, каталог прав, примеры (ajv 2020-12), `screens.yaml`, Spectral; exit 1 при ошибке |
| `corepack pnpm run test:contract` (`node --test "tools/gen/*.test.mjs"`)                                                     | тесты конвейера                                                                                                                                                                                                                      |
| `node tools/gen/examples-seed.mjs`                                                                                           | пересобрать примеры ядра и этапа 1 (`examples-stage1.mjs`) и `seed-ids.yaml` из выписки сида                                                                                                                                         |
| `corepack pnpm run lint:api` (`spectral lint api/dist/ortus.bundle.yaml --ruleset api/.spectral.yaml --fail-severity error`) | только Spectral; каталог запуска не важен (словари вшиты в модуль) — шаг `lint/spectral` CI                                                                                                                                          |
| `corepack pnpm run validate:api` (`node tools/gen/contract.mjs --check`)                                                     | то же, что `contract:check` — шаг `contract/openapi-validate` CI                                                                                                                                                                     |

Порядок правки: изменить исходник → `contract` → `contract:check` → коммит вместе с `dist/` и генерируемыми файлами.

## Права в операциях

- Машиночитаемых расширений авторизации два: `x-permissions` (ключи на операцию; `x-permissions-mode`) и `x-field-permissions` (поле тела → ключ, сейчас только `reviewFormResponse`). Значения обоих — ключи `permissions.yaml`: проверяют `contract --check` (`checkCatalog`) и Spectral (`ortus-x-permissions-in-catalog`, `ortus-x-field-permissions-in-catalog`).
- Пустой `x-permissions: []` допустим только с основанием: `x-scope: identity`, `x-public-capability` (публичная ссылка) или непустой `x-field-permissions` (правило `ortus-x-permissions-empty`). `security: []` — только с `x-public-capability` (`ortus-public-security`). Новая операция не может незаметно стать эндпоинтом без проверки прав.
- Ключи, упомянутые **только в тексте** `description` 0.1, машинно не проверяются; их место в каталоге:

  | Ключ из текста                   | Где                                                     | Статус                                                                                                  |
  | -------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | `cash.refund`                    | `createCashOperation` (`paths/cash.yaml`)               | `prototype_pending` → W5.00                                                                             |
  | `cash.adjust`                    | `createCashOperation` (`paths/cash.yaml`)               | в каталог не вносится: = `cash.reconcile` + `cash.reverse` (C, п. 191), оба `prototype_pending` → W5.00 |
  | `inventory.consumption.override` | `AppointmentCompletion` (`components/spa/schemas.yaml`) | нет в каталоге; вносит стюард этапа 5 (W5.00) вместе с `inventory.*`                                    |

## `prototype_renames` — справочник, не миграция

`prototype_renames` сопоставляет ключ прототипа с каноническим ключом **для кода и текстов** (чем заменить ключ при переносе экрана). Это **не** автоматическая миграция назначений ролей: часть строк отображает узкий ключ модуля на широкий ключ организации — `spa.settings`, `repairs.settings`, `fleet.settings` → `modules.settings.manage` (настройки всех модулей, `sensitive`), `spa.export`, `repairs.export`, `fleet.export` → `data.export`. Перенос ролей прототипа по этой таблице расширил бы права. Роли из прототипа в данные не переносятся; если модулю нужны свои права настроек и выгрузки (`spa.settings.manage`, `repairs.export`…), их вводит стюард этапа модуля (W5.00, W7.00) аддитивно.

## Идентификаторы сида

`seed-ids.yaml` — UUID v5 (пространство URL `6ba7b811-9dad-11d1-80b4-00c04fd430c8`, имя `ortus:<scope>:<id>`; в Go — `uuid.NewSHA1(uuid.NameSpaceURL, []byte(name))`). Они **предсказуемы** по публичным именам прототипа и годятся только для dev, демо, примеров и MSW. W0.06, W0.12, W0.13 не переносят их в данные реальных арендаторов (оператор платформы, владельцы) ни на стенде, ни в проде. Авторизация не опирается на «неугадываемость» id: чужой объект — `not_found` или `no_scope` по контракту.

Персонаж `driver` (и `manager`) в `examples/getMyContext/` верен прототипу 14.10: у «Альты» (`t-alta`) модуль `fleet` не установлен, `spa` активен, поэтому в примере у водителя нет доступа к логистике, а у менеджера — `fleet.earnings.read`. Это известное расхождение прототипа, не ошибка примеров (отчёт W0.07, «Исправления по ревью»).

## Этап 1 (W0.08, `0.3.0-stage1`)

- Тег `Auth` — вход в браузере через BFF: `startLogin` и `completeLogin` (`security: []`, возможность — state + PKCE), `getCsrfToken` и `logout` (только `sessionCookie`), `inspectInvitation` (публичное POST-чтение, токен в теле) и `acceptInvitation` (сессия приглашённого, почта должна совпасть). Токены приглашений и сессий никогда не стоят в пути и query. Dev-вход `?persona=` в контракт не входит: это маршрут BFF только в e2e-сборке (PD-54).
- Новых ключей прав нет: группы — `members.read`/`members.manage` (состав группы с ролями сервер проверяет как назначение: `roles.assign`, делегирование, SoD); владение — `members.manage` + `x-scope: tenant-owner` (OwnerBinding, AUTH-08); импорт — `members.manage`, приглашения из файла — `members.invite` через `x-field-permissions`.
- Входящие хранятся в tenant DB (`notify.notifications`); лента `listMyNotifications` — по одному `tenantId`, сводка — только счётчики. Адресат и право перепроверяются при выдаче.
- `Scope` 0.1 не менялся; расширение видов областей — ADR-0014 (`docs/adr/0014-extensible-authz-scopes.md`).

## Номера миграций (PD-59)

Номер выдаёт стюард контракта из блока этапа (план v2 §3.5). Выданные и зарезервированные номера:

| БД      | Номер     | Файл / назначение                                                                   | Кто         |
| ------- | --------- | ----------------------------------------------------------------------------------- | ----------- |
| tenant  | 0001–0002 | `0001_core.sql`, `0002_fleet.sql` — копии v0.2                                      | W0.06       |
| tenant  | 0003      | `0003_notify_inbox.sql` — входящие уведомления                                      | W0.08 (1.9) |
| tenant  | 0004      | `0004_files_upload_sessions.sql` — сессии загрузки                                  | W0.08 (1.8) |
| tenant  | 0005      | `0005_people_imports.sql` — импорт CSV людей                                        | W0.08 (1.5) |
| tenant  | 0006      | `0006_access_groups.sql` — ревизия и владелец группы                                | W0.08 (1.6) |
| tenant  | 0007–0009 | резерв этапа 1 (канал реального времени PD-58, `policy_version` и др.)              | W1.00       |
| control | 0001–0003 | `0001_init.sql`, `0002_billing.sql`, `0003_branding.sql` — копии v0.2               | W0.06       |
| control | 0004      | резерв: `accounts.last_tenant_id` (переключатель бизнеса, `MeContext.lastTenantId`) | W1.03       |

Резерв — это очередь, а не закреплённый номер. Проверка CI (`tools/ci/check-migrations.mjs`) требует номеров без дыр, поэтому стюард этапа 1 (W1.00) выдаёт окончательный номер при открытии PR с миграцией, в порядке слияния. Если раньше откроется PR другого WS той же БД, он получает следующий свободный номер, а резерв переносится на номер после него. Пример: W1.02 (provisioner, `control/{tenants,provisioning}`) открывает PR с control-миграцией раньше W1.03 — W1.02 получает 0004, резерв W1.03 переходит на 0005. Автор PR переименовывает файл при rebase перед слиянием, а стюард правит эту таблицу в том же контрактном PR.
