# Отчёт: выход этапа 0 «Подготовка»

- stage: 0 · проверяющий выхода и критик полноты · mode: stand (слот 9) + `ci:local`
- main: `a47dd79` (docs(plan): статус W0.09), 15 тегов `stage-0-*`, `design-2026-10-03`, `design-stage-1`
- Дата прогона: 2026-10-15, Windows 11, Node 22.19.0, Go 1.26.0, Docker 27.4.0, pnpm 9.15.9
- Критика полноты: [../critique/stage-0.md](../critique/stage-0.md)

## Вердикт

**Выход из этапа 0 не пройден.** Из шести пунктов критерия (план v2 §4) выполнены 3 (Storybook, скелет изоляции, ADR). Ещё 2 пункта (`/me/context` сквозь стек и зелёный CI) выполнены только локальным эквивалентом CI (`ci:local`), потому что GitHub Actions ни разу не запускался. Один пункт (MSW) не выполнен: W0.12 и W0.13 не влиты.

Что блокирует:

1. **MSW отвечает на операции этапа 1 — не выполнено.** W0.12 (домен пилота и сид) не начат, W0.13 (MSW-сценарный сервер) не начат, потому что ждёт W0.12. `frontend/packages/adapter/src/index.ts` — заглушка `@stub Owner: W0.13` (`export {};`), в репозитории нет ни одного импорта `msw`. Брифов `docs/plan/v2/ws/W0.12.md` и `W0.13.md` тоже нет.
2. **«В CI» не подтверждено на CI.** У репозитория нет git remote (`git remote -v` пуст), поэтому `.github/workflows/ci.yml` на GitHub не запускался, а защиту `main` (7 обязательных job) настроить нельзя. Блокер W0.04 из `status.md` не снят. Все job зелёные только в локальном эквиваленте `corepack pnpm run ci:local`: там те же шаги, что в workflow (`tools/ci/pipeline.mjs`).
3. **Браузерный путь `/me/context` в CI не проходит.** Job `e2e` в CI работает в режиме `mock`, и все 9 тестов `me-context.spec.ts @stand` в нём пропущены (`test.skip`: «нужен стенд»). В CI сквозной путь проверяет только Go integration-тест `cmd/api/stack_integration_test.go` (testcontainers: HTTP-клиент с cookie → dev-вход BFF → шлюз → control DB → tenant DB, проверка права), без браузера. Браузерный путь подтверждён на стенде вручную (ниже).

## Что сделано на этапе 0

| WS | Что влито | Тег |
|---|---|---|
| W0.00 | Протоколы v2, перенумерация D-13…D-52 → PD- | `stage-0-W0.00` |
| W0.01 | ADR-0001 (принят), ADR-0002…0013 = D-01…D-12 (предложено), журнал D-29…D-34, PD-53…PD-60 | `stage-0-W0.01` |
| W0.02 | Эталон 14.10 (частичный, B-1), анализы 01–04, `design-requests.md` (B-6) | `stage-0-W0.02`, `design-stage-1` |
| W0.03 | Репозиторий, workspace, `go.mod`, Makefile, CODEOWNERS, шаблоны PR/ADR, husky | `stage-0-W0.03` |
| W0.04 | CI: 7 job, `tools/ci/pipeline.mjs`, проверки контракта, прав, миграций | `stage-0-W0.04` |
| W0.05 | e2e-kit, Playwright, `design-preview --offline/--ref`, `.mcp.json`, verify-pages, allowlist-lint | `stage-0-W0.05` |
| W0.06 | Стенд compose, goose-миграции (control 0001–0003, tenant 0001–0002), роли БД, Go-сид | `stage-0-W0.06` |
| W0.07 | OpenAPI 0.1 по тегам, `errors.yaml`, `permissions.yaml`, Spectral | `stage-0-W0.07` |
| W0.08 | Контракт 0.3.0-stage1 (143 операции), миграции tenant 0003–0006, ADR-0014 | `stage-0-W0.08` |
| W0.09 | `gen`, `cmd/api` со шлюзом, платформа BFF (dev-сессия), каркас `apps/web`, `GET /me/context` | `stage-0-W0.09` |
| W0.10 | `@ortus/tokens`, шрифты, 6 компонентов `@ortus/ui` в Storybook | `stage-0-W0.10` |
| W0.11 | Ядро домена v2 (`Scope`, `Clock`, `IdGen`, ошибки, `access/can` с PD-53, `TaskPort`, `DomainModule`) | `stage-0-W0.11` |
| W0.14 | `@ortus/texts` этапов 0–2 | `stage-0-W0.14` |
| W0.15 | Скелет набора изоляции, `isogen`, `me.yaml` | `stage-0-W0.15` |
| W0.16 | Нагрузочный профиль (D-08 — заглушки), каркас k6 | `stage-0-W0.16` |
| W0.12 | **не начат** | — |
| W0.13 | **не начат** (ждёт W0.12) | — |

