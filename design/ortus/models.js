// Доменная модель и правила «Ортус». Чистые функции без зависимости от хранилища.
// Используются и mock-сервером (как серверные проверки), и UI (как предпросмотр).
// В промышленной версии решение принимает сервер на Go; UI лишь показывает разрешённое.

/** @typedef {{type:'tenant'}|{type:'region',id:string}|{type:'firm',id:string}|{type:'self'}} Scope */
/** @typedef {{id:string,member:string,role:string,scope:Scope,via?:string,until?:string}} Assignment */
/** @typedef {{id:string,name:string,kind:'system'|'template'|'custom',all?:boolean,professional?:'driver',actions:Object<string,string[]>,finance:{read:boolean,manage:boolean}}} Role */
/** @typedef {'free'|'reserved'|'on_route'|'review'|'unavailable'} VehicleState */
/** @typedef {'planned'|'assigned'|'inspection'|'defect_review'|'on_route'|'returning'|'submitted'|'rework'|'accepted'} TripState */

export const TONES = {
  ok: { bg: '#E3EFE7', fg: '#1F6B52' },
  info: { bg: '#E7EEF6', fg: '#2B5479' },
  warn: { bg: '#FAF1DC', fg: '#7A5214' },
  danger: { bg: '#FBEAE7', fg: '#A13A33' },
  neutral: { bg: '#ECEFEA', fg: '#4C5955' },
};

export const VERBS = [
  ['view', 'Просматривать'], ['create', 'Создавать'], ['edit', 'Изменять'],
  ['review', 'Проверять'], ['export', 'Выгружать'], ['settings', 'Настраивать'],
];

export const INDUSTRY = {
  logistics: {
    name: 'Логистика', icon: 'local_shipping',
    desc: 'Машины, рейсы, осмотры, расходы в пути и приёмка смен.',
    deps: ['calendar', 'files', 'forms'],
    adds: ['Рабочее место логиста', 'Мобильная смена водителя', 'Осмотры с обязательными фото', 'Приёмка смен'],
    templates: ['Менеджер логистики', 'Водитель'],
    perms: {
      view: ['fleet.vehicles.read', 'fleet.trips.read'],
      create: ['fleet.reservations.create', 'fleet.inspections.create', 'fleet.expenses.create'],
      edit: ['fleet.trips.manage', 'fleet.pool.request'],
      review: ['fleet.trips.review'], export: ['fleet.export'], settings: ['fleet.settings'],
    },
  },
  spa: {
    name: 'Салон и SPA', icon: 'spa',
    desc: 'Запись, специалисты, кабинеты, техкарты и списание материалов.',
    deps: ['calendar', 'inventory', 'cash', 'forms'],
    adds: ['Расписание специалиста', 'Визиты и техкарты', 'Списание материалов'],
    templates: ['Массажист'],
    perms: {
      view: ['spa.appointments.read'], create: ['spa.appointments.create'], edit: ['spa.services.manage'],
      review: ['spa.completion.review'], export: ['spa.export'], settings: ['spa.settings'],
    },
  },
  repair: {
    name: 'Ремонт и стройка', icon: 'construction',
    desc: 'Объекты, виды работ, бригады, материалы и фотоотчёты.',
    deps: ['tasks', 'inventory', 'files'],
    adds: ['Объекты и этапы', 'Отметки прораба', 'Фотоотчёты'],
    templates: ['Прораб'],
    perms: {
      view: ['repairs.projects.read'], create: ['repairs.worklogs.create'], edit: ['repairs.projects.manage'],
      review: ['repairs.worklogs.review'], export: ['repairs.export'], settings: ['repairs.settings'],
    },
  },
};

export const CORE = {
  calendar: { name: 'Календарь', icon: 'calendar_month', perms: { view: ['calendar.read'], create: ['calendar.bookings.create'], edit: ['calendar.bookings.manage'] } },
  tasks: { name: 'Задачи', icon: 'task_alt', perms: { view: ['tasks.read'], create: ['tasks.create'], edit: ['tasks.manage'] } },
  knowledge: { name: 'База знаний', icon: 'menu_book', perms: { view: ['knowledge.read'], create: ['knowledge.write'] } },
  docs: { name: 'Документы', icon: 'description', perms: { view: ['docs.read', 'docs.comment'], create: ['docs.create', 'docs.convert'], edit: ['docs.update', 'docs.suggest'], review: ['docs.sign'], export: ['docs.export'], settings: ['docs.share', 'docs.templates.manage', 'docs.folders.manage'] } },
  forms: { name: 'Формы', icon: 'dynamic_form', perms: { view: ['forms.read'], create: ['forms.responses.create'], review: ['forms.responses.review'], settings: ['forms.publish'] } },
  data: { name: 'Данные', icon: 'table_view', perms: { view: ['data.read'], export: ['data.export'] } },
  files: { name: 'Файлы', icon: 'folder_open', perms: { view: ['files.read'], create: ['files.upload'] } },
  inventory: { name: 'Склад и материалы', icon: 'inventory_2', perms: { view: ['inventory.read'], create: ['inventory.movements.post'] } },
  cash: { name: 'Касса', icon: 'account_balance_wallet', perms: { view: ['cash.read'], create: ['cash.post', 'cash.proposals.post', 'cash.shift.operate'], edit: ['cash.refund', 'cash.transfer', 'cash.advance.issue'], review: ['cash.approve', 'cash.reconcile', 'cash.reverse'], export: ['cash.export'], settings: ['cash.accounts.manage', 'cash.period.close'] } },
  service: { name: 'Обращения', icon: 'support_agent', perms: { view: ['service.requests.read'], create: ['service.requests.create'], edit: ['service.requests.reply'], review: ['service.requests.resolve'], settings: ['service.directions.manage'] } },
  chat: { name: 'Чаты', icon: 'forum', perms: { view: ['chat.read'], create: ['chat.write', 'chat.files.send', 'chat.polls.create', 'chat.direct'], edit: ['chat.create'], review: ['chat.moderate', 'chat.announce'], export: ['chat.export'], settings: ['chat.settings.manage', 'chat.members.manage', 'chat.retention.manage'] } },
  learning: { name: 'Обучение', icon: 'school', perms: { view: ['learning.read', 'learning.catalog.read'], create: ['learning.author'], edit: ['learning.update', 'learning.assign'], review: ['learning.publish', 'learning.review'], export: ['learning.results.export'], settings: ['learning.program.manage'] } },
  notifications: { name: 'Уведомления', icon: 'notifications', perms: null },
};

