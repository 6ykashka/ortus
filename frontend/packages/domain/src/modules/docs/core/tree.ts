// Дерево папок документов (documents.js 14.10:41–46). Срез `db.docs` не создан — пустой.
import type { DocFolder, DocsSlice, DocsTenantDb } from './types.ts';

const EMPTY: DocsSlice = { folders: [], items: [], v1: true };

export const docsOf = (db: DocsTenantDb): DocsSlice => db.docs ?? EMPTY;

export const folderOf = (db: DocsTenantDb, id: string | null | undefined): DocFolder | undefined =>
  docsOf(db).folders.find((f) => f.id === id);

/** Путь от корня до папки; цикл по `parent` обрывается на 20 уровнях. */
export function folderPath(db: DocsTenantDb, id: string | null | undefined): DocFolder[] {
  const out: DocFolder[] = [];
  let f = folderOf(db, id);
  let guard = 0;
  while (f && guard++ < 20) {
    out.unshift(f);
    f = f.parent ? folderOf(db, f.parent) : undefined;
  }
  return out;
}

export const folderLabel = (db: DocsTenantDb, id: string | null | undefined): string =>
  folderPath(db, id)
    .map((f) => f.name)
    .join(' › ');
