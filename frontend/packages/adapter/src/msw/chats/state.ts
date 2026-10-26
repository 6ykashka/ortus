// «Чаты» сценарного сервера (W7.00, контрактный PR этапа 7): контекст запроса поверх домена W7.10 и проекция
// в схемы контракта (`Chat*`). Домен — срез `chats` БД организации со стадиями сида `service` и `chats`
// (`msw/stage7/seed.ts`); проверки, текст ошибок эталона и маска ПДн — в командах и проекции домена, здесь только
// перевод: id прототипа ↔ UUID, минуты чатов → моменты UTC, ошибки домена → Problem контракта.
import type { components } from '@ortus/api-client';
import { ApiError } from '@ortus/domain';
import {
  type Chat,
  CHAT_BOUNDS,
  type ChatKind,
  type ChatPolicy,
  chatAccess,
  chatPeople,
  chatRights,
  chatsCommands,
  type ChatsApi,
  type ChatsTenantDb,
  chatsView,
  chatTitle,
  type ChatView,
  type ChatSource,
  type MessageView,
} from '@ortus/domain/modules';

import { fail } from '../core/problem.ts';
import type { HandlerContext } from '../core/registry.ts';
import { chatInstant, type S7Ctx, s7Ctx } from '../stage7/seed.ts';

type S = components['schemas'];

export const MB = 1024 * 1024;
export const KINDS: readonly ChatKind[] = ['direct', 'group', 'area', 'record', 'announce'];

export interface ChatsCtx extends S7Ctx {
  cdb: ChatsTenantDb;
  cmds: ChatsApi;
  /** Проекция чатов участнику (маска ПДн, итоги, свёрнутые удалённые). */
  views(): ChatView[];
  run<T>(f: () => T): T;
}

/** Перевод ошибки домена в Problem контракта: тексты эталона — в `detail`, коды — по смыслу (chats.md §2.2). */
export function chatFail(e: unknown): never {
  if (!(e instanceof ApiError)) throw e;
  const m = e.message;
  if (/^Окно (правки|удаления) закрыто/.test(m)) return fail('chat_edit_window_closed', m);
  if (/^Нельзя удалить: удержание/.test(m)) return fail('chat_on_hold', m);
  if (/^Место чата заполнено/.test(m)) return fail('chat_quota_full', m);
  if (/больше .* предел политики/.test(m)) return fail('chat_file_too_large', m);
  if (/^Временные сообщения в этом чате запрещены/.test(m))
    return fail('chat_ephemeral_disabled', m);
  if (/вне вашей области/.test(m)) return fail('chat_member_out_of_scope', m);
  if (/^Опрос (уже )?закрыт|^Вы уже открыли этот файл|^Файл удалён/.test(m)) {
    return fail('invalid_transition', m);
  }
  switch (e.code) {
    case 'not_found':
      return fail('not_found', m);
    case 'forbidden':
      return fail('forbidden_action', m);
    case 'transition':
      return fail('invalid_transition', m);
    case 'conflict':
      return fail('revision_mismatch', m);
    case 'subscription_restricted':
      return fail('tenant_read_only', m);
    default:
      return fail('validation_failed', m, {
        violations: [{ field: 'body', code: 'invalid', message: m }],
      });
  }
}

/** Все id прототипа, которые клиент может прислать UUID-ом (чаты, сообщения, опросы, варианты, вложения, люди…). */
export function chatIds(db: ChatsTenantDb): string[] {
  const out: string[] = [];
  const add = (x: string | null | undefined): void => {
    if (x) out.push(x);
  };
  const lists = [
    db.members,
    db.units,
    db.groups ?? [],
    db.roles,
    db.assignments,
    db.projects ?? [],
  ];
  for (const l of lists) for (const x of l as { id: string }[]) add(x.id);
  const trips = (db as { trips?: { id: string }[] }).trips ?? [];
  for (const t of trips) add(t.id);
  const repair = (db as { repair?: { objects?: { id: string }[] } }).repair;
  for (const o of repair?.objects ?? []) add(o.id);
  for (const c of db.chats?.items ?? []) {
    add(c.id);
    add(`${c.id}.hold`);
    for (const m of c.msgs) {
      add(m.id);
      add(`${m.id}.poll`);
      for (const o of m.poll?.opts ?? []) add(`${m.id}.${o.id}`);
      (m.files ?? []).forEach((_, i) => add(`${m.id}.f${i}`));
    }
  }
  return out;
}

