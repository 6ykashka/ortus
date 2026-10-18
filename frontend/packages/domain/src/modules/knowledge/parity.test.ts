// Паритет «Базы знаний» с эталоном 14.10 (`design/ortus/knowledge.js`, `models.js`, `mock-data.js`,
// `api.js`): одинаковые входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
// Функции доступа сравниваются на одной и той же БД эталона (сид + `installKnowledge`).
//
// Намеренные расхождения (бриф W4.30 §10) проверяются здесь же явно:
// - KB-02: роли «Автор» нет, `akb-3` — «Редактор» (для сравнений БД эталона приводится к этому);
// - PD-53: объектная роль не даёт глаголов области; `kbCreateSpace` — по области пространства;
// - PD-60: истёкшее назначение на ветку не действует; `saveKbPage` — по `kbAccess`;
// - KB-01: запись `relation` только из шаблона; KB-03: журнал `ack.log`; KB-06: глубина 6;
// - `createKbPage` создаёт узел v2.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO, demoClock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { Assignment, Entry, TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { importReference, referenceModels } from '../../seed/reference.ts';
import { kbAccess, kbEntryReach, kbLeads, kbReach, kbSpaceGrant, kbSpaceMy } from './access.ts';
import { knowledgeCommands, type KnowledgeApi } from './commands.ts';
import * as D from './dictionaries.ts';
import { kbImpact, kbMoveImpact, type KbAccessPatch } from './impact.ts';
import { areaLabel, entryLabel, unitName } from './labels.ts';
import { migrateKnowledgeV2 } from './migrate-v2.ts';
import { knowledgeSeed } from './seed.ts';
import { kbKids, kbPath, kbSubtree, kbTop } from './tree.ts';
import type { KbAccessEntry, KbNode, KbSpace, KbTenantDb, KnowledgeSlice } from './types.ts';
import { kbView } from './view.ts';

/** Демо-«сегодня» БЗ (PD-60): назначения сравнения в этот день действуют, как в эталоне без сроков. */
const T = { today: DEMO.kbToday };

type Fn = (...a: unknown[]) => unknown;
type RefKnowledge = Record<string, unknown> & {
  installKnowledge(db: unknown): void;
  knowledgeApi(env: unknown): Record<string, Fn>;
  kbAccess: Fn;
  kbReach: Fn;
  kbEntryReach: Fn;
  kbSpaceMy: Fn;
  kbSpaceGrant: Fn;
  kbLeads: Fn;
  kbImpact: Fn;
  kbMoveImpact: Fn;
  kbView: Fn;
  kbPath: Fn;
  kbKids: Fn;
  kbSubtree: Fn;
  kbTop: Fn;
  entryLabel: Fn;
  areaLabel: Fn;
  unitName: Fn;
};
interface RefMockData {
  seed(): RefDb;
  seedLotos(platform: unknown): RefDb;
}
type RefDb = Db & { platform: unknown; events: { id: string; text: string; to: string[] }[] };
type RefAdapter = Record<string, (...a: unknown[]) => Promise<{ data: unknown; db: RefView }>> & {
  setActor(memberId: string | null, tenantId?: string): void;
};
interface RefView {
  knowledge: KnowledgeSlice;
}
type Db = KbTenantDb & { knowledge: KnowledgeSlice };

// Табличные прогоны (десятки тысяч сравнений) и импорт эталона под нагрузкой машины — дольше 5 с.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let RK: RefKnowledge;
let M: unknown;
let MD: RefMockData;
let createMockAdapter: () => RefAdapter;

beforeAll(async () => {
  M = await referenceModels<Record<string, unknown>>();
  RK = await importReference<RefKnowledge>('knowledge.js');
  MD = await importReference<RefMockData>('mock-data.js');
  ({ createMockAdapter } = await importReference<{ createMockAdapter: () => RefAdapter }>(
    'api.js',
  ));
});

const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown;
/** JSON без времени (`at` — `new Date()` эталона против часов домена) и журнала ознакомлений (KB-03). */
const norm = (x: unknown): unknown =>
  JSON.parse(
    JSON.stringify(x, (k, v: unknown) => (k === 'at' || k === 'log' ? undefined : v)),
  ) as unknown;
const ED: KbAccessEntry = { who: 'role', ref: 'r-kb-editor', can: 'edit' };

