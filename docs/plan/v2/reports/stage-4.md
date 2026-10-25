# Отчёт: выход этапа 4 «Общие модули»

- stage: 4 · проверяющий выхода и критик полноты (проверка 1) · mode: `ci:local` + stand (`e2e-stand` под сторожем, слот 11) + mock (job `e2e`)
- Критика полноты: [../critique/stage-4.md](../critique/stage-4.md)

## Проверка 1 — 2026-10-25

- main: `d09f282` (docs(plan): статус W4.90), совпадает с `origin/main`. Отдельный worktree `.claude/worktrees/exit-s4` (detached). Код продукта не менялся.
- Среда: Windows 11, Docker Desktop (общий, не перезапускался), pnpm 9.15.9, `GOFLAGS=-p=2`. Слот 11: Vite стенда 5211, API 8111, SMTP 2125, compose `ortus-s11`; mock — проверяющий `E2E_ROLE=verifier`, приложение 6111, эталон 7211. Стенд показа (слот 0) и `docs/demo/**` не трогались. Временные файлы — `.claude/tmp/stage-4-exit/`.
- MVP: облачных stage и prod-pilot нет (W3.00, W3.06 отложены решением пользователя 19.10). «Стенд stage» в критерии — локальный стенд compose слота 11.

### Вердикт

**Не пройден.** Сквозной путь «осмотр → ответ формы → задача менеджеру» проходит на стенде во всех трёх вьюпортах. Все строки этапа 4 в `status.md` — «готово». AC-08 и AC-09 автоматизированы и зелёные локально и на GitHub. Существующие строки изоляции зелёные. Полный e2e-stand: 372 из 372.

Не выполнено:

1. **Этап не доделан по эталону.** 25 записей allowlist истекают на этапе 4 (`allowlist-lint --stage 4`: 25 предупреждений «снять до закрытия этапа» и 1 ошибка). За ними стоят работы агентов, ни одна карточка их не взяла:
   - наборы «Данных» «Задачи» и «Ответы на осмотр»;
   - задачи на «Главной» и бейдж меню (Q-W4.12-9);
   - данные W4.60 на страницах оператора «Организации» и в карточке организации;
   - имя проекта в назначениях.

   Решения людей ждут только шесть записей «Обучения».
2. **Строки изоляции модулей этапа 4 неполные.** Внутри организации нет строк календаря между подразделениями (Q-W4.40-6), форм (`self`, подразделение, связь с рейсом) и ACL БЗ (Q-W4.04-11). У публичных форм нет проверки `Origin`, которую требует контракт (Q-W4.90-1, «до конца этапа 4»).
3. **Полный mock красный на одной строке этапа 4.** `visual/tasks-settings.visual.spec.ts:151` (tasks-people, 768): 0,0137 > 0,01 стабильно, при повторе одним воркером тоже. Остальные 7 падений из 8 — нагрузка, при повторе зелёные.
4. **CI на GitHub красный.** Шарды e2e mock (лимит 20 мин) и `e2e-stand` (лимит 40 мин) снимаются по времени, упавших тестов нет. Путь этапа в CI не проходит. Это не нарушает критерий напрямую, потому что AC-08 и AC-09 зелёные в `integration`. Но проверку 2 стоит делать после зелёного run.

### Критерий выхода по пунктам

| # | Пункт (план v2 §4) | Итог | Основание |
|---|---|---|---|
| 1 | «Осмотр → ответ формы → задача менеджеру» на стенде (MVP: локальный, слот 11) | **выполнен** | `journeys/stage4/inspection-task.spec.ts:181` — ok на mobile-390 (№ 63), tablet-768 (№ 187), desktop-1440: водитель на телефоне — осмотр с пятью фото и критическим дефектом; `cmd/worker` — ответ «Осмотра машины» (`inspection`, «Принят», v3, автор Илья Васильев); задача au-1 Марине Котовой (срочная, «дефект», связь `fleet/defect`); владелец — «Ответы» → «Лента» с журналом; менеджер — «Задачи» → «Мои» → карточка; «разрешить выезд» → задача «Готово» |
| 2 | Все WS реестра §4 (W4.00…W4.62, W4.90) и контрактные PR W4.02…W4.07 — «готово» | **формально выполнен, по существу нет** | 32 строки W4.* в `status.md` — «готово», блокеров нет. Но объём DoR W4.12 (источник «Главной» и бейдж, `tasks.md` §6) не сделан и не передан. Записи `expires: stage-4` у W4.50 (Q-W4.50-6), W1.25 (страницы оператора до W4.60/W4.61) и W1.23 (имя проекта) остались без владельца — критика П-1, П-2 |
| 3 | Строки изоляции модулей этапа 4 зелёные | **не выполнен** | все существующие строки зелёные: `go test -tags isolation` 50,5 с, concurrency 99 с, на GitHub `isolation` ✓. Нет строк внутри организации (календарь, формы, БЗ) и строки `Origin` гостя — критика П-3, П-4 |
| 4 | AC-08, AC-09 автоматизированы | **выполнен** | AC-08: `cmd/api/forms_stack_integration_test.go` (`TestStackForms` → `stackTokenScope`), `forms_public_w490_test.go`; AC-09: `forms/responses_integration_test.go` `TestSubmitAndVersions`, `forms_integration_test.go:169`; зелёные в `ci:local` и на GitHub (run 40181927311, `integration` ✓) |

