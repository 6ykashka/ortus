# WS-07 · Playwright-харнесс, рецепты эталона, генератор e2e-скелетов, verify-pages, офлайн-эталон, MCP, Go-харнесс

Волна 0 · Размер M (2–3 сессии) · Вид infra · Зависит от: WS-01 (repo-skeleton), WS-00 (исправленные чек-листы — только для генерации скелетов) · Блокирует: WS-10…WS-32 (все UI-WS), WS-40, WS-41 (Go-харнесс), WS-11 (конфиг читалки), WS-53 (`E2E_MODE=stand`) · Ревью: 1 (фундамент FE) · `args.ws`: `{ "id": "WS-07", "slug": "e2e-harness-mcp", "pages": [], "reviewers": 1 }` (00-master-plan §7.2).

Условные ссылки как в `00-master-plan.md` §0.1: «12 §6 п.4» = `docs/plan/analysis/12-prior-project-and-skills.md`, раздел 6, пункт 4; «`:29`» = строка `design/Ортус CRM.dc.html`; «`support.js:158`» = `design/support.js`; «МП §2.3» = `docs/plan/00-master-plan.md` §2.3.

## 1. Цель

После WS-07 любой страничный WS получает один и тот же механизм «точно как нарисовано»: фикстура `reference` открывает эталон на `127.0.0.1:4173` **офлайн** и реализацию на `127.0.0.1:${PORT}` одним и тем же рецептом UI-шагов (персонаж по подписи `<select>` «Персонаж», переход по подписи меню, флажки «Нет связи»/«Конфликт брони»/«Сбой загрузки фото»), с одинаковыми часами `2026-10-01T10:30:00+03:00`, локалью `ru-RU` и viewport проекта, снимает `#dc-root` и `#app` и сравнивает с порогом `maxDiffPixelRatio: 0.01` (D-22, D-45) плюс структурную сверку `collectLabels()` (12 §6 п.9).

Генератор `tools/e2e-skeleton.js` превращает «Чек-лист приёмки» отчёта в `e2e/<key>.spec.ts` из `test.fixme` (первый коммит каждого страничного WS, `tdd-protocol.md` §2 шаг 1); Stop-хук `tools/verify-pages.js` не даёт закрыть сессию без свежего `docs/plan/evidence/<key>/`; `.mcp.json` даёт каждому агенту свой Playwright MCP; `backend/test/harness.go` даёт Go-тестам БД, миграции и фиксированные часы.

## 2. Границы файлов

### 2.1 Создаёт (владеет; никто другой в волне 0 сюда не пишет)

| Путь | Что |
|---|---|
| `frontend/packages/e2e-kit/{package.json,tsconfig.json,README.md,src/**,test/**}` | пакет `@ortus/e2e-kit`: `persona.ts`, `demo-panel.ts`, `reference.ts`, `app.ts`, `clock.ts`, `axe.ts`, `labels.ts`, `recipes.ts`, `compare.ts`, `allowlist.ts`, `page-keys.ts`, `index.ts` |
| `frontend/apps/web/playwright.config.ts` | 3 проекта, `webServer[0]` dev, `webServer[1]` эталон `--offline` |
| `frontend/apps/web/e2e/fixtures/{index.ts,demo.ts,reference.ts,app.ts,axe.ts,clock.ts,net.ts}` | `test = base.extend<…>` |
| `frontend/apps/web/e2e/recipes/_base/{index.ts,base.ts,logistics-ready.ts,flags.ts,lotos.ts}` | базовые рецепты МП §2.4 с владельцем WS-07 |
| `frontend/apps/web/e2e/visual/_helpers/{match-reference.ts,labels.ts,allowlist.ts,png.ts}` | хелперы визуальной/структурной сверки |
| `frontend/apps/web/e2e/smoke/{harness.spec.ts,app.spec.ts}` | самопроверка харнесса (`@harness`) и `@smoke` |
| `frontend/apps/web/e2e/_tools/labels-dump.spec.ts` | исполнитель `labels-dump` (вне обычного прогона через `testIgnore`) |
| `frontend/apps/docs/playwright.config.ts`, `frontend/apps/docs/e2e/harness.spec.ts` | 4 проекта читалки; самопроверка офлайн-эталона документации |
| `.mcp.json` | Playwright MCP, пин версии, `--isolated`, `--output-dir .playwright-mcp/${PORT:-5173}` |
| `tools/verify-pages.js`, `tools/e2e-skeleton.js`, `tools/labels-dump.js`, `tools/page-keys.json`, `tools/templates/spec.ts.tmpl`, `tools/__tests__/*.test.js`, `tools/__fixtures__/**` | инструменты + `node --test` |
| `tools/design-preview.js` | флаг `--offline` (поведение без флага не меняется — `tools/README.md:41–50`) |
| `tools/vendor/{react.production.min.js,react-dom.production.min.js,README.md}` | React/ReactDOM UMD 18.3.1 байт-в-байт по SRI из `support.js:1144,1146` |
| `backend/test/{harness.go,harness_test.go,doc.go,testdata/notfound.json}`, `backend/test/testdb/{testdb.go,migrate.go,container.go,testdb_test.go}` | Go-харнесс |
| `docs/plan/evidence/README.md`, `docs/plan/evidence/harness/**` | состав папки evidence; evidence самого харнесса |

Меняет только своей строкой: `docs/plan/status.md` (строка WS-07).

Предлагает интегратору (аддитивно, сам не правит): 4 скрипта в корневой `package.json`, 3 зависимости в `backend/go.mod`, 3 devDependencies в `frontend/package.json`, job `tools-unit` в CI (§4.2).

### 2.2 Запрещено трогать

- `design/**` — эталон (`orchestration.md` §7).
- `.claude/settings.json`, `.github/**`, корневой `package.json`, `pnpm-workspace.yaml`, `backend/go.mod`, `backend/.golangci.yml`, `frontend/package.json` — WS-01.
- `frontend/packages/tokens/**` (включая `fonts/`) — WS-04.
- `frontend/apps/web/{index.html,vite.config.ts,src/**}` — WS-10.
- `frontend/apps/docs/src/**`, `frontend/apps/docs/e2e/<docs-key>.spec.ts` — WS-11.
- `frontend/apps/web/e2e/<key>.spec.ts`, `e2e/recipes/<key>.ts`, `e2e/visual/<key>.*`, `e2e/visual/allowlist/*.md` — владельцы ключей (МП §5.3); генератор создаёт файл **только если его нет**.
- `docs/plan/analysis/**`, `docs/plan/decisions.md` — WS-00.

### 2.3 Worktree и ветка (`orchestration.md` §1; 12 §8 п.16, п.25)

1. Из корня `D:\work\test26042026_Kirill_3.0`: `git worktree add ..\ws-07-e2e-harness-mcp -b ws/ws-07-e2e-harness-mcp main`.
2. В worktree: `pnpm install` (свой `node_modules`), `pnpm e2e:install` (браузер `@playwright/test`), `pnpm mcp:install` (второй браузер для MCP, 12 §8 п.4).
3. `$env:PORT = "5180"` (5173 + 07, МП §7.4); эталон — общий `127.0.0.1:4173`.
4. Коммиты `git commit -F <файл UTF-8 без BOM>` (12 §6 п.22); PowerShell 5.1 — без `&&`.
5. После появления `.mcp.json` перезапустить сессию (12 §8 п.5).

## 3. Входы