/** KB-02 в БД эталона: Котова в «Общем» — «Редактор». */
function kb02(db: Db): Db {
  const a = db.assignments.find((x) => x.id === 'akb-3');
  if (a) a.role = 'r-kb-editor';
  return db;
}
const refAlta = (): RefDb => {
  const db = MD.seed();
  RK.installKnowledge(db);
  kb02(db);
  return db;
};
const domainAlta = (): Db => {
  const db = createAlta(createPlatform()) as TenantDb as Db;
  db.knowledge = knowledgeSeed('t-alta');
  migrateKnowledgeV2(db);
  return db;
};

describe('справочники = knowledge.js', () => {
  it.each([
    'KB_ACCESS',
    'KB_MODES',
    'KB_KINDS',
    'KB_STATUS',
    'KB_ICONS',
    'KB_COLORS',
    'KB_TEMPLATES',
    'KB_SECTION',
  ] as const)('%s', (name) => {
    expect(json(D[name])).toEqual(RK[name]);
  });

  it('KB-02: роли пространства — эталон без «Автора»', () => {
    const ref = RK['KB_ROLES'] as { id: string }[];
    expect(json(D.KB_ROLES)).toEqual(ref.filter((r) => r.id !== 'r-kb-author'));
    expect(D.KB_ROLE_ORDER).toEqual(
      (RK['KB_ROLE_ORDER'] as string[]).filter((r) => r !== 'r-kb-author'),
    );
    const caps = { ...(RK['KB_ROLE_CAPS'] as Record<string, string>) };
    delete caps['r-kb-author'];
    expect(D.KB_ROLE_CAPS).toEqual(caps);
  });
});

describe('сид и миграция v2 = эталон', () => {
  it('сырая БЗ «Альты» и «Лотоса»', () => {
    expect(json(knowledgeSeed('t-alta'))).toEqual(json(MD.seed().knowledge));
    const ref = MD.seed();
    expect(json(knowledgeSeed('t-lotos'))).toEqual(json(MD.seedLotos(ref.platform).knowledge));
  });

  it('«Альта» после миграции: срез БЗ, роли и назначения пространств', () => {
    const ref = refAlta();
    const db = domainAlta();
    expect(json(db.knowledge)).toEqual(json(ref.knowledge));
    const kbRoles = (x: Db) => x.roles.filter((r) => r.space && r.id !== 'r-kb-author');
    expect(json(kbRoles(db))).toEqual(json(kbRoles(ref)));
    const akb = (x: Db) => x.assignments.filter((a) => a.id.startsWith('akb-'));
    expect(akb(db)).toEqual(akb(ref));
  });

  it('KB-02: в эталоне akb-3 — «Автор»', () => {
    const ref = MD.seed();
    RK.installKnowledge(ref);
    expect(ref.assignments.find((a) => a.id === 'akb-3')?.role).toBe('r-kb-author');
    expect(domainAlta().assignments.find((a) => a.id === 'akb-3')?.role).toBe('r-kb-editor');
  });

  it('«Лотос» после миграции', () => {
    const platform = createPlatform();
    const ref = MD.seedLotos(MD.seed().platform);
    RK.installKnowledge(ref);
    const db = createLotos(platform) as TenantDb as Db;
    db.knowledge = knowledgeSeed('t-lotos');
    migrateKnowledgeV2(db);
    expect(json(db.knowledge)).toEqual(json(ref.knowledge));
  });
});

const EXTRA: Assignment[] = [
  { id: 'x1', member: 'm-petrova', role: 'r-manager', scope: { type: 'region', id: 'r-msk' } },
  { id: 'x2', member: 'm-ilyin', role: 'r-manager', scope: { type: 'firm', id: 'f-msk-yug' } },
  { id: 'x3', member: 'm-akhmedov', role: 'r-driver', scope: { type: 'firm', id: 'f-msk-sever' } },
  {
    id: 'x4',
    member: 'm-morozova',
    role: 'r-kb-reader',
    scope: { type: 'page', id: 'kb-1' },
    until: '31.10.2026',
  },
  { id: 'x5', member: 'm-sokolov', role: 'r-kb-lead', scope: { type: 'space', id: 'sp-gen' } },
  {
    id: 'x6',
    member: 'm-kotelnikova',
    role: 'r-kb-reader',
    scope: { type: 'space', id: 'sp-own' },
  },
  { id: 'x7', member: 'm-gromov', role: 'r-kb-lead', scope: { type: 'space', id: 'sp-log' } },
  { id: 'x8', member: 'm-akhmedov', role: 'r-kb-reader', scope: { type: 'page', id: 'kb-fin' } },
];

