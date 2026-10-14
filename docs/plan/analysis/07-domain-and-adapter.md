# 07. Доменный слой и сервисный адаптер прототипа «Ортус CRM»

Рабочая карта для агентов, реализующих домен (`models`), сервисный слой (`adapter`) и mock-сервер. Все пути — относительно `design/`. Все строки интерфейса приведены дословно.

---

## 1. Источники

| Файл | Строки | Что прочитано |
|---|---|---|
| `ortus/models.js` | 1–305 (весь) | JSDoc-типы, справочники, `can`/`canEarnings`, `compat`, `legs`, `inspMissing`, `odoError`, `validateExpense`, `bookingConflicts`, `freeSlots`, `TASK_FLOW`, `WORKFLOWS` |
| `ortus/api.js` | 1–628 (весь) | `ApiError`, `createMockAdapter` (все 53 метода), `view()`, `cmd()`, `createHttpAdapter` |
| `ortus/mock-data.js` | 1–277 (весь) | `seed()`, `seedLotos()`, `BRAND_DEFAULT`, `seedBrands`, `fillAccounts`, `baseSeed()` |
| `ortus/extra-data.js` | 1–86 (весь) | `extraSeed()`: календарь, база знаний, SPA, касса, ремонт |
| `ortus/roadmap.js` | 1–134 (весь) | `ROADMAP` — 9 карт экранов |
| `Ортус CRM.dc.html` | 2323–2330, 2381–2669, 2960–2979, 3209–3234, 3944–3953; grep `api.*(` и `M.*` по 2325–4537 | `MEMBER`/`MEMBER_BY`, `boot`, `run`, `flush`, действия водителя, навигация, «Проверка доступа», все точки вызова адаптера |
| `docs/11-permissions.yaml` | 1–191 (весь) | канонические ключи прав, `prototype_renames` |
| `docs/12-errors-and-events.md` | 1–100 | формат Problem, реестр кодов, события outbox, соглашения API |
| `docs/15-quality-security.md` | 29–48 (grep) | политика 404 для чужих объектов (AC-01, AC-02, AC-06, BR-T1) |
| `docs/17-users-and-billing.md` | 137–184 (grep) | PROPOSED-эндпоинты биллинга и операторов |
| `docs/v0.1/ortus-openapi-v0.1.yaml` | список путей (grep `^  /`) | сопоставление `createHttpAdapter` с контрактом |
| `README.md` | 1–189 (весь) | структура слоёв, допущения, ограничения прототипа |

---

## 2. Сводка

- Домен — чистые функции в `ortus/models.js` без доступа к хранилищу; их используют и mock-сервер («серверные проверки»), и UI («предпросмотр») (`ortus/models.js:1–3`). В промышленной версии решение принимает Go-сервер, UI «лишь показывает разрешённое».
- Сервисный слой — единственный интерфейс UI к данным: `this.api = createMockAdapter()` (`Ортус CRM.dc.html:2430`); замена на `createHttpAdapter({ tenantId, getToken })` задумана как единственное изменение при подключении Go API (`README.md:32`).
- Мок-адаптер держит **отдельную «БД» на организацию** (`dbs[tenantId]`) и один общий объект `platform` (control DB), разделяемый всеми (`ortus/api.js:16–19`).
- Каждая команда проходит через `cmd(fn, ms, needsNet)`: задержка 200–650 мс → проверка «сети» → мутация → `syncSeats()` → ответ `{ data, db: view() }`; при ошибке к исключению прикрепляется `e.db = view()` (`ortus/api.js:99–104`).
- `view()` формирует ответ **для конкретного актора**: удаляет `earnings` из рейсов без права на начисления, скрывает чужие события, машины/рейсы вне области, приватные страницы БЗ, кассу (`ortus/api.js:70–97`). Оператор платформы получает только `platform` (`ortus/api.js:71`).
- Эффективное право = модуль подключён → действие разрешено ролью → объект в области (`ortus/models.js:177–187`). Начисления дополнительно блокируются функцией «Водитель» (`ortus/models.js:189–198`).
- Флаги демо-режима: `online`, `conflictNext`, `failUploadNext` (`ortus/api.js:20`) — через них e2e включает офлайн, конфликт брони и сбой загрузки.
- Идемпотентность: `opId` для `addExpense` и `submitReturn` — повтор возвращает `'duplicate'` без мутации (`ortus/api.js:362, 371`). В HTTP-адаптере это заголовок `Idempotency-Key` (`ortus/api.js:613–617`).
- Оптимистическая блокировка: `saveKbPage(pageId, body, baseVersion)` → `conflict` при расхождении версии (`ortus/api.js:471`); в HTTP — `If-Match` для `saveRole` (`ortus/api.js:609`).
- Начатую работу (рейс в состояниях `inspection|on_route|returning|rework|submitted|defect_review`) можно завершить даже после отключения модуля или конца trial (`ortus/api.js:61–67`).
- Побочные эффекты команд: события (`db.events`), аудит платформы (`db.platform.audit`), ответы формы «Осмотр машины» + задача менеджеру через автоматизацию (`ortus/api.js:38–50`), начисление при приёмке смены (`ortus/api.js:392`).
- Seed t-alta: 3 региона × 4 фирмы, 10 участников, 2 группы, 5 ролей, 4 назначения, 7 машин, 2 рейса, 2 водителя пула, 2 формы, 2 ответа, 9 задач, 2 проекта, 8 ресурсов календаря, 6 броней, 4 страницы БЗ, 3 визита SPA, 4 кассовые операции, 1 объект ремонта.
- Вторая организация t-lotos (SPA «Лотос»): 23 участника, 3 роли, 23 назначения; ID `m-owner`, `m-morozova` намеренно совпадают с t-alta — «идентификаторы живут внутри своей БД» (`ortus/mock-data.js:40–41`).
- Модуль «Логистика» в seed **выключен** (`modules.logistics.enabled:false`, `ortus/mock-data.js:147`); у логиста Марины Котовой **нет назначений** в seed (`ortus/mock-data.js:174–179`) — основной путь демо начинается с подключения модуля и назначения роли.
- Ключи прав прототипа расходятся с каноном `docs/11-permissions.yaml`: 10 переименований в `prototype_renames` плюс ключи spa/cash/inventory/tasks.manage/forms.responses.create, которых в каталоге нет вовсе.
- HTTP-адаптер покрывает 36 из 53 методов мока; 17 методов (задачи, календарь, БЗ, формы, SPA, касса, ремонт, `resetTrip`) не имеют HTTP-реализации.

---

## 3. Архитектура mock-адаптера

### 3.1 Внутреннее состояние (`ortus/api.js:15–36`)

| Переменная | Что хранит | Источник |
|---|---|---|
| `db` | текущая tenant-БД (объект из `seed()`/`seedLotos()`) | `api.js:16` |
| `dbs` | `{ 't-alta': db, 't-lotos': lotos }`; `lotos.platform === db.platform` (общая ссылка) | `api.js:18–19` |
| `flags` | `{ online: true, conflictNext: false, failUploadNext: false }` | `api.js:20` |
| `ops` | `Set` использованных `opId` (идемпотентность) — общий для всех организаций | `api.js:21` |
| `actor` | id участника; `null` = оператор платформы; по умолчанию `'m-owner'` | `api.js:22` |

Вспомогательные функции:

| Функция | Поведение | Строки |
|---|---|---|
| `tenant(id)` | организация из `db.platform.tenants` по id или текущая | 24 |
| `trip(id)` / `veh(id)` | бросают `ApiError('not_found', 'Рейс не найден')` / `'Машина не найдена'` | 25–26 |
| `event(text, to, sensitive)` | `db.events.unshift({ id:'e'+seq++, at: hhmm(), text, to, sensitive })` | 27 |
| `reviewers(unitId)` | участники с `can(…, 'logistics', 'review', unitId).ok` — **пусто, если модуль выключен** | 28 |
| `owners()` | участники с ролью `all:true` | 29 |
| `seatsUsed()` | число участников со статусом `active` или `invited` (blocked и без входа — бесплатно) | 30–31 |
| `syncSeats()` | `tenant.seatsUsed = seatsUsed(); tenant.members = db.members.length` — вызывается после каждой успешной команды | 32, 102 |
| `tierOf(id, v)` | тариф из версии прайс-листа (по умолчанию `priceBook.current`) | 33 |
| `account(email)` | аккаунт платформы по email без учёта регистра | 34 |
| `PAID_UNTIL` | `{1:'31.10.2026', 4:'31.01.2027', 8:'31.05.2027', 12:'30.09.2027'}` | 35 |
| `actorName()` | имя актора или `'Владелец'` | 36 |
| `hhmm()` | текущее время `HH:MM` (ru-RU) | 13 |

### 3.2 Проверки (guards) (`ortus/api.js:52–67`)

| Guard | Условие отказа | code / message |
|---|---|---|
| `assertNet()` | `!flags.online` | `offline` / «Нет связи с сервером. Операция не выполнена.» |
| `assertActive()` | `tenant.status ∈ {restricted, suspended}` | `subscription_restricted` / «Пробный период завершён: новые операции недоступны. История доступна для чтения.» |
| `assertCan(mod, verb, unitId)` | `!M.can(db, actor, mod, verb, unitId).ok` | `r.reason` / `M.REASON[r.reason].text` |
| `startedWork(t)` | `t.status ∈ {inspection, on_route, returning, rework, submitted, defect_review}` | — |
| `assertLogisticsFor(t, verb)` | если работа не начата: `assertActive()` + модуль включён (`module_off` / «Модуль «Логистика» отключён: новые операции закрыты.»); затем `can` с принудительно включённой логистикой по `t.unit` | как `assertCan` |

### 3.3 Обёртка `cmd` (`ortus/api.js:99–104`)

```
await wait(ms)            // ms по умолчанию 420
if (needsNet) assertNet() // проверка сети ПОСЛЕ задержки
data = fn(); syncSeats(); return { data, db: view() }
catch (e) { e.db = view(); throw e }
```

UI (`run`, `Ортус CRM.dc.html:2445–2460`): при успехе `setState({db: r.db})` + toast `ok`; при ошибке — `patch.db = e.db` (если код не в `opts.quiet`), toast `e.message` тоном `warn` для `offline`, иначе `error`. Коды, которые экраны обрабатывают сами (`quiet`): `conflict` (бронь 2586, назначение машины 2813, перенос брони 4143), `role_conflict`+`validation` (назначение 2758), `validation`+`conflict` (приглашение 2769), `validation` (создание роли 2776, касса 4267, отметка прораба 4347).

### 3.4 Автоматизация `recordInspection(t, kind, p)` (`ortus/api.js:38–50`)

- Срабатывает только если форма `fm-insp` опубликована.
- Ключ дедупликации: `t.id + ':' + kind + ':' + (t.review && kind === 'ret' ? 'rev2' : 'rev1')` — повтор с тем же ключом не создаёт ответ.
- Создаёт ответ `{ id: 'R-' + (1040 + seq++), key, formId:'fm-insp', version: f.published, at, author: t.driverName, object: 'Рейс Р-208 · выезд' | ' · сдача', status: 'Принят', values }`, где `values` = `{ 'q-photos':'5 фото', 'q-odo': int(odometer), 'q-fuel': 'Полный'…, 'q-fuel-t': то же, 'q-checks':'все пункты', 'q-defect':'да'|'нет', 'q-defect-text': 'Кузов: …'|'', 'q-critical':'да'|'нет', 'q-volume':'', 'q-crew':'', 'q-photo':'' }`.
- Если есть включённая автоматизация (`au-1`), создаёт задачу `{ id:'T-'+(60+seq++), title:'Проверить осмотр Р-208 (выезд)'|'(сдача)', assignee:'Марина Котова', status:'Новая', source: responseId, rule:'au-1 · v1', priority: critical ? 'urgent' : 'normal', due:'01.10', project:'fleet', checklist:[{t:'Сверить фото с прошлым осмотром',d:false},{t:'Проверить пробег',d:false}], comments:[], links:[{kind:'response',…,label:'Ответ R-…'},{kind:'trip',id,label:'Рейс Р-208'}] }`.

---

## 4. Каталог методов адаптера

Обозначения: «задержка» — аргумент `ms` в `cmd` (по умолчанию 420 мс); «сеть» — `needsNet` (по умолчанию да). Возвращаемое значение — поле `data` ответа `{data, db}`. Точки вызова — `Ортус CRM.dc.html:строка` с именем метода/VM.

### 4.1 Служебные (`ortus/api.js:107–112`)

| Метод | Параметры | Возвращает | Поведение | Вызовы |
|---|---|---|---|---|
| `kind` | — | `'mock'` | константа | — |
| `flags` | — | объект флагов | живая ссылка | — |
| `setActor(memberId, tenantId)` | id участника или `null`; id организации | — | синхронно; переключает `db`, если `dbs[tenantId]` есть | 2431 `boot`, 2468 `setPersona` |
| `tenantIds()` | — | `['t-alta','t-lotos']` | — | ⚠ в CRM не вызывается |
| `setFlag(k, v)` | `'online'|'conflictNext'|'failUploadNext'`, boolean | — | — | 2486 `setOnline`, 2831 панель демо-режима |
| `load(ms = 500)` | задержка | `view()` | **без** проверки сети и ошибок | 2432 `boot`, 2470 `setPersona` (320), 2595 `refresh` (450) |

### 4.2 Платформа (оператор) (`ortus/api.js:115–128, 196–273`)

| Метод | Параметры | Возвращает | Ошибки (code: message) | Побочные эффекты | Вызовы |
|---|---|---|---|---|---|
| `extendTrial(tenantId, days)` | id, число дней | — | — | `status='trial'`, `trialDaysLeft += days`, `trialEnds = '27.10.2026'` если `days===14 && id==='t-alta'`, иначе `'через N дн.'`; audit «<name>: пробный период продлён на N дней» by «Оператор (демо)»; event владельцам «Оператор платформы продлил пробный период на N дней» (если текущая организация) | 3552 `opVM` |
| `setTenantQuota(tenantId, gb)` | id, ГБ | — | — | `quotaGb = gb`; audit «<name>: квота A → B ГБ» | 3551 `opVM` |
| `setTenantStatus(tenantId, status)` | id, `'trial'|'active'|'restricted'|'suspended'` | — | — | `status`; при `restricted` → `trialDaysLeft=0`; audit «<name>: статус «Ограничен»»; event владельцам «Пробный период завершён. Новые операции ограничены, данные сохранены.» или «Ограничения подписки сняты» | 2745 `confirmTrialEnd` (владелец, демо), 3554/3555 `opVM` |
| `decideSeatRequest(id, approve, note)` | id заявки, boolean, текст | — | `conflict`: «Заявка уже рассмотрена или отменена»; `validation`: «Укажите причину отказа» (отказ без note) | `status='approved'|'rejected'`, `decidedBy='Оператор (демо)'`, `decidedAt`, `decision`; при approve: `plan={tier, term, paidUntil: PAID_UNTIL[term], version: priceBook.current}`, `seatsLimit=tier.seats`, trial/restricted→`active` (`trialDaysLeft=null, trialEnds=null`); audit; event владельцам «Тариф «Команда» подключён: 25 мест» / «без ограничения мест» / «Заявка SR-… отклонена: <причина>» | 3594, 3597 `requestsVM` |
| `publishPriceBook({tiers, terms, from, note})` | массивы тарифов и сроков, дата, примечание | новый номер версии `v` | `validation`: «Цена каждой ступени должна быть больше нуля»; «Ступень с большим числом мест должна стоить дороже предыдущей»; «У каждого тарифа должно быть название»; «Число мест должно расти от тарифа к тарифу»; «Тариф без лимита может быть только последним»; «Скидка за срок — от 0 до 49%»; `conflict`: «Уже запланирована версия vN. Отмените её, чтобы подготовить другую.» | `versions.push({v, from, to:null, scheduled:true, note || 'Изменение цен', by:'Оператор (демо)', tiers, terms})`; `cur.to = 'до ' + from`; `pb.scheduled = v`; audit «Тарифная сетка vN запланирована с <from>» | 3895 `plansVM` |
| `cancelScheduledPriceBook()` | — | — | `conflict`: «Запланированной версии нет» | удаляет версию, `cur.to=null`, `scheduled=null`; audit «Запланированная версия vN отменена до начала действия» | 3845 `plansVM` |
| `setAccountLock(id, locked, reason)` | id аккаунта, boolean, причина | — | `validation`: «Укажите причину блокировки» | `status = locked ? 'locked' : (lastLogin ? 'active' : 'pending')`, `lockReason`; audit «<email>: вход заблокирован — <reason>» / «: вход разблокирован» | 3658, 3660 `accountsVM` |
| `resetMfa(id)` | id аккаунта | — | — | `mfa=false`; audit «<email>: сброшен второй фактор, при входе попросим настроить заново» | 3661 `accountsVM` |
| `inviteOperator({name, email, role})` | | — | `validation`: «Укажите имя и рабочую почту»; «Оператором может быть только сотрудник платформы: почта в домене ortus.example»; «Владельцем платформы назначают уже работающего оператора» (role==='owner'); `conflict`: «Оператор с такой почтой уже есть»; «Эта почта уже используется в организации клиента. Для оператора нужен отдельный рабочий аккаунт» | `operators.push({id:'op-'+seq, name, email, role, status:'invited', mfa:null, lastLogin:null})`; audit | 3834 `platformOrgVM` |
| `setOperatorRole(id, role)` | | — | `conflict`: «Свою роль менять нельзя: попросите другого владельца» (`o.me`); «На платформе должен остаться хотя бы один активный владелец»; `validation`: «Владельцем может стать только активный оператор со вторым фактором» | `role`; audit «Платформа: <email> — роль A → B» | 3818 `platformOrgVM` |
| `setOperatorStatus(id, active)` | | — | `conflict`: «Себя отключить нельзя»; «Нельзя отключить последнего активного владельца» | если `!active && status==='invited'` — удаляет оператора (audit «Платформа: приглашение <email> отозвано»); иначе `status='active'|'disabled'`, `disabledNote='Отключён HH:MM'`; audit | 3827, 3828, 3829 `platformOrgVM` |

### 4.3 Организация: оформление, модули, место (`ortus/api.js:131–152`)

| Метод | Параметры | Возвращает | Ошибки | Побочные эффекты | Вызовы |
|---|---|---|---|---|---|
| `saveBranding(b)` | `{name, short, accent, logo, mark, terms, items, order, poweredBy}` | версия `v` | `validation`: «Название — от 1 до 60 символов»; «Короткое имя — до 16 символов»; «Цвет — в формате #RRGGBB»; «Заполните все формы термина «<key>»» (нужны `one, plural, few, many`) | `tenant.brand = {...b, version: v, updatedAt, updatedBy: actorName()}`, `tenant.name = name`; audit «<name>: оформление, версия N» by actor; event владельцам «Оформление обновлено (версия N). Изменения видны всем сотрудникам» | 3730 `brandingVM` |
| `defaultBranding()` | — | копия `BRAND_DEFAULT` | — | синхронно | ⚠ в CRM не вызывается (UI держит свой `BR_DEF`, 2333) |
| `setModule(key, enabled)` | `'logistics'|'spa'|'repair'`, boolean | — | — (нет проверки прав/подписки) | `db.modules[key] = {enabled, history: !enabled ? true : prev.history}`; `tenant.modules` = список включённых; event владельцам «Подключён модуль «Логистика»» / «Отключён модуль «Логистика». История сохранена.» | 2686, 2706 `toggleModule` |
| `setStorageQuota(gb)` | ГБ | — | `subscription_restricted` (assertActive) | `tenant.quotaGb = gb`; event «Лимит места изменён на N ГБ» | 2712 `applyQuota` |

### 4.4 Люди, роли, назначения, места (`ortus/api.js:155–195, 274–303`)