export function chatsCtx(ctx: HandlerContext): ChatsCtx {
  const t = ctx.org();
  let idx: Map<string, string> | undefined;
  const base = s7Ctx(ctx, undefined);
  const cdb = base.db as ChatsTenantDb;
  if (!cdb.chats) return fail('module_not_installed', 'Модуль «Чаты» не подключён');
  cdb.chats.now = Math.max(cdb.chats.now, base.chatNow);
  const index = (): Map<string, string> => {
    if (!idx) {
      idx = new Map();
      for (const id of chatIds(cdb)) idx.set(base.U(id), id);
    }
    return idx;
  };
  const me = base.me;
  const cmds = chatsCommands(base.mctx);
  const x: ChatsCtx = {
    ...base,
    t,
    cdb,
    cmds,
    P: (uuid) => (uuid ? index().get(uuid.toLowerCase()) : undefined),
    views: () => chatsView(cdb, me, structuredClone(cdb.chats))?.items ?? [],
    run: (f) => {
      try {
        const out = f();
        idx = undefined;
        return out;
      } catch (e) {
        return chatFail(e);
      }
    },
  };
  return x;
}

// ---------------------------------------------------------------------------------------------
// Проекция

const num = (n: number): number => Math.round(n);
export const bytes = (mb: number): number => num(mb * MB);

export function policyDto(P: ChatPolicy): S['ChatPolicy'] {
  const out: S['ChatPolicy'] = {
    textYears: P.textY,
    filesDays: P.filesD,
    voiceDays: P.voiceD,
    receipts: P.rcpt,
    receiptsDays: P.rcptD,
    deletedDays: P.delD,
    edit: P.edit,
    maxFileMb: P.maxMb,
    quotaMb: P.quotaMb,
    temp: P.temp,
    forward: P.fwd,
    pdnMask: P.pdn,
    onFull: P.onFull,
  };
  if (P.afterClose !== undefined) out.afterCloseDays = P.afterClose;
  return out;
}

/** Патч политики контракта → домен. */
export function policyPatch(p: S['ChatPolicyPatch']): Partial<ChatPolicy> {
  const out: Partial<ChatPolicy> = {};
  if (p.textYears !== undefined) out.textY = p.textYears;
  if (p.filesDays !== undefined) out.filesD = p.filesDays;
  if (p.voiceDays !== undefined) out.voiceD = p.voiceDays;
  if (p.receipts !== undefined) out.rcpt = p.receipts;
  if (p.receiptsDays !== undefined) out.rcptD = p.receiptsDays;
  if (p.deletedDays !== undefined) out.delD = p.deletedDays;
  if (p.edit !== undefined) out.edit = p.edit;
  if (p.maxFileMb !== undefined) out.maxMb = p.maxFileMb;
  if (p.quotaMb !== undefined) out.quotaMb = p.quotaMb;
  if (p.temp !== undefined) out.temp = p.temp;
  if (p.forward !== undefined) out.fwd = p.forward;
  if (p.pdnMask !== undefined) out.pdn = p.pdnMask;
  if (p.onFull !== undefined) out.onFull = p.onFull;
  if (p.afterCloseDays !== undefined) out.afterClose = p.afterCloseDays;
  return out;
}

export function boundsDto(): S['ChatPolicyBounds'] {
  const r = (k: keyof typeof CHAT_BOUNDS): S['ChatRange'] => ({
    min: CHAT_BOUNDS[k][0],
    max: CHAT_BOUNDS[k][1],
  });
  return {
    textYears: r('textY'),
    filesDays: r('filesD'),
    voiceDays: r('voiceD'),
    receiptsDays: r('rcptD'),
    deletedDays: r('delD'),
    maxFileMb: r('maxMb'),
  };
}

export function memberRef(x: ChatsCtx, id: string): S['ChatMemberRef'] {
  const m = x.cdb.members.find((y) => y.id === id);
  const out: S['ChatMemberRef'] = { memberId: x.U(id), displayName: m?.name ?? id };
  if (m?.title) out.title = m.title;
  return out;
}

const memberName = (x: ChatsCtx, id: string): string =>
  x.cdb.members.find((y) => y.id === id)?.name ?? 'Система';

/** `ДД.ММ` или `ДД.ММ.ГГГГ` → `ГГГГ-ММ-ДД`; иначе null. */
export function isoDay(s: string | undefined): string | null {
  const m = /^(\d\d)\.(\d\d)(?:\.(\d{4}))?/.exec(s ?? '');
  return m ? `${m[3] ?? '2026'}-${m[2]}-${m[1]}` : null;
}

