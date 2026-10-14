# B. Домен и модули прототипа «Ортус CRM» — итерация 14.10.2026

Что сравнивается:
- **новый снимок**: `scratchpad\nd\ortus\*.js` — `api.js` (1045 строк), `models.js` (414), `mock-data.js` (289), `extra-data.js` (146), `roadmap.js` (133), а также новые `cash.js` (561), `chats.js` (598), `documents.js` (988), `knowledge.js` (515), `service.js` (368);
- **старый снимок**: `design\ortus\*.js` от 03.10 — `api.js` (627), `models.js` (304), `mock-data.js` (276), `extra-data.js` (85), `roadmap.js` (133).

Как проводилось сравнение:
- `git diff --no-index` по пяти общим файлам; каждый новый модуль прочитан целиком;
- точки интеграции — по `Downloads\Ортус CRM.dc.html` (НОВ) в сравнении с `design\Ортус CRM.dc.html` (СТ);
- рядом с модулями лежат новые спецификации `scratchpad\nd\docs\20…27-*.md` (формы, задачи и проекты, обращения, пространства БЗ, документы, чаты, касса, план реализации). Модули ссылаются на них: `service`→22, `knowledge`→23, `documents`→24, `chats`→25, `cash`→26, проекты задач→21.

Обозначение строк: `api:L` — новый `api.js`, `models:L` — новый `models.js`. Для модулей номера строк указаны по их собственным файлам.

> Число строк в задаче занижено: `wc -l`-подобный подсчёт пропускает пустые строки. Фактически `cash.js` — 561, `chats.js` — 598, `documents.js` — 988, `knowledge.js` — 515, `service.js` — 368.

---

## 1. Сводка

1. **Объём адаптера вырос с 53 до 168 методов.** В ядре `api.js` 78 методов: 53 − 2 + 27. Удалены `addCashOp` и `reverseCashOp`, добавлено 27 новых: формы, проекты задач, БЗ из форм, ремонт. Ещё 90 методов дают модули, их подмешивают через spread: `service` 10, `knowledge` 14, `documents` 32, `chats` 18, `cash` 16. Без `tenantIds` и `defaultBranding` (Q-88) порт насчитывает **166 методов против 51**.
2. **Модули устроены по одной схеме.** Каждый экспортирует три функции:
   - `installX(db[, M])` — идемпотентная миграция и сид в БД тенанта;
   - `xView(db, M, actor, slice)` — серверная проекция для участника;
   - `xApi({getDb, getActor, cmd, ApiError, M, event})` — фабрика команд.

   `api.js` вызывает их в фиксированном порядке (`api:34–42`): `normProjects`, затем service, knowledge, docs, chats, cash. **Часть сида теперь создаётся в адаптере**, а не в `mock-data.js`.
3. **Доступ стал многоуровневым.** К прежним областям `tenant|region|firm|self` добавлены семь новых: `project`, `space`, `page`, `folder`, `doc`, `chat`, `account` (`models:264–273`). У каждого модуля свой движок доступа с «цепочкой причин»: `projAccess`/`projCan`, `kbAccess`, `docAccess`, `chatAccess`, `cashAccess`, `seesDir`. При этом `scopeCovers` новые типы не знает: возвращает `false`.
4. **Сквозной дефект: роли с объектной областью «протекают» в `M.can`.** `M.can(db, mid, mod, verb)` без `unitId` засчитывает любой грант, включая роли проекта, пространства, чата и папки. Последствия:
   - `m-kotova` получает `tasks.settings` по всей организации (`r-pm` на `fleet`) и может `createProject`;
   - роли `r-kb-*` дают `knowledge.create`, поэтому `saveKbPage`/`createKbPage` правят закрытые страницы;
   - `r-exec` даёт водителю `tasks.edit`, и старые `toggleTaskCheck`/`commentTask` у него проходят.

   Это нужно решить до переноса (см. «Факты для плана», п. 6).
5. **Изменился сид, общий для всех.**
   - Роли проекта: `r-pm`, `r-approver`, `r-exec`, `r-viewer` и назначения `ap1–ap3`.
   - Ремонт: 6 объектов вместо одного, 13 работ, допработы.
   - БЗ: страница `kb-5` и таблица `kt-insp`; у формы появилось действие «в БЗ» `au-2`.
   - Install-функции добавляют около 15 ролей и около 15 назначений.
   - Кассу «Альты» полностью заменяет новый сид: 8 касс, 26 операций.
   - **Новых тенантов и персонажей нет.** `MEMBER`, `MEMBER_BY` и `PERSONAS` не изменились (НОВ:2297–2301 = СТ:2323–2327).
6. **Интеграция с CRM: `<dc-import>` и `onApi(m, a, ok)`.**
   - Семь экранов вынесены в дочерние компоненты: «Формы и опросы», «Обращения», «Задачи и проекты», «База знаний», «Документы», «Чаты», «Касса». Оболочка передаёт им `db`, `mid` (id участника персонажа) и колбэки `onApi/onNav/onToast/onOpened`.
   - Ребёнок вызывает адаптер **по строковому имени метода**: `this.api[m](...a)`.
   - **Файлов этих семи компонентов (`*.dc.html`) в комплекте нет.** Какие методы они вызывают, восстановлено по API модулей.
7. **`createHttpAdapter` не изменился.** Ни одного из 115 новых методов в нём нет; все они вне OpenAPI 0.1.
8. **Коды ошибок те же 18, но поменялось, где какой используется.**
   - Модули почти не бросают `no_permission`/`no_scope`. Вместо них — `forbidden`, а для невидимого объекта `not_found` (политика 404 из `docs/12`).
   - `no_scope` бросается напрямую в `addWorkLog`/`proposeChange`.
   - `transition` используют проекты и обращения.
   - `subscription_restricted` касса проверяет сама; БЗ, документы и чаты эту проверку **не делают**.
9. **Время недетерминировано.** У каждого модуля свои часы:
   - `CASH_DAY = '01.10'`;
   - `KB_TODAY`/`DOC_TODAY = '01.10.2026'`;
   - чаты: `db.chats.now = 665` (минуты от 01.10 00:00);
   - обращения: `SVC_BASE = 01.10.2026 16:24` плюс реальное прошедшее время;
   - реальные `hhmm()`/`hm()`/`Date.now()`.

   Для TDD нужен единый инжектируемый `Clock` с несколькими «демо-сейчас» и фиксированная TZ `Europe/Moscow`.
10. **Объём переноса.** Пять модулей — около 3030 строк чистого JS. Ядро выросло примерно на 520 строк, сид — примерно на 75. По оценке: `documents` — XL (стоит делить), `knowledge`, `chats`, `cash` — L, `service` — M, проекты задач — L, формы — M, ремонт — S.
11. **Устарело.** 07 §1, §2, §3.4, §4.6–4.7, §5, §8.2, §8.5, §8.7, §9, §10, §11 и §16 частично; 13 из 62 кейсов §14. В WS-05 — цели, экспорт-лист, `AdapterPort` (51) и ожидания сида. В WS-06 — `METHODS_51`, `Delays`, группы методов, кейсы S-11, S-44, S-46, S-50…52, S-61, C-11, C-12, M-8 (подробно в §6).

---

## 2. Дельта `api.js`, `models.js`, сида

### 2.1 `roadmap.js`

Файл байт-в-байт совпадает со старым: дельты нет.

### 2.2 `api.js`: подключение модулей и новая инициализация

| Что | Где | Суть |
|---|---|---|
| Импорт пяти модулей | `api:8–12` | `installX`, `xView`, `xApi` |
| `normProjects(d)` | `api:21–33` | Каждый проект, кроме `flow:'leads'`, получает `access ='limited'`, `automations=[]`, `runs=[]`, `wf = buildWf(p.id==='fleet' ? 'approval' : 'simple')`. Для `fleet` создаются задачи **T-65** «Заменить шины на ГАЗон Next (зимние)» (На проверке, автор `m-vasiliev`, вложение «Счёт № 418 от 07.10.pdf») и **T-66** «Подготовить парк к зиме» (В работе, автор `m-kotova`); `T-65` и `T-58` становятся подзадачами `T-66`. Добавляются правила `ar-1` («Срочная задача → назначить руководителю проекта», вкл.) и `ar-2` (выкл.) и журнал `runs` из 2 записей |
| Установка модулей | `api:34–38`, `:42` | Альта: service, knowledge, docs, chats, cash. Лотос: knowledge, docs, chats, cash; **service не ставится** (`db.service` = `null`) |
| `recordInspection` | `api:72–78` | Добавлены действия формы вида `kind:'kb'`: `kbFits` → `kbRun`. Правило-задача берётся только с `!kind \|\| kind==='task'` |
| `kbFits`/`kbRun` | `api:80–118` | Действие формы «Сохранить в Базу знаний». Режимы: `table` — строка в `K.tables[].rows`, `entry` — запись в `K.entries`. Один результат на пару «ответ × правило», журнал в `r.actions`. Ошибки не бросаются, а пишутся в результат: «страница удалена из Базы знаний», «у автора правила … нет права «Создавать» в Базе знаний», «страница «…» доступна только владельцу», «таблица удалена со страницы «…»». Плюс событие владельцам «Форма «…»: ответ R-… не сохранён в Базу знаний — …» |
| `checkFiles` | `api:121–127` | Вложения задач: до 30 на задачу, до 20 МБ каждое; типы `image/*`, pdf, text, office, zip. Ошибки: «К задаче можно прикрепить не больше 30 файлов», «Файл «X» не принят: больше 20 МБ \| пустой файл \| такой тип не принимаем» |
| `checkParent` | `api:128–139` | Иерархия задач: один родитель, ≤ 3 уровней, без циклов, родитель должен быть видимым и незавершённым. Ошибки: «Задача X не найдена», `forbidden` «Нет доступа к задаче X», «Задача не может входить в саму себя», «Получится цикл: …», «Не больше трёх уровней: задача → подзадача → подзадача», «Задача X уже завершена — сначала верните её в работу» |
| `pj`/`assertPj` | `api:140–141` | `not_found` «Проект не найден или процесс не настроен»; `forbidden` «Нет права «<VERB_LABEL>» в проекте «P»: <why>» |
| `moveTo` + `autoFire` | `api:142–165` | Автоматизация проекта от имени автора правила с проверкой `projCan(byId,'edit')`. Глубина 1 (`autoDepth`), журнал `p.runs` ≤ 30. Действия `assign`, `priority`, `comment`. Ошибки пишутся в `runs` с `res:'error'` и в событие владельцам «Правило «…» не выполнено: …» |
| `view()` | `api:185–225` | См. §2.4 |

### 2.3 Методы адаптера: новые, изменённые, удалённые

Колонка «Guard»: `A` = `assertActive()` (`subscription_restricted`), `can(m,v)` = `assertCan` (коды `REASON`), `pj(v)` = `assertPj` (`forbidden`).

**Новые методы ядра (27)**

