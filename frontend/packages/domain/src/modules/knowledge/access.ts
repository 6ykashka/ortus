// Доступ к «Базе знаний» (knowledge.js 14.10:71–181, docs/23 «Доступ к странице»). Цепочка:
// организация → пространство → каждый родитель → узел → функция сотрудника. Подстраница наследует
// чтение и правку; свой доступ узла может только сузить круг читателей.
//
// Отличия от эталона (бриф W4.30 §10):
// - PD-53: глаголы области дают только роли с территориальной областью; в эталоне отсекались лишь
//   роли пространства и страницы, а роль проекта или чата с правами БЗ проходила в пространство
//   «вся организация»;
// - Q-W0.11-2: записи списков — единый `entryHas` ядра (заблокированный не входит, прораб — по id);
// - PD-60: назначение со сроком `until` раньше даты `opts.today` не действует; дата обязательна;
// - пространство без уровня доступа (до миграции v2) считается закрытым.
import { scopeCovers } from '../../core/access/units.ts';
import { grants } from '../../core/access/grants.ts';
import { isObjectScope } from '../../core/access/object-scoped.ts';
import { entryHas, entryPeople } from '../../core/entries.ts';
import type { Assignment, Entry, Grant, Member, Role } from '../../core/types/index.ts';
import { KB_ACCESS, KB_ROLE_ORDER } from './dictionaries.ts';
import { areaLabel, entryLabel } from './labels.ts';
import { dval, kbPath, nodeOf } from './tree.ts';
import type {
  KbAccessResult,
  KbAccessEntry,
  KbNode,
  KbOpts,
  KbReach,
  KbSpace,
  KbSpaceAccess,
  KbSpaceMy,
  KbStepKind,
  KbTenantDb,
} from './types.ts';

type Db = KbTenantDb;

const memberOf = (db: Db, id: string): Member | undefined => db.members.find((m) => m.id === id);
const roleOf = (db: Db, id: string): Role | undefined => db.roles.find((r) => r.id === id);
const kbVerbs = (r: Role | undefined): readonly string[] => r?.actions.knowledge ?? [];
const accessOf = (sp: KbSpace): KbSpaceAccess => sp.access ?? 'closed';

/**
 * Дата часов домена обязательна (PD-60): вызов без неё — ошибка программиста, а не «бессрочно».
 * Проверяется на входе каждой функции доступа, до ранних выходов, чтобы ошибка не зависела от данных.
 */
export function needToday(o: KbOpts | undefined): KbOpts {
  if (!o?.today) {
    throw new Error(
      'База знаний: нет даты часов домена (KbOpts.today) для сроков назначений, PD-60',
    );
  }
  return o;
}

/** Назначение действует: срока нет или срок не прошёл (PD-60). */
const inForce = (a: Assignment, o: KbOpts): boolean => !a.until || dval(a.until) >= dval(o.today);

/** Владелец бизнеса: системная роль `all`. */
export const isKbOwner = (db: Db, mid: string): boolean =>
  grants(db, mid).some((g) => !!g.roleObj.all);

/** Старшая роль участника в пространстве (руководитель → редактор → читатель) или `null`. */
export function kbSpaceGrant(db: Db, mid: string, sp: KbSpace, o: KbOpts): Assignment | null {
  needToday(o);
  const gs = db.assignments.filter(
    (a) =>
      a.member === mid &&
      a.scope.type === 'space' &&
      a.scope.id === sp.id &&
      KB_ROLE_ORDER.includes(a.role) &&
      inForce(a, o),
  );
  gs.sort((a, b) => KB_ROLE_ORDER.indexOf(a.role) - KB_ROLE_ORDER.indexOf(b.role));
  return gs[0] ?? null;
}

/** Запись списка в пространстве: роль пространства действует только в нём. */
export const kbEntryHas = (db: Db, mid: string, e: Entry, sp: KbSpace): boolean =>
  entryHas(db, mid, e, { space: sp });

export const kbEntryPeople = (db: Db, e: Entry, sp: KbSpace): Member[] =>
  entryPeople(db, e, { space: sp });

interface AreaVerbs {
  verbs: Set<string>;
  via: Grant | null;
}

/** Глаголы БЗ ролей области, которые покрывают область пространства (PD-53: без объектных). */
function areaVerbs(db: Db, mid: string, sp: KbSpace, o: KbOpts): AreaVerbs {
  const verbs = new Set<string>();
  let via: Grant | null = null;
  for (const g of grants(db, mid)) {
    if (g.roleObj.space || g.roleObj.all || isObjectScope(g.scope) || !inForce(g, o)) continue;
    const acts = kbVerbs(g.roleObj);
    if (!acts.length || (sp.unit && !scopeCovers(db, g.scope, sp.unit))) continue;
    for (const v of acts) verbs.add(v);
    via ??= g;
  }
  return { verbs, via };
}

