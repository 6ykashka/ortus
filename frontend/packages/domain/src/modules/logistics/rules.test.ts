// Правила логистики (models.js 14.10:322–389). Ожидания — WS-05 §6б `fleet.test` и 03 §16 п.4.
import { describe, expect, it } from 'vitest';
import { compat, inspMissing, legs, odoError, tempLabel, validateExpense } from './rules.ts';
import type { InspectionDraft, Trip, Vehicle } from './types.ts';

const NBSP = ' ';

const veh = (x: Partial<Vehicle> & Pick<Vehicle, 'id'>): Vehicle => ({
  unit: 'f-msk-sever',
  model: '',
  plate: '',
  body: 'Тент',
  payloadT: 1.5,
  volumeM3: 16,
  lengthM: 4.2,
  temp: null,
  odometer: 84370,
  state: 'free',
  depot: 'Склад № 1',
  ...x,
});

const V1 = veh({ id: 'v1', model: 'ГАЗель Next' });
const V2 = veh({ id: 'v2', payloadT: 1.2, volumeM3: 11, lengthM: 3.4, temp: [-18, 8] });
const V3 = veh({ id: 'v3', payloadT: 0.9, volumeM3: 9, lengthM: 3.1 });
const V4 = veh({
  id: 'v4',
  payloadT: 4.5,
  volumeM3: 30,
  lengthM: 5.1,
  state: 'unavailable',
  note: 'Плановое ТО до 03.10',
});

const trip = (x: Partial<Trip> & Pick<Trip, 'id' | 'cargo' | 'stops'>): Trip => ({
  unit: 'f-msk-sever',
  title: '',
  date: '01.10.2026',
  window: '',
  distanceKm: 0,
  driverId: null,
  driverName: null,
  vehicleId: null,
  status: 'planned',
  dep: null,
  ret: null,
  expenses: [],
  review: null,
  defect: null,
  ...x,
});

const R208 = trip({
  id: 'Р-208',
  cargo: { weightT: 1.1, volumeM3: 12, lengthM: 3.0, temp: null, kind: 'Сухой груз' },
  stops: [
    { time: '09:00', name: 'Склад № 1, Лобня', op: 'load', w: 1.1, v: 12 },
    { time: '10:15', name: 'Химки', op: 'unload', w: 0.7, v: 8 },
    { time: '11:30', name: 'Долгопрудный', op: 'unload', w: 0.4, v: 4 },
  ],
});
const R211 = trip({
  id: 'Р-211',
  cargo: { weightT: 0.6, volumeM3: 7, lengthM: 2.4, temp: [2, 6], kind: 'Молочная продукция' },
  stops: [{ time: '14:00', name: 'Склад № 1, Лобня', op: 'load', w: 0.6, v: 7 }],
});

describe('compat: совместимость машины с грузом рейса', () => {
  it('ГАЗель Next подходит Р-208', () => {
    const r = compat(V1, R208);
    expect(r).toMatchObject({ fit: true, ok: true, reasons: [] });
    expect(r.checks.map((c) => c.key)).toEqual(['avail', 'payload', 'volume', 'length', 'temp']);
    expect(r.checks[1]).toMatchObject({ value: '1,5 т', need: 'от 1,1 т' });
    expect(r.checks[4]).toMatchObject({ ok: true, value: 'не требуется' });
    expect(r.checks[0]).toMatchObject({ value: 'Свободна', icon: 'check_circle' });
  });

  it('Hyundai Porter не подходит Р-208: грузоподъёмность и объём', () => {
    expect(compat(V3, R208)).toMatchObject({
      fit: false,
      ok: false,
      reasons: ['Грузоподъёмность: 0,9 т, нужно от 1,1 т', 'Объём: 9 м³, нужно от 12 м³'],
    });
  });

  it('ГАЗон Next подходит, но недоступен', () => {
    expect(compat(V4, R208)).toMatchObject({
      fit: true,
      ok: false,
      reasons: ['Доступность: Недоступна · Плановое ТО до 03.10'],
    });
  });

  it('рефрижератор подходит охлаждённому грузу, тент — нет', () => {
    const r = compat(V2, R211);
    expect(r.ok).toBe(true);
    expect(r.checks[4]).toMatchObject({ value: '-18…+8 °C', need: '+2…+6 °C' });
    expect(compat(V1, R211).reasons).toEqual(['Температура: без охлаждения, нужно +2…+6 °C']);
    expect(compat(V2, R208).fit).toBe(false);
  });

  it('машина, забронированная за этим рейсом, доступна', () => {
    const r = compat({ ...V1, state: 'reserved', heldBy: 'Р-208' }, R208);
    expect(r.checks[0]?.value).toBe('Назначена на этот рейс');
    expect(r.ok).toBe(true);
    expect(compat({ ...V1, state: 'reserved', heldBy: 'Р-211' }, R208).ok).toBe(false);
  });
});

describe('tempLabel', () => {
  it.each([
    [[-18, 8], '-18…+8 °C'],
    [[2, 6], '+2…+6 °C'],
    [[0, 4], '0…+4 °C'],
  ] as const)('%j → %s', (t, want) => {
    expect(tempLabel(t)).toBe(want);
  });
});

