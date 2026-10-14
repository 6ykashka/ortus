# WS-13 · Доменные компоненты `@ortus/ui`: SyncState, DataTable, CheckList, LoadBar, PhotoSlot, Stepper, ConflictNotice, ReadinessBar, DecisionQueue, ObjectHeader, RoleEditor

Волна 1 · Размер M (2–3 сессии) · Вид `ui-kit` · Зависит от WS-04 (ранний старт на стабах и типах, `00-master-plan.md` §6.4) · Блокирует WS-22, WS-23, WS-24, WS-27, WS-28, WS-29, WS-31, WS-32 (`00-master-plan.md` §6.1, строка `WS-13 →`) · Ревьюеров: 1 · Порт Storybook: `5186` (= 5173 + 13, §7.4).

Условные ссылки как в мастер-плане §0.1: «03 §10.1» = `docs/plan/analysis/03-logistics.md` §10.1; «`:3390`» = строка `design/Ортус CRM.dc.html`; «`ДС:267`» = строка `design/Дизайн-система.dc.html`; «`components.md:23`» = `design/docs/design-system/components.md`.

## 1. Цель

После WS-13 одиннадцать доменных компонентов `@ortus/ui` (`packages/ui/src/domain/`) рендерят ровно те фрагменты, что нарисованы в `Ортус CRM.dc.html` (слоты фото `:729–740`, степпер `:659–666`, alert «Конфликт брони» `:674`, чипы проверок `:469`, полосы загрузки `:497–500`, таблица «Данные» `:1970–1975`, очередь решений `:1840–1850` и `:2069–2076`, готовность `:2050–2052`/`:2085`, шапка объекта `:2041–2062`, редактор роли `:346–388`), с дословными подписями, ролями и `aria-*` прототипа, и для фрагментов витрины `Дизайн-система.dc.html` (`ДС:265–272`, `ДС:326–358`, `ДС:362–381`, `ДС:407`). Страничные WS волны 2 собирают экраны из этих компонентов, не дописывая разметку состояний. Канон при расхождении витрины и CRM — рендер CRM (PD-28).

## 2. Границы файлов

**Создаёт/меняет (только внутри `frontend/packages/ui/src/domain/**`):**

| Путь | Что |
|---|---|
| `src/domain/<Component>/<Component>.tsx` | компонент (11 папок: `SyncState`, `PhotoSlot`, `Stepper`, `ConflictNotice`, `CheckList`, `LoadBar`, `DataTable`, `DecisionQueue`, `ReadinessBar`, `ObjectHeader`, `RoleEditor`) |
| `src/domain/<Component>/<Component>.vm.ts` | чистые функции состояния (§6б), без React |
| `src/domain/<Component>/<Component>.test.tsx`, `*.vm.test.ts` | Vitest + Testing Library + `vitest-axe` |
| `src/domain/<Component>/<Component>.stories.tsx` | Storybook: одна история на состояние (§5) |
| `src/domain/tokens.prototype.css` | алиасы хексов CRM вне палитры (`--ox-proto-*`), каждый с комментарием `/* CRM:NNNN */` (11 §3.4) |
| `src/domain/index.ts` | заменяет экспорт стабов WS-04 на реализации; **список имён не меняется** (экспорт-лист заморожен, §4.4) |
| `src/domain/e2e/playwright.config.ts`, `src/domain/e2e/<component>.spec.ts`, `src/domain/e2e/visual/<component>.visual.spec.ts`, `src/domain/e2e/visual/<component>.labels.spec.ts` | e2e-скелет и визуальная сверка против Storybook и эталона 4173 (§6а, §8) |
| `frontend/apps/web/e2e/visual/allowlist/ui-domain.md` | allowlist ключа `ui-domain` (PD-50, формат §4.8) |
| `docs/plan/reports/WS-13.md`, `docs/plan/evidence/ui-domain/**`, `docs/plan/status.md` (строка WS-13) | отчёт, evidence, статус |

**Запрещено трогать:** `design/**`; `packages/ui/src/{index.ts,types/**,core/**}` и `packages/ui/.storybook/**` (WS-04/WS-12); `packages/tokens/**`; `packages/ui/package.json`, корневой `package.json`, `.github/**`, `.claude/**`; чужие `apps/**`. Любое добавление пропса в `types/domain.ts`, размера кнопки в `core/Button`, скрипта в `package.json` — заявка интегратору (`orchestration.md` §7), до ответа — обходной путь из §4.3.

**Worktree и ветка (PowerShell 5.1, без `&&`):**

```powershell
git worktree add ..\ortus-ws-13 -b ws/ws-13-ui-domain main
Set-Location ..\ortus-ws-13
pnpm install            # в каждом worktree отдельно (12 §8 п.16)
pnpm e2e:install        # браузер Playwright
pnpm mcp:install        # второй браузер для @playwright/mcp (12 §8 п.4)
$env:PORT_SB = "5186"
```

Коммиты — `git commit -F <файл без BOM>` (12 §8 п.25, 12 §6 п.22), префиксы `test(ws-13): …` → `feat(ws-13): …` → `refactor(ws-13): …`. MCP: свой инстанс `--isolated --output-dir .playwright-mcp/5186` (§7.4).

## 3. Входы

| Источник | Что брать |
|---|---|
| 11 §4.6 (SyncState), §4.10 (DataTable), §4.11 (CheckList, LoadBar), §4.12 (PhotoSlot), §4.13 (Stepper), §4.16 (ConflictNotice), §4.19 (RoleEditor, ReadinessBar, DecisionQueue, ObjectHeader) | контракт `components.md:23, 27–31, 39–43` + стили витрины + использование в CRM |
| 11 §3.1–3.4, §8, §9 п.1–3, 5, 9, 12; §12 п.2, 15–20 | токены `--ox-*`, хексы вне палитры, иконки `material-symbols-rounded` (размеры 15/16/18/20/22/26/28 px), инварианты |
| `design/docs/design-system/components.md:15–44`, `tokens.css:1–52` | пропсы 1:1, переменные |
| `ДС:265–272` SyncState; `ДС:306–323` RoleEditor-эскиз; `ДС:326–358` CheckList, LoadBar, PhotoSlot; `ДС:362–381` DataTable; `ДС:407` ConflictNotice | витринные фрагменты |
| 03 §5.3 (V-checks `:469`, A2-leg `:491–505`), §5.4 (значения для сида), §8.3 (степпер `:659–666`), §8.4 (alert `:674`), §8.7 (слоты `:729–740`), §8.9–8.10 (чипы и бейджи синхронизации), §10.1 (`photoVM` `:3375–3392`), §14 #7, #9, #12, #18–#20, #23–#26, #32, #36–#37, #40 | логистика |
| `:3265–3268` (`legs`, `bar()`), `:3281–3293` (`checks`), `:3426–3430` (степпер), `design/ortus/models.js:213–242` (`compat`, `legs`) | формулы |
| 05 §5.3 п.5–7, §5.5 (`:4042–4064`, `:1840–1850`), §9.1 #3, #8, #10 | DecisionQueue (карточки «Главной») |
| 06 §11.2 (`:2040–2062`, `:4289–4291`, `:4319–4322`), §11.3 п.1–2 (`:2068–2076`, `:2079–2088`, `:4295–4306`, `:4326–4327`), §7.2 (`:1961–1978`), §13 #16–#22, #39–#43, #46, §15 п.10, п.15 | ObjectHeader, ReadinessBar, DecisionQueue (строки), DataTable |
| 04 §5.2 п.5, §5.5 п.5, §10 п.13 | таблицы `usage` 860 px / `plans` 760 px — скролл, не карточки |
| 02 §6.6–6.7 (`:346–388`, `:3163–3207`), §10 #28–#32 | RoleEditor |
| `00-master-plan.md` §4.4 (строки WS-13), §4.8, §6.4, §7.4, §8.1 (колонка `ui-kit`), §8.4 | контракт, селекторы, ранний старт, порты, матрица TDD |
| `decisions.md` PD-13, PD-21, PD-22, PD-26, PD-28 (из §10.3), PD-29, PD-50; Q-34, Q-41 | решения |
| `tdd-protocol.md`, `verification-protocol.md`, `orchestration.md` | протоколы (буквально) |

## 4. Контракты

### 4.1 Публикует (`packages/ui/src/domain/index.ts`, типы — `types/domain.ts` WS-04)

Общие правила: компоненты не импортируют `@ortus/domain`, `@ortus/adapter`, `@ortus/api-client`, `apps/*` (тест §6г); данные приходят пропсами; подписи приходят от страниц из `@ortus/texts`, компонент хранит только тексты, зашитые в самой разметке прототипа; все цвета — `var(--ox-*)` или `var(--ox-proto-*)`; `role`/`aria-*` — как в прототипе плюс невидимые добавки PD-29 с `data-a11y-extra="PD-29"`.

