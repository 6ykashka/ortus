// Паритет ядра документов с эталоном (`design/ortus/documents.js`, `models.js`, `mock-data.js`):
// одинаковые входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
// Функции доступа сравниваются на одной и той же БД эталона (сид + `installDocs`) для каждого
// участника, документа и папки.
//
// Намеренные расхождения (бриф W7.21 §Отличия) проверяются здесь же явно:
// - PD-53: роль с объектной областью (в том числе `chat`, `account`) не даёт глаголов области;
// - PD-60: назначение со сроком `until` раньше `opts.today` не действует; дата обязательна;
// - `fieldVals` берёт организацию по `db.tenantId`, а не `tenants[0]` (у «Лотоса» — «Лотос», не «Альта»);
// - `docsView` скрывает финансовый лист и в `versions[].sheets` (эталон отдавал копии целиком);
// - проект `pj-docs` без `unit` вместо `unit: null` (так хранит домен задач).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO } from '../../../core/clock.ts';
import { entryKey, entryHas, entryIcon, entryPeople } from '../../../core/entries.ts';
import type { Assignment, Role, TenantDb } from '../../../core/types/index.ts';
import { createAlta } from '../../../seed/alta.ts';
import { createLotos } from '../../../seed/lotos.ts';
import { createPlatform } from '../../../seed/platform.ts';
import { importReference, referenceModels } from '../../../seed/reference.ts';
import { docAccess, docPeople, docRights, engineCfg, finSees, protEdit } from './access.ts';

import * as D from './dictionaries.ts';
import { fieldVals, fillTokens } from './fields.ts';
import { docMoveImpact, docShareImpact } from './impact.ts';
import { entryLabel, unitName } from './labels.ts';
import { docsSeed, installDocs } from './seed.ts';
import { folderLabel, folderOf, folderPath } from './tree.ts';
import type { DocItem, DocsSlice, DocsTenantDb, Sheet } from './types.ts';
import { addWorkDays, shaOf } from './util.ts';
import { docStatus, docWaits, stepWaiting } from './waits.ts';
import { docsView } from './view.ts';
import { shortName } from '../../../core/format.ts';

const T = { today: DEMO.docToday };

type Fn = (...a: unknown[]) => unknown;
type RefDocs = Record<string, unknown> & {
  installDocs: Fn;
  docsView: Fn;
  docAccess: Fn;
  docRights: Fn;
  finSees: Fn;
  protEdit: Fn;
  engineCfg: Fn;
  docPeople: Fn;
  docShareImpact: Fn;
  docMoveImpact: Fn;
  docWaits: Fn;
  docStatus: Fn;
  stepWaiting: Fn;
  fieldVals: Fn;
  fillTokens: Fn;
  entryLabel: Fn;
  entryKey: Fn;
  entryIcon: Fn;
  entryPeople: Fn;
  entryHas: Fn;
  unitName: Fn;
  folderPath: Fn;
  folderLabel: Fn;
  addWork: Fn;
  shaOf: Fn;
  shortName: Fn;
};
interface RefMockData {
  seed(): RefDb;
  seedLotos(platform: unknown): RefDb;
}
type RefDb = DocsTenantDb & { platform: unknown };
type Db = DocsTenantDb & { docs: DocsSlice };

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

let RD: RefDocs;
let M: unknown;
let MD: RefMockData;

beforeAll(async () => {
  M = await referenceModels<Record<string, unknown>>();
  RD = await importReference<RefDocs>('documents.js');
  MD = await importReference<RefMockData>('mock-data.js');
});

const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown;
/** JSON без `null`-полей: домен задач не хранит `unit: null` у проекта «на всю организацию». */
const noNull = (x: unknown): unknown =>
  JSON.parse(JSON.stringify(x, (_k, v: unknown) => (v === null ? undefined : v))) as unknown;