export const ALL_MODULES = { ...INDUSTRY, ...CORE };
export const isIndustry = (k) => Object.prototype.hasOwnProperty.call(INDUSTRY, k);

// Шаблоны форм: pages → fields. module — отраслевой модуль, без которого шаблон недоступен; cat — раздел в списке «Все шаблоны».
const q = (id, type, label, x = {}) => ({ id, type, label, required: false, ...x });
const R = { required: true };
const op = (labels) => labels.map((l, i) => (Array.isArray(l) ? { id: 'o' + (i + 1), label: l[0], score: l[1] } : { id: 'o' + (i + 1), label: l }));
const iff = (field, value, op2 = 'eq') => ({ mode: 'all', conds: [{ field, op: op2, value }] });
export const FORM_SETTINGS = { access: 'internal', until: '', limit: null, onePerPerson: false, allowEdit: true, thanks: 'Спасибо! Ответ отправлен.', quiz: false, passScore: null, showScore: true, progress: true, backButton: true, logo: true, retainDays: 365 };
export const FORM_TEMPLATES = [
  { id: 'blank', cat: 'basic', name: 'Пустая форма', icon: 'note_add', module: null, pages: [{ title: 'Страница 1', fields: [q('q-1', 'text', 'Вопрос 1')] }] },
  { id: 'tpl-profile', cat: 'basic', name: 'Анкета', icon: 'badge', module: null, pages: [{ title: 'Контакты', fields: [q('q-name', 'text', 'Имя и фамилия', R), q('q-phone', 'phone', 'Телефон', R), q('q-email', 'email', 'Почта'), q('q-company', 'text', 'Компания'), q('q-inn', 'inn', 'ИНН компании'), q('q-contact', 'choice', 'Как удобнее связаться', { options: op(['Звонок', 'Мессенджер', 'Почта']) })] }] },
  { id: 'tpl-feedback', cat: 'basic', name: 'Форма обратной связи', icon: 'forum', module: null, settings: { access: 'public' }, pages: [{ title: 'Отзыв', fields: [q('q-rate', 'rating', 'Оцените работу', R), q('q-recommend', 'choice', 'Порекомендуете нас знакомым?', { ...R, options: op(['Да', 'Нет', 'Не знаю']) }), q('q-better', 'longtext', 'Что нам улучшить?', { ...R, showIf: iff('q-recommend', 'Нет') }), q('q-comment', 'longtext', 'Комментарий'), q('q-phone', 'phone', 'Телефон, если нужен ответ')] }] },
  { id: 'tpl-request', cat: 'basic', name: 'Заявка на услугу или работу', icon: 'assignment_add', module: null, pages: [{ title: 'Что нужно', fields: [q('q-what', 'longtext', 'Что нужно сделать', R), q('q-where', 'text', 'Адрес или объект', R), q('q-date', 'date', 'Удобная дата', R), q('q-photo', 'photo', 'Фото, если есть', { accept: 'photo', maxFiles: 5, maxMb: 20 })] }, { title: 'Контакты', fields: [q('q-name', 'text', 'Как к вам обращаться', R), q('q-phone', 'phone', 'Телефон', R), q('q-urgent', 'bool', 'Срочно?'), q('q-why', 'text', 'Почему срочно', { showIf: iff('q-urgent', 'да') })] }] },
  { id: 'tpl-event', cat: 'basic', name: 'Регистрация на обучение', icon: 'event_available', module: null, pages: [{ title: 'Участник', fields: [q('q-name', 'text', 'Имя и фамилия', R), q('q-email', 'email', 'Почта', R), q('q-phone', 'phone', 'Телефон')] }, { title: 'Участие', fields: [q('q-format', 'choice', 'Формат', { ...R, options: op(['Очно', 'Онлайн']) }), q('q-car', 'bool', 'Нужен пропуск на машину?', { showIf: iff('q-format', 'Очно') }), q('q-plate', 'text', 'Номер машины', { ...R, showIf: iff('q-car', 'да') }), q('q-ask', 'longtext', 'Вопросы к организаторам')] }] },
  { id: 'tpl-csat', cat: 'survey', name: 'CSAT · удовлетворённость', icon: 'sentiment_satisfied', module: null, pages: [{ title: 'Оценка', fields: [q('q-csat', 'rating', 'Насколько вы довольны результатом?', R), q('q-why', 'longtext', 'Что повлияло на оценку?')] }] },
  { id: 'tpl-nps', cat: 'survey', name: 'NPS · готовность рекомендовать', icon: 'recommend', module: null, pages: [{ title: 'Оценка', fields: [q('q-nps', 'scale', 'Насколько вероятно, что вы порекомендуете нас знакомым?', { ...R, scaleMin: 0, scaleMax: 10, left: 'Точно нет', right: 'Точно да' }), q('q-why', 'longtext', 'Почему такая оценка?')] }] },
  { id: 'tpl-ces', cat: 'survey', name: 'CES · лёгкость обращения', icon: 'speed', module: null, pages: [{ title: 'Оценка', fields: [q('q-ces', 'scale', 'Насколько легко было решить ваш вопрос?', { ...R, scaleMin: 1, scaleMax: 7, left: 'Очень сложно', right: 'Очень легко' }), q('q-hard', 'longtext', 'Что было сложнее всего?')] }] },
  { id: 'tpl-support', cat: 'survey', name: 'Оценка поддержки', icon: 'support_agent', module: null, pages: [{ title: 'Обращение', fields: [q('q-solved', 'choice', 'Ваш вопрос решён?', { ...R, options: op(['Да', 'Частично', 'Нет']) }), q('q-speed', 'rating', 'Скорость ответа', R), q('q-polite', 'rating', 'Вежливость', R), q('q-left', 'longtext', 'Что осталось нерешённым', { ...R, showIf: { mode: 'any', conds: [{ field: 'q-solved', op: 'eq', value: 'Частично' }, { field: 'q-solved', op: 'eq', value: 'Нет' }] } })] }] },
  { id: 'tpl-pulse', cat: 'people', name: 'Пульс команды', icon: 'monitor_heart', module: null, pages: [{ title: 'Работа', fields: [q('q-goals', 'scale', 'Я понимаю приоритеты на эту неделю', { ...R, scaleMin: 1, scaleMax: 5, left: 'Совсем нет', right: 'Полностью' }), q('q-tools', 'scale', 'Мне хватает инструментов и материалов', { ...R, scaleMin: 1, scaleMax: 5, left: 'Совсем нет', right: 'Полностью' })] }, { title: 'Команда', fields: [q('q-help', 'scale', 'Коллеги помогают, когда нужно', { ...R, scaleMin: 1, scaleMax: 5, left: 'Совсем нет', right: 'Полностью' }), q('q-idea', 'longtext', 'Что улучшить в работе команды')] }] },
  { id: 'tpl-onboard', cat: 'people', name: 'Онбординг сотрудника', icon: 'person_add', module: null, pages: [{ title: 'Документы', fields: [q('q-docs', 'multi', 'Какие документы сданы', { ...R, options: op(['Паспорт', 'СНИЛС', 'ИНН', 'Трудовая книжка']) }), q('q-scan', 'photo', 'Скан или фото документов', { accept: 'docs', maxFiles: 6, maxMb: 20 })] }, { title: 'Доступы', fields: [q('q-access', 'multi', 'Что уже работает', { options: op(['Вход в Ортус', 'Рабочая почта', 'Пропуск']) }), q('q-mentor', 'person', 'Наставник', R)] }, { title: 'Инструктаж', fields: [q('q-brief', 'bool', 'Инструктаж по технике безопасности пройден', R), q('q-brief-date', 'date', 'Дата инструктажа', { ...R, showIf: iff('q-brief', 'да') }), q('q-ask', 'longtext', 'Вопросы и пожелания')] }] },
  { id: 'tpl-quiz', cat: 'quiz', name: 'Тест знаний с баллами', icon: 'quiz', module: null, settings: { quiz: true, passScore: 4, showScore: true }, pages: [{ title: 'Осмотр машины', fields: [q('q-q1', 'choice', 'Что делать, если перед рейсом найден дефект?', { ...R, options: op([['Выехать и сообщить после рейса', 0], ['Отметить дефект в осмотре и сообщить менеджеру', 1], ['Ничего, если дефект мелкий', 0]]) }), q('q-q2', 'choice', 'Кто решает, выпускать ли машину с дефектом?', { ...R, options: op([['Водитель', 0], ['Менеджер логистики', 1], ['Механик подрядчика', 0]]) }), q('q-q3', 'multi', 'Что обязательно фотографировать при осмотре?', { ...R, options: op([['Четыре стороны машины', 1], ['Одометр', 1], ['Салон изнутри', 0]]) })] }, { title: 'Документы', fields: [q('q-q4', 'choice', 'Как исправить ошибку в уже принятом ответе?', { ...R, options: op([['Удалить ответ', 0], ['Попросить исправление — появится ревизия', 1]]) })] }] },
  { id: 'tpl-insp', cat: 'industry', name: 'Круговой осмотр машины', icon: 'local_shipping', module: 'logistics', pages: [{ title: 'Фото', fields: [q('q-photos', 'photo', 'Фото: спереди, сзади, слева, справа, одометр', { ...R, accept: 'photo', maxFiles: 5, maxMb: 20 })] }, { title: 'Показания', fields: [q('q-odo', 'int', 'Пробег по одометру, км', R), q('q-fuel', 'choice', 'Уровень топлива', { ...R, options: op(['¼', '½', '¾', 'Полный']) })] }, { title: 'Проверка', fields: [q('q-checks', 'multi', 'Чек-лист', { ...R, options: op(['Кузов', 'Шины', 'Свет', 'Документы']) }), q('q-defect', 'bool', 'Есть дефекты?', R), q('q-defect-text', 'longtext', 'Описание дефекта', { ...R, showIf: iff('q-defect', 'да') }), q('q-defect-photo', 'photo', 'Фото дефекта', { ...R, accept: 'photo', maxFiles: 3, maxMb: 20, showIf: iff('q-defect', 'да') })] }] },
  { id: 'tpl-foreman', cat: 'industry', name: 'Ежедневный отчёт прораба', icon: 'construction', module: 'repair', pages: [{ title: 'Работы', fields: [q('q-object', 'ref', 'Объект', { ...R, refKind: 'object' }), q('q-done', 'longtext', 'Что сделано за день', R), q('q-volume', 'number', 'Выполненный объём', R), q('q-crew', 'person', 'Кто был на объекте', R)] }, { title: 'Фото и простой', fields: [q('q-photo', 'photo', 'Фото до и после', { ...R, accept: 'photo', maxFiles: 10, maxMb: 20 }), q('q-stop', 'bool', 'Был простой или замечания?', R), q('q-stop-why', 'longtext', 'Причина и что нужно от офиса', { ...R, showIf: iff('q-stop', 'да') })] }] },
  { id: 'tpl-spa', cat: 'industry', name: 'Анкета клиента перед процедурой', icon: 'spa', module: 'spa', pages: [{ title: 'Клиент', fields: [q('q-name', 'text', 'Имя и фамилия', R), q('q-phone', 'phone', 'Телефон', R)] }, { title: 'Здоровье', fields: [q('q-contra', 'bool', 'Есть противопоказания: давление, беременность, кожные заболевания?', R), q('q-contra-text', 'longtext', 'Уточните противопоказания', { ...R, showIf: iff('q-contra', 'да') }), q('q-allergy', 'text', 'Аллергия на масла или косметику'), q('q-consent', 'bool', 'Согласие на обработку персональных данных', R)] }] },
];
// Черновик формы из шаблона: { pages: [{ id, title }], fields: [{ …, page, section }] }.
export const templateDef = (T) => { const pages = [], fields = []; (T ? T.pages : [{ title: 'Страница 1', fields: [] }]).forEach((p, i) => { const id = 'p' + (i + 1); pages.push({ id, title: p.title }); p.fields.forEach((x) => fields.push({ ...JSON.parse(JSON.stringify(x)), page: id, section: p.title })); }); return { pages, fields }; };

