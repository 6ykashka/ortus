// W1.54 · Модель «Структуры» (S1-08, no-reference): дерево из плоского `listOrgUnits`, путь узла, вид нового
// узла (Q-W1.54-3), цели переноса (Q-W1.54-4), строки предпросмотра влияния `previewOrgUnitMove` (Q-W1.54-5) и
// проверка названия (`OrgUnitCreate.name`: 1…150 символов).
import type { components } from '@ortus/api-client';
import type { ScopedCapabilityLike } from '@ortus/domain/nav';
import { format } from '@ortus/texts';

import { STRUCTURE_TEXT as T } from './texts.ts';

type OrgUnit = components['schemas']['OrgUnit'];
type Preview = components['schemas']['OrgUnitMovePreview'];
export type Kind = OrgUnit['kind'];

export interface TreeNode {
  unit: OrgUnit;
  depth: number;
  children: TreeNode[];
}

export interface ImpactView {
  /** Что переносится: вложенные подразделения и сотрудники. */
  facts: string[];
  /** «{имя} · {роль}» тех, кто получит доступ. */
  gains: string[];
  losses: string[];
  /** Доступ ни у кого не меняется (нет ни видимых, ни скрытых затронутых). */
  none: boolean;
  /** «Ещё N — вне вашей области просмотра» или `null`. */
  hidden: string | null;
}

export interface Option {
  value: string;
  label: string;
}

const NAME_MAX = 150;
const MANAGE = 'org_units.manage';
const byName = (a: TreeNode, b: TreeNode): number =>
  a.unit.name.localeCompare(b.unit.name, 'ru') || a.unit.id.localeCompare(b.unit.id);

/** Дерево: корни — узлы без родителя или с невидимым родителем (вне области), дети — по названию. */
export function buildTree(units: readonly OrgUnit[]): TreeNode[] {
  const ids = new Set(units.map((x) => x.id));
  const kids = new Map<string | null, OrgUnit[]>();
  for (const unit of units) {
    const parent = unit.parentId && ids.has(unit.parentId) ? unit.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), unit]);
  }
  const grow = (parent: string | null, depth: number): TreeNode[] =>
    (kids.get(parent) ?? [])
      .map((unit) => ({ unit, depth, children: grow(unit.id, depth + 1) }))
      .sort(byName);
  return grow(null, 0);
}

/** Узлы в порядке дерева (сначала узел, затем его поддерево). */
export function flatten(tree: readonly TreeNode[]): TreeNode[] {
  return tree.flatMap((n) => [n, ...flatten(n.children)]);
}

/** Путь узла: названия видимых предков и самого узла через « / »; неизвестный id — пустая строка. */
export function pathOf(units: readonly OrgUnit[], id: string): string {
  const byId = new Map(units.map((x) => [x.id, x]));
  const names: string[] = [];
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = byId.get(cur.parentId ?? '')) {
    seen.add(cur.id);
    names.unshift(cur.name);
  }
  return names.join(' / ');
}

export const kindLabel = (kind: Kind): string => T.kinds[kind];

const NEXT: Record<Kind, Kind> = {
  region: 'company',
  company: 'branch',
  branch: 'team',
  team: 'team',
};

/** Вид нового узла по умолчанию: следующий уровень после родителя; верхний уровень — регион. */
export const childKind = (parent: Kind | null): Kind => (parent ? NEXT[parent] : 'region');

