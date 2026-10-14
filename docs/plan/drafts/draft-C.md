# Черновик C — декомпозиция плана «вертикальными срезами»

Угол зрения C: **каждый WS = страница(ы) + её операции backend + домен + e2e в обоих режимах (mock и стенд)**. Меньше WS, но каждый закрывается целиком. Общие основания (репозиторий, контракт, токены, домен/сид, адаптеры, харнесс, backend-платформа, UI-kit, оболочка, сайт документации) — отдельные ранние WS.

Опирается, не переписывая: `docs/plan/decisions.md` (PD-13…PD-22), `orchestration.md` (WS, волны, роли, отчёт), `tdd-protocol.md` (шаги 1–9), `verification-protocol.md` (§1–§7), `workflow.template.js`. Ground truth: `analysis/00-coverage-critique.md` §10 — 25 ключей страниц, 6 модалок, 35 VM, 51 вызываемый метод адаптера, 8 персонажей, 57 статических `aria-label`, 6 `data-screen-label`.

Как угол C уживается с PD-15 (фаза 1 = весь UI на mock, фаза 2 = backend S0–S2, фаза 3 = остальное): внутри одного WS две половины — **mock-половина** (UI + домен + MSW + e2e в режиме mock) и **стенд-половина** (операции Go + http-адаптер + e2e на compose). Для страниц S0–S2 обе половины реальные; для страниц S3+ стенд-половина — «заготовка» (§2.6), а e2e-стенд остаётся `test.fixme` со ссылкой на PD-15. Это даёт точную копию интерфейса (фаза 1) без разрыва контракта между слоями.

---

## 1. Структура репозитория (до 3 уровней, владелец-WS)

Корень = `D:\work\test26042026_Kirill_3.0` (сейчас: `.claude/skills`, `design/`, `docs/plan`, `tools/`, `skills-lock.json` — 12 §8 п.1). Раскладка — `design/docs/14-engineering.md:26–51` + pnpm workspace; изменения ниже — в скобках.

```text
/
├─ .github/workflows/ci.yml                  WS-01 (PD-20); этапы по 14-engineering.md:85–94
├─ .husky/, .editorconfig, .gitattributes    WS-01
├─ .claude/settings.json                     WS-01 (PostToolUse-формат), WS-06 (Stop-хук verify-pages)
├─ .claude/skills/                           есть; не трогать
├─ .mcp.json                                 WS-06 (@playwright/mcp пин, 12 §6 #1–3)
├─ CLAUDE.md, Makefile, package.json, pnpm-workspace.yaml, CODEOWNERS   WS-01
├─ api/
│  ├─ openapi/ortus.yaml                     WS-02 (единственный источник контракта, PD-17); после WS-02 — только интегратор
│  ├─ permissions.yaml                       WS-02 (= design/docs/11-permissions.yaml + spa/inventory/cash/branding, DP-03/04)
│  ├─ spectral.yaml                          WS-02
│  └─ examples/                              WS-02 (примеры ответов → MSW)
├─ backend/                                  go.mod
│  ├─ cmd/{api,worker,provisioner,migrate}/  WS-07; cmd/seed/ — WS-04 (PD-19)
│  ├─ internal/api/                          генерируется (`make gen`, WS-02); руками не правится
│  ├─ internal/platform/
│  │   httpx, problem, idem, clock, scopeddb, storage, events, audit  WS-07 (скелет) → WS-13 (полная реализация)
│  │   authz, tenantctx, session              WS-13
│  ├─ internal/domain/{fleet,access,billing,...}   WS-04 (Go-копия правил models.js); после волны 0 подпакет <module> — владелец среза
│  ├─ internal/control/{tenants,accounts,subscriptions,requests,pricebook,operators,usage,branding,provisioning}
│  │                                          WS-23 (tenants, accounts, operators, usage), WS-24 (requests, pricebook), WS-22 (branding), WS-26 (provisioning)
│  ├─ internal/modules/
│  │   access/ org/ people/                   WS-20
│  │   modulesreg/ billing/                   WS-21
│  │   files/                                 WS-14
│  │   fleet/ (vehicles, reservations, inspections, trips, expenses)   WS-31
│  │   fleet/review, fleet/pool, fleet/routes WS-30 (отдельные Go-пакеты; импортируют fleet/api.go)
│  │   data/                                  WS-36
│  │   forms/ tasks/ sched/ knowledge/ spa/ inventory/ cash/ repairs/ notify/   заготовки WS-33…38, WS-32 → реализация WS-50…57
│  ├─ migrations/{control,tenant}/            WS-07 (control 0001–0003, tenant 0001–0002 из design/docs/db); drafts/ — срезы S3+
│  └─ test/{harness,isolation,concurrency,contract}/   WS-07 (harness), WS-13 (фикстуры 15-quality «Фикстуры изоляции»); строки матрицы — каждый WS
├─ frontend/
│  ├─ apps/web/
│  │   src/app/ (router TanStack file-based, providers)         WS-11
│  │   src/shell/ (AppShell, demo-panel, guide, gate, banners, toast, modals×6)   WS-11
│  │   src/routes/<page-key>/ + src/features/<domain>/           WS среза (таблица §4)
│  │   src/mocks/ (MSW handlers, glob-сборка)                    WS-05 (каркас), handlers/<domain>.ts — WS среза
│  │   e2e/<page-key>.spec.ts, e2e/visual/, e2e/journeys/       WS-06 (каркас, helpers, allowlist), spec — WS среза, journeys — WS-41
│  │   playwright.config.ts                                      WS-06
│  ├─ apps/docs/ (React+TS читалка; public/design/ — копия design/ на сборке, PD-16)   WS-12
│  └─ packages/
│      tokens/ (tokens.json → css/ts, fonts/ OFL, vendor/ React UMD)   WS-03 (PD-21)
│      ui/ (@ortus/ui, 30 компонентов + Storybook)                  WS-10 (PD-13)
│      domain/ (types, правила, справочники, seed/, roadmap/)        WS-04; после волны 0 src/<module>/ — владелец среза, src/core/ заморожен
│      adapter/ (порт OrtusApi, ApiError), adapter-mock/, adapter-http/   WS-05
│      api-client/ (openapi-typescript + openapi-fetch, генерируется)  WS-02
│      e2e-kit/ (reference.ts, labels.ts, axe, scenario)             WS-06
│      texts/ (общие тексты оболочки и Problem.code → текст)         WS-11 (shell), WS-05 (коды)
├─ deploy/compose/ (docker-compose.yml, .env.example, keycloak/, profiles dev|test|e2e|keycloak)   WS-07; keycloak/ — WS-40
├─ design/                                   ЭТАЛОН, неприкосновенен (orchestration.md §7)
├─ docs/{plan,adr}/                          план; adr — WS-01 (шаблон), решения — интегратор
└─ tools/design-preview.js (+ --offline), verify-pages.js, labels-dump.js   WS-06
```

Правило границ: директория принадлежит ровно одному активному WS на волну; соседние WS пользуются ею только через опубликованный контракт (orchestration.md §1). Файлы-«хабы», которые иначе правили бы все (регистрация маршрутов, индекс MSW-хендлеров, индекс текстов), заменены на file-based routing и glob-импорты — у них нет владельца, потому что их нет.

---

## 2. Таблица WS

Легенда: размер S ≈ до 2 дней агента, M ≈ 3–5, L ≈ неделя+ (13-backlog-s0-s2.md:3). «Тесты-первыми» — что пишется до реализации по tdd-protocol.md §2. Ревьюеров 2 — для authz/миграций/финансов (orchestration.md §3). Ссылки на анализ — `0N §раздел`. Карточка WS — заготовка брифа `docs/plan/ws/WS-NN-<slug>.md` (поля по orchestration.md §1).

### 2.1 Сводная таблица

