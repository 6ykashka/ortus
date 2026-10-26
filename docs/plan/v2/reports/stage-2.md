# Отчёт: выход этапа 2 «Логистика»

- stage: 2 · проверяющий выхода и критик полноты (проверка 1) · mode: `ci:local` + stand (`e2e-stand` под сторожем, слот 12) + mock (job `e2e`)
- Критика полноты: [../critique/stage-2.md](../critique/stage-2.md)

## Проверка 2 — 2026-10-26

- main: `f181f5db4` (docs(plan): статус W4.81), совпадает с `origin/main` на старте. Worktree `.claude/worktrees/exit-s2` (detached). Код продукта не менялся.
- Среда: Windows 11, Docker 27.4.0 (общий, не перезапускался), pnpm 9.15.9, `GOFLAGS=-p=2`. Слот 12: Vite стенда 5212, API 8112, SMTP 2225, compose `ortus-s12`. Mock — проверяющий `E2E_ROLE=verifier`; эталон (`design/` текущего `main`) на свободных портах 7212, потом 6312/7312 (порты 6112 и 7212 остались занятыми сиротами первого mock-прогона). Слот 0 и `docs/demo/**` не трогались. Замок стенда слота 1 держался до конца, снят.
- MVP: облачных stage и prod-pilot нет (W3.00, W3.06 отложены решением пользователя 19.10); «стенд stage» — локальный compose слота 12.

### Вердикт

**Не пройден.** Сквозная смена водителя на телефоне и у менеджера на стенде проходит. AC-03, 04, 05, 12 и AC-06 (Q-W2.07-1 «только рейс» и D-35) зелёные: backend, изоляция, concurrency и стенд на трёх вьюпортах. Все прежние блокеры проверки 1 сняты: W2.73 влит, журни W2.75 есть, `driver-a11y` без `@known-defect` (W2.76), блокеры W2.72 закрыты (W2.78, W2.79), `unit` на GitHub зелёный (W2.80), mock на `main` зелёный (W2.81). Не выполнены два пункта критерия:

1. **В `journeys/stage2` остаются две строки `@known-defect` без решения людей** — оба дефекта технические и исправимы агентами: `temporary-driver-vehicle-shift.spec.ts:135` (Q-W2.75-3, `releaseUsualSQL` даёт пустой интервал брони при осмотре сдачи раньше окна рейса, `listReservations` отвечает 503; Q-W2.75-3 сам требует «исправить до выхода этапа 2») и `temporary-driver-vehicle.spec.ts:629` (Q-W2.75-1, до окна рейса «Моя смена» временного водителя без предложенных машин показывает ошибку вместо «Машину ещё не поставили»). Следствие — полная смена временного водителя на стенде проверена только после начала окна рейса.
2. **Строка этапа 2 красная на GitHub и недетерминированно красная на стенде:** `modal-finish-route.spec.ts:120` падает на `reserveVehicle 409 reservation_overlap` (`logistics.stand.ts:72`, вызов `modal-finish-route.spec.ts:135`) — на GitHub в двух шардах (5/8 [tablet-768], 8/8 [desktop-1440], три попытки), локально на стенде слота 12 в третьем проекте ([desktop-1440]; mobile и tablet прошли); на свежем стенде строка проходит. Предыдущие строки на том же стенде оставляют занятой ту же ГАЗель на окно рейса.

Прочее для выхода: основная масса красного на GitHub — не этап 2 (см. «CI на GitHub»), но `driver-offer.visual.spec.ts` (W2.74) вешает три из пяти красных шардов mock.

### Критерий выхода по пунктам