| Метод | Параметры | Возвращает | Ошибки | Побочные эффекты | Вызовы |
|---|---|---|---|---|---|
| `invite({name, email, roleId, scope})` | | id участника `'m-'+seq` | `validation`: «Укажите имя»; «Проверьте адрес электронной почты»; `conflict`: «Участник с таким адресом уже есть»; `seats_exhausted`: «Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.» | аккаунт платформы: добавляет membership `{tenantId, status:'invited'}` или создаёт `{id:'acc-'+seq, status:'pending', mfa:false, lastLogin:null}`; `members.push({id, name, email, status:'invited', title:'', invitedNote:'Приглашение до 08.10'})`; если `roleId` — назначение `{id:'a'+seq, member, role, scope}` | 2769 `saveInvite` |
| `revokeInvite(memberId)` | | — | `conflict`: «Приглашение уже принято или отозвано» (нет или статус ≠ invited) | удаляет участника, его назначения, членство в группах и membership аккаунта | 3937 `billingVM` |
| `requestSeats({tierId, term, comment})` | | id `'SR-'+(20+seq)` | `conflict`: «Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.»; `validation`: «Выберите тариф»; «В тарифе «Старт» 10 мест, а занято 23» | `platform.requests.unshift({id, tenantId, from: plan.tier, to, term, used, by, at, status:'pending', comment})`; audit; event «Заявка SR-… на тариф «…» отправлена оператору» | 3933 `billingVM` |
| `cancelSeatRequest(id)` | | — | `conflict`: «Заявка уже рассмотрена» | `status='cancelled'`, `decidedAt`, `decidedBy` | 3917 `billingVM` |
| `assign({memberId, roleId, scope, until})` | | — | `validation`: «Выберите роль»; «Выберите область действия» (scope без `id` при type region/firm); `role_conflict`: «Функция «Водитель» несовместима с правом на начисления (правило MVP).»; «У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено.» | `assignments.push({id:'a'+seq, member, role, scope, until: until || null})`; event участнику «Вам назначена роль «Менеджер логистики» · Москва / Север Логистик» | 2758 `saveAssign` |
| `unassign(assignmentId)` | | — | `last_owner`: «Нельзя снять роль с последнего владельца» | удаляет назначение (молча, если не найдено) | 2762 `removeAssign` |
| `createRole({name, mode, sourceId})` | mode `'empty'` или копия | id `'r-'+seq` | `validation`: «Укажите название роли» | `{id, name, kind:'custom', actions:{}, finance:{read:false, manage:false}}`; при копии — `actions`, `finance`, `professional` из источника. Задержка 300 | 2776 `saveCreateRole` |
| `saveRole(role)` | полный объект роли | — | `forbidden`: «Системная роль не редактируется»; `validation`: «Укажите название роли»; `role_conflict`: «Роль с функцией «Водитель» не может содержать начисления»; «Роль назначена водителю — финансовые права недоступны» | заменяет роль клоном. Задержка 380 | 2787 `saveRole` |

### 4.5 Логистика (`ortus/api.js:306–412`)

| Метод | Параметры | Возвращает | Guards / ошибки | Побочные эффекты | Задержка | Вызовы |
|---|---|---|---|---|---|---|
| `reserve(tripId, vehicleId)` | | — | `not_found`; `assertActive`; `module_off`: «Модуль «Логистика» отключён»; `assertCan('logistics','create', v.unit)`; **демо-флаг** `conflictNext`: машина помечается `reserved/heldBy:'other'/note:'другой рейс'` и бросается `conflict`: «Машину только что забронировал другой сотрудник. Список на экране устарел.» `{vehicleId}`; `conflict`: «Машина уже недоступна. Обновите список.» (state≠free и heldBy≠trip); `incompatible`: «Машина не подходит рейсу: <reasons через '; '>» (по `compat().fit`) | `t.vehicleId`, `t.status='inspection'`, `t.reservedUntil='09:30'`, `v.state='reserved'`, `v.heldBy=t.id`, `v.note=null`; event проверяющим «Илья Васильев забронировал ГАЗель Next А 412 МР 77 на рейс Р-208» | 600 | 2586 `reserve` (водитель) |
| `cancelReservation(tripId)` | | — | `not_found` (нет проверки прав) | машина: `reserved→free`, `heldBy=null`; рейс: `vehicleId=null`, `status='planned'`, `defect=null` | 420 | 2601 `cancelRes` |
| `assignVehicle(tripId, vehicleId)` | | — | `assertActive`; `assertCan('logistics','edit', t.unit)`; `conflictNext` → `conflict`: «Машину только что забронировали. Обновите список.»; `incompatible`: «Нельзя назначить: <reasons>» (по `compat().ok` — включая доступность) | освобождает прежнюю машину; `t.vehicleId`, `status: planned→assigned` (иначе без изменений), `v.state='reserved'`, `heldBy` | 420 | 2813 `assignVehicle` (логист, `fleetVM`) |
| `submitDeparture(tripId, payload)` | `{photos, odometer, fuel, checks, defects, comment}` | `'blocked'` или `'started'` | `assertLogisticsFor(t,'create')`; `validation`: «Осмотр не завершён: <inspMissing через ', '>»; «Не все фото загружены на сервер» (все 5 должны быть `state:'ready'`) | `t.dep={odometer:Number, fuel, defects, photos, at}`; `recordInspection(t,'dep')`; при критическом дефекте: `status='defect_review'`, `t.defect=critical[0]`, `v.state='unavailable'`, `v.note='критический дефект на проверке'`, event «Критический дефект: ГАЗель Next А 412 МР 77 — Кузов. Выезд заблокирован.»; иначе `status='on_route'`, `v.state='on_route'`, event «Рейс Р-208 начат · ГАЗель Next» | 650 | 2607 `submitDep` |
| `decideDefect(tripId, decision)` | `'allow'|иное` | — | `assertCan('logistics','review', t.unit)` | allow: все дефекты `critical:false, downgraded:true`, `status='on_route'`, `v.state='on_route'`, `v.note=null`, event водителю «Менеджер разрешил выезд: дефект признан некритичным»; deny: `v.state='unavailable'`, `v.note='неисправность подтверждена'`, `v.heldBy=null`, рейс → `vehicleId=null, status='planned', dep=null, defect=null`, event водителю «Неисправность подтверждена. Выберите другую машину для рейса Р-208» | 420 | 2810 `decideDefect` (`reviewVM`) |
| `addExpense(tripId, e)` | `{category, amount, date, comment, liters, receipt:{state,fileId,url}, opId}` | `'duplicate'` при повторном `opId`, иначе `undefined` | `assertLogisticsFor(t,'create')`; `validation`: первое сообщение `validateExpense`; «Фото чека ещё не загружено» (receipt.state≠'ready') | `t.expenses.push({id:'x'+seq, category, amount:Number(заменой ','→'.'), date, comment, liters, receipt:{fileId, url}, at})`; `ops.add(opId)` | 450 | 2653 `saveExp`, 2563 `flush` (очередь) |
| `finishRoute(tripId)` | | — | `assertLogisticsFor(t,'create')` | `status='returning'` | 350 | 2620 `finishRoute` |
| `submitReturn(tripId, payload)` | как departure + `comment`, `opId` | `'duplicate'` или `undefined` | `assertLogisticsFor`; `validation`: «Сдача не завершена: …» (`inspMissing(…,'ret', t.dep.odometer)`); «Не все фото загружены на сервер» | `t.ret={…, comment, at}`; `recordInspection(t,'ret')`; `status='submitted'`, `v.state='review'`; `t.review = review ? {...review, resolved:true} : null`; `ops.add(opId)`; event проверяющим «Смена Р-208 сдана на приёмку · ГАЗель Next А 412 МР 77» | 650 | 2631 `submitRet`, 2567 `flush` |
| `reviewTrip(tripId, {decision, comment, steps})` | `decision:'accept'|'rework'` | accept: числовой id события начисления; rework: `undefined` | `assertCan('logistics','review', t.unit)`; `conflict`: «Смена уже обработана» (status≠submitted); rework: `validation` «Опишите, что нужно исправить», «Отметьте хотя бы один раздел для доработки» | rework: `status='rework'`, `t.review={decision, comment, steps, at}`, event водителю «Смена Р-208 возвращена на доработку: <comment>». accept: `status='accepted'`, `review={decision:'accept', comment, at}`, `v.state='free'`, `heldBy=null`, `v.odometer=t.ret.odometer`, `earnings.push({id:'n'+seq, tripId, unit, member: driverId, amount: t.earnings, status:'Начислено'})`, event водителю+проверяющим «Смена Р-208 принята. Машина свободна.», sensitive-event проверяющим «Начисление по рейсу Р-208: 4 500 ₽» (`sensitive:'earnings', unit`) | 600 | 2799 `accept`, 2807 `rework` |
| `resetTrip(tripId)` | | — | без сети (`needsNet=false`), без прав | `{vehicleId:null, status:'planned', dep:null, ret:null, expenses:[], review:null, defect:null}` — машина **не** освобождается | 250 | 2665 `newShift` (демо) |
| `requestDriver({driverId, tripId, comment})` | | — | `assertActive`; `assertCan('logistics','edit', t.unit)`; `conflict`: «Запрос уже отправлен» | `pool.requests.push({id:'q'+seq, driverId, tripId, comment, status:'pending', home: d.home, at})` | 420 | 2819 `saveRequest` (`poolVM`) |
| `decideRequest(requestId, approve)` | | — | нет проверок (демо) | `status='approved'|'declined'`, `decidedAt`; approve: `t.driverId=d.id`, `t.driverName='Водитель #104 · временно'`, `q.until='18:00 01.10'`; event проверяющим «Запрос водителя Водитель #104 одобрен фирмой Юг Транс» / «отклонён фирмой» | 420 | 3314/3315 `poolVM` («Демо: одобрить / отклонить») |

### 4.6 Формы, задачи, календарь, база знаний (`ortus/api.js:415–476`)

| Метод | Параметры | Возвращает | Guards / ошибки | Побочные эффекты | Задержка | Вызовы |
|---|---|---|---|---|---|---|
| `publishForm(formId, fields)` | массив полей черновика | новая версия `v` | `assertCan('forms','settings')`; `validation`: «В форме нет ни одного поля»; «У поля нет подписи» | поле со сменой `type` получает новый id `old.id + '-v' + (published+1)`; `delete x.changed`; `versions.push({v, at:'01.10.2026', by:'Дарья Зимина', fields})`; `published=v`, `status='published'`, `delete f.draft`; event владельцам «Опубликована форма «Осмотр машины» v4. Старые ответы сохраняют свои версии» | 500 | 4449 `publishForm` |
| `moveTask(taskId, to)` | | — | `assertCan('tasks','edit')`; `transition`: «Переход «Новая → Готово» не предусмотрен процессом» (по `wfOf(db,t).flow`); `validation`: «Нельзя завершить: в чек-листе есть невыполненные пункты» | `status=to`; `comments.push({by:'Система', at, text:'Статус: A → B', system:true})` | 300 | 4399 `tasksVM` |
| `toggleTaskCheck(taskId, i)` | индекс | — | `assertCan('tasks','edit')` | `checklist[i].d = !d` | 200 | 4401 `tasksVM` |
| `commentTask(taskId, text)` | | — | `assertCan('tasks','view')`; `validation`: «Комментарий пустой» | `comments.push({by: имя актора или '—', at, text})` | 250 | 4411 `tasksVM` |
| `createTask({title, assignee, priority, due, project})` | `due` в формате `YYYY-MM-DD` | id `'T-'+(70+seq)` | `assertCan('tasks','create')`; `validation`: «Укажите название задачи» | `tasks.unshift({id, title, assignee, status:'Новая', priority, due: 'DD.MM' или '—', project: project || первый проект || 'fleet', checklist:[], comments:[], links:[]})` | 350 | 4389 `tasksVM` |
| `moveBooking(bookingId, start)` | новое начало (часы, число) | — | нет проверки прав; `conflict`: «Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («…»)» с `extra.slots` = `freeSlots(bookings, b, 3)` | `b.start=start`, `b.end=start+dur` | 400 | 4143, 4145 `calVM` |
| `saveKbPage(pageId, body, baseVersion)` | | `last.v + 1` | `assertCan('knowledge','create')`; `conflict`: «Страницу уже изменили (v3). Обновите и повторите правку.»; `validation`: «Текст страницы пустой» | `versions.push({v, at:'01.10.2026', by: имя актора, body: trim})` | 400 | 4172 `kbVM` |

### 4.7 SPA, касса, ремонт (`ortus/api.js:479–549`)

| Метод | Параметры | Возвращает | Guards / ошибки | Побочные эффекты | Задержка | Вызовы |
|---|---|---|---|---|---|---|
| `completeAppointment(apId)` | | `'duplicate'` (status≠confirmed) / `'shortage'` / `'ok'` | `assertActive`; `assertCan('spa','create')` | по каждой позиции `recipe` списывает `min(qty, need)`: `stock.qty -= take`, `movements.unshift({id:'MV-'+seq, at, item, qty, unit, basis:'SPA-ритуал · Ольга Р.'})`; при нехватке `status='done_pending'`, `issues.unshift({id:'IS-'+seq, ap, item, need, unit, missing, text:'Не хватило «Крем восстанавливающий»: нужно 20 г, списано 12 г · SPA-ритуал (Ольга Р.)', status:'open'})`, event владельцам «SPA: услуга выполнена, учёт материалов не завершён — нужно решение»; иначе `status='done'` | 450 | 4245 `spaVM` |
| `resolveIssue(issueId, how)` | `'reserve'|'actual'` | — | нет проверок | `status='resolved'`, `how`; если открытых по визиту нет → `ap.status='done'` | 300 | 4237/4238 `spaVM` |
| `addCashOp({account, type, amount, basis, src})` | type `'in'|'out'|'refund'` | id `'K-'+(300+seq)` | `assertActive`; `assertCan('cash','create')`; `validation`: «Сумма должна быть больше нуля»; «Укажите основание операции» | `ops.unshift({id, account, type, amount, basis, at:'01.10', by, src: src || null})` | 350 | 4267 форма, 4269 предложения из принятых расходов (`cashVM`) |
| `reverseCashOp(opId, reason)` | | — | `assertCan('cash','create')`; `validation`: «Укажите причину исправления»; `conflict`: «Операция уже исправлена» (`reversedBy` или `reverses`) | `ops.unshift({id:'K-…', account, type:'storno', amount, basis:'Сторно K-302: <reason>', at:'01.10', by, reverses: o.id, sign: o.type==='in' ? -1 : 1})`; `o.reversedBy=id` | 350 | 4272 `cashVM` (reason `'ошибка ввода (демо)'`) |
| `addWorkLog({work, volume, crew, material, materialQty, photos})` | | id `'WL-'+(10+seq)` | `assertActive`; `assertCan('repair','create')`; `validation`: «Объём должен быть больше нуля»; «Объём превышает план более чем на 10%: осталось 38 м²» (`fact+v > plan*1.1`); «Отметьте работников»; «Добавьте хотя бы одно фото» | `logs.unshift({id, at, work, volume, crew, materials: material && qty>0 ? [[material, qty]] : [], photos, status:'На проверке', by:'Алексей Соколов'})`; event владельцам «Прораб отметил «Подготовка стен»: 22 м² — нужна приёмка» | 450 | 4347 `repairVM` |
| `acceptWorkLog(logId)` | | — | `assertCan('repair','review')`; `conflict`: «Отметка уже обработана» | `status='Принят'`; `work.fact += volume`; материалы: `qty = max(0, qty - q)` | 350 | 4298 `homeVM` («Принять объём»), 4350 `repairVM` |

### 4.8 Файлы (`ortus/api.js:552–568`)

| Метод | Параметры | Возвращает | Ошибки | Поведение |
|---|---|---|---|---|
| `upload({name, bytes = 3.2e6}, onProgress)` | имя, размер; колбэк прогресса | `{ fileId: 'file-'+seq, state: 'ready', name }` | `offline`: «Нет связи. Фото сохранено на устройстве и будет отправлено позже.» (до старта); `quota_exceeded`: «Место организации заполнено. Загрузка новых файлов недоступна.» (если `usedGb >= quotaGb` и нет начатого рейса в `inspection|on_route|returning|rework`); `offline`: «Связь прервалась во время загрузки.» (в процессе); `upload_failed`: «Загрузка прервалась. Повторите попытку.» (флаг `failUploadNext`, при p > 55) | шаги `p = 8, +14…22` каждые 110 мс, колбэк `min(p, 96)`; затем 160 мс и `onProgress(100)`; `usedGb += bytes/1e9` (округление до 0,001). Вызовы: 2508 `uploadPhoto`, 2562 `flush` |

---

## 5. `view()`: что получает каждый актор (`ortus/api.js:70–97`)

| Поле ответа | Правило |
|---|---|
| оператор (`actor === null`) | `{ platform: clone(db.platform), operatorOnly: true, flags }` — **весь** platform (tenants, priceBook, requests, accounts, operators, audit); бизнес-данных нет |
| `platform` (сотрудник) | без `audit`, `accounts`, `operators`; `requests` только своей организации; `tenants` только своя |
| `trips[].earnings` | удаляется, если `!canEarnings(actor, t.unit).ok` |
| `earnings` | `[]`, если актор не видит начисления ни по одному рейсу |
| `events` | только адресованные актору (`to` содержит actor) и не sensitive, либо sensitive при `canEarnings(actor, e.unit).ok` |
| `vehicles` | только `can(logistics-as-enabled, 'view', v.unit).ok` |
| `trips` | видимость как у машин **и** (`can('edit', t.unit)` или `t.driverId === actor`) |
| `projects` | владелец — все; иначе есть грант с `actions.tasks` и областью, покрывающей `p.unit` |
| `tasks` | задачи видимых проектов **или** `assignee === me.name` |
| `responses` | все, если `can(logistics-as-enabled,'view','f-msk-sever')`, иначе только `author === me.name` |
| `knowledge.pages` | `access === 'all'` или актор-владелец |
| `cash` | `{ accounts: [], ops: [], hidden: true }`, если `!can('cash','view')` |
| `calendar.bookings` | не-владелец: брони с `source.kind === 'vehicle'` только при `seesFleet('f-msk-sever')` |
| `flags` | копия флагов |
| не фильтруются | `members`, `roles`, `assignments`, `groups`, `units`, `modules`, `storage`, `forms`, `pool`, `spa`, `repair`, `calendar.resources`, `knowledge.spaces` ⚠ |

Следствия для seed t-alta: водитель `m-vasiliev` видит 5 машин (`f-msk-sever`: v1, v6, v2, v3, v4) и 1 рейс (Р-208 — свой); Р-211 без водителя ему не виден. Владелец видит 7 машин и 2 рейса. Логист `m-kotova` до назначения роли не видит ни машин, ни рейсов, ни проектов (нет грантов).

---

## 6. Коды ошибок мока и их соответствие реестру `docs/12-errors-and-events.md`

`ApiError(code, message, extra)` (`ortus/api.js:7–9`); UI выбирает поведение по `code` (`Ортус CRM.dc.html:2455–2457`). Реестр требует формат `application/problem+json` с полями `type, title, status, code, detail, requestId, violations, retryable` (`docs/12-errors-and-events.md:7–24`).

