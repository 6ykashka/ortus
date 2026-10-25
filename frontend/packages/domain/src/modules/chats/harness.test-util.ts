// Стенд тестов команд чатов: «Альта» с чатами, контекст модуля с двойником `TaskPort`, смена актёра.
import { fixedClock } from '../../core/clock.ts';
import { createIdGen } from '../../core/ids.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/fake-task-port.ts';
import { chatsCommands, type ChatsApi } from './commands.ts';
import { chatOf, chatsAlta, msgOf, slice } from './fixture.test-util.ts';
import type { Chat, ChatMessage, ChatsTenantDb } from './types.ts';

export const clock = fixedClock('2026-10-01T11:05:00+03:00');

export function harness(actor = 'm-owner', o: { projects?: boolean } = {}) {
  const db = chatsAlta({ modules: true, docs: true });
  if (o.projects !== false) {
    db.projects = [
      { id: 'leads', key: 'ЗАЯ', name: 'Заявки · Ремонт', flow: 'leads', unit: 'f-msk-sever' },
      { id: 'fleet', key: 'LOG', name: 'Логистика · Север', unit: 'f-msk-sever' },
      { id: 'other', key: 'ОТЧ', name: 'Другой', unit: 'f-spb-neva' },
    ];
  }
  let who: string | null = actor;
  const ids = createIdGen(() => db);
  const tasks = createFakeTaskPort();
  const ctx = createModuleCtx({ getDb: () => db, getActor: () => who, clock, ids, tasks });
  const api: ChatsApi = chatsCommands(ctx);
  return {
    db: db as ChatsTenantDb,
    api,
    tasks,
    chat: (id: string): Chat => chatOf(db, id),
    msg: (chatId: string, id: string): ChatMessage => msgOf(chatOf(db, chatId), id),
    now: (): number => slice(db).now,
    events: () => db.events ?? [],
    as: (m: string | null) => {
      who = m;
    },
  };
}

export type Harness = ReturnType<typeof harness>;
