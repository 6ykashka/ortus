# WS-01 · Репозиторий: git, pnpm workspace, go.mod, линтеры, husky, CI GitHub Actions, CLAUDE.md, CODEOWNERS, check-icu, allowlist-lint, Windows-onboarding

Волна 0 · Размер M · Вид infra · Зависит от: — · Блокирует: все (WS-02, WS-03, WS-04, WS-05, WS-07, WS-08 стартуют после слияния WS-01 — `00-master-plan.md` §5.1 строка WS-01, §6.1 ребро `WS-01 → WS-02, WS-03, WS-04, WS-05, WS-07, WS-08`, §6.2 «WS-01 — до остальных»). Ревью: 1 (ревьюер «фундамент FE/BE» волны 0, §6.2). Порядок в волне: WS-00 и WS-01 — первыми и последовательно, один агент каждый (§7.2, последний абзац).

Условные ссылки те же, что в мастер-плане §0.1: «12 §3.2 R9» = `docs/plan/analysis/12-prior-project-and-skills.md`, раздел 3.2, строка R9; «12 §6 п.14» = чек-лист приёмки отчёта 12, пункт 14; «14-eng «Конвейер CI»» = `design/docs/14-engineering.md`, раздел «Конвейер CI» (строки 83–94); «MP §4.8» = `docs/plan/00-master-plan.md` §4.8.

## 1. Цель

После WS-01 каталог `D:\work\test26042026_Kirill_3.0` — git-репозиторий с веткой `main`, в котором `design/` лежит байт-в-байт (`git cat-file -s HEAD:"design/Ортус CRM.dc.html"` = 601 806, `tools/README.md:12`), а команды из MP §0.2 (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `go -C backend test ./...`, `golangci-lint run ./...` из `backend/`) проходят зелёными на пустом workspace, так что WS-02…WS-08 могут стартовать параллельно в своих worktree без правок общих файлов (`orchestration.md` §1, §7). Конвейер CI `lint → contract → unit → integration → isolation+concurrency → build → e2e → visual` + `examples-fresh`, `allowlist-lint`, `check-icu` (14-eng «Конвейер CI»; MP §5.4 карточка WS-01) существует с первого дня; шаги, чьи владельцы ещё не влились, охраняются `hashFiles(...)`, а не отсутствуют. Страниц у WS-01 нет — «точно как нарисовано» здесь означает: ни один файл `design/**` не изменён ни на байт, и каждый последующий WS получает одинаковые инструменты проверки этого (`.gitattributes`, `check-icu`, `allowlist-lint`, порядок коммитов `test(` → `feat(`).

## 2. Границы файлов

Владение по MP §3.3 и §5.4 (карточка WS-01: «корень (кроме `design/`, `docs/plan/analysis`)») и по заданию брифа. Создаёт/меняет:

| Путь | Что | Источник требования |
|---|---|---|
| `.git/` (`git init -b main`), первый коммит на `main` со всем текущим содержимым (`.claude/skills`, `design/`, `docs/plan`, `tools/`, `skills-lock.json`) | база для всех worktree | 12 §8 п.1 («нет git»); `orchestration.md` §1 |
| `.gitattributes`, `.gitignore`, `.editorconfig`, `.nvmrc`, `.npmrc`, `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json` | формат, EOL, игноры | 12 §3.2 R9; 12 §3.6 «`.gitattributes eol=lf`», «`.playwright-mcp/` в `.gitignore`» (12 §6 п.3; MP §7.4) |
| `package.json` (корень), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `frontend/package.json`, `frontend/eslint.config.mjs`, `frontend/.lintstagedrc.json`, `frontend/tsconfig.base.json` | pnpm 9 workspace, скрипты MP §0.2, ESLint flat | PD-23, PD-38; 12 §3.2 R9 («ESLint во вложенном lint-staged, flat config ищется от каталога», 12 §3.6) |
| `.husky/{pre-commit,commit-msg,pre-push}`, `tools/hooks/{format-file.mjs,commit-msg.mjs,check-tdd-order.mjs,pre-push.mjs,run-in.mjs}` | git-хуки и хук Claude Code | `verification-protocol.md` §6; 12 §3.2 R13; 12 §6 п.19–22 |
| `.claude/settings.json` | `PostToolUse` (Write\|Edit → `node tools/hooks/format-file.mjs`), `Stop` → `node tools/verify-pages.js` | `verification-protocol.md` §6 последний абзац; MP §3.3; 12 §3.2 R13 |
| `tools/verify-pages.js` — **заглушка** с маркером `@stub Owner: WS-07` (печатает «verify-pages: заглушка WS-01, реализует WS-07», exit 0) | чтобы `Stop`-хук не падал до WS-07 | MP §5.4 карточка WS-01 («заглушка до WS-07») |
| `tools/check-icu.js`, `tools/check-icu.test.mjs` | детерминизм ICU | MP §0.4 П13, §6.5 барьер 0→1 («`tools/check-icu.js` зелёный»), §10.1 R11 |
| `tools/allowlist-lint.js`, `tools/allowlist-lint.test.mjs`, `tools/fixtures/allowlist/{ok,no-decision,pixel-q,bad-kind}.md`, `tools/fixtures/allowlist/legacy/allowlist.md` | lint allowlist по PD-50 | MP §4.8 (формат записи), PD-50, §10.1 R8 |
| `tools/repo-check.test.mjs` (e2e-скелет инфраструктуры, §6а), `tools/ci-order.test.mjs`, `tools/hooks/*.test.mjs` | тесты WS-01, запуск `node --test` | `tdd-protocol.md` §2 шаг 1; MP §8.1 колонка infra |
| `backend/go.mod`, `backend/go.sum`, `backend/.golangci.yml`, `backend/.gitignore`, `backend/CLAUDE.md`, заглушки `backend/cmd/api/main.go` (`@stub Owner: WS-40`), `backend/internal/platform/doc.go` (`@stub Owner: WS-40`), `backend/internal/control/doc.go` (`@stub Owner: WS-43`), `backend/internal/modules/doc.go` (`@stub Owner: интегратор`), `backend/internal/modules/depguardprobe/{allowed.go,denied.go}` | один Go-модуль, линт v2, depguard с обеих сторон | 14-eng «Структура репозитория» (`backend/ # go.mod`), «правила… `depguard`» (строка 53); 12 §6 п.13–14; 12 §8 п.8 |
| `Makefile` | `gen up down migrate seed dev examples test lint help` | 14-eng «Локальный запуск»; MP §0.2; 12 §3.2 R11 |
| `.github/workflows/ci.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS` | CI, шаблон PR, владельцы | PD-20; 14-eng «Ветки, коммиты, ревью» (строка 68), 13-backlog S0-01/S0-02 |
| `CLAUDE.md` (корень), `frontend/CLAUDE.md`, `backend/CLAUDE.md`, `README.md` | правила и onboarding | 12 §3.2 R18; PD-42; Q-105; 12 §8 п.27 |
| `docs/plan/status.md` — только строка WS-01; `docs/plan/reports/WS-01.md`; `docs/plan/evidence/_infra/WS-01/` | отчёт и evidence | `orchestration.md` §5, §7 |

Запрещено трогать: `design/**` (эталон, `orchestration.md` §7); `docs/plan/analysis/**`, `docs/plan/decisions.md`, `docs/adr/**` (WS-00); `docs/plan/00-master-plan.md`, протоколы; `.claude/skills/**`, `skills-lock.json`; `.mcp.json`, `frontend/apps/**`, `frontend/packages/**`, `api/**`, `deploy/**` (WS-07, WS-10/11, WS-04…08, WS-03, WS-02); `backend/migrations/**`, `backend/test/**` (WS-41, WS-07); `.github/workflows/e2e-full.yml` (WS-53). Заглушки из таблицы выше — единственное исключение из «чужих каталогов»: они создаются ради компиляции и помечены маркером `@stub Owner: WS-NN`, владелец заменяет их целиком без согласования (приём S0 проекта 2.0, 12 §3.5 п.1–2).

Worktree и ветка. Шаг 0 (§7) выполняется в основном чекауте, потому что git ещё не существует. Порядок строго такой (иначе `core.autocrlf=true` на dev-машине, 12 §8 п.3, нормализует переводы строк в `design/` при коммите):

```powershell
Set-Location D:\work\test26042026_Kirill_3.0
git init -b main
# 1) .gitattributes — ДО первого git add (содержимое — §4.3)
git add -A
git ls-files --eol -- "design/Ортус CRM.dc.html"      # ожидается: i/<как на диске> w/<как на диске> attr/-text
git commit -F msg.txt                                   # msg.txt без BOM: chore(repo): импорт снимка design, docs/plan, tools и скиллов
git cat-file -s HEAD:"design/Ортус CRM.dc.html"        # 601806
git worktree add ..\ortus-ws-01 -b ws/01-repo-skeleton main
Set-Location ..\ortus-ws-01
```

Всё остальное делается в `..\ortus-ws-01` (`orchestration.md` §1 «Собственная ветка и worktree»). `pnpm install` — в каждом worktree после появления `package.json` (12 §8 п.16). Если скрипт волны запускает исполнителя с `isolation: 'worktree'` до того, как git существует (`workflow.template.js:87`), шаг 0 выполняет интегратор по тому же рецепту и сообщает хеш базового коммита.

## 3. Входы

Читать полностью, в этом порядке:

1. `docs/plan/00-master-plan.md` §0.2 (команды `npm run` ≡ `pnpm`), §3.1 (стек и версии), §3.3 (дерево с владельцами и «точки конфликтов»), §4.8 (формат allowlist для `allowlist-lint`), §5.4 карточка WS-01 (выходы и тесты-первыми — исходный список этого брифа), §6.5 барьер 0→1, §7.4 (порты и изоляция — для README), §8.1 колонка infra, §10.3 PD-38, PD-42, PD-50.
2. `design/docs/14-engineering.md`: «Структура репозитория» (строки 24–53, включая правило `depguard`), «Поток контракта» (55–61 — какие CI-проверки появятся у WS-03), «Ветки, коммиты, ревью» (63–70 — trunk-based, squash, Conventional Commits, CODEOWNERS-пути), «Конвейер CI» (83–94), «Локальный запуск» (96–106 — цели `make`), «Соглашения кода» (108–115 — что писать в `CLAUDE.md`).
3. `docs/plan/analysis/12-prior-project-and-skills.md`: §3.2 строки R9 (формат/линт JS), R10 (golangci v2 + depguard), R11 (Makefile), R13 (PostToolUse-хук), R18 (документация в том же коммите); §3.6 целиком (уроки Windows); §4.1 (git-commit vs PowerShell), §4.4 (module path, Makefile обязателен), §4.7–4.8 (overrides для `CLAUDE.md`), §4.11 (сравнение `.golangci.yml` ассета и 2.0), §4.13 (swagger не применяется), §4.15 (подмножество vercel-правил); §5 п.12, 15–17, 22, 25–26, 28–30; §6 п.3–4, 13–14, 19–22; §8 п.1–3, 5–6, 8, 16, 20, 25–29.
4. `docs/plan/decisions.md`: PD-20 (GitHub Actions), PD-23 (pnpm), Q-104, Q-105, Q-106, Q-110, Q-111, Q-112 (все — WS-01 по MP §9.3).
5. `.claude/skills/golang-lint/assets/.golangci.yml` (ассет, в котором `depguard` выключен, строка 83 — вернуть), `.claude/skills/golang-project-layout/assets/{.gitignore,Makefile}` (образцы), `.claude/skills/git-commit/SKILL.md:93–124` (формат коммита, запреты), `.claude/skills/vercel-react-best-practices/rules/_sections.md` (8 групп правил для PD-42).
6. `design/docs/13-backlog-s0-s2.md:28–29` (S0-01, S0-02 — истории, которые закрывает WS-01; MP §9.2), `design/docs/16-raid-glossary.md:44–63` (шаблон ADR — для `PULL_REQUEST_TEMPLATE.md` и ссылки в `CLAUDE.md`), `design/docs/repo-skeleton/.env.example` (имена переменных для `README.md`; сам файл копирует WS-02).
7. Протоколы: `tdd-protocol.md`, `verification-protocol.md` §6 («Автоматизация в репозитории»), `orchestration.md` §1, §5, §7.
8. Факты dev-машины, снятые 03.10.2026 при подготовке брифа: Node `v22.19.0` (`process.versions.icu` = `77.1`, `tz` = `2025b`, `Intl.NumberFormat('ru-RU').format(84370)` содержит U+00A0, `'ё'.localeCompare('е','ru')` = 1 — полный ICU есть); Go `go1.26.0 windows/amd64`; git `2.52.0.windows.1`; `golangci-lint 2.13.2` (`C:\Users\sys00\go\bin`); `corepack 0.34.0`; **`pnpm` и `make` в PATH отсутствуют**; Docker Desktop есть. Git-репозитория нет (`Is a git repository: false`). Размеры файлов эталона на диске: `Ортус CRM.dc.html` 601 806, `Документация.dc.html` 43 411, `support.js` 69 150 — совпадают с `tools/README.md:12–15`.

## 4. Контракты

WS-01 ничего не потребляет от других WS (зависимостей нет). Чужие контракты, которых ещё нет (`.mcp.json`, `playwright.config.ts`, `api/openapi/ortus.yaml`, `deploy/compose/docker-compose.yml`), не имитируются: шаги CI и скрипты охраняются `hashFiles`/`--if-present` и тестируются на «вакуумном» прохождении (нет файлов → exit 0 с сообщением). Всё ниже — публикуемые контракты; менять их после слияния — только интегратор (`orchestration.md` §7).

### 4.1 Скрипты корневого `package.json` (MP §0.2: `npm run X` ≡ `pnpm X`)

| Скрипт | Команда |
|---|---|
| `lint` | `prettier --check . && pnpm -r --if-present run lint && pnpm lint:go` |
| `lint:go` | `node tools/hooks/run-in.mjs backend golangci-lint run ./...` (v2 отвергает `./backend/...` из корня — 12 §3.6) |
| `typecheck` | `pnpm -r --if-present run typecheck` |
| `test` | `pnpm check-icu && pnpm test:repo && pnpm -r --if-present run test && go -C backend test ./...` |
| `test:repo` | `node --test "tools/**/*.test.mjs"` |
| `check-icu` | `node tools/check-icu.js` |
| `allowlist-lint` | `node tools/allowlist-lint.js` |
| `e2e` | `pnpm --filter @ortus/web --if-present run e2e` |
| `e2e:full` | `pnpm --filter @ortus/web --if-present run e2e:full` |
| `dev:web` | `pnpm --filter @ortus/web --if-present run dev` |
| `e2e:install` | `pnpm --filter @ortus/web --if-present exec playwright install chromium` |
| `mcp:install` | `node node_modules/@playwright/mcp/cli.js install-browser chrome-for-testing` (devDependency `@playwright/mcp` с точным пином добавляет WS-07 — 12 §3.2 R1) |
| `examples` | `make examples` |
| `verify-pages` | `node tools/verify-pages.js` |
| `format` | `prettier --write .` |
| `prepare` | `husky` |

Имена пакетов workspace резервируются в `frontend/CLAUDE.md`, пакеты создают владельцы (MP §3.2–3.3): `@ortus/web`, `@ortus/docs`, `@ortus/tokens`, `@ortus/ui`, `@ortus/domain`, `@ortus/adapter`, `@ortus/api-client`, `@ortus/e2e-kit`, `@ortus/texts`.

### 4.2 Версии (PD-38; Q-106; Q-111)

- `.nvmrc` = `22`; `package.json`: `"packageManager": "pnpm@9.<x>.<y>"` (точная версия из `corepack use pnpm@9` на момент выполнения), `"engines": {"node": ">=22 <23"}`; `.npmrc`: `engine-strict=true`, `auto-install-peers=true`.
- `backend/go.mod`: `module github.com/ortus/ortus-crm/backend` (временный по Q-111; переименование одним коммитом интегратора при появлении remote), `go 1.26` (PD-38 «последняя стабильная» = установленная `go1.26.0`).
- `golangci-lint` v2.13.2 — одна и та же строка `version` в `ci.yml`, `backend/CLAUDE.md` и README.
- PostgreSQL 17 — WS-02; React/Vite/Playwright — владельцы пакетов; стартовые мажоры — 12 §8 п.2.

### 4.3 `.gitattributes` (эталон байт-в-байт; 12 §3.6)

```gitattributes
* text=auto eol=lf
design/** -text
*.png binary
*.jpg binary
*.webp binary
*.woff binary
*.woff2 binary
*.ttf binary
pnpm-lock.yaml linguist-generated -diff
**/routeTree.gen.ts linguist-generated
backend/internal/api/** linguist-generated
frontend/packages/api-client/** linguist-generated
```

### 4.4 Build-теги и `depguard` (`backend/.golangci.yml`)

- База — `.claude/skills/golang-lint/assets/.golangci.yml` (`version: "2"`), плюс из 2.0 (12 §4.11 таблица): `run.build-tags: [integration, isolation, concurrency]` (`tdd-protocol.md` §3 Go); `linters.exclusions.presets: [comments, std-error-handling]`; `errcheck` выключен в `_test.go`; `depguard` **включён** (в ассете выключен, строка 83).
- Правило `depguard` для `backend/internal/modules/**`, `list-mode: strict`, только `allow` (deny резолвится раньше allow — 12 §3.6, R10):

```yaml
depguard:
  rules:
    modules:
      list-mode: strict
      files: ["**/internal/modules/**"]
      allow:
        - $gostd
        - github.com/ortus/ortus-crm/backend/internal/platform
        - github.com/ortus/ortus-crm/backend/internal/api
        - github.com/ortus/ortus-crm/backend/internal/domain
        - github.com/jackc/pgx/v5
        - github.com/google/uuid
```

- `…/internal/modules/*/api` (публичный интерфейс соседнего модуля, 14-eng строка 53) добавляет WS-40 вместе с первым таким пакетом; `…/internal/control` и `…/internal/modules/*/internal` остаются запрещёнными.
- Красная проба: `backend/internal/modules/depguardprobe/denied.go` с `//go:build depguardprobe` импортирует `…/internal/control`; зелёная: `allowed.go` без тега импортирует `…/internal/platform` и `fmt`. Нормальный `golangci-lint run ./...` пробу с тегом не видит; тест R-04 запускает его с `--build-tags depguardprobe`.

### 4.5 Маркер заглушки

Первые три строки файла содержат `@stub Owner: WS-NN` (или `Owner: интегратор`). Владелец заменяет файл целиком. Тест R-12 падает на заглушке без `Owner:`. Заглушки WS-01: `tools/verify-pages.js` (WS-07), `backend/cmd/api/main.go` (WS-40, печатает `ortus-api dev` и выходит), `backend/internal/platform/doc.go` (WS-40), `backend/internal/control/doc.go` (WS-43), `backend/internal/modules/doc.go` (интегратор).

