# 01 · Оболочка приложения и глобальное поведение прототипа «Ортус CRM»

Рабочая карта для агентов, реализующих оболочку (demo-панель, шапка, навигация, баннеры, AccessGate, тосты, модальная система, маршрутизация, онлайн/офлайн, оформление организации). Все пути — относительно `design/`. Строки интерфейса приведены дословно.

> **Снимок эталона: 14.10.2026** (тег `design-stage-1`, `design/MANIFEST.md`; W0.02). Ссылки на строки пересчитаны с 03.10 по diff главного файла и `ortus/*.js` (сверено с `v2/analysis/A-prototype-delta.md` §3.10). Изменившиеся в 14.10 места переписаны: §1, §2, §8, §9.1, §9.5, §11, §12, §14.3, §18, §20, §22; новые §23 «Главная: реестр источников «Требует решения»» и §24 «Хост встроенных модулей». Меню владельца — по D-23 (`design/docs/16-raid-glossary.md`).

## 1. Источники

| Файл | Строки | Что |
|---|---|---|
| `Ортус CRM.dc.html` | 1–27 | `<helmet>`: title, шрифты, глобальный CSS, `:root`-токены акцента |
| `Ортус CRM.dc.html` | 28–92 | Корневой контейнер, панель «Демо-режим», диалог «Путь проверки», фрейм ширины, скрытый `<input type="file">` |
| `Ортус CRM.dc.html` | 94–146 | `<header>`: логотип/знак/буква, организация и область, «Нет связи», колокольчик, профиль, поповеры «Уведомления» и «Профиль» |
| `Ортус CRM.dc.html` | 148–203 | Боковая навигация (sidebar/rail), `<main id="ox-main">`, баннеры, скелетон, ошибка загрузки, AccessGate |
| `Ортус CRM.dc.html` | 205–282 | Страница `pg.modules` (только как контекст для баннеров/триала; сама страница — домен «Компания») |
| `Ортус CRM.dc.html` | 2125–2160 | Страница `pg.planned` («план», `pn.*`) |
| `Ортус CRM.dc.html` | 2165–2174 | Нижняя навигация (`mobile`) |
| `Ортус CRM.dc.html` | 2176–2285 | Модальный контейнер и виды `mConfirm`, `mAssign`, `mInvite`, `mRole`, `mRequest`, `mSheet` |
| `Ортус CRM.dc.html` | 2287–2295 | Тост |
| `Ортус CRM.dc.html` | 2297–2353 | Константы `MEMBER`, `MEMBER_BY`, `PERSONAS`, `DEFAULT_PAGE`, `PAGE_MOD`, `TONE`, `LINE`, `BR_*`, `PLAN_LABEL/ICON`, `INITIAL` |
| `Ортус CRM.dc.html` | 2355–2464 | `Component`: `frameRef`, `componentDidMount`, `boot`, `reset`, `toast`, `run`, `mark`, `setPersona`, `go`, `setPage`, `closeModal`, `setOnline` |
| `Ортус CRM.dc.html` | 2567–2572, 2643–2798 | `refresh`, `confirm`, `toggleModule`, `applyQuota`, `confirmTrialEnd`, `openAssign`, `patchModal`, `saveAssign`, `removeAssign`, `saveInvite`, `saveCreateRole`, `accept`, `openRequest`, `saveRequest`, `opConfirm` |
| `Ортус CRM.dc.html` | 2801–3098 | `renderVals`, `toastVM`, `guideVM`, `navFor`, `termOf`, `applyBrand`, `brandNav`, `navForBase`, `shellVM`, `gateVM`, `bannersVM` |
| `Ортус CRM.dc.html` | 3100–3129 | `omVM` (блок trial — источник текстов статуса подписки) |
| `Ортус CRM.dc.html` | 3162, 3949, 4118 | Открытие модалок `invite` / `createRole` из страниц |
| `Ортус CRM.dc.html` | 3953–4040 | `planVM`, `modalVM` |
| `support.js` | 401–444, 550–660, 787–814, 1567–1589 | Рантайм: `{{ }}`-привязки, `sc-if`, `sc-for`, `style-hover` (класс с `:hover` и `!important`), `value/checked` по умолчанию |
| `ortus/api.js` | 1–268, 285–290 | `createMockAdapter`: `flags`, `setActor`, `setFlag`, `load`, `view()` (фильтрация ответа под участника), `cmd`, `event`, `setModule`, `setStorageQuota` |
| `ortus/models.js` | 24–123, 151–156, 237–306, 413–414 | `INDUSTRY`, `CORE`, `ALL_MODULES`, `REASON`, `TENANT_STATE`, `num/int/plural`, `unit*`, `scopeLabel`, `moduleOn`, `grants`, `can`, `canEarnings`, `emailOk`, `initials` |
| `ortus/mock-data.js` | 1–289 | Сиды «Альта Групп» (`seed`) и SPA «Лотос» (`seedLotos`), `BRAND_DEFAULT`, `seedBrands`, тенанты платформы |
| `ortus/extra-data.js` | 1–146 | Данные календаря, базы знаний, SPA, кассы, ремонта (источник счётчиков в меню) |
| `ortus/roadmap.js` | 1–133 | `ROADMAP` — контент страниц «план» |
| `ortus/service.js`, `knowledge.js`, `documents.js`, `chats.js`, `cash.js` | полностью | 14.10: домен встроенных модулей; оболочке нужны бейджи (`db.chats`, `db.docs`, `db.service`, `db.cash.badge`), источники «Главной» и `this.SV` (`svcNow`, `slaHead`) для очереди обращений |
| `Ортус CRM.dc.html` | 1588, 1593, 1598, 1826, 1830, 1834, 1898, 2121 | 14.10: восемь `<dc-import>` (Формы и опросы, Обращения, Задачи и проекты, База знаний, Документы, Чаты, Касса, Ремонт и стройка); файлов первых семи в снимке нет (`design/MANIFEST.md`, «Не хватает») |
| `Ортус CRM.dc.html` | 2856–2880 | 14.10: пропсы встроенных модулей (`v.fx`, `v.sv`, `v.tj`, `v.kb2`, `v.dx`, `v.cht`, `v.csx`, `v.rp`) — контракт хоста, §24 |
| `Ортус CRM.dc.html` | 4043–4119 | 14.10: `homeVM` — источники «Требует решения», §23 |
| `README.md` | 1–189 | Ключевые UX-решения, порядок проверки, токены, компоненты, ограничения |
| `docs/README.md`, `docs/18-branding.md`, `docs/12-errors-and-events.md`, `docs/design-system/components.md`, `docs/design-system/tokens.css` | полностью | Контракт `AppShell`, `Banner`, `AccessGate`, `Dialog`, `Toast`; правила оформления; реестр ошибок |

### Якоря снимка 14.10

Строка, на которой в снимке `design-stage-1` начинается определение. Тест `docs/plan/scripts/design-snapshot.test.mjs` сверяет каждую строку таблицы с `design/`.

| Идентификатор | Строка | Что |
|---|---|---|
| `DEFAULT_PAGE` | `:2301` | стартовые страницы персонажей |
| `PAGE_MOD` | `:2302` | страница → модуль для `gateVM` (14 ключей) |
| `toast` | `:2414` | тост |
| `go` | `:2448` | переход с переключением персонажа |
| `setPage` | `:2452` | переход текущего персонажа; для `repair` сбрасывает `rpTab`, `rpObj` |
| `renderVals` | `:2801` | сборка `v` шаблона |
| `pg` | `:2836` | ключи страниц |
| `navFor` | `:2923` | меню после оформления |
| `brandNav` | `:2934` | переименование, скрытие, порядок |
| `navForBase` | `:2950` | меню по правам и состоянию модулей (D-23) |
| `CORE_ITEMS` | `:2964` | 10 общих модулей |
| `shellVM` | `:3005` | шапка, меню, нижняя навигация |
| `gateVM` | `:3053` | AccessGate |
| `bannersVM` | `:3083` | баннеры |
| `RO_TEXT` | `:3090` | тексты баннера «только чтение» по модулю |
| `modalVM` | `:3964` | модальные окна |
| `homeVM` | `:4043` | «Главная»: очередь «Требует решения» |
| `moduleOn` | `models.js:277` | модуль включён |
| `can` | `models.js:286` | проверка права |
| `scopeLabel` | `models.js:258` | подпись области (`project`, `account` — 14.10) |
| `view` | `api.js:185` | фильтрация ответа под участника |
| `setModule` | `api.js:285` | подключение и отключение модуля |

## 2. Сводка

- Один HTML-компонент (`class Component extends DCLogic`) рендерит всё приложение; состояние — один объект `state` (`INITIAL()` + `w`, `frame`), шаблон читает «плоский» объект `renderVals()` (`Ортус CRM.dc.html:2801–2883`).
- Верхняя тёмная панель «Демо-режим» (`#22302C`) — не часть продукта: переключает персонажа (3 группы, 8 вариантов), ширину фрейма (auto/390/768/1440), флаги «Нет связи», «Конфликт брони», «Сбой загрузки фото», открывает «Путь проверки» и сбрасывает состояние (`:29–88`).
- Приложение рисуется внутри «фрейма» (`:91`) заданной ширины; брейкпоинты считаются по ширине фрейма, а не окна: `mobile = W < 640`, `rail = 640 ≤ W < 1080`, sidebar при `W ≥ 1080` (`:2804–2805`).
- Персонажи: `operator` (без участника, отдельная тёмная оболочка), `owner`, `manager`, `driver`, `therapist`, `foreman` в «Альта Групп» (`t-alta`); `owner@t-lotos`, `therapist@t-lotos` в SPA «Лотос» (`:32–47`, `:2297–2299`).
- Маршрутизация — словарь `state.pages[persona] = pageKey`; у каждого персонажа своя «текущая страница», стартовая — `DEFAULT_PAGE` (`:2301`). Переход: `setPage(page)` (текущий персонаж) или `go(persona, page)` (с переключением персонажа) (`:2448–2455`).
- Навигация вычисляется из прав и **состояния отраслевого модуля** (`navForBase`, `:2950–3003`) и затем переопределяется оформлением организации (`brandNav`, `:2934–2948`): подписи, иконки, порядок, скрытие (кроме `BR_LOCK`). 14.10, D-23: у владельца подключённый модуль даёт свою группу, отключённый с историей — один пункт в группе «Отключены · только чтение» внизу меню, не подключавшийся — ничего. «Общие модули» — 10 пунктов (`CORE_ITEMS`) с бейджами чатов, обращений, документов и кассы; у водителя и прораба отдельный пункт «Подотчёт».
- Доступ к странице проверяется `gateVM` (`:3053–3081`): три состояния — «Модуль не подключён», «Модуль отключён», «Нет права»; при закрытом доступе страница не рендерится, показывается карточка AccessGate. 14.10: при `module_readonly` гейт **пропускает** в режим чтения, если право есть «как если бы модуль был включён», — для всех страниц (`:3061`, `:3073`), а не только для логистики.
- Баннеры (`bannersVM`, `:3083–3098`): окончание trial, отключённый отраслевой модуль (только чтение; 14.10 — «Логистика», «Салон и SPA», «Ремонт и стройка», тексты `RO_TEXT`), нет связи, отправка очереди, место заполнено.
- 14.10: семь страниц общих модулей и «Ремонт и стройка» рисуются встроенными модулями `<dc-import>`; оболочка отдаёт им `db`, `mid`, одноразовое «открыть запись» и колбэки `onApi`/`onNav`/`onToast` (§24). «Главная · Требует решения» собирается из источников разных модулей (§23).
- Шапка: логотип/знак/первая буква, короткое имя (`ортус` по умолчанию), организация, область (текст или `<select>` у владельца), пилюля «Нет связи», колокольчик с непрочитанными, аватар-инициалы; оператор — тёмная шапка без колокольчика (`:94–146`, `:3031–3042`).
- Тост один, снизу по центру, авто-скрытие 4200 мс, тона `ok/warn/error/info` (`:2414–2418`, `:2885–2891`).
- Модальная система: один контейнер с бэкдропом, шесть видов (`confirm`, `assign`, `invite`, `createRole`, `request`, `sheet`); на телефоне — нижний лист (`:2176–2285`, `:3964–4040`).
- Клавиатура: только `Escape` (закрыть модалку, иначе поповеры/гид) (`:2380–2384`). Фокус-ловушки в прототипе нет (⚠ контракт `Dialog` в `components.md:32` её требует).
- Онлайн/офлайн: флажок «Нет связи» и события `window.online/offline` → `api.setFlag('online')`, тост, пилюля в шапке, баннер; при восстановлении — `flush()` очереди (`:2458–2464`, `:2527–2551`).
- Оформление организации применяется CSS-переменными `--ox-accent*` на `:root` при каждом рендере шапки (`applyBrand`, `:2928–2933`); у оператора — стандартный цвет.
- SPA «Лотос» — вторая изолированная «БД» в mock-адаптере с общим `platform`; сливовый акцент `#7A3E79`, короткое имя «Лотос», термин «сеанс» (`mock-data.js:14`, `42–82`).
- Страницы «план» (`pg.planned`, `ROADMAP`) в текущем снимке **недостижимы из навигации**: помощник `plan()` объявлен, но не вызывается (`:2952`); пункты с бейджем «план» не генерируются.
- Все тексты статусов обязаны дублироваться иконкой и подписью, не только цветом (`README.md:41`, `components.md:8`).

## 3. Инвентарь

| № | Ключ / идентификатор | Подпись (verbatim) | Персонажи | Шаблон (строки) | VM / обработчики (строки) |
|---|---|---|---|---|---|
| 1 | Панель «Демо-режим» (`role=region`, `aria-label="Панель демонстрации"`) | «Демо-режим» | все | 29–67 | `renderVals` 2807–2817 |
| 2 | Диалог «Путь проверки» (`guideOpen`) | «Основной путь», «Негативные проверки» | все | 68–87 | `guideVM` 2893–2921, `mark` 2435, `go` 2448 |
| 3 | Фрейм ширины (`frameRef`) | — | все | 90–91 | `frameRef` 2358–2367, `onResize` 2377 |
| 4 | Шапка `<header>` | «пространство бизнеса» / «управление платформой» | все | 94–122 | `shellVM.top` 3032–3042 |
| 5 | Поповер уведомлений (`notifOpen`) | «Уведомления», «Прочитать все», «Новых событий нет» | все кроме operator | 124–135 | `shellVM.notif` 3043–3044 |
| 6 | Поповер профиля (`profileOpen`) | «Профиль», «Назначения»/«Права», «Выйти · недоступно в демо» | все | 136–145 | `shellVM.profile` 3045–3048 |
| 7 | Боковая навигация `nav[aria-label="Основная навигация"]` | группы/пункты из `navForBase` | все, при `W ≥ 640` | 149–170 | `navFor` 2923, `brandNav` 2934, `navForBase` 2950, `shellVM` 3021–3026 |
| 8 | Нижняя навигация `nav[aria-label="Навигация"]` | 3 пункта + «Ещё» | все, при `W < 640` | 2165–2174 | `shellVM` 3027–3030 |
| 9 | Лист «Все разделы» (`mSheet`) | «Все разделы», «Закрыть» | все, мобильный | 2274–2282 | `modalVM` 4038 |
| 10 | Баннеры (`banners[]`) | 5 видов, см. §11 | все кроме operator | 174–180 | `bannersVM` 3083–3098 |
| 11 | Скелетон загрузки (`loading`) | «Загружаем рабочее пространство…» | все | 182–190 | `renderVals` 2821, 2827–2829 |
| 12 | Ошибка загрузки (`loadErr`) | «Не удалось загрузить модули прототипа: …» | все | 191–193 | `boot` 2408 |
| 13 | AccessGate (`gate.show`) | 4 варианта, см. §12 | owner/manager/driver/therapist/foreman | 195–203 | `gateVM` 3053–3081 |
| 14 | Страница «план» (`pg.planned`) | «Карта экранов · следующая итерация» | ⚠ недостижима | 2125–2160 | `planVM` 3953–3962 |
| 15 | Модальный контейнер (`modalOpen`) | — | все | 2176–2178, 2283–2285 | `modalVM` 3964–3967, `closeModal` 2456 |
| 16 | `mConfirm` (`kind:'confirm'`) | «Отмена», `confirmLabel` | все | 2179–2201 | `modalVM` 3969–3977, `confirm` 2643 |
| 17 | `mAssign` (`kind:'assign'`) | «Назначить роль», «Назначить» | owner | 2203–2225 | `modalVM` 3978–4005, 2723–2737 |
| 18 | `mInvite` (`kind:'invite'`) | «Пригласить участника», «Пригласить» | owner | 2227–2246 | `modalVM` 4006–4021, 2738–2746 |
| 19 | `mRole` (`kind:'createRole'`) | «Создать роль», «Создать и настроить» | owner | 2248–2262 | `modalVM` 4022–4034, 2747–2753 |
| 20 | `mRequest` (`kind:'request'`) | «Запросить водителя», «Отправить запрос» | manager/owner | 2264–2272 | `modalVM` 4035–4037, 2791–2795 |
| 21 | Тост (`toast.show`) | текст из `toast()` | все | 2287–2291 | `toast` 2414, `toastVM` 2885 |
| 22 | Скрытый `<input type="file">` | — | все | 92 | `fileRef/onFile` 2368–2373 |

