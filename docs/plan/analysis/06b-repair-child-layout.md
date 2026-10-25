# 06b. «Ремонт и стройка»: карта модуля для этапа 6 (переписана W6.00, снимок design-2026-10-19)

Заменяет карту от 03.10 (906 строк по версии `Ремонт и стройка.dc.html` на 906 строк). Основание — разбор DoR W4.00 ч.1 `docs/plan/v2/analysis/dor/repair.md` (экспорт 19.10, 1707 строк) и контрактный PR W6.00 (`api/` `0.12.0-stage6`, `tools/gen/stage6-w600-spec.mjs`). Здесь — рабочая сводка для реализующих агентов W6.10–W6.26, W6.90: какой экран какими операциями питается, какие права и области нужны, где в БД лежат данные и какие значения проверять тестами.

## 1. Что изменилось против карты 03.10

| Было (карта 03.10) | Стало (W6.00) |
|---|---|
| Сущность в API — `object` или `project` (RS-08 открыт) | `RepairProject`, пути `/repairs/projects/{projectId}`, вид области `repair_project` (Q-W4.00-repair-1, -2) |
| Согласование сметы и подпись — кнопки «Демо:» | Публичный кабинет `/public/client/{clientToken}` (согласование, подпись по коду SMS), «Демо:»-кнопки не переносятся (Q-W4.00-repair-9) |
| Прогноз сдачи «01.12, +2 раб. дня» (расчёт 06b) | Считает порт `gsched` (`adapter/src/msw/repairs/calc.ts`), число проверяют тесты W6.17 |
| Права названы как в прототипе (`repair.view`, `repairs.worklogs.create`) | Ключи каталога `repairs.*` (21 ключ, семь новых: repairs.measurements.edit, repairs.documents.send, repairs.crew.accrue, repairs.crew.pay, repairs.subcontractors.manage, repairs.client_link.manage, repairs.projects.hand_over) |
| Модуль без домена и данных | Схема `repairs`, tenant 0050–0054, 28 таблиц; control 0010 — индекс публичных ссылок |

## 2. Экраны этапа 6 → операции

Ключ экрана — в `api/openapi/screens.yaml` (`stage: 6`). Эталон — `design-2026-10-19`.

| Ключ экрана | Страница или вкладка | WS | Операции |
|---|---|---|---|
| `repair-list` | Ремонт и стройка · Объекты | W6.20 | `listRepairProjects`, `createRepairProject`, `getMyDecisionQueue` |
| `repair-card` | Карточка объекта · Обзор | W6.20 | `getRepairProject`, `getRepairProjectOverview`, `updateRepairProject`, `activateRepairProject` |
| `repair-works` | Карточка объекта · Работы и допработы | W6.20 | `listRepairWorks`, `listWorkLogs`, `submitWorkLog`, `acceptWorkLog`, `returnWorkLog`, `listChangeOrders`, `proposeChangeOrder` |
| `modal-assign-foreman` | Назначить прораба? | W6.20 | `assignRepairForeman` |
| `repair-measure` | Карточка объекта · Замер | W6.21 | `getMeasurement`, `putMeasurement` |
| `repair-estimate` | Карточка объекта · Смета | W6.21 | `listEstimates`, `getEstimate`, `createEstimateFromTemplate`, `createEstimateRevision`, `updateEstimateDraft`, `sendEstimate`, `recallEstimate`, `deleteEstimateDraft`, `diffEstimates`, `rejectChangeOrder`, `listPriceItems`, `listTemplates`, `saveProjectAsTemplate` |
| `repair-schedule` | Карточка объекта · График | W6.23 | `getSchedule`, `createScheduleFromEstimate`, `previewScheduleChange`, `applyScheduleChange`, `setScheduleStageExecutor`, `createScheduleBaseline` |
| `repair-docs` | Карточка объекта · Документы | W6.24 | `listRepairDocuments`, `requestDocumentSignature`, `handOverRepairProject` |
| `repair-supply-tab` | Карточка объекта · Снабжение | W6.22 | `listSupplyRequests`, `createSupplyRequest`, `consumeSupplyRequest` |
| `repair-finance` | Карточка объекта · Финансы | W6.24 | `getProjectFinance` |
| `repair-pay` | Карточка объекта · Оплата бригады | W6.24 | `listCrewAccruals`, `accrueByAct`, `payoutAccruals` |
| `repair-subs` | Карточка объекта · Подрядчики | W6.24 | `listSubcontractors`, `setSubcontractorAccess` |
| `repair-client` | Карточка объекта · Кабинет заказчика | W6.24 | `getClientLink`, `issueClientLink`, `revokeClientLink` |
| `repair-catalog` | Шаблоны и расценки | W6.25 | `listPriceItems`, `createPriceItem`, `updatePriceItem`, `listTemplates`, `getTemplate`, `updateTemplate`, `copyTemplate` |
| `repair-supply` | Снабжение | W6.22 | `listSupplyRequests`, `reserveSupplyRequest`, `issueSupplyRequest`, `createPurchase`, `listPurchases`, `receivePurchase`, `listProjectStock`, `returnProjectStock`, `transferProjectStock` |
| `public-client-cabinet` | Кабинет заказчика (публичная страница) | W6.26 | `getClientCabinet`, `approveEstimateByClient`, `signDocumentByClient` |
| `repair-supply-request` | Заявка прораба на материал | W6.22 | `createSupplyRequest` |