| Компонент | Пропсы (контракт §4.4 + уточнения) | Что зашито | Источник |
|---|---|---|---|
| `SyncState` | `state: 'local'\|'queued'\|'uploading'\|'failed'\|'confirmed'`, `progress?`, `onRetry?`, `label?` (по умолчанию — тексты `components.md:23`), `appearance: 'row'\|'chip'\|'badge'` (row = витрина, chip = расход `:3453–3454`, badge = outbox `:3450`), `retryLabel?` («Повторить») | `failed` → `role="alert"`, иначе `role="status"`; `uploading` → `role="progressbar" aria-valuenow`; иконки row `smartphone/cloud_off/cloud_upload/sync_problem/cloud_done`, chip `cloud_off/cloud_off/sync/error/cloud_done` | `ДС:267–271`; 03 §8.9–8.10 |
| `PhotoSlot` | `role` (ракурс: «Спереди»…«Одометр»), `state: 'empty'\|'uploading'\|'failed'\|'queued'\|'ready'`, `progress?`, `url?`, `demo?`, `onCapture(file\|null)`, `onRetry?` | MAP `photoVM` `:3378–3384` (рамка/иконка/статус/цвет/иконка статуса), `aria-label` = «{ракурс}: {статус}. Нажмите, чтобы снять или выбрать фото» `:3390`, скрытый `<input type="file" accept="image/*" capture="environment">` `:92`, тап при `uploading` игнорируется (03 §10.1), «Повторить» 36 px `:739`, бейдж `check` 22 px `:736`, полоса 5 px `:735`, `STRIPES` `:2359` | 03 §10.1 |
| `Stepper` | `steps: string[]`, `current: number`, `label` (`aria-label` `ol`) | `li aria-current="step"`; стили `:3429`: done `bg accent / fg #FFFFFF / check 18px`, current `bg accent-soft / fg accent / border accent / 600`, ahead `bg #FFFFFF / fg #6B7873 / border #CDD5CB`; `current ≥ steps.length` → все done | `:659–666`, `:3426–3430` |
| `ConflictNotice` | `title`, `text`, `onRefresh`, `busy?`, `refreshLabel?` («Обновить список»), `code?`, `appearance: 'crm'\|'showcase'` | `role="alert"`, `strong` заголовок, иконка `sync_problem` 22 px, единственная кнопка с `refresh` 44 px `#A13A33` (crm) / «Обновить» 36 px warn (showcase `ДС:407`) | `:674`; 11 §4.16 |
| `CheckList` | `items: {label, value, need?, ok}[]`, `appearance: 'chips'\|'list'`, `header?` (showcase: `plate`, `title`, `verdict`) | chips: текст «{label}: {value}» + « (нужно {need})» при `need && !ok` `:3287`, `check`/`close` 15 px, фон `#EEF5F0`/`#FBEAE7`; list: `ul>li` 40 px, `check_circle`/`cancel`, несоответствие `#FFFBFA` + «{label} · не соответствует» | `:469`; `ДС:330–337` |
| `LoadBar` | `volumePct`, `weightPct`, `appearance: 'crm'\|'showcase'`, `overloadText?` | crm: сетка `48px 1fr 42px`, полосы 6 px, `bar(p)` `:3266` (`>100` → `#A13A33`, `>90` → `#B7791F`, иначе accent), ширина `min(100,p)%`, текст «{p}%» tabular; showcase: `52px 1fr 44px`, 8 px, «{p} %», >100 → фон `#FBEAE7`, 600, строка `error` + `overloadText` | `:497–500`; `ДС:342–343` |
| `DataTable` | `columns: {key, label, align?, mono?, sortable?, render?}[]`, `rows`, `sort?: {col, dir: 1\|-1}`, `onSort?`, `filter?`, `onRow?`, `mobile?: 'scroll'\|'cards'` (принимается, реализован только `scroll`, Q-41), `state?: 'ready'\|'loading'\|'error'`, `emptyText`, `errorText?`, `onRetry?`, `minWidth?` (560), `appearance: 'crm'\|'showcase'` | `th[scope="col"]`; crm: кнопка сортировки с иконкой `unfold_more`/`arrow_upward`/`arrow_downward` 16 px `#6B7873` (06 §7.2 п.4), `tr` `cursor:pointer`, hover `#F7FAF8`, `td` `border-bottom #F0F2EE` tabular-nums, пусто — `div` 24 px по центру `:1975`; loading — `aria-busy` + `role="status" aria-label="Загрузка"`; error — `role="alert"` + кнопка `onRetry`; строка: `tabindex=0` + Enter (PD-29) | `:1970–1975`; `ДС:362–381` |
| `DecisionQueue` | `appearance: 'cards'\|'rows'`, `title?`, `count?` (строка из `queueCount`), `hint?`, `items: {id, tone, icon, tag, title, text, action?}[]`, `max = 8`, `emptyText?`, `onAction(item)` | cards `:1841–1848` (`border-left 4px` по `markColor` `:4043`, квадрат 40 px, пилюля 11 px/600, кнопка 40 px accent + `arrow_forward`; пусто `:1850` пунктир `#BFD9C8` + `task_alt`); rows `:2070–2076` (border-top, квадрат 36 px, тег 12 px/600 + `strong`, кнопка 40 px белая с рамкой accent; шапка `h2` + бейдж 22 px warn + hint; пусто `check_circle` + «Решений не требуется»). **Сортировку компонент не делает** — хелпер `sortByUrgency` для VM «Главной» | 05 §5.5; 06 §11.3 п.1 |
| `ReadinessBar` | `done`, `pending`, `plan`, `mode: 'header'\|'row'`, `legend?`, `title?` | header `:2050–2052`: `title` + `strong` «{donePct}» 22 px + «принято», полоса 10 px (`doneW` accent, `pendW` штриховка `#E0B457/#F7E9C6` 3/6 px), легенда «Принято {donePct}», «На приёмке {pendPct}», «Для заказчика — по закрытым актам»; row `:2085`: полоса 6 px, штриховка 3/6 px. Формулы §6б | `:4289–4290`, `:4320`, `:4327` |
| `ObjectHeader` | `icon` (`apartment`), `chips: {label, tone, icon}[]`, `title`, `meta`, `progress: {done, pending, plan}`, `actions: {id, label, icon, variant}[]`, `onAction(id)`, `tabs: {id, label, badge?}[]`, `tab`, `onTab(id)` | карточка `:2042–2058` (квадрат 52 px accent-soft, чипы через `Status`, `h1` 26 px, подстрока 13 px, блок готовности `max-width 340px` = `ReadinessBar mode="header"`), `div[role="tablist"][aria-label="Разделы объекта"]` `:2059–2060` (46 px, `border-bottom 2px`, бейдж 18 px `#FAF1DC/#7A5214` 11 px/600, `overflow-x:auto; scrollbar-width:none`); стрелки ←/→ между вкладками (PD-29, `components.md:41, 44`) | 06 §11.2 |
| `RoleEditor` | `role` (черновик), `saved`, `catalog: {modules: {key, name, icon, perms: Record<verb, string[]>, industry, enabled}[], verbs: [key, label][]}`, `holders: {name, function?}[]`, `perms: string[]` (из `rolePermKeys` страницы), `open: Record<key, boolean>`, `busy?`, `onChange(role)`, `onOpen(key)`, `onSave`, `onRevert` | вся разметка `:346–388` и правила `:3163–3207`: `isSystem` (`kind === 'system'`) — поле disabled + блок `shield_person`; `isDriver` — блок `badge`; строки модулей (иконка `#8A968F`/accent, note «Модуль не подключён организацией — включение недоступно» / «{k} из {M} действий» / «Нет доступа»), кнопка `aria-label` «Показать действия: {name}»/«Свернуть действия: {name}» 36×36, `button[role="switch"][aria-label="Доступ роли к модулю {name}"]` 44×26 через `Switch` core (CRM-метрика), чипы-label действий 36 px с нативным чекбоксом 16 px, блок «Финансовые разрешения» (`fieldset`/`legend`, чекбоксы 18 px, `code` ключей), `finNote` «Роль с функцией «Водитель» не может содержать начисления» / «Роль назначена водителю — финансовые права недоступны», подвал «Есть несохранённые изменения» / «Отменить» / «Сохранить роль» / «Сохраняем…», aside «Итоговые права роли» (`holders`, «Нет бизнес-разрешений…», `code` чипы, 4 факта `:3200–3205`). Редьюсеры §6б экспортируются | 02 §6.7 |

Хелперы (чистые, экспортируются из `domain/index.ts` только если WS-04 оставил для них имена; иначе — из `<Component>.vm.ts` и реэкспорт через интегратора): `photoSlotVM`, `stepperSteps`, `queueCount`, `sortByUrgency`, `markColor`, `checkText`, `legBarColor`, `readiness`, `sortIcon`, `syncVisual`, `toggleModule`, `toggleVerb`, `toggleFinance`, `isDirty`, `moduleNote`, `finNote`.

### 4.2 Потребляет

| Откуда | Что | Если ещё нет |
|---|---|---|
| `@ortus/tokens` (WS-04) | `tokens.css` (`--ox-*`), `prototype`-алиасы PD-28 (`--ox-accent-tint`, `LINE`, высоты 36/40, радиусы 14/16), `fonts.css` локальные (PD-21) | хексы, которых нет в алиасах WS-04, — в `src/domain/tokens.prototype.css` (список §10 п.3), заявка интегратору на перенос в `packages/tokens` |
| `@ortus/ui/core` (WS-12 через стабы WS-04) | `Status` (чипы `ObjectHeader`, пилл «Не подходит» showcase), `Button` (44/40/36/32 px), `Switch` 44×26, `Skeleton`, `EmptyState` | стабы `data-stub` рендерят `children` — тесты по тексту/роли зелёные; пиксельные тесты фрагментов с core-компонентами остаются `test.fixme('ждёт WS-12, §6.4')` до ребейза на влитый WS-12; если `Button` не поддерживает 36/40 px — локальный `<button>` на токенах с комментарием `// TODO(WS-12): size 40` и строкой в отчёте |
| `packages/ui/.storybook/` (WS-04) | каркас Storybook, `@storybook/addon-a11y` | — |
| `@ortus/e2e-kit` (WS-07) | `reference` (`openReference({persona, page, recipe, width})`), `collectLabels()`, `clock`, `axe` | фикстуры WS-07 влиты в волне 0 (барьер 0→1); при отсутствии рецепта — UI-шаги §8 дословно |
| `tools/design-preview.js design 4173 --offline` | эталон | поднять самому, `reuseExistingServer` |

