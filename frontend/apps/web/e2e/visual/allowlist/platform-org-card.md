# Allowlist `platform-org-card` (W1.25)

Сверка карточки организации оператора (`/platform/tenants?org=<tenantId>`, `<aside>` pg.tenants :1554–1580) и диалогов
`opConfirm` (:2176–2201) со снимком `design-stage-1`. Формат и поле `decision` — как в `platform-orgs.md`.

## Данные, которых нет в контракте оператора этапа 1 (W4.60, W4.61)

- kind: out-of-stage · target: dd:Владелец, dd:Модули, dd:Участники → «—» · mode: both · reason: владельца, подключённых модулей и числа участников в Tenant и Subscription нет (этап 4: пользователи и использование — W4.60/W4.61); эталон приводится · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: dd:Место, .ox-org-seats — «— из {квота} ГБ», «— из {лимит}» · mode: both · reason: занятое место и занятые места — этап 4; квота и лимит — права подписки; эталон приводится · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: label:Квота места100 ГБ25 ГБ · меньше занятого50 ГБ100 ГБ250 ГБ500 ГБ · mode: both · reason: «Квота места» и «Применить» — updatePlatformSubscription (причина и ручное право со сроком, в эталоне их нет) до W4.60 (screens.yaml platform-tenants); эталон приводится (блок убран) · decision: PD-50, Q-W1.25-2 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: button:Применить · mode: both · reason: пара предыдущей записи · decision: PD-50, Q-W1.25-2 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: dd:Тариф — срок подписки («12 мес», «помесячно») · mode: both · reason: срока подписки в Subscription нет: оплаченная — ««Команда» · цены vN»; пробная совпадает с эталоном · decision: PD-50, Q-W1.25-10 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: dd:Оплата — сумма « · 6 800 ₽/мес» · mode: both · reason: прайс и срок — этап 4 (W4.60); показывается «Оплачено до ДД.ММ.ГГГГ» · decision: PD-50, Q-W1.25-10 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: text:Заявка SR-12: переход на «Бизнес» от 29.09 16:40 · mode: both · reason: заявки на тариф — страница и контракт этапа 4 (W4.60/W4.61); плашки «Открыть заявку» у «SPA «Лотос»» нет · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: button:Открыть заявку · mode: both · reason: пара предыдущей записи · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4
- kind: label · target: dd:Тариф «цены v2» у оплаченных организаций в mock · mode: mock · reason: проекция сида MSW (adapter core/project.ts) пишет sourceRef прав с текущей версией прайса v2 для всех организаций; эталон: «цены v1» у «Лотоса», «Ремстроя», «Карго» · decision: PD-43, Q-W1.25-10 · owner: W1.25

## Расхождения режимов mock и stand

- kind: label · target: dd:Пробный период «Завершён —» у «Ремстрой Плюс» · mode: stand · reason: хранение подписок W1.08 (control/subscriptions store.go current) отдаёт trialEndsAt только у trialing: у read_only после пробного периода даты конца нет; MSW отдаёт «Завершён 20.09.2026» как эталон. Вопрос владельцу W1.08 — отдавать конец пробного периода у read_only и grace после trial · decision: PD-22, Q-W1.25-14 · owner: W1.25
- kind: label · target: dd:Оплата «—» у «Карго Сити» · mode: stand · reason: сид стенда хранит «Карго Сити» как grace без конца периода (Q-W1.08-11): periodEndsAt нет, «Оплачено до 15.09.2026» не из чего собрать; MSW (past_due) отдаёт periodEndsAt · decision: PD-22, Q-W1.08-11 · owner: W1.25

## Поведение по контракту 0.4.0-stage1 (Q-W1.00-1…6)

- kind: state · target: button:Продлить пробный период на 14 дней — у оплаченных организаций · mode: both · reason: эталон показывает кнопку всегда; продление — только trialing и grace/read_only после пробного периода, оплаченная — 409 (Q-W1.00-6, 04 §9 п. 4): у «SPA «Лотос»» и «Карго Сити» кнопки нет · decision: PD-22, Q-W1.25-5 · owner: W1.25
- kind: state · target: button:Снять ограничение — у «Ремстрой Плюс» · mode: both · reason: эталон: «Ограничен» (restricted) снимается оператором; по контракту read_only — состояние подписки, снять его resume нельзя (409), у «Ремстроя» — «Ограничить новые операции» (Q-W1.00-2) · decision: PD-22, Q-W1.25-5 · owner: W1.25
- kind: state · target: chip:Приостановлен после «Ограничить» · mode: both · reason: эталон ставит «Ограничен»; команда переводит в suspended — «Приостановлен» (Q-W1.00-2); «Снять ограничение» возвращает состояние подписки, у «Карго Сити» — «Ограничен» (grace), а не «Действует» (Q-W1.00-3) · decision: PD-22, Q-W1.25-4 · owner: W1.25
- kind: label · target: text:Альта Групп: статус «Приостановлен» · mode: both · reason: строка журнала по action tenant.suspended (эталон: «статус «Ограничен»»); автор — сокращение displayName «Е. Лаптева» вместо «Оператор (демо)» · decision: PD-22, Q-W1.25-6 · owner: W1.25