## Прогоны

Все прогоны — на чистом `main` `a47dd79`. До прогонов и после них `git status --short` пуст, то есть `gen` не дал дрейфа и прогоны не оставили файлов.

### 1. `corepack pnpm install --frozen-lockfile`

```text
Scope: all 9 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date

. prepare$ husky
. prepare: Done
Done in 1.1s using pnpm v9.15.9
EXIT 0
```

### 2. `corepack pnpm run ci:local` (= `node tools/ci/pipeline.mjs --all`), exit 0

Маркеры шагов, дословно:

```text
▶ lint/lint: pnpm run lint
✔ lint/lint
▶ lint/actionlint: docker run --rm -v D:\work\test26042026_Kirill_3.0:/repo -w /repo rhysd/actionlint:1.7.12 -color
✔ lint/actionlint
▶ lint/spectral: pnpm run lint:api
✔ lint/spectral
■ lint: ок
▶ contract/openapi-validate: pnpm run validate:api
✔ contract/openapi-validate
▶ contract/permissions: node tools/ci/check-permissions.mjs
✔ contract/permissions
▶ contract/migrations: node tools/ci/check-migrations.mjs
✔ contract/migrations
▶ contract/codegen-drift: (проверка скриптом pipeline.mjs)
✔ contract/codegen-drift
■ contract: ок
▶ unit/check-icu: node tools/ci/check-icu.mjs
✔ unit/check-icu
▶ unit/typecheck: pnpm run typecheck
✔ unit/typecheck
▶ unit/test: pnpm run test
✔ unit/test
■ unit: ок
▶ integration/go-integration: go -C backend test -tags integration -count=1 ./...
✔ integration/go-integration
■ integration: ок
▶ isolation/go-isolation: go -C backend test -tags isolation -count=1 ./test/isolation/...
✔ isolation/go-isolation
⏭ isolation/go-concurrency: пропуск: нет backend/test/concurrency (владелец W2.30 (дорожка Т))
■ isolation: ок
▶ build/build: pnpm run build
✔ build/build
⏭ build/images: пропуск: нет Dockerfile в backend/, frontend/apps/, deploy/ (владелец W0.06, W0.09)
■ build: ок
▶ e2e/e2e: pnpm run e2e:install
▶ e2e/e2e: pnpm run e2e
✔ e2e/e2e
■ e2e: ок
конвейер: все job зелёные
EXIT 0
```

Внутри шагов, дословные строки итогов:

```text
All matched files use Prettier code style!
0 issues.
No results with a severity of 'error' found!
migrations: control 3, tenant 6 — ок
gen: 19 тегов → backend/internal/api, catalog, router.go, api-client — 24 файлов
✔ contract/codegen-drift
# tests 116 / # pass 116 / # fail 0          (tools/repo)
# tests 85 / # pass 85 / # fail 0            (tools/ci)
# tests 52 / # pass 52 / # fail 0            (tools/__tests__)
# tests 23 / # pass 23 / # fail 0            (deploy/compose)
# tests 119 / # pass 119 / # fail 0          (tools/gen)
frontend/packages/texts test: # tests 2116 / # pass 2116 / # fail 0
frontend/packages/e2e-kit test: # tests 57 / # pass 57 / # fail 0
frontend/packages/api-client test: # tests 7 / # pass 7 / # fail 0
frontend/packages/domain test:       Tests  226 passed (226)
frontend/packages/tokens test:       Tests  54 passed (54)
frontend/apps/web test:       Tests  15 passed (15)
frontend/packages/ui test:       Tests  87 passed (87)
```

Хвост job `integration` (`go test -tags integration -count=1 ./...`, testcontainers):

