# Allowlist `forms-responses` (W4.23)

Сверка вкладки «Ответы» — сводка, лента, таблица (dc:411–439) формы «Осмотр машины» со снимком `design-2026-10-19` (`Ортус CRM.dc.html` → пункт меню
«Формы и опросы», модуль «Формы и опросы.dc.html»), владелец «Альты». Снимок — область модуля (шапку и меню сверяет ключ
`shell`). Поле `decision` — решение журнала, затем `Q-W4.23-N` отчёта W4.23.

## Данные и контракт

- kind: state · target: .ox-fr-journal · mode: both · reason: «Журнал действий» — строки FormResponse.actions; эталон добавляет первой строку задачи из db.tasks по source («Задача T-61 «Проверить осмотр Р-196» · Марина Котова · Готово», dc:909), у ответа R-1012 сида строки задачи в журнале нет; на сверке строка эталона убирается; эталон верен, расходится сид MSW W4.05 · decision: PD-22, Q-W4.23-3 · owner: W4.23
- kind: state · target: .ox-fr-resp-row · mode: both · reason: значения ответов — подписи по структуре версии ответа из значений контракта (ключи вариантов, decimal, boolean, files — «N фото»): «84 210» с неразрывным пробелом группы разрядов, «да / нет» строчными, как в эталоне · decision: PD-60, Q-W4.00-forms-3 · owner: W4.23
- kind: no-reference · target: button:Принять · mode: both · reason: ответ на проверке (reviewStatus pending) — «Принять» и «Отклонить» в карточке ленты при FormResponse.my.review (reviewFormResponse), тосты «Ответ R-… принят / отклонён»; статусы «На проверке», «Отклонён»; в эталоне только статус · decision: B-6, Q-W4.00-forms-18, Q-W4.23-2 · owner: W4.23
- kind: state · target: .ox-fr-feed · mode: both · reason: выбранный ответ ленты — в адресе `&resp=` (переход из задачи и «Данных», dc:530–537); ссылка с `&resp=` открывает «Ленту» · decision: PD-60, ADR-0001 · owner: W4.23

## Поведение

- kind: state · target: .ox-fr-table · mode: both · reason: таблица ответов и пример строки «в БЗ» прокручиваются с клавиатуры (tabindex=0, axe scrollable-region-focusable serious) · decision: PD-28 · owner: W4.23
- kind: state · target: .ox-fr-pending · mode: both · reason: сводка — отдельный запрос (getFormResponseSummary): загрузка — role=status «Загрузка», ошибка — LoadFailed с «Повторить»; «Выгрузить CSV» — exportFormResponses (файл сервера), нет связи — тост оболочки; эталон считает всё на клиенте · decision: Q-70, PD-31 · owner: W4.23

## Цели нажатия

- kind: pixel · target: .ox-fr-seg · mode: both · reason: на телефоне сегменты «Сводка / Лента / Таблица», строки ленты и кнопки журнала — не ниже 44 px по правилу модуля W4.22 (forms.css, @media max-width 639px); на сверке 390 те же размеры ставятся эталону (PHONE_PARITY, как forms.visual.spec W4.22) · decision: PD-28 · owner: W4.23

## Оболочка W4.22

- kind: label · target: h1:Осмотр машины · mode: both · reason: у редактора W4.22 h1 с названием формы, скрыт визуально (название — поле ввода, как у эталона dc:85–90; без h1 — axe page-has-heading-one); снимок вкладки — область модуля с шапкой W4.22 · decision: PD-28 · owner: W4.22

## Заголовок панели W4.23

- kind: label · target: h2:Ответы · mode: both · reason: панель вкладки начинается с h2 с названием вкладки, скрытого визуально (только для AT): после h1 редактора W4.22 заголовки карточек вкладки (h3, как в эталоне) идут без пропуска уровня — axe heading-order; в эталоне h2 нет · decision: PD-28 · owner: W4.23
