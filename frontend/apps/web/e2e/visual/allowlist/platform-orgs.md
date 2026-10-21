# Allowlist `platform-orgs` (W1.25)

Сверка «Организации-клиенты» оператора (`/platform/tenants`) со снимком `design-stage-1` (`Ортус CRM.dc.html` pg.tenants
:1529–1583). Сравнивается область `#ox-main`; шапка и меню — `shell` (W1.20). Формат — `frontend/packages/e2e-kit/src/allowlist.ts`.

Поле `decision`: сначала решение из `docs/plan/decisions.md` (его требует формат), затем вопрос исполнителя `Q-W1.25-N`
(отчёт W1.25, до внесения интегратором — значение по умолчанию; бриф W1.25 §10). Для `out-of-stage` это PD-50 (вид
записи «позже этапа», план v2 §3.7), для отличий и состояний без эталона — PD-22; суть решения — в `Q-W1.25-N`.
Записи `out-of-stage` с пометкой «эталон приводится» выполняет `e2e/visual/platform-orgs.compare.ts` до снимка и сбора
подписей.

## Данные, которых нет в контракте оператора этапа 1 (W4.60, W4.61)

- kind: out-of-stage · target: .ox-org-owner — «Владелец: {имя} · мест {занято}/{лимит}» → «Владелец: — · мест —/{лимит}» · mode: both · reason: имени владельца и занятых мест в Tenant и Subscription нет (listPlatformUsers и места — W4.60/W4.61, этап 4); лимит мест — право seats подписки; эталон приводится · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: .ox-org-usage — «{занято} из {квота} ГБ» → «— из {квота} ГБ» · mode: both · reason: занятое место организации оператору не отдаётся (использование — W4.60); квота — право storage_quota_bytes; эталон приводится · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4
- kind: out-of-stage · target: .ox-orgs-bar-fill — заливка полос места и мест · mode: both · reason: без занятого места и мест полоса показывает только подложку; эталон приводится (ширина заливки 0) · decision: PD-50, Q-W1.25-1 · owner: W1.25 · expires: stage-4

## Расхождения режимов mock и stand

- kind: label · target: .ox-org-trial «Завершён —» у «Ремстрой Плюс» · mode: stand · reason: у read_only после пробного периода стенд не отдаёт trialEndsAt (control/subscriptions W1.08); MSW и эталон — «Завершён 20.09.2026» · decision: PD-22, Q-W1.25-14 · owner: W1.25

## Состояния без эталона

- kind: no-reference · target: text:Организаций пока нет · mode: both · reason: пустого списка в эталоне нет (04 §5.1 «Состояния»); текст — бриф W1.25 §10 п. 8 · decision: PD-22, Q-W1.25-8 · owner: W1.25
- kind: no-reference · target: alert:Не удалось загрузить организации: {ошибка} · mode: both · reason: ошибка загрузки страницы в эталоне — только общая (:191–193); у страницы своя с кнопкой «Повторить» · decision: PD-22, Q-W1.25-8 · owner: W1.25
- kind: label · target: button:Повторить · mode: both · reason: кнопка ошибки загрузки без эталона (предыдущая запись) · decision: PD-22, Q-W1.25-8 · owner: W1.25
- kind: no-reference · target: .ox-orgs-skeleton — скелетон четырёх строк в рамке списка, status:Загрузка · mode: both · reason: загрузки страницы в эталоне нет (04 §4.6 — только общая); под уже показанными заголовком и баннером — скелетон строк списка без текста, а не скелетон оболочки «Загружаем рабочее пространство…» · decision: PD-22, Q-W1.25-21 · owner: W1.25
- kind: no-reference · target: .ox-org-row [data-loading] — скелетон владельца и мест, места и пробного периода строки · mode: both · reason: эталон берёт подписки синхронно и загрузки строки не рисует; пока getPlatformSubscription строки не ответил, колонки из подписки — «—» под пульсирующей подложкой (без пульса при prefers-reduced-motion), чтобы загрузка не выглядела как данные этапа 4 · decision: PD-22, Q-W1.25-23 · owner: W1.25
- kind: no-reference · target: text:Подписка не загружена · mode: both · reason: ошибки getPlatformSubscription в эталоне нет; в колонке пробного периода строки вместо «—» (цвет warn), чтобы сбой не выглядел как данные этапа 4; «Повторить» — в alert карточки выбранной организации · decision: PD-22, Q-W1.25-20 · owner: W1.25
- kind: state · target: data-screen-label:Оператор · организации · mode: both · reason: у pg.tenants эталона атрибута нет; схема PD-37, значение Q-W0.14-3 (screenLabels.byPage.tenants); атрибут невидим · decision: PD-22, Q-W0.14-3 · owner: W1.25
