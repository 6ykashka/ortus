# WS-04 · @ortus/tokens, контракт пропсов и стабы @ortus/ui, Storybook-каркас

Волна 0 · Размер M · Вид `ui-kit` · Зависит от: WS-01 · Блокирует: WS-10, WS-11, WS-12, WS-13, WS-14, WS-32 (00-master-plan §5.1, §6.1)

Условные ссылки: «11 §3.4» = `docs/plan/analysis/11-design-system-and-docs-site.md` §3.4; «`:2330`» = `design/Ортус CRM.dc.html:2330`; «`ДС:186`» = `design/Дизайн-система.dc.html:186`; «`tokens.json:21`» = `design/docs/design-system/tokens.json:21`; «МП §4.4» = `docs/plan/00-master-plan.md` §4.4.

## 1. Цель

После WS-04 оба приложения и Storybook берут цвета, шрифты, размеры и движение из одного пакета `@ortus/tokens`, значения которого побайтно равны `tokens.json` дизайн-системы плюс `prototype`-алиасы, воспроизводящие литералы рендера `Ортус CRM.dc.html` (D-28: `:root` `:17`, `LINE` `:2330`, 36/40 px, радиусы 14 px / `16px 16px 0 0`); три шрифта грузятся локально без единого запроса в сеть (D-21). `@ortus/ui` экспортирует замороженный на волну 1 список из 30 контрактных единиц `components.md:17–44` (+ `Meter`, `Nav` из МП §4.4) с типами пропсов 1:1 и стабами `data-stub`, так что WS-10/11/12/13/14 компилируются против контракта, а их красные тесты падают по роли/тексту, а не по импорту (МП §8).

## 2. Границы файлов

### 2.1 Создаёт (владеет)

```text
frontend/packages/tokens/
  package.json                      name @ortus/tokens; exports: ".": ./src/tokens.ts, "./tokens.css", "./base.css", "./fonts.css" (→ fonts/fonts.css)
  tokens.json                       копия design/docs/design-system/tokens.json + узлы с $extensions["ortus.prototype"] (§4.1)
  scripts/build.mjs                 генератор tokens.json → src/tokens.css + src/tokens.ts (Node 22, без зависимостей)
  scripts/fetch-fonts.mjs           однократная загрузка шрифтов по manifest.json (пин URL + sha256)
  src/tokens.css, src/tokens.ts     сгенерированные, коммитятся; drift-тест (§6б)
  src/tail.css                      шаблон хвоста: @media (prefers-reduced-motion) и :focus-visible — дословно tokens.css:47–51
  src/base.css                      глобальные правила прототипа :18–25 через var(--ox-*) (§10 п.4)
  fonts/fonts.css, fonts/manifest.json, fonts/*.woff2|*.ttf, fonts/LICENSE-*.txt
  test/*.test.ts, vitest.config.ts
  e2e/tokens.spec.ts, e2e/fixtures/tokens.html, e2e/serve.mjs, playwright.config.ts
  README.md                         правила именования переменных, как добавить prototype-токен (ссылка на D-28)
frontend/packages/ui/
  package.json, tsconfig.json, vitest.config.ts, playwright.config.ts
  src/index.ts                      ЗАМОРОЖЕН на волну 1: export * from './core'; export * from './domain'; export type * from './types'
  src/core/index.ts                 29 стабов через makeStub: 27 контрактных + Icon, VisuallyHidden (WS-12 в волне 1 заменяет строку за строкой)
  src/domain/index.ts               11 стабов (WS-13 заменяет)
  src/types/**                      типы пропсов (§4.2), contract.ts (PROP_KEYS), stub.tsx (makeStub), brand.ts
  .storybook/main.ts, preview.ts, viewports.ts
  .storybook/skeleton/<Name>.stories.tsx   29 файлов «скелет состояний» (§5), title 'Contract/<Name>'
  .storybook/fixtures/minimal-props.tsx    минимальные пропсы каждой единицы (общие для историй и test/stubs)
  test/*.test.ts(x), test/types/*.test-d.ts
  e2e/storybook.spec.ts
docs/plan/reports/WS-04.md, docs/plan/evidence/storybook-contract/**, строка WS-04 в docs/plan/status.md
```

### 2.2 Запрещено трогать

`design/**` (эталон, `orchestration.md` §7); `frontend/packages/ui/src/core/**` и `src/domain/**` кроме двух `index.ts` (WS-12/WS-13); `frontend/packages/domain/**` (WS-05); `frontend/packages/texts/**` (WS-08); `frontend/apps/**` (WS-10/WS-11); `frontend/package.json`, `pnpm-workspace.yaml`, `.github/**`, `.claude/settings.json`, `tools/**` (WS-01/WS-07) — нужные им изменения (скрипты `e2e:tokens`, `e2e:ui`, job `storybook`) описываются в отчёте, раздел «Контракты, которые я изменил», и вносятся интегратором.

### 2.3 Worktree, ветка, порты (Windows-dev, 12 §8 п.3, 16, 25; МП §7.4)

```powershell
git worktree add ..\ortus-ws-04 -b ws/04-tokens-ui-contract main
Set-Location ..\ortus-ws-04; pnpm install            # pnpm install в КАЖДОМ worktree
$env:PORT = 5177                                     # 5173 + 04: статическая страница e2e/fixtures/tokens.html
$env:STORYBOOK_PORT = 7177                           # Storybook исполнителя; 6006 не использовать (чужие агенты)
pnpm e2e:install; pnpm mcp:install                   # два разных браузера (12 §8 п.4)
```

PowerShell 5.1: без `&&` (цепочка `A; if ($?) { B }`); коммиты только `git commit -F <файл без BOM>` вида `test(ws-04): …` → `feat(ws-04): …` → `refactor(ws-04): …` (12 §8 п.25). Шрифты скачиваются один раз `node scripts/fetch-fonts.mjs` (нужен интернет, `HTTP_PROXY` уже экспортирован — 12 §8 п.3); после этого всё работает офлайн.

## 3. Входы

| Источник | Что брать |
|---|---|
| `design/docs/design-system/tokens.json:1–79` | весь каталог: цвета `:3–28` (16 базовых + `tone` `:21–27`), шрифты `:29–42`, `space` `:43–47`, `radius` `:48–51`, `shadow` `:52–57`, `size` `:58–65`, `breakpoint` `:66–70`, `motion` `:71–75` (с `$description` о reduced-motion), `icon.set` `:76–78` |
| `design/docs/design-system/tokens.css:1–52` | целевой вид CSS: имена `--ox-*` `:2–45`, `@media (prefers-reduced-motion: reduce)` `:47–49`, `:focus-visible` `:51` |
| `design/docs/design-system/components.md:15–44` | 28 строк контракта: пропсы (колонка 2), состояния (3), доступность (4) |
| 11 §3.1–3.3 | назначение каждого токена дословно (`$description`, подписи витрины) |
| 11 §3.4 | перепись хексов CRM → токены; таблица «вне палитры» (15 позиций) и тени вне токенов — источник `prototype`-алиасов |
| 11 §4.1–4.20 | как каждая единица нарисована на витрине и в CRM (строки `ДС:*` и `:*`) — основа комментариев в типах и имён историй |
| 11 §8 | три шрифта: точные URL Google Fonts `:13–15`, оси `opsz,wght,FILL,GRAD@24,400,0..1,0`, размеры иконок 15/16/18/20/22/24/28/32, `FILL 1` только у активного пункта нижней навигации (`:2196`) |
| 11 §10 #33–35 | чек-лист «Токены/шрифты» — пункты T1–T3 e2e-скелета |
| 11 §11 Q1–Q5 | расхождения CRM ↔ `tokens.json` (`LINE`, `--ox-accent-tint`, 36/40 px, радиусы 14/16, счётчик табов neutral) — закрыты D-28/Q-33 |
| 11 §12 п.1–3, 15–17 | 79 строк токенов → CSS+TS; 30 компонентов; пакеты `packages/tokens`, `packages/ui` + Storybook (`14-engineering.md:45–46`, `docs/README.md:42`); витрина как источник снимков (WS-12); расхождения закрыть до `@ortus/ui`; `tokens.css` глобально |
| 01 §22 п.9, 16–18 | `TONE`/`LINE` `:2329–2330`; размеры целей 44/48/60/40/36/32; цвета оболочки (`#F2F3EF`, `#E6E9E3`, `#22302C`, шапка оператора `#1C2A26`, `#F8F9F6`, `#DCE2D9`, `#CDD5CB`, `#E8ECE5`); шрифты локально по D-21 |
| 02 §12 п.4 | общие компоненты четырёх страниц компании: карточка, pill `ch`, кнопки primary/secondary/text/danger-outline, select/input 44, switch 44×26 и 40×22, confirm с секциями и ack, тост, баннер, meter |
| 02 §12 п.7, 13 | акцент — 4 переменные на `:root`, в компонентах нет литералов акцента; `brandVars/contrastW/fixAccent` — чистые функции `:2350–2356` |
| `Ортус CRM.dc.html:13–25` | подключение шрифтов, `:root` `:17`, глобальный CSS `:18–25` (`base.css`) |
| `Ортус CRM.dc.html:2329–2331, :2350–2356, :2359–2360, :3957` | `TONE`, `LINE`, `ch`, функции бренда, `STRIPES`, `SIDES`, радиусы модалки/листа |
| `Дизайн-система.dc.html:157–215` | сетка кнопок «Обычное / Наведение / Фокус / Выполняется / Недоступно», мобильная 52 px `:195–202`, icon-button `:207–208`, compact `:209–210` |
| МП §4.3, §4.4, §8.1 (колонка ui-kit), §7.4 | контракт токенов и компонентов, матрица шагов, порты |
| `decisions.md` D-13, D-21, D-22, D-28, D-29; Q-32, Q-33, Q-34 | свой UI на React Aria; шрифты локально OFL; порог 1 %; канон — рендер CRM, токены дополняются `prototype`-алиасами; невидимые a11y-добавки с `data-a11y-extra`; поведение по умолчанию «как в прототипе» |
| 12 §8 п.2, 19, 20, 30 | пины версий (`react 19.2.8`, `vite ^8.2.2`, `vitest ^5`, `@playwright/test ^1.62.1`, `typescript ^5`); локальные шрифты в CI; тест лигатуры по `font-family`, не по `textContent`; числа только из `tokens.css`/`components.md` |