const VARIANTS: [KbSpace['access'], string | null][] = [];
for (const access of ['open', 'limited', 'closed'] as const)
  for (const unit of [null, 'f-msk-sever', 'r-msk', 'f-msk-yug']) VARIANTS.push([access, unit]);

function withVariant(db: RefDb, v: [KbSpace['access'], string | null] | null): RefDb {
  if (v) for (const s of db.knowledge.spaces) Object.assign(s, { access: v[0], unit: v[1] });
  return db;
}

describe('доступ = эталон на одной БД (все участники × все узлы)', () => {
  it.each([null, ...VARIANTS])('kbAccess, kbReach при уровне и области %j', (v) => {
    const db = withVariant(refAlta(), v);
    db.assignments.push(...structuredClone(EXTRA));
    let n = 0;
    for (const m of db.members)
      for (const node of db.knowledge.pages) {
        expect(kbAccess(db, m.id, node, T)).toEqual(RK.kbAccess(db, M, m.id, node));
        expect(kbReach(db, m.id, node, T)).toEqual(RK.kbReach(db, M, m.id, node));
        n++;
      }
    expect(n).toBe(350);
  });

  it('kbSpaceMy, kbSpaceGrant, kbLeads, подписи', () => {
    const db = refAlta();
    db.assignments.push(...structuredClone(EXTRA));
    for (const v of [null, ...VARIANTS]) {
      withVariant(db, v);
      for (const s of db.knowledge.spaces) {
        expect(json(kbLeads(db, s, T))).toEqual(json(RK.kbLeads(db, s)));
        expect(areaLabel(db, s)).toBe(RK.areaLabel(db, s));
        for (const m of db.members) {
          expect(kbSpaceMy(db, m.id, s, T)).toEqual(RK.kbSpaceMy(db, M, m.id, s));
          expect(kbSpaceGrant(db, m.id, s, T)).toEqual(RK.kbSpaceGrant(db, m.id, s));
        }
      }
    }
    for (const u of [...db.units.map((x) => x.id), 'нет'])
      expect(unitName(db, u)).toBe(RK.unitName(db, u));
  });

  it('kbEntryReach и entryLabel для записей всех узлов', () => {
    const db = refAlta();
    db.assignments.push(...structuredClone(EXTRA));
    const extra: Entry[] = [
      { who: 'group', ref: 'g-drv' },
      { who: 'group', ref: 'g-disp' },
      { who: 'role', ref: 'r-driver' },
      { who: 'member', ref: 'm-gromov' },
      { who: 'relation', ref: 'foreman', obj: 'obj-42' },
    ];
    for (const n of db.knowledge.pages) {
      const sp = db.knowledge.spaces.find((s) => s.id === n.space) as KbSpace;
      for (const e of [...(n.list ?? []), ...extra]) {
        expect(json(kbEntryReach(db, e, sp, n, T))).toEqual(json(RK.kbEntryReach(db, M, e, sp, n)));
        expect(entryLabel(db, e)).toBe(RK.entryLabel(db, e));
      }
    }
  });

  it('дерево: kbPath, kbKids, kbSubtree, kbTop', () => {
    const db = refAlta();
    const K = db.knowledge;
    const ids = (xs: unknown) => (xs as KbNode[]).map((x) => x.id);
    for (const n of K.pages) {
      expect(ids(kbPath(K, n))).toEqual(ids(RK.kbPath(K, n)));
      expect(ids(kbKids(K, n.id))).toEqual(ids(RK.kbKids(K, n.id)));
      expect(ids(kbKids(K, n.id, true))).toEqual(ids(RK.kbKids(K, n.id, true)));
      expect(ids(kbSubtree(K, n))).toEqual(ids(RK.kbSubtree(K, n)));
      expect(ids(kbSubtree(K, n, true))).toEqual(ids(RK.kbSubtree(K, n, true)));
    }
    for (const s of K.spaces) expect(ids(kbTop(K, s.id))).toEqual(ids(RK.kbTop(K, s.id)));
  });
});