| # | Пункт (план v2 §4) | Итог | Основание |
|---|---|---|---|
| 1 | Полная смена водителя на телефоне и у менеджера на стенде | **выполнен** | `driver-shift.spec.ts` (`:543`, `:169`, `:213`), `guide-path.spec.ts:336`, `temporary-driver-vehicle-shift.spec.ts:40` (полная смена на обычной машине) — mobile-390, tablet-768, desktop-1440 зелёные на слоте 12 (прогон Б ниже) |
| 2 | AC-03 | **выполнен** | `TestAC03HundredParallelReservations`, `TestAC03TwoDriversOneVehicle` (concurrency 84 с под нагрузкой), `reservation-race.spec.ts:185` stand × 3 |
| 3 | AC-04 | **выполнен** | `TestAC04DepartureRefusals`; `defect-decision.spec.ts:184` stand × 3 |
| 4 | AC-05 | **выполнен** | isolation (`fleet_review_gate`, `data_trips`, `fleet_w252_export_*`) 163 с; `guide-path.spec.ts:241`, `driver-shift.spec.ts:460`/`:543` |
| 5 | AC-06 (Q-W2.07-1, W2.57) | **выполнен** | `fleet_pool_ac06_test.go`; `temporary-driver.spec.ts:702`, `:737` stand × 3 (узкая роль, после срока — только сдача, после приёмки — 404) |
| 6 | AC-06 — дополнения D-35 (S2-20, W2.70–W2.75) | **выполнен после начала окна рейса; до окна — нет** | все экраны на `main` (W2.73: 1a, 1b, 1f, 1g; W2.74: 1c–1e); `temporary-driver-vehicle.spec.ts` (`:244`, `:429`) и `modal-driver-request-s220`, `driver-today-offer.spec.ts:357`/`:409` stand × 3 зелёные; строки «до окна» — в `fixme` (пункт 9) |
| 7 | AC-12 | **выполнен** | `module-draining.spec.ts:194`, `:255` stand × 3, `:124` mock |
| 8 | Все WS этапа «готово» (или блокеры людей) | **выполнен** | реестр §4: W2.00…W2.09, W2.20…W2.26, W2.30…W2.32, W2.41…W2.57, W2.60…W2.62, W2.70…W2.76, W2.78…W2.83, W2.87 — «готово»; W2.84…W2.86 — «в работе» с 24.10 (учёт интегратора, в критерий не входят; строки устарели, если ветки влиты) |
| 9 | Нет `@known-defect` в `journeys/stage2` (или решение людей) | **не выполнен** | две строки, обе технические: `temporary-driver-vehicle-shift.spec.ts:135` (Q-W2.75-3), `temporary-driver-vehicle.spec.ts:629` (Q-W2.75-1) |
| 10 | Строки этапа 2 на стенде без красного | **не выполнен** | `modal-finish-route.spec.ts:120` [desktop-1440] — 3 падения на накопленном стенде, зелёный только на свежем (повтор сторожа) |

### Прогоны

#### 1. `corepack pnpm install --frozen-lockfile` — exit 0 (`Lockfile is up to date`, 6,7 с).

#### 2. `corepack pnpm run ci:local` (`GOFLAGS=-p=2`) — по job

```text
✔ lint (prettier, eslint, golangci-lint, actionlint, spectral)
✔ contract (openapi, permissions, migrations, codegen-drift)
✔ unit (check-icu, typecheck, test, check-decisions, allowlist-lint, mcp-check)
✔ integration (go-integration)
✖ isolation/go-isolation — первый прогон (под нагрузкой ПК: параллельно шли стенд и тесты)
✔ isolation/go-concurrency
```

- Isolation упал на проверке AC-01 «время ответа чужого и несуществующего id различается»: `getFormResponse` 259 мс против 3 мс (прогон 1) и ещё пять строк `calendar_w482`, `fleet_vehicle_assignments`, `knowledge_w482`, `forms_w482` (прогон 2: 315–367 мс против 7–22 мс). Строки каждый раз разные, это не регрессия изоляции. Повтор `--job isolation` на спокойном ПК (стенд шёл, CPU мало занят) — **зелёный**: `test/isolation` 163 с, `fixtures` 110 с, `matrix` 2,5 с, `concurrency` 84 с. Предложение W2.97: сравнение времени по медиане серии, а не по одному замеру.
- `build` (повтор отдельным `--job build`): build, storybook, check-k6, images — зелёные.
- `e2e` (job mock, `pipeline.mjs --job e2e`, 11 воркеров, параллельно с первым стендом): **3952 теста, 801 failed, 468 skipped, 2683 passed, 3,6 ч** (в предыдущей проверке 2734 теста за 48 мин). Память ПК упиралась в 7 МБ свободных, CPU 100 %; стенд при этом тоже терял тесты. Прогон как результат не засчитан: красное — нагрузка ПК, не продукт. Все 728 уникальных упавших строк (по логу) повторены: `playwright test <file:line…> --project=… --workers=3` — зелёные, кроме 5 (`files.spec.ts:260`, `:328` [390], `shell.spec.ts:171`, `platform-orgs.spec.ts:178` [768], `inbox.spec.ts:240` [1440]); эти 5 повторены по одному воркеру — **5 из 5 passed**. Итог job mock: **красных строк нет**. `visual/driver-offer.visual.spec.ts` (W2.74): 3/3 за 8 с на [390] при одном воркере; в полном прогоне те же строки шли 33–70 с.
- Причина «3,6 ч»: у локального mock нет предела воркеров (`workers: h.ci ? 1 : undefined` → 11 на этом ПК). Предложение W2.96: `E2E_WORKERS` (по умолчанию 4).

