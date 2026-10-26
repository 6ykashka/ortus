// Тег Chats сценарного сервера (W7.00, контрактный PR этапа 7): 37 операций «Чатов» поверх домена W7.10 —
// список и чат, лента, отправка, правка и удаление, прочтение и важное, опросы, закрепление, ПДн, одноразовые файлы,
// «Сохранить в запись», задача из сообщения, состав и источники, хранение и очистка, журнал, выгрузка, политики видов и
// удержания (эталон «Чаты.dc.html», design-2026-10-19; docs/25). Чужой чат не виден нигде: 404, как отсутствующий.
import type { components } from '@ortus/api-client';
import { type Chat, chatPeople, chatVerbs } from '@ortus/domain/modules';
import { chatAccess, type ChatKind, CHAT_DEFAULT_POLICY } from '@ortus/domain/modules';

import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import { chatInstant, registerStage7Keys } from '../stage7/seed.ts';
import {
  attachmentDtos,
  boundsDto,
  bytes,
  chatDto,
  type ChatsCtx,
  chatsCtx,
  holdRef,
  KINDS,
  isoDay,
  memberRef,
  messageDto,
  peopleRefs,
  policyDto,
  policyPatch,
  sourceDto,
  sourceInput,
  summaryDto,
  fileKind,
  MB,
} from './state.ts';

registerStage7Keys();

type S = components['schemas'];

const body = <T>(ctx: HandlerContext): T => ctx.body as T;

function invalid(field: string, message: string, code = 'invalid'): never {
  return fail('validation_failed', message, { violations: [{ field, code, message }] });
}

/** Чат по UUID пути: недоступный участнику — 404, как отсутствующий. */
function chatOr404(
  x: ChatsCtx,
  id: string | undefined,
): { c: Chat; cv: ReturnType<ChatsCtx['views']>[number] } {
  const proto = x.P(id);
  const c = x.cdb.chats?.items.find((y) => y.id === proto);
  const cv = c ? x.views().find((y) => y.id === c.id) : undefined;
  if (!c || !cv) return fail('not_found', 'Чат не найден или недоступен');
  return { c, cv };
}

/** Сообщение чата по UUID пути (то же чат — иначе 404). */
function msgOr404(x: ChatsCtx, c: Chat, id: string | undefined): string {
  const proto = x.P(id);
  if (!proto || !c.msgs.some((m) => m.id === proto)) fail('not_found', 'Сообщение не найдено');
  return proto as string;
}

const bump = (x: ChatsCtx, id: string): void => {
  x.s.chatRev[id] = (x.s.chatRev[id] ?? 1) + 1;
};

/** Сообщение после команды — проекция участнику. */
function messageOut(x: ChatsCtx, chatId: string, msgId: string): S['ChatMessage'] {
  const cv = x.views().find((y) => y.id === chatId);
  const m = cv?.msgs.find((y) => y.id === msgId);
  if (!cv || !m) return fail('not_found', 'Сообщение не найдено');
  return messageDto(x, cv, m);
}

const FOLDER: Readonly<Record<string, readonly ChatKind[]>> = {
  direct: ['direct'],
  work: ['group', 'area'],
  record: ['record'],
  announce: ['announce'],
};

const preview = (
  x: ChatsCtx,
  r: {
    joined: { id: string }[];
    pending: { id: string }[];
    skipped: { id: string; why?: string }[];
  },
  lose: string[] = [],
): S['ChatMembershipImpact'] => ({
  joined: peopleRefs(
    x,
    r.joined.map((p) => p.id),
  ),
  pending: peopleRefs(
    x,
    r.pending.map((p) => p.id),
  ),
  skipped: r.skipped.map((p) => ({ member: memberRef(x, p.id), reason: p.why ?? 'Вне области' })),
  lose: peopleRefs(x, lose),
});

