// W4.41 · Модель «Календаря» (calVM эталона :4140–4180 над контрактом 0.7.0-stage4): фильтр «Тип ресурса», строки,
// сетка 08:00–20:00, блоки броней с буфером и тоном, мета и источник брони, запрет переноса, варианты времени,
// окно переноса и запрос свободных слотов (freeSlots эталона: шаг 15 минут, 3 слота, без самой брони).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  blocksOf,
  bookingDay,
  gridOf,
  hourMarks,
  kindFilters,
  lockTextOf,
  metaOf,
  moveWindow,
  rowsOf,
  slotsQuery,
  sourceOf,
  startValue,
  timeOptions,
  toneOf,
  workdayOf,
} from './model.ts';
import { dayStart } from './time.ts';

type S = components['schemas'];

const MSK = 'Europe/Moscow';
const UNIT = '00000000-0000-4000-8000-000000000001';
const DAY0 = dayStart('2026-10-01', MSK);

/** «01.10.2026 ЧЧ:ММ» по Москве → момент UTC. */
const msk = (hhmm: string): string => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};

const res = (
  id: string,
  kind: S['CalendarResource']['kind'],
  name: string,
  wd = ['08:00', '20:00'],
) =>
  ({
    id,
    kind,
    name,
    orgUnitId: UNIT,
    timeZone: MSK,
    workday: { start: wd[0], end: wd[1] },
    active: true,
  }) as S['CalendarResource'];

const RESOURCES = [
  res('v1', 'vehicle', 'ГАЗель Next · А 412 МР'),
  res('v4', 'vehicle', 'ГАЗон Next · Е 905 НА'),
  res('iv', 'member', 'Илья Васильев · водитель'),
  res('am', 'member', 'Анна Морозова · массажист'),
  res('r2', 'room', 'Кабинет № 2'),
  res('r3', 'room', 'Кабинет № 3'),
  res('tb', 'equipment', 'Стол с подогревом'),
];
const THERAPIST = RESOURCES.filter((r) => ['am', 'r2', 'tb'].includes(r.id));
const NAMES = new Map(RESOURCES.map((r) => [r.id, r.name]));

function booking(
  id: string,
  title: string,
  ids: string[],
  [from, to]: [string, string],
  o: Partial<S['Booking']> = {},
): S['Booking'] {
  const kindOf = (x: string) => RESOURCES.find((r) => r.id === x)?.kind ?? 'room';
  return {
    id,
    orgUnitId: UNIT,
    title,
    window: { startsAt: msk(from), endsAt: msk(to), timeZone: MSK },
    resources: ids.map((x) => ({ kind: kindOf(x), resourceId: x })),
    status: 'confirmed',
    revision: 1,
    prepMinutes: 0,
    cleanupMinutes: 0,
    ...o,
  };
}

const MASSAGE = booking('a1', 'Классический массаж · Мария К.', ['am', 'r2'], ['10:00', '11:00'], {
  sourceKind: 'appointment',
  cleanupMinutes: 15,
  relatedObject: { moduleKey: 'spa', entityType: 'appointment', entityId: 'ap-1' },
});
const RITUAL = booking('a2', 'SPA-ритуал · Ольга Р.', ['am', 'r2', 'tb'], ['11:30', '13:00'], {
  sourceKind: 'appointment',
  prepMinutes: 15,
  cleanupMinutes: 15,
});
const TRIP = booking('t1', 'Рейс Р-208', ['iv'], ['09:00', '13:00'], {
  sourceKind: 'trip',
  rescheduleLock: 'source_module',
  relatedObject: { moduleKey: 'fleet', entityType: 'trip', entityId: 'trip-208' },
});
const TO = booking('to', 'Плановое ТО', ['v4'], ['08:00', '20:00'], {
  sourceKind: 'maintenance',
  rescheduleLock: 'vehicle_card',
  relatedObject: { moduleKey: 'fleet', entityType: 'vehicle', entityId: 'veh-4' },
});
const BREAK = booking('br', 'Перерыв', ['am'], ['13:15', '14:00'], {
  sourceKind: 'break',
  rescheduleLock: 'specialist_schedule',
});