// Данные ответа для записи в Базу знаний: служебные значения и ответы на вопросы. Файлы не копируются — в ячейке ссылка на ответ.
export const FORM_VARS = [['$at', 'Дата и время ответа'], ['$author', 'Автор ответа'], ['$object', 'Объект CRM'], ['$id', 'Номер ответа'], ['$form', 'Название формы'], ['$ver', 'Версия формы']];
export const formVal = (f, r, src, fields) => {
  const S = { $at: r.at, $author: r.author, $object: r.object, $id: r.id, $form: f && f.name, $ver: 'v' + r.version };
  if (src in S) return String(S[src] == null ? '' : S[src]);
  const v = (r.values || {})[src], x = (fields || []).find((q) => q.id === src);
  if (v == null || v === '') return '';
  if (x && x.type === 'photo') return String(v) + ' · файлы в ответе ' + r.id;
  return (Array.isArray(v) ? v.join(', ') : String(v)).slice(0, 500);
};

export const REASON = {
  module_off: { label: 'Модуль не подключён', icon: 'extension_off', tone: 'neutral', text: 'Модуль не подключён организацией. Подключить его может владелец бизнеса.' },
  module_readonly: { label: 'Модуль отключён · только чтение', icon: 'history', tone: 'neutral', text: 'Модуль отключён. История доступна для чтения, новые операции закрыты.' },
  no_permission: { label: 'Нет права', icon: 'lock', tone: 'warn', text: 'Ни одна роль сотрудника не разрешает это действие.' },
  no_scope: { label: 'Нет доступа к объекту', icon: 'visibility_off', tone: 'warn', text: 'Право есть, но объект находится вне области назначения.' },
  driver_block: { label: 'Запрещено функцией «Водитель»', icon: 'block', tone: 'danger', text: 'Действующая функция «Водитель» запрещает начисления через любую роль и группу.' },
};

