# Черновик A · UI-first, максимум параллельных страниц

Угол зрения: после волны контрактов (0) и волны оболочки (1) каждая группа страниц прототипа — отдельный WS на TS-порте mock-адаптера; backend стартует параллельно со страницами (с волны 1) и подключается через http-адаптер в волне 3. Протоколы `tdd-protocol.md`, `verification-protocol.md`, `orchestration.md` не переписываются — ниже только декомпозиция и привязка к ним.

Опора: `analysis/00-coverage-critique.md` §10 (ground truth: 25 ключей страниц, 6 модалок, 35 VM, 51 метод адаптера, 8 персонажей, 2+2 организации); `decisions.md` PD-13…PD-22; `design/docs/14-engineering.md` (стек, структура репозитория); `design/docs/13-backlog-s0-s2.md` (S0–S2).

Ключевые решения угла A (кратко, обоснование в §5):

1. Контракт для страниц в фазе 1 — не OpenAPI, а TS-интерфейс `AdapterPort` (53 метода из `07 §16.1`), опубликованный в волне 0 вместе с типами домена и сидом. Страницы зависят от OpenAPI только через http-адаптер в волне 3. Это снимает критический путь «OpenAPI-дельта → страницы».
2. Mock-адаптер переносится 1:1 (`07 §3–5`: guards, `cmd`, `view()`, флаги, `opId`, `recordInspection`) как исполняемая спецификация сервера; его unit-тесты (`07 §14`, 62 пункта) позже гоняются и против http-адаптера (conformance-suite, волна 3).
3. Оболочка и `@ortus/ui` разнесены на три WS волны 1 (shell / ui-core / ui-domain) и собираются по стаб-контракту пропсов из волны 0 (`components.md:15–44`, `11 §4`).
4. Страницы — 14 WS волны 2 с непересекающимися каталогами `apps/web/src/routes/<group>/`; file-based routing TanStack (сгенерированный `routeTree.gen.ts` не коммитится) — нет общего реестра маршрутов, который бы правили 14 агентов.
5. Backend идёт по S0–S2 в волнах 1–3 параллельно страницам; стык — волна 3 (http-адаптер + Go-сид + `e2e:full`).

---

## 1. Структура репозитория (до 3 уровней) и владельцы

Корень — `D:\work\test26042026_Kirill_3.0` (сейчас только `.claude/skills`, `design/`, `docs/plan`, `tools/` — `12 §8.1`). Владелец каталога = единственный WS, который пишет в него в своей волне (`orchestration.md` §1). Общие точки правит только интегратор после закрытия WS-владельца.

```text
ortus/
├─ .github/workflows/ci.yml            WS-01   (PD-20 GitHub Actions; конвейер 14-engineering «Конвейер CI»)
├─ .claude/settings.json               WS-01   (PostToolUse-формат R13; Stop → tools/verify-pages.js — verification-protocol §6)
├─ .husky/, .lintstagedrc, prettier, eslint, .gitattributes, .editorconfig   WS-01 (R9)
├─ .mcp.json                           WS-07   (@playwright/mcp pin, R1; npm run mcp:install)
├─ CODEOWNERS, CLAUDE.md, README.md, Makefile, package.json, pnpm-workspace.yaml   WS-01
├─ api/
│  ├─ openapi/ortus.yaml               WS-03   (v0.1 → v0.2: auth G-01, errors enum G-20, S0–S2 операции; дельта S3+ — WS-15)
│  ├─ permissions.yaml                 WS-03   (= docs/11-permissions.yaml + spa/cash/inventory/branding, G-21)
│  ├─ errors.yaml                      WS-03   (36 кодов 12-errors + DP-02 → enum, константы Go/TS)
│  └─ spectral.yaml                    WS-03
├─ backend/                            go.mod — WS-01; остальное по модулям
│  ├─ cmd/api/                         WS-40
│  ├─ cmd/{migrate,provisioner}/       WS-41
│  ├─ cmd/worker/                      WS-45
│  ├─ cmd/seed/                        WS-52   (Go-сид = TS-снапшот, PD-19)
│  ├─ internal/api/                    WS-03   (сгенерировано oapi-codegen, не редактируется)
│  ├─ internal/platform/{httpx,problem,requestid,session,tenantctx,idem,clock,pipeline}/   WS-40
│  ├─ internal/platform/authz/         WS-42   (CODEOWNERS, 2 ревьюера)
│  ├─ internal/platform/{storage,events,audit}/   WS-45
│  ├─ internal/control/                WS-43
│  ├─ internal/modules/{access,org,people}/       WS-44
│  ├─ internal/modules/{modulesreg,files}/        WS-45
│  ├─ internal/modules/fleet/          WS-46/47/48/49 по подкаталогам (vehicles,routes,reservations | inspections,trips | review,expenses,earnings | pool)
│  ├─ internal/modules/sched/          WS-46 (бронь) ; S3+ остальное
│  ├─ internal/modules/data/           WS-50
│  ├─ migrations/{control,tenant}/     WS-41   (CODEOWNERS)
│  └─ test/{isolation,concurrency,contract}/   WS-07 (харнесс, TestMain), фикстуры — WS-42
├─ deploy/compose/                     WS-02   (docker-compose.yml, .env.example, keycloak/ realm-файлы под профилем)
├─ design/                             никто   (эталон неприкосновенен, orchestration §7)
├─ docs/
│  ├─ plan/{ws,reports,evidence,critique,status.md}/   планировщик → исполнители (свой WS-файл) → интегратор
│  └─ adr/                             интегратор
├─ frontend/
│  ├─ apps/web/
│  │  ├─ src/app/                      WS-10   (router, providers, adapter switch VITE_ADAPTER, clock)
│  │  ├─ src/shell/                    WS-10   (AppShell, header, nav, bottom nav, sheet, banners, gate, toast, modal container, confirm)
│  │  ├─ src/demo/                     WS-10   (панель «Демо-режим», «Путь проверки», presets — только в mock-сборке)
│  │  ├─ src/modals/people/            WS-14   (assign, invite, createRole)
│  │  ├─ src/routes/company/           WS-20   (modules, users, billing)
│  │  ├─ src/routes/branding/          WS-21
│  │  ├─ src/routes/logistics/manager/ WS-22   (fleet, pool, review, modal request)
│  │  ├─ src/routes/logistics/driver/  WS-23   (today, cars, photo, outbox)
│  │  ├─ src/routes/home/              WS-24
│  │  ├─ src/routes/forms/             WS-25
│  │  ├─ src/routes/tasks/             WS-26
│  │  ├─ src/routes/platform/orgs/     WS-27   (tenants, usage, requests)
│  │  ├─ src/routes/platform/accounts/, platform/plans/   WS-28
│  │  ├─ src/routes/core/              WS-29   (calendar, knowledge, data, files)
│  │  ├─ src/routes/spa-cash/          WS-30   (spa, cash)
│  │  ├─ src/routes/repair/            WS-31   (объект: шапка, обзор, работы)
│  │  ├─ src/routes/repair/child/      WS-32   (9 встроенных вкладок «Ремонт и стройка»)
│  │  ├─ src/routes/planned/           WS-33
│  │  ├─ src/routeTree.gen.ts          генерируется, в .gitignore
│  │  ├─ e2e/{fixtures,visual/_helpers,smoke}/, playwright.config.ts   WS-07
│  │  ├─ e2e/<page-key>.spec.ts, e2e/visual/<page-key>.{visual,labels}.spec.ts   WS-владелец страницы
│  │  └─ mocks/                        WS-51   (MSW из примеров OpenAPI — только для http-адаптера)
│  ├─ apps/docs/                       WS-11   (читалка документации; public/design/ — копия эталона + локальный React, PD-16)
│  └─ packages/
│     ├─ tokens/                       WS-04   (tokens.json → CSS/TS; fonts/ OFL — PD-21)
│     ├─ ui/src/index.ts, ui/src/types/   WS-04   (контракт пропсов 30 компонентов, стабы)
│     ├─ ui/src/core/                  WS-12   (Button … Tabs, 15 строк контракта, ≈ 22 компонента с учётом вариантов полей)
│     ├─ ui/src/domain/                WS-13   (CheckList, LoadBar, PhotoSlot, SyncState, Stepper, ConflictNotice, ReadinessBar, DecisionQueue, ObjectHeader, DataTable)
│     ├─ domain/                       WS-05   (types.ts, models/*.ts, seed/*.ts, seed/snapshot.json, adapter.port.ts)
│     ├─ adapter/src/mock/             WS-06   (порт api.js)
│     ├─ adapter/src/http/             WS-51
│     ├─ adapter/test/conformance/     WS-06 (пишет), WS-51 (гоняет против http)
│     ├─ api-client/                   WS-03   (openapi-typescript + openapi-fetch, не редактируется)
│     └─ texts/src/<domain>.ts         WS-08 создаёт все файлы; далее каждый файл — владелец страницы (только добавление ключей)
└─ tools/
   ├─ design-preview.js                есть (эталон на 4173)
   ├─ verify-pages.js, e2e-skeleton.js, vendor/react*.js   WS-07
   └─ sync-design.js                   WS-11
```

---

## 2. Таблица WS

### 2.1 Сводная таблица

Размер: S ≈ 1 сессия агента, M ≈ 2–3, L ≈ 4–6 (относительно). «Зависит от» — WS, которые должны быть влиты в `main` до старта.

