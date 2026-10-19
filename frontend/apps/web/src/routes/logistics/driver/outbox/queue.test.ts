// W2.24 · Очередь отправки водителя (эталон flush :2527–2551, submitRet :2597–2606, saveExp :2616–2629; 03 §10.2;
// S2-15, LOG-11): расход и сдача, сохранённые без связи, уходят по порядку, когда связь есть; статусы «ожидает»
// (local), «отправляется» (sending), «ошибка» (error), «отправлено» — элемент снят и событие `sent`; повтор — тот же
// Idempotency-Key (Q-W2.22-9); принятый сервером осмотр сдачи повторно не отправляется. Операции API подставлены
// функциями (сеть экрана — today.outbox.test.tsx на MSW).
import { ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { memoryStore } from '../../../../pwa/store.ts';
import { type OutboxEvent, type OutboxOps, Outbox } from './queue.ts';

const SCOPE = 't1:u1';
const jpeg = (n: number) => new Blob([new Uint8Array([n])], { type: 'image/jpeg' });

interface Call {
  op: string;
  args: unknown[];
}

/** Операции API: журнал вызовов и программируемые отказы по имени операции. */
function fakeOps() {
  const calls: Call[] = [];
  const fail = new Map<string, unknown[]>();
  let files = 0;
  const step = async (op: string, ...args: unknown[]) => {
    calls.push({ op, args });
    const queue = fail.get(op);
    const e = queue?.shift();
    if (e) throw e;
  };
  const ops: OutboxOps = {
    upload: async (blob, purpose, tripId) => {
      await step('upload', purpose, tripId, blob.size);
      return `file-${String(++files)}`;
    },
    createExpense: async (tripId, body, key) => {
      await step('createExpense', tripId, body, key);
    },
    submitInspection: async (body, key) => {
      await step('submitInspection', body, key);
      return { id: 'insp-1' };
    },
    returnTrip: async (tripId, inspectionId, key) => {
      await step('returnTrip', tripId, inspectionId, key);
    },
  };
  return {
    ops,
    calls,
    named: (op: string) => calls.filter((c) => c.op === op),
    failNext: (op: string, ...errors: unknown[]) =>
      fail.set(op, [...(fail.get(op) ?? []), ...errors]),
  };
}

function setup(o: { online?: boolean } = {}) {
  const store = memoryStore();
  const api = fakeOps();
  const net = { online: o.online ?? false };
  let n = 0;
  const box = new Outbox({
    scope: SCOPE,
    store,
    ops: api.ops,
    online: () => net.online,
    newKey: () => `key-${String(++n)}`,
    now: () => `2026-10-01T10:0${String(n)}:00Z`,
    retryMs: 0,
  });
  const events: OutboxEvent[] = [];
  box.onEvent((e) => events.push(e));
  return { store, api, net, box, events };
}

const EXPENSE = {
  kind: 'wash' as const,
  occurredAt: '2026-10-01T09:00:00Z',
  amount: { amountMinor: 40000, currency: 'RUB' },
  receiptFileIds: [],
};

const INSPECTION = {
  checklistVersionId: 'cl-1',
  vehicleId: 'v-1',
  kind: 'return' as const,
  tripId: 'trip-1',
  odometerKm: '84560',
  fuelPercent: 50,
  checks: [{ key: 'cargo', result: 'pass' as const }],
  photos: [
    { role: 'front' as const, fileId: '', capturedAt: '2026-10-01T12:00:00Z' },
    { role: 'rear' as const, fileId: '', capturedAt: '2026-10-01T12:00:01Z' },
    { role: 'left' as const, fileId: '', capturedAt: '2026-10-01T12:00:02Z' },
  ],
  capturedAt: '2026-10-01T12:01:00Z',
};

const offline = () => new TypeError('Failed to fetch');
const invalid = () =>
  new ProblemError(422, {
    type: 'about:blank',
    title: 'Validation failed',
    status: 422,
    code: 'validation_failed',
    detail: 'Фото чека ещё не загружено',
  } as never);

describe('очередь отправки: расход', () => {
  it('без связи — «ожидает» на устройстве, чек — Blob в хранилище, ничего не отправлено', async () => {
    const { box, store, api } = setup();
    const it1 = await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: EXPENSE,
      receipt: jpeg(1),
    });
    expect(box.items()).toEqual([
      expect.objectContaining({
        id: it1.id,
        kind: 'expense',
        state: 'local',
        label: 'Мойка 400 ₽',
      }),
    ]);
    expect(api.calls).toEqual([]);
    const saved = await store.get<{ id: string }[]>(`outbox:${SCOPE}`);
    expect(saved?.map((x) => x.id)).toEqual([it1.id]);
    expect(await store.keys(`blob:${SCOPE}:`)).toHaveLength(1);
  });

  it('связь есть: чек загружается, расход уходит с чеком и ключом элемента; элемент снят, событие sent', async () => {
    const { box, store, api, net, events } = setup();
    const item = await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: EXPENSE,
      receipt: jpeg(1),
    });
    net.online = true;
    await box.flush();
    expect(api.named('upload').map((c) => c.args.slice(0, 2))).toEqual([
      ['expense_receipt', 'trip-1'],
    ]);
    const [create] = api.named('createExpense');
    expect(create?.args).toEqual(['trip-1', { ...EXPENSE, receiptFileIds: ['file-1'] }, item.key]);
    expect(box.items()).toEqual([]);
    expect(events).toEqual([{ type: 'sent', item: expect.objectContaining({ id: item.id }) }]);
    expect(await store.keys(`blob:${SCOPE}:`)).toEqual([]);
    expect(await store.get(`outbox:${SCOPE}`)).toEqual([]);
  });

  it('чек уже на сервере — без загрузки', async () => {
    const { box, api, net } = setup();
    await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: { ...EXPENSE, receiptFileIds: ['file-9'] },
      receipt: null,
    });
    net.online = true;
    await box.flush();
    expect(api.named('upload')).toEqual([]);
    expect(api.named('createExpense')[0]?.args[1]).toMatchObject({ receiptFileIds: ['file-9'] });
  });

  it('сеть оборвалась посреди отправки — снова «ожидает», без события ошибки; повтор — тот же ключ', async () => {
    const { box, api, net, events } = setup({ online: true });
    const item = await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: EXPENSE,
      receipt: jpeg(1),
    });
    api.failNext('createExpense', offline());
    await box.flush();
    expect(box.items()[0]).toMatchObject({ state: 'local' });
    expect(events).toEqual([]);
    net.online = true;
    await box.flush();
    const keys = api.named('createExpense').map((c) => c.args[2]);
    expect(keys).toEqual([item.key, item.key]);
    // Чек загружен в первой попытке — второй загрузки нет.
    expect(api.named('upload')).toHaveLength(1);
    expect(box.items()).toEqual([]);
  });

  it('ошибка сервера — «ошибка» с текстом сервера, событие failed; «Повторить» — тот же ключ', async () => {
    const { box, api, events } = setup({ online: true });
    const item = await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: EXPENSE,
      receipt: jpeg(1),
    });
    api.failNext('createExpense', invalid());
    await box.flush();
    expect(box.items()[0]).toMatchObject({ state: 'error', error: 'Фото чека ещё не загружено' });
    expect(events).toEqual([
      {
        type: 'failed',
        item: expect.objectContaining({ id: item.id }),
        message: 'Фото чека ещё не загружено',
      },
    ]);
    await box.retry(item.id);
    expect(api.named('createExpense').map((c) => c.args[2])).toEqual([item.key, item.key]);
    expect(box.items()).toEqual([]);
  });

  // Возврат 1 (minor): ошибка сервера (422) не повторяется на каждом проходе — монтирование «Сегодня» и
  // «Автомобилей» не показывает тост «{операция}: {сообщение}» снова; повтор — «Повторить» или появление связи.
  it('ошибка не отправляется повторно обычным проходом; при появлении связи — да, тем же ключом', async () => {
    const { box, api, events } = setup({ online: true });
    const item = await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: EXPENSE,
      receipt: null,
    });
    api.failNext('createExpense', invalid());
    await box.flush();
    await box.flush();
    await box.flush();
    expect(api.named('createExpense')).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['failed']);
    expect(box.items()[0]).toMatchObject({ state: 'error', error: 'Фото чека ещё не загружено' });
    await box.flush({ errors: true });
    expect(api.named('createExpense').map((c) => c.args[2])).toEqual([item.key, item.key]);
    expect(events.map((e) => e.type)).toEqual(['failed', 'sent']);
    expect(box.items()).toEqual([]);
  });

  it('ошибка не задерживает следующие элементы обычного прохода', async () => {
    const { box, api } = setup({ online: true });
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    api.failNext('createExpense', invalid());
    await box.flush();
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 500 ₽', body: EXPENSE, receipt: null });
    await box.flush();
    expect(api.named('createExpense')).toHaveLength(2);
    expect(box.items().map((i) => [i.label, i.state])).toEqual([['Мойка 400 ₽', 'error']]);
  });

  it('статус «отправляется» виден подписчику на время отправки', async () => {
    const { box, net } = setup();
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    const seen: string[] = [];
    box.subscribe(() =>
      seen.push(
        box
          .items()
          .map((i) => i.state)
          .join(','),
      ),
    );
    net.online = true;
    await box.flush();
    expect(seen).toContain('sending');
    expect(seen.at(-1)).toBe('');
  });

  it('без связи flush ничего не отправляет', async () => {
    const { box, api } = setup();
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    await box.flush();
    expect(api.calls).toEqual([]);
    expect(box.items()[0]).toMatchObject({ state: 'local' });
  });
});