describe('влияние и проекция = эталон', () => {
  const PATCHES: KbAccessPatch[] = [
    { mode: 'inherit', list: [] },
    { mode: 'listed', list: [ED] },
    { mode: 'edit', list: [{ who: 'member', ref: 'm-vasiliev', can: 'edit' }] },
  ];

  it('kbImpact: все узлы × 3 режима × applyOwn', () => {
    const db = refAlta();
    db.assignments.push(...structuredClone(EXTRA));
    for (const n of db.knowledge.pages)
      for (const p of PATCHES)
        for (const applyOwn of [false, true]) {
          const mine = kbImpact(db, n.id, { ...p, applyOwn }, T);
          const ref = RK.kbImpact(db, M, n.id, { ...p, applyOwn }) as { ids: Set<string> };
          expect({ ...mine, ids: [...mine.ids] }).toEqual({ ...ref, ids: [...ref.ids] });
        }
  });

  it('kbMoveImpact: все узлы × 4 родителя', () => {
    const db = refAlta();
    db.assignments.push(...structuredClone(EXTRA));
    for (const n of db.knowledge.pages)
      for (const parent of [null, 'kb-f-drv', 'kb-fin', 'kb-rep-obj']) {
        expect(kbMoveImpact(db, n.id, parent, T)).toEqual(RK.kbMoveImpact(db, M, n.id, parent));
      }
  });

  it('kbView для каждого участника', () => {
    const db = refAlta();
    db.assignments.push(...structuredClone(EXTRA));
    db.knowledge.requests = [
      {
        id: 'kq-1',
        node: 'kb-1',
        space: 'sp-log',
        member: 'm-vasiliev',
        can: 'edit',
        at: '—',
        status: 'open',
      },
      {
        id: 'kq-2',
        node: 'kb-gen-1',
        space: 'sp-gen',
        member: 'm-kotova',
        can: 'edit',
        at: '—',
        status: 'open',
      },
    ];
    for (const m of db.members) {
      const mine = kbView(db, m.id, structuredClone(db.knowledge), T);
      expect(json(mine)).toEqual(json(RK.kbView(db, M, m.id, structuredClone(db.knowledge))));
    }
  });
});

type Step = [actor: string, run: (api: KnowledgeApi, db: Db) => unknown];

