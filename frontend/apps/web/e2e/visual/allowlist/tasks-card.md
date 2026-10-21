# Allowlist `tasks-card` (W4.12)

Сверка карточки задачи T-65 со снимком `design-2026-10-19` («Задачи и проекты.dc.html» ЗП:143–193, :414–437, relVM
:500–514), владелец «Альты», 1440. Снимок — область модуля (шапку и меню сверяет ключ `shell`). Поле `decision` — решение журнала, затем `Q-W4.12-N`
отчёта W4.12.

## Поведение без эталона

- kind: no-reference · target: aria:Комментарий к задаче · mode: both · reason: комментарий без перехода — поле и кнопка «Отправить комментарий» в «Истории» по образцу старой доски «Ортус CRM.dc.html»:1697 (commentTask); в новом модуле эталона поля нет; на сверке строка скрывается · decision: B-6, Q-W4.00-tasks-11, Q-W4.12-3 · owner: W4.12
- kind: label · target: aria:Комментарий к задаче · mode: both · reason: имя поля комментария «Истории» — не «Комментарий», чтобы не совпадать с полем перехода (ЗП:154) · decision: PD-60, Q-W4.00-tasks-11 · owner: W4.12
- kind: label · target: aria:Отправить комментарий · mode: both · reason: кнопка отправки комментария — подпись старой доски (CRM:1697) · decision: PD-60, Q-W4.00-tasks-11 · owner: W4.12
- kind: no-reference · target: button:К доске · mode: both · reason: на телефоне (< 640 px) карточка — на всю ширину вместо доски, вверху «← К доске»; эталон кладёт карточку под доску (flex-wrap) без возврата; пиксельной сверки 390 нет · decision: B-6, Q-W4.00-tasks-14 · owner: W4.12
- kind: label · target: button:К доске · mode: both · reason: кнопка возврата к доске на телефоне (на 1440 скрыта) · decision: PD-60, Q-W4.00-tasks-14 · owner: W4.12
- kind: state · target: .ox-tk-faint · mode: both · reason: «подзадач нет», «Описания нет» — --ox-text-muted вместо #8A968F эталона: контраст 3:1 < 4,5:1 (axe serious) · decision: PD-28, Q-W1.21-1 · owner: W4.12
- kind: state · target: .ox-tk-appr · mode: both · reason: голос при «нужны все», задача ждёт остальных — тост «Голос учтён. Ждём: {имена}» вместо «Согласовано» эталона (api.js:714); «Вернуть на доработку» не блокируют открытый чек-лист и подзадачи (дефект эталона, api.js:722) · decision: PD-60, Q-W4.00-tasks-8 · owner: W4.12
- kind: state · target: .ox-tk-tr · mode: both · reason: отказ перехода — тост с текстом сервера (trCheck эталона дословно); нет связи — тост оболочки «Нет связи с сервером. Операция не выполнена.» · decision: PD-60, PD-31, Q-W4.00-tasks-12 · owner: W4.12
- kind: state · target: .ox-tk-card · mode: both · reason: ссылка `?task=` открывает проект задачи и её карточку (из «Главной», «Данных»); в эталоне taskSel в модуль не передаётся (Р-20) · decision: PD-60, Q-W4.12-5 · owner: W4.12
- kind: state · target: .ox-tk-file · mode: both · reason: вложения — файлы core.files (загрузка purpose task_attachment, attachTaskFiles), без миниатюр: ссылку на файл даёт getFileDownload, в эталоне миниатюра — blob URL до перезагрузки (Р-19) · decision: PD-60, Q-W4.03-4 · owner: W4.12
- kind: state · target: .ox-tk-card .ox-tk-skel · mode: both · reason: пока задача грузится — скелетон на месте карточки (role=status «Загрузка»), ошибка getTask — «Не удалось загрузить данные: …» и «Повторить»; ссылка ?task= без проекта при ошибке — то же вместо списка; 404 или 403 по ссылке — задача убирается из адреса; состояний в эталоне нет · decision: Q-70, Q-W4.12-5, Q-W4.12-11 · owner: W4.12
- kind: state · target: .ox-tk-attach · mode: both · reason: файлы загружаются по одному; не загрузившийся — «Не прикреплено: {имя} — {причина}» (после «Прикреплено файлов: N»), загруженные прикрепляются — без файлов-«сирот»; в эталоне сбоев загрузки нет · decision: PD-60, Q-W4.12-6 · owner: W4.12
- kind: pixel · target: .ox-tk-check-item · mode: both · reason: на телефоне (< 640 px) строки чек-листа и «Входит в» — 44 px (цели нажатия); вид 390 карточки no-reference · decision: PD-28, Q-W4.00-tasks-14 · owner: W4.12
- kind: pixel · target: .ox-tk-hist-at · mode: both · reason: время «Истории» не сегодняшнего дня («01.10 10:42») в одну строку — колонка не уже 42 px эталона; на часах харнесса вид совпадает · decision: PD-28 · owner: W4.12