| id | slug | волна | цель (1 строка) | размер | зависит от | блокирует |
|---|---|---|---|---|---|---|
| WS-01 | repo-skeleton | 0 | Репозиторий, workspace, линтеры, хуки, CI, CLAUDE.md, CODEOWNERS | M | — | все |
| WS-02 | compose-stand | 0 | Локальный стенд compose (postgres 17, minio, mailpit, otel; keycloak по профилю) | S | WS-01 | WS-40, WS-41, WS-53 |
| WS-03 | contract-core | 0 | OpenAPI v0.2 (ядро + логистика + auth), permissions, errors enum, `make gen`, Spectral, drift-CI | L | WS-01 | WS-15, WS-40…WS-50 |
| WS-04 | tokens-ui-contract | 0 | `@ortus/tokens` (CSS/TS, локальные шрифты), контракт пропсов и стабы 30 компонентов `@ortus/ui`, Storybook-каркас | M | WS-01 | WS-10…WS-14, WS-11 |
| WS-05 | domain-seed-port | 0 | `packages/domain`: типы, 25 функций + 22 справочника `models.js`, TS-сид (t-alta, t-lotos, platform), снапшот ID, интерфейс `AdapterPort` | M | WS-01 | WS-06, WS-10, WS-14, WS-20…33, WS-52 |
| WS-06 | mock-adapter-port | 1 | `packages/adapter/mock`: порт `api.js` 1:1 + conformance-suite (62 кейса 07 §14) + presets для e2e | M | WS-05 | WS-20…WS-33 |
| WS-07 | e2e-harness-mcp | 0 | Playwright config (3 проекта), фикстуры demo/reference/axe, визуальные хелперы, генератор e2e-скелета, Playwright MCP, `verify-pages.js`, Go-харнесс `test/` | M | WS-01 | WS-10…WS-33, WS-40+ |
| WS-08 | texts-dictionary | 0 | `packages/texts`: дословные строки прототипа по доменам (тосты, ошибки, баннеры, гейт, подписи кнопок) из отчётов 01–06 | M | WS-01 | WS-10…WS-33 |
| WS-10 | shell | 1 | Оболочка: роутер, персонажи, шапка (светлая/тёмная), nav/rail/нижняя, sheet, баннеры, AccessGate, тост, модальный контейнер + `confirm`, демо-панель, гид, офлайн | L | WS-04, WS-05, WS-07, WS-08 | WS-20…WS-33 |
| WS-11 | docs-site | 1 | `apps/docs`: читалка `Документация.dc.html` в React+TS; хостинг 3 фреймов + `Ремонт и стройка` + `support.js` с локальным React | L | WS-04, WS-07 | — |
| WS-12 | ui-core | 1 | базовые компоненты `@ortus/ui` (15 строк контракта, ≈ 22 с вариантами полей) с состояниями, Storybook, axe | M | WS-04 | WS-10 (визуал), WS-20+ |
| WS-13 | ui-domain | 1 | 10 доменных компонентов (`CheckList`, `LoadBar`, `PhotoSlot`, `SyncState`, `Stepper`, `ConflictNotice`, `ReadinessBar`, `DecisionQueue`, `ObjectHeader`, `DataTable`) | M | WS-04 | WS-22…WS-31 |
| WS-14 | modals-people | 1 | Диалоги «Назначить роль», «Пригласить участника», «Создать роль» (01 §14.3–14.5) | S | WS-04, WS-05, WS-08 | WS-20, WS-24 |
| WS-15 | contract-delta | 2 | OpenAPI-дельта для S3+ экранов: branding, billing-заявки, platform (usage/requests/accounts/operators/price-book), tasks/forms/kb/calendar/spa/cash/repair (10 §7.4 G-02…G-19) | M | WS-03 | WS-51, WS-60+ |
| WS-20 | company | 2 | Страницы «Модули и место», «Пользователи и роли» (4 вкладки + редактор роли), «Подписка и места» | L | WS-06, WS-10, WS-12, WS-14 | WS-51 |
| WS-21 | branding | 2 | Страница «Оформление» (редактор, палитра, меню, предпросмотр, версии) | M | WS-06, WS-10, WS-12 | — |
| WS-22 | logistics-manager | 2 | «Рабочее место логиста», «Ресурсный пул» (+ modal `request`), «Приёмка смен» | L | WS-06, WS-10, WS-12, WS-13 | WS-51 |
| WS-23 | logistics-driver | 2 | «Сегодня» (9 состояний рейса, фото, расходы, сдача, outbox/офлайн), «Автомобили» | L | WS-06, WS-10, WS-12, WS-13 | WS-51 |
| WS-24 | home | 2 | «Главная»: приветствие, «Начало работы», «Требует решения», «Сегодня в работе», «Рейсы сегодня», «Последние события» | M | WS-06, WS-10, WS-12, WS-13, WS-14 | — |
| WS-25 | forms | 2 | «Формы и опросы»: список, конструктор, публикация, версии, ответы | M | WS-06, WS-10, WS-12 | — |
| WS-26 | tasks | 2 | «Задачи»: канбан/список, новая задача, карточка, переходы, чек-лист, комментарии, ссылки | M | WS-06, WS-10, WS-12 | — |
| WS-27 | platform-orgs | 2 | Оператор: «Организации», «Использование», «Заявки на тариф», диалог `opConfirm` | M | WS-06, WS-10, WS-12, WS-13 | — |
| WS-28 | platform-accounts-plans | 2 | Оператор: «Пользователи» (realm, организации, поповер, карточка), «Тарифная сетка» (черновик, публикация) | M | WS-06, WS-10, WS-12, WS-13 | — |
| WS-29 | core-modules | 2 | «Календарь», «База знаний», «Данные», «Файлы» | M | WS-06, WS-10, WS-12, WS-13 | — |
| WS-30 | spa-cash | 2 | «Салон и SPA» / «Мой день», «Внутренняя касса» | M | WS-06, WS-10, WS-12 | — |
| WS-31 | repair-object | 2 | «Объекты»: ObjectHeader, вкладки «Обзор», «Работы», стык с дочерним макетом (`onStatus`) | M | WS-06, WS-10, WS-12, WS-13 | — |
| WS-32 | repair-child | 2 | 9 встроенных вкладок «Ремонт и стройка» (Замер … Кабинет заказчика, Гант) — локальное состояние, без API | L | WS-04, WS-12 | WS-31 (финальный визуал) |
| WS-33 | planned-page | 2 | `pg.planned` + порт `roadmap.js`, доступ только по прямому URL (G1, решение PD-24) | S | WS-10 | — |
| WS-40 | backend-platform | 1 | `cmd/api`: chi + strict server, middleware (RequestID, Logging, CSRF, Problem, Cache-Control), сессия dev-провайдера BFF (PD-18), tenant resolver, `/me/context` | M | WS-02, WS-03 | WS-42…WS-50 |
| WS-41 | migrations-provisioner | 1 | goose: control 0001–0003, tenant 0001–0002 из `design/docs/db`, 0003 для разрывов (09 §7.1), controller по тенантам, `cmd/migrate`, `cmd/provisioner` | M | WS-01, WS-02 | WS-42, WS-43, WS-52 |
| WS-42 | authz | 2 | `permit()`, `scopeQuery()`, `explainAccess`, policy_version, фикстуры изоляции (15-quality «Фикстуры изоляции») | L | WS-03, WS-40, WS-41 | WS-44…WS-50 |
| WS-43 | control-tenants | 2 | S1-01…S1-04: создание организации, статусы, продление trial, аудит control DB | M | WS-40, WS-41 | WS-52 |
| WS-44 | access-people-org | 2 | S1-06…S1-16: приглашения, членства, регионы/фирмы, карточки, роли (ETag), назначения, последний владелец | L | WS-42 | WS-46+ |
| WS-45 | modules-files-services | 2 | S1-17…S1-26: каталог модулей, отключение/draining, trial/grace/read_only, upload session (MinIO), аудит, outbox worker, idempotency, inbox | L | WS-42 | WS-47 |
| WS-46 | fleet-core | 3 | S2-01…S2-03: машины, подбор `compat`, бронь с hold, AC-03 (100 броней → 1×201 + 99×409) | M | WS-44 | WS-47 |
| WS-47 | fleet-shift | 3 | S2-04…S2-09: чек-лист осмотра, 5 фото, дефекты, старт рейса, расходы, сдача, AC-04 | L | WS-45, WS-46 | WS-48 |
| WS-48 | fleet-review-earnings | 3 | S2-10…S2-13: приёмка/возврат по разделам, проверка расходов, начисления (AC-05, изоляция по каналам), планирование | M | WS-47 | — |
| WS-49 | fleet-pool | 3 | S2-14: пул водителей, временный grant, автозавершение (AC-06) | M | WS-44 | — |
| WS-50 | datasets | 3 | S2-16: наборы «Машины», «Рейсы», «Расходы» в Data Hub с правами и 404 на count | S | WS-42, WS-46 | — |
| WS-51 | http-adapter | 3 | `packages/adapter/http` по OpenAPI (openapi-fetch), MSW из примеров, conformance-suite против Go, `VITE_ADAPTER=http` | M | WS-15, WS-20, WS-22, WS-23, WS-40…WS-45 | WS-53 |
| WS-52 | go-seed | 3 | `cmd/seed`: демо-холдинг = TS-снапшот ID (PD-19, DP-15), `make seed` | S | WS-05, WS-41, WS-43 | WS-53 |
| WS-53 | e2e-full-stand | 3 | `npm run e2e:full`: compose `--profile e2e`, миграции, сид, те же spec'и против backend; CI-этап e2e | M | WS-02, WS-51, WS-52, WS-46…WS-48 | — |
| WS-54 | keycloak-oidc | 3 | S1-05: OIDC Code + PKCE через Keycloak, realm-файлы, профиль compose (D-03, PD-18) | M | WS-40 | — |
| WS-60…67 | backend S3+ | 4 | forms, tasks, knowledge, calendar, spa+inventory, cash, repair, branding+billing-заявки+platform-ops — по WS на модуль (миграции 0003+, операции из WS-15) | M–L каждый | WS-15, WS-45 | — |
| WS-68 | pwa-offline | 4 | S2-15: Workbox, офлайн-черновики осмотра/расходов, очередь с явными статусами | L | WS-23, WS-47 | — |
| WS-69 | load-restore | 4 | k6 по профилю пилота, restore drill одного тенанта (AC-15) | M | WS-53 | — |

### 2.2 Покрытие инвентаря (проверка полноты)

| Что | Где | Покрыто WS |
|---|---|---|
| 25 ключей страниц (00 §3.1) | `home modules users billing branding` → WS-24/20/20/20/21; `fleet pool review` → WS-22; `today cars` → WS-23; `tenants usage requests` → WS-27; `accounts plans` → WS-28; `forms` → WS-25; `tasks` → WS-26; `calendar knowledge data files` → WS-29; `spa cash` → WS-30; `repair` → WS-31 (+WS-32); `planned` → WS-33 | 25/25 |
| 6 модалок (00 §3.2) | `confirm`, `sheet` → WS-10; `assign`, `invite`, `createRole` → WS-14; `request` → WS-22 | 6/6 |
| 35 VM (00 §3.3) | `toastVM guideVM shellVM gateVM bannersVM modalVM planVM` → WS-10/33; остальные 28 — в `vm/` страничных WS | 35/35 |
| 51 метод адаптера (00 §3.4) | `AdapterPort` (WS-05) + мок (WS-06) + http (WS-51) | 51/51 |
| 2 приложения | CRM — `apps/web`; документация — `apps/docs` (WS-11) | 2/2 |
| backend S0–S2 (13-backlog) | S0-01…09 → WS-01…07, 41; S1-01…30 → WS-40…45 (S1-27…30 оболочка — WS-10); S2-01…16 → WS-46…50, 68 | 55/55 историй |
| S3+ | WS-60…67 заготовки | по модулям |

### 2.3 Карточки WS

Полные брифы — `docs/plan/ws/WS-NN-<slug>.md` (следующий шаг после утверждения плана). Здесь — границы, входы, выходы, контракты, экраны/операции, тесты-первыми.

#### WS-01 repo-skeleton · волна 0 · M
- Владеет: корень (кроме `design/`, `docs/plan/analysis`), `.github/`, `.husky/`, `backend/go.mod`, `backend/.golangci.yml`, `frontend/package.json`, `pnpm-workspace.yaml`, `CLAUDE.md`, `CODEOWNERS`.
- Входы: `14-engineering.md` «Структура репозитория», «Конвейер CI»; `12 §3.2` R9–R11, R13, R18; `12 §3.6` (PowerShell 5.1, BOM, `eol=lf`); `12 §8` п.2, 8, 25–27.
- Выходы: `git init` + `main`; pnpm workspace; `Makefile` (`gen/migrate/seed/up/dev/test`); ESLint flat (typescript-eslint, react-hooks, jsx-a11y, testing-library, playwright); Prettier 100; husky/lint-staged (два конфига); `.golangci.yml` v2 с `depguard` strict allow-list (12 §8.8); CI lint → contract → unit → integration → isolation+concurrency → build → e2e → visual; `.claude/settings.json` (PostToolUse-формат + Stop-хук, заглушка до WS-07); `CLAUDE.md` с таблицей «файл → что протухает» (R18) и подмножеством `vercel-react-best-practices` (PD-42); CODEOWNERS (`authz/**`, `migrations/**`, `finance*`, `permissions.yaml`).
- Контракты: публикует команды `pnpm lint|typecheck|test|e2e`, `go -C backend test ./...`; порядок этапов CI.
- Тесты-первыми: grep-тест «нет литералов `:5173`/`:3000` в e2e» (12 §6.4); тест «каждая заглушка WS несёт `Owner: WS-NN`» (12 §3.5 п.2); тест CI-конфига на порядок этапов; `golangci-lint config verify` (12 §6.13); `depguard` обе стороны (12 §6.14).

#### WS-02 compose-stand · волна 0 · S
- Владеет: `deploy/compose/`.
- Входы: `design/docs/repo-skeleton/{docker-compose.yml,.env.example}`; `12 §3.2` R8, R17; `12 §8` п.23–24.
- Выходы: `docker-compose.yml` (loopback-порты, healthcheck, `postgres-test` под `profiles:[test]` на 5433 tmpfs, `keycloak` под `profiles:[keycloak]`, `minio-init`/`seed` одноразовые вне `--wait`, mailpit, otel-collector; образы по digest — PD-38); `.env.example` с комментариями.
- Тесты-первыми: `make up` + smoke-скрипт `tools/stand-check.ps1|sh` (pg_isready, minio health, mailpit 8025); Go-харнесс WS-07 «падает, не skip, без базы» (12 §6.11).

#### WS-03 contract-core · волна 0 · L · 2 ревьюера
- Владеет: `api/`, `backend/internal/api/` (генерация), `frontend/packages/api-client/`.
- Входы: `design/docs/v0.1/ortus-openapi-v0.1.yaml`; `10 §4–§6` (118 операций, 199 схем, Idempotency-Key/If-Match/Problem); `10 §7.4` G-01, G-11, G-20, G-21, G-22; `09 §5.2` (36 кодов), `09 §4.2` (77 ключей), `09 §4.4` (`prototype_renames`); `07 §6` (коды мока ↔ реестр); DP-01…DP-05; PD-17, PD-33, PD-34.
- Выходы: `ortus.yaml` v0.2-core (все операции v0.1 + auth-поверхность dev-провайдера `/auth/dev/login|logout|csrf` + fleet-пробелы G-11 + `Problem.code` enum + `x-permissions` только из каталога); `permissions.yaml` (каталог + `spa.*`, `inventory.*`, `cash.*`, `branding.*` + полный `prototype_renames`, включая 13 ключей без соответствия); `errors.yaml`; `spectral.yaml` (словарь `x-scope`, 10 Q10); `make gen` (oapi-codegen strict, openapi-typescript, константы прав/кодов Go+TS); CI-шаг drift.
- Контракты: публикует `operationId`-ы, типы DTO, константы `PERM.*`, `ERR.*`.
- Операции: все 118 v0.1 + auth + G-11 (`defect-decision`, `rework`, назначение машины).
- Тесты-первыми: Spectral + полный валидатор 3.1 (первый прогон — 10 §12.2); «каждый `x-permissions` ∈ каталог»; «каждый код `12-errors` ∈ enum»; drift (`git diff --exit-code` после `make gen`, 12 §6.17); табличный Go-тест маппинга доменных ошибок → `Problem.code` (интерфейс-заглушка).