| Источник | Что взять |
|---|---|
| `docs/plan/tdd-protocol.md` §3 «Playwright» | один spec на ключ, селекторы по ролям/подписям, проекты `mobile-390`/`tablet-768`/`desktop-1440`, запрет `waitForTimeout`, данные = демо-сид (`Р-208`, `m-kotova`, `t-alta`, `t-lotos`) |
| `docs/plan/verification-protocol.md` §1 п.3 (6 обязательных пунктов), §2 (`dev:web -- --mode e2e`, `e2e:full`), §3 п.1–5 (эталон, `[aria-label="Панель демонстрации"]`, порог, `labels`, allowlist), §4 (шаги MCP 1–7; «если MCP недоступен — блокер»), §6 (Stop-хук `node tools/verify-pages.js`) | контракт самого харнесса |
| 12 §3.2 R1 (`.mcp.json` 2.0, `mcp:install`, `.playwright-mcp/` в `.gitignore`), R2 (`PORT`, `reporter html open:never`, `reuseExistingServer`, `trace on-first-retry`), R3 (порядок `page.route` обратный — только для негативных сценариев), R4 (Go-харнесс: `TestMain → run()`, DSN по умолчанию, «падает, а не skip», миграции лексикографически), R16 (черновик `verify-*`: «если инструментов нет — скажи и остановись») | переносимые решения |
| 12 §6 п.1–16 (чек-лист инфраструктуры — основа `harness.spec.ts` и Go-тестов); 12 §8 п.4–7 (два браузера, перезапуск сессии, порты, `Test<WS>` префикс), п.19–22 (per-platform baseline, `.icon` вместо `textContent`, пороги 640/1080, «сегодня» инъектируется) | формулировки тестов |
| 01 §3 (инвентарь оболочки; `aria-label` панели/навигации/поповеров), 01 §5 (демо-панель: подписи `<select>` «Персонаж»/«Ширина», флажки, `setPersona` → скелетон 320 мс `:2470`, `reset()`), 01 §6 (гид: 8 шагов и 7 негативных дословно), 01 §8.3 (стартовая страница и пункты меню по персонажу), 01 §20 #1–9, #18, #29, #31 (ожидания для самопроверки) | рецепты и `demo`-фикстура |
| 11 §7.1 (как грузится React: `cdnScriptFor` `support.js:1149–1153`, `loadReactUmd` `:1838–1847`, `boot()` `:150–199`), 11 §7.4 (офлайн-вариант), 11 §12 п.9 (390/800/1280/1440), п.18 (`#dc-root .sc-host`, нет `.sc-logic-error`, консоль без `[dc-runtime]`), п.19 (вендорить React, локальные marked/js-yaml/mermaid, `@font-face`) | `--offline` и конфиг читалки |
| 06b §20 п.6 (по одному `test.fixme` на вкладку, 4 снимка «График»), п.7 (drag `mouse.move → down → move → up`, `dayW` от полосы «Демонтаж»), п.8 (`D0 = 2026-10-05`, `TODAY = 15`, `HOL = [30]`, ICU в Node) | требования к `page-keys.json` для `repair-tabs` и к `clock` |
| МП §2.2 (офлайн-эталон), §2.3 (рецепт снимка п.1–6), §2.4 (таблица рецептов: базовые — WS-07), §4.8 (селекторы, ключи, `data-a11y-extra`, формат allowlist, evidence), §4.9 (матрица «Г-*» для генератора), §5.3 (ключ → отчёт → пункты), §7.3–7.4 (цепочка при добавлении страницы, порты), §8.1 (строка infra), §8.2 (6 пунктов + «Г-*» + рецепты в скелете) | спецификация выходов |
| D-22 (порог 1 %), D-26 (рецепты = пресеты; `no-reference`), D-29 (`data-a11y-extra="D-29"` исключается из `collectLabels`), D-32 (`{platform}` в пути, канон Linux), D-45 (рецепт снимка), D-49 (порты, `--isolated`, `E2E_FRESH_SERVER=1`, ≤ 6/≤ 10), D-50 (allowlist файл на ключ, обязательный D-ID, `allowlist-lint`), Q-103 | решения |
| `design/Ортус CRM.dc.html:6` (`<script src="./support.js">`), `:13–15` (три `<link>` Google Fonts), `:29–66` (панель демонстрации), `:2384–2393` (ширина фрейма по `ResizeObserver`), `:2867, 2880, 4159` (`s.w` → `W`, D-27) | точные строки подстановки и ожиданий |
| `design/Документация.dc.html:13–17, :323` (fonts, `marked@12`, `js-yaml@4`, `mermaid@11` через `import()`) | подстановка для читалки |
| `design/support.js:150–199` (`boot`: при отсутствии `__resources` — повторный `fetch(location.href)`), `:1143–1153` (`cdnScriptFor`), `:1838–1847` (`loadReactUmd`: если `window.React && window.ReactDOM` — ничего не грузит) | механика `--offline` |
| `design/docs/14-engineering.md:28–51` (структура), `:83–94` (конвейер CI); `design/docs/15-quality-security.md:19–29` (фикстуры изоляции — WS-42 использует харнесс) | структура и теги |

## 4. Контракты

### 4.1 Публикует (потребляют WS-10…32, WS-11, WS-14, WS-53, WS-55)

#### 4.1.1 `@ortus/e2e-kit` (`frontend/packages/e2e-kit/src/index.ts`; имена заморожены на волны 1–2, расширение только аддитивно через интегратора)

```ts
export type Persona = 'operator'|'owner'|'manager'|'driver'|'therapist'|'foreman'|'owner@t-lotos'|'therapist@t-lotos';
export const PERSONA_LABEL: Record<Persona, string>; // 'owner' → 'Владелец · Дарья Зимина' … (:34–45, 01 §5 п.2)
export const WIDTH_LABEL = { auto: 'По окну', 390: '390 · телефон', 768: '768 · планшет', 1440: '1440 · компьютер' } as const; // :51–54
export const FLAG_LABEL = { offline: 'Нет связи', conflictNext: 'Конфликт брони', failUploadNext: 'Сбой загрузки фото' } as const; // :63–65
export const CLOCK = '2026-10-01T10:30:00+03:00'; // D-45 п.2
export const PANEL = '[aria-label="Панель демонстрации"]';
export interface Target { page: Page; kind: 'reference'|'app'; root: Locator /* #dc-root | #app */ }
export interface RecipeApi {            // одинаково исполняется на обеих целях (D-26)
  setPersona(p: Persona): Promise<void>; // selectOption по value; ждёт появления и исчезновения role=status[aria-label="Загрузка"]
  goMenu(label: string): Promise<void>;  // nav[aria-label="Основная навигация"] при ≥ 640; иначе «Ещё» → лист «Все разделы»
  setFlag(flag: keyof typeof FLAG_LABEL, on: boolean): Promise<void>;
  click(role: 'button'|'tab'|'link'|'radio'|'checkbox', name: string|RegExp): Promise<void>;
  fill(label: string, value: string): Promise<void>;
  select(label: string, option: string): Promise<void>;
  confirm(dialogTitle: string, button: string, ack?: string): Promise<void>; // диалог → (чекбокс ack) → кнопка
  expectToast(text: string|RegExp): Promise<void>;
}
export interface Recipe { name: string; owner: string; steps(api: RecipeApi, t: Target): Promise<void> }
export const RECIPES: Record<string, Recipe>; // base, logistics-ready, offline, conflict-next, fail-upload, lotos — WS-07; остальные регистрируют владельцы (МП §2.4)
export function base(persona: Persona, menuLabel: string): Recipe;
export function openReference(browser: Browser, o: { persona: Persona; page: string; recipe?: string|Recipe; project: 'mobile-390'|'tablet-768'|'desktop-1440'; url?: string }): Promise<Target>;
export function openApp(page: Page, o: { persona: Persona; page: string; recipe?: string|Recipe; route?: string }): Promise<Target>;
export function hidePanel(t: Target): Promise<void>;        // D-45 п.5: display:none панели, снимается root
export function installClock(page: Page, iso?: string): Promise<void>; // page.clock.install до goto
export function collectLabels(root: Locator): Promise<string[]>; // 'button:Подключить', 'h1:Модули и место', 'aria:Основная навигация' …
export function matchReference(app: Target, ref: Target, key: string, testInfo: TestInfo, o?: { maxDiffPixelRatio?: number; mask?: Locator[] }): Promise<void>;
export function comparePng(a: Buffer, b: Buffer, o: { maxDiffPixelRatio: number }): { diffPixels: number; ratio: number; diff: Buffer };
export function runAxe(page: Page, o?: { exclude?: string[] }): Promise<{ serious: number; critical: number; violations: AxeViolation[] }>;
export function loadAllowlist(key: string): AllowEntry[]; // kind: 'pixel'|'label'|'order'|'state'|'no-reference'; target; mode; reason; decision; owner (D-50)
export function applyAllowlist(labels: string[], entries: AllowEntry[], mode: 'mock'|'stand'): string[];
export const PAGE_KEYS: PageKey[]; // из tools/page-keys.json
```

Фикстуры `frontend/apps/web/e2e/fixtures/index.ts`:

- `export const test = base.extend<{ clock: void; demo: DemoPanel; reference: (o) => Promise<Target>; app: (o) => Promise<Target>; axe: typeof runAxe; labels: typeof collectLabels; net: Net; E2E_MODE: 'mock'|'stand' }>`.
- `clock` — автофикстура (`auto: true`), ставит `page.clock` до первого `goto`.
- `demo` работает на обеих целях (панель одинакова по D-44): `persona(label)`, `width(label)`, `flag(label, on)`, `reset()`, `guide()`, `applyPreset(name)` (только `app`, §4.2).
- `net` — собирает `request.url()` и `console` сообщения; `assertNoCdn()`, `hosts(): Set<string>`.
- `expect` расширен матчером `toHaveLabels(ref: string[], allowlist?: AllowEntry[])` — diff по позициям.

#### 4.1.2 `frontend/apps/web/playwright.config.ts`

- Переменные окружения (контракт для WS-53 и `workflow.template.js`): `PORT` (default 5173), `REFERENCE_URL` (default `http://127.0.0.1:4173`), `E2E_MODE=mock|stand` (default `mock`), `E2E_FRESH_SERVER=1`, `E2E_BASE_URL` (стенд, WS-53), `REFERENCE_REFRESH=1`, `CI`.
- Проекты: `mobile-390` (`devices['Pixel 7']` + `viewport 390×844`, `isMobile`, `hasTouch`); `tablet-768` (`768×1024`, `hasTouch`, `testIgnore: ['**/visual/**']`); `desktop-1440` (`Desktop Chrome`, `1440×900`).
- `use` у всех: `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'`, `colorScheme: 'light'`, `testIdAttribute: 'data-testid'`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'off'`, `baseURL: http://127.0.0.1:${PORT}` (12 §6 п.4 ожидает `127.0.0.1`).
- `timeout: 30_000`, `expect.timeout: 5_000`, `fullyParallel: true`, `forbidOnly: !!CI`, `retries: CI ? 2 : 0`, `workers: CI ? 1 : undefined`.
- `reporter: [['list'], ['html', { open: 'never' }]]` (12 §6 п.6).
- `snapshotPathTemplate: '{testDir}/visual/__screenshots__/{platform}/{projectName}/{arg}{ext}'` (D-32).
- `expect.toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide', scale: 'css' }` (D-22).
- `testIgnore: ['**/_tools/**']` (кроме `LABELS_DUMP=1`); теги `@smoke`, `@harness`, `@visual`.
- `webServer[0]`: `pnpm dev:web -- --mode e2e --host 127.0.0.1 --port ${PORT} --strictPort`, `url: http://127.0.0.1:${PORT}/`, `reuseExistingServer: !CI && !E2E_FRESH_SERVER`, `timeout: 180_000`.
- `webServer[1]`: `node tools/design-preview.js design 4173 --offline`, `url: http://127.0.0.1:4173/Ортус%20CRM.dc.html`, `reuseExistingServer: !CI`, `timeout: 30_000` (МП §2.2, П19).
- При `E2E_MODE=stand` `webServer[0]` не запускается, `baseURL = E2E_BASE_URL`.

