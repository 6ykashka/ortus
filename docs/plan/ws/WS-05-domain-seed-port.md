# WS-05 · packages/domain: типы, порт `models.js` 1:1, TS-сид, snapshot, сценарии, clock, AdapterPort, renames, errors/map, nav

Волна 0 · Размер M (≈ 2–3 сессии) · Вид `domain` · Зависит от WS-01 · Блокирует WS-06, WS-10, WS-14, WS-20…WS-32, WS-52 (`00-master-plan.md` §5.1, §6.1). Страниц (`pages`) нет; ревьюер — 1 (§8.1). Пайплайн: WS-06 стартует после слияния этого WS (§6.2); WS-04 ждёт `brand.ts` (реэкспорт `brandVars/contrastW/fixAccent`, §5.4 WS-04).

## 1. Цель

После WS-05 в `main` лежит пакет `@ortus/domain`, из которого все страницы, оболочка и mock-адаптер получают **ровно те же** числа, подписи и данные, что рисует прототип: 28 чистых функций `design/ortus/models.js` (25 по счёту 07 §16 п.2 + `isIndustry`, `tempLabel`, `hm`) и 22 справочника дословно; 10 чистых функций из `Ортус CRM.dc.html` (`brandVars`, `contrastW`, `fixAccent`, `mixHex`, `capF`, `termOf`, `tierList`, `calc`, `termLabel`, `validateDraft`); сид обеих организаций и платформы, равный `seed()`/`seedLotos()` прототипа байт-в-байт по JSON; `snapshot.json` с отсортированными ID (эталон Go-сида, PD-19/PD-30); 5 сценарных оверлеев; инжектируемые часы; интерфейс `AdapterPort` на 51 метод; таблица переименований прав и карта кодов ошибок; чистые `navForBase/brandNav/gateVM/bannersVM` с текстами 01 §9, §11, §12 дословно.

## 2. Границы файлов

**Создаёт (владеет целиком):** `frontend/packages/domain/**`

```text
frontend/packages/domain/
├─ package.json            # name "@ortus/domain", "type":"module", exports: ".", "./seed", "./scenarios", "./nav", "./clock", "./errors", "./permissions", "./adapter.port"
├─ tsconfig.json           # extends ../../tsconfig.base.json (WS-01), strict, noUncheckedIndexedAccess
├─ vitest.config.ts        # coverage.provider v8, thresholds lines/branches/functions 90, include src/**
├─ README.md               # карта «файл прототипа → файл пакета», команды, формат snapshot.json
├─ scripts/build-snapshot.ts
├─ src/
│  ├─ index.ts             # экспорт-лист (заморожен для волны 1, расширяется только аддитивно)
│  ├─ types.ts             # 07 §10 целиком (Scope, Assignment, Role, …, Db, View, ApiError, ApiResult)
│  ├─ models/{index,dictionaries,format,units,access,fleet,calendar,tasks,brand,billing,pricebook}.ts
│  ├─ seed/{index,platform,alta,extra,lotos,defaults,snapshot}.ts + seed/snapshot.json
│  ├─ scenarios/{index,empty-review,empty-requests,empty-calendar,kb-conflict,no-trip}.ts
│  ├─ clock.ts
│  ├─ adapter.port.ts
│  ├─ errors/{api-error,codes,map}.ts
│  ├─ permissions/renames.ts
│  └─ nav/{index,personas,nav-for-base,brand-nav,gate-vm,banners-vm}.ts
└─ test/
   ├─ parity/{models.parity,seed.parity}.test.ts   # дифференциальные тесты против design/ortus/*.js
   ├─ models/*.test.ts · seed/*.test.ts · scenarios/*.test.ts · nav/*.test.ts
   └─ clock.test.ts · errors/map.test.ts · permissions/renames.test.ts · adapter.port.test.ts · index.test.ts
```

**Меняет (только свою строку/запись):** `docs/plan/status.md` (строка WS-05), `docs/plan/reports/WS-05.md` (создаёт).

**Запрещено:**
- `design/**` — эталон; читается через `import` в `test/parity`, не копируется и не правится.
- `frontend/packages/{adapter,ui,tokens,texts,api-client,e2e-kit}/**` (WS-06/04/08/03/07), `frontend/apps/**`, `api/**`, `backend/**`.
- Корневые `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/**`, `.claude/**` (WS-01) — если нужна правка, запрос интегратору в отчёте («Контракты, которые я изменил»).
- `docs/plan/analysis/**`, `docs/plan/decisions.md` (WS-00).

**Worktree и ветка** (имя ветки по `workflow.template.js:69`; PowerShell 5.1 — без `&&`, 12 §8 п.3):

```powershell
git worktree add ..\ortus-ws05 -b ws/ws-05-domain-seed-port main
Set-Location ..\ortus-ws05
pnpm install                                   # в каждом worktree (12 §8 п.16)
pnpm --filter @ortus/domain test               # после каждого цикла
```

Коммиты — `git commit -F <файл без BOM>` (`[System.IO.File]::WriteAllText(path, text, (New-Object System.Text.UTF8Encoding $false))`, 12 §8 п.25); формы `test(ws-05): …` → `feat(ws-05): …` → `refactor(ws-05): …`. Dev-сервер не нужен; если понадобится — `PORT = 5178` (§7.4).

## 3. Входы

| Источник | Что взять |
|---|---|
| `design/ortus/models.js:1–305` | 28 функций и 22 справочника — переносятся 1:1 (имена, порядок проверок, тексты); JSDoc `:5–9` → `types.ts` |
| `design/ortus/mock-data.js:1–276` | `seed()`, `BRAND_DEFAULT`, `seedBrands`, `fillAccounts` (`:21–39`, детерминированный генератор 45 аккаунтов), `seedLotos` (`:42–80`), `baseSeed` (`:81–275`) |
| `design/ortus/extra-data.js:1–85` | `extraSeed()`: calendar, knowledge, spa, cash, repair |
| `design/Ортус CRM.dc.html:2323–2367` | `MEMBER`, `MEMBER_BY`, `midOf`, `DEFAULT_PAGE`, `PAGE_MOD`, `TONE`, `LINE`, `BR_PALETTE`, `BR_TERMS`, `BR_ICONS`, `BR_LOCK`, `hex2rgb…brandVars`, `fmtRatio`, `capF`; `PLAN_LABEL/PLAN_ICON` не переносить (PD-24) |
| `design/Ортус CRM.dc.html:2933–3001` | `navFor`, `termOf`, `brandNav`, `navForBase` |
| `design/Ортус CRM.dc.html:3051–3093` | `gateVM`, `bannersVM` |
| `design/Ортус CRM.dc.html:3562–3569`, `:3864–3884` | `tierList`, `calc`, `termLabel`; валидация черновика сетки (9 правил) |
| 07 §8 (`07-domain-and-adapter.md:312–411`) | каталог функций с ≥ 60 примерами — табличные unit-тесты |
| 07 §9 (`:415–500`) | инвентарь сида: количества и ключевые записи для снапшот-теста; §9.5 персонажи |
| 07 §10 (`:504–559`) | JSDoc → TypeScript: полный список типов |
| 07 §11 (`:563–603`) | ключи прав прототипа vs канон |
| 07 §16 п.1–3, 16–18 (`:803–805`, `:833–835`) | 53/51 метода, 25 функций, U+00A0, инжектируемый `clock`, захардкоженные имена |
| 07 §4.1–4.8, §5, §6 (`:106–262`) | сигнатуры, возвраты, коды ошибок каждого метода → `adapter.port.ts`, `errors/codes.ts` |
| 02 §7.3 (`02-company.md:386–412`), §12 п.13–15 | `calc` с ожидаемыми числами; контраст/затемнение; `rolePermKeys` 22/10/5/6 |
| 02 §13 п.2 | `#FFD400` → `#8A7300` за 15 итераций, «1,4:1» → «4,6:1» |
| 03 §16 п.4, 7 | первый TDD-пакет (`compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`, `plural`, `tempLabel`); 9 состояний рейса, 5 — машины |
| 06 §15 п.4 | `busySpan`, `bookingConflicts`, `freeSlots`, `hm`, `rub`, `num`, `can`, `grants` |
| 09 §4.4 (`09-…:354–370`) | 10 `prototype_renames` + ключи без соответствия |
| 09 §5.2–5.3 (`:429–515`) | реестр кодов (36 строк / 38 идентификаторов) + коды вне реестра; таблица «код мока → канон» |
| 01 §8.3, §9.1–9.2, §11, §12, §17.1, §22 п.4–5 | меню 8 персонажей, `brandNav`, 5 баннеров, тексты AccessGate, `brandVars` с вычисленными значениями |
| 04 §5.2 «Расчёт агрегатов», §5.5 «Валидация черновика» | `59 из 70`, `141,4 из 275 ГБ` (константы тенантов), `34 из 57` (зависит от `fillAccounts`); 9 текстов ошибок дословно |
| 00 §10 п.5 | общие ошибки прототипа (`s.w`, дефолты Лотоса, `formsVM`, имена/даты) |
| `00-master-plan.md` §4.5, §4.6, §4.2, §2.3 п.2–3, §10.3 PD-19, PD-25, PD-27, PD-30, PD-45, PD-46 | контракт `AdapterPort`, состав домена, карта кодов, часы `2026-10-01T10:30:00+03:00` |
| `decisions.md` Q-15, Q-21, Q-22, Q-23, Q-30, Q-31, Q-54, Q-60, Q-61, Q-66, Q-82, Q-83, Q-88, Q-97, Q-98 | поведение по умолчанию (см. §10) |

## 4. Контракты

### 4.1 Публикует (экспорт-лист `src/index.ts`; имена = имена прототипа)