### Прогоны

#### 1. `corepack pnpm install --frozen-lockfile`

```text
. prepare$ husky
. prepare: Done
Done in 53.6s using pnpm v9.15.9
exit 0
```

#### 2. `corepack pnpm run ci:local` (`GOFLAGS=-p=2`, без `ORTUS_SLOT`: шаг `e2e-stand` вынесен под сторожа, п. 3) — exit 1 на `build/check-k6` (среда)

```text
✔ lint/lint  ✔ lint/actionlint  ✔ lint/spectral                                   ■ lint: ок
✔ contract/openapi-validate  ✔ contract/permissions  ✔ contract/migrations
✔ contract/codegen-drift                                                         ■ contract: ок
✔ unit/check-icu  ✔ unit/typecheck  ✔ unit/test  ✔ unit/check-decisions
✔ unit/allowlist-lint  ✔ unit/mcp-check                                           ■ unit: ок
✔ integration/go-integration                                                     ■ integration: ок
✔ isolation/go-isolation  ✔ isolation/go-concurrency                             ■ isolation: ок
✔ build/build  ✔ build/storybook  ✖ build/check-k6: код 1  ✔ build/images         ■ build: упала (check-k6)
```

- golangci-lint — `0 issues`. Node-наборы: repo 116, ci 177, tools 63, stand 35, contract 403, plan 79, adr 109, demo 7, load 245 (fail 0). Пакеты: api-client 7, texts 4563, e2e-kit 61, tokens 54, domain 1502, ui 259, adapter 856, web 1791 (fail 0).
- Integration — все пакеты `ok`. Isolation — `test/isolation` 50,5 с, `fixtures` 17,1 с. Concurrency — 99,1 с.
- `check-k6` упал на среде. Без `ORTUS_SLOT` API-двойник k6 слушает `8100 + 0`, это порт API слота 0. k6 из Docker на `host.docker.internal:8100` попал не в двойник: первый же `devLogin` вернул не 2xx (`setup: вход логиста load-pilot-planner-01`, 13 проверок FAIL). Повтор `FAKE_API_PORT=18111 node backend/test/load/check-k6.mjs` — exit 0: `http_req_failed` 0 из 217, все `flow_completed` 2 из 2, запросы по операциям совпадают с моделью. Порт по умолчанию стоит поправить (W4.86).
- `allowlist-lint` в конвейере зелёный, потому что `ORTUS_STAGE` не задан (этап 0). `node tools/allowlist-lint.js --stage 4` — 1 ошибка (`company-users.md:20`, `expires: stage-2`) и 25 предупреждений `expires: stage-4`. При `--stage 5` — 26 ошибок. Разбор — критика П-1.

#### 3. Полный стенд-e2e: `node .claude/tmp/tools/stand-guard.mjs --slot 11` (замок `e2e-stand-1.lock`, 12:55–14:30, снят) — код 0

```text
stand-guard: слот 11: тишина ≤ 20 мин, предел 135 мин
cmd/api: pid 46384, 127.0.0.1:8111, SMTP 127.0.0.1:2125, PUBLIC_ORIGIN http://127.0.0.1:5211
Running 372 tests using 1 worker
  372 passed (1.5h)
e2e-stand: @stand пройдено 372, пропущено 0, упало 0
✔ e2e-stand: зелёный
stand-guard: прогон завершился сам за 94 мин, код 0
```

- Упавших, пропущенных, повторов и снятий по тишине нет. Первые ~50 минут параллельно шёл `ci:local` (п. 2), затем около 10 минут — job `e2e` mock. Mock остановлен своим TaskStop и перезапущен после стенда (п. 4).
- Строки этапа 4 — **108 из 108** (36 строк × 3 вьюпорта): журни `inspection-task:181`; задачи (`tasks-projects:221`, `tasks-project-new:178`, `tasks-board:270`, `modal-new-task:252`, `tasks-card:390`, `:413`, `tasks-people:317`, `tasks-workflow:236`, `tasks-automation:215`, `tasks-leads:224`); формы (`forms:639`, `:645`, `forms-settings:284`, `forms-responses:450`, `forms-versions:207`, `modal-form-share:140`, `forms-actions:471`, `form-fill:406`, `:427`, `public-form:390`, `:410`); БЗ (`knowledge:1029`, `:1037`); календарь (`core-calendar:464`, `:475`); данные (`core-data-jobs:208`, `:249`); подписка и оформление (`company-billing:473`, `:548`, `company-branding:523`); оператор (`platform-pricing:460`, `platform-requests:329`, `platform-usage:436`, `:462`, `platform-users:661`).
- Строки этапов 1–2 (журни `stage1`, `stage2`, экраны) — тоже зелёные, регрессий нет.
- После прогона `down -v`: контейнеры `ortus-s11-*`, тома `ortus-s11_pg`, `ortus-s11_minio` и сеть удалены. Замок снят.