#### 4.1.3 `frontend/apps/docs/playwright.config.ts`

- Проекты `docs-390` (390×844, touch), `docs-800` (800×900), `docs-1280` (1280×900), `docs-1440` (1440×900) — 11 §12 п.9; 11 §10 #20–21.
- `DOCS_PORT` (default `PORT ?? 5173`); `webServer[0]` = `pnpm --filter @ortus/docs dev --host 127.0.0.1 --port ${DOCS_PORT}`; `webServer[1]` — тот же эталон 4173 `--offline`, `url: http://127.0.0.1:4173/Документация.dc.html`.
- `snapshotPathTemplate` с `{platform}`, те же `locale`/`timezoneId`/`reporter`.

#### 4.1.4 `tools/page-keys.json` — единый реестр ключей

- 38 записей в порядке таблицы МП §5.3: `home, modules, users, billing, branding, fleet, pool, review, today, cars, tenants, usage, requests, accounts, plans, forms, tasks, calendar, knowledge, data, files, spa, cash, repair, repair-tabs, shell, modal-confirm, modal-sheet, modal-assign, modal-invite, modal-createRole, modal-request, docs-start, docs-search, docs-api, docs-permissions, docs-frames, docs-layout`; `verifyPort = 6000 + index` (`home` → 6001 … `docs-layout` → 6038, МП §7.4).
- Поля: `key`, `app: 'web'|'docs'`, `menuLabel`, `route`, `report`, `checklist`, `exclude`, `gates`, `recipes`, `paths`, `verifyPort`, `screenLabel`.
- `menuLabel` дословно по 01 §8.3/§9: «Главная», «Модули и место», «Пользователи и роли», «Подписка и места», «Оформление», «Рабочее место логиста», «Ресурсный пул», «Приёмка смен», «Сегодня», «Автомобили», «Организации», «Использование», «Заявки на тариф», «Пользователи», «Тарифная сетка», «Формы и опросы», «Задачи», «Календарь», «База знаний», «Данные», «Файлы», «Салон и SPA» (для `therapist` — «Мой день»), «Касса», «Объекты».
- `route` по МП §4.7: `/t/t-alta/home` … `/t/t-alta/repair?tab=overview`, `/platform/tenants` … `/platform/plans`; docs — `#/start`, `#/openapi`, `#/permissions`, `#/design-system`.
- `checklist`: `{ report: '05-home-forms-tasks.md', section: '## 9. Чек-лист приёмки', items: '1-11' }`; `exclude`: только у `repair-tabs` — `[{ items: '6-9', reason: 'D-36 standalone' }]`.
- `gates` из МП §4.9, например `fleet`: `[{ persona: 'owner', kind: 'module_off', text: '«Логистика» не подключена организацией' }, { persona: 'manager', kind: 'module_off' }, { persona: 'manager', kind: 'no_permission', text: 'Нет роли с доступом к модулю «Логистика»' }]`; `review` дополнительно `{ persona: 'manager', kind: 'no_permission', text: 'Нет права на приёмку смен' }`.
- `recipes` из МП §5.3 (например `today`: `base, driver-booked, driver-on-route, defect-review, shift-submitted, shift-accepted, offline, conflict-next, fail-upload`).
- `paths` (глобы для `verify-pages`): `frontend/apps/web/src/routes/company/modules/**` → `modules`; `src/modals/people/**` → `modal-assign`, `modal-invite`, `modal-createRole`; `src/{app,shell,demo}/**` → `shell`, `modal-confirm`, `modal-sheet`; `src/routes/logistics/manager/pool/**` → `pool`, `modal-request`; `src/routes/repair/{index,overview,works}/**` → `repair`; `src/routes/repair/child/**` → `repair-tabs`; `frontend/apps/docs/**` → шесть `docs-*`.

#### 4.1.5 `tools/e2e-skeleton.js <key> [--force] [--dry]`

- Читает `page-keys.json`, парсит отчёт: заголовок `## N. Чек-лист приёмки…` (или `## N Чек-лист…`), подразделы `###` или строка `**…**`, пункты `^(\d+)\.\s+(.*)$` до следующего `## `.
- Пишет `frontend/apps/web/e2e/<key>.spec.ts` (для `app: 'docs'` — `frontend/apps/docs/e2e/<key>.spec.ts`) по `tools/templates/spec.ts.tmpl`.
- Структура: `test.describe('<key>')` → `test.describe('<подраздел>')` → `test.fixme('<№>. <текст пункта дословно, без ** >', async ({ app, demo, reference }) => {})`.
- Затем `test.describe('verification-protocol §1.3')` с шестью тестами, имена дословно по МП §8.2: «страница открывается из навигации по подписи «…» и по прямому URL»; «заголовок и крошки соответствуют прототипу»; «состояния: пусто / загрузка / ошибка / нет права или модуль не подключён / офлайн — дословный текст»; «клавиатура: Tab обходит все интерактивные элементы, Escape закрывает диалог, фокус виден»; «axe: нет serious/critical»; «раскладка 390: нет горизонтальной прокрутки страницы, нижняя навигация, цели ≥ 44 px; 1440: боковая панель».
- Затем `test.describe('§4.9 нет права / модуль не подключён')` — по одному тесту на клетку «Г-*»: `нет права / модуль не подключён: <persona> → «<menuLabel>» (§4.9)`.
- Затем `test.describe('рецепты §2.4')` — по одному на рецепт ключа.
- Шапка файла: `// Источник: docs/plan/analysis/<report> §<N> #a–b; сгенерировано tools/e2e-skeleton.js; правки — владелец WS-NN`; исключённые пункты — комментарий `// исключено: #6–9, D-36`.
- Существующий файл не перезаписывается без `--force` (код 3, сообщение `уже существует`); `--dry` печатает в stdout.

#### 4.1.6 `tools/verify-pages.js [--check] [--base main]`

- Вход: stdin — JSON Stop-хука (`stop_hook_active`), иначе CLI.
- `git diff --name-only $(git merge-base <base> HEAD)..HEAD` + `git status --porcelain` → ключи по `paths`.
- Свежесть ключа: в `docs/plan/evidence/<key>/` есть все шесть файлов `390.png, 768.png, 1440.png, snapshot.txt, console.txt, network.txt` и `mtime` каждого ≥ времени последнего коммита, тронувшего `paths` ключа.
- Вывод: `verify-pages: нет свежего evidence для: modules, users — выполните verification-protocol.md §1–§4`.
- Код выхода: 0 (напоминание, МП §7.3); при `VERIFY_PAGES_BLOCK=1` и `stop_hook_active !== true` — 2 и тот же текст в stderr (Claude Code продолжает сессию); `--check` — 1 при устаревании (pre-push/CI); `stop_hook_active: true` — всегда 0.

#### 4.1.7 `tools/labels-dump.js --persona <Persona> --page "<подпись меню>" [--recipe <name>] [--width 390|1440] [--out <file>]`

- Запускает `LABELS_DUMP=1 pnpm exec playwright test e2e/_tools/labels-dump.spec.ts --project desktop-1440|mobile-390`.
- Печатает JSON `{ persona, page, recipe, width, labels: string[], screenLabel }`.
- Назначение: фиксация агрегатов `usage` «59 из 70», «141,4 из 275 ГБ», «34 из 57» (04 §5.2, WS-00) без ручного переписывания.

#### 4.1.8 `tools/design-preview.js <dir> <port> [--offline] [--vendor <dir>] [--fonts <dir>] [--modules <dir>]`

Без флага — как сейчас (`tools/README.md:41`). С `--offline` для каждого ответа `.dc.html` строка подменяется в памяти (файлы `design/` не меняются):

1. Перед `<script src="./support.js"></script>` (`:6`) вставляются `<script src="/__vendor/react.production.min.js"></script><script src="/__vendor/react-dom.production.min.js"></script>` — `loadReactUmd` видит `window.React && window.ReactDOM` и ничего не грузит (`support.js:1839–1840`).
2. `window.__resources` **не задаётся**: иначе `boot()` пропустит повторный `fetch(location.href)` сырого шаблона (`support.js:158–164`) и путь рендера разойдётся с онлайн-версией.
3. `<link rel="preconnect" href="https://fonts.googleapis.com">` (`:13`) удаляется; оба `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?…">` (`:14–15`) → `href="/__fonts/fonts.css"`.
4. Только для `Документация.dc.html`: `https://cdn.jsdelivr.net/npm/marked@12/marked.min.js` → `/__modules/marked/marked.min.js`; `https://cdn.jsdelivr.net/npm/js-yaml@4/dist/js-yaml.min.js` → `/__modules/js-yaml/dist/js-yaml.min.js`; `import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')` (`:323`) → `import('/__modules/mermaid/dist/mermaid.esm.min.mjs')` (чанки резолвятся относительно — отдаётся весь `dist/`).
5. Виртуальные пути: `/__vendor/*` ← `tools/vendor/`; `/__fonts/*` ← `frontend/packages/tokens/fonts/` (WS-04); `/__modules/<pkg>/*` ← `node_modules/<pkg>/` (devDependencies `marked`, `js-yaml`, `mermaid` с точными версиями в `frontend/package.json` — запрос интегратору; до этого `--modules <dir>`).
6. `Content-Length` пересчитывается; MIME как сейчас; `cache-control: no-store`; выход за корень → 403.
7. Ответы `.js`, `.md`, `.yaml`, `.sql` не меняются байт-в-байт.

#### 4.1.9 `.mcp.json`