describe('очередь отправки: сдача', () => {
  const photos = () => [
    { fileId: 'file-a', capturedAt: '2026-10-01T12:00:00Z' },
    { blob: jpeg(2), capturedAt: '2026-10-01T12:00:01Z' },
    { blob: jpeg(3), capturedAt: '2026-10-01T12:00:02Z' },
  ];

  it('фото на устройстве загружаются, затем осмотр со всеми файлами и сдача — со своими ключами', async () => {
    const { box, api, net, events } = setup();
    const item = await box.saveReturn({
      tripId: 'trip-1',
      inspection: INSPECTION,
      photos: photos(),
    });
    expect(item).toMatchObject({ kind: 'return', label: 'Сдача машины', state: 'local' });
    net.online = true;
    await box.flush();
    expect(api.calls.map((c) => c.op)).toEqual([
      'upload',
      'upload',
      'submitInspection',
      'returnTrip',
    ]);
    const [submit] = api.named('submitInspection');
    expect((submit?.args[0] as typeof INSPECTION).photos.map((p) => p.fileId)).toEqual([
      'file-a',
      'file-1',
      'file-2',
    ]);
    expect(submit?.args[1]).toBe(item.keys.inspection);
    expect(api.named('returnTrip')[0]?.args).toEqual(['trip-1', 'insp-1', item.keys.trip]);
    expect(item.keys.inspection).not.toBe(item.keys.trip);
    expect(events.map((e) => e.type)).toEqual(['sent']);
    expect(box.items()).toEqual([]);
  });

  it('сдача не прошла после принятого осмотра — повтор шлёт только сдачу тем же ключом', async () => {
    const { box, api } = setup({ online: true });
    const item = await box.saveReturn({
      tripId: 'trip-1',
      inspection: INSPECTION,
      photos: photos(),
    });
    api.failNext('returnTrip', offline());
    await box.flush();
    expect(box.items()[0]).toMatchObject({ state: 'local', inspectionId: 'insp-1' });
    await box.flush();
    expect(api.named('submitInspection')).toHaveLength(1);
    expect(api.named('returnTrip').map((c) => c.args[2])).toEqual([item.keys.trip, item.keys.trip]);
    expect(box.items()).toEqual([]);
  });

  it('новая сдача того же рейса заменяет прежнюю (одна сдача на рейс), фото прежней удалены', async () => {
    const { box, store } = setup();
    await box.saveReturn({ tripId: 'trip-1', inspection: INSPECTION, photos: photos() });
    expect(await store.keys(`blob:${SCOPE}:`)).toHaveLength(2);
    const second = await box.saveReturn({
      tripId: 'trip-1',
      inspection: INSPECTION,
      photos: [{ blob: jpeg(4), capturedAt: '2026-10-01T12:05:00Z' }],
    });
    expect(box.items().map((i) => i.id)).toEqual([second.id]);
    expect(await store.keys(`blob:${SCOPE}:`)).toHaveLength(1);
  });

  it('по порядку: расход раньше сдачи; обрыв связи останавливает очередь', async () => {
    const { box, api } = setup({ online: true });
    await box.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    await box.saveReturn({ tripId: 'trip-1', inspection: INSPECTION, photos: [] });
    api.failNext('createExpense', offline());
    await box.flush();
    expect(api.calls.map((c) => c.op)).toEqual(['createExpense']);
    await box.flush();
    expect(api.calls.map((c) => c.op)).toEqual([
      'createExpense',
      'createExpense',
      'submitInspection',
      'returnTrip',
    ]);
  });
});