| Метод (`api:L`, задержка) | Guard | Ошибки (дословно) | Эффект / события | data |
|---|---|---|---|---|
| `saveFormDraft(formId, def)` 575, 120 | `can(forms,settings)` | `not_found` «Форма не найдена» | `f.draft = def`, `updated` | — |
| `discardFormDraft(formId)` 580, 200 | `can(forms,settings)` | `not_found`; «У формы ещё нет опубликованной версии» | `delete f.draft` | — |
| `createForm({name, template, unit, def, module, settings})` 587, 350 | A + `can(forms,settings)` | «Шаблон не найден»; «Модуль «X» не подключён: шаблон недоступен»; «Укажите название формы — не короче 3 символов»; «Форма «X» уже есть — измените название»; «Область не найдена» | `fm-<seq>`: `status:'draft'`, `settings = FORM_SETTINGS ⊕ шаблон`, `draft = templateDef(T)`; событие владельцам «Создан черновик формы «X»[ из шаблона «T»]» | id |
| `updateForm(formId, patch)` 602, 250 | A + `can(forms,settings)` | «Название формы — не короче 3 символов»; «Форма «X» уже есть»; «Форма ещё не опубликована»; «Неизвестный статус формы»; «Область не найдена»; «Публичный доступ невозможен: вопрос «X» спрашивает данные CRM»; «Лимит ответов — положительное число» | name, status (`closed`/`published`) и событие «Закрыт \| Возобновлён приём ответов: «X»»; unit, settings, automations — **без новой версии** | — |
| `createProject({name, key, unit, access, process, copyFrom})` 644, 350 | A + `M.can(tasks,settings)` → `forbidden` «Создавать проекты может роль с правом «Задачи · Настраивать»» | «Название — не короче 3 символов»; «Ключ — 2–6 заглавных букв или цифр, первая — буква»; «Ключ X уже занят»; «Выберите область проекта»; «Выберите проект, процесс которого копировать» | `pj-<seq>`; копия процесса или `buildWf`; при копировании правила выключаются; автору назначается `r-pm` (`ap-<seq>`); событие «Создан проект «X» (KEY)» | id |
| `updateProject(id, patch)` 660, 250 | `pj(settings)` | «Название — не короче 3 символов» | access, name | — |
| `setProjectRole(pid, mid, roleId\|null)` 665, 250 | `pj(settings)` | «Выберите сотрудника»; «X заблокирован — назначить роль нельзя»; «В проекте назначаются роли проекта» | назначение со `scope:{project}`; события «X исключён из проекта «P»» / «X: роль «R» в проекте «P»» | — |
| `initProjectWorkflow(pid)` 675, 250 | `pj(settings)` | — | `wf ??= buildWf('simple')` | — |
| `saveWorkflowDraft(pid, wf)` 676, 200 | `pj(settings)` | — | `p.wf.draft` | — |
| `publishWorkflow(pid)` 677, 400 | `pj(settings)` | «Изменений нет»; «У статуса нет названия»; «Названия статусов повторяются»; «Нужен хотя бы один статус категории «Готово»»; «Переход «X» ссылается на удалённый статус или без названия»; «Есть задачи в статусах, которых нет в новой версии: … Переведите их или верните статус» | `wf = draft`, `v + 1`; событие «Опубликован процесс проекта «P» vN. Задачи остаются в своих статусах» | v |
| `createProjectTask({project, parent, title, description, labels, files, assignee, priority, due})` 692, 300 | `pj(create)` | «Тема — не короче 3 символов»; «Описание — не длиннее 5000 символов»; ошибки `checkFiles`/`checkParent` | id `KEY-(100+seq)`; статус = первый `cat:'todo'`; метки в нижнем регистре, без повторов, ≤ 10; `autoFire('created')` | id |
| `runTransition(taskId, trId, comment)` 703, 300 | `trCheck` → `transition` <why> | «Переход удалён из процесса»; `transition` «Статус задачи меняет маршрут документа «T»: решения — в «Документах»»; «Для перехода «X» нужен комментарий» | Согласование: голоса в `t.approval.votes`; при `mode:'all'` возвращает `{done:false}`, пока голосуют не все `approversOf`. Иначе `moveTo` → `autoFire('status')` | `{done}` |
| `rejectApproval(taskId, trId, comment)` 718, 300 | `trCheck` (кроме «уже согласовали») | «Согласование не найдено»; `transition` про маршрут документа; «Напишите, что доработать» | статус = `rejectTo`; системный комментарий «Вернул(а) на доработку (A → B): …» | — |
| `saveAutomation(pid, rule)` 729, 250 | `pj(settings)` | «Назовите правило»; «Выберите статус для триггера»; «Заполните действие» | `version + 1`, `by`/`byId` = актор | id |
| `toggleAutomation(pid, ruleId, on)` 739 / `deleteAutomation(pid, ruleId)` 740, 200 | `pj(settings)` | — | — | — |
| `setTaskField(taskId, patch)` 741, 200 | `pj(edit)` | «Описание — не длиннее 5000 символов» | assignee, priority, `check` (переключение пункта чек-листа), description | — |
| `setTaskParent(taskId, parentId\|null)` 748, 250 | `pj(edit)` | `checkParent` | системные комментарии у задачи, у старого и нового родителя | — |
| `addTaskFiles(taskId, files)` 757, 300 | `pj(edit)` | `checkFiles` | файлы `f-<seq>`, комментарий «прикрепил(а): …» | — |
| `removeTaskFile(taskId, fileId)` 763, 250 | свой файл + `edit`, или `settings` | `not_found` «Файл уже удалён»; `forbidden` «Удалить можно свой файл; чужие — руководитель проекта» | — | — |
| `createKbPage(spaceId, spec)` 797, 350 | A + `can(knowledge,create)` ⚠ глобально | «Выберите раздел Базы знаний»; «Название страницы — не короче 3 символов»; «В разделе «S» уже есть страница «T»»; «Страницу «Только владелец» может создать только владелец»; «Текст страницы пустой»; ошибки таблицы (как у `createKbTable`) | `kb-<seq>`, опционально таблица `kt-<seq>` с `c-<seq>`; событие «В разделе «S» создана страница «T»[ с таблицей «X»]» ⚠ узел создаётся в старой форме, без `mode/parent/pos/kind/owner/status` | `{id, table}` |
| `createKbTable(pageId, spec)` 830, 250 | A + `can(knowledge,create)` | `not_found` «Страница не найдена»; «Название таблицы — не короче 2 символов»; «На странице уже есть таблица «X»»; «Добавьте хотя бы один столбец»; «У столбца нет названия»; «Названия столбцов повторяются» | событие «На странице «P» создана таблица «T»» | `{id, columns}` |
| `backfillKbRule(formId, ruleId)` 846, 450 | A + `can(forms,settings)` | `not_found` «Форма не найдена» / «Действие не найдено»; «Действие выключено — включите его, чтобы перенести ответы» | `kbRun` по прошлым ответам, отсортированным по номеру | `{added, failed, err}` |
| `retryFormAction(respId, ruleId)` 856, 300 | A + `can(forms,settings)` | `not_found` «Ответ не найден»; «Действие удалено из формы — повторить нельзя»; «Не выполнено: <err>» | `kbRun` | результат действия |
| `assignForeman(objId, memberId)` 921, 400 | A + `can(repair,edit)` | `not_found` «Объект не найден»; `conflict` «Прораб уже назначен: X»; «Сотрудник не найден или не активен» | событие прорабу «Вы назначены прорабом объекта «O»» | — |
| `proposeChange({obj, title, volume, unit, note, photos})` 932, 350 | A + `can(repair,create)` + прораб объекта | `not_found`; `no_scope` «Допработу по объекту предлагает его прораб»; `conflict` «До договора допработ нет: правки вносятся новой версией сметы» / «Объект сдан: допработы по нему не принимаются»; «Опишите, что нужно сделать»; «Укажите объём больше нуля»; «Приложите хотя бы одно фото» | `ДР-<n>` `status:'proposed'`; событие «Прораб предложил допработу «T» · O — нужна оценка» | — |
| `setChange(ids[], status, extra)` 949, 300 | A + `can(repair,edit)` | «Неизвестный статус допработы»; `not_found` «Допработа не найдена»; `conflict` «Допработа ДР-n уже подписана \| отклонена» | `rejected` → reason и событие прорабу; `signed` → новая работа `w-ДР-n` и событие «Допсоглашение[ № N] подписано: …» | — |

**Изменённые методы ядра**

| Метод | Что изменилось |
|---|---|
| `publishForm(formId, def)` 555 | Аргумент — `{pages, fields}` (массив полей тоже принимается). Добавлены `assertActive` и `not_found` «Форма не найдена». Новые тексты: «В форме нет ни одного вопроса» (раньше «…поля»; поля `statement` не считаются), «У вопроса нет текста» (раньше «У поля нет подписи»). Новые проверки: «У вопроса «X» нет вариантов ответа», «Публичная форма не может спрашивать «X»: справочники CRM гостю не показываются», «Повторяется идентификатор вопроса X». `by` теперь имя актора (было «Дарья Зимина»). `versions[].pages`. `delete x.changed` больше нет |
| `moveTask` 619 | Для задач проекта с `wf`: `transition` «Статус меняется переходами процесса проекта «P»». Теперь работает **только для `leads`** и проектов без `wf` |
| `assign` 412 | Новая проверка: «Область «Касса» подходит только ролям с модулем «Касса»» (scope `account`) |
| `saveRole` 434 | Роль `professional:'driver'` с модулем cash автоматически получает `role.cash.self = true` |
| `addWorkLog({obj, work, …})` 896 | Новый параметр `obj`. Проверки: «Выберите работу этого объекта»; `no_scope` «Отметку по объекту отправляет его прораб» (раньше прораб не проверялся); `conflict` «Объект сдан: новые отметки не принимаются». `logs[].obj`, `by` = актор. Событие «Прораб отметил «W» · <объект>: N м² — нужна приёмка» |
| `acceptWorkLog` 913 | Отсутствующий материал не падает (`if (mt)`) |
| `saveKbPage` 785 | **Код не изменился**, но устарел: проверка глобальная `can(knowledge,create)` без `kbAccess`; узлы v2 не учитывает |

**Удалены:** `addCashOp`, `reverseCashOp`. Их заменили 16 команд `cash*`.

**Методы модулей (90).** Сводно здесь, подробно в §3.

| Модуль | Методы |
|---|---|
| service (10) | `svcReply, svcTransition, svcAssign, svcPriority, svcMove, svcCreate, svcShowPhone, svcShare, svcAddTask, svcRating` |
| knowledge (14) | `kbCreateSpace, kbCreateNode, kbPublish, kbSetStatus, kbSetAccess, kbMove, kbArchive, kbAck, kbRequest, kbDecide, kbSetMember, kbToggleRule, kbCheckReview, kbRunSection` |
| documents (32) | `docCreate, docRename, docBlock, docBlockAdd, docSuggest, docSuggestDecide, docComment, docReply, docResolve, docMentionSkip, docShare, docGrant, docMove, docCell, docAddSheet, docCrmSync, docCut, docRestore, docRouteStart, docRouteDecide, docSignStart, docSign, docAck, docAckClose, docRouteResume, docRouteCancel, docOcrWord, docPages, docStamp, docJob, docJobPoll, docJobRetry` |
| chats (18) | `chatOpen, chatSend, chatEdit, chatDelete, chatAck, chatVote, chatPollClose, chatPin, chatReveal, chatOpenOnce, chatSaveTo, chatToTask, chatCreate, chatSources, chatSetFull, chatCleanup, chatPolicySet, chatTick` |
| cash (16) | `cashPost, cashPostProposal, cashDismiss, cashLink, cashReverse, cashShiftOpen, cashShiftClose, cashShiftReview, cashTransfer, cashTransferAccept, cashIssue, cashReceipt, cashReceiptDecide, cashReturn, cashApprove, cashAccountCreate` |

Особые методы:
- `chatOpen` и `chatTick` вызываются с `needsNet=false` и задержкой 0/200;
- `docJobPoll` — задержка 0;
- `chatTick` и демо-режим `as` в `docRouteDecide` — это демо-инструменты, в продукт они не идут.

### 2.4 `view()`: что изменилось

| Поле | Было | Стало (`api:202–223`) |
|---|---|---|
| `projects` | грант с `actions.tasks` и `scopeCovers(p.unit)` | плюс грант `scope:{project, id}` |
| `tasks` | задачи видимых проектов или `assignee === me.name` | плюс задачи с `docRoute`, если актор — автор или в `docRoute.waiting` |
| `knowledge` | `pages.filter(access==='all' \|\| isOwner)` | `kbView`: страницы по `kbAccess`, пространства по `kbSpaceMy`; таблицы и записи видимых страниц; `rules`/`runs` — только руководителю пространства |
| `cash` | `{accounts:[], ops:[], hidden:true}` без `can(cash,view)` | `cashView`: кассы по `cashAccess`; остаток только с `opt.balance`; смены, перемещения, чеки, заявки, предложения, `todo`, `badge` |
| `docs` | — | `docsView`: документы с L > 0; финансовые листы заменены заглушками без `finSees`; при доступе к одной версии (`onlyV`) — только эта версия |
| `chats` | — | `chatsView`: чаты с `chatRights.ok`; сообщения с маской ПДн, свёртками прочтений, опросов и «важного»; `my.{unread, ackWait}` |
| `service` | — | `serviceView(db, actor, M)` — **порядок аргументов другой**, чем у остальных `xView(db, M, actor, slice)`. Без `db.service` → `null`. Без права `view` → `hidden` |
| `repair` | не фильтровался | Прораб видит только свои объекты, если нет `review`/`edit`. `works`/`logs`/`materials`/`changes` — по видимым объектам. `st.fin` — только с `finance.read` или `all` |

### 2.5 Новое в `models.js` (304 → 414 строк)

**Справочники:**
- `CORE`: добавлены `docs`, `service`, `chat`; `cash` переименован («Внутренняя касса» → «Касса»).
- Новые ключи прав:
  - **docs**: `docs.read`, `docs.comment` / `docs.create`, `docs.convert` / `docs.update`, `docs.suggest` / `docs.sign` / `docs.export` / `docs.share`, `docs.templates.manage`, `docs.folders.manage`;
  - **cash** (12): `cash.read` / `cash.post`, `cash.proposals.post`, `cash.shift.operate` / `cash.refund`, `cash.transfer`, `cash.advance.issue` / `cash.approve`, `cash.reconcile`, `cash.reverse` / `cash.export` / `cash.accounts.manage`, `cash.period.close`;
  - **service** (5): `service.requests.read`, `.create`, `.reply`, `.resolve`, `service.directions.manage`;
  - **chat** (12): `chat.read` / `chat.write`, `chat.files.send`, `chat.polls.create`, `chat.direct` / `chat.create` / `chat.moderate`, `chat.announce` / `chat.export` / `chat.settings.manage`, `chat.members.manage`, `chat.retention.manage`.

  Ключи `cash.operations.create` больше нет.
- `rolePermKeys`: добавлены `cash.balance.read` (`role.cash.balance`) и `cash.advance.self` (`role.cash.self`).
- `TASK_TONE` обёрнут в `Proxy`: для неизвестного статуса возвращает `['info','pending']`.

