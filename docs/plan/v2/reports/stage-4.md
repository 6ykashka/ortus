# Отчёт: выход этапа 4 «Общие модули»

- stage: 4 · проверяющий выхода и критик полноты (проверки 1 и 2) · mode: `ci:local` + stand (`e2e-stand` под сторожем, слот 11) + mock (job `e2e`)
- Критика полноты: [../critique/stage-4.md](../critique/stage-4.md)

## Проверка 2 — 2026-10-27

- main: `caf9e1c55` (docs(plan): статус W5.10, W5.21, W7.00), совпадает с `origin/main`. Отдельный worktree `.claude/worktrees/exit-s4` (detached). Код продукта не менялся.
- Среда та же, что в проверке 1 (слот 11: Vite стенда 5211, API 8111, SMTP 2125, compose `ortus-s11`; mock — `E2E_ROLE=verifier`, приложение 6111, эталон 7211). Стенд показа (слот 0) и `docs/demo/**` не трогались. Замок `e2e-stand-1.lock` держался на время прогона и снят после `down -v`. Эталон — `design-2026-10-19b`, снимок не менялся с проверки 1.
- Нагрузка ПК: свободной памяти 0,6–2,3 ГБ при работе других исполнителей. Падения «таймаут» в `ci:local` и часть остановок сторожа — следствие нагрузки, не продукта.
- Проверка 1 дала FollowUps W4.80…W4.87. Все восемь влиты в `main` и «готово» в `status.md`. Эта проверка сверяет, закрыли ли они пропуски П-1…П-9.

### Вердикт

**Критерий выхода этапа 4 выполнен.** Сквозной путь «осмотр → ответ формы → задача менеджеру» зелёный на локальном стенде слота 11 во всех трёх вьюпортах. Все 40 строк W4.* — «готово», блокеров нет. Строки изоляции этапа 4 зелёные, включая новые строки внутри организации и проверку `Origin`. AC-08 и AC-09 автоматизированы и зелёные. Пропуски П-1…П-4 и П-7…П-9 проверки 1 закрыты. П-5 (CI на GitHub) остаётся красным по причинам вне кода этапа 4, П-6 — решения людей.

Не блокирует выход, но требует работы (FollowUps W4.88, W4.89, W4.91):

1. **CI на GitHub красный** (run 40348440210 на `caf9e1c55`). Шарды e2e mock сверяют страницы со снимком 14.10 (`REFERENCE_REF: design-stage-1`), в котором нет «Формы и опросы», «Задачи и проекты», «База знаний» и S2-20: визуальные тесты ждут по 2 мин × 3 попытки, и пять шардов из двадцати снимаются по лимиту 25 мин (П-10). В `e2e-stand` `modal-finish-route.spec.ts:120` падает детерминированно в трёх run подряд: 409 `reservation_overlap` при `reserveVehicle` (П-11).
2. **Два `@stand` SPA пропускаются** (`spa-appointments.spec.ts:412`, `spa-services.spec.ts:203`; причина — backend SPA W5.20 ещё не в `main`), а сторож и `pipeline.mjs` считают пропуск `@stand` ошибкой. Поэтому любой полный `e2e-stand` на текущем `main` возвращает код 1 при 0 упавших. Это работа этапа 5 (W5.20, W5.21), не этапа 4 (П-12).
3. **Тесты логистики на стенде зависят от времени суток** (П-13): между 22:00 и 03:30 МСК падали `driver-today`, `driver-shift`, `modal-finish-route`, `temporary-driver-vehicle`; после 04:00 те же тесты прошли на свежем стенде.

### Критерий выхода по пунктам

