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
  forms: { name: 'Формы', icon: 'dynamic_form', perms: { view: ['forms.read'], create: ['forms.responses.create'], review: ['forms.responses.review'], settings: ['forms.publish'] } },
  data: { name: 'Данные', icon: 'table_view', perms: { view: ['data.read'], export: ['data.export'] } },
  files: { name: 'Файлы', icon: 'folder_open', perms: { view: ['files.read'], create: ['files.upload'] } },
  inventory: { name: 'Склад и материалы', icon: 'inventory_2', perms: { view: ['inventory.read'], create: ['inventory.movements.post'] } },
  cash: { name: 'Внутренняя касса', icon: 'account_balance_wallet', perms: { view: ['cash.read'], create: ['cash.operations.create'] } },
  notifications: { name: 'Уведомления', icon: 'notifications', perms: null },
};

export const ALL_MODULES = { ...INDUSTRY, ...CORE };
export const isIndustry = (k) => Object.prototype.hasOwnProperty.call(INDUSTRY, k);

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
export const TASK_TONE = { 'Новая': ['neutral', 'radio_button_unchecked'], 'В работе': ['info', 'pending'], 'На проверке': ['warn', 'rate_review'], 'Готово': ['ok', 'check_circle'], 'Отменена': ['neutral', 'block'] };
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
