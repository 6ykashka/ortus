# Отчёт: выход этапа 1 «Платформа»

- stage: 1 · проверяющий выхода и критик полноты (проверки 1 и 2) · mode: `ci:local` + stand (`e2e-stand` и ручная проба API, слот 20) + mock (job `e2e`)
- Критика полноты: [../critique/stage-1.md](../critique/stage-1.md)

## Проверка 2 — 2026-10-15 (после добивки W1.40, W1.41)

- main: `e3c790e` (docs(plan): статус W1.41), совпадает с `origin/main`. С проверки 1 (`0c788a8`) влиты W1.40 (`a95a8c5`: ожидание `listMembers` в `me-context.spec.ts`) и W1.41 (`8f63b4c`: письмо приглашения через SMTP после COMMIT). Не влиты, как и в проверке 1: W1.11 (ветка от `f4c7c07`, не перебазирована, отстаёт от main на 25 коммитов), W1.20 (не принят после трёх возвратов; 46 коммитов впереди, 21 позади main), W1.22, W1.23, W1.24, W1.25 (ждут W1.20), W1.30 (ждёт всех). Предложения проверки 1 W1.42…W1.46 в реестр не внесены и не начаты.
- Среда: Windows 11, Node 22.19.0, Go 1.26.0, Docker 27.4.0, pnpm 9.15.9. Слот 20: API 8120, Origin `http://localhost:5220`, compose `ortus-s20`, Mailpit UI из `s20.env`.
- `git status --short` до и после прогонов: только `?? docs/plan/evidence/` (чужой неотслеживаемый каталог снимков W1.20, был до проверки, в коммит не вошёл).

### Вердикт

**Не пройден.** Первая часть критерия теперь выполнена, вторая — нет.

1. **«AC-01, AC-02, AC-10, AC-11 и AC-07 автоматизированы и зелёные в CI (в том числе на GitHub)» — выполнено на серверном уровне.** CI на GitHub зелёный 8/8 на текущем main: run 38790795342 (`e3c790e`) и run 38777003609 (`b48ab0f`, после W1.40). Локально все job зелёные; `integration` в полном параллельном прогоне падала только по среде и нагрузке, последовательный повтор — `ok` (ниже). Оговорки прежние: AC-10 закрыт на уровне оценщика и выдачи файла (экспорт — этап 4), браузерной части AC-11 (категория E2E) нет до W1.20/W1.30.
2. **«Владелец пилота на стенде сам настраивает структуру и роли и приглашает сотрудников» (W1.30, stand) — не выполнено.** На API стенда сценарий теперь проходит целиком: структура, роль, назначение, приглашение, письмо в Mailpit, принятие по ссылке, права роли у приглашённого (проба ниже). Но «сам» — это интерфейс, а в `@ortus/web` на main по-прежнему 0 из 22 экранов этапа 1, `@stand`-spec этапа 1 нет, W1.30 не начат. Блокирует цепочка W1.20 → W1.22…W1.25 → W1.30 и W1.11.

### Критерий выхода по пунктам

| # | Пункт (план v2 §4, план 27 §«Этап 1») | Проверка 1 (`0c788a8`) | Проверка 2 (`e3c790e`) | Основание |
|---|---|---|---|---|
| 1 | AC-01: чужой id → 404, время не различается | автоматизирован на сервере | **автоматизирован, зелёный на GitHub** | job `isolation` (раннер матрицы, `matrix.Timing`), `scopeddb`, `org`, `people`; run 38790795342 |
| 2 | AC-02: tenantId B из сессии A → 404, пул B не открывается | автоматизирован на сервере | **автоматизирован, зелёный на GitHub** | `tenantctx/ac02_integration_test.go`, `isolation/tenants.yaml`, `me.yaml` |
| 3 | AC-07: 100 повторов → один эффект | автоматизирован | **автоматизирован, зелёный на GitHub** | `idem/ac07_integration_test.go` |
| 4 | AC-10: отзыв роли во время экспорта → 403 | частично | **частично (принимается на уровне integration)** | `authz` `TestAC10RevokedRoleDuringExport`, `files` `TestAC10DownloadAfterRevoke`; экспорт — этап 4 |
| 5 | AC-11: read-only — чтение работает, создание → 403 `tenant_read_only` | на сервере | **на сервере, зелёный на GitHub**; браузерной части нет | `cmd/api/modules_integration_test.go`, `control/subscriptions` |
| 6 | Всё перечисленное зелёное в CI на GitHub | не выполнен (`e2e-stand` красный) | **выполнен** | run 38790795342: 8/8; run 38777003609: 8/8 |
| 7 | Владелец на стенде сам настраивает структуру и роли и приглашает (W1.30, stand) | не выполнен | **не выполнен** | API — проходит; UI — 0 из 22 экранов, spec W1.30 нет |

