// Общие перечисления домена (models.js 14.10: VERBS, INDUSTRY, CORE, REASON, TONES).

export type Verb = 'view' | 'create' | 'edit' | 'review' | 'export' | 'settings';

export type IndustryKey = 'logistics' | 'spa' | 'repair';

export type CoreKey =
  | 'calendar'
  | 'tasks'
  | 'knowledge'
  | 'docs'
  | 'forms'
  | 'data'
  | 'files'
  | 'inventory'
  | 'cash'
  | 'service'
  | 'chat'
  | 'notifications';

export type ModuleKey = IndustryKey | CoreKey;

/** Причина отказа `can` (ключ `REASON`). */
export type Reason =
  'module_off' | 'module_readonly' | 'no_permission' | 'no_scope' | 'driver_block';

export type ToneKey = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

/** Разрешения модуля по действиям роли (`INDUSTRY[*].perms`, `CORE[*].perms`). */
export type ModulePerms = Partial<Record<Verb, readonly string[]>>;
