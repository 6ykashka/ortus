# Allowlist `platform-pricing` (W4.61)

Сверка «Тарифной сетки» оператора (`/platform/plans`) со снимком `design-2026-10-19` (`Ортус CRM.dc.html` pg.plans
:1161–1252). Сравнивается область `#ox-main` на высоком окне в просмотре, черновике и с запланированной версией, и
диалоги opConfirm; шапка и меню — `shell` (W1.20). Формат — `frontend/packages/e2e-kit/src/allowlist.ts`. Записи с
пометкой «эталон приводится» выполняет `e2e/visual/platform-pricing.visual.spec.ts` до снимка.

## Данные и поведение

- kind: label · target: .ox-pb-version-line — автор новой версии · mode: mock · reason: версию публикует текущий оператор — подпись сокращённым именем аккаунта («Е. Лаптева»), эталон — «Оператор (демо)»; эталон приводится · decision: PD-54, Q-W4.61-6 · owner: W4.61
- kind: state · target: button:Подготовить версию v4 — номер после отмены запланированной · mode: both · reason: отменённая версия остаётся в журнале (cancelPriceBookVersion, Q-W4.07-12), её номер занят: после отмены v3 следующая — v4; эталон удаляет версию и снова предлагает v3 · decision: PD-22, Q-W4.07-12 · owner: W4.61
- kind: state · target: select:Начнёт действовать — даты · mode: both · reason: первые числа трёх следующих месяцев по Москве от текущей даты (эталон — постоянные 01.11.2026, 01.12.2026, 01.01.2027 для демо-даты 01.10.2026; на часах e2e совпадают) · decision: PD-22, Q-W4.61-9 · owner: W4.61
- kind: state · target: .ox-pb-add::after, .ox-pb-remove::after, .ox-pb-unl::after на 390 · mode: both · reason: на телефоне (контейнер ox-frame < 640) область нажатия «Добавить тариф» (40 px эталона), «Удалить» и «Без лимита» (32 px) расширена до 44 px прозрачным псевдоэлементом; вид как в эталоне (verification-protocol §1 п. 3) · decision: PD-28, Q-W1.24-21 · owner: W4.61
- kind: state · target: size:поля черновика на 390 — название 36 px, места 32 px, цена 36 px, скидка за срок 32 px · mode: both · reason: размеры полей — как эталон pg.plans :1176–1229 (сверка черновика на 390 — 0,00056); 44 px не даны: поля названия и мест стоят в столбец с промежутком 6 px, расширенные области соседних полей перекрылись бы, а увеличение полей меняет вид таблицы. Черновик сетки — инструмент оператора на широком экране, на 390 таблица прокручивается в своей рамке. Решает владелец продукта · decision: PD-28, Q-W4.61-16 · owner: W4.61
- kind: state · target: .ox-pb-table-wrap tabindex=0 · mode: both · reason: таблица на узком экране прокручивается в своей рамке; без доступного с клавиатуры элемента рамка недоступна (axe scrollable-region-focusable, serious) — рамке дан tabindex, вид не меняется · decision: PD-29 · owner: W4.61

## Состояния без эталона

- kind: no-reference · target: .ox-pk-skeleton — status:Загрузка · mode: both · reason: загрузки страницы в эталоне нет; под шапкой и плашкой — скелетон трёх блоков без текста · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: alert:Не удалось загрузить тарифную сетку: {ошибка} · mode: both · reason: ошибка чтения версий — текст по коду и «Повторить» · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: label · target: button:Повторить · mode: both · reason: кнопка ошибки загрузки без эталона · decision: PD-22, Q-W4.61-7 · owner: W4.61
- kind: no-reference · target: text:Нет права на тарифную сетку… · mode: both · reason: роли операторов (Q-W4.07-14): поддержка не видит сетку (403) — текст раздела; в эталоне роли действия не ограничивают · decision: PD-22, Q-W4.07-14 · owner: W4.61
