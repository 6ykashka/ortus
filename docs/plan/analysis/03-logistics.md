# 03 · Модуль «Логистика» (fleet) — карта для реализации

Домен: рабочее место логиста («Рабочее место логиста»), «Ресурсный пул», «Приёмка смен», мобильная смена водителя («Сегодня» / «Моя смена»), «Автомобили». Все пути к источникам даны относительно `design/`.

> **Снимок эталона: 14.10.2026** (тег `design-stage-1`, `design/MANIFEST.md`; W0.02). Экраны логистики (`fleet`, `pool`, `review`, `today`, `cars`) в 14.10 по разметке и VM **не менялись**: ссылки на строки пересчитаны по diff (шаблон +7, VM +9, `api.js`, `models.js`, `mock-data.js` — по своим diff). Переписано окружение: §4.2 (меню по D-23, новые пункты логиста и водителя), §4.3–§4.4 (режим чтения и общий баннер), §11.7 (новый: предложения расходов в «Кассу», проект задач `fleet` с процессом и ролями), §14 (пункты меню), §16.

---

## 1. Источники

| Файл | Строки | Что |
|---|---|---|
| `Ортус CRM.dc.html` | 44–92 | Демо-панель: персонажи, «Ширина» (390/768/1440), флажки «Нет связи», «Конфликт брони», «Сбой загрузки фото», «Путь проверки», скрытый `<input type="file">` |
| `Ортус CRM.dc.html` | 94–147 | Шапка: чип «Нет связи», колокольчик, профиль |
| `Ортус CRM.dc.html` | 149–204 | Боковая навигация, `<main id="ox-main">`, баннеры, скелет загрузки, AccessGate |
| `Ортус CRM.dc.html` | 428–520 | `pg.fleet` «Рабочее место логиста» |
| `Ортус CRM.dc.html` | 522–564 | `pg.pool` «Ресурсный пул» |
| `Ортус CRM.dc.html` | 566–662 | `pg.review` «Приёмка смен» |
| `Ортус CRM.dc.html` | 663–848 | `pg.today` «Моя смена» (dr.*, ins.*, df.*, ex.*, act.*) |
| `Ортус CRM.dc.html` | 850–867 | `pg.cars` «Автомобили» (dc.*) |
| `Ортус CRM.dc.html` | 2165–2201, 2264–2272, 2287–2291 | Нижняя навигация, модалка `confirm`, модалка `request`, тост |
| `Ортус CRM.dc.html` | 2297–2353 | Константы: `MEMBER`, `TONE`, `ch()`, `STRIPES`, `SIDES`, `emptyInsp()`, `REV_STEPS`, `ACTIONS`, `INITIAL()` |
| `Ортус CRM.dc.html` | 2355–2464 | Жизненный цикл, `boot`, `toast`, `run`, `mark`, `go`, `setPage`, `setOnline` |
| `Ортус CRM.dc.html` | 2467–2640 | Фото/outbox/действия водителя (`uploadPhoto` … `newShift`) |
| `Ортус CRM.dc.html` | 2764–2795 | `accept`, `rework`, `decideDefect`, `assignVehicle`, `openRequest`, `saveRequest` |
| `Ортус CRM.dc.html` | 2801–2883 | `renderVals`: брейкпоинты, `pg`, выбор VM |
| `Ортус CRM.dc.html` | 2893–2921 | `guideVM` («Путь проверки») |
| `Ортус CRM.dc.html` | 2950–3003 | `navForBase` — пункты меню по персонам |
| `Ортус CRM.dc.html` | 3005–3098 | `shellVM`, `gateVM`, `bannersVM` |
| `Ортус CRM.dc.html` | 3249–3530 | `fleetVM`, `poolVM`, `reviewVM`, `photoVM`, `carCards`, `driverVM` |
| `Ортус CRM.dc.html` | 3964–3977, 4035–4037 | `modalVM`: confirm и request |
| `ortus/models.js` | 125–163, 322–389 | Справочники статусов, `compat`, `legs`, `inspMissing`, `odoError`, `validateExpense` |
| `ortus/api.js` | 12–232, 446–552, 970–986, 1028–1038 | `ApiError`, `view()`, `cmd()`, команды логистики, `upload`, пути HTTP-адаптера |
| `ortus/mock-data.js` | 145–230 | units, members, roles, assignments, vehicles, trips, pool |
| `ortus/extra-data.js` | 6–17 | ресурсы календаря `res-v1/v6/v4`, бронь `b-208`, «Плановое ТО» v4 |
| `docs/db/tenant_0002_fleet.sql` | 1–207 | Целевая схема `fleet.*`, `finance.earnings` |
| `docs/10-data-model.md` | 84–123 | Переходы рейса, инварианты |
| `docs/11-permissions.yaml` | 122–143, 285–289 | Ключи `fleet.*`, алиасы макета |
| `docs/12-errors-and-events.md` | 5–56, 79–94 | Формат ошибки, коды 409, доменные события |
| `docs/15-quality-security.md` | 35–43 | AC-01…AC-09 |
| `docs/v0.1/08-domain-scenarios.md` | 68–145, 251–257, 271–304 | Сценарий водителя, пул, офлайн, критерии D01–D22 |
| `docs/13-backlog-s0-s2.md` | 118–135 | Бэклог S2 (пилот логистики) |
| `README.md` | 7–16, 157–179 | UX-решения, допущения, расхождения |
| `ortus/cash.js` | 104–123, 342–360 | 14.10: `cashProposals` (возмещение расходов принятых смен), `cashPostProposal` |
| `ortus/mock-data.js` | 182–184, 287 | 14.10: проект задач `fleet` «Логистика · Север» и проектные роли Котовой, Васильева, Котельниковой |

### Якоря снимка 14.10

| Идентификатор | Строка | Что |
|---|---|---|
| `fleetVM` | `:3249` | «Рабочее место логиста» |
| `poolVM` | `:3309` | «Ресурсный пул» |
| `reviewVM` | `:3330` | «Приёмка смен» |
| `photoVM` | `:3384` | фото-слот |
| `carCards` | `:3403` | карточки машин водителя |
| `driverVM` | `:3422` | «Моя смена», «Автомобили» |
| `accept` | `:2764` | принять смену |
| `rework` | `:2777` | вернуть на доработку |
| `decideDefect` | `:2784` | решение по дефекту |
| `assignVehicle` | `:2787` | назначить машину |
| `navForBase` | `:2950` | меню (D-23) |
| `compat` | `models.js:323` | совместимость машины с рейсом |
| `legs` | `models.js:344` | загрузка по участкам |
| `inspMissing` | `models.js:354` | чего не хватает в осмотре |
| `odoError` | `models.js:369` | проверка пробега |
| `validateExpense` | `models.js:378` | проверка расхода |
| `assertLogisticsFor` | `api.js:178` | проверка подписки и модуля |
| `reserve` | `api.js:446` | бронь |
| `submitDeparture` | `api.js:472` | выезд |
| `reviewTrip` | `api.js:520` | приёмка |
| `cashProposals` | `cash.js:104` | предложения в кассу (14.10) |
| `support.js` | 796–813 | Атрибуты рендерятся как props React-подобного `h()`: `disabled={{ true }}` — булев проп, `aria-pressed="true"/"false"` — строки |

---

## 2. Сводка

- Логистика — пилотный модуль (`docs/13-backlog-s0-s2.md:118–135`): машины, рейсы, бронь, осмотры с 5 фото, дефекты, расходы, сдача, приёмка, пул водителей, закрытые начисления.
- Пять экранов: `fleet` (логист/владелец), `pool` (логист/владелец), `review` (логист/владелец), `today` и `cars` (водитель). Все — только в организации `t-alta` («Альта Групп»); у `t-lotos` `vehicles: []`, `trips: []` и нет персон manager/driver (`mock-data.js:74`, html:2298).
- Модуль по умолчанию **не подключён** (`modules.logistics.enabled: false`, `mock-data.js:149`), у логиста Марины Котовой **нет назначений** (`assignments` a1–a4, `mock-data.js:180–188`). Путь проверки начинается с «Владелец: подключить «Логистику»» и «Назначить Марине Котовой роль и область» (html:2896–2897).
- Права через `can(db, mid, 'logistics', verb, unit)` (`models.js:286–295`): fleet → `view`, pool → `edit`, review → `review`; водитель (роль `r-driver`: `logistics: ['view','create']`, scope firm `f-msk-sever`).
- Начисления (`trip.earnings`) удаляются сервером из ответа, если `!canEarnings` (`api.js:193–195`); функция «Водитель» блокирует их всегда (`models.js:298–306`).
- Совместимость машины — `compat()` (`models.js:323–340`): 5 проверок (доступность, грузоподъёмность, объём, длина кузова, температура), `fit` = 4 последних, `ok` = fit && доступна; `reasons` — текст причин.
- Загрузка по участкам — `legs()` (`models.js:344–352`): после каждой точки масса и объём отдельно, проценты от `payloadT`/`volumeM3`.
- Осмотр: 5 слотов фото (`SIDES`: Спереди/Сзади/Слева/Справа/Одометр), пробег, топливо (¼ ½ ¾ Полный), чек-лист 3 пункта (разный для выезда и сдачи), дефекты с зонами; `inspMissing()` формирует список «Осталось: …».
- Пробег: при выезде ≥ `vehicle.odometer`, при сдаче ≥ `trip.dep.odometer`; превышение > +3000 км — только предупреждение (`models.js:369–376`).
- Критический дефект при выезде → `defect_review`, машина `unavailable`, менеджер решает «разрешить выезд» / «подтвердить неисправность» (`api.js:479–483, 488–499`).
- Расходы: категории «Топливо» / «Мойка», сумма (0 < a ≤ 200 000), дата, литры (топливо, необязательно), комментарий, фото чека обязательно (`models.js:378–389`).
- Фото-слот имеет 5 состояний: `empty` / `uploading` / `failed` / `queued` / `ready` (`photoVM`, html:3384–3401).
- Офлайн: бронь и выезд блокируются; расход и сдача уходят в `outbox` со статусами `local`/`sending`/`error` и отправляются `flush()` при появлении связи (html:2527–2551).
- Конфликт брони (409): флажок «Конфликт брони» → следующий `reserve`/`assignVehicle` получает `ApiError('conflict')`; водитель видит alert «Конфликт брони» + «Обновить список»; логист — тост «Конфликт: …» и автообновление.
- Приёмка: очередь (defect_review → submitted → rework → accepted), фото до/после, статистика пробега и топлива, дефекты, расходы, начисление (по праву), «Решение»: замечания + разделы на доработку, «Принять смену» через confirm-диалог.
- Серверные команды — mock-адаптер `api.js` с задержками 250–650 мс и `ApiError` кодами `offline`, `conflict`, `incompatible`, `validation`, `module_off`, `subscription_restricted`, `no_permission`, `no_scope`, `upload_failed`, `quota_exceeded`.
- Целевая схема `tenant_0002_fleet.sql` расходится с mock в единицах (кг/мм vs т/м), ключах топлива, категориях расходов, ролях фото — см. §12 и §15.

---

## 3. Инвентарь

| Ключ | Подпись в меню | Персоны | Орг. | Гейт (модуль/verb) | Шаблон | VM | Хендлеры |
|---|---|---|---|---|---|---|---|
| `pg.fleet` | «Рабочее место логиста» (icon `local_shipping`), мобильно «Логист» | owner, manager | t-alta | logistics / view | html:428–520 | `fleetVM` 3249–3307 | `assignVehicle` 2787–2790, `refresh` 2567–2572, `setPage('pool')` |
| `pg.pool` | «Ресурсный пул» (`person_search`), мобильно «Пул» | owner, manager | t-alta | logistics / edit | html:522–564 | `poolVM` 3309–3328 | `openRequest`/`saveRequest` 2791–2795, `decideRequest` |
| modal `request` | — (h2 «Запросить водителя») | owner, manager | t-alta | — | html:2264–2272 | `modalVM` 4035–4037 | `saveRequest` |
| `pg.review` | «Приёмка смен» (`fact_check`, badge = submitted+defect_review), мобильно «Приёмка» | owner, manager | t-alta | logistics / review | html:566–662 | `reviewVM` 3330–3382 | `accept` 2764–2776, `rework` 2777–2783, `decideDefect` 2784–2786 |
| modal `confirm` «Принять смену …?» | — | owner, manager | t-alta | — | html:2179–2201 | `modalVM` 3969–3977 | `accept` |
| `pg.today` | «Сегодня» (`today`) | driver | t-alta | logistics / view | html:663–848 | `driverVM` 3422–3530 | `reserve`, `cancelRes`, `submitDep`, `finishRoute`, `submitRet`, `openExp`/`saveExp`, `saveDefect`, `newShift` 2555–2640 |
| modal `confirm` «Завершить рейс …?» | — | driver | t-alta | — | html:2179–2201 | — | `finishRoute` 2586–2596 |
| `pg.cars` | «Автомобили» (`local_shipping`) | driver | t-alta | logistics / view | html:850–867 | `driverVM` → `dc` 3526–3528 | `reserve` |
| AccessGate (fleet-варианты) | — | все | t-alta | — | html:195–203 | `gateVM` 3053–3081 | `go('owner','modules'|'users')` |
| Баннеры (офлайн / модуль отключён / trial / квота) | — | все кроме operator | — | — | html:174–180 | `bannersVM` 3083–3098 | — |
| Тост | — | все | — | — | html:2287–2291 | `toastVM` 2885–2891 | `toast()` 2414–2418 |
| Демо-панель «Путь проверки» | — | все | — | — | html:59, 68–87 | `guideVM` 2893–2921 | `go` |

---

## 4. Общая оболочка (в части, нужной домену)

### 4.1 Брейкпоинты и регионы (`:2801–2819`, `:149–204`, `:2165–2174`)

| Параметр | Правило | Источник |
|---|---|---|
| `W` | `frame !== 'auto' ? min(Number(frame), s.w) : s.w` — кадр 390/768/1440 из демо-панели | 2804 |
| `mobile` | `W < 640` → нижняя навигация `<nav aria-label="Навигация">` (первые 3 пункта + «Ещё» icon `menu`), боковой панели нет | 2805, 2165–2174, 3028–3030 |
| `rail` | `640 ≤ W < 1080` → боковая `<nav aria-label="Основная навигация">` шириной `68px`, только иконки, подпись в visually-hidden span, `title` = подпись | 2805, 2818, 150–158 |
| sidebar | `W ≥ 1080` → ширина `244px`, заголовки групп uppercase 11px `#6B7873`, внизу `shield` + «Данные других организаций изолированы» | 2818, 152, 165–166 |
| `mainMax` | driver → `680px`, иначе `1320px`; `mainPad` mobile `16px 14px 28px` иначе `24px 28px 40px` | 2819 |
| scroll | `<main id="ox-main" style="overflow-y:auto">`; `setPage` ставит `scrollTop = 0` | 172, 2454 |
| toast | `position:absolute; bottom: 76px (mobile) / 20px`; bg `#1C2A26`, fg `#FFFFFF`, 14px; авто-скрытие 4200 мс; `role="alert"` для error, иначе `status`; `aria-live="polite"` | 2288, 2417, 2890 |
| modal | backdrop `rgba(28,42,38,.42)` z-50; `role="dialog" aria-modal="true" aria-labelledby="dlg-title"`; desktop centered `max-width:560px` radius `14px`; mobile bottom-sheet radius `16px 16px 0 0`; Escape закрывает | 2176–2178, 3966, 2380–2384 |
| Активный пункт меню | bg `var(--ox-accent-soft)`, fg `var(--ox-accent)`, weight 600, `aria-current="page"`; hover `background:#EBEFE9` | 3024, 155 |
| Бейдж меню | `min-width:20px;height:20px;border-radius:99px;background:var(--ox-accent);color:#FFF;font-size:12px` | 160 |
| Чип офлайн в шапке | `role="status"`, bg `#FAF1DC`, fg `#7A5214`, icon `cloud_off`, текст «Нет связи» | 115 |

Нижняя навигация сокращает подписи: «Рабочее место логиста» → «Логист», «Ресурсный пул» → «Пул», «Приёмка смен» → «Приёмка» (3028). Пункт: `min-height:60px`, icon 24px с `FILL 1` у активного, 12px подпись.

### 4.2 Навигация по персонам (`:2950–3003`)