/** Ответ эталона с тем же скрытием финансовых листов в `versions[].sheets`, что делает домен. */
function maskRefVersions(out: unknown, ref: RefDb, actor: string): unknown {
  const view = out as { items: { id: string; versions?: { sheets?: Sheet[] }[] }[] };
  for (const x of view.items) {
    const d = ref.docs?.items.find((y) => y.id === x.id);
    for (const v of x.versions ?? []) {
      v.sheets = v.sheets?.map((s) =>
        s.fin && !s.hidden && !RD.finSees(ref, M, actor, d, s)
          ? {
              id: s.id,
              name: s.name,
              fin: true,
              hidden: true,
              cols: s.cols,
              rows: s.rows,
              w: s.w,
              cells: {},
            }
          : s,
      );
    }
  }
  return out;
}
/** Роли с глаголами документов: остальные поля ролей — зона других модулей (обучение, касса). */
const docRoles = (db: { roles: Role[] }): unknown =>
  noNull(
    db.roles
      .filter((r) => r.actions.docs || r.docsAddressed || r.folderRole)
      .map((r) => ({
        id: r.id,
        docs: r.actions.docs,
        addressed: r.docsAddressed,
        role: r.folderRole ? r : null,
      })),
  );
/** Назначения ролей папок (doc-*): остальные назначения эталона — зона других модулей. */
const docAssign = (db: { assignments: Assignment[] }): unknown =>
  json(db.assignments.filter((a) => a.id.startsWith('adoc-')));
/** Проект маршрутов pj-docs: остальные проекты — зона задач. */
const docProject = (db: { projects?: { id: string }[] }): unknown =>
  noNull(db.projects?.find((p) => p.id === 'pj-docs'));
const refAlta = (): RefDb => {
  const db = MD.seed();
  RD.installDocs(db, M);
  return db;
};
const domainAlta = (): Db => {
  const db = createAlta(createPlatform()) as TenantDb;
  // Ремонт, рейсы и машины — срезы других модулей: берём из сида эталона как входные данные.
  const r = MD.seed() as unknown as Record<string, unknown>;
  const slot = db as unknown as Record<string, unknown>;
  for (const k of ['repair', 'trips', 'vehicles']) slot[k] ??= structuredClone(r[k]);
  installDocs(db);
  return db as Db;
};

describe('справочники = documents.js', () => {
  it.each([
    'DOC_LEVELS',
    'LV',
    'LV_KEY',
    'DOC_LEVEL_HINT',
    'DOC_KINDS',
    'STEP_KINDS',
    'APPROVE_MODES',
    'DOC_ROLES',
    'DOC_TEMPLATES',
  ])('%s', (name) => {
    expect(json((D as Record<string, unknown>)[name])).toEqual(json(RD[name]));
  });
});

describe('чистые функции', () => {
  it('addWorkDays = addWork на сетке дат с праздником 04.11', () => {
    for (const from of ['01.10.2026', '02.10.2026', '03.11.2026', '30.10.2026', '31.12.2026']) {
      for (let n = 0; n <= 12; n++) {
        expect(addWorkDays(from, n)).toBe(RD.addWork(from, n));
      }
    }
  });

  it('shaOf = shaOf', () => {
    for (const x of [undefined, null, '', 'abc', 1, [1, 2], { a: 1, b: [{ c: 'я' }] }, 12]) {
      expect(shaOf(x)).toBe(RD.shaOf(x));
    }
  });

  it('shortName ядра = shortName эталона', () => {
    for (const n of [
      'Алексей Соколов',
      '',
      undefined,
      'Иван',
      'Анна Мария Петрова',
      '  Ли  Чен ',
    ]) {
      expect(shortName(n)).toBe(RD.shortName(n));
    }
  });

  it('fillTokens = fillTokens', () => {
    const cases: [string | undefined, Record<string, string> | undefined][] = [
      ['Привет, {Имя}!', { Имя: 'Ира' }],
      ['{X}', {}],
      ['{A} и {B} и {A}', { A: '1', B: '2' }],
      [undefined, { A: '1' }],
      ['{ A }', { ' A ': 'x' }],
      ['{}', {}],
      ['{A', { A: '1' }],
      ['{a}', undefined],
    ];
    for (const [t, v] of cases) expect(fillTokens(t, v)).toBe(RD.fillTokens(t, v));
  });
});

