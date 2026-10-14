# 02 · Область владельца «Компания»: модули и место, пользователи и роли, подписка и места, оформление

Рабочая карта для реализующих агентов. Все пути — относительно `design/`. Строки цитируются как `файл:строка–строка`. Тексты интерфейса приведены дословно (в кавычках «»). Там, где источник молчит — пометка «⚠ не найдено в источниках».

## 1. Источники

| Файл | Строки | Что |
|---|---|---|
| `Ортус CRM.dc.html` | 1–27 | helmet: шрифты, CSS-переменные `--ox-accent*`, `button:disabled{opacity:.45}`, `:focus-visible` |
| `Ортус CRM.dc.html` | 28–92 | демо-панель: селект «Персонаж», «Ширина» (auto/390/768/1440), «Путь проверки», «Сбросить», флажки |
| `Ортус CRM.dc.html` | 94–146 | шапка: логотип/знак/буква, короткое имя, организация, селектор области, колокольчик, профиль |
| `Ортус CRM.dc.html` | 149–170 | боковая навигация (sidebar/rail) |
| `Ортус CRM.dc.html` | 172–203 | `<main id="ox-main">`, баннеры, скелетон загрузки, ошибка загрузки, AccessGate |
| `Ортус CRM.dc.html` | 205–281 | шаблон `pg.modules` «Модули и место» |
| `Ортус CRM.dc.html` | 283–420 | шаблон `pg.users` «Пользователи и роли» (вкладки, люди, группы, роли + редактор, проверка доступа) |
| `Ортус CRM.dc.html` | 1246–1445 | шаблон `pg.branding` «Оформление» |
| `Ортус CRM.dc.html` | 1446–1521 | шаблон `pg.billing` «Подписка и места» |
| `Ортус CRM.dc.html` | 2192–2201 | нижняя навигация (<640) |
| `Ортус CRM.dc.html` | 2203–2311 | модальная оболочка; диалоги `mConfirm`, `mAssign`, `mInvite`, `mRole`, `mSheet` |
| `Ортус CRM.dc.html` | 2313–2317 | тост |
| `Ортус CRM.dc.html` | 2323–2379 | константы: `MEMBER`, `PERSONAS`, `TONE`, `LINE`, `ch`, `BR_DEF`, `BR_PALETTE`, `BR_TERMS`, `BR_ICONS`, `BR_LOCK`, контраст, `ACTIONS`, `OBJECTS`, `PRESETS`, `INITIAL` |
| `Ортус CRM.dc.html` | 2401–2490 | `boot`, `reset`, `toast`, `run`, `mark`, `setPersona`, `go`, `setPage`, `closeModal`, `setOnline`, Escape |
| `Ортус CRM.dc.html` | 2669–2788 | `confirm`, `toggleModule`, `applyQuota`, `confirmTrialEnd`, `openAssign`, `patchModal`, `saveAssign`, `removeAssign`, `saveInvite`, `saveCreateRole`, `editRole`, `saveRole` |
| `Ортус CRM.dc.html` | 2821–2823 | `opConfirm` (образец закрытия диалога после `run`) |
| `Ортус CRM.dc.html` | 2826–2893 | `renderVals`: брейкпоинты, `pg`, подключение VM |
| `Ортус CRM.dc.html` | 2895–2901 | `toastVM` |
| `Ортус CRM.dc.html` | 2903–2931 | `guideVM` («Путь проверки») |
| `Ортус CRM.dc.html` | 2933–3001 | `navFor`, `termOf`, `applyBrand`, `brandNav`, `navForBase` |
| `Ортус CRM.dc.html` | 3003–3049 | `shellVM` (шапка, навигация, нижняя панель) |
| `Ортус CRM.dc.html` | 3051–3093 | `gateVM`, `bannersVM` |
| `Ортус CRM.dc.html` | 3095–3238 | `omVM`, `usersVM`, `roleEditorVM`, `accessVM` |
| `Ортус CRM.dc.html` | 3562–3569 | `tierList`, `calc`, `termLabel` |
| `Ортус CRM.dc.html` | 3666–3734 | `brandingVM` |
| `Ортус CRM.dc.html` | 3901–3942 | `billingVM` |
| `Ортус CRM.dc.html` | 3955–4031 | `modalVM` |
| `Ортус CRM.dc.html` | 4050–4057 | `homeVM`: карточки «Подписка», «Место», «Доступ» → переходы в домен |
| `ortus/models.js` | 1–210, 303–304 | `VERBS`, `INDUSTRY`, `CORE`, `ALL_MODULES`, `REASON`, `MEMBER_STATE`, `TENANT_STATE`, `num/rub/plural`, `scopeLabel`, `grants`, `can`, `canEarnings`, `rolePermKeys`, `emailOk`, `initials` |
| `ortus/api.js` | 15–37, 52–60, 70–112, 124–128, 131–144, 147–152, 155–195, 274–303 | mock-адаптер: `view()`, `cmd()`, `assertActive`, `setTenantStatus`, `saveBranding`, `setModule`, `setStorageQuota`, `invite`, `revokeInvite`, `requestSeats`, `cancelSeatRequest`, `assign`, `unassign`, `createRole`, `saveRole`; 573–626 `createHttpAdapter` |
| `ortus/mock-data.js` | 1–19, 42–80, 87–179 | `BRAND_DEFAULT`, `seedBrands`, `seedLotos`, tenants, priceBook, requests, members, groups, roles, assignments, storage |
| `ortus/extra-data.js` | 64–83 | `repair.crew` (карточки без входа) |
| `docs/17-users-and-billing.md` | 1–217 | модель мест, тарифов, заявок, прав, API |
| `docs/18-branding.md` | 1–118 | модель оформления, цвет, термины, меню, версии, API |
| `docs/11-permissions.yaml` | 12–36, 143–191 | права `core.members`, `core.modules`; `role_templates`; `prototype_renames` |
| `README.md` | 7–16, 36–61, 117–145 | UX-решения, дизайн-токены, итерации 5–6 |

## 2. Сводка

- Домен — четыре страницы владельца в группе меню «Компания»: «Модули и место» (`modules`), «Пользователи и роли» (`users`), «Подписка и места» (`billing`), «Оформление» (`branding`) — `Ортус CRM.dc.html:2981`. Иконки: `extension`, `group`, `workspace_premium`, `palette`.
- Видит только персона `owner` (`navForBase` строит группу «Компания» только для `persona === 'owner'`, `:2980–2988`). Для owner на этих страницах `gateVM` всегда возвращает «нет шлюза» (`:3054`). В прототипе нет проверки ключей прав для этих страниц — доступ определяется персоной.
- Каталог прав (`docs/11-permissions.yaml:26–35`): `modules.read`, `modules.manage` (owner_only), `billing.read` (sensitive), `billing.manage` (owner_only); `members.invite`, `roles.manage`, `roles.assign` (`:17–22`); `branding.manage` — только владелец, `branding.read` — все (`docs/18-branding.md:83`).
- Две организации с отдельными «БД» в mock-адаптере: `t-alta` «Альта Групп» (владелец Дарья Зимина, trial, 10 участников) и `t-lotos` «SPA «Лотос»» (Ирина Белова, active, 23 участника) — `ortus/mock-data.js:92–93, 42–80`; общий только `platform` (control DB) — `ortus/api.js:17–19`.
- Все четыре страницы существуют в обеих организациях; персонажи демо-панели: `owner` (Альта) и `owner@t-lotos` (Лотос) — `Ортус CRM.dc.html:36–46`.
- Модули: три отраслевых (`logistics`, `spa`, `repair`) с зависимостями от 9 базовых (`ortus/models.js:24–72`). Отключение переводит модуль в `history: true` («только чтение»), `ortus/api.js:147–151`.
- Место организации: `quotaGb`/`usedGb` тенанта, разбивка `db.storage.breakdown`; лимит выбирается из 25/50/100/250/500 ГБ; уменьшение ниже занятого — диалог с подтверждением (`:2709–2734`).
- Пробный период: `t.status === 'trial'` → карточка с остатком дней, демо-кнопка завершения → `setTenantStatus('t-alta','restricted')` (`:2735–2747`). В `restricted/suspended` — баннер, кнопки «Подключить» и «Изменить лимит» заблокированы, `assertActive` в API.
- Пользователи: вкладки «Люди», «Группы», «Роли», «Проверка доступа» (`:3136`). Назначение = роль + область (организация/регион/фирма) + срок; приглашение = имя + почта + роль + область с проверкой мест.
- Роли: `system` (нередактируемая), `template`, `custom`; редактор — переключатель модуля + чекбоксы действий из манифеста; отдельный «Финансовые разрешения» блок, заблокированный для функции «Водитель» (`:3163–3207`).
- Места: занимает каждый участник со статусом `active` или `invited`; `blocked` и карточки без входа — бесплатно (`ortus/api.js:30–32`, `docs/17-users-and-billing.md:30–46`).
- Тарифы: версия сетки `priceBook.current` (v2: Старт 10/3 900, Команда 25/8 900, Бизнес 50/15 900, Сеть 100/27 900, Безлимит); сроки 1/4/8/12 мес со скидкой 0/5/10/20% (`ortus/mock-data.js:98–108`). Заявка владельца → оператор подтверждает; одна открытая заявка на организацию.
- Оформление: название (1–60), короткое имя (≤16), логотип/знак (PNG/SVG/JPG/WebP ≤1 МБ), акцент из 8 цветов палитры или HEX с автокоррекцией до контраста 4.5:1, термины в 4 формах, меню (название/иконка/порядок/скрытие, 5 пунктов нельзя скрыть), «Работает на Ортус», предпросмотр (приложение/публичная форма/письмо), версии (`:3666–3734`, `docs/18-branding.md`).
- Значимые изменения проходят через общий диалог `confirm` с разделами последствий и опциональной галочкой-подтверждением (`:2669`, `:3960–3968`).
- Все команды идут через `this.run(key, fn, okToast, {quiet})` → `busy`, тост успеха/ошибки, подмена `db` ответом сервера (`:2445–2460`).

## 3. Инвентарь

| Ключ | Подпись в меню / заголовок | Персоны | Орг. | Шаблон | VM / обработчики |
|---|---|---|---|---|---|
| `pg.modules` | «Модули и место» / h1 «Модули и место» | owner | t-alta, t-lotos | `:205–281` | `omVM :3095–3132`; `toggleModule :2670–2708`; `applyQuota :2709–2734`; `confirmTrialEnd :2735–2747` |
| `pg.users` | «Пользователи и роли» / h1 «Пользователи и роли» | owner | обе | `:283–420` | `usersVM :3134–3161` |
| `usersTab=people` | вкладка «Люди» | owner | обе | `:296–318` | `usersVM :3140–3150`; `openAssign :2748–2751` |
| `usersTab=groups` | вкладка «Группы» | owner | обе | `:320–332` | `usersVM :3151` |
| `usersTab=roles` | вкладка «Роли» (список + редактор + «Итоговые права роли») | owner | обе | `:334–391` | `usersVM :3152–3156`; `roleEditorVM :3163–3207`; `editRole :2779–2784`; `saveRole :2785–2788` |
| `usersTab=check` | вкладка «Проверка доступа» | owner | обе | `:393–418` | `accessVM :3209–3238`; константы `:2365–2367` |
| `pg.billing` | «Подписка и места» / h1 «Подписка и места» | owner | обе | `:1446–1521` | `billingVM :3901–3942`; `tierList/calc/termLabel :3562–3569` |
| `pg.branding` | «Оформление» / h1 «Оформление» | owner | обе | `:1246–1445` | `brandingVM :3666–3734`; `brandNav :2944–2958`; `applyBrand :2938–2943` |
| `modal.kind=confirm` | диалог последствий (подключить/отключить модуль, лимит, trial, отозвать приглашение) | owner | обе | `:2206–2228` | `modalVM :3960–3968`; `confirm :2669` |
| `modal.kind=assign` | «Назначить роль» | owner | обе | `:2230–2251` | `modalVM :3969–3996`; `saveAssign :2753–2761`; `removeAssign :2762` |
| `modal.kind=invite` | «Пригласить участника» | owner | обе | `:2253–2272` | `modalVM :3997–4012`; `saveInvite :2763–2771` |
| `modal.kind=createRole` | «Создать роль» | owner | обе | `:2274–2288` | `modalVM :4013–4025`; `saveCreateRole :2772–2778` |
| `modal.kind=sheet` | лист «Все разделы» (мобильная кнопка «Ещё») | все | обе | `:2300–2308` | `shellVM :3027–3028` |
| баннеры | «Пробный период завершён.», «Место организации заполнено.», «Нет связи.» | owner | обе | `:174–180` | `bannersVM :3080–3093` |
| скелетон / ошибка | «Загружаем рабочее пространство…» / «Не удалось загрузить модули прототипа: …» | все | — | `:182–193` | `renderVals :2846, 2852–2854` |
| тост | — | все | — | `:2313–2317` | `toastVM :2895–2901`; `toast :2440–2444` |

## 4. Общий каркас, релевантный домену

### 4.1 Брейкпоинты и раскладка (`:2826–2844`)

- `W = frame !== 'auto' ? min(frame, w) : w`; `mobile = W < 640`; `rail = !mobile && W < 1080`; `showLabels = !mobile && !rail`.
- Боковая панель: ширина `244px` (sidebar ≥1080) / `68px` (rail 640–1079); `background:#F8F9F6;border-right:1px solid #DCE2D9` (`:150`). Пункт: `min-height:40px;border-radius:8px`, активный `bg var(--ox-accent-soft)`, `fg var(--ox-accent)`, `font-weight:600`, `aria-current="page"`; hover `#EBEFE9` (`:155`, `:3022`).
- Нижняя навигация `<nav aria-label="Навигация">` при `mobile`: первые 3 пункта плоского списка + «Ещё» (`menu`), кнопка `min-height:60px`, иконка 24px с `FILL 1` у активного (`:2192–2201`, `:3025–3028`). Для owner: «Главная», «Модули» (замена «Модули и место»), «Люди» (замена «Пользователи и роли»), «Ещё». «Подписка и места» и «Оформление» на телефоне доступны только через лист «Все разделы» (`:2300–2308`).
- `<main id="ox-main">`: контейнер `max-width: 1320px` (owner), `padding: '24px 28px 40px'` / mobile `'16px 14px 28px'`, `gap:16px` (`:172–173`, `:2844`). Прокрутка — у `main` (`overflow-y:auto`), при `setPage` `scrollTop = 0` (`:2480`).
- Внутри страниц раскладка — flex-wrap с `flex: N 1 Xpx`, таблиц нет; на 390 колонки складываются в одну.
- Демо-панель: «Ширина» → `frame` 390/768/1440: рамка с радиусом 22px (390) / 12px (`:2840–2841`).