describe('legs: загрузка после каждой остановки', () => {
  it('с машиной — проценты массы и объёма', () => {
    expect(
      legs(R208, V1).map(({ wAfter, vAfter, wPct, vPct }) => ({ wAfter, vAfter, wPct, vPct })),
    ).toEqual([
      { wAfter: 1.1, vAfter: 12, wPct: 73, vPct: 75 },
      { wAfter: 0.4, vAfter: 4, wPct: 27, vPct: 25 },
      { wAfter: 0, vAfter: 0, wPct: 0, vPct: 0 },
    ]);
  });

  it('без машины проценты не считаются; остановка сохраняет свои поля', () => {
    const l = legs(R208);
    expect(l.every((x) => x.wPct === null && x.vPct === null)).toBe(true);
    expect(l[1]).toMatchObject({ time: '10:15', op: 'unload', w: 0.7 });
  });

  it('разгрузка больше загрузки не уводит в минус', () => {
    const t = trip({
      id: 'x',
      cargo: R208.cargo,
      stops: [{ time: '', name: '', op: 'unload', w: 1, v: 1 }],
    });
    expect(legs(t, V1)[0]).toMatchObject({ wAfter: 0, vAfter: 0 });
  });
});

const ready = { state: 'ready' } as const;
const draft = (x: Partial<InspectionDraft> = {}): InspectionDraft => ({
  photos: {},
  odometer: '',
  fuel: null,
  checks: {},
  ...x,
});

describe('inspMissing: чего не хватает в осмотре', () => {
  it('пустой осмотр выезда', () => {
    expect(inspMissing(draft(), 'dep', 84370)).toEqual([
      '5 фото',
      'пробег',
      'уровень топлива',
      '3 пункта чек-листа',
    ]);
  });

  it('пять фото, пробег с пробелом, топливо и один пункт — осталось два пункта', () => {
    const photos = { front: ready, back: ready, left: ready, right: ready, odo: ready };
    expect(
      inspMissing(
        draft({ photos, odometer: '84 400', fuel: 'h', checks: { body: true } }),
        'dep',
        84370,
      ),
    ).toEqual(['2 пункта чек-листа']);
  });

  it('пробег меньше начального', () => {
    expect(inspMissing(draft({ odometer: '84000' }), 'dep', 84370)).toContain(
      'пробег не меньше 84' + NBSP + '370 км',
    );
    expect(inspMissing(draft({ odometer: 'abc' }), 'dep', 84370)).toContain('пробег');
  });

  it('фото в очереди отправки считаются; четыре готовых — не хватает одного', () => {
    const four = { front: ready, back: ready, left: ready, right: ready };
    const m1 = inspMissing(draft({ photos: { ...four, odo: { state: 'queued' } } }), 'dep', 0);
    expect(m1.some((x) => x.includes('фото'))).toBe(false);
    expect(inspMissing(draft({ photos: four }), 'dep', 0)[0]).toBe('1 фото');
  });

  it('сдача проверяет свой чек-лист', () => {
    const r = inspMissing(draft({ checks: { body: true, cargo: true } }), 'ret', 0);
    expect(r).toContain('2 пункта чек-листа');
    expect(
      inspMissing(draft({ checks: { cargo: true, personal: true, keys: true } }), 'ret', 0),
    ).not.toContain('1 пункт чек-листа');
    expect(inspMissing(draft({ checks: { cargo: true, personal: true } }), 'ret', 0)).toContain(
      '1 пункт чек-листа',
    );
  });
});

describe('odoError: проверка пробега', () => {
  it.each([
    ['', null],
    ['abc', 'Введите число'],
    ['84000', 'Пробег не может быть меньше 84' + NBSP + '370 км'],
    ['90000', 'Больше начального на 5' + NBSP + '630 км — проверьте показания'],
    ['84 500', null],
    ['87370', null],
    ['87371', 'Больше начального на 3' + NBSP + '001 км — проверьте показания'],
  ])('«%s» → %s', (value, want) => {
    expect(odoError(value, 84370)).toBe(want);
  });
});

describe('validateExpense: проверка расхода', () => {
  it.each([
    [{ amount: '', date: '2026-10-01', receipt: ready }, { amount: 'Укажите сумму' }],
    [{ amount: null, date: '2026-10-01', receipt: ready }, { amount: 'Укажите сумму' }],
    [{ amount: '1 500,50', date: '2026-10-01', receipt: { state: 'queued' as const } }, {}],
    [
      { amount: '0', date: '', receipt: { state: 'empty' as const } },
      {
        amount: 'Сумма должна быть больше нуля',
        date: 'Укажите дату',
        receipt: 'Добавьте фото чека',
      },
    ],
    [{ amount: '-500', date: 'x', receipt: ready }, { amount: 'Сумма должна быть больше нуля' }],
    [
      { amount: '250000', date: 'x', receipt: ready },
      { amount: 'Больше 200 000 ₽ — проверьте сумму' },
    ],
    [{ amount: 'abc', date: 'x', receipt: ready }, { amount: 'Сумма должна быть числом' }],
    [
      { amount: '100', date: 'x', receipt: { state: 'uploading' as const } },
      { receipt: 'Дождитесь окончания загрузки чека' },
    ],
    [{ amount: '100', date: 'x' }, { receipt: 'Добавьте фото чека' }],
  ])('%j', (e, want) => {
    expect(validateExpense(e)).toEqual(want);
  });
});