const STEPS: Step[] = [
  [
    'm-owner',
    (a) =>
      a.kbCreateSpace({ name: 'Склад', access: 'limited', template: 'staff', unit: 'f-msk-sever' }),
  ],
  ['m-owner', (a) => a.kbCreateSpace({ name: 'логистика', access: 'open' })],
  ['m-owner', (a) => a.kbCreateSpace({ name: 'Новое', access: 'x' as never })],
  ['m-kotova', (a) => a.kbCreateSpace({ name: 'Своё', access: 'open' })],
  ['m-kotova', (a) => a.kbCreateNode('sp-log', 'kb-f-reg', 'page', 'Новый регламент')],
  ['m-kotova', (a) => a.kbCreateNode('sp-log', null, 'diagram', 'Схема')],
  ['m-vasiliev', (a) => a.kbCreateNode('sp-log', 'kb-f-drv', 'page', 'Моя')],
  ['m-kotova', (a) => a.kbCreateNode('sp-log', null, 'file', 'Файл')],
  ['m-kotova', (a) => a.kbPublish('kb-1', { base: 2, body: 'v3', ack: true })],
  ['m-vasiliev', (a) => a.kbAck('kb-1')],
  ['m-vasiliev', (a) => a.kbAck('kb-1')],
  ['m-kotelnikova', (a) => a.kbAck('kb-1')],
  ['m-morozova', (a) => a.kbAck('kb-3')],
  ['m-kotova', (a) => a.kbPublish('kb-1', { base: 1, body: 'x' })],
  ['m-kotova', (a) => a.kbPublish('kb-d1', { steps: ['А', ' ', 'Б'], title: 'Сдача смены' })],
  ['m-kotova', (a) => a.kbPublish('kb-2', { body: 'я'.repeat(20001) })],
  ['m-kotelnikova', (a) => a.kbSetStatus('kb-6', 'active')],
  ['m-kotelnikova', (a) => a.kbSetStatus('kb-6', 'x' as never)],
  ['m-kotova', (a) => a.kbSetAccess('kb-f-drv', { mode: 'listed', list: [ED], applyOwn: true })],
  [
    'm-kotova',
    (a) =>
      a.kbSetAccess('kb-2', { mode: 'edit', list: [{ who: 'group', ref: 'g-disp', can: 'edit' }] }),
  ],
  ['m-kotova', (a) => a.kbSetAccess('kb-2', { mode: 'x' as never })],
  [
    'm-kotova',
    (a) =>
      a.kbSetAccess('kb-2', { mode: 'listed', list: [{ who: 'role', ref: 'r-x', can: 'view' }] }),
  ],
  ['m-kotelnikova', (a) => a.kbSetAccess('kb-2', { mode: 'inherit' })],
  ['m-kotova', (a) => a.kbMove('kb-6', null)],
  ['m-kotova', (a) => a.kbMove('kb-f-reg', 'kb-1a')],
  ['m-kotova', (a) => a.kbMove('kb-1', 'kb-gen-1')],
  ['m-kotelnikova', (a) => a.kbArchive('kb-1b', true)],
  ['m-kotova', (a) => a.kbArchive('kb-log-home', true)],
  ['m-vasiliev', (a) => a.kbArchive('kb-1', true)],
  ['m-vasiliev', (a) => a.kbRequest('kb-1', 'edit')],
  ['m-vasiliev', (a) => a.kbRequest('kb-1', 'edit')],
  ['m-kotelnikova', (a, db) => a.kbDecide(db.knowledge.requests?.[0]?.id ?? '', true)],
  ['m-kotova', (a, db) => a.kbDecide(db.knowledge.requests?.[0]?.id ?? '', true)],
  ['m-kotova', (a, db) => a.kbDecide(db.knowledge.requests?.[0]?.id ?? '', true)],
  ['m-vasiliev', (a) => a.kbRequest('kb-2', 'view')],
  ['m-owner', (a, db) => a.kbDecide(db.knowledge.requests?.[0]?.id ?? '', true)],
  ['m-vasiliev', (a) => a.kbRequest('kb-gen-1', 'view')],
  ['m-owner', (a, db) => a.kbDecide(db.knowledge.requests?.[0]?.id ?? '', false)],
  ['m-kotova', (a) => a.kbSetMember('sp-log', 'm-vasiliev', 'r-kb-editor')],
  ['m-kotova', (a) => a.kbSetMember('sp-log', 'm-vasiliev', null)],
  ['m-kotova', (a) => a.kbSetMember('sp-log', 'm-kotova', 'r-kb-reader')],
  ['m-kotova', (a) => a.kbSetMember('sp-log', 'm-owner', 'r-kb-reader')],
  ['m-kotova', (a) => a.kbSetMember('sp-log', 'm-x', 'r-kb-reader')],
  ['m-kotova', (a) => a.kbToggleRule('kr-1')],
  ['m-kotova', (a) => a.kbToggleRule('kr-3')],
  ['m-kotova', (a) => a.kbCheckReview('sp-log')],
  ['m-kotova', (a) => a.kbCheckReview('sp-log')],
  ['m-owner', (a) => a.kbCheckReview('sp-rep')],
  ['m-owner', (a) => a.kbRunSection('obj-42')],
  ['m-owner', (a) => a.kbRunSection('obj-45')],
  ['m-owner', (a) => a.kbRunSection('obj-38')],
  ['m-owner', (a) => a.kbRunSection('obj-x')],
  ['m-vasiliev', (a) => a.kbPublish('kb-fin', { body: 'x' })],
  ['m-sokolov', (a) => a.kbPublish('kb-o-obj-42-2', { body: 'Код домофона сменили' })],
];