### 4.2 Состояния каркаса

| Состояние | Триггер | Разметка |
|---|---|---|
| loading | `!live` (`:2852`) | `role="status" aria-label="Загрузка"`, 4 блока с анимацией `ox-pulse`, текст «Загружаем рабочее пространство…» (`:182–190`) |
| loadErr | `s.err` | `role="alert"` «Не удалось загрузить модули прототипа: {{ loadErrText }}» bg `#FBEAE7` fg `#A13A33` (`:191–193`) |
| AccessGate | `gate.show` — для owner на 4 страницах домена никогда (`:3054`) | `:195–203` |
| Баннер «Пробный период завершён.» | `['restricted','suspended'].includes(t.status)`; текст «Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.»; у owner кнопка «Демо: продлить как оператор» → `go('operator','tenants')`; tone warn, icon `lock_clock`, `role="status"` (`:3085`) | `:174–180` |
| Баннер «Место организации заполнено.» | `t.usedGb >= t.quotaGb`; текст owner «Новые загрузки заблокированы, файлы не удалены. Освободите место или увеличьте лимит.»; кнопка «Открыть «Модули и место»» если `page !== 'modules'`; tone danger → `role="alert"`, icon `storage` (`:3091`) | |
| Баннер «Нет связи.» | `!s.online`; «Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.»; warn `cloud_off` (`:3087–3089`) | |
| offline-команда | любой `api.*` при `flags.online=false` → `ApiError('offline','Нет связи с сервером. Операция не выполнена.')` → тост warn (`ortus/api.js:52`, `:2457`) | тост |
| busy | `s.busy === key` на время `run`; кнопки с `disabled` по `busy` | — |

Баннер: `padding:12px 14px;border-radius:10px;border:1px solid {{ b.line }}`, кнопка действия `min-height:36px;border:1px solid currentColor` (`:175–178`). Тона: `TONE` (`:2329`) и `LINE` (`:2330`):

| tone | bg | fg | line |
|---|---|---|---|
| ok | `#E3EFE7` | `#1F6B52` | `#BFD9C8` |
| info | `#E7EEF6` | `#2B5479` | `#C9D8E8` |
| warn | `#FAF1DC` | `#7A5214` | `#EBD7A8` |
| danger | `#FBEAE7` | `#A13A33` | `#F0C9C3` |
| neutral | `#ECEFEA` | `#4C5955` | `#DCE2D9` |

### 4.3 Модальная оболочка (`:2203–2205`, `:3957`)

- Подложка `position:absolute;inset:0;z-index:50;background:rgba(28,42,38,.42)`; клик по подложке закрывает (`onBackdrop`), Escape закрывает (`:2406–2410`).
- `role="dialog" aria-modal="true" aria-labelledby="dlg-title"`, `max-width:560px` (assign — `620px`), `border-radius:14px`; на mobile — снизу (`align-items:flex-end`, `padding:0`, радиус `16px 16px 0 0`).
- Кнопки диалогов `min-height:44px`; вторичная `border:1px solid #CDD5CB;background:#FFFFFF`; основная `bg var(--ox-accent)`, у danger-confirm `#A13A33` (`:3966`).

### 4.4 Тост (`:2313–2317`, `:2895–2901`, `:2440–2444`)

`position:absolute;left:50%;bottom:{{ toastBottom }}` (76px mobile / 20px), `bg #1C2A26`, `color #FFFFFF`, `aria-live="polite"`, `role` = `alert` при tone error иначе `status`; живёт 4200 мс. Иконки: ok `check_circle #8FD3AE`, warn `cloud_off #F0C76E`, error `error #F2A99E`, info `info #A9C8EA`.

### 4.5 Шапка — что из домена видно вне его (`:94–122`, `:3030–3040`)

- Логотип (`role="img" aria-label="{{ top.tenant }}"`, 32×160, `background:center/contain url(logo)`) → иначе знак 32×32 radius 9 → иначе буква на `var(--ox-accent)` (`top.letter` = первая буква `short` или «о»).
- `top.brandName` = `short || 'ортус'` (17px 600), подпись «пространство бизнеса»; `top.tenant` = `tenant.name`.
- `applyBrand(tenant.brand)` ставит `--ox-accent`, `--ox-accent-hover`, `--ox-accent-soft`, `--ox-accent-tint` на `documentElement` при каждом рендере шапки; у оператора — стандартный цвет (`:3033`, `:2938–2943`).
- Селектор области `aria-label="Область просмотра"` только у owner (`:109–113`); на страницы домена не влияет.

## 5. Страница «Модули и место» (`pg.modules`)

### 5.1 Идентификатор
- `page === 'modules'`, `pages.owner`; пункт меню «Модули и место», иконка `extension`, группа «Компания» (`:2981`); nav-id `modules` входит в `BR_LOCK` (нельзя скрыть).
- Персона: owner. Права по каталогу: `modules.read`/`modules.manage` (owner_only), `billing.read`/`billing.manage` для лимита места (`docs/11-permissions.yaml:30–35`). Организации: обе.
- Переходы сюда: меню; AccessGate у других страниц «Открыть «Модули и место»» (`:3059, 3073`); баннер места; карточки «Главной» (`:4053–4055`); «Путь проверки» шаг 1 «Владелец: подключить «Логистику»» (`:2906`).

### 5.2 Раскладка (`:206`)
`<section aria-labelledby="h-mod">`, колонка `gap:20px`: (1) заголовок, (2) карточка подписки/trial, (3) «Отраслевые модули» — грид `repeat(auto-fill,minmax(min(100%,280px),1fr))` gap 12, (4) «Базовые модули» — грид `minmax(min(100%,210px),1fr)` gap 8, (5) карточка «Место организации». Sticky-элементов нет.

### 5.3 Элементы (в порядке DOM)

| # | Элемент | Текст / привязка | Стили | Источник |
|---|---|---|---|---|
| 1 | крошка | «{{ top.tenant }} / Компания» → «Альта Групп / Компания» | 13px `#5C6964` | `:208` |
| 2 | `h1#h-mod` | «Модули и место» | 26px/1.2 600 `letter-spacing:-0.02em` | `:209` |
| 3 | p | «Подключение модуля открывает его организации. Сотрудники получают доступ только через роли и области.» | `#5C6964` max 680 | `:210` |
| 4 | карточка статуса | иконка 40×40 radius 10 `bg om.trial.chip.bg`; `strong` `om.trial.title` 16px; pill `om.trial.chip.label` с иконкой 15px; текст `om.trial.text` 13px | `bg #FFFFFF;border:1px solid #DCE2D9;radius 12;padding 18px 20px` | `:212–222` |
| 4a | кнопка (isTrial) | «Демо: завершить пробный период» → `confirmTrialEnd` | вторичная 40px | `:220` |
| 4b | кнопка (isRestricted) | «Демо: открыть как оператор» → `go('operator','tenants')` | вторичная | `:221` |
| 5 | `h2` | «Отраслевые модули» | 17px 600 | `:225` |
| 6 | `article` × 3 (`om.industry`) | иконка 40×40 `bg var(--ox-accent-soft) color var(--ox-accent)` `m.icon`; pill `m.chip`; `h3` `m.name` 16px; p `m.desc` 13px; строка «Использует:» + чипы `m.deps` (`bg #F2F3EF;color #3A4844;radius 6`, иконка `check` 14px accent); строка с иконкой `badge` 18px `#5C6964` + `m.roleNote` | `bg #FFFFFF;border #DCE2D9;radius 12;padding 18px;gap 12` | `:228–241` |
| 6a | кнопка (m.off) | «Подключить», `disabled="{{ m.locked }}"` | основная 40px padding 0 16px | `:237` |
| 6b | кнопка (m.on) | «Отключить» | вторичная | `:238` |
| 6c | кнопка (m.showNext) | «Назначить роли» + `arrow_forward` 18px → `openAssign('m-kotova','r-manager',true)` | текстовая, `color var(--ox-accent)` | `:239`, `:3113` |
| 7 | `h2` + подпись | «Базовые модули» · «Всегда включены, используются отраслевыми модулями» | 17px / 13px `#5C6964` | `:247` |
| 8 | плитки × 9 (`om.core`) | иконка 20px accent `c.icon`; `c.name` 500; `c.usedBy` 12px `#5C6964` | `padding 12;border #DCE2D9;radius 10` | `:250–253` |
| 9 | карточка «Место организации» | `h2` «Место организации»; подпись «Фото, документы и вложения всех модулей»; число `{{ om.st.used }} из {{ om.st.quota }}` (22px 600, «из …» 15px 400 `#5C6964`) | `padding 20;gap 14` | `:258–262` |
| 10 | `div role="meter" aria-label="Занятое место" aria-valuemin="0" aria-valuemax="{{ om.st.quotaNum }}" aria-valuenow="{{ om.st.usedNum }}"` | полоса 8px radius 99 `bg #ECEFEA`; заливка `width om.st.pct`, `bg om.st.bar` | | `:263` |
| 11 | разбивка (`om.st.breakdown`) | строки `b.label` / `b.gb`, 13px, `border-bottom:1px solid #E8ECE5` | грид `minmax(min(100%,220px),1fr)` | `:264–266` |
| 12 | alert (om.st.over) | `role="alert"` иконка `error`, текст `om.st.overText` | `bg #FBEAE7;color #A13A33;border #F0C9C3;radius 10` | `:267–269` |
| 13 | `label` «Лимит места» + `select` | опции `om.st.options`; `value om.st.pick`; `onChange om.st.onPick` | `min-height 44;font-size 16;border #CDD5CB;radius 8` | `:271–275` |
| 14 | кнопка | «Изменить лимит», `disabled="{{ om.st.same }}"` → `applyQuota` | основная 44px | `:276` |
| 15 | подпись | «Стоимость не рассчитывается: тарифы не согласованы. Уменьшение лимита не удаляет файлы.» | 12px `#5C6964` | `:277` |

### 5.4 Вычисления `omVM` (`:3095–3132`)

Карточка статуса (`t = db.platform.tenants[0]`, `restricted = ['restricted','suspended'].includes(t.status)`):

| Условие | chip | title | text | флаги |
|---|---|---|---|---|
| restricted | «Ограничен» warn `lock_clock` | «Пробный период завершён» | «Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Продление выполняет оператор платформы.» | isRestricted |
| `status==='trial'` | «Пробный период» info `hourglass_top` | «Осталось {n} {день/дня/дней} · до {trialEnds}» → Альта: «Осталось 12 дней · до 13.10.2026» | «После окончания история останется доступной для чтения, новые операции будут ограничены. Данные не удаляются.» | isTrial |
| иначе (active) | «Действует» ok `check_circle` | «Подписка действует» | «Условия подписки задаёт оператор платформы.» | — |

Карточка модуля (`:3105–3115`): `on = db.modules[key]?.enabled`; `hist = !on && db.modules[key]?.history`; `n = holders(key)` — число участников, у которых есть назначение не-системной роли с действиями этого модуля (`:3104`).

| Поле | Значение |
|---|---|
| chip | on → «Подключён» ok `check_circle`; hist → «Отключён · только чтение» neutral `history`; иначе «Не подключён» neutral `radio_button_unchecked` |
| roleNote | on и n>0 → «Доступ через роли: {n} {сотрудник/сотрудника/сотрудников}»; on и n=0 → «Сотрудникам доступ не выдан — назначьте роли»; off и n>0 → «Роли с правами модуля есть у: {n} …. Они заработают после подключения»; off и n=0 → «Права сотрудникам не выдаются автоматически» |
| locked | `restricted || s.busy === 'mod'` |
| showNext | `on && key === 'logistics' && !s.prog.assigned` |
| deps | имена из `M.CORE[k].name` |

Данные модулей (`ortus/models.js:24–60`):

| key | name | icon | desc | deps (имена) | adds | templates |
|---|---|---|---|---|---|---|
| logistics | «Логистика» | `local_shipping` | «Машины, рейсы, осмотры, расходы в пути и приёмка смен.» | «Календарь», «Файлы», «Формы» | «Рабочее место логиста», «Мобильная смена водителя», «Осмотры с обязательными фото», «Приёмка смен» | «Менеджер логистики», «Водитель» |
| spa | «Салон и SPA» | `spa` | «Запись, специалисты, кабинеты, техкарты и списание материалов.» | «Календарь», «Склад и материалы», «Внутренняя касса», «Формы» | «Расписание специалиста», «Визиты и техкарты», «Списание материалов» | «Массажист» |
| repair | «Ремонт и стройка» | `construction` | «Объекты, виды работ, бригады, материалы и фотоотчёты.» | «Задачи», «Склад и материалы», «Файлы» | «Объекты и этапы», «Отметки прораба», «Фотоотчёты» | «Прораб» |

Базовые модули (`ortus/models.js:62–72`), порядок: «Календарь» `calendar_month`, «Задачи» `task_alt`, «База знаний» `menu_book`, «Формы» `dynamic_form`, «Данные» `table_view`, «Файлы» `folder_open`, «Склад и материалы» `inventory_2`, «Внутренняя касса» `account_balance_wallet`, «Уведомления» `notifications`. `usedBy`: «Использует: {имена включённых отраслевых модулей, зависящих от него}» или «Общий модуль ядра» (`:3116–3117`). Исходно (только spa): Календарь, Формы, Склад и материалы, Внутренняя касса → «Использует: Салон и SPA».

Место (`:3118–3130`): `used = M.num(round1(usedGb)) + ' ГБ'` → «46,2 ГБ»; `quota = quotaGb + ' ГБ'` → «100 ГБ»; `pct = min(100, used/quota*100).toFixed(1)+'%'`; `bar`: over → `#A13A33`, pct>85 → `#B7791F`, иначе `var(--ox-accent)`; `over = usedGb >= quotaGb`; `overText` = «Занято больше лимита на {x} ГБ. Новые загрузки заблокированы, файлы не удалены. Освободите место в разделе «Файлы» или увеличьте лимит.»; `options` = 25/50/100/250/500 → «{n} ГБ» + « · меньше занятого» если `n < usedGb`; `pick = s.quotaPick ?? quotaGb`; `same = Number(pick) === quotaGb || restricted`.

Исходные данные: Альта `quotaGb 100, usedGb 46.2`, breakdown «Фото осмотров и отчётов» 31,4; «Документы» 9,8; «Вложения задач и форм» 3,1; «Прочее» 1,9 (`ortus/mock-data.js:92, 148–150`). Лотос `50 / 12.4`: «Фото работ и техкарты» 6,2; «Документы» 3,9; «Вложения задач и форм» 1,6; «Прочее» 0,7 (`:59`).

### 5.5 Диалоги (все — `confirm`, шаблон `:2206–2228`)

