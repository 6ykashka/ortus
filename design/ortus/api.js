// Сервисный слой. UI работает только с интерфейсом адаптера, а не с хранилищем.
// createMockAdapter — локальный «сервер» для прототипа (имитирует задержку, 409, офлайн, права).
// createHttpAdapter — заготовка для Go API по ortus-openapi-v0.1.yaml; пути с пометкой PROPOSED отсутствуют в контракте.
import { seed, seedLotos, BRAND_DEFAULT } from './mock-data.js';
import { installService, serviceView, serviceApi } from './service.js';
import { installKnowledge, kbView, knowledgeApi } from './knowledge.js';
import { installDocs, docsView, docsApi } from './documents.js';
import { installChats, chatsView, chatsApi } from './chats.js';
import { installCash, cashView, cashApi } from './cash.js';
import * as M from './models.js';

export class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const hhmm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function createMockAdapter() {
  let db = seed();
  // Проекты задач: процесс, доступ, автоматизация. «Заявки» остаются на воронке (docs/19).
  const normProjects = (d) => (d.projects || []).forEach((p) => {
    if (p.flow === 'leads') return;
    p.access = p.access || 'limited'; p.automations = p.automations || []; p.runs = p.runs || [];
    if (!p.wf) p.wf = M.buildWf(p.id === 'fleet' ? 'approval' : 'simple');
    if (p.id === 'fleet' && !d.tasks.some((t) => t.id === 'T-65')) {
      d.tasks.unshift({ id: 'T-65', title: 'Заменить шины на ГАЗон Next (зимние)', description: 'Комплект зимних шин 215/75 R17.5, 6 шт., с шиномонтажом.\nСезонная замена до 15.10. Счёт поставщика во вложении.', labels: ['шины', 'закупка'], files: [{ id: 'f-1', name: 'Счёт № 418 от 07.10.pdf', size: 184320, type: 'application/pdf', url: null, by: 'Илья Васильев', byId: 'm-vasiliev', at: '10:41' }], assignee: 'Илья Васильев', author: 'Илья Васильев', authorId: 'm-vasiliev', status: 'На проверке', priority: 'high', due: '10.10', project: 'fleet', checklist: [{ t: 'Счёт приложен', d: true }, { t: 'Сезонность подтверждена', d: true }], comments: [{ by: 'Илья Васильев', at: '10:42', text: 'Сумма 48 600 ₽, счёт во вложении. Прошу согласовать.' }], links: [] });
      d.tasks.unshift({ id: 'T-66', title: 'Подготовить парк к зиме', description: 'Шины, антифриз и проверка аккумуляторов по всем машинам фирмы «Север» до 15.10.', labels: ['зима'], files: [], assignee: 'Марина Котова', author: 'Марина Котова', authorId: 'm-kotova', status: 'В работе', priority: 'high', due: '15.10', project: 'fleet', checklist: [], comments: [{ by: 'Марина Котова', at: '09:30', text: 'Собрала в одну задачу всё, что нужно сделать до холодов' }], links: [] });
      ['T-65', 'T-58'].forEach((id) => { const x = d.tasks.find((y) => y.id === id); if (x) { x.parent = 'T-66'; x.comments = x.comments || []; } });
      p.automations = [
        { id: 'ar-1', name: 'Срочная задача → назначить руководителю проекта', trigger: 'created', to: null, cond: { priority: 'urgent' }, action: { kind: 'assign', value: 'Марина Котова' }, on: true, version: 1, by: 'Марина Котова', byId: 'm-kotova' },
        { id: 'ar-2', name: 'Задача готова → напомнить про путевой лист', trigger: 'status', to: 's4', cond: null, action: { kind: 'comment', value: 'Проверьте, что путевой лист сдан в бухгалтерию' }, on: false, version: 1, by: 'Дарья Зимина', byId: 'm-owner' }];
      p.runs = [{ at: '09:12', rule: 'ar-1', name: 'Срочная задача → назначить руководителю проекта', rv: 1, res: 'ok', text: 'T-64 назначена: Марина Котова', task: 'T-64' }, { at: '08:40', rule: 'ar-1', name: 'Срочная задача → назначить руководителю проекта', rv: 1, res: 'stopped', text: 'T-63: приоритет «Обычный» — условие не выполнено', task: 'T-63' }];
    }
  });
  normProjects(db);
  installService(db);
  installKnowledge(db);
  installDocs(db, M);
  installChats(db, M);
  installCash(db, M);
  // Каждая организация — своя «БД»; platform — один общий объект (control DB).
  const dbs = { [db.tenantId]: db };
  { const l = seedLotos(db.platform); l.platform = db.platform; installKnowledge(l); installDocs(l, M); installChats(l, M); installCash(l, M); dbs[l.tenantId] = l; }
  const flags = { online: true, conflictNext: false, failUploadNext: false };
  const ops = new Set();
  let actor = 'm-owner';

  const tenant = (id) => db.platform.tenants.find((t) => t.id === (id || db.tenantId));
  const trip = (id) => { const t = db.trips.find((x) => x.id === id); if (!t) throw new ApiError('not_found', 'Рейс не найден'); return t; };
  const veh = (id) => { const v = db.vehicles.find((x) => x.id === id); if (!v) throw new ApiError('not_found', 'Машина не найдена'); return v; };
  const event = (text, to, sensitive) => db.events.unshift({ id: 'e' + db.seq++, at: hhmm(), text, to, sensitive: sensitive || null });
  const reviewers = (unitId) => db.members.filter((m) => M.can(db, m.id, 'logistics', 'review', unitId).ok).map((m) => m.id);
  const owners = () => db.members.filter((m) => M.grants(db, m.id).some((g) => g.roleObj.all)).map((m) => m.id);
  // Места: занимает каждый участник со входом (активен или приглашён). Заблокированные и карточки без входа — бесплатно.
  const seatsUsed = () => db.members.filter((m) => m.status === 'active' || m.status === 'invited').length;
  const syncSeats = () => { const t = tenant(); t.seatsUsed = seatsUsed(); t.members = db.members.length; };
  const tierOf = (id, v) => { const pb = db.platform.priceBook; const ver = pb.versions.find((x) => x.v === (v || pb.current)); return ver.tiers.find((x) => x.id === id); };
  const account = (email) => db.platform.accounts.find((a) => a.email.toLowerCase() === String(email).trim().toLowerCase());
  const PAID_UNTIL = { 1: '31.10.2026', 4: '31.01.2027', 8: '31.05.2027', 12: '30.09.2027' };
  const actorName = () => (db.members.find((m) => m.id === actor) || {}).name || 'Владелец';

  // Ответ формы «Осмотр машины» + автоматизация «→ задача менеджеру». Повтор не создаёт дубль.
  const recordInspection = (t, kind, p) => {
    const f = db.forms.find((x) => x.id === 'fm-insp'); if (!f || !f.published) return;
    const key = t.id + ':' + kind + ':' + (t.review && kind === 'ret' ? 'rev2' : 'rev1');
    if (db.responses.some((r) => r.key === key)) return;
    const fuel = (M.FUEL.find((x) => x[0] === p.fuel) || [0, '—'])[1];
    const d = (p.defects || [])[0];
    const values = { 'q-photos': '5 фото', 'q-odo': M.int(p.odometer), 'q-fuel': fuel, 'q-fuel-t': fuel, 'q-checks': 'все пункты', 'q-defect': d ? 'да' : 'нет', 'q-defect-text': d ? d.zone + ': ' + d.text : '', 'q-critical': d && d.critical ? 'да' : 'нет', 'q-volume': '', 'q-crew': '', 'q-photo': '' };
    const id = 'R-' + (1040 + db.seq++);
    db.responses.unshift({ id, key, formId: f.id, version: f.published, at: hhmm(), author: t.driverName, object: 'Рейс ' + t.id + (kind === 'dep' ? ' · выезд' : ' · сдача'), status: 'Принят', values });
    (f.automations || []).filter((x) => x.kind === 'kb' && kbFits(x, db.responses[0])).forEach((x) => kbRun(f, db.responses[0], x));
    const rule = f.automations.find((x) => x.on && (!x.kind || x.kind === 'task'));
    if (rule) db.tasks.unshift({ id: 'T-' + (60 + db.seq++), title: 'Проверить осмотр ' + t.id + (kind === 'dep' ? ' (выезд)' : ' (сдача)'), assignee: 'Марина Котова', status: 'Новая', source: id, rule: rule.id + ' · v' + rule.version, priority: d && d.critical ? 'urgent' : 'normal', due: '01.10', project: 'fleet', checklist: [{ t: 'Сверить фото с прошлым осмотром', d: false }, { t: 'Проверить пробег', d: false }], comments: [], links: [{ kind: 'response', id, label: 'Ответ ' + id }, { kind: 'trip', id: t.id, label: 'Рейс ' + t.id }] });
  };

  // Действие формы «Сохранить в Базу знаний»: строка в таблицу или запись на страницу. Один результат на ответ и правило.
  const kbFits = (x, r) => {
    if (!x.on) return false;
    if ((x.when || 'accepted') === 'accepted' && r.status !== 'Принят') return false;
    if (x.cond && x.cond.field) { const v = (r.values || {})[x.cond.field], want = String(x.cond.value == null ? '' : x.cond.value).toLowerCase(); const has = Array.isArray(v) ? v.some((y) => String(y).toLowerCase() === want) : String(v == null ? '' : v).toLowerCase() === want; if (!has) return false; }
    return true;
  };
  const kbRun = (f, r, x) => {
    const done = (r.actions || []).find((y) => y.rule === x.id && y.ok); if (done) return done;
    const K = db.knowledge, page = K.pages.find((p) => p.id === x.page), fields = (f.versions.find((v) => v.v === r.version) || {}).fields || [];
    const by = db.members.find((mm) => mm.id === x.byId) || db.members.find((mm) => mm.name === x.by);
    const base = { rule: x.id, rv: x.version || 1, kind: 'kb', at: hhmm(), page: x.page }, src = { form: f.id, resp: r.id, fv: r.version, rule: x.id, rv: x.version || 1 };
    let res;
    if (!page) res = { ...base, ok: false, err: 'страница удалена из Базы знаний' };
    else if (!by || by.status !== 'active' || !M.can(db, by.id, 'knowledge', 'create').ok) res = { ...base, ok: false, err: 'у автора правила' + (by ? ' ' + by.name : '') + ' нет права «Создавать» в Базе знаний' };
    else if (page.access === 'owner' && !M.grants(db, by.id).some((g) => g.roleObj.all)) res = { ...base, ok: false, err: 'страница «' + page.title + '» доступна только владельцу' };
    else if (x.mode === 'entry') {
      K.entries = K.entries || [];
      if (!K.entries.some((e) => e.src.resp === r.id && e.src.rule === x.id)) {
        const lines = (x.fields || []).filter((q) => q.src).map((q) => ({ name: q.name, value: M.formVal(f, r, q.src, fields) })).filter((q) => q.value !== '');
        const e = { id: 'ke-' + db.seq++, page: page.id, at: hhmm(), head: M.formVal(f, r, x.head || '$object', fields) || r.id, lines, src };
        if (x.pos === 'bottom') K.entries.push(e); else K.entries.unshift(e);
      }
      res = { ...base, ok: true, text: 'Запись на странице «' + page.title + '»' };
    } else {
      const t = (K.tables || []).find((y) => y.id === x.table && y.page === page.id);
      if (!t) res = { ...base, ok: false, err: 'таблица удалена со страницы «' + page.title + '»' };
      else {
        if (!t.rows.some((y) => y.src && y.src.resp === r.id && y.src.rule === x.id)) {
          const cells = {}; (x.fields || []).forEach((q) => { if (q.src && t.columns.some((c) => c.id === q.col)) cells[q.col] = M.formVal(f, r, q.src, fields); });
          const row = { id: 'kr-' + db.seq++, at: hhmm(), src, cells };
          if (x.pos === 'bottom') t.rows.push(row); else t.rows.unshift(row);
        }
        res = { ...base, ok: true, table: t.id, text: 'Строка в таблице «' + t.title + '» · страница «' + page.title + '»' };
      }
    }
    r.actions = (r.actions || []).filter((y) => y.rule !== x.id).concat([res]);
    if (!res.ok) event('Форма «' + f.name + '»: ответ ' + r.id + ' не сохранён в Базу знаний — ' + res.err, owners());
    return res;
  };

