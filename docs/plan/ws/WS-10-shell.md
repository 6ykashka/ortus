# WS-10 · Оболочка CRM (shell): роутер D-25, персонажи, шапка, навигация, sheet, баннеры, AccessGate, тост, ModalHost + confirm, useRun, демо-панель, гид, DemoOnly, офлайн, skeleton/loadErr

Волна **1** · Размер **L** (≈ 4–6 сессий) · Вид **shell** · Зависит от **WS-04, WS-05, WS-06, WS-07, WS-08** (все влиты в `main` на барьере 0→1, `00-master-plan.md` §6.5) · Блокирует **WS-14** (слот `ModalHost` — ранний старт по §6.4), **WS-20…WS-32** (страницы), **WS-55** (сквозные сценарии) · Ревьюеров: 1 · Ключи `pages`: `shell`, `modal-confirm`, `modal-sheet` (`00-master-plan.md` §7.2, волна 1).

Условные ссылки как в мастер-плане §0.1: «01 §9.5» = `docs/plan/analysis/01-shell.md` §9.5; «`:2829`» = строка `design/Ортус CRM.dc.html`; «`api.js:52`» = `design/ortus/api.js`.

## 1. Цель

После WS-10 приложение `frontend/apps/web` на mock-адаптере открывается по URL-схеме D-25 и для всех 8 персонажей показывает оболочку «точно как нарисовано» в `design/Ортус CRM.dc.html:28–203, 2192–2228, 2300–2321`: панель «Демо-режим» и диалог «Путь проверки», светлую/тёмную шапку с поповерами «Уведомления»/«Профиль», боковую панель 244 px / рейл 68 px / нижнюю навигацию 60 px по ширине фрейма (640/1080), лист «Все разделы», пять баннеров `bannersVM`, четыре варианта AccessGate `gateVM`, тост 4200 мс, диалог `confirm` с секциями последствий и `ack`, скелетон «Загружаем рабочее пространство…» и ошибку загрузки, офлайн-режим и оформление «Лотоса» (`applyBrand`). Все 24 страницы — заглушки `PageStub` под гейтами и баннерами; страничные WS волны 2 подключаются в слот без правок оболочки. Пять spec'ов (`shell`, `demo-panel`, `guide`, `modal-confirm`, `modal-sheet`) зелёные на `mobile-390` и `desktop-1440`, визуальная сверка оболочки 8 персонажей × 3 ширины в допуске 1 % (D-22) или в allowlist с D-ID, MCP-evidence для трёх ключей.

## 2. Границы файлов

**Создаёт/меняет (только это):**

| Путь | Что |
|---|---|
| `frontend/apps/web/index.html` | `<title>Ортус — CRM, прототип итерации 1</title>` (01 §4.1), `<div id="app">`, подключение `fonts.css` и `tokens.css` из `@ortus/tokens` |
| `frontend/apps/web/vite.config.ts` | React, TanStack Router plugin (`routesDirectory: 'src/app/routes'`, `generatedRouteTree: 'src/routeTree.gen.ts'`), `server.port = Number(process.env.PORT)`, `server.proxy['/api'] → 127.0.0.1:8080` (§4.7), режим `e2e` (`VITE_ADAPTER=mock`) |
| `frontend/apps/web/src/app/**` | `main.tsx`, `providers.tsx` (`AdapterProvider`, `QueryClientProvider` без retry, `ClockProvider`, `DemoProvider`), `adapter.ts` (переключатель `VITE_ADAPTER`), `routes.ts` (URL ↔ `pg.*`), `routes/__root.tsx`, `routes/t.$tenantId.tsx`, `routes/t.$tenantId.<page>.tsx` × 19, `routes/platform.tsx`, `routes/platform.<page>.tsx` × 5, `routes/index.tsx` (редирект), `pages.registry.ts` (glob-резолвер страниц), `testSeam.ts` (`window.__ortus`, только mock + dev/e2e) |
| `frontend/apps/web/src/shell/**` | `AppShell.tsx`, `Frame.tsx` (container queries, `useFrameWidth`), `Header/*`, `Nav/{Sidebar,BottomNav,Sheet}.tsx`, `Banners.tsx`, `Gate.tsx`, `Toast/*`, `modal/{ModalHost,Confirm,registry}.ts(x)`, `PageFrame.tsx`, `PageStub.tsx`, `Boot/{Skeleton,LoadError}.tsx`, `a11y/{SkipLink,FocusTrap}.tsx`, `hooks/{useShell,useDb,useRun,useToast,useOnline,useOutbox,useModal}.ts`, `vm/{shellVM,guideVM,modalVM,frameVars}.ts`, `shell.css` (контейнер-запросы, только токены `--ox-*`), `personas.ts` (порт `:2323–2328`, если не экспортирует WS-05) |
| `frontend/apps/web/src/demo/**` | `DemoPanel.tsx`, `Guide.tsx`, `DemoOnly.tsx`, `demoStore.ts` (порт `INITIAL()` `:2365–2379`: `persona, org, pages, prog, seen, ownerScope, frame, online, conflictNext, failUpload`), `useDemo.ts` |
| `frontend/apps/web/e2e/shell.spec.ts`, `demo-panel.spec.ts`, `guide.spec.ts`, `modal-confirm.spec.ts`, `modal-sheet.spec.ts` | e2e (первый коммит — скелет) |
| `frontend/apps/web/e2e/recipes/shell.ts` | рецепты `popover-notif`, `popover-profile`, `offline`, `sheet-open`, `confirm-disable-logistics`, `gate-*` (см. §8) |
| `frontend/apps/web/e2e/visual/shell.visual.spec.ts`, `shell.labels.spec.ts`, `modal-confirm.visual.spec.ts`, `modal-confirm.labels.spec.ts`, `modal-sheet.visual.spec.ts`, `modal-sheet.labels.spec.ts` | визуальная и структурная сверка |
| `frontend/apps/web/e2e/visual/allowlist/shell.md`, `modal-confirm.md`, `modal-sheet.md` | формат §4.8 мастер-плана (D-50) |
| `frontend/packages/texts/src/shell.ts` | только **добавление** ключей (файл создан WS-08); тексты гейта/баннеров/тостов берутся из `gate.ts`/`banners.ts`/`toast.ts` WS-08 и не дублируются (тест WS-08 «нет дубликатов значений между файлами») |
| `docs/plan/reports/WS-10.md`, `docs/plan/evidence/{shell,modal-confirm,modal-sheet}/`, строка WS-10 в `docs/plan/status.md` | отчёт, evidence, статус |

Файлы маршрутов `src/app/routes/` (TanStack file-based, D-14; имена фиксированы — страничные WS их не создают):

```text
__root.tsx                      провайдеры, DemoOnly(DemoPanel + Guide), Frame, Toast, ModalHost, SkipLink
index.tsx                       редирект / → pageToPath(persona, org, DEFAULT_PAGE[persona])
t.$tenantId.tsx                 AppShell организации: Header(light), Sidebar, BottomNav, Banners, Gate, <Outlet/>
t.$tenantId.home.tsx            t.$tenantId.modules.tsx     t.$tenantId.users.tsx       t.$tenantId.billing.tsx
t.$tenantId.branding.tsx        t.$tenantId.fleet.tsx       t.$tenantId.pool.tsx        t.$tenantId.review.tsx
t.$tenantId.today.tsx           t.$tenantId.cars.tsx        t.$tenantId.forms.tsx       t.$tenantId.tasks.tsx
t.$tenantId.calendar.tsx        t.$tenantId.knowledge.tsx   t.$tenantId.data.tsx        t.$tenantId.files.tsx
t.$tenantId.spa.tsx             t.$tenantId.cash.tsx        t.$tenantId.repair.tsx                       (19)
platform.tsx                    AppShell оператора: Header(dark), Sidebar, BottomNav, без Banners/Gate, <Outlet/>
platform.tenants.tsx            platform.usage.tsx          platform.requests.tsx
platform.accounts.tsx           platform.plans.tsx                                                        (5)
```

Каждый лист — три строки: `createFileRoute('/t/$tenantId/modules')({ component: () => <PageSlot page="modules" /> })`; `validateSearch` для search-параметров §4.7 добавляет страничный WS **в своём** `*.page.tsx` через `useSearch({strict:false})`, не в файле маршрута.

**Запрещено трогать:** `design/**`; `frontend/packages/{ui,domain,adapter,tokens,e2e-kit,api-client}/**` (контракты волны 0 — любой пробел → интегратору, не локальная правка); `frontend/packages/texts/src/*` кроме `shell.ts`; `frontend/apps/web/e2e/{fixtures,recipes/_base,visual/_helpers,smoke}/**`, `playwright.config.ts`, `.mcp.json`, `tools/**` (WS-07); `frontend/apps/web/src/routes/**` (страницы — WS-20…32; WS-10 **не** создаёт там даже заглушек — заглушки живут в `src/shell/PageStub.tsx` и подставляются резолвером); `frontend/apps/web/src/modals/**` (WS-14); `frontend/apps/docs/**` (WS-11); корень репозитория, CI, `.claude/settings.json` (WS-01); `api/**`.

**Worktree и ветка** (`orchestration.md` §1; имя ветки — как создаёт `workflow.template.js:69`):

```powershell
git worktree add ..\ortus-ws-10 -b ws/ws-10-shell main
cd ..\ortus-ws-10; pnpm install            # в каждом worktree (12 §8 п.16)
$env:PORT = 5183                           # 5173 + 10 (§7.4 мастер-плана)
pnpm dev:web -- --mode e2e                 # VITE_ADAPTER=mock, демо-сид
node tools/design-preview.js design 4173 --offline   # эталон, если не поднят
```

PowerShell 5.1: без `&&`, коммиты через `git commit -F <файл без BOM>` (12 §5 п.25). Порты проверяющих: `shell` → 6026, `modal-confirm` → 6027, `modal-sheet` → 6028 (6000 + индекс ключа в таблице §5.3 мастер-плана).

## 3. Входы

| Источник | Разделы | Для чего |
|---|---|---|
| `docs/plan/analysis/01-shell.md` | §3 инвентарь (22 позиции), §4 фрейм и брейкпоинты (`W`, `mobile/rail/showLabels`, таблица величин), §5 демо-панель (9 элементов, `setPersona`, `reset`), §6 гид (8 шагов + 7 негативных дословно, состояния кружка), §7 `boot`/`loading`/`loadErr`, §8 маршрутизация (`DEFAULT_PAGE`, `pages[persona]`, `setPage`/`go`), §9 навигация (`navForBase` по персонажам, `brandNav`, `mk`, боковая/нижняя/лист), §10 шапка (цвета оператора/прочих, 5 элементов, поповеры, таблица профилей), §11 баннеры (5 строк), §12 AccessGate (ветки A/B, стартовые срабатывания), §13 тосты и `run`, §14.1–14.2 контейнер модалки и `confirm`, §14.6–14.7, §16 офлайн/клавиатура/поповеры, §17 `applyBrand` и «Лотос», §18 данные, §19 инварианты 1–18, §20 чек-лист 38 пунктов, §21 Q1–Q13, §22 факты | карта реализации и формулировки тестов |
| `design/Ортус CRM.dc.html` | `:10–26` CSS, `:28–92` панель/гид/фрейм, `:94–146` шапка, `:148–203` nav/main/баннеры/скелетон/ошибка/гейт, `:2192–2201` нижняя навигация, `:2203–2228` контейнер модалки и `confirm`, `:2300–2311` лист, `:2313–2321` тост, `:2323–2379` константы и `INITIAL`, `:2381–2490` `boot/reset/toast/run/mark/setPersona/go/setPage/setOnline/onKey`, `:2669–2747` экземпляры `confirm`, `:2826–2865` `renderVals`, `:2895–2931` `toastVM/guideVM`, `:2933–3093` `navFor/brandNav/applyBrand/navForBase/shellVM/gateVM/bannersVM`, `:3955–3968` `modalVM(confirm)`, `:4029` sheet | дословные тексты, стили, порядок |
| `docs/plan/analysis/04-platform.md` | §4.3 шапка оператора (таблица), §4.4 навигация оператора (5 пунктов, бейдж pending), §4.5 брейкпоинты, §4.6 состояния оболочки (скелетон, ошибка, офлайн, тост), §4.7 `opConfirm` | тёмная оболочка оператора, вариант confirm «Последствия» |
| `docs/plan/analysis/11-design-system-and-docs-site.md` | §4.18 AppShell/Nav/ScopeSelect (skip-link «К содержимому», landmarks, метрики nav) | контракт `AppShell` и невидимые добавки D-29 |
| `docs/plan/analysis/08-requirements.md` | §10 Q4 (названия меню — как в прототипе, Q-40), Q5 (поиск в шапке отсутствует), Q6 (URL-состояние таблиц отсутствует, Q-39) | что НЕ рисовать |
| `docs/plan/analysis/12-prior-project-and-skills.md` | §5 п.18 «один DOM на все пороги, переключение раскладки — CSS, не JS» | container queries вместо условного рендера |
| `docs/plan/00-master-plan.md` | §4.7 (URL ↔ `pg.*`, редирект `/`, `?persona=`), §4.9 (матрица старта: клетки Г-М/Г-П), §4.8 (селекторы, `data-screen-label`, `data-a11y-extra`, allowlist, evidence), §2.3 рецепт снимка (D-45), §2.4 рецепты, §6.4 ранний старт WS-14, §7.3–7.4, §8.1–8.2, §10.3 D-25, D-26, D-27, D-28, D-29, D-37, D-39, D-44, D-45, D-50 | контракты и правила проверки |
| `docs/plan/decisions.md` | D-14 (Vite + TanStack), D-21 (шрифты локально), D-22 (1 %), D-24 (`planned` не реализуется); Q-35 (`pages`/`seen` по персонажу — как в прототипе), Q-36 (подписи `<select>` — как в шаблоне), Q-37 (оператор «в Лотосе» — как в прототипе), Q-38 (`navigator.onLine` и флажок — один `setOnline`), Q-39, Q-40, Q-43 (`data-screen-label`), Q-44 (демо-кнопки переносятся) | поведение по умолчанию |
| Протоколы | `tdd-protocol.md` §1–§5, `verification-protocol.md` §1–§7, `orchestration.md` §1–§7 | обязательны буквально |