Структура confirm: круг 42px `mc.chip` с иконкой 22px; `h2#dlg-title` 18px; p 14px `#5C6964`; секции (заголовок uppercase 12px `#5C6964`; пункты с иконкой 18px цвета тона); при `hasAck` — чекбокс 20px в рамке `#DCE2D9` bg `#F8F9F6` min-height 48; кнопки «Отмена» и `mc.confirmLabel` (`disabled = busy || (needAck && !ack)`, текст «Выполняем…» при busy; цвет `#A13A33` для danger).

**Подключить модуль** (`toggleModule`, `:2673–2688`): tone ok, icon `def.icon`; title «Подключить «{name}»?»; text «Модуль станет доступен организации «{tenant.name}». Права сотрудникам не выдаются автоматически.»; секции: «Что появится» — `adds` (`add_circle`, ok); «Зависимости» — «{Имя базового} — уже включён» (`check_circle`, ok); «Важно» — «Шаблоны ролей: {templates через ", "}. Назначьте их сотрудникам в «Пользователи и роли».» (`badge`, info) и «Подключается в рамках пробного периода. Стоимость не рассчитывается: тарифы не согласованы.» (`hourglass_top`, neutral); confirmLabel «Подключить» → `run('mod', api.setModule(key,true), 'Модуль «{name}» подключён')` → `modal:null`; для logistics `mark('logistics')`.

**Отключить модуль** (`:2690–2707`): tone danger, icon `extension_off`; title «Отключить «{name}»?»; text «Данные не удаляются. Модуль перейдёт в режим чтения истории.»; «Затронет сейчас»: для logistics — рейсы со статусом не `planned/accepted`: «Рейс {id} · {TRIP_STATE.label} · {driverName}» (`route`, warn); плюс всегда для logistics «Форма «Осмотр машины» v3 — приём новых ответов остановится» (`dynamic_form`, neutral) и «Автоматизация «Ответ осмотра → задача менеджеру» будет приостановлена» (`bolt`, neutral); если пусто — «Активных процессов нет» (`check`, ok); «Что произойдёт»: «Новые брони, рейсы и осмотры будут закрыты» (`block`, danger), «Начатые смены можно безопасно завершить и принять» (`task_alt`, ok), «История, назначения ролей и файлы сохраняются» (`history`, neutral); `needAck`, ackLabel «Понимаю последствия для текущей работы»; confirmLabel «Отключить модуль» → `api.setModule(key,false)`, тост «Модуль отключён. История доступна для чтения».

**Изменить лимит** (`applyQuota`, `:2709–2734`), `gb = Number(quotaPick ?? quotaGb)`:
- `gb < usedGb`: tone danger, icon `storage`; title «Новый лимит меньше занятого места»; text «Занято {num(usedGb)} ГБ, новый лимит {gb} ГБ. Не хватает {num(lack)} ГБ.» (lack = round1(used − gb)); «Что произойдёт»: «Новые загрузки фото и вложений будут заблокированы» (`block`, danger), «Существующие файлы не удаляются автоматически» (`inventory_2`, ok), «Фото уже начатых смен загружаются в пределах временного резерва» (`task_alt`, ok); «Что сделать»: «Освободите не менее {lack} ГБ в разделе «Файлы»» (`folder_open`, info), «или выберите лимит от 50 ГБ» (`tune`, info — число 50 захардкожено); `needAck`, ackLabel «Понимаю: новые загрузки будут недоступны»; confirmLabel «Всё равно применить».
- иначе: tone ok, icon `storage`; title «Изменить лимит на {gb} ГБ?»; text «Занято {used} ГБ. Стоимость не рассчитывается: тарифы не согласованы.»; секций нет; confirmLabel «Изменить».
- apply → `run('quota', api.setStorageQuota(gb), 'Лимит места: {gb} ГБ')` → `modal:null, quotaPick:null`. Сервер: `assertActive()` (в restricted → `subscription_restricted` «Пробный период завершён: новые операции недоступны. История доступна для чтения.»), `tenant().quotaGb = gb`, событие владельцам «Лимит места изменён на {gb} ГБ» (`ortus/api.js:152`).

**Завершить пробный период** (`confirmTrialEnd`, `:2735–2747`): tone warn, icon `lock_clock`; title «Смоделировать окончание пробного периода?»; text «Обычно это происходит по сроку или по решению оператора платформы.»; «Что произойдёт»: «Новые брони, рейсы, приглашения и изменения лимитов ограничиваются» (`block`, warn), «Начатые смены можно завершить и принять» (`task_alt`, ok), «История доступна для чтения, данные не удаляются» (`history`, neutral); confirmLabel «Завершить пробный период» → `api.setTenantStatus('t-alta','restricted')` (id захардкожен), тост «Пробный период завершён (демо)». Сервер: `t.status='restricted'; trialDaysLeft=0`; audit; событие «Пробный период завершён. Новые операции ограничены, данные сохранены.» (`ortus/api.js:124–128`).

### 5.6 Данные и API

| Действие | Адаптер | Изменяет | Событие/журнал |
|---|---|---|---|
| подключить/отключить | `setModule(key, enabled)` → http `PATCH /tenants/{id}/modules/{key}` | `db.modules[key] = {enabled, history}`; `tenant.modules` | «Подключён модуль «…»» / «Отключён модуль «…». История сохранена.» (`ortus/api.js:147–151`, `:602`) |
| лимит | `setStorageQuota(gb)` → `POST /tenants/{id}/storage/changes {quotaGb, mode:'apply'}` | `tenant.quotaGb` | «Лимит места изменён на N ГБ» (`:152`, `:604`) |
| trial | `setTenantStatus(id, status)` → `PATCH /platform/tenants/{id} {status}` | `tenant.status`, `trialDaysLeft` | audit + событие (`:124–128`, `:589`) |

Читает: `db.platform.tenants[0]` (`status`, `trialDaysLeft`, `trialEnds`, `quotaGb`, `usedGb`), `db.modules`, `db.storage.breakdown`, `db.members`, `db.assignments`, `db.roles`, `db.trips` (для диалога отключения).

## 6. Страница «Пользователи и роли» (`pg.users`)

### 6.1 Идентификатор
- `page === 'users'`; меню «Пользователи и роли», `group`; `BR_LOCK`. Персона owner; права `members.read/invite/manage`, `roles.read/manage/assign` (`docs/11-permissions.yaml:17–22`). Обе организации.
- Состояние: `usersTab` ('people' по умолчанию), `roleSel` ('r-manager'), `roleDraft`, `roleOpen` ({logistics:true}), `access` ({member:'m-kotova', action:'fleet.view', object:'v1'}) (`:2373–2374`).
- Переходы: меню; «Назначить роли» из модулей (`openAssign(...,true)` → `pages.owner='users'`, `usersTab='people'`, модал assign, `:2749`); «Пригласить» из биллинга (`:3940`); «Главная» карточка «… сотрудник(ов) без роли» → `usersTab:'people'` (`:4057`); AccessGate «Демо: открыть как владелец» → `go('owner','users')` (`:3077`).

### 6.2 Раскладка
`<section aria-labelledby="h-users">` gap 16: заголовок; `div role="tablist" aria-label="Разделы доступа"` с `border-bottom:1px solid #DCE2D9`; содержимое вкладки. Вкладка «Роли»: две колонки flex-wrap — список `flex:1 1 240px;max-width:{{ us.listMax }}` (300px при `w >= 1080`, иначе 100%; ⚠ `usersVM(db, s.w)` получает ширину **окна** `s.w`, а не кадра `W = min(frame, s.w)` (`:2829, 2867, 3157`) — при «Ширина 390» на широком окне список остаётся 300px; та же ошибка у `rv.listMax` `:2870` и `fm.listMax` `:2880` (05 §10 Q11, 06 §14 Q2). Реализация: воспроизводить как есть в прототипе, в приложении считать от ширины вьюпорта; зафиксировать в `decisions.md`) и правая часть `flex:999 1 520px`, внутри редактор `flex:3 1 380px` и aside `flex:2 1 260px` (`:336, 345–346, 380`). Вкладка «Проверка доступа»: две карточки `flex:1 1 320px` (`:395, 402`).

### 6.3 Шапка и вкладки (`:286–294`, `:3136–3139`)

- Крошка «{{ top.tenant }} / Компания и доступ»; `h1#h-users` «Пользователи и роли»; p «Роль задаёт действия, область — данные, к которым они применяются. Один сотрудник может иметь разные роли в разных фирмах.»
- Вкладки (`button role="tab" aria-selected`): «Люди» (счётчик `db.members.length` → 10), «Группы» (2), «Роли» (5), «Проверка доступа» (без счётчика). Стили: `min-height:44px;padding:0 12px;border-bottom:2px solid {{ t.line }}` (`var(--ox-accent)`/`transparent`), `color` `var(--ox-accent)`/`#3A4844`, `font-weight` 600/500; счётчик 12px pill `bg #ECEFEA;color #4C5955`.

### 6.4 Вкладка «Люди» (`:296–318`, `:3140–3150`)

| Элемент | Текст / привязка | Стили |
|---|---|---|
| `us.peopleNote` | «{N} участников» + « · без роли: {k}» (если k>0) + « · мест занято {seatsUsed} из {seatsLimit}» (если лимит) → Альта: «10 участников · без роли: 6 · мест занято 9 из 10» (слово «участников» не склоняется) | 13px `#5C6964` |
| кнопка «Пригласить» | иконка `person_add` 18px → `modal {kind:'invite', name:'', email:'', roleId:'', scope:'f-msk-sever', errs:{}, tried:false, err:null}` | основная 40px |
| карточка-список | строки `us.people`, `border-top:1px solid {{ p.line }}` (`#E8ECE5`, у первой `transparent`), `padding 14px 16px` | `bg #FFFFFF;border #DCE2D9;radius 12;overflow hidden` |
| аватар | `p.initials` (`M.initials`: первые буквы двух слов) 38px круг `bg var(--ox-accent-soft);color var(--ox-accent)` 13px 600 | |
| имя/почта | `p.name` 500; `p.email` 13px `#5C6964` ellipsis | `flex:1 1 220px` |
| чип статуса | `MEMBER_STATE`: «Активен» ok `check_circle`; «Приглашён» warn `schedule`; «Заблокирован» danger `block`; под ним `p.note` = `invitedNote` («Приглашение до 06.10») | `flex:0 0 136px` |
| назначения | строки «{role} · {scope}[ · до {until}][ · через {via}]»; например «Водитель · Москва / Север Логистик · через группа «Водители Север»» | 13px, role 500, остальное `#5C6964` |
| noAssign | иконка `info` 16px + «Без роли — нет доступа к модулям» | `#7A5214` |
| isDriver | «Функция «Водитель»: начисления недоступны через любую роль» | 12px `#5C6964` |
| кнопка «Назначить роль» | `disabled="{{ p.blocked }}"` (status blocked) → `openAssign(m.id,'')` | вторичная 40px |

`scopeLabel` (`ortus/models.js:161–167`): tenant → «Вся организация»; region → «Регион {name}»; firm → «{Регион} / {Фирма}»; self → «Только назначенное лично»; null → «Область не выбрана».

Исходные участники Альты (`ortus/mock-data.js:151–162, 174–179`): Дарья Зимина (Владелец бизнеса · Вся организация), Марина Котова (без роли), Илья Васильев (Водитель · Москва / Север Логистик · через группа «Водители Север»; driver), Анна Морозова (Массажист · Только назначенное лично), Алексей Соколов (Прораб · Только назначенное лично), Олеся Петрова (invited, «Приглашение до 06.10», без роли), Кирилл Громов (blocked, driver, без роли, кнопка disabled), Вера Котельникова (без роли), Тимур Ахмедов (driver, без роли), Сергей Ильин (invited, «Приглашение до 07.10»).

### 6.5 Вкладка «Группы» (`:320–332`, `:3151`)
- p «Группа упрощает назначение ролей, но не объединяет данные фирм: область задаётся в каждом назначении.»
- Карточки грид `minmax(min(100%,300px),1fr)`: иконка `groups` 22px accent + `h3` имя; «{n} {участник/участника/участников}: {имена через ", "}»; «Роли через группу: {Роль · область; …}» если есть назначение с `via`, содержащим имя группы, иначе «Роли через группу не назначены».
- Кнопка `disabled` «Создать группу · следующая итерация».
- Альта: «Диспетчеры Север» — «2 участника: Марина Котова, Олеся Петрова», «Роли через группу не назначены»; «Водители Север» — «2 участника: Илья Васильев, Кирилл Громов», «Роли через группу: Водитель · Москва / Север Логистик».

### 6.6 Вкладка «Роли» — список (`:336–344`, `:3152–3156`)
- Кнопка «Создать роль» (`add`) → `modal {kind:'createRole', name:'', mode:'empty', templateId:'r-manager', copyId:'r-manager', err:null}`.
- Кнопка роли `aria-pressed="{{ r.sel }}"`, `padding 12px 14px;radius 10;border:1px solid {{ r.border }}` (`var(--ox-accent)` / `#DCE2D9`), `bg` `var(--ox-accent-tint)` / `#FFFFFF`; имя 600; чип вида 11px: «Системная» info, «Шаблон» neutral, «Своя» ok (без иконки); `r.meta` = («Все права» | «{n} разрешений») + « · назначена: {k}». Клик → `roleSel = id, roleDraft = null`.
- Альта: «Владелец бизнеса» Системная «Все права · назначена: 1»; «Менеджер логистики» Шаблон «22 разрешений · назначена: 0»; «Водитель» Шаблон «10 разрешений · назначена: 1»; «Массажист» Шаблон «5 разрешений · назначена: 1»; «Прораб» Шаблон «6 разрешений · назначена: 1» (подсчёт `rolePermKeys`, `ortus/models.js:200–210`).

### 6.7 Редактор роли (`:346–379`, `:3163–3207`)

`saved = roles[roleSel] || roles[0]`; `role = roleDraft (если тот же id) || saved`; `dirty = role !== saved && JSON differs`.

