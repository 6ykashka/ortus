# WS-02 · Локальный стенд docker compose (compose-stand)

Волна 0 · Размер S · Вид infra · Зависит от WS-01 · Блокирует WS-40, WS-41, WS-53, WS-54 (`00-master-plan.md` §5.1:500, §6.1:739) · Ревью 1 · `args.ws.pages: []` (§7.2:831) · История S0-03 (`13-backlog-s0-s2.md:30`; §9.2:992).

Условные ссылки — как в мастер-плане §0.1: «12 §3.2 R8» = `docs/plan/analysis/12-prior-project-and-skills.md`, раздел 3.2, строка R8; «`skeleton/docker-compose.yml:27`» = `design/docs/repo-skeleton/docker-compose.yml`, строка 27; «`14:99`» = `design/docs/14-engineering.md:99`.

## 1. Цель

После WS-02 команда `cp deploy/compose/.env.example .env` + `docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d --wait` поднимает на loopback стенд из `14:96–106` (`postgres:17`, `minio`, `mailpit`, `otel-collector`), а профили `test` (`postgres-test` на 5433, tmpfs), `keycloak` и `init` (`minio-init`) подключаются только по запросу; каждая проверка стенда записана в `tools/stand-check.ps1` и воспроизводима одной командой. Стенд не нарисован в прототипе — «точно как нарисовано» здесь означает «точно как в `skeleton/docker-compose.yml:1–48` и `skeleton/.env.example:1–46` с поправками 12 §3.2 R8/R17, 12 §8 п.23–24, PD-38, Q-112»; всё, что дальше делают WS-40, WS-41, WS-53, WS-54, опирается на имена сервисов, порты и переменные из §4 этого брифа.

## 2. Границы файлов

Создаёт (владение по §3.3:241 и карточке §5.4:628 — `deploy/compose/` кроме `profiles/e2e` и `keycloak/`):

| Путь | Что это |
|---|---|
| `deploy/compose/docker-compose.yml` | стенд: 4 сервиса по умолчанию + 3 под профилями, loopback-порты, healthcheck, образы по digest |
| `deploy/compose/.env.example` | все переменные с комментарием «что и почему» (12 §3.2 R17), значения совпадают с compose |
| `deploy/compose/otel/collector.yaml` | конфигурация `otel-collector` (OTLP 4317/4318, `health_check` 13133, экспортёр `debug` — бэкенд хранения не выбран, D-07 `16-raid-glossary.md`) |
| `deploy/compose/README.md` | как поднять/остановить/сбросить, профили, «один стенд на машину», изоляция через `COMPOSE_PROJECT_NAME`/`POSTGRES_PORT` |
| `tools/stand-check.ps1` | исполняемый чек-лист §6 (статические S1–S12 и живые L1–L10), PowerShell 5.1 и 7, только ASCII |
| `docs/plan/reports/WS-02.md` | отчёт по `orchestration.md` §5 |
| `docs/plan/evidence/stand/` | вывод `stand-check`, снимки MCP (§8) |
| `docs/plan/status.md` | только строка `WS-02` (`:9`) |

Запрещено трогать: `deploy/compose/profiles/**` (WS-53), `deploy/compose/keycloak/**` (WS-54 — realm-файлы `realm-ortus.json`, `realm-operators.json`, 10 §12 п.23), корень репозитория (`Makefile`, `README.md`, `.gitignore`, `package.json`, `CLAUDE.md` — WS-01; правки через интегратора, `orchestration.md` §7), `.github/**` (CI — WS-01), `backend/**` (харнесс — WS-07, миграции — WS-41), `design/**` (эталон). Внешний сервис в compose сверх списка §1 — только через интегратора (`orchestration.md` §7 «добавлять внешние сервисы в compose»).

Worktree и ветка: Workflow создаёт worktree сам (`workflow.template.js:87`, `isolation: 'worktree'`), ветка `ws/ws-02-compose-stand` от `main` (`workflow.template.js:69`). Вручную: `git worktree add ..\ortus-ws02 -b ws/ws-02-compose-stand main`; затем в worktree `pnpm install` (husky/lint-staged нужны для коммитов; без `node_modules` PostToolUse-хук молча пропускает форматирование — 12 §3.6:211). Коммиты — `git commit -F <файл без BOM>` (12 §5 п.25), форма `test(ws-02): …` → `feat(ws-02): …` → `refactor(ws-02): …` (12 §8 п.25). `.env` в корне worktree не коммитится (12 §5 п.29; проверка S12).

## 3. Входы

Прочитать полностью:

| Источник | Что брать |
|---|---|
| `design/docs/repo-skeleton/docker-compose.yml:1–48` | топология: `name: ortus` (`:2`), `postgres:17` + `POSTGRES_DB: ortus_control` + healthcheck `pg_isready` (`:5–16`), `minio` с консолью 9001 (`:18–25`), `keycloak` `start-dev --import-realm` + `./keycloak:/opt/keycloak/data/import:ro` (`:27–34`), `mailpit` 8025/1025 (`:36–38`), `otel-collector` 4317/4318 (`:40–42`), volumes `pg`, `minio` (`:44–46`), комментарий «Версии образов закрепить по digest после выбора (D-04). api, worker, web запускаются через `make dev`» (`:48`) |
| `design/docs/repo-skeleton/.env.example:1–46` | имена переменных: `PG_SUPERUSER`/`PG_SUPERPASS` (`:4–5`), `CONTROL_DB_URL` (`:6`), `TENANT_DB_*` (`:7–10`), `S3_*`/`UPLOAD_URL_TTL`/`DOWNLOAD_URL_TTL` (`:13–19`), `OIDC_*`/`OPERATOR_OIDC_ISSUER` (`:22–26`), `SESSION_COOKIE_NAME=ortus_sid`/`SESSION_TTL=12h`/`ALLOWED_ORIGINS` (`:29–31`), `SMTP_HOST`/`SMTP_PORT=1025` (`:34–35`), `OTEL_EXPORTER_OTLP_ENDPOINT`/`LOG_LEVEL` (`:38–39`), `TRIAL_*`/`GRACE_DAYS`/`HOLD_TTL` (`:42–46`) |
| `design/docs/14-engineering.md:72–81, 83–94, 96–106` | окружение `local` = «Сид-скрипт … `make up`» (`:76`); роли БД `migrator`/`api_runtime`/`worker_runtime`/`provisioner` (`:81`); CI `integration (testcontainers: PostgreSQL, MinIO)` и `e2e (Playwright на эфемерном стенде compose)` (`:89, :92`); «Локальный запуск» `cp deploy/compose/.env.example .env` → `make up` → `make migrate` → `make seed` → `make dev` (`:99–103`) |
| `design/docs/13-backlog-s0-s2.md:30` | S0-03 «Локальный стенд `docker compose`: PostgreSQL, MinIO, Keycloak, Mailpit, OTel collector», размер S |
| `design/docs/16-raid-glossary.md:11–13` | D-03 Keycloak (realm клиентов + realm операторов), D-04 «Последние стабильные на дату старта, закреплены в CI» (S0-03), D-05 секреты во внешнем хранилище |
| `design/docs/15-quality-security.md:7–17` | Integration — testcontainers-go (`:10`), E2E — Playwright (`:15`) |
| 12 §3.2 R8 (`:96`) | compose 2.0: `postgres:17-alpine`, порт только `127.0.0.1:${POSTGRES_PORT:-5432}:5432`, `POSTGRES_INITDB_ARGS: --encoding=UTF8`, `postgres-test` под `profiles: [test]` на 5433, `tmpfs: /var/lib/postgresql/data`, `fsync=off full_page_writes=off synchronous_commit=off`, `keycloak:26.0 start-dev --import-realm` с healthcheck через `/dev/tcp` (в образе нет curl), одноразовый `minio-init` **вне** `--wait`; «добавить `mailpit` и `otel-collector`; закрепить образы по digest — там `:latest`» |
| 12 §3.2 R17 (`:105`) | `.env.example`: «Каждая переменная — с комментарием „что и почему“, значения по умолчанию совпадают с compose; `DATABASE_URL` без умолчания — сознательно» (умолчание — в коде приложения, не в примере) |
| 12 §3.3 п.12–13 (`:123–124`) | testcontainers vs `postgres-test`; версии PostgreSQL 17 / Node 22 / pnpm |
| 12 §3.6 (`:197–213`) | PowerShell 5.1 без `&&`; `HTTP_PROXY` экспортирован → `curl.exe --noproxy "*"`; `$OutputEncoding` ASCII — кириллица в `psql` как `?`; «`docker compose up --wait` считает одноразовый контейнер провалом → `run --rm` отдельно»; «Keycloak импортирует realm при каждом старте; правки в консоли пропадают» |
| 12 §4.12 (`:395`) | «Binding to 0.0.0.0 — Medium»: «в 3.0 задать `HTTP_ADDR=127.0.0.1:8080` по умолчанию в dev» |
| 12 §5 п.16, п.29 (`:474, :487`) | compose правит только интегратор после закрытия владельца; секреты и `CONTROL_DB_URL` без умолчаний в коде, `.env` не коммитится |
| 12 §6 п.11–12 (`:514–515`) | тесты харнесса WS-07, для которых WS-02 даёт «Given» (цитируются в §6а) |
| 12 §7 п.8, 9, 11, 17 (`:550–553, :559`) | версии; testcontainers vs compose; Keycloak JVM ~1 ГБ; `HTTP_ADDR` |
| 12 §8 п.3, 23, 24 (`:567, :587–588`) | dev-машина Windows 11, PowerShell 5.1, Docker Desktop есть; «Keycloak: только профиль compose, не в unit/integration; `oidctest` для Go; realm импортируется при каждом старте»; «`minio-init`/`seed` — одноразовые контейнеры вне `--wait`» |
| 10 §12 п.22–23 (`:977–978`); 10 `:173, :178` | состав стенда; realm `ortus` + `ortus-operators`; «⚠ `10-data-model.md:7` требует PostgreSQL ≥ 13 (проверено на 16.4), compose использует `postgres:17`» |
| 09 DP-14 (`:761`) | «миграции проверены на 16.4, план TDD задаёт testcontainers PostgreSQL 17» |
| `design/docs/db/control_0001_init.sql:4–6` | «Применяется ролью migrator; у runtime-роли API только DML»; «Проверено на PostgreSQL 16.4» — роли создаёт WS-41, не compose |
| `docs/plan/decisions.md:12, 17, 168–169, 171, 174` | PD-18 (Keycloak не в фазе 1), PD-23 (pnpm), Q-106 (PostgreSQL 17 везде; Go последний стабильный; Node 22), Q-107 (testcontainers для integration, compose — для стенда и e2e), Q-109 (Keycloak только под профилем/smoke-тегом), Q-112 (`127.0.0.1:8080` в dev) |
| `00-master-plan.md` §3.3:241, §5.1:500, §5.4:628, §6.1:739, §6.5:799, §7.2:831, §8.1:936–946 (колонка infra), §9.2:992, §9.3:1072, §10.1 R14–R15, §10.3 PD-31/PD-38/PD-41/PD-46, §11.2:1172 | владение, выходы, тесты-первыми, барьер 0→1 («`go test ./...` + `-tags integration`»), эквиваленты флагов фазы 2 (`APP_ENV=e2e`), версии, Keycloak по PD-41, «`make up && make migrate && make seed && make dev` поднимают стенд одной командой» |
| `tdd-protocol.md` §1, §3 «Go», §4, §5; `verification-protocol.md` §2, §6; `orchestration.md` §1, §5, §7 | цикл, DoD, отчёт, границы автономии; фаза 2: «`npm run e2e:full` поднимает `docker compose --profile e2e` (PostgreSQL, MinIO, Keycloak в dev-режиме, Mailpit)» (`verification-protocol.md:36`) |