| Модуль | Экспорт | Сигнатура / содержимое | Источник |
|---|---|---|---|
| `types.ts` | все типы 07 §10 | `Scope`, `Assignment`, `Role`, `VehicleState`, `TripState`, `Verb`, `IndustryKey`, `CoreKey`, `ModuleKey`, `Reason`, `CanResult`, `Grant`, `Tone`, `Unit`, `Member`, `Group`, `ModuleState`, `Vehicle`, `Cargo`, `Stop`, `PhotoState`, `PhotoSlot`, `Defect`, `InspectionPayload`, `Inspection`, `Expense`, `Review`, `Trip`, `Earning`, `Event`, `PoolDriver`, `PoolRequest`, `Field`, `Form`, `FormVersion`, `Automation`, `FormResponse`, `Task`, `Project`, `Workflow`, `Resource`, `Booking`, `KbSpace`, `KbPage`, `KbVersion`, `StockItem`, `Appointment`, `Movement`, `Issue`, `CashAccount`, `CashOp`, `RepairObject`, `Work`, `CrewMember`, `Material`, `WorkLog`, `Tenant`, `Plan`, `Brand`, `PriceBook`, `PriceVersion`, `Tier`, `Term`, `SeatRequest`, `Account`, `Membership`, `Operator`, `AuditEntry`, `Platform`, `TenantDb`, `TenantView` (= `TenantDb` после `view()` + `flags`, `cash.hidden?`), `OperatorView` (`{platform, operatorOnly: true, flags}`), `View`, `Flags`, `ApiResult<T>`, `PageKey` (24 ключа `:2861` без `planned`, PD-24), `PersonaKey`, `OrgId` | 07 §10; `models.js:5–9` |
| `models/dictionaries.ts` | `TONES`, `VERBS`, `INDUSTRY`, `CORE`, `ALL_MODULES`, `isIndustry`, `REASON`, `VEHICLE_STATE`, `TRIP_STATE`, `MEMBER_STATE`, `TENANT_STATE`, `PHOTO_SIDES`, `DEP_CHECKS`, `RET_CHECKS`, `DEFECT_ZONES`, `FUEL`, `EXPENSE_CAT`, `TASK_STATUSES`, `TASK_FLOW`, `TASK_TONE`, `WORKFLOWS`, `PRIORITY` (22) + `TONE`, `LINE`, `BR_PALETTE`, `BR_TERMS`, `BR_ICONS`, `BR_LOCK` | `models.js:11–138`; `dc.html:2329–2349` |
| `models/format.ts` | `num`, `int`, `rub`, `plural`, `emailOk`, `initials`, `hm`, `tempLabel`, `fmtRatio`, `capF` | `models.js:140–143, 231, 301–304`; `:2357–2358` |
| `models/units.ts` | `unit`, `unitLabel`, `firmsOf`, `scopeCovers`, `scopeLabel` | `models.js:145–167` |
| `models/access.ts` | `moduleOn`, `grants`, `can`, `canEarnings`, `rolePermKeys` | `models.js:169–210` |
| `models/fleet.ts` | `compat`, `legs`, `inspMissing`, `odoError`, `validateExpense` | `models.js:212–279` |
| `models/calendar.ts` | `busySpan`, `bookingConflicts`, `freeSlots` | `models.js:282–300` |
| `models/tasks.ts` | `wfOf` | `models.js:137` |
| `models/brand.ts` | `hex2rgb`, `rgb2hex`, `relLum`, `contrastW`, `mixHex`, `fixAccent`, `fixAccentSteps`, `brandVars(hex?) → {accent, hover, soft, tint}`, `termOf(brand, key)` | `:2350–2356`, `:2937` |
| `models/billing.ts` | `tierList(db, v?)`, `calc(ver, tier, months) → {month,total,save,off,months} \| null`, `termLabel(m)` | `:3562–3569` |
| `models/pricebook.ts` | `validateDraft(draft) → string[]` (9 правил, тексты дословно 04 §5.5) | `:3864–3884` |
| `seed/index.ts` | `seed() → TenantDb` (t-alta с `platform`), `seedLotos(platform) → TenantDb`, `createSeed(opts?: {scenario?: ScenarioName}) → {platform, dbs: Record<OrgId, TenantDb>}` (воспроизводит `api.js:16–19`: один общий `platform`), `BRAND_DEFAULT` | `mock-data.js`, `extra-data.js` |
| `seed/defaults.ts` | `dialogDefaults(db) → {regionId, firmId, roleId}`: t-alta `{ 'r-msk', 'f-msk-sever', 'r-manager' }` (`:2373`, `:2748–2771`), иначе первый регион / первая фирма / `r-manager` если есть, иначе первая роль с `kind !== 'system'` (t-lotos → `{ 'r-msk', 'f-lotos-tver', 'r-therapist' }`) | Q-23, PD-27 |
| `seed/snapshot.ts` + `snapshot.json` | `buildSnapshot(createSeed()) → Snapshot`; файл — отсортированные ID по коллекциям для `platform`, `t-alta`, `t-lotos` + `seq` (100/500) + `counters: {"Р-208": 208, "Р-211": 211}` (карта для `core.counters`, PD-30) + `uuidNamespace: "ortus:<tenant>:<prototype-id>"` | PD-19, PD-30, 09 §7.3 |
| `scenarios/index.ts` | `SCENARIOS: readonly ['empty-review','empty-requests','empty-calendar','kb-conflict','no-trip']`, `scenario(name)(seed) → seed` (чистый оверлей, см. §6б), `assertSeedInvariants(seed)` | §4.6; 04 Q13; 06 Q11; Q-54 |
| `clock.ts` | `Clock {now(): Date}`, `systemClock`, `fixedClock(iso)`, `DEMO_NOW = '2026-10-01T10:30:00+03:00'`, `demoClock`, `hhmm(c)`, `ddmm(c)`, `ddmmyyyy(c)`, `ddmmHHMM(c)`, `plusDaysDdMm(c, n)` — все с `timeZone: 'Europe/Moscow'`, локаль `ru-RU` | §2.3 п.2; Q-61; Q-15 |
| `adapter.port.ts` | `AdapterPort` (51 метод + `kind`, `flags`), `MockAdapterPort extends AdapterPort` (+ `applyPreset(name)`, `scenario(name)`, `reset()`), `PresetName`, `ADAPTER_METHODS: readonly string[]` (51) | §4.5; 07 §4 |
| `errors/api-error.ts` | `class ApiError extends Error { code: PrototypeCode; status?: number; violations?: Violation[]; requestId?: string; vehicleId?: string; slots?: number[]; db?: View; extra?: Record<string, unknown> }` | 07 §10; §4.5 |
| `errors/codes.ts` | `PROTOTYPE_CODES` (18: `not_found, offline, subscription_restricted, module_off, module_readonly, no_permission, no_scope, driver_block, validation, conflict, incompatible, transition, role_conflict, last_owner, forbidden, seats_exhausted, quota_exceeded, upload_failed`), `CANON_CODES` (38 идентификаторов 09 §5.2 + `seats_exhausted, request_pending, tier_below_usage, upload_failed, not_implemented` PD-34; клиентские `offline`, `timeout`) | 07 §6; 09 §5.2; PD-34 |
| `errors/map.ts` | `toPrototypeCode(canon, ctx?: {op?: keyof AdapterPort}) → PrototypeCode` (всюду однозначно; `invalid_transition` + `op:'moveTask'` → `transition`); `toCanonCodes(proto) → CanonCode[]`; `CANON_TO_PROTOTYPE` таблица | 09 §5.3; Q-82 |
| `permissions/renames.ts` | `PROTOTYPE_RENAMES` (10), `PROTOTYPE_KEYS_UNMAPPED` (14, см. §10 п.6), `PROTOTYPE_KEYS_EQUAL` (20), `toCanonKeys(protoKey) → string[]`, `allPrototypeKeys()` (44 из `ALL_MODULES[*].perms` + `fleet.earnings.read/manage`) | 09 §4.4; 07 §11; Q-21 |
| `nav/personas.ts` | `PERSONA_KEYS`, `MEMBER`, `MEMBER_BY`, `midOf(org, persona)`, `DEFAULT_PAGE`, `PAGE_MOD`, `parsePersonaValue('owner@t-lotos') → {persona:'owner', org:'t-lotos'}` | `:2323–2328`; 01 §8.1 |
| `nav/nav-for-base.ts` | `navForBase(db, persona, mid) → NavGroup[]` (`{title, items:[{id, label, icon, badge?}]}`) | `:2960–3001`; 01 §9.1 |
| `nav/brand-nav.ts` | `brandNav(groups, brand?)`, `navFor(db, persona, mid)` | `:2933–2958`; 01 §9.2 |
| `nav/gate-vm.ts` | `gateVM(db, persona, mid, page) → {show:false} \| {show:true, chip:{label,tone,icon}, title, text, action: null \| {label, go:{persona:'owner', page:'modules'\|'users'}}}` | `:3051–3078`; 01 §12 |
| `nav/banners-vm.ts` | `bannersVM(db, persona, page, shell:{online:boolean, outbox:{state:'local'\|'sending'\|'error'}[]}) → Banner[]` (`{tone, role, icon, title, text, action: null \| {label, go?:{persona,page}, setPage?: PageKey}}`) | `:3080–3093`; 01 §11 |

Подписи меню, тексты гейтов/баннеров и `REASON.*` остаются литералами в домене (порт 1:1); WS-08 (`@ortus/texts`) не дублирует их, а реэкспортирует из `@ortus/domain` там, где нужен единый словарь (согласовать в отчёте).

### 4.2 `AdapterPort` — 51 метод

Все команды → `Promise<ApiResult<T>>` = `Promise<{data: T; db: View}>`; ошибки — `throw ApiError`; сигнатуры и коды — 07 §4. `tenantIds()` и `defaultBranding()` не включаются (Q-88). Семантика guards/`view()`/задержек — не здесь, а в WS-06 (07 §3, §5, §12).