describe('сид и установка', () => {
  it('docsSeed «Альта» = altaDocs; «Лотос» = otherDocs', () => {
    const ref = refAlta();
    const db = createAlta(createPlatform()) as TenantDb;
    const s = docsSeed(db);
    expect(json(s.folders)).toEqual(json(ref.docs?.folders));
    expect(json(s.items)).toEqual(json(ref.docs?.items));
    const lotos = MD.seedLotos(ref.platform);
    RD.installDocs(lotos, M);
    const dl = createLotos(createPlatform()) as TenantDb;
    const sl = docsSeed(dl);
    expect(json({ folders: sl.folders, items: sl.items })).toEqual(
      json({ folders: lotos.docs?.folders, items: lotos.docs?.items }),
    );
  });

  it('«Альта» после installDocs: срез, роли, назначения, проект pj-docs', () => {
    const ref = refAlta();
    const db = domainAlta();
    expect(json(db.docs)).toEqual(json(ref.docs));
    expect(docRoles(db)).toEqual(docRoles(ref));
    expect(docAssign(db)).toEqual(docAssign(ref));
    expect(docProject(db)).toEqual(docProject(ref));
  });

  it('«Лотос» после installDocs', () => {
    const ref = MD.seedLotos(MD.seed().platform);
    RD.installDocs(ref, M);
    const db = createLotos(createPlatform()) as TenantDb;
    installDocs(db);
    const d = db as Db;
    expect(json(d.docs)).toEqual(json(ref.docs));
    expect(docRoles(d)).toEqual(docRoles(ref));
    expect(docAssign(d)).toEqual(docAssign(ref));
    expect(docProject(d)).toEqual(docProject(ref));
  });

  it('установка идемпотентна', () => {
    const db = domainAlta();
    const before = json(db);
    installDocs(db);
    expect(json(db)).toEqual(before);
  });
});

describe('подписи и дерево папок', () => {
  it('folderPath, folderLabel, entryLabel, unitName, ключи и значки записей', () => {
    const ref = refAlta();
    const db = domainAlta();
    for (const f of db.docs.folders) {
      expect(json(folderPath(db, f.id))).toEqual(json(RD.folderPath(ref, f.id)));
      expect(folderLabel(db, f.id)).toBe(RD.folderLabel(ref, f.id));
    }
    expect(folderPath(db, 'нет')).toEqual([]);
    expect(folderOf(db, 'fd-log')?.name).toBe('Север Логистик');
    const entries = [
      ...db.docs.folders.flatMap((f) => f.share),
      ...db.docs.items.flatMap((d) => d.share),
      { who: 'all' as const },
      { who: 'member' as const, ref: 'нет' },
      { who: 'group' as const, ref: 'g-disp' },
      { who: 'group' as const, ref: 'нет' },
      { who: 'role' as const, ref: 'r-driver', unit: 'f-msk-sever' },
      { who: 'role' as const, ref: 'r-driver' },
      { who: 'role' as const, ref: 'нет' },
      { who: 'relation' as const, ref: 'foreman', obj: 'obj-42' },
      { who: 'relation' as const, obj: 'нет' },
    ];
    for (const e of entries) {
      expect(entryLabel(db, e)).toBe(RD.entryLabel(ref, e));
      expect(entryKey(e)).toBe(RD.entryKey(e));
      expect(entryIcon(e)).toBe(RD.entryIcon(e));
      expect(json(entryPeople(db, e).map((m) => m.id))).toEqual(
        json((RD.entryPeople(ref, M, e) as { id: string }[]).map((m) => m.id)),
      );
    }
    for (const id of [undefined, null, 'f-msk-sever', 'r-msk', 'нет']) {
      expect(unitName(db, id)).toBe(RD.unitName(ref, id));
    }
  });

  it('entryHas ядра = entryHas эталона для всех участников и записей', () => {
    const ref = refAlta();
    const db = domainAlta();
    const entries = [
      ...db.docs.folders.flatMap((f) => f.share),
      ...db.docs.items.flatMap((d) => d.share),
      { who: 'role' as const, ref: 'r-driver', unit: 'f-msk-sever' },
      { who: 'relation' as const, ref: 'foreman', obj: 'obj-42' },
    ];
    for (const m of db.members) {
      for (const e of entries) expect(entryHas(db, m.id, e)).toBe(RD.entryHas(ref, M, m.id, e));
    }
  });
});