Факт окружения планировщика (03.10.2026, dev-машина): `docker --version` → `Docker version 27.4.0`, `docker compose version` → `v2.31.0-desktop.2`; `name:`, `profiles:`, `--wait`, `config --format json`, `ps --format json` доступны.

## 4. Контракты

### 4.1 Публикует

**К1. Каноническая команда** (из корня репозитория; `.env` = копия `deploy/compose/.env.example`, `14:99`):

```text
docker compose -f deploy/compose/docker-compose.yml --env-file .env <up -d --wait | down | down -v | ps | logs | exec -T <svc> …>
```

Относительные пути внутри compose (`./otel/collector.yaml`, `./keycloak`) разрешаются от `deploy/compose/`; `.env` читается из корня через `--env-file`. Обязательные переменные объявлены как `${VAR:?}` — без `.env` команда падает с `required variable … is missing a value` (S2), а не стартует с пустым паролем.

**К2. Сервисы, порты, профили, healthcheck** (все порты — `127.0.0.1`):

| Сервис | Образ (тег + `@sha256:`) | Порты host → container | Профиль | Healthcheck | Volume |
|---|---|---|---|---|---|
| `postgres` | `postgres:17` | `${POSTGRES_PORT:-5432}` → 5432 | — | `pg_isready -U ${PG_SUPERUSER} -d ortus_control`, 5s × 10 | `pg:/var/lib/postgresql/data` |
| `postgres-test` | тот же digest, что `postgres` | `5433` → 5432 | `test` | как у `postgres` (`-U ortus -d ortus_test`) | `tmpfs: /var/lib/postgresql/data`; `command: postgres -c fsync=off -c full_page_writes=off -c synchronous_commit=off` |
| `minio` | `minio/minio` | `9000` → 9000, `9001` → 9001 | — | `mc ready local` (fallback: `curl -f http://127.0.0.1:9000/minio/health/live`) | `minio:/data` |
| `minio-init` | `minio/mc` | — | `init` | нет (одноразовый, `restart: "no"`, `depends_on: minio: condition: service_healthy`) | — |
| `mailpit` | `axllent/mailpit` | `8025` → 8025, `1025` → 1025 | — | `/mailpit readyz` (fallback: TCP 8025) | — |
| `otel-collector` | `otel/opentelemetry-collector-contrib` | `4317` → 4317, `4318` → 4318, `13133` → 13133 | — | нет (образ без shell); проверка снаружи `GET http://127.0.0.1:13133/` | `./otel/collector.yaml:/etc/otelcol-contrib/config.yaml:ro` |
| `keycloak` | `quay.io/keycloak/keycloak` (26.x) | `8081` → 8080 | `keycloak` | через `/dev/tcp` на `127.0.0.1:9000/health/ready` при `KC_HEALTH_ENABLED=true` (12 §3.2 R8) | `./keycloak:/opt/keycloak/data/import:ro` (каталог — WS-54) |

Переменные `postgres`: `POSTGRES_USER=${PG_SUPERUSER:?}`, `POSTGRES_PASSWORD=${PG_SUPERPASS:?}`, `POSTGRES_DB=ortus_control`, `POSTGRES_INITDB_ARGS=--encoding=UTF8 --data-checksums` (локаль не задаётся — коллация `ru` решается в миграциях WS-41, §10). `postgres-test`: `POSTGRES_USER=ortus`, `POSTGRES_PASSWORD=ortus`, `POSTGRES_DB=ortus_test`. Project name `ortus` (`skeleton/docker-compose.yml:2`) → контейнеры `ortus-<svc>-1`, volumes `ortus_pg`, `ortus_minio`, сеть `ortus_default`.

**К3. Профили**: без профиля — `postgres`, `minio`, `mailpit`, `otel-collector`; `--profile test` добавляет `postgres-test`; `--profile keycloak` — `keycloak`; `--profile init` — `minio-init` (запускается только `docker compose … --profile init run --rm minio-init`, никогда не в `up --wait` — 12 §3.6:212). Профиль `e2e` в базовом файле не объявлен: его собирает WS-53 override-файлом `deploy/compose/profiles/e2e/compose.yml` (`-f … -f …`), который может только добавлять сервисы (`seed`, `api`, `web`) и ссылаться на имена К2; `docker compose … --profile e2e config` на базовом файле обязан не падать (S4).

**К4. `.env.example`** — состав (каждая строка с комментарием, значения = compose):

| Группа | Переменные | Умолчание |
|---|---|---|
| Приложение (новые, карточка §5.4:628) | `APP_ENV` | `dev` (`dev` \| `e2e` \| `prod`; `e2e` включает заголовок `X-Test-Scenario` и пороги прототипа — PD-31, PD-46; `prod` — канон) |
| | `HTTP_ADDR` | `127.0.0.1:8080` (Q-112; не `0.0.0.0`) |
| | `AUTH_PROVIDER` | `dev` (`dev` \| `oidc`; `devLogin` только при `dev` — PD-18, WS-40 §5.4:654) |
| PostgreSQL (`skeleton/.env.example:4–10`) | `POSTGRES_PORT`, `PG_SUPERUSER`, `PG_SUPERPASS`, `CONTROL_DB_URL`, `TENANT_DB_HOST`, `TENANT_DB_POOL_MAX`, `TENANT_DB_POOL_BUDGET`, `TENANT_DB_IDLE_TTL` | `5432`, `ortus_admin`, `change-me-local`, `postgres://ortus_api:change-me@localhost:5432/ortus_control?sslmode=disable`, `localhost:5432`, `4`, `80`, `5m` |
| Тестовая база (новое) | `PG_TEST_PORT`, `TEST_DB_URL` | `5433`, `postgres://ortus:ortus@127.0.0.1:5433/ortus_test?sslmode=disable` |
| S3 (`:13–19`) | `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `UPLOAD_URL_TTL`, `DOWNLOAD_URL_TTL` | `http://localhost:9000`, `ru-local`, `ortus-files`, `ortus`, `change-me-local`, `10m`, `2m` |
| Keycloak (новое — compose `:31–32` ссылается, в `.env.example` их нет) | `KC_ADMIN`, `KC_ADMIN_PASS` | `admin`, `change-me-local` |
| OIDC (`:22–26`) | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL`, `OPERATOR_OIDC_ISSUER` | как в скелете (`http://localhost:8081/realms/ortus`, `ortus-web`, `change-me-local`, `http://localhost:5173/auth/callback`, `http://localhost:8081/realms/ortus-operators`) |
| Сессия BFF (`:29–31`) | `SESSION_COOKIE_NAME`, `SESSION_TTL`, `ALLOWED_ORIGINS` | `ortus_sid`, `12h`, `http://localhost:5173` |
| Почта (`:34–35`) | `SMTP_HOST`, `SMTP_PORT` | `localhost`, `1025` |
| Наблюдаемость (`:38–39`) | `OTEL_EXPORTER_OTLP_ENDPOINT`, `LOG_LEVEL` | `http://localhost:4317`, `debug` |
| Продуктовые гипотезы (`:42–46`) | `TRIAL_DAYS`, `TRIAL_SEATS`, `TRIAL_STORAGE_BYTES`, `GRACE_DAYS`, `HOLD_TTL` | `14`, `10`, `5368709120`, `7`, `15m` |