const RECORD_MODULE: Readonly<Record<string, { moduleKey: string; entityType: string }>> = {
  repair: { moduleKey: 'repairs', entityType: 'project' },
  logistics: { moduleKey: 'fleet', entityType: 'trip' },
  fleet: { moduleKey: 'fleet', entityType: 'trip' },
};

export function recordDto(x: ChatsCtx, c: Pick<Chat, 'record'>): S['ChatRecordRef'] | null {
  const r = c.record;
  if (!r) return null;
  const mod = RECORD_MODULE[r.module] ?? { moduleKey: r.module, entityType: r.kind };
  const out: S['ChatRecordRef'] = {
    object: { ...mod, entityId: x.U(r.id) },
    label: r.label,
  };
  if (r.nav) out.nav = r.nav;
  return out;
}

export const fileKind = (contentType: string): 'photo' | 'video' | 'voice' | 'doc' =>
  contentType.startsWith('image/')
    ? 'photo'
    : contentType.startsWith('video/')
      ? 'video'
      : contentType.startsWith('audio/')
        ? 'voice'
        : 'doc';

function previewOf(m: MessageView): S['ChatMessagePreview']['kind'] {
  return m.sys
    ? 'system'
    : m.poll
      ? 'poll'
      : m.files?.length
        ? 'file'
        : m.doc
          ? 'document'
          : 'text';
}

function previewText(m: MessageView): string {
  if (m.deleted) return 'Сообщение удалено';
  if (m.sys) return m.sys.title;
  if (m.poll) return m.poll.q;
  return (m.text || m.files?.[0]?.name || m.doc?.title || '').slice(0, 300);
}

function lastOf(x: ChatsCtx, cv: ChatView): S['ChatMessagePreview'] | null {
  const m = cv.msgs[cv.msgs.length - 1];
  if (!m) return null;
  return {
    seq: m.seq,
    at: chatInstant(m.ts),
    authorDisplayName: m.by === 'sys' ? 'Система' : memberName(x, m.by),
    text: previewText(m),
    kind: previewOf(m),
  };
}

function myDto(x: ChatsCtx, cv: ChatView, full: boolean): S['ChatMy'] {
  const c0 = x.cdb.chats?.items.find((y) => y.id === cv.id);
  const my: S['ChatMy'] = {
    role: cv.my.role ?? null,
    unread: cv.my.unread,
    ackWaitCount: cv.my.ackWait.length,
    lastReadSeq: c0?.lastRead[x.me] ?? 0,
  };
  if (full) {
    const k = cv.my.can;
    my.can = {
      write: !!k.write,
      files: !!k.files,
      polls: !!k.polls,
      moderate: !!k.mod,
      pin: !!k.pin,
      announce: !!k.announce,
      receipts: !!k.receipts,
      pdn: !!k.pdn,
      ephemeral: !!k.temp,
      viewOnce: !!k.viewOnce,
      members: !!k.members,
      settings: !!k.settings,
      saveToRecord: !!k.saveTo,
      task: !!k.task,
    };
    my.chain = cv.my.chain.map((s) => ({ title: s.t, detail: s.d, ok: s.ok }));
  }
  return my;
}

const peerOf = (x: ChatsCtx, cv: ChatView): S['ChatPeer'] | undefined => {
  if (cv.kind !== 'direct' || !cv.my.peer) return undefined;
  const m = x.cdb.members.find((y) => y.id === cv.my.peer);
  const status = m?.status === 'blocked' ? 'blocked' : 'active';
  return { memberId: x.U(cv.my.peer), displayName: m?.name ?? cv.my.peer, status };
};

export function summaryDto(x: ChatsCtx, cv: ChatView): S['ChatSummary'] {
  const out: S['ChatSummary'] = {
    id: x.U(cv.id),
    kind: cv.kind,
    title: chatTitle(x.cdb, cv, x.me),
    orgUnitId: cv.unit ? x.U(cv.unit) : null,
    status: cv.status,
    sensitivity: cv.sensitivity,
    record: recordDto(x, cv),
    my: myDto(x, cv, false),
    usedBytes: bytes(cv.usedMb),
    revision: x.s.chatRev[cv.id] ?? 1,
  };
  const peer = peerOf(x, cv);
  if (peer) out.peer = peer;
  const last = lastOf(x, cv);
  if (last) out.lastMessage = last;
  out.pinnedMessageId = cv.pinned ? x.U(cv.pinned) : null;
  return out;
}

