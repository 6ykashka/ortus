# Allowlist `platform-requests` (W4.61)

Сверка «Заявок на изменение тарифа» оператора (`/platform/requests`) со снимком `design-2026-10-19` (`Ортус CRM.dc.html`
pg.requests :945–985). Сравнивается область `#ox-main` на высоком окне и диалоги opConfirm; шапка и меню — `shell`
(W1.20). Формат — `frontend/packages/e2e-kit/src/allowlist.ts`. Записи с пометкой «эталон приводится» выполняет
`e2e/visual/platform-requests.visual.spec.ts` до снимка.

## Данные и расчёт

- kind: label · target: .ox-rq-price — цена заявки и сумма за период в диалоге подтверждения · mode: both · reason: расчёт фиксируется на момент заявки по её версии сетки (quote, priceVersion): SR-12 подана 29.09 по v1 — 11 920 ₽ в месяц · 143 040 ₽ за период, SR-9 — 8 075 ₽ · 32 300 ₽; эталон считает по текущей v2 (12 720 ₽, 8 455 ₽); эталон приводится · decision: PD-22, Q-W4.07-2 · owner: W4.61
- kind: label · target: .ox-rq-decision — автор решения новой заявки · mode: mock · reason: решение текущего оператора подписано сокращённым именем аккаунта («Е. Лаптева»), эталон — «Оператор (демо)» · decision: PD-54, Q-W4.61-6 · owner: W4.61
- kind: state · target: ?status=all — фильтр «Все заявки» в адресе · mode: both · reason: выбранный фильтр сохраняется в адресе страницы (ADR-0001), в эталоне — состояние rqFilter; по умолчанию «На рассмотрении», как эталон · decision: PD-22, Q-W4.61-8 · owner: W4.61

## Состояния без эталона

- kind: no-reference · target: .ox-pk-skeleton — status:Загрузка · mode: both · reason: загрузки страницы в эталоне нет; под показанной шапкой — скелетон двух блоков без текста · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: alert:Не удалось загрузить заявки: {ошибка} · mode: both · reason: ошибка чтения очереди — текст по коду и «Повторить» · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: label · target: button:Повторить · mode: both · reason: кнопка ошибки загрузки без эталона · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: text:Нет права на заявки на тариф… · mode: both · reason: роли операторов (Q-W4.07-14): поддержка не видит очередь (403) — текст раздела вместо очереди, бейджа меню нет; в эталоне роли действия не ограничивают · decision: PD-22, Q-W4.07-14 · owner: W4.61