| id | slug | волна | размер | экраны / операции | зависит от | блокирует |
|---|---|---|---|---|---|---|
| WS-01 | bootstrap | 0a | S | — (репо, CI, хуки) | — | все |
| WS-02 | contract | 0b | L | OpenAPI (118 + допроектирование G-01…G-22), permissions, codegen, MSW-генератор | WS-01 | WS-05, WS-07, все срезы |
| WS-03 | tokens-fonts | 0b | S | tokens.json → css/ts; шрифты/иконки офлайн; vendor React | WS-01 | WS-06, WS-10, WS-12 |
| WS-04 | domain-seed | 0b | M | packages/domain, Go-домен, сид TS+Go, roadmap | WS-01 | WS-05, WS-11, WS-13 |
| WS-05 | adapters | 0b | M | OrtusApi (53 метода), adapter-mock, adapter-http, MSW | WS-02, WS-04 | WS-11 |
| WS-06 | e2e-harness | 0b | M | Playwright 3 проекта, эталон 4173 (+offline), визуальная/структурная сверка, MCP, хук verify-pages | WS-01, WS-03 | WS-10, WS-11, WS-12 |
| WS-07 | backend-skeleton | 0b | M | compose, cmd/*, platform-скелет, миграции 0001–0003/0001–0002, testcontainers, dev-вход (PD-18) | WS-01, WS-02 | WS-13, WS-14 |
| WS-10 | ui-kit | 1 | L | @ortus/ui — 30 компонентов | WS-03, WS-06 | WS-11, срезы |
| WS-11 | shell | 1 | L | `planned`; оболочка, демо-панель, гид, гейт, баннеры, тост, 6 модалок; маршрутизация | WS-05, WS-10 | все срезы |
| WS-12 | docs-site | 1 | M | сайт документации (36 документов, 3 фрейма) | WS-03, WS-06 | — |
| WS-13 | platform-core | 1 | L (2 ревьюера) | authz permit/scopeQuery, tenantctx, session, idem, audit, outbox, `/me/context`, фикстуры изоляции | WS-07, WS-04 | стенд-половины срезов |
| WS-14 | files-storage | 1 | L | upload session, download, квота (S1-20/21/22) | WS-07, WS-13 | WS-31, WS-22, WS-36 |
| WS-20 | company-access | 2 | L (2) | `users` + модалки assign/invite/createRole; access/org/people | WS-11, WS-13 | WS-41 |
| WS-21 | company-subscription | 2 | L | `modules`, `billing`; modulesreg/billing/storage | WS-11, WS-13, WS-14 | WS-41 |
| WS-22 | company-branding | 2 | M | `branding`; control/branding, public branding | WS-11, WS-13, WS-14 | — |
| WS-23 | platform-tenants | 2 | L | `tenants`, `usage`, `accounts`; control/platform | WS-11, WS-13 | WS-41 |
| WS-24 | platform-pricing | 2 | M | `plans`, `requests`; pricebook, subscription-requests | WS-11, WS-13 | — |
| WS-26 | provisioning | 2 | L (2) | backend-only: createPlatformTenant, миграционный контроллер | WS-13 | WS-40 |
| WS-30 | logistics-manager | 2 | L (2) | `fleet`, `pool`, `review` + модалка request; fleet/review, pool, routes | WS-11, WS-13, WS-31 (api.go) | WS-41 |
| WS-31 | logistics-driver | 2 | L (2) | `today`, `cars`; fleet core, outbox (в памяти, как нарисовано) | WS-11, WS-13, WS-14 | WS-30 (стенд), WS-41, WS-42 |
| WS-32 | home | 2 | M | `home`; композиция + заготовка ленты событий | WS-11 | — |
| WS-33 | forms | 2 | M | `forms` (+ confirm публикации); заготовка forms | WS-11 | WS-50 |
| WS-34 | tasks | 2 | M | `tasks`; заготовка tasks | WS-11 | WS-51 |
| WS-35 | calendar-knowledge | 2 | M | `calendar`, `knowledge`; заготовка sched/knowledge | WS-11 | WS-52 |
| WS-36 | data-files | 2 | M (2) | `data`, `files`; data real (S2-16), files list | WS-11, WS-13, WS-14 | — |
| WS-37 | spa-cash | 2 | M | `spa`, `cash` (+ confirm сторно); заготовка spa/inventory/cash | WS-11 | WS-53, WS-54 |
| WS-38 | repair-object | 2 | M | `repair` (Обзор, Работы, контейнер вкладок); заготовка repairs | WS-11 | WS-39 (контракт), WS-55 |
| WS-39 | repair-tabs | 2 | L | 9 дочерних вкладок «Ремонт и стройка» (Гант) | WS-11, контракт WS-38 | — |
| WS-40 | auth-keycloak | 3 | L (2) | Keycloak, BFF OIDC, приглашение, переключатель бизнеса | WS-13, WS-26 | `e2e:full` с IdP |
| WS-41 | journeys-e2e | 3 | M | J1–J18 (08 §6), «Путь проверки» 8+7 — в обоих режимах | все срезы волны 2 | — |
| WS-42 | pwa-offline | 3 | L | Workbox, персистентный outbox (S2-15) | WS-31 | — |
| WS-43 | ops-quality | 3 | M | k6, restore drill, SBOM, Schemathesis nightly | WS-13, WS-26 | — |
| WS-50…57 | s3-backends | 4 | M каждый | forms, tasks, sched+knowledge, spa+inventory, cash, repairs, notify+realtime, автоматизация осмотр→ответ→задача | WS-13, срезы | — |

Итого 40 WS: волна 0 — 7, волна 1 — 5, волна 2 — 16 (покрывают 25 ключей и 6 модалок), волна 3 — 4, волна 4 — 8.

### 2.2 Волна 0 — основания

**WS-01 bootstrap** — волна 0a, S, один агент до всех остальных (12 §8 п.15: «S0 проходила ревью до старта потоков»).
- Цель: пустой репозиторий → собираемый монорепо с CI и хуками.
- Владение: корень, `.github/`, `.husky/`, `.claude/settings.json`, `docs/adr/`.
- Входы: 14-engineering.md:24–94; 12 §8 п.2 (пины версий), п.8 (`.golangci.yml` с возвращённым `depguard`), п.25 (коммиты без BOM); PD-20.
- Выходы: `pnpm-workspace.yaml`, `backend/go.mod`, `Makefile` (`gen`, `up`, `migrate`, `seed`, `dev`, `e2e`, `e2e:full`), `ci.yml` (lint → contract → unit → integration → isolation+concurrency → build → e2e → visual), CODEOWNERS (`authz/**`, `migrations/**`, `finance*`, `permissions.yaml`), `CLAUDE.md` (корень, backend, frontend — 12 §8 п.27), шаблон ADR.
- Контракты: имена npm-скриптов и make-целей, на которые ссылаются tdd/verification-протоколы.
- Тесты-первыми: 12 §6 #13, #19–22 (lint-staged, порядок коммитов `test(` → `feat(`, BOM в сообщении).

**WS-02 contract** — волна 0b, L.
- Цель: один источник контракта для обеих сторон до любой реализации (PD-17).
- Владение: `api/**`, `backend/internal/api/` (gen), `frontend/packages/api-client/`.
- Входы: 10 §5–§7 (118 операций; карта экранов → операции §7.3; пробелы G-01…G-22 §7.4); 07 §4 (51 метод), 07 §6 и 09 §5 (коды → `Problem.code` enum, 36 + DP-02); 09 §4.4/§4.6 (переименования прав, словарь областей); PROPOSED из `17/18/19`.
- Выходы: `ortus.yaml` с операциями, нужными 25 страницам: `revokeInvitation`, `listGroups`, `explainAccess`, seat-requests (владелец и оператор), price-book versions, accounts lock/mfa, operators, `GET /platform/usage`, `/branding*`, `assignVehicle`, решение по дефекту, `finishRoute` (`returning`), `reviewTrip.rework+steps`, чек-лист/комментарии задач, `resolveIssue`, work-logs accept/return, список файлов, `GET /me/notifications`; `Problem.code` как enum; `permissions.yaml` расширен (DP-03/04); `make gen`; `api/examples/` и генератор MSW-хендлеров.
- Контракты: публикует operationId, схемы, коды, ключи прав — потребляют все.
- Тесты-первыми: Spectral + «каждый `x-permissions` в каталоге» (12 §6 #17); дрейф codegen; снапшот списка operationId; «каждый код из `12-errors-and-events.md` присутствует в enum».
- Поставка в два среза: cut-1 (S0–S2 + платформа + коды) — до волны 1; cut-2 (S3+ операции) — до волны 2. Оба вливает интегратор, после чего файл заморожен для срезов.

**WS-03 tokens-fonts** — волна 0b, S.
- Цель: детерминированные токены и офлайн-шрифты (PD-21).
- Владение: `frontend/packages/tokens/`.
- Входы: 11 §3 (каталог токенов), §8 (шрифты), §11 Q1–Q4 (расхождения LINE/TONE, радиусы, высоты — PD-38 в §6); 01 §22 п.9, п.17–18.
- Выходы: `tokens.css`/`tokens.ts` из `tokens.json`; `fonts/` Golos Text 400–700, IBM Plex Mono 400/500, Material Symbols Rounded variable (`opsz,wght,FILL,GRAD`) + лицензии OFL; `fonts.css`; `vendor/react*.production.min.js` 18.3.1 для фреймов (PD-16).
- Тесты-первыми: снапшот CSS-переменных `--ox-*` против `design/docs/design-system/tokens.css`; Playwright `document.fonts.check` для трёх семейств без сети.

**WS-04 domain-seed** — волна 0b, M.
- Цель: правила и сид до UI и backend (S0-06, PD-19).
- Владение: `frontend/packages/domain/`, `backend/internal/domain/`, `backend/cmd/seed/`.
- Входы: 07 §8 (25 функций, ≥60 кейсов), §9 (сид), §10 (JSDoc → TS), §11 (переименования прав); 09 §7.2–7.3 (конвертер единиц, UUID из прототипных ID — DP-15); 03 §16 п.4, 06 §15 п.4, 02 §12 п.13–15, 04 §10 п.10 (чистые функции страниц).
- Выходы: `types.ts`; `core/` (`can`, `canEarnings`, `grants`, `moduleOn`, `rolePermKeys`, `scopeLabel`, `plural`, `rub`, `num`, `brandVars`/`contrastW`/`fixAccent`); `fleet/` (`compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`); `sched/` (`bookingConflicts`, `freeSlots`, `busySpan`); `billing/` (`calc`, `tierList`, `validateDraft`); справочники (`TRIP_STATE`, `VEHICLE_STATE`, `WORKFLOWS`, `TASK_FLOW`, `INDUSTRY`, `CORE`, `REASON`, `TENANT_STATE`, `BR_TERMS`…); `seed/` (порт `mock-data.js` + `extra-data.js`, детерминированный `fillAccounts`, сценарные оверлеи `scenario('empty-review')` для пустых состояний — 04 Q13, 06 Q11); `roadmap/` (порт `roadmap.js` для `planned`); Go-копии правил; `cmd/seed` (UUID v5 от прототипных строк); снапшот-тест равенства идентификаторов TS/Go.
- Контракты: типы домена; API сида `seed(tenantId, scenario?)`.
- Тесты-первыми: таблицы из 07 §8; `rolePermKeys` 22/10/5/6 (02 §12 п.15); `brandVars('#1F6B52')` → `#195843/#E0EAE7/#EFF5F3` (00 §6); `fixAccent('#FFD400')`; `calc` (02 §7.3); `pc()` 48 % → 52 % (E5).

**WS-05 adapters** — волна 0b, M; после WS-02 cut-1 и WS-04.
- Цель: единый порт `OrtusApi` с двумя реализациями и MSW (PD-15; 14-engineering.md:123).
- Владение: `frontend/packages/adapter*`, `frontend/apps/web/src/mocks/` (каркас + glob), `packages/texts/codes.ts`.
- Входы: 07 §3–§7, §12–§14 (62 проверки эффектов адаптера); 10 §7.1–7.2 (один вызов = 2–3 операции); 07 §6 (18 кодов мока → 36 канонических); 09 §10 п.19–20 (`view()` как спецификация field policy и MSW-сценариев).
- Выходы: `OrtusApi` (53 метода; `ApiError{code,status,violations,requestId}`); `adapter-mock` (порт `api.js`: `dbs[tenantId]` + `platform`, `cmd` с задержками, `view()`, флаги `online/conflictNext/failUploadNext`, идемпотентность `opId`, сценарии сида); `adapter-http` (openapi-fetch, `Idempotency-Key`/`If-Match`, маппинг составных вызовов, маппинг кодов); MSW-хендлеры из `api/examples` + режим «MSW поверх adapter-mock».
- Контракты: `VITE_ADAPTER=mock|http`, `VITE_SEED_SCENARIO`.
- Тесты-первыми: **паритет адаптеров** — одна Vitest-сюита (ожидания из 07 §14) гоняется против `adapter-mock` и против `adapter-http+MSW`; каждый из 51 метода — минимум один тест; каждый код — тест маппинга.

**WS-06 e2e-harness** — волна 0b, M; после WS-01, WS-03.
- Цель: харнесс для всех страниц и механизм, который не даёт пропустить проверку.
- Владение: `frontend/packages/e2e-kit/`, `frontend/apps/web/playwright.config.ts`, `e2e/{visual/allowlist.md,fixtures,helpers}`, `tools/{design-preview.js,verify-pages.js,labels-dump.js}`, `.mcp.json`, Stop-хук в `.claude/settings.json`, `docs/plan/evidence/README.md`.
- Входы: verification-protocol.md §2–§6; 12 §3.3, §6 #1–10 (MCP, PORT, проекты, `snapshotPathTemplate {platform}`, labels-сверка, allowlist хостов); 11 §7.4 (офлайн-фреймы); 01 §5 (демо-панель как единственный способ управлять эталоном).
- Выходы: проекты `mobile-390`/`tablet-768`/`desktop-1440`; `reference.ts` (`openReference({persona, page, width, flags})` — выставляет `<select>` «Персонаж»/«Ширина», флажки, переходит по подписи меню или `go()`, скрывает `[aria-label="Панель демонстрации"]`, снимает `#dc-root`); `labels.ts` (тексты `button,a,h1-h3,label,[aria-label]`); `axe.ts`; `scenario.ts`; `design-preview.js --offline` (на лету подставляет `window.__resources` и `fonts.css` в ответ — `design/` не меняется); `verify-pages.js` (по `git diff --name-only` → `routes/**` → ключи страниц без свежего `evidence/<key>/`) + Stop-хук; `npm run mcp:install`; `e2e:full` (compose `--profile e2e`, `make migrate seed`, Playwright против 5173).
- Тесты-первыми: 12 §6 #1–10 как самотесты харнесса; unit `labels.ts` на статическом HTML; unit `verify-pages` на поддельном diff.

**WS-07 backend-skeleton** — волна 0b, M; после WS-01, WS-02 cut-1.
- Цель: `make up && make migrate && go test` работают; один запрос проходит браузер → BFF → API → tenant DB (выход из S0).
- Владение: `backend/cmd/`, `backend/internal/platform/` (скелет), `backend/migrations/`, `backend/test/harness/`, `deploy/compose/`, `.golangci.yml`.
- Входы: 14-engineering.md:96–115; 10 §12 п.4–7, п.17, п.22; 12 §6 #11–18, #23–25; 12 §8 п.11–13 (конвейер 7 шагов, middleware из 2.0); 09 §2 (btree_gist, роли БД); PD-18.
- Выходы: compose (postgres:17 по digest, minio + minio-init, mailpit, otel; `keycloak` — отдельный профиль, пустой до WS-40); `cmd/{api,worker,migrate,provisioner}`; `platform/{httpx (RequestID → Logging → CSRF, `Cache-Control: private, no-store`, `X-Request-Id`), problem (RFC 9457 + enum), idem (скелет), clock (инжектируемый), scopeddb, storage (MinIO), events (outbox-таблица), audit (скелет)}`; goose-миграции из `design/docs/db/*.sql`; harness testcontainers (PostgreSQL 17 — DP-14, PD-34); dev-провайдер входа `POST /auth/dev-login {memberId, tenantId}` под build tag `dev` → cookie `ortus_sid`; минимальный `GET /me/context`.
- Тесты-первыми: 12 §6 #11–12 (harness падает без БД; миграции применяются), #16 (четыре 404 байт-в-байт), #18 (`application/problem+json`), #23–24 (cookie/CSRF); миграции up/down на двух tenant DB.

### 2.3 Волна 1 — оболочка, UI-kit, документация, платформа

**WS-10 ui-kit** — L.
- Цель: `@ortus/ui` — 30 компонентов контракта с метриками, как нарисовано в CRM и на витрине.
- Владение: `frontend/packages/ui/`.
- Входы: `design/docs/design-system/components.md:15–44`; 11 §4.1–4.20 (контракт → витрина → CRM, с расхождениями: кнопки 36/40 px, рамки `LINE`, счётчик табов neutral, фокус-ловушка); 11 §12 п.15 (витрина как источник визуальных снимков); 01 §22 п.16 (размеры целей).
- Выходы: Button, IconButton, Field + 6 полей, Checkbox/Switch/Radio, Status, SyncState, Banner, AccessGate, Card, DataTable, CheckList, PhotoSlot, LoadBar, Stepper, Dialog/ConfirmDialog, Sheet, Toast, EmptyState, Skeleton, AppShell (каркас), ScopeSelect, RoleEditor, ConflictNotice, ObjectHeader, ReadinessBar, DecisionQueue, Tabs; Storybook.
- Контракты: пропсы по `components.md` — после слияния меняет только интегратор.
- Тесты-первыми: на каждый компонент — состояния по ролям/подписям + axe (tdd §3 TS); клавиатура (Tabs ←/→, Dialog Esc + ловушка — PD-26); `toHaveScreenshot` Storybook-историй против секций `#buttons`, `#fields`, `#status`, `#access`, `#data` витрины `Дизайн-система.dc.html` через 4173.

**WS-11 shell** — L.
- Цель: приложение целиком без страниц — всё, что 01-shell называет «оболочкой».
- Владение: `frontend/apps/web/src/{app,shell}/`, `src/routes/plan.$id/`, `packages/texts/shell.ts`, `e2e/{shell,demo-panel,guide,planned}.spec.ts`.
- Входы: 01 §4–§18 целиком (раскладка 640/1080 §4, демо-панель §5, гид §6, boot §7, маршрутизация §8, навигация §9, шапка §10, баннеры §11, гейт §12, тост §13, модалки §14 — все 6 видов с обработчиками `saveAssign/saveInvite/saveCreateRole/saveRequest/confirm`, planned §15, онлайн/офлайн/Escape §16, оформление §17); 01 §20 (чек-лист 38 пунктов); 01 §22 п.4–5 (чистые функции `navForBase`, `brandNav`, `gateVM`, `bannersVM`); roadmap из WS-04.
- Выходы: TanStack file-based router с URL-схемой (PD-25): `/t/:tenantId/:page`, `/platform/:page`, `/plan/:id`; параметры страниц в search (`?task=`, `?form=&tab=&resp=`, `?trip=`); `AppShell` на компонентах WS-10; демо-панель и гид «Путь проверки» только при `VITE_ADAPTER=mock` (PD-23); модальный контейнер и 6 видов; тост и `run()`; баннеры; гейт; `applyBrand`; Escape; `online/offline` + интерфейс `outbox.flush()` для WS-31; состояния `loading`/`loadErr`; `data-screen-label` для всех секций (PD-42).
- Экраны: `planned` (`pg.planned`, недостижима из меню — доступна по `/plan/:id`, G1 → PD-24).
- Тесты-первыми: `shell.spec.ts` (01 §20 #1–38 в `fixme`: персонажи и стартовые страницы, группы меню по таблице 01 §9.1, нижняя навигация 3 + «Ещё», лист «Все разделы», баннеры 5 видов, гейт по таблицам 01 §12, тост 4200 мс, поповеры «Новых событий нет» / «Выйти · недоступно в демо», скелетон «Загружаем рабочее пространство…», ошибка «Не удалось загрузить модули прототипа: …»); `demo-panel.spec.ts`; `guide.spec.ts` (8 шагов + 7 негативных дословно); `planned.spec.ts` (тексты `ROADMAP` по 9 ключам); unit `navForBase/brandNav/gateVM/bannersVM`; компонентные тесты 6 модалок (поля, `emailOk`, «Выполняем…»).

**WS-12 docs-site** — M.
- Цель: сайт документации «точно как нарисовано» в нашем стеке + хостинг трёх фреймов как есть (PD-16).
- Владение: `frontend/apps/docs/`, `tools/docs-copy-design.js`.
- Входы: 11 §6.1–6.11 (реестр 36 документов, группы, поиск 220 мс / top 15 / сниппет 70+90, маршрутизация `#/id`, рендереры md/code/perm/api/frame, TOC ≥ 1280, бургер < 960, пейджер, стили `S` 1:1 §6.7, mermaid); 11 §7 (`support.js`, что отдавать статикой, CSP); 11 §10 (чек-лист 11+); 11 §11 Q8–Q13; 11 §12 п.4–п.19.
- Выходы: читалка React+TS (marked, js-yaml, mermaid — локально); `public/design/` — копия `design/` на сборке с подстановкой `window.__resources` (vendor React) и `fonts.css` в копии (эталон не меняется); `renderPerms`/`renderApi` — чистые функции над YAML.
- Экраны: `#/start … #/objects-variants` (36 документов), фреймы `design-system`, `prototype`, `objects-variants`.
- Тесты-первыми: `docs-reader.spec.ts` (11 §10 #1–11: h1 «Ортус CRM — комплект для старта разработки v0.2», навигация, `aria-current`, пейджер «← Назад / Далее →», TOC «На странице», мета «Исходный файл»); `docs-search.spec.ts` («Найдено в N документах», «Ничего не найдено», `<mark>`); `docs-api.spec.ts` (пилл «76 путей · 118 операций · 199 схем», «Операций по фильтру «…» нет.»); `docs-perm.spec.ts` (h2 «Каталог прав», «Шаблоны ролей», «Переименования из прототипа»); `docs-frames.spec.ts` (`#dc-root .sc-host`, нет `.sc-logic-error`, консоль без `[dc-runtime]`, сеть без CDN); unit рендереров на реальных файлах (76/118/199/18).
- Визуальная сверка с `4173/Документация.dc.html` на 390/800/1280/1440 (11 §12 п.9).

**WS-13 platform-core** — L, 2 ревьюера.
- Цель: всё, без чего ни одна стенд-половина не честна: права, контекст, сессия, идемпотентность, аудит, outbox.
- Владение: `backend/internal/platform/{authz,tenantctx,session,idem,audit,events}`, `backend/internal/control/{tenants,accounts,memberships}` (чтение), `backend/test/{isolation,concurrency}` (фикстуры), `GET /me/context`.
- Входы: 09 §4 (77 ключей, уровни, restricted), §5 (контракт ошибок; Idempotency-Key 409/`Retry-After`; If-Match 428/412), §6 (инварианты конкурентности с тестами), §10 п.9–16; 10 §3 (`x-authorization-order`), §9; 15-quality «Фикстуры изоляции»; S1-02, S1-05 (часть: `session.Manager`), S1-11, S1-14, S1-15, S1-23–26; 12 §8 п.11–13.
- Операции: `getMyContext`, `explainAccess` (ядро); middleware для всех.
- Тесты-первыми: `permit()`/`scopeQuery()` табличные (пользователь с двумя ролями «изменять Москва-1 / читать Самара-2»; driver + `fleet.earnings.read` через группу → fail-closed); AC-01, AC-02, AC-07, AC-10 как isolation/concurrency; «последний владелец» под `FOR UPDATE`; `policy_version` в ключе кеша; четыре 404 байт-в-байт.

**WS-14 files-storage** — L.
- Цель: файлы и квота как в контракте (S1-20/21/22).
- Владение: `backend/internal/modules/files/`, `deploy/compose/minio-init`.
- Входы: 10 §2 (резерв → UploadTicket → complete 202 → scan → ready/rejected; короткий URL ≤ 60 с); 09 §7.1 (`storage.breakdown` по `purpose`), §10 п.21; 03 §10 (слоты фото, `failUploadNext`); 10 §7.1 `upload`.
- Операции: `initiateUpload`, `completeUpload`, `getFile`, `getFileDownload`, `getStorageUsage`, `requestStorageChange` (quote/commit), `listFiles` (новая, G-10).
- Тесты-первыми: интеграция MinIO (резерв → PUT → complete → ready); квота — конкурентные резервы не превышают лимит; isolation: чужой `fileId` → 404; AC-05: метаданные файла без начислений.

### 2.4 Волна 2 — вертикальные срезы (все 25 ключей и 6 модалок)

Общее для каждого среза. Владение: `apps/web/src/routes/<page-key>/`, `src/features/<domain>/`, `src/mocks/handlers/<domain>.ts`, `e2e/<page-key>.spec.ts`, `e2e/visual/<page-key>.{visual,labels}.spec.ts`, `packages/domain/src/<module>/` (если нужен), `backend/internal/modules/<module>/` (или `control/<x>`), `backend/migrations/*/drafts/`, строки в `backend/test/isolation`. Входы всегда включают разделы «Инвентарь», «Инварианты», «Чек-лист приёмки», «Открытые вопросы» своего отчёта. Тесты-первыми всегда начинаются с e2e-скелета страницы в `fixme` (один `test()` на пункт чек-листа + обязательные пункты verification-protocol §1.3). Операции со звёздочкой (*) — допроектированы в WS-02.

**WS-20 company-access** — L, 2 ревьюера.
- Экраны: `users` (вкладки «Люди», «Группы», «Роли», «Проверка доступа»); закрывает e2e модалок `assign`, `invite`, `createRole` (открываются из `users` и `home`).
- Входы: 02 §6 (usersVM 3134–3161, roleEditorVM 3163–3207, accessVM 3209–3238); 02 §10 #15–36; 02 §11 (дефолты Лотоса, `roleSel`); 09 §4.7, §8 P-01…P-03; 10 §7.3 `users`.
- Операции: `listMembers`, `getMember`, `updateMember`, `inviteMember`, `revokeInvitation`*, `listRoles`, `getRole`, `createRole`, `updateRole` (If-Match из `current_version`, DP-17), `deleteRole`, `listAssignments`, `createAssignment`, `revokeAssignment`, `listOrgUnits`, `listGroups`*, `explainAccess` (UI).
- Backend: `modules/{access,org,people}`, `control/invitations` (S1-06, S1-08, S1-09, S1-12, S1-13, S1-16; группы с первого сида — 08 §11 п.17).
- Тесты-первыми: 02 #15–36 fixme; Go: назначение driver → `409 separation_of_duties_conflict`; последний владелец не снимается; `rolePermKeys` 22/10/5/6; P-01…P-03; isolation «чужая фирма → 404».

**WS-21 company-subscription** — L.
- Экраны: `modules`, `billing`; модалка `confirm` для подключить/отключить/лимит/trial/отозвать приглашение.
- Входы: 02 §5 (omVM 3095–3132, `toggleModule`, `applyQuota`, `confirmTrialEnd`); §7 (billingVM 3901–3942, `tierList/calc/termLabel`); 02 §10 #1–14, #37–47 (с исправленным #44 «8 из 10»); 02 §11 (`onRevoke` не закрывает диалог, `t-alta` жёстко, понижение тарифа); 10 §7.3 `modules`/`billing`; 09 §10 п.21.
- Операции: `listModuleCatalog`, `getModuleInstallation`, `setModuleInstallation` (PUT + If-Match; draining/read_only — S1-17/18/19), `getStorageUsage`, `requestStorageChange` (через WS-14), `getTenantSubscription`, `requestSeats`*/`cancelSeatRequest`* (модель `17` — PD-29), `getPriceBookCurrent`*.
- Backend: `modules/modulesreg`, `modules/billing`.
- Тесты-первыми: 02 #1–14, #37–47 fixme; E2 «Доступ через роли: 1 сотрудник»; AC-11 (read-only); AC-12 (отключение с активным рейсом — фикстура из WS-31, стенд-часть закрывается при интеграции); concurrency `scr_one_pending_uq`; `calc` по таблице 02 §7.3.

**WS-22 company-branding** — M.
- Экран: `branding`.
- Входы: 02 §8 (brandingVM 3666–3734, `brandNav`, `applyBrand`); 02 §10 #48–64 (#51 — зафиксировать `fixAccent('#FFD400')` заранее); 01 §17; `design/docs/18-branding.md`; 09 §10 п.23; BR-T1…T3 (15-quality).
- Операции: `getBranding`*, `putBranding`* (`accent_used` считает сервер), `uploadBrandingFile`* (через WS-14), `getPublicBranding`*.
- Backend: `control/branding` (версии неизменяемы).
- Тесты-первыми: 02 #48–64 fixme; Go: контраст < 4.5 → `accent_used` ≥ 4.5; SVG с `<script>` → 422; isolation BR-T1 (PUT в чужой тенант → 404), BR-T2 (аккаунт в двух тенантах — Анна Морозова); e2e Лотос `#7A3E79`, «Лотос», «сеанс».