**Формы:**
- `FORM_SETTINGS` — 15 полей: `access`, `until`, `limit`, `onePerPerson`, `allowEdit`, `thanks`, `quiz`, `passScore`, `showScore`, `progress`, `backButton`, `logo`, `retainDays: 365`.
- `FORM_TEMPLATES` — 15 шаблонов: `blank`, `tpl-profile`, `-feedback`, `-request`, `-event`, `-csat`, `-nps`, `-ces`, `-support`, `-pulse`, `-onboard`, `-quiz`, `-insp` (logistics), `-foreman` (repair), `-spa` (spa). Типы полей: `text`, `longtext`, `phone`, `email`, `inn`, `choice`, `multi`, `select`, `rating`, `scale`, `date`, `bool`, `photo`, `int`, `number`, `person`, `ref`, `unit`, `statement`. Есть `showIf {mode, conds}` и баллы `score`.
- `templateDef(T)` → `{pages:[{id:'pN', title}], fields:[{…, page, section}]}`.
- `FORM_VARS` — 6 служебных переменных (`$at`, `$author`, `$object`, `$id`, `$form`, `$ver`).
- `formVal(f, r, src, fields)` — значение ячейки для БЗ: обрезка до 500 символов; для фото — «N · файлы в ответе R-…».

**Проекты задач (docs/21):**
- `PROJECT_ROLES`, `VERB_LABEL`, `WHO_LABEL`, `STATUS_CAT`;
- `buildWf(kind)`, `projAccess(db, p, mid)`, `projCan(db, p, mid, verb)`, `childrenOf`, `isDone`, `approversOf`, `trCheck(db, p, t, mid, tr)`.

**`scopeLabel`** понимает 7 новых типов областей: «Проект «…»» / «Направление «…»», «Пространство «…»», «Страница «…»», «Папка «…»», «Чат «…»», «Документ «…»», «Касса «…»».

**Итого:** 25 доменных функций превратились в 34 (+9); справочников стало на 7 больше.

### 2.6 Сид: `mock-data.js` и `extra-data.js`

| Сущность | 03.10 | 14.10, сырой `seed()` | После адаптера (`normProjects` + install*) |
|---|---|---|---|
| `roles` (Альта) | 5 | 9: + `r-pm`, `r-approver`, `r-exec`, `r-viewer` (`project:true`) | + `r-agent`; `r-kb-lead/editor/author/reader`; `r-doc-manage/edit/read`; `r-chat-owner/mod/member/reader/creator`; `r-cashier` = **24**. У шаблонов добавлены `actions.docs/chat/cash`, `docsAddressed`, `role.cash` |
| `assignments` (Альта) | 4 | 7: + `ap1` (m-kotova → r-pm @ fleet), `ap2` (m-vasiliev → r-exec @ fleet, via группа), `ap3` (m-kotelnikova → r-approver @ fleet) | + `as-svc1/2` (Котова и Котельникова → r-agent @ svc-grz); `akb-1..3`; `adoc-1`; `ach-1..4`; `a-cash1` (m-morozova → r-cashier @ account ca-spa) = **≈ 20** |
| `members`, тенанты, персонажи | — | без изменений | без изменений; `m-kotelnikova` теперь участвует в сценариях, но персонажа для неё нет |
| `forms[fm-insp].automations` | `au-1` | + `au-2` `{kind:'kb', mode:'table', page:'kb-5', table:'kt-insp', when:'accepted', fields: 7 столбцов}` | — |
| `responses` | 2 | у R-0988 и R-1012 появилось `actions:[{rule:'au-2', ok:true, …}]` | — |
| `tasks` | 9 | 9 | 11: + T-65, T-66; T-58 и T-65 получают `parent:'T-66'`. У `fleet` есть `wf` (approval), `access`, `automations`, `runs`; у `leads` — нет |
| `knowledge` | 3 пространства, 4 страницы | + `kb-5` «Журнал осмотров машин»; `tables:[kt-insp]` (7 столбцов, 2 строки `kr-1/kr-2`); `entries:[]` | `v2`: 5 пространств (+ `sp-rep`, `sp-gen`), ≈ 35 узлов в дереве, `requests`, `rules` (kr-1…5), `runs` (krr-1…3) |
| `repair` | `object` (1), works 3, materials 2, logs 1 | `objects` 6 (obj-42, obj-38, obj-31, obj-45 без прораба, obj-27 «Сдан», obj-50 `draft` «Замер»); `works` 13 (с `obj`); `materials` 5; `changes:[ДР-1]`; `logs` 5 (WL-11, 09, 08, 06, 02); у объектов `st` (график, финансы) | — |
| `cash` | 2 кассы, 4 операции | без изменений в `extra-data` | Альта: `seedAlta` **заменяет** кассу целиком — 8 касс, 26 операций K-301…K-326, 2 смены, 4 перемещения, 6 чеков, 1 заявка, 4 предложения, `v1`. Лотос: миграция `ca-lotos` → drawer `f-lotos-tver` |
| `docs`, `chats`, `service` | — | — | Альта: 6 папок, 6 документов, проект `pj-docs`; 6 чатов, 22 сообщения; 4 направления, 21 тип, 8 обращений, 2 оценки. Лотос: `fd-salon` + `doc-l1`; `ch-news` + `ch-tver`; service = `null` |
| Лотос `roles` | 3 | 7 (+ 4 роли проекта) | + KB, docs, chat, cashier |
| Лотос `knowledge` | sp-spa, kb-3 | + фильтр `tables`/`entries` | + `kb-home-sp-spa` |

---

## 3. Модули

Общее для всех пяти модулей:
- **Зависимости от ядра:** `ApiError`, `cmd(fn, ms, needsNet)` (без отката мутаций при `throw`), `event(text, to[])`, общий счётчик `db.seq`, `M.grants`, `M.can`, `M.scopeCovers`, `M.moduleOn`; у каждого модуля свой `clone` и свои часы.
- **Чистые функции** отделены от команд. Их можно переносить TDD-тестами «таблица вход → выход» до адаптера.

### 3.1 `service.js` — обращения клиентов по направлениям (368 строк, docs/22) · **M**

**Назначение.** Обращения (жалобы, претензии, вопросы, гарантия, повреждение груза и др.) разложены по направлениям бизнеса. У каждого направления свой календарь рабочего времени. SLA первого ответа и решения считается в рабочих минутах, срок «по закону» — в календарных днях.

**Экспорт:**
- Часы: `SVC_BASE` (01.10.2026 16:24 локально), `svcNow()` — демо-часы, нечистая.
- Чистые: `addWork(start, mins, cal)`, `workBetween(a, b, cal)`, `hm`, `dayLabel`, `when(ms, now)`, `dur(mins, cal?)`, `maskPhone`, `slaOf(r, d, now)`, `slaHead(r, d, now)`.
- Справочники: `SVC_ST`, `SVC_FLOW`, `SVC_KIND` (7), `SVC_CH`, `SVC_PRIO`, `OUTCOMES`, `OUTCOMES_ABOUT`, `COMPENSATIONS`.
- Фабрики: `serviceSeed()`, `installService(db)` (мутирует), `serviceView(db, actor, M)`, `serviceApi(deps)`.

**Модель:** `db.service = {directions, types, templates, requests, ratings, seq:200}`.
- Календарь: `cal {days[0=пн], from, to}`: spa — ежедневно 10–21, rep — пн–пт 9–19, log — ежедневно 8–20.
- Направление: `{id, key, name, project:'svc-*', cal, lead, next}`.
- Тип: `{dir:kind, first, resolve, legal}`.
- Обращение: `{id, key, dir, kind, status, priority, assignee:ИМЯ, at, channel, client{phone…}, sla{first, resolve, legal}, messages[], tasks[], about?, pausedAt?, outcome?, shown?[]}`.

**Статусы:** `new → work|wait|resolved`; `work → wait|resolved`; `wait → work|resolved`; `resolved → work|closed`. Пауза (`wait` + `pausedAt`): first/resolve стоят, legal идёт.

**Права:**
- `need(verb)` = `M.can(db, actor, 'service', verb)` без scope, иначе `forbidden` «Нет права «Видеть \| Заводить \| Отвечать \| Решать» в обращениях»;
- видимость направления (`seesDir`): владелец или грант `scope:{project:d.project}` с `actions.service`;
- невидимое обращение или обращение «о себе» (`r.about === actor`) → `not_found` «Обращение не найдено»;
- `installService` добавляет роль `r-agent` и назначения Котовой и Котельниковой на `svc-grz`.

**Команды** (ошибки дословно):

| Команда | Права | Ключевые ошибки и правила |
|---|---|---|
| `svcReply(id, {kind, text, compensation})` | note → view, иначе edit | «Обращение закрыто»; «Напишите текст заметки \| ответа». Публичный ответ: останавливает `sla.first`, `new → work`, assignee = я |
| `svcTransition(id, to, {outcome})` | resolved/closed → review, иначе edit; **flow проверяется раньше прав** | `transition` «Из статуса «A» в «B» перейти нельзя»; «Выберите итог решения». `wait` ставит паузу, `work` из `wait` снимает паузу (`resume`) |
| `svcAssign(id, name)` | edit | «X не видит направление «D» — назначить нельзя» |
| `svcPriority` | edit | «Неизвестный приоритет» |
| `svcMove(id, dirId)` | edit + `seesDir` | «Выберите другое направление»; `forbidden` «Нет доступа к направлению «D»»; новый ключ, `oldKeys`; SLA не пересчитываются |
| `svcCreate(spec)` | create | «Выберите направление \| тип обращения»; «Укажите имя клиента»; «Телефон — не меньше 10 цифр»; «Опишите, что случилось» |
| `svcShowPhone(id)` | только владелец или `d.lead` | `forbidden` «Телефон клиента показывают руководителю направления и владельцу: нужно право «Контакты клиентов»» |
| `svcShare(id, text)` | review | «Обращение не касается сотрудника»; «Поделиться выводом можно после решения»; событие сотруднику «Вывод по обращению K: …» |
| `svcAddTask(id, title)` | edit | «Тема задачи — не короче 3 символов». ⚠ задача создаётся **только внутри обращения**: в `db.tasks` её нет |
| `svcRating(rid, action)` | `seen` → edit, иначе create | `not_found` «Оценка не найдена»; из низкой оценки создаётся жалоба |

**Связи:**
- роли и области `project`;
- `scopeLabel` («Направление «…»»);
- задачи — только заглушки (T-71…T-73 в `db.tasks` нет);
- касса — только текст «предложение операции отправлено в кассу»; в сиде кассы есть статичное `pr-2`;
- CRM: `homeVM` берёт `SV.slaHead` для блока «Требует решения»;
- форм, документов и чатов нет.

**Чистые функции → тесты.** TZ = Europe/Moscow, `ts(d,m,h,mi)` = `new Date(2026, m−1, d, h, mi)`; 01.10.2026 — четверг.

| Вызов | Ожидание |
|---|---|
| `addWork(ts(28,9,9,0), 120, rep)` | пн 28.09 11:00 |
| `addWork(ts(27,9,20,5), 600, rep)` (вс) | пн 28.09 19:00 |
| `addWork(ts(30,9,19,40), 240, rep)` | чт 01.10 13:00 |
| `addWork(ts(30,9,19,40), 6000, rep)` | ср 14.10 19:00 |
| `addWork(ts(1,10,15,12), 1320, spa)` | сб 03.10 15:12 |
| `addWork(ts(3,10,12,0), 0, rep)` (сб) | пн 05.10 09:00 |
| `workBetween(ts(2,10,18,0), ts(5,10,10,0), rep)` | 120 |
| `workBetween(ts(28,9,11,0), ts(1,10,16,24), log)` | 2484 |
| `workBetween(b ≤ a)` | 0 |
| `dur(220, rep)` / `dur(600, rep)` / `dur(5556, rep)` / `dur(1248, spa)` / `dur(-5)` | '3 ч 40 мин' / '1 раб. день' / '9 раб. дней' / '1 день' / '0 мин' |
| `when(ts(1,10,15,12), SVC_BASE)` / `when(ts(30,9,19,40), SVC_BASE)` | 'сегодня, 15:12' / 'вчера, 19:40' |
| `maskPhone('+7 916 204-44-12')` / `maskPhone('')` | '+7 ••• •••-••-12' / '•••' |
| `slaOf(r-41, d-mas, SVC_BASE)[first]` | `{state:'norm', text:'осталось 48 мин', until:'до 17:12', left:48}` |
| `slaOf(r-57, d-grz, SVC_BASE)[first]` | `{state:'late', text:'просрочен на 1 ч 10 мин', until:'был до 15:14', over:70}` |
| `slaHead(r-55)` (wait) | `{state:'pause', text:'ждём клиента', until:'по закону до 26 октября', rank:9e11}` |
| Порядок очереди по `rank` | ГРЗ-57, МАС-41, МАС-40, КОС-6, ОТД-12, ОТД-11, ГРЗ-55, МАС-39 |

**Риски:**
- локальная TZ и DST (`legal.due = at + days*DAY`);
- демо-часы `svcNow` против реальных `event().at`;
- `assignee` хранится по имени;
- `svcRating` без защиты от дублей;
- в `slaHead` смешаны единицы (рабочие и календарные минуты);
- `titleOf` режет по любой точке: «Визит 1.10…» → «Визит 1»;
- `installService` только для `t-alta`, но пункт меню «Обращения» владелец «Лотоса» видит (`roleObj.all`).

