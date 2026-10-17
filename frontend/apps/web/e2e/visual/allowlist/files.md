# Allowlist `files` (W1.24)

Сверка «Файлов» со снимком `design-stage-1` (`Ортус CRM.dc.html` :1858–1868, filesVM :4219–4231). Шапка и меню закрыты
маской — их сверяет ключ `shell`. Пиксели сверяются без списка файлов (заголовок, абзац, «Место организации», подпись
состояний — 0 px), строка списка — по вычисленным стилям строки, чипа «Готов» и кнопки «Открыть».

Поле `decision` — как в `modules.md`: решение журнала, затем `Q-W1.24-N` отчёта W1.24.

## Данные списка

- kind: label · target: button:Открыть · mode: mock · reason: список в данных расходится — эталон рисует три статических файла и фото рейсов (filesVM :4222–4226), сервер отдаёт listFiles: в MSW — файл осмотра Р-208 из примеров контракта; число кнопок «Открыть» разное · decision: PD-43, Q-W1.24-9 · owner: W1.24
- kind: pixel · target: .ox-files-list · mode: mock · reason: строки списка — данные listFiles (см. выше); пиксельная сверка — без списка, стили строки сверяются отдельно · decision: PD-43 · owner: W1.24
- kind: state · target: .ox-files-parent · mode: both · reason: родитель — вид и короткий заголовок родителя (ownerTitle): «Рейс Р-208», «Рейс Р-208 · расход», «Машина Е 905 НА 77», бронь — «Бронь машины» (у брони заголовка нет) · decision: PD-22, Q-W1.24-9 · owner: W1.24
- kind: state · target: .ox-files-chip · mode: both · reason: отклонённый файл — «Отклонён» вместо «Отклонён · тип»: причины отказа в File нет; pending_upload — «Загружается» (в эталоне состояния нет) · decision: PD-22, Q-W1.24-10 · owner: W1.24

## Поведение

- kind: state · target: button:Открыть · mode: both · reason: эталон показывает тост «Доступ к «…» подтверждён → выдана короткая ссылка (демо)»; в продукте getFileDownload выдаёт короткую ссылку, она открывается в новой вкладке без тоста (S1-21, 13-stage1-dor.md) · decision: PD-54, Q-W1.24-9 · owner: W1.24
- kind: no-reference · target: button:Показать ещё · mode: both · reason: в эталоне список без пагинации (Q-76); listFiles отдаёт страницами — «Показать ещё» при nextCursor · decision: Q-76, Q-W1.24-12 · owner: W1.24
- kind: state · target: .ox-files-usage · mode: both · reason: «Место организации» — getStorageUsage (billing.read): у сотрудника с files.read без billing.read карточки нет · decision: PD-22, Q-W1.24-11 · owner: W1.24
- kind: state · target: .ox-files-open:disabled · mode: both · reason: недоступная «Открыть» (файл на проверке или отклонён) — курсор not-allowed общего правила кнопок; в эталоне cursor: pointer (inline :1863) у недоступной кнопки — ошибка прототипа, прочие стили (прозрачность 0,45) совпадают · decision: PD-27, Q-W1.24-18 · owner: W1.24
- kind: state · target: .ox-files-parent · mode: mock · reason: файл, загруженный через сессию в MSW, — «Объект модуля «Логистика»» (FILES_TEXT.parents.unknown): сценарный сервер не заполняет ownerTitle у новых файлов; на стенде заголовок родителя есть · decision: PD-43, Q-W1.24-9 · owner: W1.24
- kind: label · target: button:Повторить · mode: both · reason: ошибка загрузки списка — alert «Не удалось загрузить данные: …» и «Повторить» (перечитать список); ошибка места — те же alert и «Повторить» внутри карточки «Место организации»; состояния ошибки в эталоне нет · decision: B-6, Q-W1.24-13 · owner: W1.24
- kind: state · target: .ox-files-list[role=status] · mode: both · reason: загрузка списка — скелетон из трёх строк в рамке списка (role=status «Загрузка») без подписи оболочки «Загружаем рабочее пространство…»; карточка «Место организации» во время запроса — заголовок и пустая полоса (aria-busy), список не сдвигается; состояния загрузки в эталоне нет · decision: B-6, Q-W1.24-19 · owner: W1.24
- kind: label · target: .ox-files-parent · mode: both · reason: модуль родителя неизвестен клиенту — заголовок родителя без имени модуля, без заголовка — «Объект другого модуля» (ключ модуля API пользователю не выводится); в эталоне такого родителя нет · decision: B-6, Q-W1.24-20 · owner: W1.24

## Диалог «Загрузка файла» (modal-upload)

- kind: no-reference · target: dialog:Загрузка файла · mode: both · reason: экрана загрузки нет в прототипе (B-6): сессия initiateUpload → PUT → completeUpload → проверка, «Отменить загрузку», «Повторить»; места монтирования в этапе 1 нет (у «Файлов» загрузки нет, контракт требует родителя) — покрыт экранными тестами, e2e и проходка — с первым потребителем W2.04; дорисовать в прототипе (design-requests, задача «modal-upload») · decision: B-6, Q-W1.24-15 · owner: W1.24
