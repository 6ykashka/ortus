// W2.24 · Очередь отправки водителя (S2-15, LOG-11; эталон `state.outbox` и flush :2527–2551, submitRet :2597–2606,
// saveExp :2616–2629; 03 §10.2). Без связи расход и сдача сохраняются на устройстве; когда связь есть, очередь шлёт
// их по порядку тем же Idempotency-Key на каждом повторе (Q-W2.22-9) — сервер узнаёт повтор и не создаёт второй
// расход или вторую сдачу. Бронь и выезд в очередь не попадают (D-09, ADR-0010: только онлайн).
//   статусы: local — ожидает отправки; sending — отправляется; error — ошибка сервера (текст ответа), повтор —
//   «Повторить» или появление связи (`flush({ errors: true })`; обычный проход — монтирование экрана, таймер —
//   ошибку не повторяет: тост «{операция}: {сообщение}» не показывается на каждом экране, возврат 1); отправлено —
//   элемент снят, событие `sent` (тост «{операция} — принято сервером»); сбой сети посреди отправки — снова local,
//   без тоста ошибки (эталон: offline → local).
//   расход: чек на устройстве → загрузка (сессия загрузки) → createTripExpense;
//   сдача (одна на рейс, новая заменяет прежнюю): фото на устройстве → загрузка → submitInspection (return) →
//   returnTrip; принятый осмотр запоминается и повторно не отправляется.
// Элементы и фото хранятся в хранилище устройства (`outbox:<область>`, `blob:<область>:outbox:<id>:<n>`) и
// переживают перезапуск; «отправляется» после перезапуска — снова «ожидает».
// Несколько вкладок (окно приложения и вкладка браузера, возврат 1): каждое изменение — чтение сохранённого списка,
// правка и запись под замком списка (Web Locks, иначе замок в памяти вкладки) — запись одной вкладки не теряет
// элемент другой; отправка — под замком отправки, одной вкладкой за раз; канал (BroadcastChannel) говорит другим
// вкладкам перечитать список.
// Выход из аккаунта (возврат 1, 15-quality-security): `close()` — очередь больше не пишет на устройство и не шлёт
// операции (ответ запроса, начатого до выхода, отбрасывается) и дожидается своей записи, начатой до выхода.
import { type components, ProblemError } from '@ortus/api-client';
import { errors, logisticsDriver as L } from '@ortus/texts';

import { type DeviceStore, outboxKey } from '../../../../pwa/store.ts';
import { problemCode, problemText } from '../../../../shell/run.tsx';
import { UploadRejectedError, UploadTimeoutError } from '../photos.ts';

type S = components['schemas'];

export type ItemState = 'local' | 'sending' | 'error';

/** Фото элемента: файл на сервере (`fileId`) или Blob на устройстве (`blob` — ключ хранилища). */
export interface PhotoRef {
  fileId?: string;
  blob?: string;
  capturedAt: string;
}

interface Base {
  id: string;
  tripId: string;
  /** Подпись операции в тостах: «Мойка 400 ₽», «Сдача машины». */
  label: string;
  createdAt: string;
  state: ItemState;
  /** Текст ошибки сервера (`state: error`). */
  error?: string;
}

export interface ExpenseItem extends Base {
  kind: 'expense';
  /** Idempotency-Key createTripExpense — один на все повторы. */
  key: string;
  body: S['TripExpenseCreate'];
  receipt: PhotoRef | null;
}

export interface ReturnItem extends Base {
  kind: 'return';
  keys: { inspection: string; trip: string };
  /** Осмотр при сдаче; `photos[i].fileId` берётся из `photos[i]` элемента при отправке. */
  inspection: S['InspectionCreate'];
  photos: PhotoRef[];
  /** Осмотр, уже принятый сервером. */
  inspectionId?: string;
}

export type OutboxItem = ExpenseItem | ReturnItem;