**WS-23 platform-tenants** — L.
- Экраны: `tenants`, `usage`, `accounts` (включая `platformOrgVM` «Ортус · Платформа», поповер «Организации аккаунта», «Карточка аккаунта»); `opConfirm` с секцией «Последствия».
- Входы: 04 §4 (оболочка оператора); §5.1 (opVM 3523–3559); §5.2 (usageVM 3736–3790); §5.4 (accountsVM 3604–3664, platformOrgVM 3792–3836); 04 §8 #1–20, #26–38 (ожидания «59 из 70», «141,4 из 275 ГБ», «34 из 57» — снять с эталона при фиксации, Q15); 04 §9 Q1–Q5, Q9–Q11, Q14; 10 §7.3 operator; 09 DP-07, DP-11.
- Операции: `listPlatformTenants`, `getPlatformTenant`, `updatePlatformTenant` (status + `reason`), `getPlatformSubscription`, `updatePlatformSubscription` (extendTrial, квота), `listPlatformUsers`, `lockAccount`*/`resetMfa`*, `listOperators`*/`inviteOperator`*/`updateOperator`*, `getPlatformUsage`* (снимок `tenant_usage_daily`), `listPlatformAudit`*.
- Backend: `control/{tenants,accounts,operators,usage}`, `platform_audit`; миграция control `0004_usage`.
- Тесты-первыми: 04 #1–20, #26–38 fixme; Go: «≥ 2 активных владельца» (канон строже прототипа — DP-07); оператор не получает бизнес-данных (`operatorOnly`); isolation: ключи `platform.*` по ролям оператора (04 Q9).