#### 3. e2e-stand (`stand-guard.mjs`, слот 12)

Прогон А — полный, `stand-guard.mjs --slot 12`, 429 строк `@stand|@mailpit`. Параллельно, по моей ошибке, шёл полный mock (п. 2) — оба тормозили. Предел 135 мин сторож снял на тесте 189 из 429: пройдено 171, упало 5, не дошли 253 (хвост tablet-768 и весь desktop-1440). Сторож упал на повторе: `ENOENT … .claude/tmp/stand-guard-plan-s12.json` — в свежем worktree нет каталога `.claude/tmp` (создан, повтор не делался; к продукту не относится). Все строки этапа 2 в mobile-390 и tablet-768 до `files.spec.ts` прошли. Упали (3 попытки): `company-users.spec.ts:489`, `core-calendar.spec.ts:475`, `forms.spec.ts:645` [390], `journeys/stage1/acceptance.spec.ts:237`, `owner-onboarding.spec.ts:189` [390], `core-calendar.spec.ts:475` [768] — строки этапов 1 и 4, тайм-ауты 30–90 с под нагрузкой.

Прогон Б — узкий (`stand-guard.mjs --slot 12 --shards 1 --files "journeys/stage2|driver-|logistics-|modal-(driver|finish|accept)|home\.spec|core-data\.spec"`): 27 файлов, 141 строка, три проекта, свежий стенд без параллельной нагрузки, 186 мин (в них 2 × ожидание окна рейса ≈ 34 мин на проект). Итог: `✔ e2e-stand: зелёный (шарды 1, 186 мин, пройдено 140; 1 прошла только на повторе)`. На повторе (свежий стенд) прошла `modal-finish-route.spec.ts:120` [desktop-1440] (первый проход — три падения по 5–8 с на `reserveVehicle 409`). Остальные строки этапа 2 — на трёх вьюпортах с первой попытки, включая `journeys/stage2/*`, `temporary-driver*.spec.ts`, `driver-today-offer.spec.ts`, `logistics-pool-s220`, `modal-driver-request-s220`, `module-draining`, `reservation-race`, `defect-decision`, `driver-a11y` (mock-строки).

Прогон В — повтор строк, упавших в А: `--files "company-users|core-calendar|forms\.spec|journeys[\\/]stage1"`: `✔ e2e-stand: зелёный (3 мин, пройдено 42)`. Красное в А — нагрузка.

Полный e2e-stand за один проход на спокойном ПК не получен (А — нагрузка, Б и В — выборка). Строки этапов 1 и 3–7 вне выборки в трёх проектах на слоте 12 не повторялись; на GitHub они идут шардами (см. ниже).

#### 4. CI на GitHub (`gh`, `6ykashka/ortus`)

Последний завершённый прогон `main`: run 40281422068 (`f181f5db4`, 55 мин) — красный, как и три предыдущих. Первые шесть job зелёные: lint, contract, unit (8 мин), integration, isolation + concurrency, build. Красные:

- **e2e-stand: 5 шардов из 8.** Шарды 2/8, 4/8, 7/8 — упёрлись в лимит job 30 мин (не этап 2); шарды 5/8 [tablet-768] и 8/8 [desktop-1440] — `modal-finish-route.spec.ts:120`, `reserveVehicle 409 reservation_overlap` (строка этапа 2, п. 2 вердикта). Шарды 1, 3, 6 зелёные.
- **e2e mock: 5 шардов из 20** (6, 7, 13, 14, 20): тайм-ауты `2.0m` строк `visual/*` — `driver-offer.visual.spec.ts:48`, `:59` на трёх проектах (шарды 6, 13, 20), `forms.visual.spec.ts:204`, `knowledge.visual.spec.ts:301` (шард 7), `tasks-leads.visual.spec.ts:125`, `:139` (шард 14). Локально строка `driver-offer` — 8 с. Причину на раннере по логу не установить (лог оборван отменой job); нужен артефакт отчёта Playwright.
- Предыдущие красные `unit` (UTC в `home.page.test.tsx`) и `integration`/`isolation` из проверки 1 больше не наблюдаются: **AC этапа в CI запускаются и зелёные**.