| Код мока | Где | Канонический код (HTTP) по `docs/12` |
|---|---|---|
| `not_found` | `trip()`, `veh()` | `not_found` (404) |
| `offline` | `assertNet`, `upload` | клиентское состояние `offline` (без HTTP) (`docs/12:67`) |
| `subscription_restricted` | `assertActive` | `tenant_read_only` (403) для restricted; `tenant_suspended` (403) для suspended ⚠ мок не различает |
| `module_off` | `can`, `reserve`, `assertLogisticsFor` | `module_not_installed` (403) |
| `module_readonly` | `can` при `history` | `module_read_only` (403) |
| `no_permission` | `can`, `canEarnings` | `forbidden_action` (403) |
| `no_scope` | `can`, `canEarnings` | `not_found` (404) — «Одинаково для чужих и несуществующих ID» (`docs/12:41`) ⚠ прототип показывает отдельную причину «Нет доступа к объекту» только в локальной «Проверке доступа» |
| `driver_block` | `canEarnings` | `function_blocked` (403) |
| `validation` (суммы, даты, пустые поля) | повсюду | `validation_failed` (422) с `violations[]`; «Пробег не может быть меньше…» → `odometer_decrease` (422); «Сумма…» → `amount_invalid` (422) |
| `validation` «Осмотр не завершён / Сдача не завершена» | `submitDeparture/Return` | `inspection_incomplete` (409) |
| `validation` «Не все фото загружены на сервер», «Фото чека ещё не загружено» | там же, `addExpense` | `photo_not_ready` (409) |
| `conflict` (бронь) | `reserve`, `assignVehicle` | `reservation_overlap` (409) |
| `conflict` (календарь) | `moveBooking` | `resources_unavailable` (409) + слоты |
| `conflict` «Смена уже обработана», «Отметка уже обработана», «Операция уже исправлена», «Заявка уже рассмотрена…», «Приглашение уже принято или отозвано», «Запрос уже отправлен» | | `invalid_transition` (409) ⚠ для `requestSeats` docs/17 называет `request_pending` (409) (`docs/17-users-and-billing.md:138`) |
| `conflict` «Страницу уже изменили (vN)» | `saveKbPage` | `revision_mismatch` (412) |
| `conflict` «Участник с таким адресом уже есть», «Оператор с такой почтой уже есть» | `invite`, `inviteOperator` | ⚠ в реестре нет (ближайшее — 409 без кода) |
| `incompatible` | `reserve`, `assignVehicle` | `vehicle_incompatible` (409) |
| `transition` | `moveTask` | `invalid_transition` (409) |
| `role_conflict` | `assign`, `saveRole` | `separation_of_duties_conflict` (409) |
| `last_owner` | `unassign` | `last_owner_required` (409) |
| `forbidden` «Системная роль не редактируется» | `saveRole` | `forbidden_action` (403) |
| `seats_exhausted` | `invite` | ⚠ не найдено в реестре `docs/12`; по смыслу 402 `feature_requires_plan` или 409 |
| `quota_exceeded` | `upload` | `quota_exceeded` (409) |
| `upload_failed` | `upload` | ⚠ клиентское/транспортное, в реестре нет |

Дополнительно `extra`: `reserve` → `{ vehicleId }`; `moveBooking` → `{ slots: number[] }`; HTTP-адаптер → `{ status }`.

---

## 7. `createHttpAdapter` → OpenAPI 0.1 (`ortus/api.js:573–627`)

Транспорт: `fetch(baseUrl + path)` с `Authorization: Bearer <token>`, опционально `If-Match` и `Idempotency-Key`; ошибка → `ApiError(p.code || status, p.detail || p.title || statusText, { status })`; 204 → `null` (`api.js:574–582`). `T = '/tenants/' + tenantId`; `baseUrl` по умолчанию `/api/v1`.

| Метод | HTTP | Путь | В OpenAPI 0.1? |
|---|---|---|---|
| `load` | GET | `/me/context` | да (`openapi:66`) |
| `extendTrial` | PATCH | `/platform/tenants/{id}/subscription` `{trialExtendDays}` | да (353) |
| `setTenantQuota` | PATCH | `/platform/tenants/{id}/subscription` `{storageQuotaGb}` | да (353) |
| `setTenantStatus` | PATCH | `/platform/tenants/{id}` `{status}` | да (207) |
| `revokeInvite` | DELETE | `T/invitations/{id}` | **PROPOSED** (`docs/17:140`); в OpenAPI только `/invitations` (710) |
| `requestSeats` | POST | `T/subscription/change-requests` | PROPOSED (`docs/17:138`) |
| `cancelSeatRequest` | POST | `T/subscription/change-requests/{id}/cancel` | PROPOSED (`docs/17:139`) |
| `decideSeatRequest` | POST | `/platform/subscription-requests/{id}/decision` `{approve, note}` | ⚠ не найдено ни в OpenAPI, ни в docs/17 |
| `publishPriceBook` | POST | `/platform/price-book/versions` | PROPOSED (`docs/17:146`) |
| `cancelScheduledPriceBook` | DELETE | `/platform/price-book/versions/scheduled` | PROPOSED (`docs/17:147`) |
| `setAccountLock` | PATCH | `/platform/accounts/{id}` `{locked, reason}` | ⚠ OpenAPI имеет `/platform/users` (310), не `accounts` |
| `resetMfa` | POST | `/platform/accounts/{id}/mfa-reset` | PROPOSED (`docs/17:145`) |
| `inviteOperator` | POST | `/platform/operators` | PROPOSED (`docs/17:149`; `role=owner → 422`) |
| `setOperatorRole` | PATCH | `/platform/operators/{id}` `{role}` | PROPOSED (`docs/17:150`) |
| `setOperatorStatus` | PATCH | `/platform/operators/{id}` `{active}` | PROPOSED (`docs/17:150`) |
| `setModule` | PATCH | `T/modules/{key}` `{enabled}` | да (1558) |
| `saveBranding` | PUT | `T/branding` | ⚠ нет в OpenAPI 0.1 (модель — `docs/18-branding.md`) |
| `setStorageQuota` | POST | `T/storage/changes` `{quotaGb, mode:'apply'}` | да (602) |
| `invite` | POST | `T/invitations` | да (710) |
| `assign` | POST | `T/assignments` | да (1143) |
| `unassign` | DELETE | `T/assignments/{id}` | да (1254) |
| `createRole` | POST | `T/roles` | да (876) |
| `saveRole` | PATCH | `T/roles/{id}` + `If-Match: r.etag` | да (987) |
| `reserve` | POST | `T/fleet/reservations` `{tripId, vehicleId}` | да (3825) |
| `cancelReservation` | PATCH | `T/fleet/reservations/{tripId}` `{status:'cancelled'}` | ⚠ путь ожидает `{reservationId}` (3935), прототип передаёт `tripId` |
| `assignVehicle` | PATCH | `T/fleet/trips/{id}` `{vehicleId}` | да (4250) |
| `submitDeparture` | POST | `T/fleet/inspections` `{tripId, kind:'departure', …}` + `Idempotency-Key: p.opId` | да (4041) ⚠ UI не передаёт `opId` в departure (`Ортус CRM.dc.html:2607`) |
| `decideDefect` | POST | `T/fleet/trips/{id}/defect-decision` `{decision}` | PROPOSED (комментарий `api.js:614`); в OpenAPI есть `/fleet/inspections/{id}/review` (6038) ⚠ |
| `addExpense` | POST | `T/fleet/trips/{id}/expenses` + `Idempotency-Key` | да (4425) |
| `finishRoute` | PATCH | `T/fleet/trips/{id}` `{status:'returning'}` | да (4250) |
| `submitReturn` | POST | `T/fleet/inspections` `{tripId, kind:'return', …}` + `Idempotency-Key` | да (4041) |
| `reviewTrip` | POST | `T/fleet/trips/{id}/review` | да (4359) |
| `requestDriver` | POST | `T/fleet/driver-transfer-requests` | да (4648) |
| `decideRequest` | POST | `T/fleet/driver-transfer-requests/{id}/decision` `{approve}` | да (4751) |
| `upload` | POST | `T/files/uploads` `{name, size}` → POST `…/uploads/{id}/complete` | да (1893, 1955); реальный прогресс — «через XHR/PUT по выданной ссылке» (`api.js:623`) |

**Нет в HTTP-адаптере** (17 методов): `setActor`, `tenantIds`, `setFlag`, `defaultBranding`, `resetTrip`, `publishForm`, `moveTask`, `toggleTaskCheck`, `commentTask`, `createTask`, `moveBooking`, `saveKbPage`, `completeAppointment`, `resolveIssue`, `addCashOp`, `reverseCashOp`, `addWorkLog`, `acceptWorkLog`. Кандидаты из OpenAPI: `/tasks` (2167), `/tasks/{id}` (2270), `/tasks/{id}/transitions` (2376), `/calendar/bookings/{id}` (2813), `/knowledge/pages/{id}` (2548), `/forms/{id}/versions/{vid}/publish` (3235), `/spa/appointments/{id}/completion` (5135), `/cash/operations` (5518), `/repairs/work-logs` (5736). Roadmap называет те же пути (`ortus/roadmap.js:15, 28, 42, 64, 103, 117, 131`).

---

## 8. Каталог доменных функций (`ortus/models.js`) с примерами для unit-тестов

Все примеры — на seed t-alta из `ortus/mock-data.js` (с `modules.logistics.enabled` указано явно). `int()`/`rub()` используют `toLocaleString('ru-RU')`: разделитель тысяч — **неразрывный пробел U+00A0**.

### 8.1 Структура и области

| Функция | Строки | Правило | Примеры |
|---|---|---|---|
| `unit(db, id)` | 145 | поиск в `db.units` | `unit(db,'r-msk').name` → `'Москва'`; `unit(db,'x')` → `undefined` |
| `unitLabel(db, id)` | 146–150 | регион → имя; фирма → `'<регион> / <фирма>'`; нет → `'—'` | `'f-msk-sever'` → `'Москва / Север Логистик'`; `'r-smr'` → `'Самара'`; `'nope'` → `'—'` |
| `firmsOf(db, regionId?)` | 151 | фирмы региона или все | `firmsOf(db).length` → 12; `firmsOf(db,'r-smr')` → 4 (`f-smr-volga, f-smr-truck, f-smr-zhig, f-smr-priv`) |
| `scopeCovers(db, scope, unitId)` | 153–160 | tenant → всегда; region → unit сам регион или его фирма; firm → только эта фирма; **self → false**; нет scope/unit → false | `({type:'region',id:'r-msk'}, 'f-msk-yug')` → true; `({type:'firm',id:'f-msk-sever'}, 'f-msk-yug')` → false; `({type:'self'}, 'f-msk-sever')` → false; `({type:'tenant'}, 'anything')` → true |
| `scopeLabel(db, scope)` | 161–167 | | `undefined` → `'Область не выбрана'`; tenant → `'Вся организация'`; `{region,'r-msk'}` → `'Регион Москва'`; `{firm,'f-msk-sever'}` → `'Москва / Север Логистик'`; self → `'Только назначенное лично'` |

### 8.2 Права

| Функция | Строки | Правило | Примеры |
|---|---|---|---|
| `moduleOn(db, key)` | 169 | core-модули всегда вкл.; industry — по `db.modules[key].enabled` | `moduleOn(db,'tasks')` → true; `moduleOn(seed,'logistics')` → false; `moduleOn(seed,'spa')` → true |
| `grants(db, memberId)` | 171–175 | назначения участника с подставленным `roleObj`; назначения с несуществующей ролью отбрасываются | `grants(db,'m-owner')` → 1 (`a1`, roleObj r-owner); `grants(db,'m-kotova')` → `[]` |
| `can(db, memberId, mod, verb, unitId?)` | 177–187 | 1) модуль выключен → `{ok:false, reason: history ? 'module_readonly' : 'module_off'}`; 2) нет гранта с `roleObj.all` или `actions[mod]` ∋ verb → `no_permission`; 3) `unitId` задан и ни один грант не покрывает → `no_scope`; иначе `{ok:true, via: грант}` | `can(seed,'m-owner','logistics','view')` → `{ok:false, reason:'module_off'}`; при `logistics.enabled` → `{ok:true, via:a1}`; `can(on,'m-vasiliev','logistics','review','f-msk-sever')` → `no_permission`; `can(on,'m-vasiliev','logistics','view','f-msk-yug')` → `no_scope`; `can(on,'m-vasiliev','logistics','view','f-msk-sever')` → `{ok:true, via:a2}`; `can(seed,'m-sokolov','repair','create')` → `module_off`; после `setModule('repair',true)` затем `false` → `module_readonly`; `can(seed,'m-morozova','spa','view')` → ok; `can(seed,'m-morozova','spa','view','f-msk-sever')` → `no_scope` (self); `can(seed,'m-kotova','tasks','view')` → `no_permission` |
| `canEarnings(db, memberId, unitId?)` | 189–198 | нет участника → `no_permission`; `function==='driver'` → `driver_block` (раньше любых ролей); нужен грант `all` или `finance.read`; при `unitId` — покрытие области | `('m-vasiliev')` → `driver_block`; `('m-owner','f-smr-volga')` → `{ok:true}`; `('m-kotova')` → `no_permission`; после `assign(m-kotova, r-manager, firm f-msk-sever)`: `('m-kotova','f-msk-sever')` → ok, `('m-kotova','f-msk-yug')` → `no_scope`; `('nobody')` → `no_permission` |
| `rolePermKeys(role)` | 200–210 | `all` → `['*']`; иначе ключи из `ALL_MODULES[mod].perms[verb]` + `fleet.earnings.read/manage` по `finance` | `r-owner` → `['*']`; `r-driver` → 10 ключей: `fleet.vehicles.read, fleet.trips.read, fleet.reservations.create, fleet.inspections.create, fleet.expenses.create, forms.read, forms.responses.create, calendar.read, files.upload, knowledge.read`; `r-manager` → 22 ключа (9 logistics + `calendar.read, calendar.bookings.create, calendar.bookings.manage, tasks.read, tasks.create, tasks.manage, forms.read, forms.responses.review, data.read, data.export, files.read, knowledge.read, fleet.earnings.read`) |

### 8.3 Логистика

| Функция | Строки | Правило | Примеры |
|---|---|---|---|
| `compat(v, trip)` | 212–230 | `avail = v.state==='free' || v.heldBy===trip.id`; проверки `payload: v.payloadT >= c.weightT`, `volume`, `length`; `temp`: если груз требует — `v.temp && v.temp[0] <= c.temp[0] && v.temp[1] >= c.temp[1]`, иначе ok `'не требуется'`; `fit` = все, кроме доступности; `ok = fit && avail`; `reasons` = `'<label>: <value>, нужно <need>'` | `compat(v1, Р-208)` → `{fit:true, ok:true, reasons:[]}`, checks[1].value `'1,5 т'`, need `'от 1,1 т'`; `compat(v3, Р-208)` → `fit:false`, reasons `['Грузоподъёмность: 0,9 т, нужно от 1,1 т', 'Объём: 9 м³, нужно от 12 м³']`; `compat(v4, Р-208)` → `fit:true, ok:false`, reasons `['Доступность: Недоступна · Плановое ТО до 03.10']`; `compat(v2, Р-211)` → ok, temp.value `'-18…+8 °C'`, need `'+2…+6 °C'`; `compat(v1, Р-211)` → reasons `['Температура: без охлаждения, нужно +2…+6 °C']`; машина с `heldBy===trip.id` → avail.value `'Назначена на этот рейс'` |
| `tempLabel(t)` | 231 | знак `+` для положительных, `…`, ` °C` | `[-18,8]` → `'-18…+8 °C'`; `[2,6]` → `'+2…+6 °C'`; `[0,4]` → `'0…+4 °C'` |
| `legs(trip, v?)` | 233–242 | по остановкам: `load` +, `unload` −; не ниже 0; округление до 0,01; проценты от `payloadT`/`volumeM3` или `null` без машины | `legs(Р-208, v1)` → `[{…, wAfter:1.1, vAfter:12, wPct:73, vPct:75}, {wAfter:0.4, vAfter:4, wPct:27, vPct:25}, {wAfter:0, vAfter:0, wPct:0, vPct:0}]`; `legs(Р-208)` → `wPct:null, vPct:null` |
| `inspMissing(d, kind, minOdo)` | 244–257 | фото: `ready+queued < 5` → `'N фото'`; пробег: пустой/не число → `'пробег'`, `< minOdo` → `'пробег не меньше 84 370 км'`; `!fuel` → `'уровень топлива'`; чек-лист (`DEP_CHECKS` или `RET_CHECKS`) → `'N пункт/пункта/пунктов чек-листа'` | пустой осмотр, `'dep'`, 84370 → `['5 фото', 'пробег', 'уровень топлива', '3 пункта чек-листа']`; 5 фото ready, odometer `'84 400'`, fuel `'h'`, checks `{body:true}` → `['2 пункта чек-листа']`; odometer `'84000'` → содержит `'пробег не меньше 84 370 км'`; 4 ready + 1 queued → без `'фото'` |
| `odoError(value, minOdo)` | 259–266 | `''` → null; не число → `'Введите число'`; `< min` → `'Пробег не может быть меньше 84 370 км'`; `> min+3000` → `'Больше начального на 5 630 км — проверьте показания'`; пробелы игнорируются | `('', 84370)` → null; `('abc')` → `'Введите число'`; `('84000')` → «…меньше 84 370 км»; `('90000')` → «Больше начального на 5 630 км — проверьте показания»; `('84 500')` → null; `('87370')` → null (граница включительно) |
| `validateExpense(e)` | 268–279 | `amount`: `''`/null → `'Укажите сумму'`; NaN → `'Сумма должна быть числом'`; ≤0 → `'Сумма должна быть больше нуля'`; >200000 → `'Больше 200 000 ₽ — проверьте сумму'` (запятая и пробелы допустимы); `!date` → `'Укажите дату'`; receipt `uploading` → `'Дождитесь окончания загрузки чека'`; не `ready|queued` → `'Добавьте фото чека'` | `{amount:'', date:'2026-10-01', receipt:{state:'ready'}}` → `{amount:'Укажите сумму'}`; `{amount:'1 500,50', date:'2026-10-01', receipt:{state:'queued'}}` → `{}`; `{amount:'0', date:'', receipt:{state:'empty'}}` → `{amount:'Сумма должна быть больше нуля', date:'Укажите дату', receipt:'Добавьте фото чека'}`; `{amount:'250000', …}` → `amount:'Больше 200 000 ₽ — проверьте сумму'` |

### 8.4 Календарь

| Функция | Строки | Правило | Примеры (брони из `ortus/extra-data.js:15–22`) |
|---|---|---|---|
| `busySpan(b)` | 282 | `[start − prep, end + clean]` | `b-a2` → `[11.25, 13.25]`; `b-a1` → `[10, 11.25]`; `b-br` → `[13.25, 14]` |
| `bookingConflicts(bookings, cand, resources)` | 283–292 | пропускает `b.id === cand.id`; пересечение `a0 < b1 && b0 < a1`; по каждому общему ресурсу → `{res, resName, title}` | `cand = {...b-a1, start:11.5, end:12.5}` → 2 конфликта с `b-a2`: `{res:'res-am', resName:'Анна Морозова · массажист', title:'SPA-ритуал · Ольга Р.'}`, `{res:'res-room2', resName:'Кабинет № 2', …}`; `cand = {...b-a3, start:15, end:15.75}` → `[]`; без `resources` → `resName === res` |
| `freeSlots(bookings, b, n, from=8, to=20)` | 293–300 | шаг 0,25 ч от `from + prep`, пока `t + dur + clean <= to`; пропускает `t === b.start`; первые `n` без конфликтов | `freeSlots(bookings, b-a1, 3)` → `[8, 8.25, 8.5]` |
| `hm(t)` | 301 | `HH:MM` | `8.25` → `'08:15'`; `13.25` → `'13:15'`; `14.75` → `'14:45'`; `9` → `'09:00'` |

### 8.5 Задачи и процессы