Имена и значения из скелета не переименовываются (R17 «Имена из `design/docs/repo-skeleton/.env.example:1–46`»). Файл начинается строкой `# Ортус · пример конфигурации локального стенда. Реальные секреты сюда не попадают.` (`skeleton/.env.example:1`).

**К5. Строка запуска тестовой базы** (потребляет харнесс WS-07, 12 §6 п.11 «с текстом, содержащим `start it with` и команду запуска базы»):

```text
start it with: docker compose -f deploy/compose/docker-compose.yml --env-file .env --profile test up -d --wait postgres-test
```

DSN по умолчанию харнесса = `TEST_DB_URL` из К4.

**К6. Один стенд на машину.** `name: ortus` фиксирован → все worktree делят один набор контейнеров (12 §3.5 п.5: «общая 5433»; «`db:reset` … только интегратор»). Исполнители WS-40/41/42+ не выполняют `down -v` чужого стенда; Go-тесты масштабируются уникальными идентификаторами, без `TRUNCATE` (12 §6 п.12). Изоляция при необходимости: `COMPOSE_PROJECT_NAME=ortus-ws41 POSTGRES_PORT=15432 PG_TEST_PORT=15433` в `.env` worktree (приоритет `COMPOSE_PROJECT_NAME` над `name:` — compose v2) — описано в `deploy/compose/README.md`.

**К7. Digest образов** — потребляет WS-41 (testcontainers на том же `postgres:17@sha256:…`, Q-107, R15 §10.1) и WS-53 (эфемерный стенд CI на тех же digest). Каждый `image:` сопровождается комментарием `# <tag> · digest снят <дата> · docker buildx imagetools inspect <image>:<tag>`.

### 4.2 Потребляет

| От кого | Что | Если нет |
|---|---|---|
| WS-01 | корневой `Makefile` с целями `up`/`down` (§5.4:626 «`Makefile` (`gen/up/down/migrate/seed/dev/examples/test`)»); `.gitignore` с `.env`; `README.md` Windows-onboarding | WS-02 **не** правит эти файлы: если `make up` ≠ К1, в отчёте раздел «Контракты, которые я изменил» содержит точный текст целей `up: docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d --wait`, `down: … down`, `stand-check: powershell -NoProfile -ExecutionPolicy Bypass -File tools/stand-check.ps1` — вносит интегратор; до этого исполнитель пользуется К1 напрямую |
| WS-07 (позже) | харнесс `backend/test/harness.go` с текстом К5 | не нужен для DoD WS-02; К5 публикуется в `deploy/compose/README.md` и в отчёте |
| WS-41 (позже) | роли БД `migrator`/`api_runtime`/`worker_runtime`/`provisioner` (`14:81`) и пользователь `ortus_api` из `CONTROL_DB_URL` | compose создаёт только суперпользователя `${PG_SUPERUSER}` и базу `ortus_control`; initdb-скриптов (`/docker-entrypoint-initdb.d`) WS-02 не добавляет — роли принадлежат миграциям (§10 п.5) |
| WS-53 / WS-54 (позже) | `profiles/e2e/compose.yml`; `keycloak/realm-*.json` | профиль `keycloak` стартует без realm-файлов (пустой импорт) — L8 проверяет только healthcheck |

Фейков/MSW у infra-WS нет; «контракт ещё не существует» = соответствующая проверка `stand-check` помечена `SKIP` с причиной (не `OK`).

### 4.3 Черновики файлов (исходная точка исполнителя; `<digest>`/`<tag>`/`<дата>` заполняются в цикле §7 п.6)

Черновики ниже прогнаны планировщиком 03.10.2026 через `docker compose config` (Compose v2.31.0) с плейсхолдерами: S1 — exit 0; S2 — `error while interpolating services.postgres.environment.POSTGRES_USER: required variable PG_SUPERUSER is missing a value`, exit 15; S3 — `mailpit minio otel-collector postgres`; `--profile test` добавляет `postgres-test`, `--profile e2e` (не объявлен) — без ошибки; в `config --format json` все `host_ip` = `127.0.0.1`, `keycloak.volumes[0].read_only = true`, `minio-init.restart = "no"`, `depends_on.minio.condition = service_healthy`, `postgres-test.tmpfs = /var/lib/postgresql/data`. Живые проверки L1–L10 на образах планировщик не выполнял — это работа исполнителя.

`deploy/compose/docker-compose.yml` — структура, которую проверяют S1–S9 (длинный синтаксис `ports` нужен для `host_ip`; `$$` — экранирование для shell внутри контейнера):

```yaml
# Локальный стенд Ортус. Не для production.                       (skeleton/docker-compose.yml:1)
# Вызов из корня: docker compose -f deploy/compose/docker-compose.yml --env-file .env <cmd>   (К1)
# Digest: docker buildx imagetools inspect <image>:<tag>            (D-04, PD-38; К7)
name: ortus

x-hc-defaults: &hc-defaults
  interval: 5s
  timeout: 3s
  retries: 10
  start_period: 10s

x-pg-image: &pg-image postgres:17@sha256:<digest>   # postgres:17.<minor> · digest снят <дата>

services:
  postgres:
    image: *pg-image
    environment:
      POSTGRES_USER: ${PG_SUPERUSER:?}
      POSTGRES_PASSWORD: ${PG_SUPERPASS:?}
      POSTGRES_DB: ortus_control
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --data-checksums"
    ports:
      - { target: 5432, published: "${POSTGRES_PORT:-5432}", host_ip: 127.0.0.1, protocol: tcp }
    volumes: [pg:/var/lib/postgresql/data]
    healthcheck:
      <<: *hc-defaults
      test: ["CMD-SHELL", "pg_isready -U ${PG_SUPERUSER} -d ortus_control"]

  postgres-test:                       # 12 §3.2 R8; 12 §6 п.11–12; профиль test
    image: *pg-image
    profiles: [test]
    command: postgres -c fsync=off -c full_page_writes=off -c synchronous_commit=off
    environment:
      POSTGRES_USER: ortus
      POSTGRES_PASSWORD: ortus
      POSTGRES_DB: ortus_test
      POSTGRES_INITDB_ARGS: "--encoding=UTF8"
    ports:
      - { target: 5432, published: "${PG_TEST_PORT:-5433}", host_ip: 127.0.0.1, protocol: tcp }
    tmpfs: [/var/lib/postgresql/data]
    healthcheck:
      <<: *hc-defaults
      test: ["CMD-SHELL", "pg_isready -U ortus -d ortus_test"]

  minio:                               # skeleton:18–25
    image: minio/minio:<tag>@sha256:<digest>
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY:?}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY:?}
    ports:
      - { target: 9000, published: "9000", host_ip: 127.0.0.1, protocol: tcp }
      - { target: 9001, published: "9001", host_ip: 127.0.0.1, protocol: tcp }
    volumes: [minio:/data]
    healthcheck:
      <<: *hc-defaults
      test: ["CMD", "mc", "ready", "local"]      # fallback: curl -f http://127.0.0.1:9000/minio/health/live (§10 п.8)

  minio-init:                          # одноразовый, вне --wait (12 §3.6:212; 12 §8 п.24); профиль init
    image: minio/mc:<tag>@sha256:<digest>
    profiles: [init]
    restart: "no"
    depends_on:
      minio: { condition: service_healthy }
    environment:
      S3_ACCESS_KEY: ${S3_ACCESS_KEY:?}
      S3_SECRET_KEY: ${S3_SECRET_KEY:?}
      S3_BUCKET: ${S3_BUCKET:-ortus-files}
    entrypoint: ["/bin/sh", "-c"]
    command:
      - >
        mc alias set local http://minio:9000 "$$S3_ACCESS_KEY" "$$S3_SECRET_KEY" &&
        mc mb --ignore-existing "local/$$S3_BUCKET" &&
        mc anonymous set none "local/$$S3_BUCKET"

  mailpit:                             # skeleton:36–38
    image: axllent/mailpit:<tag>@sha256:<digest>
    ports:
      - { target: 8025, published: "8025", host_ip: 127.0.0.1, protocol: tcp }
      - { target: 1025, published: "1025", host_ip: 127.0.0.1, protocol: tcp }
    healthcheck:
      <<: *hc-defaults
      test: ["CMD", "/mailpit", "readyz"]        # fallback: TCP 8025 (§10 п.8)

  otel-collector:                      # skeleton:40–42; конфигурация — ./otel/collector.yaml (§6б)
    image: otel/opentelemetry-collector-contrib:<tag>@sha256:<digest>
    command: ["--config=/etc/otelcol-contrib/config.yaml"]
    volumes: ["./otel/collector.yaml:/etc/otelcol-contrib/config.yaml:ro"]
    ports:
      - { target: 4317, published: "4317", host_ip: 127.0.0.1, protocol: tcp }
      - { target: 4318, published: "4318", host_ip: 127.0.0.1, protocol: tcp }
      - { target: 13133, published: "13133", host_ip: 127.0.0.1, protocol: tcp }
    # healthcheck отсутствует: образ без shell; проверка снаружи GET http://127.0.0.1:13133/ (L5)

  keycloak:                            # skeleton:27–34; PD-18/PD-41: только профиль keycloak
    image: quay.io/keycloak/keycloak:<tag>@sha256:<digest>
    profiles: [keycloak]
    command: start-dev --import-realm
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${KC_ADMIN:?}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${KC_ADMIN_PASS:?}
      KC_HEALTH_ENABLED: "true"
    ports:
      - { target: 8080, published: "8081", host_ip: 127.0.0.1, protocol: tcp }
    volumes: ["./keycloak:/opt/keycloak/data/import:ro"]   # realm-ortus.json, realm-operators.json — WS-54
    healthcheck:
      <<: *hc-defaults
      start_period: 60s
      retries: 30
      test: ["CMD-SHELL", "exec 3<>/dev/tcp/127.0.0.1/9000 && printf 'GET /health/ready HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q '\"status\": \"UP\"' <&3"]

volumes:
  pg: {}
  minio: {}

# Профиль e2e (seed/api/web для эфемерного стенда CI) — override deploy/compose/profiles/e2e/compose.yml, WS-53 (§10 п.1).
```