## 4. Корневая раскладка, фрейм и брейкпоинты

### 4.1 Документ и глобальный CSS (`:10–26`)

- `<title>`: «Ортус — CRM, прототип итерации 1».
- Шрифты Google Fonts: `Golos Text` 400/500/600/700, `IBM Plex Mono` 400/500, `Material Symbols Rounded` (`opsz,wght,FILL,GRAD@24,400,0..1,0`, `display=block`).
- `:root{--ox-accent:#1F6B52;--ox-accent-hover:#185A44;--ox-accent-soft:#E3EFE7;--ox-accent-tint:#F1F7F3}` — стартовые значения; после загрузки перезаписываются `applyBrand` (см. §17).
- `html,body`: `margin:0; background:#E6E9E3; color:#1C2A26; font-family:'Golos Text',system-ui,sans-serif; -webkit-font-smoothing:antialiased`. `*{box-sizing:border-box}`.
- `button,input,select,textarea{font:inherit;color:inherit}`; `button:disabled{opacity:.45;cursor:not-allowed}`; `:focus-visible{outline:2px solid var(--ox-accent);outline-offset:2px}`; `a{color:var(--ox-accent)}`, `a:hover{color:var(--ox-accent-hover)}`.
- `@keyframes ox-pulse{0%{opacity:.5}50%{opacity:1}100%{opacity:.5}}` — скелетон.

### 4.2 Структура (`:28–91`, `:148–173`, `:2161–2294`)

```
div (height:100vh; flex column; bg #E6E9E3; font 14px/1.45)
├── div[role=region aria-label="Панель демонстрации"]        (flex:none; z-index:40)
│   └── div[role=dialog aria-label="Путь проверки"]          (absolute, top:calc(100% + 6px), right:14px)
└── div (flex:1; min-height:0; flex; justify-content:center; padding:{{framePad}}; overflow:auto)
    └── div[ref=frameRef] (position:relative; width:{{frameW}}; max-width:100%; flex column; bg #F2F3EF;
        │                  border:{{frameBorder}}; radius:{{frameRadius}}; shadow:{{frameShadow}}; overflow:hidden)
        ├── input[type=file] (display:none)
        ├── header (flex:none; z-index:20; min-height:58px)
        │   ├── div[role=dialog aria-label="Уведомления"]  (absolute, top:calc(100% + 6px), right:12px)
        │   └── div[role=dialog aria-label="Профиль"]      (absolute, top:calc(100% + 6px), right:12px)
        ├── div (flex:1; min-height:0; flex)
        │   ├── nav[aria-label="Основная навигация"]  — только notMobile
        │   └── main#ox-main (flex:1; min-width:0; overflow-y:auto; flex column)
        │       └── div (width:100%; max-width:{{mainMax}}; margin:0 auto; padding:{{mainPad}}; flex column; gap:16px; flex:1)
        │           ├── баннеры  ├── скелетон  ├── ошибка  ├── AccessGate  └── страницы pg.*
        ├── nav[aria-label="Навигация"] — только mobile (flex:none; border-top:1px solid #DCE2D9; bg #FFFFFF)
        ├── div (бэкдроп модалки; absolute inset:0; z-index:50) — только modalOpen
        └── div[role={{toast.role}}] (absolute; bottom:{{toastBottom}}; z-index:60) — только toast.show
```

### 4.3 Ширина и брейкпоинты (`:2803–2805`, `:2815–2819`, `:2358–2379`)

| Величина | Правило |
|---|---|
| `W` | `frame !== 'auto' ? min(Number(frame), s.w ‖ Number(frame)) : s.w`; `s.w` — ширина элемента фрейма из `ResizeObserver` (обновление при изменении > 2px), стартовое значение `1280` (`:2356`) |
| `mobile` | `W < 640` |
| `rail` | `!mobile && W < 1080` |
| `showLabels` | `!mobile && !rail` (т.е. `W ≥ 1080`) |
| `sideW` | `rail ? '68px' : '244px'` |
| `navJustify` | `rail ? 'center' : 'flex-start'` |
| `mainMax` | `persona === 'driver' ? '680px' : '1320px'` |
| `mainPad` | `mobile ? '16px 14px 28px' : '24px 28px 40px'` |
| `toastBottom` | `mobile ? '76px' : '20px'` |
| `framePad` | `frame === 'auto' ? '0' : '16px'` |
| `frameW` | `frame === 'auto' ? '100%' : frame + 'px'` |
| `frameBorder` | `auto ? '0' : '1px solid #C9D1C7'` |
| `frameRadius` | `auto ? '0' : frame === '390' ? '22px' : '12px'` |
| `frameShadow` | `auto ? 'none' : '0 12px 32px rgba(28,42,38,.16)'` |
| `modalAlign/Pad/Radius` | `mobile ? 'flex-end' / '0' / '16px 16px 0 0' : 'center' / '24px' / '14px'` (`:3966`) |

Правила по README (`README.md:12`, `:49`): боковая панель от 1080 px, иконочный рейл от 640 px, нижняя панель и лист «Ещё» на телефоне; карточки вместо таблиц и кнопки 48–54 px при `< 640`.

Три проверочных ширины: **390** → mobile (нижняя навигация, лист «Ещё», модалка-лист снизу, тост на 76px); **768** → rail (68px, только иконки, подписи скрыты визуально, но присутствуют для скринридера); **1440** → sidebar 244px с группами, бейджами «план» и подписью внизу.

`window.resize` (`:2377`): при `frame === 'auto'` пересчитывает `w` по `getBoundingClientRect()` фрейма (или `window.innerWidth`), с задержкой 50 мс после монтирования.

## 5. Панель «Демо-режим» (`:29–67`, `:2807–2817`)

Контейнер: `role="region" aria-label="Панель демонстрации"`, `flex-wrap; gap:8px 14px; padding:8px 14px; background:#22302C; color:#E4ECE6; font-size:13px; z-index:40`.

| # | Элемент | Verbatim / атрибуты | Стили | Привязка → обработчик |
|---|---|---|---|---|
| 1 | Заголовок | иконка `science` (18px) + «Демо-режим» | `font-weight:600; color:#FFFFFF` | — |
| 2 | `<label>` «Персонаж» + `<select>` | optgroup «Платформа»: `operator` «Оператор платформы»; optgroup «Альта Групп»: `owner` «Владелец · Дарья Зимина», `manager` «Логист · Марина Котова», `driver` «Водитель · Илья Васильев», `therapist` «Массажист · Анна Морозова», `foreman` «Прораб · Алексей Соколов»; optgroup «SPA «Лотос»»: `owner@t-lotos` «Владелец · Ирина Белова», `therapist@t-lotos` «Массажист · Анна Морозова» | `min-height:32px; radius 6px; border:1px solid #4A5A55; bg #2E3D39; color #FFF; padding:0 8px; font-size:13px; max-width:280px` | `value={{personaValue}}`, `onChange={{onPersona}}` → `setPersona(v.includes('@') ‖ v==='operator' ? v : v+'@t-alta')` |
| 3 | `<label>` «Ширина» + `<select>` | `auto` «По окну», `390` «390 · телефон», `768` «768 · планшет», `1440` «1440 · компьютер» | как выше, без max-width | `value={{frame}}`, `onChange={{onFrame}}` → `setState({frame})` |
| 4 | Кнопка «Путь проверки» | иконка `checklist`, `aria-expanded={{guideExpanded}}` (`'true'/'false'`) | `min-height:32px; padding:0 12px; radius 6px; border:1px solid #7CC4A0; bg transparent; color #FFFFFF; font-size:13px` | `onGuide` → `setState({guide:!guide, notif:false, profile:false})` |
| 5 | Кнопка «Сбросить» | иконка `restart_alt` | как 4, но `border:1px solid #4A5A55; color:#E4ECE6` | `onReset` → `reset()` |
| 6 | Чекбокс-пилюля «Нет связи» | `<label>` с `<input type=checkbox>` | `min-height:30px; padding:0 10px; radius 999px; border:1px solid #4A5A55; accent-color:#7CC4A0` | `checked={{offline}}` (= `!online`), `onChange={{onOffline}}` → `setOnline(!checked)` |
| 7 | Чекбокс «Конфликт брони» | аналогично | аналогично | `checked={{conflictNext}}` → `api.setFlag('conflictNext', v)` + `setState({conflictNext:v})` |
| 8 | Чекбокс «Сбой загрузки фото» | аналогично | аналогично | `checked={{failUpload}}` → `api.setFlag('failUploadNext', v)` + `setState({failUpload:v})` |
| 9 | Примечание | «Переключатель персонажей — демонстрация, не механизм безопасности. Данные вымышлены и живут в памяти страницы.» | `flex:1 1 260px; font-size:12px; color:#AFC0B8; padding-left:4px` | — |

`personaValue` (`:2808`): `persona === 'operator' ‖ org === 't-alta' ? persona : persona + '@' + org`.

Семантика флагов на стороне mock-API (`api.js:46`, `450–452`, `467`, `975–979`): `conflictNext` и `failUploadNext` — **одноразовые** (сбрасываются после первого срабатывания); UI тоже снимает галочку (`:2564`, `:2488`, `:2789`).

### 5.1 Переключение персонажа — `setPersona(val)` (`:2437–2447`)

1. `[p, org] = val.split('@')`; если `org` не задан: `org = midOf(state.org, p) !== undefined ? state.org : 't-alta'`; для `operator` — `org = state.org` (оператор «остаётся» в текущей организации).
2. `api.setActor(midOf(org, p), org)` — `MEMBER_BY` (`:2297–2298`): `t-alta: {operator:null, owner:'m-owner', manager:'m-kotova', driver:'m-vasiliev', therapist:'m-morozova', foreman:'m-sokolov'}`, `t-lotos: {operator:null, owner:'m-owner', therapist:'m-morozova'}`.
3. `setState({persona, org, loading:true, notif:false, profile:false, modal:null, conflict:null, guide:false, df:null})` → показывается скелетон.
4. `db = await api.load(320)` → `setState({db, dbPersona:p, loading:false})`.
5. Если `p === 'driver'` → `mark('driver')` (шаг 3 гида).

### 5.2 Сброс — `reset()` (`:2410–2412`)

`setState({...INITIAL(), w, frame}, () => boot())` — пересоздаёт mock-адаптер (новые данные, флаги `online:true, conflictNext:false, failUploadNext:false`), персонаж `owner@t-alta`, страницы `DEFAULT_PAGE`, `prog` (прогресс гида) пуст, `seen` (прочитанные уведомления) пуст, `ownerScope:'all'`.

## 6. Диалог «Путь проверки» (`:68–87`, `:2893–2921`)

- `role="dialog" aria-label="Путь проверки"`, `position:absolute; top:calc(100% + 6px); right:14px; width:min(460px, calc(100vw - 28px)); max-height:72vh; overflow-y:auto; bg #FFFFFF; color #1C2A26; radius 12px; shadow 0 16px 40px rgba(0,0,0,.28); padding:16px; gap:12px`.
- Заголовок `<strong>` «Основной путь» (16px/600) + кнопка `aria-label="Закрыть"` 36×36, radius 8, иконка `close` 20px → `onGuide`.
- `<ol>` шагов (`gap:2px`), каждый `<li>` `padding:5px 0; gap:10px`: кружок 24px (`font-size:12px; weight:600; bg {{s.bg}}; color {{s.fg}}; border:1px solid {{s.border}}`) с `{{s.mark}}`; текст 14px `color {{s.tfg}}`; кнопка «Перейти» (`min-height:32px; padding:0 8px; color var(--ox-accent); weight 500; 13px`) → `s.go`.
- Разделитель `border-top:1px solid #E8ECE5`, `<strong>` «Негативные проверки» (14px/600), `<ul>` (13px, `color:#3A4844`), каждый пункт с иконкой `rule` 16px `#5C6964`.

Шаги (`key`, текст, персонаж → страница):

| № | key | Текст | «Перейти» → | Отмечается (`mark`) |
|---|---|---|---|---|
| 1 | `logistics` | «Владелец: подключить «Логистику»» | `go('owner','modules')` | после успешного `api.setModule('logistics', true)` (`:2660`) |
| 2 | `assigned` | «Назначить Марине Котовой роль и область» | `go('owner','users')` | `saveAssign` для `m-kotova` с ролью, у которой есть `actions.logistics` (`:2734`) |
| 3 | `driver` | «Переключиться на водителя» | `go('driver','today')` | `setPersona('driver')` (`:2446`) |
| 4 | `booked` | «Забронировать совместимую машину» | `go('driver','today')` | успешный `reserve` (`:2562`) |
| 5 | `departed` | «Заполнить осмотр и выехать» | `go('driver','today')` | `submitDep` без блокировки (`:2583`) |
| 6 | `expense` | «Добавить расход» | `go('driver','today')` | `addExpense` онлайн или через `flush` (`:2627`, `:2538`) |
| 7 | `submitted` | «Сдать машину» | `go('driver','today')` | `submitReturn` онлайн или через `flush` (`:2605`, `:2542`) |
| 8 | `accepted` | «Логист: принять смену» | `go('manager','review')` | `accept` → `reviewTrip` (`:2774`) |

Состояния кружка: выполнен — `mark:'✓'`, `bg var(--ox-accent)`, `fg #FFFFFF`, `border var(--ox-accent)`, текст `#5C6964`; текущий (первый невыполненный) — `mark:'N'`, `bg var(--ox-accent-soft)`, `fg var(--ox-accent)`, `border var(--ox-accent)`, текст `#1C2A26`; будущий — `bg #FFFFFF`, `fg #5C6964`, `border #CDD5CB`, текст `#1C2A26`.

Негативные проверки (verbatim, 7 строк, `:2911–2919`):
1. «Несовместимая машина: Hyundai Porter и Ford Transit для Р-208 — кнопка брони недоступна, причина указана»
2. «Незавершённый осмотр: «Выехать» неактивна, показан список недостающего»
3. «Отрицательный расход: введите «-500» — ошибка «Сумма должна быть больше нуля»»
4. «Пробег при сдаче меньше начального — ошибка, сдача невозможна»
5. «Водитель: начислений нет ни в смене, ни в уведомлениях, ни в ответе mock-API»
6. «Флажок «Конфликт брони» → следующая бронь получает конфликт и предложение обновить список»
7. «Флажок «Нет связи» → расходы и сдача сохраняются на устройстве, бронь и выезд блокируются»

`mark(k)` (`:2435`) идемпотентен: `prog[k] = true`. Открытие гида закрывает поповеры; `go()` закрывает гид и модалку (`:2449`).

## 7. Загрузка приложения: `boot`, состояния `loading` / `loadErr` (`:2397–2409`, `:182–193`, `:2821–2829`)

1. `componentDidMount` → `boot()`: динамический `import()` трёх модулей `ortus/api.js`, `ortus/models.js`, `ortus/roadmap.js` от `document.baseURI` (поэтому нужен HTTP-сервер, не `file://` — `README.md:5`); `api = createMockAdapter()`; `api.setActor(midOf(org, persona), org)`; `db = await api.load()` (задержка 500 мс по умолчанию, `api.js:240`); `setState({ready:true, db, dbPersona, err:null})`.
2. Ошибка → `setState({err: String(e.message)})`.
3. `live = ready && db && dbPersona === persona && !loading` (`:2827`). Пока не `live`, шаблон получает «базовый» `v`: `loading: !err`, `loadErr: !!err`, пустые `navGroups/bottomItems/banners`, `top = {bg '#FFFFFF', fg '#1C2A26', muted '#5C6964', line '#DCE2D9', sep '#DCE2D9', sub 'пространство бизнеса', tenant 'Ортус', scope 'Загрузка…', scopeStatic true, scopeSelect false, hasBell false, initials ''}` (`:2823`).

**Скелетон** (`:182–190`): `role="status" aria-label="Загрузка"`, колонка `gap:14px`: блок `14×180px r6 #DFE4DC`; блок `28px × min(420px,80%) r8 #DFE4DC`; блок `120px r12 #E6EAE3`; блок `200px r12 #E6EAE3`; все `animation:ox-pulse 1.4s ease-in-out infinite`; подпись «Загружаем рабочее пространство…» (13px, `#5C6964`).