| Элемент | Строки | Содержимое |
|---|---|---|
| `TASK_STATUSES` | 124 | `['Новая', 'В работе', 'На проверке', 'Готово']` (без «Отменена») |
| `TASK_FLOW` | 125 | `'Новая' → ['В работе','Отменена']`; `'В работе' → ['На проверке','Новая']`; `'На проверке' → ['Готово','В работе']`; `'Готово' → ['В работе']`; `'Отменена' → ['Новая']` |
| `TASK_TONE` | 126 | `'Новая':['neutral','radio_button_unchecked']`, `'В работе':['info','pending']`, `'На проверке':['warn','rate_review']`, `'Готово':['ok','check_circle']`, `'Отменена':['neutral','block']` |
| `WORKFLOWS.leads` | 131–134 | statuses `['Новая','Замер','Смета','Договор','Объект']`; flow `'Новая'→['Замер','Отказ']`, `'Замер'→['Смета','Отказ']`, `'Смета'→['Договор','Замер','Отказ']`, `'Договор'→['Объект','Смета','Отказ']`, `'Объект'→[]`, `'Отказ'→['Новая']`; tone `'Замер':['info','straighten']`, `'Смета':['warn','request_quote']`, `'Договор':['warn','contract']`, `'Объект':['ok','apartment']`, `'Отказ':['neutral','block']`; `item:'заявка', items:'Заявки', done:'Объект'` |
| `WORKFLOWS.tasks` | 129 | `item:'задача', items:'Задачи', done:'Готово'` |
| `wfOf(db, t)` | 137 | по `projects.find(id===t.project).flow`, иначе `tasks` | `wfOf(db, L-31)` → leads; `wfOf(db, T-61)` → tasks; задача без проекта → tasks |
| `PRIORITY` | 138 | `urgent:['Срочно','danger','priority_high']`, `high:['Высокий','warn','keyboard_double_arrow_up']`, `normal:['Обычный','neutral','remove']`, `low:['Низкий','neutral','keyboard_arrow_down']` |

Примеры `moveTask`: `T-58` («В работе») → `'На проверке'` ok; `T-58` → `'Готово'` → `transition`; `T-63` («На проверке», чек-лист закрыт) → `'Готово'` ok; `T-58` → `'Новая'` ok (обратный переход); `L-31` → `'Замер'` ok; `L-31` → `'В работе'` → `transition`.

### 8.6 Форматирование и мелочи

| Функция | Строки | Примеры |
|---|---|---|
| `num(n)` | 140 | `1.5` → `'1,5'`; `12` → `'12'` |
| `int(n)` | 141 | `84370` → `'84 370'` (U+00A0) |
| `rub(n)` | 142 | `4500` → `'4 500 ₽'`; `1600.5` → `'1 600,5 ₽'`; `2500` → `'2 500 ₽'` |
| `plural(n, a, b, c)` | 143 | `(1)`→a, `(2)`→b, `(5)`→c, `(11)`→c, `(21)`→a, `(22)`→b, `(112)`→c |
| `emailOk(s)` | 303 | `'a@b.co'` → true; `' a@b.co '` → true; `'a@b'` → false; `'a b@c.d'` → false |
| `initials(name)` | 304 | `'Дарья Зимина'` → `'ДЗ'`; `'Водитель #104 · временно'` → `'В#'` |

### 8.7 Справочники (дословно)

| Константа | Строки | Значения |
|---|---|---|
| `TONES` | 11–17 | `ok {bg:'#E3EFE7', fg:'#1F6B52'}`, `info {'#E7EEF6','#2B5479'}`, `warn {'#FAF1DC','#7A5214'}`, `danger {'#FBEAE7','#A13A33'}`, `neutral {'#ECEFEA','#4C5955'}` |
| `VERBS` | 19–22 | `view 'Просматривать'`, `create 'Создавать'`, `edit 'Изменять'`, `review 'Проверять'`, `export 'Выгружать'`, `settings 'Настраивать'` |
| `INDUSTRY.logistics` | 25–37 | `name:'Логистика', icon:'local_shipping', desc:'Машины, рейсы, осмотры, расходы в пути и приёмка смен.', deps:['calendar','files','forms'], adds:['Рабочее место логиста','Мобильная смена водителя','Осмотры с обязательными фото','Приёмка смен'], templates:['Менеджер логистики','Водитель']` |
| `INDUSTRY.spa` | 38–48 | `name:'Салон и SPA', icon:'spa', desc:'Запись, специалисты, кабинеты, техкарты и списание материалов.', deps:['calendar','inventory','cash','forms'], adds:['Расписание специалиста','Визиты и техкарты','Списание материалов'], templates:['Массажист']` |
| `INDUSTRY.repair` | 49–59 | `name:'Ремонт и стройка', icon:'construction', desc:'Объекты, виды работ, бригады, материалы и фотоотчёты.', deps:['tasks','inventory','files'], adds:['Объекты и этапы','Отметки прораба','Фотоотчёты'], templates:['Прораб']` |
| `CORE` | 62–72 | `calendar 'Календарь' calendar_month`; `tasks 'Задачи' task_alt`; `knowledge 'База знаний' menu_book`; `forms 'Формы' dynamic_form`; `data 'Данные' table_view`; `files 'Файлы' folder_open`; `inventory 'Склад и материалы' inventory_2`; `cash 'Внутренняя касса' account_balance_wallet`; `notifications 'Уведомления' notifications` (perms `null`) |
| `REASON` | 77–83 | `module_off {label:'Модуль не подключён', icon:'extension_off', tone:'neutral', text:'Модуль не подключён организацией. Подключить его может владелец бизнеса.'}`; `module_readonly {'Модуль отключён · только чтение', 'history', 'neutral', 'Модуль отключён. История доступна для чтения, новые операции закрыты.'}`; `no_permission {'Нет права', 'lock', 'warn', 'Ни одна роль сотрудника не разрешает это действие.'}`; `no_scope {'Нет доступа к объекту', 'visibility_off', 'warn', 'Право есть, но объект находится вне области назначения.'}`; `driver_block {'Запрещено функцией «Водитель»', 'block', 'danger', 'Действующая функция «Водитель» запрещает начисления через любую роль и группу.'}` |
| `VEHICLE_STATE` | 85–91 | `free {'Свободна', ok, check_circle}`, `reserved {'Забронирована', info, event_available}`, `on_route {'На маршруте', info, route}`, `review {'Проверяется', warn, pending}`, `unavailable {'Недоступна', danger, block}` |
| `TRIP_STATE` | 93–103 | `planned {'Запланирован', neutral, event}`, `assigned {'Машина назначена', info, event_available}`, `inspection {'Осмотр перед выездом', info, fact_check}`, `defect_review {'Дефект на проверке', danger, report}`, `on_route {'В рейсе', info, route}`, `returning {'Сдача машины', info, assignment_return}`, `submitted {'Ожидает приёмки', warn, pending}`, `rework {'На доработке', warn, undo}`, `accepted {'Принят', ok, verified}` |
| `MEMBER_STATE` | 105–109 | `active {'Активен', ok, check_circle}`, `invited {'Приглашён', warn, schedule}`, `blocked {'Заблокирован', danger, block}` |
| `TENANT_STATE` | 111–116 | `trial {'Пробный период', info, hourglass_top}`, `active {'Действует', ok, check_circle}`, `restricted {'Ограничен', warn, lock_clock}`, `suspended {'Приостановлен', danger, pause_circle}` |
| `PHOTO_SIDES` | 118 | `front 'Спереди'`, `back 'Сзади'`, `left 'Слева'`, `right 'Справа'`, `odo 'Одометр'` |
| `DEP_CHECKS` | 119 | `body 'Кузов и стёкла осмотрены'`, `tires 'Шины и световые приборы исправны'`, `docs 'Документы и комплект на месте'` |
| `RET_CHECKS` | 120 | `cargo 'Груз выгружен полностью'`, `personal 'Личные вещи забраны'`, `keys 'Ключи и документы на месте'` |
| `DEFECT_ZONES` | 121 | `'Кузов', 'Стёкла', 'Шины и колёса', 'Световые приборы', 'Салон', 'Грузовой отсек', 'Тормоза и ходовая'` |
| `FUEL` | 122 | `q '¼'`, `h '½'`, `tq '¾'`, `f 'Полный'` |
| `EXPENSE_CAT` | 123 | `fuel {'Топливо', local_gas_station}`, `wash {'Мойка', local_car_wash}` |

Переходы состояний рейса/машины, реализованные моком (сводно):

```
planned ─reserve→ inspection ─submitDeparture→ on_route ─finishRoute→ returning ─submitReturn→ submitted ─reviewTrip(accept)→ accepted
                                 └(critический дефект)→ defect_review ─decideDefect(allow)→ on_route
                                                                      └decideDefect(deny)→ planned (машина unavailable)
planned ─assignVehicle→ assigned                      submitted ─reviewTrip(rework)→ rework ─submitReturn→ submitted
машина: free → reserved (reserve/assignVehicle) → on_route → review (submitReturn) → free (accept); unavailable при критическом дефекте
```

---

## 9. Seed: инвентарь и ключевые фикстуры

### 9.1 Платформа (`ortus/mock-data.js:90–142`, общая для всех организаций)

| Сущность | Кол-во | Ключевые записи |
|---|---|---|
| `tenants` | 4 | `t-alta` «Альта Групп», owner «Дарья Зимина», `trial`, `trialEnds:'13.10.2026'`, `trialDaysLeft:12`, `quotaGb:100`, `usedGb:46.2`, `members:10`, `plan:{tier:'start', term:1, paidUntil:null, version:2}`, `seatsLimit:10`, `seatsUsed:9`; `t-lotos` «SPA «Лотос»», owner «Ирина Белова», `active`, 50/12.4 ГБ, `plan:{team,12,'31.03.2027',1}`, 25/23 мест; `t-remstroy` «Ремстрой Плюс», owner «Павел Орлов», `restricted`, `trialEnds:'20.09.2026'`, 25/19.8 ГБ, 10/5; `t-cargo` «Карго Сити», owner «Денис Шишкин», `suspended`, 100/63.0 ГБ, `plan:{team,4,'15.09.2026',1}`, 25/22 |
| `priceBook` | current `2`, 2 версии | v1 (01.06–30.09.2026, «Стартовая сетка пилота», by «Е. Лаптева»): `start 'Старт' 10 мест 3500`, `team 'Команда' 25 8500`, `biz 'Бизнес' 50 14900`, `unl 'Безлимит' null null`; v2 (с 01.10.2026, «Добавлена ступень «Сеть» до 100 мест, пересчитаны цены»): `start 3900`, `team 8900`, `biz 15900`, `net 'Сеть' 100 27900`, `unl`; terms обеих: `1 мес 0%`, `4 мес 5%`, `8 мес 10%`, `12 мес 20%` |
| `requests` | 2 | `SR-12` t-lotos team→biz, term 12, used 23, by «Ирина Белова», `pending`, comment «Открываем второй салон, нужно ещё 10–12 мест»; `SR-9` t-cargo start→team, `approved`, decidedBy «Е. Лаптева», decision «Оплата по счёту получена» |
| `accounts` | 13 + 45 сгенерированных = 58 | `acc-1` Дарья Зимина `d.zimina@alta.example` mfa, owner t-alta; `acc-2` Марина Котова (t-alta active, t-cargo `ended`); `acc-3` Илья Васильев; `acc-4` Анна Морозова (t-alta + t-lotos); `acc-5` Алексей Соколов (t-alta + t-remstroy); `acc-6` Олеся Петрова `pending`/invited; `acc-7` Кирилл Громов (membership `suspended`); `acc-8` Вера Котельникова; `acc-9` Тимур Ахмедов; `acc-10` Сергей Ильин `pending`; `acc-11` Ирина Белова `owner@lotos-spa.example`; `acc-12` Павел Орлов; `acc-13` Денис Шишкин `locked`, lockReason «Подозрительные входы из разных стран, 18.09». `fillAccounts` добирает `acc-g0…acc-g44` (`staffN@lotos-spa.example` ×21, `@remstroy.example` ×3, `@cargo.example` ×21) |
| `operators` | 6 | `op-1` Евгения Лаптева `owner` `me:true`, mfa «аппаратный ключ»; `op-2` Михаил Сорокин `owner`; `op-3` Алёна Гусева `billing`; `op-4` Игорь Пахомов `support`; `op-5` Дина Валиева `support` `invited` mfa null; `op-6` Станислав Рябов `admin` `disabled`, «Отключён 15.08: перевод в другой отдел» |
| `audit` | 2 | «Альта Групп: открыт пробный период на 14 дней, квота 100 ГБ» (Е. Лаптева); «Ремстрой Плюс: пробный период завершён, новые операции ограничены» (Система) |
| `brand` (seedBrands, `mock-data.js:11–19`) | 4 | `BRAND_DEFAULT = {short:'', accent:'#1F6B52', logo:null, mark:null, terms:{}, items:{}, order:[], poweredBy:true, version:1, updatedAt:null, updatedBy:null}` + `name`; t-lotos `short:'Лотос', accent:'#7A3E79', terms.visit {one:'сеанс', plural:'сеансы', few:'сеанса', many:'сеансов'}, version 3, updatedBy 'Ирина Белова'`; t-remstroy `short:'Ремстрой', accent:'#9A4A1F'`; t-cargo `short:'Карго', accent:'#2B5479', poweredBy:false, version 2` |

### 9.2 Организация t-alta (`ortus/mock-data.js:81–275`)

| Сущность | Кол-во | Записи |
|---|---|---|
| `tenantId`, `seq` | | `'t-alta'`, `100` |
| `units` | 15 | регионы `r-msk 'Москва'`, `r-smr 'Самара'`, `r-spb 'Санкт-Петербург'`; фирмы: `f-msk-sever 'Север Логистик'`, `f-msk-yug 'Юг Транс'`, `f-msk-vostok 'Восток Карго'`, `f-msk-centr 'Центр Экспресс'`; `f-smr-volga 'Волга Логистик'`, `f-smr-truck 'Самара Трак'`, `f-smr-zhig 'Жигули Карго'`, `f-smr-priv 'Приволжье Сервис'`; `f-spb-neva 'Нева Логистик'`, `f-spb-baltic 'Балтик Транс'`, `f-spb-ohta 'Охта Карго'`, `f-spb-pulk 'Пулково Экспресс'` |
| `modules` | 3 | `logistics {enabled:false}`, `spa {enabled:true}`, `repair {enabled:false}` |
| `storage.breakdown` | 4 | `['Фото осмотров и отчётов', 31.4], ['Документы', 9.8], ['Вложения задач и форм', 3.1], ['Прочее', 1.9]` |
| `members` | 10 | `m-owner` Дарья Зимина `d.zimina@alta.example` active «Владелец»; `m-kotova` Марина Котова active «Логист»; `m-vasiliev` Илья Васильев active «Водитель» `function:'driver'`; `m-morozova` Анна Морозова active «Массажист»; `m-sokolov` Алексей Соколов active «Прораб»; `m-petrova` Олеся Петрова `invited` «Диспетчер» «Приглашение до 06.10»; `m-gromov` Кирилл Громов `blocked` «Водитель» driver; `m-kotelnikova` Вера Котельникова active «Диспетчер · Самара»; `m-akhmedov` Тимур Ахмедов active «Водитель» driver; `m-ilyin` Сергей Ильин `invited` «Бухгалтер» «Приглашение до 07.10» |
| `groups` | 2 | `g-disp 'Диспетчеры Север' [m-kotova, m-petrova]`; `g-drv 'Водители Север' [m-vasiliev, m-gromov]` |
| `roles` | 5 | `r-owner 'Владелец бизнеса' system all finance{read,manage}`; `r-manager 'Менеджер логистики' template actions{logistics:[view,create,edit,review,export], calendar:[view,create,edit], tasks:[view,create,edit], forms:[view,review], data:[view,export], files:[view], knowledge:[view]} finance{read:true, manage:false}`; `r-driver 'Водитель' template professional:'driver' actions{logistics:[view,create], forms:[view,create], calendar:[view], files:[create], knowledge:[view]}`; `r-therapist 'Массажист' template actions{spa:[view,create], calendar:[view,edit], knowledge:[view]}`; `r-foreman 'Прораб' template actions{repair:[view,create], tasks:[view,create], files:[create], knowledge:[view]}` |
| `assignments` | 4 | `a1 m-owner r-owner {tenant}`; `a2 m-vasiliev r-driver {firm f-msk-sever} via 'группа «Водители Север»'`; `a3 m-morozova r-therapist {self}`; `a4 m-sokolov r-foreman {self}`. **Нет назначений** у m-kotova, m-petrova, m-gromov, m-kotelnikova, m-akhmedov, m-ilyin |
| `vehicles` | 7 | `v1` ГАЗель Next `А 412 МР 77` Тент 1.5 т/16 м³/4.2 м, odo 84370, free, «Склад № 1»; `v6` Mercedes Sprinter `Т 771 ЕХ 77` Фургон 1.6/14/4.3, 120544, free; `v2` Ford Transit `М 608 КТ 77` Рефрижератор 1.2/11/3.4, temp `[-18, 8]`, 61210, free; `v3` Hyundai Porter `В 233 ОС 77` Тент 0.9/9/3.1, 152003, free, «Склад № 2»; `v4` ГАЗон Next `Е 905 НА 77` Фургон 4.5/30/5.1, 40112, `unavailable`, note «Плановое ТО до 03.10»; `v5` Isuzu Elf `К 120 РУ 77` f-msk-yug 3.0/20/4.4, 98320, free, «Юг · база»; `v7` ГАЗель Бизнес `О 318 ХС 163` f-smr-volga 1.5/14/3.1, 201450, `on_route`, «Самара · склад» |
| `trips` | 2 | `Р-208` f-msk-sever «Северный маршрут» 01.10.2026 `09:00–13:00` 46 км, driver m-vasiliev «Илья Васильев», `planned`, `earnings:4500`, cargo `{weightT:1.1, volumeM3:12, lengthM:3.0, temp:null, kind:'Сухой груз · 14 паллет-мест'}`, stops: `09:00 'Склад № 1, Лобня' load 1.1/12`, `10:15 'Химки, ул. Заводская, 8' unload 0.7/8`, `11:30 'Долгопрудный, Лихачёвский пр., 4' unload 0.4/4`; `Р-211` «Охлаждённая продукция» `14:00–18:00` 31 км, **без водителя**, `earnings:3800`, cargo `{0.6, 7, 2.4, temp:[2,6], kind:'Молочная продукция · +2…+6 °C'}`, stops `14:00 'Склад № 1, Лобня' load 0.6/7`, `15:10 'Мытищи, ул. Колпакова, 2' unload 0.35/4`, `16:20 'Королёв, пр. Космонавтов, 20' unload 0.25/3` |
| `pool.drivers` | 2 | `d-104 'Водитель #104' 'Кат. C · рефрижератор' home 'Юг Транс' f-msk-yug '13:00–19:00' 'По соглашению фирм группы'`; `d-117 'Водитель #117' 'Кат. B' 'Восток Карго' f-msk-vostok '15:00–20:00'` |
| `forms` | 2 | `fm-insp 'Осмотр машины'` module logistics, owner «Дарья Зимина», `published:3`, 3 версии (v1 02.09.2026: q-photos/q-odo/q-fuel-t; v2 10.09.2026: + q-checks; v3 24.09.2026: `q-photos 'Фото: спереди, сзади, слева, справа, одометр' photo`, `q-odo 'Пробег по одометру, км' number`, `q-fuel 'Уровень топлива' choice ['¼','½','¾','Полный']`, `q-checks 'Чек-лист: кузов, шины, документы' multi`, `q-defect 'Есть дефекты?' bool`, `q-defect-text 'Описание дефекта' text showIf q-defect='да'`, `q-critical 'Дефект критический' bool showIf`), automations `[{id:'au-1', text:'Ответ принят → задача менеджеру «Проверить осмотр»', version:1, on:true}]`; `fm-foreman 'Ежедневный отчёт прораба'` repair `draft`, `published:null`, draft: `q-volume 'Выполненный объём, м²' number`, `q-crew 'Явка бригады' multi`, `q-photo 'Фотоотчёт' photo` |
| `responses` | 2 | `R-0988` fm-insp v2 18.09 08:41 «Кирилл Громов» «Рейс Р-171» «Принят»; `R-1012` v3 27.09 09:05 «Илья Васильев» «Рейс Р-196» «Принят» |
| `tasks` | 9 | fleet: `T-61 'Проверить осмотр Р-196'` Марина Котова «Готово» source R-1012 rule 'au-1 · v1', чек-лист 2/2; `T-58 'Записать ГАЗон Next на плановое ТО'` «В работе» high due 02.10, чек-лист 1/3, link vehicle v4; `T-63 'Обновить регламент приёмки смены'` Дарья Зимина «На проверке» чек-лист 1/1, link form fm-insp; `T-64 'Найти водителя на рейс Р-211'` Марина Котова «Новая» `urgent` 01.10. leads: `L-31 'Квартира 64 м², Химки'` «Новая» high, lead {client 'Пётр Фомин', source 'Сайт'}; `L-29 'Дом 120 м², Истра'` Алексей Соколов «Замер»; `L-27 'Квартира 51 м², Люберцы'` «Смета» sum 980000; `L-24 'Офис 90 м², Сокол'` «Договор» sum 1640000; `L-18 'ЖК Речной · квартира 42'` Алексей Соколов «Объект» sum 1186000 |
| `projects` | 2 | `fleet key 'LOG' 'Логистика · Север' unit f-msk-sever owner 'Марина Котова'`; `leads key 'ЗАЯ' 'Заявки · Ремонт' flow 'leads' unit f-msk-sever owner 'Дарья Зимина'` |
| `earnings`, `events`, `pool.requests` | 0 | пусто |