| # | Группа | Метод | `data` | Коды ошибок (07 §4) |
|---|---|---|---|---|
| — | свойства | `readonly kind: 'mock' \| 'http'`; `readonly flags: Flags` | — | — |
| 1 | служебные | `setActor(memberId: string \| null, tenantId?: OrgId): void` | — | — |
| 2 | служебные | `load(ms?: number): Promise<View>` | `View` | — (без сети и ошибок) |
| 3 | служебные | `setFlag(k: 'online' \| 'conflictNext' \| 'failUploadNext', v: boolean): void` | — | — |
| 4 | платформа | `extendTrial(tenantId, days)` | `void` | — |
| 5 | платформа | `setTenantQuota(tenantId, gb)` | `void` | — |
| 6 | платформа | `setTenantStatus(tenantId, status: Tenant['status'])` | `void` | — |
| 7 | платформа | `decideSeatRequest(id, approve, note)` | `void` | `conflict`, `validation` |
| 8 | платформа | `publishPriceBook({tiers, terms, from, note})` | `number` (v) | `validation` ×6, `conflict` |
| 9 | платформа | `cancelScheduledPriceBook()` | `void` | `conflict` |
| 10 | платформа | `setAccountLock(id, locked, reason)` | `void` | `validation` |
| 11 | платформа | `resetMfa(id)` | `void` | — |
| 12 | платформа | `inviteOperator({name, email, role})` | `void` | `validation` ×3, `conflict` ×2 |
| 13 | платформа | `setOperatorRole(id, role)` | `void` | `conflict` ×2, `validation` |
| 14 | платформа | `setOperatorStatus(id, active)` | `void` | `conflict` ×2 |
| 15 | организация | `saveBranding(b: BrandInput)` | `number` (v) | `validation` ×4 |
| 16 | организация | `setModule(key: IndustryKey, enabled)` | `void` | — |
| 17 | организация | `setStorageQuota(gb)` | `void` | `subscription_restricted` |
| 18 | люди | `invite({name, email, roleId?, scope?})` | `string` (`'m-'+seq`) | `validation` ×2, `conflict`, `seats_exhausted` |
| 19 | люди | `revokeInvite(memberId)` | `void` | `conflict` |
| 20 | люди | `requestSeats({tierId, term, comment})` | `string` (`'SR-'+…`) | `conflict`, `validation` ×2 |
| 21 | люди | `cancelSeatRequest(id)` | `void` | `conflict` |
| 22 | люди | `assign({memberId, roleId, scope, until?})` | `void` | `validation` ×2, `role_conflict` ×2 |
| 23 | люди | `unassign(assignmentId)` | `void` | `last_owner` |
| 24 | люди | `createRole({name, mode, sourceId?})` | `string` (`'r-'+seq`) | `validation` |
| 25 | люди | `saveRole(role: Role)` | `void` | `forbidden`, `validation`, `role_conflict` ×2 |
| 26 | логистика | `reserve(tripId, vehicleId)` | `void` | `not_found`, `subscription_restricted`, `module_off`, `no_permission`/`no_scope`, `conflict` (+`vehicleId`), `incompatible` |
| 27 | логистика | `cancelReservation(tripId)` | `void` | `not_found` |
| 28 | логистика | `assignVehicle(tripId, vehicleId)` | `void` | `subscription_restricted`, `no_permission`/`no_scope`, `conflict`, `incompatible` |
| 29 | логистика | `submitDeparture(tripId, payload: InspectionPayload)` | `'blocked' \| 'started'` | `validation` ×2 + guards |
| 30 | логистика | `decideDefect(tripId, decision: 'allow' \| 'deny')` | `void` | `no_permission`/`no_scope` |
| 31 | логистика | `addExpense(tripId, e: ExpenseInput & {opId})` | `'duplicate' \| undefined` | `validation` + guards |
| 32 | логистика | `finishRoute(tripId)` | `void` | guards |
| 33 | логистика | `submitReturn(tripId, payload: InspectionPayload & {comment, opId})` | `'duplicate' \| undefined` | `validation` ×2 + guards |
| 34 | логистика | `reviewTrip(tripId, {decision: 'accept' \| 'rework', comment, steps?})` | `number \| undefined` | `no_permission`/`no_scope`, `conflict`, `validation` ×2 |
| 35 | логистика | `resetTrip(tripId)` | `void` | — (без сети) |
| 36 | логистика | `requestDriver({driverId, tripId, comment})` | `void` | `subscription_restricted`, `no_permission`/`no_scope`, `conflict` |
| 37 | логистика | `decideRequest(requestId, approve)` | `void` | — |
| 38 | core | `publishForm(formId, fields: Field[])` | `number` (v) | `no_permission`, `validation` ×2 |
| 39 | core | `moveTask(taskId, to)` | `void` | `no_permission`, `transition`, `validation` |
| 40 | core | `toggleTaskCheck(taskId, i)` | `void` | `no_permission` |
| 41 | core | `commentTask(taskId, text)` | `void` | `no_permission`, `validation` |
| 42 | core | `createTask({title, assignee, priority, due, project?})` | `string` (`'T-'+…`) | `no_permission`, `validation` |
| 43 | core | `moveBooking(bookingId, start: number)` | `void` | `conflict` (+`slots`) |
| 44 | core | `saveKbPage(pageId, body, baseVersion)` | `number` (v) | `no_permission`, `conflict`, `validation` |
| 45 | SPA/касса/ремонт | `completeAppointment(apId)` | `'duplicate' \| 'shortage' \| 'ok'` | `subscription_restricted`, `no_permission` |
| 46 | SPA/касса/ремонт | `resolveIssue(issueId, how: 'reserve' \| 'actual')` | `void` | — |
| 47 | SPA/касса/ремонт | `addCashOp({account, type, amount, basis, src?})` | `string` (`'K-'+…`) | `subscription_restricted`, `no_permission`, `validation` ×2 |
| 48 | SPA/касса/ремонт | `reverseCashOp(opId, reason)` | `void` | `no_permission`, `validation`, `conflict` |
| 49 | SPA/касса/ремонт | `addWorkLog({work, volume, crew, material?, materialQty?, photos})` | `string` (`'WL-'+…`) | `subscription_restricted`, `no_permission`, `validation` ×4 |
| 50 | SPA/касса/ремонт | `acceptWorkLog(logId)` | `void` | `no_permission`, `conflict` |
| 51 | файлы | `upload(file: {name: string; bytes?: number}, onProgress?: (p: number) => void): Promise<{fileId: string; state: 'ready'; name: string}>` | — | `offline` ×2, `quota_exceeded`, `upload_failed` |

### 4.3 Потребляет

- WS-01: корневой `tsconfig.base.json`, `eslint`/`prettier` конфиги, `pnpm-workspace.yaml` (пакет подхватывается по glob `packages/*`), `tools/check-icu.js` (Node 22 full-icu; `int(84370)` обязан давать U+00A0).
- `design/ortus/{models,mock-data,extra-data}.js` — только `import` в тестах паритета (чистые ESM без DOM и `Date`).

### 4.4 Если контракта ещё нет

- WS-01 не влит: работать на локальном `tsconfig.json` без `extends`; перед слиянием заменить на `extends`.
- Для WS-04 (параллельный): `brand.ts` коммитится в первых циклах (§7 шаг 8) — до этого WS-04 держит локальный стаб `brandVars` с пометкой `// TODO WS-05`. Для WS-06: не стартует до слияния (pipeline). Для WS-10/14: потребляют через `main` после барьера 0→1.
- `api/errors.yaml` (WS-03) ещё нет: `errors/map.test.ts` сверяется с локальным `CANON_CODES`; после слияния WS-03 интегратор добавляет тест «каждый код `api/errors.yaml` ∈ `CANON_CODES`» (аддитивно).

## 5. Экраны, диалоги, состояния

Экранов нет (`pages: []`, §8.1 «domain: —»). Таблица трассировки — где выходы домена видны на страницах других WS (для выбора дословных ожиданий в unit-тестах и для ревьюера):

| Единица домена | Ключ страницы / spec | Дословная подпись, которую она даёт | Строки прототипа | WS-потребитель |
|---|---|---|---|---|
| `navForBase` | `shell.spec` #8–#13, #31–#33 | «Главная», «Модули и место», «Пользователи и роли», «Подписка и места», «Оформление», «Объекты», «Салон и SPA», «Задачи», «Формы и опросы», «Календарь», «База знаний», «Данные», «Файлы», «Касса»; «Рабочее место логиста», «Ресурсный пул», «Приёмка смен»; «Сегодня», «Автомобили»; «Мой день»; «Организации», «Использование», «Заявки на тариф», «Пользователи», «Тарифная сетка» | `:2960–3001` | WS-10 |
| `gateVM` | `shell.spec` #14–#17; каждая клетка «Г-М»/«Г-П» §4.9 | «„Логистика“ не подключена организацией», «„Ремонт и стройка“ не подключён организацией», «Нет роли с доступом к модулю «Логистика»», «Нет права на приёмку смен», «Нет доступа к разделу «…»» | `:3051–3078` | WS-10, WS-20…32 |
| `bannersVM` | `shell.spec` #18–#21; `modules`, `files`, `today` | «Пробный период завершён.», «Модуль «Логистика» отключён.», «Нет связи.», «Связь восстановлена.», «Место организации заполнено.» | `:3080–3093` | WS-10 |
| `can`/`canEarnings`/`REASON` | `users.spec` «Проверка доступа» 4 пресета; `review.spec` начисления | «Модуль не подключён», «Нет права», «Нет доступа к объекту», «Запрещено функцией «Водитель»» | `models.js:77–83`, `:2365–2367` | WS-20, WS-22 |
| `rolePermKeys` | `users.spec` список ролей | «22 разрешений», «10 разрешений», «5 разрешений», «6 разрешений», «Все права» | `:3155` | WS-20 |
| `compat`/`legs` | `fleet.spec` #1–13, `cars.spec` | «Грузоподъёмность: 0,9 т, нужно от 1,1 т», «Доступность: Недоступна · Плановое ТО до 03.10», 73 %/75 % | `models.js:212–242` | WS-22, WS-23 |
| `inspMissing`/`odoError`/`validateExpense` | `today.spec` #18–40 | «Осталось: 1 фото», «Пробег не может быть меньше 84 370 км», «Сумма должна быть больше нуля», «Больше 200 000 ₽ — проверьте сумму» | `models.js:244–279` | WS-23 |
| `bookingConflicts`/`freeSlots`/`hm` | `calendar.spec` #1–9 | «Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»)…», слоты «08:00», «08:15», «08:30» | `models.js:282–301` | WS-29 |
| `calc`/`termLabel`/`tierList` | `billing.spec` #37–47, `plans.spec` #39–46, `requests.spec` | «3 120 ₽ в месяц · 37 440 ₽ за 12 мес», «Экономия 9 360 ₽ …», «помесячно» | `:3563–3569` | WS-20, WS-27, WS-28 |
| `validateDraft` | `plans.spec` | 9 текстов «Перед публикацией исправьте: · …» | `:3864–3884` | WS-28 |
| `brandVars`/`fixAccent` | `branding.spec` #51, `shell.spec` #31 | `#8A7300`, «4,6:1»; `--ox-accent` = `#7A3E79` | `:2350–2356` | WS-21, WS-10, WS-04 |
| сид | все 24 ключа, `usage.spec` #15 | «9 из 10», «46,2 из 100 ГБ», «59 из 70», «141,4 из 275 ГБ», «34 из 57», «58» аккаунтов | `mock-data.js` | все |

