// Области назначения роли: 11 видов (models.js 14.10 `scopeLabel`, B §1 п. 3, факт 7).
// Территориальные области покрывает `scopeCovers`; объектные — движки модулей и правило PD-53.

export type AreaScope =
  | { type: 'tenant' }
  | { type: 'region'; id: string }
  | { type: 'firm'; id: string }
  | { type: 'self' };

export type ObjectScopeType = 'project' | 'space' | 'page' | 'folder' | 'doc' | 'chat' | 'account';

/** Ссылка на объект для `can(…, obj)`: проект (или направление обращений), пространство, страница, папка, документ, чат, касса. */
export interface ObjectRef {
  type: ObjectScopeType;
  id: string;
}

export type Scope = AreaScope | ObjectRef;

export type ScopeType = Scope['type'];