function sourcesDto(x: ChatsCtx, c: Chat): S['ChatSources'] {
  const items: S['ChatSource'][] = (c.sources ?? []).map((s) => sourceDto(x, s));
  for (const a of x.cdb.assignments) {
    if (a.scope.type !== 'chat' || a.scope.id !== c.id) continue;
    const role = x.cdb.roles.find((r) => r.id === a.role) as
      { chatRole?: 'owner' | 'moderator' | 'member' | 'reader' } | undefined;
    if (!role?.chatRole || role.chatRole === 'owner') continue;
    items.push({ who: 'member', refId: x.U(a.member), role: role.chatRole });
  }
  return { items, revision: x.s.srcRev[c.id] ?? 1 };
}

const kindPolicy = (x: ChatsCtx, kind: ChatKind): S['ChatKindPolicy'] => ({
  kind,
  policy: policyDto(x.cdb.chats?.policy[kind] ?? CHAT_DEFAULT_POLICY[kind]),
  bounds: boundsDto(),
  revision: x.s.policyRev[kind] ?? 1,
});

function holdToDto(x: ChatsCtx, row: ChatsCtx['s']['holds'][number]): S['ChatHold'] {
  const out: S['ChatHold'] = {
    id: x.U(row.id),
    scope: row.scope,
    reason: row.reason,
    period:
      row.from || row.to
        ? `${row.from?.slice(0, 10) ?? '…'} — ${row.to?.slice(0, 10) ?? '…'}`
        : 'до отмены',
    until: row.until,
    createdByDisplayName: x.cdb.members.find((m) => m.id === row.by)?.name ?? '—',
    createdAt: row.at,
    files: 0,
    status: row.status,
  };
  if (row.chatId) out.chatId = x.U(row.chatId);
  if (row.memberIds.length) out.memberIds = row.memberIds.map((m) => x.U(m));
  if (row.from) out.from = row.from;
  if (row.to) out.to = row.to;
  return out;
}

/** Удержание домена (`chat.hold`) как строка списка удержаний. */
function domainHoldDto(x: ChatsCtx, c: Chat): S['ChatHold'] | null {
  const h = c.hold;
  if (!h) return null;
  return {
    id: x.U(`${c.id}.hold`),
    scope: 'chat',
    chatId: x.U(c.id),
    reason: h.reason,
    period: h.period,
    until: isoDay(h.until),
    createdByDisplayName: x.cdb.members.find((m) => m.id === h.by)?.name ?? '—',
    createdAt: chatInstant(c.last),
    files: h.files,
    status: 'active',
  };
}