// Возврат 1 (minor): окно установленного приложения и вкладка браузера — две очереди в памяти над одним ключом
// устройства. Запись — по сохранённому списку (не снимком своей памяти), отправка — одной вкладкой за раз, другая
// вкладка узнаёт об изменении через канал.
describe('очередь отправки: две вкладки', () => {
  /** Канал между вкладками в памяти (как BroadcastChannel: отправитель своё сообщение не получает). */
  function bus() {
    const subs = new Set<{ owner: object; fn: () => void }>();
    return (owner: object) => ({
      post: () => {
        for (const s of subs) if (s.owner !== owner) s.fn();
      },
      listen: (fn: () => void) => {
        const s = { owner, fn };
        subs.add(s);
        return () => void subs.delete(s);
      },
      close: () => undefined,
    });
  }

  function tabs() {
    const store = memoryStore();
    const api = fakeOps();
    const channel = bus();
    let n = 0;
    const tab = (name: string) => {
      const owner = {};
      return new Outbox({
        scope: SCOPE,
        store,
        ops: api.ops,
        online: () => true,
        newKey: () => `${name}-${String(++n)}`,
        retryMs: 0,
        channel: channel(owner),
      });
    };
    return { store, api, tab };
  }

  it('расход, сохранённый в одной вкладке, не теряется записью другой', async () => {
    const { store, api, tab } = tabs();
    const a = tab('a');
    const b = tab('b');
    await a.hydrate();
    await b.hydrate();
    await a.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    await b.addExpense({ tripId: 'trip-1', label: 'Мойка 500 ₽', body: EXPENSE, receipt: null });
    const restarted = new Outbox({ scope: SCOPE, store, ops: api.ops, online: () => false });
    await restarted.hydrate();
    expect(restarted.items().map((i) => i.label)).toEqual(['Мойка 400 ₽', 'Мойка 500 ₽']);
  });

  it('другая вкладка видит изменение очереди', async () => {
    const { tab } = tabs();
    const a = tab('a');
    const b = tab('b');
    await a.hydrate();
    await b.hydrate();
    await a.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    await expect.poll(() => b.items().map((i) => i.label)).toEqual(['Мойка 400 ₽']);
  });

  it('обе вкладки получили связь — элемент отправлен один раз', async () => {
    const { api, tab } = tabs();
    const a = tab('a');
    const b = tab('b');
    await a.hydrate();
    await b.hydrate();
    await a.addExpense({ tripId: 'trip-1', label: 'Мойка 400 ₽', body: EXPENSE, receipt: null });
    await expect.poll(() => b.items().length).toBe(1);
    await Promise.all([a.flush(), b.flush()]);
    expect(api.named('createExpense')).toHaveLength(1);
    expect(a.items()).toEqual([]);
    await expect.poll(() => b.items()).toEqual([]);
  });
});

