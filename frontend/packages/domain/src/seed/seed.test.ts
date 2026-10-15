// Сид этапа 0: платформа, «Альта» и «Лотос» (mock-data.js 14.10, extra-data.js:4–23).
// Ожидания — WS-05 §6б `seed/counts` и `fill-accounts`, урезанные до срезов пилота (D §4, B §2.6).
import { beforeAll, describe, expect, it } from 'vitest';
import { calendarSeed } from '../modules/calendar/seed.ts';
import { filesSeed } from '../modules/files/seed.ts';
import { logisticsSeed } from '../modules/logistics/seed.ts';
import { createAlta } from './alta.ts';
import { createLotos } from './lotos.ts';
import { createPlatform } from './platform.ts';
import type { BaseDb } from './types.ts';
import type { Platform } from '../modules/platform/types.ts';

describe('платформа (control DB)', () => {
  let P: Platform;
  beforeAll(() => {
    P = createPlatform();
  });

  it('четыре организации со статусами, квотами и местами', () => {
    expect(
      P.tenants.map((t) => [t.id, t.status, t.quotaGb, t.usedGb, t.seatsLimit, t.seatsUsed]),
    ).toEqual([
      ['t-alta', 'trial', 100, 46.2, 10, 9],
      ['t-lotos', 'active', 50, 12.4, 25, 23],
      ['t-remstroy', 'restricted', 25, 19.8, 10, 5],
      ['t-cargo', 'suspended', 100, 63, 25, 22],
    ]);
  });

  it('тарифная сетка, заявки, операторы, журнал', () => {
    expect(P.priceBook.current).toBe(2);
    expect(P.priceBook.versions.map((v) => v.tiers.length)).toEqual([4, 5]);
    for (const v of P.priceBook.versions)
      expect(v.terms.map((t) => [t.months, t.off])).toEqual([
        [1, 0],
        [4, 5],
        [8, 10],
        [12, 20],
      ]);
    expect(P.requests.map((r) => [r.id, r.status, r.tenantId])).toEqual([
      ['SR-12', 'pending', 't-lotos'],
      ['SR-9', 'approved', 't-cargo'],
    ]);
    expect(P.operators).toHaveLength(6);
    expect(P.operators.filter((o) => o.me).map((o) => o.id)).toEqual(['op-1']);
    expect(P.audit).toHaveLength(2);
  });

  it('оформление организаций поверх BRAND_DEFAULT', () => {
    const b = Object.fromEntries(P.tenants.map((t) => [t.id, t.brand]));
    expect(b['t-alta']).toMatchObject({ name: 'Альта Групп', short: '', accent: '#1F6B52' });
    expect(b['t-lotos']).toMatchObject({ short: 'Лотос', accent: '#7A3E79', version: 3 });
    expect(b['t-lotos']?.terms.visit).toEqual({
      one: 'сеанс',
      plural: 'сеансы',
      few: 'сеанса',
      many: 'сеансов',
    });
    expect(b['t-remstroy']?.accent).toBe('#9A4A1F');
    expect(b['t-cargo']).toMatchObject({ poweredBy: false, version: 2 });
  });

  it('каталог аккаунтов добран до занятых мест: 13 + 45 = 58', () => {
    expect(P.accounts).toHaveLength(58);
    const g = P.accounts.filter((a) => a.id.startsWith('acc-g'));
    const by = (t: string) => g.filter((a) => a.memberships[0]?.tenantId === t).length;
    expect([by('t-lotos'), by('t-remstroy'), by('t-cargo')]).toEqual([21, 3, 21]);
    expect(P.accounts.find((a) => a.id === 'acc-g0')).toEqual({
      id: 'acc-g0',
      name: 'Андрей Ершов',
      email: 'staff3@lotos-spa.example',
      status: 'active',
      mfa: true,
      lastLogin: '30.09 08:00',
      memberships: [{ tenantId: 't-lotos', status: 'active' }],
    });
    expect(P.accounts.find((a) => a.id === 'acc-g1')).toMatchObject({
      name: 'Ольга Зайцева',
      email: 'staff4@lotos-spa.example',
      mfa: false,
      lastLogin: '01.10 09:07',
    });
    for (const a of g.filter((x) => x.memberships[0]?.tenantId === 't-cargo'))
      expect(a.lastLogin).toMatch(/^1\d\.09 /);
  });

  it('каждый вызов — новый объект', () => {
    expect(createPlatform()).toEqual(P);
    expect(createPlatform()).not.toBe(P);
  });
});