| # | Пункт (план v2 §4) | Итог | Основание |
|---|---|---|---|
| 1 | «Осмотр → ответ формы → задача менеджеру» на стенде (MVP: локальный, слот 11) | **выполнен** | `journeys/stage4/inspection-task.spec.ts:181` — ok на mobile-390 (2,8 мин), tablet-768 (1,2 мин), desktop-1440 (1,2 мин): водитель на телефоне, осмотр с пятью фото и критическим дефектом; `cmd/worker` пишет ответ «Осмотра машины»; правило au-1 ставит Марине Котовой срочную задачу со связью `fleet/defect`; владелец видит ответ в «Ответах» → «Лента»; менеджер — «Задачи» → «Мои»; решение по дефекту завершает задачу |
| 2 | Все WS реестра §4 (W4.00…W4.62, W4.90) и контрактные PR W4.02…W4.07 — «готово» | **выполнен** | 40 строк W4.* в `status.md` — «готово», внешних блокеров нет: W4.00; W4.01…W4.07; W4.10…W4.13; W4.20…W4.24; W4.30…W4.32; W4.40, W4.41; W4.50; W4.60…W4.62; W4.70…W4.74; W4.80…W4.87; W4.90 |
| 3 | Строки изоляции модулей этапа 4 зелёные | **выполнен** | `go test -tags isolation ./test/isolation/...` и `-tags concurrency` — ok; новые строки: `calendar_w482`, `forms_w482`, `knowledge_w482` (внутри организации), `forms_public_w483_test.go` (`Origin` гостя), `data_w480_*`, `home_tasks`; на GitHub `isolation + concurrency` ✓ |
| 4 | AC-08, AC-09 автоматизированы | **выполнен** | AC-08: `cmd/api/forms_stack_integration_test.go` (`TestStackForms` → `stackTokenScope`), `forms_public_w490_test.go`, `forms_public_w483_test.go`; AC-09: `forms/responses_integration_test.go` `TestSubmitAndVersions`; зелёные в `ci:local` (около 150 пакетов `integration`, четыре перегруженных пакета прошли на повторе) и на GitHub (`integration` ✓ в run 40348440210) |

### Закрытие пропусков проверки 1

| Пропуск | Закрыт | Как проверено |
|---|---|---|
| П-1 записи allowlist `expires: stage-4` (25 предупреждений + 1 ошибка) | **да, кроме «Обучения»** | `node tools/allowlist-lint.js --stage 4`: файлов 56, записей 566, **ошибок 0, предупреждений 6** — только `shell.md:21`, `shell-manager.md:10`, `modules.md:17`, `company-roles.md:8`, `:45`, `:46` (модуль «Обучение», решение владельца Q-W2.70-16). Шаг `unit/allowlist-lint` в `ci:local` идёт с `ORTUS_STAGE=4` |
| П-2 задачи на «Главной», бейдж меню | **да (W4.81)** | mock `home.spec.ts`, `home-tasks.spec.ts` ok (3 вьюпорта); integration `tasks`, `home` ok |
| П-3 изоляция внутри организации | **да (W4.82)** | `calendar_w482.yaml`, `forms_w482.yaml`, `knowledge_w482.yaml` и их тесты; isolation зелёный |
| П-4 `Origin` публичных форм | **да (W4.83)** | `forms_public_w483_test.go`; integration `forms` и `cmd/api` ok |
| П-5 CI на GitHub | **нет** | П-10, П-11, П-12 ниже |
| П-6 решения по умолчанию | решения людей | перечень в `remaining` |
| П-7 стенд БЗ тонкий | **да (W4.86)** | `knowledge.spec.ts:1029…1207` — 9 строк `@stand`, ok × 3 вьюпорта |
| П-8 `screens.yaml`, `PublicForm.title` | **да (W4.85)** | `contract:check`, mock `public-form`, `company-users` ok |
| П-9 «Участники» проекта на 768 | **да (W4.87)** | `visual/tasks-settings.visual.spec.ts` ok × 3 вьюпорта, красных строк нет |
| Данные W4.60 на страницах оператора | **да (W4.84)** | mock `platform-org*` — 162 строки ok; stand `platform-orgs`, `platform-org-card` ok |
| Наборы «Данных» «Задачи» и «Ответы на осмотр» | **да (W4.80)** | stand `core-data.spec.ts:520` ok; integration `data/forms`, `data/tasks` ok |

Карты экранов модулей (Задачи и проекты, Формы и опросы, База знаний, Календарь, Данные, Подписка и места, Оформление) по `design-2026-10-19`: 36 ключей `stage: 4` в `api/openapi/screens.yaml`, у каждого есть spec mock; `@stand` есть у всех, страницы БЗ покрыты общими строками `knowledge.spec.ts` (9 тестов). Расхождений эталон ↔ продукт сверх записанных в `decisions.md` (Q-W4.70…Q-W4.74, Q-W4.24) не найдено.

### Прогоны

#### 1. `corepack pnpm install --frozen-lockfile`

```text
Done in 6.2s using pnpm v9.15.9
exit 0
```

#### 2. `corepack pnpm run ci:local` (`GOFLAGS=-p=2`; шаг `e2e-stand` вынесен под сторож, п. 3)

