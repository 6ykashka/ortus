// Чаты (docs/25-chats.md): виды, состав из «Пользователей и ролей», политики хранения и места.
// Состав вычисляется из источников: роль в области, группа, связь с записью (прораб объекта, водитель рейса)
// и сотрудник по имени — это назначение роли чата с областью «чат». Личные чаты читают только двое участников.
// Права: политика вида чата → роль в чате → модуль «Чаты» в ролях сотрудника → функция «Водитель».
import { entryHas, objOf } from './documents.js';

export const CHAT_TODAY = '01.10.2026';
const p2 = (n) => String(n).padStart(2, '0');
const clone = (o) => JSON.parse(JSON.stringify(o));
const mem = (db, id) => (db.members || []).find((m) => m.id === id);
const grp = (db, id) => (db.groups || []).find((g) => g.id === id);
const roleOf = (db, id) => (db.roles || []).find((r) => r.id === id);
const unitName = (db, id) => ((db.units || []).find((u) => u.id === id) || {}).name || 'вся организация';
export const gb = (mb) => (mb >= 1000 ? String(Math.round(mb / 100) / 10).replace('.', ',') + ' ГБ' : String(Math.round(mb * 10) / 10).replace('.', ',') + ' МБ');
export const plural = (n, a, b, c) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

// Время демо: минуты от 01.10.2026 00:00 (прошлые дни — отрицательные).
export function tsDay(ts) { const d = new Date(2026, 9, 1 + Math.floor(ts / 1440)); return p2(d.getDate()) + '.' + p2(d.getMonth() + 1); }
export function tsTime(ts) { const m = ((ts % 1440) + 1440) % 1440; return p2(Math.floor(m / 60)) + ':' + p2(m % 60); }
export const tsLabel = (ts, now) => (Math.floor(ts / 1440) === Math.floor(now / 1440) ? tsTime(ts) : tsDay(ts) + ' ' + tsTime(ts));

export const CHAT_KINDS = {
  direct: { label: 'Личные', one: 'Личный чат', icon: 'person', folder: 'direct' },
  group: { label: 'Рабочие группы', one: 'Рабочая группа', icon: 'groups', folder: 'group' },
  area: { label: 'По роли в области', one: 'Чат по роли', icon: 'badge', folder: 'group' },
  record: { label: 'Чаты записей', one: 'Чат записи', icon: 'link', folder: 'record' },
  announce: { label: 'Объявления', one: 'Объявления', icon: 'campaign', folder: 'announce' },
};
export const CHAT_ROLE_LABEL = { owner: 'Владелец чата', moderator: 'Модератор', member: 'Участник', reader: 'Читатель' };
export const RANK = { reader: 1, member: 2, moderator: 3, owner: 4 };
const FIN0 = { read: false, manage: false };
export const CHAT_ROLES = [
  { id: 'r-chat-owner', name: 'Владелец чата', kind: 'template', chatRole: 'owner', actions: { chat: ['view', 'create', 'review', 'settings'] }, finance: FIN0 },
  { id: 'r-chat-mod', name: 'Модератор чата', kind: 'template', chatRole: 'moderator', actions: { chat: ['view', 'create', 'review'] }, finance: FIN0 },
  { id: 'r-chat-member', name: 'Участник чата', kind: 'template', chatRole: 'member', actions: { chat: ['view', 'create'] }, finance: FIN0 },
  { id: 'r-chat-reader', name: 'Читатель чата', kind: 'template', chatRole: 'reader', actions: { chat: ['view'] }, finance: FIN0 },
  { id: 'r-chat-creator', name: 'Чаты · создаёт группы', kind: 'template', actions: { chat: ['view', 'create', 'edit'] }, finance: FIN0 },
];
const ROLE_ID = { owner: 'r-chat-owner', moderator: 'r-chat-mod', member: 'r-chat-member', reader: 'r-chat-reader' };

// ── Политики: организация задаёт пределы, вид чата — значения, чат меняет их в пределах ──
export const EDIT_LABEL = { '15m': '15 минут', '48h': '48 часов', none: 'Без срока' };
export const EDIT_MIN = { '15m': 15, '48h': 2880, none: Infinity };
export const RCPT_LABEL = { off: 'Не показывать', ticks: 'Галочки', who: 'Кто и когда' };
export const TEMP_LABEL = { off: 'Запрещены', allowed: '1 час — 7 дней', viewonce: 'Одноразовые файлы · модераторы' };
export const FWD_LABEL = { free: 'Свободно', internal: 'Внутри организации', off: 'Запрещена' };
export const FULL_LABEL = { block: 'Запретить новые файлы', ring: 'Удалять старые вложения', archive: 'Переносить в архив', compress: 'Сжимать медиа' };
export const FULL_HINT = {
  block: 'Текст, опросы и подтверждения работают. Рабочие фото модулей уходят в резерв модуля.',
  ring: 'Самые старые вложения удаляются, чтобы вместить новые; сохранённое в запись и под удержанием не трогается.',
  archive: 'Старые вложения уходят в архивное хранилище и открываются по запросу за 1–3 минуты.',
  compress: 'Фото и видео старше 30 дней заменяются сжатыми копиями; если места мало — как «Запретить».',
};
export const BOUNDS = { textY: [1, 5], filesD: [30, 1825], voiceD: [30, 1095], rcptD: [7, 90], delD: [0, 90], maxMb: [10, 2000] };
const POL = (o) => ({ textY: 3, filesD: 365, voiceD: 90, rcpt: 'who', rcptD: 30, delD: 30, edit: '48h', maxMb: 200, quotaMb: null, temp: 'off', fwd: 'internal', pdn: true, onFull: 'block', ...o });
export const DEFAULT_POLICY = {
  direct: POL({ rcpt: 'ticks', temp: 'allowed' }),
  group: POL({ quotaMb: 5000 }),
  area: POL({ maxMb: 100 }),
  record: POL({ maxMb: 500, quotaMb: 5000, temp: 'viewonce', afterClose: 3 }),
  announce: POL({ textY: 5, maxMb: 50, rcpt: 'off' }),
};
export const policyOf = (db, c) => ({ ...((db.chats && db.chats.policy[c.kind]) || POL({})), ...(c.over || {}) });

// ── Состав и доступ ──
function srcHas(db, M, mid, s) {
  if (s.who === 'tripDriver') { const t = (db.trips || []).find((x) => x.id === s.trip); return !!(t && t.driverId === mid); }
  return entryHas(db, M, mid, s);
}
export function srcLabel(db, s) {
  if (s.who === 'all') return 'Все сотрудники организации';
  if (s.who === 'group') return 'Группа «' + ((grp(db, s.ref) || {}).name || s.ref) + '»';
  if (s.who === 'role') return 'Роль «' + ((roleOf(db, s.ref) || {}).name || s.ref) + '» · ' + (s.unit ? unitName(db, s.unit) : 'вся организация');
  if (s.who === 'relation') { const o = objOf(db, s.obj); return 'Прораб объекта' + (o ? ' «' + o.name + '»' : ''); }
  if (s.who === 'tripDriver') return 'Водитель рейса ' + s.trip;
  if (s.who === 'member') return (mem(db, s.ref) || {}).name || 'Сотрудник';
  return '—';
}
export const srcIcon = (s) => ({ all: 'apartment', group: 'groups', role: 'badge', relation: 'engineering', tripDriver: 'local_shipping', member: 'person' }[s.who] || 'person');
function verbs(db, M, mid) {
  const gs = M.grants(db, mid);
  if (gs.some((g) => g.roleObj.all)) return { all: true, has: () => true };
  const set = new Set(); gs.forEach((g) => ((g.roleObj.actions && g.roleObj.actions.chat) || []).forEach((v) => set.add(v)));
  return { all: false, has: (v) => set.has(v) };
}
const named = (db, M, mid, c) => M.grants(db, mid).filter((g) => g.scope && g.scope.type === 'chat' && g.scope.id === c.id && g.roleObj.chatRole);

