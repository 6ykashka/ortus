// W2.24 · Хранилище устройства (S2-15; 07-ux §6 «черновик осмотра, фото и очередь отправки на устройстве»;
// 15-quality-security «минимальный offline-кеш без финансовых данных, удаление локальных данных при logout»).
// IndexedDB `ortus-device`, одно хранилище «ключ → значение»: значения — данные очереди и черновиков и Blob фото
// (уже сжатые, без EXIF — photos.ts). Ключ — `<вид>:<организация>:<пользователь>[:…]`: данные разных аккаунтов на
// одном телефоне не смешиваются, выход удаляет данные своего пользователя. Без IndexedDB (jsdom, старый браузер,
// приватный режим с отказом) — хранилище в памяти до перезагрузки. Хранение «насовсем» браузер не обещает:
// navigator.storage.persist() снижает риск очистки, но не гарантирует (07-ux §6).
export interface DeviceStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** Ключи с префиксом `prefix` по возрастанию. */
  keys(prefix: string): Promise<string[]>;
  /**
   * Удалить ключи по условию во всех слоях хранилища (выход из аккаунта). Есть у хранилища с запасным в памяти:
   * после перехода на запасное данные, записанные в IndexedDB раньше, тоже удаляются (возврат 2).
   */
  purge?(match: (key: string) => boolean): Promise<void>;
}

async function purgeIn(s: DeviceStore, match: (key: string) => boolean): Promise<void> {
  for (const k of await s.keys('')) if (match(k)) await s.delete(k);
}

/** Область данных устройства: организация и пользователь. */
export const scopeKey = (tenantId: string, userId: string): string => `${tenantId}:${userId}`;

/** Ключ очереди отправки области (список элементов; читает и оболочка — число ожидающих). */
export const outboxKey = (scope: string): string => `outbox:${scope}`;

const copy = <T>(v: T): T => (v instanceof Blob ? v : structuredClone(v));

export function memoryStore(): DeviceStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => {
      const v = map.get(key);
      return v === undefined ? undefined : (copy(v) as T);
    },
    set: async (key, value) => {
      map.set(key, copy(value));
    },
    delete: async (key) => {
      map.delete(key);
    },
    keys: async (prefix) => [...map.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}

const DB = 'ortus-device';
const STORE = 'kv';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB'));
  });
}

/** Хранилище IndexedDB; база открывается при первом обращении. */
export function idbStore(factory: IDBFactory, name = DB): DeviceStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('IndexedDB'));
    });
    return db;
  };
  const tx = async (mode: IDBTransactionMode) =>
    (await open()).transaction(STORE, mode).objectStore(STORE);
  return {
    get: async <T>(key: string) => (await req((await tx('readonly')).get(key))) as T | undefined,
    set: async (key, value) => {
      await req((await tx('readwrite')).put(value, key));
    },
    delete: async (key) => {
      await req((await tx('readwrite')).delete(key));
    },
    keys: async (prefix) => {
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      const keys = await req((await tx('readonly')).getAllKeys(range));
      return keys.map(String).sort();
    },
  };
}

/** Ответ IndexedDB дольше этого — хранилище считается недоступным (open завис, onblocked), мс. */
const TIMEOUT_MS = 5000;

function within<R>(p: Promise<R>, ms: number): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('device store timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Хранилище с запасным в памяти: отказ IndexedDB (квота, приватный режим) или ответ дольше `timeoutMs` (open завис,
 * база заблокирована другой вкладкой) не ломает экран — дальше данные в памяти до перезагрузки (возврат 1). Выход
 * (`purge`) удаляет и из памяти, и из IndexedDB — насколько она отвечает за `timeoutMs` (возврат 2).
 */