## 6. Тесты первыми

Vitest, `describe` по единице, имена на русском из источника (`tdd-protocol.md` §3). Каждый табличный кейс — `it.each`. До реализации тест падает на `expect`, не на импорте: файлы `src/**` создаются пустыми модулями с `export {}` в том же red-коммите только если иначе падает импорт (стаб без поведения).

### 6а. E2E-скелет

Для вида `domain` e2e-скелет не пишется (`00-master-plan.md` §8.1, строка «1 E2E-скелет»: domain → «—»); `pages: []`. **Число пунктов e2e-скелета WS-05 = 0.** Пункты чек-листов, которые проверяют выходы домена через DOM, принадлежат владельцам ключей и перечислены в §5 (трассировка); WS-05 обязан дать им данные/подписи, совпадающие с теми, что в чек-листах.

### 6б. Unit — функции и табличные кейсы (входы → ожидания из сида t-alta, 07 §8)

**`format.test.ts`**
- `num`: `1.5→'1,5'`, `12→'12'`.
- `int(84370)→'84 370'` (проверка `charCodeAt(2) === 0xA0`).
- `rub`: `4500→'4 500 ₽'`, `1600.5→'1 600,5 ₽'`, `2500→'2 500 ₽'`.
- `plural(n,'пункт','пункта','пунктов')`: 1→a, 2→b, 5→c, 11→c, 21→a, 22→b, 112→c.
- `emailOk`: `'a@b.co'` true, `' a@b.co '` true, `'a@b'` false, `'a b@c.d'` false.
- `initials`: «Дарья Зимина»→«ДЗ», «Водитель #104 · временно»→«В#».
- `hm`: 8.25→'08:15', 13.25→'13:15', 14.75→'14:45', 9→'09:00'.
- `tempLabel`: `[-18,8]→'-18…+8 °C'`, `[2,6]→'+2…+6 °C'`, `[0,4]→'0…+4 °C'`.
- `fmtRatio(4.63)→'4,6:1'`; `capF('смены')→'Смены'`; `capF('')→''`.

**`units.test.ts`**
- `unit(db,'r-msk').name→'Москва'`, `unit(db,'x')→undefined`.
- `unitLabel`: `'f-msk-sever'→'Москва / Север Логистик'`, `'r-smr'→'Самара'`, `'nope'→'—'`.
- `firmsOf(db).length→12`; `firmsOf(db,'r-smr')→['f-smr-volga','f-smr-truck','f-smr-zhig','f-smr-priv']`.
- `scopeCovers`: `({type:'region',id:'r-msk'},'f-msk-yug')→true`; `({type:'firm',id:'f-msk-sever'},'f-msk-yug')→false`; `({type:'self'},'f-msk-sever')→false`; `({type:'tenant'},'anything')→true`; `(undefined,'r-msk')→false`.
- `scopeLabel`: `undefined→'Область не выбрана'`; tenant→'Вся организация'; region r-msk→'Регион Москва'; firm f-msk-sever→'Москва / Север Логистик'; self→'Только назначенное лично'.

**`access.test.ts`**
- `moduleOn(seed,'tasks')→true`, `('logistics')→false`, `('spa')→true`.
- `grants(db,'m-owner')` → 1 грант `a1` с `roleObj.id==='r-owner'`; `grants(db,'m-kotova')→[]`; назначение на несуществующую роль отбрасывается.
- `can`: `(seed,'m-owner','logistics','view')→{ok:false,reason:'module_off'}`.
- `can`: при `logistics.enabled` → `{ok:true, via.id:'a1'}`.
- `can`: `(on,'m-vasiliev','logistics','review','f-msk-sever')→'no_permission'`.
- `can`: `(on,'m-vasiliev','logistics','view','f-msk-yug')→'no_scope'`.
- `can`: `(on,'m-vasiliev','logistics','view','f-msk-sever')→{ok:true, via.id:'a2'}`.
- `can`: `(seed,'m-sokolov','repair','create')→'module_off'`; при `repair {enabled:false, history:true}` → `'module_readonly'`.
- `can`: `(seed,'m-morozova','spa','view')→ok`; `(seed,'m-morozova','spa','view','f-msk-sever')→'no_scope'`.
- `can`: `(seed,'m-kotova','tasks','view')→'no_permission'`.
- `canEarnings`: `('m-vasiliev')→'driver_block'`; `('m-owner','f-smr-volga')→{ok:true}`; `('m-kotova')→'no_permission'`; `('nobody')→'no_permission'`.
- `canEarnings` после добавления `{member:'m-kotova', role:'r-manager', scope:{type:'firm',id:'f-msk-sever'}}`: `('m-kotova','f-msk-sever')→ok`, `('m-kotova','f-msk-yug')→'no_scope'`.
- `rolePermKeys(r-owner)→['*']`.
- `rolePermKeys(r-driver)` → ровно 10 ключей в порядке `fleet.vehicles.read, fleet.trips.read, fleet.reservations.create, fleet.inspections.create, fleet.expenses.create, forms.read, forms.responses.create, calendar.read, files.upload, knowledge.read`.
- `rolePermKeys(r-manager)` → 22 (9 logistics + `calendar.read, calendar.bookings.create, calendar.bookings.manage, tasks.read, tasks.create, tasks.manage, forms.read, forms.responses.review, data.read, data.export, files.read, knowledge.read, fleet.earnings.read`).
- `rolePermKeys(r-therapist).length→5`; `rolePermKeys(r-foreman).length→6` (02 §12 п.15).

**`fleet.test.ts`**
- `compat(v1, Р-208)→{fit:true, ok:true, reasons:[]}`; `checks[1].value==='1,5 т'`, `checks[1].need==='от 1,1 т'`.
- `compat(v3, Р-208)` → `fit:false`, `reasons` = `['Грузоподъёмность: 0,9 т, нужно от 1,1 т', 'Объём: 9 м³, нужно от 12 м³']`.
- `compat(v4, Р-208)` → `fit:true, ok:false`, `reasons` = `['Доступность: Недоступна · Плановое ТО до 03.10']`.
- `compat(v2, Р-211)` → ok; `temp.value==='-18…+8 °C'`, `temp.need==='+2…+6 °C'`.
- `compat(v1, Р-211)` → `reasons` = `['Температура: без охлаждения, нужно +2…+6 °C']`.
- `compat({...v1, state:'reserved', heldBy:'Р-208'}, Р-208)` → `checks[0].value==='Назначена на этот рейс'`, `ok:true`.
- Hyundai Porter (`v3`) и Ford Transit (`v2`, объём 11 < 12) не подходят Р-208 (`fit:false`) — §5.4 WS-05.
- `legs(Р-208, v1)` → `[{wAfter:1.1,vAfter:12,wPct:73,vPct:75},{wAfter:0.4,vAfter:4,wPct:27,vPct:25},{wAfter:0,vAfter:0,wPct:0,vPct:0}]`.
- `legs(Р-208)` → все `wPct/vPct === null`.
- `inspMissing(пустой,'dep',84370)` → `['5 фото','пробег','уровень топлива','3 пункта чек-листа']`.
- `inspMissing` 5 ready + `'84 400'` + `'h'` + `{body:true}` → `['2 пункта чек-листа']`.
- `inspMissing` odometer `'84000'` → содержит `'пробег не меньше 84 370 км'`.
- `inspMissing` 4 ready + 1 queued → нет элемента с «фото»; 4 ready → `'1 фото'` (текст «Осталось: 1 фото» собирает WS-23).
- `odoError`: `('',84370)→null`; `('abc')→'Введите число'`; `('84000')→'Пробег не может быть меньше 84 370 км'`; `('90000')→'Больше начального на 5 630 км — проверьте показания'`; `('84 500')→null`; `('87370')→null`; `('87371')→'Больше начального на 3 001 км — проверьте показания'`.
- `validateExpense`: `{amount:'',date:'2026-10-01',receipt:{state:'ready'}}→{amount:'Укажите сумму'}`.
- `validateExpense`: `{amount:'1 500,50',date:'2026-10-01',receipt:{state:'queued'}}→{}`.
- `validateExpense`: `{amount:'0',date:'',receipt:{state:'empty'}}→{amount:'Сумма должна быть больше нуля',date:'Укажите дату',receipt:'Добавьте фото чека'}`.
- `validateExpense`: `'-500'→'Сумма должна быть больше нуля'`; `'250000'→'Больше 200 000 ₽ — проверьте сумму'`; `'abc'→'Сумма должна быть числом'`; `receipt.state:'uploading'→'Дождитесь окончания загрузки чека'`.

**`calendar.test.ts`** (брони `extra-data.js:15–22`)
- `busySpan(b-a2)→[11.25,13.25]`; `(b-a1)→[10,11.25]`; `(b-br)→[13.25,14]`.
- `bookingConflicts(bookings, {...b-a1, start:11.5, end:12.5}, resources)` → 2 конфликта: `{res:'res-am', resName:'Анна Морозова · массажист', title:'SPA-ритуал · Ольга Р.'}` и `{res:'res-room2', resName:'Кабинет № 2', title:'SPA-ритуал · Ольга Р.'}`.
- `bookingConflicts(bookings, {...b-a3, start:15, end:15.75}, resources)→[]`.
- без `resources` → `resName === res`.
- `freeSlots(bookings, b-a1, 3)→[8, 8.25, 8.5]`; `freeSlots(…, 0)→[]`.

**`tasks.test.ts`**
- `wfOf(db, L-31)===WORKFLOWS.leads`; `wfOf(db, T-61)===WORKFLOWS.tasks`; задача с `project:'nope'` → `WORKFLOWS.tasks`.
- `TASK_FLOW` и `WORKFLOWS.leads.flow` дословно (07 §8.5).

