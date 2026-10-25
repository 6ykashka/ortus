// Типы модуля «Чаты» (chats.js 14.10, docs/25-chats.md, DoR «Чаты» §2.1). Время сообщений и политик —
// минуты от 01.10.2026 00:00, как в эталоне (`db.chats.now`).
import type { Role, TenantDb } from '../../core/types/index.ts';

export type ChatKind = 'direct' | 'group' | 'area' | 'record' | 'announce';
export type ChatRoleKey = 'owner' | 'moderator' | 'member' | 'reader';
export type ChatStatus = 'active' | 'archived';
export type ChatSensitivity = 'normal' | 'finance' | 'pdn';
export type SourceWho = 'all' | 'group' | 'role' | 'member' | 'relation' | 'tripDriver';

/** Источник состава: запись «кто» ядра плюс «водитель рейса» и роль в чате. */
export interface ChatSource {
  who: SourceWho;
  ref?: string | null;
  unit?: string | null;
  obj?: string | null;
  trip?: string | null;
  role: ChatRoleKey;
}

export type RcptMode = 'off' | 'ticks' | 'who';
export type EditMode = '15m' | '48h' | 'none';
export type TempMode = 'off' | 'allowed' | 'viewonce';
export type FwdMode = 'free' | 'internal' | 'off';
export type FullMode = 'block' | 'ring' | 'archive' | 'compress';

export interface ChatPolicy {
  textY: number;
  filesD: number;
  voiceD: number;
  rcpt: RcptMode;
  rcptD: number;
  delD: number;
  edit: EditMode;
  maxMb: number;
  quotaMb: number | null;
  temp: TempMode;
  fwd: FwdMode;
  pdn: boolean;
  onFull: FullMode;
  afterClose?: number;
}

export type FileKind = 'photo' | 'video' | 'voice' | 'doc';

export interface ChatFile {
  name: string;
  mb: number;
  kind: FileKind;
  viewOnce?: boolean;
  opened?: Record<string, number>;
  gone?: boolean;
  savedTo?: string;
}

export interface PollOption {
  id: string;
  t: string;
}

export interface Poll {
  q: string;
  opts: PollOption[];
  votes: Record<string, string[]>;
  voters?: string[];
  anon: boolean;
  multi: boolean;
  closes: number;
  closesLabel: string;
  closed: boolean;
}

export interface SysCard {
  mod: string;
  icon: string;
  tone: string;
  title: string;
  text: string;
  label?: string;
  nav?: string;
  id?: string;
}

export interface ChatDocRef {
  kind: string;
  ref: string;
  title: string;
  sub: string;
}

export interface ChatMessage {
  id: string;
  seq: number;
  ts: number;
  by: string;
  text: string;
  reads: Record<string, number>;
  topic?: string | null;
  /** Сообщение видно только этим участникам («Видно только вам»). */
  visibleTo?: string[];
  files?: ChatFile[] | null;
  doc?: ChatDocRef | null;
  important?: { due: string; acks: { member: string; ts: number }[] } | null;
  temp?: { exp: number; h: number } | null;
  spoiler?: string | null;
  kind?: 'poll';
  poll?: Poll | null;
  deleted?: { by: string; ts: number; mod: boolean; reason: string; keepUntil: number };
  edits?: { text: string; ts: number }[];
  revealed?: string[];
  tasks?: string[];
  sys?: SysCard;
}

export interface ChatBucket {
  id: string;
  kind: FileKind;
  label: string;
  ageD: number;
  n: number;
  mb: number;
  hold?: boolean;
  compressed?: boolean;
}

/**
 * Удержание (`hold`): защищает сообщения от удаления и таймера. Без `members` и `range` — весь чат;
 * `members` — сообщения этих сотрудников; `range` — сообщения за период (минуты демо).
 */
export interface ChatHold {
  reason: string;
  period: string;
  until: string;
  by: string;
  files: number;
  members?: string[];
  range?: { from: number; to: number };
}

export interface ChatRecordRef {
  kind: string;
  id: string;
  module: string;
  nav: string;
  label: string;
}

export interface ChatJournalEntry {
  ts: number;
  by: string;
  text: string;
}

export interface Chat {
  id: string;
  kind: ChatKind;
  title?: string;
  unit?: string | null;
  owner?: string;
  pair?: string[];
  sources?: ChatSource[];
  record?: ChatRecordRef;
  topics?: string[];
  pinned?: string | null;
  hold?: ChatHold;
  buckets?: ChatBucket[];
  usedMb: number;
  savedMb?: number;
  archivedMb?: number;
  over?: Partial<ChatPolicy>;
  history?: string;
  msgs: ChatMessage[];
  seq: number;
  last: number;
  lastRead: Record<string, number>;
  journal: ChatJournalEntry[];
  status: ChatStatus;
  sensitivity: ChatSensitivity;
}

export interface ChatsSlice {
  v1: true;
  /** «Сейчас» чатов: минуты от 01.10.2026 00:00. */
  now: number;
  policy: Record<ChatKind, ChatPolicy>;
  items: Chat[];
}

/** БД организации со срезом чатов (без расширения `ModuleSlices`: фикстура ядра хранит свой `chats`). */
export type ChatsTenantDb = TenantDb & { chats?: ChatsSlice };

export type ChatRoleTemplate = Role & { chatRole?: ChatRoleKey };

export type AccessReason =
  'none' | 'blocked' | 'module_off' | 'not_member' | 'no_module' | 'function' | 'invited';

export interface ChainStep {
  t: string;
  d: string;
  ok: boolean;
}

export interface ChatAccess {
  ok: boolean;
  pending?: boolean;
  role: ChatRoleKey | null;
  reason?: AccessReason;
  why?: string;
  chain: ChainStep[];
  via: string[];
  owner?: boolean;
}

export interface Verbs {
  all: boolean;
  has(v: string): boolean;
}

export interface ChatCan {
  write: boolean;
  files: boolean;
  polls: boolean;
  mod: boolean;
  pin: boolean;
  announce: boolean;
  receipts: boolean;
  pdn: boolean;
  temp: boolean;
  viewOnce: boolean;
  members: boolean;
  settings: boolean;
  saveTo: boolean;
  task: boolean;
}

export type ChatRights = ChatAccess & { can: Partial<ChatCan>; P: ChatPolicy; vb?: Verbs };

export interface ChatPerson {
  id: string;
  name: string;
  title: string;
  st: 'in' | 'pending' | 'out';
  role?: ChatRoleKey | null;
  via?: string;
  why?: string;
}

export type MatrixCell = 'y' | 'n' | 'l';
export type MatrixRow = [label: string, cells: MatrixCell[], hint: string];
export type MatrixGroup = [title: string, rows: MatrixRow[]];