### 4.6 `tools/allowlist-lint.js` (PD-50; MP §4.8)

- CLI: `node tools/allowlist-lint.js [--summary] [каталог …]`; по умолчанию каталоги `frontend/apps/web/e2e/visual/allowlist` и `frontend/apps/docs/e2e/visual/allowlist`; нет каталогов → stdout `allowlist: 0 файлов`, exit 0.
- Запись — строка, начинающаяся с `- `; разделитель полей ` · ` (U+00B7 с пробелами); строки без `- ` — свободный текст:
  `- kind: pixel|label|order|state|no-reference · target: <селектор или текст> · mode: mock|stand|both · reason: <текст> · decision: D-NN|Q-NN · owner: WS-NN`
- Ошибка = exit 1 и `<файл>:<строка>: <сообщение>`: `нет decision (D-NN или Q-NN)`; `kind: pixel требует decision D-NN`; `kind должен быть pixel|label|order|state|no-reference`; `mode должен быть mock|stand|both`; `owner должен быть WS-NN`; `decision должен быть D-NN или Q-NN`; имя файла не `^[a-z][a-z0-9-]*\.md$`; единый файл `e2e/visual/allowlist.md` → `PD-50: allowlist — файл на ключ e2e/visual/allowlist/<key>.md`.
- `--summary` печатает `<ключ>: pixel=N label=N order=N state=N no-reference=N` на файл — для публикации роста на барьере волны (PD-50).
- Экспорт `RECORD_RE` (регулярка с именованными группами) и `parseRecord`, `lintFile`, `summary` — для переиспользования в WS-07.

### 4.7 `tools/check-icu.js` (П13; MP §2.3 п.2–3)

- Экспорт `checkIcu({Intl, versions})` → `{ok, failures[]}`; CLI печатает `icu <ver> tz <ver> ok` и exit 0, либо список провалов и exit 1.
- Проверки по порядку: `versions.icu` непуст («process.versions.icu пуст (small-icu?)»); `Intl.NumberFormat('ru-RU').format(84370)` === `84\u00A0370` («NumberFormat ru-RU: ожидался U+00A0»); `'ё'.localeCompare('е','ru')` > 0; `['10','9','1'].sort(localeCompare ru numeric)` → `['1','9','10']`; `Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(new Date('2026-10-01T10:30:00+03:00'))` содержит `среда` и `1 октября` (демо-дата прототипа, Q-61); `{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}` → `10:30`.
- `CHECK_ICU_FAKE=1` подставляет заведомо сломанный `Intl` (для R-17).

### 4.8 Хуки Claude Code (`.claude/settings.json`)

```json
{
  "hooks": {
    "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [{ "type": "command", "command": "node tools/hooks/format-file.mjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node tools/verify-pages.js" }] }]
  }
}
```

- `format-file.mjs`: читает JSON из stdin, берёт `tool_input.file_path`; путь вне `process.cwd()`, несуществующий или под `design/` → ничего; `.go` → `gofmt -w`; остальное → `node_modules/.bin/prettier --write --ignore-unknown`; без `node_modules` — stderr «prettier не найден: выполните pnpm install в этом worktree» (в 2.0 пропуск был молчаливым — 12 §3.6); **всегда** exit 0 (12 §3.2 R13). Один Node-скрипт вместо `"shell": "powershell"` + bash-варианта — см. §10 п.5.
- `Stop` → `tools/verify-pages.js`: контракт полного скрипта — WS-07 (MP §5.4 карточка WS-07); заглушка WS-01 печатает одну строку и exit 0.
- Хуки читаются на старте сессии (12 §3.6) — после их появления сессия перезапускается; это записано в `CLAUDE.md`.

### 4.9 Git-хуки (`.husky/`; `verification-protocol.md` §6)

- `pre-commit` = `pnpm lint-staged`. Корневой `.lintstagedrc.json`: `"*.go": "gofmt -w"`, `"*.{ts,tsx,mjs,js,json,md,yml,yaml,css}": "prettier --write"`; `frontend/.lintstagedrc.json`: `"*.{ts,tsx}": "eslint --fix"` (ESLint во вложенном конфиге — 12 §3.2 R9).
- `commit-msg` = `node tools/hooks/commit-msg.mjs "$1"`: exit 1 «Сообщение коммита начинается с BOM (EF BB BF)» при BOM (12 §6 п.22); exit 1 «Заголовок не по Conventional Commits: <type>(<scope>): <описание>», если первая строка не `^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9-]+\))?!?: .{1,72}$` (типы — `git-commit/SKILL.md:26–38`); `Merge branch …` — только при `ALLOW_MERGE=1`.
- `pre-push` = `pnpm test && node tools/hooks/pre-push.mjs`: если существует `frontend/apps/web/playwright.config.ts` и `git diff --name-only <база>...HEAD` содержит `frontend/apps/(web|docs)/src/` — `pnpm e2e -- --grep @smoke`, иначе «smoke пропущен: нет изменений страниц» / «smoke пропущен: нет playwright.config.ts»; база = `@{upstream}`, при его отсутствии `main`.
- `tools/hooks/check-tdd-order.mjs <base>`: exit 1, если в `git log --reverse --format=%s <base>..HEAD` первая строка не начинается с `test(` или перед первым `feat(` нет ни одного `test(`; `docs(`/`chore(`/`ci(` до первого `test(` допустимы, только если `feat(` после них нет (12 §6 п.21; `tdd-protocol.md` §1). В CI — job `tdd-order` на `pull_request` для `head_ref` с префиксом `ws/`.

### 4.10 CI (`.github/workflows/ci.yml`; 14-eng «Конвейер CI»; PD-20; PD-32)

| Job | `needs` | Шаги | Охрана до прихода владельца |
|---|---|---|---|
| `lint` | — | `prettier --check .`, `pnpm -r --if-present run lint`, `golangci-lint` v2.13.2 из `backend/` (`config verify` + `run`), Spectral | Spectral: `if: hashFiles('api/openapi/ortus.yaml') != ''` (снимает WS-03) |
| `contract` | `lint` | полный валидатор OpenAPI 3.1, «каждый `x-permissions` ∈ каталог», `make gen` + `git diff --exit-code` | `hashFiles('api/openapi/ortus.yaml')` (WS-03) |
| `unit` | `contract` | `pnpm test` (включая `check-icu`, `test:repo`), `go -C backend test ./...` | — |
| `integration` | `unit` | `go -C backend test -tags integration ./...` (testcontainers; Docker есть на `ubuntu-latest`) | — (без тегированных файлов — пустой успех) |
| `isolation-concurrency` | `integration` | `go -C backend test -tags isolation ./...`, `-tags concurrency` | — |
| `build` | `isolation-concurrency` | `pnpm -r --if-present run build`, `go -C backend build ./...` | образы/SBOM/подпись — WS-69 |
| `e2e` | `build` | `pnpm e2e:install`, `pnpm e2e` (3 проекта; `webServer[1]` эталон `--offline` — WS-07) | `hashFiles('frontend/apps/web/playwright.config.ts')` (WS-07) |
| `visual` | `e2e` | `pnpm e2e -- --grep "visual|labels"`, артефакты `playwright-report/`, `test-results/` | та же (WS-07) |
| `examples-fresh` | `contract` | `make examples` + `git diff --exit-code api/openapi/examples` | `hashFiles('tools/gen/gen-examples.js')` (WS-51) |
| `allowlist-lint` | — | `node tools/allowlist-lint.js` | — |
| `check-icu` | — | `node tools/check-icu.js` | — |
| `tdd-order` | — | `node tools/hooks/check-tdd-order.mjs origin/${{ github.base_ref }}` | `if: github.event_name == 'pull_request' && startsWith(github.head_ref, 'ws/')` |

Общее: `on: [pull_request, push(main)]`; `concurrency: ci-${{ github.ref }}`, `cancel-in-progress: true`; `ubuntu-latest` (канон baseline — Linux, PD-32); `setup-go` с `go-version-file: backend/go.mod`; `setup-node` 22 + `corepack enable`; `pnpm install --frozen-lockfile`; кеш pnpm store и Go build cache. Deploy-этапы (`deploy dev → stage → prod-pilot`, 14-eng строки 91–93) — вне WS-01 (§10 п.13).

### 4.11 CODEOWNERS (14-eng строка 68; `verification-protocol.md` §5)

```text
backend/internal/platform/authz/**   @ortus/security-lead @ortus/backend-lead
backend/migrations/**                @ortus/backend-lead @ortus/security-lead
backend/internal/modules/**/finance* @ortus/backend-lead @ortus/security-lead
backend/internal/modules/finance/**  @ortus/backend-lead @ortus/security-lead
api/permissions.yaml                 @ortus/security-lead
design/**                            @ortus/design-owner
```

Имена команд — плейсхолдеры до появления GitHub-организации (Q-111); правило «2 ревьюера» в волнах обеспечивает `reviewers: 2` в `args.ws` (MP §7.2).

### 4.12 Prettier / ESLint (12 §3.2 R9)