### Сверка с историями и инвентарём

| История | Итог | Примечание |
|---|---|---|
| S2-01…S2-19 | закрыты | как в проверке 1; S2-19 — полевой тест у людей |
| S2-14 пул | закрыта | AC-06 «только рейс», 3 вьюпорта |
| **S2-20** | **почти закрыта** | экраны 1a–1g и backend на `main`; осталась сторона «до окна рейса» (Q-W2.75-1, -3), строки в `fixme`; Q-W2.75-6 (уведомление фирме, сроки на настоящих часах) — minor |
| Инвентарь экранов | 16 из 16 | `driver-offer`/`modal-driver-request-s220`/`logistics-pool-s220` добавлены S2-20; все со спеками mock и `@stand` |

### Что дальше

FollowUps W2.91…W2.97 (в критике). Без W2.91, W2.92 и W2.93 выход не закрыть.

## Проверка 1 — 2026-10-22

- main: `db7046e` (docs(plan): пакет W2.73 + W2.74 — полный e2e-stand, W2.73 не влит), совпадает с `origin/main`. Отдельный worktree `.claude/worktrees/exit-s2` (detached) и второй, `exit-s2-stand`, на том же коммите — для параллельного стенда, чтобы прогоны не делили `test-results/`. Код продукта не менялся.
- Среда: Windows 11, Docker 27.4.0 (общий, не перезапускался), pnpm 9.15.9, `GOFLAGS=-p=2`. Слот 12: Vite стенда 5212, API 8112, SMTP 2225, compose `ortus-s12`; mock — проверяющий `E2E_ROLE=verifier`, приложение 6112, эталон 7212 (`design/` текущего `main`). Стенд показа (слот 0) и `docs/demo/**` не трогались.
- MVP: облачных stage и prod-pilot нет (W3.00, W3.06 отложены решением пользователя 19.10). «Стенд stage» в критерии — локальный стенд compose слота 12.

### Вердикт

**Не пройден.** Сквозная смена водителя на телефоне и у менеджера на стенде проходит. AC-03, 04, 05, 12 и AC-06 в объёме Q-W2.07-1 «только рейс» (W2.57) зелёные: на стенде в трёх вьюпортах и в integration/isolation/concurrency. Не выполнены четыре пункта критерия:

1. **S2-20 (D-35) не закрыт.** W2.73 (логист и фирма водителя: 1a, 1b, 1f, 1g) не влит: полный e2e-stand пакета упал на `modal-driver-request-s220.spec.ts:357` (Q-W2.74-16). W2.75 (журни S2-20 и дополнения AC-06) не начат, строки в `status.md` нет. На `main` нет «Одобрить с машиной», «Только водителя», `vehicle_choice_pending` и `trip_without_vehicle`. Строка AC-06 на стенде (`temporary-driver.spec.ts:680`) по-прежнему ставит бронь от имени владельца (Q-W2.57-1), хотя D-35 эту бронь отменило.
2. **`@known-defect` в `journeys/stage2` без решения людей:** две строки `driver-a11y.spec.ts` (Q-W2.32-12). Проверено копией без `test.fixme`: 6 из 6 красные, на всех проектах `serious scrollable-region-focusable`.
3. **У W2.72 блокеры не людей, а агентов:** Q-W2.72-1 — миграция стюарда, правило 6 «машина освобождается»; Q-W2.72-2 — область чтения файлов W1.09, фото осмотра сдачи обычной машины.
4. **AC не проверяются в CI.** На GitHub `main` красный с 17.10: job `unit` падает на `home.page.test.tsx:158` из-за часового пояса раннера (UTC). `integration`, `isolation`, `e2e`, `e2e-stand` там с тех пор не запускались. Локальный полный mock тоже красный: 37 строк стабильно, из них часть сломана работами этапа 2 (снимок 19.10b W2.70, право `fleet.reservations.choose` W2.71).