Первый запуск остановился на `lint/lint` (golangci-lint: «Timeout exceeded» при нагрузке ПК), второй — на `integration`. Итог по заданиям с повторами:

```text
lint        ✔ lint (golangci-lint 0 issues)  ✔ actionlint  ✔ spectral
contract    ✔ openapi-validate  ✔ permissions  ✔ migrations  ✔ codegen-drift
unit        ✔ check-icu  ✔ typecheck  ✔ test  ✔ check-decisions  ✔ allowlist-lint (ORTUS_STAGE=4)  ✔ mcp-check
            repo 116, ci 186, tools 63, stand 35, contract 495, plan 79, adr 110, demo 7, load 248;
            api-client 7, e2e-kit 61, texts 4586, tokens 54, domain 2997, adapter 1372, ui 259
integration ✖ go-integration: 4 пакета из около 150 упали по тайм-аутам 15–30 с под нагрузкой
            (access/assignments, access/explain, access/groups, platform/notify/inbox);
            повтор этих пакетов с -p 2 — ok (43,6 / 29,0 / 23,2 / 38,1 с)
isolation   ✔ go-isolation  ✔ go-concurrency
build       ✔ build  ✔ storybook  ✔ check-k6 (порт больше не занят слотом 0)  ✔ images
            (первая сборка образа web: ECONNRESET registry.npmjs.org; повтор обоих образов — exit 0)
```

#### 3. Полный `e2e-stand` под сторожем, слот 11

`node .claude/tmp/tools/stand-guard.mjs --slot 11` — 435 тестов (145 × 3 вьюпорта). Прошёл в трёх частях. Первый прогон сторож снял по общему лимиту 135 мин (параллельно шёл mock, свободной памяти менее 1 ГБ), повтор — по лимиту 150 мин. Зависаний по тишине (20 мин) нет. При снятии по лимиту сторож пишет план недошедших тестов в `.claude/tmp/` рабочей копии, которого нет в чистом worktree, и падает с ENOENT — планы повторов собирались вручную по логам.

| Часть | Время (МСК) | Итог |
|---|---|---|
| 1. Полный прогон | 22:22–00:37 | около 207 ok (mobile-390, tablet-768 целиком, desktop-1440 частично); снят по лимиту 135 мин |
| 2. Повтор недошедших и упавших | 00:53–03:20 | 129 ok; снят по лимиту 150 мин; тесты логистики на desktop-1440 падали (П-13) |
| 3. Недошедшие и упавшие на свежем стенде | 03:58–05:02 | tablet-768: 1 passed; desktop-1440: **94 passed, 0 failed, 2 skipped** (1,3 ч) |

Итог по тестам: **429 passed, 0 failed, 6 skipped** — по две строки SPA на вьюпорт (`spa-appointments.spec.ts:412`, `spa-services.spec.ts:203`; backend SPA W5.20 не в `main`). Сторож считает пропуск `@stand` ошибкой, поэтому итоговая строка «✖ e2e-stand» — П-12. Все строки этапа 4 — ok: `inspection-task` × 3, `core-data` (W4.80), `knowledge` 9 × 3, `platform-orgs` и `platform-org-card` (W4.84), `forms`, `form-fill`, `public-form`, `modal-form-share`, `modal-new-task`, `company-users`. Стенд остановлен (`down -v`), контейнеров `ortus-s11` и занятых портов слота нет. Перед повтором пришлось остановить собственный осиротевший сервер эталона (`design-preview` на 4111, слот 11) от оборванного прогона 26.10: порты слота были заняты.

#### 4. e2e mock страниц этапа 4

`playwright test` с `E2E_ROLE=verifier`, слот 11, фильтр по файлам модулей этапа 4 (knowledge, core-data, core-calendar, home, forms, form-fill, public-form, tasks, modal-new-task, modal-form, platform-, company-billing, company-branding, company-users, company-roles, journeys/stage4), 3 воркера:

```text
Running 2127 tests using 3 workers
  222 skipped (@stand)
  4 flaky  (form-fill.spec.ts:356, :368, :377 [768]; tasks-automation.spec.ts:126 [1440] — прошли на повторе, таймауты 2 мин при памяти < 1 ГБ)
  1901 passed (1.5h)
exit 0
```