#### WS-04 tokens-ui-contract · волна 0 · M
- Владеет: `packages/tokens/`, `packages/ui/src/{index.ts,types/}`, `packages/ui/.storybook/`.
- Входы: `design/docs/design-system/{tokens.json,tokens.css,components.md}`; `11 §3` (каталог токенов, соответствие хексов), `11 §4` (контракты 30 компонентов), `11 §8` (шрифты), `11 §11` Q1–Q5; `01 §22` п.9, 16–18; PD-13, PD-21, PD-28.
- Выходы: `tokens.css`/`tokens.ts` из `tokens.json` (генератор); добавочные токены прототипа (`--ox-accent-tint`, `LINE`-границы, высоты 36/40, радиусы 14/16) с пометкой «prototype» (PD-28); `@font-face` Golos Text 400–700, IBM Plex Mono 400/500, Material Symbols Rounded variable (локально, OFL); TS-типы пропсов 30 компонентов + стаб-реализации (рендерят `children`, `data-stub`); Storybook-каркас.
- Контракты: экспорт-лист `@ortus/ui` заморожен на волну 1; переменные `--ox-*`.
- Тесты-первыми: снапшот генератора токенов (каждая запись `tokens.json` → переменная); «шрифты загружаются офлайн» (Playwright `document.fonts.check`); tsc-компиляция стабов; «стаб не содержит литералов цвета».

#### WS-05 domain-seed-port · волна 0 · M
- Владеет: `packages/domain/`.
- Входы: `design/ortus/{models.js,mock-data.js,extra-data.js}`; `07 §8` (25 функций, ≥ 60 примеров), `07 §9` (сид), `07 §10` (JSDoc → TS), `07 §11` (ключи прав ↔ канон), `07 §16` п.1–3, 17, 25; `02 §12` п.13–15; `03 §16` п.4, 7; `06 §15` п.4; PD-19, PD-27 (очистка сида Лотоса).
- Выходы: `types.ts`; `models/{structure,access,logistics,calendar,tasks,format,dicts}.ts` 1:1 к `models.js`; `seed/{alta,lotos,platform,extra}.ts` с детерминированным `fillAccounts`; `seed/snapshot.json` (все ID обеих организаций + платформы — эталон Go-сида WS-52); `clock.ts` (инжектируемое «сегодня» 2026-10-01); `adapter.port.ts` — `AdapterPort` (53 метода `07 §4.1–4.8`, `{data, db}`, `ApiError{code,message,status?,violations?,requestId?}`, `Flags`, `View`, `applyPreset`).
- Контракты: `AdapterPort` (потребляют WS-06, 10, 14, 20…33, 51), типы `Seed`/`Db`, `snapshot.json`.
- Тесты-первыми (Vitest, имена из источника): `compat` 5 проверок (Hyundai Porter/Ford Transit несовместимы с Р-208 — 01 §6); `legs`; `inspMissing` «Осталось: 1 фото»; `odoError` (+3000 км предупреждение; меньше начального — ошибка); `validateExpense` (−500 → «Сумма должна быть больше нуля»; > 200 000); `bookingConflicts`/`freeSlots` (3 слота, шаг 0,25 ч, 08–20); `can`/`canEarnings` (driver_block; `m-kotova` без назначений → `no_permission`); `rolePermKeys` 22/10/5/6; `brandVars('#1F6B52')` → `#195843/#E0EAE7/#EFF5F3`; `fixAccent('#FFD400')`; `calc` тарифов (02 §7.3); `plural/rub/num` (U+00A0); снапшот сида (10 участников, 7 машин, 2 рейса, 23 участника Лотоса, 58 аккаунтов, 6 операторов).

#### WS-06 mock-adapter-port · волна 1 · M
- Владеет: `packages/adapter/src/mock/`, `packages/adapter/test/conformance/`.
- Входы: `design/ortus/api.js` (603 строки); `07 §3` (состояние, guards, `cmd`, `recordInspection`), `07 §4` (53 метода), `07 §5` (`view()`), `07 §6` (коды), `07 §12`, `07 §14` (62 пункта), `07 §15` Q13; `03 §11.4–11.6`; `09 §10` п.19–20; PD-26.
- Выходы: `createMockAdapter({seed, clock, delays})`; задержки инжектируемые (0 в тестах); `presets`: `logistics-ready` (шаги 1–2 гида), `driver-on-route`, `shift-submitted`, `shift-accepted`, `trial-ended`, `seats-full`, `repair-on`, `kb-conflict`, `storage-full`, `empty-*`; conformance-suite — один `describe` на метод, параметризован фабрикой адаптера.
- Контракты: реализует `AdapterPort`; публикует `presets` для WS-07 и страниц.
- Тесты-первыми: guards (`offline` после задержки; `subscription_restricted`; `module_off` «Модуль «Логистика» отключён: новые операции закрыты.»); `view()` для 8 персонажей (водитель видит 5 машин и 1 рейс без `earnings`; оператор — только `platform`); `opId` повтор → `'duplicate'`; `conflictNext`/`failUploadNext` одноразовые; `recordInspection` дедуп `tripId:kind:rev`; изоляция `t-lotos` (общий `platform`, свои `members`).

#### WS-07 e2e-harness-mcp · волна 0 · M
- Владеет: `apps/web/e2e/{fixtures,visual/_helpers,smoke}/`, `apps/web/playwright.config.ts`, `apps/docs/playwright.config.ts`, `.mcp.json`, `tools/{verify-pages.js,e2e-skeleton.js,vendor/}`, `backend/test/{harness.go,TestMain}`, `docs/plan/evidence/README.md`.
- Входы: `tdd-protocol.md` §3 Playwright; `verification-protocol.md` §1–§4, §6; `12 §3.2` R1–R4, R16; `12 §6` п.1–16; `12 §8` п.4–7, 19–22; `01 §5` (демо-панель: подписи «Персонаж», «Ширина», флажки «Нет связи», «Конфликт брони», «Сбой загрузки фото», «Сбросить»), `01 §6` (гид); `11 §12` п.18–19; PD-31, PD-32.
- Выходы: `playwright.config.ts` (`mobile-390`/`tablet-768`/`desktop-1440`, `PORT` из окружения, `reuseExistingServer: !CI`, `reporter html open:never`, `snapshotPathTemplate` с `{platform}`); фикстуры `demo` (персонаж по дословной подписи селекта, ширина, флаги, «Сбросить», `applyPreset`), `reference` (открыть `127.0.0.1:4173/Ортус CRM.dc.html`, те же действия, скрыть `[aria-label="Панель демонстрации"]`, снимок области приложения; `page.route` unpkg → `tools/vendor/react*.js`, Google Fonts → `packages/tokens/fonts`), `axe`; хелперы `toMatchReference(pageKey, {persona, width, steps})`, `collectLabels()` (`button,a,h1-h3,label,[aria-label]`); `allowlist.md` (разделы по страницам); `tools/e2e-skeleton.js` (из «Чек-лист приёмки» отчёта `0N` → `e2e/<page-key>.spec.ts`, один `test.fixme` на пункт + 6 обязательных пунктов §1.3); `.mcp.json` + `mcp:install` + `e2e:install`; `tools/verify-pages.js`; Go-харнесс (`//go:build integration|isolation|concurrency`, падает без базы, миграции лексикографически, `t.Parallel()`); smoke-тег `@smoke`.
- Контракты: публикует фикстуры и хелперы для всех UI-WS; формат `docs/plan/evidence/<page-key>/{390,768,1440}.png` + `reference-*.png` + `snapshot.txt`.
- Тесты-первыми: 12 §6 п.2 (MCP видит «Панель демонстрации» на 4173); п.4–10 (конфиг); самопроверка `reference` vs `reference` = 0 diff на 390/1440; `collectLabels` на эталоне `home`/owner содержит подписи из 01 §3; 12 §6 п.11–12, 15–16 (Go-харнесс).

#### WS-08 texts-dictionary · волна 0 · M
- Владеет: `packages/texts/`.
- Входы: `00 §10` п.6; `00 §3.6` (57 статических `aria-label`, 6 `data-screen-label`); `01 §11–§14`; `02 §5–§8`; `03 §4.3, §11.6`; `04 §4.7`; `05 §11` п.6–7; `06 §4.3–4.6, §15` п.9; `09 §4.7` (`REASON`); `11 §4.20`; PD-37.
- Выходы: `src/{shell,gate,banners,toast,errors,company,branding,logistics,home,forms,tasks,platform,core,spa-cash,repair,docs}.ts` — `as const` объекты с дословными строками («ё», знаки, U+00A0); `src/screen-labels.ts` (6 известных + предложенные для 19 секций); `src/index.ts`.
- Контракты: ключи заморожены; владелец страницы добавляет ключи только в свой файл.
- Тесты-первыми: «каждый `REASON.text`/текст AccessGate совпадает с таблицей 01 §12» (фикстура — выдержки отчёта); «нет дубликатов значений между файлами»; «суммы содержат U+00A0, а не пробел».

#### WS-10 shell · волна 1 · L
- Владеет: `apps/web/src/{app,shell,demo}/`, `apps/web/index.html`, `apps/web/vite.config.ts`, `e2e/shell.spec.ts`, `e2e/visual/shell.*`, `texts/shell.ts`.
- Входы: `01-shell.md` целиком (§4 фрейм/брейкпоинты, §5 демо-панель, §6 гид, §7 boot/loading/loadErr, §8 маршрутизация, §9 `navForBase`/`brandNav`, §10 шапка, §11 баннеры, §12 AccessGate, §13 тосты, §14.1–14.2, 14.6–14.7, §16 офлайн/клавиатура, §17 `applyBrand`, §20 чек-лист 38 пунктов, §21 Q5, Q8, Q12); `04 §4.3–4.6` (тёмная оболочка оператора); `11 §4.18`; `08 §10` Q4–Q6; `12 §5` п.18 (один DOM); PD-14, PD-23, PD-29.
- Выходы: TanStack Router file-based (`/home`, `/modules`, `/users`, …, `/platform/tenants`, …, `/plan/:key`; стартовая по `DEFAULT_PAGE` 01 §8.1); провайдеры (`AdapterProvider`, `QueryClient` без retry, `Clock`); `VITE_ADAPTER=mock|http`; персонаж через демо-панель и `?persona=` (mock); `AppShell` (sidebar 244 / rail 68 / нижняя 60 px по ширине фрейма — container queries); шапка (светлая/тёмная, колокольчик, поповеры «Уведомления»/«Профиль»); `navForBase` + `brandNav`, `gateVM`, `bannersVM` — чистые функции; тост 4200 мс; модальный контейнер (`confirm` с разделами и `ack`, `sheet` «Все разделы»); `run()` с `quiet`; `Escape`; `online/offline` + `flush`-хук; `applyBrand` (`--ox-accent*` на `:root`); демо-панель и «Путь проверки» (mock-сборка); skeleton «Загружаем рабочее пространство…» / `loadErr`.
- Контракты: `useShell()` (`setPage`, `go`, `toast`, `confirm`, `run`, `openModal(kind, payload)`), слот модалок для WS-14/22, `PageFrame` (крошка, h1, `data-screen-label`), `useDb()`/`useActor()`; 25 заглушек страниц «в разработке» под гейтами/баннерами.
- Экраны: оболочка на всех 25 ключах, модалки `confirm`/`sheet`, 4 AccessGate, 5 баннеров, гид, демо-панель.
- Тесты-первыми: unit `navForBase` для 8 персонажей (01 §8.3), `gateVM` (01 §12 обе ветки дословно), `bannersVM` (5 видов), `brandVars`-применение; компонентные: шапка оператора `#1C2A26` без колокольчика, нижняя навигация 3 + «Ещё»; e2e `shell.spec.ts` = 01 §20 (38 пунктов `test.fixme`).

#### WS-11 docs-site · волна 1 · L
- Владеет: `apps/docs/`, `tools/sync-design.js`, `texts/docs.ts`.
- Входы: `design/Документация.dc.html`; `11 §6.1–6.11` (каркас, поиск 220 мс/top 15, `DOCS` 36/4 группы, навигация 280 px/бургер < 960, hash-роутинг, рендереры md/code/perm/api/frame, стили `S`, mermaid, TOC ≥ 1280, пейджер); `11 §7` (`support.js`, CSP, `window.__resources`); `11 §10` (чек-лист читалки и витрины); `11 §11` Q8–Q16; `11 §12` п.4–7, 11–14, 19; PD-16.
- Выходы: React+TS читалка (marked, js-yaml, mermaid локально); реестр `DOCS` как данные; `renderPerms`/`renderApi` чистые функции над YAML; `public/design/` — копия `design/` через `tools/sync-design.js` на сборке (в копии `.dc.html` добавлен локальный React через `window.__resources`; `design/` не трогается); `public/docs/`.
- Экраны: `docs-start`, `docs-search`, `docs-api`, `docs-permissions`, `docs-frames` (3 фрейма + «Ремонт и стройка» внутри прототипа).
- Тесты-первыми: unit `renderPerms` на реальном `11-permissions.yaml`; `renderApi` с фильтром на реальном OpenAPI (76 путей); `parseRoute` (неизвестный hash → `start`); `BASENAMES`-перезапись ссылок; e2e по 11 §10 (h1 «Ортус CRM — комплект для старта разработки v0.2», «Найдено в N документах», «Ничего не найдено», `#dc-root .sc-host` есть и `.sc-logic-error` нет, консоль без `[dc-runtime]`); визуальная сверка с `127.0.0.1:4173/Документация.dc.html` на 390/800/1280/1440.