**WS-24 platform-pricing** — M.
- Экраны: `plans`, `requests`.
- Входы: 04 §5.3 (requestsVM 3571–3602); §5.5 (plansVM 3839–3899: черновик, 9 правил валидации, запланированная версия); 04 §8 #21–25, #39–46; 04 Q6–Q8, Q12; 02 §7.3 (пара к `requestSeats`); 09 §6 (EXCLUDE версий сетки).
- Операции: `listPriceBookVersions`*, `publishPriceBookVersion`*, `cancelScheduledPriceBookVersion`*, `listSubscriptionRequests`*, `decideSubscriptionRequest`* (котировка фиксируется на момент заявки — 04 Q6).
- Backend: `control/{pricebook,requests}`.
- Тесты-первыми: 04 #21–25, #39–46 fixme; unit `validateDraft` (9 правил) и `calc`; Go: пересечение версий → 409; одна открытая заявка на организацию.

**WS-26 provisioning** — L, 2 ревьюера; backend-only (в прототипе нет UI создания организации — 04 Q1, PD-37).
- Входы: S1-01, S1-03, S1-04; 10 §3; 09 §10 п.3, п.12 (саги между control и tenant DB); DP-14.
- Операции: `createPlatformTenant`; миграционный контроллер (`canary → партии → остальные`, `tenant_routing.schema_version`); `make migrate` по всем тенантам; `cmd/provisioner`.
- Тесты-первыми: интеграция «создать тенант → БД и sentinel существуют → миграции применены → `GET /me/context` в новой БД»; отказ canary останавливает партию; AC-02 (сессия A с `tenantId` B не открывает пул B).

**WS-30 logistics-manager** — L, 2 ревьюера (начисления).
- Экраны: `fleet`, `pool`, `review`; закрывает e2e модалки `request` («Запросить водителя») и `confirm` «Принять смену …?».
- Входы: 03 §5 (fleetVM 3240–3298); §6 (poolVM 3300–3319); §7 (reviewVM 3321–3373, `REV_STEPS`); 03 §14 #1–17, #41–47; 03 §15 Q1, Q5, Q7, Q13, Q16–17; 10 §7.3 `fleet/pool/review`; 10 §11 п.4–6; 09 §7.1 (`trip_reviews`); 08 J4–J6.
- Операции: `listVehicles`, `createVehicle`, `listRoutes`, `createRoute` (участки `legs`), `listTrips`, `getTrip`, `assignVehicle`*, `reviewTrip` (+ `rework`, `steps`*), `reviewTripExpense`, `getTripEarnings`/`setTripEarnings` (отдельный маршрут, AC-05), `reviewInspection` + решение по дефекту*, `listAvailableDrivers`, `requestDriverTransfer`, `listDriverTransfers`, `decideDriverTransfer`.
- Backend: `modules/fleet/{review,pool,routes}` — отдельные пакеты поверх `fleet/api.go` из WS-31; `finance.earnings`; миграция tenant `0010_fleet_review`.
- Тесты-первыми: 03 #1–17, #41–47 fixme; isolation AC-05 по каналам HTTP/Data Hub/экспорт/уведомления; AC-06 (временный водитель видит только согласованный рейс; после срока — 404); AC-10; «Конфликт: …» + автообновление.