Полный mock всего проекта (более 3 400 тестов) в этот раз не гонялся: его делит на 20 шардов GitHub (п. 5), а страницы остальных этапов к критерию этапа 4 не относятся.

#### 5. GitHub (`gh run list -R 6ykashka/ortus`)

Последний run на `main` — 40348440210 на `caf9e1c55` (отменён после падения шардов). Предыдущие: 40345522361 (`280a72572`, отменён новым пушем), 40281422068 (`f181f5db4`, failure), 40255763688 (`2856bc427`, failure).

| Job | 40348440210 |
|---|---|
| lint, contract, unit, integration, isolation + concurrency, build | ✓ (27 мин от старта до конца `build`) |
| e2e mock, 20 шардов | 15 ✓; 6, 7, 13, 14, 20 отменены на 25-й минуте |
| e2e-stand, 8 шардов | 1 ✓; 3 и 6 ✗ (все тесты прошли, пропущены 2 SPA `@stand`); 5 и 8 ✗ (`modal-finish-route.spec.ts:120`, `reserveVehicle 409 reservation_overlap`); 2, 4, 7 отменены на 30-й минуте |
| итоговые `e2e`, `e2e-stand` | ✗ |

Причины красных шардов:

- **Шарды mock 7, 13, 14, 20 (П-10).** В логах `visual/forms.visual.spec.ts:190/204`, `forms-results.visual.spec.ts:188`, `driver-offer.visual.spec.ts:48/59/76`, `s220.labels.spec.ts:57/75/99` — каждая строка ждёт 1,5–2,0 мин × 3 попытки. `ci.yml` задаёт `REFERENCE_REF: design-stage-1` для всех шардов. В снимке `design-stage-1` (14.10) нет файлов «Формы и опросы», «Задачи и проекты», «База знаний», «Временный водитель - варианты» (проверено `git ls-tree`). Локально проверяющий поднимает эталон из `design/` (19.10b), поэтому те же строки зелёные.
- **`e2e-stand` 5 и 8 (П-11).** Тот же тест падает в run 40255763688, 40281422068, 40348440210, поэтому это не флейк. `reserveVehicle` из `apiDeparture` (`logistics.stand.ts:609`) получает 409: окно, выбранное `newTrip` по `bookedUntil`, пересекается с бронью соседнего теста шарда. В моём прогоне на tablet-768 тест падал в части 2 (после десятков тестов на одном стенде) и прошёл в части 3 (первым в плане на свежем стенде).
- **`e2e-stand` 3 и 6 (П-12).** `e2e-stand: @stand пройдено 52, пропущено 2, упало 0 — @stand не должен пропускаться в режиме stand`: два SPA-теста W5.21.
- **Время суток (П-13).** В частях 1–2 и в отдельном прогоне трёх тестов на свежем стенде в 03:25 падали `driver-today.spec.ts:665`, `journeys/stage2/driver-shift.spec.ts:213`, `modal-finish-route.spec.ts:120` [1440]: `reserveVehicle 422 «Время брони уже прошло»`, на экране водителя «понедельник, 26 октября» и рейс «26.10.2026 · 23:00–03:00» при дате 27.10. После 04:00 те же тесты прошли. Первичная причина не установлена (гипотеза — стенд или тесты считают «сегодня» и окна рейса так, что окно рейса пересекает границу суток и сдвигает «сегодня»); в дневных прогонах 25.10 и 26.10 (W4.86, 420 passed) тесты зелёные.

### Что осталось (внешнее)

См. `remaining` в ответе проверки: место модуля «Обучение» (6 записей allowlist), решения по умолчанию Q-W4.74-1, Q-W4.74-2, Q-W4.71-4, Q-W4.70-1…3, Q-W4.24-1…5, защита `main`, полевой тест, вливание W5.20 для снятия пропусков SPA.

### FollowUps

| ID | Что | Блокирует выход |
|---|---|---|
| W4.88 | CI mock: эталон по странице (страницы этапов 1–2 — `design-stage-1`, страницы S2-20 и этапа 4 — `design-2026-10-19b`), чтобы шарды mock не снимались по лимиту | нет |
| W4.89 | `modal-finish-route.spec.ts:120` в шардах `e2e-stand`: бронь не должна зависеть от соседних тестов; сторож: план недошедших вне рабочей копии | нет |
| W4.91 | Тесты логистики на стенде и время суток (22:00–04:00 МСК): воспроизведение с подменой часов, исправление | нет |

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