function outcome(f: () => unknown): unknown {
  try {
    return { ok: json(f() ?? null) };
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
}

describe('сценарий команд = эталон', () => {
  it('54 шага: одинаковые ответы, ошибки, БЗ, назначения, события и seq', () => {
    const dbR = refAlta();
    const dbD = refAlta();
    let actor = 'm-owner';
    const refApi = RK.knowledgeApi({
      getDb: () => dbR,
      getActor: () => actor,
      cmd: (fn: () => unknown) => fn(),
      ApiError,
      M,
      event: (text: string, to: string[]) => {
        dbR.events.unshift({ id: 'e' + dbR.seq++, text, to });
      },
    }) as unknown as KnowledgeApi;
    const api = knowledgeCommands(
      createModuleCtx({
        getDb: () => dbD,
        getActor: () => actor,
        clock: demoClock,
        tasks: createFakeTaskPort(),
      }),
    );
    expect(STEPS).toHaveLength(54);
    for (const [who, run] of STEPS) {
      actor = who;
      const ref = outcome(() => run(refApi, dbR));
      const mine = outcome(() => run(api, dbD));
      expect([who, mine]).toEqual([who, ref]);
    }
    expect(norm(dbD.knowledge)).toEqual(norm(dbR.knowledge));
    expect(dbD.assignments).toEqual(dbR.assignments);
    expect(dbD.seq).toBe(dbR.seq);
    const ev = (db: RefDb) => db.events.map((e) => [e.id, e.text, e.to]);
    expect(ev(dbD)).toEqual(ev(dbR));
  });
});

describe('намеренные расхождения с эталоном', () => {
  it('KB-02: «Автора» назначить нельзя (эталон назначает)', () => {
    const dbR = refAlta();
    const dbD = refAlta();
    const env = (db: RefDb) => ({
      getDb: () => db,
      getActor: () => 'm-kotova',
      cmd: (fn: () => unknown) => fn(),
      ApiError,
      M,
      event: () => undefined,
    });
    expect(
      outcome(() =>
        RK.knowledgeApi(env(dbR))['kbSetMember']?.('sp-log', 'm-vasiliev', 'r-kb-author'),
      ),
    ).toEqual({ ok: { ok: true } });
    const api = knowledgeCommands(
      createModuleCtx({
        getDb: () => dbD,
        getActor: () => 'm-kotova',
        clock: demoClock,
        tasks: createFakeTaskPort(),
      }),
    );
    expect(outcome(() => api.kbSetMember('sp-log', 'm-vasiliev', 'r-kb-author'))).toEqual({
      code: 'validation',
      message: 'Выберите роль пространства',
    });
  });

  it('PD-53: объектная роль с правами БЗ пускает в пространство только в эталоне', () => {
    const db = refAlta();
    db.roles.push({
      id: 'r-kbx',
      name: 'Проектная',
      kind: 'custom',
      project: true,
      actions: { knowledge: ['view'] },
      finance: { read: false, manage: false },
    });
    db.assignments.push({
      id: 'x',
      member: 'm-ilyin',
      role: 'r-kbx',
      scope: { type: 'project', id: 'fleet' },
    });
    const n = db.knowledge.pages.find((p) => p.id === 'kb-gen-1') as KbNode;
    expect((RK.kbAccess(db, M, 'm-ilyin', n) as { view: boolean }).view).toBe(true);
    expect(kbAccess(db, 'm-ilyin', n, T).view).toBe(false);
  });

  it('PD-53: «Настраивать» в одной фирме не создаёт пространство другой (эталон создаёт)', () => {
    const dbR = refAlta();
    const dbD = refAlta();
    for (const db of [dbR, dbD]) {
      db.roles.push({
        id: 'r-kbadm',
        name: 'Админ БЗ',
        kind: 'custom',
        actions: { knowledge: ['view', 'settings'] },
        finance: { read: false, manage: false },
      });
      db.assignments.push({
        id: 'x',
        member: 'm-ilyin',
        role: 'r-kbadm',
        scope: { type: 'firm', id: 'f-msk-yug' },
      });
    }
    const spec = { name: 'Север', access: 'open', unit: 'f-msk-sever' } as const;
    const env = {
      getDb: () => dbR,
      getActor: () => 'm-ilyin',
      cmd: (fn: () => unknown) => fn(),
      ApiError,
      M,
      event: () => undefined,
    };
    expect(outcome(() => RK.knowledgeApi(env)['kbCreateSpace']?.(spec))).toMatchObject({
      ok: { id: expect.any(String) },
    });
    const api = knowledgeCommands(
      createModuleCtx({
        getDb: () => dbD,
        getActor: () => 'm-ilyin',
        clock: demoClock,
        tasks: createFakeTaskPort(),
      }),
    );
    expect(outcome(() => api.kbCreateSpace(spec))).toMatchObject({ code: 'forbidden' });
  });

  it('PD-60: истёкшее назначение на ветку — эталон срок не проверяет', () => {
    const db = refAlta();
    db.assignments.push({ ...(EXTRA[3] as Assignment), until: '30.09.2026' });
    const n = db.knowledge.pages.find((p) => p.id === 'kb-1') as KbNode;
    expect((RK.kbAccess(db, M, 'm-morozova', n) as { view: boolean }).view).toBe(true);
    expect(kbAccess(db, 'm-morozova', n, { today: '01.10.2026' }).view).toBe(false);
  });

  it('KB-01 и KB-06: связь вне шаблона и седьмой уровень принимает только эталон', () => {
    const dbR = refAlta();
    const dbD = refAlta();
    const env = {
      getDb: () => dbR,
      getActor: () => 'm-owner',
      cmd: (fn: () => unknown) => fn(),
      ApiError,
      M,
      event: () => undefined,
    };
    const ref = RK.knowledgeApi(env) as unknown as KnowledgeApi;
    const api = knowledgeCommands(
      createModuleCtx({
        getDb: () => dbD,
        getActor: () => 'm-owner',
        clock: demoClock,
        tasks: createFakeTaskPort(),
      }),
    );
    const rel = {
      mode: 'listed',
      list: [{ who: 'relation', ref: 'foreman', obj: 'obj-42', can: 'view' }],
    } as const;
    expect(outcome(() => ref.kbSetAccess('kb-2', rel))).toMatchObject({ ok: { pages: 1 } });
    expect(outcome(() => api.kbSetAccess('kb-2', rel))).toEqual({
      code: 'validation',
      message: 'Связь с записью CRM задаётся шаблоном раздела',
    });
    let pr = 'kb-1a';
    let pd = 'kb-1a';
    for (let i = 4; i <= 6; i++) {
      pr = ref.kbCreateNode('sp-log', pr, 'page', 'Уровень ' + i).id;
      pd = api.kbCreateNode('sp-log', pd, 'page', 'Уровень ' + i).id;
    }
    expect(outcome(() => ref.kbCreateNode('sp-log', pr, 'page', 'Уровень 7'))).toMatchObject({
      ok: { id: expect.any(String) },
    });
    expect(outcome(() => api.kbCreateNode('sp-log', pd, 'page', 'Уровень 7'))).toEqual({
      code: 'validation',
      message: 'Не больше шести уровней вложенности',
    });
  });

  it('saveKbPage: эталон правит закрытую страницу по роли пространства, домен — нет', async () => {
    const ref = createMockAdapter();
    ref.setActor('m-kotova', 't-alta');
    const r = await ref['saveKbPage']?.('kb-4', 'Правка', 1);
    expect(r?.data).toBe(2);
    const db = refAlta();
    const api = knowledgeCommands(
      createModuleCtx({
        getDb: () => db,
        getActor: () => 'm-kotova',
        clock: demoClock,
        tasks: createFakeTaskPort(),
      }),
    );
    expect(outcome(() => api.saveKbPage('kb-4', 'Правка', 1))).toEqual({
      code: 'not_found',
      message: 'Страница не найдена или недоступна',
    });
    expect(outcome(() => api.saveKbPage('kb-1', 'Правка', 2))).toEqual({ ok: 3 });
  });

  it('createKbPage: эталон — узел старого вида, домен — узел v2', async () => {
    const ref = createMockAdapter();
    ref.setActor('m-owner', 't-alta');
    const r = await ref['createKbPage']?.('sp-log', { title: 'Журнал рейсов', body: 'Текст' });
    const id = (r?.data as { id: string }).id;
    const refNode = r?.db.knowledge.pages.find((p) => p.id === id);
    expect(refNode?.parent).toBeUndefined();
    expect(refNode?.mode).toBeUndefined();
    const db = refAlta();
    const api = knowledgeCommands(
      createModuleCtx({
        getDb: () => db,
        getActor: () => 'm-owner',
        clock: demoClock,
        tasks: createFakeTaskPort(),
      }),
    );
    const mine = api.createKbPage('sp-log', { title: 'Журнал рейсов', body: 'Текст' });
    expect(db.knowledge.pages.find((p) => p.id === mine.id)).toMatchObject({
      parent: null,
      mode: 'inherit',
      kind: 'page',
      status: 'active',
    });
  });
});
