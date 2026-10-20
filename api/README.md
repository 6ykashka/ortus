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

## Этап 1, второй PR (W1.00, `0.4.0-stage1`)

- Оператор: команды `suspendPlatformTenant`, `resumePlatformTenant`, `extendPlatformTrial` с обязательной причиной и журнал `listPlatformAuditEvents` (`platform_audit`).
- Компания: `createMember` (карточка без аккаунта), функции с периодом `listWorkProfiles` / `createWorkProfile` / `updateWorkProfile`, `previewOrgUnitMove`, `previewModuleDeactivation`, `getStorageBreakdown`, `listFiles`; `TenantContext.tenantState` для баннеров оболочки.
- Канал реального времени (ADR-0015, PD-58): `createRealtimeTicket` выдаёт одноразовый билет; WebSocket `GET /api/v1/realtime` (подпротокол `ortus.realtime.v1`) не входит в `paths` — его кадры описаны схемами `RealtimeClientMessage` и `RealtimeServerMessage`, на которые ссылается расширение `x-realtime` операции билета. Шлюз — W1.07.
- Новые операции не добавлены в тег `Context`: его реализует `mehttp.Server` целиком (`StrictServerInterface`), и новая операция сломала бы сборку `cmd/api`. Реализации тегов `Platform`, `Access`, `Files`, `Billing`, `Modules`, `Auth` после rebase на этот PR добавляют методы новых операций (501 до своего шага).

## Этап 2 (W2.00, `0.5.0-stage2`)

- Тег `Home` — «Главная · Требует решения» (`getMyDecisionQueue`, `GET /api/v1/me/decisions?tenantId=`): персональная лента по одной организации, как входящие (`x-scope: identity`, `x-permissions: []`); каждый модуль регистрирует источник (W2.09), источник фильтрует карточки правами участника. Реализацию тега в `cmd/api` даёт поле `Servers.Home` (`nil` → 501 до W2.09). Группа компонентов `components/home/`.
- Рейс от плана до приёмки — `TripPlan` (`listTripPlans`, `getTripPlan`, `createTripPlan`): та же строка `fleet.trips`, что и `Trip` 0.1 после `startTrip` (тот же `id` и ETag). Назначение машины логистом — `assignTripVehicle`, «Завершить рейс» — `finishTripRoute`.
- Очередь блокирующих дефектов (S2-17, D-29 комплекта) — `listInspectionDefects`, `getInspectionDefect`, `decideInspectionDefect` (`allow_departure` | `confirm_out_of_service`); структурные дефекты — `InspectionCreate.defects`.
- Приёмка: `TripReview.decision` + `rework`, разделы `steps[]` (`ReworkStep`); список начислений — `listTripEarnings` (тег `Earnings`).
- Расширение перечисления (`kind: change` в `source-delta.yaml`) допустимо только как надмножество значений 0.1 — правило проверяет `tools/gen/stage2.test.mjs`.

## Этап 2, аддитивный PR для показа (W2.40, `0.5.1-stage2`)

- Категории расходов — ответ владельца продукта 17.10 на D-12 комплекта (`docs/plan/v2/po-answers-2026-10-17.md`, ADR-0013): `TripExpenseCreate.kind`, `TripExpense.kind` — `fuel`, `wash`, `parking`, `toll`, `tire_service` («Шиномонтаж и мелкий ремонт»), `other`; у `other` комментарий обязателен — 422 `validation_failed` (поле `comment`, «Для категории «Прочее» добавьте комментарий»). Штрафы — не расход. Справочник категорий тенанта — после показа (W2.41), коды остаются.
- `TripPlan.legalEntityId` — юрлицо рейса, nullable, только чтение (`fleet.trips.legal_entity_id`, tenant 0013); заполнение юрлицом фирмы по умолчанию — W2.05. `Trip` 0.1 не меняется.

## Этап 2, стюард контракта, часть 1 (W2.51, `0.6.0-stage2`)

