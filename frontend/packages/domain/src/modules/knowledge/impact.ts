// Последствия до сохранения (knowledge.js 14.10:183–210, docs/23 принцип 7): сколько страниц ветки
// изменится и кто получит или потеряет чтение и правку. Считается на копии среза — БД не меняется.
// Узла нет — пустой ответ (эталон падал).
import { kbAccess, needToday } from './access.ts';
import { kbSubtree, nodeOf } from './tree.ts';
import type { KbAccessEntry, KbMode, KbNode, KbOpts, KbTenantDb, KnowledgeSlice } from './types.ts';

export interface KbAccessPatch {
  mode: KbMode;
  list: KbAccessEntry[];
  /** Сбросить свой доступ подстраниц на «Как у родителя». */
  applyOwn?: boolean;
}

export interface KbImpactResult {
  pages: number;
  inherit: number;
  /** Подстраницы со своим доступом (названия). */
  own: string[];
  gainView: string[];
  loseView: string[];
  gainEdit: string[];
  loseEdit: string[];
  ids: Set<string>;
}

export interface KbMoveImpactResult {
  pages: number;
  lose: string[];
  gain: string[];
}

const hasOwnMode = (x: KbNode): boolean => !!x.mode && x.mode !== 'inherit';

interface Delta {
  gv: number;
  lv: number;
  ge: number;
  le: number;
}

/** Сравнение доступа каждого незаблокированного участника к узлам ветки до и после. */
function compare(
  db: KbTenantDb,
  db2: KbTenantDb & { knowledge: KnowledgeSlice },
  sub: KbNode[],
  o: KbOpts,
  each: (name: string, d: Delta) => void,
): void {
  for (const m of db.members) {
    if (m.status === 'blocked') continue;
    const d: Delta = { gv: 0, lv: 0, ge: 0, le: 0 };
    for (const x of sub) {
      const a = kbAccess(db, m.id, x, o);
      const b = kbAccess(db2, m.id, nodeOf(db2.knowledge, x.id), o);
      if (!a.view && b.view) d.gv++;
      if (a.view && !b.view) d.lv++;
      if (!a.edit && b.edit) d.ge++;
      if (a.edit && !b.edit) d.le++;
    }
    each(m.name, d);
  }
}

const line = (name: string, n: number): string => name + ' · ' + n;

export function kbImpact(
  db: KbTenantDb,
  nodeId: string,
  patch: KbAccessPatch,
  o: KbOpts,
): KbImpactResult {
  const res: KbImpactResult = {
    pages: 0,
    inherit: 0,
    own: [],
    gainView: [],
    loseView: [],
    gainEdit: [],
    loseEdit: [],
    ids: new Set(),
  };
  needToday(o);
  const K = db.knowledge;
  const n = K && nodeOf(K, nodeId);
  if (!K || !n) return res;
  const sub = kbSubtree(K, n);
  const own = sub.filter((x) => x.id !== n.id && hasOwnMode(x));
  const ownIds = new Set(own.map((x) => x.id));
  const pages = K.pages.map((p) =>
    p.id === n.id
      ? { ...p, mode: patch.mode, list: patch.list }
      : patch.applyOwn && ownIds.has(p.id)
        ? { ...p, mode: 'inherit' as const, list: [] }
        : p,
  );
  const db2 = { ...db, knowledge: { ...K, pages } };
  res.pages = sub.length;
  res.inherit = sub.length - 1 - own.length;
  res.own = own.map((x) => x.title);
  compare(db, db2, sub, o, (name, d) => {
    if (d.gv) res.gainView.push(line(name, d.gv));
    if (d.lv) res.loseView.push(line(name, d.lv));
    if (d.ge) res.gainEdit.push(line(name, d.ge));
    if (d.le) res.loseEdit.push(line(name, d.le));
  });
  res.ids = new Set(sub.map((x) => x.id));
  return res;
}

/** Кто потеряет или получит чтение, если перенести ветку под другого родителя (`null` — в корень). */
export function kbMoveImpact(
  db: KbTenantDb,
  nodeId: string,
  parentId: string | null,
  o: KbOpts,
): KbMoveImpactResult {
  needToday(o);
  const K = db.knowledge;
  const n = K && nodeOf(K, nodeId);
  if (!K || !n) return { pages: 0, lose: [], gain: [] };
  const sub = kbSubtree(K, n);
  const pages = K.pages.map((p) => (p.id === nodeId ? { ...p, parent: parentId || null } : p));
  const db2 = { ...db, knowledge: { ...K, pages } };
  const lose: string[] = [];
  const gain: string[] = [];
  compare(db, db2, sub, o, (name, d) => {
    if (d.lv) lose.push(line(name, d.lv));
    if (d.gv) gain.push(line(name, d.gv));
  });
  return { pages: sub.length, lose, gain };
}
