# @ortus/adapter — MSW-сценарный сервер режима `mock`

Владелец — W0.13. Бриф: `docs/plan/v2/ws/W0.13.md`. Публичные имена расширяются только аддитивно.

Сервер отвечает на операции контракта `api/dist/ortus.bundle.yaml` (0.3.0-stage1) так же, как стенд `cmd/api`:
шлюз W0.09 (сессия → CSRF и Origin → оператор | членство и состояние организации → модуль → `x-permissions`),
состояние — проекция сида домена W0.12 (`@ortus/domain/seed`), атрибуты вне домена — из примеров контракта
(PD-43). Хендлеры есть у 62 операций этапа 1 (теги Context, Auth, Platform, Billing, Access, Modules, Files) и у
операций экранов этапа 2 тегов Fleet, Earnings, Home (W2.00, `src/msw/fleet/`: рейс от плана до приёмки, бронь,
осмотры, блокирующий дефект и очередь менеджера, расходы, сдача, приёмка с доработкой, начисления, пул водителей,
«Требует решения»); с W2.51 (0.6.0-stage2) — публикация водителя в пул, временное назначение и автозавершение
(`fleet/pool.ts`, `fleet/pool-rules.ts`) и тег Data — наборы «Данных» этапа 2 (`src/msw/data/`); остальные отвечают
после шлюза `501 not_implemented`, операции модуля без подключения — `403 module_not_installed`. Логистика
организации — проекция `logisticsSeed` W0.12 (`fleet/state.ts`).

## Подключение

| Где                         | Как                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| приложение (`VITE_ADAPTER`) | `main.tsx`: `mock` → `startMockWorker()` из `@ortus/adapter/msw/browser` до dev-входа `?persona=` |
| Vite                        | `plugins: [react(), mswWorker()]` из `@ortus/adapter/vite` — отдаёт `/mockServiceWorker.js`       |
| тесты экранов, скрипты      | `createNodeServer()` из `@ortus/adapter/msw/node` → `{ server: SetupServer, scenario }`           |
| без MSW                     | `createScenarioServer().handle(request)` → `Response`                                             |

Состояние браузера живёт во вкладке (`sessionStorage`, ключ `ortus:msw:state`): новый контекст Playwright —
свежий сид. Cookie `ortus_sid`/`ortus_csrf` в режиме `mock` пишутся в `document.cookie` (ответ service worker не
может ставить cookie), поэтому `ortus_sid` здесь не HttpOnly.

## Сценарии (PD-31)

Заголовок `X-Test-Scenario: [<operationId>=]<сценарий>[, …]`:

| Сценарий         | Что делает                                                                            |
| ---------------- | ------------------------------------------------------------------------------------- |
| `<Problem.code>` | ответ примером `<operationId>/<код>.json` (или Problem реестра), если статус объявлен |
| `empty`          | пример `empty` операции или пустой список                                             |
| `offline`        | сетевой сбой                                                                          |
| `loading`        | ответа нет                                                                            |
| `delay=<мс>`     | задержка, затем обычный ответ                                                         |

Код ошибки отвечает раньше шлюза; без `<operationId>=` сценарий действует на все операции.

## Dev-маршруты (вне контракта, только `mock`)

| Маршрут                     | Тело и ответ                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/dev/login`    | `{persona}` (персонаж e2e-kit или subject сида `acc-N`, `op-N`) → `{userId, csrfToken}` + cookie, как W0.09 |
| `POST /api/v1/dev/logout`   | с CSRF → 204                                                                                                |
| `POST /api/v1/dev/scenario` | `{reset?, preset?, scenario?, once?, now?, scanFiles?}` → сводка                                            |
| `GET /api/v1/dev/scenario`  | сводка: часы, сценарий, пресеты, токены приглашений                                                         |

Пресеты: `logistics-ready` (у «Альты» подключена «Логистика», Котова — менеджер логистики в «Север Логистик»),
`seats-full` (занято 10 из 10), `trial-ended` (организация и подписка только для чтения), `storage-full`
(место заполнено). Часы сервера — «сейчас» сида `2026-10-01T07:30:00Z`; двигаются `{now}`. Проверка загруженных
файлов завершается `{scanFiles: true}`.

## Команды

```powershell
corepack pnpm --filter @ortus/adapter run gen        # src/msw/contract/contract.gen.json из api/
corepack pnpm --filter @ortus/adapter run gen:check  # дрейф выжимки контракта
corepack pnpm --filter @ortus/adapter run test       # unit и conformance (msw/node, ajv по бандлу)
corepack pnpm --filter @ortus/adapter run examples   # примеры этапа 1 — снимки сервера (PD-43); --write — пересъёмка
```

## Conformance

`test/conformance/`: клиент с cookie-сессией (`client.ts`), раннер (`runner.test.ts`), файл кейсов на модуль
(`cases/<модуль>.ts`), покрытие (`coverage.test.ts`: у 62 операций этапа 1 есть кейс успеха и кейс ошибки, каждый
пример воспроизведён или записан в `deviations.ts` с причиной). Каждый ответ проверяется ajv 2020-12 по схеме
объявленного статуса. Новый модуль (например, `fleet` — W2.00): хендлеры в `src/msw/<модуль>/` и строка в
`src/msw/handlers.ts`, кейсы — `test/conformance/cases/<модуль>.ts` и строка в `cases/index.ts`.
