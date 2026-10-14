# 14. Инженерный регламент — версия 0.2

Предложение от 1 октября 2026 года для старта репозитория. Пункты с пометкой **D-xx** требуют решения (`16-raid-glossary.md`). Если репозиторий уже существует, регламент адаптируется к нему, а не наоборот.

## Стек (предложение)

| Слой | Выбор | Альтернатива / решение |
|---|---|---|
| Go | Последняя стабильная версия на момент старта, закреплена в `go.mod` и CI | — |
| HTTP | `net/http` + chi, серверные интерфейсы из `oapi-codegen` (strict server) | — |
| БД | PostgreSQL (версия закрепляется в D-04), `pgx/v5`, `sqlc` | — |
| Миграции | `goose` (SQL-файлы) + собственный migration controller по тенантам | Atlas — D-06 |
| Фоновые задачи | Собственный worker на outbox (`FOR UPDATE SKIP LOCKED`) | River — оценить в S1 |
| IdP | Keycloak, общий realm клиентов + отдельный клиент операторов | D-03 |
| Хранилище файлов | S3-совместимое (MinIO локально) | Провайдер — D-05 |
| Frontend | React + TypeScript, Vite, TanStack Router + Query; PWA через Workbox | Next.js — только если уже есть (D-01) |
| UI | Собственный пакет `@ortus/ui` на токенах; headless-примитивы Radix/React Aria для a11y | Одна библиотека, без смешивания |
| Формы | React Hook Form + Zod (схемы из OpenAPI) | — |
| TS-клиент | `openapi-typescript` + `openapi-fetch` | — |
| Тесты | `go test`, testcontainers-go, Vitest, Testing Library, Playwright, Schemathesis, k6 | — |
| Наблюдаемость | OpenTelemetry (traces, metrics), `log/slog` JSON | Бэкенд хранения — D-07 |
| CI/CD | Платформа — D-02 | GitLab CI или GitHub Actions |

## Структура репозитория

```text
ortus/
├─ api/
│  ├─ openapi/ortus.yaml          # единственный источник контракта
│  ├─ permissions.yaml            # = docs/11-permissions.yaml
│  └─ spectral.yaml
├─ backend/                       # go.mod
│  ├─ cmd/{api,worker,provisioner,migrate}/
│  ├─ internal/
│  │  ├─ platform/                # tenantctx, authz, scopeddb, storage, events, audit, idem, clock, httpx
│  │  ├─ control/                 # тенанты, аккаунты, подписки (control DB)
│  │  └─ modules/
│  │     ├─ access/  org/  people/  modulesreg/  files/  sched/
│  │     └─ fleet/                # manifest.yaml, http.go, service.go, queries/*.sql, migrations/
│  ├─ migrations/{control,tenant}/
│  └─ test/{isolation,concurrency,contract}/
├─ frontend/                      # pnpm workspace
│  ├─ apps/web/                   # оболочка, маршруты, рабочие места
│  └─ packages/
│     ├─ tokens/                  # = docs/design-system/tokens.json → CSS vars + TS
│     ├─ ui/                      # компоненты DS + Storybook
│     ├─ api-client/              # сгенерирован, не редактируется руками
│     └─ domain/                  # compat, legs, валидации, форматирование (из прототипа)
├─ deploy/{compose,helm}/
└─ docs/
```

Правила: модуль импортирует только `platform/*` и публичные интерфейсы других модулей (`modules/x/api.go`), не их `internal`. Модуль не получает raw-пул БД — только `ScopedDB` своей схемы. Проверяется линтером `depguard`.

## Поток контракта

1. Изменение начинается с PR в `api/openapi/ortus.yaml` (+ `permissions.yaml`).
2. CI: Spectral, полный валидатор OpenAPI 3.1, проверка, что каждый `x-permissions` есть в каталоге.
3. `make gen` → Go-интерфейсы, TS-клиент, константы прав и кодов ошибок. CI падает при дрейфе.
4. Backend и frontend работают параллельно: frontend против mock-сервера, сгенерированного из примеров (Prism) или адаптера прототипа.
5. Schemathesis прогоняет контракт против реального API на стенде.

