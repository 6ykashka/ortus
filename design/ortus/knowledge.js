// База знаний: пространства, дерево подстраниц и доступ по ролям (docs/23-knowledge-spaces.md).
// Доступ проходит цепочку: организация → пространство → каждый родитель → страница → функция сотрудника.
// Подстраница наследует и чтение, и правку; свой доступ может только сузить круг читателей.

const p2 = (n) => String(n).padStart(2, '0');
export const KB_TODAY = '01.10.2026';
const hm = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const dval = (s) => { const m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s || ''); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };
const plus30 = () => '31.10.2026';

const FIN0 = { read: false, manage: false };
export const KB_ROLES = [
  { id: 'r-kb-lead', name: 'Руководитель пространства', kind: 'template', space: true, actions: { knowledge: ['view', 'create', 'edit', 'review', 'settings'] }, finance: FIN0 },
  { id: 'r-kb-editor', name: 'Редактор', kind: 'template', space: true, actions: { knowledge: ['view', 'create', 'edit', 'review'] }, finance: FIN0 },
  { id: 'r-kb-author', name: 'Автор', kind: 'template', space: true, actions: { knowledge: ['view', 'create'] }, finance: FIN0 },
  { id: 'r-kb-reader', name: 'Читатель', kind: 'template', space: true, actions: { knowledge: ['view'] }, finance: FIN0 },
];
export const KB_ROLE_ORDER = ['r-kb-lead', 'r-kb-editor', 'r-kb-author', 'r-kb-reader'];
export const KB_ROLE_CAPS = {
  'r-kb-lead': 'Всё в пространстве, участники, доступ, автоматизация',
  'r-kb-editor': 'Создаёт и правит любые страницы, публикует, перемещает',
  'r-kb-author': 'Создаёт страницы и правит свои',
  'r-kb-reader': 'Читает и отмечает «Ознакомлен»',
};
export const KB_ACCESS = {
  open: { label: 'Открытое', icon: 'public', tone: 'ok', d: 'Роли области действуют полностью' },
  limited: { label: 'Ограниченное', icon: 'visibility', tone: 'info', d: 'Все в области читают, пишут участники' },
  closed: { label: 'Закрытое', icon: 'lock', tone: 'neutral', d: 'Только участники и владелец бизнеса' },
};
export const KB_MODES = {
  inherit: { label: 'Как у родителя', d: 'Читают и правят те же, кто у родителя' },
  edit: { label: 'Читают все, правят выбранные', d: 'Чтение как у родителя, правка — по списку' },
  listed: { label: 'Только выбранные', d: 'Читают и правят только те, кто в списке' },
};
export const KB_KINDS = { page: ['Страница', 'description'], folder: ['Папка', 'folder'], table: ['Таблица', 'table_view'], diagram: ['Схема', 'schema'], file: ['Файл', 'picture_as_pdf'], link: ['Запись CRM', 'dynamic_form'] };
export const KB_STATUS = { active: ['Действует', 'ok', 'check_circle'], draft: ['Черновик', 'warn', 'edit_note'], review: ['На проверке', 'warn', 'rate_review'], outdated: ['Пора пересмотреть', 'danger', 'event_busy'] };
export const KB_ICONS = ['menu_book', 'local_shipping', 'construction', 'spa', 'health_and_safety', 'apartment', 'school', 'rule'];
export const KB_COLORS = ['#1F6B52', '#2B5479', '#7A5214', '#6B4A7A', '#A13A33', '#3A4844'];

export const KB_TEMPLATES = [
  { id: 'regs', name: 'Регламенты подразделения', icon: 'rule', hint: 'Обзор, регламенты, чек-листы, журнал изменений', nodes: [
    { t: 'Обзор', k: 'page', body: 'Что лежит в пространстве и к кому обращаться с вопросами.' },
    { t: 'Регламенты', k: 'folder' },
    { t: 'Порядок работы', k: 'page', in: 1, body: 'Кто, что и в какие сроки делает в подразделении.' },
    { t: 'Чек-листы', k: 'folder' },
    { t: 'Журнал изменений', k: 'page', body: 'Что поменялось в регламентах и с какой даты действует.' }] },
  { id: 'staff', name: 'Инструкции для сотрудников', icon: 'health_and_safety', hint: 'Вводный инструктаж и папки по функциям: водители, прорабы, массажисты', nodes: [
    { t: 'Обзор', k: 'page', body: 'Инструкции и инструктажи для сотрудников. Каждый видит папку своей функции.' },
    { t: 'Вводный инструктаж', k: 'page', body: 'Правила безопасности на рабочем месте, порядок действий при травме и пожаре, контакты ответственных.', ack: true },
    { t: 'Водителям', k: 'folder', role: 'r-driver' },
    { t: 'Перед выездом', k: 'page', in: 1, body: 'Осмотр машины, фото с пяти ракурсов, проверка документов.' },
    { t: 'Прорабам и бригадам', k: 'folder', role: 'r-foreman' },
    { t: 'Работа на высоте', k: 'page', in: 1, body: 'Леса и стремянки, страховка, допуск к работам на высоте.' },
    { t: 'Массажистам', k: 'folder', role: 'r-therapist' },
    { t: 'Подготовка кабинета', k: 'page', in: 1, body: 'Проветривание, смена белья, подогрев стола, уборка после визита.' }] },
  { id: 'objects', name: 'Объекты и проекты', icon: 'home_work', hint: 'Папка «Объекты» и технология работ', nodes: [
    { t: 'Обзор', k: 'page', body: 'Объекты, их документы и технология работ.' },
    { t: 'Объекты', k: 'folder' },
    { t: 'Технология работ', k: 'page', body: 'Порядок и сроки этапов, требования к фотоотчёту.' }] },
  { id: 'blank', name: 'Пустое пространство', icon: 'draft', hint: 'Только главная страница', nodes: [{ t: 'Обзор', k: 'page', body: '' }] },
];
export const KB_SECTION = { name: 'Объект ремонта', v: 3, pages: ['Паспорт объекта', 'Как попасть на объект', 'Акты скрытых работ', 'Фотоотчёт', 'Гарантия'] };

// ── Дерево ──
const nodeOf = (K, id) => K.pages.find((p) => p.id === id);
export function kbPath(K, n) { const out = []; let x = n, g = 0; while (x && g++ < 40) { out.unshift(x); x = x.parent ? nodeOf(K, x.parent) : null; } return out; }
export const kbKids = (K, id, all) => K.pages.filter((p) => (p.parent || null) === (id || null) && (all || !p.archived)).sort((a, b) => (a.pos || 0) - (b.pos || 0));
export function kbSubtree(K, n, all) { const out = [n]; K.pages.filter((p) => p.parent === n.id && (all || !p.archived)).forEach((c) => out.push(...kbSubtree(K, c, all))); return out; }
export const kbTop = (K, spaceId, all) => K.pages.filter((p) => p.space === spaceId && !p.parent && (all || !p.archived)).sort((a, b) => (a.pos || 0) - (b.pos || 0));

