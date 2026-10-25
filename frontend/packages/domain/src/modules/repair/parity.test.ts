// Паритет «Ремонта и стройки» с эталоном (`design/ortus/api.js`, `extra-data.js`, `models.js`):
// одинаковые входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
//
// Намеренные расхождения (бриф W6.10 §10, `docs/plan/decisions.md` Q-W6.10-1…3) проверяются здесь
// же явно:
// - у «Лотоса» срез ремонта пустой (в эталоне — копия «Альты»);
// - объекты связаны с прорабом ещё и по id (`foremanId`);
// - `acceptWorkLog` при ограниченной подписке закрыт (эталон принимал);
// - `assignForeman` не назначает прораба объекту-черновику (эталон назначал);
// - `returnWorkLog` — новая операция (RS-09), в эталоне её нет.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { demoClock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createIdGen } from '../../core/ids.ts';
import { createModuleCtx } from '../../core/module.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { importReference } from '../../seed/reference.ts';
import { repairCommands, type RepairApi } from './commands.ts';
import { repairSeed } from './seed.ts';
import type { RepairDb, RepairSlice } from './types.ts';
import { repairView } from './view.ts';

interface RefView {
  seq: number;
  repair: RepairSlice;
  events: { id: string; text: string; to: string[] }[];
}
type RefApi = Record<string, (...a: unknown[]) => Promise<{ data: unknown }>> & {
  setActor(memberId: string | null, tenantId?: string): void;
  load(ms?: number): Promise<RefView>;
};

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Без времени (`at` — `new Date()` эталона против часов домена) и без `foremanId`. */
const norm = (x: unknown): unknown =>
  JSON.parse(
    JSON.stringify(x, (k, v: unknown) => (k === 'at' || k === 'foremanId' ? undefined : v)),
  );

type Outcome = { data: unknown } | { code: string; message: string };

describe('команды = createMockAdapter эталона на одном сценарии', () => {
  let A: RefApi;
  let db: RepairDb;
  let actor = 'm-owner';
  let api: RepairApi;
  const seen = new Set<string>();

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const ref = await importReference<{ createMockAdapter(): RefApi }>('api.js');
    A = ref.createMockAdapter();
    A.setActor('m-owner', 't-alta');
    await run(A.setModule?.('repair', true) as Promise<unknown>);
    db = Object.assign(createAlta(createPlatform()) as TenantDb, {
      repair: repairSeed('t-alta'),
    }) as RepairDb;
    db.modules.repair = { enabled: true };
    const v = await run(A.load(0));
    db.seq = v.seq;
    for (const e of v.events) seen.add(e.id);
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => actor,
      clock: demoClock,
      ids: createIdGen(() => db),
      tasks: {} as never,
    });
    api = repairCommands(ctx);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  async function run<T>(p: Promise<T>): Promise<T> {
    const settled = p.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const r = await settled;
    if (!r.ok) throw r.e;
    return r.v;
  }

  async function both(
    who: string,
    method: keyof RepairApi,
    ...args: unknown[]
  ): Promise<[Outcome, Outcome]> {
    actor = who;
    A.setActor(who, 't-alta');
    let mine: Outcome;
    try {
      mine = {
        data: (api[method] as (...a: unknown[]) => unknown)(...structuredClone(args)) ?? null,
      };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      mine = { code: e.code, message: e.message };
    }
    let theirs: Outcome;
    try {
      const fn = A[method];
      if (!fn) throw new Error('нет метода ' + method);
      theirs = { data: (await run(fn(...structuredClone(args)))).data ?? null };
    } catch (e) {
      const x = e as { code?: string; message: string };
      if (!x.code) throw e;
      theirs = { code: x.code, message: x.message };
    }
    return [mine, theirs];
  }

  /** Результат совпал; у команд без значения эталон отдаёт `null`, у нас — id или `null`. */
  const same = async (who: string, method: keyof RepairApi, ...args: unknown[]) => {
    const [mine, theirs] = await both(who, method, ...args);
    if ('data' in mine && 'data' in theirs && theirs.data === null) {
      expect('data' in mine).toBe(true);
    } else {
      expect(mine).toEqual(theirs);
    }
    return mine;
  };

  /** Срез ремонта и события после шага совпадают у обоих. */
  async function compare(): Promise<void> {
    for (const who of ['m-owner', 'm-sokolov']) {
      A.setActor(who, 't-alta');
      const v = await run(A.load(0));
      expect(norm(repairView(db, who))).toEqual(norm(v.repair));
      const fresh = v.events.filter((e) => !seen.has(e.id));
      const mineEv = (db.events ?? []).filter((e) => e.to.includes(who) && !seen.has(e.id));
      expect(mineEv.map((e) => [e.text, e.to])).toEqual(fresh.map((e) => [e.text, e.to]));
    }
    A.setActor('m-owner', 't-alta');
    const v = await run(A.load(0));
    expect(db.seq).toBe(v.seq);
  }

  const wl = (o: Record<string, unknown> = {}) => ({
    obj: 'obj-42',
    work: 'w1',
    volume: 10,
    crew: ['k1', 'k2'],
    material: 'mt2',
    materialQty: 5,
    photos: 2,
    ...o,
  });

  it('сид: срез «Альты» = срез адаптера эталона после загрузки', async () => {
    await compare();
  });

  it('отметка прораба: успех и каждая ошибка', async () => {
    await same('m-sokolov', 'addWorkLog', wl());
    for (const bad of [
      wl({ volume: 0 }),
      wl({ volume: 'x' }),
      wl({ volume: 60 }),
      wl({ crew: [] }),
      wl({ photos: 0 }),
      wl({ work: 'w4' }),
      wl({ work: 'w99' }),
      wl({ obj: 'obj-45', work: 'w10' }),
      wl({ obj: 'obj-27', work: 'w12', volume: 1 }),
    ]) {
      await same('m-sokolov', 'addWorkLog', bad);
    }
    await same('m-owner', 'addWorkLog', wl());
    await compare();
  });

  it('приёмка: успех, повтор, нет прав', async () => {
    await same('m-sokolov', 'acceptWorkLog', 'WL-09');
    await same('m-owner', 'acceptWorkLog', 'WL-09');
    await same('m-owner', 'acceptWorkLog', 'WL-09');
    await compare();
  });

  it('назначение прораба: успех, повтор, нет сотрудника, нет объекта', async () => {
    await same('m-owner', 'assignForeman', 'obj-45', 'm-sokolov');
    await same('m-owner', 'assignForeman', 'obj-45', 'm-sokolov');
    await same('m-owner', 'assignForeman', 'obj-99', 'm-sokolov');
    await same('m-owner', 'assignForeman', 'obj-31', 'm-nobody');
    await same('m-sokolov', 'assignForeman', 'obj-31', 'm-sokolov');
    await compare();
  });

  it('допработа: предложение, ошибки, цепочка статусов до подписи и отклонение', async () => {
    const t = {
      obj: 'obj-42',
      title: ' Перенос выключателя ',
      volume: '2,5',
      unit: 'м',
      note: ' x ',
      photos: 1,
    };
    await same('m-sokolov', 'proposeChange', t);
    for (const bad of [
      { ...t, title: 'ab' },
      { ...t, volume: 0 },
      { ...t, photos: 0 },
      { ...t, obj: 'obj-99' },
      { ...t, obj: 'obj-27' },
      { ...t, obj: 'obj-50' },
    ]) {
      await same('m-sokolov', 'proposeChange', bad);
    }
    await same('m-owner', 'proposeChange', t);
    await same('m-owner', 'setChange', ['ДР-1'], 'priced');
    await same('m-owner', 'setChange', ['ДР-1'], 'sent', { agreement: 1 });
    await same('m-owner', 'setChange', ['ДР-1'], 'signed', { agreement: 1 });
    await same('m-owner', 'setChange', ['ДР-1'], 'rejected', { reason: 'x' });
    await same('m-owner', 'setChange', ['ДР-2'], 'rejected', { reason: 'Заказчик отказался' });
    await same('m-owner', 'setChange', ['ДР-2'], 'rejected');
    await same('m-owner', 'setChange', ['ДР-9'], 'priced');
    await same('m-owner', 'setChange', ['ДР-2'], 'wow');
    await same('m-sokolov', 'setChange', ['ДР-2'], 'priced');
    await compare();
  });
});