| Элемент | Привязка / текст | Стили |
|---|---|---|
| `label` «Название роли» + input | `re.name`, `onChange re.onName`, `disabled="{{ re.isSystem }}"` | 44px, 16px |
| блок системной роли (isSystem) | `shield_person` + «Системная роль: все модули и области организации. Не редактируется и защищает от потери доступа последним владельцем.» | `bg #E7EEF6;color #2B5479` |
| блок водителя (isDriver = `role.professional==='driver'`) | `badge` + «Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.» | `bg #FAF1DC;color #7A5214` |
| `h3` «Модули и действия» (editable = не system) | | 14px 600 |
| строка модуля × 11 (`re.modules`; все `ALL_MODULES` с `perms`, порядок: logistics, spa, repair, calendar, tasks, knowledge, forms, data, files, inventory, cash) | иконка 20px `m.iconFg` (`#8A968F` если off иначе accent); `m.name` 500; `m.note`: off → «Модуль не подключён организацией — включение недоступно» (`#7A5214`), on → «{k} из {M} действий», иначе «Нет доступа» | `border-top #E8ECE5;padding 10px 0` |
| кнопка раскрытия (canExpand = on) | `aria-expanded`, `aria-label` «Показать действия: {name}» / «Свернуть действия: {name}», иконка `expand_more`/`expand_less` | 36×36 |
| переключатель | `button role="switch" aria-checked="{{ m.onStr }}" aria-label="Доступ роли к модулю {name}"`, `disabled="{{ m.off }}"` (off = отраслевой и не подключён); `track` `var(--ox-accent)`/`#C3CCC1`, кноб 20px `margin-left` 18px/0 | 44×26 |
| действия (showVerbs = open && on) | чипы-label `title="{perms}"`, чекбокс 16px, текст из `VERBS`: «Просматривать», «Создавать», «Изменять», «Проверять», «Выгружать», «Настраивать» (только те, что есть в `d.perms`); `bg` `var(--ox-accent-tint)`/`#FFFFFF`, `border` `#9CC6AE`/`#DCE2D9` | `min-height 36;padding-left 30px` |
| блок «Финансовые разрешения» | `lock` `#7A5214`; текст «Выдаются отдельно и не включаются переключателем модуля. Действуют только в области назначения.»; чекбоксы 18px: «Видеть начисления водителям» `code fleet.earnings.read`; «Управлять начислениями» `code fleet.earnings.manage`; `disabled = finBlocked || role.all` | `border #EBD7A8;bg #FFFCF4;radius 10;padding 14` |
| finNote (finBlocked = isDriver или роль назначена участнику с `function==='driver'`) | `block` + «Роль с функцией «Водитель» не может содержать начисления» (isDriver) / «Роль назначена водителю — финансовые права недоступны» | `#A13A33` 13px |
| подвал | «Есть несохранённые изменения» (dirty, `#7A5214`, `margin-right:auto`); «Отменить» (`disabled re.clean`) → `roleDraft:null`; `re.saveLabel` «Сохранить роль» / «Сохраняем…» (`disabled re.clean`; clean = !dirty или busy 'srole') | |

Поведение переключателя (`:3180`): если у роли есть действия модуля — удалить `actions[key]`; иначе `actions[key] = ['view']`; раскрыть строку. Чекбокс действия (`:3185`): toggle в массиве, пустой массив удаляется. Фин. чекбокс (`:3190`): `finance[k] = !finance[k]`. Имя (`:3194`).

Aside «Итоговые права роли» (`:380–388`, `:3199–3205`): `bg #F8F9F6`; `re.holders` «Назначена: {имена}» / «Роль пока никому не назначена»; при `permsEmpty` блок с пунктирной рамкой `#C3CCC1`: «Нет бизнес-разрешений. Пустая роль ничего не открывает, пока вы не включите модули и действия.»; чипы `code` ключей (IBM Plex Mono 12px, `bg #FFFFFF;border #DCE2D9`), для системной — `*`; факты: `extension` `#2B5479` «Подключение модуля организации само по себе не выдаёт права — их задаёт роль»; `location_on` `#2B5479` «Область данных выбирается при назначении роли сотруднику»; `lock_open` `#7A5214` «Начисления видны в области назначения» (если `finance.read || all`) иначе `lock` `#5C6964` «Начисления скрыты»; `shield` accent «Данные других организаций недоступны».

Сохранение (`saveRole`, `:2785–2788`): `run('srole', api.saveRole(draft), 'Роль «{name}» сохранена')` → `roleDraft:null`. Серверные ошибки (`ortus/api.js:295–303`): `forbidden` «Системная роль не редактируется»; `validation` «Укажите название роли»; `role_conflict` «Роль с функцией «Водитель» не может содержать начисления»; `role_conflict` «Роль назначена водителю — финансовые права недоступны» — показываются тостом error (не quiet).

Исходный вид (Альта, `roleSel='r-manager'`, logistics не подключён): строка «Логистика» — иконка `#8A968F`, note «Модуль не подключён организацией — включение недоступно», переключатель `aria-checked="true"` но `disabled`, раскрыта (roleOpen.logistics) с отмеченными «Просматривать», «Создавать», «Изменять», «Проверять», «Выгружать»; «Видеть начисления водителям» отмечен; факт `lock_open`.

### 6.8 Вкладка «Проверка доступа» (`:393–418`, `:3209–3238`)

Левая карточка: `h3` «Проверить доступ» + «Объяснение вычисленного права. Это не вход под пользователем.»; селекты «Сотрудник» (опции «{name} · {title}», например «Марина Котова · Логист»), «Действие», «Объект» (44px, 16px); «Примеры:» + кнопки-пилюли 32px: «Модуль не подключён», «Нет права», «Нет доступа к объекту», «Начисления водителю».

Константы (`:2365–2367`):

| ACTIONS value | label | модуль | verb |
|---|---|---|---|
| fleet.view | «Просматривать машины» | logistics | view |
| fleet.reserve | «Бронировать машину» | logistics | create |
| fleet.review | «Принимать смены» | logistics | review |
| fleet.earnings | «Видеть начисления» | logistics | earnings |
| spa.view | «Открыть расписание SPA» | spa | view |
| repair.create | «Отмечать работы на объекте» | repair | create |

OBJECTS: `v1` «ГАЗель Next · Север Логистик» (f-msk-sever); `v5` «Isuzu Elf · Юг Транс» (f-msk-yug); `v7` «ГАЗель Бизнес · Самара / Волга Логистик» (f-smr-volga); `trip` «Рейс Р-208 · Север Логистик» (f-msk-sever); `none` «Без конкретного объекта» (null). Объект учитывается только для logistics (`:3213`).

PRESETS: «Модуль не подключён» → m-sokolov / repair.create / none; «Нет права» → m-vasiliev / fleet.review / trip; «Нет доступа к объекту» → m-vasiliev / fleet.view / v5; «Начисления водителю» → m-vasiliev / fleet.earnings / trip.

Правая карточка (`border:1px solid {{ ac.r.border }}`): круг 44px чипа, pill 12px 600, `strong` 16px title, text 13px; разделитель; «Рабочее место сотрудника · вычислено» (12px uppercase); чипы `ac.nav` (`bg #F2F3EF`); «Нет доступных разделов модулей» при пустом.

| Исход | chip | title | text | border |
|---|---|---|---|---|
| ok | «Разрешено» ok `check_circle` | «{name} может: {label в нижнем регистре}» | «Основание · роль «{role}» · {scope}[ · через {via}].» или (earnings) «Основание: финансовое разрешение в области.» | `#BFD9C8` |
| module_off | «Модуль не подключён» neutral `extension_off` | «{name} не может: …» | «Модуль не подключён организацией. Подключить его может владелец бизнеса.» + « Модуль: {name}.» | `LINE.neutral #DCE2D9` |
| module_readonly | «Модуль отключён · только чтение» neutral `history` | | «Модуль отключён. История доступна для чтения, новые операции закрыты.» + « Модуль: …» | |
| no_permission | «Нет права» warn `lock` | | «Ни одна роль сотрудника не разрешает это действие.» | `#EBD7A8` |
| no_scope | «Нет доступа к объекту» warn `visibility_off` | | «Право есть, но объект находится вне области назначения.» + « Объект: {label}.» | `#EBD7A8` |
| driver_block | «Запрещено функцией «Водитель»» danger `block` | | «Действующая функция «Водитель» запрещает начисления через любую роль и группу.» | `#F0C9C3` |

`ac.nav` (`:3225–3229`): для каждого отраслевого модуля с `can(view)` — чип с иконкой и именем; `can(logistics,'review')` → `fact_check` «Приёмка смен»; `canEarnings && moduleOn(logistics)` → `lock_open` «Начисления». Исходно (Котова, logistics выкл.): «Марина Котова не может: просматривать машины», чип «Модуль не подключён», «… Модуль: Логистика.», nav пуст → «Нет доступных разделов модулей».

### 6.9 Диалог «Назначить роль» (`:2230–2251`, `:3969–3996`, `:2748–2762`)

Открытие: `modal {kind:'assign', memberId, roleId: roleId||'', type:'firm', region:'r-msk', firm:'f-msk-sever', until:'', err:null}`.

| Элемент | Текст / привязка |
|---|---|
| `h2#dlg-title` | «Назначить роль»; под ним `ma.member` = «{name} · {title или email}» |
| «Текущие назначения» (hasExisting) | строки «{role} · {scope}[ · через …]» + кнопка «Снять» (`#A13A33`) → `removeAssign(id)` → `run('unassign', api.unassign, 'Назначение снято')`; ошибка `last_owner` «Нельзя снять роль с последнего владельца» тостом |
| `label` «Роль» select | `<option value="">Выберите роль</option>` + роли `kind !== 'system'`; onChange сбрасывает err |
| `fieldset` legend «Область действия» | кнопки `aria-pressed`: «Вся организация», «Регион», «Фирма»; `border:1.5px solid` accent/`#CDD5CB`, `bg var(--ox-accent-tint)`/`#FFFFFF`, `flex:1 1 120px` |
| «Регион» select (type ≠ tenant) | регионы `db.units type==='region'`; смена региона ставит первую фирму региона |
| «Фирма» select (type = firm) | `M.firmsOf(db, region)` |
| «Действует до» `input type="date"` + «Необязательно» | `ma.until` |
| «Итог назначения» (bg `#F8F9F6`) | `strong` «{role.name или "Роль не выбрана"} · {scopeLabel}»; факты |
| факты | роль выбрана: `extension` «Отраслевые модули: {имена[ (модуль не подключён)]}» или «Только общие модули ядра» (для `all` — «Отраслевые модули: все модули»); `location_on` «Данные всех регионов и фирм организации» / «Все фирмы региона {name}; другие регионы скрыты» / «Только {Регион / Фирма}; соседние фирмы скрыты»; если участник driver и `role.finance.read` — `block` `#A13A33` «Конфликт: функция «Водитель» несовместима с правом на начисления — сервер отклонит назначение», иначе `lock_open`/`lock` «Начисления водителям — видны в этой области» / «Начисления недоступны»; роль не выбрана: `info` «Выберите роль, чтобы увидеть итоговые права» |
| ошибка (`hasErr`) | `role="alert"` `error` + `ma.err`, `bg #FBEAE7` |
| кнопки | «Отмена»; «Назначить» (`disabled busy`) → `saveAssign` |

`saveAssign`: без роли → `err` «Выберите роль»; `scope` из type; `run('assign', api.assign({memberId, roleId, scope, until}), 'Роль «{name}» назначена', {quiet:['role_conflict','validation']})` → `modal:null`; если `memberId==='m-kotova'` и у роли есть `actions.logistics` → `mark('assigned')`. Ошибки показываются внутри диалога: `validation` «Выберите роль» / «Выберите область действия»; `role_conflict` «Функция «Водитель» несовместима с правом на начисления (правило MVP).» / «У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено.» (`ortus/api.js:274–282`). Сервер добавляет `assignments.push({id, member, role, scope, until||null})` и событие участнику «Вам назначена роль «…» · {scope}».

### 6.10 Диалог «Пригласить участника» (`:2253–2272`, `:3997–4012`, `:2763–2771`)

| Элемент | Текст / привязка |
|---|---|
| `h2#dlg-title` | «Пригласить участника»; подпись «Письмо в демо не отправляется: рассылки не подключены.» |
| «Имя и фамилия» input | `aria-invalid`, `border:1.5px solid` `#A13A33`/`#CDD5CB`; ошибка `role="alert"` «Укажите имя» |
| «Электронная почта» `type="email"` placeholder «name@company.ru» | ошибки «Укажите адрес» / «Адрес выглядит неверно: проверьте «@» и домен» (`emailOk`, `ortus/models.js:303`) |
| «Роль» select | `<option value="">Без роли — назначить позже</option>` + не-системные роли |
| «Область» select, `disabled="{{ mi.noRole }}"` | «Вся организация», «{Регион} · весь регион», «{Регион} / {Фирма}» для всех регионов и фирм; значение по умолчанию `f-msk-sever` |
| seatsOk | `event_seat` + «{seatsText}. Приглашение занимает место сразу, до принятия.», где seatsText = «Мест без ограничения» или «Свободно мест: {left} из {lim}» + « — это последнее» при left=1 (цвет `#7A5214` при left=1, иначе `#3A4844`) |
| seatsFull (`used >= lim`) | `role="alert"` `no_accounts` «**Все места тарифа заняты.** Чтобы пригласить сотрудника, отзовите неактуальное приглашение, заблокируйте бывшего сотрудника или запросите тариф больше. Рабочего без входа можно вести карточкой бесплатно.» + кнопка «Подписка и места» (`workspace_premium`, `border #A13A33`) → `modal:null, page billing` |
| ошибка сервера | `role="alert"` `mi.err` |
| кнопки | «Отмена»; «Пригласить» `disabled = busy || full` |

`saveInvite`: клиентская валидация (`tried:true`, `errs`); `scope` = tenant / `r-*` → region / иначе firm; `run('invite', api.invite({name,email,roleId,scope}), 'Приглашение создано · письмо в демо не отправляется', {quiet:['validation','conflict']})` → `modal:null`; ошибки `validation`/`conflict` — в диалоге; `seats_exhausted` — тост error и `err` в диалоге. Сервер (`ortus/api.js:155–168`): «Укажите имя»; «Проверьте адрес электронной почты»; `conflict` «Участник с таким адресом уже есть»; `seats_exhausted` «Свободных мест нет: занято {u} из {l}. Отзовите приглашение или запросите расширение тарифа.»; создаёт `members.push({id:'m-N', name, email, status:'invited', title:'', invitedNote:'Приглашение до 08.10'})`, при роли — `assignments.push`, аккаунт в `platform.accounts`.

### 6.11 Диалог «Создать роль» (`:2274–2288`, `:4013–4025`, `:2772–2778`)

- `h2` «Создать роль»; «Название» input placeholder «Например: Менеджер Север», `border:1.5px solid` `#A13A33` при ошибке «Укажите название роли».
- `div role="radiogroup" aria-label="Основа роли"`; карточки `border:1.5px solid` accent/`#DCE2D9`, `bg #F7FAF8`/`#FFFFFF`; `input type="radio" name="role-mode"`:
  - «Пустая роль» — «Ноль бизнес-разрешений. Включайте модули и действия вручную.»
  - «Из шаблона» — «Готовый набор действий отрасли. Его можно изменить.»; select (`aria-label` «Из шаблона») из ролей `kind==='template'`.
  - «Скопировать существующую» — «Копия текущих прав роли организации.»; select из `kind !== 'system'`.