export const VEHICLE_STATE = {
  free: { label: 'Свободна', tone: 'ok', icon: 'check_circle' },
  reserved: { label: 'Забронирована', tone: 'info', icon: 'event_available' },
  on_route: { label: 'На маршруте', tone: 'info', icon: 'route' },
  review: { label: 'Проверяется', tone: 'warn', icon: 'pending' },
  unavailable: { label: 'Недоступна', tone: 'danger', icon: 'block' },
};

export const TRIP_STATE = {
  planned: { label: 'Запланирован', tone: 'neutral', icon: 'event' },
  assigned: { label: 'Машина назначена', tone: 'info', icon: 'event_available' },
  inspection: { label: 'Осмотр перед выездом', tone: 'info', icon: 'fact_check' },
  defect_review: { label: 'Дефект на проверке', tone: 'danger', icon: 'report' },
  on_route: { label: 'В рейсе', tone: 'info', icon: 'route' },
  returning: { label: 'Сдача машины', tone: 'info', icon: 'assignment_return' },
  submitted: { label: 'Ожидает приёмки', tone: 'warn', icon: 'pending' },
  rework: { label: 'На доработке', tone: 'warn', icon: 'undo' },
  accepted: { label: 'Принят', tone: 'ok', icon: 'verified' },
};

export const MEMBER_STATE = {
  active: { label: 'Активен', tone: 'ok', icon: 'check_circle' },
  invited: { label: 'Приглашён', tone: 'warn', icon: 'schedule' },
  blocked: { label: 'Заблокирован', tone: 'danger', icon: 'block' },
};

export const TENANT_STATE = {
  trial: { label: 'Пробный период', tone: 'info', icon: 'hourglass_top' },
  active: { label: 'Действует', tone: 'ok', icon: 'check_circle' },
  restricted: { label: 'Ограничен', tone: 'warn', icon: 'lock_clock' },
  suspended: { label: 'Приостановлен', tone: 'danger', icon: 'pause_circle' },
};

