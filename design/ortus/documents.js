// Документы: текст, таблицы и PDF внутри Ортуса (docs/24-documents.md).
// В продукте правку, совместную сессию и преобразование делает встроенный движок (Р7-Офис или ONLYOFFICE).
// Здесь — слой Ортуса вокруг движка: папки, доступ по ролям и связям, версии, маршрут, задания. Окно редактора эмулируется.
// Доступ: организация → папка и её родители → документ → маршрут → функция сотрудника.

const p2 = (n) => String(n).padStart(2, '0');
export const DOC_TODAY = '01.10.2026';
const hm = () => { const d = new Date(); return p2(d.getHours()) + ':' + p2(d.getMinutes()); };
const stamp = () => DOC_TODAY.slice(0, 5) + ' ' + hm();
const clone = (o) => JSON.parse(JSON.stringify(o));
const dval = (s) => { const m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s || ''); return m ? +m[3] * 10000 + +m[2] * 100 + +m[1] : 0; };
const HOLI = new Set(['04.11.2026']);
const toDate = (s) => { const [d, m, y] = String(s).split('.').map(Number); return new Date(y, m - 1, d); };
const fmtDate = (x) => p2(x.getDate()) + '.' + p2(x.getMonth() + 1) + '.' + x.getFullYear();
export function addWork(from, n) { const x = toDate(from); let k = 0; while (k < n) { x.setDate(x.getDate() + 1); const w = x.getDay(); if (w !== 0 && w !== 6 && !HOLI.has(fmtDate(x))) k++; } return fmtDate(x); }
export const plural = (n, a, b, c) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
export const shortName = (n) => { const p = String(n || '').split(/\s+/).filter(Boolean); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : n || '—'; };
export function shaOf(o) { const s = JSON.stringify(o || ''); let a = 0x811c9dc5, b = 0x01000193; for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0; b = Math.imul(b + s.charCodeAt(i), 2246822519) >>> 0; } const h = (a.toString(16) + b.toString(16)).padStart(16, '0'); return h.slice(0, 4) + '…' + h.slice(-4); }
const mb = (x) => String(Math.round(x * 10) / 10).replace('.', ',') + ' МБ';

// ── Уровни, виды, шаги ──
export const DOC_LEVELS = ['Нет доступа', 'Читает', 'Комментирует', 'Предлагает правки', 'Правит', 'Управляет доступом'];
export const LV = { view: 1, comment: 2, suggest: 3, edit: 4, manage: 5 };
export const LV_KEY = [null, 'view', 'comment', 'suggest', 'edit', 'manage'];
export const DOC_LEVEL_HINT = ['', 'Открывает документ. Скачать и распечатать — если это разрешает роль', 'Читает и оставляет комментарии', 'Каждая его правка становится предложением; принимает тот, кто правит', 'Правит, принимает предложения, отправляет на согласование', 'Как «Правит», плюс «Поделиться» и маршрут'];
export const DOC_KINDS = { text: ['Текст', 'description', '#E7EEF6', '#2B5479'], sheet: ['Таблица', 'table_chart', '#E3EFE7', '#1F6B52'], pdf: ['PDF', 'picture_as_pdf', '#FBEAE7', '#A13A33'] };
export const STEP_KINDS = { approve: ['Согласовать', 'task_alt'], sign: ['Утвердить', 'verified'], ack: ['Ознакомить', 'visibility'], ext: ['Подпись заказчика', 'signature'] };
export const APPROVE_MODES = { all: 'Все сразу', seq: 'По очереди', any: 'Достаточно одного' };
const FIN0 = { read: false, manage: false };
export const DOC_ROLES = [
  { id: 'r-doc-manage', name: 'Документы · управляет доступом', kind: 'template', folderRole: true, docLevel: 5, actions: { docs: ['view', 'create', 'edit', 'export', 'settings'] }, finance: FIN0 },
  { id: 'r-doc-edit', name: 'Документы · правит', kind: 'template', folderRole: true, docLevel: 4, actions: { docs: ['view', 'create', 'edit', 'export'] }, finance: FIN0 },
  { id: 'r-doc-read', name: 'Документы · читает', kind: 'template', folderRole: true, docLevel: 1, actions: { docs: ['view'] }, finance: FIN0 },
];

// ── Кто есть кто ──
const mem = (db, id) => (db.members || []).find((m) => m.id === id);
const role = (db, id) => (db.roles || []).find((r) => r.id === id);
const grp = (db, id) => (db.groups || []).find((g) => g.id === id);
export const unitName = (db, id) => ((db.units || []).find((u) => u.id === id) || {}).name || 'вся организация';
export const objOf = (db, id) => ((db.repair && db.repair.objects) || []).find((o) => o.id === id);
const isOwner = (db, M, mid) => M.grants(db, mid).some((g) => g.roleObj && g.roleObj.all);
const XS = (db) => db.docs || { folders: [], items: [] };
export const folderOf = (db, id) => XS(db).folders.find((f) => f.id === id);
export function folderPath(db, id) { const out = []; let f = folderOf(db, id), g = 0; while (f && g++ < 20) { out.unshift(f); f = f.parent ? folderOf(db, f.parent) : null; } return out; }
export const folderLabel = (db, id) => folderPath(db, id).map((f) => f.name).join(' › ');

export function entryHas(db, M, mid, e) {
  const m = mem(db, mid); if (!m || m.status === 'blocked') return false;
  if (e.who === 'all') return true;
  if (e.who === 'member') return e.ref === mid;
  if (e.who === 'group') { const g = grp(db, e.ref); return !!g && g.members.includes(mid); }
  if (e.who === 'role') return (db.assignments || []).some((a) => a.member === mid && a.role === e.ref && (!e.unit || (a.scope && M.scopeCovers(db, a.scope, e.unit))));
  if (e.who === 'relation') { const o = objOf(db, e.obj); return !!(o && o.foreman && o.foreman === m.name); }
  return false;
}
export function entryLabel(db, e) {
  if (e.who === 'all') return 'Все сотрудники организации';
  if (e.who === 'member') return (mem(db, e.ref) || {}).name || 'Сотрудник';
  if (e.who === 'group') return 'Группа «' + ((grp(db, e.ref) || {}).name || e.ref) + '»';
  if (e.who === 'role') { const r = role(db, e.ref); return 'Роль «' + (r ? r.name : e.ref) + '»' + (e.unit ? ' · «' + unitName(db, e.unit) + '»' : ' · вся организация'); }
  if (e.who === 'relation') { const o = objOf(db, e.obj); return 'Прораб объекта' + (o ? ' «' + o.name + '»' : ''); }
  return '—';
}
export const entryIcon = (e) => ({ all: 'apartment', member: 'person', group: 'groups', role: 'badge', relation: 'engineering' }[e.who] || 'person');
export const entryKey = (e) => [e.who, e.ref || '', e.unit || '', e.obj || ''].join(':');
export const entryPeople = (db, M, e) => (db.members || []).filter((m) => m.status !== 'blocked' && entryHas(db, M, m.id, e));

// ── Уровень доступа с цепочкой причин ──
const AREA_SKIP = new Set(['self', 'project', 'space', 'page', 'folder', 'doc']);
function areaLevel(db, M, mid, unit) {
  let L = 0, via = null;
  M.grants(db, mid).forEach((g) => {
    const r = g.roleObj; if (!r || r.all || r.folderRole || r.docsAddressed || !g.scope || AREA_SKIP.has(g.scope.type)) return;
    const a = (r.actions && r.actions.docs) || []; if (!a.length) return;
    if (unit ? !M.scopeCovers(db, g.scope, unit) : g.scope.type !== 'tenant') return;
    const l = a.includes('settings') ? 5 : a.includes('edit') ? 4 : a.includes('view') ? 1 : 0;
    if (l > L) { L = l; via = g; }
  });
  return { L, via };
}
function scopedLevel(db, mid, type, id) {
  let L = 0, via = null;
  (db.assignments || []).forEach((a) => { if (a.member !== mid || !a.scope || a.scope.type !== type || a.scope.id !== id) return; const r = role(db, a.role), l = (r && r.docLevel) || 0; if (l > L) { L = l; via = a; } });
  return { L, via };
}
function listLevel(db, M, mid, list) { let L = 0, hit = null; (list || []).forEach((e) => { const l = LV[e.level] || 0; if (l > L && entryHas(db, M, mid, e)) { L = l; hit = e; } }); return { L, hit }; }

export function docAccess(db, M, mid, x) {
  const chain = [], step = (k, t, d) => chain.push({ k, t, d });
  const isDoc = !!x.kind, fid = isDoc ? x.folder : x.id, path = folderPath(db, fid), m = mem(db, mid);
  const out = (L, o) => ({ L, level: DOC_LEVELS[L], chain, ...(o || {}) });
  if (!m) return out(0);
  if (m.status === 'blocked') { step('no', 'Организация', 'Сотрудник заблокирован: доступ не действует'); return out(0); }
  step(m.status === 'invited' ? 'wait' : 'ok', 'Организация', m.status === 'invited' ? 'Приглашение не принято: доступ начнёт действовать после входа' : 'Активный сотрудник');
  const fin = (isDoc && x.sensitivity === 'finance') || path.some((f) => f.sensitivity === 'finance');
  if (fin && m.function === 'driver') { step('no', 'Функция «Водитель»', 'Финансовые документы закрыты всегда, независимо от ролей и групп'); return out(0, { fn: true }); }
  if (isOwner(db, M, mid)) { step('ok', 'Владелец бизнеса', 'Видит и правит всё, выдаёт любой уровень'); return out(5, { owner: true, fin }); }
  let L = 0, onlyV = null;
  path.forEach((f, i) => {
    if (f.mode === 'listed') { if (L) step('up', 'Папка «' + f.name + '»', 'Только выбранные: роли области и папки выше не действуют'); L = 0; }
    else if (i === 0) { const a = areaLevel(db, M, mid, f.unit); if (a.L) { L = a.L; step('ok', 'Роль в области', '«' + a.via.roleObj.name + '» · ' + M.scopeLabel(db, a.via.scope) + ' → ' + DOC_LEVELS[a.L]); } }
    const sc = scopedLevel(db, mid, 'folder', f.id), li = listLevel(db, M, mid, f.share);
    if (Math.max(sc.L, li.L) > L) { L = Math.max(sc.L, li.L); step('ok', 'Папка «' + f.name + '»', sc.L >= li.L ? 'Назначение «' + role(db, sc.via.role).name + '» в папке' + (sc.via.until ? ' до ' + sc.via.until : '') : entryLabel(db, li.hit) + ' → ' + DOC_LEVELS[li.L]); }
  });
  if (!isDoc) { if (!L) step('no', 'Папка «' + x.name + '»', 'Нет роли в области, назначения в папке и записи в списке доступа'); return out(L, { fin }); }
  const d = x;
  if (d.mode === 'listed') { if (L) step('up', '«' + d.title + '»', 'Свой доступ «Только выбранные»: доступ папки не действует'); L = 0; }
  else if (L) step('inh', '«' + d.title + '»', 'Доступ как у папки');
  const sc = scopedLevel(db, mid, 'doc', d.id), li = listLevel(db, M, mid, d.share);
  if (Math.max(sc.L, li.L) > L) { L = Math.max(sc.L, li.L); step('ok', 'Документ', sc.L >= li.L ? 'Назначение «' + role(db, sc.via.role).name + '»' + (sc.via.until ? ' до ' + sc.via.until : '') : entryLabel(db, li.hit) + ' → ' + DOC_LEVELS[li.L]); }
  if (d.owner === mid && L < 5) { L = 5; step('ok', 'Владелец документа', 'Создал документ или получил его от предыдущего владельца'); }
  const tm = (d.tmp || []).filter((t) => t.member === mid).sort((a, b) => LV[b.level] - LV[a.level])[0];
  if (tm && LV[tm.level] > L) { L = LV[tm.level]; onlyV = tm.v || null; step('ok', 'Маршрут', tm.why); }
  if (!L) step('no', '«' + d.title + '»', d.mode === 'listed' ? 'Нет в списке «Только выбранные»' : 'Нет доступа к папке «' + ((path[path.length - 1] || {}).name || '—') + '» и записи в списке документа');
  return out(L, { fin, onlyV });
}

function hasVerb(db, M, mid, d, verb) {
  const path = folderPath(db, d.folder), ids = new Set(path.map((f) => f.id)), unit = (path[0] || {}).unit;
  return M.grants(db, mid).some((g) => {
    const r = g.roleObj, s = g.scope; if (!r || !s || !((r.actions && r.actions.docs) || []).includes(verb)) return false;
    if (s.type === 'tenant') return true;
    if (s.type === 'region' || s.type === 'firm') return !!unit && M.scopeCovers(db, s, unit);
    if (s.type === 'folder') return ids.has(s.id);
    if (s.type === 'doc') return s.id === d.id;
    if (s.type === 'self') return d.owner === mid || path.map((f) => f.share || []).concat([d.share || []]).flat().some((e) => e.who === 'relation' && entryHas(db, M, mid, e));
    return false;
  });
}
export function docRights(db, M, mid, d) {
  const a = docAccess(db, M, mid, d), L = a.L, own = !!a.owner;
  const locked = !!(d.route && d.route.status === 'active' && d.route.rules && d.route.rules.lock) || !!d.pdfa;
  return { ...a, view: L >= 1, comment: L >= 2, suggest: L >= 3 && !locked, edit: L >= 4 && !locked, editL: L >= 4, manage: L === 5, locked,
    share: L > 0 && (own || L === 5 || (L >= 2 && hasVerb(db, M, mid, d, 'settings'))), maxGrant: L === 5 ? 5 : Math.min(L, 4), ext: own,
    export: L > 0 && (own || L >= 4 || hasVerb(db, M, mid, d, 'export')), sign: L > 0 && (own || hasVerb(db, M, mid, d, 'review')), route: L >= 4 && !d.pdfa };
}
export function finSees(db, M, mid, d, sh) {
  const m = mem(db, mid); if (!m || m.function === 'driver') return false;
  return isOwner(db, M, mid) || M.grants(db, mid).some((g) => g.roleObj && g.roleObj.finance && g.roleObj.finance.read) || ((sh && sh.finWho) || []).includes(mid);
}
export const protEdit = (db, M, mid, pr) => isOwner(db, M, mid) || (pr.who || []).some((e) => entryHas(db, M, mid, e));
export function engineCfg(r, kind) {
  const edit = r.edit, review = kind !== 'sheet' && r.suggest, comment = r.comment;
  return 'edit: ' + edit + ' · review: ' + (edit || review) + ' · comment: ' + comment + ' · download: ' + r.export + ' · print: ' + r.export;
}
export const docPeople = (db, M, d) => (db.members || []).filter((m) => m.status !== 'blocked' && docAccess(db, M, m.id, d).L > 0);

/** Кто получит и кто потеряет доступ, если поменять список или папку. */
function diffAccess(db, M, d, d2) {
  const gain = [], lose = [], up = [], down = [];
  (db.members || []).filter((m) => m.status !== 'blocked').forEach((m) => {
    const a = docAccess(db, M, m.id, d).L, b = docAccess(db, M, m.id, d2).L; if (a === b) return;
    const x = { id: m.id, name: m.name, from: a, to: b, invited: m.status === 'invited' };
    (a === 0 ? gain : b === 0 ? lose : b > a ? up : down).push(x);
  });
  return { gain, lose, up, down };
}
export const docShareImpact = (db, M, d, patch) => diffAccess(db, M, d, { ...d, mode: patch.mode || d.mode, share: patch.share || d.share });
export const docMoveImpact = (db, M, d, folder) => diffAccess(db, M, d, { ...d, folder });

