// Доступ к документам (documents.js 14.10/19.10:69–147, docs/24 «Доступ»). Цепочка: организация →
// папка и её родители → документ → маршрут → функция сотрудника. Уровни 0–5 с причинами (`chain`).
//
// Отличия от эталона (бриф W7.21):
// - PD-53: глаголы области дают только роли с территориальной областью. Эталон отсекал `project`,
//   `space`, `page`, `folder`, `doc` и `self`, а роль чата или кассы с правами документов проходила
//   в папку «вся организация» (`isObjectScope` ядра закрывает и `chat`, и `account`);
// - PD-60: назначение со сроком `until` раньше `opts.today` не действует (эталон срок не смотрел);
//   дата часов домена обязательна, вызов без неё — ошибка программиста;
// - записи списков — единый `entryHas` ядра (прораб объекта — по id участника).
import { grants } from '../../../core/access/grants.ts';
import { isObjectScope } from '../../../core/access/object-scoped.ts';
import { scopeLabel } from '../../../core/access/scope-label.ts';
import { scopeCovers } from '../../../core/access/units.ts';
import { entryHas } from '../../../core/entries.ts';
import type { Assignment, Entry, Grant, Member, Role } from '../../../core/types/index.ts';
import { DOC_LEVELS, LV } from './dictionaries.ts';
import { entryLabel } from './labels.ts';
import { folderPath } from './tree.ts';
import type {
  DocAccessResult,
  DocChainStep,
  DocFolder,
  DocItem,
  DocLevel,
  DocLevelKey,
  DocOpts,
  DocRightsResult,
  DocStepKind,
  DocsTenantDb,
  Sheet,
  SheetProt,
} from './types.ts';
import { dval } from './util.ts';

type Db = DocsTenantDb;

const memberOf = (db: Db, id: string): Member | undefined => db.members.find((m) => m.id === id);
const roleOf = (db: Db, id: string): Role | undefined => db.roles.find((r) => r.id === id);
const docVerbs = (r: Role | undefined): readonly string[] => r?.actions.docs ?? [];
const lvOf = (key: string | undefined): number => LV[key as DocLevelKey] || 0;

/**
 * Дата часов домена обязательна (PD-60): вызов без неё — ошибка программиста, а не «бессрочно».
 * Проверяется на входе каждой функции доступа, до ранних выходов, чтобы ошибка не зависела от данных.
 */
export function needToday(o: DocOpts | undefined): DocOpts {
  if (!o?.today) {
    throw new Error(
      'Документы: нет даты часов домена (DocOpts.today) для сроков назначений, PD-60',
    );
  }
  return o;
}

/** Назначение действует: срока нет или срок не прошёл (PD-60). */
const inForce = (a: Assignment, o: DocOpts): boolean => !a.until || dval(a.until) >= dval(o.today);

/** Владелец бизнеса: системная роль `all`. */
export const isDocOwner = (db: Db, mid: string): boolean =>
  grants(db, mid).some((g) => !!g.roleObj.all);

/** Области, которые эталон исключал из «роли в области»; объектные добавляет `isObjectScope` (PD-53). */
const AREA_SKIP = new Set(['self', 'project', 'space', 'page', 'folder', 'doc']);

interface AreaLevel {
  L: number;
  via: Grant | null;
}

function areaLevel(db: Db, mid: string, unit: string | null, o: DocOpts): AreaLevel {
  let L = 0;
  let via: Grant | null = null;
  for (const g of grants(db, mid)) {
    const r = g.roleObj;
    if (r.all || r.folderRole || r.docsAddressed || AREA_SKIP.has(g.scope.type)) continue;
    if (isObjectScope(g.scope) || !inForce(g, o)) continue;
    const a = docVerbs(r);
    if (!a.length) continue;
    if (unit ? !scopeCovers(db, g.scope, unit) : g.scope.type !== 'tenant') continue;
    const l = a.includes('settings') ? 5 : a.includes('edit') ? 4 : a.includes('view') ? 1 : 0;
    if (l > L) {
      L = l;
      via = g;
    }
  }
  return { L, via };
}

interface ScopedLevel {
  L: number;
  via: Assignment | null;
}

/** Назначение роли папки или документа (`docLevel` роли) на этот объект. */
function scopedLevel(
  db: Db,
  mid: string,
  type: 'folder' | 'doc',
  id: string,
  o: DocOpts,
): ScopedLevel {
  let L = 0;
  let via: Assignment | null = null;
  for (const a of db.assignments) {
    if (a.member !== mid || a.scope.type !== type || a.scope.id !== id || !inForce(a, o)) continue;
    const l = (roleOf(db, a.role) as { docLevel?: number } | undefined)?.docLevel || 0;
    if (l > L) {
      L = l;
      via = a;
    }
  }
  return { L, via };
}

