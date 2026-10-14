// Обращения клиентов по направлениям (docs/22-client-requests.md).
// Данные демо, расчёт сроков в рабочем времени направления, команды mock-адаптера и ответ сервера для участника.

const T0 = Date.now();
// «Сейчас» в демо: 1 октября 2026, 16:24, дальше часы идут в реальном времени.
export const SVC_BASE = new Date(2026, 9, 1, 16, 24).getTime();
export const svcNow = () => SVC_BASE + (Date.now() - T0);

const DAY = 86400000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const ts = (day, mon, h, m) => new Date(2026, mon - 1, day, h, m).getTime();
const dayStart = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const nextDay = (d0) => { const d = new Date(d0); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };
const dow = (ms) => (new Date(ms).getDay() + 6) % 7;
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const p2 = (n) => String(n).padStart(2, '0');

/** Конец срока: start + mins рабочих минут по календарю направления. */
export function addWork(start, mins, cal) {
  let t = start, left = mins;
  for (let i = 0; i < 500; i++) {
    const d0 = dayStart(t), open = d0 + cal.from * 60000, close = d0 + cal.to * 60000;
    if (cal.days.includes(dow(d0)) && t < close) {
      const s = Math.max(t, open), avail = (close - s) / 60000;
      if (avail >= left) return s + left * 60000;
      left -= avail;
    }
    t = nextDay(d0);
  }
  return t;
}
/** Рабочие минуты между a и b. */
export function workBetween(a, b, cal) {
  if (b <= a) return 0;
  let t = a, sum = 0;
  for (let i = 0; i < 500 && t < b; i++) {
    const d0 = dayStart(t), open = d0 + cal.from * 60000, close = d0 + cal.to * 60000;
    if (cal.days.includes(dow(d0))) { const s = Math.max(t, open), e = Math.min(b, close); if (e > s) sum += (e - s) / 60000; }
    t = nextDay(d0);
  }
  return Math.round(sum);
}

export const hm = (ms) => { const d = new Date(ms); return d.getHours() + ':' + p2(d.getMinutes()); };
export const dayLabel = (ms) => { const d = new Date(ms); return d.getDate() + ' ' + MON[d.getMonth()]; };
export function when(ms, now) {
  const a = dayStart(ms), b = dayStart(now);
  if (a === b) return 'сегодня, ' + hm(ms);
  if (nextDay(a) === b) return 'вчера, ' + hm(ms);
  return dayLabel(ms) + ', ' + hm(ms);
}
const dueText = (ms, now) => (dayStart(ms) === dayStart(now) ? hm(ms) : dayLabel(ms) + (ms - now < 3 * DAY ? ', ' + hm(ms) : ''));
/** Длительность в рабочем времени: «48 мин», «3 ч 40 мин», «9 раб. дней». */
export function dur(mins, cal) {
  mins = Math.max(0, Math.round(mins));
  const perDay = cal ? cal.to - cal.from : 1440;
  if (mins < 60) return mins + ' мин';
  if (mins < perDay) { const h = Math.floor(mins / 60), m = mins % 60; return h + ' ч' + (m ? ' ' + m + ' мин' : ''); }
  const d = Math.floor(mins / perDay);
  return d + ' ' + (cal && cal.days.length < 7 ? 'раб. ' : '') + plural(d, 'день', 'дня', 'дней');
}
const span = (mins) => { mins = Math.round(mins); if (mins < 60) return mins + ' мин'; if (mins < 1440) { const h = Math.floor(mins / 60), m = mins % 60; return h + ' ч' + (m ? ' ' + m + ' мин' : ''); } const d = Math.floor(mins / 1440); return d + ' ' + plural(d, 'день', 'дня', 'дней'); };
export const maskPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length < 4 ? '•••' : '+7 ••• •••-••-' + d.slice(-2); };

