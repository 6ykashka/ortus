// Правила календаря (models.js 14.10:391–410). Брони — extra-data.js:15–22; ожидания — WS-05 §6б.
import { describe, expect, it } from 'vitest';
import { bookingConflicts, busySpan, freeSlots } from './rules.ts';
import type { Booking, Resource } from './types.ts';

const RESOURCES: Resource[] = [
  { id: 'res-am', kind: 'staff', name: 'Анна Морозова · массажист', unit: 'spa' },
  { id: 'res-room2', kind: 'room', name: 'Кабинет № 2', unit: 'spa' },
  { id: 'res-table', kind: 'equipment', name: 'Стол с подогревом', unit: 'spa' },
];

const B: Record<'a1' | 'a2' | 'a3' | 'br', Booking> = {
  a1: {
    id: 'b-a1',
    title: 'Классический массаж · Мария К.',
    source: { kind: 'appointment', id: 'ap-1' },
    res: ['res-am', 'res-room2'],
    start: 10,
    end: 11,
    prep: 0,
    clean: 0.25,
  },
  a2: {
    id: 'b-a2',
    title: 'SPA-ритуал · Ольга Р.',
    source: { kind: 'appointment', id: 'ap-2' },
    res: ['res-am', 'res-room2', 'res-table'],
    start: 11.5,
    end: 13,
    prep: 0.25,
    clean: 0.25,
  },
  a3: {
    id: 'b-a3',
    title: 'Массаж спины · Екатерина Л.',
    source: { kind: 'appointment', id: 'ap-3' },
    res: ['res-am', 'res-room2'],
    start: 14,
    end: 14.75,
    prep: 0,
    clean: 0.25,
  },
  br: { id: 'b-br', title: 'Перерыв', source: null, res: ['res-am'], start: 13.25, end: 14 },
};
const BOOKINGS = Object.values(B);

describe('busySpan: занятость с подготовкой и уборкой', () => {
  it.each([
    [B.a2, [11.25, 13.25]],
    [B.a1, [10, 11.25]],
    [B.br, [13.25, 14]],
  ])('%#', (b, want) => {
    expect(busySpan(b)).toEqual(want);
  });
});

describe('bookingConflicts: конфликты ресурсов', () => {
  it('перенос массажа на 11:30 пересекается с SPA-ритуалом по двум ресурсам', () => {
    expect(bookingConflicts(BOOKINGS, { ...B.a1, start: 11.5, end: 12.5 }, RESOURCES)).toEqual([
      { res: 'res-am', resName: 'Анна Морозова · массажист', title: 'SPA-ритуал · Ольга Р.' },
      { res: 'res-room2', resName: 'Кабинет № 2', title: 'SPA-ритуал · Ольга Р.' },
    ]);
  });

  it('свободное окно — без конфликтов; бронь не конфликтует сама с собой', () => {
    expect(bookingConflicts(BOOKINGS, { ...B.a3, start: 15, end: 15.75 }, RESOURCES)).toEqual([]);
    expect(bookingConflicts(BOOKINGS, B.a2, RESOURCES)).toEqual([]);
  });

  it('без справочника ресурсов имя ресурса = id', () => {
    const r = bookingConflicts(BOOKINGS, { ...B.a1, start: 11.5, end: 12.5 });
    expect(r.map((x) => x.resName)).toEqual(['res-am', 'res-room2']);
  });

  it('стык без пересечения конфликтом не считается', () => {
    expect(bookingConflicts(BOOKINGS, { ...B.br, id: 'x', start: 14 + 1, end: 16 })).toEqual([]);
    expect(
      bookingConflicts([B.br], {
        id: 'y',
        title: '',
        source: null,
        res: ['res-am'],
        start: 14,
        end: 15,
      }),
    ).toEqual([]);
  });
});

describe('freeSlots: ближайшие свободные начала с шагом 15 минут', () => {
  it('для массажа 10:00 — 08:00, 08:15, 08:30', () => {
    expect(freeSlots(BOOKINGS, B.a1, 3)).toEqual([8, 8.25, 8.5]);
  });

  it('n = 0 → пусто; собственное начало пропускается', () => {
    expect(freeSlots(BOOKINGS, B.a1, 0)).toEqual([]);
    expect(freeSlots([], B.a1, 100)).not.toContain(10);
  });

  it('подготовка сдвигает первое начало, конец дня ограничивает', () => {
    expect(freeSlots([], B.a2, 1)[0]).toBe(8.25);
    expect(freeSlots([], { ...B.a1, start: 19, end: 20 }, 10, 18, 20)).toEqual([
      18, 18.25, 18.5, 18.75,
    ]);
  });
});
