# Нагрузка k6 — каркас (W0.16)

Профиль, цели и допущения — `docs/plan/v2/load-profile.md`. Числа — `profile.json` (единственный источник). Прогон на стенде stage и протокол результатов — W3.01.

## Состав

| Файл                         | Что                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profile.json`               | параметры D-08 (пока заглушки `A-NN`), цели p95, стадии `smoke` / `pilot` / `stress`                                                                      |
| `lib/model.js`               | чистая модель без `k6/*`: операции OpenAPI 0.1 (`OPS`), пути, тела, `Idempotency-Key`, производные величины, `options` k6                                 |
| `lib/client.js`              | `Session`: dev-вход (только local и compose), CSRF и Origin, `Idempotency-Key`, `If-Match`, теги `op` / `kind`, загрузка фото (initiate → PUT → complete) |
| `lib/flow.js`                | счётчики `flow_completed{flow}` и `flow_aborted{flow,reason}` — итог каждой итерации сценария                                                             |
| `scenarios/driver-shift.js`  | `driverShift` — смена водителя целиком                                                                                                                    |
| `scenarios/manager-shift.js` | `managerShift` — списки и приёмка рейса                                                                                                                   |
| `scenarios/noisy-tenant.js`  | `noisyExport`, `noisyUploads` — «шумный» тенант                                                                                                           |
| `main.js`                    | точка входа: `LOAD_STAGE` → `options`, экспорт функций сценариев                                                                                          |
| `test/*.test.mjs`            | `node:test`: модель и согласованность документа с `profile.json`                                                                                          |
| `test/fake-api.mjs`          | API-двойник для smoke без стенда (проверяет заголовки и тела, считает запросы)                                                                            |
| `check-k6.mjs`               | `k6 inspect` трёх стадий и smoke против двойника через Docker                                                                                             |

## Команды (из корня репозитория, PowerShell)

```powershell
node --test "backend/test/load/test/*.test.mjs"   # модель и документ, без Docker
node backend/test/load/check-k6.mjs               # k6 inspect + smoke против двойника (:8108, слот 8)
node backend/test/load/check-k6.mjs --inspect-only
node backend/test/load/test/fake-api.mjs          # двойник отдельно; GET /__stats — счётчики
```

Прогон против локального или compose-стенда (dev-вход разрешён только там):

```powershell
docker run --rm --add-host=host.docker.internal:host-gateway -v "${PWD}/backend/test/load:/scripts" `
  grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 `
  run -e LOAD_STAGE=smoke -e BASE_URL=http://host.docker.internal:8108 `
  --summary-export /scripts/results/smoke-summary.json /scripts/main.js
```

Переменные передаются флагом k6 `-e`: `k6 inspect` не видит переменные окружения контейнера.

На stage dev-провайдера нет (PD-18, Q-102, ADR-0004): `lib/client.js` падает в init, если `BASE_URL` не loopback, `localhost`, `host.docker.internal` или имя сервиса compose. Вход на stage решает интегратор или техлид до W3.01 (`load-profile.md` §4 «Вход», §7 п. 6).

| Переменная       | По умолчанию            | Что                                                                          |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `LOAD_STAGE`     | `smoke`                 | `smoke` — по 2 итерации на сценарий; `pilot` — 30 мин профиля; `stress` — ×5 |
| `BASE_URL`       | `http://127.0.0.1:8108` | адрес API / BFF; только local и compose                                      |
| `ORIGIN`         | `BASE_URL`              | заголовок `Origin` на изменениях                                             |
| `DEV_LOGIN_PATH` | `/api/v1/dev/login`     | вход dev-провайдера `{ "persona": "<id>" }` (допущение A-23)                 |
| `CSRF_COOKIE`    | `ortus_csrf`            | cookie, значение которого уходит в `X-CSRF-Token`                            |
| `RUN_ID`         | время старта VU         | префикс `Idempotency-Key`                                                    |

Персонажи (их создаёт сид нагрузки W3.01): `load-pilot-driver-001…`, `load-pilot-manager-01…`, `load-noisy-owner-01`.

## Правила

- Порог считается только по `tenant:pilot`, `kind:read` и `kind:write`. Передача файлов (`kind:transfer`), вход (`kind:auth`) и шумный тенант в пороги не входят.
- Ожидаемые конфликты не считаются ошибкой: `reserveVehicle` 409 (гонка за машину), `reviewTrip` и `reviewTripExpense` 409/412 (два менеджера на одном рейсе).
- Каждая итерация заканчивается `flow_completed` или `flow_aborted{reason}`. Пороги объёма `flow_completed{flow:*}` не дают прогону пройти, если подана только часть плана (допущение A-24). Новый выход из итерации — с причиной `abort(reason)`, не молчаливый `return`.
- Менеджер и шумный тенант входят один раз на VU: `options.noCookiesReset` держит cookie между итерациями. Без него k6 чистит jar, и со второй итерации все вызовы получают 401. Smoke идёт в 2 итерации, чтобы это ловить.
- Новая операция в сценарии — сначала строка в `OPS` и в `requestsPerShift()` / `requestsPerManagerIteration()` (red в `test/model.test.mjs`). `check-k6.mjs` сверяет число запросов smoke с моделью; `OPS` сверяется с `ortus-openapi-v0.1.yaml` в `test/model.test.mjs`.
- Сводки прогонов на стенде пишутся в `results/`: в git они не попадают, но `prettier --check .` их видит, пока `backend/test/load/results/` не внесён в `.prettierignore` (это делает интегратор). `check-k6.mjs` пишет сводку во временный каталог ОС.
- Двойник `test/fake-api.mjs` слушает `0.0.0.0` (порт `FAKE_API_PORT`, по умолчанию 8108): k6 в Docker ходит к нему через `host.docker.internal` (host-gateway), а на Linux это адрес моста, не loopback. Пока идёт проверка, двойник со счётчиками `/__stats` виден в локальной сети. Сузить — `FAKE_API_HOST` (`127.0.0.1` на Docker Desktop, адрес `docker0` на Linux).