**`dictionaries.test.ts`**
- Для каждого из 22 справочников `toEqual` с объектом из `design/ortus/models.js` (паритет, §6г).
- `REASON.no_scope.text==='Право есть, но объект находится вне области назначения.'`.
- `Object.keys(TRIP_STATE)` = `['planned','assigned','inspection','defect_review','on_route','returning','submitted','rework','accepted']`; `Object.keys(VEHICLE_STATE).length===5`.
- `TONE.ok.bg==='#E3EFE7'`, `LINE.ok==='#BFD9C8'`; `BR_LOCK` = `['home','modules','users','billing','branding']`; `BR_PALETTE.length===8`.

**`brand.test.ts`**
- `mixHex('#1F6B52','#000000',0.18)→'#195843'`.
- `brandVars('#1F6B52')→{accent:'#1F6B52',hover:'#195843',soft:'#E0EAE7',tint:'#EFF5F3'}`.
- `brandVars('#7A3E79')→{accent:'#7A3E79',hover:'#643363',soft:'#ECE4EC',tint:'#F6F1F6'}`.
- `brandVars('zzz')`, `brandVars(undefined)`, `brandVars('#1f6b52')` (нижний регистр валиден) → `accent==='#1F6B52'`.
- `fmtRatio(contrastW('#FFD400'))→'1,4:1'`; `fixAccent('#FFD400')→'#8A7300'`; `fixAccentSteps('#FFD400')→15`; `fmtRatio(contrastW('#8A7300'))→'4,6:1'`.
- Все 8 цветов `BR_PALETTE`: `contrastW ≥ 4.5` и `fixAccent(c)===c` (02 §12 п.13; если цвет не проходит — зафиксировать вычисленное значение: формула прототипа канон).
- `termOf(lotosBrand,'visit')→{key:'visit', label:'Визит', one:'сеанс', plural:'сеансы', few:'сеанса', many:'сеансов', where:'Расписание и записи SPA'}`; `termOf(undefined,'shift').many==='смен'`.

**`billing.test.ts`**
- `tierList(db).v===2`; `tierList(db,1).v===1`; `tierList(db,9)→undefined`.
- `calc(v2, Старт, 12)→{month:3120,total:37440,save:9360,off:20,months:12}`.
- Команда 12 → `7120/85440/21360`; Бизнес 12 → `12720/152640/38160`; Сеть 12 → `22320/267840/66960`.
- Старт 4 → `{month:3705,total:14820,save:780,off:5,months:4}`; Старт 1 → `{month:3900,total:3900,save:0,off:0,months:1}`.
- Безлимит → `null`; `months` строкой `'12'` принимается; неизвестный срок → `terms[0]`.
- `termLabel(1)→'помесячно'`; `termLabel(12)→'12 мес'`.

**`pricebook.test.ts`** (`validateDraft`, тексты `:3869–3882`)
- клон `v2` → `[]`.
- имя пусто → `'Тариф 1: укажите название'`.
- безлимит не последний → `'«Безлимит»: без лимита может быть только последний тариф'`.
- `seats:'0'` → `'«Старт»: укажите число мест, целое больше нуля'`.
- `seats:'10'` после Старт(10) → `'«Команда»: мест должно быть больше, чем в «Старт» (10)'`.
- `month:''` → `'«Старт»: укажите цену в месяц'`.
- `month:'3900'` после Старт(3900) → `'«Команда»: цена должна быть выше, чем у «Старт»'`.
- имена `'Старт'`/`'старт'` → `'Названия тарифов не должны повторяться'`.
- только безлимит → `'Нужен хотя бы один тариф с ценой'`.
- `off:'50'` → `'Скидка за месяц: от 0 до 49%'`; `off:''` для 4 мес → `'Скидка за 4 мес: от 0 до 49%'`.
- порядок ошибок — как в `:3867–3882` (по тарифам, затем имена, затем «хотя бы один», затем скидки).

**`seed/counts.test.ts`** — `createSeed()`:
- `platform.tenants` 4: `t-alta trial 100/46.2 10/9`, `t-lotos active 50/12.4 25/23`, `t-remstroy restricted 25/19.8 10/5`, `t-cargo suspended 100/63 25/22`.
- `priceBook.current===2`; `versions` 2 (v1 — 4 ступени, v2 — 5); у каждой 4 `terms` `[1,0],[4,5],[8,10],[12,20]`.
- `requests` 2 (`SR-12 pending t-lotos`, `SR-9 approved t-cargo`); `accounts` 58 (13 + 45); `operators` 6 (`op-1 me:true`); `audit` 2.
- у каждого тенанта `brand`: t-alta `short:''`, t-lotos `accent '#7A3E79', version 3, terms.visit`, t-remstroy `#9A4A1F`, t-cargo `poweredBy:false, version 2`.
- `dbs['t-alta']`: `seq 100`; `units` 15 (3 региона + 12 фирм); `modules {logistics off, spa on, repair off}`; `storage.breakdown` 4.
- `members` 10 (`m-vasiliev`, `m-gromov`, `m-akhmedov` с `function:'driver'`; `m-petrova`, `m-ilyin` `invited`; `m-gromov` `blocked`); `groups` 2; `roles` 5; `assignments` 4.
- `vehicles` 7 (`v4 unavailable`, `v7 on_route`, остальные `free`); `trips` 2 (`Р-208 driverId m-vasiliev`, `Р-211 driverId null`, оба `planned`, `earnings 4500/3800`).
- `pool.drivers` 2; `pool.requests`, `earnings`, `events` — пусты.
- `forms` 2 (`fm-insp published 3`, 3 версии; `fm-foreman draft`, `draft` 3 поля); `responses` 2; `tasks` 9 (4 `project:'fleet'` + 5 `project:'leads'`); `projects` 2.
- `calendar.resources` 8; `bookings` 6; `knowledge.spaces` 3; `pages` 4 (`kb-4 access:'owner'`).
- `spa.stock` 2 (`cream qty 12`); `appointments` 3; `movements/issues` пусты; `cash.accounts` 2; `ops` 4.
- `repair.works` 3 (`Σplan 210`, `Σfact 100`); `crew` 4 (все `account:false`); `materials` 2; `logs` 1 (`WL-11 Принят`).
- `dbs['t-lotos']`: `seq 500`; `units` 3 (`r-msk`, `f-lotos-tver`, `f-lotos-arb`); `members` 23 (`m-owner` Ирина Белова, `m-morozova` «Массажист · Тверская», `m-l1…m-l21`).
- `groups` 1 (`g-tver` — 12 участников); `roles` 3 (`r-owner`, `r-therapist`, `r-admin custom`).
- `assignments` 23 (`la1` `r-owner {tenant}`, 17 × `r-therapist {self}` — `la2` + 16 `lb*`, 5 × `r-admin {firm f-lotos-arb}` — `lb3, lb7, lb11, lb15, lb19`).
- `vehicles/trips/earnings/events/forms/responses` пусты; `pool {drivers:[], requests:[]}`; `tasks` 2 (`T-7`, `T-8`, `project:'salon'`); `projects` 1.
- `cash.accounts` `[ca-lotos]`, `ops []`; `storage.breakdown` 4 (Лотос).
- `calendar.resources` 5 (без `kind:'vehicle'`); **`calendar.bookings` 6 — `b-208` и `b-to` остаются** (утечка Q-31/PD-27, повторяется).
- `knowledge.spaces [sp-spa]`, `pages [kb-3]`; `spa` как у Альты; `repair.crew` 4 (утечка Q-31).
- `platform` у обеих `dbs` — один и тот же объект (`toBe`).

**`seed/fill-accounts.test.ts`**
- `acc-g0` → `{name:'Андрей Ершов', email:'staff3@lotos-spa.example', status:'active', mfa:true, lastLogin:'30.09 08:00', memberships:[{tenantId:'t-lotos',status:'active'}]}`.
- `acc-g1` → `{name:'Ольга Зайцева', email:'staff4@lotos-spa.example', mfa:false, lastLogin:'01.10 09:07'}`.
- распределение 21/3/21 по `t-lotos/t-remstroy/t-cargo`; у `t-cargo` даты вида `'1N.09 '`.
- `m-l1` = «Андрей Ершов» «Массажист»; `m-l4` «Администратор» → `lb3 r-admin {firm:'f-lotos-arb'}`.
- два вызова `createSeed()` дают `toEqual`-равные структуры и не делят объекты между собой (`not.toBe`).

**`seed/defaults.test.ts`**
- `dialogDefaults(alta)→{regionId:'r-msk',firmId:'f-msk-sever',roleId:'r-manager'}`.
- `dialogDefaults(lotos)→{regionId:'r-msk',firmId:'f-lotos-tver',roleId:'r-therapist'}`; все три id существуют в `db.units`/`db.roles`.

**`scenarios/*.test.ts`**
- `scenario('empty-review')`: `modules.logistics.enabled===true`; добавлено назначение `{id:'a-scn-1', member:'m-kotova', role:'r-manager', scope:{type:'firm',id:'f-msk-sever'}}`; `trips.filter(submitted|defect_review).length===0`; `navForBase(db,'manager','m-kotova')` содержит «Приёмка смен» с `badge 0`.
- `scenario('empty-requests')`: `platform.requests.filter(pending).length===0`; `SR-9` на месте; `navForBase(…,'operator',null)` → «Заявки на тариф» `badge 0`.
- `scenario('empty-calendar')`: `calendar.bookings` t-alta `[]`; `resources` 8 без изменений; t-lotos не меняется.
- `scenario('no-trip')`: `Р-208.driverId===null && driverName===null`; `b-208` остаётся; `view`-следствие проверяет WS-06.
- `scenario('kb-conflict')`: данные без изменений; `meta.kbConflict` = `{pageId:'kb-1', by:'Марина Котова'}` (реализует пресет WS-06).
- `scenario('nope')` → `TypeError` с перечнем `SCENARIOS`.
- `invariants.test.ts` (`assertSeedInvariants` для базового сида и после каждого оверлея): все ID уникальны внутри коллекции; `assignments[].member ∈ members`, `.role ∈ roles`; `bookings[].res ⊂ resources` (кроме `res-v4` в Лотосе — ожидается явно как утечка); `trips[].driverId ∈ members ∪ {null}`; `tasks[].project ∈ projects`; `requests[].tenantId ∈ tenants`; `accounts[].memberships[].tenantId ∈ tenants`; `platform` не клонируется оверлеем (`toBe`).

