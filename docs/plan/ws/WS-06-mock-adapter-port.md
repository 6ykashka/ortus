# WS-06 · `packages/adapter/mock`: порт `api.js` 1:1, пресеты, conformance-suite

Волна 0 · Размер M · Вид `domain` · Зависит от WS-05 (pipeline: стартует после слияния WS-05; WS-01 — транзитивно) · Блокирует WS-10, WS-14, WS-20…WS-32, WS-51 (`00-master-plan.md` §5.1 строка WS-06, §6.1 ребро `WS-06 →`).

Ключи страниц (`pages`): **—** (`00-master-plan.md` §7.2, волна 0: `"pages": []`). Поэтому вместо e2e-скелета страницы первым коммитом пишется **скелет conformance-suite** (84 пункта `it.todo`, §6а) — это аналог шага 1 `tdd-protocol.md` §2 для вида `domain` (`00-master-plan.md` §8.1: «`AdapterPort` типы; conformance-suite (62 + покрытие 51/51 и кодов) против mock»).

## 1. Цель

После WS-06 в репозитории есть `createMockAdapter(...)` на TypeScript, который ведёт себя **ровно** как `design/ortus/api.js:15–570`: те же guards и порядок проверок, те же коды и дословные сообщения `ApiError` (18 кодов 07 §6), те же побочные эффекты (события `db.events`, аудит `platform.audit`, автоматизация `recordInspection`, `syncSeats`), та же фильтрация `view()` для каждого актора (07 §5), те же задержки по умолчанию (инжектируемые, 0 в тестах), плюс 14 пресетов `applyPreset(name)` = результат рецептов `00-master-plan.md` §2.4. Поведение зафиксировано conformance-suite из 84 кейсов (62 кейса 07 §14 + 14 кейсов покрытия методов/кодов + 8 mock-специфичных), параметризованной фабрикой адаптера, так что WS-51 запустит её без правок против `createHttpAdapter + MSW`, а WS-53 — против стенда с тегом `@stand` (`00-master-plan.md` §4.5, R1).

## 2. Границы файлов

Создаёт (владение по `00-master-plan.md` §3.3 и строке WS-06 §5.1):

| Путь | Что |
|---|---|
| `frontend/packages/adapter/package.json` | `"name": "@ortus/adapter"`, `exports: { "./mock": "./src/mock/index.ts" }`, скрипты `test` (`vitest run`), `test:watch`, `typecheck` (`tsc --noEmit`), `coverage`; devDeps `vitest`, `typescript` с пинами из каталога WS-01 |
| `frontend/packages/adapter/tsconfig.json`, `vitest.config.ts` | корень пакета — в волне 0 единственный владелец пакета WS-06 (WS-51 добавит `src/{http,msw}` в волне 2); `coverage.thresholds.lines = 90` для `src/mock/**` |
| `frontend/packages/adapter/src/mock/index.ts` | `createMockAdapter`, реэкспорт типов |
| `…/src/mock/types.ts` | `MockAdapterOptions`, `MockAdapter`, `MockControls`, `Delays`, `PresetName` (§4) |
| `…/src/mock/state.ts` | `db`, `dbs`, `flags`, `ops`, `actor` и хелперы `tenant/trip/veh/event/reviewers/owners/seatsUsed/syncSeats/tierOf/account/actorName/hhmm` (`api.js:16–36`, 07 §3.1) |
| `…/src/mock/guards.ts` | `assertNet/assertActive/assertCan/startedWork/assertLogisticsFor` (`api.js:52–67`, 07 §3.2) |
| `…/src/mock/view.ts` | `view()` (`api.js:70–97`, 07 §5) |
| `…/src/mock/cmd.ts` | обёртка `cmd(fn, ms, needsNet)` (`api.js:99–104`, 07 §3.3) |
| `…/src/mock/automation.ts` | `recordInspection` (`api.js:38–50`, 07 §3.4) |
| `…/src/mock/delays.ts` | таблица задержек по методам (§4, из колонок «Задержка» 07 §4.4–4.8) |
| `…/src/mock/methods/{platform,org,people,fleet,core,spa-cash-repair,files}.ts` | 51 метод по группам 07 §4.2–4.8 |
| `…/src/mock/presets/index.ts`, `…/presets/<name>.ts` | 14 пресетов (§4, таблица П) |
| `…/src/mock/*.test.ts` | unit-тесты внутренностей мока (§6б) — рядом с кодом, т. к. `test/mock/` не входит во владение |
| `frontend/packages/adapter/test/conformance/factory.ts` | контракт `AdapterFactory`/`AdapterUnderTest` + `mockFactory` |
| `…/test/conformance/suite.ts` | `runConformanceSuite(factory, opts)` — `describe` на метод, `it` на кейс |
| `…/test/conformance/cases/{01-modules-rights,02-invites-seats,03-driver,04-manager,05-core,06-spa-cash-repair,07-platform,08-isolation,09-coverage,10-mock-only}.ts` | 84 кейса как объекты `ConformanceCase` (§4) |
| `…/test/conformance/messages.ts` | все сообщения `ApiError`, событий и аудита дословно + тест паритета с `design/ortus/api.js` (§6г) |
| `…/test/conformance/runners/mock.conformance.test.ts` | единственный раннер волны 0 |
| `…/test/conformance/coverage/{methods,codes}.test.ts` | 51/51 методов, 18/18 кодов |
| `…/test/conformance/__snapshots__/presets/<preset>.<persona>.json` | `load()` после каждого пресета (для WS-55 `recipes-vs-presets`) |
| `docs/plan/reports/WS-06.md`, строка WS-06 в `docs/plan/status.md` | отчёт и статус |

Точка расширения для соседей (единственное, что другие WS добавляют в `test/conformance/`): файлы раннеров `test/conformance/runners/http.conformance.test.ts` (WS-51) и `stand.conformance.test.ts` (WS-53). `cases/`, `suite.ts`, `factory.ts`, `messages.ts` после слияния WS-06 меняются только через интегратора (контракт заморожен, `orchestration.md` §1).

Запрещено трогать: `frontend/packages/domain/**` (WS-05 — дефект домена → отчёт интегратору, не правка), `frontend/packages/adapter/src/{http,msw}/**` (WS-51), `frontend/apps/**`, `api/**`, корневые `package.json`/`pnpm-workspace.yaml` (WS-01), `design/**` (эталон, `orchestration.md` §7; читать можно — тест паритета сообщений читает `design/ortus/api.js` только на чтение), `docs/plan/analysis/**`, `docs/plan/decisions.md` (предложения — в отчёте, вносит интегратор).

Worktree и ветка (PowerShell 5.1, без `&&`, `00-master-plan.md` §0.3 строка B §5.3 п.8):

```powershell
git -C D:\work\test26042026_Kirill_3.0 worktree add ..\ortus-ws06 -b ws/ws-06-mock-adapter-port main
Set-Location D:\work\ortus-ws06
pnpm install
pnpm --filter @ortus/adapter test
```

Dev-сервер и порт не нужны (нет страниц); порт исполнителя по §7.4 (`5173 + 6 = 5179`) не занимается. Коммиты — Conventional Commits, `git commit -F <файл-без-BOM>`.

## 3. Входы

Прочитать полностью до первого коммита:

- `design/ortus/api.js` — весь файл (строки 1–570 портируются; 573–627 `createHttpAdapter` **не** портируется — это WS-51).
- `design/ortus/models.js:169–198` (`moduleOn`, `grants`, `can`, `canEarnings`), `:77–83` (`REASON`), `:118–125` (`PHOTO_SIDES`, `DEP_CHECKS`, `RET_CHECKS`, `FUEL`, `TASK_FLOW`), `:213–230` (`compat`), `:244–257` (`inspMissing`), `:268–279` (`validateExpense`), `:282–300` (`bookingConflicts`) — только чтобы знать контракты функций, которые мок вызывает из `@ortus/domain`.
- `design/ortus/mock-data.js`, `design/ortus/extra-data.js` — целиком (ожидания сида: ID, числа, тексты).
- `docs/plan/analysis/07-domain-and-adapter.md` §3 (архитектура, строки 47–104), §4 (каталог 51 метода, 106–205), §5 (`view()`, 207–228), §6 (18 кодов ↔ канон, 231–263), §9 (сид, 415–501), §10 (JSDoc → TS, 504–560), §12 (что мок делает/не делает за бэкенд, 607–650), §13 (30 инвариантов), §14 (62 кейса с правкой E4, 688–777), §15 Q1–Q16 (особенно Q13 «ID зависят от `seq` — e2e не ожидают точные номера», Q7, Q9, Q14, Q15), §16 п.1–19.
- `docs/plan/analysis/03-logistics.md` §11.4 (команды и коды логистики), §11.5 (10 текстов событий дословно), §11.6 (тосты — **UI**, в адаптере не воспроизводятся; нужны, чтобы не перепутать тост с сообщением `ApiError`).
- `docs/plan/analysis/09-data-permissions-errors.md` §10 п.19 (`view()` = спецификация field policy), п.20 (демо-флаги — единственный способ воспроизвести офлайн/конфликт/сбой в фазе 1; эквиваленты фазы 2 — D-31).
- `docs/plan/00-master-plan.md` §2.4 (рецепты ↔ пресеты, правило D-26), §4.5 (`AdapterPort`, 51 метод, conformance-suite), §4.6 (сид, сценарии, `clock`), §4.10 (метод → операции; колонка «Примечание (WS-51)» — что мок делает в одной команде), §8.1 (строка `domain`), §10.3 D-26, D-27, D-31, D-39, D-44, D-45.
- `docs/plan/decisions.md`: D-19, D-22, D-27; Q-15, Q-23, Q-30, Q-31, Q-54, Q-59, Q-65, Q-82, Q-83, Q-85, Q-86, Q-87, Q-88, Q-98.
- Протоколы: `tdd-protocol.md` §1, §3 «TypeScript», §4; `verification-protocol.md` §5, §6; `orchestration.md` §1, §5, §7.
- Выходы WS-05 (после слияния): `frontend/packages/domain/{adapter.port.ts,types.ts,clock.ts}`, `seed/index.ts`, `scenarios/index.ts`, `models/index.ts`, `seed/snapshot.json`.

## 4. Контракты

### 4.1 Публикует

**`createMockAdapter(options?: MockAdapterOptions): MockAdapter`** (`src/mock/index.ts`), где `MockAdapter = AdapterPort & MockControls`.