## 4. Контракты

### 4.1 Публикует: `@ortus/tokens`

**Правила генерации `tokens.json` → `src/tokens.css`** (проверяются табличным тестом §6б):

| Путь токена | CSS-переменная | Пример |
|---|---|---|
| `color.<name>` | `--ox-<name>` | `color.canvas` → `--ox-canvas: #E6E9E3` |
| `color.tone.<tone>.<part>` | `--ox-<tone>-<part>` | `--ox-ok-bg: #E3EFE7` |
| `font.family.<k>` | `--ox-font-<k>` (массив → `'Golos Text', system-ui, sans-serif`; имена с пробелом в одинарных кавычках) | `--ox-font-mono: 'IBM Plex Mono', ui-monospace, monospace` |
| `font.size.<k>` / `font.line-height.<k>` / `font.weight.<k>` | `--ox-fs-<k>` / `--ox-lh-<k>` / `--ox-fw-<k>` | `--ox-fs-2xl: 24px`, `--ox-lh-base: 1.45`, `--ox-fw-semibold: 600` |
| `space.<n>` / `radius.<k>` / `shadow.<k>` / `motion.<k>` | `--ox-space-<n>` / `--ox-radius-<k>` / `--ox-shadow-<k>` / `--ox-motion-<k>` | `--ox-radius-pill: 999px`, `--ox-motion-fast: 120ms` |
| `size.<k>` | `--ox-<k>` | `--ox-control: 44px`, `--ox-control-mobile: 48px`, `--ox-icon: 20px`, `--ox-header: 58px` |
| `breakpoint.<k>` | `--ox-bp-<k>` (информационно; в коде — `breakpoints` из `tokens.ts`) | `--ox-bp-sidebar: 1080px` |
| `icon.set` | `--ox-icon-set` | `--ox-icon-set: 'Material Symbols Rounded'` |

Хвост файла — `src/tail.css` дословно из `tokens.css:47–51`: `@media (prefers-reduced-motion: reduce) { :root { --ox-motion-fast: 0ms; --ox-motion-base: 0ms; } }` и `:focus-visible { outline: 2px solid var(--ox-focus); outline-offset: 2px; }`. Каждое объявление `tokens.css:3–44` (64 штуки: 16 + 15 + 2 + 7 + 2 + 8 + 5 + 3 + 4 + 2) присутствует с тем же значением; добавочные переменные ограничены allowlist `EXTRA_VARS` (`--ox-fw-*` ×3, `--ox-icon`, `--ox-bp-*` ×2, `--ox-icon-set`, все `prototype`-переменные ниже).

**`prototype`-алиасы (D-28, Q-33).** Узел в `tokens.json` с `"$extensions": {"ortus.prototype": {"ref": "<файл:строки>", "decision": "D-28"|"Q-33"}}`; без такого узла файл обязан deep-равняться `design/docs/design-system/tokens.json`.

| Токен → переменная | Значение | Источник |
|---|---|---|
| `color.accent-tint` → `--ox-accent-tint` | `#F1F7F3` | `:17`; выбранная строка/карточка `:3639, :3644, :4343`; 11 §11 Q2 |
| `color.line.ok/info/warn/danger/neutral` → `--ox-line-<tone>` | `#BFD9C8 / #C9D8E8 / #EBD7A8 / #F0C9C3 / #DCE2D9` | `LINE` `:2330`; 01 §22 п.9; 11 §11 Q1 |
| `color.chrome-header` → `--ox-chrome-header` | `#1C2A26` | шапка оператора, 01 §22 п.17; МП §5.3 `shell` |
| `color.toast-bg` → `--ox-toast-bg` | `#1C2A26` | `:2314` (11 §4.15) |
| `color.toast-icon.ok/warn/error/info` → `--ox-toast-icon-<k>` | `#8FD3AE / #F0C76E / #F2A99E / #A9C8EA` | `:2898` (11 §3.4) |
| `color.nav-group` → `--ox-nav-group` | `#6B7873` | `:152, :2304`; неактивный шаг степпера `:3429` |
| `color.nav-hover` → `--ox-nav-hover` | `#EBEFE9` | `:155, :3022` (11 §4.18) |
| `color.empty-dashed` → `--ox-empty-dashed` | `#C3CCC1` | `:383, :858` |
| `color.danger-outline` → `--ox-danger-outline` | `#E3B5AF` | `:970, :1046, :1142, :1187, :1274` |
| `color.danger-hover` / `color.danger-row-bg` | `#8A302A` / `#FFFBFA` | `ДС:186–187` / `ДС:317, :334` |
| `color.photo-bg` → `--ox-photo-bg` | `#EEF1EC` | `:609–610` |
| `color.skeleton-a` / `color.skeleton-b` | `#DFE4DC` / `#E6EAE3` | `:184–187` |
| `color.divider-soft` → `--ox-divider-soft` | `#F0F2EE` | `:129`; `Документация.dc.html:47` |
| `color.line-soft` / `color.accent-border-soft` | `#E3E8E0` / `#9CC6AE` | `:4173` / `:3185` |
| `color.local-dashed` → `--ox-local-dashed` | `#D9B76A` | `:816` |
| `color.icon-idle` → `--ox-icon-idle` | `#8A968F` | `:4327` |
| `color.stripes-a` / `color.stripes-b` | `#E9EDE6` / `#E0E5DD` | `STRIPES` `:2359` |
| `color.demo.accent/line/bg/fg-soft/fg-muted` | `#7CC4A0 / #4A5A55 / #2E3D39 / #E4ECE6 / #AFC0B8` | демо-панель `:29–66` (11 §3.4) |
| `color.demo-frame-border` | `#C9D1C7` | `:2840` |
| `color.scrim` / `color.scrim-docs` / `color.scrim-showcase` | `rgba(28,42,38,.42)` / `rgba(28,42,38,.32)` / `rgba(28,42,38,.36)` | `:2204` / `Документация.dc.html:73` / `ДС:383` |
| `color.hatch.fg/bg/stroke/paper` | `#B7791F / #F7E9C6 / #E0B457 / #FFFCF4` | `$description: "назначение не установлено (Q-33, 11 §11 п.15)"` |
| `shadow.dialog-crm` / `shadow.toast-crm` / `shadow.guide` / `shadow.demo-frame` / `shadow.switch-knob` | `0 20px 50px rgba(28,42,38,.25)` / `0 8px 24px rgba(0,0,0,.22)` / `0 16px 40px rgba(0,0,0,.28)` / `0 12px 32px rgba(28,42,38,.16)` / `0 1px 2px rgba(0,0,0,.25)` | `:2205` / `:2314` / `:69` / `:2841` / `:359` |
| `size.control-card` / `size.control-banner` / `size.control-sheet` / `size.bottom-nav` / `size.sidebar` / `size.rail` / `size.scope-select` / `size.icon-pill` | `40px / 36px / 48px / 60px / 244px / 68px / 36px / 15px` | `:220–221, :237–238` / `:178` / `:2300–2308` / `:2192–2201` / `:2843` / `:2843` / `:110` / `:216` |
| `radius.dialog` / `radius.sheet` / `radius.docs-field` | `14px` / `16px 16px 0 0` / `10px` | `:3957` / `:3957` / 11 §11 Q4 |
| `font.size.11/15/17/18/19/21/26/30` → `--ox-fs-11` … `--ox-fs-30` | `11px … 30px` | 11 §11 Q3 |
| `motion.toast` / `motion.pulse` / `motion.persona-load` | `4200ms` / `1400ms` / `320ms` | `:2440–2444` / `:184–187` / `:2470` |

**`src/tokens.ts`** (генерируется, `as const`): `color` (плоско по `--ox-*` именам без префикса: `color.accent === '#1F6B52'`), `tone: Record<Tone, {bg, fg, border}>`, `line: Record<Tone, string>`, `fontFamily: {sans, mono}` (строки как в CSS), `fontSize`, `fontWeight`, `lineHeight`, `space`, `radius`, `shadow`, `sizes: {control: 44, controlMobile: 48, controlCompact: 32, icon: 20, header: 58, controlCard: 40, controlBanner: 36, …}` (числа), `breakpoints: {mobile: 640, sidebar: 1080}` (имена по МП §4.3), `motion: {fast: 120, base: 200, toast: 4200, pulse: 1400, personaLoad: 320}`, `iconSet`, тип `Tone = 'ok'|'info'|'warn'|'danger'|'neutral'`, хелпер `cssVar('accent') === 'var(--ox-accent)'`.