/** Операции API очереди (экран подставляет команды api.ts и uploadPhoto). */
export interface OutboxOps {
  upload(blob: Blob, purpose: 'inspection' | 'expense_receipt', tripId: string): Promise<string>;
  createExpense(tripId: string, body: S['TripExpenseCreate'], key: string): Promise<unknown>;
  submitInspection(body: S['InspectionCreate'], key: string): Promise<{ id: string }>;
  returnTrip(tripId: string, inspectionId: string, key: string): Promise<unknown>;
}

export type OutboxEvent =
  { type: 'sent'; item: OutboxItem } | { type: 'failed'; item: OutboxItem; message: string };

/** Сбой отправки: сеть (элемент снова ожидает) или ответ сервера с текстом. */
export interface Failure {
  offline: boolean;
  message: string;
}

/** Замок по имени (Web Locks `navigator.locks.request` или замок в памяти). */
export type OutboxLock = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

/** Канал между вкладками: «список изменился — перечитай». */
export interface OutboxChannel {
  post(): void;
  listen(fn: () => void): () => void;
  close(): void;
}

export interface OutboxOptions {
  /** Область устройства: `<организация>:<пользователь>`. */
  scope: string;
  store: DeviceStore;
  ops: OutboxOps;
  online?: () => boolean;
  classify?: (e: unknown) => Failure;
  newKey?: () => string;
  now?: () => string;
  /** Повтор после сбоя сети при navigator.onLine = true (плохая связь); ≤ 0 — без повтора по таймеру. */
  retryMs?: number;
  lock?: OutboxLock;
  channel?: OutboxChannel | null;
}

/** Фото элемента нет на устройстве (хранилище очищено браузером). */
export class MissingPhotoError extends Error {
  constructor() {
    super('photo missing');
    this.name = 'MissingPhotoError';
  }
}

/** Очередь закрыта (выход из аккаунта): операции и записи не выполняются. */
class ClosedError extends Error {
  constructor() {
    super('outbox closed');
    this.name = 'ClosedError';
  }
}

/** Элемента больше нет в сохранённом списке (снят другой вкладкой). */
class GoneError extends Error {
  constructor() {
    super('outbox item gone');
    this.name = 'GoneError';
  }
}

/** Сбой отправки по ошибке: сеть → ожидает; сервер — Problem.detail или текст по коду. */
export function classify(e: unknown): Failure {
  if (e instanceof MissingPhotoError) return { offline: false, message: L.outbox.photosFailed };
  if (e instanceof UploadRejectedError || e instanceof UploadTimeoutError) {
    return { offline: false, message: errors.mock.files.uploadFailed };
  }
  if (problemCode(e) === 'offline') return { offline: true, message: problemText(e) };
  const detail = e instanceof ProblemError ? e.problem?.detail : undefined;
  return { offline: false, message: detail || problemText(e) };
}

const chains = new Map<string, Promise<void>>();

/** Замок в памяти вкладки (без Web Locks): вызовы с одним именем — по очереди. */
export const localLock: OutboxLock = <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  const run = (chains.get(name) ?? Promise.resolve()).then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(name, tail);
  void tail.then(() => {
    if (chains.get(name) === tail) chains.delete(name);
  });
  return run;
};

const RETRY_MS = 30_000;

/** «Отправляется» прерванного запуска или другой вкладки, которая уже не отправляет, — снова «ожидает». */
const unstick = (list: OutboxItem[]): OutboxItem[] =>
  list.some((i) => i.state === 'sending')
    ? list.map((i) => (i.state === 'sending' ? { ...i, state: 'local' as const } : i))
    : list;

export class Outbox {
  private list: OutboxItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly handlers = new Set<(e: OutboxEvent) => void>();
  private hydrating: Promise<void> | null = null;
  private hydrated = false;
  private flushing: Promise<void> | null = null;
  private again = false;
  private againErrors = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unlisten: () => void;
  private readonly o: Required<Omit<OutboxOptions, 'ops' | 'channel'>> & {
    ops: OutboxOps;
    channel: OutboxChannel | null;
  };