`deploy/compose/.env.example` — состав К4; комментарий у каждой переменной (R17), инлайн-комментарий отделён пробелом (так его понимает парсер compose):

```dotenv
# Ортус · пример конфигурации локального стенда. Реальные секреты сюда не попадают.
# Копия: cp deploy/compose/.env.example .env (корень репозитория, 14:99); compose читает через --env-file .env (К1).

# --- Приложение (api, worker) ---
APP_ENV=dev                        # dev | e2e | prod; e2e принимает X-Test-Scenario (PD-31) и пороги прототипа (PD-46); prod — канон
HTTP_ADDR=127.0.0.1:8080           # адрес API; не 0.0.0.0 (Q-112); Vite proxy /api -> 127.0.0.1:8080 (мастер-план §4.7)
AUTH_PROVIDER=dev                  # dev | oidc; dev — вход учёткой из сида через BFF, devLogin только при dev (PD-18, WS-40); oidc — Keycloak (WS-54)

# --- PostgreSQL (сервис postgres) ---
POSTGRES_PORT=5432                 # published-порт control DB на 127.0.0.1; при изоляции стенда менять вместе с CONTROL_DB_URL/TENANT_DB_HOST (К6)
PG_SUPERUSER=ortus_admin           # суперпользователь контейнера: только make migrate / бутстрап ролей (WS-41), не API
PG_SUPERPASS=change-me-local       # заглушка; реальный пароль — только в .env
CONTROL_DB_URL=postgres://ortus_api:change-me@localhost:5432/ortus_control?sslmode=disable   # DSN API к control DB; в коде умолчания нет (12 §5 п.29); роль ortus_api создаёт WS-41
TENANT_DB_HOST=localhost:5432      # хост tenant DB (в local — та же инстанция)
TENANT_DB_POOL_MAX=4               # соединений на тенант; общий бюджет ниже
TENANT_DB_POOL_BUDGET=80           # соединений на процесс
TENANT_DB_IDLE_TTL=5m              # закрытие простаивающего пула тенанта

# --- Тестовая база (профиль test, сервис postgres-test, tmpfs) ---
PG_TEST_PORT=5433                  # published-порт postgres-test на 127.0.0.1
TEST_DB_URL=postgres://ortus:ortus@127.0.0.1:5433/ortus_test?sslmode=disable   # DSN харнесса backend/test (WS-07); start it with: docker compose -f deploy/compose/docker-compose.yml --env-file .env --profile test up -d --wait postgres-test

# --- Объектное хранилище (MinIO) ---
S3_ENDPOINT=http://localhost:9000  # S3 API MinIO; консоль — http://127.0.0.1:9001
S3_REGION=ru-local                 # регион подписи (MinIO принимает любой)
S3_BUCKET=ortus-files              # создаёт одноразовый minio-init: docker compose ... --profile init run --rm minio-init
S3_ACCESS_KEY=ortus                # = MINIO_ROOT_USER
S3_SECRET_KEY=change-me-local      # = MINIO_ROOT_PASSWORD; заглушка
UPLOAD_URL_TTL=10m                 # срок presigned PUT
DOWNLOAD_URL_TTL=2m                # срок presigned GET

# --- Keycloak (профиль keycloak; не в фазе 1 — PD-18) ---
KC_ADMIN=admin                     # KC_BOOTSTRAP_ADMIN_USERNAME; обязателен для config даже без профиля (${KC_ADMIN:?})
KC_ADMIN_PASS=change-me-local      # KC_BOOTSTRAP_ADMIN_PASSWORD; заглушка

# --- OIDC (BFF; действует при AUTH_PROVIDER=oidc) ---
OIDC_ISSUER=http://localhost:8081/realms/ortus                       # realm клиентов (D-03)
OIDC_CLIENT_ID=ortus-web                                             # клиент BFF
OIDC_CLIENT_SECRET=change-me-local                                   # заглушка
OIDC_REDIRECT_URL=http://localhost:5173/auth/callback                # один origin (PD-25)
OPERATOR_OIDC_ISSUER=http://localhost:8081/realms/ortus-operators    # realm операторов (D-03)

# --- Сессия BFF ---
SESSION_COOKIE_NAME=ortus_sid      # HttpOnly cookie сессии (12 §5 п.6)
SESSION_TTL=12h                    # срок сессии
ALLOWED_ORIGINS=http://localhost:5173   # проверка Origin на мутациях (CSRF, 12 §5 п.7)

# --- Почта (Mailpit) ---
SMTP_HOST=localhost                # SMTP-ловушка; письма видны в http://127.0.0.1:8025
SMTP_PORT=1025                     # порт SMTP Mailpit

# --- Наблюдаемость ---
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317   # OTLP gRPC коллектора; HTTP — :4318; health — :13133
LOG_LEVEL=debug                    # уровень log/slog в local

# --- Продуктовые параметры-гипотезы (PLAT-03, не тариф) ---
TRIAL_DAYS=14                      # длительность пробного периода
TRIAL_SEATS=10                     # мест в пробном периоде
TRIAL_STORAGE_BYTES=5368709120     # 5 ГиБ (прототип показывает 100 ГБ — Q-13; UI фазы 1 берёт значение из сида)
GRACE_DAYS=7                       # льготный период
HOLD_TTL=15m                       # удержание брони машины
```

`deploy/compose/README.md` — обязательные разделы (проверяет 6б): «Запуск» (К1, `cp … .env`, `up -d --wait`, ≤ 120 с), «Порты» (таблица К2), «Профили» (К3 с командами `--profile test up -d --wait postgres-test`, `--profile init run --rm minio-init`, `--profile keycloak up -d --wait keycloak`), «Тестовая база для Go» (К5 дословно, `TEST_DB_URL`), «Один стенд на машину» (К6, пример `COMPOSE_PROJECT_NAME=ortus-ws41 POSTGRES_PORT=15432 PG_TEST_PORT=15433`), «Сброс» (`down` сохраняет данные, `down -v` стирает), «Проверка» (`tools/stand-check.ps1`, флаги), «Windows» (`curl.exe --noproxy "*"`, PowerShell 5.1 без `&&`, Docker Desktop), «Что дальше» (`make migrate`/`make seed`/`make dev` — WS-41/52/40; `profiles/e2e` — WS-53; `keycloak/` — WS-54).

## 5. Экраны, диалоги, состояния

Страниц, диалогов и ключей §5.3 у WS-02 нет (`pages: []`); эталон 4173 не применим. Вместо экранов — состояния стенда, которые проверяются и попадают в evidence:

| Ключ | Объект | Кто использует (роль) | Строки источника | Состояния | Проверка (§6) | URL / адрес |
|---|---|---|---|---|---|---|
| `stand/config` | `docker-compose.yml` + `.env.example` без запуска контейнеров | исполнитель, CI (`config` не требует демона) | `skeleton/docker-compose.yml:1–48`, `skeleton/.env.example:1–46` | валиден с example / падает без `.env` / набор сервисов по профилям | S1–S12 | — |
| `stand/postgres` | control DB `ortus_control` | WS-40, WS-41, WS-43, интегратор барьера 0→1 (§6.5:799 «`-tags integration`») | `skeleton:5–16`; 12 R8 | down / starting / healthy / данные сохранены после `down` / стёрты после `down -v` | L1, L2, L9, L10 | `127.0.0.1:5432` |
| `stand/postgres-test` | tmpfs-база для харнесса | WS-07 харнесс, WS-53 | 12 R8; 12 §6 п.11–12 | профиль выключен (нет контейнера) / healthy / пустая после перезапуска | L7 | `127.0.0.1:5433` (`TEST_DB_URL`) |
| `stand/minio` | S3 + консоль | WS-45 (upload session), WS-53 | `skeleton:18–25` | healthy / bucket `ortus-files` отсутствует до `minio-init` / создан / `minio-init` завершён и не в `ps` | L3, L6 | `http://127.0.0.1:9000`, консоль `http://127.0.0.1:9001/` |
| `stand/mailpit` | SMTP-ловушка + UI | WS-44 (приглашения, письмо `:1423`), WS-54 | `skeleton:36–38` | healthy / SMTP баннер `220` | L4 | `http://127.0.0.1:8025/`, SMTP `127.0.0.1:1025` |
| `stand/otel` | OTLP-коллектор | WS-40 (`log/slog` + OTel, `14:21`) | `skeleton:40–42` | running / `health_check` 200 / принимает `POST /v1/traces` | L5 | `127.0.0.1:4317` (gRPC), `http://127.0.0.1:4318`, `http://127.0.0.1:13133/` |
| `stand/keycloak` | IdP под профилем | WS-54 (`@keycloak` smoke, PD-41) | `skeleton:27–34`; 12 R8; 12 §8 п.23 | профиль выключен / healthy без realm / (с realm — WS-54) | L8 | `http://127.0.0.1:8081/` |

Подписи сторонних UI (консоль MinIO, Mailpit) не являются эталоном прототипа и дословно не фиксируются: проверяется HTTP-статус и наличие `<title>`; MCP-снимки в §8 — evidence доступности стенда, не визуальная сверка.

## 6. Тесты первыми

Для infra-WS (§8.1:936, колонка infra: шаг 1 «smoke», шаг 4 «compose smoke») роль e2e-скелета играет `tools/stand-check.ps1`: он пишется **первым коммитом** со всеми проверками ниже, запускается и падает (`[FAIL] S1 …` — файла нет), затем каждый TDD-цикл §7 переводит проверки в `[OK]` по одной. Интерфейс: `powershell -NoProfile -ExecutionPolicy Bypass -File tools/stand-check.ps1 [-Static] [-Live] [-Profile test,keycloak,init] [-Only S1,L2] [-EnvFile .env] [-OutFile docs/plan/evidence/stand/stand-check.txt]`; без флагов — `-Static` + `-Live` без профилей; код возврата = число `FAIL`; формат строки `[OK|FAIL|SKIP] <id> <что проверено>: <факт>`; итог `stand-check: N ok, M fail, K skip`. Скрипт — PowerShell 5.1-совместимый (без `&&`, `??`, `?:`; 12 §3.6:198), `curl.exe --noproxy "*"` (12 §3.6:200), только ASCII (PS 5.1 без BOM читает файл как ANSI), HTTP-проверки через `curl.exe -s -o NUL -w "%{http_code}"`.

### 6а. Скелет проверок (= будущие `test()`; 22 пункта)

Статические (нужен только `docker` CLI; переменные: `$F = deploy/compose/docker-compose.yml`, `$E = deploy/compose/.env.example`, `$C = docker compose -f $F`):

1. **S1** Given `$F` и `$E`; When `$C --env-file $E config -q`; Then код возврата 0.
2. **S2** Given `$F`; When `$C config -q` без `--env-file` и без `.env` в `deploy/compose/`; Then код ≠ 0 и stderr содержит `required variable PG_SUPERUSER is missing a value` (compose сообщает только первую недостающую); полнота — по тексту `$F`: каждая из `PG_SUPERUSER`, `PG_SUPERPASS`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `KC_ADMIN`, `KC_ADMIN_PASS` встречается в форме `${VAR:?}`.
3. **S3** Given `$E`; When `$C --env-file $E config --services`; Then отсортированный список ровно `mailpit`, `minio`, `otel-collector`, `postgres`.
4. **S4** Given то же; When добавлен `--profile test` / `--profile keycloak` / `--profile init` / `--profile e2e`; Then список S3 плюс ровно `postgres-test` / `keycloak` / `minio-init` / ничего (без ошибки).
5. **S5** Given `$C --env-file $E --profile test --profile keycloak --profile init config --format json`; When собраны все `services.*.ports[]`; Then у каждого `host_ip == "127.0.0.1"` и множество `published` = `{5432, 5433, 9000, 9001, 8025, 1025, 4317, 4318, 13133, 8081}`.
6. **S6** Given тот же JSON; When прочитаны `services.*.image`; Then каждый соответствует `^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$` (тег и digest), и ни один не содержит `:latest`.
7. **S7** Given тот же JSON; Then `healthcheck.test` непуст у `postgres`, `postgres-test`, `minio`, `mailpit`, `keycloak` и отсутствует у `otel-collector`, `minio-init`.
8. **S8** Given `services["postgres-test"]`; Then `profiles == ["test"]`, `tmpfs` содержит `/var/lib/postgresql/data`, `command` содержит `fsync=off`, `full_page_writes=off`, `synchronous_commit=off`, `ports[0].published == 5433`, `image` равен `services.postgres.image` (тот же digest).
9. **S9** Given `services["minio-init"]`; Then `profiles == ["init"]`, `restart == "no"`, `depends_on.minio.condition == "service_healthy"`; Given `services.keycloak`; Then `profiles == ["keycloak"]`, `volumes[0].target == "/opt/keycloak/data/import"`, `read_only == true`, `environment.KC_HEALTH_ENABLED == "true"`.
10. **S10** Given `$F` и `$E`; When из `$F` извлечены все `${VAR…}`; Then каждая `VAR` объявлена в `$E`, и `$E` содержит дословно строки `APP_ENV=dev`, `HTTP_ADDR=127.0.0.1:8080`, `AUTH_PROVIDER=dev`, `PG_TEST_PORT=5433`, `TEST_DB_URL=postgres://ortus:ortus@127.0.0.1:5433/ortus_test?sslmode=disable`, `KC_ADMIN=admin`, `S3_BUCKET=ortus-files`, `SESSION_COOKIE_NAME=ortus_sid`, `SMTP_PORT=1025`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317`, и первая строка файла равна `# Ортус · пример конфигурации локального стенда. Реальные секреты сюда не попадают.`.
11. **S11** Given `$E`; Then у каждой строки `KEY=value` есть комментарий (` # …` в той же строке или строка `# …` непосредственно выше); значения всех ключей с `PASS`, `SECRET`, `KEY` в имени ∈ {`change-me-local`, `change-me`, `ortus`}; ни `$F`, ни `$E`, ни `deploy/compose/otel/collector.yaml` (кроме внутриконтейнерных `endpoint: 0.0.0.0:…` коллектора) не содержат `0.0.0.0` в published-портах и `HTTP_ADDR`.
12. **S12** Given корневой `.gitignore` (WS-01) и `tools/stand-check.ps1`; Then `.gitignore` содержит строку `.env` (иначе `FAIL` с текстом `request to integrator: add .env to .gitignore`), `Select-String -Pattern '[^\x00-\x7F]' tools/stand-check.ps1` пуст, `git status --porcelain` не содержит `.env`.

Живые (нужен Docker Desktop и `.env`; скрипт сам делает `copy deploy/compose/.env.example .env`, если `.env` нет, и пишет об этом):