#### WS-12 ui-core · волна 1 · M
- Владеет: `packages/ui/src/core/`.
- Входы: `11 §4.1–4.5, 4.7–4.9, 4.14–4.17` (Button, IconButton, Field + 6 полей, Checkbox/Switch/Radio, Status, Banner, AccessGate, Card, Dialog/ConfirmDialog/Sheet, Toast, EmptyState, Skeleton, Tabs); `11 §5` (витрина — эталон состояний); `02 §12` п.4 (switch 44×26 и 40×22, поля 44 px, pill `ch`); `01 §22` п.16; PD-13, PD-29.
- Выходы: 15 строк контракта, ≈ 22 компонента с учётом вариантов полей (hover/focus/active/loading/disabled, `disabledReason`), Storybook-истории на состояние, axe-тест на компонент.
- Контракты: реализует пропсы WS-04 без изменений (изменение — через интегратора).
- Тесты-первыми: Testing Library по ролям («кнопка «Подключить» недоступна, причина в `aria-describedby`»); клавиатура (Tab/Space/Enter/Escape; фокус-ловушка Dialog по PD-29); axe serious/critical = 0; визуальная сверка секций витрины `#buttons`, `#fields`, `#status`, `#access`, `#data` (11 §12.15).

#### WS-13 ui-domain · волна 1 · M
- Владеет: `packages/ui/src/domain/`.
- Входы: `11 §4.6, 4.10–4.13, 4.16, 4.19`; `03 §10.1` (5 состояний слота: «Не снято», «Загрузка N%», «Ошибка загрузки» + «Повторить», «На устройстве · ждёт связи», «Загружено»); `03 §5.3` (чек-лист совместимости); `06 §11.2` (`ReadinessBar` 48 %/штриховка); `05 §5.5` (`DecisionQueue`: тон, «показано 8 из N», «Решений не требуется»); `04 §10` п.13, `06 §15` п.10 (таблицы со скроллом — PD-28).
- Выходы: `SyncState`, `DataTable`, `CheckList`, `LoadBar`, `PhotoSlot`, `Stepper`, `ConflictNotice`, `ReadinessBar`, `DecisionQueue`, `ObjectHeader` + истории + axe.
- Тесты-первыми: `PhotoSlot` 5 состояний × `aria-valuenow`; `LoadBar` > 100 % → danger текстом; `DecisionQueue` порядок danger→warn→info→neutral; `ReadinessBar` проценты в легенде текстом; `DataTable` `<th scope>`, пусто/скелетон/ошибка.

#### WS-14 modals-people · волна 1 · S
- Владеет: `apps/web/src/modals/people/`, `e2e/modals-people.spec.ts`.
- Входы: `01 §14.3–14.5`; `02 §6.9–6.11` (поля, дефолты, `role_conflict`/`validation`/`conflict`, тосты); `02 §11` (дефолты Лотоса — PD-27); `02 §12` п.11, 18 (620/560 px, bottom sheet).
- Выходы: три диалога, регистрируемые в слоте `openModal('assign'|'invite'|'createRole', payload)`.
- Контракты: потребляет `AdapterPort.assign/unassign/invite/createRole`, `useShell`.
- Тесты-первыми (фейк адаптера): «Назначить» → `assign({memberId, roleId, scope, until})`; `role_conflict` → inline-текст дословно; приглашение при 10/10 → «мест нет» (02 §12 п.11); Escape закрывает; на 390 — лист снизу.

#### WS-15 contract-delta · волна 2 · M · 2 ревьюера
- Владеет: `api/openapi/ortus.yaml`, `api/permissions.yaml` (после закрытия WS-03).
- Входы: `10 §7.1–7.4` (G-02…G-19); `07 §7` (17 методов без HTTP-аналога + PROPOSED); `design/docs/17-users-and-billing.md:132–153`, `18-branding.md:77–83`, `19-construction.md:104–163`; `10 §11` Q4–Q8, Q14–Q16; PD-33.
- Выходы: v0.2-full с примерами для MSW; `x-adapter-method` на операциях (связка 53 методов ↔ операции); changelog контракта.
- Тесты-первыми: те же, что WS-03 + «каждый метод `AdapterPort` имеет хотя бы одну операцию с `x-adapter-method`».

#### WS-20 company · волна 2 · L
- Владеет: `apps/web/src/routes/company/`, `texts/company.ts`, `e2e/{modules,users,billing}.spec.ts` + visual/labels.
- Входы: `02 §5` (modules: `omVM`, `toggleModule`, `applyQuota`, `confirmTrialEnd`), `02 §6` (users: 4 вкладки, `roleEditorVM`, `accessVM`, пресеты), `02 §7` (billing: `tierList/calc`, заявки, отзыв), `02 §9`, `02 §10` #1–47 (с правкой #44 → «8 из 10»), `02 §11`, `02 §12`; `09 §4.7`; `00 §6` E2.
- Экраны: `modules`, `users` (`people|groups|roles|check`), `billing`; модалка `confirm` ×6 сценариев (подключить/отключить модуль, лимит, trial, отозвать приглашение, отменить заявку).
- Тесты-первыми: unit `omVM` (holders n=1, зависимости модулей, `history`), `roleEditorVM` (системная роль read-only; `checked && disabled`), `accessVM` 4 пресета → тексты 09 §4.7 дословно, `billingVM` (9→10 мест, «мест нет», pending SR-12 в Лотосе); экранные: trial/restricted (кнопки «Подключить»/«Изменить лимит» заблокированы), Лотос (23 участника, v3, без логистики); e2e 02 #1–47.

#### WS-21 branding · волна 2 · M
- Владеет: `routes/branding/`, `texts/branding.ts`, `e2e/branding.*`.
- Входы: `02 §8` (элементы `:1248–1443`); `01 §17`; `02 §10` #48–64 (#51 — расчёт `contrastW`/`fixAccent` заранее); `02 §12` п.6 (стаб навигации для редактора меню), п.13, 16; `design/docs/18-branding.md`.
- Экраны: `branding` (вкладки, `radiogroup` «Палитра», «Свой цвет в формате HEX», меню «Выше»/«Ниже»/«Сменить иконку: …», `group` «Что показать», версии).
- Тесты-первыми: unit `brandingVM` (1–60/≤ 16; 5 `BR_LOCK` нельзя скрыть; `#FFD400` → 4.5:1); экранные: PNG ≤ 1 МБ через `setInputFiles`; Лотос `#7A3E79`/«Лотос»/«сеанс»/версия 3; e2e #48–64; BR-T2 (переключение организации меняет акцент и меню).

#### WS-22 logistics-manager · волна 2 · L
- Владеет: `routes/logistics/manager/`, `texts/logistics.ts` (раздел manager), `e2e/{fleet,pool,review}.*`.
- Входы: `03 §5` (fleet: compat 86 %/69 %, `legs`, `assignVehicle`, 409), `03 §6` (pool + модалка `request` 01 §14.6), `03 §7` (review: очередь, карточка дефекта, карточка смены, «Принять смену …?», возврат по разделам), `03 §4.3–4.4`, `03 §14` #1–17, #41–47; `03 §15` Q5, Q13, Q16–17; `08 §6` J1, J4–J6.
- Экраны: `fleet`, `pool`, `review`; модалки `request`, `confirm` («Принять смену»).
- Предусловие: preset `logistics-ready` или UI-шаги 1–2 гида (03 §16 п.3).
- Тесты-первыми: unit `fleetVM` (причины compat дословно, проценты), `poolVM`, `reviewVM` (бейдж `submitted+defect_review`; `earnings` по `canEarnings`); экранные: `conflictNext` → тост «Конфликт: …» + обновление; гейты «Нет роли с доступом к модулю «Логистика»» / «Нет права на приёмку смен»; «Передать в навигатор · интеграция не подключена» disabled; e2e 03 #1–17, #41–47.

#### WS-23 logistics-driver · волна 2 · L
- Владеет: `routes/logistics/driver/`, `texts/logistics.ts` (раздел driver), `e2e/{today,cars}.*`.
- Входы: `03 §8` (9 состояний рейса, баннеры, блок осмотра `:724–772`, sticky «Осталось: …», расходы, терминальные карточки), `03 §9` (cars: «Все»/«Подходят к рейсу»/«Свободны»), `03 §10` (фото 5×5, outbox `local/sending/error`, `flush`, 409), `03 §11.3`, `03 §13`, `03 §14` #18–40, #48; `03 §15` Q2, Q6, Q9–Q12; `08 §6` J2, J3, J5; `00 §7` 03 (продублировать `bookLabel`/disabled-подписи).
- Экраны: `today`, `cars`; модалка `confirm` («Завершить рейс …?»).
- Тесты-первыми: unit `driverVM` (`act.*` по состоянию; `inspMissing` → список), `photoVM` (5 состояний), outbox-редьюсер (`local → sending → error`, повтор с тем же `opId`); экранные: офлайн — бронь/выезд заблокированы, расход/сдача «сохранено на устройстве», `flush` при `online`; `failUploadNext` → «Ошибка загрузки» + «Повторить»; `conflictNext` → alert «Конфликт брони» + «Обновить список»; критический дефект → `defect_review`; гейт по умолчанию; e2e 03 #18–40, #48; AC-04 на уровне UI.

#### WS-24 home · волна 2 · M
- Владеет: `routes/home/`, `texts/home.ts`, `e2e/home.*`.
- Входы: `05 §5` (5.3 элементы, 5.4 «Начало работы» «1 из 3» — E1, 5.5 очередь из 9 источников, 5.6 «Сегодня в работе», 5.8 состояния); `05 §9.1` #1–11; `05 §10` Q2, Q6–Q7; `05 §11` п.2, 10–11, 19–20.
- Экраны: `home` (owner, manager, owner@t-lotos).
- Тесты-первыми: unit `homeVM` (сортировка danger→warn→info→neutral; max 8 + «показано 8 из N»; `doneN` по сиду = 1; источники SPA/ремонт без `moduleOn` — PD-27); экранные: manager без роли — пусто и нет «Рейсов сегодня»; приветствие по инжектируемым часам (regex); шаг 2 → `openModal('assign')` с `m-kotova`; e2e #1–11.

#### WS-25 forms · волна 2 · M
- Владеет: `routes/forms/`, `texts/forms.ts`, `e2e/forms.*`.
- Входы: `05 §6` (список, конструктор 10 типов/разделы/↑↓/обязательность/«Показывать, если», «Опубликовать «{name}» v{N}?», версии-дифф, ответы по версии, журнал «Ответ R-… принят → Задача T-…»); `05 §9.2` #12–29; `05 §10` Q1 (Лотос `forms: []` — PD-27), Q9, Q11, Q15, Q17; `05 §11` п.3, 16–18, 22.
- Экраны: `forms` (`build|versions|responses`); модалка `confirm` (публикация).
- Тесты-первыми: unit `formsVM` (dirty по `JSON.stringify`, дифф «Убрано», `showIf`), `editForm`/`publishForm`; экранные: manager чип «Только просмотр · нет права «Настраивать»»; «Новая форма из шаблона · следующий шаг» disabled; Лотос — пустое состояние; e2e #12–29.

#### WS-26 tasks · волна 2 · M
- Владеет: `routes/tasks/`, `texts/tasks.ts`, `e2e/tasks.*`.
- Входы: `05 §7` (шапка, новая задача, канбан по `WORKFLOWS[flow]`, список, карточка `aside[aria-label="Карточка задачи"]`, серверные правила `TASK_FLOW`/чек-лист); `05 §9.3` #30–47; `05 §10` Q3–Q5, Q10, Q16; `05 §11` п.4, 8, 23; `07 §16` п.24.
- Экраны: `tasks` (`board|list`, карточка).
- Тесты-первыми: unit `tasksVM` («Мои задачи» по актёру; бейдж по id — PD-27), переходы по `TASK_FLOW`, блок перехода при незакрытом чек-листе (текст сервера), «⚡ из ответа формы», ссылки `response→forms`, `trip→review|fleet`; экранные: foreman `leads` без проекта (Q5), пусто «Нет проектов в вашей области», h1 «Задачи»/«Заявки»; e2e #30–47.

#### WS-27 platform-orgs · волна 2 · M
- Владеет: `routes/platform/orgs/`, `texts/platform.ts`, `e2e/{tenants,usage,requests}.*`.
- Входы: `04 §4.7` (`opConfirm`, «Последствия», тост «Готово · запись добавлена в журнал»); `04 §5.1` (`opVM`: чипы, квота, «26 дн. · до 27.10.2026», полоса `#A13A33`, аудит 6 строк); `04 §5.2` (`usageVM` — агрегаты снять с эталона, 00 §7); `04 §5.3` (`requestsVM`: SR-12/SR-9, решение с заметкой, бейдж); `04 §8` #1–25; `04 §9` Q1–Q8, Q13–Q15; `04 §10` п.5–6, 13; PD-35.
- Экраны: `tenants`, `usage`, `requests`; модалка `confirm` (`opConfirm`).
- Тесты-первыми: unit `opVM` (пороги 85 %/80 % — Q8), `usageVM` (значения из снапшота сида), `requestsVM`; экранные: таблица `usage` 860 px со скроллом на 390; `data-screen-label` «Оператор · использование»/«Оператор · заявки»; e2e #1–25.

