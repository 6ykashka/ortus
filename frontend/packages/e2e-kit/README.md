# @ortus/e2e-kit — e2e-харнесс Ортус

Владелец — W0.05. Бриф: `docs/plan/v2/ws/W0.05.md`. Публичные имена расширяются только аддитивно.

## Что даёт

| Модуль                                | Назначение                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `env.ts`                              | `resolveHarnessEnv()` — порты по слоту (план v2 §3.6), режим `mock`/`stand` (§3.7), адрес эталона               |
| `persona.ts`                          | персонажи и подписи демо-панели эталона, `personaUrl()` — dev-вход `?persona=` (PD-54), `referenceUrl()`        |
| `reference.ts`                        | `openReference()` — любой `.dc.html` эталона, `setPersona`, `setFrameWidth`, `hidePanel`                        |
| `app.ts`                              | `openApp()` — маршрут реализации с dev-входом, ожидание `html[data-e2e-persona]`                                |
| `clock.ts`                            | `CLOCK` = `2026-10-01T10:30:00+03:00`, `installClock(context)`                                                  |
| `net.ts`                              | `createNet(context, allowHosts)` — блокировка внешних хостов, сбор запросов и ошибок консоли                    |
| `labels.ts`                           | `collectLabels(root)` — структурная сверка (без панели, `data-a11y-extra`, `aria-hidden`)                       |
| `compare.ts`, `match.ts`              | `comparePng`, `matchScreens` — пиксельная сверка с порогом 0.01 (D-22)                                          |
| `allowlist.ts`                        | allowlist D-50 + `out-of-stage` (`expires: stage-N`) и `no-reference`; общий разбор с `tools/allowlist-lint.js` |
| `axe.ts`                              | `runAxe(page)` — serious/critical                                                                               |
| `config.ts` (`@ortus/e2e-kit/config`) | `defineHarnessConfig({ appDir })` для `frontend/apps/web/playwright.config.ts`                                  |

Фикстуры Playwright — `frontend/apps/web/e2e/fixtures/index.ts`: `reference(file?, { persona, width, hidePanel, hash })` (каждый вызов — новый контекст с часами, локалью и viewport проекта), `app(route, { persona })`, `net`, `labels`, `axe`, `harness`, `referenceFiles`. Визуальная сверка в spec — `e2e/_helpers/match-reference.ts`.

## Переменные окружения

| Переменная                             | По умолчанию            | Смысл                                                                                                                        |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ORTUS_SLOT`                           | `0`                     | слот исполнителя: Vite `5200+slot`, проверяющий `6100+slot`, Storybook `7200+slot`, API `8100+slot`, свой эталон `4100+slot` |
| `E2E_ROLE`                             | `executor`              | `verifier` — порт `6100+slot` и свежие серверы                                                                               |
| `PORT`                                 | по слоту                | явный порт приложения (и каталог MCP `.playwright-mcp/<PORT>`)                                                               |
| `E2E_FRESH_SERVER`                     | —                       | `1` — не переиспользовать запущенные серверы                                                                                 |
| `E2E_MODE`                             | `mock`                  | `mock` — MSW (`VITE_ADAPTER=mock`); `stand` — `VITE_ADAPTER=http`, `/api` → `ORTUS_API_ORIGIN`                               |
| `HTTP_ADDR`                            | `127.0.0.1:(8100+slot)` | API исполнителя в режиме `stand`                                                                                             |
| `E2E_BASE_URL`                         | —                       | готовый стенд; dev-сервер не поднимается                                                                                     |
| `REFERENCE_PORT` / `E2E_OWN_REFERENCE` | `4173` / —              | порт эталона; `E2E_OWN_REFERENCE=1` — свой на `4100+slot`; предыдущий этап — `4174`                                          |
| `REFERENCE_DIR`, `REFERENCE_REF`       | `design`, —             | каталог эталона; git-ссылка снимка этапа (`design-stage-N`, PD-57)                                                           |
| `ORTUS_STAGE`                          | `0`                     | текущий этап (срок `out-of-stage`)                                                                                           |
| `E2E_ALLOW_HOSTS`                      | —                       | дополнительные разрешённые хосты через запятую                                                                               |

## Команды

```powershell
corepack pnpm run e2e:install                      # chromium для @playwright/test
$env:ORTUS_SLOT='6'; $env:E2E_OWN_REFERENCE='1'
corepack pnpm run e2e:harness                      # самотест харнесса (@harness)
corepack pnpm --filter @ortus/e2e-kit run test     # unit (node --test, без Vitest)
corepack pnpm run mcp:install; corepack pnpm run mcp:check
```

## Решения

- Готовность эталона — `#dc-root > .sc-host`, затихшая сеть (повторный `fetch` шаблона, `support.js:158`) и исчезнувший статус «Загрузка». Без ожидания сети два снимка одного экрана расходятся на десятки тысяч пикселей.
- Персонаж эталона выбирается по `value` (две опции «Массажист · Анна Морозова»).
- Панель скрывается `display:none` на эталоне; в реализации её нет (PD-54).
- Внешние хосты блокируются в каждом контексте: эталон и mock-режим проверяются офлайн.
- Модули — только стираемый синтаксис TypeScript: Node 22 запускает их без сборки (`node --test`, `tools/allowlist-lint.js`).