export const SVC_ST = {
  new: { label: 'Новое', client: 'Получили', tone: 'info', icon: 'radio_button_unchecked' },
  work: { label: 'В работе', client: 'Отвечаем', tone: 'neutral', icon: 'pending' },
  wait: { label: 'Ждёт клиента', client: 'Ждём вашего ответа', tone: 'warn', icon: 'hourglass_top' },
  resolved: { label: 'Решено', client: 'Решено', tone: 'ok', icon: 'check_circle' },
  closed: { label: 'Закрыто', client: 'Закрыто', tone: 'neutral', icon: 'lock' },
};
export const SVC_FLOW = { new: ['work', 'wait', 'resolved'], work: ['wait', 'resolved'], wait: ['work', 'resolved'], resolved: ['work', 'closed'], closed: [] };
export const SVC_KIND = {
  complaint: { label: 'Жалоба', icon: 'report' },
  claim: { label: 'Претензия', icon: 'gavel' },
  question: { label: 'Вопрос', icon: 'help' },
  idea: { label: 'Предложение', icon: 'lightbulb' },
  thanks: { label: 'Благодарность', icon: 'favorite' },
  warranty: { label: 'Гарантийный случай', icon: 'verified_user' },
  cargo: { label: 'Повреждение или недостача груза', icon: 'inventory_2' },
};
export const SVC_CH = { sms: ['SMS', 'sms'], bot: ['Бот в Telegram', 'smart_toy'], cabinet: ['Кабинет заказчика', 'home_work'], widget: ['Виджет на сайте', 'web'], phone: ['Звонок', 'call'], qr: ['QR в салоне', 'qr_code_2'] };
export const SVC_PRIO = { low: 'Низкий', normal: 'Средний', high: 'Высокий' };
export const OUTCOMES = ['Устранено', 'Разъяснено', 'Компенсация', 'Не подтвердилось', 'Дубль'];
export const OUTCOMES_ABOUT = ['Подтвердилась', 'Не подтвердилась'];
export const COMPENSATIONS = ['Скидка 20% на следующий визит', 'Скидка 10% на следующую работу', 'Бесплатное повторное посещение', 'Возврат денег — через кассу'];

/** Сроки обращения для экрана: первый ответ, решение, срок по закону. */
export function slaOf(r, d, now) {
  const out = [], paused = r.status === 'wait';
  const one = (key, label, x) => {
    if (!x) return;
    const legal = key === 'legal';
    if (x.stopped) { out.push({ key, label, state: 'done', text: key === 'first' ? 'ответ за ' + dur(workBetween(r.at, x.stopped, d.cal), d.cal) : 'выполнено', until: x.stopped > x.due ? 'с нарушением срока' : 'в срок' }); return; }
    if (paused && !legal) { out.push({ key, label, state: 'pause', text: 'на паузе', until: 'ждём клиента' }); return; }
    if (now > x.due) { const over = (now - x.due) / 60000; out.push({ key, label, state: 'late', text: 'просрочен на ' + span(over), until: 'был до ' + dueText(x.due, now), over }); return; }
    const left = legal ? Math.max(0, Math.ceil((x.due - now) / DAY)) : workBetween(now, x.due, d.cal);
    const risk = legal ? left <= 2 : left <= Math.max(20, x.goal * 0.25);
    out.push({ key, label, state: risk ? 'risk' : legal ? 'legal' : 'norm', text: 'осталось ' + (legal ? left + ' ' + plural(left, 'день', 'дня', 'дней') : dur(left, d.cal)), until: 'до ' + dueText(x.due, now), left: legal ? left * 1440 : left });
  };
  one('first', 'Первый ответ', r.sla.first);
  one('resolve', 'Решение', r.sla.resolve);
  one('legal', 'Ответ по закону', r.sla.legal);
  return out;
}
/** Главный срок для строки очереди; rank — порядок сортировки (меньше — срочнее). */
export function slaHead(r, d, now) {
  if (['resolved', 'closed'].includes(r.status)) return { state: 'done', label: 'Готово', text: r.outcome || 'решено', until: '', rank: 2e12 - (r.resolvedAt || 0) / 1e3 };
  const all = slaOf(r, d, now);
  if (!all.length) return { state: 'none', label: 'Срок', text: 'без срока', until: '', rank: 1e12 };
  const late = all.filter((x) => x.state === 'late').sort((a, b) => b.over - a.over)[0];
  if (late) return { ...late, rank: -late.over };
  const act = all.filter((x) => ['risk', 'norm', 'legal'].includes(x.state));
  if (r.status === 'wait' || !act.length) {
    const lg = all.find((x) => x.key === 'legal' && x.state !== 'done');
    return { state: 'pause', label: 'Пауза', text: 'ждём клиента', until: lg ? 'по закону ' + lg.until : 'срок стоит', rank: 9e11 };
  }
  const f = act.find((x) => x.key === 'first') || act.slice().sort((a, b) => a.left - b.left)[0];
  return { ...f, rank: f.left };
}