**`snapshot.test.ts`**
- `buildSnapshot(createSeed())` `toEqual` `JSON.parse(readFile('seed/snapshot.json'))` — свежесть; `pnpm --filter @ortus/domain snapshot` перегенерирует.
- ключи коллекций отсортированы `localeCompare('ru', {numeric:true})`.
- содержит `t-alta.members` 10 ID из 09 §7.3, `t-lotos.members` 23, `platform.accounts` 58, `platform.operators` 6, `t-alta.trips ['Р-208','Р-211']`, `counters {'Р-208':208,'Р-211':211}`, `seq {t-alta:100, t-lotos:500}`.
- `m-owner` и `m-morozova` присутствуют в обоих тенантах (намеренно, 09 §7.3).

**`clock.test.ts`**
- `fixedClock(DEMO_NOW)`: `hhmm→'10:30'`, `ddmm→'01.10'`, `ddmmyyyy→'01.10.2026'`, `ddmmHHMM→'01.10 10:30'`, `plusDaysDdMm(c,7)→'08.10'` (Q-15).
- при `process.env.TZ='UTC'` результаты те же (`Europe/Moscow` задан явно).
- `hhmm(fixedClock('2026-10-01T09:05:00+03:00'))→'09:05'` (ведущий ноль, как `toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})`).
- `systemClock.now()` — экземпляр `Date`.

**`errors/map.test.ts`**
- `PROTOTYPE_CODES.length===18`; каждый из `CANON_CODES` (38 + 5) имеет ровно один `toPrototypeCode`; каждый `PROTOTYPE_CODES` имеет ≥ 1 канон в `toCanonCodes`.
- `tenant_read_only→subscription_restricted`; `tenant_suspended→subscription_restricted`; `module_not_installed→module_off`; `module_read_only→module_readonly`.
- `forbidden_action→no_permission`; `function_blocked→driver_block`; `not_found→not_found`.
- `reservation_overlap→conflict`; `resources_unavailable→conflict`; `vehicle_incompatible→incompatible`; `revision_mismatch→conflict`.
- `separation_of_duties_conflict→role_conflict`; `last_owner_required→last_owner`.
- `validation_failed`, `odometer_decrease`, `amount_invalid`, `inspection_incomplete`, `photo_not_ready`, `tier_below_usage` → `validation`.
- `quota_exceeded→quota_exceeded`; `seats_exhausted→seats_exhausted`; `request_pending→conflict`; `upload_failed→upload_failed`.
- `invalid_transition→conflict`; `toPrototypeCode('invalid_transition',{op:'moveTask'})→'transition'`.
- `not_implemented→not_implemented` (19-й код только для http; UI показывает «Ошибка» — `run()` `:2457`); `offline`/`timeout` → `offline`.

**`permissions/renames.test.ts`**
- `allPrototypeKeys().length===44`.
- `PROTOTYPE_RENAMES` ровно 10 пар 09 §4.4: `fleet.trips.manage → ['fleet.trips.start','fleet.trips.return','fleet.routes.manage']`, `knowledge.write → ['knowledge.create','knowledge.update']`, `data.read → ['data.catalog.read','data.query']`, остальные 7 — 1→1.
- каждый из 44 ключей ∈ ровно одному из `EQUAL (20) ∪ RENAMES (10) ∪ UNMAPPED (14)`.
- `toCanonKeys('fleet.export')→['data.export']`; `toCanonKeys('fleet.vehicles.read')→['fleet.vehicles.read']`; `toCanonKeys('spa.export')→[]`.
- `rolePermKeys(r-manager).flatMap(toCanonKeys)` не содержит дубликатов.

**`nav/personas.test.ts`**
- `midOf('t-alta','manager')==='m-kotova'`; `midOf('t-lotos','manager')===undefined`; `midOf('t-lotos','owner')==='m-owner'`; `midOf('t-alta','operator')===null`.
- `DEFAULT_PAGE` = `{operator:'tenants', owner:'home', manager:'home', driver:'today', therapist:'spa', foreman:'repair'}`; `Object.keys(PAGE_MOD).length===9`.
- `parsePersonaValue('therapist@t-lotos')→{persona:'therapist',org:'t-lotos'}`; `('owner')→{persona:'owner',org:'t-alta'}`.

**`nav/nav-for-base.test.ts`** (ожидания 01 §8.3, §9.1; `db` = `view()`-подобный срез, для оператора `{platform}`)
- operator: одна группа «Платформа» → `['Организации','Использование','Заявки на тариф','Пользователи','Тарифная сетка']`; `badge` у «Заявки на тариф» = 1.
- owner (сид): группы `['Обзор','Компания','Ремонт и стройка','Отрасли','Общие модули']`; подписи в порядке «Главная»; «Модули и место», «Пользователи и роли», «Подписка и места», «Оформление»; «Объекты» (`badge 0`); «Салон и SPA» (`badge 0`); «Задачи», «Формы и опросы», «Календарь», «База знаний», «Данные», «Файлы», «Касса»; группы «Логистика» нет.
- owner при `logistics.enabled` → группа «Логистика» третьей: «Рабочее место логиста», «Ресурсный пул», «Приёмка смен» (`badge 0`).
- owner при `logistics {enabled:false, history:true}` → группа «Логистика» есть (`hasMod` по `history`).
- manager (сид): `['Обзор','Логистика']`; «Логистика» = заглушка `[{id:'fleet',label:'Рабочее место логиста',icon:'local_shipping'}]`; группы «Общие модули» нет.
- manager после `empty-review`-оверлея: «Логистика» = 3 пункта; «Общие модули» = «Задачи» (`badge 1` — `T-64`), «Формы и опросы», «Календарь», «База знаний», «Данные», «Файлы» (без «Касса»).
- при `trips` с 1 `submitted` + 1 `defect_review` → «Приёмка смен» `badge 2`.
- driver: «Работа» → «Сегодня», «Автомобили», «База знаний».
- therapist: «Работа» → «Мой день», «Календарь», «База знаний».
- foreman: «Ремонт и стройка» → «Объекты»; «Общие модули» → «Задачи», «База знаний».
- owner@t-lotos: как owner без «Логистика»; therapist@t-lotos: как therapist.
- owner с `spa.issues` 2 open → «Салон и SPA» `badge 2`; с `repair.logs` 1 «На проверке» → «Объекты» `badge 1`.
- пункты `plan:*` никогда не появляются (PD-24).

**`nav/brand-nav.test.ts`**
- `brandNav(g, undefined)` → `toBe(g)`.
- бренд Лотоса (`terms.visit`) не меняет подписи.
- `{terms:{shift:{many:'рейсов'}}}` → «Приёмка рейсов»; `{terms:{vehicle:{plural:'машины'}}}` → «Машины»; `{terms:{object:{plural:'объекты'}}}` → «Объекты».
- `items:{home:{hidden:true}, tasks:{hidden:true}}` → «Главная» остаётся (`BR_LOCK`), «Задачи» скрыта.
- `items:{tasks:{label:'  Дела ', icon:'checklist'}}` → «Дела», `icon 'checklist'`.
- `order:['files','tasks']` → «Файлы» перед «Задачи», остальные в исходном порядке после них; группа без пунктов удаляется.
- `navFor(db,'operator',null)` не применяет бренд.

**`nav/gate-vm.test.ts`** (01 §12 «Стартовые срабатывания»)
- `show:false`: operator на любой странице; `page:'home'`; owner на `modules/users/billing/branding`.
- driver `today` (сид) → `{chip:{label:'Модуль не подключён',tone:'neutral',icon:'extension_off'}, title:'«Логистика» не подключена организацией', text:'Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.', action:{label:'Демо: открыть как владелец', go:{persona:'owner',page:'modules'}}}`; driver `cars` — то же.
- owner `repair` → `title:'«Ремонт и стройка» не подключён организацией'`, `text:'Подключите модуль в разделе «Модули и место». Права сотрудникам выдаются отдельно.'`, `action.label:'Открыть «Модули и место»'`, `go:{persona:'owner',page:'modules'}`.
- foreman `repair` → `text:'Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.'`, `action.label:'Демо: открыть как владелец'`.
- manager `fleet` (сид) → `title:'«Логистика» не подключена организацией'`.
- manager `fleet` при `logistics.enabled` без роли → `{chip.label:'Нет права', chip.tone:'warn', chip.icon:'lock', title:'Нет роли с доступом к модулю «Логистика»', text:'Модуль подключён, но ни одна ваша роль не разрешает это действие. Владелец бизнеса может назначить роль и область.', action:{label:'Демо: открыть как владелец', go:{persona:'owner',page:'users'}}}`.
- manager `review` при включённом модуле → `title:'Нет права на приёмку смен'`; `text` содержит `' («Проверять»)'`; manager `pool` → проверка verb `edit`.
- manager `tasks` (сид) → `title:'Нет доступа к разделу «Задачи»'`, `text:'Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.'`, `action:null`.
- `logistics {enabled:false, history:true}` + роль есть (оверлей `empty-review` + выключение) → driver `today` → `show:false` (вместо гейта баннер № 2).
- `logistics {enabled:false, history:true}` без роли → `chip.label:'Модуль отключён'`.
- therapist `spa` при `spa.enabled=false` → ветка A (`PAGE_MOD`), `title:'«Салон и SPA» не подключён организацией'`.