## 4. Контракты

### 4.1 Публикует WS-10 (коммитится в первые дни WS — §6.4 «ранний старт WS-14»)

| # | Контракт | Сигнатура / место | Семантика (источник) |
|---|---|---|---|
| C-1 | URL-схема и роутер | `src/app/routes.ts`: `pageToPath(persona, org, page): string`, `parsePath(path): {kind:'tenant'\|'platform', tenantId?, page} \| null`; file-routes `src/app/routes/t.$tenantId.<page>.tsx` (19 страниц организации) и `platform.<page>.tsx` (5); `routes/index.tsx` → редирект `/` → `/t/<org>/<DEFAULT_PAGE[persona]>` или `/platform/tenants` | §4.7 мастер-плана, D-25; `DEFAULT_PAGE` `:2327`; `planned` маршрута нет (D-24); search-параметры страниц (`?tab=`, `?trip=` …) — читают страницы, оболочка их не трогает (Q-39). Прямая загрузка: персонаж из `?persona=` (D-44) иначе `owner`; `/platform/*` → `operator` (org не меняется, `:2467`); если `midOf(urlTenant, persona) === undefined` → редирект на `/t/t-alta/<page>` (`:2466`, 01 §19 п.17) |
| C-2 | `useShell()` | `src/shell/hooks/useShell.ts` → `{persona, org, memberId, isOperator, page, pages, go(persona, page), setPage(page), ownerScope, setOwnerScope(id)}` | `setPage`: `pages[persona]=page`, закрывает модалку/поповеры, `#ox-main.scrollTop=0`, при `repair` сбрасывает `?tab=overview` (`:2478–2481`); `go`: закрывает гид и модалку, при смене персонажа — `setPersona` (`:2474–2477`); `pages` хранится по персонажу (Q-35) |
| C-3 | `useDb()` / `useAdapter()` | `useDb(): {db, status:'loading'\|'ready'\|'error', error}` — TanStack Query key `['db', org, memberId]`, `queryFn: adapter.load()`; `useAdapter(): AdapterPort` | компоненты адаптер не вызывают (`14-engineering` «Соглашения кода», 3.2 мастер-плана); `useAdapter` импортируют только хуки `useRun`/`use*Query` |
| C-4 | `useRun()` | `const run = useRun(); run(key, fn: (a: AdapterPort) => Promise<{data, db}>, okText?, {quiet?: string[]}) => Promise<R>`; `useBusy(key?): boolean` | порт `:2445–2460`: `busy=key`; успех → `setQueryData(db)`, `busy=null`, тост `okText` (ok); ошибка → `busy=null`, `db=e.db` если `code ∉ quiet`, тост `e.message ‖ 'Ошибка'` тоном `warn` при `code==='offline'` иначе `error` (если `code ∉ quiet`), исключение пробрасывается |
| C-5 | `useToast()` | `toast(text, tone: 'ok'\|'warn'\|'error'\|'info' = 'ok')` | один тост, 4200 мс, повтор сбрасывает таймер (`:2440–2444`); `role` по тону (`error` → `alert`), `aria-live="polite"`, `bottom` 76/20 px (01 §13) |
| C-6 | `ModalHost` + `useModal()` | `useModal(): {modal, openConfirm(spec: ConfirmSpec), openSheet(), open(kind, fields), patchModal(patch), close(), busy}`; `ConfirmSpec = {tone?, icon?, title, text, sections: {title, items: {icon, tone, text}[]}[], needAck?, ackLabel?, confirmLabel, onConfirm: () => Promise<unknown>}`; регистрация чужих видов: `registerModal(kind, Component)` из `src/shell/modal/registry.ts`, подхватывается `import.meta.glob('../../modals/**/register.ts', {eager:true})` — WS-14 (`assign`, `invite`, `createRole`) и WS-22 (`request`) кладут `register.ts` в свои каталоги, `ModalHost` не правится; пропсы зарегистрированного компонента `{modal, patchModal, close, busy, run}` | контейнер `:2203–2205`, `:3957`: бэкдроп закрывает только при `e.target === e.currentTarget`, `aria-modal`, `aria-labelledby="dlg-title"`, `max-width` 560 (`assign` 620 — задаёт регистрация через `width: 'wide'`), на `W < 640` лист снизу `16px 16px 0 0`; `Escape` → сначала модалка, затем поповеры/гид (`:2406–2410`); фокус-ловушка и возврат фокуса — D-29 |
| C-7 | `PageFrame` и регистрация страниц | `PageFrame({title, crumb?, screenLabel, children})` рендерит `<section aria-labelledby="h-<key>">` с `<h1 id="h-<key>">` и `data-screen-label` (D-37, `texts/screen-labels.ts`); резолвер `src/app/pages.registry.ts`: `import.meta.glob('../routes/**/*.page.tsx')` — ключ = basename до `.page.tsx`; есть модуль → `React.lazy`, нет → `PageStub(key)` (h1 = подпись пункта меню из `navForBase`, `data-screen-label`, без иных элементов) | страница рендерится только при `!gate.show` (`:2862`); гейт и баннеры оборачивает слот, страницы о гейте не знают. Страничный WS создаёт `src/routes/<group>/<key>.page.tsx` с `export default function Page(props: {tenantId: string})` — и ничего в `src/app/**` |
| C-8 | `useOnline()` / `useOutbox()` | `useOnline(): {online, setOnline(on)}`; `useOutbox(): {items: OutboxItem[], enqueue(item), flush(): Promise<void>}`; `OutboxItem = {opId, kind, label, state:'local'\|'sending'\|'error', payload, send: (a: AdapterPort) => Promise<{db}>}` | `setOnline` `:2484–2490`: `adapter.setFlag('online', on)`, при `on` через 60 мс `flush()`, при `!on` тост «Нет связи. Черновики сохраняются на устройстве» (warn); источники — флажок и `window.online/offline` (Q-38). `flush` (`:2553–2577`): по очереди `state='sending'` → `send` → удалить + тост «{label} — принято сервером» (ok), ошибка → `state='error'`, тост «{label}: {message}» (error). WS-23 только `enqueue`; баннеры 3–4 читают `items` |
| C-9 | `DemoOnly`, `useDemo()`, тест-шов | `DemoOnly({children})` рендерит детей только при `import.meta.env.VITE_ADAPTER === 'mock'` (D-44); `useDemo(): {personaValue, setPersona(val), frame, setFrame, flags, setFlag(k, v), reset(), guideOpen, toggleGuide(), prog, mark(k)}`; `window.__ortus = {adapter, run, applyPreset(name), openConfirm(spec), scenario}` — только `VITE_ADAPTER=mock` и (`import.meta.env.DEV ‖ MODE==='e2e'`), после `applyPreset` — `invalidateQueries(['db'])`; search-параметры загрузки `?persona=<value из select>`, `?preset=<имя>`, `?boot=fail` (ошибка `adapter.load` → экран `loadErr`) | §5, §6 отчёта 01; `reset()` `:2436–2438` пересоздаёт адаптер, сохраняет `frame`; флаги `conflictNext`/`failUploadNext` одноразовые — UI снимает галочку по событию адаптера (`:2514, 2590, 2814`) |
| C-10 | `useFrameWidth()` и контейнер | `useFrameWidth(): number` — `ResizeObserver` на фрейме, обновление при изменении > 2 px, старт 1280 (`:2382`, `:2403`); CSS: фрейм `container-type: inline-size; container-name: ox-frame`, запросы `(width < 640px)` mobile, `(640px <= width < 1080px)` rail, `(width >= 1080px)` sidebar | числовой `W` нужен только VM страниц (`listMax/treeMax/us.listMax`, 00 §10 п.5, D-27); раскладка — только CSS (12 §5 п.18, R6 мастер-плана) |

Сигнатуры публикуются одним файлом `src/shell/contracts.ts` (реэкспорт из хуков; страничные WS импортируют только отсюда и из `@ortus/*`):

```ts
import type { AdapterPort, Db, ApiError } from '@ortus/domain';
export type Persona = 'operator' | 'owner' | 'manager' | 'driver' | 'therapist' | 'foreman';
export type Org = 't-alta' | 't-lotos';
export type PageKey = 'home' | 'modules' | 'users' | 'billing' | 'branding' | 'fleet' | 'pool' | 'review' | 'today' | 'cars'
  | 'forms' | 'tasks' | 'calendar' | 'knowledge' | 'data' | 'files' | 'spa' | 'cash' | 'repair'
  | 'tenants' | 'usage' | 'requests' | 'accounts' | 'plans';                       // 24; 'planned' нет (D-24)
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
export type ToastTone = 'ok' | 'warn' | 'error' | 'info';

export function pageToPath(persona: Persona, org: Org, page: PageKey): string;    // C-1
export function parsePath(path: string): { kind: 'tenant'; tenantId: Org; page: PageKey } | { kind: 'platform'; page: PageKey } | null;
export function useShell(): {                                                      // C-2
  persona: Persona; org: Org; memberId: string | null; isOperator: boolean; page: PageKey;
  pages: Record<Persona, PageKey>; go(persona: Persona, page: PageKey): void; setPage(page: PageKey): void;
  ownerScope: 'all' | string; setOwnerScope(id: string): void;
};
export function useDb(): { db: Db | undefined; status: 'loading' | 'ready' | 'error'; error?: Error };   // C-3
export function useRun(): <R extends { db: Db }>(key: string, fn: (a: AdapterPort) => Promise<R>,          // C-4
  okText?: string, opts?: { quiet?: string[] }) => Promise<R>;
export function useBusy(key?: string): boolean;
export function useToast(): (text: string, tone?: ToastTone) => void;              // C-5
export interface ConfirmSpec {                                                     // C-6, порт :2669 + :3960–3966
  tone?: Tone; icon?: string; title: string; text: string;
  sections: { title: string; items: { icon: string; tone: Tone; text: string }[] }[];
  needAck?: boolean; ackLabel?: string; confirmLabel: string; onConfirm: () => Promise<unknown>;
}
export type ModalState = { kind: 'confirm'; spec: ConfirmSpec; ack: boolean } | { kind: 'sheet' } | { kind: string; [k: string]: unknown };
export function useModal(): {
  modal: ModalState | null; busy: boolean;
  openConfirm(spec: ConfirmSpec): void; openSheet(): void; open(kind: string, fields: Record<string, unknown>): void;
  patchModal(patch: Record<string, unknown>): void; close(): void;
};
export function registerModal(kind: string, component: React.ComponentType<ModalProps>, opts?: { width?: 'default' | 'wide' }): void;
export interface ModalProps { modal: ModalState; patchModal(p: Record<string, unknown>): void; close(): void; busy: boolean; run: ReturnType<typeof useRun> }
export function PageFrame(props: { title: string; crumb?: string; screenLabel: string; children: React.ReactNode }): JSX.Element; // C-7
export function useOnline(): { online: boolean; setOnline(on: boolean): void };    // C-8
export interface OutboxItem { opId: string; kind: 'expense' | 'return'; label: string; state: 'local' | 'sending' | 'error'; payload: unknown; send(a: AdapterPort): Promise<{ db: Db }> }
export function useOutbox(): { items: OutboxItem[]; enqueue(item: OutboxItem): void; flush(): Promise<void> };
export function DemoOnly(props: { children: React.ReactNode }): JSX.Element | null; // C-9
export function useFrameWidth(): number;                                            // C-10
declare global { interface Window { __ortus?: { adapter: AdapterPort; run: ReturnType<typeof useRun>; applyPreset(name: string): Promise<void>; openConfirm(spec: ConfirmSpec): void; scenario(name: string): Promise<void> } } }
```