### 3.2 `knowledge.js` — пространства БЗ (515 строк, docs/23) · **L**

**Назначение.** Пространства с деревом узлов (`page|folder|table|diagram|file|link`). Доступ проверяется цепочкой: организация → пространство → каждый родитель → узел → функция сотрудника. Ознакомления, пересмотр, запросы доступа, разделы объектов ремонта.

**Экспорт:**
- Константы: `KB_TODAY`, `KB_ROLES` (4), `KB_ROLE_ORDER`, `KB_ROLE_CAPS`, `KB_ACCESS` (`open|limited|closed`), `KB_MODES` (`inherit|edit|listed`), `KB_KINDS`, `KB_STATUS` (`active|draft|review|outdated`), `KB_TEMPLATES` (`regs|staff|objects|blank`), `KB_SECTION`.
- Дерево: `kbPath`, `kbKids`, `kbSubtree`, `kbTop`.
- Подписи: `unitName`, `areaLabel`, `entryLabel`.
- Доступ: `kbSpaceGrant`, `entryHas`, `entryPeople`, `kbAccess`, `kbReach`, `kbEntryReach`, `kbSpaceMy`, `kbLeads`, `kbImpact`, `kbMoveImpact`.
- Остальное: `kbView`, `installKnowledge(db)` (миграция до v2), `knowledgeApi`.

**Модель:**
- `spaces[{id, name, icon, color, unit, access, template?}]`;
- `pages[{id, space, parent, pos, kind, title, mode, list:Entry[], status, owner, versions[], archived?, reviewBy?, ack?{v, audience, done[]}, sensitivity?, diagram?, file?, link?, history?}]`;
- `tables`, `entries`, `requests[kq-*]`, `rules[kr-*]`, `runs` (≤ 40), `v2`.
- `Entry = {who:'member'|'group'|'role'|'relation', ref, can:'view'|'edit', unit?, obj?}`.
- Назначения на пространство — scope `space`; на ветку — scope `page` с `until:'31.10.2026'` (срок не проверяется).

**Правила `kbAccess`:**
1. Заблокирован → нет доступа.
2. Владелец бизнеса → всё.
3. Глаголы пространства = роль на пространство ∪ роли области; при этом `limited` даёт только `view`, `closed` — ничего.
4. Назначение на страницу добавляет глаголы.
5. При проходе по пути `listed` без записи о сотруднике обрывает доступ. Ближайший узел со своим режимом определяет правку.
6. Водитель + `finance` → нет доступа.
7. Архив виден только руководителю пространства или при праве `edit`.

**Команды** (общие ошибки: `not_found` «Страница не найдена или недоступна», `forbidden` «Это может руководитель пространства или владелец бизнеса», `title` 2..120 символов):

| Команда | Права | Ключевые правила и ошибки |
|---|---|---|
| `kbCreateSpace(spec)` | владелец или роль `knowledge.settings` вне пространства | «Пространство «X» уже есть»; «Выберите уровень доступа»; не-владельцу назначается `r-kb-lead` |
| `kbCreateNode(sp, parent, kind, t)` | `create` на уровне родителя или пространства | «Выберите тип: страница, папка или схема»; «Родитель — из другого пространства»; «Нет права создавать страницы внутри «T» \| в пространстве» |
| `kbPublish(id, {base, body, title, steps, ack})` | `edit` страницы | `conflict` «Страницу уже изменили (vN). Обновите и повторите правку.» (только при `base`); «Текст — не длиннее 20 000 символов»; `draft`/`outdated` → `active`; при `ack` — событие «Новая версия «T» vN — подтвердите, что ознакомились». **Заменяет `saveKbPage`** |
| `kbSetStatus` | `edit` | «Неизвестный статус» |
| `kbSetAccess(id, {mode, list, applyOwn})` | руководитель | «Выберите, кто видит страницу»; ошибки `checkList`; запись в `history` |
| `kbMove(id, parent)` | `edit` + `create` у нового родителя | «Переносить можно только внутри пространства»; «Нельзя перенести страницу внутрь её же подстраницы» |
| `kbArchive(id, on)` | редактор или руководитель | «Главную страницу пространства архивировать нельзя» |
| `kbAck(id)` | `view` и входит в аудиторию | «Ознакомление со страницей не запрошено»; «Ознакомление запрошено у другой роли» |
| `kbRequest(id, can)` / `kbDecide(reqId, ok)` | `view` / руководитель | «Вы уже можете править страницу»; «Запрос уже отправлен»; «Запрос не найден или уже решён»; одобрение `view` → назначение `r-kb-reader` на страницу |
| `kbSetMember(sp, mid, role)` | руководитель | «Владелец бизнеса видит всё без назначения»; «Свою роль руководителя снимает владелец бизнеса» |
| `kbToggleRule`, `kbCheckReview(sp)`, `kbRunSection(objId)` | руководитель | «Правило «Пора пересмотреть» выключено»; «В пространстве нет папки «Объекты»»; пространство `sp-rep` зашито в код |

**Связи:**
- роли и области `space`/`page`;
- ремонт: связь `relation` — прораб объекта, сравнение по ФИО; `kbRunSection`;
- формы: `kbRun`, `createKbPage`/`createKbTable` в ядре `api.js`;
- узел `kb-lnk1` → формы;
- финансовый запрет для водителя (аналог `canEarnings`).

**Чистые функции → тесты.** `S` = Альта после `installKnowledge`.

| Вызов | Ожидание |
|---|---|
| `kbPath({pages:[a, b(a), c(b)]}, c)` | `[a, b, c]`; при цикле — длина 40, без зависания |
| `kbTop(S.knowledge, 'sp-log').map(id)` | `['kb-log-home','kb-f-reg','kb-5','kb-d1','kb-f-drv','kb-fin','kb-file1','kb-lnk1']` |
| `areaLabel(S, {unit:'f-msk-sever'})` / `{unit:'r-msk'}` / `{unit:null}` | 'фирма «Север Логистик»' / 'регион «Москва»' / 'вся организация' |
| `entryLabel(S, {who:'role', ref:'r-driver', unit:'f-msk-sever'})` | 'Роль «Водитель» · «Север Логистик»' |
| `kbSpaceGrant(S, 'm-kotova', {id:'sp-log'}).id` / `('m-vasiliev', sp-log)` | 'akb-1' / null |
| `kbAccess(S, M, 'm-vasiliev', kb-1)` | view ✓, edit ✗, create ✗ |
| `kbAccess(S, M, 'm-vasiliev', kb-fin)` | view ✗, `fn:true` |
| `kbAccess(S, M, 'm-kotelnikova', kb-fin)` | view ✓, edit ✗ (в списке только `view`) |
| `kbAccess(S, M, 'm-sokolov', kb-o-obj-42-2)` / `…-5` | edit ✓ / view ✗ |
| `kbSpaceMy(S, M, 'm-vasiliev', sp-log)` | `{lead:false, view:true, edit:false, role:'Читатель по уровню «Ограниченное»'}` |
| `kbReach(S, M, 'm-vasiliev', kb-fin-1)` | `{ok:false, why:'функция «Водитель» не открывает финансовые страницы'}` |
| `dval('30.09.2026')` / `dval('1.1.2026')` | 20260930 / 0 |
| `kbPublish('kb-1', {base:1})` от m-kotova | `conflict` «Страницу уже изменили (v2). …» |
| `kbCheckReview('sp-log')` от m-kotova | `{due:1}`, `kb-2.status === 'outdated'`; повторный вызов → `{due:0}` + запуск `stopped` |

**Риски:**
- роли `r-kb-*` протекают в `M.can`;
- `createKbPage` и `kbRun` опираются на устаревшее `page.access`;
- `kbView` отдаёт всем читателям `list`/`history`/`ack.done`;
- `until` у назначений не проверяется;
- нет `assertActive`;
- главная страница определяется по названию «Обзор»;
- `kbRequest` требует `view`, поэтому запросить доступ к невидимой странице нельзя.

### 3.3 `documents.js` — документы (988 строк, docs/24) · **XL, делить**

**Назначение.** Слой Ортуса над офисным движком (Р7 или ONLYOFFICE): папки и доступ (5 уровней), тексты, таблицы с собственным формульным движком, PDF (OCR, слияние, сжатие, PDF/A), версии, маршрут согласования с задачей в проекте `pj-docs`, ПЭП по SMS, внешние ссылки.

**Подмодули** (строки — естественные границы файлов при переносе):

| # | Подмодуль | Строки | Чистота | Размер |
|---|---|---|---|---|
| A | утилиты: `addWork(дд.мм.гггг, n)` с праздником 04.11, `plural`, `shortName`, `shaOf` | 6–19 | чистые | S |
| B | перечисления: `DOC_LEVELS`, `LV`, `DOC_KINDS`, `STEP_KINDS`, `APPROVE_MODES`, `DOC_ROLES` | 21–34 | константы | S |
| C | записи доступа: `entryHas`, `entryLabel`, `entryPeople`, `entryKey`, `entryIcon`, `objOf`, `folderPath` | 36–67 | читают db | S |
| D | доступ: `docAccess` (уровни 0–5 + цепочка), `docRights`, `finSees`, `protEdit`, `engineCfg` | 69–147 | читают db + M | M |
| E | последствия: `docShareImpact`, `docMoveImpact` | 149–160 | читают db | S |
| F | маршрут: `stepWaiting`, `docStatus`, `docWaits`, `routeSheet` | 162–213 | чистые | S |
| G | поля CRM: `fieldVals`, `fillTokens` | 215–235 | читают db / чистая | S |
| H | **табличный движок**: `colName`, `parseKey`, `keyOf`, `rangeKeys`, `inRange`, `lex`, `parse`, `checkFormula`, `sheetCompute`, `fmtVal`, `gridOf`, `csvCells`; `FN_LIST` (20 функций RU/EN) | 237–402 | **полностью чистый** | M |
| I | шаблоны `DOC_TEMPLATES` (3) | 404–412 | константы | S |
| J | сид (Альта и прочие) | 414–509 | фабрики | M |
| K | `installDocs` — роли, `actions.docs`, проект `pj-docs` | 511–524 | мутирует | S |
| L | `docsView` | 526–542 | мутирует клон | S |
| M | движок маршрута: `activate`/`advance`/`syncTask`, `makePdfA`, `JOBS` | 545–658 | мутирует | L |
| N | 32 команды | 659–987 | мутируют | L |

**Модель:**
- `db.docs = {folders, items, v1}`.
- Папка: `{id, name, parent, unit, mode:'inherit'|'listed', share:Entry[], owner, sensitivity?, link?, routeTpl?}`.
- Документ: `{id, kind:'text'|'sheet'|'pdf', title, folder, owner, status:'draft'|'agreed'|'approved'|'signed', mode, share, links, comments, suggestions, history(≤30), jobs(≤8), tmp, v, versions[], route?, ext?, pdfa?}`.
- Поля по виду: `text` — `body` (блоки); `sheet` — `sheets` с `cells{A1:{v|f}}`, `prot`, `crm`; `pdf` — `pages`, `ocr`.
- Маршрут: `{steps[{kind:'approve'|'sign'|'ack'|'ext', mode:'all'|'seq'|'any', who, days, decisions, status}], rules{lock, notAuthor, commentOnBack, escalate}, status:'active'|'returned'|'done'|'cancelled'}`.

**Права:**
- `need(d, lv, what)`: L = 0 → `not_found` «Документ не найден или недоступен»; L < lv → `forbidden` «Чтобы {what}, нужен уровень «X». У вас — «Y»»;
- блокировка на время маршрута → `validation` «vN на согласовании — правка закрыта до решения. Комментировать можно».

**Команды**, группы:

| Группа | Команды | Ключевые ошибки и эффекты |
|---|---|---|
| Текст | `docCreate`, `docRename`, `docBlock`, `docBlockAdd` | создавать — с уровнем L ≥ 4 на папку: «Создавать документы в «F» может тот, кто правит эту папку»; ≤ 20 файлов; скан → задание OCR; `conflict` «Абзац уже удалили. Обновите документ»; ≤ 4000 символов |
| Правки | `docSuggest`, `docSuggestDecide` | `conflict` «Текст абзаца уже изменили. Обновите документ»; события «… предлагает правку», «Принята \| Отклонена ваша правка» |
| Комментарии | `docComment`, `docReply`, `docResolve`, `docMentionSkip` | ≤ 2000 символов; упоминание сотрудника без доступа → `noAccess` |
| Доступ | `docShare`, `docGrant`, `docMove` | «Нельзя выдать «X»: это выше вашего уровня «Y»»; внешние ссылки — только владелец бизнеса; события «Вам открыт доступ к «T»» |
| Таблицы | `docCell`, `docAddSheet`, `docCrmSync` (заглушка) | «Лист скрыт: нужны права на финансы»; «Диапазон «N» (R) правят: …»; «Столбец X приходит из наборов «S»: …»; «Ошибка в формуле: …» |
| Версии | `docCut`, `docRestore` | «У vN нет копии содержимого» |
| Маршрут | `docRouteStart`, `docRouteDecide`, `docSignStart`, `docSign`, `docAck`, `docAckClose`, `docRouteResume`, `docRouteCancel` | до 6 шагов, `days` 1..10; задача в проекте (`M.projCan create`) → `syncTask` пишет `t.docRoute`; SMS-код `1000 + (seq*7919) % 9000`; после `sign`/`ext` → PDF/A |
| PDF и задания | `docOcrWord`, `docPages`, `docStamp`, `docJob`, `docJobPoll`, `docJobRetry` | `JOBS`: ocr 3200 мс, to_docx 2600, to_xlsx 2200, pdfa 1800, compress 1600, merge 2400, to_pdf 1600; `docJobPoll` опирается на `Date.now()` |

