// Паритет маршрута документа с эталоном (`design/ortus/documents.js` `docsApi`): одинаковые сценарии
// на «Альте» эталона и домена → одинаковые результаты, ошибки, документы, задачи, события и счётчик id.
// Эталон только импортируется (`seed/reference.ts`). Время часов нормализуется: эталон берёт минуты
// из `new Date()`, домен — из часов демо.
//
// Намеренные расхождения (бриф W7.22 §4) проверяются в `route.test.ts` и исключены из сценариев:
// - Q-W7.22-2: проверка доступа в решении, подписи, ознакомлении и отмене;
// - часы и «сегодня» — `ctx.clock`.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hhmm } from '../../../core/clock.ts';
import { ApiError } from '../../../core/errors/index.ts';
import type { TenantDb } from '../../../core/types/index.ts';
import { createAlta } from '../../../seed/alta.ts';
import { createPlatform } from '../../../seed/platform.ts';
import { importReference, referenceModels } from '../../../seed/reference.ts';
import { demoClock } from '../../../core/clock.ts';
import { installDocs } from '../core/seed.ts';
import type { DocsTenantDb } from '../core/types.ts';
import { routeRig } from './fixture.test-util.ts';
import { routeSheet } from './sheet.ts';
import type { DocsDb } from '../core/fixture.test-util.ts';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

type Cmd = (...a: unknown[]) => unknown;
interface RefDocs {
  installDocs(db: unknown, M: unknown): void;
  docsApi(o: Record<string, unknown>): Record<string, Cmd>;
  routeSheet(db: unknown, d: unknown, r?: unknown, noAck?: boolean): unknown;
}
interface RefMockData {
  seed(): DocsTenantDb & { events: unknown[]; platform: unknown };
}

let RD: RefDocs;
let M: Record<string, unknown>;
let MD: RefMockData;

beforeAll(async () => {
  M = await referenceModels<Record<string, unknown>>();
  RD = await importReference<RefDocs>('documents.js');
  MD = await importReference<RefMockData>('mock-data.js');
});

interface Step {
  actor: string;
  cmd: string;
  args: unknown[];
}
type Mutate = (db: DocsTenantDb) => void;
type Item = Step | { mutate: Mutate };

const norm = (x: unknown): unknown =>
  JSON.parse(
    JSON.stringify(x, (_k, v: unknown) => (v === undefined ? undefined : v)).replace(
      /\b\d\d:\d\d\b/g,
      'HH:MM',
    ),
  ) as unknown;

function refRig(): {
  db: DocsTenantDb & { events: unknown[] };
  api: Record<string, Cmd>;
  as(id: string): void;
} {
  const db = MD.seed();
  RD.installDocs(db, M);
  let actor = 'm-owner';
  const event = (text: string, to: string[], sensitive?: string): void => {
    db.events.unshift({
      id: 'e' + (db as unknown as { seq: number }).seq++,
      at: hhmm(demoClock),
      text,
      to,
      sensitive: sensitive || null,
    });
  };
  const api = RD.docsApi({
    getDb: () => db,
    getActor: () => actor,
    cmd: (fn: () => unknown) => fn(),
    ApiError,
    M,
    event,
  });
  return {
    db,
    api,
    as: (id) => {
      actor = id;
    },
  };
}

function domainDb(): DocsDb {
  const db = createAlta(createPlatform()) as TenantDb;
  const r = MD.seed() as unknown as Record<string, unknown>;
  const slot = db as unknown as Record<string, unknown>;
  for (const k of ['repair', 'trips', 'vehicles']) slot[k] ??= structuredClone(r[k]);
  installDocs(db);
  return db as DocsDb;
}

const run = (fn: () => unknown): unknown => {
  try {
    return { ok: fn() };
  } catch (e) {
    const x = e as ApiError;
    return { err: x.code, message: x.message };
  }
};

/** Срез состояния, на котором сравниваем: документы, задачи проекта маршрутов, события, счётчик. */
const state = (db: DocsTenantDb & { events?: unknown[]; tasks?: unknown[] }): unknown =>
  norm({
    docs: db.docs,
    tasks: (db.tasks ?? []).filter((t) => (t as { docRoute?: unknown }).docRoute),
    events: (db.events ?? []).slice(0, 6),
    seq: (db as unknown as { seq: number }).seq,
  });