- Пул водителей (S2-14, AUTH-06/07, AC-06): публикация водителя фирмой-источником — `listDriverPoolPublications`, `publishDriverToPool`, `getDriverPoolPublication`, `withdrawDriverPoolPublication` (`/fleet/driver-pool/publications`). Права — существующие: чтение `fleet.driver_transfers.read`, публикация и снятие `fleet.driver_transfers.approve` (`x-scope: source-manager-or-owner`); новых ключей и кодов ошибок нет, `driver_unavailable` 0.1 — `resources_unavailable`.
- Каталог пула (`DriverAvailability`) — псевдоним «Водитель #N», квалификации, окно, условия, домашняя фирма (`homeOrgUnitName`) и ссылка каталога `publicationId`; имени, контактов, ставок и истории нет.
- Запрос (`DriverTransfer`): `status` + `completed` (надмножество 0.1), комментарий, рейс, автор и время запроса и решения, временное назначение `grant` (`TemporaryDriverGrant`: `scheduled` → `active` → `closing` → `ended`). Автозавершение по `window.endsAt`; начатый рейс закрывается в `closing` (D09); после завершения или отзыва временный водитель получает 404 по рейсу (AC-06). Один открытый запрос на опубликованного водителя (эталон `api.js:544`). `listDriverTransfers` — фильтры `direction` (`incoming` | `outgoing`) и `status`.
- «Данные» (S2-16, AC-14): наборы этапа 2 `fleet.vehicles` «Автомобили», `fleet.trips` «Поездки», `fleet.expenses` «Расходы» — поля и права в описании `Dataset.id`. `Dataset` — `permissionKey`, `entityType`, `exportAllowed`, `hiddenFieldLabels`, `defaultSort`; `FieldDescriptor.options`; `DatasetQuery` — `search` («По любому видимому полю»), `includeCount`; `DatasetQueryResult` — `visibleCount` (до 10 000), `visibleCountCapped`.
- tenant 0014 — индекс `sched.reservations (bundle_id)` (Q-W2.02-14) и поля пула: псевдоним, условия, ревизия и снятие публикации, без пересечения активных публикаций водителя; комментарий, решение и автозавершение запроса, один открытый запрос на публикацию.

## Этап 2, стюард контракта, часть 2 (W2.52, `0.6.1-stage2`)

Ответы владельца продукта 17.10 (`docs/plan/v2/po-answers-2026-10-17.md`) — работы после показа W2.41…W2.50; только добавления, новых ключей прав и кодов ошибок нет.

- Справочник категорий расходов тенанта (D-12 комплекта, W2.41): `listExpenseCategories` (`fleet.expenses.read`), `createExpenseCategory`, `archiveExpenseCategory` (`modules.settings.manage` — настройки модуля). `TripExpense(Create).kind` — код справочника (шаблон вместо перечисления); шесть кодов посева `fuel`, `wash`, `parking`, `toll`, `tire_service`, `other` валидны в каждом тенанте; `commentRequired` у `other` — всегда.
- История машины (модель данных п. 2, W2.42): `listVehicleAssignments`, `moveVehicle` (`/fleet/vehicles/{vehicleId}/assignments`), `Vehicle.orgUnitSince`.
- Антифрод фото (модель данных п. 4, W2.43): `FileDuplicateWarning` у `File` (`completeUpload`, `getFile`) и у фото осмотра; `InspectionPhoto.serverCapturedAt` — время приёма сервером, `capturedAt` устройства — только подсказка.
- Чек-лист — форма (D-30 комплекта, W2.45): `InspectionChecklist.definition` (`FormDefinition`), `FormField.blockingValues`.
- Поля задачи у дефекта в очереди (D-29 комплекта, W2.46): `assignInspectionDefect`, `InspectionDefect.assigneeMemberId`, `dueAt`.
- Заменители интеграций (D-11 комплекта, W2.50): импорт CSV машин `createVehicleImport` / `getVehicleImport` / `commitVehicleImport`; выгрузка CSV `exportDataset` (тег Data, `data.export` + право набора, POST-чтение); адрес остановки для ссылки навигатора `TripStop.navigationAddress`.
- tenant 0015–0017 — см. реестр ниже.

