// Последствия смены доступа (documents.js 14.10:149–160): кто получит и кто потеряет доступ, если
// поменять список документа или перенести его в другую папку. Считается теми же `docAccess`.
import { docAccess } from './access.ts';
import type { DocEntry, DocImpact, DocItem, DocMode, DocOpts, DocsTenantDb } from './types.ts';

function diffAccess(db: DocsTenantDb, d: DocItem, d2: DocItem, o: DocOpts): DocImpact {
  const out: DocImpact = { gain: [], lose: [], up: [], down: [] };
  for (const m of db.members) {
    if (m.status === 'blocked') continue;
    const a = docAccess(db, m.id, d, o).L;
    const b = docAccess(db, m.id, d2, o).L;
    if (a === b) continue;
    const x = { id: m.id, name: m.name, from: a, to: b, invited: m.status === 'invited' };
    (a === 0 ? out.gain : b === 0 ? out.lose : b > a ? out.up : out.down).push(x);
  }
  return out;
}

export interface DocSharePatch {
  mode?: DocMode;
  share?: DocEntry[];
}

export const docShareImpact = (
  db: DocsTenantDb,
  d: DocItem,
  patch: DocSharePatch,
  o: DocOpts,
): DocImpact =>
  diffAccess(db, d, { ...d, mode: patch.mode ?? d.mode, share: patch.share ?? d.share }, o);

export const docMoveImpact = (
  db: DocsTenantDb,
  d: DocItem,
  folder: string,
  o: DocOpts,
): DocImpact => diffAccess(db, d, { ...d, folder }, o);