/** Узел и все его потомки. */
export function subtreeOf(units: readonly OrgUnit[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const x of units) {
      if (x.parentId && out.has(x.parentId) && !out.has(x.id)) {
        out.add(x.id);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * Куда можно перенести: активные узлы вне поддерева, кроме текущего родителя, и где `allowed` (право на нового
 * родителя); в порядке дерева, подпись — путь.
 */
export function moveTargets(
  units: readonly OrgUnit[],
  id: string,
  allowed: (id: string) => boolean = () => true,
): Option[] {
  const moved = subtreeOf(units, id);
  const parent = units.find((x) => x.id === id)?.parentId ?? null;
  return flatten(buildTree(units))
    .map((n) => n.unit)
    .filter((x) => x.status === 'active' && !moved.has(x.id) && x.id !== parent && allowed(x.id))
    .map((x) => ({ value: x.id, label: pathOf(units, x.id) }));
}

/** Где действующий может изменять структуру (org_units.manage): вся организация и/или узлы. */
export interface ManageScope {
  /** Право на всю организацию (владелец или область `tenant`): в том числе верхний уровень. */
  tenant: boolean;
  /** Узлы областей `org_unit` (с поддеревом, если `includeDescendants`). */
  units: ReadonlySet<string>;
  /** Хоть где-то есть право изменения. */
  any: boolean;
}

/**
 * Область org_units.manage по возможностям /me/context (Q-W1.54-12). Как на сервере (units.go): создание на верхнем
 * уровне — право на всю организацию, под узлом — право на узел; переименование — право на сам узел; перенос — на
 * узел, старого и нового родителя.
 */
export function manageScope(
  owner: boolean,
  caps: readonly ScopedCapabilityLike[],
  units: readonly OrgUnit[],
): ManageScope {
  const own = caps.filter((c) => c.permission === MANAGE);
  const tenant = owner || own.some((c) => c.scope.kind === 'tenant');
  const ids = new Set<string>();
  for (const c of own) {
    if (c.scope.kind !== 'org_unit') continue;
    for (const rid of c.scope.resourceIds) {
      for (const x of c.scope.includeDescendants ? subtreeOf(units, rid) : [rid]) ids.add(x);
    }
  }
  return { tenant, units: ids, any: tenant || ids.size > 0 };
}

/** Право изменения на узел (`null` — верхний уровень: только право на всю организацию). */
export const mayManage = (s: ManageScope, id: string | null): boolean =>
  s.tenant || (id !== null && s.units.has(id));

export interface Commands {
  add: boolean;
  rename: boolean;
  move: boolean;
}

/** Команды узла: добавить и переименовать — право на узел; перенести — ещё и на текущего родителя. */
export function commandsFor(s: ManageScope, unit: OrgUnit): Commands {
  const own = mayManage(s, unit.id);
  return { add: own, rename: own, move: own && mayManage(s, unit.parentId ?? null) };
}

/** Ошибка названия до отправки: пусто — «Укажите название», длиннее 150 — «Не длиннее 150 символов». */
export function nameError(name: string): string | null {
  const v = name.trim();
  if (!v) return T.name.required;
  if (v.length > NAME_MAX) return T.name.tooLong;
  return null;
}

/** Строки предпросмотра влияния переноса; роль — по `roleId` из `listRoles`, без неё — только имя. */
export function impactView(p: Preview, roles: ReadonlyMap<string, string>): ImpactView {
  const line = (x: Preview['affectedPeople'][number]): string => {
    const role = roles.get(x.roleId);
    return role ? `${x.displayName} · ${role}` : x.displayName;
  };
  return {
    facts: [
      format(T.move.descendants, { n: p.descendantUnitCount }),
      format(T.move.members, { n: p.memberCount }),
    ],
    gains: p.affectedPeople.filter((x) => x.change === 'gains').map(line),
    losses: p.affectedPeople.filter((x) => x.change === 'loses').map(line),
    none: p.affectedPeople.length === 0 && p.hiddenCount === 0,
    hidden: p.hiddenCount > 0 ? format(T.move.hidden, { n: p.hiddenCount }) : null,
  };
}

/** Предпросмотр рассчитан для этого узла и этой цели (кнопка «Перенести» доступна только тогда). */
export const sameTarget = (p: Preview | undefined, unitId: string, parentId: string): boolean =>
  !!p && p.orgUnitId === unitId && p.toParentId === parentId;
