// Сервисный слой. UI работает только с интерфейсом адаптера, а не с хранилищем.
// createMockAdapter — локальный «сервер» для прототипа (имитирует задержку, 409, офлайн, права).
// createHttpAdapter — заготовка для Go API по ortus-openapi-v0.1.yaml; пути с пометкой PROPOSED отсутствуют в контракте.
import { seed, seedLotos, BRAND_DEFAULT } from './mock-data.js';
import * as M from './models.js';

export class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const hhmm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function createMockAdapter() {
  let db = seed();
  // Каждая организация — своя «БД»; platform — один общий объект (control DB).
  const dbs = { [db.tenantId]: db };
  { const l = seedLotos(db.platform); l.platform = db.platform; dbs[l.tenantId] = l; }
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
    const rule = f.automations.find((a) => a.on);
    if (rule) db.tasks.unshift({ id: 'T-' + (60 + db.seq++), title: 'Проверить осмотр ' + t.id + (kind === 'dep' ? ' (выезд)' : ' (сдача)'), assignee: 'Марина Котова', status: 'Новая', source: id, rule: rule.id + ' · v' + rule.version, priority: d && d.critical ? 'urgent' : 'normal', due: '01.10', project: 'fleet', checklist: [{ t: 'Сверить фото с прошлым осмотром', d: false }, { t: 'Проверить пробег', d: false }], comments: [], links: [{ kind: 'response', id, label: 'Ответ ' + id }, { kind: 'trip', id: t.id, label: 'Рейс ' + t.id }] });
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
    const projVisible = (p) => M.grants(db, actor).some((g) => g.roleObj.all || ((g.roleObj.actions?.tasks || []).length && M.scopeCovers(db, g.scope, p.unit)));
    out.projects = (out.projects || []).filter(projVisible);
    const pids = new Set(out.projects.map((p) => p.id));
    out.tasks = (out.tasks || []).filter((t) => pids.has(t.project) || (me && t.assignee === me.name));
    const seesLog = M.can({ ...db, modules: { ...db.modules, logistics: { enabled: true } } }, actor, 'logistics', 'view', 'f-msk-sever').ok;
    out.responses = (out.responses || []).filter((r) => seesLog || (me && r.author === me.name));
    if (out.knowledge) out.knowledge.pages = out.knowledge.pages.filter((p) => p.access === 'all' || isOwner);
    if (!M.can(db, actor, 'cash', 'view').ok) out.cash = { accounts: [], ops: [], hidden: true };
    if (!isOwner) out.calendar.bookings = out.calendar.bookings.filter((b) => !b.source || b.source.kind !== 'vehicle' || seesFleet('f-msk-sever'));
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

    // ── Формы: черновик → новая неизменяемая версия ──
    publishForm: (formId, fields) => cmd(() => {
      assertCan('forms', 'settings');
      const f = db.forms.find((x) => x.id === formId);
      if (!fields.length) throw new ApiError('validation', 'В форме нет ни одного поля');
      const bad = fields.find((x) => !x.label.trim()); if (bad) throw new ApiError('validation', 'У поля нет подписи');
      const prev = f.published ? f.versions.find((v) => v.v === f.published).fields : [];
      const next = clone(fields).map((x) => { const old = prev.find((o) => o.id === x.id); if (old && old.type !== x.type) x.id = x.id + '-v' + ((f.published || 0) + 1); delete x.changed; return x; });
      const v = (f.published || 0) + 1;
      f.versions.push({ v, at: '01.10.2026', by: 'Дарья Зимина', fields: next });
      f.published = v; f.status = 'published'; delete f.draft;
      event('Опубликована форма «' + f.name + '» v' + v + '. Старые ответы сохраняют свои версии', owners());
      return v;
    }, 500),

    // ── Задачи: статус меняется только разрешённым переходом ──
    moveTask: (taskId, to) => cmd(() => {
      assertCan('tasks', 'edit');
      const t = db.tasks.find((x) => x.id === taskId);
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

    // ── Касса: исправление — сторно, а не удаление ──
    addCashOp: ({ account, type, amount, basis, src }) => cmd(() => {
      assertActive(); assertCan('cash', 'create');
      const a = Number(String(amount).replace(',', '.'));
      if (!Number.isFinite(a) || a <= 0) throw new ApiError('validation', 'Сумма должна быть больше нуля');
      if (!basis?.trim()) throw new ApiError('validation', 'Укажите основание операции');
      const m = db.members.find((x) => x.id === actor);
      const id = 'K-' + (300 + db.seq++);
      db.cash.ops.unshift({ id, account, type, amount: a, basis: basis.trim(), at: '01.10', by: m ? m.name : '—', src: src || null });
      return id;
    }, 350),
    reverseCashOp: (opId, reason) => cmd(() => {
      assertCan('cash', 'create');
      if (!reason?.trim()) throw new ApiError('validation', 'Укажите причину исправления');
      const o = db.cash.ops.find((x) => x.id === opId);
      if (o.reversedBy || o.reverses) throw new ApiError('conflict', 'Операция уже исправлена');
      const m = db.members.find((x) => x.id === actor);
      const id = 'K-' + (300 + db.seq++);
      db.cash.ops.unshift({ id, account: o.account, type: 'storno', amount: o.amount, basis: 'Сторно ' + o.id + ': ' + reason.trim(), at: '01.10', by: m ? m.name : '—', reverses: o.id, sign: o.type === 'in' ? -1 : 1 });
      o.reversedBy = id;
    }, 350),

    // ── Ремонт: отметка прораба уходит на приёмку, факт меняется после принятия ──
    addWorkLog: ({ work, volume, crew, material, materialQty, photos }) => cmd(() => {
      assertActive(); assertCan('repair', 'create');
      const w = db.repair.works.find((x) => x.id === work);
      const v = Number(String(volume).replace(',', '.'));
      if (!Number.isFinite(v) || v <= 0) throw new ApiError('validation', 'Объём должен быть больше нуля');
      if (w.fact + v > w.plan * 1.1) throw new ApiError('validation', 'Объём превышает план более чем на 10%: осталось ' + M.num(w.plan - w.fact) + ' ' + w.unit);
      if (!crew.length) throw new ApiError('validation', 'Отметьте работников');
      if (!photos) throw new ApiError('validation', 'Добавьте хотя бы одно фото');
      const id = 'WL-' + (10 + db.seq++);
      db.repair.logs.unshift({ id, at: hhmm(), work, volume: v, crew, materials: material && Number(materialQty) > 0 ? [[material, Number(materialQty)]] : [], photos, status: 'На проверке', by: 'Алексей Соколов' });
      event('Прораб отметил «' + w.name + '»: ' + M.num(v) + ' ' + w.unit + ' — нужна приёмка', owners());
      return id;
    }, 450),
    acceptWorkLog: (logId) => cmd(() => {
      assertCan('repair', 'review');
      const l = db.repair.logs.find((x) => x.id === logId);
      if (l.status !== 'На проверке') throw new ApiError('conflict', 'Отметка уже обработана');
      l.status = 'Принят';
      db.repair.works.find((x) => x.id === l.work).fact += l.volume;
      l.materials.forEach(([id, q]) => { const mt = db.repair.materials.find((x) => x.id === id); mt.qty = Math.max(0, mt.qty - q); });
    }, 350),

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