### Прогоны

#### 1. `corepack pnpm install --frozen-lockfile`

```text
Scope: all 9 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 904ms using pnpm v9.15.9
EXIT 0
```

#### 2. `ORTUS_SLOT=20 corepack pnpm run ci:local`: exit 1 на job `integration` (среда и нагрузка), остальные job догнаны по одной

```text
✔ lint/lint  ✔ lint/actionlint  ✔ lint/spectral                     ■ lint: ок
✔ contract/openapi-validate  ✔ contract/permissions
✔ contract/migrations  ✔ contract/codegen-drift                     ■ contract: ок
  (118 операций 0.1 сохранены, 146 дельт; 52 кода; 123 права; 184 примера для 85 операций; 37 экранов; Spectral 0/0)
✔ unit/check-icu  ✔ unit/typecheck  ✔ unit/test
✔ unit/check-decisions  ✔ unit/allowlist-lint  ✔ unit/mcp-check     ■ unit: ок
■ integration: упала (go-integration) — 43 пакета ok, 4 FAIL
```

Unit: node-наборы 116, 115, 52, 35, 161, 73, 109, 194 (fail 0); tokens 54, domain 549, ui 237, adapter 329, web 15; `go test ./...` — ok.

Integration, четыре падения полного параллельного прогона:

| Пакет | Причина | Повтор |
|---|---|---|
| `cmd/seed` | `get provider: rootless Docker is not supported on Windows` — флейк провайдера testcontainers при параллельном старте (П-10 проверки 1) | `-p 1`: `ok` (8.2 s) |
| `internal/domain/fleetrules` | `fork/exec …\fleetrules.test.exe: Access is denied` — антивирус | `-cover`: `ok`, 98.8 % |
| `internal/modules/access/assignments` | `TestCreateAssignmentRacesExtendWorkProfile`, `TestUpdateRoleRacesCreateWorkProfile`: под нагрузкой первой прошла команда W1.05, а не W1.06; инвариант D-10 (`noDriverWithEarnings`) не нарушен, сломано только предположение теста о порядке | `-p 1`: `ok`; `-run Races` трижды: `ok` |
| `internal/platform/session/oidc/authhttp` | `FATAL: sorry, too many clients already (SQLSTATE 53300)` — лимит соединений тестового PostgreSQL при параллельных тестах | `-p 1`: `ok` (11.3 s) |

Остальные 43 пакета прошли с первого раза, в том числе `cmd/api` (83 s), `platform/authz` (69 s), `platform/idem` (62 s), `platform/tenantctx` (30 s), `control/subscriptions` (67 s), `modules/files` (74 s). На GitHub (Linux) job `integration` зелёная на обоих последних прогонах.

Остальные job — `corepack pnpm run ci:job <job>`, `ORTUS_SLOT=20`:

```text
✔ isolation/go-isolation   (isolation 40.2 s, isogen, fixtures, matrix — ok)
⏭ isolation/go-concurrency: нет backend/test/concurrency (владелец W2.30)
■ isolation: ок
✔ build/build  ✔ build/storybook  ✔ build/check-k6 (http_req_failed 0 из 155)  ✔ build/images
■ build: ок
  9 passed (13.0s)
✔ e2e-stand/e2e-stand
■ e2e-stand: ок
  42 passed (30.6s)
✔ e2e/e2e
■ e2e: ок
```

`@stand`-spec на main — только `me-context.spec.ts` (этап 0, 3 теста × 3 вьюпорта). Spec этапа 1 (`e2e/journeys/stage1/`, W1.30) нет.

#### 3. e2e mock страниц этапа

Страниц этапа 1 на main нет: `frontend/apps/web/src` — каркас W0.09 (`ContextPage`, `LoginPage`, роутер). Job `e2e` (mock): 42 passed, 0 skipped — те же тесты, что на выходе этапа 0. Инвентарь `api/openapi/screens.yaml`: 22 экрана `stage: 1`, на main реализовано 0.

