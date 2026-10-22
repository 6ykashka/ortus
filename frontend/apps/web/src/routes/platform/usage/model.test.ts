// W4.61 · Модель «Использования» (usageVM :3751–3805) на примере контракта getPlatformUsage/ok (снимок MSW W4.07).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import example from '../../../../../../../api/openapi/examples/getPlatformUsage/ok.json';
import { moduleCards, signalRows, sortRows, summaryTiles, tableRows } from './model.ts';

type Usage = components['schemas']['PlatformUsage'];

const usage = example as unknown as Usage;
const ids = Object.fromEntries(usage.tenants.map((t) => [t.name, t.tenantId]));
/** Конец пробного периода «Ремстрой Плюс» из подписки (getPlatformSubscription). */
const trialEnds = new Map([[ids['Ремстрой Плюс'] ?? '', '2026-09-20T21:00:00Z']]);

describe('плитки сводки (usageVM :3786–3791)', () => {
  it('организации по статусам, места, хранилище, входы за 7 дней', () => {
    expect(summaryTiles(usage)).toEqual([
      {
        label: 'Организации',
        value: '4',
        sub: 'Пробный период: 1 · Действует: 1 · Ограничен: 1 · Приостановлен: 1',
      },
      { label: 'Места с входом', value: '59 из 70', sub: 'занято 84% проданных мест' },
      { label: 'Хранилище', value: '141,4 из 275 ГБ', sub: 'занято 51% выделенного места' },
      { label: 'Входили за 7 дней', value: '21 из 57', sub: 'активных участников организаций' },
    ]);
  });

  it('grace и read_only — одна строка «Ограничен», без проданных мест — 0 %', () => {
    const u: Usage = {
      ...usage,
      summary: {
        ...usage.summary,
        tenantsByStatus: [
          { status: 'grace', count: 1 },
          { status: 'read_only', count: 2 },
        ],
        seatsSold: 0,
      },
    };
    const [orgs, seats] = summaryTiles(u);
    expect(orgs?.sub).toBe('Ограничен: 3');
    expect(seats?.sub).toBe('занято 0% проданных мест');
  });
});

describe('«Требуют внимания» (usageVM :3766–3778)', () => {
  it('порядок эталона: уровень, затем порядок организаций, затем вид; у приостановленной нет «никто не входил»', () => {
    const rows = signalRows(usage, trialEnds);
    expect(rows.map((r) => [r.org, r.text, r.act])).toEqual([
      ['Альта Групп', 'Места почти закончились: 9 из 10', 'card'],
      ['SPA «Лотос»', 'Места почти закончились: 23 из 25. Заявка SR-12 ждёт решения', 'request'],
      ['Ремстрой Плюс', 'Хранилище заполнено на 79%: 19,8 из 25 ГБ', 'card'],
      ['Ремстрой Плюс', 'Ограничен: пробный период закончился 20.09.2026, оплаты нет', 'card'],
      ['Карго Сити', 'Места почти закончились: 22 из 25', 'card'],
      ['Карго Сити', 'Приостановлен. Последний вход 13 дн. назад', 'card'],
      ['Альта Групп', 'Пробный период заканчивается 13.10.2026, через 12 дн.', 'card'],
    ]);
    expect(rows.map((r) => [r.tone, r.icon])).toEqual([
      ['warn', 'group'],
      ['warn', 'group'],
      ['warn', 'storage'],
      ['warn', 'lock_clock'],
      ['warn', 'group'],
      ['danger', 'pause_circle'],
      ['info', 'hourglass_top'],
    ]);
  });

  it('все места заняты, хранилище ≥ 95 %, никто не входил > 7 дней', () => {
    const t = usage.tenants[0];
    const u: Usage = {
      ...usage,
      signals: [
        {
          tenantId: t?.tenantId ?? '',
          tenantName: 'Альта Групп',
          kind: 'seats_full',
          level: 'high',
          seatsUsed: 10,
          seatsLimit: 10,
        },
        {
          tenantId: t?.tenantId ?? '',
          tenantName: 'Альта Групп',
          kind: 'storage_high',
          level: 'high',
          storageUsedBytes: 102 * 1024 ** 3,
          storageQuotaBytes: 100 * 1024 ** 3,
          storagePercent: 102,
        },
        {
          tenantId: t?.tenantId ?? '',
          tenantName: 'Альта Групп',
          kind: 'inactive',
          level: 'medium',
          lastSignInDays: 9,
        },
      ],
      tenants: usage.tenants.map((x, i) =>
        i === 0 ? { ...x, lastSignInAt: '2026-09-22T06:00:00Z' } : x,
      ),
    };
    expect(signalRows(u, new Map()).map((r) => [r.text, r.tone, r.icon])).toEqual([
      ['Все места заняты: 10 из 10, приглашения закрыты', 'danger', 'no_accounts'],
      ['Хранилище заполнено на 102%: 102 из 100 ГБ', 'danger', 'storage'],
      ['Никто не входил 9 дн.', 'warn', 'bedtime'],
    ]);
  });

  it('конец пробного периода не загружен — «—»', () => {
    const rows = signalRows(usage, new Map());
    expect(rows[3]?.text).toBe('Ограничен: пробный период закончился —, оплаты нет');
  });
});