- `{ "mcpServers": { "playwright": { "command": "node", "args": ["node_modules/@playwright/mcp/cli.js", "--browser", "chromium", "--headless", "--isolated", "--output-dir", ".playwright-mcp/${PORT:-5173}"] } } }` (12 §3.2 R1; D-49).
- devDependency `@playwright/mcp` с точной версией, совместимой с установленным `@playwright/test` (R1: `0.0.78` перепроверить); `pnpm mcp:install` = `node node_modules/@playwright/mcp/cli.js install-browser chrome-for-testing`.
- Инструменты, на которые опираются `verifyPrompt` и `verification-protocol.md` §4: `mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_select_option`, `browser_resize`, `browser_console_messages`, `browser_network_requests`, `browser_take_screenshot`.

#### 4.1.10 Go-харнесс (`backend/test`, пакет `test`, `//go:build integration || isolation || concurrency`)

- `func Main(m *testing.M) int` — вызывается из `TestMain` каждого пакета сюит (`os.Exit(test.Main(m))`), внутри `run()` с `defer` (12 §3.2 R4).
- `testdb.New(t) *DB` (`t.Helper()`, совместим с `t.Parallel()`): `Control() *pgxpool.Pool`; `Tenant(t, label string) *pgxpool.Pool` — новая БД `ortus_t_<sanitized t.Name()>_<8 hex>` из шаблона `ortus_tpl_tenant`, `DROP DATABASE` в `t.Cleanup`; `DSN() string`.
- `testdb.Migrate(ctx, pool, dir)` — goose (библиотека) по `backend/migrations/control`, `backend/migrations/tenant` один раз на шаблонные БД; порядок версий = лексикографическому порядку `0001_…` (12 §6 п.12); каталога нет → лог `no migrations yet`.
- `harness.Now() time.Time` = `2026-10-01T10:30:00+03:00` (`time.FixedZone("MSK", 3*3600)`); `harness.Clock` (интерфейс `Now()`); `harness.Until(d)`; литералы дат в тестах запрещены (12 §6 п.15).
- `harness.Problem(t, resp) {Code, Status, RequestID}` — чтение RFC 9457; `harness.NotFoundBody(t) []byte` — байт-в-байт тело 404 для `bytes.Equal` (12 §6 п.16); до WS-40 читается `testdata/notfound.json`.
- Источник БД по порядку: `TEST_DATABASE_URL` → `postgres://ortus:ortus@127.0.0.1:5433/ortus_test?sslmode=disable` (compose `postgres-test`, WS-02) → при `TESTCONTAINERS=1` контейнер `postgres:17` (`testcontainers-go/modules/postgres`) → иначе `log.Fatalf("postgres is not reachable at 127.0.0.1:5433 — start it with: docker compose --profile test up -d --wait postgres-test (or set TEST_DATABASE_URL, or TESTCONTAINERS=1)")` (12 §6 п.11: содержит `start it with`; не skip).

#### 4.1.11 `docs/plan/evidence/README.md`

- `evidence/<key>/{390.png,768.png,1440.png,reference-390.png,reference-1440.png,snapshot.txt,console.txt,network.txt,notes.md}`.
- `verify/` — то же от проверяющего; `phase2/` — повтор в режиме `stand` (D-52).
- `snapshot.txt` = вывод `browser_snapshot` целиком; `network.txt` = `browser_network_requests` с пометкой хостов вне allowlist; `console.txt` = `browser_console_messages`.
- Имена фиксированы — их проверяет `verify-pages.js`.

### 4.2 Потребляет

| От | Что | Если ещё нет |
|---|---|---|
| WS-01 | pnpm workspace; `frontend/package.json` с devDeps `@playwright/test`, `vitest`; корневые скрипты `e2e`, `e2e:install`, `mcp:install`, `verify-pages`, `dev:web` (МП §0.2); `.claude/settings.json` со Stop-хуком `node tools/verify-pages.js` и `enableAllProjectMcpServers: true`; `.gitignore` с `.playwright-mcp/`, `playwright-report/`, `test-results/`, `frontend/apps/web/e2e/visual/__screenshots__/win32/`; `tools/check-icu.js`, `tools/allowlist-lint.js`; `backend/go.mod` | инструменты вызываются как `node tools/<x>.js` / `pnpm exec playwright test`; запрос интегратору: скрипты `e2e:skeleton`, `labels-dump`, `e2e:reference-refresh` (`REFERENCE_REFRESH=1 pnpm e2e -- --grep @visual`), `test:tools` (`node --test tools/__tests__`); devDeps `marked`, `js-yaml`, `mermaid` (точные версии); в `backend/go.mod` — `github.com/jackc/pgx/v5`, `github.com/pressly/goose/v3`, `github.com/testcontainers/testcontainers-go` + `modules/postgres` (12 §5 п.28); пока их нет — Go-часть помечена блокированной в отчёте |
| WS-01 | заготовка `frontend/apps/web/{package.json,index.html,vite.config.ts,src/main.tsx}` с `<div id="app">` и `<title>Ортус</title>` (заглушка `Owner: WS-10`; нужна для `@smoke` барьера 0→1 «пустое приложение открывается», МП §6.5) | `app.spec.ts` остаётся `test.fixme('WS-01: нет заготовки apps/web')`, блокер в отчёте |
| WS-04 | `frontend/packages/tokens/fonts/fonts.css` + woff2 (Golos Text 400–700, IBM Plex Mono 400/500, Material Symbols Rounded variable `opsz,wght,FILL,GRAD`) — путь `/__fonts/` | `--offline` отдаёт 404 на `/__fonts/fonts.css` с предупреждением в консоли сервера; H4 остаётся `fixme` со ссылкой на WS-04; H14–H16 идут на системных шрифтах — одинаковых для обеих копий эталона |
| WS-10 (волна 1) | `#app`; демо-панель 1:1 (`DemoOnly`, D-44); `window.__ortusTest = { applyPreset(name), scenario(name), setFlag(k, v) }` только при `MODE === 'e2e'` и `VITE_ADAPTER=mock`; маршруты МП §4.7 | `demo.applyPreset` бросает `Error('applyPreset недоступен: нет window.__ortusTest (WS-10)')`; `openApp` ходит по меню, как на эталоне |
| WS-06 | имена пресетов = имена рецептов МП §2.4 | не нужно в волне 0 |
| WS-00 | исправленные чек-листы (E1–E6), нумерация 05 §11 | генератор читает файлы как есть; запуск для реальных ключей — после закрытия WS-00 (МП §6.1) |
| WS-02 | compose `postgres-test` на 5433 (`profiles: [test]`) | тесты Go «с базой» — через `TESTCONTAINERS=1` или помечены блокированными; тест «падает без базы» проходит всегда |

## 5. Экраны, диалоги, состояния

Собственных страниц у WS нет (`pages: []`); ниже — цели, на которых харнесс проверяет сам себя.