### 4.2 Потребляет

| Откуда | Что | Если контракта нет |
|---|---|---|
| `@ortus/domain` (WS-05) | `navForBase(db, persona, memberId)`, `brandNav`, `gateVM`, `bannersVM`, `brandVars`, `fixAccent`, `initials`, `scopeLabel`, `grants`, `firmsOf`, `moduleOn`, `can`, `MEMBER_BY`, `DEFAULT_PAGE`, `PAGE_MOD`, `BR_LOCK`, `TONE`/`LINE`, `clock`, `seed`, `scenarios` | `MEMBER_BY/DEFAULT_PAGE/PAGE_MOD` отсутствуют → `src/shell/personas.ts` (порт `:2323–2328`) с пометкой `// Owner: WS-10, перенос в domain — через интегратора`; `gateVM/bannersVM` отсутствуют → **блокер** интегратору (не реализовывать локально: тексты и условия — контракт WS-05/WS-08) |
| `@ortus/adapter` (WS-06) | `createMockAdapter({seed, clock, delays, scenario})`, `applyPreset(name)`, `flags`, `setActor`, `load(ms)`, `setFlag` | задержка `load` по умолчанию 500 мс / 320 мс при смене персонажа (`api.js:112`, `:2470`); в экранных тестах `delays: 0` (D-39) |
| `@ortus/ui` (WS-04 стабы → WS-12 реализация) | `Button`, `IconButton`, `Banner`, `AccessGate`, `Dialog/ConfirmDialog/Sheet`, `Toast`, `Skeleton`, `Select`, `Checkbox` — пропсы §4.4 мастер-плана | до слияния WS-12 стабы (`data-stub`) рендерят `children` без поведения: красные экранные/e2e-тесты падают по тексту/роли (это ожидаемо); единицы §7 п.11–14 выполняются **после** ребейза на слитый WS-12; если WS-12 к тому моменту не слит — временная разметка в `src/shell/fallback/*` на токенах, замена на `@ortus/ui` — отдельный `refactor(shell)` коммит с теми же зелёными тестами |
| `@ortus/texts` (WS-08) | `shell`, `gate`, `banners`, `toast`, `screen-labels` | отсутствующая строка оболочки → добавить в `texts/shell.ts` (разрешено владельцу); отсутствующая строка гейта/баннера/тоста → интегратору (владелец WS-08) |
| `@ortus/tokens` (WS-04) | `tokens.css` (`--ox-*`, `:focus-visible`, `prefers-reduced-motion`), `fonts.css`, `prototype`-алиасы (`--ox-accent-tint`, `LINE`, 36/40 px, радиусы 14/16) | нет алиаса → **не** литерал в CSS, а запрос интегратору (D-28, 12 §5 п.17) |
| `@ortus/e2e-kit` + `e2e/fixtures` (WS-07) | фикстуры `demo` (персонаж по подписи, флаги, «Сбросить», `applyPreset`), `reference` (`openReference({persona, page, recipe, width})`), `clock`, `axe`; `toMatchReference(key, opts)`, `collectLabels(root, {exclude})`; `tools/e2e-skeleton.js`; проекты `mobile-390/tablet-768/desktop-1440`, `locale ru-RU`, `timezoneId Europe/Moscow`, `webServer[1]` эталон 4173 | `collectLabels` не поддерживает `exclude` / не фильтрует невидимые (`checkVisibility()`) элементы → блокер интегратору (структурная сверка оболочки без исключения `#ox-main > div > section` невозможна, §8) |
| `tools/verify-pages.js` (WS-07, Stop-хук WS-01) | напоминание по `src/shell/**`, `src/app/**`, `src/demo/**` → ключи без свежего `docs/plan/evidence/<key>/` | — |

## 5. Экраны, диалоги, состояния

Персонажи — по подписям `<select>` «Персонаж» (`:32–47`): operator «Оператор платформы», owner «Владелец · Дарья Зимина», manager «Логист · Марина Котова», driver «Водитель · Илья Васильев», therapist «Массажист · Анна Морозова», foreman «Прораб · Алексей Соколов», owner@t-lotos «Владелец · Ирина Белова», therapist@t-lotos «Массажист · Анна Морозова».

| Ключ / элемент | Дословная подпись | Персонажи | Строки прототипа | Состояния | e2e spec | URL |
|---|---|---|---|---|---|---|
| `shell` · панель демо | `region` «Панель демонстрации»; «Демо-режим»; «Персонаж»; «Ширина»; «Путь проверки»; «Сбросить»; «Нет связи»; «Конфликт брони»; «Сбой загрузки фото»; примечание «Переключатель персонажей — демонстрация, не механизм безопасности. Данные вымышлены и живут в памяти страницы.» | все | `:29–67`, `:2832–2842` | только mock-сборка (`DemoOnly`, D-44); скрыта перед снимком (D-45) | `demo-panel.spec.ts` | любой |
| `shell` · гид | `dialog` «Путь проверки»; «Основной путь»; «Закрыть»; «Перейти» × 8; «Негативные проверки» | все | `:68–87`, `:2903–2931` | закрыт/открыт; кружок выполнен «✓» / текущий «N» / будущий | `guide.spec.ts` | любой |
| `shell` · загрузка | `status` «Загрузка», «Загружаем рабочее пространство…» | все | `:182–190`, `:2846–2854` | при `boot`, смене персонажа, «Сбросить» | `shell.spec.ts` S-01 | любой |
| `shell` · ошибка загрузки | `alert` «Не удалось загрузить модули прототипа: {text}» | все | `:191–193`, `:2434` | `?boot=fail` | S-41 | любой |
| `shell` · шапка светлая | «ортус» / короткое имя; «пространство бизнеса»; `tenant.name`; область (текст или `select` «Область просмотра»); `status` «Нет связи»; `button` «Уведомления[: N новых]»; `button` «Профиль» | owner, manager, driver, therapist, foreman, owner@t-lotos, therapist@t-lotos | `:94–122`, `:3030–3040` | офлайн-пилюля; бейдж непрочитанных; `aria-expanded` | S-02, S-11–S-12, S-18, S-22–S-24, S-27, S-31–S-33 | `/t/:tenantId/*` |
| `shell` · шапка тёмная | «ортус»; «управление платформой»; «Управление платформой»; «Отдельный вход · без доступа к данным клиентов»; «ОП»; без «Уведомления» | operator | `:3031–3037`; 04 §4.3 | без баннеров и гейта | S-13 | `/platform/*` |
| `shell` · поповер уведомлений | `dialog` «Уведомления»; «Прочитать все»; «Новых событий нет» | все кроме operator | `:124–135`, `:3042` | пусто / список ≤ 12 / точка прочитано | S-22, S-24 | — |
| `shell` · поповер профиля | `dialog` «Профиль»; «Назначения»/«Права»; «Выйти · недоступно в демо» (`disabled`) | все | `:136–145`, `:3044–3046` | тексты по персонажу (01 §10.4) | S-23 | — |
| `shell` · боковая панель | `navigation` «Основная навигация»; заголовки групп; подвал «Данные других организаций изолированы» / «Без доступа к данным клиентов» | все, `W ≥ 640` | `:149–170`, `:2960–3001` | sidebar 244 / rail 68 (подписи sr-only + `title`) | S-04–S-05, S-08–S-13 | — |
| `shell` · нижняя навигация | `navigation` «Навигация»; 3 пункта + «Ещё» (сокращения «Логист», «Люди», «Модули», «Пул», «Приёмка») | все, `W < 640` | `:2192–2201`, `:3025–3028` | активный `FILL 1` | S-06, S-44 | — |
| `shell` · баннеры | «Пробный период завершён.» (+ «Демо: продлить как оператор»); «Модуль «Логистика» отключён.»; «Нет связи.»; «Связь восстановлена.»; «Место организации заполнено.» (+ «Открыть «Модули и место»») | все кроме operator | `:174–180`, `:3080–3093` | по условиям 01 §11; `alert` только danger | S-18–S-21 | — |
| `shell` · AccessGate | чип «Модуль не подключён» / «Модуль отключён» / «Нет права»; h1 по 01 §12; кнопки «Открыть «Модули и место»» / «Демо: открыть как владелец» | owner, manager, driver, therapist, foreman, owner@t-lotos, therapist@t-lotos | `:195–203`, `:3051–3078` | `module_off`, `module_readonly`, `no_permission`, `no_scope`; стартовые: driver `today/cars`, foreman `repair`, owner `repair`, manager `fleet` | S-14–S-17 | по странице |
| `shell` · тост | текст по вызову; `role` status/alert | все | `:2313–2317`, `:2895–2901` | ok/warn/error/info; 4200 мс | S-18, S-30 | — |
| `shell` · заглушка страницы | `section[aria-labelledby]` + `h1` = подпись меню | все | `:205–2187` (реальные страницы — волна 2) | — | S-14 (h1 «Модули и место») | по странице |
| `modal-sheet` | `dialog` «Все разделы»; «Закрыть»; группы и пункты меню; бейджи | все, `W < 640` | `:2300–2308`, `:4029`, `:3028` | пустые группы отброшены; активный `aria-current="page"` | `modal-sheet.spec.ts` | не меняется |
| `modal-confirm` | `h2#dlg-title` по вызову; «Отмена»; `confirmLabel` / «Выполняем…»; `ackLabel` | все | `:2206–2228`, `:3960–3968`, экземпляры `:2674–2746`, `:2616`, `:2791`, `:2821`, `:3937`, `:4272`, `:4433` | `busy`; `needAck && !ack` → `disabled`; офлайн → тост warn, диалог открыт (04 §4.6); лист на 390 | `modal-confirm.spec.ts` | не меняется |

Матрица §4.9 для оболочки: клетки «Г-*» стартовых состояний — driver `today`/`cars` (Г-М), foreman `repair` (Г-М), owner `repair` (Г-М), manager `fleet` (Г-М; после `logistics-ready` без роли — Г-П), owner@t-lotos `repair` (Г-М) — покрываются S-14–S-17 и S-45–S-52.

## 6. Тесты первыми

### 6.1 (а) E2E-скелет — первый коммит `test(shell): e2e-скелет shell/demo-panel/guide/modal-confirm/modal-sheet (test.fixme)`

Генерация: `node tools/e2e-skeleton.js --report 01-shell --section 20 --key shell` (+ §1.3 и «Г-*» по §8.2 мастер-плана); `demo-panel`/`guide`/`modal-*` — вручную по тому же формату (имя теста = текст пункта). Селекторы — только из 01 §20 (`getByRole('region', {name:'Панель демонстрации'})`, `getByLabel('Персонаж')`, `getByLabel('Ширина')`, `getByRole('button', {name:'Путь проверки'})`, `getByRole('dialog', {name:'Путь проверки'})`, `getByRole('navigation', {name:'Основная навигация'})`, `getByRole('navigation', {name:'Навигация'})`, `getByRole('button', {name:/^Уведомления/})`, `getByRole('button', {name:'Профиль'})`, `getByLabel('Область просмотра')`, `getByRole('status')`, `getByRole('alert')`, `getByRole('dialog', {name:'Уведомления'})`, `getByRole('dialog', {name:'Профиль'})`, `locator('[role=dialog][aria-modal=true]')`, `#ox-main`, `locator('[aria-current=page]')`). Все состояния, достижимые в прототипе только через страницы волны 2 (`modules`, `users`), в WS-10 воспроизводятся **пресетами** `demo.applyPreset` (D-26: пресет = предусловие e2e) или швом `window.__ortus` — это отмечено в колонке «Given».

