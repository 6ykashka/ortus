# 12. Предыдущий проект (2.0) и установленные скиллы: что переиспользуем, что конфликтует

Рабочая карта для агентов плана. Домен: повторно используемые артефакты проекта `D:\work\test26042026_Kirill_2.0` (Go API + Next.js, тот же CRM, 449 коммитов, 7 волн на нескольких агентах) и ограничения, которые накладывают 17 скиллов в `D:\work\test26042026_Kirill_3.0\.claude\skills\`. Проект 2.0 — **только чтение**; ничего из него не копируется «как есть» без решения в плане.

Соглашение о ссылках в этом файле:

| Префикс | Путь |
|---|---|
| `2.0/…` | `D:\work\test26042026_Kirill_2.0\…` |
| `skills/…` | `D:\work\test26042026_Kirill_3.0\.claude\skills\…` |
| `design/…` | `D:\work\test26042026_Kirill_3.0\design\…` (снимок проекта Claude Design) |
| `plan/…` | `D:\work\test26042026_Kirill_3.0\docs\plan\…` |

---

## 1. Источники

| Файл | Строки | Что взято |
|---|---|---|
| `2.0/CLAUDE.md` | 1–262 | таблица стека, команды, «Things that will bite you» (84–201), конвенции, правило «документация в том же коммите» |
| `2.0/apps/api/CLAUDE.md` | 1–330, 678–777, 1173–1279 | layout, CQRS, конвенции Go, конфигурация, линт, эндпоинты; сессии и `local`; конвейер и middleware |
| `2.0/apps/web/CLAUDE.md` | 1–57, 700–1099 | layout, три поверхности, конвенции, «Tests» (1000–1038), «Not set up yet» (1040–1081) |
| `2.0/package.json`, `2.0/apps/web/package.json` | 1–71; 1–52 | скрипты и версии |
| `2.0/compose.yaml` | 1–175 | postgres, postgres-test (profile `test`), keycloak/minio/pgbouncer (profile `platform`) |
| `2.0/.mcp.json`, `2.0/.claude/settings.json`, `2.0/.claude/settings.local.json` | все | Playwright MCP, PostToolUse-хук форматирования, включение MCP |
| `2.0/apps/web/playwright.config.ts` | 1–107 | `PORT` из окружения, пять проектов по хостам, `webServer` |
| `2.0/apps/web/e2e/fixtures.ts`, `contracts.ts`, `login.spec.ts`, `org.spec.ts` | 1–1246; 1–70; 1–191; 1–80 | стаб `**/api/v1/**`, порядок маршрутов, фикстуры из `docs/contracts/*.json` |
| `2.0/apps/api/e2e/harness/harness.go`, `e2e_test.go`, `login_test.go` | 1–182; 1–287; 1–196 | Go e2e: `//go:build e2e`, `TestMain`, `Host`-адресация, cookie jar без редиректов, свойства входа |
| `2.0/apps/api/internal/server/middleware/middleware.go` | 1–300 | `RequestID`, `Logging` + `AddAttrs`, `CSRF` double-submit |
| `2.0/apps/api/internal/server/auth/steps.go` | 13–104 | шаги 2–3 конвейера, 302/401 по `Accept` |
| `2.0/apps/api/internal/server/wire/contracts.go` | 17–47 | `Contract()` читает `docs/contracts` через `runtime.Caller` |
| `2.0/apps/web/src/api/client.ts` | 1–90 | `ApiError{status,code,field}`, `NetworkError`, «нет base URL» |
| `2.0/apps/api/.golangci.yml`, `Makefile`, `go.mod` | 1–107; 1–56; 1–15 | линтеры v2, depguard allow-list, цели make, зависимости |
| `2.0/.prettierrc.json`, `.editorconfig`, `.gitattributes`, `.prettierignore`, `.gitignore`, `.husky/pre-commit`, `apps/web/.lintstagedrc.json`, `apps/web/eslint.config.mjs`, `apps/web/vitest.config.mts`, `apps/web/next.config.ts` | все | формат/линт/хуки |
| `2.0/.env.example`, `2.0/apps/api/.env.example`, `2.0/apps/web/.env.example` | все | переменные окружения |
| `2.0/docs/platform-spec.md` | 422–465, 539–563 | таблица конвейера §6, тест изоляции §7.5 |
| `2.0/docs/platform-plan.md` | 444–669 | параллельное выполнение §6 (F, W1–W12, I1–I3, правила 6.5, шаблон брифа 6.6), риски, проверки |
| `2.0/docs/module-rules.md` | 1–355 | правила модуля, протокол волны §6, «сдано дважды» §7, DoD §9, «чего не делать» §10 |
| `2.0/docs/ws/README.md` | 1–297 | семь волн, их раскладка, итоги, общие правила |
| `2.0/docs/ws/W5.md`, `fleet-f5.md`, `structure-s0.md`, `scope-launch.md`, `verify-structure.SKILL.md` | 1–63; 1–78; 1–140; 1–143; 1–120 | форматы брифов, промпты запуска, черновик verify-скилла |
| `2.0/docs/adr/README.md` + 35 файлов `A1…D23` | 1–47; 1–12 каждого | реестр решений |
| `2.0/docs/contracts/README.md` | 1–414 | протокол golden-контрактов |
| `2.0/README.md` | 377–430, 551–561 | «Проверки одной командой», junction для скиллов, «Качество кода» |
| `skills/*/SKILL.md` (17 файлов) + `golang-lint/assets/.golangci.yml`, `golang-project-layout/references/directory-layouts.md`, `golang-database/references/testing.md`, `golang-testing/references/integration-testing.md`, `golang-security/references/cookies.md`, `requesting-code-review/code-reviewer.md`, `vercel-react-best-practices/rules/_sections.md`, `heroui-react/scripts/get_theme.mjs` | все | правила скиллов |
| `design/docs/14-engineering.md`, `15-quality-security.md`, `16-raid-glossary.md`, `12-errors-and-events.md`, `13-backlog-s0-s2.md`, `README.md`, `v0.1/02-architecture.md`, `v0.1/05-technology-review.md`, `design-system/components.md`, `design-system/tokens.css`, `repo-skeleton/*` | все / выборочно | целевой стек и структура, пирамида тестов, решения D-01…D-12, формат ошибок |
| `design/README.md` | 1–189 | README прототипа, токены, «Почему не React + TypeScript-проект» |
| `plan/orchestration.md`, `plan/tdd-protocol.md`, `plan/verification-protocol.md` | все | уже принятые протоколы 3.0 (ссылаются на этот файл) |
| `2.0/git log` | — | 449 коммитов, ветки `main`, `platform`, ~30 `worktree-agent-*` |

---

## 2. Сводка

- 2.0 — монорепо npm workspaces `apps/api` (Go 1.25 по `go.mod`, `net/http` stdlib, `log/slog`, pgx v5) + `apps/web` (Next.js 16.3.4 App Router, React 19.2.8, Tailwind v4, Vitest 5, Playwright 1.62) + `compose.yaml` (PostgreSQL 17-alpine, профили `test` и `platform`) — `2.0/CLAUDE.md:10–22`, `2.0/apps/api/go.mod:1–15`, `2.0/apps/web/package.json:21–51`.
- Там же уже решены и проверены кодом: сессия в HttpOnly-cookie вместо JWT (`golang-jwt` «leaving», `2.0/apps/api/CLAUDE.md:162`), конвейер из 7 шагов с одинаковым 404 (`2.0/docs/platform-spec.md:428–436`), модуль-как-библиотека с `depguard` allow-list (`2.0/apps/api/.golangci.yml:53–93`), golden-контракты `docs/contracts/*.json`, читаемые обеими сторонами (`2.0/docs/contracts/README.md:1–12`).
- Прямо переносимы: `.mcp.json` с пиновым `@playwright/mcp` и `npm run mcp:install`; каркас `playwright.config.ts` (`PORT` из окружения, `reuseExistingServer`, `open: "never"`); Go e2e-харнесс (`//go:build e2e`, `TestMain`, `Host`-заголовок, cookie jar без редиректов); `compose.yaml` целиком (с заменой имён); форматирование (Prettier 100 колонок, `.gitattributes eol=lf`, lint-staged в двух конфигах, husky); `.golangci.yml` v2; middleware `RequestID → Logging → CSRF`; свойства входа как e2e-утверждения; PostToolUse-хук на PowerShell.
- Протокол волн (S0 → потоки → интегратор), карта владения файлами, «e2e пишет не автор экрана», два коммита `test(...)` → `feat(...)`, порт на фронтовый поток, префикс Go-тестов — отработан на 7 волнах и записан в `2.0/docs/module-rules.md:193–224`; 3.0 `plan/orchestration.md` уже повторяет его структуру.
- Главные конфликты со стеком `design/docs/14-engineering.md:5–22`: Next.js ↔ Vite + TanStack Router; stdlib `ServeMux` ↔ chi + `oapi-codegen` strict server; рукописные JSON-контракты ↔ OpenAPI 3.1 как единственный источник + codegen drift; конверт `{error:{code,message,field}}` ↔ RFC 9457 `application/problem+json` с `violations[]`; `local` вход по телефону ↔ только Keycloak OIDC (D-03); организация в хосте `{org}.platform.localhost` ↔ `tenantId` в контексте без правила о хосте; собственный раннер миграций ↔ goose + controller (D-06); compose `postgres-test` ↔ testcontainers-go; `toHaveScreenshot` запрещён ↔ `plan/verification-protocol.md:39–48` требует пиксельную сверку.
- Скиллы Go (samber/cc-skills-golang) накладывают: golangci-lint v2 как источник правды (`skills/golang-lint/SKILL.md:47`), `%w`-обёртки и правило «логировать ИЛИ возвращать», `ctx` первым аргументом, маленькие интерфейсы у потребителя, функциональные опции, «избегать `init()`», табличные тесты с `t.Parallel()`, build-теги для интеграции, `gosec`/`govulncheck`, Conventional Commits.
- Четыре конфликта «скилл ↔ проект» требуют явного решения в плане: `golang-swagger` (OpenAPI из кода) против contract-first; `heroui-react` (Tailwind v4 + React Aria + oklch) против собственного `@ortus/ui` на токенах `--ox-*` (hex, Golos Text); `golang-design-patterns` «avoid init()» против саморегистрации подкоманд/роутов из 2.0; `golang-structs-interfaces` «не создавать интерфейсы заранее» против «интерфейсы и фейки в S0 до реализации», на чём держится параллельность.
- `vercel-react-best-practices` на 70 правил написан под Next.js: категории `server-*`, `bundle-dynamic-imports` (`next/dynamic`), `rendering-hydration-*` неприменимы в Vite SPA; план должен объявить применимое подмножество.
- Ассет `skills/golang-lint/assets/.golangci.yml` **выключает `depguard`** (`:83`) — а изоляция модулей 2.0 держится именно на нём; при заимствовании ассета правило `depguard` для `modules/**` возвращается явно.
- В 3.0 ещё нет `.mcp.json`, `.claude/settings.json`, `package.json`, `compose` — только `.claude/skills`, `design/`, `docs/plan`, `tools/` и `skills-lock.json` (17 записей, без `verify-*`).
- Скиллы в 2.0 лежат в `.agents/skills/` и отражаются junction'ами в `.claude/skills/` (в `.gitignore`); в 3.0 скиллы лежат прямо в `.claude/skills/` — решить, как хранить `verify-<page>` скиллы в git.
- Уроки, которые стоили 2.0 дней: PowerShell 5.1 (`&&` не работает, BOM в файле коммита, `$OutputEncoding` ASCII, `HTTP_PROXY` ловит `curl.exe`), `typecheck ⊥ e2e`, `rounded-full` = `calc(infinity*1px)`, `max-[1024px]` эксклюзивен, даты-литералы в тестах, два рендера под два порога, `-race` без cgo, `npm install` в каждом worktree, `.mcp.json`/`settings.json` читаются только на старте.
- Семь волн дали: vitest 133 файла / 1305 тестов, `e2e:web` 217 тестов, 18-шаговый проход `/verify-structure`, 15 расхождений в первом круге — 8 дефектов продукта, 6 ошибок текста скилла, 1 проблема стенда (`2.0/docs/ws/README.md:188–204`).

---

## 3. Проект 2.0: что это и что из него берём

### 3.1. Карта репозитория 2.0

| Что | Где | Факт |
|---|---|---|
| Монорепо | `2.0/package.json:6–8` | `"workspaces": ["apps/*"]`, `engines.node >= 22`, `.nvmrc` = `22` |
| Go-модуль | `2.0/apps/api/go.mod:1–3` | `module github.com/6ykashka/crm_2/apps/api`, `go 1.25.0` (⚠ `2.0/CLAUDE.md:12` пишет «Go 1.26» — расхождение) |
| Go-зависимости | `2.0/apps/api/go.mod:5–15` | `pgx/v5 v5.10.0`, `x/crypto`, `go-oidc/v3 v3.21.0`, `oauth2`, `minio-go/v7 v7.3.0`, `golang-lru/v2`, `coder/websocket`, `prometheus/client_golang`, `golang-jwt/v5` (уходит) |
| Структура API | `2.0/apps/api/CLAUDE.md:10–79` | `cmd/{api,orgctl}`, `internal/{app,config,controlplane(+cptest),identity/{session,local,oidc,none,ldap,membersync,invitecode},tenant(+tenanttest),authz(+authztest),module(+moduletest),pipeline,registry,migrate,workflow,events,realtime,dataio,audit,homepage,server/{auth,core,me,admin,dataio,workflow,middleware,wire}}`, `modules/{example,repair,datastore,fleet,structure}`, `migrations/{controlplane,core}`, `e2e/{harness,conformance}` |
| Структура web | `2.0/apps/web/CLAUDE.md:17–57` | `src/app/(platform|admin|org)`, `src/components`, `src/api` (клиент по функции на эндпоинт), `src/modules/{datastore,fleet,structure}` + реестр `index.ts`, `src/lib`, `src/store`, `src/proxy.ts`, `src/test`, `e2e/` |
| Скрипты корня | `2.0/package.json:12–52` | `dev`, `dev:web`, `dev:api` (`go -C apps/api run ./cmd/api`), `lint`, `lint:api` (`go vet` + `golangci-lint`), `typecheck`, `format`, `test`, `test:api`, `test:web`, `test:race`, `test:e2e` (Go, стартует `postgres-test`), `e2e:web`, `e2e:web:install`, `mcp:install`, `db:up/down/reset/psql`, `db:test:up/down`, `platform:up/down/logs`, `tidy`, `clean`, `prepare: husky` |
| Коммиты | `git log` | 449; ветки `main`, `platform`, ~30 `worktree-agent-*`; форма `test(groups-f3): failing e2e for …` → `fix(groups): …`, `docs(claude): …`, `chore(claude): /verify-admin …` |
| CI | — | **нет** (`.github` отсутствует; `2.0/CLAUDE.md:119–122` «run the race detector in CI on Linux» — намерение без конфигурации) |

### 3.2. Прямо переиспользуемые артефакты

| # | Артефакт | Источник | Что брать | Что менять под 3.0 |
|---|---|---|---|---|
| R1 | **Playwright MCP** | `2.0/.mcp.json:1–16`; `2.0/package.json:38,54`; `2.0/.claude/settings.local.json` | `"command": "node", "args": ["node_modules/@playwright/mcp/cli.js", "--browser", "chromium", "--headless", "--output-dir", ".playwright-mcp"]`; devDependency `"@playwright/mcp": "0.0.78"` (пин, не `@latest`); `"mcp:install": "node node_modules/@playwright/mcp/cli.js install-browser chrome-for-testing"`; `settings.local.json`: `"enabledMcpjsonServers": ["playwright"], "enableAllProjectMcpServers": true`; `.playwright-mcp/` в `.gitignore` (`2.0/.gitignore` последняя секция) | Положить в корень 3.0; `plan/verification-protocol.md:53` уже на это ссылается. Версию `0.0.78` перепроверить на совместимость с текущим `@playwright/test`. Снять `--headless` для наблюдения (`2.0/CLAUDE.md:118`) |
| R2 | **Playwright config** | `2.0/apps/web/playwright.config.ts:16–106` | `const PORT = Number(process.env.PORT ?? 3000)`; `READY_URL = http://127.0.0.1:${PORT}` (Node не резолвит `.localhost`); `fullyParallel: true`, `forbidOnly: !!CI`, `retries: CI ? 2 : 0`, `workers: CI ? 1 : undefined`, `timeout: 30_000`, `expect.timeout: 5_000`, `reporter: [["list"], ["html", { open: "never" }]]` (иначе зависает неинтерактивный запуск, `:43–44`), `use: { testIdAttribute: "data-testid", trace: "on-first-retry", screenshot: "only-on-failure", video: "off" }`, `webServer: { command: "npm run dev", url: READY_URL, reuseExistingServer: !CI, timeout: 180_000 }` | Проекты заменить на `mobile-390` (Pixel 7 / 390×844, touch), `tablet-768`, `desktop-1440` по `plan/tdd-protocol.md:55`; `baseURL` = `http://localhost:${PORT}` (Vite 5173) вместо `1.platform.localhost`; команда `webServer` — `npm run dev:web -- --mode e2e` (`plan/verification-protocol.md:35`) |
| R3 | **Стаб API в браузерной сюите** | `2.0/apps/web/e2e/fixtures.ts:350–421, 1214–1246`; `contracts.ts:1–70` | Идея: один `stubApi(page, {...})`, каждое поле — ответ эндпоинта, по умолчанию — фикстура контракта; **порядок `page.route` обратный** — Playwright пробует последний зарегистрированный первым, поэтому catch-all `**/api/v1/**` первым, специфичные поверх, `routes` теста последними (`:351–356`); `endpoint(path)` — RegExp с якорем `(?:\?.*)?$`, чтобы `/core/members` не проглатывал `/core/members/bulk` (`:1218–1228`); `context: null` = 401 = «не вошёл» (`:300–301`) | В 3.0 сеть мокается MSW по OpenAPI (`plan/tdd-protocol.md:48`), прямой `page.route` — только для негативных сценариев; принцип «один стаб, профили персонажей (`admin`/`employee`/`empty`, `:694–715`)» переносится как `VITE_ADAPTER=mock` + персонаж демо-панели |
| R4 | **Go e2e-харнесс** | `2.0/apps/api/e2e/e2e_test.go:1–140, 242–286`; `harness/harness.go:28–181` | `//go:build e2e`; `TestMain` → `run()` (чтобы `defer` сработал); DSN по умолчанию `postgres://crm:crm@127.0.0.1:5433/crm_test?sslmode=disable` с `//nolint:gosec // …`; `E2E_BASE_URL` переключает на внешний инстанс; `applyMigrations` гонит `*.up.sql` лексикографически; `Platform{Store, URL, ControlPlane}`; `Host(org) = "%d.platform.localhost"`; `Request(ctx, method, org, path, body)` ставит `req.Host`; `Client()` = cookie jar + `CheckRedirect: ErrUseLastResponse`; `NotFoundBody(t)` читает контракт; харнесс **падает, а не skip**, без БД (`:57–59`) | Теги по `plan/tdd-protocol.md:40`: `integration`, `isolation`, `concurrency` вместо `e2e`; каталоги `backend/test/{isolation,concurrency,contract}` (`design/docs/14-engineering.md:41`); адресация тенанта — по решению §3.3 п. 6 |
| R5 | **Свойства входа как тесты** | `2.0/apps/api/e2e/login_test.go:13–195`; `2.0/apps/api/CLAUDE.md:170–174, 692–734` | «login never creates a user» (`countUsers` до/после), «wrong password ≡ unknown phone» (статус, `code`, `message` равны), decoy-argon2 для неизвестного номера (тайминг), неудачный вход не ставит cookie и не отдаёт `"token"`, тело без пароля, `uniquePhone(t)` вместо truncate таблиц → параллельность; `Lockout` считает и по телефону, и по адресу, неизвестный номер в счётчике наравне с известным (`:704–709`); сброс пароля отвечает одинаково для известного/неизвестного номера (`:710–713`) | При OIDC-only входе (D-03) переносятся: «одинаковый отказ на любую причину» (`steps.go:19–23`), cookie `HttpOnly, SameSite=Lax, Path=/`, `Secure` из конфигурации (`2.0/apps/api/CLAUDE.md:728–731`), 302 для браузера / 401 для API **по `Accept`, не по пути** (`:752–754`), санитизация `next` (`:1232–1235`) |
| R6 | **Middleware** | `2.0/apps/api/internal/server/middleware/middleware.go:36–98, 100–204, 206–299` | `RequestID` (`X-Request-Id`, валидация `[A-Za-z0-9._:-]{1,128}`, fallback на часы); `CSRF` double-submit: cookie `platform_csrf` **не** HttpOnly + заголовок `X-CSRF-Token`, `subtle.ConstantTimeCompare`, отказ 403 `{"error":{"code":"forbidden","message":"Повторите действие: истёк защитный токен"}}`, генератор отдельный от request-id (fail closed); `Logging` с `AddAttrs(ctx, …)` — слот, куда конвейер дописывает `org_id`/`identity_id` (`:217–236`); `statusRecorder.Unwrap()` для `http.NewResponseController` (`:278–299`); порядок `RequestID → Logging → CSRF → mux` | Имена cookie/заголовка привести к `design/docs/repo-skeleton/.env.example:29` (`SESSION_COOKIE_NAME=ortus_sid`) и OpenAPI (`X-CSRF-Token` + проверка `Origin`, `design/docs/v0.1/ortus-openapi-v0.1.yaml:10`); тело отказа — RFC 9457 `csrf_failed` / `origin_not_allowed` (`design/docs/12-errors-and-events.md:40`). ⚠ В 2.0 композиция так и **не была собрана** в сервисе (`2.0/apps/api/CLAUDE.md:1257–1262`) — в 3.0 это тест на старте |
| R7 | **Конвейер запроса** | `2.0/docs/platform-spec.md:428–436`; `2.0/apps/api/CLAUDE.md:1177–1231` | 7 шагов: хост→`org_id` (404) → сессия (302/401) → членство (404, **до** жизненного цикла, ADR A3) → статус организации (`suspended` 403, `archived` 404) → entitlement модуля (404) → право (403; первое место, где открыта БД организации) → обработчик; `Chain.Mount` ставит маркер, тест обходит `ServeMux` и ловит роут мимо цепочки; все 404 — `notFoundBody`, закодированный один раз, **с `\n`** (нашли байт разницы, `:1196–1204`); `DB()` отдаёт только `InTx` — под pgbouncer `SET LOCAL ROLE`/`search_path` живут одну транзакцию (`:1215–1225`); `isBareIdentifier` на id модуля перед `SET LOCAL` | Совпадает с `design/docs/v0.1/02-architecture.md:48–50` (TenantContext после сессии/membership/состояния). Добавить шаги `2a` обслуживание (503) и `2b` оператор (404) из `2.0/docs/platform-spec.md:440–453` |
| R8 | **compose** | `2.0/compose.yaml:4–60, 67–170` | `postgres:17-alpine`, порт **только на loopback** `127.0.0.1:${POSTGRES_PORT:-5432}:5432`, `POSTGRES_INITDB_ARGS: --encoding=UTF8`, healthcheck `pg_isready`; `postgres-test` под `profiles: [test]` на `5433`, `tmpfs: /var/lib/postgresql/data`, `fsync=off full_page_writes=off synchronous_commit=off`; `keycloak:26.0 start-dev --import-realm` с healthcheck через `/dev/tcp` (в образе нет curl); `minio` + одноразовый `minio-init` **вне** `--wait` (compose считает завершившийся контейнер провалом, `:119–125`); `pgbouncer` transaction pooling | Переименовать `crm2`→`ortus`; добавить `mailpit` и `otel-collector` из `design/docs/repo-skeleton/docker-compose.yml:36–42`; закрепить образы по digest (D-04) — там `:latest`, что 2.0 сознательно не делал |
| R9 | **Формат и линт JS** | `2.0/.prettierrc.json`; `.editorconfig`; `.gitattributes`; `.prettierignore`; `.husky/pre-commit`; `package.json:63–70`; `apps/web/.lintstagedrc.json`; `apps/web/eslint.config.mjs:1–55` | Prettier `printWidth 100`, `trailingComma all`, `endOfLine lf`, `prettier-plugin-tailwindcss` с `tailwindStylesheet`; `.gitattributes`: `* text=auto eol=lf`, `package-lock.json linguist-generated -diff`, бинарники; `.prettierignore` исключает `.agents/`, `.claude/`, `*.go`; `pre-commit` = `npx lint-staged`; корневой lint-staged — только Prettier + `gofmt -w`, ESLint — во вложенном `.lintstagedrc.json` (flat config ищется от каталога, `2.0/CLAUDE.md:136–140`); ESLint flat: `eslint-plugin-testing-library` на `src/**/*.test.tsx`, `eslint-plugin-playwright` на `e2e/**` с `react-hooks/rules-of-hooks: off`, `eslint-config-prettier` **последним** | Заменить `eslint-config-next` на `typescript-eslint` + `react-hooks` + `jsx-a11y`; `tailwindStylesheet` → путь токенов `@ortus/ui`; при pnpm (`design/docs/14-engineering.md:42`) — `pnpm lint-staged` и `husky` через `prepare` |
| R10 | **golangci-lint** | `2.0/apps/api/.golangci.yml:1–107` | `version: "2"`; `run.build-tags: [e2e, keycloak]` (иначе e2e невидим линтеру); `max-issues-per-linter: 0`; linters `default: standard` + `bodyclose depguard errname errorlint forcetypeassert gocritic gosec misspell nilerr noctx nolintlint paralleltest predeclared revive sloglint unconvert wsl_v5`; `exclusions.presets: [comments, std-error-handling]`, `errcheck` выключен в `_test.go`; **depguard `list-mode: strict` allow-list для `modules/**`**: `$gostd`, контракт модуля, `pgx/v5` (deny резолвится раньше allow — поэтому только allow, `:60–64`); formatters `gofumpt (group-params)`, `goimports local-prefixes` | Слить с ассетом скилла (§5.8); сохранить depguard; build-tags → `integration isolation concurrency` |
| R11 | **Makefile Go** | `2.0/apps/api/Makefile:1–56` | `help` через grep `## `, `run`, `build`, `test`, `test-e2e` (`-tags=e2e -count=1 ./e2e/...`), `test-keycloak`, `orgctl`, `cover`, `fmt`, `vet`, `lint`, `tidy`, `clean` | Добавить `gen` (oapi-codegen/sqlc), `migrate`, `seed`, `up`, `dev` по `design/docs/14-engineering.md:98–103` |
| R12 | **Golden-контракты** | `2.0/apps/api/internal/server/wire/contracts.go:17–47`; `2.0/apps/web/e2e/contracts.ts:1–70`; `2.0/docs/contracts/README.md:1–12, 148–170` | Один JSON на форму ответа; Go читает каталог через `runtime.Caller` (`..` ×5 до корня), сравнивает DTO как golden; Vitest/Playwright импортируют те же файлы; ключи `snake_case`; пустое время `""`, не отсутствие ключа; `-1` = «не измерено»; изменение контракта — отдельный маленький PR, вливается первым | В 3.0 источник — `api/openapi/ortus.yaml` + примеры в нём; «golden» становится «codegen drift = 0» + MSW из примеров (`design/docs/14-engineering.md:57–61`). Правила про `""`/`-1`/`[]` — в OpenAPI описания |
| R13 | **PostToolUse-хук форматирования** | `2.0/.claude/settings.json:1–19` | `PostToolUse` на `Write|Edit`, `"shell": "powershell"`, читает `tool_input.file_path`, проверяет что внутри `$PWD`, `gofmt -w` для `.go`, иначе `node_modules\.bin\prettier.cmd --write --ignore-unknown`, всегда `exit 0`; **молча пропускает** без `node_modules` в worktree (`2.0/CLAUDE.md:166–169`) | Перенести; добавить `Stop`-хук `node tools/verify-pages.js` (`plan/verification-protocol.md:77`); для macOS/Linux — bash-вариант |
| R14 | **`orgctl` с самоподключающимися подкомандами** | `2.0/apps/api/CLAUDE.md:45`; `2.0/docs/ws/README.md:265–269` | `cmd/orgctl/<verb>.go` регистрирует себя в `init()` — ни один поток не правит `main.go` | Конфликт со скиллом `golang-design-patterns` («avoid init()») — см. §5.6 |
| R15 | **Протокол волн** | `2.0/docs/module-rules.md:193–224`; `2.0/docs/platform-plan.md:449–467, 558–604`; `2.0/docs/ws/scope-launch.md:1–143` | см. §3.5 | `plan/orchestration.md` уже построен по нему |
| R16 | **Черновик `verify-<id>` скилла** | `2.0/docs/ws/verify-structure.SKILL.md:1–120` | Разделы: «Automated» (команды), «Playwright MCP» («если инструментов нет — скажи и остановись», `:50–57`), «The stand» (стенд командами продукта, `psql` только для сверки), «The walk» (нумерованные `browser_*`-шаги, размеры через `getComputedStyle`, вторая учётка без прав, консоль, адаптив, клавиатура, выключение модуля), «What a divergence means» | Это прообраз `verifyPagePrompt(p)` в `plan/orchestration.md:46` и шагов `plan/verification-protocol.md:55–63` |
| R17 | **`.env.example` трёх уровней** | `2.0/.env.example`; `2.0/apps/api/.env.example`; `2.0/apps/web/.env.example` | Каждая переменная — с комментарием «что и почему», значения по умолчанию совпадают с compose; `DATABASE_URL` без умолчания — сознательно (`2.0/apps/api/CLAUDE.md:274–279`) | Имена из `design/docs/repo-skeleton/.env.example:1–46` (`CONTROL_DB_URL`, `TENANT_DB_POOL_BUDGET`, `SESSION_COOKIE_NAME`, `TRIAL_*`, `HOLD_TTL`) |
| R18 | **Правило «документация в том же коммите»** | `2.0/CLAUDE.md:221–261` | Таблица «файл → что в нём протухает»; структурное изменение = пакет/зависимость/скрипт/env/эндпоинт/порт/владелец линта; «Not set up yet» удаляется в том же коммите, когда вещь появилась | Перенести дословно в `CLAUDE.md` 3.0 с новой таблицей файлов |

### 3.3. Конфликты 2.0 ↔ документы дизайна (стек)

| # | Тема | 2.0 | Документы дизайна | Что решить в плане |
|---|---|---|---|---|
| 1 | Фронт-фреймворк | Next.js 16 App Router, `src/proxy.ts`, RSC по умолчанию (`2.0/apps/web/CLAUDE.md:7–8, 131–139`) | `React + TypeScript, Vite, TanStack Router + Query; PWA через Workbox`; «Next.js — только если уже есть (D-01)» (`design/docs/14-engineering.md:16`; `16-raid-glossary.md:9`) | 3.0 — с нуля, и `plan/verification-protocol.md:35` уже пишет `VITE_ADAPTER=mock`, `localhost:5173` → **Vite**. Из 2.0 web-кода переносится только то, что не зависит от Next: `src/api/client.ts` идея, `lib/{phone,plural,relativeTime}`, e2e-паттерны |
| 2 | UI-библиотека | «There is no component library… agree on the choice before installing» (`2.0/apps/web/CLAUDE.md:1042–1043`); три разошедшихся набора `Card/Dialog/Skeleton` — «consolidation project with visible consequences» (`:1045–1078`) | Собственный `@ortus/ui` на токенах, headless Radix/React Aria, «Одна библиотека, без смешивания» (`design/docs/14-engineering.md:17`); контракт 27 компонентов (`design/docs/design-system/components.md:15–44`); «не смешивать HeroUI, shadcn и собственные копии» (`design/docs/v0.1/05-technology-review.md:27`) | См. §5.14 (HeroUI). Урок 2.0: общая мебель должна принадлежать одному WS в волне 0, иначе три копии |
| 3 | Стили | Tailwind v4 + CSS Modules для auth-экранов; хексы макета в код не переносятся, только `var(--…)` (`2.0/apps/web/CLAUDE.md:142–151`; `2.0/docs/module-rules.md:167–168`) | `tokens.json → tokens.css` с `--ox-*` (hex `#1F6B52`, `Golos Text`, `IBM Plex Mono`, радиусы 6/8/10/12, `--ox-control: 44px`) (`design/docs/design-system/tokens.css:1–45`) | Правило «цвета только через переменные» переносится; имя префикса — `--ox-*`; e2e-тест 2.0 «каждый непрозрачный цвет равен токену на `:root`» (`2.0/apps/web/CLAUDE.md:662–666`) — переиспользовать |
| 4 | HTTP-роутер | stdlib `mux.HandleFunc("GET /api/v1/…")`, метод в паттерне (`2.0/apps/api/CLAUDE.md:199–200`); `pipeline.Router` поверх `ServeMux` | `net/http + chi, серверные интерфейсы из oapi-codegen (strict server)` (`design/docs/14-engineering.md:10`); `05-technology-review.md:23` — «chi при необходимости» | oapi-codegen strict server генерирует интерфейс и умеет и chi, и stdlib `ServeMux` (Go 1.22+). Решение: stdlib + oapi-codegen `std-http` **или** chi — одно на весь backend; конвейер 2.0 (`Chain.Mount`, маркер) обёртывается над сгенерированным `Handler` |
| 5 | Контракт | Рукописные `docs/contracts/*.json` как golden; «DTO — в `wire.go`»; тела запросов — отдельные файлы, декодер отвергает незнакомые поля (`2.0/docs/contracts/README.md:240–244`) | `api/openapi/ortus.yaml` — единственный источник; CI: Spectral, валидатор 3.1, каждый `x-permissions` в каталоге; `make gen` → Go-интерфейсы, TS-клиент (`openapi-typescript + openapi-fetch`), константы прав и ошибок; «CI падает при дрейфе»; Prism/MSW из примеров; Schemathesis (`design/docs/14-engineering.md:19, 55–61`) | Contract-first побеждает; из 2.0 остаётся правило «изменение контракта — отдельный маленький PR, вливается первым» (`2.0/docs/module-rules.md:148–150`) и «decoder rejects unknown fields» (в OpenAPI `additionalProperties: false`, `design/docs/12-errors-and-events.md:31` код `unknown_field`) |
| 6 | Тенант в адресе | Организация в хосте `{org_id}.platform.localhost`, `PLATFORM_DOMAIN`, cookie `Domain=.platform.localhost`, `/api/*` на том же хосте (ADR A4, D3, D4; `2.0/apps/web/CLAUDE.md:86–127`); `X-Forwarded-Host` только от `TRUSTED_PROXY_CIDRS` | «Клиентский tenant_id выбирает желаемый контекст, но не предоставляет доступ. Отсутствие или неизвестный tenant_id не переводит запрос в „главную БД“» (`design/docs/v0.1/02-architecture.md:48`); OpenAPI: «URL tenantId never establishes authorization»; `.env.example`: `ALLOWED_ORIGINS=http://localhost:5173`, `OIDC_REDIRECT_URL=http://localhost:5173/auth/callback` — один origin, без поддоменов | ⚠ не найдено в источниках: явного решения «поддомен на тенанта» в design нет. Плюс хоста (2.0): две вкладки в двух организациях не мешают друг другу, cookie same-site, нет CORS. Минус: Vite dev и Keycloak redirect на один origin. Нужен ADR в плане (кандидат: путь `/t/{tenantId}/…` или хост — одно из двух) |
| 7 | Аутентификация | Провайдеры `local` (телефон+пароль, argon2id), `oidc`, `none`, `ldap` за интерфейсом шага 2 (A11, D1, D6); `local` в dev/тестах, Keycloak — только smoke под тегом `keycloak` (`2.0/compose.yaml:62–65`) | Только OIDC Authorization Code + PKCE через Go BFF, Keycloak общий realm клиентов + realm операторов (D-03; `02-architecture.md:82`); e2e фазы 2 — «Keycloak в dev-режиме» в compose (`plan/verification-protocol.md:36`) | Выбор: (а) оставить интерфейс провайдера и `local` для dev/e2e (дёшево, тесты без JVM) — противоречит D-03; (б) OIDC-only + `oidctest`-фейк из 2.0 (`2.0/apps/api/CLAUDE.md:52`) для unit/integration, Keycloak только в e2e фазы 2. Рекомендация: (б) с `oidctest`, иначе каждый Go-тест ждёт JVM ~1 ГБ |
| 8 | Сессия | Серверная сессия 32 байта `crypto/rand` base64url, cookie `HttpOnly SameSite=Lax Path=/ Domain=…`, `SESSION_TTL=168h`; JWT удалён (`2.0/apps/api/CLAUDE.md:726–734`) | Сессия BFF `ortus_sid`, `SESSION_TTL=12h` (`design/docs/repo-skeleton/.env.example:29–30`); «Полные mutable business permissions в долгоживущий JWT не помещаются» (`02-architecture.md:82`) | Совпадает; переносится механика `session.Manager` + `controlplane.Sessions` (одна ошибка `ErrNotFound` на «нет/отозвана/истекла») |
| 9 | Ошибки | `{"error":{"code","message","field?","attemptsLeft?"}}` (`2.0/apps/web/src/api/client.ts:6–15`); форма ставит сообщение **по `field`**, никогда по подстроке текста (`:23–34`) | RFC 9457 `application/problem+json`: `type,title,status,code,detail,requestId,violations[{field,code,message}],retryable` (`design/docs/12-errors-and-events.md:7–24`); реестр 36 кодов (`:28–65`) | Формат дизайна; из 2.0 — правило «UI выбирает текст по `code`, ошибка поля — по `violations[].field`», `requestId` показывается мелко с «Скопировать» (`:24`) |
| 10 | Миграции | Собственный `internal/migrate` (`Runner`, `Source`, линтер: каждый оператор с префиксом схемы `{id}.`, роль модуля без `CREATE`), SQL-файлы `000N_*.up/down.sql` embed (`2.0/docs/module-rules.md:20–25, 73–75`) | `goose` (SQL-файлы) + собственный migration controller по тенантам (D-06, `14-engineering.md:12`); canary → партии; expand/contract (`02-architecture.md:56`); SQL уже написан: `design/docs/db/{control_0001_init,…,tenant_0002_fleet}.sql` (применены на PostgreSQL 16.4, `design/docs/README.md:54`) | goose как раннер + контроллер и линтер из 2.0 (префикс схемы, гранты) поверх; `golang-database` скилл говорит «миграции пишут люди» — SQL дизайна считается авторским входом |
| 11 | Доступ к БД | pgx, рукописный SQL в `store_sql*.go`, `pgx.Tx` в `InTx` | `pgx/v5 + sqlc` (`14-engineering.md:11`); «каждый запрос tenant-модуля принимает предикат `scopeQuery`; ревью отклоняет запросы без него» (`:111`) | sqlc + правило `scopeQuery`; из 2.0 — `ctx.Scope().Units(perm)` → `($all or unit_id = any($ids))` (`2.0/docs/module-rules.md:122–125`) как форма предиката |
| 12 | Тестовая БД | compose `postgres-test` на 5433, tmpfs, стартует `npm run test:e2e`; `tenanttest.NewOrgDB(t)` делает одноразовую базу из `t.Name()` (отсюда префиксы `TestFleetA1…`) | `testcontainers-go (PostgreSQL 17, MinIO)` (`15-quality-security.md:10`; `plan/tdd-protocol.md:25`) | testcontainers требует Docker API из Go-процесса; на Windows-машине 2.0 Docker есть (compose работал). Решение: testcontainers для `integration`, compose-профиль — для стенда и Playwright фазы 2 |
| 13 | Версии | Go `1.25.0` (go.mod) / «1.26» (CLAUDE.md); PostgreSQL `17-alpine`; Node 22 | «последние стабильные, закреплены в CI» (D-04); compose `postgres:17`, docs проверены на 16.4 | Закрепить в плане: Go (скилл `golang-testing` упоминает 1.26 `t.ArtifactDir`, 1.27 `stdversion`), PostgreSQL 17, Node 22, pnpm (`14-engineering.md:42`) vs npm (2.0) |
| 14 | Раскладка репо | `apps/api` + `apps/web`, npm workspaces | `api/{openapi,permissions.yaml,spectral.yaml}`, `backend/` (go.mod, `cmd/{api,worker,provisioner,migrate}`, `internal/{platform,control,modules}`, `migrations/{control,tenant}`, `test/{isolation,concurrency,contract}`), `frontend/{apps/web,packages/{tokens,ui,api-client,domain}}`, `deploy/{compose,helm}` (`14-engineering.md:26–51`) | Раскладка дизайна; из 2.0 переносится идея `go -C backend …` в npm-скриптах (кроссплатформенно, `2.0/CLAUDE.md:86–87`) |
| 15 | Адаптив | Пороги desktop 1024/1280/1440, `@media (max-width: 1024px)` inclusive vs Tailwind `max-[…]` exclusive (`2.0/CLAUDE.md:192–198`; `apps/web/CLAUDE.md:427–434`) | mobile-first: 390 / 768 / 1440; нижняя навигация < 640, рейл 640–1079, сайдбар ≥ 1080 (`components.md:37`; `design/README.md:12`); «Только размеры desktop 1280/1024 → добавить реальные сценарии телефона» (`02-architecture.md:365`) | Пороги прототипа; ловушки Tailwind v4 переносятся как правила (§4) |
| 16 | Скриншоты | **`toHaveScreenshot` не используется** — «Windows font rasterisation will never match a Linux CI baseline» (`2.0/apps/web/CLAUDE.md:1017–1018`; `2.0/docs/module-rules.md:189, 305–306`); размеры/цвета — `getComputedStyle` | `expect(page).toHaveScreenshot()` с `maxDiffPixelRatio: 0.01` на 390 и 1440, локальные копии шрифтов в CI, allowlist отличий; плюс структурная сверка текстов `button/a/h1–h3/label/[aria-label]` (`plan/verification-protocol.md:41–48`) | Протокол 3.0 принят, но риск 2.0 реален: базовые снимки — **per-platform** (`snapshotPathTemplate` с `{platform}`), CI и dev на разных ОС не делят baseline; структурная сверка `labels.spec.ts` — обязательная и платформонезависимая, пиксельная — с allowlist |
| 17 | CI | нет | `lint → contract → unit → integration → isolation+concurrency → build → e2e → deploy` (`14-engineering.md:85–94`), платформа D-02 | Волна 0: CI обязателен; `test:race` только на Linux (`2.0/CLAUDE.md:119–122`) |
| 18 | Хранение скиллов | `.agents/skills/` в git + `skills-lock.json` + junction в `.claude/skills/` (в `.gitignore`); черновики `verify-*` в `docs/ws/*.SKILL.md`, т.к. `.claude/` из удалённых инструментов не пишется (`2.0/README.md:391–411`; `2.0/.gitignore:1–6`) | `.claude/skills/` прямо в 3.0, `skills-lock.json` с 17 записями | Решить до волны 0: верифицирующие скиллы страниц — в `.claude/skills/verify-<page>/` (трекать в git) или промпт `verifyPagePrompt` без скилла (`plan/orchestration.md:46`) |
| 19 | Первый модуль | «Ремонт» (D5), затем datastore/fleet/structure | Логистика/fleet как пилот (`16-raid-glossary.md:38`); `tenant_0002_fleet.sql` | D5 отменяется; доменные идеи fleet-волн (D16 производное состояние, D17 VIN, D19 регион единицы, кандидаты водителей, передачи с датами) — переиспользовать как уже проверенные правила, сверив с `design/ortus/models.js` |

### 3.4. ADR проекта 2.0: сводка и вердикт

Реестр — `2.0/docs/adr/README.md:10–46`; каждый файл по форме «Статус · Контекст · Решение · Последствия» (`2.0/docs/adr/README.md:6–8`: «ADR меняется только вместе с решением; пересмотренное правится, не удаляется»). Шаблон 3.0 — `design/docs/16-raid-glossary.md:46–63` (добавляет раздел «Варианты»).

| ADR | Решение (одна строка) | Вердикт для 3.0 |
|---|---|---|
| A1 | База на организацию + платформенная база | **Взять**: совпадает с A-02 дизайна (`02-architecture.md:338`) |
| A2 | Порядок проверок в одном месте, база тенанта открывается последней | **Взять** (TenantContext, `02-architecture.md:48`) |
| A3 | Членство проверяется до тарифа и жизненного цикла (403/404 не перебирают клиентов) | **Взять**: «Foreign and invisible object IDs return the same 404» (OpenAPI описание) |
| A4 | Организация в хосте, а не в сессии | **Открыто** (§3.3 п. 6) |
| A5 | Личность по `issuer + sub` | **Взять**: Account привязан к issuer+subject (`02-architecture.md:70`) |
| A5a | `local` идентифицирует по телефону | **Зависит** от п. 7 §3.3; в дизайне провайдера `local` нет |
| A6 | Членство — из групп провайдера, роли — на платформе | **Адаптировать**: TenantMembership в control DB, роли в tenant DB (`02-architecture.md:68–77`); синк групп в 2.0 так и не был подключён (`2.0/docs/adr/D7-mixed-group-membership.md:5–9`) |
| A7 | Модуль получает контекст, а не конфигурацию | **Взять**: capabilities через context/constructor (`02-architecture.md:281`) |
| A8 | Схема на модуль внутри базы организации; `SET LOCAL ROLE` + `search_path` в транзакции | **Взять**: `ScopedDB` своей схемы (`14-engineering.md:53`) |
| A9 | Воркфлоу копируются, а не ссылаются на шаблон | **Взять** как принцип версионирования форм/статусов |
| A10 | Один бинарник, модули вкомпилированы | **Адаптировать**: один код, несколько `cmd/{api,worker,provisioner,migrate}` (A-01 дизайна) |
| A11 | Провайдер аутентификации — интерфейс на шаге 2 | **Адаптировать** (OIDC + `oidctest`) |
| A12 | Внешние группы задают часть состава, права всегда локальные | **Взять** как принцип |
| D1 | Логин `local` — только телефон | **Открыто** (нет в дизайне) |
| D2 | Модули в том же Go-модуле `apps/api/modules/{id}` | **Взять**, путь `backend/internal/modules/{id}` |
| D3 | `PLATFORM_DOMAIN`, в dev `platform.localhost` | зависит от A4 |
| D4 | Один хост на организацию, разделение по пути `/api/*` | зависит от A4; в Vite — `server.proxy` на `/api` |
| D5 | Первый модуль — «Ремонт» | **Отменить**: пилот — логистика |
| D6 | `local` в dev/тестах, `oidc` в проде, `none` для demo | **Пересмотреть** (D-03) |
| D7 | Смешанный состав группы разрешён | **Адаптировать** (GroupMembership + RoleAssignment) |
| D8 | Ответы на открытые вопросы ТЗ §12 | **Заменить** на D-01…D-12 |
| D9 | Состав зависимостей Go: каждая строка говорит, что покупает | **Взять правило** и таблицу; добавить `oapi-codegen`, `sqlc`, `goose`, `testcontainers-go`, OTel |
| D10 | Коды приглашений: 8 букв, хеш под pepper, один отказ | **Открыто**: дизайн — приглашение по токену-ссылке (`02-architecture.md:80`) |
| D11 | Настройки на хосте организации, оператор на `admin.` | **Адаптировать**: отдельная оболочка оператора, отдельный realm |
| D12 | Журнал действий в control plane, без данных клиентов | ⚠ сверить с `design/docs/db/tenant_0001_core.sql` (аудит в tenant DB по `design/docs/README.md:11`) |
| D13 | Экран модуля — из реестра `src/modules`, один роут `/m/[module]/[[...path]]` | **Адаптировать**: TanStack Router + `navFor` из прав |
| D14 | Набор модулей — подписка; ручной тумблер — отклонение | **Адаптировать**: subscription / entitlement / module_installation (`02-architecture.md:251`) |
| D15 | «Машины»: пульт как основа, вид списка — параметр `?view=` | **Принцип** «состояние экрана в URL» взять; макет другой |
| D16 | Четыре хранимых статуса, «в поездке» — производное, осмотр — флаг | **Взять идею**: «плановая бронь ≠ фактическая занятость» (`02-architecture.md:178`) |
| D17 | Ключ сопоставления «Машин» — VIN | **Взять** для импорта |
| D18 | Область — свойство назначения: организация → регион → группа | **Адаптировать**: scopes `tenant / org_unit(include_descendants) / project / resource` (`02-architecture.md:92`) |
| D19 | Регион машины — регион её единицы | **Взять идею** (у факта один хозяин) |
| D20 | Дерево структуры одно — в `core`; модуль пишет через порт | **Взять принцип** |
| D21 | Фонд: план — модуля, факт — проекция «Оплаты» | **Отменить**: «водители не видят начисления вообще» (A-12 дизайна) |
| D23 | Имя группы уникально; удаление забирает назначения | **Адаптировать** |

### 3.5. Как 2.0 делил работу между агентами, и что сработало

**Формат волны** (`2.0/docs/module-rules.md:195–224`; `2.0/docs/ws/README.md:46–71, 160–204`):

1. **S0 блокирующая** кладёт «всё, что двое могли бы захотеть отредактировать»: каркас модуля (манифест, порт `Store` целиком, `wire.go`, `errors.go`, миграция, роуты-заглушки `501`/`ErrNotImplemented`), контракты, TS-типы и клиент, фикстуры и стаб, `testids.ts`, экран-заглушка в реестре, строка в `playwright.config.ts`, брифы `docs/ws/{id}-*.md`, черновик `verify-{id}` скилла. Правка фундамента (`internal/module`) — отдельный `S0-fnd` **до** всего. S0 волны «Структура» шла **тремя агентами** (Go-каркас → веб-каркас → брифы+скилл) и прошла ревью (39 замечаний, 5 блокирующих) до старта потоков (`2.0/docs/ws/structure-s0.md:18–35`).
2. **Карта владения — один файл, один поток**, таблицей в плане; проверяется `git diff --name-only platform` (`module-rules.md:204–206`). Файл с заглушкой S0 несёт в шапке `Owner: A1` и это утверждение теста `TestStructureS0EveryStubNamesItsStream` (`structure-s0.md:69–73`).
3. **Раскладка потоков**: Go — по разделам данных (список/карточка, операции/процесс, документы/финансы, наборы); фронт — рамка, список, карточка, разделы, **и отдельный поток e2e, который никогда не склеивается с авторами экранов** (`module-rules.md:207–211`; `ws/README.md:94–96, 137–140`). Две стороны одного инварианта — разным авторам (A1 фильтр по области и A2/A3 `CheckIn`; A3 Go-формулы и F3 TS-формулы, `ws/README.md:41–44, 180–182`).
4. **TDD — минимум два коммита**: `test({id}-{поток}): failing specs for …` → `feat({id}-{поток}): …`; красный тест падает на утверждении, не на компиляции; не вышедший в зелёный — `t.Skip`/`test.skip` с причиной, не удаление; **волна одним коммитом — единственное нарушение, которое нельзя починить задним числом** (`module-rules.md:212–214, 311–315`).
5. **Ресурсы стенда**: `PORT` на фронтовый поток (F1 3001 … e2e 3000; интеграция 3005, чтобы `reuseExistingServer` не подцепил чужой dev-сервер, `ws/README.md:229–231`); префикс `Test{Id}{Поток}` у Go-тестов с базой (общая 5433); `db:reset` и `npm run dev` — только интегратор; `typecheck ⊥ e2e:web`; `npm install` в каждом worktree.
6. **Бриф потока — девять разделов**: цель · читать · владеет · не трогает · что лежит от S0 · красные тесты · DoD · на что смотреть · запросы к интегратору (пример — `2.0/docs/ws/fleet-f5.md:1–78`). Запуск — **один промпт на всех** с подстановкой потока и порта (`2.0/docs/ws/scope-launch.md:63–98`); worktree на поток: `git worktree add ../scope-$s -b ws/scope-$s platform; npm install` (`:44–49`).
7. **Интегратор**: карта → запросы к интегратору → вливание **rebase'ом в порядке DAG** (A1 → A3 → A2 → A4, затем F1 → F5) → монтаж в `app.go` → снятие `t.Skip` и заглушек → полная сюита на 3000 → стенд → проход скилла → документация → раздел «Что разошлось с планом» (`module-rules.md:221–223`; `scope-launch.md:113–137`). Интегратор **не чинит чужой файл — возвращает автору**.
8. **Сдано дважды**: автотесты зелёные **и** пройден чеклист `/verify-{id}` по живому стенду через Playwright MCP; одно без другого — не сдано (`module-rules.md:227–246`).

**Что сработало** (`2.0/docs/ws/README.md:188–210, 240–245`): все девять веток волны «Структура» открылись красным коммитом; интеграция без текстовых конфликтов; F5 (e2e) прошёл против влитых экранов с первого прогона в волне «Группы». **Что нашла только интеграция и проход**: состав узла не был виден ни на одной ширине при зелёных jsdom-наборах обеих сторон (два рендера под два порога, `module-rules.md:346–350`); метод записи вне порта; «живой узел» определён дважды; первый круг прохода — 15 расхождений; платформенный баг `DirectRolesOf` вскрыл стенд. Вывод для 3.0: `plan/orchestration.md:33` (отдельный проверяющий на страницу) и `plan/verification-protocol.md:51–65` — не роскошь, а то, что в 2.0 ловило дефекты, невидимые тестам.

**Форма более ранних брифов** (`2.0/docs/platform-plan.md:583–604`, пример `2.0/docs/ws/W5.md:1–63`): «Ветка · Задача · Владеешь · Реализуешь · Два теста, ради которых поток существует · Берёшь из фундамента · Сдаёшь · Документация · На что смотреть». Правила совместной работы §6.5: интерфейс фундамента заморожен; фейк — часть контракта; тест потока не требует чужой реализации; общие файлы (`go.mod`, `config`, `.env.example`, `app.go`, `main.go`, `compose.yaml`, `.golangci.yml`, корневой `package.json`, `README.md`, layout-блоки `CLAUDE.md`) — только F и интегратор; роуты — только через `pipeline.Router`.

### 3.6. «Things that will bite you» — уроки 2.0 и применимость в 3.0

Источник — `2.0/CLAUDE.md:84–201`, дополнения из `module-rules.md:292–355`, `apps/web/CLAUDE.md:1020–1038`.

| Урок | Источник | В 3.0 |
|---|---|---|
| `go -C apps/api …` в npm-скриптах, никогда `cd` — одинаково в PowerShell и bash | `CLAUDE.md:86–87` | **Да**: `go -C backend …` |
| PowerShell 5.1: `&&`/`\|\|` не работают; скрипты должны быть кроссплатформенны | `:123–125` | **Да** |
| Многострочный `git commit -m` из PowerShell падает `fatal: Invalid path '/api'`; писать сообщение в файл и `git commit -F`; **без BOM** — `[System.IO.File]::WriteAllText($file, $msg, (New-Object System.Text.UTF8Encoding $false))` (большинство потоков волны «Структура» переделывали коммит) | `:170–177` | **Да** — конфликт со скиллом `git-commit` (§5.1) |
| `HTTP_PROXY` экспортирован: `curl.exe` нужен `--noproxy "*"`; PowerShell не ставит `Host`; `$OutputEncoding` ASCII — кириллица в `psql` как `?` | `:178–183` | **Да** (та же машина) |
| `.mcp.json` и `.claude/settings.json` читаются на старте сессии; новый хук — `/hooks` или перезапуск | `:108–109, 199–201` | **Да** |
| MCP-сервер Playwright имеет **свой** браузер: нужны и `e2e:install`, и `mcp:install`, иначе «Browser "chrome-for-testing" is not installed» | `:110–118` | **Да** |
| `npx -y @playwright/mcp@latest` таймаутил 30-секундное подключение и менял версию между сессиями → пин devDependency | `:112–115` | **Да** |
| `-race` требует cgo; на машине нет gcc → гонять в CI на Linux | `:119–122` | **Да** |
| `typecheck` и `e2e` не одновременно (`.next/types` lock) | `:105–107` | Next-специфично; в Vite проверить `tsc -b` ↔ dev-сервер |
| `tsc --noEmit` без `next typegen` падает | `:88–91` | Нет (Next) |
| `lint:api` из корня ломается: golangci-lint v2 отвергает `./apps/api/...` — линтить из каталога модуля | `:101–104` | **Да**: `golangci-lint run ./...` из `backend/` |
| golangci-lint v2 схема; v1 бинарь не читает конфиг; путь `…/golangci-lint/v2/cmd/…` | `apps/api/CLAUDE.md:288–290` | **Да** |
| `lint-staged` в двух конфигах: ESLint во вложенном, иначе «couldn't find an eslint.config file» | `:136–140` | **Да** при вложенном `frontend/apps/web` |
| `.gitattributes eol=lf`, иначе `format:check` красный на Windows (`core.autocrlf=true`) | `:141–143` | **Да** |
| Каждый worktree — свой `npm install`; PostToolUse-хук без `node_modules` **молча** пропускает Prettier | `:166–169` | **Да** |
| `docker compose up --wait` считает одноразовый контейнер провалом → `run --rm` отдельно | `:144–148` | **Да** (seed/minio-init) |
| Keycloak импортирует realm при каждом старте; правки в консоли пропадают | `:149–151` | **Да** |
| `go mod tidy` удаляет зависимость без импортёра → `internal/deps/deps.go` с build-тегом | `:152–156` | Решить: в contract-first все зависимости появляются вместе с `make gen`; пин вероятно не нужен |
| Каталог `_example` невидим для Go-инструментов | `:157–160` | **Да** |
| `depguard` резолвит `deny` раньше `allow` → только allow-list со `strict` | `:161–165` | **Да** |
| Дата-литерал в тесте через настенные часы — бомба (три теста взорвались 15.09.2026); дата от `time.Now()` или `WithClock`; обход `TestE2EWallClockDatesAreDerived` | `:184–191`; `module-rules.md:336–345` | **Да**: демо-«сегодня» прототипа = 1 октября 2026 (`design/README.md:163`) — та же мина |
| `rounded-full` = `calc(infinity * 1px)` → `33554432px`; `max-[1023px]` = `width < 1023` | `:192–198` | **Да** (Tailwind v4): `--ox-radius-pill: 999px` писать `rounded-[999px]` |
| Два рендера под два порога дублируют `data-testid`, теряют фокус, оба jsdom-набора зелёные при невидимых строках — один DOM и CSS `@media` | `module-rules.md:346–350` | **Да** |
| Условный `skip` «после соседа» после вливания превращается в спящий — интегратор удаляет | `module-rules.md:351–355` | **Да** (`test.fixme` в 3.0 снимается по одному) |
| jsdom без движка раскладки: размеры/цвета — только в Playwright | `apps/web/CLAUDE.md:1002–1004` | **Да** |
| `window.location` неподделываем в jsdom 29 — `vi.stubGlobal("location", …)` | `:1020–1023` | **Да** |
| `click()`, не `check()`, на управляемом чекбоксе | `:1029–1030` | **Да** |
| `data-testid` = `<area>-<element>[-<key>]`, ASCII, не из русского текста и не из состояния; состояние в `data-state`/`data-active` | `:1031–1036` | **Да**, но 3.0 предпочитает `getByRole`/`getByLabel` (`plan/tdd-protocol.md:54`) |
| Иконка-лигатура Material Symbols: неверный класс рисует слово `view_kanban`, а `textContent` одинаков — тесты держат класс и `font-family`; поймал только скриншот | `apps/web/CLAUDE.md:382–386` | **Да** (прототип на Material Symbols Rounded) |
| `webServer.url` — `127.0.0.1`, не `.localhost` (Node) | `:1024–1025` | **Да** |
| Не чинить golden-фикстуру под свой ответ, не ослаблять красный тест — за это поток возвращают без разговора | `module-rules.md:307–308` | **Да** |
| «Не подхватывать заодно» — выход за карту владения, не инициатива | `:309–310` | **Да** |

---

## 4. Установленные скиллы: что каждый накладывает

Все 17 — из `skills-lock.json` 3.0: 13 × `samber/cc-skills-golang`, `github/awesome-copilot` (git-commit), `heroui-inc/heroui`, `obra/superpowers` (requesting-code-review), `vercel-labs/agent-skills`. Общая оговорка Go-скиллов: «**Community default.** A company skill that explicitly supersedes … takes precedence» (напр. `skills/golang-code-style/SKILL.md:24`) — план вправе переопределять, но **явно, в `CLAUDE.md`**.

Скиллы, на которые Go-скиллы ссылаются, но которые **не установлены**: `golang-gopls`, `golang-safety`, `golang-concurrency`, `golang-observability`, `golang-dependency-injection`, `golang-continuous-integration`, `golang-refactoring`, `golang-documentation`, `golang-samber-oops`, `golang-samber-slog`, `golang-stretchr-testify`, `golang-benchmark`, `golang-pkg-go-dev`, `golang-cli`, `golang-performance`, `golang-grpc`, `golang-how-to`, `golang-dependency-management`. Ссылки «→ See …» на них агент должен игнорировать; `golang-project-layout/SKILL.md:119` требует «написать always-load директиву для `golang-how-to` в CLAUDE.md без подтверждения» — **не выполнять**, скилла нет.

### 4.1. `git-commit` (`skills/git-commit/SKILL.md:1–125`)

| Правило | Строки | Для плана |
|---|---|---|
| Conventional Commits `<type>[scope]: <description>`; типы `feat fix docs style refactor perf test build ci chore revert`; `!`/`BREAKING CHANGE` | 14–49 | Совпадает с `design/docs/14-engineering.md:65` и `plan/tdd-protocol.md:9–11` (`test(<scope>)` → `feat(<scope>)` → `refactor(<scope>)`). Скоуп — id WS/модуля (`feat(fleet): …`) |
| Описание: present tense, imperative, < 72 символов; одно логическое изменение | 110–116 | Да |
| Анализ `git diff --staged` / `git status --porcelain` перед коммитом; `git add -p` | 54–81 | Да |
| **Никогда не коммитить секреты** (.env, ключи) | 83 | `.env` в `.gitignore` (2.0 `.gitignore`: `.env`, `.env.local`, `!.env.example`) |
| `git commit -m "$(cat <<'EOF' … EOF)"` для многострочных | 99–107 | ⚠ **Конфликт**: bash-heredoc — ошибка парсера в PowerShell 5.1, а `-m` с переводами строк ломал git (`2.0/CLAUDE.md:170–177`). В `CLAUDE.md` 3.0: `git commit -F <файл без BOM>` |
| Safety: не менять git config, не `--force`/hard reset, не `--no-verify`, не force-push в main; при падении хука — **новый** коммит, не amend | 118–124 | Да; совпадает с 2.0 «do not bypass it with `--no-verify`» (`2.0/CLAUDE.md:210–211`) |

### 4.2. `golang-code-style` (`skills/golang-code-style/SKILL.md`)

| Правило | Строки |
|---|---|
| Строки > ~120 символов **MUST** ломаться по смысловым границам; вызов с 4+ аргументами — по аргументу на строку | 36–50 |
| `:=` для ненулевых, `var` для нулевых; слайсы и мапы **инициализировать явно, никогда nil** (nil-слайс сериализуется в `null`) | 56–73 |
| Композитные литералы — только с именами полей | 79–87 |
| Ранний возврат, без `else` после `return`; 3+ операнда в условии — именованные booleans; `switch` вместо цепочек | 93–169 |
| ≤ 4 параметров, дальше options struct; порядок `ctx, inputs, outputs` | 173–181 |
| Blank-импорты только в `main` и тестах; dot-импорты никогда; «unexport aggressively» | 202–204 |
| `%q` в ошибках; `strings.Builder` в циклах | 208 |
| `slices`/`maps` stdlib; для filter/group-by — `github.com/samber/lo` | 221 |

Для плана: правило про nil-слайсы совпадает с контрактом 2.0 (`roles: []`, не `null`, `2.0/docs/contracts/README.md:317–320`). `samber/lo` — новая зависимость; по D9 «каждая строка говорит, что покупает» — решить (2.0 обходился stdlib). Blank-импорт `internal/deps/deps.go` под build-тегом нарушает правило — в 3.0 не нужен.

### 4.3. `golang-naming` (`skills/golang-naming/SKILL.md`)

| Правило | Строки |
|---|---|
| MixedCaps везде; подчёркивания только в `TestFoo_InvalidInput` | 65–77 |
| Пакет — lowercase, одно слово, ед. число; файл `user_handler.go` | 38–39, 152 |
| Без статтеринга: `http.Client`, `user.New()`; `New()` при одном типе в пакете | 81–104 |
| Boolean-поля `is/has/can`; геттер без `Get`, но `IsX()` сохраняет префикс | 106, 133 |
| Ошибки: `ErrNotFound`, тип `PathError`; строки **полностью lowercase, включая аббревиатуры**, с префиксом пакета `"apiclient: not found"` | 46–47, 108 |
| Enum: `StatusUnknown` на 0 | 110 |
| Subtests lowercase (`"valid id"`); табличные поля `input`/`expected`; `got` | 61, 112 |
| Опции `With*`; варианты `WithContext`, `In`, `Must` | 52–55 |

Для плана: 2.0 писал `Test{Scope}{Поток}Что…` длинные имена (нужны `tenanttest`), скилл это не запрещает; `golang-testing` §4.11 добавляет ограничение на имена файлов.

### 4.4. `golang-project-layout` (`skills/golang-project-layout/SKILL.md`, `references/directory-layouts.md`)

| Правило | Строки |
|---|---|
| **Сначала спросить** архитектуру (clean/hexagonal/DDD/flat) и подход к DI через инструмент вопросов, по одному | 22, 28–34 |
| 12-factor: config из env, логи в stdout, graceful shutdown, admin-задачи как `cmd/migrate/` | 38 |
| Module path **MUST** совпадать с URL репозитория, lowercase, дефисы | 54–72 |
| Все `main` в `cmd/<name>/main.go` с минимальной логикой; бизнес-логика в `internal/`; `pkg/` только для внешних | 80, `directory-layouts.md:100` |
| Обязательны `Makefile`, `.gitignore`, `.golangci.yml` в корне Go | 86–90 |
| `go.work` для монорепо из нескольких модулей | 98–100 |
| Чеклист инициализации (`go version`, `go mod init`, `gofmt -s -w .`) | 102–119 |

Для плана: вопросы «архитектура/DI» в автоматизированной волне задать нельзя — план **заранее отвечает**: порты-и-адаптеры в стиле 2.0 (`internal/platform/*` как порты с фейками, модули как библиотеки), ручная конструкторная инъекция (как `internal/app/app.go` в 2.0), один Go-модуль `backend/` (`design/docs/14-engineering.md:32`), `go.work` не нужен. Module path — закрепить (у 2.0 `github.com/6ykashka/crm_2/apps/api`); ⚠ 3.0 не git-репозиторий — удалённый URL не найден в источниках.

### 4.5. `golang-context` (`skills/golang-context/SKILL.md:28–40`)

Один контекст через весь запрос (`HTTP → service → DB → external`); `ctx context.Context` первым; не хранить в структуре; `context.TODO()` вместо nil; `cancel()` на всех путях; `Background()` только в `main/init/tests`; ключи — unexported типы; в значениях только request-scoped метаданные; `context.WithoutCancel` для фоновой работы, переживающей запрос (audit log, outbox).

Для плана: 2.0 `middleware.go` соответствует (`requestIDKey struct{}`, `logFieldsKey struct{}`). ⚠ `pipeline.Context` 2.0 — объект запроса, из которого модуль берёт `DB()`, `Scope()` и т.д.; ассет линта включает `containedctx` (`skills/golang-lint/assets/.golangci.yml:52`), который ругается на `context.Context` в полях структур — проверить дизайн `TenantContext` (`design/docs/v0.1/02-architecture.md:48`: «immutable TenantContext») на совместимость: контекст запроса передаётся параметром, TenantContext — значение в нём.

### 4.6. `golang-error-handling` (`skills/golang-error-handling/SKILL.md:38–54`)

| Правило | Для плана |
|---|---|
| Ошибки **MUST** проверяться; оборачивать `fmt.Errorf("{context}: %w", err)`; lowercase без точки | Совпадает с 2.0 (`errorlint`) |
| `%w` внутри, `%v` на системной границе | Граница = RFC 9457 `Problem` |
| `errors.Is` / `errors.As` / Go 1.26+ `errors.AsType[T]` | Версия Go решает |
| **Логировать ИЛИ возвращать, не оба** | Правило в `CLAUDE.md`; middleware `Logging` — единственная точка лога запроса |
| Sentinel для ожидаемых, типы — с данными | `domain.ErrReservationOverlap` → `Problem.code` в одном месте (`design/docs/14-engineering.md:110`) |
| `slog` структурно; `samber/oops` для прод-ошибок со стеком/tenant-контекстом | `oops` — решение по D9; дизайн требует `request_id, tenant_id, actor_id` в логах и запрет токенов/тел форм/фото/сумм (`14-engineering.md:114`) |
| Низкая кардинальность сообщений, id — в атрибутах | Да |

### 4.7. `golang-design-patterns` (`skills/golang-design-patterns/SKILL.md:37–57`)

| Правило | Конфликт/решение |
|---|---|
| Конструкторы — функциональные опции, опции возвращают ошибку при валидации | 2.0 использовал `Deps`-структуры (`serverauth.Deps`, `e2e_test.go:211–231`) — допустимо как options struct из `golang-code-style:174` |
| **Avoid `init()`** и mutable globals | ⚠ **Конфликт** с 2.0: `cmd/orgctl/<verb>.go` саморегистрация в `init()` и `pipeline.Provide` из `init()` (`2.0/apps/api/CLAUDE.md:1264–1269`, `ws/README.md:265–269`) — приём существует ради параллельности («двенадцать веток в один файл — двенадцать конфликтов»). Решение для плана: явный реестр в `internal/app/wire.go` (один файл, но строка на модуль — конфликт слияния в одной строке решается механически), **или** оставить `init()` с комментарием-обоснованием («When ignoring a rule, add a comment», `golang-code-style:32`). Рекомендация: явный реестр, т.к. с oapi-codegen роуты всё равно монтируются из одного сгенерированного `Handler` |
| Enum с `Unknown` на 0; `var _ Interface = (*T)(nil)`; regexp на уровне пакета; `//go:embed` для миграций/ассетов; `crypto/rand` | Да |
| Таймаут на каждый внешний вызов; лимиты на пулы/очереди; retry проверяет `ctx.Err()` | Совпадает с `TENANT_DB_POOL_BUDGET`, idle TTL (`design/docs/repo-skeleton/.env.example:8–10`) |
| «Ask the developer which architecture they prefer» | Заранее решить в плане (см. 4.4) |
| «A little recode > a big dependency» | = D9 |

### 4.8. `golang-structs-interfaces` (`skills/golang-structs-interfaces/SKILL.md`)

| Правило | Строки | Конфликт/решение |
|---|---|---|
| Интерфейсы 1–3 метода, композиция | 34–52 | 2.0 `controlplane.Store` составлен из частей (`Organizations`, `Hosts`, …) — соответствует; `module.Context` с десятком аксессоров — нарушает; в 3.0 capabilities дизайна (`Authz, ScopedDB, Storage, Directory, Scheduling, Events, Workflow, DataSets, Audit, Clock, Usage`, `02-architecture.md:281`) передавать **по отдельности** через конструктор, а не одним «контекстом» |
| Интерфейсы **MUST** определяться у потребителя | 64–81 | Протокол волн требует интерфейсы в фундаменте (пакет-порт + фейк, `2.0/docs/platform-plan.md:483–499`) — **сознательное отступление**: порт определяется в `internal/platform/<port>` с `<port>test` фейком, чтобы 12 потоков тестировались независимо; записать в `CLAUDE.md` как company override |
| «Don't create interfaces prematurely» | 95–110 | То же отступление; аргумент: вторая реализация существует с первого дня — фейк |
| Accept interfaces, return structs | 83–93 | Да; 2.0 `NewHTTPServer` возвращает `*http.Server` |
| Zero value полезен; `any` → generics | 112–148 | Да |
| Comma-ok при type assertion (`forcetypeassert`) | 177 | Да |
| Теги на всех сериализуемых полях; `omitempty` vs `omitzero` | 245–256 | Да; с oapi-codegen DTO генерируются |
| Единообразные ресиверы; `noCopy` для mutex-структур | 258–275 | Да |

### 4.9. `golang-database` (`skills/golang-database/SKILL.md:37–54`, `references/testing.md`)

| Правило | Для плана |
|---|---|
| `sqlx`/`pgx`, **никаких ORM**; параметризованные запросы; `*Context`-методы; `rows.Close()` + `rows.Err()`; `Exec` для не-SELECT | Совпадает с дизайном (`pgx + sqlc`) и 2.0 |
| `sql.ErrNoRows` → доменная ошибка | С pgx — `pgx.ErrNoRows` |
| Транзакции для многошаговых операций; `SELECT … FOR UPDATE`; уровни изоляции для финансов | Дизайн: бронь — exclusion constraint + блокировка в стабильном порядке, 409 (`02-architecture.md:180`); «последний владелец» — блокировка одной control-строки (`:86`) |
| Пул: `SetMaxOpenConns/Idle/ConnMaxLifetime/IdleTime` | pgxpool эквиваленты; бюджет на процесс |
| **Миграции — внешним инструментом** (golang-migrate / Flyway / Atlas), SQL пишут и ревьюят люди, применяют через CI | Дизайн — goose (D-06) + свой контроллер по тенантам; `goose` не в списке скилла, но это «внешний инструмент» того же класса; контроллер (canary → партии) — своя логика поверх |
| **«Never create or modify database schemas»** (AI не проектирует схемы) | Схема уже написана авторами дизайна (`design/docs/db/*.sql`, проверена на 16.4) — агент переносит, не придумывает; новые таблицы модулей — только по `10-data-model.md` и с ревью (CODEOWNERS `migrations/**`, `14-engineering.md:68`) |
| Избегать триггеров, view, stored procedures, **RLS** | Дизайн: RLS — не главный барьер (`02-architecture.md:297`); 2.0 — `SET LOCAL ROLE` + гранты, без триггеров — совместимо |
| Интеграционные тесты — testcontainers-go | = `plan/tdd-protocol.md:25` |

### 4.10. `golang-testing` (`skills/golang-testing/SKILL.md:49–63`)

| Правило | Для плана |
|---|---|
| Табличные тесты с `name` в `t.Run`; `t.Parallel()` где нет общего состояния | = 2.0 (`paralleltest`) |
| Интеграционные — за build-тегом `//go:build integration`; `go test -tags=integration` | Теги 3.0: `integration`, `isolation`, `concurrency` (`plan/tdd-protocol.md:40`); 2.0 — `e2e`, `keycloak`. `.golangci.yml` **должен перечислить все теги в `run.build-tags`**, иначе эти файлы невидимы линтеру (`2.0/apps/api/.golangci.yml:8–13`) |
| Тесты независимы от порядка; проверяют контракт, не внутренности | Да; 2.0 e2e масштабирует через уникальные идентификаторы, не truncate |
| `goleak.VerifyTestMain` в пакетах с горутинами; `testing/synctest` (Go 1.25+) для времени | Новая зависимость `go.uber.org/goleak` — по D9; `synctest` для hold-TTL брони и lockout-окон |
| testify как помощник, не замена stdlib; **не создавать `assert.New(t)` в родителе для subtests** | 2.0 без testify (stdlib `t.Fatalf`); решить: testify (+`testifylint`) или stdlib. Рекомендация: stdlib, как 2.0 — меньше магии, `testifylint` тогда не нужен |
| Файл теста называется по файлу источника (`foo.go` → `foo_test.go`), порядок тестов = порядок функций | ⚠ 2.0 e2e-пакет именовал по сценариям (`login_test.go`, `scope_isolation_test.go`) — для `backend/test/{isolation,concurrency}` это сценарные пакеты без «файла источника», правило неприменимо; в `internal/` — соблюдать |
| Race в CI; fuzz; `ExampleXxx`; покрытие — поиск дыр, не цель | `plan/tdd-protocol.md:63`: покрытие домена ≥ 90 % |
| Go 1.26+ `t.ArtifactDir()`, Go 1.27 `stdversion` | Зависит от версии Go (D-04) |
| Зависимость `gotests` CLI для скаффолда | Необязательна |

### 4.11. `golang-lint` (`skills/golang-lint/SKILL.md`, `assets/.golangci.yml`)

| Правило | Строки |
|---|---|
| Каждый проект **MUST** иметь `.golangci.yml` — источник правды | 47 |
| `golangci-lint run ./...`, `--fix`, `golangci-lint fmt ./...` (v2) | 51–69, 100–103 |
| `//nolint` **MUST** называть линтер и причину; `nolintlint` это проверяет; **никогда** не глушить `gosec`, `bodyclose`, `sqlclosecheck` без сильной причины | 89–94 |
| `issues.new-from-rev` для legacy | 103 |
| Ассет: 48 (в тексте `:47`) / 33 (`:73`) линтеров — ⚠ противоречие в самом скилле | `assets/.golangci.yml:13–102` |

Сравнение ассета с `2.0/apps/api/.golangci.yml`:

| Линтер | 2.0 | Ассет скилла | Решение |
|---|---|---|---|
| `depguard` | **включён**, strict allow-list для `modules/**` | **выключен** («requires per-project configuration», `:83`) | Включить с правилом 2.0 (путь `internal/modules/**`, allow `$gostd`, `internal/platform/...`, `pgx/v5`, сгенерированный `api/`) — это механика изоляции модулей (`design/docs/14-engineering.md:53` тоже требует depguard) |
| `wsl_v5` | включён | включён (`allow-first-in-block: true`, `branch-max-lines: 2`) | Взять настройки ассета |
| `gofumpt` | `group-params: true` | `extra-rules: true` | Ассет |
| `godot`, `funlen` (120/80), `gocyclo` (13), `nestif`, `dupl` (100), `goconst`, `perfsprint`, `testifylint`, `thelper`, `usetesting`, `modernize`, `exhaustive`, `containedctx`, `fatcontext`, `sqlclosecheck`, `rowserrcheck`, `loggercheck`, `asciicheck`, `bidichk`, `intrange`, `usestdlibvars`, `copyloopvar`, `durationcheck`, `reassign`, `exptostd` | нет | есть | Взять; `funlen`/`gocyclo` могут ударить по обработчикам — порог оставить ассетный, превышение — рефакторинг, не `nolint` |
| `wrapcheck`, `err113`, `mnd`, `varnamelen`, `exhaustruct`, `gochecknoglobals`, `gochecknoinits`, `testpackage`, `lll` | нет | выключены явно | Согласны |
| `exclusions.presets: [comments, std-error-handling]`; `errcheck` off в тестах | есть | нет | Взять из 2.0 — иначе каждая `defer rows.Close()` и комментарий без точки = issue |
| `run.build-tags` | `e2e`, `keycloak` | нет | Добавить `integration isolation concurrency` |
| `gochecknoinits` выключен в ассете | — | — | Т.е. линт **не** запретит `init()`; запрет — только текст скилла `golang-design-patterns` (см. 4.7) |

### 4.12. `golang-security` (`skills/golang-security/SKILL.md`, `references/cookies.md`)

| Правило | Для плана |
|---|---|
| Три вопроса (trust boundary / что контролирует атакующий / blast radius); STRIDE+DREAD | = `design/docs/15-quality-security.md:52–63` |
| `gosec` SAST (`go tool gosec`), `govulncheck` (зависимость скилла), `go test -race`, fuzz | В CI; на dev-машине `-race` нет (cgo) |
| `crypto/rand`; argon2id/bcrypt; AES-GCM; `subtle.ConstantTimeCompare` для секретов | 2.0 уже: argon2id, decoy-хеш, HMAC под pepper для OTP (`2.0/apps/api/CLAUDE.md:721–725`), `ConstantTimeCompare` в CSRF |
| Path traversal: `os.Root` (Go 1.24+) | Для выдачи файлов/экспорта |
| Cookies: session **MUST** `HttpOnly`, `Secure` в проде, `SameSite Lax/Strict` | 2.0 `HttpOnly, SameSite=Lax`; CSRF-cookie **не** HttpOnly с `//nolint:gosec // …` — обоснование есть (`middleware.go:160–171`) |
| Не доверять клиентским заголовкам (`X-Forwarded-*`) | 2.0 `TRUSTED_PROXY_CIDRS`; дизайн: «Клиентский tenant_id … не предоставляет доступ» |
| «Binding to 0.0.0.0 — Medium» | ⚠ 2.0 `HTTP_ADDR=:8080` (все интерфейсы); compose публикует порты на `127.0.0.1` — в 3.0 задать `HTTP_ADDR=127.0.0.1:8080` по умолчанию в dev |
| Rate limiting `x/time/rate`; серверные таймауты | 2.0: `HTTP_READ/WRITE/IDLE_TIMEOUT`, `RateLimiter` на вход |
| Audit mode: правка в отдельном worktree на находку | = `EnterWorktree` в allowed-tools |

### 4.13. `golang-swagger` (`skills/golang-swagger/SKILL.md`)

Скилл описывает **swaggo/swag**: аннотации `@Summary/@Param/@Success/@Router/@Security` в комментариях обработчиков, `swag init` генерирует `docs/swagger.json` **из кода** (`:40–47, 109–129`); применяется «when the codebase imports github.com/swaggo/…» (`:3`).

⚠ **Прямой конфликт** с contract-first дизайна: «Изменение начинается с PR в `api/openapi/ortus.yaml`… `make gen` → Go-интерфейсы, TS-клиент… CI падает при дрейфе» (`design/docs/14-engineering.md:55–61`); OpenAPI 3.1 с `jsonSchemaDialect` (`design/docs/v0.1/ortus-openapi-v0.1.yaml:1–2`) — swag генерирует Swagger 2.0/OpenAPI 3.0, не 3.1. **Решение для плана: swaggo не подключать; скилл не триггерится, пока нет импорта `swaggo`.** Swagger UI (если нужен) — отдавать `api/openapi/ortus.yaml` статикой, не генерировать. Записать в `CLAUDE.md`: «OpenAPI — источник; `golang-swagger` не применяется».

### 4.14. `heroui-react` (`skills/heroui-react/SKILL.md`)

| Факт скилла | Строки |
|---|---|
| HeroUI v3 = **Tailwind CSS v4 обязателен** + React Aria Components; `npm i @heroui/styles @heroui/react tailwind-variants` | 11, 120, 174 |
| Без провайдера; compound-компоненты `Card.Header`; **`onPress`, не `onClick`**; `@import "tailwindcss"` затем `@import "@heroui/styles"` | 23–57, 172–177 |
| Семантические варианты `primary/secondary/tertiary/danger/ghost/outline`; «Don't use raw colors» | 189–200 |
| Тема — CSS-переменные в **oklch** (`--accent`, `--background`, `--foreground`); переключение `<html class="dark" data-theme="dark">` | 206–234 |
| Документация — по сети (`heroui.com/docs/react/components/*.mdx`, `mcp-api.heroui.com` в `scripts/get_theme.mjs:12`) | 74–111 |

Против дизайна: `@ortus/ui` — собственный пакет на токенах `--ox-*` (hex, `Golos Text`, `IBM Plex Mono`, радиусы 6/8/10/12/999, контролы 44/48/32 px, `design/docs/design-system/tokens.css:1–45`), headless Radix/React Aria для a11y, «Одна библиотека, без смешивания» (`14-engineering.md:17`); контракт 27 компонентов с пропсами (`Button.disabledReason`, `SyncState` с пятью состояниями, `AccessGate{module_off|module_readonly|no_permission|no_scope}`, `DataTable mobile="cards"`, `AppShell` sidebar ≥ 1080 / rail 640–1079 / bottom < 640, `design/docs/design-system/components.md:17–44`); «Чего нет в системе: градиенты, тени на карточках в покое, эмодзи, … более одного акцентного цвета» (`:56`). Прототип рисует всё инлайн-стилями (`design/README.md:34`), и `plan/verification-protocol.md:45` требует `maxDiffPixelRatio: 0.01`.

**Вердикт**: HeroUI как основа несовместима с пиксельной сверкой (свои BEM-стили, oklch-тема, свои радиусы `--radius-full: 9999px`, `scripts/get_theme.mjs:16–24`) и с правилом «одна библиотека». Варианты для ADR в плане: (а) `@ortus/ui` на **React Aria Components** (та же a11y-основа, что у HeroUI) + Tailwind v4 утилиты + `--ox-*` — скилл `heroui-react` не применяется; (б) HeroUI v3 с полностью переопределённой темой — риск несовпадения с эталоном и `onPress`-API. Рекомендация — (а); скилл остаётся как справочник по React Aria паттернам. Tailwind v4 в любом случае — помнить ловушки `rounded-full`/`max-*` (§3.6).

### 4.15. `vercel-react-best-practices` (`skills/vercel-react-best-practices/SKILL.md`, `rules/_sections.md`)

70 правил в 8 категориях, приоритет: `async-` (CRITICAL) → `bundle-` (CRITICAL) → `server-` (HIGH) → `client-` → `rerender-` → `rendering-` → `js-` → `advanced-` (`:25–34`).

| Группа | Применимость в Vite SPA |
|---|---|
| `async-parallel`, `async-defer-await`, `async-cheap-condition-before-await`, `async-dependencies` | **Да** (адаптер API, загрузчики TanStack Router) |
| `async-suspense-boundaries`, `async-api-routes` | Частично (Suspense — да; API routes — нет, бэкенд Go) |
| `bundle-barrel-imports`, `bundle-conditional`, `bundle-preload`, `bundle-analyzable-paths` | **Да** — особенно для `@ortus/ui` (barrel `index.ts` тянет всё) и модулей-экранов |
| `bundle-dynamic-imports` (`next/dynamic`), `bundle-defer-third-party` | Переписать на `React.lazy`/`import()` |
| `server-*` (10 правил: `server-auth-actions`, `server-cache-react`, `server-after-nonblocking`, `server-serialization`, …) | **Нет** — RSC/Server Actions отсутствуют |
| `client-swr-dedup` | Эквивалент — TanStack Query (`14-engineering.md:16`) |
| `client-localstorage-schema`, `client-event-listeners`, `client-passive-event-listeners` | **Да** — офлайн-черновики PWA (`02-architecture.md:245`) |
| `rerender-*` (15), `rendering-conditional-render` (тернарник, не `&&`), `rendering-content-visibility`, `rendering-activity`, `rendering-usetransition-loading` | **Да** |
| `rendering-hydration-no-flicker`, `rendering-hydration-suppress-warning`, `rendering-resource-hints`, `rendering-script-defer-async` | Нет / частично (SSR нет) |
| `js-*` (14), `advanced-*` (4) | Да, низкий приоритет |

Для плана: в `frontend/CLAUDE.md` объявить применимое подмножество; ревьюер (`plan/verification-protocol.md:70`) проверяет по нему, а не по всем 70.

### 4.16. `requesting-code-review` (`skills/requesting-code-review/SKILL.md`, `code-reviewer.md`)

| Правило | Строки | Для плана |
|---|---|---|
| Обязателен после каждой задачи в subagent-driven разработке, после фичи, перед merge | 14–18 | = `plan/orchestration.md:34` (1 ревьюер на WS, 2 для authz/миграций/финансов) |
| Диспатч `general-purpose` субагента с шаблоном `code-reviewer.md`, плейсхолдеры `{DESCRIPTION} {PLAN_OR_REQUIREMENTS} {BASE_SHA} {HEAD_SHA}`; ревьюер получает **только** крафтовый контекст, не историю сессии | 32–46, 75–80 | = `orchestration.md:53` («только отчёт исполнителя и бриф») |
| Ревьюер read-only, не двигает HEAD, не спавнит субагентов; раздел «Declined to judge»; «spec is a vision document — reasonable person's expectation is a requirement» | `code-reviewer.md:33–61` | В `reviewPrompt(ws, verdicts)` |
| Выход: Strengths / Issues (Critical · Important · Minor с file:line) / Recommendations / Assessment «Ready to merge? Yes · No · With fixes» | `code-reviewer.md:106–135` | Формат вердикта |
| Critical — чинить сразу; Important — до продолжения; возражать с техническим обоснованием | 42–46 | Счётчик итераций ≤ 3 (`orchestration.md:53`) |
| `BASE_SHA=$(git rev-parse HEAD~1)` | 27–30 | bash; в PowerShell `$base = git rev-parse HEAD~1` |

### 4.17. `golang-data-structures` (`skills/golang-data-structures/SKILL.md:34–41`)

Преаллокация `make(T, 0, n)`; не зависеть от алгоритма роста; `container/heap` для очередей приоритета; `strings.Builder` для строк; generics с минимальным constraint; `unsafe.Pointer` только по 6 паттернам; `weak.Pointer` (1.24+) для кешей; `map[K]*V` для больших значений. Низкое влияние на план; актуально для LRU пулов тенантов (2.0 брал `hashicorp/golang-lru/v2`) и кеша прав.

---

## 5. Инварианты и правила

Правила, которые реализация 3.0 должна держать (источник в скобках).

1. **Один 404 на «нет», «чужое», «архив», «модуль выключен» — байт в байт, включая завершающий `\n`** (`2.0/docs/platform-spec.md:463`; `2.0/apps/api/CLAUDE.md:1196–1204`; OpenAPI: «Foreign and invisible object IDs return the same 404»).
2. **Членство проверяется до состояния организации/тенанта** (A3; `steps.go:46–48`).
3. **База тенанта открывается только после проверки права**; отказ не занимает соединение из пула (`platform-spec.md:457`).
4. **Модуль видит только контракт платформы** — `depguard` strict allow-list, тест изоляции организаций **и** единиц обязателен в CI (`module-rules.md:20–25, 133–135`; `platform-spec.md:541–551`; `design/docs/15-quality-security.md:11`).
5. **`DB()` не отдаёт голый пул** под pgbouncer transaction pooling (`2.0/apps/api/CLAUDE.md:1215–1220`).
6. **Сессия — HttpOnly cookie, не JWT в localStorage** (`design/docs/v0.1/02-architecture.md:82`; `2.0/apps/api/CLAUDE.md:726–731`); отказ на любую причину — один (`steps.go:19–23`); 302/401 по `Accept`.
7. **CSRF double-submit** на мутациях + проверка `Origin` (OpenAPI описание; `middleware.go:100–136`); cookie токена **не** HttpOnly — с `//nolint:gosec // …`.
8. **`next`/redirect — только однозначный путь** (`2.0/apps/api/CLAUDE.md:1232–1235`).
9. **Клиент не считает то, что считает сервер** (`module-rules.md:54, 300–301`; дизайн смягчает: preview/форматирование допустимы, авторитет — сервер, `02-architecture.md:364`).
10. **Текст ошибки для пользователя выбирается по `code`, поле — по `violations[].field`**, никогда по подстроке сообщения (`client.ts:23–34`; `design/docs/12-errors-and-events.md:23`).
11. **Контракт меняется отдельным маленьким PR, вливается первым** (`module-rules.md:148–150`; `plan/orchestration.md:85`).
12. **Красный тест — первый коммит ветки**; `test(<scope>)` → `feat(<scope>)`; не ослаблять и не удалять красный тест (`module-rules.md:212–214, 307`; `plan/tdd-protocol.md:9–14`).
13. **e2e страницы пишет не автор страницы; проверяющий страницы — не исполнитель** (`module-rules.md:302`; `plan/orchestration.md:33`).
14. **Два ответа на один инвариант — двум авторам** (`ws/README.md:41–44, 180–182`).
15. **Карта владения = `git diff --name-only <base>`**; файл вне карты возвращается автору (`module-rules.md:204`).
16. **Общие файлы правит только интегратор**: контракт, CI, compose, `go.mod`, корневой `package.json`, `.golangci.yml`, `CLAUDE.md` layout-блоки, `design/` (`platform-plan.md:564–567`; `orchestration.md:85`).
17. **Цвета — только через переменные токенов**; хексы макета в код не переносятся; e2e проверяет, что каждый непрозрачный цвет равен токену на `:root` (`module-rules.md:167`; `2.0/apps/web/CLAUDE.md:662–666`).
18. **Один DOM на все пороги**, переключение раскладки — CSS `@media`, не JS и не второй рендер (`module-rules.md:346–350`).
19. **`rounded-full` → `rounded-[999px]`; `max-[N]` эксклюзивен; `@media (max-width: N)` инклюзивен** (`2.0/CLAUDE.md:192–198`).
20. **Даты в тестах — от `time.Now()` или `WithClock`**, обход исходников e2e ловит литералы (`2.0/CLAUDE.md:184–191`).
21. **Размеры и цвета — только в Playwright** (jsdom без раскладки); пиксельные снимки — per-platform baseline + структурная сверка текстов (`2.0/apps/web/CLAUDE.md:1002–1004`; `plan/verification-protocol.md:41–48`).
22. **`//nolint` — только с линтером и причиной**; `gosec`/`bodyclose`/`sqlclosecheck` не глушатся (`golang-lint:89–94`).
23. **Ошибки оборачиваются `%w`, lowercase; логировать или возвращать** (`golang-error-handling:40–46`).
24. **`ctx` первым, ключи контекста — unexported типы, `WithoutCancel` для outbox/audit после ответа** (`golang-context:31–39`).
25. **Коммиты через `git commit -F <файл без BOM>`**, без `--no-verify`, при падении хука — новый коммит (`2.0/CLAUDE.md:170–177`; `git-commit:118–124`).
26. **Документация структурного изменения — в том же коммите**; «Not set up yet» удаляется, когда вещь появилась (`2.0/CLAUDE.md:221–261`).
27. **Playwright MCP недоступен → WS не закрывается**, это блокер интегратору (`verify-structure.SKILL.md:55–57`; `plan/verification-protocol.md:65`).
28. **Зависимость — строка в таблице «что покупает»** (`2.0/apps/api/CLAUDE.md:148–165`; D9).
29. **Секреты и `DATABASE_URL`/`CONTROL_DB_URL` — без умолчаний**; `.env` не коммитится (`2.0/apps/api/CLAUDE.md:274–279`; `git-commit:83`).
30. **Логи без токенов, тел форм, фото, сумм начислений**; `request_id, tenant_id, actor_id` обязательны (`design/docs/14-engineering.md:114`).

---

## 6. Чек-лист приёмки (инфраструктура, харнесс, протокол)

Формулировки Given/When/Then для тестов и проверок волны 0 (репозиторий, CI, харнесс). Селекторы и строки — дословно.

**Playwright MCP**

1. Given `.mcp.json` с `"command": "node"`, `"args": ["node_modules/@playwright/mcp/cli.js", "--browser", "chromium", "--headless", "--output-dir", ".playwright-mcp"]`, devDependency `"@playwright/mcp"` с точной версией и выполненный `npm run mcp:install`; When стартует сессия Claude Code; Then в списке инструментов есть `mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_click`, `browser_resize`, `browser_console_messages`, `browser_network_requests`, `browser_take_screenshot`.
2. Given запущен `node tools/design-preview.js design 4173`; When `browser_navigate` на `http://127.0.0.1:4173/Ортус%20CRM.dc.html`; Then `browser_snapshot` содержит регион с `aria-label="Панель демонстрации"`, и ответ **не** содержит `Browser "chrome-for-testing" is not installed`.
3. Given `.playwright-mcp/` в `.gitignore`; When MCP сделал снимок; Then `git status --porcelain` не показывает файлов из `.playwright-mcp/`.

**Браузерная сюита**

4. Given `playwright.config.ts` читает `PORT` из окружения и строит `baseURL`/`webServer.url` из него; When `$env:PORT = "3001"; npm run e2e -- --list`; Then вывод содержит адрес `127.0.0.1:3001` и ни один файл `e2e/**/*.spec.ts` не содержит литерала `:5173` или `:3000` (grep-тест в сюите, по образцу `2.0/docs/ws/fleet-f5.md:66–69`).
5. Given проекты `mobile-390` (390×844, `isMobile: true, hasTouch: true`), `tablet-768`, `desktop-1440`; When `npx playwright test --list`; Then каждый `e2e/<page-key>.spec.ts` присутствует под `mobile-390` и `desktop-1440`.
6. Given `reporter: [["list"], ["html", { "open": "never" }]]`; When сюита запущена неинтерактивно и завершилась; Then процесс завершился сам (нет ожидания браузера с отчётом).
7. Given `webServer.reuseExistingServer = !process.env.CI`; When на порту уже поднят dev-сервер; Then сюита подключается к нему, а в CI (`CI=1`) — стартует свой.
8. Given spec `e2e/visual/<page-key>.visual.spec.ts` с `toHaveScreenshot`; When запуск на Windows и на Linux; Then baseline лежит в разных путях (`snapshotPathTemplate` содержит `{platform}`), и запуск на второй платформе не падает из-за отсутствующего снимка первой без явного `--update-snapshots`.
9. Given spec `e2e/visual/<page-key>.labels.spec.ts`; When собраны тексты `button, a, h1, h2, h3, label, [aria-label]` на эталоне `4173` и в реализации; Then массивы равны по порядку и дословно (включая «ё» и знаки препинания).
10. Given мок-режим (`VITE_ADAPTER=mock`); When страница грузится; Then `browser_network_requests`/`page.on('request')` не содержат хостов кроме `localhost:<PORT>` и шрифтов из allowlist.

**Go харнесс и линт**

11. Given `docker compose --profile test up -d --wait postgres-test` **не** выполнен; When `go -C backend test -tags=integration ./test/...`; Then тесты **падают** (не skip) с текстом, содержащим `start it with` и команду запуска базы (`harness.go:57–59, 78`).
12. Given база поднята; When тот же запуск; Then `TestMain` применяет миграции `migrations/control/*.up.sql` и `migrations/tenant/*.up.sql` лексикографически и все тесты параллельны (`t.Parallel()`), каждый — на уникальном идентификаторе тенанта/аккаунта, без `TRUNCATE`.
13. Given `.golangci.yml` `version: "2"` с `run.build-tags: [integration, isolation, concurrency]`; When `golangci-lint config verify` и `golangci-lint run ./...` из `backend/`; Then exit 0.
14. Given `depguard` правило для `internal/modules/**`; When тестовый модуль импортирует `internal/control`; Then `golangci-lint run` красный; When импортирует только `internal/platform/module` и `pgx/v5` — зелёный (обе стороны, как `2.0/CLAUDE.md:163–165`).
15. Given тест-обход `backend/test/**`; When в файле есть литерал даты после `-until`/в `WithClock`; Then тест красный (`TestE2EWallClockDatesAreDerived`-аналог).
16. Given неизвестный тенант, чужой тенант, выключенный модуль, несуществующий роут; When четыре запроса; Then четыре тела ответа 404 равны **байт в байт** (`bytes.Equal`, без `TrimSpace`).

**Контракт**

17. Given `api/openapi/ortus.yaml`; When `make gen`; Then `git diff --exit-code backend/internal/api frontend/packages/api-client` пуст; When в YAML добавлена операция без `x-permissions` из `api/permissions.yaml`; Then Spectral/проверка каталога красная.
18. Given ответ ошибки; When любой 4xx/5xx; Then `Content-Type: application/problem+json`, тело содержит `code`, `requestId`, `status`; `code` ∈ реестру `design/docs/12-errors-and-events.md:28–65`.

**Хуки и коммиты**

19. Given `.husky/pre-commit` = `npx lint-staged` (или `pnpm lint-staged`); When staged `.go` с неотформатированным кодом; Then коммит содержит файл после `gofmt -w`; When staged `.ts`; Then после `prettier --write` и `eslint --fix`.
20. Given `.claude/settings.json` с `PostToolUse` на `Write|Edit` и `"shell": "powershell"`; When агент записал `.go`/`.ts` файл внутри репозитория; Then файл отформатирован, а хук вернул 0 даже при ошибке форматтера.
21. Given ветка WS; When `git log --reverse --format=%s main..HEAD`; Then первая строка начинается с `test(` и перед первым `feat(` есть хотя бы один `test(`.
22. Given файл сообщения коммита создан через `[System.IO.File]::WriteAllText(…, UTF8Encoding $false)`; When `git commit -F`; Then `git log -1 --format=%s` не начинается с BOM (`EF BB BF`).

**Сессия и CSRF (при реализации BFF)**

23. Given успешный вход; When читаем `Set-Cookie`; Then есть `HttpOnly`, `SameSite=Lax`, `Path=/`, имя `ortus_sid`; `Secure` присутствует при HTTPS/`X-Forwarded-Proto: https`.
24. Given мутация без `X-CSRF-Token`; When `POST`; Then 403 с `code: "csrf_failed"`; Given `GET`; Then `Set-Cookie` с CSRF-токеном **без** `HttpOnly`.
25. Given неверный пароль/неизвестный логин (если `local` остаётся) — When два запроса; Then равны статус, `code`, `detail`; cookie не ставится; тело не содержит пароля.

---

## 7. Открытые вопросы

1. **Тенант в хосте или в пути?** 2.0 — `{org}.platform.localhost` (A4/D3/D4) с cookie на зону и без CORS; дизайн не формулирует правило о хосте, `.env.example` даёт один origin `http://localhost:5173` и `OIDC_REDIRECT_URL` на него. ⚠ не найдено в источниках. Нужен ADR до волны 0 (влияет на Vite proxy, Keycloak redirect, Playwright `baseURL`).
2. **Провайдер `local` (телефон + пароль)** — есть в 2.0 с 33 e2e и прод-защитой, нет в дизайне (D-03 Keycloak OIDC). Оставить для dev/e2e фазы 1 или удалить? Если удалить — Go-тесты входа идут через `oidctest`.
3. **HeroUI v3 vs `@ortus/ui` на React Aria** — §4.14; рекомендация (а). Решение владельца продукта/tech lead.
4. **`toHaveScreenshot` на Windows-dev + Linux-CI** — протокол 3.0 требует, 2.0 запретил по опыту. Решение: per-platform baselines + обязательная структурная сверка; подтвердить.
5. **Миграции**: goose (D-06) + контроллер из 2.0 + линтер префикса схемы — кто пишет SQL новых таблиц модулей, если `golang-database` говорит «только люди»? Предложение: агент пишет по `10-data-model.md`, CODEOWNERS-ревью обязателен.
6. **`init()`-саморегистрация** (2.0) vs «avoid `init()`» (скилл) — §4.7; рекомендация: явный реестр.
7. **Интерфейсы-в-фундаменте** vs «определять у потребителя / не заранее» — §4.8; записать company override в `CLAUDE.md`.
8. **Версии**: Go (1.25 vs 1.26 расходятся даже внутри 2.0), PostgreSQL (17 compose vs 16.4 проверено), Node 22, pnpm vs npm — D-04 не закрыт.
9. **testcontainers-go vs compose `postgres-test`** — для `integration` первый, для стенда/e2e второй; подтвердить, что Docker API доступен из Go на dev-машине.
10. **Хранение `verify-<page>` скиллов**: `.claude/skills/` в git (3.0) или `.agents/skills` + junction (2.0); либо вообще промпт без скилла (`orchestration.md:46`).
11. **Keycloak в e2e фазы 2** (`verification-protocol.md:36`) — JVM ~1 ГБ, 2.0 держал его только под smoke-тегом; оценить время старта compose-профиля `e2e`.
12. **Аудит: control DB (D12) или tenant DB (`tenant_0001_core.sql` по `design/docs/README.md:11`)?** ⚠ не сверено с SQL в этом отчёте.
13. **Приглашения**: 8-буквенный код (D10) или токен-ссылка (`02-architecture.md:80`)?
14. **`samber/lo`, `samber/oops`, `testify`, `goleak`** — четыре зависимости, которые скиллы рекомендуют, а 2.0 не брал; каждая — строка в таблице D9.
15. **CI-платформа (D-02)** — в 2.0 CI не было; без неё `-race`, `govulncheck`, Schemathesis не выполняются нигде.
16. **Module path** Go-модуля (`github.com/<org>/<repo>/backend`) — 3.0 не git-репозиторий, remote неизвестен.
17. **`HTTP_ADDR`** по умолчанию `:8080` (2.0) vs «не биндить 0.0.0.0» (скилл security) — задать `127.0.0.1:8080` в dev.

---

## 8. Факты для плана

1. 3.0 сейчас содержит только `.claude/skills` (17), `design/`, `docs/plan/{orchestration,tdd-protocol,verification-protocol}.md`, `tools/{design-preview,design-strip-injected,design-unpack-bundle}.js`, `skills-lock.json`; нет git, `package.json`, `.mcp.json`, `.claude/settings.json`, compose, CI.
2. Pinned-версии 2.0, с которых стартовать: `@playwright/mcp 0.0.78`, `@playwright/test ^1.62.1`, `vitest ^5.0.0`, `vite ^8.2.2`, `tailwindcss ^4`, `react 19.2.8`, `typescript ^5`, `eslint ^9`, `prettier ^3.4.2`, `husky ^9.1.7`, `lint-staged ^15.4.3`, `pgx/v5 v5.10.0`, `go-oidc/v3 v3.21.0`, `minio-go/v7 v7.3.0`.
3. Dev-машина: Windows 11, PowerShell 5.1, без gcc (нет `-race`), `HTTP_PROXY` экспортирован, `core.autocrlf=true`, Docker Desktop есть (compose работал в 2.0).
4. Playwright MCP и `@playwright/test` держат **два разных браузера** — два install-шага в onboarding волны 0.
5. `.mcp.json`/`.claude/settings.json` читаются на старте — агент-интегратор перезапускает сессию после их появления.
6. `PORT` на фронтовый WS: исполнители 3001…300N, e2e/интегратор 3000 (или 5173+N для Vite) — `reuseExistingServer` иначе подцепит чужой код.
7. Go-тесты с базой — префикс `Test<WS>` в имени, если одноразовая БД строится из `t.Name()`.
8. `.golangci.yml` v2: объединить ассет скилла и 2.0 — **вернуть `depguard`**, `exclusions.presets`, `build-tags`; `gochecknoinits` в ассете выключен.
9. Контракт-first: `api/openapi/ortus.yaml` (3.1) → `oapi-codegen` strict server + `openapi-typescript`/`openapi-fetch`; `golang-swagger` не применяется; MSW из примеров контракта.
10. Формат ошибки — RFC 9457 с `code` из реестра 36 кодов; `ApiError` клиента 2.0 переписывается под `violations[]`.
11. Конвейер 2.0 (7 + 2a/2b шагов, маркер монтирования, один 404) — переносится как `internal/platform/pipeline` поверх сгенерированного `Handler`.
12. Middleware 2.0 (`RequestID → Logging(AddAttrs) → CSRF`) — переносится; в 2.0 так и не была смонтирована — в 3.0 тест на старте.
13. Сессия: серверная, `ortus_sid`, 12h (дизайн) vs 168h (2.0); механика `session.Manager` + одна ошибка на все отказы — из 2.0.
14. Волна 0 должна положить: контракт, токены `--ox-*`, список компонентов `@ortus/ui` с пропсами (`components.md`), типы домена, сид демо-холдинга (`design/ortus/mock-data.js`: 3 региона × 4 фирмы, `Р-208`, `m-kotova`, `t-alta`, `t-lotos`), e2e-харнесс с тремя проектами, превью эталона на 4173, CI.
15. S0 волны в 2.0 шла тремя агентами и проходила ревью (39 замечаний) **до** старта потоков — заложить ревью S0/волны 0 в DAG.
16. Бриф — девять разделов; запуск — один промпт с подстановкой WS и порта; worktree на WS с `npm install`/`pnpm install` в каждом.
17. Интегратор вливает rebase'ом в порядке DAG, снимает `fixme`/`t.Skip`, гоняет полную сюиту на дефолтном порту, проходит MCP-чеклист, пишет «Что разошлось с планом».
18. Проверяющий страницы ≠ исполнитель; e2e-WS ≠ авторы экранов; две стороны инварианта ≠ один автор.
19. Пиксельная сверка — per-platform baseline; структурная сверка текстов обязательна; `maxDiffPixelRatio: 0.01`; шрифты Golos Text / IBM Plex Mono / Material Symbols Rounded — локальные копии в CI.
20. Иконка-лигатура: тест держит класс `.icon` и `font-family`, не `textContent`.
21. Tailwind v4: `rounded-[999px]`, `min-[1025px]:` вместо `lg:` там, где порог 1024 inclusive; пороги прототипа 640/1080 и проекты 390/768/1440.
22. Демо-«сегодня» = 1 октября 2026 (`design/README.md:163`) — в тестах время инъектируется, не литерал.
23. Keycloak: только профиль compose, не в unit/integration; `oidctest` для Go; realm импортируется при каждом старте.
24. `minio-init`/`seed` — одноразовые контейнеры вне `--wait`.
25. Коммиты: `git commit -F <файл без BOM>`; формы `test(ws-NN): …` → `feat(ws-NN): …` → `refactor(ws-NN): …`; `docs(ws)`, `chore(claude)` для скиллов/хуков.
26. Ревью: субагент по `code-reviewer.md` с `BASE_SHA/HEAD_SHA`; выход «Ready to merge? Yes/No/With fixes»; второй ревьюер для `authz`, `migrations`, финансов, `permissions.yaml`.
27. Документация в том же коммите: таблица «файл → что протухает» (корневой `CLAUDE.md`, `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `.env.example`, `api/openapi`, `docs/adr`, `docs/plan/ws`).
28. ADR 2.0, которые переносятся как есть: A1, A2, A3, A5, A7, A8, A9, A12, D2, D9, D17, D19, D20; требуют ADR в 3.0: A4/D3/D4, A5a/D1, D6, D10, D12, D13, D14, D18.
29. Скиллы, на которые ссылаются Go-скиллы, но которых нет (18 имён, §4) — ссылки игнорируются; директиву `golang-how-to` в `CLAUDE.md` не писать.
30. Все числа и пороги прототипа (`--ox-control: 44px`, `--ox-header: 58px`, `md 44 / lg 48 / compact 32`) — из `tokens.css` и `components.md`, не из HeroUI-темы.