export const chatsHandlers: Registry = {
  listChats: (ctx) => {
    const x = chatsCtx(ctx);
    const folder = ctx.query.get('folder') ?? 'all';
    const q = (ctx.query.get('q') ?? '').trim().toLowerCase();
    const views = x.views();
    const counts: S['ChatFolderCounts'] = {
      all: views.length,
      direct: views.filter((v) => v.kind === 'direct').length,
      work: views.filter((v) => v.kind === 'group' || v.kind === 'area').length,
      record: views.filter((v) => v.kind === 'record').length,
      announce: views.filter((v) => v.kind === 'announce').length,
    };
    const items = views
      .filter((v) => folder === 'all' || (FOLDER[folder] ?? []).includes(v.kind))
      .map((v) => summaryDto(x, v))
      .filter((s) => !q || `${s.title} ${s.lastMessage?.text ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.lastMessage?.at ?? '').localeCompare(a.lastMessage?.at ?? ''));
    return { body: { ...page(items, ctx.query), counts } };
  },

  createChat: (ctx) => {
    const x = chatsCtx(ctx);
    const b = body<S['ChatCreate']>(ctx);
    const spec = {
      kind: b.kind,
      unit: b.orgUnitId
        ? (x.P(b.orgUnitId) ?? invalid('orgUnitId', 'Подразделение не найдено'))
        : null,
      title: b.title,
      ...(b.label && b.label !== 'normal' ? { label: b.label } : {}),
      sources: b.sources.map((s) => sourceInput(x, s)),
      ...(b.history ? { history: b.history } : {}),
    };
    if (b.dryRun) {
      const pv = x.run(() => x.cmds.chatCreate(spec, true));
      return { status: 200, body: { applied: false, impact: preview(x, pv) } };
    }
    const res = x.run(() => x.cmds.chatCreate(spec, false));
    const cv = x.views().find((v) => v.id === res.id);
    if (!cv) return fail('not_found', 'Чат не найден или недоступен');
    return {
      status: 201,
      body: { applied: true, chat: chatDto(x, cv), impact: preview(x, res) },
      etag: x.s.chatRev[res.id] ?? 1,
    };
  },

  createDirectChat: (ctx) => {
    const x = chatsCtx(ctx);
    const b = body<S['ChatDirectCreate']>(ctx);
    const other = x.P(b.memberId);
    const m = x.cdb.members.find((y) => y.id === other);
    if (!m || !other) return invalid('memberId', 'Сотрудник не найден');
    if (other === x.me) return invalid('memberId', 'Нельзя начать чат с самим собой');
    const vb = chatVerbs(x.cdb, x.me);
    if (!vb.all && !vb.has('create')) return fail('forbidden_action', 'Нет права «Личные чаты»');
    if (m.status !== 'active') {
      return fail('chat_member_out_of_scope', `${m.name} не входит в вашу область`);
    }
    const cs = x.cdb.chats?.items ?? [];
    let c = cs.find(
      (y) => y.kind === 'direct' && (y.pair ?? []).includes(x.me) && (y.pair ?? []).includes(other),
    );
    const existed = !!c;
    if (!c) {
      c = {
        id: x.mctx.ids.next('ch-'),
        kind: 'direct',
        title: '',
        unit: null,
        owner: x.me,
        pair: [x.me, other],
        msgs: [],
        seq: 0,
        last: x.cdb.chats?.now ?? 0,
        usedMb: 0,
        journal: [],
        status: 'active',
        sensitivity: 'normal',
        lastRead: {},
      };
      cs.unshift(c);
    }
    const cv = x.views().find((v) => v.id === (c as Chat).id);
    if (!cv) return fail('not_found', 'Чат не найден или недоступен');
    return { status: existed ? 200 : 201, body: chatDto(x, cv), etag: x.s.chatRev[c.id] ?? 1 };
  },

  getChat: (ctx) => {
    const x = chatsCtx(ctx);
    const { cv } = chatOr404(x, ctx.params.chatId);
    return { body: chatDto(x, cv), etag: x.s.chatRev[cv.id] ?? 1 };
  },

  updateChat: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.settings)
      return fail('forbidden_action', 'Менять настройки хранения может владелец чата');
    ctx.revision(x.s.chatRev[c.id] ?? 1);
    const b = body<S['ChatPatch']>(ctx);
    if (b.title !== undefined) {
      const t = b.title.trim();
      if (t.length < 3) invalid('title', 'Название — не короче 3 символов', 'too_short');
    }
    if (b.label === 'finance' && !chatVerbs(x.cdb, x.me).all) {
      return fail('forbidden_action', 'Метку «Финансы» ставит владелец бизнеса');
    }
    if (b.overrides?.onFull) x.run(() => x.cmds.chatSetFull(c.id, b.overrides?.onFull as never));
    if (b.title !== undefined) c.title = b.title.trim();
    if (b.label) c.sensitivity = b.label;
    if (b.history) c.history = b.history;
    bump(x, c.id);
    const next = x.views().find((v) => v.id === c.id) ?? cv;
    return { body: chatDto(x, next), etag: x.s.chatRev[c.id] };
  },

  archiveChat: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.settings) return fail('forbidden_action', 'Архивировать чат может его владелец');
    if (c.status === 'archived') return fail('invalid_transition', 'Чат уже в архиве');
    c.status = 'archived';
    bump(x, c.id);
    const next = x.views().find((v) => v.id === c.id) ?? cv;
    return { body: chatDto(x, next), etag: x.s.chatRev[c.id] };
  },

  listChatMessages: (ctx) => {
    const x = chatsCtx(ctx);
    const { cv } = chatOr404(x, ctx.params.chatId);
    const limit = Math.min(200, Number(ctx.query.get('limit') ?? 50) || 50);
    const topic = ctx.query.get('topic');
    const before = ctx.query.get('beforeSeq');
    const after = ctx.query.get('afterSeq');
    let msgs = cv.msgs.filter((m) => !topic || m.topic === topic);
    if (before) msgs = msgs.filter((m) => m.seq < Number(before));
    if (after) msgs = msgs.filter((m) => m.seq > Number(after));
    const hasMore = msgs.length > limit;
    msgs = after ? msgs.slice(0, limit) : msgs.slice(-limit);
    return { body: { items: msgs.map((m) => messageDto(x, cv, m)), hasMore, lastSeq: cv.seq } };
  },

  postChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    const b = body<S['ChatMessageCreate']>(ctx);
    const files = (b.fileIds ?? []).map((id) => {
      const f = ctx.org().org.files.find((y) => y.id === id);
      if (!f) return invalid('fileIds', 'Файл не найден');
      return { name: f.fileName, mb: f.sizeBytes / MB, kind: fileKind(f.contentType) };
    });
    if (b.ephemeral && !cv.my.can.temp) {
      return fail(
        'chat_ephemeral_disabled',
        `Временные сообщения в этом чате запрещены политикой вида «${cv.kind}»`,
      );
    }
    const spec = {
      ...(b.text !== undefined ? { text: b.text } : {}),
      ...(files.length ? { files } : {}),
      ...(b.document
        ? {
            doc: {
              kind: b.document.kind,
              ref: x.P(b.document.refId) ?? '',
              title: b.document.kind,
            },
          }
        : {}),
      ...(b.poll
        ? {
            poll: {
              q: b.poll.question,
              opts: b.poll.options,
              hours: b.poll.closesInHours ?? 24,
              anon: !!b.poll.anonymous,
              multi: !!b.poll.multiple,
            },
          }
        : {}),
      ...(b.important
        ? {
            important: true,
            due: b.important.dueDate
              ? `${b.important.dueDate.slice(8, 10)}.${b.important.dueDate.slice(5, 7)}`
              : '04.10',
          }
        : {}),
      ...(b.ephemeral ? { temp: b.ephemeral.ttlHours } : {}),
      ...(b.viewOnce ? { viewOnce: true } : {}),
      ...(b.spoiler ? { spoiler: b.spoiler } : {}),
      ...(b.topic ? { topic: b.topic } : {}),
    };
    const res = x.run(() => x.cmds.chatSend(c.id, spec));
    return { status: 201, body: messageOut(x, c.id, res.id) };
  },

  editChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    const b = body<S['ChatMessageEdit']>(ctx);
    x.run(() => x.cmds.chatEdit(id, b.text));
    return { body: messageOut(x, c.id, id) };
  },

  deleteChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    x.run(() => x.cmds.chatDelete(id, ctx.query.get('reason') ?? undefined));
    return { body: messageOut(x, c.id, id) };
  },

  listChatMessageVersions: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    const m = c.msgs.find((y) => y.id === id);
    if (!m || (m.by !== x.me && !cv.my.can.mod)) {
      return fail('forbidden_action', 'История правок — автору и модераторам');
    }
    const items = (m.edits ?? [])
      .map((e) => ({ text: e.text, editedAt: chatInstant(e.ts) }))
      .reverse();
    return { body: { items } };
  },

  markChatRead: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const upto = Math.min(body<S['ChatReadMark']>(ctx).uptoSeq, c.seq);
    const now = x.cdb.chats?.now ?? 0;
    for (const m of c.msgs) {
      if (m.seq <= upto && m.by !== x.me && m.by !== 'sys' && !m.reads[x.me]) m.reads[x.me] = now;
    }
    c.lastRead = { ...c.lastRead, [x.me]: Math.max(c.lastRead[x.me] ?? 0, upto) };
    const cv = x.views().find((v) => v.id === c.id);
    return {
      status: 200,
      body: { lastReadSeq: c.lastRead[x.me] ?? 0, unread: cv?.my.unread ?? 0 },
    };
  },

  ackChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    x.run(() => x.cmds.chatAck(id));
    return { body: messageOut(x, c.id, id) };
  },

  getChatMessageReceipts: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    const m = c.msgs.find((y) => y.id === id);
    if (!m || (m.by !== x.me && !cv.my.can.mod)) {
      return fail('forbidden_action', 'Кто прочитал — видят автор и модераторы');
    }
    const others = Object.keys(m.reads).filter((k) => k !== m.by);
    const total = Math.max(0, chatPeople(x.cdb, c).filter((p) => p.st === 'in').length - 1);
    const out: S['ChatReceipts'] = { mode: cv.P.rcpt, readCount: others.length, totalCount: total };
    if (cv.P.rcpt === 'who') {
      out.items = others.map((k) => ({
        member: memberRef(x, k),
        readAt: chatInstant(m.reads[k] as number),
      }));
    }
    return { body: out };
  },

  revealChatMessagePdn: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    const me = x.cdb.members.find((m) => m.id === x.me);
    if (me?.function === 'driver') {
      return fail('function_blocked', 'Функция «Водитель»: ПДн под маской всегда');
    }
    x.run(() => x.cmds.chatReveal(id));
    const m = c.msgs.find((y) => y.id === id);
    return {
      body: {
        messageId: x.U(id),
        text: m?.text ?? '',
        revealedAt: chatInstant(x.cdb.chats?.now ?? 0),
      },
    };
  },

  voteChatPoll: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const pollMsg = x.P(ctx.params.pollId)?.replace(/\.poll$/, '');
    const id = msgOr404(x, c, pollMsg ? x.U(pollMsg) : undefined);
    const m = c.msgs.find((y) => y.id === id);
    const raw = body<S['ChatVote']>(ctx).optionIds.map((o) => x.P(o));
    const ids = raw.map((o) => o?.split('.')[1]);
    if (
      raw.some((o, i) => !o?.startsWith(`${id}.`) || !m?.poll?.opts.some((p) => p.id === ids[i]))
    ) {
      return invalid('optionIds', 'Вариант не относится к этому опросу');
    }
    if (!ids.length && m?.poll) {
      if (m.poll.closed) return fail('invalid_transition', `Опрос закрыт ${m.poll.closesLabel}`);
      for (const k of Object.keys(m.poll.votes))
        m.poll.votes[k] = (m.poll.votes[k] ?? []).filter((v) => v !== x.me);
    } else {
      x.run(() => x.cmds.chatVote(id, ids as string[]));
    }
    return { body: messageOut(x, c.id, id) };
  },

  closeChatPoll: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const pollMsg = x.P(ctx.params.pollId)?.replace(/\.poll$/, '');
    const id = msgOr404(x, c, pollMsg ? x.U(pollMsg) : undefined);
    x.run(() => x.cmds.chatPollClose(id));
    return { status: 200, body: messageOut(x, c.id, id) };
  },

  remindChatPoll: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const pollMsg = x.P(ctx.params.pollId)?.replace(/\.poll$/, '');
    const id = msgOr404(x, c, pollMsg ? x.U(pollMsg) : undefined);
    const m = c.msgs.find((y) => y.id === id);
    const p = m?.poll;
    if (!p) return fail('not_found', 'Опрос не найден');
    if (p.closed) return fail('invalid_transition', `Опрос закрыт ${p.closesLabel}`);
    const voted = new Set(Object.values(p.votes).flat());
    const left = chatPeople(x.cdb, c).filter(
      (q) => q.st === 'in' && !voted.has(q.id) && q.id !== x.me,
    );
    return { status: 200, body: { notified: left.length } };
  },

  pinChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, body<S['ChatPin']>(ctx).messageId);
    if (c.pinned !== id) x.run(() => x.cmds.chatPin(id));
    return { body: { pinnedMessageId: c.pinned ? x.U(c.pinned) : null } };
  },

  unpinChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.pin) return fail('forbidden_action', 'Закрепляют модераторы');
    c.pinned = null;
    return { status: 200, body: { pinnedMessageId: null } };
  },

  openViewOnceAttachment: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const att = x.P(ctx.params.attachmentId);
    const msg = att?.split('.')[0];
    if (!att || !msg || !c.msgs.some((m) => m.id === msg))
      return fail('not_found', 'Вложение не найдено');
    const r = x.run(() => x.cmds.chatOpenOnce(msg));
    const now = Date.parse(ctx.now());
    return {
      status: 200,
      body: {
        url: `https://files.ortus.invalid/view/${ctx.params.attachmentId}`,
        expiresAt: new Date(now + 5 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        watermark: `${x.cdb.members.find((m) => m.id === x.me)?.name ?? ''} · ${r.name}`,
        noDownload: true,
      },
    };
  },

  saveChatAttachmentsToRecord: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    const rec = c.record;
    if (!rec) return invalid('record', 'У чата нет записи');
    const res = x.run(() => x.cmds.chatSaveTo(id));
    const cv = x.views().find((v) => v.id === c.id);
    const m = cv?.msgs.find((y) => y.id === id);
    const saved = m ? attachmentDtos(x, m).filter((a) => a.savedTo) : [];
    const ref = chatDto(x, cv as never).record?.object ?? {
      moduleKey: 'repairs',
      entityType: 'project',
      entityId: x.U(rec.id),
    };
    return { status: 200, body: { saved, record: ref, bytes: bytes(res.mb) } };
  },

  createTaskFromChatMessage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const id = msgOr404(x, c, ctx.params.messageId);
    const b = body<S['ChatTaskCreate']>(ctx);
    const project = b.projectId
      ? (x.P(b.projectId) ?? invalid('projectId', 'Проект не найден'))
      : undefined;
    const res = x.run(() => x.cmds.chatToTask(id, project));
    return { status: 201, body: { taskId: x.U(res.id), key: res.id } };
  },

  listChatMembers: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.members) return fail('forbidden_action', 'Состав видят те, кто им управляет');
    const people = chatPeople(x.cdb, c);
    const items: S['ChatMember'][] = people.map((p) => {
      const out: S['ChatMember'] = {
        member: memberRef(x, p.id),
        state: p.st,
        role: p.role ?? null,
      };
      if (p.via) out.via = p.via;
      if (p.why) out.why = p.why;
      return out;
    });
    const counts = { in: 0, pending: 0, out: 0 };
    for (const p of people) counts[p.st]++;
    return { body: { items, counts } };
  },

  getChatSources: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.members) return fail('forbidden_action', 'Состав видят те, кто им управляет');
    const out = sourcesDto(x, c);
    return { body: out, etag: out.revision };
  },

  replaceChatSources: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.members)
      return fail('forbidden_action', 'Состав меняют владелец чата и модераторы');
    ctx.revision(x.s.srcRev[c.id] ?? 1);
    const b = body<S['ChatSourcesReplace']>(ctx);
    const list = b.sources.map((s) => sourceInput(x, s));
    const res = x.run(() => x.cmds.chatSources(c.id, list, !!b.dryRun));
    const impact = preview(x, res, res.lose);
    if (b.dryRun) return { body: { applied: false, impact }, etag: x.s.srcRev[c.id] ?? 1 };
    x.s.srcRev[c.id] = (x.s.srcRev[c.id] ?? 1) + 1;
    const sources = sourcesDto(x, c);
    return { body: { applied: true, impact, sources }, etag: sources.revision };
  },

  getChatAccessExplanation: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.members)
      return fail('forbidden_action', 'Проверять состав может тот, кто им управляет');
    const m = x.P(ctx.query.get('memberId') ?? undefined);
    if (!m || !x.cdb.members.some((y) => y.id === m))
      return fail('not_found', 'Сотрудник не найден');
    const a = chatAccess(x.cdb, m, c);
    const out: S['ChatAccessExplanation'] = {
      member: memberRef(x, m),
      ok: a.ok,
      role: a.role,
      chain: a.chain.map((s) => ({ title: s.t, detail: s.d, ok: s.ok })),
    };
    if (a.reason) out.reason = a.reason;
    if (a.why) out.why = a.why;
    return { body: out };
  },

  getChatStorage: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.settings) return fail('forbidden_action', 'Хранение показывает владелец чата');
    return {
      body: {
        usedBytes: bytes(c.usedMb),
        quotaBytes: cv.P.quotaMb ? bytes(cv.P.quotaMb) : null,
        savedBytes: bytes(c.savedMb ?? 0),
        archivedBytes: bytes(c.archivedMb ?? 0),
        buckets: (c.buckets ?? []).map((b) => ({
          id: b.id,
          kind: b.kind,
          label: b.label,
          ageDays: b.ageD,
          files: b.n,
          bytes: bytes(b.mb),
          hold: !!b.hold,
          compressed: !!b.compressed,
        })),
        onFull: cv.P.onFull,
        hold: holdRef(x, c),
      } satisfies S['ChatStorage'],
    };
  },

  createChatCleanup: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.settings) return fail('forbidden_action', 'Очищать чат может его владелец');
    const b = body<S['ChatCleanupCreate']>(ctx);
    const map: Record<string, string> = {
      video: 'video90',
      photo: 'photo180',
      voice: 'voice30',
      doc: 'docs30',
    };
    const filters = (b.kinds ?? []).map((k) => map[k] as string);
    if (!filters.length) return invalid('kinds', 'Выберите, что удалить');
    if (c.hold && !b.dryRun && !c.hold.members && !c.hold.range) {
      return fail(
        'chat_on_hold',
        `Нельзя очистить: удержание «${c.hold.reason}» до ${c.hold.until}`,
      );
    }
    const res = x.run(() => x.cmds.chatCleanup(c.id, filters, !!b.dryRun));
    return {
      status: 200,
      body: {
        applied: !b.dryRun,
        files: res.n,
        bytes: bytes(res.mb),
        afterBytes: bytes(res.after),
        kept: { saved: bytes(res.saved), held: bytes(res.heldMb) },
      },
    };
  },

  listChatJournal: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.settings) return fail('forbidden_action', 'Журнал показывает владелец чата');
    const items: S['ChatJournalEntry'][] = c.journal.map((j, i) => ({
      id: x.U(`${c.id}.j${c.journal.length - i}`),
      at: chatInstant(j.ts),
      actorDisplayName: x.cdb.members.find((m) => m.id === j.by)?.name ?? 'Система',
      text: j.text,
    }));
    return { body: page(items, ctx.query) };
  },

  createChatExport: (ctx) => {
    const x = chatsCtx(ctx);
    const { c, cv } = chatOr404(x, ctx.params.chatId);
    if (!cv.my.can.settings && !chatVerbs(x.cdb, x.me).all)
      return fail('forbidden_action', 'Выгружать историю может владелец чата');
    const b = body<S['ChatExportCreate']>(ctx);
    const id = `ex-w${++x.s.seq}`;
    x.s.exports.push({
      id,
      chatId: c.id,
      format: b.format,
      status: 'queued',
      createdAt: ctx.now(),
      by: x.me,
    });
    return { status: 202, body: { id: x.U(id), status: 'queued', createdAt: ctx.now() } };
  },

  getChatExport: (ctx) => {
    const x = chatsCtx(ctx);
    const { c } = chatOr404(x, ctx.params.chatId);
    const proto = x.s.exports.map((e) => e.id).find((id) => x.U(id) === ctx.params.exportId);
    const row = x.s.exports.find((e) => e.id === proto && e.chatId === c.id && e.by === x.me);
    if (!row) return fail('not_found', 'Выгрузка не найдена');
    row.status = 'done';
    return {
      body: {
        id: x.U(row.id),
        status: row.status,
        createdAt: row.createdAt,
        file: {
          id: x.U(`${row.id}.file`),
          fileName: `chat-${c.id}.${row.format}`,
          contentType: row.format === 'csv' ? 'text/csv' : 'application/json',
          sizeBytes: 2048,
          sha256: 'a'.repeat(64),
          status: 'ready',
          createdAt: row.createdAt,
        },
      } satisfies S['ChatExport'],
    };
  },

  listChatPolicies: (ctx) => {
    const x = chatsCtx(ctx);
    return { body: { items: KINDS.map((k) => kindPolicy(x, k)) } };
  },

  updateChatPolicy: (ctx) => {
    const x = chatsCtx(ctx);
    const kind = ctx.params.kind as ChatKind;
    if (!KINDS.includes(kind)) return fail('not_found', 'Неизвестный вид чата');
    const b = body<S['ChatPolicyUpdate']>(ctx);
    const res = x.run(() => x.cmds.chatPolicySet(kind, policyPatch(b.patch), !!b.dryRun));
    if (!b.dryRun) x.s.policyRev[kind] = (x.s.policyRev[kind] ?? 1) + 1;
    return {
      status: 200,
      body: { applied: !b.dryRun, policy: kindPolicy(x, kind), notes: res.notes.map((n) => n[2]) },
    };
  },

  listChatHolds: (ctx) => {
    const x = chatsCtx(ctx);
    const items: S['ChatHold'][] = [];
    for (const c of x.cdb.chats?.items ?? []) {
      const h = domainHoldDto(x, c);
      if (h) items.push(h);
    }
    for (const row of x.s.holds) items.push(holdToDto(x, row));
    return { body: { items } };
  },

  createChatHold: (ctx) => {
    const x = chatsCtx(ctx);
    const b = body<S['ChatHoldCreate']>(ctx);
    if (b.scope === 'chat') {
      const c = x.cdb.chats?.items.find((y) => y.id === x.P(b.chatId));
      if (!c) return invalid('chatId', 'Чат не найден');
      c.hold = {
        reason: b.reason,
        period: 'до отмены',
        until: b.until
          ? `${b.until.slice(8, 10)}.${b.until.slice(5, 7)}.${b.until.slice(0, 4)}`
          : '—',
        by: x.me,
        files: 0,
      };
      const dto = domainHoldDto(x, c) as S['ChatHold'];
      return { status: 201, body: dto };
    }
    if (b.scope === 'member' && !(b.memberIds ?? []).length)
      return invalid('memberIds', 'Выберите сотрудников');
    if (b.scope === 'period' && !b.from && !b.to) return invalid('from', 'Укажите период');
    const row = {
      id: `hold-w${++x.s.seq}`,
      scope: b.scope,
      chatId: null,
      memberIds: (b.memberIds ?? []).map(
        (m) => x.P(m) ?? invalid('memberIds', 'Сотрудник не найден'),
      ),
      from: b.from ?? null,
      to: b.to ?? null,
      reason: b.reason,
      until: b.until ?? null,
      by: x.me,
      at: ctx.now(),
      status: 'active' as const,
    };
    x.s.holds.push(row);
    return { status: 201, body: holdToDto(x, row) };
  },

  releaseChatHold: (ctx) => {
    const x = chatsCtx(ctx);
    for (const c of x.cdb.chats?.items ?? []) {
      if (x.U(`${c.id}.hold`) === ctx.params.holdId && c.hold) {
        const dto = { ...(domainHoldDto(x, c) as S['ChatHold']), status: 'released' as const };
        delete c.hold;
        return { status: 200, body: dto };
      }
    }
    const row = x.s.holds.find((h) => x.U(h.id) === ctx.params.holdId && h.status === 'active');
    if (!row) return fail('not_found', 'Удержание не найдено');
    row.status = 'released';
    return { status: 200, body: holdToDto(x, row) };
  },
};
