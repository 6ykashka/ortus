# Allowlist `tasks-projects` (W4.12)

Сверка списка «Проекты» со снимком `design-2026-10-19` («Задачи и проекты.dc.html» ЗП:24–47, подключён dc-import на
pg.tasks «Ортус CRM.dc.html»:1596), владелец «Альты», часы харнесса 01.10.2026 10:30. Снимок — область модуля, шапку и
меню сверяет ключ `shell`. Поле `decision` — решение журнала, затем `Q-W4.12-N` отчёта W4.12.

## Данные

- kind: out-of-stage · target: button:ДОК Документы · маршруты Дарья Зимина · процесс v1 Вся организация Ограниченный 0 0 · mode: both · reason: проект «ДОК · Документы · маршруты» эталона — сид модуля «Документы» (documents.js:520, маршруты документов через задачи W7.22); в сиде этапа 4 его нет, на сверке строка эталона убирается · decision: PD-60, Q-W4.00-tasks-1 · owner: W4.12 · expires: stage-7
- kind: state · target: .ox-tk-prow · mode: both · reason: в списке только проекты с доступом участника (projAccess ≠ null, PD-60) — эталон показывает все проекты без процесса и воронки (:352); закрытый проект без роли в нём не виден и владельцу (TP-03) · decision: PD-60, Q-W4.10-6 · owner: W4.12
- kind: state · target: .ox-tk-empty · mode: both · reason: прорабу (задачи только в области «своё») сервер отвечает 403 на listTaskProjects — страница показывает пустой список «Проектов, доступных вам, пока нет», как эталон · decision: PD-60, Q-W4.03-8 · owner: W4.12
- kind: state · target: button:Новый проект · mode: both · reason: «Новый проект» — только с tasks.projects.manage в организации или подразделении; у логиста (роль «Руководитель проекта» с областью «проект») кнопки нет, эталон её показывает (M.can без области, :358) · decision: PD-53, Q-W4.10-5 · owner: W4.12
- kind: state · target: .ox-tk-punit · mode: both · reason: «Область» без права org_units.read (логист, водитель — роли проекта) — «—»: в Project контракта 0.10 только orgUnitId, эталон пишет название (uName); orgUnitName ответа проекта страница покажет, когда стюард добавит поле · decision: PD-60, Q-W4.12-10 · owner: W4.12
- kind: state · target: .ox-tk-table · mode: both · reason: пустой список (прораб) — у таблицы role=region «Таблица проектов» и tabindex=0 (data-a11y-extra): на 390 шапка 620 px прокручивается, а фокусируемых строк нет (axe scrollable-region-focusable); вид не меняется · decision: D-29, PD-28 · owner: W4.12

## Поведение без эталона

- kind: state · target: .ox-tk-skel · mode: both · reason: загрузка списка — полосы-скелетон (role=status «Загрузка»); эталон пишет «Загружаем проекты…» только до загрузки models.js (:22), данных он не ждёт · decision: Q-70 · owner: W4.12
- kind: label · target: button:Повторить · mode: both · reason: ошибка загрузки — alert «Не удалось загрузить данные: …» и «Повторить» (общий LoadFailed страниц ядра W1.24); состояния ошибки в эталоне нет · decision: Q-70 · owner: W4.12