// ── Маршрут ──
export function stepWaiting(st) {
  if (!st || st.status !== 'active') return [];
  if (st.kind === 'approve') { const ok = new Set(st.decisions.filter((x) => x.decision === 'ok').map((x) => x.member)), left = st.who.filter((id) => !ok.has(id)); return st.mode === 'seq' ? left.slice(0, 1) : st.mode === 'any' ? (ok.size ? [] : left) : left; }
  if (st.kind === 'sign') return st.decisions.some((x) => x.decision === 'ok') ? [] : st.who.slice(0, 1);
  if (st.kind === 'ext') return st.decisions.some((x) => x.decision === 'ok') ? [] : ['ext'];
  if (st.kind === 'ack') { const done = new Set(st.done.map((x) => x.member)); return st.people.filter((id) => !done.has(id)); }
  return [];
}
export function docWaits(db, M, mid, d) {
  const w = [], r = d.route;
  if (r && r.status === 'active') { const st = r.steps[r.cur]; if (stepWaiting(st).includes(mid)) w.push({ kind: st.kind, due: st.due }); }
  if (r && r.status === 'returned' && r.by === mid) w.push({ kind: 'returned', who: r.back && r.back.name, comment: r.back && r.back.comment });
  (d.comments || []).forEach((c) => { if (!c.resolved && c.mention === mid && !(c.replies || []).some((x) => x.byId === mid)) w.push({ kind: 'mention', cid: c.id, by: (mem(db, c.by) || {}).name, text: c.text }); });
  if (d.ocr && d.ocr.status === 'done' && (d.ocr.words || []).some((x) => x.st === 'open') && (d.owner === mid || isOwner(db, M, mid))) w.push({ kind: 'ocr', n: d.ocr.words.filter((x) => x.st === 'open').length });
  return w;
}
export function docStatus(d) {
  const r = d.route;
  if (r && r.status === 'active') {
    const st = r.steps[r.cur];
    if (st.kind === 'approve') return ['info', 'task_alt', 'Согласование · ' + st.decisions.filter((x) => x.decision === 'ok').length + ' из ' + (st.mode === 'any' ? 1 : st.who.length)];
    if (st.kind === 'sign') return ['warn', 'approval', 'Утверждение · ждёт подписи'];
    if (st.kind === 'ext') return ['warn', 'signature', 'Подпись заказчика · SMS'];
    if (st.kind === 'ack') return ['info', 'visibility', 'Ознакомление · ' + st.done.length + ' из ' + st.people.length];
  }
  if (r && r.status === 'returned') return ['warn', 'undo', 'На доработке'];
  if (d.pdfa) return d.status === 'signed' ? ['ok', 'verified', 'PDF/A · подписанная копия'] : ['neutral', 'inventory_2', 'PDF/A · архив'];
  if (d.status === 'signed') return ['ok', 'verified', 'Подписан · ПЭП'];
  if (d.status === 'approved') return ['ok', 'verified', 'Утверждён · ПЭП'];
  if (d.status === 'agreed') return ['ok', 'check_circle', 'Согласован'];
  const jr = (d.jobs || []).find((j) => j.status === 'running'); if (jr) return ['info', 'hourglass_top', jr.name + '…'];
  const n = d.ocr && d.ocr.status === 'done' ? (d.ocr.words || []).filter((x) => x.st === 'open').length : 0;
  if (n) return ['warn', 'document_scanner', 'Проверить ' + plural(n, 'слово', 'слова', 'слов')];
  if ((d.presence || []).length) return ['info', 'edit', 'Правят сейчас · ' + d.presence.length];
  return ['neutral', 'edit_note', 'Черновик'];
}
export function routeSheet(db, d, r, noAck) {
  r = r || d.route; if (!r) return { rows: [], v: d.v, sha: '' };
  const nm = (id) => (mem(db, id) || {}).name || id, rows = [];
  r.steps.forEach((st, i) => {
    const s = (i + 1) + ' · ' + st.name, wait = st.status === 'wait' ? 'после шага ' + i : 'ждёт';
    if (st.kind === 'ack') { if (!noAck) rows.push({ s, w: st.status === 'wait' ? 'после утверждения' : plural(st.people.length, 'сотрудник', 'сотрудника', 'сотрудников'), r: st.status === 'wait' ? '—' : st.done.length + ' из ' + st.people.length, at: '' }); return; }
    if (st.kind === 'ext') { const x = st.decisions.find((y) => y.decision === 'ok'); rows.push({ s, w: st.ext.name, r: x ? 'Подписал(а) · код из SMS' + (x.demo ? ' · демо' : '') : wait, at: x ? x.at : '' }); return; }
    st.who.forEach((id) => {
      const x = st.decisions.filter((y) => y.member === id).slice(-1)[0];
      rows.push({ s, w: nm(id), r: x ? (x.decision === 'ok' ? (st.kind === 'sign' ? 'Утвердил(а) · ПЭП, код из SMS' : 'Согласовал(а)') + (x.demo ? ' · демо' : '') : 'Вернул(а) на доработку') : st.status === 'done' ? 'не потребовалось' : wait, at: x ? x.at : '' });
    });
  });
  const ver = (d.versions || []).find((x) => x.v === r.v);
  return { rows, v: r.v, sha: shaOf(ver ? ver.body || ver.sheets || ver.pages || ver.v : r.v) };
}

// ── Поля CRM ──
export function fieldVals(db, d) {
  const out = {}, lk = (d.links || [])[0], o = lk && lk.kind === 'object' ? objOf(db, lk.id) : null, t = lk && lk.kind === 'trip' ? (db.trips || []).find((x) => x.id === lk.id) : null;
  const ten = ((db.platform && db.platform.tenants) || [])[0] || {}, own = (db.members || []).find((m) => m.id === 'm-owner'), top = folderPath(db, d.folder)[0];
  (d.fields || []).forEach((f) => {
    let v = f.v || '';
    if (d.frozen && f.k in d.frozen) v = d.frozen[f.k];
    else if (f.src === 'tenant') v = 'ООО «' + (ten.name || '') + '»';
    else if (f.src === 'owner') v = own ? own.name : '';
    else if (f.src === 'unit') v = top && top.unit ? unitName(db, top.unit) : ten.name || '';
    else if (f.src && f.src.startsWith('obj.')) v = o ? o[f.src.slice(4)] || '' : f.v || '';
    else if (f.src === 'trip.driverName') v = t ? t.driverName || '' : '';
    else if (f.src === 'trip.date') v = t ? t.date : '';
    else if (f.src === 'trip.ref') v = t ? t.id + ' · ' + t.title : '';
    else if (f.src === 'trip.vehicle') { const vh = t && (db.vehicles || []).find((x) => x.id === t.vehicleId); v = vh ? vh.model + ' ' + vh.plate : t ? 'машина не назначена' : ''; }
    out[f.k] = v;
  });
  return out;
}

export const fillTokens = (text, vals) => String(text || '').replace(/\{([^{}]+)\}/g, (m, k) => (vals && k in vals ? vals[k] : m));