/** Доступ сотрудника к чату с цепочкой причин: состав → модуль в роли → функция → приглашение. */
export function chatAccess(db, M, mid, c) {
  const m = mem(db, mid), chain = [];
  const no = (reason, why, extra) => ({ ok: false, role: null, reason, why, chain, via: [], ...(extra || {}) });
  if (!m) return no('none', 'Сотрудник не найден');
  if (m.status === 'blocked') return no('blocked', 'Заблокирован владельцем — не входит в чаты; вернётся сам, если разблокируют');
  if (c.record && c.record.module && !M.moduleOn(db, c.record.module)) return no('module_off', 'Модуль записи не подключён');
  const vb = verbs(db, M, mid);
  let role = null; const via = [];
  if (c.kind === 'direct') {
    if (!(c.pair || []).includes(mid)) return no('not_member', 'Личный чат читают только двое участников');
    role = 'member'; via.push('Участник личного чата');
  } else {
    (c.sources || []).forEach((s) => { if (srcHas(db, M, mid, s)) { via.push(srcLabel(db, s)); if (!role || RANK[s.role] > RANK[role]) role = s.role; } });
    named(db, M, mid, c).forEach((g) => { via.push(g.roleObj.name + ' · по имени'); if (!role || RANK[g.roleObj.chatRole] > RANK[role]) role = g.roleObj.chatRole; });
    if (vb.all) { if (!role) via.push('Владелец бизнеса · видит все рабочие чаты'); role = 'owner'; }
  }
  chain.push({ t: 'Состав чата', d: via.length ? via.join(' · ') : 'Ни один источник состава не подходит', ok: !!role });
  if (!role) return no('not_member', 'Не входит в состав чата');
  const modOk = vb.all || vb.has('view');
  chain.push({ t: 'Модуль «Чаты» в ролях', d: vb.all ? 'Владелец бизнеса' : modOk ? 'Есть право «Чаты · Просматривать»' : 'Ни в одной роли нет модуля «Чаты»', ok: modOk });
  if (!modOk) return no('no_module', 'У ролей сотрудника нет модуля «Чаты»: разрешите его в роли или добавьте по имени', { role, via });
  const fin = c.sensitivity === 'finance' && m.function === 'driver';
  chain.push({ t: 'Функция', d: m.function === 'driver' ? 'Водитель: ПДн под маской, финансовые чаты закрыты' : 'Ограничений нет', ok: !fin });
  if (fin) return no('function', 'Функция «Водитель»: чаты с меткой «Финансы» закрыты', { role, via });
  if (m.status === 'invited') return { ok: false, pending: true, role, reason: 'invited', why: 'Войдёт, когда примет приглашение в организацию', via, chain };
  return { ok: true, role, via, chain, owner: vb.all, vb };
}

/** Что сотрудник может в чате: роль в чате и политика вида. */
export function chatRights(db, M, mid, c) {
  const a = chatAccess(db, M, mid, c); const P = policyOf(db, c);
  if (!a.ok) return { ...a, can: {}, P };
  const r = RANK[a.role], own = !!a.owner, arch = c.status === 'archived';
  const write = !arch && (c.kind === 'announce' ? r >= 3 : r >= 2) && (own || a.vb.has('create'));
  const mod = r >= 3;
  const can = {
    write, files: write, polls: write, mod, pin: mod,
    announce: write && mod && (own || a.vb.has('review')),
    receipts: P.rcpt === 'who' && r >= 2,
    pdn: own,
    temp: write && P.temp === 'allowed',
    viewOnce: write && mod && P.temp !== 'off',
    members: c.kind !== 'direct' && (a.role === 'owner' || (mod && (own || a.vb.has('review')))),
    settings: c.kind !== 'direct' && (a.role === 'owner' || own),
    saveTo: write && !!c.record,
    task: write && M.can(db, mid, 'tasks', 'create').ok,
  };
  return { ...a, can, P };
}

/** Кто в чате и почему: для «Участников» и предпросмотра состава. */
export function chatPeople(db, M, c) {
  return (db.members || []).map((m) => {
    const a = chatAccess(db, M, m.id, c);
    if (a.ok) return { id: m.id, name: m.name, title: m.title || '', st: 'in', role: a.role, via: a.via.join(' · ') };
    if (a.pending) return { id: m.id, name: m.name, title: m.title || '', st: 'pending', role: a.role, via: a.via.join(' · '), why: a.why };
    if (a.role) return { id: m.id, name: m.name, title: m.title || '', st: 'out', role: a.role, why: a.why };
    // Не вошёл без роли в чате — показываем, только если на него указывает источник: группа, роль в области или назначение по имени.
    if (c.kind === 'direct') return null;
    const hit = (c.sources || []).some((s) => (s.who === 'group' && ((grp(db, s.ref) || {}).members || []).includes(m.id))
      || (s.who === 'role' && (db.assignments || []).some((x) => x.member === m.id && x.role === s.ref && (!s.unit || (x.scope && M.scopeCovers(db, x.scope, s.unit)))))
      || (s.who === 'member' && s.ref === m.id))
      || (db.assignments || []).some((x) => x.member === m.id && x.scope && x.scope.type === 'chat' && x.scope.id === c.id);
    return hit ? { id: m.id, name: m.name, title: m.title || '', st: 'out', why: a.why } : null;
  }).filter(Boolean);
}

/** Матрица «роль в чате × действие» для вкладки «Права». */
export function chatMatrix(P, kind) {
  const y = 'y', n = 'n', l = 'l';
  const ann = kind === 'announce';
  return [
    ['Сообщения', [
      ['Писать сообщения', [y, y, ann ? n : y, n], ann ? 'В объявлениях пишут модераторы' : ''],
      ['Файлы и медиа', [y, y, ann ? n : y, n], 'До ' + gb(P.maxMb) + ' · фото сжимаются'],
      ['Создавать опросы', [y, y, ann ? n : y, n], 'Читатель голосует'],
      ['Важное с подтверждением и @все', [y, y, n, n], 'Нужно право «Чаты · Решать» в роли'],
      ['Править свои сообщения', [y, y, ann ? n : y, n], EDIT_LABEL[P.edit] + ' · история правок видна участникам'],
    ]],
    ['Участники и модерация', [
      ['Добавлять сотрудников по имени', [y, y, n, n], 'Только своей области'],
      ['Удалять чужие сообщения', [y, y, n, n], 'С причиной, её видно в чате'],
      ['Закреплять', [y, y, n, n], ''],
    ]],
    ['Чтение и защита', [
      ['Видеть, кто и когда прочитал', P.rcpt === 'who' ? [y, y, y, n] : [l, l, l, l], 'Режим: ' + RCPT_LABEL[P.rcpt]],
      ['Видеть ПДн без маски', [l, l, l, l], 'Только право «ПДн без маски»; функции «Водитель» — никогда'],
      ['Временные сообщения', P.temp === 'allowed' ? [y, y, ann ? n : y, n] : [l, l, l, l], TEMP_LABEL[P.temp]],
      ['Одноразовые файлы', P.temp === 'off' ? [l, l, l, l] : [y, y, n, n], 'Удаляются через 24 часа после открытия'],
      ['Пересылка', P.fwd === 'off' ? [l, l, l, l] : [y, y, y, y], FWD_LABEL[P.fwd]],
    ]],
  ];
}

