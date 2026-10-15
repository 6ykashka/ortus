# 13 · DoR этапа 1 «Платформа»: истории S1-01…S1-30 ↔ экраны снимка `design-stage-1` ↔ контракт

Составил W1.00 (DoR-сверщик и стюард контракта этапа 1) 15.10.2026. Эталон — снимок `design-stage-1` (= `design/` на `main`, `git diff design-stage-1 HEAD -- design` пуст; состав и хеши — `design/MANIFEST.md`). Истории — `design/docs/13-backlog-s0-s2.md`. Контракт — `api/dist/ortus.bundle.yaml` `0.4.0-stage1`, экраны — `api/openapi/screens.yaml` (поля `stories`, `reference`, `storiesWithoutScreen`; проверка — `tools/gen/stage1b.test.mjs`). Подробности экранов — анализы 01 (оболочка), 02 (компания), 04 (оператор), 06 §8 («Файлы»); экраны без эталона — `docs/plan/v2/design-requests.md`.

## 1. Как сверялось

1. Снимок: `design/` совпадает с тегом `design-stage-1`; модульные `.dc.html` этапов 4–7 отсутствуют (B-1) — этапу 1 не мешает.
2. Каждая история S1-01…S1-30 сопоставлена с экраном эталона: подписи искались в `Ортус CRM.dc.html` и `ortus/*.js` снимка дословно (таблица §4). Найдено 20 из 23 подписей; нет «Сессия истекла», «Данные изменились» и «Нужен вход» — состояния S1-30 и экран входа без эталона.
3. Для каждой истории проверен DoR бэклога 13 «Готовность истории»: требование и критерий, операции в OpenAPI с `x-permissions`, `x-scope`, примерами; права в каталоге; таблицы в модели данных; состояния экрана; негативный сценарий доступа; зависимости. Пробелы контракта закрыты вторым контрактным PR этапа (`0.4.0-stage1`, CHANGELOG), остальное — в §3.
4. Страниц у W1.00 нет: проходка Playwright MCP не выполнялась; визуальную сверку страниц делают проверяющие W1.2x против того же снимка.

## 2. Матрица историй

Обозначения столбца «DoR»: **готова** — эталон, контракт, права и таблицы есть; **no-reference** — контракт готов, экрана нет в эталоне (allowlist `no-reference`, PD-48, PD-26); **без экрана** — серверная история, проверяется тестами и изоляцией.