```ts
type MockAdapterOptions = {
  seed?: () => Db;                         // по умолчанию seed() из @ortus/domain/seed (t-alta + platform)
  seedLotos?: (platform: Platform) => Db;  // по умолчанию seedLotos из @ortus/domain/seed; lotos.platform === db.platform (api.js:19)
  scenario?: ScenarioName;                 // 'empty-review'|'empty-requests'|'empty-calendar'|'kb-conflict'|'no-trip' — оверлей WS-05 поверх сида (00 §4.6)
  clock?: Clock;                           // @ortus/domain/clock; по умолчанию Date.now; hhmm() и «+7 дн.» читают его
  delays?: Partial<Delays> | 0;            // 0 — все задержки нулевые (тесты, D-39); по умолчанию — таблица прототипа
  rng?: () => number;                      // шаги прогресса upload (api.js:558); по умолчанию Math.random
  actor?: { memberId: string | null; tenantId: string }; // по умолчанию { memberId: 'm-owner', tenantId: 't-alta' } (api.js:22)
};
type MockControls = {
  kind: 'mock';
  flags: Flags;                                   // живая ссылка (api.js:108)
  setFlag(k: 'online'|'conflictNext'|'failUploadNext', v: boolean): void;
  applyPreset(name: PresetName, opts?: { reset?: boolean }): Promise<DbView>; // reset по умолчанию true; для 'kb-conflict' — false
  scenario(name: ScenarioName): void;             // пересидить с оверлеем, актор сохраняется
  reset(): void;                                   // свежий сид, флаги по умолчанию, ops пуст, актор по умолчанию
  /** @internal только для src/mock/*.test.ts и снимков пресетов; conformance-кейсам запрещён (grep-тест §6г) */
  snapshot(): Db;
};
type Delays = { default: 420; load: 500; createRole: 300; saveRole: 380; reserve: 600; submitDeparture: 650; submitReturn: 650;
  addExpense: 450; finishRoute: 350; reviewTrip: 600; resetTrip: 250; publishForm: 500; moveTask: 300; toggleTaskCheck: 200;
  commentTask: 250; createTask: 350; moveBooking: 400; saveKbPage: 400; completeAppointment: 450; resolveIssue: 300;
  addCashOp: 350; reverseCashOp: 350; addWorkLog: 450; acceptWorkLog: 350; uploadStep: 110; uploadTail: 160 }; // api.js:99, 112, 294, 303, 318, 347, 367–368, 379, 397, 400, 427, 437–438, 444, 451, 464, 476, 498, 504, 516, 526, 541, 549, 559, 564
type PresetName = 'logistics-ready'|'driver-booked'|'driver-on-route'|'defect-review'|'shift-submitted'|'shift-accepted'
  |'trial-ended'|'seats-full'|'storage-full'|'repair-on'|'kb-conflict'|'empty-review'|'empty-requests'|'no-trip';
```

Семантика команд — как в прототипе: ответ `{ data, db: view() }` (`ApiResult<T>`), ошибка — `ApiError` с `code`, `message` и прикреплённым `db` (`api.js:103`), `extra` `{ vehicleId }` у `reserve` (`api.js:312, 314`) и `{ slots }` у `moveBooking` (`api.js:461`). Форма `ApiError` берётся из WS-05 `adapter.port.ts` (`00-master-plan.md` §4.5: `ApiError{code, message, status?, violations?, requestId?, extra?}`); если WS-05 определил `vehicleId`/`slots`/`db` верхнеуровневыми полями (07 §10 строка `ApiError`) — мок заполняет их так же; дублировать класс запрещено.

**Контракт сюиты** (`test/conformance/factory.ts`, `suite.ts`) — потребляют WS-51, WS-53, WS-55:

```ts
type Mode = 'mock' | 'http' | 'stand';
type TestControls = { setActor(memberId: string | null, tenantId: string): void | Promise<void>;
  setFlag(k: FlagKey, v: boolean): void | Promise<void>; applyPreset(name: PresetName): Promise<unknown>; reset(): void | Promise<void> };
type AdapterUnderTest = { api: AdapterPort; controls: TestControls; dispose?(): Promise<void> };
type AdapterFactory = { mode: Mode; create(opts?: { seed?: () => Db }): Promise<AdapterUnderTest> };
type ConformanceCase = { id: `S-${number}` | `C-${number}` | `M-${number}`; title: string; source: string; // «07 §14 #21», «07 §4.5 reserve»
  covers: MethodName[]; codes: MockCode[]; modes: Mode[]; run(ctx: AdapterUnderTest & { domain: typeof import('@ortus/domain/models') }): Promise<void> };
export function runConformanceSuite(factory: AdapterFactory, opts?: { only?: string[]; skip?: string[] }): void;
export const METHODS_51: readonly MethodName[]; export const CODES_18: readonly MockCode[];
```

`METHODS_51` (00 §3.4; `tenantIds`/`defaultBranding` исключены — Q-88): `setActor, setFlag, load` · `extendTrial, setTenantQuota, setTenantStatus, decideSeatRequest, publishPriceBook, cancelScheduledPriceBook, setAccountLock, resetMfa, inviteOperator, setOperatorRole, setOperatorStatus` · `saveBranding, setModule, setStorageQuota` · `invite, revokeInvite, requestSeats, cancelSeatRequest, assign, unassign, createRole, saveRole` · `reserve, cancelReservation, assignVehicle, submitDeparture, decideDefect, addExpense, finishRoute, submitReturn, reviewTrip, resetTrip, requestDriver, decideRequest` · `publishForm, moveTask, toggleTaskCheck, commentTask, createTask, moveBooking, saveKbPage` · `completeAppointment, resolveIssue, addCashOp, reverseCashOp, addWorkLog, acceptWorkLog` · `upload` (3+11+3+8+12+7+6+1 = 51). `kind` и `flags` — свойства, не методы.

`CODES_18` (07 §6): `not_found, offline, subscription_restricted, module_off, module_readonly, no_permission, no_scope, driver_block, validation, conflict, incompatible, transition, role_conflict, last_owner, forbidden, seats_exhausted, quota_exceeded, upload_failed`.

Правила портируемости кейсов (чтобы та же сюита прошла на http/MSW и стенде): утверждения только через ответы `{data, db}`, `load()` и свойства `ApiError`; переключение актора через `controls.setActor` (аудит виден только оператору — `setActor(null, …)`); никакого `snapshot()`; ID новых сущностей сравниваются по шаблону (`/^SR-\d+$/`, 07 §15 Q13), время — не сравнивается (кроме M-7 под фиксированным `clock`); суммы — с U+00A0 («4 500 ₽», 07 §13 п.30). Каждый из 51 метода имеет ≥ 1 кейс с `modes ⊇ ['mock','http']`; кейсы с `offline` имеют `modes: ['mock','http']` (на стенде офлайн — `context.setOffline`, D-31, вне Vitest).

**Таблица П — пресеты** (`00-master-plan.md` §2.4; каждый = последовательность вызовов того же адаптера от свежего сида с `delays: 0`; `kb-conflict` — поверх текущего состояния):

