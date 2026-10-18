// Модуль «База знаний» (W4.30, P1c knowledge): пространства, дерево и доступ из прототипа 14.10.
// Общие имена эталона (`nodeOf`, `dval`, `unitName`, `areaLabel`, `entryLabel`, `makeSection`)
// экспортируются с префиксом `kb`, чтобы не пересечься с документами и чатами.
export type * from './types.ts';
export type { KbAccessInfo, KbTemplate, KbTemplateNode } from './dictionaries.ts';
export type { KbAccessPatch, KbImpactResult, KbMoveImpactResult } from './impact.ts';
export type { KbReachOf } from './access.ts';
export type { KbSectionObject } from './sections.ts';
export type {
  KbColumnInput,
  KbCreatePageInput,
  KbCreateSpaceInput,
  KbPublishInput,
  KbSetAccessInput,
  KbTableInput,
  KnowledgeApi,
} from './commands.ts';
export type { KbNodeView, KbSpaceView, KnowledgeView } from './view.ts';
export { createKnowledgeModule, knowledgeHook, knowledgeModule } from './module.ts';
export { knowledgeSeed } from './seed.ts';
export { migrateKnowledgeV2 } from './migrate-v2.ts';
export {
  KB_ACCESS,
  KB_BODY_MAX,
  KB_COLORS,
  KB_ICONS,
  KB_KINDS,
  KB_MAX_DEPTH,
  KB_MODES,
  KB_REQUEST_DAYS,
  KB_ROLE_CAPS,
  KB_ROLE_ORDER,
  KB_ROLES,
  KB_RUNS_KEPT,
  KB_SECTION,
  KB_STATUS,
  KB_TEMPLATES,
} from './dictionaries.ts';
export {
  dval as kbDval,
  kbDepth,
  kbHeight,
  kbKids,
  kbPath,
  kbSubtree,
  kbTop,
  nodeOf as kbNodeOf,
} from './tree.ts';
export {
  areaLabel as kbAreaLabel,
  entryLabel as kbEntryLabel,
  unitName as kbUnitName,
} from './labels.ts';
export {
  isKbOwner,
  kbAccess,
  kbEntryHas,
  kbEntryPeople,
  kbEntryReach,
  kbLeads,
  kbReach,
  kbSpaceGrant,
  kbSpaceMy,
} from './access.ts';
export { kbImpact, kbMoveImpact } from './impact.ts';
export { KB_OBJ_42, kbEditors, kbNode, makeSection as kbMakeSection } from './sections.ts';
export { KB_DELAYS, KB_METHODS, knowledgeCommands } from './commands.ts';
export { kbView } from './view.ts';