```text
ok  	github.com/ortus/ortus-crm/backend/cmd/api	24.721s
ok  	github.com/ortus/ortus-crm/backend/cmd/migrate	21.707s
ok  	github.com/ortus/ortus-crm/backend/cmd/seed	22.352s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/httpx	1.864s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/problem	0.955s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/requestid	1.300s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/session	1.060s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/session/dev	8.269s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/tenantctx	1.681s
ok  	github.com/ortus/ortus-crm/backend/internal/platform/tenantctx/mehttp	1.166s
ok  	github.com/ortus/ortus-crm/backend/migrations	34.549s
ok  	github.com/ortus/ortus-crm/backend/migrations/migratetest	20.416s
ok  	github.com/ortus/ortus-crm/backend/test	5.608s
?   	github.com/ortus/ortus-crm/backend/test/isolation	[no test files]
ok  	github.com/ortus/ortus-crm/backend/test/isolation/cmd/isogen	5.642s
ok  	github.com/ortus/ortus-crm/backend/test/isolation/fixtures	5.571s
ok  	github.com/ortus/ortus-crm/backend/test/isolation/matrix	5.642s
✔ integration/go-integration
■ integration: ок
```

Хвост job `isolation`:

```text
ok  	github.com/ortus/ortus-crm/backend/test/isolation	21.384s
ok  	github.com/ortus/ortus-crm/backend/test/isolation/cmd/isogen	2.708s
ok  	github.com/ortus/ortus-crm/backend/test/isolation/fixtures	14.934s
ok  	github.com/ortus/ortus-crm/backend/test/isolation/matrix	2.658s
✔ isolation/go-isolation
⏭ isolation/go-concurrency: пропуск: нет backend/test/concurrency (владелец W2.30 (дорожка Т))
■ isolation: ок
```

Хвост job `e2e` (режим `mock`, `Running 42 tests using 11 workers`):

```text
  -  38 [desktop-1440] › e2e\me-context.spec.ts:11:3 › GET /me/context сквозь стек @stand › владелец входит dev-провайдером и видит себя и «Альту»
  -  39 [desktop-1440] › e2e\me-context.spec.ts:17:3 › GET /me/context сквозь стек @stand › без входа — 401 и «Нужен вход»
  -  40 [desktop-1440] › e2e\me-context.spec.ts:25:3 › GET /me/context сквозь стек @stand › проверка права: listMembers — менеджеру 403, владельцу пропуск (501, тег не реализован)
  -  42 [desktop-1440] › e2e\_helpers\harness.spec.ts:135:3 › самотест харнесса › H11 app(route, { persona }) — dev-вход ?persona= (PD-54) @harness
  ok 29 [desktop-1440] › e2e\_helpers\harness.spec.ts:18:3 › самотест харнесса › H1 reference(file) открывает каждый .dc.html эталона @harness (16.5s)

  12 skipped
  30 passed (36.8s)
✔ e2e/e2e
■ e2e: ок
```

12 пропущенных тестов: `me-context.spec.ts` (3 теста × 3 проекта; режим `mock`, MSW нет) и H11 `fixme` W0.05 (× 3 проекта).

### 3. Изоляция подробно (`go -C backend test -tags isolation -count=1 -v ./test/isolation/`)

```text
=== RUN   TestSuiteIsWired
=== RUN   TestIsolationMe
=== RUN   TestIsolationMe/getMyContext
=== RUN   TestIsolationMe/getMyContext/anonymous→401
=== RUN   TestIsolationMe/getMyContext/a.owner→200
=== RUN   TestIsolationMe/getMyContext/a.driver-msk1→200
=== RUN   TestIsolationMe/getMyContext/b.owner→200
=== RUN   TestIsolationMe/getMyContext/b.manager-msk1→200
=== RUN   TestIsolationMe/getMyContext/ab.member→200
--- PASS: TestSuiteIsWired (0.05s)
--- PASS: TestIsolationMe (0.00s)
PASS
ok  	github.com/ortus/ortus-crm/backend/test/isolation	16.415s
EXIT 0
```

### 4. Проверки вне `ci:local` (интеграторский гейт `orchestration.md` §6)

```text
node --test "docs/adr/*.test.mjs"            → # tests 108 / # pass 108 / # fail 0
node --test "docs/plan/scripts/*.test.mjs"   → # tests 67 / # pass 67 / # fail 0
node docs/plan/scripts/renumber-decisions.mjs --check
  14  docs/plan/analysis/01-shell.md
   3  docs/plan/analysis/02-company.md
   8  docs/plan/analysis/03-logistics.md
осталось: 25 ссылок в 3 файлах
renumber EXIT 1
```