// ── Кто есть кто ──
const mem = (db, id) => db.members.find((m) => m.id === id);
const role = (db, id) => db.roles.find((r) => r.id === id);
const grp = (db, id) => (db.groups || []).find((g) => g.id === id);
export const unitName = (db, id) => { const u = (db.units || []).find((x) => x.id === id); return u ? u.name : 'вся организация'; };
export const areaLabel = (db, sp) => { if (!sp.unit) return 'вся организация'; const u = (db.units || []).find((x) => x.id === sp.unit); return (u && u.type === 'region' ? 'регион «' : 'фирма «') + unitName(db, sp.unit) + '»'; };
const isOwner = (db, M, mid) => M.grants(db, mid).some((g) => g.roleObj.all);

export function kbSpaceGrant(db, mid, sp) {
  const gs = (db.assignments || []).filter((a) => a.member === mid && a.scope && a.scope.type === 'space' && a.scope.id === sp.id && KB_ROLE_ORDER.includes(a.role));
  gs.sort((a, b) => KB_ROLE_ORDER.indexOf(a.role) - KB_ROLE_ORDER.indexOf(b.role));
  return gs[0] || null;
}
function areaVerbs(db, M, mid, sp) {
  const out = new Set(); let via = null;
  M.grants(db, mid).forEach((g) => {
    if (g.roleObj.space || g.roleObj.all || !g.scope || g.scope.type === 'space' || g.scope.type === 'page') return;
    const acts = (g.roleObj.actions && g.roleObj.actions.knowledge) || [];
    if (!acts.length || (sp.unit && !M.scopeCovers(db, g.scope, sp.unit))) return;
    acts.forEach((v) => out.add(v)); via = via || g;
  });
  return { verbs: out, via };
}
function spaceVerbs(db, M, mid, sp) {
  const sg = kbSpaceGrant(db, mid, sp), area = areaVerbs(db, M, mid, sp);
  const sv = new Set(sg ? role(db, sg.role).actions.knowledge : []);
  if (sp.access === 'open') area.verbs.forEach((v) => sv.add(v));
  else if (sp.access === 'limited' && area.verbs.has('view')) sv.add('view');
  return { sg, area, sv, lead: !!sg && sg.role === 'r-kb-lead' };
}

export function entryHas(db, M, mid, e, sp) {
  if (e.who === 'member') return e.ref === mid;
  if (e.who === 'group') { const g = grp(db, e.ref); return !!g && g.members.includes(mid); }
  if (e.who === 'role') {
    const r = role(db, e.ref); if (!r) return false;
    return (db.assignments || []).some((a) => a.member === mid && a.role === e.ref && (r.space ? a.scope && a.scope.type === 'space' && a.scope.id === sp.id : !e.unit || M.scopeCovers(db, a.scope, e.unit)));
  }
  if (e.who === 'relation') { const o = ((db.repair && db.repair.objects) || []).find((y) => y.id === e.obj), m = mem(db, mid); return !!(o && m && o.foreman && o.foreman === m.name); }
  return false;
}
export function entryLabel(db, e) {
  if (e.who === 'member') return (mem(db, e.ref) || {}).name || 'Сотрудник';
  if (e.who === 'group') return 'Группа «' + ((grp(db, e.ref) || {}).name || e.ref) + '»';
  if (e.who === 'role') { const r = role(db, e.ref); return 'Роль «' + (r ? r.name : e.ref) + '»' + (r && r.space ? ' в пространстве' : e.unit ? ' · «' + unitName(db, e.unit) + '»' : ''); }
  if (e.who === 'relation') { const o = ((db.repair && db.repair.objects) || []).find((y) => y.id === e.obj); return 'Прораб объекта' + (o ? ' «' + o.name + '»' : ''); }
  return '—';
}
export const entryPeople = (db, M, e, sp) => db.members.filter((m) => m.status !== 'blocked' && entryHas(db, M, m.id, e, sp));
const hitOf = (db, M, mid, x, sp) => { let best = null; (x.list || []).forEach((e) => { if (entryHas(db, M, mid, e, sp) && (!best || e.can === 'edit')) best = e; }); return best; };

/** Доступ сотрудника к узлу дерева с цепочкой причин. */
export function kbAccess(db, M, mid, n) {
  const K = db.knowledge, chain = [];
  const step = (k, t, d) => chain.push({ k, t, d });
  const out = (view, edit, x) => ({ view, edit, chain, lead: false, create: false, fn: false, ...(x || {}) });
  const m = mem(db, mid), sp = n && K.spaces.find((s) => s.id === n.space);
  if (!m || !sp) return out(false, false);
  if (m.status === 'blocked') { step('no', 'Организация', 'Сотрудник заблокирован, доступ не действует'); return out(false, false); }
  step(m.status === 'invited' ? 'wait' : 'ok', 'Организация', m.status === 'invited' ? 'Приглашение не принято: доступ начнёт действовать после входа' : 'Активный сотрудник');
  if (isOwner(db, M, mid)) { step('ok', 'Владелец бизнеса', 'Видит и правит всё'); return out(true, true, { lead: true, owner: true, create: true }); }
  const path = kbPath(K, n);
  const { sg, area, sv, lead } = spaceVerbs(db, M, mid, sp);
  let from = 0;
  if (!sv.has('view')) {
    const pg = (db.assignments || []).filter((a) => a.member === mid && a.scope && a.scope.type === 'page').map((a) => ({ a, i: path.findIndex((x) => x.id === a.scope.id) })).filter((x) => x.i >= 0).sort((p, q) => q.i - p.i)[0];
    if (pg) { ((role(db, pg.a.role) || {}).actions?.knowledge || []).forEach((v) => sv.add(v)); from = pg.i + 1; step('ok', 'Ветка «' + path[pg.i].title + '»', '«' + role(db, pg.a.role).name + '» с областью этой страницы' + (pg.a.until ? ' до ' + pg.a.until : '')); }
  }
  if (!sv.has('view')) { step('no', 'Пространство «' + sp.name + '»', sp.access === 'closed' ? 'Закрытое: только участники и владелец бизнеса' : 'Нет роли в области «' + areaLabel(db, sp) + '», не участник пространства'); return out(false, false); }
  if (!from) step('ok', 'Пространство «' + sp.name + '»', sg ? role(db, sg.role).name + (sg.via ? ' · ' + sg.via : ' · назначение в пространстве') : 'Читатель по уровню «' + KB_ACCESS[sp.access].label + '»' + (area.via ? ': роль «' + area.via.roleObj.name + '»' : ''));
  let view = true, nearest = null;
  for (let i = from; i < path.length; i++) {
    const x = path[i]; if (!x.mode || x.mode === 'inherit') continue;
    const h = hitOf(db, M, mid, x, sp);
    if (x.mode === 'listed' && !h && !lead) { view = false; step('no', '«' + x.title + '»', 'Свой доступ «Только выбранные»: нет в списке'); break; }
    step('ok', '«' + x.title + '»', x.mode === 'listed' ? (h ? 'В списке: ' + entryLabel(db, h) + ' — ' + (h.can === 'edit' ? 'правит' : 'читает') : 'Свой доступ; руководитель пространства видит всё') : 'Читают все, правят выбранные' + (h && h.can === 'edit' ? ': ' + entryLabel(db, h) : ''));
    nearest = { x, h };
  }
  const fin = m.function === 'driver' && path.some((x) => x.sensitivity === 'finance');
  if (fin) { view = false; step('no', 'Функция «Водитель»', 'Финансовые страницы закрыты всегда'); }
  if (view && n.parent && (!n.mode || n.mode === 'inherit')) step('inh', '«' + n.title + '»', 'Доступ как у родителя');
  if (!view) return out(false, false, { fn: fin });
  if (n.archived && !(lead || sv.has('edit'))) return out(false, false);
  const own = sv.has('create') && n.owner === mid;
  const edit = lead || (nearest ? !!(nearest.h && nearest.h.can === 'edit') || own : sv.has('edit') || own);
  return out(true, edit, { lead, create: edit || (sv.has('create') && !nearest) });
}

