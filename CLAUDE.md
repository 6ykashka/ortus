# Ортус CRM — правила для агентов

Монорепозиторий: `frontend/` (pnpm workspace, React) и `backend/` (Go). Правит этот файл только интегратор.

## План и протоколы

- План работ: `docs/plan/v2/00-parallel-plan.md` (этапы, реестр WS, §3.5 горячие точки, §3.6 порты, §7 решения PD-по умолчанию). Статус — `docs/plan/v2/status.md` (пишет интегратор).
- Бриф WS: `docs/plan/v2/ws/<ID>.md`; отчёт: `docs/plan/v2/reports/<ID>.md` по `docs/plan/orchestration.md` §5.
- Протоколы: `docs/plan/tdd-protocol.md` (red → green → refactor, red-коммит отдельно), `docs/plan/verification-protocol.md` (четыре проверки страницы), `docs/plan/orchestration.md` (роли, границы автономии §7).
- Решения и вопросы: `docs/plan/decisions.md`; ADR — `docs/adr/NNNN-<slug>.md` по шаблону `docs/adr/TEMPLATE.md`.
- Эталон `design/` неприкосновенен: меняет только DoR-сверщик целиком на границе этапа (теги `design-<дата>`, `design-stage-N`).

## Владение каталогами (план §3.5, CODEOWNERS)

| Что                                                                                                                                                                         | Кто пишет                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `api/**` (OpenAPI по тегам, `permissions.yaml`, `errors.yaml`), номера миграций, генерируемые `backend/internal/api/`, `frontend/packages/api-client/`, `cmd/api/router.go` | стюард контракта этапа                                               |
| Свой пакет или каталог из карточки WS (колонка «Владеет»)                                                                                                                   | исполнитель WS                                                       |
| Заглушки с `@stub Owner: W0.NN`                                                                                                                                             | владелец заменяет файл целиком                                       |
| `package.json`, `pnpm-lock.yaml`, `backend/go.mod`, CI, `CODEOWNERS`, `CLAUDE.md`, баррели (`packages/ui/src/index.ts`, `domain/modules/index.ts`)                          | интегратор (новая зависимость — с точной версией, через интегратора) |
| Тексты: файл на домен; `screen-labels.ts`, `errors.ts` — только добавление                                                                                                  | владелец страницы / стюард                                           |
| Сид, изоляция, меню, источники «Главной»                                                                                                                                    | файл на модуль                                                       |

Чужие каталоги не трогать. Вопрос, меняющий поведение относительно прототипа, — в `docs/plan/decisions.md`; до решения действует значение по умолчанию.

## Среда (Windows 11, PowerShell 5.1)

- В PowerShell 5.1 нет `&&` и `||`: `A; if ($?) { B }` или `if ($LASTEXITCODE -ne 0) { throw }`.
- `pnpm` и `make` не в PATH, `corepack enable` требует прав администратора. Используйте `corepack pnpm <команда>` (версия берётся из `packageManager`). Внутри скриптов `pnpm` берётся из `node_modules/.bin` (devDependency `pnpm` с той же версией). Без запроса подтверждения: `$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'`.
- `make` нужен только в CI/Linux: каждая цель `Makefile` — обёртка над одноимённым `corepack pnpm run <цель>`.
- Каждый WS — свой `git worktree` и ветка `ws/<ID>` от `main`; в каждом worktree отдельно `corepack pnpm install`.
- Коммит — только файлом UTF-8 **без BOM** и `git commit -F` (PowerShell `Out-File`/`Set-Content` пишут BOM, хук `commit-msg` такой коммит отклонит):
  `[IO.File]::WriteAllText("$PWD\msg.txt", $m, (New-Object Text.UTF8Encoding $false)); git commit -F msg.txt`
- Go: `go -C backend test ./...`; `golangci-lint` v2.13.2 запускается из `backend/` (`cd backend; golangci-lint run ./...`).
- `curl.exe --noproxy "*"` для локальных адресов; `[Console]::OutputEncoding = [Text.Encoding]::UTF8` перед выводом кириллицы.
- `.mcp.json` и `.claude/settings.json` читаются на старте сессии — после правки перезапустить сессию.

## Порты и окружение по слоту (план §3.6)

Слот — номер исполнителя в подволне (1…10).

| Ресурс               | Значение                                                         |
| -------------------- | ---------------------------------------------------------------- |
| Vite исполнителя     | `5200 + slot`                                                    |
| Проверяющий страницы | `6100 + slot` (с `E2E_FRESH_SERVER=1`)                           |
| Storybook            | `7200 + slot`                                                    |
| API исполнителя      | `HTTP_ADDR=127.0.0.1:(8100 + slot)`; прокси Vite `/api` — из env |
| Эталон               | текущий этап `4173`, предыдущий `4174`; свой — `4100 + slot`     |
| Compose              | `COMPOSE_PROJECT_NAME=ortus-s<slot>`, по завершении остановить   |
| MCP                  | `.playwright-mcp/<порт>`                                         |

Integration-тесты — только testcontainers. Общий стенд compose принадлежит интегратору.

## Команды

| `corepack pnpm run …` / `make …`                   | Что делает                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `lint`                                             | `prettier --check .`, `eslint .`, `golangci-lint run ./...` из `backend/`            |
| `format`                                           | `prettier --write .` (Go — `gofmt` в pre-commit)                                     |
| `typecheck`                                        | `tsc --noEmit` во всех пакетах                                                       |
| `test`                                             | `node --test tools/repo/*.test.mjs`, тесты пакетов, `go -C backend test ./...`       |
| `build`                                            | сборка пакетов и `go build ./...`                                                    |
| `dev`                                              | dev-сервер `@ortus/web` (W0.09)                                                      |
| `gen`, `up`, `down`, `migrate`, `seed`, `examples` | заглушки до владельцев (W0.09, W0.06, W0.13): печатают владельца и выходят с кодом 2 |

## Коммиты и хуки

- Conventional Commits: `<type>(<scope>): <описание>`; типы — `feat fix docs style refactor perf test build ci chore revert`; scope — ID WS в нижнем регистре (`w1.04`) или область (`repo`, `api`, `web`, `backend`).
- TDD: сначала коммит `test(…)` с красным тестом, затем `feat(…)`/`fix(…)`, затем `refactor(…)`. Один коммит не смешивает red и green разных единиц.
- Хуки husky (ставятся `corepack pnpm install`): `pre-commit` — lint-staged (gofmt, eslint --fix, prettier); `commit-msg` — проверка BOM и commitlint; `pre-push` — `test` и e2e-smoke изменённых страниц.
- Запрещено: `--no-verify`, `--force`, правка git config, `git stash` без уникального тега. Упал хук — исправить и сделать новый коммит.

## Скилы и отступления

- Go — скилы `golang-*` (`.claude/skills`); React — `vercel-react-best-practices` (правила `server-*` и Next.js-специфика не применяются, вместо SWR — TanStack Query, вместо `next/dynamic` — `React.lazy`).
- Отступления от скилов: явный реестр вместо `init()`; `golang-swagger` не применяется (контракт — OpenAPI в `api/`); скил `golang-how-to` не установлен — директиву не добавлять; `heroui-react` — только справочник.
- Go-модуль `github.com/ortus/ortus-crm/backend` (временный путь до появления remote). Модули `internal/modules/**` импортируют только stdlib, `internal/platform`, `internal/api`, `internal/domain` и разрешённые библиотеки (depguard в `backend/.golangci.yml`).