interface SpaceVerbs {
  sg: Assignment | null;
  area: AreaVerbs;
  sv: Set<string>;
  lead: boolean;
}

function spaceVerbs(db: Db, mid: string, sp: KbSpace, o: KbOpts): SpaceVerbs {
  const sg = kbSpaceGrant(db, mid, sp, o);
  const area = areaVerbs(db, mid, sp, o);
  const sv = new Set<string>(sg ? kbVerbs(roleOf(db, sg.role)) : []);
  const level = accessOf(sp);
  if (level === 'open') for (const v of area.verbs) sv.add(v);
  else if (level === 'limited' && area.verbs.has('view')) sv.add('view');
  return { sg, area, sv, lead: sg?.role === 'r-kb-lead' };
}

/** Запись списка узла, под которую попадает участник; «правит» важнее «читает». */
function hitOf(db: Db, mid: string, x: KbNode, sp: KbSpace): KbAccessEntry | null {
  let best: KbAccessEntry | null = null;
  for (const e of x.list ?? []) {
    if (kbEntryHas(db, mid, e, sp) && (!best || e.can === 'edit')) best = e;
  }
  return best;
}

const spaceOf = (db: Db, n: KbNode | undefined): KbSpace | undefined =>
  n ? db.knowledge?.spaces.find((s) => s.id === n.space) : undefined;

/** Доступ сотрудника к узлу дерева с цепочкой причин. */
export function kbAccess(db: Db, mid: string, n: KbNode | undefined, o: KbOpts): KbAccessResult {
  needToday(o);
  const K = db.knowledge;
  const chain: KbAccessResult['chain'] = [];
  const step = (k: KbStepKind, t: string, d: string): void => {
    chain.push({ k, t, d });
  };
  const out = (view: boolean, edit: boolean, x: Partial<KbAccessResult> = {}): KbAccessResult => ({
    view,
    edit,
    chain,
    lead: false,
    create: false,
    fn: false,
    ...x,
  });
  const m = memberOf(db, mid);
  const sp = spaceOf(db, n);
  if (!K || !m || !sp || !n) return out(false, false);
  if (m.status === 'blocked') {
    step('no', 'Организация', 'Сотрудник заблокирован, доступ не действует');
    return out(false, false);
  }
  if (m.status === 'invited') {
    step('wait', 'Организация', 'Приглашение не принято: доступ начнёт действовать после входа');
  } else step('ok', 'Организация', 'Активный сотрудник');
  if (isKbOwner(db, mid)) {
    step('ok', 'Владелец бизнеса', 'Видит и правит всё');
    return out(true, true, { lead: true, owner: true, create: true });
  }
  const path = kbPath(K, n);
  const { sg, area, sv, lead } = spaceVerbs(db, mid, sp, o);
  let from = 0;
  if (!sv.has('view')) {
    const pg = db.assignments
      .filter((a) => a.member === mid && a.scope.type === 'page' && inForce(a, o))
      .map((a) => ({ a, i: path.findIndex((x) => x.id === (a.scope as { id: string }).id) }))
      .filter((x) => x.i >= 0)
      .sort((p, q) => q.i - p.i)[0];
    if (pg) {
      const r = roleOf(db, pg.a.role);
      for (const v of kbVerbs(r)) sv.add(v);
      from = pg.i + 1;
      step(
        'ok',
        'Ветка «' + (path[pg.i] as KbNode).title + '»',
        '«' +
          (r?.name ?? pg.a.role) +
          '» с областью этой страницы' +
          (pg.a.until ? ' до ' + pg.a.until : ''),
      );
    }
  }
  if (!sv.has('view')) {
    step(
      'no',
      'Пространство «' + sp.name + '»',
      accessOf(sp) === 'closed'
        ? 'Закрытое: только участники и владелец бизнеса'
        : 'Нет роли в области «' + areaLabel(db, sp) + '», не участник пространства',
    );
    return out(false, false);
  }
  if (!from) {
    step(
      'ok',
      'Пространство «' + sp.name + '»',
      sg
        ? (roleOf(db, sg.role)?.name ?? sg.role) +
            (sg.via ? ' · ' + sg.via : ' · назначение в пространстве')
        : 'Читатель по уровню «' +
            KB_ACCESS[accessOf(sp)].label +
            '»' +
            (area.via ? ': роль «' + area.via.roleObj.name + '»' : ''),
    );
  }
  let view = true;
  let nearest: { x: KbNode; h: KbAccessEntry | null } | null = null;
  for (let i = from; i < path.length; i++) {
    const x = path[i] as KbNode;
    if (!x.mode || x.mode === 'inherit') continue;
    const h = hitOf(db, mid, x, sp);
    if (x.mode === 'listed' && !h && !lead) {
      view = false;
      step('no', '«' + x.title + '»', 'Свой доступ «Только выбранные»: нет в списке');
      break;
    }
    step(
      'ok',
      '«' + x.title + '»',
      x.mode === 'listed'
        ? h
          ? 'В списке: ' + entryLabel(db, h) + ' — ' + (h.can === 'edit' ? 'правит' : 'читает')
          : 'Свой доступ; руководитель пространства видит всё'
        : 'Читают все, правят выбранные' + (h?.can === 'edit' ? ': ' + entryLabel(db, h) : ''),
    );
    nearest = { x, h };
  }
  const fin = m.function === 'driver' && path.some((x) => x.sensitivity === 'finance');
  if (fin) {
    view = false;
    step('no', 'Функция «Водитель»', 'Финансовые страницы закрыты всегда');
  }
  if (view && n.parent && (!n.mode || n.mode === 'inherit')) {
    step('inh', '«' + n.title + '»', 'Доступ как у родителя');
  }
  if (!view) return out(false, false, { fn: fin });
  if (n.archived && !(lead || sv.has('edit'))) return out(false, false);
  const own = sv.has('create') && n.owner === mid;
  const edit = lead || (nearest ? nearest.h?.can === 'edit' || own : sv.has('edit') || own);
  return out(true, edit, { lead, create: edit || (sv.has('create') && !nearest) });
}

