# Allowlist `tasks-workflow` (W4.13)

Сверка вкладки «Процесс» со снимком `design-2026-10-19` (модуль «Задачи и проекты.dc.html» :233–275, логика :456–477), владелец «Альты», проект LOG, выбран переход «Согласовать». Шапка и меню закрыты маской. Поле `decision` — решение журнала, затем вопрос отчёта W4.13.

## Оформление

- kind: pixel · target: .ox-tset-scat · mode: both · reason: подпись категории статуса в эталоне — opacity .8: на фоне «В работе» и «Готово» контраст ниже 4,5:1 (axe color-contrast, serious) — подпись полной насыщенности · decision: PD-28 · owner: W4.13

## Поведение

- kind: state · target: .ox-tset-ver · mode: both · reason: каждая правка сохраняет черновик на сервере (saveTaskWorkflowDraft, If-Match) по очереди; ошибки публикации — тостом текстом сервера (тексты эталона api.js :677–691 и «Правило «X» ссылается на удалённый статус…» — Q-W4.00-tasks-13, без эталона) · decision: PD-60, Q-W4.00-tasks-13 · owner: W4.13
- kind: state · target: .ox-tset-trpanel · mode: both · reason: без «Настраивать» (tasks.workflow.manage) панель перехода только для чтения, черновик не виден (сервер отдаёт draft только настраивающим) · decision: PD-53, Q-W4.13-6 · owner: W4.13
- kind: state · target: .ox-tset-skel · mode: both · reason: загрузка — скелетон, ошибка — LoadFailed и «Повторить»; в эталоне состояний нет · decision: Q-70 · owner: W4.13

## Цели нажатия

- kind: pixel · target: .ox-tset-chips · mode: both · reason: на телефоне (< 640 px) поля и списки — 44 px, зазор рядов чипов статусов и «Кто может» — 14 px, строк добавления — 10 px, области нажатия кнопок — 44 px (псевдоэлемент); на сверке 390 те же поправки ставятся эталону · decision: PD-28 · owner: W4.13
- kind: pixel · target: .ox-tset-check-row · mode: both · reason: на телефоне (< 640 px) метка флажка («Переход выполняется согласованием», «Проверки и действия») — не ниже 44 px: цель нажатия — вся метка (в эталоне 18 px); на сверке 390 та же поправка ставится эталону · decision: PD-28 · owner: W4.13

## Хост W4.12

- kind: no-reference · target: tab:Список · mode: both · reason: вкладка «Список» хоста «Задач и проектов» (W4.12, Р-24) — строки задач по разметке старой доски «Ортус CRM.dc.html»:1650–1663, в основном файле её нет, в макете 1d — есть (ЗВ:382); на сверке вкладка скрывается, как в tasks-board · decision: B-6, Q-W4.00-tasks-14, Q-W4.12-1 · owner: W4.12
- kind: label · target: tab:Список · mode: both · reason: подпись вкладки «Список» хоста (макет 1d «Задачи - варианты.dc.html»:382) · decision: PD-60, Q-W4.00-tasks-14 · owner: W4.12