#### 4. Стенд слота 20: `corepack pnpm run stand -- --slot 20 --env <scratch>/s20.env`, затем `cmd/api` (APP_ENV=e2e, dev-вход, 127.0.0.1:8120)

```text
control: 0 → 6
plan: target 12
platform: 4 tenants, 19 accounts (13 users, 6 operators), 12 memberships
tenant alta (t_alta): 15 units, 10 people (schema 0 → 12)
tenant lotos (t_lotos): 3 units, 2 people (schema 0 → 12)
stand: готов (ortus-s20)
```

Проба сценария выхода через API (скрипт в scratchpad, вне репозитория; Origin слота, CSRF из dev-входа, `Idempotency-Key` на каждую изменяющую команду):

```text
getMyContext (owner): 200 tenants=Альта Групп
listOrgUnits: 200 items=15
createOrgUnit region: 201
createOrgUnit company: 201 (parent = новый регион)
createOrgUnit branch: 201
listRoles: 200 items=9
createRole: 201 («Проба выхода · кадровик»: members.read, org_units.read)
createMember: 201 (работник без входа)
createAssignment: 201 (роль, область — новая фирма с потомками)
explainAccess: 200
inviteMember (с ролью и областью): 201 status=pending
Mailpit: total=1, from=no-reply@ortus.local, тема «Приглашение в «Альта Групп»»
link: http://localhost:5220/auth/invitation#token=<token>
inspectInvitation: 200 tenant=Альта Групп status=pending
acceptInvitation: 200 membership=active
getMyContext (invitee): 200 tenants=SPA «Лотос», Альта Групп
selectTenant (invitee → Альта): 200
listMembers (invitee; роль members.read на новой фирме): 200 items=2   ← видит только свою область
listRoles (invitee; без права на роли): 403
dev login аккаунта не из сида: 401
listMembers (owner): 200 items=12
updateMember suspend: 501
createRealtimeTicket: 501
GET /api/v1/realtime: 404
listMyNotifications: 200   getStorageUsage: 200   listModuleCatalog: 200 items=3
listPlatformTenants (operator): 200 items=4
suspendPlatformTenant: 501   extendPlatformTrial: 501   listPlatformAuditEvents: 501
token в логе API: False
```

Отличие от проверки 1: приглашение доставляется и принимается, права роли действуют в своей области (П-2 закрыт W1.41). Без изменений: `updateMember`, канал реального времени и операторские команды — 501/404. Приглашённого «с улицы» на dev-стенде проверить нельзя: dev-провайдер входит только в аккаунты сида (401), аккаунт создаёт только OIDC при первом входе, а Keycloak в CI нет — для W1.30 нужен аккаунт сида без членства (как `owner@t-lotos`) или доработка dev-провайдера (критика, П-13).

Остановка: процесс `cmd/api` завершён, `stand.mjs down -v` удалил контейнеры, тома и сеть `ortus-s20`.

#### 5. CI на GitHub (`gh run list -R 6ykashka/ortus`)

| run | коммит | итог | красная job |
|---|---|---|---|
| 38790795342 | `e3c790e` статус W1.41 (текущий main) | **success** 8/8 | — |
| 38777003609 | `b48ab0f` статус W1.40 | **success** 8/8 | — |
| 38769291046 | `2292987` выход этапа 1 (проверка 1) | failure | `e2e-stand` (`me-context.spec.ts:55`) |
| 38765228603 | `0c788a8` статус W1.06 | failure | `e2e-stand` |

В job `unit` по-прежнему шесть аннотаций `X` на проходящих подтестах `tools/gen` (П-9, W1.45 не начат).

### Сверка с историями S1-01…S1-30 и инвентарём экранов

Подробно — [../critique/stage-1.md](../critique/stage-1.md), раздел «Проверка 2». Итог:

- Сервер (S1-01…S1-26): закрыты — 22 (+S1-06 после W1.41); частично — 3 (S1-10 `sendInvitations` 501 и `importer.Purge` не в расписании; S1-15 канал не подключён; S1-23 `listPlatformAuditEvents` 501); не закрыта — 1 (S1-04, W1.11).
- Клиент: S1-27…S1-30 не закрыты; экраны этапа — 0 из 22.

## Проверка 1 — 2026-10-15

