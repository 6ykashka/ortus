// Модуль «Документы · ядро» (W7.21, P1e docs-core): доступ с цепочкой причин, права, влияние на
// доступ, поля CRM, шаблоны, сид и проекция из прототипа 14.10/19.10. Общие имена эталона (`unitName`,
// `entryLabel`, `folderOf`, `addWork`) экспортируются с префиксом `doc`/`docs`, чтобы не пересечься
// с базой знаний и чатами. Табличный движок — W7.20, маршрут — W7.22.
export type * from './types.ts';
export type { DocRole } from './dictionaries.ts';
export type { DocSharePatch } from './impact.ts';
export type { DocFolderView, DocItemView, DocMy, DocsView } from './view.ts';
export { createDocsCoreModule, docsCoreModule, docsHook } from './module.ts';
export { docsSeed, installDocs } from './seed.ts';
export {
  APPROVE_MODES,
  DOC_KINDS,
  DOC_LEVEL_HINT,
  DOC_LEVELS,
  DOC_ROLES,
  DOC_TEMPLATES,
  LV,
  LV_KEY,
  STEP_KINDS,
} from './dictionaries.ts';
export {
  docAccess,
  docPeople,
  docRights,
  engineCfg,
  finSees,
  isDocOwner,
  needToday as docNeedToday,
  protEdit,
} from './access.ts';
export { docMoveImpact, docShareImpact } from './impact.ts';
export { docStatus, docWaits, stepWaiting } from './waits.ts';
export { fieldVals, fillTokens } from './fields.ts';
export { docsOf, folderLabel, folderOf, folderPath } from './tree.ts';
export { entryLabel as docEntryLabel, unitName as docUnitName } from './labels.ts';
export { addWorkDays, dval as docDval, HOLIDAYS, shaOf } from './util.ts';
export { docsView } from './view.ts';
