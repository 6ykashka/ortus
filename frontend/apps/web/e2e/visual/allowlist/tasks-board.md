# Allowlist `tasks-board` (W4.12)

Сверка доски проекта LOG со снимком `design-2026-10-19` («Задачи и проекты.dc.html» ЗП:75–142, :375–413), владелец
«Альты». Снимок — область модуля (шапку и меню сверяет ключ `shell`). Поле `decision` — решение журнала, затем `Q-W4.12-N` отчёта W4.12.

## Поведение без эталона

- kind: no-reference · target: tab:Список · mode: both · reason: вкладка «Список» (Р-24) — строки задач по разметке старой доски «Ортус CRM.dc.html»:1650–1663 (номер, тема, статус, исполнитель, приоритет, срок; «Задач нет»), в основном файле её нет, в макете 1d — есть (ЗВ:382); на сверке вкладка скрывается · decision: B-6, Q-W4.00-tasks-14, Q-W4.12-1 · owner: W4.12
- kind: label · target: tab:Список · mode: both · reason: подпись вкладки «Список» (макет 1d «Задачи - варианты.dc.html»:382) · decision: PD-60, Q-W4.00-tasks-14 · owner: W4.12
- kind: state · target: .ox-tk-tabpanel · mode: both · reason: вкладки «Участники», «Процесс», «Автоматизация» — ProjectSettingsTab W4.13 (`settings/index.ts`, подключается по glob); до её вливания панель вкладки пустая · decision: PD-60, Q-W4.12-2 · owner: W4.12
- kind: state · target: .ox-tk-skel · mode: both · reason: загрузка доски — полосы-скелетон (role=status «Загрузка»), ошибка — LoadFailed «Повторить»; состояний в эталоне нет · decision: Q-70 · owner: W4.12
- kind: state · target: .ox-tk-nowf · mode: both · reason: «Настроить процесс» работает — v1 из текущих статусов 1:1, переходы «все во все» (TP-06); в эталоне команда всегда падала «Проект не найден или процесс не настроен» (api.js:140) · decision: PD-60, Q-W4.00-tasks-3, Q-W4.10-7 · owner: W4.12
- kind: state · target: aria:Название новой задачи · mode: both · reason: нет связи при быстром создании — тост оболочки «Нет связи с сервером. Операция не выполнена.»; в эталоне сетевых ошибок нет · decision: PD-31 · owner: W4.12
- kind: state · target: .ox-tk-ptitle · mode: both · reason: область в шапке проекта — название из listOrgUnits (право org_units.read); у логиста и водителя (роли проекта без org_units.read) в Project контракта 0.10 только orgUnitId — «— · ограниченный проект · процесс v1» вместо «Север Логистик · …» эталона (uName(p.unit), ЗП:378); страница уже читает orgUnitName ответа проекта, когда стюард его добавит · decision: PD-60, Q-W4.12-10 · owner: W4.12
- kind: state · target: .ox-tk-proj · mode: both · reason: ссылка ?project= на проект без доступа (404 или 403 — прораб) ведёт в список проектов, как «нет доступа» без ссылки (Q-W4.03-8), а не в LoadFailed с бесполезным «Повторить»; в эталоне ссылок на проект нет · decision: PD-60, Q-W4.12-11 · owner: W4.12
- kind: state · target: .ox-tk-filters · mode: both · reason: фильтры в адресе — mine=1 и approval=1 (ADR-0001); в эталоне фильтр — состояние экрана · decision: PD-60, ADR-0001 · owner: W4.12

## Цели нажатия

- kind: pixel · target: .ox-tk-quick-input · mode: both · reason: на телефоне поле «Новая задача — Enter» — 44 px вместо 36 px эталона (цели нажатия); на сверке 390 то же ставится эталону; чипы фильтров, вкладки и кнопки — область нажатия 44 px псевдоэлементом без изменения вида · decision: PD-28 · owner: W4.12