**Ошибка** (`:191–193`): `role="alert"`, `padding:16px; radius 12px; bg #FBEAE7; color #A13A33`, текст «Не удалось загрузить модули прототипа: {{ loadErrText }}».

## 8. Модель маршрутизации

### 8.1 Константы (`:2301–2302`, `:2836–2838`)

- `DEFAULT_PAGE = { operator:'tenants', owner:'home', manager:'home', driver:'today', therapist:'spa', foreman:'repair' }`.
- `state.pages` — копия `DEFAULT_PAGE`; ключ — **персонаж, не организация** (⚠ `owner@t-alta` и `owner@t-lotos` делят `pages.owner`).
- Литерал ключей страниц (`:2836`, 14.10): `modules, users, fleet, pool, review, today, cars, tenants, planned, forms, tasks, service, home, calendar, knowledge, data, files, spa, cash, repair, repairCatalog, repairSupply, requests, accounts, plans, billing, usage, branding`. Ключи `chat` и `docs` в литерал не внесены, но выставляются тем же `pg[page] = true` (`:2838`). Производный `pg.repairAny = repair ‖ repairCatalog ‖ repairSupply` (`:2840`). `pg.planned = true` при `page.startsWith('plan:') ‖ page === 'day'`.
- `PAGE_MOD` (`:2302`, 14.10): `chat, calendar, knowledge, docs, data, files, cash, tasks, service, forms, spa, repair` (значение = ключ модуля) и `repairCatalog → repair`, `repairSupply → repair` — страницы, доступ к которым проверяется по `M.can(db, mid, mod, 'view')`. Было (03.10): `calendar, knowledge, data, files, cash, tasks, forms, spa, repair`.
- Страница рендерится только если `!gate.show` (`:2837`).

### 8.2 Переходы

| Метод | Строки | Эффект |
|---|---|---|
| `setPage(page)` | 2452–2455 | `pages[persona] = page`; `modal:null, notif:false, profile:false`; при `page === 'repair'` ещё `rpTab:'overview', rpObj:null` (14.10: сброс открытого объекта); `#ox-main.scrollTop = 0` |
| `go(page, patch)` из «Главной» | 4047 | 14.10: `pages[persona] = page` и одновременно поля «открыть запись»: `revSel`, `svcSel`, `taskSel`, `docSel`, `chatSel`, `cashOpen`, `rpObj` + `rpTab`, `usersTab` (§23) |
| `onNav` встроенных модулей | 2862, 2869, 2872, 2878 | 14.10: `setPage(k)` + поле записи (`docSel`, `rpObj`/`rpTab`, `usersTab`, `revSel`); `leads` → `taskLegacy:true` (легаси-канбан «Заявки») (§24) |
| `go(p, page)` | 2448–2451 | `pages[p] = page`; `guide:false, modal:null`; если `p !== persona` → `setPersona(p)` (без `@` → остаётся в текущей организации, если персонаж там есть, иначе `t-alta`) |
| `closeModal()` | 2456 | `modal:null` |
| Прямые `setState({pages:…})` | 2561, 2564, 2724, 4019, 3949, 4118 | страницы водителя `today`, владельца `users`/`billing` |

Навигационные кнопки вызывают `setPage(it.id)` (`:3024`, `:3028`); «Ещё» — `setState({modal:{kind:'sheet'}})` (`:3030`).

### 8.3 Какие страницы у кого (по `navForBase`, начальный сид 14.10)

Снято с эталона 15.10.2026 (Playwright, 1440, `design-stage-1`); бейджи — на старте сида.

| Персонаж | Стартовая | Доступные из меню (ключи) |
|---|---|---|
| operator | `tenants` | `tenants, usage, requests [1], accounts, plans` |
| owner (t-alta) | `home` | `home; modules, users, billing, branding; spa; chat [5], tasks, service [4], forms, calendar, knowledge, docs [2], data, files, cash [4]`. «Логистика» и «Ремонт и стройка» в сиде не подключались → пунктов нет (D-23). После подключения «Логистики» — группа `fleet, pool, review`; после отключения — один пункт `fleet` «Логистика» в «Отключены · только чтение» |
| manager | `home` | `home; fleet (заглушка до подключения) → fleet, pool, review; chat, tasks [1], service [1], knowledge, docs` (без роли логиста — по ролям проекта и групп, см. 02 §6.6 и PD-53) |
| driver | `today` | `today, cars, cash «Подотчёт», chat [6], knowledge, docs` |
| therapist | `spa` | `spa «Мой день», chat [2], calendar, knowledge, cash [2]` |
| foreman | `repair` | `repair «Объекты»; cash «Подотчёт», chat [2], tasks, knowledge, docs [1]` |
| owner@t-lotos | `home` | `home; modules, users, billing, branding; spa; chat, tasks, service, forms, calendar, knowledge, docs, data, files, cash` |
| therapist@t-lotos | `spa` | `spa, chat [2], calendar, knowledge` |

## 9. Навигация

### 9.1 Построение — `navForBase(db, persona, mid)` (`:2950–3003`)

Вспомогательные:
- `reviewCount = trips.filter(status ∈ {submitted, defect_review}).length`.
- `logItems()`: если `!(M.moduleOn(db,'logistics') ‖ db.modules.logistics?.history)` → `[]`; иначе на «как если бы модуль включён» (`asIf`): `can(view)` → `{id:'fleet', label:'Рабочее место логиста', icon:'local_shipping'}`; `can(edit)` → `{id:'pool', label:'Ресурсный пул', icon:'person_search'}`; `can(review)` → `{id:'review', label:'Приёмка смен', icon:'fact_check', badge:reviewCount}`.
- `CORE_ITEMS` (`:2964`, 14.10 — 10 пунктов в этом порядке): `chat` «Чаты» `forum`; `tasks` «Задачи» `task_alt`; `service` «Обращения» `support_agent`; `forms` «Формы и опросы» `dynamic_form`; `calendar` «Календарь» `calendar_month`; `knowledge` «База знаний» `menu_book`; `docs` «Документы» `description`; `data` «Данные» `table_view`; `files` «Файлы» `folder_open`; `cash` «Касса» `account_balance_wallet`. `core(ids, extra)` оставляет только те, где `M.can(db, mid, k, 'view').ok`, и ставит бейдж `extra[k]`.
- Бейджи (`:2965–2970`): `chatN` = Σ `chats.items[].my.unread` (0 → без бейджа); `docWait` = Σ длин `docs.items[].my.wait`; `cashN` = `db.cash.badge`; `svcBadge` = обращения не в `resolved/closed` с запущенным SLA первого ответа (`sla.first && !sla.first.stopped`).
- `cashSelf` (`:2968`): пункт `cash` «Подотчёт» `account_balance_wallet` [cashN], если касса не скрыта и у участника есть свой подотчётный счёт (`accounts[].kind === 'advance' && member === mid`).
- Состояние модуля для владельца (`:2977`): `st(k) = moduleOn(k) ? 'on' : modules[k].history ? 'ro' : 'off'` — правило D-23.

| Персонаж | Группы (title → items: id «label» icon [badge]) |
|---|---|
| operator | «Платформа» → `tenants` «Организации» `domain`; `usage` «Использование» `monitoring`; `requests` «Заявки на тариф» `move_up` [число `platform.requests` со `status:'pending'`; в сиде 1 — `SR-12`]; `accounts` «Пользователи» `badge`; `plans` «Тарифная сетка» `sell` (без изменений) |
| owner | «Обзор» → `home` «Главная» `home`; «Компания» → `modules` «Модули и место» `extension`, `users` «Пользователи и роли» `group`, `billing` «Подписка и места» `workspace_premium`, `branding` «Оформление» `palette`; «Логистика» → `logItems()` — **только при `on`**; «Ремонт и стройка» (только при `on`) → `repair` «Объекты» `home_work` [`repTodo` = отметки «На проверке» + объекты без прораба (не сданные, не черновики) + допработы `proposed`], `repairSupply` «Снабжение» `warehouse` [`rpChild.hub.pending`], `repairCatalog` «Шаблоны и расценки» `library_books`; «Отрасли» (только при `on`) → `spa` «Салон и SPA» `spa` [`spa.issues` `open`]; «Общие модули» → `core([chat, tasks, service, forms, calendar, knowledge, docs, data, files, cash], {chat, service, docs, cash})`; «Отключены · только чтение» (внизу, только если непуста) → по одному пункту на модуль в состоянии `ro`: `fleet` «Логистика» `local_shipping` (если `logItems()` непуст), `repair` «Ремонт и стройка» `construction`, `spa` «Салон и SPA» `spa`. Модуль в состоянии `off` в меню не попадает (D-23) |
| manager | «Обзор» → `home` «Главная»; «Логистика» → `logItems()` или, если пусто, заглушка `fleet` «Рабочее место логиста» `local_shipping` (D-23: меню сотрудника не меняется, на странице — AccessGate); «Общие модули» → `core([chat, tasks, service, forms, calendar, knowledge, docs, data, files, cash], {chat, tasks: openTasks, service, docs, cash})`, где `openTasks = tasks.filter(assignee==='Марина Котова' && status==='Новая').length`; группа опускается, если пуста |
| driver | «Работа» → `today` «Сегодня» `today`; `cars` «Автомобили» `local_shipping`; `cashSelf` «Подотчёт»; `core([chat, knowledge, docs], {chat, docs})` |
| therapist | «Работа» → `spa` «Мой день» `spa`; `core([chat, calendar, knowledge, cash], {chat, cash})` |
| foreman | «Ремонт и стройка» → `repair` «Объекты» `home_work` (захардкожен, D-23); «Общие модули» → `cashSelf` «Подотчёт» + `core([chat, tasks, knowledge, docs], {chat, docs})`; пустые группы отбрасываются |

Контракт `AppShell` 14.10 (`components.md:37`) фиксирует то же правило: «Отраслевая группа меню владельца есть только у подключённого модуля; отключённый с историей — один пункт в последней группе «Отключены · только чтение»; не подключавшийся — отсутствует (D-23)».

Было (03.10): «Ремонт и стройка → Объекты» и «Отрасли → Салон и SPA» у владельца показывались всегда, а за ними — AccessGate; «Общие модули» — 7 пунктов без чатов, обращений и документов; у водителя `today, cars, knowledge`, у массажиста `spa, calendar, knowledge`, у прораба `repair; tasks, knowledge`. Проверено на эталоне 15.10.2026: «Подключить» и затем «Отключить» «Логистику» у владельца → группа «Логистика» исчезает, внизу появляется «Отключены · только чтение» → «Логистика»; страница открывается для чтения с баннером «Модуль «Логистика» отключён.».

`plan(ids)` (`:2952`) создаёт пункты `{id:'plan:'+id, label:PLAN_LABEL[id], icon:PLAN_ICON[id], planned:true}` — **не вызывается** ни в одной ветке. `PLAN_LABEL` (`:2336`): `calendar` «Календарь», `tasks` «Задачи», `knowledge` «База знаний», `forms` «Формы и опросы», `data` «Данные», `files` «Файлы», `cash` «Касса», `spa` «Салон и SPA», `repair` «Ремонт и стройка»; `PLAN_ICON` (`:2337`): `calendar_month, task_alt, menu_book, dynamic_form, table_view, folder_open, account_balance_wallet, spa, construction`.

### 9.2 Переопределение оформлением — `navFor` / `brandNav` (`:2923–2948`)

- `navFor`: для `operator` — базовое меню; иначе `brandNav(base, db.platform.tenants[0]?.brand)`.
- `brandNav(g, b)`: `items = b.items ‖ {}`, `order = b.order ‖ []`, `terms = b.terms ‖ {}`.
  - Фильтр: пункт остаётся, если `BR_LOCK.includes(id) ‖ !items[id]?.hidden`. `BR_LOCK = ['home','modules','users','billing','branding']` (`:2323`; `docs/18-branding.md:59`).
  - Подпись: `(items[id]?.label ‖ '').trim() ‖ derived(it)`, где `derived`: `review` + `terms.shift` → `'Приёмка ' + termOf('shift').many`; `cars` + `terms.vehicle` → `capF(termOf('vehicle').plural)`; `repair` + `terms.object` → `capF(termOf('object').plural)`; иначе исходная.
  - Иконка: `items[id]?.icon ‖ it.icon`.
  - Порядок: `rank = order.indexOf(id)`; не найденные — `1000 + индекс` (после переупорядоченных, в исходном порядке); сортировка внутри группы; пустые группы удаляются.
- `termOf(b, key)` (`:2927`): `BR_TERMS` (`:2309–2315`) с перекрытием из `b.terms[key]`. Каталог: `shift` «Смена» (смена/смены/смены/смен), `vehicle` «Машина» (машина/машины/машины/машин), `trip` «Рейс», `visit` «Визит», `object` «Объект».
- `BR_ICONS` (`:2316–2322`) — допустимые иконки по пунктам (используется редактором оформления, домен «Компания»).

### 9.3 Элементы меню — `shellVM.mk` (`:3022–3026`)

Для каждого пункта: `current: active ? 'page' : undefined`, `bg: active ? 'var(--ox-accent-soft)' : 'transparent'`, `fg: active ? 'var(--ox-accent)' : '#3A4844'`, `weight: active ? '600' : '400'`, `hasBadge: !!badge`, `badge: String(badge ‖ '')`, `planned`, `onClick: () => setPage(id)`. `active = page === it.id`.

### 9.4 Боковая панель (`:149–170`)

- `nav[aria-label="Основная навигация"]`: `flex:none; width:{{sideW}}; flex column; gap:2px; padding:10px 8px; bg #F8F9F6; border-right:1px solid #DCE2D9; overflow-y:auto`.
- Заголовок группы (только `showLabels`): `padding:14px 10px 6px; font-size:11px; weight 600; letter-spacing:.06em; uppercase; color #6B7873`, текст `{{g.title}}`.
- В режиме `rail` вместо заголовка — разделитель `height:1px; bg #DCE2D9; margin:8px 6px`.
- Кнопка пункта: `aria-current={{it.current}}`, `title={{it.label}}`, `position:relative; flex; align-items:center; justify-content:{{navJustify}}; gap:10px; width:100%; min-height:40px; padding:0 10px; border:0; radius 8px; bg {{it.bg}}; color {{it.fg}}; weight {{it.weight}}; text-align:left`, `style-hover="background:#EBEFE9"` (рантайм делает класс `.scpN:hover{background:#EBEFE9 !important}`, `support.js:1567–1589`).
  - Иконка `{{it.icon}}` 20px.
  - `showLabels` → `<span>` с подписью (`flex:1; ellipsis`).
  - `rail` → визуально скрытая подпись (`position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0)`).
  - `it.planned && showLabels` → бейдж «план»: `font-size:11px; padding:0 6px; radius 4px; border:1px solid #CDD5CB; color #5C6964`.
  - `it.hasBadge` → счётчик: `min-width:20px; height:20px; padding:0 6px; radius 99px; bg var(--ox-accent); color #FFFFFF; 12px/600; display:grid; place-items:center`.
- Подвал (только `showLabels`): `margin-top:auto; padding:14px 10px 6px; font-size:12px; color #5C6964`, иконка `shield` 16px `var(--ox-accent)` + `{{sideNote}}`: оператор — «Без доступа к данным клиентов», иначе «Данные других организаций изолированы» (`:2820`).

### 9.5 Нижняя навигация (`:2165–2174`, `:3027–3030`)

- Показывается при `mobile`. `nav[aria-label="Навигация"]`: `flex:none; display:flex; border-top:1px solid #DCE2D9; bg #FFFFFF`.
- `bottomItems` = первые **3** пункта из плоского списка всех групп без `planned` + «Ещё». Сокращения подписей: «Рабочее место логиста» → «Логист», «Пользователи и роли» → «Люди», «Модули и место» → «Модули», «Ресурсный пул» → «Пул», «Приёмка смен» → «Приёмка».
- Кнопка: `aria-current`, `flex:1; flex column; align-items:center; gap:2px; min-height:60px; border:0; bg transparent; color {{b.fg}}; font-size:12px; weight {{b.weight}}`; иконка 24px с `font-variation-settings:'FILL' {{b.fill}}`; бейдж `absolute; top:6px; left:calc(50% + 6px); min-width:17px; height:17px; padding:0 4px; radius 99px; bg accent; 11px/600`.
- Активный: `fg var(--ox-accent)`, `weight '600'`, `fill 1`; неактивный: `fg #4C5955`, `weight '500'`, `fill 0`.
- «Ещё»: `icon:'menu'`, `fg` = accent, если открыт лист (`modal.kind === 'sheet'`), иначе `#4C5955`; `onClick → setState({modal:{kind:'sheet'}})`.
- Примеры (снято с эталона 14.10 на 390): owner → «Главная», «Модули», «Люди», «Ещё»; driver → «Сегодня», «Автомобили», «Подотчёт», «Ещё»; manager (до роли логиста) → «Главная», «Логист», «Чаты», «Ещё»; therapist → «Мой день», «Чаты» [2], «Календарь», «Ещё»; foreman → «Объекты», «Подотчёт», «Чаты» [2], «Ещё»; operator → «Организации», «Использование», «Заявки на тариф» [1], «Ещё».