// ── Демо-данные ──
const F = (name, mb, kind, x) => ({ name, mb, kind, ...(x || {}) });
function seedChats(db) {
  const T = (d, t) => { const [h, m] = t.split(':').map(Number); return d * 1440 + h * 60 + m; };
  let seq = 0;
  const msg = (by, d, t, x) => ({ id: 'cm-' + (++seq), ts: T(d, t), by, text: '', reads: {}, ...(typeof x === 'string' ? { text: x } : x || {}) });
  const poll = (q, opts, closesTs, closesLabel, votes) => ({ kind: 'poll', poll: { q, opts: opts.map((t, i) => ({ id: 'o' + (i + 1), t })), votes: votes || {}, anon: false, multi: false, closes: closesTs, closesLabel, closed: false } });
  if (db.tenantId !== 't-alta') {
    return { chats: [
      { id: 'ch-news', kind: 'announce', title: 'Новости салона', unit: null, owner: 'm-owner', sources: [{ who: 'all', role: 'reader' }], msgs: [msg('m-owner', 0, '09:00', { text: 'С ноября работаем до 22:00 по пятницам. Подтвердите, что видели.', important: { due: '15.10', acks: [] } })] },
      { id: 'ch-tver', kind: 'area', title: 'Мастера · Тверская', unit: 'f-lotos-tver', owner: 'm-owner', sources: [{ who: 'group', ref: 'g-tver', role: 'member' }], msgs: [msg('m-owner', 0, '08:40', 'Масло для массажа привезут в четверг.')] },
    ], assign: [], read: {} };
  }
  const o42 = objOf(db, 'obj-42');
  const dc = ((db.docs && db.docs.items) || []).find((d) => /42\/26/.test(d.title));
  const chats = [
    { id: 'ch-news', kind: 'announce', title: 'Альта · новости', unit: null, owner: 'm-owner', sources: [{ who: 'all', role: 'reader' }], msgs: [
      msg('m-owner', -1, '17:00', 'С 1 октября рабочие сообщения — в чатах Ортуса. Переписка остаётся у организации и хранится по политике, личные мессенджеры для работы не используем.'),
      msg('m-owner', 0, '09:00', { text: '4 ноября — выходной. Работы на объектах и рейсы в этот день не планируем, поставки переносим на 5 ноября.', important: { due: '31.10', acks: [{ member: 'm-kotova', ts: T(0, '09:20') }] } }),
    ] },
    { id: 'ch-drv', kind: 'area', title: 'Водители · Север Логистик', unit: 'f-msk-sever', owner: 'm-kotova', usedMb: 840,
      sources: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', role: 'member' }, { who: 'group', ref: 'g-drv', role: 'member' }, { who: 'group', ref: 'g-disp', role: 'moderator' }], msgs: [
      msg('m-kotova', -1, '18:10', 'Завтра с 8:00 мойка на Складе № 1 закрыта — заправляемся и моемся у МКАД.'),
      msg('m-vasiliev', -1, '18:24', 'Понял. Документы на А 412 МР 77 забрал.'),
      msg('m-kotova', 0, '08:05', { text: 'Регламент приёмки смены обновлён: фото одометра при сдаче обязательно. Подтвердите до 03.10.', important: { due: '03.10', acks: [] } }),
      msg('m-kotova', 0, '08:30', poll('Кто может выйти в субботу 04.10 на рейс Р-215?', ['Могу утром', 'Могу после 14:00', 'Не могу'], T(2, '18:00'), '03.10 в 18:00')),
      msg('sys', 0, '09:12', { sys: { mod: 'Логистика', icon: 'report', tone: 'danger', title: 'Критический дефект · М 608 КТ 77', text: 'Выезд заблокирован до решения менеджера', label: 'Открыть автопарк', nav: 'fleet' } }),
    ] },
    { id: 'ch-trip', kind: 'record', title: 'Рейс Р-208 · Северный маршрут', unit: 'f-msk-sever', owner: 'm-kotova', usedMb: 46, record: { kind: 'trip', id: 'Р-208', module: 'logistics', nav: 'fleet', label: 'Рейс Р-208' },
      sources: [{ who: 'tripDriver', trip: 'Р-208', role: 'member' }, { who: 'group', ref: 'g-disp', role: 'moderator' }], msgs: [
      msg('sys', 0, '07:40', { sys: { mod: 'Логистика', icon: 'local_shipping', tone: 'info', title: 'Рейс назначен: Илья Васильев', text: '01.10 · 09:00–13:00 · 46 км · сухой груз, 14 паллет-мест', label: 'Открыть рейс', nav: 'fleet' } }),
      msg('m-vasiliev', 0, '08:40', 'Беру А 412 МР 77, начинаю осмотр.'),
    ] },
    { id: 'ch-obj42', kind: 'record', title: (o42 && o42.name) || 'ЖК Речной · квартира 42', unit: (o42 && o42.unit) || null, owner: 'm-owner', usedMb: 4600, savedMb: 1100,
      record: { kind: 'object', id: 'obj-42', module: 'repair', nav: 'repair', label: 'Объект' }, topics: ['Общее', 'Снабжение', 'Приёмка', 'Допработы'],
      sources: [{ who: 'relation', obj: 'obj-42', role: 'member' }],
      hold: { reason: 'Претензия по кв. 42', period: '01.09–15.09', until: '01.12', by: 'm-owner', files: 6 },
      buckets: [
        { id: 'b1', kind: 'video', label: 'Видео', ageD: 120, n: 212, mb: 1900 }, { id: 'b2', kind: 'photo', label: 'Фото', ageD: 200, n: 340, mb: 500 },
        { id: 'b3', kind: 'photo', label: 'Фото', ageD: 12, n: 410, mb: 1500 }, { id: 'b4', kind: 'doc', label: 'Документы', ageD: 60, n: 30, mb: 300 },
        { id: 'b5', kind: 'voice', label: 'Голосовые', ageD: 45, n: 96, mb: 100 }, { id: 'b6', kind: 'voice', label: 'Голосовые', ageD: 5, n: 40, mb: 100 },
        { id: 'b7', kind: 'photo', label: 'Фото под удержанием', ageD: 25, n: 6, mb: 200, hold: true },
      ], msgs: [
      msg('m-owner', -1, '16:20', { topic: 'Снабжение', text: 'Фанеру ФК 15 мм выдали по заявке З-12, саморезы будут в пятницу.' }),
      msg('sys', 0, '10:38', { topic: 'Приёмка', sys: { mod: 'Ремонт и стройка', icon: 'construction', tone: 'info', title: 'Отметка на приёмке: штукатурка стен, 42 м²', text: 'Алексей Соколов · 6 фото · ждёт приёмки владельцем', label: 'Открыть объект', nav: 'repair', id: 'obj-42' } }),
      msg('m-sokolov', 0, '10:41', { topic: 'Общее', text: 'Стены в спальне готовы, можно принимать.', files: [F('Спальня · стена 1.jpg', 4.1, 'photo'), F('Спальня · стена 2.jpg', 3.8, 'photo'), F('Откосы.jpg', 3.2, 'photo')] }),
      msg('m-sokolov', 0, '10:47', { topic: 'Общее', text: 'Заказчик просит звонить заранее: +7 916 482-31-17.' }),
      msg('m-owner', 0, '10:49', { topic: 'Общее', text: 'Договор согласовали, утверждаю сегодня. Посмотрите раздел 2 про сроки.', doc: dc ? { kind: 'doc', ref: dc.id, title: dc.title, sub: 'Документы · v' + (dc.v || 1) } : null }),
      msg('m-owner', 0, '10:52', { topic: 'Общее', text: '4 ноября работы на объекте не ведём: дом закрыт для подрядчиков.', important: { due: '31.10', acks: [] } }),
      msg('m-owner', 0, '10:53', { topic: 'Общее', text: 'Пропуск на ноябрь.', spoiler: 'Код домофона на ноябрь: 0420', files: [F('Пропуск в ЖК · Соколов А.pdf', 0.3, 'doc', { viewOnce: true, opened: {} })] }),
      msg('m-owner', 0, '10:55', { topic: 'Общее', ...poll('Когда принимаем штукатурку?', ['Чт 02.10 · 10:00', 'Чт 02.10 · 15:00', 'Пт 03.10 · 11:00'], T(1, '09:00'), '02.10 в 09:00') }),
    ] },
    { id: 'ch-dkv', kind: 'direct', pair: ['m-kotova', 'm-vasiliev'], msgs: [
      msg('m-kotova', 0, '07:50', 'Илья, Р-208 за тобой. Машину выберешь в «Сегодня».'),
      msg('m-vasiliev', 0, '07:52', 'Принял.'),
      msg('m-kotova', 0, '07:55', { text: 'Код от ворот склада на сегодня:', spoiler: '4471', temp: { exp: T(1, '07:55'), h: 24 } }),
    ] },
    { id: 'ch-dzs', kind: 'direct', pair: ['m-owner', 'm-sokolov'], msgs: [
      msg('m-owner', -1, '16:40', 'Алексей, по кв. 42 жду фото стен до пятницы.'),
      msg('m-sokolov', -1, '16:55', 'Хорошо, завтра отправлю в чат объекта.'),
    ] },
  ];
  const read = { 'ch-news': { 'm-owner': 2, 'm-kotova': 2 }, 'ch-drv': { 'm-kotova': 5, 'm-vasiliev': 2, 'm-kotelnikova': 4 }, 'ch-trip': { 'm-kotova': 2, 'm-vasiliev': 2 },
    'ch-obj42': { 'm-owner': 8, 'm-sokolov': 4 }, 'ch-dkv': { 'm-kotova': 3, 'm-vasiliev': 2 }, 'ch-dzs': { 'm-owner': 2, 'm-sokolov': 2 } };
  const assign = [
    { id: 'ach-1', member: 'm-kotova', role: 'r-chat-owner', scope: { type: 'chat', id: 'ch-drv' } },
    { id: 'ach-2', member: 'm-kotelnikova', role: 'r-chat-reader', scope: { type: 'chat', id: 'ch-drv' } },
    { id: 'ach-3', member: 'm-ilyin', role: 'r-chat-reader', scope: { type: 'chat', id: 'ch-obj42' } },
    { id: 'ach-4', member: 'm-kotova', role: 'r-chat-creator', scope: { type: 'firm', id: 'f-msk-sever' } },
  ];
  return { chats, assign, read };
}