- `.prettierrc.json`: `printWidth: 100`, `trailingComma: "all"`, `endOfLine: "lf"`, `singleQuote: true`.
- `.prettierignore`: `design/`, `.claude/`, `docs/plan/` (ссылки «файл:строки» в отчётах не должны плыть), `*.go`, `pnpm-lock.yaml`, `**/routeTree.gen.ts`, `frontend/packages/api-client/`, `.playwright-mcp/`, `playwright-report/`, `test-results/`.
- `frontend/eslint.config.mjs`: `typescript-eslint` strict, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-testing-library` на `**/*.test.tsx`, `eslint-plugin-playwright` на `**/e2e/**` с `react-hooks/rules-of-hooks: off`, `eslint-config-prettier` последним.
- devDependencies с точными версиями (`pnpm add -D -E`): `prettier`, `eslint`, `typescript`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`, `eslint-plugin-testing-library`, `eslint-plugin-playwright`, `eslint-config-prettier`, `husky`, `lint-staged`, `js-yaml` (для `ci-order.test.mjs`); стартовые мажоры — 12 §8 п.2 (`eslint ^9`, `prettier ^3.4.2`, `husky ^9.1.7`, `lint-staged ^15.4.3`, `typescript ^5`).

### 4.13 `Makefile` (14-eng «Локальный запуск»; MP §0.2; 12 §3.2 R11)

- Цели: `gen` (WS-03), `migrate` (WS-41), `seed` (WS-52), `examples` (WS-51) — в WS-01 печатают `make <цель>: реализует WS-NN` и `exit 2`; `up` / `down` = `docker compose -f deploy/compose/docker-compose.yml up -d --wait` / `down` (файл — WS-02); `dev` = `pnpm dev:web` (api/worker добавляет WS-40); `test` = `go -C backend test ./...`; `lint` = `golangci-lint run ./...` из `backend`; `help` — grep `## `.
- Рецепты без `&&`, `||`, `|`, `sed`, `rm -rf`, `$(shell …)` — одинаково под `sh` и `cmd.exe` (12 §3.6 «скрипты кроссплатформенны»); каждая цель — одна команда на строку.

### 4.14 Evidence инфраструктурного WS

`docs/plan/evidence/_infra/WS-01/{smoke.txt,lint.txt,hooks.txt,ci-order.txt,gitattributes.txt}` — дословные выводы команд §8.

## 5. Экраны, диалоги, состояния

Страниц, диалогов и URL у WS-01 нет (`pages: []` в MP §7.2; шесть обязательных пунктов `verification-protocol.md` §1.3 не применяются). Вместо экранов — поверхности, у которых есть состояния, и каждое состояние — отдельный тест §6:

| Ключ (условный) | Дословная подпись/вывод | Кто видит | Состояния | Тест |
|---|---|---|---|---|
| `hook-postToolUse` | stderr «prettier не найден: выполните pnpm install в этом worktree» | агент в worktree | ок (`.go` отформатирован) / ок (`.ts` отформатирован) / путь вне репозитория → не тронут / нет `node_modules` → сообщение, exit 0 / ошибка форматтера → exit 0 | R-07 |
| `hook-stop` | «verify-pages: заглушка WS-01, реализует WS-07» | агент | заглушка (WS-01) → полный скрипт (WS-07) | R-12 |
| `git-commit-msg` | «Сообщение коммита начинается с BOM (EF BB BF)»; «Заголовок не по Conventional Commits: <type>(<scope>): <описание>» | коммитящий | принят / отклонён BOM / отклонён формат | R-09, R-10 |
| `git-pre-commit` | вывод lint-staged | коммитящий | `.go` → gofmt; `.ts/.tsx/.mjs/.json/.md/.yml` → prettier (+ eslint во вложенном конфиге) | R-06 |
| `git-pre-push` | «smoke пропущен: нет изменений страниц» | пушащий | тесты зелёные + smoke / тесты зелёные + smoke пропущен / тесты красные → push отклонён | R-06, unit `pre-push.test.mjs` |
| `ci` | имена job и статусы на PR | ревьюер, интегратор | все зелёные на пустом workspace; охраняемые шаги `skipped`; `tdd-order` красный на ветке без `test(` первым | R-11, R-08 |
| `check-icu` | «icu 77.1 tz 2025b ok» / список провалов | все | ок / small-icu / сломанная локаль | R-13…R-17 |
| `allowlist-lint` | `<файл>:<строка>: нет decision (D-NN или Q-NN)` и др. | владельцы страниц, интегратор | ок / ошибка записи / устаревший единый файл / `--summary` | R-18…R-22 |

## 6. Тесты первыми

Все тесты WS-01 — Node 22 `node:test` (`node --test "tools/**/*.test.mjs"`, без зависимостей кроме `js-yaml`) и Go/`golangci-lint` там, где проверяется Go-сторона. Первый коммит ветки — скелет `tools/repo-check.test.mjs`: 30 `test()` ниже в состоянии `{ todo: true }` (аналог `test.fixme` для `node:test`; `tdd-protocol.md` §2 шаг 1, MP §8.1 колонка infra «`harness.spec.ts`, smoke»). Имя теста = текст пункта дословно. Каждый пункт снимается с `todo` отдельным циклом §7 (`tdd-protocol.md` §2 шаг 8).

### (а) E2E-скелет инфраструктуры — 30 пунктов (`tools/repo-check.test.mjs`)

Источник — 12 §6 (номера в скобках), MP §5.4 карточка WS-01 («Тесты-первыми»), MP §4.8/PD-50, 14-eng. Селекторов DOM нет; «селектор» здесь — команда и точная строка вывода.

