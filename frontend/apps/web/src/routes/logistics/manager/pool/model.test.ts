// W2.23 · Модель «Ресурсного пула» (poolVM :3300–3319, модалка request :4026–4028; 03-logistics.md §6): рейс запроса,
// окна и срок запроса (пересечение окна рейса и свободного окна, Q-W2.51-10), слияние каталога с исходящими запросами
// (чипы и тексты эталона), тело requestDriverTransfer, входящие запросы фирмы-источника (Q-W2.51-2).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  cards,
  incomingRows,
  intersect,
  latestByPublication,
  periodText,
  pickTrip,
  reasonOf,
  requestBody,
  requestTrips,
  sortByLabel,
  tripLabel,
  untilText,
  windowText,
} from './model.ts';

type S = components['schemas'];

const MSK = 'Europe/Moscow';
const SEVER = 'unit-sever';
const YUG = 'unit-yug';
const VOSTOK = 'unit-vostok';

const w = (from: string, to: string): S['TimeWindow'] => ({
  startsAt: `2026-10-01T${from}:00Z`,
  endsAt: `2026-10-01T${to}:00Z`,
  timeZone: MSK,
});

/** Р-211 «Охлаждённая продукция», 14:00–18:00 по Москве (11:00–15:00 UTC). */
const trip = (o: Partial<S['TripPlan']> = {}): S['TripPlan'] => ({
  id: 'trip-211',
  number: 'Р-211',
  title: 'Охлаждённая продукция',
  orgUnitId: SEVER,
  state: 'planned',
  plannedWindow: w('11:00', '15:00'),
  cargo: { description: 'Охлаждённая продукция', weightKg: '800', volumeM3: '9', lengthM: '3' },
  stops: [],
  revision: 1,
  ...o,
});

const r208 = (o: Partial<S['TripPlan']> = {}): S['TripPlan'] =>
  trip({
    id: 'trip-208',
    number: 'Р-208',
    title: 'Северный маршрут',
    plannedWindow: w('06:00', '10:00'),
    driverMemberId: 'm-vasiliev',
    driverDisplayName: 'Илья Васильев',
    ...o,
  });

/** Водитель #104 «Юг Транс» 13:00–19:00 и #117 «Восток Карго» 15:00–20:00 (mock-data.js:224–225). */
const d104: S['DriverAvailability'] = {
  driverMemberId: 'd-104',
  displayName: 'Водитель #104',
  homeOrgUnitId: YUG,
  qualifications: ['Кат. C', 'рефрижератор'],
  freeWindow: w('10:00', '16:00'),
  terms: 'По соглашению фирм группы',
  publicationId: 'pub-104',
  homeOrgUnitName: 'Юг Транс',
};
const d117: S['DriverAvailability'] = {
  driverMemberId: 'd-117',
  displayName: 'Водитель #117',
  homeOrgUnitId: VOSTOK,
  qualifications: ['Кат. B'],
  freeWindow: w('12:00', '17:00'),
  terms: 'По соглашению фирм группы',
  publicationId: 'pub-117',
  homeOrgUnitName: 'Восток Карго',
};

const transfer = (o: Partial<S['DriverTransfer']> = {}): S['DriverTransfer'] => ({
  id: 'tr-1',
  driverMemberId: 'd-104',
  sourceOrgUnitId: YUG,
  targetOrgUnitId: SEVER,
  window: w('11:00', '15:00'),
  status: 'requested',
  revision: 1,
  tripId: 'trip-211',
  publicationId: 'pub-104',
  driverDisplayName: 'Водитель #104',
  sourceOrgUnitName: 'Юг Транс',
  targetOrgUnitName: 'Север Логистик',
  tripNumber: 'Р-211',
  reason: 'Запрос на рейс Р-211',
  requestedAt: '2026-10-01T07:40:00Z',
  ...o,
});