Экраны без макета (B-6): `public-client-cabinet` (по превью 420 px вкладки «Кабинет заказчика», подпись вводом SMS-кода) и `repair-supply-request` (форма заявки прораба во вкладке «Снабжение»). Дорисовка — `design-requests.md`; до неё страницы делаются по документу и этому разбору, расхождения — `Q-W6.00-N`.

## 3. Операции тега Repairs (66)

Шаги: A — 6.1–6.3; B — 6.4–6.6. «Рев.» — If-Match. Все команды несут `Idempotency-Key`.

| Операция | Метод и путь | Права (режим) | Область | Рев. | Шаг |
|---|---|---|---|---|---|
| `listRepairProjects` | GET `…/repairs/projects` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `createRepairProject` | POST `…/repairs/projects` | `repairs.projects.manage` | `tenant-org-unit` | — | 6.1–6.3 |
| `getRepairProject` | GET `…/repairs/projects/{projectId}` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `updateRepairProject` | PATCH `…/repairs/projects/{projectId}` | `repairs.projects.manage` | `tenant-org-unit` | да | 6.1–6.3 |
| `getRepairProjectOverview` | GET `…/repairs/projects/{projectId}/overview` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `assignRepairForeman` | POST `…/repairs/projects/{projectId}/foreman` | `repairs.projects.manage` | `tenant-org-unit` | — | 6.1–6.3 |
| `activateRepairProject` | POST `…/repairs/projects/{projectId}/activate` | `repairs.projects.manage` | `tenant-org-unit` | да | 6.1–6.3 |
| `listRepairWorks` | GET `…/repairs/projects/{projectId}/works` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `listWorkLogs` | GET `…/repairs/work-logs` | `repairs.work_logs.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `submitWorkLog` | POST `…/repairs/work-logs` | `repairs.work_logs.submit` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `acceptWorkLog` | POST `…/repairs/work-logs/{workLogId}/accept` | `repairs.work_logs.review` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `returnWorkLog` | POST `…/repairs/work-logs/{workLogId}/return` | `repairs.work_logs.review` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `listChangeOrders` | GET `…/repairs/projects/{projectId}/change-orders` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `proposeChangeOrder` | POST `…/repairs/projects/{projectId}/change-orders` | `repairs.changes.submit` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `rejectChangeOrder` | POST `…/repairs/change-orders/{changeOrderId}/reject` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `getMeasurement` | GET `…/repairs/projects/{projectId}/measurement` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `putMeasurement` | PUT `…/repairs/projects/{projectId}/measurement` | `repairs.measurements.edit` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `listEstimates` | GET `…/repairs/projects/{projectId}/estimates` | `repairs.finance.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `getEstimate` | GET `…/repairs/projects/{projectId}/estimates/{version}` | `repairs.finance.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `createEstimateFromTemplate` | POST `…/repairs/projects/{projectId}/estimate-drafts` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `createEstimateRevision` | POST `…/repairs/projects/{projectId}/estimates` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `updateEstimateDraft` | PATCH `…/repairs/projects/{projectId}/estimates/{version}` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `sendEstimate` | POST `…/repairs/projects/{projectId}/estimates/{version}/send` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `recallEstimate` | POST `…/repairs/projects/{projectId}/estimates/{version}/recall` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `deleteEstimateDraft` | DELETE `…/repairs/projects/{projectId}/estimates/{version}` | `repairs.estimates.edit` | `tenant-org-unit-repair-project` | да | 6.1–6.3 |
| `diffEstimates` | GET `…/repairs/projects/{projectId}/estimates/{version}/diff` | `repairs.finance.read` | `tenant-org-unit-repair-project` | — | 6.1–6.3 |
| `saveProjectAsTemplate` | POST `…/repairs/projects/{projectId}/save-as-template` | `repairs.catalog.manage` | `tenant` | — | 6.1–6.3 |
| `listPriceItems` | GET `…/repairs/price-items` | `repairs.catalog.manage` или `repairs.estimates.edit` | `tenant` | — | 6.1–6.3 |
| `createPriceItem` | POST `…/repairs/price-items` | `repairs.catalog.manage` | `tenant` | — | 6.1–6.3 |
| `updatePriceItem` | PATCH `…/repairs/price-items/{priceItemId}` | `repairs.catalog.manage` | `tenant` | да | 6.1–6.3 |
| `listTemplates` | GET `…/repairs/templates` | `repairs.catalog.manage` или `repairs.estimates.edit` | `tenant` | — | 6.1–6.3 |
| `getTemplate` | GET `…/repairs/templates/{templateId}` | `repairs.catalog.manage` или `repairs.estimates.edit` | `tenant` | — | 6.1–6.3 |
| `updateTemplate` | PATCH `…/repairs/templates/{templateId}` | `repairs.catalog.manage` | `tenant` | да | 6.1–6.3 |
| `copyTemplate` | POST `…/repairs/templates/{templateId}/copy` | `repairs.catalog.manage` | `tenant` | — | 6.1–6.3 |
| `getSchedule` | GET `…/repairs/projects/{projectId}/schedule` | `repairs.schedule.read` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `createScheduleFromEstimate` | POST `…/repairs/projects/{projectId}/schedule/from-estimate` | `repairs.schedule.shift` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `previewScheduleChange` | POST `…/repairs/projects/{projectId}/schedule/preview` | `repairs.schedule.shift` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `applyScheduleChange` | POST `…/repairs/projects/{projectId}/schedule/changes` | `repairs.schedule.shift` | `tenant-org-unit-repair-project` | да | 6.4–6.6 |
| `setScheduleStageExecutor` | PATCH `…/repairs/projects/{projectId}/schedule/stages/{stageId}` | `repairs.schedule.shift` | `tenant-org-unit-repair-project` | да | 6.4–6.6 |
| `createScheduleBaseline` | POST `…/repairs/projects/{projectId}/schedule/baselines` | `repairs.schedule.baseline` | `tenant-org-unit` | да | 6.4–6.6 |
| `handOverRepairProject` | POST `…/repairs/projects/{projectId}/hand-over` | `repairs.projects.hand_over` | `tenant-org-unit-repair-project` | да | 6.4–6.6 |
| `listRepairDocuments` | GET `…/repairs/projects/{projectId}/documents` | `repairs.projects.read` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `requestDocumentSignature` | POST `…/repairs/documents/{documentId}/sign-requests` | `repairs.documents.send` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `listSupplyRequests` | GET `…/repairs/supply-requests` | `repairs.supply.manage` или `repairs.supply.request` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `createSupplyRequest` | POST `…/repairs/projects/{projectId}/supply-requests` | `repairs.supply.request` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `reserveSupplyRequest` | POST `…/repairs/supply-requests/{supplyRequestId}/reserve` | `repairs.supply.manage` | `tenant-org-unit` | да | 6.4–6.6 |
| `issueSupplyRequest` | POST `…/repairs/supply-requests/{supplyRequestId}/issue` | `inventory.movements.post` | `tenant-org-unit-warehouse` | да | 6.4–6.6 |
| `consumeSupplyRequest` | POST `…/repairs/supply-requests/{supplyRequestId}/consume` | `repairs.supply.request` или `repairs.work_logs.review` | `tenant-org-unit-repair-project` | да | 6.4–6.6 |
| `createPurchase` | POST `…/repairs/purchases` | `repairs.supply.manage` | `tenant-org-unit` | — | 6.4–6.6 |
| `listPurchases` | GET `…/repairs/purchases` | `repairs.supply.manage` | `tenant-org-unit` | — | 6.4–6.6 |
| `receivePurchase` | POST `…/repairs/purchases/{purchaseId}/receive` | `repairs.supply.manage` | `tenant-org-unit` | да | 6.4–6.6 |
| `listProjectStock` | GET `…/repairs/project-stock` | `repairs.supply.manage` | `tenant-org-unit` | — | 6.4–6.6 |
| `returnProjectStock` | POST `…/repairs/projects/{projectId}/stock/return` | `repairs.supply.manage` и `inventory.movements.post` | `tenant-org-unit` | — | 6.4–6.6 |
| `transferProjectStock` | POST `…/repairs/projects/{projectId}/stock/transfer` | `repairs.supply.manage` и `inventory.movements.post` | `tenant-org-unit` | — | 6.4–6.6 |
| `getProjectFinance` | GET `…/repairs/projects/{projectId}/finance` | `repairs.finance.read` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `listCrewAccruals` | GET `…/repairs/projects/{projectId}/accruals` | `repairs.finance.read` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `accrueByAct` | POST `…/repairs/acts/{documentId}/accruals` | `repairs.crew.accrue` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `payoutAccruals` | POST `…/repairs/accruals/payout` | `repairs.crew.pay` | `tenant-org-unit` | — | 6.4–6.6 |
| `listSubcontractors` | GET `…/repairs/projects/{projectId}/subcontractors` | `repairs.subcontractors.manage` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `setSubcontractorAccess` | PUT `…/repairs/projects/{projectId}/subcontractors/{subcontractorId}` | `repairs.subcontractors.manage` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `getClientLink` | GET `…/repairs/projects/{projectId}/client-link` | `repairs.client_link.manage` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `issueClientLink` | POST `…/repairs/projects/{projectId}/client-link` | `repairs.client_link.manage` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `revokeClientLink` | DELETE `…/repairs/projects/{projectId}/client-link` | `repairs.client_link.manage` | `tenant-org-unit-repair-project` | — | 6.4–6.6 |
| `getClientCabinet` | GET `/api/v1/public/client/{clientToken}` | публичная | `public-client-capability` | — | 6.4–6.6 |
| `approveEstimateByClient` | POST `/api/v1/public/client/{clientToken}/estimates/{version}/approve` | публичная | `public-client-capability` | — | 6.4–6.6 |
| `signDocumentByClient` | POST `/api/v1/public/client/{clientToken}/documents/{documentId}/sign` | публичная | `public-client-capability` | — | 6.4–6.6 |

## 4. Данные: таблицы схемы `repairs`

| Миграция | Таблицы | WS |
|---|---|---|
| `0050_repairs_core.sql` | `projects`, `workers`, `works`, `work_logs`, `work_log_lines`, `change_orders`, `project_events` | W6.11 |
| `0051_repairs_estimates.sql` | `measurements`, `price_items`, `templates`, `template_lines`, `template_stages`, `estimates`, `estimate_sections`, `estimate_lines` (`line_key` — стабильный ключ строки между версиями) | W6.12 |
| `0052_repairs_schedule.sql` | `schedule_stages`, `schedule_links`, `schedule_baselines`, `schedule_changes`, `work_calendars` | W6.14, W6.17 |
| `0053_repairs_supply.sql` | `supply_requests`, `purchases`, `purchase_lines`, `project_stock` | W6.13 |
| `0054_repairs_documents_cabinet.sql` | `documents`, `crew_accruals`, `subcontractors`, `client_links` | W6.15, W6.16 |
| control `0010_public_client_links.sql` | `public_client_links` (дайджест токена → тенант, объект, ссылка) | W6.15 |

Лента объекта и журнал переносов — только INSERT (`roles/grants.sql`). Задача заявки (`lead_task_id`), склад и касса — идентификаторы без внешних ключей (модуль пишет только в свою схему).

## 5. Контрольные числа для тестов (прогон логики макета)

Проверяются в `adapter/test/repairs-calc.test.ts` и должны повторить тесты домена W6.10 и W6.17.

| Показатель | Значение |
|---|---|
| Замер кв. 42 | пол 46,82 м², стены 134,24 м², периметр 53,2 м; санузел — пол 3,74, стены 19,66 |
| Формулы объёма | семь: площадь пола, пол без санузлов, площадь стен, стены без санузлов, санузлы (пол и стены вместе), периметр, периметр без санузлов; штуки, мешки, рейсы, комплекты и литры — вверх, остальное — до десятых |
| Версии сметы кв. 42 | v1 404 418 ₽, v2 438 175 ₽ (основа договора № 42) |
| Финансы от v2 | аванс 30 % — 131 453 ₽, маржа 27 % — 118 307 ₽ |
| Допработа ДР-1 | 6 × 1 500 + 9 × 450 = +13 050 ₽ |
| Дом в Истре по шаблонам | «Ремонт под ключ · дом» 1 078 533 ₽, капитальный 857 713, косметический 308 600, коммерческий 830 345 |
| Календарь | день 0 — пн 05.10.2026, праздник 04.11, «сегодня» — 20.10.2026 (Q-W4.00-repair-15) |

## 6. Права и видимость

- Прораб видит только свои объекты без черновиков; суммы, сметы, финансы, оплату бригады, подрядчиков и кабинет заказчика сервер ему не отдаёт (`RepairProject.budget`, `clientPhone`, `Estimate`, `SupplyRequest.cost` — только с нужным правом). Схемы отметки, допработы, работ, графика, замера и заявки прораба без `Money`.
- «Принять объём» — одна команда `acceptWorkLog` для обзора, «Главной» и вкладки «Работы»; повтор — 409 `work_log_already_reviewed`.
- Кнопка «Открыть смету» в «Замере» без права финансов скрыта (Q-W4.00-repair-24); «Шаблоны и расценки» и «Снабжение» — по `repairs.catalog.manage` и `repairs.supply.manage` (Q-W4.00-repair-8).

## 7. Решения по умолчанию, принятые контрактом (без ответа владельца)

См. `docs/plan/v2/reports/W6.00.md`, раздел «Осталось fixme / открытые вопросы» — вопросы `Q-W6.00-N` и значения, по которым сделано.