describe('намеренные расхождения с эталоном', () => {
  let A: RefApi;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const ref = await importReference<{ createMockAdapter(): RefApi }>('api.js');
    A = ref.createMockAdapter();
    A.setActor('m-owner', 't-alta');
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  const go = async <T>(p: Promise<T>): Promise<T> => {
    const settled = p.then(
      (v) => ({ ok: true as const, v }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const r = await settled;
    if (!r.ok) throw r.e;
    return r.v;
  };

  it('«Лотос»: в эталоне тот же срез ремонта, у нас пустой', async () => {
    const md = await importReference<{
      seed(): { repair: RepairSlice; platform: unknown };
      seedLotos(p: unknown): { repair: RepairSlice };
    }>('mock-data.js');
    const alta = md.seed();
    expect(md.seedLotos(alta.platform).repair.objects).toHaveLength(6);
    expect(repairSeed('t-lotos').objects).toEqual([]);
  });

  it('эталон назначает прораба объекту-черновику, мы — нет (Q-W4.00-repair-16)', async () => {
    await go(A.setModule?.('repair', true) as Promise<unknown>);
    await expect(
      go(A.assignForeman?.('obj-50', 'm-sokolov') as Promise<unknown>),
    ).resolves.toBeDefined();
    const db = Object.assign(createAlta(createPlatform()) as TenantDb, {
      repair: repairSeed('t-alta'),
    }) as RepairDb;
    db.modules.repair = { enabled: true };
    const api = repairCommands(
      createModuleCtx({
        getDb: () => db,
        getActor: () => 'm-owner',
        clock: demoClock,
        ids: createIdGen(() => db),
        tasks: {} as never,
      }),
    );
    expect(() => api.assignForeman('obj-50', 'm-sokolov')).toThrow(/не активирован/);
  });

  it('у эталона нет операции возврата отметки', () => {
    expect(A['returnWorkLog']).toBeUndefined();
  });
});