**Связи:**
- задачи и проекты: `M.buildWf('approval')`, `M.projCan`, `db.tasks` + `docRoute`; `api.js` запрещает ручную смену статуса такой задачи;
- ремонт: связь `relation` — прораб объекта, поля `obj.*`;
- логистика: `fieldVals` (рейс, машина);
- платформа: `tenants[0]` ⚠ всегда «Альта»;
- чаты: импортируют `entryHas`, `objOf`;
- касса, склад, формы, БЗ — не связаны.

**Чистые функции → тесты:**

| Вызов | Ожидание |
|---|---|
| `addWork('01.10.2026', 1)` / `(…, 2)` / `('03.11.2026', 1)` / `(…, 0)` | '02.10.2026' / '05.10.2026' / '05.11.2026' / '01.10.2026' |
| `shortName('Алексей Соколов')` / `shortName('')` | 'А. Соколов' / '—' |
| `entryKey({who:'relation', ref:'foreman', obj:'obj-42'})` | 'relation:foreman::obj-42' |
| `stepWaiting({kind:'approve', mode:'seq', who:[a,b,c], decisions:[]})` | ['a'] |
| `stepWaiting({kind:'approve', mode:'any', who:[a,b], decisions:[{member:b, decision:'ok'}]})` | [] |
| `docStatus({status:'signed'})` / `({pdfa:true})` | ['ok','verified','Подписан · ПЭП'] / ['neutral','inventory_2','PDF/A · архив'] |
| `fillTokens('Привет, {Имя}!', {Имя:'Ира'})` / `('{X}', {})` | 'Привет, Ира!' / '{X}' |
| `parseKey('B3')` / `parseKey('AA1')` / `rangeKeys('B2','A1')` | {c:1, r:3} / null / ['A1','B1','A2','B2'] |
| `checkFormula('=СУММ(A1:A3')` / `('=1+')` / `('=1 @')` | 'не закрыта скобка в СУММ' / 'формула оборвалась' / 'непонятный символ «@»' |
| `sheetCompute({cells:{A1:{v:2}, A2:{v:3}, A3:{f:'=A1+A2'}}}).get('A3')` | 5 |
| циклическая ссылка / `'=1/0'` / `'=FOO(1)'` / `'=ЕСЛИ(1>2;"да";"нет")'` / `'=-2^2'` | {err:'#ЦИКЛ!'} / {err:'#ДЕЛ/0!'} / {err:'#ИМЯ?'} / 'нет' / 4 |
| `fmtVal(0.041667, 'dpct')` / `(56405, 'n0')` / `(true)` | '+4,2 %' / '56 405' (U+00A0) / 'ИСТИНА' |
| `gridOf({cells:{A1:{v:1}, B2:{f:'=A1*2'}}})` | [['1',''],['','2']] |
| Сид `fuelSheets()[0]`: F3 / I7 / F9 | 12.5 / 56405 / 13.75 |
| `docAccess`: папка `share [{member u1, comment}]`; `d.mode='listed'`; `d.owner='u1'`; `tmp` edit | L=2 / 0 / 5 / 4 |

**Риски:**
- **нет проверки доступа** в `docRouteDecide`, `docSignStart`, `docSign`, `docAck`, `docAckClose`, `docRouteCancel`, `docJobPoll`;
- демо-режим `as` позволяет решить за другого (включая подпись заказчика);
- SMS-код отдаётся клиенту;
- утечка финансового листа через `versions[].sheets`;
- `СУММ(1,5)` = 1.5: запятая служит и десятичным разделителем, и разделителем аргументов;
- `addWork` конфликтует по имени с `service.addWork`.

### 3.4 `chats.js` — чаты (598 строк, docs/25) · **L**

**Назначение.** Пять видов чатов: `direct`, `group`, `area`, `record`, `announce`. Состав считается из «источников» (все, группа, роль в области, сотрудник, прораб объекта, водитель рейса) и именных назначений `scope:{chat}`. Права — цепочка: политика вида → роль в чате → модуль «Чаты» → функция «Водитель». Есть политики хранения и квота места, маска ПДн, опросы, «важное» с подтверждением, временные и одноразовые сообщения.

**Экспорт:**
- Форматирование (чистые): `gb`, `plural`, `tsDay`, `tsTime`, `tsLabel`, `maskPdn`, `hasPdn`, `chatTitle`.
- Справочники: `CHAT_KINDS`, `CHAT_ROLE_LABEL`, `RANK`, `CHAT_ROLES` (5), `EDIT_*`/`RCPT_*`/`TEMP_*`/`FWD_*`/`FULL_*`, `BOUNDS`, `DEFAULT_POLICY`.
- Чистые над db: `policyOf`, `srcLabel`, `srcIcon`, `chatAccess`, `chatRights`, `chatPeople`, `chatMatrix(P, kind)`.
- Фабрики: `installChats(db, M)`, `chatsView`, `chatsApi`.

**Модель:**
- `db.chats = {v1, now:665, policy, items[]}`.
- Чат: `{id, kind, title, unit, owner, status, sensitivity:'normal'|'finance'|'pdn', sources[], pair?, record?, topics, hold?, buckets[], usedMb, savedMb, msgs[], seq, lastRead, pinned, journal, over}`.
- Сообщение: `{id:'cm-N', seq, ts (мин), by, text, reads, files[], doc?, important?, temp?, spoiler?, poll?, deleted?, edits[], revealed[]}`.
- Политика: `{textY, filesD, voiceD, rcpt, rcptD, delD, edit, maxMb, quotaMb, temp, fwd, pdn, onFull:'block'|'ring'|'archive'|'compress'}`.

**Права (`chatRights`):**
- `write` = не архив и ранг ≥ 2 (в `announce` ≥ 3) и (владелец бизнеса или `vb.create`);
- `mod`/`pin` = ранг ≥ 3;
- `announce` = `write && mod && (own || review)`;
- `pdn` = только владелец бизнеса;
- `task` = `write && can(tasks, create)`;
- `members` и `settings` — по роли `owner`.

Общие ошибки: `not_found` «Чат не найден или недоступен»; `forbidden` «Недостаточно прав».

**Команды:**

| Команда | Ключевые правила и ошибки |
|---|---|
| `chatOpen` (0 мс, без сети) | отмечает прочтение |
| `chatSend(id, spec)` | 11 проверок по порядку: «Напишите сообщение или прикрепите файл»; «Больше 4000 знаков: …»; `forbidden` для `@все` и «важного» без права; временные и одноразовые — по политике; опрос: 2–10 вариантов, 1–168 ч; размер файла ≤ `maxMb`; квота `freeFor`; события: упоминания, «Важное в «…»», личное сообщение |
| `chatEdit` / `chatDelete` | окно правки `EDIT_MIN` (15 мин / 48 ч / без ограничения); «Окно правки закрыто: …»; удержание; «Чужие сообщения удаляют модераторы»; при удалении модератором нужна причина |
| `chatAck` / `chatVote` / `chatPollClose` / `chatPin` / `chatReveal` / `chatOpenOnce` / `chatSaveTo` | «Подтверждение не запрошено»; «Опрос закрыт …»; «В этом опросе один вариант»; «Номер скрыт: нужно право «ПДн без маски»»; одноразовый файл открывается один раз |
| `chatToTask` | задача `T-(70+seq)` в `db.tasks` со ссылкой `{kind:'chat'}`; проект `fleet` для `f-msk-sever` зашит в код |
| `chatCreate(spec, dryRun)` / `chatSources(id, src, dryRun)` | `checkSources`: «Владельца чата назначает владелец бизнеса», «»Все сотрудники» добавляет владелец бизнеса», «Роль добавляется только в вашей области «U»»; превью `{joined, pending, skipped}` |
| `chatSetFull` / `chatCleanup` / `chatPolicySet` | фильтры `video90`, `photo180`, `voice30`, `docs30`; `BOUNDS` → «Значение вне пределов организации: a–b»; заметки о последствиях |
| `chatTick(hours)` | демо-сдвиг часов, **без прав** |

**Связи:**
- документы: импорт `entryHas`, `objOf`; вложение `{kind:'doc'}`;
- ремонт и логистика: источники `relation` и `tripDriver`, `record.nav`;
- задачи: `chatToTask` — в старом `tasksVM` нет обработчика для ссылки вида `chat`;
- роли и область `chat`;
- события.

**Чистые функции → тесты:**

| Вызов | Ожидание |
|---|---|
| `gb(200)` / `gb(4.1)` / `gb(1000)` / `gb(4600)` | '200 МБ' / '4,1 МБ' / '1 ГБ' / '4,6 ГБ' |
| `tsDay(0)` / `tsDay(-1)` / `tsTime(665)` / `tsTime(-1)` | '01.10' / '30.09' / '11:05' / '23:59' |
| `tsLabel(600, 665)` / `tsLabel(-420, 665)` | '10:00' / '30.09 17:00' |
| `maskPdn('звонить: +7 916 482-31-17.')` / `maskPdn('89161234567')` / `maskPdn(null)` | 'звонить: +7 ••• •••-••-17.' / '+7 ••• •••-••-67' / '' |
| `hasPdn` дважды подряд на одной строке | `true` оба раза (сброс `lastIndex`) |
| `srcLabel({}, {who:'tripDriver', trip:'Р-208'})` / `{who:'zzz'}` | 'Водитель рейса Р-208' / '—' |
| `policyOf({chats:{policy:DEFAULT_POLICY}}, {kind:'record'})` | `maxMb 500, quotaMb 5000, temp 'viewonce'` |
| `chatMatrix(DEFAULT_POLICY.announce, 'announce')`, строка «Писать» | ['y','y','n','n'], 'В объявлениях пишут модераторы' |
| `chatCleanup('ch-obj42', ['video90'], true)` | `{n:212, mb:1900, after:2700, quota:5000, saved:1100, held:6, heldMb:200}` |
| `freeFor(ch-obj42, block, 500)` | `validation` «Место чата заполнено: 4,6 ГБ из 5 ГБ. …» |
| `chatAccess(S, M, 'm-vasiliev', ch-dzs)` | `{ok:false, reason:'not_member', why:'Личный чат читают только двое участников'}` |
| `chatAccess(…, 'm-ilyin', ch-obj42)` | `{ok:false, pending:true, reason:'invited', role:'reader'}` |

**Риски:**
- **удалённое сообщение восстанавливается во view**: маска ПДн, `editLog`, файлы, опрос берутся из исходного `m`;
- `@всем` проходит проверку прав (строгий regex), но рассылается всем (нестрогий);
- `@Имя` уведомляет не-участников;
- `held()` не работает: поле `m.held` нигде не выставляется;
- `freeFor` мутирует до `throw`;
- id задач `T-(70+seq)` и `T-(60+seq)` из ядра пересекаются.

### 3.5 `cash.js` — касса (561 строка, docs/26) · **L**

**Назначение.** Кассы подразделений пяти видов: `drawer`, `acquiring`, `advance`, `safe`, `bank`. Смены со сверкой (купюры, Z-отчёт, терминал), «входящие» предложения модулей, подотчёт с чеками, согласование сверх лимита роли, перемещения, сторно. Операции не удаляются, ККТ — ручной ввод № ФД.

**Экспорт:**
- Константы: `CASH_DAY`, `KIND`, `MODE` (`none|open|blind`), `KKT`, `OP` (8 типов со знаком), `REQ_LABEL`, `METHOD`, `METHODS_OF`, `CATS`, `DENOMS`, `PRICE`, `CASH_OPT0`.
- Чистые: `nameOf`, `rub`, `signRub`, `plural`, `dueState`, `unitTitle`, `opSign`, `balanceOf`, `openShift`, `parseSum`, `drawerFor`, `accCan`, `rightsText`.
- С `M`: `cashAccess(db, M, mid, acc)`, `cashPeople`, `cashProposals`, `cashView`.
- Мутируют: `installCash(db, M)`, `cashApi`.

**Модель:** `db.cash = {v1, accounts, ops, shifts, transfers, receipts, requests, proposals, dismissed}`.
- Операция: `{id:'K-…', account, type, amount, method, cat, basis, at, time, by, src?, ref?, receipt?, shift?, group?, sign?, reverses?, reversedBy?}`.
- Смена: `{status:'open'|'review'|'closed', counts, z, term, expected, diff, decision, toSafe}`.
- Параметры роли `role.cash = {balance, self, out, refund, advance}` — лимиты, `null` = без лимита.