  constructor(o: OutboxOptions) {
    this.o = {
      online: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
      classify,
      newKey: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      retryMs: RETRY_MS,
      ...o,
      lock: o.lock ?? localLock,
      channel: o.channel ?? null,
    };
    this.unlisten = this.o.channel?.listen(() => void this.refresh()) ?? (() => undefined);
  }

  /** Операции API (новый клиент после перезапуска оболочки). */
  setOps(ops: OutboxOps): void {
    this.o.ops = ops;
  }

  items(): readonly OutboxItem[] {
    return this.list;
  }

  ready(): boolean {
    return this.hydrated;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onEvent(fn: (e: OutboxEvent) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private get listKey(): string {
    return outboxKey(this.o.scope);
  }

  private get sendKey(): string {
    return `outbox-send:${this.o.scope}`;
  }

  private blobKey(id: string, n: number): string {
    return `blob:${this.o.scope}:outbox:${id}:${String(n)}`;
  }

  /** Сохранённый список (отказ хранилища — список в памяти). */
  private async read(): Promise<OutboxItem[]> {
    try {
      return (await this.o.store.get<OutboxItem[]>(this.listKey)) ?? [];
    } catch {
      return this.list;
    }
  }

  /** Очередь с устройства (один раз): «отправляется» прерванного запуска — снова «ожидает»; отказ — пусто. */
  hydrate(): Promise<void> {
    this.hydrating ??= (async () => {
      const saved = await this.read();
      if (this.closed) return;
      this.list = unstick(saved);
      this.hydrated = true;
      this.emit();
    })();
    return this.hydrating;
  }

  /** Другая вкладка изменила список — перечитать. */
  private async refresh(): Promise<void> {
    if (!this.hydrated || this.closed) return;
    const saved = await this.read();
    if (this.closed) return;
    this.list = saved;
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Правка списка: чтение сохранённого, правка, запись — под замком списка; другим вкладкам — сигнал. */
  private async mutate(fn: (list: OutboxItem[]) => OutboxItem[]): Promise<void> {
    if (this.closed) throw new ClosedError();
    let changed = false;
    await this.o.lock(this.listKey, async () => {
      if (this.closed) throw new ClosedError();
      const saved = await this.read();
      const next = fn(saved);
      if (next === saved) {
        this.list = saved;
        return;
      }
      this.list = next;
      this.emit();
      await this.o.store.set(this.listKey, next).catch(() => undefined);
      changed = true;
    });
    if (changed && !this.closed) this.o.channel?.post();
  }

  private find(id: string): OutboxItem | undefined {
    return this.list.find((i) => i.id === id);
  }

  private must<T extends OutboxItem>(id: string): T {
    const it = this.find(id);
    if (!it) throw new GoneError();
    return it as T;
  }

  private patch(id: string, patch: Partial<ExpenseItem> | Partial<ReturnItem>): Promise<void> {
    return this.mutate((list) =>
      list.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, ...patch } as OutboxItem;
        if (patch.state && patch.state !== 'error') delete next.error;
        return next;
      }),
    );
  }

  private async dropBlobs(item: OutboxItem): Promise<void> {
    const refs = item.kind === 'expense' ? (item.receipt ? [item.receipt] : []) : item.photos;
    for (const r of refs) if (r.blob) await this.o.store.delete(r.blob).catch(() => undefined);
  }