/** Пройдёт ли сотрудник уровни выше узла: пространство и всех родителей. Без этого запись в списке узла ничего не даёт. */
export function kbReach(db, M, mid, n) {
  const K = db.knowledge, m = mem(db, mid), sp = n && K.spaces.find((s) => s.id === n.space);
  if (!m || !sp || m.status === 'blocked') return { ok: false, why: 'сотрудник заблокирован' };
  if (isOwner(db, M, mid)) return { ok: true };
  if (m.function === 'driver' && kbPath(K, n).some((x) => x.sensitivity === 'finance')) return { ok: false, why: 'функция «Водитель» не открывает финансовые страницы' };
  if (n.parent) { const p = nodeOf(K, n.parent); if (p && !kbAccess(db, M, mid, p).view) return { ok: false, why: 'не видит родителя «' + p.title + '»' }; if (p) return { ok: true }; }
  const { sv } = spaceVerbs(db, M, mid, sp);
  return sv.has('view') ? { ok: true } : { ok: false, why: sp.access === 'closed' ? 'не участник закрытого пространства' : 'нет роли в области «' + areaLabel(db, sp) + '» и не участник пространства' };
}
/** Кого из подходящих под запись пропустят уровни выше. */
export function kbEntryReach(db, M, e, sp, n) {
  const ppl = entryPeople(db, M, e, sp), ok = [], no = [];
  ppl.forEach((m) => { const r = kbReach(db, M, m.id, n); (r.ok ? ok : no).push({ m, why: r.why }); });
  return { ppl, ok, no };
}

export function kbSpaceMy(db, M, mid, sp) {
  if (isOwner(db, M, mid)) return { owner: true, lead: true, view: true, create: true, edit: true, role: 'Владелец бизнеса' };
  const { sg, sv, lead } = spaceVerbs(db, M, mid, sp);
  return { owner: false, lead, view: sv.has('view'), create: lead || sv.has('create'), edit: lead || sv.has('edit'), role: sg ? role(db, sg.role).name : sv.has('view') ? 'Читатель по уровню «' + KB_ACCESS[sp.access].label + '»' : '' };
}
export const kbLeads = (db, sp) => (db.assignments || []).filter((a) => a.role === 'r-kb-lead' && a.scope && a.scope.type === 'space' && a.scope.id === sp.id).map((a) => mem(db, a.member)).filter(Boolean);

/** Кого затронет изменение доступа: список страниц ветки и кто получит или потеряет чтение и правку. */
export function kbImpact(db, M, nodeId, patch) {
  const K = db.knowledge, n = nodeOf(K, nodeId), sub = kbSubtree(K, n);
  const own = sub.filter((x) => x.id !== n.id && x.mode && x.mode !== 'inherit');
  const ids = new Set(sub.map((x) => x.id)), ownIds = new Set(own.map((x) => x.id));
  const pages = K.pages.map((p) => (p.id === n.id ? { ...p, mode: patch.mode, list: patch.list } : patch.applyOwn && ownIds.has(p.id) ? { ...p, mode: 'inherit', list: [] } : p));
  const db2 = { ...db, knowledge: { ...K, pages } };
  const res = { pages: sub.length, inherit: sub.length - 1 - own.length, own: own.map((x) => x.title), gainView: [], loseView: [], gainEdit: [], loseEdit: [] };
  db.members.filter((m) => m.status !== 'blocked').forEach((m) => {
    let gv = 0, lv = 0, ge = 0, le = 0;
    sub.forEach((x) => { const a = kbAccess(db, M, m.id, x), b = kbAccess(db2, M, m.id, nodeOf(db2.knowledge, x.id)); if (!a.view && b.view) gv++; if (a.view && !b.view) lv++; if (!a.edit && b.edit) ge++; if (a.edit && !b.edit) le++; });
    if (gv) res.gainView.push(m.name + ' · ' + gv); if (lv) res.loseView.push(m.name + ' · ' + lv); if (ge) res.gainEdit.push(m.name + ' · ' + ge); if (le) res.loseEdit.push(m.name + ' · ' + le);
  });
  res.ids = ids;
  return res;
}
/** Кто потеряет чтение, если перенести ветку под другого родителя. */
export function kbMoveImpact(db, M, nodeId, parentId) {
  const K = db.knowledge, n = nodeOf(K, nodeId), sub = kbSubtree(K, n);
  const db2 = { ...db, knowledge: { ...K, pages: K.pages.map((p) => (p.id === nodeId ? { ...p, parent: parentId || null } : p)) } };
  const lose = [], gain = [];
  db.members.filter((m) => m.status !== 'blocked').forEach((m) => {
    let l = 0, g = 0;
    sub.forEach((x) => { const a = kbAccess(db, M, m.id, x).view, b = kbAccess(db2, M, m.id, nodeOf(db2.knowledge, x.id)).view; if (a && !b) l++; if (!a && b) g++; });
    if (l) lose.push(m.name + ' · ' + l); if (g) gain.push(m.name + ' · ' + g);
  });
  return { pages: sub.length, lose, gain };
}

