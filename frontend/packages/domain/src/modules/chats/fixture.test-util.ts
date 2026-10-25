// Помощники тестов чатов: «Альта» и «Лотос» базового сида с модулями, которые нужны сиду чатов
// (ремонт, логистика, документы), и установленные чаты. Каждый вызов — новые объекты.
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { ApiError } from '../../core/errors/index.ts';
import { installChats } from './seed.ts';
import type { Chat, ChatMessage, ChatsSlice, ChatsTenantDb } from './types.ts';

export interface AltaOpts {
  /** Подключить логистику и ремонт и добавить рейс Р-208 и объект obj-42 (как в демо-проходке). */
  modules?: boolean;
  /** Документ «Договор 42/26» в `db.docs` (сид чата объекта прикладывает его). */
  docs?: boolean;
  /** Не ставить чаты (сырая база). */
  raw?: boolean;
}

export function chatsAlta(o: AltaOpts = {}): ChatsTenantDb {
  const db = createAlta(createPlatform()) as unknown as ChatsTenantDb;
  const bag = db as unknown as Record<string, unknown>;
  if (o.modules) {
    db.modules.logistics = { enabled: true };
    db.modules.repair = { enabled: true };
    bag['trips'] = [{ id: 'Р-208', driverId: 'm-vasiliev' }];
    bag['repair'] = {
      objects: [
        {
          id: 'obj-42',
          name: 'ЖК Речной · квартира 42',
          unit: 'f-msk-sever',
          foreman: 'Алексей Соколов',
          foremanId: 'm-sokolov',
        },
      ],
    };
  }
  if (o.docs) bag['docs'] = { items: [{ id: 'doc-42', title: 'Договор подряда 42/26', v: 2 }] };
  if (!o.raw) installChats(db);
  return db;
}

export function chatsLotos(): ChatsTenantDb {
  const db = createLotos(createPlatform()) as ChatsTenantDb;
  installChats(db);
  return db;
}

export const slice = (db: ChatsTenantDb): ChatsSlice => {
  if (!db.chats) throw new Error('чаты не установлены');
  return db.chats;
};

export const chatOf = (db: ChatsTenantDb, id: string): Chat => {
  const c = slice(db).items.find((x) => x.id === id);
  if (!c) throw new Error('нет чата ' + id);
  return c;
};

export const msgOf = (c: Chat, id: string): ChatMessage => {
  const m = c.msgs.find((x) => x.id === id);
  if (!m) throw new Error('нет сообщения ' + id);
  return m;
};

/** Код и текст ошибки команды (`ApiError`) или `null`. */
export function apiErr(fn: () => unknown): { code: string; message: string } | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
}