export const PHOTO_SIDES = [['front', 'Спереди'], ['back', 'Сзади'], ['left', 'Слева'], ['right', 'Справа'], ['odo', 'Одометр']];
export const DEP_CHECKS = [['body', 'Кузов и стёкла осмотрены'], ['tires', 'Шины и световые приборы исправны'], ['docs', 'Документы и комплект на месте']];
export const RET_CHECKS = [['cargo', 'Груз выгружен полностью'], ['personal', 'Личные вещи забраны'], ['keys', 'Ключи и документы на месте']];
export const DEFECT_ZONES = ['Кузов', 'Стёкла', 'Шины и колёса', 'Световые приборы', 'Салон', 'Грузовой отсек', 'Тормоза и ходовая'];
export const FUEL = [['q', '¼'], ['h', '½'], ['tq', '¾'], ['f', 'Полный']];
export const EXPENSE_CAT = { fuel: { label: 'Топливо', icon: 'local_gas_station' }, wash: { label: 'Мойка', icon: 'local_car_wash' } };
export const TASK_STATUSES = ['Новая', 'В работе', 'На проверке', 'Готово'];
export const TASK_FLOW = { 'Новая': ['В работе', 'Отменена'], 'В работе': ['На проверке', 'Новая'], 'На проверке': ['Готово', 'В работе'], 'Готово': ['В работе'], 'Отменена': ['Новая'] };
const toneSafe = (o) => new Proxy(o, { get: (t, k) => (typeof k !== 'string' || k in t ? t[k] : ['info', 'pending']) });
export const TASK_TONE = toneSafe({ 'Новая': ['neutral', 'radio_button_unchecked'], 'В работе': ['info', 'pending'], 'На проверке': ['warn', 'rate_review'], 'Готово': ['ok', 'check_circle'], 'Отменена': ['neutral', 'block'] });
// Процессы проектов модуля «Задачи». «Заявки» — тот же движок задач с этапами воронки (docs/19-construction.md).
export const WORKFLOWS = {
  tasks: { statuses: TASK_STATUSES, flow: TASK_FLOW, tone: TASK_TONE, item: 'задача', items: 'Задачи', done: 'Готово' },
  leads: {
    statuses: ['Новая', 'Замер', 'Смета', 'Договор', 'Объект'],
    flow: { 'Новая': ['Замер', 'Отказ'], 'Замер': ['Смета', 'Отказ'], 'Смета': ['Договор', 'Замер', 'Отказ'], 'Договор': ['Объект', 'Смета', 'Отказ'], 'Объект': [], 'Отказ': ['Новая'] },
    tone: { 'Новая': ['neutral', 'radio_button_unchecked'], 'Замер': ['info', 'straighten'], 'Смета': ['warn', 'request_quote'], 'Договор': ['warn', 'contract'], 'Объект': ['ok', 'apartment'], 'Отказ': ['neutral', 'block'] },
    item: 'заявка', items: 'Заявки', done: 'Объект',
  },
};
export const wfOf = (db, t) => WORKFLOWS[(db.projects || []).find((p) => p.id === t.project)?.flow || 'tasks'];
// ── Проекты задач: доступ через роли с областью «проект», процесс с переходами и согласованием (docs/21) ──
export const PROJECT_ROLES = ['r-pm', 'r-approver', 'r-exec', 'r-viewer'];
export const VERB_LABEL = { view: 'Читать', create: 'Создавать', edit: 'Менять статус', review: 'Согласовывать', settings: 'Настраивать' };
export const WHO_LABEL = { 'r-pm': 'руководитель проекта', 'r-approver': 'согласующий', 'r-exec': 'исполнитель по роли', assignee: 'исполнитель задачи', author: 'автор задачи' };
const WHO_VERB = { 'r-pm': 'settings', 'r-approver': 'review', 'r-exec': 'edit' };
export const STATUS_CAT = { todo: ['К выполнению', '#ECEFEA', '#3A4844', '#B7C0B4'], progress: ['В работе', '#E7EEF6', '#2B5479', '#9DB7D1'], done: ['Готово', '#E3EFE7', '#1F6B52', '#9CC3AE'] };
export function buildWf(kind) {
  const statuses = [{ id: 's1', name: 'Новая', cat: 'todo' }, { id: 's2', name: 'В работе', cat: 'progress' }, { id: 's3', name: 'На проверке', cat: 'progress' }, { id: 's4', name: 'Готово', cat: 'done' }, { id: 's5', name: 'Отменена', cat: 'done' }];
  const tr = (id, name, from, to, o = {}) => ({ id, name, from, to, who: [], notAuthor: false, approval: null, comment: false, checklist: false, assignAuthor: false, ...o });
  const transitions = [tr('t1', 'Взять в работу', ['s1'], 's2'), tr('t2', 'На проверку', ['s2'], 's3'),
    kind === 'approval' ? tr('t3', 'Согласовать', ['s3'], 's4', { notAuthor: true, approval: { mode: 'any', rejectTo: 's2' }, checklist: true, children: true, assignAuthor: true }) : tr('t3', 'Принять', ['s3'], 's4', { who: ['r-pm'], checklist: true, children: true }),
    ...(kind === 'approval' ? [] : [tr('t4', 'Вернуть на доработку', ['s3'], 's2', { who: ['r-pm'], comment: true })]),
    tr('t5', 'Отменить', ['*'], 's5', { who: ['r-pm'], comment: true })];
  return { v: 1, statuses, transitions };
}
export function projAccess(db, p, memberId) {
  const gs = grants(db, memberId);
  if (gs.some((g) => g.roleObj.all)) return { owner: true, verbs: ['view', 'create', 'edit', 'review', 'settings'], via: 'Системная роль, вся организация', inherited: true, roleName: 'Владелец бизнеса' };
  const own = gs.find((g) => g.scope && g.scope.type === 'project' && g.scope.id === p.id);
  if (own) return { verbs: own.roleObj.actions?.tasks || [], via: own.via ? 'Назначен через ' + own.via : 'Назначен в проекте', inherited: false, role: own.roleObj.id, roleName: own.roleObj.name, aid: own.id };
  if (p.access === 'closed') return null;
  const inh = gs.filter((g) => g.scope && !['project', 'self'].includes(g.scope.type) && scopeCovers(db, g.scope, p.unit) && (g.roleObj.actions?.tasks || []).length);
  if (!inh.length) return null;
  const all = [...new Set(inh.flatMap((g) => g.roleObj.actions.tasks))], verbs = p.access === 'open' ? all : all.filter((v) => v === 'view');
  const u = inh[0].scope.id ? unit(db, inh[0].scope.id) : null;
  return { verbs, via: 'Наследуется: «' + inh[0].roleObj.name + '»' + (u ? ' в «' + u.name + '»' : ''), inherited: true, roleName: inh[0].roleObj.name };
}
export function projCan(db, p, memberId, verb) {
  const m = db.members.find((x) => x.id === memberId);
  if (!m || m.status === 'blocked') return { ok: false, why: 'сотрудник заблокирован' };
  const a = projAccess(db, p, memberId);
  if (!a) return { ok: false, why: p.access === 'closed' ? 'закрытый проект — нужна роль в самом проекте' : 'нет роли с правом «Задачи» в области проекта' };
  if (a.verbs.includes(verb)) return { ok: true, a };
  return { ok: false, a, why: 'роль «' + a.roleName + '» не даёт «' + (VERB_LABEL[verb] || verb) + '»' + (a.inherited && p.access === 'limited' ? ': в ограниченном проекте унаследованный доступ — только чтение' : '') };
}
export const childrenOf = (db, t) => db.tasks.filter((x) => x.parent === t.id);
export const isDone = (db, t) => { const p = (db.projects || []).find((x) => x.id === t.project), st = p && p.wf && p.wf.statuses.find((s) => s.name === t.status); return st ? st.cat === 'done' : ['Готово', 'Объект', 'Отказ', 'Отменена'].includes(t.status); };
export const approversOf = (db, p, t, tr) => db.members.filter((m) => m.status === 'active' && projCan(db, p, m.id, 'review').ok && !(tr.notAuthor && t.authorId === m.id));
export function trCheck(db, p, t, memberId, tr) {
  const wf = p.wf, st = wf && wf.statuses.find((s) => s.name === t.status), m = db.members.find((x) => x.id === memberId);
  if (!st || !(tr.from.includes('*') ? !tr.from.includes(tr.to) && st.id !== tr.to : tr.from.includes(st.id))) return { ok: false, hide: true };
  if (tr.approval) {
    const c = projCan(db, p, memberId, 'review'); if (!c.ok) return { ok: false, why: 'Согласует роль с правом «Согласовывать»; у вас ' + c.why };
    if (tr.notAuthor && t.authorId === memberId) return { ok: false, why: 'Вы автор задачи — свою согласовать нельзя' };
    if ((t.approval?.votes || []).some((v) => v.by === memberId && v.tr === tr.id)) return { ok: false, why: 'Вы уже согласовали, ждём остальных' };
    if (tr.checklist && (t.checklist || []).some((x) => !x.d)) return { ok: false, why: 'Сначала закройте чек-лист' }; if (tr.children) { const open = childrenOf(db, t).filter((x) => !isDone(db, x)); if (open.length) return { ok: false, why: 'Сначала завершите подзадачи: ' + open.map((x) => x.id).join(', ') }; }
    return { ok: true };
  }
  const c = projCan(db, p, memberId, 'edit'); if (!c.ok) return { ok: false, why: 'Менять статус нельзя: ' + c.why };
  const who = tr.who || [];
  if (who.length && !c.a.owner && !who.some((w) => (w === 'assignee' ? m && t.assignee === m.name : w === 'author' ? t.authorId === memberId : c.a.verbs.includes(WHO_VERB[w])))) return { ok: false, why: 'Доступно: ' + who.map((w) => WHO_LABEL[w] || w).join(', ') };
  if (tr.notAuthor && t.authorId === memberId) return { ok: false, why: 'Автор задачи не может выполнить этот переход' };
  if (tr.checklist && (t.checklist || []).some((x) => !x.d)) return { ok: false, why: 'Сначала закройте чек-лист' }; if (tr.children) { const open = childrenOf(db, t).filter((x) => !isDone(db, x)); if (open.length) return { ok: false, why: 'Сначала завершите подзадачи: ' + open.map((x) => x.id).join(', ') }; }
  return { ok: true };
}

