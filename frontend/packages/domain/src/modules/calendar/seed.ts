// Сид календаря ресурсов (extra-data.js 14.10:4–23; seedLotos, mock-data.js:52–53).
import type { Booking, CalendarSlice, Resource } from './types.ts';

const SEVER = 'f-msk-sever';

function resources(): Resource[] {
  return [
    { id: 'res-v1', kind: 'vehicle', name: 'ГАЗель Next · А 412 МР', unit: SEVER, ref: 'v1' },
    { id: 'res-v6', kind: 'vehicle', name: 'Mercedes Sprinter · Т 771 ЕХ', unit: SEVER, ref: 'v6' },
    { id: 'res-v4', kind: 'vehicle', name: 'ГАЗон Next · Е 905 НА', unit: SEVER, ref: 'v4' },
    { id: 'res-iv', kind: 'staff', name: 'Илья Васильев · водитель', unit: SEVER },
    { id: 'res-am', kind: 'staff', name: 'Анна Морозова · массажист', unit: 'spa' },
    { id: 'res-room2', kind: 'room', name: 'Кабинет № 2', unit: 'spa' },
    { id: 'res-room3', kind: 'room', name: 'Кабинет № 3', unit: 'spa' },
    { id: 'res-table', kind: 'equipment', name: 'Стол с подогревом', unit: 'spa' },
  ];
}

function bookings(): Booking[] {
  const b = (
    id: string,
    title: string,
    source: Booking['source'],
    res: string[],
    [start, end]: [number, number],
    prep = 0,
    clean = 0,
  ): Booking => ({ id, title, source, res, start, end, prep, clean });
  return [
    b('b-208', 'Рейс Р-208', { kind: 'trip', id: 'Р-208' }, ['res-iv'], [9, 13]),
    b('b-to', 'Плановое ТО', { kind: 'vehicle', id: 'v4' }, ['res-v4'], [8, 20]),
    b(
      'b-a1',
      'Классический массаж · Мария К.',
      { kind: 'appointment', id: 'ap-1' },
      ['res-am', 'res-room2'],
      [10, 11],
      0,
      0.25,
    ),
    b(
      'b-a2',
      'SPA-ритуал · Ольга Р.',
      { kind: 'appointment', id: 'ap-2' },
      ['res-am', 'res-room2', 'res-table'],
      [11.5, 13],
      0.25,
      0.25,
    ),
    b(
      'b-a3',
      'Массаж спины · Екатерина Л.',
      { kind: 'appointment', id: 'ap-3' },
      ['res-am', 'res-room2'],
      [14, 14.75],
      0,
      0.25,
    ),
    b('b-br', 'Перерыв', null, ['res-am'], [13.25, 14]),
  ];
}

/**
 * Календарь организации. «Лотос» строится из календаря «Альты» без машин, как в эталоне; эталон
 * при этом оставляет бронь рейса `b-208`, ТО `b-to` и ресурс водителя `res-iv` — утечку «Альты»
 * (Q-31, PD-27). Она повторяется только при `prototypeLeaks` (режим `mock`); без неё у «Лотоса»
 * остаются ресурсы салона и брони только на них.
 */
export function calendarSeed(
  tenantId: string,
  opts: { prototypeLeaks?: boolean } = {},
): CalendarSlice {
  const all: CalendarSlice = { resources: resources(), bookings: bookings() };
  if (tenantId === 't-alta') return all;
  if (tenantId !== 't-lotos') return { resources: [], bookings: [] };
  const vehicles = new Set(all.resources.filter((r) => r.kind === 'vehicle').map((r) => r.id));
  if (opts.prototypeLeaks ?? true) {
    return {
      resources: all.resources.filter((r) => !vehicles.has(r.id)),
      bookings: all.bookings.filter((x) => !vehicles.has(x.id)),
    };
  }
  const salon = all.resources.filter((r) => r.unit === 'spa');
  const ids = new Set(salon.map((r) => r.id));
  return { resources: salon, bookings: all.bookings.filter((x) => x.res.every((r) => ids.has(r))) };
}