13. **L1** Given стенд остановлен; When `$C --env-file .env up -d --wait`; Then код 0 за ≤ 120 с; `$C ps --format json` показывает 4 контейнера `State == "running"`, у `postgres`, `minio`, `mailpit` `Health == "healthy"`, и нет контейнеров `postgres-test`, `keycloak`, `minio-init`.
14. **L2** Given L1; When `$C exec -T postgres pg_isready -U $env:PG_SUPERUSER -d ortus_control`; Then вывод содержит `accepting connections`; When `… psql -U $env:PG_SUPERUSER -d ortus_control -Atc "select version()"` / `"show server_encoding"`; Then содержит `PostgreSQL 17.` / равно `UTF8`.
15. **L3** Given L1; When `curl.exe --noproxy "*" -s -o NUL -w "%{http_code}" http://127.0.0.1:9000/minio/health/live` и `… http://127.0.0.1:9001/`; Then `200` и `200`.
16. **L4** Given L1; When `GET http://127.0.0.1:8025/readyz`; Then `200`; When TCP-подключение к `127.0.0.1:1025` (`System.Net.Sockets.TcpClient`) и чтение первой строки; Then строка начинается с `220`.
17. **L5** Given L1; When `GET http://127.0.0.1:13133/`; Then `200`; When `POST http://127.0.0.1:4318/v1/traces` с телом `{}` и `content-type: application/json`; Then `200`.
18. **L6** Given L1 и `--profile init`; When `$C --env-file .env --profile init run --rm minio-init` дважды; Then оба раза код 0 (идемпотентно); When `$C exec -T minio mc ls local/`; Then содержит `ortus-files/`; When `$C ps --format json`; Then нет записи `minio-init`.
19. **L7** Given `--profile test`; When `$C --env-file .env --profile test up -d --wait postgres-test`; Then healthy, TCP `127.0.0.1:5433` открыт; When `$C exec -T postgres-test psql -U ortus -d ortus_test -Atc "show fsync"`; Then `off`; When `create table t_ws02(id int)` → `$C --profile test stop postgres-test` → `rm -f` → `up -d --wait postgres-test` → `select to_regclass('t_ws02')`; Then пусто (tmpfs не переживает пересоздание).
20. **L8** Given `-Profile keycloak`; When `$C --env-file .env --profile keycloak up -d --wait keycloak`; Then healthy за ≤ 180 с; `GET http://127.0.0.1:8081/` ∈ {200, 302, 303}; без `-Profile keycloak` — `SKIP L8 keycloak profile not requested`.
21. **L9** Given L1; When `$C ps --format json`; Then у каждой записи `Publishers[].URL == "127.0.0.1"`.
22. **L10** Given L1; When `create table t_ws02_keep(id int)` в `ortus_control` → `$C down` → `up -d --wait` → `select to_regclass('t_ws02_keep')`; Then `t_ws02_keep` (volume `ortus_pg` сохранён); When `drop table t_ws02_keep` → `$C down -v`; Then `docker volume ls --filter name=ortus_` пуст и `$C ps -q` пуст (стенд оставлен остановленным).

Пункты сторонних сюит, для которых WS-02 обеспечивает «Given» (не входят в число 22; владелец — WS-07, 12 §6):

- 12 §6 п.11 дословно: «Given `docker compose --profile test up -d --wait postgres-test` **не** выполнен; When `go -C backend test -tags=integration ./test/...`; Then тесты **падают** (не skip) с текстом, содержащим `start it with` и команду запуска базы (`harness.go:57–59, 78`)» — команда = К5.
- 12 §6 п.12 дословно: «Given база поднята; When тот же запуск; Then `TestMain` применяет миграции `migrations/control/*.up.sql` и `migrations/tenant/*.up.sql` лексикографически и все тесты параллельны (`t.Parallel()`), каждый — на уникальном идентификаторе тенанта/аккаунта, без `TRUNCATE`» — база = `postgres-test`, DSN = `TEST_DB_URL`.

### 6б. Unit (табличные проверки файлов)

Это S1–S12 выше: вход — файлы `$F`, `$E`, `collector.yaml`; ожидание — таблица §4.1 К2/К4. Дополнительные табличные случаи внутри `-Static`:

| Вход | Ожидание |
|---|---|
| `collector.yaml` → `extensions.health_check.endpoint` | `0.0.0.0:13133` (внутри контейнера), `service.extensions` содержит `health_check` |
| `collector.yaml` → `receivers.otlp.protocols.{grpc,http}.endpoint` | `0.0.0.0:4317`, `0.0.0.0:4318` |
| `collector.yaml` → `service.pipelines.{traces,metrics,logs}.exporters` | `[debug]` (D-07 не решён — хранилище не подключается) |
| `README.md` в `deploy/compose/` | содержит К1, К5, таблицу портов К2, абзац «Один стенд на машину» (К6), команду `stand-check` |

Черновик `deploy/compose/otel/collector.yaml` (ожидания таблицы выше):

```yaml
# OpenTelemetry Collector (contrib) для локального стенда. Хранилище не выбрано (D-07) — только debug-экспортёр.
extensions:
  health_check:
    endpoint: 0.0.0.0:13133          # внутри контейнера; наружу — 127.0.0.1:13133 (L5)
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
processors:
  batch: {}
exporters:
  debug:
    verbosity: basic
service:
  extensions: [health_check]
  pipelines:
    traces:  { receivers: [otlp], processors: [batch], exporters: [debug] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [debug] }
    logs:    { receivers: [otlp], processors: [batch], exporters: [debug] }
```

`0.0.0.0` здесь — адреса внутри контейнера (наружу публикуются только на `127.0.0.1`, S5); проверка S11 исключает именно эти три `endpoint:`.

### 6в. Компонентные

Не применимо (нет UI-компонентов и страниц; axe/клавиатура — §8.1 колонка infra «—»).

### 6г. Контрактные / интеграционные

L1–L10 выше — это интеграционные проверки стенда (`§8.1` шаг 4 «compose smoke»). `Problem.code`, изоляция и конкурентность — не в объёме WS-02 (нет API); изоляция стенда между worktree — К6 (документ + `COMPOSE_PROJECT_NAME`), проверяется вручную один раз в L-цикле §7 п.11: второй проект `COMPOSE_PROJECT_NAME=ortus-ws02b POSTGRES_PORT=15432 PG_TEST_PORT=15433` поднимается рядом с основным без конфликта портов и удаляется `down -v`.

## 7. Шаги реализации (TDD-циклы)

Оценка — минуты чистой работы агента; суммарно ≈ 4–5 ч (размер S, §5.1:492). Каждый цикл: красный прогон → коммит `test(ws-02)` только в цикле 1 (скелет содержит все проверки сразу, как `test.fixme`), далее `feat(ws-02)`/`refactor(ws-02)` с выводом `stand-check -Only …` в сообщении коммита или в отчёте.

| # | Единица | Красный тест (что падает) | Реализовать | Рефакторить | Оценка |
|---|---|---|---|---|---|
| 0 | подготовка | — | worktree, `pnpm install`, `docker compose version` в отчёт, `mkdir deploy/compose`, `docs/plan/status.md:9` → `в работе`, ветка | — | 10 |
| 1 | скелет проверок | `tools/stand-check.ps1` со всеми S1–S12, L1–L10 (L-часть под `-Live`), запуск `-Static` → `S1 FAIL: file not found` и далее все `FAIL`; коммит `test(ws-02): stand-check skeleton (S1-S12, L1-L10)` | — | — | 40 |
| 2 | базовый compose | S1, S3 красные | `docker-compose.yml`: `name: ortus`, `postgres`, `minio`, `mailpit`, `otel-collector` с образами по тегу, volumes `pg`, `minio`; `.env.example` = копия скелета `:1–46` | — | 20 |
| 3 | обязательные переменные | S2 красный (config проходит без `.env`) | `${PG_SUPERUSER:?}`, `${PG_SUPERPASS:?}`, `${S3_ACCESS_KEY:?}`, `${S3_SECRET_KEY:?}`, `${KC_ADMIN:?}`, `${KC_ADMIN_PASS:?}`; `KC_ADMIN`/`KC_ADMIN_PASS` в `.env.example` | YAML-якоря `x-pg-env` для `postgres`/`postgres-test` | 10 |
| 4 | профили | S4, S8, S9 красные | `postgres-test` (`profiles: [test]`, 5433, tmpfs, `command` с `fsync=off …`), `keycloak` (`profiles: [keycloak]`, `KC_HEALTH_ENABLED`, bind `./keycloak`), `minio-init` (`profiles: [init]`, `minio/mc`, `mc alias set local http://minio:9000 … ; mc mb --ignore-existing local/${S3_BUCKET}`, `restart: "no"`, `depends_on` healthy) | вынести `x-oneoff` якорь | 25 |
| 5 | loopback-порты | S5, S11 красные | все `ports` в длинном синтаксисе `host_ip: 127.0.0.1`; `${POSTGRES_PORT:-5432}`, `${PG_TEST_PORT:-5433}`; `.env.example`: `POSTGRES_PORT`, `PG_TEST_PORT`, `HTTP_ADDR=127.0.0.1:8080`, `APP_ENV=dev`, `AUTH_PROVIDER=dev`, `TEST_DB_URL` | — | 15 |
| 6 | digest образов | S6 красный | для каждого образа: `docker buildx imagetools inspect <image>:<tag>` → `image: <image>:<tag>@sha256:<digest>` + комментарий с датой; `postgres-test` — тот же digest | — | 20 |
| 7 | healthcheck | S7 красный | `pg_isready`; `mc ready local`; `/mailpit readyz`; keycloak через `/dev/tcp`; у `otel-collector` и `minio-init` — нет | якорь `x-hc-defaults` (`interval: 5s`, `timeout: 3s`, `retries: 10`, `start_period: 10s`) | 15 |
| 8 | `.env.example` комментарии | S10, S11 (комментарии) красные | комментарий «что и почему» у каждой переменной, ссылки на PD-18/PD-31/Q-112 в тексте комментариев; первая строка дословно | — | 20 |
| 9 | коллектор | S12-часть README ещё нет; `-Live` L5 красный | `otel/collector.yaml` (§6б), bind `:ro`, порт 13133 | — | 15 |
| 10 | живой стенд по умолчанию | L1–L5, L9 красные (`-Live`) | `up -d --wait`; подправить healthcheck по фактическому образу (fallback К2); зафиксировать время старта в отчёте | — | 30 |
| 11 | одноразовый init и профили | L6, L7, L8 красные | `run --rm minio-init` (идемпотентность), `--profile test` tmpfs-проверка, `--profile keycloak` старт ≤ 180 с (один раз, вывод в evidence); проверка К6 второго проекта (§6г) | — | 40 |
| 12 | персистентность и уборка | L10 красный | `down` / `up` / `down -v` сценарий; скрипт оставляет стенд остановленным | — | 15 |
| 13 | README стенда | S12/6б README красный | `deploy/compose/README.md`: К1–К7, профили, сброс, Windows-заметки (`--noproxy`, PowerShell 5.1), «один стенд на машину» | — | 20 |
| 14 | evidence и отчёт | — | `stand-check -OutFile docs/plan/evidence/stand/stand-check.txt`; MCP-проходка §8; `docs/plan/reports/WS-02.md`; строка `status.md` → `на проверке`; `git diff --name-only main..HEAD` ⊆ §2 | — | 30 |