| История | Экран (`screens.yaml`) | Эталон `design-stage-1` | Операции контракта | WS (Б / Ф) | DoR | Расхождения и решения по умолчанию |
|---|---|---|---|---|---|---|
| S1-01 создание организации | `platform-tenant-create`, `platform-tenants` | нет: в оболочке оператора создания организации нет (04 §2) | `createPlatformTenant`, `getPlatformTenant`, `listPlatformTenants` | W1.02 / W1.25 | no-reference | экран — design-requests (W1.00) |
| S1-02 resolver | — | — | шлюз `cmd/api` | W1.02 | без экрана | строки изоляции `me.yaml` |
| S1-03 migration controller | — | — | `cmd/migrate` | W1.02 | без экрана | — |
| S1-04 приостановка, возобновление, продление | `platform-tenants` | `pg.tenants` «Организации-клиенты», кнопки «Продлить пробный период на 14 дней», «Ограничить новые операции», «Снять ограничение», «Журнал действий» (04 §5.1) | `suspendPlatformTenant`, `resumePlatformTenant`, `extendPlatformTrial`, `listPlatformAuditEvents` (W1.00) | W1.11 / W1.25 | готова | поля «Причина» в диалогах эталона нет — обязательное поле добавляется (S1-04, PLAT-02), design-requests; «Ограничить» = `suspended`; «Снять ограничение» — в состояние подписки; кнопка продления скрыта для оплаченной подписки (04 §6 п. 4) |
| S1-05 вход BFF | `auth-login` | нет (демо-селектор «Персонаж») | `startLogin`, `completeLogin`, `getCsrfToken`, `logout` | W1.03 / W1.22 | no-reference | B-6 №1 |
| S1-06 принятие приглашения | `auth-invitation`, `modal-invite` | частично: письмо «Принять приглашение» в «Оформлении»; `mInvite` (01 §14.4) | `inspectInvitation`, `acceptInvitation`, `inviteMember` | W1.03 / W1.22, W1.23 | no-reference (экран принятия) | B-6 №2 |
| S1-07 переключатель бизнеса | `tenant-switch`, `shell` | нет (имя организации в шапке, 01 §10.2) | `selectTenant`, `getMyContext`; control 0004 `accounts.last_tenant_id` (W1.00) | W1.03 / W1.20 | no-reference | B-6 №3 |
| S1-08 регионы и фирмы, влияние переноса | `company-structure` | нет: структура только читается | `listOrgUnits`, `createOrgUnit`, `updateOrgUnit`, `previewOrgUnitMove` (W1.00) | W1.05 / W1.23 | no-reference | design-requests «org-structure» |
| S1-09 карточка без аккаунта, функция с периодом | `member-card` | частично: «карточка без входа (бригада)» в «Не занимают место» (02 §7) | `createMember`, `listWorkProfiles`, `createWorkProfile`, `updateWorkProfile` (W1.00) | W1.05 / W1.23 | no-reference | карточка места не занимает (эталон: «Рабочего без входа можно вести карточкой бесплатно») |
| S1-10 импорт CSV | `company-people-import` | нет | `createPeopleImport`, `getPeopleImport`, `commitPeopleImport` | W1.05 / W1.23 | no-reference | B-6 №6; машины — W2.00 |
| S1-11 оценщик | — | косвенно: AccessGate, меню | все операции (`x-authorization-order`) | W1.04 | без экрана | ADR-0014, PD-53 |
| S1-12 редактор роли | `modal-create-role`, `company-users` | `mRole`, вкладка «Роли» (01 §14.5, 02 §6) | `createRole`, `updateRole`, `listRoles` | W1.06 / W1.23 | готова | блок «Касса · остаток и лимиты» — `out-of-stage` до W5.33 |
| S1-13 назначение с областью и сроком | `modal-assign`, `modal-group`, `company-users` | `mAssign` (01 §14.3); группы — кнопка выключена | `createAssignment`, `revokeAssignment`, группы | W1.06 / W1.23 | готова (группы — no-reference) | области «Касса», «Проект» — `out-of-stage` |
| S1-14 «Почему доступно» | `modal-explain-access` | нет | `explainAccess` | W1.06 / W1.23 | no-reference | design-requests «explain-access» (W1.00) |
| S1-15 отзыв ≤ 5 с | `shell` | косвенно: меню и AccessGate меняются | `createRealtimeTicket`, `getMyContext` (ADR-0015) | W1.07 / W1.20 | готова (без визуала) | подсказка `context.changed`; сервер проверяет `policy_version` на каждом запросе |
| S1-16 последний владелец, передача | `modal-transfer-owner` | частично: тост «Нельзя снять роль с последнего владельца» | `listOwners`, `transferOwnership`, `revokeOwnership` | W1.06 / W1.23 | no-reference | design-requests «owner-transfer» |
| S1-17 каталог модулей | `company-modules` | `pg.modules` «Модули и место» (02 §5) | `listModuleCatalog`, `setModuleInstallation` | W1.08 / W1.24 | готова | — |
| S1-18 отключение: предпросмотр → draining | `modal-module-disable`, `company-modules` | confirm «Отключить «{name}»?», «Затронет сейчас», «Активных процессов нет» (02 §5.5) | `previewModuleDeactivation` (W1.00), `setModuleInstallation` | W1.08 / W1.24 | готова | пункт меню «Отключены · только чтение» (D-23 комплекта) |
| S1-19 trial / grace / read_only | `shell`, `company-modules` | баннер «Пробный период завершён.» (01 §11 №1) | `TenantContext.tenantState` (W1.00), `getTenantSubscription` | W1.08 / W1.20 | готова | баннер виден всем участникам без `billing.read` |
| S1-20 сессия загрузки | `modal-upload`, `core-files` | нет общего диалога; загрузка внутри осмотров | `initiateUpload`, `getUploadSession`, `completeUpload`, `abortUpload` | W1.09 / W1.24 | no-reference (диалог) | — |
| S1-21 скачивание с проверкой родителя | `core-files` | `pg.files` «Файлы» (06 §8) | `listFiles` (W1.00), `getFileDownload`, `getFile` | W1.09 / W1.24 | готова | «Открыть» — короткая ссылка, а не тост демо |
| S1-22 «Хранилище» | `company-storage` | частично: блок «Место организации» (02 §5.4) | `getStorageUsage`, `getStorageBreakdown` (W1.00), `requestStorageChange` | W1.09 / W1.24 | no-reference | B-6 №5; группы — подписи эталона |
| S1-23 аудит | `platform-tenants` | «Журнал действий» оператора | `listPlatformAuditEvents` (W1.00) | W1.01, W1.11 / W1.25 | готова (журнал оператора) | журнала организации для владельца в эталоне нет — вопрос §3 п. 4 |
| S1-24 outbox worker | — | — | — (tenant 0007) | W1.01 | без экрана | ручной повтор — команда `cmd/worker` |
| S1-25 idempotency | — | — | заголовок `Idempotency-Key`; control 0005 | W1.01 | без экрана | — |
| S1-26 входящие | `inbox` | частично: поповер «Уведомления», «Прочитать все», «Новых событий нет» (01 §10.3) | `listMyNotifications`, `getMyNotificationSummary`, `markMyNotificationsRead`, `createRealtimeTicket` | W1.10 / W1.22 | no-reference | B-6 №4 |
| S1-27 шапка и меню | `shell` | шапка, меню по D-23 комплекта (01 §9–10) | `getMyContext` | — / W1.20 | готова | — |
| S1-28 AccessGate | `shell` | `gateVM` (01 §12) | `getMyContext` | — / W1.20 | готова | режим чтения вместо гейта для отключённого модуля |
| S1-29 адаптив | `shell` | 390 / 768 / 1440 (01 §4.3, §9.5) | — | — / W1.20 | готова | — |
| S1-30 глобальные состояния | `shell` | частично: «Нет связи», «Связь восстановлена», режим чтения (01 §11); «Сессия истекла» и конфликт ревизии — нет | `getMyContext`; коды `session_expired`, `revision_mismatch` | — / W1.20 | no-reference (два состояния) | design-requests «global-states» (W1.00) |