1. **R-01** (12 §6 п.3). Given `.gitignore` корня; When `git check-ignore -q .playwright-mcp/5196/page.png`, `… playwright-report/index.html`, `… test-results/x`, `… frontend/apps/web/src/routeTree.gen.ts`, `… .env`, `… backend/bin/api`, `… node_modules/x`; Then каждый вызов exit 0; When `git check-ignore -q .env.example`; Then exit 1.
2. **R-02** (12 §6 п.4; MP §5.4). Given файлы `frontend/apps/web/e2e/**/*.spec.ts` и `frontend/apps/docs/e2e/**/*.spec.ts` (если каталогов нет — пункт проходит с выводом «e2e-файлов нет»); When grep по `:5173`, `:3000`, `localhost:4173` (эталон берётся из `process.env.REFERENCE_URL`, MP §7.4); Then совпадений нет.
3. **R-03** (12 §6 п.13). Given `backend/.golangci.yml` с `version: "2"` и `run.build-tags: [integration, isolation, concurrency]`; When `golangci-lint config verify` и `golangci-lint run ./...` с `cwd = backend`; Then оба exit 0, stdout `golangci-lint version` начинается с `golangci-lint has version 2.`.
4. **R-04** (12 §6 п.14, сторона «красная»). Given `backend/internal/modules/depguardprobe/denied.go` с `//go:build depguardprobe`, импортирующий `github.com/ortus/ortus-crm/backend/internal/control`; When `golangci-lint run --build-tags depguardprobe ./internal/modules/depguardprobe/...` из `backend`; Then exit ≠ 0 и stdout содержит `depguard` и `internal/control`.
5. **R-05** (12 §6 п.14, сторона «зелёная»). Given `backend/internal/modules/depguardprobe/allowed.go` без тега, импортирующий только `…/internal/platform` и `fmt`; When `golangci-lint run ./internal/modules/...` из `backend`; Then exit 0.
6. **R-06** (12 §6 п.19). Given временный worktree `tmp/ws01-hooks` от `HEAD` с `pnpm install --offline`; When записаны `backend/zz_probe.go` (`package backend;func  F(){}` — два пробела, без форматирования) и `tools/zz_probe.mjs` (`const  a=1` без `;`), `git add`, `git commit -F`; Then `gofmt -l backend/zz_probe.go` пуст и `prettier --check tools/zz_probe.mjs` exit 0 в коммите; worktree и ветка удаляются в `finally`.
7. **R-07** (12 §6 п.20). Given `tools/hooks/format-file.mjs`; When на stdin `{"tool_input":{"file_path":"<cwd>/tmp/p.go"}}` с неотформатированным файлом; Then файл после `gofmt`, exit 0; When путь `C:\Windows\Temp\p.go` (вне `cwd`); Then файл не изменён, exit 0; When `PATH` без `gofmt` (переменная окружения `PATH=''`); Then exit 0 и stderr содержит `gofmt`.
8. **R-08** (12 §6 п.21). Given список заголовков (unit на `check-tdd-order.mjs` с инжектированным `git log`): `['test(ws-01): …','feat(ws-01): …']` → exit 0; `['feat(ws-01): …']` → exit 1 с «Первый коммит ветки должен быть test(…)»; `['docs(ws-01): …','feat(ws-01): …']` → exit 1; `['chore(repo): …']` (без `feat(`) → exit 0; When реальный `git log --reverse --format=%s main..HEAD` ветки `ws/01-repo-skeleton`; Then первая строка начинается с `test(ws-01)`.
9. **R-09** (12 §6 п.22). Given файл сообщения `EF BB BF 66 65 61 74 …`; When `node tools/hooks/commit-msg.mjs <файл>`; Then exit 1, stderr «Сообщение коммита начинается с BOM (EF BB BF)»; Given тот же текст без BOM; Then exit 0; When реальный `git log -1 --format=%s`; Then не начинается с `\uFEFF`.
10. **R-10** (`git-commit/SKILL.md:16–38`). Given заголовки `update stuff`, `Feat: x`, `feat(WS-01): x` (верхний регистр scope), `feat(ws-01): ` + 80 символов; When `commit-msg.mjs`; Then каждый exit 1 с «Заголовок не по Conventional Commits…»; Given `feat(ws-01): add husky`, `test(ws-01): red R-13`, `refactor(ws-01)!: x`, `chore(claude): hooks`; Then exit 0.
11. **R-11** (MP §5.4 «тест порядка этапов CI»; 14-eng «Конвейер CI»). Given `.github/workflows/ci.yml` (разбор `js-yaml`); Then `jobs` содержит `lint, contract, unit, integration, isolation-concurrency, build, e2e, visual, examples-fresh, allowlist-lint, check-icu, tdd-order`; `contract.needs` ⊇ `[lint]`, `unit.needs` ⊇ `[contract]`, `integration.needs` ⊇ `[unit]`, `isolation-concurrency.needs` ⊇ `[integration]`, `build.needs` ⊇ `[isolation-concurrency]`, `e2e.needs` ⊇ `[build]`, `visual.needs` ⊇ `[e2e]`, `examples-fresh.needs` ⊇ `[contract]`; `on` содержит `pull_request` и `push.branches: [main]`; каждый шаг, чья команда содержит `spectral`, `make gen`, `pnpm e2e`, `make examples`, имеет `if:` с `hashFiles(`.
12. **R-12** (MP §5.4 «каждая заглушка несёт `Owner: WS-NN`»). Given `git ls-files`; When в первых трёх строках файла есть `@stub`; Then та же строка соответствует `/Owner: (WS-\d{2}|интегратор)/`; Then множество таких файлов ⊇ `{tools/verify-pages.js, backend/cmd/api/main.go, backend/internal/platform/doc.go, backend/internal/control/doc.go, backend/internal/modules/doc.go}`.
13. **R-13** (MP §5.4; П13). Given `node tools/check-icu.js`; Then exit 0, stdout `icu <версия> tz <версия> ok`; When `checkIcu({Intl})` с реальным `Intl`; Then `Intl.NumberFormat('ru-RU').format(84370)` === `'84\u00A0370'` (не `'84 370'` с U+0020).
14. **R-14**. `'ё'.localeCompare('е','ru')` > 0 и `'е'.localeCompare('ё','ru')` < 0; `['я','ё','е','а'].sort((a,b)=>a.localeCompare(b,'ru'))` → `['а','е','ё','я']`.
15. **R-15**. `['10','9','1'].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}))` → `['1','9','10']` (`dataVM` сортирует `localeCompare ru numeric`, MP §5.4 карточка WS-29).
16. **R-16**. `new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Moscow'}).format(new Date('2026-10-01T10:30:00+03:00'))` содержит `среда` и `1 октября`; `new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Moscow'}).format(тот же момент)` === `'10:30'` (MP §2.3 п.2–3).
17. **R-17**. Given фейковый `Intl`, у которого `NumberFormat(...).format` возвращает `'84 370'` с U+0020, а `versions.icu` = `undefined`; When `checkIcu(fake)`; Then возвращает 2 провала с текстами «NumberFormat ru-RU: ожидался U+00A0» и «process.versions.icu пуст (small-icu?)», а CLI с `CHECK_ICU_FAKE=1` завершается exit 1.
18. **R-18** (PD-50). Given `tools/fixtures/allowlist/ok.md` с 5 записями всех `kind` (`pixel` с `PD-27`, `label` с `Q-29`, `order` с `PD-29`, `state` с `PD-27`, `no-reference` с `PD-26`); When `node tools/allowlist-lint.js tools/fixtures/allowlist`; Then exit 0, stdout `ok.md: 5 записей`.
19. **R-19**. Given `no-decision.md` с записью без `decision:`; Then exit 1, stdout `tools/fixtures/allowlist/no-decision.md:3: нет decision (D-NN или Q-NN)`.
20. **R-20** (MP §4.8 «записи `kind: pixel` без D-ID не допускаются»). Given `pixel-q.md` с `kind: pixel … decision: Q-41`; Then exit 1, `…pixel-q.md:2: kind: pixel требует decision D-NN`.
21. **R-21**. Given `bad-kind.md` с `kind: colour`, `mode: dev`, `owner: WS-7`; Then exit 1 и три сообщения: `kind должен быть pixel|label|order|state|no-reference`, `mode должен быть mock|stand|both`, `owner должен быть WS-NN`; When `--summary` на `ok.md`; Then stdout `ok: pixel=1 label=1 order=1 state=1 no-reference=1`.
22. **R-22**. Given каталог `tools/fixtures/allowlist/legacy/` с файлом `allowlist.md` (единый файл старого протокола `verification-protocol.md` §3 п.5); Then exit 1, `…legacy/allowlist.md:1: PD-50: allowlist — файл на ключ e2e/visual/allowlist/<key>.md`; Given вызов без аргументов при отсутствии каталогов `frontend/apps/*/e2e/visual/allowlist`; Then exit 0, stdout `allowlist: 0 файлов`.
23. **R-23** (14-eng строка 68). Given `CODEOWNERS`; Then есть строки, чей шаблон равен `backend/internal/platform/authz/**`, `backend/migrations/**`, `backend/internal/modules/**/finance*`, `api/permissions.yaml`, `design/**`, и у каждой ≥ 1 владелец, начинающийся с `@`; нет строк без владельца.
24. **R-24** (14-eng «Локальный запуск»; 12 §3.6). Given `Makefile`; Then цели `gen up down migrate seed dev examples test lint help` объявлены; ни один рецепт не содержит `&&`, `||`, ` | `, `sed `, `rm -rf`, `$(shell`; When `make gen` (при наличии `make`); Then exit 2 и stdout `make gen: реализует WS-03`.
25. **R-25** (эталон неприкосновенен; `tools/README.md:12`). Given `.gitattributes`; When `git check-attr text eol -- "design/Ортус CRM.dc.html"`; Then `text: unset`; When `git check-attr eol -- README.md`; Then `eol: lf`; When `git check-attr linguist-generated -- pnpm-lock.yaml`; Then `set`; When `git cat-file -s HEAD:"design/Ортус CRM.dc.html"`; Then `601806`; When `git cat-file -s HEAD:"design/support.js"`; Then `69150` (`tools/README.md:15`).
26. **R-26** (MP §0.2; PD-38). Given корневой `package.json`; Then `scripts` содержит ключи `lint typecheck test test:repo check-icu allowlist-lint e2e e2e:full dev:web mcp:install e2e:install examples verify-pages format prepare`; `packageManager` соответствует `/^pnpm@9\.\d+\.\d+$/`; `engines.node` = `>=22 <23`; `.nvmrc` = `22\n`; `.npmrc` содержит `engine-strict=true`.
27. **R-27** (14-eng строка 42; MP §3.3). `pnpm-workspace.yaml` → `packages: ['frontend/apps/*', 'frontend/packages/*']`; `frontend/package.json` `private: true`, имя `@ortus/frontend`.
28. **R-28** (12 §3.2 R18; PD-42; Q-105). `CLAUDE.md` содержит заголовок «Что протухает» и в его таблице строки для `package.json`, `backend/go.mod`, `.env.example`, `api/openapi/ortus.yaml`, `.github/workflows/ci.yml`, `.claude/settings.json`, `docs/adr`, `docs/plan/ws`; содержит строки `git commit -F`, `явный реестр`, `init()`, `golang-swagger не применяется`, `heroui-react`, `golang-how-to`; `frontend/CLAUDE.md` содержит заголовок «Применимые правила vercel-react-best-practices» с группами `async`, `bundle`, `client`, `rerender`, `rendering`, `js`, `advanced` и строку «`server-*` не применяются»; `backend/CLAUDE.md` содержит `github.com/ortus/ortus-crm/backend`, `127.0.0.1:8080`, `build-tags`, `depguard`, заголовок «Зависимости: что покупает».
29. **R-29** (smoke, MP §6.5 барьер 0→1). Given свежий `git worktree add tmp/ws01-smoke HEAD`; When `corepack pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; pnpm test; go -C backend test ./...; go -C backend vet ./...`; Then каждый exit 0 (PowerShell: последовательно с проверкой `$LASTEXITCODE`, без `&&`). Вывод — `docs/plan/evidence/_infra/WS-01/smoke.txt`.
30. **R-30** (Q-111; 12 §5 п.28). `backend/go.mod`: первая строка `module github.com/ortus/ortus-crm/backend`, директива `go 1.26`; каждый модуль из `require` присутствует в таблице «Зависимости: что покупает» `backend/CLAUDE.md` (в WS-01 `require` пуст — таблица содержит строку «пока нет»).

### (б) Unit — функции и табличные кейсы

`tools/check-icu.test.mjs` — `checkIcu({Intl, versions})` → `{ok, failures[]}`:
- реальный `Intl` → `ok: true`, `failures: []`;
- фейк, у которого `NumberFormat('ru-RU').format(84370)` = `'84 370'` (U+0020) → 1 провал «NumberFormat ru-RU: ожидался U+00A0»;
- фейк с `localeCompare` всегда 0 → провал «ё/е: ожидался порядок е < ё»;
- `versions.icu` = `undefined` → провал «process.versions.icu пуст (small-icu?)»;
- все провалы одновременно → 5 строк в порядке проверок §4.7.

