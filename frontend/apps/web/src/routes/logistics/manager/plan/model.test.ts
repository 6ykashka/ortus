// W2.20 · Модель формы «Планирование рейса» (S2-13, no-reference): черновик → TripPlanCreate (т → кг, Москва → UTC,
// точные Quantity), проверки полей до отправки, загрузка по участкам (legs домена: масса и объём раздельно,
// выгрузка не больше, чем в кузове — как проверяет сервер, 14-stage2-dor §3 п. 7), ошибки сервера по полям.
import { describe, expect, it } from 'vitest';

import {
  addStop,
  draftLegs,
  driverOptions,
  emptyDraft,
  type PlanDraft,
  removeStop,
  serverErrors,
  todayIn,
  toCreate,
  validate,
  zonedIso,
} from './model.ts';

const MSK = 'Europe/Moscow';

/** «Вечерний развоз»: 0,8 т и 6 м³ — погрузка в Лобне, выгрузка в Химках. */
const filled = (): PlanDraft => ({
  ...emptyDraft({ unitId: 'u-sever', date: '2026-10-01' }),
  title: ' Вечерний развоз ',
  from: '18:00',
  to: '21:00',
  cargo: 'Сухой груз · 4 паллеты',
  mass: '0,8',
  volume: '6',
  length: '2,5',
  distance: '24',
  driverId: 'm-1',
  stops: [
    { op: 'load', address: 'Склад № 1, Лобня', time: '18:00', mass: '0,8', volume: '6' },
    { op: 'unload', address: 'Химки, ул. Заводская, 8', time: '19:00', mass: '0,8', volume: '6' },
  ],
});

describe('черновик', () => {
  it('пустой: подразделение и дата по умолчанию, две точки — погрузка и выгрузка', () => {
    const d = emptyDraft({ unitId: 'u-sever', date: '2026-10-01' });
    expect(d).toMatchObject({
      unitId: 'u-sever',
      date: '2026-10-01',
      title: '',
      temp: false,
      driverId: '',
    });
    expect(d.stops.map((s) => s.op)).toEqual(['load', 'unload']);
  });

  it('«Добавить точку» — выгрузка в конец; «Удалить точку» — по номеру', () => {
    const d = addStop(emptyDraft({ unitId: 'u', date: '2026-10-01' }));
    expect(d.stops.map((s) => s.op)).toEqual(['load', 'unload', 'unload']);
    expect(removeStop(d, 1).stops).toHaveLength(2);
  });

  it('сегодня в часовом поясе организации: 1 октября 2026 (часы e2e — 10:30 МСК)', () => {
    expect(todayIn(new Date('2026-10-01T07:30:00Z'), MSK)).toBe('2026-10-01');
    expect(todayIn(new Date('2026-09-30T22:30:00Z'), MSK)).toBe('2026-10-01');
  });
});

describe('проверки до отправки', () => {
  it('заполненная форма — без ошибок', () => {
    expect(validate(filled())).toEqual({});
  });

  it('пустая форма: название, груз, масса, объём, длина, время, адреса точек', () => {
    const e = validate(emptyDraft({ unitId: 'u', date: '2026-10-01' }));
    expect(e).toMatchObject({
      title: 'Укажите название рейса',
      from: 'Укажите время в формате ЧЧ:ММ',
      to: 'Укажите время в формате ЧЧ:ММ',
      cargo: 'Опишите груз',
      mass: 'Введите число больше нуля',
      volume: 'Введите число больше нуля',
      length: 'Введите число больше нуля',
      'stops[0].address': 'Укажите адрес',
      'stops[1].address': 'Укажите адрес',
      'stops[0].mass': 'Введите число не меньше нуля',
    });
    expect(validate({ ...filled(), unitId: '', date: '' })).toMatchObject({
      unit: 'Выберите подразделение',
      date: 'Укажите дату',
    });
  });

  it('окно: окончание не позже начала — ошибка у «Окончание»', () => {
    expect(validate({ ...filled(), to: '17:00' })).toEqual({
      to: 'Окончание должно быть позже начала',
    });
    expect(validate({ ...filled(), from: '25:00' })).toEqual({
      from: 'Укажите время в формате ЧЧ:ММ',
    });
  });

  it('время точки необязательно, но в формате ЧЧ:ММ', () => {
    const d = filled();
    d.stops[1] = { ...(d.stops[1] as PlanDraft['stops'][number]), time: '' };
    expect(validate(d)).toEqual({});
    d.stops[1] = { ...(d.stops[1] as PlanDraft['stops'][number]), time: '7' };
    expect(validate(d)).toEqual({ 'stops[1].time': 'Укажите время в формате ЧЧ:ММ' });
  });

  it('температурный режим: обе границы и нижняя не выше верхней', () => {
    expect(validate({ ...filled(), temp: true })).toMatchObject({
      tempMin: 'Укажите обе границы температуры',
    });
    expect(validate({ ...filled(), temp: true, tempMin: '6', tempMax: '2' })).toEqual({
      tempMax: 'Нижняя граница выше верхней',
    });
    expect(validate({ ...filled(), temp: true, tempMin: '-2', tempMax: '+6' })).toEqual({});
  });

  it('выгрузка больше, чем в кузове: ошибка у массы и (или) объёма точки', () => {
    const d = filled();
    d.stops[1] = { ...(d.stops[1] as PlanDraft['stops'][number]), mass: '1' };
    expect(validate(d)).toEqual({
      'stops[1].mass': 'Выгрузка больше, чем в кузове после предыдущей точки',
    });
    d.stops[1] = { ...(d.stops[1] as PlanDraft['stops'][number]), volume: '7' };
    expect(validate(d)).toMatchObject({
      'stops[1].volume': 'Выгрузка больше, чем в кузове после предыдущей точки',
    });
  });

  it('расстояние необязательно; если указано — число не меньше нуля', () => {
    expect(validate({ ...filled(), distance: '' })).toEqual({});
    expect(validate({ ...filled(), distance: 'abc' })).toEqual({
      distance: 'Введите число не меньше нуля',
    });
  });
});

