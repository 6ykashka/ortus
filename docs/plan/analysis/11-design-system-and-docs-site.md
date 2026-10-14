# 11 · Дизайн-система и сайт документации — карта для реализации

Домен: токены, контракт компонентов `@ortus/ui`, справочная страница «Дизайн-система», сайт документации («Документация.dc.html») и хостинг четырёх `.dc.html`-фреймов через `support.js`. Все пути — относительно `design/`. Цитаты подписей — дословно.

---

## 1. Источники

| Файл | Строки | Что взято |
|---|---|---|
| `docs/design-system/components.md` | 1–57 | принципы (5–11), таблица контрактов (15–44), тексты интерфейса (46–52), «чего нет» (54–56) |
| `docs/design-system/tokens.json` | 1–79 | полный каталог токенов W3C Design Tokens v0.2 |
| `docs/design-system/tokens.css` | 1–52 | CSS custom properties `--ox-*`, `prefers-reduced-motion` (47–49), `:focus-visible` (51) |
| `Дизайн-система.dc.html` | 1–482 | helmet (10–23), шапка и якоря (28–57), секции `#color` (59–86), `#type` (88–100), `#layout` (102–155), `#buttons` (157–215), `#fields` (217–246), `#status` (248–280), `#access` (282–324), `#fleet` (326–358), `#data` (360–410), `#shell` (412–451), `#copy` (453–463), футер (465–469), логика и props (473–479) |
| `Документация.dc.html` | 1–501 | helmet (10–26), шаблон (27–124), `DOCS` (126–166), `GROUPS` (167), `BASENAMES` (171–174), `S` (176–194), хелперы (195–204), `Component` (206–497): `load` (236–245), `paint` (257–281), `decorate` (283–316), `renderMermaid` (318–336), `highlight` (338–353), `renderPerms` (355–379), `renderApi` (381–430), `ensureAll`/`runSearch` (432–454), `renderVals` (456–496) |
| `support.js` | 1–1912 | parse (24–83), boot (86–200), выражения (203–294), кодирование атрибутов (297–412), компиляция шаблона (415–814), `DCLogic` (817–851), React-компонент-хост (854–1133), CDN/SRI (1143–1153), x-import (1156–1354), helmet (1363–1495), `style-*` псевдоклассы (1498–1589), runtime (1622–1789), загрузка React UMD и `init` (1818–1911) |
| `README.md` | 1–189 | §«Дизайн-токены» (36–44), §«Компоненты и состояния» (46–60), требование HTTP-сервера (5), ограничения (174–179) |
| `Ортус CRM.dc.html` | выборочно | helmet (10–26), демо-панель (29–88), шапка (94–146), сайдбар (149–170), баннеры/скелетон/gate (172–203), карточки модулей (228–242), табы (290–294), switch (359), нижняя навигация (2192–2201), модалки и sheet (2203–2311), тост (2313–2317), константы `TONE`/`LINE`/`STRIPES` (2329–2330, 2359), `boot()` (2423–2435), брейкпоинты (2830, 2843–2844), `toastVM` (2895–2901), навигация (3020–3028), `bannersVM` (3080–3093), табы-VM (3138), степпер (3429), фото-слот (739, 3387), пустые состояния (807–830) |
| `Объекты - варианты.dc.html` | 1–40, 539–598 | helmet с `design_doc_mode=canvas` и `data-dc-atomics` (10–23), props `viewer`/`showResearch` (539) |
| `Ремонт и стройка.dc.html` | 1–40, 466–505 | helmet (10–24), props `embedded`/`tab`/`onTab`/`onStatus`/`onLeads` (466); подключается в CRM через `<dc-import name="Ремонт и стройка">` (`Ортус CRM.dc.html:2126`) |
| `Ortus CRM.dc.html` (латиница) | 1–13 | пустая заглушка `<x-dc></x-dc>` |
| `docs/README.md` | 1–55 | стартовая страница `#/start` |
| `docs/14-engineering.md` | 7–22, 26–51, 85–94, 119–126 | стек, структура репозитория (`packages/tokens`, `packages/ui`), CI с Playwright, перенос прототипа |
| `docs/11-permissions.yaml` | 9–10, 12, 143–190 | структура YAML для рендерера `perm` |
| `docs/v0.1/ortus-openapi-v0.1.yaml` | 1–40 + подсчёты | 11 690 строк, 76 путей, 118 операций, 199 схем, 18 тегов |

---

## 2. Сводка

- Дизайн-система v0.2 (01.10.2026): один акцент `#1F6B52`, нейтральные зеленоватые поверхности, 5 тонов статусов, Golos Text + IBM Plex Mono, Material Symbols Rounded (`tokens.json:1–79`).
- Токены оформлены в W3C Design Tokens (`tokens.json`) и сгенерированы в CSS-переменные `--ox-*` (`tokens.css:1–45`). В прототипе они применяются **инлайн** хексами, кроме акцента, который идёт через `var(--ox-accent)` / `--ox-accent-soft` / `--ox-accent-tint` (`Ортус CRM.dc.html:17`; 236/25/20 использований).
- Контракт компонентов — 30 компонентов в `components.md:15–44` для пакета `@ortus/ui` (React + TypeScript, Radix/React Aria как headless по `14-engineering.md:17`).
- Справочная страница `Дизайн-система.dc.html` — статичная витрина: 11 секций с якорями, все состояния кнопок/полей/статусов/баннеров/AccessGate/PhotoSlot/таблицы/диалога/тоста/оболочки, с одним prop `showTokens` (подписи кодов) (`Дизайн-система.dc.html:473–479`).
- `Документация.dc.html` — SPA-читалка: реестр `DOCS` из 36 документов в 4 группах, hash-роутинг `#/id`, полнотекстовый поиск по всем не-frame документам с дебаунсом 220 мс и подсветкой первого совпадения, рендереры `md` (marked), `code`, `perm` (js-yaml), `api` (OpenAPI с фильтром), `frame` (iframe), TOC ≥ 1280 px, бургер-навигация < 960 px, пейджер «← Назад / Далее →», mermaid из CDN.
- Рендерер `md` не использует CSS-классы: функция `decorate()` навешивает инлайн-стили из объекта `S` на каждый тег без собственного `style` (`Документация.dc.html:283–316`).
- Четыре frame-страницы (`Дизайн-система`, `Прототип` = `Ортус CRM.dc.html`, `Объекты - варианты`; плюс `Ремонт и стройка`, который подтягивается прототипом сам) — это Design Components: `<x-dc>` + `<script data-dc-script>` с `class Component extends DCLogic`, исполняемые `support.js` (dc-runtime).
- `support.js` сам грузит React 18.3.1 UMD + ReactDOM с unpkg по SRI (`support.js:1143–1148`), компилирует шаблон в React-элементы, `style-hover` превращает в псевдокласс с `!important` (`support.js:1567–1589`), а логику исполняет через `new Function` (`support.js:842–851`) — нужен `'unsafe-eval'` в CSP.
- Прототип грузит доменные модули `ortus/api.js`, `models.js`, `roadmap.js` динамическим `import()` относительно `document.baseURI` (`Ортус CRM.dc.html:2426–2427`) — работает только по HTTP (`README.md:5`).
- Брейкпоинты: токены/прототип — `< 640` телефон, `640–1079` рейл, `≥ 1080` сайдбар (`tokens.json:66–70`, `Ортус CRM.dc.html:2830`); сайт документации — свои: `< 960` бургер, `≥ 1280` TOC (`Документация.dc.html:459, 493`).
- Шрифты и иконки — только Google Fonts: `Golos+Text:wght@400;500;600;700`, `IBM+Plex+Mono:wght@400;500`, `Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block` (во всех пяти `.dc.html`).
- Тёмной темы в источниках нет; `support.js` знает про `data-theme=dark` только для фона «canvas»-режима (`#2e2c26`, `support.js:1364–1365`) — ⚠ не дизайн-система.
- Все внешние зависимости сайта документации — без SRI: `marked@12`, `js-yaml@4` (`<script>`), `mermaid@11` (ESM `import()`), все с cdn.jsdelivr.net (`Документация.dc.html:16–17, 323`).
- В CRM есть расхождения с токенами: границы тонов (`LINE`) не совпадают с `tone.*.border`, 20+ хексов вне палитры, высоты кнопок 36/40 px вне шкалы 32/44/48 — см. §10.

---

## 3. Каталог токенов

### 3.1 Цвета (`tokens.json:3–28`, `tokens.css:3–24`)

| Токен | CSS | Значение | Назначение (из `$description` / витрины `Дизайн-система.dc.html:62–73`) |
|---|---|---|---|
| `color.canvas` | `--ox-canvas` | `#E6E9E3` | «Фон вокруг приложения, демо-рамка»; витрина: «Фон вокруг приложения» |
| `color.surface` | `--ox-surface` | `#F2F3EF` | «Фон рабочей области»; витрина: «Рабочая область» |
| `color.card` | `--ox-card` | `#FFFFFF` | «Карточки, таблицы, диалоги» |
| `color.raised` | `--ox-raised` | `#F8F9F6` | «Вложенные блоки, подсказки»; витрина: «Вложенные блоки, только чтение» |
| `color.line` | `--ox-line` | `#DCE2D9` | «Границы карточек» |
| `color.line-control` | `--ox-line-control` | `#CDD5CB` | «Границы полей и вторичных кнопок» |
| `color.divider` | `--ox-divider` | `#E8ECE5` | разделители строк (без описания в JSON) |
| `color.text` | `--ox-text` | `#1C2A26` | «Основной текст» |
| `color.text-label` | `--ox-text-label` | `#3A4844` | «Подписи полей» |
| `color.text-muted` | `--ox-text-muted` | `#5C6964` | «Вторичный текст; 5.6:1 на белом» |
| `color.accent` | `--ox-accent` | `#1F6B52` | «Основное действие, фокус, ссылки» |
| `color.accent-hover` | `--ox-accent-hover` | `#185A44` | hover акцента |
| `color.accent-soft` | `--ox-accent-soft` | `#E3EFE7` | «Активный пункт меню, аватар» |
| `color.on-accent` | `--ox-on-accent` | `#FFFFFF` | текст на акценте |
| `color.chrome` | `--ox-chrome` | `#22302C` | «Тёмная шапка оператора платформы и демо-панель» |
| `color.focus` | `--ox-focus` | `#1F6B52` | `:focus-visible{outline:2px solid; outline-offset:2px}` (`tokens.css:51`) |

Тона статусов (`tokens.json:21–27`; смысл — `Дизайн-система.dc.html:77`: «ok — можно работать, info — идёт процесс, warn — нужно действие, danger — заблокировано, neutral — не начато или неактивно»):

| Тон | bg | fg | border | CSS |
|---|---|---|---|---|
| ok | `#E3EFE7` | `#1F6B52` | `#B9D6C4` | `--ox-ok-bg/fg/border` |
| info | `#E7EEF6` | `#2B5479` | `#C3D3E6` | `--ox-info-*` |
| warn | `#FAF1DC` | `#7A5214` | `#EBD7A6` | `--ox-warn-*` |
| danger | `#FBEAE7` | `#A13A33` | `#F0C9C3` | `--ox-danger-*` |
| neutral | `#ECEFEA` | `#4C5955` | `#D5DBD2` | `--ox-neutral-*` |

### 3.2 Типографика (`tokens.json:29–42`, `tokens.css:26–30`)

| Токен | Значение |
|---|---|
| `font.family.sans` / `--ox-font-sans` | `'Golos Text', system-ui, sans-serif` |
| `font.family.mono` / `--ox-font-mono` | `'IBM Plex Mono', ui-monospace, monospace` — «Госномера, ключи прав, ID запроса» |
| `font.size` xs/sm/md/lg/xl/2xl/3xl | `12/13/14/16/20/24/32px` (`--ox-fs-*`) |
| `font.weight` regular/medium/semibold | `400/500/600` |
| `font.line-height` tight/base | `1.2 / 1.45` |

Шкала на витрине (`Дизайн-система.dc.html:91–98`): «3xl · 32/600» (letter-spacing −0.02em, lh 1.15) «Приёмка смен»; «2xl · 24/600» (−0.01em, lh 1.2) «Заголовок страницы»; «xl · 20/600» «Заголовок экрана на телефоне, диалог»; «lg · 16/600» «Заголовок карточки и раздела»; «md · 14/400» «Основной текст, ячейки таблиц, значения полей»; «sm · 13/500» цвет `#3A4844` «Подпись поля, текст кнопки в плотном интерфейсе»; «xs · 12/400» `#5C6964` «Метаданные, время события, подсказки. Минимальный размер текста.»; «mono · 14/500» — госномер `А 123 ВС 77` в рамке `1px solid #CDD5CB`, bg `#F8F9F6`, radius 6px, padding 2px 8px; ключ `fleet.trips.review` 13px `#3A4844`; `req 01J9Z4K…` 12px `#5C6964`.

### 3.3 Отступы, скругления, тени, размеры, брейкпоинты, движение (`tokens.json:43–78`)