describe('фильтр «Тип ресурса» и строки', () => {
  it('«Все ресурсы» и только присутствующие виды в порядке эталона', () => {
    expect(kindFilters(RESOURCES, 'all')).toEqual([
      { key: 'all', label: 'Все ресурсы', pressed: true },
      { key: 'vehicle', label: 'Машины', pressed: false },
      { key: 'member', label: 'Сотрудники', pressed: false },
      { key: 'room', label: 'Помещения', pressed: false },
      { key: 'equipment', label: 'Оборудование', pressed: false },
    ]);
    expect(kindFilters(THERAPIST, 'room').map((f) => [f.label, f.pressed])).toEqual([
      ['Все ресурсы', false],
      ['Сотрудники', false],
      ['Помещения', true],
      ['Оборудование', false],
    ]);
    expect(kindFilters([], 'all')).toEqual([{ key: 'all', label: 'Все ресурсы', pressed: true }]);
  });

  it('строки — ресурсы выбранного вида в порядке сервера; иконка вида эталона', () => {
    expect(rowsOf(RESOURCES, 'room').map((r) => [r.name, r.icon])).toEqual([
      ['Кабинет № 2', 'meeting_room'],
      ['Кабинет № 3', 'meeting_room'],
    ]);
    expect(rowsOf(RESOURCES, 'all').map((r) => r.icon)).toEqual([
      'local_shipping',
      'local_shipping',
      'badge',
      'badge',
      'meeting_room',
      'meeting_room',
      'chair',
    ]);
  });
});

describe('сетка', () => {
  it('рабочий день ресурсов — 08:00–20:00 эталона; шире у ресурса — шире сетка', () => {
    expect(gridOf(RESOURCES)).toEqual({ start: 8, end: 20 });
    expect(gridOf([])).toEqual({ start: 8, end: 20 });
    expect(gridOf([...RESOURCES, res('x', 'room', 'Зал', ['07:00', '21:30'])])).toEqual({
      start: 7,
      end: 22,
    });
  });

  it('часы через два: «8:00» … «20:00», left — доля сетки', () => {
    const marks = hourMarks({ start: 8, end: 20 });
    expect(marks.map((m) => m.label)).toEqual([
      '8:00',
      '10:00',
      '12:00',
      '14:00',
      '16:00',
      '18:00',
      '20:00',
    ]);
    expect(marks.map((m) => Math.round(m.left * 100) / 100)).toEqual([
      0, 16.67, 33.33, 50, 66.67, 83.33, 100,
    ]);
  });
});

describe('блоки броней', () => {
  const grid = { start: 8, end: 20 };
  const all = [TO, TRIP, MASSAGE, RITUAL, BREAK];

  it('блок на строке ресурса: X(start), W(start, end), буфер — занятость с подготовкой и уборкой', () => {
    const [b] = blocksOf('r2', [MASSAGE], { dayStart: DAY0, grid, tz: MSK });
    expect(b?.aria).toBe('Классический массаж · Мария К., 10:00–11:00');
    expect(b?.title).toBe('Классический массаж · Мария К.');
    expect(b?.left).toBeCloseTo(16.6667, 3);
    expect(b?.width).toBeCloseTo(8.3333, 3);
    expect(b?.bufLeft).toBeCloseTo(16.6667, 3);
    expect(b?.bufWidth).toBeCloseTo(10.4167, 3);
    expect(b?.tone).toBe('ok');
    expect(b?.selected).toBe(false);
    const [r] = blocksOf('tb', [RITUAL], { dayStart: DAY0, grid, tz: MSK });
    expect(r?.bufLeft).toBeCloseTo(((11.25 - 8) / 12) * 100, 3);
    expect(r?.bufWidth).toBeCloseTo(((13.25 - 11.25) / 12) * 100, 3);
  });

  it('только брони ресурса; ТО на весь день — 0 и 100 %; выбранная отмечена', () => {
    const am = blocksOf('am', all, { dayStart: DAY0, grid, tz: MSK, selected: 'br' });
    expect(am.map((b) => [b.id, b.selected])).toEqual([
      ['a1', false],
      ['a2', false],
      ['br', true],
    ]);
    const [to] = blocksOf('v4', all, { dayStart: DAY0, grid, tz: MSK });
    expect([to?.left, to?.width, to?.tone]).toEqual([0, 100, 'danger']);
  });

  it('бронь другого дня в сутки не попадает; своя подпись aria (неделя)', () => {
    const next = dayStart('2026-10-02', MSK);
    expect(blocksOf('am', all, { dayStart: next, grid, tz: MSK })).toEqual([]);
    const [b] = blocksOf('r2', [MASSAGE], {
      dayStart: DAY0,
      grid,
      tz: MSK,
      aria: (x, from, to) => `${x.title}: ${from}–${to}`,
    });
    expect(b?.aria).toBe('Классический массаж · Мария К.: 10:00–11:00');
  });

  it('тон по виду источника (calVM :4154)', () => {
    expect(toneOf(MASSAGE)).toBe('ok');
    expect(toneOf(TRIP)).toBe('info');
    expect(toneOf(TO)).toBe('danger');
    expect(toneOf(BREAK)).toBe('neutral');
    expect(toneOf({ ...MASSAGE, sourceKind: 'manual' })).toBe('neutral');
    expect(toneOf({ ...MASSAGE, sourceKind: undefined })).toBe('neutral');
  });
});