describe('загрузка по участкам', () => {
  it('после каждой точки: «Погрузка +6 м³ · 0,8 т», в кузове 6 м³ · 0,8 т, затем 0 м³ · 0 т', () => {
    expect(draftLegs(filled())).toEqual([
      {
        n: 1,
        name: 'Склад № 1, Лобня',
        op: 'Погрузка +6 м³ · 0,8 т',
        after: 'В кузове после точки: 6 м³ · 0,8 т',
      },
      {
        n: 2,
        name: 'Химки, ул. Заводская, 8',
        op: 'Выгрузка −6 м³ · 0,8 т',
        after: 'В кузове после точки: 0 м³ · 0 т',
      },
    ]);
  });

  it('недозаполненные числа считаются нулём', () => {
    const d = emptyDraft({ unitId: 'u', date: '2026-10-01' });
    expect(draftLegs(d)[0]?.after).toBe('В кузове после точки: 0 м³ · 0 т');
  });
});

describe('TripPlanCreate', () => {
  it('Москва → UTC: 18:00 МСК 1 октября — 15:00Z', () => {
    expect(zonedIso('2026-10-01', '18:00', MSK)).toBe('2026-10-01T15:00:00Z');
    expect(zonedIso('2026-10-01', '01:30', MSK)).toBe('2026-09-30T22:30:00Z');
  });

  it('тело команды: кг, точные Quantity, окно и время точек, водитель, без температуры', () => {
    expect(toCreate(filled(), MSK)).toEqual({
      orgUnitId: 'u-sever',
      title: 'Вечерний развоз',
      plannedWindow: {
        startsAt: '2026-10-01T15:00:00Z',
        endsAt: '2026-10-01T18:00:00Z',
        timeZone: MSK,
      },
      distanceKm: '24',
      cargo: {
        description: 'Сухой груз · 4 паллеты',
        weightKg: '800',
        volumeM3: '6',
        lengthM: '2.5',
      },
      stops: [
        {
          sequence: 1,
          op: 'load',
          address: 'Склад № 1, Лобня',
          plannedAt: '2026-10-01T15:00:00Z',
          weightKg: '800',
          volumeM3: '6',
        },
        {
          sequence: 2,
          op: 'unload',
          address: 'Химки, ул. Заводская, 8',
          plannedAt: '2026-10-01T16:00:00Z',
          weightKg: '800',
          volumeM3: '6',
        },
      ],
      driverMemberId: 'm-1',
    });
  });

  it('с температурой, без водителя, расстояния и времени точки', () => {
    const d = { ...filled(), temp: true, tempMin: '+2', tempMax: '6', driverId: '', distance: '' };
    d.stops[1] = { ...(d.stops[1] as PlanDraft['stops'][number]), time: '' };
    const b = toCreate(d, MSK);
    expect(b.cargo).toMatchObject({ temperatureMinC: '2', temperatureMaxC: '6' });
    expect(b).not.toHaveProperty('driverMemberId');
    expect(b).not.toHaveProperty('distanceKm');
    expect(b.stops[1]).not.toHaveProperty('plannedAt');
  });

  it('дробные: 1,25 т → 1250 кг, 0,333 м³ → "0.333"', () => {
    const d = { ...filled(), mass: '1,25', volume: '0,333' };
    expect(toCreate(d, MSK).cargo).toMatchObject({ weightKg: '1250', volumeM3: '0.333' });
  });
});

describe('ошибки сервера и водители', () => {
  it('violations 422 → поля формы', () => {
    expect(
      serverErrors([
        {
          field: 'stops[1].weightKg',
          code: 'load',
          message: 'Выгрузка больше, чем в кузове после предыдущей точки',
        },
        { field: 'stops[0].volumeM3', code: 'load', message: 'X' },
        { field: 'plannedWindow', code: 'range', message: 'Окончание должно быть позже начала' },
        {
          field: 'driverMemberId',
          code: 'driver',
          message: 'Нужен действующий сотрудник с функцией «Водитель»',
        },
        { field: 'orgUnitId', code: 'unknown', message: 'Нет такого подразделения' },
        { field: 'cargo.weightKg', code: 'x', message: 'Y' },
        { field: 'title', code: 'x', message: 'Z' },
      ]),
    ).toEqual({
      'stops[1].mass': 'Выгрузка больше, чем в кузове после предыдущей точки',
      'stops[0].volume': 'X',
      to: 'Окончание должно быть позже начала',
      driverId: 'Нужен действующий сотрудник с функцией «Водитель»',
      unit: 'Нет такого подразделения',
      mass: 'Y',
      title: 'Z',
    });
  });

  it('водители: действующие с профилем «Водитель», по алфавиту', () => {
    const m = (
      id: string,
      name: string,
      p: ('driver' | 'manager')[],
      status: 'active' | 'suspended' = 'active',
    ) => ({
      id,
      displayName: name,
      status,
      orgUnitIds: [],
      revision: 1,
      workProfiles: p,
    });
    expect(
      driverOptions([
        m('1', 'Илья Васильев', ['driver']),
        m('2', 'Марина Котова', ['manager']),
        m('3', 'Анна Белова', ['driver']),
        m('4', 'Пётр Сидоров', ['driver'], 'suspended'),
      ]),
    ).toEqual([
      { value: '3', label: 'Анна Белова' },
      { value: '1', label: 'Илья Васильев' },
    ]);
  });
});