Гейт `renumber-decisions --check` красный и не входит в CI. Причина известна из W0.02: это ссылки D-23 из комплекта `design/docs/16-raid-glossary.md`, скрипт срабатывает на них ложно.

### 5. Storybook (`corepack pnpm --filter @ortus/ui exec storybook build --quiet -o <scratchpad>`)

```text
—  Storybook build completed successfully
EXIT 0
stories: 20
Core/Banner, Core/Button, Core/Card, Core/Dialog, Core/Field, Core/Status
```

Сборки Storybook нет ни в `build`, ни в CI: у `@ortus/ui` есть только скрипт `storybook:build`. В CI истории проверяет `frontend/packages/ui/src/__tests__/stories.test.ts` (unit).

### 6. Стенд и сквозной smoke `/me/context` (слот 9, `ortus-s9`)

Слот 10 не поднялся: на этой машине MinIO не смог занять порт 10000 (`10000 = 9000 + 100 × 10`).

```text
Error response from daemon: Ports are not available: exposing port TCP 127.0.0.1:10000 -> 0.0.0.0:0: listen tcp 127.0.0
.1:10000: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.
UP EXIT 1
```

Слот 10 остановлен (`down -v`) и заменён слотом 9. env-файл лежит вне репозитория (`stand.mjs init --slot 9 --env <scratchpad>\stand9.env`).

```text
 Container ortus-s9-otel-collector-1  Healthy
 Container ortus-s9-mailpit-1  Healthy
 Container ortus-s9-minio-1  Healthy
 Container ortus-s9-postgres-1  Healthy
UP EXIT 0
roles: ensured (ortus_migrator, ortus_api, ortus_worker, ortus_provisioner); ortus_control owner ortus_migrator
control: 0 → 3
tenants: 0 migrated (run migrate-793d1e67c75e7b16)
MIGRATE EXIT 0
platform: 4 tenants, 19 accounts (13 users, 6 operators), 12 memberships
tenant alta (t_alta): 15 units, 10 people (schema 0 → 6)
tenant lotos (t_lotos): 3 units, 2 people (schema 0 → 6)
SEED EXIT 0
```

`cmd/api` собран (`go build`) и запущен с env стенда: `APP_ENV=e2e`, `HTTP_ADDR=127.0.0.1:8109`, `ALLOWED_ORIGINS=http://127.0.0.1:5209,http://localhost:5209`. `GET /readyz` → `200`.

curl (`127.0.0.1:8109`):

```text
--- 1. GET /me/context без cookie
{"type":"https://docs.ortus.example/errors/session_expired","title":"Нет или истекла сессия","status":401,"code":"session_expired","requestId":"155a23a4-3dab-4954-a4df-a037eb4ad096"}
HTTP 401
--- 2. dev-вход owner
HTTP 200
--- 3. GET /me/context владельцем
{"displayName":"Дарья Зимина","permissionVersion":"30c33cd930c70501","platformOperator":false,"tenants":[{"capabilities":[{"permission":"billing.manage", …
HTTP 200
f04f636e-b66d-509e-ae10-9c27a18e3baa Альта Групп  caps=114
--- listMembers owner
{"type":"https://docs.ortus.example/errors/not_implemented","title":"Операция объявлена в контракте, но ещё не реализована","status":501,"code":"not_implemented",…}
HTTP 501
--- listMembers manager
{"type":"https://docs.ortus.example/errors/forbidden_action","title":"Нет действия ни в одной роли","status":403,"code":"forbidden_action",…}
HTTP 403
--- %2F probe
HTTP 401
```

Браузер (Playwright, Chromium, `E2E_MODE=stand`, `PORT=5209`, `HTTP_ADDR=127.0.0.1:8109`, `REFERENCE_PORT=4109`, `E2E_FRESH_SERVER=1`):

