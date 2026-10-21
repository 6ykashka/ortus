# Allowlist `modal-new-task` (W4.12)

Сверка диалога «Новая задача» со снимком `design-2026-10-19` («Задачи и проекты.dc.html» ЗП:97–126, :393–410),
владелец «Альты», доска LOG. Снимок — область модуля (шапку и меню сверяет ключ `shell`). Поле `decision` — решение журнала, затем `Q-W4.12-N` отчёта
W4.12.

## Поведение

- kind: state · target: .ox-tk-nf · mode: both · reason: вложения загружаются после создания задачи (initiateUpload purpose task_attachment с владельцем tasks/task, completeUpload, attachTaskFiles); сбой загрузки файла не отменяет задачу — тост «Не прикреплено: {имя} — {причина}» после «Задача {номер} создана» · decision: PD-60, Q-W4.02-10, Q-W4.12-6 · owner: W4.12
- kind: state · target: aria:Выбрать файлы · mode: both · reason: «Я» в исполнителях — участник с именем из /me/context (как me.name эталона); «Назначить меня» без своего участника в проекте — исполнитель не передаётся, сервер назначает автора · decision: PD-60, Q-W4.12-7 · owner: W4.12
- kind: out-of-stage · target: option:ДОК · Документы · маршруты · mode: both · reason: вариант «ДОК · Документы · маршруты» списка «Проект *» эталона — сид модуля «Документы» (documents.js:520, этап 7); в сиде этапа 4 его нет, на сверке вариант эталона убирается · decision: PD-60, Q-W4.00-tasks-1 · owner: W4.12 · expires: stage-7
- kind: state · target: .ox-tk-err · mode: both · reason: любая ошибка создания (нет связи, 403, 429, 422) — текстом в форме, тоста оболочки нет (не дважды); в эталоне сетевых ошибок нет · decision: PD-31, PD-60 · owner: W4.12
- kind: state · target: .ox-tk-drop · mode: both · reason: фокус клавиатуры на «Выбрать файлы» — рамка зоны (input прозрачный, verification-protocol §1.3); в эталоне фокус не виден · decision: PD-28 · owner: W4.12

## Цели нажатия

- kind: pixel · target: .ox-tk-nf-select · mode: both · reason: на телефоне (< 640 px) поля и списки диалога — 44 px вместо 40–42 px эталона (цели нажатия); на сверке 390 то же ставится эталону · decision: PD-28 · owner: W4.12