### Критерий выхода по пунктам

| # | Пункт (план v2 §4) | Итог | Основание |
|---|---|---|---|
| 1 | Полная смена водителя на телефоне и у менеджера на стенде | **выполнен** | `driver-shift.spec.ts:543` (телефон + менеджер 1440: черновик без связи, категория справочника, приёмка, машина свободна сразу, начисление), `:169`, `:213`, `guide-path.spec.ts:336` («Путь проверки» 1–8) — 3 × 3 вьюпорта зелёные, слот 12 |
| 2 | AC-03 конкурентная бронь | **выполнен** | `TestAC03HundredParallelReservations`, `TestAC03TwoDriversOneVehicle` (concurrency 32,7 с), `reservations/ac03_integration_test.go`; `reservation-race.spec.ts:185` stand × 3, `:131` mock |
| 3 | AC-04 блокирующий дефект / 4 фото из 5 | **выполнен** | `TestAC04DepartureRefusals`; `defect-decision.spec.ts:184` stand × 3, `:151` mock |
| 4 | AC-05 начисления не видны водителю | **выполнен** | isolation (`fleet_review_gate`, `data_trips`, `fleet_w252_export_*`); `guide-path.spec.ts:241` (п. 5), `driver-shift.spec.ts:460`/`:543` «водитель без начислений» |
| 5 | AC-06 (Q-W2.07-1 «только рейс», W2.57) | **выполнен** | `fleet_pool_ac06_test.go`; `temporary-driver.spec.ts:680`, `:717` stand × 3 (узкая роль, после срока — только сдача на экране, после приёмки — 404), `:322`, `:361` mock |
| 6 | AC-06 — дополнения D-35 (S2-20, W2.70–W2.75) | **не выполнен** | backend и изоляция есть (W2.72: `fleet_pool_s220_test.go`, `test/concurrency/pool_test.go`), экран водителя есть (W2.74: `driver-today-offer.spec.ts:357` stand × 3). Нет экранов логиста и фирмы водителя (W2.73 не влит) и журни W2.75 «1a → 1f», «Только водителя → 1g → Поставить машину», «срок выбора» |
| 7 | AC-12 отключение логистики с активным рейсом | **выполнен** | `module-draining.spec.ts:194`, `:255` stand × 3 (новый рейс 403, начатая смена сдаётся на экране — W2.60), `:124` mock |
| 8 | Все WS этапа «готово» (или блокеры людей) | **не выполнен** | W2.73 — «на возврате: не влит»; W2.75 — нет строки; W2.72 — «есть блокеры», но они у агентов (Q-W2.72-1, -2). Остальные 45 строк W2.00…W2.74 — «готово»; их блокеры — решения людей или сняты последующими WS (сверка — в критике) |
| 9 | Нет `@known-defect` в `journeys/stage2` (или решение людей) | **не выполнен** | `driver-a11y.spec.ts:34` (2 строки × 3 проекта, Q-W2.32-12 — исправление страницы W2.22, не решение людей) |

### Прогоны

#### 1. `corepack pnpm install --frozen-lockfile`

```text
Lockfile is up to date, resolution step is skipped
Done in 21.9s using pnpm v9.15.9
exit 0
```

#### 2. `corepack pnpm run ci:local` (`GOFLAGS=-p=2`, без `ORTUS_SLOT` — шаг `e2e-stand` вынесен под сторожа, п. 3) — exit 1 на job `e2e`

```text
✔ lint/lint  ✔ lint/actionlint  ✔ lint/spectral                                   ■ lint: ок
✔ contract/openapi-validate  ✔ contract/permissions  ✔ contract/migrations
✔ contract/codegen-drift                                                         ■ contract: ок
✔ unit/check-icu  ✔ unit/typecheck  ✔ unit/test  ✔ unit/check-decisions
✔ unit/allowlist-lint  ✔ unit/mcp-check                                           ■ unit: ок
✔ integration/go-integration                                                     ■ integration: ок
✔ isolation/go-isolation  ✔ isolation/go-concurrency                             ■ isolation: ок
✔ build/build  ✔ build/storybook  ✔ build/check-k6  ✔ build/images                ■ build: ок
✖ e2e/e2e: код 1                                                                 ■ e2e: упала
```