### 9.6 Лист «Все разделы» — `mSheet` (`:2274–2282`, `:4038`)

- Внутри модального контейнера (на телефоне — снизу, `radius 16px 16px 0 0`): `padding:16px 12px 20px; gap:4px`.
- Заголовок `h2#dlg-title` «Все разделы» (17px/600) + кнопка `aria-label="Закрыть"` 44×44, radius 10, иконка `close` 22px → `onCloseModal`.
- Для каждой группы: заголовок (`padding:10px 10px 4px; 11px/600; uppercase; letter-spacing:.06em; color #6B7873`) и кнопки пунктов: `aria-current`, `min-height:48px; padding:0 12px; radius 10px; gap:12px; bg {{it.bg}}; color {{it.fg}}; weight {{it.weight}}`, иконка 22px, подпись `flex:1`, бейдж «план» (если `planned`), счётчик (если `hasBadge`). Клик → `setPage(id)` (закрывает модалку).

## 10. Шапка `<header>` (`:94–146`, `:3005–3051`)

### 10.1 Контейнер и цвета

`flex:none; position:relative; z-index:20; flex; align-items:center; gap:12px; min-height:58px; padding:8px 14px; background:{{top.bg}}; color:{{top.fg}}; border-bottom:1px solid {{top.line}}`.

| Поле `top.*` | Оператор | Остальные |
|---|---|---|
| `bg` | `#1C2A26` | `#FFFFFF` |
| `fg` | `#F2F5F1` | `#1C2A26` |
| `muted` | `#A9B8B1` | `#5C6964` |
| `line` | `#1C2A26` | `#DCE2D9` |
| `sep` | `#3A4844` | `#DCE2D9` |
| `sub` | «управление платформой» | «пространство бизнеса» |
| `tenant` | «Управление платформой» | `tenant.name` («Альта Групп» / «SPA «Лотос»») |
| `hasBell` | `false` | `true` |
| `initials` | «ОП» | `M.initials(me.name)` (первые буквы двух слов, верхний регистр: «ДЗ», «МК», «ИВ», «АМ», «АС», «ИБ») |

### 10.2 Элементы слева направо

1. **Блок бренда** (`flex; gap:10px`):
   - `top.hasLogo` → `<span role="img" aria-label="{{top.tenant}}">` `height:32px; width:160px; background:center/contain no-repeat url({{top.logo}})`.
   - иначе `top.hasMark` → знак `32×32; radius 9px; background:center/cover url({{top.mark}})` (`aria-hidden`).
   - иначе буква: `32×32; radius 9px; bg var(--ox-accent); color #FFFFFF; weight 600; 21px; line-height 1; padding-bottom 3px`, текст `{{top.letter}}` = первая буква короткого имени в верхнем регистре или «о».
   - при `notMobile` и без логотипа: колонка `line-height:1.15` — `{{top.brandName}}` (17px/600, `letter-spacing:-0.01em`) = короткое имя или «ортус»; `{{top.sub}}` (11px, `muted`).
2. **Организация и область** (`flex:1; min-width:0; gap:10px; padding-left:12px; border-left:1px solid {{top.sep}}`): иконка `domain` 20px `muted`; колонка: `{{top.tenant}}` (`weight 600; nowrap; ellipsis`), ниже при `top.scopeStatic` — `{{top.scope}}` (12px, `muted`, ellipsis). При `top.scopeSelect` (владелец) — `<select aria-label="Область просмотра">`: `max-width:240px; min-height:36px; padding:0 8px; radius 8px; border:1px solid #CDD5CB; bg #FFFFFF; 13px`, `value={{top.scopeValue}}` (= `state.ownerScope`, стартово `'all'`), `onChange → setState({ownerScope})`.
   - Опции владельца (`:3016–3017`): `{value:'all', label:'Все подразделения'}`, затем на каждый регион `{value:r.id, label: r.name + ' · весь регион'}` и на каждую его фирму `{value:f.id, label: r.name + ' / ' + f.name}`. «Альта Групп»: 1 + 3 региона («Москва», «Самара», «Санкт-Петербург») + 12 фирм = 16 опций; «Лотос»: «Все подразделения», «Москва · весь регион», «Москва / Лотос · Тверская», «Москва / Лотос · Арбат».
   - Текст области по персонажам (`:3011–3015`): operator «Отдельный вход · без доступа к данным клиентов»; driver «Москва / Север Логистик · мои назначения»; therapist «Салон и SPA · мой календарь»; foreman «Назначенные объекты»; manager — `M.scopeLabel(db, grant.scope)` первого назначения с `actions.logistics`, иначе «Область не назначена». `scopeLabel` (`models.js:258–275`): «Вся организация» / «Регион {name}» / «{Регион} / {Фирма}» / «Только назначенное лично».
   - `ownerScope` читают также `fleetVM` (`:3251`) и `homeVM` (`:4124`) — другие домены.
3. **Пилюля «Нет связи»** (`top.offline = !online`): `role="status"`, `inline-flex; gap:4px; padding:3px 8px; radius 999px; bg #FAF1DC; color #7A5214; 12px/500; nowrap`, иконка `cloud_off` 16px, текст «Нет связи».
4. **Колокольчик** (`top.hasBell`): `<button aria-label="{{top.bellLabel}}" aria-expanded="{{top.bellExpanded}}">` `40×40; radius 10px; border 0; bg transparent; color inherit`, `style-hover="background:#ECEFEA"`; иконка `notifications` 22px; при `top.hasCount` бейдж `absolute; top:5px; right:5px; min-width:17px; height:17px; padding:0 4px; radius 99px; bg var(--ox-accent); color #FFFFFF; 11px/600` с `{{top.bellCount}}`. `bellLabel = 'Уведомления' + (unread ? ': ' + n + ' новых' : '')`. `onBell → setState({notif:!notif, profile:false, guide:false})`.
5. **Профиль**: `<button aria-label="Профиль" aria-expanded="{{top.profileExpanded}}">` `36×36; radius 50%; border 0; bg var(--ox-accent-soft); color var(--ox-accent); 13px/600`, текст `{{top.initials}}`. `onProfile → setState({profile:!profile, notif:false, guide:false})`.

### 10.3 Поповер «Уведомления» (`:124–135`, `:3018–3020`, `:3044`)

- `role="dialog" aria-label="Уведомления"`, `absolute; top:calc(100% + 6px); right:12px; width:min(380px, calc(100% - 24px)); max-height:420px; overflow-y:auto; bg #FFFFFF; color #1C2A26; border:1px solid #DCE2D9; radius 12px; shadow 0 16px 40px rgba(28,42,38,.18)`.
- Шапка (`padding:12px 14px; border-bottom:1px solid #E8ECE5`): `<strong>` «Уведомления»; кнопка «Прочитать все» (`min-height:32px; color var(--ox-accent); 13px/500`) → `seen[persona] = events.map(id)`.
- Пусто (`notif.empty = !events.length`): «Новых событий нет» (`padding:28px 16px; center; color #5C6964; 13px`).
- Элемент (первые 12 событий, `events.slice(0,12)`): `flex; gap:10px; padding:10px 14px; border-bottom:1px solid #F0F2EE`; точка `8×8; margin-top:6px; radius 50%; bg {{n.dot}}` (непрочитано — `var(--ox-accent)`, прочитано — `transparent`); текст 13px `{{n.text}}`; время 12px `#5C6964` `{{n.at}}` (формат `HH:MM`, `api.js:18`).
- Данные: `db.events` после фильтра `view()` (`api.js:195`): только адресованные участнику (`e.to.includes(actor)`) и не `sensitive` без права на начисления. У оператора `events = []`. В сиде обеих организаций `events: []` → при старте «Новых событий нет». Примеры текстов событий (`api.js`): «Подключён модуль «Логистика»» (владельцам, `:150`), «Отключён модуль «Логистика». История сохранена.», «Вам назначена роль «Менеджер логистики» · Москва / Север Логистик» (`:281`), «Илья Васильев забронировал ГАЗель Next А 412 МР 77 на рейс Р-208» (проверяющим, `:317`), «Смена Р-208 принята. Машина свободна.» (`:400`), «Лимит места изменён на 50 ГБ» (`:152`), «Пробный период завершён. Новые операции ограничены, данные сохранены.» (`:127`).
- Непрочитанные считаются по `state.seen[persona]` (список id) — хранится по персонажу, не по организации.

### 10.4 Поповер «Профиль» (`:136–145`, `:3046–3048`)

- `role="dialog" aria-label="Профиль"`, `width:min(340px, calc(100% - 24px)); padding:16px; gap:10px`, остальные стили как у уведомлений.
- `{{profile.name}}` (15px/600), `{{profile.title}}` (13px, `#5C6964`).
- Секция (`border-top:1px solid #E8ECE5; padding-top:10px`): заголовок `{{profile.linesTitle}}` (12px/600, uppercase, `letter-spacing:.05em`, `#5C6964`), строки `{{l}}` 13px.
- Кнопка `disabled` «Выйти · недоступно в демо» (иконка `logout` 18px; `min-height:40px; padding:0 12px; radius 8px; border:1px solid #CDD5CB; bg #FFFFFF`).

| Персонаж | `name` | `title` | `linesTitle` | `lines` |
|---|---|---|---|---|
| operator | «Е. Лаптева» | «Оператор платформы» | «Права» | «Организации, подписки, пробные периоды, квоты»; «Нет доступа к бизнес-данным клиентов» |
| прочие | `me.name` | `me.title + ' · ' + me.email` | «Назначения» | `roleObj.name + ' · ' + scopeLabel + (via ? ' · через ' + via : '')` или «Ролей нет — доступ к модулям не выдан» |

Стартовые значения (сид `mock-data.js:153–188`, `42–73`): owner «Дарья Зимина» / «Владелец · d.zimina@alta.example» / «Владелец бизнеса · Вся организация»; manager «Марина Котова» / «Логист · m.kotova@alta.example» / «Ролей нет — доступ к модулям не выдан»; driver «Илья Васильев» / «Водитель · i.vasiliev@alta.example» / «Водитель · Москва / Север Логистик · через группа «Водители Север»»; therapist «Анна Морозова» / «Массажист · a.morozova@alta.example» / «Массажист · Только назначенное лично»; foreman «Алексей Соколов» / «Прораб · a.sokolov@alta.example» / «Прораб · Только назначенное лично»; owner@t-lotos «Ирина Белова» / «Владелец · owner@lotos-spa.example» / «Владелец бизнеса · Вся организация»; therapist@t-lotos «Анна Морозова» / «Массажист · Тверская · a.morozova@alta.example» / «Массажист · Только назначенное лично».

## 11. Баннеры — `bannersVM` (`:174–180`, `:3083–3098`)

Разметка каждого: `div[role={{b.role}}]` `flex-wrap; gap:8px 12px; align-items:center; padding:12px 14px; radius 10px; bg {{b.bg}}; color {{b.fg}}; border:1px solid {{b.line}}`; иконка 20px; `<strong>{{b.title}}</strong> <span>{{b.text}}</span>` (`flex:1 1 240px`); при `hasAction` кнопка `{{b.action}}` (`min-height:36px; padding:0 12px; radius 8px; border:1px solid currentColor; bg transparent; color inherit; weight 500`). `role = tone === 'danger' ? 'alert' : 'status'`. Цвета из `TONE`/`LINE` (`:2303–2304`): ok `#E3EFE7/#1F6B52/#BFD9C8`, info `#E7EEF6/#2B5479/#C9D8E8`, warn `#FAF1DC/#7A5214/#EBD7A8`, danger `#FBEAE7/#A13A33/#F0C9C3`, neutral `#ECEFEA/#4C5955/#DCE2D9`.

Оператор — баннеров нет. Порядок и условия (в порядке вывода):

| # | Условие | tone / icon | `title` | `text` | Действие |
|---|---|---|---|---|---|
| 1 | `tenant.status ∈ {restricted, suspended}` | warn / `lock_clock` | «Пробный период завершён.» | «Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.» | owner: «Демо: продлить как оператор» → `go('operator','tenants')` |
| 2 | 14.10: `roMod` = `logistics` для `page ∈ {fleet, pool, review, today, cars}`, иначе отраслевой модуль страницы из `PAGE_MOD` (`spa`, `repair` — в т. ч. `repairCatalog`, `repairSupply`); баннер при `!moduleOn(roMod) && modules[roMod].history` (`:3089–3091`) | neutral / `history` | «Модуль «{INDUSTRY.name}» отключён.» | `RO_TEXT` (`:3090`): `logistics` — «Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.»; `spa` — «Новые записи, визиты и списания закрыты; история доступна для чтения. Подключить снова можно в «Модули и место».»; `repair` — «Новые отметки, сметы, допработы и закупки закрыты; история объектов доступна для чтения. Подключить снова можно в «Модули и место».» | — |
| 3 | `!online` | warn / `cloud_off` | «Нет связи.» | «Черновики, фото и расходы сохраняются на устройстве» + (`outbox.length ? ' (ожидают отправки: N)' : ''`) + «. Бронь, выезд и приёмка требуют подтверждения сервера.» | — |
| 4 | `online && outbox.some(state==='sending')` | info / `sync` | «Связь восстановлена.» | «Отправляем сохранённые на устройстве операции…» | — |
| 5 | `tenant.usedGb >= tenant.quotaGb` | danger / `storage` (`role=alert`) | «Место организации заполнено.» | owner: «Новые загрузки заблокированы, файлы не удалены. Освободите место или увеличьте лимит.»; прочие: «Новые загрузки ограничены. Фото текущей смены сохраняются в пределах временного резерва.» | owner и `page !== 'modules'`: «Открыть «Модули и место»» → `setPage('modules')` |

Как вызвать в демо: (1) владелец → «Модули и место» → «Демо: завершить пробный период» → подтвердить (`:2710–2722`; `api.setTenantStatus('t-alta','restricted')`); (2) подключить «Логистику», затем «Отключить» с подтверждением (`api.setModule(key,false)` ставит `history:true`, `api.js:286`), открыть `fleet/review` или переключиться на водителя; (3) флажок «Нет связи»; (4) офлайн добавить расход/сдать машину → включить связь (баннер виден, пока `flush()` отправляет); (5) владелец → «Лимит места» → выбрать значение ниже занятого 46,2 ГБ → подтвердить с галочкой «Понимаю: новые загрузки будут недоступны» → «Всё равно применить» (`:2684–2709`).

## 12. AccessGate — `gateVM` (`:195–203`, `:3053–3081`)

Разметка: карточка `bg #FFFFFF; border:1px solid #DCE2D9; radius 12px; padding:40px 24px; flex column; align-items:center; text-align:center; gap:12px`; круг `56×56; radius 50%; bg {{gate.chip.bg}}; color {{gate.chip.fg}}` с иконкой 28px; пилюля `{{gate.chip.label}}` (`padding:2px 10px; radius 999px; 12px/600`, те же цвета); `h1` `{{gate.title}}` (20px/600, `letter-spacing:-0.01em`); `p` `{{gate.text}}` (`#5C6964; max-width:480px`); при `hasAction` кнопка `{{gate.actionLabel}}` (`min-height:44px; padding:0 18px; radius 8px; border:1px solid var(--ox-accent); bg var(--ox-accent); color #FFFFFF; weight 500`).

Без проверки (`none`): `persona === 'operator'`, `page === 'home'`, `page.startsWith('plan:')`, владелец на `modules/users/billing/branding`.

**Ветка A — страницы из `PAGE_MOD`** (14.10: `chat, calendar, knowledge, docs, data, files, cash, tasks, service, forms, spa, repair, repairCatalog, repairSupply`): `rr = M.can(db, mid, mod, 'view')`, `nm = M.ALL_MODULES[mod].name` (`Чаты`, `Календарь`, `База знаний`, `Документы`, `Данные`, `Файлы`, `Касса` — 14.10, было «Внутренняя касса», `Задачи`, `Обращения`, `Формы`, `Салон и SPA`, `Ремонт и стройка`).