/** Ответ сервера участнику: только видимые страницы, у каждой — что он может. */
export function kbView(db, M, actor, C) {
  const K = db.knowledge; if (!K || !K.v2 || !C) return C;
  const pages = [];
  C.pages.forEach((p) => { const a = kbAccess(db, M, actor, nodeOf(K, p.id) || p); if (a.view) pages.push({ ...p, my: { edit: a.edit, lead: !!a.lead, create: !!a.create } }); });
  const vis = new Set(pages.map((p) => p.id));
  const spaces = C.spaces.map((s) => ({ ...s, my: kbSpaceMy(db, M, actor, s), leads: kbLeads(db, s).map((m) => m.name) })).filter((s) => s.my.view || pages.some((p) => p.space === s.id));
  const leadOf = new Set(spaces.filter((s) => s.my.lead).map((s) => s.id));
  return { ...C, spaces, pages, tables: (C.tables || []).filter((t) => vis.has(t.page)), entries: (C.entries || []).filter((e) => vis.has(e.page)),
    requests: (C.requests || []).filter((r) => leadOf.has(r.space) || r.member === actor), rules: (C.rules || []).filter((r) => leadOf.has(r.space)), runs: (C.runs || []).filter((r) => leadOf.has(r.space)) };
}

// ── Демо-данные ──
const ver = (body, at, by) => [{ v: 1, at: at || '20.09.2026', by: by || 'Дарья Зимина', body: body || '' }];
const N = (id, space, parent, pos, kind, title, o) => ({ id, space, parent: parent || null, pos, kind, title, mode: 'inherit', list: [], status: 'active', owner: 'm-owner', access: 'all', versions: ver(o && o.body, o && o.at, o && o.by), ...(o || {}) });
const ED = { who: 'role', ref: 'r-kb-editor', can: 'edit' };

function makeSection(db, o, folderId) {
  const K = db.knowledge, id = 'kb-o-' + o.id, rel = { who: 'relation', ref: 'foreman', obj: o.id };
  const pos = kbKids(K, folderId, true).length + 1;
  K.pages.push(N(id, 'sp-rep', folderId, pos, 'folder', o.name, { mode: 'listed', list: [{ ...rel, can: 'view' }, ED], obj: o.id, body: undefined }));
  const kids = [
    ['Паспорт объекта', 'page', 'inherit', 'Адрес: ' + o.address + '. ' + o.area + ', ' + o.kind + '. Заказчик: ' + o.client + '.' + (o.contract ? ' Договор: ' + o.contract + '.' : '') + (o.due ? ' Сдача: ' + o.due + '.' : '')],
    ['Как попасть на объект', 'page', 'edit', (o.access || []).map((a) => a[1]).join('\n\n') || 'Адрес, вход, ключи, время шумных работ.'],
    ['Акты скрытых работ', 'table', 'inherit', 'Строки добавляются, когда заказчик подписывает акт.'],
    ['Фотоотчёт', 'page', 'edit', 'Фото по этапам: до начала, скрытые работы, черновая и чистовая отделка.'],
    ['Гарантия', 'page', 'listed', 'Гарантийные обязательства и контакты для обращений. Прораб увидит страницу после сдачи объекта.'],
  ];
  kids.forEach(([t, k, mode, body], i) => K.pages.push(N(id + '-' + (i + 1), 'sp-rep', id, i + 1, k, t, { body, mode, list: mode === 'edit' ? [{ ...rel, can: 'edit' }, ED] : mode === 'listed' ? [ED] : [] })));
  return id;
}

