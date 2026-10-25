// Модуль «Чаты» по контракту `DomainModule` ядра (B §5.1): проекция для участника и 17 команд с
// задержками. Сид — стадия `chats` (`SEED_STAGES` ядра): чаты ищут документ 42/26 и объект obj-42,
// поэтому ставятся после документов и ремонта; `install` модуля сам срез не создаёт.
// Регистрацию в `modules/index.ts` и хук в `seed/compose.ts` подключает интегратор (план v2 §3.5).
import type { CommandFn, DomainModule } from '../../core/module.ts';
import { CHAT_DELAYS, CHAT_METHODS, chatsCommands } from './commands.ts';
import type { ChatsSlice, ChatsTenantDb } from './types.ts';
import { chatsView } from './view.ts';

export const chatsModule: DomainModule<ChatsSlice | undefined> = {
  key: 'chat',
  install() {
    // Сид среза — хук стадии `chats` (`chatsHook`): он требует документы и ремонт.
  },
  view(db, actor, slice) {
    const cdb = db as ChatsTenantDb;
    if (!cdb.chats) return null;
    // Проекция (`ChatsView`) — срез с вычисленными полями `my`, `P` и свёрнутыми сообщениями;
    // контракт `DomainModule` типизирует её срезом модуля, как у «Базы знаний».
    const v = chatsView(cdb, actor, structuredClone(slice ?? cdb.chats));
    return (v as unknown as ChatsSlice | undefined) ?? null;
  },
  commands: (ctx) => chatsCommands(ctx) as unknown as Record<string, CommandFn>,
  methods: CHAT_METHODS,
  delays: CHAT_DELAYS,
};
