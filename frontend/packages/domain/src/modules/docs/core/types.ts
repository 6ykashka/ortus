// Срез «Документы» (documents.js 14.10/19.10:21–67, 404–524, docs/24): папки, документы трёх видов,
// маршрут, шаблоны. Здесь только данные ядра документов (W7.21); команды и движок маршрута — W7.22/W7.27.
import type { Entry, TenantDb } from '../../../core/types/index.ts';

export type DocKind = 'text' | 'sheet' | 'pdf';
export type DocStatusKey = 'draft' | 'agreed' | 'approved' | 'signed';
/** Режим доступа папки или документа: как у родителя или «Только выбранные». */
export type DocMode = 'inherit' | 'listed';
/** Уровни доступа: 0 — нет, 1 — читает … 5 — управляет доступом. */
export type DocLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type DocLevelKey = 'view' | 'comment' | 'suggest' | 'edit' | 'manage';
export type DocSensitivity = 'finance';

/** Запись списка доступа: `level` — ключ уровня (`view`…`manage`). */
export type DocEntry = Entry;

export interface RouteRules {
  lock: boolean;
  notAuthor: boolean;
  commentOnBack: boolean;
  escalate: boolean;
}

export type StepKind = 'approve' | 'sign' | 'ack' | 'ext';
export type StepMode = 'all' | 'seq' | 'any';

/** Шаг шаблона маршрута папки (`routeTpl`): исполнители ещё не материализованы. */
export interface RouteTplStep {
  kind: StepKind;
  mode?: StepMode;
  who?: string[];
  audience?: Entry[];
  days: number;
}

export interface RouteTpl {
  name: string;
  project: string;
  steps: RouteTplStep[];
  rules: RouteRules;
}

export interface StepDecision {
  member: string;
  decision: 'ok' | 'back';
  at: string;
  method?: string;
  demo?: boolean;
  comment?: string;
}

/** Шаг запущенного маршрута (поля шагов `ack` и `ext` зависят от вида). */
export interface RouteStep {
  kind: StepKind;
  name: string;
  mode?: StepMode;
  who: string[];
  days: number;
  status: 'wait' | 'active' | 'done';
  due?: string;
  decisions: StepDecision[];
  people?: string[];
  done?: { member: string; at: string }[];
  ext?: { name: string; phone?: string };
}

export interface DocRoute {
  id: string;
  v: number;
  by: string;
  at: string;
  status: 'active' | 'returned' | 'done' | 'cancelled';
  cur: number;
  project: string | null;
  task: string | null;
  rules: RouteRules;
  steps: RouteStep[];
  back?: { name: string; comment?: string };
}

export interface DocFolder {
  id: string;
  name: string;
  parent: string | null;
  unit: string | null;
  mode: DocMode;
  share: DocEntry[];
  owner: string;
  icon: string;
  sensitivity?: DocSensitivity;
  link?: { kind: string; id: string };
  routeTpl?: RouteTpl;
}

export interface DocField {
  k: string;
  /** Источник значения: `tenant`, `owner`, `unit`, `obj.<поле>`, `trip.<поле>`, `snap`. */
  src?: string;
  v?: string;
  from?: string;
}

export interface DocLink {
  kind: string;
  id: string;
  label?: string;
}

/** Временный доступ маршрута: участник получает уровень на время шага (`tmp`). */
export interface TmpAccess {
  member: string;
  level: DocLevelKey;
  why: string;
  v?: number;
}

export interface DocBlock {
  id: string;
  t: string;
  text: string;
  rows?: string[][];
}

export interface DocComment {
  id: string;
  by: string;
  at: string;
  text: string;
  quote?: string;
  block?: string;
  sheet?: string;
  cell?: string;
  page?: string;
  mention?: string;
  replies: { byId: string }[];
  resolved: boolean;
}

export interface OcrWord {
  id: string;
  text: string;
  sug: string;
  conf: number;
  why: string;
  st: string;
  row?: number;
}

export interface DocOcr {
  status: string;
  conf?: number;
  at?: string;
  lang?: string;
  words?: OcrWord[];
}

export interface DocJob {
  id: string;
  op: string;
  name: string;
  status: string;
  at: string;
  params?: unknown;
  res?: string;
  error?: string;
}

