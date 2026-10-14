// Объектные области (B факт 6–7, PD-53): роль, выданная на проект, пространство, страницу, папку,
// документ, чат или кассу, действует только на этот объект.
import type { ObjectRef, ObjectScopeType, Scope } from '../types/index.ts';

export const OBJECT_SCOPE_TYPES: readonly ObjectScopeType[] = [
  'project',
  'space',
  'page',
  'folder',
  'doc',
  'chat',
  'account',
];

const OBJECT_TYPES = new Set<string>(OBJECT_SCOPE_TYPES);

export const isObjectScope = (s: Scope | undefined): s is ObjectRef =>
  !!s && OBJECT_TYPES.has(s.type);

/** Область назначения — ровно этот объект. */
export const scopeIsObject = (s: Scope | undefined, obj: ObjectRef | undefined): boolean =>
  !!obj && isObjectScope(s) && s.type === obj.type && s.id === obj.id;