## Этап 2, W2.57 (`0.6.2-stage2`)

Контрактная дельта решения владельца продукта 18.10 по Q-W2.07-1 — временный водитель «только рейс» (уточнение S2-14, приёмка AC-06); исполнитель W2.57 — стюард дельты. Только добавления и надмножество перечисления; новых операций, ключей прав и кодов ошибок нет.

- Роль «Временный водитель» (`role_templates.temporary_driver`, `kind: system`, функция `driver`): `fleet.trips.read/start/return`, `fleet.inspections.read/submit`, `fleet.expenses.read/create`, `fleet.routes.read`, `fleet.reservations.read`, `files.read/upload` — в области `self`; `fleet.vehicles.read` (`resource_actions`) — строкой той же роли в области `resource` на машину рейса до конца окна. Без задач, базы знаний, календаря, начислений, создания и снятия броней; вручную не назначается (системная роль — 409 `createAssignment`). Назначение создаёт одобрение перевода (`source = 'transfer'`, `valid` — окно).
- Продолжение начатого рейса (D09): после окна или отзыва рейс в `on_route`, `returning`, `submitted`, `rework` — только сдача, осмотр сдачи, расходы и фото этого рейса, остальное — 404. Приёмка, отмена и снятие водителя с рейса гасят назначение сразу.
- Продление: `decideDriverTransfer` с `decision: extend` и `endsAt`; просрочка (`TemporaryDriverGrant.overdue`) и машина рейса (`vehicleId`) — в назначении.
- tenant 0018 — `fleet.driver_transfers.vehicle_assignment_id`.

## Этап 4, W4.02 (`0.7.0-stage4`)

Контрактный PR 1 этапа 4 (часть 2 W4.00) — общий PR для оценщика W4.01 (`docs/plan/v2/analysis/dor/README.md`, «Порядок контрактных PR этапа 4», п. 1). Стюард контракта этапа 4 выдаёт версии и номера миграций блока tenant 0020–0039 по порядку вливания PR 2–6 (tasks, knowledge, forms, календарь и «Данные», billing и branding).

- Виды областей (ADR-0014 п. 3, 7): `Scope.kind` и `Permission.allowedScopeKinds` + `space`, `page`, `folder`, `doc`, `account`, `chat`, `relation`, `repair_project`; каталог прав (`SCOPE_KINDS`) — те же имена. Имена каталога и SQL совпадают с `Scope.kind`, кроме `unit` ↔ `org_unit` и `resource` ↔ `resource_pool`. Объект ремонта — `repair_project` (Q-W4.00-repair-2), `project` — только проект «Задач» (RS-08). `relation` — вычисляемая связь с записью, как `self`, без `resourceIds` и `scope_ref`; остальные новые — ровно один объект своего вида. До регистрации вида в оценщике назначение вида — 422, хранимый грант не даёт ничего (fail-closed).
- `explainAccess` с объектом: расширение `x-explain-objects` — пары `objectModule`/`objectType` и вид области каталога, на который отвечает объект (проект задач, пространство и узел БЗ, склад, ресурсный пул); прочие пары — 422 до PR своего модуля. Запрос с подразделением или объектом проверяет `permission`, затем `resource-scope`.
- `files.purpose: task_attachment` (владелец `tasks/task`, группа места «Вложения задач и форм»); родителя регистрирует W4.11, до него `initiateUpload` — 422.
- `Problem.reason` — машиночитаемая причина внутри кода; реестр — `codes.<code>.reasons` в `api/errors.yaml` (поля `title`, `ui` — текст прототипа, `source`; только добавление). Причина примера проверяется по реестру своего кода.
- `screens.yaml` — экраны этапа 4 из DoR W4.00 с эталоном `design-2026-10-19 · …` (обязателен для этапов 4+); операции новых модулей добавляют их PR.

## Этап 4, W4.06 (`0.7.0-stage4`)