- Кнопки «Отмена», «Создать и настроить» (`disabled busy`) → `run('crole', api.createRole({name, mode, sourceId}), 'Роль создана')` → `modal:null, roleSel: newId, roleDraft:null, usersTab:'roles'`. Сервер: `{id:'r-N', name, kind:'custom', actions:{}, finance:{read:false,manage:false}}`, при template/copy — копия `actions`, `finance`, `professional` (`ortus/api.js:288–294`).

## 7. Страница «Подписка и места» (`pg.billing`)

### 7.1 Идентификатор
`page === 'billing'`; меню «Подписка и места», `workspace_premium`; `BR_LOCK`. Персона owner; права `billing.read` (владелец, уполномоченный), `billing.manage` (только владелец) — `docs/17-users-and-billing.md:122–126`. Обе организации. Состояние: `billTier:null`, `billTerm:12`, `billComment:''` (`:2378`). Переход из диалога приглашения «Подписка и места» (`:4010`).

### 7.2 Раскладка (`:1447`)
`<section aria-labelledby="h-bill" data-screen-label="Владелец · подписка и места">` gap 16: заголовок; ряд из двух карточек `flex:1 1 320px` (`align-items:stretch`); до четырёх баннеров; карточка «Изменить тариф»; ряд списков `flex:3 1 420px` и `flex:2 1 300px`.

### 7.3 Элементы и вычисления (`:1448–1521`, `:3901–3942`)

| Элемент | Текст / привязка |
|---|---|
| крошка, `h1#h-bill`, p | «{{ top.tenant }} / Компания»; «Подписка и места»; «Лицензия действует на весь бизнес: все регионы и фирмы. Место занимает каждый, у кого есть вход в приложение.» |
| карточка тарифа | `h2` `bl.title` = («Пробный период · » | «Тариф ») + ««{curTier.name}»»; чип `bl.statusChip`: trial → «до {trialEnds} · осталось {n} дн.» info `hourglass_top`; active → «Оплачено до {paidUntil или —}» ok `check_circle`; иначе `TENANT_STATE` («Ограничен» warn `lock_clock`, «Приостановлен» danger `pause_circle`); p `bl.planMeta`: trial → «В пробном периоде до 10 мест и все подключённые модули. Чтобы продолжить после него, выберите тариф ниже.»; иначе («Помесячная оплата» при term 1 | «Оплата за {term} мес») + « · цены версии v{version} сохраняются до конца периода» |
| карточка «Места» | `h2` «Места»; число `bl.seats` 24px = «{used} из {lim}» или «{used}»; полоса 10px `bl.pW` (%), `bl.bar` (`#A13A33` full / `#B7791F` >80 / accent); `bl.seatsSub` = «{a} {активен/активны/активны} · {i} {приглашение/приглашения/приглашений} · {free} свободно» или «без ограничения»; при `full` `role="status"` `no_accounts` «Мест нет: новые приглашения закрыты. Сотрудники с доступом продолжают работать.» |
| баннер pending (`role="status"`, bg `#FAF1DC` border `#EBD7A8` fg `#7A5214`, `pending`) | «Заявка {id} на «{tier}» · {термин: «помесячно» | «N мес»} отправлена {at}. Новый лимит начнёт действовать после подтверждения оператором.» + кнопка «Отменить заявку» (`border #7A5214`) → `run('cancelReq', api.cancelSeatRequest(id), 'Заявка отменена')` |
| баннер rejected (`block`, danger) | «Заявка {id} отклонена оператором: {decision или "без комментария"}» — если нет pending и последняя заявка rejected |
| баннер priceChange (`event`, info) | «С {from} меняются цены тарифов. Заявки, поданные до этой даты, считаются по текущим ценам; оплаченный период не пересчитывается.» — если `priceBook.scheduled` |
| баннер approved (`check_circle`, bg `var(--ox-accent-soft)` border `#BFD9C8` fg accent) | «Заявка {id} подтверждена {decidedAt}.» — если нет pending, последняя approved и `tenantId === t.id` |
| карточка «Изменить тариф» | `h2` «Изменить тариф» + «Цены — пример для макета. Заявку подтверждает оператор после оплаты.» |
| `div role="radiogroup" aria-label="Срок оплаты"` | кнопки `role="radio" aria-checked`: «Месяц», «4 мес» + «−5%», «8 мес» + «−10%», «12 мес» + «−20%» (скидка 12px, показана при off>0); выбранная `bg var(--ox-accent);color #FFFFFF`, скидка `#DDF0E4`; невыбранная `bg #FFFFFF;color #1C2A26`, скидка accent |
| `div role="radiogroup" aria-label="Тариф"` грид `minmax(min(100%,190px),1fr)` | карточки `role="radio" aria-checked aria-disabled`: `strong` name 15px; «до {seats} мест» / «больше 100 мест»; цена 18px `M.rub(month)` или «Индивидуально»; «в месяц» / «расчёт с оператором»; `total` «{rub(total)} за {term} мес» (при term>1); note 12px `#2B5479`: «Текущий тариф» (isCur = tier плана и не trial) / «Занято {used} — не поместится» (seats < used) / «Тот же лимит, что в пробном периоде» (tier плана и trial); `disabled = small || isCur || pending` → `bg #F8F9F6;opacity .62;cursor not-allowed`; выбранная `border:2px solid var(--ox-accent);bg var(--ox-accent-tint)` |
| расчёт (`hasCalc` = выбран тариф) | `bg var(--ox-accent-tint);border #BFD9C8`: `strong` `bl.calcMain` = «{rub(month)} в месяц · {rub(total)} за месяц|за {n} мес» или «Стоимость рассчитает оператор»; `bl.calcSub` = [«Экономия {rub(save)} по сравнению с помесячной оплатой. »] + «Новый лимит: {seats} мест.» / «Новый лимит: без ограничения.» |
| `label` «Комментарий для оператора» textarea rows 2 | placeholder «Например: подключаем ещё две фирмы в Самаре»; 15px |
| строка отправки | `bl.sendHint`: pending → «Сначала дождитесь решения по текущей заявке или отмените её»; нет тарифа → «Выберите тариф»; иначе пусто; кнопка «Отправить заявку оператору» (`send`) `disabled = !sel || pending || busy` |
| список «Занимают место · {n}» (`active` затем `invited`) | кнопка «Пригласить» (`person_add`, вторичная) → страница users, вкладка people, модал invite; строки: аватар 34px accent-soft; name 500; `title` или «Должность не указана»; note (invited) «{invitedNote или "Приглашение отправлено"} · место зарезервировано» (`#7A5214`); чип «Приглашён» warn `schedule` / «Активен» ok `check_circle`; кнопка «Отозвать» (invited) |
| список «Не занимают место · {n}» + «Заблокированные и карточки без входа» | пусто → «Таких сотрудников нет.»; строки: аватар `bg #ECEFEA;color #4C5955`; name; `what` = «[{title} · ]заблокирован, история сохранена» (blocked) / «{role} · карточка без входа (бригада)» (`db.repair.crew` без `account`) |

Расчёт (`calc`, `:3563–3568`): `month = round(tier.month × (1 − off/100))`, `total = month × months`, `save = (tier.month − month) × months`. Для v2 и 12 мес: Старт 3 120 ₽/мес, 37 440 ₽ за 12 мес, экономия 9 360 ₽; Команда 7 120 / 85 440 / 21 360; Бизнес 12 720 / 152 640; Сеть 22 320 / 267 840; Безлимит — «Индивидуально». `M.rub` использует `toLocaleString('ru-RU')` — разделитель групп неразрывный пробел (`ortus/models.js:142`).

Отправка (`:3933`): `run('seatReq', api.requestSeats({tierId, term, comment}), 'Заявка отправлена оператору')` → `billTier:null, billComment:''`. Сервер (`ortus/api.js:179–190`): `conflict` «Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.»; `validation` «Выберите тариф»; `validation` «В тарифе «{name}» {seats} мест, а занято {used}»; создаёт `{id:'SR-'+(20+seq), tenantId, from, to, term, used, by, at, status:'pending', comment}`, audit, событие «Заявка {id} на тариф «{name}» отправлена оператору». Отмена (`:191–195`): `conflict` «Заявка уже рассмотрена»; `status='cancelled'`.

Отозвать приглашение (`:3937`): confirm tone warn, icon `person_remove`, title «Отозвать приглашение?», text «{name} · {email}», секция «Последствия»: «Место освободится сразу» (`event_seat`, ok), «Ссылка из письма перестанет работать» (`link_off`, neutral); confirmLabel «Отозвать» → `run('revoke', api.revokeInvite(id), 'Приглашение отозвано, место свободно')`. Сервер удаляет участника, его назначения, членство в группах и аккаунте (`ortus/api.js:169–176`); `conflict` «Приглашение уже принято или отозвано». ⚠ В прототипе `onConfirm` не закрывает диалог (нет `setState({modal:null})`, ср. `opConfirm :2822`) — см. открытые вопросы.

Исходные значения: Альта — «Пробный период · «Старт»», чип «до 13.10.2026 · осталось 12 дн.», «9 из 10», полоса 90% `#B7791F`, «7 активны · 2 приглашения · 1 свободно», баннеров нет, «Занимают место · 9», «Не занимают место · 5» (Кирилл Громов «Водитель · заблокирован, история сохранена» + 4 карточки бригады: Иван Петров «отделочник · карточка без входа (бригада)», Олег Смирнов, Роман Сергеев «маляр …», Денис Волков «разнорабочий …»). Лотос — «Тариф «Команда»», чип «Оплачено до 31.03.2027», planMeta «Оплата за 12 мес · цены версии v1 сохраняются до конца периода», «23 из 25», баннер pending «Заявка SR-12 на «Бизнес» · 12 мес отправлена 29.09 16:40. …», все тарифы disabled, «Команда» — «Текущий тариф», «Старт» — «Занято 23 — не поместится» (`ortus/mock-data.js:93, 110`).

## 8. Страница «Оформление» (`pg.branding`)

### 8.1 Идентификатор
`page === 'branding'`; меню «Оформление», `palette`; `BR_LOCK`. Персона owner; `branding.manage` (`docs/18-branding.md:83`). Обе организации. Состояние: `brDraft` (черновик, `null`/отсутствует = чистый), `brTab` ('app'), `brIconOpen`. Нет в `INITIAL` — ⚠ `reset()` их не трогает явно, но `INITIAL()` их не содержит и `{...INITIAL()}` их не очистит (остаются от прошлой сессии в памяти страницы).

### 8.2 Раскладка (`:1247, 1254–1255, 1366, 1434`)
`<section aria-labelledby="h-brand" data-screen-label="Владелец · оформление">`; две колонки flex-wrap: левая `flex:3 1 480px` с 6 карточками; `<aside aria-label="Предпросмотр" style="flex:2 1 340px;position:sticky;top:12px">`; внизу `position:sticky;bottom:0;z-index:5` панель сохранения с тенью `0 -8px 24px rgba(28,42,38,.08)`. На 390 — одна колонка, предпросмотр после настроек, панель прилипает к низу.

### 8.3 Элементы (`:1248–1443`)

Заголовок: крошка «Компания» (статичная, без имени тенанта); `h1#h-brand` «Оформление»; p «Название, логотип, цвет, термины и меню действуют для всего бизнеса: всех регионов, фирм и сотрудников. Права доступа от оформления не зависят. Каждый сотрудник может выбрать для себя светлую или тёмную тему, акцентный цвет сохраняется.»; `br.version` 12px = «Версия {v}» + (« · изменено {updatedAt}[, {updatedBy}]» | « · стандартное оформление»).

Карточка «Название» (`:1257–1261`):
- «Название организации» input `maxlength="60"` 15px; подпись «В шапке, письмах, публичных формах и у оператора платформы».
- «Короткое имя» + счётчик `br.shortCount` «{n} / 16» (`#A13A33` при n>16); placeholder «Например: Альта»; подпись «Заменяет «ортус» слева в шапке, подписывает иконку приложения на телефоне и вкладку браузера. Пусто — остаётся «ортус».»

Карточка «Логотип и знак» (`:1263–1290`), грид `minmax(min(100%,220px),1fr)`:
- «Логотип для шапки»: зона 88px `border:1px dashed #CDD5CB;bg #F8F9F6`; при `hasLogo` `span role="img" aria-label="Логотип"` 48px высотой, `background:center/contain url(logo)`; иначе «Горизонтальный, прозрачный фон, PNG или SVG до 1 МБ»; `label` «Загрузить» (`upload`) со скрытым `input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp"`; «Убрать» (`border #E3B5AF;color #A13A33`) при hasLogo.
- «Знак»: зона 88px; `role="img" aria-label="Знак"` 48×48 radius 12 `center/cover`; иначе плитка 48×48 `bg br.pv.accent` с буквой `br.letter` 26px; текст «Квадратный, от 512×512. Меню на телефоне, вкладка браузера, иконка приложения. Без файла — первая буква на фирменном цвете.»; «Загрузить», «Убрать».
- Клиентская проверка файла (`:3675–3680`): тип не из `image/(png|jpeg|svg+xml|webp)` → тост warn «Нужен PNG, SVG, JPG или WebP»; `size > 1048576` → «Файл больше 1 МБ»; иначе `URL.createObjectURL(f)` в черновик; `e.target.value=''`.

Карточка «Акцентный цвет» (`:1292–1313`):
- Подпись «Кнопки, ссылки, активный пункт меню, фокус. Цвета статусов не меняются, чтобы «готово» и «ошибка» везде выглядели одинаково.»
- `div role="radiogroup" aria-label="Палитра"`: 8 кнопок `role="radio" aria-checked title="{label}"`: квадрат 40×40 radius 10 `bg hex`, кольцо выбранного `box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px {hex}`; подпись 12px. Палитра (`:2334`): «Ортус» `#1F6B52`, «Морской» `#0F6C74`, «Синий» `#2B5479`, «Индиго» `#4338A0`, «Сливовый» `#7A3E79`, «Терракота» `#9A4A1F`, «Олива» `#5A6420`, «Графит» `#3D4A55`. Выбран, если `acc === hex.toUpperCase()`.
- «Свой цвет (HEX)»: текстовый input `maxlength="7" spellcheck="false" aria-label="Свой цвет в формате HEX"` (IBM Plex Mono, uppercase) + `input type="color" aria-label="Выбрать цвет"` 34×34 (value `br.accentPicker` = валидный acc). `onAccent`: `trim()`, если не начинается с `#` — добавить.
- Статусы: `ratioOk` (hexOk и ratio ≥ 4.5) `role="status"` bg `#E3EFE7` fg `#1F6B52` `check_circle` «Контраст с белым текстом {x}:1: подходит для кнопок и ссылок.»; `ratioFix` bg `#FAF1DC` fg `#7A5214` `contrast` «Контраст с белым текстом {x}:1 — мало для текста. В интерфейсе будет использован {fixed} ({y}:1).» + квадрат 28px `bg fixed`; `ratioBad` (`!hexOk`) `role="alert"` bg `#FBEAE7` «Введите цвет в формате #RRGGBB, например #2B5479». `fmtRatio` — одна десятичная через запятую (`:2357`).
- «Статусы остаются прежними:» + чипы «Принят» (`check_circle`, ok), «Ждёт проверки» (`pending`, warn), «Заблокирован» (`block`, danger).
- Формулы (`:2350–2356`): `relLum` по WCAG; `contrastW(h) = 1.05/(L+0.05)`; `fixAccent`: пока контраст < 4.5 — `mixHex(c,'#000000',0.04)` до 60 итераций; `brandVars(hex)` = `{accent: fixAccent, hover: mix(black,0.18), soft: mix(white,0.86), tint: mix(white,0.93)}`; невалидный hex → `#1F6B52`.

