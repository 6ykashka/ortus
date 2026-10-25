// Сид «Ремонта и стройки»: срез `db.repair` = `extraSeed().repair` эталона (extra-data.js:77–144),
// кроме намеренных расхождений (Q-W6.10-1: у «Лотоса» срез пустой; `foremanId` — связь с участником).
import { beforeAll, describe, expect, it } from 'vitest';
import { importReference } from '../../seed/reference.ts';
import { emptyRepairSlice, repairSeed } from './seed.ts';
import type { RepairSlice } from './types.ts';

let ref: RepairSlice;

beforeAll(async () => {
  const m = await importReference<{ extraSeed(): { repair: RepairSlice } }>('extra-data.js');
  ref = m.extraSeed().repair;
});

/** Без `foremanId`: эталон хранит прораба только по ФИО. */
const plain = (s: RepairSlice): unknown =>
  JSON.parse(JSON.stringify(s, (k, v: unknown) => (k === 'foremanId' ? undefined : v)));

describe('«Альта»: срез = эталон', () => {
  it('объекты, работы, бригада, материалы, допработы и отметки совпадают с extra-data.js', () => {
    expect(plain(repairSeed('t-alta'))).toEqual(JSON.parse(JSON.stringify(ref)));
  });

  it('состав: 6 объектов (5 действующих и черновик), 13 работ, 4 в бригаде, 5 отметок', () => {
    const s = repairSeed('t-alta');
    expect(s.objects.map((o) => o.id)).toEqual([
      'obj-42',
      'obj-38',
      'obj-31',
      'obj-45',
      'obj-27',
      'obj-50',
    ]);
    expect(s.works).toHaveLength(13);
    expect(s.crew).toHaveLength(4);
    expect(s.materials).toHaveLength(5);
    expect(s.changes.map((c) => c.id)).toEqual(['ДР-1']);
    expect(s.logs.map((l) => l.id)).toEqual(['WL-11', 'WL-09', 'WL-08', 'WL-06', 'WL-02']);
  });

  it('прораб Соколов связан с участником m-sokolov; у кофейни и черновика прораба нет', () => {
    const byId = Object.fromEntries(repairSeed('t-alta').objects.map((o) => [o.id, o]));
    for (const id of ['obj-42', 'obj-38', 'obj-31', 'obj-27']) {
      expect(byId[id]).toMatchObject({ foreman: 'Алексей Соколов', foremanId: 'm-sokolov' });
    }
    for (const id of ['obj-45', 'obj-50']) {
      expect(byId[id]?.foreman).toBeNull();
      expect(byId[id]?.foremanId).toBeUndefined();
    }
  });

  it('готовность кв. 42 в карточке CRM: 100 из 210 м² (работы w1–w3) — «48% принято»', () => {
    const s = repairSeed('t-alta');
    const w = s.works.filter((x) => x.obj === 'obj-42');
    const plan = w.reduce((a, x) => a + x.plan, 0);
    const fact = w.reduce((a, x) => a + x.fact, 0);
    expect([fact, plan, Math.round((fact / plan) * 100)]).toEqual([100, 210, 48]);
  });

  it('каждый вызов отдаёт свежую копию: правки одной не видны другой', () => {
    const a = repairSeed('t-alta');
    const first = a.works[0];
    if (first) first.fact = 999;
    expect(repairSeed('t-alta').works[0]?.fact).toBe(58);
  });
});

describe('другие организации', () => {
  it('«Лотос» и неизвестная организация получают пустой срез', () => {
    expect(repairSeed('t-lotos')).toEqual(emptyRepairSlice());
    expect(repairSeed('t-x')).toEqual(emptyRepairSlice());
  });

  it('пустой срез — шесть пустых списков', () => {
    expect(Object.keys(emptyRepairSlice()).sort()).toEqual([
      'changes',
      'crew',
      'logs',
      'materials',
      'objects',
      'works',
    ]);
  });
});