export function serviceSeed() {
  const CAL = {
    spa: { days: [0, 1, 2, 3, 4, 5, 6], from: 600, to: 1260, label: 'ежедневно 10:00–21:00' },
    rep: { days: [0, 1, 2, 3, 4], from: 540, to: 1140, label: 'пн–пт 9:00–19:00' },
    log: { days: [0, 1, 2, 3, 4, 5, 6], from: 480, to: 1200, label: 'ежедневно 8:00–20:00' },
  };
  const directions = [
    { id: 'd-mas', key: 'МАС', name: 'Массаж', color: '#7B3F6E', module: 'Салон и SPA', area: 'Альта SPA', project: 'svc-mas', cal: CAL.spa, lead: 'm-owner', next: 42 },
    { id: 'd-kos', key: 'КОС', name: 'Косметология', color: '#5B4E8C', module: 'Салон и SPA', area: 'Альта SPA', project: 'svc-kos', cal: CAL.spa, lead: 'm-owner', next: 7 },
    { id: 'd-otd', key: 'ОТД', name: 'Отделка', color: '#7A5214', module: 'Ремонт и стройка', area: 'Москва', project: 'svc-otd', cal: CAL.rep, lead: 'm-owner', next: 13 },
    { id: 'd-grz', key: 'ГРЗ', name: 'Грузоперевозки', color: '#2B5479', module: 'Логистика', area: 'Москва, Самара', project: 'svc-grz', cal: CAL.log, lead: 'm-owner', next: 58 },
  ];
  const T = (dir, kind, name, first, resolve, legal) => ({ id: dir + ':' + kind, dir, kind, name, first: first || null, resolve: resolve || null, legal: legal || null });
  const spaTypes = (d) => [T(d, 'complaint', 'Жалоба', 120, 1320), T(d, 'claim', 'Вернуть деньги за услугу', 660, null, 10), T(d, 'question', 'Вопрос', 240, 1980), T(d, 'idea', 'Предложение', 1320), T(d, 'thanks', 'Спасибо мастеру')];
  const types = [
    ...spaTypes('d-mas'), ...spaTypes('d-kos'),
    T('d-otd', 'warranty', 'Гарантийный случай', 240, 6000), T('d-otd', 'claim', 'Претензия по качеству или срокам', 600, null, 10), T('d-otd', 'complaint', 'Жалоба', 120, 1200), T('d-otd', 'question', 'Вопрос по ремонту', 480, 1800), T('d-otd', 'idea', 'Предложение', 1800), T('d-otd', 'thanks', 'Спасибо бригаде'),
    T('d-grz', 'cargo', 'Повреждение или недостача груза', 240, null, 30), T('d-grz', 'complaint', 'Опоздание или жалоба', 120, 1440), T('d-grz', 'question', 'Вопрос по доставке', 120, 2160), T('d-grz', 'idea', 'Предложение', 1440), T('d-grz', 'thanks', 'Спасибо водителю'),
  ];
  const templates = [
    ['Приняли в работу', '{имя}, приняли ваше обращение {номер}. Ответим {срок}.'],
    ['Нужны подробности', '{имя}, чтобы разобраться, уточните, пожалуйста: '],
    ['Извинение и компенсация', '{имя}, извините за неудобство. Мы разобрались, что произошло: . В качестве извинения '],
    ['Решено', '{имя}, вопрос решён: . Если что-то осталось, просто ответьте на это сообщение.'],
  ];
  const sl = (dirId, kind, at, x = {}) => {
    const d = directions.find((y) => y.id === dirId), ty = types.find((y) => y.dir === dirId && y.kind === kind);
    return {
      first: ty.first ? { goal: ty.first, due: addWork(at, ty.first, d.cal), stopped: x.first || null } : null,
      resolve: ty.resolve ? { goal: ty.resolve, due: addWork(at, ty.resolve, d.cal), stopped: x.resolve || null } : null,
      legal: ty.legal ? { days: ty.legal, due: at + ty.legal * DAY, stopped: x.legal || null } : null,
    };
  };
  let n = 1;
  const m = (kind, at, text, x = {}) => ({ id: 'msg' + n++, kind, at, text, ...x });
  const requests = [
    { id: 'r-57', key: 'ГРЗ-57', dir: 'd-grz', kind: 'cargo', title: 'Две коробки помяты, внутри бой', status: 'new', priority: 'high', assignee: null, at: ts(1, 10, 11, 14), channel: 'bot',
      client: { name: 'Наталья Гусева', org: 'ООО «Фермерская лавка»', phone: '+7 916 204-44-12', since: 'Клиент с 2024 года · 23 доставки' },
      link: { label: 'Рейс Р-196 · 27.09', lines: ['Доставлено 27 сентября, 14:40', 'Водитель: Илья Васильев', 'Фото выгрузки: 4'] },
      sla: sl('d-grz', 'cargo', ts(1, 10, 11, 14)), labels: ['бой'], tasks: [],
      messages: [m('client', ts(1, 10, 11, 14), 'Добрый день! В рейсе Р-196 две коробки из 14 пришли помятыми, внутри бой — 6 банок. Фото и акт о расхождении прикладываю.', { by: 'Наталья Гусева', files: ['Фото 1.jpg', 'Фото 2.jpg', 'Акт о расхождении.pdf'] }), m('public', ts(1, 10, 11, 14), 'Наталья, приняли обращение ГРЗ-57. Ответим в течение 4 часов.', { by: 'Автоответ', auto: true })] },
    { id: 'r-41', key: 'МАС-41', dir: 'd-mas', kind: 'complaint', title: 'Начали на 15 минут позже, в кабинете холодно', status: 'new', priority: 'high', assignee: null, at: ts(1, 10, 15, 12), channel: 'sms', fromRating: 2,
      client: { name: 'Ольга Романова', phone: '+7 925 117-03-18', since: 'Клиент с марта 2025 · 7 визитов · прошлые оценки 5, 5, 4' },
      link: { label: 'Визит 1.10, 11:30 · SPA-ритуал', lines: ['SPA-ритуал · 1 октября, 11:30–13:00', 'Кабинет № 2 · стол с подогревом', 'Мастер: Анна Морозова'] },
      about: 'm-morozova', aboutName: 'Анна Морозова',
      sla: sl('d-mas', 'complaint', ts(1, 10, 15, 12)), labels: ['опоздание', 'оборудование'], tasks: [{ id: 'T-71', title: 'Починить подогрев стола в кабинете № 2', status: 'Новая' }],
      messages: [m('rating', ts(1, 10, 15, 12), 'Начали на 15 минут позже, в кабинете холодно. Сам массаж хороший.', { by: 'Ольга Романова', score: 2, reasons: ['Опоздание начала', 'Температура в кабинете'], contact: true }), m('public', ts(1, 10, 15, 12), 'Ольга, спасибо за честную оценку. Администратор ответит в течение 2 часов.', { by: 'Автоответ', auto: true }), m('note', ts(1, 10, 15, 40), 'Проверила журнал кабинета № 2: в 11:30 не включился подогрев стола, Анна начала в 11:45. Завела задачу T-71 на ремонт стола. Предлагаю скидку 20% на следующий визит.', { by: 'Дарья Зимина' })] },
    { id: 'r-o11', key: 'ОТД-11', dir: 'd-otd', kind: 'claim', title: 'Прошу уменьшить цену: перепад ламината в коридоре', status: 'work', priority: 'normal', assignee: 'Дарья Зимина', at: ts(27, 9, 20, 5), channel: 'cabinet',
      client: { name: 'Игорь Чернов', phone: '+7 903 555-21-07', since: 'Заказчик · договор № 31' },
      link: { label: 'Профсоюзная, 64 · кв. 210', lines: ['Чистовая отделка · сдача 9 октября', 'Прораб: Алексей Соколов', 'Договор № 31'] },
      sla: sl('d-otd', 'claim', ts(27, 9, 20, 5), { first: ts(28, 9, 10, 30) }), labels: ['ламинат'], tasks: [{ id: 'T-73', title: 'Замер перепада ламината в коридоре', status: 'В работе' }],
      messages: [m('client', ts(27, 9, 20, 5), 'Прошу уменьшить цену за ламинат в коридоре: перепад между плашками до 3 мм, видно при боковом свете. Фото прилагаю.', { by: 'Игорь Чернов', files: ['Коридор 1.jpg', 'Коридор 2.jpg', 'Коридор 3.jpg'] }), m('public', ts(28, 9, 10, 30), 'Игорь, приняли претензию. 2 октября приедет прораб и замерит перепад, после этого пришлём письменный ответ.', { by: 'Дарья Зимина' }), m('note', ts(28, 9, 10, 40), 'Соколов, посмотри фото: если перепад больше 2 мм — переукладка за наш счёт, иначе предложим скидку.', { by: 'Дарья Зимина' })] },
    { id: 'r-40', key: 'МАС-40', dir: 'd-mas', kind: 'question', title: 'Можно ли SPA-ритуал во время беременности?', status: 'new', priority: 'normal', assignee: null, at: ts(1, 10, 16, 4), channel: 'widget',
      client: { name: 'Екатерина Лаврова', phone: '+7 977 300-92-55', since: 'Новый клиент' }, link: null,
      sla: sl('d-mas', 'question', ts(1, 10, 16, 4)), labels: [], tasks: [],
      messages: [m('client', ts(1, 10, 16, 4), 'Можно ли SPA-ритуал во время беременности? Срок 20 недель.', { by: 'Екатерина Лаврова' })] },
    { id: 'r-o12', key: 'ОТД-12', dir: 'd-otd', kind: 'warranty', title: 'Отошла плитка у душевого трапа', status: 'work', priority: 'normal', assignee: 'Дарья Зимина', at: ts(30, 9, 19, 40), channel: 'cabinet',
      client: { name: 'Андрей Кузнецов', phone: '+7 916 880-61-40', since: 'Заказчик · договор № 27' },
      link: { label: 'Дом на Лесной · Мытищи', lines: ['Сдан 12 сентября · гарантия до 12.09.2027', 'Прораб: Алексей Соколов', 'Акт № 4 · плитка, санузел 2 этажа'] },
      sla: sl('d-otd', 'warranty', ts(30, 9, 19, 40), { first: ts(1, 10, 9, 35) }), labels: ['гарантия'], tasks: [{ id: 'T-72', title: 'Выезд по гарантии: плитка у трапа, 2.10 10:00–12:00', status: 'Новая' }],
      messages: [m('client', ts(30, 9, 19, 40), 'В ванной на втором этаже отошла плитка у душевого трапа, две плитки качаются.', { by: 'Андрей Кузнецов', files: ['Трап 1.jpg', 'Трап 2.jpg'] }), m('public', ts(1, 10, 9, 35), 'Андрей, это гарантийный случай. Прораб приедет в пятницу, 2 октября, с 10 до 12. Подойдёт?', { by: 'Дарья Зимина' }), m('client', ts(1, 10, 10, 2), 'Да, буду дома.', { by: 'Андрей Кузнецов' }), m('note', ts(1, 10, 10, 10), 'Назначила выезд в календаре: Соколов, 2.10 10:00–12:00.', { by: 'Дарья Зимина' })] },
    { id: 'r-55', key: 'ГРЗ-55', dir: 'd-grz', kind: 'cargo', title: 'Привезли 5 паллет из 6', status: 'wait', pausedAt: ts(28, 9, 11, 0), priority: 'normal', assignee: 'Вера Котельникова', at: ts(26, 9, 14, 20), channel: 'phone',
      client: { name: 'Олег Сафонов', org: 'ИП Сафонов', phone: '+7 846 212-77-09', since: 'Клиент с 2025 года · 8 доставок' },
      link: { label: 'Рейс Р-192 · 26.09', lines: ['Доставлено 26 сентября, 13:10', 'Водитель: Тимур Ахмедов', 'Накладная № 4410: 6 паллет'] },
      sla: sl('d-grz', 'cargo', ts(26, 9, 14, 20), { first: ts(26, 9, 14, 25) }), labels: ['недостача'], tasks: [],
      messages: [m('system', ts(26, 9, 14, 20), 'Заведено по звонку · Вера Котельникова'), m('client', ts(26, 9, 14, 20), 'Привезли 5 паллет из 6, водитель сказал, что шестую не погрузили на складе.', { by: 'Олег Сафонов' }), m('public', ts(26, 9, 14, 25), 'Олег, приняли обращение о недостаче одной паллеты. Пришлите, пожалуйста, акт о расхождении с подписью водителя.', { by: 'Вера Котельникова' }), m('client', ts(27, 9, 12, 10), 'Акт подписан, но он у кладовщика — пришлю в понедельник.', { by: 'Олег Сафонов' }), m('public', ts(28, 9, 11, 0), 'Ждём акт: без него не можем начать проверку.', { by: 'Вера Котельникова' }), m('system', ts(28, 9, 11, 0), 'Ждёт клиента — срок на паузе, срок по закону идёт')] },
    { id: 'r-k6', key: 'КОС-6', dir: 'd-kos', kind: 'idea', title: 'Сделайте онлайн-запись на выходные', status: 'new', priority: 'low', assignee: null, at: ts(1, 10, 12, 0), channel: 'qr',
      client: { name: 'Мария Киселёва', phone: '+7 926 410-15-73', since: 'Клиент с 2024 года · 15 визитов' }, link: null,
      sla: sl('d-kos', 'idea', ts(1, 10, 12, 0)), labels: [], tasks: [],
      messages: [m('client', ts(1, 10, 12, 0), 'Сделайте онлайн-запись на выходные — по телефону в субботу не дозвониться.', { by: 'Мария Киселёва' })] },
    { id: 'r-39', key: 'МАС-39', dir: 'd-mas', kind: 'thanks', title: 'Спасибо Анне, спина больше не болит', status: 'resolved', outcome: 'Передано мастеру', resolvedAt: ts(30, 9, 15, 40), priority: 'low', assignee: null, at: ts(30, 9, 15, 40), channel: 'sms',
      client: { name: 'Мария Киселёва', phone: '+7 926 410-15-73', since: 'Клиент с 2024 года · 15 визитов' },
      link: { label: 'Визит 30.09 · классический массаж', lines: ['Классический массаж · 30 сентября, 10:00–11:00', 'Кабинет № 2', 'Мастер: Анна Морозова'] },
      sla: { first: null, resolve: null, legal: null }, labels: [], tasks: [],
      messages: [m('rating', ts(30, 9, 15, 40), 'Спасибо Анне, спина больше не болит!', { by: 'Мария Киселёва', score: 5, reasons: [], contact: false }), m('system', ts(30, 9, 15, 40), 'Благодарность передана мастеру: Анна Морозова')] },
  ];
  const ratings = [
    { id: 'S-311', dir: 'd-mas', client: 'Светлана Михеева', score: 3, reasons: ['Чистота'], comment: 'Полотенце было влажным', at: ts(30, 9, 18, 10), work: 'Визит 30.09 · массаж спины', status: 'open' },
    { id: 'S-305', dir: 'd-grz', client: 'ООО «Вектор»', score: 2, reasons: ['Опоздание к окну выгрузки'], comment: 'Опоздали на 40 минут, разгрузку перенесли на вечер', at: ts(29, 9, 12, 40), work: 'Рейс Р-190 · 29.09', status: 'open' },
  ];
  return { directions, types, templates, requests, ratings, seq: 200 };
}