/** Пройдёт ли сотрудник уровни выше узла: пространство и всех родителей. */
export function kbReach(db: Db, mid: string, n: KbNode | undefined, o: KbOpts): KbReach {
  needToday(o);
  const K = db.knowledge;
  const m = memberOf(db, mid);
  const sp = spaceOf(db, n);
  if (!K || !n || !sp || !m || m.status === 'blocked') {
    return { ok: false, why: 'сотрудник заблокирован' };
  }
  if (isKbOwner(db, mid)) return { ok: true };
  if (m.function === 'driver' && kbPath(K, n).some((x) => x.sensitivity === 'finance')) {
    return { ok: false, why: 'функция «Водитель» не открывает финансовые страницы' };
  }
  const p = nodeOf(K, n.parent);
  if (p) {
    return kbAccess(db, mid, p, o).view
      ? { ok: true }
      : { ok: false, why: 'не видит родителя «' + p.title + '»' };
  }
  const { sv } = spaceVerbs(db, mid, sp, o);
  if (sv.has('view')) return { ok: true };
  return {
    ok: false,
    why:
      accessOf(sp) === 'closed'
        ? 'не участник закрытого пространства'
        : 'нет роли в области «' + areaLabel(db, sp) + '» и не участник пространства',
  };
}

export interface KbReachOf {
  m: Member;
  why?: string;
}

/** Кого из подходящих под запись пропустят уровни выше. */
export function kbEntryReach(
  db: Db,
  e: Entry,
  sp: KbSpace,
  n: KbNode,
  o: KbOpts,
): { ppl: Member[]; ok: KbReachOf[]; no: KbReachOf[] } {
  needToday(o);
  const ppl = kbEntryPeople(db, e, sp);
  const ok: KbReachOf[] = [];
  const no: KbReachOf[] = [];
  for (const m of ppl) {
    const r = kbReach(db, m.id, n, o);
    (r.ok ? ok : no).push({ m, why: r.why });
  }
  return { ppl, ok, no };
}

/** Мои права в пространстве (карточка пространства, кнопки «Создать»). */
export function kbSpaceMy(db: Db, mid: string, sp: KbSpace, o: KbOpts): KbSpaceMy {
  needToday(o);
  if (isKbOwner(db, mid)) {
    return {
      owner: true,
      lead: true,
      view: true,
      create: true,
      edit: true,
      role: 'Владелец бизнеса',
    };
  }
  const { sg, sv, lead } = spaceVerbs(db, mid, sp, o);
  const role = sg
    ? (roleOf(db, sg.role)?.name ?? sg.role)
    : sv.has('view')
      ? 'Читатель по уровню «' + KB_ACCESS[accessOf(sp)].label + '»'
      : '';
  return {
    owner: false,
    lead,
    view: sv.has('view'),
    create: lead || sv.has('create'),
    edit: lead || sv.has('edit'),
    role,
  };
}

/** Руководители пространства. */
export function kbLeads(db: Db, sp: KbSpace, o: KbOpts): Member[] {
  needToday(o);
  return db.assignments
    .filter(
      (a) =>
        a.role === 'r-kb-lead' && a.scope.type === 'space' && a.scope.id === sp.id && inForce(a, o),
    )
    .map((a) => memberOf(db, a.member))
    .filter((m): m is Member => !!m);
}