export function attachmentDtos(x: ChatsCtx, m: MessageView): S['ChatAttachment'][] {
  return (m.files ?? []).map((f, i) => {
    const out: S['ChatAttachment'] = {
      id: x.U(`${m.id}.f${i}`),
      fileName: f.name,
      sizeBytes: bytes(f.mb),
      kind: f.kind,
      viewOnce: !!f.viewOnce,
      gone: !!f.gone,
    };
    if (f.viewOnce) out.openedByMe = f.opened;
    if (f.savedTo) {
      const rec = x.cdb.chats?.items.find((c) => c.msgs.some((y) => y.id === m.id))?.record;
      if (rec) {
        const mod = RECORD_MODULE[rec.module] ?? { moduleKey: rec.module, entityType: rec.kind };
        out.savedTo = { ...mod, entityId: x.U(rec.id) };
      }
    }
    return out;
  });
}

function pollDto(x: ChatsCtx, m: MessageView): S['ChatPoll'] | null {
  const p = m.poll;
  if (!p) return null;
  return {
    id: x.U(`${m.id}.poll`),
    question: p.q,
    options: p.opts.map((o) => {
      const opt: S['ChatPollOption'] = {
        id: x.U(`${m.id}.${o.id}`),
        text: o.t,
        votes: o.n,
        mine: o.mine,
      };
      if (!p.anon && o.who.length) opt.voters = o.who.map((w) => memberName(x, w));
      return opt;
    }),
    anonymous: p.anon,
    multiple: p.multi,
    closesAt: chatInstant(p.closes),
    closed: p.closed,
    totalVoters: p.total,
    myVotes: p.opts.filter((o) => o.mine).map((o) => x.U(`${m.id}.${o.id}`)),
  };
}

export function messageDto(x: ChatsCtx, cv: ChatView, m: MessageView): S['ChatMessage'] {
  const c0 = x.cdb.chats?.items.find((y) => y.id === cv.id);
  const raw = c0?.msgs.find((y) => y.id === m.id);
  const totalOthers = Math.max(
    0,
    (c0 ? chatPeople(x.cdb, c0).filter((p) => p.st === 'in').length : 0) - 1,
  );
  const out: S['ChatMessage'] = {
    id: x.U(m.id),
    seq: m.seq,
    createdAt: chatInstant(m.ts),
    authorDisplayName: m.by === 'sys' ? 'Система' : memberName(x, m.by),
    kind: m.sys ? 'system' : m.poll ? 'poll' : m.doc ? 'document' : 'text',
    text: m.text,
    masked: m.pdn && !m.revealed,
    attachments: attachmentDtos(x, m),
    tasks: (m.tasks ?? []).map((id) => ({ taskId: x.U(id), key: id })),
  };
  if (m.by !== 'sys') out.authorMemberId = x.U(m.by);
  if (m.topic) out.topic = m.topic;
  if (m.doc) {
    out.document = { kind: m.doc.kind, refId: x.U(m.doc.ref), title: m.doc.title };
    if (m.doc.sub) out.document.sub = m.doc.sub;
  }
  if (m.important) {
    const due = isoDay(m.important.due);
    out.important = {
      dueDate: due ?? '2026-10-04',
      ackCount: m.important.n,
      totalCount: totalOthers,
      mine: { required: m.by !== x.me && !m.important.mine, done: m.important.mine },
    };
  }
  if (m.temp) out.ephemeral = { expiresAt: chatInstant(m.temp.exp), ttlHours: m.temp.h };
  if (m.spoiler) out.spoiler = m.spoiler;
  const poll = pollDto(x, m);
  if (poll) out.poll = poll;
  if (m.sys) {
    out.system = {
      module: m.sys.mod,
      icon: m.sys.icon,
      tone: (['info', 'ok', 'warn', 'danger', 'neutral'].includes(m.sys.tone)
        ? m.sys.tone
        : 'neutral') as S['ChatSystemCard']['tone'],
      title: m.sys.title,
      text: m.sys.text,
    };
    if (m.sys.label) out.system.label = m.sys.label;
    if (m.sys.nav) out.system.nav = m.sys.nav;
  }
  if (m.deleted) {
    out.deleted = {
      byDisplayName: memberName(x, m.deleted.by),
      at: chatInstant(m.deleted.ts),
      moderator: m.deleted.mod,
    };
    if (m.deleted.reason) out.deleted.reason = m.deleted.reason;
  }
  const lastEdit = raw?.edits?.[raw.edits.length - 1];
  if (lastEdit && !m.deleted) out.editedAt = chatInstant(Math.max(lastEdit.ts, m.ts));
  if (m.visibleTo?.length === 1 && m.visibleTo[0] === x.me) out.visibleOnlyToMe = true;
  if (m.readN >= 0 && m.by !== 'sys') out.reads = { readCount: m.readN, totalCount: totalOthers };
  return out;
}