**WS-31 logistics-driver** — L, 2 ревьюера (конкурентность/миграции).
- Экраны: `today`, `cars`; модалка `confirm` «Завершить рейс …?»; слоты фото; очередь `outbox` в памяти (как нарисовано — 03 §10, 07 §16 п.9); флаги `online/conflictNext/failUploadNext`.
- Входы: 03 §8 (driverVM 3413–3521, photoVM 3375–3392); §9 (`cars` 3517–3519); §10 (фото/офлайн); 03 §14 #18–40, #48; 03 §15 Q2–Q4, Q6, Q9–Q12, Q14; 03 §16 п.4–п.10; 08 J2–J3; 10 §7.1 (`submitDeparture` = checklist → inspection → startTrip); 09 §6 (EXCLUDE брони, активные рейсы).
- Операции: `listVehicles` (совместимость — `compat` на сервере и клиенте), `reserveVehicle` (hold, AC-03), `releaseReservation`, `getInspectionChecklist`, `submitInspection` (5 фото `ready`, дефекты), `startTrip` (атомарно потребляет бронь, S2-06), `createTripExpense` (idem), `finishRoute`* (`returning`), `returnTrip`, `listTripExpenses`; загрузка через WS-14.
- Backend: `modules/fleet` (vehicles read, reservations, checklists, inspections, defects, trips, expenses) + outbox-событие `fleet.inspection.submitted.v1` (потребитель — WS-57); публикует `fleet/api.go` для WS-30.
- Тесты-первыми: 03 #18–40, #48 fixme; concurrency AC-03 (100 броней → 1×201 + 99×409); AC-04 (4 фото из 5 / блокирующий дефект → 409); unit `photoVM` 5 состояний; e2e офлайн `local → sending → error`, «{label} — принято сервером»; «Конфликт брони» + «Обновить список».

**WS-32 home** — M.
- Экран: `home` (приветствие, «Начало работы», «Требует решения», «Сегодня в работе», «Рейсы сегодня», «Последние события»).
- Входы: 05 §5 (homeVM 4034–4106); 05 §9 #1–11; 05 §10 Q2, Q6–Q7, Q18; 05 §11 п.2, п.19–20; 00 E1 («1 из 3»); 10 §7.3 `home`; G-19.
- Операции: композиция существующих (`getMyContext`, `listTrips`, `listDriverTransfers`, `listAppointments`, `listWorkLogs`, `getTenantSubscription`, `getStorageUsage`, `listMembers`, `listAssignments`, `listTasks`) + `GET /me/notifications`* (заготовка над `notify.inbox`, draft `0009_notify`).
- Тесты-первыми: 05 #1–11 fixme (приветствие — regex по часам; «Начало работы 1 из 3»); unit очереди (9 источников, тон danger → warn → info → neutral, максимум 8, «показано 8 из N»); e2e логист без роли → пустая «Главная».
- Стенд-e2e закрывается интегратором после WS-20/21/30/31 (страница агрегирует все модули — 05 §11 п.2).

**WS-33 forms** — M.
- Экран: `forms` (вкладки «Конструктор / Версии / Ответы», 10 типов полей, «Показывать, если», журнал автоматизации); `confirm` «Опубликовать «{name}» v{N}?».
- Входы: 05 §6 (formsVM 4452–4533; `formFields/editForm/publishForm` 4419–4451); 05 §9 #12–29; 05 §10 Q1 (падение в Лотосе → PD-27), Q9, Q11–Q13, Q15, Q17; 09 §7.1 (forms); 10 §7.2.
- Операции (заготовка): `listForms`, `getForm`, `createForm`, `updateForm`, `listFormVersions`, `createFormVersion`, `publishFormVersion`, `listFormResponses`, `getFormResponse`; http-адаптер `publishForm` = 2 вызова; draft `0003_forms`.
- Тесты-первыми: 05 #12–29 fixme; unit `formFields`/`editForm`/диффы версий («Убрано», `id-vN` при смене типа)/`showIf`; e2e логист — чип «Только просмотр · нет права «Настраивать»».

**WS-34 tasks** — M.
- Экран: `tasks` («Канбан»/«Список», «Все исполнители / Мои задачи», форма новой задачи, `aside[aria-label="Карточка задачи"]`, переходы `TASK_FLOW`, чек-лист, комментарии, связи).
- Входы: 05 §7 (tasksVM 4355–4416); 05 §9 #30–47; 05 §10 Q3–Q5, Q10, Q12, Q16; 05 §11 п.16, п.23; 09 §7.1 (tasks).
- Операции (заготовка): `listTaskProjects`, `listTasks`, `getTask`, `createTask`, `updateTask`, `transitionTask`, `toggleChecklistItem`*, `commentTask`* (G-07); draft `0004_tasks`.
- Тесты-первыми: 05 #30–47 fixme; unit `WORKFLOWS[flow]` (05 §11 п.24 — канбан по процессу проекта, не `TASK_STATUSES`), guard «чек-лист закрыт»; e2e прораб: задачи `leads` без проекта (Q5).

**WS-35 calendar-knowledge** — M.
- Экраны: `calendar`, `knowledge`.
- Входы: 06 §5 (calVM 4109–4149: таймлайн 08–20, перенос, конфликт `role="alert"` + 3 слота); §6 (kbVM 4152–4176: дерево, поиск, приватные страницы, правка с базовой версией); 06 §13 #1–15; 06 §14 Q1–Q3; 06 §15 п.4, п.16; 07 §4 `moveBooking`/`saveKbPage`; 10 §7.2.
- Операции (заготовка; `sched` таблицы уже в 0001): `findCalendarAvailability`, `listCalendarBookings`, `updateCalendarBooking` (If-Match), `listKnowledgePages`, `getKnowledgePage`, `updateKnowledgePage` (412 ↔ прототип `conflict` — маппинг в WS-05); draft `0005_knowledge`.
- Тесты-первыми: 06 #1–15 fixme; unit `bookingConflicts`/`freeSlots` (из WS-04 — потребление); e2e конфликт версии БЗ через `scenario('kb-conflict')` (06 Q1); `therapist@t-lotos` «Мой день»/«Календарь» (G2).

**WS-36 data-files** — M, 2 ревьюера (AC-05 через Data Hub).
- Экраны: `data`, `files`.
- Входы: 06 §7 (dataVM 4179–4208: наборы, фильтр/сортировка `localeCompare ru numeric`, «Выгрузить» по `data.export`, `hiddenNote`); §8 (filesVM 4211–4225); 06 §13 #16–25; 06 Q4, Q12, Q15; S2-16; 10 §12 п.25 (`DatasetQuery` только AND); 08 J11.
- Операции: `listDatasets`, `queryDataset` (реальные, с `scopeQuery` и field policy), `listFiles`* (через WS-14), `getFileDownload`.
- Backend: `modules/data`; draft `0011_data_views`.
- Тесты-первыми: 06 #16–25 fixme; isolation AC-05 на count/фильтр/агрегат; AC-14; роль с `data.view` без `data.export` → «Выгрузить» disabled (роль создаётся через WS-20).

**WS-37 spa-cash** — M.
- Экраны: `spa` («Салон и SPA» / «Мой день», баннер «Учёт материалов не завершён.», завершение процедуры → `done`/`done_pending`, `resolveIssue`); `cash` («Внутренняя касса», проводка с inline-валидацией, `confirm` «Сторнировать K-xxx?», «Предложения из принятых смен»).
- Входы: 06 §9 (spaVM 4228–4250); §10 (cashVM 4253–4274; E6 — диалог закрывается и при ошибке); 06 §13 #26–37 (#34/#35 независимы: 50 000 ₽ / 51 500 ₽); 06 Q5–Q6, Q9, Q11; 09 §7.1 (spa/inventory/cash); 10 §7.2.
- Операции (заготовка): `listAppointments`, `recordAppointmentPerformance`, `completeAppointment` (409 при нехватке), `postInventoryMovement`, `resolveIssue`*, `listCashAccounts`, `listCashOperations`, `postCashOperation` (сторно через `reversesOperationId`); drafts `0006_spa_inventory`, `0007_cash`.
- Тесты-первыми: 06 #26–37 fixme; unit списания материалов «один раз», `sign()` баланса; e2e двойной клик не создаёт две проводки (06 Q6 — `busy`).

**WS-38 repair-object** — M.
- Экран: `repair` — вкладки «Обзор» и «Работы», `ObjectHeader`, `ReadinessBar`, очередь решений (включая пункты из статуса дочернего макета), контейнер дочерних вкладок с контрактом `{tab, onTab, onStatus, onLeads}` (зеркало `dc-import` `:2126`).
- Входы: 06 §11.1–11.4, 11.6; 06 §13 #38–46 (#43 → «52%», E5); 06 Q7–Q9, Q13, Q16; 09 §7.1 (repairs — `works`/`work_logs` нет в черновике); 10 §7.3 `repair`; G-16.
- Операции (заготовка): `listRepairProjects`, `getRepairProject`, `listWorkLogs`, `submitWorkLog` (+ материалы*), `acceptWorkLog`*, `returnWorkLog`*; draft `0008_repairs`.
- Контракты: публикует интерфейс контейнера вкладок для WS-39 в брифе (до кода).
- Тесты-первыми: 06 #38–46 fixme; unit `pc()`, `pendW`, порядок очереди; e2e «ждать чип «сдача … вместо 27.11»» (06 §15 п.15); четыре inline-ошибки формы отметки дословно.

**WS-39 repair-tabs** — L; параллельно с WS-38 по опубликованному контракту.
- Экраны: 9 вкладок дочернего макета «Замер», «Смета», «График» (Гант: 10 этапов, 7 причин, панель этапа, ±день, исполнители), «Документы», «Снабжение», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика» — локальное состояние, без API (06 §11.5, Q10; PD-35).
- Входы: `design/Ремонт и стройка.dc.html:72–461`, `:619–901`; 06 §11.5 (таблица); 00 §5 G4.
- Первый шаг WS (до кода): карта `docs/plan/analysis/13-repair-tabs.md` с дословными подписями и строками — критика §9 п.2.
- Тесты-первыми: `repair-tabs.spec.ts` по карте 13 (fixme); unit `ganttVM` (рабочие дни, `D0 = 05.10.2026`, `TODAY = 15`, критический путь); unit формул замера (`пол = l·w`, `стены = max(0, 2(l+w)h − o)`); снапшот `onStatus`.

### 2.5 Волна 3 — сквозное и стенд

**WS-40 auth-keycloak** — L, 2 ревьюера.
- Выходы: Keycloak-профиль compose (realm `ortus` + `ortus-operators`, импорт при старте — 10 §12 п.22–23); BFF OIDC Code + PKCE (S1-05); принятие приглашения (S1-06); переключатель бизнеса (S1-07); `e2e:full` с IdP (verification §2 фаза 2); dev-провайдер остаётся за build tag.
- Тесты-первыми: 12 §6 #23–25; e2e вход через Keycloak для `owner@t-alta`; 12 Q2 (local-провайдер — PD-41).