function scenario(items: Item[]): void {
  const ref = refRig();
  const dom = routeRig(domainDb());
  expect(state(dom.db)).toEqual(state(ref.db));
  items.forEach((it, i) => {
    if ('mutate' in it) {
      it.mutate(ref.db);
      it.mutate(dom.db);
      return;
    }
    ref.as(it.actor);
    dom.as(it.actor);
    const a = norm(run(() => ref.api[it.cmd]?.(...structuredClone(it.args))));
    const b = norm(
      run(() =>
        (dom.cmds as unknown as Record<string, Cmd>)[it.cmd]?.(...structuredClone(it.args)),
      ),
    );
    expect(b, 'результат шага ' + i + ' ' + it.cmd).toEqual(a);
    expect(state(dom.db), 'состояние после шага ' + i + ' ' + it.cmd).toEqual(state(ref.db));
  });
  for (const d of ref.db.docs?.items ?? []) {
    const e = dom.db.docs.items.find((x) => x.id === d.id);
    expect(norm(routeSheet(dom.db, e as never))).toEqual(norm(RD.routeSheet(ref.db, d)));
    expect(norm(routeSheet(dom.db, e as never, undefined, true))).toEqual(
      norm(RD.routeSheet(ref.db, d, undefined, true)),
    );
  }
}

const S = (actor: string, cmd: string, ...args: unknown[]): Step => ({ actor, cmd, args });
const ORDER = [
  { kind: 'approve', mode: 'all', who: ['m-kotova'], days: 2 },
  { kind: 'sign', who: ['m-owner'], days: 1 },
  { kind: 'ack', audience: [{ who: 'group', ref: 'g-disp' }], days: 3 },
];
const START = S('m-owner', 'docRouteStart', 'doc-ord14', {
  steps: ORDER,
  rules: { notAuthor: false },
  project: 'pj-docs',
});
const dirty: Item = {
  mutate: (db) => {
    const d = db.docs?.items.find((x) => x.id === 'doc-ord14');
    if (d) d.dirty = true;
  },
};
/** Код подписи зависит от seq: берём его из ответа эталона и подаём обоим. */
const SIGN = (code: string): Step => S('m-owner', 'docSign', 'doc-ord14', code);