Карточка «Термины» (`:1315–1329`): подпись «Назовите сущности так, как принято у вас. Для русского языка нужны четыре формы: одна, много, 2–4 и 5 и больше.»; строки `BR_TERMS` (`:2335–2341`):

| key | label | one / plural / few / many | where |
|---|---|---|---|
| shift | «Смена» | смена / смены / смены / смен | «В макете: меню и заголовок «Приёмка смен»» |
| vehicle | «Машина» | машина / машины / машины / машин | «В макете: пункт меню водителя» |
| trip | «Рейс» | рейс / рейсы / рейса / рейсов | «Карточки, уведомления, отчёты логистики» |
| visit | «Визит» | визит / визиты / визита / визитов | «Расписание и записи SPA» |
| object | «Объект» | объект / объекты / объекта / объектов | «Объекты и этапы ремонта» |

В строке: `strong` label, `where` 12px, кнопка «Вернуть стандартный» (при `custom` — есть переопределение) → `delete terms[key]`; инпуты «Одна», «Много», «2–4», «5 и больше» (40px, 14px); пример «1 {one} · 2 {few} · 5 {many}». Любое редактирование создаёт `terms[key]` со всеми 4 формами (`:3689`).

Карточка «Меню и иконки» (`:1331–1355`): подпись «Название, иконка, порядок и видимость пунктов для всех сотрудников. Скрытый пункт пропадает из меню, но права на раздел остаются. Разделы управления скрыть нельзя.»; группы `br.menu` из `navForBase(db,'owner',mid)` без `planned` (`:3693–3706`): заголовок группы uppercase 11px `#6B7873`; строка (`opacity .55` при hidden): кнопка иконки 40×40 `aria-expanded aria-label="Сменить иконку: {def}"`; input `placeholder="{def}" aria-label="Название пункта «{def}»"` value `o.label`; «Выше» `arrow_upward` / «Ниже» `arrow_downward` (`disabled` на краях группы); при `canHide` кнопка `aria-pressed="{{ r.vis }}"` «Показан» (`visibility`, `#3A4844`) / «Скрыт» (`visibility_off`, `#7A5214`); при `locked` — `lock` «всегда виден»; раскрытый выбор: `div role="radiogroup" aria-label="Иконка пункта"` с кнопками `role="radio" aria-checked aria-label="{icon}"` 40×40 (`bg var(--ox-accent-soft);border var(--ox-accent)` у выбранной), выбор закрывает список.

Группы owner (Альта, logistics выкл.): «Обзор» (Главная `home`), «Компания» (Модули и место, Пользователи и роли, Подписка и места, Оформление), «Ремонт и стройка» (Объекты `home_work`), «Отрасли» (Салон и SPA `spa`), «Общие модули» (Задачи, Формы и опросы, Календарь, База знаний, Данные, Файлы, Касса). При включённой логистике добавляется «Логистика»: Рабочее место логиста `fleet`, Ресурсный пул `pool`, Приёмка смен `review` (`:2964–2988`). Наборы иконок `BR_ICONS` (`:2342–2348`): home [home, dashboard, space_dashboard]; spa [spa, self_care, content_cut, hot_tub, health_and_beauty]; repair [home_work, construction, home_repair_service, handyman, engineering, foundation]; fleet [local_shipping, directions_car, route, airport_shuttle, warehouse]; pool [person_search, groups, diversity_3, badge]; review [fact_check, rule, task, verified]; tasks [task_alt, checklist, assignment, view_kanban]; forms [dynamic_form, quiz, edit_note, assignment]; calendar [calendar_month, event, schedule, date_range]; knowledge [menu_book, school, library_books, help_center]; data [table_view, analytics, bar_chart, dataset]; files [folder_open, cloud, attach_file, photo_library]; cash [account_balance_wallet, payments, point_of_sale, savings]; modules [extension, apps, widgets]; users [group, manage_accounts, badge]; billing [workspace_premium, receipt_long, credit_card]; branding [palette, brush, format_paint]. `BR_LOCK = ['home','modules','users','billing','branding']` (`:2349`). Порядок: `order` — плоский список id по всем группам; перестановка меняет соседей внутри группы (`:3694–3696`).

Карточка «Публичные формы и письма» (`:1357–1363`): подпись «Клиенты видят ваш логотип, название и цвет в формах записи и опросов, письма сотрудникам приходят от имени организации.»; `button role="switch" aria-checked="{{ br.poweredStr }}"` min-height 48: «Показывать «Работает на Ортус»» / «Подпись внизу публичных форм и писем»; трек 40×22 `bg var(--ox-accent)`/`#C3CCC1`, кноб 18px left 18/0.

Aside «Предпросмотр» (`:1366–1431`): `h2` «Предпросмотр»; `div role="group" aria-label="Что показать"` кнопки `aria-pressed` «Приложение», «Публичная форма», «Письмо» (выбранная `bg #1C2A26;color #FFFFFF`, 34px pill).
- «Приложение»: шапка 52px — логотип 28×130 | знак 28×28 | буква `br.pv.letter` на `br.pv.accent` + `br.pv.shown` (short || первое слово name || «ортус»); справа `br.pv.nameText` (name || «Название организации»); тело min 230px: колонка 44% с первыми 7 пунктами `brandNav` (первый активный `bg V.soft;color V.accent;600`); контент: `br.pv.reviewTitle` (кастомная подпись пункта review || «Приёмка {term.shift.many}» при переопределении || «Приёмка смен»), `br.pv.count` «3 {term.shift.few} ждут проверки», карточка с чипом «Ждёт проверки» (`pending`, warn) и «Открыть карточку» (цвет accent), кнопка «Принять» (`bg pv.accent`).
- «Публичная форма»: фон `br.pv.tint`; карточка 320px: логотип 30×150 | буква + nameText; «Запись на приём»; «Имя» (рамка `#CDD5CB`); «Телефон» (рамка `2px solid pv.accent`); кнопка «Записаться»; «Работает на Ортус» при poweredBy.
- «Письмо»: «От: {nameText} · через Ортус»; карточка `border-top:4px solid pv.accent`; логотип 28×150 | буква + nameText; «{owner} приглашает вас в «{nameText}». Приглашение действует 7 дней.» (owner = имя текущего участника, иначе «Владелец»); кнопка «Принять приглашение»; «Письмо отправлено по поручению организации. Если вы не ждали приглашения, просто удалите его.»; «Работает на Ортус» при poweredBy.
- Подпись «Предпросмотр показывает черновик. Сотрудники увидят изменения после сохранения.»

Панель сохранения (`:1434–1443`): при `hasErrs` `role="alert"` список «· {text}» (`#A13A33`); «Есть несохранённые изменения» (`#7A5214`) / «Изменений нет»; кнопки «Стандартное оформление» (текстовая accent) → черновик = `BR_DEF` + текущее имя; «Отменить» (`disabled br.clean`) → `brDraft:null, brIconOpen:null`; «Сохранить для всех» (`save`, `disabled br.cantSave` = !dirty || errs || busy).

Ошибки черновика (`:3681–3686`): «Укажите название организации»; «Название — до 60 символов»; «Короткое имя — до 16 символов»; «Цвет — в формате #RRGGBB»; «Термин «{label}»: заполните все четыре формы».

Сохранение (`:3730`): `run('brand', api.saveBranding({...d, name, short, accent: acc}), 'Оформление сохранено и видно всем сотрудникам')` → `brDraft:null, brIconOpen:null`. Сервер (`ortus/api.js:131–143`): проверки «Название — от 1 до 60 символов», «Короткое имя — до 16 символов», «Цвет — в формате #RRGGBB», «Заполните все формы термина «{key}»»; `version = (brand.version||1)+1`, `updatedAt = hh:mm`, `updatedBy = actorName()`, `t.name = name`; audit «{name}: оформление, версия {v}»; событие владельцам «Оформление обновлено (версия {v}). Изменения видны всем сотрудникам». После сохранения `shellVM` применяет цвет/логотип/меню ко всей оболочке (`:3033`, `:2935`).

Исходные значения: Альта — «Версия 1 · стандартное оформление», name «Альта Групп», short пусто («0 / 16»), буква «А», «Ортус» выбран, HEX `#1F6B52`, ratioOk (≈6,4:1 по формуле — ⚠ точное значение в источниках не записано), все термины стандартные, poweredBy вкл. Лотос — «Версия 3 · изменено 24.09 12:10, Ирина Белова», short «Лотос» («5 / 16»), «Сливовый» `#7A3E79`, термин «Визит» переопределён («1 сеанс · 2 сеанса · 5 сеансов», кнопка «Вернуть стандартный») (`ortus/mock-data.js:14`).

## 9. Инварианты и правила

1. Три отдельных действия: подключить модуль → разрешить роли → выбрать область при назначении; подключение не выдаёт прав (`README.md:11`; тексты `:210, 2676, 3201`).
2. Отключённый модуль остаётся читаемым: `history: true`, статус «Отключён · только чтение»; начатые смены можно завершить (`ortus/api.js:61–67, 147–151`).
3. В `restricted/suspended` новые операции запрещены: `assertActive` в `setStorageQuota`; кнопки «Подключить» и «Изменить лимит» заблокированы `restricted` (`:3112, 3129`).
4. Уменьшение лимита не удаляет файлы; при `usedGb >= quotaGb` — баннер и запрет новых загрузок (`:277, 3091`; `ortus/api.js:556`).
5. Системная роль (`kind==='system'`) не редактируется (поле имени disabled, нет редактора; сервер `forbidden`); нельзя снять роль с последнего владельца (`last_owner`) (`ortus/api.js:285, 297`).
6. Функция «Водитель» (`member.function==='driver'`, `role.professional==='driver'`) несовместима с `finance.read/manage` — блок в редакторе, конфликт в назначении, `role_conflict` на сервере; `canEarnings` → `driver_block` (`ortus/models.js:190–198`; `ortus/api.js:278–279, 299–301`).
7. Финансовые права не включаются переключателем модуля и действуют только в области назначения (`:369`).
8. Место занимает `active` или `invited`; `blocked` и карточки без аккаунта — нет; приглашение занимает место сразу; при `seatsUsed >= seatsLimit` приглашение закрыто (`ortus/api.js:30–32, 159–160`; `docs/17-users-and-billing.md:30–46`).
9. Одна открытая заявка на тариф на организацию (`request_pending`/`conflict`); тариф с `seats < seatsUsed` недоступен (`tier_below_usage`) (`ortus/api.js:181–184`; `docs/17:153`).
10. Скидка считается от помесячной цены, округление до рубля; подписка фиксирует `price_version` (`docs/17:60–63`; `:3563–3568`).
11. Оформление действует на весь бизнес; цвета статусов не меняются; статус всегда иконка + текст (`:1293`, `README.md:41`; `docs/18:33`).
12. Акцент с контрастом < 4.5:1 затемняется шагами 4% к чёрному; производные: hover −18% к чёрному, soft 86% к белому, tint 93% к белому; UI использует только `--ox-accent*` (`:2355–2356`; `docs/18:41–43`).
13. Пять пунктов меню нельзя скрыть (`BR_LOCK`); скрытие — удобство, права сохраняются (`:1332`; `docs/18:58–59`).
14. Ручная подпись пункта меню приоритетнее производной от термина (`:2956`; `docs/18:51`).
15. Каждое сохранение оформления — новая версия, журнал платформы, уведомление владельцам (`ortus/api.js:137–141`; `docs/18:63`).
16. Логотип и знак выводятся через `background:url(...)`, не `<img src>` (`docs/18:109`).
17. Названия организации в крошках/диалогах берутся из текущего тенанта (`top.tenant`, `:2676`), кроме крошки «Оформления» (статичная «Компания»).
18. Изоляция организаций: другая «БД» на тенант, общий `platform`; оператор не видит оформление как редактируемое (`docs/18:85–103`).
19. Цели нажатия ≥ 44 px для основных кнопок/полей, 40 px для вторичных в карточках; `button:disabled{opacity:.45;cursor:not-allowed}` (`:21`).
20. Диалоги закрываются Escape и кликом по подложке; `aria-modal`, `aria-labelledby="dlg-title"` (`:2204–2205, 2406–2410`).

## 10. Чек-лист приёмки (Playwright)

Обозначения: персона выбирается селектом с подписью «Персонаж» (`getByLabel('Персонаж')`), ширина — «Ширина». По умолчанию персона owner (Альта), страница «Главная».