**`fonts/fonts.css`** (D-21; 11 §8): `@font-face` Golos Text `font-weight: 400 700` (переменный, `format('truetype')`), `font-display: swap`; IBM Plex Mono 400 и 500, `swap`; Material Symbols Rounded переменный `font-weight: 100 700`, `font-display: block` (11 §8 п.2 — без FOUT-«слов»); класс `.material-symbols-rounded` как в Google CSS (`font-family`, `font-size: 24px`, `line-height: 1`, `display: inline-block`, `white-space: nowrap`, `font-feature-settings: 'liga'`, `-webkit-font-smoothing: antialiased`); оси по умолчанию `FILL 0, wght 400, GRAD 0, opsz 24` (`tokens.json:77`), `FILL 1` задаётся потребителем через `font-variation-settings` (`:2196`). `fonts/manifest.json`: `[{file, family, weight, url, sha256, license}]`; лицензии: Golos Text — OFL 1.1, IBM Plex Mono — OFL 1.1, Material Symbols — Apache 2.0 (§10 п.2). Пути `url()` в `fonts.css` относительные (`./GolosText[wght].ttf`), без `http`.

**`src/base.css`** — порт `:18–25` на переменные: `html,body{margin:0;background:var(--ox-canvas);color:var(--ox-text);font-family:var(--ox-font-sans);-webkit-font-smoothing:antialiased}`, `*{box-sizing:border-box}`, `button,input,select,textarea{font:inherit;color:inherit}`, `button:disabled{opacity:.45;cursor:not-allowed}`, `:focus-visible{outline:2px solid var(--ox-accent);outline-offset:2px}` (`:22` — акцент, не `--ox-focus`, §10 п.5), `a{color:var(--ox-accent)} a:hover{color:var(--ox-accent-hover)}`, `@keyframes ox-pulse{0%{opacity:.5}50%{opacity:1}100%{opacity:.5}}`. Подключается после `tokens.css` в `apps/web` (WS-10) и `apps/docs` (WS-11).

### 4.2 Публикует: `@ortus/ui` — замороженный экспорт-лист и типы

Экспорт-лист `src/index.ts` (сортировка — как в тесте `exports.test.ts`): **core** (WS-12, 29 имён = 27 контрактных + 2 служебных): `Button, IconButton, Icon, VisuallyHidden, Field, TextInput, NumberInput, MoneyInput, DateInput, Select, Textarea, Checkbox, Switch, RadioGroup, Radio, Status, Banner, AccessGate, Card, Dialog, ConfirmDialog, Sheet, Toast, EmptyState, Skeleton, Tabs, Meter, Nav, ScopeSelect`; **domain** (WS-13, 11 имён): `SyncState, DataTable, CheckList, PhotoSlot, LoadBar, Stepper, ConflictNotice, ReadinessBar, DecisionQueue, ObjectHeader, RoleEditor`. Итого 40 экспортов = 38 компонентов 30 контрактных единиц (28 строк `components.md:17–44` + `Meter` + `Nav`; `AppShell` — только тип `AppShellProps`, реализация в `apps/web/src/shell`, МП §4.4) + 2 служебных примитива (`Icon`, `VisuallyHidden`, §10 п.6). `Chip/Pill` из МП §4.4 = `Status` (11 §4.5 «Status (pill)», хелпер `ch` `:2331`), отдельного экспорта нет.

Общие типы (`types/common.ts`): `Tone`, `ToastTone = 'ok'|'warn'|'error'|'info'` (`:2898`), `IconName = string` (лигатура Material Symbols), `Action = {label: string; onPress: () => void; icon?: IconName}`, `Size44 = 'md'`. Текстовые пропсы — `string`/`ReactNode`; компоненты не импортируют `@ortus/texts` в контракте (тексты передаёт потребитель или WS-12/13 по 01 §11–§12).