Итого: 12 историй готовы с эталоном, 13 — с контрактом и `no-reference` (экраны B-6 и дополнения W1.00), 5 — без экрана (S1-02, S1-03, S1-11, S1-24, S1-25).

## 3. Вопросы, которые меняют поведение относительно эталона

Значения по умолчанию действуют до ответа владельца продукта; вопросы переданы интегратору для `docs/plan/decisions.md` (отчёт W1.00).

1. **Причина действий оператора.** В диалогах «Продлить», «Ограничить», «Снять ограничение» эталона поля нет; S1-04 и PLAT-02 требуют причину. По умолчанию — обязательное поле «Причина» (5–500) в диалоге.
2. **«Ограничить новые операции» = `suspended`.** Эталон ставит `restricted` (≈ `read_only`). По умолчанию — `suspended` (PLAT-02: записи закрыты, владельцу доступны восстановление и оплата), `read_only` наступает только по сроку подписки.
3. **«Снять ограничение».** Эталон сразу делает «Действует». По умолчанию — состояние подписки: у «Карго Сити» оплата до 15.09 просрочена → `grace`.
4. **Журнал аудита организации для владельца (S1-23).** В эталоне есть только журнал оператора. По умолчанию — аудит пишется (`audit.events`), экрана и операции чтения у владельца в этапе 1 нет.
5. **Карточка без аккаунта.** Не занимает место (подсказка эталона); по умолчанию создаётся в подразделениях, где у действующего `members.manage`.
6. **Продление пробного периода.** Эталон показывает кнопку и для действующих подписок; по умолчанию — только для `trialing` и для `grace`/`read_only` после пробного периода, оплаченная подписка — 409.

## 4. Подписи эталона, на которые опирается контракт

| Подпись (дословно) | Где в снимке | Что в контракте |
|---|---|---|
| «Продлить пробный период на 14 дней» | `pg.tenants` | `extendPlatformTrial` (`days`, пример 14) |
| «Ограничить новые операции», «Снять ограничение» | `pg.tenants` | `suspendPlatformTenant`, `resumePlatformTenant` |
| «Журнал действий» | `pg.tenants` | `listPlatformAuditEvents` |
| «Затронет сейчас», «Активных процессов нет» | диалог отключения модуля | `previewModuleDeactivation.activeItems` |
| «Место организации», «Место организации заполнено.» | «Модули и место», «Файлы», баннер №5 | `getStorageUsage`, `TenantState.storageWriteStatus` |
| «Фото осмотров и отчётов», «Документы», «Вложения задач и форм», «Прочее» | разбивка места «Модули и место» | `StorageBreakdownGroup.key` |
| «Фото и вложения всегда привязаны к исходному объекту», «Доступных файлов нет» | `pg.files` | `listFiles` (`owner`), пустой список |
| «Пробный период завершён.» | баннер №1 | `TenantState.status` |
| «карточка без входа (бригада)», «Не занимают место» | «Пользователи и роли» | `createMember` |
| «Новых событий нет», «Прочитать все» | поповер «Уведомления» | входящие `0.3.0-stage1` |
| «Отключены · только чтение» | меню владельца | `ModuleAvailability` (D-23 комплекта) |