/** Установка модуля в «БД» организации. Повторный вызов ничего не меняет. */
export function installChats(db, M) {
  if (db.chats && db.chats.v1) return;
  CHAT_ROLES.forEach((r) => { if (!db.roles.some((x) => x.id === r.id)) db.roles.push(clone(r)); });
  const act = (id, a) => { const r = db.roles.find((x) => x.id === id); if (r && !(r.actions && r.actions.chat)) r.actions = { ...(r.actions || {}), chat: a }; };
  act('r-manager', ['view', 'create', 'edit', 'review']); act('r-driver', ['view', 'create']); act('r-foreman', ['view', 'create']); act('r-therapist', ['view', 'create']); act('r-admin', ['view', 'create', 'edit', 'review']);
  const x = seedChats(db);
  x.assign.forEach((a) => { if (!db.assignments.some((y) => y.id === a.id) && mem(db, a.member)) db.assignments.push(a); });
  x.chats.forEach((c) => {
    c.msgs.forEach((m, i) => { m.seq = i + 1; });
    c.seq = c.msgs.length; c.last = c.msgs.length ? c.msgs[c.msgs.length - 1].ts : 0;
    c.lastRead = (x.read[c.id] || {});
    Object.entries(c.lastRead).forEach(([mid, upto]) => c.msgs.forEach((m, i) => { if (m.seq <= upto && m.by !== mid) m.reads[mid] = m.ts + 2 + (i % 5); }));
    c.msgs.forEach((m) => { if (m.by !== 'sys') m.reads[m.by] = m.ts; });
    c.usedMb = c.usedMb || 0; c.journal = []; c.status = 'active'; c.sensitivity = c.sensitivity || 'normal';
  });
  db.chats = { v1: true, now: 11 * 60 + 5, policy: clone(DEFAULT_POLICY), items: x.chats };
}