| reason | chip (label / tone / icon) | title | text | action |
|---|---|---|---|---|
| `module_readonly` и право есть при принудительно включённом модуле (`:3061`, 14.10) | — (gate не показывается: страница открыта **только для чтения**, вместо гейта — баннер №2) | | | |
| `module_off`, `module_readonly` | «Модуль не подключён» / neutral / `extension_off` | «{nm}» не подключён организацией | owner: «Подключите модуль в разделе «Модули и место». Права сотрудникам выдаются отдельно.»; прочие: «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.» | owner: «Открыть «Модули и место»»; прочие: «Демо: открыть как владелец» → `go('owner','modules')` |
| `no_permission` | «Нет права» / warn / `lock` | «Нет доступа к разделу «{nm}»» | «Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.» | нет |

**Ветка B — остальные страницы** (`fleet, pool, review, today, cars`): `mod = therapist ? 'spa' : foreman ? 'repair' : 'logistics'`; `verb = review→'review', pool→'edit', иначе 'view'`; `name = M.INDUSTRY[mod].name`; `asIf` — та же проверка при принудительно включённом модуле.

| reason | chip | title | text | action |
|---|---|---|---|---|
| `module_readonly` и `asIf.ok` | — (gate не показывается; вместо него баннер №2) | | | |
| `module_off` / `module_readonly` | «Модуль не подключён» или «Модуль отключён» / neutral / `extension_off` | «{name}» не подключена организацией | owner: «Подключите модуль в разделе «Модули и место», затем назначьте роли сотрудникам.»; прочие: «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.» | owner: «Открыть «Модули и место»»; прочие: «Демо: открыть как владелец» → `go('owner','modules')` |
| `no_permission` / `no_scope` | «Нет права» / warn / `lock` | review: «Нет права на приёмку смен»; иначе «Нет роли с доступом к модулю «{name}»» | «Модуль подключён, но ни одна ваша роль не разрешает это действие» + (review ? « («Проверять»)» : «») + «. Владелец бизнеса может назначить роль и область.» | «Демо: открыть как владелец» → `go('owner','users')` |

Стартовые срабатывания в сиде: driver на `today` и `cars` → «Логистика» не подключена организацией (действие «Демо: открыть как владелец»); foreman на `repair` → «Ремонт и стройка» не подключён организацией; manager на `fleet` → «Логистика» не подключена организацией; после подключения «Логистики», но до назначения роли manager на `fleet` → «Нет роли с доступом к модулю «Логистика»»; на `review` → «Нет права на приёмку смен». 14.10: срабатывание «owner на `repair`» из меню недостижимо — неподключённого «Ремонта» у владельца в меню нет (D-23); остаётся только прямой переход. Отключённый модуль с историей у владельца открывается для чтения (гейта нет, баннер №2) — проверено на эталоне для «Логистики».

Режим «только чтение» в реализации (W1.20): гейт пропускает, страница получает признак `readOnly`, команды создания скрыты или заблокированы самой страницей; сервер отвечает на изменяющие команды кодом `module_read_only` (`docs/12-errors-and-events.md`).

`M.can` (`models.js:286–295`): модуль выключен → `module_readonly` (если `history`) или `module_off`; нет гранта с действием → `no_permission`; объект вне области → `no_scope`. Для core-модулей `moduleOn` всегда `true` (`:169`).

## 13. Тосты (`:2287–2291`, `:2414–2418`, `:2885–2891`, `:2419–2434`)

- Один тост: `div[role={{toast.role}}] aria-live="polite"`, `absolute; left:50%; bottom:{{toastBottom}}; transform:translateX(-50%); z-index:60; max-width:calc(100% - 24px); width:max-content; flex; gap:8px; padding:10px 14px; radius 10px; bg #1C2A26; color #FFFFFF; shadow 0 8px 24px rgba(0,0,0,.22); 14px`; иконка 20px `color {{toast.ic}}`; текст.
- Тона: `ok` → `check_circle` `#8FD3AE`; `warn` → `cloud_off` `#F0C76E`; `error` → `error` `#F2A99E`; `info` → `info` `#A9C8EA`. `role = tone === 'error' ? 'alert' : 'status'`.
- `toast(text, tone='ok')`: сбрасывает предыдущий таймер, показывает, скрывает через **4200 мс**.
- `run(key, fn, okText, {quiet})`: `busy = key`; успех → `db = r.db`, `busy = null`, тост `okText` (ok); ошибка → `busy = null`, `db = e.db` (если код не в `quiet`), тост `e.message ‖ 'Ошибка'` с тоном `warn` при `code === 'offline'`, иначе `error` (если код не в `quiet`); исключение пробрасывается.
- Тосты уровня оболочки: «Нет связи. Черновики сохраняются на устройстве» (warn, `setOnline(false)`, `:2463`); «Список обновлён» (ok, `refresh`, `:2571`); «{label} — принято сервером» (ok, `flush`, `:2545`); «{label}: {message}» (error, `flush`, `:2548`). Ошибка сети от API: «Нет связи с сервером. Операция не выполнена.» (`api.js:167`, тон warn).
- Контракт (`components.md:34`): успех — только после ответа сервера; тост не используется для ошибок полей.

## 14. Модальная система (`:2176–2285`, `:3964–4040`)

### 14.1 Контейнер

- Бэкдроп: `div onClick={{onBackdrop}}` `absolute; inset:0; z-index:50; bg rgba(28,42,38,.42); flex; align-items:{{modalAlign}}; justify-content:center; padding:{{modalPad}}`; закрывает только при клике по самому бэкдропу (`e.target === e.currentTarget`).
- Диалог: `role="dialog" aria-modal="true" aria-labelledby="dlg-title"`, `width:100%; max-width:{{modalMax}} (560px; assign — 620px); max-height:100%; overflow-y:auto; bg #FFFFFF; radius {{modalRadius}}; shadow 0 20px 50px rgba(28,42,38,.25); flex column`.
- `state.modal = { kind, ...поля }`; `patchModal(patch)` (`:2727`) сливает поля; `busy = !!state.busy` блокирует кнопки действий.
- Общие кнопки: «Отмена» — `min-height:44px; padding:0 16px; radius 8px; border:1px solid #CDD5CB; bg #FFFFFF; weight 500` → `onCloseModal`; главная — `min-height:44px; padding:0 18px; radius 8px; border:1px solid var(--ox-accent); bg var(--ox-accent); color #FFFFFF; weight 500`.
- Поля форм: `<label>` колонка `gap:6px; 13px/500; color #3A4844`; `input/select` `width:100%; min-height:44px; padding:8px 12px; border:1px solid #CDD5CB (1.5px у валидируемых); radius 8px; bg #FFFFFF; font-size:16px`.
- Фокус-ловушки и возврата фокуса в прототипе нет — ⚠ `components.md:32` требует.

### 14.2 `confirm` — `mConfirm` / `mc` (`:2179–2201`, `:3969–3977`, `:2643`)

Вход: `confirm({tone, icon, title, text, sections:[{title, items:[{icon, tone, text}]}], needAck, ackLabel, confirmLabel, onConfirm})`; `ack:false` по умолчанию.

| Элемент | Правило |
|---|---|
| Круг-иконка | `42×42; radius 50%; bg/fg по TONE[tone]` (`tone ‖ 'info'`), иконка `m.icon ‖ 'help'` 22px |
| `h2#dlg-title` | `{{mc.title}}` 18px/600; `p` `{{mc.text}}` `#5C6964` |
| Секции | контейнер `max-height:max(140px, calc(100vh - 392px)); overflow-y:auto`; заголовок секции 12px/600 uppercase `#5C6964`; пункты 14px с иконкой 18px цвета `TONE[it.tone].fg` |
| Подтверждение | при `needAck`: `<label>` `min-height:48px; padding:0 12px; radius 10px; border:1px solid #DCE2D9; bg #F8F9F6` с чекбоксом 20×20 (`accent-color var(--ox-accent)`) и `{{mc.ackLabel}}` |
| Кнопки | «Отмена»; главная `{{mc.confirmLabel}}` (при `busy` — «Выполняем…»), `disabled = busy ‖ (needAck && !ack)`, `bg/border = tone==='danger' ? '#A13A33' : 'var(--ox-accent)'` |

Экземпляры (все тексты verbatim в указанных строках): подключить модуль (`:2648–2661`: «Подключить «{name}»?», секции «Что появится» / «Зависимости» / «Важно», кнопка «Подключить»); отключить модуль (`:2668–2682`: «Отключить «{name}»?», «Данные не удаляются. Модуль перейдёт в режим чтения истории.», секции «Затронет сейчас» / «Что произойдёт», `needAck` «Понимаю последствия для текущей работы», кнопка «Отключить модуль», tone danger); лимит ниже занятого (`:2690–2705`: «Новый лимит меньше занятого места», ack «Понимаю: новые загрузки будут недоступны», кнопка «Всё равно применить»); лимит (`:2707`: «Изменить лимит на {gb} ГБ?», «Изменить»); окончание trial (`:2711–2721`: «Смоделировать окончание пробного периода?», «Обычно это происходит по сроку или по решению оператора платформы.», секция «Что произойдёт», кнопка «Завершить пробный период», tone warn, icon `lock_clock`, тост «Пробный период завершён (демо)»); завершить рейс (`:2590–2594`); принять смену (`:2766–2775`); действия оператора `opConfirm` (`:2796–2798`: icon `admin_panel_settings`, секция «Последствия», тост «Готово · запись добавлена в журнал»).

### 14.3 `assign` — `mAssign` / `ma` (`:2203–2225`, `:3978–4005`, `:2723–2737`)

Открытие: `openAssign(memberId, roleId, toUsers)` → `modal = {kind:'assign', memberId, roleId:roleId‖'', type:'firm', region:'r-msk', firm:'f-msk-sever', account:'', until:'', err:null}` (14.10: поле `account`); при `toUsers` ещё `pages.owner='users', usersTab='people'`.

14.10 — область «Касса» (подробно 02 §6.9): четвёртая кнопка «Касса» появляется, только если в роли есть `actions.cash` и роль не `all` (`:3997`); при выборе — `<select>` «Касса» (`:2214`) со счетами `kind ≠ 'advance'`, по умолчанию первый такой счёт (`:3990`); регион и фирма скрыты; `scope = { type: 'account', id }` (`:2730`, `:3981`); факт «Только касса «{name}»: другие кассы по этой роли не видны» (`:3986`). Область «проект» (`{type:'project'}`) в этом диалоге не выдаётся — проектные роли назначаются в модуле «Задачи и проекты» (вкладка «Участники»), а `scopeLabel` их только подписывает (`models.js:263–272`).

| Элемент | Verbatim / привязка |
|---|---|
| `h2#dlg-title` | «Назначить роль»; подзаголовок `{{ma.member}}` = `name · (title ‖ email)` |
| «Текущие назначения» (при `hasExisting`) | строки `{{a.text}}` (как в профиле) + кнопка «Снять» (`color #A13A33`) → `removeAssign(g.id)` → `api.unassign`, тост «Назначение снято» |
| `<select>` «Роль» | опция `""` «Выберите роль» + роли `kind !== 'system'`; `onRole → patchModal({roleId, err:null})` |
| `<fieldset>` «Область действия» | `aria-pressed` кнопки «Вся организация» (`tenant`), «Регион» (`region`), «Фирма» (`firm`) и (14.10, если в роли есть `actions.cash`) «Касса» (`account`): `flex:1 1 120px; min-height:44px; radius 8px; border:1.5px solid`; активная — `border var(--ox-accent); bg var(--ox-accent-tint); color var(--ox-accent)`, иначе `#CDD5CB / #FFFFFF / #1C2A26` |
| «Регион» (`type ∉ {tenant, account}`) | `<select>` регионов; `onRegion` → `{region, firm: firmsOf(region)[0].id}` |
| «Касса» (`type === 'account'`, 14.10) | `<select>` касс `db.cash.accounts` с `kind ≠ 'advance'` |
| «Фирма» (`type === 'firm'`) | `<select>` фирм региона |
| «Действует до» | `<input type="date">`, подпись «Необязательно» |
| Блок «Итог назначения» | `bg #F8F9F6; border #E8ECE5; radius 10; padding 14`; `{{ma.summary}}` = `(role.name ‖ 'Роль не выбрана') + ' · ' + scopeLabel`; факты `{{ma.facts}}` |
| Факты | без роли: `info` «Выберите роль, чтобы увидеть итоговые права»; с ролью: `extension` «Отраслевые модули: …» / «Только общие модули ядра» (`#2B5479`); `location_on` «Только касса «{name}»: другие кассы по этой роли не видны» (14.10, `account`) / «Данные всех регионов и фирм организации» / «Все фирмы региона {name}; другие регионы скрыты» / «Только {Регион / Фирма}; соседние фирмы скрыты»; конфликт (`member.function==='driver' && role.finance.read`) → `block` `#A13A33` «Конфликт: функция «Водитель» несовместима с правом на начисления — сервер отклонит назначение»; иначе `lock_open` `#7A5214` «Начисления водителям — видны в этой области» или `lock` `#5C6964` «Начисления недоступны» |
| Ошибка (`hasErr`) | `role="alert"`, `bg #FBEAE7; color #A13A33; 13px`, иконка `error` |
| Кнопки | «Отмена», «Назначить» (`disabled={{ma.busy}}`) → `saveAssign` |

`saveAssign` (`:2728–2736`): без роли → `err:'Выберите роль'`; иначе `run('assign', api.assign({memberId, roleId, scope, until}), 'Роль «{name}» назначена', {quiet:['role_conflict','validation']})`; ошибка → `err = e.message` (сервер: «Функция «Водитель» несовместима с правом на начисления (правило MVP).», «У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено.», `api.js:417–418`); успех → закрыть, `mark('assigned')` при условии.

### 14.4 `invite` — `mInvite` / `mi` (`:2227–2246`, `:4006–4021`, `:2738–2746`)

Открытие (`:3162`, `:3949`, `:4118`): `{kind:'invite', name:'', email:'', roleId:'', scope:'f-msk-sever', errs:{}, tried:false, err:null}`.

| Элемент | Verbatim / правило |
|---|---|
| `h2#dlg-title` | «Пригласить участника»; подпись «Письмо в демо не отправляется: рассылки не подключены.» |
| «Имя и фамилия» | `<input autocomplete="off" aria-invalid>`; граница `#A13A33` при ошибке; ошибка `role="alert"` «Укажите имя» |
| «Электронная почта» | `<input type="email" placeholder="name@company.ru">`; ошибки «Укажите адрес» / «Адрес выглядит неверно: проверьте «@» и домен» |
| «Роль» | `<select>`: `""` «Без роли — назначить позже» + роли `kind !== 'system'` |
| «Область» | `<select disabled={{mi.noRole}}>`: «Вся организация» (`tenant`), затем регионы «{name} · весь регион» и фирмы «{Регион} / {Фирма}» |
| Места (`seatsOk`) | иконка `event_seat`, `{{mi.seatsText}}` + «. Приглашение занимает место сразу, до принятия.»; `seatsText` = «Мест без ограничения» / «Свободно мест: {left} из {lim}» + (`left===1` ? « — это последнее» : «»); цвет `#7A5214` при `left===1`, иначе `#3A4844` |
| Места (`seatsFull`) | `role="alert"` `bg #FBEAE7; border #F0C9C3; color #A13A33`: иконка `no_accounts`, «**Все места тарифа заняты.** Чтобы пригласить сотрудника, отзовите неактуальное приглашение, заблокируйте бывшего сотрудника или запросите тариф больше. Рабочего без входа можно вести карточкой бесплатно.»; кнопка «Подписка и места» (иконка `workspace_premium`, `border #A13A33; color #A13A33`) → `modal:null, pages[persona]='billing'` |
| Ошибка сервера | `role="alert"` `{{mi.err}}` |
| Кнопки | «Отмена», «Пригласить» (`disabled = busy ‖ full`) |

Валидация клиента (`:2740–2742`) показывается после первой попытки (`tried`). Сервер (`api.js:294–298`): «Укажите имя», «Проверьте адрес электронной почты», «Участник с таким адресом уже есть», «Свободных мест нет: занято N из M. Отзовите приглашение или запросите расширение тарифа.». Успех: тост «Приглашение создано · письмо в демо не отправляется». В сиде «Альта»: `seatsLimit 10, seatsUsed 9` → «Свободно мест: 1 из 10 — это последнее»; «Лотос»: `25/23` → «Свободно мест: 2 из 25».

### 14.5 `createRole` — `mRole` / `mr` (`:2248–2262`, `:4022–4034`, `:2747–2753`)

Открытие (`:3162`): `{kind:'createRole', name:'', mode:'empty', templateId:'r-manager', copyId:'r-manager', err:null}`.