export interface SheetProt {
  id: string;
  sheet: string;
  range: string;
  name: string;
  who: Entry[];
}

export interface SheetCell {
  v?: string | number | boolean;
  f?: string;
  st?: string;
  al?: string;
  fmt?: string;
  mono?: boolean;
}

export interface Sheet {
  id: string;
  name: string;
  cols: number;
  rows: number;
  w: number[];
  cells: Record<string, SheetCell>;
  merges?: Record<string, number>;
  freeze?: number;
  fin?: boolean;
  finWho?: string[];
  hidden?: boolean;
}

export interface DocVersion {
  v: number;
  at: string;
  by: string;
  name: string;
  source: string;
  body?: DocBlock[];
  sheets?: Sheet[];
  pages?: unknown[];
}

/** Документ. Поля вида: `text` — `body`; `sheet` — `sheets`, `prot`, `crm`; `pdf` — `pages`, `ocr`, `table`. */
export interface DocItem {
  id: string;
  kind: DocKind;
  title: string;
  folder: string;
  owner: string;
  status: DocStatusKey;
  mode: DocMode;
  share: DocEntry[];
  links: DocLink[];
  v: number;
  versions: DocVersion[];
  comments: DocComment[];
  suggestions: unknown[];
  history: unknown[];
  jobs: DocJob[];
  tmp: TmpAccess[];
  annots: unknown[];
  presence: { member: string; block?: string; sel?: string }[];
  authors: string[];
  dirty: boolean;
  sensitivity?: DocSensitivity;
  fields?: DocField[];
  frozen?: Record<string, string>;
  body?: DocBlock[];
  sheets?: Sheet[];
  prot?: SheetProt[];
  crm?: unknown;
  cond?: unknown;
  chart?: unknown;
  pages?: unknown[];
  ocr?: DocOcr;
  table?: unknown;
  route?: DocRoute;
  pdfa?: boolean;
  scan?: boolean;
  textLayer?: boolean;
  size?: number;
  saved?: { at: string; by: string };
  upd?: { at: string; by: string };
  ext?: unknown;
}

export interface DocsSlice {
  folders: DocFolder[];
  items: DocItem[];
  v1: true;
}

export type DocsTenantDb = TenantDb & { docs?: DocsSlice };

export interface DocTemplate {
  id: string;
  name: string;
  kind: DocKind;
  icon: string;
  hint: string;
  link: 'trip' | 'object' | null;
  folder: string;
  fields: DocField[];
  body: [string, string][];
}

/** Один шаг цепочки причин доступа (`chain`). */
export type DocStepKind = 'ok' | 'no' | 'wait' | 'up' | 'inh';
export interface DocChainStep {
  k: DocStepKind;
  t: string;
  d: string;
}

export interface DocAccessResult {
  L: DocLevel;
  level: string;
  chain: DocChainStep[];
  owner?: boolean;
  fin?: boolean;
  fn?: boolean;
  /** Версия, которой ограничен временный доступ маршрута. */
  onlyV?: number | null;
}

export interface DocRightsResult extends DocAccessResult {
  view: boolean;
  comment: boolean;
  suggest: boolean;
  edit: boolean;
  editL: boolean;
  manage: boolean;
  locked: boolean;
  share: boolean;
  maxGrant: number;
  ext: boolean;
  export: boolean;
  sign: boolean;
  route: boolean;
}

/** Условие срока назначений (PD-60): сегодняшняя дата часов домена `дд.мм.гггг`. */
export interface DocOpts {
  today: string;
}

export interface DocImpactPerson {
  id: string;
  name: string;
  from: number;
  to: number;
  invited: boolean;
}

export interface DocImpact {
  gain: DocImpactPerson[];
  lose: DocImpactPerson[];
  up: DocImpactPerson[];
  down: DocImpactPerson[];
}

export type DocWait =
  | { kind: StepKind; due?: string }
  | { kind: 'returned'; who?: string; comment?: string }
  | { kind: 'mention'; cid: string; by?: string; text: string }
  | { kind: 'ocr'; n: number };

export type StatusTone = 'info' | 'warn' | 'ok' | 'neutral';
export type DocStatusBadge = [StatusTone, string, string];