#### WS-28 platform-accounts-plans · волна 2 · M
- Владеет: `routes/platform/{accounts,plans}/`, `e2e/{accounts,plans}.*`.
- Входы: `04 §5.4` (`accountsVM`: поиск, фильтр, realm «Ортус · Платформа» — `platformOrgVM`, `iAmOwner`, последний владелец, поповер «Организации аккаунта», «Карточка аккаунта», блокировка с причиной, сброс MFA); `04 §5.5` (`plansVM`: v1/v2, «Черновик vN · не опубликован», 9 правил, «Запланирована версия …», отмена); `04 §8` #26–46; `04 §9` Q9–Q12, Q15; `04 §10` п.10–12, 15.
- Экраны: `accounts` (3 секции), `plans` (draft/scheduled).
- Тесты-первыми: unit `accountsVM` (58 аккаунтов детерминированно, фильтры), `platformOrgVM` (нельзя менять свою роль/отключать себя), `plansVM.validateDraft` 9 правил + `calc`; экранные: поповер с клавиатуры (`onFocus/onBlur`); таблица 760 px на 390; e2e #26–46.

#### WS-29 core-modules · волна 2 · M
- Владеет: `routes/core/{calendar,knowledge,data,files}/`, `texts/core.ts`, `e2e/{calendar,knowledge,data,files}.*`.
- Входы: `06 §5` (`calVM`: 8 ресурсов/6 броней, таймлайн 08–20 в %, панель брони, конфликт `role="alert"` + 3 слота); `06 §6` (`kbVM`: дерево, поиск, правка владельца, `saveKbPage` с `baseVersion`); `06 §7` (`dataVM`: наборы, `hiddenNote`, «Выгрузить» disabled); `06 §8` (`filesVM`); `06 §13` #1–25; `06 §14` Q1–Q4, Q11–Q12, Q15; `06 §15` п.8, 10, 16.
- Экраны: `calendar`, `knowledge`, `data`, `files`.
- Тесты-первыми: unit `calVM` (`busySpan`, clamp), `kbVM` (приватные страницы только владельцу), `dataVM`; экранные: конфликт версии БЗ через preset `kb-conflict` (Q1); таймлайн `min-width` 640 px на 390; e2e #1–25.

#### WS-30 spa-cash · волна 2 · M
- Владеет: `routes/spa-cash/`, `texts/spa-cash.ts`, `e2e/{spa,cash}.*`.
- Входы: `06 §9` (`spaVM`: «Мой день»/«Салон и SPA», «Завершить процедуру» → `done_pending` + issue, баннер «Учёт материалов не завершён.», `busy`); `06 §10` (`cashVM`: журнал, «Провести в …», inline-валидация, «Сторнировать K-xxx?», баланс, «Предложения из принятых смен»); `06 §13` #26–37 (независимость #34/#35); `06 §14` Q3, Q5–Q6, Q8–Q9, Q11; `00 §5` G2 (`therapist@t-lotos` + 2 пункта).
- Экраны: `spa`, `cash`; модалка `confirm` (сторно; закрывается и при ошибке — E6).
- Тесты-первыми: unit `spaVM`, `cashVM.sign()`/баланс; экранные: `busy` блокирует «Провести в …» (Q6 — PD-27); Лотос `ca-lotos` пустой журнал; `therapist@t-lotos` «Мой день»; e2e #26–37 + 2 новых.

#### WS-31 repair-object · волна 2 · M
- Владеет: `routes/repair/{index,overview,works}`, `texts/repair.ts`, `e2e/repair.*`.
- Входы: `06 §11.1–11.4, 11.6` (`repairVM`: `ObjectHeader`, `pc()` 48 % / «На приёмке 5 %» / 52 % после приёмки — E5, очередь решений, «Работы»: форма прораба с inline-ошибками, «Принять объём»); `06 §13` #38–46; `06 §14` Q7, Q10, Q13, Q16–Q17; `06 §15` п.7, 15, 17, 19; `design/docs/19-construction.md`.
- Контракты: потребляет `RepairChild` (WS-32) через `{tab, onTab, onStatus, onLeads}` и форму `onStatus` (06 §11.5); до слияния WS-32 — стаб с фиксированной сводкой.
- Экраны: `repair` (`overview|works` + вкладки дочернего).
- Тесты-первыми: unit `repairVM` (`pc()` 48/52; `canFin` по `finance.read`); экранные: гейт по умолчанию «„Ремонт и стройка“ не подключён организацией»; «Решений не требуется» до `onStatus`; прораб — форма, владелец — приёмка; e2e #38–46.

#### WS-32 repair-child · волна 2 · L
- Владеет: `routes/repair/child/`, `e2e/repair-child.*`.
- Входы: `design/Ремонт и стройка.dc.html` (шаблон 72–461, логика 619–901; `ganttVM` 619–839); `06 §11.5` (9 вкладок с дословными подписями: «Замер» формулы, «Смета» чипы версий, «График» (тулбар «Вид графика», 7 причин, легенда 7 пунктов, панель этапа, исполнители), «Документы», «Снабжение», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика»); `00 §5` G4 (перед запуском — карта вкладки «График» со строками, PD-36); `06 §14` Q8 (20 октября в графике).
- Выходы: компонент `RepairChild` с локальным состоянием, API не вызывает.
- Тесты-первыми: unit формулы замера (`стены = max(0, 2(l+w)h − o)`), `ganttVM` (сдвиг на рабочий день, критический путь, прогноз, `slipText`), сводка `onStatus`; e2e по вкладкам (новый чек-лист в брифе); визуальная сверка каждой вкладки на 390/1440 с `Ремонт и стройка.dc.html` на 4173.

#### WS-33 planned-page · волна 2 · S (при PD-24 = «реализовать»)
- Владеет: `routes/planned/` (порт `roadmap.js` — `routes/planned/data/roadmap.ts`, не в `packages/domain`, чтобы не трогать каталог WS-05).
- Входы: `01 §15`; `design/ortus/roadmap.js:3–132`; `Ортус CRM.dc.html:2152–2187, 3944–3953`; `00 §5` G1; `01 §21` Q1.
- Экраны: `planned` по `/plan/:key` (9 ключей), недостижима из меню (как в прототипе).
- Тесты-первыми: unit `planVM`; e2e: прямой URL, колонки «Экраны», «Компоненты», «Правила», «Контракты API», «По ortus-openapi-v0.1.yaml», «Шаг {n}», h2 «Пример: осмотр машины → ответ формы → осмотр → задача менеджеру».

#### WS-40 backend-platform · волна 1 · M
- Владеет: `backend/cmd/api/`, `backend/internal/platform/{httpx,problem,requestid,session,tenantctx,idem,clock,pipeline}/`.
- Входы: `10 §3.2–3.5`, `10 §9`, `10 §12` п.17; `12 §3.2` R5–R7 (сессия, middleware, конвейер 7 шагов + 2a/2b, один 404 байт в байт); `12 §5` п.1–8, 22–24, 30; `09 §5.1, §5.6`; PD-18, PD-31.
- Операции: `getMyContext` (`/me/context`), `/auth/dev/*` (из WS-03), health.
- Тесты-первыми: табличные Go-тесты конвейера (неизвестный тенант/чужой/выключенный модуль/несуществующий роут → четыре 404 `bytes.Equal`); сессия (`HttpOnly`, `SameSite=Lax`, `ortus_sid`, 302/401 по `Accept`); CSRF (`csrf_failed`, cookie без `HttpOnly`); `Problem` (`application/problem+json`, `code`, `requestId`, `status`); `Cache-Control: private, no-store` + `X-Request-Id` на каждом ответе; `Idempotency-Key` повтор с другим payload → 409 `idempotency_key_reused`.

#### WS-41 migrations-provisioner · волна 1 · M · 2 ревьюера
- Владеет: `backend/migrations/`, `backend/cmd/{migrate,provisioner}/`, `backend/internal/platform/migrate/`.
- Входы: `design/docs/db/*.sql` (5 файлов); `design/docs/10-data-model.md`; `09 §3`; `09 §7.1–7.2` (разрывы → миграция 0003: `review.comment/steps`, `title`, `model`, `depot`, `trip.title`, `distanceKm`, `pool.terms`; DP-09, DP-13); `09 §6`; `09 §9` DP-10, DP-14; D-06, PD-38.
- Тесты-первыми (testcontainers PostgreSQL 17): up/down каждой миграции на двух tenant DB разных версий; `btree_gist` присутствует; `EXCLUDE` брони (2 вставки → 1 ошибка); роли БД `migrator/api_runtime/worker_runtime/provisioner`, у `api_runtime` нет DDL; controller canary → партии.

#### WS-42 authz · волна 2 · L · 2 ревьюера
- Владеет: `backend/internal/platform/authz/`, `backend/test/isolation/fixtures/`.
- Входы: `09 §4.1–4.8`; `10 §3.4`; `design/docs/15-quality-security.md` «Фикстуры изоляции»; `07 §8.2` (прототипные `can`/`canEarnings` как спецификация); S1-11, S1-14, S1-15; DP-05, DP-06.
- Контракты: публикует `Authorize`, `ScopeQuery`, `ReadFields/WriteFields`, `ExplainAccess`, `PolicyVersion`.
- Тесты-первыми: unit `permit()` на матрице «актор × действие × область» из прототипа (`m-kotova` без назначений → `forbidden_action`; driver → `function_blocked` на `fleet.earnings.*`); «изменять Москва-1» + «читать Самара-2» ≠ «изменять обе»; `scopeQuery` на фикстуре (чужая фирма → 0 строк); `policy_version` +1 на изменение роли; изоляционная матрица 200/403/404 растёт с каждым эндпоинтом.

#### WS-43 control-tenants · волна 2 · M
- Владеет: `backend/internal/control/`.
- Входы: S1-01…S1-04; `04 §9` Q1–Q5 (создание организации — UI в прототипе нет; `TenantPatch.reason`); `09 §3.1–3.2`; G-22/DP-16; PD-35.
- Операции: `listPlatformTenants`, `getPlatformTenant`, `createPlatformTenant`, `updatePlatformTenant`, `getPlatformSubscription`, `updatePlatformSubscription`.
- Тесты-первыми: интеграция provisioner (CREATE DATABASE + sentinel + миграции); статусы по карте PD-35; «≥ 2 активных владельца платформы» (DP-07 — канон); аудит control DB (`by`, `reason`).

#### WS-44 access-people-org · волна 2 · L
- Владеет: `backend/internal/modules/{access,org,people}/`.
- Входы: S1-06…S1-16; `10 §5.4` (Access 16 операций); `09 §3.3`; `09 §6` (последний владелец под `FOR UPDATE`, места); `07 §4.4`; DP-17.
- Операции: `listMembers`, `getMember`, `updateMember`, `inviteMember`, `listRoles`, `getRole`, `createRole`, `updateRole` (If-Match), `deleteRole`, `listAssignments`, `createAssignment`, `revokeAssignment`, `listOrgUnits` + группы/отзыв приглашения (G-02 из WS-03/15).
- Тесты-первыми: контракт на каждую операцию (`seats_exhausted`, `separation_of_duties_conflict`, `last_owner_required`, `delegation_exceeds_grant`, 412/428 для ролей); изоляция (чужой `memberId` → 404); конкурентность «два приглашения на последнее место → 1 успех».

#### WS-45 modules-files-services · волна 2 · L
- Владеет: `backend/internal/modules/{modulesreg,files}/`, `backend/internal/platform/{storage,events,audit}/`, `backend/cmd/worker/`.
- Входы: S1-17…S1-26; `10 §3.5–3.7`, `10 §5.5, §5.7`; `09 §5.5` (события outbox); `07 §12.1` (draining, `startedWork`).
- Операции: `listModuleCatalog`, `getModuleInstallation`, `setModuleInstallation`, `getModuleSettings`, `updateModuleSettings`, `getStorageUsage`, `requestStorageChange`, `initiateUpload`, `completeUpload`, `getFile`, `getFileDownload`.
- Тесты-первыми: отключение модуля с активным рейсом → предпросмотр последствий, новые 403 `module_read_only`, активный завершается (AC-12 серверная часть); upload: резерв → PUT → complete 202 → scan → ready/rejected (MinIO testcontainer); квота условным `UPDATE`; outbox lease/retry/dead-letter; 100 повторов → 1 эффект (AC-07 на `completeUpload`).

#### WS-46 fleet-core · волна 3 · M
- Владеет: `modules/fleet/{vehicles,routes,reservations}/`, `modules/sched/`.
- Входы: S2-01…S2-03; `03 §11–12` (mock → SQL: кг/мм, ключи топлива); `07 §8.3` (`compat` серверная копия); `09 §6` (`reservations_no_overlap`); AC-03.
- Операции: `listVehicles`, `createVehicle`, `listRoutes`, `createRoute`, `listReservations`, `reserveVehicle`, `releaseReservation`, назначение машины (G-11).
- Тесты-первыми: `compat` Go = TS (общие табличные примеры 07 §8.3); concurrency 100 горутин → 1×201 + 99×409 `reservation_overlap`; hold-expiry; изоляция (машина чужой фирмы → 404).

