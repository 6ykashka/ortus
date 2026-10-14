// Паритет ядра с эталоном `design/ortus/models.js`: одинаковые входы → одинаковые выходы.
// Эталон только импортируется в тесте и не копируется. Функции ядра, которые 14.10 не изменил
// (git diff design/ortus/models.js ↔ ND 14.10: правки только в CORE.cash, TASK_TONE, scopeLabel,
// rolePermKeys и новые функции модулей), сравниваются на сгенерированных входах. Единственное
// намеренное расхождение — PD-53 (объектные роли), оно проверяется отдельно.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  can,
  canEarnings,
  firmsOf,
  grants,
  moduleOn,
  rolePermKeys,
  scopeCovers,
  scopeLabel,
  unit,
  unitLabel,
} from './access/index.ts';
import { ALL_MODULES, CORE, INDUSTRY, REASON, TONES, VERBS } from './dictionaries.ts';
import { emailOk, hm, initials, int, num, plural, rub } from './format.ts';
import { altaFixture, altaWithLogistics, type FixtureDb } from './testing/fixture.ts';
import type { CanResult, CoreDb, ModuleKey, Role, Scope, Verb } from './types/index.ts';
import { isObjectScope } from './access/index.ts';

interface RefCan {
  ok: boolean;
  reason?: string;
  via?: { id: string; scope: Scope };
}

interface RefModels {
  VERBS: unknown;
  TONES: unknown;
  INDUSTRY: unknown;
  CORE: Record<string, unknown>;
  REASON: unknown;
  unit(db: CoreDb, id: string): unknown;
  unitLabel(db: CoreDb, id: string): string;
  firmsOf(db: CoreDb, regionId?: string): unknown[];
  scopeCovers(db: CoreDb, scope: Scope | undefined, unitId: string): boolean;
  scopeLabel(db: CoreDb, scope: Scope | undefined): string;
  moduleOn(db: CoreDb, key: string): boolean;
  grants(db: CoreDb, memberId: string): unknown[];
  can(db: CoreDb, memberId: string, mod: string, verb: string, unitId?: string): RefCan;
  canEarnings(db: CoreDb, memberId: string, unitId?: string): unknown;
  rolePermKeys(role: Role): string[];
  plural(n: number, a: string, b: string, c: string): string;
  num(n: number): string;
  int(n: number): string;
  rub(n: number): string;
  hm(t: number): string;
  emailOk(s: string): boolean;
  initials(name: string): string;
}

const REF_PATH = '../../../../../design/ortus/models.js';
let P: RefModels;

beforeAll(async () => {
  P = (await import(/* @vite-ignore */ new URL(REF_PATH, import.meta.url).href)) as RefModels;
});

const MODULES = Object.keys(ALL_MODULES) as ModuleKey[];
const VERB_KEYS: Verb[] = ['view', 'create', 'edit', 'review', 'export', 'settings'];
const UNITS = [undefined, 'f-msk-sever', 'f-msk-yug', 'f-smr-volga', 'r-msk', 'nope'];
const OLD_CORE = [
  'calendar',
  'tasks',
  'knowledge',
  'forms',
  'data',
  'files',
  'inventory',
  'notifications',
];

/** Фикстура без объектных назначений: на ней ядро обязано совпадать с эталоном полностью. */
function withoutObjectGrants(db: FixtureDb): FixtureDb {
  db.assignments = db.assignments.filter((a) => !isObjectScope(a.scope));
  return db;
}

const norm = (r: CanResult) =>
  r.ok ? { ok: true, via: r.via.id } : { ok: false, reason: r.reason };
const normRef = (r: RefCan) =>
  r.ok ? { ok: true, via: r.via?.id } : { ok: false, reason: r.reason };

describe('паритет справочников с design/ortus/models.js', () => {
  it('VERBS, TONES, INDUSTRY, REASON совпадают', () => {
    expect(VERBS).toEqual(P.VERBS);
    expect(TONES).toEqual(P.TONES);
    expect(INDUSTRY).toEqual(P.INDUSTRY);
    expect(REASON).toEqual(P.REASON);
  });

  it('CORE: модули, которые 14.10 не менял, совпадают', () => {
    for (const k of OLD_CORE) expect(CORE[k as keyof typeof CORE]).toEqual(P.CORE[k]);
  });
});