**`nav/banners-vm.test.ts`** (01 §11)
- operator → `[]`; owner, сид, `{online:true,outbox:[]}` → `[]`.
- `t.status:'restricted'` → `{tone:'warn', role:'status', icon:'lock_clock', title:'Пробный период завершён.', text:'Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.', action:{label:'Демо: продлить как оператор', go:{persona:'operator',page:'tenants'}}}`; для manager — `action:null`; `suspended` — тот же баннер.
- `logistics {enabled:false,history:true}` + `page:'fleet'` → `{tone:'neutral', icon:'history', title:'Модуль «Логистика» отключён.', text:'Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.'}`; на `page:'home'` → нет.
- `online:false, outbox:[]` → `{tone:'warn', icon:'cloud_off', title:'Нет связи.', text:'Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.'}`; `outbox` из 2 → text содержит `' (ожидают отправки: 2)'`.
- `online:true, outbox:[{state:'sending'}]` → `{tone:'info', icon:'sync', title:'Связь восстановлена.', text:'Отправляем сохранённые на устройстве операции…'}`.
- `usedGb 46.2, quotaGb 25` → `{tone:'danger', role:'alert', icon:'storage', title:'Место организации заполнено.'}`; owner на `home` → `text:'Новые загрузки заблокированы, файлы не удалены. Освободите место или увеличьте лимит.'`, `action:{label:'Открыть «Модули и место»', setPage:'modules'}`; owner на `modules` → `action:null`; driver → `text:'Новые загрузки ограничены. Фото текущей смены сохраняются в пределах временного резерва.'`, `action:null`.
- порядок при всех условиях сразу: trial → модуль → связь → место.

### 6в. Компонентные

Нет (вид `domain`, §8.1). Клавиатура/axe — у потребителей.

### 6г. Контрактные / паритетные / типовые

1. **`parity/models.parity.test.ts`** — `import * as P from '../../../../../design/ortus/models.js'` и `import * as D from '../../src/models'`: для каждого из 22 справочников `expect(D.X).toEqual(P.X)`; для каждой из 28 функций прогон одного и того же набора входов и `expect(D.f(...)).toEqual(P.f(...))` (для `can`/`canEarnings` — сравнение `via.id`). Набор входов: все кейсы §6б + сгенерированные: `plural` для 0…130; `odoError` для `84370 + [−5000, 0, 1, 3000, 3001, 5630]`; `freeSlots` для каждой из 6 броней; `compat` для 7 машин × 2 рейсов; `can` для 10 участников × 12 модулей × 6 verb × `[undefined, 'f-msk-sever', 'f-msk-yug', 'f-smr-volga']` на сиде с включённой логистикой.
2. **`parity/seed.parity.test.ts`** — `expect(JSON.parse(JSON.stringify(D.seed()))).toEqual(JSON.parse(JSON.stringify(P.seed())))`; то же для `seedLotos(P.seed().platform)` vs `D.seedLotos(D.seed().platform)`; `D.BRAND_DEFAULT` = `P.BRAND_DEFAULT`. Это и есть доказательство «1:1» для сида; расхождение = дефект порта, не allowlist.
3. **`adapter.port.test.ts`** — `ADAPTER_METHODS.length===51`, без дубликатов, `toEqual` списку §4.2; `expectTypeOf<AdapterPort['reserve']>().parameters.toEqualTypeOf<[string, string]>()` и ещё ≥ 10 методов; `expectTypeOf<MockAdapterPort>().toMatchTypeOf<AdapterPort>()`; `ApiError` — `instanceof Error`, `code` типизирован `PrototypeCode`, `extra` переносится (`new ApiError('conflict','…',{vehicleId:'v1'}).vehicleId==='v1'`).
4. **`index.test.ts`** — `Object.keys(await import('../src')).sort()` `toEqual` зафиксированному списку (защита от случайного удаления; расширение — только добавлением в список).
5. **Покрытие** — `vitest --coverage` с порогом 90 % по строкам/ветвям/функциям для `src/**` (`tdd-protocol.md` §4).

## 7. Шаги реализации (TDD-циклы в порядке выполнения)

Каждый шаг: red-коммит `test(ws-05): …` (падает на `expect`) → green `feat(ws-05): …` (минимум) → refactor `refactor(ws-05): …` (стиль, без новых ветвей). Оценка — часы чистой работы агента.

| # | Единица | Красный тест | Реализовать | Рефакторить | Оценка |
|---|---|---|---|---|---|
| 0 | каркас пакета | `index.test.ts` (пустой экспорт-лист ≠ ожидаемому), `vitest --coverage` запускается | `package.json`, `tsconfig.json`, `vitest.config.ts`, пустой `src/index.ts`, `README.md` (заготовка) | — | 0,5 |
| 1 | `types.ts` + `dictionaries.ts` | `dictionaries.test.ts`, `parity` для 22 справочников | перенос `models.js:11–138` + `:2329–2349` как `as const`; типы 07 §10 | `satisfies Record<ModuleKey, …>` | 1,5 |
| 2 | `format.ts` | `format.test.ts` (U+00A0 через `charCodeAt`) | `num,int,rub,plural,emailOk,initials,hm,tempLabel,fmtRatio,capF` | — | 0,5 |
| 3 | `units.ts` | `units.test.ts` | `unit…scopeLabel` | — | 0,5 |
| 4 | `access.ts` | `access.test.ts` (11 `can`, 7 `canEarnings`, 5 `rolePermKeys`) | `moduleOn, grants, can, canEarnings, rolePermKeys` | `Grant`-тип, discriminated `CanResult` | 1 |
| 5 | `fleet.ts` | `fleet.test.ts` | `compat, legs, inspMissing, odoError, validateExpense` | — | 1 |
| 6 | `calendar.ts`, `tasks.ts` | `calendar.test.ts`, `tasks.test.ts` | `busySpan, bookingConflicts, freeSlots, wfOf` | — | 0,5 |
| 7 | паритет моделей | `parity/models.parity.test.ts` (сгенерированные входы) | исправить расхождения, если есть | — | 0,5 |
| 8 | `brand.ts` | `brand.test.ts` (`#8A7300`/15, `#195843`) | `hex2rgb…brandVars, termOf, fixAccentSteps` | — (сообщить WS-04: доступно) | 0,5 |
| 9 | `billing.ts`, `pricebook.ts` | `billing.test.ts`, `pricebook.test.ts` (9 правил) | `tierList, calc, termLabel, validateDraft` | — | 1 |
| 10 | сид | `seed/counts.test.ts`, `fill-accounts.test.ts`, `parity/seed.parity.test.ts` | `extra.ts`, `alta.ts`, `platform.ts` (`fillAccounts`, `seedBrands`), `lotos.ts` (с утечкой Q-31 1:1 и комментарием), `index.ts` (`createSeed`) | типизировать `TenantDb` без `any`; `platform` общий объект | 2 |
| 11 | `defaults.ts` | `defaults.test.ts` | `dialogDefaults` | — | 0,25 |
| 12 | snapshot | `snapshot.test.ts` (файла нет → красный) | `buildSnapshot`, `scripts/build-snapshot.ts`, `seed/snapshot.json`, скрипт `"snapshot"` в `package.json` | — | 1 |
| 13 | сценарии | `scenarios/*.test.ts`, `invariants.test.ts` | 5 оверлеев + `scenario()`; `assertSeedInvariants` (экспорт для WS-06) | — | 1 |
| 14 | `clock.ts` | `clock.test.ts` (в т. ч. при `process.env.TZ='UTC'`) | `Clock`, `fixedClock`, форматтеры с `Europe/Moscow` | — | 0,5 |
| 15 | `errors/*`, `permissions/renames.ts` | `map.test.ts`, `renames.test.ts` | коды, карта, `ApiError`, renames (44 = 20 + 10 + 14) | — | 1 |
| 16 | `adapter.port.ts` | `adapter.port.test.ts` (51 имя, `expectTypeOf`) | интерфейсы по §4.2 с JSDoc-ссылками на 07 §4 | — | 1 |
| 17 | `nav/*` | `personas`, `nav-for-base`, `brand-nav`, `gate-vm`, `banners-vm` тесты | порт `:2323–2328`, `:2933–3001`, `:3051–3093` без `this`/колбэков; `action` как данные | вынести `logItems/core` в хелперы | 2 |
| 18 | финал | `index.test.ts` (полный список), покрытие ≥ 90 % | `README.md` (карта файлов, формат snapshot, команды), отчёт `docs/plan/reports/WS-05.md`, строка `status.md` | `pnpm lint`, `pnpm typecheck` | 1 |

Итого ≈ 17–18 ч ≈ 2–3 сессии (M). Один исполнитель (§6.2); шаг 8 — раньше шага 10 (ждёт WS-04).

## 8. Проверка

Страниц нет → `verification-protocol.md` §1, §3, §4 не применяются (`00-master-plan.md` §8.1: domain — «—» для E2E, визуальной сверки и MCP); `tools/verify-pages.js` не сработает (нет `routes/**`). Проверка пакета (выполняет исполнитель, повторяет ревьюер):

```powershell
pnpm --filter @ortus/domain test -- --coverage        # все зелёные, покрытие ≥ 90 %
pnpm --filter @ortus/domain typecheck                  # tsc --noEmit
pnpm lint                                              # eslint + prettier
node tools/check-icu.js                                # U+00A0, localeCompare ru (WS-01)
pnpm --filter @ortus/domain snapshot
git status --short frontend/packages/domain/src/seed/snapshot.json   # пусто = свежий
```

Рекомендуемый (не обязательный для DoD) смоук против эталона — чтобы подписи `navForBase` совпали с DOM до WS-10:
1. `node tools/design-preview.js design 4173`.
2. Через `mcp__playwright__*` (`ToolSearch "select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_select_option"`) открыть `http://127.0.0.1:4173/Ортус%20CRM.dc.html`.
3. Для каждого из 8 значений `getByLabel('Персонаж')` (`operator, owner, manager, driver, therapist, foreman, owner@t-lotos, therapist@t-lotos`) — `browser_snapshot`, взять тексты кнопок `navigation[name="Основная навигация"]`.
4. Сверить с `navForBase(createSeed().dbs[org], persona, midOf(org, persona))`: owner — 14 подписей в порядке §6б; manager — 2; driver — 3; therapist — 3; foreman — 3; operator — 5; owner@t-lotos — 14; therapist@t-lotos — 3.
5. Выдержки положить в `docs/plan/evidence/_ws-05/nav-<persona>.txt`. Расхождение = дефект порта.

Барьер 0→1 (§6.5), относящееся к WS-05: `pnpm test` (домен ≥ 90 %), `check-icu` зелёный, ревью «фундамент FE».

## 9. Критерии готовности (DoD)