#### WS-47 fleet-shift · волна 3 · L
- Владеет: `modules/fleet/{inspections,trips}/`.
- Входы: S2-04…S2-09; `03 §8, §10` (как спецификация); `07 §3.4` (`recordInspection` → `fleet.inspection.submitted.v1`); `07 §16` п.15; `03 §15` Q7 (второй осмотр `return` после rework); AC-04; PD-33.
- Операции: `getInspectionChecklist`, `submitInspection`, `startTrip`, `createTripExpense`, `listTripExpenses`, `returnTrip`, `reviewInspection`/`defect-decision`.
- Тесты-первыми: 4 фото из 5 или блокирующий дефект → `startTrip` 409; старт атомарно потребляет бронь; `odoError`/`validateExpense` серверные копии; идемпотентность расходов/сдачи по `Idempotency-Key`; событие в outbox без restricted-полей.

#### WS-48 fleet-review-earnings · волна 3 · M · 2 ревьюера (финансы)
- Владеет: `modules/fleet/{review,expenses}/`, `modules/finance/`.
- Входы: S2-10…S2-13; `03 §7`; `07 §5` (`earnings` вырезаются); AC-05; `09 §10` п.14.
- Операции: `reviewTrip`, `reviewTripExpense`, `getTripEarnings`, `setTripEarnings` (отдельный путь), планирование `createRoute` (loads по участкам).
- Тесты-первыми: изоляция AC-05 по каналам (Trip DTO, `/earnings`, Data Hub, экспорт, уведомления — водитель не видит ни суммы, ни метаданных); «вернуть по разделам» (`rework` + `steps`); машина освобождается только при `accepted`.

#### WS-49 fleet-pool · волна 3 · M
- Владеет: `modules/fleet/pool/`.
- Входы: S2-14; `03 §6`; `09 §4.8` (временный доступ пула в одной транзакции); AC-06; `10 §11` Q14.
- Операции: `listAvailableDrivers`, `requestDriverTransfer`, `listDriverTransfers`, `getDriverTransfer`, `decideDriverTransfer`.
- Тесты-первыми: approve → бронь + grant `source='transfer'` + событие в одной транзакции; после срока → 404; публикация водителя (решение по Q14).

#### WS-50 datasets · волна 3 · S
- Владеет: `modules/data/`.
- Входы: S2-16; `10 §5.6`; `06 §7`; AC-14.
- Операции: `listDatasets`, `queryDataset`.
- Тесты-первыми: count/агрегаты не выдают чужие строки (404/0); `earnings` отсутствует в наборе «Рейсы» для водителя; фильтры только AND.

#### WS-51 http-adapter · волна 3 · M
- Владеет: `packages/adapter/src/http/`, `apps/web/mocks/`.
- Входы: `07 §7` (методы → пути); `10 §7.1–7.3`; `10 §12` п.13 (один вызов = 2–3 операции); `07 §16` п.10 (полный `db` → `GET /me/context` после мутаций); `12 §3.2` R3; `tdd-protocol.md` §3 TS (MSW; прямой мок `fetch` запрещён); PD-25.
- Выходы: `createHttpAdapter({baseUrl, getCsrf})` реализующий `AdapterPort` через `openapi-fetch` (Idempotency-Key, If-Match, Problem → `ApiError`); MSW-хендлеры из примеров OpenAPI; conformance-suite WS-06 против MSW и против живого стенда (тег `@stand`); `VITE_ADAPTER=http`.
- Тесты-первыми: на каждый метод `AdapterPort` — тест по MSW (тело запроса, коды, `Problem.code` → `ApiError.code`); затем conformance (те же 62 кейса 07 §14).

#### WS-52 go-seed · волна 3 · S
- Владеет: `backend/cmd/seed/`.
- Входы: `07 §9`; `09 §7.3`; `09 §10` п.17–18, 24; `packages/domain/seed/snapshot.json`; `08 §11` п.16–17 (сид по каталогу: `finance.read` не по умолчанию; группа «Водители Север»); PD-30.
- Тесты-первыми: снапшот-тест равенства ID TS ↔ Go (PD-19); сид идемпотентен (повтор `make seed` без дублей); `Р-208` ↔ канонический номер из `core.counters` (карта в снапшоте).

#### WS-53 e2e-full-stand · волна 3 · M
- Владеет: `deploy/compose/profiles/e2e`, `.github/workflows/e2e-full.yml`, `apps/web/e2e/_stand/`.
- Входы: `verification-protocol.md` §2 (фаза 2); `12 §7` Q11; `12 §8` п.23–24; PD-41.
- Выходы: `npm run e2e:full` (compose up → migrate → seed → Playwright против `http://localhost:5173` с `VITE_ADAPTER=http`); CI nightly full / smoke на PR.
- Тесты-первыми: smoke «Путь проверки» 8 шагов (01 §6) одним spec'ом в обоих режимах; расхождение = дефект адаптера/backend.

#### WS-54 keycloak-oidc · волна 3 · M (по PD-41)
- Владеет: `backend/internal/platform/session/oidc/`, `deploy/compose/keycloak/`.
- Входы: S1-05; `10 §3.2`; `10 §12` п.23; `12 §3.2` R5; `12 §7` Q2.
- Операции: `/auth/login`, `/auth/callback`, `/auth/logout`, CSRF bootstrap (G-01).
- Тесты-первыми: `oidctest`-провайдер в Go; cookie-свойства 12 §6 п.23–25; профиль compose `keycloak` только для smoke.

#### WS-60…WS-67 backend S3+ · волна 4 · заготовки
- По одному WS на модуль: WS-60 forms (+ автоматизация «ответ → задача», AC-09); WS-61 tasks (комментарии, чек-лист — G-07); WS-62 knowledge (версии, `base_version`); WS-63 calendar (перенос с буферами, 3 слота); WS-64 spa + inventory (AC-07 на `completeAppointment`); WS-65 cash (сторно); WS-66 repairs (work-logs accept/return, overview — G-16); WS-67 branding + billing-заявки + platform-ops (G-09, G-18, BR-T1…T3).
- Каждый: миграция 0003+ (09 §7.1), операции из WS-15, conformance-кейсы WS-06 своего раздела (07 §14.5–14.7), изоляция по матрице; после — переключение страницы с mock на http в `e2e:full` без правок spec'а.

#### WS-68 pwa-offline · волна 4 · L — S2-15: Workbox, офлайн-черновики осмотра/расходов, очередь с явными статусами (`SyncState`); outbox WS-23 переезжает из памяти в IndexedDB.
#### WS-69 load-restore · волна 4 · M — k6 по профилю пилота (p95 ≤ 500/800 мс), restore drill одного тенанта (AC-15).

---

## 3. DAG волн

### 3.1 Граф зависимостей

```text
Волна 0 ─ WS-01 ──┬── WS-02 ─────────────────────────┐
                  ├── WS-03 (L) ──────────────────────┼─────────────┐
                  ├── WS-04 ──┬── WS-12 ──┐           │             │
                  │           ├── WS-13 ──┤           │             │
                  │           └── WS-11 (docs, независим)          │
                  ├── WS-05 ──┬── WS-06 ──┤           │             │
                  │           └── WS-14 ──┤           │             │
                  ├── WS-07 ──────────────┤           │             │
                  └── WS-08 ──────────────┤           │             │
Волна 1                       WS-10 (shell) ◄─ WS-04, WS-05, WS-07, WS-08
                              WS-40 ◄─ WS-02, WS-03        WS-41 ◄─ WS-01, WS-02
Волна 2 ─ страницы (14): WS-20…WS-33 ◄─ WS-06, WS-10, WS-12, WS-13, (WS-14 для 20/24), WS-08
          backend: WS-42 ◄─ WS-03, WS-40, WS-41 ; WS-43 ◄─ WS-40, WS-41 ; WS-44, WS-45 ◄─ WS-42 (pipeline внутри волны)
          контракт: WS-15 ◄─ WS-03
Волна 3 ─ WS-46 ◄─ WS-44 ; WS-47 ◄─ WS-45, WS-46 ; WS-48 ◄─ WS-47 ; WS-49 ◄─ WS-44 ; WS-50 ◄─ WS-42, WS-46
          WS-51 ◄─ WS-15, WS-40…45, страницы ; WS-52 ◄─ WS-05, WS-41, WS-43 ; WS-53 ◄─ WS-51, WS-52, WS-46…48 ; WS-54 ◄─ WS-40
Волна 4 ─ WS-60…67 ◄─ WS-15, WS-45 ; WS-68 ◄─ WS-23, WS-47 ; WS-69 ◄─ WS-53
```

### 3.2 Что запускается одновременно, число агентов

| Волна | Одновременно | Агентов (исполнители) | + проверяющие/ревьюеры/интегратор | Барьер |
|---|---|---|---|---|
| 0 | WS-01 первым (один агент), затем WS-02, 03, 04, 05, 07, 08 параллельно | 1 → 6 | ревью волны 0 до старта волны 1 (12 §8.15: в 2.0 S0 дало 39 замечаний) | интегратор: `main` с `make gen`, `pnpm test`, харнесс зелёный |
| 1 | WS-06, 10, 11, 12, 13, 14, 40, 41 | 8 | по 1 ревьюеру; проверяющие страниц — только для `shell` (25 заглушек с гейтами/баннерами) и `docs-*` | интегратор: shell собран с реальными `ui-core`/`ui-domain`, визуальная сверка оболочки на 390/768/1440 |
| 2 | 14 UI-WS (20…33) + WS-15 + backend 42, 43 (затем 44, 45 pipeline) | 14 + 1 + 2(→4) = 17–19; при лимите ~10 — подволны 2a/2b | проверяющий на каждую из 25 страниц (отдельные агенты); 2 ревьюера WS-15/42/44; **два интегратора** (UI и backend) — отклонение от orchestration §3, причина — 14 ребейзов (PD-40) | интегратор UI: `npm run e2e` все проекты + визуальная сверка 25 страниц; критик полноты по 00 §3 |
| 3 | WS-46, 49, 50, 51, 52, 54 сразу; 47 после 46; 48 после 47; 53 последним | 6 → 8 | 2 ревьюера WS-48 (финансы) | `npm run e2e:full` зелёный на smoke; conformance-suite зелёный против стенда |
| 4 | WS-60…67 по готовности контракта, WS-68, WS-69 | по бюджету | — | — |

Подволна 2a (основной путь гида 01 §6 + оператор): WS-20 company, WS-22 logistics-manager, WS-23 logistics-driver, WS-24 home, WS-27 platform-orgs, WS-29 core-modules, WS-30 spa-cash + WS-42, WS-43 (9 агентов). Подволна 2b: WS-21 branding, WS-25 forms, WS-26 tasks, WS-28 platform-accounts-plans, WS-31 repair-object, WS-32 repair-child, WS-33 planned, WS-15 + WS-44, WS-45 (10 агентов). Подволны — не барьер: 2b стартует по мере освобождения агентов.

### 3.3 Критический путь

- **UI «точно как нарисовано» (цель фазы 1):** WS-01 (M) → WS-04 (M) → WS-12 (M) ‖ WS-10 (L) → WS-23 logistics-driver (L) → проверка `today` (самая длинная проходка: 9 состояний × 3 ширины) → интеграция волны 2. Параллельная ветка WS-05 → WS-06 короче. Итого ≈ M + M + L + L + проверка. Второй по длине — WS-32 repair-child (L), но он не блокирует сдачу «Пути проверки».
- **Backend фазы 2:** WS-01 → WS-03 (L) → WS-40 (M) → WS-42 (L) → WS-44 (L) → WS-46 (M) → WS-47 (L) → WS-51 (M) → WS-53 (M). Длиннее UI-пути примерно на две L; это осознанный выбор угла A — backend не блокирует фидельность интерфейса, а стыкуется в волне 3.
- **Простои:** backend-агенты в волне 0 ждут WS-03 (кроме WS-41, который зависит только от WS-01/02). Страничные агенты в волне 1 ждут WS-10/12/13 — на это время их можно занять WS-11, WS-14 и «ранним стартом» VM-слоя: страничный WS может быть запущен в волне 1 с ограничением «только `routes/<group>/vm/` + unit-тесты», а экраны — после слияния оболочки; это один WS с двумя сессиями, не два WS.

---

## 4. Страницы прототипа: WS, e2e-spec, визуальная сверка и MCP

Для каждой страницы обязательны: `e2e/<page-key>.spec.ts` (чек-лист отчёта + 6 обязательных пунктов `verification-protocol.md` §1.3), `e2e/visual/<page-key>.visual.spec.ts` + `.labels.spec.ts` (сверка с 4173 на 390 и 1440, порог 0,01 — PD-22), проходка Playwright MCP по §4 с evidence в `docs/plan/evidence/<page-key>/` — **да для всех 25 страниц, 6 модалок и 5 экранов документации**. Колонка «эталон» — персонаж/предусловие для `reference`-фикстуры.