describe('«Отраслевые модули» (usageVM :3793–3796)', () => {
  it('три модуля каталога с долей, местами и файлами; не подключённый — «Пока не подключён ни у кого»', () => {
    expect(moduleCards(usage)).toEqual([
      {
        key: 'fleet',
        name: 'Логистика',
        icon: 'local_shipping',
        n: '1 из 4',
        percent: 25,
        seats: 'мест: 22 · файлов: 63 ГБ',
        orgs: [{ tenantId: ids['Карго Сити'], name: 'Карго Сити' }],
      },
      {
        key: 'spa',
        name: 'Салон и SPA',
        icon: 'spa',
        n: '2 из 4',
        percent: 50,
        seats: 'мест: 32 · файлов: 58,6 ГБ',
        orgs: [
          { tenantId: ids['Альта Групп'], name: 'Альта Групп' },
          { tenantId: ids['SPA «Лотос»'], name: 'SPA «Лотос»' },
        ],
      },
      {
        key: 'repairs',
        name: 'Ремонт и стройка',
        icon: 'construction',
        n: '1 из 4',
        percent: 25,
        seats: 'мест: 5 · файлов: 19,8 ГБ',
        orgs: [{ tenantId: ids['Ремстрой Плюс'], name: 'Ремстрой Плюс' }],
      },
    ]);
    const none = moduleCards({ ...usage, modules: [] });
    expect(none.map((m) => [m.n, m.seats, m.orgs.length])).toEqual([
      ['0 из 4', 'Пока не подключён ни у кого', 0],
      ['0 из 4', 'Пока не подключён ни у кого', 0],
      ['0 из 4', 'Пока не подключён ни у кого', 0],
    ]);
  });
});

describe('«По организациям» (usageVM :3779–3803)', () => {
  it('строки: тариф, места и хранилище с полосой, модули, входы и последний вход', () => {
    const rows = tableRows(usage);
    const lotos = rows.find((r) => r.name === 'SPA «Лотос»');
    expect(lotos).toMatchObject({
      tier: 'Команда',
      seats: '23 из 25',
      seatsTone: 'warn',
      storage: '12,4 из 50 ГБ',
      storageTone: 'accent',
      modules: 'Салон и SPA',
      act: '12 из 23',
      last: 'последний вход сегодня',
      lastLate: false,
    });
    expect(lotos?.chip.label).toBe('Действует');
    const cargo = rows.find((r) => r.name === 'Карго Сити');
    expect(cargo).toMatchObject({
      act: '0 из 22',
      last: 'последний вход 13 дн. назад',
      lastLate: true,
    });
    expect(rows.find((r) => r.name === 'Ремстрой Плюс')?.storagePercent).toBeCloseTo(79.2, 1);
  });

  it('сортировки: по местам, хранилищу, активности, названию (ru)', () => {
    const rows = tableRows(usage);
    const names = (k: Parameters<typeof sortRows>[1]) => sortRows(rows, k).map((r) => r.name);
    expect(names('seats')).toEqual(['SPA «Лотос»', 'Альта Групп', 'Карго Сити', 'Ремстрой Плюс']);
    expect(names('storage')).toEqual(['Ремстрой Плюс', 'Карго Сити', 'Альта Групп', 'SPA «Лотос»']);
    expect(names('activity')[0]).toBe('Альта Групп');
    expect(names('name')).toEqual(['Альта Групп', 'Карго Сити', 'Ремстрой Плюс', 'SPA «Лотос»']);
  });

  it('без лимита мест — только число, без входов — «входов нет», модулей нет — «—»', () => {
    const t = usage.tenants[0];
    if (!t) throw new Error('сид');
    const { lastSignInAt: _skip, ...rest } = t;
    const u: Usage = {
      ...usage,
      tenants: [
        {
          ...rest,
          seats: { limit: null, used: 120, active: 120, invited: 0, available: null },
          moduleKeys: [],
          activeMembers: 0,
          activeMembers7d: 0,
        },
      ],
    };
    expect(_skip).toBeDefined();
    expect(tableRows(u)[0]).toMatchObject({
      seats: '120',
      seatsPercent: 0,
      modules: '—',
      act: '0 из 0',
      last: 'входов нет',
      lastLate: false,
    });
  });
});