/** Подключение к демо-организации «Альта Групп»: данные, шаблон роли и назначения с областью направления. */
export function installService(db) {
  if (db.tenantId !== 't-alta' || db.service) return;
  db.service = serviceSeed();
  if (!db.roles.some((r) => r.id === 'r-agent')) db.roles.push({ id: 'r-agent', name: 'Специалист по обращениям', kind: 'template', project: true, actions: { service: ['view', 'create', 'edit', 'review'] }, finance: { read: false, manage: false } });
  db.assignments.push({ id: 'as-svc1', member: 'm-kotova', role: 'r-agent', scope: { type: 'project', id: 'svc-grz' } });
  db.assignments.push({ id: 'as-svc2', member: 'm-kotelnikova', role: 'r-agent', scope: { type: 'project', id: 'svc-grz' } });
}

const ownerOf = (db, actor, M) => M.grants(db, actor).some((g) => g.roleObj.all);
const seesDir = (db, actor, M, d) => ownerOf(db, actor, M) || M.grants(db, actor).some((g) => g.scope?.type === 'project' && g.scope.id === d.project && (g.roleObj.actions?.service || []).length);

/** Ответ сервера участнику: только его направления, без жалоб на него самого; телефон — только тем, кому его показали. */
export function serviceView(db, actor, M) {
  const S = db.service;
  if (!S) return null;
  if (!M.can(db, actor, 'service', 'view').ok) return { directions: [], types: [], templates: [], requests: [], ratings: [], hidden: true };
  const dirs = S.directions.filter((d) => seesDir(db, actor, M, d)), ids = new Set(dirs.map((d) => d.id));
  const owner = ownerOf(db, actor, M);
  const team = (d) => db.members.filter((mm) => mm.status === 'active' && seesDir(db, mm.id, M, d) && M.can(db, mm.id, 'service', 'edit').ok).map((mm) => mm.name);
  return {
    directions: clone(dirs).map((d) => ({ ...d, team: team(d), canContacts: owner || d.lead === actor })),
    types: clone(S.types.filter((t) => ids.has(t.dir))), templates: clone(S.templates),
    requests: S.requests.filter((r) => ids.has(r.dir) && r.about !== actor).map((r) => { const x = clone(r); x.client.phoneMasked = maskPhone(r.client.phone); if (!(r.shown || []).includes(actor)) delete x.client.phone; delete x.shown; return x; }),
    ratings: clone(S.ratings.filter((x) => ids.has(x.dir))),
  };
}