- main: `0c788a8` (docs(plan): статус W1.06), совпадает с `origin/main`. На main влиты W1.00, W1.01, W1.02, W1.03, W1.04, W1.05, W1.06, W1.07, W1.08, W1.09, W1.10, W1.21, а также опережающие W2.00 и W2.01. Не влиты W1.11 (откат при интеграции: ветка от `f4c7c07` противоречит контракту 0.4.0-stage1), W1.20 (не принят после трёх возвратов), W1.22, W1.23, W1.24, W1.25 (ждут W1.20) и W1.30 (ждёт всех W1.*).
- Среда: Windows 11, Node 22.19.0, Go 1.26.0, Docker 27.4.0, pnpm 9.15.9. Слот 20: Vite 5220, API 8120, эталон 4120, compose `ortus-s20`, Mailpit UI 10025.
- `git status --short` до прогонов и после них: только `?? docs/plan/evidence/`. Это чужой неотслеживаемый каталог (снимки проверок W1.20), он был до начала проверки. Прогоны новых файлов не оставили. Каталог в коммит не вошёл.

### Вердикт

**Не пройден.** Не выполнена ни одна из двух частей критерия.

1. **«Автоматизированы и зелёные в CI на GitHub».** Серверные тесты AC-01, AC-02, AC-07, AC-10 и AC-11 есть и проходят в `integration` и `isolation`. Но CI на GitHub красный на трёх последних прогонах main, включая текущий `0c788a8` (run 38765228603). Падает job `e2e-stand`. Причина: устаревшее ожидание в `frontend/apps/web/e2e/me-context.spec.ts:55`. Тест ждёт для владельца `listMembers` → 501, а после W1.05 стенд отвечает 200. Локально на слоте 20 падает так же. Стенд-e2e приёмки (W1.30) нет: в `e2e/` нет ни одного spec этапа 1.
2. **«Владелец пилота на стенде сам настраивает структуру и роли и приглашает сотрудников» (сценарий W1.30 в режиме stand).** Сценария нет: W1.30 не начат, а в `@ortus/web` на main нет ни одной страницы этапа 1 (0 из 22 экранов `screens.yaml`). API стенда сценарий в основном проходит (проба ниже), но в одном месте он обрывается. `inviteMember` создаёт приглашение и **выбрасывает одноразовый токен** (`backend/internal/modules/access/assignments/invite.go:207`, `_, id, err := invitations.Issue(...)`). Письма нет: в backend нет отправителя почты, Mailpit слота 20 пуст. Приглашённый не может получить ссылку и принять приглашение.

### Критерий выхода по пунктам

| # | Пункт (план v2 §4, план 27 §«Этап 1») | Итог | Основание |
|---|---|---|---|
| 1 | AC-01: чужой id → 404, время не различается | **автоматизирован на сервере** | Раннер матрицы изоляции: строки 404 повторяются с несуществующим id, сравниваются статус, `code` и медианы времени (W1.04, `matrix.Timing`). Плюс `scopeddb_integration_test.go`, `org`, `people`. Job `isolation` зелёная локально и на GitHub. Стенд-e2e нет (W1.30) |
| 2 | AC-02: tenantId B из сессии A → 404, пул B не открывается | **автоматизирован на сервере** | `tenantctx/ac02_integration_test.go` (`TestAC02ForeignTenantNeverOpensPool`, `TestAC02MisroutedTenantIsRefused`), `provisioning`, `isolation/tenants.yaml`, `me.yaml`. Зелёные |
| 3 | AC-07: 100 повторов → один эффект | **автоматизирован** | `idem/ac07_integration_test.go` `TestAC07HundredRepeatsOneEffect`. Зелёный |
| 4 | AC-10: отзыв роли во время экспорта → выдача 403 | **автоматизирован частично** | На уровне оценщика — `authz/pg_integration_test.go` `TestAC10RevokedRoleDuringExport`. Выдача файла после отзыва — `modules/files` `TestAC10DownloadAfterRevoke`. Сквозного экспорта нет: модуль «Данные» относится к этапу 4 |
| 5 | AC-11: read-only — чтение и экспорт работают, создание → 403 `tenant_read_only` | **автоматизирован на сервере** | `cmd/api/modules_integration_test.go` (grace → read_only: чтение проходит, создание 403), `control/subscriptions/store_integration_test.go`. Экспорта нет (этап 4). Категория AC-11 — E2E: стенд-e2e нет (W1.30) |
| 6 | Всё перечисленное зелёное в CI на GitHub | **не выполнен** | run 38765228603 (`0c788a8`), 38752259304 (`b5b8327`), 38750452537 (`1c6dadf`): 7 из 8 job зелёные, `e2e-stand` красная (3 failed / 6 passed). Последний зелёный — run 38748522324 (`dc0ae1b`, до W1.05) |
| 7 | Владелец на стенде настраивает структуру и роли и приглашает сотрудников (W1.30, stand) | **не выполнен** | Нет страниц этапа 1 и spec W1.30. Нет доставки приглашения (выше). Проба API ниже |