- golangci-lint — `0 issues`. Node-наборы: repo 116, ci 176, tools 61, stand 35, contract 403, plan 79, adr 109, demo 7, load 245 (fail 0). Пакеты: api-client 7, texts 3145, e2e-kit 61, tokens 54, domain 1494, ui 259, adapter 843, web 1367 (локальный пояс — Москва; под `TZ=UTC` `home.page.test.tsx` падает, п. 5).
- Integration: 79 пакетов `ok`, 0 `FAIL`. Isolation: `test/isolation` 25,7 с. Concurrency: `test/concurrency` 32,7 с (AC-03, AC-04, два `choose` W2.72).
- Первый запуск job `e2e` упал сразу: порт эталона 4112 занимал стенд слота 12, который шёл параллельно («is already used»). Это среда, а не продукт. Повтор job — `node tools/ci/pipeline.mjs --job e2e` с эталоном на 7212:

```text
Running 2734 tests using 11 workers
  53 failed
  315 skipped
  2366 passed (48.2m)
```

  Шёл одновременно со стендом. Повтор упавших `playwright test --last-failed --workers=1` — **16 passed, 37 failed (7.9m)**. Эти 37 строк стабильны; ни одна не относится к страницам этапа 2:

  | Строки | Проекты | Причина |
  |---|---|---|
  | `company-roles.spec.ts:35`, `:138` | 390, 768, 1440 | «Водитель» — 17 разрешений вместо 16: W2.71 добавил `fleet.reservations.choose` в шаблон «Водитель» (`8042f75`), спек W1.23 не обновлён |
  | `visual/company-roles.visual.spec.ts:79` | 390, 768 | «Итоговые права роли» новой роли: 1758 px (0,0138 > 0,01) |
  | `visual/shell.labels.spec.ts:20` (owner, manager, driver) | 768, 1440 | в эталоне 19.10b (W2.70, `93bf3f1`) в меню есть «Обучение», в приложении — нет |
  | `visual/people.labels.spec.ts:68` (6 кадров) | 390, 768, 1440 | эталон 19.10/19.10b: вкладка «Роли24», роли модулей этапов 4–7 («Наставник», «Прораб», «Кассир салона»…), «Менеджер логистики» 52 и «Водитель» 25 разрешений |
  | `visual/modules.visual.spec.ts:44` (bottom, quota, quota-fit) | 390, 768 | 3700 px (0,0112 > 0,01) после снимка 19.10b |
  | `company-branding.spec.ts:457` | 768 | этап 4 (W4.62): на 768 ждёт две колонки, `aside.x` 96 |

  Страницы этапа 2 в mock (16 экранов инвентаря, журни `journeys/stage2`, `devices/`): 822 passed, 133 skipped (`@stand`), 3 упали под нагрузкой — `driver-today-offer.spec.ts:133` [390], `driver-outbox.spec.ts:392` [768], `devices/driver-devices.spec.ts:94` [pixel-7a]. Все три — `noHorizontalScroll` в момент загрузки шрифта иконок (класс П-20 этапа 1). При повторе одним воркером все три зелёные.

#### 3. Полный стенд-e2e: `node .claude/tmp/tools/stand-guard.mjs --slot 12` (замок `e2e-stand-1.lock`, `exit-s2-stand`) — код 1

```text
stand-guard: слот 12: тишина ≤ 20 мин, предел 135 мин
cmd/api: pid 37320, 127.0.0.1:8112, SMTP 127.0.0.1:2225, PUBLIC_ORIGIN http://127.0.0.1:5212
Running 288 tests using 1 worker
  12 skipped
  276 passed (1.3h)
e2e-stand: @stand пройдено 276, пропущено 12, упало 0 — пропущено 12: @stand не должен пропускаться в режиме stand
✖ e2e-stand: код 1
stand-guard: прогон завершился сам за 77 мин, код 1
```