#### 4. e2e mock — job `e2e` (`ORTUS_SLOT=11 E2E_ROLE=verifier REFERENCE_PORT=7211 node tools/ci/pipeline.mjs --job e2e`)

Mock шёл один, после стенда:

```text
Running 3805 tests using 11 workers
  8 failed
  401 skipped
  3396 passed (1.2h)
✖ e2e/e2e: код 1
```

Повтор упавших `playwright test --last-failed --workers=1` — **7 passed, 1 failed (55.6s)**:

| Строка | Проекты | Итог | Причина |
|---|---|---|---|
| `company-structure.spec.ts:460` (axe), `driver-today-offer.spec.ts:133` ×2, `tasks-project-new.spec.ts:164` ×2 (axe), `visual/company-branding.visual.spec.ts:12`, `devices/driver-devices.spec.ts:94` | разные | зелёные при повторе | нагрузка 11 воркеров (класс П-20 этапа 1: шрифт иконок, тайминги axe) |
| `visual/tasks-settings.visual.spec.ts:151` «tasks-people: вкладка «Участники» в допуске 0,01» | tablet-768 | **красная стабильно** (дважды) | 10 795 px, 0,0137 > 0,01. Эталон под именем участника показывает должность («Владелец», «Логист», «Водитель», «Диспетчер · Самара»), поэтому строки выше. У участника через группу (Илья Васильев) в эталоне выбор роли, в приложении — замок. Страница W4.13 → W4.87 |

`@stand` в mock пропускаются (401 skip — строки стенда и `@mailpit`). Остальные страницы этапа 4 в mock зелёные: «Задачи и проекты», «Формы и опросы», «База знаний», «Календарь», «Данные», «Подписка и места», «Оформление», страницы оператора и их визуальные сверки, кроме строки выше. Регрессий в страницах этапов 1–2 нет. Строки этапа 2 из прошлой проверки (`company-roles`, `shell.labels`, `people.labels`) теперь зелёные.

#### 5. CI на GitHub (`gh run list -R 6ykashka/ortus`)

| run | коммит | итог | что упало |
|---|---|---|---|
| 40181927311 | `d09f282` (текущий main) | failure | lint, contract, unit, integration, isolation + concurrency, build ✓; шарды e2e 1…6 — «exceeded the maximum execution time of 20m0s» (шард 1: «Running 635 tests», за 20 мин 272 ✓, 0 ✘); `e2e-stand` — «exceeded … 40m0s»: из 372 дошли 185 ✓, `driver-outbox.spec.ts:476` [tablet-768] ✘ с первой попытки, ✓ при retry #1 |
| 40167775531, 40163873225, 40156967030, 40146689627 | 25.10, пакеты W4.70…W4.74, W4.71 | cancelled | те же лимиты 20 и 40 мин |
| 40118104842, 40120489895 | 24.10 | failure | `integration` (исправлено последующими пакетами) |

Защиты `main` нет: `gh api …/branches/main/protection` → 404 «Branch not protected».

### Сверка с историями и инвентарём

Подробности — в [../critique/stage-4.md](../critique/stage-4.md). Итог:

- Шаги 4.1–4.6 `27-implementation-plan.md` закрыты экранами и сервером. Исключения — П-1 (наборы «Данных», «Главная», страницы оператора) и П-2 (задачи на «Главной»).
- 36 ключей `screens.yaml` с `stage: 4`. У всех есть spec mock, у 27 — строки `@stand`. Без стенда — 7 экранов и диалогов БЗ, `forms-preview`, `modal-form-publish` (П-7).
- DoR `tasks.md`, `forms.md`, `knowledge.md`: кандидаты W4.25–W4.28 и W4.33–W4.35 вошли в W4.21, W4.23, W4.70, W4.31, W4.32. W4.36 (источник «Главной» для БЗ) в эталоне отсутствует (`homeVM` БЗ не читает), не требуется. Модуль «Обучение» ждёт решения владельца.

### Что дальше

FollowUps W4.80…W4.87 — в критике, раздел «Проверка 1», §4. Без W4.80…W4.85 и W4.87 критерий не выполнен. W4.86 (CI в лимитах GitHub, `ORTUS_STAGE` для `allowlist-lint`, порт `check-k6`, аргументы `e2e-stand.mjs`, шире стенд БЗ) выход не блокирует, но проверку 2 лучше делать после зелёного run. Порядок:

1. Контрактный PR стюарда сразу для W4.80, W4.81, W4.84, W4.85: виды «Требует решения» `tasks.*`, наборы, поля оператора, `PublicFormPresentation.title`.
2. Параллельно: W4.80, W4.81, W4.84 (Б + Ф), W4.82 (изоляция), W4.83 (`Origin`).
3. W4.85, W4.86, W4.87 (визуальная сверка tasks-people на 768).
4. Проверка 2 выхода — после вливания и зелёного run GitHub на `main`.