## Состояния карточки без эталона (verification-protocol §1.3)

- kind: no-reference · target: dd[data-loading], .ox-org-seats[data-loading] — скелетон значений подписки, aside aria-busy, status:Загрузка · mode: both · reason: эталон берёт данные синхронно и загрузки карточки не рисует; пока подписка загружается, значения из неё — «—» под пульсирующей подложкой (без ложного «без ограничения»), статус «Загрузка» — для чтения с экрана · decision: PD-22, Q-W1.25-17 · owner: W1.25
- kind: no-reference · target: alert:Не удалось загрузить подписку: {ошибка} · mode: both · reason: ошибки getPlatformSubscription в эталоне нет; alert в карточке с текстом по коду и «Повторить» (перечитывает подписки всех строк с ошибкой); значения подписки — «—», продления нет · decision: PD-22, Q-W1.25-17 · owner: W1.25
- kind: no-reference · target: alert:Не удалось загрузить организацию: {ошибка} · mode: both · reason: ошибки getPlatformTenant в эталоне нет; без ETag организации «Ограничить новые операции» и «Снять ограничение» недоступны — alert объясняет почему, «Повторить» перечитывает организацию · decision: PD-22, Q-W1.25-17 · owner: W1.25
- kind: no-reference · target: alert:Не удалось загрузить журнал: {ошибка} · mode: both · reason: ошибки listPlatformAuditEvents в эталоне нет; alert под «Журнал действий» с «Повторить», чтобы сбой не выглядел как пустой журнал · decision: PD-22, Q-W1.25-17 · owner: W1.25
- kind: no-reference · target: text:Действий пока нет · mode: both · reason: пустого журнала в эталоне нет (в сиде всегда есть строки); текст пустого состояния · decision: PD-22, Q-W1.25-17 · owner: W1.25
- kind: label · target: button:Повторить — в alert карточки · mode: both · reason: кнопка ошибок загрузки карточки без эталона (три предыдущие записи), подпись — как у ошибки списка · decision: PD-22, Q-W1.25-17 · owner: W1.25

## Диалог команды с причиной (S1-04)

- kind: no-reference · target: label:Причина · mode: both · reason: поля «Причина» в диалогах эталона нет (design-requests «platform-tenants · поле «Причина»»); обязательно 5–500 символов (Q-W1.00-1), подсказка «От 5 до 500 символов», без причины действие недоступно · decision: PD-22, Q-W1.25-3 · owner: W1.25
- kind: no-reference · target: button:Выполняем… — кнопка действия во время запроса: progress_activity, aria-busy, aria-disabled · mode: both · reason: состояния «команда выполняется» в эталоне нет; кнопка занята (RAC isPending), а не disabled — фокус остаётся в диалоге, чтение с экрана не теряет его до ответа · decision: PD-22, Q-W1.25-22 · owner: W1.25
- kind: no-reference · target: text:Не больше 500 символов · mode: both · reason: причина длиннее 500 символов — ошибка под полем (aria-invalid), действие недоступно; ввод не обрезается, чтобы вставленный текст не терялся молча · decision: PD-22, Q-W1.25-18 · owner: W1.25
- kind: pixel · target: dialog — круг admin_panel_settings слева от заголовка, линия над кнопками, внутренний отступ шапки 20 px против 22 px opConfirm, промежуток от заголовка до текста больше эталонного примерно на 6 px · mode: both · reason: диалог собран на @ortus/ui Dialog: у ConfirmDialog нет слота для поля (запрос W1.21 — children), шапка и её отступы — Dialog, а не opConfirm; заголовок, текст, «Последствия» и кнопки — дословно эталон; «Последствия» сверяются попиксельно с приведением ширины и дробной части положения секции (platform-orgs.visual.spec.ts) · decision: PD-22, Q-W1.25-3 · owner: W1.25
- kind: label · target: text:Причина: {причина} · mode: both · reason: причина действия второй строкой записи «Журнала действий» (design-requests «строка журнала с причиной»); у строк сида причины нет — совпадают с эталоном · decision: PD-22, Q-W1.25-6 · owner: W1.25