### 9.3 Дополнительные модули (`ortus/extra-data.js`)

| Сущность | Кол-во | Записи |
|---|---|---|
| `calendar.resources` | 8 | `res-v1 vehicle 'ГАЗель Next · А 412 МР' f-msk-sever ref v1`; `res-v6 'Mercedes Sprinter · Т 771 ЕХ'`; `res-v4 'ГАЗон Next · Е 905 НА'`; `res-iv staff 'Илья Васильев · водитель'`; `res-am staff 'Анна Морозова · массажист' unit 'spa'`; `res-room2 room 'Кабинет № 2'`; `res-room3 room 'Кабинет № 3'`; `res-table equipment 'Стол с подогревом'` |
| `calendar.bookings` | 6 | `b-208 'Рейс Р-208' source{trip Р-208} [res-iv] 9–13`; `b-to 'Плановое ТО' source{vehicle v4} [res-v4] 8–20`; `b-a1 'Классический массаж · Мария К.' source{appointment ap-1} [res-am,res-room2] 10–11 clean .25`; `b-a2 'SPA-ритуал · Ольга Р.' [res-am,res-room2,res-table] 11.5–13 prep .25 clean .25`; `b-a3 'Массаж спины · Екатерина Л.' [res-am,res-room2] 14–14.75 clean .25`; `b-br 'Перерыв' source null [res-am] 13.25–14` |
| `knowledge.spaces` | 3 | `sp-log 'Логистика'`, `sp-spa 'Салон и SPA'`, `sp-own 'Руководство'` |
| `knowledge.pages` | 4 | `kb-1 'Регламент приёмки смены'` sp-log access all, 2 версии (v2 24.09.2026); `kb-2 'Как фотографировать машину при осмотре'` by Марина Котова v1; `kb-3 'Технологические карты процедур'` sp-spa; `kb-4 'Политика начислений водителям'` sp-own **access 'owner'** |
| `spa.stock` | 2 | `oil 'Масло массажное' мл 250`; `cream 'Крем восстанавливающий' г 12` |
| `spa.appointments` | 3 | `ap-1 '10:00–11:00' 'Мария К.' 'Классический массаж' 'Кабинет № 2' recipe [[oil,30]] confirmed`; `ap-2 '11:30–13:00' 'Ольга Р.' 'SPA-ритуал' equipment 'Стол с подогревом' 90 мин prep 15 clean 15 recipe [[oil,40],[cream,20]]`; `ap-3 '14:00–14:45' 'Екатерина Л.' 'Массаж спины' recipe [[oil,20]]`. **`ap-2` требует 20 г крема при остатке 12** → сценарий нехватки |
| `cash.accounts` | 2 | `ca-sever 'Касса Север Логистик' f-msk-sever`; `ca-spa 'Касса SPA' unit 'spa'` |
| `cash.ops` | 4 | `K-301 in 50000 'Подотчёт на топливо, сентябрь' 01.09 Дарья Зимина`; `K-302 out 2500 'Топливо · рейс Р-196 · чек приложен' 27.09 Марина Котова`; `K-303 in 3200 'Классический массаж · визит 29.09'`; `K-304 refund 1600 'Возврат за отменённый визит'` |
| `repair.object` | 1 | `obj-42 'ЖК Речной · квартира 42'` «Москва, ул. Речная, 5, кв. 42», stage «Черновая отделка», «51 м², 2 комнаты», «капитальный ремонт», «договор № 42», due 27.11, client «Ольга Смирнова», foreman «Алексей Соколов», access 4 строки, sub `ООО «ЭлектроПрофи»` электромонтаж до 31.10 |
| `repair.works` | 3 | `w1 'Подготовка стен' м² plan 96 fact 58`; `w2 'Грунтование' 96/24`; `w3 'Монтаж перегородок' 18/18` |
| `repair.crew` | 4 | `k1 'Иван Петров' отделочник`, `k2 'Олег Смирнов' отделочник`, `k3 'Роман Сергеев' маляр`, `k4 'Денис Волков' разнорабочий` — все `account:false` |
| `repair.materials` | 2 | `mt1 'Грунтовка' л 30`; `mt2 'Шпаклёвка' кг 120` |
| `repair.logs` | 1 | `WL-11 30.09 w1 22 м² crew [k1,k2] materials [[mt2,40]] photos 3 'Принят' 'Алексей Соколов'` |

### 9.4 Организация t-lotos (`ortus/mock-data.js:42–80`)

| Поле | Значение |
|---|---|
| `tenantId`, `seq` | `'t-lotos'`, `500` |
| `units` | `r-msk 'Москва'`, `f-lotos-tver 'Лотос · Тверская'`, `f-lotos-arb 'Лотос · Арбат'` |
| `modules` | `logistics off, spa on, repair off` |
| `members` | 23: `m-owner` Ирина Белова `owner@lotos-spa.example` «Владелец»; `m-morozova` Анна Морозова `a.morozova@alta.example` «Массажист · Тверская»; `m-l1…m-l21` из сгенерированных аккаунтов, title по циклу `['Массажист','Массажист','Косметолог','Администратор']`, фирма `i%2 ? arb : tver` |
| `groups` | `g-tver 'Мастера Тверская'` [m-morozova + мастера Тверской кроме администраторов] |
| `roles` | `r-owner`, `r-therapist` (те же объекты), `r-admin 'Администратор салона' custom actions{spa:[view,create,edit,review], calendar:[view,create,edit], tasks:[view,create,edit], knowledge:[view], files:[view,create]}` |
| `assignments` | `la1 m-owner r-owner tenant`; `la2 m-morozova r-therapist self`; `lb0…lb20`: администраторы → `r-admin {firm}`, остальные → `r-therapist {self}` |
| пусто | `vehicles, trips, earnings, events, forms, responses`, `pool {drivers:[], requests:[]}` |
| `tasks` | `T-7 'Заказать масло для массажа'` Ирина Белова «В работе» 03.10; `T-8 'График мастеров на ноябрь'` «Новая» high 10.10 — project `salon` |
| `projects` | `salon key 'SPA' 'Салон · Тверская' unit f-lotos-tver owner 'Ирина Белова'` |
| `cash` | accounts `[ca-lotos 'Касса «Лотос»' unit 'spa']`, ops `[]` |
| `calendar` | ресурсы без `kind:'vehicle'` (5 остаются); брони: фильтр по `Object.values(x)` не ловит массив `res` → `b-to` и `b-208` **остаются** ⚠ |
| `knowledge` | spaces только `sp-spa`; pages только `kb-3` |
| `storage.breakdown` | `['Фото работ и техкарты', 6.2], ['Документы', 3.9], ['Вложения задач и форм', 1.6], ['Прочее', 0.7]` |

### 9.5 Персонажи демо (`Ортус CRM.dc.html:2323–2327`)

| Персона | Подпись | t-alta | t-lotos | Стартовая страница |
|---|---|---|---|---|
| `operator` | «Оператор платформы» | `null` | `null` | `tenants` |
| `owner` | «Владелец бизнеса · Дарья Зимина» | `m-owner` | `m-owner` (Ирина Белова) | `home` |
| `manager` | «Логист · Марина Котова» | `m-kotova` | — | `home` |
| `driver` | «Водитель · Илья Васильев» | `m-vasiliev` | — | `today` |
| `therapist` | «Массажист · Анна Морозова» | `m-morozova` | `m-morozova` | `spa` |
| `foreman` | «Прораб · Алексей Соколов» | `m-sokolov` | — | `repair` |

Колонка «Подпись» — из константы `PERSONAS` (`:2326`). ⚠ проверено: в DOM эти подписи не попадают — `shellVM` строит `personaOptions` из `PERSONAS` (`:2834`), но шаблон селекта `getByLabel('Персонаж')` использует захардкоженные `<option>` (`:33–46`): «Владелец · Дарья Зимина» (`:37`, а не «Владелец бизнеса · …»), плюс отдельные пункты для t-lotos «Владелец · Ирина Белова» (`:44`) и «Массажист · Анна Морозова» (`:45`). Для e2e-селекторов использовать подписи шаблона (см. §14, 01 §5, 01 §21 Q7).

«Проверка доступа» (`Ортус CRM.dc.html:2365–2367`): действия `fleet.view 'Просматривать машины'`, `fleet.reserve 'Бронировать машину'`, `fleet.review 'Принимать смены'`, `fleet.earnings 'Видеть начисления'`, `spa.view 'Открыть расписание SPA'`, `repair.create 'Отмечать работы на объекте'`; объекты `v1 'ГАЗель Next · Север Логистик'`, `v5 'Isuzu Elf · Юг Транс'`, `v7 'ГАЗель Бизнес · Самара / Волга Логистик'`, `trip 'Рейс Р-208 · Север Логистик'`, `none 'Без конкретного объекта'`; пресеты: «Модуль не подключён» `{m-sokolov, repair.create, none}`, «Нет права» `{m-vasiliev, fleet.review, trip}`, «Нет доступа к объекту» `{m-vasiliev, fleet.view, v5}`, «Начисления водителю» `{m-vasiliev, fleet.earnings, trip}`.

---

## 10. JSDoc → TypeScript

Явные JSDoc-типы (`ortus/models.js:5–9`):

| JSDoc | TypeScript |
|---|---|
| `Scope` | `type Scope = { type: 'tenant' } \| { type: 'region'; id: string } \| { type: 'firm'; id: string } \| { type: 'self' }` |
| `Assignment` | `interface Assignment { id: string; member: string; role: string; scope: Scope; via?: string; until?: string \| null }` |
| `Role` | `interface Role { id: string; name: string; kind: 'system' \| 'template' \| 'custom'; all?: boolean; professional?: 'driver'; actions: Record<ModuleKey, Verb[]>; finance: { read: boolean; manage: boolean } }` |
| `VehicleState` | `type VehicleState = 'free' \| 'reserved' \| 'on_route' \| 'review' \| 'unavailable'` |
| `TripState` | `type TripState = 'planned' \| 'assigned' \| 'inspection' \| 'defect_review' \| 'on_route' \| 'returning' \| 'submitted' \| 'rework' \| 'accepted'` |

Типы, выведенные из seed и адаптера (JSDoc отсутствует — помечать как derived):

| Тип | Определение (из источника) |
|---|---|
| `Verb` | `'view' \| 'create' \| 'edit' \| 'review' \| 'export' \| 'settings'` (`models.js:19–22`) |
| `IndustryKey` / `CoreKey` / `ModuleKey` | `'logistics' \| 'spa' \| 'repair'`; `'calendar' \| 'tasks' \| 'knowledge' \| 'forms' \| 'data' \| 'files' \| 'inventory' \| 'cash' \| 'notifications'`; объединение |
| `Reason` | `'module_off' \| 'module_readonly' \| 'no_permission' \| 'no_scope' \| 'driver_block'` |
| `CanResult` | `{ ok: true; via: Grant } \| { ok: false; reason: Reason }`; `Grant = Assignment & { roleObj: Role }` |
| `Tone` | `'ok' \| 'info' \| 'warn' \| 'danger' \| 'neutral'` |
| `Unit` | `{ id: string; type: 'region'; name: string } \| { id: string; type: 'firm'; parent: string; name: string }` |
| `MemberStatus`, `Member` | `'active' \| 'invited' \| 'blocked'`; `{ id; name; email; status; title: string; function?: 'driver'; invitedNote?: string }` |
| `Group` | `{ id; name; members: string[] }` |
| `ModuleState` | `{ enabled: boolean; history?: boolean }`; `Modules = Record<IndustryKey, ModuleState>` |
| `Vehicle` | `{ id; unit; model; plate; body: string; payloadT; volumeM3; lengthM: number; temp: [number, number] \| null; odometer: number; state: VehicleState; depot: string; note?: string \| null; heldBy?: string \| null }` |
| `Cargo`, `Stop` | `{ weightT; volumeM3; lengthM: number; temp: [number, number] \| null; kind: string }`; `{ time: string; name: string; op: 'load' \| 'unload'; w: number; v: number }` |
| `PhotoState`, `PhotoSlot` | `'empty' \| 'queued' \| 'uploading' \| 'ready' \| 'failed'`; `{ state; fileId?: string \| null; url?: string \| null; demo?: boolean; progress?: number; error?: string \| null }` |
| `Defect` | `{ zone: string; text: string; critical: boolean; downgraded?: boolean }` |
| `InspectionPayload` | `{ photos: Record<'front' \| 'back' \| 'left' \| 'right' \| 'odo', PhotoSlot>; odometer: string; fuel: '' \| 'q' \| 'h' \| 'tq' \| 'f'; checks: Record<string, boolean>; defects: Defect[]; comment: string; opId?: string }` |
| `Inspection` (сохранённый) | `{ odometer: number; fuel; defects; photos; at: string; comment?: string }` |
| `Expense` | `{ id; category: 'fuel' \| 'wash'; amount: number; date: string; comment: string; liters: string; receipt: { fileId: string; url: string \| null }; at: string }` |
| `Review` | `{ decision: 'accept' \| 'rework'; comment: string; steps?: string[]; at: string; resolved?: boolean }` |
| `Trip` | `{ id; unit; title; date; window: string; distanceKm: number; driverId: string \| null; driverName: string \| null; vehicleId: string \| null; status: TripState; earnings?: number; cargo: Cargo; stops: Stop[]; dep: Inspection \| null; ret: Inspection \| null; expenses: Expense[]; review: Review \| null; defect: Defect \| null; reservedUntil?: string }` |
| `Earning` | `{ id; tripId; unit; member: string; amount: number; status: 'Начислено' }` |
| `Event` | `{ id; at; text: string; to: string[]; sensitive: 'earnings' \| null; unit?: string }` |
| `PoolDriver`, `PoolRequest` | `{ id; code; qual; home; unit; window; terms: string }`; `{ id; driverId; tripId; comment: string; status: 'pending' \| 'approved' \| 'declined'; home: string; at: string; decidedAt?: string; until?: string }` |
| `FieldType`, `Field` | `'photo' \| 'number' \| 'text' \| 'multi' \| 'choice' \| 'bool'` (в seed; README упоминает 10 типов); `{ id; label; type; required: boolean; section: string; options?: string[]; showIf?: { field: string; eq: string }; changed?: boolean }` |
| `Form`, `FormVersion`, `Automation` | `{ id; name; module: IndustryKey; owner: string; status: 'published' \| 'draft'; published: number \| null; versions: FormVersion[]; automations: Automation[]; draft?: Field[] }`; `{ v: number; at; by: string; fields: Field[] }`; `{ id; text: string; version: number; on: boolean }` |
| `FormResponse` | `{ id; key?: string; formId; version: number; at; author; object; status: 'Принят'; values: Record<string, string> }` |
| `Task`, `ChecklistItem`, `Comment`, `Link` | `{ id; title; assignee: string; status: string; priority: 'urgent' \| 'high' \| 'normal' \| 'low'; due: string; project: string; source?: string; rule?: string; lead?: { client: string; source: string; sum: number \| null }; checklist: { t: string; d: boolean }[]; comments: { by; at; text: string; system?: boolean }[]; links: { kind: 'response' \| 'trip' \| 'vehicle' \| 'form'; id: string; label: string }[] }` |
| `Project` | `{ id; key; name; unit; owner: string; flow?: 'tasks' \| 'leads' }` |
| `Workflow` | `{ statuses: string[]; flow: Record<string, string[]>; tone: Record<string, [Tone, string]>; item; items; done: string }` |
| `Resource`, `Booking` | `{ id; kind: 'vehicle' \| 'staff' \| 'room' \| 'equipment'; name; unit: string; ref?: string }`; `{ id; title: string; source: { kind: 'trip' \| 'vehicle' \| 'appointment'; id: string } \| null; res: string[]; start; end: number; prep?: number; clean?: number }` |
| `KbSpace`, `KbPage`, `KbVersion` | `{ id; name }`; `{ id; space: string; title: string; access: 'all' \| 'owner'; versions: KbVersion[] }`; `{ v: number; at; by; body: string }` |
| `StockItem`, `Appointment`, `Movement`, `Issue` | `{ id; name; unit; qty: number }`; `{ id; time; client; service; room; equipment: string; duration: number; prep?: number; clean: number; recipe: [string, number][]; status: 'confirmed' \| 'done' \| 'done_pending' }`; `{ id; at; item; qty; unit; basis }`; `{ id; ap; item; need; unit; missing; text; status: 'open' \| 'resolved'; how?: 'reserve' \| 'actual' }` |
| `CashAccount`, `CashOp` | `{ id; name; unit }`; `{ id; account; type: 'in' \| 'out' \| 'refund' \| 'storno'; amount: number; basis; at; by: string; src?: string \| null; reverses?: string; reversedBy?: string; sign?: 1 \| -1 }` |
| `RepairObject`, `Work`, `CrewMember`, `Material`, `WorkLog` | см. `extra-data.js:65–82`; `WorkLog = { id; at; work; volume: number; crew: string[]; materials: [string, number][]; photos: number; status: 'На проверке' \| 'Принят'; by: string }` |
| `Tenant`, `Plan`, `Brand` | `{ id; name; owner; status: 'trial' \| 'active' \| 'restricted' \| 'suspended'; trialEnds: string \| null; trialDaysLeft: number \| null; quotaGb; usedGb: number; members: number; modules: IndustryKey[]; plan: Plan; seatsLimit: number \| null; seatsUsed: number; brand: Brand }`; `{ tier: string; term: 1 \| 4 \| 8 \| 12; paidUntil: string \| null; version: number }`; `Brand = typeof BRAND_DEFAULT & { name: string; terms: Record<string, { one; plural; few; many: string }> }` |
| `PriceBook`, `PriceVersion`, `Tier`, `Term` | `{ current: number; scheduled?: number \| null; versions: PriceVersion[] }`; `{ v; from; to: string \| null; note; by: string; scheduled?: boolean; tiers: Tier[]; terms: Term[] }`; `{ id; name: string; seats: number \| null; month: number \| null }`; `{ months: number; off: number }` |
| `SeatRequest` | `{ id; tenantId; from; to: string; term: number; used: number; by; at: string; status: 'pending' \| 'approved' \| 'rejected' \| 'cancelled'; comment: string; decidedBy?; decidedAt?; decision?: string }` |
| `Account`, `Membership`, `Operator`, `AuditEntry` | `{ id; name; email; status: 'active' \| 'pending' \| 'locked'; mfa: boolean; lastLogin: string \| null; lockReason?: string \| null; memberships: { tenantId; status: 'active' \| 'invited' \| 'ended' \| 'suspended'; owner?: boolean }[] }`; `{ id; name; email; role: 'owner' \| 'admin' \| 'billing' \| 'support'; status: 'active' \| 'invited' \| 'disabled'; mfa: string \| null; lastLogin: string \| null; me?: boolean; disabledNote?: string \| null }`; `{ at; text; by: string }` |
| `Db` (tenant) | объединение всех полей `baseSeed()` + `extraSeed()` + `flags` в ответе `view()` |
| `ApiError` | `class ApiError extends Error { code: string; status?: number; vehicleId?: string; slots?: number[]; db?: Db }` |
| `ApiResult<T>` | `{ data: T; db: Db }` |
| `Adapter` | интерфейс из 53 методов раздела 4 (`kind: 'mock' \| 'http'`) |