describe('паритет маршрута с documents.js', () => {
  it('старт, согласование, утверждение по коду и PDF/A', () => {
    const ref = refRig();
    ref.as('m-owner');
    ref.api.docRouteStart?.('doc-ord14', {
      steps: ORDER,
      rules: { notAuthor: false },
      project: 'pj-docs',
    });
    ref.as('m-kotova');
    ref.api.docRouteDecide?.('doc-ord14', { decision: 'ok' });
    ref.as('m-owner');
    const { code } = ref.api.docSignStart?.('doc-ord14') as { code: string };
    scenario([
      START,
      S('m-kotova', 'docRouteDecide', 'doc-ord14', { decision: 'ok' }),
      S('m-owner', 'docSignStart', 'doc-ord14'),
      S('m-owner', 'docSign', 'doc-ord14', '0000'),
      SIGN(code),
    ]);
  });

  it('ознакомление до конца и досрочное закрытие', () => {
    const ref = refRig();
    ref.as('m-owner');
    ref.api.docRouteStart?.('doc-ord14', {
      steps: ORDER,
      rules: { notAuthor: false },
      project: 'pj-docs',
    });
    ref.as('m-kotova');
    ref.api.docRouteDecide?.('doc-ord14', { decision: 'ok' });
    ref.as('m-owner');
    const { code } = ref.api.docSignStart?.('doc-ord14') as { code: string };
    ref.api.docSign?.('doc-ord14', code);
    const people =
      ref.db.docs?.items.find((x) => x.id === 'doc-ord14')?.route?.steps[2]?.people ?? [];
    const acks = people.flatMap((m, i) =>
      i === 0
        ? [S(m, 'docAck', 'doc-ord14', { device: 'телефон' }), S(m, 'docAck', 'doc-ord14', {})]
        : [],
    );
    scenario([
      START,
      S('m-kotova', 'docRouteDecide', 'doc-ord14', { decision: 'ok' }),
      S('m-owner', 'docSignStart', 'doc-ord14'),
      SIGN(code),
      ...acks,
      S('m-owner', 'docAck', 'doc-ord14', {}),
      S('m-kotova', 'docAckClose', 'doc-ord14'),
      S('m-owner', 'docAckClose', 'doc-ord14'),
      S('m-owner', 'docAckClose', 'doc-ord14'),
    ]);
  });

  it('договор с подписью заказчика (демо «от имени»)', () => {
    scenario([
      S('m-owner', 'docRouteStart', 'doc-42', {
        steps: [
          { kind: 'approve', who: ['m-sokolov', 'm-kotova'], mode: 'seq', days: 1 },
          { kind: 'ext', days: 3 },
        ],
        project: 'pj-docs',
      }),
      S('m-owner', 'docRouteDecide', 'doc-42', { decision: 'ok' }),
      S('m-owner', 'docRouteDecide', 'doc-42', { decision: 'ok', as: 'm-kotova' }),
      S('m-owner', 'docRouteDecide', 'doc-42', { decision: 'ok', as: 'm-sokolov' }),
      S('m-owner', 'docRouteDecide', 'doc-42', { decision: 'ok', as: 'm-kotova' }),
      S('m-owner', 'docRouteDecide', 'doc-42', { decision: 'ok', as: 'ext', comment: 'Ок' }),
    ]);
  });

  it('возврат на доработку, повтор и отмена', () => {
    scenario([
      START,
      S('m-kotova', 'docRouteDecide', 'doc-ord14', { decision: 'back' }),
      S('m-kotova', 'docRouteDecide', 'doc-ord14', { decision: 'back', comment: 'Поправьте' }),
      S('m-owner', 'docRouteResume', 'doc-ord14'),
      dirty,
      S('m-kotova', 'docRouteResume', 'doc-ord14'),
      S('m-owner', 'docRouteResume', 'doc-ord14'),
      S('m-kotova', 'docRouteCancel', 'doc-ord14'),
      S('m-owner', 'docRouteCancel', 'doc-ord14'),
      S('m-owner', 'docRouteCancel', 'doc-ord14'),
      S('m-owner', 'docRouteResume', 'doc-ord14'),
    ]);
  });

  it('ошибки старта: шаги, проект, повторный старт, PDF/A', () => {
    scenario([
      S('m-owner', 'docRouteStart', 'doc-ord14', { steps: [], project: 'pj-docs' }),
      S('m-owner', 'docRouteStart', 'doc-ord14', { steps: [{ kind: 'x' }], project: 'pj-docs' }),
      S('m-owner', 'docRouteStart', 'doc-ord14', { steps: [{ kind: 'approve', who: [] }] }),
      S('m-owner', 'docRouteStart', 'doc-ord14', {
        steps: [{ kind: 'approve', who: ['m-owner'] }],
        project: 'pj-docs',
      }),
      S('m-owner', 'docRouteStart', 'doc-ord14', {
        steps: [{ kind: 'sign', who: ['m-sokolov'] }],
        project: 'pj-docs',
      }),
      S('m-owner', 'docRouteStart', 'doc-ord14', {
        steps: [{ kind: 'ack', audience: [{ who: 'group', ref: 'g-nope' }] }],
        project: 'pj-docs',
      }),
      S('m-owner', 'docRouteStart', 'doc-ord14', {
        steps: [{ kind: 'approve', who: ['m-kotova'] }],
        project: 'pj-docs',
        saveTpl: true,
      }),
      S('m-owner', 'docRouteStart', 'doc-ord14', {
        steps: [{ kind: 'approve', who: ['m-kotova'] }],
        project: 'pj-docs',
      }),
      S('m-kotova', 'docRouteStart', 'doc-ord14', {
        steps: [{ kind: 'approve', who: ['m-ilyin'] }],
        project: 'pj-docs',
      }),
      S('m-owner', 'docRouteStart', 'doc-318', {
        steps: [{ kind: 'approve', who: ['m-kotova'] }],
        project: 'pj-docs',
      }),
      S('m-owner', 'docRouteDecide', 'doc-318', { decision: 'ok' }),
      S('m-owner', 'docRouteDecide', 'doc-ord14', { decision: 'ok', as: 'm-ilyin' }),
    ]);
  });

  it('решения: чужая очередь, утверждение без кода, подпись без запроса', () => {
    scenario([
      START,
      S('m-owner', 'docRouteDecide', 'doc-ord14', { decision: 'ok' }),
      S('m-owner', 'docSignStart', 'doc-ord14'),
      S('m-owner', 'docSign', 'doc-ord14', '1'),
      S('m-kotova', 'docRouteDecide', 'doc-ord14', { decision: 'ok', comment: ' ок ' }),
      S('m-owner', 'docRouteDecide', 'doc-ord14', { decision: 'ok' }),
      S('m-owner', 'docRouteDecide', 'doc-ord14', { decision: 'ok', as: 'm-owner' }),
      S('m-owner', 'docSign', 'doc-ord14', '1'),
      S('m-kotova', 'docSignStart', 'doc-ord14'),
      S('m-owner', 'docRouteDecide', 'doc-ord14', { decision: 'ok', as: 'm-kotova' }),
    ]);
  });
});