- Упавших нет, снятий по тишине нет, зависаний нет. Красный итог дают 12 пропусков — это `test.fixme` этапа 4 × 3 проекта: `company-branding.spec.ts:481` (Q-W4.60-6), `core-calendar.spec.ts:451` (Q-W4.41-12), `tasks-card.spec.ts:388`, `tasks-project-new.spec.ts:176` (Q-W4.12-17). Тот же итог (276/0/12) получил интегратор при повторном вливании W2.74 (Q-W2.74-16).
- Строки этапа 2 — **120 из 120 зелёные**, в том числе 33 строки журни: `defect-decision:184`, `driver-shift:169`, `:213`, `:254`, `:543`, `guide-path:336`, `module-draining:194`, `:255`, `reservation-race:185`, `temporary-driver:680`, `:717` — каждая × 390/768/1440. Сюда же входят `driver-today-offer.spec.ts:357` (S2-20, W2.74) и строки `@stand` всех 16 экранов инвентаря.
- После прогона `e2e-stand.mjs --down --slot 12`: тома `ortus-s12_pg`, `ortus-s12_minio` и сеть удалены, контейнеров `ortus-s12` нет. Свой замок снят в 04:13; оба замка сейчас держат другие агенты (W4.21, интегратор W4.22).

#### 4. `@known-defect` журни этапа 2 — проверка без `fixme`

Временная копия `driver-a11y.spec.ts` (`test.fixme` → `test`, удалена после прогона, в коммит не вошла), mock, 3 воркера: **6 failed**. Каждая строка: `serious scrollable-region-focusable` — без связи и в «только чтении». Дефект Q-W2.32-12 не исправлен.

#### 5. CI на GitHub (`gh run list -R 6ykashka/ortus`)

| run | коммит | итог | что упало |
|---|---|---|---|
| 39696258807 | `db7046e` (текущий main) | failure | `unit` → `e2e` (итог шардов) красный; integration, isolation, build, шарды e2e, `e2e-stand` — skipped |
| 39668745445 | `5397020` пакет W4.31+W4.05+W4.32 | failure | `unit`: `home.page.test.tsx:158` «Сегодня 11:00» вместо «Сегодня 14:00» |
| 39129317003, 39293856145, 39557664991, 39651081369 | 18.10–21.10 | failure | та же строка `home.page.test.tsx:158` |
| 39051930023 | `c572252` (17.10) | **success** — последний зелёный | — |

Локально строка воспроизводится так: `TZ=UTC corepack pnpm exec vitest run src/routes/home/home.page.test.tsx` — 1 failed / 10 passed. Время карточки «Рейс Р-211 без водителя» форматируется в поясе машины, а не в поясе Москвы. Строка появилась в W2.25 (`b59a51f`). Пять дней CI не доходит ни до одной проверки AC. Защиты `main` нет: `gh api …/branches/main/protection` → 404 «Branch not protected».

### Сверка с историями и инвентарём

Подробности — в [../critique/stage-2.md](../critique/stage-2.md). Итог:

- S2-01…S2-19 закрыты экранами и тестами. 16 экранов `screens.yaml` с `stage: 2` — у каждого есть спек mock и строки `@stand`: `home`, `logistics-fleet`, `logistics-plan`, `logistics-pool`, `modal-driver-request`, `logistics-review` (с `modal-accept-shift`), `logistics-defects`, `logistics-earnings`, `driver-today`, `modal-finish-route`, `driver-cars`, `driver-outbox`, `core-data`, `company-expense-categories`, `logistics-vehicle-import`. S2-19 — `devices/`, полевой тест проводят люди.
- S2-20: правила 1–10 и §6 DoR закрыты на сервере (W2.72) и у водителя (W2.74). У логиста и фирмы водителя (1a, 1b, 1f, 1g) экранов на `main` нет, журни W2.75 нет. Правило 6 закрыто не до конца (Q-W2.72-1, -2).
- W2.41…W2.57 — все 17 строк «готово».

### Что дальше

FollowUps W2.76…W2.81 — в критике, раздел «Проверка 1», §4. Без них критерий не выполнен. W2.82 — не блокирует: `pre-push` из linked worktree падает на `design-preview.test.mjs:163` из-за `GIT_DIR` хука (П-8). Поэтому этот коммит отправлен из отдельного клона с теми же хуками. Порядок:

1. W2.77: возврат W2.73 №4 и вливание.
2. W2.75 (карточка реестра, ждёт W2.73).
3. Параллельно: W2.76, W2.78, W2.79, W2.80, W2.81.
4. Проверка 2 выхода — после зелёного run GitHub на `main`.