**`shell.spec.ts` — 52 теста** (S-01…S-38 = 01 §20 #1–#38 дословно; S-39…S-44 = `verification-protocol.md` §1.3; S-45…S-52 = рецепт `base` для 8 персонажей, §8.2):

| № | Имя теста (дословно из 01 §20) | Given / When / Then (ключевые ожидания; селекторы) |
|---|---|---|
| S-01 | Загрузка | Given `/`; Then `getByRole('status', {name:'Загрузка'})` с текстом «Загружаем рабочее пространство…» виден, затем скрыт; `await expect(page).toHaveTitle('Ортус — CRM, прототип итерации 1')` |
| S-02 | Стартовый персонаж | Then `getByLabel('Персонаж')` `toHaveValue('owner')`; в `header` видны «ортус», «пространство бизнеса», «Альта Групп»; `[aria-current=page]` = «Главная»; URL `/t/t-alta/home` |
| S-03 | Селектор персонажа | Then три `optgroup` «Платформа», «Альта Групп», «SPA «Лотос»»; опции и `value` по 01 §5 п.2 дословно (8 строк) |
| S-04 | Ширина 1440 | Given `getByLabel('Ширина')` → `1440` (на `desktop-1440`); Then фрейм `toHaveCSS('width','1440px')`, `border-radius: 12px`; `navigation` «Основная навигация» `width: 244px`, заголовки «Обзор», «Компания», «Ремонт и стройка», «Отрасли», «Общие модули», подпись «Данные других организаций изолированы»; `navigation` «Навигация» отсутствует |
| S-05 | Ширина 768 | Given `768`; Then боковая `width: 68px`, заголовков групп нет, у кнопок `title` = подпись и видимая иконка; `navigation` «Навигация» отсутствует |
| S-06 | Ширина 390 | Given `390`; Then фрейм `width: 390px`, `border-radius: 22px`; боковой нет; `navigation` «Навигация» содержит 4 кнопки «Главная», «Модули», «Люди», «Ещё»; в `header` нет текста «ортус» |
| S-07 | Лист «Ещё» | Given 390, клик «Ещё»; Then `dialog` «Все разделы», «Закрыть», все группы; When «Оформление»; Then лист закрыт, `aria-current=page` у «Оформление», URL `/t/t-alta/branding` |
| S-08 | Меню владельца | Given owner, 1440; Then порядок: «Главная»; «Модули и место», «Пользователи и роли», «Подписка и места», «Оформление»; «Объекты»; «Салон и SPA»; «Задачи», «Формы и опросы», «Календарь», «База знаний», «Данные», «Файлы», «Касса»; группы «Логистика» нет |
| S-09 | Меню после подключения «Логистики» | Given `demo.applyPreset('logistics-ready')` (вместо UI-шагов — страница «Модули и место» в WS-20; тост «Модуль «Логистика» подключён» проверяет `modules.spec.ts`); Then группа «Логистика»: «Рабочее место логиста», «Ресурсный пул», «Приёмка смен» |
| S-10 | Меню менеджера до роли | Given manager; Then «Обзор» («Главная») и «Логистика» («Рабочее место логиста»); «Общие модули» нет; область «Область не назначена»; профиль «Ролей нет — доступ к модулям не выдан» |
| S-11 | Меню водителя | Given driver; Then «Сегодня», «Автомобили», «База знаний»; `#ox-main > div` `max-width: 680px`; область «Москва / Север Логистик · мои назначения» |
| S-12 | Меню массажиста / прораба | therapist → «Мой день», «Календарь», «База знаний», «Салон и SPA · мой календарь»; foreman → «Объекты», «Задачи», «База знаний», «Назначенные объекты» |
| S-13 | Оператор | Given operator; Then `header` `background-color: rgb(28, 42, 38)`, «управление платформой», «Управление платформой», «Отдельный вход · без доступа к данным клиентов»; кнопки «Уведомления» нет; «ОП»; меню «Организации», «Использование», «Заявки на тариф» (бейдж «1»), «Пользователи», «Тарифная сетка»; подпись «Без доступа к данным клиентов»; `role=status/alert` баннеров нет; URL `/platform/tenants` |
| S-14 | AccessGate: модуль не подключён (водитель) | Given driver; Then `h1` «Логистика» не подключена организацией, чип «Модуль не подключён», текст «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.», кнопка «Демо: открыть как владелец»; When клик; Then персонаж `owner`, URL `/t/t-alta/modules`, `h1` «Модули и место» |
| S-15 | AccessGate: PAGE_MOD (прораб) | Given foreman; Then `h1` «Ремонт и стройка» не подключён организацией; текст «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.» |
| S-16 | AccessGate: нет права | Given `window.__ortus.run('mod', a => a.setModule('logistics', true))` (владелец), затем manager → «Рабочее место логиста»; Then чип «Нет права», `h1` «Нет роли с доступом к модулю «Логистика»»; «Демо: открыть как владелец» → URL `/t/t-alta/users` |
| S-17 | AccessGate: нет права на приёмку | Given то же, гид «Логист: принять смену» → «Перейти»; Then `h1` «Нет права на приёмку смен», текст содержит «(«Проверять»)» |
| S-18 | Баннер офлайн | Given owner; When `getByLabel('Нет связи')` отмечен; Then тост `status` «Нет связи. Черновики сохраняются на устройстве»; в `header` `status` «Нет связи»; баннер `status` «Нет связи.» + «Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.»; When снять; Then пилюля и баннер исчезают |
| S-19 | Баннер trial | Given `applyPreset('trial-ended')` (UI-шаги и тост «Пробный период завершён (демо)» — `modules.spec.ts` WS-20); Then баннер «Пробный период завершён.» с кнопкой «Демо: продлить как оператор»; When клик; Then персонаж `operator`, URL `/platform/tenants` |
| S-20 | Баннер места | Given `applyPreset('storage-full')` (диалог лимита — WS-20); Then на `/t/t-alta/home` баннер `alert` «Место организации заполнено.» с кнопкой «Открыть «Модули и место»»; на `/t/t-alta/modules` кнопки нет |
| S-21 | Баннер отключённого модуля | Given `logistics-ready`, затем `__ortus.run('mod', a => a.setModule('logistics', false))`; When driver; Then баннер «Модуль «Логистика» отключён.» и `h1` «Сегодня» (заглушка, без AccessGate) |
| S-22 | Уведомления | Given owner; Then `button` `aria-label="Уведомления"` без бейджа; клик → `dialog` «Уведомления», «Новых событий нет», «Прочитать все»; Given `applyPreset('logistics-ready')`; Then `aria-label="Уведомления: 1 новых"`, бейдж «1», пункт «Подключён модуль «Логистика»» с точкой `rgb(31, 107, 82)`; «Прочитать все» → бейдж исчез, точка `transparent` |
| S-23 | Профиль | owner → «Дарья Зимина», «Владелец · d.zimina@alta.example», «Назначения», «Владелец бизнеса · Вся организация», «Выйти · недоступно в демо» `toBeDisabled()`; driver → «Водитель · Москва / Север Логистик · через группа «Водители Север»» |
| S-24 | Взаимоисключение поповеров | «Профиль» открыт → клик «Уведомления» → «Профиль» скрыт, «Уведомления» виден; `Escape` → оба скрыты |
| S-25 | Escape для модалки | Given `window.__ortus.openConfirm(DISABLE_LOGISTICS)` при открытом «Профиль»; `Escape` → `aria-modal` скрыт, «Профиль» всё ещё виден; второй `Escape` → скрыт |
| S-26 | Бэкдроп | клик по бэкдропу `position` вне диалога → закрыт; клик внутри — открыт |
| S-27 | Селектор области владельца | `getByLabel('Область просмотра')` 16 `option`, первая «Все подразделения», есть «Москва · весь регион», «Москва / Север Логистик»; у manager/driver селекта нет, есть текст |
| S-28 | Путь проверки | «Путь проверки» → `aria-expanded="true"`, `dialog` с «Основной путь», 8 шагов (01 §6), «Перейти» × 8, «Негативные проверки» 7 строк; кружок шага 1 «1» с `background-color` = `--ox-accent-soft`; «Перейти» у шага 3 → `driver`, гид закрыт; повторное открытие — шаг 3 «✓», фон акцент |
| S-29 | Сбросить | Given driver + «Нет связи» + ширина 390; «Сбросить» → `owner`, флаг снят, ширина 390, гид без «✓» |
| S-30 | Тост авто-скрытие | Given тост (S-18); Then `expect.poll` ≤ 4,5 с → скрыт; `aria-live="polite"`, `background-color: rgb(28, 42, 38)`; `bottom: 76px` на 390, `20px` на 1440 |
| S-31 | Лотос: оформление | owner@t-lotos → «Лотос», буква «Л» на `rgb(122, 62, 121)`, «SPA «Лотос»»; `--ox-accent` = `#7A3E79`; активный пункт цвета акцента; 4 опции области («Все подразделения», «Москва · весь регион», «Москва / Лотос · Тверская», «Москва / Лотос · Арбат»); «Логистика» нет; URL `/t/t-lotos/home` |
| S-32 | Лотос: изоляция | Given `logistics-ready` в «Альте»; owner@t-lotos → «Логистика» нет, «Новых событий нет»; обратно owner → `--ox-accent` `#1F6B52`, «Логистика» на месте |
| S-33 | Лотос: массажист | therapist@t-lotos → «Мой день», «Календарь», «База знаний»; профиль «Анна Морозова», «Массажист · Тверская · a.morozova@alta.example»; URL `/t/t-lotos/spa` |
| S-34 | Модалка «Пригласить участника» | `test.fixme(true, 'Q-121: кнопка «Пригласить» — страница «Пользователи и роли» WS-20, диалог WS-14; закрывается в modal-invite.spec.ts / users.spec.ts')` |
| S-35 | Модалка «Назначить роль» | `test.fixme(true, 'Q-121: «Назначить роли» — страница «Модули и место» WS-20, диалог WS-14; закрывается в modal-assign.spec.ts / modules.spec.ts')` |
| S-36 | Модалка «Создать роль» | `test.fixme(true, 'Q-121: вкладка ролей WS-20, диалог WS-14; закрывается в modal-createRole.spec.ts')` |
| S-37 | Мобильная модалка | Given 390 и `__ortus.openConfirm(DISABLE_LOGISTICS)`; бэкдроп `align-items: flex-end`; диалог `border-radius: 16px 16px 0px 0px` |
| S-38 | Фокус-кольцо | `Tab` на кнопку → `outline: 2px solid rgb(31, 107, 82)` (`:focus-visible` из `tokens.css`) |
| S-39 | страница открывается из навигации по подписи «Главная» и по прямому URL | `/` → `/t/t-alta/home`; `/t/t-alta/branding` напрямую → `aria-current` «Оформление»; `/platform/usage` → тёмная шапка, `aria-current` «Использование»; `/t/t-lotos/today` (нет водителя в «Лотосе») → `/t/t-alta/today` |
| S-40 | заголовок и крошки соответствуют прототипу | `header`: «ортус» · «пространство бизнеса» · «Альта Групп» · область; `/t/t-lotos/*` — «Лотос» · «SPA «Лотос»» |
| S-41 | состояния: пусто / загрузка / ошибка / нет права или модуль не подключён / офлайн — дословный текст | `?boot=fail` → `alert` «Не удалось загрузить модули прототипа: demo: boot failure»; остальные — ссылки на S-01, S-14, S-18 |
| S-42 | клавиатура: Tab обходит все интерактивные элементы, Escape закрывает диалог, фокус виден | порядок фокуса: панель демо → skip-link «К содержимому» (D-29, невидим) → шапка → боковая → `main`; `Escape` по S-24/S-25 |
| S-43 | axe: нет serious/critical | owner и operator и driver (гейт) на 390 и 1440 |
| S-44 | раскладка 390: нет горизонтальной прокрутки, нижняя навигация, цели ≥ 44 px; 1440: боковая панель | `document.scrollingElement.scrollWidth <= 390`; кнопки нижней навигации `height >= 60`; кнопки гейта/диалога ≥ 44; иконки шапки ровно 40 и 36 (как нарисовано, 01 §19 п.14, D-28) |
| S-45…S-52 | стартовый маршрут персонажа «<подпись select>» | по одному тесту на персонажа: URL `/t/t-alta/home`, `/t/t-alta/home`, `/t/t-alta/today`, `/t/t-alta/spa`, `/t/t-alta/repair`, `/platform/tenants`, `/t/t-lotos/home`, `/t/t-lotos/spa`; `aria-current` = стартовый пункт; инициалы «ДЗ», «МК», «ИВ», «АМ», «АС», «ОП», «ИБ», «АМ»; `getByLabel('Персонаж')` `toHaveValue` = `owner`, `manager`, `driver`, `therapist`, `foreman`, `operator`, `owner@t-lotos`, `therapist@t-lotos` |

**`demo-panel.spec.ts` — 12 тестов** (01 §5):

| № | Имя | Ожидание |
|---|---|---|
| DP-01 | панель «Демо-режим»: регион и заголовок | `region` «Панель демонстрации» `background-color: rgb(34, 48, 44)`; текст «Демо-режим» |
| DP-02 | «Персонаж»: три группы и восемь опций дословно | как S-03 + `optgroup` порядок «Платформа» → «Альта Групп» → «SPA «Лотос»» |
| DP-03 | значение селектора для «Лотоса» | owner@t-lotos → `toHaveValue('owner@t-lotos')`; operator после «Лотоса» → `operator`, URL `/platform/tenants` (Q-37) |
| DP-04 | «Ширина»: четыре опции и рамка фрейма | опции «По окну», «390 · телефон», «768 · планшет», «1440 · компьютер»; `768` → фрейм `border: 1px solid rgb(201, 209, 199)`, `border-radius: 12px`, `box-shadow` непустой; `auto` → `border-width: 0px` |
| DP-05 | «Путь проверки» переключает `aria-expanded` и закрывает поповеры | «Профиль» открыт → «Путь проверки» → `aria-expanded="true"`, «Профиль» скрыт; повтор → `false` |
| DP-06 | «Сбросить» пересоздаёт данные и сохраняет ширину | `logistics-ready` → «Сбросить» → группы «Логистика» нет, `owner`, ширина как была, `aria-label="Уведомления"` без счётчика |
| DP-07 | «Нет связи» ↔ пилюля и тост | как S-18 + `getByLabel('Нет связи')` `toBeChecked()` |
| DP-08 | «Конфликт брони» — одноразовый флаг | отметить → `page.evaluate(() => window.__ortus.adapter.flags.conflictNext)` `true`; `__ortus.run('reserve', …)` после `driver-booked`-подобного пресета не требуется: проверяется только, что после события `flag:consumed` галочка снимается (эмуляция через `__ortus.adapter.setFlag('conflictNext', false)` + событие) |
| DP-09 | «Сбой загрузки фото» — одноразовый флаг | аналогично DP-08 с `failUploadNext` |
| DP-10 | примечание дословно | «Переключатель персонажей — демонстрация, не механизм безопасности. Данные вымышлены и живут в памяти страницы.» |
| DP-11 | `?persona=` задаёт стартового персонажа | `/?persona=driver` → `/t/t-alta/today`, `toHaveValue('driver')`; `/?persona=owner@t-lotos` → `/t/t-lotos/home` |
| DP-12 | смена персонажа: скелетон → страница → URL | owner → driver: виден `status` «Загрузка», затем `h1` гейта и URL `/t/t-alta/today`; «Профиль»/«Уведомления»/гид закрыты |

**`guide.spec.ts` — 10 тестов** (01 §6; только разметка и навигация, прохождение шагов — WS-55):

| № | Имя | Ожидание |
|---|---|---|
| G-01 | диалог «Путь проверки»: роль, заголовки, кнопка «Закрыть» | `dialog` «Путь проверки», `strong` «Основной путь», «Негативные проверки», `button` «Закрыть» 36×36 → закрывает |
| G-02 | восемь шагов дословно и по порядку | «Владелец: подключить «Логистику»», «Назначить Марине Котовой роль и область», «Переключиться на водителя», «Забронировать совместимую машину», «Заполнить осмотр и выехать», «Добавить расход», «Сдать машину», «Логист: принять смену» |
| G-03 | семь негативных проверок дословно | 7 строк 01 §6 (от «Несовместимая машина: Hyundai Porter и Ford Transit для Р-208 — кнопка брони недоступна, причина указана» до «Флажок «Нет связи» → расходы и сдача сохраняются на устройстве, бронь и выезд блокируются») |
| G-04 | кружки: текущий шаг 1, остальные будущие | шаг 1: «1», `background-color: rgb(227, 239, 231)` (`--ox-accent-soft`), `color: rgb(31, 107, 82)`; шаг 2: фон `rgb(255, 255, 255)`, рамка `rgb(205, 213, 203)` |
| G-05 | «Перейти» у шага 1 → владелец, «Модули и место» | URL `/t/t-alta/modules`, гид закрыт, `aria-expanded="false"` |
| G-06 | «Перейти» у шага 2 → владелец, «Пользователи и роли» | URL `/t/t-alta/users` |
| G-07 | «Перейти» у шага 3 отмечает шаг | → `driver`, `/t/t-alta/today`; повторное открытие: «✓», фон `rgb(31, 107, 82)`, текст `rgb(92, 105, 100)`; текущим стал шаг 4 |
| G-08 | «Перейти» у шагов 4–7 → водитель, «Сегодня» | каждый → `/t/t-alta/today`, персонаж `driver` |
| G-09 | «Перейти» у шага 8 → логист, «Приёмка смен» | → `manager`, `/t/t-alta/review`; в базовом сиде AccessGate `h1` «Логистика» не подключена организацией |
| G-10 | гид закрывается `Escape` и «Сбросить» очищает прогресс | `Escape` → скрыт; после G-07 «Сбросить» → шаг 3 без «✓» |

**`modal-confirm.spec.ts` — 20 тестов** (01 §14.2, 04 §4.7, `:2694–2707`; открытие в WS-10 — `window.__ortus.openConfirm(spec)` с константами `DISABLE_LOGISTICS`, `ENABLE_LOGISTICS`, `TRIAL_END`, `QUOTA_50`, `OP_CONFIRM` из `e2e/recipes/shell.ts`, дословно перенесёнными из `:2674–2746`, `:2821–2823`; 9 реальных вызывающих точек 00 §3.2 проверяют страницы волны 2):

| № | Имя | Ожидание |
|---|---|---|
| MC-01 | структура диалога «Отключить «Логистика»?» | `[role=dialog][aria-modal=true][aria-labelledby=dlg-title]`, `h2#dlg-title` «Отключить «Логистика»?», `p` «Данные не удаляются. Модуль перейдёт в режим чтения истории.», круг 42×42 с иконкой `extension_off` цветов danger (`rgb(251, 234, 231)` / `rgb(161, 58, 51)`) |
| MC-02 | секции последствий | «ЗАТРОНЕТ СЕЙЧАС» (uppercase CSS, текст «Затронет сейчас»): «Форма «Осмотр машины» v3 — приём новых ответов остановится», «Автоматизация «Ответ осмотра → задача менеджеру» будет приостановлена»; «Что произойдёт»: «Новые брони, рейсы и осмотры будут закрыты», «Начатые смены можно безопасно завершить и принять», «История, назначения ролей и файлы сохраняются» |
| MC-03 | подтверждение `ack` блокирует главную кнопку | «Отключить модуль» `toBeDisabled()`; `getByLabel('Понимаю последствия для текущей работы')` → отметить → `toBeEnabled()`; фон кнопки `rgb(161, 58, 51)` |
| MC-04 | «Выполняем…» при `busy` | `onConfirm` с задержкой 300 мс (`__ortus.run` + адаптер) → кнопка «Выполняем…» `disabled`, «Отмена» активна |
| MC-05 | успех закрывает диалог и показывает тост | после `logistics-ready`: «Отключить модуль» → диалог скрыт, тост «Модуль отключён. История доступна для чтения» (`status`) |
| MC-06 | ошибка оставляет диалог открытым | «Нет связи» → «Отключить модуль» → тост `status` «Нет связи с сервером. Операция не выполнена.», диалог виден, подпись снова «Отключить модуль» |
| MC-07 | `Escape` закрывает | как S-25 |
| MC-08 | бэкдроп: снаружи закрывает, внутри — нет | как S-26 |
| MC-09 | «Отмена» закрывает | `button` «Отмена» → скрыт, `ack` сброшен при повторном открытии |
| MC-10 | вариант «Подключить «Логистика»?» (tone ok) | секции «Что появится», «Зависимости», «Важно»; пункт «Подключается в рамках пробного периода. Стоимость не рассчитывается: тарифы не согласованы.»; кнопка «Подключить» фон `rgb(31, 107, 82)` |
| MC-11 | вариант «Смоделировать окончание пробного периода?» (tone warn) | иконка `lock_clock` в `rgb(250, 241, 220)`/`rgb(122, 82, 20)`; «Что произойдёт» 3 пункта `:2740–2742`; кнопка «Завершить пробный период» |
| MC-12 | вариант без секций «Изменить лимит на 50 ГБ?» | `sections: []` → заголовков секций нет; `p` «Занято 46,2 ГБ. Стоимость не рассчитывается: тарифы не согласованы.»; кнопка «Изменить» |
| MC-13 | вариант `opConfirm` «Последствия» | иконка `admin_panel_settings`, секция «Последствия», тост «Готово · запись добавлена в журнал» |
| MC-14 | фокус-ловушка и возврат фокуса (D-29) | при открытии фокус внутри диалога; `Tab` с последней кнопки → первая; после закрытия фокус на кнопке-инициаторе; sentinel-элементы несут `data-a11y-extra="D-29"` |
| MC-15 | диалог открывается поверх текущего маршрута, URL не меняется | `/t/t-alta/home` до и после (Q-39) |
| MC-16 | заголовок соответствует прототипу | `aria-labelledby` указывает на `h2#dlg-title`; один `h2` в диалоге |
| MC-17 | состояния: busy / ошибка / офлайн — дословный текст | сводный: MC-04 + MC-06 + тост `error` при `validation` (шов `__ortus.openConfirm` с `onConfirm`, бросающим `ApiError('validation','Укажите причину')` → тост `alert` «Укажите причину», диалог открыт) |
| MC-18 | клавиатура: Tab внутри, Escape закрывает, фокус виден | `Tab` по «Отмена» → `outline: 2px solid` акцента |
| MC-19 | axe: нет serious/critical | на открытом диалоге, 390 и 1440 |
| MC-20 | раскладка: лист на 390, центр на 1440 | 390: `align-items: flex-end`, `border-radius: 16px 16px 0px 0px`, `padding: 0px` у бэкдропа; 1440: `align-items: center`, `padding: 24px`, `border-radius: 14px`, `max-width: 560px` |

**`modal-sheet.spec.ts` — 18 тестов** (01 §9.6, `:2300–2308`, `:3028`; все на `mobile-390`, кроме MS-10):

| № | Имя | Ожидание |
|---|---|---|
| MS-01 | «Ещё» открывает лист «Все разделы» | `dialog` с `h2#dlg-title` «Все разделы», `button` «Закрыть» 44×44 `border-radius: 10px` |
| MS-02 | группы и пункты владельца по порядку | заголовки «Обзор», «Компания», «Ремонт и стройка», «Отрасли», «Общие модули» (uppercase CSS); 14 кнопок по S-08; высота ≥ 48 |
| MS-03 | активный пункт | «Главная» `aria-current="page"`, фон `rgb(227, 239, 231)`, `font-weight: 600` |
| MS-04 | бейджи в листе | operator → «Заявки на тариф» с бейджем «1»; manager после `logistics-ready` → «Задачи» «1» |
| MS-05 | клик по пункту переводит и закрывает | «Оформление» → лист скрыт, URL `/t/t-alta/branding`, `aria-current` в нижней навигации не на «Главная» |
| MS-06 | «Ещё» подсвечен, пока лист открыт | `color: rgb(31, 107, 82)` при открытом, `rgb(76, 89, 85)` после закрытия |
| MS-07 | «Закрыть», Escape, бэкдроп | каждое закрывает; клик внутри листа не закрывает |
| MS-08 | радиус и прижатие к низу | `border-radius: 16px 16px 0px 0px`, бэкдроп `align-items: flex-end`, контейнер `padding: 16px 12px 20px` |
| MS-09 | лист водителя | группа «Работа»: «Сегодня», «Автомобили», «База знаний» |
| MS-10 | на 768 и 1440 кнопки «Ещё» нет | `desktop-1440` и `tablet-768`: `navigation` «Навигация» отсутствует |
| MS-11 | лист «Лотоса» без «Логистики» | owner@t-lotos: групп «Логистика» нет, остальные группы владельца на месте |
| MS-12 | фокус-ловушка и возврат фокуса (D-29) | как MC-14; после закрытия фокус на «Ещё» |
| MS-13 | открывается из навигации «Ещё», URL не меняется | `/t/t-alta/home` до и после |
| MS-14 | заголовок соответствует прототипу | один `h2#dlg-title` «Все разделы» |
| MS-15 | состояние: пустые группы отброшены | manager до роли: только «Обзор» и «Логистика» |
| MS-16 | клавиатура: Tab по пунктам, Escape закрывает, фокус виден | `Tab` → `outline` акцента на «Закрыть» |
| MS-17 | axe: нет serious/critical | открытый лист, owner и operator |
| MS-18 | раскладка 390: нет горизонтальной прокрутки, цели ≥ 44 px | `scrollWidth <= 390`; все кнопки листа ≥ 48, «Закрыть» ≥ 44 |

Итого e2e-скелет: **52 + 12 + 10 + 20 + 18 = 112** `test()` в `test.fixme`.

**`e2e/recipes/shell.ts`** (рецепты исполняются фикстурой `reference` одинаково на эталоне и в реализации — D-26; константы диалогов — дословный перенос из прототипа):

```ts
export const DISABLE_LOGISTICS: ConfirmSpec = { tone: 'danger', icon: 'extension_off', title: 'Отключить «Логистика»?',
  text: 'Данные не удаляются. Модуль перейдёт в режим чтения истории.',
  sections: [ { title: 'Затронет сейчас', items: [ /* :2692 два пункта */ ] }, { title: 'Что произойдёт', items: [ /* :2700–2702 */ ] } ],
  needAck: true, ackLabel: 'Понимаю последствия для текущей работы', confirmLabel: 'Отключить модуль',
  onConfirm: () => window.__ortus!.run('mod', (a) => a.setModule('logistics', false), 'Модуль отключён. История доступна для чтения') };
export const ENABLE_LOGISTICS   /* :2674–2686 */, TRIAL_END /* :2736–2746 */, QUOTA_50 /* :2732 */, OP_CONFIRM /* 04 §4.7, :2821–2823 */;

export const recipes = {
  'popover-notif':   { steps: [['click', { role: 'button', name: /^Уведомления/ }]] },
  'popover-profile': { steps: [['click', { role: 'button', name: 'Профиль' }]] },
  'guide-open':      { steps: [['click', { role: 'button', name: 'Путь проверки' }]] },
  'offline':         { steps: [['check', { label: 'Нет связи' }]] },
  'sheet-open':      { width: 390, steps: [['click', { role: 'button', name: 'Ещё' }]] },
  'gate-manager-fleet': { persona: 'Логист · Марина Котова', steps: [['click', { role: 'button', name: 'Рабочее место логиста' }]] },
  'confirm-disable-logistics': {                       // эталон — UI-шаги 02 §5.5; реализация до WS-20 — шов (allowlist D-26)
    reference: [['menu', 'Модули и место'], ['click', { role: 'button', name: 'Подключить' }], ['click', { role: 'button', name: 'Подключить' }],
                ['click', { role: 'button', name: 'Отключить' }]],
    implementation: [['preset', 'logistics-ready'], ['evaluate', 'openConfirm', 'DISABLE_LOGISTICS']] },
};
```

Пресеты, используемые как предусловия (WS-06): `logistics-ready`, `trial-ended`, `storage-full`; состояние «модуль отключён с историей» пресета не имеет — через `window.__ortus.run('mod', a => a.setModule('logistics', false))` после `logistics-ready` (эквивалент UI-шага «Отключить модуль»).

### 6.2 (б) Unit (Vitest, `src/**/__tests__`, имена на русском из источника)

| Единица | Табличные кейсы (вход → ожидание) |
|---|---|
| `routes.ts` `pageToPath` | `(owner, t-alta, home)` → `/t/t-alta/home`; `(operator, t-lotos, tenants)` → `/platform/tenants`; `(owner@t-lotos → owner, t-lotos, spa)` → `/t/t-lotos/spa`; `planned` → `throw` (D-24) |
| `routes.ts` `parsePath` | `/t/t-lotos/spa` → `{kind:'tenant', tenantId:'t-lotos', page:'spa'}`; `/platform/plans` → `{kind:'platform', page:'plans'}`; `/t/t-alta/nope` → `null`; `/` → `null` |
| `resolveBoot(search, url)` | `?persona=driver` → `{persona:'driver', org:'t-alta'}`; `/t/t-lotos/today` + persona driver → редирект `/t/t-alta/today` (`midOf` undefined); `/platform/usage` → `operator`, org сохранён |
| `personaValue(persona, org)` (`:2833`) | `owner/t-alta` → `owner`; `owner/t-lotos` → `owner@t-lotos`; `operator/t-lotos` → `operator` |
| `parsePersona(val, currentOrg)` (`:2465–2467`) | `owner@t-lotos` → `[owner, t-lotos]`; `driver` при `t-lotos` → `t-alta`; `operator` при `t-lotos` → `t-lotos` |
| `frameVars(frame)` (`:2840–2841`) | `auto` → `{pad:'0', w:'100%', border:'0', radius:'0', shadow:'none'}`; `390` → `{pad:'16px', w:'390px', border:'1px solid #C9D1C7', radius:'22px', shadow:'0 12px 32px rgba(28,42,38,.16)'}`; `768`/`1440` → radius `12px` |
| `shellVM.top` (`:3029–3040`) × 8 персонажей | `sub` «пространство бизнеса»/«управление платформой»; `tenant` «Альта Групп»/«SPA «Лотос»»/«Управление платформой»; `hasBell` false только у operator; `initials` «ДЗ», «МК», «ИВ», «АМ», «АС», «ОП», «ИБ», «АМ»; `scope` 5 текстов 01 §10.2 + `scopeLabel` менеджера после назначения «Москва / Север Логистик»; `scopeOptions.length` 16 (owner) / 4 (owner@t-lotos) / 1 (прочие); `brandName/letter` «ортус»/«о», «Лотос»/«Л» |
| `shellVM.profile` × 8 | таблица 01 §10.4 (`name`, `title`, `linesTitle`, `lines`) дословно |
| `shellVM.notif` | `events: []` → `empty: true`; 13 событий → 12 пунктов; `seen` → `dot: 'transparent'`; `bellLabel` «Уведомления» / «Уведомления: 1 новых»; operator → `[]` |
| `shellVM.bottomItems` | owner → «Главная», «Модули», «Люди», «Ещё»; driver → «Сегодня», «Автомобили», «База знаний», «Ещё»; manager → «Главная», «Логист», «Ещё»; operator → «Организации», «Использование», «Заявки на тариф»[1], «Ещё»; `planned` пункты не считаются |
| `guideVM(prog)` (`:2903–2931`) | `{}` → шаг 1 `current`; `{driver:true}` → шаг 3 `done` («✓»), шаг 1 `current`; все 8 `done` → текущего нет; тексты 8 + 7 дословно |
| `modalVM(confirm)` (`:3960–3966`) | `busy` → `confirmLabel` «Выполняем…», `disabled`; `needAck && !ack` → `disabled`; `tone: danger` → `btn '#A13A33'`; без `icon` → `help`; `items[].fg` по `TONE` |
| `useRun` (renderHook, фейк-адаптер, QueryClient без retry) | успех → `setQueryData(['db',…], r.db)`, тост `okText` ok, `busy` → `null`; `ApiError('offline', 'Нет связи с сервером. Операция не выполнена.')` → тост warn, `db = e.db`; `code ∈ quiet` → ни тоста, ни патча, исключение проброшено; `e.message` пуст → «Ошибка» |
| `useToast` (fake timers) | показан → через 4199 мс виден, через 4200 скрыт; второй тост сбрасывает таймер; `tone: error` → `role="alert"` |
| `demoStore` reducer | `INITIAL()` поля `:2365–2379`; `setPersona('driver')` → `pages` не меняется, `prog.driver = true`; `reset()` сохраняет `frame`, сбрасывает `prog`, `seen`, `ownerScope='all'`; `mark` идемпотентен |
| `pages.registry` | карта `{'../routes/company/modules.page.tsx': …}` → `resolvePage('modules')` lazy; `resolvePage('home')` без модуля → `PageStub` |
| `applyBrand` | `#7A3E79` → `--ox-accent #7A3E79`, `--ox-accent-hover #643363`, `--ox-accent-soft #ECE4EC`, `--ox-accent-tint #F6F1F6` (01 §17.1); `null` → `#1F6B52`; повтор того же акцента не трогает `style` |

### 6.3 (в) Компонентные (Testing Library + jest-axe; размеры/цвета — только в Playwright, 12 §5 п.21)

| Компонент | Состояния | Клавиатура | axe |
|---|---|---|---|
| `DemoPanel` | 9 элементов 01 §5 по ролям; `select` значения; флажки `checked`; `aria-expanded` у «Путь проверки» | `Space` на флажке → `onChange` | ✓ |
| `Guide` | 8 `li` + «Перейти», 7 негативных, кружки `✓/N` | `Escape` → `onClose` | ✓ |
| `Header` | светлая/тёмная (`data-persona-kind="operator"`), логотип/знак/буква, `select` «Область просмотра» только у owner, пилюля «Нет связи», бейдж `bellCount` | `Enter` на «Профиль» → `aria-expanded="true"`; `Escape` закрывает | ✓ |
| `Sidebar` / `BottomNav` / `Sheet` | группы/пункты/бейджи/«план» не рендерится; `aria-current`; `title`; sr-only `<span>` | `Enter`/`Space` → `onSelect(id)` | ✓ (два `nav` с разными именами) |
| `Banners` | 5 вариантов текстов из `banners.ts`; `role` по тону; кнопка только при `hasAction` | — | ✓ |
| `Gate` | 4 варианта `gateVM` (reason × persona) → чип/h1/текст/кнопка дословно 01 §12 | `Enter` на кнопке → `go(...)` | ✓ |
| `Toast` | 4 тона → иконка/`role` | — | ✓ |
| `ModalHost` + `Confirm` + `Sheet` | бэкдроп, `aria-modal`, `#dlg-title`, `ack`, `busy`, зарегистрированный `kind` из `registry` | `Escape`; `Tab` ловушка (sentinels `data-a11y-extra`) ; возврат фокуса | ✓ |
| `Skeleton` / `LoadError` / `PageStub` / `PageFrame` / `SkipLink` / `DemoOnly` | тексты; `data-screen-label`; `DemoOnly` при `VITE_ADAPTER=http` рендерит `null` (`vi.stubEnv`) | — | ✓ |

### 6.4 (г) Экранные (роутер в памяти + `QueryClient` без retry + `createMockAdapter({delays: 0})`, D-39)

1. 8 персонажей → стартовая страница и `aria-current` (матрица §4.9: owner `home`, driver гейт `today`, foreman гейт `repair`, operator `tenants` …).
2. `applyPreset('logistics-ready')` → группа «Логистика» у owner; manager без роли → гейт «Нет роли с доступом к модулю «Логистика»».
3. `setFlag('online', false)` → пилюля, баннер «Нет связи.», тост warn; `online` → баннер скрыт; `outbox` с `sending` → «Связь восстановлена.».
4. `trial-ended` → «Пробный период завершён.»; `storage-full` → `alert` «Место организации заполнено.» (на `modules` без кнопки).
5. `adapter.load` отклонён → «Не удалось загрузить модули прототипа: …».
6. `tokens.css` подключён: `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent')` непуст (§4.3 мастер-плана; в jsdom — через импорт CSS-модуля и проверку наличия правила, окончательно — e2e S-31).
7. Контрактный (не DOM): каждая зарегистрированная страница-заглушка имеет `data-screen-label` из `texts/screen-labels.ts` (24 ключа), `tenants` → «Оператор · организации» (D-37).

## 7. Шаги реализации (TDD-циклы, порядок выполнения)

Коммиты: `test(shell): …` → `feat(shell): …` → `refactor(shell): …`; один цикл — одна единица; красный тест падает по утверждению, не по импорту (стабы WS-04). Оценка — часы агента (L ≈ 4–6 сессий по ~6 ч).

| # | Единица | Красный тест | Реализация (green) | Рефакторинг | Оценка |
|---|---|---|---|---|---|
| 1 | E2E-скелет | 112 `test.fixme` в 5 spec'ах (§6.1); `pnpm e2e --grep shell --list` показывает их | — | — | 1 ч |
| 2 | Каркас приложения | `index.html` `<title>`; экранный тест §6.4 п.6 (`--ox-accent`); smoke `pnpm e2e --grep @smoke` (WS-07) видит `#app` | `index.html`, `vite.config.ts`, `main.tsx`, `providers.tsx`, `adapter.ts` (`mock` → `createMockAdapter`; `http` → `throw` «подключается интегратором на барьере 2→3») | — | 1,5 ч |
| 3 | Роутер D-25 | unit `routes.test.ts`, `resolveBoot` (§6.2) | `routes.ts`, file-routes (24 + 2 layout + index), редиректы, `?persona=` | `routeTree.gen.ts` в `.gitignore` (WS-01) | 3 ч |
| 4 | Демо-стор и персонажи | unit `demoStore`, `personaValue/parsePersona`; S-02/S-45…S-52 красные по URL | `demoStore.ts`, `useDemo`, `useShell` (`go/setPage/pages[persona]`), `personas.ts` при необходимости | — | 2,5 ч |
| 5 | `useDb`, `useRun`, `useToast` | unit §6.2 (`useRun` 4 кейса, `useToast` таймер) | хуки + `Toast` компонент | — | 2,5 ч |
| 6 | Загрузка и ошибка | экранный §6.4 п.5; компонентные `Skeleton/LoadError`; S-01, S-41 | `Boot/*`, `?boot=fail`, задержки 500/320 мс | — | 1,5 ч |
| 7 | `shellVM` | табличные unit × 8 персонажей (`top`, `profile`, `notif`, `bottomItems`) | `vm/shellVM.ts` (чистая функция `(db, persona, mid, page, state) → vm`) | вынести константы в `texts/shell.ts` | 3 ч |
| 8 | Шапка и поповеры | компонентные `Header`; S-13, S-22–S-24, S-27 | `Header/*`, `aria-expanded`, взаимоисключение `:3038–3039`, `Escape` `:2406–2410` | — | 3 ч |
| 9 | Фрейм и навигация | компонентные `Sidebar/BottomNav`; S-04–S-06, S-08, S-10–S-12, S-44 (Playwright) | `Frame.tsx` (container queries, `useFrameWidth`), `Sidebar`, `BottomNav`, `shell.css`, `mainMax` 680 у водителя | убрать дублирование стилей пункта меню между боковой/листом | 4 ч |
| 10 | `ModalHost` + `Sheet` + реестр | компонентные `ModalHost`; MS-01…MS-18 | `modal/{ModalHost,registry}`, `Sheet.tsx`, бэкдроп `:3957`, `Escape`, фокус-ловушка/возврат (`data-a11y-extra="D-29"`) | **коммит-маркер для WS-14**: `feat(shell): ModalHost slot + useShell — ранний старт WS-14` | 3,5 ч |
| 11 | `Confirm` | unit `modalVM`; MC-01…MC-20 (через `__ortus.openConfirm`) | `modal/Confirm.tsx` на `ConfirmDialog` WS-12 (или fallback), `busy` → «Выполняем…» | после слияния WS-12 — замена fallback | 3 ч |
| 12 | Баннеры и гейт | компонентные `Banners/Gate`; экранные §6.4 п.2–4; S-14–S-17, S-19–S-21 | `Banners.tsx`, `Gate.tsx` из `bannersVM/gateVM` (WS-05) + тексты WS-08; слот оборачивает страницу (`:2862`) | — | 3 ч |
| 13 | Офлайн и очередь | экранный §6.4 п.3; S-18, S-30 | `useOnline` (флажок + `window.online/offline`), `useOutbox` + `flush` (`:2553–2577`), пилюля в шапке | — | 2 ч |
| 14 | Демо-панель, `DemoOnly`, шов | компонентные `DemoPanel/DemoOnly`; DP-01…DP-12 | `DemoPanel.tsx`, `DemoOnly.tsx`, `testSeam.ts` (`window.__ortus`, `?preset=`), сброс одноразовых флагов по событию адаптера | — | 3 ч |
| 15 | Гид | unit `guideVM`; компонентные `Guide`; G-01…G-10, S-28, S-29 | `Guide.tsx`, `mark()` в `setPersona('driver')` и из `__ortus.run` по ключам `logistics/assigned/...` (`:2686`, `:2759`, `:2588` …) | — | 2 ч |
| 16 | Оформление и «Лотос» | unit `applyBrand`; S-31–S-33 | `applyBrand` на `documentElement.style` при каждом рендере шапки, `brandNav` в навигации | — | 1,5 ч |
| 17 | `PageFrame`, заглушки, реестр | unit `pages.registry`; экранный §6.4 п.7; S-14 (`h1` «Модули и место»), S-21 (`h1` «Сегодня») | `PageFrame.tsx`, `PageStub.tsx`, `pages.registry.ts` (glob), `data-screen-label` | — | 2 ч |
| 18 | A11y-добавки D-29 | S-38, S-42; компонентный `SkipLink` | skip-link «К содержимому», landmarks (`banner`, `navigation`, `main`, `contentinfo` не добавлять — нет в прототипе), `data-a11y-extra` | проверить нулевой пиксельный след снимком | 1 ч |
| 19 | Снятие `fixme` | по одному пункту: `test(shell): снять fixme S-NN` → зелёный на `mobile-390` и `desktop-1440` (S-05, MS-10 также `tablet-768`) | правки по месту | — | 4 ч |
| 20 | Визуальная сверка и labels | `shell.visual.spec.ts` 8 × 3, `modal-confirm.visual`, `modal-sheet.visual`, 3 `labels.spec` | рецепты `e2e/recipes/shell.ts`, allowlist с D-ID | — | 4 ч |
| 21 | MCP-проходка и отчёт | §8 для трёх ключей | evidence, `docs/plan/reports/WS-10.md`, строка `status.md` | — | 3 ч |

Порядок зависимостей: 2 → 3 → 4 → 5 → 6 → 7 → 8/9 (параллельно) → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21. Единицы 11–12 выполняются после ребейза на слитый WS-12, если он слит к их началу (§4.2).

## 8. Проверка страницы

Общее: эталон `http://127.0.0.1:4173/Ортус%20CRM.dc.html` (`node tools/design-preview.js design 4173 --offline`), реализация `http://localhost:5183` (исполнитель) / `6026–6028` (проверяющие). Снимок по D-45: viewport = проект, на эталоне «Ширина» = «По окну», `page.clock.install({time:'2026-10-01T10:30:00+03:00'})` до загрузки, панель `[aria-label="Панель демонстрации"]` скрыта, область `#dc-root` ↔ `#app`, порог `maxDiffPixelRatio: 0.01`. Структурная сверка: `collectLabels(root, {exclude: '#ox-main > div > section'})` на обеих целях (содержимое страниц — не предмет оболочки; у заглушки и у эталона корень страницы — `section[aria-labelledby]`, `:206`, `:657`, `:1523`, `:1815`, `:1994`, `:2039`). MCP: `.mcp.json` WS-07, инструменты `mcp__playwright__browser_*` через `ToolSearch`, `--output-dir .playwright-mcp/5183`.

Раскладка evidence (`00-master-plan.md` §4.8, D-52):

```text
docs/plan/evidence/shell/            390.png 768.png 1440.png reference-390.png reference-1440.png
                                     snapshot.txt (дерево доступности owner/1440 + operator/1440 + driver/390)
                                     console.txt network.txt
                                     states/offline-390.png states/gate-driver-390.png states/popover-notif-1440.png states/guide-1440.png
docs/plan/evidence/modal-confirm/    390.png 768.png 1440.png reference-390.png reference-1440.png snapshot.txt console.txt network.txt
                                     states/ack-checked-1440.png states/busy-1440.png states/offline-error-390.png
docs/plan/evidence/modal-sheet/      390.png 768.png 1440.png reference-390.png snapshot.txt console.txt network.txt
                                     states/driver-390.png states/operator-390.png
docs/plan/evidence/<key>/verify/     — заполняет независимый проверяющий (не исполнитель)
```

### 8.1 `shell`

- **E2E:** `pnpm e2e -- --project=mobile-390 --project=desktop-1440 --grep "shell|demo-panel|guide"`; дополнительно `--project=tablet-768 --grep "Ширина 768|на 768 и 1440"`.
- **Эталон:** `<select>` «Персонаж» → подпись (8 вариантов), «Ширина» = «По окну», стартовая страница по `DEFAULT_PAGE` без переходов (рецепт `base(persona)`); поповеры — рецепты `popover-notif` (клик `button` «Уведомления»), `popover-profile` (клик «Профиль»); `offline` (флажок «Нет связи»); гейты — `base(driver)`, `base(foreman)`, `base(manager)` → «Рабочее место логиста»; гид — клик «Путь проверки». Состояния `trial-ended`/`storage-full`/«Модуль отключён» на эталоне — UI-шаги WS-20 (§2.4 мастер-плана); в реализации волны 1 — пресет/шов → запись allowlist `kind: state · mode: mock · decision: D-26 · owner: WS-10`, перепроверка интегратором после слияния WS-20.
- **Реализация:** `/t/t-alta/home` (`?persona=owner`), `/t/t-alta/home?persona=manager`, `/t/t-alta/today?persona=driver`, `/t/t-alta/spa?persona=therapist`, `/t/t-alta/repair?persona=foreman`, `/platform/tenants?persona=operator`, `/t/t-lotos/home?persona=owner@t-lotos`, `/t/t-lotos/spa?persona=therapist@t-lotos`.
- **Визуальная сверка (`shell.visual.spec.ts`):** 8 персонажей × {390, 768, 1440} = 24 снимка `#app` с `mask: [page.locator('#ox-main > div > section')]` (страницы — волна 2; гейты driver/foreman и операторская `tenants`-заглушка маскируются одинаково); плюс области: `header` (8 × 3), `nav[aria-label="Основная навигация"]` (owner, operator × 768, 1440), `nav[aria-label="Навигация"]` (owner, driver, operator × 390), `dialog` «Уведомления» и «Профиль» (owner, driver × 1440), `dialog` «Путь проверки» (390, 1440), баннер «Нет связи.» + пилюля (owner × 390, 1440), гейты driver/foreman/manager (390, 1440), скелетон (snapshot в момент `status` «Загрузка» на обеих целях — `page.clock` + задержка 500 мс). `labels.spec`: 8 персонажей × 390/1440 с исключением секции страницы.
- **MCP-проходка (evidence `docs/plan/evidence/shell/`):**
  1. `browser_navigate` `http://localhost:5183/` → `browser_snapshot`: `region` «Панель демонстрации», `banner`-landmark с «ортус», «пространство бизнеса», «Альта Групп», `combobox` «Область просмотра», `button` «Уведомления», `button` «Профиль», `navigation` «Основная навигация» с группами S-08, `main` с «Главная» (заглушка), подвал «Данные других организаций изолированы». Сверить с 01 §3 (позиции 1, 4–7, 11, 13).
  2. Клик «Уведомления» → `dialog` «Уведомления», «Новых событий нет», «Прочитать все»; клик «Профиль» → первый закрыт, `dialog` «Профиль»: «Дарья Зимина», «Владелец · d.zimina@alta.example», «Назначения», «Владелец бизнеса · Вся организация», «Выйти · недоступно в демо» (disabled); `Escape`.
  3. «Путь проверки» → `dialog` с 8 шагами и 7 негативными; «Перейти» у шага 3 → персонаж `driver`, URL `/t/t-alta/today`, AccessGate: «Модуль не подключён», `heading` «Логистика» не подключена организацией, `button` «Демо: открыть как владелец» → владелец, `/t/t-alta/modules`, `heading` «Модули и место».
  4. Негативные: флажок «Нет связи» → тост «Нет связи. Черновики сохраняются на устройстве», пилюля «Нет связи», баннер «Нет связи.»; снять флажок → исчезли. `select` «Персонаж» → «Оператор платформы» → тёмная шапка, «Управление платформой», нет «Уведомления», меню из 5 пунктов, бейдж «1» у «Заявки на тариф». → «Владелец · Ирина Белова» → «Лотос», «SPA «Лотос»», сливовый акцент, 4 опции области. → «Сбросить» → владелец «Альты».
  5. `browser_resize` 390×844 → `navigation` «Навигация» («Главная», «Модули», «Люди», «Ещё»), боковой нет, в шапке нет «ортус»; «Ещё» → «Все разделы» → «Закрыть». `browser_resize` 768×1024 → рейл 68 px, подписи только в `title`/sr-only. `browser_resize` 1440×900.
  6. `browser_console_messages` — без ошибок/предупреждений React; `browser_network_requests` — только `localhost:5183` (нет `unpkg`, `fonts.googleapis`, `fonts.gstatic`, `/api`).
  7. `browser_take_screenshot` → `390.png`, `768.png`, `1440.png`; эталон с 4173 теми же шагами → `reference-390.png`, `reference-1440.png`; `snapshot.txt`, `console.txt`, `network.txt`.

### 8.2 `modal-confirm`

- **E2E:** `pnpm e2e -- --project=mobile-390 --project=desktop-1440 --grep modal-confirm`.
- **Эталон:** «Владелец · Дарья Зимина» → «Модули и место» → карточка «Логистика» → «Подключить» → диалог «Подключить «Логистика»?» → «Подключить» → тост → у «Логистика» «Отключить» → открыт «Отключить «Логистика»?» (рецепт `confirm-disable-logistics`, UI-шаги 02 §5.5); для варианта `ok` — остановиться на «Подключить «Логистика»?»; для `warn` — «Демо: завершить пробный период».
- **Реализация (волна 1):** `/t/t-alta/modules` → `page.evaluate(() => window.__ortus.applyPreset('logistics-ready'))` → `page.evaluate(spec => window.__ortus.openConfirm(spec), DISABLE_LOGISTICS)`; `DISABLE_LOGISTICS` дословно из `:2694–2707` (`e2e/recipes/shell.ts`). Allowlist: `- kind: state · target: открытие через window.__ortus.openConfirm · mode: mock · reason: страница «Модули и место» реализуется в WS-20 (волна 2); спецификация диалога перенесена дословно из :2694–2707 · decision: D-26 · owner: WS-10`. После слияния WS-20 интегратор заменяет шов на UI-шаги (строка allowlist удаляется).
- **Визуальная сверка:** `#app` целиком на 390 и 1440 с `mask` на `#ox-main > div > section` (под бэкдропом — страница WS-20) для `danger` (ack снят / ack отмечен), `ok` («Подключить «Логистика»?»), `warn`; область `[role=dialog][aria-modal=true]` без маски — 4 варианта × 2 ширины. `labels.spec` — внутри диалога: «Отключить «Логистика»?», «Затронет сейчас», «Что произойдёт», `label` «Понимаю последствия для текущей работы», «Отмена», «Отключить модуль».
- **MCP-проходка (evidence `docs/plan/evidence/modal-confirm/`):** navigate `/t/t-alta/modules` → `browser_evaluate` пресет + `openConfirm(DISABLE_LOGISTICS)` → `browser_snapshot`: `dialog` «Отключить «Логистика»?» (`modal`), `heading` level 2, текст «Данные не удаляются. Модуль перейдёт в режим чтения истории.», список «Затронет сейчас» (2 пункта), «Что произойдёт» (3 пункта), `checkbox` «Понимаю последствия для текущей работы», `button` «Отмена», `button` «Отключить модуль» disabled → клик по чекбоксу → enabled → «Отключить модуль» → диалог закрыт, тост «Модуль отключён. История доступна для чтения» → повторно открыть, флажок «Нет связи» → «Отключить модуль» → тост «Нет связи с сервером. Операция не выполнена.», диалог открыт → `Escape` → закрыт. `browser_resize` 390 → лист снизу с радиусом сверху; 768; 1440. Консоль/сеть как в 8.1. Снимки `390.png`, `768.png`, `1440.png`, `reference-390.png`, `reference-1440.png` (эталон — UI-шаги).

### 8.3 `modal-sheet`

- **E2E:** `pnpm e2e -- --project=mobile-390 --grep modal-sheet` (+ `--project=tablet-768 --project=desktop-1440 --grep "на 768 и 1440"`).
- **Эталон:** «Владелец · Дарья Зимина» (и «Водитель · Илья Васильев», «Оператор платформы») → viewport 390 (проект `mobile-390`, «Ширина» = «По окну») → `button` «Ещё» (рецепт `sheet-open`).
- **Реализация:** `/t/t-alta/home` (390) → «Ещё»; `/t/t-alta/today?persona=driver` → «Ещё»; `/platform/tenants?persona=operator` → «Ещё».
- **Визуальная сверка:** `#app` на 390 (owner, driver, operator) с `mask` на `#ox-main > div > section`; область `[role=dialog][aria-modal=true]` без маски. `labels.spec`: «Все разделы», «Закрыть», заголовки групп и 14 пунктов владельца по порядку.
- **MCP-проходка (evidence `docs/plan/evidence/modal-sheet/`):** navigate `/t/t-alta/home` → `browser_resize` 390×844 → `browser_snapshot`: `navigation` «Навигация» 4 кнопки → «Ещё» → `dialog` «Все разделы» с заголовками «Обзор», «Компания», «Ремонт и стройка», «Отрасли», «Общие модули» и 14 кнопками, «Главная» `current`, `button` «Закрыть» → клик «Оформление» → лист закрыт, URL `/t/t-alta/branding`, `heading` «Оформление» → «Ещё» → `Escape` → закрыт → `browser_resize` 768×1024: «Ещё» отсутствует → 1440×900. Консоль/сеть. Снимки `390.png` (лист открыт), `768.png`, `1440.png`, `reference-390.png`.

## 9. Критерии готовности (DoD)

- [ ] Первый коммит ветки — e2e-скелет 112 `test.fixme` (12 §5 п.12); порядок коммитов `test(` → `feat(` → `refactor(` по каждой единице §7 (ревьюер проверяет `git log`).
- [ ] `shell.spec.ts` 49/52 зелёных на `mobile-390` и `desktop-1440` (S-05 и S-44 ещё на `tablet-768`); S-34–S-36 — `test.fixme` со ссылкой на Q-121 (§10); `demo-panel.spec.ts` 12/12, `guide.spec.ts` 10/10, `modal-confirm.spec.ts` 20/20, `modal-sheet.spec.ts` 18/18. Без `waitForTimeout`, без ретраев для «гашения» (`tdd-protocol.md` §3, `verification-protocol.md` §1.4).
- [ ] Unit §6.2 и компонентные §6.3 зелёные; axe на каждый компонент §6.3; экранные §6.4 зелёные с `delays: 0`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` — без ошибок; `tools/check-icu.js` зелёный; в `src/**` нет литералов цвета (`#[0-9A-F]{6}`, `rgb(`) вне `shell.css`-алиасов токенов — grep-проверка в отчёте (12 §5 п.17, D-28).
- [ ] Визуальная сверка `shell` 24 снимка + области, `modal-confirm` 8 + 4, `modal-sheet` 3 + 3 — в допуске 0,01 или в `allowlist/<key>.md` с `decision: D-26|D-27|D-29` (`tools/allowlist-lint.js` зелёный); `labels.spec` трёх ключей без расхождений; невидимые добавки (skip-link, sentinels) имеют нулевой пиксельный след (D-29).
- [ ] `docs/plan/evidence/{shell,modal-confirm,modal-sheet}/` содержат `390.png`, `768.png`, `1440.png`, `reference-390.png`, `reference-1440.png`, `snapshot.txt`, `console.txt` (без ошибок), `network.txt` (только `localhost`), по §8.
- [ ] Контракты C-1…C-10 реализованы и описаны в `docs/plan/reports/WS-10.md` «Контракты, которые я опубликовал»; коммит-маркер `ModalHost slot + useShell` отправлен интегратору для старта WS-14 (§6.4 мастер-плана) в первые два дня.
- [ ] 24 заглушки резолвятся по glob; `data-screen-label` для всех 24 ключей (D-37); `planned` недостижим (D-24).
- [ ] `VITE_ADAPTER=http` сборка: `DemoOnly` ничего не рендерит, `window.__ortus` отсутствует (unit с `vi.stubEnv`).
- [ ] Отчёт по `orchestration.md` §5 с дословным выводом `pnpm test` и `pnpm e2e` (последние 40 строк), таблицей тестов red → green, разделом «Проверка MCP», списком `fixme` (ровно S-34–S-36 с Q-121); строка WS-10 в `status.md` → «готово».
- [ ] Ревью `approve` (1 ревьюер) и вердикты `accept` трёх проверяющих (`shell`, `modal-confirm`, `modal-sheet`); если MCP недоступен — WS не закрывается, блокер интегратору (12 §5 п.27).

## 10. Риски, расхождения прототипа с документами, открытые вопросы

| # | Риск / расхождение | По умолчанию делаем |
|---|---|---|
| R-1 | Пункты 01 §20 #9, #19–#22, #34–#36 требуют страниц «Модули и место»/«Пользователи и роли» (WS-20, волна 2) и диалогов WS-14 | #9, #19–#22 — предусловие через пресет/шов (D-26), проверка оболочки; #34–#36 — `test.fixme` с **Q-121** («пункты 01 §20 #34–36 закрываются spec'ами WS-14/WS-20; маркер в `shell.spec.ts` снимает интегратор волны 2») — внести в `decisions.md` через интегратора волны 1; барьер 1→2 «38/38» читается как «35/38 + 3 с Q-121» |
| R-2 | «Один DOM» (12 §5 п.18) vs условный рендер прототипа (`sc-if mobile/notMobile`, `:149`, `:2192`): оба `nav` в DOM, один скрыт `display:none` под container query | `collectLabels` должен игнорировать невидимые элементы (`checkVisibility()`); если фикстура WS-07 этого не делает — блокер интегратору до снятия `labels`-тестов; axe не видит `display:none` |
| R-3 | Контейнер-запросы: `W` фрейма ≠ ширина окна при «Ширина» ≠ «По окну» на эталоне | снимки только при «По окну» (D-45); `useFrameWidth` для числовых `listMax` страниц; на 390-проекте фрейм = 390 px |
| R-4 | Литералы акцента `:root` `#185A44/#E3EFE7/#F1F7F3` vs формула `brandVars` `#195843/#E0EAE7/#EFF5F3` (01 §21 Q2) | как рендерит CRM после `applyBrand` — формула (D-28); S-31 проверяет `--ox-accent`, производные — unit `applyBrand` |
| R-5 | Фокус-ловушка, возврат фокуса, skip-link — в прототипе нет (01 §21 Q3–Q4, 08 §10 п.17) | реализуются невидимо с `data-a11y-extra="D-29"`; клик вне поповера их **не** закрывает (как в прототипе, 01 §16.3) |
| R-6 | Иконки шапки 40/36 px < 44 px из `verification-protocol.md` §1.3 | как нарисовано (D-28, 01 §19 п.14); S-44 фиксирует 40/36 явно |
| R-7 | `pages`/`seen` по персонажу (Q-35), оператор «в Лотосе» (Q-37), `navigator.onLine` снимает галочку (Q-38) | как в прототипе; в `labels`/visual не влияет |
| R-8 | `DemoOnly` в http-сборке (D-44): без панели персонаж берётся из `/me/context` (WS-40/51) | `adapter.ts` при `http` бросает понятную ошибку до барьера 2→3; `SessionProvider` — WS-51/интегратор |
| R-9 | Стабы `@ortus/ui` до слияния WS-12 | порядок §7 откладывает `Confirm`/баннеры/гейт; при необходимости fallback-разметка на токенах с последующим `refactor(shell)` |
| R-10 | Прототип не задаёт `h1` заглушек; `h1` реальных страниц могут отличаться от подписи меню | заглушка = подпись меню; S-14/S-21 проверяют только «Модули и место»/«Сегодня»; страницы волны 2 заменяют заглушку целиком |
| R-11 | Поиск в шапке и URL-состояние таблиц (08 §10 Q5–Q6, Q-39) | не рисуем; search-параметры страниц — техническая необходимость, в снимке невидимы |
| R-12 | `mark('expense'/'submitted')` через `flush` (`:2564`, `:2568`) — очередь принадлежит WS-23 | `useOutbox.flush` вызывает `mark(item.kind === 'expense' ? 'expense' : 'submitted')` по `kind` элемента — контракт C-8 |

Открытые вопросы (поведение до решения — как в прототипе): Q-35, Q-36, Q-37, Q-38, Q-39, Q-40, Q-43, Q-44 (`decisions.md`); новый Q-121 (R-1). Любое иное отклонение — только через `decisions.md`.

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-10 (shell) волны 1 проекта «Ортус CRM». Прочитай полностью `docs/plan/ws/WS-10-shell.md`, затем все входы его §3: `docs/plan/analysis/01-shell.md` §3–§14, §16–§22, `04-platform.md` §4.3–4.6, `11-design-system-and-docs-site.md` §4.18, `08-requirements.md` §10 Q4–Q6, `12-prior-project-and-skills.md` §5 п.18, `docs/plan/00-master-plan.md` §4.7–4.9, §6.4, §7.3–7.4, §8, §10.3 (D-25, D-26, D-27, D-28, D-29, D-37, D-39, D-44, D-45, D-50) и протоколы `tdd-protocol.md`, `verification-protocol.md`, `orchestration.md` — соблюдай их буквально. Эталон `design/` неприкосновенен; превью `node tools/design-preview.js design 4173 --offline`.

Работай в worktree `..\ortus-ws-10` на ветке `ws/ws-10-shell` от `main` (`pnpm install` там), dev-сервер на `PORT=5183` (`pnpm dev:web -- --mode e2e`). Первый коммит — e2e-скелет из §6.1 брифа: 112 `test.fixme` в `shell.spec.ts` (52), `demo-panel.spec.ts` (12), `guide.spec.ts` (10), `modal-confirm.spec.ts` (20), `modal-sheet.spec.ts` (18); имена тестов — дословно из брифа. Далее циклы §7 в указанном порядке: красный тест (падает по утверждению) → минимальная реализация → рефакторинг; коммиты `test(shell)` → `feat(shell)` → `refactor(shell)`. В первые два дня закоммить слот `ModalHost` + `useShell` (единица 10) и сообщи интегратору — его ждёт WS-14. Не трогай файлы вне §2; пробелы контрактов WS-04…WS-08 — блокер интегратору, не локальная правка. Все подписи — только из `@ortus/texts` (добавлять можно лишь в `texts/shell.ts`); цвета — только токены.

Перед завершением выполни §8 брифа для `shell`, `modal-confirm`, `modal-sheet`: e2e на `mobile-390`/`desktop-1440`, визуальная и структурная сверка с 4173, проходка Playwright MCP (`mcp__playwright__*` через ToolSearch) с evidence в `docs/plan/evidence/<key>/`. Напиши `docs/plan/reports/WS-10.md` по `orchestration.md` §5 с дословным выводом прогонов, обнови свою строку в `docs/plan/status.md`. Верни: `ws`, `branch`, `reportPath`, `done`, `pagesDelivered` (`shell`, `modal-confirm`, `modal-sheet`), `fixmeLeft` (ожидается ровно S-34–S-36 с Q-121), `contractsChanged`, `testRunsOk`. Если заблокирован (MCP недоступен, нет `gateVM`/`bannersVM`, `collectLabels` без `exclude`) — опиши блокер в отчёте и не обходи его.