| Персона | Группа | Пункты (id · подпись · icon) | Условие |
|---|---|---|---|
| owner | «Логистика» | `fleet` «Рабочее место логиста» `local_shipping`; `pool` «Ресурсный пул» `person_search`; `review` «Приёмка смен» `fact_check` (badge — смены `submitted`/`defect_review`) | 14.10, D-23: группа есть **только при подключённом модуле** (`st('logistics') === 'on'`, `:2980`); пункты — по `can(asIf, mid, 'logistics', 'view'|'edit'|'review')` (`logItems`, `:2954–2963`) |
| owner | «Отключены · только чтение» | `fleet` «Логистика» `local_shipping` | 14.10, D-23: модуль отключён с историей (`history`) и `logItems()` непуст (`:2981`); группа внизу меню; страница открывается для чтения с баннером (§4.4) |
| owner | — | — | модуль ни разу не подключался — пунктов нет |
| manager | «Логистика» | то же; если прав нет — один пункт `fleet` «Рабочее место логиста» (и дальше AccessGate) | D-23: меню сотрудника не зависит от состояния модуля (`:2994`) |
| manager | «Общие модули» | 14.10: `chat` «Чаты», `tasks` «Задачи» [новые задачи Котовой], `service` «Обращения», `forms`, `calendar`, `knowledge`, `docs` «Документы», `data`, `files`, `cash` — по `can(view)` | `:2996`; на эталоне без роли логиста: «Чаты», «Задачи» [1], «Обращения» [1], «База знаний», «Документы» (объектные роли — 02 §6.12, PD-53) |
| driver | «Работа» | `today` «Сегодня» `today`; `cars` «Автомобили» `local_shipping`; 14.10: `cash` «Подотчёт» `account_balance_wallet` (если есть свой подотчётный счёт), `chat` «Чаты», `knowledge` «База знаний», `docs` «Документы» (по `can(view)`) | `:3000`; на эталоне: «Сегодня», «Автомобили», «Подотчёт», «Чаты» [6], «База знаний», «Документы» |

Проверено на эталоне 15.10.2026: владелец подключает и отключает «Логистику» → группа «Логистика» пропадает, внизу появляется «Отключены · только чтение» → «Логистика»; клик открывает «Рабочее место логиста» без гейта с баннером «Модуль «Логистика» отключён.». Пункты общих модулей у логиста и водителя относятся к этапам 4–7 — до них `out-of-stage`.

Бренд-переименование (2934–2948): пункт `review` может называться «Приёмка » + термин `shift.many`, пункт `cars` — `capF(термин vehicle.plural)` (например «Машины»); по умолчанию — «Автомобили». Заголовок h1 страницы приёмки — `top.reviewTitle` (3036): `brand.items.review.label` → «Приёмка {shift.many}» → «Приёмка смен».

### 4.3 AccessGate для страниц домена (`:195–203`, `:3065–3080`)

Для fleet/pool/review/today/cars: `mod = 'logistics'`, `verb = review → 'review' | pool → 'edit' | иначе 'view'`.

| Причина | Чип (label · tone · icon) | h1 | Текст | Кнопка |
|---|---|---|---|---|
| `module_off` (или `module_readonly` при `!asIf.ok`) | «Модуль не подключён» / «Модуль отключён» · neutral · `extension_off` | «„Логистика“ не подключена организацией» — в источнике: `'«' + name + '» не подключена организацией'` | owner: «Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам.» · иначе: «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.» | owner «Открыть «Модули и место»» / иначе «Демо: открыть как владелец» → `go('owner','modules')` |
| `module_readonly` и `asIf.ok` | гейта нет: страница открыта только для чтения, показывается баннер «Модуль «Логистика» отключён.» (`:3073`, `:3089–3091`). 14.10: так же работают страницы `PAGE_MOD` (ветка A, `:3061`) | | | |
| `no_permission` / `no_scope` | «Нет права» · warn · `lock` | review: «Нет права на приёмку смен»; иначе «Нет роли с доступом к модулю «Логистика»» | «Модуль подключён, но ни одна ваша роль не разрешает это действие» + (review: « («Проверять»)») + «. Владелец бизнеса может назначить роль и область.» | «Демо: открыть как владелец» → `go('owner','users')` |

Разметка гейта: карточка `#FFFFFF`, border `#DCE2D9`, radius 12, padding `40px 24px`, круг 56px с иконкой 28px, чип 12px/600, h1 20px/600, p `#5C6964` max-width 480, кнопка accent min-height 44.

Стартовое состояние демо: водитель и логист видят гейт «Модуль не подключён» до включения модуля владельцем; после включения логист видит «Нет роли с доступом к модулю «Логистика»» до назначения роли «Менеджер логистики» (роль `r-manager`, `mock-data.js:171`).

### 4.4 Баннеры (`:174–180`, `:3083–3098`)

Разметка: `role="status"` (danger → `alert`), bg/fg по `TONE`, border `LINE[tone]`, icon 20px, `<strong>title</strong> text`, кнопка `border:1px solid currentColor`.

| Условие | tone · icon | title | text | кнопка |
|---|---|---|---|---|
| tenant `restricted`/`suspended` | warn · `lock_clock` | «Пробный период завершён.» | «Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.» | owner: «Демо: продлить как оператор» |
| модуль выключен с `history`, page ∈ fleet/pool/review/today/cars | neutral · `history` | «Модуль «Логистика» отключён.» | `RO_TEXT.logistics` (`:3090`): «Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.» (14.10: механизм общий — `roMod`, у SPA и ремонта свои тексты; текст логистики прежний) | — |
| `!online` | warn · `cloud_off` | «Нет связи.» | «Черновики, фото и расходы сохраняются на устройстве» + (` (ожидают отправки: N)` при `outbox.length`) + «. Бронь, выезд и приёмка требуют подтверждения сервера.» | — |
| online и есть outbox `sending` | info · `sync` | «Связь восстановлена.» | «Отправляем сохранённые на устройстве операции…» | — |
| `usedGb ≥ quotaGb` | danger · `storage` | «Место организации заполнено.» | не-owner: «Новые загрузки ограничены. Фото текущей смены сохраняются в пределах временного резерва.» | owner: «Открыть «Модули и место»» |

### 4.5 Демо-панель (`:44–87`, `:2806–2814`, `:2458–2464`)

| Элемент | Поведение |
|---|---|
| select «Ширина»: «По окну» / «390 · телефон» / «768 · планшет» / «1440 · компьютер» | `frame`; кадр с рамкой `1px solid #C9D1C7`, радиус 22px для 390 |
| checkbox «Нет связи» | `setOnline(!checked)` → `api.setFlag('online')`; при выключении тост warn «Нет связи. Черновики сохраняются на устройстве»; при включении через 60 мс `flush()`. Также слушаются `window` `online`/`offline` (2411–2414) |
| checkbox «Конфликт брони» | `state.conflictNext` + `api.flags.conflictNext` — одноразовый: следующий `reserve`/`assignVehicle` вернёт 409 и сбросит флаг |
| checkbox «Сбой загрузки фото» | `state.failUpload` + `api.flags.failUploadNext` — одноразовый: следующая загрузка упадёт при прогрессе > 55 % |
| «Путь проверки» (`aria-expanded`) | диалог `role="dialog" aria-label="Путь проверки"`: «Основной путь» — 8 шагов с кнопкой «Перейти»; «Негативные проверки» — 7 пунктов (2921–2929) |
| «Сбросить» | `reset()` → `INITIAL()` + `boot()` |

Шаги пути (2895–2904): «Владелец: подключить «Логистику»», «Назначить Марине Котовой роль и область», «Переключиться на водителя», «Забронировать совместимую машину», «Заполнить осмотр и выехать», «Добавить расход», «Сдать машину», «Логист: принять смену». Отметки прогресса `prog[k]`: `logistics`, `assigned`, `driver`, `booked`, `departed`, `expense`, `submitted`, `accepted` (`mark()` 2435).

Негативные проверки (verbatim, 2912–2918):
1. «Несовместимая машина: Hyundai Porter и Ford Transit для Р-208 — кнопка брони недоступна, причина указана»
2. «Незавершённый осмотр: «Выехать» неактивна, показан список недостающего»
3. «Отрицательный расход: введите «-500» — ошибка «Сумма должна быть больше нуля»»
4. «Пробег при сдаче меньше начального — ошибка, сдача невозможна»
5. «Водитель: начислений нет ни в смене, ни в уведомлениях, ни в ответе mock-API»
6. «Флажок «Конфликт брони» → следующая бронь получает конфликт и предложение обновить список»
7. «Флажок «Нет связи» → расходы и сдача сохраняются на устройстве, бронь и выезд блокируются»

### 4.6 Общие примитивы

- Чип статуса `ch(label, tone, icon)` (2305): `display:inline-flex; gap:4px; padding:2px 8px 2px 6px; border-radius:999px; font-size:12px; font-weight:500; line-height:18px; white-space:nowrap`, иконка 15px; цвета `TONE` (2303): ok `#E3EFE7`/`#1F6B52`, info `#E7EEF6`/`#2B5479`, warn `#FAF1DC`/`#7A5214`, danger `#FBEAE7`/`#A13A33`, neutral `#ECEFEA`/`#4C5955`. Линии `LINE` (2304): ok `#BFD9C8`, info `#C9D8E8`, warn `#EBD7A8`, danger `#F0C9C3`, neutral `#DCE2D9`.
- Кнопка primary: `border:1px solid var(--ox-accent); background:var(--ox-accent); color:#FFFFFF; font-weight:500; border-radius:8px` (10px у крупных мобильных). Secondary: `border:1px solid #CDD5CB; background:#FFFFFF; color:#1C2A26`. Danger: `#A13A33`.
- Фильтр-пилюля: `border-radius:999px`, selected `bg var(--ox-accent) fg #FFFFFF border var(--ox-accent)`, иначе `bg #FFFFFF fg #1C2A26 border #CDD5CB`, `aria-pressed`.
- Карточка: `background:#FFFFFF; border:1px solid #DCE2D9; border-radius:12px`. Разделитель строк `#E8ECE5`. Подложка подсказок `#F8F9F6`. Mono-шрифт номера `'IBM Plex Mono'`.
- Скрытый input (92): `<input type="file" accept="image/*" capture="environment" style="display:none" aria-hidden="true" tabindex="-1">`; `onFile` → `uploadPhoto(pending.t, pending.side, file)` (2369–2373).
- `run(key, fn, okText, {quiet})` (2419–2434): `busy = key`; успех → `db = r.db`, тост ok; ошибка → `busy = null`, `db = e.db` (если код не в `quiet`), тост `e.message` (`warn` для `offline`, иначе `error`), re-throw.

---

## 5. Экран `pg.fleet` — «Рабочее место логиста» (`:428–520`, `fleetVM` `:3249–3307`)

### 5.1 Идентификатор

- Персоны: owner (scope из селекта «Область просмотра» в шапке: `ownerScope` all / `r-*` / `f-*`), manager. Гейт `logistics/view`. Только t-alta.
- Данные для owner фильтруются `scopeCovers` (3252–3255); для manager — сервером (`view()` `api.js:196–198`).

### 5.2 Раскладка

`<section aria-labelledby="h-fleet">` column gap 16:
1. Шапка: crumb 13px `#5C6964` = `fl.crumb` (owner: `scopeLabel` или «{tenant} · все подразделения» = «Альта Групп · все подразделения»; manager: «Москва / Север Логистик», 3263); `<h1 id="h-fleet">` «Рабочее место логиста» 26px/600 letter-spacing −0.02em; p «Подбор машины под рейс: доступность, грузоподъёмность, объём, длина кузова и температура.»
2. Статистика: grid `repeat(auto-fit, minmax(min(100%,150px),1fr))` gap 8; карточка radius 10, padding `12px 14px`, иконка 22px цветная, значение 20px/600 tabular, подпись 12px.
3. Пустое состояние `fl.noTrips` **или** блок `fl.hasTrips`:
   - `role="tablist" aria-label="Рейсы"` — кнопки-табы.
   - Двухколоночный flex-wrap: главная колонка `flex:999 1 560px` (список машин) и `<aside>` `flex:1 1 320px` (карточка рейса + участки). Расчётно: колонки рядом при ширине контента ≥ 896 px (кадр ≈ 952+), на 390 и 768 — в столбик.

### 5.3 Элементы

| # | Элемент | Текст / привязка | Стили | Источник |
|---|---|---|---|---|
| S1–S4 | Статистика | «свободно» `check_circle` fg `var(--ox-accent)`; «в брони или рейсе» `route` `#2B5479`; «ждут приёмки» `pending` `#7A5214`; «недоступно» `block` `#A13A33`; value = счёт `vehicle.state` ∈ [free] / [reserved,on_route] / [review] / [unavailable] | | 3256–3262 |
| E0 | Пусто (noTrips) | icon `search_off` 32px; **«В выбранной области нет рейсов»** 16px/600; «Смените область в верхней панели — рейсы демо запланированы в «Москва / Север Логистик».» | padding `36px 20px`, center | 443–445 |
| T1 | Таб рейса `role="tab" aria-selected` | строка 1 600: «{id} · {title}»; строка 2 12px `#5C6964`: «{window} · {TRIP_STATE.label}» | `min-height:52px; padding:8px 14px; radius 10; border:1.5px solid` sel `var(--ox-accent)` bg `var(--ox-accent-tint)` иначе `#DCE2D9`/`#FFFFFF` | 449–452, 3280 |
| H2 | «Подбор транспорта · {fl.trip.id}» | 16px/600 | padding `14px 18px` | 458 |
| F1–F3 | `role="group" aria-label="Фильтр"`: «Все» / «Подходят» / «Свободны» | `fleetFilter` all/fit/free; `aria-pressed` | `min-height:34px; padding:0 12px; font-size:13px` | 459–461, 3289 |
| V | Строка машины | icon 40×40 `#F2F3EF` (`ac_unit` если `temp`, иначе `local_shipping`); «{model} <mono>{plate}</mono>»; sub «{body} · {unitLabel} · {depot}» (напр. «Тент · Москва / Север Логистик · Склад № 1»); чип: `heldBy === trip.id` → «Назначена на {trip.id}» info `event_available`, иначе `VEHICLE_STATE.label` + (` · {note}`) | `padding:14px 18px; border-top:1px solid #E8ECE5`; bg `#F7FAF8` если выбрана для загрузки | 463–479, 3290–3302 |
| V-pick | Кнопка `aria-pressed` icon `stacked_bar_chart` | «Показать загрузку» / «Загрузка показана» | `min-height:36px; border:1px solid` picked `var(--ox-accent)` иначе `#CDD5CB` | 470, 3297 |
| V-assign | «Назначить на рейс» (primary) | показывается при `c.ok && !mine && canEdit`; `disabled` при `busy === 'asg:'+id` | `min-height:36px; padding:0 12px; 13px` | 471, 3299 |
| V-cannot | disabled-кнопка | «Не подходит» (`!c.fit`) / «Недоступна» | `min-height:36px; border:#CDD5CB` | 472, 3300 |
| V-checks | Чипы проверок | «{label}: {value}» + (` (нужно {need})` если `need && !ok`); icon `check`/`close` | ok: bg `#EEF5F0` fg `var(--ox-accent)`; fail: bg `#FBEAE7` fg `#A13A33`; `padding:3px 8px; radius 6; 12px` | 476, 3296 |
| E1 | Пусто по фильтру | «По фильтру машин нет. Сбросьте фильтр или запросите машину у другой фирмы через логиста региона.» | `padding:28px 18px; center; #5C6964; 13px` | 480 |
| N1 | Подвал-подсказка icon `info` | «Совместимость считается по сумме объёма и массы груза. Это не 3D-укладка и не проверка осевой нагрузки. Окончательно бронь подтверждает сервер.» | bg `#F8F9F6; 12px` | 481 |
| A1 | Карточка рейса | «{date} · {window}» 12px; h2 «{id} · {title}» 17px/600; чип `TRIP_STATE`; `<dl>`: «Груз» → «{cargo.kind} · {w} т · {v} м³»; «Требования» → «Кузов от {lengthM} м» + (« · {tempLabel}» / « · без температурного режима»); «Водитель» → `driverName` / «Не назначен»; «Машина» → «{model} · {plate}» / (driverId ? «Выберет водитель при брони или назначит логист» : «Не выбрана»); «Маршрут» → «{n} точка/точки/точек · {distanceKm} км» | padding 18 | 484–494, 3281–3287 |
| A1-btn | «Найти водителя в пуле» icon `person_search` (secondary, min-height 40) | при `noDriver` → `setPage('pool')` | | 493, 3288 |
| A2 | «Маршрут и загрузка по участкам» h3 15px/600; sub = `legFor` | «Для {model} · {volumeM3} м³ · {payloadT} т. Объём и масса считаются раздельно.» / «Выберите машину, чтобы увидеть загрузку» | | 496, 3304 |
| A2-leg | `<li>` grid `44px minmax(0,1fr)` | время tabular 13px; «{n}. {name}» 13px/500; op «Погрузка +{v} м³ · {w} т» / «Выгрузка −{v} м³ · {w} т» (минус U+2212); при `hasVehicle` две полосы «Объём»/«Масса» 6px bg `#ECEFEA`, ширина `min(100,pct)%`, цвет >100 `#A13A33`, >90 `#B7791F`, иначе accent; проценты tabular справа; «В кузове после точки: {vAfter} м³ · {wAfter} т» | | 498–512, 3274–3277 |
| A2-nav | disabled «Передать в навигатор · интеграция не подключена» | | `border:0; background:transparent; 13px` | 514 |

### 5.4 Логика и данные (`:3264–3306`)