| Группа | Токены |
|---|---|
| `space` | 1=4, 2=8, 3=12, 4=16, 5=20, 6=24, 8=32, 10=40 px (`--ox-space-N`) |
| `radius` | sm=6, md=8, lg=10, xl=12, pill=999 px. Правило витрины (`Дизайн-система.dc.html:125`): «Кнопки и поля — md, карточки и диалоги — xl, статусы — pill. Тень только у всплывающих слоёв: меню, уведомления, диалог, закреплённая панель действия.» |
| `shadow` | popover `0 16px 40px rgba(28,42,38,.18)`; dialog `0 24px 64px rgba(28,42,38,.24)`; sticky `0 -8px 24px rgba(28,42,38,.08)` |
| `size` | control 44 («Минимальная высота кнопок и полей на любом экране»), control-mobile 48 («48–54px»), control-compact 32 («Только в плотных таблицах на desktop»), icon 20, header 58 |
| `breakpoint` | rail 640 («< 640 — нижняя навигация и карточки вместо таблиц»), sidebar 1080 («≥ 1080 — боковая панель с подписями») |
| `motion` | fast 120ms, base 200ms; `prefers-reduced-motion: reduce → 0ms` (реализовано в `tokens.css:47–49`) |
| `icon.set` | «Material Symbols Rounded», «opsz 24, wght 400, FILL 0; FILL 1 — только для активного пункта меню» |

### 3.4 Соответствие хексов прототипа токенам (`Ортус CRM.dc.html`, перепись по всему файлу)

| Хекс в CRM | Кол-во | Токен |
|---|---|---|
| `#FFFFFF` | 405 | card / on-accent |
| `#5C6964` | 364 | text-muted |
| `#DCE2D9` | 169 | line |
| `#CDD5CB` | 161 | line-control |
| `#3A4844` | 117 | text-label |
| `#A13A33` | 91 | danger.fg |
| `#1C2A26` | 58 | text (и фон тоста/«chrome»-подобный: `Ортус CRM.dc.html:2314`) |
| `#E8ECE5` | 55 | divider |
| `#7A5214` | 51 | warn.fg |
| `#2B5479` | 31 | info.fg |
| `#F8F9F6` | 28 | raised |
| `#ECEFEA` | 26 | neutral.bg (и hover ghost/icon-button) |
| `#FAF1DC` / `#FBEAE7` / `#E7EEF6` / `#E3EFE7` | 25 / 22 / 14 / 4 | warn.bg / danger.bg / info.bg / accent-soft=ok.bg |
| `#F2F3EF` | 16 | surface |
| `#4C5955` | 11 | neutral.fg |
| `#F0C9C3` | 10 | danger.border |
| `#1F6B52` / `#185A44` | 9 / 1 | accent / accent-hover (остальное через `var(--ox-accent)` ×236) |
| `#22302C` | 4 | chrome |
| `#E6E9E3` | 2 | canvas |

Хексы **вне палитры** (нужно либо добавить токены, либо заменить):

| Хекс | Кол-во | Где / зачем |
|---|---|---|
| `#6B7873` | 15 | заголовки групп навигации 11px uppercase (`:152, :2304`), неактивный шаг степпера (`:3429`) |
| `#EBD7A8`, `#C9D8E8`, `#BFD9C8` | 10, 6, 6 | `LINE` — границы баннеров (`:2330`), **не равны** `tone.*.border` |
| `#C3CCC1` | 8 | пунктирная рамка пустых состояний `border:1px dashed` (`:383, :858`) |
| `#E3B5AF` | 7 | рамка вторичной danger-кнопки «Отклонить» / «Отключить» / «Заблокировать вход» / «Удалить» / «Убрать» (`:970, :1046, :1142, :1187, :1274`) |
| `#EEF1EC` | 7 | фон превью фото 16/10 (`:609–610`) |
| `#DFE4DC`, `#E6EAE3` | 2, 2 | скелетон с анимацией `ox-pulse 1.4s` (`:184–187`) |
| `#F0F2EE` | 4 | разделитель строк уведомлений (`:129`); то же в результатах поиска докс-сайта (`Документация.dc.html:47`) |
| `#7CC4A0`, `#4A5A55`, `#2E3D39`, `#E4ECE6`, `#AFC0B8` | 4, 6, 2, 2, 2 | демо-панель на `#22302C` (`:29–66`); `#7CC4A0` также иконка тоста в витрине (`Дизайн-система.dc.html:406`) |
| `#8FD3AE`, `#F0C76E`, `#F2A99E`, `#A9C8EA` | 1 каждый | иконка тоста по тону ok/warn/error/info на тёмном (`:2898`) |
| `#D9B76A` | 2 | пунктир `1.5px dashed` «сдача сохранена на устройстве» (`:816`) |
| `#C9D1C7` | 1 | рамка демо-кадра 390/768/1440 (`:2840`) |
| `#8A968F` | 2 | иконка «не начато» (`:4327`) |
| `#F1F7F3` | 1 | `--ox-accent-tint` (`:17`) — выбранная строка/карточка (`:3639, :3644, :4343`); **нет в tokens.json** |
| `#B7791F`, `#F7E9C6`, `#E0B457`, `#FFFCF4` | 9, 3, 3, 3 | ⚠ назначение не проверено (вероятно штриховка/акценты «на приёмке» — `Ремонт и стройка.dc.html:492` использует `HATCH = repeating-linear-gradient(135deg,#E0B457 0 3px,#F7E9C6 3px 6px)`) |
| `#E3E7E0` | — | скелетон докс-сайта (`Документация.dc.html:95–98`) |
| `#8A302A`, `#FFFBFA` | — | витрина: hover danger-кнопки (`Дизайн-система.dc.html:186–187`), фон строки ошибки/блока «Начисления» (`:317, :334`) |

Непрозрачные тени вне токенов: `0 20px 50px rgba(28,42,38,.25)` (модалка `:2205`), `0 8px 24px rgba(0,0,0,.22)` (тост `:2314`), `0 16px 40px rgba(0,0,0,.28)` («Путь проверки» `:69`), `0 12px 32px rgba(28,42,38,.16)` (демо-кадр `:2841`), скрим `rgba(28,42,38,.42)` (`:2204`), скрим докс-навигации `rgba(28,42,38,.32)` (`Документация.dc.html:73`), скрим витрины `rgba(28,42,38,.36)` (`Дизайн-система.dc.html:383`).

---

## 4. Каталог контрактов компонентов

Формат: контракт из `components.md:15–44` → как нарисовано на витрине → как используется в CRM (представительные строки).

### 4.1 Button (`components.md:17`)
- Props: `variant` (`primary|secondary|ghost|danger`), `size` (`md` 44px, `lg` 48px, `compact` 32px «только desktop-таблицы»), `icon`, `loading`, `disabled`, `disabledReason`. A11y: «`disabledReason` выводится рядом или в `aria-describedby`; loading сохраняет ширину и ставит `aria-busy`».
- Витрина (`Дизайн-система.dc.html:160–190`), сетка «Обычное / Наведение / Фокус / Выполняется / Недоступно»:
  - primary: `min-height:44px;padding:0 16px;border-radius:8px;border:1px solid #1F6B52;background:#1F6B52;color:#FFFFFF;font-weight:500;gap:6px`, иконка 20px, hover `background:#185A44;border-color:#185A44`, focus `outline:2px solid #1F6B52;outline-offset:2px`, loading `aria-busy="true"`, иконка `progress_activity`, `cursor:progress;opacity:.85`, текст «Принимаем…»; disabled `opacity:.45;cursor:not-allowed` + `aria-describedby="why-1"` → «Нет фото одометра» 12px `#5C6964`. Образец: «Принять смену» (иконка `verified`).
  - secondary: `border:1px solid #CDD5CB;background:#FFFFFF;color:#1C2A26`, hover `background:#F2F3EF`, loading «Отправляем…». Образец: «Вернуть на доработку» (`undo`).
  - ghost: `padding:0 12px;border:1px solid transparent;background:transparent;color:#1F6B52`, hover `background:#E3EFE7`; состояния loading нет («—»). Образец: «Обновить список».
  - danger: `border:1px solid #A13A33;background:#A13A33;color:#FFFFFF`, hover `#8A302A`, focus outline `#A13A33`, loading «Отключаем…». Образец: «Отключить модуль» (`extension_off`).
  - Мобильное основное действие (`:195–202`): `min-height:52px;border-radius:10px;font-size:16px;font-weight:600;gap:8px`, иконка 22px, в закреплённой панели с `box-shadow:0 -8px 24px rgba(28,42,38,.08)` и строкой `#7A5214` «Осталось: 2 фото, пробег, 1 пункт чек-листа» (иконка `error` 18px). Образец: «Начать рейс» (`route`).
  - compact (`:209–210`): `min-height:32px;padding:0 10px;border-radius:6px;border:1px solid #CDD5CB;font-size:13px`, иконка 18px: «Фильтр» (`filter_list`), «Выгрузить» (`download`). «32 px допустимо только в таблицах на desktop с курсором. На ширине меньше 640 px компактных кнопок нет.» (`:212`).
- CRM: primary через `var(--ox-accent)` 44px (`Ортус CRM.dc.html:201`, модалки `:2225, :2249`), но карточки модулей и демо-кнопки — **40px** (`:220–221, :237–238`), баннер-действие **36px** с `border:1px solid currentColor;background:transparent` (`:178`), danger-secondary с рамкой `#E3B5AF` (`:970`), мобильные 48px radius 10 (`:705, :828`). Глобально `button:disabled{opacity:.45;cursor:not-allowed}` (`:21`).

### 4.2 IconButton (`components.md:18`)
- «ghost; 40×40 минимум», `aria-label` обязателен, `badge`.
- Витрина (`Дизайн-система.dc.html:207–208`): `width:40px;height:40px;border-radius:10px;border:0;background:transparent`, hover `#ECEFEA`, иконка 22px; бейдж `top:5px;right:5px;min-width:17px;height:17px;border-radius:99px;background:#1F6B52;color:#FFFFFF;font-size:11px;font-weight:600` — «Уведомления, 3 новых», «Закрыть».
- CRM: колокольчик `:117–120` (`aria-label="{{ top.bellLabel }}"` = «Уведомления» или «Уведомления: N новых», `aria-expanded`), бургер докс-сайта `Документация.dc.html:31` (`aria-label="Разделы"`), закрытие sheet 44×44 (`Ортус CRM.dc.html:2302`).

### 4.3 Field + TextInput / NumberInput / MoneyInput / DateInput / Select / Textarea (`components.md:19–20`)
- Props: `label`, `hint`, `error`, `required`, `children`; состояния «обычное, focus, ошибка, только чтение, disabled»; `<label for>`, ошибка в `aria-describedby`, `aria-invalid`; `MoneyInput` хранит `amountMinor`, показывает `1 250,00 ₽`.
- Витрина (`Дизайн-система.dc.html:218–225`): «Подпись всегда над полем, ошибка под полем с иконкой. Единица измерения — внутри поля справа.»
  - обёртка `label`: `display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:500;color:#3A4844`; контейнер поля `min-height:44px;padding:0 12px;border-radius:8px;border:1px solid #CDD5CB;background:#FFFFFF`; input без рамки 14px/400 `#1C2A26`; единица «км» 13px `#5C6964`; hint «Как на приборной панели» 12px.
  - focus: `border:1px solid #1F6B52;box-shadow:0 0 0 3px #E3EFE7`.
  - ошибка: `border:1px solid #A13A33`, `aria-invalid="true" aria-describedby="err-odo"`, текст `#A13A33` 12px с иконкой `error` 16px: «Пробег не может быть меньше 48 210 км».
  - деньги: `inputmode="decimal"`, `text-align:right`, суффикс «₽», подпись `amountMinor: 325000`.
  - только чтение: `border:1px solid #DCE2D9;background:#F8F9F6`, иконка `lock` 18px `#5C6964`, «Фирма (только чтение)» → «Москва / Логистика 1».
  - select: `min-height:44px;padding:0 10px;border-radius:8px;border:1px solid #CDD5CB;background:#FFFFFF;font-size:14px` — «Категория»: Топливо / Мойка / Парковка.
- CRM: поля в модалках `width:100%;min-height:44px;padding:8px 12px;border:1px solid #CDD5CB;border-radius:8px;font-size:16px` (`Ортус CRM.dc.html:2234–2241`), ошибочная рамка `1.5px solid {{ border }}` + `aria-invalid` + `<span role="alert">` (`:2256–2257`), мобильные поля 48px и одометр 18px `tabular-nums` (`:747`), textarea `resize:vertical` (`:2294`), `type="date"` (`:2241`).

### 4.4 Checkbox / Switch / Radio (`components.md:21`)
- «Цель нажатия ≥ 44px по высоте строки»; on/off/indeterminate, disabled.
- Витрина: чекбокс в строке `min-height:44px;border:1px solid #CDD5CB;border-radius:8px`, `input 20×20 accent-color:#1F6B52` — «Кузов и стёкла осмотрены», «Документы на месте» (`:228–229`); switch `role="switch" aria-checked tabindex="0"` `width:40px;height:24px;border-radius:999px;background:#1F6B52|#CDD5CB`, ручка 18px `top:3px;left:19px|3px` — «Логистика» / «Склад» (`:233–234`); radiogroup «Уровень топлива»: 4 плитки `min-height:44px;border-radius:8px`, выбранная `border:2px solid #1F6B52;background:#E3EFE7;color:#1F6B52;font-weight:600` — ¼ ½ ¾ «Полный» (`:238–242`).
- CRM: switch как `<button role="switch">` 44×26, ручка 20px, `box-shadow:0 1px 2px rgba(0,0,0,.25)` (`Ортус CRM.dc.html:359`); «aria-pressed»-плитки топлива 48px `border:1.5px solid` (`:751`); radio-карточки «Основа роли» `name="role-mode"` (`:2278–2285`).