### Модули и место
1. Given owner Альта; When клик по навигации `getByRole('button', {name: 'Модули и место'})`; Then виден `getByRole('heading', {level:1, name:'Модули и место'})`, крошка «Альта Групп / Компания», абзац «Подключение модуля открывает его организации…».
2. Given страница; Then карточка статуса: текст «Осталось 12 дней · до 13.10.2026», pill «Пробный период», кнопка «Демо: завершить пробный период».
3. Then три `article` в «Отраслевые модули»: «Логистика» с чипом «Не подключён» и кнопкой «Подключить»; «Салон и SPA» с чипом «Подключён» и кнопкой «Отключить»; «Ремонт и стройка» «Не подключён».
4. Then в карточке «Логистика» «Использует:» с чипами «Календарь», «Файлы», «Формы» и строка «Роли с правами модуля есть у: 1 сотрудника. Они заработают после подключения».
5. Then «Базовые модули» — 9 плиток; «Календарь» → «Использует: Салон и SPA»; «Задачи» → «Общий модуль ядра».
6. Then «Место организации»: «46,2 ГБ» и «из 100 ГБ»; `getByRole('meter', {name:'Занятое место'})` имеет `aria-valuenow="46.2"`, `aria-valuemax="100"`; 4 строки разбивки («Фото осмотров и отчётов» «31,4 ГБ» …); `getByLabel('Лимит места')` значение «100»; «Изменить лимит» disabled.
7. When клик «Подключить» у «Логистика»; Then `getByRole('dialog')` с заголовком «Подключить «Логистика»?», текст «Модуль станет доступен организации «Альта Групп». Права сотрудникам не выдаются автоматически.», разделы «Что появится» (4 пункта, первый «Рабочее место логиста»), «Зависимости» («Календарь — уже включён»), «Важно» («Шаблоны ролей: Менеджер логистики, Водитель. …»); кнопки «Отмена», «Подключить».
8. When «Подключить» в диалоге; Then тост «Модуль «Логистика» подключён», диалог закрыт, чип «Подключён», кнопки «Отключить» и «Назначить роли»; «Календарь» → «Использует: Логистика, Салон и SPA»; в навигации появилась группа «Логистика».
9. When «Отключить» у «Логистика»; Then диалог «Отключить «Логистика»?», «Данные не удаляются. Модуль перейдёт в режим чтения истории.», раздел «Затронет сейчас» содержит «Активных процессов нет», «Форма «Осмотр машины» v3 — приём новых ответов остановится»; чекбокс «Понимаю последствия для текущей работы»; кнопка «Отключить модуль» disabled до отметки; When отметить и подтвердить; Then тост «Модуль отключён. История доступна для чтения», чип «Отключён · только чтение».
10. When выбрать «Лимит места» = «25 ГБ · меньше занятого», клик «Изменить лимит»; Then диалог «Новый лимит меньше занятого места», текст «Занято 46,2 ГБ, новый лимит 25 ГБ. Не хватает 21,2 ГБ.», пункт «Освободите не менее 21,2 ГБ в разделе «Файлы»», чекбокс «Понимаю: новые загрузки будут недоступны», кнопка «Всё равно применить» disabled до отметки; When подтвердить; Then тост «Лимит места: 25 ГБ», `role=alert` «Занято больше лимита на 21,2 ГБ. …», баннер «Место организации заполнено.» (на этой странице без кнопки), meter `aria-valuemax="25"`.
11. When выбрать «250 ГБ», «Изменить лимит»; Then диалог «Изменить лимит на 250 ГБ?» с кнопкой «Изменить» (без чекбокса); подтвердить → тост «Лимит места: 250 ГБ».
12. When «Демо: завершить пробный период» → диалог «Смоделировать окончание пробного периода?» → «Завершить пробный период»; Then тост «Пробный период завершён (демо)», карточка «Пробный период завершён» с pill «Ограничен», кнопка «Демо: открыть как оператор», баннер «Пробный период завершён.» с кнопкой «Демо: продлить как оператор», «Подключить» у отключённых модулей disabled, «Изменить лимит» disabled при любом выборе.
13. Given restricted; When клик «Демо: открыть как оператор»; Then персона «Оператор платформы», заголовок «Организации-клиенты».
14. Given флажок «Нет связи» включён; When подтвердить подключение модуля; Then тост «Нет связи с сервером. Операция не выполнена.», диалог остаётся открытым, чип не изменился.

### Пользователи и роли
15. When «Пользователи и роли»; Then h1 «Пользователи и роли», `getByRole('tablist', {name:'Разделы доступа'})` с вкладками «Люди» (счётчик «10»), «Группы» («2»), «Роли» («5»), «Проверка доступа»; «Люди» `aria-selected="true"`.
16. Then строка «10 участников · без роли: 6 · мест занято 9 из 10»; кнопка «Пригласить».
17. Then у «Марина Котова» текст «Без роли — нет доступа к модулям»; у «Илья Васильев» строка «Водитель · Москва / Север Логистик · через группа «Водители Север»» и «Функция «Водитель»: начисления недоступны через любую роль»; у «Олеся Петрова» чип «Приглашён» и «Приглашение до 06.10»; у «Кирилл Громов» чип «Заблокирован» и кнопка «Назначить роль» disabled.
18. When «Назначить роль» у Марины Котовой; Then диалог «Назначить роль» с «Марина Котова · Логист», select «Роль» со значением «Выберите роль», кнопки области «Вся организация», «Регион», «Фирма» («Фирма» `aria-pressed="true"`), select «Регион» = «Москва», «Фирма» = «Север Логистик», поле «Действует до», итог «Роль не выбрана · Москва / Север Логистик», факт «Выберите роль, чтобы увидеть итоговые права».
19. When клик «Назначить» без роли; Then `role=alert` «Выберите роль».
20. When выбрать «Менеджер логистики», «Назначить»; Then тост «Роль «Менеджер логистики» назначена», диалог закрыт, у Котовой строка «Менеджер логистики · Москва / Север Логистик»; «без роли: 5».
21. When «Назначить роль» у Ильи Васильева, выбрать «Менеджер логистики»; Then факт «Конфликт: функция «Водитель» несовместима с правом на начисления — сервер отклонит назначение»; When «Назначить»; Then в диалоге `role=alert` «Функция «Водитель» несовместима с правом на начисления (правило MVP).», тоста ошибки нет.
22. When в диалоге назначения у Дарьи Зиминой клик «Снять» у «Владелец бизнеса · Вся организация»; Then тост error «Нельзя снять роль с последнего владельца», назначение на месте.
23. When «Пригласить» → диалог «Пригласить участника»; Then подпись «Письмо в демо не отправляется: рассылки не подключены.», строка «Свободно мест: 1 из 10 — это последнее. Приглашение занимает место сразу, до принятия.», select «Область» disabled пока «Роль» = «Без роли — назначить позже».
24. When «Пригласить» с пустыми полями; Then «Укажите имя», «Укажите адрес», `aria-invalid="true"` у обоих полей; When email «abc»; Then «Адрес выглядит неверно: проверьте «@» и домен».
25. When email «d.zimina@alta.example», имя «Тест»; Then `role=alert` «Участник с таким адресом уже есть» внутри диалога.
26. When имя «Пётр Новый», email «p.novy@alta.example», «Пригласить»; Then тост «Приглашение создано · письмо в демо не отправляется», в списке «Пётр Новый» с чипом «Приглашён», строка «мест занято 10 из 10»; When снова «Пригласить»; Then `role=alert` «Все места тарифа заняты.», кнопка «Пригласить» в диалоге disabled, кнопка «Подписка и места» ведёт на h1 «Подписка и места».
27. When вкладка «Группы»; Then две карточки: «Диспетчеры Север» «2 участника: Марина Котова, Олеся Петрова» «Роли через группу не назначены»; «Водители Север» «Роли через группу: Водитель · Москва / Север Логистик»; кнопка «Создать группу · следующая итерация» disabled.
28. When вкладка «Роли»; Then 5 кнопок ролей; «Менеджер логистики» `aria-pressed="true"`, чип «Шаблон», «22 разрешений · назначена: 0»; «Владелец бизнеса» — «Системная», «Все права · назначена: 1».
29. Then редактор: поле «Название роли» = «Менеджер логистики»; строка «Логистика» с `getByRole('switch', {name:'Доступ роли к модулю Логистика'})` `aria-checked="true"` и disabled (модуль не подключён), note «Модуль не подключён организацией — включение недоступно»; чекбоксы «Просматривать», «Создавать», «Изменять», «Проверять», «Выгружать» отмечены, «Настраивать» нет; блок «Финансовые разрешения» с отмеченным «Видеть начисления водителям» и `code` «fleet.earnings.read»; aside «Итоговые права роли» содержит `fleet.trips.review`, «Роль пока никому не назначена», «Начисления видны в области назначения».
30. When клик `getByRole('switch', {name:'Доступ роли к модулю Задачи'})`; Then `aria-checked="false"`, note «Нет доступа», «Есть несохранённые изменения», «Отменить» и «Сохранить роль» enabled; When «Отменить»; Then состояние вернулось, кнопки disabled.
31. When выбрать «Водитель»; Then блок «Профессиональная функция «Водитель». Начисления запрещены через эту и любую другую роль или группу.», чекбоксы финансов disabled, подпись «Роль с функцией «Водитель» не может содержать начисления».
32. When выбрать «Владелец бизнеса»; Then поле имени disabled, блок «Системная роль: все модули и области организации. …», редактора нет, в aside чип `*`.
33. When «Создать роль» → диалог «Создать роль» (`radiogroup` «Основа роли», «Пустая роль» выбрана); When «Создать и настроить» с пустым именем; Then «Укажите название роли»; When имя «Диспетчер», основа «Из шаблона» (select «Менеджер логистики»), «Создать и настроить»; Then тост «Роль создана», в списке «Диспетчер» с чипом «Своя» и `aria-pressed="true"`, редактор показывает действия шаблона; When изменить имя на «Диспетчер Север» и «Сохранить роль»; Then тост «Роль «Диспетчер Север» сохранена».
34. When вкладка «Проверка доступа»; Then селекты «Сотрудник» = «Марина Котова · Логист», «Действие» = «Просматривать машины», «Объект» = «ГАЗель Next · Север Логистик»; результат: pill «Модуль не подключён», «Марина Котова не может: просматривать машины», текст «Модуль не подключён организацией. Подключить его может владелец бизнеса. Модуль: Логистика.», «Нет доступных разделов модулей».
35. When пресет «Начисления водителю»; Then pill «Запрещено функцией «Водитель»», «Илья Васильев не может: видеть начисления», текст «Действующая функция «Водитель» запрещает начисления через любую роль и группу.».
36. Given logistics подключён; When пресет «Нет доступа к объекту»; Then pill «Нет доступа к объекту», текст «Право есть, но объект находится вне области назначения. Объект: Isuzu Elf · Юг Транс.»; When пресет «Нет права»; Then pill «Нет права», «Ни одна роль сотрудника не разрешает это действие.»; When сотрудник «Илья Васильев · Водитель», действие «Просматривать машины», объект «ГАЗель Next · Север Логистик»; Then pill «Разрешено», «Илья Васильев может: просматривать машины», «Основание · роль «Водитель» · Москва / Север Логистик · через группа «Водители Север».», чип рабочего места «Логистика».

### Подписка и места
37. When «Подписка и места»; Then h1 «Подписка и места»; h2 «Пробный период · «Старт»»; pill «до 13.10.2026 · осталось 12 дн.»; «В пробном периоде до 10 мест и все подключённые модули. …»; «Места» «9 из 10»; «7 активны · 2 приглашения · 1 свободно».
38. Then `radiogroup` «Срок оплаты»: «12 мес −20%» `aria-checked="true"`; `radiogroup` «Тариф»: 5 карточек; «Старт» — «до 10 мест», цена /3\s?120 ₽/, «37 440 ₽ за 12 мес», «Тот же лимит, что в пробном периоде»; «Безлимит» — «больше 100 мест», «Индивидуально», «расчёт с оператором»; подсказка «Выберите тариф», кнопка «Отправить заявку оператору» disabled.
39. When выбрать «Месяц»; Then у «Старт» цена «3 900 ₽», строки «за 12 мес» нет.
40. When «12 мес», клик «Команда»; Then `aria-checked="true"`, блок «7 120 ₽ в месяц · 85 440 ₽ за 12 мес», «Экономия 21 360 ₽ по сравнению с помесячной оплатой. Новый лимит: 25 мест.»; кнопка отправки enabled.
41. When ввести комментарий и «Отправить заявку оператору»; Then тост «Заявка отправлена оператору»; баннер `role=status` «Заявка SR-… на «Команда» · 12 мес отправлена …. Новый лимит начнёт действовать после подтверждения оператором.» с кнопкой «Отменить заявку»; все карточки тарифов `aria-disabled="true"`; подсказка «Сначала дождитесь решения по текущей заявке или отмените её».
42. When «Отменить заявку»; Then тост «Заявка отменена», баннер исчез, тарифы снова доступны.
43. Then «Занимают место · 9»: первые 7 с чипом «Активен», затем «Олеся Петрова» и «Сергей Ильин» с чипом «Приглашён», подписью «Приглашение до 06.10 · место зарезервировано» и кнопкой «Отозвать»; «Не занимают место · 5»: «Кирилл Громов» «Водитель · заблокирован, история сохранена», «Иван Петров» «отделочник · карточка без входа (бригада)».
44. When «Отозвать» у Олеси Петровой; Then диалог «Отозвать приглашение?», «Олеся Петрова · o.petrova@alta.example», пункты «Место освободится сразу», «Ссылка из письма перестанет работать»; When «Отозвать»; Then тост «Приглашение отозвано, место свободно», «Места» «8 из 10», подпись «7 активны · 1 приглашение · 2 свободно», «Занимают место · 8» (лимит не меняется — `seatsLimit: 10`, `mock-data.js:92`; `revokeInvite` удаляет участника из `db.members`, после чего `syncSeats` пересчитывает `seatsUsed` 9 → 8, `api.js:31–32, 169–176`; подписи — `:3914, 3934`); диалог должен закрыться (в прототипе не закрывается — см. §11).
45. Given 10 из 10 (после приглашения); Then в карточке «Места» `role=status` «Мест нет: новые приглашения закрыты. Сотрудники с доступом продолжают работать.», полоса `#A13A33`.
46. When «Пригласить» на этой странице; Then открыта страница «Пользователи и роли», вкладка «Люди», диалог «Пригласить участника».
47. Given персона «Владелец · Ирина Белова» (SPA «Лотос»); Then h2 «Тариф «Команда»», pill «Оплачено до 31.03.2027», «Оплата за 12 мес · цены версии v1 сохраняются до конца периода», «23 из 25», баннер «Заявка SR-12 на «Бизнес» · 12 мес отправлена 29.09 16:40. …», «Команда» — «Текущий тариф», «Старт» — «Занято 23 — не поместится», все тарифы disabled.