| Единица (`components.md`) | Пропсы (TS, обязательные без `?`) | Инварианты a11y / прототипа, зафиксированные в JSDoc типа | Реализует |
|---|---|---|---|
| `Button` (`:17`) | `variant?: 'primary'\|'secondary'\|'ghost'\|'danger'\|'danger-secondary'`; `size?: 'md'\|'lg'\|'compact'\|'card'\|'banner'` (44/48/32/40/36); `icon?`; `loading?`; `loadingLabel?: string` («Принимаем…»); `disabled?`; `disabledReason?: string`; `type?`; `onPress?`; `children: ReactNode` | `disabledReason` → `<span id>` + `aria-describedby`; `loading` → `aria-busy="true"`, ширина сохраняется (`ДС:168`); `danger-secondary` рамка `--ox-danger-outline` (`:970`); `card`/`banner` — D-28 | WS-12 |
| `IconButton` (`:18`) | `icon: IconName`; `'aria-label': string`; `badge?: number\|string`; `size?: 40\|44`; `onPress?`; `'aria-expanded'?`; `'aria-haspopup'?` | 40×40 ghost, бейдж 17 px `ДС:207`; 44×44 «Закрыть» листа `:2302`; `label` из md = `aria-label` (`MD_ALIASES`) | WS-12 |
| `Icon` (служебный) | `name: IconName`; `size?: 15\|16\|18\|20\|22\|24\|28\|32`; `fill?: boolean` | `aria-hidden="true"`, класс `material-symbols-rounded`; `fill` → `font-variation-settings:'FILL' 1` (`:2196`) | WS-12 |
| `VisuallyHidden` (служебный) | `children`; `as?` | подписи рейла `:150–169`; элементы D-29 несут `data-a11y-extra="D-29"` | WS-12 |
| `Field` (`:19`) | `label: string`; `hint?`; `error?`; `required?`; `readOnly?`; `disabled?`; `id?`; `children: ReactElement` | `<label for>`, ошибка `role="alert"` в `aria-describedby`, `aria-invalid` (`:2256–2257`); подпись 13/500 `--ox-text-label` над полем, ошибка под полем с иконкой `error` 16 (`ДС:218`) | WS-12 |
| `TextInput`/`NumberInput`/`MoneyInput`/`DateInput`/`Select`/`Textarea` (`:20`) | общее: `value`; `onChange(value)`; `unit?: string`; `inputMode?`; `placeholder?`; `readOnly?`; `disabled?`; `size?: 'md'\|'lg'` (44/48); `mono?: boolean` (одометр `tabular-nums` `:747`); `NumberInput: value: number\|''`, `min? max? step?`; `MoneyInput: amountMinor: number\|null; onChange(amountMinor)` показывает `1 250,00 ₽`; `DateInput: value: string` (ISO); `Select: options: {value; label; disabled?}[]` (нативный `<select>`); `Textarea: rows?` | единица внутри поля справа 13/`--ox-text-muted`; focus `border --ox-accent + 0 0 0 3px --ox-accent-soft` (`ДС:178`); деньги `inputmode="decimal"`, `text-align:right` | WS-12 |
| `Checkbox`/`Switch`/`RadioGroup`+`Radio` (`:21`) | `Checkbox: checked; indeterminate?; disabled?; onChange(checked); label: ReactNode; description?`; `Switch: checked; disabled?; onChange; 'aria-label': string; metrics?: 'crm'\|'showcase'` (44×26 / 40×22, 02 §12 п.4); `RadioGroup: name; value; onChange; 'aria-label'\|label; variant?: 'tiles'\|'cards'; children`; `Radio: value; label; description?; disabled?` | строка ≥ 44 px; `role="switch" aria-checked` (`:359`); плитки топлива 48 px `border:1.5px` (`:751`); карточки «Основа роли» `name="role-mode"` (`:2278–2285`) | WS-12 |
| `Status` (`:22`) | `tone: Tone`; `icon?`; `children: ReactNode`; `metrics?: 'crm'\|'showcase'` | pill `--ox-radius-pill`, иконка 15 (`:216`) / 16 (`ДС:254`); текст обязателен (тип не допускает пустых `children`) | WS-12 |
| `Banner` (`:24`) | `tone: Tone`; `icon?`; `title: string`; `text?: string`; `action?: Action`; `role?: 'status'\|'alert'` | `alert` только danger (`:3082`); кнопка 36 px `border:1px solid currentColor` (`:178`); рамка `--ox-line-<tone>` (`:2330`) | WS-12 |
| `AccessGate` (`:25`) | `reason: 'module_off'\|'module_readonly'\|'no_permission'\|'no_scope'`; `moduleName?`; `verb?`; `persona?`; `action?: Action`; `title?: string; text?: string` (переопределение) | `h1` 20 px, круг 56 px, `p` ≤ 480 px, primary 44 (`:195–203`); 4 текста 01 §12 — через `@ortus/texts/gate` в WS-12 | WS-12 |
| `Card` (`:26`) | `selected?`; `disabled?`; `disabledReason?`; `onPress?`; `href?`; `dashed?`; `padding?: 18\|20`; `title?`; `meta?`; `actions?`; `children` | выбранная `--ox-accent-tint` + рамка `--ox-accent` (`:3639`); одна ссылка/кнопка внутри; `disabledReason` текстом | WS-12 |
| `Dialog`/`ConfirmDialog` (`:32`) | `Dialog: open; onClose; title; titleId?: string` (по умолчанию `dlg-title`); `maxWidth?: 560\|620`; `busy?`; `footer?`; `children`; `ConfirmDialog: + onConfirm; icon?; tone?: 'default'\|'danger'; consequences?: {title: string; items: string[]}[]; ack?: {label: string}; confirmLabel: string; cancelLabel?` («Отмена»); `busyLabel?` («Выполняем…») | `role="dialog" aria-modal="true" aria-labelledby="dlg-title"`, Esc и backdrop закрывают (`:2203–2311`, `:2406–2410`); `--ox-radius-dialog` / на < 640 `--ox-radius-sheet` + `align-items:flex-end` (`:3957`); тень `--ox-shadow-dialog-crm`; фокус-ловушка и возврат фокуса — D-29 | WS-12 |
| `Sheet` (`:33`) | `open; onClose; title: string; children` | «Все разделы», «Закрыть» 44×44, пункты 48 px radius 10 (`:2300–2308`) | WS-12 |
| `Toast` (`:34`) | `tone: ToastTone`; `text: string`; `action?: Action`; `onDismiss`; `durationMs?` (4200); `bottom?: 20\|76` | `aria-live="polite"`, `role="alert"` при `error` иначе `status` (`:2900`); иконки `--ox-toast-icon-*` (`:2898`) | WS-12 |
| `EmptyState` (`:35`) | `icon`; `title: string`; `text?`; `action?: Action`; `dashed?: 'none'\|'local'` (`--ox-local-dashed` `:816`); `metrics?: 'crm'\|'showcase'` | CRM: `padding:28px 20px`, круг 56, `h2` 19 px (`:807–830`); витрина: `inbox` 32 (`ДС:396–400`) | WS-12 |
| `Skeleton` (`:36`) | `lines?: number`; `shape?: 'text'\|'block'\|'circle'`; `label?: string` («Загрузка») | `role="status" aria-label="Загрузка"`, `ox-pulse` (`:182–190`); контейнер `aria-busy` | WS-12 |
| `Tabs` (`:44`) | `items: {id: string; label: string; badge?: number\|string}[]`; `value: string`; `onChange(id)`; `'aria-label': string`; `variant?: 'underline'\|'cards'` | `role="tablist"`, `role="tab" aria-selected`, `aria-controls="panel-<id>"`; подчёркивание 2 px `--ox-accent`; счётчик **neutral** `--ox-neutral-bg/fg` (`:292`, Q-33); стрелки ←/→ — D-29 | WS-12 |
| `Meter` (МП §4.4) | `value: number; max: number; label: string; tone?: Tone; text?: string` | `role="meter"` «Занятое место» (02 §12 п.22), `aria-valuenow/min/max` | WS-12 |
| `Nav` (`:37`) | `groups: {title?: string; items: {id; label; icon; badge?: number\|'план'; current?: boolean; onPress}[]}[]`; `mode: 'sidebar'\|'rail'\|'bottom'`; `'aria-label': 'Основная навигация'\|'Навигация'`; `more?: Action` («Ещё») | 244 / 68 / 60 px (`:2843`, `:2192–2201`); активный `aria-current="page"`, `--ox-accent-soft`/`--ox-accent`/600; заголовок группы 11 px uppercase `--ox-nav-group` (`:152`) | WS-12 (визуал), WS-10 (состав) |
| `ScopeSelect` (`:38`) | `value: string; options: {value; label; kind: 'tenant'\|'region'\|'firm'}[]; onChange; 'aria-label'?: string` («Область просмотра») | нативный `<select>` 36 px (`:110`) | WS-12 |
| `AppShellProps` (`:37`, тип) | `tenant: {name: string; shortName?: string; logoUrl?: string; markUrl?: string}`; `chrome?: 'light'\|'dark'`; `scope?: ScopeSelectProps`; `nav: NavProps['groups']`; `notifications?: {count: number; items: {id; title; meta}[]; onReadAll}`; `profile: {name; initials; role; tenantLabel?}`; `banners?: ReactNode`; `children` | sidebar ≥ 1080 / rail 640–1079 / нижняя < 640 по ширине фрейма `W` (01 §4.3); тёмная шапка `--ox-chrome-header`; skip-link «К содержимому» с `data-a11y-extra` (D-29) | WS-10 |
| `SyncState` (`:23`) | `state: 'local'\|'queued'\|'uploading'\|'failed'\|'confirmed'`; `progress?: number`; `at?: string`; `onRetry?`; `label?: string` | `role="status"`; `uploading` → `role="progressbar" aria-valuenow`; `failed` → `role="alert"` + «Повторить» 32 px (`ДС:267–271`) | WS-13 |
| `DataTable<Row>` (`:27`) | `columns: {key: string; header: string; align?: 'left'\|'right'; mono?; width?: number}[]`; `rows: Row[]`; `rowKey(row)`; `sort?: {key; dir: 'asc'\|'desc'}`; `onSort?`; `filter?: ReactNode`; `onRow?(row)`; `state?: 'ready'\|'loading'\|'empty'\|'error'`; `empty?: EmptyStateProps`; `error?: {text: string; onRetry?}`; `minWidth?: number` (640/560/760/860); `mobile?: 'scroll'` | `<th scope="col">`; на 390 — горизонтальный скролл внутри карточки, `mobile="cards"` не используется (Q-41, `MD_ALIASES`); сортировка `localeCompare(…, 'ru', {numeric: true})` (`:4195`) | WS-13 |
| `CheckList` (`:28`) | `items: {label: string; value?: string; need?: string; ok: boolean}[]`; `summary?: {ok: boolean; label: string}` | строки 40 px; `check_circle`/`cancel`; несоответствие `--ox-danger-row-bg` (`ДС:330–337`) | WS-13 |
| `PhotoSlot` (`:29`) | `role: 'front'\|'back'\|'left'\|'right'\|'odo'`; `label: string` (`SIDES` `:2360`); `state: 'empty'\|'uploading'\|'failed'\|'local'\|'done'`; `progress?`; `previewUrl?`; `onCapture(file: File)`; `onRetry?`; `'aria-label'?` | `<input type="file" accept="image/*" capture="environment">` (`:92`); `aria-label` «Спереди: Не снято. …» (`:3390`); «Повторить» 36 px (`:739`); штриховка `--ox-stripes-*` | WS-13 |
| `LoadBar` (`:30`) | `legs: {n: number; weightPct: number; volumePct: number}[]`; `note?: string` | > 100 % — `--ox-danger-*` и текст «112 %» (`ДС:340–345`) | WS-13 |
| `Stepper` (`:31`) | `steps: {id: string; label: string}[]`; `current: string`; `blocked?: string[]` | `aria-current="step"`; пройден/текущий/впереди `:3429` | WS-13 |
| `ConflictNotice` (`:40`) | `text: string`; `code?: string`; `onRefresh`; `refreshLabel?: string` («Обновить список») | `role="alert"`, кнопка обновления первой (`ДС:407`) | WS-13 |
| `ObjectHeader` (`:41`) | `icon?`; `chips?: StatusProps[]`; `title: string`; `meta?: string`; `progress?: ReactNode`; `actions?: ReactNode`; `tabs?: TabsProps` | `h1` = название; вкладки прокручиваются вбок на узком экране | WS-13 |
| `ReadinessBar` (`:42`) | `done: number; pending: number; plan?: number; legend?: boolean` | проценты текстом; `accW/penW` (`:4327`) | WS-13 |
| `DecisionQueue` (`:43`) | `title?: string`; `items: {id; tone: Tone; icon?; tag?: string; title: string; meta?: string; action?: Action}[]`; `max?: number` (8); `emptyText?: string` («Решений не требуется»); `shownOf?(shown: number, total: number): string` («показано 8 из N») | порядок danger→warn→info→neutral — ответственность VM (05 §5.5), компонент не сортирует | WS-13 |
| `RoleEditor` (`:39`) | `role: {id: string; name: string; all?: boolean; actions: Record<string, string[]>}`; `catalog: {modules: {key; name; on: boolean; verbs: {key; label; perms: string[]}[]}[]}`; `onChange(role)`; `readOnly?`; `driverBlocked?: boolean` | `fieldset`+`legend`; системная роль read-only; `checked && disabled` (02 §12 п.17); блок начислений `--ox-danger-row-bg` (`ДС:307–322`); типы уточняются из `@ortus/domain` в WS-13 (только расширение) | WS-13 |

`types/contract.ts`: `PROP_KEYS = { Button: ['variant','size','icon','loading','disabled','disabledReason', …] } as const satisfies Record<Unit, readonly string[]>` (каждый массив — `(keyof XProps)[]`), `MD_ALIASES = { 'IconButton.label': 'aria-label', 'DataTable.mobile': 'mobile (только scroll, Q-41)', 'Status.children': 'children' }`, `UNITS` (30), `CORE_EXPORTS`, `DOMAIN_EXPORTS`.

`types/stub.tsx`: `makeStub<P>(name: Unit): FC<P>` → `<div data-stub={name}>{(props as {children?}).children ?? null}</div>`; текстовые пропсы (`label`, `title`, `text`) **не** рендерятся — красный экранный тест падает по тексту/роли (МП §8). Стаб не содержит литералов цвета и стилей.

`types/brand.ts`: `brandVars(hex) → {accent, hover, soft, tint}`, `contrastW(hex) → number`, `fixAccent(hex) → string`, `fmtRatio(x) → '6,4:1'` — сигнатуры `:2353–2357`.

### 4.3 Потребляет