### 4.5 Status (pill) (`components.md:22`)
- `tone` ok/info/warn/danger/neutral, `icon`, `children`; «Текст обязателен».
- Витрина (`Дизайн-система.dc.html:254–261`): `display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;white-space:nowrap;font-size:12px;font-weight:500`, иконка 16px. Состояния рейса: «Запланирован» (`event`, neutral), «Машина назначена» (`event_available`, info), «Осмотр перед выездом» (`fact_check`, info), «Дефект на проверке» (`report`, danger), «В рейсе» (`route`, info), «Ожидает приёмки» (`pending`, warn), «На доработке» (`undo`, warn), «Принят» (`verified`, ok). Подпись при `showTokens`: «TRIP_STATE в packages/domain · иконка + текст + тон».
- CRM: тот же пилл с `padding:2px 8px 2px 6px;line-height:18px`, иконка 15px (`Ортус CRM.dc.html:216, :231`); хелпер `ch(label, tone, icon)` (`:2331`); «Нет связи» в шапке `role="status"` (`:115`).

### 4.6 SyncState (`components.md:23`)
- `state`: `local` «На устройстве», `queued` «Ждёт связи», `uploading` «Загрузка N%», `failed` «Ошибка — повторить», `confirmed` «Принято сервером»; `role="status"`, прогресс через `aria-valuenow`.
- Витрина (`Дизайн-система.dc.html:267–271`): строки 13px с иконкой 18px: `smartphone` `#4C5955` «На устройстве · черновик»; `cloud_off` `#7A5214` «Ждёт связи · отправим автоматически»; `cloud_upload` `#2B5479` «Загрузка 64 %» + `role="progressbar" aria-valuenow="64" aria-valuemin="0" aria-valuemax="100"` высота 6px фон `#E7EEF6` заливка `#2B5479`; `role="alert"` `sync_problem` `#A13A33` «Ошибка загрузки» + кнопка «Повторить» (32px, `border:1px solid #F0C9C3`); `cloud_done` `#1F6B52` «Принято сервером · 14:32».

### 4.7 Banner (`components.md:24`)
- `tone`, `title`, `action`; варианты «trial, read-only, офлайн, квота, модуль отключён»; `role="status"` или `alert` для блокирующих.
- Витрина (`Дизайн-система.dc.html:275–278`): `display:flex;flex-wrap:wrap;gap:8px 12px;padding:12px 14px;border-radius:10px;background:{bg};border:1px solid {border};color:{fg}`, иконка 20px, текст 13px `flex:1 1 260px`, кнопка 36px `border:1px solid {fg};background:#FFFFFF;color:{fg}`:
  - info `hourglass_top`: «**Пробный период — осталось 3 дня.** После окончания 7 дней льготного периода, затем только чтение. Данные не удаляются.» + «Продлить»;
  - warn `cloud_off`: «**Нет связи.** Фото и расходы сохраняются на устройстве. Выезд и сдача будут доступны после подключения.»;
  - neutral `history`: «**Логистика отключена · только чтение.** Новые рейсы закрыты, история доступна. Начатые смены можно сдать.»;
  - danger `role="alert"` `storage`: «**Хранилище заполнено: 5,0 из 5 ГиБ.** Новые фото не загружаются. Начатые смены закрываются из резерва.» + «Увеличить место».
- CRM `bannersVM` (`Ортус CRM.dc.html:3080–3093`): role = `alert` только для danger; тексты: «Пробный период завершён.» (warn, `lock_clock`, действие владельца «Демо: продлить как оператор»), «Модуль «Логистика» отключён.» (neutral, `history`), «Нет связи.» (warn, `cloud_off`, с «(ожидают отправки: N)»), «Связь восстановлена.» (info, `sync`, «Отправляем сохранённые на устройстве операции…»), «Место организации заполнено.» (danger, `storage`, действие «Открыть «Модули и место»»). Шаблон `:174–180`.

### 4.8 AccessGate (`components.md:25`)
- `reason`: `module_off`, `module_readonly`, `no_permission`, `no_scope`; «Заголовок h1, объяснение, действие только если оно доступно».
- Витрина (`Дизайн-система.dc.html:285–304`), карточки `padding:24px`, иконка в плитке 44×44 radius 12:
  - `extension_off` на `#ECEFEA/#4C5955`: «Модуль не подключён» — ««Ремонт и стройка» не подключён организацией. Подключить его может владелец бизнеса.» + primary «Перейти в «Модули и место»»; код «403 module_not_installed · действие только у владельца»;
  - `lock` на `#FAF1DC/#7A5214`: «Нет права» — «Ни одна ваша роль не разрешает «Принимать смены». Обратитесь к руководителю фирмы.»; «403 forbidden_action · fleet.trips.review»;
  - `visibility_off` на warn: «Нет доступа к объекту» — «Запись не найдена или находится вне вашей области: Москва / Логистика 1.» + secondary «К списку рейсов»; «404 not_found · одинаково для чужих и несуществующих».
- CRM (`Ортус CRM.dc.html:195–203`): центрированная карточка `padding:40px 24px`, круг 56px, пилл-чип, `h1` 20px, `p` `#5C6964` max 480px, primary 44px.

### 4.9 Card (`components.md:26`)
- «обычная, выбранная, недоступная (с причиной)»; «Кликабельная карточка — одна ссылка/кнопка, а не вложенные».
- Базовый стиль везде: `background:#FFFFFF;border:1px solid #DCE2D9;border-radius:12px;padding:20px` (витрина) / `18px` (карточка модуля `Ортус CRM.dc.html:228`). Выбранная: `background:var(--ox-accent-tint)` + `border:var(--ox-accent)` (`:3639, :4343`). Неподключённый модуль — пунктир (`README.md:112`).

### 4.10 DataTable (`components.md:27`)
- `columns, rows, sort, filter, onRow, mobile="cards"`; «загрузка (скелетон), пусто, ошибка; < 640px → список карточек»; `<th scope>`; «фильтры и сортировка в URL».
- Витрина (`Дизайн-система.dc.html:362–380`): обёртка-карточка `overflow:hidden` + `overflow-x:auto`, `table min-width:640px;border-collapse:collapse;font-size:14px`; `thead tr background:#F8F9F6`, `th scope="col" padding:10px 16px;font-size:12px;font-weight:500;color:#5C6964;border-bottom:1px solid #DCE2D9`; `td padding:12px 16px`, строки `border-bottom:1px solid #E8ECE5`, чётная `#F8F9F6`; номера/госномера моно 13px; суммы `text-align:right;font-variant-numeric:tabular-nums`. Колонки: «Рейс | Машина | Водитель | Статус | Расходы». Мобильная карточка: «Та же строка на ширине меньше 640 px: номер и статус наверху, машина и водитель второй строкой, переход — вся карточка.» → `TR-000214` + пилл; «А 123 ВС 77 · Илья Васильев»; «Сдана 14:32 · расходы 4 120 ₽».
- CRM: сортировка `localeCompare(..., 'ru', {numeric:true})` (`Ортус CRM.dc.html:4195`).

### 4.11 CheckList (`components.md:28`) и LoadBar (`:30`)
- Витрина (`Дизайн-система.dc.html:330–337`): строки `min-height:40px;border-top:1px solid #E8ECE5;font-size:13px`, `check_circle` `#1F6B52` / `cancel` `#A13A33`, несоответствие — строка `background:#FFFBFA`, текст «Объём · не соответствует» `#A13A33` 500. Пилл «Не подходит» (`block`, danger). Подписи: «Доступность — Свободна», «Грузоподъёмность — 5 т · нужно от 3,2 т», «Длина кузова — 4,2 м · нужно от 3,8 м», «Температура — −18…+4 °C · нужно +2…+6 °C».
- LoadBar (`:340–345`): участок — круг 24px с номером (`#E3EFE7/#1F6B52`, при перегрузе `#FBEAE7/#A13A33`), сетка `52px 1fr 44px`, полосы 8px `border-radius:99px` фон `#ECEFEA`, заливка `#1F6B52`, > 100 % — фон `#FBEAE7`, заливка `#A13A33`, «112 %» `#A13A33` 600 + «Перегруз по объёму на участке 2». Оговорка: «Сумма объёма и массы, а не 3D-укладка. Осевая нагрузка и совместимость температурных зон не проверяются.»

### 4.12 PhotoSlot (`components.md:29`)
- `role, state, progress, onCapture, onRetry`; «пусто, загрузка N %, ошибка + «Повторить», на устройстве, готово»; `<input type="file" accept="image/*" capture="environment">`, подпись ракурса.
- Витрина (`Дизайн-система.dc.html:349–356`), сетка `minmax(150px,1fr)`, `aspect-ratio:4/3;border-radius:10px`: пусто — `button` `border:2px dashed #CDD5CB;background:#F8F9F6`, `photo_camera` 28px `#1F6B52`, «Спереди» + «Сделать фото»; загрузка — штриховка `repeating-linear-gradient(135deg,#E8ECE5 0 8px,#F2F3EF 8px 16px)`, `border:1px solid #C3D3E6`, подложка `rgba(255,255,255,.92)` «Сзади 64 %» + полоса 4px `#2B5479`; ошибка — `border:2px solid #A13A33`, плашка `#FBEAE7` «Слева · ошибка» + «Повторить» (28px); на устройстве — `border #EBD7A6`, плашка `#FAF1DC` `smartphone` «Справа · на устройстве»; готово — `border #B9D6C4`, плашка `#E3EFE7` `cloud_done` «Одометр · принято». Заголовок «Слот фото (PhotoSlot)» + «Готово 2 из 5 · обязательные ракурсы».
- CRM: скрытый `<input type="file" accept="image/*" capture="environment">` (`Ортус CRM.dc.html:92`), штриховка `STRIPES` `#E9EDE6/#E0E5DD` (`:2359`), ракурсы `SIDES`: Спереди/Сзади/Слева/Справа/Одометр (`:2360`), «Повторить» 36px (`:739`).

### 4.13 Stepper (`components.md:31`)
- `aria-current="step"`. CRM (`Ортус CRM.dc.html:3429`): пройден `bg var(--ox-accent) fg #FFFFFF`, текущий `bg var(--ox-accent-soft) fg var(--ox-accent)` + подпись 600, впереди `bg #FFFFFF fg #6B7873 border #CDD5CB`. ⚠ на витрине степпера нет.

### 4.14 Dialog / ConfirmDialog / Sheet (`components.md:32–33`)
- `title, consequences, confirmLabel, tone`; «обычный, опасный»; фокус-ловушка, возврат фокуса, Esc. Sheet «снизу на < 640px», как Dialog.
- Витрина (`Дизайн-система.dc.html:383–393`): скрим `rgba(28,42,38,.36)`, `role="dialog" aria-label="Отключить логистику"`, `max-width:380px;border-radius:12px;box-shadow:0 24px 64px rgba(28,42,38,.24);padding:20px`, заголовок 18px/600 «Отключить «Логистику»?», список последствий 13px `#3A4844`: «2 активных рейса можно будет сдать и принять», «Новые брони и рейсы закроются», «История останется доступной для чтения», «Данные и роли не удаляются»; кнопки «Отмена» (secondary 44) и «Отключить» (danger 44), выровнены вправо.
- CRM (`Ортус CRM.dc.html:2203–2311`): скрим `rgba(28,42,38,.42)` закрывает по клику на фон (`onBackdrop`), `role="dialog" aria-modal="true" aria-labelledby="dlg-title"`, `max-width:560px` (assign — 620px), `border-radius:14px` desktop / `16px 16px 0 0` + `align-items:flex-end` + `padding:0` на мобильном (`:3957`), тень `0 20px 50px rgba(28,42,38,.25)`; Esc закрывает (`:2406–2410`). Confirm: иконка в круге 42px, `h2#dlg-title` 18px, секции uppercase 12px, чекбокс-подтверждение 48px, футер с `border-top`. Sheet «Все разделы» (`:2300–2308`): пункты 48px radius 10, иконки 22px, бейдж «план». ⚠ фокус-ловушки в прототипе нет (не найдено в источниках).

### 4.15 Toast (`components.md:34`)
- `tone, text, action`; «успех только после ответа сервера»; `role="status"`, не для ошибок полей.
- Витрина (`Дизайн-система.dc.html:406`): `background:#1C2A26;color:#FFFFFF;padding:12px 14px;border-radius:10px;font-size:13px;box-shadow:0 16px 40px rgba(28,42,38,.18)`, иконка `cloud_done` `#7CC4A0`, «Смена принята. Машина свободна.» + ghost «Открыть» `#7CC4A0`.
- CRM (`Ортус CRM.dc.html:2313–2317, :2440–2444, :2895–2901`): `position:absolute;left:50%;bottom:20px|76px(mobile);z-index:60`, `aria-live="polite"`, role `alert` при tone=error иначе `status`; иконки/цвета ok `check_circle #8FD3AE`, warn `cloud_off #F0C76E`, error `error #F2A99E`, info `info #A9C8EA`; автоскрытие 4200 мс.