describe('панель брони', () => {
  it('мета: время, подготовка и уборка в минутах, ресурсы через «, »', () => {
    expect(metaOf(MASSAGE, NAMES, MSK)).toBe(
      '10:00–11:00 · уборка 15 мин · Анна Морозова · массажист, Кабинет № 2',
    );
    expect(metaOf(RITUAL, NAMES, MSK)).toBe(
      '11:30–13:00 · подготовка 15 мин · уборка 15 мин · Анна Морозова · массажист, Кабинет № 2, Стол с подогревом',
    );
    expect(metaOf(TRIP, NAMES, MSK)).toBe('09:00–13:00 · Илья Васильев · водитель');
  });

  it('источник: визит — «Салон и SPA», рейс — рабочее место с рейсом, машина — рабочее место', () => {
    expect(sourceOf(MASSAGE)).toEqual({ label: 'Открыть визит', page: 'spa' });
    expect(sourceOf(TRIP)).toEqual({ label: 'Открыть рейс', page: 'fleet', trip: 'trip-208' });
    expect(sourceOf(TO)).toEqual({ label: 'Открыть машину', page: 'fleet' });
    expect(sourceOf(BREAK)).toBeNull();
    expect(sourceOf({ ...TRIP, relatedObject: undefined })).toBeNull();
  });

  it('запрет переноса — текст эталона; без запрета — null', () => {
    expect(lockTextOf(MASSAGE)).toBeNull();
    expect(lockTextOf(TRIP)).toBe(
      'Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.',
    );
    expect(lockTextOf(TO)).toBe('Недоступность машины задаётся в карточке машины.');
    expect(lockTextOf(BREAK)).toBe('Перерыв меняется в графике специалиста.');
    expect(lockTextOf({ ...MASSAGE, rescheduleLock: 'permission' })).toBe(
      'Нет права «Изменять» в календаре.',
    );
  });

  it('варианты начала: рабочий день ресурсов брони шагом 15 минут (08:00 … 19:45)', () => {
    const wd = workdayOf(MASSAGE, RESOURCES);
    expect(wd).toEqual({ start: 480, end: 1200 });
    const opts = timeOptions(wd);
    expect(opts).toHaveLength(48);
    expect(opts[0]).toEqual({ value: '08:00', label: '08:00' });
    expect(opts.at(-1)).toEqual({ value: '19:45', label: '19:45' });
    expect(workdayOf(MASSAGE, [res('am', 'member', 'А', ['09:00', '18:00'])])).toEqual({
      start: 540,
      end: 1080,
    });
    expect(workdayOf(MASSAGE, [])).toEqual({ start: 480, end: 1200 });
    expect(startValue(MASSAGE, MSK)).toBe('10:00');
  });

  it('сутки брони и окно переноса: длительность и пояс брони сохраняются', () => {
    expect(bookingDay(MASSAGE, MSK)).toBe(DAY0);
    expect(moveWindow(MASSAGE, DAY0, '11:00')).toEqual({
      startsAt: msk('11:00'),
      endsAt: msk('12:00'),
      timeZone: MSK,
    });
    expect(moveWindow(RITUAL, DAY0, '08:15')).toEqual({
      startsAt: msk('08:15'),
      endsAt: msk('09:45'),
      timeZone: MSK,
    });
  });

  it('запрос свободных слотов: ресурсы брони по одному, без неё самой, шаг 15, 3 слота', () => {
    expect(slotsQuery(MASSAGE, DAY0, { start: 480, end: 1200 })).toEqual({
      orgUnitId: UNIT,
      window: { startsAt: msk('08:00'), endsAt: msk('20:00'), timeZone: MSK },
      durationMinutes: 60,
      stepMinutes: 15,
      requirements: [
        { kind: 'member', resourceIds: ['am'], requiredCount: 1 },
        { kind: 'room', resourceIds: ['r2'], requiredCount: 1 },
      ],
      excludeBookingId: 'a1',
      prepMinutes: 0,
      cleanupMinutes: 15,
      maxSlots: 3,
    });
  });
});
