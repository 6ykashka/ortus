# Локальный стенд Ортус (W0.06)

Стенд из `design/docs/repo-skeleton/`: PostgreSQL 17, MinIO, Mailpit, OTel collector; под профилями — `postgres-test`, `keycloak`, `minio-init`. Все порты опубликованы только на `127.0.0.1`. Образы закреплены по digest (D-04).

## Запуск

```powershell
node deploy/compose/stand.mjs init --slot 0      # .env в корне (слот 0 — общий стенд интегратора)
node deploy/compose/stand.mjs up                 # docker compose up -d --wait
node deploy/compose/stand.mjs migrate            # cmd/migrate all up: роли, control DB, все tenant DB
node deploy/compose/stand.mjs seed               # cmd/seed: платформа, «Альта», «Лотос» (идемпотентно)
node deploy/compose/stand.mjs down               # остановить, данные сохраняются
node deploy/compose/stand.mjs down -v            # остановить и удалить тома
```

То же через корневые скрипты (после правки интегратором): `corepack pnpm run up|migrate|seed|down`. Другой env-файл — флаг `--env <путь>` (не `--env-file`: Node 22 сам разбирает этот флаг).

## Слоты агентов (план §3.6)

Параллельные агенты поднимают свой стенд: `node deploy/compose/stand.mjs init --slot <N>`. В `.env` попадают имя проекта `ortus-s<N>` (контейнеры, тома и сеть не пересекаются) и порты `база + 100 × N`; адреса приложения — `HTTP_ADDR=127.0.0.1:(8100 + N)`, Vite `5200 + N` в `OIDC_REDIRECT_URL` и `ALLOWED_ORIGINS`. По завершении — `down -v`.

| Сервис                                | Переменная                                               | Слот 0              | Слот 7              | Профиль                           |
| ------------------------------------- | -------------------------------------------------------- | ------------------- | ------------------- | --------------------------------- |
| `postgres` (control + tenant DB)      | `POSTGRES_PORT`                                          | 5432                | 6132                | —                                 |
| `postgres-test` (tmpfs, `fsync=off`)  | `PG_TEST_PORT`                                           | 5433                | 6133                | `test`                            |
| `minio` S3 / консоль                  | `MINIO_PORT` / `MINIO_CONSOLE_PORT`                      | 9000 / 9001         | 9700 / 9701         | —                                 |
| `mailpit` UI / SMTP                   | `MAILPIT_UI_PORT` / `SMTP_PORT`                          | 8025 / 1025         | 8725 / 1725         | —                                 |
| `otel-collector` gRPC / HTTP / health | `OTEL_GRPC_PORT` / `OTEL_HTTP_PORT` / `OTEL_HEALTH_PORT` | 4317 / 4318 / 13133 | 5017 / 5018 / 13833 | —                                 |
| `keycloak`                            | `KEYCLOAK_PORT`                                          | 8081                | 8781                | `keycloak`                        |
| `minio-init` (бакет `S3_BUCKET`)      | —                                                        | —                   | —                   | `init`, запуск `stand.mjs bucket` |

## Профили

- `node deploy/compose/stand.mjs up --profile test` — тестовая база в памяти (`TEST_DB_URL`). Integration-тесты Go используют testcontainers и стенд не требуют.
- `node deploy/compose/stand.mjs up --profile keycloak` — Keycloak `start-dev --import-realm`; realm-файлы кладёт W1.03 в `deploy/compose/keycloak/`.
- `node deploy/compose/stand.mjs bucket` — одноразовый `minio-init` (не входит в `up --wait`: одноразовый контейнер `--wait` считает провалом).

## Роли БД

`migrate roles ensure` (входит в `migrate all up` при заданном `PG_SUPER_URL`) создаёт `ortus_migrator` (DDL, владелец БД), `ortus_api`, `ortus_worker` (только DML), `ortus_provisioner` (CREATEDB). `CONTROL_DB_URL` — DSN API под `ortus_api`; `MIGRATOR_DB_URL` — DSN `cmd/migrate` и `cmd/seed`.

После каждого `up` гранты (`backend/migrations/roles/grants.sql`): CONNECT к базе — только `ortus_api` и `ortus_worker` (у PUBLIC и `ortus_provisioner` отозван); аудит (`platform_audit`, `audit.events`), версии ролей и чек-листов, `files.quota_ledger` — только SELECT и INSERT; `outbox.events` меняет только worker.

`migrate control|tenant down` удаляет схемы и данные: нужен `--yes`; при `APP_ENV=prod|production` down запрещён. Через `go run` (то есть `stand.mjs migrate`) любой ненулевой код выхода программы превращается в 1 — точный код виден в строке `exit status N`.

Tenant DB: сид пишет `tenant_routing.secret_ref = env:TENANT_DB_URL`. В `TENANT_DB_URL` — DSN роли `ortus_api`; пул API подставляет в путь `tenant_routing.database_name` (`migrations.TenantDSN`). Учётка мигратора в `secret_ref` не попадает: `cmd/migrate` строит DSN tenant DB из `MIGRATOR_DB_URL`.

## Образы

| Сервис                  | Образ                                          | Примечание                                                                                                  |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| postgres, postgres-test | `postgres:17.11`                               | тот же digest — в `backend/migrations` (testcontainers); CI дополнительно — `postgres:16.4`                 |
| minio, minio-init       | `pgsty/minio`, `pgsty/mc`                      | официальные `minio/minio`, `minio/mc` с 10.2026 не публикуются анонимно; сообщественная сборка того же кода |
| mailpit                 | `axllent/mailpit:v1.31.4`                      |                                                                                                             |
| otel-collector          | `otel/opentelemetry-collector-contrib:0.162.0` | экспортёр `debug` (D-07)                                                                                    |
| keycloak                | `quay.io/keycloak/keycloak:26.6.4`             |                                                                                                             |

Обновление digest: `docker buildx imagetools inspect <image>:<tag>`, затем `node --test deploy/compose/stand.test.mjs`.

## Windows

PowerShell 5.1 без `&&`: `node deploy/compose/stand.mjs up; if ($LASTEXITCODE -eq 0) { node deploy/compose/stand.mjs migrate }`. Локальные адреса — `curl.exe --noproxy "*"`.