// ── Таблица: ссылки, формулы, формат ──
const COLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const colName = (i) => COLS[i] || '?';
export const parseKey = (k) => { const m = /^\$?([A-Z])\$?(\d+)$/.exec(String(k || '').toUpperCase()); return m ? { c: COLS.indexOf(m[1]), r: +m[2] } : null; };
export const keyOf = (c, r) => COLS[c] + r;
export function rangeKeys(a, b) { const x = parseKey(a), y = parseKey(b || a); if (!x || !y) return []; const out = []; for (let r = Math.min(x.r, y.r); r <= Math.max(x.r, y.r); r++) for (let c = Math.min(x.c, y.c); c <= Math.max(x.c, y.c); c++) out.push(keyOf(c, r)); return out; }
export function inRange(key, range) { const [a, b] = String(range).split(':'), p = parseKey(key), x = parseKey(a), y = parseKey(b || a); if (!p || !x || !y) return false; return p.c >= Math.min(x.c, y.c) && p.c <= Math.max(x.c, y.c) && p.r >= Math.min(x.r, y.r) && p.r <= Math.max(x.r, y.r); }
export const FN_LIST = [
  ['СУММ', 'SUM', 'Сумма чисел'], ['СРЗНАЧ', 'AVERAGE', 'Среднее'], ['СРЗНАЧЕСЛИ', 'AVERAGEIF', 'Среднее по одному условию'], ['СРЗНАЧЕСЛИМН', 'AVERAGEIFS', 'Среднее по нескольким условиям'],
  ['СЧЁТ', 'COUNT', 'Количество чисел'], ['СЧЁТЗ', 'COUNTA', 'Количество непустых'], ['СЧЁТЕСЛИ', 'COUNTIF', 'Количество по условию'], ['СЧЁТЕСЛИМН', 'COUNTIFS', 'Количество по нескольким условиям'],
  ['СУММЕСЛИ', 'SUMIF', 'Сумма по условию'], ['СУММЕСЛИМН', 'SUMIFS', 'Сумма по нескольким условиям'], ['МИН', 'MIN', 'Наименьшее'], ['МАКС', 'MAX', 'Наибольшее'],
  ['ОКРУГЛ', 'ROUND', 'Округлить до N знаков'], ['ЕСЛИ', 'IF', 'Значение по условию'], ['И', 'AND', 'Все условия верны'], ['ИЛИ', 'OR', 'Хотя бы одно условие верно'], ['НЕ', 'NOT', 'Обратное значение'],
  ['ЕСЛИОШИБКА', 'IFERROR', 'Значение при ошибке'], ['ABS', 'ABS', 'Модуль числа'], ['СЦЕП', 'CONCAT', 'Объединить текст'],
];
export const FN_SIG = {
  'СУММ': 'СУММ(число1; [число2]; …)', 'СРЗНАЧ': 'СРЗНАЧ(число1; [число2]; …)', 'СРЗНАЧЕСЛИ': 'СРЗНАЧЕСЛИ(диапазон; условие; [диапазон_усреднения])', 'СРЗНАЧЕСЛИМН': 'СРЗНАЧЕСЛИМН(диапазон_усреднения; диапазон_условия1; условие1; …)',
  'СЧЁТ': 'СЧЁТ(значение1; …)', 'СЧЁТЗ': 'СЧЁТЗ(значение1; …)', 'СЧЁТЕСЛИ': 'СЧЁТЕСЛИ(диапазон; условие)', 'СЧЁТЕСЛИМН': 'СЧЁТЕСЛИМН(диапазон_условия1; условие1; …)', 'СУММЕСЛИ': 'СУММЕСЛИ(диапазон; условие; [диапазон_суммирования])',
  'СУММЕСЛИМН': 'СУММЕСЛИМН(диапазон_суммирования; диапазон_условия1; условие1; …)', 'МИН': 'МИН(число1; …)', 'МАКС': 'МАКС(число1; …)', 'ОКРУГЛ': 'ОКРУГЛ(число; число_разрядов)', 'ЕСЛИ': 'ЕСЛИ(условие; [значение_если_истина]; [значение_если_ложь])',
  'И': 'И(условие1; …)', 'ИЛИ': 'ИЛИ(условие1; …)', 'НЕ': 'НЕ(условие)', 'ЕСЛИОШИБКА': 'ЕСЛИОШИБКА(значение; значение_при_ошибке)', 'ABS': 'ABS(число)', 'СЦЕП': 'СЦЕП(текст1; …)',
};
const ALIAS = Object.fromEntries(FN_LIST.map(([ru, en]) => [en, ru]));
const upperOut = (s) => String(s).replace(/"[^"]*"|[^"]+/g, (x) => (x[0] === '"' ? x : x.toUpperCase()));
function lex(s) {
  const T = [], R = [['ws', /^\s+/], ['str', /^"([^"]*)"/], ['rng', /^\$?[A-Z]\$?\d+:\$?[A-Z]\$?\d+/], ['fn', /^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9.]*(?=\s*\()/], ['ref', /^\$?[A-Z]\$?\d+(?![A-ZА-ЯЁ0-9(])/], ['bool', /^(ИСТИНА|ЛОЖЬ|TRUE|FALSE)(?![A-ZА-ЯЁ0-9])/], ['num', /^\d+(?:[.,]\d+)?/], ['op', /^(<=|>=|<>|[-+*/^&=<>%();,])/]];
  let i = 0;
  while (i < s.length) {
    const rest = s.slice(i); let hit = null;
    for (const [t, re] of R) { const m = re.exec(rest); if (m) { hit = [t, m]; break; } }
    if (!hit) throw new Error('непонятный символ «' + s[i] + '»');
    const [t, m] = hit; i += m[0].length;
    if (t === 'ws') continue;
    T.push({ t, v: t === 'str' ? m[1] : t === 'num' ? parseFloat(m[0].replace(',', '.')) : t === 'bool' ? /^(ИСТИНА|TRUE)$/.test(m[1]) : m[0].replace(/\$/g, '') });
  }
  return T;
}
function parse(T) {
  let p = 0; const peek = () => T[p], next = () => T[p++], isOp = (v) => !!T[p] && T[p].t === 'op' && T[p].v === v;
  const CMP = ['=', '<>', '<', '>', '<=', '>='];
  const cmp = () => { let a = cat(); while (T[p] && T[p].t === 'op' && CMP.includes(T[p].v)) { const o = next().v; a = { k: 'bin', o, a, b: cat() }; } return a; };
  const cat = () => { let a = add(); while (isOp('&')) { next(); a = { k: 'bin', o: '&', a, b: add() }; } return a; };
  const add = () => { let a = mul(); while (isOp('+') || isOp('-')) { const o = next().v; a = { k: 'bin', o, a, b: mul() }; } return a; };
  const mul = () => { let a = pow(); while (isOp('*') || isOp('/')) { const o = next().v; a = { k: 'bin', o, a, b: pow() }; } return a; };
  const pow = () => { let a = un(); while (isOp('^')) { next(); a = { k: 'bin', o: '^', a, b: un() }; } return a; };
  const un = () => { if (isOp('-')) { next(); return { k: 'neg', a: un() }; } if (isOp('+')) { next(); return un(); } return post(); };
  const post = () => { let a = prim(); while (isOp('%')) { next(); a = { k: 'pct', a }; } return a; };
  function prim() {
    const t = next(); if (!t) throw new Error('формула оборвалась');
    if (['num', 'str', 'bool', 'ref', 'rng'].includes(t.t)) return { k: t.t, v: t.v };
    if (t.t === 'fn') {
      if (!isOp('(')) throw new Error('после ' + t.v + ' нужна скобка'); next();
      const args = [];
      if (!isOp(')')) { args.push(cmp()); while (isOp(';') || isOp(',')) { next(); args.push(cmp()); } }
      if (!isOp(')')) throw new Error('не закрыта скобка в ' + t.v); next();
      return { k: 'fn', n: t.v, args };
    }
    if (t.t === 'op' && t.v === '(') { const e = cmp(); if (!isOp(')')) throw new Error('не закрыта скобка'); next(); return e; }
    throw new Error('лишний символ «' + t.v + '»');
  }
  const e = cmp(); if (p < T.length) throw new Error('лишний символ «' + peek().v + '»');
  return e;
}
export function checkFormula(raw) { try { parse(lex(upperOut(String(raw).replace(/^=/, '')))); return null; } catch (e) { return e.message; } }
const isErr = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && 'err' in v;
const ERR = (c) => ({ err: c });
export function sheetCompute(sheet) {
  const cells = (sheet && sheet.cells) || {}, memo = {}, stack = new Set();
  const num = (v) => (v == null || v === '' ? 0 : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : /^-?\d+(?:[.,]\d+)?$/.test(String(v).trim()) ? parseFloat(String(v).trim().replace(',', '.')) : NaN);
  const truthy = (v) => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : !!v);
  const val = (key) => {
    if (key in memo) return memo[key];
    const c = cells[key]; if (!c) return null;
    if (c.f == null) return c.v === undefined ? null : c.v;
    if (stack.has(key)) return ERR('#ЦИКЛ!');
    stack.add(key); let r;
    try { r = ev(parse(lex(upperOut(String(c.f).replace(/^=/, ''))))); if (Array.isArray(r)) r = r.length ? r[0] : null; } catch (e) { r = ERR('#ИМЯ?'); }
    stack.delete(key); memo[key] = r; return r;
  };
  const rng = (s) => { const [a, b] = s.split(':'); return rangeKeys(a, b).map(val); };
  const arg = (a) => (a && a.k === 'rng' ? rng(a.v) : [ev(a)]);
  const flat = (A) => A.flatMap(arg);
  const crit = (c) => {
    if (typeof c === 'number') return (v) => num(v) === c;
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(c == null ? '' : c)), o = m[1] || '=', rhs = m[2], n = num(rhs);
    if (rhs !== '' && !isNaN(n)) return (v) => { const x = num(v); if (v == null || v === '' || isNaN(x)) return o === '<>'; return o === '=' ? x === n : o === '<>' ? x !== n : o === '<' ? x < n : o === '>' ? x > n : o === '<=' ? x <= n : x >= n; };
    const s = rhs.toLowerCase(); return (v) => { const t = String(v == null ? '' : v).toLowerCase(); return o === '<>' ? t !== s : t === s; };
  };
  const pairs = (A) => { const out = []; for (let i = 0; i + 1 < A.length; i += 2) out.push([arg(A[i]), crit(ev(A[i + 1]))]); return out; };
  const avg = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : ERR('#ДЕЛ/0!'));
  function call(name, A) {
    const xs = () => flat(A), e0 = (v) => v.find(isErr);
    switch (name) {
      case 'СУММ': { const v = xs(), e = e0(v); return e || v.reduce((s, x) => s + (typeof x === 'number' ? x : 0), 0); }
      case 'СРЗНАЧ': { const v = xs(), e = e0(v); return e || avg(v.filter((x) => typeof x === 'number')); }
      case 'МИН': case 'МАКС': { const v = xs(), e = e0(v); if (e) return e; const n = v.filter((x) => typeof x === 'number'); return n.length ? Math[name === 'МИН' ? 'min' : 'max'](...n) : 0; }
      case 'СЧЁТ': return xs().filter((x) => typeof x === 'number').length;
      case 'СЧЁТЗ': return xs().filter((x) => x != null && x !== '').length;
      case 'ОКРУГЛ': { const a = ev(A[0]); if (isErr(a)) return a; const x = num(a), d = A[1] ? num(ev(A[1])) : 0; if (isNaN(x)) return ERR('#ЗНАЧ!'); const k = Math.pow(10, d); return Math.round(x * k) / k; }
      case 'ЕСЛИ': { const c = ev(A[0]); if (isErr(c)) return c; return truthy(c) ? (A[1] ? ev(A[1]) : true) : A[2] ? ev(A[2]) : false; }
      case 'И': return xs().every(truthy);
      case 'ИЛИ': return xs().some(truthy);
      case 'НЕ': return !truthy(ev(A[0]));
      case 'ЕСЛИОШИБКА': { const v = ev(A[0]); return isErr(v) ? (A[1] ? ev(A[1]) : '') : v; }
      case 'ABS': { const x = num(ev(A[0])); return isNaN(x) ? ERR('#ЗНАЧ!') : Math.abs(x); }
      case 'СЦЕП': return xs().map((x) => (x == null ? '' : x)).join('');
      case 'СУММЕСЛИ': { const r = arg(A[0]), p = crit(ev(A[1])), s = A[2] ? arg(A[2]) : r; return r.reduce((t, v, i) => (p(v) ? t + (num(s[i]) || 0) : t), 0); }
      case 'СЧЁТЕСЛИ': { const r = arg(A[0]), p = crit(ev(A[1])); return r.filter(p).length; }
      case 'СРЗНАЧЕСЛИ': { const r = arg(A[0]), p = crit(ev(A[1])), s = A[2] ? arg(A[2]) : r; return avg(r.map((v, i) => (p(v) ? num(s[i]) : NaN)).filter((x) => !isNaN(x))); }
      case 'СУММЕСЛИМН': { const s = arg(A[0]), c = pairs(A.slice(1)); return s.reduce((t, v, i) => (c.every(([r, p]) => p(r[i])) ? t + (num(v) || 0) : t), 0); }
      case 'СРЗНАЧЕСЛИМН': { const s = arg(A[0]), c = pairs(A.slice(1)); return avg(s.map((v, i) => (c.every(([r, p]) => p(r[i])) ? num(v) : NaN)).filter((x) => !isNaN(x))); }
      case 'СЧЁТЕСЛИМН': { const c = pairs(A); const n = c.length ? c[0][0].length : 0; let k = 0; for (let i = 0; i < n; i++) if (c.every(([r, p]) => p(r[i]))) k++; return k; }
      default: return ERR('#ИМЯ?');
    }
  }
  function ev(n) {
    if (n.k === 'num' || n.k === 'str' || n.k === 'bool') return n.v;
    if (n.k === 'ref') return val(n.v);
    if (n.k === 'rng') return rng(n.v);
    if (n.k === 'neg') { const a = ev(n.a); if (isErr(a)) return a; const x = num(a); return isNaN(x) ? ERR('#ЗНАЧ!') : -x; }
    if (n.k === 'pct') { const a = ev(n.a); return isErr(a) ? a : num(a) / 100; }
    if (n.k === 'fn') return call(ALIAS[n.n] || n.n, n.args);
    let a = ev(n.a), b = ev(n.b); if (Array.isArray(a)) a = a[0]; if (Array.isArray(b)) b = b[0];
    if (isErr(a)) return a; if (isErr(b)) return b;
    if (n.o === '&') return String(a == null ? '' : a) + String(b == null ? '' : b);
    if (['=', '<>', '<', '>', '<=', '>='].includes(n.o)) {
      const txt = (typeof a === 'string' && isNaN(num(a))) || (typeof b === 'string' && isNaN(num(b)));
      const x = txt ? String(a == null ? '' : a).toLowerCase() : num(a), y = txt ? String(b == null ? '' : b).toLowerCase() : num(b);
      return n.o === '=' ? x === y : n.o === '<>' ? x !== y : n.o === '<' ? x < y : n.o === '>' ? x > y : n.o === '<=' ? x <= y : x >= y;
    }
    const x = num(a), y = num(b); if (isNaN(x) || isNaN(y)) return ERR('#ЗНАЧ!');
    if (n.o === '/' && y === 0) return ERR('#ДЕЛ/0!');
    return n.o === '+' ? x + y : n.o === '-' ? x - y : n.o === '*' ? x * y : n.o === '/' ? x / y : Math.pow(x, y);
  }
  return { get: val };
}
const nf = (x, d, min) => Number(x).toLocaleString('ru-RU', { minimumFractionDigits: min == null ? d : min, maximumFractionDigits: d });
export function fmtVal(v, fmt) {
  if (v == null || v === '') return '';
  if (isErr(v)) return v.err;
  if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
  if (typeof v === 'number') {
    if (fmt === 'dpct') return (v > 0 ? '+' : '') + nf(v * 100, 1) + ' %';
    if (fmt === 'pct') return nf(v * 100, 1) + ' %';
    if (fmt === 'n0') return nf(v, 0);
    if (fmt === 'n1') return nf(v, 1);
    if (fmt === 'rub') return nf(v, 0) + ' ₽';
    return nf(v, 2, 0);
  }
  return String(v);
}
export const valErr = isErr;
export const rawOf = (c) => (!c ? '' : c.f != null ? c.f : c.v == null ? '' : typeof c.v === 'number' ? String(c.v).replace('.', ',') : String(c.v));
export function gridOf(sh) {
  const C = sheetCompute(sh), keys = Object.keys(sh.cells || {}).map(parseKey).filter(Boolean);
  const rows = Math.min(16, Math.max(1, ...keys.map((k) => k.r))), cols = Math.min(10, Math.max(1, ...keys.map((k) => k.c + 1)));
  const out = [];
  for (let r = 1; r <= rows; r++) { const row = []; for (let c = 0; c < cols; c++) { const k = keyOf(c, r), cell = (sh.cells || {})[k]; row.push(cell ? fmtVal(C.get(k), cell.fmt) : ''); } out.push(row); }
  return out;
}
function csvCells(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 200), cells = {};
  if (!lines.length) return { cells, rows: 20, cols: 8 };
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  let cols = 1;
  lines.forEach((l, r) => { const xs = l.split(sep).slice(0, 26); cols = Math.max(cols, xs.length); xs.forEach((x, c) => { const v = x.trim().replace(/^"|"$/g, ''); if (!v) return; const n = v.replace(/\s/g, '').replace(',', '.'); cells[COLS[c] + (r + 1)] = { v: /^-?\d+(\.\d+)?$/.test(n) ? +n : v, ...(r === 0 ? { st: 'head' } : {}) }; }); });
  return { cells, rows: Math.max(20, lines.length + 5), cols: Math.max(8, cols) };
}

// ── Шаблоны ──
export const DOC_TEMPLATES = [
  { id: 'tpl-order', name: 'Приказ по фирме', kind: 'text', icon: 'gavel', hint: 'Номер, тема, пункты. Маршрут папки «Приказы»: согласовать → утвердить → ознакомить', link: null, folder: 'fd-log-ord', fields: [{ k: 'Фирма', src: 'unit' }],
    body: [['title', 'ПРИКАЗ № '], ['meta', '{Фирма} | «__» ________ 2026 г.'], ['h', 'О …'], ['p', 'Приказываю:'], ['li', '1. …'], ['p', 'Контроль исполнения оставляю за собой.']] },
  { id: 'tpl-poa', name: 'Доверенность на получение груза', kind: 'text', icon: 'badge', hint: 'Поля из рейса: водитель, машина, рейс', link: 'trip', folder: 'fd-log', fields: [{ k: 'Организация', src: 'tenant' }, { k: 'Водитель', src: 'trip.driverName' }, { k: 'Машина', src: 'trip.vehicle' }, { k: 'Рейс', src: 'trip.ref' }, { k: 'Дата рейса', src: 'trip.date' }, { k: 'Руководитель', src: 'owner' }],
    body: [['title', 'ДОВЕРЕННОСТЬ'], ['meta', 'г. Москва | {Дата рейса}'], ['p', '{Организация} доверяет водителю {Водитель} получить груз по рейсу {Рейс} и перевезти его на машине {Машина}.'], ['p', 'Доверенность действительна в день рейса.'], ['meta', 'Руководитель | {Руководитель}']] },
  { id: 'tpl-act', name: 'Акт скрытых работ', kind: 'text', icon: 'construction', hint: 'Поля из объекта: адрес, заказчик, прораб', link: 'object', folder: 'fd-o42', fields: [{ k: 'Объект', src: 'obj.name' }, { k: 'Адрес объекта', src: 'obj.address' }, { k: 'Заказчик', src: 'obj.client' }, { k: 'Прораб', src: 'obj.foreman' }],
    body: [['title', 'АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ'], ['meta', '{Адрес объекта} | «__» ________ 2026 г.'], ['p', 'Объект: {Объект}. Заказчик: {Заказчик}. Работы выполнил прораб {Прораб}.'], ['h', 'Предъявлены к освидетельствованию'], ['li', '1. …'], ['p', 'Работы выполнены по проекту и технологии. Разрешается выполнение последующих работ.']] },
];

