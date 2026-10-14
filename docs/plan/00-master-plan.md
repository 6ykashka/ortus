# Мастер-план реализации «Ортус CRM» и сайта документации

Версия 1.0 · 03.10.2026 · владелец — планировщик; изменения — только через интегратора волны (`orchestration.md` §7).

Основа — черновик A (`docs/plan/drafts/draft-A.md`, победитель судейства 146/143/128) с вплетёнными решениями черновиков B и C (перечислены в §0.3) и закрытыми пробелами критики (§0.4).

## 0. Как читать план

### 0.1 Документы и их роли

| Документ | Роль | Кто правит |
|---|---|---|
| `docs/plan/00-master-plan.md` (этот файл) | что делаем, кто, в каком порядке, как проверяем | планировщик; интегратор — после барьера волны |
| `docs/plan/tdd-protocol.md` | **как** пишется каждый WS: e2e-скелет первым, red→green→refactor по слоям, DoD | не меняется |
| `docs/plan/verification-protocol.md` | **как** принимается каждая страница: e2e на 390/1440, визуальная сверка с эталоном, проходка Playwright MCP, ревью | не меняется |
| `docs/plan/orchestration.md` | роли агентов, worktree, волны, отчёт исполнителя, интегратор | не меняется |
| `docs/plan/workflow.template.js` | скрипт запуска волны; аргументы `args.ws` — §7 этого плана | интегратор (аддитивно, §7.5) |
| `docs/plan/decisions.md` | D-13…D-24 приняты; Q-01…Q-120 — вопросы владельцу продукта с поведением по умолчанию; новые D-25…D-52 — §10.3 этого плана, вносит WS-00 | планировщик → владелец продукта |
| `docs/plan/analysis/00…12, 06b` | карты прототипа: «Инвентарь», «Инварианты», «Чек-лист приёмки», «Открытые вопросы», «Факты для плана» — **первичные входы брифов** | WS-00 (точечные правки) |
| `docs/plan/ws/WS-NN-<slug>.md` | бриф WS (девять разделов `orchestration.md` §1), генерируется из §5 этого плана | планировщик |
| `docs/plan/status.md` | состояние каждого WS (не начат / в работе / возвращён / готово), ссылки на отчёт и evidence | исполнитель — своя строка; интегратор |
| `docs/plan/reports/WS-NN.md` | отчёт исполнителя (`orchestration.md` §5) | исполнитель |
| `docs/plan/evidence/<page-key>/` | снимки и выдержки MCP-проходки (фаза 1), `…/phase2/` (фаза 2) | исполнитель, проверяющий (`…/verify/`) |
| `docs/plan/critique/wave-N.md` | пропуски критика полноты после волны | критик |
| `design/docs/14-engineering.md`, `13-backlog-s0-s2.md`, `15-quality-security.md` | стек, структура репозитория, истории S0–S2, уровни тестов | не меняются (эталон) |

Условные ссылки: «02 §6.9» = `docs/plan/analysis/02-company.md`, раздел 6.9; «06b §18 #27» = `06b-repair-child-layout.md`, чек-лист, пункт 27; «`:2861`» = строка `design/Ортус CRM.dc.html`; «`api.js:392`» = `design/ortus/api.js`; «10 G-11» = пробел контракта из 10 §7.4.

### 0.2 Соглашение о командах (закрывает расхождение npm/pnpm)

Протоколы написаны через `npm run …`, `decisions.md` D-23 фиксирует pnpm. Правило: корневой `package.json` (WS-01) объявляет все скрипты (`lint`, `typecheck`, `test`, `e2e`, `e2e:full`, `dev:web`, `mcp:install`, `e2e:install`, `examples`, `verify-pages`); `npm run <x>` и `pnpm <x>` вызывают один и тот же скрипт, поэтому тексты протоколов остаются без правок. Установка зависимостей — только `pnpm install` (в каждом worktree, 12 §8 п.16). `make <x>` — Go-сторона и стенд (`gen`, `up`, `migrate`, `seed`, `examples`, `dev`).

### 0.3 Что взято из черновиков B и C (grafts)

| Откуда | Что | Куда в плане |
|---|---|---|
| B §4.4 | матрица «персонаж × страница → состояние на старте» как параметры `reference`-фикстуры и обязательные пункты «нет права / модуль не подключён» | §4.9, §8.2 |
| B §7 | таблица 51 метод `api.js` → операции OpenAPI 0.2 → владелец хендлера (`x-adapter-method`, составные вызовы) | §4.10, WS-03/15/51 |
| B §8 | таблица барьеров волн с командами интегратора и evidence | §6.5 |
| B §2.6 | готовые `args.ws` на волны 0–3 с `pages`, `reviewers`, `suites` | §7.2 |
| B WS-48 | повторная MCP-проходка фазы 2 (`evidence/<key>/phase2/`), `mock-vs-http.spec.ts`, Schemathesis в `backend/test/contract/` | WS-53 |
| B D-31 | эквиваленты демо-флагов в фазе 2: `context.setOffline`, заголовок `X-Test-Scenario` только при `APP_ENV=e2e` | D-31, WS-40, WS-53 |
| B D-32, §5.3 п.3 | примеры контракта = снимки сценарного сервера на сиде (`make examples`), ajv-валидация, CI-проверка свежести | D-43, WS-51 |
| B §5.3 п.8 | Windows-dev: два браузера (Playwright + MCP), `pnpm install` в каждом worktree, PowerShell 5.1 без `&&`, baseline per-platform | WS-01, WS-07 |
| B §4.3 | шестой ключ документации `docs-layout`; проверка «нет запросов к unpkg/jsdelivr/fonts.googleapis» через `browser_network_requests` | WS-11, §5.3 |
| B WS-03/WS-07 | явный перечень операций, добавляемых в 0.2, фикстура `api/openapi/screens.yaml` «экран → operationId» с тестом существования | §4.1, WS-03, WS-15 |
| B §3 | правила раннего старта внутри волны (WS-12 после `index.ts` типов; страницы после `useRun`/`ModalHost`/демо-панели) | §6.4 |
| B §5.1 | backend-WS первым коммитом контрактные тесты на strict server с `t.Skip` (зеркало e2e-скелета) | §8.1 |
| B D-28 | компонент `DemoOnly` для кнопок «Демо: …» (виден в `dev`/`e2e`, скрыт в http-сборке) | D-44, WS-10 |
| C WS-41 | отдельный WS сквозных сценариев J1–J18 + «Путь проверки» (8 шагов + 7 негативных), пишут не авторы экранов, тег `@smoke`, оба режима | WS-55 |
| C WS-05 | паритетная сюита адаптеров: одна Vitest-сюита (07 §14) против `adapter-mock` и против `adapter-http + MSW` уже в волне 2; каждый из 51 метода и каждый код ошибки — минимум один тест | WS-06, WS-51 |
| C WS-06 | `tools/design-preview.js --offline` (подстановка `window.__resources` и `fonts.css` на лету, `design/` не меняется), `tools/labels-dump.js` | WS-07 |
| C §2.6 | определение «заготовки S3+» (а)–(е) | §1.4, WS-60…67 |
| C §7 | модалки как ключи `pages` (`modal-assign`, `modal-invite`, `modal-createRole`, `modal-request`, `modal-confirm`, `modal-sheet`) | §5.3, §7.2 |
| C §5.3 | цепочка «при добавлении страницы»: Stop-хук → проверяющие по `ws.pages` (≤ 3 итерации) → ревью → интегратор; порт исполнителя `5173 + N`, интегратор — 5173 | §7.3, §7.4 |
| C D-25 | URL-схема `/t/:tenantId/:page`, `/platform/:page`, параметры страниц в search — ADR до волны 0 | §4.7, D-25 |
| C §5.2 | зарезервированные диапазоны номеров миграций; файл на модуль в `backend/test/isolation/<module>_test.go` | §4.11, D-51 |
| C WS-56/57, D-36 | явные WS notify+realtime и автоматизации «осмотр → ответ формы → задача» | WS-70, WS-71 |
| C WS-04 | сценарные оверлеи сида `scenario('empty-review')`, `VITE_SEED_SCENARIO` | WS-05, WS-06 |
| C WS-38/39 | вкладки ремонта в волне 2 параллельно с карточкой объекта по контракту контейнера и делению 06b §20 п.1 (a–f) | WS-31, WS-32 |
| C WS-26 | provisioning (`createPlatformTenant` + контроллер canary → партии) как отдельный backend-WS с 2 ревьюерами | WS-56 |
| C WS-11 | отдельные `demo-panel.spec.ts` и `guide.spec.ts` помимо `shell.spec.ts` | WS-10 |

### 0.4 Пробелы, которые закрывает этот план (gapsInAll)

| # | Пробел | Где закрыт |
|---|---|---|
| П1 | бриф вкладок ремонта строится на уже написанной карте `06b` (инвентарь §3, чек-лист §18, факты §20), а не на «карте 13» | WS-32, §2.4, D-36 |
| П2 | конфликт с принятым D-24: `planned` **не реализуется**; `roadmap.js` → документация «карта следующих итераций»; читалка проверяется на `ROADMAP`; новые решения нумеруются с D-25 | §1.3, WS-11, §10.3 |
| П3 | S1-10 (импорт CSV), S1-07 (переключатель бизнеса), S1-22 («Хранилище») привязаны к WS с решением «нет в прототипе → backend-only» | D-48, WS-40, WS-72, §9.2 |
| П4 | каталог «Как воспроизвести» состояний эталона на 4173 — рецепты UI-шагов, одинаково исполняемые на эталоне и в реализации | §2.4, WS-07 |
| П5 | единый рецепт снимка на 390: viewport = ширина проекта Playwright, селект «Ширина» = «По окну», панель скрыта | D-45, §2.3 |
| П6 | изоляция Playwright MCP для параллельных проверяющих: порт, свой MCP-инстанс, очередь ≤ 6 | D-49, §7.4 |
| П7 | исправления отчётов E1–E6 и прочие — задача WS-00 с владельцем, сроком «до генерации скелетов» и проверкой критиком | WS-00 |
| П8 | AC-13/AC-14 привязаны к WS и уровню теста; реестр AC-01…AC-15 ↔ WS в одной таблице | §9.1 |
| П9 | формат allowlist структурных отличий (`data-a11y-extra`, файл на страницу, обязательный D-ID, lint, ревью роста на барьере) | D-29, D-50, §4.8 |
| П10 | `tokens.css` (`prefers-reduced-motion`, `:focus-visible`) подключается глобально в `apps/web` и `apps/docs` с тестом; проекты Playwright читалки на 390/800/1280/1440 | WS-04, WS-07, WS-11 |
| П11 | один `StrictServerInterface` на много модулей: генерация по тегам, композитный роутер у интегратора, контракт после волны 0 только аддитивный | D-47, §4.1 |
| П12 | команды `npm run` ↔ `pnpm` | §0.2, D-38 |
| П13 | детерминизм `Intl`/ICU: `tools/check-icu.js` в CI и pre-test, `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'` в проектах Playwright | WS-01, WS-07 |
| П14 | утечки сида «Альты» в «Лотос»: одно решение до снимков — сид фазы 1 повторяет прототип (Q-31), падения исправляются (Q-30) | D-27, D-46 |
| П15 | мощность проверки: расчёт агентов и очередь проверяющих по волнам | §6.3, §7.4 |
| П16 | standalone-режим `Ремонт и стройка.dc.html` — вне объёма, пункты 06b §18 #6–9 исключаются из скелета со ссылкой | D-36 |
| П17 | правило для `e2e:full`: эталон — mock-сид; расхождения стенда там, где канон строже (DP-06/07, 404) — через конфигурацию `APP_ENV=e2e` и allowlist `mode: stand` | D-46, WS-53 |
| П18 | паритет времени эталон ↔ реализация: `page.clock` с фиксированным `2026-10-01T10:30:00+03:00` на обеих целях | D-45, WS-07 |
| П19 | эталон в CI: `tools/design-preview.js design 4173 --offline` вторым элементом `webServer` | WS-07 |
| П20 | схема вердикта и отчёта расширяется полями `mode` и `phase` | D-52, §7.5 |
| П21 | выборка документов читалки для визуальной сверки и MCP-проходка фреймов на 4 ширинах как отдельные evidence-ключи | §5.3, WS-11 |

---

## 1. Цель и границы

### 1.1 Что значит «точно так же, как нарисовано»

Эталон — `design/Ортус CRM.dc.html` (4537 строк: шаблон 1–2324, логика 2325–4537), `design/Документация.dc.html`, `design/Ремонт и стройка.dc.html`, `design/ortus/*.js`, `design/support.js`, `design/docs/**`. «Как нарисовано» проверяется четырьмя способами на каждой странице (`verification-protocol.md`): e2e по чек-листу отчёта на `mobile-390` и `desktop-1440`; пиксельная сверка с эталоном на 390 и 1440 с порогом `maxDiffPixelRatio: 0.01` (D-22); структурная сверка текстов `button, a, h1–h3, label, [aria-label]` (порядок и дословность, включая «ё» и U+00A0); проходка Playwright MCP с evidence. Расхождением считается всё из `verification-protocol.md` §7; «улучшения» без решения в `decisions.md` не принимаются.

Пределы точности, зафиксированные решениями: падения и невалидные дефолты прототипа исправляются (Q-30, D-27); утечки сида между организациями повторяются в фазе 1 (Q-31, D-27); невидимые добавки доступности допускаются при нулевом пиксельном следе (Q-34, D-29); визуальный канон при расхождении CRM ↔ `tokens.json` — рендер CRM (Q-32/33, D-28).

### 1.2 Два приложения

| Приложение | Эталон | Что внутри | WS |
|---|---|---|---|
| CRM `frontend/apps/web` | `Ортус CRM.dc.html` + `Ремонт и стройка.dc.html` (embedded) | оболочка (8 персонажей, 2 организации + платформа), 24 достижимые страницы (`:2861` минус `planned`), 6 видов модалок, 35 VM, 51 метод адаптера (00 §10 п.1) | WS-10…WS-32 |
| Документация `frontend/apps/docs` | `Документация.dc.html` | читалка 36 документов `DOCS` (11 §6.3), поиск, рендереры md/code/perm/api, 3 frame-страницы + «Ремонт и стройка» как есть через `support.js` с локальным React (D-16), карта следующих итераций из `roadmap.js` (D-24) | WS-11 |

### 1.3 Фазы (D-15)

| Фаза | Содержание | Выход |
|---|---|---|
| 1 | весь UI обоих приложений на TS-порте mock-адаптера (`createMockAdapter`), все 24 страницы + модалки + документация проходят 4 проверки; backend платформы идёт параллельно | все ключи §5.3 с evidence фазы 1; `npm run e2e` зелёный на 3 проектах |
| 2 | backend платформы и логистики по S0–S2 (`13-backlog`), http-адаптер, `e2e:full` на стенде compose для 11 страниц S0–S2 (`shell, modules, users, billing, tenants, fleet, pool, review, today, cars, home`) + повторная MCP-проходка `phase2/` | AC-01…AC-06, AC-10…AC-12 в CI; `mock-vs-http.spec.ts` без расхождений |
| 3 | остальные модули (forms, tasks, knowledge, calendar, spa+inventory, cash, repairs, branding/billing/platform-ops, notify/realtime, автоматизация, PWA, нагрузка/restore, CSV-импорт) по «заготовкам S3+» | `e2e:full` на всех 24 страницах без правок spec'ов |

### 1.4 «Заготовка S3+» (единое определение для WS-60…WS-72)

Страница модуля S3+ (`forms, tasks, calendar, knowledge, spa, cash, repair, files-list, notifications`) считается заготовленной в фазе 1, если: (а) её операции есть в контракте 0.2 (WS-15); (б) сгенерированный strict-server по тегу отдаёт `501 not_implemented` (`Problem.code`) и на это есть контрактный тест; (в) миграция лежит в `backend/migrations/tenant/drafts/` и не применяется; (г) MSW-хендлеры собраны из примеров контракта (WS-51); (д) `adapter-http` для её методов проверен паритетной сюитой против MSW; (е) в `e2e/<key>.spec.ts` стенд-пункты помечены `test.fixme(E2E_MODE === 'stand', 'D-15: фаза 3')`. Волна 4 заполняет (б) и (в) и снимает (е), не трогая в чужих spec ничего, кроме маркеров `fixme`.

### 1.5 Что НЕ входит

- Страница `pg.planned` / `ROADMAP` как экран CRM (D-24, Q-120); данные `roadmap.js` — в документацию.
- Standalone-режим `Ремонт и стройка.dc.html` (шапка «Альта Групп · Ремонт и стройка», воронка «Заявки», карточка «Готовность по закрытым актам»): недостижим из CRM (`showNav = !props.tab`, 06b §2, §19 п.1) — D-36; файл хостится как есть в документации.
- Тёмная тема сотрудника (Q-27), BR-01…BR-03 (Q-28), временный доступ поддержки (Q-09), резерв квоты (Q-12), поиск в шапке и URL-состояние таблиц (Q-39), антифрод фото/`legal_entity_id` (Q-93).
- UI создания организации и поле «Причина» у оператора (Q-03, Q-04): backend-only (D-48).
- `Ortus CRM.dc.html` (латиница, пустой `<x-dc>`) не хостится (Q-118).
- Keycloak в фазе 1 (D-18); в фазе 2 — compose-профиль только под тегом `@keycloak` (Q-109, D-41).

---

## 2. Эталон и его использование

### 2.1 Неприкосновенность

`design/` лежит байт-в-байт и никем не меняется (`orchestration.md` §7). Локальный превью: `node tools/design-preview.js design 4173` → `http://127.0.0.1:4173/Ортус%20CRM.dc.html`, `/Документация.dc.html`, `/Ремонт%20и%20стройка.dc.html`. Для документации копия `design/` попадает в `apps/docs/public/design/` через `tools/sync-design.js` на сборке (D-16); в копии `.dc.html` получает локальный React через `window.__resources` (11 §7.4) — исходник не трогается.

### 2.2 Офлайн-эталон (WS-07, из C WS-06)

`tools/design-preview.js --offline`: сервер на лету подставляет в ответ `.dc.html` скрипт с `window.__resources` (React/ReactDOM UMD 18.3.1 из `tools/vendor/`) и заменяет ссылки Google Fonts на `packages/tokens/fonts/fonts.css`. `design/` не копируется и не меняется. Самопроверка: `harness.spec.ts` — `#dc-root .sc-host` есть, `.sc-logic-error` нет, консоль без `[dc-runtime]`, `page.on('request')` не содержит `unpkg.com`, `fonts.googleapis.com`, `fonts.gstatic.com` (11 §12 п.18–19). В CI превью поднимается вторым элементом `webServer` в `apps/web/playwright.config.ts` и `apps/docs/playwright.config.ts`.

### 2.3 Единый рецепт снимка (D-45)

1. Viewport = ширина проекта Playwright (`mobile-390` 390×844, `desktop-1440` 1440×900); на эталоне селект «Ширина» остаётся «По окну» — тогда `s.w` окна = `W` фрейма, и `listMax/treeMax/us.listMax` (считаются по `s.w`, `:2867, 2880, 4159`, 00 §10 п.5) совпадают с реализацией, где `s.w → W` (D-27). Демо-селект ширины используется только для MCP-проходки (`verification-protocol.md` §4 п.4), не для снимков.
2. Часы: `page.clock.install({ time: '2026-10-01T10:30:00+03:00' })` до загрузки на обеих целях; прототип читает `new Date()` (`hhmm()`, приветствие `:4091`, тост «Смена принята в HH:MM…», 07 §16 п.17) — текст совпадает. Реализация в mock-режиме берёт время из `Date` (инжектируемый `clock` по умолчанию = `Date.now`).
3. Локаль: проекты Playwright — `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'`; U+00A0 в суммах на обеих целях.
4. Персонаж — по дословной подписи `<select>` «Персонаж» (`:32–47`; 00 E4): «Оператор платформы», «Владелец · Дарья Зимина», «Логист · Марина Котова», «Водитель · Илья Васильев», «Массажист · Анна Морозова», «Прораб · Алексей Соколов», «Владелец · Ирина Белова», «Массажист · Анна Морозова» (optgroup «SPA «Лотос»»). В реализации демо-панель та же (D-44), в http-сборке персонаж задаётся входом dev-провайдера.
5. Переход на страницу — по дословной подписи пункта меню (01 §8.3); панель `[aria-label="Панель демонстрации"]` скрывается перед снимком; снимается область приложения (`#dc-root` на эталоне, `#app` в реализации), не весь документ.
6. Baseline per-platform (`snapshotPathTemplate` с `{platform}`), канон — Linux-CI (D-32); структурная сверка `labels` обязательна на обеих платформах.

### 2.4 Каталог «Как воспроизвести» (рецепты эталона)

Рецепт — именованная последовательность UI-шагов, которую фикстура `reference` (WS-07) выполняет **одинаково** на эталоне и в реализации (`e2e/recipes/<name>.ts`, владелец — WS, указанный в таблице; базовые — WS-07). Пресеты адаптера (`applyPreset`, WS-06) допустимы только в e2e-тестах страницы как предусловие, но не в `visual`/`labels` spec'ах (D-26). У эталона пресетов нет (03 §16 п.3), поэтому каждому пресету соответствует рецепт.