describe('очередь отправки: устройство', () => {
  it('после перезапуска очередь восстанавливается из хранилища; «отправляется» → «ожидает»', async () => {
    const { store, api } = setup();
    await store.set(`outbox:${SCOPE}`, [
      {
        kind: 'expense',
        id: 'op-1',
        tripId: 'trip-1',
        label: 'Мойка 400 ₽',
        createdAt: '2026-10-01T10:00:00Z',
        state: 'sending',
        key: 'key-x',
        body: EXPENSE,
        receipt: null,
      },
    ]);
    const box = new Outbox({ scope: SCOPE, store, ops: api.ops, online: () => false });
    expect(box.ready()).toBe(false);
    await box.hydrate();
    expect(box.ready()).toBe(true);
    expect(box.items()).toEqual([expect.objectContaining({ id: 'op-1', state: 'local' })]);
  });

  // Возврат 1 (minor): хранилище отказало при восстановлении — экран не остаётся на скелетоне.
  it('хранилище отказало при восстановлении — очередь готова и пуста', async () => {
    const { api } = setup();
    const broken = {
      ...memoryStore(),
      get: () => Promise.reject(new Error('IndexedDB')),
    };
    const box = new Outbox({ scope: SCOPE, store: broken, ops: api.ops, online: () => false });
    await box.hydrate();
    expect(box.ready()).toBe(true);
    expect(box.items()).toEqual([]);
  });

  it('фото элемента пропало с устройства — «ошибка» «Не все фото загрузились — повторите»', async () => {
    const { box, store, net } = setup();
    await box.addExpense({
      tripId: 'trip-1',
      label: 'Мойка 400 ₽',
      body: EXPENSE,
      receipt: jpeg(1),
    });
    for (const k of await store.keys(`blob:${SCOPE}:`)) await store.delete(k);
    net.online = true;
    await box.flush();
    expect(box.items()[0]).toMatchObject({
      state: 'error',
      error: 'Не все фото загрузились — повторите',
    });
  });
});