**Доступ (`cashAccess`):**
1. Нет сотрудника или он заблокирован → нет доступа.
2. Роль `all` → всё.
3. Нет модуля cash в ролях → «в ролях нет модуля «Касса»».
4. Покрытие кассы: `self` — только свой подотчёт; `account` — эта касса и её эквайринг; `unit` — через `scopeCovers`; касса без `unit` — только `tenant`.
5. Параметры объединяются: глаголы и баланс — объединением, лимит — максимум, `null` выигрывает.

**Общие ошибки:** `not_found` «Касса «X» недоступна: why»; `forbidden` «Недостаточно прав в кассе «X»»; `subscription_restricted`.

**Команды:**

| Команда | Ключевые правила и ошибки (дословно) |
|---|---|
| `cashPost(spec)` | «Подотчёт пополняется выдачей из кассы, расход отчитывается чеком сотрудника»; «Возвраты — действие «Изменять» в роли»; «Укажите основание: за что и кому»; сверх лимита → заявка `{request}`; ФД: «Укажите № ФД из чека: цифры, до 10 знаков. …»; `conflict` «Чек № ФД N уже внесён: …»; «В «X» нет столько наличных: остаток ушёл бы в минус»; «Возвратов по K больше оплаты: доступно …»; «Смена в «X» закрыта — откройте смену, чтобы проводить оплаты» |
| `cashPostProposal(key, pay)` / `cashDismiss` / `cashLink` | `conflict` «Предложение уже проведено, отклонено или недоступно»; «Части оплаты дают X, а к оплате Y»; «У «X» нет терминала: карта и СБП недоступны» |
| `cashReverse(opId, why)` | `review`; «Перемещение исправляется обратным перемещением»; `forbidden` «Свою операцию сторнирует второй сотрудник с правом «Проверять»»; `conflict` «Операция уже исправлена» |
| `cashShiftOpen` / `cashShiftClose` / `cashShiftReview` | «Касса работает без смен»; `conflict` «Смена уже открыта \| закрыта \| решена»; Z-отчёт обязателен при ручной ККТ; |diff| ≤ `tol` → `closed`, иначе `review`; «Кто закрывал смену, тот не принимает её расхождение» |
| `cashTransfer` / `cashTransferAccept` | «Перемещают наличные между кассой, сейфом и счётом. …»; принимает получатель |
| `cashIssue` / `cashReceipt` / `cashReceiptDecide` / `cashReturn` | «Себе под отчёт выдаёт другой сотрудник»; «Лимит на руках у X — Y»; «Срок отчёта — в формате ДД.ММ»; «Свой чек проверяет другой сотрудник» |
| `cashApprove(id, ok, why)` | «Свою заявку согласует другой сотрудник»; `issue` → перемещение, `out`/`refund` → `write` |
| `cashAccountCreate(spec)` | `M.can(cash, settings)`; `conflict` «Касса с таким названием уже есть» |

**Связи:**
- роли и область `account`; в `api.js` — `assign`/`saveRole`, `rolePermKeys`;
- логистика: принятые расходы рейса → предложение «Возместить»;
- SPA: завершённые визиты → приход по `PRICE`;
- сид-предложения от ремонта и обращений;
- CRM: раздел «Данные» (`cashOps`, `cashShifts`), «Главная» (`cash.todo`), меню «Подотчёт» для водителя и прораба;
- задачи, формы, БЗ, документы, чаты — не связаны.

**Чистые функции → тесты:**

| Вызов | Ожидание |
|---|---|
| `dueState('30.09')` / `('01.10')` / `('03.10')` / `(null)` | 'late' / 'today' / 'ok' / 'none' |
| `parseSum('1 500,50')` / `('abc')` / `('1,2,3')` | 1500.5 / NaN / NaN |
| `opSign({type:'out'})` / `({type:'adjust', sign:-1})` / `({type:'zzz'})` | −1 / −1 / 0 |
| `balanceOf(seedAlta, 'ca-spa')` / `'ca-sever'` / `'ca-safe'` / `'ca-adv-vas'` | 7350 / 30760 / 116840 / 4450 |
| `signRub(-60)` / `signRub(100)` | '−60 ₽' (минус U+2212) / '+100 ₽' |
| `rightsText({ok:true, all:true})` | 'Всё, включая остаток и сверку' |
| `cashAccess(…, 'm-morozova', ca-sever)` / `'m-vasiliev', ca-adv-vas` / `'m-kotova', *` | `{ok:false, why:'касса вне области назначения'}` / ok, `own:true` / 'в ролях нет модуля «Касса»' |
| Закрытие смены: counts {5000:3, 2000:4, 1000:6, 500:4, 200:2, 100:2}, coins 240, expected 31900, tol 100, float 5000 | counted 31840, diff −60 → `closed`, `toSafe` 26840 |

**Риски:**
- сид `sh-117` не сходится: по номиналам 31340 при `counted` 31840;
- частичные мутации до `throw`;
- нет `active()` в `cashApprove`/`cashTransferAccept`;
- `cashApprove(issue)` не проверяет остаток источника;
- у Котовой — ответственной за `ca-sever` и автора `rq-1` — нет роли с cash;
- unit `'spa'` в «Альте» не существует.

---

## 4. Точки интеграции с CRM (`Downloads\Ортус CRM.dc.html`)

### 4.1 Как CRM подключает модули

**Загрузка.** `boot()` (НОВ:2397–2409) грузит `api.js`, `models.js`, `roadmap.js` и новый **`service.js`** (`this.mods = {A, M, R, SV}`). `SV.svcNow`/`SV.slaHead` нужны «Главной» (НОВ:4075–4076). Остальные четыре модуля подключает сам `api.js`.

**Общая БД.**
- Каждой организации соответствует одна `db`: `dbs = {t-alta, t-lotos}`, общий `platform`.
- UI держит `this.state.db = api.load()` и обновляет её из `r.db`/`e.db` после каждой команды.

**`mid`** — id участника текущего персонажа: `midOf = (org, p) => (MEMBER_BY[org] || MEMBER)[p]` (НОВ:2299, 2830). Передаётся в `api.setActor(mid, org)` и пропсом `mid` в дочерние экраны.

**`onApi`.** Шины событий, `postMessage` и iframe нет. Дочерние `<dc-import>` получают пропсы и колбэки:

```js
onApi: (m, a, ok) => this.run('<префикс>:' + m, () => this.api[m](...a), ok || null, { quiet: [...] })
```

`run()` (НОВ:2419–2434) ставит `busy[ключ]`, при успехе записывает `r.db` и показывает тост `ok`. При ошибке пишет `e.db` и показывает тост, если код не входит в `quiet`. Права оболочка проверяет только на уровне раздела: `gateVM` → `M.can(db, mid, PAGE_MOD[page], 'view')`.

### 4.2 Префиксы → экраны → методы

| Префикс (НОВ) | Экран `<dc-import>` | Пропсы | `onNav` | Методы (из API модуля) | `quiet` | Модуль прав |
|---|---|---|---|---|---|---|
| `fx` = `formsProps()` 4501–4508 (тег 1588) | «Формы и опросы», `embedded` | `db, mid, tenant, focus{form, tab, resp, key}, onFocusDone, onApi, onNav` | `'kb', id` → `kbSel` + переход в knowledge | `publishForm`, `saveFormDraft`, `discardFormDraft`, `createForm`, `updateForm`, `createKbPage`, `createKbTable`, `backfillKbRule`, `retryFormAction` | validation | forms |
| `sv` 2858–2859 (тег 1593) | «Обращения» | `db, mid, open=svcSel, onOpened, onApi, onToast` (**нет `onNav`**) | — | 10 × `svc*` | validation, transition, forbidden | service |
| `tj` 2860–2862 (тег 1598) | «Задачи и проекты» (`tj.modern`), иначе старый `tasksVM` | `db, mid, legacy, modern, back, onApi, onNav, onToast` | `'leads'` → старый канбан; `'docs', id` → `docSel` | 16 методов проектов + `commentTask`, `toggleTaskCheck` | — | tasks + `projCan` |
| `kb2` 2866–2867 (тег 1826) | «База знаний» | `db, mid, onApi, onNav, onToast` (**нет `open`**, `kbSel` теряется) | `setPage(k)` | 14 × `kb*` (+ возможно `saveKbPage`) | — | knowledge |
| `dx` 2868–2870 (тег 1830) | «Документы» | `db, mid, open=docSel, onOpened, onApi, onNav, onToast` | `'repair', id` → вкладка schedule; `'kb'` | 32 × `doc*` | — | docs |
| `cht` 2871–2873 (тег 1834) | «Чаты» | `db, mid, open=chatSel, onOpened, onApi, onNav, onToast` | `'repair'`, `'docs'`, `'fleet'` (у водителя → `today`) | 18 × `chat*` | — | chat |
| `csx` 2877–2879 (тег 1898) | «Касса» | `db, mid, open=cashOpen ('acc:<id>' \| 'sh:<id>'), onOpened, onApi, onNav, onToast` | `'users', tab`; `'review', id`; `'repair'` | 16 × `cash*` | — | cash (+ `role.cash`) |
| `rp` 4261–4270 (тег 2121) | «Ремонт и стройка» | новые: `obj, changes, can-edit, on-change` | — | `proposeChange` 4388, `assignForeman` 4429, `setChange` 4433 (прямые вызовы оболочки) | — | repair |

Из оболочки убраны прямые вызовы `saveKbPage` (СТ:4172), `addCashOp`/`reverseCashOp` (СТ:4267–4272) и `publishForm` (СТ:4449): теперь их делают дочерние экраны.

### 4.3 Навигация и «Главная»

**`PAGE_MOD`:** добавлены `chat`, `docs`, `service`, `repairCatalog → repair`, `repairSupply → repair`.

**`CORE_ITEMS`:** добавлены «Чаты», «Обращения», «Документы». Бейджи:
- `chatN` — Σ `my.unread`;
- `svcBadge` — открытые обращения с неостановленным `sla.first`;
- `docWait` — Σ `my.wait`;
- `cashN` — `db.cash.badge`.

**Меню по персонажам:**
- **Водитель:** + «Подотчёт» (`cashSelf`, если есть `advance` со своим `member`), chat, knowledge, docs.
- **Прораб:** + «Подотчёт», chat, tasks, knowledge, docs.
- **Массажист:** + chat, cash.
- **Владелец:** «Ремонт» дополнен «Снабжение» и «Шаблоны и расценки». Отдельного раздела «Склад» нет.

**`homeVM`, блок «Требует решения»** (4074–4093):
- `SV.slaHead` (риск или просрочка) → `service` + `svcSel`;
- `docs.items[].my.wait` (`sign`, `approve`, `ack`, `returned`, `mention`, `ocr`) → `docs` + `docSel`;
- `chats.items[].my.ackWait` → `chat`;
- `db.cash.todo` → `cash` + `cashOpen`.

**«Данные»** (4194–4196): наборы `cashOps` и `cashShifts` при `db.cash.v1`; ответы форм открываются в «Формах» с фокусом.

### 4.4 Что домен должен дать UI (контракт)

1. Адаптер с методом по строковому имени (`api[m](...a)`), со всеми 166 методами.
2. Ответ `{data, db}`; ошибка — `ApiError{code, message, db}`. Коды, которые UI различает: `validation`, `forbidden`, `transition`, `conflict`, `not_found`, `offline`, `subscription_restricted`, `module_off`.
3. Поля view, которые читает оболочка:
   - `service` (или `null`): `requests[].sla.first.stopped`, `status`, `key`, `hidden`;
   - `docs.items[].my.wait[]`;
   - `chats.items[].my.{unread, ackWait}`;
   - `cash.{v1, hidden, accounts[].kind/member, ops, shifts, todo, badge}`;
   - `projects[].wf`, `tasks[].docRoute`.
4. Экспорт `service.js`: `svcNow`, `slaHead` — оболочка импортирует их напрямую.
5. В `models`: `projCan`, `buildWf`, `VERB_LABEL`, `formVal`, `CORE` с `chat`/`docs`/`service`, `scopeLabel` с новыми областями.
6. Ключи открытия: `svcSel`, `docSel`, `chatSel`, `cashOpen 'acc:'|'sh:'`. Значения `nav`/`src.nav`: `fleet`, `repair`, `review`, `spa`, `docs`, `kb`, `users`, `leads`.

### 4.5 Пробелы интеграции

1. **Семи дочерних `*.dc.html` в комплекте нет**: ни в `Downloads`, ни в `design`, ни в архивах. Без них нельзя ни сделать e2e-паритет с эталоном, ни проверить, какие методы вызываются.
2. В `kb2` не передаётся `open`, поэтому переход «Форма → страница БЗ» теряет id.
3. У `sv` нет `onNav`: из обращения нельзя перейти к задаче или кассе.
4. Задача из чата (`links.kind:'chat'`) не обрабатывается старым `tasksVM`: нет ни иконки, ни перехода.
5. У «Лотоса» `db.service === null`, но пункт «Обращения» у владельца есть.
6. В `createHttpAdapter` нет ни одного нового метода.

---

## 5. Предлагаемое разбиение на пакеты и параллельные потоки

### 5.1 Принципы