### 4.16 ConflictNotice (`components.md:40`) и EmptyState (`:35`) и Skeleton (`:36`)
- Витрина: `role="alert"` warn-плашка `sync_lock` «Машину уже забронировали. Список обновлён.» + «Обновить» (`Дизайн-система.dc.html:407`); пустое состояние `inbox` 32px `#5C6964`, «Нет смен на проверке», «Когда водитель сдаст машину, смена появится здесь.» (`:396–400`); скелетон `aria-busy="true"` три полосы 12px `#ECEFEA` (40/85/65 %) (`:401–405`).
- CRM: скелетон `role="status" aria-label="Загрузка"` с `ox-pulse` и подписью «Загружаем рабочее пространство…» (`Ортус CRM.dc.html:182–190`); пустые состояния-карточки `padding:28px 20px`, круг 56px, `h2` 19px (`:807–830`): «Ожидает приёмки менеджером», «Сдача сохранена на устройстве» (пунктир `#D9B76A`), «Смена принята».

### 4.17 Tabs (`components.md:44`)
- `items(id,label,badge), value, onChange`; «подчёркивание 2px акцентом; счётчик warn»; стрелки ←/→, `aria-controls`.
- CRM (`Ортус CRM.dc.html:290–294, :3138`): `role="tablist" aria-label="Разделы доступа"`, `role="tab" aria-selected`, `min-height:44px;padding:0 12px;margin-bottom:-1px;border-bottom:2px solid var(--ox-accent)|transparent`, активный `color var(--ox-accent) weight 600`, неактивный `#3A4844` 500; счётчик `background:#ECEFEA;color:#4C5955` 12px radius 99 (⚠ в контракте «счётчик warn», в прототипе neutral). Второй вид — карточки-табы 52px `border:1.5px solid` (`:440–442`). ⚠ клавиатурных стрелок в прототипе нет.

### 4.18 AppShell / Nav / ScopeSelect (`components.md:37–38`)
- «sidebar ≥ 1080, rail 640–1079, нижняя навигация < 640; тёмная шапка оператора»; Skip-link «К содержимому» (⚠ в прототипе не найден), landmarks; `ScopeSelect` подпись «Область просмотра».
- Витрина (`Дизайн-система.dc.html:415–449`): три макета с подписями «< 640 px · телефон — Нижняя навигация 3 + «Ещё», карточки, закреплённое действие», «640–1079 px · планшет — Иконочный рейл, сетка карточек», «≥ 1080 px · компьютер — Боковая панель с подписями, таблицы, массовые действия»; шапка 58px: лого «о» 32px radius 9 `#1F6B52`, разделитель `border-left:1px solid #DCE2D9`, `domain` 20px, «ГК «Северный путь»» / «Москва / Логистика 1», пилл «Нет связи», аватар 36px круг `#E3EFE7/#1F6B52` «МК»; оператор: `background:#22302C;color:#FFFFFF`, «Управление платформой» / «Оператор · без доступа к данным клиентов» `#AFC0B8`, разделитель `#4A5A55`.
- CRM: `header min-height:58px;padding:8px 14px` (`Ортус CRM.dc.html:94`), `select aria-label="Область просмотра"` 36px (`:110`), `nav aria-label="Основная навигация"` ширина `244px` / рейл `68px` с визуально скрытыми подписями (`:150–169, :2843`), пункт `min-height:40px;border-radius:8px`, активный `bg var(--ox-accent-soft) fg var(--ox-accent) weight 600 aria-current="page"`, неактивный `#3A4844` 400, hover `#EBEFE9` (`:155, :3022`), бейдж «план» (`:159`), счётчик на `var(--ox-accent)` (`:160`); нижняя `nav aria-label="Навигация"` 60px, иконки 24px, активная `font-variation-settings:'FILL' 1` (`:2192–2201, :3026`), 3 пункта + «Ещё» (`menu`) → sheet (`:3028`); короткие подписи «Логист», «Люди», «Модули», «Пул», «Приёмка» (`:3026`).

### 4.19 RoleEditor / ReadinessBar / DecisionQueue / ObjectHeader (`components.md:39, 41–43`)
- Витрина RoleEditor (`Дизайн-система.dc.html:307–322`): «Редактор роли: уровни и чувствительные права»; шапка модуля `#F8F9F6` с `local_shipping` + switch; чипы уровней 32px pill: включённые `#E3EFE7/#1F6B52 border #B9D6C4` с `check` («Просматривать», «Создавать», «Проверять»), выключенные `#FFFFFF/#3A4844 border #CDD5CB` («Выгружать», «Настраивать»); закрытый блок `border-top:1px dashed #F0C9C3;background:#FFFBFA`, `block` `#A13A33`: «**Начисления водителям** — отдельный блок. Недоступен для роли с функцией «Водитель» через любую роль и группу.» + `fleet.earnings.read`.
- ReadinessBar/DecisionQueue/ObjectHeader — только контракт (`components.md:41–43`) и CRM (`Ортус CRM.dc.html:4327` — `accW`/`penW`, иконки `check_circle`/`progress_activity`/`radio_button_unchecked`); на витрине не показаны.

### 4.20 Тексты интерфейса (`components.md:46–52`, `Дизайн-система.dc.html:455–462`)
Таблица «Так / Не так»: «Машину уже забронировали. Обновите список.» ↔ «Ошибка 409!»; «Сохранено на устройстве. Отправим, когда появится связь.» ↔ «Отправлено ✓ (без ответа сервера)»; «Принять смену · Вернуть на доработку» ↔ «ОК · Отмена»; «Нет права «Принимать смены»» ↔ «Доступ запрещён»; «1 250 ₽ · 12 345 км · 3,5 т · 1 окт, 14:30» ↔ «1250.00 RUB · 12345km · 3.5t · 2026-10-01T11:30Z». Запрещено (`components.md:56`): «Градиенты, тени на карточках в покое, эмодзи, цвет как единственный статус, более одного акцентного цвета, иконки из разных наборов, всплывающие подсказки как единственный способ узнать причину блокировки.»

---

## 5. Справочная страница «Дизайн-система» (`Дизайн-система.dc.html`)

- `<title>` «Ортус — дизайн-система v0.2»; глобальный CSS в helmet: `html,body{background:#F2F3EF;color:#1C2A26;font-family:'Golos Text'...}`, `:focus-visible{outline:2px solid #1F6B52;outline-offset:2px}`, `a{color:#1F6B52} a:hover{color:#185A44}` (`:10–23`).
- Контейнер `max-width:1160px;gap:48px;padding:32px 20px 64px` (`:25–26`).
- Шапка: лого «о» 40px radius 10 `#1F6B52` 26px; «ортус» 20px/600; «Дизайн-система · версия 0.2 · 1 октября 2026»; h1 «Токены, компоненты и состояния для всех модулей CRM» (32px/600, −0.02em); абзац со ссылками на `docs/design-system/tokens.json` и `components.md` (`:28–37`).
- `nav aria-label="Разделы"` — 11 чипов `min-height:36px;border-radius:999px;border:1px solid #CDD5CB;background:#FFFFFF;font-size:13px` с `href="#…"`: «Цвет» `#color`, «Типографика» `#type`, «Отступы и размеры» `#layout`, «Кнопки» `#buttons`, «Поля» `#fields`, «Статусы и синхронизация» `#status`, «Доступ» `#access`, «Логистика» `#fleet`, «Данные и обратная связь» `#data`, «Оболочка» `#shell`, «Тексты» `#copy` (`:38–50`).
- 4 карточки принципов (`work`, `label`, `cloud_sync`, `touch_app`): «Работа важнее декора.», «Статус = иконка + текст + цвет.», «Локальное ≠ серверное.», «Одно основное действие.» (`:51–56`).
- Секции `<section id=… data-screen-label=…>` с номером моно «01»…«11», h2 24px/600 и подзаголовком `#5C6964` max 720px: 01 «Цвет», 02 «Типографика», 03 «Отступы, скругления, размеры», 04 «Кнопки», 05 «Поля ввода», 06 «Статусы, синхронизация, баннеры», 07 «Доступ: три разных отказа», 08 «Компоненты логистики», 09 «Таблицы, диалоги, пустые состояния», 10 «Оболочка и адаптивность», 11 «Тексты интерфейса». `data-screen-label`: «Цвет», «Типографика», «Отступы и размеры», «Кнопки», «Поля», «Статусы», «Доступ», «Логистика», «Данные и обратная связь», «Оболочка», «Тексты».
- Палитра: карточки `minmax(170px,1fr)` с образцом 64px и подписями `canvas … chrome` (12 штук, `:62–73`); тона — 5 карточек с пиллами «Свободна» (`check_circle`), «В рейсе» (`route`), «Ожидает приёмки» (`pending`), «Дефект на проверке» (`report`), «Запланирован» (`event`) и подписью вида «ok · #E3EFE7 / #1F6B52» (`:79–83`).
- Отступы: 8 полос `space-1 · 4 … space-10 · 40` (`:107–114`); скругления sm 6 … pill (`:119–123`); тени popover/dialog (`:127–128`); высоты «32 compact», «44 control», «48–54 mobile», «58 шапка» (`:134–137`); иконки 10 образцов 40×40 на `#F8F9F6`: `local_shipping, fact_check, route, photo_camera, local_gas_station, group, extension, calendar_month, table_view, lock` (`:142–151`), текст «Material Symbols Rounded, 20 px в интерфейсе, 16 px в статусах. Заливка — только у активного пункта меню.» (`:140`).
- Футер: «Ортус · дизайн-система 0.2», ссылка «Прототип» → `Ортус CRM.dc.html`, `docs/design-system/` (`:465–469`).
- Логика: `data-props` `showTokens` (boolean, default true, label «Показывать коды и ключи»); `renderVals(){ return { showTokens: this.props.showTokens ?? true } }` (`:473–479`). Подписи кодов обёрнуты в `<sc-if value="{{ showTokens }}">` (`:263, :290, :296, :303`).

---

## 6. Функциональная спецификация сайта документации (`Документация.dc.html`)

### 6.1 Каркас и шапка (`:27–55`)
- Корень `height:100vh;display:flex;flex-direction:column;background:#F2F3EF;font-size:14px;line-height:1.45`.
- `<header>` `min-height:58px;padding:8px 16px;background:#FFFFFF;border-bottom:1px solid #DCE2D9;z-index:30`:
  - при `narrow` (`w < 960`) — `button aria-label="Разделы" aria-expanded="{{ navOpen }}"` 40×40 radius 10, иконка `menu` 22px, hover `#ECEFEA`;
  - ссылка `a[href="#/start"]`: лого «о» 32px radius 9 `#1F6B52` 21px; «ортус» 17px/600 −0.01em; «документация» 11px `#5C6964`;
  - поиск: `label` `flex:0 1 420px;min-height:40px;padding:0 12px;border-radius:10px;border:1px solid #CDD5CB;background:#F8F9F6`, иконка `search` 20px `#5C6964`, `input type="search" placeholder="Поиск по всем документам" aria-label="Поиск по документам"`.
- Тема CSS helmet (`:18–25`) идентична витрине.

### 6.2 Поиск (`:43–53`, `:432–454`, `:476–483`)
- `onQuery`: `setState({query})`, дебаунс **220 мс** → `runSearch(q)`.
- `runSearch`: `term.length < 2` → `results: null`; `ensureAll()` один раз загружает **все** документы `kind !== 'frame'` (`fetchText` с кешем, ошибки → пустая строка); если `query` изменился за время загрузки — результат отбрасывается; поиск регистронезависимый `indexOf` по сырому тексту; `count` ≤ 999; сниппет: 70 символов до, 90 после первого совпадения, `clean()` = `replace(/[#*`|>\-]{1,}/g,' ')` + схлопывание пробелов, многоточия по краям; сортировка по `count` убыв.; **top 15**.
- UI: `div[role="listbox"][aria-label="Результаты поиска"]` `position:absolute;top:calc(100% + 6px);right:0;width:min(560px,calc(100vw - 32px));max-height:70vh;overflow-y:auto;background:#FFFFFF;border:1px solid #DCE2D9;border-radius:12px;box-shadow:0 16px 40px rgba(28,42,38,.18)`; заголовок 12px `#5C6964` `border-bottom:1px solid #E8ECE5`: «Найдено в N документах» либо «Ничего не найдено»; элемент — `button` `padding:10px 14px;border-bottom:1px solid #F0F2EE`, hover `#F8F9F6`: `strong` 14px/600 `{{ r.title }}` + `{{ r.meta }}` 12px (`GROUP_LABEL · N совп.`), сниппет 13px `#3A4844` с `<mark style="background:#FAF1DC;color:#1C2A26;padding:0 2px;border-radius:3px">`.
- `showResults = !!results && query.trim().length >= 2`.
- Клик по результату: `pendingTerm = query.trim()`, `results: null`; если это текущий документ — `paint()`, иначе `location.hash = '#/' + id`. После отрисовки `highlight()` подсвечивает **первое** вхождение (TreeWalker по текстовым узлам, `<mark style="background:#FAF1DC;color:inherit;…">`) и прокручивает `main` на `top − 120` (`:338–353`). Запрос в поле остаётся.
- ⚠ закрытия списка по Esc/клику вне нет в источниках; список исчезает при навигации (`onHash` → `results: null`, `:224`).