describe('паритет функций ядра', () => {
  it('unit, unitLabel, firmsOf, scopeCovers', () => {
    const db = altaFixture();
    const ids = [...db.units.map((u) => u.id), 'nope'];
    for (const id of ids) {
      expect(unit(db, id)).toEqual(P.unit(db, id));
      expect(unitLabel(db, id)).toBe(P.unitLabel(db, id));
    }
    for (const r of [undefined, 'r-msk', 'r-smr', 'r-spb', 'nope'])
      expect(firmsOf(db, r)).toEqual(P.firmsOf(db, r));
    const scopes: (Scope | undefined)[] = [
      undefined,
      { type: 'tenant' },
      { type: 'self' },
      ...db.units.map((u): Scope =>
        u.type === 'region' ? { type: 'region', id: u.id } : { type: 'firm', id: u.id },
      ),
      { type: 'project', id: 'fleet' },
    ];
    for (const s of scopes)
      for (const u of ids) expect(scopeCovers(db, s, u)).toBe(P.scopeCovers(db, s, u));
  });

  it('scopeLabel для четырёх территориальных видов и пустой области', () => {
    const db = altaFixture();
    const scopes: (Scope | undefined)[] = [
      undefined,
      { type: 'tenant' },
      { type: 'self' },
      { type: 'region', id: 'r-smr' },
      { type: 'firm', id: 'f-spb-ohta' },
    ];
    for (const s of scopes) expect(scopeLabel(db, s)).toBe(P.scopeLabel(db, s));
  });

  it('moduleOn и grants', () => {
    const db = altaFixture();
    db.modules.repair = { enabled: false, history: true };
    for (const k of MODULES) expect(moduleOn(db, k)).toBe(P.moduleOn(db, k));
    for (const m of db.members) expect(grants(db, m.id)).toEqual(P.grants(db, m.id));
  });

  it('can: 10 участников × 15 модулей × 6 действий × 6 подразделений без объектных ролей', () => {
    for (const db of [
      withoutObjectGrants(altaFixture()),
      withoutObjectGrants(altaWithLogistics()),
    ]) {
      db.modules.repair = { enabled: false, history: true };
      let n = 0;
      for (const m of db.members)
        for (const mod of MODULES)
          for (const verb of VERB_KEYS)
            for (const u of UNITS) {
              expect(norm(can(db, m.id, mod, verb, u))).toEqual(
                normRef(P.can(db, m.id, mod, verb, u)),
              );
              n++;
            }
      expect(n).toBe(5400);
    }
  });

  it('canEarnings', () => {
    const db = withoutObjectGrants(altaFixture());
    db.assignments.push({
      id: 'x1',
      member: 'm-kotova',
      role: 'r-manager',
      scope: { type: 'region', id: 'r-msk' },
    });
    for (const m of [...db.members.map((x) => x.id), 'nobody'])
      for (const u of UNITS) expect(canEarnings(db, m, u)).toEqual(P.canEarnings(db, m, u));
  });

  it('rolePermKeys для ролей без модулей 14.10 (касса, документы, чаты, обращения)', () => {
    const fresh = new Set(['cash', 'docs', 'chat', 'service']);
    const roles = altaFixture().roles.filter(
      (r) => !Object.keys(r.actions).some((k) => fresh.has(k)),
    );
    expect(roles.length).toBeGreaterThanOrEqual(12);
    for (const r of roles) expect(rolePermKeys(r)).toEqual(P.rolePermKeys(r));
  });

  it('format: plural 0…130, num, int, rub, hm, emailOk, initials', () => {
    for (let n = 0; n <= 130; n++)
      expect(plural(n, 'a', 'b', 'c')).toBe(P.plural(n, 'a', 'b', 'c'));
    for (const x of [1.5, 12, 0.25, 0, -3.75]) expect(num(x)).toBe(P.num(x));
    for (const x of [84370, 0, 1234567, 999]) expect(int(x)).toBe(P.int(x));
    for (const x of [4500, 1600.5, 0, 1234567.891, 2500]) expect(rub(x)).toBe(P.rub(x));
    for (const x of [8.25, 13.25, 14.75, 9, 0, 19.5]) expect(hm(x)).toBe(P.hm(x));
    for (const s of ['a@b.co', ' a@b.co ', 'a@b', 'a b@c.d', ''])
      expect(emailOk(s)).toBe(P.emailOk(s));
    for (const s of ['Дарья Зимина', 'Водитель #104 · временно', 'Анна'])
      expect(initials(s)).toBe(P.initials(s));
  });
});

describe('PD-53: единственное намеренное расхождение с эталоном', () => {
  it('эталон засчитывает роль проекта без объекта (утечка), ядро — нет', () => {
    const db = altaFixture();
    expect(P.can(db, 'm-kotova', 'tasks', 'settings')).toMatchObject({
      ok: true,
      via: { id: 'ap1' },
    });
    expect(can(db, 'm-kotova', 'tasks', 'settings')).toEqual({
      ok: false,
      reason: 'no_permission',
    });
    expect(P.can(db, 'm-kotelnikova', 'knowledge', 'create')).toMatchObject({
      ok: true,
      via: { id: 'akb-2' },
    });
    expect(P.can(db, 'm-vasiliev', 'tasks', 'edit')).toMatchObject({
      ok: true,
      via: { id: 'ap2' },
    });
  });

  it('на полной фикстуре расходятся только ответы, которые эталон дал через объектную роль', () => {
    const db = altaWithLogistics();
    let diverged = 0;
    for (const m of db.members)
      for (const mod of MODULES)
        for (const verb of VERB_KEYS)
          for (const u of UNITS) {
            const ours = norm(can(db, m.id, mod, verb, u));
            const ref = P.can(db, m.id, mod, verb, u);
            if (JSON.stringify(ours) === JSON.stringify(normRef(ref))) continue;
            diverged++;
            // Расхождение возможно, только если действие даёт объектная роль участника.
            const viaObject = grants(db, m.id).some(
              (g) => isObjectScope(g.scope) && (g.roleObj.actions[mod] ?? []).includes(verb),
            );
            expect(viaObject).toBe(true);
            if (ours.ok) {
              // Право есть и так; эталон лишь назвал первой объектную роль.
              expect(isObjectScope(ref.via?.scope)).toBe(true);
              continue;
            }
            // Эталон: либо пропустил через объектную роль, либо сообщил no_scope вместо no_permission.
            if (ref.ok) expect(isObjectScope(ref.via?.scope)).toBe(true);
            else expect([ref.reason, ours.reason]).toEqual(['no_scope', 'no_permission']);
          }
    expect(diverged).toBeGreaterThan(0);
  });
});