function listLevel(
  db: Db,
  mid: string,
  list: readonly Entry[] | undefined,
): { L: number; hit: Entry | null } {
  let L = 0;
  let hit: Entry | null = null;
  for (const e of list ?? []) {
    const l = lvOf(e.level);
    if (l > L && entryHas(db, mid, e)) {
      L = l;
      hit = e;
    }
  }
  return { L, hit };
}

const levelName = (L: number): string => DOC_LEVELS[L] ?? DOC_LEVELS[0];
const untilTail = (a: { until?: string } | null): string => (a?.until ? ' до ' + a.until : '');

/** Доступ сотрудника к документу или папке с цепочкой причин. */
export function docAccess(
  db: Db,
  mid: string,
  x: DocItem | DocFolder,
  o: DocOpts,
): DocAccessResult {
  needToday(o);
  const chain: DocChainStep[] = [];
  const step = (k: DocStepKind, t: string, d: string): void => {
    chain.push({ k, t, d });
  };
  const isDoc = 'kind' in x && !!x.kind;
  const fid = isDoc ? (x as DocItem).folder : x.id;
  const path = folderPath(db, fid);
  const m = memberOf(db, mid);
  const out = (L: number, extra: Partial<DocAccessResult> = {}): DocAccessResult => ({
    L: L as DocLevel,
    level: levelName(L),
    chain,
    ...extra,
  });
  if (!m) return out(0);
  if (m.status === 'blocked') {
    step('no', 'Организация', 'Сотрудник заблокирован: доступ не действует');
    return out(0);
  }
  step(
    m.status === 'invited' ? 'wait' : 'ok',
    'Организация',
    m.status === 'invited'
      ? 'Приглашение не принято: доступ начнёт действовать после входа'
      : 'Активный сотрудник',
  );
  const fin =
    (isDoc && (x as DocItem).sensitivity === 'finance') ||
    path.some((f) => f.sensitivity === 'finance');
  if (fin && m.function === 'driver') {
    step(
      'no',
      'Функция «Водитель»',
      'Финансовые документы закрыты всегда, независимо от ролей и групп',
    );
    return out(0, { fn: true });
  }
  if (isDocOwner(db, mid)) {
    step('ok', 'Владелец бизнеса', 'Видит и правит всё, выдаёт любой уровень');
    return out(5, { owner: true, fin });
  }
  let L = 0;
  path.forEach((f, i) => {
    if (f.mode === 'listed') {
      if (L)
        step(
          'up',
          'Папка «' + f.name + '»',
          'Только выбранные: роли области и папки выше не действуют',
        );
      L = 0;
    } else if (i === 0) {
      const a = areaLevel(db, mid, f.unit, o);
      if (a.L && a.via) {
        L = a.L;
        step(
          'ok',
          'Роль в области',
          '«' + a.via.roleObj.name + '» · ' + scopeLabel(db, a.via.scope) + ' → ' + levelName(a.L),
        );
      }
    }
    const sc = scopedLevel(db, mid, 'folder', f.id, o);
    const li = listLevel(db, mid, f.share);
    if (Math.max(sc.L, li.L) > L) {
      L = Math.max(sc.L, li.L);
      step(
        'ok',
        'Папка «' + f.name + '»',
        sc.L >= li.L && sc.via
          ? 'Назначение «' +
              (roleOf(db, sc.via.role)?.name ?? sc.via.role) +
              '» в папке' +
              untilTail(sc.via)
          : (li.hit ? entryLabel(db, li.hit) : '—') + ' → ' + levelName(li.L),
      );
    }
  });
  if (!isDoc) {
    if (!L) {
      step(
        'no',
        'Папка «' + (x as DocFolder).name + '»',
        'Нет роли в области, назначения в папке и записи в списке доступа',
      );
    }
    return out(L, { fin });
  }
  const d = x as DocItem;
  if (d.mode === 'listed') {
    if (L)
      step('up', '«' + d.title + '»', 'Свой доступ «Только выбранные»: доступ папки не действует');
    L = 0;
  } else if (L) step('inh', '«' + d.title + '»', 'Доступ как у папки');
  const sc = scopedLevel(db, mid, 'doc', d.id, o);
  const li = listLevel(db, mid, d.share);
  if (Math.max(sc.L, li.L) > L) {
    L = Math.max(sc.L, li.L);
    step(
      'ok',
      'Документ',
      sc.L >= li.L && sc.via
        ? 'Назначение «' + (roleOf(db, sc.via.role)?.name ?? sc.via.role) + '»' + untilTail(sc.via)
        : (li.hit ? entryLabel(db, li.hit) : '—') + ' → ' + levelName(li.L),
    );
  }
  if (d.owner === mid && L < 5) {
    L = 5;
    step('ok', 'Владелец документа', 'Создал документ или получил его от предыдущего владельца');
  }
  const tm = d.tmp.filter((t) => t.member === mid).sort((a, b) => lvOf(b.level) - lvOf(a.level))[0];
  let onlyV: number | null = null;
  if (tm && lvOf(tm.level) > L) {
    L = lvOf(tm.level);
    onlyV = tm.v || null;
    step('ok', 'Маршрут', tm.why);
  }
  if (!L) {
    step(
      'no',
      '«' + d.title + '»',
      d.mode === 'listed'
        ? 'Нет в списке «Только выбранные»'
        : 'Нет доступа к папке «' +
            (path[path.length - 1]?.name ?? '—') +
            '» и записи в списке документа',
    );
  }
  return out(L, { fin, onlyV });
}

