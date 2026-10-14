# Ортус CRM

Монорепозиторий: `frontend/` (pnpm workspace: `apps/web`, `packages/{tokens,ui,domain,adapter,texts,e2e-kit,api-client}`) и `backend/` (Go-модуль). Эталон интерфейса — снимок Claude Design в `design/`. План работ — `docs/plan/v2/00-parallel-plan.md`, правила для агентов — `CLAUDE.md`.

## Onboarding

Windows 11, PowerShell 5.1 (Linux/macOS — те же шаги, `pnpm` после `corepack enable`).

1. Node 22 (`.nvmrc`), Go 1.26, Docker Desktop, git.
2. `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2`.
3. Зависимости: `$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'; corepack pnpm install` — ставит pnpm из `packageManager` и git-хуки husky.
4. Проверка: `corepack pnpm run lint`, `corepack pnpm run typecheck`, `corepack pnpm run test`, `corepack pnpm run build`.
5. `make` не обязателен: каждая цель `Makefile` = `corepack pnpm run <цель>`. Для Windows: `winget install GnuWin32.Make` или `scoop install make`.
6. `core.autocrlf` не менять: переводы строк задаёт `.gitattributes` (`eol=lf`, эталон `design/**` — без нормализации).

## Структура

| Каталог           | Что                                                                           |
| ----------------- | ----------------------------------------------------------------------------- |
| `design/`         | эталон (только чтение)                                                        |
| `docs/plan/`      | план, протоколы, брифы WS, отчёты                                             |
| `docs/adr/`       | архитектурные решения (шаблон `TEMPLATE.md`)                                  |
| `api/`            | OpenAPI по тегам, `permissions.yaml`, `errors.yaml` (стюард контракта)        |
| `backend/`        | Go: `cmd/`, `internal/{platform,control,modules,api}`, `migrations/`, `test/` |
| `frontend/`       | приложение и пакеты                                                           |
| `deploy/compose/` | локальный стенд                                                               |
| `tools/`          | утилиты эталона, e2e и проверки каркаса (`tools/repo/`)                       |