- `trip = trips.find(id === fleetTrip) || trips[0]`; `INITIAL.fleetTrip = 'Р-208'` (2349). Клик по табу: `fleetTrip = id, fleetPick = null`.
- `canEdit = can(db, mid, 'logistics', 'edit', trip.unit).ok && !restricted && trip.status ∈ {planned, assigned}`.
- Сортировка машин: `heldBy === trip.id` первыми, затем `c.ok`, затем `c.fit`.
- `pick = vehicles[fleetPick] || assigned || первая с c.ok || null`.
- `assignVehicle(tid, vid)` → `run('asg:'+vid, api.assignVehicle, 'Машина назначена на рейс ' + tid, {quiet:['conflict']})`; при `conflict`: `conflictNext=false`, тост error «Конфликт: {message}», `refresh()`.
- `api.assignVehicle` (464–471): `assertActive` → `subscription_restricted`; `assertCan('logistics','edit',t.unit)`; `conflictNext` → машина становится `reserved/heldBy 'other'/note 'другой рейс'` + `ApiError('conflict', 'Машину только что забронировали. Обновите список.')`; `!c.ok` → `ApiError('incompatible', 'Нельзя назначить: ' + reasons.join('; '))`; успех: прежняя машина рейса освобождается, `t.vehicleId = v.id`, `planned → assigned`, `v.state='reserved', heldBy=t.id`.
- Расчётные значения для seed (Р-208, cargo 1,1 т / 12 м³ / 3 м / без температуры): v1 ГАЗель Next ok; v6 Mercedes Sprinter ok; v2 Ford Transit — «Объём: 11 м³ (нужно от 12 м³)»; v3 Hyundai Porter — «Грузоподъёмность: 0,9 т (нужно от 1,1 т)», «Объём: 9 м³ (нужно от 12 м³)»; v4 ГАЗон Next — «Доступность: Недоступна · Плановое ТО до 03.10». Для Р-211 (temp [2,6]) — только v2 проходит температуру: «Температура: -18…+8 °C», остальные «Температура: без охлаждения (нужно +2…+6 °C)».
- Участки для v1 (16 м³ / 1,5 т): после точки 1 — 12 м³ (75 %) · 1,1 т (73 %); точка 2 — 4 м³ (25 %) · 0,4 т (27 %); точка 3 — 0 м³ (0 %) · 0 т (0 %).

---

## 6. Экран `pg.pool` — «Ресурсный пул» (`:522–564`, `poolVM` `:3309–3328`)

- Персоны owner/manager; гейт `logistics/edit`; t-alta. Рейс для запросов — всегда `'Р-211'` (или первый) (3311).
- Шапка: crumb «Москва / межфирменный ресурсный пул»; `<h1 id="h-pool">` «Ресурсный пул»; p «Свободные водители других фирм группы. Показан минимум сведений, разрешённый владеющей фирмой. Запрос не даёт доступа до одобрения.»
- Раскладка: колонка карточек `flex:999 1 480px` + `<aside>` `flex:1 1 280px` bg `#F8F9F6`.

