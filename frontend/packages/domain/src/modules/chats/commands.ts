// Команды «Чатов» (chatsApi, chats.js 14.10:318–592): 17 команд mock-адаптера. Демо-сдвиг часов
// `chatTick` не переносится (серверные задания: исчезновение временных, одноразовые через 24 часа,
// сроки хранения). Задержки — как в эталоне (`cmd(fn, ms)`), `chatOpen` — без сети.
import type { ModuleCtx } from '../../core/module.ts';
import { adminCommands } from './commands-admin.ts';
import { messageCommands } from './commands-messages.ts';
import type {
  ChatKind,
  ChatPerson,
  ChatPolicy,
  ChatRoleKey,
  FullMode,
  SourceWho,
} from './types.ts';
import type { CleanupResult } from './storage.ts';

export interface ChatSourceInput {
  who: SourceWho;
  ref?: string | null;
  unit?: string | null;
  obj?: string | null;
  trip?: string | null;
  role: ChatRoleKey;
}

export interface SendSpec {
  text?: string;
  files?: { name: string; mb: number; kind?: string }[];
  doc?: { kind?: string; ref: string; title: string; sub?: string };
  poll?: { q: string; opts: string[]; hours?: number; anon?: boolean; multi?: boolean };
  important?: boolean;
  /** Срок подтверждения «важного» (подпись). */
  due?: string;
  /** Часы жизни временного сообщения. */
  temp?: number;
  viewOnce?: boolean;
  spoiler?: string;
  topic?: string;
}

export interface ChatSpec {
  kind?: string;
  unit?: string | null;
  title?: string;
  /** Метка чата: `finance` или `pdn`. */
  label?: string;
  sources?: ChatSourceInput[];
  history?: string;
}

export interface MembersPreview {
  joined: ChatPerson[];
  pending: ChatPerson[];
  skipped: ChatPerson[];
}

export type PolicyNote = [icon: string, tone: string, text: string];

export interface ChatsApi {
  chatOpen(id: string): { ok: true };
  chatSend(id: string, spec: SendSpec): { id: string };
  chatEdit(msgId: string, text: string): { ok: true } | { same: true };
  chatDelete(msgId: string, reason?: string): { ok: true };
  chatAck(msgId: string): { left: number } | { already: true };
  chatVote(msgId: string, optIds: string[]): { ok: true };
  chatPollClose(msgId: string): { ok: true };
  chatPin(msgId: string): { pinned: string | null };
  chatReveal(msgId: string): { ok: true };
  chatOpenOnce(msgId: string): { name: string };
  chatSaveTo(msgId: string): { n: number; mb: number };
  /** `projectId` — проект задачи; без него — проект подразделения чата. */
  chatToTask(msgId: string, projectId?: string): { id: string };
  chatCreate(spec: ChatSpec, dryRun: true): MembersPreview;
  chatCreate(spec: ChatSpec, dryRun?: false): { id: string } & MembersPreview;
  chatSources(
    id: string,
    sources: ChatSourceInput[],
    dryRun?: boolean,
  ): MembersPreview & { gain: string[]; lose: string[] };
  chatSetFull(id: string, mode: FullMode): { ok: true };
  chatCleanup(id: string, filters: string[], dryRun?: boolean): CleanupResult;
  chatPolicySet(
    kind: ChatKind,
    patch: Partial<ChatPolicy>,
    dryRun?: boolean,
  ): { notes: PolicyNote[] };
}

/** Задержки mock-адаптера, мс (`cmd(fn, ms)` эталона). */
export const CHAT_DELAYS: Readonly<Record<keyof ChatsApi, number>> = {
  chatOpen: 0,
  chatSend: 240,
  chatEdit: 200,
  chatDelete: 220,
  chatAck: 220,
  chatVote: 200,
  chatPollClose: 220,
  chatPin: 180,
  chatReveal: 200,
  chatOpenOnce: 260,
  chatSaveTo: 260,
  chatToTask: 300,
  chatCreate: 300,
  chatSources: 300,
  chatSetFull: 200,
  chatCleanup: 320,
  chatPolicySet: 300,
};

export const CHAT_METHODS = Object.keys(CHAT_DELAYS) as readonly (keyof ChatsApi)[];

export function chatsCommands(ctx: ModuleCtx): ChatsApi {
  return { ...messageCommands(ctx), ...adminCommands(ctx) } as ChatsApi;
}
