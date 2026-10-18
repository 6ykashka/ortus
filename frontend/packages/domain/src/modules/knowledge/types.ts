// База знаний v2: пространства и дерево узлов (knowledge.js 14.10, B §3.2, ND/docs/23).
import type { Entry, TenantDb } from '../../core/types/index.ts';

export type KbSpaceAccess = 'open' | 'limited' | 'closed';
export type KbMode = 'inherit' | 'edit' | 'listed';
export type KbKind = 'page' | 'folder' | 'table' | 'diagram' | 'file' | 'link';
export type KbStatus = 'active' | 'draft' | 'review' | 'outdated';
export type KbCan = 'view' | 'edit';

export interface KbSpace {
  id: string;
  name: string;
  icon?: string;
  color?: string;
  /** Область пространства: фирма или регион; `null` — вся организация. */
  unit?: string | null;
  access?: KbSpaceAccess;
  template?: string;
}

export interface KbVersion {
  v: number;
  at: string;
  by: string;
  body: string;
}

/** Запись списка доступа узла: кто и что может (`can`). Запись на странице — `KbRecord`. */
export interface KbAccessEntry extends Entry {
  who: 'member' | 'group' | 'role' | 'relation';
  can: KbCan;
}

/** Аудитория ознакомления: запись или «все». */
export type KbAudience = Entry;

export interface KbAckLog {
  member: string;
  v: number;
  at: string;
}

export interface KbAck {
  v: number;
  audience: KbAudience;
  done: string[];
  /** Журнал подтверждений (KB-03): хранится и после новой версии и увольнения. */
  log?: KbAckLog[];
}

export interface KbHistory {
  at: string;
  by: string;
  text: string;
}

export interface KbDiagram {
  steps: string[];
  out: [string, string][];
}

export interface KbNode {
  id: string;
  space: string;
  title: string;
  parent?: string | null;
  pos?: number;
  kind?: KbKind;
  mode?: KbMode;
  list?: KbAccessEntry[];
  status?: KbStatus;
  owner?: string;
  /** Доступ старой БЗ (`all`/`owner`); узлы v2 его сохраняют для действий форм. */
  access?: 'all' | 'owner';
  versions: KbVersion[];
  archived?: boolean;
  reviewBy?: string;
  ack?: KbAck;
  sensitivity?: 'finance';
  diagram?: KbDiagram;
  file?: { size: string; pages: number };
  link?: { label: string; go: string; icon: string };
  history?: KbHistory[];
  /** Объект ремонта раздела. */
  obj?: string;
  /** Поля начального текста шаблона (как в эталоне `N(…, o)`). */
  body?: string;
  at?: string;
  by?: string;
}

// Таблицы и записи страниц — той же формы, что `KbTable`/`KbColumn`/`KbRow`/`KbEntry`/`KbSrc`
// «Форм» W4.20 (их пишет `kbRun`), но под своими именами: оба модуля в одном бареле
// `modules/index.ts`, и одинаковые имена дали бы TS2308 (`forms-compat.test.ts`).

export interface KbTableColumn {
  id: string;
  name: string;
  type: string;
}

export interface KbSource {
  form: string;
  resp: string;
  fv: number;
  rule: string;
  rv: number;
}

export interface KbTableRow {
  id: string;
  at: string;
  src?: KbSource;
  cells: Record<string, string>;
}

export interface KbDataTable {
  id: string;
  page: string;
  title: string;
  columns: KbTableColumn[];
  rows: KbTableRow[];
}

/** Запись на странице из ответа формы. */
export interface KbRecord {
  id: string;
  page: string;
  at: string;
  head: string;
  lines: { name: string; value: string }[];
  src: KbSource;
}

export interface KbRequest {
  id: string;
  node: string;
  space: string;
  member: string;
  can: KbCan;
  at: string;
  status: 'open' | 'approved' | 'denied';
  by?: string;
}

export interface KbRule {
  id: string;
  space: string;
  kind: 'ack' | 'review' | 'section';
  name: string;
  trigger: string;
  on: boolean;
}

export interface KbRun {
  id: string;
  space: string;
  rule: string;
  at: string;
  res: 'ok' | 'stopped' | 'warn' | 'error';
  text: string;
}

export interface KnowledgeSlice {
  spaces: KbSpace[];
  pages: KbNode[];
  tables?: KbDataTable[];
  entries?: KbRecord[];
  requests?: KbRequest[];
  rules?: KbRule[];
  runs?: KbRun[];
  /** Миграция на пространства с деревом выполнена. */
  v2?: boolean;
}

export type KbStepKind = 'ok' | 'no' | 'wait' | 'inh';

export interface KbStep {
  k: KbStepKind;
  t: string;
  d: string;
}

/** Доступ к узлу с цепочкой причин (`kbAccess`). */
export interface KbAccessResult {
  view: boolean;
  edit: boolean;
  chain: KbStep[];
  lead: boolean;
  create: boolean;
  /** Закрыто функцией сотрудника (водитель и финансовые страницы). */
  fn: boolean;
  owner?: boolean;
}

export interface KbSpaceMy {
  owner: boolean;
  lead: boolean;
  view: boolean;
  create: boolean;
  edit: boolean;
  role: string;
}

export interface KbReach {
  ok: boolean;
  why?: string;
}

/**
 * Параметры проверки доступа: дата часов домена `ДД.ММ.ГГГГ` для сроков назначений (PD-60).
 * Обязательна: без неё назначение со сроком нельзя проверить, и функции доступа падают, а не
 * считают истёкшее назначение действующим.
 */
export interface KbOpts {
  today: string;
}

/**
 * БД организации со срезом «Базы знаний». `ModuleSlices` ядра не расширяется: фикстура ядра
 * (`core/testing/fixture.ts`) хранит упрощённый `knowledge` ({id, title}), и расширение сделало бы
 * её несовместимой с `TenantDb`. Любая `TenantDb` без среза подходит под этот тип.
 */
export type KbTenantDb = TenantDb & { knowledge?: KnowledgeSlice };