**WS-41 journeys-e2e** — M; пишут не авторы экранов (12 §8 п.18).
- Выходы: `e2e/journeys/J01…J18.spec.ts` по 08 §6 (после правок E1–E3); `guide-path.spec.ts` («Путь проверки» 8 шагов + 7 негативных дословно из 01 §6); тег `@smoke` для PR (15-quality: smoke на PR, full nightly). Оба режима.

**WS-42 pwa-offline** — L.
- Выходы: Workbox, установка, персистентный outbox (IndexedDB) вместо памяти, лимиты офлайн-кеша (S2-15, D-09). Сверх «как нарисовано» — поведение прототипа уже доставлено в WS-31; визуальных изменений нет.

**WS-43 ops-quality** — M, «по готовности».
- Выходы: k6-профиль (S0-09, D-08), restore drill, SBOM/подпись образов, Schemathesis nightly (15-quality).

### 2.6 Волна 4 — заготовки S3+ → реализация

«Заготовка S3+» (срезы WS-32…38) — определение, одинаковое для всех:
- (а) операции в `ortus.yaml` финализированы в WS-02 cut-2;
- (б) сгенерированный strict-server с хендлерами, возвращающими `501 not_implemented` (`Problem.code`), и контрактный тест на это;
- (в) миграция в `backend/migrations/tenant/drafts/` (не применяется);
- (г) MSW-хендлеры из примеров;
- (д) `adapter-http` реализован и проверен паритетной сюитой против MSW;
- (е) в `e2e/<page>.spec.ts` стенд-пункты помечены `test.fixme(E2E_MODE === 'stand', 'PD-15: фаза 3')`.

Волна 4 заполняет (б) и (в) и снимает (е):

| WS | модуль | миграции | что закрывает |
|---|---|---|---|
| WS-50 | forms | `0003_forms` | `forms.spec.ts` стенд; AC-09; AC-08 (публичные токены) |
| WS-51 | tasks | `0004_tasks` | `tasks.spec.ts` стенд; чек-лист/комментарии |
| WS-52 | sched + knowledge | `0005_knowledge` | `calendar`, `knowledge` стенд; 412 на устаревшую версию |
| WS-53 | spa + inventory | `0006_spa_inventory` | `spa.spec.ts` стенд; AC-07 (идемпотентность списания) |
| WS-54 | cash | `0007_cash` | `cash.spec.ts` стенд; сторно; «предложения» по `fleet.expense.verified.v1` |
| WS-55 | repairs | `0008_repairs` | `repair.spec.ts` стенд (обзор/работы); вкладки — по PD-35 |
| WS-56 | notify + realtime | `0009_notify` | «Последние события», колокольчик, SSE (G-19), S1-26 |
| WS-57 | автоматизация осмотр → ответ формы → задача | — | потребитель `fleet.inspection.submitted.v1` (07 §16 п.15; 08 §11 п.19); задача «Проверить осмотр …» на стенде |

Каждый WS волны 4 может менять в чужом `e2e/<page>.spec.ts` только маркеры `fixme` (оговаривается в брифе); всё остальное — в своём каталоге модуля.

---

## 3. DAG волн

```text
0a  WS-01 ──┬──────────────────────────────────────────────────────────────────┐
            │                                                                  │
0b  WS-02(cut-1) ─┬─► WS-05 ◄── WS-04        WS-03 ─► WS-06        WS-07 ◄─ WS-02(cut-1)
                  │        │                   │        │             │
1                 │        └─► WS-11 ◄── WS-10 ◄┘        │   WS-13 ◄──┤      WS-12 ◄── WS-03, WS-06
                  │                │                      │   WS-14 ◄── WS-13
    WS-02(cut-2) ─┘ (вливается до старта волны 2)         │
2   mock-половины: WS-20…24, WS-30…39 ◄── WS-11 (все параллельно, 16 агентов)
    стенд-половины: ◄── WS-13 (+WS-14 для 21/22/31/36); WS-30(стенд) ◄── WS-31 fleet/api.go; WS-26 ◄── WS-13
3   WS-40 ◄── WS-13, WS-26 ; WS-41 ◄── все срезы ; WS-42 ◄── WS-31 ; WS-43 ◄── WS-13, WS-26
4   WS-50…57 ◄── WS-13 + соответствующий срез волны 2
```

Что можно запускать одновременно и сколько агентов:

| Волна | Параллельно | Агентов | Примечание |
|---|---|---|---|
| 0a | WS-01 | 1 (+1 ревьюер) | барьер: без workspace/go.mod никто не стартует |
| 0b | WS-02, WS-03, WS-04, WS-07 сразу; WS-05 после WS-04 и cut-1; WS-06 после WS-03 | 4 → 6 | pipeline внутри волны (orchestration §2) |
| 1 | WS-10, WS-12, WS-13 сразу; WS-11 после WS-10 и WS-05; WS-14 после WS-13 (интерфейс authz) | 3 → 5 | WS-02 cut-2 идёт параллельно, тот же агент WS-02 |
| 2 | 16 срезов; mock-половины стартуют по готовности WS-11; стенд-половины — по готовности WS-13/14 | 8–16 | при 8 агентах: пачка A = 20, 21, 23, 30, 31, 36, 38, 39; пачка B = 22, 24, 26, 32, 33, 34, 35, 37 |
| 3 | WS-40, WS-41, WS-42, WS-43 | 4 | WS-41 — только после интеграции всей волны 2 |
| 4 | WS-50…57 | до 8 | независимы попарно, кроме WS-57 (после WS-50, WS-51) |

Критический путь (по размерам): WS-01 (S) → WS-02 cut-1 (L, параллельно с WS-04) → WS-05 (M) → WS-10 (L) → WS-11 (L) → WS-31 (L) → WS-30 стенд (L) → интеграция волны 2 → WS-41 (M) → WS-40 (L). Второй, почти равный путь: WS-07 → WS-13 (L) → WS-14 (L) → стенд-половины 21/22/31/36. Ускорители: WS-10 и WS-11 могут частично перекрываться (WS-11 начинает с чистых функций навигации/гейта и модальных форм на Field/Button, уже опубликованных в бриф WS-10 по `components.md`); WS-02 cut-1 ограничить операциями волн 1–2.

---

## 4. Карта страниц прототипа → WS, e2e-spec, состояния

Для каждой страницы визуальная сверка (`e2e/visual/<key>.visual.spec.ts` + `<key>.labels.spec.ts`, 390 и 1440, `maxDiffPixelRatio: 0.01` — PD-22) и проходка через Playwright MCP (verification §4) — **всегда да**; evidence в `docs/plan/evidence/<key>/`. Обязательные состояния из verification §1.3 (навигация + прямой URL, заголовок/крошка, пусто/загрузка/ошибка/гейт/офлайн, клавиатура, axe, 390/1440) не повторяются ниже — только особые. `data-screen-label` (6 значений, G3) переносятся дословно; остальным 19 секциям присваивается `«{Персонаж} · {подпись меню}»` — фиксируется в брифе WS-11 (PD-42).