---

## 11. Ключи прав: прототип vs канон (`docs/11-permissions.yaml`)

Прототип хранит права как `actions: { <module>: Verb[] }` и разворачивает в ключи через `ALL_MODULES[mod].perms[verb]` (`models.js:200–210`). Канон — плоские action keys с `level` ∈ `[view, create, edit, review, export, settings]` (`11-permissions.yaml:10`), что совпадает с `VERBS` 1:1.

| Ключ прототипа (`models.js`) | Модуль·verb | Канон (`11-permissions.yaml`) | Статус |
|---|---|---|---|
| `fleet.vehicles.read` | logistics·view | `fleet.vehicles.read` | совпадает |
| `fleet.trips.read` | logistics·view | `fleet.trips.read` | совпадает |
| `fleet.reservations.create` | logistics·create | `fleet.reservations.create` | совпадает |
| `fleet.inspections.create` | logistics·create | `fleet.inspections.submit` | rename (`:181`) |
| `fleet.expenses.create` | logistics·create | `fleet.expenses.create` | совпадает |
| `fleet.trips.manage` | logistics·edit | `[fleet.trips.start, fleet.trips.return, fleet.routes.manage]` | rename 1→3 (`:182`) |
| `fleet.pool.request` | logistics·edit | `fleet.driver_transfers.request` | rename (`:183`) |
| `fleet.trips.review` | logistics·review | `fleet.trips.review` | совпадает |
| `fleet.export` | logistics·export | `data.export` | rename (`:184`) |
| `fleet.settings` | logistics·settings | `modules.settings.manage` | rename (`:185`) |
| `fleet.earnings.read` / `.manage` | finance.read / manage | те же, `sensitivity: restricted`, `blocked_by_function: [driver]` (`:113–114`) | совпадает |
| `spa.appointments.read`, `spa.appointments.create`, `spa.services.manage`, `spa.completion.review`, `spa.export`, `spa.settings` | spa·* | — | ⚠ модуля `spa` в каталоге v0.2 нет |
| `repairs.projects.read` | repair·view | `repairs.projects.read` | совпадает |
| `repairs.worklogs.create` | repair·create | `repairs.work_logs.submit` | rename (`:189`) |
| `repairs.projects.manage` | repair·edit | `repairs.projects.manage` (level settings в каноне) | ⚠ уровень расходится |
| `repairs.worklogs.review` | repair·review | `repairs.work_logs.review` (PROPOSED) | rename (`:190`) |
| `repairs.export`, `repairs.settings` | repair·export/settings | — | ⚠ нет в каталоге |
| `calendar.read` | calendar·view | `calendar.bookings.read` | rename (`:186`) |
| `calendar.bookings.create` / `.manage` | calendar·create/edit | те же | совпадает |
| `tasks.read`, `tasks.create` | tasks·view/create | те же | совпадает |
| `tasks.manage` | tasks·edit | `tasks.update` + `tasks.transition` (ближайшие) | ⚠ нет в `prototype_renames` |
| `knowledge.read` | knowledge·view | `knowledge.read` | совпадает |
| `knowledge.write` | knowledge·create | `[knowledge.create, knowledge.update]` | rename (`:187`) |
| `forms.read` | forms·view | `forms.read` | совпадает |
| `forms.responses.create` | forms·create | — | ⚠ нет в каталоге (ответ создаётся доменной операцией) |
| `forms.responses.review` | forms·review | `forms.responses.review` | совпадает |
| `forms.publish` | forms·settings | `forms.publish` | совпадает |
| `data.read` | data·view | `[data.catalog.read, data.query]` | rename (`:188`) |
| `data.export` | data·export | `data.export` (sensitive) | совпадает |
| `files.read`, `files.upload` | files·view/create | те же | совпадает |
| `inventory.read`, `inventory.movements.post` | inventory·view/create | — | ⚠ нет в каталоге |
| `cash.read`, `cash.operations.create` | cash·view/create | — | ⚠ нет в каталоге |
| — | — | `members.*`, `roles.*`, `org_units.*`, `modules.*`, `billing.*`, `tasks.projects.*`, `forms.create/manage/publish_public`, `calendar.availability.read`, `knowledge.publish`, `fleet.vehicles.manage`, `fleet.reservations.read/manage`, `fleet.inspections.read/review`, `fleet.routes.read`, `fleet.expenses.read/review`, `fleet.driver_transfers.read/approve`, `repairs.work_logs.read`, `repairs.finance.read`, `platform.*` | в прототипе не моделируются (владелец = `all:true`) |

Шаблоны ролей канона (`11-permissions.yaml:143–177`): `owner` (OwnerBinding, не роль), `logistics_manager` (default_scope unit, `optional_restricted: [fleet.earnings.read, fleet.earnings.manage]`), `driver` (default_scope self, `work_function: driver`), `foreman` (default_scope project, `work_function: foreman`), `observer` (default_scope unit). В прототипе: `r-manager` имеет `finance.read:true` по умолчанию (README `:170` — «вынесены в отдельный финансовый блок шаблона»); шаблонов «Массажист» и «Наблюдатель» в каноне/прототипе соответственно нет.

---

## 12. Что mock-адаптер делает за бэкенд (и чего не делает)

### 12.1 Обязан воспроизвести реальный сервер

| Поведение мока | Строки | Требование к Go API |
|---|---|---|
| Ответ строится для актора: запрещённые поля **не передаются вовсе** (`earnings`, чужие события, чужие машины/рейсы, приватные страницы, касса) | `api.js:69–97` | фильтрация restricted-полей на сервере; Data Hub, экспорт, поиск — те же правила (`docs/15:29`) |
| Оператор платформы не получает бизнес-данных | `api.js:71` | отдельный контур `/platform/*`, realm `ortus-operators` (`docs/17:161`) |
| `not_found` для несуществующих id (`trip()`, `veh()`), `no_scope` для чужих | `api.js:25–26`, `models.js:184` | **единый 404** для чужих и несуществующих (`docs/12:41`, `docs/15:35–36, 40, 48`); время ответа не должно различаться |
| Порядок проверок: модуль → право → область | `models.js:178–186` | 403 `module_not_installed` / `forbidden_action` → 404 для объекта вне области |
| Начатую работу можно завершить при выключенном модуле / restricted-тенанте | `api.js:61–67` | `AC-12`: «новый рейс 403, текущий сдаётся» (`docs/15:46`) |
| Идемпотентность `opId` → `'duplicate'` без мутации | `api.js:362, 371` | `Idempotency-Key` на всех изменяющих; `idempotency_key_reused` (409) при другом payload (`docs/12:55, 95`) |
| Оптимистическая блокировка версии страницы БЗ | `api.js:471` | `If-Match` → 412 `revision_mismatch`, 428 `revision_required` (`docs/12:58, 63`) |
| Конфликт брони с `{vehicleId}`; конфликт ресурсов с `slots` | `api.js:312, 461` | 409 `reservation_overlap` / `resources_unavailable` с «2–3 допустимыми слотами» (`roadmap.js:10`) |
| Совместимость машины с грузом (масса, объём, длина, температура) проверяется сервером | `api.js:315, 328` | 409 `vehicle_incompatible` с причинами по проверкам |
| Осмотр: 5 фото `ready`, пробег ≥ начального, топливо, чек-лист | `api.js:334–335, 372–373` | 409 `inspection_incomplete`, 409 `photo_not_ready`, 422 `odometer_decrease` |
| Критический дефект блокирует выезд, машина `unavailable`, решение менеджера | `api.js:339–343, 348–359` | 409 `blocking_defect_open`; событие `fleet.defect.blocking_reported.v1` → задача «Срочно» (`docs/12:81`) |
| Приёмка: `status==='submitted'` иначе `conflict`; accept создаёт начисление и sensitive-событие | `api.js:382, 392–395` | `fleet.trip.accepted.v1`; начисление — restricted |
| Ответ формы + задача из автоматизации создаются один раз (ключ `trip:kind:rev`) | `api.js:38–50` | `fleet.inspection.submitted.v1` → формы, задачи; потребитель идемпотентен через `outbox.inbox` (`docs/12:71, 80`) |
| Публикация формы — новая неизменяемая версия; смена типа поля = новый id | `api.js:420–424` | `POST /forms/{id}/versions/{vid}/publish` |
| Переход задачи только по `flow`; «Готово» требует закрытого чек-листа | `api.js:433–434` | 409 `invalid_transition`, 422 |
| Разделение обязанностей: `driver` ↔ финансовые права (назначение и роль) | `api.js:278–279, 299–301` | 409 `separation_of_duties_conflict` |
| Последний владелец не снимается | `api.js:285` | 409 `last_owner_required` |
| Места: `active + invited`; `seats_exhausted` при лимите; `syncSeats` после каждой команды | `api.js:30–32, 160` | лимит из тарифа; отзыв приглашения освобождает место сразу |
| Заявка на тариф: одна pending на организацию; тариф не меньше занятого | `api.js:181, 184` | 409 `request_pending` (`docs/17:138`) |
| Прайс-лист: валидация монотонности цен/мест, безлимит последний, одна запланированная версия | `api.js:212–219` | `platform.pricing.manage` |
| Операторы: домен `@ortus.example`, не `owner` при приглашении, ≥1 активный владелец, не себя | `api.js:246–258, 264–265` | `docs/17:149–150, 184` («минимум два владельца» ⚠ мок требует ≥1) |
| Квота: загрузка закрыта при `usedGb >= quotaGb`, кроме начатых смен | `api.js:555–556` | 409 `quota_exceeded`; «временный резерв» не определён (README `:160`) |
| SPA: завершение списывает один раз (`status!=='confirmed'` → duplicate); нехватка → `done_pending` + issue | `api.js:482–496` | «Повторное завершение не создаёт второго списания» (`roadmap.js:116`) |
| Касса: сторно вместо удаления, повторное сторно — conflict | `api.js:521–525` | «Сторно вместо удаления» (`roadmap.js:99`) |
| Ремонт: отметка → «На проверке», факт меняется только после приёмки; объём ≤ план×1,1 | `api.js:534, 545–548` | `repairs.work_logs.review` (PROPOSED) |
| Branding: валидация имени/короткого имени/цвета/терминов, версия++ | `api.js:132–139` | `PUT /tenants/{id}/branding`, изоляция (`docs/15:48`) |

### 12.2 Чего мок НЕ делает (бэкенд обязан добавить)

- Нет проверки прав: `cancelReservation`, `decideRequest`, `moveBooking`, `resolveIssue`, `resetTrip`, `setModule`, `setTenantQuota`, все `/platform/*` (роли операторов не ограничивают, README `:164`).
- Нет 404 для отсутствующих id в `assign` (member), `unassign`, `decideRequest`, `toggleTaskCheck`, `commentTask`, `moveBooking`, `saveKbPage`, `resolveIssue`, `reverseCashOp`, `acceptWorkLog`, `setAccountLock`, `resetMfa`, `setOperatorRole/Status` — будет `TypeError`.
- Мутации не транзакционны: `reserve` при `conflictNext` меняет машину **до** броска ошибки (намеренно, имитация чужой брони), `completeAppointment` списывает частично при нехватке (намеренно).
- Ответ `db` целиком при каждой команде — реальный API возвращает ресурс/`204`, контекст — `GET /me/context`.
- `ops` (идемпотентность) общий для всех организаций и не проверяет payload.
- Даты зафиксированы: «сегодня» 01.10.2026 (`at:'01.10'`, `'01.10.2026'`, `due:'01.10'`, `reservedUntil:'09:30'`, `until:'18:00 01.10'`, `invitedNote:'Приглашение до 08.10'`).
- Имена захардкожены: `recordInspection` → assignee «Марина Котова»; `publishForm` → by «Дарья Зимина»; `addWorkLog` → by «Алексей Соколов»; `reserve` → «Илья Васильев забронировал…»; операторские действия → by «Оператор (демо)».
- `view()` не фильтрует `members/roles/assignments/groups/forms/pool/spa/repair` — реальный API должен проверять `members.read`, `roles.read` и т. д.

---

## 13. Инварианты и правила

1. UI обращается к данным только через адаптер; доменные функции — чистые (`api.js:1`, `models.js:1–3`, README `:32`).
2. Эффективное право: модуль подключён ∧ действие в роли ∧ объект в области; `self` не покрывает ни один unit (`models.js:153–160, 177–187`).
3. `canEarnings`: функция «Водитель» блокирует раньше любых ролей; владелец (`all`) видит начисления везде (`models.js:189–198`).
4. Core-модули всегда «подключены»; industry — по `db.modules[key].enabled`; выключенный с `history` → `module_readonly` (`models.js:169, 179`).
5. Назначение роли с `finance.read` водителю и роли `professional:'driver'` участнику с финансовыми правами запрещено (`api.js:278–279, 299–301`).
6. Нельзя снять последнего `r-owner` (`api.js:285`); системная роль не редактируется (`api.js:297`).
7. Место занимает участник `active` или `invited`; `blocked` — нет (`api.js:30–31`).
8. Рейс видим водителю только если он назначен (`t.driverId === actor`); машины — по области (`api.js:82–83`).
9. Бронь требует: подписка активна, модуль включён, право `create` по области машины, машина `free` или удержана этим рейсом, `compat().fit` (`api.js:306–318`).
10. Начатая работа (`inspection|on_route|returning|rework|submitted|defect_review`) завершается при restricted-тенанте и выключенном модуле (`api.js:61–67`).
11. Осмотр принимается только с 5 фото `ready` на сервере; «Фото выбрано» ≠ «Фото сохранено» (`api.js:335`, `roadmap.js:90`).
12. Пробег при сдаче ≥ пробега при выезде; при приёмке `v.odometer = t.ret.odometer` (`api.js:372, 391`).
13. Расход: сумма (0; 200 000], дата, чек `ready`; повтор `opId` → `'duplicate'` (`api.js:360–367`).
14. Приёмка только из `submitted`; `rework` требует комментарий и ≥1 раздел (`api.js:382–385`).
15. Начисление создаётся при приёмке; событие о нём `sensitive:'earnings'` видно только с правом (`api.js:392–395`, `api.js:80`).
16. Ответ формы «Осмотр машины» и задача менеджеру — один раз на `trip:kind:rev` (`api.js:41–42`).
17. Переход задачи только по `WORKFLOWS[flow].flow`; «Готово» при закрытом чек-листе (`api.js:433–434`).
18. Публикация формы: новая версия, старые ответы хранят свою версию; смена типа поля → новый id (`api.js:421–425`).
19. Бронь календаря: занятость `[start−prep, end+clean]`, все ресурсы атомарно, конфликт → слоты (`models.js:282–300`, `api.js:454–464`).
20. БЗ: новая версия только от последней (`baseVersion`) (`api.js:471`); приватные страницы (`access:'owner'`) не отдаются не-владельцу (`api.js:93`).
21. SPA: завершение списывает один раз; нехватка → `done_pending` + issue, услуга считается выполненной (`api.js:482–496`).
22. Касса: исправление — сторно (`type:'storno'`, `reverses`, `sign`), не удаление; повторное сторно запрещено (`api.js:517–526`).
23. Ремонт: факт и материалы меняются только при приёмке отметки; объём ≤ план × 1,1 (`api.js:534, 545–548`).
24. Заявка на тариф: одна `pending`; подтверждение сразу меняет `seatsLimit`, `plan`, статус trial/restricted → active (`api.js:181, 202–206`).
25. Прайс-лист: одна запланированная версия; `cur.to = 'до <from>'`; отмена возвращает `to:null` (`api.js:219–224, 230–234`).
26. Операторы: только `@ortus.example`; не владелец при приглашении; себя не менять/отключать; ≥1 активный владелец (`api.js:246–265`).
27. Branding: `name` 1–60, `short` ≤16, `accent` `#RRGGBB`, термины во всех 4 формах; `version` растёт (`api.js:132–138`).
28. Квота: загрузка закрыта при `usedGb >= quotaGb`, кроме начатых смен (`api.js:555–556`).
29. Всякая ошибка команды несёт свежий `db` (`api.js:103`); UI обновляет состояние, если код не `quiet`.
30. Разделитель тысяч в `int`/`rub` — U+00A0 (`models.js:141–142`).

---

## 14. Чек-лист приёмки (Playwright, Given/When/Then)

Селекторы: тосты — текст дословно; переключатель персонажей — `getByLabel('Персонаж')` (`<select>` в панели «Демо-режим», `Ортус CRM.dc.html:31–47`), подписи `<option>` **из шаблона**: «Оператор платформы» (`:34`), «Владелец · Дарья Зимина» (`:37`), «Логист · Марина Котова» (`:38`), «Водитель · Илья Васильев» (`:39`), «Массажист · Анна Морозова» (`:40`), «Прораб · Алексей Соколов» (`:41`), «Владелец · Ирина Белова» (`:44`, t-lotos), «Массажист · Анна Морозова» (`:45`, t-lotos) — 01 §5. ⚠ проверено: константа `PERSONAS` (`:2326`, «Владелец бизнеса · Дарья Зимина») читается в `shellVM` (`:2834`, `personaOptions: PERSONAS.map(…)`), но шаблон `personaOptions` нигде не рендерит — `<option>` захардкожены в `:33–46`; в DOM есть только подписи шаблона (01 §21 Q7). Флаги демо-режима — чекбоксы `getByLabel`: «Нет связи» (`:63`), «Конфликт брони» (`:64`), «Сбой загрузки фото» (`:65`) — 01 §5, 03 §4.5. У каждого пункта ниже после «DOM:» дана привязка к экрану (роль/подпись элемента, строка шаблона `Ортус CRM.dc.html`) и отчёт 01–06, где элемент описан; ожидания Then — наблюдаемые эффекты адаптера.

### 14.1 Модули и права