  /** Операция API, пока очередь не закрыта; ответ, пришедший после закрытия, отбрасывается. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) throw new ClosedError();
    const r = await fn();
    if (this.closed) throw new ClosedError();
    return r;
  }

  /** Расход на устройстве: чек — Blob (ещё не загружен) или уже в `body.receiptFileIds`. */
  async addExpense(o: {
    tripId: string;
    label: string;
    body: S['TripExpenseCreate'];
    receipt: Blob | null;
    key?: string;
  }): Promise<ExpenseItem> {
    await this.hydrate();
    if (this.closed) throw new ClosedError();
    const id = this.o.newKey();
    let receipt: PhotoRef | null = null;
    if (o.receipt) {
      const blob = this.blobKey(id, 0);
      await this.o.store.set(blob, o.receipt);
      receipt = { blob, capturedAt: this.o.now() };
    }
    const item: ExpenseItem = {
      kind: 'expense',
      id,
      tripId: o.tripId,
      label: o.label,
      createdAt: this.o.now(),
      state: 'local',
      key: o.key ?? this.o.newKey(),
      body: o.body,
      receipt,
    };
    await this.mutate((list) => [...list, item]);
    return item;
  }

  /** Сдача на устройстве; прежняя сдача того же рейса снимается (эталон :2601). */
  async saveReturn(o: {
    tripId: string;
    inspection: S['InspectionCreate'];
    photos: { fileId?: string; blob?: Blob; capturedAt: string }[];
  }): Promise<ReturnItem> {
    await this.hydrate();
    if (this.closed) throw new ClosedError();
    const id = this.o.newKey();
    const photos: PhotoRef[] = [];
    for (const [n, p] of o.photos.entries()) {
      if (p.fileId) photos.push({ fileId: p.fileId, capturedAt: p.capturedAt });
      else if (p.blob) {
        const blob = this.blobKey(id, n);
        await this.o.store.set(blob, p.blob);
        photos.push({ blob, capturedAt: p.capturedAt });
      } else photos.push({ capturedAt: p.capturedAt });
    }
    const item: ReturnItem = {
      kind: 'return',
      id,
      tripId: o.tripId,
      label: L.outbox.returnLabel,
      createdAt: this.o.now(),
      state: 'local',
      keys: { inspection: this.o.newKey(), trip: this.o.newKey() },
      inspection: o.inspection,
      photos,
    };
    let prior: OutboxItem[] = [];
    await this.mutate((list) => {
      prior = list.filter((i) => i.kind === 'return' && i.tripId === o.tripId);
      return [...list.filter((i) => !prior.includes(i)), item];
    });
    for (const p of prior) await this.dropBlobs(p);
    return item;
  }

  private async fileOf(ref: PhotoRef, purpose: 'inspection' | 'expense_receipt', tripId: string) {
    if (ref.fileId) return ref.fileId;
    const blob = ref.blob ? await this.o.store.get<Blob>(ref.blob) : undefined;
    if (!blob) throw new MissingPhotoError();
    return this.call(() => this.o.ops.upload(blob, purpose, tripId));
  }

  private async sendExpense(id: string): Promise<void> {
    let it = this.must<ExpenseItem>(id);
    if (it.receipt && !it.receipt.fileId) {
      const fileId = await this.fileOf(it.receipt, 'expense_receipt', it.tripId);
      await this.patch(id, { receipt: { ...it.receipt, fileId } });
      it = this.must<ExpenseItem>(id);
    }
    const fileId = it.receipt?.fileId;
    const body = fileId ? { ...it.body, receiptFileIds: [fileId] } : it.body;
    const key = it.key;
    const tripId = it.tripId;
    await this.call(() => this.o.ops.createExpense(tripId, body, key));
  }