function altaExtras(db) {
  const K = db.knowledge, get = (id) => nodeOf(K, id);
  K.spaces.push({ id: 'sp-rep', name: 'Ремонт и стройка', icon: 'construction', color: '#7A5214', unit: null, access: 'limited' }, { id: 'sp-gen', name: 'Общее', icon: 'apartment', color: '#2B5479', unit: null, access: 'open' });
  const add = (...a) => K.pages.push(N(...a));
  add('kb-log-home', 'sp-log', null, 0, 'page', 'Обзор', { body: 'Регламенты и памятки фирмы «Север Логистик»: приёмка смены, осмотр машины, выезд при дефекте. Вопросы по пространству — Марине Котовой.' });
  add('kb-f-reg', 'sp-log', null, 1, 'folder', 'Регламенты', { body: '' });
  Object.assign(get('kb-1'), { parent: 'kb-f-reg', pos: 1, reviewBy: '24.03.2027', ack: { v: 2, audience: { who: 'role', ref: 'r-driver', unit: 'f-msk-sever' }, done: [] } });
  add('kb-1a', 'sp-log', 'kb-1', 1, 'page', 'Чек-лист приёмки', { body: 'Фото с пяти ракурсов, включая одометр.\n\nПробег совпадает с одометром на фото.\n\nУ каждого расхода есть чек.\n\nТоплива не меньше, чем при выезде.' });
  add('kb-1b', 'sp-log', 'kb-1', 2, 'page', 'Типовые замечания', { body: 'Нет фото одометра — вернуть раздел «Фото».\n\nРасход без чека — вернуть раздел «Расходы».\n\nПробег не совпадает с фото — вернуть раздел «Пробег».' });
  Object.assign(get('kb-2'), { parent: 'kb-f-reg', pos: 2, reviewBy: '30.09.2026', owner: 'm-kotova' });
  add('kb-6', 'sp-log', 'kb-f-reg', 3, 'page', 'Выезд при критическом дефекте', { status: 'review', owner: 'm-kotova', by: 'Марина Котова', body: 'Если при осмотре отмечен критический дефект, выезд блокируется. Менеджер разрешает выезд или подтверждает неисправность и отправляет машину в ремонт.' });
  Object.assign(get('kb-5'), { parent: null, pos: 2, kind: 'table' });
  add('kb-d1', 'sp-log', null, 3, 'diagram', 'Схема сдачи смены', { body: 'Как водитель сдаёт смену и что проверяет менеджер.', diagram: { steps: ['Сдача смены', 'Фото и пробег', 'Чеки расходов'], out: [['Принято · машина в пул', 'ok'], ['Возврат по разделам', 'warn']] } });
  add('kb-f-drv', 'sp-log', null, 4, 'folder', 'Водителям', { body: 'Памятки для водителей «Север Логистик».', mode: 'listed', list: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever', can: 'view' }, ED] });
  add('kb-drv-1', 'sp-log', 'kb-f-drv', 1, 'page', 'Памятка водителя', { body: 'Перед сменой — осмотр машины в приложении: пять фото и пробег. Без осмотра выезд не начнётся.\n\nВ пути расходы заносите сразу и фотографируйте чек.\n\nПосле рейса — сдача смены с фото, пробегом и чеками.' });
  add('kb-drv-2', 'sp-log', 'kb-f-drv', 2, 'page', 'ДТП и поломка в пути', { body: 'Остановитесь в безопасном месте, включите аварийную сигнализацию и выставьте знак.\n\nПозвоните диспетчеру, затем сфотографируйте место и повреждения.\n\nНе подписывайте документы без согласования с диспетчером.' });
  add('kb-drv-3', 'sp-log', 'kb-f-drv', 3, 'page', 'Контакты диспетчеров', { body: 'Диспетчерская «Север Логистик» работает ежедневно с 8:00 до 20:00. Ночью — дежурный менеджер по номеру из карточки рейса.' });
  add('kb-drv-4', 'sp-log', 'kb-f-drv', 4, 'diagram', 'Маршруты', { mode: 'edit', list: [], body: 'Схему правит только руководитель пространства.', diagram: { steps: ['Склад «Север»', 'Погрузка', 'Маршрут по заявке', 'Разгрузка'], out: [['Возврат на стоянку', 'ok']] } });
  add('kb-fin', 'sp-log', null, 5, 'page', 'Тарифы и начисления', { sensitivity: 'finance', mode: 'listed', list: [{ who: 'member', ref: 'm-kotova', can: 'view' }, { who: 'member', ref: 'm-kotelnikova', can: 'view' }], body: 'Ставки начислений водителям и порядок расчёта. Начисление создаётся после приёмки смены.' });
  add('kb-fin-1', 'sp-log', 'kb-fin', 1, 'page', 'Ставки по маршрутам', { body: 'Город — 2 400 ₽ за смену.\n\nМежгород до 300 км — 3 800 ₽.\n\nМежгород свыше 300 км — 5 200 ₽.\n\nНочная смена — плюс 15%.' });
  add('kb-file1', 'sp-log', null, 6, 'file', 'Договор аренды стоянки.pdf', { body: '', file: { size: '1,2 МБ', pages: 4 } });
  add('kb-lnk1', 'sp-log', null, 7, 'link', 'Форма «Осмотр машины»', { body: '', link: { label: 'Форма «Осмотр машины» · действует версия 3', go: 'forms', icon: 'dynamic_form' } });

  add('kb-spa-home', 'sp-spa', null, 0, 'page', 'Обзор', { body: 'Технологические карты, подготовка кабинета и правила работы салона.' });
  Object.assign(get('kb-3'), { parent: null, pos: 1, ack: { v: 1, audience: { who: 'role', ref: 'r-therapist' }, done: ['m-morozova'] } });
  add('kb-spa-2', 'sp-spa', null, 2, 'page', 'Подготовка кабинета', { body: 'За 15 минут до визита проветрите кабинет, смените бельё, включите подогрев стола.\n\nПосле визита — уборка 15 минут и отметка в «Мой день».' });

  add('kb-own-home', 'sp-own', null, 0, 'page', 'Обзор', { body: 'Документы для владельца: политики начислений, договоры, планы.' });
  Object.assign(get('kb-4'), { parent: null, pos: 1, sensitivity: 'finance' });

  add('kb-rep-home', 'sp-rep', null, 0, 'page', 'Обзор', { body: 'Технология работ, объекты и их документы. Раздел объекта создаётся сам, когда объект переходит на этап «Договор».' });
  add('kb-rep-tech', 'sp-rep', null, 1, 'page', 'Технология работ', { body: 'Грунтование — не раньше чем через 24 часа после шпаклёвки.\n\nПлитка — после приёмки скрытых работ по электрике и сантехнике.\n\nФото каждого этапа — в «Фотоотчёт» объекта.', ack: { v: 1, audience: { who: 'role', ref: 'r-foreman' }, done: [] } });
  add('kb-rep-obj', 'sp-rep', null, 2, 'folder', 'Объекты', { body: 'Разделы объектов: паспорт, как попасть, акты, фотоотчёт, гарантия.' });
  const o42 = ((db.repair && db.repair.objects) || []).find((o) => o.id === 'obj-42');
  if (o42) makeSection(db, o42, 'kb-rep-obj');

  add('kb-gen-home', 'sp-gen', null, 0, 'page', 'Обзор', { body: 'Общие сведения для всех сотрудников «Альта Групп».' });
  add('kb-gen-1', 'sp-gen', null, 1, 'page', 'Контакты офиса', { owner: 'm-kotova', by: 'Марина Котова', body: 'Офис: Москва, Дмитровское шоссе, 41, этаж 2. Будни 9:00–18:00.\n\nБухгалтерия принимает документы по пятницам до 16:00.' });
  add('kb-gen-2', 'sp-gen', null, 2, 'page', 'Как пользоваться Ортусом', { body: 'Задачи — в разделе «Задачи», обращения клиентов — в «Обращениях».\n\nРегламенты своего подразделения ищите в его пространстве базы знаний.' });

  db.assignments.push(
    { id: 'akb-1', member: 'm-kotova', role: 'r-kb-lead', scope: { type: 'space', id: 'sp-log' } },
    { id: 'akb-2', member: 'm-kotelnikova', role: 'r-kb-editor', scope: { type: 'space', id: 'sp-log' } },
    { id: 'akb-3', member: 'm-kotova', role: 'r-kb-author', scope: { type: 'space', id: 'sp-gen' } },
  );
  K.rules = [
    { id: 'kr-1', space: 'sp-log', kind: 'ack', name: 'Новая версия регламента → попросить ознакомиться заново', trigger: 'База знаний · страница опубликована', on: true },
    { id: 'kr-2', space: 'sp-log', kind: 'review', name: 'Пора пересмотреть страницу → уведомить владельца', trigger: 'По расписанию · каждый день в 09:00', on: true },
    { id: 'kr-3', space: 'sp-rep', kind: 'section', name: 'Объект на этапе «Договор» → раздел из шаблона «Объект ремонта»', trigger: 'Ремонт и стройка · этап объекта изменён', on: true },
    { id: 'kr-4', space: 'sp-rep', kind: 'ack', name: 'Новая версия «Технологии работ» → ознакомить прорабов', trigger: 'База знаний · страница опубликована', on: true },
    { id: 'kr-5', space: 'sp-rep', kind: 'review', name: 'Пора пересмотреть страницу → уведомить владельца', trigger: 'По расписанию · каждый день в 09:00', on: false },
  ];
  K.runs = [
    { id: 'krr-1', space: 'sp-rep', rule: 'kr-3', at: '24.09 10:42', res: 'ok', text: 'ЖК Речной · квартира 42: создан раздел и 5 подстраниц, доступ получил прораб Алексей Соколов' },
    { id: 'krr-2', space: 'sp-rep', rule: 'kr-3', at: '01.10 14:05', res: 'stopped', text: 'Дом 120 м², Истра: остановлено условием — новый этап «Замер», а не «Договор»' },
    { id: 'krr-3', space: 'sp-log', rule: 'kr-1', at: '24.09 18:10', res: 'ok', text: '«Регламент приёмки смены» v2: попросили ознакомиться роль «Водитель» в «Север Логистик» — 1 человек' },
  ];
}

/** Переход «Базы знаний» на пространства с деревом. Повторный вызов ничего не меняет. */
export function installKnowledge(db) {
  const K = db.knowledge; if (!K || K.v2) return;
  KB_ROLES.forEach((r) => { if (!db.roles.some((x) => x.id === r.id)) db.roles.push({ ...r }); });
  const alta = db.tenantId === 't-alta';
  const meta = { 'sp-log': ['local_shipping', '#1F6B52', 'f-msk-sever', 'limited'], 'sp-spa': ['spa', '#6B4A7A', null, 'open'], 'sp-own': ['shield_person', '#3A4844', null, 'closed'] };
  K.spaces.forEach((s) => { const x = meta[s.id] || ['menu_book', '#2B5479', null, 'open']; Object.assign(s, { icon: s.icon || x[0], color: s.color || x[1], unit: s.unit !== undefined ? s.unit : alta ? x[2] : null, access: s.access || x[3] }); });
  K.pages.forEach((p, i) => Object.assign(p, { parent: p.parent || null, pos: p.pos != null ? p.pos : i + 1, kind: p.kind || 'page', mode: p.mode || (p.access === 'owner' ? 'listed' : 'inherit'), list: p.list || [], status: p.status || 'active', owner: p.owner || 'm-owner' }));
  if (alta) altaExtras(db);
  K.spaces.forEach((s) => { if (!K.pages.some((p) => p.space === s.id && !p.parent && p.title === 'Обзор')) K.pages.push(N('kb-home-' + s.id, s.id, null, 0, 'page', 'Обзор', { body: 'Главная страница пространства «' + s.name + '».' })); });
  K.requests = K.requests || []; K.rules = K.rules || []; K.runs = K.runs || [];
  K.v2 = true;
}

/** Команды mock-адаптера. getDb/getActor — геттеры: адаптер меняет организацию и участника. */
export function knowledgeApi({ getDb, getActor, cmd, ApiError, M, event }) {
  const D = getDb, me = () => getActor();
  const K = () => { const k = D().knowledge; if (!k || !k.v2) throw new ApiError('not_found', 'База знаний не подключена'); return k; };
  const node = (id) => { const n = nodeOf(K(), id); if (!n) throw new ApiError('not_found', 'Страница не найдена или недоступна'); return n; };
  const spaceOf = (id) => { const s = K().spaces.find((x) => x.id === id); if (!s) throw new ApiError('not_found', 'Пространство не найдено'); return s; };
  const acc = (n) => kbAccess(D(), M, me(), n);
  const needLead = (sp) => { if (!kbSpaceMy(D(), M, me(), sp).lead) throw new ApiError('forbidden', 'Это может руководитель пространства или владелец бизнеса'); };
  const needView = (n) => { if (!acc(n).view) throw new ApiError('not_found', 'Страница не найдена или недоступна'); };
  const needEdit = (n) => { needView(n); if (!acc(n).edit) throw new ApiError('forbidden', 'Нет права править «' + n.title + '»'); };
  const meName = () => (mem(D(), me()) || {}).name || '—';
  const nid = (p) => p + D().seq++;
  const log = (space, rule, res, text) => { const k = K(); k.runs.unshift({ id: nid('krr-'), space, rule, at: KB_TODAY.slice(0, 5) + ' ' + hm(), res, text }); k.runs.length = Math.min(k.runs.length, 40); };
  const ruleOn = (space, kind) => K().rules.find((r) => r.space === space && r.kind === kind && r.on);
  const title = (t) => { const s = String(t || '').trim(); if (s.length < 2) throw new ApiError('validation', 'Название — не короче 2 символов'); if (s.length > 120) throw new ApiError('validation', 'Название — не длиннее 120 символов'); return s; };
  const nextPos = (space, parent) => K().pages.filter((p) => p.space === space && (p.parent || null) === (parent || null)).reduce((m, p) => Math.max(m, p.pos || 0), 0) + 1;
  const audience = (n, sp) => {
    const a = n.ack && n.ack.audience; if (!a) return [];
    return D().members.filter((m) => m.status === 'active' && kbAccess(D(), M, m.id, n).view && (a.who === 'all' || entryHas(D(), M, m.id, a, sp)));
  };
  const checkList = (list) => (list || []).map((e) => {
    if (!['member', 'group', 'role', 'relation'].includes(e.who) || !['view', 'edit'].includes(e.can)) throw new ApiError('validation', 'Неверная запись в списке доступа');
    if (e.who === 'member' && !mem(D(), e.ref)) throw new ApiError('validation', 'Сотрудник не найден');
    if (e.who === 'group' && !grp(D(), e.ref)) throw new ApiError('validation', 'Группа не найдена');
    if (e.who === 'role' && !role(D(), e.ref)) throw new ApiError('validation', 'Роль не найдена');
    return { who: e.who, ref: e.ref, can: e.can, ...(e.unit ? { unit: e.unit } : {}), ...(e.obj ? { obj: e.obj } : {}) };
  });

  return {
    kbCreateSpace: (spec) => cmd(() => {
      const db = D(), s = spec || {};
      if (!isOwner(db, M, me()) && !M.grants(db, me()).some((g) => !g.roleObj.space && (g.roleObj.actions?.knowledge || []).includes('settings'))) throw new ApiError('forbidden', 'Создавать пространства может владелец бизнеса или роль с правом «База знаний · Настраивать»');
      const name = title(s.name);
      if (K().spaces.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new ApiError('validation', 'Пространство «' + name + '» уже есть');
      if (!KB_ACCESS[s.access]) throw new ApiError('validation', 'Выберите уровень доступа');
      const tpl = KB_TEMPLATES.find((t) => t.id === s.template) || KB_TEMPLATES[3];
      const sp = { id: nid('sp-'), name, icon: s.icon || tpl.icon, color: s.color || '#2B5479', unit: s.unit || null, access: s.access, template: tpl.id };
      K().spaces.push(sp);
      let top = null, pos = 0, kpos = 0;
      const pick = new Set(s.nodes || tpl.nodes.map((x, i) => i));
      tpl.nodes.forEach((x, i) => {
        if (!x.in && !pick.has(i)) top = null;
        if (!pick.has(i)) return;
        const parent = x.in ? top : null;
        const n = N(nid('kb-'), sp.id, parent, x.in ? ++kpos : ++pos, x.k, x.t, { body: x.body || '', at: KB_TODAY, by: meName(), owner: me() });
        if (x.role) { n.mode = 'listed'; n.list = [{ who: 'role', ref: x.role, ...(sp.unit ? { unit: sp.unit } : {}), can: 'view' }, ED]; }
        if (x.ack) n.ack = { v: 1, audience: { who: 'all' }, done: [] };
        if (!x.in) { top = n.id; kpos = 0; }
        K().pages.push(n);
      });
      if (!isOwner(db, M, me())) db.assignments.push({ id: nid('akb-'), member: me(), role: 'r-kb-lead', scope: { type: 'space', id: sp.id } });
      return { id: sp.id };
    }, 380),

    kbCreateNode: (spaceId, parentId, kind, t) => cmd(() => {
      const sp = spaceOf(spaceId), name = title(t);
      if (!KB_KINDS[kind] || kind === 'file' || kind === 'link') throw new ApiError('validation', 'Выберите тип: страница, папка или схема');
      if (parentId) { const p = node(parentId); needView(p); if (p.space !== sp.id) throw new ApiError('validation', 'Родитель — из другого пространства'); if (!acc(p).create) throw new ApiError('forbidden', 'Нет права создавать страницы внутри «' + p.title + '»'); }
      else if (!kbSpaceMy(D(), M, me(), sp).create) throw new ApiError('forbidden', 'Нет права создавать страницы в пространстве');
      const n = N(nid('kb-'), sp.id, parentId || null, nextPos(sp.id, parentId), kind, name, { body: '', at: KB_TODAY, by: meName(), owner: me(), status: kind === 'folder' ? 'active' : 'draft' });
      if (kind === 'diagram') n.diagram = { steps: ['Начало', 'Шаг', 'Готово'], out: [] };
      K().pages.push(n);
      return { id: n.id };
    }, 300),

    kbPublish: (id, spec) => cmd(() => {
      const n = node(id); needEdit(n);
      const s = spec || {}, last = n.versions[n.versions.length - 1] || { v: 0 };
      if (s.base && last.v !== s.base) throw new ApiError('conflict', 'Страницу уже изменили (v' + last.v + '). Обновите и повторите правку.');
      const body = String(s.body || '');
      if (body.length > 20000) throw new ApiError('validation', 'Текст — не длиннее 20 000 символов');
      n.title = title(s.title || n.title);
      if (n.kind === 'diagram' && s.steps) n.diagram = { ...(n.diagram || {}), steps: s.steps.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) };
      n.versions.push({ v: last.v + 1, at: KB_TODAY, by: meName(), body });
      if (['draft', 'outdated'].includes(n.status)) n.status = 'active';
      let asked = 0;
      if (s.ack && n.ack) {
        const sp = spaceOf(n.space);
        n.ack = { ...n.ack, v: last.v + 1, done: [] };
        const who = audience(n, sp).map((m) => m.id); asked = who.length;
        if (who.length) event('Новая версия «' + n.title + '» v' + (last.v + 1) + ' — подтвердите, что ознакомились', who);
        if (ruleOn(n.space, 'ack')) log(n.space, ruleOn(n.space, 'ack').id, 'ok', '«' + n.title + '» v' + (last.v + 1) + ': попросили ознакомиться — ' + asked + ' чел.');
      }
      return { v: last.v + 1, asked };
    }, 380),

    kbSetStatus: (id, status) => cmd(() => {
      const n = node(id); needEdit(n);
      if (!KB_STATUS[status]) throw new ApiError('validation', 'Неизвестный статус');
      n.status = status;
      return { status };
    }, 250),

    kbSetAccess: (id, spec) => cmd(() => {
      const n = node(id), sp = spaceOf(n.space); needLead(sp);
      const s = spec || {};
      if (!KB_MODES[s.mode]) throw new ApiError('validation', 'Выберите, кто видит страницу');
      const list = s.mode === 'inherit' ? [] : checkList(s.list);
      const imp = kbImpact(D(), M, id, { mode: s.mode, list, applyOwn: !!s.applyOwn });
      n.mode = s.mode; n.list = list;
      if (s.applyOwn) kbSubtree(K(), n).forEach((x) => { if (x.id !== n.id && x.mode && x.mode !== 'inherit') { x.mode = 'inherit'; x.list = []; } });
      (n.history = n.history || []).unshift({ at: KB_TODAY + ' ' + hm(), by: meName(), text: 'Доступ: ' + KB_MODES[s.mode].label + (list.length ? ' · ' + list.map((e) => entryLabel(D(), e) + ' — ' + (e.can === 'edit' ? 'правит' : 'читает')).join(', ') : '') });
      return { pages: imp.pages, lose: imp.loseView.length };
    }, 380),

    kbMove: (id, parentId) => cmd(() => {
      const n = node(id); needEdit(n);
      if (parentId) {
        const p = node(parentId); needView(p);
        if (p.space !== n.space) throw new ApiError('validation', 'Переносить можно только внутри пространства');
        if (kbPath(K(), p).some((x) => x.id === n.id)) throw new ApiError('validation', 'Нельзя перенести страницу внутрь её же подстраницы');
        if (!acc(p).create) throw new ApiError('forbidden', 'Нет права добавлять страницы в «' + p.title + '»');
      }
      n.parent = parentId || null; n.pos = nextPos(n.space, parentId);
      return { ok: true };
    }, 300),

    kbArchive: (id, on) => cmd(() => {
      const n = node(id), sp = spaceOf(n.space), my = kbSpaceMy(D(), M, me(), sp);
      if (!(my.lead || my.edit) || !acc(n).view) throw new ApiError('forbidden', 'Архивировать может редактор или руководитель пространства');
      if (on && !n.parent && n.title === 'Обзор') throw new ApiError('validation', 'Главную страницу пространства архивировать нельзя');
      kbSubtree(K(), n, true).forEach((x) => { x.archived = !!on; });
      return { ok: true };
    }, 300),

    kbAck: (id) => cmd(() => {
      const n = node(id); needView(n);
      if (!n.ack) throw new ApiError('validation', 'Ознакомление со страницей не запрошено');
      if (!audience(n, spaceOf(n.space)).some((m) => m.id === me())) throw new ApiError('validation', 'Ознакомление запрошено у другой роли');
      if (!n.ack.done.includes(me())) n.ack.done.push(me());
      return { done: n.ack.done.length };
    }, 250),

    kbRequest: (id, can) => cmd(() => {
      const n = node(id), a = acc(n); needView(n);
      if (can === 'edit' && a.edit) throw new ApiError('validation', 'Вы уже можете править страницу');
      if (K().requests.some((r) => r.node === id && r.member === me() && r.status === 'open')) throw new ApiError('validation', 'Запрос уже отправлен');
      const r = { id: nid('kq-'), node: id, space: n.space, member: me(), can: can === 'edit' ? 'edit' : 'view', at: KB_TODAY.slice(0, 5) + ' ' + hm(), status: 'open' };
      K().requests.unshift(r);
      const sp = spaceOf(n.space), to = kbLeads(D(), sp).map((m) => m.id).concat(D().members.filter((m) => isOwner(D(), M, m.id)).map((m) => m.id));
      event(meName() + ' просит ' + (r.can === 'edit' ? 'право правки' : 'доступ') + ' к «' + n.title + '»', [...new Set(to)]);
      return { id: r.id };
    }, 300),

    kbDecide: (reqId, approve) => cmd(() => {
      const r = K().requests.find((x) => x.id === reqId && x.status === 'open'); if (!r) throw new ApiError('not_found', 'Запрос не найден или уже решён');
      const n = node(r.node), sp = spaceOf(n.space); needLead(sp);
      if (approve) {
        if (r.can === 'edit') {
          if (!n.mode || n.mode === 'inherit') { n.mode = 'edit'; n.list = [ED]; }
          if (!n.list.some((e) => e.who === 'member' && e.ref === r.member)) n.list.push({ who: 'member', ref: r.member, can: 'edit' });
          else n.list = n.list.map((e) => (e.who === 'member' && e.ref === r.member ? { ...e, can: 'edit' } : e));
        } else D().assignments.push({ id: nid('akb-'), member: r.member, role: 'r-kb-reader', scope: { type: 'page', id: n.id }, until: plus30(), via: 'запрос доступа' });
      }
      r.status = approve ? 'approved' : 'denied'; r.by = meName();
      event((approve ? 'Одобрен' : 'Отклонён') + ' запрос к «' + n.title + '»', [r.member]);
      return { status: r.status };
    }, 300),

    kbSetMember: (spaceId, memberId, roleId) => cmd(() => {
      const sp = spaceOf(spaceId), db = D(); needLead(sp);
      const m = mem(db, memberId); if (!m) throw new ApiError('validation', 'Выберите сотрудника');
      if (roleId && !KB_ROLE_ORDER.includes(roleId)) throw new ApiError('validation', 'Выберите роль пространства');
      if (isOwner(db, M, memberId)) throw new ApiError('validation', 'Владелец бизнеса видит всё без назначения');
      if (memberId === me() && roleId !== 'r-kb-lead' && !isOwner(db, M, me())) throw new ApiError('validation', 'Свою роль руководителя снимает владелец бизнеса');
      db.assignments = db.assignments.filter((a) => !(a.member === memberId && a.scope && a.scope.type === 'space' && a.scope.id === sp.id));
      if (roleId) db.assignments.push({ id: nid('akb-'), member: memberId, role: roleId, scope: { type: 'space', id: sp.id } });
      return { ok: true };
    }, 300),

    kbToggleRule: (ruleId) => cmd(() => {
      const r = K().rules.find((x) => x.id === ruleId); if (!r) throw new ApiError('not_found', 'Правило не найдено');
      needLead(spaceOf(r.space)); r.on = !r.on;
      return { on: r.on };
    }, 250),

    kbCheckReview: (spaceId) => cmd(() => {
      const sp = spaceOf(spaceId); needLead(sp);
      const r = ruleOn(sp.id, 'review'); if (!r) throw new ApiError('validation', 'Правило «Пора пересмотреть» выключено');
      const due = K().pages.filter((p) => p.space === sp.id && !p.archived && p.reviewBy && dval(p.reviewBy) <= dval(KB_TODAY) && p.status !== 'outdated');
      due.forEach((p) => { p.status = 'outdated'; event('Пора пересмотреть «' + p.title + '»: срок был ' + p.reviewBy, [p.owner]); log(sp.id, r.id, 'ok', '«' + p.title + '»: срок пересмотра ' + p.reviewBy + ', уведомлён владелец ' + ((mem(D(), p.owner) || {}).name || '')); });
      if (!due.length) log(sp.id, r.id, 'stopped', 'Остановлено условием: сроки пересмотра не наступили');
      return { due: due.length };
    }, 350),

    kbRunSection: (objId) => cmd(() => {
      const sp = spaceOf('sp-rep'); needLead(sp);
      const r = ruleOn('sp-rep', 'section'); if (!r) throw new ApiError('validation', 'Правило выключено');
      const o = ((D().repair && D().repair.objects) || []).find((x) => x.id === objId); if (!o) throw new ApiError('not_found', 'Объект не найден');
      if (nodeOf(K(), 'kb-o-' + o.id)) { log(sp.id, r.id, 'stopped', o.name + ': остановлено условием — раздел уже есть'); return { created: false }; }
      const folder = K().pages.find((p) => p.space === 'sp-rep' && p.kind === 'folder' && p.title === 'Объекты' && !p.parent);
      if (!folder) throw new ApiError('validation', 'В пространстве нет папки «Объекты»');
      makeSection(D(), o, folder.id);
      log(sp.id, r.id, o.foreman ? 'ok' : 'warn', o.foreman ? o.name + ': создан раздел и 5 подстраниц, доступ получил прораб ' + o.foreman : o.name + ': прораб не назначен — раздел создан, доступ пока у редакторов. Назначат прораба — он получит доступ сам');
      if (o.foreman) { const f = D().members.find((m) => m.name === o.foreman); if (f) event('Создан раздел объекта «' + o.name + '» в базе знаний', [f.id]); }
      return { created: true, id: 'kb-o-' + o.id };
    }, 380),
  };
}
