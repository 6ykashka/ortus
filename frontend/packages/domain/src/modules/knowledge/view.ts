// Ответ сервера участнику (`kbView`, knowledge.js 14.10:212–222, api.js:208): только видимые страницы,
// у каждой — что он может; пространства — по своим правам или видимым страницам; таблицы и записи —
// видимых страниц; запросы — руководителю пространства или автору; правила и журнал — руководителю.
import { kbAccess, kbLeads, kbSpaceMy, needToday } from './access.ts';
import { nodeOf } from './tree.ts';
import type { KbNode, KbOpts, KbSpace, KbSpaceMy, KbTenantDb, KnowledgeSlice } from './types.ts';

export type KbNodeView = KbNode & { my?: { edit: boolean; lead: boolean; create: boolean } };
export type KbSpaceView = KbSpace & { my?: KbSpaceMy; leads?: string[] };
export type KnowledgeView = Omit<KnowledgeSlice, 'pages' | 'spaces'> & {
  pages: KbNodeView[];
  spaces: KbSpaceView[];
};

/** Проекция среза `C` (копии `db.knowledge`) для участника; до миграции v2 — срез как есть. */
export function kbView(
  db: KbTenantDb,
  actor: string,
  C: KnowledgeSlice | undefined,
  o: KbOpts,
): KnowledgeView | undefined {
  needToday(o);
  const K = db.knowledge;
  if (!K?.v2 || !C) return C;
  const pages: KbNodeView[] = [];
  for (const p of C.pages) {
    const a = kbAccess(db, actor, nodeOf(K, p.id) ?? p, o);
    if (a.view) pages.push({ ...p, my: { edit: a.edit, lead: a.lead, create: a.create } });
  }
  const vis = new Set(pages.map((p) => p.id));
  const spaces = C.spaces
    .map((s): KbSpaceView & { my: KbSpaceMy } => ({
      ...s,
      my: kbSpaceMy(db, actor, s, o),
      leads: kbLeads(db, s, o).map((m) => m.name),
    }))
    .filter((s) => s.my.view || pages.some((p) => p.space === s.id));
  const leadOf = new Set(spaces.filter((s) => s.my.lead).map((s) => s.id));
  return {
    ...C,
    spaces,
    pages,
    tables: (C.tables ?? []).filter((t) => vis.has(t.page)),
    entries: (C.entries ?? []).filter((e) => vis.has(e.page)),
    requests: (C.requests ?? []).filter((r) => leadOf.has(r.space) || r.member === actor),
    rules: (C.rules ?? []).filter((r) => leadOf.has(r.space)),
    runs: (C.runs ?? []).filter((r) => leadOf.has(r.space)),
  };
}