| Что | Откуда | Если ещё нет |
|---|---|---|
| корневой `package.json`, `pnpm-workspace.yaml`, ESLint/Prettier/tsconfig base, пины `react 19.2.8`, `vite`, `vitest`, `@playwright/test` | WS-01 (влит до старта) | — |
| `brandVars/contrastW/fixAccent` (`models/*.ts`, МП §4.6) | `@ortus/domain` (WS-05, параллельно) | `types/brand.ts` содержит локальный порт `:2350–2356` с `// TODO(WS-05): заменить на export … from '@ortus/domain'`; тест `brand.test.ts` фиксирует значения; замену делает интегратор на барьере 0→1 (одна строка) |
| типы `RoleDraft`/`RoleCatalog` | `@ortus/domain` | минимальные структурные типы в `types/role-editor.ts` (таблица выше); WS-13 расширяет |
| тексты AccessGate/баннеров | `@ortus/texts` (WS-08) | в контракте не используются; стабы и истории берут строки из `.storybook/fixtures/minimal-props.tsx` дословно по 01 §11–§12 |
| `tools/design-preview.js design 4173` | есть (`tools/`) | для MCP-сверки витрины `Дизайн-система.dc.html` (нужен интернет или `--offline` от WS-07; §8) |

Правило изменения контракта после слияния (`orchestration.md` §7): `src/index.ts` не меняется в волне 1; WS-12/13 могут **только добавлять необязательные** пропсы в `types/*` и перечислять их в отчёте «Контракты, которые я изменил»; удаление/переименование — только через интегратора и запись D-xx.

## 5. Экраны, диалоги, состояния

У WS-04 нет ключей `pages`. Таблица адаптирована под ui-kit: «экран» = файл историй `Контракт/<Name>` (каркас состояний, МП §8.1 шаг 1 для `ui-kit`). `title` историй — латиницей `Contract/<Name>` (Storybook-id, §10 п.3), `name` — по-русски дословно. Маршрут: `http://127.0.0.1:7177/?path=/story/contract-<name>--<export>`; iframe: `/iframe.html?id=contract-<name>--<export>`.

| Файл | Истории (`name` дословно) | Источник строк | Кол-во |
|---|---|---|---|
| `Button` | «Варианты» (primary/secondary/ghost/danger/danger-secondary), «Размеры» (44/48/32/40/36), «Выполняется» (`aria-busy`, «Принимаем…»), «Недоступно с причиной» («Нет фото одометра») | `ДС:160–190`, `:178`, `:220–221`, `:970` | 4 |
| `IconButton` | «Обычная», «С бейджем» («Уведомления, 3 новых»), «Закрыть лист 44» | `ДС:207–208`, `:2302` | 3 |
| `Field` | «Обычное», «Фокус», «Ошибка» («Пробег не может быть меньше 48 210 км»), «Только чтение» («Фирма (только чтение)»), «Недоступно», «С подсказкой и единицей» («км», «Как на приборной панели») | `ДС:218–225` | 6 |
| `Inputs` | «TextInput», «NumberInput», «MoneyInput» (`1 250,00 ₽`), «DateInput», «Select» («Категория»: Топливо / Мойка / Парковка), «Textarea», «Одометр 48 px» | `ДС:177–182`, `:747`, `:2234–2241` | 7 |
| `Toggles` | «Checkbox» (вкл/выкл/indeterminate/disabled), «Switch 44×26 и 40×22», «Плитки «Уровень топлива»» (¼ ½ ¾ «Полный»), «Карточки «Основа роли»» | `ДС:228–242`, `:359`, `:751`, `:2278–2285` | 4 |
| `Status` | «Пять тонов», «Состояния рейса» (8 пиллов «Запланирован … Принят») | `ДС:254–261`, `:2329` | 2 |
| `SyncState` | «На устройстве», «Ждёт связи», «Загрузка 64 %», «Ошибка загрузки», «Принято сервером» | `ДС:267–271` | 5 |
| `Banner` | «Баннеры CRM» (5 текстов `bannersVM`: «Пробный период завершён.», «Модуль «Логистика» отключён.», «Нет связи.», «Связь восстановлена.», «Место организации заполнено.»), «Баннеры витрины» (4) | `:3080–3093`, `ДС:275–278` | 2 |
| `AccessGate` | «Модуль не подключён», «Только чтение», «Нет права», «Нет доступа к объекту» | `ДС:285–304`, `:195–203` | 4 |
| `Card` | «Обычная», «Выбранная», «Недоступная с причиной», «Пунктир (модуль не подключён)» | `:228`, `:3639` | 4 |
| `DataTable` | «Данные» («Рейс | Машина | Водитель | Статус | Расходы»), «Загрузка», «Пусто», «Ошибка», «Скролл на 390» | `ДС:362–380`, Q-41 | 5 |
| `CheckList` | «Всё соответствует», «С несоответствием» («Объём · не соответствует») | `ДС:330–337` | 2 |
| `PhotoSlot` | «Пусто», «Загрузка», «Ошибка», «На устройстве», «Готово» | `ДС:349–356`, `:2360` | 5 |
| `LoadBar` | «Норма», «Перегруз 112 %» | `ДС:340–345` | 2 |
| `Stepper` | «Пройден · текущий · впереди · заблокирован» | `:3429` | 1 |
| `Dialog` | «Обычный», «Опасный» («Отключить «Логистику»?»), «С подтверждением-флажком», «Выполняем…», «620 px (назначить роль)» | `ДС:383–393`, `:2206–2251` | 5 |
| `Sheet` | «Все разделы» | `:2300–2308` | 1 |
| `Toast` | «ok», «warn», «error», «info», «С действием» («Смена принята. Машина свободна.» + «Открыть») | `:2895–2901`, `ДС:406` | 5 |
| `EmptyState` | «Нет смен на проверке», «Сдача сохранена на устройстве» (пунктир) | `ДС:396–400`, `:807–830` | 2 |
| `Skeleton` | «Три полосы», «Загружаем рабочее пространство…» | `ДС:401–405`, `:182–190` | 2 |
| `ScopeSelect` | «Организация / регион / фирма» | `:110` | 1 |
| `RoleEditor` | «Обычный», «Системная роль (только чтение)», «Модуль не подключён, действия есть», «Заблокировано функцией «Водитель»» | `ДС:307–322`, 02 §12 п.17 | 4 |
| `ConflictNotice` | «Бронь занята» («Машину уже забронировали. Список обновлён.»), «Ревизия устарела» | `ДС:407` | 2 |
| `ObjectHeader` | «С чипами и вкладками» | `components.md:41` | 1 |
| `ReadinessBar` | «48 % принято · 5 % на приёмке» | `:4327` | 1 |
| `DecisionQueue` | «Четыре пункта», «Показано 8 из 11», «Решений не требуется» | `components.md:43`, МП §4.4 | 3 |
| `Tabs` | «Подчёркивание с бейджем» («Разделы доступа»), «Карточки-табы» | `:290–294`, `:440–442` | 2 |
| `Meter` | «Занятое место 46,2 из 100 ГБ», «85 %», «Заполнено» | 02 §12 п.22 | 3 |
| `Nav` | «Боковая панель 244», «Рейл 68», «Нижняя 60 (3 + «Ещё»)» | `:149–170`, `:2192–2201` | 3 |
| **Итого** | | | **91 история, 29 файлов** |

Состояния «пусто/загрузка/ошибка/нет права/офлайн/конфликт/только чтение» распределены по единицам (`DataTable`, `Skeleton`, `AccessGate`, `Banner`, `ConflictNotice`, `Field` «Только чтение»); у стабов они рендерятся как `[data-stub]` — поведение добавляют WS-12/13 в тех же историях.

## 6. Тесты первыми

### 6а. E2E-скелет (12 пунктов, все в `test.fixme` первым коммитом `test(ws-04): e2e-скелет токенов и Storybook`)

Пункты `verification-protocol.md` §1.3 (навигация, крошки, 390/1440) к пакетам не применимы — `pages: []`; вместо них ниже. Все имена тестов — дословно.

`frontend/packages/tokens/e2e/tokens.spec.ts` (страница `e2e/fixtures/tokens.html`: подключает `../src/tokens.css`, `../src/base.css`, `../fonts/fonts.css`; содержит `<button>Принять смену</button>`, `<a href="#">Прототип</a>`, `<span class="material-symbols-rounded" id="icon">route</span>`, `<input>`; сервер `e2e/serve.mjs` на `PORT` 5177; проекты `mobile-390` и `desktop-1440`, `locale: 'ru-RU'`):

