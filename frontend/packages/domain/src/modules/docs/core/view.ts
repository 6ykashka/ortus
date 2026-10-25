// Проекция «Документов» для участника (documents.js 14.10:526–542): только доступные документы, у
// каждого — что он может (`my`); недоступные финансовые листы скрыты; временный доступ маршрута
// ограничен одной версией; папки — доступные и те, через которые виден документ.
//
// Отличие от эталона: скрытие финансового листа действует и на копии листов в `versions[].sheets`
// (эталон отдавал их целиком — утечка, B §3.3 «Риски»). Срез `C` изменяется на месте, как в эталоне:
// передавайте копию (`structuredClone(db.docs)`).
import { docAccess, docPeople, docRights, finSees } from './access.ts';
import type {
  DocFolder,
  DocItem,
  DocOpts,
  DocRightsResult,
  DocsSlice,
  DocsTenantDb,
  DocWait,
  Sheet,
} from './types.ts';
import { docWaits } from './waits.ts';
import { folderPath } from './tree.ts';

export interface DocMy extends Omit<DocRightsResult, 'chain'> {
  wait: DocWait[];
  people: number;
}

export interface DocItemView extends DocItem {
  my: DocMy;
}

export interface DocFolderView extends DocFolder {
  my: { L: number };
}

export interface DocsView {
  folders: DocFolderView[];
  items: DocItemView[];
  v1: true;
}

const hiddenSheet = (s: Sheet): Sheet => ({
  id: s.id,
  name: s.name,
  fin: true,
  hidden: true,
  cols: s.cols,
  rows: s.rows,
  w: s.w,
  cells: {},
});

/** Ответ сервера участнику. `null` — срез не передан (модуль не подключён). */
export function docsView(
  db: DocsTenantDb,
  actor: string,
  C: DocsSlice | undefined,
  o: DocOpts,
): DocsView | null {
  const X0 = db.docs;
  if (!X0 || !C) return null;
  const items: DocItemView[] = [];
  for (const x of C.items) {
    const d = X0.items.find((y) => y.id === x.id);
    if (!d) continue;
    const { chain, ...my } = docRights(db, actor, d, o);
    void chain;
    if (!my.L) continue;
    const mask = (s: Sheet): Sheet => (s.fin && !finSees(db, actor, d, s) ? hiddenSheet(s) : s);
    if (d.kind === 'sheet' && x.sheets) x.sheets = x.sheets.map(mask);
    x.versions = x.versions.map((v) => (v.sheets ? { ...v, sheets: v.sheets.map(mask) } : v));
    const view = x as DocItemView;
    view.my = { ...my, wait: docWaits(db, actor, d), people: docPeople(db, d, o).length };
    if (my.onlyV) {
      const v = x.versions.find((y) => y.v === my.onlyV);
      if (v?.body) x.body = v.body;
      Object.assign(x, {
        versions: v ? [v] : [],
        comments: [],
        suggestions: [],
        presence: [],
        jobs: [],
        share: [],
        history: [],
        dirty: false,
      });
    }
    items.push(view);
  }
  const vis = new Set(items.map((d) => d.folder));
  const within = (f: DocFolder): boolean =>
    [...vis].some((id) => folderPath(db, id).some((p) => p.id === f.id));
  const folders: DocFolderView[] = [];
  for (const f of C.folders) {
    const my = { L: docAccess(db, actor, X0.folders.find((y) => y.id === f.id) ?? f, o).L };
    if (my.L > 0 || within(f)) folders.push({ ...f, my });
  }
  return { ...C, items, folders };
}