- **Модуль = каталог.** Каждый агент владеет `src/modules/<m>/**`, `test/modules/<m>/**` и своим файлом кейсов `test/conformance/cases/modules/<m>.ts`. В чужие каталоги он не пишет.
- **Единый контракт модуля** в общем слое, чтобы адаптер собирался без правки модулей:

  ```ts
  // packages/domain/src/core/module.ts
  export interface ModuleCtx { getDb(): TenantDb; getActor(): string | null; clock: Clock; ids: IdGen;
    ApiError: typeof ApiError; can: AccessApi; emit(text: string, to: string[], opts?: {sensitive?: string; unit?: string}): void;
    tasks: TaskPort; }  // TaskPort — создание и синхронизация задач для docs/chats/service без импорта модуля задач
  export interface DomainModule<S> { key: ModuleKey; install(db: TenantDb, seedOpts: SeedOpts): void;
    view(db: TenantDb, actor: string, slice: S): S | null; commands(ctx: ModuleCtx): Record<string, CommandFn>;
    methods: readonly string[]; delays: Record<string, number>; }
  ```

- **Регистрацию модулей** (`src/modules/index.ts`, `seed/compose.ts`, реестр методов адаптера) держит интегратор. Модуль добавляет туда ровно одну строку через PR интегратора.
- **Межмодульные зависимости — только через `core`.** Документы и чаты используют общий `core/entries`; задачи создаются через `TaskPort`; часы — через `Clock`. Прямых импортов `modules/a → modules/b` нет. Исключение — тип `KbTable` для форм: его вынести в `core/types`.

### 5.2 Каталоги

```text
frontend/packages/domain/src/
├─ core/                      ← WS-05 (уже запланирован) + расширение «v2-core»
│  ├─ types/{common,scope,entities-core,entities-modules}.ts   # Scope: 11 типов; Entry; Event; TenantDb со всеми срезами
│  ├─ errors/{api-error,codes,map}.ts                          # 18 кодов + правила module→canon (forbidden/not_found)
│  ├─ clock.ts                                                 # Clock + DEMO {now:'2026-10-01T10:30+03', cashDay:'01.10', kbToday/docToday:'01.10.2026', chatNow:665, svcBase:'2026-10-01T16:24+03'}; TZ Europe/Moscow
│  ├─ ids.ts                                                   # IdGen поверх db.seq (cm-, K-, T-, ach-, kb-, …) — единый, детерминированный
│  ├─ format.ts                                                # plural, rub, signRub, num, int, gb, hm/hhmm, shortName, maskPhone/maskPdn (общая маска)
│  ├─ access/{units,grants,can,scope-label,role-perm-keys,object-scoped}.ts  # + политика «роли с объектной областью не дают глобального can»
│  ├─ entries.ts                                               # Entry {who, ref, unit, obj, level/can}; relationHas (прораб объекта по id, не по имени)
│  ├─ dictionaries.ts, module.ts (контракт), task-port.ts
├─ modules/
│  ├─ logistics/ platform/ people/ calendar/ spa/              ← WS-05/WS-06 как запланировано (без изменений)
│  ├─ forms/        {templates,form-val,validate-publish,kb-actions,commands,seed}.ts
│  ├─ tasks/        {workflow(buildWf,trCheck),access(projAccess,projCan),hierarchy(checkParent),files(checkFiles),automation(autoFire),commands,seed(normProjects)}.ts
│  ├─ knowledge/    {tree,labels,access,impact,view,commands,seed,migrate-v2}.ts
│  ├─ documents/
│  │  ├─ sheet-engine/{refs,lexer,parser,eval,format,grid,csv}.ts   ← отдельный поток, чистый
│  │  ├─ {access,impact,route,fields,templates,pdf-jobs,view,commands,seed}.ts
│  ├─ chats/        {format,policy,access,storage,view,commands,seed}.ts
│  ├─ cash/         {format,balance,access,proposals,shift-math,todo,view,commands,seed}.ts
│  ├─ service/      {work-calendar(addWorkMinutes,workBetween),sla,format,access,view,commands,seed}.ts
│  └─ repair/       {view-filter,changes,commands,seed}.ts
├─ seed/{platform,alta,lotos,extra}.ts + compose.ts            # base seed → normProjects → service → knowledge → docs → chats → cash
└─ index.ts
frontend/packages/adapter/src/mock/
├─ core/{state,guards,cmd,view-compose,delays}.ts            ← WS-06
├─ methods/{platform,org,people,fleet,core,spa,files}.ts      ← WS-06 (без addCashOp/reverseCashOp)
└─ modules.ts                                                  # реестр: ...forms.commands(ctx), ...tasks..., ...cash...
```

Имена: `service.addWork` → `addWorkMinutes(start, mins, cal)`, `documents.addWork` → `addWorkDays('дд.мм.гггг', n, holidays)`.

### 5.3 Потоки, порядок, размеры

| Поток | Состав | Зависит от | Блокирует | Размер |
|---|---|---|---|---|
| **P0 · core-v2** | расширение WS-05: `Scope` (11), `Entry`, `Clock` (5 демо-сейчас + TZ), `IdGen`, общий `format` (маски ПДн и телефона), `object-scoped` правило для `can` (решение по факту 6), `core/entries` (связь «прораб» по id), `TaskPort`, контракт `DomainModule`, `seed/compose` (пустые хуки), коды и маппинг `forbidden/not_found` | WS-05 | все P1 | **M** |
| P1a · tasks | `buildWf`, `projAccess`, `projCan`, `trCheck`, `approversOf`, `childrenOf`, `isDone`; `checkParent`, `checkFiles`, `autoFire`; 16 команд; изменение `moveTask`; `normProjects`-сид (T-65, T-66, ar-1/2); реализация `TaskPort` | P0 | P2 (docs-route, chats, service — для реальных задач) | **L** |
| P1b · forms | `FORM_SETTINGS`, `FORM_TEMPLATES` (15), `templateDef`, `formVal`, новый `publishForm`, `saveFormDraft`/`discardFormDraft`/`createForm`/`updateForm`; `kbFits`/`kbRun`, `backfillKbRule`, `retryFormAction`; изменение `recordInspection` | P0 (+ тип `KbTable` из core) | — | **M** |
| P1c · knowledge | весь `knowledge.js` + `createKbPage`/`createKbTable` (перевод на v2-узел) + решение по `saveKbPage` (обёртка над `kbPublish`) | P0 | — | **L** |
| P1d · docs-sheet | табличный движок H (≈ 170 строк), `fmtVal`, `csvCells`, `FN_LIST` | P0 (только `format`) | P2 docs | **M** |
| P1e · docs-core | A–G, I, K, L, J (доступ, поля, сид, view) | P0 | P2 docs | **L** |
| P1f · chats | весь `chats.js` (через `core/entries`, а не `documents`) | P0 | — | **L** |
| P1g · cash | весь `cash.js` + изменения `assign`/`saveRole`/`rolePermKeys` | P0 | — | **L** |
| P1h · service | весь `service.js` | P0 | — | **M** |
| P1i · repair-delta | `assignForeman`, `proposeChange`, `setChange`, новый `addWorkLog`, фильтр view, сид объектов | P0 | — | **S** |
| P2 · docs-route | движок маршрута `activate`/`advance`/`syncTask`, `makePdfA`, ПЭП, `JOBS` и 20 команд маршрута и PDF | P1a (`TaskPort`), P1d, P1e | — | **L** |
| P3 · adapter-compose | реестр модулей в mock-адаптере, сборка `view()` (projects по `project` scope, tasks с `docRoute`), задержки, `METHODS_166`, `ApiError.db`, сид через `compose` | все P1 и P2 | WS-10 и страницы | **M** |
| P4 · conformance-v2 | обновить 13 устаревших кейсов 07 §14 + по 6–15 кейсов на модуль (каждый P1 пишет свой файл кейсов, P4 — общий раннер и проверка покрытия 166/166) | P3 | WS-51 | **M** |

Расписание:
- **Волна 0:** WS-05 (+ P0) → WS-06.
- **Волна 0.5:** девять потоков P1 параллельно; файлы не пересекаются.
- **Волна 1:** P2 и P3.
- **Волна 1.5:** P4.

Сид — общий узел, но он разделён: каждый модуль владеет своим `modules/<m>/seed.ts`, а `seed/compose.ts` (интегратор) только вызывает их в порядке `api.js:33–42`. Порядок важен:
- **docs до chats**: сид чатов ищет документ `/42\/26/`;
- **knowledge и docs после repair-сида**: `relation obj-42`;
- **cash последним**: `cashProposals` читает рейсы и SPA.

Тесты паритета (`test/parity`) каждого P1 импортируют **только свой** файл прототипа из `design/ortus-v2/` — новый эталонный каталог (см. факт 2).

---

## 6. Что устарело в 07, WS-05 и WS-06

### 6.1 `docs/plan/analysis/07-domain-and-adapter.md`

| Раздел | Что устарело |
|---|---|
| §1 Источники | Диапазоны строк: `api.js` теперь 1–1045, `models.js` 1–414. Нет пяти модулей и `docs/20–27` |
| §2 Сводка | «53 метода» → 168; «HTTP покрывает 36 из 53» → 36 из 168; инвентарь сида; «у логиста нет назначений» — теперь есть `ap1`, затем `as-svc1`, `akb-1`, `ach-1`/`ach-4`, `adoc-1`; «ключи spa/cash/inventory… нет в каталоге» — добавились docs/service/chat, cash полностью заменён |
| §3.1–3.3 | В адаптере появились `normProjects`, install-функции, `pj`/`assertPj`/`checkFiles`/`checkParent`/`autoFire`, а у модулей — собственные `need()` |
| §3.4 `recordInspection` | Добавлены `kbFits`/`kbRun` (действие `au-2` пишет строку в `kt-insp`); правило-задача только при `!kind \|\| 'task'`. Значит, у S-26/S-32 появился побочный эффект — строка в БЗ |
| §4.6 | Новые тексты и проверки `publishForm`; `moveTask` блокируется для проектов с `wf`; `saveKbPage` — наследие в обход `kbAccess`; 24 новых метода форм, проектов и БЗ |
| §4.7 | Удалены `addCashOp`, `reverseCashOp`; изменился `addWorkLog`; новые `assignForeman`, `proposeChange`, `setChange` |
| §5 `view()` | Правила для projects, tasks, knowledge и cash заменены; добавлены docs, chats, service, repair; в «не фильтруются» больше нет `repair` и `knowledge.spaces` |
| §6 Коды | В модулях `forbidden` и `not_found` стали основными кодами прав; нужно пересмотреть маппинг на канон (`forbidden_action`, 404) и добавить `transition` для `svcTransition` и `runTransition` |
| §8.2 | `grants(db,'m-kotova')` → не `[]`, а `[ap1]` уже в сыром `seed()`; `can(seed,'m-kotova','tasks','view')` → **ok** (через `r-pm`). После install-функций меняются `rolePermKeys(r-manager)` (было 22), `r-driver` (10), `r-therapist` (5), `r-foreman` (6): добавляются cash, docs, chat |
| §8.5 | `TASK_TONE` — `Proxy`; появились `buildWf`, статусы `s1..s5` и переходы `t1..t5` |
| §8.7 | `CORE.cash` 'Внутренняя касса' → 'Касса', новые права; добавлены `docs`, `service`, `chat` |
| §9 Сид | Роли 5 → 9 (сырой сид) / 24 (после адаптера); назначения 4 → 7 / ≈ 20; задачи 9 → 11; `fm-insp.automations` 1 → 2; у ответов `actions`; страницы БЗ 4 → 5 (+ таблица) / ≈ 35; `repair.object` → `objects` (6), работы 3 → 13, материалы 2 → 5, логи 1 → 5, + `changes`; касса Альты заменена (8/26); у Лотоса роли 3 → 7, касса мигрирована, `knowledge.pages` + `kb-home-sp-spa` |
| §10 JSDoc → TS | `Scope` расширен до 11 типов; нужны типы `Entry`, `KbNode`, `Doc`, `Chat`, `Msg`, `CashAccount/Op/Shift/…`, `SvcRequest`, `Workflow v2`, `Transition`, `Automation(project)`, `FormTemplate`, `FormSettings`, `KbTable/Entry`, `RepairObject[]`, `Change` |
| §11 Ключи прав | +12 docs, +5 service, +12 chat, 12 cash вместо 2, `cash.balance.read`, `cash.advance.self` |
| §12–13 | Нужны инварианты новых модулей: смены и сторно в кассе, блокировка документа на маршруте, удержание в чатах, пауза SLA, отсутствие циклов в иерархии задач, ≤ 3 уровней |
| §14 Чек-лист | Устарели: **S-11** (Котова видит проект `fleet`; касса — по `cashView`; БЗ — по `kbView`); **S-26/S-32** (побочный эффект в БЗ); **S-43** (наследие, работает только для `kb-1` v2 → 3); **S-44** (`moveTask('T-58', …)` → `transition` «Статус меняется переходами процесса проекта «Логистика · Север»»); **S-46** (тексты и `by`); **S-50/S-51** (методов нет); **S-52** (текст события и `by`; нужно `obj`); **S-61** (`knowledge.pages` = `['kb-3', 'kb-home-sp-spa']`; касса Лотоса мигрирована); **C-11/C-12** (у водителя `r-exec` → `tasks.edit`/`view` есть); **M-8** (view персонажей) |
| §16 Факты | п. 1–3: число методов и функций |