describe('окна и срок', () => {
  it('окно в часовом поясе: «13:00–19:00»; через полночь — с датами', () => {
    expect(windowText(d104.freeWindow)).toBe('13:00–19:00');
    expect(
      windowText({
        startsAt: '2026-10-01T19:00:00Z',
        endsAt: '2026-10-02T03:00:00Z',
        timeZone: MSK,
      }),
    ).toBe('01.10 22:00 – 02.10 06:00');
  });

  it('пересечение окон: позднее начало и раннее окончание; без пересечения — null', () => {
    expect(intersect(trip().plannedWindow, d104.freeWindow)).toEqual(w('11:00', '15:00'));
    expect(intersect(trip().plannedWindow, d117.freeWindow)).toEqual(w('12:00', '15:00'));
    expect(intersect(trip().plannedWindow, w('15:00', '17:00'))).toBeNull();
  });

  it('«до 18:00 01.10» (q.until эталона)', () => {
    expect(untilText('2026-10-01T15:00:00Z', MSK)).toBe('18:00 01.10');
  });

  it('срок запроса: «Временно, до 18:00 01.10» (:4027); позже начала рейса — «с 15:00»', () => {
    const t = trip();
    expect(periodText(t.plannedWindow, w('11:00', '15:00'))).toBe('Временно, до 18:00 01.10');
    expect(periodText(t.plannedWindow, w('12:00', '15:00'))).toBe(
      'Временно, с 15:00 до 18:00 01.10',
    );
  });

  it('рейс в диалоге: «Р-211 · Охлаждённая продукция · 14:00–18:00» (:2816)', () => {
    expect(tripLabel(trip())).toBe('Р-211 · Охлаждённая продукция · 14:00–18:00');
  });
});

describe('рейс запроса', () => {
  const may = () => true;

  it('?trip= — этот рейс, если он виден', () => {
    expect(pickTrip([trip(), r208()], [], 'trip-208')?.number).toBe('Р-208');
    expect(pickTrip([trip(), r208()], [], 'нет-такого')?.number).toBe('Р-211');
  });

  it('иначе — первый по началу окна рейс без водителя, не начатый (эталон — Р-211)', () => {
    const early = trip({ id: 'trip-212', number: 'Р-212', plannedWindow: w('08:00', '09:00') });
    expect(pickTrip([trip(), r208(), early], [], null)?.number).toBe('Р-212');
    expect(pickTrip([trip({ state: 'on_route' }), r208()], [], null)).toBeNull();
  });

  it('у рейса появился временный водитель (одобрено) — рейс остаётся рейсом запроса', () => {
    const t = trip({ driverMemberId: 'd-104', driverDisplayName: 'Водитель #104 · временно' });
    expect(pickTrip([t, r208()], [transfer({ status: 'approved' })], null)?.number).toBe('Р-211');
    expect(pickTrip([t, r208()], [], null)).toBeNull();
  });

  it('рейсы для выбора: не начатые без водителя с правом запроса, по началу окна', () => {
    const other = trip({ id: 'trip-yug', number: 'Р-300', orgUnitId: YUG });
    const list = requestTrips([trip(), r208(), other], (unit) => unit === SEVER);
    expect(list.map((t) => t.number)).toEqual(['Р-211']);
    expect(requestTrips([trip(), r208(), other], may).map((t) => t.number)).toEqual([
      'Р-211',
      'Р-300',
    ]);
  });
});