/** Есть ли у сотрудника глагол роли для документа: по области, папке, документу или «только своё». */
function hasVerb(db: Db, mid: string, d: DocItem, verb: string, o: DocOpts): boolean {
  const path = folderPath(db, d.folder);
  const ids = new Set(path.map((f) => f.id));
  const unit = path[0]?.unit;
  return grants(db, mid).some((g) => {
    const s = g.scope;
    if (!docVerbs(g.roleObj).includes(verb) || !inForce(g, o)) return false;
    switch (s.type) {
      case 'tenant':
        return true;
      case 'region':
      case 'firm':
        return !!unit && scopeCovers(db, s, unit);
      case 'folder':
        return ids.has(s.id);
      case 'doc':
        return s.id === d.id;
      case 'self':
        return (
          d.owner === mid ||
          [...path.map((f) => f.share), d.share]
            .flat()
            .some((e) => e.who === 'relation' && entryHas(db, mid, e))
        );
      default:
        return false;
    }
  });
}

/** Права на документ по уровню: что можно показывать кнопками и разрешать командам. */
export function docRights(db: Db, mid: string, d: DocItem, o: DocOpts): DocRightsResult {
  const a = docAccess(db, mid, d, o);
  const L = a.L;
  const own = !!a.owner;
  const locked = !!(d.route?.status === 'active' && d.route.rules?.lock) || !!d.pdfa;
  return {
    ...a,
    view: L >= 1,
    comment: L >= 2,
    suggest: L >= 3 && !locked,
    edit: L >= 4 && !locked,
    editL: L >= 4,
    manage: L === 5,
    locked,
    share: L > 0 && (own || L === 5 || (L >= 2 && hasVerb(db, mid, d, 'settings', o))),
    maxGrant: L === 5 ? 5 : Math.min(L, 4),
    ext: own,
    export: L > 0 && (own || L >= 4 || hasVerb(db, mid, d, 'export', o)),
    sign: L > 0 && (own || hasVerb(db, mid, d, 'review', o)),
    route: L >= 4 && !d.pdfa,
  };
}

/** Видит ли участник финансовый лист: не водитель и (владелец, право «финансы · читать» или список листа). */
export function finSees(
  db: Db,
  mid: string,
  _d: DocItem,
  sh: Pick<Sheet, 'finWho'> | undefined,
): boolean {
  const m = memberOf(db, mid);
  if (!m || m.function === 'driver') return false;
  return (
    isDocOwner(db, mid) ||
    grants(db, mid).some((g) => g.roleObj.finance.read) ||
    (sh?.finWho ?? []).includes(mid)
  );
}

/** Правит ли участник защищённый диапазон: владелец бизнеса или запись списка диапазона. */
export const protEdit = (db: Db, mid: string, pr: Pick<SheetProt, 'who'>): boolean =>
  isDocOwner(db, mid) || (pr.who ?? []).some((e) => entryHas(db, mid, e));

/** Строка настроек встроенного движка по правам. */
export function engineCfg(
  r: Pick<DocRightsResult, 'edit' | 'suggest' | 'comment' | 'export'>,
  kind: string,
): string {
  const review = kind !== 'sheet' && r.suggest;
  return (
    'edit: ' +
    r.edit +
    ' · review: ' +
    (r.edit || review) +
    ' · comment: ' +
    r.comment +
    ' · download: ' +
    r.export +
    ' · print: ' +
    r.export
  );
}

/** Сотрудники, у которых есть хоть какой-то доступ к документу. */
export const docPeople = (db: Db, d: DocItem, o: DocOpts): Member[] =>
  db.members.filter((m) => m.status !== 'blocked' && docAccess(db, m.id, d, o).L > 0);