1. Given персона «Владелец · Дарья Зимина», seed; When подключить «Логистика»; Then toast «Модуль «Логистика» подключён», в `db.modules.logistics.enabled === true`, в уведомлениях владельца «Подключён модуль «Логистика»». DOM: «Модули и место» → карточка «Логистика», кнопка «Подключить» (`:237`) → диалог confirm «Подключить «Логистика»?», кнопка «Подключить» (`:2675–2685`) — 02 §5.3, §5.5; уведомление — поповер «Уведомления» 01 §10.3.
2. Given логистика включена; When отключить; Then toast «Модуль отключён. История доступна для чтения», `history === true`, «Проверка доступа» для `m-kotova`/`fleet.view` показывает чип «Модуль отключён · только чтение». DOM: та же карточка, кнопка «Отключить» (`:238`) → диалог «Отключить «Логистика»?», чекбокс «Понимаю последствия для текущей работы», кнопка «Отключить модуль» (`:2695–2705`) — 02 §5.5; чип — вкладка «Проверка доступа» 02 §6.8.
3. Given seed (логистика выключена); When «Проверка доступа» пресет «Модуль не подключён» (m-sokolov, repair.create); Then чип «Модуль не подключён», текст «Модуль не подключён организацией. Подключить его может владелец бизнеса. Модуль: Ремонт и стройка.». DOM: «Пользователи и роли» → вкладка «Проверка доступа» (`:3136`) → блок «Проверить доступ», кнопка-пресет «Модуль не подключён» после «Примеры:» (`:400`); результат — чип (`:406`), заголовок и текст (`:407–408`) — 02 §6.8.
4. Given логистика включена; When пресет «Нет права» (m-vasiliev, fleet.review, trip); Then чип «Нет права», текст «Ни одна роль сотрудника не разрешает это действие.». DOM: кнопка-пресет «Нет права» (`:400`) — 02 §6.8.
5. When пресет «Нет доступа к объекту» (m-vasiliev, fleet.view, v5); Then чип «Нет доступа к объекту», текст «Право есть, но объект находится вне области назначения. Объект: Isuzu Elf · Юг Транс.». DOM: кнопка-пресет «Нет доступа к объекту» (`:400`); вручную — `getByLabel('Сотрудник')`, `getByLabel('Действие')`, `getByLabel('Объект')` (`:397–399`) — 02 §6.8.
6. When пресет «Начисления водителю»; Then чип «Запрещено функцией «Водитель»», текст «Действующая функция «Водитель» запрещает начисления через любую роль и группу.». DOM: кнопка-пресет «Начисления водителю» (`:400`) — 02 §6.8.
7. Given владелец; When назначить `m-kotova` роль «Менеджер логистики», область фирма «Север Логистик»; Then toast «Роль «Менеджер логистики» назначена»; у Марины Котовой событие «Вам назначена роль «Менеджер логистики» · Москва / Север Логистик». DOM: вкладка «Люди» → строка «Марина Котова», кнопка «Назначить роль» (`:314`) → диалог «Назначить роль»: `getByLabel('Роль')` (`:2234`), «Область действия» → кнопка «Фирма» (`:2236`), `getByLabel('Фирма')` (`:2240`), кнопка «Назначить» (`:2249`) — 02 §6.4, §6.9; событие — «Уведомления» 01 §10.3.
8. When назначить `m-vasiliev` роль «Менеджер логистики» (finance.read); Then ошибка в диалоге «Функция «Водитель» несовместима с правом на начисления (правило MVP).», toast не показывается (`quiet`). DOM: тот же диалог для строки «Илья Васильев»; ошибка — `role="alert"` внутри диалога (`:2248`) — 02 §6.9.
9. When снять назначение `a1` (единственный владелец); Then toast error «Нельзя снять роль с последнего владельца». DOM: «Назначить роль» для строки «Дарья Зимина» → блок «Текущие назначения», кнопка «Снять» (`:2233`, `removeAssign` `:2762`) — 02 §6.9.
10. When сохранить роль `r-owner`; Then «Системная роль не редактируется». When сохранить роль с `professional:'driver'` и `finance.read:true`; Then «Роль с функцией «Водитель» не может содержать начисления». DOM: вкладка «Роли» → редактор роли (`:346–379`), кнопка «Сохранить роль» (`:3197`) — 02 §6.6–6.7.
11. Given персона «Логист · Марина Котова» до назначения; Then в `db` нет машин, рейсов, проектов; касса `hidden:true`; страница `kb-4` отсутствует. DOM: `getByLabel('Персонаж')` → «Логист · Марина Котова» (`:38`); в `aria-label="Основная навигация"` нет пунктов логистики и кассы — 01 §8.3, §9.1; дерево `aria-label="Дерево страниц"` без `kb-4` — 06 §6.1.

### 14.2 Приглашения и места

12. Given t-alta 9/10; When пригласить «Иван Тестов» `i.testov@alta.example`; Then toast «Приглашение создано · письмо в демо не отправляется», `seatsUsed === 10`, участник `status:'invited'`, `invitedNote:'Приглашение до 08.10'`. DOM: «Пользователи и роли» → «Люди» → кнопка «Пригласить» (`:299`) → диалог «Пригласить участника»: `getByLabel('Имя и фамилия')` (`:2256`), `getByLabel('Электронная почта')` (`:2257`), кнопка «Пригласить» (`:2270`) — 02 §6.4, §6.10.
13. When пригласить ещё одного; Then ошибка «Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.». DOM: тот же диалог; ошибка — `role="alert"` `mi.err` (`:2269`); при заполненных местах также блок `role="alert"` «Все места тарифа заняты.» с кнопкой «Подписка и места» (`:2264–2266`) — 02 §6.10.
14. When пригласить `m.kotova@alta.example`; Then «Участник с таким адресом уже есть». When email `abc`; Then «Проверьте адрес электронной почты». DOM: ошибки — `role="alert"` под полями «Имя и фамилия»/«Электронная почта» (`aria-invalid`, `:2256–2257`) и `mi.err` (`:2269`) — 02 §6.10.
15. When отозвать приглашение «Олеся Петрова»; Then toast «Приглашение отозвано, место свободно», `seatsUsed` уменьшилось на 1, участника нет в списке. DOM: «Подписка и места» → список «Занимают место · N» → строка «Олеся Петрова», кнопка «Отозвать» (`:1505`) → confirm «Отозвать приглашение?», кнопка «Отозвать» (`:3937`) — 02 §7.3.
16. When заявка на тариф «Команда» на 12 мес; Then toast «Заявка отправлена оператору», `SR-…` со статусом `pending`; повторная заявка → «Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.». DOM: «Подписка и места» → блок «Изменить тариф»: `radiogroup` `aria-label="Тариф"` → «Команда» (`:1477–1479`), `radiogroup` `aria-label="Срок оплаты"` → срок 12 месяцев (`:1473–1474`, подписи — 02 §7.3), кнопка «Отправить заявку оператору» (`:1493`) — 02 §7.3.
17. Given «Оператор платформы», заявка pending; When подтвердить; Then у t-alta `seatsLimit === 25`, `plan.tier === 'team'`, `plan.paidUntil === '30.09.2027'`, `status === 'active'`; владелец видит «Тариф «Команда» подключён: 25 мест». DOM: `getByLabel('Персонаж')` → «Оператор платформы» (`:34`) → «Заявки на тариф» → карточка SR-…, кнопка «Подтвердить и подключить» (`:971`) — 04 §5.3; текст владельца — «Уведомления» 01 §10.3.
18. When отклонить без причины; Then «Укажите причину отказа». DOM: та же карточка, кнопка «Отклонить» (`:970`) при пустом `getByLabel('Комментарий для владельца')` (`:968`) — 04 §5.3.

### 14.3 Водитель: бронь → осмотр → рейс → сдача

19. Given логистика включена, персона «Водитель · Илья Васильев»; Then видны 5 машин (`v1, v6, v2, v3, v4`), рейс «Р-208»; `v3` помечен несовместимой (`Грузоподъёмность: 0,9 т, нужно от 1,1 т`; `Объём: 9 м³, нужно от 12 м³`), `v4` — «Недоступна · Плановое ТО до 03.10». DOM: `getByLabel('Персонаж')` → «Водитель · Илья Васильев» (`:39`) → «Моя смена» (`pg.today`), состояние «Машина»: карточки машин с кнопкой «Забронировать» (`bookLabel` `:3406`), у `v3` список несовместимостей, у `v4` чип «Недоступна · …» — 03 §8.4.
20. When забронировать `v1`; Then toast «Бронь подтверждена сервером. Начните осмотр», рейс `inspection`, машина `reserved`, `heldBy:'Р-208'`. DOM: кнопка «Забронировать» в карточке «ГАЗель Next» (`:3406`) — 03 §8.4; тост — 03 §11.6.
21. Given флаг «Конфликт брони»; When забронировать `v6`; Then на экране «Машину только что забронировал другой сотрудник. Список на экране устарел.» (не toast), `v6.state === 'reserved'`, `note:'другой рейс'`; флаг сброшен; When «Обновить список» → toast «Список обновлён». DOM: чекбокс «Конфликт брони» (`:64`); на «Моей смене» `role="alert"` «Конфликт брони» с текстом и кнопкой «Обновить список» (`onRefresh` `:3442`) — 03 §10.4.
22. Given флаг «Нет связи»; When забронировать; Then toast error «Бронь требует связи с сервером», запрос не отправлен. DOM: чекбокс «Нет связи» (`:63`) + кнопка «Забронировать» — 03 §4.5, §10.3.
23. When забронировать `v3`; Then ошибка «Машина не подходит рейсу: Грузоподъёмность: 0,9 т, нужно от 1,1 т; Объём: 9 м³, нужно от 12 м³». DOM: кнопка «Забронировать» в карточке `v3` (вызов адаптера напрямую, если UI её прячет) — 03 §8.4; ошибка — тост error 03 §11.6.
24. Given бронь `v1`, пустой осмотр; When отправить выезд; Then ошибка «Осмотр не завершён: 5 фото, пробег, уровень топлива, 3 пункта чек-листа». DOM: блок осмотра пуст (03 §8.7); sticky-панель, кнопка «Выехать на маршрут» (`label` `:3494`) — 03 §8.8.
25. Given 5 фото `ready`, пробег `84000`; Then подсказка у поля «Пробег не может быть меньше 84 370 км»; пробег `90000` → «Больше начального на 5 630 км — проверьте показания». DOM: поле пробега в блоке осмотра и подсказка под ним — 03 §8.7.
26. Given полный осмотр (пробег `84400`, топливо «¾», 3 пункта); When отправить; Then toast «Выезд подтверждён сервером», рейс `on_route`, машина `on_route`; создан ответ формы `R-…` «Рейс Р-208 · выезд» v3 и задача «Проверить осмотр Р-208 (выезд)» assignee «Марина Котова» priority `normal` с чек-листом «Сверить фото с прошлым осмотром», «Проверить пробег». DOM: 5 слотов фото (03 §10.1), поле пробега, выбор топлива «¾», 3 чекбокса чек-листа (03 §8.7); кнопка «Выехать на маршрут» (`:3494`) — 03 §8.8; ответ — «Формы и опросы» → вкладка «Ответы» (05 §6.8); задача — «Задачи» (05 §7.5).
27. Given дефект zone «Кузов», `critical:true`; When отправить выезд; Then toast «Выезд заблокирован: дефект отправлен менеджеру», рейс `defect_review`, машина `unavailable` note «критический дефект на проверке»; задача приоритета «Срочно»; у логиста событие «Критический дефект: ГАЗель Next А 412 МР 77 — Кузов. Выезд заблокирован.». DOM: дефект с зоной «Кузов» и признаком «критический» в блоке осмотра (03 §8.7); кнопка sticky-панели меняет подпись на «Отправить на проверку менеджеру» (`:3494`) — 03 §8.8; событие — 03 §11.5.
28. Given `defect_review`, персона логист (с ролью); When «разрешить выезд»; Then toast «Выезд разрешён», рейс `on_route`, дефект `downgraded:true`; водитель видит «Менеджер разрешил выезд: дефект признан некритичным». When «подтвердить неисправность»; Then toast «Неисправность подтверждена, машина снята с рейса», рейс `planned`, `v1.state === 'unavailable'`, note «неисправность подтверждена». DOM: «Логист · Марина Котова» (`:38`) → «Приёмка смен» → карточка `role="alert"` «Критический дефект · …», кнопки «Дефект некритичный — разрешить выезд» (`:591`) и «Подтвердить неисправность» (`:592`) — 03 §7.3, §7.5.
29. Given `on_route`; When добавить расход «Топливо» сумма `1500`, чек `ready`; Then toast «Расход принят сервером», `expenses[0].amount === 1500`. Сумма `0` → «Сумма должна быть больше нуля»; `250000` → «Больше 200 000 ₽ — проверьте сумму»; без чека → «Добавьте фото чека». DOM: блок «Расходы» → кнопка «Добавить расход» (`:776`) → «Категория» → кнопка «Топливо» (`:781`), `getByLabel('Сумма, ₽')` (`:783`), кнопка «Демо-фото чека» (`:796`), кнопка «Сохранить расход» (`saveLabel` `:3514`); ошибки — `role="alert"` под полями (`:783`, `:799`) — 03 §8.9.
30. Given флаг «Нет связи»; When сохранить расход; Then toast warn «Расход сохранён на устройстве. Отправится при появлении связи», запись в outbox `state:'local'`; When связь вернулась; Then toast «Топливо 1 500 ₽ — принято сервером», outbox пуст, расход один (повтор `opId` → `'duplicate'`). DOM: при «Нет связи» кнопка называется «Сохранить на устройстве» (`:3514`); снятие флага «Нет связи» (`:63`) → `flush` — 03 §10.2–10.3.
31. When «Завершить рейс»; Then toast «Рейс завершён. Заполните осмотр при сдаче», статус `returning`. DOM: состояние «Рейс» → sticky-панель, кнопка «Завершить рейс» (`:3499`) → confirm «Завершить рейс Р-208?», кнопка «Завершить рейс» (`:2616–2619`) — 03 §8.6, §8.8.
32. Given сдача с пробегом меньше `dep.odometer`; Then «Сдача не завершена: пробег не меньше 84 400 км». Given полная сдача; When отправить; Then toast «Сдача принята сервером. Ожидайте приёмки», рейс `submitted`, машина `review`; ответ «Рейс Р-208 · сдача» и задача «Проверить осмотр Р-208 (сдача)». DOM: блок осмотра при сдаче (03 §8.7); кнопка «Сдать машину» (`:3494`) — 03 §8.8.
33. Given «Нет связи» при сдаче; Then toast warn «Сдача сохранена на устройстве и ещё не принята сервером»; после восстановления — «Сдача машины — принято сервером». DOM: при «Нет связи» кнопка «Сохранить сдачу на устройстве» (`:3494`) — 03 §8.8, §10.3.
34. Given флаг «Сбой загрузки фото»; When загрузить фото; Then слот `failed` с текстом «Загрузка прервалась. Повторите попытку.», флаг сброшен; повтор → `ready`. DOM: чекбокс «Сбой загрузки фото» (`:65`); слот фото (кнопка с динамическим `aria-label`) → состояние `failed` с кнопкой «Повторить» (`:739`) — 03 §10.1.
35. Given `usedGb >= quotaGb` (оператор задал квоту 40 при 46,2) и нет начатого рейса; When загрузить фото; Then «Место организации заполнено. Загрузка новых файлов недоступна.». DOM: квота — «Оператор платформы» → «Использование» (04 §5.2); загрузка — слот фото на «Моей смене» (03 §10.1); занятость организации — «Файлы» (06 §8.2) и баннер 01 §11.

### 14.4 Логист: приёмка, пул, назначение

36. Given `submitted`, персона логист с ролью; When принять; Then toast «Смена принята. Машина вернулась в пул», рейс `accepted`, `v1.state === 'free'`, `v1.odometer === ret.odometer`, `earnings[0] = {tripId:'Р-208', amount:4500, status:'Начислено'}`; логист видит «Начисление по рейсу Р-208: 4 500 ₽»; водитель — «Смена Р-208 принята. Машина свободна.» и **не** видит начисление. DOM: «Приёмка смен» → очередь (`:577–582`) → карточка смены Р-208, кнопка «Принять смену» (`:645`) → confirm «Принять смену Р-208?», кнопка «Принять смену» (`:2792–2798`) — 03 §7.2, §7.4–7.5; события — 03 §11.5, поповер «Уведомления» 01 §10.3.
37. When вернуть на доработку без комментария; Then «Опишите, что нужно исправить»; без разделов → «Отметьте хотя бы один раздел для доработки»; с комментарием «Пересними одометр» и разделом → toast «Смена возвращена водителю на доработку», рейс `rework`, водитель видит «Смена Р-208 возвращена на доработку: Пересними одометр». DOM: карточка смены → поле комментария и чекбоксы разделов, кнопка «Вернуть на доработку» (`:644`) — 03 §7.4–7.5; баннер у водителя — 03 §8.5.
38. When принять повторно (`accepted`); Then «Смена уже обработана». DOM: повтор «Принять смену» (`:645`) на уже обработанной смене — 03 §7.5.
39. When назначить `v2` на «Р-211»; Then toast «Машина назначена на рейс Р-211», рейс `assigned`; `v1` на Р-211 → «Нельзя назначить: Температура: без охлаждения, нужно +2…+6 °C». DOM: «Рабочее место» (`pg.fleet`) → рейс Р-211 (список `aria-label="Рейсы"`) → карточка машины `v2`, кнопка «Назначить на рейс» (`:464`) — 03 §5.3.
40. When запросить `Водитель #104` на Р-211; Then toast «Запрос отправлен фирме Юг Транс · уведомления в демо не отправляются»; повтор → «Запрос уже отправлен»; «Одобрить» в блоке «Демо: ответ фирмы-владельца» → toast «Фирма Юг Транс одобрила запрос (демо)», `Р-211.driverName === 'Водитель #104 · временно'`. DOM: «Ресурсный пул» → карточка «Водитель #104», кнопка «Запросить на рейс Р-211» (`:535`) → диалог «Запросить водителя», кнопка «Отправить запрос» (`:2292–2296`); затем `role="status"` «Ожидает решения менеджера фирмы …» и блок «Демо: ответ фирмы-владельца» с кнопками «Одобрить»/«Отклонить» (`:536–538`) — 03 §6, 01 §14.6.

### 14.5 Core-модули

41. When перевести «Классический массаж · Мария К.» на 11:30; Then на экране «Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)» и слоты «08:00», «08:15», «08:30»; клик по слоту → «Перенесено на 08:00». DOM: «Календарь» → событие «Классический массаж · Мария К.» (кнопка `aria-label="{title}, HH:MM–HH:MM"`) → `getByLabel('Перенести начало на')` = «11:30» (`:1915`), кнопка «Проверить и перенести» (`:1916`); конфликт — `role="alert"` с подписью «Свободные слоты для всех ресурсов:» и кнопками-слотами «08:00»… (`:1921–1923`) — 06 §5.3–5.4.
42. When перевести на свободное время; Then «Перенос подтверждён сервером». DOM: те же `getByLabel('Перенести начало на')` и «Проверить и перенести» (`:1915–1916`) — 06 §5.4.
43. When сохранить `kb-1` с базовой версией 2; Then «Опубликована версия v3»; повтор с базовой 2 → «Страницу уже изменили (v3). Обновите и повторите правку.». DOM: «База знаний» → `aria-label="Дерево страниц"` → страница kb-1 → кнопка «Редактировать» (`:1947`), `getByLabel('Текст страницы')` (`:1945`), кнопка «Опубликовать v3» (`:1948`); «История версий» (`:1951–1952`) — 06 §6.2–6.3.
44. Given задача T-58 («В работе», чек-лист 1/3); Then кнопка «Готово · сначала чек-лист» disabled; When «На проверке» → toast «T-58: На проверке», системный комментарий «Статус: В работе → На проверке». DOM: «Задачи» → карточка T-58 (`aria-label="Карточка задачи"`) → блок «Перевести»: кнопка «Готово · сначала чек-лист» `disabled`, кнопка «На проверке» (`:1785`); комментарий — блок «История и комментарии» (`:1801–1802`) — 05 §7.7.
45. When создать задачу с пустым названием; Then «Укажите название задачи»; с названием → toast «Задача создана», id `T-…`, статус «Новая». DOM: шапка «Задач» → кнопка «Новая задача» (05 §7.3) → форма: поле названия, кнопка «Создать» (`:1732`) — 05 §7.4.
46. When опубликовать форму «Осмотр машины» с изменённым типом поля `q-fuel`; Then toast «Опубликована версия v4», в v4 поле `q-fuel-v4`, ответы R-1012 по-прежнему `version:3`. DOM: «Формы и опросы» → «Осмотр машины» → вкладка «Конструктор» → поле «Уровень топлива» → смена типа (05 §6.5) → `role="status"` «Черновик отличается от опубликованной версии…» (`:1605`) → кнопка «Опубликовать v4» (`publishLabel` `:4484`) → confirm «Опубликовать «Осмотр машины» v4?», кнопка «Опубликовать v4» (`:4441–4448`) — 05 §6.5–6.6; ответы — вкладка «Ответы» (05 §6.8).
47. Given персона «Логист»; Then форма только для чтения (нет `forms·settings`) — `publishForm` → «Ни одна роль сотрудника не разрешает это действие.». DOM: «Логист · Марина Котова» (`:38`) → «Формы и опросы»: в «Конструкторе» нет кнопок правки (`q.canEdit`, `:1617`) и кнопки «Опубликовать v…» — 05 §6.1, §6.10; ошибка — только при прямом вызове адаптера.

### 14.6 SPA, касса, ремонт