// ── Ответ сервера участнику ──
const PHONE = /(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*(\d{2})/g;
export const maskPdn = (t) => String(t || '').replace(PHONE, (_, a, last) => '+7 ••• •••-••-' + last);
export const hasPdn = (t) => { PHONE.lastIndex = 0; const r = PHONE.test(String(t || '')); PHONE.lastIndex = 0; return r; };

export function chatsView(db, M, actor, C) {
  if (!C || !db.chats) return C;
  const now = db.chats.now, items = [];
  C.items.forEach((cc) => {
    const c0 = db.chats.items.find((x) => x.id === cc.id); if (!c0) return;
    const r = chatRights(db, M, actor, c0); if (!r.ok) return;
    const P = r.P, mod = r.can.mod;
    const msgs = (cc.msgs || []).filter((m) => (!m.visibleTo || m.visibleTo.includes(actor)) && !(m.temp && m.temp.exp <= now)).map((m) => {
      const x = { ...m };
      if (m.deleted) { x.text = ''; x.files = []; x.doc = null; x.poll = null; x.spoiler = null; x.important = null; x.deleted = { mod: m.deleted.mod, reason: m.deleted.mod ? m.deleted.reason : '', ts: m.deleted.ts, by: m.deleted.by }; }
      x.pdn = hasPdn(m.text); x.revealed = (m.revealed || []).includes(actor);
      if (x.pdn && !x.revealed) x.text = maskPdn(m.text);
      delete x.edits; x.edited = (m.edits || []).length; x.editLog = mod || m.by === actor ? (m.edits || []).map((e) => ({ text: x.pdn && !x.revealed ? maskPdn(e.text) : e.text, ts: e.ts })) : [];
      const others = Object.keys(m.reads || {}).filter((k) => k !== m.by);
      x.readN = others.length;
      x.reads = P.rcpt === 'who' && (m.by === actor || mod) ? others.map((k) => ({ id: k, ts: m.reads[k] })) : [];
      if (P.rcpt === 'off') x.readN = -1;
      if (m.files) x.files = m.files.map((f) => ({ ...f, opened: f.viewOnce ? !!(f.opened || {})[actor] : false, openedN: f.viewOnce ? Object.keys(f.opened || {}).length : 0 }));
      if (m.important) { const a = m.important.acks || []; x.important = { due: m.important.due, n: a.length, mine: a.some((y) => y.member === actor), list: m.by === actor || mod ? a.map((y) => ({ id: y.member, ts: y.ts })) : [] }; }
      if (m.poll) {
        const p = m.poll, all = Object.values(p.votes || {}).reduce((s, v) => s.concat(v), []);
        x.poll = { ...p, closed: p.closed || now >= p.closes, total: new Set(all).size, opts: p.opts.map((o) => { const v = (p.votes || {})[o.id] || []; return { ...o, n: v.length, mine: v.includes(actor), who: p.anon ? [] : v }; }), mine: all.includes(actor) };
        delete x.poll.votes;
      }
      return x;
    });
    const lr = (c0.lastRead || {})[actor] || 0;
    const unread = msgs.filter((m) => m.seq > lr && m.by !== actor).length;
    const ackWait = msgs.filter((m) => m.important && !m.important.mine && m.by !== actor && !m.deleted).map((m) => m.id);
    const peers = c0.kind === 'direct' ? (c0.pair || []).filter((k) => k !== actor) : [];
    const { chain, vb, ...acc } = r;
    items.push({ ...cc, msgs, sources: cc.sources || [], buckets: r.can.settings ? cc.buckets || [] : [], journal: r.can.settings ? cc.journal || [] : [],
      my: { ...acc, chain, unread, ackWait, peer: peers[0] || null }, P });
  });
  return { ...C, items };
}

// ── Команды mock-адаптера ──
export function chatsApi({ getDb, getActor, cmd, ApiError, M, event }) {
  const D = getDb, me = () => getActor();
  const X = () => { const x = D().chats; if (!x) throw new ApiError('not_found', 'Модуль «Чаты» не подключён'); return x; };
  const chat = (id) => { const c = X().items.find((x) => x.id === id); if (!c) throw new ApiError('not_found', 'Чат не найден'); return c; };
  const R = (c) => chatRights(D(), M, me(), c);
  const need = (c, k, why) => { const r = R(c); if (!r.ok) throw new ApiError('not_found', 'Чат не найден или недоступен'); if (k && !r.can[k]) throw new ApiError('forbidden', why || 'Недостаточно прав'); return r; };
  const find = (id) => { for (const c of X().items) { const m = (c.msgs || []).find((x) => x.id === id); if (m) return [c, m]; } throw new ApiError('not_found', 'Сообщение не найдено'); };
  const meName = () => (mem(D(), me()) || {}).name || '—';
  const tick = (n) => { X().now += n || 1; return X().now; };
  const inIds = (c) => D().members.filter((m) => chatAccess(D(), M, m.id, c).ok).map((m) => m.id);
  const post = (c, o, by) => {
    const m = { id: 'cm-' + D().seq++, seq: (c.seq = (c.seq || 0) + 1), ts: tick(1), by: by || me(), text: '', reads: {}, ...o };
    if (m.by !== 'sys') m.reads[m.by] = m.ts;
    c.msgs.push(m); c.last = m.ts; if (m.by !== 'sys') c.lastRead = { ...(c.lastRead || {}), [m.by]: m.seq }; return m;
  };
  const sys = (c, title, text, icon, tone) => post(c, { sys: { mod: 'Чаты', icon: icon || 'info', tone: tone || 'neutral', title, text: text || '' } }, 'sys');
  const journal = (c, text) => { (c.journal = c.journal || []).unshift({ ts: X().now, by: me(), text }); };
  const held = (c, m) => !!(c.hold && m.held);
  const freeFor = (c, P, add) => {
    if (!P.quotaMb || c.usedMb + add <= P.quotaMb) { c.usedMb += add; return null; }
    const over = c.usedMb + add - P.quotaMb, bs = (c.buckets || []).filter((b) => !b.hold && b.mb > 0).sort((a, b) => b.ageD - a.ageD);
    if (P.onFull === 'ring' || P.onFull === 'archive') {
      let freed = 0, n = 0;
      for (const b of bs) { if (freed >= over) break; const take = Math.min(b.mb, over - freed), k = Math.max(1, Math.round(b.n * take / b.mb)); b.mb -= take; b.n = Math.max(0, b.n - k); freed += take; n += k; }
      if (freed < over) throw new ApiError('validation', 'Место чата заполнено, а удалить можно только сохранённое в запись или под удержанием. Освободите место вручную');
      if (P.onFull === 'archive') c.archivedMb = (c.archivedMb || 0) + freed;
      c.buckets = c.buckets.filter((b) => b.mb > 0); c.usedMb += add - freed;
      sys(c, P.onFull === 'ring' ? 'Удалены старые вложения: место чата' : 'Старые вложения перенесены в архив', plural(n, 'файл', 'файла', 'файлов') + ' · ' + gb(freed) + (P.onFull === 'archive' ? ' · открываются по запросу за 1–3 минуты' : ' · сохранённое в запись и под удержанием не тронуто'), P.onFull === 'ring' ? 'autorenew' : 'inventory_2');
      return freed;
    }
    if (P.onFull === 'compress') {
      let freed = 0; bs.filter((b) => (b.kind === 'photo' || b.kind === 'video') && b.ageD > 30 && !b.compressed).forEach((b) => { const f = Math.round(b.mb * 0.4); b.mb -= f; b.compressed = true; freed += f; });
      c.usedMb -= freed;
      if (freed) sys(c, 'Медиа сжато: место чата', 'Освобождено ' + gb(freed) + ' · оригиналы удалятся через 14 дней', 'compress');
      if (c.usedMb + add <= P.quotaMb) { c.usedMb += add; return freed; }
    }
    throw new ApiError('validation', 'Место чата заполнено: ' + gb(c.usedMb) + ' из ' + gb(P.quotaMb) + '. Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»');
  };
  const inArea = (db, creator, unit) => creator.all || (unit && M.grants(db, me()).some((g) => (g.roleObj.actions?.chat || []).includes('edit') && g.scope && M.scopeCovers(db, g.scope, unit)));
  const checkSources = (db, list, unit) => {
    const own = verbs(db, M, me()).all;
    return (list || []).map((s) => {
      if (!['all', 'group', 'role', 'member', 'relation', 'tripDriver'].includes(s.who)) throw new ApiError('validation', 'Неизвестный источник состава');
      if (!RANK[s.role]) throw new ApiError('validation', 'Выберите роль в чате');
      if (!own && s.role === 'owner') throw new ApiError('forbidden', 'Владельца чата назначает владелец бизнеса');
      if (!own && s.who === 'all') throw new ApiError('forbidden', '«Все сотрудники» добавляет владелец бизнеса');
      if (!own && s.who === 'role' && !(s.unit && s.unit === unit)) throw new ApiError('forbidden', 'Роль добавляется только в вашей области «' + unitName(db, unit) + '»');
      if (!own && s.who === 'member') {
        const ok = M.grants(db, s.ref).some((g) => g.scope && ((['firm', 'region'].includes(g.scope.type) && M.scopeCovers(db, g.scope, unit)) || (g.scope.type === 'project' && ((db.projects || []).find((p) => p.id === g.scope.id) || {}).unit === unit)));
        if (!ok) throw new ApiError('forbidden', (mem(db, s.ref) || {}).name + ': вне вашей области «' + unitName(db, unit) + '» — добавить может владелец или руководитель области');
      }
      return { who: s.who, ref: s.ref || null, unit: s.unit || null, obj: s.obj || null, trip: s.trip || null, role: s.role };
    });
  };
  const preview = (db, c) => {
    const ppl = chatPeople(db, M, c);
    return { joined: ppl.filter((p) => p.st === 'in'), pending: ppl.filter((p) => p.st === 'pending'), skipped: ppl.filter((p) => p.st === 'out') };
  };

  return {
    chatOpen: (id) => cmd(() => {
      const c = chat(id); need(c); const now = X().now;
      c.msgs.forEach((m) => { if (m.by !== me() && m.by !== 'sys' && !(m.reads || {})[me()]) m.reads[me()] = now; });
      c.lastRead = { ...(c.lastRead || {}), [me()]: c.seq }; return { ok: true };
    }, 0, false),

    chatSend: (id, spec) => cmd(() => {
      const c = chat(id), s = spec || {};
      const r = need(c, 'write', c.kind === 'announce' ? 'В объявлениях пишут модераторы' : c.status === 'archived' ? 'Чат в архиве: только чтение' : 'У вас роль «Читатель»: можно читать, голосовать и подтверждать');
      const P = r.P, text = String(s.text || '').trim(), files = (s.files || []).map((f) => F(String(f.name), Number(f.mb) || 0, f.kind || 'doc'));
      if (!text && !files.length && !s.doc && !s.poll) throw new ApiError('validation', 'Напишите сообщение или прикрепите файл');
      if (text.length > 4000) throw new ApiError('validation', 'Больше 4000 знаков: длинный текст удобнее оформить страницей Базы знаний');
      if (s.important && !r.can.announce) throw new ApiError('forbidden', 'Важное с подтверждением отправляют модераторы с правом «Чаты · Решать»');
      if (/(^|\s)@все(\s|$|[,.!?])/i.test(text) && !r.can.announce) throw new ApiError('forbidden', '@все — только у модераторов с правом «Чаты · Решать»');
      if (s.temp && !r.can.temp) throw new ApiError('forbidden', 'Временные сообщения в этом чате запрещены политикой вида «' + CHAT_KINDS[c.kind].label + '»');
      if (s.viewOnce && !r.can.viewOnce) throw new ApiError('forbidden', 'Одноразовые файлы отправляют модераторы, если это разрешает политика');
      if (s.viewOnce && !files.length) throw new ApiError('validation', 'Прикрепите файл для одноразового просмотра');
      let pollObj = null;
      if (s.poll) {
        const q = String(s.poll.q || '').trim(), opts = (s.poll.opts || []).map((o) => String(o || '').trim()).filter(Boolean);
        if (!q) throw new ApiError('validation', 'Напишите вопрос опроса'); if (opts.length < 2) throw new ApiError('validation', 'Нужно минимум два варианта');
        if (opts.length > 10) throw new ApiError('validation', 'Не больше 10 вариантов');
        const hrs = Math.min(168, Math.max(1, Number(s.poll.hours) || 24));
        pollObj = { q, opts: opts.map((t, i) => ({ id: 'o' + (i + 1), t })), votes: {}, voters: [], anon: !!s.poll.anon, multi: !!s.poll.multi, closes: X().now + hrs * 60, closesLabel: tsDay(X().now + hrs * 60) + ' в ' + tsTime(X().now + hrs * 60), closed: false };
      }
      if (files.length) {
        const big = files.find((f) => f.mb > P.maxMb); if (big) throw new ApiError('validation', '«' + big.name + '» больше ' + gb(P.maxMb) + ' — предел политики вида «' + CHAT_KINDS[c.kind].label + '»');
        const add = files.reduce((a, f) => a + f.mb, 0); freeFor(c, P, add);
        const kb = { photo: 'photo', video: 'video', voice: 'voice' };
        files.forEach((f) => { const k = kb[f.kind] || 'doc'; const b = (c.buckets = c.buckets || []).find((x) => x.kind === k && x.ageD === 0 && !x.hold); if (b) { b.n++; b.mb += f.mb; } else c.buckets.push({ id: 'b' + D().seq++, kind: k, label: { photo: 'Фото', video: 'Видео', voice: 'Голосовые', doc: 'Документы' }[k], ageD: 0, n: 1, mb: f.mb }); });
      }
      const m = post(c, {
        topic: c.topics ? s.topic || c.topics[0] : null, text, files: files.length ? files.map((f) => (s.viewOnce ? { ...f, viewOnce: true, opened: {} } : f)) : null,
        doc: s.doc ? { kind: s.doc.kind || 'doc', ref: s.doc.ref, title: s.doc.title, sub: s.doc.sub || '' } : null,
        important: s.important ? { due: s.due || '—', acks: [] } : null, temp: s.temp ? { exp: X().now + Number(s.temp) * 60, h: Number(s.temp) } : null,
        spoiler: s.spoiler ? String(s.spoiler).slice(0, 300) : null, ...(pollObj ? { kind: 'poll', poll: pollObj } : {}),
      });
      const ids = inIds(c).filter((k) => k !== me());
      if (s.important || /@все/i.test(text)) event((s.important ? 'Важное в «' : 'Вас упомянули в «') + chatTitle(D(), c, me()) + '»: ' + (text || 'сообщение').slice(0, 60), ids);
      (D().members || []).forEach((mm) => { if (mm.id !== me() && text.includes('@' + mm.name.split(' ')[0])) event(meName() + ' упомянул(а) вас в «' + chatTitle(D(), c, me()) + '»', [mm.id]); });
      if (c.kind === 'direct') event(meName() + ': ' + (text || 'файл').slice(0, 60), ids);
      return { id: m.id };
    }, 240),

    chatEdit: (msgId, text) => cmd(() => {
      const [c, m] = find(msgId); const r = need(c); const t = String(text || '').trim();
      if (m.by !== me()) throw new ApiError('forbidden', 'Править можно только свои сообщения');
      if (m.deleted) throw new ApiError('validation', 'Сообщение удалено');
      if (!t) throw new ApiError('validation', 'Текст не может быть пустым — удалите сообщение');
      if (X().now - m.ts > EDIT_MIN[r.P.edit]) throw new ApiError('validation', 'Окно правки закрыто: ' + EDIT_LABEL[r.P.edit] + ' по политике вида «' + CHAT_KINDS[c.kind].label + '»');
      if (t === m.text) return { same: true };
      (m.edits = m.edits || []).push({ text: m.text, ts: X().now }); m.text = t; tick(1); return { ok: true };
    }, 200),

    chatDelete: (msgId, reason) => cmd(() => {
      const [c, m] = find(msgId); const r = need(c); if (m.deleted) throw new ApiError('validation', 'Сообщение уже удалено');
      if (held(c, m)) throw new ApiError('validation', 'Нельзя удалить: удержание «' + c.hold.reason + '» до ' + c.hold.until);
      const own = m.by === me(), inWin = X().now - m.ts <= EDIT_MIN[r.P.edit];
      if (own && !inWin && !r.can.mod) throw new ApiError('forbidden', 'Окно удаления закрыто: ' + EDIT_LABEL[r.P.edit] + '. Попросите модератора');
      if (!own && !r.can.mod) throw new ApiError('forbidden', 'Чужие сообщения удаляют модераторы');
      const why = String(reason || '').trim(); if (!own && !why) throw new ApiError('validation', 'Укажите причину — её увидят участники');
      m.deleted = { by: me(), ts: X().now, mod: !own, reason: why, keepUntil: X().now + r.P.delD * 1440 };
      journal(c, (own ? 'Удалено автором' : 'Удалено модератором: ' + why) + ' · сообщение от ' + tsLabel(m.ts, X().now)); return { ok: true };
    }, 220),

    chatAck: (msgId) => cmd(() => {
      const [c, m] = find(msgId); need(c); if (!m.important) throw new ApiError('validation', 'Подтверждение не запрошено');
      if (m.by === me()) throw new ApiError('validation', 'Своё сообщение подтверждать не нужно');
      if (m.important.acks.some((a) => a.member === me())) return { already: true };
      m.important.acks.push({ member: me(), ts: tick(1) }); m.reads[me()] = m.reads[me()] || X().now;
      const left = inIds(c).filter((k) => k !== m.by && !m.important.acks.some((a) => a.member === k)).length;
      if (!left) event('Все подтвердили «' + m.text.slice(0, 50) + '»', [m.by]);
      return { left };
    }, 220),

    chatVote: (msgId, optIds) => cmd(() => {
      const [c, m] = find(msgId); need(c); const p = m.poll; if (!p) throw new ApiError('validation', 'Это не опрос');
      if (p.closed || X().now >= p.closes) throw new ApiError('validation', 'Опрос закрыт ' + p.closesLabel);
      const ids = (optIds || []).filter((o) => p.opts.some((x) => x.id === o)); if (!ids.length) throw new ApiError('validation', 'Выберите вариант');
      if (!p.multi && ids.length > 1) throw new ApiError('validation', 'В этом опросе один вариант');
      Object.keys(p.votes).forEach((k) => { p.votes[k] = p.votes[k].filter((x) => x !== me()); });
      ids.forEach((o) => { (p.votes[o] = p.votes[o] || []).push(me()); }); return { ok: true };
    }, 200),

    chatPollClose: (msgId) => cmd(() => {
      const [c, m] = find(msgId); const r = need(c); if (!m.poll) throw new ApiError('validation', 'Это не опрос');
      if (m.by !== me() && !r.can.mod) throw new ApiError('forbidden', 'Закрыть опрос может автор или модератор');
      m.poll.closed = true; const top = m.poll.opts.map((o) => [o.t, ((m.poll.votes || {})[o.id] || []).length]).sort((a, b) => b[1] - a[1])[0];
      sys(c, 'Опрос закрыт: «' + m.poll.q + '»', top && top[1] ? 'Больше всего голосов: ' + top[0] + ' · ' + top[1] : 'Голосов нет', 'ballot', 'ok'); return { ok: true };
    }, 220),

    chatPin: (msgId) => cmd(() => { const [c] = find(msgId); need(c, 'pin', 'Закрепляют модераторы'); c.pinned = c.pinned === msgId ? null : msgId; return { pinned: c.pinned }; }, 180),

    chatReveal: (msgId) => cmd(() => {
      const [c, m] = find(msgId); need(c, 'pdn', 'Номер скрыт: нужно право «ПДн без маски»');
      (m.revealed = m.revealed || []).includes(me()) || m.revealed.push(me()); journal(c, meName() + ' раскрыл(а) ПДн в сообщении от ' + tsLabel(m.ts, X().now)); return { ok: true };
    }, 200),

    chatOpenOnce: (msgId) => cmd(() => {
      const [c, m] = find(msgId); need(c); const f = (m.files || []).find((x) => x.viewOnce); if (!f) throw new ApiError('validation', 'Файл не одноразовый');
      if (m.by === me()) throw new ApiError('validation', 'Автор одноразового файла его не открывает: файл видят только получатели');
      if ((f.opened || {})[me()]) throw new ApiError('validation', 'Вы уже открыли этот файл — он больше не откроется');
      f.opened = { ...(f.opened || {}), [me()]: X().now }; journal(c, meName() + ' открыл(а) одноразовый файл «' + f.name + '»'); return { name: f.name };
    }, 260),

    chatSaveTo: (msgId) => cmd(() => {
      const [c, m] = find(msgId); need(c, 'saveTo', 'Сохранять в запись могут участники чата записи');
      const fs = (m.files || []).filter((f) => !f.savedTo && !f.viewOnce); if (!fs.length) throw new ApiError('validation', 'Нечего сохранять: файлы уже в записи');
      const mb = fs.reduce((a, f) => a + f.mb, 0); fs.forEach((f) => { f.savedTo = c.record.label || c.record.id; });
      c.usedMb = Math.max(0, c.usedMb - mb); c.savedMb = (c.savedMb || 0) + mb;
      const b = (c.buckets || []).find((x) => x.ageD === 0 && x.kind === 'photo'); if (b) { b.mb = Math.max(0, b.mb - mb); b.n = Math.max(0, b.n - fs.length); }
      journal(c, meName() + ' сохранил(а) ' + plural(fs.length, 'файл', 'файла', 'файлов') + ' в запись · ' + gb(mb)); return { n: fs.length, mb };
    }, 260),

    chatToTask: (msgId) => cmd(() => {
      const db = D(), [c, m] = find(msgId); need(c, 'task', 'Создавать задачи может роль с правом «Задачи · Создавать»');
      const title = (String(m.text || (m.poll && m.poll.q) || 'Сообщение из чата').replace(/\s+/g, ' ').slice(0, 80)) || 'Сообщение из чата';
      const proj = c.unit === 'f-msk-sever' ? 'fleet' : ((db.projects || []).find((p) => p.flow !== 'leads') || {}).id || 'fleet';
      const id = 'T-' + (70 + db.seq++);
      db.tasks.unshift({ id, title, assignee: meName(), status: 'Новая', priority: 'normal', due: '—', project: proj, checklist: [], comments: [{ by: meName(), at: tsTime(X().now), text: 'Из чата «' + chatTitle(db, c, me()) + '»' }], links: [{ kind: 'chat', id: c.id, label: 'Чат «' + chatTitle(db, c, me()) + '»' }] });
      (m.tasks = m.tasks || []).push(id); return { id };
    }, 300),

    chatCreate: (spec, dryRun) => cmd(() => {
      const db = D(), s = spec || {}, vb = verbs(db, M, me());
      if (!vb.all && !vb.has('edit')) throw new ApiError('forbidden', 'Создавать групповые чаты может роль с правом «Чаты · Изменять»');
      const kind = ['group', 'area', 'announce'].includes(s.kind) ? s.kind : 'group';
      const unit = s.unit || null;
      if (!vb.all && !inArea(db, vb, unit)) throw new ApiError('forbidden', 'Чат можно создать только в своей области');
      if (kind === 'announce' && !vb.all) throw new ApiError('forbidden', 'Чаты объявлений создаёт владелец бизнеса');
      if (s.label === 'finance' && !vb.all) throw new ApiError('forbidden', 'Метку «Финансы» ставит владелец бизнеса');
      const title = String(s.title || '').trim(); if (!dryRun && title.length < 3) throw new ApiError('validation', 'Название — не короче 3 символов');
      const srcs = checkSources(db, s.sources, unit);
      const draft = { id: 'ch-' + db.seq, kind, title: title || 'Новый чат', unit, owner: me(), sources: srcs.filter((x) => x.who !== 'member'), sensitivity: s.label === 'finance' ? 'finance' : s.label === 'pdn' ? 'pdn' : 'normal', history: s.history || 'all', msgs: [], seq: 0, usedMb: 0, journal: [], status: 'active', lastRead: {} };
      const named0 = srcs.filter((x) => x.who === 'member');
      const tmpA = named0.map((x, i) => ({ id: 'tmp-' + i, member: x.ref, role: ROLE_ID[x.role], scope: { type: 'chat', id: draft.id } }));
      if (!vb.all) tmpA.push({ id: 'tmp-own', member: me(), role: 'r-chat-owner', scope: { type: 'chat', id: draft.id } });
      const db2 = { ...db, assignments: db.assignments.concat(tmpA) };
      const pv = preview(db2, draft);
      if (dryRun) return pv;
      db.seq++; db.assignments.push(...tmpA.map((a) => ({ ...a, id: 'ach-' + db.seq++ })));
      X().items.unshift(draft); sys(draft, 'Чат создан · ' + meName(), CHAT_KINDS[kind].one + (unit ? ' · ' + unitName(db, unit) : ''), 'add_comment', 'ok');
      const ids = pv.joined.map((p) => p.id).filter((k) => k !== me()); if (ids.length) event('Вас добавили в чат «' + draft.title + '»', ids);
      return { id: draft.id, ...pv };
    }, 300),

    chatSources: (id, sources, dryRun) => cmd(() => {
      const db = D(), c = chat(id), r = need(c, 'members', 'Состав меняют владелец чата и модераторы с правом «Чаты · Решать»');
      const srcs = checkSources(db, sources, c.unit), cur = c.sources;
      const draft = { ...c, sources: srcs.filter((x) => x.who !== 'member') };
      const keepNamed = db.assignments.filter((a) => !(a.scope && a.scope.type === 'chat' && a.scope.id === c.id && a.role !== 'r-chat-owner'));
      const newNamed = srcs.filter((x) => x.who === 'member').map((x) => ({ id: 'ach-' + db.seq + '-' + x.ref, member: x.ref, role: ROLE_ID[x.role], scope: { type: 'chat', id: c.id } }));
      const db2 = { ...db, assignments: keepNamed.concat(newNamed) };
      const before = chatPeople(db, M, c).filter((p) => p.st === 'in').map((p) => p.id), pv = preview(db2, draft);
      const after = pv.joined.map((p) => p.id);
      const res = { ...pv, gain: after.filter((k) => !before.includes(k)), lose: before.filter((k) => !after.includes(k)) };
      if (dryRun) return res;
      c.sources = draft.sources; db.assignments = keepNamed.concat(newNamed); db.seq++;
      if (res.gain.length) event('Вас добавили в чат «' + c.title + '»', res.gain);
      sys(c, 'Состав изменён · ' + meName(), (res.gain.length ? 'Вошли: ' + res.gain.map((k) => mem(db, k).name).join(', ') : '') + (res.lose.length ? (res.gain.length ? ' · ' : '') + 'Вышли: ' + res.lose.map((k) => mem(db, k).name).join(', ') : '') || 'Состав не изменился', 'group', 'neutral');
      void cur; void r; return res;
    }, 300),

    chatSetFull: (id, mode) => cmd(() => {
      const c = chat(id); need(c, 'settings', 'Менять настройки хранения может владелец чата'); if (!FULL_LABEL[mode]) throw new ApiError('validation', 'Неизвестный режим');
      c.over = { ...(c.over || {}), onFull: mode }; journal(c, 'При заполнении: ' + FULL_LABEL[mode]); return { ok: true };
    }, 200),

    chatCleanup: (id, filters, dryRun) => cmd(() => {
      const c = chat(id); need(c, 'settings', 'Очищать чат может его владелец');
      const F0 = { video90: (b) => b.kind === 'video' && b.ageD > 90, photo180: (b) => b.kind === 'photo' && b.ageD > 180, voice30: (b) => b.kind === 'voice' && b.ageD > 30, docs30: (b) => b.kind === 'doc' && b.ageD > 30 };
      const fl = (filters || []).filter((k) => F0[k]); if (!fl.length) throw new ApiError('validation', 'Выберите, что удалить');
      const hit = (c.buckets || []).filter((b) => !b.hold && fl.some((k) => F0[k](b)));
      const n = hit.reduce((a, b) => a + b.n, 0), mb = hit.reduce((a, b) => a + b.mb, 0), heldB = (c.buckets || []).filter((b) => b.hold);
      const P = policyOf(D(), c);
      const res = { n, mb, after: c.usedMb - mb, quota: P.quotaMb, saved: c.savedMb || 0, held: heldB.reduce((a, b) => a + b.n, 0), heldMb: heldB.reduce((a, b) => a + b.mb, 0) };
      if (dryRun) return res;
      if (!n) throw new ApiError('validation', 'Под фильтр ничего не попало');
      c.buckets = c.buckets.filter((b) => !hit.includes(b)); c.usedMb -= mb;
      sys(c, 'Вложения удалены очисткой · ' + meName(), plural(n, 'файл', 'файла', 'файлов') + ' · ' + gb(mb) + '. Подписи, превью и ответы остались', 'cleaning_services', 'warn');
      journal(c, 'Очистка: ' + plural(n, 'файл', 'файла', 'файлов') + ' · ' + gb(mb)); return res;
    }, 320),

    chatPolicySet: (kind, patch, dryRun) => cmd(() => {
      const db = D(); if (!verbs(db, M, me()).all) throw new ApiError('forbidden', 'Политики чатов меняет владелец бизнеса');
      if (!CHAT_KINDS[kind]) throw new ApiError('validation', 'Неизвестный вид чата');
      const cur = db.chats.policy[kind], nx = { ...cur, ...(patch || {}) };
      Object.entries(BOUNDS).forEach(([k, [a, b]]) => { if (nx[k] < a || nx[k] > b) throw new ApiError('validation', 'Значение вне пределов организации: ' + a + '–' + b); });
      const cs = X().items.filter((c) => c.kind === kind), notes = [];
      const ppl = new Set(); cs.forEach((c) => chatPeople(db, M, c).filter((p) => p.st === 'in').forEach((p) => ppl.add(p.id)));
      notes.push(['groups', 'info', plural(cs.length, 'чат', 'чата', 'чатов') + ' вида «' + CHAT_KINDS[kind].label + '», ' + plural(ppl.size, 'сотрудник', 'сотрудника', 'сотрудников') + ': новые значения — сразу']);
      if (nx.rcptD < cur.rcptD) notes.push(['delete_sweep', 'warn', 'Отметки прочтения старше ' + nx.rcptD + ' дней удалятся. Подтверждения важного не затрагиваются']);
      if (nx.rcpt !== cur.rcpt) notes.push(['done_all', 'info', 'Прочтение: «' + RCPT_LABEL[cur.rcpt] + '» → «' + RCPT_LABEL[nx.rcpt] + '»']);
      if (EDIT_MIN[nx.edit] < EDIT_MIN[cur.edit]) notes.push(['edit_off', 'warn', 'Правка своих — ' + EDIT_LABEL[nx.edit] + ' вместо ' + EDIT_LABEL[cur.edit] + ': отправленное раньше уже не правится']);
      if (nx.filesD < cur.filesD) { const mb = cs.reduce((a, c) => a + (c.buckets || []).filter((b) => !b.hold && b.ageD > nx.filesD).reduce((s, b) => s + b.mb, 0), 0); notes.push(['delete', 'danger', 'Вложения старше ' + nx.filesD + ' дней удалятся: около ' + gb(mb) + '. Сохранённое в запись и под удержанием останется']); }
      if (nx.textY < cur.textY) notes.push(['delete', 'danger', 'Текст старше ' + nx.textY + ' лет удалится по новому сроку']);
      if (nx.temp !== cur.temp) notes.push(['timer', 'neutral', 'Временные: «' + TEMP_LABEL[cur.temp] + '» → «' + TEMP_LABEL[nx.temp] + '»']);
      if (nx.maxMb !== cur.maxMb) notes.push(['attach_file', 'neutral', 'Файл до ' + gb(nx.maxMb) + ' вместо ' + gb(cur.maxMb)]);
      if (notes.length === 1) notes.push(['check_circle', 'ok', 'Сообщения и файлы не удаляются']);
      if (dryRun) return { notes };
      db.chats.policy[kind] = nx; cs.forEach((c) => sys(c, 'Политика вида изменена · ' + meName(), notes.slice(1).map((x) => x[2]).join(' · '), 'policy', 'neutral'));
      return { notes };
    }, 300),

    chatTick: (hours) => cmd(() => {
      const h = Math.max(1, Math.min(72, Number(hours) || 24)), now = tick(h * 60); let gone = 0, once = 0;
      X().items.forEach((c) => {
        const keep = []; c.msgs.forEach((m) => { if (m.temp && m.temp.exp <= now && !held(c, m)) { gone++; (c.journal = c.journal || []).unshift({ ts: now, by: 'sys', text: 'Временное сообщение от ' + tsLabel(m.ts, now) + ' исчезло по таймеру' }); } else keep.push(m); });
        c.msgs = keep;
        c.msgs.forEach((m) => (m.files || []).forEach((f) => { const t = Object.values(f.opened || {}); if (f.viewOnce && !f.gone && t.length && now - Math.min(...t) >= 1440) { f.gone = true; once++; } }));
      });
      return { gone, once, now };
    }, 200, false),
  };
}

export function chatTitle(db, c, actor) {
  if (c.kind !== 'direct') return c.title;
  const o = (c.pair || []).find((k) => k !== actor) || (c.pair || [])[0];
  return (mem(db, o) || {}).name || 'Личный чат';
}
