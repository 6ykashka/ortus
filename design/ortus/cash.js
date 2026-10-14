// Касса (docs/26-cash.md): кассы и счета подразделений, смены со сверкой, предложения модулей, подотчёт и согласование.
// Доступ — из «Пользователей и ролей»: модуль «Касса» в роли (view · create · edit · review · settings) и параметры роли role.cash:
//   balance — видеть остаток и ожидаемую сумму; self — только свой подотчёт; out · refund · advance — суммы без согласования (null — без лимита).
// Область назначения: организация, регион, фирма или конкретная касса ({ type: 'account', id }). Подотчёт виден держателю.
// Деньги двигает человек: предложение модуля не меняет остаток, пока его не провели. Ничего не удаляется — ошибку исправляет сторно.
// ККТ не подключены: оплата вносится вручную с № ФД, при закрытии смены Ортус сверяет записи с Z-отчётом, пересчётом и терминалом.

export const CASH_DAY = '01.10';
const clone = (o) => JSON.parse(JSON.stringify(o));
const hhmm = () => new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const mem = (db, id) => (db.members || []).find((m) => m.id === id);
export const nameOf = (db, id) => (mem(db, id) || {}).name || '—';
export const rub = (n) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '\u00a0₽';
export const signRub = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + rub(Math.abs(n));
export const plural = (n, a, b, c) => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);
const dnum = (d) => { const [dd, mm] = String(d || '').split('.').map(Number); return (mm || 0) * 100 + (dd || 0); };
export const dueState = (due) => (!due ? 'none' : dnum(due) < dnum(CASH_DAY) ? 'late' : dnum(due) === dnum(CASH_DAY) ? 'today' : 'ok');