`tools/allowlist-lint.test.mjs` — `parseRecord(line)`, `lintFile(text, name)`, `summary(records)`:
- строка без `- ` → `null` (не запись, не ошибка);
- запись с ` · ` внутри `reason` («кавычки · и точки») → `reason` берётся целиком до ` · decision:`;
- `decision: D-7` → ошибка `decision должен быть D-NN или Q-NN`;
- `kind: no-reference` с `Q-54` → ок; `kind: pixel` с `PD-32` → ок; `owner: WS-07` → ок;
- имя файла `Modules.md` → ошибка имени; `allowlist.md` → ошибка PD-50;
- `summary` на 5 записях → `pixel=1 label=1 order=1 state=1 no-reference=1`.

`tools/hooks/commit-msg.test.mjs` — `checkMessage(buffer)` → `{ok, reason}`:
- таблица R-09/R-10 целиком;
- `fixup! feat(ws-01): x` → ошибка формата;
- тело после пустой строки не проверяется (72 символа — только заголовок);
- `Merge branch 'main' into ws/01-repo-skeleton` → ок только при `ALLOW_MERGE=1`.

`tools/hooks/check-tdd-order.test.mjs` — `checkOrder(subjects[])`:
- таблица R-08 (4 кейса) + пустой список → ошибка «нет коммитов относительно базы».

`tools/hooks/pre-push.test.mjs` — `decide({changed[], hasPlaywright})` → `{runSmoke, message}`:
- `['frontend/apps/web/src/routes/home/x.tsx'], true` → `runSmoke: true`;
- то же, `hasPlaywright: false` → `false`, «smoke пропущен: нет playwright.config.ts»;
- `['docs/plan/x.md'], true` → `false`, «smoke пропущен: нет изменений страниц»;
- `['frontend/apps/docs/src/a.ts'], true` → `true`.

`tools/hooks/format-file.test.mjs` — `pickFormatter(path, cwd)` → `'gofmt' | 'prettier' | null`:
- `backend/x.go` внутри `cwd` → `gofmt`; `frontend/a.tsx` → `prettier`; `C:\Windows\Temp\p.go` → `null`; `design/x.html` → `null` (эталон не форматируется).

`tools/ci-order.test.mjs` — `chain(jobs)` → упорядоченный список по `needs`:
- R-11 на реальном `ci.yml`; фикстура с циклом `needs` → ошибка «цикл в needs».

### (в) Компонентные

Нет (UI отсутствует). Клавиатура/axe не применяются.

### (г) Контрактные / интеграционные

- `golangci-lint config verify` + `run` (R-03) и depguard с обеих сторон (R-04/R-05) — реальным бинарём `golangci-lint 2.13.2` локально и той же версией в CI.
- Хуки на реальном git (R-06, R-09 реальный лог, R-08 реальный лог).
- Smoke в свежем worktree (R-29) — «интеграционный» тест инфраструктуры; его же выполняет интегратор на барьере 0→1 (MP §6.5).
- CI на GitHub: при наличии remote первый PR `ws/01-repo-skeleton → main` показывает 12 job; `e2e`, `visual`, `examples-fresh` зелёные с пропущенными шагами. Без remote (Q-111) — локальный эквивалент: команды R-29 плюс `node tools/allowlist-lint.js`, `node tools/check-icu.js`, `node tools/hooks/check-tdd-order.mjs main` в порядке `needs` (R-11), вывод в `evidence/_infra/WS-01/ci-order.txt`.

## 7. Шаги реализации (TDD-циклы)

Оценка — в «циклах» (один цикл ≈ 20–40 минут агента); M ≈ 2–3 сессии (MP §5.1). Коммиты — Conventional Commits со scope `ws-01` (12 §8 п.25), через `git commit -F msg.txt` без BOM (12 §3.6). Один коммит не смешивает red и green разных пунктов (`tdd-protocol.md` §1 п.4).

0. **База (основной чекаут, до worktree)** — 1 цикл. Red: нет (git ещё не существует). Команды — §2, блок `powershell`. Проверка: `git cat-file -s HEAD:"design/Ортус CRM.dc.html"` = 601806.
1. **Скелет (первый коммит ветки)** — 1 цикл. `tools/repo-check.test.mjs` с 30 `test(..., {todo:true})` из §6а; `node --test tools/` проходит. Коммит `test(ws-01): скелет repo-check — 30 пунктов 12 §6 и MP §5.4 в todo`.
2. **Игноры и атрибуты** — 1 цикл. Red: снять todo R-01, R-25 → красные (нет `.gitignore`; `linguist-generated` = `unspecified`). Green: `.gitignore` (`node_modules/`, `.playwright-mcp/`, `playwright-report/`, `test-results/`, `**/routeTree.gen.ts`, `.env`, `.env.*`, `!.env.example`, `bin/`, `coverage*`, `tmp/`, `*.log`, `.DS_Store`, `.idea/`, `.vscode/*`, `!.vscode/extensions.json`), `.editorconfig` (`end_of_line = lf`, `charset = utf-8`, `indent_style = space`, `indent_size = 2`, `[*.go] indent_style = tab`, `[Makefile] indent_style = tab`), `.nvmrc`. Коммиты `test(ws-01): R-01, R-25 красные` → `feat(ws-01): .gitignore, .editorconfig, .nvmrc`.
3. **pnpm workspace** — 2 цикла. Red: R-26, R-27. Green: `corepack enable; corepack use pnpm@9` → `packageManager`; `package.json` со скриптами §4.1, `.npmrc`, `pnpm-workspace.yaml`, `frontend/package.json`, `frontend/tsconfig.base.json` (`strict: true`, `noUncheckedIndexedAccess: true`, `moduleResolution: bundler`); `pnpm install` → `pnpm-lock.yaml`. Refactor: таблица «Проверки одной командой» в `README.md` (12 §1 строка 43).
4. **Prettier/ESLint/lint-staged/husky** — 2 цикла. Red: R-06, R-09, R-10; unit `commit-msg.test.mjs`. Green: devDependencies с `-E`; `.prettierrc.json`, `.prettierignore`, `frontend/eslint.config.mjs`, `.lintstagedrc.json`, `frontend/.lintstagedrc.json`, `husky` через `prepare`, `.husky/pre-commit`, `.husky/commit-msg`, `tools/hooks/commit-msg.mjs`. Коммит `feat(ws-01): prettier 100, eslint flat, lint-staged, husky pre-commit/commit-msg`.
5. **pre-push и порядок коммитов** — 1 цикл. Red: R-08; unit `check-tdd-order.test.mjs`, `pre-push.test.mjs`. Green: `tools/hooks/{check-tdd-order,pre-push,run-in}.mjs`, `.husky/pre-push`.
6. **Хуки Claude Code** — 1 цикл. Red: R-07, R-12; unit `format-file.test.mjs`. Green: `tools/hooks/format-file.mjs`, `.claude/settings.json` (§4.8), заглушка `tools/verify-pages.js` с `@stub Owner: WS-07`. Коммит `feat(ws-01): PostToolUse-форматирование и Stop-хук verify-pages (заглушка WS-07)`. Проверка вручную после перезапуска сессии → `evidence/_infra/WS-01/hooks.txt`.
7. **check-icu** — 1 цикл. Red: R-13…R-17; unit. Green: `tools/check-icu.js` (CLI + экспорт); `test` в `package.json` начинается с `pnpm check-icu` (П13 «в CI и pre-test»).
8. **allowlist-lint** — 2 цикла. Red: R-18…R-22; unit. Green: фикстуры и `tools/allowlist-lint.js`. Refactor: грамматика записи — одна регулярка с именованными группами, экспорт `RECORD_RE`.
9. **Go-сторона** — 2 цикла. Red: R-03, R-04, R-05, R-30 (нет `go.mod`). Green: `go mod init github.com/ortus/ortus-crm/backend` (`go 1.26`), заглушки с `@stub`, `depguardprobe/{allowed,denied}.go`, `backend/.golangci.yml` (§4.4), `backend/.gitignore` по ассету `golang-project-layout`. Замечания `revive`/`godot` в `doc.go` исправляются, не глушатся (12 §5 п.22).
10. **Makefile** — 1 цикл. Red: R-24. Green: `Makefile` (§4.13). На машине без `make` тест проверяет текст; `make gen` выполняется, только если `Get-Command make` находит бинарь (в CI — всегда).
11. **CI** — 2 цикла. Red: R-11; unit `ci-order.test.mjs`. Green: `.github/workflows/ci.yml` (§4.10), `.github/PULL_REQUEST_TEMPLATE.md` с чек-листом: ссылка на бриф WS; порядок `test(` → `feat(`; ссылки на `docs/plan/reports/WS-NN.md` и `evidence/`; изменённые контракты согласованы с интегратором; allowlist только с D-ID; для `authz/migrations/finance/permissions.yaml` — второй ревьюер; при архитектурном решении — ADR по шаблону `16-raid-glossary.md:46–63`.
12. **CODEOWNERS** — 0,5 цикла. Red: R-23. Green: §4.11.
13. **CLAUDE.md ×3 и README** — 2 цикла. Red: R-28. Green — содержание:
    - `CLAUDE.md`: «Эталон и протоколы» (ссылки, `design/` неприкосновенен); «Команды» — таблица `pnpm`/`make` с пометкой «`npm run X` ≡ `pnpm X`»; «Windows» — 8 правил из 12 §3.6 (`go -C backend`; без `&&` в PowerShell 5.1; `git commit -F` без BOM с фрагментом `[System.IO.File]::WriteAllText($f,$m,(New-Object System.Text.UTF8Encoding $false))`; `curl.exe --noproxy "*"`; `$OutputEncoding`; хуки читаются на старте сессии; два браузера; `pnpm install` в каждом worktree); «Коммиты» — типы из `git-commit/SKILL.md`, запреты `--no-verify`/`--force`/правки git config, при падении хука — новый коммит; «Отступления от скиллов (company overrides)» — явный реестр вместо `init()` (Q-105; 12 §4.7), порт в `internal/platform/<port>` + `<port>test` фейк (12 §4.8), `golang-swagger не применяется` (12 §4.13), `heroui-react` — справочник (PD-13), ссылки на 18 неустановленных `golang-*` скиллов игнорировать и директиву `golang-how-to` не писать (12 §4, вводный абзац), `testify`+`goleak` да / `lo`+`oops` нет (Q-110), SQL миграций пишет агент по `10-data-model.md` под CODEOWNERS (Q-104); «Что протухает» — таблица 12 §3.2 R18; «Границы автономии» — ссылка на `orchestration.md` §7; «Логи» — 14-eng строка 114; «Хуки Claude Code» — §4.8.
    - `frontend/CLAUDE.md`: раскладка MP §3.3, имена пакетов §4.1, правила 14-eng строк 112–113, «Применимые правила vercel-react-best-practices» по таблице 12 §4.15 (применимы `async-*` кроме `api-routes`, `bundle-*` с `React.lazy` вместо `next/dynamic`, `client-*` с TanStack Query вместо SWR, `rerender-*`, `rendering-*` кроме `hydration-*`, `js-*`, `advanced-*`; `server-*` не применяются), селекторы и запреты `tdd-protocol.md` §3 TS/Playwright, цвета только `--ox-*` (12 §5 п.17), один DOM (п.18), даты через `clock` (п.20), иконки-лигатуры (12 §8 п.20), порты MP §7.4.
    - `backend/CLAUDE.md`: module path, раскладка 14-eng строк 32–41, `go -C backend`, линт из `backend/`, build-теги, allow-list depguard §4.4, `ctx` первым / `%w` / «логировать или возвращать» (12 §5 п.23–24), типизированные ошибки → `Problem.code` в одном месте и `scopeQuery` в каждом запросе (14-eng строки 110–111), `HTTP_ADDR=127.0.0.1:8080` (Q-112), `-race` только в CI (12 §8 п.3), testcontainers для `integration` (Q-107), таблица «Зависимости: что покупает» (12 §5 п.28), секреты без умолчаний (п.29).
    - `README.md`: раздел «Onboarding (Windows 11, PowerShell 5.1)» — §8 п.0 ниже; раздел «Заглушки волны 0» (§4.5); «Проверки одной командой»; «CI локально» (порядок §6г).