## Ветки, коммиты, ревью

- Trunk-based: короткие ветки от `main`, слияние через PR, squash.
- Conventional Commits: `feat(fleet): …`, `fix(access): …`, `chore(ci): …`.
- Ветка `main` защищена; деплой на dev — автоматически после merge.
- CODEOWNERS: `internal/platform/authz/**`, `migrations/**`, `modules/*/finance*`, `api/permissions.yaml` — обязателен security/backend lead.
- ADR: `docs/adr/NNNN-название.md` по шаблону из `16-raid-glossary.md`.
- Feature flags для незавершённых экранов; не путать с entitlement (коммерческий доступ).

## Окружения

| Окружение | Назначение | Данные | Деплой |
|---|---|---|---|
| local | Разработка | Сид-скрипт: 2 тенанта, 3 региона × 4 фирмы, роли из шаблонов | `make up` |
| dev | Интеграция | Синтетические | Автоматически из `main` |
| stage | Приёмка, нагрузка, restore drill | Синтетические по профилю пилота | Тег `vX.Y.Z-rc` |
| prod-pilot | Пилот | Реальные | Тег `vX.Y.Z`, ручное подтверждение |

Конфигурация — переменные окружения (`.env.example`), секреты — во внешнем хранилище (D-05). Роли БД: `migrator` (DDL), `api_runtime` (DML своей tenant DB), `worker_runtime`, `provisioner` (CREATE DATABASE). У API нет DDL.

## Конвейер CI

```text
lint (golangci-lint, eslint, prettier, spectral)
→ contract (openapi validate, permissions check, codegen drift)
→ unit (go test ./..., vitest)
→ integration (testcontainers: PostgreSQL, MinIO)
→ isolation + concurrency suites            # блокирующие
→ build (images, SBOM, подпись)
→ e2e (Playwright на эфемерном стенде compose)
→ deploy dev → [manual] stage → [manual] prod-pilot
```

## Локальный запуск

```bash
cp deploy/compose/.env.example .env
make up          # postgres, minio, keycloak, mailpit, otel-collector
make migrate     # control + все tenant DB
make seed        # демо-холдинг как в прототипе
make dev         # api + worker + web с hot reload
```

Файлы: `deploy/compose/docker-compose.yml`, `deploy/compose/.env.example` (в этом комплекте — `docs/repo-skeleton/`).

## Соглашения кода

- Go: ошибки домена — типизированные (`domain.ErrReservationOverlap`) → маппинг в `Problem.code` в одном месте. `context.Context` первым аргументом; TenantContext только из middleware.
- SQL: каждый запрос tenant-модуля принимает предикат `scopeQuery`; ревью отклоняет запросы без него.
- TS: строгий режим; бизнес-правила только в `packages/domain`; компоненты не импортируют `api-client` напрямую — через хуки `use*Query` в `apps/web`.
- Деньги на клиенте — `amountMinor: number` + форматирование `Intl.NumberFormat('ru-RU')`; никаких float-операций над суммами.
- Логи: `request_id`, `tenant_id` (технический), `actor_id`; запрещены токены, тела форм, фото, суммы начислений.
- Метрики: имена `ortus_<модуль>_<что>_<единица>`; `tenant_id` не label по умолчанию.

## Перенос прототипа

| Из прототипа | Куда | Примечание |
|---|---|---|
| `ortus/models.js` (`compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`, `bookingConflicts`) | `packages/domain` | Переписать на TS, покрыть тестами; серверная копия правил — в Go |
| JSDoc-типы | `packages/domain/types.ts` | Сверить с OpenAPI, приоритет у сгенерированных типов |
| `ortus/api.js` (`createMockAdapter`) | `apps/web/mocks` (MSW) | Для Storybook и e2e без backend |
| Экраны `Ортус CRM.dc.html` | `apps/web/routes/*` | Как UX-референс; разметка переписывается на компоненты `@ortus/ui` |
| Токены | `packages/tokens` | Из `docs/design-system/tokens.json` |
| Ключи прав | `api/permissions.yaml` | Переименования — раздел `prototype_renames` |