  // Вложения задач: до 20 МБ каждое, до 30 на задачу, фото, PDF, текст и офисные документы. Доступ — как к задаче.
  const FILE_OK = /^(image\/|application\/pdf|text\/|application\/(msword|vnd\.openxmlformats|vnd\.ms-excel|vnd\.oasis|zip))/;
  const checkFiles = (list, have) => {
    if (have + list.length > 30) throw new ApiError('validation', 'К задаче можно прикрепить не больше 30 файлов');
    const bad = list.find((f) => !(f.size > 0) || f.size > 20 * 1048576 || !FILE_OK.test(f.type || ''));
    if (bad) throw new ApiError('validation', 'Файл «' + bad.name + '» не принят: ' + (bad.size > 20 * 1048576 ? 'больше 20 МБ' : !(bad.size > 0) ? 'пустой файл' : 'такой тип не принимаем'));
    return list.map((f) => ({ name: String(f.name).slice(0, 180), size: f.size, type: f.type, url: f.url || null }));
  };
  const checkParent = (t, parentId) => {
    const par = db.tasks.find((x) => x.id === parentId); if (!par) throw new ApiError('validation', 'Задача ' + parentId + ' не найдена');
    const pp = (db.projects || []).find((x) => x.id === par.project);
    if (!pp || !pp.wf || !M.projCan(db, pp, actor, 'view').ok) throw new ApiError('forbidden', 'Нет доступа к задаче ' + parentId);
    if (t && par.id === t.id) throw new ApiError('validation', 'Задача не может входить в саму себя');
    let up = par, depth = 1;
    while (up && up.parent) { if (t && up.parent === t.id) throw new ApiError('validation', 'Получится цикл: ' + par.id + ' уже входит в ' + t.id); up = db.tasks.find((x) => x.id === up.parent); depth++; if (depth > 10) break; }
    const below = (x) => 1 + Math.max(0, ...db.tasks.filter((y) => y.parent === x.id).map(below));
    if (depth + (t ? below(t) : 1) > 3) throw new ApiError('validation', 'Не больше трёх уровней: задача → подзадача → подзадача');
    if (M.isDone(db, par)) throw new ApiError('validation', 'Задача ' + par.id + ' уже завершена — сначала верните её в работу');
    return par;
  };
  const pj = (id) => { const p = (db.projects || []).find((x) => x.id === id); if (!p || !p.wf) throw new ApiError('not_found', 'Проект не найден или процесс не настроен'); return p; };
  const assertPj = (p, verb) => { const c = M.projCan(db, p, actor, verb); if (!c.ok) throw new ApiError('forbidden', 'Нет права «' + M.VERB_LABEL[verb] + '» в проекте «' + p.name + '»: ' + c.why); };
  const moveTo = (p, t, tr, me, txt) => {
    const to = p.wf.statuses.find((s) => s.id === tr.to), from = t.status;
    t.status = to.name; t.approval = null;
    t.comments.push({ by: me ? me.name : 'Система', at: hhmm(), text: tr.name + ': ' + from + ' → ' + to.name + (txt ? '. ' + txt : ''), system: true });
    if (tr.assignAuthor && t.author) { t.assignee = t.author; t.comments.push({ by: 'Процесс', at: hhmm(), text: 'Назначено на автора: ' + t.author, system: true }); }
    autoFire(p, t, 'status', to.id);
  };
  // Автоматизация проекта: от имени автора правила с проверкой его прав; изменения правил не запускают правила (нет циклов).
  let autoDepth = 0;
  const autoFire = (p, t, trigger, toId) => {
    if (autoDepth) return; autoDepth++;
    try {
      (p.automations || []).filter((r) => r.on && r.trigger === trigger && (trigger !== 'status' || r.to === toId)).forEach((r) => {
        const log = (res, text) => { p.runs.unshift({ at: hhmm(), rule: r.id, name: r.name, rv: r.version || 1, res, text, task: t.id }); p.runs.length = Math.min(p.runs.length, 30); };
        if (r.cond && r.cond.priority && t.priority !== r.cond.priority) return log('stopped', t.id + ': приоритет «' + (M.PRIORITY[t.priority] || [t.priority])[0] + '» — условие не выполнено');
        const c = M.projCan(db, p, r.byId, 'edit'); if (!c.ok) { event('Правило «' + r.name + '» не выполнено: ' + c.why, owners()); return log('error', 'У автора правила ' + r.by + ' нет права менять задачи: ' + c.why); }
        const v = String(r.action.value || '');
        if (r.action.kind === 'assign') { const mm = db.members.find((x) => x.name === v && x.status === 'active'); if (!mm) return log('error', 'Сотрудник «' + v + '» не найден или неактивен'); t.assignee = v; log('ok', t.id + ' назначена: ' + v); }
        else if (r.action.kind === 'priority') { t.priority = v; log('ok', t.id + ': приоритет «' + (M.PRIORITY[v] || [v])[0] + '»'); }
        else { t.comments.push({ by: 'Автоматизация', at: hhmm(), text: v, system: true }); log('ok', t.id + ': добавлен комментарий'); }
        t.comments.push({ by: 'Автоматизация', at: hhmm(), text: 'Правило «' + r.name + '» v' + (r.version || 1), system: true });
      });
    } finally { autoDepth--; }
  };

  const assertNet = () => { if (!flags.online) throw new ApiError('offline', 'Нет связи с сервером. Операция не выполнена.'); };
  const assertActive = () => {
    const t = tenant();
    if (t.status === 'restricted' || t.status === 'suspended') throw new ApiError('subscription_restricted', 'Пробный период завершён: новые операции недоступны. История доступна для чтения.');
  };
  const assertCan = (mod, verb, unitId) => {
    const r = M.can(db, actor, mod, verb, unitId);
    if (!r.ok) throw new ApiError(r.reason, M.REASON[r.reason].text);
  };
  // Начатую работу можно безопасно завершить даже после отключения модуля или окончания trial.
  const startedWork = (t) => ['inspection', 'on_route', 'returning', 'rework', 'submitted', 'defect_review'].includes(t.status);
  const assertLogisticsFor = (t, verb) => {
    if (!startedWork(t)) { assertActive(); if (!M.moduleOn(db, 'logistics')) throw new ApiError('module_off', 'Модуль «Логистика» отключён: новые операции закрыты.'); }
    const r = M.can({ ...db, modules: { ...db.modules, logistics: { enabled: true } } }, actor, 'logistics', verb, t.unit);
    if (!r.ok) throw new ApiError(r.reason, M.REASON[r.reason].text);
  };

  // Ответ сервера формируется для конкретного участника: запрещённые поля не передаются вовсе.
  function view() {
    if (actor === null) return { platform: clone(db.platform), operatorOnly: true, flags: { ...flags } };
    const out = clone(db);
    delete out.platform.audit;
    delete out.platform.accounts;
    delete out.platform.operators;
    out.platform.requests = out.platform.requests.filter((r) => r.tenantId === db.tenantId);
    out.platform.tenants = out.platform.tenants.filter((t) => t.id === db.tenantId);
    out.trips.forEach((t) => { if (!M.canEarnings(db, actor, t.unit).ok) delete t.earnings; });
    if (!db.trips.some((t) => M.canEarnings(db, actor, t.unit).ok)) out.earnings = [];
    out.events = out.events.filter((e) => (e.to || []).includes(actor) && (!e.sensitive || M.canEarnings(db, actor, e.unit).ok));
    const seesFleet = (u) => M.can({ ...db, modules: { ...db.modules, logistics: { enabled: true } } }, actor, 'logistics', 'view', u).ok;
    out.vehicles = out.vehicles.filter((v) => seesFleet(v.unit));
    out.trips = out.trips.filter((t) => seesFleet(t.unit) && (M.can({ ...db, modules: { ...db.modules, logistics: { enabled: true } } }, actor, 'logistics', 'edit', t.unit).ok || t.driverId === actor));
    out.flags = { ...flags };
    const isOwner = M.grants(db, actor).some((g) => g.roleObj.all);
    const me = db.members.find((m) => m.id === actor);
    const projVisible = (p) => M.grants(db, actor).some((g) => g.roleObj.all || (g.scope && g.scope.type === 'project' && g.scope.id === p.id) || ((g.roleObj.actions?.tasks || []).length && M.scopeCovers(db, g.scope, p.unit)));
    out.projects = (out.projects || []).filter(projVisible);
    const pids = new Set(out.projects.map((p) => p.id));
    out.tasks = (out.tasks || []).filter((t) => pids.has(t.project) || (me && t.assignee === me.name) || (t.docRoute && (t.authorId === actor || (t.docRoute.waiting || []).includes(actor))));
    const seesLog = M.can({ ...db, modules: { ...db.modules, logistics: { enabled: true } } }, actor, 'logistics', 'view', 'f-msk-sever').ok;
    out.responses = (out.responses || []).filter((r) => seesLog || (me && r.author === me.name));
    if (out.knowledge) out.knowledge = kbView(db, M, actor, out.knowledge);
    if (out.docs) out.docs = docsView(db, M, actor, out.docs);
    if (out.chats) out.chats = chatsView(db, M, actor, out.chats);
    if (out.cash) out.cash = cashView(db, M, actor, out.cash);
    if (!isOwner) out.calendar.bookings = out.calendar.bookings.filter((b) => !b.source || b.source.kind !== 'vehicle' || seesFleet('f-msk-sever'));
    if (out.repair) {
      // Прораб получает только объекты, где он назначен; суммы объекта — только с правом финансов.
      const asOn = { ...db, modules: { ...db.modules, repair: { enabled: true } } };
      const seesAll = isOwner || M.can(asOn, actor, 'repair', 'review').ok || M.can(asOn, actor, 'repair', 'edit').ok;
      const fin = M.grants(db, actor).some((g) => g.roleObj.all || g.roleObj.finance?.read);
      out.repair.objects = out.repair.objects.filter((o) => seesAll || (me && o.foreman === me.name));
      const ids = new Set(out.repair.objects.map((o) => o.id));
      ['works', 'logs', 'materials', 'changes'].forEach((k) => { out.repair[k] = (out.repair[k] || []).filter((x) => ids.has(x.obj)); });
      if (!fin) out.repair.objects.forEach((o) => { if (o.st) delete o.st.fin; });
    }
    out.service = serviceView(db, actor, M);
    return out;
  }

  async function cmd(fn, ms = 420, needsNet = true) {
    await wait(ms);
    if (needsNet) assertNet();
    try { const data = fn(); syncSeats(); return { data, db: view() }; }
    catch (e) { e.db = view(); throw e; }
  }

