// Сущности ядра: оргструктура, участники, роли, назначения, события (models.js:5–7, mock-data.js 14.10).
// Срезы модулей (`knowledge`, `docs`, `chats`, `cash`, `service`, `repair`, …) добавляют их владельцы
// через расширение `ModuleSlices` (augmentation исходного модуля, относительным путём):
//
//   declare module '../../core/types/entities-core.ts' { interface ModuleSlices { cash?: CashSlice } }
//
import type { ModuleKey, Reason, Verb } from './common.ts';
import type { Scope } from './scope.ts';

export interface Unit {
  id: string;
  type: 'region' | 'firm';
  name: string;
  parent?: string;
}

export interface ModuleState {
  enabled: boolean;
  /** Модуль отключён, история доступна для чтения (`module_readonly`). */
  history?: boolean;
}

export type MemberStatus = 'active' | 'invited' | 'blocked';

export interface Member {
  id: string;
  name: string;
  email?: string;
  status: MemberStatus;
  title?: string;
  /** Функция «Водитель» запрещает начисления (`driver_block`). */
  function?: 'driver';
  invitedNote?: string;
}

export interface Group {
  id: string;
  name: string;
  members: string[];
}

/** Параметры роли в кассе (`role.cash`, cash.js). `null` — без лимита. */
export interface RoleCashOptions {
  balance?: boolean;
  self?: boolean;
  out?: number | null;
  refund?: number | null;
  advance?: number | null;
}

export interface Role {
  id: string;
  name: string;
  kind: 'system' | 'template' | 'custom';
  /** Системная роль владельца: все права во всей организации. */
  all?: boolean;
  professional?: 'driver';
  /** Роль проекта (назначается с областью `project`). */
  project?: boolean;
  /** Роль пространства Базы знаний (область `space`). */
  space?: boolean;
  /** Роль папки документов (область `folder`). */
  folderRole?: boolean;
  docsAddressed?: boolean;
  chatRole?: string;
  actions: Partial<Record<ModuleKey, readonly Verb[]>>;
  finance: { read: boolean; manage: boolean };
  cash?: RoleCashOptions;
}

export interface Assignment {
  id: string;
  member: string;
  role: string;
  scope: Scope;
  via?: string;
  until?: string;
}

/** Назначение вместе с ролью (`grants()` эталона). */
export interface Grant extends Assignment {
  roleObj: Role;
}

export type CanResult = { ok: true; via: Grant } | { ok: false; reason: Reason };

export interface DomainEvent {
  id: string;
  at: string;
  text: string;
  to: string[];
  /** Чувствительное событие (начисления): видно только с правом финансов в `unit`. */
  sensitive: string | null;
  unit?: string;
}

/** Минимум проекта задач, который нужен ядру (`scopeLabel`, `TaskPort`). */
export interface ProjectRef {
  id: string;
  name: string;
  key?: string;
  unit?: string;
  flow?: string;
}

/** Расширяется модулями (declaration merging). Ядро читает срезы только структурно. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ModuleSlices {}

export interface CoreDb {
  tenantId: string;
  seq: number;
  units: Unit[];
  modules: Partial<Record<ModuleKey, ModuleState>>;
  members: Member[];
  groups?: Group[];
  roles: Role[];
  assignments: Assignment[];
  events?: DomainEvent[];
  projects?: ProjectRef[];
}

export type TenantDb = CoreDb & ModuleSlices;

/** Запись доступа «кто» (документы, БЗ, чаты): B §5.2 `entries.ts`. */
export interface Entry {
  who: 'all' | 'member' | 'group' | 'role' | 'relation';
  /** id участника, группы или роли; для `relation` — вид связи (`'foreman'`). */
  ref?: string;
  /** Фирма или регион, в которых действует роль. */
  unit?: string;
  /** Объект ремонта для `relation`. */
  obj?: string;
  /** Уровень доступа (документы) или право (БЗ: `'edit'`). */
  level?: string;
  can?: string;
}