### 4.3 Заявка интегратору (первый день, одним сообщением)

1. Аддитивные пропсы в `types/domain.ts`: `appearance` у `SyncState/ConflictNotice/CheckList/LoadBar/DataTable/DecisionQueue`; `label`/`retryLabel` у `SyncState`; `url`/`demo` у `PhotoSlot`; `title`/`text`/`busy` у `ConflictNotice`; `state`/`emptyText`/`errorText`/`onRetry`/`minWidth`/`columns[].render` у `DataTable`; `count`/`hint`/`max`/`emptyText`/`onAction` у `DecisionQueue`; `mode`/`legend`/`title` у `ReadinessBar`; `tab`/`onTab`/`onAction` у `ObjectHeader`; `saved`/`catalog.verbs`/`holders`/`perms`/`open`/`busy`/`onSave`/`onRevert`/`onOpen` у `RoleEditor`.
2. `Button` core: размеры 36 и 40 px (PD-28; 11 §4.1 «карточки модулей 40px, баннер 36px»).
3. Скрипт `e2e:ui-domain` в `packages/ui/package.json`; до него — запуск через `-c`.
4. Перенос `--ox-proto-*` в `packages/tokens` после закрытия WS-13.

До ответа реализуется CRM-вид как `default` каждого пропса; расширения типов — локальные `interface … extends` внутри `src/domain/` без правки `types/`.

## 5. Экраны, диалоги, состояния (для ui-kit — компонент → истории)

Истории: `title: 'Domain/<Component>'`, экспорт — латиницей (id Storybook), `name` — по-русски. Каждая история-`Crm*` воспроизводит обёртку CRM (белая карточка `#FFFFFF`, `border 1px #DCE2D9`, `radius 12`, padding как у источника) и принимает `args.w` (ширина обёртки, px) для фрагментной сверки §8. «Г-*»-состояния матрицы §4.9 к компонентам не относятся.

| Компонент | История (экспорт) | Состояние / подпись дословно | Строки | Потребитель | e2e |
|---|---|---|---|---|---|
| SyncState | `ShowcaseRows` | 5 строк «На устройстве · черновик», «Ждёт связи · отправим автоматически», «Загрузка 64 %», «Ошибка загрузки» + «Повторить», «Принято сервером · 14:32» | `ДС:267–271` | docs (витрина) | UD-01–02 |
| | `ChipExpense` | «Принято сервером», «На устройстве», «Отправляется», «Ошибка» | `:3453–3454` | WS-23 | UD-03 |
| | `BadgeOutbox` | «Ожидает отправки», «Отправляется…», «Ошибка отправки: Связь снова пропала» | `:3450`; 03 §8.10 | WS-23 | UD-04 |
| PhotoSlot | `CrmEmptyFive`, `CrmUploading`, `CrmFailed`, `CrmQueued`, `CrmReadyDemo`, `CrmReady` | «Не снято» / «Загрузка 64%» / «Ошибка загрузки» + «Повторить» / «На устройстве · ждёт связи» / «Загружено · демо» / «Загружено»; обёртка `fieldset` + `legend` «Фото · N из 5» + сетка `minmax(98px,1fr)` | `:728–740`, `:3378–3390` | WS-23 | UD-05–11 |
| Stepper | `Current0`, `Current1`, `Current2`, `Current5` | «Машина», «Осмотр», «Рейс», «Сдача», «Приёмка»; `aria-label` «Этапы смены» | `:659–666`, `:3427` | WS-23 | UD-12–14 |
| ConflictNotice | `CrmBooking`, `CrmBookingBusy`, `Showcase` | «Конфликт брони» + «Машину только что забронировал другой сотрудник. Список на экране устарел.» + «Обновить список»; showcase «Машину уже забронировали. Список обновлён.» + «Обновить» | `:674`; `ДС:407` | WS-23 (today), WS-22 — тост, не компонент (03 §10.4 п.3) | UD-15–17 |
| CheckList | `CrmChipsPorter`, `CrmChipsTemp`, `ShowcaseList` | чипы по 03 §5.4; список витрины «Доступность — Свободна»… «Объём · не соответствует» | `:469`, `:3287`; `ДС:330–337` | WS-22 (fleet), WS-23 (cars — чипы) | UD-18–20 |
| LoadBar | `CrmLeg`, `CrmLegOverload`, `ShowcaseTwoLegs` | «Объём» 86% / «Масса» 69%; 112% / 95%; витрина «72 %» «88 %» «94 %» «112 %» + «Перегруз по объёму на участке 2» | `:497–500`, `:3266`; `ДС:342–343` | WS-22 | UD-21–23 |
| DataTable | `ShowcaseTrips`, `CrmTrips`, `CrmTripsSorted`, `CrmEmptyFilter`, `CrmEmptyScope`, `Loading`, `Error` | колонки витрины «Рейс | Машина | Водитель | Статус | Расходы»; CRM «Рейс», «Водитель», «Статус», «Пробег, км», «Начисление»; «По фильтру ничего не найдено» / «В вашей области записей нет» | `ДС:364–371`; `:1971–1975`; 06 §7.2 | WS-29 (data), WS-27 (usage 860 px), WS-28 (plans 760 px), WS-22 («Фото до и после») | UD-24–30 |
| DecisionQueue | `CrmCardsOwner`, `CrmCardsTen`, `CrmCardsEmpty`, `CrmCardsTones`, `CrmRowsOwner`, `CrmRowsForeman`, `CrmRowsEmpty` | 4 карточки владельца 05 §5.5; «показано 8 из 10»; «Решений не требуется. Новые вопросы появятся здесь.»; строки объекта; «Мои вопросы по объекту»; «Решений не требуется» | `:1839–1850`, `:4043`, `:4100`; `:2068–2076`, `:4296–4306` | WS-24 (home), WS-31 (repair) | UD-31–38 |
| ReadinessBar | `HeaderStart`, `HeaderPending`, `HeaderAfterAccept`, `RowW1`, `RowW2Pending`, `RowDone` | «48%» / «На приёмке 5%» / «52%»; строки 60 %, 25 %, 100 % | `:2050–2052`, `:2085`, `:4289–4290`, `:4320`, `:4327` | WS-31 | UD-39–41 |
| ObjectHeader | `CrmOwner`, `CrmOwnerPending`, `CrmForeman`, `CrmLotosTerm` (listLabel из оформления — только `title` крошки, крошка вне компонента) | «ЖК Речной · квартира 42», чипы, 11/6 вкладок, «Отметить работу» / «Кабинет заказчика» | `:2041–2062`, `:4291`, `:4319–4322` | WS-31 | UD-42–46 |
| RoleEditor | `CrmManagerLogisticsOff`, `CrmManagerLogisticsOn`, `CrmDriver`, `CrmOwnerSystem`, `CrmAssignedToDriver`, `CrmEmptyRole`, `CrmBusy` | по 02 §6.7 и #29–#32 | `:346–388`, `:3163–3207` | WS-20 (users → «Роли») | UD-47–56 |

Состояния «загрузка / ошибка / пусто» есть у `DataTable` и `DecisionQueue`; «офлайн / конфликт» — у `SyncState`, `PhotoSlot` (`queued`), `ConflictNotice`; «только чтение» — `RoleEditor` (`isSystem`), `ObjectHeader` (прораб без «Кабинет заказчика»). «Нет права» компонентов не касается (гейт — WS-10).

## 6. Тесты первыми

### 6а. E2E-скелет (`src/domain/e2e/<component>.spec.ts`, все в `test.fixme`, имя теста = текст пункта; против Storybook `http://127.0.0.1:5186/iframe.html?id=<id>&viewMode=story`, проекты `sb-390` 390×844 и `sb-1440` 1440×900, `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'`)

Колбэки проверяются через `output[aria-label="Вызовы onX"]` в истории (текст = счётчик или аргумент). Цвета — `toHaveCSS` в `rgb()`.