export const PRIORITY = { urgent: ['Срочно', 'danger', 'priority_high'], high: ['Высокий', 'warn', 'keyboard_double_arrow_up'], normal: ['Обычный', 'neutral', 'remove'], low: ['Низкий', 'neutral', 'keyboard_arrow_down'] };

export const num = (n) => String(n).replace('.', ',');
export const int = (n) => Number(n).toLocaleString('ru-RU');
export const rub = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
export function plural(n, a, b, c) { const m = n % 10, h = n % 100; if (m === 1 && h !== 11) return a; if (m >= 2 && m <= 4 && (h < 10 || h >= 20)) return b; return c; }

export const unit = (db, id) => db.units.find((u) => u.id === id);
export function unitLabel(db, id) {
  const u = unit(db, id); if (!u) return '—';
  if (u.type === 'region') return u.name;
  return unit(db, u.parent).name + ' / ' + u.name;
}
export const firmsOf = (db, regionId) => db.units.filter((u) => u.type === 'firm' && (!regionId || u.parent === regionId));

export function scopeCovers(db, scope, unitId) {
  if (!scope) return false;
  if (scope.type === 'tenant') return true;
  const u = unit(db, unitId); if (!u) return false;
  if (scope.type === 'region') return u.id === scope.id || u.parent === scope.id;
  if (scope.type === 'firm') return u.id === scope.id;
  return false;
}
export function scopeLabel(db, scope) {
  if (!scope) return 'Область не выбрана';
  if (scope.type === 'tenant') return 'Вся организация';
  if (scope.type === 'region') return 'Регион ' + unit(db, scope.id).name;
  if (scope.type === 'firm') return unitLabel(db, scope.id);
  if (scope.type === 'project') {
    const p = (db.projects || []).find((x) => x.id === scope.id), d = (db.service?.directions || []).find((x) => x.project === scope.id);
    if (p) return 'Проект «' + p.name + '»';
    if (d) return 'Направление «' + d.name + '»';
  }
  if (scope.type === 'program') { const P = { 'pg-drivers': 'Водители · Север Логистик' }; return 'Программа «' + (P[scope.id] || scope.id) + '»'; }
  if (scope.type === 'space') { const s = (db.knowledge?.spaces || []).find((x) => x.id === scope.id); return 'Пространство «' + (s ? s.name : scope.id) + '»'; }
  if (scope.type === 'page') { const p = (db.knowledge?.pages || []).find((x) => x.id === scope.id); return 'Страница «' + (p ? p.title : scope.id) + '»'; }
  if (scope.type === 'folder') { const f = (db.docs?.folders || []).find((x) => x.id === scope.id); return 'Папка «' + (f ? f.name : scope.id) + '»'; }
  if (scope.type === 'chat') { const c = (db.chats?.items || []).find((x) => x.id === scope.id); return 'Чат «' + (c ? c.title || 'личный' : scope.id) + '»'; }
  if (scope.type === 'doc') { const d = (db.docs?.items || []).find((x) => x.id === scope.id); return 'Документ «' + (d ? d.title : scope.id) + '»'; }
  if (scope.type === 'account') { const a = (db.cash?.accounts || []).find((x) => x.id === scope.id); return 'Касса «' + (a ? a.name : scope.id) + '»'; }
  return 'Только назначенное лично';
}

