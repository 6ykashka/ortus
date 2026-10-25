// Проекция ремонта для участника (api.js 14.10/19.10:213–222): прораб видит только свои объекты,
// суммы — только с правом финансов.
import { describe, expect, it } from 'vitest';
import { altaRepairDb } from './fixture.test-util.ts';
import { repairView } from './view.ts';

const ids = (xs: { id: string }[]): string[] => xs.map((x) => x.id);

describe('repairView', () => {
  it('владелец видит всё и деньги', () => {
    const db = altaRepairDb();
    const v = repairView(db, 'm-owner');
    expect(ids(v.objects)).toEqual(['obj-42', 'obj-38', 'obj-31', 'obj-45', 'obj-27', 'obj-50']);
    expect(v.works).toHaveLength(13);
    expect(v.logs).toHaveLength(5);
    expect(v.objects.find((o) => o.id === 'obj-38')?.st?.fin?.total).toBe('1 540 000 ₽');
  });

  it('офис с правом приёмки и финансов видит все объекты и деньги', () => {
    const v = repairView(altaRepairDb(), 'm-morozova');
    expect(v.objects).toHaveLength(6);
    expect(v.objects.find((o) => o.id === 'obj-31')?.st?.fin?.paid).toBe('340 200 ₽');
  });

  it('прораб видит только свои объекты, их работы, отметки, материалы и допработы', () => {
    const v = repairView(altaRepairDb(), 'm-sokolov');
    expect(ids(v.objects)).toEqual(['obj-42', 'obj-38', 'obj-31', 'obj-27']);
    expect(ids(v.works)).toEqual([
      'w1',
      'w2',
      'w3',
      'w4',
      'w5',
      'w6',
      'w7',
      'w8',
      'w9',
      'w12',
      'w13',
    ]);
    expect(ids(v.logs)).toEqual(['WL-11', 'WL-09', 'WL-08', 'WL-06', 'WL-02']);
    expect(ids(v.materials)).toEqual(['mt1', 'mt2', 'mt3', 'mt4', 'mt5']);
    expect(ids(v.changes)).toEqual(['ДР-1']);
    expect(v.crew).toHaveLength(4);
  });

  it('прораб без права финансов не получает st.fin; остальная сводка остаётся', () => {
    const v = repairView(altaRepairDb(), 'm-sokolov');
    const o = v.objects.find((x) => x.id === 'obj-38');
    expect(o?.st?.fin).toBeUndefined();
    expect(o?.st?.req).toEqual(['Плинтус МДФ, 42 м']);
    expect(o?.st?.sched?.due).toBe('17.10');
  });

  it('прораб без объектов и участник без роли ремонта получают пустые списки', () => {
    for (const who of ['m-petrova', 'm-kotova']) {
      const v = repairView(altaRepairDb(), who);
      expect(v.objects).toEqual([]);
      expect(v.works).toEqual([]);
      expect(v.logs).toEqual([]);
      expect(v.changes).toEqual([]);
    }
  });

  it('прораб, назначенный на объект позже, видит его по id', () => {
    const db = altaRepairDb();
    const cafe = db.repair.objects.find((o) => o.id === 'obj-45');
    if (cafe) Object.assign(cafe, { foreman: 'Анна Петрова', foremanId: 'm-petrova' });
    expect(ids(repairView(db, 'm-petrova').objects)).toEqual(['obj-45']);
  });

  it('проекция — копия: правки результата не меняют БД', () => {
    const db = altaRepairDb();
    const v = repairView(db, 'm-sokolov');
    const first = v.objects[0];
    if (first) first.name = 'x';
    expect(db.repair.objects[0]?.name).toBe('ЖК Речной · квартира 42');
    repairView(db, 'm-sokolov');
    expect(db.repair.objects.find((o) => o.id === 'obj-38')?.st?.fin).toBeDefined();
  });

  it('отключённый модуль: история объектов доступна владельцу', () => {
    const db = altaRepairDb();
    db.modules.repair = { enabled: false, history: true };
    expect(repairView(db, 'm-owner').objects).toHaveLength(6);
  });

  it('участник без среза — пустой срез', () => {
    const db = altaRepairDb();
    Reflect.deleteProperty(db, 'repair');
    expect(repairView(db as never, 'm-owner').objects).toEqual([]);
  });
});