### Оформление
48. When «Оформление»; Then h1 «Оформление», «Версия 1 · стандартное оформление», `getByLabel('Название организации')` = «Альта Групп», «Короткое имя» пусто, счётчик «0 / 16», плитка знака с буквой «А».
49. Then `radiogroup` «Палитра» — 8 радио; «Ортус» `aria-checked="true"`; `getByLabel('Свой цвет в формате HEX')` = «#1F6B52»; `role=status` начинается с «Контраст с белым текстом » и заканчивается «: подходит для кнопок и ссылок.»; чипы «Принят», «Ждёт проверки», «Заблокирован»; панель «Изменений нет», «Отменить» и «Сохранить для всех» disabled.
50. When клик радио «Сливовый»; Then `aria-checked="true"`, HEX «#7A3E79», «Есть несохранённые изменения», «Сохранить для всех» enabled; плитка знака и кнопка «Принять» в предпросмотре окрашены `#7A3E79` (rgb(122, 62, 121)).
51. When ввести HEX «#FFD400»; Then `role=status` «Контраст с белым текстом 1,4:1 — мало для текста. В интерфейсе будет использован #8A7300 (4,6:1).» (вычислено по `contrastW`/`fixAccent`/`fmtRatio` `:2353–2357`, шаблон строки `fixText` `:3719`: `relLum(#FFD400)` = 0,6835 → `contrastW` = 1,43 → «1,4:1»; `fixAccent` делает 15 шагов `mixHex(c,'#000000',0.04)` до `#8A7300`, `contrastW` = 4,63 → «4,6:1»; `brandVars(#8A7300)` = {hover `#715E00`, soft `#EFEBDB`, tint `#F7F5ED`}); квадрат-образец присутствует; «Сохранить для всех» enabled (цвет валиден).
52. When ввести «zzz»; Then `role=alert` «Введите цвет в формате #RRGGBB, например #2B5479», в панели пункт «· Цвет — в формате #RRGGBB», «Сохранить для всех» disabled.
53. When очистить «Название организации»; Then «· Укажите название организации», сохранить нельзя; When ввести 61 символ — `maxlength` не даст; When «Короткое имя» 17 символов; Then счётчик «17 / 16» красный, «· Короткое имя — до 16 символов».
54. When в «Термины» у «Смена» очистить «5 и больше»; Then «· Термин «Смена»: заполните все четыре формы», кнопка «Вернуть стандартный» появилась; When ввести «смен»; Then ошибки нет, пример «1 смена · 2 смены · 5 смен»; When ввести «Одна» = «рейс», «Много» = «рейсы», «2–4» = «рейса», «5 и больше» = «рейсов»; Then предпросмотр «Приёмка рейсов», «3 рейса ждут проверки».
55. When в «Меню и иконки» у «Салон и SPA» клик «Показан»; Then кнопка «Скрыт», `aria-pressed="false"`, строка с `opacity: 0.55`, в предпросмотре пункта нет; у «Главная», «Модули и место», «Пользователи и роли», «Подписка и места», «Оформление» вместо кнопки — «всегда виден».
56. When клик `getByRole('button', {name:'Сменить иконку: Главная'})`; Then `radiogroup` «Иконка пункта» с радио `home`, `dashboard`, `space_dashboard`; When выбрать `dashboard`; Then список закрыт, иконка кнопки `dashboard`, в предпросмотре у «Главная» иконка `dashboard`.
57. When «Ниже» у «Модули и место»; Then порядок в группе «Компания»: Пользователи и роли, Модули и место, …; «Выше» у первого в группе disabled.
58. When ввести в `getByLabel('Название пункта «Подписка и места»')` «Тариф»; Then в предпросмотре пункт «Тариф».
59. When клик `getByRole('switch', {name: /Показывать «Работает на Ортус»/})`; Then `aria-checked="false"`; вкладка «Публичная форма» — текста «Работает на Ортус» нет; вкладка «Письмо» — нет.
60. Then вкладки предпросмотра `group` «Что показать»: «Приложение» `aria-pressed="true"`; When «Письмо»; Then «От: Альта Групп · через Ортус», «Дарья Зимина приглашает вас в «Альта Групп». Приглашение действует 7 дней.», «Принять приглашение».
61. When загрузить файл `text/plain`; Then тост «Нужен PNG, SVG, JPG или WebP»; When PNG > 1 МБ; Then «Файл больше 1 МБ»; When валидный PNG; Then `getByRole('img', {name:'Логотип'})` виден, кнопка «Убрать» есть; в шапке предпросмотра логотип вместо буквы.
62. When короткое имя «Альта», цвет «Синий», «Сохранить для всех»; Then тост «Оформление сохранено и видно всем сотрудникам», «Версия 2 · изменено HH:MM, Дарья Зимина», «Изменений нет»; в шапке приложения текст «Альта» вместо «ортус», `documentElement` имеет `--ox-accent: #2B5479`; активный пункт меню окрашен в `#2B5479`.
63. When «Стандартное оформление»; Then HEX «#1F6B52», короткое имя пусто, «Есть несохранённые изменения», название осталось «Альта Групп».
64. Given персона «Владелец · Ирина Белова»; Then «Версия 3 · изменено 24.09 12:10, Ирина Белова», короткое имя «Лотос», «Сливовый» выбран, у термина «Визит» «1 сеанс · 2 сеанса · 5 сеансов» и «Вернуть стандартный»; шапка: «Лотос», `--ox-accent: #7A3E79`; изменения Альты не видны; When вернуться к Дарье Зиминой; Then оформление Альты прежнее.

### Раскладка и доступность
65. Given «Ширина» = «390 · телефон»; Then боковой `nav` «Основная навигация» отсутствует, виден `nav` «Навигация» с кнопками «Главная», «Модули», «Люди», «Ещё»; When «Ещё»; Then диалог «Все разделы» с «Подписка и места» и «Оформление»; страницы не имеют горизонтальной прокрутки; диалоги прижаты к низу (радиус 16px сверху).
66. Given «768 · планшет»; Then боковая панель-рейл 68px без подписей (пункты с `title`), в «Роли» список занимает 100% ширины над редактором.
67. Given «1440 · компьютер»; Then панель 244px с подписями и заголовками групп «Обзор», «Компания»; в «Роли» список `max-width: 300px` слева.
68. Любой открытый диалог: `role="dialog"` `aria-modal="true"`; Escape закрывает; клик по подложке закрывает.
69. Тост: `aria-live="polite"`, исчезает через ~4,2 с; при ошибке `role="alert"`.

## 11. Открытые вопросы

- ⚠ `confirmTrialEnd` вызывает `setTenantStatus('t-alta', …)` с жёстким id (`:2745`); для Лотоса кнопка не показывается (status active), но при реализации использовать id текущего тенанта.
- ⚠ `onRevoke` в биллинге не закрывает диалог после успешного отзыва (`:3937`), в отличие от `opConfirm` (`:2822`) — реализовать закрытие.
- ⚠ Значения по умолчанию диалогов `assign`/`invite` (`region:'r-msk', firm:'f-msk-sever'`, `scope:'f-msk-sever'`) не существуют в Лотосе (`:2750, 3157, 3940`; `ortus/mock-data.js:57`) — в Лотосе select «Фирма» без совпадающей опции, итог «Только —». Нужен выбор первой фирмы текущей организации.
- ⚠ `roleSel:'r-manager'` по умолчанию отсутствует в Лотосе → редактор показывает `roles[0]` (системную), в списке ни одна кнопка не `aria-pressed` (`:3165`).
- ⚠ Лотос показывает в «Не занимают место» бригаду Альты (`repair.crew` приходит из `extraSeed`, `ortus/mock-data.js:43`) — данные демо, не правило.
- ⚠ Склонения: «{N} участников» (`:3157`), «{n} разрешений» (`:3155`), «осталось {n} дн.» (`:3912`) не склоняются — повторять дословно или исправить (решение плана).
- ⚠ Пункт диалога лимита «или выберите лимит от 50 ГБ» захардкожен и не зависит от занятого объёма (`:2726`).
- ⚠ Прототип сохраняет только выбранный `accent`; `accent_used` вычисляется при применении (`:3730`, `:2939`), тогда как `docs/18-branding.md:41` требует хранить оба значения на сервере.
- ⚠ Буква в шапке приложения берётся только из `short` (`:3034`), а в «Оформлении» — из `short || первое слово названия` (`:3673`): при пустом коротком имени шапка показывает «о», предпросмотр — «А».
- ⚠ Крошка страницы «Оформление» — статичная «Компания» без имени тенанта (`:1249`), у остальных «{tenant} / Компания».
- ⚠ Для owner нет проверки ключей прав (`modules.manage`, `billing.manage`, `roles.manage`, `branding.manage`) — шлюз по персоне (`:3054`); как вести себя для «уполномоченного» с `billing.read` без `manage` — не найдено в источниках.
- ⚠ Точные значения контраста для палитры в источниках не записаны; `docs/18:45` лишь утверждает «4.5:1 и выше».
- ⚠ Срок жизни приглашения: «Приглашение до 08.10» захардкожено (`ortus/api.js:165`), в письме «Приглашение действует 7 дней» (`:1423`); B-05 открыт (`docs/17:213`).
- ⚠ Понижение тарифа «с начала следующего периода» (`docs/17:92`) в mock не реализовано — подтверждение меняет лимит сразу (`ortus/api.js:203–205`).
- ⚠ Светлая/тёмная тема сотрудника упомянута в тексте страницы, в макете не реализована (`docs/18:67`).
- ⚠ Откат к прошлой версии оформления (BR-03), брендирование PDF (BR-02), картинка входа (BR-01) — не решены.
- ⚠ `brDraft`, `brTab`, `brIconOpen` нет в `INITIAL()` (`:2368–2379`) — кнопка «Сбросить» их не очищает.

## 12. Факты для плана

1. Объём шаблона домена: modules 77 строк, users 138, billing 76, branding 200, диалоги ~85; VM: omVM 38, usersVM 28, roleEditorVM 45, accessVM 30, billingVM 42, brandingVM 69, modalVM (4 диалога) ~65, обработчики ~120 строк.
2. Зависимости от `ortus/models.js`: `INDUSTRY`, `CORE`, `ALL_MODULES`, `VERBS`, `REASON`, `MEMBER_STATE`, `TENANT_STATE`, `grants`, `can`, `canEarnings`, `rolePermKeys`, `scopeLabel`, `unitLabel`, `firmsOf`, `plural`, `num`, `rub`, `emailOk`, `initials` — реализовать как общий пакет домена до страниц.
3. Методы адаптера домена: `setModule`, `setStorageQuota`, `setTenantStatus`, `invite`, `revokeInvite`, `assign`, `unassign`, `createRole`, `saveRole`, `requestSeats`, `cancelSeatRequest`, `saveBranding` (12 шт.); HTTP-пути в `ortus/api.js:587–609`, часть помечена PROPOSED.
4. Общие компоненты, нужные всем четырём страницам: карточка, pill-чип (`ch`), кнопки (primary/secondary/text/danger-outline), select/input 44px, switch 44×26 и 40×22, confirm-диалог с секциями и ack, тост, баннер, meter.
5. Порядок реализации по зависимостям: оболочка (шапка, навигация, брейкпоинты, модал, тост, баннеры) → «Модули и место» → «Пользователи и роли» (нужны роли для назначения) → «Подписка и места» (нужны приглашения) → «Оформление» (нужна полная навигация owner для редактора меню).
6. «Оформление» зависит от `navForBase` всех остальных модулей (fleet/pool/review/spa/repair/core) — для изоляции задачи нужен стаб навигации с фиксированным списком пунктов.
7. Акцент применяется CSS-переменными на `:root`: `--ox-accent`, `--ox-accent-hover`, `--ox-accent-soft`, `--ox-accent-tint`; компоненты не должны содержать литералов акцента; цвета статусов (`TONE`) — константы.
8. `M.rub` и `toLocaleString('ru-RU')` дают неразрывный пробел — в e2e сравнивать через regex `\s`.
9. Дата демо «1 октября 2026», trial Альты до 13.10.2026 (12 дней) — фиксировать время в тестах.
10. Mock держит состояние в памяти; тесты должны начинать с «Сбросить» или перезагрузки.
11. Приглашение сдвигает места 9→10 и закрывает следующее — сценарий «мест нет» воспроизводим одним действием.
12. Лотос — обязательный второй контур для тестов изоляции (цвет `#7A3E79`, «Лотос», термин «сеанс», версия 3, pending SR-12).
13. Контраст и затемнение — чистые функции (`:2350–2356`), покрыть юнит-тестами до UI (TDD): палитра ≥ 4.5, `#FFD400` → затемнение, невалидный hex → `#1F6B52`.
14. `calc` тарифа — чистая функция; таблица ожидаемых значений в §7.3.
15. `rolePermKeys` даёт счётчики в списке ролей (22/10/5/6) — юнит-тест по данным `mock-data.js:167–173`.
16. Файлы логотипа/знака — `URL.createObjectURL`, живут до перезагрузки; в e2e использовать `setInputFiles` на скрытый `input[type=file]`.
17. В редакторе роли переключатель отраслевого модуля может быть `checked` и `disabled` одновременно (модуль не подключён, но действия у роли есть).
18. Диалог `assign` — максимум 620px, остальные 560px; mobile — bottom sheet.
19. Toast-тексты и ошибки API перечислены дословно в §5–8 — их должна содержать i18n-таблица, а e2e-тесты — проверять по точному тексту.
20. Для owner нет AccessGate — но при переносе в React с реальными правами нужно решить, что показывать уполномоченному без `billing.manage` (вопрос §11).
21. Риск: несклоняемые строки и захардкоженные id/даты в прототипе (§11) — зафиксировать в плане как «исправить при реализации» или «повторить дословно».
22. Playwright-селекторы опираются на `aria-label`/`role`/текст: `meter` «Занятое место», `tablist` «Разделы доступа», `radiogroup` «Срок оплаты»/«Тариф»/«Палитра»/«Иконка пункта»/«Основа роли», `switch` «Доступ роли к модулю …», `group` «Что показать», `dialog` с `#dlg-title`.

## 13. Исправления после критики

По `00-coverage-critique.md` (раздел «02-company»), каждый пункт проверен по первоисточнику:

1. Чек-лист #44 — убрано противоречие «8 из 9»/«8 из 10». Верно «8 из 10», «Занимают место · 8», подпись «7 активны · 1 приглашение · 2 свободно». Источник: `mock-data.js:92` (`seatsLimit: 10, seatsUsed: 9`), `api.js:169–176` (`revokeInvite` удаляет участника), `api.js:31–32` (`syncSeats` пересчитывает `seatsUsed` по `active|invited`), `Ортус CRM.dc.html:3914, 3934` (строки «{used} из {lim}», «Занимают место · {active+invited}»).
2. Чек-лист #51 — вместо «⚠ вычислить формулой» записаны числа: для `#FFD400` → «1,4:1», `fixAccent` → `#8A7300` (15 итераций), «4,6:1». Также исправлен шаблон строки: в прототипе `fixText` = «… будет использован {fixed} ({ratio}).» без слов «или выше» (`:3719`). Формулы `:2350–2357`; расчёт выполнен скриптом по этим формулам (Node 22).
3. §6.2 — добавлена пометка, что `us.listMax` зависит от `s.w` (окно), а не `W` (кадр): `:2829` (`W = min(frame, s.w)`), `:2867` (`usersVM(db, s.w)`), `:3157` (`listMax: w >= 1080 ? '300px' : '100%'`). Решение для плана: воспроизводить как есть; занести в `decisions.md`.