Контрактный PR 5 этапа 4 (README DoR «Порядок контрактных PR», п. 5): календарь ресурсов (W4.40, W4.41), сохранённые виды и выгрузка заданием «Данных» (W4.50). Только добавления; новых ключей прав и кодов ошибок нет. Номер версии и номера миграций при вливании согласует интегратор (параллельно — контрактные PR 1–4 и 6).

- Календарь: `listCalendarResources` (ресурсы — `sched.resources`; машины — только с `fleet.vehicles.read` и при активном модуле); `listCalendarBookings` — окно `from`/`to` (день или неделя, ≤ 7 суток), `kind`, `orgUnitId`, `resourceId`; брони модулей видны, только если участник читает их объект (рейс, визит). `Booking` — `prepMinutes`, `cleanupMinutes`, `occupied` (занятость с буферами), `sourceKind`, `rescheduleLock` (тексты запрета эталона). Перенос — `updateCalendarBooking` (0.1): все ресурсы брони атомарно с буферами, конфликт — 409 `resources_unavailable` с текстом «Конфликт ресурсов: …»; слоты — `findCalendarAvailability` с `excludeBookingId` (шаг 15 минут, 3 слота, рабочий день ресурса).
- «Данные»: виды набора (`/datasets/{datasetId}/views`) — `data.query` + право набора; общий вид публикует автор с `data.export` или владелец. Задания выгрузки (`/datasets/{datasetId}/export-jobs`, журнал `/data/export-jobs`) — `data.export` + право набора, до 100 000 строк, срок файла 24 ч, не больше 3 активных заданий участника; права перепроверяются при запуске и при каждом скачивании (сужение — отзыв).
- tenant 0021–0022 — см. реестр ниже (в ветке W4.06 — 0020–0021; при вливании после W4.02 перенумерованы интегратором).

## Этап 2, W2.71 (`0.7.1-stage4`)

Контрактная дельта S2-20 «Машина для временного водителя» — решение владельца продукта 19.10 по Q-W2.32-1 (D-35 комплекта, `design/docs/29-temporary-driver-vehicle.md`, макеты 1a–1g); исполнитель W2.71 — стюард дельты. Добавления, расширения перечислений и подпись `fleet.reservations.manage` по эталону 19.10b.

- Право `fleet.reservations.choose` (create, self) — в шаблоне «Водитель» и в системной роли «Временный водитель»: выбрать одну из броней, предложенных на свой рейс; создавать брони временный водитель не может (403). Действующие роли организаций право не получают (AUTH-09, Q-W2.70-7).
- Обычная машина водителя — `DriverPoolPublication.usualVehicleId`; в каталоге — `DriverAvailability.usualVehicle` с совместимостью для `?tripId=`.
- Запрос водителя — `vehicle { mode: home | host | host_or_home, hostVehicleId }`; решение — `approve` (с машиной), `approve_driver_only`, `reject` с причиной в `comment`. Одобрение создаёт брони одной транзакцией: две машины — `held` до `chooseUntil` (начало окна − 30 мин) в одной группе `offerGroupId`; одна — `confirmed`.
- Выбор — `chooseReservation` (`POST /fleet/reservations/{reservationId}/choose`, `{ chosen, released[] }`, идемпотентна, 409 `offer_closed`, 404 — не предложена); логист — «Оставить …» тем же вызовом с `fleet.reservations.manage`. Реализация тега в `cmd/api` — 501 до W2.72.
- «Требует решения» логиста — `fleet.vehicle_choice_pending`, `fleet.trip_without_vehicle`.
- tenant 0023 (в ветке — 0019; влит после W4.02 и W4.06, версия ветки 0.6.3-stage2 → 0.7.1-stage4) — обычная машина публикации, режим и машины запроса, брони предложения (`sched.reservations`).

## Номера миграций (PD-59)

Номер выдаёт стюард контракта из блока этапа (план v2 §3.5). Выданные и зарезервированные номера:

| БД      | Номер     | Файл / назначение                                                                                                                                                                                                        | Кто                                     |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| tenant  | 0001–0002 | `0001_core.sql`, `0002_fleet.sql` — копии v0.2                                                                                                                                                                           | W0.06                                   |
| tenant  | 0003      | `0003_notify_inbox.sql` — входящие уведомления                                                                                                                                                                           | W0.08 (1.9)                             |
| tenant  | 0004      | `0004_files_upload_sessions.sql` — сессии загрузки                                                                                                                                                                       | W0.08 (1.8)                             |
| tenant  | 0005      | `0005_people_imports.sql` — импорт CSV людей                                                                                                                                                                             | W0.08 (1.5)                             |
| tenant  | 0006      | `0006_access_groups.sql` — ревизия и владелец группы                                                                                                                                                                     | W0.08 (1.6)                             |
| tenant  | 0007      | `0007_outbox_dead_letter.sql` — dead-letter `outbox.events` в модели W1.01 (причина, индекс списка)                                                                                                                      | W1.00 (1.1, для W1.01)                  |
| tenant  | 0008–0009 | резерв этапа 1 (очередь)                                                                                                                                                                                                 | W1.00                                   |
| tenant  | 0010      | `0010_fleet_defect_queue.sql` — решение по блокирующему дефекту, очередь `fleet.defects` (S2-17)                                                                                                                         | W2.00 (2.4, для W2.04)                  |
| tenant  | 0011      | `0011_fleet_trip_rework.sql` — попытка осмотра (повторная сдача), `fleet.trip_reviews` (rework + разделы)                                                                                                                | W2.00 (2.7, для W2.06)                  |
| tenant  | 0012      | `0012_fleet_trip_plan.sql` — поля плана рейса (`title`, груз, расстояние) и машины (название, склад, отметка)                                                                                                            | W2.00 (2.1–2.3)                         |
| tenant  | 0013      | `0013_fleet_expense_kinds_trip_legal_entity.sql` — категория `tire_service` и «прочее → комментарий» в `fleet.expenses`, `fleet.trips.legal_entity_id`                                                                   | W2.40 (2.6, для W2.05)                  |
| tenant  | 0014      | `0014_fleet_driver_pool_reservation_bundle.sql` — индекс `sched.reservations (bundle_id)`, поля публикации и запроса пула, автозавершение                                                                                | W2.51 (2.9, для W2.07, W2.02)           |
| tenant  | 0015      | `0015_fleet_expense_categories.sql` — справочник категорий расходов тенанта с посевом шести кодов, `fleet.expenses.category` → FK справочника                                                                            | W2.52 (для W2.41)                       |
| tenant  | 0016      | `0016_fleet_vehicle_assignments_imports.sql` — история принадлежности машины фирмам (`fleet.vehicle_assignments`), импорт CSV машин                                                                                      | W2.52 (для W2.42, W2.50)                |
| tenant  | 0017      | `0017_fleet_inspection_evidence_tasks.sql` — антифрод фото (индекс sha256, серверное время и повтор у фото осмотра), `checklist_versions.definition` (FormDefinition), поля задачи у дефекта, адрес навигатора остановки | W2.52 (для W2.43, W2.45, W2.46, W2.50)  |
| tenant  | 0018      | `0018_fleet_driver_transfer_vehicle_grant.sql` — назначение роли «Временный водитель» на машину рейса (`fleet.driver_transfers.vehicle_assignment_id`, область `resource`)                                               | W2.57 (2.9, Q-W2.07-1)                  |
| tenant  | 0019      | не занят: блок этапа 2 закрыт, W2.71 получил 0023 (порядок вливания ниже)                                                                                                                                                | W2.52                                   |
| tenant  | 0020      | `0020_access_scope_kinds_stage4.sql` — `access.role_assignments.scope_kind`: виды этапов 4–7 (`space`, `page`, `folder`, `doc`, `account`, `chat`, `relation`, `repair_project`), `relation` без `scope_ref`             | W4.02 (контрактный PR 1 этапа 4, W4.01) |
| tenant  | 0021      | `0021_sched_calendar_bookings.sql` — подписи, рабочий день и пояс ресурсов (`sched.resources`), бронь календаря `sched.bookings` (буферы, вид источника, статус, ревизия)                                                | W4.06 (4.4, для W4.40)                  |
| tenant  | 0022      | `0022_data_views_export_jobs.sql` — схема `data`: сохранённые виды `data.saved_views`, задания выгрузки `data.export_jobs`                                                                                               | W4.06 (4.5, для W4.50)                  |
| tenant  | 0023      | `0023_fleet_temporary_driver_vehicle_offer.sql` — машина для временного водителя: обычная машина публикации, режим и машины запроса, брони предложения (`offer_group_id`, `offered_to`, `choose_until`); в ветке — 0019  | W2.71 (S2-20)                           |
| tenant  | 0024–0039 | резерв этапа 4 (очередь: PR tasks, knowledge, forms, billing и branding — по порядку вливания)                                                                                                                           | W4.02                                   |
| control | 0001–0003 | `0001_init.sql`, `0002_billing.sql`, `0003_branding.sql` — копии v0.2                                                                                                                                                    | W0.06                                   |
| control | 0004      | `0004_accounts_last_tenant.sql` — `accounts.last_tenant_id` (переключатель бизнеса, `MeContext.lastTenantId`)                                                                                                            | W1.00 (1.3, для W1.03)                  |
| control | 0005      | `0005_idempotency_keys.sql` — ключи идемпотентности команд control-plane (оператор, `/me`)                                                                                                                               | W1.00 (1.1, для W1.01)                  |
| control | 0006+     | резерв этапа 1 (очередь: provisioner W1.02, сессии BFF W1.03)                                                                                                                                                            | W1.00                                   |