Порядок коммитов проверяется ревьюером: первая строка `git log --reverse --format=%s main..HEAD` начинается с `test(ws-02)` (12 §6 п.21).

## 8. Проверка стенда

Страниц нет → независимый проверяющий по `args.ws.pages` не запускается; проверку повторяет интегратор на барьере 0→1 (§6.5:799: «`go test ./...` + `-tags integration`» требует поднятого стенда; `docs/plan/reports/WS-0*.md`). Для этого отчёт WS-02 обязан содержать:

1. **Команда проверки** (аналог e2e): `powershell -NoProfile -ExecutionPolicy Bypass -File tools/stand-check.ps1 -Profile test,keycloak,init -OutFile docs/plan/evidence/stand/stand-check.txt` → ожидаемый итог `stand-check: 22 ok, 0 fail, 0 skip`; плюс `-Static` отдельно (CI-режим без демона) → `12 ok`.
2. **Эталон**: не применим (стенд не нарисован); вместо эталона — таблица К2 и `skeleton/docker-compose.yml:1–48`; расхождения перечисляются в отчёте (§10 п.1–4).
3. **Визуальная сверка**: не применима; `toMatchReference` не используется.
4. **MCP-проходка** (evidence доступности стенда; инструменты `mcp__playwright__*` через ToolSearch; свой инстанс по §7.4, `--isolated --output-dir .playwright-mcp/5175` — порт исполнителя WS-02 = 5173 + 2):
   - `browser_navigate` → `http://127.0.0.1:8025/` → `browser_snapshot` (дерево содержит заголовок документа, непустой `<title>`) → `browser_take_screenshot` → `docs/plan/evidence/stand/mailpit-1440.png`;
   - `browser_navigate` → `http://127.0.0.1:9001/` → `browser_snapshot` (форма входа консоли MinIO: два поля и кнопка) → `browser_take_screenshot` → `minio-console-1440.png`;
   - `browser_navigate` → `http://127.0.0.1:13133/` → текст ответа `health_check` → `browser_take_screenshot` → `otel-health.png`;
   - при `-Profile keycloak`: `http://127.0.0.1:8081/` → `keycloak-1440.png`;
   - `browser_resize` 390×844 → повторный снимок Mailpit `mailpit-390.png` (только факт доступности, раскладка стороннего UI не оценивается);
   - `browser_network_requests` → все хосты ∈ {`127.0.0.1:8025`, `127.0.0.1:9001`, `127.0.0.1:13133`, `127.0.0.1:8081`} → `network.txt`; `browser_console_messages` → `console.txt` (ошибки сторонних UI фиксируются, но не блокируют);
   - дерево доступности первой страницы → `snapshot.txt`.
   Если MCP недоступен — WS не закрывается, блокер в отчёте (`verification-protocol.md` §4, последний абзац; 12 §5 п.27).
5. **Путь evidence**: `docs/plan/evidence/stand/{stand-check.txt, stand-check-static.txt, mailpit-1440.png, mailpit-390.png, minio-console-1440.png, otel-health.png, keycloak-1440.png, snapshot.txt, console.txt, network.txt, images.txt}`; `images.txt` — вывод `docker buildx imagetools inspect` для каждого digest.
6. **Ревью** (1 ревьюер, §5.1:500): порядок коммитов; ни одного `0.0.0.0` в published-портах; все образы по digest; `.env.example` с комментариями и без секретов; файлы только из §2; `seed`/`profiles/e2e`/`keycloak/` не созданы.
7. **Скелет отчёта** `docs/plan/reports/WS-02.md` (формат `orchestration.md` §5; поля `REPORT_SCHEMA` `workflow.template.js:25–38`: `pagesDelivered: []`, `fixmeLeft: []`, `contractsChanged: [...]`, `testRunsOk`):

```markdown
# Отчёт WS-02 compose-stand
## Сделано
- deploy/compose/{docker-compose.yml,.env.example,otel/collector.yaml,README.md}, tools/stand-check.ps1
- коммиты: <hash> test(ws-02): stand-check skeleton (S1-S12, L1-L10) · <hash> feat(ws-02): … · <hash> refactor(ws-02): …
- версии: docker <X>, docker compose <Y>; digest образов — docs/plan/evidence/stand/images.txt
## Тесты (red → green)
| Тест | Слой | Коммит red | Коммит green |
| S1–S12 stand-check -Static | infra/static | <hash> | <hash по циклам §7 п.2–9, 13> |
| L1–L10 stand-check -Live -Profile test,keycloak,init | infra/compose smoke | <hash> | <hash §7 п.10–12> |
## Прогоны
<последние 40 строк stand-check.txt: … stand-check: 22 ok, 0 fail, 0 skip>
<последние строки stand-check-static.txt: … stand-check: 12 ok, 0 fail, 0 skip>
## Проверка MCP
- страницы: нет (pages: []); стенд: docs/plan/evidence/stand/ (mailpit-1440/390, minio-console-1440, otel-health, keycloak-1440, snapshot/console/network.txt)
- расхождения с эталоном: эталона нет; расхождения со скелетом — §10 п.1–4 брифа (seed → WS-53; KC_ADMIN/KC_ADMIN_PASS добавлены; :latest → digest; keycloak не в профиле e2e)
## Осталось fixme / открытые вопросы
- нет fixme; вопросы WS-41: имя роли ortus_api в CONTROL_DB_URL, коллация ru (ICU) — §10 п.5–6 брифа
## Контракты, которые я изменил
- запрос интегратору: Makefile up/down/stand-check (К1); ссылка на deploy/compose/README.md из README.md/CLAUDE.md; CI-job stand-static; .gitignore .env (если S12 FAIL)
```

## 9. Критерии готовности (DoD)

- [ ] `tools/stand-check.ps1` существует с первого коммита `test(ws-02): …`; `-Static` → `12 ok, 0 fail`; полный прогон с `-Profile test,keycloak,init` → `22 ok, 0 fail, 0 skip`; вывод дословно (последние 40 строк) в `docs/plan/reports/WS-02.md` «Прогоны» (`tdd-protocol.md` §5: без вывода отчёт не принимается).
- [ ] `docker compose -f deploy/compose/docker-compose.yml --env-file .env up -d --wait` поднимает ровно `postgres`, `minio`, `mailpit`, `otel-collector` за ≤ 120 с; `--profile test`/`keycloak`/`init` работают по К3; `minio-init` никогда не входит в `up --wait`.
- [ ] Все `image:` вида `<tag>@sha256:<64 hex>` с комментарием-датой; `postgres` и `postgres-test` — один digest; `postgres:17.x` (PD-38, Q-106).
- [ ] Все published-порты — `127.0.0.1`; `HTTP_ADDR=127.0.0.1:8080` (Q-112).
- [ ] `.env.example`: каждая переменная с комментарием (R17), все `${VAR}` compose объявлены, значения секретов — заглушки; `.env` не в git (`git status --porcelain`), `.gitignore` содержит `.env` (или запрос интегратору в отчёте).
- [ ] `deploy/compose/otel/collector.yaml` и `deploy/compose/README.md` (К1–К7) на месте; README содержит К5 дословно.
- [ ] Evidence §8 п.5 на месте; MCP-проходка выполнена или заявлен блокер.
- [ ] `git diff --name-only main..HEAD` ⊆ список §2; `design/`, корень, `backend/`, `profiles/e2e`, `keycloak/` не тронуты.
- [ ] Коммиты Conventional Commits через `git commit -F` без BOM (12 §6 п.22); первый — `test(ws-02)`.
- [ ] Стенд после прогона остановлен (`down -v` выполнен L10) — чужие worktree не зависят от состояния, оставленного WS-02.
- [ ] Отчёт `docs/plan/reports/WS-02.md` по `orchestration.md` §5, раздел «Контракты, которые я изменил» содержит запросы интегратору: цели `Makefile` (`up`, `down`, `stand-check`), ссылка на `deploy/compose/README.md` из корневого `README.md`/`CLAUDE.md` (R18 «документация в том же коммите» — здесь через интегратора, т.к. файлы WS-01), предложение CI-job `stand-static` (`pwsh tools/stand-check.ps1 -Static`) для WS-01/интегратора.
- [ ] Строка `WS-02` в `docs/plan/status.md` → `на проверке` с веткой, отчётом и `docs/plan/evidence/stand/`.
- [ ] Ревью `approve` (1 ревьюер); тег интегратора `wave-0-ws02` после слияния.