describe('карточки водителей', () => {
  const base = { trip: trip(), mayRequest: true };

  it('свободные (:3307–3311): псевдоним, «{квалификации} · {фирма}», «Свободен», условия, запрос', () => {
    const [a, b] = cards({ ...base, catalog: [d104, d117], outgoing: [] });
    expect(a).toMatchObject({
      code: 'Водитель #104',
      sub: 'Кат. C · рефрижератор · Юг Транс',
      chip: { label: 'Свободен', tone: 'ok', icon: 'check_circle' },
      status: 'free',
      canRequest: true,
      rows: [
        { term: 'Свободен', value: '13:00–19:00' },
        { term: 'Условия', value: 'По соглашению фирм группы' },
      ],
    });
    expect(b?.code).toBe('Водитель #117');
    expect(b?.canRequest).toBe(true);
  });

  it('запрос отправлен: чип warn, «Ожидает решения менеджера фирмы Юг Транс…», без запроса', () => {
    const [a, b] = cards({ ...base, catalog: [d104, d117], outgoing: [transfer()] });
    expect(a).toMatchObject({
      chip: { label: 'Запрос отправлен', tone: 'warn', icon: 'schedule' },
      status: 'requested',
      canRequest: false,
      pendingText: 'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    });
    expect(b?.canRequest).toBe(true);
  });

  it('одобрен: водитель ушёл из каталога — карточка по запросу; у остальных запроса нет (busy)', () => {
    const approved = transfer({
      status: 'approved',
      grant: {
        assignmentId: 'as-1',
        orgUnitId: SEVER,
        tripId: 'trip-211',
        validFrom: '2026-10-01T11:00:00Z',
        validUntil: '2026-10-01T15:00:00Z',
        state: 'scheduled',
      },
    });
    const t = trip({ driverMemberId: 'd-104' });
    const list = cards({ trip: t, mayRequest: true, catalog: [d117], outgoing: [approved] });
    expect(list.map((c) => c.code)).toEqual(['Водитель #104', 'Водитель #117']);
    expect(list[0]).toMatchObject({
      sub: 'Юг Транс',
      chip: { label: 'Временно назначен', tone: 'ok', icon: 'verified' },
      status: 'approved',
      canRequest: false,
      rows: [{ term: 'Срок', value: '14:00–18:00' }],
      approvedText:
        'Водитель #104 назначен на рейс Р-211 до 18:00 01.10. Доступ ограничен этим рейсом; история и начисления остаются в фирме Юг Транс.',
    });
    expect(list[1]?.canRequest).toBe(false);
  });

  it('отклонён: чип neutral «Отклонён», текст, запрос снова доступен', () => {
    const [a] = cards({
      ...base,
      catalog: [d104],
      outgoing: [transfer({ status: 'rejected' })],
    });
    expect(a).toMatchObject({
      chip: { label: 'Отклонён', tone: 'neutral', icon: 'block' },
      status: 'rejected',
      declined: true,
      canRequest: true,
    });
  });

  it('последний запрос по публикации задаёт состояние; отклонённый без каталога — карточки нет', () => {
    const older = transfer({ id: 'tr-0', status: 'rejected', requestedAt: '2026-10-01T07:00:00Z' });
    const latest = latestByPublication([transfer(), older]);
    expect(latest.get('pub-104')?.id).toBe('tr-1');
    expect(cards({ ...base, catalog: [], outgoing: [older] })).toEqual([]);
  });

  // Открытый запрос у публикации один на любой рейс (driver_transfers_open_uq, MSW pool.ts, конформанс cases/pool.ts:
  // второй открытый запрос — 409 «Запрос уже отправлен»): он блокирует «Запросить» на любом рейсе. Одобренный и
  // отклонённый запросы другого рейса состояние выбранного не задают (Q-W2.23-1, возврат 2).
  const other = transfer({ id: 'tr-9', tripId: 'trip-300', tripNumber: 'Р-300' });

  it('открытый запрос на другой рейс: «Запрос отправлен», «Ожидает решения…», запроса нет (Q-W2.23-1)', () => {
    const [a] = cards({ ...base, catalog: [d104], outgoing: [other] });
    expect(a).toMatchObject({
      chip: { label: 'Запрос отправлен', tone: 'warn', icon: 'schedule' },
      status: 'requested',
      canRequest: false,
      declined: false,
      pendingText: 'Ожидает решения менеджера фирмы Юг Транс. Доступа к водителю пока нет.',
    });
    // Открытый запрос другого рейса важнее более раннего отклонения на выбранном рейсе.
    const rejected = transfer({ status: 'rejected', requestedAt: '2026-10-01T07:00:00Z' });
    const later = transfer({ ...other, requestedAt: '2026-10-01T08:00:00Z' });
    expect(cards({ ...base, catalog: [d104], outgoing: [rejected, later] })[0]).toMatchObject({
      status: 'requested',
      canRequest: false,
    });
    // Водителя нет в каталоге на окно выбранного рейса — карточка по открытому запросу, без запроса.
    expect(cards({ ...base, catalog: [], outgoing: [other] })).toMatchObject([
      { code: 'Водитель #104', status: 'requested', canRequest: false },
    ]);
  });

  it('одобренный и отклонённый запросы другого рейса не задают состояние выбранного (Q-W2.23-1)', () => {
    for (const status of ['approved', 'rejected'] as const) {
      const [a] = cards({ ...base, catalog: [d104], outgoing: [transfer({ ...other, status })] });
      expect(a).toMatchObject({
        chip: { label: 'Свободен', tone: 'ok', icon: 'check_circle' },
        status: 'free',
        canRequest: true,
        declined: false,
      });
      expect(a?.pendingText).toBeUndefined();
      expect(a?.approvedText).toBeUndefined();
    }
    // Запрос выбранного рейса задаёт состояние, даже если решённый запрос другого рейса позже.
    const later = transfer({ ...other, status: 'rejected', requestedAt: '2026-10-01T08:00:00Z' });
    expect(cards({ ...base, catalog: [d104], outgoing: [transfer(), later] })[0]?.status).toBe(
      'requested',
    );
    // Карточки по одобренному запросу другого рейса нет (временный водитель — не этого рейса).
    expect(
      cards({ ...base, catalog: [], outgoing: [transfer({ ...other, status: 'approved' })] }),
    ).toEqual([]);
    // Запрос без рейса — по публикации, как раньше.
    const noTrip = transfer({ status: 'rejected' });
    delete noTrip.tripId;
    expect(cards({ ...base, catalog: [d104], outgoing: [noTrip] })[0]?.status).toBe('rejected');
  });

  it('запрос недоступен: нет права или только чтение; у рейса водитель; окна не пересекаются', () => {
    expect(
      cards({ ...base, mayRequest: false, catalog: [d104], outgoing: [] })[0]?.canRequest,
    ).toBe(false);
    expect(
      cards({
        trip: trip({ driverMemberId: 'm-x' }),
        mayRequest: true,
        catalog: [d104],
        outgoing: [],
      })[0]?.canRequest,
    ).toBe(false);
    const late = { ...d117, freeWindow: w('15:00', '17:00') };
    expect(cards({ ...base, catalog: [late], outgoing: [] })[0]?.canRequest).toBe(false);
    expect(
      cards({ trip: null, mayRequest: true, catalog: [d104], outgoing: [] })[0]?.canRequest,
    ).toBe(false);
  });

  it('порядок — по номеру псевдонима (#104 раньше #117, как сид эталона)', () => {
    expect(
      sortByLabel([{ code: 'Водитель #117' }, { code: 'Водитель #104' }, { code: 'Водитель #9' }]),
    ).toEqual([{ code: 'Водитель #9' }, { code: 'Водитель #104' }, { code: 'Водитель #117' }]);
  });
});

describe('запрос', () => {
  it('reason: комментарий или «Запрос на рейс {номер}» (Q-W2.00-3)', () => {
    expect(reasonOf('  Нужен рефрижератор  ', trip())).toBe('Нужен рефрижератор');
    expect(reasonOf('   ', trip())).toBe('Запрос на рейс Р-211');
  });

  it('тело requestDriverTransfer: публикация карточки, рейс, окно — пересечение', () => {
    const [c] = cards({ trip: trip(), mayRequest: true, catalog: [d117], outgoing: [] });
    if (!c) throw new Error('нет карточки');
    expect(requestBody(c, trip(), '')).toEqual({
      driverMemberId: 'd-117',
      sourceOrgUnitId: VOSTOK,
      targetOrgUnitId: SEVER,
      window: w('12:00', '15:00'),
      reason: 'Запрос на рейс Р-211',
      tripId: 'trip-211',
      publicationId: 'pub-117',
    });
  });
});

describe('входящие запросы', () => {
  it('строка: псевдоним, «{фирма} · рейс {номер}», срок с датой, комментарий запроса', () => {
    const [r] = incomingRows([
      transfer({ reason: 'Нужен на вечер' }),
      transfer({ id: 'tr-2', status: 'approved' }),
    ]);
    expect(incomingRows([transfer(), transfer({ id: 'tr-2', status: 'approved' })])).toHaveLength(
      1,
    );
    expect(r).toMatchObject({
      id: 'tr-1',
      code: 'Водитель #104',
      line: 'Север Логистик · рейс Р-211',
      period: '01.10.2026 · 14:00–18:00',
      reason: 'Нужен на вечер',
      source: 'Юг Транс',
    });
  });
});