### 6.3 Реестр документов `DOCS` (`:126–166`) и группы `GROUPS` (`:167`)

Группы (порядок = порядок навигации и пейджера): `v02` «Старт разработки · 0.2», `api` «Контракты», `v01` «Проектирование · 0.1», `ds` «Дизайн и прототип».

| # | id | group | title | path | kind | icon |
|---|---|---|---|---|---|---|
| 1 | `start` | v02 | Комплект для старта | `docs/README.md` | md | `rocket_launch` |
| 2 | `data-model` | v02 | 10 · Модель данных | `docs/10-data-model.md` | md | `schema` |
| 3 | `sql-control` | v02 | SQL · control 0001 | `docs/db/control_0001_init.sql` | code | `database` |
| 4 | `sql-core` | v02 | SQL · tenant core 0001 | `docs/db/tenant_0001_core.sql` | code | `database` |
| 5 | `sql-fleet` | v02 | SQL · tenant fleet 0002 | `docs/db/tenant_0002_fleet.sql` | code | `database` |
| 6 | `backlog` | v02 | 13 · Бэклог S0–S2 | `docs/13-backlog-s0-s2.md` | md | `view_list` |
| 7 | `engineering` | v02 | 14 · Инженерный регламент | `docs/14-engineering.md` | md | `construction` |
| 8 | `compose` | v02 | docker-compose.yml | `docs/repo-skeleton/docker-compose.yml` | code | `deployed_code` |
| 9 | `env` | v02 | .env.example | `docs/repo-skeleton/.env.example` | code | `tune` |
| 10 | `quality` | v02 | 15 · Качество и безопасность | `docs/15-quality-security.md` | md | `verified_user` |
| 11 | `billing` | v02 | 17 · Пользователи, места, тарифы | `docs/17-users-and-billing.md` | md | `workspace_premium` |
| 12 | `sql-billing` | v02 | SQL · control billing 0002 | `docs/db/control_0002_billing.sql` | code | `database` |
| 13 | `branding` | v02 | 18 · Оформление организации | `docs/18-branding.md` | md | `palette` |
| 14 | `sql-branding` | v02 | SQL · control branding 0003 | `docs/db/control_0003_branding.sql` | code | `database` |
| 15 | `construction` | v02 | 19 · Ремонт и стройка: объекты и расширения | `docs/19-construction.md` | md | `construction` |
| 16 | `raid` | v02 | 16 · Решения, риски, глоссарий | `docs/16-raid-glossary.md` | md | `gavel` |
| 17 | `openapi` | api | OpenAPI 0.1 | `docs/v0.1/ortus-openapi-v0.1.yaml` | api | `api` |
| 18 | `permissions` | api | 11 · Каталог прав | `docs/11-permissions.yaml` | perm | `key` |
| 19 | `errors` | api | 12 · Ошибки и события | `docs/12-errors-and-events.md` | md | `report` |
| 20 | `api-guide` | api | 03 · Спецификация API | `docs/v0.1/03-api-guide.md` | md | `menu_book` |
| 21 | `v01` | v01 | Обзор комплекта 0.1 | `docs/v0.1/README.md` | md | `folder_open` |
| 22 | `spec` | v01 | 01 · Техническое задание | `docs/v0.1/01-technical-spec.md` | md | `description` |
| 23 | `architecture` | v01 | 02 · Архитектура | `docs/v0.1/02-architecture.md` | md | `account_tree` |
| 24 | `research` | v01 | 04 · Исследование продуктов | `docs/v0.1/04-product-research.md` | md | `travel_explore` |
| 25 | `technology` | v01 | 05 · Обзор технологий | `docs/v0.1/05-technology-review.md` | md | `memory` |
| 26 | `team-prompt` | v01 | 06 · Промт команды | `docs/v0.1/06-team-prompt.md` | md | `groups` |
| 27 | `ux` | v01 | 07 · UX и данные | `docs/v0.1/07-ux-and-data.md` | md | `dashboard` |
| 28 | `scenarios` | v01 | 08 · Отраслевые сценарии | `docs/v0.1/08-domain-scenarios.md` | md | `route` |
| 29 | `session` | v01 | 09 · Установочная сессия | `docs/v0.1/09-team-session.md` | md | `forum` |
| 30 | `design-system` | ds | Дизайн-система | `Дизайн-система.dc.html` | frame | `palette` |
| 31 | `components` | ds | Компоненты: контракт | `docs/design-system/components.md` | md | `widgets` |
| 32 | `tokens` | ds | Токены (JSON) | `docs/design-system/tokens.json` | code | `data_object` |
| 33 | `tokens-css` | ds | Токены (CSS) | `docs/design-system/tokens.css` | code | `css` |
| 34 | `proto-readme` | ds | Прототип: описание | `README.md` | md | `info` |
| 35 | `prototype` | ds | Прототип | `Ортус CRM.dc.html` | frame | `smartphone` |
| 36 | `objects-variants` | ds | Объекты: варианты карточки | `Объекты - варианты.dc.html` | frame | `home_work` |

Итого 36 документов: 22 md, 9 code, 1 api, 1 perm, 3 frame. Все файлы присутствуют в снапшоте (проверено по дереву `docs/`). Размеры: OpenAPI 364 884 байта, `02-architecture.md` 85 435, `08-domain-scenarios.md` 74 820, `01-technical-spec.md` 59 742 — суммарно `docs/` ≈ 1,0 МБ.

`BASENAMES` (`:171–174`): basename каждого path (кроме `README.md`) → id; дополнительно `ortus-openapi-v0.1.yaml → openapi`, `permissions.yaml → permissions`. Используется для переписывания относительных ссылок и `<code>` с именем файла в ссылки `#/id` (`:301–315`).

### 6.4 Навигация (`:57–73`, `:463–475`)
- `nav aria-label="Документы"`: `width:280px;overflow-y:auto;gap:20px;padding:20px 12px 40px;background:#F8F9F6;border-right:1px solid #DCE2D9`; при `narrow` — `position:absolute;top:0;bottom:0;left:0;z-index:20;box-shadow:0 16px 40px rgba(28,42,38,.18)` и скрим `rgba(28,42,38,.32)` `z-index:19` (клик закрывает).
- `showNav = !narrow || navOpen`; `navScrim = narrow && navOpen`; `toggleNav` переключает.
- Группа: подпись 12px/600 uppercase `letter-spacing:.04em` `#5C6964` `padding:0 10px 6px`; пункт `a[href="#/id"] aria-current="page|undefined"`: `min-height:36px;padding:6px 10px;border-radius:8px;font-size:14px;gap:8px`, иконка 18px; активный `background:#E3EFE7;color:#1F6B52;icon #1F6B52;font-weight:600`, неактивный `transparent;#1C2A26;icon #5C6964;400`; hover `#ECEFEA`.
- При смене hash `navOpen` сбрасывается (`:224`).

### 6.5 Маршрутизация и загрузка (`:196`, `:211–245`)
- `parseRoute`: `location.hash.match(/^#\/([\w-]+)/)` → id, если есть в `DOCS`, иначе `'start'`. Неизвестный/пустой hash → `start` без изменения URL.
- `componentDidMount`: `hashchange`, `resize` (обновляет `w`), `load(route)`. Начальный `w` = `window.innerWidth` или 1280.
- `onHash`: если тот же id — ничего; иначе `setState({route, navOpen:false, apiFilter:'', results:null})` → `load`.
- `load(id)`: frame → `loading:false, error:null, toc:[]` → `paint`; иначе если нет в кеше → `loading:true`, `article.innerHTML=''`, `fetchText` (`fetch(encodeURI(doc.path))`, при `!res.ok` → `Error('Не удалось загрузить ' + path + ' (' + status + ')')`) → `loading:false` → `paint`.
- `paint(keepScroll)`: по `kind`: `md` → `waitFor(window.marked)` (до 10 с, иначе «Библиотека не загрузилась») → `marked.parse(text, {gfm:true})`; `code` → `<h1>{title}</h1><pre><code>{esc(text)}</code></pre>`; `perm` → `renderPerms(jsyaml.load(text), text)`; `api` → `this.spec` кешируется, `renderApi(spec, apiFilter.trim().toLowerCase())`; frame → пусто. Затем `el.innerHTML = html`, `decorate(el)`, сбор TOC по `h2, h3` (id `sec-{i}`, уровень 2/3), `renderMermaid`, затем либо `highlight(pendingTerm)` либо `main.scrollTop = 0` (если не `keepScroll`).
- Фильтр API: `componentDidUpdate` сравнивает `apiFilter` → дебаунс **200 мс** → `paint(true)` (без прокрутки) (`:247–255`).

### 6.6 Страница документа (`:75–121`, `:484–494`)
- `main` `flex:1;overflow-y:auto;position:relative`; при frame — `iframe src="{{ encodeURI(path) }}" title="{{ docTitle }}"` `width:100%;height:100%;border:0;background:#F2F3EF`, а контейнер страницы `display:none`.
- `pageStyle`: `display:flex;gap:40px;justify-content:center;padding:32px 40px 80px` (narrow: `20px 16px 64px`); колонка контента `max-width:880px;gap:16px`.
- Мета-строка 13px `#5C6964`: `{{ docGroup }}` · `{{ docPath }}` (моно 12px) · ссылка `a[href=path][target=_blank][rel=noopener]` с иконкой `open_in_new` 16px и текстом «Исходный файл».
- Для `kind=api` — поле фильтра: `label min-height:44px;border-radius:10px;border:1px solid #CDD5CB;background:#FFFFFF`, иконка `filter_list`, `input placeholder="Фильтр: путь, право, operationId, схема" aria-label="Фильтр операций"`.
- Загрузка: `div[aria-busy="true"]` с 4 полосами `#E3E7E0` (28px/55 %, 12px/92 %, 86 %, 70 %).
- Ошибка: `div[role="alert"]` `background:#FBEAE7;color:#A13A33;border-radius:10px;font-size:13px` + иконка `error` 20px + текст.
- `article` `font-size:15px;line-height:1.6;color:#1C2A26` — целевой контейнер `innerHTML`.
- Пейджер (`showPager = !loading && !isFrame`): сетка `repeat(auto-fit,minmax(min(100%,220px),1fr))`, `margin-top:24px;padding-top:20px;border-top:1px solid #DCE2D9`; карточка `a` `padding:12px 14px;border-radius:10px;border:1px solid #DCE2D9;background:#FFFFFF`, hover `border-color:#1F6B52`; «← Назад» / «Далее →» 12px `#5C6964` + заголовок 500 (вторая выровнена вправо). `prev/next` — соседи в `ORDER` (группы по порядку `GROUPS`), включая frame-документы как цели.
- TOC (`showToc = w >= 1280 && !isFrame && toc.length > 2`): `aside aria-label="Содержание"` `width:240px;position:sticky;top:0;max-height:calc(100vh - 110px);padding-top:30px`, заголовок «На странице» (12px uppercase), кнопки `padding:5px 8px 5px {{ indent }}` (h2 → `8px`, h3 → `20px`) 13px `#3A4844` radius 6, hover `#ECEFEA` + `#1C2A26`; клик → `main.scrollTo({top: el.top − main.top + scrollTop − 16, behavior:'smooth'})`. Текущий раздел не подсвечивается (⚠ не в источниках).

### 6.7 Стили markdown — объект `S` и `decorate()` (`:176–194`, `:283–316`)

| Тег | Инлайн-стиль |
|---|---|
| `h1` | `font-size:30px;font-weight:600;letter-spacing:-0.02em;line-height:1.2;margin:0 0 16px;text-wrap:balance;` (первый `h1` в article → `margin-top:0`) |
| `h2` | `font-size:22px;font-weight:600;letter-spacing:-0.01em;line-height:1.25;margin:40px 0 12px;padding-top:20px;border-top:1px solid #DCE2D9;text-wrap:balance;` (первый `h2` сразу после `h1` → `border-top:0`) |
| `h3` | `font-size:17px;font-weight:600;line-height:1.3;margin:28px 0 8px;` |
| `h4` | `font-size:15px;font-weight:600;margin:20px 0 6px;` |
| `p` | `margin:0 0 12px;text-wrap:pretty;` |
| `ul`, `ol` | `margin:0 0 14px;padding-left:22px;` |
| `li` | `margin:4px 0;` |
| `table` | `width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;background:#FFFFFF;` — оборачивается в `div[data-wrap=1]` `overflow-x:auto;margin:0 0 16px;border:1px solid #DCE2D9;border-radius:10px;background:#FFFFFF` |
| `th` | `text-align:left;font-weight:600;padding:9px 12px;background:#F8F9F6;border-bottom:1px solid #DCE2D9;vertical-align:bottom;` |
| `td` | `padding:9px 12px;border-top:1px solid #E8ECE5;vertical-align:top;` |
| `pre` | `margin:0 0 16px;padding:14px 16px;background:#FFFFFF;border:1px solid #DCE2D9;border-radius:10px;overflow:auto;font-size:13px;line-height:1.55;` |
| `pre > code` | `font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px;white-space:pre;` |
| `code` (инлайн) | `MONO + font-size:.86em;background:#ECEFEA;padding:1px 5px;border-radius:4px;overflow-wrap:anywhere;` |
| `blockquote` | `margin:0 0 14px;padding:12px 16px;background:#FFFFFF;border:1px solid #DCE2D9;border-radius:10px;color:#3A4844;` |
| `a` | `color:#1F6B52;text-underline-offset:2px;` |
| `hr` | `border:0;border-top:1px solid #DCE2D9;margin:24px 0;` |
| `strong` | `font-weight:600;` |