/** Команды mock-адаптера. getDb/getActor — геттеры: адаптер меняет организацию и участника. */
export function serviceApi({ getDb, getActor, cmd, ApiError, M, event }) {
  const S = () => { const s = getDb().service; if (!s) throw new ApiError('not_found', 'В организации нет направлений обращений'); return s; };
  const me = () => getDb().members.find((x) => x.id === getActor());
  const VERB = { view: 'Видеть', create: 'Заводить', edit: 'Отвечать', review: 'Решать' };
  const need = (verb) => { if (!M.can(getDb(), getActor(), 'service', verb).ok) throw new ApiError('forbidden', 'Нет права «' + VERB[verb] + '» в обращениях'); };
  const dirOf = (r) => S().directions.find((d) => d.id === r.dir);
  const req = (id) => { const r = S().requests.find((x) => x.id === id); if (!r || !seesDir(getDb(), getActor(), M, dirOf(r)) || r.about === getActor()) throw new ApiError('not_found', 'Обращение не найдено'); return r; };
  const msg = (r, kind, text, x = {}) => r.messages.push({ id: 'msg' + S().seq++, kind, at: svcNow(), text, ...x });
  const resume = (r, now) => {
    if (!r.pausedAt) return;
    const d = dirOf(r), mins = workBetween(r.pausedAt, now, d.cal);
    ['first', 'resolve'].forEach((k) => { const x = r.sla[k]; if (x && !x.stopped) x.due = addWork(x.due, mins, d.cal); });
    r.pausedAt = null;
  };
  const slaFor = (d, ty, at) => ({
    first: ty.first ? { goal: ty.first, due: addWork(at, ty.first, d.cal), stopped: null } : null,
    resolve: ty.resolve ? { goal: ty.resolve, due: addWork(at, ty.resolve, d.cal), stopped: null } : null,
    legal: ty.legal ? { days: ty.legal, due: at + ty.legal * DAY, stopped: null } : null,
  });
  const titleOf = (t) => { const s = String(t).trim().split(/[.!?\n]/)[0].trim(); return s.length > 80 ? s.slice(0, 77) + '…' : s; };
  return {
    svcReply: (id, { kind, text, compensation }) => cmd(() => {
      const r = req(id), now = svcNow(), m = me(), note = kind === 'note';
      need(note ? 'view' : 'edit');
      if (r.status === 'closed') throw new ApiError('validation', 'Обращение закрыто');
      const t = String(text || '').trim();
      if (t.length < 2) throw new ApiError('validation', note ? 'Напишите текст заметки' : 'Напишите текст ответа');
      msg(r, note ? 'note' : 'public', t, { by: m.name, channel: note ? null : r.channel });
      if (!note) { if (r.sla.first && !r.sla.first.stopped) r.sla.first.stopped = now; if (r.status === 'new') r.status = 'work'; if (!r.assignee) r.assignee = m.name; }
      if (compensation) { r.compensation = compensation; msg(r, 'system', 'Компенсация: ' + compensation + (compensation.startsWith('Возврат') ? ' — предложение операции отправлено в кассу, основание ' + r.key : ' — сохранена в карточке клиента')); }
      return r.key;
    }),
    svcTransition: (id, to, opts = {}) => cmd(() => {
      const r = req(id), now = svcNow(), m = me();
      if (!(SVC_FLOW[r.status] || []).includes(to)) throw new ApiError('transition', 'Из статуса «' + SVC_ST[r.status].label + '» в «' + SVC_ST[to].label + '» перейти нельзя');
      need(to === 'resolved' || to === 'closed' ? 'review' : 'edit');
      if (to === 'resolved') {
        const list = r.about ? OUTCOMES_ABOUT : OUTCOMES;
        if (!list.includes(opts.outcome)) throw new ApiError('validation', 'Выберите итог решения');
        if (r.status === 'wait') resume(r, now);
        r.outcome = opts.outcome; r.resolvedAt = now;
        ['first', 'resolve', 'legal'].forEach((k) => { const x = r.sla[k]; if (x && !x.stopped) x.stopped = now; });
        msg(r, 'system', 'Решено · ' + opts.outcome + ' · ' + m.name + '. Клиенту отправлен вопрос «Довольны ли решением?»');
      } else if (to === 'wait') {
        r.pausedAt = now;
        msg(r, 'system', 'Ждёт клиента · ' + m.name + ' — срок на паузе' + (r.sla.legal ? ', срок по закону идёт' : ''));
      } else if (to === 'work') {
        if (r.status === 'wait') resume(r, now);
        if (r.status === 'resolved') { r.outcome = null; r.resolvedAt = null; ['resolve', 'legal'].forEach((k) => { if (r.sla[k]) r.sla[k].stopped = null; }); msg(r, 'system', 'Возвращено в работу · ' + m.name); }
        else msg(r, 'system', 'Взято в работу · ' + m.name);
        if (!r.assignee) r.assignee = m.name;
      } else if (to === 'closed') msg(r, 'system', 'Закрыто · ' + m.name);
      r.status = to;
      return r.key;
    }),
    svcAssign: (id, name) => cmd(() => {
      const r = req(id); need('edit');
      const d = dirOf(r), ok = !name || getDb().members.some((mm) => mm.name === name && seesDir(getDb(), mm.id, M, d));
      if (!ok) throw new ApiError('validation', name + ' не видит направление «' + d.name + '» — назначить нельзя');
      r.assignee = name || null;
      msg(r, 'system', name ? 'Исполнитель: ' + name : 'Исполнитель снят');
    }),
    svcPriority: (id, p) => cmd(() => { const r = req(id); need('edit'); if (!SVC_PRIO[p]) throw new ApiError('validation', 'Неизвестный приоритет'); r.priority = p; msg(r, 'system', 'Приоритет: ' + SVC_PRIO[p].toLowerCase()); }),
    svcMove: (id, dirId) => cmd(() => {
      const r = req(id); need('edit');
      const d = S().directions.find((x) => x.id === dirId);
      if (!d || d.id === r.dir) throw new ApiError('validation', 'Выберите другое направление');
      if (!seesDir(getDb(), getActor(), M, d)) throw new ApiError('forbidden', 'Нет доступа к направлению «' + d.name + '»');
      const from = dirOf(r), old = r.key;
      r.dir = d.id; r.key = d.key + '-' + d.next++; r.oldKeys = [...(r.oldKeys || []), old];
      if (!S().types.some((t) => t.dir === d.id && t.kind === r.kind)) r.kind = 'question';
      msg(r, 'system', 'Перенесено из «' + from.name + '» в «' + d.name + '»: ' + old + ' → ' + r.key + '. Клиент получил новый номер, старый ведёт сюда');
      return r.key;
    }),
    svcCreate: ({ dir, kind, name, phone, org, link, text }) => cmd(() => {
      need('create');
      const d = S().directions.find((x) => x.id === dir);
      if (!d || !seesDir(getDb(), getActor(), M, d)) throw new ApiError('validation', 'Выберите направление');
      const ty = S().types.find((t) => t.dir === d.id && t.kind === kind);
      if (!ty) throw new ApiError('validation', 'Выберите тип обращения');
      if (String(name || '').trim().length < 2) throw new ApiError('validation', 'Укажите имя клиента');
      if (String(phone || '').replace(/\D/g, '').length < 10) throw new ApiError('validation', 'Телефон — не меньше 10 цифр');
      if (String(text || '').trim().length < 5) throw new ApiError('validation', 'Опишите, что случилось');
      const now = svcNow(), m = me();
      const r = { id: 'r-' + S().seq++, key: d.key + '-' + d.next++, dir: d.id, kind, title: titleOf(text), status: 'work', priority: kind === 'complaint' || kind === 'claim' ? 'high' : 'normal', assignee: m.name, at: now, channel: 'phone',
        client: { name: name.trim(), org: (org || '').trim() || undefined, phone: phone.trim(), since: 'Новый клиент' },
        link: String(link || '').trim() ? { label: link.trim(), lines: ['Привязано вручную при звонке'] } : null,
        sla: slaFor(d, ty, now), labels: [], tasks: [], shown: [getActor()],
        messages: [{ id: 'msg' + S().seq++, kind: 'system', at: now, text: 'Заведено по звонку · ' + m.name }, { id: 'msg' + S().seq++, kind: 'client', at: now, text: text.trim(), by: name.trim(), channel: 'phone' }] };
      S().requests.unshift(r);
      return r.id;
    }),
    svcShowPhone: (id) => cmd(() => {
      const r = req(id), d = dirOf(r);
      if (!ownerOf(getDb(), getActor(), M) && d.lead !== getActor()) throw new ApiError('forbidden', 'Телефон клиента показывают руководителю направления и владельцу: нужно право «Контакты клиентов»');
      r.shown = [...new Set([...(r.shown || []), getActor()])];
      msg(r, 'system', 'Телефон клиента показан: ' + me().name);
    }),
    svcShare: (id, text) => cmd(() => {
      const r = req(id); need('review');
      if (!r.about) throw new ApiError('validation', 'Обращение не касается сотрудника');
      if (!['resolved', 'closed'].includes(r.status)) throw new ApiError('validation', 'Поделиться выводом можно после решения');
      const t = String(text || '').trim();
      if (t.length < 5) throw new ApiError('validation', 'Напишите вывод для сотрудника');
      r.shared = { text: t, at: svcNow(), by: me().name };
      msg(r, 'system', 'Вывод отправлен сотруднику: ' + r.aboutName + ' · без контактов клиента');
      event('Вывод по обращению ' + r.key + ': ' + t, [r.about]);
    }),
    svcAddTask: (id, title) => cmd(() => {
      const r = req(id); need('edit');
      const t = String(title || '').trim();
      if (t.length < 3) throw new ApiError('validation', 'Тема задачи — не короче 3 символов');
      const tid = 'T-' + (S().seq++);
      r.tasks.push({ id: tid, title: t, status: 'Новая' });
      msg(r, 'system', 'Создана задача ' + tid + ' «' + t + '» · клиент её не видит');
      return tid;
    }),
    svcRating: (rid, action) => cmd(() => {
      const x = S().ratings.find((y) => y.id === rid);
      if (!x) throw new ApiError('not_found', 'Оценка не найдена');
      const d = S().directions.find((y) => y.id === x.dir);
      if (!seesDir(getDb(), getActor(), M, d)) throw new ApiError('not_found', 'Оценка не найдена');
      if (action === 'seen') { need('edit'); x.status = 'seen'; return null; }
      need('create');
      const ty = S().types.find((t) => t.dir === d.id && t.kind === 'complaint'), now = svcNow(), m = me();
      const r = { id: 'r-' + S().seq++, key: d.key + '-' + d.next++, dir: d.id, kind: 'complaint', title: titleOf(x.comment || x.reasons.join(', ')), status: 'work', priority: x.score <= 2 ? 'high' : 'normal', assignee: m.name, at: now, channel: 'sms', fromRating: x.score,
        client: { name: x.client, phone: '+7 900 000-00-00', since: 'Клиент из опроса ' + x.id }, link: { label: x.work, lines: ['Оценка ' + x.score + ' из 5 · ' + dayLabel(x.at)] },
        sla: slaFor(d, ty, now), labels: [], tasks: [],
        messages: [{ id: 'msg' + S().seq++, kind: 'rating', at: x.at, text: x.comment, by: x.client, score: x.score, reasons: x.reasons, contact: false }, { id: 'msg' + S().seq++, kind: 'system', at: now, text: 'Жалоба открыта из низкой оценки · ' + m.name + '. Клиент не просил связаться — первым ответом позвоните или напишите' }] };
      S().requests.unshift(r); x.status = 'request'; x.request = r.key;
      return r.id;
    }),
  };
}