| Пресет | Вызовы (актор → метод) | Проверяемый результат | Рецепт/владелец |
|---|---|---|---|
| `logistics-ready` | `setActor('m-owner','t-alta')`; `setModule('logistics', true)`; `assign({memberId:'m-kotova', roleId:'r-manager', scope:{type:'firm', id:'f-msk-sever'}})` | `modules.logistics.enabled === true`; `can(db,'m-kotova','logistics','review','f-msk-sever').ok` | WS-07 (01 §6 шаги 1–2; область по 07 §14 #7 — «Север Логистик») |
| `driver-booked` | `logistics-ready` → `setActor('m-vasiliev','t-alta')`; `reserve('Р-208','v1')` | `Р-208.status 'inspection'`, `vehicleId 'v1'`, `reservedUntil '09:30'`; `v1 {state:'reserved', heldBy:'Р-208'}` | WS-23 (03 §8.3) |
| `driver-on-route` | `driver-booked` → 5× `upload({name:'<side>.jpg'})` → `submitDeparture('Р-208', {photos:{front,back,left,right,odo:{state:'ready', fileId}}, odometer:'84400', fuel:'tq', checks:{body:true,tires:true,docs:true}, defects:[], comment:''})` | `data 'started'`; `on_route`; `v1.state 'on_route'`; ответ «Рейс Р-208 · выезд»; задача «Проверить осмотр Р-208 (выезд)» | WS-23 (03 §10, 03 §14 #25–27; значения 84400/«¾» — 07 §14 #26) |
| `defect-review` | `driver-booked` → 5× `upload` → `submitDeparture` с `defects:[{zone:'Кузов', text:'Вмятина на двери', critical:true}]` | `data 'blocked'`; `defect_review`; `v1 {state:'unavailable', note:'критический дефект на проверке'}` | WS-23 (03 §8.5 `saveDefect`; текст дефекта — контракт с WS-23) |
| `shift-submitted` | `driver-on-route` → `addExpense('Р-208', {category:'fuel', amount:'1500', date:'2026-10-01', comment:'', liters:'', receipt:{state:'ready', fileId}, opId:'preset-exp-1'})` → `finishRoute('Р-208')` → 5× `upload` → `submitReturn('Р-208', {photos…, odometer:'84450', fuel:'h', checks:{cargo:true,personal:true,keys:true}, defects:[], comment:'', opId:'preset-ret-1'})` | `submitted`; `v1.state 'review'`; `expenses.length 1`; 2 ответа формы; 2 задачи | WS-23 (01 §6 шаги 6–7; 03 §14 #30–36) |
| `shift-accepted` | `shift-submitted` → `setActor('m-kotova','t-alta')`; `reviewTrip('Р-208', {decision:'accept', comment:''})` | `accepted`; `v1 {state:'free', heldBy:null, odometer:84450}`; `earnings[0].amount 4500` | WS-22 (03 §7.5) |
| `trial-ended` | `setActor('m-owner','t-alta')`; `setTenantStatus('t-alta','restricted')` (как `confirmTrialEnd`, id текущей организации — Q-30/D-27) | `status 'restricted'`, `trialDaysLeft 0`; событие владельцу «Пробный период завершён. Новые операции ограничены, данные сохранены.» | WS-20 (02 §5.4) |
| `seats-full` | `setActor('m-owner','t-alta')`; `invite({name:'Иван Тестов', email:'i.testov@alta.example'})` | `seatsUsed 10`; участник `invited` | WS-20 (02 §12 п.11; имя/почта — 07 §14 #12) |
| `storage-full` | `setActor('m-owner','t-alta')`; `setStorageQuota(25)` | `quotaGb 25 < usedGb 46.2`; `upload` → `quota_exceeded` | WS-20 (02 §5.4) |
| `repair-on` | `setActor('m-owner','t-alta')`; `setModule('repair', true)` | `modules.repair.enabled`; событие «Подключён модуль «Ремонт и стройка»» | WS-31 (06 §15 п.5) |
| `empty-review` | `logistics-ready` → `setActor('m-kotova','t-alta')` | у логиста нет рейсов в `submitted`/`defect_review` | WS-22 |
| `empty-requests` | `setActor(null,'t-alta')`; `decideSeatRequest('SR-12', false, 'Отклонено для демонстрации пустого списка')` | `platform.requests` без `pending` | WS-27 (04 §5.3; текст заметки — контракт с WS-27) |
| `kb-conflict` | без `reset`: запомнить актора → `setActor('m-owner','t-alta')` → `saveKbPage('kb-1', <body v2> + ' Дополнение коллеги.', 2)` → вернуть актора | `kb-1` последняя версия `v3`; сохранение с базой 2 → `conflict` | WS-29; на эталоне невоспроизводим — allowlist `no-reference` (06 §14 Q1, D-26) |
| `no-trip` | `scenario('no-trip')` (оверлей WS-05), актор сохраняется | у водителя `load().trips === []` | Q-54 |

### 4.2 Потребляет

Из `@ortus/domain` (WS-05): `types.ts` (`Db`, `DbView`, `Tenant`, `Trip`, `Vehicle`, `Member`, `Role`, `Scope`, `InspectionPayload`, `Expense`, …); `models/` — `can, canEarnings, grants, scopeCovers, moduleOn, compat, inspMissing, validateExpense, bookingConflicts, freeSlots, wfOf, emailOk, int, num, rub, plural, scopeLabel` и справочники `REASON, FUEL, PHOTO_SIDES, INDUSTRY, TENANT_STATE`; `seed/` — `seed()`, `seedLotos(platform)`, `BRAND_DEFAULT`; `scenarios/` — `scenario(name)`; `clock.ts`; `adapter.port.ts` — `AdapterPort`, `ApiError`, `ApiResult`, `Flags`.

Если контракта ещё нет (WS-05 не влит): по правилу волны 0 (`00-master-plan.md` §6.2 «WS-06 после WS-05 (pipeline)») старт запрещён; разрешён только ранний старт файлов, не импортирующих `@ortus/domain`: `test/conformance/cases/*.ts` как `it.todo` с текстами Given/When/Then, `messages.ts`, `METHODS_51`/`CODES_18`, `delays.ts`. Фейков/MSW для домена не делать.

## 5. Экраны, диалоги, состояния

Страниц у WS нет. Эквивалент — поверхности адаптера, которые сюита фиксирует как «состояния»:

| Ключ (актор) | Подпись персонажа (`Ортус CRM.dc.html:31–47`, 07 §14 преамбула) | `setActor(...)` | Что отдаёт `load()` на сиде (07 §5 «Следствия», §9) | Кейсы |
|---|---|---|---|---|
| `operator` | «Оператор платформы» | `(null, 't-alta')` | только `{platform, operatorOnly:true, flags}`; 4 организации, SR-12 `pending`, 58 аккаунтов, 6 операторов, 2 записи аудита | S-54…S-60, C-5 |
| `owner` | «Владелец · Дарья Зимина» | `('m-owner','t-alta')` | 7 машин, 2 рейса с `earnings`, `platform` без `audit/accounts/operators`, `tenants` только `t-alta`, 4 страницы БЗ, касса видна | S-1…S-10, S-12…S-16, S-41…S-46, S-50…S-53 |
| `manager` до роли | «Логист · Марина Котова» | `('m-kotova','t-alta')` | `vehicles []`, `trips []`, `projects []`, `cash.hidden true`, БЗ без `kb-4` | S-11 (пусто) |
| `manager` после `logistics-ready` | то же | то же | 7 машин, 2 рейса, проект `fleet`, события проверяющего | S-28, S-36…S-40, S-47 |
| `driver` | «Водитель · Илья Васильев» | `('m-vasiliev','t-alta')` | 5 машин `[v1,v6,v2,v3,v4]`, 1 рейс `Р-208` без `earnings`, `earnings []`, события без `sensitive` | S-19…S-35 |
| `therapist` | «Массажист · Анна Морозова» | `('m-morozova','t-alta')` | `vehicles []`, `trips []`, `projects []`, `tasks []`, касса `hidden`, брони без `source.kind 'vehicle'` | S-48, S-49 |
| `foreman` | «Прораб · Алексей Соколов» | `('m-sokolov','t-alta')` | `projects []` (scope `self` не покрывает unit), `tasks` только `assignee 'Алексей Соколов'` (`L-29`, `L-18`) | S-52 |
| `owner@t-lotos` | «Владелец · Ирина Белова» | `('m-owner','t-lotos')` | 3 unit, 23 участника, `T-7`/`T-8`, «Касса «Лотос»», `kb-3`, бренд `#7A3E79`/«сеанс» | S-61, S-62 |
| `therapist@t-lotos` | «Массажист · Анна Морозова» (optgroup «SPA «Лотос»») | `('m-morozova','t-lotos')` | как `therapist`, но `knowledge.pages [kb-3]`, `members` 23 | M-8 |

Состояния по `verification-protocol.md` §1.3 → механизм адаптера: пусто — `scenario(...)`/пресеты `empty-*`, `no-trip`; загрузка — задержки `Delays` (в тестах 0); ошибка — 18 кодов `ApiError`; нет права / модуль не подключён — `no_permission`, `no_scope`, `module_off`; офлайн — `flags.online=false` (`assertNet` после задержки); конфликт — `flags.conflictNext` (одноразовый) и коды `conflict`; только чтение — `module_readonly` (модуль выключен с `history`), `subscription_restricted`. Маршрутов URL нет.

## 6. Тесты первыми

### 6а. Скелет conformance-suite — 84 пункта `it.todo` (первый коммит `test(adapter): скелет conformance-suite`)

Обозначения: нумерация `S-N` = пункт N чек-листа 07 §14 (Given/When/Then переведены на уровень адаптера: вместо кликов — вызовы, вместо тостов — `data`/`db`/`ApiError`; тосты и DOM остаются в spec'ах страниц). Если не сказано иное, Given — свежий адаптер `delays: 0`, `clock = 2026-10-01T10:30:00+03:00`, актор «Владелец · Дарья Зимина» (`m-owner`, `t-alta`). «событие X у Y» = после `setActor(Y)` в `load().events[0].text === X`. Сообщения — дословно из `api.js` (строка указана).

**14.1 Модули и права**
1. S-1 · When `setModule('logistics', true)` · Then `db.modules.logistics.enabled === true`; событие у владельца «Подключён модуль «Логистика»» (`api.js:150`).
2. S-2 · Given логистика включена · When `setModule('logistics', false)` · Then `modules.logistics` = `{enabled:false, history:true}`; событие «Отключён модуль «Логистика». История сохранена.»; `can(db,'m-kotova','logistics','view')` (домен на `db` из `load()`) → `reason 'module_readonly'`.
3. S-3 · Given сид · Then `can(db,'m-sokolov','repair','create').reason === 'module_off'`, `REASON.module_off.text` = «Модуль не подключён организацией. Подключить его может владелец бизнеса.» (`models.js:78`); адаптерный эквивалент — C-2.
4. S-4 · Given `logistics-ready`, `setActor('m-vasiliev')` · When `reviewTrip('Р-208', {decision:'accept', comment:''})` · Then `ApiError.code 'no_permission'`, message «Ни одна роль сотрудника не разрешает это действие.» (`models.js:80`).
5. S-5 · Given `logistics-ready`, водитель · When `reserve('Р-208','v5')` · Then `no_scope`, «Право есть, но объект находится вне области назначения.» (`models.js:81`; `v5` — `f-msk-yug`).
6. S-6 · Given сид · Then `canEarnings(db,'m-vasiliev','f-msk-sever').reason === 'driver_block'`, текст «Действующая функция «Водитель» запрещает начисления через любую роль и группу.»; в адаптере код не бросается, а действует в `view()` — см. S-36.
7. S-7 · When `assign({memberId:'m-kotova', roleId:'r-manager', scope:{type:'firm', id:'f-msk-sever'}})` · Then `assignments` содержит `{member:'m-kotova', role:'r-manager', until:null}`; событие у `m-kotova` «Вам назначена роль «Менеджер логистики» · Москва / Север Логистик» (`api.js:281`).
8. S-8 · When `assign({memberId:'m-vasiliev', roleId:'r-manager', scope:{type:'firm', id:'f-msk-sever'}})` · Then `role_conflict` «Функция «Водитель» несовместима с правом на начисления (правило MVP).» (`:278`); `e.db` есть; назначений не прибавилось. Вариант: роль `professional:'driver'` владельцу → «У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено.» (`:279`).
9. S-9 · When `unassign('a1')` · Then `last_owner` «Нельзя снять роль с последнего владельца» (`:285`); `a1` на месте; `unassign('нет-такого')` — молча (`:286`).
10. S-10 · When `saveRole({...r-owner})` → `forbidden` «Системная роль не редактируется» (`:297`); `saveRole({...r-driver, finance:{read:true, manage:false}})` → `role_conflict` «Роль с функцией «Водитель» не может содержать начисления» (`:299`); роль с `finance.read` и держателем-водителем → «Роль назначена водителю — финансовые права недоступны» (`:301`); `name ''` → `validation` «Укажите название роли».
11. S-11 · Given `setActor('m-kotova','t-alta')` · When `load()` · Then `vehicles []`, `trips []`, `projects []`, `cash.hidden === true`, `knowledge.pages` без `kb-4` (`api.js:82–94`).

**14.2 Приглашения и места**
12. S-12 · Given `load().platform.tenants[0].seatsUsed === 9` · When `invite({name:'Иван Тестов', email:'i.testov@alta.example'})` · Then `data` ~ `/^m-\d+$/`; участник `status 'invited'`, `invitedNote 'Приглашение до 08.10'` (clock+7 дн., Q-15); `seatsUsed 10`; у оператора в `accounts` новый `{status:'pending', mfa:false}` с этим email.
13. S-13 · Given 10/10 · When `invite({name:'Ещё Один', email:'one.more@alta.example'})` · Then `seats_exhausted` «Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.» (`:160`).
14. S-14 · `invite({name:'X', email:'m.kotova@alta.example'})` → `conflict` «Участник с таким адресом уже есть»; `email 'abc'` → `validation` «Проверьте адрес электронной почты»; `name ''` → `validation` «Укажите имя» (`:156–158`).
15. S-15 · When `revokeInvite('m-petrova')` · Then участника нет, `assignments`/`groups` без него, `seatsUsed 8`; у оператора `acc-6.memberships` без `t-alta`; повтор → `conflict` «Приглашение уже принято или отозвано» (`:171`).
16. S-16 · When `requestSeats({tierId:'team', term:12, comment:''})` · Then `data` ~ `/^SR-\d+$/`; `platform.requests[0]` = `{tenantId:'t-alta', from:'start', to:'team', term:12, used:9, by:'Дарья Зимина', status:'pending'}`; событие «Заявка SR-… на тариф «Команда» отправлена оператору»; повтор → `conflict` «Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.» (`:181`); `tierId 'нет'` → `validation` «Выберите тариф»; владелец «Лотоса» `tierId 'start'` → «В тарифе «Старт» 10 мест, а занято 23» (`:184`).
17. S-17 · Given заявка из S-16, `setActor(null,'t-alta')` · When `decideSeatRequest(id, true)` · Then у `t-alta`: `seatsLimit 25`, `plan {tier:'team', term:12, paidUntil:'30.09.2027', version:2}`, `status 'active'`, `trialDaysLeft null`; аудит «Альта Групп: заявка SR-… подтверждена, тариф «Команда»»; событие у владельца «Тариф «Команда» подключён: 25 мест» (`:203–208`).
18. S-18 · `decideSeatRequest('SR-12', false, '')` → `validation` «Укажите причину отказа» (`:199`); с заметкой → `status 'rejected'`, `decision` = заметка, аудит «SPA «Лотос»: заявка SR-12 отклонена: <заметка>»; повтор → `conflict` «Заявка уже рассмотрена или отменена».

**14.3 Водитель**
19. S-19 · Given `logistics-ready`, `setActor('m-vasiliev')` · When `load()` · Then `vehicles.map(id)` = `['v1','v6','v2','v3','v4']`, `trips` = `['Р-208']` без поля `earnings`; `compat(v3, Р-208).reasons` = `['Грузоподъёмность: 0,9 т, нужно от 1,1 т', 'Объём: 9 м³, нужно от 12 м³']`; `v4` = `{state:'unavailable', note:'Плановое ТО до 03.10'}`.
20. S-20 · When `reserve('Р-208','v1')` · Then `Р-208` = `{status:'inspection', vehicleId:'v1', reservedUntil:'09:30'}`, `v1` = `{state:'reserved', heldBy:'Р-208', note:null}`; событие у `m-kotova` «Илья Васильев забронировал ГАЗель Next А 412 МР 77 на рейс Р-208» (`:317`).
21. S-21 · Given `setFlag('conflictNext', true)` · When `reserve('Р-208','v6')` · Then `conflict` «Машину только что забронировал другой сотрудник. Список на экране устарел.» с `vehicleId 'v6'` (`:312`); `e.db.vehicles` `v6` = `{state:'reserved', heldBy:'other', note:'другой рейс'}`; `flags.conflictNext === false`; повтор `reserve('Р-208','v6')` → `conflict` «Машина уже недоступна. Обновите список.» (`:314`).
22. S-22 · Given `setFlag('online', false)` · When `reserve('Р-208','v1')` · Then `offline` «Нет связи с сервером. Операция не выполнена.» (`:52`), состояние не изменилось (тост «Бронь требует связи с сервером» — UI, WS-23).
23. S-23 · When `reserve('Р-208','v3')` · Then `incompatible` «Машина не подходит рейсу: Грузоподъёмность: 0,9 т, нужно от 1,1 т; Объём: 9 м³, нужно от 12 м³» (`:315`).
24. S-24 · Given `driver-booked` · When `submitDeparture('Р-208', {photos:{}, odometer:'', fuel:'', checks:{}, defects:[], comment:''})` · Then `validation` «Осмотр не завершён: 5 фото, пробег, уровень топлива, 3 пункта чек-листа» (`:334`).
25. S-25 · Given 5 фото `ready`, `fuel 'tq'`, 3 пункта · When `odometer '84000'` · Then `validation` «Осмотр не завершён: пробег не меньше 84 370 км» (U+00A0); домен: `odoError('90000', 84370)` = «Больше начального на 5 630 км — проверьте показания» (подсказка UI, `models.js:264`); `photos` с `state 'queued'` → «Не все фото загружены на сервер» (`:335`).
26. S-26 · Given полный осмотр (`odometer '84400'`, `fuel 'tq'`, `checks {body,tires,docs}`) · When `submitDeparture` · Then `data 'started'`; `on_route`, `dep.odometer 84400`, `v1.state 'on_route'`; у владельца `responses[0]` = `{formId:'fm-insp', version:3, object:'Рейс Р-208 · выезд', author:'Илья Васильев', status:'Принят'}`, `values` `{'q-fuel':'¾', 'q-odo':'84 400', 'q-defect':'нет'}`; `tasks[0]` = `{title:'Проверить осмотр Р-208 (выезд)', assignee:'Марина Котова', priority:'normal', status:'Новая', project:'fleet', rule:'au-1 · v1'}`, чек-лист «Сверить фото с прошлым осмотром», «Проверить пробег»; событие у логиста «Рейс Р-208 начат · ГАЗель Next» (`:345`).
27. S-27 · Given `defects [{zone:'Кузов', text:'Вмятина на двери', critical:true}]` · Then `data 'blocked'`, `defect_review`, `defect.zone 'Кузов'`, `v1` = `{state:'unavailable', note:'критический дефект на проверке'}`; задача `priority 'urgent'`; событие у логиста «Критический дефект: ГАЗель Next А 412 МР 77 — Кузов. Выезд заблокирован.» (`:341`).
28. S-28 · Given `defect-review`, `setActor('m-kotova')` · When `decideDefect('Р-208','allow')` · Then `on_route`, `dep.defects[0]` = `{critical:false, downgraded:true}`, `v1 {state:'on_route', note:null}`; событие у водителя «Менеджер разрешил выезд: дефект признан некритичным» (`:353`). When (на свежем `defect-review`) `decideDefect('Р-208','confirm')` · Then `v1 {state:'unavailable', note:'неисправность подтверждена', heldBy:null}`, рейс `{vehicleId:null, status:'planned', dep:null, defect:null}`; событие «Неисправность подтверждена. Выберите другую машину для рейса Р-208» (`:357`).
29. S-29 · Given `driver-on-route` · When `addExpense('Р-208', {category:'fuel', amount:'1500', date:'2026-10-01', receipt:{state:'ready', fileId:'file-1'}, opId:'x-1'})` · Then `expenses[0]` = `{amount:1500, category:'fuel'}`, `id` ~ `/^x\d+$/`; `amount '0'` → `validation` «Сумма должна быть больше нуля»; `'250000'` → «Больше 200 000 ₽ — проверьте сумму»; `receipt {state:'empty'}` → «Добавьте фото чека» (`validateExpense`); `receipt {state:'queued'}` → «Фото чека ещё не загружено» (`:364`).
30. S-30 · Given расход с `opId 'x-2'` принят · When тот же вызов повторно · Then `data 'duplicate'`, `expenses.length` не изменилась (`:362`); очередь/`flush` — UI WS-23.
31. S-31 · When `finishRoute('Р-208')` · Then `status 'returning'` (`:368`).
32. S-32 · Given `returning`; `submitReturn` с `odometer '84300'` → `validation` «Сдача не завершена: пробег не меньше 84 400 км» (`:372`); полная сдача (`odometer '84450'`, `fuel 'h'`, `checks {cargo,personal,keys}`, `opId 'r-1'`) → `submitted`, `v1.state 'review'`, `ret.odometer 84450`; `responses[0].object 'Рейс Р-208 · сдача'`; `tasks[0].title 'Проверить осмотр Р-208 (сдача)'`; событие у логиста «Смена Р-208 сдана на приёмку · ГАЗель Next А 412 МР 77» (`:378`).
33. S-33 · Given `setFlag('online', false)` · When `submitReturn(...)` · Then `offline`; `setFlag('online', true)` → тот же payload/`opId` → успех; третий вызов с тем же `opId` → `'duplicate'` (`:371, 377`).
34. S-34 · Given `setFlag('failUploadNext', true)` · When `upload({name:'front.jpg'}, onProgress)` · Then отклонено `upload_failed` «Загрузка прервалась. Повторите попытку.» (`:561`), все значения `onProgress` ≤ 55; `flags.failUploadNext === false`; повтор → `{fileId: /^file-\d+$/, state:'ready', name:'front.jpg'}`, последний `onProgress(100)`.
35. S-35 · Given `setActor(null,'t-alta')`, `setTenantQuota('t-alta', 40)`, `setActor('m-owner','t-alta')`, рейсов в работе нет · When `upload({name:'a.jpg'})` · Then `quota_exceeded` «Место организации заполнено. Загрузка новых файлов недоступна.» (`:556`); Given `driver-booked` (`inspection`) при той же квоте → `upload` успешен (`started`).

**14.4 Логист**
36. S-36 · Given `shift-submitted`, `setActor('m-kotova')` · When `reviewTrip('Р-208', {decision:'accept', comment:''})` · Then `data` — число (`evId`, `:394`); `accepted`, `review.decision 'accept'`; `v1` = `{state:'free', heldBy:null, odometer:84450}`; `earnings[0]` = `{tripId:'Р-208', unit:'f-msk-sever', member:'m-vasiliev', amount:4500, status:'Начислено'}`; события логиста содержат «Начисление по рейсу Р-208: 4 500 ₽» и «Смена Р-208 принята. Машина свободна.»; у водителя (`setActor('m-vasiliev')`) — «Смена Р-208 принята. Машина свободна.» есть, «Начисление…» нет, `earnings []`, `trips[0].earnings === undefined` (`driver_block` в `view()`, `:78–80`).
37. S-37 · `reviewTrip(…, {decision:'rework', comment:'', steps:['photos']})` → `validation` «Опишите, что нужно исправить»; `comment 'Пересними одометр', steps []` → «Отметьте хотя бы один раздел для доработки»; оба заполнены → `rework`, `review {decision:'rework', comment, steps}`; событие у водителя «Смена Р-208 возвращена на доработку: Пересними одометр» (`:384–387`).
38. S-38 · Given `accepted` · When `reviewTrip` повторно · Then `conflict` «Смена уже обработана» (`:382`).
39. S-39 · Given `logistics-ready`, `setActor('m-kotova')` · When `assignVehicle('Р-211','v2')` · Then `Р-211 {status:'assigned', vehicleId:'v2'}`, `v2 {state:'reserved', heldBy:'Р-211'}`; `assignVehicle('Р-211','v1')` → `incompatible` «Нельзя назначить: Температура: без охлаждения, нужно +2…+6 °C» (`:328`); `setFlag('conflictNext', true)` → `assignVehicle('Р-211','v6')` → `conflict` «Машину только что забронировали. Обновите список.» (`:327`).
40. S-40 · When `requestDriver({driverId:'d-104', tripId:'Р-211', comment:''})` · Then `pool.requests[0]` = `{driverId:'d-104', tripId:'Р-211', status:'pending', home:'Юг Транс'}`; повтор → `conflict` «Запрос уже отправлен» (`:404`); `decideRequest(id, true)` → `approved`, `Р-211 {driverId:'d-104', driverName:'Водитель #104 · временно'}`, `until '18:00 01.10'`, событие «Запрос водителя Водитель #104 одобрен фирмой Юг Транс» (`:411`); для `d-117` `decideRequest(id, false)` → `declined`, «Запрос водителя Водитель #117 отклонён фирмой Восток Карго».

**14.5 Core-модули**
41. S-41 · When `moveBooking('b-a1', 11.5)` · Then `conflict` «Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)» с `slots [8, 8.25, 8.5]` (`:460–461`); `moveBooking('b-a1', 8)` → `b-a1 {start:8, end:9}`.
42. S-42 · When `moveBooking('b-a3', 15)` · Then успех, `{start:15, end:15.75}` (длительность сохранена, `:463`).
43. S-43 · When `saveKbPage('kb-1', 'Новый текст', 2)` · Then `data 3`, `versions[2]` = `{v:3, at:'01.10.2026', by:'Дарья Зимина', body:'Новый текст'}`; повтор с базой 2 → `conflict` «Страницу уже изменили (v3). Обновите и повторите правку.» (`:471`); `body '  '` → `validation` «Текст страницы пустой».
44. S-44 · Given `T-58` «В работе», чек-лист 1/3 · When `moveTask('T-58','На проверке')` · Then `status`, `comments` последний `{by:'Система', text:'Статус: В работе → На проверке', system:true}` (`:436`); When `moveTask('T-58','Готово')` · Then `validation` «Нельзя завершить: в чек-листе есть невыполненные пункты» (`:434`); When `moveTask('T-64','Готово')` («Новая») · Then `transition` «Переход «Новая → Готово» не предусмотрен процессом» (`:433`).
45. S-45 · `createTask({title:'', assignee:'Марина Котова', priority:'normal', due:'2026-10-03', project:'fleet'})` → `validation` «Укажите название задачи»; с `title 'Проверить тент'` → `data` ~ `/^T-\d+$/`, `tasks[0]` = `{status:'Новая', due:'03.10', project:'fleet', checklist:[], comments:[], links:[]}`; без `project` → `'fleet'` (`:449`).
46. S-46 · Given `fields` = поля v3 с `q-fuel.type 'text'` · When `publishForm('fm-insp', fields)` · Then `data 4`; `versions[3].fields` содержит `id 'q-fuel-v4'`; `published 4`, `status 'published'`, `draft` отсутствует; `R-1012.version === 3`; событие «Опубликована форма «Осмотр машины» v4. Старые ответы сохраняют свои версии» (`:425`); `fields []` → «В форме нет ни одного поля»; `label ''` → «У поля нет подписи».
47. S-47 · Given `logistics-ready`, `setActor('m-kotova')` · When `publishForm('fm-insp', fields)` · Then `no_permission` «Ни одна роль сотрудника не разрешает это действие.» (`r-manager.forms` = `[view, review]`, нет `settings`).

**14.6 SPA, касса, ремонт**
48. S-48 · Given `setActor('m-morozova','t-alta')` · When `completeAppointment('ap-1')` · Then `data 'ok'`, `ap-1.status 'done'`, `stock oil.qty 220`, `movements[0]` = `{item:'Масло массажное', qty:30, unit:'мл', basis:'Классический массаж · Мария К.'}`; повтор → `'duplicate'`, `movements.length 1` (`:482`).
49. S-49 · Given после S-48 на том же адаптере (`oil.qty 220`) · When `completeAppointment('ap-2')` · Then `'shortage'`, `cream.qty 0`, `oil.qty 180` (на свежем сиде — 210), `ap-2.status 'done_pending'`, `issues[0]` = `{item:'Крем восстанавливающий', need:20, missing:8, text:'Не хватило «Крем восстанавливающий»: нужно 20 г, списано 12 г · SPA-ритуал (Ольга Р.)', status:'open'}`; событие у владельца «SPA: услуга выполнена, учёт материалов не завершён — нужно решение» (`:493`); владелец `resolveIssue(id,'reserve')` → `resolved`, `how 'reserve'`, `ap-2.status 'done'` (`:501–503`).
50. S-50 · `addCashOp({account:'ca-sever', type:'out', amount:'500', basis:''})` → `validation` «Укажите основание операции»; `amount '0'` → «Сумма должна быть больше нуля»; корректно → `data` ~ `/^K-\d+$/`, `ops[0]` = `{amount:500, by:'Дарья Зимина', at:'01.10', src:null}`; `reverseCashOp('K-302','ошибка ввода (демо)')` → `ops[0]` = `{type:'storno', amount:2500, basis:'Сторно K-302: ошибка ввода (демо)', reverses:'K-302', sign:1}`, `K-302.reversedBy` = новый id; повтор → `conflict` «Операция уже исправлена»; `reason ''` → `validation` «Укажите причину исправления» (`:510–525`).
51. S-51 · Given `shift-accepted`, владелец · When `addCashOp({account:'ca-sever', type:'out', amount:1500, basis:'Рейс Р-208 · Топливо', src: expenses[0].id})` · Then `ops[0].src === expenses[0].id` (предложение «Рейс Р-208 · Топливо 1 500 ₽ · принят менеджером» — `cashVM`, WS-30).
52. S-52 · Given `repair-on`, `setActor('m-sokolov')` · `addWorkLog({work:'w1', volume:'50', crew:['k1'], photos:1})` → `validation` «Объём превышает план более чем на 10%: осталось 38 м²» (`:534`); `volume '22', crew ['k1','k2'], material 'mt2', materialQty 10, photos 2` → `data` ~ `/^WL-\d+$/`, `logs[0]` = `{status:'На проверке', by:'Алексей Соколов', volume:22, materials:[['mt2',10]]}`, `w1.fact 58`; событие у владельца «Прораб отметил «Подготовка стен»: 22 м² — нужна приёмка» (`:539`); `crew []` → «Отметьте работников»; `photos 0` → «Добавьте хотя бы одно фото»; `volume '0'` → «Объём должен быть больше нуля».
53. S-53 · Given отметка из S-52, владелец · When `acceptWorkLog(id)` · Then `status 'Принят'`, `w1.fact 80`, `mt2.qty 110`; повтор → `conflict` «Отметка уже обработана» (`:545`).

**14.7 Платформа**
54. S-54 · Given `setActor(null,'t-alta')` · When `load()` · Then ключи ровно `platform, operatorOnly, flags`; `tenants.length 4`; `requests` = `SR-12 pending`, `SR-9 approved`; `accounts.length 58`; `operators.length 6`; `audit.length 2` (`:71`).
55. S-55 · When `extendTrial('t-alta', 14)` · Then `status 'trial'`, `trialDaysLeft 26`, `trialEnds '27.10.2026'`; `audit[0]` = `{text:'Альта Групп: пробный период продлён на 14 дней', by:'Оператор (демо)'}`; событие у владельца «Оператор платформы продлил пробный период на 14 дней» (`:116–118`); `extendTrial('t-lotos', 7)` → `trialEnds 'через 7 дн.'`.
56. S-56 · When `setTenantStatus('t-alta','restricted')` · Then `restricted`, `trialDaysLeft 0`, аудит «Альта Групп: статус «Ограничен»»; событие у владельца «Пробный период завершён. Новые операции ограничены, данные сохранены.» (`:127`); водитель `reserve` → `subscription_restricted` «Пробный период завершён: новые операции недоступны. История доступна для чтения.» (`:55`); Given `driver-on-route` до ограничения → `finishRoute`/`submitReturn` проходят (`startedWork`, `:62–64`); `setTenantStatus('t-alta','active')` → событие «Ограничения подписки сняты».
57. S-57 · `setAccountLock('acc-3', true, '')` → `validation` «Укажите причину блокировки»; с `'Утерян телефон'` → `acc-3 {status:'locked', lockReason:'Утерян телефон'}`, аудит «i.vasiliev@alta.example: вход заблокирован — Утерян телефон»; `setAccountLock('acc-3', false)` → `'active'`, аудит «i.vasiliev@alta.example: вход разблокирован»; `acc-6` (без входа) разблокировать → `'pending'` (`:239–241`).
58. S-58 · `inviteOperator({name:'Тест', email:'x@gmail.com', role:'support'})` → `validation` «Оператором может быть только сотрудник платформы: почта в домене ortus.example»; `role 'owner'` → «Владельцем платформы назначают уже работающего оператора»; `'a.morozova@alta.example'` → `conflict` «Эта почта уже используется в организации клиента. Для оператора нужен отдельный рабочий аккаунт»; `'e.lapteva@ortus.example'` → `conflict` «Оператор с такой почтой уже есть»; `name ''` → «Укажите имя и рабочую почту»; корректно → `operators[6]` = `{status:'invited', mfa:null}`, аудит «Платформа: приглашён оператор t.novyy@ortus.example (support)» (`:246–252`).
59. S-59 · `setOperatorRole('op-1','admin')` → `conflict` «Свою роль менять нельзя: попросите другого владельца»; `setOperatorStatus('op-1', false)` → «Себя отключить нельзя»; `setOperatorStatus('op-5', false)` → оператор удалён, аудит «Платформа: приглашение d.valieva@ortus.example отозвано»; `setOperatorRole('op-5','owner')` → `validation` «Владельцем может стать только активный оператор со вторым фактором»; `setOperatorStatus('op-3', false)` → `'disabled'`, `disabledNote 'Отключён 10:30'`, аудит «Платформа: a.guseva@ortus.example отключён, сессии завершены». Сид с `op-1.me = false` (через `seed` фабрики): `setOperatorRole('op-2','admin')` → ок; `setOperatorRole('op-1','admin')` → `conflict` «На платформе должен остаться хотя бы один активный владелец»; `setOperatorStatus('op-1', false)` → «Нельзя отключить последнего активного владельца» (`:256–268`; на сиде недостижимо из-за `me`).
60. S-60 · `publishPriceBook({tiers: v2 с 'Старт' month 0, terms, from:'01.11.2026'})` → `validation` «Цена каждой ступени должна быть больше нуля»; корректно → `data 3`, `versions[2]` = `{v:3, scheduled:true, from:'01.11.2026', to:null, note:'Изменение цен', by:'Оператор (демо)'}`, `v2.to 'до 01.11.2026'`, `priceBook.scheduled 3`, аудит «Тарифная сетка v3 запланирована с 01.11.2026»; повтор → `conflict` «Уже запланирована версия v3. Отмените её, чтобы подготовить другую.»; `cancelScheduledPriceBook()` → `v3` удалена, `v2.to null`, `scheduled null`, аудит «Запланированная версия v3 отменена до начала действия»; повтор → `conflict` «Запланированной версии нет»; табличные входы для остальных 5 правил: «Ступень с большим числом мест должна стоить дороже предыдущей», «У каждого тарифа должно быть название», «Число мест должно расти от тарифа к тарифу», «Тариф без лимита может быть только последним», «Скидка за срок — от 0 до 49%» (`:213–219`).

**14.8 Изоляция организаций**
61. S-61 · Given `setActor('m-owner','t-lotos')` · When `load()` · Then `units` = 3 (`r-msk` «Москва», `f-lotos-tver` «Лотос · Тверская», `f-lotos-arb` «Лотос · Арбат»), `members.length 23`, `tasks` = `['T-7','T-8']`, `cash.accounts[0].name 'Касса «Лотос»'`, `vehicles []`, `trips []`, `knowledge.pages` = `['kb-3']`, `platform.tenants[0].brand` = `{accent:'#7A3E79', version:3}`, `terms.visit.one 'сеанс'`; `platform.tenants.length 1`.
62. S-62 · Given владелец «Лотоса» · When `saveBranding({...brand, name:'SPA «Лотос»', short:'Лотос', accent:'#7A3E79', terms:{visit:{one:'сеанс', plural:'сеансы', few:'сеанса', many:'сеансов'}}})` · Then `data 4`; у оператора `audit[0]` = `{text:'SPA «Лотос»: оформление, версия 4', by:'Ирина Белова'}`; у владельца «Альты» `brand.version === 1`; событие у владельца «Лотоса» «Оформление обновлено (версия 4). Изменения видны всем сотрудникам»; `name ''` → `validation` «Название — от 1 до 60 символов»; `short` из 17 символов → «Короткое имя — до 16 символов»; `accent 'red'` → «Цвет — в формате #RRGGBB»; `terms {visit:{one:'сеанс'}}` → «Заполните все формы термина «visit»» (`:133–136`).

**Покрытие методов и кодов, не затронутых 07 §14 (C-1…C-14)**
63. C-1 `not_found` · `reserve('Р-999','v1')` → «Рейс не найден»; `reserve('Р-208','v99')` → «Машина не найдена» (`:25–26`); `cancelReservation('Р-999')` → «Рейс не найден».
64. C-2 `module_off` · Given сид (логистика выключена), водитель · `reserve('Р-208','v1')` → «Модуль «Логистика» отключён» (`:308`); `finishRoute('Р-208')` (рейс `planned`) → «Модуль «Логистика» отключён: новые операции закрыты.» (`:64`); Given `driver-on-route` → владелец `setModule('logistics', false)` → водитель `finishRoute` проходит (`startedWork`).
65. C-3 `module_readonly` · Given `logistics-ready` → `setModule('logistics', false)` → `setActor('m-kotova')` · `assignVehicle('Р-211','v2')` → `module_readonly` «Модуль отключён. История доступна для чтения, новые операции закрыты.» (`models.js:79, 179`).
66. C-4 `no_scope` на команде · Given `logistics-ready`, владелец `assign` роли `r-manager` Марине с областью `{type:'firm', id:'f-msk-sever'}` уже есть · `setActor('m-kotova')`; `assignVehicle(…)` для рейса в `f-smr-volga` недостижим на сиде → используется `reserve('Р-208','v5')` водителем (= S-5) и дополнительно `decideDefect` водителем → `no_permission`; кейс фиксирует порядок guards: `trip() → veh() → assertActive → moduleOn → assertCan` (`:306–309`).
67. C-5 `resetMfa` · Given оператор · `resetMfa('acc-1')` → `acc-1.mfa false`, аудит «d.zimina@alta.example: сброшен второй фактор, при входе попросим настроить заново» (`:271–272`).
68. C-6 `setStorageQuota` · владелец `setStorageQuota(25)` → `quotaGb 25`, событие «Лимит места изменён на 25 ГБ» (`:152`); Given `trial-ended` → `subscription_restricted`.
69. C-7 `cancelSeatRequest` · после S-16 `cancelSeatRequest(id)` → `status 'cancelled'`, `decidedBy 'Дарья Зимина'`; повтор → `conflict` «Заявка уже рассмотрена» (`:193`).
70. C-8 `createRole` · `({name:'  ', mode:'empty'})` → `validation` «Укажите название роли»; `({name:'Диспетчер', mode:'copy', sourceId:'r-manager'})` → `data` ~ `/^r-\d+$/`, роль `{kind:'custom', actions: копия r-manager.actions, finance:{read:true, manage:false}}`; `mode 'empty'` → `actions {}`, `finance {read:false, manage:false}`; копия `r-driver` → `professional 'driver'` (`:289–293`).
71. C-9 `cancelReservation` · Given `driver-booked` · `cancelReservation('Р-208')` → рейс `{vehicleId:null, status:'planned', defect:null}`, `v1 {state:'free', heldBy:null}` (`:319–323`); прав не проверяет.
72. C-10 `resetTrip` · Given `driver-on-route`, `setFlag('online', false)` · `resetTrip('Р-208')` проходит (`needsNet=false`, `:400`) → рейс `{vehicleId:null, status:'planned', dep:null, ret:null, expenses:[], review:null, defect:null}`; `v1` **не** освобождается (`state 'on_route'`, `heldBy 'Р-208'`).
73. C-11 `toggleTaskCheck` · владелец `toggleTaskCheck('T-58', 1)` → `checklist[1].d true`; повтор → `false`; водитель → `no_permission` (`r-driver` без `tasks`).
74. C-12 `commentTask` · `commentTask('T-58','')` → `validation` «Комментарий пустой»; `'Готово к ТО'` → последний комментарий `{by:'Дарья Зимина', text:'Готово к ТО'}`; `logistics-ready` + `m-kotova` → `by 'Марина Котова'`; водитель → `no_permission` (`:440–443`).
75. C-13 `upload` прогресс и офлайн · `onProgress` строго возрастает, промежуточные ≤ 96, последний 100; `usedGb` 46.2 → 46.203 (`bytes` по умолчанию 3.2e6, округление 0,001, `:565`); `setFlag('online', false)` до вызова → `offline` «Нет связи. Фото сохранено на устройстве и будет отправлено позже.» (`:553`); флаг снят во время загрузки (после первого `onProgress`) → `offline` «Связь прервалась во время загрузки.» (`:560`).
76. C-14 `flags`/`setFlag` · `adapter.flags` — живая ссылка: после `setFlag('online', false)` `adapter.flags.online === false`, `load().flags.online === false`, но `load().flags` — копия (мутация не влияет, `:84`).

**Mock-специфичные (M-1…M-8; `modes: ['mock']`, лежат в `cases/10-mock-only.ts`, используют `snapshot()` только там, где отмечено)**
77. M-1 порядок в `cmd` · `delays {default: 100}`, fake timers, `setFlag('online', false)`: промис `setModule` висит на `t = 99 мс`, отклоняется `offline` на `t = 100` (`:100–101`); с `delays: 0` — разрешается без таймеров.
78. M-2 `e.db` · любая ошибка `cmd` несёт `db` = `view()` после частичной мутации: S-21 — `e.db.vehicles` содержит `v6 reserved/other` (`:103`, 07 §13 п.29).
79. M-3 `syncSeats` · после каждой успешной команды `tenant.seatsUsed = |active ∪ invited|`, `tenant.members = members.length`: `invite` → 10/11; `revokeInvite` → 8/9; `blocked` не считается (`:30–32`).
80. M-4 `ops` общий для адаптера · `addExpense` c `opId 'x-7'` водителем, затем `setActor('m-owner')` и тот же `opId` → `'duplicate'` (`:21, 362`; Q-87 — как в прототипе).
81. M-5 `recordInspection` · (а) после S-37 (`rework`) повторная сдача → ключ `Р-208:ret:rev2` → второй ответ «· сдача» (`:41`); после `decideDefect('confirm')` + новая бронь и выезд → ключ `Р-208:dep:rev1` уже есть → второго ответа нет (Q-59 как в прототипе); (б) сид с `fm-insp.published = null` → ни ответа, ни задачи (`:40`); (в) сид с `au-1.on = false` → ответ есть, задачи нет (`:48`; 07 §16 п.19).
82. M-6 пресеты · каждый из 14 применяется к свежему адаптеру без ошибок и даёт результат из таблицы П; `load()` после пресета для персонажей-владельцев рецепта (`owner`, `driver`, `manager`, `operator`, `owner@t-lotos` по применимости) записывается в `__snapshots__/presets/<preset>.<persona>.json` (`toMatchFileSnapshot`); `applyPreset('kb-conflict')` не сбрасывает состояние; `applyPreset(x, {reset:true})` после другого пресета = результат на свежем сиде.
83. M-7 детерминизм · `clock` = `2026-10-01T10:30:00+03:00` → `hhmm()` даёт `'10:30'` в `events[].at`, `audit[].at`, `disabledNote 'Отключён 10:30'`; `invitedNote 'Приглашение до 08.10'`; `rng: () => 0` → `onProgress` ровно `8, 22, 36, 50, 64, 78, 92, 100` (шаг 14, цикл выходит на `p = 106` до колбэка, `:558–566`).
84. M-8 `view()` для 8 персонажей (таблица §5) · для каждого `setActor` → `load()` сверяется с ожиданиями колонки «Что отдаёт `load()`»; для оператора в ответе нет ключей `members`, `trips` и т. п.; для сотрудника нет `platform.audit/accounts/operators`, `platform.requests` только своей организации (`:73–77`).

### 6б. Unit-тесты внутренностей мока (`src/mock/*.test.ts`, табличные; вход → ожидание)

| Файл | Таблица |
|---|---|
| `guards.test.ts` | `assertActive`: `trial`→ок, `active`→ок, `restricted`→`subscription_restricted`, `suspended`→`subscription_restricted` (`:53–56`); `assertLogisticsFor(t, 'create')`: 6 статусов `startedWork` × модуль выключен → ок (только право), `planned`/`assigned` × выключен → `module_off` «…: новые операции закрыты.», `planned` × `restricted` → `subscription_restricted`, `on_route` × `restricted` → ок; `assertCan` → `ApiError(reason, REASON[reason].text)` для 5 причин |
| `state.test.ts` | `seatsUsed`: сид → 9 (`active` 7 + `invited` 2; `blocked` не считается); `owners()` → `['m-owner']`; `reviewers('f-msk-sever')`: сид → `[]` (модуль выключен), после `logistics-ready` → `['m-owner','m-kotova']`; `tierOf('team')` → `{seats:25, month:8900}` (v2), `tierOf('team', 1)` → `8500`; `account('D.ZIMINA@alta.example ')` → `acc-1`; `actorName()` при `actor null` → `'Владелец'`; `PAID_UNTIL` = `{1:'31.10.2026', 4:'31.01.2027', 8:'31.05.2027', 12:'30.09.2027'}` |
| `delays.test.ts` | каждая запись `Delays` равна значению прототипа (строки в §4); `delays: 0` обнуляет все; `delays: {reserve: 5}` меняет только `reserve` |
| `view.test.ts` | `projVisible`: владелец — все проекты; грант с `actions.tasks` и `scopeCovers` — да; `self` — нет; `tasks` — по видимому проекту **или** `assignee === me.name`; `responses` — все при `seesLog` иначе только свои; брони не-владельца без `source.kind 'vehicle'` при `!seesFleet` |
| `automation.test.ts` | `values` ответа для `fuel 'tq'` → `'¾'`, `odometer '84400'` → `'84 400'`, дефект критический → `q-critical 'да'`, `q-defect-text 'Кузов: Вмятина на двери'`; `priority` `urgent`/`normal` |
| `presets.test.ts` | таблица П: имя → проверяемый результат (дублирует M-6 на уровне `snapshot()`) |

### 6в. Компонентные

— (вид `domain`, `00-master-plan.md` §8.1: компонентов нет).

### 6г. Контрактные

- `coverage/methods.test.ts`: объединение `covers` всех кейсов с `modes ⊇ ['mock','http']` = `METHODS_51` (ровно, без лишних имён); красный на скелете (все `covers` пусты).
- `coverage/codes.test.ts`: объединение `codes` всех кейсов = `CODES_18`.
- `messages.test.ts`: каждая строка `messages.ts` (≈ 95 сообщений `ApiError`, 23 текста событий, 16 текстов аудита) встречается дословно в `design/ortus/api.js` (`fs.readFileSync`, только чтение); исключения — записи с `source: 'D-27'` (§10 п.1). Каждый `throw new ApiError(` в `src/mock/**` ссылается на константу из `messages.ts` (grep-тест: литералов кириллицы в `src/mock/methods/*` нет).
- `port.test-d.ts` (`expectTypeOf`): `ReturnType<typeof createMockAdapter>` присваивается `AdapterPort`; `kind` — литерал `'mock'`; `MockAdapter` не имеет `tenantIds`/`defaultBranding` (Q-88).
- `portability.test.ts`: в `cases/01…09` нет импортов из `src/mock` и вызовов `snapshot()` (grep).
- Контракт с WS-51/WS-53: `runConformanceSuite({mode:'http', …})` компилируется против `factory.ts` (тип-тест на `AdapterFactory`); раннер `runners/mock.conformance.test.ts` — 5 строк.

## 7. Шаги реализации (TDD-циклы; оценка — в часах агента, итого ≈ 2,5 сессии)

| # | Единица | Красный тест | Зелёная реализация | Рефакторинг | Оценка |
|---|---|---|---|---|---|
| 0 | Каркас пакета и скелет | `pnpm --filter @ortus/adapter test` поднимает 84 `it.todo`; `coverage/*` и `messages.test.ts` красные по утверждению (пустые `covers`, пустой `messages.ts`), не по импорту | `package.json`, `tsconfig.json`, `vitest.config.ts`, `types.ts`, `factory.ts`, `suite.ts`, `cases/*` (объекты с `run: todo`), `METHODS_51`, `CODES_18`, `messages.ts` (все строки) | — | 2 ч |
| 1 | `state` + `cmd` + `guards` + `delays` | `guards.test.ts`, `state.test.ts`, `delays.test.ts`, M-1, M-2, M-3, C-14 | `state.ts`, `cmd.ts`, `guards.ts`, `delays.ts`, `createMockAdapter` с `setActor/setFlag/load/flags/kind/reset` | выделить `tenantOf(id)`; типизировать `Flags` | 2 ч |
| 2 | `view()` | `view.test.ts`, S-11, S-54, S-61, S-19, M-8 | `view.ts` 1:1 с `api.js:70–97` (JSON-клон) | вынести `withLogisticsOn(db)` (три места `{...db, modules:{...logistics enabled}}`, `:65, 81, 83, 91`) | 2 ч |
| 3 | Платформа (11 методов) | S-17, S-18, S-55…S-60, C-5 | `methods/platform.ts` | таблица валидаций `publishPriceBook` как массив правил | 2 ч |
| 4 | Организация (3) | S-1, S-2, S-62, C-6 | `methods/org.ts` | — | 1 ч |
| 5 | Люди/роли/места (8) | S-7…S-10, S-12…S-16, C-7, C-8 | `methods/people.ts` | `assertRoleFinanceRules(role, holders)` общий для `assign`/`saveRole` | 2 ч |
| 6 | Логистика I: бронь, назначение, файлы | S-20…S-23, S-34, S-35, S-39, C-1…C-4, C-9, C-13 | `methods/fleet.ts` (`reserve`, `cancelReservation`, `assignVehicle`), `methods/files.ts` (`upload` с `rng`) | `markHeldByOther(v)` для `conflictNext` | 2 ч |
| 7 | Логистика II: осмотр, расходы, сдача, автоматизация | S-24…S-33, M-4, M-5, `automation.test.ts` | `automation.ts`, `submitDeparture`, `decideDefect`, `addExpense`, `finishRoute`, `submitReturn` | `inspectionRecord(payload)` общий для `dep`/`ret` | 3 ч |
| 8 | Логистика III: приёмка, сброс, пул | S-36…S-38, S-40, C-10 | `reviewTrip`, `resetTrip`, `requestDriver`, `decideRequest` | — | 1,5 ч |
| 9 | Core (7) | S-41…S-47, C-11, C-12 | `methods/core.ts` | — | 2 ч |
| 10 | SPA/касса/ремонт (6) | S-48…S-53 | `methods/spa-cash-repair.ts` | `moneyFromInput(s)` общий (`replace(',', '.')`, `:365, 509, 532`) | 1,5 ч |
| 11 | Пресеты и сценарии | M-6, M-7, `presets.test.ts`; снимки `__snapshots__/presets/*` | `presets/*.ts`, `applyPreset`, `scenario()` через `@ortus/domain/scenarios` | композиция пресетов через `compose(...)` | 2 ч |
| 12 | Покрытие, паритет, портируемость | `coverage/*`, `messages.test.ts`, `portability.test.ts`, `port.test-d.ts` зелёные; `coverage ≥ 90 %` | заполнить `covers`/`codes`/`modes`; убрать литералы | `pnpm lint`, `pnpm typecheck`; отчёт `docs/plan/reports/WS-06.md`; строка `status.md` | 1,5 ч |

Каждый цикл — отдельные коммиты `test(adapter): …` → `feat(adapter): …` → `refactor(adapter): …` (`tdd-protocol.md` §1); `it.todo` снимается в коммите `test(...)`, падение — по утверждению.

## 8. Проверка

Страниц нет (`pages: []`), поэтому `verification-protocol.md` §1 (e2e), §3 (визуальная сверка) и §4 (MCP-проходка) к WS-06 **не применяются** (`00-master-plan.md` §8.1, колонка `domain`: «—»). Вместо них обязательны:

1. **Сюита и покрытие** (аналог §1): `pnpm --filter @ortus/adapter test` — 84/84 зелёные, 0 `todo`/`skip`; `pnpm --filter @ortus/adapter coverage` — `src/mock/**` ≥ 90 % строк; `pnpm --filter @ortus/adapter typecheck`; `pnpm lint`. Вывод — дословно в отчёт (`orchestration.md` §5 «Прогоны», последние 40 строк).
2. **Паритет с эталоном** (аналог §3): `messages.test.ts` зелёный — все тексты найдены в `design/ortus/api.js`; `delays.test.ts` зелёный — задержки равны прототипу.
3. **Ручная сверка на эталоне** (аналог §4, 15 минут, обязательна): поднять `node tools/design-preview.js design 4173`, открыть `http://127.0.0.1:4173/Ортус%20CRM.dc.html` через Playwright MCP (`mcp__playwright__*`, `.mcp.json` — если WS-07 ещё не влит, использовать браузер MCP из проекта 2.0, 12 §8 п.2) и воспроизвести три сообщения адаптера UI-шагами по подписям: (а) «Владелец · Дарья Зимина» → «Модули и место» → «Логистика» → «Подключить» → «Подключить» → «Пользователи и роли» → «Люди» → «Марина Котова» → «Назначить роль» → «Назначить» → «Водитель · Илья Васильев» → «Моя смена» → флажок «Конфликт брони» → «Забронировать» у «Mercedes Sprinter» → `browser_snapshot`: `role="alert"` с текстом «Машину только что забронировал другой сотрудник. Список на экране устарел.» (= S-21); (б) флажок «Нет связи» → «Забронировать» у «ГАЗель Next» → тост «Бронь требует связи с сервером» (UI-текст; подтверждает, что `offline` адаптера до UI не доходит — S-22); (в) «Владелец · Дарья Зимина» → «Пользователи и роли» → «Пригласить» → «Иван Тестов», `i.testov@alta.example` → «Пригласить» → ещё раз «Пригласить» → `role="alert"` «Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.» (= S-13). Выдержки `browser_snapshot` (строки с текстами) и `browser_console_messages` (нет `[dc-runtime]`) — в раздел «Проверка MCP» отчёта; снимки — `docs/plan/evidence/ws-06-adapter/{conflict,offline,seats}.png` (ключ без страницы, помечен в отчёте как служебный). Если MCP недоступен — это блокер для п.3, но не для слияния (решение интегратора; `verification-protocol.md` §4 последний абзац).
4. **Ревью** (§5): 1 ревьюер; проверяет порядок коммитов `test(` → `feat(`, отсутствие кириллических литералов в `src/mock/methods/*` (все через `messages.ts`), отсутствие импортов `src/mock` в `cases/01…09`, 1:1 с `api.js` по порядку guards в каждом методе (построчное сравнение), отсутствие «улучшений» (Q-65, Q-86, Q-85, Q-87 — как в прототипе).

## 9. Критерии готовности (DoD)

- [ ] `tdd-protocol.md` §4: все тесты §6 зелёные локально; `src/mock/**` ≥ 90 % строк; `eslint`/`prettier`/`tsc` без ошибок; ни одного `skip`/`todo` без ссылки на `decisions.md`.
- [ ] Первый коммит ветки — `test(adapter): скелет conformance-suite` с 84 `it.todo` и красными `coverage/*`, `messages.test.ts`.
- [ ] 51/51 методов и 18/18 кодов покрыты (`coverage/*` зелёные); каждый метод имеет ≥ 1 кейс с `modes ⊇ ['mock','http']`.
- [ ] `messages.test.ts`: все сообщения дословно из `api.js`; единственное исключение — п.1 §10 с `source: 'D-27'`.
- [ ] `createMockAdapter` типизирован как `AdapterPort & MockControls`; `tenantIds`/`defaultBranding` отсутствуют (Q-88); `createHttpAdapter` не портирован.
- [ ] 14 пресетов таблицы П применяются и дают заявленный результат; снимки `__snapshots__/presets/*` закоммичены; `applyPreset` работает при любых `delays` (внутри — 0).
- [ ] `clock`, `delays`, `rng`, `seed`, `scenario`, `actor` инжектируются; с фиксированными `clock`/`rng` сюита детерминирована (три прогона подряд — одинаковый вывод).
- [ ] Ни одной правки вне границ §2; `design/` не тронут; `@ortus/domain` не изменён (дефекты домена — в отчёте, раздел «Контракты, которые я изменил» пуст или согласован).
- [ ] Отчёт `docs/plan/reports/WS-06.md` по `orchestration.md` §5 с дословным выводом прогонов и разделом «Проверка MCP» (п.3 §8); строка WS-06 в `status.md` → «на проверке».
- [ ] Ревью `approve` (1 ревьюер, §8 п.4); готовность к барьеру 0→1 (`00-master-plan.md` §6.5: `pnpm lint && pnpm typecheck && pnpm test`).

## 10. Риски, расхождения, открытые вопросы — что делаем по умолчанию

| # | Вопрос | По умолчанию | Источник |
|---|---|---|---|
| 1 | `TypeError` прототипа на несуществующих id в `assign` (member), `unassign` (нет — молча), `decideRequest`, `toggleTaskCheck`, `commentTask`, `moveBooking`, `saveKbPage`, `resolveIssue`, `reverseCashOp`, `acceptWorkLog`, `setAccountLock`, `resetMfa`, `setOperatorRole/Status`, `completeAppointment`, `addWorkLog` | падение — ошибка прототипа (D-27, Q-30): мок бросает `ApiError('not_found', 'Объект не найден')`; строка помечена `source: 'D-27'` в `messages.ts` и исключена из паритета; из UI недостижимо (снимки не меняются); предложить интегратору запись `Q-121` в `decisions.md` | 07 §12.2; D-27 |
| 2 | Даты-литералы прототипа (`'01.10.2026'`, `at:'01.10'`, `due:'01.10'`, `'27.10.2026'`, `'через N дн.'`, `'09:30'`, `'18:00 01.10'`, `PAID_UNTIL`) | остаются литералами 1:1 (не «улучшаем»); только `hhmm()` читает `clock` и `invitedNote` = `clock + 7 дн.` → «Приглашение до 08.10» (Q-15, 00 §10.2) | 07 §12.2, §16 п.17; D-45 |
| 3 | `Math.random()` в шагах `upload` | инжектируемый `rng` (по умолчанию `Math.random`) — без видимого следа | `api.js:558` |
| 4 | Серверные проверки, которых нет в моке: `assignVehicle` без `module_off`, `moveBooking` без прав, `assertActive` отсутствует в `reverseCashOp`/`acceptWorkLog`/`resolveIssue`/`saveKbPage`/`publishForm`/задачах | как в прототипе; кейсы фиксируют **отсутствие** проверки (чтобы http-адаптер фазы 2 не ломал экраны фазы 1 неожиданно; расхождение стенда — allowlist `mode: stand`) | Q-65, Q-86; 07 §12.2 |
| 5 | `view()` не фильтрует `members/roles/assignments/groups/forms/pool/spa/repair` | как в прототипе (M-8 это фиксирует) | Q-85; 07 §15 п.11 |
| 6 | `ops` общий для организаций и не проверяет payload | как в прототипе (M-4); канон `tenant + actor + opId` — WS-40/WS-47 | Q-87 |
| 7 | Дедупликация `recordInspection` по `trip:kind:rev1/rev2` | как в прототипе (M-5a); Q-59 | 07 §15 п.9 |
| 8 | Мок не различает `restricted`/`suspended` (`subscription_restricted`) | как в прототипе; маппинг `tenant_read_only`/`tenant_suspended` → `subscription_restricted` — `errors/map.ts` (WS-05) и http-адаптер (WS-51) | 07 §6, §15 п.3; Q-82 |
| 9 | `≥ 1 активный владелец` платформы (мок) vs «≥ 2» (канон, D-46) | как в прототипе (S-59); канон — WS-67 | 07 §15 п.4; Q-11 |
| 10 | `conflictNext` мутирует машину до броска (`:311, 327`), `completeAppointment` списывает частично | намеренно, как в прототипе (S-21, S-49, M-2) | 07 §12.2 |
| 11 | ID новых сущностей зависят от общего `seq` (события тоже инкрементируют) | кейсы сравнивают по шаблону; снимки пресетов детерминированы только при фиксированном порядке вызовов | 07 §15 Q13 |
| 12 | Область по умолчанию в диалоге «Назначить роль» для рецепта `logistics-ready` | пресет использует `{type:'firm', id:'f-msk-sever'}` (07 §14 #7); если WS-07/WS-14 по 02 §6.9 выберут другую — пресет приводится к рецепту через интегратора до WS-55 | 00 §2.4 |
| 13 | Значения осмотра/сдачи и текст дефекта в пресетах (`84400`, `tq`, `84450`, `h`, «Вмятина на двери»), заметка `empty-requests` | зафиксированы в таблице П как контракт с WS-23/WS-27; расхождение с рецептом → дефект WS-55 `recipes-vs-presets` | 00 §2.4, D-26 |
| 14 | `kb-conflict` невоспроизводим на эталоне | пресет-команда «вторая сессия» (не оверлей сида); `visual`/`labels` — allowlist `no-reference` у WS-29 | 06 §14 Q1; D-26 |
| 15 | Форма `ApiError` (`extra` vs верхнеуровневые `vehicleId`/`slots`/`db`) | как определил WS-05; при расхождении с 07 §10 — следовать WS-05, отметить в отчёте | 00 §4.5 |
| 16 | Утечки сида «Альты» в «Лотос» (`b-208`, `b-to` в календаре «Лотоса») | адаптер не фильтрует сид; S-61 проверяет только поля 07 §14 #61; ожидания календаря — из `seed/snapshot.json` WS-05 | Q-31; D-27 |
| 17 | `kind: 'mock'`-зависимые кнопки «Демо: …», `resetTrip`, `decideRequest` без проверок | в моке как в прототипе; в http-сборке скрыты `DemoOnly` (D-44) — не забота WS-06 | 00 §4.10 |

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-06 `mock-adapter-port` волны 0 проекта «Ортус CRM» (вид `domain`, страниц нет). Прочитай полностью бриф `docs/plan/ws/WS-06-mock-adapter-port.md` и все документы его раздела 3 «Входы»: `design/ortus/api.js` целиком, `docs/plan/analysis/07-domain-and-adapter.md` §3–§6, §9, §10, §12–§16, `03-logistics.md` §11.4–11.6, `09-data-permissions-errors.md` §10 п.19–20, `00-master-plan.md` §2.4, §4.5, §4.6, §4.10, §8.1 и D-26, D-27, D-31, D-39, D-44, D-45; протоколы `tdd-protocol.md`, `verification-protocol.md`, `orchestration.md`. Эталон `design/` неприкосновенен; все сообщения — дословно из `api.js`; любое отклонение от прототипа — только через `decisions.md` (предложения — в отчёте).

Работай в worktree на ветке `ws/ws-06-mock-adapter-port` от `main` (команды — бриф §2), `pnpm install` в worktree. Пиши только в `frontend/packages/adapter/{package.json,tsconfig.json,vitest.config.ts,src/mock/**,test/conformance/**}`, `docs/plan/reports/WS-06.md` и свою строку `docs/plan/status.md`.

Порядок: первый коммит — `test(adapter): скелет conformance-suite` с 84 `it.todo` из брифа §6а (ID S-1…S-62, C-1…C-14, M-1…M-8, тексты дословно), `METHODS_51`, `CODES_18`, `messages.ts`, красные `coverage/*` и `messages.test.ts`. Затем циклы §7 (0→12) строго Red → Green → Refactor, коммит на каждый шаг, `it.todo` снимаются по одному. Реализация — 1:1 с `api.js:15–570` (порядок guards, коды, тексты, побочные эффекты, задержки), `createHttpAdapter` не портируешь. Утверждения в кейсах — только через `{data, db}`, `load()` и `ApiError`; `snapshot()` — только в `src/mock/*.test.ts` и `cases/10-mock-only.ts`.

Перед завершением: `pnpm --filter @ortus/adapter test`, `coverage` (≥ 90 %), `typecheck`, `pnpm lint`; ручная сверка трёх сообщений на эталоне 4173 через Playwright MCP по брифу §8 п.3. Верни отчёт `docs/plan/reports/WS-06.md` по `orchestration.md` §5: таблица «Тест → коммит red → коммит green», дословный вывод прогонов, раздел «Проверка MCP», список оставшихся `todo` (должен быть пуст) и предложения в `decisions.md` (бриф §10 п.1). Если заблокирован (например, в `@ortus/domain` нет нужной функции) — опиши блокер в отчёте и сообщи интегратору, не обходи его правкой чужих каталогов.