Правила `decorate()`: элементы с собственным `style` не трогаются (поэтому HTML рендереров perm/api сохраняет свои стили); `a[href^=http]` → `target=_blank rel=noopener`; относительные ссылки с известным basename → `#/id`; инлайн `code`, текст которого — известный basename (например `11-permissions.yaml`), оборачивается в `a[href=#/id]` и перекрашивается `color:#1F6B52;background:#E3EFE7`.

### 6.8 Mermaid (`:318–336`)
- Ищет `pre code.language-mermaid`; при первом вызове `import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')`, `initialize({startOnLoad:false, theme:'base', fontFamily:'Golos Text, system-ui, sans-serif', themeVariables:{primaryColor:'#E3EFE7', primaryBorderColor:'#1F6B52', primaryTextColor:'#1C2A26', lineColor:'#5C6964', fontSize:'13px'}})`; `render('mmd-'+Date.now()+'-'+i)` → SVG в `div` `margin:0 0 16px;padding:16px;background:#FFFFFF;border:1px solid #DCE2D9;border-radius:10px;overflow:auto`, заменяет `pre`. Любая ошибка — тихо, остаётся код.
- В комплекте единственная диаграмма: `docs/10-data-model.md:43` (`erDiagram`).

### 6.9 Рендерер прав `renderPerms(y, raw)` (`:355–379`), данные `docs/11-permissions.yaml`
- Вход: `version` («0.2»), `levels` (`[view, create, edit, review, export, settings]`), `modules` (ключи вида `core.members` с `label`, `system`, `industry`, `depends_on`, `actions{key:{level,label,scopes,sensitivity,note,owner_only,blocked_by_function}}`), `role_templates` (`owner`, `logistics_manager`, `driver`, `foreman`, `observer` с `label`, `kind`, `default_scope`, `work_function`, `actions`, `optional_restricted`, `note`), `prototype_renames` (строка → строка или массив).
- Выход: `h1` «Каталог прав»; `p` «Версия 0.2. Канонический реестр action keys. Уровни редактора роли: <code>view</code> <code>create</code> …».
- Для каждого модуля: `h2` `{label}` (напр. «Пользователи и доступ»); `p` с `<code>{key}</code>` и пиллами `pill('системный', neutral)`, `pill('отраслевой', info)`, «зависит от <code>…</code>» 12px; карточка `card()` (`background:#FFFFFF;border:1px solid #DCE2D9;border-radius:12px;overflow:hidden;margin:0 0 16px`) → `tableWrap` → таблица `min-width:720px` с `TH` (`font-size:12px;color:#5C6964;background:#F8F9F6`) «Ключ | Действие | Уровень | Области | Чувствительность»; строка: ключ моно `white-space:nowrap`; действие + `note` 12px `#5C6964`; `level || '—'`; `scopes.join(', ') || '—'`; пилл чувствительности: normal → «обычное» neutral, sensitive → «чувствительное» warn, restricted → «закрытое» danger; `owner_only` → «только владелец» info; `blocked_by_function` → «запрещено: driver» danger.
- `h2` «Шаблоны ролей» → карточка на шаблон: `strong` 15px `{label}` (Владелец бизнеса / Менеджер логистики / Водитель / Прораб / Наблюдатель), `<code>{key}</code>`, «область по умолчанию: unit|self|project», `pill('функция: driver|foreman', warn)`, `note` 13px `#3A4844`, чипы действий моно 12px `background:#F2F3EF;border:1px solid #E8ECE5;border-radius:4px`, строка «Отдельный финансовый блок: fleet.earnings.read, fleet.earnings.manage» `#A13A33`.
- `h2` «Переименования из прототипа» + `p` «Ключи <code>ortus/models.js</code>, которые нужно заменить при переносе в репозиторий.» + таблица «В прототипе | Канон» (10 строк, напр. `fleet.inspections.create → fleet.inspections.submit`).
- `h2` «Исходный YAML» → `details > summary` «Показать файл» (`color:#1F6B52`) → `pre > code` с экранированным YAML.
- `pill(text,bg,fg)`: `display:inline-flex;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;white-space:nowrap` (без иконки).

### 6.10 Рендерер OpenAPI `renderApi(spec, f)` (`:381–430`)
- Факты спецификации: `openapi: 3.1.0`, `info.title` «ORTUS CRM Constructor — Design API», `info.version` `0.1.0-design`, `servers[0].url` `https://api.example.invalid`, 76 путей, 118 операций (у всех есть `operationId`, `x-permissions`, `x-scope`, `x-permissions-mode`), 199 схем, 18 тегов: Context, Platform, Billing, Access, Modules, Data, Files, Tasks, Knowledge, Calendar, Forms, PublicForms, Fleet, Earnings, Spa, Inventory, Cash, Repairs.
- Хелперы: `resolve($ref)` по `#/components/...`; `typeOf(schema)`: `$ref` → имя; array → `T[]`; `oneOf` → `A | B`; иначе `type · format (enum1, enum2)`; `tagDesc` из `spec.tags`.
- Группировка: перебор `paths` × методов `get, post, put, patch, delete`; `hay = [path, method, summary, operationId, perms, x-scope, tags].join(' ').toLowerCase()`; при `f` оставляет только `hay.includes(f)`; группа — первый тег или «Прочее»; параметры = `item.parameters` + `op.parameters` (resolved).
- Шапка: `h1 {info.title}`; `p` с `pill('OpenAPI 3.1.0', neutral)`, `pill('версия 0.1.0-design', info)`, «76 путей · 118 операций · 199 схем» и при фильтре « · найдено N операций и M схем»; `p` `#3A4844` с `info.description`; `p` 13px «Сервер <code>https://api.example.invalid</code> — нерабочий адрес-пример. Пути после <code>/api/v1/tenants/{tenantId}</code> выполняются в контексте бизнеса; <code>tenantId</code> не даёт доступа.»
- Для каждого тега: `h2 {tag} <span 14px/400 #5C6964>· N</span>`; описание тега 14px `#5C6964`; `card()` со списком `details` (разделитель `border-top:1px solid #E8ECE5` кроме первого):
  - `summary` (`padding:10px 14px;list-style:none;gap:8px 10px`): пилл метода `display:inline-grid;min-width:58px;padding:2px 6px;border-radius:6px;MONO 12px/500;text-transform:uppercase` с тоном `METHOD_TONE` (get → info, post → ok, put/patch → warn, delete → danger); путь моно 13px без префикса `/api/v1` (`flex:1 1 280px`); `summary` 13px `#5C6964` (`flex:1 1 200px`);
  - тело (`padding:4px 14px 16px;gap:10px;font-size:13px`): `description` если ≠ summary; сетка `120px minmax(0,1fr)`: «operationId» (моно 12px), «Права» (чипы моно 12px `background:#E3EFE7;color:#1F6B52;border-radius:4px` или «—», плюс «режим: {x-permissions-mode}»), «Область» (`x-scope` моно), «Тело» (`<code>content-type</code> → <code>Тип</code>` построчно); таблица параметров «Параметр | Где | Тип | Обяз.» (`да` / `—`) в рамке `#E8ECE5` radius 8; блок «Ответы»: строки `pill(code)` (2xx ok, 4xx warn, 5xx danger, иначе neutral) + описание + `<code>` тип схемы первого content.
- Если `shown === 0 && f` → `p` «Операций по фильтру «{f}» нет.»
- Схемы: имена фильтруются по `includes(f)`; `h2` «Схемы · N»; `card()` со списком `details`: `summary` имя моно 13px `padding:9px 14px`; описание; таблица свойств: имя моно + красная `*` для required, тип моно 12px, описание `#5C6964`; не-объект → строка `typeOf`. Лимит 400.
- Кеш: `this.spec` парсится один раз; смена `apiFilter` перерисовывает без прокрутки.

### 6.11 Адаптивность
- `< 960` — бургер, оверлейная навигация, `padding` страницы `20px 16px 64px`; `≥ 1280` и `toc.length > 2` — TOC; между — обычная двухколонная (nav + контент) без TOC. Ширина результатов поиска `min(560px, 100vw − 32px)`.

---

## 7. Хостинг `.dc.html`-фреймов и требования `support.js`

### 7.1 Как работает `support.js` (dc-runtime, сборка из `dc-runtime/src/*.ts`, `support.js:1`)
1. `hideRawTemplate()` вставляет `x-dc{display:none!important}` (`:1818–1822`), затем `loadReactUmd()` (`:1838–1847`): если `window.React && window.ReactDOM` нет — добавляет два `<script async=false>`: `https://unpkg.com/react@18.3.1/umd/react.production.min.js` (SRI `sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z`) и `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` (SRI `sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1`) с `crossOrigin=anonymous` (`:1143–1146`, `:1823–1837`). Ошибка → `console.error('[dc] failed to load React or boot:')` и throw (`:1907–1910`).
2. `cdnScriptFor(url, sri)` (`:1149–1153`): если задан `window.__resources[url]` (строка) — используется он **без integrity**. Это штатный способ подменить CDN локальными копиями. Babel (`@babel/standalone@7.29.0`) грузится только для `x-import` `.jsx/.tsx` (`:1147–1148`, `:1176–1192`) — в наших страницах не нужен.
3. `init()` (`:1848–1905`): `BASE_CSS` в `<head>` (плейсхолдеры стриминга, `.sc-logic-error` красный `#b00020` баннер ошибки логики, print-CSS, `:86–131`); публикует `window.__dcUpdate/__dcStreaming/__dcSetProps/__dcRootName/__dcAnnotatedTemplate/__dcTemplateSource/__dcBoot/__dcRegistry/getDC/DCLogic/StreamableLogic` (`:1871–1901`); `__dcBoot` при `DOMContentLoaded`.
4. `boot()` (`:150–200`): `parseDcDocument` берёт `innerHTML` `<x-dc>` и текст `<script data-dc-script>` + `data-props` (JSON с `$preview`) (`:24–74`); имя компонента — из имени файла без `.dc.html` (`:75–83`); если нет `__resources`, повторно `fetch(location.href)` для сырого шаблона (`:158–164`); `<x-dc>` заменяется на `<div id="dc-root">`; если нет `$preview` — `html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}` (`:132`, `:169–173`); рендер `ReactDOM.createRoot`.
5. Шаблон компилируется в функцию React-элементов (`compileTemplate`, `:467–482`): `{{ expr }}` в тексте и атрибутах (`compileAttr`, `:401–412`); выражения — пути `a.b[c]`, `==`/`!=`/`===`/`!==`, `!`, литералы (`:203–294`); `<sc-if value hint-placeholder-val>` (`:646–660`); `<sc-for list as hint-placeholder-count>` даёт `$index` (`:611–645`); `<helmet>` → `<sc-helmet>` (`:377–378`), содержимое переносится в `<head>` (SCRIPT/LINK/META один раз по ключу, остальное «живое», `:1420–1493`), атрибут `data-dc-atomics` подключает утилитарный CSS (`:1357–1360`, `:1423–1428`); `style-hover="…"` и другие `style-<pseudo>` → класс `.scpN:hover{…!important}` через `insertRule` (`:415–431`, `:1567–1589`); `class`→`className`, `for`→`htmlFor`, `onClick` и пр. → React-события (`:432–440`); таблицы/select оборачиваются в `sc-raw-*` (`:303–316`); `ref="{{ fn }}"` работает как React ref.
6. Логика: `new Function('DCLogic','StreamableLogic','React', src + 'return Component')` (`:842–851`); хост-класс `StreamableComponent` вызывает `componentDidMount/DidUpdate/WillUnmount`, `renderVals()` сливается с props (`:1080–1085`); ошибка рендера → error boundary с текстом в `.sc-logic-error` (`:925–937`, `:1056–1071`).
7. `<dc-import name="X">` подгружает соседний `./X.dc.html` (`encodeURIComponent(name)`) через `fetch` (`:1642–1685`) — так CRM встраивает «Ремонт и стройка» (`Ортус CRM.dc.html:2126`). `<x-import from="…">` — внешние модули через `fetch` + `new Function` (`:1194–1256`).
8. Хост-протокол postMessage (для встраивания в редактор): наружу `__dc_booted {rootName, propsMeta, preview}` (`:1854–1869`) и `__dc_design_mode {mode}` (`:1384–1390`); внутрь `__dc_theme {theme}` и `__dc_probe` (`:1407–1419`). `<meta name="design_doc_mode" content="canvas">` включает `html[data-dc-canvas]` и фон `#f0eee6` (`#2e2c26` при `data-theme=dark`/`?theme=dark`) (`:1363–1406`); так устроен `Объекты - варианты.dc.html:11`.