- [ ] Все тесты §6б, §6г зелёные локально; вывод `pnpm --filter @ortus/domain test -- --coverage` (последние 40 строк) в отчёте; покрытие `src/**` ≥ 90 % по строкам, ветвям, функциям.
- [ ] `parity/models.parity.test.ts` и `parity/seed.parity.test.ts` зелёные — сид и модели равны прототипу по JSON без allowlist.
- [ ] `seed/snapshot.json` свежий (скрипт не меняет файл), содержит обе организации, платформу, `seq`, `counters`, `uuidNamespace`.
- [ ] `ADAPTER_METHODS.length === 51`, список равен §4.2; `MockAdapterPort` расширяет `AdapterPort` только `applyPreset/scenario/reset`.
- [ ] 44 ключа прав классифицированы (20 + 10 + 14); 18 кодов прототипа и 43 канонических (+ `offline`/`timeout`) отображены в обе стороны.
- [ ] `navForBase`/`gateVM`/`bannersVM` — чистые функции без `this`, DOM, `Date`, колбэков; тексты дословно совпадают с `:2960–3093` (ревьюер сверяет `grep` по строкам).
- [ ] Нет `Date.now()`/`new Date()` вне `clock.ts`; нет `Math.random`; нет импортов из `design/**` в `src/**` (только в `test/parity`); нет литералов `:5173`.
- [ ] `pnpm lint`, `pnpm typecheck`, `check-icu` без ошибок; `strict`, без `any` в `src/**` (`@typescript-eslint/no-explicit-any: error`).
- [ ] Порядок коммитов `test(ws-05)` → `feat(ws-05)` → `refactor(ws-05)` по каждой единице §7; ни один `it.skip`/`it.todo` без ссылки на `decisions.md`.
- [ ] Экспорт-лист `src/index.ts` зафиксирован тестом; `README.md` содержит карту «прототип → пакет» и формат `snapshot.json`.
- [ ] Отчёт `docs/plan/reports/WS-05.md` по `orchestration.md` §5: таблица тестов red → green с хешами, прогоны дословно, раздел «Проверка MCP: не применяется (domain, §8.1)» + результат смоука §8, если делался, «Контракты, которые я изменил» (ожидается: только создание `@ortus/domain`); строка WS-05 в `status.md` → «на проверке».
- [ ] `design/**` не изменён (`git status --short design/` пуст).

## 10. Риски, расхождения прототипа с документами, открытые вопросы

| # | Вопрос / риск | Что делаем по умолчанию |
|---|---|---|
| 1 | Q-30 называет `seedLotos` (`Object.values` над массивом, брони `b-208`/`b-to` остаются) ошибкой, а Q-31/PD-27/§4.6 требуют повторить утечки «Альты» в «Лотос» как эталон снимков | Порт 1:1 **с утечкой**; тест фиксирует 6 броней и 5 ресурсов в Лотосе; комментарий `// Q-31/PD-27: утечка воспроизводится намеренно` |
| 2 | Q-23: дефолты диалогов не существуют в Лотосе — «первая фирма/роль организации»; «первая роль» буквально = `r-owner` (системная) | `dialogDefaults`: `r-manager` если есть, иначе первая `kind !== 'system'` (`r-therapist`); WS-14 может переопределить — зафиксировано в отчёте |
| 3 | 07 §16 п.2 — «25 функций»; фактически в `models.js` 28 экспортируемых функций (+ `isIndustry`, `tempLabel`, `hm`); мастер-план добавляет функции из `dc.html` | Переносятся все 28 + 10 из `dc.html`; счётчик в README |
| 4 | PD-34 говорит «36 кодов», 09 §5.2 даёт 36 строк, но 38 идентификаторов (`csrf_failed/origin_not_allowed`, `public_token_expired/nonce_used`) | `CANON_CODES` = 38 + 5; после WS-03 тест сверяется с `api/errors.yaml` (аддитивно) |
| 5 | `not_implemented` (501, PD-34) не имеет кода прототипа | 19-й код `not_implemented` только для http; UI покажет `e.message \|\| 'Ошибка'` (`:2457`); WS-51 решает текст |
| 6 | §4.2 мастер-плана — «13 ключей без соответствия», 07 §16 п.14 — «7», по 09 §4.4 и пересчёту `ALL_MODULES` — 14 (`tasks.manage, forms.responses.create, inventory.read, inventory.movements.post, cash.read, cash.operations.create, spa.appointments.read, spa.appointments.create, spa.services.manage, spa.completion.review, spa.export, spa.settings, repairs.export, repairs.settings`); `repairs.projects.manage` совпадает по имени, расходится уровнем | Число — выход теста `renames.test.ts` (44 = 20 + 10 + 14); `repairs.projects.manage` в `EQUAL` с пометкой `levelMismatch: true` |
| 7 | `gateVM`/`bannersVM` прототипа содержат `onAction` с `this.go/this.setPage` | Возвращаем `action` как данные (`go`/`setPage`); WS-10 привязывает обработчики |
| 8 | `navForBase` считает бейдж «Задачи» по имени «Марина Котова» (Q-66) | Как в прототипе (литерал); на сиде совпадает; отметить в README |
| 9 | `kb-conflict` невоспроизводим на уровне сида (нужна вторая сессия, 06 §14 Q1) | Оверлей = тождество + `meta.kbConflict`; поведение — пресет WS-06, снимок — allowlist `no-reference` (PD-26, WS-29) |
| 10 | `empty-review` как сид-оверлей добавляет назначение с id `a-scn-1`, а рецепт `logistics-ready` через адаптер даст `a100` + события | Допустимо: `recipes-vs-presets` (WS-55) сравнивает пресеты WS-06, не оверлеи; оверлей — только для `VITE_SEED_SCENARIO` при загрузке |
| 11 | Vitest может отказать импортировать `design/ortus/*.js` вне корня пакета | `vitest.config.ts`: `server.fs.allow: [resolve(__dirname, '../../../design')]`; при провале — читать файл и исполнять через `vm.SourceTextModule` (без копирования в репозиторий) |
| 12 | `toLocaleString('ru-RU')` требует full-icu | Node 22 (PD-38) — full-icu по умолчанию; `check-icu` в CI (П13) |
| 13 | `PERSONAS` (`:2326`, «Владелец бизнеса · …») не попадает в DOM; подписи `<option>` (`:32–47`) — тексты оболочки | Домен экспортирует только ключи/карты (`MEMBER_BY`, `DEFAULT_PAGE`); подписи — WS-08 `texts/shell.ts` |
| 14 | `BR_DEF` (`:2333`, без `version/updatedAt/updatedBy`) ≠ `BRAND_DEFAULT` (`mock-data.js:10`) | В домене только `BRAND_DEFAULT` (сид); `BR_DEF` — у WS-21 |
| 15 | Снапшот «34 из 57» (`usage`) зависит от `fillAccounts` (Q-98) | Генератор портируется 1:1 и доказывается паритетом; значение вычисляет WS-27 из сида, не литерал |
| 16 | Параллельный WS-04 ждёт `brand.ts` | Шаг 8 выполняется до шага 10; после коммита — сообщение интегратору |
| 17 | PD-30: UUID v5 и `core.counters` — реализует WS-52 | В `snapshot.json` только `uuidNamespace` и `counters`; генерация UUID — не здесь |
| 18 | «Проверка доступа» (`ACTIONS/OBJECTS/PRESETS`, `:2365–2367`) ссылается на id сида | Не переносится в домен (страничные константы WS-20) |

## 11. Промпт запуска

Ты — исполнитель WS-05 «domain-seed-port» волны 0 проекта «Ортус CRM». Прочитай полностью `docs/plan/ws/WS-05-domain-seed-port.md`, затем `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md`, `docs/plan/orchestration.md` и разделы «Входы» брифа (§3): `design/ortus/{models,mock-data,extra-data}.js` целиком, `design/Ортус CRM.dc.html:2323–2367, 2933–3001, 3051–3093, 3562–3569, 3864–3884`, `docs/plan/analysis/07-domain-and-adapter.md` §4–§6, §8–§11, §16, `01-shell.md` §8.3, §9, §11, §12, §17.1, `02-company.md` §7.3, §12 п.13–15, §13 п.2, `09-data-permissions-errors.md` §4.4, §5.2–5.3, `04-platform.md` §5.5, `00-master-plan.md` §4.5–4.6, §8.1, §10.3. `design/` не менять и не копировать — только `import` в `test/parity`.

Создай worktree `git worktree add ..\ortus-ws05 -b ws/ws-05-domain-seed-port main`, выполни `pnpm install`. Реализуй `frontend/packages/domain` строго по §7 брифа: для каждой единицы сначала красный тест (падает на `expect`, не на импорте), коммит `test(ws-05): …`, затем минимальная реализация `feat(ws-05): …`, затем `refactor(ws-05): …`. Все ожидания — из таблиц §6б/§6г брифа дословно (U+00A0 в суммах, тексты гейтов/баннеров/ошибок без правок). Паритетные тесты против `design/ortus/*.js` обязательны и должны быть зелёными без исключений. Шаг 8 (`brand.ts`) закоммить раньше сида и сообщи об этом в отчёте (его ждёт WS-04). Не трогай файлы вне `frontend/packages/domain/**`, своей строки `docs/plan/status.md` и `docs/plan/reports/WS-05.md`. Коммиты — `git commit -F <файл без BOM>`; PowerShell 5.1 — без `&&`.

Перед завершением выполни §8 брифа (тесты с покрытием ≥ 90 %, typecheck, lint, `check-icu`, свежесть `snapshot.json`) и, если доступен Playwright MCP, смоук `navForBase` против эталона на 4173. Напиши `docs/plan/reports/WS-05.md` по `orchestration.md` §5: таблица red → green с хешами, последние 40 строк прогонов дословно, раздел «Проверка MCP: не применяется (domain)», оставшиеся `todo`/вопросы со ссылками на `decisions.md`, «Контракты, которые я изменил». Верни: ветку, путь отчёта, `done`, `pagesDelivered: []`, `fixmeLeft`, `contractsChanged`, `testRunsOk`. Если заблокирован (нет WS-01, не импортируется `design/`), опиши блокер в отчёте и не обходи его.