export const moduleOn = (db, key) => !isIndustry(key) || !!db.modules[key]?.enabled;

export function grants(db, memberId) {
  return db.assignments.filter((a) => a.member === memberId)
    .map((a) => ({ ...a, roleObj: db.roles.find((r) => r.id === a.role) }))
    .filter((g) => g.roleObj);
}

/** Эффективное право: модуль подключён → действие разрешено ролью → объект в области. */
export function can(db, memberId, mod, verb, unitId) {
  if (!moduleOn(db, mod)) return { ok: false, reason: db.modules[mod]?.history ? 'module_readonly' : 'module_off' };
  const gs = grants(db, memberId).filter((g) => g.roleObj.all || (g.roleObj.actions?.[mod] || []).includes(verb));
  if (!gs.length) return { ok: false, reason: 'no_permission' };
  if (unitId) {
    const g = gs.find((x) => scopeCovers(db, x.scope, unitId));
    return g ? { ok: true, via: g } : { ok: false, reason: 'no_scope' };
  }
  return { ok: true, via: gs[0] };
}

/** Начисления: функция «Водитель» блокирует независимо от ролей и групп. */
export function canEarnings(db, memberId, unitId) {
  const m = db.members.find((x) => x.id === memberId);
  if (!m) return { ok: false, reason: 'no_permission' };
  if (m.function === 'driver') return { ok: false, reason: 'driver_block' };
  const gs = grants(db, memberId).filter((g) => g.roleObj.all || g.roleObj.finance?.read);
  if (!gs.length) return { ok: false, reason: 'no_permission' };
  if (unitId && !gs.some((g) => scopeCovers(db, g.scope, unitId))) return { ok: false, reason: 'no_scope' };
  return { ok: true };
}

export function rolePermKeys(role) {
  if (role.all) return ['*'];
  const out = [];
  for (const [mod, verbs] of Object.entries(role.actions || {})) {
    const def = ALL_MODULES[mod]; if (!def?.perms) continue;
    verbs.forEach((v) => (def.perms[v] || []).forEach((p) => out.push(p)));
  }
  if (role.finance?.read) out.push('fleet.earnings.read');
  if (role.finance?.manage) out.push('fleet.earnings.manage');
  if ((role.actions?.cash || []).length && role.cash?.balance) out.push('cash.balance.read');
  if ((role.actions?.cash || []).length && role.cash?.self) out.push('cash.advance.self');
  return out;
}