### Прогоны

#### 1. `corepack pnpm install --frozen-lockfile`

```text
Scope: all 9 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 1.6s using pnpm v9.15.9
EXIT 0
```

#### 2. `ORTUS_SLOT=20 corepack pnpm run ci:local`: exit 1 на job `integration` (среда), остальные job догнаны по одной

```text
✔ lint/lint
✔ lint/actionlint
✔ lint/spectral
■ lint: ок
✔ contract/openapi-validate
✔ contract/permissions
✔ contract/migrations
✔ contract/codegen-drift
■ contract: ок
✔ unit/check-icu
✔ unit/typecheck
✔ unit/test
✔ unit/check-decisions
✔ unit/allowlist-lint
✔ unit/mcp-check
■ unit: ок
■ integration: упала (go-integration)
```

Unit: node-наборы 116, 115, 52, 35, 161, 73, 109 и 194 (все pass, fail 0). Пакеты: tokens 54, domain 549, ui 237, adapter 329, web 15. `go test ./...` — ok.

Integration упала по трём пакетам, все три — из-за среды:

- `internal/domain/fleetrules`: `fork/exec …\fleetrules.test.exe: Access is denied` (антивирус, известно с W1.00). С `-cover` пакет проходит: `ok … coverage: 98.8%`.
- `internal/modules/importer` и `internal/modules/org`: `get provider: rootless Docker is not supported on Windows`. Это флейк провайдера testcontainers при параллельном старте, известный по W1.10. Повтор `go -C backend test -tags integration -count=1 -p 1 ./internal/modules/importer/... ./internal/modules/org/...` дал `ok`, `ok`, `ok`.

Остальные 50 integration-пакетов прошли с первого раза, в том числе `cmd/api` (96 s), `platform/authz`, `platform/idem`, `platform/tenantctx`, `control/subscriptions`, `modules/files`, `modules/access/*`, `platform/notify/*`.

Остальные job — `corepack pnpm run ci:job <job>` при `ORTUS_SLOT=20`:

```text
✔ isolation/go-isolation
⏭ isolation/go-concurrency: пропуск: нет backend/test/concurrency (владелец W2.30 (дорожка Т))
■ isolation: ок
✔ build/build
✔ build/storybook
✔ build/check-k6          (http_req_failed 0 из 155)
✔ build/images
■ build: ок
  42 passed (41.7s)
✔ e2e/e2e
■ e2e: ок
```

#### 3. `ORTUS_SLOT=20 corepack pnpm run ci:job e2e-stand`: exit 1

```text
  x [mobile-390]   › e2e\me-context.spec.ts:32:3 › … › проверка права: listMembers — менеджеру 403, владельцу пропуск
  x [tablet-768]   › …
  x [desktop-1440] › …
    Expected: 501
    Received: 200
    > 55 |       expect(passed.status).toBe(501);
  3 failed
  6 passed (14.3s)
✖ e2e-stand/playwright: код 1
▶ e2e-stand/stop-api
▶ e2e-stand/down
■ e2e-stand: упала (e2e-stand)
```

На GitHub (run 38765228603, `0c788a8`) результат тот же: `Expected: 501`, `Received: 200`.

`@stand`-spec этапа 1 нет: `grep @stand frontend/apps/web/e2e` находит только `me-context.spec.ts` (этап 0). Каталогов `e2e/journeys/stage1/` и `e2e/_stand/` (W1.30) нет.

#### 4. e2e mock страниц этапа

Страниц этапа 1 на main нет. В `frontend/apps/web/src` только каркас W0.09: `ContextPage`, `LoginPage`, роутер. В `e2e/` — `me-context.spec.ts` и `_helpers/harness.spec.ts`. Job `e2e` (mock): 42 passed, 0 skipped. Это те же тесты, что на выходе этапа 0. Оболочка, AccessGate, входящие, «Пользователи и роли», «Модули и место», «Хранилище», «Файлы» и «Организации» лежат в невлитых ветках (`ws/W1.20`) или не начаты.