| Элемент | Текст / привязка | Источник |
|---|---|---|
| Карточка водителя `<article>` | аватар 42px круг `#ECEFEA`/`#4C5955` icon `person`; `<strong>{code}</strong>` («Водитель #104»); «{qual} · {home}» («Кат. C · рефрижератор · Юг Транс»); чип | 532–537 |
| Чип статуса | pending → «Запрос отправлен» warn `schedule`; approved → «Временно назначен» ok `verified`; declined → «Отклонён» neutral `block`; иначе «Свободен» ok `check_circle` | 3316 |
| `<dl>` | «Свободен» → `window` («13:00–19:00»); «Условия» → `terms` («По соглашению фирм группы») | 538–541 |
| Кнопка primary min-height 40 | «Запросить на рейс {trip.id}» — при `canRequest = (free|declined) && !busy && !trip.driverId` | 535, 3311 |
| pending box `role="status"` bg `#FAF1DC` fg `#7A5214` icon `schedule` | «Ожидает решения менеджера фирмы {home}. Доступа к водителю пока нет.»; ниже «Демо: ответ фирмы-владельца» + кнопки «Одобрить» / «Отклонить» (secondary, min-height 36) | 543–546 |
| approved box `role="status"` bg `var(--ox-accent-soft)` icon `verified` | «{code} назначен на рейс {tripId} до {until}. Доступ ограничен этим рейсом; история и начисления остаются в фирме {home}.» | 547, 3321 |
| declined box bg `#ECEFEA` fg `#4C5955` icon `block` | «Запрос отклонён. Можно запросить другого водителя.» | 548 |
| aside h3 «Что скрыто в пуле» | список `visibility_off`: «ФИО и личный телефон — до одобрения», «Ставки и начисления другой фирмы», «История рейсов и текущие задания», «Документы сверх согласованного объёма»; p «После одобрения создаётся временное назначение на конкретный рейс со сроком. История и начисления остаются в домашней фирме.» | 552–561 |

Модалка `request` (2264–2272, 4036): h2 «Запросить водителя»; sub «{code} · {home}»; `<dl>` «Рейс» → «{id} · {title} · {window}» («Р-211 · Охлаждённая продукция · 14:00–18:00»); «Срок» → «Временно, до 18:00 01.10»; «Согласует» → «Менеджер фирмы {home}»; textarea «Комментарий для фирмы-владельца» placeholder «Необязательно»; info bg `#F8F9F6` «После одобрения создаётся временное назначение только на этот рейс. История и начисления водителя остаются в его фирме.»; кнопки «Отмена» / «Отправить запрос» (disabled при busy).

Взаимодействия:
- «Отправить запрос» → `run('req', api.requestDriver({driverId, tripId, comment}), 'Запрос отправлен фирме {home} · уведомления в демо не отправляются')` (2794). Сервер (541–546): `assertActive`, `assertCan('logistics','edit', t.unit)`, повтор pending → `conflict` «Запрос уже отправлен»; push `{id:'qN', status:'pending', home, at}`.
- «Одобрить»/«Отклонить» → `api.decideRequest(q.id, bool)` (547–552): approved → `t.driverId = d.id`, `driverName = code + ' · временно'`, `q.until = '18:00 01.10'`; событие «Запрос водителя {code} одобрен фирмой {home}» / «… отклонён фирмой …». Тосты: «Фирма {home} одобрила запрос (демо)» / «Фирма {home} отклонила запрос (демо)» (3323–3324).
- `busy` (3317): если на этот рейс уже есть approved — кнопки запроса скрыты у всех.

---

## 7. Экран `pg.review` — «Приёмка смен» (`:566–662`, `reviewVM` `:3330–3382`)

### 7.1 Идентификатор и раскладка

- Персоны owner/manager; гейт `logistics/review`; t-alta. Бейдж в меню = число `submitted + defect_review`.
- Шапка: crumb `rv.crumb`; `<h1 id="h-rev">` = `top.reviewTitle` (по умолчанию «Приёмка смен»); p «Фото до и после, пробег, дефекты и расходы. Машина возвращается в пул свободных только после приёмки.»
- Пусто (`rv.empty`, 573–580): круг 56px `var(--ox-accent-soft)` icon `fact_check`; «Нет смен на проверке» 17px/600; «Когда водитель сдаст машину, смена появится здесь. В демо переключитесь на водителя и пройдите смену.»; кнопка «Демо: открыть как водитель» → `go('driver','today')`.
- Есть: flex-wrap: очередь `flex:1 1 260px; max-width: 320px (w ≥ 1080) | 100%` + детали `flex:999 1 520px`.

### 7.2 Очередь (`:584–589`, `:3335–3342`)

Порядок: `defect_review` → `submitted` → `rework` → `accepted`. Кнопка `aria-pressed`: `<strong>` «{id} · {driverName|водитель}»; чип `TRIP_STATE`; sub «{model} · {plate}» / «Машина снята с рейса». Выбранная: border `1.5px var(--ox-accent)` bg `var(--ox-accent-tint)`. Клик → `revSel = id`, `rev = {comment:'', steps:{}, err:null}`.

### 7.3 Карточка дефекта (`rv.isDefect`, `:592–602`)

`role="alert"`, border `1.5px solid #F0C9C3`, padding 20: круг 44px `#FBEAE7`/`#A13A33` icon `report`; h2 «Критический дефект · {model} {plate}»; sub «{id} · {driverName} · осмотр в {dep.at}»; p `<strong>{zone}:</strong> {text}`; p «Выезд заблокирован до решения. Машина недоступна для броней. Чек-лист приложения не заменяет обязательный технический допуск.»; кнопки: «Дефект некритичный — разрешить выезд» (secondary) и «Подтвердить неисправность» (bg/border `#A13A33`, fg `#FFFFFF`).

`decideDefect(tid, 'allow'|'confirm')` → `run('defect', api.decideDefect, 'Выезд разрешён' | 'Неисправность подтверждена, машина снята с рейса')` (2784–2786). Сервер (488–499): `assertCan('logistics','review')`; allow → все `dep.defects` получают `critical:false, downgraded:true`, trip `on_route`, `defect=null`, машина `on_route`, событие водителю «Менеджер разрешил выезд: дефект признан некритичным»; confirm → машина `unavailable`, note «неисправность подтверждена», `heldBy=null`; trip `planned`, `vehicleId=null`, `dep=null`; событие водителю «Неисправность подтверждена. Выберите другую машину для рейса {id}».

### 7.4 Карточка смены (`rv.isShift`, `:603–657`)

| Блок | Содержимое | Источник |
|---|---|---|
| Шапка | sub «{driverName} · {model} {plate}» 12px; h2 «{id} · {title}» 18px/600; чип `TRIP_STATE` | 605, 3358 |
| Статистика grid `minmax(min(100%,130px),1fr)` | «Пробег при выезде» → «{int(dep.odometer)} км» / «—»; «При сдаче» → ret; «Пройдено» → «{int(ret−dep)} км»; «Топливо» → «{FUEL[dep]} → {FUEL[ret]}» (отсутствующее — «—») | 606–608, 3359–3364 |
| «Фото до и после» h3 | заголовки колонок grid `84px 1fr 1fr`: «» / «Перед выездом» / «При сдаче»; строки по `SIDES` («Спереди», «Сзади», «Слева», «Справа», «Одометр»); миниатюра `aspect-ratio:16/10` bg `#EEF1EC` border `#DCE2D9`, `background-image` = `url(...)` / `STRIPES` / `none`; тег mono 11px: «фото» (есть url) / «демо-фото» (нет url) / «нет» | 610–620, 3351–3352, 3365 |
| «Осмотр и дефекты» h3 | строки `check_circle` accent: «Осмотр перед выездом: чек-лист заполнен», «Осмотр при сдаче: чек-лист заполнен» (если ret); дефекты: «{zone} · {text} · при выезде|при сдаче» + (« · признан некритичным» если `downgraded`), icon `report`/`build`, bg `#FBEAE7`/`#FAF1DC`, fg `#A13A33`/`#7A5214`; «Дефекты не отмечены»; «Комментарий водителя: {comment}» (bg `#F8F9F6`) | 615–621, 3346, 3357–3359 |
| «Расходы в пути» h3 | строка: icon `EXPENSE_CAT.icon`, label «{Топливо|Мойка}» + (« · {liters} л»), meta «{dd.mm.yyyy}» + (« · {comment}») + « · чек приложен», сумма `rub`; «Расходов нет»; итог «Итого заявлено» + `rub(total)` | 622–627, 3360–3361 |
| Начисление (`showEarn`) | bg `#FFFCF4` border `#EBD7A8`; icon `lock` `#7A5214`; «Начисление водителю за рейс»; «Видно владельцу и менеджеру с правом fleet.earnings.read в своей области. Водителю не показывается и не передаётся.»; сумма 20px/600 (`rub(earnings)` — для Р-208 «4 500 ₽») | 636–641, 3371 |
| «Решение» (`canDecide` = status `submitted` && `can(review, unit)`) | textarea «Замечания для водителя» rows 3 placeholder «Например: переснимите фото слева — не виден бампер» 16px; fieldset legend «Что вернуть на доработку»: чекбокс-чипы `REV_STEPS` «Фото при сдаче», «Пробег», «Расходы», «Чек-лист и дефекты» (`min-height:38px`, checked bg `#FAF1DC` border `#D9B76A`, иначе `#FFFFFF`/`#DCE2D9`); ошибка `role="alert"` icon `error` `#A13A33`; кнопки «Вернуть на доработку» (icon `undo`, secondary, min-height 44) и «Принять смену» (icon `check`, primary); обе `disabled` при `busy === 'rev'` | 642–655, 3372–3376 |
| Итог (`decided`) `role="status"` | accepted: чип ok `verified`, «Смена принята в {review.at}. Машина вернулась в пул свободных.»; rework: чип warn `undo`, «Возвращено водителю: «{comment}». Исправить: {steps}.» | 656, 3377–3379 |

### 7.5 Взаимодействия приёмки

- «Принять смену» → `accept(tid)` (2764–2776) открывает confirm: tone ok, icon `verified`, title «Принять смену {id}?», text «Осмотр, пробег и расходы будут подтверждены.», раздел «Что произойдёт»: `local_shipping` (ok) «Машина вернётся в пул свободных»; `receipt_long` (info) «Расходы станут принятыми; кассовые операции создаются отдельно»; при `earnings != null` `lock` (warn) «Будет создано начисление водителю. Его видят владелец и уполномоченный менеджер»; confirmLabel «Принять смену» (busy → «Выполняем…»). Подтверждение → `run('rev', api.reviewTrip(tid, {decision:'accept', comment}), 'Смена принята. Машина вернулась в пул')` → `modal=null`, `rev` сброшен, `mark('accepted')`.
- «Вернуть на доработку» → `rework(tid)` (2777–2783): пустой comment → `rev.err = 'Опишите, что нужно исправить'`; нет steps → `'Отметьте хотя бы один раздел для доработки'`; иначе `run('rev', api.reviewTrip(tid, {decision:'rework', comment, steps: [подписи]}), 'Смена возвращена водителю на доработку')`.
- Сервер `reviewTrip` (520–537): `assertCan('logistics','review',t.unit)`; `status !== 'submitted'` → `conflict` «Смена уже обработана»; rework: те же тексты валидации, `status='rework'`, `review={decision, comment, steps, at}`, событие водителю «Смена {id} возвращена на доработку: {comment}»; accept: `status='accepted'`, `review={decision:'accept', comment, at}`, машина `free`, `heldBy=null`, `v.odometer = t.ret.odometer`, `earnings.push({id:'nN', tripId, unit, member: driverId, amount: t.earnings, status:'Начислено'})`, событие водителю и проверяющим «Смена {id} принята. Машина свободна.», чувствительное событие «Начисление по рейсу {id}: {rub}» (`sensitive:'earnings'`, видно только `canEarnings`).

---

## 8. Экран `pg.today` — «Моя смена» (`:663–848`, `driverVM` `:3422–3530`)

### 8.1 Идентификатор

- Персона driver (`MEMBER.driver = 'm-vasiliev'`), пункт меню «Сегодня», гейт `logistics/view`, t-alta. `myTrip()` = первый trip с `driverId === 'm-vasiliev'` (2554) — Р-208.
- При отсутствии рейса `driverVM` возвращает пустой `dr` (3425) — экран показывает только заголовок и пустую карточку (⚠ отдельного текста «нет рейса» в источниках нет).

### 8.2 Раскладка

Одна колонка `max-width:680px`, `<section aria-labelledby="h-today">` gap 14. Сверху вниз: шапка → шаги → карточка рейса → блоки по состоянию → sticky-панель действия (`position:sticky; bottom:0; z-index:3`).

### 8.3 Постоянные элементы

| Элемент | Текст / стиль | Источник |
|---|---|---|
| crumb | «Илья Васильев · среда, 1 октября» (жёстко в шаблоне) | 665 |
| `<h1 id="h-today">` | «Моя смена» | 665 |
| `<ol aria-label="Этапы смены">` 5 шагов | «Машина», «Осмотр», «Рейс», «Сдача», «Приёмка»; круг 30px 13px/600: done bg `var(--ox-accent)` fg `#FFFFFF` icon `check` 18px; current bg `var(--ox-accent-soft)` fg accent border accent, `aria-current="step"`, подпись accent/600; остальное bg `#FFFFFF` fg `#6B7873` border `#CDD5CB` номер; индекс: planned/assigned 0, inspection/defect_review 1, on_route 2, returning/rework 3, submitted 4, accepted 5 | 666–673, 3435–3439 |
| Карточка рейса | `<strong>` «{id} · {title}» 15px/600 + чип `TRIP_STATE`; meta «{date} · {window} · {n} точка/точки/точек · {km} км · {cargo.kind}» (для seed: «01.10.2026 · 09:00–13:00 · 3 точки · 46 км · Сухой груз · 14 паллет-мест»); чипы требований bg `#F2F3EF` 12px: `scale` «от {w} т», `deployed_code` «от {v} м³», `straighten` «кузов от {l} м», `thermostat` «{tempLabel}» / «без охлаждения» | 674–678, 3442–3450 |

### 8.4 Состояние «Машина» (`dr.sPlanned`: planned/assigned, `:680–698`)

| Элемент | Условие | Текст / стиль | Источник |
|---|---|---|---|
| Alert «Конфликт брони» | `state.conflict` | `role="alert"` bg `#FBEAE7` fg `#A13A33` border `#F0C9C3` icon `sync_problem` 22px; `<strong>` «Конфликт брони»; текст `e.message`; кнопка «Обновить список» icon `refresh` (border/fg `#A13A33`, min-height 44) disabled при `busy==='refresh'` | 681, 3451 |
| Status «blocked» | `blockedText` непуст | `role="status"` bg `#FAF1DC` fg `#7A5214`; icon `cloud_off` (офлайн) / `lock_clock`; текст: «Нет связи: бронь требует подтверждения сервера.» / «Пробный период организации завершён: новые брони недоступны.» / «Модуль «Логистика» отключён: новые брони недоступны.» | 682, 3446, 3452 |
| h2 «Выберите машину» + «Машины вашей фирмы. Неподходящие отмечены с причиной.» | | | 683 |
| Карточка машины `<article>` | по `carCards(db, trip, blocked, 'all')` | border `1.5px` `#BFD9C8` (canBook) / `#DCE2D9`; icon 44×44 `#F2F3EF`; model 15px/600; plate mono 13px `#3A4844`; specs «{body} · {payload} т · {volume} м³ · кузов {length} м» + (« · {tempLabel}»); чип: `mine` → «Назначена логистом» (assigned) / «Ваша бронь» info `event_available`, иначе `VEHICLE_STATE` | 684–690, 3406–3413 |
| Причины | `c.reasons.length` | `<ul>` bg `#FBEAE7` fg `#A13A33` 13px, `<li>` icon `close` + «{label}: {value}, нужно {need}» | 691, 229 |
| «Подходит рейсу: масса, объём, длина и температура» | `c.ok && planned` | icon `check_circle` accent 13px | 692 |
| Кнопка брони (primary) | `canBook = planned && c.ok && !blocked` | icon `event_available`; `width:100%; min-height:52px; 16px`; label `busy` → «Проверяем на сервере…», `mine` → «Подтвердить бронь», иначе «Забронировать»; disabled при `busy==='res:'+id` | 693, 3414–3415 |
| disabled-кнопка | `noBook` | `min-height:48px; 15px`; label: `!planned` → (`mine` «Машина в вашей смене» / «Смена уже идёт»); `!c.fit` → «Не подходит рейсу»; `!checks[0].ok` → «Недоступна»; иначе «Бронь недоступна» (т.е. blocked) | 694, 3416 |
| Пусто `dr.noCars` | sPlanned и ни одной `c.ok` | border `1px dashed #C3CCC1`; icon `no_crash` 32px; «Нет подходящих свободных машин»; «Обновите список позже или обратитесь к логисту — он может назначить машину другой фирмы через пул.»; кнопка «Обновить список» icon `refresh` | 697, 3453 |

Сортировка карточек: `canBook` desc, затем `c.fit` desc (3419).

`reserve(vid)` (2555–2566): офлайн → тост error «Бронь требует связи с сервером»; `conflict=null`; `run('res:'+vid, api.reserve(trip.id, vid), 'Бронь подтверждена сервером. Начните осмотр', {quiet:['conflict']})`; успех → `dep = emptyInsp()`, `ret=null`, `stops={}`, страница driver `today`, `mark('booked')`; `conflict` → `state.conflict = {text: e.message}`, `conflictNext=false` (список **не** обновляется до «Обновить список»).

`api.reserve` (446–458, задержка 600 мс): `assertActive` (`subscription_restricted` «Пробный период завершён: новые операции недоступны. История доступна для чтения.»); модуль выключен → `module_off` «Модуль «Логистика» отключён»; `assertCan('logistics','create', v.unit)`; `conflictNext` → `v.state='reserved', heldBy='other', note='другой рейс'`, `ApiError('conflict','Машину только что забронировал другой сотрудник. Список на экране устарел.')`; машина не free и не наша → `conflict` «Машина уже недоступна. Обновите список.»; `!c.fit` → `incompatible` «Машина не подходит рейсу: {reasons; }»; успех: `t.vehicleId`, `status='inspection'`, `reservedUntil='09:30'`, `v.state='reserved'`, `heldBy=t.id`, `note=null`; событие проверяющим «Илья Васильев забронировал {model} {plate} на рейс {id}».

`refresh()` (2567–2572): `busy='refresh'`, `api.load(450)`, `conflict=null`, тост «Список обновлён».

### 8.5 Баннеры состояний осмотра/доработки/дефекта

| Условие | Разметка | Текст | Источник |
|---|---|---|---|
| `dr.sInsp` (inspection) | `role="status"` bg `var(--ox-accent-soft)` fg accent icon `cloud_done` | «Бронь подтверждена сервером · {model} {plate} · держится до {reservedUntil|09:30}»; кнопка-ссылка «Отменить бронь» (underline, accent, 607) → `cancelRes()` | 693–695, 3445 |
| `dr.rework.show` (rework) | `role="alert"` bg `#FAF1DC` fg `#7A5214` border `#EBD7A8` icon `undo` 22px | `<strong>` «Менеджер вернул смену на доработку»; ««{review.comment}»»; «Исправить: {steps через ', '}» | 703–705, 3455 |
| `dr.sDefect` (defect_review) | `role="alert"` border `1.5px #F0C9C3`; круг 52px `#FBEAE7`/`#A13A33` icon `report` 28px | h2 «Выезд заблокирован»; p «Критический дефект «{zone}: {text}» отправлен менеджеру на проверку. Машина недоступна для выезда.»; p 13px «Менеджер может разрешить выезд, если дефект некритичный, или снять машину с рейса.»; кнопка «Выбрать другую машину» (secondary, min-height 48) → `cancelRes()` | 706–714, 3456 |

`cancelRes()` (2573–2576): `run('cancel', api.cancelReservation, 'Бронь отменена. Машина вернулась в пул')` → `dep=null`. Сервер (459–463): если машина `heldBy === t.id` и `reserved` → `free`; `heldBy=null`; trip `planned`, `vehicleId=null`, `defect=null`.

### 8.6 Состояние «Рейс» (`dr.sRoute`: on_route, `:716–729`)

Карточка: h2 «Маршрут» + «Отмечено {done} из {total}» 13px; `<ol>` остановок: круг 30px (`✓` или номер; done bg accent fg white, иначе bg `var(--ox-accent-soft)` fg accent); name 500; «{time} · погрузка {v} м³ | выгрузка {v} м³»; кнопка `aria-pressed` «Прибыл» / «Отменить» (secondary, min-height 44, 13px) → `state.stops[i]` toggle (только клиент, на сервер не уходит). Seed: «Склад № 1, Лобня» «09:00 · погрузка 12 м³»; «Химки, ул. Заводская, 8» «10:15 · выгрузка 8 м³»; «Долгопрудный, Лихачёвский пр., 4» «11:30 · выгрузка 4 м³».

Sticky-панель в этом состоянии (3508): note icon `info` «После завершения рейса нужен осмотр при сдаче.»; кнопка «Завершить рейс» icon `flag`, disabled при `busy==='finish'`.

`finishRoute()` (2586–2596): confirm tone info icon `flag`, title «Завершить рейс {id}?», text «Дальше — осмотр при сдаче: 5 фото, пробег, топливо и чек-лист.», при `done < total` раздел «Внимание» с item `warning` (warn) «Отмечено точек: {done} из {total}. Убедитесь, что доставка выполнена.», confirmLabel «Завершить рейс» → `run('finish', api.finishRoute, 'Рейс завершён. Заполните осмотр при сдаче')` → `modal=null`, `ret = ret || emptyInsp()`. Сервер (508): `assertLogisticsFor(t,'create')`, `status='returning'` (350 мс).

### 8.7 Блок осмотра (`dr.showInsp` = sInsp || sReturn, `:731–779`, `:3474–3506`)

`t = sInsp ? 'dep' : 'ret'`; `d = state[t] || emptyInsp()`; `minOdo = dep ? veh.odometer : (trip.dep?.odometer ?? veh.odometer)`.

| Элемент | Текст / привязка | Стили | Источник |
|---|---|---|---|
| h2 `ins.title` | «Осмотр перед выездом» / «Осмотр при сдаче»; sub «{model} · {plate} · фото, пробег, топливо, чек-лист» / «… · сравнение с выездом» | 18px/600 | 733, 3483 |
| `<fieldset><legend>` | «Фото · {photoCount} из 5», `photoCount` = число слотов в `ready` или `queued` | 600 | 735, 3484 |
| Сетка слотов | `grid-template-columns:repeat(auto-fill,minmax(98px,1fr)); gap:8px` (расчётно ≈3 колонки на 390, 5 на ≥768) | | 736 |
| Слот `<button aria-label="{label}: {status}. Нажмите, чтобы снять или выбрать фото">` | `aspect-ratio:1/1; radius 10; border = MAP; background-color:#F4F6F2; background-image = url|STRIPES|none; color = fg`; иконка 26px (если нет url); подпись 13px/600 с подложкой `rgba(255,255,255,.9)` при наличии url; прогресс-полоса 5px (`uploading`) `rgba(255,255,255,.8)` + accent fill `pW`; бейдж `ready` 22px круг accent с `check` 16px (top/right 6px) | | 732–737, 3386–3390 |
| Строка статуса 12px | icon `stIcon` 14px + `status`, цвет `stFg` | | 745 |
| «Повторить» | только `failed`; `min-height:36px; border:1px solid #A13A33; color:#A13A33; 13px/500` → `uploadPhoto(t, k, null)` | | 746 |
| «Демо: добавить фото» icon `add_photo_alternate` (secondary, min-height 44) | → `demoAll(t)`; подсказка 12px «Нажмите на слот, чтобы снять камерой или выбрать файл. Файлы остаются в браузере.» | | 750 |
| `<label>` «Пробег по одометру, км» | `<input inputmode="numeric" aria-invalid aria-describedby="odo-hint" placeholder="{int(minOdo)}">` (для v1 «84 370», разделитель — неразрывный пробел `toLocaleString('ru-RU')`); `min-height:48px; 18px tabular; border:1.5px` `#A13A33` (ошибка) / `#CDD5CB`; `onOdo` оставляет только цифры и пробелы | | 753–755, 3485–3487 |
| `<span id="odo-hint">` 12px | `odoErr` **или** dep: «Последний зафиксированный пробег: {int} км», ret: «Пробег при выезде: {int} км — значение не может быть меньше»; цвет `#A13A33` при ошибке, иначе `#5C6964` | | 755, 3487 |
| fieldset «Уровень топлива» | 4 кнопки `aria-pressed` «¼» «½» «¾» «Полный» (ключи `q h tq f`); `flex:1; min-height:48px; border:1.5px; 600`; selected bg accent fg `#FFFFFF` | | 757–759, 3488 |
| fieldset «Чек-лист» | `<label>` `min-height:50px; radius 10; border #DCE2D9`, bg `var(--ox-accent-tint)` если checked; `<input type="checkbox">` 22px accent; dep: «Кузов и стёкла осмотрены», «Шины и световые приборы исправны», «Документы и комплект на месте»; ret: «Груз выгружен полностью», «Личные вещи забраны», «Ключи и документы на месте» | | 761–763, 3489; `models.js:159–160` |
| «Дефекты» + «Добавить дефект» (icon `add`, accent текст, min-height 44, виден если `!df`) | «Не отмечены» если пусто и форма закрыта | | 765–766, 3491 |
| Строка дефекта | icon `report`/`build` 20px; zone 500; text 13px; при `critical` «Критический — выезд невозможен» 12px/600 `#A13A33`; кнопка `aria-label="Удалить дефект"` icon `delete` 40×40; стили critical: fg `#A13A33` bg `#FBEAE7` border `#F0C9C3`; иначе fg `#7A5214` bg `#FFFCF4` border `#EBD7A8` | | 767, 3490 |
| Форма дефекта `df.open` | bg `#F8F9F6` border `#DCE2D9` radius 10 padding 14: `<label>` «Где» `<select>` из `DEFECT_ZONES` («Кузов», «Стёкла», «Шины и колёса», «Световые приборы», «Салон», «Грузовой отсек», «Тормоза и ходовая») min-height 48; `<label>` «Описание» textarea rows 2 placeholder «Например: трещина на лобовом стекле справа», `aria-invalid`, border `1.5px` `#A13A33`/`#CDD5CB`; ошибка `role="alert"` «Опишите дефект»; только dep: чекбокс «Критический — машина не может выехать» (border `#F0C9C3`, `accent-color:#A13A33`, min-height 48); кнопки «Отмена» / «Добавить» (min-height 44) | | 768–775, 3495–3497, 2630–2636 |
| Только ret: `<label>` «Комментарий для менеджера» | textarea rows 2 placeholder «Необязательно» → `ins.comment` | | 777, 3492 |

### 8.8 Sticky-панель действия (`act.*`, `:839–846`, `:3501–3506`)

`padding:12px; radius 14; bg #FFFFFF; border #DCE2D9; box-shadow 0 -6px 20px rgba(28,42,38,.10)`:

| Строка | Условие | Текст |
|---|---|---|
| `hasMissing` icon `pending` `#7A5214` | `missing.length > 0` | «Осталось: {missing через ', '}» — из `inspMissing`: «{n} фото», «пробег», «пробег не меньше {int} км», «уровень топлива», «{n} пункт/пункта/пунктов чек-листа». Начальное: «Осталось: 5 фото, пробег, уровень топлива, 3 пункта чек-листа» |
| `critical` icon `report` `#A13A33` | dep и есть critical-дефект | «Отмечен критический дефект. Выезд будет заблокирован, осмотр уйдёт менеджеру.» |
| `hasNote` icon `cloud_off` `#5C6964` | офлайн | dep: «Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.»; ret: «Нет связи: сдача сохранится на устройстве и отправится позже. До подтверждения сервера машина не считается сданной.» |
| Кнопка `width:100%; min-height:54px; 16px/600`, icon 22px | `disabled = missing.length>0 || busy || (dep && !online)`; bg `critical ? #A13A33 : accent` | label: busy «Отправляем…»; dep: critical «Отправить на проверку менеджеру» (icon `report`) / «Выехать на маршрут» (icon `play_arrow`); ret: online «Сдать машину» / «Сохранить сдачу на устройстве» (icon `assignment_return`) |

`submitDep()` (2577–2585): офлайн → тост warn «Выезд требует подтверждения сервера. Черновик осмотра сохранён на устройстве»; `run('dep', api.submitDeparture(trip.id, inspPayload('dep')))` → `r.data === 'blocked'` → тост warn «Выезд заблокирован: дефект отправлен менеджеру»; иначе тост ok «Выезд подтверждён сервером», `mark('departed')`.

`api.submitDeparture` (472–487, 650 мс): `assertLogisticsFor(t,'create')`; `inspMissing(payload,'dep', v.odometer)` непуст → `validation` «Осмотр не завершён: …»; не все фото `ready` → `validation` «Не все фото загружены на сервер»; `t.dep = {odometer: Number, fuel, defects, photos, at}`; `recordInspection` (ответ формы «Осмотр машины» R-NNNN + задача «Проверить осмотр {id} (выезд)» Марине Котовой, приоритет `urgent` при critical, 65–77); critical → `status='defect_review'`, `t.defect = critical[0]`, `v.state='unavailable'`, `v.note='критический дефект на проверке'`, событие «Критический дефект: {model} {plate} — {zone}. Выезд заблокирован.» → `'blocked'`; иначе `status='on_route'`, `v.state='on_route'`, событие «Рейс {id} начат · {model}» → `'started'`.

`submitRet()` (2597–2606): офлайн → в `outbox` (заменяя прежний `return`) `{opId:'op-'+Date.now(), kind:'return', tripId, label:'Сдача машины', state:'local'}`, тост warn «Сдача сохранена на устройстве и ещё не принята сервером»; онлайн → `run('ret', api.submitReturn(trip.id, {...inspPayload('ret'), opId}), 'Сдача принята сервером. Ожидайте приёмки')`, `mark('submitted')`.

`api.submitReturn` (509–519, 650 мс): `assertLogisticsFor`; повтор `opId` → `'duplicate'`; `inspMissing(payload,'ret', t.dep.odometer)` → `validation` «Сдача не завершена: …»; фото не `ready` → «Не все фото загружены на сервер»; `t.ret = {…, comment, at}`; `recordInspection(ret)`; `status='submitted'`, `v.state='review'`, `review.resolved=true` если был rework; событие «Смена {id} сдана на приёмку · {model} {plate}».

`inspPayload(t)` (2508–2513): `photos[k] = {state, fileId|null, url|null, demo}`, `odometer` без пробелов (строка), `fuel`, `checks`, `defects`, `comment`.

### 8.9 Блок «Расходы» (`dr.showExp` = sRoute || sReturn, `:781–811`, `:3462–3467`, `:3512–3525`)

| Элемент | Текст / привязка | Источник |
|---|---|---|
| h2 «Расходы» + «Добавить расход» (icon `add`, secondary, min-height 44; виден при `!exp`) | → `openExp()` | 783, 2607 |
| «Расходов пока нет» | нет ни серверных, ни локальных | 784 |
| Строка расхода | icon-бокс 38×38 `#F2F3EF`; «{label} · {amount}» 500; meta 12px; чип | 785 |
| Серверный расход | label `EXPENSE_CAT.label`; amount `rub`; meta «{dd.mm.yyyy}» + (« · {comment}») + « · чек приложен»; чип «Принято сервером» ok `cloud_done` | 3462 |
| Локальный (outbox) | meta «Локальный черновик»; чип: `sending` → «Отправляется» info `sync`; `error` → «Ошибка» danger `error`; иначе «На устройстве» warn `cloud_off` | 3463 |
| Форма `ex.open` bg `#F8F9F6` | legend «Категория»: кнопки `aria-pressed` «Топливо» (`local_gas_station`) / «Мойка» (`local_car_wash`), `flex:1; min-height:48px; border:1.5px; 600`; `<label>` «Сумма, ₽» `<input inputmode="decimal" placeholder="0" aria-invalid>` 18px tabular border `1.5px` `#A13A33`/`#CDD5CB` + ошибка `role="alert"`; `<label>` «Дата» `<input type="date">` (по умолчанию `2026-10-01`) + ошибка; только «Топливо»: `<label>` «Литры» `<input inputmode="decimal" placeholder="Необяз.">`; `<label>` «Комментарий» `<input placeholder="Например: АЗС на Ленинградском шоссе">`; чек: кнопка 88×88 `aria-label="Чек: {status}. Нажмите, чтобы снять или выбрать фото"` (стили как у слота, иконка 28px), рядом «Фото чека» 500 + статус 12px, кнопки-ссылки «Повторить» (`#A13A33`, при failed) и «Демо-фото чека» (accent) → `uploadPhoto('exp','receipt',null)`; ошибка чека `role="alert"`; кнопки «Отмена» / `saveLabel` (busy «Отправляем…» / online «Сохранить расход» / «Сохранить на устройстве»), min-height 48 | 786–809, 3514–3524 |

`openExp()` (2607): `{category:'fuel', amount:'', date:'2026-10-01', liters:'', comment:'', receipt:{state:'empty'}, err:{}, tried:false}`. `patchExp` перевалидирует после первой попытки (`tried`).

`saveExp()` (2616–2629): `validateExpense` → ошибки под полями; `label = EXPENSE_CAT.label + ' ' + rub(amount)` (напр. «Топливо 2 500 ₽»); офлайн **или** `receipt.state === 'queued'` → `outbox.push({opId, kind:'expense', tripId, label, payload:{...e}, state:'local'})`, `exp=null`, тост warn «Расход сохранён на устройстве. Отправится при появлении связи»; иначе `run('exp', api.addExpense(trip.id, {...e, opId}), 'Расход принят сервером')` → `exp=null`, `mark('expense')`; `validation` с сервера → `err.amount = message`.

`validateExpense` (`models.js:378–389`): amount '' → «Укажите сумму»; NaN → «Сумма должна быть числом»; ≤ 0 → «Сумма должна быть больше нуля»; > 200 000 → «Больше 200 000 ₽ — проверьте сумму»; нет даты → «Укажите дату»; чек `uploading` → «Дождитесь окончания загрузки чека»; чек не `ready|queued` → «Добавьте фото чека». Запятая в сумме допускается (`replace(',', '.')`).

`api.addExpense` (500–507, 450 мс): `assertLogisticsFor(t,'create')`; повтор `opId` → `'duplicate'`; серверная `validateExpense` → первая ошибка как `validation`; `receipt.state !== 'ready'` → `validation` «Фото чека ещё не загружено»; push `{id:'xN', category, amount: Number, date, comment, liters, receipt:{fileId,url}, at}`.

### 8.10 Терминальные карточки

| Состояние | Разметка | Текст | Источник |
|---|---|---|---|
| `dr.sSubmitted` | `role="status"`, круг 56px `#FAF1DC`/`#7A5214` icon `hourglass_top` | h2 «Ожидает приёмки менеджером» 19px/600; p «Сервер принял сдачу. Машина вернётся в пул свободных после приёмки.»; чипы summary bg `#F2F3EF`: «Пройдено» «{int(ret−dep)} км»; «Расходы» «{n} на {rub(total)}»; кнопка «Демо: открыть как логист» → `go('manager','review')` | 813–821, 3469–3472 |
| `dr.sQueued` (returning/rework и есть outbox `return`) | `role="status"`, border `1.5px dashed #D9B76A`, icon `cloud_off` | h2 «Сдача сохранена на устройстве»; p «Сервер ещё не принял сдачу, поэтому машина не считается сданной. Отправка начнётся автоматически, когда появится связь.»; чип 12px/600 bg `#FAF1DC`: «Отправляется…» (`sending`) / «Ошибка отправки: {error}» (`error`) / «Ожидает отправки» | 822–829, 3459 |
| `dr.sAccepted` | `role="status"`, круг accent-soft icon `verified` | h2 «Смена принята»; p «Менеджер подтвердил осмотр и расходы. Машина снова доступна для назначения.»; кнопка primary min-height 48 «Начать новую демо-смену» → `newShift()` | 830–837, 2637–2640 |

`newShift()`: `run('new', api.resetTrip, 'Новая демо-смена')` → `dep/ret/exp = null`, `stops={}`, `conflict=null`. `api.resetTrip` (538–540): без сети (`needsNet=false`), 250 мс, сброс `vehicleId/status planned/dep/ret/expenses/review/defect`.

---

## 9. Экран `pg.cars` — «Автомобили» (`:850–867`, `:3526–3528`)

- Персона driver; гейт `logistics/view`; t-alta; данные `carCards(db, trip, blocked, carsFilter)`.
- Шапка: crumb «Москва / Север Логистик»; `<h1 id="h-cars">` «Автомобили»; sub «Машины вашей фирмы и их состояние. Бронь подтверждает сервер.»
- `role="group" aria-label="Фильтр"`: «Все» / «Подходят к рейсу» / «Свободны» (`min-height:40px; padding:0 14px; 500`, пилюли) → `carsFilter`.
- Карточка = как в «Сегодня» (icon, model, plate, specs, чип, список причин), **но**: нет строки «Подходит рейсу…», нет disabled-кнопки; только primary «{bookLabel}» без иконки при `canBook`. Border `1.5px` `#BFD9C8`/`#DCE2D9`.
- Пусто `dc.empty`: «По фильтру машин нет» (`padding:24px; dashed #C3CCC1; radius 12`).
- Баннер «blocked» здесь не выводится, но `canBook=false` при офлайн/restricted/модуль выключен (3447, 3527).

---

## 10. Фото-слоты, очередь и офлайн

### 10.1 Состояния слота (`photoVM`, `:3384–3401`)

| state | border | icon | status (verbatim) | stFg | stIcon | Переходы |
|---|---|---|---|---|---|---|
| `empty` | `1.5px dashed #AEB9B2` | `photo_camera` | «Не снято» | `#5C6964` | `radio_button_unchecked` | tap → file → `uploading`/`queued`; «Демо: добавить фото» |
| `uploading` | `1.5px solid #9FB3A9` | `cloud_upload` | «Загрузка {progress}%» | `#2B5479` | `cloud_upload` | → `ready`; ошибка → `failed`; обрыв связи → `queued`; tap игнорируется (2521) |
| `failed` | `2px solid #A13A33` | `error` | «Ошибка загрузки» + кнопка «Повторить» | `#A13A33` | `error` | «Повторить»/«Демо: добавить фото» → `uploading` |
| `queued` | `2px dashed #B7791F` | `cloud_off` | «На устройстве · ждёт связи» | `#7A5214` | `cloud_off` | `flush()` при появлении связи → `uploading` |
| `ready` | `2px solid var(--ox-accent)` | `image` | «Загружено» / «Загружено · демо» (`demo=true`) | `var(--ox-accent)` | `cloud_done` | бейдж `check`; tap → повторный выбор файла |

`img`: `url("...")` при наличии `objectURL`, иначе `STRIPES` (`repeating-linear-gradient(135deg,#E9EDE6 0 8px,#E0E5DD 8px 16px)`, 2333) для любого не-`empty`, `none` для `empty`. `demo` = true, когда файл не выбран (демо-кнопка).

`uploadPhoto(t, side, file)` (2475–2492): ставит `uploading` (онлайн) или `queued` (офлайн, сразу `return`), `progress 0`; `api.upload({name: side+'.jpg'}, onProgress)` → `ready`, `progress 100`, `fileId`; `ApiError offline` → `queued`; иная ошибка → `failed` с `error`, сброс `state.failUpload`, тост error `e.message`.

`api.upload` (970–986): офлайн → `offline` «Нет связи. Фото сохранено на устройстве и будет отправлено позже.»; `usedGb ≥ quotaGb` и нет начатой смены → `quota_exceeded` «Место организации заполнено. Загрузка новых файлов недоступна.»; `failUploadNext` → при p > 55 `upload_failed` «Загрузка прервалась. Повторите попытку.»; обрыв связи в процессе → `offline` «Связь прервалась во время загрузки.»; прогресс с шагом 14–22 % каждые 110 мс (не выше 96 до финала), затем 160 мс и 100 %; `usedGb += 3.2 MB`; ответ `{fileId:'file-N', state:'ready', name}`.

`demoAll(t)` (2499–2505): для слотов в `empty`/`failed` запускает `uploadPhoto(t, side, null)` с шагом 120 мс.

### 10.2 Outbox (`state.outbox`, `flush` `:2527–2551`)

Элемент: `{opId, kind:'expense'|'return', tripId, label, payload?, state:'local'|'sending'|'error', error?}`. Один `return` максимум (2601 фильтрует прежний).

`flush()` (вызывается через 60 мс после `setOnline(true)`): (1) переотправляет все `queued` фото `dep`/`ret` и чек `exp`; (2) последовательно по outbox: `state='sending'`; `expense`: если чек не `ready` → `api.upload('receipt.jpg')`, затем `api.addExpense(tripId, {...payload, receipt, opId})`, `mark('expense')`; `return`: `waitPhotos('ret')` (поллинг 200 мс; все `ready` → ок; офлайн → `offline` «Связь снова пропала»; есть `failed` → `upload_failed` «Не все фото загрузились — повторите») → `api.submitReturn(tripId, {...inspPayload('ret'), opId})`, `mark('submitted')`; успех → `db`, удалить из outbox, тост ok «{label} — принято сервером»; ошибка → `state = offline ? 'local' : 'error'`, `error = message`, тост error «{label}: {message}» (кроме offline).

⚠ Ручной повтор для `return` в состоянии `error` в UI не предусмотрен — только повторное переключение связи (см. §14).

### 10.3 Правила офлайн по операциям

| Операция | Офлайн | Источник |
|---|---|---|
| Бронь (`reserve`) | тост error «Бронь требует связи с сервером»; карточки показывают «Бронь недоступна» + баннер «Нет связи: бронь требует подтверждения сервера.» | 2557, 3416, 3446 |
| Назначение логистом | `cmd` → `offline` «Нет связи с сервером. Операция не выполнена.» (тост warn) | `api.js:167,227–232`, 2431 |
| Фото | `queued`, засчитывается в «N из 5» и в `inspMissing` | 2479, `models.js:356–358` |
| Выезд | кнопка disabled, note; при вызове тост warn «Выезд требует подтверждения сервера. Черновик осмотра сохранён на устройстве» | 3504, 2579 |
| Расход | в outbox, тост warn «Расход сохранён на устройстве. Отправится при появлении связи»; чип «На устройстве» | 2622–2625 |
| Сдача | в outbox, карточка «Сдача сохранена на устройстве», кнопка «Сохранить сдачу на устройстве» | 2599–2603, 822–829 |
| Приёмка / решение по дефекту | `offline` из `cmd` → тост warn | `api.js:227–232` |
| Новая демо-смена | работает без сети (`needsNet=false`) | 405–407 |

### 10.4 Поток 409 (конфликт)

1. Флажок «Конфликт брони» → `flags.conflictNext = true` (одноразово).
2. Водитель «Забронировать» → сервер делает машину `reserved`/`heldBy:'other'`/`note:'другой рейс'` и бросает `conflict` «Машину только что забронировал другой сотрудник. Список на экране устарел.» → `run` с `quiet:['conflict']` **не** применяет `e.db` и не показывает тост → alert «Конфликт брони» с текстом и кнопкой «Обновить список» → `refresh()` → список перечитан, машина показана «Забронирована · другой рейс», кнопка «Недоступна».
3. Логист «Назначить на рейс» → `conflict` «Машину только что забронировали. Обновите список.» → тост error «Конфликт: …» и автоматический `refresh()`.
4. Целевой API: `409 reservation_overlap` → «Конфликт брони, «Обновить список»» (`docs/12-errors-and-events.md:42`).

---

## 11. Данные

### 11.1 Сущности mock (`mock-data.js:189–228`)

**vehicles** `{id, unit, model, plate, body, payloadT, volumeM3, lengthM, temp:[min,max]|null, odometer, state, depot, note?, heldBy?}`:

| id | unit | model · plate | body | т / м³ / м | temp | odometer | state | depot / note |
|---|---|---|---|---|---|---|---|---|
| v1 | f-msk-sever | ГАЗель Next · А 412 МР 77 | Тент | 1,5 / 16 / 4,2 | — | 84370 | free | Склад № 1 |
| v6 | f-msk-sever | Mercedes Sprinter · Т 771 ЕХ 77 | Фургон | 1,6 / 14 / 4,3 | — | 120544 | free | Склад № 1 |
| v2 | f-msk-sever | Ford Transit · М 608 КТ 77 | Рефрижератор | 1,2 / 11 / 3,4 | [−18, 8] | 61210 | free | Склад № 1 |
| v3 | f-msk-sever | Hyundai Porter · В 233 ОС 77 | Тент | 0,9 / 9 / 3,1 | — | 152003 | free | Склад № 2 |
| v4 | f-msk-sever | ГАЗон Next · Е 905 НА 77 | Фургон | 4,5 / 30 / 5,1 | — | 40112 | unavailable | Склад № 2 · «Плановое ТО до 03.10» |
| v5 | f-msk-yug | Isuzu Elf · К 120 РУ 77 | Фургон | 3,0 / 20 / 4,4 | — | 98320 | free | Юг · база |
| v7 | f-smr-volga | ГАЗель Бизнес · О 318 ХС 163 | Тент | 1,5 / 14 / 3,1 | — | 201450 | on_route | Самара · склад |

**trips** `{id, unit, title, date, window, distanceKm, driverId, driverName, vehicleId, status, earnings, cargo:{weightT, volumeM3, lengthM, temp, kind}, stops:[{time,name,op,w,v}], dep, ret, expenses, review, defect, reservedUntil?}`:

| id | title | date · window | km | driver | cargo | stops | earnings |
|---|---|---|---|---|---|---|---|
| Р-208 | Северный маршрут | 01.10.2026 · 09:00–13:00 | 46 | m-vasiliev «Илья Васильев» | 1,1 т · 12 м³ · 3,0 м · без темп. · «Сухой груз · 14 паллет-мест» | 09:00 Склад № 1, Лобня load 1.1/12; 10:15 Химки, ул. Заводская, 8 unload 0.7/8; 11:30 Долгопрудный, Лихачёвский пр., 4 unload 0.4/4 | 4500 |
| Р-211 | Охлаждённая продукция | 01.10.2026 · 14:00–18:00 | 31 | — | 0,6 т · 7 м³ · 2,4 м · [2,6] · «Молочная продукция · +2…+6 °C» | 14:00 Склад № 1, Лобня load 0.6/7; 15:10 Мытищи, ул. Колпакова, 2 unload 0.35/4; 16:20 Королёв, пр. Космонавтов, 20 unload 0.25/3 | 3800 |

Серверные под-объекты: `trip.dep/ret = {odometer:Number, fuel, defects:[{zone,text,critical,downgraded?}], photos:{side:{state,fileId,url,demo}}, comment? (ret), at:'HH:MM'}`; `trip.expenses[] = {id:'xN', category, amount, date:'YYYY-MM-DD', comment, liters, receipt:{fileId,url}, at}`; `trip.review = {decision, comment, steps?, at, resolved?}`; `trip.defect = {zone,text,critical}`; `db.earnings[] = {id:'nN', tripId, unit, member, amount, status:'Начислено'}`; `db.events[] = {id, at, text, to:[memberId], sensitive?, unit?}`.

**pool** (222–228): `drivers: [{id:'d-104', code:'Водитель #104', qual:'Кат. C · рефрижератор', home:'Юг Транс', unit:'f-msk-yug', window:'13:00–19:00', terms:'По соглашению фирм группы'}, {id:'d-117', code:'Водитель #117', qual:'Кат. B', home:'Восток Карго', unit:'f-msk-vostok', window:'15:00–20:00', terms:…}]`, `requests: []` → `{id:'qN', driverId, tripId, comment, status:'pending'|'approved'|'declined', home, at, decidedAt?, until?}`.

**Участники и роли** (153–188): `m-kotova` «Марина Котова» Логист (без назначения); `m-vasiliev` «Илья Васильев» Водитель `function:'driver'`, назначение `a2` роль `r-driver` scope firm `f-msk-sever` via «группа «Водители Север»»; `r-manager` «Менеджер логистики» `logistics: [view, create, edit, review, export]`, `finance.read: true`; `r-driver` `logistics: [view, create]`, `finance: {read:false}`; `r-owner` `all: true`, `finance read+manage`.

**Видимость в `view()`** (`api.js:185–224`): `vehicles` — только где `can(logistics view, unit)` (водитель: v1, v6, v2, v3, v4); `trips` — где видит fleet **и** (`can(edit, unit)` или `driverId === actor`) (водитель: только Р-208); `earnings` удаляется из trip, если `!canEarnings`; события фильтруются по адресату и `sensitive`.

### 11.2 Справочники (`models.js`)

| Константа | Значения |
|---|---|
| `VEHICLE_STATE` (85–91) | free «Свободна» ok `check_circle`; reserved «Забронирована» info `event_available`; on_route «На маршруте» info `route`; review «Проверяется» warn `pending`; unavailable «Недоступна» danger `block` |
| `TRIP_STATE` (93–103) | planned «Запланирован» neutral `event`; assigned «Машина назначена» info `event_available`; inspection «Осмотр перед выездом» info `fact_check`; defect_review «Дефект на проверке» danger `report`; on_route «В рейсе» info `route`; returning «Сдача машины» info `assignment_return`; submitted «Ожидает приёмки» warn `pending`; rework «На доработке» warn `undo`; accepted «Принят» ok `verified` |
| `PHOTO_SIDES`/`SIDES` (118; html:2334) | front «Спереди», back «Сзади», left «Слева», right «Справа», odo «Одометр» |
| `DEP_CHECKS` (119) | body «Кузов и стёкла осмотрены», tires «Шины и световые приборы исправны», docs «Документы и комплект на месте» |
| `RET_CHECKS` (120) | cargo «Груз выгружен полностью», personal «Личные вещи забраны», keys «Ключи и документы на месте» |
| `DEFECT_ZONES` (121) | «Кузов», «Стёкла», «Шины и колёса», «Световые приборы», «Салон», «Грузовой отсек», «Тормоза и ходовая» |
| `FUEL` (122) | q «¼», h «½», tq «¾», f «Полный» |
| `EXPENSE_CAT` (123) | fuel «Топливо» `local_gas_station`; wash «Мойка» `local_car_wash` |
| `REASON` (77–83) | module_off «Модуль не подключён»; module_readonly «Модуль отключён · только чтение»; no_permission «Нет права»; no_scope «Нет доступа к объекту»; driver_block «Запрещено функцией «Водитель»» |
| Форматы (140–143) | `num`: `.`→`,`; `int`: `toLocaleString('ru-RU')`; `rub`: `… ₽`; `plural(n,a,b,c)` |

### 11.3 Формулы

- `compat(v, trip)` (323–340): `avail = state==='free' || heldBy===trip.id`; checks: «Доступность» (value «Назначена на этот рейс» / `VEHICLE_STATE.label` + note), «Грузоподъёмность» `payloadT ≥ weightT` (need «от {w} т»), «Объём» `volumeM3 ≥ volumeM3` («от {v} м³»), «Длина кузова» `lengthM ≥ lengthM` («от {l} м»), «Температура»: если `cargo.temp` — `v.temp && v.temp[0] ≤ c[0] && v.temp[1] ≥ c[1]` (value `tempLabel` / «без охлаждения», need `tempLabel(c.temp)`), иначе ok «не требуется». `fit` = все кроме доступности; `ok = fit && avail`; `reasons = '{label}: {value}' + (', нужно {need}')`.
- `tempLabel([a,b])` (341): `(a>0?'+':'') + a + '…' + (b>0?'+':'') + b + ' °C'`.
- `legs(trip, v)` (344–352): кумулятивно `w`, `vol` (`load` +, `unload` −, не ниже 0, округление до 0,01); `wPct = round(w/payloadT*100)`, `vPct = round(vol/volumeM3*100)`; без машины — `null`.
- `inspMissing(d, kind, minOdo)` (354–367): см. §8.8.
- `odoError(value, minOdo)` (369–376): '' → null; NaN → «Введите число»; `< min` → «Пробег не может быть меньше {int} км»; `> min+3000` → «Больше начального на {int(n−min)} км — проверьте показания» (не блокирует).
- `validateExpense(e)` (378–389): см. §8.9.

### 11.4 Команды mock-API и коды ошибок (`api.js`)

| Метод | Задержка | Проверки/ошибки (code → message) | Эффект |
|---|---|---|---|
| `reserve(tripId, vid)` | 600 | `subscription_restricted`, `module_off` «Модуль «Логистика» отключён», `no_permission/no_scope`, `conflict` ×2, `incompatible` | trip `inspection`, `reservedUntil '09:30'`, машина `reserved` |
| `cancelReservation(tripId)` | 420 | — | машина `free`, trip `planned` |
| `assignVehicle(tripId, vid)` | 420 | `subscription_restricted`, права edit, `conflict`, `incompatible` «Нельзя назначить: …» | trip `assigned`, машина `reserved` |
| `submitDeparture(tripId, p)` | 650 | `assertLogisticsFor create`, `validation` «Осмотр не завершён: …» / «Не все фото загружены на сервер» | `on_route` или `defect_review`; ответ формы + задача |
| `decideDefect(tripId, 'allow'|'confirm')` | 420 | права review | см. §7.3 |
| `addExpense(tripId, e)` | 450 | `validation` (тексты `validateExpense`), «Фото чека ещё не загружено»; идемпотентность по `opId` | push expense |
| `finishRoute(tripId)` | 350 | `assertLogisticsFor create` | `returning` |
| `submitReturn(tripId, p)` | 650 | `validation` «Сдача не завершена: …» / «Не все фото загружены на сервер»; идемпотентность | `submitted`, машина `review` |
| `reviewTrip(tripId, {decision, comment, steps})` | 600 | права review; `conflict` «Смена уже обработана»; `validation` | `accepted` (машина `free`, `odometer` обновлён, начисление) / `rework` |
| `resetTrip(tripId)` | 250, без сети | — | сброс рейса |
| `requestDriver` / `decideRequest` | 420 | `conflict` «Запрос уже отправлен» | см. §6 |
| `upload({name}, onProgress)` | ~0,9 с | `offline`, `quota_exceeded`, `upload_failed` | `{fileId, state:'ready'}` |
| любой `cmd` | — | `offline` «Нет связи с сервером. Операция не выполнена.» | — |

`assertLogisticsFor(t, verb)` (178–182): для **не начатой** работы требует активную подписку и включённый модуль («Модуль «Логистика» отключён: новые операции закрыты.»); для начатой (`inspection, on_route, returning, rework, submitted, defect_review`) — только право (модуль как бы включён).

Пути HTTP-адаптера (1028–1038): `POST /fleet/reservations {tripId, vehicleId}`; `PATCH /fleet/reservations/{tripId} {status:'cancelled'}`; `PATCH /fleet/trips/{tripId} {vehicleId}`; `POST /fleet/inspections {tripId, kind:'departure'|'return', …}` + `Idempotency-Key: opId`; `POST /fleet/trips/{tripId}/defect-decision {decision}` (PROPOSED); `POST /fleet/trips/{tripId}/expenses` + idem; `PATCH /fleet/trips/{tripId} {status:'returning'}`; `POST /fleet/trips/{tripId}/review`; `POST /fleet/driver-transfer-requests`; `POST /fleet/driver-transfer-requests/{id}/decision {approve}`. База в OpenAPI: `/api/v1/tenants/{tenantId}/fleet/...` (yaml:3690–6216: vehicles, reservations, inspections, trips, review, expenses, earnings, driver-transfer-requests, routes, inspection-checklist, driver-pool).

### 11.5 Доменные события (уведомления), генерируемые mock (`api.js`)

| Текст | Кому | Строка |
|---|---|---|
| «Илья Васильев забронировал {model} {plate} на рейс {id}» | reviewers(unit) | 457 |
| «Критический дефект: {model} {plate} — {zone}. Выезд заблокирован.» | reviewers | 481 |
| «Рейс {id} начат · {model}» | reviewers | 485 |
| «Менеджер разрешил выезд: дефект признан некритичным» | водитель | 493 |
| «Неисправность подтверждена. Выберите другую машину для рейса {id}» | водитель | 497 |
| «Смена {id} сдана на приёмку · {model} {plate}» | reviewers | 518 |
| «Смена {id} возвращена на доработку: {comment}» | водитель | 527 |
| «Смена {id} принята. Машина свободна.» | водитель + reviewers | 533 |
| «Начисление по рейсу {id}: {rub}» (`sensitive:'earnings'`) | reviewers с `canEarnings` | 535 |
| «Запрос водителя {code} одобрен/отклонён фирмой {home}» | reviewers | 551 |

Целевые имена событий (`docs/12:79–84`): `fleet.reservation.held/confirmed/expired/released.v1`, `fleet.inspection.submitted.v1`, `fleet.defect.blocking_reported.v1`, `fleet.trip.started/submitted/accepted/rework_requested.v1`, `fleet.expense.claimed/verified.v1`, `fleet.transfer.approved/revoked/expired.v1`.

### 11.6 Тосты домена (сводно)

| Текст | tone | Источник |
|---|---|---|
| «Нет связи. Черновики сохраняются на устройстве» | warn | 2463 |
| «Список обновлён» | ok | 2571 |
| «Бронь требует связи с сервером» | error | 2557 |
| «Бронь подтверждена сервером. Начните осмотр» | ok | 2560 |
| «Бронь отменена. Машина вернулась в пул» | ok | 2575 |
| «Выезд требует подтверждения сервера. Черновик осмотра сохранён на устройстве» | warn | 2579 |
| «Выезд заблокирован: дефект отправлен менеджеру» | warn | 2582 |
| «Выезд подтверждён сервером» | ok | 2583 |
| «Рейс завершён. Заполните осмотр при сдаче» | ok | 2594 |
| «Сдача сохранена на устройстве и ещё не принята сервером» | warn | 2602 |
| «Сдача принята сервером. Ожидайте приёмки» | ok | 2605 |
| «Расход сохранён на устройстве. Отправится при появлении связи» | warn | 2624 |
| «Расход принят сервером» | ok | 2627 |
| «{label} — принято сервером» / «{label}: {error}» | ok / error | 2545, 2548 |
| «Новая демо-смена» | ok | 2639 |
| «Смена принята. Машина вернулась в пул» | ok | 2774 |
| «Смена возвращена водителю на доработку» | ok | 2782 |
| «Выезд разрешён» / «Неисправность подтверждена, машина снята с рейса» | ok | 2785 |
| «Машина назначена на рейс {id}» / «Конфликт: {message}» | ok / error | 2788–2789 |
| «Запрос отправлен фирме {home} · уведомления в демо не отправляются» | ok | 2794 |
| «Фирма {home} одобрила запрос (демо)» / «… отклонила запрос (демо)» | ok | 3323–3324 |
| Любая `ApiError.message` | `offline` → warn, иначе error | 2431 |

---

### 11.7 Связи с «Кассой» и «Задачами» (14.10)

**Расходы водителя → «Касса».** Блока «Предложения из принятых смен» в CRM больше нет: предложения формирует модуль «Касса» (`ortus/cash.js`).
- `cashProposals(db, M, actor)` (`cash.js:104–123`): для каждого расхода рейса в статусе `accepted` — предложение `{ id: 'tx:' + e.id, mod: 'logistics', kind: 'out', amount, account: касса подразделения рейса (drawerFor(unit)), method: 'cash', cat: EXPENSE_CAT.label, seller: true, title: 'Возместить · {водитель}', sub: 'Рейс {id} · {категория} · расход принят в приёмке смены', src: { kind: 'trip', id, label: 'Рейс {id}', nav: 'review' } }`. Предложение скрыто, если уже проведено (операция с тем же `src.key` без сторно), ждёт согласования или отклонено; если модуль `logistics` выключен; если у участника нет права на кассу (`create`) или у него только свой подотчёт.
- Проведение — `cashPostProposal(key, pay)` (`cash.js:342+`): `conflict` «Предложение уже проведено, отклонено или недоступно», затем запись расхода в кассу с основанием «Возместить · … · Рейс …» и ссылкой `src` на рейс (из «Кассы» `onNav('review', tripId)` открывает приёмку этой смены).
- В «Главной» предложения попадают одной карточкой «Касса · входящие» — «N предложений к проведению» с разбивкой «возмещения» (`cash.js:169–171`, источник 11 «Главной», 01 §23).
- Для этапа 2 (логистика) это **не входит**: приёмка смены создаёт «Расходы станут принятыми; кассовые операции создаются отдельно» (§7.5), а проведение в кассу — этап 5 (W5.31/W5.32). Ключ связи — `src.key = 'tx:' + expenseId`, его нужно сохранить в данных расхода.

**Проект задач `fleet` (14.10).** Задачи логистики живут в проекте «Логистика · Север» (`mock-data.js:287`, ключ `LOG`, подразделение `f-msk-sever`, владелец Марина Котова) с процессом согласования (`M.buildWf('approval')`, `api.js:26`), доступом `limited` и автоматизациями «Срочная задача → назначить руководителю проекта» (вкл.) и «Задача готова → напомнить про путевой лист» (выкл.) (`api.js:31–33`). Участники — через проектные роли: Котова `r-pm`, Васильев `r-exec` через группу «Водители Север», Котельникова `r-approver` (`mock-data.js:182–184`). Добавлены задачи `T-65` «Заменить шины на ГАЗон Next (зимние)» (на проверке, счёт во вложении) и `T-66` «Подготовить парк к зиме» с подзадачами `T-65`, `T-58` (`api.js:27–30`). Задача менеджеру, которую создаёт критический дефект или осмотр (§8.7, I6), попадает в этот проект — в этапе 2 она остаётся записью очереди дефектов (S2-17, W2.04), задачей станет в этапе 4 (W4.24).

## 12. Целевая схема (`docs/db/tenant_0002_fleet.sql`) и отображение mock → SQL

| Mock | SQL | Расхождение |
|---|---|---|
| `vehicle.payloadT` (т), `volumeM3`, `lengthM` (м), `temp:[min,max]` | `fleet.vehicles.payload_kg numeric(10,1)`, `volume_m3`, `cargo_length_mm integer`, `temp_min_c/temp_max_c` (оба null или оба заданы, 25–26) | единицы: т→кг, м→мм |
| `vehicle.body` «Тент/Фургон/Рефрижератор» | `body_type in ('van','box','reefer','tent','flatbed')` | нужна карта подписей |
| `vehicle.state` free/reserved/on_route/review/unavailable (+`heldBy`, `note`) | нет колонки; `service_state in ('ok','maintenance','out_of_service')` + занятость через `trips` (unique index `trips_active_vehicle_uq`, 57–58) и `sched.reservations` (`docs/10:101`) | состояние карточки — вычисляемое |
| `trip.status` 9 значений | `fleet.trips.state` те же + `cancelled` (35–36); check: `on_route…accepted` требуют `vehicle_id` и `started_at` (54) | `cancelled` в UI нет |
| `trip.cargo` т/м³/м/temp | `cargo_weight_kg`, `cargo_volume_m3`, `cargo_length_mm`, `cargo_temp_min_c/max_c` (41–45) | — |
| `trip.stops[{time,name,op,w,v}]` | `fleet.trip_stops (trip_id, seq, op load/unload, address, time_window tstzrange, weight_kg, volume_m3, contact)` (63–73) | — |
| `dep/ret` | `fleet.inspections (kind departure/return, checklist_version_id, odometer_km, fuel_level quarter/half/three_quarters/full, answers jsonb, state submitted/approved/blocked, client_captured_at)`, `unique (trip_id, kind)` (85–100) | ключи топлива `q/h/tq/f` → `quarter/half/three_quarters/full`; при rework второй осмотр нарушит `unique(trip_id, kind)` ⚠ |
| `photos.{front,back,left,right,odo}` | `fleet.inspection_photos (inspection_id, role front/back/left/right/odometer/interior/cargo, file_id → files.objects)` (107–112); `checklist_versions.required_photo_roles` default `['front','back','left','right','odometer']` (80) | `odo` → `odometer` |
| `defects[{zone,text,critical}]` | `fleet.defects (vehicle_id, inspection_id, zone, severity minor/major/blocking, description, state open/in_review/resolved/confirmed_out_of_service)`; индекс открытых blocking (126–128) | `critical:true` → `blocking`; «признан некритичным» → `resolved`? ⚠ |
| `odoError`/корректировки | `fleet.odometer_corrections (from_km, to_km, reason, approved_by)` (130–138) | в UI нет |
| `expenses` fuel/wash, `amount` ₽, `liters` строка | `fleet.expenses (category fuel/wash/parking/toll/other, amount_minor bigint, currency 'RUB', liters numeric, odometer_km, occurred_on date, receipt_file_id, state claimed/verified/rejected/reimbursed)`; **check: `category <> 'fuel' or liters is not null`** (158) | UI: «Литры» «Необяз.» ⚠ |
| `pool.drivers` / `requests` | `fleet.pool_publications (catalog_ref, person_id, home_unit_id, qualifications[], available tstzrange)`; `fleet.driver_transfers (state requested/approved/rejected/revoked/expired/completed, period, assignment_id)` (163–190) | mock `pending/approved/declined` |
| `trip.earnings`, `db.earnings` | `finance.earnings (trip_id unique, person_id, unit_id, amount_minor, state draft/approved/corrected)` — отдельная схема, не входит в Trip DTO (192–206) | — |

Переходы (`docs/10-data-model.md:86–99`): `planned → assigned → inspection → on_route | defect_review → on_route → returning → submitted → accepted | rework → submitted`; `любое до on_route → cancelled`. Команды: `POST /fleet/reservations` (`fleet.reservations.create`), `POST /fleet/trips` (`fleet.trips.start`: 5 фото ready, чек-лист, нет блокирующего дефекта, бронь → consumed), `PATCH /fleet/trips/{id} action=return` (`fleet.trips.return`: пробег ≥ выезда), `POST /fleet/trips/{id}/review` (`fleet.trips.review`).

Права (`docs/11-permissions.yaml:122–143, 285–289`): алиасы макета `fleet.inspections.create → fleet.inspections.submit`, `fleet.trips.manage → [fleet.trips.start, fleet.trips.return, fleet.routes.manage]`, `fleet.pool.request → fleet.driver_transfers.request`; `fleet.earnings.read/manage` — `sensitivity: restricted, blocked_by_function: [driver]`.

---

## 13. Инварианты и правила

| # | Правило | Источник |
|---|---|---|
| I1 | Бронь, выезд, назначение, приёмка и решение по дефекту выполняются только при связи; офлайн — тост/баннер, никаких локальных подтверждений | html:2557, 2579, `api.js:227–232`; LOG-11 |
| I2 | Совместимость: `fit` = грузоподъёмность ∧ объём ∧ длина ∧ температура; `ok` = fit ∧ (free ∨ heldBy=рейс). Кнопка брони/назначения только при `ok`; причины показываются текстом | `models.js:323–340`; D03 |
| I3 | Сервер повторно проверяет совместимость и доступность (`incompatible`, `conflict`) — клиентская проверка не является решением | `api.js:454–455, 468`; LOG-02 |
| I4 | Выезд возможен только при 5 фото `ready` на сервере, заполненных пробеге/топливе/3 пунктах чек-листа | `api.js:474–475`; AC-04, D05 |
| I5 | Пробег при выезде ≥ `vehicle.odometer`; при сдаче ≥ `trip.dep.odometer`; меньше — ошибка и блокировка кнопки; больше +3000 — только подсказка | `models.js:354–376`; LOG-09 |
| I6 | Критический дефект при выезде → `defect_review`, машина `unavailable`, задача менеджеру `urgent`; только `review`-право решает; «разрешить» → дефекты `downgraded`, «подтвердить» → машина снята, рейс `planned` | `api.js:476–499` |
| I7 | При сдаче критичность не выбирается (`showCritical` только dep) | html:3495 |
| I8 | Машина освобождается (`free`) **только** при `accepted`; `submitted` → `review`; `rework` не меняет машину | `api.js:516, 531`; S2-10 |
| I9 | При `accepted` `vehicle.odometer := ret.odometer` | `api.js:531` |
| I10 | `earnings` никогда не попадает водителю: удаляется в `view()`, события `sensitive` фильтруются; в UI карточка начисления только при `showEarn` | `api.js:193–195`; AC-05, D06 |
| I11 | Расход: 0 < сумма ≤ 200 000, дата, чек `ready` (сервер) / `ready|queued` (клиент); расход ≠ выплата ≠ начисление | `models.js:378–389`; LOG-08/10 |
| I12 | Идемпотентность `opId` для `addExpense` и `submitReturn` (повтор → `'duplicate'` без эффекта) | `api.js:502, 511`; AC-07 |
| I13 | Повтор осмотра не создаёт дубль ответа формы (ключ `trip:kind:rev1|rev2`) | `api.js:65–68` |
| I14 | Начатую смену можно завершить при выключенном модуле / истёкшем trial; новые брони — нет | `api.js:176–182`; баннеры 3088–3089 |
| I15 | Логист видит рейсы своей области (`edit`), водитель — только свои (`driverId`); машины — по `view` области | `api.js:196–198`; D22 |
| I16 | Rework требует непустой комментарий и ≥ 1 раздела; оба текста ошибок одинаковы на клиенте и сервере | html:2780–2781; `api.js:524–525` |
| I17 | `reviewTrip` только из `submitted` (иначе «Смена уже обработана») | `api.js:522` |
| I18 | Пул: запрос только при свободном/отклонённом водителе, без одобренного на рейс, если у рейса нет водителя; повтор pending → 409 | html:3320; `api.js:544` |
| I19 | Фото/чеки хранятся как object URL в браузере; на сервер уходит только `fileId` | README:166; 2477 |
| I20 | Все `aria-pressed`/`aria-selected` — строки `'true'/'false'`; `disabled` — булев; `aria-current` — `'page'`/`'step'`/undefined | `support.js:796–813`, html |

---

## 14. Чек-лист приёмки (Playwright)

Предусловие для всех сценариев логиста/водителя: модуль «Логистика» включён, у Марины Котовой назначена роль «Менеджер логистики» на фирму/регион Москва (в прототипе — через «Путь проверки» шаги 1–2 или seed).

### Навигация и гейты
1. **Given** персона driver, модуль выключен **When** открыть «Сегодня» **Then** виден AccessGate с чипом «Модуль не подключён», h1 ««Логистика» не подключена организацией», кнопка «Демо: открыть как владелец».
2. **Given** модуль включён, у логиста нет роли **When** persona manager **Then** h1 «Нет роли с доступом к модулю «Логистика»», текст содержит «Владелец бизнеса может назначить роль и область.», кнопка «Демо: открыть как владелец».
3. **Given** логист с ролью **Then** в `nav[aria-label="Основная навигация"]` группа «Логистика» содержит «Рабочее место логиста», «Ресурсный пул», «Приёмка смен»; при кадре 390 — `nav[aria-label="Навигация"]` с «Логист», «Пул», «Приёмка», «Ещё».
4. **Given** кадр 768 **Then** боковая панель шириной 68px, подписи скрыты, `button[title="Рабочее место логиста"]` существует.
4а. (14.10, D-23) **Given** owner, «Логистика» подключена и затем отключена **Then** группы «Логистика» в меню нет, внизу группа «Отключены · только чтение» с пунктом «Логистика»; **When** клик **Then** `h1` «Рабочее место логиста» без AccessGate и баннер «Модуль «Логистика» отключён.» с текстом «Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.»; **Given** owner, модуль ни разу не подключался **Then** ни группы «Логистика», ни пункта «Логистика» в меню нет.
4б. (14.10) **Given** driver **Then** меню «Сегодня», «Автомобили», «Подотчёт», «Чаты», «База знаний», «Документы» (последние четыре — `out-of-stage` до этапов 4–7); **Given** manager без роли логиста **Then** меню содержит «Рабочее место логиста» (D-23: пункт сотрудника не зависит от состояния модуля).

### Рабочее место логиста
5. **Given** `pg.fleet` **Then** `h1#h-fleet` «Рабочее место логиста»; 4 статистики с подписями «свободно», «в брони или рейсе», «ждут приёмки», «недоступно» и значениями «4», «0», «0», «1» (логист).
6. **Then** `[role=tablist][aria-label="Рейсы"]` содержит `role=tab` «Р-208 · Северный маршрут» (`aria-selected="true"`) и «Р-211 · Охлаждённая продукция».
7. **Then** h2 «Подбор транспорта · Р-208»; строка «Hyundai Porter» содержит чипы «Грузоподъёмность: 0,9 т (нужно от 1,1 т)», «Объём: 9 м³ (нужно от 12 м³)» и disabled-кнопку «Не подходит»; «ГАЗон Next» — чип «Доступность: Недоступна · Плановое ТО до 03.10» и disabled «Недоступна»; «ГАЗель Next» — кнопка «Назначить на рейс».
8. **When** фильтр «Подходят» **Then** строк только с `fit` (ГАЗель Next, Mercedes Sprinter, ГАЗон Next); фильтр «Свободны» → без ГАЗон Next.
9. **When** «Показать загрузку» у Mercedes Sprinter **Then** `aria-pressed="true"`, подпись «Загрузка показана», sub «Для Mercedes Sprinter · 14 м³ · 1,6 т. Объём и масса считаются раздельно.», участок 1 показывает «86%» и «69%».
10. **When** «Назначить на рейс» (ГАЗель Next) **Then** тост «Машина назначена на рейс Р-208», чип машины «Назначена на Р-208», таб показывает «Машина назначена», в карточке «Машина» → «ГАЗель Next · А 412 МР 77».
11. **Given** флажок «Конфликт брони» **When** «Назначить на рейс» **Then** тост `role=alert` «Конфликт: Машину только что забронировали. Обновите список.» и строка машины показывает «Забронирована · другой рейс».
12. **Given** таб Р-211 **Then** «Водитель» → «Не назначен», кнопка «Найти водителя в пуле» ведёт на «Ресурсный пул»; у Ford Transit чип «Температура: -18…+8 °C» ok, у ГАЗель Next «Температура: без охлаждения (нужно +2…+6 °C)».
13. **Given** owner, «Область просмотра» = «Самара · весь регион» **Then** пустое состояние «В выбранной области нет рейсов».

### Ресурсный пул
14. **Given** `pg.pool` **Then** `h1#h-pool` «Ресурсный пул»; карточка «Водитель #104» с «Кат. C · рефрижератор · Юг Транс», чип «Свободен», кнопка «Запросить на рейс Р-211».
15. **When** «Запросить на рейс Р-211» **Then** `role=dialog` с h2 «Запросить водителя», «Срок» → «Временно, до 18:00 01.10»; **When** «Отправить запрос» **Then** тост «Запрос отправлен фирме Юг Транс · уведомления в демо не отправляются», чип «Запрос отправлен», `role=status` «Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.», кнопки «Одобрить»/«Отклонить».
16. **When** «Одобрить» **Then** чип «Временно назначен», текст «Водитель #104 назначен на рейс Р-211 до 18:00 01.10. Доступ ограничен этим рейсом; история и начисления остаются в фирме Юг Транс.»; у «Водитель #117» кнопки запроса нет.
17. **When** «Отклонить» (другой прогон) **Then** «Запрос отклонён. Можно запросить другого водителя.», чип «Отклонён», кнопка запроса снова доступна.

### Водитель · бронь
18. **Given** driver, рейс planned **Then** `h1#h-today` «Моя смена»; `ol[aria-label="Этапы смены"]` — «Машина» с `aria-current="step"`; h2 «Выберите машину»; карточки «ГАЗель Next», «Mercedes Sprinter» с «Подходит рейсу: масса, объём, длина и температура» и кнопкой «Забронировать»; «Ford Transit» — причина «Объём: 11 м³, нужно от 12 м³», disabled «Не подходит рейсу»; «Hyundai Porter» — две причины, «Не подходит рейсу»; «ГАЗон Next» — «Доступность: Недоступна · Плановое ТО до 03.10», disabled «Недоступна».
19. **When** «Забронировать» (ГАЗель Next) **Then** во время запроса кнопка «Проверяем на сервере…» disabled; затем тост «Бронь подтверждена сервером. Начните осмотр»; `role=status` «Бронь подтверждена сервером · ГАЗель Next А 412 МР 77 · держится до 09:30» с кнопкой «Отменить бронь»; шаг «Осмотр» current, «Машина» done.
20. **Given** «Конфликт брони» **When** «Забронировать» **Then** `role=alert` с `strong` «Конфликт брони» и текстом «Машину только что забронировал другой сотрудник. Список на экране устарел.», кнопка «Обновить список»; карточка ещё показывает «Забронировать»; **When** «Обновить список» **Then** тост «Список обновлён», чип «Забронирована», disabled «Недоступна», alert скрыт.
21. **Given** «Нет связи» **Then** `role=status` «Нет связи: бронь требует подтверждения сервера.» (icon cloud_off), все кнопки «Бронь недоступна» disabled; в шапке чип «Нет связи»; баннер «Нет связи.».
22. **When** «Отменить бронь» **Then** тост «Бронь отменена. Машина вернулась в пул», состояние planned.

### Водитель · осмотр перед выездом
23. **Given** inspection **Then** h2 «Осмотр перед выездом»; legend «Фото · 0 из 5»; 5 кнопок с `aria-label` «Спереди: Не снято. Нажмите, чтобы снять или выбрать фото» … «Одометр: Не снято. …»; sticky-панель «Осталось: 5 фото, пробег, уровень топлива, 3 пункта чек-листа»; кнопка «Выехать на маршрут» disabled.
24. **When** «Демо: добавить фото» **Then** статусы проходят «Загрузка N%» и становятся «Загружено · демо», бейдж check, legend «Фото · 5 из 5».
25. **Given** «Сбой загрузки фото» **When** тап по слоту/демо **Then** один слот получает «Ошибка загрузки», кнопку «Повторить», тост `role=alert` «Загрузка прервалась. Повторите попытку.»; **When** «Повторить» **Then** «Загружено · демо».
26. **Given** «Нет связи» **When** «Демо: добавить фото» **Then** статусы «На устройстве · ждёт связи» (border dashed `#B7791F`), legend считает их («Фото · 5 из 5»), но кнопка «Выехать на маршрут» disabled и note «Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.»; **When** связь включена **Then** слоты становятся «Загружено · демо».
27. **Given** `input` «Пробег по одометру, км» (placeholder /84\s370/) **When** ввести «84000» **Then** `aria-invalid="true"`, `#odo-hint` «Пробег не может быть меньше 84 370 км», панель «Осталось: … пробег не меньше 84 370 км …»; **When** «90000» **Then** hint «Больше начального на 5 630 км — проверьте показания», но пункта «пробег» в «Осталось» нет; **When** «84500» **Then** hint «Последний зафиксированный пробег: 84 370 км».
28. **When** выбрать «½» **Then** `aria-pressed="true"`; отметить 3 чекбокса «Кузов и стёкла осмотрены», «Шины и световые приборы исправны», «Документы и комплект на месте» **Then** панель без «Осталось», кнопка «Выехать на маршрут» enabled.
29. **When** «Добавить дефект» → «Добавить» без текста **Then** `role=alert` «Опишите дефект»; с текстом «Скол» и зоной «Стёкла» **Then** строка «Стёкла / Скол», кнопка `aria-label="Удалить дефект"`.
30. **When** дефект с чекбоксом «Критический — машина не может выехать» **Then** строка «Критический — выезд невозможен», панель «Отмечен критический дефект. Выезд будет заблокирован, осмотр уйдёт менеджеру.», кнопка «Отправить на проверку менеджеру» (bg `#A13A33`).
31. **When** «Отправить на проверку менеджеру» **Then** тост «Выезд заблокирован: дефект отправлен менеджеру»; `role=alert` h2 «Выезд заблокирован», текст «Критический дефект «Стёкла: Скол» отправлен менеджеру на проверку. Машина недоступна для выезда.», кнопка «Выбрать другую машину»; чип рейса «Дефект на проверке».
32. **When** «Выехать на маршрут» (без критического) **Then** тост «Выезд подтверждён сервером», чип «В рейсе», шаг «Рейс» current, блок «Маршрут» с «Отмечено 0 из 3».

### Водитель · рейс, расходы, сдача
33. **When** «Прибыл» у «Склад № 1, Лобня» **Then** `aria-pressed="true"`, кнопка «Отменить», метка «✓», «Отмечено 1 из 3».
34. **When** «Добавить расход» → «Сохранить расход» пусто **Then** `role=alert` «Укажите сумму» и «Добавьте фото чека»; сумма «-500» → «Сумма должна быть больше нуля»; «300000» → «Больше 200 000 ₽ — проверьте сумму»; «abc» → «Сумма должна быть числом».
35. **When** «Демо-фото чека» до завершения загрузки нажать «Сохранить расход» **Then** «Дождитесь окончания загрузки чека».
36. **When** сумма «2500», чек загружен, «Сохранить расход» **Then** тост «Расход принят сервером», строка «Топливо · 2 500 ₽», meta «01.10.2026 · чек приложен», чип «Принято сервером».
37. **Given** «Нет связи» **When** сохранить расход «Мойка» 400 **Then** кнопка называлась «Сохранить на устройстве», тост «Расход сохранён на устройстве. Отправится при появлении связи», строка с meta «Локальный черновик» и чипом «На устройстве»; баннер «… (ожидают отправки: 1) …»; **When** связь включена **Then** чип «Отправляется» → строка становится «Принято сервером», тост «Мойка 400 ₽ — принято сервером».
38. **When** «Завершить рейс» при 1 из 3 **Then** `role=dialog` «Завершить рейс Р-208?», текст «Дальше — осмотр при сдаче: 5 фото, пробег, топливо и чек-лист.», раздел «Внимание» «Отмечено точек: 1 из 3. Убедитесь, что доставка выполнена.», кнопки «Отмена»/«Завершить рейс»; подтверждение → тост «Рейс завершён. Заполните осмотр при сдаче», h2 «Осмотр при сдаче», чекбоксы «Груз выгружен полностью», «Личные вещи забраны», «Ключи и документы на месте», поле «Комментарий для менеджера», кнопка «Сдать машину».
39. **Given** выезд 84500 **When** пробег при сдаче «84400» **Then** hint «Пробег не может быть меньше 84 500 км», «Сдать машину» disabled; **When** «84560» и всё заполнено **Then** enabled; клик → тост «Сдача принята сервером. Ожидайте приёмки», карточка «Ожидает приёмки менеджером» с «Пройдено 60 км», «Расходы 1 на 2 500 ₽», кнопка «Демо: открыть как логист».
40. **Given** «Нет связи» на сдаче **Then** кнопка «Сохранить сдачу на устройстве», note «Нет связи: сдача сохранится на устройстве и отправится позже. До подтверждения сервера машина не считается сданной.»; клик → тост «Сдача сохранена на устройстве и ещё не принята сервером», карточка «Сдача сохранена на устройстве» с чипом «Ожидает отправки»; **When** связь включена **Then** чип «Отправляется…» → тост «Сдача машины — принято сервером» → «Ожидает приёмки менеджером».

### Приёмка
41. **Given** manager, нет сданных смен **Then** «Нет смен на проверке», кнопка «Демо: открыть как водитель».
42. **Given** смена submitted **Then** бейдж «1» у «Приёмка смен»; очередь: кнопка `aria-pressed="true"` «Р-208 · Илья Васильев», sub «ГАЗель Next · А 412 МР 77», чип «Ожидает приёмки»; статистика «Пробег при выезде» «84 500 км», «При сдаче» «84 560 км», «Пройдено» «60 км», «Топливо» «½ → ½» (по введённым); таблица «Фото до и после» с колонками «Перед выездом»/«При сдаче» и тегами «демо-фото»; «Расходы в пути» со строкой «Топливо» и «Итого заявлено» «2 500 ₽».
43. **Given** manager с `finance.read` **Then** карточка «Начисление водителю за рейс» с «4 500 ₽»; **Given** driver (любой экран) **Then** строки «Начисление» нигде нет, в уведомлениях нет «Начисление по рейсу».
44. **When** «Вернуть на доработку» без замечаний **Then** `role=alert` «Опишите, что нужно исправить»; с текстом, без разделов → «Отметьте хотя бы один раздел для доработки»; с «Фото при сдаче» → тост «Смена возвращена водителю на доработку», чип «На доработке», `role=status` «Возвращено водителю: «…». Исправить: Фото при сдаче.».
45. **Given** driver после rework **Then** `role=alert` «Менеджер вернул смену на доработку», «Исправить: Фото при сдаче», форма «Осмотр при сдаче» с кнопкой «Сдать машину»; повторная сдача → снова «Ожидает приёмки».
46. **When** «Принять смену» **Then** `role=dialog` h2 «Принять смену Р-208?», раздел «Что произойдёт» с «Машина вернётся в пул свободных», «Расходы станут принятыми; кассовые операции создаются отдельно», «Будет создано начисление водителю. Его видят владелец и уполномоченный менеджер» (только при наличии earnings); подтверждение → тост «Смена принята. Машина вернулась в пул», `role=status` «Смена принята в HH:MM. Машина вернулась в пул свободных.», чип «Принят»; у водителя — «Смена принята» и «Начать новую демо-смену»; на `pg.fleet` «свободно» снова «4», одометр ГАЗель Next = 84 560.
47. **Given** смена defect_review **Then** первая в очереди; `role=alert` h2 «Критический дефект · ГАЗель Next А 412 МР 77», «Стёкла: Скол», кнопки «Дефект некритичный — разрешить выезд» и «Подтвердить неисправность»; «разрешить» → тост «Выезд разрешён», у водителя «В рейсе», в приёмке позже дефект «Стёкла · Скол · при выезде · признан некритичным»; «подтвердить» → тост «Неисправность подтверждена, машина снята с рейса», водитель видит planned, ГАЗель Next «Недоступна · неисправность подтверждена».

### Автомобили
48. **Given** driver `pg.cars` **Then** `h1#h-cars` «Автомобили», фильтры «Все»/«Подходят к рейсу»/«Свободны»; «Подходят к рейсу» показывает ГАЗель Next, Mercedes Sprinter, ГАЗон Next; «Свободны» при всех занятых → «По фильтру машин нет».

---

## 15. Открытые вопросы

1. Подпись пункта меню водителя: в шаблоне «Автомобили» (3000), «Машины» появляется только при бренд-термине `vehicle` (2939). Задание называет страницу «Машины» — определить каноническую подпись.
2. README (строка 13) перечисляет статусы «Ошибка — повторить» и «Принято сервером» для фото; в `photoVM` фактические строки «Ошибка загрузки» + кнопка «Повторить» и «Загружено»/«Загружено · демо». «Принято сервером» используется только для расходов и в тосте outbox. Какой набор считать эталоном?
3. `tenant_0002_fleet.sql:158` требует `liters` для `fuel`, UI помечает «Литры» как «Необяз.» и не валидирует.
4. Категории расходов: UI/mock — «Топливо», «Мойка»; SQL — `fuel/wash/parking/toll/other`; LOG-08 — топливо, мойка, парковка, прочие.
5. `POST /fleet/trips/{id}/defect-decision` — PROPOSED, в OpenAPI отсутствует (README:161; `api.js:1032`).
6. Срок брони `reservedUntil` жёстко `'09:30'`; истечение hold (`reservation_expired`) в прототипе не реализовано.
7. Повторная сдача после rework создаёт второй осмотр `return` — конфликт с `unique (trip_id, kind)` в SQL (99); нужна версия/ревизия осмотра или замена.
8. Отметки остановок «Прибыл» живут только в клиенте, API не предусмотрено (LOG-07 требует план/факт).
9. Для outbox-элемента `return` в состоянии `error` нет кнопки ручного повтора; повтор только через переключение связи.
10. `queued` фото засчитываются в «N из 5» и в `inspMissing`, но сервер требует `ready` — для выезда это скрыто (кнопка disabled офлайн), для сдачи решается `waitPhotos` в `flush`. При реализации очереди проверить сценарий «связь есть, фото застряло в queued».
11. Экран «Сегодня» без назначенного рейса — пустого состояния в источниках нет (⚠ не найдено в источниках).
12. Crumb «Илья Васильев · среда, 1 октября» и дата расхода `2026-10-01` зашиты; демо-«сегодня» = 1 октября 2026 (README:163).
13. `trip.earnings` засеян в trips (4500/3800) и копируется в `db.earnings` при приёмке; целевая модель — `finance.earnings` создаётся менеджером (LOG-10). Кто и когда создаёт начисление в реализации?
14. `odoError` > +3000 км — только предупреждение; сервер не проверяет (LOG-09 говорит о блокировке «подозрительного снижения», не роста).
15. Mock-состояние `vehicle.state` вручную переключаемое; 08-domain-scenarios 4.4 требует вычислять техготовность, занятость и доступность из разных источников.
16. Временный водитель из пула (`d-104`) не является участником — войти «как он» нельзя; D09/AC-06 не покрыты прототипом.
17. В `assignVehicle` сервер не проверяет включённость модуля (нет `module_off`), в отличие от `reserve` (`api.js:464–471` vs 448).

---

## 16. Факты для плана

0. **14.10.** Экраны и VM логистики не изменились — анализ годится как бриф этапа 2 после пересчёта строк. Изменилось окружение: меню владельца по D-23 (группа только при подключённом модуле, пункт в «Отключены · только чтение» при отключённом с историей), новые пункты общих модулей у логиста и водителя (`out-of-stage` до этапов 4–7), проведение расходов в кассу переехало в модуль «Касса» (этап 5; в этапе 2 сохранить ключ `tx:<expenseId>`), задачи логистики — проект `fleet` с процессом и проектными ролями (этап 4; в этапе 2 дефект — очередь S2-17).
1. Домен = 5 экранов + 2 confirm-диалога + 1 request-диалог + AccessGate/баннеры/тост; ~520 строк шаблона (428–867) и ~450 строк логики.
2. Единственная организация с данными — `t-alta`; seed: 7 машин, 2 рейса, 2 водителя пула, 0 запросов.
3. Стартовое состояние требует включения модуля и назначения роли логисту — e2e нужен фикстурный seed или прохождение шагов владельца.
4. Чистые функции `compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`, `plural`, `tempLabel` — кандидаты на первый TDD-пакет (`packages/domain`, S0-06).
5. Mock-адаптер — единый интерфейс с HTTP-адаптером; все команды возвращают `{data, db}`; ошибки — `ApiError(code, message, extra)`.
6. Задержки mock: 250–650 мс + загрузка ~0,9 с; e2e должны ждать тостов/состояний, а не фиксированных таймеров.
7. Переходы рейса: 9 состояний, 10 команд; машина: 5 состояний; оба словаря с подписями/тонами/иконками в `models.js`.
8. Фото: 5 слотов × 5 состояний; object URL; прогресс через колбэк; `demo` флаг для стрип-заглушки `STRIPES`.
9. Очередь outbox: 2 вида операций, 3 состояния, автоотправка при `online`, идемпотентность по `opId`.
10. Три одноразовых демо-флага (`online`, `conflictNext`, `failUploadNext`) живут и в состоянии UI, и в адаптере.
11. Права: `can()` + `canEarnings()`; `fleet` view, `pool` edit, `review` review, бронь create (по unit машины), назначение edit (по unit рейса).
12. `earnings` — restricted-поле: вырезается сервером, не должно попадать в DTO водителя, экспорт, поиск, уведомления (AC-05).
13. Брейкпоинты: 640 (мобильный/нижняя навигация), 1080 (rail/sidebar); driver `max-width 680px`; fleet-колонки рядом примерно от 950 px, review-колонки от ~850 px.
14. Tokens цветов фиксированы (TONE/LINE + `--ox-accent*` из бренда); accent по умолчанию `#1F6B52`.
15. Числа форматируются `toLocaleString('ru-RU')` → неразрывные пробелы; селекторы e2e должны использовать `\s`.
16. Форма «Осмотр машины» (`fm-insp`, версия 3) и задача «Проверить осмотр …» создаются побочно при каждом осмотре — связь с модулями «Формы» и «Задачи».
17. Уведомления (`events`) адресные; 10 текстов домена; чувствительные — с проверкой `canEarnings` при выдаче.
18. Нижняя навигация показывает 3 первых пункта + «Ещё» (sheet «Все разделы»).
19. Целевая SQL-схема расходится с mock по единицам (кг/мм), ключам топлива, ролям фото (`odometer`), категориям расходов, `severity` дефектов — нужен слой маппинга или правка схемы.
20. Ошибки целевого API — RFC 9457 `problem+json` с `code`; UI выбирает текст по `code` (`docs/12`).
21. Критерии AC-03 (100 параллельных броней → 1×201, 99×409), AC-04, AC-05, AC-07 — серверные интеграционные тесты, прототип их не покрывает.
22. Esc закрывает модалки; backdrop-клик закрывает; `dlg-title` — id заголовка диалога.
23. `setPage` скроллит `#ox-main` к началу; sticky-панель действий водителя — `bottom:0` внутри скролл-контейнера.
24. Пул водителей и ответы фирмы-владельца — демо-кнопки «Одобрить/Отклонить» (README:159).
25. «Передать в навигатор · интеграция не подключена» — disabled-кнопка, интеграции нет.

---

## 17. DoR этапа 2 (W2.00, 15.10.2026)

Сверка со снимком `design-stage-1` (= `design-stage-2`: экраны логистики 14.10 не менялись) и с контрактом `0.5.0-stage2`. Матрица историй S2-01…S2-19 — `docs/plan/analysis/14-stage2-dor.md`; черновики S2-17…S2-19 — `docs/plan/v2/stories-s2-17-19.md`; экраны — `api/openapi/screens.yaml` (`stage: 2`).

### 17.1 Команды эталона → операции контракта

| Эталон (`api.js`) | Контракт `0.5.0-stage2` | Примечание |
|---|---|---|
| `view()` рейсы `planned…accepted` | `listTripPlans`, `getTripPlan` (`TripPlan`, 9 состояний `TRIP_STATE` + `cancelled`) | `Trip` 0.1 — та же строка после `startTrip` (тот же `id` и ETag); водитель видит только свои рейсы |
| `assignVehicle(tripId, vid)` | `assignTripVehicle` (PUT `/fleet/trips/{tripId}/vehicle`, If-Match) | 409 `vehicle_incompatible` — «Нельзя назначить: …» с причинами `compat`; 409 `reservation_overlap` — «Машину только что забронировали. Обновите список.» |
| `reserve(tripId, vid)` | `reserveVehicle` + `tripId` | «Машина не подходит рейсу: …», «Машина уже недоступна. Обновите список.» |
| `cancelReservation` | `releaseReservation` | право `fleet.reservations.manage` — у водителя нет (14 §3 п. 1) |
| `submitDeparture` | `submitInspection` (departure, `defects[]`) + `startTrip` | критический дефект → осмотр `requires_review`, дефект `in_review`, рейс `defect_review`, машина «Недоступна · критический дефект на проверке» |
| `decideDefect(tid, allow / confirm)` | `decideInspectionDefect` (`allow_departure` / `confirm_out_of_service`) + очередь `listInspectionDefects` | «разрешить» → рейс «Осмотр перед выездом», водитель стартует сам; «подтвердить» → машина «Недоступна · неисправность подтверждена», рейс «Запланирован» |
| `addExpense` | `createTripExpense` (+ `TripExpense.comment`) | «Сумма должна быть больше нуля», «Больше 200 000 ₽ — проверьте сумму» — 422 `amount_invalid`; «Фото чека ещё не загружено» — 409 `photo_not_ready` |
| `finishRoute` | `finishTripRoute` | `on_route` → `returning` |
| `submitReturn` | `submitInspection` (return, `attempt`) + `returnTrip` | повторная сдача после доработки — `attempt + 1` (tenant 0011, Q-51 закрыт) |
| `reviewTrip(accept / rework, steps)` | `reviewTrip` (`approve` / `rework` + `steps[]`) | разделы `photos`, `odometer`, `expenses`, `checklist` (`REV_STEPS`); тексты 422 — дословно эталона; приёмка создаёт начисление (Q-55) |
| `requestDriver` / `decideRequest` | `requestDriverTransfer` + `tripId`, `decideDriverTransfer` | «Запрос уже отправлен» — 409 `invalid_transition`; решает фирма-источник |
| `homeVM` источники 1–3, 6 | `getMyDecisionQueue` (тег `Home`) | `fleet.blocking_defect` (danger), `fleet.trip_review` (warn), `fleet.trip_without_driver` (info), организация — `tenant.trial_ending`, `tenant.trial_ended`, `tenant.storage_high`, `access.members_without_role` |

### 17.2 Ответы на открытые вопросы §15

| № | Вопрос | Решение W2.00 |
|---|---|---|
| 3 | литры для топлива: UI «Необяз.», SQL `not null` | как UI: `quantity` необязательно (MSW); правка CHECK SQL — W2.05 по решению владельца |
| 4 | категории расходов | пять кодов D-12 комплекта в контракте, экран — две кнопки эталона |
| 5 | `defect-decision` PROPOSED | `decideInspectionDefect` (контракт 0.5.0-stage2) |
| 6 | срок брони | `holdExpiresAt` = сейчас + 30 мин (`reservationTtlMinutes`) |
| 7 | второй осмотр `return` и `unique (trip_id, kind)` | tenant 0011: `attempt`, уникальность `(trip_id, kind, attempt)` |
| 13 | кто создаёт начисление | приёмка смены (`reviewTrip approve`), правит владелец (`setTripEarnings`) |
| 17 | `assignVehicle` без проверки модуля | шлюз проверяет модуль для всех операций тега Fleet (`module_read_only` у отключённого) |

### 17.3 Состояние машины эталона ↔ `Vehicle.status` 0.1

free ↔ `available`, reserved ↔ `reserved`, on_route ↔ `in_use`, review ↔ `blocked`, unavailable ↔ `maintenance`; причина — `Vehicle.statusNote` («Плановое ТО до 03.10», «критический дефект на проверке», «неисправность подтверждена»), рейс брони — `heldByTripId` (чип «Назначена на {рейс}»).