14. **Smoke, отчёт, статус** — 1 цикл. Red: R-29. Выполнить §8; `docs/plan/reports/WS-01.md` по `orchestration.md` §5; строка WS-01 в `status.md` → `на проверке`. Refactor-проход: `pnpm format`, `golangci-lint run --fix`, `node tools/hooks/check-tdd-order.mjs main` на своей ветке.

Итого ≈ 20 циклов.

## 8. Проверка

Страниц нет: e2e Playwright, визуальная сверка и MCP-проходка (`verification-protocol.md` §1, §3, §4) не применяются; проверяющих страниц скрипт не запускает (`pages: []`). Проверка WS-01 — это §6г, выполняемая исполнителем, затем повторяемая ревьюером/интегратором в свежем worktree. MCP-доступность самого харнесса (12 §6 п.1–2) проверяет WS-07.

0. **Onboarding (содержимое раздела README; выполняется один раз на машине).**
   1. `winget install OpenJS.NodeJS.LTS` (Node 22); `corepack enable` → `pnpm` 9 (corepack 0.34 уже есть).
   2. Go — установлен `go1.26.0`; `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.13.2`.
   3. `make`: `winget install GnuWin32.Make` или `scoop install make`; Docker Desktop — есть.
   4. Не менять `core.autocrlf` (скилл `git-commit`: «NEVER update git config») — `.gitattributes` главнее.
   5. В каждом worktree: `corepack pnpm install`; после появления WS-07: `pnpm e2e:install` и `pnpm mcp:install` — два разных браузера (12 §8 п.4).
   6. PowerShell 5.1: команды по одной, `if ($LASTEXITCODE -ne 0) { throw }` вместо `&&`; `curl.exe --noproxy "*"` (`HTTP_PROXY` экспортирован); `[Console]::OutputEncoding = [Text.Encoding]::UTF8` перед `psql`/кириллицей.
   7. Коммит: `[System.IO.File]::WriteAllText("$PWD\msg.txt", "test(ws-NN): …", (New-Object System.Text.UTF8Encoding $false)); git commit -F msg.txt`.
   8. `.mcp.json` и `.claude/settings.json` читаются на старте сессии — после изменений перезапустить сессию.
   9. Порты MP §7.4: исполнитель `5173 + NN`, проверяющий `6000 + индекс ключа`, интегратор 5173, эталон 4173 общий; worktree: `git worktree add ..\ortus-ws-NN -b ws/NN-<slug> main; Set-Location ..\ortus-ws-NN; corepack pnpm install`.
1. **Smoke в свежем worktree (R-29).**

```powershell
git worktree add tmp/ws01-smoke ws/01-repo-skeleton; Set-Location tmp/ws01-smoke
corepack pnpm install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { throw }
pnpm lint;      if ($LASTEXITCODE -ne 0) { throw }
pnpm typecheck; if ($LASTEXITCODE -ne 0) { throw }
pnpm test;      if ($LASTEXITCODE -ne 0) { throw }
go -C backend test ./...; if ($LASTEXITCODE -ne 0) { throw }
go -C backend vet ./...;  if ($LASTEXITCODE -ne 0) { throw }
Set-Location backend; golangci-lint run ./...; if ($LASTEXITCODE -ne 0) { throw }
```

   Ожидаемые дословные строки: `icu 77.1 tz 2025b ok` (check-icu на этой машине), `allowlist: 0 файлов`, в сводке `node --test` — `# tests 30`, `# pass 30`, `# todo 0`, для каждого Go-пакета — `ok  	github.com/ortus/ortus-crm/backend/...`. Вывод → `docs/plan/evidence/_infra/WS-01/smoke.txt`; вывод `golangci-lint` → `lint.txt`.
2. **Хуки git (в том же worktree).** Записать `backend/zz.go` с лишними пробелами; `git add`; `msg.txt` = `feat(ws-01): probe` без BOM → коммит проходит, `git show --stat` показывает отформатированный файл; `msg.txt` с BOM → отказ «Сообщение коммита начинается с BOM (EF BB BF)»; `msg.txt` = `update` → отказ «Заголовок не по Conventional Commits…». Пробный коммит убрать (`git reset --hard HEAD~1` — допустимо только в одноразовом worktree). Вывод → `hooks.txt`.
3. **Хук Claude Code.** Перезапустить сессию Claude Code в worktree, записать через `Write` файл `tmp/p.go` с неотформатированным кодом, убедиться, что `gofmt -l tmp/p.go` пуст; завершить ответ и убедиться, что `Stop`-хук вывел «verify-pages: заглушка WS-01, реализует WS-07». Выдержка → `hooks.txt`.
4. **Эталон не изменён.** `git cat-file -s HEAD:"design/Ортус CRM.dc.html"` = `601806`; `…"design/Документация.dc.html"` = `43411`; `…"design/support.js"` = `69150` (`tools/README.md:12–15`); `git check-attr text -- "design/Ортус CRM.dc.html"` = `text: unset`. Вывод → `gitattributes.txt`. Дополнительно: `node tools/design-preview.js design 4173`, открыть `http://127.0.0.1:4173/Ортус%20CRM.dc.html` — селект «Персонаж» рендерится (прототип не сломан нормализацией).
5. **CI.** При remote — ссылка на зелёный прогон PR в отчёте; без remote — локальная последовательность §6г, вывод → `ci-order.txt`.
6. **Ревью** (`verification-protocol.md` §5; `reviewPrompt` шаблона): порядок коммитов `test(` → `feat(` по `git log --reverse main..ws/01-repo-skeleton`; `.golangci.yml` содержит `depguard` и `build-tags`; `.gitattributes` содержит `design/** -text`; `git diff --name-only main...HEAD` ⊆ §2; все заглушки с `@stub Owner:`.

## 9. Критерии готовности (DoD)

- [ ] 30/30 пунктов §6а сняты с `todo` и зелёные; unit §6б зелёные; `pnpm test` = 0 падений (`tdd-protocol.md` §4).
- [ ] `git log --reverse --format=%s main..HEAD` начинается с `test(ws-01)`; каждый `feat(`/`fix(` имеет предшествующий `test(` своего пункта (12 §6 п.21).
- [ ] `git diff --name-only main...HEAD` ⊆ границам §2; `design/**` не в диффе; размеры трёх файлов эталона в HEAD равны `tools/README.md` (R-25).
- [ ] `golangci-lint config verify` и `golangci-lint run ./...` из `backend/` — exit 0; depguard красный на `denied.go`, зелёный на `allowed.go` (12 §6 п.13–14).
- [ ] `prettier --check .` и `pnpm -r lint` — exit 0 (на пустом workspace — вакуумно).
- [ ] `node tools/check-icu.js` exit 0 на dev-машине и в CI-job `check-icu`.
- [ ] `node tools/allowlist-lint.js` exit 0 без каталогов; фикстуры дают ожидаемые сообщения R-18…R-22.
- [ ] `.github/workflows/ci.yml` проходит R-11; при наличии remote — зелёный прогон PR, 12 job.
- [ ] `.claude/settings.json` с `PostToolUse` и `Stop`; после перезапуска сессии хуки срабатывают (`hooks.txt`).
- [ ] `CLAUDE.md`, `frontend/CLAUDE.md`, `backend/CLAUDE.md`, `README.md` проходят R-28; README содержит onboarding §8 п.0 целиком (9 пунктов).
- [ ] Заглушки (`tools/verify-pages.js`, 4 Go-файла) помечены `@stub Owner:`; раздел README «Заглушки волны 0» перечисляет их с владельцами.
- [ ] `docs/plan/reports/WS-01.md` с дословными выводами (последние 40 строк `pnpm test`, `go test ./...`, `golangci-lint run`), разделом «Проверка MCP: не применяется (страниц нет; харнесс — WS-07)», списком контрактов §4; `status.md` строка WS-01 обновлена; evidence в `docs/plan/evidence/_infra/WS-01/` (5 файлов §4.14).
- [ ] Ревью `approve` (1 ревьюер) по §8 п.6; интегратор повторил R-29 в свежем worktree (барьер 0→1, MP §6.5).