// ── Демо-данные ──
const B = (id, t, text, o) => ({ id, t, text: text || '', ...(o || {}) });
const CONTRACT = [
  B('b-t', 'title', 'ДОГОВОР ПОДРЯДА № 42/26'), B('b-m', 'meta', 'г. Москва | «1» октября 2026 г.'),
  B('b-0', 'p', '{Подрядчик} (Подрядчик), директор — {Подписант}, и {Заказчик} (Заказчик) заключили настоящий договор о нижеследующем.'),
  B('b-h1', 'h', '1. Предмет договора'), B('b-11', 'p', '1.1. Подрядчик выполняет капитальный ремонт квартиры ({Площадь}) по адресу {Адрес объекта} в объёме сметы {Смета} (Приложение 1).'),
  B('b-h2', 'h', '2. Сроки выполнения работ'), B('b-21', 'p', '2.1. Начало работ — 14 сентября 2026 г. Окончание — 27 ноября 2026 г. с учётом технологических пауз по графику работ.'),
  B('b-h3', 'h', '3. Цена и порядок расчётов'), B('b-31', 'p', '3.1. Цена работ — {Цена}, включая материалы по Приложению 1.'), B('b-32', 'p', '3.2. Аванс и оплата этапов производятся по таблице:'),
  B('b-tb', 'table', '', { rows: [['Этап', 'Доля', 'Сумма'], ['Аванс', '30 %', '374 490 ₽'], ['После этапа «Электрика»', '40 %', '499 320 ₽'], ['После приёмки объекта', '30 %', '374 490 ₽']] }),
  B('b-h4', 'h', '4. Права и обязанности сторон'), B('b-41', 'p', '4.1. Подрядчик выполняет работы своими силами и силами субподрядчиков и отвечает за их качество и сроки.'),
  B('b-42', 'p', '4.2. Заказчик обеспечивает доступ на объект в согласованное время и принимает этапы в течение 3 рабочих дней.'),
  B('b-h5', 'h', '5. Приёмка работ'), B('b-51', 'p', '5.1. Этапы принимаются по акту. Скрытые работы принимаются до начала следующего этапа.'),
  B('b-h6', 'h', '6. Гарантия'), B('b-61', 'p', '6.1. Гарантия на выполненные работы — 24 месяца с даты подписания итогового акта.'),
];
const ORDER = [
  B('o-t', 'title', 'ПРИКАЗ № 14'), B('o-m', 'meta', '{Фирма} | «1» октября 2026 г.'), B('o-h', 'h', 'О работе 4 ноября 2026 г.'),
  B('o-0', 'p', 'В связи с нерабочим праздничным днём 4 ноября 2026 г. приказываю:'), B('o-1', 'li', '1. 4 ноября рейсы не планировать.'),
  B('o-2', 'li', '2. Дежурный диспетчер 4 ноября — Марина Котова, телефон в карточке сотрудника.'), B('o-3', 'li', '3. Машины, вернувшиеся 3 ноября, сдать до 20:00 с полной приёмкой.'),
  B('o-4', 'li', '4. Работа в праздник оплачивается по табелю.'), B('o-s', 'meta', 'Руководитель логистики | Марина Котова'),
];
const S = (v, o) => ({ v, ...(o || {}) }), Fm = (f, o) => ({ f, ...(o || {}) }), HD = { st: 'head' }, HR = { st: 'head', al: 'r' };
function fuelSheets() {
  const c = { A1: S('Расход топлива · октябрь 2026 · «Север Логистик»', { st: 'title' }), A2: S('Машина', HD), B2: S('Модель', HD), C2: S('Водитель', HD), D2: S('Пробег, км', HR), E2: S('Литры', HR), F2: S('л/100 км', HR), G2: S('Норма', HR), H2: S('Отклонение', HR), I2: S('Сумма, ₽', HR) };
  [['А 412 МР 77', 'ГАЗель Next', 'Илья Васильев', 2140, 268, 12, 19135], ['Т 771 ЕХ 77', 'Mercedes Sprinter', 'Тимур Ахмедов', 1870, 221, 11.5, 15779], ['М 608 КТ 77', 'Ford Transit · реф.', 'Водитель #104 · пул', 1320, 198, 13, 14137], ['В 233 ОС 77', 'Hyundai Porter', 'Илья Васильев', 980, 103, 10, 7354]].forEach(([a, b, cc, d, e, g, i], k) => {
    const r = k + 3;
    Object.assign(c, { ['A' + r]: S(a, { mono: true }), ['B' + r]: S(b), ['C' + r]: S(cc), ['D' + r]: S(d, { fmt: 'n0' }), ['E' + r]: S(e, { fmt: 'n0' }), ['F' + r]: Fm('=ОКРУГЛ(E' + r + '/D' + r + '*100;1)', { fmt: 'n1' }), ['G' + r]: S(g, { fmt: 'n1' }), ['H' + r]: Fm('=F' + r + '/G' + r + '-1', { fmt: 'dpct' }), ['I' + r]: S(i, { fmt: 'n0' }) });
  });
  Object.assign(c, { A7: S('Итого · 4 машины', { st: 'total' }), B7: S('', { st: 'total' }), C7: S('', { st: 'total' }), D7: Fm('=СУММ(D3:D6)', { st: 'total', fmt: 'n0' }), E7: Fm('=СУММ(E3:E6)', { st: 'total', fmt: 'n0' }), F7: Fm('=ОКРУГЛ(E7/D7*100;1)', { st: 'total', fmt: 'n1' }), G7: S('', { st: 'total' }), H7: S('', { st: 'total' }), I7: Fm('=СУММ(I3:I6)', { st: 'total', fmt: 'n0' }),
    A9: S('Средний расход, где норма от 12 л', { st: 'note' }), F9: Fm('=СРЗНАЧЕСЛИ(G3:G6;">=12";F3:F6)', { fmt: 'n1' }) });
  return [
    { id: 'sh-oct', name: 'Октябрь', cols: 10, rows: 14, w: [104, 140, 140, 92, 70, 78, 70, 96, 88, 60], merges: { A1: 9, A7: 3, A9: 5 }, freeze: 2, cells: c },
    { id: 'sh-norm', name: 'Нормы', cols: 4, rows: 10, w: [170, 140, 120, 80], cells: { A1: S('Модель', HD), B1: S('Норма, л/100 км', HR), A2: S('ГАЗель Next'), B2: S(12, { fmt: 'n1' }), A3: S('Mercedes Sprinter'), B3: S(11.5, { fmt: 'n1' }), A4: S('Ford Transit · реф.'), B4: S(13, { fmt: 'n1' }), A5: S('Hyundai Porter'), B5: S(10, { fmt: 'n1' }), A6: S('ГАЗон Next'), B6: S(16, { fmt: 'n1' }) } },
    { id: 'sh-pay', name: 'Начисления', fin: true, finWho: ['m-kotova'], cols: 4, rows: 10, w: [170, 80, 110, 130], cells: { A1: S('Водитель', HD), B1: S('Смен', HR), C1: S('Ставка, ₽', HR), D1: S('Начислено, ₽', HR), A2: S('Илья Васильев'), B2: S(18), C2: S(2400, { fmt: 'n0' }), D2: Fm('=B2*C2', { fmt: 'n0' }), A3: S('Тимур Ахмедов'), B3: S(15), C3: S(2400, { fmt: 'n0' }), D3: Fm('=B3*C3', { fmt: 'n0' }), A4: S('Итого', { st: 'total' }), D4: Fm('=СУММ(D2:D3)', { st: 'total', fmt: 'n0' }) } },
  ];
}
const ROUTE_ORDER = { name: 'Приказ по фирме', project: 'fleet', steps: [{ kind: 'approve', mode: 'all', who: ['m-kotelnikova', 'm-ilyin'], days: 2 }, { kind: 'sign', who: ['m-owner'], days: 1 }, { kind: 'ack', audience: [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever' }, { who: 'group', ref: 'g-disp' }], days: 3 }], rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false } };
const ROUTE_CONTRACT = { name: 'Договор с заказчиком', project: 'pj-docs', steps: [{ kind: 'approve', mode: 'all', who: ['m-sokolov'], days: 1 }, { kind: 'ext', days: 3 }], rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false } };
const FD = (id, name, o) => ({ id, name, parent: null, unit: null, mode: 'inherit', share: [], owner: 'm-owner', icon: 'folder', ...(o || {}) });
const base = (o) => ({ status: 'draft', mode: 'inherit', share: [], links: [], dirty: false, authors: [], presence: [], comments: [], suggestions: [], history: [], jobs: [], tmp: [], annots: [], ...o });
const ver = (v, at, by, o) => ({ v, at, by, name: '', source: 'edit', ...(o || {}) });

function altaDocs() {
  const body = clone(CONTRACT), v10 = clone(CONTRACT).map((b) => (b.id === 'b-61' ? { ...b, text: b.text.replace('24 месяца', '12 месяцев') } : b)), v9 = v10.map((b) => (b.id === 'b-21' ? { ...b, text: b.text.replace('27 ноября', '20 ноября') } : b));
  const folders = [
    FD('fd-log', 'Север Логистик', { unit: 'f-msk-sever', icon: 'local_shipping', owner: 'm-kotova', share: [{ who: 'group', ref: 'g-disp', level: 'edit' }] }),
    FD('fd-log-ord', 'Приказы', { parent: 'fd-log', unit: 'f-msk-sever', icon: 'gavel', owner: 'm-kotova', routeTpl: ROUTE_ORDER }),
    FD('fd-log-ctr', 'Договоры', { parent: 'fd-log', unit: 'f-msk-sever', icon: 'handshake' }),
    FD('fd-log-fin', 'Финансы', { parent: 'fd-log', unit: 'f-msk-sever', icon: 'payments', mode: 'listed', sensitivity: 'finance', share: [{ who: 'member', ref: 'm-kotova', level: 'edit' }] }),
    FD('fd-rep', 'Ремонт и стройка', { icon: 'construction' }),
    FD('fd-o42', 'ЖК Речной · квартира 42', { parent: 'fd-rep', icon: 'home_work', link: { kind: 'object', id: 'obj-42' }, share: [{ who: 'relation', ref: 'foreman', obj: 'obj-42', level: 'edit' }], routeTpl: ROUTE_CONTRACT }),
  ];
  const items = [
    base({ id: 'doc-42', kind: 'text', title: 'Договор подряда № 42/26', folder: 'fd-o42', owner: 'm-owner', links: [{ kind: 'object', id: 'obj-42' }], v: 12, body,
      fields: [{ k: 'Подрядчик', src: 'tenant' }, { k: 'Подписант', src: 'owner' }, { k: 'Заказчик', src: 'obj.client' }, { k: 'Адрес объекта', src: 'obj.address' }, { k: 'Площадь', src: 'obj.area' }, { k: 'Смета', v: 'v3 · 1 248 300 ₽', src: 'snap', from: 'Смета v3 · Ремонт и стройка' }, { k: 'Цена', v: '1 248 300 ₽', src: 'snap', from: 'Итог сметы v3' }],
      versions: [ver(9, '24.09 16:05', 'Дарья Зимина', { body: v9 }), ver(10, '29.09 12:40', 'Алексей Соколов, Дарья Зимина', { body: v10 }), ver(11, '01.10 09:58', 'Дарья Зимина', { name: 'Перед согласованием', body: clone(body) }), ver(12, '01.10 10:38', 'Алексей Соколов', { body: clone(body) })],
      saved: { at: '10:41', by: 'm-sokolov' }, upd: { at: '01.10 10:41', by: 'm-sokolov' }, presence: [{ member: 'm-sokolov', block: 'b-21' }],
      suggestions: [{ id: 'sg-1', block: 'b-21', from: '27 ноября 2026 г.', to: '4 декабря 2026 г.', pos: body.find((b) => b.id === 'b-21').text.indexOf('27 ноября'), by: 'm-sokolov', at: '01.10 10:38', note: 'Стяжке нужно 7 дней на сушку, в графике этап уже сдвинут.', status: 'open' }],
      comments: [{ id: 'c-1', block: 'b-32', quote: 'Аванс и оплата этапов', by: 'm-owner', at: '01.10 10:40', text: '@Сергей Ильин, аванс 30 % проводим через кассу или по счёту?', mention: 'm-ilyin', replies: [], resolved: false }] }),
    base({ id: 'doc-fuel', kind: 'sheet', title: 'Расход топлива · октябрь', folder: 'fd-log', owner: 'm-kotova', links: [{ kind: 'set', id: 'expenses', label: 'Наборы «Поездки» и «Расходы»' }], v: 4, sheets: fuelSheets(),
      versions: [ver(3, '30.09 18:10', 'Марина Котова'), ver(4, '01.10 09:40', 'Марина Котова', { source: 'crm', name: 'Обновление из CRM' })],
      prot: [{ id: 'pr-1', sheet: 'sh-oct', range: 'G3:G40', name: 'Норма', who: [{ who: 'role', ref: 'r-manager', unit: 'f-msk-sever' }, { who: 'member', ref: 'm-kotova' }] }],
      crm: { sheet: 'sh-oct', cols: ['D', 'E', 'I'], r1: 3, r2: 6, sets: 'Поездки и Расходы', unit: 'f-msk-sever', at: '09:40', every: 'каждый час' },
      cond: [{ sheet: 'sh-oct', range: 'H3:H6', rules: [{ gt: 0.1, tone: 'danger' }, { gt: 0.03, tone: 'warn' }], note: 'Красный — перерасход больше 10 %, жёлтый — больше 3 %' }],
      chart: { sheet: 'sh-oct', label: 'A', val: 'F', norm: 'G', r1: 3, r2: 6, title: 'л/100 км и норма' },
      saved: { at: '10:42', by: 'm-kotova' }, upd: { at: '01.10 10:38', by: 'm-kotova' }, presence: [{ member: 'm-kotova', sel: 'G3:G6' }],
      comments: [{ id: 'c-2', sheet: 'sh-oct', cell: 'G5', quote: 'G5 · Норма', by: 'm-kotova', at: '01.10 09:52', text: '@Дарья Зимина, норма для Transit с рефрижератором — 13 л? По паспорту 12, но с холодильником выходит больше.', mention: 'm-owner', replies: [], resolved: false }] }),
    base({ id: 'doc-318', kind: 'pdf', title: 'Накладная № 318 · скан', folder: 'fd-o42', owner: 'm-sokolov', links: [{ kind: 'object', id: 'obj-42' }], scan: true, textLayer: true, size: 4.8, v: 1,
      versions: [ver(1, '01.10 09:12', 'Алексей Соколов', { source: 'upload' })], saved: { at: '09:12', by: 'm-sokolov' }, upd: { at: '01.10 09:12', by: 'm-sokolov' },
      pages: [{ id: 'pg-1', art: 'inv1', rot: 0 }, { id: 'pg-2', art: 'inv2', rot: 0 }],
      annots: [{ id: 'an-1', page: 'pg-1', kind: 'stamp', text: 'ПОЛУЧЕНО НА ОБЪЕКТЕ', by: 'А. Соколов', byId: 'm-sokolov', at: '30.09 · 14:20', pep: true }],
      comments: [{ id: 'c-3', page: 'pg-1', quote: 'Итого: 118 440,00 руб.', by: 'm-sokolov', at: '01.10 09:14', text: 'Сумма совпадает с заказом ЗК-27.', replies: [], resolved: false }],
      ocr: { status: 'done', conf: 97, at: '09:21', lang: 'русский и английский', words: [
        { id: 'w1', text: 'Скпадская', sug: 'Складская', conf: 58, why: '«п» вместо «л» в названии улицы', st: 'open' },
        { id: 'w2', text: 'ФК 1S мм', sug: 'ФК 15 мм', conf: 64, why: 'Латинская «S» вместо цифры 5', st: 'open', row: 2 },
        { id: 'w3', text: '89О,00', sug: '890,00', conf: 61, why: 'Буква «О» вместо нуля. С исправлением сумма строки сходится: 6 × 890 = 5 340', st: 'open', row: 3 }] },
      table: { cols: ['Наименование', 'Ед.', 'Кол-во', 'Цена', 'Сумма'], rows: [['Доска обрезная 50×150×6000', 'м³', 2.4, 18500, 44400], ['Брус 100×100×6000', 'м³', 1.2, 21000, 25200], ['Фанера ФК 15 мм', 'лист', 30, 1450, 43500], ['Саморезы 4,2×75, уп. 500', 'уп.', 6, 890, 5340]], total: 118440, words: { 2: 'w2', 3: 'w3' } },
      jobs: [{ id: 'job-2', op: 'merge', name: 'Объединение 4 файлов', status: 'failed', at: '09:30', params: { files: ['Счёт 118.pdf', 'Акт приёмки 318.pdf', 'Фото 2.jpg'] }, error: '«Счёт 118.pdf» защищён паролем: введите пароль или уберите файл' }, { id: 'job-1', op: 'ocr', name: 'Распознавание · 2 страницы', status: 'done', at: '09:21', res: 'Готово за 9 секунд · 97 %' }] }),
    base({ id: 'doc-ord14', kind: 'text', title: 'Приказ № 14 · О работе 4 ноября', folder: 'fd-log-ord', owner: 'm-kotova', v: 6, body: clone(ORDER), fields: [{ k: 'Фирма', src: 'unit' }],
      versions: [ver(5, '30.09 17:20', 'Марина Котова', { body: clone(ORDER).filter((b) => b.id !== 'o-4') }), ver(6, '01.10 09:05', 'Марина Котова', { body: clone(ORDER) })], saved: { at: '09:05', by: 'm-kotova' }, upd: { at: '01.10 09:05', by: 'm-kotova' } }),
    base({ id: 'doc-lease', kind: 'pdf', title: 'Договор аренды стоянки', folder: 'fd-log-ctr', owner: 'm-owner', status: 'signed', textLayer: true, size: 1.2, v: 3,
      versions: [ver(3, '31.08 15:02', 'Марина Котова', { name: 'На согласование' })], saved: { at: '15:02', by: 'm-kotova' }, upd: { at: '01.09 12:10', by: 'm-owner' },
      pages: [{ id: 'pg-l1', art: 'lease1', rot: 0 }, { id: 'pg-l2', art: 'lines', rot: 0 }, { id: 'pg-l3', art: 'lines', rot: 0 }, { id: 'pg-l4', art: 'approval', title: 'Договор аренды стоянки', v: 3, sha: '7c1e…04ad', rows: [{ s: '1 · Согласовать', w: 'Марина Котова', r: 'Согласовал(а)', at: '31.08 16:20' }, { s: '2 · Утвердить', w: 'Дарья Зимина', r: 'Утвердил(а) · ПЭП, код из SMS', at: '01.09 12:10' }], rot: 0 }],
      route: { id: 'rt-0', v: 3, by: 'm-kotova', at: '31.08 15:02', status: 'done', cur: 1, project: null, task: null, rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false },
        steps: [{ kind: 'approve', name: 'Согласовать', mode: 'all', who: ['m-kotova'], days: 1, status: 'done', decisions: [{ member: 'm-kotova', decision: 'ok', at: '31.08 16:20', method: 'click' }] }, { kind: 'sign', name: 'Утвердить', who: ['m-owner'], days: 1, status: 'done', decisions: [{ member: 'm-owner', decision: 'ok', at: '01.09 12:10', method: 'pep_sms' }] }] } }),
    base({ id: 'doc-pay', kind: 'sheet', title: 'Начисления водителям · сентябрь', folder: 'fd-log-fin', owner: 'm-owner', sensitivity: 'finance', v: 2, versions: [ver(2, '28.09 18:30', 'Дарья Зимина')], saved: { at: '18:30', by: 'm-owner' }, upd: { at: '28.09 18:30', by: 'm-owner' },
      sheets: [{ id: 'sh-p1', name: 'Сентябрь', cols: 5, rows: 10, w: [170, 80, 110, 130, 60], cells: { A1: S('Водитель', HD), B1: S('Смен', HR), C1: S('Ставка, ₽', HR), D1: S('Начислено, ₽', HR), A2: S('Илья Васильев'), B2: S(20), C2: S(2400, { fmt: 'n0' }), D2: Fm('=B2*C2', { fmt: 'n0' }), A3: S('Тимур Ахмедов'), B3: S(17), C3: S(2400, { fmt: 'n0' }), D3: Fm('=B3*C3', { fmt: 'n0' }), A4: S('Кирилл Громов'), B4: S(6), C4: S(2400, { fmt: 'n0' }), D4: Fm('=B4*C4', { fmt: 'n0' }), A5: S('Итого', { st: 'total' }), D5: Fm('=СУММ(D2:D4)', { st: 'total', fmt: 'n0' }) } }] }),
  ];
  items.forEach((d) => { if (!d.versions.length) return; const last = d.versions[d.versions.length - 1]; if (d.kind === 'sheet' && !last.sheets) last.sheets = clone(d.sheets); if (d.kind === 'pdf' && !last.pages) last.pages = clone(d.pages); });
  return { folders, items, assign: [{ id: 'adoc-1', member: 'm-kotova', role: 'r-doc-manage', scope: { type: 'folder', id: 'fd-log' } }] };
}
function otherDocs(db) {
  const own = (db.members || [])[0] || { id: 'm-owner' };
  const body = [B('l-t', 'title', 'ПРАВИЛА ЗАПИСИ И ОТМЕНЫ ВИЗИТОВ'), B('l-1', 'p', 'Клиент может перенести или отменить визит не позднее чем за 4 часа. Позднюю отмену отмечает администратор в карточке визита.'), B('l-2', 'p', 'Опоздание больше 15 минут — визит сокращается или переносится по согласованию с мастером.')];
  return { folders: [FD('fd-salon', 'Салон', { icon: 'spa', owner: own.id, share: [{ who: 'all', level: 'view' }] })],
    items: [base({ id: 'doc-l1', kind: 'text', title: 'Правила записи и отмены визитов', folder: 'fd-salon', owner: own.id, v: 1, body, versions: [ver(1, '20.09 11:00', own.name, { body: clone(body) })], saved: { at: '11:00', by: own.id }, upd: { at: '20.09 11:00', by: own.id } })], assign: [] };
}

/** Установка модуля в «БД» организации. Повторный вызов ничего не меняет. */
export function installDocs(db, M) {
  if (db.docs && db.docs.v1) return;
  DOC_ROLES.forEach((r) => { if (!db.roles.some((x) => x.id === r.id)) db.roles.push(clone(r)); });
  const act = (id, a) => { const r = db.roles.find((x) => x.id === id); if (r && !(r.actions && r.actions.docs)) r.actions = { ...(r.actions || {}), docs: a }; };
  act('r-manager', ['view', 'create', 'edit', 'export', 'settings']); act('r-driver', ['view']); act('r-foreman', ['view', 'create', 'edit', 'settings']); act('r-admin', ['view', 'create', 'edit', 'settings']);
  // Водитель видит только адресованное: «Документы · Просматривать» не открывает папки фирмы целиком.
  { const r = db.roles.find((x) => x.id === 'r-driver'); if (r) r.docsAddressed = true; }
  db.projects = db.projects || [];
  if (!db.projects.some((p) => p.id === 'pj-docs')) db.projects.push({ id: 'pj-docs', key: 'ДОК', name: 'Документы · маршруты', unit: null, owner: ((db.members || [])[0] || {}).name || '—', access: 'limited', wf: M.buildWf('approval'), automations: [], runs: [] });
  const x = db.tenantId === 't-alta' ? altaDocs() : otherDocs(db);
  (x.assign || []).forEach((a) => { if (!db.assignments.some((y) => y.id === a.id)) db.assignments.push(a); });
  db.docs = { folders: x.folders, items: x.items, v1: true };
}

/** Ответ сервера участнику: только доступные документы, у каждого — что он может. */
export function docsView(db, M, actor, C) {
  const X0 = db.docs; if (!X0 || !C) return C;
  const items = [];
  C.items.forEach((x) => {
    const d = X0.items.find((y) => y.id === x.id); if (!d) return;
    const r = docRights(db, M, actor, d); if (!r.L) return;
    const { chain, ...my } = r;
    x.my = { ...my, wait: docWaits(db, M, actor, d), people: docPeople(db, M, d).length };
    if (d.kind === 'sheet') x.sheets = x.sheets.map((s) => (s.fin && !finSees(db, M, actor, d, s) ? { id: s.id, name: s.name, fin: true, hidden: true, cols: s.cols, rows: s.rows, w: s.w, cells: {} } : s));
    if (r.onlyV) { const v = (x.versions || []).find((y) => y.v === r.onlyV); if (v && v.body) x.body = v.body; Object.assign(x, { versions: v ? [v] : [], comments: [], suggestions: [], presence: [], jobs: [], share: [], history: [], dirty: false }); }
    items.push(x);
  });
  const vis = new Set(items.map((d) => d.folder)), within = (f) => [...vis].some((id) => folderPath(db, id).some((p) => p.id === f.id));
  const folders = C.folders.map((f) => ({ ...f, my: { L: docAccess(db, M, actor, X0.folders.find((y) => y.id === f.id) || f).L } })).filter((f) => f.my.L > 0 || within(f));
  return { ...C, items, folders };
}

/** Команды mock-адаптера. getDb/getActor — геттеры: адаптер меняет организацию и участника. */
export function docsApi({ getDb, getActor, cmd, ApiError, M, event }) {
  const D = getDb, me = () => getActor();
  const XX = () => { const x = D().docs; if (!x) throw new ApiError('not_found', 'Модуль «Документы» не подключён'); return x; };
  const doc = (id) => { const d = XX().items.find((x) => x.id === id); if (!d) throw new ApiError('not_found', 'Документ не найден или недоступен'); return d; };
  const R = (d) => docRights(D(), M, me(), d);
  const need = (d, lv, what) => { const r = R(d); if (!r.L) throw new ApiError('not_found', 'Документ не найден или недоступен'); if (r.L < lv) throw new ApiError('forbidden', 'Чтобы ' + what + ', нужен уровень «' + DOC_LEVELS[lv] + '». У вас — «' + DOC_LEVELS[r.L] + '»'); return r; };
  const needEdit = (d, what) => { const r = need(d, 4, what || 'править'); if (r.locked) throw new ApiError('validation', d.pdfa ? 'PDF/A-копия не меняется: правьте исходный документ' : 'v' + d.route.v + ' на согласовании — правка закрыта до решения. Комментировать можно'); return r; };
  const meName = () => (mem(D(), me()) || {}).name || '—';
  const nm = (id) => (mem(D(), id) || {}).name || id;
  const nid = (p) => p + D().seq++;
  const touch = (d) => { d.dirty = true; d.saved = { at: hm(), by: me() }; d.authors = [...new Set([...(d.authors || []), me()])]; d.upd = { at: stamp(), by: me() }; };
  const hist = (d, text) => { (d.history = d.history || []).unshift({ at: stamp(), by: meName(), text }); d.history.length = Math.min(d.history.length, 30); };
  const title = (t) => { const s = String(t || '').trim(); if (s.length < 2) throw new ApiError('validation', 'Название — не короче 2 символов'); if (s.length > 120) throw new ApiError('validation', 'Название — не длиннее 120 символов'); return s; };
  const snap = (d) => (d.kind === 'text' ? { body: clone(d.body) } : d.kind === 'sheet' ? { sheets: clone(d.sheets) } : { pages: clone(d.pages), annots: clone(d.annots || []) });
  const cut = (d, o) => {
    const v = d.v + 1, by = (d.authors && d.authors.length ? d.authors : [me()]).map(nm).join(', ');
    d.versions.push({ v, at: stamp(), by, name: (o && o.name) || '', source: (o && o.source) || 'edit', ...snap(d) });
    d.v = v; d.dirty = false; d.authors = []; d.saved = { at: hm(), by: me() }; return v;
  };
  const blank = (kind, t, folder, by) => base({ id: nid('doc-'), kind, title: t, folder, owner: by, v: 1, versions: [], saved: { at: hm(), by }, upd: { at: stamp(), by } });
  const finishNew = (d, source, name) => { d.versions = [{ v: 1, at: stamp(), by: nm(d.owner), name: name || '', source, ...snap(d) }]; XX().items.unshift(d); return d; };
  const taskNote = (d, text) => { const r = d.route, t = r && r.task && (D().tasks || []).find((x) => x.id === r.task); if (t) (t.comments = t.comments || []).push({ by: meName(), at: hm(), text, system: true }); };
  const syncTask = (d) => {
    const db = D(), r = d.route; if (!r || !r.task) return;
    const t = (db.tasks || []).find((x) => x.id === r.task); if (!t) return;
    const p = (db.projects || []).find((x) => x.id === t.project), S2 = (cat, name) => ((p && p.wf && (p.wf.statuses.find((s) => s.name === name) || p.wf.statuses.find((s) => s.cat === cat))) || {}).name || name;
    const st = r.steps[r.cur], wait = r.status === 'active' ? stepWaiting(st) : [], who = (id) => (id === 'ext' ? st.ext.name + ' · заказчик' : nm(id));
    t.docRoute = { doc: d.id, title: d.title, route: r.id, v: r.v, status: r.status, step: st ? st.name : '', n: r.cur + 1, of: r.steps.length, waiting: wait.filter((x) => x !== 'ext'), names: wait.map(who) };
    t.status = r.status === 'active' ? S2('progress', 'На проверке') : r.status === 'returned' ? S2('progress', 'В работе') : r.status === 'done' ? S2('done', 'Готово') : S2('done', 'Отменена');
    t.assignee = r.status === 'returned' || (wait[0] === 'ext') ? nm(r.by) : wait.length ? nm(wait[0]) : t.assignee;
    if (st && st.due) t.due = st.due.slice(0, 5);
  };
  const makePdfA = (d) => {
    const db = D(), r = d.route, ver0 = d.versions.find((x) => x.v === r.v) || {}, sh = routeSheet(db, d, r, true);
    const pages = d.kind === 'pdf' ? clone(ver0.pages || d.pages) : [{ id: nid('pg-'), art: 'from', kind: d.kind, title: d.title, body: d.kind === 'text' ? clone(ver0.body || d.body) : null, grid: d.kind === 'sheet' ? gridOf((ver0.sheets || d.sheets)[0]) : null, fields: fieldVals(db, d), rot: 0 }];
    pages.push({ id: nid('pg-'), art: 'approval', title: d.title, rows: sh.rows, v: r.v, sha: sh.sha, rot: 0 });
    const nd = blank('pdf', d.title + ' · PDF/A', d.folder, r.by);
    Object.assign(nd, { pages, size: 0.6, pdfa: true, status: 'signed', src: { doc: d.id, v: r.v, op: 'route' }, textLayer: true, mode: d.mode, share: clone(d.share || []), sensitivity: d.sensitivity, links: clone(d.links || []) });
    finishNew(nd, 'route', 'Подписанная копия v' + r.v); d.pdfaId = nd.id; return nd;
  };
  const activate = (d, i) => {
    const db = D(), r = d.route, st = r.steps[i]; r.cur = i; st.status = 'active'; st.due = addWork(DOC_TODAY, st.days); st.from = stamp(); d.tmp = d.tmp || [];
    if (st.kind === 'approve') st.who.forEach((x) => { if (docAccess(db, M, x, d).L < 2) d.tmp.push({ member: x, level: 'comment', why: 'Согласующий на время шага «' + st.name + '»', route: r.id, step: i }); });
    if (st.kind === 'ack') {
      st.people = db.members.filter((m) => m.status !== 'blocked' && m.id !== r.by && st.audience.some((e) => entryHas(db, M, m.id, e))).map((m) => m.id);
      st.people.forEach((x) => { if (docAccess(db, M, x, d).L < 1) d.tmp.push({ member: x, level: 'view', v: r.v, why: 'Ознакомление с утверждённой v' + r.v, route: r.id, step: i, keep: true }); });
    }
    const wait = stepWaiting(st).filter((x) => x !== 'ext');
    if (wait.length) event(st.kind === 'ack' ? 'Ознакомьтесь с «' + d.title + '» v' + r.v + ' до ' + st.due : st.kind === 'sign' ? 'Утвердите «' + d.title + '» v' + r.v + ': подпись по коду из SMS' : 'Согласуйте «' + d.title + '» v' + r.v + ' до ' + st.due, st.kind === 'approve' && st.mode === 'seq' ? wait.slice(0, 1) : wait);
    if (st.kind === 'ack' && !st.people.length) { advance(d); return; }
    syncTask(d);
  };
  const advance = (d) => {
    const r = d.route, st = r.steps[r.cur]; st.status = 'done'; st.end = stamp();
    d.tmp = (d.tmp || []).filter((t) => !(t.route === r.id && t.step === r.cur && !t.keep));
    if (st.kind === 'sign' || st.kind === 'ext') { d.status = st.kind === 'sign' ? 'approved' : 'signed'; d.frozen = fieldVals(D(), d); makePdfA(d); }
    if (r.cur + 1 < r.steps.length) { activate(d, r.cur + 1); return; }
    r.status = 'done'; r.end = stamp(); if (d.status === 'draft') d.status = 'agreed';
    hist(d, 'Маршрут завершён'); taskNote(d, 'Маршрут завершён'); event('Маршрут «' + d.title + '» завершён', [r.by]);
    syncTask(d);
  };
  const lockedFile = (f) => /счёт 118|пароль|password|protected/i.test(f);
  const JOBS = { ocr: ['Распознавание', 3200], to_docx: ['PDF → Текст (DOCX)', 2600], to_xlsx: ['PDF → Таблица (XLSX)', 2200], pdfa: ['PDF/A для архива', 1800], compress: ['Сжатие', 1600], merge: ['Объединение', 2400], to_pdf: ['Экспорт в PDF', 1600] };
  const startJob = (d, op, params) => {
    const files = (params && params.files) || [];
    const j = { id: nid('job-'), op, name: JOBS[op][0] + (op === 'ocr' ? ' · ' + plural((d.pages || []).length, 'страница', 'страницы', 'страниц') : op === 'merge' ? ' ' + plural(files.length + 1, 'файла', 'файлов', 'файлов') : ''), status: 'running', startedAt: Date.now(), dur: JOBS[op][1], at: hm(), by: me(), params: { ...(params || {}) } };
    (d.jobs = d.jobs || []).unshift(j); d.jobs.length = Math.min(d.jobs.length, 8);
    if (op === 'ocr') d.ocr = { ...(d.ocr || {}), status: 'running', words: [] };
    return j;
  };
  const word = (d, id) => { const w = ((d.ocr && d.ocr.words) || []).find((x) => x.id === id); return !w ? '' : w.st === 'open' ? w.text : w.cur; };
  const finishJob = (d, j) => {
    const db = D(), op = j.op, files = j.params.files || [], baseT = d.title.replace(/ · скан$/, '');
    const done = (res, nd) => { j.status = 'done'; j.res = res; j.end = hm(); if (nd) j.resDoc = nd.id; };
    const spawn = (kind, t, o) => { const nd = blank(kind, t, d.folder, me()); Object.assign(nd, { links: clone(d.links || []), src: { doc: d.id, v: d.v, op }, sensitivity: d.sensitivity }, o || {}); return finishNew(nd, 'convert', 'Из «' + d.title + '» v' + d.v); };
    if (op === 'ocr') { d.ocr = { status: 'done', conf: 95, at: hm(), lang: 'русский и английский', words: [], demo: true }; d.textLayer = true; touch(d); return done('Текстовый слой добавлен'); }
    if (op === 'merge') {
      const bad = files.find(lockedFile);
      if (bad && !j.params.password) { j.status = 'failed'; j.error = '«' + bad + '» защищён паролем: введите пароль или уберите файл'; return; }
      files.forEach((f) => d.pages.push({ id: nid('pg-'), art: /\.(jpe?g|png|heic|webp)$/i.test(f) ? 'photo' : 'file', name: f, rot: 0 }));
      d.size = Math.round(((d.size || 1) + files.length * 0.4) * 10) / 10; touch(d); cut(d, { name: 'Объединено: ' + files.join(', '), source: 'merge' });
      return done('+' + plural(files.length, 'страница', 'страницы', 'страниц') + ' · v' + d.v);
    }
    if (op === 'compress') { const a = d.size || 1; d.size = Math.max(0.2, Math.round(a * 0.26 * 10) / 10); touch(d); cut(d, { name: 'Сжат', source: 'compress' }); return done(mb(a) + ' → ' + mb(d.size) + ' · v' + d.v); }
    if (op === 'pdfa') return done('Копия для архива рядом с исходником', spawn('pdf', baseT + ' · PDF/A', { pages: clone(d.pages), annots: clone(d.annots || []), size: Math.round((d.size || 1) * 0.8 * 10) / 10, pdfa: true, textLayer: true }));
    if (op === 'to_docx') {
      const inv = (d.pages || [])[0] && d.pages[0].art === 'inv1';
      const body = inv ? [B(nid('b-'), 'title', 'ТОВАРНАЯ НАКЛАДНАЯ № 318'), B(nid('b-'), 'meta', 'от 30 сентября 2026 г. | ООО «СтройМаркет»'), B(nid('b-'), 'p', 'Поставщик: ООО «СтройМаркет», Москва, ' + word(d, 'w1') + ' ул., 14. Покупатель: ООО «Альта Групп». Основание: заказ ЗК-27, объект «ЖК Речной, кв. 42».'),
        B(nid('b-'), 'table', '', { rows: [['Наименование', 'Ед.', 'Кол-во', 'Цена', 'Сумма']].concat(d.table.rows.map((r, i) => [i === 2 ? 'Фанера ' + word(d, 'w2') : r[0], r[1], String(r[2]).replace('.', ','), i === 3 ? word(d, 'w3') : r[3].toLocaleString('ru-RU'), r[4].toLocaleString('ru-RU')])) }), B(nid('b-'), 'p', 'Итого: 118 440,00 руб.')]
        : (d.pages[0] && d.pages[0].body) ? d.pages[0].body.map((b) => ({ ...b, id: nid('b-'), text: fillTokens(b.text, d.pages[0].fields) })) : [B(nid('b-'), 'title', baseT.toUpperCase()), B(nid('b-'), 'p', 'Текст из ' + plural(d.pages.length, 'страницы', 'страниц', 'страниц') + ' PDF. В прототипе содержимое загруженных файлов не извлекается.')];
      return done('Новый текстовый документ рядом с PDF', spawn('text', baseT + ' · текст', { body, fields: [] }));
    }
    if (op === 'to_xlsx') {
      const T = d.table, cells = {}; T.cols.forEach((c, i) => { cells[COLS[i] + 1] = S(c, i >= 2 ? HR : HD); });
      T.rows.forEach((r, i) => { const n = i + 2, price = i === 3 ? word(d, 'w3') : r[3], pn = /^\d+(?:[.,]\d+)?$/.test(String(price).replace(/\s/g, '')) ? parseFloat(String(price).replace(/\s/g, '').replace(',', '.')) : String(price);
        Object.assign(cells, { ['A' + n]: S(i === 2 ? 'Фанера ' + word(d, 'w2') : r[0]), ['B' + n]: S(r[1]), ['C' + n]: S(r[2]), ['D' + n]: S(pn, { fmt: 'n0' }), ['E' + n]: Fm('=C' + n + '*D' + n, { fmt: 'n0' }) }); });
      const tot = T.rows.length + 2; Object.assign(cells, { ['A' + tot]: S('Итого', { st: 'total' }), ['E' + tot]: Fm('=СУММ(E2:E' + (tot - 1) + ')', { st: 'total', fmt: 'n0' }) });
      return done('Новая таблица рядом со сканом', spawn('sheet', baseT + ' · позиции', { sheets: [{ id: nid('sh-'), name: 'Позиции', cols: 6, rows: 12, w: [220, 70, 80, 100, 110, 60], cells }] }));
    }
    if (op === 'to_pdf') {
      const sh = d.kind === 'sheet' ? (d.sheets || []).find((s) => !s.fin) : null;
      return done('PDF рядом с исходником', spawn('pdf', d.title + ' · PDF', { pages: [{ id: nid('pg-'), art: 'from', kind: d.kind, title: d.title, body: d.kind === 'text' ? clone(d.body) : null, grid: sh ? gridOf(sh) : null, fields: d.kind === 'text' ? fieldVals(db, d) : null, rot: 0 }], size: 0.3, textLayer: true }));
    }
  };
  const checkEntry = (e) => {
    const db = D(); if (!e || !['all', 'member', 'group', 'role', 'relation'].includes(e.who)) throw new ApiError('validation', 'Неверная запись в списке доступа');
    if (e.who === 'member' && !mem(db, e.ref)) throw new ApiError('validation', 'Сотрудник не найден');
    if (e.who === 'group' && !grp(db, e.ref)) throw new ApiError('validation', 'Группа не найдена');
    if (e.who === 'role' && !role(db, e.ref)) throw new ApiError('validation', 'Роль не найдена');
    if (e.who === 'relation' && !objOf(db, e.obj)) throw new ApiError('validation', 'Объект не найден');
    return { who: e.who, ...(e.ref ? { ref: e.ref } : {}), ...(e.unit ? { unit: e.unit } : {}), ...(e.obj ? { obj: e.obj } : {}) };
  };
  const shareEntry = (e) => { const x = checkEntry(e); if (!LV[e.level]) throw new ApiError('validation', 'Выберите уровень доступа'); return { ...x, level: e.level }; };

  return {
    docCreate: (spec) => cmd(() => {
      const db = D(), s = spec || {}, f = folderOf(db, s.folder);
      if (!f) throw new ApiError('validation', 'Выберите папку');
      if (docAccess(db, M, me(), f).L < 4) throw new ApiError('forbidden', 'Создавать документы в «' + f.name + '» может тот, кто правит эту папку');
      if (!DOC_KINDS[s.kind]) throw new ApiError('validation', 'Выберите вид документа');
      const t = title(s.title), tpl = s.template ? DOC_TEMPLATES.find((x) => x.id === s.template) : null;
      if (s.template && !tpl) throw new ApiError('validation', 'Шаблон не найден');
      const d = blank(s.kind, t, f.id, me());
      if (tpl) {
        if (tpl.link && !(s.link && s.link.id)) throw new ApiError('validation', 'Выберите ' + (tpl.link === 'trip' ? 'рейс' : 'объект') + ' для полей шаблона');
        Object.assign(d, { template: { id: tpl.id, name: tpl.name }, fields: clone(tpl.fields), body: tpl.body.map(([bt, text]) => B(nid('b-'), bt, text)), links: tpl.link ? [{ kind: tpl.link, id: s.link.id }] : [] });
      } else if (s.kind === 'text') d.body = [B(nid('b-'), 'title', t), B(nid('b-'), 'p', '')];
      if (s.kind === 'sheet') { const c = csvCells(s.csv); d.sheets = [{ id: nid('sh-'), name: 'Лист 1', cols: c.cols, rows: c.rows, w: [], cells: c.cells }]; }
      if (s.kind === 'pdf') {
        const files = (s.files || []).slice(0, 20); if (!files.length) throw new ApiError('validation', 'Добавьте файлы или фото');
        const img = (x) => /^image\//.test(x.type || '') || /\.(jpe?g|png|heic|webp)$/i.test(x.name || '');
        d.pages = files.map((x) => ({ id: nid('pg-'), art: img(x) ? 'img' : 'file', name: x.name, url: img(x) ? x.url || null : null, rot: 0 }));
        d.size = Math.max(0.1, Math.round(files.reduce((a, x) => a + (x.size || 300000), 0) / 1048576 * 10) / 10);
        d.scan = !!s.scan || files.every(img); d.textLayer = !d.scan;
        if (d.scan) d.ocr = { status: 'none', words: [] };
      }
      if (s.link && !tpl && s.link.id) d.links = [s.link];
      finishNew(d, tpl ? 'template' : s.kind === 'pdf' ? 'upload' : 'create', tpl ? 'Из шаблона «' + tpl.name + '»' : '');
      if (d.scan && s.ocr !== false) startJob(d, 'ocr', {});
      return { id: d.id };
    }, 380),

    docRename: (id, t) => cmd(() => { const d = doc(id); needEdit(d, 'переименовать'); const x = title(t); hist(d, 'Переименован: «' + d.title + '» → «' + x + '»'); d.title = x; d.upd = { at: stamp(), by: me() }; return { ok: true }; }, 220),

    docBlock: (id, spec) => cmd(() => {
      const d = doc(id); needEdit(d); if (d.kind !== 'text') throw new ApiError('validation', 'Это не текстовый документ');
      const s = spec || {}, i = d.body.findIndex((b) => b.id === s.block); if (i < 0) throw new ApiError('conflict', 'Абзац уже удалили. Обновите документ');
      const b = d.body[i], text = String(s.text == null ? '' : s.text).replace(/\r/g, '');
      if (text.length > 4000) throw new ApiError('validation', 'Абзац — не длиннее 4000 символов');
      if (b.t === 'table') { const rows = text.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((r) => r.some(Boolean)); if (rows.length) b.rows = rows; else d.body.splice(i, 1); touch(d); return { ok: true }; }
      const parts = text.split(/\n\s*\n/).map((x) => x.replace(/\n/g, ' ').trim()), type = ['p', 'h', 'li', 'title', 'meta'].includes(s.type) ? s.type : b.t;
      if (!parts.join('')) { if (d.body.length > 1) d.body.splice(i, 1); else b.text = ''; touch(d); return { removed: true }; }
      b.text = parts[0]; b.t = type;
      const add = parts.slice(1).filter(Boolean).map((x) => B(nid('b-'), type === 'title' || type === 'h' ? 'p' : type, x));
      d.body.splice(i + 1, 0, ...add); touch(d); return { added: add.map((x) => x.id) };
    }, 200),
    docBlockAdd: (id, spec) => cmd(() => { const d = doc(id); needEdit(d); const s = spec || {}, i = d.body.findIndex((b) => b.id === s.after), b = B(nid('b-'), ['p', 'h', 'li'].includes(s.type) ? s.type : 'p', ''); d.body.splice(i < 0 ? d.body.length : i + 1, 0, b); touch(d); return { id: b.id }; }, 150),

    docSuggest: (id, spec) => cmd(() => {
      const d = doc(id), r = need(d, 3, 'предлагать правки'); if (r.locked) throw new ApiError('validation', 'v' + d.route.v + ' на согласовании — предлагать правки можно после решения');
      const s = spec || {}, b = (d.body || []).find((x) => x.id === s.block); if (!b) throw new ApiError('conflict', 'Абзац уже удалили. Обновите документ');
      const from = String(s.from || ''), to = String(s.to || ''), pos = Math.max(0, Math.min(b.text.length, +s.pos || 0));
      if (from === to) throw new ApiError('validation', 'Правка ничего не меняет');
      if (from && b.text.substr(pos, from.length) !== from && !b.text.includes(from)) throw new ApiError('conflict', 'Текст абзаца уже изменили. Обновите документ');
      const sg = { id: nid('sg-'), block: b.id, from, to, pos, by: me(), at: stamp(), note: String(s.note || '').trim().slice(0, 500), status: 'open' };
      (d.suggestions = d.suggestions || []).push(sg);
      const eds = D().members.filter((m) => m.id !== me() && m.status === 'active' && docAccess(D(), M, m.id, d).L >= 4).map((m) => m.id);
      if (eds.length) event(meName() + ' предлагает правку в «' + d.title + '»', eds);
      return { id: sg.id };
    }, 250),
    docSuggestDecide: (id, sid, accept) => cmd(() => {
      const d = doc(id); needEdit(d, 'принимать правки');
      const sg = (d.suggestions || []).find((x) => x.id === sid && x.status === 'open'); if (!sg) throw new ApiError('not_found', 'Предложение уже решено');
      if (accept) {
        const b = d.body.find((x) => x.id === sg.block); if (!b) throw new ApiError('conflict', 'Абзац удалили — предложение не применить. Отклоните его');
        let pos = sg.pos; if (sg.from && b.text.substr(pos, sg.from.length) !== sg.from) pos = b.text.indexOf(sg.from);
        if (pos < 0) throw new ApiError('conflict', 'Текст абзаца уже изменили — предложение не применить. Отклоните его');
        b.text = b.text.slice(0, pos) + sg.to + b.text.slice(pos + sg.from.length); touch(d);
      }
      sg.status = accept ? 'accepted' : 'rejected'; sg.dec = { by: me(), at: stamp() };
      if (sg.by !== me()) event((accept ? 'Принята' : 'Отклонена') + ' ваша правка в «' + d.title + '»', [sg.by]);
      return { status: sg.status };
    }, 250),

    docComment: (id, spec) => cmd(() => {
      const d = doc(id); need(d, 2, 'комментировать');
      const s = spec || {}, text = String(s.text || '').trim(); if (!text) throw new ApiError('validation', 'Напишите комментарий'); if (text.length > 2000) throw new ApiError('validation', 'Комментарий — не длиннее 2000 символов');
      let mention = null; if (s.mention) { const m = mem(D(), s.mention); if (!m || m.status === 'blocked') throw new ApiError('validation', 'Сотрудник не найден или заблокирован'); mention = m.id; }
      const c = { id: nid('c-'), block: s.block || null, sheet: s.sheet || null, cell: s.cell || null, page: s.page || null, quote: String(s.quote || '').slice(0, 120), by: me(), at: stamp(), text: (mention && !text.includes('@' + nm(mention)) ? '@' + nm(mention) + ', ' : '') + text, mention, replies: [], resolved: false };
      (d.comments = d.comments || []).push(c);
      const noAcc = !!mention && docAccess(D(), M, mention, d).L < 2;
      if (mention && mention !== me()) event(meName() + ' упомянул(а) вас в «' + d.title + '»' + (noAcc ? ': откроется, когда вам дадут доступ' : ''), [mention]);
      return { id: c.id, noAccess: noAcc };
    }, 250),
    docReply: (id, cid, text) => cmd(() => {
      const d = doc(id); need(d, 2, 'отвечать'); const c = (d.comments || []).find((x) => x.id === cid); if (!c) throw new ApiError('not_found', 'Комментарий удалён');
      const t = String(text || '').trim(); if (!t) throw new ApiError('validation', 'Напишите ответ');
      c.replies.push({ by: me(), byId: me(), at: stamp(), text: t.slice(0, 2000) });
      if (c.by !== me()) event(meName() + ' ответил(а) на ваш комментарий в «' + d.title + '»', [c.by]);
      return { ok: true };
    }, 220),
    docResolve: (id, cid) => cmd(() => {
      const d = doc(id), r = need(d, 2, 'закрывать обсуждение'), c = (d.comments || []).find((x) => x.id === cid); if (!c) throw new ApiError('not_found', 'Комментарий удалён');
      if (c.by !== me() && r.L < 4) throw new ApiError('forbidden', 'Закрыть обсуждение может автор комментария или тот, кто правит');
      c.resolved = true; c.res = { by: me(), at: stamp() }; return { ok: true };
    }, 200),
    docMentionSkip: (id, cid) => cmd(() => { const d = doc(id); need(d, 2, 'менять комментарий'); const c = (d.comments || []).find((x) => x.id === cid); if (c) c.skip = true; return { ok: true }; }, 150),

    docShare: (id, spec) => cmd(() => {
      const db = D(), d = doc(id), r = R(d); if (!r.L) throw new ApiError('not_found', 'Документ не найден или недоступен');
      if (!r.share) throw new ApiError('forbidden', 'Делиться может владелец документа, тот, кто управляет доступом, или роль с правом «Документы · Настраивать»');
      const s = spec || {}, list = (s.share || []).map(shareEntry), mode = s.mode === 'listed' ? 'listed' : 'inherit';
      if (mode !== (d.mode || 'inherit') && !r.manage) throw new ApiError('forbidden', 'Сузить круг до «Только выбранные» или вернуть доступ папки может тот, кто управляет доступом');
      const old = new Map((d.share || []).map((e) => [entryKey(e), e]));
      list.forEach((e) => { const o = old.get(entryKey(e)); if (LV[e.level] > r.maxGrant && !(o && o.level === e.level)) throw new ApiError('forbidden', 'Нельзя выдать «' + DOC_LEVELS[LV[e.level]] + '»: это выше вашего уровня «' + DOC_LEVELS[r.L] + '»'); });
      (d.share || []).forEach((o) => { if (LV[o.level] <= r.maxGrant) return; const n = list.find((e) => entryKey(e) === entryKey(o)); if (!n || n.level !== o.level) throw new ApiError('forbidden', 'Запись «' + entryLabel(db, o) + '» выше вашего уровня — её меняет тот, кто управляет доступом'); });
      let ext = d.ext || null;
      if (s.ext !== undefined && JSON.stringify(s.ext || null) !== JSON.stringify(d.ext || null)) {
        if (!r.ext) throw new ApiError('forbidden', 'Внешние ссылки — отдельное право «Документы · Внешние ссылки». В прототипе оно есть только у владельца бизнеса');
        if (s.ext && s.ext.on) {
          if (!/^\d\d\.\d\d\.\d{4}$/.test(s.ext.until || '')) throw new ApiError('validation', 'Укажите срок ссылки в виде ДД.ММ.ГГГГ');
          if (dval(s.ext.until) < dval(DOC_TODAY)) throw new ApiError('validation', 'Срок ссылки уже прошёл');
          ext = { on: true, level: 'view', until: s.ext.until, pin: !!s.ext.pin, watermark: !!s.ext.watermark, noDownload: !!s.ext.noDownload, v: d.v, token: (d.ext && d.ext.token) || 'x' + db.seq++, opened: (d.ext && d.ext.opened) || [] };
        } else ext = d.ext ? { ...d.ext, on: false } : null;
      }
      const imp = docShareImpact(db, M, d, { mode, share: list });
      d.mode = mode; d.share = list; d.ext = ext;
      hist(d, 'Доступ: ' + (mode === 'listed' ? 'только выбранные' : 'как у папки') + (list.length ? ' · ' + list.map((e) => entryLabel(db, e) + ' — ' + DOC_LEVELS[LV[e.level]].toLowerCase()).join(', ') : '') + (ext && ext.on ? ' · внешняя ссылка до ' + ext.until : ''));
      const got = imp.gain.concat(imp.up).filter((x) => x.id !== me()).map((x) => x.id);
      if (got.length) event('Вам открыт доступ к «' + d.title + '»', got);
      return { gain: imp.gain.length, lose: imp.lose.length };
    }, 350),
    docGrant: (id, memberId, level) => cmd(() => {
      const db = D(), d = doc(id), r = R(d); if (!r.share) throw new ApiError('forbidden', 'Выдать доступ может владелец документа или тот, кто управляет доступом');
      const m = mem(db, memberId); if (!m || m.status === 'blocked') throw new ApiError('validation', 'Сотрудник не найден или заблокирован');
      const L = LV[level] || 2; if (L > r.maxGrant) throw new ApiError('forbidden', 'Нельзя выдать «' + DOC_LEVELS[L] + '»: это выше вашего уровня');
      const k = entryKey({ who: 'member', ref: memberId }); d.share = (d.share || []).filter((e) => entryKey(e) !== k).concat([{ who: 'member', ref: memberId, level: LV_KEY[L] }]);
      hist(d, m.name + ' получил(а) «' + DOC_LEVELS[L] + '» из упоминания'); event('Вам открыт доступ «' + DOC_LEVELS[L] + '» к «' + d.title + '»', [memberId]);
      return { ok: true };
    }, 250),
    docMove: (id, folderId) => cmd(() => {
      const db = D(), d = doc(id); needEdit(d, 'переносить'); const f = folderOf(db, folderId);
      if (!f) throw new ApiError('not_found', 'Папка не найдена'); if (f.id === d.folder) throw new ApiError('validation', 'Документ уже в этой папке');
      if (docAccess(db, M, me(), f).L < 4) throw new ApiError('forbidden', 'Нет права добавлять документы в «' + f.name + '»');
      const imp = docMoveImpact(db, M, d, f.id); d.folder = f.id; hist(d, 'Перенесён в «' + folderLabel(db, f.id) + '»');
      return { lose: imp.lose.length, gain: imp.gain.length };
    }, 300),

    docCell: (id, spec) => cmd(() => {
      const db = D(), d = doc(id); needEdit(d);
      const s = spec || {}, sh = (d.sheets || []).find((x) => x.id === s.sheet); if (!sh) throw new ApiError('not_found', 'Лист не найден');
      if (sh.fin && !finSees(db, M, me(), d, sh)) throw new ApiError('forbidden', 'Лист скрыт: нужны права на финансы');
      const k = String(s.key || '').toUpperCase(), p = parseKey(k); if (!p) throw new ApiError('validation', 'Неверная ячейка');
      const pr = (d.prot || []).find((x) => x.sheet === sh.id && inRange(k, x.range));
      if (pr && !protEdit(db, M, me(), pr)) throw new ApiError('forbidden', 'Диапазон «' + pr.name + '» (' + pr.range + ') правят: ' + pr.who.map((e) => entryLabel(db, e)).join(', ') + ' и владелец бизнеса');
      if (d.crm && d.crm.sheet === sh.id && d.crm.cols.includes(COLS[p.c]) && p.r >= d.crm.r1 && p.r <= d.crm.r2) throw new ApiError('validation', 'Столбец ' + COLS[p.c] + ' приходит из наборов «' + d.crm.sets + '»: значения меняет только обновление из CRM');
      const old = sh.cells[k] || {}, { v: _v, f: _f, ...rest } = old;
      if (s.fmt !== undefined) { sh.cells[k] = { ...old, fmt: s.fmt || undefined }; touch(d); return { ok: true }; }
      const raw = String(s.raw == null ? '' : s.raw).trim();
      if (!raw) { if (Object.keys(rest).length) sh.cells[k] = rest; else delete sh.cells[k]; }
      else if (raw.startsWith('=')) { const e = checkFormula(raw); if (e) throw new ApiError('validation', 'Ошибка в формуле: ' + e); sh.cells[k] = { ...rest, f: raw }; }
      else if (/^-?\d+(?:[.,]\d+)?$/.test(raw.replace(/\s/g, ''))) sh.cells[k] = { ...rest, v: parseFloat(raw.replace(/\s/g, '').replace(',', '.')) };
      else sh.cells[k] = { ...rest, v: raw.slice(0, 500) };
      if (p.r > sh.rows) sh.rows = p.r + 2; if (p.c >= sh.cols) sh.cols = p.c + 1;
      touch(d); return { ok: true };
    }, 160),
    docAddSheet: (id, name) => cmd(() => { const d = doc(id); needEdit(d); const n = String(name || '').trim() || 'Лист ' + ((d.sheets || []).length + 1); if (n.length > 31) throw new ApiError('validation', 'Название листа — не длиннее 31 символа'); if ((d.sheets || []).some((x) => x.name.toLowerCase() === n.toLowerCase())) throw new ApiError('validation', 'Лист «' + n + '» уже есть'); const sh = { id: nid('sh-'), name: n, cols: 8, rows: 20, w: [], cells: {} }; d.sheets.push(sh); touch(d); return { id: sh.id }; }, 200),
    docCrmSync: (id) => cmd(() => { const d = doc(id); need(d, 4, 'обновлять данные'); if (!d.crm) throw new ApiError('validation', 'В таблице нет данных из CRM'); d.crm.at = hm(); return { changed: 0 }; }, 600),

    docCut: (id, spec) => cmd(() => {
      const d = doc(id), s = spec || {}; need(d, 4, 'сохранять версии');
      if (!d.dirty) { if (s.name) { const last = d.versions[d.versions.length - 1]; last.name = String(s.name).trim().slice(0, 60); return { v: last.v, named: true }; } return { v: d.v, same: true }; }
      return { v: cut(d, { name: String(s.name || '').trim().slice(0, 60), source: s.source || 'edit' }) };
    }, 250),
    docRestore: (id, v) => cmd(() => {
      const d = doc(id); needEdit(d, 'восстанавливать версии'); const x = d.versions.find((y) => y.v === v);
      if (!x) throw new ApiError('not_found', 'Версия не найдена'); if (!x.body && !x.sheets && !x.pages) throw new ApiError('validation', 'У v' + v + ' нет копии содержимого');
      if (x.body) d.body = clone(x.body); if (x.sheets) d.sheets = clone(x.sheets); if (x.pages) { d.pages = clone(x.pages); d.annots = clone(x.annots || []); }
      d.authors = [me()]; d.dirty = true; const nv = cut(d, { name: 'Восстановлена v' + v, source: 'restore' }); hist(d, 'Восстановлена v' + v + ' как v' + nv);
      return { v: nv };
    }, 300),

    docRouteStart: (id, spec) => cmd(() => {
      const db = D(), d = doc(id); need(d, 4, 'отправлять на согласование');
      if (d.pdfa) throw new ApiError('validation', 'PDF/A-копию не отправляют на согласование');
      if (d.route && ['active', 'returned'].includes(d.route.status)) throw new ApiError('validation', 'Документ уже на маршруте');
      const s = spec || {}, steps = (s.steps || []).slice(0, 6), ru = s.rules || {};
      if (!steps.length) throw new ApiError('validation', 'Добавьте хотя бы один шаг');
      const rules = { lock: ru.lock !== false, notAuthor: ru.notAuthor !== false, commentOnBack: ru.commentOnBack !== false, escalate: !!ru.escalate };
      const lk = (d.links || []).find((x) => x.kind === 'object'), o = lk && objOf(db, lk.id);
      const out = steps.map((st, i) => {
        if (!STEP_KINDS[st.kind]) throw new ApiError('validation', 'Неизвестный шаг');
        const days = Math.max(1, Math.min(10, +st.days || 1)), name = STEP_KINDS[st.kind][0], n = 'Шаг ' + (i + 1) + ' «' + name + '»: ';
        if (st.kind === 'approve') {
          const who = [...new Set(st.who || [])]; if (!who.length) throw new ApiError('validation', n + 'добавьте согласующих');
          who.forEach((x) => { const m = mem(db, x); if (!m) throw new ApiError('validation', n + 'сотрудник не найден'); if (m.status === 'blocked') throw new ApiError('validation', n + m.name + ' заблокирован'); if (rules.notAuthor && x === me()) throw new ApiError('validation', n + 'автор не согласует свой документ. Уберите себя или выключите правило'); });
          return { kind: 'approve', name, mode: APPROVE_MODES[st.mode] ? st.mode : 'all', who, days, decisions: [], status: 'wait' };
        }
        if (st.kind === 'sign') {
          const x = (st.who || [])[0], m = mem(db, x); if (!m) throw new ApiError('validation', n + 'выберите, кто утверждает');
          if (!docRights(db, M, x, d).sign) throw new ApiError('validation', n + m.name + ' не может утверждать: нет права «Документы · Утверждать» в области документа');
          if (rules.notAuthor && x === me()) throw new ApiError('validation', n + 'автор не утверждает свой документ. Выберите другого утверждающего или выключите правило');
          return { kind: 'sign', name, who: [x], days, decisions: [], status: 'wait' };
        }
        if (st.kind === 'ack') { const aud = (st.audience || []).map(checkEntry); if (!aud.length) throw new ApiError('validation', n + 'добавьте роль, группу или сотрудников'); return { kind: 'ack', name, audience: aud, people: [], done: [], days, status: 'wait' }; }
        const nm2 = String((st.ext && st.ext.name) || (o && o.client) || '').trim(); if (!nm2) throw new ApiError('validation', n + 'укажите заказчика');
        return { kind: 'ext', name, ext: { name: nm2, phone: (st.ext && st.ext.phone) || '+7 9•• •••-••-42' }, who: [], days, decisions: [], status: 'wait' };
      });
      const p = (db.projects || []).find((x) => x.id === s.project && x.wf); if (!p) throw new ApiError('validation', 'Выберите проект задач с процессом');
      if (!M.projCan(db, p, me(), 'create').ok) throw new ApiError('forbidden', 'Нет права создавать задачи в проекте «' + p.name + '»');
      if (d.dirty) cut(d, { name: 'На согласование', source: 'edit' }); else { const last = d.versions[d.versions.length - 1]; if (last && !last.name) last.name = 'На согласование'; }
      if (d.route) (d.routeLog = d.routeLog || []).unshift(d.route);
      d.route = { id: nid('rt-'), v: d.v, by: me(), at: stamp(), status: 'active', cur: 0, steps: out, rules, project: p.id, task: null };
      d.status = 'draft'; d.frozen = null;
      const first = p.wf.statuses.find((x) => x.name === 'На проверке') || p.wf.statuses.find((x) => x.cat === 'progress') || p.wf.statuses[0];
      const t = { id: p.key + '-' + (100 + db.seq++), title: 'Согласовать: ' + d.title, description: 'Маршрут документа «' + d.title + '» v' + d.v + ': ' + out.map((x) => x.name).join(' → ') + '. Решения принимаются в «Документах», статус задачи меняет маршрут.', labels: ['документ'], assignee: meName(), author: meName(), authorId: me(), status: first.name, priority: 'high', due: '—', project: p.id, checklist: [], comments: [{ by: meName(), at: hm(), text: 'Маршрут запущен: v' + d.v, system: true }], links: [], files: [] };
      (db.tasks = db.tasks || []).unshift(t); d.route.task = t.id;
      if (s.saveTpl) { const f = folderOf(db, d.folder); if (f) f.routeTpl = { name: 'Шаблон папки «' + f.name + '»', project: p.id, steps: steps.map((x) => clone(x)), rules }; }
      hist(d, 'Отправлен на согласование: v' + d.v + ' · ' + out.map((x) => x.name).join(' → ') + ' · задача ' + t.id);
      activate(d, 0);
      return { task: t.id, v: d.v };
    }, 420),
    docRouteDecide: (id, spec) => cmd(() => {
      const d = doc(id), r = d.route; if (!r || r.status !== 'active') throw new ApiError('validation', 'Документ не на маршруте');
      const s = spec || {}, st = r.steps[r.cur], wait = stepWaiting(st);
      let who = me(), demo = false;
      if (s.as && s.as !== me()) { if (!wait.includes(s.as)) throw new ApiError('validation', 'Решение этого участника сейчас не ждут'); who = s.as; demo = true; }
      else if (!wait.includes(who)) throw new ApiError('forbidden', wait.length ? 'Сейчас решение ждут: ' + wait.map((x) => (x === 'ext' ? st.ext.name : nm(x))).join(', ') : 'Сейчас ваше решение не нужно');
      if (st.kind === 'ack') throw new ApiError('validation', 'Ознакомление подтверждает сам сотрудник');
      if (st.kind === 'sign' && s.decision === 'ok' && !demo) throw new ApiError('validation', 'Утверждение — подписью по коду из SMS');
      const comment = String(s.comment || '').trim().slice(0, 1000), whoName = who === 'ext' ? st.ext.name : nm(who);
      if (s.decision === 'back') {
        if (r.rules.commentOnBack && !comment) throw new ApiError('validation', 'Напишите, что доработать');
        st.decisions.push({ member: who, decision: 'back', at: stamp(), comment, demo });
        r.status = 'returned'; r.back = { step: r.cur, by: who, name: whoName, comment, at: stamp() };
        d.tmp = (d.tmp || []).filter((t) => !(t.route === r.id && !t.keep));
        hist(d, whoName + ' вернул(а) на доработку: ' + (comment || 'без комментария')); taskNote(d, whoName + ': вернул(а) на доработку v' + r.v + (comment ? ' — ' + comment : '') + (demo ? ' (демо)' : ''));
        event('«' + d.title + '» вернули на доработку: ' + (comment || 'без комментария'), [r.by]); syncTask(d);
        return { status: 'returned' };
      }
      st.decisions.push({ member: who, decision: 'ok', at: stamp(), comment, method: st.kind === 'ext' ? 'sms_link' : st.kind === 'sign' ? 'pep_sms' : 'click', demo });
      taskNote(d, whoName + ': ' + (st.kind === 'ext' ? 'подписал(а) по коду из SMS' : st.kind === 'sign' ? 'утвердил(а)' : 'согласовал(а)') + ' v' + r.v + (comment ? ' — ' + comment : '') + (demo ? ' (демо)' : ''));
      if (!stepWaiting(st).length) advance(d);
      else { const w2 = stepWaiting(st); if (st.mode === 'seq') event('Согласуйте «' + d.title + '» v' + r.v, w2.slice(0, 1)); syncTask(d); }
      return { status: r.status };
    }, 300),
    docSignStart: (id) => cmd(() => {
      const d = doc(id), r = d.route; if (!r || r.status !== 'active') throw new ApiError('validation', 'Документ не на маршруте');
      const st = r.steps[r.cur]; if (st.kind !== 'sign' || !stepWaiting(st).includes(me())) throw new ApiError('forbidden', 'Сейчас ваша подпись не нужна');
      const code = String(1000 + ((D().seq++ * 7919) % 9000)); r.sms = { code, member: me(), tries: 0, at: hm() };
      return { code, phone: '+7 9•• •••-••-' + p2((D().seq * 37) % 100) };
    }, 400),
    docSign: (id, code) => cmd(() => {
      const d = doc(id), r = d.route; if (!r || r.status !== 'active') throw new ApiError('validation', 'Документ не на маршруте');
      if (!r.sms || r.sms.member !== me()) throw new ApiError('validation', 'Сначала запросите код');
      if (r.sms.tries >= 3) throw new ApiError('validation', 'Попытки закончились — запросите новый код');
      if (String(code || '').trim() !== r.sms.code) { r.sms.tries++; throw new ApiError('validation', 'Код не подходит. Осталось попыток: ' + (3 - r.sms.tries)); }
      const st = r.steps[r.cur]; st.decisions.push({ member: me(), decision: 'ok', at: stamp(), method: 'pep_sms' }); r.sms = null;
      taskNote(d, meName() + ': утвердил(а) v' + r.v + ' · ПЭП, код из SMS'); hist(d, 'Утверждён: ' + meName() + ' · ПЭП');
      advance(d); return { pdfa: d.pdfaId || null };
    }, 420),
    docAck: (id, spec) => cmd(() => {
      const d = doc(id), r = d.route; if (!r || r.status !== 'active' || r.steps[r.cur].kind !== 'ack') throw new ApiError('validation', 'Ознакомление не запрошено');
      const st = r.steps[r.cur]; if (!st.people.includes(me())) throw new ApiError('validation', 'Ознакомление запрошено у других сотрудников');
      if (!st.done.some((x) => x.member === me())) { st.done.push({ member: me(), at: stamp(), v: r.v, device: (spec && spec.device) || 'компьютер' }); taskNote(d, meName() + ': ознакомлен(а) с v' + r.v); }
      if (!stepWaiting(st).length) advance(d); else syncTask(d);
      return { done: st.done.length, of: st.people.length };
    }, 300),
    docAckClose: (id) => cmd(() => {
      const d = doc(id), r = d.route; if (!r || r.status !== 'active' || r.steps[r.cur].kind !== 'ack') throw new ApiError('validation', 'Ознакомление не идёт');
      if (r.by !== me() && !isOwner(D(), M, me())) throw new ApiError('forbidden', 'Завершить ознакомление может автор маршрута или владелец бизнеса');
      const st = r.steps[r.cur]; st.closed = { at: stamp(), by: me(), left: stepWaiting(st) }; hist(d, 'Ознакомление завершено: ' + st.done.length + ' из ' + st.people.length); advance(d); return { ok: true };
    }, 300),
    docRouteResume: (id) => cmd(() => {
      const d = doc(id); need(d, 4, 'отправлять снова'); const r = d.route;
      if (!r || r.status !== 'returned') throw new ApiError('validation', 'Документ не на доработке');
      if (r.by !== me() && !isOwner(D(), M, me())) throw new ApiError('forbidden', 'Отправить снова может автор маршрута');
      if (!d.dirty && d.v === r.v) throw new ApiError('validation', 'Сначала внесите правки: согласуют новую версию');
      if (d.dirty) cut(d, { name: 'После доработки', source: 'edit' });
      const i = r.back.step; r.v = d.v; r.status = 'active'; r.steps[i].decisions = []; r.steps[i].status = 'wait'; r.back = { ...r.back, resolved: true };
      hist(d, 'Снова на согласовании: v' + d.v + ' с шага «' + r.steps[i].name + '»'); taskNote(d, 'После доработки: v' + d.v + ', маршрут продолжен с шага «' + r.steps[i].name + '»');
      activate(d, i); return { v: d.v };
    }, 350),
    docRouteCancel: (id) => cmd(() => {
      const d = doc(id), r = d.route; if (!r || !['active', 'returned'].includes(r.status)) throw new ApiError('validation', 'Маршрут уже завершён');
      if (r.by !== me() && !isOwner(D(), M, me())) throw new ApiError('forbidden', 'Отменить маршрут может автор или владелец бизнеса');
      r.status = 'cancelled'; r.end = stamp(); d.tmp = (d.tmp || []).filter((t) => !(t.route === r.id && !t.keep));
      hist(d, 'Маршрут отменён'); taskNote(d, meName() + ': маршрут отменён'); syncTask(d); return { ok: true };
    }, 300),

    docOcrWord: (id, wid, spec) => cmd(() => {
      const d = doc(id); needEdit(d, 'проверять распознавание'); const w = ((d.ocr && d.ocr.words) || []).find((x) => x.id === wid); if (!w) throw new ApiError('not_found', 'Слово не найдено');
      const a = spec && spec.action;
      if (a === 'accept') { w.st = 'accepted'; w.cur = w.sug; }
      else if (a === 'fix') { const v = String((spec && spec.value) || '').trim(); if (!v) throw new ApiError('validation', 'Введите правильное значение'); w.st = 'fixed'; w.cur = v.slice(0, 80); }
      else if (a === 'keep') { w.st = 'kept'; w.cur = w.text; }
      else throw new ApiError('validation', 'Неизвестное действие');
      w.by = me(); touch(d); const left = d.ocr.words.filter((x) => x.st === 'open').length;
      if (!left) hist(d, 'Распознавание проверено: ' + plural(d.ocr.words.length, 'слово', 'слова', 'слов'));
      return { left };
    }, 200),
    docPages: (id, spec) => cmd(() => {
      const d = doc(id); needEdit(d, 'менять страницы'); const s = spec || {}, i = (d.pages || []).findIndex((p) => p.id === s.page); if (i < 0) throw new ApiError('not_found', 'Страница не найдена');
      if (s.op === 'rotate') d.pages[i].rot = ((d.pages[i].rot || 0) + 90) % 360;
      else if (s.op === 'delete') { if (d.pages.length === 1) throw new ApiError('validation', 'Нельзя удалить единственную страницу'); d.pages.splice(i, 1); d.annots = (d.annots || []).filter((a) => a.page !== s.page); }
      else if (s.op === 'move') { const j = i + (s.dir < 0 ? -1 : 1); if (j < 0 || j >= d.pages.length) throw new ApiError('validation', 'Дальше двигать некуда'); const x = d.pages[i]; d.pages[i] = d.pages[j]; d.pages[j] = x; }
      else throw new ApiError('validation', 'Неизвестное действие');
      touch(d); return { n: d.pages.length };
    }, 200),
    docStamp: (id, pageId) => cmd(() => {
      const d = doc(id); needEdit(d, 'ставить штамп'); if (!(d.pages || []).some((p) => p.id === pageId)) throw new ApiError('not_found', 'Страница не найдена');
      if ((d.annots || []).some((a) => a.page === pageId && a.kind === 'stamp' && a.byId === me())) throw new ApiError('validation', 'Ваш штамп на этой странице уже стоит');
      (d.annots = d.annots || []).push({ id: nid('an-'), page: pageId, kind: 'stamp', text: 'ПОЛУЧЕНО', by: shortName(meName()), byId: me(), at: DOC_TODAY.slice(0, 5) + ' · ' + hm(), pep: false });
      touch(d); return { ok: true };
    }, 220),
    docJob: (id, op, params) => cmd(() => {
      const d = doc(id), r = need(d, 4, 'преобразовывать'); if (!JOBS[op]) throw new ApiError('validation', 'Неизвестная операция');
      if (d.kind !== 'pdf' && op !== 'to_pdf') throw new ApiError('validation', 'Операция доступна для PDF');
      if (d.kind === 'pdf' && op === 'to_pdf') throw new ApiError('validation', 'Это уже PDF');
      if (['merge', 'compress'].includes(op) && r.locked) throw new ApiError('validation', d.pdfa ? 'PDF/A-копия не меняется' : 'Документ на согласовании — страницы не меняются до решения');
      if (op === 'ocr' && !d.scan) throw new ApiError('validation', 'У документа уже есть текстовый слой');
      if (op === 'ocr' && d.ocr && d.ocr.status === 'done') throw new ApiError('validation', 'Скан уже распознан');
      if (['to_docx', 'to_xlsx'].includes(op) && !d.textLayer) throw new ApiError('validation', 'Сначала распознайте скан: у страниц нет текстового слоя');
      if (op === 'to_xlsx' && !d.table) throw new ApiError('validation', 'В документе не найдено таблиц');
      if ((d.jobs || []).some((j) => j.status === 'running' && j.op === op)) throw new ApiError('validation', 'Такое задание уже выполняется');
      if (op === 'merge' && !(params && params.files && params.files.length)) throw new ApiError('validation', 'Добавьте файлы');
      const j = startJob(d, op, params); return { id: j.id };
    }, 250),
    docJobPoll: (id, jid) => cmd(() => {
      const d = doc(id), j = (d.jobs || []).find((x) => x.id === jid); if (!j) throw new ApiError('not_found', 'Задание не найдено');
      if (j.status !== 'running') return { status: j.status, res: j.resDoc || null };
      if (Date.now() - j.startedAt < j.dur) return { status: 'running' };
      finishJob(d, j); return { status: j.status, res: j.resDoc || null };
    }, 0),
    docJobRetry: (id, jid, spec) => cmd(() => {
      const d = doc(id); need(d, 4, 'повторять задания'); const j = (d.jobs || []).find((x) => x.id === jid);
      if (!j || j.status !== 'failed') throw new ApiError('validation', 'Задание не завершилось ошибкой');
      const s = spec || {};
      if (j.op === 'merge') { if (s.drop) j.params.files = (j.params.files || []).filter((f) => !lockedFile(f)); else if (!String(s.password || '').trim()) throw new ApiError('validation', 'Введите пароль файла или уберите его'); else j.params.password = true; }
      if (j.op === 'merge') j.name = 'Объединение ' + plural((j.params.files || []).length + 1, 'файла', 'файлов', 'файлов');
      Object.assign(j, { status: 'running', error: null, startedAt: Date.now(), dur: JOBS[j.op][1], at: hm() }); return { ok: true };
    }, 250),
  };
}