| Ключ (`pg.*`) | WS | e2e-spec | Особые состояния для проверки (источник) |
|---|---|---|---|
| `home` | WS-32 | `home.spec.ts` | «Начало работы 1 из 3» (E1); очередь ≤ 8 и «показано 8 из N»; «Рейсы сегодня» только при включённой логистике и `logistics.view`; логист без роли — пусто; `owner@t-lotos` (05 §5, §9 #1–11) |
| `modules` | WS-21 | `modules.spec.ts` | trial-карточка «осталось N дн.»; `restricted` → баннер «Пробный период завершён.» и disabled «Подключить»/«Изменить лимит»; confirm подключить/отключить (`history`); лимит ниже занятого → ack-чекбокс; «Место организации заполнено.»; `roleNote` до/после (E2); Лотос (02 §5, #1–14) |
| `users` | WS-20 | `users.spec.ts` | 4 вкладки; модалки assign/invite/createRole; «мест нет» после приглашения (9 → 10); системная роль нередактируема; «Финансовые разрешения» заблокированы для функции «Водитель»; «Проверка доступа» P-01…P-03; дефолты в Лотосе (02 §6, #15–36; §11) |
| `billing` | WS-21 | `billing.spec.ts` | radiogroup «Тариф»/«Срок оплаты», `calc`; заявка → pending SR; отмена; отзыв приглашения «8 из 10» (#44); `onRevoke` (02 §7, #37–47) |
| `branding` | WS-22 | `branding.spec.ts` | палитра/HEX с автокоррекцией (`#FFD400`); логотип `setInputFiles`; редактор меню (5 пунктов `BR_LOCK` нельзя скрыть); «Что показать» (приложение/форма/письмо); версии; Лотос `#7A3E79` (02 §8, #48–64) |
| `fleet` | WS-30 | `fleet.spec.ts` | гейт «не подключена» / «Нет роли с доступом…»; причины `compat` в подборе; «Конфликт: …» + автообновление; колонки ≈ 950 px (03 §5, #1–13) |
| `pool` | WS-30 | `pool.spec.ts` | модалка «Запросить водителя»; «Демо: одобрить/отклонить» (G5 → PD-23) (03 §6, #14–17) |
| `review` | WS-30 | `review.spec.ts` | очередь `defect_review → submitted → rework → accepted`; «Принять смену …?»; начисление только с `canEarnings`; возврат по разделам `REV_STEPS` (03 §7, #41–47) |
| `today` | WS-31 | `today.spec.ts` | 9 состояний рейса; 5 состояний слота фото; «Осталось: …»; `odoError`; «Сумма должна быть больше нуля»; офлайн `local/sending/error`; «Конфликт брони» + «Обновить список»; сбой загрузки; «Завершить рейс …?»; без рейса (03 Q11) (03 §8, §10, #18–40) |
| `cars` | WS-31 | `cars.spec.ts` | `group[aria-label="Фильтр"]` «Все / Подходят к рейсу / Свободны»; `bookLabel`/disabled-причины (03 §9, #48) |
| `tenants` | WS-23 | `tenants.spec.ts` | 4 организации; чипы статуса; «Продлить пробный период на 14 дней» (Q4); квота; приостановить/возобновить через `opConfirm`; аудит 6 строк; «Требуют внимания» пусто — сценарий (04 §5.1, #7–14) |
| `usage` | WS-23 | `usage.spec.ts` | агрегаты (снять с эталона, Q15); таблица 860 px → горизонтальный скролл на 390 (04 §5.2, #15–20) |
| `requests` | WS-24 | `requests.spec.ts` | SR-12 pending → решение; бейдж меню; цена по версии заявки (Q6) (04 §5.3, #21–25) |
| `accounts` | WS-23 | `accounts.spec.ts` | поиск/фильтр; поповер «Организации аккаунта» (клавиатура); «Карточка аккаунта»; блокировка с причиной; сброс MFA; «Ортус · Платформа» (`iAmOwner`, минимум владельцев) (04 §5.4, #26–38) |
| `plans` | WS-24 | `plans.spec.ts` | «Черновик vN · не опубликован»; 9 inline-правил; баннер «Запланирована версия …»; отмена запланированной (04 §5.5, #39–46) |
| `forms` | WS-33 | `forms.spec.ts` | 3 вкладки; порядок полей ↑↓; «Показывать, если»; «Опубликована версия v{N}»; «Не показывался по условию» vs «Не ответил»; журнал «Ответ R-… принят → Задача T-…»; логист read-only; Лотос `forms: []` (05 §6, #12–29; Q1) |
| `tasks` | WS-34 | `tasks.spec.ts` | «Канбан»/«Список»; «Мои задачи»; новая задача «T-170»; карточка; переходы `TASK_FLOW`; guard чек-листа; «⚡ из ответа формы»; «Нет проектов в вашей области»; прораб; Лотос `SPA` (05 §7, #30–47) |
| `calendar` | WS-35 | `calendar.spec.ts` | таймлайн 08–20; панель брони; перенос → `role="alert"` + 3 слота; массажист; `therapist@t-lotos` (G2); утечка «Рейс Р-208» в Лотосе (Q3 → PD-39) (06 §5, #1–9) |
| `knowledge` | WS-35 | `knowledge.spec.ts` | дерево; поиск; приватные страницы владельцу; режим правки; конфликт базовой версии (сценарий); `treeMax` (Q2 → PD-27) (06 §6, #10–15) |
| `data` | WS-36 | `data.spec.ts` | наборы; сортировка `ru numeric`; «Выгрузить» disabled без `data.export`; `hiddenNote`; 560 px скролл (06 §7, #16–22) |
| `files` | WS-36 | `files.spec.ts` | список; утечка «Север Логистик» в Лотосе (Q3) (06 §8, #23–25) |
| `spa` | WS-37 | `spa.spec.ts` | «Салон и SPA» / «Мой день»; баннер «Учёт материалов не завершён.»; `done`/`done_pending`; `resolveIssue`; крошка (Q3) (06 §9, #26–30) |
| `cash` | WS-37 | `cash.spec.ts` | проводка (inline `validation`); «Сторнировать K-xxx?» (E6); балансы 50 000 ₽ / 51 500 ₽ независимо; «Предложения из принятых смен»; Лотос пустой журнал (06 §10, #31–37) |
| `repair` | WS-38 + WS-39 | `repair.spec.ts`, `repair-tabs.spec.ts` | гейт «не подключён» по умолчанию; очередь после `onStatus` («сдача … вместо 27.11»); «Готовность 48% → 52%» (E5); 4 ошибки формы отметки; `canFin` вкладки; 9 дочерних вкладок по карте 13 (06 §11, #38–46; G4) |
| `planned` | WS-11 | `planned.spec.ts` | только прямой URL `/plan/:id`; тексты `ROADMAP` 9 ключей, колонки «Экраны / Компоненты / Правила / Контракты API», «Шаг {n}» (01 §15; G1 → PD-24); эталон — через `go()` |

Модалки: `confirm` — закрывается в `modules`, `billing`, `review`, `today`, `forms`, `cash`, `tenants`/`accounts`/`plans`/`requests` (`opConfirm`); `assign`/`invite`/`createRole` — `users.spec.ts` + `home.spec.ts`; `request` — `pool.spec.ts`; `sheet` — `shell.spec.ts` (390, «Ещё» → «Все разделы»).

Оболочка: `shell.spec.ts`, `demo-panel.spec.ts`, `guide.spec.ts` (WS-11) — визуальная сверка на 390/768/1440 для 8 персонажей на стартовых страницах. Сайт документации: `docs-reader`, `docs-search`, `docs-api`, `docs-perm`, `docs-frames` (WS-12) — визуальная сверка с `4173/Документация.dc.html` на 390/800/1280/1440; MCP-проходка по 11 §10. Сквозные сценарии J1–J18 — WS-41 (`e2e/journeys/`), оба режима.

---

## 5. TDD по слоям в угле C; отличия от других углов

### 5.1 Как устроен цикл внутри среза

Каждый WS волны 2 проходит лестницу tdd-protocol §2 целиком, в одном worktree, одним исполнителем:

1. **E2E-скелет** `e2e/<page>.spec.ts` в `fixme`: пункты чек-листа отчёта + обязательные verification §1.3. Спек не знает режима; harness подставляет `E2E_MODE=mock|stand`. Пункты, невозможные на стенде до фазы 3, помечаются условным `fixme` со ссылкой на PD-15 (§2.6 е).
2. **Домен**: чистые функции среза в `packages/domain/src/<module>/` и `backend/internal/domain/<module>` — таблицы из отчёта (например `homeQueue`, `formsDiff`, `validateDraft`, `pc`). Общие правила (`can`, `compat`…) уже зелёные из WS-04 — срез только потребляет.
3. **Контракт**: MSW-хендлеры среза из `api/examples` + httptest на strict-server хендлеры Go (каждая операция: тело, коды, `Problem.code`); для заготовок — тест на `501`.
4. **Интеграция** (стенд-половина): репозитории на testcontainers, миграции среза.
5. **Изоляция/конкурентность**: строки матрицы «актор × объект × 200/403/404» для каждой новой операции; AC среза.
6. **Компоненты** фичи (`features/<domain>/components`) — Testing Library + axe; `@ortus/ui` не трогается.
7. **Экран**: роутер в памяти + MSW: обычное/пусто/загрузка/ошибка/нет права/конфликт/офлайн/только чтение.
8. **E2E mock**: снятие `fixme` по одному; затем `npm run e2e:full -- --grep <page>` — тот же спек на стенде.
9. **Визуальная и структурная сверка** с 4173; MCP-проходка; evidence; отчёт.

Коммиты: `test(ws-NN): …` → `feat(ws-NN): …` → `refactor(ws-NN): …` на каждую единицу; ревьюер проверяет порядок (`REVIEW_SCHEMA.tddOrderOk`).

### 5.2 Что угол C даёт по сравнению с другими углами

Сравнение с «горизонтальным» углом (слои: весь UI → весь backend) и «модульным» (страница = WS, backend-модуль = отдельный WS).

Плюсы:
- Нет «интеграционного хвоста»: контракт для страницы проверяется end-to-end тем же агентом, который написал и экран, и операции; дрейф «mock vs стенд» ловится внутри WS, а не на интеграции волны (verification §2 «один и тот же spec в обоих режимах» выполняется буквально).
- Меньше передач контекста: один бриф содержит инвентарь экрана, операции и инварианты; отчёты 01–06 уже написаны как самостоятельные брифы (00 §10 п.4).
- Меньше WS в волне 2 (16 вместо ~25 страниц + ~10 backend-модулей), меньше ребейзов у интегратора.
- Для S0–S2 (платформа, компания, логистика) стенд-e2e закрывается в той же волне, что и UI, — выход из S1/S2 (AC-01…AC-06, AC-10…AC-12) достигается раньше.

Минусы и риски (честно):
- **Широкий агент.** Исполнителю нужны Go + React + Playwright + SQL; брифы L получаются длинными, контекст тяжёлый. Смягчение: обязательные входы ограничены разделами отчётов; Go-часть опирается на готовый `platform/*` и сгенерированный strict-server; при перегрузе WS-30/31 можно расщепить на «mock-половину» и «стенд-половину» как два последовательных брифа одного WS (тот же агент, SendMessage).
- **Конфликт в `modules/fleet`.** Логистика — единственный модуль с двумя UI-срезами. Решение: WS-31 владеет ядром `fleet/`, WS-30 — подпакетами `fleet/{review,pool,routes}`; стенд-половина WS-30 стартует после публикации `fleet/api.go` (pipeline). Простой WS-30 на это время заполняется его mock-половиной.
- **Заморозка контракта.** Срезы не правят `ortus.yaml`, значит WS-02 должен допроектировать G-01…G-22 заранее; это делает WS-02 размером L и потенциальным узким местом. Смягчение — два среза поставки (cut-1/cut-2); если срез обнаружил пробел контракта — он фиксирует предложение в отчёте («Контракты, которые я изменил»), интегратор вносит правку между волнами; до этого срез работает через MSW-пример.
- **Простой стенд-половин.** Если WS-13/WS-14 задерживаются, у 16 агентов волны 2 есть работа только на mock-половинах; интегратор может принять «mock-complete» как контрольную точку, но WS не закрывается (orchestration §1 «ничего на потом»). `home` (WS-32) закрывает стенд-e2e только после соседей — явно вынесено на интеграцию волны.
- **Заготовки S3+** дают меньше «честного» стенда: для 9 страниц (forms, tasks, calendar, knowledge, spa, cash, repair + files-list, notifications) стенд-e2e остаётся `fixme` до волны 4 — это прямое следствие PD-15, не угла C, но в угле C оно виднее.
- **Общие каталоги**, где возможны конфликты, и как они сняты: `src/app/router` (file-based routing — у каждой страницы свой файл); `src/mocks/handlers` (glob); `packages/texts` (общие тексты у WS-11, тексты фич — в `features/<domain>/texts.ts`); `packages/domain/src/core` (заморожен после волны 0; `src/<module>/` — у среза); миграции (диапазоны номеров зарезервированы: tenant 0003–0011 по §2.4/§2.6, control 0004 — WS-23); `backend/test/isolation` (файл на срез `<module>_test.go`); `e2e/visual/allowlist.md` (правки только через интегратора с причиной — PD-22).
- **Два ревьюера** нужны пяти WS волны 2 (20, 26, 30, 31, 36) — планировать мощность ревью.

### 5.3 Где именно «подхватывает» протокол верификации при добавлении страницы

Хук `Stop` (`tools/verify-pages.js`, WS-06) считает страницу затронутой по `routes/<key>/**` и требует `docs/plan/evidence/<key>/` свежее последнего коммита ветки; `workflow.template.js` после исполнителя запускает независимых проверяющих по `ws.pages` (e2e → визуальная → MCP → axe → вердикт `accept|return`, до 3 итераций), затем ревью, затем интегратор гоняет полный e2e и визуальную сверку волны. Ничего из этого угол C не меняет; он только определяет, что `ws.pages` у среза включает и его модалки, и оба режима.

---

## 6. Открытые вопросы, которые план не решает сам

Предложения по умолчанию — в стиле `decisions.md` (нумерация продолжает PD-22; до решения — поведение прототипа, orchestration §7).

| ID | Вопрос | Предложение по умолчанию | Источник | Блокирует |
|---|---|---|---|---|
| PD-23 | Демо-панель, гид «Путь проверки» и кнопки «Демо: …» в продукте | Только при `VITE_ADAPTER=mock` (dev/e2e сборка); в http-режиме скрыты; визуальная сверка панель скрывает | 01 §5–6; 00 G5; verification §3.1 | WS-11, WS-23/30 |
| PD-24 | Страница `planned` (мёртвый код `plan()`) | Реализовать по `roadmap.js`, доступна только по `/plan/:id`; пункты с бейджем «план» в меню не генерировать | 01 §15, Q1; 00 G1 | WS-11 |
| PD-25 | URL-схема и тенант в адресе (host vs path) | Path: `/t/{tenantId}/{page}`, `/platform/{page}`, параметры страниц в search; хост-схема 2.0 не берётся | 12 Q1; 05 §11 п.21; 10 §2 (`tenantId` не право) | WS-11, WS-06 (`baseURL`), WS-40 |
| PD-26 | Фокус-ловушка, возврат фокуса, skip-link, клик-вне поповеров — в прототипе нет, в `components.md` есть | Реализовать по контракту (a11y); пиксели и подписи не меняются | 01 Q3–Q4; 11 Q6; 08 Q17 | WS-10, WS-11 |
| PD-27 | Ошибки прототипа: `s.w` вместо `W` (`listMax/treeMax`), `formsVM` падает при `forms: []`, дефолты `f-msk-sever/r-manager` в Лотосе, `onRevoke` не закрывает диалог, захардкоженные имена/даты/крошки, несклоняемые строки | Падения и невалидные дефолты исправить (пустое состояние «Форм пока нет» — нужен текст владельца); ширину считать по кадру; имена/даты — из актора и `clock`; склонения повторять дословно до решения | 00 §10 п.5; 05 Q1, Q11; 06 Q2, Q8–Q9; 02 §11 | WS-20, WS-33, WS-35 |
| PD-28 | Модель состояний тенанта: прототип `trial/active/restricted/suspended` vs ТЗ 8 состояний vs OpenAPI 4 | UI-чипы прототипа как канон отображения; `restricted` = `read_only`; `grace` показывать как «Пробный период завершён.»; остальные — без подписи до решения | 04 Q3; 10 Q1–Q2; 09 DP-16; 08 Q2 | WS-21, WS-23, WS-02 |
| PD-29 | Коды ошибок: 18 кодов мока → 36 канонических; `no_scope` 403 в UI vs 404 в API; `seats_exhausted`, `request_pending`, `tier_below_usage` вне реестра; модель заявок на места (`17` vs `requestSubscriptionChange`) | Внести недостающие коды в enum; `no_scope` остаётся локальным результатом `explainAccess`, API отдаёт 404; заявки — модель `17` (заявка → решение оператора) | 07 Q1–Q3; 09 DP-01–02; 10 Q11, Q16 | WS-02, WS-05, WS-21, WS-24 |
| PD-30 | Словарь областей (`region/firm` ↔ `unit/company/branch` ↔ `org_unit/resource_pool`) | SQL `scope_kind` как канон; `region/firm` прототипа — подписи `unit.kind` | 09 DP-05; §7.2 | WS-02, WS-04, WS-20 |
| PD-31 | Начисление создаётся автоматически при приёмке (прототип) или менеджером (LOG-10) | Как в прототипе (при `accept`), но через отдельный `setTripEarnings` внутри транзакции приёмки | 08 Q19; 03 Q13; 10 §7.1 | WS-30 |
| PD-32 | Канон состояний рейса (три словаря) и операции `rework`, `returning`, решение по дефекту, назначение машины менеджером | `TRIP_STATE` прототипа (9 состояний) — канон UI; контракт расширить (WS-02) | 08 Q1, Q9; 10 Q4–Q6; 03 Q5, Q17 | WS-02, WS-30, WS-31 |
| PD-33 | Визуальные baseline на Windows-dev и Linux-CI | Baseline per-platform (`{platform}` в пути); авторитетен Linux-CI; структурная сверка подписей обязательна всегда | 12 Q4, §8 п.19; PD-22 | WS-06 |
| PD-34 | Версия PostgreSQL: compose/testcontainers 17 vs миграции, проверенные на 16.4 | 17; первый прогон миграций на 17 — тест WS-07 | 09 DP-14; 10 Q9; D-04 | WS-07 |
| PD-35 | Дочерние вкладки «Ремонт и стройка» (Гант, документы, снабжение, финансы…) — только UI в WS-39; нужен ли backend в фазе 3 | UI как нарисовано (локальное состояние); backend — после расширения `19-construction.md` | 06 Q10, §11.5; 00 G4; 10 G-16 | WS-39, WS-55 |
| PD-36 | Источник «Последние события» и колокольчика (в контракте нет ленты/realtime) | `notify.inbox` + `GET /me/notifications` (заготовка WS-32); SSE — WS-56 | 10 G-19, Q8; 01 §22 п.11 | WS-32, WS-56 |
| PD-37 | Операторские действия без UI в прототипе: создание организации, поле «причина» при приостановке/продлении | Backend-only (WS-26, WS-23); UI не рисуется до дизайна владельца | 04 Q1–Q2 | WS-23, WS-26 |
| PD-38 | Несоответствия токенов и CRM: рамки `LINE` vs `tone.*.border`, кнопки 36/40 px, радиусы 14/16, счётчик табов neutral | Эталон — CRM (пиксельная сверка с прототипом); `tokens.json` дополнить алиасами, не менять CRM | 11 Q1–Q5; 01 §22 п.9; 00 §7 (01, 11) | WS-03, WS-10 |
| PD-39 | Утечки сида Альты в Лотос (бронь «Рейс Р-208», файлы «Север Логистик», крошка SPA), `fillAccounts` | Исправить сид (отклонение от прототипа) и переснять эталон для Лотоса после правки; зафиксировать `fillAccounts` явно | 06 Q3; 07 Q10, Q16; 04 Q15 | WS-04 |
| PD-40 | Keycloak в `e2e:full`: JVM ~1 ГБ, время старта | Профиль `keycloak` только для `@auth`-тегов и nightly; остальной стенд-e2e через dev-провайдер | 12 Q11; PD-18 | WS-40, WS-06 |
| PD-41 | Local-провайдер входа (телефон + пароль) из 2.0 | Не переносить; dev-провайдер WS-07 закрывает фазу 1 | 12 Q2; D-03 | WS-07, WS-40 |
| PD-42 | `data-screen-label` для 19 секций без него | `«{Персонаж} · {подпись меню}»`, `tenants` → «Оператор · организации» | 00 G3; 04 Q14 | WS-11 |
| PD-43 | Хранение `verify-<page>`-скиллов (если нужны сверх промпта) | Не создавать; проверка — промпт `verifyPrompt` шаблона | 12 Q10 | WS-06 |

Остаются у владельца продукта D-01…D-12 (`16-raid-glossary.md`): без D-05 (размещение/ПДн) и D-08 (профиль пилота) не начинать стенд-половины волны 2 (10 §12 п.20); D-09/D-10/D-12 влияют на WS-31 (категории расходов: в прототипе 2 из 5), WS-20 (совмещение водителя и менеджера), WS-42.

Перед запуском агентов — правки отчётов из 00 §9: E1–E6 (06, 07, 08), #44 и #51 в 02, #43 и независимость #34/#35 в 06, расчёт агрегатов 04, пункты для `therapist@t-lotos` в 06, карта `13-repair-tabs.md` (WS-39 делает её первым шагом).

---

## 7. Запуск волны: аргументы для `workflow.template.js`

Пример для волны 2 (пачка A при 8 агентах); `pages` — ключи страниц и модалок, по которым стартуют независимые проверяющие:

```json
{ "wave": 2, "ws": [
  { "id": "WS-20", "slug": "company-access",        "brief": "docs/plan/ws/WS-20-company-access.md",        "pages": ["users", "modal-assign", "modal-invite", "modal-createRole"], "reviewers": 2 },
  { "id": "WS-21", "slug": "company-subscription",  "brief": "docs/plan/ws/WS-21-company-subscription.md",  "pages": ["modules", "billing"], "reviewers": 1 },
  { "id": "WS-23", "slug": "platform-tenants",      "brief": "docs/plan/ws/WS-23-platform-tenants.md",      "pages": ["tenants", "usage", "accounts"], "reviewers": 1 },
  { "id": "WS-30", "slug": "logistics-manager",     "brief": "docs/plan/ws/WS-30-logistics-manager.md",     "pages": ["fleet", "pool", "review", "modal-request"], "reviewers": 2 },
  { "id": "WS-31", "slug": "logistics-driver",      "brief": "docs/plan/ws/WS-31-logistics-driver.md",      "pages": ["today", "cars"], "reviewers": 2 },
  { "id": "WS-36", "slug": "data-files",            "brief": "docs/plan/ws/WS-36-data-files.md",            "pages": ["data", "files"], "reviewers": 2 },
  { "id": "WS-38", "slug": "repair-object",         "brief": "docs/plan/ws/WS-38-repair-object.md",         "pages": ["repair"], "reviewers": 1 },
  { "id": "WS-39", "slug": "repair-tabs",           "brief": "docs/plan/ws/WS-39-repair-tabs.md",           "pages": ["repair-tabs"], "reviewers": 1 }
] }
```

Проверяющий страницы получает ключ и сам выполняет verification §1–§4 в обоих режимах (`npm run e2e -- --grep <key>` и `npm run e2e:full -- --grep <key>`); для заготовок S3+ стенд-пункты в `fixme` считаются пройденными только при ссылке на PD-15 в спеке. Порт исполнителя — `5173 + N` по номеру WS (12 §8 п.6), интегратор — 5173.

Бриф каждого WS (`docs/plan/ws/WS-NN-<slug>.md`) собирается из карточки §2 + разделов «Инвентарь», «Инварианты», «Чек-лист приёмки», «Открытые вопросы» своих отчётов + списка операций из 10 §7.3 + правил §5.2 о границах каталогов.