## 10. Риски, расхождения, открытые вопросы — что делаем по умолчанию

| # | Риск / расхождение | Источник | По умолчанию |
|---|---|---|---|
| 1 | `.gitattributes` после первого `git add` → `design/` нормализован, пиксельная/структурная сверка идёт против испорченного эталона | 12 §8 п.3 (`core.autocrlf=true`); шаг 0 §7 | `.gitattributes` создаётся до первого `git add`; R-25 сверяет размеры блобов с `tools/README.md`; при расхождении — `git rm -r --cached design` и `git add design` до любого другого коммита |
| 2 | На dev-машине нет `pnpm` и `make` в PATH | факт §3 п.8 | `corepack enable` (corepack 0.34 есть) даёт `pnpm`; `make` ставится по README; тесты R-24 при отсутствии `make` проверяют текст Makefile и помечают шаг «пропущен: make не установлен» — не падают |
| 3 | Версия Go «последняя стабильная» (PD-38) ≠ зафиксированная; скилл `golang-testing` упоминает 1.26 `t.ArtifactDir` | PD-38; Q-106; 12 §4.10 | `go 1.26` в `go.mod` по установленному `go1.26.0`; CI `go-version-file`; повышение — одним коммитом интегратора |
| 4 | golangci-lint локально 2.13.2, в CI action может взять другую v2 — разные наборы линтеров | 12 §3.6 («v1 бинарь не читает конфиг v2») | один и тот же `version: v2.13.2` в `ci.yml`, `backend/CLAUDE.md`, README; `config verify` в CI |
| 5 | `"shell": "powershell"` из 2.0 (R13) не кроссплатформенен; macOS/Linux-агенты не выполнят PowerShell | 12 §3.2 R13 («для macOS/Linux — bash-вариант») | один Node-скрипт `tools/hooks/format-file.mjs` вместо двух shell-вариантов; семантика R13 сохранена (путь внутри `cwd`, gofmt/prettier, exit 0) |
| 6 | CI-шаги чужих WS (Spectral, `make gen`, `pnpm e2e`, `make examples`) без файлов падают | 14-eng «Конвейер CI» требует все этапы с первого дня | `if: hashFiles(...)`; владелец снимает охрану в своём WS (WS-03, WS-07, WS-51); R-11 проверяет наличие `if:` у этих шагов |
| 7 | `tdd-order` в CI ложно красный у интегратора (ребейз/squash, ветки `integrate/*`) и у WS-00 (только docs) | `tdd-protocol.md` §1; 12 §5 п.12 | job только для `head_ref` `ws/*`; `docs(`/`chore(` без последующего `feat(` допустимы (R-08 кейс 4); исключение фиксируется в `CLAUDE.md` |
| 8 | `.playwright-mcp/<PORT>/` на разных портах (PD-49) | MP §7.4 | игнор по префиксу `.playwright-mcp/` (R-01) |
| 9 | Шаблон Workflow требует worktree до того, как git существует | `workflow.template.js:87` `isolation: 'worktree'` | шаг 0 §7 делает интегратор при запуске волны 0, если скрипт стартует до git; хеш базового коммита — в примечании строки WS-01 `status.md` |
| 10 | CODEOWNERS с несуществующими командами GitHub не блокирует merge | Q-111 (remote неизвестен) | плейсхолдеры `@ortus/*`; до появления организации правило «2 ревьюера» обеспечивают `reviewers: 2` в `args.ws` (MP §7.2) и `PULL_REQUEST_TEMPLATE.md` |
| 11 | Prettier переформатирует `docs/plan/**` и ломает ссылки на строки отчётов | MP §0.1 (ссылки «файл:строки») | `docs/plan/` и `design/` в `.prettierignore` |
| 12 | `pnpm` ↔ `npm run`: внутри скриптов используется `pnpm -r`, значит `npm run test` требует установленного pnpm | MP §0.2, PD-38 | допустимо: протоколы остаются с `npm run`, README требует `corepack enable`; `.npmrc engine-strict` |
| 13 | Деплой-этапы `deploy dev → stage → prod-pilot` и образы/SBOM/подпись | 14-eng «Конвейер CI» строки 91–93; MP WS-69 | вне WS-01: `build` собирает бинарники и `pnpm -r build`; образы/SBOM/подпись — WS-69; deploy — после решения D-05 |
| 14 | `verification-protocol.md` §3 п.5 упоминает единый `e2e/visual/allowlist.md`, а PD-50 — файл на ключ | П9, PD-50 | `allowlist-lint` считает единый файл ошибкой (R-22); протокол не меняется (MP §0.1), расхождение закрыто решением PD-50 |
| 15 | `pre-push` гоняет `pnpm test` целиком — при росте монорепо долго | `verification-protocol.md` §6 | как в протоколе; оптимизация (`--filter ...[origin/main]`) — предложение интегратору после волны 1 |
| 16 | Хук `PostToolUse` при отсутствии `node_modules` в worktree не форматирует | 12 §3.6 («молча пропускает») | сообщение в stderr вместо тишины; README: `pnpm install` в каждом worktree |
| 17 | `depguard` allow-list не содержит `…/internal/modules/*/api` (публичный интерфейс соседнего модуля, 14-eng строка 53) | §4.4 | добавляет WS-40 вместе с первым таким пакетом — одной строкой через интегратора; в волне 0 таких импортов нет |

Открытые вопросы (для `decisions.md`, вносит интегратор по отчёту): Q-111 module path и remote — временный `github.com/ortus/ortus-crm/backend`; Q-106 версии — зафиксированы здесь (Node 22.19, Go 1.26, pnpm 9, golangci-lint 2.13.2); Q-110 — `testify`/`goleak` не добавляются в `go.mod` в WS-01 (нет импортёра — `go mod tidy` удалит, 12 §3.6), добавляет первый потребитель (WS-07/WS-40) через интегратора.

## 11. Промпт запуска

Ты — исполнитель рабочего потока WS-01 «repo-skeleton» волны 0 проекта «Ортус CRM». Прочитай полностью `docs/plan/ws/WS-01-repo-skeleton.md` и все документы его раздела 3 в указанном порядке, затем `docs/plan/tdd-protocol.md`, `docs/plan/verification-protocol.md` §6, `docs/plan/orchestration.md` §1, §5, §7. Эталон `design/` неприкосновенен: ни один его байт не меняется, это проверяется пунктом R-25.

Что делать. Шаг 0 брифа (§7): `git init -b main`, сначала `.gitattributes` с `design/** -text`, затем базовый коммит; после него — worktree `..\ortus-ws-01` на ветке `ws/01-repo-skeleton`. Первый коммит ветки — `test(ws-01): …` со скелетом `tools/repo-check.test.mjs` (30 пунктов §6а в `todo`). Далее строго циклами §7: снять `todo` одного пункта → убедиться, что тест красный по делу → минимальная реализация → `refactor(`; коммиты только через `git commit -F <файл без BOM>`, без `--no-verify`. PowerShell 5.1: без `&&`, команды по одной. Не трогай файлы вне раздела 2; заглушки чужих каталогов помечай `@stub Owner: WS-NN`. Контракты раздела 4 (имена скриптов, allow-list depguard, грамматика allowlist, имена job CI, маркер заглушки) публикуешь как есть; хочешь изменить — пиши в отчёте, не меняй молча.

Что вернуть. (1) `docs/plan/reports/WS-01.md` по формату `orchestration.md` §5: таблица «тест → коммит red → коммит green» для R-01…R-30, последние 40 строк `pnpm test`, `go -C backend test ./...`, `golangci-lint run ./...`, раздел «Проверка MCP: не применяется — страниц нет», раздел «Контракты» = раздел 4 брифа с отклонениями. (2) `docs/plan/evidence/_infra/WS-01/{smoke,lint,hooks,ci-order,gitattributes}.txt` по §8. (3) Строка WS-01 в `docs/plan/status.md`. (4) Структурированный результат: `ws`, `branch`, `reportPath`, `done`, `pagesDelivered: []`, `fixmeLeft` (пункты R-NN, оставшиеся в `todo`, со ссылкой на Q-NN), `contractsChanged`, `testRunsOk`. Если заблокирован (нет `corepack`, нет Docker для CI-эквивалента, remote отсутствует) — опиши блокер в отчёте и продолжай остальное; не обходи блокер подменой проверки.