**SyncState**
- UD-01 (11 §10 #28; `ДС:267–271`) Given `ShowcaseRows` Then по порядку: `role=status` «На устройстве · черновик»; `role=status` «Ждёт связи · отправим автоматически»; `role=status` «Загрузка 64 %» с вложенным `[role=progressbar][aria-valuenow="64"][aria-valuemin="0"][aria-valuemax="100"]`; `role=alert` «Ошибка загрузки» с `button` «Повторить»; `role=status` «Принято сервером · 14:32».
- UD-02 (`ДС:270`, `components.md:23`) When клик «Повторить» Then «Вызовы onRetry» = «1».
- UD-03 (03 §8.9; `:3453–3454`; 03 #36–37) Given `ChipExpense` Then чипы по порядку «Принято сервером» (`cloud_done`), «На устройстве» (`cloud_off`), «Отправляется» (`sync`), «Ошибка» (`error`); иконка — текст лигатуры в `.material-symbols-rounded[aria-hidden="true"]`.
- UD-04 (03 §8.10; `:3450`; 03 #40) Given `BadgeOutbox` Then бейджи «Ожидает отправки», «Отправляется…», «Ошибка отправки: Связь снова пропала», фон `rgb(250, 241, 220)`, `font-weight: 600`.

**PhotoSlot**
- UD-05 (03 #23; `:3390`) Given `CrmEmptyFive` Then 5 `button` с `aria-label` «Спереди: Не снято. Нажмите, чтобы снять или выбрать фото», «Сзади: Не снято. Нажмите, чтобы снять или выбрать фото», «Слева: …», «Справа: …», «Одометр: …»; под каждой строка «Не снято»; `legend` «Фото · 0 из 5».
- UD-06 (03 #24; `:3380`, `:735`) Given `CrmUploading` (progress 64) Then `aria-label` «Сзади: Загрузка 64%. Нажмите, чтобы снять или выбрать фото»; статус «Загрузка 64%» цветом `rgb(43, 84, 121)`; полоса `[role=progressbar][aria-valuenow="64"]` с заливкой `width: 64%`.
- UD-07 (03 #25; `:739`, `:3381`) Given `CrmFailed` Then статус «Ошибка загрузки» внутри `role=alert`, `button` «Повторить» высотой ≥ 36 px; When «Повторить» Then «Вызовы onRetry» = «1».
- UD-08 (03 #26; `:3382`) Given `CrmQueued` Then статус «На устройстве · ждёт связи», рамка кнопки `2px dashed rgb(183, 121, 31)`, `legend` «Фото · 5 из 5» (queued засчитывается, `models.js:246–248`).
- UD-09 (03 #24; `:3383`, `:736`) Given `CrmReadyDemo` Then статус «Загружено · демо», бейдж `check` 22 px в правом верхнем углу, `aria-label` «Одометр: Загружено · демо. Нажмите, чтобы снять или выбрать фото»; Given `CrmReady` Then «Загружено».
- UD-10 (`:92`; 03 §10.1 «tap игнорируется (2521)») Given `CrmEmptyFive` When клик «Спереди: …» Then событие `filechooser`, у `input` `accept="image/*"` и `capture="environment"`; Given `CrmUploading` When клик по слоту Then `filechooser` за 500 мс не возник, «Вызовы onCapture» = «0».
- UD-11 (`verification-protocol.md` §1.3) Given `CrmEmptyFive` When Tab ×5 Then фокус проходит слоты «Спереди» → «Одометр» по порядку, `Enter` открывает `filechooser`; axe 0 serious/critical.

**Stepper**
- UD-12 (03 #18; `:659–666`) Given `Current0` Then `ol[aria-label="Этапы смены"]` с 5 `li` «Машина», «Осмотр», «Рейс», «Сдача», «Приёмка»; «Машина» `aria-current="step"`, в круге «1».
- UD-13 (03 #19; `:3429`) Given `Current1` Then у «Машина» иконка `check`, `aria-current` отсутствует; «Осмотр» `aria-current="step"`, подпись `font-weight: 600` и цвет `rgb(31, 107, 82)`; «Рейс» — «3» и цвет `rgb(107, 120, 115)`.
- UD-14 (03 §8.3, индекс `accepted` = 5; `:3426`) Given `Current5` Then все пять с `check`, ни у одного нет `aria-current`.

**ConflictNotice**
- UD-15 (03 #20; `:674`) Given `CrmBooking` Then `role=alert` с `strong` «Конфликт брони» и текстом «Машину только что забронировал другой сотрудник. Список на экране устарел.»; единственная кнопка «Обновить список» с иконкой `refresh`, высота 44; When клик Then «Вызовы onRefresh» = «1».
- UD-16 (`:674` `disabled="{{ dr.conflict.busy }}"`) Given `CrmBookingBusy` Then «Обновить список» disabled.
- UD-17 (`ДС:407`) Given `Showcase` Then `role=alert` «Машину уже забронировали. Список обновлён.» с кнопкой «Обновить» высотой 36 и иконкой `sync_lock`.

**CheckList**
- UD-18 (03 #7; `:469`, `:3287`) Given `CrmChipsPorter` Then чипы «Доступность: Свободна» (`check`, фон `rgb(238, 245, 240)`), «Грузоподъёмность: 0,9 т (нужно от 1,1 т)» и «Объём: 9 м³ (нужно от 12 м³)» (`close`, фон `rgb(251, 234, 231)`, цвет `rgb(161, 58, 51)`).
- UD-19 (03 #12) Given `CrmChipsTemp` Then «Температура: -18…+8 °C» с `check`; «Температура: без охлаждения (нужно +2…+6 °C)» с `close`.
- UD-20 (`ДС:330–337`) Given `ShowcaseList` Then «Е 482 КМ 77» моно, «Рефрижератор 5 т», пилл «Не подходит» с `block`; `listitem` ×5; третий содержит «Объём · не соответствует» и «18 м³ · нужно от 22 м³», фон `rgb(255, 251, 250)`; остальные с `check_circle`.

**LoadBar**
- UD-21 (03 #9; `:497–500`, `:3267`) Given `CrmLeg` (vPct 86, wPct 69) Then подписи «Объём», «Масса», тексты «86%», «69%» с `font-variant-numeric: tabular-nums`, заливки `width: 86%` и `width: 69%` цвета `rgb(31, 107, 82)`.
- UD-22 (`:3266`) Given `CrmLegOverload` (vPct 112, wPct 95) Then заливка объёма `rgb(161, 58, 51)` и `width: 100%`, текст «112%»; масса `rgb(183, 121, 31)`, «95%».
- UD-23 (`ДС:342–345`) Given `ShowcaseTwoLegs` Then круг «2» с фоном `rgb(251, 234, 231)`; «112 %» `font-weight: 600`; строка с `error` «Перегруз по объёму на участке 2»; абзац «Сумма объёма и массы, а не 3D-укладка. Осевая нагрузка и совместимость температурных зон не проверяются.».

**DataTable**
- UD-24 (11 §10 #31; `ДС:364–371`) Given `ShowcaseTrips` Then `table` с `th[scope="col"]` «Рейс», «Машина», «Водитель», «Статус», «Расходы» (последний `text-align: right`); 3 строки; «TR-000214» и «А 123 ВС 77» моно; «4 120 ₽» содержит U+00A0.
- UD-25 (06 #16; `:1971–1973`) Given `CrmTrips` Then заголовки-кнопки «Рейс», «Водитель», «Статус», «Пробег, км», «Начисление», у каждой иконка `unfold_more`; строка «Р-208 · Северный маршрут» / «Илья Васильев» / «Запланирован» / «—» / «4 500 ₽».
- UD-26 (06 #19) When клик «Рейс» Then «Вызовы onSort» = «trip:1»; Given `CrmTripsSorted` (`sort={col:'trip',dir:1}`) Then иконка `arrow_upward`; When клик Then «Вызовы onSort» = «trip:-1».
- UD-27 (06 #18; `:1975`) Given `CrmEmptyFilter` Then «По фильтру ничего не найдено», `tbody` без `tr`; Given `CrmEmptyScope` Then «В вашей области записей нет».
- UD-28 (`components.md:27`; `ДС:401–405`; `:182–190`) Given `Loading` Then контейнер `[aria-busy="true"]` с `role=status aria-label="Загрузка"`; Given `Error` Then `role=alert` с текстом `errorText` и кнопкой «Обновить список»; When клик Then «Вызовы onRetry» = «1».
- UD-29 (06 §15 п.10; Q-41; `:1970–1971`) Given `sb-390` и `CrmTrips` Then у обёртки `overflow-x: auto`, у `table` `min-width: 560px`, `scrollWidth` обёртки > `clientWidth`; `document.scrollingElement.scrollWidth <= 390`.
- UD-30 (06 #21; `:1973`; PD-29) When клик по строке «Р-208 · Северный маршрут» Then «Вызовы onRow» = «Р-208», строка `cursor: pointer`; When фокус на строке и `Enter` Then «Вызовы onRow» = «Р-208».

**DecisionQueue**
- UD-31 (05 #3; `:1840–1848`) Given `CrmCardsOwner` Then 4 карточки в порядке «Пробный период: осталось 12 дней», «3 сотрудника без роли», «T-63 · Обновить регламент приёмки смены», «L-31 · Квартира 64 м², Химки»; у первой пилюля «Подписка» и кнопка «Модули и место» с `arrow_forward`; у третьей пилюля «На проверке», текст «Срок 03.10», кнопка «Открыть»; `border-left: 4px solid rgb(156, 198, 174)`.
- UD-32 (05 §5.3 п.5; `:1839`, `:4100`) Given `CrmCardsTen` (10 пунктов, `max` 8) Then `h2` «Требует решения», счётчик «показано 8 из 10», карточек 8; Given 4 пункта Then счётчик «4»; Given 0 Then счётчик пустой.
- UD-33 (05 #8; `:1850`) Given `CrmCardsEmpty` Then карточка `border: 1px dashed rgb(191, 217, 200)`, иконка `task_alt`, текст «Решений не требуется. Новые вопросы появятся здесь.».
- UD-34 (05 §5.5; `:4043`) Given `CrmCardsTones` Then `border-left-color` карточек danger/warn/info/neutral = `rgb(161, 58, 51)` / `rgb(183, 121, 31)` / `rgb(43, 84, 121)` / `rgb(156, 198, 174)`; When клик по кнопке карточки Then «Вызовы onAction» = id пункта.
- UD-35 (06 #41, §11.3 п.1; `:2068–2074`, `:4301`, `:4305`) Given `CrmRowsOwner` (фикстура истории: `slipText` «2 раб. дня», `forecast` «01.12», `due` «27.11») Then `h2` «Требует решения», бейдж «2», подпись «Сначала то, что держит работу»; строка 1: тег «График», `strong` «Сдача сдвигается на 2 раб. дня: прогноз 01.12», meta «По договору 27.11 · „Электрика · черновая“ — задержка подрядчика: поставка кабеля», кнопка «Открыть график»; строка 2: тег «Снабжение», «Заявки на материалы ждут закупки: 2», meta «Ламинат 33 класс, 52 м² · Плитка керамогранит 60×60, 18 м²», «Открыть снабжение».
- UD-36 (06 #40; `:4300`, `:4325`) Given `CrmRowsForeman` Then `h2` «Мои вопросы по объекту»; пункт: тег «Сегодня», «Отметка за сегодня не отправлена», meta «Объём, бригада, материалы и фото — одной формой», кнопка «Отметить работу»; When клик Then «Вызовы onAction» = «works».
- UD-37 (06 §11.6; `:2076`) Given `CrmRowsEmpty` Then строка с `check_circle` и «Решений не требуется», бейджа нет.
- UD-38 (05 #10) Given `sb-390` и `CrmCardsOwner` Then ширина кнопки «Модули и место» < ширины карточки и её `y` больше `y` текста карточки; `document.scrollingElement.scrollWidth <= 390`.

**ReadinessBar**
- UD-39 (06 #39; `:2050–2052`) Given `HeaderStart` (plan 210, done 100, pending 0) Then «Готовность по объёмам», `strong` «48%», «принято», легенда «Принято 48%», «На приёмке 0%», «Для заказчика — по закрытым актам».
- UD-40 (06 #42–#43; `:4289–4290`, `:4320`) Given `HeaderPending` (pending 10) Then «На приёмке 5%», штриховка `style.width` = «5%»; Given `HeaderAfterAccept` (done 110) Then «52%», «Принято 52%».
- UD-41 (`:2085`, `:4327`) Given `RowW1` (fact 58, plan 96) Then полоса высотой 6 px, сегмент принято `style.width` начинается с «60.41»; Given `RowW2Pending` (24/96, pending 10) Then штриховка `style.width` начинается с «10.41»; Given `RowDone` (18/18) Then сегмент «100%».

**ObjectHeader**
- UD-42 (06 #39; `:2041–2060`) Given `CrmOwner` Then `h1` «ЖК Речной · квартира 42»; чипы «Черновая отделка» (`construction`), «сдача 27.11» (`calendar_month`); подстрока «Москва, ул. Речная, 5, кв. 42 · 51 м², 2 комнаты · капитальный ремонт · договор № 42»; кнопка «Кабинет заказчика» есть, «Отметить работу» нет; `tablist[aria-label="Разделы объекта"]` с `tab` по порядку «Обзор» (`aria-selected="true"`), «Работы», «Замер», «Смета», «График», «Документы», «Снабжение», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика».
- UD-43 (06 #40) Given `CrmForeman` Then вкладки только «Обзор», «Работы», «Замер», «График», «Документы», «Снабжение»; «Отметить работу» (`add_task`) есть, «Кабинет заказчика» нет; When клик «Отметить работу» Then «Вызовы onAction» = «works».
- UD-44 (06 #42; `:2060`, `:4319`) Given `CrmOwnerPending` Then бейдж «1» у «Работы» (фон `rgb(250, 241, 220)`, высота 18 px), чипы «На приёмке: 1» (`pending`) и «сдача 01.12 вместо 27.11» (`event_busy`).
- UD-45 (06 #46; `:2059`) Given `sb-390` и `CrmOwner` Then у `tablist` `overflow-x: auto` и `scrollWidth > clientWidth`; `document.scrollingElement.scrollWidth <= 390`.
- UD-46 (`components.md:41, 44`; PD-29) When фокус на «Обзор» и `ArrowRight` Then фокус на «Работы», «Вызовы onTab» = «works»; When клик «Замер» Then «Вызовы onTab» = «measure».

**RoleEditor**
- UD-47 (02 #29; `:347–376`, `:3163–3207`) Given `CrmManagerLogisticsOff` Then `textbox` «Название роли» = «Менеджер логистики»; `switch` «Доступ роли к модулю Логистика» `aria-checked="true"` и disabled; note «Модуль не подключён организацией — включение недоступно»; чекбоксы «Просматривать», «Создавать», «Изменять», «Проверять», «Выгружать» отмечены, «Настраивать» нет; в «Финансовые разрешения» «Видеть начисления водителям» отмечен с `code` «fleet.earnings.read», «Управлять начислениями» не отмечен с `code` «fleet.earnings.manage»; aside `h3` «Итоговые права роли», `code` «fleet.trips.review», «Роль пока никому не назначена», «Начисления видны в области назначения».
- UD-48 (02 #30; `:3180`) Given `CrmManagerLogisticsOn` When клик `switch` «Доступ роли к модулю Задачи» Then «Вызовы onChange» содержит `actions.tasks` = отсутствует, в истории (controlled) `aria-checked="false"`, note «Нет доступа», «Есть несохранённые изменения», «Отменить» и «Сохранить роль» enabled; When «Отменить» Then «Вызовы onRevert» = «1», `aria-checked="true"`, обе кнопки disabled.
- UD-49 (02 #31; `:349`, `:3196`) Given `CrmDriver` Then блок «Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.»; чекбоксы финансов disabled; «Роль с функцией «Водитель» не может содержать начисления».
- UD-50 (02 #32; `:348`, `:3195`) Given `CrmOwnerSystem` Then «Название роли» disabled; блок «Системная роль: все модули и области организации. Не редактируется и защищает от потери доступа последним владельцем.»; заголовка «Модули и действия» нет; в aside `code` «*».
- UD-51 (`:3170`, `:3196`, `:3199`) Given `CrmAssignedToDriver` Then «Роль назначена водителю — финансовые права недоступны», чекбоксы финансов disabled, «Назначена: Илья Васильев».
- UD-52 (`:358`, `:3181`) Given `CrmManagerLogisticsOn`, модуль «Задачи» включён и свёрнут When клик `button[aria-label="Показать действия: Задачи"]` Then «Вызовы onOpen» = «tasks»; Given `open.tasks = true` Then `aria-expanded="true"`, `aria-label` «Свернуть действия: Задачи», видны чекбоксы «Просматривать», «Создавать», «Изменять», «Проверять»; note «5 из 6 действий» у «Логистика» (`:3177`).
- UD-53 (`:3197`) Given `CrmBusy` Then кнопка «Сохраняем…» disabled, «Отменить» disabled.
- UD-54 (`:383`, `:3203`) Given `CrmEmptyRole` Then «Нет бизнес-разрешений. Пустая роль ничего не открывает, пока вы не включите модули и действия.»; факт «Начисления скрыты» с `lock`; у всех модулей note «Нет доступа».
- UD-55 (`:3194`) When ввод в «Название роли» «Диспетчер Север» Then «Вызовы onChange» содержит `name` = «Диспетчер Север».
- UD-56 (`components.md:39`; 11 §10 #27-аналог) Given любая история RoleEditor Then «Финансовые разрешения» — `group` с доступным именем; все `switch` имеют `aria-label` «Доступ роли к модулю {name}»; axe 0 serious/critical.

**Общие**
- UD-57 (11 §12 п.18–19; PD-21; 12 §6 п.10) Given любая история Then консоль без `error`/`warning`; запросы только к `127.0.0.1:5186` (нет `fonts.googleapis.com`, `fonts.gstatic.com`, `unpkg.com`).
- UD-58 (`verification-protocol.md` §1.3) Given каждая история `Crm*` Then `@axe-core/playwright` 0 serious/critical на `sb-390` и `sb-1440`.

Итого e2e-скелет: **58 пунктов** (UD-01…UD-58), каждый — один `test.fixme`.

### 6б. Unit (Vitest, `*.vm.test.ts`, имена тестов — формулировки источника)

| Функция | Табличные кейсы (вход → ожидание) | Источник |
|---|---|---|
| `photoSlotVM(state, {progress, demo, url}, label)` | `empty` → `{border:'1.5px dashed #AEB9B2', icon:'photo_camera', status:'Не снято', stFg:'#5C6964', stIcon:'radio_button_unchecked', img:'none', aria:'Спереди: Не снято. Нажмите, чтобы снять или выбрать фото'}`; `uploading` 64 → status «Загрузка 64%», `pW:'64%'`, `isUploading`; `uploading` без progress → «Загрузка 0%»; `failed` → border `2px solid #A13A33`, `fg '#A13A33'`, `isFailed`; `queued` → `2px dashed #B7791F`, «На устройстве · ждёт связи»; `ready` demo → «Загружено · демо», `isReady`; `ready` c `url` → `img:'url("…")'`, `showIcon:false`, `labelBg:'rgba(255,255,255,.9)'`; не-`empty` без `url` → `img = STRIPES` | `:3375–3392` |
| `stepperSteps(labels, current)` | `current 0` → `[0].current='step'`, `n:'1'`, bg `var(--ox-accent-soft)`; `current 1` → `[0].done`, bg `var(--ox-accent)`, fg `#FFFFFF`; `[2]` ahead fg `#6B7873`, border `#CDD5CB`, weight `'400'`; `current 5` при 5 шагах → все `done`, ни одного `current` | `:3427–3429` |
| `queueCount(n, max=8)` | 0 → `''`; 4 → `'4'`; 8 → `'8'`; 10 → `'показано 8 из 10'` | 05 §5.3 п.5, `:4100` |
| `sortByUrgency(items)` | `[neutral, info, danger, warn, danger2]` → `[danger, danger2, warn, info, neutral]` (стабильно) | `:4063–4064` |
| `markColor(tone)` | danger `#A13A33`, warn `#B7791F`, info `#2B5479`, neutral `#9CC6AE` | `:4043` |
| `checkText(item)` | `{label:'Объём', value:'9 м³', need:'от 12 м³', ok:false}` → «Объём: 9 м³ (нужно от 12 м³)»; `ok:true` c `need` → «Объём: 16 м³»; `{label:'Доступность', value:'Свободна', ok:true}` → «Доступность: Свободна»; `okIcon` `check`/`close` | `:3287`, `models.js:216–224` |
| `legBarColor(p)`, `legWidth(p)` | 112 → `#A13A33`, 95 → `#B7791F`, 90 → accent, 75 → accent; `null` → accent, width `'0%'`; 112 → `'100%'` | `:3266–3267` |
| `readiness({done, pending, plan, mode})` | header 100/0/210 → `{donePct:'48%', pendPct:'0%', doneW:'48%', pendW:'0%'}`; header 100/10/210 → pendPct «5%», pendW «5%»; header 110/0/210 → «52%»; header 200/50/210 → donePct «95%», pendW «5%» (min(100−95, 24)); header 210/0/210 → «100%»; plan 0 → `plan=1` (`|| 1`), 0 % ; row 58/0/96 → `accW:'60.416666666666664%'`, `pct:'60%'`, `icon:'progress_activity'`, `ic:'#2B5479'`; row 24/10/96 → `penW:'10.416666666666668%'`; row 18/0/18 → `accW:'100%'`, `done`, `icon:'check_circle'`; row 0/0/96 → `icon:'radio_button_unchecked'`, `ic:'#8A968F'` | `:4289–4290`, `:4320`, `:4327` |
| `sortIcon(sort, col)` | нет сортировки → `unfold_more`; `{col, dir:1}` → `arrow_upward`; `dir:-1` → `arrow_downward`; другая колонка → `unfold_more` | 06 §7.2 п.4, §7.3 |
| `syncVisual(state, appearance)` | row: `local` `smartphone/#4C5955`, `queued` `cloud_off/#7A5214`, `uploading` `cloud_upload/#2B5479`, `failed` `sync_problem/#A13A33` + `role:'alert'`, `confirmed` `cloud_done/#1F6B52`; chip: `local`/`queued` «На устройстве» warn `cloud_off`, `uploading` «Отправляется» info `sync`, `failed` «Ошибка» danger `error`, `confirmed` «Принято сервером» ok `cloud_done`; дефолтные подписи row из `components.md:23` | `ДС:267–271`; `:3453–3454` |
| `toggleModule(role, key)` | есть `actions[key]` → удалён; нет → `['view']`; возвращает новый объект (immutable) | `:3180` |
| `toggleVerb(role, key, verb)` | добавляет/убирает; пустой массив удаляется | `:3185` |
| `toggleFinance(role, 'read')` | `finance.read` инвертируется, `manage` не трогается | `:3190` |
| `isDirty(role, saved)` | тот же объект → false; равные по JSON → false; разные → true | `:3167` |
| `moduleNote(off, k, M)` | off → «Модуль не подключён организацией — включение недоступно» (`noteFg '#7A5214'`); k=5, M=6 → «5 из 6 действий»; k=0 → «Нет доступа» | `:3177–3178` |
| `finNote(isDriver, heldByDriver)` | driver → «Роль с функцией «Водитель» не может содержать начисления»; heldByDriver → «Роль назначена водителю — финансовые права недоступны»; иначе `null`, `finBlocked=false` | `:3189`, `:3196` |
| `holdersText(names)` | `[]` → «Роль пока никому не назначена»; `['Илья Васильев']` → «Назначена: Илья Васильев» | `:3199` |
| `roleFacts(role)` | `finance.read` или `all` → `lock_open` `#7A5214` «Начисления видны в области назначения»; иначе `lock` `#5C6964` «Начисления скрыты»; 4 факта в порядке `:3201–3204` | `:3200–3205` |

### 6в. Компонентные (Testing Library + `vitest-axe`, по ролям и подписям)

- Каждый компонент: рендер каждой истории через `composeStories`; `axe` без serious/critical; снапшот дерева доступности (`role`/name) для `Crm*`.
- `PhotoSlot`: клик `empty` → `onCapture(file)` после выбора в `input[type=file]`; клик `uploading` → не вызывается; `Enter`/`Space` на кнопке; «Повторить» → `onRetry`.
- `Stepper`: ровно один `aria-current="step"` или ноль; `aria-current` отсутствует (не `"false"`) у остальных (06 §15 п.12).
- `ConflictNotice`: порядок — кнопка «Обновить список» первая и единственная; `busy` → disabled; `role=alert` на корне.
- `CheckList`: порядок чипов = порядок `items`; `list`: `listitem` ×N.
- `LoadBar`: `null` проценты → ширина 0 %, текст «0%».
- `DataTable`: `th scope=col` у каждой колонки; `onSort` только у `sortable`; `onRow` по клику и `Enter`; `state='loading'` → `aria-busy`; `rows=[]` → `emptyText`; `render` ячеек получает `row`.
- `DecisionQueue`: `max` обрезает; `onAction(item)`; `emptyText` по умолчанию зависит от `appearance`; пилюля/тег дублируют тон текстом (`components.md:43`).
- `ReadinessBar`: `legend=false` → легенды нет; проценты есть текстом при любом режиме (`components.md:42`).
- `ObjectHeader`: `h1` = `title`; `tabs` → `role=tab`, `aria-selected` у `tab`; `ArrowLeft/Right/Home/End` (PD-29); `actions` → `onAction(id)`; `badge` 0/`undefined` → бейджа нет.
- `RoleEditor`: системная роль — нет `switch`; `isDriver`/`heldByDriver` → финансовые чекбоксы disabled; `onChange` получает новый объект, `role` не мутируется; `busy` → «Сохраняем…»; `fieldset`+`legend` у «Финансовые разрешения».
- `SyncState`: `failed` → `role=alert`, иначе `status`; `uploading` → `progressbar` с `aria-valuenow`; `onRetry` только при `failed`.

### 6г. Контрактные / интеграционные (ui-kit)

- `tsc --noEmit`: пропсы компонентов совместимы с `types/domain.ts` (WS-04) — тест компиляции `src/domain/__contract__/props.test-d.ts` (`expectTypeOf`).
- `index.exports.test.ts`: `Object.keys(import('./index'))` равен снапшоту экспорт-листа WS-04 (ничего не добавлено и не убрано).
- `no-stubs.test.ts`: `grep -r 'data-stub' src/domain/` пуст после последнего зелёного цикла.
- `no-literal-colors.test.ts`: в `src/domain/**/*.tsx` нет `#[0-9A-Fa-f]{3,6}` и `rgb(`; все хексы — в `tokens.prototype.css` с комментарием `/* CRM:NNNN */` или `/* ДС:NNN */`.
- `no-forbidden-imports.test.ts`: ни один файл `src/domain/**` не импортирует `@ortus/domain`, `@ortus/adapter`, `@ortus/api-client`, `apps/`.
- `stories-coverage.test.ts`: у каждого экспорта `domain/index.ts` есть `*.stories.tsx` и ≥ 1 история `Crm*`.
- Storybook `build-storybook` без ошибок; `@storybook/addon-a11y` включён для всех историй.

## 7. Шаги реализации (TDD-циклы, порядок выполнения; оценка — часы чистой работы)

| № | Единица | Red (что падает) | Green | Refactor | Оценка |
|---|---|---|---|---|---|
| 0 | Скелет | коммит `test(ws-13): e2e-скелет и истории-заглушки`: 58 `test.fixme` (§6а), пустые истории на стабах WS-04, `src/domain/e2e/playwright.config.ts` (`sb-390`, `sb-1440`, `webServer: [storybook 5186, design-preview 4173 --offline]`, `snapshotPathTemplate` с `{platform}`), заявка интегратору §4.3 | — | — | 2 ч |
| 1 | `tokens.prototype.css` | `no-literal-colors` красный на первом компоненте | файл алиасов `--ox-proto-*` (список §10 п.3) | — | 0,5 ч |
| 2 | `SyncState` | `syncVisual` табличные; компонентные (`role`, `progressbar`); UD-01–04 | компонент 3 appearance | вынести общий `IconText` внутрь `SyncState/` | 2 ч |
| 3 | `PhotoSlot` | `photoSlotVM` табличные; `filechooser`; UD-05–11 | кнопка + скрытый `input` + статус + «Повторить» | `STRIPES` в `tokens.prototype.css` | 3 ч |
| 4 | `Stepper` | `stepperSteps`; UD-12–14 | `ol/li` | — | 1 ч |
| 5 | `ConflictNotice` | UD-15–17 | crm + showcase | кнопка через core `Button` (44) или локальная (36) | 1 ч |
| 6 | `CheckList` | `checkText`; UD-18–20 | chips + list | — | 1,5 ч |
| 7 | `LoadBar` | `legBarColor`/`legWidth`; UD-21–23 | crm + showcase | — | 1,5 ч |
| 8 | `ReadinessBar` | `readiness` (12 кейсов); UD-39–41 | header + row | штриховка как `--ox-proto-hatch` | 1,5 ч |
| 9 | `DecisionQueue` | `queueCount`, `sortByUrgency`, `markColor`; UD-31–38 | cards + rows + пустые | общий `IconSquare` (40/36) | 3 ч |
| 10 | `ObjectHeader` | UD-42–46; клавиатура tablist | карточка + `ReadinessBar` + tablist | — | 2,5 ч |
| 11 | `DataTable` | `sortIcon`; UD-24–30 | crm + showcase, состояния, скролл | `render` ячеек | 3 ч |
| 12 | `RoleEditor` | редьюсеры (7 функций); UD-47–56 | редактор + aside | разбить на `ModuleRow`, `FinanceBlock`, `Summary` внутри папки | 5 ч |
| 13 | Showcase-варианты, не закрытые выше (PhotoSlot `ДС:349–356`, RoleEditor-эскиз `ДС:306–323`) | визуальная сверка `#fleet`/`#access` фрагментов | только если остаётся время; иначе allowlist `ui-domain.md` `kind: pixel · decision: PD-16, PD-28` и строка в отчёте | — | 2 ч |
| 14 | Фрагментная визуальная сверка с CRM (§8) | `visual.spec` и `labels.spec` для 10 фрагментов на 390/1440 | подгонка отступов до ≤ 1 % | allowlist `no-reference` для `uploading`/`failed` (PD-26) | 3 ч |
| 15 | Снятие `fixme` по одному (UD-01…58), ребейз на `main` после слияния WS-12, снятие `fixme('ждёт WS-12')` | — | — | — | 2 ч |
| 16 | MCP-проходка Storybook (§8), evidence, отчёт `reports/WS-13.md`, строка `status.md` | — | — | — | 2 ч |

Правило коммитов: один цикл = `test(ws-13): …` → `feat(ws-13): …` → `refactor(ws-13): …`; в одном коммите не смешивать red/green разных единиц (`tdd-protocol.md` §1).

## 8. Проверка (аналог «проверки страницы» для ui-kit: ключ evidence `ui-domain`)

**Команды.**

```powershell
# e2e-скелет и компонентные e2e против Storybook
pnpm --filter @ortus/ui exec playwright test -c src/domain/e2e/playwright.config.ts --project=sb-390 --project=sb-1440
# визуальная и структурная сверка фрагментов с эталоном
pnpm --filter @ortus/ui exec playwright test -c src/domain/e2e/playwright.config.ts --grep "visual|labels"
# unit + компонентные
pnpm --filter @ortus/ui test
```

Эталон: `node tools/design-preview.js design 4173 --offline` (общий, `reuseExistingServer`). Storybook: `pnpm --filter @ortus/ui storybook -- --port 5186 --ci`.

**Фрагментная визуальная сверка (`visual/<component>.visual.spec.ts`).** Для каждого фрагмента: (1) `openReference({persona, page, recipe, width})` (WS-07; часы `2026-10-01T10:30:00+03:00`, панель скрыта); (2) выполнить UI-шаги из таблицы по дословным подписям; (3) `box = await fragment.boundingBox()`; (4) открыть историю `iframe.html?id=<id>&viewMode=story&args=w:<round(box.width)>`; (5) `expect(await story.screenshot()).toMatchSnapshot` против `fragment.screenshot()` с `maxDiffPixelRatio: 0.01` (PD-22); (6) `labels`: `collectLabels(fragment)` равен `collectLabels(story)` (порядок и дословность, `[data-a11y-extra]` исключаются).

| Фрагмент (история) | Эталон: персонаж · рецепт · шаги по подписям | Селектор фрагмента на эталоне | Ширины |
|---|---|---|---|
| `PhotoSlot/CrmEmptyFive` | «Водитель · Илья Васильев» · `driver-booked` («Сегодня» → «Забронировать» у «ГАЗель Next») | `fieldset:has(legend:text-is("Фото · 0 из 5"))` | 390, 1440 |
| `PhotoSlot/CrmReadyDemo` | то же → «Демо: добавить фото» → дождаться `legend` «Фото · 5 из 5» | `fieldset:has(legend:text-is("Фото · 5 из 5"))` | 390, 1440 |
| `PhotoSlot/CrmQueued` | то же + флажок «Нет связи» до «Демо: добавить фото» | тот же `fieldset` | 390 |
| `PhotoSlot/CrmUploading`, `CrmFailed` | **невоспроизводимо детерминированно** (шаг прогресса 14–22 % случайный, 03 §10.1) → allowlist `kind: no-reference · decision: PD-26` | — | — |
| `Stepper/Current0`, `Current1` | driver · `base` → «Сегодня» (planned) / `driver-booked` (inspection) | `ol[aria-label="Этапы смены"]` | 390, 1440 |
| `ConflictNotice/CrmBooking` | driver · `base` → «Сегодня» → флажок «Конфликт брони» → «Забронировать» (03 #20) | `[role="alert"]:has-text("Конфликт брони")` | 390, 1440 |
| `CheckList/CrmChipsPorter` | «Логист · Марина Котова» · `logistics-ready` → «Рабочее место логиста» | строка «Hyundai Porter» → её контейнер чипов (последний `div` строки) | 1440, 390 |
| `LoadBar/CrmLeg` | то же → «Показать загрузку» у «Mercedes Sprinter» (03 #9) | первый `li` в `ol` под `h3` «Маршрут и загрузка по участкам» → сетка «Объём»/«Масса» | 1440 |
| `DataTable/CrmTrips` | «Владелец · Дарья Зимина» · `base` → «Данные» (06 #16) | карточка с `table` (`div:has(> table)`) | 390, 1440 |
| `DecisionQueue/CrmCardsOwner` | owner · `base` → «Главная» (05 #3) | контейнер от `h2` «Требует решения» до карточки «L-31 · …» | 390, 1440 |
| `DecisionQueue/CrmRowsOwner` | owner · `repair-on` → «Объекты»; дождаться пункта «Снабжение» (06 §15 п.15); фикстура истории = значения эталона, снятые `labels-dump` при фиксации | карточка с `h2` «Требует решения» | 1440 |
| `ReadinessBar/HeaderStart` + `ObjectHeader/CrmOwner` | owner · `repair-on` → «Объекты» (06 #39); чип «сдача …» на эталоне приходит после ответа дочернего макета — ждать его, фикстура истории повторяет | карточка над `tablist` «Разделы объекта» (включая tablist) | 390, 1440 |
| `ObjectHeader/CrmForeman` | «Прораб · Алексей Соколов» · `repair-on` → «Объекты» (06 #40) | та же карточка | 1440 |
| `RoleEditor/CrmManagerLogisticsOff` | owner · `base` → «Пользователи и роли» → вкладка «Роли» (02 #28–29) | `div` редактора (`:346`) + `aside` «Итоговые права роли» (`:380`) — общий родитель `:345` | 1440, 390 |
| `RoleEditor/CrmDriver`, `CrmOwnerSystem` | то же → кнопка роли «Водитель» / «Владелец бизнеса» | тот же родитель | 1440 |
| `SyncState/ShowcaseRows` | `http://127.0.0.1:4173/Дизайн-система.dc.html#status` | карточка с `h3` «Синхронизация (SyncState)» (`ДС:265`) | 1440, 390 |
| `CheckList/ShowcaseList`, `LoadBar/ShowcaseTwoLegs` | `…/Дизайн-система.dc.html#fleet` | первая и вторая карточки сетки `ДС:328` | 1440, 390 |
| `DataTable/ShowcaseTrips`, `ConflictNotice/Showcase` | `…/Дизайн-система.dc.html#data` | карточка `ДС:362`; `[role="alert"]` `ДС:407` | 1440, 390 |

**MCP-проходка (Storybook, `mcp__playwright__*`, свой инстанс на 5186).** Для каждого из 11 компонентов:

1. `browser_navigate` → `http://127.0.0.1:5186/?path=/story/domain-<component>--<crm-story>`; `browser_snapshot` → сверить дерево с §4.1 («Что зашито»): роли, `aria-label`, порядок кнопок, тексты дословно; сохранить в `docs/plan/evidence/ui-domain/<component>/snapshot.txt`.
2. Действия по подписям: `PhotoSlot` — клик «Спереди: Не снято. …» (ожидается диалог выбора файла; закрыть), в `CrmFailed` клик «Повторить» → «Вызовы onRetry» = «1»; `ConflictNotice` — «Обновить список» → «1»; `DataTable` — «Рейс» → «trip:1», строка «Р-208 · Северный маршрут» → «Р-208»; `DecisionQueue` — «Модули и место» → id; `ObjectHeader` — «Замер» → «measure», «Отметить работу» (прораб) → «works»; `RoleEditor` — `switch` «Доступ роли к модулю Задачи» → `aria-checked="false"`, «Есть несохранённые изменения», «Отменить».
3. `browser_resize` 390×844 и 768×1024: `DataTable` и `tablist` «Разделы объекта» прокручиваются внутри, страница — нет; карточки `DecisionQueue` переносят кнопку на новую строку.
4. `browser_console_messages` — пусто; `browser_network_requests` — только `127.0.0.1:5186`.
5. `browser_take_screenshot` → `docs/plan/evidence/ui-domain/<component>/{390,768,1440}.png`; рядом `reference-<story>-{390,1440}.png` с 4173 (снимок фрагмента по таблице выше), `console.txt`, `network.txt`.
6. Открыть на эталоне тот же фрагмент глазами (персонаж, флаги, путь по меню из таблицы) и записать расхождения в отчёт, раздел «Проверка MCP».

Если MCP недоступен — WS не закрывается, блокер в отчёте (`verification-protocol.md` §4, последний абзац).

## 9. Критерии готовности (DoD)

- [ ] 58 пунктов UD-01…UD-58 без `fixme` на `sb-390` и `sb-1440`; исключения — только `fixme('ждёт WS-12, §6.4')` с перечнем в отчёте, снимаемые интегратором на барьере 1→2 после ребейза.
- [ ] Все табличные unit-тесты §6б зелёные; компонентные §6в зелёные; axe 0 serious/critical на всех историях (`tdd-protocol.md` §4, `15-quality-security.md:14`).
- [ ] §6г: экспорт-лист не изменён; `data-stub` отсутствует; нет литералов цвета в `.tsx`; нет запрещённых импортов; у каждого экспорта есть истории; `tsc` зелёный; `pnpm lint` (eslint/prettier) без ошибок.
- [ ] Фрагментная визуальная и `labels` сверка §8 в допуске 1 % (PD-22) или запись в `allowlist/ui-domain.md` с `decision: PD-26|PD-28|PD-16` и `owner: WS-13` (PD-50); `allowlist-lint` зелёный.
- [ ] Evidence `docs/plan/evidence/ui-domain/<component>/` для 11 компонентов: 3 ширины, эталонные снимки, `snapshot.txt`, `console.txt`, `network.txt`.
- [ ] Storybook собирается (`build-storybook`), в каждой истории `Crm*` обёртка воспроизводит контекст CRM и принимает `args.w`.
- [ ] `tokens.prototype.css`: каждый алиас с ссылкой на строку; список в отчёте «Контракты, которые я изменил» как заявка на перенос в `packages/tokens`.
- [ ] Порядок коммитов `test(` → `feat(` для каждой единицы (12 §6 п.21); коммиты без BOM (п.22).
- [ ] Отчёт `docs/plan/reports/WS-13.md` по `orchestration.md` §5 с дословным выводом `pnpm --filter @ortus/ui test` и обоих прогонов Playwright (последние 40 строк), разделом «Проверка MCP», списком `fixme`, списком заявок интегратору (§4.3).
- [ ] `docs/plan/status.md`: строка WS-13 → `на проверке`, ветка, отчёт, evidence.

## 10. Риски, расхождения прототипа с документами, открытые вопросы — что делаем по умолчанию

1. **Витрина ≠ CRM по метрикам** (PhotoSlot: витрина 4/3 и `2px dashed #CDD5CB` `ДС:351` против CRM 1/1 и `1.5px dashed #AEB9B2` `:3379`; LoadBar 8 px/«72 %» против 6 px/«86%»; DataTable 14 px/640 против 13 px/560; RoleEditor-эскиз против полного редактора). По умолчанию: CRM — канон и `default` appearance (PD-28); showcase-варианты только там, где они нужны для сверки секций витрины (`#status`, `#fleet`, `#data`) и дёшевы (§7 шаг 13); невыполненные — allowlist `kind: pixel · decision: PD-16, PD-28` с указанием интегратору замаскировать фрагмент в проверке витрины WS-12.
2. **Несколько внешних видов одного компонента внутри CRM** (DecisionQueue cards `:1841` / rows `:2070`; ReadinessBar 10 px `:2051` / 6 px `:2085`; CheckList chips `:469` / красный список причин водителя `:684`). По умолчанию: `appearance`/`mode` пропсы (§4.3); красный список причин `:684` и строка «Подходит рейсу: …» `:685` — разметка страницы WS-23, **не** `CheckList`; `legs` список `:492–503` (время, название, «В кузове после точки…») — разметка WS-22, `LoadBar` = только сетка полос `:497–500`.
3. **Хексы вне палитры** (11 §3.4): `#AEB9B2`, `#9FB3A9`, `#B7791F`, `#9CC6AE`, `#F7FAF8`, `#EEF5F0`, `#E0B457`, `#F7E9C6`, `#F4F6F2`, `#8A968F`, `#6B7873`, `#FFFCF4`, `#EEF1EC`, `#F0F2EE`, `#D9B76A`, `#E9EDE6`/`#E0E5DD` (STRIPES), `#C3CCC1`, `#BFD9C8`. По умолчанию: `--ox-proto-*` в `tokens.prototype.css` с комментарием строки, заявка на перенос (§4.3 п.4); если WS-04 уже добавил алиас — использовать его.
4. **Кнопки 36/40 px** не входят в шкалу `Button` (`components.md:17`), но нарисованы (`:739`, `:1847`, `:2073`, `:375–376`, `ДС:270`). По умолчанию: запрос в WS-12 через интегратора; до ответа — локальная кнопка на токенах (§4.2).
5. **`DataTable mobile="cards"`** есть в контракте (`components.md:27`), в CRM таблицы прокручиваются (06 §15 п.10, 04 §10 п.13, Q-41). По умолчанию: проп принимается, поведение — `scroll`; `cards` не реализуется, в Storybook история `ShowcaseCardRow` не создаётся.
6. **Состояние ошибки таблицы** в CRM не нарисовано; текст в компонент не зашивается — `errorText` обязателен у страницы, кнопка «Обновить список» (текст из `:674`, `:690`). Запись в отчёте «не из источников» не требуется (текста по умолчанию нет).
7. **`uploading`/`failed` PhotoSlot на эталоне невоспроизводимы детерминированно** (случайный шаг прогресса, порядок `demoAll`) — allowlist `no-reference` (PD-26); пиксели этих состояний проверяются только снапшотом Storybook per-platform (PD-32).
8. **Сортировка очереди** делается VM «Главной» (`:4063`), в объекте — порядок кода (`:4297–4306`): компонент не сортирует; `sortByUrgency` — хелпер. Источники 4–5 «Главной» читают `db.spa`/`db.repair` без проверки модуля (05 §5.5 ⚠) — ответственность WS-24, не компонента.
9. **Клавиатурные стрелки в tablist и `Enter` на строке таблицы** отсутствуют в прототипе (11 §4.17 ⚠), требуются контрактом (`components.md:41, 44`) — реализуются как невидимые добавки PD-29 (нулевой пиксельный след, `data-a11y-extra` не нужен, т.к. нет новых элементов).
10. **Дефис в «-18…+8 °C»** (03 #12, `tempLabel`) против «−18…+4 °C» (U+2212) на витрине `ДС:336` — компонент выводит строку как получил; тесты UD-19 и UD-20 держат оба варианта дословно.
11. **Границы `LINE` ≠ `tone.*.border`** (11 §11 п.1): пунктир пустой очереди `#BFD9C8` `:1850` = `LINE.ok`, не `--ox-ok-border` — брать алиас PD-28.
12. **`aria-current="step"` / `aria-pressed` строками** (06 §15 п.12): `aria-current` отсутствует у не-текущих (не `"false"`).
13. **Открытый вопрос интегратору:** добавить ли ключ `ui-domain` в `args.ws.pages` WS-13, чтобы независимый проверяющий прошёл Storybook по §8 (сейчас `pages: []`, §7.2) — предложение: да, со спецификой «spec лежит в `packages/ui/src/domain/e2e/`».
14. **Зависимость от WS-12 для пикселей** (`Status`, `Switch`, `Button`): по умолчанию — `fixme('ждёт WS-12, §6.4')` и повторный прогон после ребейза; если WS-12 вливается раньше закрытия WS-13 — ребейз немедленно, `fixme` снимаются в этом же WS.

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-13 (`ui-domain`) волны 1 проекта «Ортус CRM»: доменные компоненты `@ortus/ui` — `SyncState`, `PhotoSlot`, `Stepper`, `ConflictNotice`, `CheckList`, `LoadBar`, `DataTable`, `DecisionQueue`, `ReadinessBar`, `ObjectHeader`, `RoleEditor`. Прочитай полностью бриф `docs/plan/ws/WS-13-ui-domain.md`, затем `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md`, `docs/plan/orchestration.md`, разделы 3, 4.4, 6.4, 7.4, 8.1 мастер-плана `docs/plan/00-master-plan.md` и все входы раздела 3 брифа (отчёты анализа 11, 03, 05, 06, 02, 04 — указанные разделы, строки `design/Ортус CRM.dc.html` и `design/Дизайн-система.dc.html`). Эталон `design/` неприкосновенен; превью — `node tools/design-preview.js design 4173 --offline`.

Работай в worktree `..\ortus-ws-13` на ветке `ws/ws-13-ui-domain` от `main` (команды — раздел 2 брифа; PowerShell 5.1 без `&&`, `pnpm install` в worktree, два браузера). Пиши только в `frontend/packages/ui/src/domain/**`, `apps/web/e2e/visual/allowlist/ui-domain.md`, `docs/plan/reports/WS-13.md`, `docs/plan/evidence/ui-domain/**` и свою строку `docs/plan/status.md`. Контракт типов (`types/domain.ts`), экспорт-лист и `core/` не меняй — отправь заявку интегратору по разделу 4.3 первым сообщением и продолжай на CRM-умолчаниях.

Порядок строго по разделу 7: первый коммит — 58 `test.fixme` (раздел 6а) и истории-заглушки; далее для каждого компонента red (unit 6б + компонентные 6в + снятие своих UD) → green → refactor, коммиты `test(ws-13)` → `feat(ws-13)` → `refactor(ws-13)`, без BOM. Цвета — только `var(--ox-*)`/`var(--ox-proto-*)`; подписи, роли, `aria-label` — дословно по строкам прототипа из брифа. Канон при расхождении витрины и CRM — CRM (PD-28).

Перед закрытием выполни раздел 8: фрагментная визуальная и `labels` сверка с 4173 на 390/1440, MCP-проходка Storybook на 5186 через `mcp__playwright__*` (три ширины, консоль, сеть, снимки) с evidence в `docs/plan/evidence/ui-domain/<component>/`. Верни отчёт `docs/plan/reports/WS-13.md` по `orchestration.md` §5: таблица тестов red → green, дословный вывод прогонов, «Проверка MCP», оставшиеся `fixme` (только «ждёт WS-12» или `no-reference` по PD-26), заявки интегратору. Если заблокирован (нет стабов WS-04, нет фикстуры `reference`, MCP недоступен) — опиши блокер в отчёте, не обходи.