### 7.2 Что нужно отдать статикой, чтобы фреймы работали внутри нашего сайта
- Одна папка (origin тот же, относительные пути сохранены): `support.js`, `Дизайн-система.dc.html`, `Ортус CRM.dc.html`, `Объекты - варианты.dc.html`, `Ремонт и стройка.dc.html` (dc-import), `ortus/{api,models,mock-data,extra-data,roadmap}.js` (ES-модули, `import()` относительно `document.baseURI`, `Ортус CRM.dc.html:2426–2427`), `docs/**` (для читалки), `README.md`.
- Сервер: HTTP(S), корректные MIME (`.js` → `text/javascript`, иначе `import()` падает), поддержка кириллических URL (сайт делает `encodeURI(path)`; `dc-import` — `encodeURIComponent(name)`).
- iframe в читалке: `src="{{ encodeURI(doc.path) }}"`, `title="{{ doc.title }}"`, без `sandbox` (нужны `allow-scripts allow-same-origin`, если добавлять). Внутри iframe страница сама грузит React, шрифты, модули — три фрейма = три копии React.
- Playwright: ждать `#dc-root .sc-host` и отсутствия `.sc-logic-error`; консоль не должна содержать `[dc-runtime]`/`[dc] failed`.

### 7.3 Риски
- **CDN**: unpkg (React, SRI), jsDelivr (marked, js-yaml, mermaid — без SRI), Google Fonts (CSS + woff2). Недоступность unpkg = пустой экран всех фреймов; недоступность jsDelivr = «Библиотека не загрузилась» через 10 с для md/perm/api.
- **CSP**: обязательны `script-src 'unsafe-eval'` (`new Function`), `style-src 'unsafe-inline'` (инлайн-стили + `insertRule`), `script-src https://unpkg.com https://cdn.jsdelivr.net`, `style-src/font-src https://fonts.googleapis.com https://fonts.gstatic.com`, `frame-src 'self'`.
- Прототип хранит состояние в памяти, фото как object URL (`README.md:166, :176`); ширина измеряется `ResizeObserver` по кадру (`Ортус CRM.dc.html:2384–2393`), поэтому внутри iframe раскладка зависит от ширины iframe, а не окна.
- `Объекты - варианты` в canvas-режиме шлёт `postMessage` родителю и ставит `html[data-dc-canvas]` — безвредно, но фон страницы задаётся как `body{background:#E4E7E1}` (`Объекты - варианты.dc.html:17`), не токен.

### 7.4 Офлайн-вариант (без CDN)
1. Положить `react.production.min.js` и `react-dom.production.min.js` 18.3.1 в `vendor/` и до `support.js` выполнить `<script>window.__resources={'https://unpkg.com/react@18.3.1/umd/react.production.min.js':'./vendor/react.production.min.js','https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js':'./vendor/react-dom.production.min.js'}</script>` — поддерживается `cdnScriptFor` (`support.js:1149–1153`); integrity при этом не проверяется. Альтернатива — заранее создать `window.React/ReactDOM` любым бандлом (`:1839–1840`).
2. Для стилей `<link rel=stylesheet>` подмена через `__resources` работает только с `window.__resourceBlobs` (Blob) (`:1455–1472`); проще заменить ссылки Google Fonts в helmet на локальный `fonts.css` с `@font-face` (Golos Text 400/500/600/700, IBM Plex Mono 400/500, Material Symbols Rounded variable woff2 с осями `opsz,wght,FILL,GRAD`).
3. В читалке заменить `cdn.jsdelivr.net` на локальные `marked`, `js-yaml`, `mermaid.esm.min.mjs` (динамический `import()` требует ESM-сборку и те же MIME).
4. Либо реализовать читалку заново в нашем стеке (React + TS, `14-engineering.md:16`) с бандлингом зависимостей, оставив `support.js` только для трёх iframe.

---

## 8. Шрифты и иконки

| Ресурс | Точная строка подключения | Где |
|---|---|---|
| Golos Text | `https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap` | все `.dc.html` (helmet, строка 14) |
| IBM Plex Mono 400/500 | та же ссылка | госномера, ключи прав, ID, пути документов, код |
| Material Symbols Rounded | `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block` | все `.dc.html` (строка 15) |
| preconnect | `<link rel="preconnect" href="https://fonts.googleapis.com">` | строка 13 |

- Токены задают веса только 400/500/600 (`tokens.json:40`); 700 грузится, использование в прототипе ⚠ не проверено.
- Иконки: класс `material-symbols-rounded` + `aria-hidden="true"`, текст = имя иконки; размеры: 20px интерфейс, 16px в пиллах, 15px в пиллах CRM, 18px в навигации докс-сайта и строках SyncState, 22px в icon-button/шапке, 24px в нижней навигации и AccessGate витрины, 28px в пустых состояниях CRM и PhotoSlot, 32px в EmptyState витрины. Заливка: `font-variation-settings:'FILL' 1` только для активного пункта нижней навигации (`Ортус CRM.dc.html:2196`, `tokens.json:77`). `display=block` в URL — текст иконок не показывается до загрузки шрифта (нет FOUT-«слов»).
- Полный список имён иконок, встречающихся в читалке и реестре: `menu, search, open_in_new, filter_list, error, rocket_launch, schema, database, view_list, construction, deployed_code, tune, verified_user, workspace_premium, palette, gavel, api, key, report, menu_book, folder_open, description, account_tree, travel_explore, memory, groups, dashboard, route, forum, widgets, data_object, css, info, smartphone, home_work`.

---

## 9. Инварианты и правила

1. Один акцентный цвет; статус = иконка + текст + цвет, цвет никогда не единственный носитель (`components.md:8`, `README.md:41`, `Дизайн-система.dc.html:53`).
2. Все значения из токенов; новые цвета вне палитры не вводятся (`components.md:3`). Нет градиентов, теней на карточках в покое, эмодзи, смешанных наборов иконок, подсказок как единственного объяснения (`components.md:56`).
3. Цели нажатия ≥ 44px; мобильное основное действие 48–54px; 32px только в desktop-таблицах, на < 640px компактных кнопок нет (`tokens.json:60–62`, `Дизайн-система.dc.html:212`).
4. Скругления: кнопки/поля 8, карточки/диалоги 12, статусы pill; тени только у всплывающих слоёв (`Дизайн-система.dc.html:125`).
5. Недоступная кнопка объясняет причину рядом (`aria-describedby`) (`components.md:17`, `Дизайн-система.dc.html:158, :169`).
6. Подпись над полем, ошибка под полем с иконкой и `aria-invalid`/`aria-describedby`, единица внутри поля справа (`Дизайн-система.dc.html:218`).
7. Баннеры: `role="status"`, блокирующие (danger) — `role="alert"` (`components.md:24`, `Ортус CRM.dc.html:3082`). Тост: `role="status"`, `aria-live="polite"`, успех только после ответа сервера; для ошибки tone=error → `role="alert"` (`Ортус CRM.dc.html:2900`).
8. Три разных отказа доступа с разными иконками/текстами; чужой объект = 404 как несуществующий (`Дизайн-система.dc.html:283–304`).
9. SyncState: «Отправлено» никогда без ответа сервера; состояния `local/queued/uploading/failed/confirmed` (`components.md:23, :50`).
10. Навигация: активный пункт `aria-current="page"`, `accent-soft` фон, `accent` текст, 600; FILL 1 только у активного пункта нижней панели (`tokens.json:77`).
11. Dialog: фокус-ловушка, возврат фокуса, Esc, `aria-modal`, `aria-labelledby`; Sheet снизу на < 640 (`components.md:32–33`, `Ортус CRM.dc.html:2205, :3957`).
12. Числа и даты: `1 250 ₽`, `12 345 км`, `3,5 т`, `18 м³`, `1 окт, 14:30`; госномер моно (`components.md:51`); деньги — `amountMinor` + `Intl.NumberFormat('ru-RU')` (`14-engineering.md:113`).
13. Читалка: маршрут всегда валидный (`#/unknown` → `start`); навигация, пейджер и порядок поиска определяются одним реестром `DOCS`/`GROUPS`; md-стили — только через `S`; ссылки на известные файлы превращаются во внутренние; внешние ссылки открываются в новой вкладке (`Документация.dc.html:196, :169, :283–316`).
14. Поиск: минимум 2 символа, дебаунс 220 мс, результат отбрасывается, если запрос изменился, не более 15 документов, подсветка первого вхождения после перехода (`:436–454, :477–482`).
15. Frame-документы: нет TOC, нет пейджера, нет мета-строки, iframe занимает 100 % высоты `main` (`:76–79, :486, :490, :493`).
16. `prefers-reduced-motion: reduce` → `--ox-motion-* = 0ms` (`tokens.css:47–49`); `:focus-visible` 2px акцент с отступом 2px (`tokens.css:51`).
17. Прототип и фреймы запускаются только с веб-сервера, не через `file://` (`README.md:5`).

---

## 10. Чек-лист приёмки (Playwright, Given/When/Then)

### Читалка документации
1. **Старт.** Given открыт URL читалки без hash. When страница загрузилась. Then `location.hash` пуст или `#/start`, `main article h1` содержит «Ортус CRM — комплект для старта разработки v0.2», в `nav[aria-label="Документы"]` ссылка «Комплект для старта» имеет `aria-current="page"`.
2. **Шапка.** Then виден `a[href="#/start"]` с текстами «ортус» и «документация»; `input[aria-label="Поиск по документам"]` с `placeholder="Поиск по всем документам"`.
3. **Группы и пункты.** Then в навигации ровно 4 подписи групп: «Старт разработки · 0.2», «Контракты», «Проектирование · 0.1», «Дизайн и прототип»; всего 36 ссылок `a[href^="#/"]`; первые ссылки каждой группы: «Комплект для старта», «OpenAPI 0.1», «Обзор комплекта 0.1», «Дизайн-система».
4. **Переход по пункту.** When клик по «10 · Модель данных». Then `location.hash === '#/data-model'`, мета-строка содержит «Старт разработки · 0.2», `docs/10-data-model.md` и ссылку «Исходный файл» с `target="_blank"`; `main.scrollTop === 0`; в article есть `h2[id^="sec-"]`.
5. **Mermaid.** Given `#/data-model`. When CDN доступен. Then внутри article появляется `svg` внутри `div` с `border:1px solid #DCE2D9`, а `code.language-mermaid` отсутствует. (Если CDN недоступен — остаётся `pre code.language-mermaid`; тест помечать как сетевой.)
6. **Внутренние ссылки.** Given `#/start`. Then ссылка/код с текстом `11-permissions.yaml` имеет `href="#/permissions"`; внешние `a[href^="http"]` имеют `target="_blank"` и `rel="noopener"`.
7. **Пейджер.** Given `#/start`. Then нет «← Назад», есть «Далее →» с «10 · Модель данных». Given `#/proto-readme`. Then «← Назад» → «Токены (CSS)», «Далее →» → «Прототип». Given `#/design-system`. Then пейджера нет.
8. **Code.** Given `#/sql-control`. Then `article h1` = «SQL · control 0001», есть `pre > code`, текст начинается с содержимого `docs/db/control_0001_init.sql`.
9. **Поиск: ввод < 2.** When ввести «п». Then `[role="listbox"]` отсутствует.
10. **Поиск: результаты.** When ввести «права» и подождать ≥ 300 мс. Then виден `[role="listbox"][aria-label="Результаты поиска"]`; первая строка соответствует `/^Найдено в \d+ документах$/`; элементов `button` 1…15; каждый содержит `strong` и `mark`; `mark` текст регистронезависимо равен «права».
11. **Поиск: пусто.** When ввести «qzqzqzqz». Then заголовок «Ничего не найдено», кнопок нет.
12. **Поиск: переход.** When клик по первому результату. Then список скрыт, `location.hash` соответствует документу, в `article` есть `mark` с фоном `#FAF1DC`, и он в видимой области `main`.
13. **OpenAPI.** Given `#/openapi`. Then `article h1` = «ORTUS CRM Constructor — Design API»; есть пиллы «OpenAPI 3.1.0» и «версия 0.1.0-design»; текст «76 путей · 118 операций · 199 схем»; есть `h2` начинающийся с «Context», «Fleet», «Схемы»; виден `input[aria-label="Фильтр операций"]`.
14. **OpenAPI: операция.** When раскрыть первый `details` в группе «Fleet». Then в `summary` пилл метода в верхнем регистре (`GET`/`POST`…), путь не начинается с `/api/v1`; в теле — подписи «operationId», «Права», «Область», «Ответы»; хотя бы один чип права моно на `#E3EFE7`.
15. **OpenAPI: фильтр.** When ввести «fleet» в фильтр и подождать ≥ 250 мс. Then текст « · найдено N операций и M схем», N > 0; `main.scrollTop` не сброшен. When ввести «qzqzqz». Then «Операций по фильтру «qzqzqz» нет.».
16. **Permissions.** Given `#/permissions`. Then `h1` «Каталог прав»; `p` содержит «Версия 0.2» и `code` «view»; `h2` «Пользователи и доступ»; `th` «Ключ», «Действие», «Уровень», «Области», «Чувствительность»; пилл «чувствительное» у `members.invite`; `h2` «Шаблоны ролей» и `strong` «Владелец бизнеса», «Менеджер логистики», «Водитель», «Прораб», «Наблюдатель»; `h2` «Переименования из прототипа» с строкой `fleet.inspections.create` → `fleet.inspections.submit`; `summary` «Показать файл».
17. **Ошибка загрузки.** Given маршрут перехвачен (`route('**/docs/16-raid-glossary.md', 404)`). When перейти `#/raid`. Then `div[role="alert"]` с текстом «Не удалось загрузить docs/16-raid-glossary.md (404)», article пуст, пейджер показан.
18. **Загрузка.** Given ответ задержан на 1 с. When перейти на новый документ. Then виден `[aria-busy="true"]` со скелетоном, затем исчезает.
19. **Неизвестный hash.** When открыть `#/nope`. Then показан «Комплект для старта» (`aria-current` на нём).
20. **TOC.** Given viewport 1440×900, `#/engineering`. Then виден `aside[aria-label="Содержание"]` с текстом «На странице» и кнопками по числу `h2,h3` (> 2); When клик по кнопке «Структура репозитория». Then `main.scrollTop > 0` и заголовок в видимой области. Given viewport 1279 ширины. Then `aside` отсутствует.
21. **Узкий экран.** Given viewport 800×900. Then `nav[aria-label="Документы"]` отсутствует; виден `button[aria-label="Разделы"][aria-expanded="false"]`. When клик. Then nav виден (`position:absolute`), `aria-expanded="true"`, виден скрим. When клик по ссылке «Контракты → OpenAPI 0.1». Then nav скрыт, маршрут сменился. When снова открыть и кликнуть скрим. Then nav скрыт.
22. **Frame: Дизайн-система.** Given `#/design-system`. Then `iframe[title="Дизайн-система"]` с `src` оканчивающимся на `Дизайн-система.dc.html` (с учётом `encodeURI`), нет `aside`, нет пейджера, контейнер страницы `display:none`. Then внутри `frameLocator`: `h1` «Токены, компоненты и состояния для всех модулей CRM», `nav[aria-label="Разделы"]` с 11 ссылками, секции `#color … #copy`, нет `.sc-logic-error`.
23. **Frame: Прототип.** Given `#/prototype`. Then внутри iframe `[role="region"][aria-label="Панель демонстрации"]`, `select` с опцией «Владелец · Дарья Зимина», `header` с «Альта Групп»-подобным тенантом и `nav[aria-label="Основная навигация"]` c пунктом «Главная» (`aria-current="page"`); нет текста «Не удалось загрузить модули прототипа».
24. **Frame: Объекты.** Given `#/objects-variants`. Then внутри iframe текст «Ремонт и стройка → Объекты: три подхода к карточке объекта».
25. **Сеть/консоль.** Then за сессию нет `console.error` с `[dc-runtime]` или `[dc] failed`; запросы к `unpkg.com/react@18.3.1` и `react-dom@18.3.1` завершились 200 (или подменены локально).

