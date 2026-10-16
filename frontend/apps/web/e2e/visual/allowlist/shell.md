# Allowlist `shell` (W1.20)

Сверка оболочки со снимком `design-stage-1` (`Ортус CRM.dc.html`). Формат — `frontend/packages/e2e-kit/src/allowlist.ts`.
Содержимое страниц (`#ox-main`) закрыто маской: «Главная» — W2.25, «Организации» — W1.25.

Поле `decision`: сначала решение, которое уже есть в `docs/plan/decisions.md` (его требует формат `allowlist.ts`),
затем собственный вопрос исполнителя `Q-W1.20-N` из отчёта W1.20 (до внесения интегратором — значение по умолчанию).
`PD-22` в паре с `Q-W1.20-N` — только правило «отличие — в allowlist с причиной»; предметное основание — сам вопрос.

## Подписи и данные

- kind: label · target: aria:Уведомления: 2 новых · mode: mock · reason: у владельца в сиде MSW есть непрочитанные входящие из примеров контракта listMyNotifications; эталон стартует без событий · decision: PD-43 · owner: W1.20
- kind: label · target: aria:Уведомления · mode: mock · reason: пара предыдущей записи — подпись эталона без непрочитанных · decision: PD-43 · owner: W1.20

## Будущие этапы

- kind: out-of-stage · target: button:Чаты 5 · mode: mock · reason: бейдж непрочитанных чатов — модуль «Чаты» (W7.13); механизм бейджей есть, данных нет · decision: PD-55 · owner: W1.20 · expires: stage-7
- kind: out-of-stage · target: button:Обращения 4 · mode: mock · reason: бейдж обращений с SLA первого ответа — модуль «Обращения» (W7.32) · decision: PD-55 · owner: W1.20 · expires: stage-7
- kind: out-of-stage · target: button:Документы 2 · mode: mock · reason: бейдж ожиданий документов — модуль «Документы» (W7.25) · decision: PD-55 · owner: W1.20 · expires: stage-7
- kind: out-of-stage · target: button:Касса 4 · mode: mock · reason: бейдж кассы — модуль «Касса» (W5.32, W5.33); «Подотчёт» водителя и прораба — пункт профиля рабочего места, «Касса» массажиста — по праву cash.* (W1.49, shell-therapist.md); страница — заглушка до этапа 5 · decision: PD-55 · owner: W1.20 · expires: stage-5
- kind: out-of-stage · target: button:Заявки на тариф 1 · mode: mock · reason: бейдж заявок на тариф — страница оператора «Заявки на тариф» (W4.61) · decision: PD-55 · owner: W1.20 · expires: stage-4

## Пиксели (в допуске 0,01)

- kind: pixel · target: nav[aria-label="Основная навигация"] .ox-nav-title · mode: both · reason: заголовки групп меню цветом --ox-text-muted вместо #6B7873 эталона — контраст 4,3:1 < 4,5:1 (axe serious); цвет без токена, решение W1.21 — заголовки групп --ox-text-muted · decision: PD-28, Q-W1.21-1 · owner: W1.20
- kind: pixel · target: header .ox-bell-count · mode: mock · reason: счётчик непрочитанных владельца (данные примеров контракта, см. выше) · decision: PD-43 · owner: W1.20
- kind: pixel · target: .ox-popover[data-kind="notifications"] .ox-inbox-item · mode: mock · reason: события входящих владельца — примеры контракта listMyNotifications (эталон стартует без событий); граница строки — #F0F2EE эталона (:129, алиас --ox-shell-row-line) · decision: PD-43 · owner: W1.20

## Состояния без эталона и без демо-панели

- kind: state · target: button:Демо: продлить как оператор · mode: both · reason: кнопки «Демо: …» не переносятся; баннер «Пробный период завершён.» без действия · decision: PD-54 · owner: W1.20
- kind: state · target: button:Выйти · недоступно в демо · mode: both · reason: в продукте выход работает — «Выйти» (logout BFF) · decision: PD-54 · owner: W1.20
- kind: label · target: aria:Альта Групп — сменить бизнес · mode: both · reason: подпись переключателя бизнеса (no-reference, следующая запись) в структурной сверке массажиста с двумя организациями · decision: B-6 · owner: W1.20
- kind: no-reference · target: aria:Альта Групп — сменить бизнес · mode: both · reason: переключателя бизнеса нет в прототипе (S1-07, B-6); при одной организации шапка как в эталоне; доступное имя начинается с видимого названия (WCAG 2.5.3) · decision: B-6 · owner: W1.20
- kind: no-reference · target: h1:Страница не найдена · mode: both · reason: неизвестный маршрут и чужая организация — 404 (ADR-0001), в прототипе маршрутов нет; внутри оболочки — с меню, вне оболочки — карточка со ссылкой «На стартовую страницу» · decision: PD-25 · owner: W1.20
- kind: no-reference · target: link:На стартовую страницу · mode: both · reason: выход из 404 вне оболочки (чужая организация, неизвестный путь) на «/» — стартовая страница по ADR-0001 · decision: PD-25 · owner: W1.20
- kind: state · target: header .ox-org-scope · mode: both · reason: область водителя «Мои назначения» вместо «Москва / Север Логистик · мои назначения»: у водителя нет права org_units.read, названий подразделений в /me/context нет; подпись без эталона · decision: PD-22, Q-W1.20-6 · owner: W1.20
- kind: label · target: title:Ортус — CRM, прототип итерации 1 · mode: both · reason: заголовок документа «Ортус CRM» — index.html каркаса W0.09 (вне владения W1.20); «прототип итерации 1» — подпись демонстрационного прототипа · decision: PD-22, Q-W1.20-9 · owner: W1.20

## Оформление организации

-

## Поповер «Профиль» (:136–145, shellVM :3047–3048)

- kind: label · target: dialog:Профиль › Владелец · d.zimina@alta.example · mode: both · reason: вторая строка владельца — организация: должности и почты в MeContext нет · decision: PD-22, Q-W1.20-5 · owner: W1.20
- kind: label · target: dialog:Профиль › Назначения (сотрудники с ролью) · mode: both · reason: у водителя, массажиста, прораба нет раздела «Назначения» (эталон: «Водитель · Москва / Север Логистик · через группа «Водители Север»», «… · Только назначенное лично»): названий ролей, областей и групп в /me/context нет, операции «мои назначения» нет; «Ролей нет — доступ к модулям не выдан» — по назначениям организации (логист) · decision: PD-22, Q-W1.20-5 · owner: W1.20
- kind: label · target: dialog:Профиль › Е. Лаптева · mode: both · reason: имя оператора — displayName из /me/context («Евгения Лаптева»); в эталоне сокращение зашито в шаблон · decision: PD-27, Q-W1.20-5 · owner: W1.20
- kind: out-of-stage · target: --ox-accent «Лотоса» · mode: mock · reason: оформление организации (акцент, короткое имя) — этап 4 (W4.62); до него акцент по умолчанию #1F6B52 · decision: PD-55 · owner: W1.20 · expires: stage-4