- `h2#dlg-title` «Создать роль»; поле «Название» (`placeholder="Например: Менеджер Север"`), ошибка «Укажите название роли».
- `div[role=radiogroup aria-label="Основа роли"]` — три карточки (`padding:12px 14px; radius 10px; border:1.5px solid`; активная `border var(--ox-accent); bg #F7FAF8`, иначе `#DCE2D9 / #FFFFFF`) с `<input type=radio name="role-mode">`:
  1. «Пустая роль» — «Ноль бизнес-разрешений. Включайте модули и действия вручную.»
  2. «Из шаблона» — «Готовый набор действий отрасли. Его можно изменить.»; при выборе `<select aria-label="Из шаблона">` ролей `kind==='template'`.
  3. «Скопировать существующую» — «Копия текущих прав роли организации.»; `<select aria-label="Скопировать существующую">` ролей `kind!=='system'`.
- Кнопки «Отмена», «Создать и настроить» (`disabled={{mr.busy}}`) → `run('crole', api.createRole({name, mode, sourceId}), 'Роль создана')` → `modal:null, roleSel:r.data, roleDraft:null, usersTab:'roles'`.

### 14.6 `request` — `mRequest` / `mq` (`:2264–2272`, `:4035–4037`, `:2791–2795`)

Открытие `openRequest(d, trip)`: `{kind:'request', driverId, code, home, tripId, tripLabel: id · title · window, comment:''}`.