| Рецепт / пресет | UI-шаги (подписи дословно, источник) | Страницы | Владелец |
|---|---|---|---|
| `base(persona, page)` | выбрать персонажа, перейти по пункту меню, скрыть панель | все | WS-07 |
| `logistics-ready` | «Владелец · Дарья Зимина» → «Модули и место» → карточка «Логистика» → «Подключить» → диалог «Подключить «Логистика»?» → «Подключить» (01 §6 шаг 1, 02 §5.5) → «Пользователи и роли» → «Люди» → у «Марина Котова» «Назначить роль» → диалог «Назначить роль» (роль «Менеджер логистики», область по умолчанию) → «Назначить» (01 §6 шаг 2, 02 §6.9) | fleet, pool, review, home(manager), calendar/data/files(manager), forms(manager) | WS-07 |
| `driver-booked` | `logistics-ready` → «Водитель · Илья Васильев» → «Сегодня» → бронь совместимой машины «ГАЗель Next А 412 МР 77» (03 §8.3, 01 §6 шаг 4) | today, cars | WS-23 |
| `driver-on-route` | `driver-booked` → блок осмотра: 5 фото демо-кнопками (03 §10, `:743`), пробег, топливо, чек-лист → «Выехать на маршрут» (01 §6 шаг 5, 03 §14 #25–27) | today, home(«Рейсы сегодня»), fleet | WS-23 |
| `defect-review` | `driver-booked` → осмотр с критическим дефектом (03 §8.5 `saveDefect`) → «Выехать на маршрут» → «Выезд заблокирован» | today, review, fleet | WS-23 |
| `shift-submitted` | `driver-on-route` → расход (01 §6 шаг 6) → «Завершить рейс» → диалог «Завершить рейс Р-208?» → сдача: пробег ≥ начального, фото → отправка (01 §6 шаг 7, 03 §14 #30–36) | review, today, home | WS-23 |
| `shift-accepted` | `shift-submitted` → «Логист · Марина Котова» → «Приёмка смен» → карточка смены → «Принять смену» → диалог «Принять смену …?» → подтвердить (01 §6 шаг 8, 03 §7.5) | review, cash («Предложения из принятых смен»), today («Смена принята») | WS-22 |
| `trial-ended` | владелец → «Модули и место» → «Демо: завершить пробный период» → диалог → подтвердить → баннер «Пробный период завершён.» (02 §5.4, 08 J8) | modules, billing, users, home | WS-20 |
| `seats-full` | владелец → «Пользователи и роли» → «Пригласить участника» → имя/почта → «Пригласить» (9 → 10; 02 §12 п.11) | users, billing, modal-invite | WS-20 |
| `storage-full` | владелец → «Модули и место» → «Изменить лимит» → 25 ГБ (меньше занятого 46,2) → флажок-подтверждение → применить → баннер «Место организации заполнено.» (02 §5.4, 08 J9) | modules, files, today(фото) | WS-20 |
| `repair-on` | владелец → «Модули и место» → карточка «Ремонт и стройка» → «Подключить» → подтвердить (06 §15 п.5) | repair, repair-tabs, home | WS-31 |
| `empty-review` | `logistics-ready` → «Логист · Марина Котова» → «Приёмка смен» → «Нет смен на проверке» | review | WS-22 |
| `empty-requests` | «Оператор платформы» → «Заявки на тариф» → решить SR-12 (одобрить/отклонить с заметкой) → список пуст (04 §5.3) | requests | WS-27 |
| `offline` / `conflict-next` / `fail-upload` | флажки «Нет связи» / «Конфликт брони» / «Сбой загрузки фото» в панели демо-режима (01 §5), затем действие страницы | today, cars, modules, cash, spa, fleet | WS-07 |
| `lotos(persona)` | «Владелец · Ирина Белова» или «Массажист · Анна Морозова» (SPA «Лотос») → страница | home, modules, users, billing, branding, forms, tasks, calendar, knowledge, data, files, spa, cash, repair(гейт) | WS-07 |
| `kb-conflict` | **на эталоне невоспроизводим** (нужна вторая сессия, 06 §14 Q1) — только пресет в реализации; снимок тоста конфликта — запись allowlist `no-reference` со ссылкой на D-26 | knowledge | WS-29 |
| `repair-tabs-*` | `repair-on` → «Объекты» → вкладка по подписи (06b §18 B0); для «График»: выбор этапа «Плитка в санузле», «Продлить на рабочий день» у «Штукатурка стен», «Ближайшие 3 недели» на 390 (06b §20 п.6, п.9) | repair-tabs | WS-32 |

Правило: если страница требует состояния, которого нет в таблице, владелец WS добавляет рецепт в свой файл и строку в раздел «Как воспроизвести» своего отчёта анализа (`verification-protocol.md` §3, последний абзац) — через интегратора.

---

## 3. Архитектура и стек

### 3.1 Стек (14-engineering.md «Стек», decisions D-13…D-24)

Backend: Go (последняя стабильная, D-38), `net/http` + chi, `oapi-codegen` strict server по тегам (D-47), `pgx/v5` + `sqlc`, `goose` + контроллер миграций по тенантам (D-06), outbox-worker, MinIO, Keycloak только в фазе 2 (D-18), PostgreSQL 17 (D-38). Frontend: React 19 + TypeScript + Vite + TanStack Router (file-based) / Query (D-14), собственный `@ortus/ui` на React Aria Components и токенах (D-13), `openapi-typescript` + `openapi-fetch`, MSW из примеров контракта для http-адаптера, Workbox в фазе 3. Тесты: Vitest + Testing Library + axe, Playwright (3 проекта + 4 проекта читалки), testcontainers-go, Schemathesis, k6. CI: GitHub Actions (D-20). Пакеты: pnpm 9, Node 22 LTS (D-23, D-38). Шрифты локальные (D-21). Порог визуальной сверки 1 % (D-22).

### 3.2 Слои frontend (как ложится семантика прототипа)

```text
Ортус CRM.dc.html (шаблон)   →  apps/web/src/routes/<group>/**   (разметка на @ortus/ui, VM — чистые функции в routes/<group>/vm/)
*VM (:2826–4533)              →  routes/<group>/vm/*.ts  (db, state, clock) → vm ; табличные unit-тесты по «Вычислениям» отчётов
ortus/models.js               →  packages/domain/models/*.ts   (25 функций + 22 справочника, 1:1, D-19)
ortus/mock-data.js, extra     →  packages/domain/seed/*.ts + seed/snapshot.json (ID обеих организаций и платформы)
ortus/api.js                  →  packages/adapter/src/mock/   (createMockAdapter — исполняемая спецификация guards/view()/opId)
                              →  packages/adapter/src/http/   (openapi-fetch; 1 метод = 1–3 операции, §4.10)
                              →  packages/adapter/src/msw/    (сценарный сервер: OpenAPI-фасад над mock-адаптером; источник примеров, D-43)
AdapterPort (07 §4)           →  packages/domain/adapter.port.ts ; переключатель VITE_ADAPTER=mock|http (apps/web/src/app/adapter.ts)
```

Компоненты не вызывают адаптер напрямую — только хуки `use*Query`/`useRun` в `apps/web` (14-engineering «Соглашения кода»); `api-client` используется только внутри `packages/adapter/src/http`.

### 3.3 Дерево репозитория (до 3 уровней) с владельцами-WS

Владелец каталога — единственный WS, пишущий в него в своей волне (`orchestration.md` §1). Общие точки правит только интегратор после закрытия владельца.

```text
ortus/  (D:\work\test26042026_Kirill_3.0)
├─ .github/workflows/{ci.yml,e2e-full.yml}        WS-01 (ci), WS-53 (e2e-full)
├─ .claude/settings.json                            WS-01 (PostToolUse, Stop → tools/verify-pages.js)
├─ .husky/, .lintstagedrc, .editorconfig, .gitattributes, eslint/prettier конфиги   WS-01
├─ .mcp.json                                        WS-07
├─ CLAUDE.md, CODEOWNERS, Makefile, package.json, pnpm-workspace.yaml, README.md    WS-01
├─ api/
│  ├─ openapi/ortus.yaml (+ paths/<tag>.yaml, components/, examples/<operationId>/*.json)   WS-03 → WS-15 → интегратор
│  ├─ openapi/screens.yaml   (экран → operationId, фикстура теста существования)             WS-03 (core), WS-15 (delta)
│  ├─ permissions.yaml, errors.yaml, spectral.yaml                                            WS-03
│  └─ dist/<tag>.yaml        (сплит по тегам для кодогена, генерируется)                      WS-03
├─ backend/                                         go.mod — WS-01
│  ├─ cmd/api/               (композитный роутер по тегам, router.go — интегратор)            WS-40
│  ├─ cmd/{migrate}/                                 WS-41
│  ├─ cmd/provisioner/                               WS-56
│  ├─ cmd/worker/                                    WS-45
│  ├─ cmd/seed/                                      WS-52
│  ├─ internal/api/<tag>/     (oapi-codegen по тегу, не редактируется; notimpl 501)          WS-03 (генерация)
│  ├─ internal/platform/{httpx,problem,requestid,session,tenantctx,idem,clock,pipeline}/   WS-40
│  ├─ internal/platform/session/oidc/                WS-54
│  ├─ internal/platform/authz/, scopeddb/            WS-42 (CODEOWNERS, 2 ревьюера)
│  ├─ internal/platform/{storage,events,audit}/      WS-45
│  ├─ internal/platform/notify/                      WS-70
│  ├─ internal/control/{tenants,subscriptions,audit}/   WS-43
│  ├─ internal/control/provisioning/                 WS-56
│  ├─ internal/control/{pricebook,requests,accounts,operators,usage,branding}/   WS-67
│  ├─ internal/modules/{access,org,people}/          WS-44
│  ├─ internal/modules/{modulesreg,files}/           WS-45
│  ├─ internal/modules/fleet/{vehicles,routes,reservations}/, modules/sched/   WS-46
│  ├─ internal/modules/fleet/{inspections,trips}/    WS-47
│  ├─ internal/modules/fleet/{review,expenses}/, modules/finance/   WS-48 (2 ревьюера)
│  ├─ internal/modules/fleet/pool/                   WS-49
│  ├─ internal/modules/data/                         WS-50
│  ├─ internal/modules/{forms,tasks,knowledge,sched-ext,spa,inventory,cash,repairs}/   WS-60…66
│  ├─ internal/modules/importer/                     WS-72
│  ├─ internal/domain/{fleetrules,schedrules}/       WS-46, WS-63 (Go-копии правил по примерам 07 §8)
│  ├─ migrations/{control,tenant}/, tenant/drafts/   WS-41 (0001–0002 + 0003 разрывов); далее по диапазонам §4.11
│  └─ test/{harness.go,isolation/<module>_test.go,concurrency/,contract/,load/}   WS-07 (харнесс); фикстуры — WS-42; файл на модуль — его WS
├─ deploy/compose/{docker-compose.yml,.env.example,profiles/e2e,keycloak/}   WS-02; profiles/e2e — WS-53; keycloak — WS-54
├─ design/                                           никто (эталон)
├─ docs/
│  ├─ adr/                                            интегратор (ADR-0001 URL-схема — WS-00)
│  └─ plan/{ws,reports,evidence,critique,status.md}/   планировщик → исполнители (свой файл/строка) → интегратор
├─ frontend/
│  ├─ apps/web/
│  │  ├─ index.html, vite.config.ts, src/app/        WS-10 (router, providers, adapter switch, clock)
│  │  ├─ src/shell/, src/demo/                       WS-10 (AppShell, шапка, nav, sheet, баннеры, gate, тост, ModalHost, confirm, демо-панель, гид, DemoOnly)
│  │  ├─ src/modals/people/                          WS-14
│  │  ├─ src/routes/company/{modules,users,billing}/   WS-20
│  │  ├─ src/routes/branding/                        WS-21
│  │  ├─ src/routes/logistics/manager/{fleet,pool,review}/   WS-22
│  │  ├─ src/routes/logistics/driver/{today,cars,outbox}/    WS-23
│  │  ├─ src/routes/home/                            WS-24
│  │  ├─ src/routes/forms/                           WS-25
│  │  ├─ src/routes/tasks/                           WS-26
│  │  ├─ src/routes/platform/orgs/{tenants,usage,requests}/   WS-27
│  │  ├─ src/routes/platform/{accounts,plans}/       WS-28
│  │  ├─ src/routes/core/{calendar,knowledge,data,files}/   WS-29
│  │  ├─ src/routes/spa-cash/{spa,cash}/             WS-30
│  │  ├─ src/routes/repair/{index,overview,works}/   WS-31
│  │  ├─ src/routes/repair/child/{schedule-lib,gantt,panels,measure-estimate,chain,integration}/   WS-32
│  │  ├─ src/pwa/                                    WS-68
│  │  ├─ src/routeTree.gen.ts                        генерируется, в .gitignore
│  │  ├─ e2e/{fixtures,recipes/_base,visual/_helpers,smoke}/, playwright.config.ts   WS-07
│  │  ├─ e2e/<key>.spec.ts, e2e/recipes/<key>.ts, e2e/visual/<key>.{visual,labels}.spec.ts, e2e/visual/allowlist/<key>.md   владелец ключа (§5.3)
│  │  ├─ e2e/journeys/, e2e/guide-path.spec.ts       WS-55
│  │  ├─ e2e/_stand/, e2e/fixtures/phase2/           WS-53
│  │  └─ mocks/                                      WS-51 (MSW из примеров; browser.ts, handlers glob)
│  ├─ apps/docs/                                     WS-11 (читалка; public/design/ — копия через tools/sync-design.js; playwright.config.ts — WS-07)
│  └─ packages/
│     ├─ tokens/{tokens.json→tokens.css/ts, fonts/}  WS-04
│     ├─ ui/src/{index.ts,types/}, ui/.storybook/    WS-04 (контракт пропсов, стабы `data-stub`, экспорт-лист заморожен)
│     ├─ ui/src/core/                                WS-12
│     ├─ ui/src/domain/                              WS-13
│     ├─ domain/{types.ts,models/,seed/,scenarios/,clock.ts,adapter.port.ts,permissions/renames.ts,errors/map.ts}   WS-05
│     ├─ adapter/src/mock/, adapter/test/conformance/   WS-06
│     ├─ adapter/src/{http,msw}/                     WS-51
│     ├─ api-client/                                 WS-03 (генерируется)
│     ├─ e2e-kit/  (reference, labels, axe, recipes-runner, clock)   WS-07
│     └─ texts/src/{shell,gate,banners,toast,errors,company,branding,logistics-manager,logistics-driver,home,forms,tasks,platform,core,spa-cash,repair,repair-child,docs,screen-labels}.ts   WS-08 создаёт; далее каждый файл — владелец страницы (только добавление ключей)
└─ tools/
   ├─ design-preview.js (есть; --offline — WS-07), design-strip-injected.js, design-unpack-bundle.js   есть
   ├─ verify-pages.js, e2e-skeleton.js, labels-dump.js, check-icu.js, allowlist-lint.js, vendor/react*.js   WS-07 (check-icu, allowlist-lint — WS-01)
   ├─ gen/{split-by-tag.js,gen-examples.js}         WS-03, WS-51
   └─ sync-design.js                                 WS-11
```

Точки потенциальных конфликтов и как сняты: `packages/ui/src/index.ts` — создан WS-04, в волне 1 не меняется (WS-12/13 экспортируют через `core/index.ts`, `domain/index.ts`, оба реэкспортированы заранее); `packages/texts/src/index.ts` — WS-08, файлы `logistics-manager.ts`/`logistics-driver.ts` разделены (ошибка A: один `logistics.ts` у WS-22 и WS-23); `apps/web/src/app/adapter.ts` — WS-10, строка http добавляется интегратором на барьере 2→3; `e2e/visual/allowlist/<key>.md` — файл на ключ (D-50); `api/openapi/*` — один владелец на волну (WS-03 → WS-15 → интегратор), после волны 0 только аддитивно (D-47); `backend/internal/api/<tag>/` — перегенерация только интегратором на барьере; `backend/cmd/api/router.go` — интегратор; `backend/go.mod` — новые зависимости через интегратора (12 §5 п.28); `backend/test/isolation/<module>_test.go` — файл на модуль; `docs/plan/status.md` — своя строка; `routeTree.gen.ts` — не в git.


## 4. Контракты волны 0

Контракт выпускается до любого зависимого WS (`orchestration.md` §1). Все последующие WS пишут тесты против этих контрактов, не ожидая реализацию соседей.

### 4.1 OpenAPI 0.2 (WS-03 core, WS-15 delta)

База — `design/docs/v0.1/ortus-openapi-v0.1.yaml` (76 путей / 118 операций / 199 схем, 10 §12 п.1). Файл разбивается по тегам: `api/openapi/ortus.yaml` (корень) + `paths/<tag>.yaml` + `components/`; `tools/gen/split-by-tag.js` → `api/dist/<tag>.yaml` → `oapi-codegen` strict server **по тегу** в `backend/internal/api/<tag>/` (D-47). Композитный роутер `backend/cmd/api/router.go` монтирует хендлер каждого тега; тег без реализации монтирует `notimpl` (501 `not_implemented`). TS-клиент `@ortus/api-client` — из полного бандла (`openapi-typescript` + `openapi-fetch`).

**Core (WS-03, волна 0)** — всё из 0.1 плюс:

| Тег | Добавляемые операции (из B WS-03; 10 §7.4) | Закрывает |
|---|---|---|
| auth | `startLogin`, `authCallback`, `logout`, `getCsrf`, `acceptInvitation`, `devLogin` (dev-only, D-18) | G-01 |
| me | `getMyContext` (+ `tenants[]`, `lastTenantId` — S1-07), `selectTenant`, `listMyEvents` (лента `db.events`, 10 §12 п.28) | G-19 (частично) |
| platform | `getPlatformUsage`, `listSubscriptionRequests`, `decideSubscriptionRequest`, `listPriceBookVersions`, `publishPriceBookVersion`, `cancelScheduledPriceBookVersion`, `lockPlatformAccount`, `resetPlatformAccountMfa`, `listPlatformOperators`, `inviteOperator`, `updateOperator`, `listPlatformAudit` | G-09, G-22 |
| billing | `createSeatRequest`, `cancelSeatRequest`, `getPriceBookCurrent` | Q-16 (модель `17`) |
| access | `revokeInvitation`, `listGroups`, `explainAccess` | G-02 |
| files | `listFiles` | G-10 |
| branding | `getBranding`, `putBranding`, `uploadBrandingFile`, `getPublicBranding` | G-18 |
| fleet | `assignTripVehicle`, `decideInspectionDefect` (`POST /fleet/inspections/{id}/defect-decision`, Q-49), `finishTripRoute` (`returning`), `TripReview.decision += rework` + `steps[]`, `Trip.status` по `TRIP_STATE` прототипа (9 состояний, Q-45) | G-11 |
| общее | `Problem.code` как enum (36 кодов `12-errors` + `seats_exhausted`, `request_pending`, `tier_below_usage`, `upload_failed`, `not_implemented`; D-34), `Tenant.status` по D-35, словарь `x-scope` (27 значений, Q-96), `x-adapter-method` на операциях (§4.10), `x-examples` ≥ 2 на операцию (`ok`, `empty` или код ошибки) | G-20, G-22 |

**Delta (WS-15, волна 2, аддитивно)**: tasks `listTaskComments`, `addTaskComment`, `Task.checklist[]`, `toggleTaskChecklistItem`, фильтр `assignee=me` (G-07); forms `listFormAutomationLog` (G-05); knowledge `listKnowledgeSpaces` (G-06); calendar `listCalendarResources`; spa `listSpaIssues`, `resolveSpaIssue` (G-12); repairs `acceptWorkLog`, `returnWorkLog`, `getRepairProjectOverview`, материалы в `WorkLogLine` (G-16); notify `GET /me/notifications` (G-19); importer `importMembersCsv`, `importVehiclesCsv` с `preview` (S1-10, D-48); каталог прав `spa.*`, `inventory.*`, `cash.*`, `branding.*`, `forms.responses.assign`, `cash.refund`, `cash.adjust`, `repairs.work_logs.review`, `repairs.finance.read` (G-21, DP-03/04).

**Фикстура `api/openapi/screens.yaml`** — таблица «ключ страницы → operationId[]» из 10 §7.3 (core-часть в WS-03, delta — WS-15); тест `screens.test.ts`: каждая операция существует в бандле, каждая страница §5.3 присутствует.

**Примеры (D-43)**: `api/openapi/examples/<operationId>/{ok,empty,<Problem.code>}.json`. В волне 0 — рукописные (WS-03); с волны 2 `make examples` (WS-51, `tools/gen/gen-examples.js`) переснимает `ok`/`empty` с сценарного сервера на сиде; CI-job `examples-fresh` падает при устаревании; каждый пример проходит ajv-валидацию по схеме ответа.

Правила после волны 0 (D-47): контракт меняется только аддитивно; правки вносит владелец волны (WS-15) или интегратор; `make gen` и перегенерация `internal/api/<tag>/` — интегратором на барьере волны; CI-job `contract`: Spectral + полный валидатор 3.1 + «каждый `x-permissions` ∈ каталог» + «каждый код `12-errors` ∈ enum» + drift (`git diff --exit-code` после `make gen`, 12 §6 п.17).

### 4.2 Права и ошибки (WS-03, WS-05)

- `api/permissions.yaml` = `design/docs/11-permissions.yaml` (77 ключей) + расширения G-21 + полный `prototype_renames` (10 имеющихся + 13 ключей прототипа без соответствия, 09 §4.4, Q-21). Константы `PERM.*` генерируются в Go и TS.
- Фаза 1 использует ключи прототипа (`INDUSTRY.*.perms`, `CORE.*.perms`, редактор ролей «как нарисован»); таблица переименований — `packages/domain/permissions/renames.ts` (WS-05); backend фазы 2 работает на каноне.
- `api/errors.yaml` → enum `Problem.code`; `packages/domain/errors/map.ts` — коды мока (18, 07 §6) ↔ канон (36 + 5, Q-82): UI показывает тексты прототипа по его кодам, http-адаптер маппит канон → код прототипа. 404 для чужих объектов в API; «Нет доступа к объекту» — локальный результат «Проверки доступа» (Q-83).

### 4.3 Токены (WS-04)

`packages/tokens/tokens.json` (из `design/docs/design-system/tokens.json`, 79 строк: 16 базовых цветов + 5 тонов × 3 + типографика + отступы/радиусы/тени/размеры/брейкпоинты/движение — 11 §12 п.1) → генератор `tokens.css` (`--ox-*`) + `tokens.ts` (`breakpoints {mobile: 640, sidebar: 1080}`, `sizes {control: 44, header: 58}`). Добавочные токены прототипа с пометкой `prototype` (D-28): `--ox-accent-tint`, границы `LINE` (`#BFD9C8/#C9D8E8/#EBD7A8/#F0C9C3/#DCE2D9`, `:2330`), высоты кнопок 36/40, радиусы 14/16, размеры шрифта 11/15/17/18/19/21/26/30 (Q-33). `fonts.css`: Golos Text 400–700, IBM Plex Mono 400/500, Material Symbols Rounded variable (`opsz,wght,FILL,GRAD`), OFL, локально (D-21). `tokens.css` содержит `prefers-reduced-motion` и `:focus-visible` (11 §12 п.17) и подключается глобально в `apps/web` и `apps/docs` (тест в WS-10/WS-11: `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent')` непуст). Тест: снапшот генератора (каждая запись `tokens.json` → переменная); `document.fonts.check` для трёх семейств без сети.

### 4.4 Компоненты `@ortus/ui` (WS-04 — контракт и стабы; WS-12 core; WS-13 domain)

Пропсы 1:1 с `design/docs/design-system/components.md:15–44` (каталог 11 §4). Экспорт-лист `packages/ui/src/index.ts` заморожен на волну 1; стабы рендерят `children` с `data-stub` и компилируются, но не реализуют поведение (красный экранный тест падает по тексту/роли, не по импорту).

| Компонент | Пропсы (контракт) | A11y / особенности прототипа | WS |
|---|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger`, `size: md 44\|lg 48\|compact 32`, `icon`, `loading`, `disabled`, `disabledReason` | `disabledReason` в `aria-describedby`; `loading` → `aria-busy`, ширина сохраняется; в CRM также 40 px (карточки модулей) и 36 px (баннер) — D-28 | WS-12 |
| `IconButton` | `icon`, `aria-label` (обязателен), `badge` | 40×40, бейдж 17 px | WS-12 |
| `Field` + `TextInput`/`NumberInput`/`MoneyInput`/`DateInput`/`Select`/`Textarea` | `label`, `hint`, `error`, `required`, `readOnly`, `disabled`; `MoneyInput` хранит `amountMinor` | `<label for>`, ошибка в `aria-describedby`, `aria-invalid`; поля 44 px, мобильные 48 px, одометр `tabular-nums` | WS-12 |
| `Checkbox` / `Switch` / `Radio` | `checked`, `indeterminate`, `disabled`, `onChange` | строка ≥ 44 px; switch 44×26 (CRM) и 40×22 (витрина) — обе метрики (02 §12 п.4) | WS-12 |
| `Status` | `tone: ok\|info\|warn\|danger\|neutral`, `icon`, `children` | текст обязателен; хелпер `ch()` прототипа | WS-12 |
| `Banner` | `tone`, `title`, `action`, `role` | 5 текстов `bannersVM` (01 §11); `role="alert"` только danger | WS-12 |
| `AccessGate` | `reason: module_off\|module_readonly\|no_permission\|no_scope`, `moduleName`, `verb`, `persona`, `action` | 4 текста 01 §12 дословно | WS-12 |
| `Card` | `selected`, `disabled`, `disabledReason`, `onClick` | одна ссылка/кнопка внутри | WS-12 |
| `Dialog` / `ConfirmDialog` / `Sheet` | `title`, `consequences[]`, `ack`, `confirmLabel`, `tone`, `busy` | `aria-modal`, `#dlg-title`, Esc и backdrop закрывают; `max-width` 560/620; на < 640 — лист `16px 16px 0 0`; фокус-ловушка по D-29 | WS-12 |
| `Toast` | `tone`, `text`, `action` | 4200 мс, `role` status/alert по тону, `bottom` 20/76 px | WS-12 |
| `EmptyState` / `Skeleton` | `icon`, `title`, `text` / `lines` | скелетон `role="status" aria-label="Загрузка"` | WS-12 |
| `Tabs` | `items(id,label,badge)`, `value`, `onChange` | `role=tablist`, `aria-selected`; счётчик neutral (как в CRM) | WS-12 |
| `Meter`, `Chip/Pill` | `value`, `max`, `label` / `tone`, `icon` | `role=meter` «Занятое место» | WS-12 |
| `SyncState` | `state: local\|queued\|uploading\|failed\|confirmed`, `progress`, `onRetry` | подписи `photoVM` (03 §10.1), `role=status`/`alert`, `aria-valuenow` | WS-13 |
| `DataTable` | `columns`, `rows`, `sort`, `filter`, `onRow`, `mobile` | скелетон/пусто/ошибка; `<th scope>`; на 390 — горизонтальный скролл как в CRM (`mobile="cards"` не используется, Q-41) | WS-13 |
| `CheckList`, `LoadBar` | `items[{label,value,ok}]` / `legs[{n,pct}]` | > 100 % — danger текстом | WS-13 |
| `PhotoSlot` | `role`, `state`, `progress`, `onCapture`, `onRetry` | 5 состояний; `<input type=file capture=environment>`; `aria-label` «Спереди: Не снято. …» (`:3390`) | WS-13 |
| `Stepper` | `steps[]`, `current` | `aria-current="step"` | WS-13 |
| `ConflictNotice` | `text`, `onRefresh` | `role=alert`, «Обновить список» первым | WS-13 |
| `ReadinessBar`, `DecisionQueue`, `ObjectHeader` | `done`, `pending`, `plan` / `items[{tone,text,meta,action}]`, `max=8` / `title`, `chips[]`, `tabs` | проценты текстом; порядок danger→warn→info→neutral, «показано 8 из N», «Решений не требуется» | WS-13 |
| `AppShell`, `Nav`, `ScopeSelect`, `RoleEditor` | по `components.md:37–39` | `AppShell` — в `apps/web/src/shell` (WS-10), пропсы в контракте WS-04; `RoleEditor` — WS-13 | WS-10/WS-13 |

### 4.5 Интерфейс адаптера `AdapterPort` (WS-05; реализации WS-06 mock, WS-51 http)

`packages/domain/adapter.port.ts`: 51 метод, вызываемый из UI (00 §3.4; `tenantIds`/`defaultBranding` не включаются — Q-88). Сигнатуры и семантика — 07 §4.1–4.8; ответ команды — `{data, db}`; ошибки — `ApiError{code, message, status?, violations?, requestId?, extra?}`; флаги `online/conflictNext/failUploadNext`; `applyPreset(name)` и `scenario(name)` — только у mock.

| Группа | Методы |
|---|---|
| служебные | `setActor(memberId, tenantId)`, `load(ms)`, `setFlag(k, v)`, `kind`, `flags` |
| платформа | `extendTrial`, `setTenantQuota`, `setTenantStatus`, `decideSeatRequest`, `publishPriceBook`, `cancelScheduledPriceBook`, `setAccountLock`, `resetMfa`, `inviteOperator`, `setOperatorRole`, `setOperatorStatus` |
| организация | `saveBranding`, `setModule`, `setStorageQuota` |
| люди/роли/места | `invite`, `revokeInvite`, `requestSeats`, `cancelSeatRequest`, `assign`, `unassign`, `createRole`, `saveRole` |
| логистика | `reserve`, `cancelReservation`, `assignVehicle`, `submitDeparture`, `decideDefect`, `addExpense`, `finishRoute`, `submitReturn`, `reviewTrip`, `resetTrip`, `requestDriver`, `decideRequest` |
| core-модули | `publishForm`, `moveTask`, `toggleTaskCheck`, `commentTask`, `createTask`, `moveBooking`, `saveKbPage` |
| SPA/касса/ремонт | `completeAppointment`, `resolveIssue`, `addCashOp`, `reverseCashOp`, `addWorkLog`, `acceptWorkLog` |
| файлы | `upload({name, bytes}, onProgress)` |

Conformance-suite (WS-06, `packages/adapter/test/conformance/`): 62 кейса 07 §14.1–14.8 как тесты адаптера (не DOM), параметризованы фабрикой; по C WS-05 — каждый из 51 метода и каждый код ошибки имеют ≥ 1 кейс; сюита гоняется против `createMockAdapter` (волна 0), против `createHttpAdapter + MSW(сценарный сервер)` (WS-51, волна 2) и против стенда с тегом `@stand` (WS-53).

### 4.6 Домен, сид, часы, сценарии (WS-05)

- `packages/domain/models/*.ts` — порт `ortus/models.js` 1:1: 25 функций (`compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`, `bookingConflicts`, `freeSlots`, `busySpan`, `can`, `canEarnings`, `grants`, `moduleOn`, `rolePermKeys`, `scopeLabel`, `unitLabel`, `firmsOf`, `plural`, `rub`, `num`, `emailOk`, `initials`, `brandVars`, `contrastW`, `fixAccent`, `calc`/`tierList`/`termLabel`, `validateDraft`, `wfOf`) и 22 справочника (`TRIP_STATE`, `VEHICLE_STATE`, `WORKFLOWS`, `TASK_FLOW`, `INDUSTRY`, `CORE`, `ALL_MODULES`, `VERBS`, `REASON`, `MEMBER_STATE`, `TENANT_STATE`, `BR_TERMS`, `BR_LOCK`, …) с ≥ 60 примерами 07 §8 как табличными тестами.
- `seed/{platform,alta,lotos,extra}.ts` — порт `mock-data.js` + `extra-data.js`, детерминированный `fillAccounts` (Q-98), `seq` 100/500; `seed/snapshot.json` — отсортированный список ID всех сущностей (эталон Go-сида, D-19; UUID v5 — D-30). Сид фазы 1 повторяет прототип, включая утечки «Альты» в «Лотос» (Q-31, D-27); падения исправляются (Q-30): `formsVM` при `forms: []` → пустой список без текста (Q-60), дефолты `assign`/`invite` для «Лотоса» — первая фирма/роль организации (Q-23), `confirmTrialEnd` — id текущей организации, `onRevoke` закрывает диалог, `brDraft/brTab/brIconOpen` в `INITIAL()`.
- `scenarios/*.ts` — оверлеи `scenario('empty-review' | 'empty-requests' | 'empty-calendar' | 'kb-conflict' | 'no-trip')` (04 Q13, 06 Q11, Q54), выбираются `VITE_SEED_SCENARIO` или `applyPreset`.
- `clock.ts` — инжектируемое «сегодня» (по умолчанию `Date.now`; в тестах `2026-10-01T10:30:00+03:00`); имена/даты из актора и часов (Q-61, Q-66), на сиде совпадают с прототипом.
- `nav/*` — `navForBase(db, persona, memberId)`, `brandNav`, `gateVM`, `bannersVM` чистые (01 §22 п.4–5).

### 4.7 Соглашения маршрутов: URL ↔ `pg.*` (D-25, ADR-0001 — WS-00)

Один origin (`http://localhost:5173`, Q-101). Организация — в пути; состояние страниц прототипа (`taskSel`, `formSel/formTab/respSel/verSel`, `revSel`, `fleetTrip`, `usersTab`, `rpTab`) — в search-параметрах (Q-39: URL не меняет снимок).

| `pg.*` / контур | Маршрут | Search-параметры |
|---|---|---|
| `home` | `/t/:tenantId/home` | — |
| `modules`, `users`, `billing`, `branding` | `/t/:tenantId/modules` … `/branding` | `users?tab=people\|groups\|roles\|check&role=` |
| `fleet`, `pool`, `review` | `/t/:tenantId/fleet`, `/pool`, `/review` | `fleet?trip=&pick=1`, `review?trip=` |
| `today`, `cars` | `/t/:tenantId/today`, `/cars` | `cars?filter=all\|fit\|free` |
| `forms`, `tasks` | `/t/:tenantId/forms`, `/tasks` | `forms?form=&tab=build\|versions\|responses&resp=&ver=`, `tasks?view=board\|list&task=&mine=1` |
| `calendar`, `knowledge`, `data`, `files` | `/t/:tenantId/calendar` … | `calendar?booking=`, `knowledge?page=`, `data?set=` |
| `spa`, `cash` | `/t/:tenantId/spa`, `/cash` | — |
| `repair` (+ вкладки) | `/t/:tenantId/repair` | `?tab=overview\|works\|measure\|estimate\|schedule\|docs\|supply\|finance\|pay\|subs\|client` |
| оператор `tenants`, `usage`, `requests`, `accounts`, `plans` | `/platform/tenants` … `/platform/plans` | `accounts?q=&filter=&org=`, `plans?draft=1` |
| вход (http) | `/auth/login`, `/auth/callback`, `/auth/dev` | — |
| `planned` | не реализуется (D-24) | — |

Стартовая страница по персонажу — `DEFAULT_PAGE` (01 §8.1); в mock-режиме персонаж через демо-панель и `?persona=` (D-44); редирект `/` → `/t/<lastTenantId>/<DEFAULT_PAGE>` или `/platform/tenants`. Vite proxy `/api` → `127.0.0.1:8080`; cookie `ortus_sid` на origin.

### 4.8 Соглашения селекторов, ключей и evidence

- Селекторы e2e: `getByRole`/`getByLabel`/`getByText` с дословными подписями из отчётов (`tdd-protocol.md` §3); `data-testid` — только без доступного имени. Суммы сравниваются с `\s` или нормализацией U+00A0.
- Ключи страниц = имена spec'ов = папки evidence = ключи `args.ws.pages` (§5.3): 24 ключа `pg.*`, `repair-tabs`, `shell`, `modal-confirm`, `modal-sheet`, `modal-assign`, `modal-invite`, `modal-createRole`, `modal-request`, `docs-start`, `docs-search`, `docs-api`, `docs-permissions`, `docs-frames`, `docs-layout`.
- `data-screen-label` (D-37): 6 значений прототипа дословно (00 §3.6) + схема «<Роль> · <подпись меню>» для остальных секций (`tenants` → «Оператор · организации»); список — `packages/texts/src/screen-labels.ts`; атрибут не читается `collectLabels()` (читает только `aria-label`), поэтому в структурную сверку не попадает.
- Невидимые добавки a11y (D-29): skip-link «К содержимому», sentinel-элементы фокус-ловушки, landmarks — несут `data-a11y-extra="D-29"`; `collectLabels()` исключает такие элементы; они должны иметь нулевой пиксельный след (вне потока/визуально скрыты).
- Allowlist (D-50): `apps/web/e2e/visual/allowlist/<key>.md`, одна запись — строка `- kind: pixel|label|order|state · target: <селектор или текст> · mode: mock|stand|both · reason: <текст> · decision: D-NN|Q-NN · owner: WS-NN`; `tools/allowlist-lint.js` (CI) падает на записи без `decision`; интегратор на барьере волны публикует рост allowlist в `critique/wave-N.md`; записи `kind: pixel` без D-ID не допускаются; `no-reference` — отдельный `kind` для состояний, невоспроизводимых на эталоне (§2.4).
- Evidence: `docs/plan/evidence/<key>/{390,768,1440}.png`, `reference-{390,1440}.png`, `snapshot.txt` (дерево доступности), `console.txt`, `network.txt`; проверяющий — `…/verify/`; фаза 2 — `…/phase2/` (D-52).

### 4.9 Персонаж × страница → состояние на старте (из B §4.4; закрывает 00 G6)

Источники: `DEFAULT_PAGE` и `navForBase` (01 §8.3), гейт (01 §12 «Стартовые срабатывания»), сид (07 §9; 03 §2; 05 §11 п.9; 06 §2). **Д** — данные из сида; **П** — пусто/без пунктов; **Г-М** — AccessGate «Модуль не подключён»; **Г-П** — AccessGate «Нет права»; **—** — нет пункта и маршрута; ★ — стартовая.

| Страница | operator | owner | manager (до роли → после `logistics-ready`) | driver | therapist | foreman | owner@t-lotos | therapist@t-lotos |
|---|---|---|---|---|---|---|---|---|
| `home` | — | ★ Д «1 из 3» (E1) | ★ П → Д | — | — | — | ★ Д | — |
| `modules`/`users`/`billing`/`branding` | — | Д (trial, 9 из 10) | — | — | — | — | Д (active, 23, SR-12) | — |
| `fleet`/`pool`/`review` | — | Г-М → Д | Г-М; после подключения без роли — Г-П «Нет роли с доступом к модулю «Логистика»» / «Нет права на приёмку смен» → Д | — | — | — | — | — |
| `today`/`cars` | — | — | — | ★ Г-М → Д Р-208 «Запланирован» | — | — | — | — |
| `forms` | — | Д (2 формы) | Г-П → Д read-only (чип «Только просмотр · нет права «Настраивать»») | Г-П | Г-П | Г-П | П (D-27, пусто без текста) | — |
| `tasks` | — | Д (9) | Г-П → Д (бейдж 1) | Г-П | Г-П | Д (`leads`, без проекта) | Д (2) | — |
| `calendar` | — | Д (8 ресурсов, 6 броней) | Г-П → Д | Г-П | Д | Г-П | Д | Д |
| `knowledge` | — | Д (4 стр.) | Г-П → Д | Д (без приватных) | Д | Д | Д | Д |
| `data`/`files` | — | Д | Г-П → Д | Г-П | Г-П | Г-П | Д | Г-П |
| `spa` | — | Д «Салон и SPA» | Г-П | Г-П | ★ Д «Мой день» (3 визита) | Г-П | Д | ★ Д |
| `cash` | — | Д (4 операции) | Г-П | Г-П | Г-П | Г-П | Д (журнал пуст) | Г-П |
| `repair` | — | Г-М → Д (`repair-on`) | Г-П | Г-П | Г-П | ★ Г-М → Д | Г-М | Г-П |
| `tenants`…`plans` | ★ Д (4 организации, 58 аккаунтов, 6 операторов, 2 версии сетки, 2 заявки) | — | — | — | — | — | — | — |

Каждая клетка «Г-*» — обязательный e2e-пункт «нет права / модуль не подключён» в spec'е страницы; каждая «→» — рецепт §2.4; клетки — параметры `reference`-фикстуры (`persona`, `page`, `recipe`).

### 4.10 Методы прототипа → операции 0.2 → владелец хендлера (из B §7; `x-adapter-method`)

Хендлеры фазы 1 — mock-адаптер (WS-06, 1:1 с `api.js`); колонка «владелец» — WS backend фазы 2/3 и WS-51 для маппинга в http-адаптере.

| Метод прототипа | Операции контракта (0.2) | Backend-владелец | Примечание (WS-51) |
|---|---|---|---|
| `setActor`, `load`, `setFlag` | `devLogin`/сессия, `getMyContext`, — | WS-40 | флаги — только mock; эквиваленты фазы 2 — D-31 |
| `setModule` | `setModuleInstallation` (PUT + If-Match); предпросмотр — `getModuleInstallation?preview=disable` | WS-45 | тост «Модуль «Логистика» подключён» |
| `setStorageQuota` | `requestStorageChange` `quote` → `commit` | WS-45 | «Всё равно применить» = commit с `acceptedQuoteId` |
| `setTenantStatus` (демо) | `updatePlatformTenant` / `updatePlatformSubscription` (`reason` в API, в демо — константа) | WS-43 | у владельца — рецепт `trial-ended` (D-44) |
| `saveBranding` | `putBranding` (+ `uploadBrandingFile`) | WS-67 | `accentUsed` считает сервер (Q-24) |
| `assign` / `unassign` | `createAssignment` / `revokeAssignment` | WS-44 | `scope{kind, resourceIds}` из `region/firm` (Q-89) |
| `invite` / `revokeInvite` | `inviteMember` / `revokeInvitation` | WS-44 | 409 `seats_exhausted` |
| `createRole` / `saveRole` | `getRole` → `createRole` (клон на клиенте) / `updateRole` + If-Match (`ETag = current_version`, Q-92) | WS-44 | `actions/finance` → ключи через `renames` |
| `requestSeats` / `cancelSeatRequest` | `createSeatRequest` / `cancelSeatRequest` | WS-67 | 409 `request_pending` |
| `reserve` / `cancelReservation` | `reserveVehicle` / `releaseReservation` | WS-46 | `conflictNext` → 409 `reservation_overlap` |
| `upload` | `initiateUpload` → PUT → `completeUpload` → `getFile` до `ready` | WS-45 | `failUploadNext` → ошибка PUT → слот `failed` |
| `submitDeparture` | `getInspectionChecklist` → `submitInspection` → `startTrip` | WS-47 | критический дефект → `requires_review`, `startTrip` не вызывается |
| `finishRoute` | `finishTripRoute` | WS-47 | статус `returning` |
| `submitReturn` | `submitInspection(return)` → `returnTrip` | WS-47 | офлайн → `outbox`, повтор с тем же `Idempotency-Key = opId` |
| `addExpense` | `createTripExpense` (`Idempotency-Key = opId`) | WS-47 | повтор → тот же `TripExpense` (мок: `'duplicate'`) |
| `resetTrip` | — (демо) | — | «Начать новую демо-смену» — `DemoOnly` (D-44) |
| `assignVehicle` / `decideDefect` | `assignTripVehicle` / `decideInspectionDefect` | WS-46 / WS-47 | 409 `vehicle_incompatible` с причинами «; » |
| `reviewTrip` | `reviewTrip` (`approve`/`rework` + `steps[]`) → при `approve` `setTripEarnings` | WS-48 | мок делает оба в одной команде (Q-55) |
| `requestDriver` / `decideRequest` | `listAvailableDrivers` + `requestDriverTransfer` / `decideDriverTransfer` | WS-49 | «Демо: ответ фирмы-владельца» — `DemoOnly` |
| `setTenantQuota` / `extendTrial` | `updatePlatformSubscription` (`manualEntitlements` / `trialEndsAt` + `reason`) | WS-43 | |
| `decideSeatRequest` | `decideSubscriptionRequest` | WS-67 | reject без `reason` → 422 «Укажите причину отказа» |
| `setAccountLock` / `resetMfa` | `lockPlatformAccount` / `resetPlatformAccountMfa` | WS-67 | |
| `inviteOperator` / `setOperatorRole` / `setOperatorStatus` | `inviteOperator` / `updateOperator` | WS-67 | минимум владельцев — D-46 |
| `publishPriceBook` / `cancelScheduledPriceBook` | `publishPriceBookVersion` / `cancelScheduledPriceBookVersion` | WS-67 | 409 при уже запланированной |
| `moveBooking` | `updateCalendarBooking` → при 409 `resources_unavailable` → `findCalendarAvailability` | WS-63 | слоты отдельным запросом (10 §7.2) |
| `saveKbPage` | `updateKnowledgePage` + If-Match | WS-62 | 412 `revision_mismatch` → текст прототипа |
| `createTask` / `moveTask` / `toggleTaskCheck` / `commentTask` | `createTask` / `transitionTask` / `toggleTaskChecklistItem` / `addTaskComment` | WS-61 | guard чек-листа → 409 `invalid_transition` |
| `publishForm` | `createFormVersion` → `publishFormVersion` | WS-60 | оба с If-Match по форме |
| `completeAppointment` / `resolveIssue` | `recordAppointmentPerformance` → `completeAppointment` / `resolveSpaIssue` | WS-64 | нехватка → `performed_pending_posting` + issue |
| `addCashOp` / `reverseCashOp` | `postCashOperation` / `postCashOperation{reversesOperationId}` | WS-65 | |
| `addWorkLog` / `acceptWorkLog` | `submitWorkLog` / `acceptWorkLog` | WS-66 | материалы в `WorkLogLine` (WS-15) |

### 4.11 Диапазоны миграций и файлы изоляции (D-51)

| Диапазон | Владелец | Содержимое |
|---|---|---|
| control 0001–0003 | WS-41 | из `design/docs/db/control_*.sql` |
| control 0004 (usage), 0005 (branding/pricebook ext) | WS-67 | `tenant_usage_daily` (Q-91) |
| tenant 0001–0002 | WS-41 | из `tenant_0001_core.sql`, `tenant_0002_fleet.sql` |
| tenant 0003 | WS-41 | разрывы 09 §7.1 (`review.comment/steps`, `title`, `model`, `depot`, `trip.title`, `distanceKm`, `pool.terms`, `source_type` nullable — Q-80, Q-90) |
| tenant 0004 files, 0005 notifications | WS-45 | upload sessions, inbox |
| tenant 0006 fleet-ext (ревизии осмотров — Q-51, hold-expiry — Q-50) | WS-47 | |
| tenant 0007 forms, 0008 tasks, 0009 knowledge, 0010 spa_inventory, 0011 cash, 0012 repairs, 0013 importer | WS-60…66, WS-72 | в `drafts/` до своей волны |

`backend/test/isolation/<module>_test.go` — файл на модуль (`access`, `control`, `files`, `fleet`, `data`, …); фикстура (тенант A «Холдинг» 3 региона × 4 фирмы, тенант B, менеджеры Москва-1/2, водитель через группу «Водители Север», пользователь с двумя ролями — `15-quality-security.md`) — WS-42.


## 5. Реестр WS

Размер: S ≈ 1 сессия агента, M ≈ 2–3, L ≈ 4–6 (относительно; календарную оценку даёт интегратор после волны 0). «Зависит от» — WS, влитые в `main` до старта; «блокирует» — кто ждёт. `kind` — тип WS для §8. Все UI-WS (`pages`, `shell`, `docs-site`) обязаны пройти §8.2 для каждого своего ключа; все backend-WS — §8.3.

### 5.1 Сводная таблица

| id | slug | волна | kind | цель | размер | зависит от | блокирует | ревью |
|---|---|---|---|---|---|---|---|---|
| WS-00 | analysis-fixes | 0 | quality | проверить/дописать правки отчётов (E1–E6, 02 #44/#51, 04 §5.2, 06 #43 и #34/#35, 05 §11 нумерация, 08 J17, 2 пункта `therapist@t-lotos`, список `data-screen-label`), ADR-0001 URL-схема, внести D-25…D-52 и колонку WS в `decisions.md` | S | — | WS-07 (генератор скелетов), все UI-WS | критик |
| WS-01 | repo-skeleton | 0 | infra | git, pnpm workspace, `go.mod`, линтеры, husky, CI, `CLAUDE.md`, CODEOWNERS, `check-icu`, `allowlist-lint`, Windows-onboarding | M | — | все | 1 |
| WS-02 | compose-stand | 0 | infra | compose: postgres 17, minio, mailpit, otel; `postgres-test` под `profiles:[test]`; keycloak под профилем | S | WS-01 | WS-40, WS-41, WS-53 | 1 |
| WS-03 | contract-core | 0 | contract | OpenAPI 0.2 core (§4.1), permissions, errors enum, split по тегам, `make gen`, Spectral, drift-CI, `screens.yaml`, примеры | L | WS-01 | WS-15, WS-40…50, WS-51 | 2 |
| WS-04 | tokens-ui-contract | 0 | ui-kit | `@ortus/tokens` (CSS/TS, шрифты), контракт пропсов и стабы 30 компонентов, Storybook-каркас | M | WS-01 | WS-10…14, WS-11 | 1 |
| WS-05 | domain-seed-port | 0 | domain | `packages/domain`: типы, модели 1:1, сид обеих организаций + платформы, `snapshot.json`, сценарии, `clock`, `AdapterPort`, `renames`, `errors/map` | M | WS-01 | WS-06, WS-10, WS-14, WS-20…32, WS-52 | 1 |
| WS-06 | mock-adapter-port | 0 | domain | `packages/adapter/src/mock`: порт `api.js` 1:1 + conformance-suite (62 кейса + покрытие 51 метода и всех кодов) + presets | M | WS-05 | WS-10, WS-14, WS-20…32, WS-51 | 1 |
| WS-07 | e2e-harness-mcp | 0 | infra | Playwright-конфиги (web 3 проекта, docs 4 проекта), фикстуры `demo`/`reference`/`axe`/`clock`, рецепты, `collectLabels`, генератор скелетов, `verify-pages`, `design-preview --offline`, `labels-dump`, MCP, Go-харнесс | M | WS-01 | WS-10…32, WS-40+ | 1 |
| WS-08 | texts-dictionary | 0 | contract | `packages/texts`: дословные строки по доменам (19 файлов), `screen-labels.ts` | M | WS-01 | WS-10…32 | 1 |
| WS-10 | shell | 1 | shell | оболочка: роутер, персонажи, шапка, nav/rail/нижняя, sheet, баннеры, AccessGate, тост, `ModalHost` + `confirm`, демо-панель, гид, `DemoOnly`, офлайн, skeleton/loadErr; `shell.spec`, `demo-panel.spec`, `guide.spec` | L | WS-04, WS-05, WS-06, WS-07, WS-08 | WS-14, WS-20…32 | 1 |
| WS-11 | docs-site | 1 | docs-site | `apps/docs`: читалка, фреймы без CDN, 6 ключей `docs-*`, карта следующих итераций из `roadmap.js` (D-24) | L | WS-04, WS-07 | — | 1 |
| WS-12 | ui-core | 1 | ui-kit | базовые компоненты `@ortus/ui` (§4.4, WS-12) с состояниями, Storybook, axe, визуальные снимки витрины | M | WS-04 | WS-10 (визуал), WS-20+ | 1 |
| WS-13 | ui-domain | 1 | ui-kit | доменные компоненты (§4.4, WS-13) | M | WS-04 | WS-22…31 | 1 |
| WS-14 | modals-people | 1 | pages | диалоги «Назначить роль», «Пригласить участника», «Создать роль» | S | WS-04, WS-05, WS-06, WS-08, WS-10 (слот `ModalHost` — ранний старт §6.4) | WS-20, WS-24 | 1 |
| WS-40 | backend-platform | 1 | backend | `cmd/api`: chi + strict server по тегам, конвейер, сессия dev-провайдера, tenant resolver, `/me/context` (+ `tenants[]`, `selectTenant` — S1-07), `listMyEvents`, idempotency, `X-Test-Scenario` (D-31) | M | WS-02, WS-03 | WS-42…50 | 1 |
| WS-41 | migrations | 1 | backend | goose: control 0001–0003, tenant 0001–0003, контроллер canary → партии, `cmd/migrate`, роли БД, testcontainers-проверка up/down | M | WS-01, WS-02 | WS-42, WS-43, WS-52, WS-56 | 2 |
| WS-15 | contract-delta | 2 | contract | OpenAPI-дельта S3+ (§4.1 delta), каталог прав G-21, `screens.yaml` delta, примеры, changelog | M | WS-03 | WS-51 (delta-часть), WS-60…72 | 2 |
| WS-20 | company | 2 | pages | «Модули и место», «Пользователи и роли» (4 вкладки + редактор роли), «Подписка и места» | L | WS-06, WS-10, WS-12, WS-14 | WS-21 (стаб меню), WS-51 | 1 |
| WS-21 | branding | 2 | pages | «Оформление» | M | WS-06, WS-10, WS-12 | — | 1 |
| WS-22 | logistics-manager | 2 | pages | «Рабочее место логиста», «Ресурсный пул» (+ `modal-request`), «Приёмка смен» | L | WS-06, WS-10, WS-12, WS-13 | WS-51 | 1 |
| WS-23 | logistics-driver | 2 | pages | «Сегодня» (9 состояний, фото, расходы, сдача, outbox), «Автомобили» | L | WS-06, WS-10, WS-12, WS-13 | WS-51, WS-68 | 1 |
| WS-24 | home | 2 | pages | «Главная» | M | WS-06, WS-10, WS-12, WS-13, WS-14 | — | 1 |
| WS-25 | forms | 2 | pages | «Формы и опросы» | M | WS-06, WS-10, WS-12 | — | 1 |
| WS-26 | tasks | 2 | pages | «Задачи» | M | WS-06, WS-10, WS-12 | — | 1 |
| WS-27 | platform-orgs | 2 | pages | «Организации», «Использование», «Заявки на тариф», `opConfirm` | M | WS-06, WS-10, WS-12, WS-13 | — | 1 |
| WS-28 | platform-accounts-plans | 2 | pages | «Пользователи» (оператор), «Тарифная сетка» | M | WS-06, WS-10, WS-12, WS-13 | — | 1 |
| WS-29 | core-modules | 2 | pages | «Календарь», «База знаний», «Данные», «Файлы» | M | WS-06, WS-10, WS-12, WS-13 | — | 1 |
| WS-30 | spa-cash | 2 | pages | «Салон и SPA»/«Мой день», «Внутренняя касса» | M | WS-06, WS-10, WS-12 | — | 1 |
| WS-31 | repair-object | 2 | pages | «Объекты»: `ObjectHeader`, «Обзор», «Работы», контейнер дочерних вкладок | M | WS-06, WS-10, WS-12, WS-13 | WS-32 (контракт контейнера — публикуется в брифе) | 1 |
| WS-32 | repair-child | 2 | pages | 9 встроенных вкладок «Ремонт и стройка» по карте 06b (деление a–f) | L | WS-04, WS-12, WS-13, контракт контейнера WS-31 (из брифа) | WS-31 (финальная интеграция) | 1 |
| WS-42 | authz | 2 | backend | `permit()`, `scopeQuery()`, `explainAccess`, `policy_version`, фикстуры изоляции | L | WS-03, WS-40, WS-41 | WS-43…50 | 2 |
| WS-43 | control-tenants | 2 | backend | S1-02, S1-04: статусы тенанта (D-35), продление trial, подписки/entitlements, аудит control DB | M | WS-40, WS-41 | WS-52, WS-56 | 1 |
| WS-44 | access-people-org | 2 | backend | S1-06, S1-08, S1-09, S1-11…S1-16: приглашения, членства, регионы/фирмы, карточки, роли (ETag), назначения, группы, последний владелец | L | WS-42 | WS-46+ | 1 |
| WS-45 | modules-files-services | 2 | backend | S1-17…S1-26: каталог модулей, draining/read_only, upload session (MinIO), аудит, outbox worker, inbox | L | WS-42 | WS-47 | 1 |
| WS-51 | http-adapter-msw | 2 | integration | `packages/adapter/src/http` (openapi-fetch) + сценарный сервер `src/msw` (OpenAPI-фасад над mock) + MSW из примеров + `make examples` + паритетная сюита; core-часть сразу, delta — pipeline после WS-15 | M | WS-03, WS-06, (WS-15 для delta) | WS-53, WS-60+ | 1 |
| WS-46 | fleet-core | 3 | backend | S2-01…S2-03, S2-13: машины, `compat`/`legs` Go, маршруты, бронь с hold (AC-03), назначение машины | M | WS-44, WS-45 | WS-47 | 1 |
| WS-47 | fleet-shift | 3 | backend | S2-04…S2-09: чек-лист, 5 фото, дефекты, решение по дефекту, старт, расходы, `returning`, сдача (AC-04) | L | WS-46 | WS-48, WS-71 | 1 |
| WS-48 | fleet-review-earnings | 3 | backend | S2-10…S2-12: приёмка/rework по разделам, проверка расходов, начисления (AC-05) | M | WS-47 | — | 2 |
| WS-49 | fleet-pool | 3 | backend | S2-14: пул, временный grant, автозавершение (AC-06) | M | WS-44 | — | 1 |
| WS-50 | datasets | 3 | backend | S2-16: наборы «Машины», «Рейсы», «Расходы» (AC-14, 404 на count) | S | WS-42, WS-46 | — | 1 |
| WS-52 | go-seed | 3 | backend | `cmd/seed` = `snapshot.json` (D-19, D-30, D-46), `make seed` идемпотентен | S | WS-05, WS-41, WS-43, WS-44 | WS-53 | 1 |
| WS-53 | e2e-full-stand | 3 | integration | `npm run e2e:full`: compose `--profile e2e`, migrate, seed, те же spec'и (`E2E_MODE=stand`), повторная MCP-проходка 11 страниц → `phase2/`, `mock-vs-http.spec.ts`, Schemathesis, D-31 | M | WS-02, WS-51, WS-52, WS-46…48 | волна 4 | 1 |
| WS-54 | keycloak-oidc | 3 | backend | S1-05: OIDC Code + PKCE, realm-файлы, профиль compose, `@keycloak` smoke (по D-41) | M | WS-40, WS-02 | — | 2 |
| WS-55 | journeys-e2e | 3 | quality | `e2e/journeys/J01…J18.spec.ts` (08 §6), `guide-path.spec.ts` (8 шагов + 7 негативных), `@smoke`, оба режима; пишут не авторы экранов | M | все WS-20…32, WS-10 | — | 1 |
| WS-56 | provisioning | 3 | backend | S1-01, S1-03: `createPlatformTenant` (CREATE DATABASE + sentinel + миграции + владелец), саги control↔tenant, AC-02 | M | WS-41, WS-43, WS-44 | — | 2 |
| WS-60 | be-forms | 4 | backend | формы, версии, публикация, ответы по версии (AC-09), AC-08 | L | WS-15, WS-45, WS-51 | WS-71 | 1 |
| WS-61 | be-tasks | 4 | backend | проекты, задачи, переходы, чек-листы, комментарии | M | WS-15, WS-45, WS-51 | WS-71 | 1 |
| WS-62 | be-knowledge | 4 | backend | пространства, страницы, версии, приватные, 412 | S | WS-15, WS-45, WS-51 | — | 1 |
| WS-63 | be-calendar | 4 | backend | ресурсы, брони с буферами, перенос, 3 слота; Go-копия `bookingConflicts`/`freeSlots` | M | WS-15, WS-46, WS-51 | — | 1 |
| WS-64 | be-spa-inventory | 4 | backend | визиты, выполнение, однократное списание (AC-07), issues, склад | M | WS-15, WS-45, WS-51 | — | 1 |
| WS-65 | be-cash | 4 | backend | счета, журнал, сторно, предложения из `fleet.expense.verified.v1` | S | WS-15, WS-48, WS-51 | — | 2 |
| WS-66 | be-repairs | 4 | backend | объекты, работы, отметки, приёмка/возврат, обзор; бригада без аккаунтов (AC-13) | M | WS-15, WS-45, WS-51 | — | 1 |
| WS-67 | be-branding-billing-platform-ops | 4 | backend | branding (BR-T1…T3), заявки на места/тариф, прайс-бук, аккаунты lock/mfa, операторы, usage (Q-91) | L | WS-15, WS-43, WS-45, WS-51 | — | 2 |
| WS-68 | pwa-offline | 4 | pages | S2-15: Workbox, outbox в IndexedDB, `today-offline.spec.ts` через `context.setOffline` | L | WS-23, WS-47, WS-53 | — | 1 |
| WS-69 | load-restore | 4 | quality | k6 по профилю пилота (p95 ≤ 500/800 мс), restore drill (AC-15), SBOM/подпись образов | M | WS-53 | — | 1 |
| WS-70 | notify-realtime | 4 | backend | `GET /me/notifications`, inbox, SSE (G-19, S1-26, Q-95), колокольчик из серверного источника | M | WS-15, WS-45, WS-51 | — | 1 |
| WS-71 | inspection-automation | 4 | backend | потребитель `fleet.inspection.submitted.v1`: ответ формы «Осмотр машины» + задача «Проверить осмотр …», ключ `tripId:kind:rev` (07 §16 п.15, 08 §11 п.19, Q-59) | M | WS-47, WS-60, WS-61 | — | 1 |
| WS-72 | csv-import | 4 | backend | S1-10 backend-only: `importMembersCsv`, `importVehiclesCsv` с предпросмотром и ошибками строк (D-48) | M | WS-15, WS-44, WS-46 | — | 1 |

### 5.2 Покрытие инвентаря

| Что | Покрыто | Итог |
|---|---|---|
| 25 ключей `pg.*` (00 §3.1) | `home` WS-24; `modules users billing` WS-20; `branding` WS-21; `fleet pool review` WS-22; `today cars` WS-23; `tenants usage requests` WS-27; `accounts plans` WS-28; `forms` WS-25; `tasks` WS-26; `calendar knowledge data files` WS-29; `spa cash` WS-30; `repair` WS-31 (+ WS-32 вкладки); `planned` — не реализуется (D-24), данные → WS-11 | 24/24 реализуемых + 1 решение |
| 6 модалок (00 §3.2) | `confirm`, `sheet` WS-10; `assign`, `invite`, `createRole` WS-14; `request` WS-22 | 6/6 |
| 35 VM (00 §3.3) | `toastVM guideVM shellVM gateVM bannersVM modalVM` WS-10; `planVM` — D-24; остальные 28 — `routes/<group>/vm/` страничных WS | 35/35 |
| 51 метод адаптера (00 §3.4) | `AdapterPort` WS-05 + mock WS-06 + http WS-51; владельцы backend — §4.10 | 51/51 |
| 10 вкладок дочернего макета (06b §3) | 9 embedded — WS-32; `leads` (standalone) — вне объёма (D-36) | 9/9 + решение |
| 8 персонажей, 2 + 2 организации (00 §3.5) | матрица §4.9; `therapist@t-lotos` — 2 пункта в `spa.spec`/`calendar.spec` (WS-30/WS-29) | 8/8 |
| 2 приложения | `apps/web`, `apps/docs` (WS-11, 6 ключей) | 2/2 |
| S0–S2 (55 историй) | таблица §9.2 | 55/55 (S1-10 → WS-72, S1-07 → WS-40, S1-22 → `modules`) |
| AC-01…AC-15, BR-T1…T3 | таблица §9.1 | 15/15 + 3/3 |
| S3+ модули | WS-60…67, 70, 71 по определению §1.4 | по модулям |

### 5.3 Страница → WS → e2e spec → визуальная сверка → MCP-проходка

Для **каждого** ключа обязательны: `e2e/<key>.spec.ts` (чек-лист отчёта + 6 пунктов `verification-protocol.md` §1.3), `e2e/visual/<key>.visual.spec.ts` и `<key>.labels.spec.ts` (390 и 1440, порог 0,01, рецепты §2.4), проходка Playwright MCP по §4 с evidence в `docs/plan/evidence/<key>/`, ревью. Колонка «Эталон» — персонаж · рецепт для `reference`-фикстуры; «Особые состояния» — что сверх §1.3.

| Ключ | WS | spec / чек-лист | Эталон (персонаж · рецепт) | Особые состояния (источник) |
|---|---|---|---|---|
| `home` | WS-24 | `home.spec.ts` ← 05 §9.1 #1–11 | owner · base; manager · base и `logistics-ready`; owner@t-lotos | «Начало работы» «1 из 3» (E1), «показано 8 из N», manager без роли — пусто, «Рейсы сегодня» при `driver-on-route`, приветствие по `page.clock`, шаг 2 → `modal-assign` с «Марина Котова» |
| `modules` | WS-20 | `modules.spec.ts` ← 02 §10 #1–14 | owner · base; `trial-ended`; `storage-full`; owner@t-lotos | диалоги «Подключить «Логистика»?»/«Отключить …?» с `ack`; `roleNote` «Роли с правами модуля есть у: 1 сотрудника…» → «Доступ через роли: 1 сотрудник» (E2); лимит 25…500 ГБ; `meter` «Занятое место»; офлайн |
| `users` | WS-20 | `users.spec.ts` ← 02 §10 #15–36 + 09 P-01…P-03 | owner · base, `logistics-ready` (вкладка «Роли»), `seats-full` | `tablist` «Разделы доступа»; «Проверка доступа» 4 пресета дословно (09 §4.7); системная роль read-only; `checked && disabled`; Лотос — дефолты (D-27) |
| `billing` | WS-20 | `billing.spec.ts` ← 02 §10 #37–47 (#44 «8 из 10») | owner · base, `seats-full`; owner@t-lotos (SR-12) | `radiogroup` «Тариф»/«Срок оплаты», `calc`; заявка → `role=status` «Заявка {id} подтверждена {decidedAt}.»; отзыв приглашения → «8 из 10», диалог закрывается (Q-30) |
| `branding` | WS-21 | `branding.spec.ts` ← 02 §10 #48–64 (#51 с вычисленным `fixAccent('#FFD400')`) | owner · base; owner@t-lotos | `radiogroup` «Палитра», «Свой цвет в формате HEX»; «Выше»/«Ниже», 5 `BR_LOCK`; `group` «Что показать»; `setInputFiles`; версии; акцент на `:root`; BR-T2 |
| `fleet` | WS-22 | `fleet.spec.ts` ← 03 §14 #1–13 | manager · base (гейты), `logistics-ready`; owner | гейт «„Логистика“ не подключена организацией» / «Нет роли с доступом к модулю «Логистика»»; compat 86 %/69 % с причинами; `legs`; `conflict-next` → «Конфликт: …»; «Передать в навигатор · интеграция не подключена» disabled; колонки от ~950 px |
| `pool` | WS-22 | `pool.spec.ts` ← 03 §14 #14–17 | manager · `logistics-ready` | «Запросить водителя» → `modal-request`; «Демо: ответ фирмы-владельца» → «Одобрить»/«Отклонить» (`DemoOnly`); пусто |
| `review` | WS-22 | `review.spec.ts` ← 03 §14 #41–47 | manager · `empty-review`, `shift-submitted`, `defect-review`, `shift-accepted`; owner | очередь defect_review → submitted → rework → accepted; «Принять смену …?»; rework: «Опишите, что нужно исправить» / «Отметьте хотя бы один раздел для доработки»; начисление только по `canEarnings`; гейт «Нет права на приёмку смен»; бейдж меню |
| `today` | WS-23 | `today.spec.ts` ← 03 §14 #18–40 + 08 J3 (8 негативных) | driver · base (гейт), `driver-booked`, `driver-on-route`, `defect-review`, `shift-submitted`, `shift-accepted`, `offline`, `conflict-next`, `fail-upload` | 9 состояний рейса; 5 слотов × 5 состояний; «Осталось: 1 фото»; `odoError`; «Сумма должна быть больше нуля»; «Завершить рейс …?»; outbox `local/sending/error` + `flush`; «Конфликт брони» + «Обновить список»; sticky-панель на 390; без рейса — ничего не рендерить (Q-54) |
| `cars` | WS-23 | `cars.spec.ts` ← 03 §14 #48 + `bookLabel`/disabled-подписи (00 §7) | driver · `logistics-ready` | `group` «Фильтр»: «Все»/«Подходят к рейсу»/«Свободны»; бронь из списка; подпись меню «Автомобили» (Q-40) |
| `tenants` | WS-27 | `tenants.spec.ts` ← 04 §8 #7–14 | operator · base | 4 организации, чипы; «Продлить пробный период на 14 дней» (Q-05); квота; `opConfirm` «Последствия» → «Готово · запись добавлена в журнал»; аудит 6 строк; «26 дн. · до 27.10.2026»; полоса `#A13A33` при 46,2/25; `data-screen-label` «Оператор · организации» |
| `usage` | WS-27 | `usage.spec.ts` ← 04 §8 #15–20 | operator · base | агрегаты снять с эталона при фиксации («59 из 70», «141,4 из 275 ГБ», «34 из 57», 7 сигналов — WS-00); таблица 860 px со скроллом на 390 |
| `requests` | WS-27 | `requests.spec.ts` ← 04 §8 #21–25 | operator · base, `empty-requests` | SR-12 pending / SR-9; отказ без причины → «Укажите причину отказа»; бейдж = pending; цена по текущей сетке (Q-06) |
| `accounts` | WS-28 | `accounts.spec.ts` ← 04 §8 #26–38 | operator · base | «Поиск по имени, почте или организации», «Фильтр аккаунтов»; realm «Ортус · Платформа»: нельзя себя, последний владелец (D-46); поповер «Организации аккаунта» с клавиатуры; «Карточка аккаунта»: блокировка с причиной, сброс MFA; 58 аккаунтов |
| `plans` | WS-28 | `plans.spec.ts` ← 04 §8 #39–46 | operator · base | v1/v2; «Черновик vN · не опубликован»; 9 правил `validateDraft`; «Запланирована версия …» + отмена; таблица 760 px |
| `forms` | WS-25 | `forms.spec.ts` ← 05 §9.2 #12–29 + негативный «owner@t-lotos → пусто» (05 §11 п.26) | owner · base; manager · `logistics-ready`; owner@t-lotos | 10 типов полей, «Поднять поле»/«Опустить поле»/«Удалить поле», «Показывать, если»; «Опубликовать «{name}» v{N}?»; «Убрано относительно предыдущей версии»; «Не показывался по условию» vs «Не ответил»; журнал «Ответ R-… принят → Задача T-…»; чип «Только просмотр · нет права «Настраивать»»; «по v—» (Q-67); «Новая форма из шаблона · следующий шаг» disabled |
| `tasks` | WS-26 | `tasks.spec.ts` ← 05 §9.3 #30–47 | owner · base; manager · `logistics-ready`; foreman; owner@t-lotos | «Канбан»/«Список», «Все исполнители»/«Мои задачи»; T-170; `aside` «Карточка задачи»; `TASK_FLOW`; «Нельзя завершить: в чек-листе есть невыполненные пункты»; «⚡ из ответа формы»; ссылки → forms/review/fleet (Q-68); foreman `leads` (Q-63); «Нет проектов в вашей области»; h1 «Задачи»/«Заявки» |
| `calendar` | WS-29 | `calendar.spec.ts` ← 06 §13 #1–9 + G2 пункт для `therapist@t-lotos` | owner · base; therapist; manager · `logistics-ready`; therapist@t-lotos | 8 ресурсов/6 броней, таймлайн 08–20 `clamp`; панель брони; перенос с конфликтом → `role=alert` «Конфликт ресурсов: …» + 3 слота; «Рейс Р-208» не переносится; `min-width` 640 на 390; утечка в Лотосе дословно (Q-31) |
| `knowledge` | WS-29 | `knowledge.spec.ts` ← 06 §13 #10–15 | owner · base; driver; therapist | «Дерево страниц», «Поиск по базе знаний», «Текст страницы»; «Ничего не найдено среди доступных страниц»; правка владельца → «Опубликовать v3»; конфликт через пресет `kb-conflict` (allowlist `no-reference`); приватные скрыты; `treeMax` по `W` (D-27) |
| `data` | WS-29 | `data.spec.ts` ← 06 §13 #16–22 + AC-14 (суммы «Расходы» = расходы рейсов) | owner · base; manager · `logistics-ready`; роль без `data.export` (создаётся в тесте) | «Наборы данных»; таблица 560 px со скроллом; `hiddenNote` (Q-75); «Выгрузить» disabled; колонка «Начисление» по праву |
| `files` | WS-29 | `files.spec.ts` ← 06 §13 #23–25 | owner · base, `storage-full` | список без пагинации (Q-76); баннер «Место организации заполнено.»; «Север Логистик · документы» в Лотосе дословно |
| `spa` | WS-30 | `spa.spec.ts` ← 06 §13 #26–30 + 2 пункта G2 (`therapist@t-lotos` «Мой день», меню «Календарь») | therapist · base; owner; therapist@t-lotos | «Завершить процедуру» → `done_pending` + `role=alert` «Учёт материалов не завершён…»; owner: «Списать остаток из резерва»/«Принять фактический расход»; `busy`; крошка захардкожена дословно (Q-31); бейдж `issues.open`; офлайн |
| `cash` | WS-30 | `cash.spec.ts` ← 06 §13 #31–37 (#34/#35 независимы) | owner · base, `shift-accepted`; owner@t-lotos | «Провести в …» inline (`quiet: ['validation']`); «Сторнировать K-302?» закрывается и при ошибке (E6); баланс «50 000 ₽»; «Предложения из принятых смен»; журнал Лотоса пуст; `busy` (Q-72) |
| `repair` | WS-31 | `repair.spec.ts` ← 06 §13 #38–46 (#43 «52%») | owner · base (гейт), `repair-on`; foreman · `repair-on`; owner@t-lotos (гейт) | «„Ремонт и стройка“ не подключён организацией»; `ObjectHeader` 48 % / «На приёмке 5 %» → 52 %; «Решений не требуется» до сводки; «Работы»: inline-ошибки «Объём должен быть больше нуля» и др.; «Принять объём»; `canFin`-вкладки только владельцу; чип «сдача 01.12 вместо 27.11» (06b §18 #1) |
| `repair-tabs` | WS-32 | `repair-tabs.spec.ts` ← 06b §18 #1–5, #10–47 (#6–9 standalone исключены, D-36) | owner · `repair-on` → вкладка; foreman · `repair-on` (#4, #47); 390 (#34) | «Замер» формулы (46,8 / 134,2); «Смета» 413 379 ₽, чипы версии; «График»: тулбар «Вид графика», 7 причин, панель этапа, баннер «Несохранённое изменение графика», «Сохранить и уведомить», drag (06b §20 п.7), прогноз 27.11 → 01.12 → 03.12; «Документы» → «Оплата бригады» → «Финансы» цепочка; «Кабинет заказчика»; инъекция `D0=2026-10-05`, `TODAY=15`, `HOL=[30]`; 4 обязательных снимка «График» (06b §20 п.6, п.9) |
| `shell` | WS-10 | `shell.spec.ts` ← 01 §20 (38 пунктов); `demo-panel.spec.ts` ← 01 §5; `guide.spec.ts` ← 01 §6 | все 8 персонажей · base; 390/768/1440 | брейкпоинты 640/1080 по `W` (container queries); шапка оператора `#1C2A26` без колокольчика; поповеры; 5 баннеров; 4 AccessGate; тост 4200 мс; `Escape`; офлайн-пилюля + `flush`; `applyBrand` Лотоса; «Загружаем рабочее пространство…»; `loadErr` |
| `modal-confirm` | WS-10 | `modal-confirm.spec.ts` (9 вызывающих точек 00 §3.2) | owner · base → `modules` «Отключить» | секции последствий + `ack`; «Выполняем…» при `busy`; Esc/backdrop; `#dlg-title`; лист на 390 |
| `modal-sheet` | WS-10 | `modal-sheet.spec.ts` | owner/driver · base на 390 | «Все разделы», «Закрыть» 44×44, группы, бейджи, `aria-current`, `radius 16px 16px 0 0` |
| `modal-assign` | WS-14 | `modal-assign.spec.ts` (+ сценарии в `users`, `home`, `modules`) | owner · base → «Пользователи и роли» → «Назначить роль» | предзаполнение, «Итог назначения», `role_conflict` inline, 620 px, лист на 390 |
| `modal-invite` | WS-14 | `modal-invite.spec.ts` (+ `users`, `billing`, `home`) | owner · base, `seats-full` | «Свободно мест: 1 из 10 — это последнее…»; `seats_exhausted` alert + «Подписка и места»; «Приглашение действует 7 дней» |
| `modal-createRole` | WS-14 | `modal-createRole.spec.ts` (+ `users`) | owner · base → «Роли» | `radiogroup` «Основа роли»; «Создать и настроить» → редактор |
| `modal-request` | WS-22 | внутри `pool.spec.ts` + `modal-request.spec.ts` | manager · `logistics-ready` → «Запросить на рейс …» | «Рейс», «Срок», «Согласует …» → «Отправить запрос»; повтор → «Запрос уже отправлен» |
| `docs-start` | WS-11 | `apps/docs/e2e/docs-start.spec.ts` ← 11 §10 | `Документация.dc.html` · `#/start`; визуальная сверка `start`, `engineering`, `data-model` (mermaid), `permissions`, одного SQL-документа — на 390/800/1280/1440 | h1 «Ортус CRM — комплект для старта разработки v0.2»; неизвестный hash → `start`; пейджер «← Назад / Далее →» (Q-116); «Исходный файл» `_blank/noopener`; стили `S` 1:1; `labels` для всех 36 документов |
| `docs-search` | WS-11 | `docs-search.spec.ts` | `#/start` + ввод | ≥ 2 символов, 220 мс, `listbox` «Результаты поиска», «Найдено в N документах»/«Ничего не найдено», «N совп.», `<mark>`, top 15, подсветка после перехода (Q-114) |
| `docs-api` | WS-11 | `docs-api.spec.ts` | `#/api` | «76 путей · 118 операций · 199 схем» (копия 0.1), «Фильтр операций» 200 мс, пиллы методов, «Операций по фильтру «{f}» нет.», «Схемы · N» |
| `docs-permissions` | WS-11 | `docs-permissions.spec.ts` | `#/permissions` | h1 «Каталог прав», таблица, пиллы чувствительности, «Шаблоны ролей», «Переименования из прототипа» (10 строк), `details` «Показать файл» |
| `docs-frames` | WS-11 | `docs-frames.spec.ts` | `#/design-system`, `#/prototype`, `#/objects-variants`; MCP на 390/800/1280/1440 как `evidence/docs-frames/<w>/` | `iframe[title]`, `#dc-root .sc-host`, нет `.sc-logic-error`, консоль без `[dc-runtime]`, `browser_network_requests` без unpkg/jsdelivr/fonts.googleapis; «Объекты - варианты» 1440 px → скролл (Q-119); «Карта следующих итераций» (D-24) |
| `docs-layout` | WS-11 | `docs-layout.spec.ts` | 390/800/1280/1440 | < 960 бургер `aria-label="Разделы"` + скрим; ≥ 1280 и `toc.length > 2` → `aside` «Содержание» (Q-115); `tokens.css` подключён |


### 5.4 Карточки WS (границы, входы, выходы, тесты-первыми)

Полные брифы — `docs/plan/ws/WS-NN-<slug>.md` (девять разделов `orchestration.md` §1), генерируются из этих карточек + разделов «Инвентарь», «Инварианты», «Чек-лист приёмки», «Открытые вопросы» своих отчётов + матрицы §4.9 + рецептов §2.4. Все UI-карточки обязаны включать пункты Windows-dev (WS-01) и правило портов (§7.4).

#### Волна 0

**WS-00 analysis-fixes · quality · S · проверяет критик.** Владеет: `docs/plan/analysis/*` (точечные правки), `docs/plan/decisions.md` (дополнение D-25…D-52 и колонки WS), `docs/adr/0001-url-scheme.md`. Входы: 00 §5–§9; разделы «Исправления после критики» в 02, 04, 05, 06, 07, 08. Выходы: подтверждение, что E1–E6 внесены (07 §14 подписи персонажей, 08 J1/J17/§5.5, 06 #43 «52%», независимость 06 #34/#35, 02 #44 «8 из 10», 02 #51 с вычисленным значением); 04 §5.2 агрегаты помечены «снять с эталона» с процедурой (`tools/labels-dump.js` → `docs/plan/analysis/04-platform.md` «Как воспроизвести»); 2 пункта `therapist@t-lotos` в 06 §13; единый список `data-screen-label` в 01 §3 или 11; 05 §11 нумерация; D-25…D-52 из §10.3 в `decisions.md`; колонка WS для Q-01…Q-120 (§9.3). Срок: до запуска `tools/e2e-skeleton.js` (WS-07). Тесты-первыми: критик волны 0 сверяет каждую строку 00 §6/§9 с текстом отчёта (grep дословных формулировок).

**WS-01 repo-skeleton · infra · M.** Владеет: корень (кроме `design/`, `docs/plan/analysis`), `.github/`, `.husky/`, `.claude/settings.json`, `backend/go.mod`, `backend/.golangci.yml`, `frontend/package.json`, `pnpm-workspace.yaml`, `CLAUDE.md` (корень, `backend/`, `frontend/`), `CODEOWNERS`, `tools/{check-icu.js,allowlist-lint.js}`. Входы: 14-engineering «Структура репозитория», «Конвейер CI», «Соглашения кода»; 12 §3.2 R9–R11, R13, R18; 12 §3.6; 12 §8 п.2–3, 8, 25–28; D-20, D-23, D-38, D-42. Выходы: `git init` + `main`; pnpm 9 workspace, Node 22; `Makefile` (`gen/up/down/migrate/seed/dev/examples/test`); ESLint flat (typescript-eslint, react-hooks, jsx-a11y, testing-library, playwright), Prettier 100; husky/lint-staged (`gofmt`, `prettier`, `eslint --fix`); `.golangci.yml` v2 с `depguard` (allow-list обе стороны), `build-tags`; CI `lint → contract → unit → integration → isolation+concurrency → build → e2e → visual` + jobs `examples-fresh`, `allowlist-lint`, `check-icu`; `.claude/settings.json` (PostToolUse-формат R13, Stop → `node tools/verify-pages.js` — заглушка до WS-07); `CLAUDE.md` с таблицей «файл → что протухает» (R18), подмножеством `vercel-react-best-practices` (D-42), override «явный реестр вместо `init()`» (Q-105); CODEOWNERS (`authz/**`, `migrations/**`, `finance*`, `api/permissions.yaml`); Windows-onboarding в `README.md`: `pnpm install` в каждом worktree, два браузера (`pnpm e2e:install` + `pnpm mcp:install`), PowerShell 5.1 без `&&`, `core.autocrlf` + `.gitattributes eol=lf`, коммиты через `git commit -F` без BOM. Тесты-первыми: grep-тест «нет литералов `:5173`/`:3000` в e2e» (12 §6 п.4); «каждая заглушка несёт `Owner: WS-NN`»; тест порядка этапов CI; `golangci-lint config verify` (12 §6 п.13); `depguard` обе стороны (п.14); `check-icu`: `Intl.NumberFormat('ru-RU').format(84370)` содержит U+00A0, `'ё'.localeCompare('е','ru')` корректен, `['10','9'].sort(localeCompare ru numeric)`; порядок коммитов `test(` → `feat(` (п.21); BOM (п.22).

**WS-02 compose-stand · infra · S.** Владеет: `deploy/compose/` (кроме `profiles/e2e`, `keycloak/`). Входы: `design/docs/repo-skeleton/{docker-compose.yml,.env.example}`; 12 §3.2 R8, R17; 12 §8 п.23–24; Q-106, Q-107, Q-112. Выходы: `docker-compose.yml` (loopback-порты, healthcheck, образы по digest, `postgres:17`, `postgres-test` под `profiles:[test]` на 5433 tmpfs, `keycloak` под `profiles:[keycloak]`, `minio-init`/`seed` одноразовые вне `--wait`, mailpit, otel-collector); `.env.example` (`HTTP_ADDR=127.0.0.1:8080`, `APP_ENV`, `AUTH_PROVIDER=dev`). Тесты-первыми: `docker compose --profile dev config` валиден; `make up` → `pg_isready`, minio health, mailpit 8025 (`tools/stand-check.ps1`); Go-харнесс WS-07 «падает, не skip, без базы» (12 §6 п.11).

**WS-03 contract-core · contract · L · 2 ревьюера.** Владеет: `api/`, `tools/gen/split-by-tag.js`, `backend/internal/api/` (генерация), `frontend/packages/api-client/`. Входы: `design/docs/v0.1/ortus-openapi-v0.1.yaml`; 10 §4–§6, §7.3–7.4 (G-01, G-02, G-09, G-10, G-11, G-18, G-19 частично, G-20, G-22), §11; 09 §4.2–4.6, §5.1–5.3; 07 §6, §7; 04 §9 Q1–Q3; `design/docs/17-users-and-billing.md:132–153`, `18-branding.md:77–83`; D-17, D-33, D-34, D-35, D-47; Q-16, Q-45, Q-49, Q-82, Q-89, Q-90, Q-92, Q-94, Q-96. Выходы: §4.1 core, `permissions.yaml`, `errors.yaml`, `spectral.yaml`, `screens.yaml` (core), `examples/` (рукописные `ok`/`empty`/код на операцию), `make gen` (split по тегам → oapi-codegen strict по тегу, openapi-typescript, константы `PERM.*`/`ERR.*` Go+TS), `notimpl` для тегов без реализации, CI-job `contract`, changelog `api/CHANGELOG.md`. Тесты-первыми: Spectral + полный валидатор 3.1 (первый прогон — 10 §12 п.2); «каждый `x-permissions` ∈ каталог»; «каждый код `12-errors` ∈ enum»; «каждая изменяющая операция имеет `Idempotency-Key`»; «каждая операция имеет пример `ok`»; ajv на `examples/`; `screens.test.ts`; drift (`git diff --exit-code` после `make gen`); табличный Go-тест маппинга доменных ошибок → `Problem.code` (интерфейс-заглушка).

**WS-04 tokens-ui-contract · ui-kit · M.** Владеет: `packages/tokens/`, `packages/ui/src/{index.ts,types/,core/index.ts,domain/index.ts}`, `packages/ui/.storybook/`. Входы: `design/docs/design-system/{tokens.json,tokens.css,components.md}`; 11 §3, §4, §8, §11 Q1–Q5, §12 п.1–3, 15–17; 01 §22 п.9, 16–18; 02 §12 п.4; D-13, D-21, D-28. Выходы: §4.3, §4.4 (типы пропсов + стабы `data-stub`), Storybook-каркас, `brandVars/contrastW/fixAccent` реэкспорт из `@ortus/domain`. Тесты-первыми: снапшот генератора токенов; снапшот `tokens.css` против `design/docs/design-system/tokens.css` с allowlist `prototype`-токенов; «шрифты загружаются офлайн» (`document.fonts.check` трёх семейств); tsc стабов; «стаб не содержит литералов цвета»; `prefers-reduced-motion` и `:focus-visible` присутствуют в `tokens.css`.

**WS-05 domain-seed-port · domain · M.** Владеет: `packages/domain/`. Входы: `design/ortus/{models.js,mock-data.js,extra-data.js}`; 07 §8 (25 функций, ≥ 60 примеров), §9, §10, §11, §16 п.1–3, 16–18; 02 §12 п.13–15; 03 §16 п.4, 7; 06 §15 п.4; 09 §4.4, §5.3; 00 §10 п.5; D-19, D-25, D-27, D-30; Q-23, Q-30, Q-31, Q-54, Q-61, Q-66, Q-88, Q-98. Выходы: §4.5, §4.6. Тесты-первыми (имена из источника): `compat` 5 проверок (Hyundai Porter/Ford Transit несовместимы с Р-208); `legs`; `inspMissing` «Осталось: 1 фото»; `odoError` (+3000 предупреждение, меньше — ошибка); `validateExpense` (−500 → «Сумма должна быть больше нуля»; > 200 000); `bookingConflicts`/`freeSlots` (3 слота, шаг 0,25 ч, 08–20); `can`/`canEarnings` (`m-kotova` без назначений → `no_permission`; driver → блок); `rolePermKeys` 22/10/5/6; `brandVars('#1F6B52')` → `#195843/#E0EAE7/#EFF5F3`; `fixAccent('#FFD400')`; `calc` (02 §7.3); `validateDraft` 9 правил; `plural/rub/num` (U+00A0); `navForBase` для 8 персонажей (01 §8.3); `gateVM` тексты 01 §12; `bannersVM` 5 видов; снапшот сида (10 участников, 7 машин, 2 рейса, 23 участника Лотоса, 58 аккаунтов, 6 операторов, `Р-208`, `m-kotova`, `t-alta`, `t-lotos`); сценарии `empty-*` не ломают инварианты сида.

**WS-06 mock-adapter-port · domain · M (волна 0, pipeline после WS-05).** Владеет: `packages/adapter/src/mock/`, `packages/adapter/test/conformance/`. Входы: `design/ortus/api.js`; 07 §3, §4, §5, §6, §12, §14 (62 пункта с правкой E4), §15 Q13; 03 §11.4–11.6; 09 §10 п.19–20; D-26; Q-65, Q-86. Выходы: `createMockAdapter({seed, clock, delays, scenario})`; задержки инжектируемые (0 в тестах); `presets`: `logistics-ready`, `driver-booked`, `driver-on-route`, `defect-review`, `shift-submitted`, `shift-accepted`, `trial-ended`, `seats-full`, `storage-full`, `repair-on`, `kb-conflict`, `empty-review`, `empty-requests`, `no-trip`; conformance-suite — один `describe` на метод, параметризован фабрикой адаптера (`describe.each([mock, http])`), покрытие 51/51 методов и всех кодов 07 §6. Тесты-первыми: guards (`offline` после задержки; `subscription_restricted`; `module_off` «Модуль «Логистика» отключён»); `view()` для 8 персонажей (водитель видит 5 машин и 1 рейс без `earnings`; оператор — только `platform`); `opId` повтор → `'duplicate'`; `conflictNext`/`failUploadNext` одноразовые; `recordInspection` дедуп `tripId:kind:rev`; изоляция `t-lotos`; каждый пресет = результат соответствующего рецепта §2.4 (снапшот `db` после пресета равен снапшоту после UI-шагов — проверяется в WS-55).

**WS-07 e2e-harness-mcp · infra · M.** Владеет: `packages/e2e-kit/`, `apps/web/e2e/{fixtures,recipes/_base,visual/_helpers,smoke}/`, `apps/web/playwright.config.ts`, `apps/docs/playwright.config.ts`, `.mcp.json`, `tools/{verify-pages.js,e2e-skeleton.js,labels-dump.js,vendor/}`, `tools/design-preview.js` (флаг `--offline`), `backend/test/{harness.go,testdb/}`, `docs/plan/evidence/README.md`. Входы: `tdd-protocol.md` §3; `verification-protocol.md` §1–§4, §6; 12 §3.2 R1–R4, R16; 12 §6 п.1–16; 12 §8 п.4–7, 19–22; 01 §5, §6; 11 §7.4, §12 п.9, 18–19; 06b §20 п.6–8; D-22, D-26, D-29, D-32, D-45, D-49, D-50; Q-103. Выходы: `apps/web/playwright.config.ts` (`mobile-390`/`tablet-768`/`desktop-1440`, `locale: 'ru-RU'`, `timezoneId: 'Europe/Moscow'`, `PORT` из окружения, `reuseExistingServer: !CI && !E2E_FRESH_SERVER`, `reporter html open:never`, `snapshotPathTemplate` с `{platform}`, `webServer: [dev, design-preview --offline 4173]`, `E2E_MODE=mock|stand`); `apps/docs/playwright.config.ts` (`docs-390`, `docs-800`, `docs-1280`, `docs-1440`); фикстуры `demo` (персонаж по подписи, флаги, «Сбросить», `applyPreset`), `reference` (`openReference({persona, page, recipe, width})` по §2.3: `page.clock`, панель скрыта, снимок `#dc-root`), `clock`, `axe`; `recipes-runner` (один рецепт → две цели); хелперы `toMatchReference(key, …)`, `collectLabels()` (исключает `[data-a11y-extra]`); `tools/e2e-skeleton.js` (из «Чек-лист приёмки» отчёта `0N`/`06b` → `e2e/<key>.spec.ts`: один `test.fixme` на пункт, имя теста = текст пункта, + 6 обязательных пунктов §1.3 + пункты «Г-*» из §4.9); `tools/labels-dump.js` (структурная выборка с эталона для фиксации ожиданий, 04 §5.2); `tools/verify-pages.js` (по `git diff --name-only` → `routes/<key>/**`, `modals/**`, `shell/**`, `apps/docs/**` → ключи без свежего `docs/plan/evidence/<key>/` новее последнего коммита ветки → список; Stop-хук); `.mcp.json` (`@playwright/mcp` pin, `--browser chromium --headless --isolated --output-dir .playwright-mcp/<PORT>`), `mcp:install`, `e2e:install`; Go-харнесс (`//go:build integration|isolation|concurrency`, падает без базы, миграции лексикографически, `t.Parallel()`); тег `@smoke`. Тесты-первыми: 12 §6 п.2 (MCP видит «Панель демонстрации» на 4173); п.4–10 (конфиг); `harness.spec.ts` офлайн-эталон (§2.2); самопроверка `reference` vs `reference` = 0 diff на 390/1440; `collectLabels` на эталоне `home`/owner содержит подписи 01 §3; `toMatchReference('home')` на пустом приложении красный «по делу»; unit `verify-pages` на поддельном diff; unit `e2e-skeleton` на фикстуре чек-листа; 12 §6 п.11–12, 15–16 (Go-харнесс).

**WS-08 texts-dictionary · contract · M.** Владеет: `packages/texts/`. Входы: 00 §10 п.6; 00 §3.6; 01 §11–§14; 02 §5–§8; 03 §4.3, §11.6; 04 §4.7; 05 §11 п.6–7; 06 §4.3–4.6, §15 п.9; 06b §3, §18; 09 §4.7; 11 §4.20; D-37. Выходы: `src/{shell,gate,banners,toast,errors,company,branding,logistics-manager,logistics-driver,home,forms,tasks,platform,core,spa-cash,repair,repair-child,docs,screen-labels}.ts` — `as const` объекты с дословными строками («ё», знаки, U+00A0); `src/index.ts`. Контракт: ключи заморожены; владелец страницы добавляет ключи только в свой файл. Тесты-первыми: «каждый `REASON.text`/текст AccessGate совпадает с 01 §12» (фикстура — выдержки отчёта); «нет дубликатов значений между файлами»; «суммы содержат U+00A0»; «6 значений `data-screen-label` прототипа присутствуют дословно».

#### Волна 1

**WS-10 shell · shell · L.** Владеет: `apps/web/src/{app,shell,demo}/`, `apps/web/index.html`, `apps/web/vite.config.ts`, `e2e/{shell,demo-panel,guide,modal-confirm,modal-sheet}.spec.ts`, `e2e/visual/{shell,modal-confirm,modal-sheet}.*`, `e2e/recipes/{shell}.ts`, `e2e/visual/allowlist/{shell,modal-confirm,modal-sheet}.md`, `texts/shell.ts`. Входы: 01 целиком (§4 фрейм/брейкпоинты по `W`, §5 демо-панель, §6 гид, §7 boot/loading/loadErr, §8 маршрутизация, §9 `navForBase`/`brandNav`, §10 шапка, §11 баннеры, §12 AccessGate, §13 тосты, §14.1–14.2, 14.6–14.7, §16, §17 `applyBrand`, §20 чек-лист 38 пунктов, §21 Q5, Q8, Q12); 04 §4.3–4.6 (тёмная оболочка оператора); 11 §4.18; 08 §10 Q4–Q6; 12 §5 п.18 (один DOM); D-14, D-25, D-29, D-44; Q-35…Q-40, Q-43, Q-44. Выходы: TanStack Router file-based по §4.7; провайдеры (`AdapterProvider`, `QueryClient` без retry, `ClockProvider`); `VITE_ADAPTER=mock|http`; персонаж через демо-панель и `?persona=`; `AppShell` (sidebar 244 / rail 68 / нижняя 60 px — container queries по ширине фрейма); шапка (светлая/тёмная, колокольчик, поповеры «Уведомления»/«Профиль»); `navForBase` + `brandNav`, `gateVM`, `bannersVM` из домена; тост 4200 мс; `ModalHost` (`openConfirm/openAssign/openInvite/openCreateRole/openRequest/openSheet` — слот, регистрируется WS-14/22); `useRun(key, fn, okToast, {quiet})`; `useShell()`; `useOnline()` + `flush`-хук; `applyBrand`; демо-панель, «Путь проверки» и `DemoOnly` (только `mock`-сборка); skeleton «Загружаем рабочее пространство…» / `loadErr`; `PageFrame` (крошка, h1, `data-screen-label`); skip-link и фокус-ловушка с `data-a11y-extra` (D-29); 24 заглушки страниц под гейтами/баннерами; глобальное подключение `tokens.css` (тест). Тесты-первыми: e2e-скелеты `shell.spec.ts` (38), `demo-panel.spec.ts`, `guide.spec.ts` (8 шагов + 7 негативных дословно — только навигация и разметка; прохождение шагов — WS-55), `modal-confirm.spec.ts`, `modal-sheet.spec.ts`; unit `useRun` (`offline` → тост warn «Нет связи с сервером. Операция не выполнена.»); компонентные: 8 персонажей × стартовая страница; шапка оператора `#1C2A26` без колокольчика; нижняя навигация 3 + «Ещё»; `Escape`; визуальная сверка оболочки 8 персонажей × 3 ширины.

**WS-11 docs-site · docs-site · L.** Владеет: `apps/docs/` (включая `public/design/` через `tools/sync-design.js`), `tools/sync-design.js`, `texts/docs.ts`, `apps/docs/e2e/**`, `apps/docs/e2e/visual/allowlist/*.md`. Входы: `design/Документация.dc.html`; `design/ortus/roadmap.js:3–132`; 11 §6.1–6.11, §7, §10, §11 Q8–Q16, §12 п.4–14, 19; 01 §15, §22 п.15; D-16, D-24; Q-114…Q-119. Выходы: React+TS читалка (marked, js-yaml, mermaid локально); `DOCS` как данные (36 записей) + новый документ «Карта следующих итераций» из `roadmap.js` (9 карт: `title/stage/purpose/screens/components/rules/api`, D-24); `renderPerms`/`renderApi` чистые; `public/design/` с локальным React через `__resources` и `fonts.css`; `tokens.css` подключён глобально. Тесты-первыми: unit `renderPerms` на реальном `11-permissions.yaml` (h2 «Шаблоны ролей», таблица 10 строк); `renderApi(spec,'')` → «76 путей · 118 операций · 199 схем»; `parseRoute('#/nope')` → `start`; `BASENAMES` ссылки; «читалка не ссылается на `ROADMAP` прототипа» (grep-тест); e2e-скелеты 6 ключей по 11 §10 + §5.3; визуальная сверка с `127.0.0.1:4173/Документация.dc.html` на 390/800/1280/1440 для `start`, `engineering`, `data-model`, `permissions`, `tenant_0001_core.sql`; `labels` для всех 36 документов; MCP-проходка фреймов на 4 ширинах.

**WS-12 ui-core · ui-kit · M.** Владеет: `packages/ui/src/core/`. Входы: 11 §4.1–4.5, 4.7–4.9, 4.14–4.17, §5; 02 §12 п.4; 01 §22 п.16; D-13, D-28, D-29. Выходы: компоненты §4.4 (WS-12) с состояниями hover/focus/active/loading/disabled, Storybook-истории, axe. Тесты-первыми: Testing Library по ролям («кнопка «Подключить» недоступна, причина в `aria-describedby`»); клавиатура (Tab/Space/Enter/Escape; фокус-ловушка `Dialog`); `Toast` исчезает через 4200 мс (fake timers); axe serious/critical = 0; визуальная сверка секций витрины `#buttons`, `#fields`, `#status`, `#access`, `#data` с `Дизайн-система.dc.html` на 4173 (11 §12 п.15).

**WS-13 ui-domain · ui-kit · M.** Владеет: `packages/ui/src/domain/`. Входы: 11 §4.6, 4.10–4.13, 4.16, 4.19; 03 §10.1, §5.3; 06 §11.2; 05 §5.5; 04 §10 п.13; 06 §15 п.10; 02 §6.7; D-28. Выходы: компоненты §4.4 (WS-13) + истории + axe. Тесты-первыми: `PhotoSlot` 5 состояний × `aria-valuenow`, `aria-label` «Спереди: Не снято. …»; `LoadBar` > 100 % → danger текстом; `DecisionQueue` порядок и «показано 8 из N»; `ReadinessBar` проценты текстом; `DataTable` `<th scope>`, пусто/скелетон/ошибка, скролл на 390; `RoleEditor` «Роль с функцией «Водитель» не может содержать начисления» (`api.js:299`).

**WS-14 modals-people · pages · S.** Владеет: `apps/web/src/modals/people/`, `e2e/modal-{assign,invite,createRole}.spec.ts` + visual/labels/allowlist, `e2e/recipes/modals-people.ts`. Входы: 01 §14.3–14.5; 02 §6.9–6.11, §11, §12 п.11, 18; D-27 (дефолты Лотоса); Q-15, Q-23. Выходы: три диалога, регистрируемые в `ModalHost`. Тесты-первыми (фейк адаптера): «Назначить» → `assign({memberId, roleId, scope, until})`; `role_conflict` → inline дословно; приглашение при 10/10 → «Свободных мест нет: занято 10 из 10…»; «Приглашение действует 7 дней»; Escape; лист на 390; Лотос — первая фирма/роль организации.

**WS-40 backend-platform · backend · M.** Владеет: `backend/cmd/api/` (кроме `router.go` после волны 1), `backend/internal/platform/{httpx,problem,requestid,session,tenantctx,idem,clock,pipeline}/`. Входы: 10 §3.2–3.5, §8, §9, §12 п.16–17; 12 §3.2 R5–R7; 12 §5 п.1–8, 22–24, 30; 09 §5.1, §5.6; 13-backlog S1-02, S1-05 (заглушка), S1-07, S1-25; D-18, D-25, D-31, D-47; Q-87, Q-101, Q-112. Операции: `getMyContext` (с `tenants[]`, `lastTenantId`), `selectTenant`, `listMyEvents`, `devLogin`, `logout`, `getCsrf`, health. Выходы: `pipeline.Mount`, `tenantctx.FromContext` без fallback, `problem.From(err)` в одном месте, `idem.Middleware` (namespace tenant+actor+operation+key, Q-87), `session.Manager` (12h, `ortus_sid`), `devLogin` только при `AUTH_PROVIDER=dev`, middleware `X-Test-Scenario` (D-31) только при `APP_ENV=e2e`, `Cache-Control: private, no-store` + `X-Request-Id`. Тесты-первыми: контрактные тесты тега `me`/`auth` с `t.Skip` первым коммитом; четыре 404 `bytes.Equal` (неизвестный тенант/чужой/выключенный модуль/несуществующий роут); cookie `HttpOnly`, `SameSite=Lax`, 302/401 по `Accept`; CSRF 403 `csrf_failed`; `Problem` формат; `Idempotency-Key` повтор с другим payload → 409 `idempotency_key_reused`; `X-Test-Scenario` игнорируется при `APP_ENV=prod`.

**WS-41 migrations · backend · M · 2 ревьюера.** Владеет: `backend/migrations/`, `backend/cmd/migrate/`, `backend/internal/platform/migrate/`. Входы: `design/docs/db/*.sql` (5 файлов); `design/docs/10-data-model.md`; 09 §3, §6, §7.1–7.2, §9 DP-10, DP-13, DP-14; D-06, D-38, D-51; Q-80, Q-90, Q-99, Q-104, Q-106. Выходы: goose control 0001–0003, tenant 0001–0003 (разрывы), контроллер canary → партии (`tenant_routing.schema_version`), `make migrate`, роли БД `migrator/api_runtime/worker_runtime/provisioner`. Тесты-первыми (testcontainers PostgreSQL 17): up/down каждой миграции на двух tenant DB разных версий; `btree_gist`; `EXCLUDE` брони (2 вставки → 1 ошибка); у `api_runtime` нет DDL; canary-отказ останавливает партию.


#### Волна 2 — страницы

Общее для WS-20…WS-32: владеют `apps/web/src/routes/<group>/**` (VM — чистые функции в `vm/`), своими `texts/<domain>.ts`, `e2e/<key>.spec.ts`, `e2e/recipes/<key>.ts`, `e2e/visual/<key>.{visual,labels}.spec.ts`, `e2e/visual/allowlist/<key>.md`. Входы всегда включают разделы «Инвентарь», «Инварианты», «Чек-лист приёмки», «Открытые вопросы» своего отчёта, строки §4.9 и рецепты §2.4. Потребляют `AdapterPort` через `useRun`/`use*Query`, `@ortus/ui`, `@ortus/texts`, `ModalHost`. Первый коммит — e2e-скелет из `tools/e2e-skeleton.js`. Ранний старт — только `vm/` + unit-тесты до слияния WS-10/12/13 (§6.4).

**WS-15 contract-delta · contract · M · 2 ревьюера.** Владеет: `api/openapi/*` (после закрытия WS-03), `api/permissions.yaml`. Входы: 10 §7.1–7.4 (G-05…G-08, G-12…G-16, G-19, G-21); 07 §7; `design/docs/17-users-and-billing.md:132–153`, `18-branding.md:77–83`, `19-construction.md:104–163`; 10 §11 Q4–Q8, Q14–Q16; 13-backlog S1-10; D-33, D-48. Выходы: §4.1 delta с примерами, `x-adapter-method` на всех операциях (§4.10), `screens.yaml` для всех 24 ключей, changelog. Тесты-первыми: те же, что WS-03 + «каждый метод `AdapterPort` имеет ≥ 1 операцию с `x-adapter-method`» + «каждый ключ §5.3 есть в `screens.yaml`».

**WS-20 company · pages · L.** Владеет: `routes/company/{modules,users,billing}/`, `texts/company.ts`, ключи `modules`, `users`, `billing`, рецепты `trial-ended`, `seats-full`, `storage-full`. Входы: 02 §5 (`omVM`, `toggleModule`, `applyQuota`, `confirmTrialEnd`), §6 (4 вкладки, `roleEditorVM`, `accessVM`), §7 (`tierList/calc`, заявки, отзыв), §9, §10 #1–47, §11, §12; 09 §4.7, §8 P-01…P-03; 08 J1, J5, J7, J8, J9, J17; 00 E2; Q-12…Q-15, Q-20…Q-23, Q-29, Q-30. Тесты-первыми: unit `omVM` (holders n=1, зависимости, `history`), `roleEditorVM` (системная read-only; `checked && disabled`), `accessVM` 4 пресета дословно, `billingVM` (9→10, «мест нет», pending SR-12 в Лотосе); экранные (in-memory адаптер, D-39): trial/restricted (кнопки заблокированы), Лотос (23 участника, v3, без логистики); e2e 02 #1–47; AC-11 UI-часть; AC-12 UI-часть (диалог отключения с активным рейсом по пресету `driver-on-route`).

**WS-21 branding · pages · M.** Владеет: `routes/branding/`, `texts/branding.ts`, ключ `branding`. Входы: 02 §8 (`:1248–1443`), §10 #48–64, §12 п.6, 13, 16; 01 §17; 08 J18; `design/docs/18-branding.md`; Q-24…Q-28. Контракт: стаб полного owner-меню из `navForBase` для редактора меню (02 §12 п.6). Тесты-первыми: unit `brandingVM` (1–60/≤ 16; 5 `BR_LOCK`; `#FFD400` → 4.5:1); экранные: PNG ≤ 1 МБ через `setInputFiles`; Лотос `#7A3E79`/«Лотос»/«сеанс»/версия 3; e2e #48–64; BR-T2.

**WS-22 logistics-manager · pages · L.** Владеет: `routes/logistics/manager/{fleet,pool,review}/`, `texts/logistics-manager.ts`, ключи `fleet`, `pool`, `review`, `modal-request`, рецепты `shift-accepted`, `empty-review`. Входы: 03 §5, §6 (+ 01 §14.6), §7, §4.3–4.4, §14 #1–17, #41–47, §15 Q5, Q13, Q16–17; 08 J1, J4–J6; Q-49, Q-55, Q-58. Тесты-первыми: unit `fleetVM` (причины compat дословно, 86 %/69 %), `poolVM`, `reviewVM` (бейдж `submitted+defect_review`; `earnings` по `canEarnings`); экранные: `conflictNext` → тост «Конфликт: …» + обновление; гейты; «Передать в навигатор · интеграция не подключена» disabled; e2e 03 #1–17, #41–47; AC-05 UI-часть (блок «Начисление водителю за рейс» только по праву).

**WS-23 logistics-driver · pages · L.** Владеет: `routes/logistics/driver/{today,cars,outbox}/`, `texts/logistics-driver.ts`, ключи `today`, `cars`, рецепты `driver-booked`, `driver-on-route`, `defect-review`, `shift-submitted`. Входы: 03 §8, §9, §10, §11.3, §13, §14 #18–40, #48, §15 Q2, Q6, Q9–Q12; 08 J2, J3, J5; 00 §7 (03: `bookLabel`/disabled-подписи); 07 §16 п.7–9; Q-46…Q-48, Q-50…Q-54, Q-56. Тесты-первыми: unit `driverVM` (`act.*` по состоянию; `inspMissing` → список), `photoVM` (5 состояний), outbox-редьюсер (`local → sending → error`, повтор с тем же `opId`); экранные: офлайн — бронь/выезд заблокированы, расход/сдача «сохранено на устройстве», `flush` при `online`; `failUploadNext` → «Ошибка загрузки» + «Повторить»; `conflictNext` → «Конфликт брони» + «Обновить список»; критический дефект → `defect_review`; e2e 03 #18–40, #48 + J3; AC-04 UI-часть.

**WS-24 home · pages · M.** Владеет: `routes/home/`, `texts/home.ts`, ключ `home`. Входы: 05 §5, §9.1 #1–11, §10 Q2, Q6–Q7, §11 п.2, 10–11, 19–21; 00 E1; Q-61, Q-64, Q-73. Тесты-первыми: unit `homeVM` (danger→warn→info→neutral; max 8 + «показано 8 из N»; `doneN` = 1; источники SPA/ремонт без `moduleOn` — Q-64); экранные: manager без роли — пусто; приветствие по инжектируемым часам; шаг 2 → `openAssign` с `m-kotova`; e2e #1–11.

**WS-25 forms · pages · M.** Владеет: `routes/forms/`, `texts/forms.ts`, ключ `forms`. Входы: 05 §6, §9.2 #12–29, §10 Q1, Q9, Q11, Q15, Q17, §11 п.3, 16–18, 22, 26; Q-60, Q-65, Q-67, Q-69, Q-71. Тесты-первыми: unit `formsVM` (dirty по `JSON.stringify`, дифф «Убрано», `showIf`, мемоизация), `editForm`/`publishForm`; экранные: manager чип «Только просмотр · нет права «Настраивать»»; Лотос — пустой список без текста (D-27); «Новая форма из шаблона · следующий шаг» disabled; e2e #12–29 + негативный.

**WS-26 tasks · pages · M.** Владеет: `routes/tasks/`, `texts/tasks.ts`, ключ `tasks`. Входы: 05 §7, §9.3 #30–47, §10 Q3–Q5, Q10, Q16, §11 п.4, 8, 16, 23–24; 07 §16 п.24; Q-62, Q-63, Q-66, Q-68. Тесты-первыми: unit `tasksVM` («Мои задачи» по актёру; бейдж по id), переходы по `WORKFLOWS[flow]`, блок при незакрытом чек-листе (текст сервера), «⚡ из ответа формы», ссылки `response→forms`, `trip→review|fleet`; экранные: foreman `leads` без проекта, «Нет проектов в вашей области», h1 «Задачи»/«Заявки»; e2e #30–47.

**WS-27 platform-orgs · pages · M.** Владеет: `routes/platform/orgs/{tenants,usage,requests}/`, `texts/platform.ts`, ключи `tenants`, `usage`, `requests`, рецепт `empty-requests`. Входы: 04 §4.7, §5.1–5.3, §8 #1–25, §9 Q1–Q8, Q13–Q15, §10 п.5–6, 13; 00 §7 (04 — агрегаты снять с эталона, WS-00); D-35, D-37; Q-01…Q-07, Q-10, Q-18. Тесты-первыми: unit `opVM` (пороги 85 %/80 % — Q-07), `usageVM` (значения из снапшота сида, зафиксированные WS-00), `requestsVM`; экранные: таблица `usage` 860 px со скроллом; `data-screen-label`; e2e #1–25.

**WS-28 platform-accounts-plans · pages · M.** Владеет: `routes/platform/{accounts,plans}/`, ключи `accounts`, `plans`. Входы: 04 §5.4, §5.5, §8 #26–46, §9 Q9–Q12, Q15, §10 п.10–12, 15; Q-08, Q-11, Q-98. Тесты-первыми: unit `accountsVM` (58 аккаунтов детерминированно, фильтры), `platformOrgVM` (нельзя менять свою роль/отключать себя; минимум владельцев по D-46), `plansVM.validateDraft` 9 правил + `calc`; экранные: поповер с клавиатуры; таблица 760 px; e2e #26–46.

**WS-29 core-modules · pages · M.** Владеет: `routes/core/{calendar,knowledge,data,files}/`, `texts/core.ts`, ключи `calendar`, `knowledge`, `data`, `files`, рецепт `kb-conflict` (allowlist `no-reference`). Входы: 06 §5–§8, §13 #1–25, §14 Q1–Q4, Q11–Q12, Q15, §15 п.8, 10, 16; 08 J11, J15, J16; 00 G2 (пункт `therapist@t-lotos` «Календарь»); Q-75, Q-76. Тесты-первыми: unit `calVM` (`busySpan`, clamp), `kbVM` (приватные только владельцу), `dataVM` (`localeCompare ru numeric`), `filesVM`; экранные: конфликт версии БЗ через пресет; таймлайн 640 px на 390; «Выгрузить» disabled без `data.export`; AC-14 UI-часть; e2e #1–25.

**WS-30 spa-cash · pages · M.** Владеет: `routes/spa-cash/{spa,cash}/`, `texts/spa-cash.ts`, ключи `spa`, `cash`. Входы: 06 §9, §10, §13 #26–37, §14 Q3, Q5–Q6, Q8–Q9, Q11; 00 G2 (`therapist@t-lotos` «Мой день»), E6; 08 J12; Q-72, Q-79. Тесты-первыми: unit `spaVM`, `cashVM.sign()`/баланс; экранные: `busy` блокирует «Провести в …» (Q-72, без изменения снимка); Лотос пустой журнал; `therapist@t-lotos` «Мой день»; сторно закрывается и при ошибке; e2e #26–37 + 2 новых.

**WS-31 repair-object · pages · M.** Владеет: `routes/repair/{index,overview,works}/`, `texts/repair.ts`, ключ `repair`, рецепт `repair-on`. Входы: 06 §11.1–11.4, 11.6, §13 #38–46, §14 Q7, Q10, Q13, Q16–Q17, §15 п.7, 15, 17, 19; 06b §15 (сводка `onStatus`), §20 п.4 (сводка — селектор, не колбэк), п.5 (права), п.12; `design/docs/19-construction.md`; 08 J13; Q-73, Q-77, Q-78, Q-81. Контракт (публикуется в брифе до кода): контейнер `RepairChild` `{tab, onTab}` + состояние дочернего макета в сторе рядом с `repair.object` (06b §20 п.4), сводка `repairChildSummary(state)` как селектор; до слияния WS-32 — стаб с фиксированной сводкой 06b §18 #1. Тесты-первыми: unit `repairVM` (`pc()` 48/52; `canFin` по `finance.read`; очередь из сводки — 4 пункта 06b §18 #1); экранные: гейт по умолчанию; «Решений не требуется» при пустой сводке; прораб — форма, владелец — приёмка; AC-13 UI-часть (отметка с бригадой не меняет «Пользователи и роли»); e2e #38–46.

**WS-32 repair-child · pages · L.** Владеет: `routes/repair/child/{schedule-lib,gantt,panels,measure-estimate,chain,integration}/` (деление 06b §20 п.1 a–f), `texts/repair-child.ts`, ключ `repair-tabs`, рецепты `repair-tabs-*`. Входы: `design/Ремонт и стройка.dc.html:72–461, 619–901`; **06b целиком** (§3 инвентарь, §4 каркас, §6–§14 вкладки, §15 сводка, §17 инварианты, §18 чек-лист #1–5, #10–47, §19, §20); 06 §11.5; D-36; Q-74. Выходы: 9 вкладок с локальным состоянием в сторе (без API), сводка-селектор для WS-31; инъекция `D0=2026-10-05`, `TODAY=15`, `HOL=[30]` через конфиг (06b §20 п.8). Порядок единиц внутри WS: (a) библиотека расписания → (d) «Замер»+«Смета» → (b) Гант → (c) панели → (e) цепочка «Документы…Кабинет» → (f) интеграция (06b §20 п.12). Тесты-первыми: unit календаря `isW/fw/pw/addW/subW/shW/wdIn`, `gsched` (прямой/обратный проход, резерв, критический путь), `gnorm`, `issuesOf`, тексты черновика, окна «Ближайшие 3 недели», площади (46,8/134,2), `SEC` → 413 379 ₽ / 124 014 / 111 612, `progress`, `fin` (51 600 → 121 800 → 154 200 → 166 300), прогноз 27.11 → 01.12 → 03.12 (06b §20 п.2–3); e2e-скелет из 06b §18 (#6–9 исключены со ссылкой на D-36); drag по 06b §20 п.7; визуальная сверка каждой вкладки на 390/1440 с эталоном (embedded через «Объекты», 06b §20 п.11) + 4 обязательных снимка «График»; MCP evidence по 06b §20 п.9.

#### Волна 2 — backend и интеграция

**WS-42 authz · backend · L · 2 ревьюера.** Владеет: `backend/internal/platform/{authz,scopeddb}/`, `backend/test/isolation/{fixtures,access_test.go}`. Входы: 09 §4.1–4.8, §6, §10 п.9–11, 14–15; 10 §3.4, §9; `design/docs/15-quality-security.md` «Фикстуры изоляции»; 07 §8.2 (`can`/`canEarnings` как спецификация); 13-backlog S1-11, S1-14, S1-15; DP-05, DP-06; D-46. Контракты: `authz.Permit`, `authz.ScopeQuery`, `ReadFields/WriteFields`, `ExplainAccess`, `PolicyVersion`; `scopeddb.For(tenant)` (`depguard`). Тесты-первыми: контрактные `t.Skip` для `explainAccess`; unit `permit()` на матрице «актор × действие × область» (`m-kotova` без назначений → `forbidden_action`; driver → `function_blocked` на `fleet.earnings.*`; «изменять Москва-1» + «читать Самара-2» ≠ «изменять обе»); `scopeQuery` (чужая фирма → 0 строк); `policy_version` +1; изоляционная матрица 200/403/404 для `/me/context`, `listMembers`, `listRoles` (растёт с каждым эндпоинтом); покрытие ≥ 90 %.

**WS-43 control-tenants · backend · M.** Владеет: `backend/internal/control/{tenants,subscriptions,audit}/`, `backend/test/isolation/control_test.go`. Входы: 13-backlog S1-02, S1-04; 04 §9 Q1–Q5; 09 §3.1–3.2; 10 §5.2; D-35; Q-01, Q-02, Q-04…Q-07, Q-10, Q-17. Операции: `listPlatformTenants`, `getPlatformTenant`, `updatePlatformTenant`, `getPlatformSubscription`, `updatePlatformSubscription`. Тесты-первыми: контрактные `t.Skip` по тегу; статусы 8 → карта в 4 чипа; `suspend` без `reason` → 422; аудит control DB (`by`, `reason`); оператор не читает tenant-таблиц (`depguard` + тест).

**WS-44 access-people-org · backend · L.** Владеет: `backend/internal/modules/{access,org,people}/`, `backend/migrations/tenant/` (нет — только `drafts/` при необходимости), `backend/test/isolation/access_people_test.go`, `test/concurrency/access_test.go`. Входы: 13-backlog S1-06, S1-08, S1-09, S1-11…S1-16; 10 §5.4; 09 §3.3, §6, §10 п.13, 16; 02 §6, §9; 07 §4.4; DP-17; Q-19, Q-92, Q-100. Операции: `listMembers`, `getMember`, `updateMember`, `inviteMember`, `revokeInvitation`, `acceptInvitation`, `listGroups`, `listRoles`, `getRole`, `createRole`, `updateRole` (If-Match), `deleteRole`, `listAssignments`, `createAssignment`, `revokeAssignment`, `listOrgUnits`, `createOrgUnit`, `updateOrgUnit`, `getOrgUnit`, `explainAccess`. Тесты-первыми: контракт на каждую операцию (`seats_exhausted`, `separation_of_duties_conflict`, `last_owner_required`, `delegation_exceeds_grant`, 412/428); изоляция (чужой `memberId` → 404); конкурентность «два приглашения на последнее место → 1 успех», «два отзыва последнего владельца → один 409 под `FOR UPDATE`».

**WS-45 modules-files-services · backend · L.** Владеет: `backend/internal/modules/{modulesreg,files}/`, `backend/internal/platform/{storage,events,audit}/`, `backend/cmd/worker/`, миграции tenant 0004–0005, `test/isolation/{modules,files}_test.go`. Входы: 13-backlog S1-17…S1-26; 10 §3.5–3.7, §5.5, §5.7, §12 п.19; 09 §5.5, §10 п.12–14, 21; 07 §12.1 (draining, `startedWork`), §16 п.15; Q-65, Q-86. Операции: `listModuleCatalog`, `getModuleInstallation`, `setModuleInstallation`, `getModuleSettings`, `updateModuleSettings`, `getStorageUsage`, `requestStorageChange`, `initiateUpload`, `completeUpload`, `getFile`, `getFileDownload`, `listFiles`, `listMyEvents` (серверная лента). Тесты-первыми: отключение модуля с активным рейсом → предпросмотр, новые 403 `module_read_only`, активный завершается (AC-12 серверная часть); `tenant_read_only` на мутациях, чтение/экспорт разрешены (AC-11 серверная часть); upload: резерв → PUT → complete 202 → scan → ready/rejected (MinIO testcontainer), 409 `quota_exceeded`, 413; квота условным `UPDATE`; outbox lease/retry/dead-letter; событие с `sensitive: earnings` не доставляется водителю; 100 повторов `completeUpload` → 1 эффект.

**WS-51 http-adapter-msw · integration · M (pipeline: core после WS-06, delta после WS-15).** Владеет: `packages/adapter/src/{http,msw}/`, `apps/web/mocks/`, `tools/gen/gen-examples.js`, CI-job `examples-fresh`, `screens-http` (экранные тесты против http+MSW, D-39). Входы: 07 §5, §7, §16 п.10; 10 §7.1–7.3, §12 п.13; 12 §3.2 R3; `tdd-protocol.md` §3 TS; §4.10 этого плана; D-39, D-43; Q-82, Q-83, Q-85. Выходы: `createHttpAdapter({baseUrl, getCsrf})` (openapi-fetch, `Idempotency-Key = opId`, `If-Match`, `Problem` → `ApiError` через `errors/map`, составные вызовы, `GET /me/context` после мутаций); сценарный сервер `createScenarioServer(mockAdapter)` — OpenAPI-фасад с `view()`-фильтрацией и `/__scenario/{setActor,setFlag,preset,reset}`; MSW-хендлеры `handlersFromExamples(spec)` + режим «MSW поверх сценарного сервера»; `make examples` (снимки `ok`/`empty` на сиде) + ajv + свежесть; `VITE_ADAPTER=http`. Тесты-первыми: на каждый из 51 метода — тест по MSW (тело запроса, коды, `Problem.code` → `ApiError.code`); conformance-suite WS-06 против `http + MSW(сценарный сервер)` зелёная; каждый код `errors/map` покрыт; `screens-http`: экранные тесты WS-20…32 проходят с `VITE_ADAPTER=http` (CI-job после слияния страниц).

#### Волна 3

**WS-46 fleet-core · backend · M.** Владеет: `modules/fleet/{vehicles,routes,reservations}/`, `modules/sched/`, `internal/domain/fleetrules/`, `test/isolation/fleet_test.go`, `test/concurrency/fleet_test.go`. Входы: 13-backlog S2-01…S2-03, S2-13; 03 §11–§12; 07 §8.3; 09 §6; AC-03; Q-47, Q-48, Q-50, Q-57. Операции: `listVehicles`, `createVehicle`, `listRoutes`, `createRoute`, `listReservations`, `reserveVehicle`, `releaseReservation`, `assignTripVehicle`. Тесты-первыми: контрактные `t.Skip`; `fleetrules_test.go` = зеркало примеров 07 §8.3 (`compat`, `legs`); 100 горутин → 1×201 + 99×409 `reservation_overlap`; hold-expiry; машина чужой фирмы → 404.

**WS-47 fleet-shift · backend · L.** Владеет: `modules/fleet/{inspections,trips}/`, миграция tenant 0006. Входы: S2-04…S2-09; 03 §8, §10; 07 §3.4, §16 п.15; 03 §15 Q7; AC-04; D-31, D-33; Q-49, Q-51, Q-53, Q-56. Операции: `getInspectionChecklist`, `submitInspection`, `startTrip`, `createTripExpense`, `listTripExpenses`, `finishTripRoute`, `returnTrip`, `decideInspectionDefect`, `reviewInspection`. Тесты-первыми: 4 фото из 5 или блокирующий дефект → `startTrip` 409; старт атомарно потребляет бронь; `odoError`/`validateExpense` серверные копии; идемпотентность расходов/сдачи; второй осмотр `return` после rework (ревизия); событие `fleet.inspection.submitted.v1` в outbox без restricted-полей; `X-Test-Scenario: reservation_overlap|upload_failed` при `APP_ENV=e2e`.

**WS-48 fleet-review-earnings · backend · M · 2 ревьюера.** Владеет: `modules/fleet/{review,expenses}/`, `modules/finance/`. Входы: S2-10…S2-12; 03 §7; 07 §5; 09 §10 п.14; AC-05; Q-55. Операции: `reviewTrip`, `reviewTripExpense`, `getTripEarnings`, `setTripEarnings`. Тесты-первыми: изоляция AC-05 по каналам (Trip DTO, `/earnings`, Data Hub, экспорт, уведомления); «вернуть по разделам» (`rework` + `steps`); машина освобождается только при `accepted`; начисление в транзакции приёмки.

**WS-49 fleet-pool · backend · M.** Владеет: `modules/fleet/pool/`. Входы: S2-14; 03 §6; 09 §4.8; AC-06; 10 §11 Q14; Q-58. Операции: `listAvailableDrivers`, `requestDriverTransfer`, `listDriverTransfers`, `getDriverTransfer`, `decideDriverTransfer`. Тесты-первыми: approve → бронь + grant `source='transfer'` + событие в одной транзакции; после срока → 404; повтор → «Запрос уже отправлен».

**WS-50 datasets · backend · S.** Владеет: `modules/data/`. Входы: S2-16; 10 §5.6, §12 п.25; 06 §7; AC-01, AC-14. Операции: `listDatasets`, `queryDataset`. Тесты-первыми: count/агрегаты не выдают чужие строки; `earnings` отсутствует для водителя; фильтры только AND; AC-14: суммы набора «Расходы» = сумме `trip_expenses` по области.

**WS-52 go-seed · backend · S.** Владеет: `backend/cmd/seed/`. Входы: 07 §9; 09 §7.3, §10 п.17–18, 24; `packages/domain/seed/snapshot.json`; 08 §11 п.16–17; D-19, D-30, D-46. Тесты-первыми: равенство ID TS ↔ Go; идемпотентность; `Р-208` ↔ номер из `core.counters` (карта в снапшоте); видимые поля 11 страниц S0–S2 = прототипу (`finance.read` у «Марина Котова» как явное назначение).

**WS-53 e2e-full-stand · integration · M.** Владеет: `deploy/compose/profiles/e2e`, `.github/workflows/e2e-full.yml`, `apps/web/e2e/{_stand,fixtures/phase2}/`, `e2e/mock-vs-http.spec.ts`, `backend/test/contract/` (Schemathesis), `docs/plan/evidence/*/phase2/`. Входы: `verification-protocol.md` §2; 12 §7 Q11; 12 §8 п.23–24; 09 §10 п.20, 24; D-31, D-41, D-46, D-52. Выходы: `npm run e2e:full` (compose up → migrate → seed → Playwright с `VITE_ADAPTER=http`, `E2E_MODE=stand`, те же spec'и); фикстура `phase2` (`offline` → `context.setOffline(true)`, `conflictNext`/`failUploadNext` → заголовок `X-Test-Scenario` при `APP_ENV=e2e`); повторная MCP-проходка 11 страниц S0–S2 с evidence `phase2/`; `mock-vs-http.spec.ts` на 10 ключевых командах (расхождение `ApiError.code` — дефект); Schemathesis 0 падений; CI nightly full / `@smoke` на PR. Тесты-первыми: smoke «Путь проверки» (WS-55) в обоих режимах; расхождение = дефект адаптера/backend или запись allowlist `mode: stand` с D-ID.

**WS-54 keycloak-oidc · backend · M · 2 ревьюера (по D-41).** Владеет: `backend/internal/platform/session/oidc/`, `deploy/compose/keycloak/`, `e2e/auth-keycloak.spec.ts`. Входы: S1-05, S1-06; 10 §3.2, §8, §12 п.22–23; 12 §3.2 R5, §6 п.23–25, §7 Q2; D-03, D-18; Q-102, Q-109. Операции: `startLogin`, `authCallback`, `logout` (реальные). Тесты-первыми: `oidctest`-провайдер; cookie-свойства; bearer + cookie → 401; `@keycloak` smoke вход владельцем.

**WS-55 journeys-e2e · quality · M · исполнитель ≠ авторы экранов (12 §8 п.18).** Владеет: `apps/web/e2e/journeys/J01…J18.spec.ts`, `e2e/guide-path.spec.ts`, `e2e/recipes-vs-presets.spec.ts`. Входы: 08 §6 (после правок E1–E3), §9; 01 §6; §2.4 этого плана; 12 §5 п.13. Тесты-первыми: J1–J18 дословно (Given/When/Then), «Путь проверки» 8 шагов + 7 негативных через UI (без пресетов), тег `@smoke`; `recipes-vs-presets`: `db` после рецепта равен `db` после пресета (WS-06); оба режима (`E2E_MODE`), стенд-пункты S3+ — `fixme` по §1.4 (е).

**WS-56 provisioning · backend · M · 2 ревьюера.** Владеет: `backend/internal/control/provisioning/`, `backend/cmd/provisioner/`. Входы: S1-01, S1-03; 10 §3; 09 §10 п.3, 12; AC-02; D-48. Операции: `createPlatformTenant`. Тесты-первыми: интеграция «создать тенант → БД и sentinel → миграции → `GET /me/context` в новой БД»; сага с идемпотентностью; AC-02 (сессия A с `tenantId` B → 404, пул B не открывается).

#### Волна 4 (по готовности; определение заготовки §1.4)

**WS-60 be-forms · L** — `modules/forms/`, миграция 0007: формы, неизменяемые версии, публикация, ответы по версии (AC-09), публичные токены (AC-08), `listFormAutomationLog`; смена типа поля → `id-vN`. **WS-61 be-tasks · M** — `modules/tasks/`, 0008: проекты, задачи, `transitionTask` с guard чек-листа → 409 `invalid_transition`, комментарии, `assignee=me`, процесс `leads` для прораба. **WS-62 be-knowledge · S** — `modules/knowledge/`, 0009: пространства, страницы, версии, `access='owner'`, 412. **WS-63 be-calendar · M** — `modules/sched-ext/`, `internal/domain/schedrules/`: ресурсы, буферы, перенос, `findCalendarAvailability` (3 слота), 409 `resources_unavailable` без чужих деталей; бронь-источник `trip` не переносится. **WS-64 be-spa-inventory · M** — `modules/{spa,inventory}/`, 0010: визиты, однократное списание (AC-07, 100 повторов → один эффект), `done_pending` + issue, движения склада. **WS-65 be-cash · S · 2 ревьюера** — `modules/cash/`, 0011: журнал только добавление, сторно, предложения из `fleet.expense.verified.v1`. **WS-66 be-repairs · M** — `modules/repairs/`, 0012: объекты, работы, отметки, `acceptWorkLog`/`returnWorkLog`, `getRepairProjectOverview`; AC-13 (отметка с бригадой не создаёт участников и мест — integration + e2e WS-31). **WS-67 be-branding-billing-platform-ops · L · 2 ревьюера** — `control/{pricebook,requests,accounts,operators,usage,branding}/`, control 0004–0005: BR-T1…T3 (SVG с `<script>` → 422, `accentUsed` ≥ 4.5), заявки на места/тариф (одна открытая, 409 `request_pending`), прайс-бук (EXCLUDE версий), lock/mfa, операторы (D-46), `getPlatformUsage` из `tenant_usage_daily` (Q-91). **WS-68 pwa-offline · L** — `apps/web/src/pwa/`, outbox в IndexedDB, `today-offline.spec.ts` (`context.setOffline`, перезагрузка не теряет очередь), D-09. **WS-69 load-restore · M** — `backend/test/load/`, `deploy/compose/restore.md`: k6 (p95 ≤ 500/800 мс), restore drill (AC-15, RPO ≤ 15 мин, RTO ≤ 4 ч), SBOM/подпись. **WS-70 notify-realtime · M** — `platform/notify/`, 0005 ext: `GET /me/notifications`, SSE, адресность `to[]` + `sensitive` по `canEarnings`, S1-26, Q-95. **WS-71 inspection-automation · M** — `modules/forms/automation/` потребитель `fleet.inspection.submitted.v1`: ответ формы по действующей версии + задача «Проверить осмотр …», ключ `tripId:kind:rev`, повтор не создаёт вторую задачу (Q-59). **WS-72 csv-import · M** — `modules/importer/`, 0013: `importMembersCsv`, `importVehiclesCsv` с `preview` и ошибками строк (S1-10, D-48; UI не рисуется).

Каждый WS волны 4 первым коммитом снимает `t.Skip`/`501` своего тега, затем снимает `fixme(E2E_MODE === 'stand')` в spec'ах своих страниц (только маркеры), добавляет `test/isolation/<module>_test.go`, conformance-кейсы своего раздела 07 §14.5–14.7 с тегом `@stand`, и закрывает повторной MCP-проходкой `phase2/` для своих ключей.


## 6. DAG и волны

### 6.1 Рёбра зависимостей (A → B: B стартует после слияния A)

```text
WS-00 → WS-07 (генератор скелетов читает исправленные чек-листы), WS-10…WS-32 (брифы)
WS-01 → WS-02, WS-03, WS-04, WS-05, WS-07, WS-08
WS-02 → WS-40, WS-41, WS-53, WS-54
WS-03 → WS-15, WS-40, WS-42, WS-51
WS-04 → WS-10, WS-11, WS-12, WS-13, WS-14, WS-32
WS-05 → WS-06, WS-10, WS-14, WS-52
WS-06 → WS-10, WS-14, WS-20…WS-31, WS-51
WS-07 → WS-10, WS-11, WS-14, WS-20…WS-32, WS-40, WS-41 (Go-харнесс)
WS-08 → WS-10, WS-14, WS-20…WS-32
WS-10 → WS-14 (ModalHost; ранний старт по слоту), WS-20…WS-32, WS-55
WS-12 → WS-20…WS-32 (визуал; ранний старт на стабах WS-04)
WS-13 → WS-22, WS-23, WS-24, WS-27, WS-28, WS-29, WS-31, WS-32
WS-14 → WS-20, WS-24
WS-15 → WS-51 (delta), WS-60…WS-72
WS-20 → WS-21 (стаб меню; ранний старт допустим)
WS-31 (контракт контейнера, из брифа) → WS-32 ; WS-32 → WS-31 (финальная интеграция, та же волна)
WS-40 → WS-42, WS-43, WS-54
WS-41 → WS-42, WS-43, WS-52, WS-56
WS-42 → WS-44, WS-45, WS-50
WS-43 → WS-52, WS-56
WS-44 → WS-46, WS-49, WS-56, WS-72
WS-45 → WS-46, WS-47, WS-60, WS-61, WS-62, WS-64, WS-66, WS-67, WS-70
WS-46 → WS-47, WS-50, WS-63, WS-72
WS-47 → WS-48, WS-53, WS-68, WS-71
WS-48 → WS-53, WS-65
WS-51 → WS-53, WS-60…WS-72
WS-52 → WS-53
WS-53 → WS-68, WS-69, волна 4
WS-20…WS-32, WS-10 → WS-55
WS-60, WS-61, WS-47 → WS-71
```

### 6.2 Состав волн

| Волна | WS | Исполнителей | Проверяющих страниц | Ревьюеров | Интеграторов | Барьер (§6.5) |
|---|---|---|---|---|---|---|
| 0 | WS-00, WS-01 первыми (один агент каждый; WS-01 — до остальных); затем WS-02, 03, 04, 05, 07, 08 параллельно; WS-06 после WS-05 (pipeline) | 1 → 7 | 0 (smoke/харнесс — интегратор) | по 1; WS-03 — 2; ревью волны 0 целиком до старта волны 1 (12 §8 п.15) | 1 | 0 → 1 |
| 1 | WS-10, 11, 12, 13, 14, 40, 41 | 7 | `shell`, `modal-confirm`, `modal-sheet`, 3 `modal-*` людей, 6 `docs-*` = 12 (по готовности) | по 1; WS-41 — 2 | 1 | 1 → 2 |
| 2 | 13 страничных WS (20…32) + WS-15 + WS-51 + backend 42, 43 (затем 44, 45 — pipeline) | 13 + 2 + 2 (→ 4) = 17–19; при лимите ~10 — подволны 2a/2b | 24 страницы + `repair-tabs` + `modal-request` = 26 (очередь ≤ 6 одновременно, D-49) | по 1; WS-15, WS-42 — 2 | 2 (UI и backend, D-40) | 2 → 3 |
| 3 | WS-46, 49, 50, 52, 54, 55, 56 сразу; 47 после 46; 48 после 47; 53 последним | 7 → 9 | 11 страниц S0–S2 повторно (`phase2/`), 18 journeys | по 1; WS-48, 54, 56 — 2 | 1 | 3 → 4 |
| 4 | WS-60…WS-72 по готовности контракта и мощности | 4–8 | ключи своих страниц `phase2/`, `today-offline` | по 1; WS-65, 67 — 2 | 1 | по DoD каждого WS |

Подволна 2a (основной путь гида 01 §6 + оператор): WS-20, WS-22, WS-23, WS-24, WS-27, WS-29, WS-30 + WS-42, WS-43, WS-51 (10 агентов). Подволна 2b: WS-21, WS-25, WS-26, WS-28, WS-31, WS-32, WS-15 + WS-44, WS-45 (9 агентов). Подволны — не барьер: 2b стартует по мере освобождения агентов; WS-31/32 — пара с публикацией контракта контейнера в брифе до кода.

### 6.3 Мощность и очередь проверки (П15)

Стоимость одной проверки страницы: dev-сервер Vite + браузер Playwright + браузер MCP ≈ 1–1,5 ГБ ОЗУ и 1 ядро; на dev-машине (Windows 11, 12 §8 п.3) одновременно — не более **6 проверяющих** и **10 исполнителей**; эталон 4173 — один общий статический процесс. В волне 2 26 проверок при 6 параллельных и ~1 ч на проверку занимают ≈ 5 ч чистого времени — меньше длительности самих WS, очередь не удлиняет критический путь. Интегратор UI запускает проверяющих партиями по готовности WS, а не все сразу (`args.verifyConcurrency = 6`, §7.5).

### 6.4 Правила раннего старта внутри волны (из B §3; «pipeline, не parallel» — `orchestration.md` §2)

- WS-12/WS-13 стартуют на стабах и типах WS-04 (волна 0), не ждут друг друга.
- WS-14 стартует, как только WS-10 закоммитил слот `ModalHost` и `useShell` (первые дни WS-10), не дожидаясь 38 пунктов `shell.spec`.
- Страничные WS волны 2 в двух сессиях одного агента: сессия 1 (ещё в волне 1) — только `routes/<group>/vm/` + табличные unit-тесты по таблицам «Вычисления» (02 §5.4, §7.3; 03 §11.3; 04 §5.x; 05 §5.5; 06 §11.2; 06b §8.10, §20 п.2); сессия 2 — экраны после слияния WS-10 (и появления `useRun`/`ModalHost`/демо-панели), без ожидания WS-12/13 (визуал на стабах, затем перепроверка после их слияния).
- WS-51 core-часть стартует после WS-06 (волна 0), delta — после WS-15.
- WS-21 начинает на стабе owner-меню, не дожидаясь WS-20.
- WS-32 начинает с (a) библиотеки расписания и (d) «Замер»+«Смета» — не зависит ни от чего, кроме WS-04 (06b §20 п.12).
- Backend: WS-44/45 стартуют после первого коммита интерфейсов `authz.Permit`/`ScopeQuery` WS-42 (типы), полная матрица изоляции догоняет.

### 6.5 Барьеры волн: что должно быть зелёным до старта следующей (из B §8)

| Волна → | Команды интегратора (`orchestration.md` §6) и условия | Evidence |
|---|---|---|
| 0 → 1 | `make gen` без дрейфа на 0.2-core; `pnpm lint && pnpm typecheck && pnpm test` (домен ≥ 90 %); `tools/check-icu.js` зелёный; `go test ./...` + `-tags integration` (миграции up/down на двух tenant DB); `pnpm e2e -- --grep @smoke` на 3 проектах (пустое приложение открывается); `harness.spec.ts` (эталон офлайн, `reference` vs `reference` = 0 diff); `toMatchReference('home')` красный «по делу»; ревью волны 0 (3 ревьюера: контракт, фундамент FE, фундамент BE); D-25…D-52 внесены в `decisions.md`, ADR-0001 есть; критик подтвердил WS-00 | `docs/plan/reports/WS-0*.md`, вывод `make gen`, `critique/wave-0.md` |
| 1 → 2 | `shell.spec.ts` 38/38, `demo-panel.spec`, `guide.spec`, `modal-confirm`, `modal-sheet` на `mobile-390` и `desktop-1440`; визуальная сверка оболочки 8 персонажей × 3 ширины в допуске 1 % или allowlist с D-ID; MCP-проходка `shell`, `modal-*`, 6 `docs-*`; Storybook 30 компонентов с axe; витрина `#buttons…#data` в допуске; `go test -tags isolation` для `/me/context`; `devLogin → /me/context` через конвейер; шаблон брифа страницы заполнен для WS-20 (эталон для остальных) | `docs/plan/evidence/{shell,modal-*,docs-*}/`, `status.md` |
| 2 → 3 | 24 страницы + `repair-tabs` + 6 модалок: e2e зелёные (`pnpm e2e` все проекты), визуальная сверка, MCP-evidence, ревью; `screens-http` зелёный (экранные тесты против http+MSW); conformance-suite против `http + MSW` зелёная; `go test -tags integration,isolation,concurrency` для WS-42…45; `make gen` после WS-15 без дрейфа, `internal/api/<tag>/` перегенерированы интегратором; `allowlist-lint` зелёный, рост allowlist опубликован в `critique/wave-2.md`; критик сверил с 00 §3.1–3.5 и §4.9 | `status.md`, `critique/wave-2.md`, `evidence/*/` |
| 3 → 4 | `pnpm e2e:full` зелёный на 11 страницах S0–S2 (`E2E_MODE=stand`); повторная MCP-проходка 11 страниц → `evidence/*/phase2/`; `mock-vs-http.spec.ts` без расхождений кодов; Schemathesis 0 падений; AC-01…AC-06, AC-10…AC-12 автоматизированы (13-backlog «Выход из S1/S2»); J1–J18 и `guide-path` `@smoke` зелёные в обоих режимах; `recipes-vs-presets` зелёный | `evidence/*/phase2/`, `backend/test/contract/report.html`, `critique/wave-3.md` |
| 4 | по готовности каждого WS: тот же DoD + `fixme(stand)` сняты для своих страниц + `phase2/` evidence | `status.md` |

### 6.6 Критический путь и точки интеграции

- **UI «точно как нарисовано» (фаза 1):** WS-01 (M) → WS-04 (M) → [WS-12 (M) ‖ WS-10 (L)] → WS-23 logistics-driver (L) → проверка `today` (самая длинная: 9 состояний × 3 ширины × 8 рецептов) → интеграция волны 2. Параллельно WS-05 → WS-06 → (короче). Второй по длине — WS-32 (L), не блокирует сдачу «Пути проверки». Оценка в днях при L ≈ 5, M ≈ 3, S ≈ 1,5 (как в B): 3 + 3 + 5 + 5 + 2 + 2 ≈ **20 рабочих дней** до «все 24 страницы с evidence фазы 1».
- **Backend фазы 2:** WS-01 → WS-03 (L) → WS-40 (M) → WS-42 (L) → WS-44 (L) → WS-46 (M) → WS-47 (L) → WS-53 (M) ≈ 3 + 5 + 3 + 5 + 5 + 3 + 5 + 3 = **32 дня**; backend не на пути фазы 1, а стыкуется в волне 3 (D-15).
- **Точки интеграции:** барьер 0→1 (контракты заморожены); барьер 1→2 (оболочка собрана с реальными `ui-core`/`ui-domain`); внутри волны 2 — WS-31 ← WS-32 (контейнер вкладок), WS-20 → WS-21 (меню), WS-15 → WS-51 (delta); барьер 2→3 (строка http в `adapter.ts`, перегенерация по тегам); барьер 3→4 (`e2e:full`).
- **Простои и чем заняты:** backend-агенты в волне 0 ждут WS-03 — делают WS-41 и ревью волны 0; страничные агенты в волне 1 — ранний старт VM (§6.4), WS-11, WS-14; UI-агенты после волны 2 — WS-55, WS-68, допокрытие критика; backend между волнами 2 и 3 — WS-60…67 стартуют, как только есть WS-15 + WS-45 + WS-51.

---

## 7. Протокол выполнения волны

### 7.1 Общий порядок (`orchestration.md` §4–§6)

1. Планировщик генерирует брифы `docs/plan/ws/WS-NN-<slug>.md` из §5.4 (девять разделов) и строки `status.md` → «не начат».
2. Интегратор запускает `Workflow({ scriptPath: 'docs/plan/workflow.template.js', args })` с `args` из §7.2. Для каждого WS: исполнитель в worktree `ws/<id>-<slug>` на порту §7.4 → по закрытии — независимые проверяющие на каждый ключ `pages` (параллельно, с лимитом) → ревьюеры (`reviewers`) → интегратор (ребейз в порядке §6.1, squash, тег `wave-N-wsNN`) → критик полноты.
3. Проверяющий получает только бриф и отчёт исполнителя (`orchestration.md` §4); вердикт `return` возвращает WS исполнителю через `SendMessage`, ≤ 3 итераций, затем эскалация интегратору.
4. После всех WS волны — барьер §6.5; `status.md` обновлён; `critique/wave-N.md` → новые WS (резерв номеров WS-80+ для находок критика).

### 7.2 `args` для `workflow.template.js` по волнам (из B §2.6, C §7)

Поле `suites` (теги Go-сюит, обязанных быть зелёными до слияния) и `verifyConcurrency` — аддитивные предложения к шаблону (§7.5); скрипт их игнорирует, интегратор читает.

```json
{ "wave": 0, "verifyConcurrency": 6, "ws": [
  { "id": "WS-00", "slug": "analysis-fixes",     "brief": "docs/plan/ws/WS-00-analysis-fixes.md",     "pages": [], "reviewers": 1 },
  { "id": "WS-01", "slug": "repo-skeleton",      "brief": "docs/plan/ws/WS-01-repo-skeleton.md",      "pages": [], "reviewers": 1 },
  { "id": "WS-02", "slug": "compose-stand",      "brief": "docs/plan/ws/WS-02-compose-stand.md",      "pages": [], "reviewers": 1 },
  { "id": "WS-03", "slug": "contract-core",      "brief": "docs/plan/ws/WS-03-contract-core.md",      "pages": [], "reviewers": 2, "suites": ["contract"] },
  { "id": "WS-04", "slug": "tokens-ui-contract", "brief": "docs/plan/ws/WS-04-tokens-ui-contract.md", "pages": [], "reviewers": 1 },
  { "id": "WS-05", "slug": "domain-seed-port",   "brief": "docs/plan/ws/WS-05-domain-seed-port.md",   "pages": [], "reviewers": 1 },
  { "id": "WS-06", "slug": "mock-adapter-port",  "brief": "docs/plan/ws/WS-06-mock-adapter-port.md",  "pages": [], "reviewers": 1 },
  { "id": "WS-07", "slug": "e2e-harness-mcp",    "brief": "docs/plan/ws/WS-07-e2e-harness-mcp.md",    "pages": [], "reviewers": 1 },
  { "id": "WS-08", "slug": "texts-dictionary",   "brief": "docs/plan/ws/WS-08-texts-dictionary.md",   "pages": [], "reviewers": 1 }
] }
```

Порядок внутри волны 0: WS-00 и WS-01 — первыми и последовательно (один агент каждый); остальные — после слияния WS-01; WS-06 — после WS-05 (pipeline). Ревью волны 0 — три ревьюера (контракт / фундамент FE / фундамент BE) до запуска волны 1.

```json
{ "wave": 1, "verifyConcurrency": 6, "ws": [
  { "id": "WS-10", "slug": "shell",        "brief": "docs/plan/ws/WS-10-shell.md",        "pages": ["shell", "modal-confirm", "modal-sheet"], "reviewers": 1 },
  { "id": "WS-11", "slug": "docs-site",    "brief": "docs/plan/ws/WS-11-docs-site.md",    "pages": ["docs-start", "docs-search", "docs-api", "docs-permissions", "docs-frames", "docs-layout"], "reviewers": 1 },
  { "id": "WS-12", "slug": "ui-core",      "brief": "docs/plan/ws/WS-12-ui-core.md",      "pages": [], "reviewers": 1 },
  { "id": "WS-13", "slug": "ui-domain",    "brief": "docs/plan/ws/WS-13-ui-domain.md",    "pages": [], "reviewers": 1 },
  { "id": "WS-14", "slug": "modals-people","brief": "docs/plan/ws/WS-14-modals-people.md","pages": ["modal-assign", "modal-invite", "modal-createRole"], "reviewers": 1 },
  { "id": "WS-40", "slug": "backend-platform", "brief": "docs/plan/ws/WS-40-backend-platform.md", "pages": [], "reviewers": 1, "suites": ["integration"] },
  { "id": "WS-41", "slug": "migrations",   "brief": "docs/plan/ws/WS-41-migrations.md",   "pages": [], "reviewers": 2, "suites": ["integration"] }
] }
```

```json
{ "wave": 2, "verifyConcurrency": 6, "integrators": ["ui", "backend"], "ws": [
  { "id": "WS-20", "slug": "company",            "brief": "docs/plan/ws/WS-20-company.md",            "pages": ["modules", "users", "billing"], "reviewers": 1 },
  { "id": "WS-22", "slug": "logistics-manager",  "brief": "docs/plan/ws/WS-22-logistics-manager.md",  "pages": ["fleet", "pool", "review", "modal-request"], "reviewers": 1 },
  { "id": "WS-23", "slug": "logistics-driver",   "brief": "docs/plan/ws/WS-23-logistics-driver.md",   "pages": ["today", "cars"], "reviewers": 1 },
  { "id": "WS-24", "slug": "home",               "brief": "docs/plan/ws/WS-24-home.md",               "pages": ["home"], "reviewers": 1 },
  { "id": "WS-27", "slug": "platform-orgs",      "brief": "docs/plan/ws/WS-27-platform-orgs.md",      "pages": ["tenants", "usage", "requests"], "reviewers": 1 },
  { "id": "WS-29", "slug": "core-modules",       "brief": "docs/plan/ws/WS-29-core-modules.md",       "pages": ["calendar", "knowledge", "data", "files"], "reviewers": 1 },
  { "id": "WS-30", "slug": "spa-cash",           "brief": "docs/plan/ws/WS-30-spa-cash.md",           "pages": ["spa", "cash"], "reviewers": 1 },
  { "id": "WS-42", "slug": "authz",              "brief": "docs/plan/ws/WS-42-authz.md",              "pages": [], "reviewers": 2, "suites": ["isolation"] },
  { "id": "WS-43", "slug": "control-tenants",    "brief": "docs/plan/ws/WS-43-control-tenants.md",    "pages": [], "reviewers": 1, "suites": ["integration", "isolation"] },
  { "id": "WS-51", "slug": "http-adapter-msw",   "brief": "docs/plan/ws/WS-51-http-adapter-msw.md",   "pages": [], "reviewers": 1, "suites": ["contract"] },
  { "id": "WS-21", "slug": "branding",           "brief": "docs/plan/ws/WS-21-branding.md",           "pages": ["branding"], "reviewers": 1 },
  { "id": "WS-25", "slug": "forms",              "brief": "docs/plan/ws/WS-25-forms.md",              "pages": ["forms"], "reviewers": 1 },
  { "id": "WS-26", "slug": "tasks",              "brief": "docs/plan/ws/WS-26-tasks.md",              "pages": ["tasks"], "reviewers": 1 },
  { "id": "WS-28", "slug": "platform-accounts-plans", "brief": "docs/plan/ws/WS-28-platform-accounts-plans.md", "pages": ["accounts", "plans"], "reviewers": 1 },
  { "id": "WS-31", "slug": "repair-object",      "brief": "docs/plan/ws/WS-31-repair-object.md",      "pages": ["repair"], "reviewers": 1 },
  { "id": "WS-32", "slug": "repair-child",       "brief": "docs/plan/ws/WS-32-repair-child.md",       "pages": ["repair-tabs"], "reviewers": 1 },
  { "id": "WS-15", "slug": "contract-delta",     "brief": "docs/plan/ws/WS-15-contract-delta.md",     "pages": [], "reviewers": 2, "suites": ["contract"] },
  { "id": "WS-44", "slug": "access-people-org",  "brief": "docs/plan/ws/WS-44-access-people-org.md",  "pages": [], "reviewers": 1, "suites": ["integration", "isolation", "concurrency"] },
  { "id": "WS-45", "slug": "modules-files-services", "brief": "docs/plan/ws/WS-45-modules-files-services.md", "pages": [], "reviewers": 1, "suites": ["integration", "isolation"] }
] }
```

Первые десять — подволна 2a, остальные — 2b (стартуют по мере освобождения агентов; WS-44/45 — после первого коммита интерфейсов WS-42).

```json
{ "wave": 3, "verifyConcurrency": 6, "ws": [
  { "id": "WS-46", "slug": "fleet-core",            "brief": "docs/plan/ws/WS-46-fleet-core.md",            "pages": [], "reviewers": 1, "suites": ["integration", "isolation", "concurrency"] },
  { "id": "WS-49", "slug": "fleet-pool",            "brief": "docs/plan/ws/WS-49-fleet-pool.md",            "pages": [], "reviewers": 1, "suites": ["integration", "isolation"] },
  { "id": "WS-50", "slug": "datasets",              "brief": "docs/plan/ws/WS-50-datasets.md",              "pages": [], "reviewers": 1, "suites": ["integration", "isolation"] },
  { "id": "WS-52", "slug": "go-seed",               "brief": "docs/plan/ws/WS-52-go-seed.md",               "pages": [], "reviewers": 1, "suites": ["integration"] },
  { "id": "WS-54", "slug": "keycloak-oidc",         "brief": "docs/plan/ws/WS-54-keycloak-oidc.md",         "pages": ["auth-keycloak"], "reviewers": 2 },
  { "id": "WS-55", "slug": "journeys-e2e",          "brief": "docs/plan/ws/WS-55-journeys-e2e.md",          "pages": ["journeys", "guide-path"], "reviewers": 1 },
  { "id": "WS-56", "slug": "provisioning",          "brief": "docs/plan/ws/WS-56-provisioning.md",          "pages": [], "reviewers": 2, "suites": ["integration", "isolation"] },
  { "id": "WS-47", "slug": "fleet-shift",           "brief": "docs/plan/ws/WS-47-fleet-shift.md",           "pages": [], "reviewers": 1, "suites": ["integration", "isolation", "concurrency"] },
  { "id": "WS-48", "slug": "fleet-review-earnings", "brief": "docs/plan/ws/WS-48-fleet-review-earnings.md", "pages": [], "reviewers": 2, "suites": ["integration", "isolation"] },
  { "id": "WS-53", "slug": "e2e-full-stand",        "brief": "docs/plan/ws/WS-53-e2e-full-stand.md",
    "pages": ["shell", "modules", "users", "billing", "tenants", "fleet", "pool", "review", "today", "cars", "home"],
    "mode": "stand", "phase": 2, "reviewers": 1, "suites": ["contract"] }
] }
```

Для WS-53 проверяющие выполняют `verification-protocol.md` §1–§4 в режиме `E2E_MODE=stand` (`pnpm e2e:full -- --grep <key>`) и кладут evidence в `docs/plan/evidence/<key>/phase2/` (D-52). Волна 4 запускается тем же скриптом с `pages` = ключи страниц модуля и `"mode": "stand", "phase": 2`.

### 7.3 Цепочка «при добавлении страницы» (из C §5.3)

1. Исполнитель меняет `routes/<key>/**` (или `modals/**`, `shell/**`, `apps/docs/**`) → Stop-хук `.claude/settings.json` запускает `node tools/verify-pages.js` → по `git diff --name-only` выводит ключи без свежего `docs/plan/evidence/<key>/` (новее последнего коммита ветки) — напоминание выполнить `verification-protocol.md` §1–§4; хук не закрывает проверку, а не даёт её пропустить.
2. Исполнитель проходит §1 (e2e на 390/1440), §3 (визуальная + `labels` по рецептам), §4 (MCP-проходка через `mcp__playwright__*`, три ширины, консоль, сеть), кладёт evidence, пишет отчёт.
3. `workflow.template.js` запускает независимых проверяющих по `ws.pages` (включая модалки и `repair-tabs`), до 3 итераций `return`.
4. Ревью (1–2 ревьюера по `requesting-code-review`: порядок `test(` → `feat(`, дословность, скилы, нет прямых вызовов адаптера из компонентов).
5. Интегратор ребейзит, гоняет полную сюиту и визуальную сверку волны на 5173, обновляет `status.md`.

### 7.4 Порты и изоляция (D-49; 12 §8 п.6)

| Роль | Dev-сервер | Эталон | MCP | Playwright |
|---|---|---|---|---|
| исполнитель WS-NN | `PORT = 5173 + NN` (WS-23 → 5196) | общий `127.0.0.1:4173` | свой инстанс (`.mcp.json` читается на старте сессии), `--isolated --output-dir .playwright-mcp/5196` | `reuseExistingServer` на своём порту |
| проверяющий ключа | `PORT = 6000 + индекс ключа в §5.3` (`home` → 6001 …), `E2E_FRESH_SERVER=1` — сервер поднимается из worktree ветки WS, чужой код не подцепляется | общий 4173 | свой инстанс, `--output-dir .playwright-mcp/<PORT>` | свои проекты, `--grep <key>` |
| интегратор | 5173 | 4173 (поднимает сам, если не поднят) | свой | полная сюита |
| CI | `webServer[0]` 5173, `webServer[1]` 4173 (`--offline`) | — | — | все проекты, Linux baseline |

Одновременно: ≤ 10 исполнителей, ≤ 6 проверяющих (очередь по `verifyConcurrency`); `.playwright-mcp/` в `.gitignore`; на Windows два установленных браузера (`pnpm e2e:install`, `pnpm mcp:install`).

### 7.5 Аддитивные расширения шаблона (предложение интегратору волны 0, не ломают текущий скрипт)

- `args.verifyConcurrency` — лимит параллельных проверяющих: `parallel` вызывается партиями по N (обёртка `chunked`).
- `args.integrators` — `['ui','backend']` в волне 2: два агента-интегратора с непересекающимися списками WS (по `kind`), порядок — DAG §6.1 (D-40).
- `ws.suites` — список Go-тегов, обязанных быть зелёными до слияния; интегратор гоняет `go test -tags <suite>` для каждого.
- `ws.mode` (`mock`|`stand`) и `ws.phase` (1|2) — прокидываются в `verifyPrompt`; `VERDICT_SCHEMA` дополняется `mode`, `phase`, `evidenceDir` (с `/phase2/`); `REPORT_SCHEMA` — `mode` и `evidencePhase`; `status.md` получает две колонки evidence (D-52).
- Ключи `pages` для модалок (`modal-*`), вкладок (`repair-tabs`), документации (`docs-*`), сквозных сценариев (`journeys`, `guide-path`) обрабатываются тем же `verifyPrompt`: проверяющий открывает `e2e/<key>.spec.ts` и `docs/plan/evidence/<key>/`.


## 8. TDD и верификация по видам WS

Протоколы применяются без изменений; ниже — как шаги `tdd-protocol.md` §2 и проверки `verification-protocol.md` §1–§5 ложатся на каждый `kind`. Красный тест обязан падать на утверждении, а не на импорте (`tdd-protocol.md` §1): стабы WS-04 (`data-stub`) и `notimpl` 501 (WS-03) дают компиляцию без поведения.

### 8.1 Матрица «шаг протокола × kind»

| Шаг (`tdd-protocol.md` §2) | infra | contract | domain | ui-kit | shell / pages / docs-site | backend | integration | quality |
|---|---|---|---|---|---|---|---|---|
| 1 E2E-скелет | `harness.spec.ts`, smoke | `screens.test.ts` (red до операций) | — | Storybook-истории как «скелет состояний» | **первый коммит**: `tools/e2e-skeleton.js` → `e2e/<key>.spec.ts` (пункты чек-листа + §1.3 + «Г-*» из §4.9) в `test.fixme` | **первый коммит**: контрактные тесты тега на strict server с `t.Skip`, снимаются по одному (B §5.1) | `mock-vs-http.spec.ts`, `e2e:full` smoke в `fixme` | `journeys/J*.spec.ts`, `guide-path.spec.ts` в `fixme` |
| 2 Домен | — | — | табличные Vitest по 07 §8 (≥ 60), `navForBase`/`gateVM`/`bannersVM` | `brandVars/contrastW/fixAccent` | VM как чистые функции `(db, state, clock) → vm` в `routes/<group>/vm/` по таблицам «Вычисления» | Go-копии правил (`fleetrules`, `schedrules`) по тем же примерам 07 §8 | — | — |
| 3 Контракт | — | Spectral, ajv на `examples/`, drift, «`x-permissions` ∈ каталог», enum | `AdapterPort` типы; conformance-suite (62 + покрытие 51/51 и кодов) против mock | пропсы 1:1 с `components.md` (tsc) | потребление `AdapterPort` через `useRun`; экранные тесты — in-memory адаптер с нулевыми задержками (D-39) | strict-server тесты по тегу: тело, коды, `Problem.code` | MSW по операции на каждый метод; conformance против `http + MSW`; `screens-http` | — |
| 4 Интеграция | compose smoke | — | — | — | — | testcontainers PostgreSQL 17 / MinIO: репозитории, `scopeQuery`, `EXCLUDE`, outbox | стенд compose `--profile e2e` | — |
| 5 Изоляция / конкурентность | Go-харнесс (`t.Parallel`, падает без БД) | — | — | — | — | `test/isolation/<module>_test.go` (матрица 200/403/404), `test/concurrency/` (100 броней → 1×201) | Schemathesis | — |
| 6 Компоненты | — | — | — | Testing Library по ролям, клавиатура, axe на компонент, визуальные снимки витрины | компоненты страниц (`features`) + axe | — | — | — |
| 7 Экран | — | — | — | — | роутер в памяти + `QueryClient` без retry + in-memory адаптер + пресеты: обычное, пусто, загрузка, ошибка, нет права / модуль не подключён, конфликт, офлайн, только чтение | — | те же экранные тесты с `VITE_ADAPTER=http` + MSW (CI `screens-http`) | — |
| 8 E2E | — | — | — | — | снятие `fixme` по одному, коммит на пункт; `mobile-390` + `desktop-1440`; mock-режим | — | те же spec'и в `E2E_MODE=stand` (`fixme` S3+ по §1.4 е) | J1–J18, гид — оба режима |
| 9 Визуальная сверка | `reference` vs `reference` = 0 | — | — | секции витрины `#buttons…#data` | `visual.spec` + `labels.spec` по рецептам §2.4 на 390/1440 (docs — 390/800/1280/1440); allowlist по D-50 | — | повторная сверка 11 страниц на стенде (`phase2/`) | — |
| Verification §4 MCP | 12 §6 п.2 | — | — | Storybook через MCP (витрина) | обязательна для каждого ключа `pages`: `browser_snapshot` vs инвентарь, сценарий по ролям, негативные через флаги, 390/768/1440, консоль, сеть, 3 снимка + эталон | — | `phase2/` для 11 ключей | `journeys`, `guide-path` evidence |
| Verification §5 Ревью | 1 | 2 | 1 | 1 | 1 | 1; 2 для authz/миграций/финансов | 1 | 1 |

### 8.2 Обязательные тесты каждого UI-ключа (сверх чек-листа отчёта)

Генератор скелета добавляет в каждый `e2e/<key>.spec.ts` шесть пунктов `verification-protocol.md` §1.3 с именами тестов дословно: «страница открывается из навигации по подписи «…» и по прямому URL»; «заголовок и крошки соответствуют прототипу»; «состояния: пусто / загрузка / ошибка / нет права или модуль не подключён / офлайн — дословный текст»; «клавиатура: Tab обходит все интерактивные элементы, Escape закрывает диалог, фокус виден»; «axe: нет serious/critical»; «раскладка 390: нет горизонтальной прокрутки страницы, нижняя навигация, цели ≥ 44 px; 1440: боковая панель». Плюс по одному пункту на каждую клетку «Г-*» матрицы §4.9 для этого ключа и по одному на каждый пресет/рецепт из §5.3. Таблицы с горизонтальным скроллом (`usage`, `plans`, `data`, таймлайн) — исключение внутри своей карточки, не страницы (Q-41).

### 8.3 Обязательные тесты каждого backend-WS

Контрактный тест на каждую операцию тега (все коды ответа и `Problem.code`); каждый `Problem.code` покрыт ≥ 1 тестом (`tdd-protocol.md` §4); строки матрицы изоляции (актор × объект × 200/403/404) для каждой новой операции; негативный сценарий доступа (чужая фирма, чужой тенант, функция `driver`); для изменяющих операций — `Idempotency-Key` повтор; для `If-Match` — 412/428; миграция up/down на двух tenant DB; логи без restricted-полей; покрытие `authz` и `modules/*/service*` ≥ 90 %.

### 8.4 Ревью: что проверяет ревьюер по видам

`pages`: порядок коммитов, дословность по `@ortus/texts`, нет литералов цвета/акцента, нет прямых вызовов адаптера из компонентов, allowlist только с D-ID, рецепты равны пресетам. `backend`: `scopeQuery` в каждом запросе, `depguard`, типизированные ошибки → `Problem.code` в одном месте, миграции expand/contract, второй ревьюер для `authz`/`migrations`/`finance`/`permissions.yaml`. `contract`: аддитивность после волны 0, примеры на каждую операцию, `x-adapter-method`. `ui-kit`: пропсы 1:1 с `components.md`, axe, витрина. `integration`: маппинг кодов, составные вызовы, `GET /me/context` после мутаций.

---

## 9. Требования и AC → WS

### 9.1 Критерии приёмки (08 §4; `15-quality-security.md:33–50`)

| AC | Уровень | WS (тест) | Фаза |
|---|---|---|---|
| AC-01 | Isolation | WS-42 (матрица), WS-50 (count/агрегаты 404), WS-46 | 2 |
| AC-02 | Isolation | WS-56 (сессия A с `tenantId` B → 404), WS-40 (tenant resolver) | 2 |
| AC-03 | Concurrency | WS-46 (100 броней → 1×201 + 99×409) | 2 |
| AC-04 | Integration + E2E | WS-47 (4 фото из 5 / блокирующий дефект → 409) + WS-23 (`today.spec` «Осталось: 1 фото», «Выезд заблокирован») | 1 (UI), 2 |
| AC-05 | Isolation | WS-48 (все каналы), WS-50, WS-45 (уведомления), WS-22 (UI блок начисления по праву), WS-06 (`view()`) | 1 (mock), 2 |
| AC-06 | Isolation | WS-49 (после срока → 404), WS-22 (`pool.spec`) | 2 |
| AC-07 | Concurrency | WS-64 (100 повторов `completeAppointment` → один эффект), WS-65 (проводка) | 3 |
| AC-08 | Contract | WS-60 (публичный токен на `/vehicles` → 401/404) | 3 |
| AC-09 | Integration | WS-60 (ответ v1 читается по структуре v1 после v2), WS-25 (UI «Ответы» по версии) | 1 (UI), 3 |
| AC-10 | Integration | WS-45 (отзыв роли во время экспорта → 403), WS-42 (`policy_version`) | 2 |
| AC-11 | E2E | WS-20 (`modules.spec` `trial-ended`: кнопки заблокированы) + WS-45 (`tenant_read_only`: чтение/экспорт разрешены, мутация 403) + WS-53 (`e2e:full`) | 1, 2 |
| AC-12 | E2E | WS-20 (`modules.spec` диалог «Отключить «Логистика»?» с активным рейсом, `ack`) + WS-45 (draining: новый рейс 403, текущий сдаётся) + WS-53 | 1, 2 |
| AC-13 | E2E + Integration (Q-113) | WS-31 (`repair.spec`: отметка с бригадой не меняет счётчик «Пользователи и роли» и «мест») + WS-66 (`seat_usage` не меняется, участники не создаются) | 1, 3 |
| AC-14 | E2E + Integration (Q-113) | WS-29 (`data.spec`: суммы набора «Расходы» = сумме расходов рейсов в сиде) + WS-50 (значения согласованы с доменными записями и единицами) | 1, 2 |
| AC-15 | Restore drill | WS-69 | 3 |
| BR-T1 | Isolation | WS-67 (PUT в чужой тенант → 404), WS-21 (`branding.spec` Лотос `#7A3E79`) | 1, 3 |
| BR-T2 | Isolation | WS-67 + WS-21 (аккаунт Анны Морозовой в двух тенантах — оформление текущего) | 1, 3 |
| BR-T3 | Contract | WS-67 (`accentUsed` ≥ 4.5; SVG с `<script>` → 422), WS-05 (`fixAccent`) | 0, 3 |

### 9.2 Истории S0–S2 (`13-backlog-s0-s2.md`) → WS

| Истории | WS | Примечание |
|---|---|---|
| S0-01, S0-02 | WS-01 | репозиторий, CI |
| S0-03 | WS-02 | compose |
| S0-04 | WS-03, WS-40 | кодоген + один эндпоинт end-to-end (`devLogin → /me/context`) |
| S0-05 | WS-04, WS-12 | токены и 6 базовых компонентов в Storybook |
| S0-06 | WS-05 | доменные функции |
| S0-07 | WS-42 (фикстуры), WS-07 (харнесс) | скелет изоляции |
| S0-08 | владелец продукта (D-01…D-12); WS-00 (D-25…D-52) | |
| S0-09 | WS-69 | нагрузочный профиль |
| S1-01, S1-03 | WS-56 (saga, controller — WS-41) | UI создания организации нет (Q-03, D-48) |
| S1-02 | WS-40 | tenant resolver |
| S1-04 | WS-43 | статусы, trial, аудит |
| S1-05 | WS-54 (D-41); dev-провайдер — WS-40 | |
| S1-06 | WS-44 (`acceptInvitation`), WS-54 | |
| S1-07 | WS-40 (`getMyContext.tenants[]`, `selectTenant`, `lastTenantId`) | UI-переключатель не нарисован — в фазе 1 только демо-селект (D-48) |
| S1-08, S1-09, S1-11…S1-16 | WS-44, WS-42 | S1-11 — WS-42; S1-14 `explainAccess` — WS-42/44 |
| S1-10 | WS-72 | backend-only, UI не нарисован (D-48) |
| S1-17…S1-19 | WS-45 | модули, draining, read_only |
| S1-20, S1-21 | WS-45 | файлы |
| S1-22 | WS-20 (страница `modules` «Модули и место» с `meter` «Занятое место» и лимитом) + WS-45 (`getStorageUsage`) | отдельного экрана «Хранилище» в прототипе нет — покрыто `modules` (D-48) |
| S1-23…S1-26 | WS-45 (аудит, outbox, idempotency — WS-40), WS-70 (inbox) | |
| S1-27…S1-30 | WS-10 | оболочка (поиск в шапке — Q-39, не реализуется) |
| S2-01…S2-03, S2-13 | WS-46 | |
| S2-04…S2-09 | WS-47 | |
| S2-10…S2-12 | WS-48 | |
| S2-14 | WS-49 | |
| S2-15 | WS-68 | PWA |
| S2-16 | WS-50 | |

### 9.3 Открытые вопросы Q-01…Q-120 → WS (колонка WS для `decisions.md`, вносит WS-00)

| Вопросы | WS-владелец реализации «по умолчанию» |
|---|---|
| Q-01, Q-02, Q-05, Q-07, Q-10, Q-18 | WS-27 (UI), WS-43 (backend, D-35) |
| Q-03, Q-04 | WS-56, WS-43 (backend-only, D-48) |
| Q-06, Q-16, Q-17 | WS-20/WS-27 (UI), WS-67 |
| Q-08, Q-11 | WS-28 (UI), WS-67, WS-42 (D-46) |
| Q-09 | не реализуется |
| Q-12, Q-13, Q-14, Q-15 | WS-20, WS-14 |
| Q-19 | WS-14 (UI без проверки), WS-44 (409 по D-10) |
| Q-20, Q-29 | WS-20 |
| Q-21 | WS-05 (`renames`), WS-03/WS-15 (каталог) |
| Q-22 | WS-05 (сид), WS-52 (D-46) |
| Q-23, Q-30 | WS-05, WS-14, WS-20, WS-21, WS-25 |
| Q-24, Q-25, Q-26 | WS-21, WS-67 |
| Q-27, Q-28 | не реализуются |
| Q-31 | WS-05 (D-27), WS-52 |
| Q-32, Q-33, Q-42 | WS-04 (D-28) |
| Q-34 | WS-10, WS-12 (D-29) |
| Q-35…Q-40, Q-43, Q-44 | WS-10 (D-37, D-44) |
| Q-41 | WS-13, WS-27, WS-28, WS-29 |
| Q-45, Q-49 | WS-03 (D-33), WS-22, WS-47 |
| Q-46, Q-47, Q-48, Q-52, Q-53, Q-54, Q-56, Q-57 | WS-23 (UI как в прототипе), WS-46/47 (backend) |
| Q-50, Q-51 | WS-23, WS-46, WS-47 (0006) |
| Q-55 | WS-22, WS-48 |
| Q-58 | WS-22, WS-49 |
| Q-59 | WS-06, WS-71 |
| Q-60, Q-67, Q-69, Q-71 | WS-25, WS-60 |
| Q-61, Q-66 | WS-05 (`clock`), WS-24, WS-25, WS-26 |
| Q-62, Q-63, Q-68 | WS-26, WS-61 |
| Q-64, Q-73 | WS-24 |
| Q-65, Q-86, Q-87 | WS-06 (как в прототипе), WS-40, WS-45, WS-60…66 (проверки обязательны) |
| Q-70 | WS-10, WS-24, WS-27, WS-29, WS-30 (общий скелет, без текстов) |
| Q-72 | WS-30, WS-31 (`busy` без изменения снимка) |
| Q-74 | WS-32 (D-36) |
| Q-75, Q-76 | WS-29 |
| Q-77, Q-78, Q-81 | WS-31, WS-66 |
| Q-79 | WS-10 |
| Q-80, Q-90 | WS-41 (0003) |
| Q-82, Q-83, Q-84 | WS-03 (D-34), WS-05, WS-51 |
| Q-85 | WS-06, WS-44 |
| Q-88 | WS-05 |
| Q-89 | WS-03, WS-44 |
| Q-91 | WS-67 |
| Q-92 | WS-44 |
| Q-93, Q-94, Q-96 | WS-03 |
| Q-95 | WS-45 (`listMyEvents`), WS-70 |
| Q-97, Q-98 | WS-05, WS-52 (D-30) |
| Q-99, Q-100 | WS-41, WS-44 |
| Q-101 | WS-00 (ADR-0001, D-25), WS-10, WS-40 |
| Q-102, Q-109 | WS-54 (D-41) |
| Q-103 | WS-07 (D-32) |
| Q-104, Q-106, Q-107, Q-110, Q-111, Q-112 | WS-01, WS-02, WS-41 |
| Q-105 | WS-01 (`CLAUDE.md`) |
| Q-108 | не создаются (`verifyPrompt` шаблона) |
| Q-113 | WS-31, WS-29, WS-66, WS-50 (§9.1) |
| Q-114…Q-119 | WS-11 |
| Q-120 | D-24: WS-11 (карта следующих итераций), никакого WS страницы |

### 9.4 Требования ТЗ по разделам (08 §3) → WS

| Раздел 08 §3 | WS |
|---|---|
| 3.1 Календарь (CAL-01…04) | WS-29, WS-63 |
| 3.2 Задачи и БЗ (TASK, KNOW) | WS-26, WS-29, WS-61, WS-62 |
| 3.3 Данные и файлы (DATA, FILE) | WS-29, WS-50, WS-45 |
| 3.4 Формы (FORM) | WS-25, WS-60, WS-71 |
| 3.5 Доступ и модули (AUTH, MOD) | WS-14, WS-20, WS-42, WS-44, WS-45 |
| 3.6 Логистика (LOG) | WS-22, WS-23, WS-46…49 |
| 3.7 SPA и касса (SPA, CASH) | WS-30, WS-64, WS-65 |
| 3.8 Ремонт (BUILD, RS) | WS-31, WS-32, WS-66 |
| 3.9 Подписки и хранение (PLAT, BILL) | WS-20, WS-27, WS-28, WS-43, WS-45, WS-67 |
| 3.10 Интерфейс (UX-01…06) | WS-10, WS-12, WS-13 (UX-02 поиск, UX-06 URL таблиц — не реализуются, Q-39) |
| 3.11 Нефункциональные (NFR) | WS-40 (NFR-02 idempotency), WS-42 (NFR-01), WS-45 (NFR-05 аудит), WS-69 (NFR-03), WS-01 (NFR-06 CI) |
| 3.12 v0.2 (17/18/19) | WS-21, WS-27, WS-28, WS-31, WS-32, WS-66, WS-67 |


## 10. Риски и меры

### 10.1 Риски реализации

| # | Риск | Источник | Мера |
|---|---|---|---|
| R1 | Двойная работа на адаптере: TS-мок (WS-06) и Go (WS-40…50) одного поведения; расхождение мока и API — главный риск фазы 2 | A §5.2; B §5.3 п.3 | conformance-suite одна на три реализации (mock / http+MSW / стенд `@stand`); `x-adapter-method` связывает методы и операции; `mock-vs-http.spec.ts`; `make examples` снимает примеры с сценарного сервера, CI проверяет свежесть (D-43) |
| R2 | Один вызов прототипа = 2–3 операции контракта (`submitDeparture`, `publishForm`, `upload`, `completeAppointment`); страницы, спроектированные под «ответ = полный `db`», при переходе на http потребуют `GET /me/context` после мутаций | 10 §12 п.13; 07 §16 п.10 | составные вызовы и `refetch` — внутри `createHttpAdapter` (WS-51), страницы не меняются; `screens-http` ловит расхождения до волны 3 |
| R3 | Сериализация в волне 1: страницы не стартуют до слияния WS-10/12/13 | A §5.2 | ранний старт VM-слоя и стабов (§6.4); WS-11/14/40/41 занимают агентов |
| R4 | Интегратор волны 2 — узкое место (13 ребейзов + 26 проверок) | A §5.2 | два интегратора (D-40), очередь проверяющих (§6.3), подволны 2a/2b |
| R5 | Автор страницы сам пишет e2e-скелет (12 §5 п.13) | `tdd-protocol.md` §2 | скелет генерируется из чек-листа отчёта (формулировки не авторские); `labels.spec` сверяет тексты автоматически; независимый проверяющий вправе добавлять тесты и возвращать WS; сквозные сценарии пишут не авторы экранов (WS-55) |
| R6 | Раскладка прототипа считается по ширине фрейма `W` (01 §4.3, `:2829–2830`), а не окна; «один DOM» (12 §5 п.18) | A §5.2 | container queries / `ResizeObserver` на фрейме в `AppShell` (WS-10); дочерний макет ремонта берёт ширину от общего брейкпоинта CRM (06b §19 п.15); снимки — только при «Ширина = По окну» (D-45) |
| R7 | Пиксельная сверка Windows-dev / Linux-CI расходится (12 §7 Q4) | D-32 | baseline per-platform, канон Linux; структурная сверка обязательна; шрифты локальные |
| R8 | Рост allowlist размывает порог 1 % | D-22 | файл на страницу, обязательный D-ID, `allowlist-lint`, публикация роста на барьере (D-50); записи `pixel` без D-ID запрещены |
| R9 | Контракт по чужому прототипу — «допроектировать не то» (`Trip` только после `startTrip`, статусы тенанта, `rework`) | B §5.3 п.2 | в фазе 1 UI не зависит от OpenAPI (`AdapterPort`), контракт проверяется паритетной сюитой в волне 2 до backend логистики; правки после волны 0 только аддитивно (D-47) |
| R10 | Мощность Windows-машины при 20+ агентах и MCP-браузерах | 12 §8 п.3–6 | лимиты §6.3/§7.4, `--isolated`, порты по ролям |
| R11 | Детерминизм времени и локали (`hhmm()`, приветствие, U+00A0, `localeCompare`) | 07 §16 п.16–17 | `page.clock` на обеих целях, `ru-RU`/`Europe/Moscow` в проектах, `check-icu` в CI (П13, П18) |
| R12 | Карта вкладок ремонта — самый большой фрагмент (≈ 900 строк, CPM-планировщик с drag) | 00 §10 п.3; 06b §2 | WS-32 на готовой карте 06b (§18 — 47 пунктов, §20 — деление a–f, контрольные числа); 4 обязательных снимка «График»; drag по 06b §20 п.7 |
| R13 | `kb-conflict` и часть пустых состояний невоспроизводимы на эталоне | 06 §14 Q1; 04 Q13 | `kind: no-reference` в allowlist с D-26; сценарные оверлеи для пустых состояний (WS-05) |
| R14 | Keycloak (~1 ГБ JVM) замедляет `e2e:full` | 12 §7 Q11 | профиль только под `@keycloak`, остальной стенд через dev-провайдер (D-41) |
| R15 | PostgreSQL 17 vs миграции, проверенные на 16.4 | 09 DP-14 | первый прогон миграций на 17 — тест WS-41; CI-job на 16.4 до пилота (D-38) |
| R16 | Ревью-мощность: 2 ревьюера нужны WS-03, 15, 41, 42, 48, 54, 56, 65, 67 | §5.1 | второй ревьюер только по authz/миграциям/финансам/`permissions.yaml`; в волне 2 одновременно ≤ 2 таких WS |

### 10.2 Расхождения прототипа с документами, реализуемые «как в прототипе» до решения владельца

Все строки Q-01…Q-120 `decisions.md` с «Как в прототипе» действуют без оговорок; ключевые для снимков: 4 чипа статусов тенанта и тексты баннеров (Q-01/02); «Продлить пробный период» для `active`/`suspended` (Q-05); разные пороги полос 85 %/80 % (Q-07); понижение тарифа сразу (Q-12); «100 ГБ»/«ГБ» (Q-13); «Приглашение до 08.10» через `clock + 7 дн.` (Q-15); шлюз по персоне для страниц владельца (Q-20); две формулы буквы-аватара (Q-25); крошка «Компания» (Q-26); несклоняемые строки (Q-29); утечки сида в «Лотос» (Q-31); таблицы со скроллом (Q-41); «Автомобили» (Q-40); 9 состояний рейса (Q-45); подписи фото из `photoVM` (Q-46); 2 категории расходов (Q-48); `reservedUntil '09:30'` (Q-50); отметки остановок только в клиенте (Q-52); начисление автоматически при приёмке (Q-55); `ownerScope` только подпись (Q-64); «по v—» (Q-67); disabled-заглушки (Q-69); `hiddenNote` владельцу (Q-75); готовность по м² (Q-78); `module_readonly` баннер только для логистики (Q-79). Отклонения, принятые как ошибки прототипа (Q-30, D-27): `formsVM` при `forms: []`, дефолты Лотоса, `confirmTrialEnd` с жёстким id, `onRevoke`, `brDraft` в `INITIAL()`, `s.w → W`; каждое — строка allowlist `kind: state` с D-27, если меняет снимок.

### 10.3 Новые решения D-25…D-52 (вносит WS-00 в `decisions.md`; нумерация продолжает D-24)

| ID | Вопрос | Решение по умолчанию | Источник | Блокирует |
|---|---|---|---|---|
| D-25 | URL-схема и адрес тенанта | `/t/:tenantId/:page`, `/platform/:page`, параметры страниц в search (§4.7); один origin; ADR-0001 до волны 0 | C D-25; 12 §7 Q1; Q-101 | WS-07 (`baseURL`), WS-10, WS-40 |
| D-26 | Пресеты адаптера vs UI-шаги для эталона | рецепты §2.4 исполняются одинаково на эталоне и в реализации в `visual`/`labels`; пресеты — только предусловия e2e; невоспроизводимое на эталоне — `no-reference` | 03 §16 п.3; 07 §16 п.5 | WS-06, WS-07 |
| D-27 | Ошибки прототипа | падения и невалидные дефолты исправляются (Q-30), утечки сида повторяются (Q-31), `s.w → W`; каждое отклонение — allowlist с D-27 | 00 §10 п.5 | WS-05, WS-10, WS-20, WS-25 |
| D-28 | Канон визуала при расхождении CRM ↔ `tokens.json` | рендер `Ортус CRM.dc.html` (литералы `:root`, `LINE`, 36/40 px, радиусы, скролл таблиц); токены дополняются `prototype`-алиасами | Q-32, Q-33, Q-41 | WS-04, WS-12, WS-13 |
| D-29 | Невидимые добавки a11y из `components.md` | реализуются; элементы с `data-a11y-extra="D-29"`, нулевой пиксельный след, исключаются из `collectLabels` | Q-34 | WS-10, WS-12 |
| D-30 | Детерминированные UUID Go-сида | UUID v5 от `ortus:<tenant>:<prototype-id>`; `Р-208` → номер `core.counters` с картой в `snapshot.json` | DP-15; Q-97 | WS-52 |
| D-31 | Эквиваленты демо-флагов в фазе 2 | `offline` → `context.setOffline(true)`; `conflictNext`/`failUploadNext` → заголовок `X-Test-Scenario`, принимаемый только при `APP_ENV=e2e` | B D-31; 07 §16 п.8; 09 §10 п.20 | WS-40, WS-47, WS-53 |
| D-32 | Пиксельные baseline по платформам | `{platform}` в пути; канон — Linux-CI; `labels` обязательна | Q-103 | WS-07 |
| D-33 | Состав OpenAPI 0.2 | core (WS-03) и delta (WS-15) по §4.1 | 10 §7.4 | WS-03, WS-15 |
| D-34 | `Problem.code` enum и каталог прав | 36 + `seats_exhausted`, `request_pending`, `tier_below_usage`, `upload_failed`, `not_implemented`; каталог + G-21 | Q-82; DP-02…04 | WS-03 |
| D-35 | Статусы тенанта | backend 8 состояний ТЗ; UI — 4 чипа прототипа (`grace`/`read_only` → `restricted`, `trialing` → `trial`); подписи для прочих — `texts/platform.ts` «не из источников» | Q-01, Q-02 | WS-27, WS-43 |
| D-36 | Дочерний макет «Ремонт и стройка» | 9 embedded-вкладок в WS-32 по карте 06b; standalone-режим (шапка, «Заявки», карточка «Готовность по закрытым актам», 06b §18 #6–9) вне объёма; файл хостится как есть в документации | 06b §2, §19 п.1; Q-74 | WS-31, WS-32, WS-11 |
| D-37 | `data-screen-label` | 6 значений дословно + схема «<Роль> · <подпись меню>» для остальных; список в `texts/screen-labels.ts` | Q-43; 00 G3 | WS-08 |
| D-38 | Версии и команды | pnpm 9, Node 22 LTS, Go последний стабильный, PostgreSQL 17 (+ CI-job 16.4 до пилота); `npm run X` ≡ `pnpm X` через корневой `package.json` | Q-106; 12 §7 Q8 | WS-01, WS-02, WS-41 |
| D-39 | Экранные тесты фазы 1 | in-memory адаптер с нулевыми задержками (без MSW); с волны 2 те же тесты повторно гоняются против `http + MSW` (CI `screens-http`) — тем самым `tdd-protocol.md` §3 выполняется на http-слое | `tdd-protocol.md` §2 шаг 7 | WS-20…32, WS-51 |
| D-40 | Два интегратора в волне 2 | да (UI / backend), порядок ребейза — DAG §6.1 | `orchestration.md` §3 | волна 2 |
| D-41 | Keycloak | WS-54 в волне 3 по решению владельца; `e2e:full` на dev-провайдере; профиль только под `@keycloak` | D-18; Q-109 | WS-54 |
| D-42 | Скилы React | подмножество `vercel-react-best-practices` без Next-правил в `frontend/CLAUDE.md`; `heroui-react` — справочник | 12 §4 | WS-01 |
| D-43 | Примеры контракта | рукописные в волне 0; с волны 2 `ok`/`empty` — снимки сценарного сервера на сиде (`make examples`), ajv-валидация, CI `examples-fresh` | B D-32 | WS-03, WS-51 |
| D-44 | Демо-панель, гид, кнопки «Демо: …» | переносятся как нарисовано в компоненте `DemoOnly` (только `VITE_ADAPTER=mock`); в http-сборке отсутствуют; e2e фазы 1 на них опирается | Q-44; 00 G5 | WS-10, страницы |
| D-45 | Рецепт снимка | viewport = ширина проекта, «Ширина = По окну», панель скрыта, `page.clock` `2026-10-01T10:30:00+03:00` на обеих целях, `ru-RU`, `Europe/Moscow` | 00 §10 п.5; 07 §16 п.17 | WS-07 |
| D-46 | Сид фазы 2 и инварианты канона | Go-сид = снапшот прототипа по видимым полям (`finance.read` у «Марина Котова» как явное назначение); DP-07 (≥ 2 владельца), DP-10 — пороги из конфигурации: `APP_ENV=e2e` → как в прототипе, `prod` → канон; эталон `labels`/visual в `e2e:full` — mock-сид; расхождения стенда — allowlist `mode: stand` с D-46 | Q-11, Q-22; 09 §10 п.25 | WS-42, WS-52, WS-53, WS-67 |
| D-47 | Один `StrictServerInterface` на модули | кодоген по тегам в `internal/api/<tag>/`, композитный роутер у интегратора, `notimpl` 501 для нереализованных тегов; после волны 0 контракт только аддитивный, перегенерация интегратором на барьере | П11 | WS-03, WS-40, интегратор |
| D-48 | Истории без UI в прототипе | S1-10 → WS-72 backend-only; S1-07 → `getMyContext.tenants[]` + `selectTenant` (WS-40), UI-переключатель не рисуется (демо-селект); S1-22 → страница `modules`; Q-03/Q-04 → backend-only | П3; 13-backlog | WS-40, WS-72 |
| D-49 | Изоляция проверяющих | порты §7.4, свой MCP-инстанс `--isolated`, `E2E_FRESH_SERVER=1`, ≤ 6 параллельных проверяющих, ≤ 10 исполнителей | 12 §8 п.4–6 | WS-07, интегратор |
| D-50 | Allowlist | файл на ключ `e2e/visual/allowlist/<key>.md`, формат §4.8, обязательный D-ID/Q-ID, `allowlist-lint` в CI, рост публикуется на барьере волны | П9 | WS-01, WS-07, страницы |
| D-51 | Диапазоны миграций | §4.11; файл изоляции на модуль | C §5.2 | WS-41, backend-WS |
| D-52 | Схемы отчёта/вердикта | расширить `mode` (`mock`/`stand`), `phase` (1/2), `evidenceDir` с `/phase2/`; `status.md` — колонки evidence фазы 1 и 2 | П20 | интегратор волны 0 |

---

## 11. Критерии готовности фаз

### 11.1 Фаза 1 (UI на mock-адаптере) готова, когда

- Все 24 ключа `pg.*`, `repair-tabs`, `shell`, 6 модалок и 6 ключей документации имеют: `e2e/<key>.spec.ts` без `fixme` (кроме стенд-пунктов S3+ по §1.4 е), `visual`/`labels` в допуске 1 % или в allowlist с D-ID, `docs/plan/evidence/<key>/` с тремя ширинами и эталоном, вердикт `accept` независимого проверяющего, ревью `approve`; `status.md` — «готово» для WS-00…WS-32, WS-40, WS-41, WS-51.
- `pnpm e2e` зелёный на `mobile-390`, `tablet-768`, `desktop-1440`; `apps/docs` — на 4 проектах; `pnpm test` (домен ≥ 90 %); conformance-suite 51/51 методов против mock и `http + MSW`; `screens-http` зелёный.
- «Путь проверки» (8 шагов + 7 негативных) и J1–J18 проходят UI-шагами в mock-режиме (WS-55 может закрыться в волне 3, но `guide-path @smoke` обязателен к барьеру 2→3).
- Критик волны 2 не нашёл пропусков против 00 §3.1–3.5 и §4.9; allowlist опубликован.

### 11.2 Фаза 2 (backend платформы и логистики) готова, когда

- `pnpm e2e:full` зелёный на 11 страницах S0–S2 без правок spec'ов; `evidence/<key>/phase2/` для них; `mock-vs-http.spec.ts` без расхождений; Schemathesis 0 падений; `go test -tags integration,isolation,concurrency` зелёные и блокируют merge.
- AC-01…AC-06, AC-10…AC-12 автоматизированы (выход из S1/S2 по `13-backlog`); AC-14 integration; BR-T3 contract.
- `make up && make migrate && make seed && make dev` поднимают стенд одной командой; Go-сид = `snapshot.json`; `devLogin → /me/context` через `permit()`; Keycloak — по D-41.
- Все заготовки S3+ соответствуют §1.4 (а)–(е).

### 11.3 Фаза 3 (остальные модули) готова, когда

- WS-60…WS-72 закрыты по DoD; `fixme(E2E_MODE === 'stand')` сняты во всех spec'ах; `e2e:full` зелёный на всех 24 страницах; `phase2/` evidence для всех ключей.
- AC-07, AC-08, AC-09, AC-13, AC-15, BR-T1/T2 автоматизированы; k6 p95 ≤ 500/800 мс; restore drill выполнен.
- `today-offline.spec.ts` (PWA) зелёный; уведомления и колокольчик — из серверного источника; автоматизация «осмотр → ответ → задача» на стенде.
- Критик финальной волны подтвердил: инвентарь 00 §10 п.1 покрыт целиком, allowlist не содержит записей без D-ID, `decisions.md` не содержит вопросов без владельца.

### 11.4 Что дальше (после утверждения плана)

1. WS-00 и WS-01 (один агент каждый, последовательно), затем волна 0 по §7.2; ревью волны 0 тремя ревьюерами.
2. Генерация брифов `docs/plan/ws/WS-NN-<slug>.md` из §5.4 (+ разделы отчётов, матрица §4.9, рецепты §2.4, порты §7.4).
3. Волна 1 после барьера 0→1; страницы (волна 2) стартуют pipeline-ом по мере слияния WS-10/12/13, VM-слой — раньше.
4. После барьера 2→3 — волна 3 и `e2e:full`; волна 4 — по готовности контракта и мощности.