const HISTORY = ['all', 'since_join', 'none'] as const;

export function chatDto(x: ChatsCtx, cv: ChatView): S['Chat'] {
  const c0 = x.cdb.chats?.items.find((y) => y.id === cv.id) as Chat;
  const base = summaryDto(x, cv);
  const pinned = cv.pinned ? cv.msgs.find((m) => m.id === cv.pinned) : undefined;
  const hold = holdRef(x, c0);
  const out: S['Chat'] = {
    id: base.id,
    kind: base.kind,
    title: base.title,
    orgUnitId: base.orgUnitId ?? null,
    status: base.status,
    sensitivity: base.sensitivity,
    record: base.record ?? null,
    topics: cv.topics ?? [],
    policy: policyDto(cv.P),
    overrides: c0.over?.onFull ? { onFull: c0.over.onFull } : {},
    history: (HISTORY as readonly string[]).includes(c0.history ?? 'all')
      ? ((c0.history ?? 'all') as (typeof HISTORY)[number])
      : 'all',
    my: myDto(x, cv, true),
    memberCount: chatPeople(x.cdb, c0).filter((p) => p.st === 'in').length,
    usedBytes: bytes(cv.usedMb),
    revision: base.revision,
  };
  if (base.peer) out.peer = base.peer;
  out.pinned = pinned ? messageDto(x, cv, pinned) : null;
  out.hold = hold;
  return out;
}

export function holdRef(x: ChatsCtx, c: Chat): S['ChatHoldRef'] | null {
  if (!c.hold) return null;
  return {
    id: x.U(`${c.id}.hold`),
    reason: c.hold.reason,
    period: c.hold.period,
    until: isoDay(c.hold.until),
    createdByDisplayName: memberName(x, c.hold.by),
  };
}

export function sourceDto(x: ChatsCtx, s: ChatSource): S['ChatSource'] {
  const out: S['ChatSource'] = {
    who: s.who === 'tripDriver' ? 'trip_driver' : s.who,
    role: s.role,
  };
  if (s.ref) out.refId = x.U(s.ref);
  if (s.unit) out.orgUnitId = x.U(s.unit);
  if (s.obj) out.object = { moduleKey: 'repairs', entityType: 'project', entityId: x.U(s.obj) };
  if (s.trip) out.tripId = x.U(s.trip);
  return out;
}

export interface SourceInput {
  who: 'all' | 'group' | 'role' | 'member' | 'relation' | 'tripDriver';
  ref: string | null;
  unit: string | null;
  obj: string | null;
  trip: string | null;
  role: ChatSource['role'];
}

export function sourceInput(x: ChatsCtx, s: S['ChatSource']): SourceInput {
  const bad = (field: string, msg: string): never =>
    fail('validation_failed', msg, { violations: [{ field, code: 'not_found', message: msg }] });
  const ref = s.refId ? (x.P(s.refId) ?? bad('sources', 'Источник состава не найден')) : null;
  const unit = s.orgUnitId
    ? (x.P(s.orgUnitId) ?? bad('sources', 'Подразделение не найдено'))
    : null;
  const obj = s.object ? (x.P(s.object.entityId) ?? bad('sources', 'Объект не найден')) : null;
  const trip = s.tripId ? (x.P(s.tripId) ?? bad('sources', 'Рейс не найден')) : null;
  return {
    who: s.who === 'trip_driver' ? 'tripDriver' : s.who,
    ref,
    unit,
    obj,
    trip,
    role: s.role,
  };
}

/** Участники предпросмотра состава → ссылки контракта. */
export function peopleRefs(x: ChatsCtx, ids: readonly string[]): S['ChatMemberRef'][] {
  return ids.map((id) => memberRef(x, id));
}

export { chatAccess, chatRights };