| Ключ (внутр.) | Дословная подпись / селектор | Персонажи | Строки прототипа | Состояния, которые должен уметь харнесс | e2e spec | URL |
|---|---|---|---|---|---|---|
| `ref-crm` | `region` «Панель демонстрации»; `select` «Персонаж» (8 опций), «Ширина» («По окну», «390 · телефон», «768 · планшет», «1440 · компьютер»); кнопки «Путь проверки», «Сбросить»; флажки «Нет связи», «Конфликт брони», «Сбой загрузки фото» | все 8 | `:29–66`, `:2463–2473`, `:2436–2438` | загрузка (`role=status` `aria-label="Загрузка"` «Загружаем рабочее пространство…»), офлайн (`role=status` «Нет связи» в шапке), сброс, ширина фрейма = окну (D-45 п.1) | `apps/web/e2e/smoke/harness.spec.ts` | `http://127.0.0.1:4173/Ортус%20CRM.dc.html` |
| `ref-home` | `h1#h-home` `/^(Доброе утро\|Добрый день\|Добрый вечер), Дарья$/`; `nav[aria-label="Основная навигация"]` 14 пунктов владельца (01 §20 #8) | owner | 05 §9.1 #1; 01 §9.4 | обычное; после `logistics-ready` — группа «Логистика» | то же | то же |
| `ref-lotos` | шапка «Лотос», `--ox-accent` `#7A3E79` | owner@t-lotos | 01 §20 #31; 01 §17 | оформление организации | то же | то же |
| `app-smoke` | `#app`, `<title>` | — | — | заглушка WS-01 открывается без ошибок консоли | `apps/web/e2e/smoke/app.spec.ts` | `http://127.0.0.1:${PORT}/` |
| `ref-docs` | `main article h1` «Ортус CRM — комплект для старта разработки v0.2»; `nav[aria-label="Документы"]`; `button[aria-label="Разделы"]`; `aside[aria-label="Содержание"]`; `iframe[title="Прототип"]`, `[title="Дизайн-система"]` | — | `Документация.dc.html:13–17, :323`; 11 §10 #1, #5, #20–24 | офлайн (без jsdelivr/unpkg/fonts), 4 ширины, mermaid-`svg` | `apps/docs/e2e/harness.spec.ts` | `http://127.0.0.1:4173/Документация.dc.html#/start`, `#/data-model`, `#/prototype`, `#/design-system`, `#/objects-variants`, `#/engineering` |

## 6. Тесты первыми

### (а) E2E-скелет харнесса (все в `test.fixme`, снимаются по одному в §7)

`frontend/apps/web/e2e/smoke/harness.spec.ts`, тег `@harness`, проекты `mobile-390` и `desktop-1440` (H18 — ещё и `tablet-768`):

1. **H1 Эталон офлайн открывается.** Given `webServer[1]` поднят с `--offline`; When `page.goto(REFERENCE_URL + '/Ортус%20CRM.dc.html')`; Then `locator('#dc-root .sc-host')` виден, `locator('.sc-logic-error')` отсутствует, `getByRole('status', { name: 'Загрузка' })` появился и исчез (МП §2.2; 11 §12 п.18; 01 §20 #1).
2. **H2 Консоль эталона чистая.** Given `net`-фикстура; When загрузка завершена; Then нет сообщений с `[dc-runtime]`, `[dc] failed`, нет `console.error` (11 §10 #25).
3. **H3 Сеть эталона без CDN.** Given `net`; When загрузка завершена и выполнен `base('owner','Модули и место')`; Then `net.hosts()` = `{'127.0.0.1:4173'}`; нет `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.jsdelivr.net` (12 §6 п.10; 11 §12 п.19).
4. **H4 Шрифты локальные.** Then после `document.fonts.ready` истинны `document.fonts.check("600 16px 'Golos Text'")`, `check("500 14px 'IBM Plex Mono'")`, `check("24px 'Material Symbols Rounded'")` (11 §10 #34) — `fixme` до слияния WS-04.
5. **H5 Панель демонстрации дословно.** Then `getByRole('region', { name: 'Панель демонстрации' })` виден; `getByLabel('Персонаж')` содержит `optgroup` «Платформа», «Альта Групп», «SPA «Лотос»» и опции «Оператор платформы», «Владелец · Дарья Зимина», «Логист · Марина Котова», «Водитель · Илья Васильев», «Массажист · Анна Морозова», «Прораб · Алексей Соколов», «Владелец · Ирина Белова», «Массажист · Анна Морозова» со значениями `operator, owner, manager, driver, therapist, foreman, owner@t-lotos, therapist@t-lotos`; `getByLabel('Ширина')` — «По окну», «390 · телефон», «768 · планшет», «1440 · компьютер» (01 §20 #3; `:33–55`).
6. **H6 `demo.persona`.** When `demo.persona('Водитель · Илья Васильев')`; Then `getByRole('status', { name: 'Загрузка' })` появился и исчез; `locator('[aria-current=page]')` имеет текст «Сегодня»; `getByLabel('Персонаж')` = `driver` (01 §5.1; 01 §8.3).
7. **H7 `demo.flag` и `demo.reset`.** Given owner; When `demo.flag('Нет связи', true)`; Then в шапке `getByRole('status').filter({ hasText: 'Нет связи' })` виден, тост «Нет связи. Черновики сохраняются на устройстве» (01 §20 #18); When `demo.reset()`; Then персонаж `owner`, флажок снят, `aria-current=page` у «Главная» (01 §20 #29).
8. **H8 Часы и локаль.** Given `installClock(page)` до `goto`; Then `page.evaluate(() => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))` = `10:30`, `new Date().getTimezoneOffset()` = `-180`, `Intl.NumberFormat('ru-RU').format(84370)` = `'84\u00A0370'` (D-45 п.2–3; 07 §16 п.16–17); на `home` `h1#h-home` соответствует `/^(Доброе утро|Добрый день|Добрый вечер), Дарья$/` (05 §9.1 #1).
9. **H9 Рецепт `base` и скрытие панели.** When `openReference(browser, { persona: 'owner', page: 'Модули и место', project })`; Then `getByRole('heading', { level: 1, name: 'Модули и место' })` виден, крошка «Альта Групп / Компания» (02 §10 #1); после `hidePanel` `locator(PANEL)` скрыт, а `#dc-root` виден.
10. **H10 Рецепт `logistics-ready`.** When рецепт на эталоне: owner → «Модули и место» → карточка «Логистика» → «Подключить» → диалог «Подключить «Логистика»?» → «Подключить» → «Пользователи и роли» → «Люди» → у «Марина Котова» «Назначить роль» → диалог «Назначить роль» → «Назначить» (МП §2.4; 01 §6 шаги 1–2); Then тосты «Модуль «Логистика» подключён» и «Роль «Менеджер логистики» назначена» (01 §20 #9, #35); When `demo.persona('Логист · Марина Котова')`; Then в `nav[aria-label="Основная навигация"]` группа «Логистика» с «Рабочее место логиста», «Ресурсный пул», «Приёмка смен» (03 §14 #3).
11. **H11 Рецепт `lotos`.** When `RECIPES.lotos` с `owner@t-lotos` → «Главная»; Then `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent').trim()` = `#7A3E79`, в шапке «Лотос», группы «Логистика» нет (01 §20 #31–32).
12. **H12 `collectLabels` на `home`/owner/1440.** Then массив содержит подряд `button:Главная`, `button:Модули и место`, `button:Пользователи и роли`, `button:Подписка и места`, `button:Оформление`, `button:Объекты`, `button:Салон и SPA`, `button:Задачи`, `button:Формы и опросы`, `button:Календарь`, `button:База знаний`, `button:Данные`, `button:Файлы`, `button:Касса` (01 §20 #8); содержит `aria:Основная навигация`, `aria:Уведомления`, `aria:Профиль`, `aria:Область просмотра`; **не** содержит «Персонаж», «Путь проверки», «Сбросить» (панель исключена) и ни одного элемента с `data-a11y-extra` (D-29).
13. **H13 `collectLabels` детерминирован.** Given два контекста с одинаковым рецептом; Then массивы `toEqual` (включая «ё» и U+00A0).
14. **H14 reference vs reference, 390.** Given два контекста на `mobile-390`, рецепт `base('owner','Главная')`, панель скрыта, `animations: 'disabled'`; When снимки `#dc-root`; Then `comparePng(a, b).diffPixels === 0` (МП §6.5 барьер 0→1).
15. **H15 reference vs reference, 1440.** То же на `desktop-1440` → `0`.
16. **H16 reference vs reference после изменяющего рецепта.** Given `logistics-ready` в обоих контекстах на 1440; Then `diffPixels === 0` (детерминизм рецепта и часов).
17. **H17 `matchReference` красный по делу.** Given `openApp` на заглушке `/` (`#app`) и `openReference('owner','Главная')`; When `matchReference(app, ref, 'home', testInfo)`; Then отклонено с сообщением, содержащим `maxDiffPixelRatio` и фактическое отношение > 0.01; в `testInfo.attachments` есть `home-expected.png`, `home-actual.png`, `home-diff.png`; не `TypeError`/`TimeoutError`.
18. **H18 Ширина фрейма = viewport.** Given «Ширина» = «По окну»; Then `#dc-root` `boundingBox().width` = 390 на `mobile-390`, 768 на `tablet-768`, 1440 на `desktop-1440` (D-45 п.1; `:2384–2393`).
19. **H19 `demo.width` для MCP.** Given `desktop-1440`; When `demo.width('390 · телефон')`; Then фрейм `width: 390px`, `border-radius: 22px`, `nav[aria-label="Навигация"]` с 4 кнопками «Главная», «Модули», «Люди», «Ещё» (01 §20 #6).
20. **H20 `runAxe` работает на эталоне.** When `runAxe(page, { exclude: [PANEL] })`; Then результат имеет числа `serious`, `critical` и массив `violations` с полями `id`, `impact`, `nodes[].target`; исключённая панель не встречается в `target`.
21. **H21 Allowlist применяется.** Given `tools/__fixtures__/allowlist/home.md` с записью `- kind: label · target: button:Демо: открыть как владелец · mode: mock · reason: демо-кнопка · decision: D-44 · owner: WS-10`; When `applyAllowlist(labels, loadAllowlist('home'), 'mock')`; Then элемент удалён из сравнения; запись без `decision` → `loadAllowlist` бросает `Error` с номером строки (D-50).

`frontend/apps/web/e2e/smoke/app.spec.ts`, тег `@smoke`, три проекта:

22. **H22 Пустое приложение открывается.** When `page.goto('/')`; Then `locator('#app')` виден, `<title>` непуст, `console.error` нет, ни одного запроса к хостам вне `127.0.0.1:${PORT}` (12 §6 п.10).

`frontend/apps/docs/e2e/harness.spec.ts`, тег `@harness`, проекты `docs-390`/`docs-800`/`docs-1280`/`docs-1440`:

23. **H23 Читалка офлайн.** When `goto(REFERENCE_URL + '/Документация.dc.html')`; Then `#dc-root .sc-host` виден, нет `.sc-logic-error`, `main article h1` содержит «Ортус CRM — комплект для старта разработки v0.2» (11 §10 #1), консоль без `[dc-runtime]`.
24. **H24 Читалка без CDN.** Given `net`; When `#/start` → `#/data-model`; Then хосты = `{'127.0.0.1:4173'}`; в article есть `svg` внутри `div` и нет `code.language-mermaid` (11 §10 #5 — mermaid локально).
25. **H25 Фреймы офлайн.** When `#/prototype`; Then в `frameLocator('iframe[title="Прототип"]')` виден `region` «Панель демонстрации» и `select` с опцией «Владелец · Дарья Зимина» (11 §10 #23); When `#/design-system`; Then `h1` «Токены, компоненты и состояния для всех модулей CRM», нет `.sc-logic-error` (#22); When `#/objects-variants`; Then текст «Ремонт и стройка → Объекты: три подхода к карточке объекта» (#24); за всё время нет запросов к `unpkg.com`.
26. **H26 Проекты читалки.** Given `docs-800`; Then `nav[aria-label="Документы"]` отсутствует, `button[aria-label="Разделы"][aria-expanded="false"]` виден (11 §10 #21); Given `docs-1440`, `#/engineering`; Then `aside[aria-label="Содержание"]` виден (#20); Given `docs-390`; Then `button[aria-label="Разделы"]` виден.
27. **H27 reference vs reference документации.** Given два контекста `#/start` на `docs-390` и `docs-1440`; Then `diffPixels === 0`.

Итого **27** пунктов e2e-скелета.

### (б) Unit (`node --test tools/__tests__`; Vitest в `packages/e2e-kit/test`, окружение happy-dom)

| Функция | Вход | Ожидание |
|---|---|---|
| `e2e-skeleton: parseChecklist` | `tools/__fixtures__/checklist-01.md` (формат 01 §20: `1. **Загрузка.** Given…`, плоский) | 3 пункта; имена без `**`; подраздел `''` |
| `parseChecklist` | `checklist-02.md` (02 §10: `### Модули и место` + `1. Given…`) | группы по `###` |
| `parseChecklist` | `checklist-03.md` (03 §14: `1. **Given** … **When** … **Then** …`) | жирные маркеры сняты, текст сохранён |
| `parseChecklist` | `checklist-04.md` (04 §8: `**Оболочка**` жирный подраздел, пункты через ` · `) | подраздел «Оболочка» |
| `parseChecklist` | `checklist-05.md` (05 §9: `### 9.1 Главная`, `### 9.2`, сквозная нумерация 1–11, 12–29) | `items: '12-29'` → 18 пунктов из §9.2 |
| `e2e-skeleton: render` | `repair-tabs` с `exclude 6-9` | в выводе нет `'6. '`…`'9. '`; есть `// исключено: #6–9, D-36` |
| `render` | `fleet` с 3 `gates` | 3 теста в `§4.9 нет права / модуль не подключён` |
| `render` | любой ключ | 6 тестов `verification-protocol §1.3` с именами дословно по МП §8.2 |
| `render` | файл уже существует, без `--force` | код 3, сообщение `уже существует`, файл не изменён |
| `e2e-skeleton` (snapshot, после WS-00) | `node tools/e2e-skeleton.js home --dry` | 11 пунктов + 6 + 0 гейтов + 4 рецепта (owner base, manager base, manager logistics-ready, owner@t-lotos) |
| `verify-pages: keysForPaths` | `['frontend/apps/web/src/routes/company/modules/vm/omVM.ts']` | `['modules']` |
| `keysForPaths` | `['frontend/apps/web/src/shell/AppShell.tsx']` | `['shell','modal-confirm','modal-sheet']` |
| `keysForPaths` | `['frontend/apps/web/src/modals/people/Assign.tsx']` | `['modal-assign','modal-invite','modal-createRole']` |
| `keysForPaths` | `['frontend/apps/web/src/routes/repair/child/gantt/x.tsx']` | `['repair-tabs']` |
| `keysForPaths` | `['frontend/apps/docs/src/App.tsx']` | 6 ключей `docs-*` |
| `keysForPaths` | `['design/support.js']` | `[]` |
| `verify-pages: isFresh` | папки нет | `false` |
| `isFresh` | 5 файлов из 6 | `false`, в причине имя недостающего файла |
| `isFresh` | 6 файлов, все `mtime` ≥ `lastCommitTs` | `true` |
| `isFresh` | один файл старше коммита | `false` |
| `verify-pages: main` | поддельный `git` (инъекция `exec`), diff с `modules`, нет evidence | stdout `нет свежего evidence для: modules`, код 0 |
| `main` | то же, `VERIFY_PAGES_BLOCK=1` | код 2, текст в stderr |
| `main` | stdin `{"stop_hook_active": true}` | код 0 всегда |
| `main` | `--check` | код 1 |
| `design-preview: rewriteDcHtml` | `Ортус CRM.dc.html:1–15` | два `/__vendor/` скрипта перед `./support.js`; нет `fonts.googleapis.com`; нет `preconnect`; два `href="/__fonts/fonts.css"`; строки `__resources` нет |
| `rewriteDcHtml` | `Документация.dc.html:13–17, :323` | `/__modules/marked/marked.min.js`, `/__modules/js-yaml/dist/js-yaml.min.js`, `import('/__modules/mermaid/dist/mermaid.esm.min.mjs')` |
| `design-preview` без `--offline` | запрос `.dc.html` | ответ байт-в-байт равен файлу (regression) |
| `design-preview` маршруты | `GET /__vendor/react.production.min.js` | 200, `text/javascript; charset=utf-8` |
| маршруты | `GET /__modules/mermaid/dist/chunks/x.mjs` (файл есть) | 200, `text/javascript` |
| маршруты | `GET /__vendor/../package.json` | 403 |
| `vendor: sha384` | `tools/vendor/react.production.min.js` | base64 = `DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z` (`support.js:1144`) |
| `vendor: sha384` | `react-dom.production.min.js` | `gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1` (`:1146`) |
| `page-keys.json` schema | файл | 38 ключей в порядке МП §5.3; `verifyPort` 6001…6038 без дубликатов; `route` web-ключей начинается с `/t/` или `/platform/`; `menuLabel` ∈ списку 01 §8.3; `exclude` только у `repair-tabs` |
| `e2e-kit: normalizeLabel` | `<button aria-label="Уведомления: 1 новых">` | `aria:Уведомления: 1 новых` |
| `normalizeLabel` | `<h1>Модули <b>и</b> место</h1>` | `h1:Модули и место` |
| `normalizeLabel` | `<a data-a11y-extra="D-29">К содержимому</a>` | пропущен |
| `normalizeLabel` | `<label>Персонаж<select/></label>` внутри `[aria-label="Панель демонстрации"]` | пропущен |
| `normalizeLabel` | текст `'84\u00A0370'` | U+00A0 сохранён; `\s+` вне U+00A0 → один пробел |
| `e2e-kit: parseAllowlist` | строка по D-50 | объект с 6 полями |
| `parseAllowlist` | `kind: pixel` без `decision: D-` | `Error` с номером строки |
| `parseAllowlist` | `mode: both` | применяется и к `mock`, и к `stand` |
| `e2e-kit: comparePng` | одинаковые PNG | `{ diffPixels: 0, ratio: 0 }` |
| `comparePng` | 390×844 и 390×900 | `Error('size mismatch 390×844 vs 390×900')` |
| `comparePng` | 1 % пикселей отличается | `ratio ≈ 0.01` |
| `e2e-kit: PERSONA_LABEL` | — | 8 ключей; значения дословно `:34–45`; `therapist` и `therapist@t-lotos` оба «Массажист · Анна Морозова» |
| grep-тест (12 §6 п.4) | `frontend/apps/web/e2e/**/*.ts`, `apps/docs/e2e/**/*.ts` | нет литералов `:5173`, `:3000`, `:4173` (исключение — default в `playwright.config.ts`) |
| `--list` (spawn, 12 §6 п.4–5) | `PORT=3001 pnpm exec playwright test --list` | вывод содержит `127.0.0.1:3001`; `harness.spec.ts` присутствует под `mobile-390` и `desktop-1440` |

### (в) Компонентные — не применимо (React-компонентов нет); axe проверяется H20.

### (г) Контрактные/интеграционные (Go, `backend/test`)

| Тест | Тег | Ожидание |
|---|---|---|
| `TestWS07HarnessFailsWithoutDB` (подпроцесс `go test -run … -tags integration` с `TEST_DATABASE_URL=postgres://x@127.0.0.1:1/x`) | integration | код ≠ 0; вывод содержит `start it with` и `docker compose --profile test up -d --wait postgres-test`; нет `SKIP` (12 §6 п.11) |
| `TestWS07MigrationsApplied` | integration | при наличии `backend/migrations/control/*.sql` таблица `goose_db_version` содержит версии в порядке, равном лексикографическому порядку файлов (12 §6 п.12); каталога нет → `t.Log("no migrations yet")` |
| `TestWS07TenantDBIsolated` (`t.Parallel()`, 8 подтестов) | integration | уникальные имена БД; `CREATE TABLE` в одной не видна в другой; после `Cleanup` счётчик `pg_database` возвращается к исходному |
| `TestWS07NoWallClockLiterals` | integration | обход `backend/test/**/*.go` кроме `harness.go`: регэксп `20\d\d-\d\d-\d\d` не встречается (12 §6 п.15) |
| `TestWS07NowIsFixed` | integration | `harness.Now()` = `2026-10-01T10:30:00+03:00`; `Now().Weekday()` = `Thursday`; `Until(7*24*time.Hour)` = 8 октября (Q-15 «Приглашение до 08.10») |
| `TestWS07TestcontainersFallback` (`TESTCONTAINERS=1`, Docker доступен) | integration | контейнер `postgres:17` стартует; `SELECT version()` содержит `PostgreSQL 17` |
| `TestWS07ProblemReader` | integration | `{"type":"…","code":"forbidden_action","status":403,"requestId":"r1"}` → `Problem{Code:"forbidden_action", Status:403, RequestID:"r1"}`; `NotFoundBody` = содержимое `testdata/notfound.json` байт-в-байт, с `\n` в конце (12 §3.2 R7) |

## 7. Шаги реализации (TDD-циклы по порядку)

| № | Единица | Красный тест | Реализация | Рефакторинг | Оценка |
|---|---|---|---|---|---|
| 1 | Скелет: `packages/e2e-kit/package.json`, `tsconfig`, `tools/page-keys.json`, spec'ы с 27 `test.fixme` (H1–H27), `docs/plan/evidence/README.md` | `pnpm exec playwright test --list` показывает 22 пункта под `mobile-390`/`desktop-1440` и 5 под `docs-*` (12 §6 п.5); schema-тест `page-keys.json` красный на пустом файле | заполнить 38 записей из МП §5.3/§4.7/§4.9/§2.4 | — | 3 ч; коммит `test(ws-07): e2e-скелет харнесса и реестр ключей` |
| 2 | `tools/vendor/` + sha384-тест | `node --test tools/__tests__/vendor.test.js` красный (нет файлов) | скачать `react@18.3.1/umd/react.production.min.js`, `react-dom@18.3.1/umd/react-dom.production.min.js` с unpkg; сверить SRI; `README.md` (источник, дата, sha384) | — | 1 ч |
| 3 | `design-preview.js --offline: rewriteDcHtml()` + маршруты | unit на фрагментах `:1–15` и `Документация.dc.html:13–17, :323`; regression без флага | чистая функция + `/__vendor`, `/__fonts`, `/__modules` | вынести MIME-таблицу и список подстановок в константы | 3 ч |
| 4 | Конфиг web: 3 проекта, `webServer[]`, env | H1 красный → зелёный; grep-тест литералов; `PORT=3001 … --list` содержит `127.0.0.1:3001` | `playwright.config.ts` по §4.1.2 | хелпер `env(name, default)` | 2 ч |
| 5 | Фикстура `net` → H2, H3 | красные | сбор `request`/`console`; `assertNoCdn()`; allowlist хостов `[127.0.0.1:${PORT}, 127.0.0.1:4173]` | — | 1 ч |
| 6 | `persona.ts`, `demo-panel.ts` → H5, H6, H7, H19 | красные на пустом `DemoPanel` | `selectOption` по `value`; ожидание `role=status[aria-label="Загрузка"]` появиться/исчезнуть (`expect`, без `waitForTimeout`); `flag` через `getByLabel(FLAG_LABEL[k]).setChecked(on)`; `reset` → `getByRole('button', { name: 'Сбросить' })` | — | 3 ч |
| 7 | `clock.ts` + автофикстура → H8 | красный (время не 10:30) | `page.clock.install({ time: CLOCK })` в `context`-фикстуре до `goto` | — | 1 ч |
| 8 | `recipes.ts`, `recipes/_base/*`, `reference.ts`, `app.ts`, `hidePanel` → H9, H10, H11 | красные | `RecipeApi` над `Page`; `goMenu` через лист «Ещё» при видимом `nav[aria-label="Навигация"]`; `confirm(title, button, ack)`; `openReference` — **новый контекст** с viewport проекта, часами, локалью; `openApp` — тот же `RecipeApi` на `#app` | один класс `RecipeApi`, разный `root` | 5 ч |
| 9 | `labels.ts` + `normalizeLabel` → unit, H12, H13 | unit красный, затем H12 | `page.evaluate` над `root`: `button, a, h1, h2, h3, label, [aria-label]`; исключения `PANEL`, `[data-a11y-extra]`, `aria-hidden="true"`; формат `tag:text`/`aria:text` | — | 3 ч |
| 10 | `compare.ts` (`pixelmatch` + `pngjs`), `match-reference.ts` → H14–H18 | H14 красный без `comparePng`; H17 красный (`TypeError`) | `matchReference`: baseline-путь по `snapshotPathTemplate`; если файла нет или `REFERENCE_REFRESH=1` — снимок `ref.root` пишется в baseline; затем `expect(app.root).toHaveScreenshot('<key>.png', { maxDiffPixelRatio })`; при провале `testInfo.attach` expected/actual/diff | одна константа `screenshotOptions` | 4 ч |
| 11 | `axe.ts` → H20; `allowlist.ts` → H21 + unit | красные | `@axe-core/playwright` с `exclude`; парсер строк D-50 | — | 2 ч |
| 12 | `app.spec.ts` → H22 | красный до заготовки WS-01 (иначе `fixme` с блокером) | — | — | 0,5 ч |
| 13 | `apps/docs/playwright.config.ts` + `harness.spec.ts` → H23–H27 | красные | 4 проекта; `/__modules` для mermaid/marked/js-yaml; `frameLocator` для фреймов | общий `reference.ts` для docs (`root = '#dc-root'`) | 3 ч |
| 14 | `tools/e2e-skeleton.js` | unit на 5 фикстурах + `render` + «не перезаписывает» | парсер и шаблон по §4.1.5; `--dry` | шаблон в `tools/templates/spec.ts.tmpl` | 4 ч |
| 15 | `tools/verify-pages.js` | unit `keysForPaths`, `isFresh`, `main` с поддельным `git` | по §4.1.6; читает `page-keys.json` | — | 3 ч |
| 16 | `tools/labels-dump.js` + `e2e/_tools/labels-dump.spec.ts` | `node tools/labels-dump.js --persona owner --page "Главная" --width 1440` печатает JSON с 14 пунктами меню (как H12) | обход `testIgnore` через `LABELS_DUMP=1`; `--out` | — | 1,5 ч |
| 17 | `.mcp.json`, `pnpm mcp:install`; ручная проверка 12 §6 п.1–3 через `ToolSearch("mcp__playwright")` после перезапуска; evidence `docs/plan/evidence/harness/mcp.md` | — | — | — | 1 ч |
| 18 | Go: `testdb`, `harness.go` → тесты (г) | `go vet -tags integration ./test/...` компилируется; `TestWS07HarnessFailsWithoutDB` красный | по §4.1.10; goose как библиотека; ветка `TESTCONTAINERS=1` | `golangci-lint run` чистый под `build-tags` | 5 ч |
| 19 | Отчёт `docs/plan/reports/WS-07.md` (`orchestration.md` §5), строка `status.md` | — | — | — | 1 ч |

Итого ≈ 47 ч ≈ 2,5 сессии (M). На каждую единицу: `test(ws-07): …` → `feat(ws-07): …` → `refactor(ws-07): …` (12 §8 п.25); красный тест падает на утверждении, а не на импорте (`tdd-protocol.md` §1).

## 8. Проверка страницы

Страниц у WS нет; `verification-protocol.md` применяется к целям §5; evidence — `docs/plan/evidence/harness/`.

### 8.1 Команды e2e

- `pnpm exec playwright test --config frontend/apps/web/playwright.config.ts --grep @harness --project=mobile-390 --project=desktop-1440` (27 → 0 `fixme`; допустимы H4/H22 с ссылкой в отчёте).
- `… --grep @smoke` на трёх проектах.
- `pnpm exec playwright test --config frontend/apps/docs/playwright.config.ts --grep @harness` на четырёх проектах.
- `$env:PORT = "3001"; pnpm exec playwright test --list` → `127.0.0.1:3001`.
- `node --test tools/__tests__`; `pnpm --filter @ortus/e2e-kit test`.
- `go test -tags integration ./backend/test/...` (с `TESTCONTAINERS=1` или compose `postgres-test`).

### 8.2 Тот же экран в эталоне и в реализации

- Эталон: `node tools/design-preview.js design 4173 --offline` → `http://127.0.0.1:4173/Ортус%20CRM.dc.html` → «Персонаж» = «Владелец · Дарья Зимина» → «Ширина» = «По окну» → меню «Модули и место» (на 390: «Ещё» → лист «Все разделы» → «Модули и место»).
- Реализация (после WS-10): `http://127.0.0.1:5180/t/t-alta/modules?persona=owner`.

### 8.3 Визуальная сверка

- H14–H16, H27: эталон против эталона = 0 пикселей на 390×844 и 1440×900, область `#dc-root`.
- H17: `matchReference('home')` против заглушки даёт `ratio > 0.01`; baseline-файлы `e2e/visual/__screenshots__/<platform>/desktop-1440/home.png` и `…/mobile-390/home.png` появляются как снимки эталона.
- Коммитятся только `linux/`; `win32/` в `.gitignore` (D-32).

### 8.4 MCP-проходка (12 §6 п.1–3; `verification-protocol.md` §4) — после перезапуска сессии с `.mcp.json`

1. `browser_navigate` → `http://127.0.0.1:4173/Ортус%20CRM.dc.html`.
2. `browser_snapshot` → есть `region "Панель демонстрации"`, `combobox "Персонаж"`, `combobox "Ширина"`, `button "Путь проверки"`, `button "Сбросить"`, `checkbox "Нет связи"`, `navigation "Основная навигация"`, `heading` с «Дарья»; ответ не содержит `Browser "chrome-for-testing" is not installed`.
3. `browser_select_option` «Персонаж» → «Водитель · Илья Васильев» → `browser_snapshot`: `heading "«Логистика» не подключена организацией"`, `button "Демо: открыть как владелец"` (01 §20 #14).
4. `browser_click` «Демо: открыть как владелец» → `heading "Модули и место"`.
5. `browser_resize` 390×844 → `navigation "Навигация"` с «Главная», «Модули», «Люди», «Ещё»; `browser_resize` 768×1024 → боковая панель 68 px без заголовков групп (01 §20 #5–6).
6. `browser_console_messages` → нет `[dc-runtime]`, нет ошибок; `browser_network_requests` → только `127.0.0.1:4173`.
7. `browser_take_screenshot` на 390/768/1440 → `docs/plan/evidence/harness/{390,768,1440}.png`, плюс `snapshot.txt`, `console.txt`, `network.txt`; `git status --porcelain` не показывает `.playwright-mcp/`.
8. Если инструменты `mcp__playwright__*` отсутствуют — блокер WS (протокол §4, последний абзац), не обход.

### 8.5 Evidence

`docs/plan/evidence/harness/` (п.8.4) + `docs/plan/evidence/harness/mcp.md` с выдержками `browser_snapshot`.

## 9. Критерии готовности (DoD)

- [ ] 27 пунктов H1–H27 без `fixme` (допустимы только H4 → «WS-04» и H22 → «WS-01», указаны в отчёте); `tdd-protocol.md` §4.
- [ ] `--grep @harness` зелёный на `mobile-390` + `desktop-1440` (web) и на 4 проектах (docs); `--grep @smoke` на 3 проектах; процесс завершается сам (12 §6 п.6).
- [ ] H14–H16, H27: `diffPixels === 0`; H17 красный «по делу» (МП §6.5, барьер 0→1).
- [ ] `node --test tools/__tests__` и `pnpm --filter @ortus/e2e-kit test` зелёные: все строки таблицы §6(б).
- [ ] `node tools/e2e-skeleton.js home --dry` после WS-00 даёт 11 + 6 + 4 теста; `repair-tabs` — 43 пункта (#1–5, #10–47) + 6 + 3 гейта (owner Г-М, foreman Г-М, owner@t-lotos Г-М) + рецепты `repair-on`, `repair-tabs-*`, с комментарием об исключении #6–9 (D-36).
- [ ] `node tools/design-preview.js design 4173 --offline` при отключённой сети отдаёт CRM, документацию и три фрейма без `.sc-logic-error`; без флага — байт-в-байт как раньше (regression-тест).
- [ ] `.mcp.json` в корне; `pnpm mcp:install` выполнен; evidence §8.4 приложено; `.playwright-mcp/` не попадает в `git status`.
- [ ] Go: `go vet -tags "integration isolation concurrency" ./backend/test/...` и `golangci-lint run` (с `build-tags` WS-01) чистые; тесты (г) зелёные с базой; без базы — падение с `start it with`, не skip.
- [ ] `collectLabels` исключает `[data-a11y-extra]` и панель; не читает `data-screen-label` (МП §4.8).
- [ ] Нет `waitForTimeout` и условных ожиданий в `e2e-kit`/фикстурах (ESLint `playwright/no-wait-for-timeout`).
- [ ] Ни один `e2e/**` файл не содержит литералов `:5173`/`:3000`/`:4173` (12 §6 п.4).
- [ ] `docs/plan/evidence/README.md` описывает 9 файлов и папки `verify/`, `phase2/`; `verify-pages.js` проверяет те же имена.
- [ ] Отчёт `docs/plan/reports/WS-07.md` по `orchestration.md` §5: таблица red→green (коммиты), дословный вывод четырёх прогонов §8.1, раздел «Контракты, которые я изменил» = запросы к интегратору (§4.2); строка WS-07 в `status.md` → «на проверке».
- [ ] Ревью: порядок коммитов `test(` → `feat(` (12 §6 п.21); подписи персонажей/флагов дословно `:34–65`; `git diff --stat main..HEAD -- design` пуст.

## 10. Риски, расхождения, открытые вопросы — что делаем по умолчанию

| # | Риск / расхождение | По умолчанию |
|---|---|---|
| 1 | МП §2.2 предписывает подставлять React через `window.__resources`, но при заданном `__resources` `boot()` **пропускает** повторный `fetch(location.href)` сырого шаблона (`support.js:158–164`) — путь рендера отличался бы от онлайн-версии | предзагрузка `window.React/ReactDOM` до `support.js` (`:1839–1840`; 11 §7.4 п.1 «альтернатива»); `__resources` не задаётся; зафиксировать как уточнение МП §2.2 в отчёте (снимок не меняется) |
| 2 | Google Fonts отдаёт субсеты с `unicode-range`; локальные woff2 WS-04 могут отличаться версией → эталон-офлайн ≠ эталон-онлайн по пикселям | допустимо: канон — обе цели на одних локальных шрифтах (D-21); один раз на dev-машине с сетью снять `reference-online` vs `reference-offline` и приложить отношение в отчёт (информационно) |
| 3 | Документация на 4173 тянет marked/js-yaml/mermaid с jsdelivr (`Документация.dc.html:16–17, :323`) — вне буквального объёма МП §2.2, но без этого `docs-*` сверка в CI без сети невозможна | `--offline` подменяет и jsdelivr (`/__modules/`) из `node_modules` с точными версиями (11 §7.4 п.3, §12 п.19); версии — ближайшие к `marked@12`, `js-yaml@4`, `mermaid@11`; записать в `tools/vendor/README.md` |
| 4 | `tdd-protocol.md` §3 называет ключ `driver-today`; МП §4.8 — `today` | ключи только из `page-keys.json` (МП §5.3); протокол не правится |
| 5 | Baseline per-platform (D-32) vs «эталон снимается живьём»: что лежит в `__screenshots__`? | baseline = снимок **эталона**, записанный `matchReference` при отсутствии файла или `REFERENCE_REFRESH=1`; `--update-snapshots` запрещён (ESLint-правило/`CLAUDE.md`); CI-job `visual` сначала `e2e:reference-refresh`, затем сравнение; коммитятся только `linux/` |
| 6 | Stop-хук: «напоминание» (МП §7.3) или блокировка? Код 2 заставляет Claude Code продолжать | по умолчанию код 0 + текст; `VERIFY_PAGES_BLOCK=1` → код 2 (защита от зацикливания по `stop_hook_active`); `workflow.template.js` может выставлять переменную исполнителям (предложение интегратору, МП §7.5) |
| 7 | 12 §6 п.11–12 описывают compose-`postgres-test`, МП §8.1 — testcontainers | три источника по порядку (`TEST_DATABASE_URL` → 5433 → `TESTCONTAINERS=1`); сообщение об ошибке называет все три |
| 8 | Миграции: R4 (`*.up.sql` лексикографически) vs D-06 (goose) | goose как библиотека; версии `0001_…` упорядочены так же; `TestWS07MigrationsApplied` сравнивает оба порядка |
| 9 | `backend/go.mod` и `frontend/package.json` не принадлежат WS-07; без `pgx`/`goose`/`testcontainers`, `marked`/`js-yaml`/`mermaid` часть не собирается | первым сообщением — запрос интегратору; до ответа — остальная FE-часть; в отчёте — «блокировано: go.mod / package.json» |
| 10 | Заготовка `apps/web` для `@smoke` отсутствует (WS-10 — волна 1) | H22 `fixme` со ссылкой; барьер 0→1 проверяет интегратор после заготовки WS-01 или минимального `index.html` от WS-10 |
| 11 | Демо-панель занимает высоту; `display:none` меняет раскладку фрейма (`height:100vh`, `:28`) | прототип измеряет ширину, не высоту (`:2384–2393`); `hidePanel` ставит `display:none` на обеих целях и снимает `#dc-root`/`#app` — одинаковый эффект; зафиксировать в `e2e-kit/README.md` |
| 12 | `page.clock.install` не влияет на `Intl` и CSS-анимации; `ox-pulse` (`:25`) даёт нестабильный скелетон | снимок только после исчезновения `role=status[aria-label="Загрузка"]`; `animations: 'disabled'` и при снятии эталона, и при сравнении |
| 13 | «Массажист · Анна Морозова» встречается дважды (`:40`, `:45`) — `selectOption({ label })` неоднозначен | `setPersona` выбирает по `value` (`therapist` / `therapist@t-lotos`); подписи проверяются отдельно (H5) |
| 14 | На 390 пункт меню не в `nav[aria-label="Основная навигация"]`, а в листе «Все разделы» (01 §9.6) | `goMenu` детектирует ширину по видимости `nav[aria-label="Навигация"]` и идёт через «Ещё»; на эталоне с «По окну» и viewport 390 поведение то же |
| 15 | `@playwright/mcp 0.0.78` может не соответствовать текущему `@playwright/test` (12 §3.2 R1) | взять последнюю версию MCP с совпадающей зависимостью `playwright`; точную версию и дату — в `tools/vendor/README.md` |
| 16 | `labels-dump` для `usage` (04 §5.2) нужен WS-00 до генерации скелетов, а инструмент появляется здесь | WS-00 выполняет этот шаг после слияния WS-07 (интегратор добавляет ребро `WS-07 → WS-00 (labels-dump)` в DAG); остальное WS-00 не ждёт |
| 17 | Q-103 (per-platform) и Q-108 (хранение verify-скилов) — «уточняется в мастер-плане» | D-32 принят; скилы не создаются (`verifyPrompt` шаблона; МП §9.3 Q-108) |
| 18 | `baseURL` `127.0.0.1` vs D-25 «один origin `http://localhost:5173`» | в mock-режиме origin `127.0.0.1` (12 §6 п.4 ожидает именно его); в `stand` — `E2E_BASE_URL` (WS-53); cookie-origin фазы 2 не затрагивается |

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-07 «e2e-harness-mcp» (волна 0, infra, M) проекта «Ортус CRM». Прочитай полностью `docs/plan/ws/WS-07-e2e-harness-mcp.md`, затем `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md`, `docs/plan/orchestration.md` и все входы из §3 брифа (12 §3.2 R1–R4, R16; 12 §6 п.1–16; 12 §8 п.4–7, 19–22; 01 §5, §6, §20; 11 §7.1, §7.4, §12 п.9, 18–19; 06b §20 п.6–8; МП §2.2–2.4, §4.8, §4.9, §5.3, §7.4; D-22, D-26, D-29, D-32, D-45, D-49, D-50). Прочитай `design/support.js:150–199, 1143–1153, 1838–1847` и `design/Ортус CRM.dc.html:1–70` — эти строки определяют `--offline` и фикстуру `demo`. `design/` не трогай.

Работай в worktree `ws/ws-07-e2e-harness-mcp` от `main`, `$env:PORT = "5180"`, `pnpm install`, `pnpm e2e:install`, `pnpm mcp:install`. Строго по `tdd-protocol.md`: первый коммит — `test(ws-07): …` со всеми 27 пунктами H1–H27 в `test.fixme` и `tools/page-keys.json`; далее циклы §7 брифа по порядку, на каждую единицу красный тест → минимальная реализация → рефакторинг, отдельные коммиты `test(` → `feat(` → `refactor(`. Публикуемые имена из §4.1 заморожены — не переименовывай. Файлы вне §2.1 не создавай; зависимости для `backend/go.mod` и `frontend/package.json`, скрипты корневого `package.json` запроси у интегратора через `SendMessage` и продолжай FE-часть.

Перед завершением выполни §8 брифа: прогоны §8.1 (web `@harness` + `@smoke`, docs `@harness`, `node --test tools/__tests__`, `go test -tags integration ./backend/test/...`), MCP-проходку эталона §8.4 через `mcp__playwright__*` (после перезапуска сессии с `.mcp.json`; если инструментов нет — это блокер, опиши его, не подменяй), evidence в `docs/plan/evidence/harness/`. Напиши `docs/plan/reports/WS-07.md` по `orchestration.md` §5 с дословным выводом прогонов и таблицей red→green, обнови свою строку в `docs/plan/status.md`. Верни: ветку, путь отчёта, список оставшихся `fixme` с причинами (ожидаются только H4/WS-04 и H22/WS-01), список запросов к интегратору, `testRunsOk`.