48. Given «Массажист · Анна Морозова»; When завершить `ap-1`; Then toast «Процедура завершена, материалы списаны по техкарте», `oil.qty === 220`, движение `MV-…` 30 мл «Классический массаж · Мария К.», `ap-1.status === 'done'`; повтор → `'duplicate'`, без второго движения. DOM: `getByLabel('Персонаж')` → «Массажист · Анна Морозова» (`:40`) → «Мой день» (`pg.spa`) → карточка `ap-1`, кнопка «Завершить процедуру» (`:2007`); проверка — блоки «Остатки кабинета» и «Движения склада» (`:2013–2014`) — 06 §9.2–9.3.
49. When завершить `ap-2`; Then toast warn «Услуга выполнена. Материала не хватило — учёт ждёт решения владельца», `cream.qty === 0`, issue «Не хватило «Крем восстанавливающий»: нужно 20 г, списано 12 г · SPA-ритуал (Ольга Р.)», статус `done_pending`; владелец: «Остаток списан из резерва» / «Принят фактический расход» → `done`. DOM: карточка `ap-2` → «Завершить процедуру» (`:2007`); `role="alert"` «Учёт материалов не завершён.» с текстом issue (`:1996`), у массажиста — «Решение примет владелец»; у владельца («Салон и SPA») кнопки «Списать остаток из резерва» / «Принять фактический расход» (`:1996`), тосты — `:4237` — 06 §9.2–9.4.
50. Given владелец, касса; When провести операцию без основания; Then «Укажите основание операции»; с данными → «Операция проведена», id `K-…`. When сторно `K-302`; Then «Сторно проведено», операция `type:'storno'`, basis «Сторно K-302: ошибка ввода (демо)», `sign:1`; повтор → «Операция уже исправлена». DOM: «Внутренняя касса» → форма: `getByLabel('Тип')`, `getByLabel('Сумма, ₽')`, `getByLabel('Основание')`, кнопка «Провести в «{cs.accName}»» (`:2025–2028`), ошибка `role="alert"` (`:2029`); строка K-302 → кнопка «Сторно» (`:2033`) → confirm (`onReverse` `:4272`) — 06 §10.2–10.3.
51. Given принятый расход рейса; Then в кассе предложение «Рейс Р-208 · Топливо 1 500 ₽ · принят менеджером»; When провести; Then «Расход проведён по кассе Север», `src === expense.id`. DOM: блок «Предложения из принятых смен» → кнопка «Провести расход» (`:2031`) — 06 §10.2–10.3.
52. Given модуль «Ремонт и стройка» включён, «Прораб · Алексей Соколов»; When отметка w1 объём `50`; Then «Объём превышает план более чем на 10%: осталось 38 м²»; объём `22`, 2 работника, фото → «Отметка отправлена на приёмку», `WL-…` «На проверке», `w1.fact` без изменений (58). DOM: `getByLabel('Персонаж')` → «Прораб · Алексей Соколов» (`:41`) → «Объекты» (`pg.repair`) → кнопка «Отметить работу» (`:2055`, `:4300`) / вкладка «Работы» → блок «Отметка за сегодня»: `getByLabel('Работа')`, `getByLabel('Объём')` (`:2134–2135`), чекбоксы в fieldset «Бригада · учётные карточки без входа в CRM» (`:2139`), кнопка «Демо: добавить фото» (`:2140`), кнопка «Отправить отметку на приёмку» (`:2142`); ошибка — `role="alert"` (`:2141`); журнал отметок с чипом «На проверке» (`:2146`) — 06 §11.4.
53. Given владелец; When «Принять объём»; Then «Объём принят, материалы списаны», `w1.fact === 80`, `mt2.qty` уменьшен на указанное; повтор → «Отметка уже обработана». DOM: «Владелец · Дарья Зимина» (`:37`) → «Объекты» → «Работы» → строка WL-…, кнопка «Принять объём» (`:2146`) или «Главная» → очередь «Требует решения» → «Принять объём» (`:4298`) — 06 §11.4, 05 §5.5.

### 14.7 Платформа

54. Given «Оператор платформы»; Then в `db` только `platform` (`operatorOnly:true`), 4 организации, заявка SR-12 pending, 58 аккаунтов, 6 операторов. DOM: `getByLabel('Персонаж')` → «Оператор платформы» (`:34`); меню `aria-label="Основная навигация"`: «Организации», «Использование», «Заявки на тариф», «Пользователи», «Тарифная сетка» — 04 §4.4; список `aria-label="Организации"` (4 карточки) — 04 §5.1; заявки — 04 §5.3; аккаунты и операторы — 04 §5.4.
55. When продлить trial «Альта Групп» на 14; Then audit «Альта Групп: пробный период продлён на 14 дней», `trialDaysLeft === 26`, `trialEnds === '27.10.2026'`; владелец видит «Оператор платформы продлил пробный период на 14 дней». DOM: «Организации» → карточка «Альта Групп» → кнопка «Продлить пробный период на 14 дней» (`:1560`) → `opConfirm` «Продлить пробный период «Альта Групп»?», кнопка «Продлить» (`:3552`) — 04 §5.1, §4.7; текст владельца — «Уведомления» 01 §10.3.
56. When ограничить «Альта Групп»; Then `status:'restricted'`, владелец: «Пробный период завершён. Новые операции ограничены, данные сохранены.»; водитель при брони → «Пробный период завершён: новые операции недоступны. История доступна для чтения.»; начатый рейс (`on_route`) всё ещё сдаётся. DOM: кнопка «Ограничить новые операции» (`:1565`) → «Ограничить «Альта Групп»?», кнопка «Ограничить» (`:3554`); обратно — «Снять ограничение» (`:1566`, `:3555`) — 04 §5.1; баннер владельца — 01 §11; тост водителя при «Забронировать» — 03 §4.4, §8.4.
57. When заблокировать аккаунт без причины; Then «Укажите причину блокировки»; с причиной → `status:'locked'`, audit «<email>: вход заблокирован — <причина>». DOM: «Пользователи» → `aria-label="Карточка аккаунта"` → поле причины, кнопка «Заблокировать вход» (`:1142`) → `opConfirm` «Заблокировать вход {email}?», кнопка «Заблокировать» (`:3654–3658`) — 04 §5.4.
58. When пригласить оператора `x@gmail.com`; Then «Оператором может быть только сотрудник платформы: почта в домене ortus.example»; роль `owner` → «Владельцем платформы назначают уже работающего оператора»; `a.morozova@alta.example` → «Эта почта уже используется в организации клиента. Для оператора нужен отдельный рабочий аккаунт». DOM: «Пользователи» → блок «Пригласить оператора»: `getByLabel('Имя и фамилия')`, `getByLabel('Рабочая почта')`, `getByLabel('Роль')`, кнопка «Отправить приглашение» (`:1056–1060`) — 04 §5.4.
59. When сменить роль `op-1` (me); Then «Свою роль менять нельзя: попросите другого владельца»; отключить `op-1` → «Себя отключить нельзя»; отключить `op-5` (invited) → «Приглашение отозвано», оператор удалён. DOM: список операторов → `select` `aria-label="Роль: {имя}"` (04 §5.4); кнопка «Отключить» (`:1046`) → `opConfirm` «Отключить оператора?», кнопка «Отключить» (`:3823–3827`); для приглашённого — кнопка «Отозвать приглашение» (`:1048`) — 04 §5.4.
60. When опубликовать прайс-лист с ценой «Старт» 0; Then «Цена каждой ступени должна быть больше нуля»; корректный → версия v3 `scheduled`, v2 `to: 'до <from>'`; повтор → «Уже запланирована версия v3. Отмените её, чтобы подготовить другую.»; отмена → v2 `to:null`. DOM: «Тарифная сетка» → «Подготовить версию v3» → ячейка `aria-label="Цена за месяц, тариф Старт"` = 0 → `role="alert"` «Перед публикацией исправьте:» (`:1206`) и `disabled` у «Опубликовать v3» (`:1215`); корректно → «Опубликовать v3» → `opConfirm` «Опубликовать тарифную сетку v3?», кнопка «Опубликовать» (`:3891–3895`); отмена — баннер `role="status"` «Запланирована версия v3 …», кнопка «Отменить версию» → диалог «Отменить версию v3?», кнопка «Отменить версию» (`:3845`) — 04 §5.5.

### 14.8 Изоляция организаций

61. Given персона «Владелец · Ирина Белова» (t-lotos); Then `units` — 3 (Москва, Лотос · Тверская, Лотос · Арбат), 23 участника, задачи T-7/T-8, касса «Касса «Лотос»», нет машин/рейсов, страница БЗ только `kb-3`; бренд `accent '#7A3E79'`, термин `visit.one === 'сеанс'`. DOM: `getByLabel('Персонаж')` → «Владелец · Ирина Белова» (`:44`); меню и шапка «Лотоса» — 01 §17.3; «Пользователи и роли» → «Люди» → «23 участников …» (02 §6.4); «Задачи» (05 §7.9); «Внутренняя касса» → карточка счёта «Касса «Лотос»» (06 §10.1); «База знаний» → дерево (06 §6.1); цвет — `--ox-accent` (01 §17.1).
62. When сохранить оформление в t-lotos; Then бренд t-alta не изменился (`version` 1), audit «SPA «Лотос»: оформление, версия 4». DOM: «Оформление» → кнопка «Сохранить для всех» (`:1441`) — 02 §8.3; затем `getByLabel('Персонаж')` → «Владелец · Дарья Зимина» (`:37`) → «Оформление» без изменений; audit — 04 §6.

---

## 15. Открытые вопросы

1. **404 vs 403 для `no_scope`.** Прототип различает «Нет доступа к объекту» (`REASON.no_scope`), реестр требует единый 404 для чужих и несуществующих id (`docs/12:41`). Нужно решить: «Проверка доступа» — локальный инструмент владельца (данные уже есть), а API — 404.
2. **`seats_exhausted`, `upload_failed`, `conflict` «адрес уже есть»** — кодов нет в `docs/12`; `requestSeats` в `docs/17:138` называется `request_pending`.
3. **`subscription_restricted`** объединяет `restricted` и `suspended`; реестр различает `tenant_read_only` (чтение и экспорт разрешены) и `tenant_suspended` (экран блокировки).
4. **Минимум владельцев платформы**: мок — ≥1 активный (`api.js:257, 265`), `docs/17:184` и `11-permissions.yaml:140` — «≥2 активных владельца».
5. **`decideDefect` endpoint**: прототип `POST /fleet/trips/{id}/defect-decision` (PROPOSED), OpenAPI имеет `/fleet/inspections/{id}/review` (6038) — какой канонический?
6. **`cancelReservation`** передаёт `tripId` в `/fleet/reservations/{reservationId}` — в мок-модели нет сущности «бронь» с собственным id.
7. **`submitDeparture` без `opId`** в UI (`Ортус CRM.dc.html:2607`), хотя HTTP-адаптер ждёт `Idempotency-Key`.
8. **Ключи прав spa/cash/inventory/tasks.manage/forms.responses.create/repairs.export/repairs.settings** отсутствуют в `11-permissions.yaml`; `repairs.projects.manage` — level `edit` в прототипе, `settings` в каноне.
9. **Дедупликация `recordInspection`** по ключу `trip:dep:rev1`: после `decideDefect('deny')` и повторного выезда на другой машине второй ответ формы не создаётся — намеренно или нет?
10. **Фильтр календаря в `seedLotos`** (`mock-data.js:52–53`) не удаляет брони с машинами (`b-to`) и рейс `b-208`, т. к. проверяет `Object.values`, а `res` — массив.
11. **`view()` не фильтрует** `members`, `roles`, `assignments`, `forms`, `pool`, `spa`, `repair` — политика для реального API не определена в источниках.
12. **Временный резерв квоты** для начатых смен «не определён» (README `:160`).
13. **ID создаваемых сущностей** (`R-1140`, `T-161`, `K-3xx`, `SR-1xx`) зависят от общего `seq`, который инкрементируют и события — e2e не должны ожидать точные номера.
14. **`tenantIds()` и `defaultBranding()`** не вызываются UI — нужны ли в контракте адаптера?
15. **`ops` общий для всех организаций** — в реальном API ключ идемпотентности привязан к tenant + actor?
16. **Числа мест в `fillAccounts`** зависят от `seatsUsed` tenant'ов — при изменении seed платформы пересчитаются `acc-gN` и состав `m-lN` в t-lotos.

---

## 16. Факты для плана

1. Адаптер — 53 метода (6 служебных, 10 платформы, 4 организации, 8 людей/ролей/мест, 13 логистики, 6 core, 7 SPA/касса/ремонт, 1 файлы); HTTP-заготовка покрывает 36.
2. Домен — 25 функций и 22 справочника в одном файле 305 строк; переносится в `types.ts` + `domain/*.ts` 1:1 (README `:34`).
3. Все доменные функции чистые и тестируются без БД; примеры в разделе 8 дают ≥60 unit-кейсов.
4. `can`/`canEarnings` вызываются и в UI (`navForBase`, `accessVM`, `gateVM`, `fleetVM` и др. — ~30 вызовов), и в моке — реализация должна быть общей библиотекой.
5. Seed t-alta стартует с **выключенной** логистикой и **не назначенным** логистом — e2e основного пути начинается с «Модули и место» → «Пользователи и роли».
6. Два tenant-БД + общий `platform`; переключение персоны = `setActor` + `load` (задержки 320–500 мс).
7. Задержки команд 200–650 мс + загрузка фото ≈0,8 с × 5 фото — учесть в таймаутах e2e.
8. Флаги `online`/`conflictNext`/`failUploadNext` — единственный способ воспроизвести офлайн/конфликт/сбой; в реальном API потребуется тестовый бэкенд или перехват сети.
9. Офлайн-очередь (`outbox`) живёт в UI, а не в адаптере: `flush()` повторяет `upload` + `addExpense`/`submitReturn` с тем же `opId`.
10. Ответ любой команды — полный `db`; при переходе на HTTP нужен `GET /me/context` после мутаций или инкрементальные ответы.
11. `view()` — спецификация серверной фильтрации restricted-полей; её правила обязательны для всех каналов (HTTP, Data Hub, экспорт, поиск, уведомления).
12. Коды ошибок мока (18) ↔ реестр `docs/12` (35 кодов): таблица соответствия в разделе 6; UI обязан переключаться на канонические коды.
13. Problem-формат (`type/title/status/code/detail/requestId/violations/retryable`) — `ApiError` должен нести `status`, `violations`, `requestId`.
14. 10 переименований ключей прав + 7 ключей вне каталога — редактор ролей и `rolePermKeys` надо строить на каноне.
15. Критический путь побочных эффектов: `submitDeparture` → ответ формы + задача; `reviewTrip(accept)` → начисление + sensitive-событие; `completeAppointment` → движения склада + issue; `acceptWorkLog` → факт + материалы.

---

## Исправления после критики

По замечанию E4 из `00-coverage-critique.md` (§3.5, §4, §6, §7) — все пункты проверены по первоисточнику `design/Ортус CRM.dc.html`.

1. **Подписи персонажей в §14 (преамбула, пункты 1, 11, 17, 19, 28, 47, 48, 52, 53, 54, 61, 62).** Было: подписи из константы `PERSONAS` («Владелец бизнеса · Дарья Зимина», «Владелец бизнеса» в t-lotos). Стало: подписи `<option>` шаблона селекта `getByLabel('Персонаж')`: «Оператор платформы» (`:34`), «Владелец · Дарья Зимина» (`:37`), «Логист · Марина Котова» (`:38`), «Водитель · Илья Васильев» (`:39`), «Массажист · Анна Морозова» (`:40`), «Прораб · Алексей Соколов» (`:41`), «Владелец · Ирина Белова» (`:44`), «Массажист · Анна Морозова» (`:45`). Источник: `Ортус CRM.dc.html:31–47`.
2. **⚠ проверено — уточнение к формулировке критика «`PERSONAS` не используется».** Константа `PERSONAS` (`:2326`) *читается*: `shellVM` возвращает `personaOptions: PERSONAS.map(([value, label]) => ({ value, label }))` (`:2834`). Но ключ `personaOptions` в шаблоне не встречается (поиск по файлу: только `:2834`); селект рендерит статические `<option>` (`:33–46`), и в них нет «Владелец бизнеса». Вывод критика о подписях в DOM верен; примечание добавлено в преамбулу §14 и под таблицу §9.5.
3. **DOM-привязка для каждого пункта §14 (1–62).** К каждому пункту добавлена запись «DOM: …» — экран, роль/подпись элемента (`getByRole`/`getByLabel`/текст кнопки), строка шаблона и раздел отчёта 01–06, где элемент описан. Основные источники строк: модули `:237–238`, `:2675–2705`; «Проверка доступа» `:397–400`, `:406–408`, `:3136`; диалоги `:2230–2298`; биллинг `:1473–1505`, `:3937`; заявки оператора `:968–971`; водитель `:739`, `:776–800`, `:3406`, `:3442`, `:3494`, `:3499`, `:3514`, `:2616–2619`; приёмка `:591–592`, `:644–645`, `:2792–2798`; логист `:464`, `:535–538`; календарь `:1915–1923`; БЗ `:1945–1952`; задачи `:1732`, `:1785`, `:1801`; формы `:1605`, `:1617`, `:4441–4448`, `:4484`; SPA `:1996`, `:2007`, `:2013–2014`, `:4237`; касса `:2025–2033`, `:4272`; ремонт `:2055`, `:2134–2146`, `:4298–4300`; платформа `:1046–1060`, `:1142`, `:1206`, `:1215`, `:1560–1566`, `:3552–3555`, `:3654–3658`, `:3823–3827`, `:3845`, `:3891–3895`; оформление `:1441`.
4. **Пункт 21.** Подпись кнопки после конфликта брони уточнена: «Обновить список» (03 §10.4, `onRefresh` `:3442`), а не «Обновить».
5. **Пункт 40.** «Демо: одобрить» — не подпись элемента: в DOM подпись блока «Демо: ответ фирмы-владельца» и кнопка «Одобрить» (`:538`); формулировка исправлена.
6. **Пункт 61.** «Владелец бизнеса» в t-lotos заменено на подпись шаблона «Владелец · Ирина Белова» (`:44`).

Не исправлялось (критик прав, но замечание относится к другим отчётам): E4 для 01–06, 08, 09 — там подписи уже из шаблона (00 §7).
16. Форматирование чисел зависит от локали `ru-RU` и даёт U+00A0 — фиксировать в тестах `'84 370'`.
17. Даты в моке зафиксированы на 01.10.2026 (`hhmm()` — реальное время) — для детерминированных тестов нужен инжектируемый `clock`.
18. Имена исполнителей/авторов захардкожены в моке (Марина Котова, Дарья Зимина, Алексей Соколов, Илья Васильев) — в реальном API брать из актора/назначений.
19. `recordInspection` зависит от опубликованной формы `fm-insp` и включённой автоматизации `au-1` — unit-тест на отсутствие формы/автоматизации.
20. `compat` — «сумма объёма и массы, не 3D-укладка» (`models.js:212`) — оговорка должна остаться в UI.
21. Пробег: `odoError` допускает +3000 км сверх начального, иначе предупреждение; `inspMissing` — только нижняя граница.
22. Расход ограничен 200 000 ₽; сумма принимает запятую и пробелы.
23. Календарь: шаг слотов 0,25 ч, рабочий день 08–20, `freeSlots` возвращает 3 варианта.
24. Задачи: два процесса (`tasks`, `leads`) с разными статусами — канбан должен брать `WORKFLOWS[flow]`, а не `TASK_STATUSES`.
25. Lotos: 23 участника генерируются из `fillAccounts` — состав детерминирован, но зависит от `seatsUsed` в `platform.tenants`.
26. `roadmap.js` используется только `planVM` для экранов «план» (`Ортус CRM.dc.html:3944–3953`) — 9 карт с `title/icon/stage/purpose/screens/components/rules/api`, у `forms` ещё `flow`/`flowNote`.
27. Риск: мок не 404-ит отсутствующие id в 13 методах (TypeError) — контрактные тесты бэкенда должны покрыть «чужой/несуществующий id → 404».
28. Риск: `view()` возвращает все `members/roles/assignments` любому актору — политику `members.read`/`roles.read` нужно определить до реализации API.