describe('«Альта Групп»', () => {
  let P: Platform;
  let A: BaseDb;
  beforeAll(() => {
    P = createPlatform();
    A = createAlta(P);
  });

  it('база организации: seq 100, оргструктура, модули', () => {
    expect(A.tenantId).toBe('t-alta');
    expect(A.seq).toBe(100);
    expect(A.platform).toBe(P);
    expect(A.units).toHaveLength(15);
    expect(A.units.filter((u) => u.type === 'region').map((u) => u.id)).toEqual([
      'r-msk',
      'r-smr',
      'r-spb',
    ]);
    expect(A.modules).toEqual({
      logistics: { enabled: false },
      spa: { enabled: true },
      repair: { enabled: false },
    });
    expect(A.events).toEqual([]);
  });

  it('люди: 10 участников, 2 группы, 9 ролей (в т. ч. 4 роли проекта), 7 назначений', () => {
    expect(A.members).toHaveLength(10);
    expect(A.members.filter((m) => m.function === 'driver').map((m) => m.id)).toEqual([
      'm-vasiliev',
      'm-gromov',
      'm-akhmedov',
    ]);
    expect(A.members.filter((m) => m.status === 'invited').map((m) => m.id)).toEqual([
      'm-petrova',
      'm-ilyin',
    ]);
    expect(A.groups.map((g) => g.id)).toEqual(['g-disp', 'g-drv']);
    expect(A.roles.map((r) => r.id)).toEqual([
      'r-owner',
      'r-manager',
      'r-driver',
      'r-therapist',
      'r-foreman',
      'r-pm',
      'r-approver',
      'r-exec',
      'r-viewer',
    ]);
    expect(A.assignments.map((a) => a.id)).toEqual(['a1', 'ap1', 'ap2', 'ap3', 'a2', 'a3', 'a4']);
  });

  it('логистика: 7 машин, 2 рейса, пул из 2 водителей', () => {
    const L = logisticsSeed('t-alta');
    expect(L.vehicles.map((v) => [v.id, v.state])).toEqual([
      ['v1', 'free'],
      ['v6', 'free'],
      ['v2', 'free'],
      ['v3', 'free'],
      ['v4', 'unavailable'],
      ['v5', 'free'],
      ['v7', 'on_route'],
    ]);
    expect(L.trips.map((t) => [t.id, t.driverId, t.status, t.earnings])).toEqual([
      ['Р-208', 'm-vasiliev', 'planned', 4500],
      ['Р-211', null, 'planned', 3800],
    ]);
    expect(L.pool.drivers.map((d) => d.id)).toEqual(['d-104', 'd-117']);
    expect([L.pool.requests, L.earnings]).toEqual([[], []]);
    expect(logisticsSeed('t-lotos')).toEqual({
      vehicles: [],
      trips: [],
      earnings: [],
      pool: { drivers: [], requests: [] },
    });
  });

  it('календарь: 8 ресурсов, 6 броней; место: 4 строки разбивки', () => {
    const C = calendarSeed('t-alta');
    expect(C.resources).toHaveLength(8);
    expect(C.bookings.map((b) => b.id)).toEqual(['b-208', 'b-to', 'b-a1', 'b-a2', 'b-a3', 'b-br']);
    expect(filesSeed('t-alta').breakdown).toHaveLength(4);
    expect(filesSeed('t-lotos').breakdown[0]).toEqual(['Фото работ и техкарты', 6.2]);
    expect(filesSeed('t-x').breakdown).toEqual([]);
  });
});

describe('SPA «Лотос»', () => {
  let P: Platform;
  let L: BaseDb;
  beforeAll(() => {
    P = createPlatform();
    L = createLotos(P);
  });

  it('база: seq 500, 3 подразделения, общий объект платформы', () => {
    expect(L.tenantId).toBe('t-lotos');
    expect(L.seq).toBe(500);
    expect(L.platform).toBe(P);
    expect(L.units.map((u) => u.id)).toEqual(['r-msk', 'f-lotos-tver', 'f-lotos-arb']);
  });

  it('23 участника: владелец, массажист и персонал из каталога аккаунтов', () => {
    expect(L.members).toHaveLength(23);
    expect(L.members[0]).toMatchObject({ id: 'm-owner', name: 'Ирина Белова' });
    expect(L.members[1]).toMatchObject({ id: 'm-morozova', title: 'Массажист · Тверская' });
    expect(L.members[2]).toEqual({
      id: 'm-l1',
      name: 'Андрей Ершов',
      email: 'staff3@lotos-spa.example',
      status: 'active',
      title: 'Массажист',
    });
    expect(L.members.find((m) => m.id === 'm-l4')?.title).toBe('Администратор');
  });

  it('группа «Мастера Тверская» — 12 человек; 7 ролей; 23 назначения', () => {
    expect(L.groups).toHaveLength(1);
    expect(L.groups[0]?.members).toHaveLength(12);
    expect(L.roles.map((r) => r.id)).toEqual([
      'r-owner',
      'r-therapist',
      'r-admin',
      'r-pm',
      'r-approver',
      'r-exec',
      'r-viewer',
    ]);
    expect(L.assignments).toHaveLength(23);
    expect(L.assignments.filter((a) => a.role === 'r-admin').map((a) => a.id)).toEqual([
      'lb3',
      'lb7',
      'lb11',
      'lb15',
      'lb19',
    ]);
    expect(L.assignments.find((a) => a.id === 'lb3')?.scope).toEqual({
      type: 'firm',
      id: 'f-lotos-arb',
    });
  });

  it('календарь повторяет утечки «Альты» только в режиме прототипа (Q-31, PD-27)', () => {
    const leaky = calendarSeed('t-lotos');
    expect(leaky.resources.map((r) => r.id)).toEqual([
      'res-iv',
      'res-am',
      'res-room2',
      'res-room3',
      'res-table',
    ]);
    expect(leaky.bookings).toHaveLength(6);
    const clean = calendarSeed('t-lotos', { prototypeLeaks: false });
    expect(clean.resources.map((r) => r.id)).toEqual([
      'res-am',
      'res-room2',
      'res-room3',
      'res-table',
    ]);
    expect(clean.bookings.map((b) => b.id)).toEqual(['b-a1', 'b-a2', 'b-a3', 'b-br']);
  });

  it('модули и место «Лотоса»', () => {
    expect(L.modules).toEqual({
      logistics: { enabled: false },
      spa: { enabled: true },
      repair: { enabled: false },
    });
    expect(L.events).toEqual([]);
  });
});