- `h2#dlg-title` «Запросить водителя»; подпись `{{mq.driver}}` = `code · home` (например «Водитель #104 · Юг Транс»).
- `<dl>`: «Рейс» `{{mq.trip}}`; «Срок» «Временно, до 18:00 01.10»; «Согласует» «Менеджер фирмы {home}».
- `<textarea rows=2 placeholder="Необязательно">` «Комментарий для фирмы-владельца».
- Инфо-блок (`bg #F8F9F6`, иконка `info`): «После одобрения создаётся временное назначение только на этот рейс. История и начисления водителя остаются в его фирме.»
- Кнопки «Отмена», «Отправить запрос» → тост «Запрос отправлен фирме {home} · уведомления в демо не отправляются»; ошибка сервера «Запрос уже отправлен» (`api.js:544`).

### 14.7 `sheet` — см. §9.6.

## 15. Страница «план» — `pg.planned` / `pn` (`:2125–2160`, `:3953–3962`, `roadmap.js`)

- Достижима только при `pages[persona]` = `'plan:<key>'` или `'day'`; в текущем снимке таких переходов нет (⚠). `key = page === 'day' ? (therapist ? 'spa' : 'repair') : page.slice(5)`; данные — `ROADMAP[key]` (`calendar, tasks, knowledge, forms, data, files, cash, spa, repair`).
- Разметка: подпись «Карта экранов · следующая итерация» (13px `#5C6964`); иконка `{{pn.icon}}` в квадрате 40×40 `bg var(--ox-accent-soft)`; `h1#h-plan` `{{pn.title}}` (26px/600; для `day` — «Мой день · {title}»); пилюля `{{pn.stage}}` (`bg #E7EEF6; color #2B5479`); `p` `{{pn.purpose}}`.
- `pn.isWorkplace` (только `day`): инфо-блок «Рабочее место откроется на общем каркасе «Мой день»: ближайшая работа, главное действие, чек-лист, фото и отправка на проверку — те же компоненты, что у водителя. Начисления и чужие доходы не показываются.»
- `pn.hasFlow` (только `forms`): карточка «Пример: осмотр машины → ответ формы → осмотр → задача менеджеру», шаги «Шаг N» со стрелками `arrow_forward`, подпись `flowNote`.
- Две колонки: «Экраны» (нумерованные кружки 24px) и «Компоненты» (`<code>` IBM Plex Mono 12px, `bg #F2F3EF`), «Правила» (иконка `rule`), «Контракты API» (моно 12px `#3A4844`, подпись «По ortus-openapi-v0.1.yaml»).
- Содержимое (`roadmap.js:3–132`): `calendar` «Умный календарь» / `calendar_month` / «P0 · итерация 2»; `tasks` «Задачи и проекты» / `task_alt` / «P0 · итерация 2»; `knowledge` «База знаний» / `menu_book` / «P0 минимум»; `forms` «Формы и опросы» / `dynamic_form` / «P0 · итерация 2» (+ `flow` из 4 шагов и `flowNote` «Публикация v4 не меняет старые ответы: они остаются связаны с v3 и показываются по её структуре.»); `data` «Данные» / `table_view` / «P0 минимум»; `files` «Файлы» / `folder_open` / «P0»; `cash` «Внутренняя касса» / `account_balance_wallet` / «P0 минимум»; `spa` «Салон и SPA» / `spa` / «P1»; `repair` «Ремонт и стройка» / `construction` / «P2».

## 16. Онлайн/офлайн, флаги, клавиатура

### 16.1 `setOnline(on)` (`:2458–2464`, `:2385–2388`)

- Источники: чекбокс «Нет связи» (`onOffline → setOnline(!checked)`) и события `window.online/offline` (`setOnline(navigator.onLine)`).
- Если `!api` или значение не изменилось — выход. Иначе `api.setFlag('online', on)`, `setState({online:on})`; при `on` → через 60 мс `flush()`; при `!on` → тост «Нет связи. Черновики сохраняются на устройстве» (warn).
- Эффекты в оболочке: пилюля «Нет связи» в шапке (`top.offline`), баннер №3; при восстановлении — баннер №4 на время отправки `outbox` и тосты «{label} — принято сервером».
- mock-API при `!online` бросает `ApiError('offline', 'Нет связи с сервером. Операция не выполнена.')` на всех командах с `needsNet` (`api.js:167`, `227–232`) и на `upload` — «Нет связи. Фото сохранено на устройстве и будет отправлено позже.» (`:971`).

### 16.2 Клавиатура (`:2380–2386`)

`keydown` на `window`: `Escape` → если `modal` — `modal:null`; иначе если открыт `notif`/`profile`/`guide` — закрыть все три. Других сочетаний нет. Все кнопки — `<button type="button">`, фокус-кольцо через `:focus-visible`.

### 16.3 Поповеры и взаимное исключение

`onGuide`, `onBell`, `onProfile` открывают один и закрывают два других (`:2814`, `:3040–3041`); `setPage` закрывает `notif`/`profile` и модалку; `setPersona` закрывает всё. Клик вне поповера их **не** закрывает (нет обработчика; ⚠).

## 17. Оформление организации и различия SPA «Лотос»

### 17.1 `applyBrand` / `brandVars` (`:2324–2330`, `:2928–2933`; `docs/18-branding.md:38–45`)

- `brandVars(hex)`: `a = fixAccent(hex валиден ? hex : '#1F6B52')`; `fixAccent` затемняет шагами `mixHex(c,'#000000',0.04)` до контраста с белым ≥ 4.5:1 (макс. 60 шагов); `hover = mixHex(a,'#000000',0.18)`, `soft = mixHex(a,'#FFFFFF',0.86)`, `tint = mixHex(a,'#FFFFFF',0.93)`.
- `applyBrand(b)` ставит `--ox-accent`, `--ox-accent-hover`, `--ox-accent-soft`, `--ox-accent-tint` на `document.documentElement.style`; кэш по `accent` (`_brandKey`). Вызывается из `shellVM` при каждом рендере: оператор → `null` → стандарт `#1F6B52`.
- Вычисленные значения (по формуле, не литералы): для `#1F6B52` → hover `#195843`, soft `#E0EAE7`, tint `#EFF5F3` (⚠ отличаются от `:root`-литералов `#185A44/#E3EFE7/#F1F7F3` и `tokens.css`); для `#7A3E79` (контраст ≈ 7,5:1, без коррекции) → hover `#643363`, soft `#ECE4EC`, tint `#F6F1F6`.
- Цвета статусов `TONE`/`LINE` от бренда не зависят (`18-branding.md:33`, `:108`).
- `BR_PALETTE` (`:2308`): «Ортус» `#1F6B52`, «Морской» `#0F6C74`, «Синий» `#2B5479`, «Индиго» `#4338A0`, «Сливовый» `#7A3E79`, «Терракота» `#9A4A1F`, «Олива» `#5A6420`, «Графит» `#3D4A55`.

### 17.2 Данные бренда (`mock-data.js:10–19`)

`BRAND_DEFAULT = {short:'', accent:'#1F6B52', logo:null, mark:null, terms:{}, items:{}, order:[], poweredBy:true, version:1, updatedAt:null, updatedBy:null}` + `name: tenant.name`. Переопределения: `t-alta {short:''}`; `t-lotos {short:'Лотос', accent:'#7A3E79', terms:{visit:{one:'сеанс', plural:'сеансы', few:'сеанса', many:'сеансов'}}, version:3, updatedAt:'24.09 12:10', updatedBy:'Ирина Белова'}`; `t-remstroy {short:'Ремстрой', accent:'#9A4A1F'}`; `t-cargo {short:'Карго', accent:'#2B5479', poweredBy:false, version:2, …}`.

### 17.3 Что отличается у «Лотоса» в оболочке

| Аспект | «Альта Групп» (`t-alta`) | SPA «Лотос» (`t-lotos`) |
|---|---|---|
| Персонажи | operator, owner, manager, driver, therapist, foreman | operator (тот же), owner (Ирина Белова), therapist (Анна Морозова) |
| Шапка: имя/буква/акцент | «ортус» / «о» / `#1F6B52` | «Лотос» / «Л» / `#7A3E79` |
| `top.tenant` | «Альта Групп» | «SPA «Лотос»» |
| Опции области владельца | 16 | 4 (см. §10.2) |
| Меню владельца | + группа «Логистика» после подключения | «Логистика» отсутствует (модуль выключен, истории нет); остальные группы те же; термин `visit` на меню не влияет |
| Подразделения | 3 региона × 4 фирмы | регион «Москва», фирмы «Лотос · Тверская», «Лотос · Арбат» |
| Статус тенанта | `trial` (12 дней, до 13.10.2026), места 9/10, 46,2/100 ГБ | `active` (до 31.03.2027), места 23/25, 12,4/50 ГБ |
| Роли | r-owner, r-manager, r-driver, r-therapist, r-foreman | r-owner, r-therapist, r-admin «Администратор салона» |
| Модалки `assign`/`invite` | значения по умолчанию `r-msk` / `f-msk-sever` существуют | ⚠ `firm:'f-msk-sever'` и `scope:'f-msk-sever'` отсутствуют в `units` «Лотоса» (`<select>` без совпадающей опции; `unitLabel` → «—») |
| События/уведомления | свои `db.events` | свои (сид пуст) |

Изоляция (`18-branding.md:85–103`): смена оформления в одной организации не видна в другой; у оператора — стандартные цвета, но знаки организаций в их цветах (экраны «Организации», «Пользователи» — другой домен).

## 18. Данные, которые читает оболочка

| Сущность | Поля | Где используется |
|---|---|---|
| `db.platform.tenants[0]` (после `view()` — только текущая организация) | `id, name, status (trial/active/restricted/suspended), trialEnds, trialDaysLeft, quotaGb, usedGb, seatsLimit, seatsUsed, brand{short, accent, logo, mark, terms, items, order}` | шапка, баннеры 1 и 5, `brandNav`, `applyBrand`, модалка `invite` |
| `db.platform.requests` (оператор: все; иначе свои) | `status` | бейдж «Заявки на тариф» |
| `db.members` | `id, name, email, title, status, function` | профиль, инициалы, модалка `assign` |
| `db.assignments` + `db.roles` (`M.grants`) | `role, scope{type,id}, via, roleObj{name, all, actions, finance, kind}` | профиль, область менеджера, `can`, «Текущие назначения» |
| `db.units` | `id, type (region/firm), parent, name` | опции области, `scopeLabel`, модалки |
| `db.modules` | `{logistics, spa, repair}: {enabled, history}` | `moduleOn`, состояние `on/ro/off` (D-23), `logItems`, баннер 2, AccessGate |
| `db.trips` | `status` | бейдж «Приёмка смен», отключение модуля (список активных) |
| `db.tasks` | `assignee, status` | бейдж «Задачи» у менеджера |
| `db.spa.issues` | `status` | бейдж «Салон и SPA» |
| `db.repair.logs`, `db.repair.objects`, `db.repair.changes`, `state.rpChild.hub` (14.10) | `status`; `foreman, stage, draft`; `status`; `pending` | бейджи «Объекты» (`repTodo`) и «Снабжение» |
| `db.chats.items[].my` (14.10) | `unread`, `ackWait` | бейдж «Чаты», источник «Главной» |
| `db.docs.items[].my.wait` (14.10) | `kind` (`sign/approve/ack/returned/mention/ocr`) | бейдж «Документы», источник «Главной» |
| `db.service.requests`, `db.service.directions` (14.10) | `status, sla.first, assignee, kind, dir` | бейдж «Обращения», источник «Главной» (через `this.SV`) |
| `db.cash` (14.10) | `hidden, badge, todo[], accounts[]{kind, member}` | бейдж «Касса», пункт «Подотчёт», источник «Главной», select «Касса» в «Назначить роль» |
| `db.events` | `id, at, text, to, sensitive` | уведомления |
| `state.outbox[]` | `{opId, kind, label, state: local/sending/error, payload}` | баннеры 3–4, `flush` |
| `state.prog{}` | ключи шагов | гид |
| `state.seen{persona: [ids]}` | | непрочитанные |
| `state.ownerScope` | `'all' ‖ unitId` | селектор области; `fleetVM`, `homeVM` |

Формулы: `bellCount = events.filter(e => !seen[persona].includes(e.id)).length`; `reviewCount`, `openTasks`, `issues`, `pendingLogs`, `pend` — см. §9.1; `left = max(0, seatsLimit - seatsUsed)`; `over = usedGb >= quotaGb`.

## 19. Инварианты и правила

1. Навигация — функция прав: пункт появляется только если `M.can(db, mid, mod, 'view').ok` (core) или на «как если бы включён» для логистики с модулем/историей (`:2956–2969`). Оператор видит только группу «Платформа» (`:2971–2973`).
2. Пункты `BR_LOCK` (`home, modules, users, billing, branding`) нельзя скрыть оформлением (`:2945`; `18-branding.md:59`). Скрытие — настройка удобства: права и прямые переходы сохраняются.
3. Страница рендерится только при `!gate.show`; три причины отказа различаются текстом и чипом (`README.md:11`, `components.md:11`).
4. `module_readonly` + право → страница доступна только для чтения, показывается баннер «Модуль «{название}» отключён.» (`:3061`, `:3073`, `:3089`); 14.10 — для всех страниц `PAGE_MOD` и логистики. Начатые смены можно завершить (`api.js:176–182`).
5. Операторская оболочка: тёмная шапка `#1C2A26`, без колокольчика, без баннеров, без AccessGate, подпись «Без доступа к данным клиентов», `view()` отдаёт только `platform` (`api.js:186`).
6. Уведомления — только адресованные участнику, без `sensitive` для тех, кому не разрешены начисления (`api.js:195`); у водителя начислений нет нигде (`README.md:13`, проверка 5 гида).
7. Тост успеха — только после ответа сервера (`run` ставит тост после `await fn()`); офлайн-операции сообщают «сохранено на устройстве», не «отправлено» (`components.md:53`).
8. Флаги «Конфликт брони» и «Сбой загрузки фото» одноразовые: API и UI сбрасывают их после срабатывания (`api.js:451, 467, 975`; `:2488, 2564, 2789`).
9. `Escape` закрывает сначала модалку, затем поповеры/гид; клик по бэкдропу закрывает модалку только при попадании в сам бэкдроп (`:2380–2384`, `:3966`).
10. Брейкпоинты считаются по ширине фрейма, а не `window` (`:2804`); при `frame=390` на широком окне приложение обязано показать мобильную раскладку.
11. Акцент применяется CSS-переменными; компоненты не содержат литералов акцента, статусные цвета фиксированы (`18-branding.md:43, 108`).
12. Нижняя навигация: ровно первые 3 непланируемых пункта + «Ещё» (`:3028–3030`); лист «Ещё» показывает все группы.
13. Статус = иконка + текст (+ цвет) — для баннеров, чипов, бейджей (`README.md:41`).
14. Цели нажатия: кнопки действий 44 px, пункты листа 48 px, нижняя навигация 60 px, иконки шапки 40/36 px (`README.md:44`, `tokens.css:41`).
15. `pages` и `seen` хранятся по персонажу, не по организации (`:2344–2346`) — при переключении `owner@t-alta ↔ owner@t-lotos` страница сохраняется.
16. `reset()` пересоздаёт адаптер и данные, но сохраняет `w` и `frame` (`:2411`).
17. `go(p, page)` из «Лотоса» на персонажа, которого там нет (`manager`, `driver`, `foreman`), переключает организацию на `t-alta` (`:2440`).
18. Боковой рейл сохраняет подписи для скринридера (визуально скрытый `<span>`) и `title` на кнопке (`:155–158`).

## 20. Чек-лист приёмки (Playwright)

Селекторы: `getByRole('region', {name:'Панель демонстрации'})`, `getByLabel('Персонаж')`, `getByLabel('Ширина')`, `getByRole('button', {name:'Путь проверки'})`, `getByRole('dialog', {name:'Путь проверки'})`, `getByRole('navigation', {name:'Основная навигация'})`, `getByRole('navigation', {name:'Навигация'})`, `getByRole('button', {name:/^Уведомления/})`, `getByRole('button', {name:'Профиль'})`, `getByLabel('Область просмотра')`, `getByRole('status')`, `getByRole('alert')`, `getByRole('dialog', {name:'Уведомления'})`, `getByRole('dialog', {name:'Профиль'})`, `locator('[role=dialog][aria-modal=true]')`, `#ox-main`, `locator('[aria-current=page]')`.

1. **Загрузка.** Given страница открыта по HTTP; When рендер; Then виден `role=status` `aria-label="Загрузка"` с текстом «Загружаем рабочее пространство…», затем он исчезает; `<title>` = «Ортус — CRM, прототип итерации 1».
2. **Стартовый персонаж.** Given загрузка завершена; Then `getByLabel('Персонаж')` имеет значение `owner`; в шапке видны «ортус», «пространство бизнеса», «Альта Групп»; `aria-current=page` у пункта «Главная».
3. **Селектор персонажа.** Then у `select` три `optgroup` с подписями «Платформа», «Альта Групп», «SPA «Лотос»» и опциями из §5 (verbatim); значения `operator, owner, manager, driver, therapist, foreman, owner@t-lotos, therapist@t-lotos`.
4. **Ширина 1440.** Given `getByLabel('Ширина')` = `1440`; Then фрейм имеет `width: 1440px`, `border-radius: 12px`; боковая навигация шириной 244 px с заголовками групп («Обзор», «Компания», «Отрасли», «Общие модули»; 14.10 — «Ремонт и стройка» только у подключённого модуля) и подписью «Данные других организаций изолированы»; нижней навигации нет.
5. **Ширина 768.** Given `768`; Then боковая навигация шириной 68 px, заголовков групп нет, кнопки имеют `title` с подписью и видимой иконкой; `nav[aria-label="Навигация"]` отсутствует.
6. **Ширина 390.** Given `390`; Then фрейм `width: 390px`, `border-radius: 22px`; боковой навигации нет; `nav[aria-label="Навигация"]` содержит 4 кнопки: «Главная», «Модули», «Люди», «Ещё»; в шапке нет текста «ортус» (блок `notMobile` скрыт).
7. **Лист «Ещё».** Given 390 и клик «Ещё»; Then открыт `role=dialog` с заголовком «Все разделы», кнопка «Закрыть», все группы и пункты меню; When клик по «Оформление»; Then лист закрыт, `aria-current=page` у «Оформление».
8. **Меню владельца (14.10).** Given owner, 1440; Then пункты (в порядке): «Главная»; «Модули и место», «Пользователи и роли», «Подписка и места», «Оформление»; «Салон и SPA»; «Чаты» [5], «Задачи», «Обращения» [4], «Формы и опросы», «Календарь», «База знаний», «Документы» [2], «Данные», «Файлы», «Касса» [4]. Групп «Логистика», «Ремонт и стройка» и «Отключены · только чтение» нет (модули не подключались — D-23). Бейджи — `out-of-stage` до модулей этапов 4–7.
9. **Меню после подключения «Логистики».** Given owner → «Модули и место» → «Подключить» у «Логистика» → в диалоге «Подключить «Логистика»?» кнопка «Подключить»; Then тост «Модуль «Логистика» подключён»; в меню появилась группа «Логистика» с «Рабочее место логиста», «Ресурсный пул», «Приёмка смен».
9а. **D-23: отключение с историей (14.10).** Given п. 9; When «Отключить» у «Логистика» → диалог «Отключить «Логистика»?» с пунктом «Группа модуля уйдёт из меню, останется один пункт в «Отключены · только чтение»» → отметить «Понимаю последствия для текущей работы» → «Отключить модуль»; Then группы «Логистика» нет, внизу меню группа «Отключены · только чтение» с одним пунктом «Логистика» (`local_shipping`); When клик; Then `h1` «Рабочее место логиста», AccessGate нет, баннер `role=status` «Модуль «Логистика» отключён. Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.» (снято с эталона 15.10.2026).
10. **Меню менеджера до роли (14.10).** Given manager; Then «Главная»; «Рабочее место логиста»; «Чаты», «Задачи» [1], «Обращения» [1], «База знаний», «Документы»; в шапке область «Область не назначена». Пункты общих модулей приходят от ролей с объектной областью в сиде модулей (`r-pm` на проект `fleet` — `mock-data.js:182`; `r-agent` на проект `svc-grz` — `service.js:211`; `r-kb-lead` на пространство `sp-log` — `knowledge.js:285`; `r-doc-manage` на папку `fd-log` — `documents.js:502`; `r-chat-owner` на чат и `r-chat-creator` на фирму — `chats.js:248–251`): `M.can` без объекта их учитывает. По PD-53 объектная роль не даёт пункта меню без объекта; расхождение с эталоном — в allowlist с PD-53 (02 §6.6).
11. **Меню водителя (14.10).** Given driver; Then пункты «Сегодня», «Автомобили», «Подотчёт», «Чаты» [6], «База знаний», «Документы»; `main > div` имеет `max-width: 680px`; в шапке «Москва / Север Логистик · мои назначения».
12. **Меню массажиста / прораба (14.10).** Given therapist; Then «Мой день», «Чаты» [2], «Календарь», «База знаний», «Касса» [2], область «Салон и SPA · мой календарь». Given foreman; Then «Объекты», «Подотчёт», «Чаты» [2], «Задачи», «База знаний», «Документы» [1], область «Назначенные объекты».
13. **Оператор.** Given operator; Then шапка `background-color: rgb(28, 42, 38)`, текст «управление платформой», «Управление платформой», «Отдельный вход · без доступа к данным клиентов»; кнопки «Уведомления» нет; аватар «ОП»; меню «Организации», «Использование», «Заявки на тариф» (бейдж «1»), «Пользователи», «Тарифная сетка»; подпись «Без доступа к данным клиентов»; баннеров нет.
14. **AccessGate: модуль не подключён (водитель).** Given driver в стартовом сиде; Then `h1` = «Логистика» не подключена организацией, чип «Модуль не подключён», текст «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.», кнопка «Демо: открыть как владелец»; When клик; Then персонаж `owner`, страница «Модули и место» (`h1` «Модули и место»).
15. **AccessGate: PAGE_MOD (прораб).** Given foreman; Then `h1` «Ремонт и стройка» не подключён организацией, текст «Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.».
16. **AccessGate: нет права.** Given «Логистика» подключена, manager без роли, страница «Рабочее место логиста»; Then чип «Нет права», `h1` «Нет роли с доступом к модулю «Логистика»», кнопка «Демо: открыть как владелец» ведёт на «Пользователи и роли» владельца.
17. **AccessGate: нет права на приёмку.** Given то же, `pages.manager='review'` (через гид «Логист: принять смену» → «Перейти»); Then `h1` «Нет права на приёмку смен», текст содержит «(«Проверять»)».
18. **Баннер офлайн.** Given любой персонаж кроме оператора; When включить «Нет связи»; Then тост `role=status` «Нет связи. Черновики сохраняются на устройстве»; в шапке `role=status` «Нет связи» с иконкой `cloud_off`; баннер `role=status` «Нет связи.» + «Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.»; When выключить; Then пилюля и баннер исчезают.
19. **Баннер trial.** Given owner → «Модули и место» → «Демо: завершить пробный период» → диалог «Смоделировать окончание пробного периода?» → «Завершить пробный период»; Then тост «Пробный период завершён (демо)»; баннер «Пробный период завершён.» с кнопкой «Демо: продлить как оператор»; When клик; Then персонаж `operator`, страница «Организации».
20. **Баннер места.** Given owner → «Модули и место» → «Лимит места» = опция «25 ГБ · меньше занятого» (`value="25"`, `:3133`) → «Изменить лимит» → диалог «Новый лимит меньше занятого места», кнопка «Всё равно применить» `disabled` до отметки «Понимаю: новые загрузки будут недоступны»; When отметить и подтвердить; Then тост «Лимит места: 25 ГБ»; баннер `role=alert` «Место организации заполнено.»; на странице «Главная» у баннера есть кнопка «Открыть «Модули и место»», на «Модули и место» — нет.
21. **Баннер отключённого модуля.** Given «Логистика» подключена, затем «Отключить» → диалог «Отключить «Логистика»?» с чекбоксом «Понимаю последствия для текущей работы» → «Отключить модуль»; Then тост «Модуль отключён. История доступна для чтения»; When переключиться на driver; Then баннер «Модуль «Логистика» отключён.» и страница «Сегодня» (без AccessGate, если роль есть).
22. **Уведомления.** Given owner; Then кнопка `aria-label="Уведомления"` без бейджа; When клик; Then `dialog` «Уведомления» с «Новых событий нет» и кнопкой «Прочитать все»; When подключить «Логистику»; Then кнопка `aria-label="Уведомления: 1 новых"`, бейдж «1», в списке «Подключён модуль «Логистика»» с акцентной точкой; When «Прочитать все»; Then бейдж исчезает, точка прозрачная.
23. **Профиль.** Given owner, клик «Профиль»; Then `dialog` «Профиль»: «Дарья Зимина», «Владелец · d.zimina@alta.example», «Назначения», «Владелец бизнеса · Вся организация», кнопка «Выйти · недоступно в демо» `disabled`. Given driver; Then «Водитель · Москва / Север Логистик · через группа «Водители Север»».
24. **Взаимоисключение поповеров.** Given открыт «Профиль»; When клик «Уведомления»; Then «Профиль» закрыт, «Уведомления» открыт; When `Escape`; Then оба закрыты.
25. **Escape для модалки.** Given открыт любой `aria-modal` диалог; When `Escape`; Then диалог закрыт; поповеры при этом не затрагиваются первым нажатием.
26. **Бэкдроп.** Given модалка; When клик по бэкдропу вне диалога; Then закрыта; When клик внутри диалога; Then открыта.
27. **Селектор области владельца.** Given owner; Then `getByLabel('Область просмотра')` с 16 опциями, первая «Все подразделения», есть «Москва · весь регион» и «Москва / Север Логистик»; у manager/driver вместо селектора статичный текст.
28. **Путь проверки.** When клик «Путь проверки» (`aria-expanded` становится `true`); Then `dialog` «Путь проверки» с «Основной путь», 8 шагов (тексты §6), кнопками «Перейти», разделом «Негативные проверки» с 7 строками; шаг 1 имеет кружок «1» с `background-color` = `--ox-accent-soft`; When «Перейти» у шага 3; Then персонаж `driver`, гид закрыт; при повторном открытии шаг 3 отмечен «✓» и `background-color` = акцент.
29. **Сбросить.** Given изменения (персонаж driver, флаг «Нет связи», ширина 390); When «Сбросить»; Then персонаж `owner`, флаг снят, ширина остаётся 390, прогресс гида пуст.
30. **Тост авто-скрытие.** Given тост показан; Then через ≤ 4,5 с отсутствует; у тоста `aria-live="polite"`, `background-color: rgb(28, 42, 38)`; на 390 `bottom: 76px`, на 1440 `bottom: 20px`.
31. **Лотос: оформление.** Given `owner@t-lotos`; Then шапка «Лотос», буква «Л» на фоне `rgb(122, 62, 121)`, организация «SPA «Лотос»»; `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent')` = `#7A3E79`; активный пункт меню имеет цвет акцента; селектор области — 4 опции («Все подразделения», «Москва · весь регион», «Москва / Лотос · Тверская», «Москва / Лотос · Арбат»); группы «Логистика» нет.
32. **Лотос: изоляция.** Given в «Альте» подключена «Логистика»; When `owner@t-lotos`; Then группы «Логистика» нет, уведомлений «Новых событий нет»; When обратно `owner`; Then `--ox-accent` = `#1F6B52`, «Логистика» на месте.
33. **Лотос: массажист.** Given `therapist@t-lotos`; Then меню «Мой день», «Чаты» [2], «Календарь», «База знаний» (14.10); профиль «Анна Морозова», «Массажист · Тверская · a.morozova@alta.example».
34. **Модалка «Пригласить участника».** Given owner → «Пользователи и роли» → кнопка «Пригласить» (иконка `person_add`, `:299`); Then `h2` «Пригласить участника», подпись «Письмо в демо не отправляется: рассылки не подключены.», текст «Свободно мест: 1 из 10 — это последнее. Приглашение занимает место сразу, до принятия.»; When «Пригласить» с пустыми полями; Then ошибки «Укажите имя», «Укажите адрес», `aria-invalid="true"`; When email «abc»; Then «Адрес выглядит неверно: проверьте «@» и домен»; When корректные данные; Then тост «Приглашение создано · письмо в демо не отправляется»; повторное открытие — `alert` «Все места тарифа заняты.» и кнопка «Подписка и места» ведёт на страницу «Подписка и места».
35. **Модалка «Назначить роль».** Given owner → «Модули и место» → после подключения «Логистики» кнопка «Назначить роли»; Then открыт «Назначить роль» для «Марина Котова · Логист», роль «Менеджер логистики» выбрана, кнопки «Вся организация»/«Регион»/«Фирма» (`aria-pressed="true"` у «Фирма»), «Итог назначения» = «Менеджер логистики · Москва / Север Логистик»; When «Назначить»; Then тост «Роль «Менеджер логистики» назначена»; у manager появляются «Ресурсный пул», «Приёмка смен»; «Общие модули» дополняются пунктами по действиям роли (14.10: «Задачи» с бейджем «1» уже были до роли — п. 10).
36. **Модалка «Создать роль».** Given owner → «Пользователи и роли» → вкладка ролей → кнопка «Создать роль» (иконка `add`, `:337`); Then `radiogroup` «Основа роли» с «Пустая роль», «Из шаблона», «Скопировать существующую»; «Создать и настроить» с пустым названием → «Укажите название роли».
37. **Мобильная модалка.** Given 390 и открытый `confirm`; Then диалог прижат к низу (`align-items: flex-end`), `border-radius: 16px 16px 0px 0px`.
38. **Фокус-кольцо.** When `Tab` на кнопку; Then `outline: 2px solid` цвета акцента.

## 21. Открытые вопросы

1. **Страницы «план» недостижимы.** `plan()` объявлен (`:2952`), но не используется; бейдж «план» и `pg.planned` в снимке мёртвый код. Реализовывать ли их (например, для неподключённых модулей) или удалить? ⚠ не найдено в источниках.
2. **Литералы акцента vs формула.** `:root` (`:17`) и `tokens.css:13–15` задают `#185A44/#E3EFE7/#F1F7F3`, а `brandVars('#1F6B52')` даёт `#195843/#E0EAE7/#EFF5F3`. Что считать эталоном для визуальной сверки?
3. **Фокус-ловушка и возврат фокуса** в диалогах требуются `components.md:32`, но в прототипе отсутствуют; клик вне поповеров их не закрывает.
4. **Skip-link «К содержимому»** и landmarks требует `components.md:37`; в прототипе skip-link нет.
5. **`pages`/`seen` по персонажу, а не по организации** — при переключении `owner@t-alta → owner@t-lotos` страница и список прочитанных сохраняются; задумано или артефакт?
6. **Дефолты модалок для «Лотоса»** (`firm:'f-msk-sever'`, `scope:'f-msk-sever'`) не существуют в его `units` — вероятная ошибка прототипа.
7. **PERSONAS vs шаблон**: `PERSONAS` (`:2300`) содержит «Владелец бизнеса · Дарья Зимина», шаблон — «Владелец · Дарья Зимина»; `personaOptions` не используется. Источник истины — шаблон.
8. **Оператор «в организации Лотос»**: при выборе оператора из «Лотоса» `org` остаётся `t-lotos`, но `view()` для `actor === null` отдаёт полный `platform`; при возврате к персонажу без `@` берётся текущая `org`. Семантика «оператор внутри организации» не определена.
9. **Коды ошибок**: прототип использует `module_off/module_readonly/no_permission/no_scope/offline/conflict/validation`, реестр `12-errors-and-events.md` — `module_not_installed/module_read_only/forbidden_action/not_found/…`. Нужен маппинг на уровне адаптера.
10. **Статусы тенанта**: прототип `trial/active/restricted/suspended`, ТЗ (PLAT-02) — `provisioning/trial/active/grace/read_only/suspended/closing/closed` (`docs/README.md:56`). Баннер «Пробный период завершён.» показывается и для `suspended`.
11. **Тёмная тема сотрудника** (`18-branding.md:65–67`) в прототипе не реализована — нужна ли в объёме «точно как нарисовано»?
12. **Поведение «Нет связи» через `navigator.onLine`** и чекбокс используют один `setOnline`; реальное событие `online` может «снять» галочку демо — приемлемо?
13. `hint-placeholder-*` атрибуты — только для стримингового рендера рантайма; в React-реализации игнорируются.

## 22. Факты для плана

0. **14.10.** Меню строится из прав и состояния модуля (`on/ro/off`, D-23); «Общие модули» — 10 пунктов и 4 бейджа от модулей этапов 4–7 (до них — `out-of-stage`). AccessGate пропускает отключённый модуль с историей в режим чтения. «Главная · Требует решения» — 9+ источников: реализуется реестром провайдеров (§23, план v2 §3.5). Восемь страниц — встроенные модули с общим контрактом хоста (§24): оболочка должна реализовать хост до модулей.
1. Оболочка — один компонент с ~28 ключами страниц (14.10) и 6 видами модалок; VM оболочки занимает `:2801–3098` + `:3953–4040` (~360 строк логики).
2. Все пороги: `mobile < 640`, `rail 640–1079`, `sidebar ≥ 1080`; проверочные ширины 390/768/1440 (фрейм, не окно).
3. Персонажей 8 (6 в «Альте», 2 в «Лотосе», оператор общий); участник оператора — `null` (`api.setActor(null, org)`).
4. Навигация строится из `M.can` (`models.js:286`) + `brandNav`; реализация должна быть чистой функцией `(db, persona, memberId) → groups` — удобно покрыть unit-тестами до UI (TDD).
5. `gateVM` и `bannersVM` — чистые функции от `(db, persona, memberId, page, state)`; тексты — таблицы §11–12.
6. Mock-адаптер (`ortus/api.js`, 14.10 — 1045 строк, плюс `service.js`, `knowledge.js`, `documents.js`, `chats.js`, `cash.js`) переносится по модулям (план v2, W0.12 и потоки P1x); оболочка зависит от `setActor`, `setFlag`, `load`, `setModule`, `setTenantStatus`, `setStorageQuota`, `assign/unassign`, `invite`, `createRole`, `requestDriver`, `upload`.
7. Тосты и `run()` — единственная точка обработки ошибок API; тон `warn` для `offline`, `error` для прочих; `quiet` список подавляет тост и `db`-патч.
8. Акцент бренда — 4 CSS-переменные на `:root`; производные считаются формулой `brandVars` (контраст WCAG, шаг 4 %).
9. Статусные цвета фиксированы: `TONE`/`LINE` (`:2303–2304`), в `tokens.css` границы отличаются (`#B9D6C4` vs `#BFD9C8` и т.д.) — ⚠ решить, какой набор эталон.
10. `Escape` — единственная глобальная клавиша; `window.online/offline` — единственные внешние события; `ResizeObserver` — на фрейме.
11. Уведомления — срез `db.events` (макс. 12), непрочитанность хранится в UI (`seen`), «Прочитать все» не ходит в API.
12. Счётчики меню: `review` (смены `submitted/defect_review`), `tasks` менеджера (задачи «Марина Котова» со статусом «Новая» — ⚠ по имени, не по id), `spa` (`issues.open`), `repair` (14.10: отметки «На проверке» + объекты без прораба + допработы `proposed`), `repairSupply` (`rpChild.hub.pending`), `requests` оператора (`pending`); 14.10 — `chat` (Σ `unread`), `service` (SLA первого ответа идёт), `docs` (Σ `my.wait`), `cash` (`db.cash.badge`).
13. Гид «Путь проверки» — 8 шагов и 7 негативных проверок — готовый сценарий для e2e (основной путь = пункты 9, 35, затем домены водителя/логиста).
14. Второй тенант «Лотос» даёт тест изоляции оформления и данных (BR-T1…BR-T3, `18-branding.md:103`).
15. Страницы «план» и `roadmap.js` можно вынести из первой волны (недостижимы), но `ROADMAP` используется также страницей документации — проверить домен docs.
16. Размеры целей: 44 px (кнопки), 48 px (лист), 60 px (нижняя навигация), 40/36 px (шапка), 32 px (демо-панель, компакт).
17. Фон фрейма `#F2F3EF`, холст `#E6E9E3`, демо-панель `#22302C`, шапка оператора `#1C2A26`, боковая панель `#F8F9F6`, линии `#DCE2D9`, контролы `#CDD5CB`, разделители `#E8ECE5`.
18. Шрифты и иконки — Google Fonts; по PD-21 — локальные файлы (OFL), иконки Material Symbols Rounded с осью `FILL` (нижняя навигация использует `FILL 1` для активного пункта).
19. Клик-вне для поповеров и фокус-ловушка — расхождение прототипа с контрактом `components.md`; нужно решение «как нарисовано» vs «как в контракте».
20. Нет `localStorage`: всё состояние в памяти; «Сбросить» = пересоздание адаптера.

## 23. «Главная»: реестр источников «Требует решения» (14.10)

Шаблон «Главной» не менялся (`:1708–1779` в нумерации 03.10, домен 05), изменился `homeVM` (`:4043–4119`): очередь «Требует решения» собирают **девять групп источников** из разных модулей. Каждый источник добавляет карточку `add(tone, icon, label, title, text, action, onClick)` (`:4052`); затем очередь сортируется по тону `danger → warn → info → neutral` (`:4094–4095`) и показывается не больше 8 карточек («показано 8 из N»). На эталоне 14.10 у владельца «Требует решения: 12» (было 4).

| # | Источник (модуль) | Условие | tone · icon · чип | Заголовок → действие → переход | Строки | Этап плана v2 |
|---|---|---|---|---|---|---|
| 1 | Логистика | рейс `defect_review` | danger · `report` · «Блокирует выезд» | «Критический дефект · рейс {id}» → «Решить» → `review` + `revSel` | `:4053` | 2 (W2.09, W2.25) |
| 2 | Логистика | смена `submitted` | warn · `fact_check` · «Приёмка» | «Смена {id} ждёт приёмки» → «Проверить» → `review` + `revSel` | `:4054` | 2 |
| 3 | Логистика | модуль включён, право `edit`, рейс `planned` без водителя | info · `person_search` · «Сегодня {время}» / «Ждёт другой фирмы» | «Рейс {id} без водителя» → «Найти в пуле» / «Открыть пул» → `pool` | `:4055–4058` | 2 |
| 4 | Салон и SPA (владелец) | `spa.issues` `open` | warn · `inventory` · «SPA · склад» | «Учёт материалов не завершён» → «Решить» → `spa` | `:4060` | 5 |
| 5 | Ремонт и стройка (владелец, только при `moduleOn('repair')`) | объект без прораба; отметка «На проверке»; допработа `proposed`; черновик без сметы | warn `person_off` «Не назначен прораб · {объект}» → «Назначить» (`assignForeman`); info `construction` «Отметка прораба {id} на приёмке» → «Принять» → `repair` + `rpObj`, `rpTab:'overview'`; warn `request_quote` «Допработа {id} ждёт оценки · {объект}» → «Оценить» → `rpTab:'estimate'`; info `request_quote` «Смета не собрана · {объект}» → «Собрать смету» | | `:4061–4067` | 6 |
| 6 | Подписка, место, доступ (владелец) | trial завершён / ≤ 14 дней; место > 85 %; активные сотрудники без роли | danger/neutral `lock_clock`/`hourglass_top` «Подписка»; warn/danger `storage` «Место»; neutral `person_off` «Доступ» | → `modules` / `users` + `usersTab:'people'` | `:4068–4072` | 1 |
| 7 | Обращения | `can('service','view')`, до 3 обращений `late`/`risk` или без исполнителя (виды `complaint/claim/cargo/warranty`); SLA через `this.SV` (`service.js`) | danger/warn · `support_agent` · «Обращение · {направление}» | «{key} · {title}» → «Открыть» → `service` + `svcSel` | `:4074–4080` | 7 |
| 8 | Задачи | `can('tasks','view')`, до 3 своих задач «Новая»/«На проверке» | danger (`urgent`)/neutral · `task_alt`/`rate_review` | «{id} · {title}» → «Открыть» → `tasks` + `taskSel` | `:4081–4084` | 4 |
| 9 | Документы | на каждое `docs.items[].my.wait`: `sign`, `approve`, `ack`, `returned`, `mention`, `ocr` | warn/info/neutral; «Документ · утвердить / согласовать / ознакомиться», «Документ на доработке», «Упоминание в документе», «Проверить распознавание» | «{title документа}» → «Открыть» → `docs` + `docSel` | `:4085–4088` | 7 |
| 10 | Чаты | на каждое `chats.items[].my.ackWait` | warn · `flag` · «Чат · подтвердить» | «{чат}: {текст}» → «Открыть» → `chat` + `chatSel` | `:4089–4092` | 7 |
| 11 | Касса | `db.cash.todo[]` как есть (`tone, icon, label, title, text, action, open`) | из данных модуля | → `cash` + `cashOpen` | `:4093` | 5 |

«Сегодня в работе» (`:4097–4113`): карточки «Логистика» (при `logOn && can view`), «Салон и SPA» и «Ремонт и стройка» у владельца (14.10 — «Объектов в работе», «На приёмке», «Ближайшая сдача»; при выключенном модуле — карточка в «Не подключено» с переходом в `modules`), «Задачи».

**Реализация (план v2 §3.5, A факт 7).** Очередь — **реестр источников**: каждый модуль регистрирует провайдер `packages/domain/src/home/sources/<module>.ts` с сигнатурой «`(ctx) → HomeItem[]`», где `HomeItem = {tone, icon, label, title, text, action, target: {page, patch}}`; общий `homeVM` только собирает, сортирует по тону и обрезает до 8. Источники 1–3 и 6 — этапы 1–2 (W2.09 backend, W2.25 frontend); источники 4, 5, 7–11 до своих этапов отмечаются в allowlist видом `out-of-stage` со сроком снятия (план v2 §3.7). Порядок внутри одного тона — порядок регистрации провайдеров, как в `homeVM` (логистика → SPA → ремонт → подписка → обращения → задачи → документы → чаты → касса).

## 24. Хост встроенных модулей `<dc-import>` (14.10)

Восемь страниц рисует встроенный модуль; оболочка — его хост. Контракт (`:2856–2880`):

- `onApi(m, args, okText)` → `run(prefix + m, () => api[m](...args), okText ‖ null, {quiet})`: модуль передаёт имя метода адаптера и аргументы; хост выполняет вызов, кладёт в `state.db` ответ `view()`, показывает тост успеха; ошибки с кодами из `quiet` не тостит (их показывает модуль); возвращает Promise.
- `db` — свежая выборка `view()` при каждом рендере; `mid` — участник.
- `open` / `onOpened` — одноразовое «открыть запись»: хост кладёт id в state (`svcSel`, `docSel`, `chatSel`, `cashOpen`), модуль после открытия вызывает `onOpened`, хост сбрасывает поле.
- `onNav(key, id)` — переход в другой раздел; `onToast(text, tone)` → `toast`.

| Модуль (`name`) | Страница · пункт меню | Пропсы | Префикс `run` · `quiet` | `onNav` | Строки | Файл модуля в снимке | Этап |
|---|---|---|---|---|---|---|---|
| Формы и опросы | `forms` · «Формы и опросы» `dynamic_form` | `embedded, db, mid, tenant, focus{form, tab, resp, key}, on-focus-done, on-api, on-nav` | `form:` · `validation` | `kb` → «База знаний» | `:1588`, `formsProps` `:4501` | нет | 4 |
| Обращения | `service` · «Обращения» `support_agent` | `db, mid, open, on-opened, on-api, on-toast` | `sv:` · `validation, transition, forbidden` | — | `:1593`, `:2858–2859` | нет | 7 |
| Задачи и проекты | `tasks` · «Задачи» `task_alt` | `db, mid, on-api, on-nav, on-toast` | `tj:` · `validation, transition, forbidden` | `leads` → легаси-канбан «Заявки» (`taskLegacy`), `docs` → документ | `:1598`, `:2860–2863` | нет | 4 |
| База знаний | `knowledge` · «База знаний» `menu_book` | `db, mid, on-api, on-nav, on-toast` | `kb:` · `validation, forbidden, conflict, not_found` | `setPage(k)` | `:1826`, `:2866–2867` | нет | 4 |
| Документы | `docs` · «Документы» `description` | `db, mid, open, on-opened, on-api, on-nav, on-toast` | `doc:` · `validation, forbidden, conflict, not_found, transition` | `repair` → объект, вкладка «График»; `kb` → «База знаний» | `:1830`, `:2868–2870` | нет | 7 |
| Чаты | `chat` · «Чаты» `forum` | `db, mid, open, on-opened, on-api, on-nav, on-toast` | `chat:` · `validation, forbidden, conflict, not_found` | `repair` → объект; `docs` → документ; `fleet` → водителю `today`; прочее → `setPage` | `:1834`, `:2871–2873` | нет | 7 |
| Касса | `cash` · «Касса» / «Подотчёт» `account_balance_wallet` | `db, mid, open (acc:/sh:/из todo), on-opened, on-api, on-nav, on-toast` | `cash:` · `validation, forbidden, conflict, not_found` | `users` (+ вкладка), `review` (+ рейс), `repair`, прочее | `:1898`, `:2877–2879` | нет | 5 |
| Ремонт и стройка | `repair`, `repairSupply`, `repairCatalog` · «Объекты», «Снабжение», «Шаблоны и расценки» | `embedded, tab (+catalog, stock), obj, changes, can-edit, on-change, on-tab, on-status, on-leads` | не через `onApi`: хост сам вызывает `addWorkLog`, `acceptWorkLog`, `assignForeman`, `proposeChange`, `setChange` | `on-leads` → «Заявки» | `:2121`, `repairVM` `:4261` | версия 03.10 (без `obj/changes/canEdit/onChange`) | 6 |

Для этапов 1–2 хост нужен как контракт оболочки (W1.20): пункты этих страниц есть в меню с первого дня, а сами модули приходят в этапах 4–7. До своего этапа страница модуля — `out-of-stage` в allowlist; визуальной сверки нет, пока нет модульного `.dc.html` (B-1, `design/MANIFEST.md`).

## 25. DoR этапа 1 (W1.00)

Сверка со снимком `design-stage-1` (матрица историй — `13-stage1-dor.md`). Оболочка эталона по-прежнему покрывает S1-27…S1-29 целиком; изменения контракта `0.4.0-stage1`, которые меняют реализацию этого анализа:

- **Баннеры §11 №1 и №5 у всех участников.** Эталон берёт `tenant.status` и `usedGb / quotaGb` из полной базы; в API эти данные видны только с `billing.read`. Для оболочки добавлено необязательное `TenantContext.tenantState` в `/me/context`: `status` (PLAT-02), `trialEndsAt` (только `trial`), `graceEndsAt` (только `grace`), `storageWriteStatus` (`blocked` — баннер «Место организации заполнено.»). Баннер №1 «Пробный период завершён.» показывается при `read_only` и `suspended`; текст для `suspended` — тот же до ответа на вопрос 13 §3 п. 2.
- **Переключатель бизнеса (S1-07).** Отдельный ключ `tenant-switch` в `screens.yaml` (no-reference, B-6 №3); последний выбор хранится в control 0004 `accounts.last_tenant_id` и приходит в `MeContext.lastTenantId`.
- **Отзыв прав ≤ 5 с (S1-15) и входящие (S1-26).** Канал реального времени по ADR-0015: оболочка получает билет `createRealtimeTicket`, открывает WebSocket `/api/v1/realtime` и на подсказку `context.changed` перечитывает `/me/context` (меню §9, AccessGate §12 и баннеры §11 пересчитываются без перезагрузки), на `notifications.changed` — `getMyNotificationSummary` (счётчик поповера §10.3). В режиме mock сокета нет — перечитывание по таймеру.
- **Глобальные состояния S1-30.** «Нет связи», «Связь восстановлена» и режим чтения есть в эталоне (§11, §16.1); «Сессия истекла» и конфликт ревизии — нет. Тексты — `errors.session_expired` и `errors.revision_mismatch` словаря W0.14, экран — `design-requests.md` («Дополнения DoR этапа 1»).