### Витрина «Дизайн-система»
26. **Кнопки.** Then в секции `#buttons` 4 строки `primary/secondary/ghost/danger`; `button[aria-busy="true"]` с текстами «Принимаем…», «Отправляем…», «Отключаем…»; `button[disabled][aria-describedby="why-1"]` и `#why-1` = «Нет фото одометра»; мобильная кнопка «Начать рейс» высотой ≥ 52px.
27. **Поля.** Then `input[aria-invalid="true"][aria-describedby="err-odo"]`, `#err-odo` = «Пробег не может быть меньше 48 210 км»; `[role="switch"][aria-checked="true"][aria-label="Логистика"]`; `[role="radiogroup"][aria-label="Уровень топлива"]` с `[role="radio"][aria-checked="true"]` текст «½».
28. **Статусы.** Then 8 пиллов «Запланирован … Принят»; `[role="progressbar"][aria-valuenow="64"]`; `[role="alert"]` «Ошибка загрузки» с кнопкой «Повторить».
29. **Баннеры.** Then 3 `[role="status"]` + 1 `[role="alert"]` («Хранилище заполнено: 5,0 из 5 ГиБ.») с кнопкой «Увеличить место».
30. **Доступ.** Then заголовки «Модуль не подключён», «Нет права», «Нет доступа к объекту»; кнопки «Перейти в «Модули и место»» и «К списку рейсов»; при `showTokens` видна строка «403 forbidden_action · fleet.trips.review».
31. **Таблица/диалог.** Then `table` с `th[scope="col"]` «Рейс | Машина | Водитель | Статус | Расходы», 3 строки; `[role="dialog"][aria-label="Отключить логистику"]` с кнопками «Отмена», «Отключить»; тост «Смена принята. Машина свободна.» с кнопкой «Открыть».
32. **Футер.** Then ссылка «Прототип» → `Ортус CRM.dc.html`.

### Токены/шрифты (для нашего пакета `@ortus/tokens`)
33. Then `getComputedStyle(document.documentElement).getPropertyValue('--ox-accent').trim() === '#1F6B52'` и все 16 цветов + 15 тоновых переменных из `tokens.css` совпадают с `tokens.json`.
34. Then `document.fonts.check("600 16px 'Golos Text'")`, `check("500 14px 'IBM Plex Mono'")`, `check("24px 'Material Symbols Rounded'")` истинны после `document.fonts.ready`.
35. Given `prefers-reduced-motion: reduce` (эмуляция). Then `--ox-motion-base === '0ms'`.

---

## 11. Открытые вопросы

1. Границы баннеров: CRM `LINE = {ok:'#BFD9C8', info:'#C9D8E8', warn:'#EBD7A8', danger:'#F0C9C3', neutral:'#DCE2D9'}` (`Ортус CRM.dc.html:2330`) ≠ `tokens.json` `tone.*.border` (`#B9D6C4/#C3D3E6/#EBD7A6/#F0C9C3/#D5DBD2`); витрина использует токены. Канон — токены?
2. `--ox-accent-tint` `#F1F7F3` (`Ортус CRM.dc.html:17`, формула `mixHex(accent,'#FFFFFF',0.93)` `:2356`) отсутствует в `tokens.json`; `brandVars` также выводит `soft = mix 0.86`, `hover = mix(black,0.18)` — для `#1F6B52` они дают не ровно `#E3EFE7`/`#185A44` (⚠ не проверено численно).
3. Высоты кнопок в CRM 36/40 px (баннер-действие, карточки модулей, профиль) не входят в шкалу 32/44/48 из `tokens.json:60–62`; размеры шрифтов 11/15/17/18/19/21/26/30 px вне шкалы `font.size`.
4. Скругления модалки `14px` и sheet `16px 16px 0 0` (`Ортус CRM.dc.html:3957`), полей читалки `10px` — вне `radius` 6/8/10/12/999 для «кнопки/поля md=8».
5. `components.md:44` для Tabs: «счётчик warn»; в CRM счётчик табов neutral (`#ECEFEA/#4C5955`, `:292`).
6. `components.md:37` требует skip-link «К содержимому» и `components.md:32` — фокус-ловушку; в прототипе и витрине их нет (⚠ не найдено в источниках).
7. Тёмная тема: нигде не определена; `support.js` знает только фон canvas-режима. Нужна ли — решить до реализации токенов.
8. Читалка: `onHash` содержит бессмысленное выражение `query: this.pendingTerm ? this.state.query : this.state.query` (`Документация.dc.html:224`); закрытие списка результатов по Esc/клику вне не реализовано; `ensureAll` скачивает ~1 МБ (включая OpenAPI 365 КБ) при первом поиске — нужен ли предсобранный индекс?
9. `showToc` требует `toc.length > 2`: короткие документы (например `docs/README.md` с 4 `h2`) показывают TOC, а `components.md` (3 `h2`) — тоже; порог сохранить?
10. Пейджер ведёт на frame-документы: с `#/session` «Далее →» = «Дизайн-система», с `#/proto-readme` «Далее →» = «Прототип» (по `ORDER`, `Документация.dc.html:169, :461`); сами frame-страницы пейджера не показывают, т.е. с них «назад» только через навигацию — желательно ли?
11. `BASENAMES['permissions.yaml']` ссылается на несуществующее имя файла (`Документация.dc.html:174`) — оставлено «на всякий случай» для ссылок из `14-engineering.md:30` (`api/permissions.yaml`).
12. `Ortus CRM.dc.html` (латинское имя, пустой `<x-dc>`) — назначение неизвестно; в хостинг не включать.
13. `Объекты - варианты.dc.html` рисует фиксированную ширину `1440px` (`:29`) — в iframe на узких экранах будет горизонтальная прокрутка; принять?
14. Весовые 700 для Golos Text грузятся, но токены заканчиваются на 600 — использовать ли 700 где-либо?
15. Хексы `#B7791F`, `#F7E9C6`, `#E0B457`, `#FFFCF4` в CRM — назначение не установлено; требуется ревизия перед заменой на токены.
16. `docs/README.md:3` ссылается на `uploads/ortus-crm-design-v0.1(1)/` — в снапшоте такой папки нет; ссылка в читалке останется «битой».

---

## 12. Факты для плана

1. Токенов: 16 базовых цветов + 5 тонов × 3 + 2 семейства + 7 размеров + 3 веса + 2 межстрочных + 8 отступов + 5 радиусов + 3 тени + 5 размеров + 2 брейкпоинта + 2 длительности + набор иконок — всё в `tokens.json` (79 строк) → генерировать `tokens.css` и TS (`14-engineering.md:45`).
2. Компонентов в контракте — 30 (`components.md:17–44`); витрина показывает ~20 из них с полными состояниями, нет Stepper/ReadinessBar/DecisionQueue/ObjectHeader/ScopeSelect/RoleEditor-полного.
3. Пакеты по регламенту: `frontend/packages/tokens`, `packages/ui` (+ Storybook), `packages/domain`, `apps/web` (`14-engineering.md:42–48`); «6 базовых компонентов в Storybook» — обязательный шаг до продуктового кода (`docs/README.md:42`).
4. Читалка — один файл 501 строка; логика ~290 строк; зависимости marked@12, js-yaml@4, mermaid@11; переписать в React+TS реалистично за одну итерацию, рендереры `perm`/`api` — чистые функции над YAML, тестируются unit-тестами на реальных файлах.
5. Контент читалки: 36 записей `DOCS`, 32 файла в `docs/` (~1,0 МБ), OpenAPI 11 690 строк / 76 путей / 118 операций / 199 схем / 18 тегов; единственная mermaid-диаграмма в `10-data-model.md`.
6. Три frame-страницы + `Ремонт и стройка.dc.html` + `support.js` (69 КБ) + `ortus/*.js` должны лежать в одной папке с сохранением относительных путей и кириллических имён.
7. `support.js` требует: React 18.3.1 UMD с unpkg (SRI) либо `window.__resources`/предзагруженный React; `'unsafe-eval'` и `'unsafe-inline'` в CSP; HTTP с правильными MIME для ES-модулей.
8. Шрифты: Golos Text 400/500/600/700, IBM Plex Mono 400/500, Material Symbols Rounded variable (`opsz 24, wght 400, FILL 0..1, GRAD 0`) — все с Google Fonts, `display=swap`/`display=block`.
9. Брейкпоинты различаются: приложение 640/1080, читалка 960/1280 — e2e нужно гонять минимум на 390, 800, 1280, 1440.
10. Тайминги для тестов: поиск 220 мс, фильтр API 200 мс, `waitFor` библиотек до 10 с, тост CRM 4200 мс, mock-загрузка персонажа 320 мс (`Ортус CRM.dc.html:2470`).
11. Все md-стили — инлайн через `decorate()`; при переносе на CSS-классы сохранить значения `S` 1:1 (таблица §6.7).
12. Ссылочная механика читалки (basename → `#/id`) и внешние ссылки `_blank/noopener` — часть контракта, покрыть тестами.
13. Поиск — клиентский, по сырому тексту всех документов; альтернатива с индексом сборки должна сохранять UX: ≥ 2 символа, «Найдено в N документах», «N совп.», сниппет с `<mark>`, подсветка после перехода.
14. Frame-страницы: внутри iframe нет связи с роутером читалки; `title` iframe = заголовок документа; высота 100 % `main`.
15. Витрина «Дизайн-система» — лучший источник для визуальных регрессионных снимков (Playwright `toHaveScreenshot`) по секциям `#buttons`, `#fields`, `#status`, `#access`, `#data`.
16. Расхождения CRM с токенами (§11.1–11.4) надо закрыть решением до написания `@ortus/ui`, иначе Storybook и прототип разойдутся.
17. Prefer-reduced-motion и `:focus-visible` реализованы в `tokens.css` — подключать его глобально во всех приложениях, включая читалку.
18. Playwright-ожидания для DC-страниц: `#dc-root .sc-host` присутствует, `.sc-logic-error` отсутствует, консоль без `[dc-runtime]`.
19. Для офлайн-CI: вендорить React UMD + `__resources`, локальные marked/js-yaml/mermaid, `@font-face` вместо Google Fonts; иначе e2e на фреймы зависят от трёх внешних CDN.
20. Тёмной темы нет — не планировать в первой итерации; если вводить, нужны новые токены (нет в источниках).