| Ключ | WS | spec | Эталон (персонаж · предусловие) | Особые состояния для проверки |
|---|---|---|---|---|
| `home` | WS-24 | `home.spec.ts` | owner · сид; manager · сид; owner@t-lotos | «Начало работы» «1 из 3» (E1); очередь ≤ 8 и «показано 8 из N»; manager без роли — пусто; «Рейсы сегодня» только при логистике on; приветствие по часам (regex); шаг 2 → диалог «Назначить роль» |
| `modules` | WS-20 | `modules.spec.ts` | owner · сид; owner@t-lotos | диалоги «Подключить «Логистика»?»/«Отключить …?» с последствиями и `ack`; roleNote «Роли с правами модуля есть у: 1 сотрудника…» → «Доступ через роли: 1 сотрудник» (E2); лимит 25…500 ГБ, уменьшение ниже занятого; trial → «Демо: завершить пробный период» → баннер «Пробный период завершён.», кнопки заблокированы; офлайн |
| `users` | WS-20 | `users.spec.ts` | owner · сид; preset `logistics-ready` для «Роли» | 4 вкладки `tablist` «Разделы доступа»; «Назначить роль» (`role_conflict`, срок, область); «Пригласить участника» 9→10 и «мест нет»; «Создать роль» → редактор (системная read-only; «Финансовые разрешения» заблокированы для функции «Водитель»; `checked && disabled`); «Проверка доступа» 4 пресета дословно (09 §4.7); Лотос — дефолты (PD-27) |
| `billing` | WS-20 | `billing.spec.ts` | owner · сид; owner@t-lotos (pending SR-12) | тарифы v2, сроки 1/4/8/12 со скидками; одна открытая заявка; отмена; отзыв приглашения → «8 из 10»; `approvedText`; офлайн |
| `branding` | WS-21 | `branding.spec.ts` | owner · сид; owner@t-lotos | валидация 1–60 / ≤ 16; палитра `radiogroup` «Палитра», HEX `#FFD400` → автокоррекция до 4.5:1; меню «Выше»/«Ниже»/скрытие (5 `BR_LOCK`); предпросмотр «Что показать» ×3; логотип/знак (`setInputFiles`); версии; акцент на `:root` |
| `fleet` | WS-22 | `fleet.spec.ts` | manager · preset `logistics-ready`; owner | гейт по умолчанию «„Логистика“ не подключена организацией» (driver/manager) и «Нет роли с доступом к модулю «Логистика»» (после подключения); compat 86 %/69 %, причины; `legs` LoadBar; «Конфликт брони» → тост «Конфликт: …» + обновление; «Передать в навигатор · интеграция не подключена» disabled; офлайн; модуль отключён → баннер «только чтение» |
| `pool` | WS-22 | `pool.spec.ts` | manager · `logistics-ready` | 2 водителя; «Запросить водителя» → «Отправить запрос»; «Демо: одобрить / отклонить»; пусто (0 запросов) |
| `review` | WS-22 | `review.spec.ts` | manager · preset `shift-submitted`; owner | очередь defect_review → submitted → rework → accepted; карточка дефекта (разрешить выезд / подтвердить); карточка смены: фото до/после, пробег/топливо, расходы, начисление (по праву); «Решение»: замечания + разделы; «Принять смену …?»; гейт «Нет права на приёмку смен»; бейдж в меню; пусто «Нет смен на проверке» |
| `today` | WS-23 | `today.spec.ts` | driver · `logistics-ready` (+ presets по состояниям) | гейт по умолчанию (логистика off); 9 состояний рейса; бронь совместимой/несовместимой; 5 слотов × 5 состояний; «Сбой загрузки фото» → «Ошибка загрузки» + «Повторить»; «Осталось: 1 фото»; пробег < начального — ошибка, +3000 — предупреждение; критический дефект → `defect_review`; расходы (−500 → «Сумма должна быть больше нуля», чек обязателен); «Завершить рейс …?»; офлайн: бронь/выезд блок, расход/сдача в outbox `local/sending/error`, `flush`; «Конфликт брони» alert + «Обновить список»; sticky-панель на 390 |
| `cars` | WS-23 | `cars.spec.ts` | driver · `logistics-ready` | фильтр `group` «Фильтр»: «Все»/«Подходят к рейсу»/«Свободны»; `bookLabel` и disabled-причины; бронь из списка |
| `tenants` | WS-27 | `tenants.spec.ts` | operator · сид | 4 организации, чипы статусов; «Продлить пробный период на 14 дней» (Q4), квота, приостановить — через `opConfirm` «Последствия» → тост «Готово · запись добавлена в журнал»; аудит 6 строк; «26 дн. · до 27.10.2026»; полоса `#A13A33` при 46,2/25; `data-screen-label` (PD-37) |
| `usage` | WS-27 | `usage.spec.ts` | operator · сид | агрегаты (снять с эталона: «59 из 70», «141,4 из 275 ГБ», «34 из 57», 7 сигналов); таблица 860 px — скролл на 390; `data-screen-label` «Оператор · использование» |
| `requests` | WS-27 | `requests.spec.ts` | operator · сид | SR-12 pending / SR-9 approved; одобрить/отклонить с заметкой; бейдж = pending; пусто после решения; цена по версии (Q6) |
| `accounts` | WS-28 | `accounts.spec.ts` | operator · сид | поиск `aria-label="Поиск по имени, почте или организации"`, «Фильтр аккаунтов»; realm «Ортус · Платформа»: роль/статус/приглашение операторов, нельзя себя; поповер «Организации аккаунта» с клавиатуры; «Карточка аккаунта»: блокировка с причиной, сброс MFA; 58 аккаунтов детерминированно |
| `plans` | WS-28 | `plans.spec.ts` | operator · сид | v1 архив / v2 действует; «Черновик vN · не опубликован», 9 правил валидации, «Запланирована версия …», отмена; таблица 760 px на 390 |
| `forms` | WS-25 | `forms.spec.ts` | owner · сид; manager · `logistics-ready` | «Конструктор»: 10 типов, разделы, «Поднять поле»/«Опустить поле»/«Удалить поле», «Показывать, если»; «Опубликовать «{name}» v{N}?»; «Версии» дифф/«Убрано»; «Ответы» по версии, «Не показывался по условию» vs «Не ответил», журнал «Ответ R-… принят → Задача T-…»; manager чип «Только просмотр · нет права «Настраивать»»; Лотос пусто (PD-27); «Новая форма из шаблона · следующий шаг» disabled |
| `tasks` | WS-26 | `tasks.spec.ts` | owner · сид; manager · `logistics-ready`; foreman; owner@t-lotos | «Канбан»/«Список», «Все исполнители»/«Мои задачи»; новая задача («Название / Исполнитель / Приоритет / Срок»), T-170; карточка `aside` «Карточка задачи»: переходы по `TASK_FLOW`, чек-лист блокирует «Готово», комментарии, ссылки → forms/review/fleet; «⚡ из ответа формы»; foreman `leads` (Q5); пусто «Нет проектов в вашей области»; h1 «Задачи»/«Заявки» |
| `calendar` | WS-29 | `calendar.spec.ts` | owner · сид; therapist; manager · `logistics-ready` | 8 ресурсов/6 броней, таймлайн 08–20; панель брони; перенос с конфликтом → `role="alert"` + 3 слота; `min-width` 640 px на 390; Лотос (утечка Q3 — PD-27) |
| `knowledge` | WS-29 | `knowledge.spec.ts` | owner; driver; therapist | «Дерево страниц», «Поиск по базе знаний», «Текст страницы»; правка только owner; `baseVersion` → конфликт (preset `kb-conflict`); приватные страницы скрыты не-владельцу; пусто при пустом поиске (текст — PD-27) |
| `data` | WS-29 | `data.spec.ts` | owner; manager · `logistics-ready`; созданная роль без `data.export` | «Наборы данных»; таблица со скроллом; `hiddenNote` про «Начисление»; «Выгрузить» disabled без права |
| `files` | WS-29 | `files.spec.ts` | owner | список, загрузка, квота (`quota_exceeded` через preset `storage-full`), размеры |
| `spa` | WS-30 | `spa.spec.ts` | therapist; owner; therapist@t-lotos (G2) | «Мой день»/«Салон и SPA»; «Завершить процедуру» → `done_pending` + баннер «Учёт материалов не завершён.» (owner — кнопки, therapist — текст); `busy`; крошка (PD-27); офлайн |
| `cash` | WS-30 | `cash.spec.ts` | owner; owner@t-lotos | журнал, «Провести в …» с inline-валидацией; «Сторнировать K-xxx?» (закрывается и при ошибке — E6); баланс 50 000 ₽ (независимо от #34); «Предложения из принятых смен» (preset `shift-accepted`); Лотос пустой журнал |
| `repair` | WS-31 (+WS-32) | `repair.spec.ts`, `repair-child.spec.ts` | owner · preset `repair-on`; foreman · `repair-on` | гейт по умолчанию «„Ремонт и стройка“ не подключён организацией»; `ObjectHeader` 48 % / «На приёмке 5 %»; «Решений не требуется» до `onStatus`; «Работы»: форма прораба (inline-ошибки), «Принять объём» → 52 % (E5); вкладки «Смета», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика» только `canFin`; 9 дочерних вкладок по 06 §11.5 (Гант: «Вид графика», причины, «Сохранить и уведомить»); эталон дочернего — `Ремонт и стройка.dc.html` на 4173 |
| `planned` | WS-33 | `planned.spec.ts` | owner · прямой URL `/plan/<key>` | недостижима из меню; 9 карт `ROADMAP`; колонки дословно; h2 «Пример: осмотр машины → ответ формы → осмотр → задача менеджеру» |
| оболочка | WS-10 | `shell.spec.ts` | все 8 персонажей | 01 §20 (38 пунктов): брейкпоинты 640/1080, шапка оператора, поповеры, «Ещё» → «Все разделы», 5 баннеров, 4 AccessGate, тост 4200 мс, `Escape`, офлайн-пилюля, `applyBrand` для Лотоса, скелетон «Загружаем рабочее пространство…», `loadErr` |
| модалки `confirm`, `sheet` | WS-10 | внутри `shell.spec.ts` | — | разделы последствий + `ack`; bottom sheet на 390; `Escape`/backdrop |
| модалки `assign`, `invite`, `createRole` | WS-14 | `modals-people.spec.ts` (+ сценарии в `users`, `home`, `billing`) | owner | предзаполнение, ошибки inline, 620/560 px, лист на 390 |
| модалка `request` | WS-22 | внутри `pool.spec.ts` | manager | «Запросить водителя» → «Отправить запрос» |
| документация | WS-11 | `docs-start`, `docs-search`, `docs-api`, `docs-permissions`, `docs-frames` | эталон `Документация.dc.html` на 4173; ширины 390/800/1280/1440 | h1 «Ортус CRM — комплект для старта разработки v0.2»; поиск ≥ 2 символов, «Найдено в N документах»/«Ничего не найдено», `<mark>`; бургер < 960, TOC ≥ 1280 при > 2 заголовков; пейджер; фильтр «Фильтр операций»; `renderPerms`; 3 фрейма + «Ремонт и стройка»: `#dc-root .sc-host`, нет `.sc-logic-error`, нет `[dc-runtime]` в консоли; ошибка «Не удалось загрузить …» |

Сводная таблица «персонаж × страница → состояние на старте» (00 §5 G6) собирается в брифах из 01 §8.3 + 01 §12 «Стартовые срабатывания» и становится параметрами `reference`-фикстуры.

---

## 5. TDD по слоям в угле A, отличия от других углов

### 5.1 Как слои `tdd-protocol.md` §2 ложатся на WS

| Шаг протокола | Где в угле A | Что именно пишется первым |
|---|---|---|
| 1 E2E-скелет | каждый UI-WS, первая задача | `tools/e2e-skeleton.js` генерирует `e2e/<page-key>.spec.ts` из «Чек-лист приёмки» отчёта `0N` — один `test.fixme` на пункт, имя теста = текст пункта + 6 обязательных пунктов §1.3; коммит `test(ws-NN): e2e skeleton <page>` — первый в ветке (12 §5 п.12) |
| 2 Домен | WS-05 (функции `models.js`); в каждом UI-WS — VM как чистые функции `(db, state, clock) → vm` в `routes/<group>/vm/` | примеры `07 §8` (≥ 60); таблицы «Вычисления» отчётов (02 §5.4, §7.3; 03 §11.3; 04 §5.x; 05 §5.5; 06 §11.2) → табличные Vitest-тесты с именами из источника |
| 3 Контракт | фаза 1: `AdapterPort` + conformance-suite WS-06 (62 кейса 07 §14 как тесты адаптера, не DOM); фаза 2: Spectral/drift (WS-03/15), MSW по операции (WS-51), strict-server тесты (WS-40+) | для каждой команды: параметры, `ApiError.code`, побочные эффекты (события, аудит, автоматизация), `view()`-фильтрация ответа |
| 4 Интеграция | backend-WS (testcontainers PostgreSQL 17, MinIO) | репозитории с `scopeQuery`, ограничения (`EXCLUDE`, partial unique), outbox |
| 5 Изоляция/конкурентность | WS-42 (фикстуры) + каждый backend-WS добавляет строки матрицы | чужой тенант/фирма → 404 байт в байт; driver → нет начислений; 100 броней → 1×201 |
| 6 Компоненты | WS-12, WS-13, WS-14 | Testing Library по ролям и подписям; axe на компонент; клавиатура |
| 7 Экран | каждый UI-WS | роутер в памяти + `QueryClient` без retry + **mock-адаптер в памяти с нулевыми задержками** (не MSW — PD-25) + presets для состояний: обычное, пусто, загрузка, ошибка, нет права/модуль не подключён, конфликт, офлайн, только чтение |
| 8 E2E | каждый UI-WS снимает `fixme` по одному, коммит на пункт | mock-режим `npm run dev:web -- --mode e2e`; демо-панель/`?persona=`/`applyPreset` |
| 9 Визуальная сверка | `visual.spec.ts` + `labels.spec.ts` через `reference`-фикстуру WS-07 | эталон на 4173 с теми же персонажем/шириной и UI-шагами гида вместо preset (у эталона presets нет) |

Красный тест обязан падать на утверждении, а не на импорте (tdd-protocol §1); стабы WS-04 (`data-stub`) гарантируют компиляцию, но не поведение — экранный тест на стабах красный по тексту/роли, а не по ошибке сборки.

### 5.2 Чем угол A отличается (честно)

**Плюсы.**
- Максимум параллельных страниц: 14 UI-WS с непересекающимися каталогами; каждая зависит только от оболочки, UI-пакета, адаптера и словаря. Ни один страничный агент не ждёт backend или OpenAPI-дельту.
- Точная копия интерфейса появляется раньше всего: прототип уже содержит рабочий мок и сид (PD-15), а `view()`/guards мока — готовая спецификация серверного поведения (09 §10 п.19). Conformance-suite, написанная один раз против мока, становится приёмочным тестом http-адаптера и стенда.
- Файловая маршрутизация и предсозданные экспорт-листы (`ui/src/index.ts`, `texts/src/index.ts`) убирают общие файлы, которые в 2.0 были источником конфликтов (12 §3.5 п.2).
- Backend идёт по бэклогу S0–S2 в своём темпе, с isolation/concurrency-сюитами, не подстраиваясь под UI-сроки.

**Минусы и риски.**
- Двойная работа на адаптере: TS-мок (WS-06) и Go-реализация (WS-40…50) одного поведения; расхождение мока и реального API — главный риск фазы 2. Смягчение: conformance-suite обязателен для WS-51 (те же 62 кейса), `x-adapter-method` в OpenAPI (WS-15) связывает каждый метод с операциями.
- Один вызов прототипа часто = 2–3 операции контракта (`submitDeparture`, `publishForm`, `upload` — 10 §12.13); страницы, спроектированные под «ответ = полный `db`», при переходе на http потребуют `GET /me/context` после мутаций или инкрементальных ответов (07 §16.10) — нагрузка на WS-51 и возможные правки страниц в волне 3 (не в их каталогах — только в адаптере).
- Серилизация в волне 1: страницы не стартуют до слияния WS-10/12/13. Смягчение — «ранний старт VM-слоя» (§3.3) и загрузка агентов WS-11/14/40/41.
- Интегратор волны 2 — узкое место (14 ребейзов + 25 проверок страниц + визуальная сверка). Предложение: два интегратора (UI/backend) — отклонение от `orchestration.md` §3 (PD-40).
- Автор страницы сам пишет e2e-скелет (tdd-protocol §2 шаг 1), тогда как 2.0 требовал «e2e пишет не автор экрана» (12 §5 п.13). Смягчение: скелет генерируется из чек-листа отчёта (формулировки не авторские), `labels.spec` сверяет тексты с эталоном автоматически, независимый проверяющий страницы вправе добавлять тесты и возвращать WS.
- Страницы сначала тестируются на in-memory адаптере, а не на MSW — отклонение от буквы tdd-protocol §3 («сетевые вызовы мокаются MSW»); в mock-режиме сетевых вызовов нет, поэтому правило применяется к http-адаптеру (PD-25).
- Ограничение «один DOM на все пороги» (12 §5 п.18) против прототипа, где раскладка считается по ширине фрейма `W` в JS (01 §4.3): реализация должна использовать container queries/`ResizeObserver` на фрейме, иначе визуальная сверка на «390 в широком окне» (как у эталона) не сойдётся. Задача WS-10, фиксируется в брифе.
- Оболочка операторского и клиентского контуров — один WS-10 (L); при нехватке времени допустимо выделить тёмную шапку/навигацию оператора в WS-10b (`src/shell/operator/`).

**Где возможны конфликты между агентами** (и как исключены): `packages/ui/src/index.ts` (создан WS-04, не меняется в волне 1); `packages/texts/src/index.ts` (WS-08); `apps/web/src/app/adapter.ts` (WS-10; строка для http добавляется интегратором в волне 3); `e2e/visual/allowlist.md` (разделы по страницам, каждый WS пишет только свой раздел); `docs/plan/status.md` (своя строка); `api/openapi/ortus.yaml` (один владелец на волну: WS-03 → WS-15 → интегратор); `backend/go.mod` (новые зависимости — через интегратора, 12 §5 п.28); `routeTree.gen.ts` (не в git).

**Простои:** backend-агенты в волне 0 (ждут WS-03) — занять WS-41 и ревью волны 0; страничные агенты в волне 1 — ранний старт VM; проверяющие страниц в волне 1 почти не нужны (только shell/docs).

---

## 6. Открытые вопросы, которые план не решает сам

Предложение по умолчанию (как в `decisions.md`) — до решения агенты работают по нему и помечают в отчёте. Нумерация продолжает PD-22.

| ID | Вопрос | Предложение по умолчанию | Источник | Блокирует |
|---|---|---|---|---|
| PD-23 | Демо-панель, гид и `?persona=` в реализации | Да, только в сборке `VITE_ADAPTER=mock` (разметка 01 §5 дословно); в http-сборке отсутствуют | verification-protocol §1.3, §4.3; 01 §5 | WS-10, WS-07 |
| PD-24 | `pg.planned` (G1): реализовать по `roadmap.js` или исключить | Реализовать как S-WS по прямому URL (недостижима из меню, как в прототипе) | 00 §5 G1; 01 §21 Q1 | WS-33 |
| PD-25 | Экранные тесты фазы 1: in-memory адаптер или MSW | In-memory адаптер с нулевыми задержками; MSW — только для http-адаптера (WS-51) | tdd-protocol §2 шаг 7, §3; 07 §16 п.8 | WS-20…33 |
| PD-26 | Presets адаптера для e2e (`logistics-ready` и др.) vs только UI-шаги | Presets разрешены в mock-режиме для предусловий; основной путь гида проходится UI-шагами хотя бы в `shell.spec`/smoke | 03 §16 п.3; 07 §16 п.5; 09 §10 п.20 | WS-06, WS-07 |
| PD-27 | Известные ошибки прототипа: `s.w` вместо `W` (`:2867, 2880, 4159`), дефолты `f-msk-sever`/`r-msk`/`r-manager` в Лотосе, `formsVM` падает при `forms: []`, `onRevoke` не закрывает диалог, захардкоженные имена/даты/крошки, `assertActive` отсутствует в части команд, `busy` не блокирует кассу/ремонт, утечка данных Альты в Лотос | Повторять поведение прототипа, кроме падений и утечек между организациями: `formsVM` → пустое состояние (текст нужен), сид Лотоса очищается от машин Альты, `s.w` → `W`; каждое отклонение — allowlist с причиной | 00 §10 п.5; 02 §11; 05 §10 Q1; 06 §14 Q3, Q6 | WS-05, WS-20, WS-25, WS-29, WS-30 |
| PD-28 | Канон визуала при расхождении CRM ↔ `tokens.json`: `LINE`-границы, `--ox-accent-tint`, высоты 36/40, радиусы 14/16, таблицы со скроллом вместо карточек | «Как нарисовано» в `Ортус CRM.dc.html`; `tokens` дополняются allowlist-токенами с пометкой «prototype» | 11 §11 Q1–Q5; 01 §21 Q2; 06 §15 п.10 | WS-04, WS-12, WS-13 |
| PD-29 | Фокус-ловушка, возврат фокуса, skip-link «К содержимому», закрытие поповеров кликом вне — есть в `components.md`, нет в прототипе | Реализовать по `components.md` (не влияет на пиксели), зафиксировать в allowlist как «расхождение по a11y» | 01 §21 Q3–Q4; 08 §10 Q17; 11 §11 Q6 | WS-10, WS-12 |
| PD-30 | Детерминированные UUID Go-сида из прототипных ID (DP-15) | UUID v5 от `ortus:<tenant>:<prototype-id>`; `Р-208` → номер из `core.counters` с картой в `snapshot.json` | 09 §9 DP-15; 09 §10 п.24 | WS-52 |
| PD-31 | Адресация тенанта: хост `{org}.platform.localhost` (2.0) или `tenantId` в пути/контексте | Путь `/api/v1/tenants/{tenantId}` как в OpenAPI; один origin `localhost:5173`; ADR до WS-40 | 12 §7 Q1; 10 §3.3 | WS-40, WS-07 (`baseURL`) |
| PD-32 | Пиксельные baseline per-platform (Windows dev / Linux CI) | `snapshotPathTemplate` с `{platform}`; обязательна структурная сверка `labels`; baseline Linux — канон CI | 12 §7 Q4; 12 §8 п.19 | WS-07 |
| PD-33 | Состав OpenAPI-дельты v0.2: какие PROPOSED входят (G-02…G-19), `decideDefect` как `reviewInspection` или отдельный эндпоинт, `rework` в `TripReview` | WS-03: ядро + auth + fleet-пробелы G-11 (defect-decision, rework, назначение машины); WS-15: остальное по 07 §7 | 10 §7.4, §11 Q4–Q8; 07 §15 Q5 | WS-03, WS-15, WS-47 |
| PD-34 | `Problem.code` enum и расширение каталога прав (DP-02…DP-04, G-20, G-21) | Enum = 36 кодов `12-errors` + `seats_exhausted`, `request_pending`, `tier_below_usage`, `upload_failed`; каталог + `spa.*`, `inventory.*`, `cash.*`, `branding.*` | 09 §9; 10 §11 Q11–Q12 | WS-03 |
| PD-35 | Единая модель статусов тенанта (прототип 4 / OpenAPI 4 / ТЗ 8) и подписи для `provisioning/grace/read_only/closing/closed` (нет в прототипе) | Backend — 8 состояний ТЗ; UI — карта в 4 чипа прототипа; новые подписи — в `texts/platform.ts` как «не из источников» | 04 §9 Q3; 09 §9 DP-16; 10 §11 Q1–Q2 | WS-27, WS-43 |
| PD-36 | Дочерний макет «Ремонт и стройка» (G4): все 9 вкладок, включая Гант, в волне 2 или Гант отдельно позже | Все 9 в WS-32 (L); перед запуском дописать карту вкладки «График» со строками в 06 §11.5 | 00 §5 G4; 06 §15 п.7 | WS-32 |
| PD-37 | `data-screen-label` для 19 секций без него и значение для `tenants` | Схема «<Роль> · <раздел>» («Оператор · организации» и т. д.), список в `texts/screen-labels.ts`, атрибут только в реализации (в сверке `labels` исключается) | 00 §5 G3; 04 §9 Q14 | WS-08 |
| PD-38 | Версии и менеджер: pnpm (14-engineering) vs npm (2.0), Node 22, Go 1.25/1.26, PostgreSQL 17 vs 16.4 (DP-14), образы по digest (D-04) | pnpm 9, Node 22 LTS, Go последний стабильный на дату старта, PostgreSQL 17 (миграции перепроверить) | 12 §7 Q8–Q9; 09 §9 DP-14 | WS-01, WS-02, WS-41 |
| PD-39 | Пробелы анализа перед запуском агентов: E1–E6 (00 §6), G2 (`therapist@t-lotos`), 02 #44/#51, 04 §5.2 агрегаты, 06 #43/#34–35 | Планировщик правит отчёты точечно до генерации e2e-скелетов (иначе скелеты унаследуют ошибки) | 00 §9 | WS-07 (генератор), все UI-WS |
| PD-40 | Два интегратора в волне 2 (UI/backend) | Да | orchestration §3; §3.2 этого черновика | волна 2 |
| PD-41 | Keycloak в волне 3 (WS-54) или позже | Позже, по PD-18; `e2e:full` на dev-провайдере | PD-18; 12 §7 Q11 | WS-54 |
| PD-42 | Применение `vercel-react-best-practices`: объявить подмножество без Next-правил; `heroui-react` — только справочник (PD-13) | Подмножество в `frontend/CLAUDE.md` (WS-01) | 12 §2; 12 §4.14–4.15 | WS-01 |

Решения D-01…D-12 из `design/docs/16-raid-glossary.md` (в т. ч. D-05 размещение/ПДн, D-08 профиль пилота — блокируют S1 по `docs/README.md:37`) остаются за владельцем продукта; на UI-фазу 1 они не влияют.

---

## 7. Что дальше

1. Утвердить угол (A против B/C) и PD-23…PD-42 по умолчанию.
2. Исправить E1–E6 и дописать G1–G4 в отчётах (PD-39) — до генерации e2e-скелетов.
3. Написать брифы `docs/plan/ws/WS-NN-<slug>.md` по девяти разделам (orchestration §1; 12 §3.5 п.6) для волны 0, запустить `workflow.template.js` с `args.wave = 0`.
4. После ревью волны 0 — волна 1; страницы (волна 2) стартуют pipeline-ом по мере слияния WS-10/12/13.