export const KIND = {
  drawer: { label: 'Наличная касса', icon: 'point_of_sale', hint: 'денежный ящик точки: смены, пересчёт, сдача выручки' },
  acquiring: { label: 'Терминал и СБП', icon: 'contactless', hint: 'оплаты картой и по QR до зачисления на счёт' },
  advance: { label: 'Подотчёт сотрудника', icon: 'badge', hint: 'деньги на руках у водителя или прораба, отчёт чеками' },
  safe: { label: 'Сейф', icon: 'lock', hint: 'принимает выручку касс' },
  bank: { label: 'Банковский счёт', icon: 'account_balance', hint: 'остаток по выписке; импорт выписки — во второй версии' },
};
export const MODE = { none: 'Без смен', open: 'С ожидаемой суммой', blind: 'Вслепую' };
export const KKT = { none: 'Нет', manual: 'Есть · вношу вручную' };
export const OP = {
  in: { label: 'Приход', tone: 'ok', icon: 'south_west', sign: 1 },
  out: { label: 'Расход', tone: 'neutral', icon: 'north_east', sign: -1 },
  refund: { label: 'Возврат', tone: 'warn', icon: 'undo', sign: -1 },
  move_out: { label: 'Перемещение', tone: 'info', icon: 'call_made', sign: -1 },
  move_in: { label: 'Перемещение', tone: 'info', icon: 'call_received', sign: 1 },
  opening: { label: 'Ввод остатка', tone: 'neutral', icon: 'input', sign: 1 },
  adjust: { label: 'Корректировка', tone: 'warn', icon: 'tune', sign: 0 },
  storno: { label: 'Сторно', tone: 'danger', icon: 'history', sign: 0 },
};
export const REQ_LABEL = { out: 'Расход', refund: 'Возврат', issue: 'Выдача под отчёт' };
export const METHOD = { cash: { label: 'Наличные', icon: 'payments' }, card: { label: 'Карта', icon: 'credit_card' }, sbp: { label: 'СБП', icon: 'qr_code_2' }, transfer: { label: 'Безналичный', icon: 'account_balance' } };
export const METHODS_OF = { drawer: ['cash'], safe: ['cash'], advance: ['cash'], acquiring: ['card', 'sbp'], bank: ['transfer'] };
export const CATS = {
  in: ['Выручка · услуги SPA', 'Выручка · абонементы и сертификаты', 'Оплата заказчика', 'Прочий приход'],
  out: ['Топливо', 'Мойка', 'Парковка', 'Мелкий ремонт', 'Материалы', 'Инструмент', 'Хозяйственные расходы', 'Комиссии банка', 'Выплаты бригаде', 'Прочий расход'],
  refund: ['Возврат клиенту'],
};
export const DENOMS = [5000, 2000, 1000, 500, 200, 100, 50];
export const PRICE = { 'Классический массаж': 3200, 'SPA-ритуал': 5400, 'Массаж спины': 2400 };
export const CASH_OPT0 = { balance: false, self: false, out: null, refund: null, advance: null };
export const VERB_TEXT = { view: 'видит операции', create: 'вносит и проводит, ведёт смены', edit: 'возвраты, перемещения, подотчёт', review: 'согласует, сверяет, сторнирует', settings: 'настраивает кассы' };
const ALLV = ['view', 'create', 'edit', 'review', 'export', 'settings'];
const UNIT_X = { spa: 'Салон SPA' };
export const unitTitle = (db, id) => (!id ? 'Вся организация' : UNIT_X[id] || ((db.units || []).find((u) => u.id === id) || {}).name || id);
export const opSign = (o) => (OP[o.type] && OP[o.type].sign) || o.sign || 0;
export const balanceOf = (X, id) => Math.round(X.ops.filter((o) => o.account === id).reduce((s, o) => s + opSign(o) * o.amount, 0) * 100) / 100;
export const openShift = (X, id) => (X.shifts || []).find((h) => h.account === id && h.status === 'open') || null;
export const parseSum = (v) => { const s = String(v == null ? '' : v).replace(/[\s\u00a0₽]/g, '').replace(',', '.'); if (s === '') return NaN; const n = Number(s); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
export const drawerFor = (X, unit) => X.accounts.find((a) => a.kind === 'drawer' && a.unit === unit && !a.archived) || null;

// ── Доступ ──
const optOf = (g) => ({ ...CASH_OPT0, ...(g.roleObj.cash || {}) });
/** Доступ сотрудника к кассе: роль с модулем «Касса» → область, покрывающая кассу → параметры роли. */
export function cashAccess(db, M, mid, a) {
  const m = mem(db, mid);
  if (!m) return { ok: false, why: 'нет в организации' };
  if (m.status === 'blocked') return { ok: false, why: 'сотрудник заблокирован' };
  const gs = M.grants(db, mid), own = a.kind === 'advance' && a.member === mid;
  if (gs.some((g) => g.roleObj.all)) return { ok: true, all: true, own, verbs: ALLV, opt: { ...CASH_OPT0, balance: true }, via: 'Владелец бизнеса · вся организация' };
  const cg = gs.filter((g) => (g.roleObj.actions?.cash || []).length);
  if (!cg.length) return { ok: false, why: 'в ролях нет модуля «Касса»' };
  const cover = cg.filter((g) => {
    if (optOf(g).self) return own;
    const sc = g.scope || {};
    if (sc.type === 'account') return sc.id === a.id || (a.kind === 'acquiring' && a.drawer === sc.id);
    return a.unit ? M.scopeCovers(db, sc, a.unit) : sc.type === 'tenant';
  });
  if (!cover.length) return { ok: false, why: cg.every((g) => optOf(g).self) ? 'роль даёт только свой подотчёт' : 'касса вне области назначения' };
  const opts = cover.map(optOf);
  const lim = (k) => (opts.some((o) => o[k] == null) ? null : Math.max(...opts.map((o) => o[k])));
  return { ok: true, all: false, own, verbs: [...new Set(cover.flatMap((g) => g.roleObj.actions.cash))],
    opt: { balance: own || opts.some((o) => o.balance), self: opts.every((o) => o.self), out: lim('out'), refund: lim('refund'), advance: lim('advance') },
    via: cover.map((g) => g.roleObj.name + ' · ' + M.scopeLabel(db, g.scope)).join('; ') };
}
export const accCan = (r, v) => !!(r && r.ok && (r.all || r.verbs.includes(v)));
const limText = (v, label) => (v == null ? '' : v === 0 ? label + ' — с согласованием' : label + ' до ' + rub(v));
export function rightsText(r) {
  if (!r.ok) return 'Нет доступа: ' + r.why;
  if (r.all) return 'Всё, включая остаток и сверку';
  if (r.opt.self) return 'Свой подотчёт: остаток и отчёт чеками';
  const v = r.verbs.filter((x) => VERB_TEXT[x]).map((x) => VERB_TEXT[x]).join(', ');
  return [v, r.opt.balance ? 'видит остаток' : 'остаток скрыт', limText(r.opt.out, 'расход'), r.verbs.includes('edit') ? limText(r.opt.refund, 'возврат') : ''].filter(Boolean).join(' · ');
}
/** Кто и как получит доступ к кассе — для мастера «Новая касса» и вкладки «Настройки». */
export function cashPeople(db, M, a) {
  return (db.members || []).filter((m) => m.status !== 'blocked').map((m) => { const r = cashAccess(db, M, m.id, a); return { id: m.id, name: m.name, title: m.title || '', invited: m.status === 'invited', ok: r.ok, text: rightsText(r) }; })
    .sort((x, y) => Number(y.ok) - Number(x.ok));
}
function canAcceptTr(db, M, actor, X, t) {
  const to = X.accounts.find((a) => a.id === t.to); if (!to) return false;
  if (to.kind === 'advance') return to.member === actor;
  return accCan(cashAccess(db, M, actor, to), 'edit');
}

// ── Предложения модулей: визит, принятый расход смены, обращение, акт, начисление ──
export function cashProposals(db, M, actor) {
  const X = db.cash; if (!X || !X.v1) return [];
  const done = new Set([...X.ops.filter((o) => o.src && o.src.key && !o.reversedBy).map((o) => o.src.key), ...(X.requests || []).filter((q) => q.status === 'pending' && q.src && q.src.key).map((q) => q.src.key), ...(X.dismissed || []).map((d) => d.key)]);
  const list = (X.proposals || []).map((p) => ({ ...p, key: p.id }));
  (db.trips || []).filter((t) => t.status === 'accepted').forEach((t) => (t.expenses || []).forEach((e) => {
    const a = drawerFor(X, t.unit); if (!a) return;
    const cat = ((M.EXPENSE_CAT || {})[e.category] || {}).label || 'Прочий расход';
    list.push({ id: 'tx:' + e.id, key: 'tx:' + e.id, mod: 'logistics', kind: 'out', amount: e.amount, account: a.id, method: 'cash', cat, seller: true,
      title: 'Возместить · ' + (t.driverName || 'водитель'), sub: 'Рейс ' + t.id + ' · ' + cat.toLowerCase() + ' · расход принят в приёмке смены', src: { kind: 'trip', id: t.id, label: 'Рейс ' + t.id, nav: 'review' } });
  }));
  ((db.spa && db.spa.appointments) || []).filter((ap) => ['done', 'done_pending'].includes(ap.status)).forEach((ap) => {
    const a = drawerFor(X, 'spa'); if (!a) return;
    list.push({ id: 'ap:' + ap.id, key: 'ap:' + ap.id, mod: 'spa', kind: 'in', amount: PRICE[ap.service] || 3000, account: a.id, cat: 'Выручка · услуги SPA',
      title: ap.client + ' · ' + ap.service, sub: 'Визит сегодня ' + ap.time + ' · ' + ap.room, src: { kind: 'spa', id: ap.id, label: 'Визит ' + ap.time, nav: 'spa' } });
  });
  return list.filter((p) => !done.has(p.key) && (!p.mod || M.moduleOn(db, p.mod)) && (!p.fin || M.canEarnings(db, actor).ok)).filter((p) => {
    const a = X.accounts.find((x) => x.id === p.account); if (!a) return false;
    const r = cashAccess(db, M, actor, a);
    return r.ok && !r.opt.self && accCan(r, p.kind === 'refund' ? 'edit' : 'create');
  });
}

// ── Ответ сервера участнику: кассы его области, остаток — только с правом ──
export function cashView(db, M, actor, C) {
  const X = db.cash;
  if (!C || !X || !X.v1) return C;
  const R = {}; X.accounts.forEach((a) => { R[a.id] = cashAccess(db, M, actor, a); });
  const vis = X.accounts.filter((a) => R[a.id].ok);
  if (!vis.length) return { v1: true, hidden: true, accounts: [], ops: [], shifts: [], transfers: [], receipts: [], requests: [], proposals: [], todo: [], badge: 0, canSettings: false };
  const ids = new Set(vis.map((a) => a.id)), nm = (id) => nameOf(db, id), accName = (id) => (X.accounts.find((a) => a.id === id) || {}).name || '—';
  const can = (id, v) => accCan(R[id], v), bal = (id) => !!(R[id] && R[id].ok && R[id].opt.balance);
  const accounts = vis.map((a) => { const r = R[a.id], sh = openShift(X, a.id);
    return { ...clone(a), balance: bal(a.id) ? balanceOf(X, a.id) : null, shift: sh ? sh.id : null, respName: a.resp ? nm(a.resp) : '', memberName: a.member ? nm(a.member) : '',
      my: { all: !!r.all, own: !!r.own, verbs: r.verbs, opt: r.opt, via: r.via, rights: rightsText(r) } }; });
  const ops = X.ops.filter((o) => ids.has(o.account)).map((o) => ({ ...clone(o), byName: nm(o.by), approvedName: o.approvedBy ? nm(o.approvedBy) : '',
    canReverse: can(o.account, 'review') && !o.reversedBy && o.type !== 'storno' && !['move_in', 'move_out'].includes(o.type) && (R[o.account].all || o.by !== actor) }));
  const shifts = (X.shifts || []).filter((h) => ids.has(h.account)).map((h) => {
    const x = clone(h), b = bal(h.account);
    x.openedName = nm(h.openedBy); x.closedName = h.closedBy ? nm(h.closedBy) : '';
    if (x.decision && x.decision.by) x.decision.byName = nm(x.decision.by);
    if (h.status === 'open' && b) x.expectedNow = balanceOf(X, h.account);
    if (!b) { delete x.expected; delete x.diff; delete x.openDiff; x.hiddenCalc = true; }
    x.my = { seesBal: b, canClose: h.status === 'open' && can(h.account, 'create'), canReview: h.status === 'review' && b && can(h.account, 'review') && h.closedBy !== actor };
    return x;
  });
  const transfers = (X.transfers || []).filter((t) => ids.has(t.from) || ids.has(t.to)).map((t) => ({ ...clone(t), byName: nm(t.by), fromName: accName(t.from), toName: accName(t.to), my: { canAccept: t.status === 'transit' && canAcceptTr(db, M, actor, X, t) } }));
  const receipts = (X.receipts || []).filter((c) => ids.has(c.account)).map((c) => ({ ...clone(c), byName: nm(c.by), decidedName: c.decidedBy ? nm(c.decidedBy) : '', my: { canDecide: c.status === 'review' && can(c.account, 'edit') && !R[c.account].own && !R[c.account].opt.self } }));
  const requests = (X.requests || []).filter((q) => ids.has(q.account) && (q.by === actor || can(q.account, 'review'))).map((q) => ({ ...clone(q), byName: nm(q.by), decidedName: q.decidedBy ? nm(q.decidedBy) : '',
    approvers: db.members.filter((m) => m.status === 'active' && m.id !== q.by && accCan(cashAccess(db, M, m.id, X.accounts.find((a) => a.id === q.account)), 'review')).map((m) => m.name),
    my: { canDecide: q.status === 'pending' && can(q.account, 'review') && q.by !== actor, mine: q.by === actor } }));
  const proposals = cashProposals(db, M, actor);
  const out = { v1: true, hidden: false, accounts, ops, shifts, transfers, receipts, requests, proposals, canSettings: M.can(db, actor, 'cash', 'settings').ok };
  out.todo = cashTodo(out);
  out.badge = out.todo.reduce((n, t) => n + (t.n || 1), 0);
  return out;
}

/** «Требует решения» на Главной: только то, что этот сотрудник может решить сам. */
function cashTodo(V) {
  const A = (id) => V.accounts.find((a) => a.id === id) || { name: '—', tol: 0 }, out = [];
  V.shifts.filter((h) => h.my.canReview).forEach((h) => out.push({ tone: 'danger', icon: 'point_of_sale', label: 'Касса · сверка', title: 'Смена ' + h.no + ' · ' + A(h.account).name + ': расхождение ' + signRub(h.diff.cash), text: 'Выше допуска ' + rub(A(h.account).tol || 0) + ' · закрыл(а) ' + h.closedName, action: 'Решить', open: 'sh:' + h.id }));
  V.requests.filter((q) => q.my.canDecide).forEach((q) => out.push({ tone: 'warn', icon: 'approval', label: 'Касса · согласовать', title: REQ_LABEL[q.type] + ' ' + rub(q.amount) + ' · ' + A(q.account).name, text: q.basis + ' · ' + q.byName + ' · без согласования до ' + rub(q.limit), action: 'Решить', open: 'rq:' + q.id }));
  V.transfers.filter((t) => t.my.canAccept).forEach((t) => out.push({ tone: 'info', icon: 'move_down', label: 'Касса · принять', title: rub(t.amount) + ' из «' + t.fromName + '» в «' + t.toName + '»', text: t.note + ' · передал(а) ' + t.byName, action: 'Принять', open: 'tr:' + t.id }));
  V.receipts.filter((c) => c.my.canDecide).forEach((c) => out.push({ tone: 'info', icon: 'receipt_long', label: 'Подотчёт · чек', title: c.byName + ': ' + c.cat + ' ' + rub(c.amount), text: (c.link ? c.link + ' · ' : '') + 'чек на проверке с ' + c.at, action: 'Проверить', open: 'adv:' + c.account }));
  V.accounts.filter((a) => a.kind === 'advance' && !a.my.own && accCan({ ok: true, ...a.my }, 'edit') && a.balance > 0 && dueState(a.due) === 'late').forEach((a) => out.push({ tone: 'warn', icon: 'event_busy', label: 'Подотчёт · срок', title: a.memberName + ': не отчитался(ась) за ' + rub(a.balance), text: 'Срок отчёта ' + a.due + ' прошёл', action: 'Открыть', open: 'adv:' + a.id }));
  if (V.proposals.length) {
    const by = {}; V.proposals.forEach((p) => { const k = { spa: 'визиты', logistics: 'возмещения', service: 'возвраты', repair: 'объекты' }[p.mod] || 'прочее'; by[k] = (by[k] || 0) + 1; });
    out.push({ tone: 'neutral', icon: 'inbox', label: 'Касса · входящие', title: plural(V.proposals.length, 'предложение', 'предложения', 'предложений') + ' к проведению', text: Object.entries(by).map(([k, n]) => k + ' · ' + n).join(', '), action: 'Открыть', open: 'inbox', n: V.proposals.length });
  }
  return out;
}

// ── Демо-данные «Альта Групп»: салон с ККТ без подключения, офис логистики, подотчёты, сейф и счёт ──
const ACC = (id, kind, name, unit, x) => ({ id, kind, name, unit, resp: null, mode: 'none', kkt: 'none', limit: null, float: 0, tol: 0, member: null, from: null, term: null, drawer: null, due: null, cats: null, ...x });
function seedAlta() {
  const ADV = ['Топливо', 'Мойка', 'Парковка', 'Мелкий ремонт'];
  const accounts = [
    ACC('ca-spa', 'drawer', 'Касса салона · ресепшен', 'spa', { resp: 'm-morozova', mode: 'blind', kkt: 'manual', limit: 30000, float: 5000, tol: 100, term: 'ca-term' }),
    ACC('ca-term', 'acquiring', 'Терминал и СБП · салон', 'spa', { drawer: 'ca-spa', settle: 'ca-bank', fee: 1.8 }),
    ACC('ca-sever', 'drawer', 'Касса офиса', 'f-msk-sever', { resp: 'm-kotova', limit: 60000 }),
    ACC('ca-adv-vas', 'advance', 'Подотчёт · Илья Васильев', 'f-msk-sever', { member: 'm-vasiliev', from: 'ca-sever', limit: 15000, due: '03.10', cats: ADV }),
    ACC('ca-adv-akh', 'advance', 'Подотчёт · Тимур Ахмедов', 'f-msk-sever', { member: 'm-akhmedov', from: 'ca-sever', limit: 15000, due: '05.10', cats: ADV }),
    ACC('ca-adv-sok', 'advance', 'Подотчёт · Алексей Соколов', null, { member: 'm-sokolov', from: 'ca-safe', limit: 30000, due: '01.10', cats: ['Материалы', 'Инструмент', 'Хозяйственные расходы'] }),
    ACC('ca-safe', 'safe', 'Сейф офиса', null, { resp: 'm-owner' }),
    ACC('ca-bank', 'bank', 'Расчётный счёт ··4417', null, { resp: 'm-owner' }),
  ];
  const O = (id, account, type, amount, method, cat, basis, at, time, by, x) => ({ id, account, type, amount, method, cat, basis, at, time, by, src: null, ref: null, receipt: null, shift: null, group: null, ...x });
  const F = (fd, kkt, time) => ({ fd, kkt, time });
  const ops = [
    O('K-326', 'ca-spa', 'out', 650, 'cash', 'Хозяйственные расходы', 'Вода и салфетки для кабинетов', '01.10', '10:30', 'm-morozova', { shift: 'sh-118', receipt: { seller: true } }),
    O('K-325', 'ca-spa', 'in', 3000, 'cash', 'Выручка · абонементы и сертификаты', 'Подарочный сертификат № 214', '01.10', '10:15', 'm-morozova', { shift: 'sh-118', receipt: F('4520', '118', '10:16') }),
    O('K-324', 'ca-term', 'in', 12000, 'card', 'Выручка · абонементы и сертификаты', 'Абонемент на 5 визитов · Светлана Д.', '01.10', '09:40', 'm-morozova', { shift: 'sh-118', receipt: F('4519', '118', '09:41') }),
    O('K-323', 'ca-safe', 'move_in', 26840, 'cash', 'Перемещение', 'Выручка · смена 117 ← «Касса салона · ресепшен»', '30.09', '21:30', 'm-owner', { tr: 'tr-2' }),
    O('K-322', 'ca-spa', 'move_out', 26840, 'cash', 'Перемещение', 'Выручка · смена 117 → «Сейф офиса»', '30.09', '21:06', 'm-morozova', { tr: 'tr-2', shift: 'sh-117' }),
    O('K-321', 'ca-spa', 'adjust', 60, 'cash', 'Корректировка', 'Недостача при пересчёте · смена 117: сдача мелочью', '30.09', '21:04', 'm-morozova', { sign: -1, shift: 'sh-117' }),
    O('K-320', 'ca-term', 'in', 9600, 'card', 'Выручка · услуги SPA', 'SPA-ритуал · 2 визита', '30.09', '18:20', 'm-morozova', { shift: 'sh-117', receipt: F('4396', '117', '18:21') }),
    O('K-319', 'ca-spa', 'in', 20500, 'cash', 'Выручка · абонементы и сертификаты', 'Абонементы · 3 шт.', '30.09', '19:30', 'm-morozova', { shift: 'sh-117', receipt: F('4395', '117', '19:31') }),
    O('K-318', 'ca-spa', 'refund', 1600, 'cash', 'Возврат клиенту', 'Возврат за отменённый визит · Мария К.', '30.09', '16:05', 'm-owner', { shift: 'sh-117', ref: 'K-317', receipt: F('4391', '117', '16:06') }),
    O('K-317', 'ca-spa', 'in', 3200, 'cash', 'Выручка · услуги SPA', 'Классический массаж · Мария К.', '30.09', '15:10', 'm-morozova', { shift: 'sh-117', receipt: F('4390', '117', '15:11') }),
    O('K-316', 'ca-spa', 'in', 4800, 'cash', 'Выручка · услуги SPA', 'SPA-ритуал · Ирина П.', '30.09', '12:40', 'm-morozova', { shift: 'sh-117', receipt: F('4388', '117', '12:41') }),
    O('K-313', 'ca-adv-sok', 'out', 18730, 'cash', 'Материалы', 'Чек · Закупка З-14 · грунт и сетка · чек по QR', '30.09', '15:20', 'm-owner', { src: { kind: 'receipt', id: 'rc-6', label: 'Чек Алексея Соколова' }, receipt: { seller: true } }),
    O('K-312', 'ca-adv-sok', 'move_in', 30000, 'cash', 'Перемещение', 'Выдача под отчёт · Алексей Соколов ← «Сейф офиса»', '30.09', '09:31', 'm-sokolov', { tr: 'tr-4' }),
    O('K-311', 'ca-safe', 'move_out', 30000, 'cash', 'Перемещение', 'Выдача под отчёт · Алексей Соколов → «Подотчёт · Алексей Соколов»', '30.09', '09:30', 'm-owner', { tr: 'tr-4' }),
    O('K-309', 'ca-adv-akh', 'out', 3000, 'cash', 'Топливо', 'Чек · Топливо · рейс Р-204', '30.09', '19:10', 'm-owner', { src: { kind: 'receipt', id: 'rc-5', label: 'Чек Тимура Ахмедова' }, receipt: { seller: true } }),
    O('K-308', 'ca-adv-akh', 'move_in', 8000, 'cash', 'Перемещение', 'Выдача под отчёт · Тимур Ахмедов ← «Касса офиса»', '30.09', '08:07', 'm-akhmedov', { tr: 'tr-3' }),
    O('K-307', 'ca-sever', 'move_out', 8000, 'cash', 'Перемещение', 'Выдача под отчёт · Тимур Ахмедов → «Подотчёт · Тимур Ахмедов»', '30.09', '08:05', 'm-owner', { tr: 'tr-3' }),
    O('K-306', 'ca-adv-vas', 'out', 3050, 'cash', 'Топливо', 'Чек · Топливо · рейс Р-201', '30.09', '17:55', 'm-owner', { src: { kind: 'receipt', id: 'rc-2', label: 'Чек Ильи Васильева' }, receipt: { seller: true } }),
    O('K-305', 'ca-adv-vas', 'out', 2500, 'cash', 'Топливо', 'Чек · Топливо · рейс Р-196', '29.09', '18:40', 'm-owner', { src: { kind: 'receipt', id: 'rc-1', label: 'Чек Ильи Васильева' }, receipt: { seller: true } }),
    O('K-304', 'ca-adv-vas', 'move_in', 10000, 'cash', 'Перемещение', 'Выдача под отчёт · Илья Васильев ← «Касса офиса»', '28.09', '08:12', 'm-vasiliev', { tr: 'tr-1' }),
    O('K-303', 'ca-sever', 'move_out', 10000, 'cash', 'Перемещение', 'Выдача под отчёт · Илья Васильев → «Подотчёт · Илья Васильев»', '28.09', '08:10', 'm-owner', { tr: 'tr-1' }),
    O('K-302', 'ca-sever', 'out', 1240, 'cash', 'Хозяйственные расходы', 'Канцтовары для офиса', '26.09', '12:20', 'm-owner', { receipt: { seller: true } }),
    O('K-315', 'ca-spa', 'opening', 5000, 'cash', 'Ввод остатка', 'Ввод остатка · размен', '01.09', '09:00', 'm-owner'),
    O('K-314', 'ca-bank', 'opening', 1284000, 'transfer', 'Ввод остатка', 'Остаток по выписке на 30.09', '30.09', '18:00', 'm-owner'),
    O('K-310', 'ca-safe', 'opening', 120000, 'cash', 'Ввод остатка', 'Ввод остатка · пересчёт сейфа', '01.09', '09:00', 'm-owner'),
    O('K-301', 'ca-sever', 'opening', 50000, 'cash', 'Ввод остатка', 'Ввод остатка · пересчёт кассы офиса', '01.09', '09:00', 'm-owner'),
  ];
  const shifts = [
    { id: 'sh-118', account: 'ca-spa', no: 118, status: 'open', openedAt: '01.10 09:02', openedBy: 'm-morozova', float: 5000 },
    { id: 'sh-117', account: 'ca-spa', no: 117, status: 'closed', openedAt: '30.09 09:00', openedBy: 'm-morozova', float: 5000, closedAt: '30.09 21:04', closedBy: 'm-morozova', counted: 31840, counts: { 5000: 3, 2000: 4, 1000: 6, 500: 3, 200: 2, 100: 2 }, coins: 240,
      z: { no: '117', cash: 26900, card: 9600 }, term: { card: 9600, sbp: 0 }, expected: { cash: 31900, revCash: 26900, revCard: 9600, card: 9600, sbp: 0 }, diff: { cash: -60, kktCash: 0, kktCard: 0, term: 0 },
      decision: { kind: 'auto', at: '30.09 21:04', reason: 'В пределах допуска 100 ₽', op: 'K-321' }, toSafe: 26840 },
  ];
  const T = (id, from, to, amount, note, by, at, outOp, inOp) => ({ id, from, to, amount, note, by, at, status: 'done', outOp, inOp, decidedAt: at });
  const transfers = [
    T('tr-4', 'ca-safe', 'ca-adv-sok', 30000, 'Выдача под отчёт · Алексей Соколов', 'm-owner', '30.09 09:30', 'K-311', 'K-312'),
    T('tr-3', 'ca-sever', 'ca-adv-akh', 8000, 'Выдача под отчёт · Тимур Ахмедов', 'm-owner', '30.09 08:05', 'K-307', 'K-308'),
    T('tr-2', 'ca-spa', 'ca-safe', 26840, 'Выручка · смена 117', 'm-morozova', '30.09 21:06', 'K-322', 'K-323'),
    T('tr-1', 'ca-sever', 'ca-adv-vas', 10000, 'Выдача под отчёт · Илья Васильев', 'm-owner', '28.09 08:10', 'K-303', 'K-304'),
  ];
  const RC = (id, account, amount, cat, link, by, at, status, x) => ({ id, account, amount, cat, link, note: '', photo: true, by, at, status, ...x });
  const receipts = [
    RC('rc-3', 'ca-adv-vas', 600, 'Мойка', 'Рейс Р-203', 'm-vasiliev', '30.09 19:20', 'review'),
    RC('rc-4', 'ca-adv-vas', 400, 'Парковка', 'Рейс Р-203', 'm-vasiliev', '30.09 19:22', 'rejected', { reason: 'Не видна сумма на фото — переснимите чек', decidedBy: 'm-owner', decidedAt: '30.09 20:05' }),
    RC('rc-2', 'ca-adv-vas', 3050, 'Топливо', 'Рейс Р-201', 'm-vasiliev', '30.09 17:40', 'accepted', { op: 'K-306', decidedBy: 'm-owner', decidedAt: '30.09 17:55' }),
    RC('rc-1', 'ca-adv-vas', 2500, 'Топливо', 'Рейс Р-196', 'm-vasiliev', '29.09 18:10', 'accepted', { op: 'K-305', decidedBy: 'm-owner', decidedAt: '29.09 18:40' }),
    RC('rc-5', 'ca-adv-akh', 3000, 'Топливо', 'Рейс Р-204', 'm-akhmedov', '30.09 18:50', 'accepted', { op: 'K-309', decidedBy: 'm-owner', decidedAt: '30.09 19:10' }),
    RC('rc-6', 'ca-adv-sok', 18730, 'Материалы', 'Закупка З-14 · ЖК Речной, кв. 42', 'm-sokolov', '30.09 14:55', 'accepted', { op: 'K-313', qr: true, decidedBy: 'm-owner', decidedAt: '30.09 15:20' }),
  ];
  const requests = [
    { id: 'rq-1', account: 'ca-sever', type: 'out', amount: 6500, method: 'cash', cat: 'Мелкий ремонт', basis: 'Ремонт ворот склада · ИП Гаврилов', ref: null, receipt: { seller: true }, src: null, by: 'm-kotova', at: '01.10 08:50', status: 'pending', limit: 5000 },
  ];
  const proposals = [
    { id: 'pr-1', mod: 'spa', kind: 'in', amount: 2800, account: 'ca-spa', cat: 'Выручка · услуги SPA', title: 'Наталья С. · Массаж лица', sub: 'Визит 30.09 18:00 · не оплачен в смене 117', src: { kind: 'spa', label: 'Визит 30.09 18:00', nav: 'spa' } },
    { id: 'pr-2', mod: 'service', kind: 'refund', amount: 1600, account: 'ca-spa', ref: 'K-316', cat: 'Возврат клиенту', title: 'Ирина П. · компенсация по жалобе', sub: 'Часть оплаты визита 30.09 · по оплате K-316', src: { kind: 'service', label: 'Обращение · жалоба на визит', nav: 'service' } },
    { id: 'pr-3', mod: 'repair', kind: 'in', amount: 462000, account: 'ca-bank', method: 'transfer', cat: 'Оплата заказчика', title: 'Оплата заказчика · акт № 3', sub: 'ЖК Речной, кв. 42 · ждём на счёт ··4417', src: { kind: 'repair', label: 'Акт № 3', nav: 'repair' } },
    { id: 'pr-4', mod: 'repair', fin: true, kind: 'out', amount: 186000, account: 'ca-bank', method: 'transfer', cat: 'Выплаты бригаде', title: 'Бригада · сентябрь', sub: 'По закрытым актам · 4 человека', src: { kind: 'repair', label: 'Начисления бригаде', nav: 'repair' } },
  ];
  return { v1: true, accounts, ops, shifts, transfers, receipts, requests, proposals, dismissed: [] };
}

/** Установка модуля в «БД» организации: роли получают действия кассы, старые счета — вид и режим. Повтор ничего не меняет. */
export function installCash(db, M) {
  if (db.cash && db.cash.v1) return;
  const role = (id) => (db.roles || []).find((r) => r.id === id);
  const grant = (id, verbs, opt) => { const r = role(id); if (r && !(r.actions && r.actions.cash)) { r.actions = { ...(r.actions || {}), cash: verbs }; r.cash = { ...CASH_OPT0, ...opt }; } };
  grant('r-manager', ['view', 'create', 'edit'], { balance: true, out: 5000, refund: 0, advance: 15000 });
  grant('r-driver', ['view', 'create'], { self: true, balance: true });
  grant('r-foreman', ['view', 'create'], { self: true, balance: true });
  grant('r-admin', ['view', 'create', 'edit'], { out: 3000, refund: 3000, advance: 0 });
  if (!role('r-cashier')) db.roles.push({ id: 'r-cashier', name: 'Кассир салона', kind: 'template', actions: { cash: ['view', 'create', 'edit'] }, cash: { ...CASH_OPT0, out: 1000, refund: 3000, advance: 0 }, finance: { read: false, manage: false } });
  if (db.tenantId === 't-alta') {
    db.cash = seedAlta();
    if (mem(db, 'm-morozova') && !db.assignments.some((a) => a.id === 'a-cash1')) db.assignments.push({ id: 'a-cash1', member: 'm-morozova', role: 'r-cashier', scope: { type: 'account', id: 'ca-spa' } });
    return;
  }
  const old = db.cash || { accounts: [], ops: [] }, firm = (db.units || []).find((u) => u.type === 'firm');
  db.cash = { v1: true, accounts: old.accounts.map((a) => ACC(a.id, 'drawer', a.name, (db.units || []).some((u) => u.id === a.unit) ? a.unit : firm ? firm.id : null, { mode: 'open', kkt: 'manual', float: 5000, tol: 100 })),
    ops: (old.ops || []).map((o) => ({ method: 'cash', cat: '', time: '', src: null, ref: null, receipt: null, shift: null, group: null, ...o })), shifts: [], transfers: [], receipts: [], requests: [], proposals: [], dismissed: [] };
}

// ── Команды mock-адаптера ──
export function cashApi({ getDb, getActor, cmd, ApiError, M, event }) {
  const D = getDb, me = () => getActor();
  const X = () => { const x = D().cash; if (!x || !x.v1) throw new ApiError('not_found', 'Модуль «Касса» не подключён'); return x; };
  const acc = (id) => { const a = X().accounts.find((x) => x.id === id); if (!a) throw new ApiError('not_found', 'Касса не найдена'); return a; };
  const need = (a, verb, why) => { const r = cashAccess(D(), M, me(), a); if (!r.ok) throw new ApiError('not_found', 'Касса «' + a.name + '» недоступна: ' + r.why); if (verb && !accCan(r, verb)) throw new ApiError('forbidden', why || 'Недостаточно прав в кассе «' + a.name + '»'); return r; };
  const active = () => { const t = (D().platform.tenants || []).find((x) => x.id === D().tenantId); if (t && ['restricted', 'suspended'].includes(t.status)) throw new ApiError('subscription_restricted', 'Пробный период завершён: новые операции недоступны. История доступна для чтения.'); };
  const nid = (p) => p + D().seq++;
  const now = () => CASH_DAY + ' ' + hhmm();
  const who = (a, verb, but) => D().members.filter((m) => m.status === 'active' && m.id !== but && accCan(cashAccess(D(), M, m.id, a), verb)).map((m) => m.id);
  const sum = (v, label) => { const n = parseSum(v); if (!(n > 0)) throw new ApiError('validation', (label || 'Сумма') + ': укажите число больше нуля'); return n; };
  const reason = (v, label) => { const t = String(v || '').trim(); if (t.length < 3) throw new ApiError('validation', label || 'Укажите причину'); return t; };
  const push = (o) => { const x = { id: 'K-' + (300 + D().seq++), at: CASH_DAY, time: hhmm(), by: me(), method: 'cash', cat: '', basis: '', src: null, ref: null, receipt: null, shift: null, group: null, ...o }; X().ops.unshift(x); return x; };
  const drawerOf = (a) => (a.kind === 'acquiring' && a.drawer ? acc(a.drawer) : a);
  const shiftFor = (a) => { const d = drawerOf(a); if (d.kind !== 'drawer' || d.mode === 'none') return null; const h = openShift(X(), d.id); if (!h) throw new ApiError('validation', 'Смена в «' + d.name + '» закрыта — откройте смену, чтобы проводить оплаты'); return h.id; };
  const limitOf = (r, type) => (r.all ? null : type === 'out' ? r.opt.out : type === 'refund' ? r.opt.refund : type === 'issue' ? r.opt.advance : null);
  const receiptOf = (a, type, rc) => {
    const r = rc || {}, fiscal = (type === 'in' || type === 'refund') && drawerOf(a).kkt === 'manual';
    if (!fiscal) return r.seller ? { seller: true } : null;
    if (r.none) return { none: true, reason: reason(r.reason, 'Чек не пробивали — укажите причину') };
    const fd = String(r.fd || '').trim(), kkt = String(r.kkt || '').trim();
    if (!/^\d{1,10}$/.test(fd)) throw new ApiError('validation', 'Укажите № ФД из чека: цифры, до 10 знаков. Если чек не пробивали — отметьте это и укажите причину');
    const dupe = X().ops.find((o) => o.receipt && o.receipt.fd === fd && (o.receipt.kkt || '') === kkt && !o.reversedBy);
    if (dupe) throw new ApiError('conflict', 'Чек № ФД ' + fd + (kkt ? ' (смена ККТ ' + kkt + ')' : '') + ' уже внесён: ' + dupe.id + ' · ' + dupe.basis);
    return { fd, kkt, time: String(r.time || '').trim() };
  };
  const write = (a, s) => {
    if (!(METHODS_OF[a.kind] || ['cash']).includes(s.method)) throw new ApiError('validation', (METHOD[s.method] || { label: 'Этот способ' }).label + ' не принимается в «' + a.name + '»');
    if (OP[s.type].sign < 0 && ['drawer', 'safe'].includes(a.kind) && balanceOf(X(), a.id) - s.amount < 0) throw new ApiError('validation', 'В «' + a.name + '» нет столько наличных: остаток ушёл бы в минус');
    if (s.type === 'refund') {
      const o = X().ops.find((x) => x.id === s.ref);
      if (!o || o.type !== 'in') throw new ApiError('validation', 'Возврат проводится по оплате — выберите операцию прихода');
      const done = X().ops.filter((x) => x.type === 'refund' && x.ref === o.id && !x.reversedBy).reduce((t, x) => t + x.amount, 0);
      if (done + s.amount > o.amount) throw new ApiError('validation', 'Возвратов по ' + o.id + ' больше оплаты: доступно ' + rub(o.amount - done));
    }
    const shift = shiftFor(a), receipt = s.receiptFixed !== undefined ? s.receiptFixed : receiptOf(a, s.type, s.receipt);
    return push({ account: a.id, type: s.type, amount: s.amount, method: s.method, cat: s.cat || '', basis: s.basis, src: s.src || null, ref: s.ref || null, receipt, shift, group: s.group || null, by: s.by || me(), approvedBy: s.approvedBy || null });
  };
  const request = (a, spec, lim) => {
    const q = { id: nid('rq-'), account: a.id, ...spec, by: me(), at: now(), status: 'pending', limit: lim };
    X().requests.unshift(q);
    event('Касса: ' + (D().members.find((m) => m.id === me()) || {}).name + ' просит согласовать ' + REQ_LABEL[spec.type].toLowerCase() + ' ' + rub(spec.amount) + ' · ' + a.name, who(a, 'review', me()));
    return q;
  };
  const transfer = (from, to, amount, note, shiftId, by) => {
    const t = { id: nid('tr-'), from: from.id, to: to.id, amount, note, by: by || me(), at: now(), status: 'transit' };
    const sh = shiftId || (from.kind === 'drawer' && from.mode !== 'none' && openShift(X(), from.id) ? openShift(X(), from.id).id : null);
    t.outOp = push({ account: from.id, type: 'move_out', amount, method: 'cash', cat: 'Перемещение', basis: note + ' → «' + to.name + '»', tr: t.id, shift: sh, by: t.by }).id;
    X().transfers.unshift(t);
    event('Касса: ' + rub(amount) + ' в пути в «' + to.name + '» — ' + note, (to.kind === 'advance' ? [to.member] : who(to, 'edit')).filter((id) => id !== me()));
    return t;
  };

  return {
    cashPost: (spec) => cmd(() => {
      active();
      const s = spec || {}, a = acc(s.account), r = need(a, 'create', 'Нет права «Создавать» в кассе «' + a.name + '»');
      if (r.opt.self || a.kind === 'advance') throw new ApiError('forbidden', 'Подотчёт пополняется выдачей из кассы, расход отчитывается чеком сотрудника');
      if (!['in', 'out', 'refund'].includes(s.type)) throw new ApiError('validation', 'Выберите тип операции');
      if (s.type === 'refund' && !accCan(r, 'edit')) throw new ApiError('forbidden', 'Возвраты — действие «Изменять» в роли');
      const amount = sum(s.amount), basis = String(s.basis || '').trim();
      if (basis.length < 3) throw new ApiError('validation', 'Укажите основание: за что и кому');
      const spec2 = { type: s.type, amount, method: s.method || (METHODS_OF[a.kind] || ['cash'])[0], cat: s.cat || '', basis, ref: s.ref || null, receipt: s.receipt || null, src: null };
      const lim = limitOf(r, s.type);
      if (lim != null && amount > lim) { if (s.type !== 'out') receiptOf(a, s.type, s.receipt); return { request: request(a, spec2, lim).id }; }
      return { id: write(a, spec2).id };
    }, 350),

    cashPostProposal: (key, pay) => cmd(() => {
      active();
      const p = cashProposals(D(), M, me()).find((x) => x.key === key);
      if (!p) throw new ApiError('conflict', 'Предложение уже проведено, отклонено или недоступно');
      const a = acc(p.account), r = need(a, p.kind === 'refund' ? 'edit' : 'create');
      const src = { key: p.key, kind: p.src.kind, id: p.src.id || null, label: p.src.label, nav: p.src.nav || null };
      const P = pay || {};
      if (p.kind === 'in') {
        const parts = (P.parts && P.parts.length ? P.parts : [{ method: p.method || (METHODS_OF[a.kind] || ['cash'])[0], amount: p.amount }]).map((x) => ({ method: x.method, amount: parseSum(x.amount) })).filter((x) => x.amount > 0);
        const total = Math.round(parts.reduce((t, x) => t + x.amount, 0) * 100) / 100;
        if (!parts.length || Math.abs(total - p.amount) > 0.001) throw new ApiError('validation', 'Части оплаты дают ' + rub(total) + ', а к оплате ' + rub(p.amount));
        const targets = parts.map((x) => { const t = ['card', 'sbp'].includes(x.method) && a.kind === 'drawer' ? (a.term ? acc(a.term) : null) : a; if (!t) throw new ApiError('validation', 'У «' + a.name + '» нет терминала: карта и СБП недоступны'); need(t, 'create'); return t; });
        const receipt = receiptOf(a, 'in', P.receipt), group = parts.length > 1 ? nid('g-') : null;
        return { ids: parts.map((x, i) => write(targets[i], { type: 'in', amount: x.amount, method: x.method, cat: p.cat, basis: p.title, src, receiptFixed: receipt, group }).id) };
      }
      const spec = { type: p.kind, amount: p.amount, method: p.method || 'cash', cat: p.cat, basis: p.title + (p.sub ? ' · ' + p.sub : ''), src, ref: p.ref || null, receipt: P.receipt || (p.seller ? { seller: true } : null) };
      const lim = limitOf(r, p.kind);
      if (lim != null && p.amount > lim) { if (p.kind === 'refund') receiptOf(a, 'refund', spec.receipt); return { request: request(a, spec, lim).id }; }
      return { ids: [write(a, spec).id] };
    }, 400),

    cashDismiss: (key, why) => cmd(() => {
      const p = cashProposals(D(), M, me()).find((x) => x.key === key);
      if (!p) throw new ApiError('conflict', 'Предложение уже проведено или отклонено');
      X().dismissed.unshift({ key, reason: reason(why, 'Укажите, почему не проводите'), by: me(), at: now(), title: p.title, amount: p.amount });
    }, 250),

    cashLink: (opId, key) => cmd(() => {
      const p = cashProposals(D(), M, me()).find((x) => x.key === key), o = X().ops.find((x) => x.id === opId);
      if (!p || !o) throw new ApiError('conflict', 'Предложение или операция недоступны');
      const a = acc(p.account); need(a, 'create');
      if (o.src || o.amount !== p.amount || ![a.id, a.term].includes(o.account)) throw new ApiError('validation', 'Связать можно ручную операцию на ту же сумму в этой кассе');
      o.src = { key: p.key, kind: p.src.kind, id: p.src.id || null, label: p.src.label, nav: p.src.nav || null, linkedBy: me() };
      return o.id;
    }, 250),

    cashReverse: (opId, why) => cmd(() => {
      active();
      const o = X().ops.find((x) => x.id === opId); if (!o) throw new ApiError('not_found', 'Операция не найдена');
      const a = acc(o.account), r = need(a, 'review', 'Сторно — действие «Проверять» в роли');
      const text = reason(why, 'Укажите причину исправления');
      if (o.reversedBy || o.type === 'storno') throw new ApiError('conflict', 'Операция уже исправлена');
      if (['move_in', 'move_out'].includes(o.type)) throw new ApiError('validation', 'Перемещение исправляется обратным перемещением');
      if (!r.all && o.by === me()) throw new ApiError('forbidden', 'Свою операцию сторнирует второй сотрудник с правом «Проверять»');
      const sign = -opSign(o);
      if (sign < 0 && ['drawer', 'safe'].includes(a.kind) && balanceOf(X(), a.id) - o.amount < 0) throw new ApiError('validation', 'Сторно увело бы остаток «' + a.name + '» в минус');
      const sh = a.kind === 'drawer' && a.mode !== 'none' ? openShift(X(), a.id) : null;
      const s = push({ account: a.id, type: 'storno', sign, amount: o.amount, method: o.method, cat: o.cat, basis: 'Сторно ' + o.id + ': ' + text, reverses: o.id, shift: sh ? sh.id : null });
      o.reversedBy = s.id;
      return s.id;
    }, 350),

    cashShiftOpen: (accountId, counted) => cmd(() => {
      active();
      const a = acc(accountId); need(a, 'create', 'Смену открывает роль с правом «Создавать» в «' + a.name + '»');
      if (a.kind !== 'drawer' || a.mode === 'none') throw new ApiError('validation', 'Касса работает без смен');
      if (openShift(X(), a.id)) throw new ApiError('conflict', 'Смена уже открыта');
      const n = parseSum(counted); if (!(n >= 0)) throw new ApiError('validation', 'Укажите размен: сколько наличных в ящике');
      const no = X().shifts.filter((h) => h.account === a.id).reduce((m, h) => Math.max(m, h.no), 0) + 1, bal = balanceOf(X(), a.id);
      const h = { id: nid('sh-'), account: a.id, no, status: 'open', openedAt: now(), openedBy: me(), float: n };
      X().shifts.unshift(h);
      if (Math.abs(n - bal) > 0.001) {
        const adj = push({ account: a.id, type: 'adjust', sign: n > bal ? 1 : -1, amount: Math.round(Math.abs(n - bal) * 100) / 100, cat: 'Корректировка', basis: 'Расхождение при открытии смены ' + no, shift: h.id });
        h.openDiff = { amount: Math.round((n - bal) * 100) / 100, op: adj.id };
        event('Касса «' + a.name + '»: размен при открытии смены ' + no + ' не сошёлся с остатком на ' + signRub(n - bal), who(a, 'review', me()));
      }
      return h.id;
    }, 350),

    cashShiftClose: (shiftId, form) => cmd(() => {
      active();
      const h = X().shifts.find((x) => x.id === shiftId); if (!h || h.status !== 'open') throw new ApiError('conflict', 'Смена уже закрыта');
      const a = acc(h.account), r = need(a, 'create', 'Смену закрывает роль с правом «Создавать»');
      const F = form || {}, counts = {}; let counted = 0;
      DENOMS.forEach((d) => { const c = Math.max(0, Math.floor(Number((F.counts || {})[d]) || 0)); if (c) counts[d] = c; counted += c * d; });
      const coins = Math.max(0, parseSum(F.coins) || 0); counted = Math.round((counted + coins) * 100) / 100;
      const z = F.z || {}, zc = parseSum(z.cash), zk = parseSum(z.card);
      if (a.kkt === 'manual' && (!String(z.no || '').trim() || !(zc >= 0) || !(zk >= 0))) throw new ApiError('validation', 'Перепишите итоги Z-отчёта: номер, наличными и безналичными. Если ККТ не работала — укажите 0');
      const tm = F.term || {}, tc = parseSum(tm.card), ts = parseSum(tm.sbp);
      const keep = F.keep === '' || F.keep == null ? Math.min(a.float || 0, counted) : parseSum(F.keep);
      if (!(keep >= 0) || keep > counted) throw new ApiError('validation', 'Размен на следующую смену — не больше посчитанного');
      const expected = balanceOf(X(), a.id);
      const live = X().ops.filter((o) => o.shift === h.id && !o.reversedBy && o.type !== 'storno');
      const rev = (id, ms) => (id ? live.filter((o) => o.account === id && ms.includes(o.method)).reduce((t, o) => t + (o.type === 'in' ? o.amount : o.type === 'refund' ? -o.amount : 0), 0) : 0);
      const revCash = rev(a.id, ['cash']), revCard = rev(a.term, ['card', 'sbp']);
      const diff = Math.round((counted - expected) * 100) / 100;
      Object.assign(h, { closedAt: now(), closedBy: me(), counted, counts, coins,
        z: a.kkt === 'manual' ? { no: String(z.no).trim(), cash: zc, card: zk } : null,
        term: a.term ? { card: tc >= 0 ? tc : 0, sbp: ts >= 0 ? ts : 0 } : null,
        expected: { cash: expected, revCash, revCard, card: rev(a.term, ['card']), sbp: rev(a.term, ['sbp']) } });
      h.diff = { cash: diff, kktCash: h.z ? Math.round((zc - revCash) * 100) / 100 : 0, kktCard: h.z ? Math.round((zk - revCard) * 100) / 100 : 0, term: h.term ? Math.round((h.term.card + h.term.sbp - revCard) * 100) / 100 : 0 };
      if (Math.abs(diff) <= (a.tol || 0)) {
        h.status = 'closed';
        if (diff) { const adj = push({ account: a.id, type: 'adjust', sign: diff > 0 ? 1 : -1, amount: Math.abs(diff), cat: 'Корректировка', basis: (diff < 0 ? 'Недостача' : 'Излишек') + ' при пересчёте · смена ' + h.no, shift: h.id }); h.decision = { kind: 'auto', at: h.closedAt, reason: 'В пределах допуска ' + rub(a.tol), op: adj.id }; }
        else h.decision = { kind: 'auto', at: h.closedAt, reason: 'Без расхождений' };
      } else {
        h.status = 'review';
        event('Касса «' + a.name + '»: смена ' + h.no + ' закрыта с расхождением ' + signRub(diff) + ' — нужно решение', who(a, 'review', me()));
      }
      const toSafe = Math.round((counted - keep) * 100) / 100, safe = X().accounts.find((x) => x.kind === 'safe' && !x.archived);
      if (toSafe > 0 && safe && accCan(r, 'edit')) { transfer(a, safe, toSafe, 'Выручка · смена ' + h.no, h.id); h.toSafe = toSafe; }
      return { status: h.status, kkt: !!(h.diff.kktCash || h.diff.kktCard || h.diff.term) };
    }, 450),

    cashShiftReview: (shiftId, decision, why) => cmd(() => {
      const h = X().shifts.find((x) => x.id === shiftId); if (!h || h.status !== 'review') throw new ApiError('conflict', 'Смена уже решена');
      const a = acc(h.account), r = need(a, 'review', 'Расхождение принимает роль с правом «Проверять»');
      if (!r.opt.balance) throw new ApiError('forbidden', 'Нужно право видеть остаток и ожидаемую сумму');
      if (h.closedBy === me()) throw new ApiError('forbidden', 'Кто закрывал смену, тот не принимает её расхождение');
      const text = reason(why, 'Укажите причину решения');
      if (decision === 'recount') { h.status = 'open'; h.recount = { by: me(), at: now(), reason: text }; ['closedAt', 'closedBy', 'counted', 'counts', 'coins', 'z', 'term', 'expected', 'diff'].forEach((k) => delete h[k]); event('Касса «' + a.name + '»: смену ' + h.no + ' вернули на пересчёт — ' + text, [h.closedBy || h.openedBy].filter(Boolean)); return 'open'; }
      const d = h.diff.cash, adj = push({ account: a.id, type: 'adjust', sign: d > 0 ? 1 : -1, amount: Math.abs(d), cat: 'Корректировка', basis: (d < 0 ? 'Недостача' : 'Излишек') + ' · смена ' + h.no + ': ' + text, shift: h.id });
      h.status = 'closed'; h.decision = { kind: 'accepted', by: me(), at: now(), reason: text, op: adj.id };
      event('Касса «' + a.name + '»: расхождение смены ' + h.no + ' принято — ' + text, [h.closedBy].filter(Boolean));
      return 'closed';
    }, 350),

    cashTransfer: (spec) => cmd(() => {
      active();
      const s = spec || {}, a = acc(s.from), b = acc(s.to); need(a, 'edit', 'Перемещение — действие «Изменять» в роли');
      if (a.id === b.id) throw new ApiError('validation', 'Выберите другую кассу');
      if (!['drawer', 'safe'].includes(a.kind) || !['drawer', 'safe', 'bank'].includes(b.kind)) throw new ApiError('validation', 'Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»');
      const amount = sum(s.amount); if (balanceOf(X(), a.id) < amount) throw new ApiError('validation', 'В «' + a.name + '» нет столько наличных');
      return transfer(a, b, amount, String(s.note || '').trim() || (b.kind === 'safe' ? 'Сдача выручки' : b.kind === 'bank' ? 'Инкассация' : 'Перемещение')).id;
    }, 350),

    cashTransferAccept: (id, ok, why) => cmd(() => {
      const t = X().transfers.find((x) => x.id === id); if (!t || t.status !== 'transit') throw new ApiError('conflict', 'Перемещение уже принято или отклонено');
      const a = acc(t.from), b = acc(t.to);
      if (!canAcceptTr(D(), M, me(), X(), t)) throw new ApiError('forbidden', 'Принимает получатель: ' + (b.kind === 'advance' ? nameOf(D(), b.member) : 'роль с правом «Изменять» в «' + b.name + '»'));
      t.decidedBy = me(); t.decidedAt = now();
      if (ok === false) { const text = reason(why); t.status = 'rejected'; t.reason = text; t.backOp = push({ account: a.id, type: 'move_in', amount: t.amount, method: 'cash', cat: 'Перемещение', basis: 'Не принято в «' + b.name + '»: ' + text, tr: t.id }).id; event('Касса: «' + b.name + '» не принял(а) ' + rub(t.amount) + ' — ' + text, [t.by]); return 'rejected'; }
      t.status = 'done'; t.inOp = push({ account: b.id, type: 'move_in', amount: t.amount, method: b.kind === 'bank' ? 'transfer' : 'cash', cat: 'Перемещение', basis: t.note + ' ← «' + a.name + '»', tr: t.id }).id;
      event('Касса: ' + rub(t.amount) + ' приняты в «' + b.name + '»', [t.by].filter((x) => x !== me()));
      return 'done';
    }, 300),

    cashIssue: (spec) => cmd(() => {
      active();
      const s = spec || {}, b = acc(s.account); if (b.kind !== 'advance') throw new ApiError('validation', 'Выберите подотчёт сотрудника');
      const r = need(b, 'edit', 'Выдача под отчёт — действие «Изменять» в роли');
      if (r.own || r.opt.self) throw new ApiError('forbidden', 'Себе под отчёт выдаёт другой сотрудник');
      const a = acc(s.from || b.from); need(a, 'edit', 'Нет права «Изменять» в «' + a.name + '»');
      const amount = sum(s.amount), due = String(s.due || '').trim();
      if (!/^\d{2}\.\d{2}$/.test(due)) throw new ApiError('validation', 'Срок отчёта — в формате ДД.ММ');
      if (balanceOf(X(), a.id) < amount) throw new ApiError('validation', 'В «' + a.name + '» нет столько наличных');
      if (b.limit && balanceOf(X(), b.id) + amount > b.limit) throw new ApiError('validation', 'Лимит на руках у ' + nameOf(D(), b.member) + ' — ' + rub(b.limit));
      const lim = limitOf(r, 'issue');
      if (lim != null && amount > lim) return { request: request(b, { type: 'issue', amount, method: 'cash', cat: 'Перемещение', basis: 'Выдача под отчёт · ' + nameOf(D(), b.member), from: a.id, due }, lim).id };
      b.due = due;
      return { id: transfer(a, b, amount, 'Выдача под отчёт · ' + nameOf(D(), b.member)).id };
    }, 350),

    cashReceipt: (spec) => cmd(() => {
      active();
      const s = spec || {}, b = acc(s.account);
      if (b.kind !== 'advance' || b.member !== me()) throw new ApiError('forbidden', 'Чек добавляет держатель подотчёта');
      need(b, 'create');
      const amount = sum(s.amount);
      if (!s.cat) throw new ApiError('validation', 'Выберите статью');
      if (!s.photo) throw new ApiError('validation', 'Сфотографируйте чек');
      const c = { id: nid('rc-'), account: b.id, amount, cat: s.cat, link: String(s.link || '').trim(), note: String(s.note || '').trim(), photo: true, qr: !!s.qr, by: me(), at: now(), status: 'review' };
      if (s.redo) { const old = X().receipts.find((x) => x.id === s.redo); if (old) old.redoneBy = c.id; }
      X().receipts.unshift(c);
      event('Подотчёт: ' + nameOf(D(), me()) + ' — чек «' + s.cat + '» ' + rub(amount) + ' на проверке', who(b, 'edit', me()));
      return c.id;
    }, 350),

    cashReceiptDecide: (id, ok, why) => cmd(() => {
      const c = X().receipts.find((x) => x.id === id); if (!c || c.status !== 'review') throw new ApiError('conflict', 'Чек уже проверен');
      const b = acc(c.account), r = need(b, 'edit', 'Чеки проверяет роль с правом «Изменять»');
      if (r.own || r.opt.self) throw new ApiError('forbidden', 'Свой чек проверяет другой сотрудник');
      c.decidedBy = me(); c.decidedAt = now();
      if (ok === false) { c.status = 'rejected'; c.reason = reason(why); event('Подотчёт: чек «' + c.cat + '» ' + rub(c.amount) + ' не принят — ' + c.reason, [c.by]); return 'rejected'; }
      c.status = 'accepted';
      c.op = push({ account: b.id, type: 'out', amount: c.amount, method: 'cash', cat: c.cat, basis: 'Чек · ' + c.cat + (c.link ? ' · ' + c.link : '') + (c.note ? ' · ' + c.note : ''), src: { kind: 'receipt', id: c.id, label: 'Чек ' + nameOf(D(), c.by) }, receipt: { seller: true } }).id;
      event('Подотчёт: чек «' + c.cat + '» ' + rub(c.amount) + ' принят', [c.by]);
      return 'accepted';
    }, 300),

    cashReturn: (spec) => cmd(() => {
      active();
      const s = spec || {}, b = acc(s.account);
      if (b.kind !== 'advance' || b.member !== me()) throw new ApiError('forbidden', 'Остаток возвращает держатель подотчёта');
      const amount = sum(s.amount), have = balanceOf(X(), b.id);
      if (amount > have) throw new ApiError('validation', 'На руках меньше: ' + rub(have));
      return transfer(b, acc(b.from), amount, 'Возврат остатка подотчёта · ' + nameOf(D(), me())).id;
    }, 350),

    cashApprove: (id, ok, why) => cmd(() => {
      const q = X().requests.find((x) => x.id === id); if (!q || q.status !== 'pending') throw new ApiError('conflict', 'Заявка уже решена');
      const a = acc(q.account); need(a, 'review', 'Согласует роль с правом «Проверять» в «' + a.name + '»');
      if (q.by === me()) throw new ApiError('forbidden', 'Свою заявку согласует другой сотрудник');
      q.decidedBy = me(); q.decidedAt = now();
      if (ok === false) { q.status = 'rejected'; q.reason = reason(why); event('Касса: не согласовано — ' + REQ_LABEL[q.type].toLowerCase() + ' ' + rub(q.amount) + ' · ' + q.reason, [q.by]); return 'rejected'; }
      if (q.type === 'issue') { a.due = q.due; q.result = transfer(acc(q.from), a, q.amount, q.basis, null, q.by).id; }
      else q.result = write(a, { type: q.type, amount: q.amount, method: q.method, cat: q.cat, basis: q.basis, ref: q.ref, receipt: q.receipt, src: q.src, by: q.by, approvedBy: me() }).id;
      q.status = 'approved';
      event('Касса: согласовано и проведено — ' + REQ_LABEL[q.type].toLowerCase() + ' ' + rub(q.amount) + ' · ' + a.name, [q.by]);
      return q.result;
    }, 350),

    cashAccountCreate: (spec) => cmd(() => {
      active();
      const db = D(), s = spec || {};
      if (!M.can(db, me(), 'cash', 'settings').ok) throw new ApiError('forbidden', 'Кассы настраивает роль с действием «Настраивать» в модуле «Касса»');
      if (!KIND[s.kind]) throw new ApiError('validation', 'Выберите вид');
      const name = String(s.name || '').trim(); if (name.length < 2) throw new ApiError('validation', 'Укажите название');
      if (s.kind === 'advance' && !mem(db, s.member)) throw new ApiError('validation', 'Выберите сотрудника');
      if (X().accounts.some((a) => a.name.toLowerCase() === name.toLowerCase())) throw new ApiError('conflict', 'Касса с таким названием уже есть');
      const num = (v) => { const n = parseSum(v); return n > 0 ? n : null; };
      const unit = s.unit || null, from = s.kind === 'advance' ? (drawerFor(X(), unit) || X().accounts.find((a) => a.kind === 'safe') || {}).id || null : null;
      const a = ACC(nid('ca-'), s.kind, name, unit, { resp: s.resp || null, mode: s.kind === 'drawer' && MODE[s.mode] ? s.mode : 'none', kkt: s.kind === 'drawer' && s.kkt === 'manual' ? 'manual' : 'none',
        limit: num(s.limit), float: s.kind === 'drawer' ? num(s.float) || 0 : 0, tol: s.kind === 'drawer' ? parseSum(s.tol) >= 0 ? parseSum(s.tol) : 0 : 0,
        member: s.kind === 'advance' ? s.member : null, from, cats: s.kind === 'advance' ? CATS.out.slice(0, 4) : null, createdBy: me(), createdAt: now() });
      X().accounts.push(a);
      return a.id;
    }, 350),
  };
}