describe('доступ: цепочка, права, финансы, маршрут — на каждого участника и документ', () => {
  it('docAccess и docRights для документов и папок', () => {
    const ref = refAlta();
    const db = domainAlta();
    let n = 0;
    for (const m of db.members) {
      for (const x of [...db.docs.items, ...db.docs.folders]) {
        const a = docAccess(db, m.id, x, T);
        expect(json(a)).toEqual(json(RD.docAccess(ref, M, m.id, x)));
        n++;
      }
      for (const d of db.docs.items) {
        expect(json(docRights(db, m.id, d, T))).toEqual(json(RD.docRights(ref, M, m.id, d)));
        expect(json(docWaits(db, m.id, d))).toEqual(json(RD.docWaits(ref, M, m.id, d)));
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('finSees, protEdit, docPeople, engineCfg', () => {
    const ref = refAlta();
    const db = domainAlta();
    for (const m of db.members) {
      for (const d of db.docs.items) {
        for (const sh of d.sheets ?? []) {
          expect(finSees(db, m.id, d, sh)).toBe(RD.finSees(ref, M, m.id, d, sh));
        }
        expect(finSees(db, m.id, d, undefined)).toBe(RD.finSees(ref, M, m.id, d, undefined));
        for (const pr of d.prot ?? []) {
          expect(protEdit(db, m.id, pr)).toBe(RD.protEdit(ref, M, m.id, pr));
        }
      }
    }
    for (const d of db.docs.items) {
      expect(docPeople(db, d, T).map((m) => m.id)).toEqual(
        (RD.docPeople(ref, M, d) as { id: string }[]).map((m) => m.id),
      );
    }
    for (const kind of ['text', 'sheet', 'pdf']) {
      for (const L of [0, 1, 2, 3, 4, 5]) {
        const r = docRights(db, 'm-owner', db.docs.items[0] as DocItem, T);
        const x = { ...r, edit: L >= 4, suggest: L >= 3, comment: L >= 2, export: L > 3 };
        expect(engineCfg(x, kind)).toBe(RD.engineCfg(x, kind));
      }
    }
  });

  it('влияние на доступ: «Поделиться» и «Перенести»', () => {
    const ref = refAlta();
    const db = domainAlta();
    const patches = [
      { mode: 'listed' as const, share: [] },
      { mode: 'listed' as const, share: [{ who: 'all' as const, level: 'view' }] },
      { share: [{ who: 'member' as const, ref: 'm-vasiliev', level: 'edit' }] },
      { mode: 'inherit' as const },
      {},
    ];
    for (const d of db.docs.items) {
      for (const p of patches) {
        expect(json(docShareImpact(db, d, p, T))).toEqual(json(RD.docShareImpact(ref, M, d, p)));
      }
      for (const f of db.docs.folders) {
        expect(json(docMoveImpact(db, d, f.id, T))).toEqual(
          json(RD.docMoveImpact(ref, M, d, f.id)),
        );
      }
    }
  });

  it('docStatus и stepWaiting на документах сида и синтетических маршрутах', () => {
    const ref = refAlta();
    const db = domainAlta();
    for (const d of db.docs.items) expect(json(docStatus(d))).toEqual(json(RD.docStatus(d)));
    const dec = (member: string, decision = 'ok') => ({ member, decision, at: 'x' });
    const steps = [
      { kind: 'approve', mode: 'seq', who: ['a', 'b', 'c'], decisions: [] },
      { kind: 'approve', mode: 'seq', who: ['a', 'b'], decisions: [dec('a')] },
      { kind: 'approve', mode: 'any', who: ['a', 'b'], decisions: [dec('b')] },
      { kind: 'approve', mode: 'any', who: ['a', 'b'], decisions: [] },
      { kind: 'approve', mode: 'all', who: ['a', 'b'], decisions: [dec('a'), dec('b', 'back')] },
      { kind: 'sign', who: ['o', 'p'], decisions: [] },
      { kind: 'sign', who: ['o'], decisions: [dec('o')] },
      { kind: 'ext', decisions: [] },
      { kind: 'ext', decisions: [dec('ext')] },
      { kind: 'ack', people: ['a', 'b'], done: [{ member: 'a' }] },
      { kind: 'нечто', who: ['a'], decisions: [] },
    ].map((s) => ({ status: 'active', ...s }));
    for (const s of [...steps, { ...steps[0], status: 'done' }, undefined]) {
      expect(stepWaiting(s as never)).toEqual(RD.stepWaiting(s));
    }
    const route = (cur: number, status = 'active') => ({
      status,
      cur,
      steps: steps.map((s) => ({
        ...s,
        name: 'шаг',
        due: '02.10.2026',
        done: s.kind === 'ack' ? [] : undefined,
      })),
      by: 'a',
      back: { name: 'Имя', comment: 'К' },
    });
    const base = db.docs.items[0] as DocItem;
    for (let cur = 0; cur < steps.length; cur++) {
      for (const status of ['active', 'returned', 'done']) {
        const d = { ...base, route: route(cur, status) } as unknown as DocItem;
        expect(json(docStatus(d))).toEqual(json(RD.docStatus(d)));
        for (const mid of ['a', 'b', 'o', 'ext', 'm-owner']) {
          expect(json(docWaits(db, mid, d))).toEqual(json(RD.docWaits(ref, M, mid, d)));
        }
      }
    }
    const extra = [
      { jobs: [{ status: 'running', name: 'Распознавание' }] },
      { presence: [{ member: 'x' }, { member: 'y' }] },
      { pdfa: true },
      { pdfa: true, status: 'signed' },
      { status: 'signed' },
      { status: 'approved' },
      { status: 'agreed' },
      { ocr: { status: 'done', words: [{ st: 'open' }, { st: 'ok' }, { st: 'open' }] } },
      { ocr: { status: 'done', words: [{ st: 'open' }] } },
    ];
    for (const e of extra) {
      const d = { ...base, route: undefined, jobs: [], presence: [], ...e } as unknown as DocItem;
      expect(json(docStatus(d))).toEqual(json(RD.docStatus(d)));
    }
  });
});

describe('поля CRM', () => {
  it('fieldVals для каждого документа «Альты» и шаблонов, связанных с рейсом и объектом', () => {
    const ref = refAlta();
    const db = domainAlta();
    for (const d of db.docs.items)
      expect(json(fieldVals(db, d))).toEqual(json(RD.fieldVals(ref, d)));
    const trip = (ref as unknown as { trips?: { id: string }[] }).trips?.[0];
    const cases: Partial<DocItem>[] = [
      { links: [{ kind: 'trip', id: trip?.id ?? 'нет' }] },
      { links: [{ kind: 'trip', id: 'нет' }] },
      { links: [{ kind: 'object', id: 'нет' }] },
      { links: [] },
      { frozen: { Подрядчик: 'Зафиксировано' } },
    ];
    for (const t of D.DOC_TEMPLATES) {
      for (const c of cases) {
        const d = { ...(db.docs.items[0] as DocItem), fields: t.fields, folder: t.folder, ...c };
        expect(json(fieldVals(db, d))).toEqual(json(RD.fieldVals(ref, d)));
      }
    }
  });

  it('«Лотос»: организация — «Лотос», а не tenants[0] (расхождение с эталоном)', () => {
    const db = lotosDocs0();
    const d = { ...(db.docs.items[0] as DocItem), fields: [{ k: 'Орг', src: 'tenant' }] };
    expect(fieldVals(db, d)['Орг']).toBe('ООО «' + tenantName(db) + '»');
    expect(tenantName(db)).not.toBe('Альта');
  });
});

describe('docsView = docsView эталона', () => {
  it('срез для каждого участника «Альты»', () => {
    const ref = refAlta();
    const db = domainAlta();
    for (const m of db.members) {
      const mine = docsView(db, m.id, structuredClone(db.docs), T);
      const theirs = maskRefVersions(
        RD.docsView(ref, M, m.id, structuredClone(ref.docs)),
        ref,
        m.id,
      );
      expect(json(mine)).toEqual(json(theirs));
    }
  });

  it('срез для каждого участника «Лотоса»', () => {
    const ref = MD.seedLotos(MD.seed().platform);
    RD.installDocs(ref, M);
    const db = createLotos(createPlatform()) as TenantDb;
    installDocs(db);
    const d = db as Db;
    for (const m of d.members) {
      const mine = docsView(d, m.id, structuredClone(d.docs), T);
      const theirs = maskRefVersions(
        RD.docsView(ref, M, m.id, structuredClone(ref.docs)),
        ref,
        m.id,
      );
      expect(json(mine)).toEqual(json(theirs));
    }
  });

  it('утечка финансового листа через версии закрыта', () => {
    const db = domainAlta();
    let hiddenFor = 0;
    for (const m of db.members) {
      const fuel = docsView(db, m.id, structuredClone(db.docs), T)?.items.find(
        (d) => d.id === 'doc-fuel',
      );
      if (!fuel) continue;
      const src = db.docs.items.find((d) => d.id === 'doc-fuel') as DocItem;
      const sees = finSees(db, m.id, src, { finWho: ['m-kotova'] });
      const check = (sheets: Sheet[] | undefined): void => {
        if (!sheets) return;
        const pay = sheets?.find((s) => s.id === 'sh-pay');
        if (sees) expect(pay?.hidden).toBeUndefined();
        else expect(pay).toMatchObject({ hidden: true, cells: {} });
      };
      check(fuel.sheets);
      for (const v of fuel.versions) check(v.sheets);
      if (!sees) hiddenFor++;
    }
    expect(hiddenFor).toBeGreaterThan(0);
  });
});

describe('PD-53 и PD-60: расхождения с эталоном', () => {
  const asg = (a: Partial<Assignment> & { role: string }): Assignment => ({
    id: 'a-test',
    member: 'm-vasiliev',
    scope: { type: 'tenant' },
    ...a,
  });

  it('роль с глаголами документов и областью `chat`/`account` не открывает папку области', () => {
    const db = domainAlta();
    const doc42 = db.docs.items.find((d) => d.id === 'doc-fuel') as DocItem;
    const role = db.roles.find((r) => r.id === 'r-manager');
    expect(role).toBeDefined();
    for (const type of ['chat', 'account', 'project', 'space']) {
      const d2 = domainAlta();
      d2.assignments.push(asg({ role: 'r-manager', scope: { type, id: 'x' } as never }));
      expect(docAccess(d2, 'm-vasiliev', doc42, T).L).toBe(0);
    }
    const d3 = domainAlta();
    d3.assignments.push(asg({ role: 'r-manager', scope: { type: 'firm', id: 'f-msk-sever' } }));
    expect(docAccess(d3, 'm-vasiliev', doc42, T).L).toBe(5);
  });

  it('назначение в папке с истёкшим сроком не действует; без даты часов — ошибка', () => {
    const db = domainAlta();
    db.assignments.push(
      asg({ role: 'r-doc-read', scope: { type: 'folder', id: 'fd-o42' }, until: '30.09.2026' }),
    );
    const d = db.docs.items.find((x) => x.id === 'doc-42') as DocItem;
    expect(docAccess(db, 'm-vasiliev', d, T).L).toBe(0);
    expect(docAccess(db, 'm-vasiliev', d, { today: '30.09.2026' }).L).toBe(1);
    expect(() => docAccess(db, 'm-vasiliev', d, { today: '' })).toThrow(/DocOpts\.today/);
  });
});

function tenantName(db: Db): string {
  const t = (db as unknown as { platform: { tenants: { id: string; name: string }[] } }).platform
    .tenants;
  return (t.find((x) => x.id === db.tenantId) as { name: string }).name;
}
function lotosDocs0(): Db {
  const db = createLotos(createPlatform()) as TenantDb;
  installDocs(db);
  return db as Db;
}
