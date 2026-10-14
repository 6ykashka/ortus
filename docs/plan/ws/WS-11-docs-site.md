# WS-11 · apps/docs: читалка «Документация.dc.html» на React + TS, фреймы без CDN, карта следующих итераций

Волна 1 · Размер L · Вид `docs-site` · Зависит от WS-04 (токены, шрифты), WS-07 (e2e-харнесс, `apps/docs/playwright.config.ts`, `tools/vendor/react*.js`, `design-preview --offline`) · Блокирует — никого (`00-master-plan.md` §5.1, строка WS-11; §6.1: `WS-04 → WS-11`, `WS-07 → WS-11`).

Условные ссылки: «11 §6.2» = `docs/plan/analysis/11-design-system-and-docs-site.md` §6.2; «`:224`» без имени файла = строка `design/Документация.dc.html`; «§5.3» без имени файла = `docs/plan/00-master-plan.md` §5.3; «§1.3» = `docs/plan/verification-protocol.md` §1 п.3.

## 1. Цель

После WS-11 приложение `frontend/apps/docs` открывает 36 документов реестра `DOCS` (11 §6.3) с навигацией по 4 группам, поиском по всем документам, рендерерами `md`/`code`/`perm`/`api` и тремя frame-страницами («Дизайн-система», «Прототип», «Объекты: варианты карточки»), которые работают без единого запроса к `unpkg.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com` (D-16, D-21). На 390/800/1280/1440 пиксельная сверка `#app` с `http://127.0.0.1:4173/Документация.dc.html` укладывается в 1 % (D-22), структурная сверка текстов совпадает для всех 36 документов. Сверх прототипа — ровно один документ «Карта следующих итераций» из `design/ortus/roadmap.js:3–132` (D-24), помеченный в allowlist.

## 2. Границы файлов

Создаёт/меняет (владение по §3.3 мастер-плана и карточке WS-11 в §5.4):

| Путь | Что |
|---|---|
| `frontend/apps/docs/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html` | приложение `@ortus/docs` (Vite + React 19 + TS); если WS-01/WS-07 уже создали `package.json` — только дополнить скрипты `dev`, `build`, `test`, `e2e`, `sync-design`, `predev`/`prebuild`/`pree2e` |
| `frontend/apps/docs/src/registry.ts` | `DOCS` (36 + `roadmap`), `GROUPS`, `ORDER`, `BASENAMES`, `parseRoute`, `prevNext` |
| `frontend/apps/docs/src/styles.ts`, `decorate.ts`, `search.ts` | объект `S`, `applyStyles`/`wrapTables`/`rewriteLinks`/`tocOf`/`showToc`/`narrow`, поиск |
| `frontend/apps/docs/src/render/{perms,api,code,roadmap}.ts` | чистые рендереры HTML-строк |
| `frontend/apps/docs/src/{loader,mermaid}.ts`, `hooks/{useRoute,useDoc,useSearch,useViewport}.ts` | загрузка с кешем, mermaid лениво, состояние |
| `frontend/apps/docs/src/components/{Header,SearchResults,DocsNav,DocPage,Pager,Toc,FrameView}.tsx`, `App.tsx`, `main.tsx` | разметка 1:1 с `:27–123` |
| `frontend/apps/docs/src/content/roadmap.ts` | TS-порт `roadmap.js` 1:1 + `roadmapToMarkdown` |
| `frontend/apps/docs/public/design/` | копия `design/` через `tools/sync-design.js`; в `.gitignore` |
| `frontend/apps/docs/e2e/docs-{start,search,api,permissions,frames,layout}.spec.ts` | 6 спеков, 75 пунктов §6.1 |
| `frontend/apps/docs/e2e/visual/docs-start.{visual,labels}.spec.ts`, `docs-frames.visual.spec.ts`, `docs-search.visual.spec.ts`, `docs-api.visual.spec.ts`, `docs-layout.visual.spec.ts` | визуальная и структурная сверка (§8) |
| `frontend/apps/docs/e2e/visual/allowlist/{docs-start,docs-search,docs-api,docs-permissions,docs-frames,docs-layout}.md` | файл на ключ (D-50) |
| `frontend/apps/docs/e2e/fixtures/reference-docs.ts` | только если `@ortus/e2e-kit` не даёт фикстуры для читалки (§4.1) |
| `frontend/apps/docs/test/{unit,components,fixtures}/**` | Vitest, Testing Library, `vitest-axe`, фикстуры `docs-mini/`, `design-mini/` |
| `tools/sync-design.js` (+ тест в `apps/docs/test/unit/sync-design.test.ts`) | копирование `design/` → `public/design/` с подстановкой React и шрифтов (§4.2) |
| `frontend/packages/texts/src/docs.ts` | **только добавление** ключей (файл создаёт WS-08; после слияния WS-11 ключи заморожены) |
| `docs/plan/reports/WS-11.md`, `docs/plan/evidence/docs-*/`, `docs/plan/status.md` (строка WS-11) | отчёт, evidence, статус |

Запрещено трогать: `design/**` (эталон, `orchestration.md` §7); `frontend/apps/docs/playwright.config.ts` (WS-07 — расхождения просить через интегратора); `tools/design-preview.js`, `tools/vendor/**`, `tools/e2e-skeleton.js`, `tools/verify-pages.js` (WS-07); `frontend/packages/{tokens,ui,domain,adapter,e2e-kit}/**`; `frontend/apps/web/**`; корневой `package.json`, `.github/**`, `.claude/settings.json` (WS-01). Корневые скрипты `dev:docs`, `e2e:docs` — заявка интегратору в отчёте (§0.2 мастер-плана: `npm run X` ≡ `pnpm X`).

Worktree и ветка (`orchestration.md` §1; `workflow.template.js:69`):

1. Из корня репозитория: `git worktree add ..\ortus-ws-11 -b ws/ws-11-docs-site main`.
2. В worktree: `pnpm install` (12 §8 п.16), `pnpm e2e:install`, `pnpm mcp:install` (два разных браузера, 12 §8 п.4).
3. Порт исполнителя `PORT = 5173 + 11 = 5184` (§7.4); эталон — общий `127.0.0.1:4173` (`node tools/design-preview.js design 4173 --offline`, §2.2).
4. PowerShell 5.1: без `&&`, цепочки через `;`; коммиты `git commit -F <файл без BOM>` (12 §8 п.25); `.gitattributes eol=lf`.
5. MCP: свой инстанс `@playwright/mcp` с `--isolated --output-dir .playwright-mcp/5184` (D-49); `.mcp.json` читается на старте сессии.

## 3. Входы

Читать полностью, в этом порядке:

1. `design/Документация.dc.html` (480 строк: шаблон `:27–123`, реестр `:126–174`, стили `:176–204`, логика `:206–497`).
2. `design/support.js:1143–1153` (`REACT_URL`, `REACT_DOM_URL`, `cdnScriptFor` — подстановка через `window.__resources` без `integrity`); также `:1838–1847` (`loadReactUmd`), `:1455–1472` (`__resourceBlobs` для `<link>` — не используем).
3. `design/ortus/roadmap.js:3–132` — 9 карт `calendar, tasks, knowledge, forms, data, files, cash, spa, repair` (`title/icon/stage/purpose/screens/components/rules/api`; у `forms` ещё `flow` + `flowNote`).
4. `docs/plan/analysis/11-design-system-and-docs-site.md`: §6.1–6.11 (спецификация читалки со стилями и размерами), §7 (хостинг фреймов: §7.1 устройство `support.js`, §7.2 статика, §7.3 риски CDN/CSP, §7.4 офлайн-вариант), §8 (шрифты/иконки, 35 имён иконок), §9 п.13–17 (инварианты читалки), §10 #1–25 (чек-лист приёмки), §11 Q8–Q16, §12 п.4–14, 19.
5. `docs/plan/analysis/01-shell.md` §15 (страница «план»: подпись «Карта экранов · следующая итерация», пилюля `stage`, блок «Пример: осмотр машины → ответ формы → осмотр → задача менеджеру», колонки «Экраны»/«Компоненты»/«Правила»/«Контракты API», подпись «По ortus-openapi-v0.1.yaml»), §22 п.15.
6. `docs/plan/decisions.md`: D-16 (фреймы как есть, React локально), D-24 (`planned` не реализуется, `roadmap.js` → документация), Q-114…Q-119 (все «как в прототипе», Q-118 «не хостить»).
7. `docs/plan/00-master-plan.md`: §1.2 (строка «Документация»), §2.1–2.3, §4.3 (`tokens.css`, `fonts.css`), §4.8 (селекторы, ключи, allowlist D-50, evidence), §5.3 строки `docs-start … docs-layout`, §5.4 карточка WS-11, §7.3–7.4, §8.1 колонка «shell / pages / docs-site», §8.2, §10.3 D-45, D-49, D-50.
8. `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md`, `docs/plan/orchestration.md` — целиком; `docs/plan/analysis/12-prior-project-and-skills.md` §6 п.1–10 (харнесс), §8 п.2–6, 16, 19–20, 25 (Windows-dev, пины версий).
9. Данные для табличных тестов: `design/docs/11-permissions.yaml` (13 модулей на 2-м уровне, `role_templates` 5 шаблонов `:143–177`, `prototype_renames` 10 строк `:180–190`); `design/docs/v0.1/ortus-openapi-v0.1.yaml` (76 путей, 118 операций, 199 схем, 18 тегов `:28–63` — пересчитано скриптом при подготовке брифа); `design/docs/README.md` (h1 `:1`, 5 `h2`, `` `11-permissions.yaml` `` в таблице `:13`); `design/docs/14-engineering.md` (9 `h2`, в т. ч. «Структура репозитория» `:24`); `design/docs/10-data-model.md:43–44` (единственный блок ` ```mermaid ` / `erDiagram`); `design/docs/design-system/components.md` (3 `h2`); `design/docs/v0.1/05-technology-review.md:95–98` (внешние `https://` ссылки).

## 4. Контракты

### 4.1 Потребляет

| Контракт | Где лежит | Владелец | Если ещё нет |
|---|---|---|---|
| `@ortus/tokens`: `tokens.css` (`--ox-*`, `prefers-reduced-motion`, `:focus-visible`), `fonts/fonts.css` + woff2 (Golos Text 400–700, IBM Plex Mono 400/500, Material Symbols Rounded variable) | `frontend/packages/tokens/` | WS-04 | шрифтов в `design/` нет, стаб невозможен → блокер в отчёте, ветка не закрывается |
| `tools/vendor/react.production.min.js`, `react-dom.production.min.js` (18.3.1 UMD) | `tools/vendor/` | WS-07 | `sync-design.js` падает с текстом `tools/vendor/react.production.min.js не найден — WS-07` |
| `tools/design-preview.js --offline` (подстановка `__resources` и `fonts.css` в ответ `.dc.html`) | `tools/` | WS-07 | эталон на 4173 с интернетом (dev-машина); CI — блокер |
| `apps/docs/playwright.config.ts`: проекты `docs-390` (390×844), `docs-800` (800×900), `docs-1280` (1280×900), `docs-1440` (1440×900); `locale: 'ru-RU'`; `PORT` из окружения; `webServer: [dev docs, design-preview --offline 4173]`; `snapshotPathTemplate` с `{platform}` | `frontend/apps/docs/` | WS-07 | локальный `playwright.config.ts` в worktree с тем же содержимым и пометкой `Owner: WS-07`; при слиянии остаётся версия WS-07 |
| `@ortus/e2e-kit`: `reference`-фикстура (`openReference({url, width})` → снимок `#dc-root`), `collectLabels(page)` (исключает `[data-a11y-extra]`), `axe`, `toMatchReference` | `frontend/packages/e2e-kit/` | WS-07 | `apps/docs/e2e/fixtures/reference-docs.ts`: открыть `http://127.0.0.1:4173/Документация.dc.html#/<id>` в том же проекте, дождаться `#dc-root .sc-host` и `article h1` (для frame — `iframe`), снять `#dc-root`; `collectLabels` — локальная копия селектора `button, a, h1, h2, h3, label, [aria-label]` |
| `tools/e2e-skeleton.js` (генератор скелетов) | `tools/` | WS-07 | генератор рассчитан на отчёты `0N`/`06b`; если не принимает `11 §10` с картой «ключ → пункты» — скелет пишется вручную по тем же правилам (имя теста = текст пункта, `test.fixme`); фиксируется в отчёте |
| `@ortus/texts/docs` (`frontend/packages/texts/src/docs.ts`) | `frontend/packages/texts/` | WS-08 | файл существует после волны 0; WS-11 добавляет недостающие ключи (§4.3) |
| `tools/verify-pages.js` (Stop-хук) учитывает `apps/docs/**` → ключи `docs-*` | `tools/` | WS-07 | напоминание не приходит — §1–§4 протокола выполняются по этому брифу |

`@ortus/ui`, `@ortus/domain`, `@ortus/adapter` **не используются**: читалка не имеет доменных данных и адаптера; разметка повторяет инлайн-стили прототипа (11 §12 п.11). TanStack Router не нужен: один экран, hash-маршруты `#/<id>` как в прототипе (`:196`).

### 4.2 Публикует

**`tools/sync-design.js [--check] [--out <dir>]`** — единственный способ появления `frontend/apps/docs/public/design/`:

1. Копирует из `design/`: `support.js`; `Дизайн-система.dc.html`; `Ортус CRM.dc.html`; `Объекты - варианты.dc.html`; `Ремонт и стройка.dc.html` (dc-import из прототипа, `Ортус CRM.dc.html:2126`); `ortus/{api,models,mock-data,extra-data,roadmap}.js`; `docs/**` (32 файла); `README.md`.
2. **Не** копирует: `Документация.dc.html` (заменена приложением), `Ortus CRM.dc.html` (Q-118), `uploads/**`, `screenshots/**`, `.thumbnail`.
3. Кладёт `vendor/react.production.min.js`, `vendor/react-dom.production.min.js` (из `tools/vendor/`) и `fonts/` (из `frontend/packages/tokens/fonts/`).
4. В каждом скопированном `.dc.html` перед `<script src="./support.js">` вставляет одну строку: `<script>window.__resources={"https://unpkg.com/react@18.3.1/umd/react.production.min.js":"./vendor/react.production.min.js","https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js":"./vendor/react-dom.production.min.js"}</script>` — ключи дословно `support.js:1143, 1145`, подстановка через `cdnScriptFor` (`:1149–1153`) без `integrity`.
5. Заменяет в helmet три строки `<link rel="preconnect" href="https://fonts.googleapis.com">`, `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text…">`, `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded…">` (11 §8) на одну `<link rel="stylesheet" href="./fonts/fonts.css">`.
6. Всё остальное — байт-в-байт; запуск идемпотентен; `--check` возвращает код 1, если копия устарела (сравнение хешей), иначе 0.
7. Потребители: `apps/docs` (`predev`/`prebuild`/`pree2e`), CI (job `build`: `node tools/sync-design.js --check`), WS-07 может переиспользовать `transformDcHtml(src)` для `--offline`.

**`renderPerms(yaml, raw): string`**, **`renderApi(spec, filter): string`** — чистые функции над YAML (11 §12 п.4), HTML-строка 1:1 с `:355–430`; экспорт только внутри `apps/docs`.

**`ROADMAP`** (TS-порт `roadmap.js` 1:1) и **`roadmapToMarkdown(ROADMAP): string`** — `apps/docs/src/content/roadmap.ts`; тест паритета с `design/ortus/roadmap.js`.

**Ключи** `docs-start, docs-search, docs-api, docs-permissions, docs-frames, docs-layout` — имена spec'ов, папок evidence, записей allowlist (§4.8); `args.ws[].pages` в `workflow.template.js`.

**Компоненты приложения и пропсы** (внутренний контракт, для компонентных тестов §6.3):

| Компонент | Пропсы | Разметка прототипа |
|---|---|---|
| `Header` | `narrow, navOpen, onToggleNav, query, onQuery, results, resultsLabel, onPick` | `:29–55` |
| `SearchResults` | `label, items[{title, meta, before, hit, after, go}]` | `:44–52` |
| `DocsNav` | `groups[{label, items[{title, href, icon, current}]}], narrow, open, onScrim` | `:57–73` |
| `DocPage` | `doc, loading, error, apiFilter, onApiFilter, showPager, prev, next, showToc, toc, contentRef, mainRef` | `:75–120` |
| `FrameView` | `src, title` | `:76–78` |
| `Pager` | `prev?, next?` | `:105–110` |
| `Toc` | `items[{text, indent, go}]` | `:112–119` |

### 4.3 Ключи `texts/docs.ts` (дословно из прототипа)

- `title: 'Ортус — документация'` (`:12`)
- `brand: 'ортус'`, `brandSub: 'документация'` (`:35`)
- `navSections: 'Разделы'` (`:31`), `navDocs: 'Документы'` (`:59`)
- `searchPlaceholder: 'Поиск по всем документам'`, `searchLabel: 'Поиск по документам'` (`:41`)
- `resultsLabel: 'Результаты поиска'` (`:44`), `foundIn: (n) => 'Найдено в ' + n + ' документах'`, `nothingFound: 'Ничего не найдено'` (`:479`), `matches: 'совп.'` (`:481`)
- `sourceFile: 'Исходный файл'` (`:85`)
- `apiFilterPlaceholder: 'Фильтр: путь, право, operationId, схема'`, `apiFilterLabel: 'Фильтр операций'` (`:90`)
- `prev: '← Назад'`, `next: 'Далее →'` (`:107–108`); `onPage: 'На странице'`, `toc: 'Содержание'` (`:113–114`)
- `loadFailed: (path, status) => 'Не удалось загрузить ' + path + ' (' + status + ')'` (`:230`); `libFailed: 'Библиотека не загрузилась'` (`:197`)
- `groups`: `['v02', 'Старт разработки · 0.2'], ['api', 'Контракты'], ['v01', 'Проектирование · 0.1'], ['ds', 'Дизайн и прототип']` (`:167`)
- `perms.*` (`:357–377`): «Каталог прав», «Версия », «. Канонический реестр action keys. Уровни редактора роли: », «системный», «отраслевой», «зависит от », «Ключ», «Действие», «Уровень», «Области», «Чувствительность», «обычное», «чувствительное», «закрытое», «только владелец», «запрещено: », «Шаблоны ролей», «область по умолчанию: », «функция: », «Отдельный финансовый блок: », «Переименования из прототипа», «Ключи `ortus/models.js`, которые нужно заменить при переносе в репозиторий.», «В прототипе», «Канон», «Исходный YAML», «Показать файл»
- `api.*` (`:401–421`): «OpenAPI », «версия », « путей · », « операций · », « схем», « · найдено », « операций и », « схем», «Сервер », « — нерабочий адрес-пример. Пути после », « выполняются в контексте бизнеса; », « не даёт доступа.», «operationId», «Права», «режим: », «Область», «Тело», «Параметр», «Где», «Тип», «Обяз.», «да», «Ответы», «Операций по фильтру «», «» нет.», «Схемы»
- `roadmap.*` (01 §15): «Карта следующих итераций», «Карта экранов · следующая итерация», «Экраны», «Компоненты», «Правила», «Контракты API», «По ortus-openapi-v0.1.yaml», «Пример: осмотр машины → ответ формы → осмотр → задача менеджеру», «Шаг »

## 5. Экраны, диалоги, состояния

Все ключи — один экран читалки; различаются документом и фокусом проверки. Персонажей нет (документация публична). Маршрут реализации: `http://127.0.0.1:<PORT>/#/<id>`; эталон: `http://127.0.0.1:4173/Документация.dc.html#/<id>`.

| Ключ | Дословная подпись (где) | Строки прототипа | Состояния | e2e spec | URL |
|---|---|---|---|---|---|
| `docs-start` | пункт «Комплект для старта»; h1 «Ортус CRM — комплект для старта разработки v0.2»; мета «Старт разработки · 0.2» · `docs/README.md` · «Исходный файл»; пейджер «← Назад»/«Далее →» | `:33–36, :59–71, :79–111, :126–174, :196, :236–316, :456–496` | обычное; загрузка (`[aria-busy="true"]`, 4 полосы `#E3E7E0`, `:94–99`); ошибка (`[role="alert"]` `#FBEAE7/#A13A33` «Не удалось загрузить docs/16-raid-glossary.md (404)», `:102`, `:230`); офлайн (`context.setOffline(true)` → `fetch` бросает → тот же алерт с `e.message` браузера, `:242`, как в прототипе); пусто/нет права/конфликт/только чтение — не применимо (документы статичны, прав нет) | `docs-start.spec.ts` | `/#/start`, `/#/data-model`, `/#/sql-control`, `/#/raid`, `/#/nope`, `/#/roadmap` |
| `docs-search` | `input[aria-label="Поиск по документам"]` `placeholder="Поиск по всем документам"`; `[role="listbox"][aria-label="Результаты поиска"]`; «Найдено в N документах» / «Ничего не найдено»; `meta` «<Группа> · N совп.» | `:38–54, :432–454, :476–483, :338–353` | скрыт (`< 2` символов или `results === null`); результаты (1…15 `button`); пусто («Ничего не найдено», кнопок нет); загрузка всех документов (`ensureAll`, список не показан, пока `results === null`); закрытия по Esc/клику вне нет (Q-114) | `docs-search.spec.ts` | `/#/start` + ввод |
| `docs-api` | пункт «OpenAPI 0.1»; h1 «ORTUS CRM Constructor — Design API»; `input[aria-label="Фильтр операций"]`; «76 путей · 118 операций · 199 схем»; «Операций по фильтру «{f}» нет.»; «Схемы · N» | `:87–92, :247–255, :381–430` | обычное (18 групп-тегов + «Схемы · 199»); фильтр с совпадениями (« · найдено N операций и M схем»); фильтр без совпадений; загрузка 365 КБ (скелетон); ошибка загрузки | `docs-api.spec.ts` | `/#/openapi` (**не** `#/api`, §10 п.1) |
| `docs-permissions` | пункт «11 · Каталог прав»; h1 «Каталог прав»; `th` «Ключ | Действие | Уровень | Области | Чувствительность»; «Шаблоны ролей»; «Переименования из прототипа»; «Исходный YAML» → `summary` «Показать файл» | `:355–379` | обычное; `details` свёрнут/раскрыт; загрузка; ошибка | `docs-permissions.spec.ts` | `/#/permissions` |
| `docs-frames` | пункты «Дизайн-система», «Прототип», «Объекты: варианты карточки»; `iframe[title="<заголовок>"]` | `:76–78, :238, :263, :462, :485–486, :490, :493` | обычное (iframe 100 % `main`, контейнер страницы `display:none`); нет скелетона, алерта, TOC, пейджера, мета-строки (11 §9 п.15); `.sc-logic-error` внутри iframe не должна появляться; «Объекты - варианты» — горизонтальная прокрутка внутри iframe при < 1440 (Q-119) | `docs-frames.spec.ts` | `/#/design-system`, `/#/prototype`, `/#/objects-variants` |
| `docs-layout` | `button[aria-label="Разделы"][aria-expanded]` (`< 960`); скрим; `nav[aria-label="Документы"]` 280 px; `aside[aria-label="Содержание"]` «На странице» (`≥ 1280` и `toc.length > 2`) | `:29–32, :57–73, :112–119, :207, :220, :459–467, :493–494` | узкий (`w < 960`): бургер + оверлейная навигация + скрим; средний (960–1279): nav без TOC; широкий (`≥ 1280`): nav + TOC для документов с > 2 `h2/h3` (Q-115); frame → без TOC при любой ширине | `docs-layout.spec.ts` | `/#/engineering`, `/#/components`, `/#/sql-control`, `/#/openapi` |

Документ `roadmap` (D-24), 37-я запись `DOCS`:

- `id: 'roadmap'`, `g: 'ds'` («Дизайн и прототип»), последний в группе; `title: 'Карта следующих итераций'`; `icon: 'map'`; `kind: 'md'`; текст — `roadmapToMarkdown(ROADMAP)`, без `fetch` (в `cache` сразу).
- h1 «Карта следующих итераций»; затем для каждой из 9 карт в порядке `roadmap.js`: `h2` «{title}»; строка «Карта экранов · следующая итерация · {stage}»; `p` {purpose}; `h3` «Экраны» + нумерованный список «{name} — {desc}»; `h3` «Компоненты» + инлайн-код через запятую; `h3` «Правила» + список; `h3` «Контракты API» + список моно и строка «По ortus-openapi-v0.1.yaml».
- Для `forms` перед «Экраны»: `h3` «Пример: осмотр машины → ответ формы → осмотр → задача менеджеру», список «Шаг 1 … Шаг 4» (`roadmap.js:55–60`) и `p` «Публикация v4 не меняет старые ответы: они остаются связаны с v3 и показываются по её структуре.» (`:61`).
- Мета-строка: «Дизайн и прототип» · `ortus/roadmap.js` · без ссылки «Исходный файл» (файла в читалке нет; `labels` на этой странице не сверяются).
- Эталона нет → allowlist `docs-start.md`: `kind: no-reference · target: #/roadmap · decision: D-24`.

## 6. Тесты первыми

### 6.1 (а) E2E-скелет — 75 пунктов, все в `test.fixme` первым коммитом `test(ws-11): e2e-скелет docs-*`

Имя теста = текст пункта после номера (дословно); источник в скобках: «11 #N» = 11 §10 пункт N; «§1.3» = обязательные пункты `verification-protocol.md` §1 п.3 (§8.2 мастер-плана). Каждый тест гоняется на `docs-390` и `docs-1440`; пункты раскладки — на всех 4 проектах. Селекторы — `getByRole`/`getByLabel`/`getByText` с дословными подписями; `data-testid` не используется.

#### `docs-start.spec.ts` — 18

- **S-01 · Старт** (11 #1)
  - Given: `page.goto('/')` без hash.
  - When: страница загрузилась (`getByRole('main')` содержит `heading level 1`).
  - Then: `location.hash` ∈ {`''`, `'#/start'`}; `getByRole('heading', {level: 1})` = «Ортус CRM — комплект для старта разработки v0.2»; в `getByRole('navigation', {name: 'Документы'})` ссылка «Комплект для старта» имеет `aria-current="page"`.
- **S-02 · Шапка** (11 #2)
  - Then: `locator('a[href="#/start"]')` содержит тексты «ортус» и «документация»; `getByLabel('Поиск по документам')` имеет `placeholder="Поиск по всем документам"` и `type="search"`.
- **S-03 · Группы и пункты** (11 #3 + D-24)
  - Then: в `nav[aria-label="Документы"]` ровно 4 подписи групп в порядке «Старт разработки · 0.2», «Контракты», «Проектирование · 0.1», «Дизайн и прототип»; ссылок `a[href^="#/"]` — 37: первые 36 в порядке `DOCS` `:127–165` (первые в группах: «Комплект для старта», «OpenAPI 0.1», «Обзор комплекта 0.1», «Дизайн-система»); 37-я — «Карта следующих итераций» с `href="#/roadmap"`, последняя в группе «Дизайн и прототип» (в эталоне 36 — D-24).
- **S-04 · Переход по пункту** (11 #4)
  - When: клик по ссылке «10 · Модель данных».
  - Then: `location.hash === '#/data-model'`; мета-строка содержит «Старт разработки · 0.2», `docs/10-data-model.md`, ссылку «Исходный файл» с `target="_blank"` и `rel="noopener"`; `main.scrollTop === 0`; в `article` есть `h2[id^="sec-"]`.
- **S-05 · Mermaid** (11 #5)
  - Given: `#/data-model`.
  - Then: внутри `article` появляется `svg` в `div` со стилем `border:1px solid #DCE2D9` (`:331`); `code.language-mermaid` отсутствует. Mermaid в бандле — оговорка «если CDN недоступен» не применяется.
- **S-06 · Внутренние и внешние ссылки** (11 #6)
  - Given: `#/start`. Then: `article` содержит `a[href="#/permissions"]` с `code` «11-permissions.yaml» (`docs/README.md:13`); у `code` `color: rgb(31, 107, 82)` и `background-color: rgb(227, 239, 231)` (`:314`).
  - Given: `#/technology` (`05-technology-review.md:95–98`). Then: все `article a[href^="http"]` (≥ 1) имеют `target="_blank"` и `rel="noopener"`.
- **S-07 · Пейджер** (11 #7)
  - Given `#/start`. Then: нет текста «← Назад», есть «Далее →» с «10 · Модель данных».
  - Given `#/proto-readme`. Then: «← Назад» → «Токены (CSS)», «Далее →» → «Прототип» (Q-116).
  - Given `#/design-system`. Then: пейджера нет.
- **S-08 · Code** (11 #8)
  - Given: `#/sql-control`.
  - Then: `article h1` = «SQL · control 0001»; есть `pre > code`; текст начинается с первой строки `design/docs/db/control_0001_init.sql` (читается в тесте из файла).
- **S-09 · Ошибка загрузки** (11 #17)
  - Given: `page.route('**/docs/16-raid-glossary.md', r => r.fulfill({status: 404}))`.
  - When: `#/raid`.
  - Then: `getByRole('alert')` = «Не удалось загрузить docs/16-raid-glossary.md (404)»; `article` пуст; пейджер показан (`showPager = !loading && !isFrame`, `:490`).
- **S-10 · Загрузка** (11 #18)
  - Given: ответ на `**/docs/13-backlog-s0-s2.md` задержан на 1 с (`route` + `setTimeout`).
  - When: `#/backlog`.
  - Then: виден `[aria-busy="true"]` с 4 полосами, затем исчезает и появляется `h1`.
- **S-11 · Неизвестный hash** (11 #19)
  - When: `page.goto('/#/nope')`.
  - Then: показан «Комплект для старта» (`aria-current="page"` на нём); `location.hash` остаётся `#/nope` (`parseRoute` не меняет URL, `:196`).
- **S-12 · Карта следующих итераций** (D-24)
  - When: клик «Карта следующих итераций».
  - Then: `location.hash === '#/roadmap'`; `h1` «Карта следующих итераций»; 9 `h2` в порядке «Умный календарь», «Задачи и проекты», «База знаний», «Формы и опросы», «Данные», «Файлы», «Внутренняя касса», «Салон и SPA», «Ремонт и стройка»; у «Умный календарь» текст «P0 · итерация 2»; в разделе «Формы и опросы» есть «Публикация v4 не меняет старые ответы: они остаются связаны с v3 и показываются по её структуре.» и «Шаг 4»; мета-строка без «Исходный файл»; `[aria-busy]` не появлялся.
- **S-13 · Страница открывается из навигации по подписи «Комплект для старта» и по прямому URL** (§1.3)
  - When: `goto('/#/engineering')`, затем клик «Комплект для старта». Then: `h1` «Ортус CRM — комплект для старта разработки v0.2».
  - When: `goto('/#/start')` напрямую. Then: тот же `h1` и `aria-current`.
- **S-14 · Заголовок и контекст соответствуют прототипу** (§1.3)
  - Then: порядок текстов в мета-строке: «Старт разработки · 0.2», «·», «docs/README.md» (моно 12px), «Исходный файл»; `document.title` = «Ортус — документация» (`:12`).
- **S-15 · Состояния: загрузка, ошибка, офлайн — дословный текст** (§1.3)
  - загрузка/ошибка — как S-09/S-10.
  - Given: `context.setOffline(true)`. When: `#/quality` (не в кеше). Then: `[role="alert"]` содержит текст исключения `fetch` браузера (`:242`, как в прототипе); ожидание фиксируется по факту на эталоне, при расхождении — allowlist `kind: state`.
  - пусто/нет права/конфликт/только чтение — `test.skip('не применимо: документация статична, WS-11 §5')`.
- **S-16 · Клавиатура: Tab обходит все интерактивные элементы, фокус виден** (§1.3)
  - Given: 1440. When: `Tab` от `body`.
  - Then: порядок фокуса: `a[href="#/start"]` → `input` поиска → 37 ссылок nav → «Исходный файл» → ссылки `article` → пейджер; у сфокусированной ссылки `outline` `2px solid rgb(31, 107, 82)` (`:22`); `Escape` ничего не закрывает (диалогов нет).
- **S-17 · axe: нет serious/critical** (§1.3)
  - Then: `AxeBuilder({page}).analyze()` на `#/start` и `#/roadmap` → `violations.filter(v => ['serious','critical'].includes(v.impact))` пуст.
- **S-18 · Раскладка 390: нет горизонтальной прокрутки; 1440: боковая панель** (§1.3)
  - `docs-390`: `document.documentElement.scrollWidth <= 390`; `nav` отсутствует; виден `button[aria-label="Разделы"]` 40×40 (`:31`, §10 п.6).
  - `docs-1440`: `nav` шириной 280 px (`:464`); `button[aria-label="Разделы"]` отсутствует.

#### `docs-search.spec.ts` — 13

- **Q-01 · Поиск: ввод < 2** (11 #9)
  - When: `fill('п')`. Then: `getByRole('listbox')` отсутствует (`toHaveCount(0)` после ≥ 300 мс через `expect.poll`).
- **Q-02 · Поиск: результаты** (11 #10)
  - When: `fill('права')`.
  - Then: виден `[role="listbox"][aria-label="Результаты поиска"]`; первая строка `/^Найдено в \d+ документах$/`; `button` 1…15; у каждого `strong` и `mark`; `mark.textContent.toLowerCase() === 'права'`; `meta` каждого соответствует `/^(Старт разработки · 0\.2|Контракты|Проектирование · 0\.1|Дизайн и прототип) · \d+ совп\.$/`.
- **Q-03 · Поиск: пусто** (11 #11)
  - When: `fill('qzqzqzqz')`. Then: заголовок «Ничего не найдено», `button` 0.
- **Q-04 · Поиск: переход** (11 #12)
  - When: клик по первому результату.
  - Then: `listbox` скрыт; `location.hash === '#/' + id` результата; в `article` есть `mark` с `background-color: rgb(250, 241, 220)` (`#FAF1DC`, `:347`); `mark.boundingBox()` внутри `main.boundingBox()`.
- **Q-05 · После перехода запрос остаётся в поле; смена hash скрывает список** (11 §6.2, `:224`)
  - After Q-04: `input` = «права». When: `goto('/#/start')` при открытом списке. Then: `listbox` отсутствует, значение поля прежнее.
- **Q-06 · Поздний ответ отбрасывается** (11 §6.2, `:440`)
  - When: `fill('права')` и сразу `fill('правах')`. Then: единственный список соответствует «правах» (все `mark` = «правах»); промежуточного списка для «права» нет.
- **Q-07 · Порядок и лимит** (11 §9 п.14)
  - When: `fill('тенант')`. Then: ≤ 15 `button`; числа «N совп.» невозрастающие сверху вниз.
- **Q-08 · Открывается по прямому URL** (§1.3)
  - When: `goto('/#/openapi')`. Then: поле поиска видно и пустое; `fill('права')` даёт список с любого документа.
- **Q-09 · Заголовок списка соответствует прототипу** (§1.3)
  - Then: заголовок 12px `rgb(92, 105, 100)` (`:45`); «Найдено в N документах» без склонения при N = 1 (`:479`, §10 п.5).
- **Q-10 · Состояния: пусто/загрузка** (§1.3)
  - пусто — Q-03. Given: `**/docs/v0.1/ortus-openapi-v0.1.yaml` задержан 1 с. When: `fill('права')`. Then: `listbox` не появляется до завершения всех загрузок (`ensureAll`, `:433`), затем появляется один раз.
- **Q-11 · Клавиатура** (§1.3)
  - When: фокус в поле, `fill('права')`, `Tab`. Then: фокус на первом `button` результата; `Enter` → переход (Q-04); `Escape` список **не** закрывает (Q-114).
- **Q-12 · axe с открытым списком** (§1.3)
  - Then: `AxeBuilder` без serious/critical при открытом `listbox` с `button`-детьми; нарушение `aria-required-children`, если возникнет, — в отчёт как кандидат на D-29 (невидимая добавка), не правится без решения.
- **Q-13 · Раскладка 390** (§1.3)
  - `docs-390`: ширина `listbox` = `min(560, 390 − 32)` = 358 px (`:44`); `max-height` 70vh; `documentElement.scrollWidth <= 390`.

#### `docs-api.spec.ts` — 11

- **A-01 · OpenAPI** (11 #13)
  - Given: `#/openapi`.
  - Then: `article h1` = «ORTUS CRM Constructor — Design API»; пиллы «OpenAPI 3.1.0», «версия 0.1.0-design»; текст «76 путей · 118 операций · 199 схем»; есть `h2`, начинающиеся с «Context», «Fleet», «Схемы»; виден `getByLabel('Фильтр операций')`.
- **A-02 · OpenAPI: операция** (11 #14)
  - When: раскрыть первый `details` в карточке после `h2` «Fleet …».
  - Then: в `summary` пилл метода: текст `get|post|put|patch|delete`, `text-transform: uppercase` (`:415`); путь не начинается с `/api/v1`; в теле подписи «operationId», «Права», «Область», «Ответы»; ≥ 1 чип права с `background-color: rgb(227, 239, 231)`.
- **A-03 · OpenAPI: фильтр** (11 #15)
  - Given: `main.scrollTop` = 300. When: `fill('fleet')` в «Фильтр операций». Then: текст `/ · найдено (\d+) операций и (\d+) схем/`, N > 0; `main.scrollTop` не сброшен.
  - When: `fill('qzqzqz')`. Then: «Операций по фильтру «qzqzqz» нет.»; нет `h2` «Схемы».
- **A-04 · Фильтр сбрасывается при смене документа** (`:224`)
  - When: `fill('fleet')`, перейти `#/permissions`, вернуться `#/openapi`. Then: поле пустое, текста «найдено» нет.
- **A-05 · Схемы** (11 §6.10)
  - Then: `h2` «Схемы» со счётчиком «· 199». When: раскрыть `details` с `summary` «Problem». Then: таблица свойств; у `required` — `*` цвета `rgb(161, 58, 51)` (`#A13A33`).
- **A-06 · Открывается из навигации «OpenAPI 0.1» и по URL** (§1.3)
  - клик по ссылке «OpenAPI 0.1» → `#/openapi`; `goto('/#/openapi')` → тот же `h1`.
- **A-07 · Заголовок и мета** (§1.3)
  - мета: «Контракты», `docs/v0.1/ortus-openapi-v0.1.yaml`, «Исходный файл».
- **A-08 · Состояния** (§1.3)
  - загрузка: `[aria-busy="true"]` виден при задержанном ответе 365 КБ; ошибка 404 → «Не удалось загрузить docs/v0.1/ortus-openapi-v0.1.yaml (404)»; пусто по фильтру — A-03.
- **A-09 · Клавиатура** (§1.3)
  - `Tab` до поля фильтра, ввод, `Tab` → первый `summary`; `Enter`/`Space` раскрывает `details`.
- **A-10 · axe** (§1.3)
  - без serious/critical при раскрытом `details`.
- **A-11 · Раскладка 390** (§1.3)
  - таблица параметров внутри `div` с `overflow-x:auto` (`:415`) — скролл внутри карточки; `documentElement.scrollWidth <= 390`.

#### `docs-permissions.spec.ts` — 9

- **P-01 · Permissions** (11 #16)
  - Given: `#/permissions`.
  - Then: `h1` «Каталог прав»; `p` содержит «Версия 0.2» и `code` «view»; `h2` «Пользователи и доступ»; `th` «Ключ», «Действие», «Уровень», «Области», «Чувствительность»; в строке `members.invite` пилл «чувствительное»; `h2` «Шаблоны ролей» и `strong` «Владелец бизнеса», «Менеджер логистики», «Водитель», «Прораб», «Наблюдатель»; `h2` «Переименования из прототипа» со строкой `fleet.inspections.create` → `fleet.inspections.submit`; `summary` «Показать файл».
- **P-02 · Исходный YAML** (`:377`)
  - When: клик «Показать файл». Then: `details[open] pre > code` начинается с первой строки `design/docs/11-permissions.yaml` (читается в тесте).
- **P-03 · Пиллы ограничений** (`:363`)
  - Then: строка `modules.manage` содержит пилл «только владелец» (`11-permissions.yaml:31`); строка `fleet.earnings.read` — пиллы «закрытое» и «запрещено: driver» (`:113`); модуль с `industry: true` имеет пилл «отраслевой» и текст «зависит от» с `code` `core.calendar` (`:90–91`).
- **P-04 · Открывается по подписи «11 · Каталог прав» и по URL** (§1.3)
  - клик → `#/permissions`; прямой URL → `h1` «Каталог прав».
- **P-05 · Заголовок и мета** (§1.3)
  - мета: «Контракты», `docs/11-permissions.yaml`, «Исходный файл».
- **P-06 · Состояния** (§1.3)
  - загрузка; ошибка 404 → «Не удалось загрузить docs/11-permissions.yaml (404)».
- **P-07 · Клавиатура** (§1.3)
  - `summary` «Показать файл» достижим `Tab`, `Enter` раскрывает.
- **P-08 · axe** (§1.3)
  - таблицы с `thead > th` — без serious/critical.
- **P-09 · Раскладка 390** (§1.3)
  - таблица `min-width:720px` (`:366`) прокручивается внутри `tableWrap` (`overflow-x:auto`); страница без горизонтальной прокрутки.

#### `docs-frames.spec.ts` — 12

- **F-01 · Frame: Дизайн-система** (11 #22)
  - Given: `#/design-system`.
  - Then: `iframe[title="Дизайн-система"]` с `src`, оканчивающимся на `encodeURI('Дизайн-система.dc.html')`; нет `aside`, нет пейджера; контейнер страницы `display:none` (`:486`). `frameLocator`: `h1` «Токены, компоненты и состояния для всех модулей CRM» (`Дизайн-система.dc.html:36`), `nav[aria-label="Разделы"]` с 11 ссылками (`:38`), секции `#color … #copy` (`:59, :453`), `.sc-logic-error` отсутствует.
- **F-02 · Frame: Прототип** (11 #23)
  - Given: `#/prototype`.
  - Then: внутри iframe `[role="region"][aria-label="Панель демонстрации"]` (`Ортус CRM.dc.html:29`), `select` с опцией «Владелец · Дарья Зимина», `nav[aria-label="Основная навигация"]` (`:150`) с «Главная» `aria-current="page"`; нет текста «Не удалось загрузить модули прототипа» (`:192`).
- **F-03 · Frame: Объекты** (11 #24)
  - Given: `#/objects-variants`. Then: внутри iframe текст «Ремонт и стройка → Объекты: три подхода к карточке объекта» (`Объекты - варианты.dc.html:26`).
- **F-04 · Сеть/консоль** (11 #25, §5.3)
  - Given: `page.on('request')` и `page.on('console')` с начала сессии.
  - When: открыть три frame-документа и `#/data-model`.
  - Then: нет запросов к `unpkg.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com`; запросы `/design/vendor/react.production.min.js`, `/design/vendor/react-dom.production.min.js`, `/design/fonts/fonts.css` завершились 200; `console.error` с `[dc-runtime]` / `[dc] failed` отсутствуют.
- **F-05 · Объекты: фиксированная ширина 1440** (Q-119)
  - `docs-390`, `docs-800`: внутри iframe `document.documentElement.scrollWidth > clientWidth` (контент 1440 px, `:29`); верхний документ без горизонтальной прокрутки.
- **F-06 · Статика фреймов** (11 §7.2)
  - `request.get` для `/design/support.js`, `/design/Ремонт и стройка.dc.html`, `/design/ortus/{api,models,mock-data,extra-data,roadmap}.js`, `/design/README.md`, `/design/docs/README.md` → 200; `content-type` у `.js` начинается с `text/javascript`; `/design/Документация.dc.html` и `/design/Ortus CRM.dc.html` → 404 (Q-118).
- **F-07 · Открывается по подписи «Дизайн-система» и по URL** (§1.3)
  - клик → `#/design-system` → `iframe[title="Дизайн-система"]`; `goto('/#/prototype')` → `iframe[title="Прототип"]`.
- **F-08 · Заголовок и контекст** (§1.3)
  - `iframe.title` = заголовок документа; мета-строка, TOC, пейджер отсутствуют (11 §9 п.15).
- **F-09 · Состояния** (§1.3)
  - при переходе на frame нет `[aria-busy]` и `[role="alert"]` (`:238`); при 404 файла фрейма читалка ничего не показывает (как в прототипе — страница ошибки браузера внутри iframe).
- **F-10 · Клавиатура** (§1.3)
  - `Tab` из nav попадает внутрь iframe (фокус на первом интерактивном элементе фрейма); `Shift+Tab` возвращает.
- **F-11 · axe** (§1.3)
  - верхний документ без serious/critical (`frame-title` присутствует).
- **F-12 · Раскладка 390/1440** (§1.3)
  - iframe `width = main.clientWidth`, `height = main.clientHeight` (`:77`); на 390 nav скрыт, бургер открывает оверлей поверх iframe (`z-index:20`, `:467`).

#### `docs-layout.spec.ts` — 12

- **L-01 · TOC** (11 #20)
  - Given: `docs-1440`, `#/engineering`. Then: виден `aside[aria-label="Содержание"]` с текстом «На странице» и `button` по числу `h2,h3` в `article` (9 `h2` в `14-engineering.md`).
  - When: клик «Структура репозитория». Then: `main.scrollTop > 0`; заголовок в видимой области `main`.
  - Given: `setViewportSize({width: 1279, height: 900})`. Then: `aside` отсутствует.
- **L-02 · Узкий экран** (11 #21)
  - Given: `docs-800`. Then: `nav[aria-label="Документы"]` отсутствует; виден `button[aria-label="Разделы"][aria-expanded="false"]`.
  - When: клик. Then: nav виден с `position: absolute`, `aria-expanded="true"`, виден скрим `rgba(28, 42, 38, 0.32)`.
  - When: клик по ссылке «OpenAPI 0.1». Then: nav скрыт, `location.hash === '#/openapi'`.
  - When: снова открыть и кликнуть скрим. Then: nav скрыт.
- **L-03 · Пороги 960/1280** (11 §6.11)
  - 959×900: бургер есть, nav нет; 960×900: nav есть (280 px), бургера нет, `aside` нет на `#/engineering`; 1280×900: nav и `aside` есть; `padding` страницы `20px 16px 64px` при `< 960` и `32px 40px 80px` при `≥ 960` (`:486`).
- **L-04 · tokens.css подключён глобально** (§4.3 мастер-плана, 11 §12 п.17)
  - `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent').trim() === '#1F6B52'`; Given `emulateMedia({reducedMotion: 'reduce'})` Then `--ox-motion-base` = `0ms` (11 §10 #35); `document.fonts.check("600 16px 'Golos Text'")`, `check("500 14px 'IBM Plex Mono'")`, `check("24px 'Material Symbols Rounded'")` истинны после `document.fonts.ready` (11 §10 #34).
- **L-05 · Порог TOC `toc.length > 2`** (Q-115)
  - `docs-1440`: `#/components` (3 `h2`) → `aside` виден; `#/sql-control` (0 заголовков) → `aside` нет; `#/design-system` → `aside` нет.
- **L-06 · Размеры контролов как нарисовано** (11 §6.1, §6.4)
  - `button[aria-label="Разделы"]` 40×40 (`:31`); `label` поиска `min-height` 40 (`:39`); пункт nav `min-height` 36 (`:64`); активный пункт `background-color rgb(227, 239, 231)`, `color rgb(31, 107, 82)`, `font-weight 600` (`:473`).
- **L-07 · Открывается по подписи «14 · Инженерный регламент» и по URL** (§1.3)
  - клик → `#/engineering`; прямой URL → `h1` «14. Инженерный регламент — версия 0.2».
- **L-08 · Заголовок и контекст** (§1.3)
  - мета: «Старт разработки · 0.2», `docs/14-engineering.md`, «Исходный файл».
- **L-09 · Состояния при смене ширины** (§1.3)
  - `navOpen` сбрасывается при смене hash (`:224`); `resize` 800 → 1440 при открытом оверлее: nav становится статичным (`position: static`), скрим исчезает.
- **L-10 · Клавиатура** (§1.3)
  - 800: `Tab` → бургер, `Enter` открывает nav, `Tab` → первая ссылка «Комплект для старта»; `Escape` nav **не** закрывает (как в прототипе, `:31`, `:468`).
- **L-11 · axe на 390/800/1280/1440** (§1.3)
  - без serious/critical на `#/engineering` в 4 проектах, с открытым и закрытым оверлеем.
- **L-12 · Раскладка 390: нет горизонтальной прокрутки** (§1.3)
  - `documentElement.scrollWidth <= 390` на `#/engineering`, `#/openapi`, `#/permissions`, `#/data-model` (таблицы в `div[data-wrap="1"]` `overflow-x:auto`, `:297`).

Итого: 18 + 13 + 11 + 9 + 12 + 12 = **75** пунктов.

### 6.2 (б) Unit (Vitest, `apps/docs/test/unit/**`; имена `it()` на русском по источнику)

| Единица | Табличные кейсы (вход → ожидание) |
|---|---|
| `parseRoute(hash)` (`:196`) | `''` → `start`; `'#/nope'` → `start`; `'#/data-model'` → `data-model`; `'#/openapi?x=1'` → `openapi`; `'#/Prototype'` → `start` (регистр); `'#/roadmap'` → `roadmap`; `'#data-model'` (без `/`) → `start` |
| `ORDER`, `prevNext(id)` (`:169, :460–461`) | `start` → `{prev: undefined, next: 'data-model'}`; `raid` → `next: 'openapi'` (граница групп); `session` → `next: 'design-system'`; `proto-readme` → `{prev: 'tokens-css', next: 'prototype'}`; `objects-variants` → `next: 'roadmap'`; `roadmap` → `next: undefined`; `ORDER.length === 37`; первые 36 id равны `:127–165` |
| `BASENAMES` (`:171–174`) | `'10-data-model.md'` → `data-model`; `'README.md'` → `undefined`; `'ortus-openapi-v0.1.yaml'` → `openapi`; `'permissions.yaml'` → `permissions` (Q-117); `'tokens.css'` → `tokens-css`; `'control_0001_init.sql'` → `sql-control`; `'Ортус CRM.dc.html'` → `prototype`; `'Объекты - варианты.dc.html'` → `objects-variants`; `roadmap` (без path) не попадает в `BASENAMES` |
| `applyStyles(root)` (`:283–292`; `S` `:177–194`) | happy-dom: `<h1>` получает ровно `S.h1`; `<p style="x">` не трогается; `<pre><code>` → `MONO + 'font-size:13px;white-space:pre;'`; первый `h1` → `margin-top: 0`; первый `h2` сразу после `h1` → `border-top: 0`, второй — нет; все 16 тегов `S` покрыты снапшотом строк |
| `wrapTables(root)` (`:293–300`) | таблица оборачивается в `div[data-wrap="1"]` со стилем `overflow-x:auto;margin:0 0 16px;border:1px solid #DCE2D9;border-radius:10px;background:#FFFFFF;`; повторный вызов не оборачивает дважды; при `tHead` первым `td` ставится `border-top: 1px solid #E8ECE5` |
| `rewriteLinks(root)` (`:301–315`) | `<a href="https://x">` → `target=_blank rel=noopener`; `<a href="docs/11-permissions.yaml#x">` → `#/permissions`; `<a href="../README.md">` → без изменений; `<code>11-permissions.yaml</code>` → обёрнут в `a[href="#/permissions"]` со `style="text-decoration:none;"`, `code.style.color === '#1F6B52'`, `background === '#E3EFE7'`; `<pre><code>11-permissions.yaml</code></pre>` → без изменений; `<a><code>…</code></a>` → без изменений; `<code>docs/README.md</code>` → без изменений; `<code>Ортус CRM.dc.html</code>` → `#/prototype` |
| `tocOf(root)` (`:271–276`), `showToc(w, isFrame, toc)` (`:493`), `narrow(w)` (`:459`) | `h2,h3` → `[{id:'sec-0', text, level: 2|3}]` с `id` в DOM; `(1279,false,3)` → false; `(1280,false,3)` → true; `(1280,false,2)` → false; `(1440,true,9)` → false; `narrow(959)` → true; `narrow(960)` → false |
| `search(all, term)` (`:436–453`) | фикстура из 4 текстов: `term.length < 2` → `null`; «права» → `count` по регистронезависимому `indexOf`, `hit` сохраняет регистр оригинала, `before` = 70 символов до + `clean()` (`replace(/[#*`|>\-]{1,}/g,' ')`, схлопывание пробелов) + «…» при обрезке, `after` = 90 символов после; сортировка по `count` убыв.; 20 документов с совпадениями → 15; `count ≤ 999`; документ без совпадений не входит |
| `resultsLabel(results)` (`:479`), `meta(d, count)` (`:481`) | `[]` → «Ничего не найдено»; 1 → «Найдено в 1 документах» (как в прототипе); `({g:'api'}, 3)` → «Контракты · 3 совп.» |
| `renderPerms(yaml, raw)` на реальном `design/docs/11-permissions.yaml` (`:355–379`) | `h1` «Каталог прав»; `p` «Версия 0.2. Канонический реестр action keys. Уровни редактора роли: <code>view</code> <code>create</code> <code>edit</code> <code>review</code> <code>export</code> <code>settings</code>.»; 13 `h2` модулей, первый «Пользователи и доступ» с `<code>core.members</code>` и пиллом «системный»; строка `members.invite`: «Приглашать», «create», «tenant, unit», пилл «чувствительное» (`:18`); `modules.manage` → «только владелец» (`:31`); `fleet.earnings.read` → «закрытое», «запрещено: driver» (`:113`); `h2` «Шаблоны ролей» → 5 карточек `strong` в порядке «Владелец бизнеса», «Менеджер логистики», «Водитель», «Прораб», «Наблюдатель»; «Водитель» → «область по умолчанию: self», пилл «функция: driver»; `prototype_renames` → 10 строк, первая `fleet.inspections.create` → `fleet.inspections.submit`, вторая `fleet.trips.manage` → «fleet.trips.start, fleet.trips.return, fleet.routes.manage»; `details > summary` «Показать файл» + `esc(raw)`; `pill()` без иконки |
| `renderApi(spec, f)` на реальном `ortus-openapi-v0.1.yaml` (`:381–430`) | `f = ''`: `h1` «ORTUS CRM Constructor — Design API»; пиллы «OpenAPI 3.1.0», «версия 0.1.0-design»; «76 путей · 118 операций · 199 схем»; 18 `h2` тегов в порядке первого появления в `paths`; «Схемы <span>· 199</span>». `f = 'fleet'` → « · найдено N операций и M схем», N ≥ 1, схемы фильтруются по `includes`. `f = 'qzqzqz'` → «Операций по фильтру «qzqzqz» нет.» и нет блока «Схемы». `typeOf`: `{$ref:'#/components/schemas/Trip'}` → `Trip`; `{type:'array', items:{$ref:…Trip}}` → `Trip[]`; `{oneOf:[A,B]}` → `A | B`; `{type:'string', format:'uuid'}` → `string · uuid`; `{type:'string', enum:['a','b']}` → `string (a, b)`. `resolve({$ref:'#/components/parameters/X'})` → объект. `METHOD_TONE` get/post/put/patch/delete → info/ok/warn/warn/danger. Путь без `/api/v1`. `required` → `<span style="color:#A13A33;"> *</span>` |
| `roadmap.ts` (D-24) | `ROADMAP` глубоко равен `(await import('<корень>/design/ortus/roadmap.js')).ROADMAP` (чтение эталона в тесте разрешено); `roadmapToMarkdown` содержит 9 `## ` в порядке ключей; «P0 · итерация 2» у `calendar`, `tasks`, `forms`; «P1» у `spa`, «P2» у `repair`; у `forms` 4 «Шаг N» и `flowNote` дословно; «По ortus-openapi-v0.1.yaml» под каждым «Контракты API». Grep-тест: в `apps/docs/src/**` нет строк `ortus/roadmap.js` и `design/ortus` (читалка не ссылается на `ROADMAP` прототипа) |
| `loadFailed(path, status)` | `('docs/16-raid-glossary.md', 404)` → «Не удалось загрузить docs/16-raid-glossary.md (404)» |
| `tools/sync-design.js` на фикстуре `test/fixtures/design-mini/` | выходной набор файлов = ожидаемый список (без `Документация.dc.html`, `Ortus CRM.dc.html`, `uploads/`); `.dc.html` содержит одну строку `window.__resources={…}` перед `support.js` с ключами `support.js:1143, 1145`; строк `fonts.googleapis.com` нет, есть `./fonts/fonts.css`; остальные файлы байт-в-байт (`Buffer.equals`); повторный запуск не меняет файлы; `--check` → 0 при актуальной копии, 1 при изменённом эталоне; отсутствие `tools/vendor/react.production.min.js` → ошибка с текстом «WS-07» |

### 6.3 (в) Компонентные (Vitest + Testing Library + `vitest-axe`, `apps/docs/test/components/**`)

- `Header`: при `narrow` есть `button` «Разделы» с `aria-expanded` = `navOpen`, иначе нет; `a[href="#/start"]` с «ортус»/«документация»; `input` `type=search` с `aria-label` «Поиск по документам»; ввод вызывает `onQuery` с дебаунсом 220 мс (fake timers: 219 мс → не вызван, 220 → вызван один раз); axe.
- `SearchResults`: `listbox` «Результаты поиска», заголовок, `button` с `strong`/`meta`/`mark`; клик вызывает `go`; axe.
- `DocsNav`: 4 группы, 37 ссылок; текущая `aria-current="page"` и стили `#E3EFE7/#1F6B52/600`, остальные `transparent/#1C2A26/400`, иконка 18px; `narrow && open` → стиль с `position:absolute … z-index:20`, скрим `aria-hidden="true"` с `rgba(28,42,38,.32)`, клик по скриму → `onScrim`; ссылки в порядке DOM; axe.
- `DocPage`: `loading` → `[aria-busy="true"]` с 4 `span aria-hidden`; `error` → `[role="alert"]` с иконкой `error` и текстом; `kind='api'` → поле «Фильтр операций» 44 px, иначе нет; `showPager` false при `loading` и при frame; `prev/next` карточки с «← Назад»/«Далее →»; `showToc` по `(w, isFrame, toc)`; клик по кнопке TOC вызывает `scrollTo` на `main` с `behavior: 'smooth'` и смещением `−16` (`:494`); axe в каждом состоянии.
- `FrameView`: `iframe` с `title`, `src = '/design/' + encodeURI(path)`; контейнер страницы `display:none`; axe (`frame-title`).
- `App` (happy-dom + MSW `http.get('/design/docs/*')` из фикстуры `docs-mini/`): старт → `#/start` загружен; `hashchange` → `onHash` (тот же id — ничего; иной → `navOpen:false, apiFilter:'', results:null`, `:224`); `resize` обновляет `w`; после загрузки — `applyStyles → wrapTables → rewriteLinks → tocOf → mermaid`, затем `highlight(pendingTerm)` **или** `scrollTop = 0` (`:279–280`); `highlight` помечает только первое вхождение и прокручивает `main` на `top − 120` (`:350`); фильтр API перерисовывает через 200 мс без сброса прокрутки (`:253`).
- Клавиатура/фокус: `:focus-visible` из `tokens.css`; `Escape` не меняет состояние (как в прототипе).

### 6.4 (г) Контрактные/интеграционные

Backend у WS нет. Контрактные проверки WS-11 — против статики и чужих контрактов:

- `sync-design --check` в CI (job `build`): копия `public/design/` соответствует `design/` (хеши), иначе падение.
- «Шрифты офлайн» (11 §10 #34) и «`tokens.css` подключён» (L-04) — проверяют контракт WS-04 в контексте `apps/docs`.
- Эталон офлайн: в `docs-frames.spec.ts` F-04 дополнительно открывает `http://127.0.0.1:4173/Документация.dc.html#/prototype` и проверяет отсутствие запросов к `unpkg.com`/`fonts.googleapis.com`; падение — дефект `--offline` (WS-07), фиксируется в отчёте как блокер визуальной сверки в CI, не как дефект WS-11.
- Паритет данных: `ROADMAP` ↔ `design/ortus/roadmap.js` (§6.2); `DOCS` ↔ `Документация.dc.html:127–165` (тест читает файл эталона, извлекает массив регуляркой по `{ id: '…', g: '…', title: '…', path: '…', kind: '…', icon: '…' }` и сравнивает с первыми 36 записями `registry.ts`).

## 7. Шаги реализации (TDD-циклы в порядке выполнения)

Оценка: L ≈ 5 сессий (§5.1). Коммиты строго `test(ws-11): …` → `feat(ws-11): …` → `refactor(ws-11): …` (12 §8 п.25); один цикл — одна единица; реализация до теста запрещена (`tdd-protocol.md` §1); `skip` только со ссылкой на `decisions.md`; `waitForTimeout` запрещён — дебаунсы ждём через `expect.poll`/`toBeVisible` (`tdd-protocol.md` §3).

| # | Единица | Красный тест | Реализация (минимум) | Рефакторинг | Оценка |
|---|---|---|---|---|---|
| 0 | Среда | — | worktree, `pnpm install`, два браузера; если нет `apps/docs/package.json` — создать (`@ortus/docs`; Vite 8, React 19, TS 5, Vitest 5, `@testing-library/react`, `vitest-axe`, `happy-dom`, `marked@12`, `js-yaml@4`, `mermaid@11` с точной версией, `@axe-core/playwright`); подключить `@ortus/tokens` | — | 0,2 сессии |
| 1 | E2E-скелет | 6 спеков, 75 `test.fixme` (§6.1) + `visual`/`labels` спеки в `fixme` | `index.html` с `<title>Ортус — документация</title>`, пустой `App` | — | 0,3 |
| 2 | `tools/sync-design.js` | unit на `design-mini` (§6.2, последняя строка): сначала «модуль не найден», затем по утверждениям | копирование, фильтр, вставка `__resources`, замена шрифтов, `vendor/`, `fonts/`, `--check` | вынести `transformDcHtml(src)` чистой функцией | 0,4 |
| 3 | `registry.ts` | `parseRoute`, `prevNext`, `BASENAMES`, `ORDER.length === 37`, паритет `DOCS` с эталоном | `DOCS` (36 из `:127–165` + `roadmap`), `GROUPS`, `ORDER`, `BASENAMES` | — | 0,2 |
| 4 | `styles.ts` + `decorate.ts` | `applyStyles`, `wrapTables`, `rewriteLinks`, `tocOf`, `showToc`, `narrow` | объект `S` 1:1 (`:177–194`), функции над DOM | один обход `querySelectorAll('*')` | 0,4 |
| 5 | `search.ts` | `search`, `resultsLabel`, `meta` | `indexOf`-поиск, окно 70/90, `clean`, сортировка, `slice(0,15)` | — | 0,3 |
| 6 | `render/perms.ts` | `renderPerms` на реальном YAML | `pill`, `card`, `tableWrap`, `TH/TD`, `TONE`, `sens` (`:198–204, :355–379`) | шаблонные строки без логики в JSX | 0,4 |
| 7 | `render/api.ts` | `renderApi` на реальном OpenAPI, `typeOf`, `resolve`, фильтр | группировка по тегу, `details/summary`, параметры, тело, ответы, схемы (лимит 400) | — | 0,5 |
| 8 | `content/roadmap.ts` + `render/roadmap.ts` | паритет с `roadmap.js`, `roadmapToMarkdown`, grep-тест | порт данных, генератор markdown по §5 | — | 0,3 |
| 9 | `loader.ts`, `mermaid.ts` | `fetchText` с кешем и текстом ошибки (MSW); `renderMermaid` заменяет `pre` на `div` с рамкой, ошибка — тихо | `fetch('/design/' + encodeURI(path))`; `import('mermaid')` лениво; `initialize` с `themeVariables` `:325` | — | 0,3 |
| 10 | Компоненты | `Header`, `SearchResults`, `DocsNav`, `DocPage`, `Pager`, `Toc`, `FrameView` (§6.3) | разметка 1:1 с `:27–123` (инлайн-стили; `style-hover` → CSS-класс с `:hover` в одном `<style>`), иконки `material-symbols-rounded` | стили-константы в `styles.ts` | 0,8 |
| 11 | `App` + хуки | интеграционные компонентные (§6.3 `App`) | `useRoute` (`hashchange`), `useDoc` (кеш, `loading/error`, `paint`), `useSearch` (220 мс, `ensureAll`, отбрасывание), `useViewport` (`w`), фильтр API 200 мс | `useRef` для `pendingTerm`, `spec` | 0,6 |
| 12 | Снятие `fixme` | по одному: `docs-start` S-01…S-18 → `docs-layout` L-01…L-12 → `docs-search` Q-01…Q-13 → `docs-permissions` P-01…P-09 → `docs-api` A-01…A-11 → `docs-frames` F-01…F-12 | правки по падениям; каждый снятый пункт — отдельный коммит `test(ws-11): docs-start S-04 зелёный` | — | 1,0 |
| 13 | Визуальная и структурная сверка | `visual/docs-*.visual.spec.ts`, `docs-start.labels.spec.ts` (§8) | allowlist-записи с D-24 (`roadmap`), D-16 (iframe), при необходимости D-27 | — | 0,5 |
| 14 | MCP-проходка, evidence, отчёт | §8 для 6 ключей | `docs/plan/evidence/docs-*/`, `docs/plan/reports/WS-11.md`, строка `status.md` | — | 0,5 |

## 8. Проверка страницы

Общее для всех ключей:

- Эталон: `node tools/design-preview.js design 4173 --offline` → `http://127.0.0.1:4173/Документация.dc.html#/<id>`; персонажей и демо-панели нет; ширина = viewport проекта (`w = window.innerWidth`, `:207`); часы не нужны (кроме `#/prototype`, §8.5).
- Реализация: `$env:PORT = "5184"; pnpm --filter @ortus/docs dev` → `http://127.0.0.1:5184/#/<id>`.
- E2E: `pnpm --filter @ortus/docs exec playwright test --project=docs-390 --project=docs-1440 --grep "<key>"` (после появления корневого `e2e:docs` — `pnpm e2e:docs -- --project=docs-390 --project=docs-1440 --grep "<key>"`); раскладка дополнительно `--project=docs-800 --project=docs-1280`.
- Снимок: область `#app` (реализация) и `#dc-root` (эталон), оба `height:100vh`; порог `maxDiffPixelRatio: 0.01`; baseline per-platform (D-32).
- MCP: `mcp__playwright__browser_*` своего инстанса (`--isolated --output-dir .playwright-mcp/5184`); все действия по ролям и подписям, не по координатам (исключение — клик по скриму `aria-hidden`, §8.6).
- Evidence: `docs/plan/evidence/<key>/{390,800,1280,1440}.png`, `reference-{390,800,1280,1440}.png`, `snapshot.txt` (дерево доступности), `console.txt`, `network.txt`; проверяющий — `…/verify/`.
- Порты проверяющих: `6033` (`docs-start`) … `6038` (`docs-layout`) по порядку строк §5.3 (`home` → 6001).

### 8.1 `docs-start`

Визуальная (`visual/docs-start.visual.spec.ts`): документы `start`, `engineering`, `data-model`, `permissions`, `sql-core` × 4 проекта (§5.4); ожидание — `article h1` (для `sql-core` — `pre code`), для `data-model` — `article svg`; на 1280/1440 `mask: [getByRole('navigation', {name: 'Документы'})]` на обеих целях (одинаковый прямоугольник 280 px нейтрализует 37-ю ссылку); отдельный снимок `nav` на 1440 `#/start` с `clip` до низа `a[href="#/objects-variants"]` + 8 px (до этой границы эталон и реализация совпадают). Структурная (`docs-start.labels.spec.ts`): все 36 документов на `docs-1440` (+ `start`, `engineering` на `docs-390`): `collectLabels()` обеих целей равны после удаления из реализации текстов по записям `kind: label` allowlist («Карта следующих итераций»).

MCP:

1. `browser_navigate` `http://127.0.0.1:5184/#/start` → `browser_snapshot`: `banner` с link «ортус документация», `searchbox` «Поиск по документам», `navigation` «Документы» с 4 группами и 37 link, `main` с heading «Ортус CRM — комплект для старта разработки v0.2», link «Исходный файл», link «Далее →» «10 · Модель данных», `complementary` «Содержание» (на 1440).
2. `browser_click` link «10 · Модель данных» → heading «10. Модель данных — версия 0.2», диаграмма (SVG `graphics-document`/`img`).
3. `browser_click` «← Назад» → «Комплект для старта».
4. `browser_navigate` `#/nope` → «Комплект для старта» `current`.
5. `browser_navigate` `#/roadmap` → heading «Карта следующих итераций», 9 heading level 2.
6. `browser_resize` 390×844 → button «Разделы»; 800×900; 1280×900 → navigation + complementary.
7. `browser_console_messages` → без `error`/`warning` React; `browser_network_requests` → только `127.0.0.1:5184`.
8. `browser_take_screenshot` на 4 ширинах → `evidence/docs-start/`; рядом `reference-*.png` с 4173 (`browser_navigate` на эталон, те же шаги 1–6).

### 8.2 `docs-search`

Визуальная: снимок `#app` на 1440 и 390 после `fill('права')` и появления `listbox` на обеих целях (эталон: `type` в `input[aria-label="Поиск по документам"]`); порядок и сниппеты детерминированы (одинаковые тексты документов). Структурная: `collectLabels()` при открытом списке (тексты `button` результатов входят) равны.

MCP:

1. `#/start` → `browser_type` в searchbox «права» → `browser_snapshot`: `listbox` «Результаты поиска», первая строка «Найдено в N документах», 1…15 `button` с «<Группа> · N совп.».
2. `browser_click` первый результат → hash документа, `mark` виден в `main`.
3. `browser_type` «qzqzqzqz» → «Ничего не найдено».
4. `browser_type` «п» → listbox отсутствует.
5. `browser_resize` 390×844 → ширина списка 358 px.
6. консоль/сеть; снимки → `evidence/docs-search/`.

### 8.3 `docs-api`

Визуальная: `#/openapi` на 390/1440 после `article h1` (выше первой свёртки); дополнительно 1440 после `fill('fleet')` (ожидание текста «найдено»); структурная на 1440.

MCP:

1. `browser_navigate` `#/openapi` → heading «ORTUS CRM Constructor — Design API», text «76 путей · 118 операций · 199 схем», `textbox` «Фильтр операций», headings «Context · N» … «Fleet · N», «Схемы · 199».
2. `browser_click` первый `summary` в «Fleet» → «operationId», «Права», «Область», «Ответы».
3. `browser_type` «fleet» → « · найдено N операций и M схем».
4. `browser_type` «qzqzqz» → «Операций по фильтру «qzqzqz» нет.».
5. `browser_resize` 390×844 → таблица параметров прокручивается внутри карточки.
6. консоль/сеть; снимки → `evidence/docs-api/`.

### 8.4 `docs-permissions`

Визуальная: `#/permissions` на 390/800/1280/1440 (входит в выборку §5.4); структурная на 1440 и 390.

MCP:

1. `#/permissions` → heading «Каталог прав», text «Версия 0.2. Канонический реестр action keys. Уровни редактора роли: view create edit review export settings.», heading «Пользователи и доступ», `table` с columnheader «Ключ» «Действие» «Уровень» «Области» «Чувствительность», cell «members.invite» … «чувствительное».
2. heading «Шаблоны ролей» с «Владелец бизнеса» … «Наблюдатель»; heading «Переименования из прототипа», row «fleet.inspections.create» «fleet.inspections.submit».
3. heading «Исходный YAML», `browser_click` «Показать файл» → `code` с `version: "0.2"`.
4. `browser_resize` 390×844 → таблица 720 px в прокрутке.
5. консоль/сеть; снимки → `evidence/docs-permissions/`.

### 8.5 `docs-frames`

Визуальная (`visual/docs-frames.visual.spec.ts`): `#/design-system`, `#/prototype`, `#/objects-variants` на 4 проектах; ожидание внутри `frameLocator` `#dc-root .sc-host`, для прототипа — `nav[aria-label="Основная навигация"]`; для `#/prototype` на обеих целях `page.clock.install({time: '2026-10-01T10:30:00+03:00'})` до загрузки (приветствие и `hhmm()` внутри прототипа, D-45); порог 0,01; структурная — верхний документ (iframe `title`, nav).

MCP (evidence `docs-frames/<w>/{design-system,prototype,objects-variants}.png`, w ∈ 390/800/1280/1440):

1. `browser_navigate` `#/design-system` → `browser_snapshot`: iframe «Дизайн-система» с heading «Токены, компоненты и состояния для всех модулей CRM», navigation «Разделы» 11 link.
2. `#/prototype` → region «Панель демонстрации», combobox «Персонаж» с option «Владелец · Дарья Зимина», navigation «Основная навигация» с link «Главная» current; нет text «Не удалось загрузить модули прототипа».
3. Внутри прототипа: `browser_select_option` «Владелец · Дарья Зимина» → `browser_click` «Модули и место» → карточка «Ремонт и стройка» (dc-import `Ремонт и стройка.dc.html` грузится из `public/design/`, `Ортус CRM.dc.html:2126`).
4. `#/objects-variants` → text «Ремонт и стройка → Объекты: три подхода к карточке объекта»; на 390/800 горизонтальная прокрутка внутри iframe (Q-119).
5. `browser_network_requests` на каждой ширине: нет `unpkg.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com`; есть `/design/vendor/react.production.min.js` 200, `/design/support.js` 200, `/design/ortus/api.js` 200 с `text/javascript`.
6. `browser_console_messages`: нет `[dc-runtime]`, `[dc] failed`; `browser_evaluate` `document.querySelector('iframe').contentDocument.querySelector('.sc-logic-error')` → `null`.
7. Снимки на 4 ширинах + эталон с 4173.

### 8.6 `docs-layout`

Визуальная: `#/engineering` на 4 проектах (входит в §5.4), плюс 800 с открытым оверлеем nav (на обеих целях `click` «Разделы»); структурная на 800 с открытым/закрытым оверлеем.

MCP:

1. `browser_resize` 800×900 → `#/engineering` → `browser_snapshot`: button «Разделы» `expanded=false`, нет navigation.
2. `browser_click` «Разделы» → navigation «Документы» виден, `expanded=true`.
3. `browser_click` link «OpenAPI 0.1» → navigation скрыт, heading «ORTUS CRM Constructor — Design API».
4. `browser_click` «Разделы», клик по скриму (единственное место, где допустим клик по координатам — скрим `aria-hidden`) → скрыт.
5. `browser_resize` 1280×900 → navigation и complementary «Содержание» с button «Структура репозитория»; `browser_click` → заголовок в области.
6. `browser_resize` 1279×900 → complementary исчез.
7. `browser_resize` 390×844 → `scrollWidth` 390; `browser_evaluate` `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent')` → `#1F6B52`.
8. консоль/сеть; снимки → `evidence/docs-layout/`.

## 9. Критерии готовности (DoD)

- [ ] 6 спеков, 75 пунктов §6.1 без `fixme` на `docs-390` и `docs-1440` (раскладочные — на 4 проектах); `pnpm --filter @ortus/docs exec playwright test` зелёный; `playwright-report/` приложен к отчёту; ретраев нет (`verification-protocol.md` §1 п.4).
- [ ] Unit §6.2 и компонентные §6.3 зелёные (`pnpm --filter @ortus/docs test`), включая паритет `DOCS` и `ROADMAP` с эталоном и grep-тест «нет ссылок на `ortus/roadmap.js`».
- [ ] `visual`: 5 документов × 4 ширины + 3 фрейма × 4 ширины + поиск/фильтр/оверлей в допуске 0,01 или в allowlist с D-ID; `labels`: 36 документов совпадают (исключение — только запись D-24).
- [ ] `apps/docs/e2e/visual/allowlist/*.md`: каждая запись в формате §4.8 с `decision`; обязательные записи в `docs-start.md`: `- kind: label · target: «Карта следующих итераций» · mode: both · reason: документ добавлен по D-24, в эталоне нет · decision: D-24 · owner: WS-11` и `- kind: no-reference · target: #/roadmap · mode: both · reason: страницы нет в прототипе · decision: D-24 · owner: WS-11`; `tools/allowlist-lint.js` зелёный.
- [ ] Ни одного запроса к `unpkg.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com` в e2e (`page.on('request')`) и в MCP (`browser_network_requests`) для всех 6 ключей.
- [ ] `tools/sync-design.js --check` зелёный; `public/design/` в `.gitignore`; `design/` не изменён (`git status --porcelain design/` пуст).
- [ ] `tokens.css` подключён глобально (L-04), шрифты офлайн (11 §10 #34), `prefers-reduced-motion` (11 §10 #35).
- [ ] axe: 0 serious/critical на всех 6 ключах и в компонентных тестах.
- [ ] MCP-проходка §8 выполнена для каждого ключа; evidence 4 ширины + эталон + `snapshot.txt` + `console.txt` + `network.txt` в `docs/plan/evidence/docs-*/`; раздел «Проверка MCP» в отчёте с расхождениями и исправлениями.
- [ ] `eslint`, `prettier`, `tsc --noEmit` без ошибок; нет литералов `:5173`/`:3000`/`:5184` в `e2e/**` (12 §6 п.4); нет прямого `fetch` в компонентах (только `loader.ts`).
- [ ] Коммиты `test(ws-11)` предшествуют `feat(ws-11)` для каждой единицы; ревью `requesting-code-review` → `approve`.
- [ ] Отчёт `docs/plan/reports/WS-11.md` по `orchestration.md` §5 с дословным выводом прогонов (последние 40 строк), списком `fixme` (пуст, кроме частей S-15 «не применимо» со ссылкой на этот бриф), заявками интегратору: корневые скрипты `dev:docs`/`e2e:docs`; `--offline`-подстановка jsDelivr (§10 п.3); правка `#/api` → `#/openapi` в §5.3 (§10 п.1).
- [ ] Строка WS-11 в `docs/plan/status.md` → `на проверке` со ссылками на отчёт и evidence.

## 10. Риски, расхождения, открытые вопросы

| # | Что | По умолчанию делаем |
|---|---|---|
| 1 | §5.3 мастер-плана указывает эталон `docs-api` как `#/api`; в реестре id — `openapi` (`:144`), `#/api` парсится в `start` | тестируем `#/openapi`; в отчёте — замечание интегратору на правку §5.3 |
| 2 | 37-я ссылка «Карта следующих итераций» (D-24) ломает «36 ссылок» (11 #3) и структурную/пиксельную сверку навигации | S-03 проверяет 36 + 1; `labels` исключает текст по allowlist D-24; `visual` маскирует nav и отдельно снимает nav с `clip` до 36-й ссылки (§8.1); `#/roadmap` — `no-reference` |
| 3 | Эталон на 4173 в `--offline` (WS-07) подменяет только React и шрифты (§2.2); `marked`/`js-yaml` грузятся с jsDelivr (`:16–17`), mermaid — `import()` с jsDelivr (`:323`) → без сети md/perm/api на эталоне показывают «Библиотека не загрузилась» через 10 с | на dev-машине сеть есть; для CI — заявка интегратору: `--offline` дополнительно подменяет `cdn.jsdelivr.net/npm/marked@12/marked.min.js`, `js-yaml@4/dist/js-yaml.min.js`, `mermaid@11/dist/mermaid.esm.min.mjs` локальными копиями из `tools/vendor/` (аддитивно к WS-07) |
| 4 | Версия mermaid: эталон берёт `@11` (последний 11.x), приложение — пин; разные патчи дают разный SVG → пиксельный диф в `data-model` | пин приложения = версия, которую вендорит WS-07; до этого снимок `data-model` сравнивается с `mask` на блок диаграммы (`div:has(> svg)`) и записью allowlist `kind: pixel · decision: D-16` |
| 5 | «Найдено в 1 документах» без склонения (`:479`) | как в прототипе; новый вопрос владельцу в отчёте (предложение: `plural`) |
| 6 | Бургер 40×40 (`:31`), поле поиска 40 px (`:39`), пункт меню 36 px (`:64`) против инварианта «цели ≥ 44 px» (11 §9 п.3, §1.3) | как нарисовано; в S-18/L-06 порог 40; новый вопрос владельцу в отчёте |
| 7 | Пилл метода содержит `get` строчными с `text-transform:uppercase` (`:415`); 11 #14 говорит «в верхнем регистре» | проверяем текст `get` + вычисленный `text-transform` (A-02); `labels` не затронут (`span` не в выборке) |
| 8 | Офлайн: `fetch` бросает исключение с английским текстом браузера, прототип показывает `e.message` (`:242`) | как в прототипе (S-15); текст фиксируется по факту на эталоне |
| 9 | Закрытие результатов поиска по Esc/клику вне не реализовано; `onHash` `:224` содержит бессмысленное выражение (Q-114) | как в прототипе: закрытие только при навигации/`< 2` символов; выражение не переносится (без влияния на поведение) |
| 10 | `ensureAll` тянет ~1 МБ при первом поиске (Q-114) | как в прототипе; предсобранный индекс не делаем |
| 11 | `BASENAMES['permissions.yaml']` на несуществующее имя (Q-117); `docs/README.md:3` упоминает `uploads/ortus-crm-design-v0.1(1)/` в коде, а не ссылкой | как в прототипе: ключ сохраняем (unit-кейс), `uploads/` не копируем |
| 12 | «Объекты - варианты» 1440 px → горизонтальная прокрутка в iframe (Q-119) | как в прототипе (F-05) |
| 13 | `support.js` требует `'unsafe-eval'`/`'unsafe-inline'` (11 §7.3); CSP в `apps/docs` не задаём | в `index.html` CSP нет; если WS-01/CI добавит заголовки — фреймы ломаются (тест F-01) → эскалация |
| 14 | «Библиотека не загрузилась» (`:197`) недостижимо в приложении (библиотеки в бандле) | ключ в `texts/docs.ts` остаётся; тест не пишется, причина в отчёте |
| 15 | Генератор `tools/e2e-skeleton.js` рассчитан на отчёты `0N`/`06b` | если не принимает 11 §10 — скелет вручную по тем же правилам (§4.1) |
| 16 | `apps/docs/playwright.config.ts` принадлежит WS-07; в нём может не быть `webServer` для docs на `PORT` или проектов 390/800/1280/1440 | локальная копия с пометкой `Owner: WS-07` в worktree, заявка интегратору; при слиянии остаётся версия WS-07 |
| 17 | Прототип внутри iframe зависит от ширины iframe, а не окна (11 §7.3): раскладка CRM на `#/prototype` при 1280 = ширина `main` 1000 px (rail-режим CRM) | это свойство и эталона, и реализации — совпадает; фиксируем в evidence |
| 18 | Хост-протокол `postMessage` «Объекты - варианты» (`design_doc_mode=canvas`, 11 §7.1 п.8) шлёт сообщения родителю | читалка их игнорирует (как прототип); F-03 не проверяет |
| 19 | Ветка в `orchestration.md` §1 — `ws/NN-<slug>`, в `workflow.template.js:69` — `ws/ws-11-docs-site` | используем форму скрипта `ws/ws-11-docs-site` |
| 20 | Мета-строка `#/roadmap` («Исходный файл» отсутствует) и `labels` для неё не сверяются | страница `no-reference` (D-24); e2e S-12 проверяет текст самостоятельно |

Новые вопросы владельцу (вносит интегратор, нумерация после Q-120): склонение «документах» (п.5); цели нажатия 40 px в читалке (п.6); текст офлайн-ошибки (п.8).

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-11 (docs-site) волны 1 проекта «Ортус CRM». Прочитай полностью `docs/plan/ws/WS-11-docs-site.md`, затем все документы его раздела 3 в указанном порядке, включая `design/Документация.dc.html` (480 строк), `design/support.js:1143–1153`, `design/ortus/roadmap.js`, `docs/plan/analysis/11-design-system-and-docs-site.md` §6–§12 и протоколы `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md`, `docs/plan/orchestration.md`. Эталон `design/` неприкосновенен; локальный эталон — `node tools/design-preview.js design 4173 --offline`. Работай в worktree `..\ortus-ws-11` на ветке `ws/ws-11-docs-site` от `main`; выполни `pnpm install`, `pnpm e2e:install`, `pnpm mcp:install`; порт dev-сервера `5184` (`$env:PORT`). PowerShell 5.1: без `&&`; коммиты через `git commit -F` без BOM, Conventional Commits `test(ws-11)` → `feat(ws-11)` → `refactor(ws-11)`.

Сделай строго по брифу: (1) первым коммитом — 6 e2e-скелетов `apps/docs/e2e/docs-{start,search,api,permissions,frames,layout}.spec.ts` с 75 пунктами раздела 6.1 в `test.fixme`, имена тестов дословно; (2) далее циклы раздела 7 в указанном порядке — `tools/sync-design.js`, `registry`, `decorate`, `search`, `renderPerms`, `renderApi`, `roadmap`, `loader/mermaid`, компоненты, `App`; каждый цикл начинается с красного теста из разделов 6.2–6.3; (3) снимай `fixme` по одному, коммит на пункт; (4) выполни `verification-protocol.md` §1–§4 по разделу 8 для каждого из 6 ключей: e2e на `docs-390`/`docs-1440`, визуальная и структурная сверка с 4173 на 390/800/1280/1440, проходка через `mcp__playwright__*` (загружай инструменты через ToolSearch) с evidence в `docs/plan/evidence/docs-<key>/`; (5) убедись, что ни один запрос не уходит на `unpkg.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com`.

Не трогай `design/`, `tools/design-preview.js`, `tools/vendor/`, `apps/docs/playwright.config.ts`, `packages/**`, `apps/web/**`, корневой `package.json`; недостающие чужие контракты оформляй по разделу 4.1 и перечисляй в отчёте как заявки интегратору. Любое отклонение от прототипа — только через запись allowlist с D-ID или вопрос в `docs/plan/decisions.md`; до решения — поведение прототипа.

Верни: отчёт `docs/plan/reports/WS-11.md` по формату `orchestration.md` §5 (сделано; таблица тестов red → green с хешами; дословный вывод `pnpm --filter @ortus/docs test` и `… exec playwright test` — последние 40 строк; раздел «Проверка MCP» по ключам; оставшиеся `fixme` с причинами; изменённые и запрошенные контракты), обновлённую строку WS-11 в `docs/plan/status.md`, и JSON по схеме отчёта: `ws`, `branch`, `reportPath`, `done`, `pagesDelivered` (6 ключей), `fixmeLeft`, `contractsChanged`, `testRunsOk`.