#### 5. Стенд слота 20: `corepack pnpm run stand -- --slot 20 --env <scratch>/s20.env`, затем `cmd/api` (APP_ENV=e2e, dev-вход, 127.0.0.1:8120)

```text
control: 0 → 6
plan: target 12
platform: 4 tenants, 19 accounts (13 users, 6 operators), 12 memberships
tenant alta (t_alta): 15 units, 10 people (schema 0 → 12)
tenant lotos (t_lotos): 3 units, 2 people (schema 0 → 12)
stand: готов (ortus-s20)
GET /readyz → 200 {"status":"ready"}
```

Проба сценария выхода через API (скрипт в scratchpad, вне репозитория). Запросы шли с Origin слота, CSRF из dev-входа и `Idempotency-Key` на каждую изменяющую команду:

```text
login owner: 200
getMyContext: 200
listOrgUnits: 200 — 15 шт., регион «Москва»
createOrgUnit region: 201
createOrgUnit company: 201
listRoles: 200
createRole: 201
createMember: 201
createAssignment: 201
inviteMember: 201  {"email":"probe.employee@alta.example","expiresAt":"2026-10-22T16:19:28Z","id":"be33f1cc-…","status":"pending"}
explainAccess: 200
listMembers: 200
updateMember: 501 not_implemented
createRealtimeTicket: 501 not_implemented
suspendPlatformTenant (owner, not operator): 404 not_found
login operator: 200
listPlatformTenants: 200
suspendPlatformTenant: 501 not_implemented
extendPlatformTrial: 501 not_implemented
Mailpit (127.0.0.1:10025) /api/v1/messages → total 0
```

Остановка: процесс `cmd/api` завершён, `stand.mjs down -v` удалил контейнеры, тома и сеть `ortus-s20`.

#### 6. CI на GitHub (`gh run list -R 6ykashka/ortus`)

| run | коммит | итог | красная job |
|---|---|---|---|
| 38765228603 | `0c788a8` статус W1.06 (текущий main) | failure | `e2e-stand` (3 failed, `me-context.spec.ts:55`) |
| 38752259304 | `b5b8327` статус W1.09 | failure | `e2e-stand` (то же) |
| 38750452537 | `1c6dadf` статус W1.05 | failure | `e2e-stand` (то же) — первый красный после влития W1.05 |
| 38748522324 | `dc0ae1b` статус W2.00 | success | — (8/8) |
| 38745765483 … 38729033777 | W1.08, W1.07, W1.10, W1.03, W1.04 | success | — |

Остальные семь job (lint, contract, unit, integration, isolation, build, e2e mock) на `0c788a8` зелёные. В job `unit` GitHub показывает шесть аннотаций `X` («Servers с полем на тег; тег без реализации — 501», «код → статус и title», «строка операции с правами»). Это проходящие подтесты: в логе они `ok 2`, `ok 3`, `ok 4`, а помечены как `##[error]`. Шум, который маскирует настоящие ошибки (критика, П-9).

### Сверка с историями S1-01…S1-30 и инвентарём экранов

Подробно — в [../critique/stage-1.md](../critique/stage-1.md) §1. Итог:

- Серверная часть (S1-01…S1-26):
  - закрыты тестами и изоляцией — 21;
  - частично — 4:
    - S1-06 приглашение: принять можно, доставки нет;
    - S1-23 аудит: записи пишутся (`audit`, `platform_audit`), но `listPlatformAuditEvents` («Журнал действий» оператора) — 501, заглушка `platformhttp/stage1b_stubs.go` до W1.11;
    - S1-10 CSV: `sendInvitations` 501, `importer.Purge` не подключён к `cmd/worker`;
    - S1-15 отзыв ≤ 5 с: пакет `realtime` не подключён в `cmd/api` и `cmd/worker` — `createRealtimeTicket` 501, `/api/v1/realtime` 404;
  - не закрыта — 1: S1-04 оператор (W1.11 не влит, `suspend`/`resume`/`extend` 501).
- Клиентская часть: S1-27…S1-30 (оболочка) не закрыты. Экранная часть историй с экраном тоже не закрыта: на main 0 из 22 экранов этапа 1 (`api/openapi/screens.yaml`, `stage: 1`).