## 10. Риски, расхождения, открытые вопросы — что делаем по умолчанию

1. **`seed` как одноразовый контейнер** (карточка §5.4:628 и 12 §8 п.24 «`minio-init`/`seed` одноразовые вне `--wait`») vs `make seed` на хосте (`14:102`; `skeleton/docker-compose.yml:48` «api, worker, web запускаются через `make dev`»; `cmd/seed` — WS-52, волна 3). По умолчанию: WS-02 создаёт только `minio-init`; сервис `seed` появится в `deploy/compose/profiles/e2e/compose.yml` (WS-53) для эфемерного стенда CI и запускается `run --rm seed`; в базовом файле — комментарий-ссылка на WS-53, проверка S4 гарантирует, что `--profile e2e` на базовом файле не ломается.
2. **`KC_ADMIN`/`KC_ADMIN_PASS`** используются в `skeleton/docker-compose.yml:31–32`, но отсутствуют в `skeleton/.env.example:1–46` — добавляются (К4), это не изменение контракта, а закрытие пропуска; записать в отчёте.
3. **`:latest` в скелете** (`:19, :28, :37, :41`) vs D-04/PD-38 «образы по digest» — digest снимается на дату выполнения; номера версий в бриф не вносятся (не из источников). Обновление digest — через интегратора (compose = общий файл, 12 §5 п.16).
4. **Keycloak в профиле `e2e`** (`verification-protocol.md:36` «Keycloak в dev-режиме») vs PD-41/Q-109 (`e2e:full` на dev-провайдере, Keycloak только под `@keycloak`). По умолчанию — PD-41: `keycloak` только в профиле `keycloak`; WS-53 решает, подключать ли его к `e2e` override-файлом. JVM ~1 ГБ (12 §7 п.11) → L8 выполняется один раз, не в CI PR.
5. **Роли БД и пользователь `ortus_api`** (`skeleton/.env.example:6`) vs роли `migrator`/`api_runtime`/`worker_runtime`/`provisioner` (`14:81`; `control_0001_init.sql:4`). Compose создаёт только суперпользователя; `CONTROL_DB_URL` в `.env.example` остаётся как в скелете (имя пользователя — вопрос WS-41, который создаёт роли миграцией/бутстрапом `cmd/migrate` и при переименовании правит `.env.example` через интегратора). initdb-скрипты WS-02 не добавляет, чтобы не раздваивать владение схемой (Q-104, 12 §4.9 «миграции — внешним инструментом»).
6. **PostgreSQL 17 vs 16.4** (Q-106, 09 DP-14, R15 §10.1): 17 — по умолчанию; первый прогон миграций на 17 — тест WS-41; CI-job на 16.4 до пилота (PD-38) — WS-01/интегратор, не WS-02. Образ Debian-based `postgres:17` (как в скелете, не `-alpine` из 2.0) — чтобы ICU/локали были доступны миграциям; initdb только `--encoding=UTF8 --data-checksums`, коллация `ru` — ICU в миграциях WS-41 (открытый вопрос WS-41, в `decisions.md` не вносится WS-02).
7. **testcontainers vs `postgres-test`** (Q-107): оба — `postgres-test` для харнесса `backend/test/**` (12 §6 п.11–12, WS-07) и e2e-стенда (WS-53); testcontainers — для up/down миграций (WS-41, §5.4:656) на том же digest (К7). Доступность Docker API из Go на dev-машине подтверждается в WS-41, не здесь.
8. **Healthcheck-команды сторонних образов** (`mc ready local`, `/mailpit readyz`, `/dev/tcp` для Keycloak, `health_check` коллектора) могут отличаться в закреплённой версии образа — критерий DoD: healthcheck зелёный; при замене на fallback К2 — строка в отчёте с цитатой `docker compose logs <svc>`.
9. **`docker compose up --wait` и одноразовые контейнеры** (12 §3.6:212): `minio-init` только под профилем `init` и только `run --rm`; S9/L6 это закрепляют.
10. **Один стенд на машину, порты глобальны** (К6; 12 §3.5 п.5): два worktree с разными версиями `docker-compose.yml` при `up` пересоздадут контейнеры друг друга — правило: compose меняет только владелец/интегратор; изоляция через `COMPOSE_PROJECT_NAME` + свои порты описана в README.
11. **Windows-особенности** (12 §3.6, 12 §8 п.3): `HTTP_PROXY` → `curl.exe --noproxy "*"`; PowerShell 5.1 → без `&&`; `.ps1` только ASCII; bind-mount `./keycloak` при первом `--profile keycloak up` создаёт пустой каталог `deploy/compose/keycloak/` на хосте (в git не попадает — пустые каталоги не трекаются; файлы туда кладёт только WS-54).
12. **Секреты** (D-05, 12 §5 п.29): в `.env.example` только `change-me-local`; `S3_SECRET_KEY`/`PG_SUPERPASS` в коде без умолчаний — требование к WS-40 (конфигурация), WS-02 лишь не даёт стартовать без `.env` (S2).
13. **Наблюдаемость без бэкенда** (D-07 не решён): коллектор только с экспортёром `debug`; при решении D-07 — override через интегратора.
14. **CI** (`14:92` «Playwright на эфемерном стенде compose»): job `e2e-full` — WS-53; WS-02 предлагает лишь `stand-static` (`-Static` без демона) — запрос интегратору в отчёте, файлы `.github/**` не трогаются.

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-02 «compose-stand» волны 0 проекта «Ортус CRM» (вид infra, размер S, `pages: []`). Прочитай полностью `docs/plan/ws/WS-02-compose-stand.md`, затем все входы из его §3: `design/docs/repo-skeleton/docker-compose.yml`, `design/docs/repo-skeleton/.env.example`, `design/docs/14-engineering.md:72–106`, `docs/plan/analysis/12-prior-project-and-skills.md` §3.2 R8 и R17, §3.6, §5 п.16/29, §6 п.11–12, §8 п.23–24, `docs/plan/decisions.md` PD-18, PD-23, Q-106, Q-107, Q-109, Q-112, `docs/plan/00-master-plan.md` §5.4 (карточка WS-02), §6.5, §8.1 (колонка infra), §10.3 PD-31/PD-38/PD-41/PD-46, и протоколы `tdd-protocol.md`, `verification-protocol.md`, `orchestration.md`. Работай в worktree на ветке `ws/ws-02-compose-stand` от `main`; выполни `pnpm install` в worktree; коммиты через `git commit -F <файл без BOM>`.

Строго по TDD: первый коммит `test(ws-02): stand-check skeleton` — `tools/stand-check.ps1` со всеми 22 проверками §6а (S1–S12, L1–L10), запущенный и красный. Далее циклы §7 по порядку: каждая единица — красный прогон `-Only …`, минимальная реализация в `deploy/compose/docker-compose.yml`, `deploy/compose/.env.example`, `deploy/compose/otel/collector.yaml`, `deploy/compose/README.md`, коммит `feat(ws-02): …`, рефакторинг якорями. Соблюдай контракты §4: канонической командой К1, портами только на `127.0.0.1`, профилями `test`/`keycloak`/`init`, образами по digest, строкой К5 для харнесса. Не создавай `deploy/compose/profiles/**`, `deploy/compose/keycloak/**`, не правь корень, `.github/**`, `backend/**`, `design/**`.

Перед завершением: полный прогон `stand-check -Profile test,keycloak,init -OutFile docs/plan/evidence/stand/stand-check.txt` (ожидается `22 ok, 0 fail, 0 skip`), MCP-проходка §8 п.4 с evidence в `docs/plan/evidence/stand/`, `down -v`. Верни отчёт `docs/plan/reports/WS-02.md` по `orchestration.md` §5 с дословным выводом прогонов, списком digest, расхождениями §10 и запросами интегратору (цели `Makefile`, ссылка из `README.md`, CI-job `stand-static`); обнови свою строку в `docs/plan/status.md`. Если Docker или MCP недоступны — опиши блокер в отчёте, не обходи его.