```text
npx playwright test e2e/me-context.spec.ts --project=desktop-1440 --project=mobile-390 --reporter=line
[1/6] [mobile-390] › e2e\me-context.spec.ts:25:3 › GET /me/context сквозь стек @stand › проверка права: listMembers — менеджеру 403, владельцу пропуск (501, тег не реализован)
[2/6] [mobile-390] › e2e\me-context.spec.ts:17:3 › GET /me/context сквозь стек @stand › без входа — 401 и «Нужен вход»
[3/6] [mobile-390] › e2e\me-context.spec.ts:11:3 › GET /me/context сквозь стек @stand › владелец входит dev-провайдером и видит себя и «Альту»
[4/6] [desktop-1440] › e2e\me-context.spec.ts:11:3 › GET /me/context сквозь стек @stand › владелец входит dev-провайдером и видит себя и «Альту»
[5/6] [desktop-1440] › e2e\me-context.spec.ts:25:3 › GET /me/context сквозь стек @stand › проверка права: listMembers — менеджеру 403, владельцу пропуск (501, тег не реализован)
[6/6] [desktop-1440] › e2e\me-context.spec.ts:17:3 › GET /me/context сквозь стек @stand › без входа — 401 и «Нужен вход»
  6 passed (10.9s)
EXIT 0
```

В логе API 32 строки. `Select-String 'ortus_sid=|ortus_csrf=|Bearer|change-me'` → 0 совпадений.

Остановка:

```text
 Volume ortus-s9_pg  Removed
 Volume ortus-s9_minio  Removed
 Network ortus-s9_default  Removed
DOWN EXIT 0
```

Процесс API завершён. Контейнеров `ortus-s9`/`ortus-s10` не осталось, порты 8109/5209/4109/6332 свободны.

## Критерий выхода по пунктам

| # | Пункт (план v2 §4) | Итог | Основание |
|---|---|---|---|
| 1 | `GET /me/context` проходит сквозь стек в CI | **частично** | Локально на стенде путь пройден целиком: браузер → BFF (dev-вход) → API → control DB → tenant DB с проверкой права. Playwright `@stand` 6 passed, curl 401/200/403/501. В конвейере `ci:local` путь покрывает только Go integration `TestStackMeContext`/`TestStackPermissionCheck` (без браузера): e2e-job CI в режиме `mock` пропускает `@stand`. На GitHub CI не запускался — нет remote |
| 2 | CI полностью зелёный | **частично (локально)** | `ci:local` — все 7 job зелёные, exit 0. Пропущены шаги `build/images` (нет Dockerfile) и `isolation/go-concurrency` (W2.30). GitHub Actions не запускался, защиты `main` нет. Вне CI красный гейт `renumber-decisions --check` (25 ссылок) |
| 3 | 6 компонентов в Storybook | **выполнен** | Сборка Storybook прошла: 20 историй, Banner, Button, Card, Dialog, Field, Status; unit `@ortus/ui` 87/87. Сборки Storybook нет в CI |
| 4 | Скелет изоляции работает (в CI) | **выполнен (локально)** | Job `isolation` зелёная: `TestIsolationMe`, 6 строк `/me/context`, блокирующая. «В CI» — в той же оговорке, что и п. 2 |
| 5 | MSW отвечает на операции этапа 1 | **не выполнен** | W0.12 и W0.13 не влиты, `@ortus/adapter` — заглушка, `msw` нигде не импортируется |
| 6 | ADR D-01…D-12 записаны | **выполнен** | `docs/adr/0002…0013` — «предложено» (критерий это допускает), ADR-0001 принят, ADR-0014 предложен; `docs/adr` 108/108 |

## Что нужно для выхода

1. Начать и влить W0.12, затем W0.13 (подволны 0c и 0d). Для приёмки нужно, чтобы MSW в режиме `mock` отвечал на операции контракта 0.3.0-stage1 (раннер conformance W0.13) и чтобы самотест H11 W0.05 (`app` с `?persona=`) был снят с `fixme` в режиме `mock`.
2. Интегратору: подключить remote, прогнать `ci.yml` на GitHub и включить защиту `main` с 7 обязательными job.
3. Решить, что значит «сквозь стек в CI». Варианты: (а) засчитать Go integration-тест `cmd/api/stack_integration_test.go` (HTTP-клиент, без браузера); (б) добавить в CI job `e2e-stand` (compose `postgres` + `migrate`/`seed` + `cmd/api` + `me-context.spec.ts @stand`). По умолчанию до решения — (а), но браузерный путь в CI сейчас не проверяется.
4. Пропуски, которые не блокируют выход, перечислены в [../critique/stage-0.md](../critique/stage-0.md).