1. **T1 — «--ox-accent равен #1F6B52, все 16 базовых и 15 тоновых переменных совпадают с tokens.json»** (11 §10 #33). Given страница открыта. Then `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent').trim() === '#1F6B52'`; для каждого ключа `color.*` и `color.tone.*.*` из `tokens.json` значение переменной равно `$value`.
2. **T2 — «document.fonts.check истинен для 600 16px Golos Text, 500 14px IBM Plex Mono и 24px Material Symbols Rounded после document.fonts.ready»** (11 §10 #34). Given `page.route('**/*', abort)` для всех хостов, кроме `127.0.0.1`. Then три `document.fonts.check(...)` истинны.
3. **T3 — «при prefers-reduced-motion: reduce --ox-motion-base и --ox-motion-fast равны 0ms»** (11 §10 #35). Given `page.emulateMedia({reducedMotion: 'reduce'})`. Then обе переменные `'0ms'`.
4. **T4 — «страница не делает запросов к fonts.googleapis.com, fonts.gstatic.com, unpkg.com, cdn.jsdelivr.net»** (D-21; 11 §12 п.19). Given `page.on('request')` собирает URL. Then ни один URL не содержит эти хосты; все запросы — `http://127.0.0.1:5177/`.
5. **T5 — «Tab на кнопку даёт outline 2px solid rgb(31, 107, 82) с outline-offset 2px»** (`tokens.css:51`, `:22`). When `keyboard.press('Tab')` до `getByRole('button', {name: 'Принять смену'})`. Then `outlineStyle === 'solid'`, `outlineWidth === '2px'`, `outlineColor === 'rgb(31, 107, 82)'`, `outlineOffset === '2px'`.
6. **T6 — «prototype-алиасы заданы: --ox-accent-tint #F1F7F3, --ox-line-ok #BFD9C8, --ox-line-info #C9D8E8, --ox-line-warn #EBD7A8, --ox-line-danger #F0C9C3, --ox-line-neutral #DCE2D9, --ox-radius-dialog 14px, --ox-control-card 40px, --ox-control-banner 36px»** (D-28, `:17`, `:2330`, `:3957`, `:220`, `:178`). Then девять равенств.
7. **T7 — «лигатура route в .material-symbols-rounded рендерится шрифтом Material Symbols Rounded шириной не более 26 px при 24 px»** (12 §8 п.20; 11 §8). Then `getComputedStyle(#icon).fontFamily` содержит `Material Symbols Rounded`, `boundingBox().width <= 26` (пять букв «route» в Golos были бы > 40 px).
8. **T8 — «base.css: фон html #E6E9E3, button:disabled имеет opacity 0.45 и cursor not-allowed, ссылка цвета #1F6B52»** (`:18–24`). Then `getComputedStyle(html).backgroundColor === 'rgb(230, 233, 227)'`; у `<button disabled>` `opacity === '0.45'`, `cursor === 'not-allowed'`; у `getByRole('link', {name: 'Прототип'})` `color === 'rgb(31, 107, 82)'`.
9. **T9 — «Golos Text 400 и 700 и IBM Plex Mono 400 загружены локально»** (11 §8 п.1; 11 §12 п.8). Then `document.fonts.check("400 14px 'Golos Text'")`, `check("700 16px 'Golos Text'")`, `check("400 13px 'IBM Plex Mono'")` истинны при тех же `page.route`-ограничениях, что в T2.

`frontend/packages/ui/e2e/storybook.spec.ts` (webServer `storybook dev -p 7177 --ci --no-open`; один проект `desktop-1440` + повтор S2 на `mobile-390`):

10. **S1 — «index.json содержит 29 файлов Contract/<Name> и 91 историю с русскими именами из §5»**. Given `GET /index.json`. Then множество `title` = 29 имён §5; для каждого — `name` историй равны столбцу «Истории» дословно; всего 91.
11. **S2 — «каждая история открывается в iframe.html без ошибок консоли и имеет 0 нарушений axe serious/critical»**. For each id из `index.json`: `goto('/iframe.html?id=' + id)`, `#storybook-root` непуст, `page.on('console')` без `error`, `AxeBuilder` → 0 `serious|critical`.
12. **S3 — «Storybook не обращается к внешним хостам: шрифты и иконки локальные»**. Given открыта `Contract/Status` → «Состояния рейса». Then все запросы — `127.0.0.1:7177`; `document.fonts.check("24px 'Material Symbols Rounded'")` истинен.

### 6б. Unit (Vitest)

`packages/tokens/test/`:

| Тест | Кейсы (вход → ожидание) |
|---|---|
| `build.test.ts` — `generate(json).css` табличный | 17 строк таблицы §4.1 «Правила генерации» + `color.line.ok` → `--ox-line-ok: #BFD9C8`; `font.family.sans` массив → `'Golos Text', system-ui, sans-serif`; порядок групп как в `tokens.css:3–44` |
| `parity.test.ts` | каждое из 64 объявлений `design/docs/design-system/tokens.css:3–44` есть в `src/tokens.css` с тем же значением (нормализация пробелов); объявления сверх 64 ⊆ `EXTRA_VARS`; хвост содержит блок `@media (prefers-reduced-motion: reduce)` с обоими `0ms` и правило `:focus-visible { outline: 2px solid var(--ox-focus); outline-offset: 2px; }` |
| `json-parity.test.ts` | `tokens.json` минус узлы с `$extensions["ortus.prototype"]` deep-равен `design/docs/design-system/tokens.json`; каждый prototype-узел имеет `ref` по маске `^(Ортус CRM|Дизайн-система|Документация)\.dc\.html:\d+` или `^11 §` и `decision ∈ {D-28, Q-33}`; количество prototype-узлов = количеству строк таблицы §4.1 (развёрнутых) |
| `ts-output.test.ts` | `breakpoints.mobile === 640`, `breakpoints.sidebar === 1080`, `sizes.control === 44`, `sizes.header === 58`, `sizes.controlCard === 40`, `motion.base === 200`, `motion.toast === 4200`, `color.accent === '#1F6B52'`, `tone.ok.border === '#B9D6C4'`, `line.ok === '#BFD9C8'`, `fontFamily.sans === "'Golos Text', system-ui, sans-serif"`, `cssVar('accent-tint') === 'var(--ox-accent-tint)'` |
| `drift.test.ts` | `generate(readJson('tokens.json'))` байт-в-байт равен `src/tokens.css` и `src/tokens.ts` |
| `fonts-manifest.test.ts` | каждый файл из `fonts/manifest.json` существует, sha256 совпадает; `fonts.css` содержит `@font-face` для трёх семейств, `font-weight: 400 700` (Golos), `400` и `500` (Plex), `100 700` + `font-display: block` (Symbols), `swap` для текстовых; нет подстроки `http`; есть `.material-symbols-rounded` с `font-feature-settings: 'liga'`; лицензии `LICENSE-GolosText.txt`, `LICENSE-IBMPlexMono.txt`, `LICENSE-MaterialSymbols.txt` непусты |
| `base-css.test.ts` | `base.css` содержит 7 правил §4.1 дословно, использует только `var(--ox-*)` (нет `#`-литералов), `@keyframes ox-pulse` с `0%/50%/100%` и `opacity .5/1/.5` |

`packages/ui/test/brand.test.ts` (порт `:2350–2356`):

| Вход | Ожидание |
|---|---|
| `brandVars('#1F6B52')` | `{accent: '#1F6B52', hover: '#195843', soft: '#E0EAE7', tint: '#EFF5F3'}` (МП §5.4 WS-05; Q-32) |
| `brandVars('zzz')`, `brandVars(undefined)` | `accent === '#1F6B52'` (невалидный hex → акцент по умолчанию, 02 §12 п.13) |
| `contrastW('#FFFFFF')` / `contrastW('#000000')` / `contrastW('#1F6B52')` | `1` / `21` / `6.4 ± 0.05`; `fmtRatio(contrastW('#1F6B52')) === '6,4:1'` |
| `fixAccent('#FFD400')` | `contrastW(result) >= 4.5`, результат темнее входа; точное значение — снапшот после сверки с эталоном «Оформление» (02 §10 #51, правка 00 E-«вычисленное значение») |
| `fixAccent('#1F6B52')` | `'#1F6B52'` (0 итераций) |

### 6в. Компонентные (Vitest + Testing Library + axe, `packages/ui/test/`)

| Тест | Что фиксирует |
|---|---|
| `exports.test.ts` | `Object.keys(import('../src')).sort()` равен 40 именам §4.2 (инлайн-снапшот); `CORE_EXPORTS` ∪ `DOMAIN_EXPORTS` = тот же список; `UNITS.length === 30` |
| `stubs.test.tsx` | для каждого из 40 экспортов (38 контрактных + `Icon`, `VisuallyHidden`) `render(<X {...minimalProps[X]} />)` → `container.querySelector('[data-stub="X"]')`; `children` отрендерены; `label`/`title`/`text` **не** найдены (`queryByText` null) — гарантия «красный по тексту»; `getByRole('button')` для стаба `Button` **выбрасывает** — гарантия «красный по роли» |
| `no-color-literals.test.ts` | `src/**/*.{ts,tsx,css}` не содержат `/#[0-9a-f]{3,8}\b/i`, `rgba?(`, `hsl(`; единственные источники цвета — `var(--ox-*)` и `@ortus/tokens` (02 §12 п.7; МП §8.4 ui-kit) |
| `types/*.test-d.ts` (`vitest --typecheck`) | `expectTypeOf<ButtonProps['variant']>().toEqualTypeOf<'primary'\|'secondary'\|'ghost'\|'danger'\|'danger-secondary'\|undefined>()`; `// @ts-expect-error` для `<IconButton icon="close" />` без `aria-label`, `<Status tone="ok" />` без `children`, `<MoneyInput amountMinor="100" />`, `<DataTable mobile="cards" />`, `<Toast tone="danger" />`; `AppShellProps['chrome']` = `'light'\|'dark'\|undefined` |
| `a11y-contract.test.tsx` | axe на каждом стабе с минимальными пропсами → 0 `serious|critical` (ворота для WS-12/13, `tdd-protocol.md` §3) |
| `storybook-skeleton.test.ts` | в `.storybook/skeleton/` ровно 29 файлов, у каждого `title === 'Contract/<Name>'`, экспорты латиницей, `name` историй = таблица §5 (фикстура `test/fixtures/stories-expected.json`), сумма 91; `main.ts` включает оба glob (`../src/**/*.stories.tsx`, `./skeleton/*.stories.tsx`), аддон `@storybook/addon-a11y`; `preview.ts` импортирует `@ortus/tokens/tokens.css`, `base.css`, `fonts.css` и объявляет viewports `mobile-390` (390×844), `tablet-768` (768×1024), `desktop-1440` (1440×900) |

### 6г. Контрактные

| Тест | Что фиксирует |
|---|---|
| `components-md.test.ts` | парсит `design/docs/design-system/components.md:15–44` (28 строк, backtick-идентификаторы колонки 2); для каждой строки каждый проп ∈ `PROP_KEYS[unit]` либо имеет запись в `MD_ALIASES` с причиной; `TextInput…Textarea` → общие ключи `value, onChange, unit, inputMode`; `Checkbox, Switch, Radio` → `checked, label, description` (у `Switch` `label` ↔ `aria-label` через `MD_ALIASES`) |
| `tsc --noEmit -p packages/ui` в `pnpm --filter @ortus/ui typecheck` | стабы и истории компилируются против типов; `src/index.ts` экспортирует `type *` без побочных импортов |
| `pnpm --filter @ortus/ui storybook:build` | сборка `storybook-static` без ошибок (CI-шаг `build`, 14-engineering «Конвейер CI») |

## 7. Шаги реализации (TDD-циклы; оценка в сессиях агента, всего ≈ 2,5 = M)

| # | Единица | Red (тест) | Green (минимум) | Refactor | Оценка |
|---|---|---|---|---|---|
| 0 | каркас пакетов | — (инфра) | `package.json`, `tsconfig`, `vitest.config.ts` обоих пакетов; скрипты `build`, `test`, `typecheck`, `e2e`, `storybook`, `storybook:build`; коммит `chore(ws-04)` | — | 0,1 |
| 1 | e2e-скелет | `tokens.spec.ts` T1–T9 и `storybook.spec.ts` S1–S3 в `test.fixme`; `playwright.config.ts` обоих пакетов (порты из `PORT`/`STORYBOOK_PORT`, `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'`, `reporter: [['html', {open: 'never'}]]`); прогон показывает 12 skipped | — | — | 0,1 |
| 2 | `tokens.json` | `json-parity.test.ts` красный (файла нет) | копия `design/docs/design-system/tokens.json` байт-в-байт | — | 0,05 |
| 3 | генератор CSS | `build.test.ts` 18 строк красные (`generate` не существует) | `scripts/build.mjs` + `generate()` в `scripts/generate.mjs`: обход W3C-дерева, карта префиксов §4.1 | вынести карту имён в `NAME_RULES`, покрыть каждую строку | 0,3 |
| 4 | хвост и паритет | `parity.test.ts` красный (нет media/focus-visible, нет файла) | `src/tail.css`, запись `src/tokens.css`, `EXTRA_VARS` | — | 0,1 |
| 5 | prototype-алиасы | тесты `build`/`parity`/`json-parity` на 9 переменных T6 + полный список §4.1 красные | узлы с `$extensions["ortus.prototype"]` в `tokens.json`; `EXTRA_VARS` дополнен | `README.md`: «как добавить prototype-токен» | 0,2 |
| 6 | TS-вывод и drift | `ts-output.test.ts`, `drift.test.ts` красные | эмиттер `tokens.ts` (`as const`, `cssVar`), коммит сгенерированных файлов | — | 0,15 |
| 7 | шрифты | `fonts-manifest.test.ts` красный | `scripts/fetch-fonts.mjs` (пин commit-URL google/fonts и google/material-design-icons, sha256 в `manifest.json`), файлы, `fonts.css`, лицензии | — | 0,2 |
| 8 | `base.css` | `base-css.test.ts` красный | 7 правил §4.1 через `var(--ox-*)` | — | 0,05 |
| 9 | e2e токенов | снять `fixme` T1 → T9 по одному (коммит на пункт); `fixtures/tokens.html`, `serve.mjs` | по пункту | — | 0,25 |
| 10 | типы пропсов | `types/*.test-d.ts` красные | `types/*.ts` по таблице §4.2 с JSDoc-ссылками на строки | группировка общих типов в `common.ts` | 0,3 |
| 11 | стабы и экспорт | `exports.test.ts`, `stubs.test.tsx`, `no-color-literals.test.ts` красные | `types/stub.tsx` (`makeStub`), `core/index.ts` (29), `domain/index.ts` (11), `src/index.ts`, `.storybook/fixtures/minimal-props.tsx` | — | 0,2 |
| 12 | контракт ↔ md | `components-md.test.ts` красный | `types/contract.ts` (`PROP_KEYS`, `MD_ALIASES`, `UNITS`) | — | 0,1 |
| 13 | бренд | `brand.test.ts` красный | `types/brand.ts` — порт `:2350–2357` (или реэкспорт, если WS-05 уже в `main`) | — | 0,1 |
| 14 | Storybook-каркас | `storybook-skeleton.test.ts` красный | `.storybook/{main,preview,viewports}.ts`, 29 файлов историй (91 история) на стабах с `minimal-props` | единый `makeStory(unit, name, props)` | 0,3 |
| 15 | e2e Storybook | снять `fixme` S1 → S3 | по пункту | — | 0,1 |
| 16 | a11y-ворота | `a11y-contract.test.tsx` (должен быть зелёным сразу; если красный — дефект стаба) | — | — | 0,05 |
| 17 | проверка и отчёт | §8 MCP-проходка, evidence, `docs/plan/reports/WS-04.md` (`orchestration.md` §5), строка `status.md` | | | 0,2 |

Порядок коммитов внутри цикла строго `test(ws-04): …` → `feat(ws-04): …` → `refactor(ws-04): …` (ревьюер проверяет `git log --format=%s`).

## 8. Проверка

Страниц у WS нет; проверяются два артефакта. Эталон поднимается `node tools/design-preview.js design 4173` (прототип тянет React и шрифты из сети — `verification-protocol.md` преамбула; при наличии `--offline` от WS-07 использовать его).

### 8.1 Пакет токенов

- Команда: `pnpm --filter @ortus/tokens e2e -- --project=mobile-390 --project=desktop-1440` (T1–T9 зелёные, отчёт `packages/tokens/playwright-report/`).
- Эталон: `http://127.0.0.1:4173/Дизайн-система.dc.html#color` — секция «01 Цвет», подписи палитры `canvas … chrome` (12 карточек, `ДС:62–73`) и карточки тонов с текстом вида «ok · #E3EFE7 / #1F6B52» (`ДС:79–83`); `#type` — «3xl · 32/600», …, «xs · 12/400» (`ДС:91–98`); `#layout` — «32 compact», «44 control», «48–54 mobile», «58 шапка» (`ДС:134–137`).
- Реализация: `http://127.0.0.1:5177/` (`fixtures/tokens.html`).
- Визуальная сверка пикселями не выполняется (витрина — WS-12, 11 §12 п.15); сверяются значения: каждый хекс в подписях `#color` равен `tokens.json`.

### 8.2 Storybook-каркас (MCP-проходка, `verification-protocol.md` §4)

1. `browser_navigate` `http://127.0.0.1:4173/Дизайн-система.dc.html#color` → `browser_snapshot`: в дереве есть `navigation "Разделы"` с ссылками «Цвет», «Типографика», «Отступы и размеры», «Кнопки», «Поля», «Статусы и синхронизация», «Доступ», «Логистика», «Данные и обратная связь», «Оболочка», «Тексты» (`ДС:38–50`); `browser_take_screenshot` → `docs/plan/evidence/storybook-contract/reference-1440.png`.
2. `browser_navigate` `http://127.0.0.1:7177/` → `browser_snapshot`: боковая панель содержит 29 групп `Contract/…`; `browser_click` по «Button» → «Варианты»; snapshot iframe содержит `[data-stub="Button"]` с текстами «Принять смену», «Вернуть на доработку», «Обновить список», «Отключить модуль», «Отклонить» (minimal-props по `ДС:165–190`, `:970`).
3. Открыть «Status» → «Состояния рейса»: snapshot содержит восемь подписей «Запланирован», «Машина назначена», «Осмотр перед выездом», «Дефект на проверке», «В рейсе», «Ожидает приёмки», «На доработке», «Принят» (`ДС:254–261`).
4. Открыть «AccessGate»: четыре истории с именами «Модуль не подключён», «Только чтение», «Нет права», «Нет доступа к объекту».
5. `browser_resize` 390×844 → повторить п. 2 (iframe без горизонтальной прокрутки: `document.documentElement.scrollWidth <= 390`); `browser_resize` 768×1024 → то же; 1440×900.
6. `browser_console_messages` — нет `error`/`warning` React; `browser_network_requests` — только `127.0.0.1:7177`, ни одного `fonts.googleapis.com`/`fonts.gstatic.com`/`unpkg.com`/`cdn.jsdelivr.net`.
7. `browser_take_screenshot` на трёх ширинах → `docs/plan/evidence/storybook-contract/{390,768,1440}.png`; дерево п. 2 → `snapshot.txt`; выдержки п. 6 → `console.txt`, `network.txt`.
8. Раздел «Проверка MCP» отчёта: пройдено/расхождения/исправлено.

MCP-инстанс исполнителя — свой (`.mcp.json` от WS-07; если его ещё нет — `npx @playwright/mcp@0.0.78 --browser chromium --headless --isolated --output-dir .playwright-mcp/5177`, 12 §8 п.2); отсутствие MCP — блокер, не замена проверки (`verification-protocol.md` §4, последний абзац).

## 9. Критерии готовности

- [ ] 12 пунктов e2e-скелета сняты с `fixme`; `pnpm --filter @ortus/tokens e2e` и `pnpm --filter @ortus/ui e2e` зелёные на указанных проектах; `playwright-report/` приложены.
- [ ] `pnpm --filter @ortus/tokens test` и `pnpm --filter @ortus/ui test` зелёные: `build`, `parity` (64/64 + allowlist), `json-parity`, `ts-output`, `drift`, `fonts-manifest`, `base-css`, `brand`, `exports` (40), `stubs` (40), `no-color-literals`, `types.test-d`, `a11y-contract`, `storybook-skeleton` (29/91), `components-md` (28 строк).
- [ ] `pnpm --filter @ortus/ui typecheck`, `storybook:build`, `pnpm lint`, `prettier --check` — без ошибок; `node scripts/build.mjs` не меняет `git status` (drift).
- [ ] `tokens.json` без prototype-узлов deep-равен дизайн-файлу; каждый prototype-узел имеет `ref` и `decision` (D-28/Q-33).
- [ ] Шрифты: три семейства в `fonts/` с sha256 и лицензиями; T2/T4/T9 доказывают работу без сети.
- [ ] `src/index.ts` экспортирует ровно 40 имён; `AppShell` — только тип; стабы без литералов цвета.
- [ ] Storybook: 29 файлов `Contract/<Name>`, 91 история, аддон a11y, viewports 390/768/1440, `tokens.css` + `base.css` + `fonts.css` подключены в `preview.ts`.
- [ ] Evidence `docs/plan/evidence/storybook-contract/` (3 снимка, эталон, `snapshot.txt`, `console.txt`, `network.txt`).
- [ ] Отчёт `docs/plan/reports/WS-04.md` по `orchestration.md` §5 с выводом прогонов (последние 40 строк каждого) и разделом «Контракты, которые я изменил» (запросы интегратору: скрипты `e2e:tokens`/`e2e:ui` в корневой `package.json`, job Storybook в CI, замена `types/brand.ts` на реэкспорт после WS-05).
- [ ] Строка WS-04 в `docs/plan/status.md` → «готово»; ревью 1 ревьюера `approve` (МП §8.4 ui-kit: пропсы 1:1 с `components.md`, axe, витрина-каркас); порядок коммитов `test(` → `feat(`.
- [ ] Ничего не помечено `skip` без ссылки на `decisions.md` (`tdd-protocol.md` §1).

## 10. Риски, расхождения, открытые вопросы — что делаем по умолчанию

1. **`LINE` ≠ `tone.*.border`, `--ox-accent-tint`, 36/40 px, радиусы 14/16** (11 §11 Q1–Q4; Q-32, Q-33): по D-28 канон — рендер CRM; базовые токены не меняются (паритет с `tokens.css`), значения CRM — `prototype`-алиасы. `Banner`/`Status` в CRM используют `--ox-line-<tone>`, витрина — `--ox-<tone>-border` (WS-12 выбирает по `metrics`).
2. **Лицензия Material Symbols — Apache 2.0, не OFL** (D-21 говорит «лицензии OFL»): файл `LICENSE-MaterialSymbols.txt` с Apache-2.0; записать в отчёте как уточнение D-21 (не меняет поведение).
3. **Кириллические `title` историй** дают пустые/коллизирующие Storybook-id: `title` латиницей `Contract/<Name>`, экспорты латиницей, русский текст — в `name`. Тест S1 сверяет `name`.
4. **Глобальные правила `:18–25` не в токенах**: `base.css` в `@ortus/tokens` (одна копия для `apps/web` и `apps/docs`), WS-10/WS-11 подключают после `tokens.css`; если интегратор решит перенести в `apps/*` — файл остаётся, импорт убирается.
5. **`:focus-visible`: `tokens.css:51` → `var(--ox-focus)` (`#1F6B52`), CRM `:22` → `var(--ox-accent)`** (в «Лотосе» `#7A3E79` обводка сливовая). По D-28 `base.css` переопределяет на `var(--ox-accent)`; `--ox-focus` сохраняется ради паритета. T5 проверяет значение по умолчанию.
6. **`Icon`/`VisuallyHidden` отсутствуют в `components.md`**: добавлены как служебные примитивы (нужны каждому компоненту: `aria-hidden` лигатура, скрытые подписи рейла `:150–169`); не считаются контрактными единицами; интегратор может отклонить — тогда они переносятся внутрь `core/` без экспорта.
7. **`AppShell` только тип**: реализация в `apps/web/src/shell` (МП §4.4, §3.3); стаба нет, чтобы не плодить мёртвый экспорт. `Nav`/`ScopeSelect` стабы есть — визуальные примитивы (WS-12), состав меню — WS-10.
8. **Счётчик `Tabs` neutral vs «warn» в `components.md:44`** (11 §11 Q5): как в прототипе (`:292`), `badge` без тона.
9. **`DataTable.mobile="cards"`** (`components.md:27`): не используется (Q-41) — тип допускает только `'scroll'`, `MD_ALIASES` объясняет.
10. **Параллельность с WS-05**: `brandVars` временно дублируется в `types/brand.ts`; дубль снимается интегратором на барьере 0→1; тесты значений остаются в `@ortus/ui` как контракт.
11. **Размер шрифтов**: переменный Material Symbols Rounded woff2 ≈ 3–4 МБ в git; субсеттинг не делаем (риск потерять лигатуры `BR_ICONS` `:2342–2348`). Если интегратор потребует — субсет по списку 11 §8 п.3 + `BR_ICONS` отдельным WS.
12. **Google Fonts отдаёт субсеты/хинтинг, локальные файлы — полные**: паритет снимков обеспечивается тем, что эталон в `--offline` тоже подключает `packages/tokens/fonts/fonts.css` (МП §2.2, WS-07).
13. **Хексы `#B7791F/#F7E9C6/#E0B457/#FFFCF4`** (11 §11 п.15): добавлены как `color.hatch.*` с описанием «назначение не установлено»; WS-32 уточняет при `HATCH` (`Ремонт и стройка.dc.html:492`).
14. **Нет тёмной темы** (11 §11 п.7, §12 п.20): не планируется; `prefers-color-scheme` не обрабатывается.
15. **Фокус-ловушка, стрелки табов, skip-link** (Q-34, D-29): в контракт типов входят как инварианты JSDoc; реализация — WS-12 с `data-a11y-extra="D-29"`.

## 11. Промпт запуска

Ты — исполнитель WS-04 «tokens-ui-contract» (волна 0, `ui-kit`, размер M) проекта «Ортус CRM». Работай в worktree `..\ortus-ws-04` на ветке `ws/04-tokens-ui-contract` от `main`; порт `PORT=5177`, `STORYBOOK_PORT=7177`; Windows 11 / PowerShell 5.1 (без `&&`), `pnpm install` в worktree, коммиты `git commit -F` без BOM.

Прочитай полностью: `docs/plan/ws/WS-04-tokens-ui-contract.md` (этот бриф), `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md`, `docs/plan/orchestration.md` §1, §5, §7; `design/docs/design-system/{tokens.json,tokens.css,components.md}`; `docs/plan/analysis/11-design-system-and-docs-site.md` §3, §4, §8, §11 Q1–Q5, §12 п.1–3, 15–17; `docs/plan/analysis/01-shell.md` §22 п.9, 16–18; `docs/plan/analysis/02-company.md` §12 п.4; `docs/plan/00-master-plan.md` §4.3, §4.4, §8.1; `decisions.md` D-13, D-21, D-28, Q-32, Q-33. `design/**` не менять.

Сделай строго по §7 брифа: первым коммитом — 12 пунктов e2e-скелета в `test.fixme` (§6а), затем циклы red→green→refactor для `@ortus/tokens` (генератор, паритет 64 объявлений, prototype-алиасы D-28, локальные шрифты, `base.css`), типов 30 единиц, 40 экспортов со стабами `data-stub`, `PROP_KEYS`/`MD_ALIASES`, `brand.ts`, Storybook-каркаса (29 файлов, 91 история). Снимай `fixme` по одному, коммит на пункт. Выполни MCP-проходку §8.2 и положи evidence в `docs/plan/evidence/storybook-contract/`.

Верни отчёт `docs/plan/reports/WS-04.md` по шаблону `orchestration.md` §5 (сделано, таблица тестов red→green с хешами, последние 40 строк прогонов `pnpm --filter @ortus/tokens test|e2e`, `pnpm --filter @ortus/ui test|typecheck|e2e|storybook:build`, «Проверка MCP», «Осталось fixme», «Контракты, которые я изменил» — запросы интегратору на корневые скрипты и CI) и обнови свою строку в `docs/plan/status.md`. Структурированный ответ: `ws: "WS-04"`, `branch`, `reportPath`, `done`, `pagesDelivered: []`, `fixmeLeft`, `contractsChanged`, `testRunsOk`.