  return {
    kind: 'mock',
    flags,
    setActor(memberId, tenantId) { actor = memberId; if (tenantId && dbs[tenantId]) db = dbs[tenantId]; },
    tenantIds: () => Object.keys(dbs),
    setFlag(k, v) { flags[k] = v; },
    load: (ms = 500) => wait(ms).then(() => view()),
    // Обращения клиентов по направлениям (docs/22)
    ...serviceApi({ getDb: () => db, getActor: () => actor, cmd, ApiError, M, event }),
    // База знаний: пространства, подстраницы, доступ (docs/23)
    ...knowledgeApi({ getDb: () => db, getActor: () => actor, cmd, ApiError, M, event }),
    // Документы: текст, таблицы, PDF, маршрут (docs/24)
    ...docsApi({ getDb: () => db, getActor: () => actor, cmd, ApiError, M, event }),
    // Чаты: состав из ролей, политики хранения и места (docs/25)
    ...chatsApi({ getDb: () => db, getActor: () => actor, cmd, ApiError, M, event }),
    // Касса: кассы подразделений, смены со сверкой, предложения модулей, подотчёт (docs/26)
    ...cashApi({ getDb: () => db, getActor: () => actor, cmd, ApiError, M, event }),

    // ── Платформа (отдельная поверхность оператора; бизнес-данные не передаются) ──
    extendTrial: (tenantId, days) => cmd(() => {
      const t = tenant(tenantId); t.status = 'trial'; t.trialDaysLeft = (t.trialDaysLeft || 0) + days; t.trialEnds = days === 14 && t.id === 't-alta' ? '27.10.2026' : 'через ' + t.trialDaysLeft + ' дн.';
      db.platform.audit.unshift({ at: hhmm(), text: t.name + ': пробный период продлён на ' + days + ' дней', by: 'Оператор (демо)' });
      if (t.id === db.tenantId) event('Оператор платформы продлил пробный период на ' + days + ' дней', owners());
    }),
    setTenantQuota: (tenantId, gb) => cmd(() => {
      const t = tenant(tenantId); const before = t.quotaGb; t.quotaGb = gb;
      db.platform.audit.unshift({ at: hhmm(), text: t.name + ': квота ' + before + ' → ' + gb + ' ГБ', by: 'Оператор (демо)' });
    }),
    setTenantStatus: (tenantId, status) => cmd(() => {
      const t = tenant(tenantId); t.status = status; if (status === 'restricted') t.trialDaysLeft = 0;
      db.platform.audit.unshift({ at: hhmm(), text: t.name + ': статус «' + M.TENANT_STATE[status].label + '»', by: 'Оператор (демо)' });
      if (t.id === db.tenantId) event(status === 'restricted' ? 'Пробный период завершён. Новые операции ограничены, данные сохранены.' : 'Ограничения подписки сняты', owners());
    }),

    // ── Оформление организации (PROPOSED) ──
    saveBranding: (b) => cmd(() => {
      const t = tenant(), name = String(b.name || '').trim(), short = String(b.short || '').trim();
      if (!name || name.length > 60) throw new ApiError('validation', 'Название — от 1 до 60 символов');
      if (short.length > 16) throw new ApiError('validation', 'Короткое имя — до 16 символов');
      if (!/^#[0-9a-f]{6}$/i.test(b.accent || '')) throw new ApiError('validation', 'Цвет — в формате #RRGGBB');
      for (const [k, f] of Object.entries(b.terms || {})) if (['one', 'plural', 'few', 'many'].some((x) => !String(f[x] || '').trim())) throw new ApiError('validation', 'Заполните все формы термина «' + k + '»');
      const v = (t.brand?.version || 1) + 1;
      t.brand = { ...b, name, short, version: v, updatedAt: hhmm(), updatedBy: actorName() };
      t.name = name;
      db.platform.audit.unshift({ at: hhmm(), text: name + ': оформление, версия ' + v, by: actorName() });
      event('Оформление обновлено (версия ' + v + '). Изменения видны всем сотрудникам', owners());
      return v;
    }),
    defaultBranding: () => ({ ...BRAND_DEFAULT }),

    // ── Модули и место ──
    setModule: (key, enabled) => cmd(() => {
      db.modules[key] = { enabled, history: !enabled ? true : db.modules[key]?.history };
      const t = tenant(); t.modules = Object.keys(db.modules).filter((k) => db.modules[k].enabled);
      event((enabled ? 'Подключён модуль «' : 'Отключён модуль «') + M.INDUSTRY[key].name + '»' + (enabled ? '' : '. История сохранена.'), owners());
    }),
    setStorageQuota: (gb) => cmd(() => { assertActive(); tenant().quotaGb = gb; event('Лимит места изменён на ' + gb + ' ГБ', owners()); }),

    // ── Люди и роли ──
    invite: ({ name, email, roleId, scope }) => cmd(() => {
      if (!name?.trim()) throw new ApiError('validation', 'Укажите имя');
      if (!M.emailOk(email)) throw new ApiError('validation', 'Проверьте адрес электронной почты');
      if (db.members.some((m) => m.email.toLowerCase() === email.trim().toLowerCase())) throw new ApiError('conflict', 'Участник с таким адресом уже есть');
      syncSeats(); const tn = tenant();
      if (tn.seatsLimit != null && tn.seatsUsed >= tn.seatsLimit) throw new ApiError('seats_exhausted', 'Свободных мест нет: занято ' + tn.seatsUsed + ' из ' + tn.seatsLimit + '. Отзовите приглашение или запросите расширение тарифа.');
      const acc = account(email);
      if (acc) acc.memberships.push({ tenantId: db.tenantId, status: 'invited' });
      else db.platform.accounts.push({ id: 'acc-' + db.seq++, name: name.trim(), email: email.trim(), status: 'pending', mfa: false, lastLogin: null, memberships: [{ tenantId: db.tenantId, status: 'invited' }] });
      const id = 'm-' + db.seq++;
      db.members.push({ id, name: name.trim(), email: email.trim(), status: 'invited', title: '', invitedNote: 'Приглашение до 08.10' });
      if (roleId) db.assignments.push({ id: 'a' + db.seq++, member: id, role: roleId, scope });
      return id;
    }),
    revokeInvite: (memberId) => cmd(() => {
      const m = db.members.find((x) => x.id === memberId);
      if (!m || m.status !== 'invited') throw new ApiError('conflict', 'Приглашение уже принято или отозвано');
      db.members = db.members.filter((x) => x.id !== memberId);
      db.assignments = db.assignments.filter((a) => a.member !== memberId);
      db.groups.forEach((g) => { g.members = g.members.filter((x) => x !== memberId); });
      const acc = account(m.email); if (acc) acc.memberships = acc.memberships.filter((x) => x.tenantId !== db.tenantId);
    }),

    // ── Подписка и места: владелец запрашивает, оператор подтверждает (PROPOSED) ──
    requestSeats: ({ tierId, term, comment }) => cmd(() => {
      const t = tenant();
      if (db.platform.requests.some((r) => r.tenantId === t.id && r.status === 'pending')) throw new ApiError('conflict', 'Заявка уже на рассмотрении. Отмените её, чтобы отправить новую.');
      const tier = tierOf(tierId); if (!tier) throw new ApiError('validation', 'Выберите тариф');
      syncSeats();
      if (tier.seats != null && tier.seats < t.seatsUsed) throw new ApiError('validation', 'В тарифе «' + tier.name + '» ' + tier.seats + ' мест, а занято ' + t.seatsUsed);
      const id = 'SR-' + (20 + db.seq++);
      db.platform.requests.unshift({ id, tenantId: t.id, from: t.plan.tier, to: tierId, term: Number(term), used: t.seatsUsed, by: actorName(), at: hhmm(), status: 'pending', comment: (comment || '').trim() });
      db.platform.audit.unshift({ at: hhmm(), text: t.name + ': заявка ' + id + ' на тариф «' + tier.name + '»', by: actorName() });
      event('Заявка ' + id + ' на тариф «' + tier.name + '» отправлена оператору', owners());
      return id;
    }),
    cancelSeatRequest: (id) => cmd(() => {
      const r = db.platform.requests.find((x) => x.id === id);
      if (!r || r.status !== 'pending') throw new ApiError('conflict', 'Заявка уже рассмотрена');
      r.status = 'cancelled'; r.decidedAt = hhmm(); r.decidedBy = actorName();
    }),
    decideSeatRequest: (id, approve, note) => cmd(() => {
      const r = db.platform.requests.find((x) => x.id === id);
      if (!r || r.status !== 'pending') throw new ApiError('conflict', 'Заявка уже рассмотрена или отменена');
      if (!approve && !note?.trim()) throw new ApiError('validation', 'Укажите причину отказа');
      const t = tenant(r.tenantId); const tier = tierOf(r.to);
      r.status = approve ? 'approved' : 'rejected'; r.decidedBy = 'Оператор (демо)'; r.decidedAt = hhmm(); r.decision = (note || '').trim();
      if (approve) {
        t.plan = { tier: r.to, term: r.term, paidUntil: PAID_UNTIL[r.term], version: db.platform.priceBook.current };
        t.seatsLimit = tier.seats;
        if (['trial', 'restricted'].includes(t.status)) { t.status = 'active'; t.trialDaysLeft = null; t.trialEnds = null; }
      }
      db.platform.audit.unshift({ at: hhmm(), text: t.name + ': заявка ' + id + (approve ? ' подтверждена, тариф «' + tier.name + '»' : ' отклонена: ' + r.decision), by: 'Оператор (демо)' });
      if (t.id === db.tenantId) event(approve ? 'Тариф «' + tier.name + '» подключён: ' + (tier.seats ? tier.seats + ' мест' : 'без ограничения мест') : 'Заявка ' + id + ' отклонена: ' + r.decision, owners());
    }),
    publishPriceBook: ({ tiers, terms, from, note }) => cmd(() => {
      const pb = db.platform.priceBook; const cur = pb.versions.find((x) => x.v === pb.current);
      const paid = tiers.filter((t) => t.seats != null);
      if (paid.some((t) => !(Number(t.month) > 0))) throw new ApiError('validation', 'Цена каждой ступени должна быть больше нуля');
      if (paid.some((t, i) => i && Number(t.month) <= Number(paid[i - 1].month))) throw new ApiError('validation', 'Ступень с большим числом мест должна стоить дороже предыдущей');
      if (tiers.some((t) => !String(t.name || '').trim())) throw new ApiError('validation', 'У каждого тарифа должно быть название');
      if (paid.some((t, i) => !(Number.isInteger(Number(t.seats)) && Number(t.seats) > 0) || (i && Number(t.seats) <= Number(paid[i - 1].seats)))) throw new ApiError('validation', 'Число мест должно расти от тарифа к тарифу');
      if (tiers.some((t, i) => t.seats == null && i !== tiers.length - 1)) throw new ApiError('validation', 'Тариф без лимита может быть только последним');
      if (terms.some((t) => !(Number(t.off) >= 0 && Number(t.off) < 50))) throw new ApiError('validation', 'Скидка за срок — от 0 до 49%');
      if (pb.scheduled) throw new ApiError('conflict', 'Уже запланирована версия v' + pb.scheduled + '. Отмените её, чтобы подготовить другую.');
      const v = Math.max(...pb.versions.map((x) => x.v)) + 1;
      // Версия с будущей датой только запланирована: до даты начала действует текущая (в демо «сегодня» 01.10.2026).
      pb.versions.push({ v, from, to: null, scheduled: true, note: (note || '').trim() || 'Изменение цен', by: 'Оператор (демо)', tiers: tiers.map((t) => ({ ...t, name: String(t.name).trim(), seats: t.seats == null ? null : Number(t.seats), month: t.month == null ? null : Number(t.month) })), terms: terms.map((t) => ({ months: t.months, off: Number(t.off) })) });
      cur.to = 'до ' + from;
      pb.scheduled = v;
      db.platform.audit.unshift({ at: hhmm(), text: 'Тарифная сетка v' + v + ' запланирована с ' + from, by: 'Оператор (демо)' });
      return v;
    }),
    cancelScheduledPriceBook: () => cmd(() => {
      const pb = db.platform.priceBook;
      if (!pb.scheduled) throw new ApiError('conflict', 'Запланированной версии нет');
      const v = pb.scheduled;
      pb.versions = pb.versions.filter((x) => x.v !== v);
      pb.versions.find((x) => x.v === pb.current).to = null;
      pb.scheduled = null;
      db.platform.audit.unshift({ at: hhmm(), text: 'Запланированная версия v' + v + ' отменена до начала действия', by: 'Оператор (демо)' });
    }),
    setAccountLock: (id, locked, reason) => cmd(() => {
      const a = db.platform.accounts.find((x) => x.id === id);
      if (locked && !reason?.trim()) throw new ApiError('validation', 'Укажите причину блокировки');
      a.status = locked ? 'locked' : (a.lastLogin ? 'active' : 'pending'); a.lockReason = locked ? reason.trim() : null;
      db.platform.audit.unshift({ at: hhmm(), text: a.email + (locked ? ': вход заблокирован — ' + reason.trim() : ': вход разблокирован'), by: 'Оператор (демо)' });
    }),
    // ── Организация платформы: операторы (PROPOSED) ──
    inviteOperator: ({ name, email, role }) => cmd(() => {
      const P = db.platform, e = String(email || '').trim().toLowerCase();
      if (!String(name || '').trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ApiError('validation', 'Укажите имя и рабочую почту');
      if (!e.endsWith('@ortus.example')) throw new ApiError('validation', 'Оператором может быть только сотрудник платформы: почта в домене ortus.example');
      if (P.operators.some((o) => o.email === e)) throw new ApiError('conflict', 'Оператор с такой почтой уже есть');
      if (P.accounts.some((a) => a.email.toLowerCase() === e)) throw new ApiError('conflict', 'Эта почта уже используется в организации клиента. Для оператора нужен отдельный рабочий аккаунт');
      if (role === 'owner') throw new ApiError('validation', 'Владельцем платформы назначают уже работающего оператора');
      P.operators.push({ id: 'op-' + db.seq++, name: name.trim(), email: e, role, status: 'invited', mfa: null, lastLogin: null });
      P.audit.unshift({ at: hhmm(), text: 'Платформа: приглашён оператор ' + e + ' (' + role + ')', by: 'Оператор (демо)' });
    }),
    setOperatorRole: (id, role) => cmd(() => {
      const P = db.platform, o = P.operators.find((x) => x.id === id), owners = P.operators.filter((x) => x.role === 'owner' && x.status === 'active').length;
      if (o.me) throw new ApiError('conflict', 'Свою роль менять нельзя: попросите другого владельца');
      if (o.role === 'owner' && role !== 'owner' && o.status === 'active' && owners <= 1) throw new ApiError('conflict', 'На платформе должен остаться хотя бы один активный владелец');
      if (role === 'owner' && (o.status !== 'active' || !o.mfa)) throw new ApiError('validation', 'Владельцем может стать только активный оператор со вторым фактором');
      const was = o.role; o.role = role;
      P.audit.unshift({ at: hhmm(), text: 'Платформа: ' + o.email + ' — роль ' + was + ' → ' + role, by: 'Оператор (демо)' });
    }),
    setOperatorStatus: (id, active) => cmd(() => {
      const P = db.platform, o = P.operators.find((x) => x.id === id), owners = P.operators.filter((x) => x.role === 'owner' && x.status === 'active').length;
      if (o.me) throw new ApiError('conflict', 'Себя отключить нельзя');
      if (!active && o.role === 'owner' && o.status === 'active' && owners <= 1) throw new ApiError('conflict', 'Нельзя отключить последнего активного владельца');
      if (!active && o.status === 'invited') { P.operators = P.operators.filter((x) => x.id !== id); P.audit.unshift({ at: hhmm(), text: 'Платформа: приглашение ' + o.email + ' отозвано', by: 'Оператор (демо)' }); return; }
      o.status = active ? 'active' : 'disabled'; o.disabledNote = active ? null : 'Отключён ' + hhmm();
      P.audit.unshift({ at: hhmm(), text: 'Платформа: ' + o.email + (active ? ' снова активен' : ' отключён, сессии завершены'), by: 'Оператор (демо)' });
    }),
    resetMfa: (id) => cmd(() => {
      const a = db.platform.accounts.find((x) => x.id === id); a.mfa = false;
      db.platform.audit.unshift({ at: hhmm(), text: a.email + ': сброшен второй фактор, при входе попросим настроить заново', by: 'Оператор (демо)' });
    }),
    assign: ({ memberId, roleId, scope, until }) => cmd(() => {
      const m = db.members.find((x) => x.id === memberId); const role = db.roles.find((r) => r.id === roleId);
      if (!role) throw new ApiError('validation', 'Выберите роль');
      if (!scope || (scope.type !== 'tenant' && scope.type !== 'self' && !scope.id)) throw new ApiError('validation', 'Выберите область действия');
      if (scope.type === 'account' && !(role.actions?.cash || []).length && !role.all) throw new ApiError('validation', 'Область «Касса» подходит только ролям с модулем «Касса»');
      if (m.function === 'driver' && role.finance?.read) throw new ApiError('role_conflict', 'Функция «Водитель» несовместима с правом на начисления (правило MVP).');
      if (role.professional === 'driver' && M.grants(db, memberId).some((g) => g.roleObj.finance?.read || g.roleObj.all)) throw new ApiError('role_conflict', 'У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено.');
      db.assignments.push({ id: 'a' + db.seq++, member: memberId, role: roleId, scope, until: until || null });
      event('Вам назначена роль «' + role.name + '» · ' + M.scopeLabel(db, scope), [memberId]);
    }),
    unassign: (assignmentId) => cmd(() => {
      const a = db.assignments.find((x) => x.id === assignmentId);
      if (a?.role === 'r-owner' && db.assignments.filter((x) => x.role === 'r-owner').length < 2) throw new ApiError('last_owner', 'Нельзя снять роль с последнего владельца');
      db.assignments = db.assignments.filter((x) => x.id !== assignmentId);
    }),
    createRole: ({ name, mode, sourceId }) => cmd(() => {
      if (!name?.trim()) throw new ApiError('validation', 'Укажите название роли');
      const src = db.roles.find((r) => r.id === sourceId);
      const role = { id: 'r-' + db.seq++, name: name.trim(), kind: 'custom', actions: {}, finance: { read: false, manage: false } };
      if (mode !== 'empty' && src) { role.actions = clone(src.actions); role.finance = clone(src.finance); if (src.professional) role.professional = src.professional; }
      db.roles.push(role); return role.id;
    }, 300),
    saveRole: (role) => cmd(() => {
      const i = db.roles.findIndex((r) => r.id === role.id);
      if (db.roles[i].kind === 'system') throw new ApiError('forbidden', 'Системная роль не редактируется');
      if (!role.name.trim()) throw new ApiError('validation', 'Укажите название роли');
      if (role.professional === 'driver' && (role.finance.read || role.finance.manage)) throw new ApiError('role_conflict', 'Роль с функцией «Водитель» не может содержать начисления');
      if (role.professional === 'driver' && (role.actions?.cash || []).length) role.cash = { ...(role.cash || {}), self: true }; // функция «Водитель»: в кассе только свой подотчёт
      const holders = db.assignments.filter((a) => a.role === role.id).map((a) => db.members.find((m) => m.id === a.member));
      if (role.finance.read && holders.some((m) => m.function === 'driver')) throw new ApiError('role_conflict', 'Роль назначена водителю — финансовые права недоступны');
      db.roles[i] = clone(role);
    }, 380),

    // ── Логистика ──
    reserve: (tripId, vehicleId) => cmd(() => {
      const t = trip(tripId); const v = veh(vehicleId);
      assertActive(); if (!M.moduleOn(db, 'logistics')) throw new ApiError('module_off', 'Модуль «Логистика» отключён');
      assertCan('logistics', 'create', v.unit);
      if (flags.conflictNext) {
        flags.conflictNext = false; v.state = 'reserved'; v.heldBy = 'other'; v.note = 'другой рейс';
        throw new ApiError('conflict', 'Машину только что забронировал другой сотрудник. Список на экране устарел.', { vehicleId });
      }
      if (v.state !== 'free' && v.heldBy !== t.id) throw new ApiError('conflict', 'Машина уже недоступна. Обновите список.', { vehicleId });
      const c = M.compat(v, t); if (!c.fit) throw new ApiError('incompatible', 'Машина не подходит рейсу: ' + c.reasons.join('; '));
      t.vehicleId = v.id; t.status = 'inspection'; t.reservedUntil = '09:30'; v.state = 'reserved'; v.heldBy = t.id; v.note = null;
      event('Илья Васильев забронировал ' + v.model + ' ' + v.plate + ' на рейс ' + t.id, reviewers(t.unit));
    }, 600),
    cancelReservation: (tripId) => cmd(() => {
      const t = trip(tripId); const v = db.vehicles.find((x) => x.id === t.vehicleId);
      if (v && v.heldBy === t.id) { if (v.state === 'reserved') v.state = 'free'; v.heldBy = null; }
      t.vehicleId = null; t.status = 'planned'; t.defect = null;
    }),
    assignVehicle: (tripId, vehicleId) => cmd(() => {
      const t = trip(tripId); const v = veh(vehicleId);
      assertActive(); assertCan('logistics', 'edit', t.unit);
      if (flags.conflictNext) { flags.conflictNext = false; v.state = 'reserved'; v.heldBy = 'other'; v.note = 'другой рейс'; throw new ApiError('conflict', 'Машину только что забронировали. Обновите список.'); }
      const c = M.compat(v, t); if (!c.ok) throw new ApiError('incompatible', 'Нельзя назначить: ' + c.reasons.join('; '));
      const prev = db.vehicles.find((x) => x.id === t.vehicleId); if (prev && prev.heldBy === t.id) { prev.state = 'free'; prev.heldBy = null; }
      t.vehicleId = v.id; t.status = t.status === 'planned' ? 'assigned' : t.status; v.state = 'reserved'; v.heldBy = t.id;
    }),
    submitDeparture: (tripId, payload) => cmd(() => {
      const t = trip(tripId); const v = veh(t.vehicleId); assertLogisticsFor(t, 'create');
      const miss = M.inspMissing(payload, 'dep', v.odometer); if (miss.length) throw new ApiError('validation', 'Осмотр не завершён: ' + miss.join(', '));
      if (!M.PHOTO_SIDES.every(([k]) => payload.photos[k]?.state === 'ready')) throw new ApiError('validation', 'Не все фото загружены на сервер');
      const critical = (payload.defects || []).filter((d) => d.critical);
      t.dep = { odometer: Number(payload.odometer), fuel: payload.fuel, defects: payload.defects, photos: payload.photos, at: hhmm() };
      recordInspection(t, 'dep', payload);
      if (critical.length) {
        t.status = 'defect_review'; t.defect = critical[0]; v.state = 'unavailable'; v.note = 'критический дефект на проверке';
        event('Критический дефект: ' + v.model + ' ' + v.plate + ' — ' + critical[0].zone + '. Выезд заблокирован.', reviewers(t.unit));
        return 'blocked';
      }
      t.status = 'on_route'; v.state = 'on_route';
      event('Рейс ' + t.id + ' начат · ' + v.model, reviewers(t.unit));
      return 'started';
    }, 650),
    decideDefect: (tripId, decision) => cmd(() => {
      const t = trip(tripId); const v = veh(t.vehicleId); assertCan('logistics', 'review', t.unit);
      if (decision === 'allow') {
        t.dep.defects = t.dep.defects.map((d) => ({ ...d, critical: false, downgraded: true }));
        t.status = 'on_route'; t.defect = null; v.state = 'on_route'; v.note = null;
        event('Менеджер разрешил выезд: дефект признан некритичным', [t.driverId]);
      } else {
        v.state = 'unavailable'; v.note = 'неисправность подтверждена'; v.heldBy = null;
        t.vehicleId = null; t.status = 'planned'; t.dep = null; t.defect = null;
        event('Неисправность подтверждена. Выберите другую машину для рейса ' + t.id, [t.driverId]);
      }
    }),
    addExpense: (tripId, e) => cmd(() => {
      const t = trip(tripId); assertLogisticsFor(t, 'create');
      if (e.opId && ops.has(e.opId)) return 'duplicate';
      const err = M.validateExpense(e); if (Object.keys(err).length) throw new ApiError('validation', Object.values(err)[0]);
      if (e.receipt.state !== 'ready') throw new ApiError('validation', 'Фото чека ещё не загружено');
      t.expenses.push({ id: 'x' + db.seq++, category: e.category, amount: Number(String(e.amount).replace(',', '.')), date: e.date, comment: e.comment || '', liters: e.liters || '', receipt: { fileId: e.receipt.fileId, url: e.receipt.url || null }, at: hhmm() });
      if (e.opId) ops.add(e.opId);
    }, 450),
    finishRoute: (tripId) => cmd(() => { const t = trip(tripId); assertLogisticsFor(t, 'create'); t.status = 'returning'; }, 350),
    submitReturn: (tripId, payload) => cmd(() => {
      const t = trip(tripId); const v = veh(t.vehicleId); assertLogisticsFor(t, 'create');
      if (payload.opId && ops.has(payload.opId)) return 'duplicate';
      const miss = M.inspMissing(payload, 'ret', t.dep.odometer); if (miss.length) throw new ApiError('validation', 'Сдача не завершена: ' + miss.join(', '));
      if (!M.PHOTO_SIDES.every(([k]) => payload.photos[k]?.state === 'ready')) throw new ApiError('validation', 'Не все фото загружены на сервер');
      t.ret = { odometer: Number(payload.odometer), fuel: payload.fuel, defects: payload.defects, photos: payload.photos, comment: payload.comment || '', at: hhmm() };
      recordInspection(t, 'ret', payload);
      t.status = 'submitted'; v.state = 'review'; t.review = t.review ? { ...t.review, resolved: true } : null;
      if (payload.opId) ops.add(payload.opId);
      event('Смена ' + t.id + ' сдана на приёмку · ' + v.model + ' ' + v.plate, reviewers(t.unit));
    }, 650),
    reviewTrip: (tripId, { decision, comment, steps }) => cmd(() => {
      const t = trip(tripId); const v = veh(t.vehicleId); assertCan('logistics', 'review', t.unit);
      if (t.status !== 'submitted') throw new ApiError('conflict', 'Смена уже обработана');
      if (decision === 'rework') {
        if (!comment?.trim()) throw new ApiError('validation', 'Опишите, что нужно исправить');
        if (!steps?.length) throw new ApiError('validation', 'Отметьте хотя бы один раздел для доработки');
        t.status = 'rework'; t.review = { decision, comment, steps, at: hhmm() };
        event('Смена ' + t.id + ' возвращена на доработку: ' + comment, [t.driverId]);
        return;
      }
      t.status = 'accepted'; t.review = { decision: 'accept', comment: comment || '', at: hhmm() };
      v.state = 'free'; v.heldBy = null; v.odometer = t.ret.odometer;
      db.earnings.push({ id: 'n' + db.seq++, tripId: t.id, unit: t.unit, member: t.driverId, amount: t.earnings, status: 'Начислено' });
      event('Смена ' + t.id + ' принята. Машина свободна.', [t.driverId, ...reviewers(t.unit)]);
      const evId = db.seq;
      db.events.unshift({ id: 'e' + db.seq++, at: hhmm(), text: 'Начисление по рейсу ' + t.id + ': ' + M.rub(t.earnings), to: reviewers(t.unit), sensitive: 'earnings', unit: t.unit });
      return evId;
    }, 600),
    resetTrip: (tripId) => cmd(() => {
      const t = trip(tripId); Object.assign(t, { vehicleId: null, status: 'planned', dep: null, ret: null, expenses: [], review: null, defect: null });
    }, 250, false),
    requestDriver: ({ driverId, tripId, comment }) => cmd(() => {
      assertActive(); const t = trip(tripId); assertCan('logistics', 'edit', t.unit);
      const d = db.pool.drivers.find((x) => x.id === driverId);
      if (db.pool.requests.some((r) => r.driverId === driverId && r.status === 'pending')) throw new ApiError('conflict', 'Запрос уже отправлен');
      db.pool.requests.push({ id: 'q' + db.seq++, driverId, tripId, comment: comment || '', status: 'pending', home: d.home, at: hhmm() });
    }),
    decideRequest: (requestId, approve) => cmd(() => {
      const q = db.pool.requests.find((r) => r.id === requestId); const d = db.pool.drivers.find((x) => x.id === q.driverId); const t = trip(q.tripId);
      q.status = approve ? 'approved' : 'declined'; q.decidedAt = hhmm();
      if (approve) { t.driverId = d.id; t.driverName = d.code + ' · временно'; q.until = '18:00 01.10'; }
      event('Запрос водителя ' + d.code + (approve ? ' одобрен фирмой ' : ' отклонён фирмой ') + d.home, reviewers(t.unit));
    }),

    // ── Формы: черновик (f.draft) → новая неизменяемая версия. def = { pages, fields }; старый формат — массив полей ──
    publishForm: (formId, def) => cmd(() => {
      assertActive(); assertCan('forms', 'settings');
      const f = db.forms.find((x) => x.id === formId);
      if (!f) throw new ApiError('not_found', 'Форма не найдена');
      const d = Array.isArray(def) ? { pages: null, fields: def } : def || {}, fields = d.fields || [];
      if (!fields.some((x) => x.type !== 'statement')) throw new ApiError('validation', 'В форме нет ни одного вопроса');
      const bad = fields.find((x) => !String(x.label || '').trim()); if (bad) throw new ApiError('validation', 'У вопроса нет текста');
      const noOpt = fields.find((x) => ['choice', 'multi', 'select'].includes(x.type) && !(x.options || []).some((o) => String(o.label || o).trim()));
      if (noOpt) throw new ApiError('validation', 'У вопроса «' + noOpt.label + '» нет вариантов ответа');
      if ((f.settings || {}).access === 'public') { const crm = fields.find((x) => ['person', 'unit', 'ref'].includes(x.type)); if (crm) throw new ApiError('validation', 'Публичная форма не может спрашивать «' + crm.label + '»: справочники CRM гостю не показываются'); }
      const ids = new Set(); for (const x of fields) { if (ids.has(x.id)) throw new ApiError('validation', 'Повторяется идентификатор вопроса ' + x.id); ids.add(x.id); }
      const prev = f.published ? f.versions.find((v) => v.v === f.published).fields : [], v = (f.published || 0) + 1;
      const next = clone(fields).map((x) => { const old = prev.find((o) => o.id === x.id); if (old && old.type !== x.type) x.id = x.id + '-v' + v; return x; });
      const me = db.members.find((m) => m.id === actor);
      f.versions.push({ v, at: '01.10.2026', by: me ? me.name : '—', fields: next, pages: d.pages ? clone(d.pages) : null });
      f.published = v; f.status = 'published'; f.updated = '01.10'; delete f.draft;
      event('Опубликована форма «' + f.name + '» v' + v + '. Старые ответы сохраняют свои версии', owners());
      return v;
    }, 500),
    // Черновик сохраняется на сервере без версии; ответы по нему не принимаются.
    saveFormDraft: (formId, def) => cmd(() => {
      assertCan('forms', 'settings');
      const f = db.forms.find((x) => x.id === formId); if (!f) throw new ApiError('not_found', 'Форма не найдена');
      f.draft = clone(def); f.updated = '01.10';
    }, 120),
    discardFormDraft: (formId) => cmd(() => {
      assertCan('forms', 'settings');
      const f = db.forms.find((x) => x.id === formId); if (!f) throw new ApiError('not_found', 'Форма не найдена');
      if (!f.published) throw new ApiError('validation', 'У формы ещё нет опубликованной версии');
      delete f.draft;
    }, 200),
    // Новая форма: из шаблона (template) или копией (def). Создаётся только черновик, версий и ответов нет до публикации v1.
    createForm: ({ name, template, unit, def, module, settings }) => cmd(() => {
      assertActive(); assertCan('forms', 'settings');
      const T = template ? (M.FORM_TEMPLATES || []).find((x) => x.id === template) : null;
      if (template && !T) throw new ApiError('validation', 'Шаблон не найден');
      if (T && T.module && !M.moduleOn(db, T.module)) throw new ApiError('validation', 'Модуль «' + M.INDUSTRY[T.module].name + '» не подключён: шаблон недоступен');
      const nm = String(name || '').trim();
      if (nm.length < 3) throw new ApiError('validation', 'Укажите название формы — не короче 3 символов');
      if (db.forms.some((x) => x.name.toLowerCase() === nm.toLowerCase())) throw new ApiError('validation', 'Форма «' + nm + '» уже есть — измените название');
      if (unit && unit !== 'org' && !(db.units || []).some((u) => u.id === unit)) throw new ApiError('validation', 'Область не найдена');
      const me = db.members.find((m) => m.id === actor), id = 'fm-' + db.seq++;
      db.forms.unshift({ id, name: nm, module: T ? T.module : module || null, unit: unit || 'org', template: T ? T.id : null, owner: me ? me.name : '—', status: 'draft', published: null, versions: [], automations: [], settings: { ...M.FORM_SETTINGS, ...((T && T.settings) || settings || {}) }, draft: def ? clone(def) : M.templateDef(T), updated: '01.10' });
      event('Создан черновик формы «' + nm + '»' + (T ? ' из шаблона «' + T.name + '»' : ''), owners());
      return id;
    }, 350),
    // Название, приём ответов, настройки, область и действия после ответа меняются без новой версии формы.
    updateForm: (formId, patch) => cmd(() => {
      assertActive(); assertCan('forms', 'settings');
      const f = db.forms.find((x) => x.id === formId); if (!f) throw new ApiError('not_found', 'Форма не найдена');
      if (patch.name != null) { const nm = String(patch.name).trim(); if (nm.length < 3) throw new ApiError('validation', 'Название формы — не короче 3 символов'); if (db.forms.some((x) => x.id !== f.id && x.name.toLowerCase() === nm.toLowerCase())) throw new ApiError('validation', 'Форма «' + nm + '» уже есть'); f.name = nm; }
      if (patch.status) { if (!f.published) throw new ApiError('validation', 'Форма ещё не опубликована'); if (!['closed', 'published'].includes(patch.status)) throw new ApiError('validation', 'Неизвестный статус формы'); f.status = patch.status; event((patch.status === 'closed' ? 'Закрыт приём ответов: «' : 'Возобновлён приём ответов: «') + f.name + '»', owners()); }
      if (patch.unit) { if (patch.unit !== 'org' && !(db.units || []).some((u) => u.id === patch.unit)) throw new ApiError('validation', 'Область не найдена'); f.unit = patch.unit; }
      if (patch.settings) {
        const s2 = { ...M.FORM_SETTINGS, ...(f.settings || {}), ...patch.settings };
        if (s2.access === 'public') { const cur = (f.draft && f.draft.fields) || (Array.isArray(f.draft) ? f.draft : null) || (f.published ? f.versions.find((v) => v.v === f.published).fields : []); const crm = cur.find((x) => ['person', 'unit', 'ref'].includes(x.type)); if (crm) throw new ApiError('validation', 'Публичный доступ невозможен: вопрос «' + crm.label + '» спрашивает данные CRM'); }
        if (s2.limit != null && !(Number(s2.limit) > 0)) throw new ApiError('validation', 'Лимит ответов — положительное число');
        f.settings = s2;
      }
      if (patch.automations) f.automations = clone(patch.automations);
      f.updated = '01.10';
    }, 250),

    // ── Задачи: статус меняется только разрешённым переходом ──
    moveTask: (taskId, to) => cmd(() => {
      assertCan('tasks', 'edit');
      const t = db.tasks.find((x) => x.id === taskId);
      const tp = (db.projects || []).find((x) => x.id === t.project); if (tp && tp.wf) throw new ApiError('transition', 'Статус меняется переходами процесса проекта «' + tp.name + '»');
      if (!(M.wfOf(db, t).flow[t.status] || []).includes(to)) throw new ApiError('transition', 'Переход «' + t.status + ' → ' + to + '» не предусмотрен процессом');
      if (to === 'Готово' && t.checklist.some((c) => !c.d)) throw new ApiError('validation', 'Нельзя завершить: в чек-листе есть невыполненные пункты');
      const from = t.status; t.status = to;
      t.comments.push({ by: 'Система', at: hhmm(), text: 'Статус: ' + from + ' → ' + to, system: true });
    }, 300),
    toggleTaskCheck: (taskId, i) => cmd(() => { assertCan('tasks', 'edit'); const t = db.tasks.find((x) => x.id === taskId); t.checklist[i].d = !t.checklist[i].d; }, 200),
    commentTask: (taskId, text) => cmd(() => {
      assertCan('tasks', 'view');
      if (!text.trim()) throw new ApiError('validation', 'Комментарий пустой');
      const m = db.members.find((x) => x.id === actor);
      db.tasks.find((x) => x.id === taskId).comments.push({ by: m ? m.name : '—', at: hhmm(), text: text.trim() });
    }, 250),
    createTask: ({ title, assignee, priority, due, project }) => cmd(() => {
      assertCan('tasks', 'create');
      if (!title?.trim()) throw new ApiError('validation', 'Укажите название задачи');
      const id = 'T-' + (70 + db.seq++);
      db.tasks.unshift({ id, title: title.trim(), assignee, status: 'Новая', priority, due: due ? due.split('-').reverse().slice(0, 2).join('.') : '—', project: project || (db.projects || [])[0]?.id || 'fleet', checklist: [], comments: [], links: [] });
      return id;
    }, 350),

    // ── Проекты задач (docs/21): доступ — роли с областью «проект», процесс с версиями, согласование, автоматизация ──
    createProject: ({ name, key, unit, access, process, copyFrom }) => cmd(() => {
      assertActive(); if (!M.can(db, actor, 'tasks', 'settings').ok) throw new ApiError('forbidden', 'Создавать проекты может роль с правом «Задачи · Настраивать»');
      const nm = String(name || '').trim(), k = String(key || '').trim().toUpperCase();
      if (nm.length < 3) throw new ApiError('validation', 'Название — не короче 3 символов');
      if (!/^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9]{1,5}$/.test(k)) throw new ApiError('validation', 'Ключ — 2–6 заглавных букв или цифр, первая — буква');
      if ((db.projects || []).some((p) => p.key === k)) throw new ApiError('validation', 'Ключ ' + k + ' уже занят');
      if (unit !== 'org' && !db.units.some((u) => u.id === unit)) throw new ApiError('validation', 'Выберите область проекта');
      const src = process === 'copy' ? (db.projects || []).find((p) => p.id === copyFrom && p.wf) : null;
      if (process === 'copy' && !src) throw new ApiError('validation', 'Выберите проект, процесс которого копировать');
      const me = db.members.find((x) => x.id === actor), id = 'pj-' + db.seq++;
      const wf = src ? clone(src.wf) : M.buildWf(process === 'approval' ? 'approval' : 'simple'); wf.v = 1; delete wf.draft;
      db.projects.push({ id, key: k, name: nm, unit: unit === 'org' ? null : unit, owner: me ? me.name : '—', access: ['open', 'limited', 'closed'].includes(access) ? access : 'limited', wf, automations: src ? clone(src.automations || []).map((r) => ({ ...r, on: false })) : [], runs: [] });
      db.assignments.push({ id: 'ap-' + db.seq++, member: actor, role: 'r-pm', scope: { type: 'project', id } });
      event('Создан проект «' + nm + '» (' + k + ')', owners());
      return id;
    }, 350),
    updateProject: (projectId, patch) => cmd(() => {
      const p = pj(projectId); assertPj(p, 'settings');
      if (patch.access) p.access = patch.access;
      if (patch.name != null) { const nm = String(patch.name).trim(); if (nm.length < 3) throw new ApiError('validation', 'Название — не короче 3 символов'); p.name = nm; }
    }, 250),
    setProjectRole: (projectId, memberId, roleId) => cmd(() => {
      const p = pj(projectId); assertPj(p, 'settings');
      const mm = db.members.find((x) => x.id === memberId); if (!mm) throw new ApiError('validation', 'Выберите сотрудника');
      if (mm.status === 'blocked') throw new ApiError('validation', mm.name + ' заблокирован — назначить роль нельзя');
      const i = db.assignments.findIndex((x) => x.member === memberId && x.scope?.type === 'project' && x.scope.id === p.id);
      if (!roleId) { if (i >= 0) db.assignments.splice(i, 1); event(mm.name + ' исключён из проекта «' + p.name + '»', owners()); return; }
      if (!M.PROJECT_ROLES.includes(roleId)) throw new ApiError('validation', 'В проекте назначаются роли проекта');
      if (i >= 0) db.assignments[i].role = roleId; else db.assignments.push({ id: 'ap-' + db.seq++, member: memberId, role: roleId, scope: { type: 'project', id: p.id } });
      event(mm.name + ': роль «' + db.roles.find((r) => r.id === roleId).name + '» в проекте «' + p.name + '»', owners());
    }, 250),
    initProjectWorkflow: (projectId) => cmd(() => { const p = pj(projectId); assertPj(p, 'settings'); p.wf = p.wf || M.buildWf('simple'); p.access = p.access || 'limited'; p.automations = p.automations || []; p.runs = p.runs || []; }, 250),
    saveWorkflowDraft: (projectId, wf) => cmd(() => { const p = pj(projectId); assertPj(p, 'settings'); p.wf.draft = wf ? clone(wf) : undefined; if (!wf) delete p.wf.draft; }, 200),
    publishWorkflow: (projectId) => cmd(() => {
      const p = pj(projectId); assertPj(p, 'settings'); const d = p.wf.draft; if (!d) throw new ApiError('validation', 'Изменений нет');
      const names = d.statuses.map((s) => s.name.trim().toLowerCase());
      if (names.some((x) => !x)) throw new ApiError('validation', 'У статуса нет названия');
      if (new Set(names).size !== names.length) throw new ApiError('validation', 'Названия статусов повторяются');
      if (!d.statuses.some((s) => s.cat === 'done')) throw new ApiError('validation', 'Нужен хотя бы один статус категории «Готово»');
      const ids = new Set(d.statuses.map((s) => s.id));
      const bad = d.transitions.find((t) => !t.name.trim() || !ids.has(t.to) || t.from.some((f) => f !== '*' && !ids.has(f)));
      if (bad) throw new ApiError('validation', 'Переход «' + (bad.name || 'без названия') + '» ссылается на удалённый статус или без названия');
      const used = new Set(db.tasks.filter((t) => t.project === p.id).map((t) => t.status)), gone = [...used].filter((n) => !d.statuses.some((s) => s.name === n));
      if (gone.length) throw new ApiError('validation', 'Есть задачи в статусах, которых нет в новой версии: ' + gone.join(', ') + '. Переведите их или верните статус');
      const v = p.wf.v + 1; p.wf = { ...clone(d), v };
      event('Опубликован процесс проекта «' + p.name + '» v' + v + '. Задачи остаются в своих статусах', owners());
      return v;
    }, 400),
    createProjectTask: ({ project, parent, title, description, labels, files, assignee, priority, due }) => cmd(() => {
      const p = pj(project); assertPj(p, 'create');
      if (String(title || '').trim().length < 3) throw new ApiError('validation', 'Тема — не короче 3 символов');
      if (String(description || '').length > 5000) throw new ApiError('validation', 'Описание — не длиннее 5000 символов');
      const fl = checkFiles(files || [], 0), par = parent ? checkParent(null, parent) : null;
      const me = db.members.find((x) => x.id === actor), first = p.wf.statuses.find((s) => s.cat === 'todo') || p.wf.statuses[0];
      const t = { id: p.key + '-' + (100 + db.seq++), title: String(title).trim(), description: String(description || '').trim(), labels: [...new Set((labels || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 10), assignee: assignee || (me ? me.name : '—'), author: me ? me.name : '—', authorId: actor, status: first.name, priority: priority || 'normal', due: due || '—', project: p.id, checklist: [], comments: [], links: [], files: fl.map((f) => ({ ...f, id: 'f-' + db.seq++, by: me ? me.name : '—', byId: actor, at: hhmm() })) };
      if (par) { t.parent = par.id; par.comments.push({ by: me ? me.name : '—', at: hhmm(), text: 'добавлена подзадача ' + t.id, system: true }); t.comments.push({ by: me ? me.name : '—', at: hhmm(), text: 'входит в ' + par.id, system: true }); }
      db.tasks.unshift(t); autoFire(p, t, 'created', null);
      return t.id;
    }, 300),
    runTransition: (taskId, trId, comment) => cmd(() => {
      const t = db.tasks.find((x) => x.id === taskId), p = pj(t.project), tr = p.wf.transitions.find((x) => x.id === trId);
      if (!tr) throw new ApiError('validation', 'Переход удалён из процесса');
      if (t.docRoute) throw new ApiError('transition', 'Статус задачи меняет маршрут документа «' + t.docRoute.title + '»: решения — в «Документах»');
      const c = M.trCheck(db, p, t, actor, tr); if (!c.ok) throw new ApiError('transition', c.why || 'Переход недоступен из текущего статуса');
      const txt = String(comment || '').trim(); if (tr.comment && !txt) throw new ApiError('validation', 'Для перехода «' + tr.name + '» нужен комментарий');
      const me = db.members.find((x) => x.id === actor);
      if (tr.approval) {
        t.approval = t.approval && t.approval.tr === tr.id ? t.approval : { tr: tr.id, votes: [] };
        t.approval.votes.push({ tr: tr.id, by: actor, name: me.name, at: hhmm() });
        const need = M.approversOf(db, p, t, tr).map((x) => x.id), got = new Set(t.approval.votes.map((v) => v.by));
        if (tr.approval.mode === 'all' && need.some((id) => !got.has(id))) { t.comments.push({ by: me.name, at: hhmm(), text: 'Согласовал(а)' + (txt ? ': ' + txt : '') + '. Ждём: ' + need.filter((id) => !got.has(id)).map((id) => db.members.find((x) => x.id === id).name).join(', '), system: true }); return { done: false }; }
      }
      moveTo(p, t, tr, me, txt); return { done: true };
    }, 300),
    rejectApproval: (taskId, trId, comment) => cmd(() => {
      const t = db.tasks.find((x) => x.id === taskId), p = pj(t.project), tr = p.wf.transitions.find((x) => x.id === trId);
      if (!tr || !tr.approval) throw new ApiError('validation', 'Согласование не найдено');
      if (t.docRoute) throw new ApiError('transition', 'Вернуть на доработку можно в «Документах»: задача следует за маршрутом «' + t.docRoute.title + '»');
      const c = M.trCheck(db, p, t, actor, tr); if (!c.ok && !/уже согласовали/.test(c.why || '')) throw new ApiError('transition', c.why || 'Недоступно');
      const txt = String(comment || '').trim(); if (!txt) throw new ApiError('validation', 'Напишите, что доработать');
      const back = p.wf.statuses.find((s) => s.id === tr.approval.rejectTo) || p.wf.statuses[0], me = db.members.find((x) => x.id === actor), from = t.status;
      t.status = back.name; t.approval = null;
      t.comments.push({ by: me.name, at: hhmm(), text: 'Вернул(а) на доработку (' + from + ' → ' + back.name + '): ' + txt, system: true });
      autoFire(p, t, 'status', back.id);
    }, 300),
    saveAutomation: (projectId, rule) => cmd(() => {
      const p = pj(projectId); assertPj(p, 'settings');
      if (!String(rule.name || '').trim()) throw new ApiError('validation', 'Назовите правило');
      if (rule.trigger === 'status' && !p.wf.statuses.some((s) => s.id === rule.to)) throw new ApiError('validation', 'Выберите статус для триггера');
      if (!rule.action || !String(rule.action.value || '').trim()) throw new ApiError('validation', 'Заполните действие');
      const me = db.members.find((x) => x.id === actor), i = p.automations.findIndex((x) => x.id === rule.id);
      const r = { ...clone(rule), id: rule.id || 'ar-' + db.seq++, by: me.name, byId: actor, version: i >= 0 ? (p.automations[i].version || 1) + 1 : 1, on: rule.on !== false };
      if (i >= 0) p.automations[i] = r; else p.automations.push(r);
      return r.id;
    }, 250),
    toggleAutomation: (projectId, ruleId, on) => cmd(() => { const p = pj(projectId); assertPj(p, 'settings'); const r = p.automations.find((x) => x.id === ruleId); r.on = !!on; }, 200),
    deleteAutomation: (projectId, ruleId) => cmd(() => { const p = pj(projectId); assertPj(p, 'settings'); p.automations = p.automations.filter((x) => x.id !== ruleId); }, 200),
    setTaskField: (taskId, patch) => cmd(() => {
      const t = db.tasks.find((x) => x.id === taskId), p = pj(t.project); assertPj(p, 'edit');
      if (patch.assignee != null) t.assignee = patch.assignee; if (patch.priority) t.priority = patch.priority;
      if (patch.check != null) t.checklist[patch.check].d = !t.checklist[patch.check].d;
      if (patch.description != null) { if (String(patch.description).length > 5000) throw new ApiError('validation', 'Описание — не длиннее 5000 символов'); t.description = String(patch.description).trim(); }
    }, 200),
    // Иерархия задач: «входит в» / «состоит из». Один родитель, до трёх уровней, без циклов, родитель — видимая незавершённая задача.
    setTaskParent: (taskId, parentId) => cmd(() => {
      const t = db.tasks.find((x) => x.id === taskId), p = pj(t.project); assertPj(p, 'edit');
      const me = db.members.find((x) => x.id === actor), old = t.parent, o = old && db.tasks.find((x) => x.id === old);
      if (!parentId) { if (!old) return; t.parent = null; t.comments.push({ by: me.name, at: hhmm(), text: 'больше не входит в ' + old, system: true }); if (o) o.comments.push({ by: me.name, at: hhmm(), text: 'из состава исключена ' + t.id, system: true }); return; }
      const par = checkParent(t, parentId);
      t.parent = par.id; t.comments.push({ by: me.name, at: hhmm(), text: 'входит в ' + par.id + (old ? ' (было ' + old + ')' : ''), system: true });
      par.comments.push({ by: me.name, at: hhmm(), text: 'добавлена подзадача ' + t.id, system: true });
      if (o) o.comments.push({ by: me.name, at: hhmm(), text: 'из состава исключена ' + t.id, system: true });
    }, 250),
    addTaskFiles: (taskId, files) => cmd(() => {
      const t = db.tasks.find((x) => x.id === taskId), p = pj(t.project); assertPj(p, 'edit');
      const fl = checkFiles(files || [], (t.files || []).length), me = db.members.find((x) => x.id === actor);
      t.files = [...(t.files || []), ...fl.map((f) => ({ ...f, id: 'f-' + db.seq++, by: me.name, byId: actor, at: hhmm() }))];
      t.comments.push({ by: me.name, at: hhmm(), text: 'прикрепил(а): ' + fl.map((f) => f.name).join(', '), system: true });
    }, 300),
    removeTaskFile: (taskId, fileId) => cmd(() => {
      const t = db.tasks.find((x) => x.id === taskId), p = pj(t.project), f = (t.files || []).find((x) => x.id === fileId);
      if (!f) throw new ApiError('not_found', 'Файл уже удалён');
      if (!(f.byId === actor && M.projCan(db, p, actor, 'edit').ok) && !M.projCan(db, p, actor, 'settings').ok) throw new ApiError('forbidden', 'Удалить можно свой файл; чужие — руководитель проекта');
      t.files = t.files.filter((x) => x.id !== fileId);
      t.comments.push({ by: db.members.find((x) => x.id === actor).name, at: hhmm(), text: 'удалил(а) файл ' + f.name, system: true });
    }, 250),

    // ── Календарь: атомарная проверка всех ресурсов с учётом подготовки и уборки ──
    moveBooking: (bookingId, start) => cmd(() => {
      const b = db.calendar.bookings.find((x) => x.id === bookingId);
      const dur = b.end - b.start;
      const cand = { ...b, start, end: start + dur };
      const clash = M.bookingConflicts(db.calendar.bookings, cand, db.calendar.resources);
      if (clash.length) {
        const slots = M.freeSlots(db.calendar.bookings, b, 3);
        throw new ApiError('conflict', 'Конфликт ресурсов: ' + clash.map((c) => c.resName + ' занят («' + c.title + '»)').join('; '), { slots });
      }
      b.start = start; b.end = start + dur;
    }, 400),

    // ── База знаний: новая версия с проверкой базовой версии ──
    saveKbPage: (pageId, body, baseVersion) => cmd(() => {
      assertCan('knowledge', 'create');
      const p = db.knowledge.pages.find((x) => x.id === pageId);
      const last = p.versions[p.versions.length - 1];
      if (last.v !== baseVersion) throw new ApiError('conflict', 'Страницу уже изменили (v' + last.v + '). Обновите и повторите правку.');
      if (!body.trim()) throw new ApiError('validation', 'Текст страницы пустой');
      const m = db.members.find((x) => x.id === actor);
      p.versions.push({ v: last.v + 1, at: '01.10.2026', by: m ? m.name : '—', body: body.trim() });
      return last.v + 1;
    }, 400),

    // ── База знаний: новая страница (из действия формы), при необходимости сразу с таблицей — одной командой ──
    createKbPage: (spaceId, spec) => cmd(() => {
      assertActive(); assertCan('knowledge', 'create');
      const K = db.knowledge, sp = (K.spaces || []).find((x) => x.id === spaceId);
      if (!sp) throw new ApiError('validation', 'Выберите раздел Базы знаний');
      const title = String((spec && spec.title) || '').trim();
      if (title.length < 3) throw new ApiError('validation', 'Название страницы — не короче 3 символов');
      if (K.pages.some((p) => p.space === spaceId && p.title.toLowerCase() === title.toLowerCase())) throw new ApiError('validation', 'В разделе «' + sp.name + '» уже есть страница «' + title + '»');
      const access = spec.access === 'owner' ? 'owner' : 'all';
      if (access === 'owner' && !M.grants(db, actor).some((g) => g.roleObj.all)) throw new ApiError('validation', 'Страницу «Только владелец» может создать только владелец');
      const body = String(spec.body || '').trim();
      if (!body) throw new ApiError('validation', 'Текст страницы пустой');
      let t = null;
      if (spec.table) {
        const tt = String(spec.table.title || '').trim(), cols = (spec.table.columns || []).map((c) => ({ name: String(c.name || '').trim(), type: c.type || 'text' }));
        if (tt.length < 2) throw new ApiError('validation', 'Название таблицы — не короче 2 символов');
        if (!cols.length) throw new ApiError('validation', 'Добавьте хотя бы один столбец');
        if (cols.some((c) => !c.name)) throw new ApiError('validation', 'У столбца нет названия');
        if (new Set(cols.map((c) => c.name.toLowerCase())).size !== cols.length) throw new ApiError('validation', 'Названия столбцов повторяются');
        t = { title: tt, cols };
      }
      const me = db.members.find((x) => x.id === actor), id = 'kb-' + db.seq++;
      K.pages.push({ id, space: spaceId, title, access, versions: [{ v: 1, at: new Date().toLocaleDateString('ru-RU'), by: me ? me.name : '—', body }] });
      let table = null;
      if (t) {
        const row = { id: 'kt-' + db.seq++, page: id, title: t.title, columns: t.cols.map((c) => ({ id: 'c-' + db.seq++, ...c })), rows: [] };
        (K.tables = K.tables || []).push(row);
        table = { id: row.id, columns: row.columns.map((c) => c.id) };
      }
      event('В разделе «' + sp.name + '» создана страница «' + title + '»' + (t ? ' с таблицей «' + t.title + '»' : ''), owners());
      return { id, table };
    }, 350),

    // ── База знаний ↔ формы: таблица на странице, перенос прошлых ответов, повтор действия ──
    createKbTable: (pageId, spec) => cmd(() => {
      assertActive(); assertCan('knowledge', 'create');
      const p = db.knowledge.pages.find((x) => x.id === pageId); if (!p) throw new ApiError('not_found', 'Страница не найдена');
      const title = String((spec && spec.title) || '').trim();
      if (title.length < 2) throw new ApiError('validation', 'Название таблицы — не короче 2 символов');
      const T = (db.knowledge.tables = db.knowledge.tables || []);
      if (T.some((t) => t.page === pageId && t.title.toLowerCase() === title.toLowerCase())) throw new ApiError('validation', 'На странице уже есть таблица «' + title + '»');
      const cols = ((spec && spec.columns) || []).map((c) => ({ id: 'c-' + db.seq++, name: String(c.name || '').trim(), type: c.type || 'text' }));
      if (!cols.length) throw new ApiError('validation', 'Добавьте хотя бы один столбец');
      if (cols.some((c) => !c.name)) throw new ApiError('validation', 'У столбца нет названия');
      if (new Set(cols.map((c) => c.name.toLowerCase())).size !== cols.length) throw new ApiError('validation', 'Названия столбцов повторяются');
      const t = { id: 'kt-' + db.seq++, page: pageId, title, columns: cols, rows: [] };
      T.push(t);
      event('На странице «' + p.title + '» создана таблица «' + title + '»', owners());
      return { id: t.id, columns: cols.map((c) => c.id) };
    }, 250),
    backfillKbRule: (formId, ruleId) => cmd(() => {
      assertActive(); assertCan('forms', 'settings');
      const f = db.forms.find((x) => x.id === formId); if (!f) throw new ApiError('not_found', 'Форма не найдена');
      const x = (f.automations || []).find((y) => y.id === ruleId && y.kind === 'kb'); if (!x) throw new ApiError('not_found', 'Действие не найдено');
      if (!x.on) throw new ApiError('validation', 'Действие выключено — включите его, чтобы перенести ответы');
      const out = { added: 0, failed: 0, err: null };
      const rno = (r) => Number(String(r.id).replace(/\D/g, '')) || 0;
      db.responses.filter((r) => r.formId === f.id && kbFits(x, r) && !(r.actions || []).some((y) => y.rule === x.id && y.ok)).sort((p, q) => rno(p) - rno(q)).forEach((r) => { const res = kbRun(f, r, x); if (res.ok) out.added++; else { out.failed++; out.err = res.err; } });
      return out;
    }, 450),
    retryFormAction: (respId, ruleId) => cmd(() => {
      assertActive(); assertCan('forms', 'settings');
      const r = db.responses.find((x) => x.id === respId); if (!r) throw new ApiError('not_found', 'Ответ не найден');
      const f = db.forms.find((x) => x.id === r.formId), x = f && (f.automations || []).find((y) => y.id === ruleId);
      if (!x) throw new ApiError('validation', 'Действие удалено из формы — повторить нельзя');
      const res = kbRun(f, r, x);
      if (!res.ok) throw new ApiError('validation', 'Не выполнено: ' + res.err);
      return res;
    }, 300),

    // ── SPA: завершение процедуры списывает материалы один раз ──
    completeAppointment: (apId) => cmd(() => {
      assertActive(); assertCan('spa', 'create');
      const ap = db.spa.appointments.find((x) => x.id === apId);
      if (ap.status !== 'confirmed') return 'duplicate';
      const short = [];
      ap.recipe.forEach(([id, q]) => {
        const s = db.spa.stock.find((x) => x.id === id);
        const take = Math.min(s.qty, q);
        if (take < q) short.push({ s, q, missing: q - take });
        if (take > 0) { s.qty -= take; db.spa.movements.unshift({ id: 'MV-' + db.seq++, at: hhmm(), item: s.name, qty: take, unit: s.unit, basis: ap.service + ' · ' + ap.client }); }
      });
      if (short.length) {
        ap.status = 'done_pending';
        short.forEach(({ s, q, missing }) => db.spa.issues.unshift({ id: 'IS-' + db.seq++, ap: ap.id, item: s.name, need: q, unit: s.unit, missing, text: 'Не хватило «' + s.name + '»: нужно ' + q + ' ' + s.unit + ', списано ' + (q - missing) + ' ' + s.unit + ' · ' + ap.service + ' (' + ap.client + ')', status: 'open' }));
        event('SPA: услуга выполнена, учёт материалов не завершён — нужно решение', owners());
        return 'shortage';
      }
      ap.status = 'done';
      return 'ok';
    }, 450),
    resolveIssue: (issueId, how) => cmd(() => {
      const is = db.spa.issues.find((x) => x.id === issueId);
      is.status = 'resolved'; is.how = how;
      const ap = db.spa.appointments.find((x) => x.id === is.ap);
      if (!db.spa.issues.some((x) => x.ap === ap.id && x.status === 'open')) ap.status = 'done';
    }, 300),


    // ── Ремонт: отметка прораба уходит на приёмку, факт меняется после принятия ──
    addWorkLog: ({ obj, work, volume, crew, material, materialQty, photos }) => cmd(() => {
      assertActive(); assertCan('repair', 'create');
      const w = db.repair.works.find((x) => x.id === work && (!obj || x.obj === obj));
      if (!w) throw new ApiError('validation', 'Выберите работу этого объекта');
      const o = db.repair.objects.find((x) => x.id === w.obj), me = db.members.find((m) => m.id === actor);
      if (!o || !me || o.foreman !== me.name) throw new ApiError('no_scope', 'Отметку по объекту отправляет его прораб');
      if (o.stage === 'Сдан') throw new ApiError('conflict', 'Объект сдан: новые отметки не принимаются');
      const v = Number(String(volume).replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) throw new ApiError('validation', 'Объём должен быть больше нуля');
      if (w.fact + v > w.plan * 1.1) throw new ApiError('validation', 'Объём превышает план более чем на 10%: осталось ' + M.num(w.plan - w.fact) + ' ' + w.unit);
      if (!crew.length) throw new ApiError('validation', 'Отметьте работников');
      if (!photos) throw new ApiError('validation', 'Добавьте хотя бы одно фото');
      const id = 'WL-' + (10 + db.seq++);
      db.repair.logs.unshift({ id, obj: o.id, at: hhmm(), work, volume: v, crew, materials: material && Number(materialQty) > 0 ? [[material, Number(materialQty)]] : [], photos, status: 'На проверке', by: me.name });
      event('Прораб отметил «' + w.name + '» · ' + o.name + ': ' + M.num(v) + ' ' + w.unit + ' — нужна приёмка', owners());
      return id;
    }, 450),
    acceptWorkLog: (logId) => cmd(() => {
      assertCan('repair', 'review');
      const l = db.repair.logs.find((x) => x.id === logId);
      if (l.status !== 'На проверке') throw new ApiError('conflict', 'Отметка уже обработана');
      l.status = 'Принят';
      db.repair.works.find((x) => x.id === l.work).fact += l.volume;
      l.materials.forEach(([id, q]) => { const mt = db.repair.materials.find((x) => x.id === id); if (mt) mt.qty = Math.max(0, mt.qty - q); });
    }, 350),
    assignForeman: (objId, memberId) => cmd(() => {
      assertActive(); assertCan('repair', 'edit');
      const o = db.repair.objects.find((x) => x.id === objId);
      if (!o) throw new ApiError('not_found', 'Объект не найден');
      if (o.foreman) throw new ApiError('conflict', 'Прораб уже назначен: ' + o.foreman);
      const m = db.members.find((x) => x.id === memberId && x.status === 'active');
      if (!m) throw new ApiError('validation', 'Сотрудник не найден или не активен');
      o.foreman = m.name;
      event('Вы назначены прорабом объекта «' + o.name + '»', [m.id]);
    }, 400),
    // Допработа: прораб описывает работу без цен. Цены и допсоглашение делает офис в смете.
    proposeChange: ({ obj, title, volume, unit, note, photos }) => cmd(() => {
      assertActive(); assertCan('repair', 'create');
      const o = db.repair.objects.find((x) => x.id === obj), me = db.members.find((m) => m.id === actor);
      if (!o) throw new ApiError('not_found', 'Объект не найден');
      if (!me || o.foreman !== me.name) throw new ApiError('no_scope', 'Допработу по объекту предлагает его прораб');
      if (o.draft) throw new ApiError('conflict', 'До договора допработ нет: правки вносятся новой версией сметы');
      if (o.stage === 'Сдан') throw new ApiError('conflict', 'Объект сдан: допработы по нему не принимаются');
      const t = String(title || '').trim(), v = Number(String(volume == null ? '' : volume).replace(',', '.'));
      if (t.length < 3) throw new ApiError('validation', 'Опишите, что нужно сделать');
      if (!(v > 0)) throw new ApiError('validation', 'Укажите объём больше нуля');
      if (!(photos > 0)) throw new ApiError('validation', 'Приложите хотя бы одно фото');
      db.repair.changes = db.repair.changes || [];
      const id = 'ДР-' + (db.repair.changes.length + 1);
      db.repair.changes.unshift({ id, obj, at: hhmm(), by: me.name, title: t, volume: v, unit: unit || 'шт', note: String(note || '').trim(), photos, status: 'proposed' });
      event('Прораб предложил допработу «' + t + '» · ' + o.name + ' — нужна оценка', owners());
    }, 350),
    // Статус допработы меняет офис из сметы: priced → sent → signed, либо rejected с причиной.
    setChange: (ids, status, extra = {}) => cmd(() => {
      assertActive(); assertCan('repair', 'edit');
      if (!['proposed', 'priced', 'sent', 'signed', 'rejected'].includes(status)) throw new ApiError('validation', 'Неизвестный статус допработы');
      const list = (db.repair.changes || []).filter((c) => (ids || []).includes(c.id));
      if (!list.length) throw new ApiError('not_found', 'Допработа не найдена');
      const fin = list.find((c) => ['signed', 'rejected'].includes(c.status) && c.status !== status);
      if (fin) throw new ApiError('conflict', 'Допработа ' + fin.id + ' уже ' + (fin.status === 'signed' ? 'подписана' : 'отклонена'));
      list.forEach((c) => {
        if (c.status === status) return;
        const o = db.repair.objects.find((x) => x.id === c.obj) || {}, fm = db.members.filter((m) => m.name === o.foreman).map((m) => m.id);
        c.status = status;
        if (extra.agreement) c.agreement = extra.agreement;
        if (status === 'rejected') { c.reason = extra.reason || 'Без причины'; event('Допработа ' + c.id + ' «' + c.title + '» отклонена: ' + c.reason, fm); }
        if (status === 'signed') {
          db.repair.works.push({ id: 'w-' + c.id, obj: c.obj, name: c.title, unit: c.unit, plan: c.volume, fact: 0 });
          event('Допсоглашение' + (c.agreement ? ' № ' + c.agreement : '') + ' подписано: «' + c.title + '» добавлена в работы · ' + o.name, fm);
        }
      });
    }, 300),

    // ── Файлы: резерв → загрузка → проверка → готов. Прогресс сообщается колбэком. ──
    async upload({ name, bytes = 3.2e6 }, onProgress) {
      if (!flags.online) throw new ApiError('offline', 'Нет связи. Фото сохранено на устройстве и будет отправлено позже.');
      const t = tenant();
      const started = db.trips.some((x) => ['inspection', 'on_route', 'returning', 'rework'].includes(x.status));
      if (t.usedGb >= t.quotaGb && !started) throw new ApiError('quota_exceeded', 'Место организации заполнено. Загрузка новых файлов недоступна.');
      const fail = flags.failUploadNext; flags.failUploadNext = false;
      for (let p = 8; p <= 100; p += 14 + Math.round(Math.random() * 8)) {
        await wait(110);
        if (!flags.online) throw new ApiError('offline', 'Связь прервалась во время загрузки.');
        if (fail && p > 55) throw new ApiError('upload_failed', 'Загрузка прервалась. Повторите попытку.');
        onProgress && onProgress(Math.min(p, 96));
      }
      await wait(160);
      t.usedGb = Math.round((t.usedGb + bytes / 1e9) * 1000) / 1000;
      onProgress && onProgress(100);
      return { fileId: 'file-' + db.seq++, state: 'ready', name };
    },
  };
}

// Заготовка адаптера Go API. Методы повторяют интерфейс mock-адаптера.
export function createHttpAdapter({ baseUrl = '/api/v1', tenantId, getToken }) {
  const req = async (method, path, body, { ifMatch, idem } = {}) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await getToken()), ...(ifMatch ? { 'If-Match': ifMatch } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) { const p = await res.json().catch(() => ({})); throw new ApiError(p.code || String(res.status), p.detail || p.title || res.statusText, { status: res.status }); }
    return res.status === 204 ? null : res.json();
  };
  const T = '/tenants/' + tenantId;
  return {
    kind: 'http',
    load: () => req('GET', '/me/context'),
    extendTrial: (id, days) => req('PATCH', '/platform/tenants/' + id + '/subscription', { trialExtendDays: days }),
    setTenantQuota: (id, gb) => req('PATCH', '/platform/tenants/' + id + '/subscription', { storageQuotaGb: gb }),
    setTenantStatus: (id, status) => req('PATCH', '/platform/tenants/' + id, { status }),
    // PROPOSED: нет в OpenAPI 0.1, см. docs/17-users-and-billing.md
    revokeInvite: (id) => req('DELETE', T + '/invitations/' + id),
    requestSeats: (b) => req('POST', T + '/subscription/change-requests', b),
    cancelSeatRequest: (id) => req('POST', T + '/subscription/change-requests/' + id + '/cancel'),
    decideSeatRequest: (id, approve, note) => req('POST', '/platform/subscription-requests/' + id + '/decision', { approve, note }),
    publishPriceBook: (b) => req('POST', '/platform/price-book/versions', b),
    cancelScheduledPriceBook: () => req('DELETE', '/platform/price-book/versions/scheduled'),
    setAccountLock: (id, locked, reason) => req('PATCH', '/platform/accounts/' + id, { locked, reason }),
    resetMfa: (id) => req('POST', '/platform/accounts/' + id + '/mfa-reset'),
    inviteOperator: (b) => req('POST', '/platform/operators', b),
    setOperatorRole: (id, role) => req('PATCH', '/platform/operators/' + id, { role }),
    setOperatorStatus: (id, active) => req('PATCH', '/platform/operators/' + id, { active }),
    setModule: (key, enabled) => req('PATCH', T + '/modules/' + key, { enabled }),
    saveBranding: (b) => req('PUT', T + '/branding', b),
    setStorageQuota: (gb) => req('POST', T + '/storage/changes', { quotaGb: gb, mode: 'apply' }),
    invite: (b) => req('POST', T + '/invitations', b),
    assign: (b) => req('POST', T + '/assignments', b),
    unassign: (id) => req('DELETE', T + '/assignments/' + id),
    createRole: (b) => req('POST', T + '/roles', b),
    saveRole: (r) => req('PATCH', T + '/roles/' + r.id, r, { ifMatch: r.etag }),
    reserve: (tripId, vehicleId) => req('POST', T + '/fleet/reservations', { tripId, vehicleId }),
    cancelReservation: (tripId) => req('PATCH', T + '/fleet/reservations/' + tripId, { status: 'cancelled' }),
    assignVehicle: (tripId, vehicleId) => req('PATCH', T + '/fleet/trips/' + tripId, { vehicleId }),
    submitDeparture: (tripId, p) => req('POST', T + '/fleet/inspections', { tripId, kind: 'departure', ...p }, { idem: p.opId }),
    decideDefect: (tripId, decision) => req('POST', T + '/fleet/trips/' + tripId + '/defect-decision', { decision }), // PROPOSED
    addExpense: (tripId, e) => req('POST', T + '/fleet/trips/' + tripId + '/expenses', e, { idem: e.opId }),
    finishRoute: (tripId) => req('PATCH', T + '/fleet/trips/' + tripId, { status: 'returning' }),
    submitReturn: (tripId, p) => req('POST', T + '/fleet/inspections', { tripId, kind: 'return', ...p }, { idem: p.opId }),
    reviewTrip: (tripId, b) => req('POST', T + '/fleet/trips/' + tripId + '/review', b),
    requestDriver: (b) => req('POST', T + '/fleet/driver-transfer-requests', b),
    decideRequest: (id, approve) => req('POST', T + '/fleet/driver-transfer-requests/' + id + '/decision', { approve }),
    async upload(file, onProgress) {
      const s = await req('POST', T + '/files/uploads', { name: file.name, size: file.bytes });
      onProgress && onProgress(50); // реальный прогресс — через XHR/PUT по выданной ссылке
      return req('POST', T + '/files/uploads/' + s.id + '/complete', {});
    },
  };
}