export function resilientStore(primary: DeviceStore, o: { timeoutMs?: number } = {}): DeviceStore {
  const ms = o.timeoutMs ?? TIMEOUT_MS;
  const mem = memoryStore();
  let failed = false;
  const run = async <R>(fn: (s: DeviceStore) => Promise<R>): Promise<R> => {
    if (!failed) {
      try {
        return await within(fn(primary), ms);
      } catch {
        failed = true;
      }
    }
    return fn(mem);
  };
  return {
    get: (key) => run((s) => s.get(key)),
    set: (key, value) => run((s) => s.set(key, value)),
    delete: (key) => run((s) => s.delete(key)),
    keys: (prefix) => run((s) => s.keys(prefix)),
    purge: async (match) => {
      await purgeIn(mem, match);
      try {
        await within(purgeIn(primary, match), ms);
      } catch {
        failed = true;
      }
    },
  };
}

let current: DeviceStore | null = null;

/** Хранилище устройства приложения (IndexedDB, иначе память). */
export function deviceStore(): DeviceStore {
  if (!current) {
    current =
      typeof indexedDB === 'undefined' ? memoryStore() : resilientStore(idbStore(indexedDB));
    if (typeof navigator !== 'undefined') void navigator.storage?.persist?.().catch(() => false);
  }
  return current;
}

/** Подмена хранилища (тесты); `null` — заново при следующем обращении. */
export function setDeviceStore(store: DeviceStore | null): void {
  current = store;
}

type ClearHandler = (userId: string) => void | Promise<void>;

const clearHandlers = new Set<ClearHandler>();

/** Канал выхода между вкладками приложения (возврат 2). */
const CLEAR_CHANNEL = 'ortus-device:clear';

interface ClearMessage {
  type: 'cleared';
  userId: string;
}

const isClear = (v: unknown): v is ClearMessage =>
  typeof v === 'object' &&
  v !== null &&
  (v as ClearMessage).type === 'cleared' &&
  typeof (v as ClearMessage).userId === 'string';

async function stopSubscribers(userId: string): Promise<void> {
  await Promise.all(
    [...clearHandlers].map(async (fn) => {
      await fn(userId);
    }),
  ).catch(() => undefined);
}

let channel: BroadcastChannel | null | undefined;

/**
 * Канал выхода: выход в другой вкладке останавливает очередь и черновик этой вкладки того же пользователя (ключи
 * удаляет вкладка, где нажали «Выйти»). Без BroadcastChannel — только своя вкладка.
 */
function clearChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  if (typeof BroadcastChannel === 'undefined') {
    channel = null;
    return channel;
  }
  const bc = new BroadcastChannel(CLEAR_CHANNEL);
  // Node (тесты): канал не держит процесс; в браузере unref нет.
  (bc as BroadcastChannel & { unref?: () => void }).unref?.();
  bc.addEventListener('message', (e: MessageEvent<unknown>) => {
    if (isClear(e.data)) void stopSubscribers(e.data.userId);
  });
  channel = bc;
  return channel;
}

/**
 * Подписка на очистку данных устройства: очередь водителя и черновик осмотра снимают себя и дожидаются своих
 * записей на устройство, начатых до выхода (возвраты 1 и 2) — после этого они на устройство не пишут. Срабатывает
 * и на выход в другой вкладке.
 */
export function onDeviceClear(fn: ClearHandler): () => void {
  clearChannel();
  clearHandlers.add(fn);
  return () => clearHandlers.delete(fn);
}

/**
 * Выход из аккаунта: сообщить другим вкладкам, остановить подписчиков этой вкладки (запросы очереди, начатые до
 * выхода, данные на устройство уже не вернут) и удалить очередь, черновики и фото пользователя `userId` на этом
 * устройстве — из всех слоёв хранилища (`purge`).
 */
export async function clearDeviceData(userId: string): Promise<void> {
  try {
    clearChannel()?.postMessage({ type: 'cleared', userId } satisfies ClearMessage);
  } catch {
    // Канал закрыт — другие вкладки узнают о выходе по 401.
  }
  await stopSubscribers(userId);
  const s = deviceStore();
  const mine = (k: string) => k.split(':')[2] === userId;
  if (s.purge) await s.purge(mine);
  else await purgeIn(s, mine);
}
