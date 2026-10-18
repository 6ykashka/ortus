# Нагрузка k6 (W0.16 → W2.47)

Профиль, цели и допущения — `docs/plan/v2/load-profile.md` (D-08 принято 17.10.2026, ADR-0009). Числа — `profile.json` (единственный источник). Полный прогон на стенде stage и протокол результатов — W3.01 (`load-profile.md` §7).

## Состав

| Файл                         | Что                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile.json`               | параметры D-08 и допущения `A-NN`, цели p95, стадии `smoke` / `stand` / `pilot` / `stress`                                                                   |
| `lib/model.js`               | чистая модель без `k6/*`: операции контракта 0.5.1-stage2 (`OPS`), пути, тела, `Idempotency-Key`, производные величины, персонажи, темп, `options` k6        |
| `lib/client.js`              | `Session`: dev-вход (только local и compose), CSRF и Origin, `Idempotency-Key`, `If-Match`, теги `op` / `kind`, фото (initiate → PUT → complete → `getFile`) |
| `lib/flow.js`                | счётчики `flow_completed{flow}`, `flow_aborted{flow,reason}` и `trips_reviewed`                                                                              |
| `scenarios/plan-trips.js`    | `setup()` — логист планирует рейсы на каждого водителя (A-27)                                                                                                |
| `scenarios/driver-shift.js`  | `driverShift` — смена водителя целиком, темп A-26                                                                                                            |
| `scenarios/manager-shift.js` | `managerShift` — рабочее место, очередь и приёмка смены с фото                                                                                               |
| `scenarios/noisy-tenant.js`  | `noisyExport`, `noisyUploads` — «шумный» тенант                                                                                                              |
| `main.js`                    | точка входа: `LOAD_STAGE` → `options`, `setup()`, экспорт функций сценариев                                                                                  |
| `test/*.test.mjs`            | `node:test`: модель, согласованность документа с `profile.json`, чистые функции прогона-дыма                                                                 |
| `test/fake-api.mjs`          | API-двойник пути этапа 2 для smoke без стенда (проверяет заголовки, тела и переходы рейса, считает запросы)                                                  |
| `check-k6.mjs`               | `k6 inspect` всех стадий и smoke против двойника через Docker                                                                                                |
| `stand-smoke.mjs`            | прогон-дым на стенде compose слота: стенд, `seed demo`, `cmd/api`, `cmd/worker`, k6 `stand`, `down -v`                                                       |

## Команды (из корня репозитория, PowerShell)

```powershell
node --test "backend/test/load/test/*.test.mjs"   # модель, документ, прогон-дым (чистые функции), без Docker
node backend/test/load/check-k6.mjs               # k6 inspect + smoke против двойника (:8108)
node backend/test/load/check-k6.mjs --inspect-only
node backend/test/load/stand-smoke.mjs --slot 7   # прогон-дым на своём стенде compose (слот 1…20), down -v всегда
node backend/test/load/test/fake-api.mjs          # двойник отдельно; GET /__stats — счётчики
```

Прогон против локального или compose-стенда вручную (dev-вход разрешён только там), API и Vite слота 7:

```powershell
docker run --rm --add-host=host.docker.internal:host-gateway -v "${PWD}/backend/test/load:/scripts:ro" `
  grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34 `
  run -e LOAD_STAGE=stand -e BASE_URL=http://host.docker.internal:8107 -e ORIGIN=http://127.0.0.1:5207 /scripts/main.js
```

Presigned URL фото должны быть видны из контейнера: `cmd/api` стенда запускается с `S3_PUBLIC_ENDPOINT=http://host.docker.internal:<MinIO слота>` (так делает `stand-smoke.mjs`). Переменные передаются флагом k6 `-e`: `k6 inspect` не видит переменные окружения контейнера.

На stage dev-провайдера нет (PD-18, Q-102, ADR-0004): `lib/client.js` падает в init, если `BASE_URL` не loopback, `localhost`, `host.docker.internal` или имя сервиса compose. Вход на stage решает интегратор или техлид до W3.01 (`load-profile.md` §4 «Вход», §8 п. 4).

| Переменная          | По умолчанию            | Что                                                                                        |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `LOAD_STAGE`        | `smoke`                 | `smoke` — двойник; `stand` — сид demo, 2 минуты; `pilot` — час пика; `stress` — профиль ×2 |
| `BASE_URL`          | `http://127.0.0.1:8108` | адрес API / BFF; только local и compose                                                    |
| `ORIGIN`            | `BASE_URL`              | заголовок `Origin` на изменениях (на стенде — Vite слота из `ALLOWED_ORIGINS`)             |
| `DEV_LOGIN_PATH`    | `/api/v1/dev/login`     | вход dev-провайдера `{ "persona": "<id>" }` (допущение A-23)                               |
| `CSRF_COOKIE`       | `ortus_csrf`            | cookie токена, если в ответе входа нет `csrfToken`                                         |
| `RUN_ID`            | время старта VU         | префикс `Idempotency-Key`                                                                  |
| `FILE_POLL_SECONDS` | `1`                     | период опроса `getFile` до `ready`                                                         |
| `FILE_POLL_MAX`     | `120`                   | опросов до `photo_timeout`                                                                 |

Персонажи: `pilot`/`stress` — сид нагрузки W3.01 (`load-pilot-driver-001…`, `load-pilot-manager-01…`, `load-pilot-planner-01`, `load-noisy-owner-01`); `stand` — сид demo (`driver`, `acc-9`, `owner`).

## Правила

- Порог считается только по `tenant:pilot`, `kind:read` и `kind:write`. Передача файлов (`kind:transfer`), вход (`kind:auth`), планирование `setup()` (`kind:setup`) и шумный тенант в пороги не входят.
- Ожидаемые конфликты не считаются ошибкой: `reserveVehicle` 409/422 (машина занята или не подходит — берётся другая, до трёх попыток), `reviewTrip` 409/412 (два логиста на одной смене).
- Каждая итерация заканчивается `flow_completed` или `flow_aborted{reason}`. Пороги объёма `flow_completed{flow:*}` и `trips_reviewed` не дают прогону пройти, если подана только часть плана (допущение A-24). Новый выход из итерации — с причиной `abort(reason)`, не молчаливый `return`.
- Логист и шумный тенант входят один раз на VU: `options.noCookiesReset` держит cookie между итерациями. Smoke идёт в 2 итерации, чтобы это ловить.
- Фото — JPEG по сигнатуре (`FF D8 FF E0`) с уникальным содержимым: `cmd/worker` сверяет тип по содержимому, а повтор файла осмотра сервер отклоняет.
- Новая операция в сценарии — сначала строка в `OPS` и в `requestsPerShift()` / `requestsPerManagerIteration()` / `requestsForPlanning()` (red в `test/model.test.mjs`). `check-k6.mjs` сверяет число запросов smoke с моделью; `OPS` сверяется с `api/dist/ortus.bundle.yaml` в `test/model.test.mjs`.
- Сводки прогонов пишутся вне `backend/test/load/`: `check-k6.mjs` — во временный каталог ОС, `stand-smoke.mjs` — в `.claude/tmp/load-stand/s<слот>/` (`prettier --check .` не учитывает вложенный `.gitignore`).
- Двойник `test/fake-api.mjs` слушает `0.0.0.0` (порт `FAKE_API_PORT`, по умолчанию 8108): k6 в Docker ходит к нему через `host.docker.internal` (host-gateway), а на Linux это адрес моста, не loopback. Пока идёт проверка, двойник со счётчиками `/__stats` виден в локальной сети. Сузить — `FAKE_API_HOST` (`127.0.0.1` на Docker Desktop, адрес `docker0` на Linux).