/** Совместимость машины с грузом рейса. Сумма объёма и массы — не 3D-укладка. */
export function compat(v, trip) {
  const c = trip.cargo;
  const avail = v.state === 'free' || v.heldBy === trip.id;
  const checks = [
    { key: 'avail', label: 'Доступность', icon: VEHICLE_STATE[v.state].icon, ok: avail, value: v.heldBy === trip.id ? 'Назначена на этот рейс' : VEHICLE_STATE[v.state].label + (v.note ? ' · ' + v.note : '') },
    { key: 'payload', label: 'Грузоподъёмность', icon: 'scale', ok: v.payloadT >= c.weightT, value: num(v.payloadT) + ' т', need: 'от ' + num(c.weightT) + ' т' },
    { key: 'volume', label: 'Объём', icon: 'deployed_code', ok: v.volumeM3 >= c.volumeM3, value: num(v.volumeM3) + ' м³', need: 'от ' + num(c.volumeM3) + ' м³' },
    { key: 'length', label: 'Длина кузова', icon: 'straighten', ok: v.lengthM >= c.lengthM, value: num(v.lengthM) + ' м', need: 'от ' + num(c.lengthM) + ' м' },
  ];
  if (c.temp) {
    const ok = !!v.temp && v.temp[0] <= c.temp[0] && v.temp[1] >= c.temp[1];
    checks.push({ key: 'temp', label: 'Температура', icon: 'thermostat', ok, value: v.temp ? tempLabel(v.temp) : 'без охлаждения', need: tempLabel(c.temp) });
  } else {
    checks.push({ key: 'temp', label: 'Температура', icon: 'thermostat', ok: true, value: 'не требуется' });
  }
  const fit = checks.slice(1).every((x) => x.ok);
  return { fit, ok: fit && avail, checks, reasons: checks.filter((x) => !x.ok).map((x) => x.label + ': ' + x.value + (x.need ? ', нужно ' + x.need : '')) };
}
export const tempLabel = (t) => (t[0] > 0 ? '+' : '') + t[0] + '…' + (t[1] > 0 ? '+' : '') + t[1] + ' °C';

/** Загрузка после каждой остановки: объём и масса отдельно. */
export function legs(trip, v) {
  let w = 0, vol = 0;
  return trip.stops.map((s) => {
    const sign = s.op === 'load' ? 1 : -1;
    w = Math.max(0, Math.round((w + sign * s.w) * 100) / 100);
    vol = Math.max(0, Math.round((vol + sign * s.v) * 100) / 100);
    return { ...s, wAfter: w, vAfter: vol, wPct: v ? Math.round((w / v.payloadT) * 100) : null, vPct: v ? Math.round((vol / v.volumeM3) * 100) : null };
  });
}

export function inspMissing(d, kind, minOdo) {
  const miss = [];
  const ready = PHOTO_SIDES.filter(([k]) => d.photos[k]?.state === 'ready').length;
  const queued = PHOTO_SIDES.filter(([k]) => d.photos[k]?.state === 'queued').length;
  if (ready + queued < 5) miss.push((5 - ready - queued) + ' фото');
  const odo = Number(String(d.odometer).replace(/\s/g, ''));
  if (d.odometer === '' || !Number.isFinite(odo)) miss.push('пробег');
  else if (odo < minOdo) miss.push('пробег не меньше ' + int(minOdo) + ' км');
  if (!d.fuel) miss.push('уровень топлива');
  const list = kind === 'dep' ? DEP_CHECKS : RET_CHECKS;
  const c = list.filter(([k]) => !d.checks[k]).length;
  if (c) miss.push(c + ' ' + plural(c, 'пункт', 'пункта', 'пунктов') + ' чек-листа');
  return miss;
}

export function odoError(value, minOdo) {
  if (value === '') return null;
  const n = Number(String(value).replace(/\s/g, ''));
  if (!Number.isFinite(n)) return 'Введите число';
  if (n < minOdo) return 'Пробег не может быть меньше ' + int(minOdo) + ' км';
  if (n > minOdo + 3000) return 'Больше начального на ' + int(n - minOdo) + ' км — проверьте показания';
  return null;
}

export function validateExpense(e) {
  const err = {};
  const a = Number(String(e.amount).replace(',', '.').replace(/\s/g, ''));
  if (e.amount === '' || e.amount == null) err.amount = 'Укажите сумму';
  else if (!Number.isFinite(a)) err.amount = 'Сумма должна быть числом';
  else if (a <= 0) err.amount = 'Сумма должна быть больше нуля';
  else if (a > 200000) err.amount = 'Больше 200 000 ₽ — проверьте сумму';
  if (!e.date) err.date = 'Укажите дату';
  if (e.receipt?.state === 'uploading') err.receipt = 'Дождитесь окончания загрузки чека';
  else if (!e.receipt || !['ready', 'queued'].includes(e.receipt.state)) err.receipt = 'Добавьте фото чека';
  return err;
}

// Календарь: занятость = [начало − подготовка, конец + уборка] по каждому ресурсу брони.
export const busySpan = (b) => [b.start - (b.prep || 0), b.end + (b.clean || 0)];
export function bookingConflicts(bookings, cand, resources) {
  const [a0, a1] = busySpan(cand);
  const out = [];
  bookings.forEach((b) => {
    if (b.id === cand.id) return;
    const [b0, b1] = busySpan(b);
    if (a0 < b1 && b0 < a1) b.res.filter((r) => cand.res.includes(r)).forEach((r) => out.push({ res: r, resName: (resources || []).find((x) => x.id === r)?.name || r, title: b.title }));
  });
  return out;
}
export function freeSlots(bookings, b, n, from = 8, to = 20) {
  const dur = b.end - b.start; const out = [];
  for (let t = from + (b.prep || 0); t + dur + (b.clean || 0) <= to && out.length < n; t += 0.25) {
    if (t === b.start) continue;
    if (!bookingConflicts(bookings, { ...b, start: t, end: t + dur }).length) out.push(t);
  }
  return out;
}
export const hm = (t) => String(Math.floor(t)).padStart(2, '0') + ':' + String(Math.round((t % 1) * 60)).padStart(2, '0');

export const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
export const initials = (name) => name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