  private async sendReturn(id: string): Promise<void> {
    let it = this.must<ReturnItem>(id);
    for (const [n, ref] of it.photos.entries()) {
      if (ref.fileId) continue;
      const fileId = await this.fileOf(ref, 'inspection', it.tripId);
      it = this.must<ReturnItem>(id);
      await this.patch(id, { photos: it.photos.map((p, i) => (i === n ? { ...p, fileId } : p)) });
      it = this.must<ReturnItem>(id);
    }
    if (!it.inspectionId) {
      const refs = it.photos;
      const body: S['InspectionCreate'] = {
        ...it.inspection,
        photos: it.inspection.photos.map((p, i) => ({
          ...p,
          fileId: refs[i]?.fileId ?? p.fileId,
          capturedAt: refs[i]?.capturedAt ?? p.capturedAt,
        })),
      };
      const key = it.keys.inspection;
      const r = await this.call(() => this.o.ops.submitInspection(body, key));
      await this.patch(id, { inspectionId: r.id });
      it = this.must<ReturnItem>(id);
    }
    const { tripId, inspectionId = '' } = it;
    const key = it.keys.trip;
    await this.call(() => this.o.ops.returnTrip(tripId, inspectionId, key));
  }

  private schedule(): void {
    if (this.o.retryMs <= 0 || this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.o.retryMs);
  }

  /** Один проход по очереди; `true` — остановиться (нет связи, очередь закрыта). */
  private async pass(withErrors: boolean): Promise<boolean> {
    for (const { id } of [...this.list]) {
      if (this.closed) return true;
      const item = this.find(id);
      if (!item) continue;
      if (item.state === 'error' && !withErrors) continue;
      if (!this.o.online()) return true;
      try {
        await this.patch(id, { state: 'sending' });
        if (item.kind === 'expense') await this.sendExpense(id);
        else await this.sendReturn(id);
      } catch (e) {
        if (this.closed || e instanceof ClosedError) return true;
        if (e instanceof GoneError) continue;
        const f = this.o.classify(e);
        await this.patch(
          id,
          f.offline ? { state: 'local' } : { state: 'error', error: f.message },
        ).catch(() => undefined);
        if (this.closed) return true;
        if (f.offline) {
          if (this.o.online()) this.schedule();
          return true;
        }
        const failed = this.find(id);
        if (failed)
          for (const h of this.handlers) h({ type: 'failed', item: failed, message: f.message });
        continue;
      }
      const sent = this.find(id) ?? item;
      await this.dropBlobs(sent);
      try {
        await this.mutate((list) => list.filter((i) => i.id !== id));
      } catch {
        return true;
      }
      for (const h of this.handlers) h({ type: 'sent', item: sent });
    }
    return false;
  }

  /**
   * Отправить очередь по порядку (одна отправка за раз и одной вкладкой; вызов во время отправки — ещё один проход).
   * Элементы с ошибкой сервера — только с `errors: true` (появление связи) или после «Повторить».
   */
  flush(o: { errors?: boolean } = {}): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.flushing) {
      this.again = true;
      this.againErrors ||= o.errors === true;
      return this.flushing;
    }
    let withErrors = o.errors === true;
    this.flushing = (async () => {
      await this.hydrate();
      await this.o.lock(this.sendKey, async () => {
        if (this.closed) return;
        // Под замком отправки «отправляется» в списке — от вкладки, которая уже не отправляет.
        await this.mutate(unstick).catch(() => undefined);
        do {
          this.again = false;
          if (await this.pass(withErrors)) return;
          withErrors = this.againErrors;
          this.againErrors = false;
        } while (this.again && !this.closed);
      });
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** «Повторить»: элемент снова ожидает, очередь отправляется. */
  async retry(id: string): Promise<void> {
    await this.hydrate();
    if (!this.find(id) || this.closed) return;
    await this.patch(id, { state: 'local' }).catch(() => undefined);
    await this.flush();
  }

  /** Снять очередь из памяти: подписчики, таймер, канал; на устройство она больше не пишет. */
  dispose(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.handlers.clear();
    this.unlisten();
    this.o.channel?.close();
  }

  /** Выход из аккаунта: снять очередь и дождаться её записи на устройство, начатой до этого. */
  async close(): Promise<void> {
    this.dispose();
    await this.o.lock(this.listKey, async () => undefined).catch(() => undefined);
  }
}
