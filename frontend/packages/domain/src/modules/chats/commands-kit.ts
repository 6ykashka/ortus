// Общая оснастка команд чатов (chats.js 14.10:318–335): доступ к срезу, поиск чата и сообщения,
// проверка прав, время демо, публикация сообщений и журнал. Команды — функции над БД организации
// из `ModuleCtx`; задержку, сеть и проекцию добавляет адаптер.
import type { ModuleCtx } from '../../core/module.ts';
import { chatAccess, chatRights, chatTitle } from './access.ts';
import type {
  Chat,
  ChatCan,
  ChatMessage,
  ChatRights,
  ChatsSlice,
  ChatsTenantDb,
  SysCard,
} from './types.ts';

export interface Kit {
  ctx: ModuleCtx;
  db(): ChatsTenantDb;
  /** Актёр команды; без актёра — пустая строка (доступа к чатам нет). */
  me(): string;
  meName(): string;
  X(): ChatsSlice;
  chat(id: string): Chat;
  need(c: Chat, k?: keyof ChatCan, why?: string): ChatRights;
  find(msgId: string): [Chat, ChatMessage];
  tick(n?: number): number;
  inIds(c: Chat): string[];
  title(c: Chat): string;
  post(c: Chat, o: Partial<ChatMessage>, by?: string): ChatMessage;
  sys(c: Chat, title: string, text: string, icon?: string, tone?: string): ChatMessage;
  journal(c: Chat, text: string): void;
}

export function chatsKit(ctx: ModuleCtx): Kit {
  const { ApiError } = ctx;
  const db = (): ChatsTenantDb => ctx.getDb() as ChatsTenantDb;
  const me = (): string => ctx.getActor() ?? '';
  const X = (): ChatsSlice => {
    const x = db().chats;
    if (!x) throw new ApiError('not_found', 'Модуль «Чаты» не подключён');
    return x;
  };
  const chat = (id: string): Chat => {
    const c = X().items.find((x) => x.id === id);
    if (!c) throw new ApiError('not_found', 'Чат не найден');
    return c;
  };
  const need = (c: Chat, k?: keyof ChatCan, why?: string): ChatRights => {
    const r = chatRights(db(), me(), c);
    if (!r.ok) throw new ApiError('not_found', 'Чат не найден или недоступен');
    if (k && !r.can[k]) throw new ApiError('forbidden', why ?? 'Недостаточно прав');
    return r;
  };
  /**
   * Сообщение по id. Сообщение чата, недоступного участнику, неотличимо от несуществующего
   * (в эталоне разные тексты выдавали существование чужого сообщения).
   */
  const find = (msgId: string): [Chat, ChatMessage] => {
    for (const c of X().items) {
      const m = c.msgs.find((x) => x.id === msgId);
      if (m) {
        if (!chatAccess(db(), me(), c).ok) break;
        return [c, m];
      }
    }
    throw new ApiError('not_found', 'Сообщение не найдено');
  };
  const tick = (n = 1): number => {
    const x = X();
    x.now += n;
    return x.now;
  };
  const post = (c: Chat, o: Partial<ChatMessage>, by?: string): ChatMessage => {
    const id = ctx.ids.next('cm-');
    c.seq += 1;
    const m: ChatMessage = {
      id,
      seq: c.seq,
      ts: tick(1),
      by: by ?? me(),
      text: '',
      reads: {},
      ...o,
    };
    if (m.by !== 'sys') m.reads[m.by] = m.ts;
    c.msgs.push(m);
    c.last = m.ts;
    if (m.by !== 'sys') c.lastRead = { ...c.lastRead, [m.by]: m.seq };
    return m;
  };
  return {
    ctx,
    db,
    me,
    meName: () => db().members.find((m) => m.id === me())?.name ?? '—',
    X,
    chat,
    need,
    find,
    tick,
    inIds: (c) =>
      db()
        .members.filter((m) => chatAccess(db(), m.id, c).ok)
        .map((m) => m.id),
    title: (c) => chatTitle(db(), c, me()),
    post,
    sys: (c, title, text, icon, tone) => {
      const sys: SysCard = {
        mod: 'Чаты',
        icon: icon ?? 'info',
        tone: tone ?? 'neutral',
        title,
        text,
      };
      return post(c, { sys }, 'sys');
    },
    journal: (c, text) => {
      c.journal.unshift({ ts: X().now, by: me(), text });
    },
  };
}