### 6.2 `docs/plan/ws/WS-05-domain-seed-port.md`

- **§1 Цель:** «28 функций, 22 справочника, `AdapterPort` на 51 метод» → +9 функций и +7 справочников в `models`, ещё ≈ 150 чистых функций в модулях, порт на 166 методов (или разделение на `CorePort` + `ModulePort`).
- **§2 Каталоги:** нет `modules/*`, `core/entries`, `seed/compose`. В `models/tasks.ts` только `wfOf`.
- **§3 Входы:** диапазоны `models.js:1–305`, `mock-data.js:1–276`, `extra-data.js:1–85` устарели; эталон теперь `nd/ortus` (14.10).
- **§4.1 Экспорт:** в `types.ts` нет новых сущностей; `PageKey` без `chat/docs/service/repairSupply/repairCatalog`; `seed/index.ts` не применяет `normProjects` и install-функции (`createSeed()` ≠ состоянию адаптера); `clock.ts` — одно «демо-сейчас» вместо пяти; `errors/codes.ts` и `permissions/renames.ts` — без новых ключей.
- **§4.2 `AdapterPort`:** таблица 51 метода; #47, #48 удалены, #38, #39, #44, #49 изменены.
- **§6б Unit:**
  - `access.test`: `grants(db,'m-kotova') → []` и `can(seed,'m-kotova','tasks','view') → no_permission` уже не выполняются на сыром сиде;
  - `seed/counts.test`: роли 5, назначения 4, `knowledge.pages` 4, `repair.works` 3 / materials 2 / logs 1, `repair.object`, касса 2/4 (после compose), у Лотоса роли 3 → всё изменилось;
  - `nav`: в `navForBase` нет «Чаты», «Обращения», «Документы», «Подотчёт», «Снабжение», «Шаблоны и расценки», нет бейджей.
- **Сценарии:** `kb-conflict` построен на `saveKbPage` — перевести на `kbPublish` с `base`.

### 6.3 `docs/plan/ws/WS-06-mock-adapter-port.md`

- **§1:** «ровно как `api.js:15–570`» → `1–987` + 5 модулей; в мок нужно добавить `normProjects` и install-функции (иначе `load()` не совпадёт с эталоном).
- **§2 Файлы:** `methods/spa-cash-repair.ts` → `spa.ts` + `repair.ts`; нет `methods/forms.ts` и `methods/projects.ts` и реестра модулей.
- **§4.1:** `Delays` без 115 новых методов (`chatOpen`/`docJobPoll` — 0, без сети); `METHODS_51` → 166; `CODES_18` — набор тот же, распределение другое.
- **Таблица П:** `kb-conflict` (через `saveKbPage`). `logistics-ready` по-прежнему работает, но у Котовой уже есть `r-pm`/`r-agent`/`r-kb-lead`.
- **§5 «Что отдаёт `load()`»:** `manager` до роли («`projects []`, `cash.hidden`, БЗ без `kb-4`») — неверно; у `driver`, `therapist`, `foreman`, `owner@t-lotos` изменились `cash`/`knowledge`/`projects` и появились `docs`/`chats`/`service`.
- **§6а:** устарели S-11, S-26, S-32, S-44, S-46, S-50, S-51, S-52, S-61, C-11, C-12, M-5(в), M-8 (13 пунктов); нет кейсов для 115 новых методов.
- **§6б:** `view.test` — правило `projVisible` и `tasks` с `docRoute`; `automation.test` — нет `kbRun`; `state.test` — `seatsUsed` не изменился, а `owners()` и `reviewers()` не изменились только на сыром сиде.

---

## 7. Факты для плана

1. **Адаптер: 168 методов (порт — 166)** вместо 53/51. Ядро `api.js` — 78 (−2 кассовых, +27: формы 4, проекты 16, БЗ из форм 4, ремонт 3). Модули — 90: service 10, knowledge 14, documents 32, chats 18, cash 16. HTTP-адаптер новых методов не покрывает.
2. **Новый эталон — снимок 14.10** (`nd/ortus`, 10 файлов, ≈ 5000 строк). Его нужно зафиксировать в репозитории отдельно от `design/ortus` (например, `design/ortus-v2/`), чтобы тесты паритета не смешивали версии. `roadmap.js` не изменился.
3. **Каждый модуль = `install` + `view` + `api`**, порядок установки фиксирован: `normProjects → service → knowledge → docs → chats → cash` (`api.js:33–42`). Сид «как у эталона» = `seed()` + этот конвейер. Делать это в `createSeed()` домена, а не в адаптере.
4. **Перед переносом нужны семь дочерних экранов** `*.dc.html` (Формы, Обращения, Задачи и проекты, База знаний, Документы, Чаты, Касса): в комплекте их нет. Без них нет e2e-паритета и списка реально вызываемых методов. Запросить у дизайна или выгрузить из Claude Design.
5. **CRM вызывает модули через `onApi(m, args, ok)` → `this.api[m](...args)`.** Адаптер должен быть словарём методов по строковому имени; `mid` = id участника персонажа. Шины событий нет; дочерние экраны получают `db` целиком.
6. **Решение D-new-1 «объектные роли и `can`».** `M.can` без `unitId` засчитывает роли с областью `project/space/page/folder/doc/chat/account`. Из-за этого Котова получает `tasks.settings`, авторы БЗ — `knowledge.create` везде, водитель — `tasks.edit`. Варианты: (а) `can` игнорирует гранты с объектной областью без явного объекта; (б) так задумано — тогда зафиксировать. По умолчанию предлагается (а), с конформанс-кейсами на `createProject`, `saveKbPage`, `toggleTaskCheck`.
7. **Области: 11 типов вместо 4.** `scopeCovers` новые типы не знает, их обрабатывают модульные движки. Тип `Scope` и `scopeLabel` (7 новых подписей) — в общем слое P0.
8. **Часы: пять «демо-сейчас»**: `01.10 10:30` (ядро), `CASH_DAY '01.10'`, `KB_TODAY`/`DOC_TODAY '01.10.2026'`, `chats.now = 665` мин, `SVC_BASE 01.10.2026 16:24` + реальный дрейф. Плюс реальные `hhmm()`/`Date.now()` в `event` и заданиях документов. Нужен единый `Clock` с TZ `Europe/Moscow` в vitest. Две разные функции `addWork` переименовать: `addWorkMinutes` (service) и `addWorkDays` (documents).
9. **Коды ошибок: набор из 18 тот же, распределение другое.** В модулях права дают `forbidden`, невидимый объект — `not_found` (политика 404). `no_scope` бросается напрямую в ремонте; `transition` — в проектах и обращениях. БЗ, документы, чаты и `cashApprove` не вызывают `assertActive`: это нужно решить.
10. **Изменённые методы ядра:** `publishForm` (аргумент `{pages, fields}`, новые тексты «В форме нет ни одного вопроса» и «У вопроса нет текста», `by` = актор); `moveTask` (только `leads`, для `fleet` → `transition`); `assign` (scope `account`); `saveRole` (водитель → `cash.self`); `addWorkLog` (`obj`, проверка прораба, новый текст события). Удалены `addCashOp`/`reverseCashOp`. `saveKbPage` — наследие, предлагается обёртка над `kbPublish`.
11. **Сид:**
    - роли 5 → 9 (сырой) → 24 (после install); назначения 4 → 7 → ≈ 20;
    - задачи 9 → 11 (T-65, T-66, иерархия);
    - ремонт — 6 объектов, 13 работ, 5 материалов, 5 логов, `ДР-1`;
    - БЗ — `kb-5` + `kt-insp` + v2 (5 пространств, ≈ 35 узлов);
    - касса Альты заменена (8 касс, 26 операций, 2 смены);
    - docs — 6 папок / 6 документов; chats — 6 / 22 сообщения; service — 4 направления / 8 обращений.

    Тенанты и персонажи не изменились; у «Лотоса» `service = null`.
12. **Новые чистые функции `models` (+9):** `templateDef`, `formVal`, `buildWf`, `projAccess`, `projCan`, `childrenOf`, `isDone`, `approversOf`, `trCheck`. Плюс справочники `FORM_SETTINGS`, `FORM_TEMPLATES` (15), `FORM_VARS`, `PROJECT_ROLES`, `VERB_LABEL`, `WHO_LABEL`, `STATUS_CAT`. Готовые примеры для тестов:
    - `projCan(db, fleet, 'm-kotelnikova', 'edit')` → `{ok:false, why:'роль «Согласующий» не даёт «Менять статус»'}`;
    - `projCan(db, fleet, 'm-morozova', 'view')` → `why:'нет роли с правом «Задачи» в области проекта'`;
    - `projCan(db, fleet, 'm-gromov', 'view')` → `why:'сотрудник заблокирован'`;
    - `trCheck(db, fleet, T-65, 'm-kotelnikova', t3)` → `{ok:true}`;
    - `trCheck(db, fleet, T-65, 'm-vasiliev', t3)` → `why` начинается с «Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»»;
    - `trCheck(…, T-66 'В работе', …, t3)` → `{ok:false, hide:true}`;
    - `approversOf(db, fleet, T-65, t3).map(id)` → `['m-owner','m-kotova','m-kotelnikova']`;
    - `buildWf('approval').transitions.map(id)` → `['t1','t2','t3','t5']`; `buildWf('simple')` → `['t1','t2','t3','t4','t5']`;
    - `formVal(fm-insp, R-1012, '$ver')` → `'v3'`; `'q-odo'` → `'84 210'`; поле-фото → `'5 фото · файлы в ответе R-1012'`;
    - `templateDef(tpl-request)` → 2 страницы `p1/p2`, 8 полей (4 + 4);
    - `TASK_TONE['Неизвестно']` → `['info','pending']`;
    - `scopeLabel(db, {type:'project', id:'fleet'})` → `'Проект «Логистика · Север»'`.
13. **Самые удобные для TDD чистые ядра модулей:**
    - табличный движок документов (≈ 170 строк, ≈ 30 кейсов в §3.3);
    - рабочий календарь и SLA обращений (≈ 25 кейсов);
    - форматтеры и квоты чатов (`freeFor`, `chatCleanup`, `chatMatrix`);
    - балансы и закрытие смены кассы;
    - дерево и доступ БЗ (`kbPath`, `kbAccess` — таблица из 18 строк).
14. **Разбиение на потоки:** P0 core-v2 (M) → девять параллельных P1: tasks (L), forms (M), knowledge (L), docs-sheet (M), docs-core (L), chats (L), cash (L), service (M), repair-delta (S) → P2 docs-route (L) и P3 adapter-compose (M) → P4 conformance-v2 (M). Модули владеют `src/modules/<m>/**`; общие реестры (`modules/index.ts`, `seed/compose.ts`, `adapter/mock/modules.ts`) — у интегратора. Межмодульные связи — только через `core/entries`, `TaskPort`, `Clock`, `IdGen`.
15. **Зависимость chats → documents** (`entryHas`, `objOf`) разрывается выносом `core/entries`. Заодно чинится связь «прораб» по ФИО (`o.foreman === m.name`) — она встречается в knowledge, documents и chats.
16. **Дефекты эталона, которые нельзя переносить 1:1** (каждый требует решения «паритет или исправление» в `decisions.md`):
    - documents: нет проверки доступа в 7 командах маршрута и заданий, демо-режим `as`, SMS-код в ответе, утечка финансового листа через `versions`, `СУММ(1,5)` = 1.5;
    - chats: восстановление удалённого сообщения во view, `@всем`, `held()` не работает;
    - cash: сид `sh-117` не сходится, частичные мутации, нет `active()` в части команд;
    - knowledge: роли протекают в `can`, `createKbPage`/`kbRun` на старом `access`;
    - service: задачи-заглушки вне `db.tasks`, телефон-заглушка в `svcRating`, смешанные единицы в `slaHead`;
    - общее: `cmd` без отката, пересекающиеся `T-`-id (`60+seq`, `70+seq`, `KEY-100+seq`).
17. **Устарело в WS-05/WS-06:** `AdapterPort`/`METHODS_51`, `Delays`, `seed/counts`, `access.test` (Котова), `nav` (новые пункты и бейджи), пресет `kb-conflict`, 13 кейсов conformance (S-11, S-26, S-32, S-44, S-46, S-50, S-51, S-52, S-61, C-11, C-12, M-5в, M-8). Нужна v2-ревизия обоих WS и 07 §§1–2, 3.4, 4.6–4.7, 5, 6, 8.2, 8.5, 8.7, 9–11, 14, 16.
18. **Спецификации `docs/20–27`** (формы, задачи и проекты, обращения, БЗ, документы, чаты, касса, план реализации) пришли вместе со снимком (`nd/docs`), но в `docs/` репозитория их нет. Их нужно импортировать: модули на них ссылаются, а `27-implementation-plan.md` ставит коммуникации и документы в этап 7, кассу в этап 5, общие модули в этап 4. Это задаёт порядок волн P1 для продукта, хотя для мока все P1 можно делать параллельно.
