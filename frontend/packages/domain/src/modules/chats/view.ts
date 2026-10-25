// Ответ сервера участнику (chats.js 14.10:275–315): только доступные чаты, маска ПДн, итоги
// прочтения, опросов и «важного», корзины и журнал — тем, кто настраивает чат.
// Отличие от эталона (PD-60, бриф W7.10 §10): удалённое сообщение не «воскресает» — в проекции
// остаётся метка (кто, когда, причина модератора), а текст, файлы, документ, опрос, спойлер,
// «важное» и история правок исходного сообщения не отдаются никому.
import { hasPdn, maskPdn } from '../../core/format.ts';
import { chatRights } from './access.ts';
import type {
  Chat,
  ChatAccess,
  ChatBucket,
  ChatCan,
  ChatFile,
  ChatJournalEntry,
  ChatMessage,
  ChatPolicy,
  ChatsSlice,
  ChatsTenantDb,
  PollOption,
  Poll,
} from './types.ts';

export interface ChatFileView extends Omit<ChatFile, 'opened'> {
  opened: boolean;
  openedN: number;
}

export interface PollOptionView extends PollOption {
  n: number;
  mine: boolean;
  who: string[];
}

export type PollView = Omit<Poll, 'votes' | 'voters' | 'opts'> & {
  opts: PollOptionView[];
  total: number;
  mine: boolean;
};

export interface MessageView extends Omit<
  ChatMessage,
  'reads' | 'edits' | 'files' | 'important' | 'poll' | 'deleted' | 'revealed'
> {
  pdn: boolean;
  revealed: boolean;
  edited: number;
  editLog: { text: string; ts: number }[];
  /** Сколько других участников прочли; −1 — режим «не показывать». */
  readN: number;
  reads: { id: string; ts: number }[];
  files?: ChatFileView[] | null;
  important?: { due: string; n: number; mine: boolean; list: { id: string; ts: number }[] } | null;
  poll?: PollView | null;
  deleted?: { mod: boolean; reason: string; ts: number; by: string };
}

export interface ChatMy {
  ok: boolean;
  role: ChatAccess['role'];
  via: string[];
  owner?: boolean;
  chain: ChatAccess['chain'];
  can: Partial<ChatCan>;
  P: ChatPolicy;
  unread: number;
  ackWait: string[];
  peer: string | null;
}

export interface ChatView extends Omit<Chat, 'msgs' | 'buckets' | 'journal'> {
  msgs: MessageView[];
  buckets: ChatBucket[];
  journal: ChatJournalEntry[];
  sources: NonNullable<Chat['sources']>;
  my: ChatMy;
  P: ChatPolicy;
}

export type ChatsView = Omit<ChatsSlice, 'items'> & { items: ChatView[] };

function messageView(
  m: ChatMessage,
  actor: string,
  P: ChatPolicy,
  mod: boolean,
  now: number,
): MessageView {
  const { reads: rd, edits: ed, files: fl, important: im, poll: pl, deleted: del, ...rest } = m;
  const others = Object.keys(rd).filter((k) => k !== m.by);
  const base = {
    ...rest,
    readN: P.rcpt === 'off' ? -1 : others.length,
    reads:
      P.rcpt === 'who' && (m.by === actor || mod)
        ? others.map((k) => ({ id: k, ts: rd[k] as number }))
        : [],
  };
  if (del) {
    return {
      ...base,
      text: '',
      files: [],
      doc: null,
      poll: null,
      spoiler: null,
      important: null,
      pdn: false,
      revealed: false,
      edited: 0,
      editLog: [],
      deleted: { mod: del.mod, reason: del.mod ? del.reason : '', ts: del.ts, by: del.by },
    };
  }
  const pdn = hasPdn(m.text);
  const revealed = (m.revealed ?? []).includes(actor);
  const hide = pdn && !revealed;
  const out: MessageView = {
    ...base,
    text: hide ? maskPdn(m.text) : m.text,
    pdn,
    revealed,
    edited: (ed ?? []).length,
    editLog:
      mod || m.by === actor
        ? (ed ?? []).map((e) => ({ text: hide ? maskPdn(e.text) : e.text, ts: e.ts }))
        : [],
  };
  if (fl) {
    out.files = fl.map((f) => ({
      ...f,
      opened: f.viewOnce ? !!f.opened?.[actor] : false,
      openedN: f.viewOnce ? Object.keys(f.opened ?? {}).length : 0,
    }));
  }
  if (im) {
    const a = im.acks;
    out.important = {
      due: im.due,
      n: a.length,
      mine: a.some((y) => y.member === actor),
      list: m.by === actor || mod ? a.map((y) => ({ id: y.member, ts: y.ts })) : [],
    };
  }
  if (pl) {
    const all = Object.values(pl.votes).flat();
    const { votes, ...p } = pl;
    delete p.voters;
    out.poll = {
      ...p,
      closed: pl.closed || now >= pl.closes,
      total: new Set(all).size,
      opts: pl.opts.map((o) => {
        const v = votes[o.id] ?? [];
        return { ...o, n: v.length, mine: v.includes(actor), who: pl.anon ? [] : v };
      }),
      mine: all.includes(actor),
    };
  }
  return out;
}

/** Проекция чатов участнику; `undefined` — модуль не установлен. */
export function chatsView(
  db: ChatsTenantDb,
  actor: string,
  C: ChatsSlice | undefined,
): ChatsView | undefined {
  if (!C || !db.chats) return undefined;
  const now = db.chats.now;
  const items: ChatView[] = [];
  for (const cc of C.items) {
    const c0 = db.chats.items.find((x) => x.id === cc.id);
    if (!c0) continue;
    const r = chatRights(db, actor, c0);
    if (!r.ok || !r.role) continue;
    const mod = !!r.can.mod;
    const msgs = (cc.msgs ?? [])
      .filter(
        (m) => (!m.visibleTo || m.visibleTo.includes(actor)) && !(m.temp && m.temp.exp <= now),
      )
      .map((m) => messageView(m, actor, r.P, mod, now));
    const lr = c0.lastRead[actor] ?? 0;
    const unread = msgs.filter((m) => m.seq > lr && m.by !== actor).length;
    const ackWait = msgs
      .filter((m) => m.important && !m.important.mine && m.by !== actor && !m.deleted)
      .map((m) => m.id);
    const peer = c0.kind === 'direct' ? ((c0.pair ?? []).find((k) => k !== actor) ?? null) : null;
    const settings = !!r.can.settings;
    items.push({
      ...cc,
      msgs,
      sources: cc.sources ?? [],
      buckets: settings ? (cc.buckets ?? []) : [],
      journal: settings ? cc.journal : [],
      my: {
        ok: r.ok,
        role: r.role,
        via: r.via,
        owner: r.owner,
        chain: r.chain,
        can: r.can,
        P: r.P,
        unread,
        ackWait,
        peer,
      },
      P: r.P,
    });
  }
  return { ...C, items };
}