Номера control 0004–0005 и tenant 0007 выданы W1.00 вместе с файлами миграций: исполнители W1.01 и W1.03 используют эти файлы и не создают свои под теми же номерами; изменение схемы — новой миграцией из резерва через стюарда. Резерв — это очередь, а не закреплённый номер. Проверка CI (`tools/ci/check-migrations.mjs`) требует номеров без дыр, поэтому стюард этапа 1 (W1.00) выдаёт окончательный номер при открытии PR с миграцией, в порядке слияния. Если раньше откроется PR другого WS той же БД, он получает следующий свободный номер, а резерв переносится на номер после него. Пример: W1.02 (provisioner, `control/{tenants,provisioning}`) открывает PR с control-миграцией раньше W1.03 — W1.02 получает 0004, резерв W1.03 переходит на 0005. Автор PR переименовывает файл при rebase перед слиянием, а стюард правит эту таблицу в том же контрактном PR.

**Порядок вливания номеров ниже применённого (W4.02, возврат 1).** Раннер (`backend/migrations/runner.go`, goose v3.29.0) создаёт провайдер без `WithAllowOutofOrder`: номер ниже уже применённого на существующей БД не накатывается — пока новых файлов нет, `Up` его молча пропускает, а следующая миграция падает ошибкой goose «missing migrations» (`TestStage4W402LateLowerVersionRefused`). Поэтому незанятый хвост закрытого блока резервом остаётся только до первой миграции следующего блока. Tenant 0019 (W2.71, S2-20) вливается раньше 0020 (W4.02). Если 0020 уже в `main`, W2.71 при rebase берёт следующий номер очереди этапа 4 (0021, стюард этапа 4 правит таблицу), а 0019 остаётся незанятым. При вливании пакета W4.02 + W4.06 0020 (W4.02) и 0021–0022 (W4.06) попали в `main` раньше W2.71 — его миграция получает следующий свободный номер, 0023 (выдан при вливании W2.71, версия 0.7.1-stage4). Если 0020 попал на БД раньше 0019 (стенды слотов, стенд показа), стенд пересоздаётся (`down -v`, `up`, `migrate`, `seed`), строку версии руками не правят.
