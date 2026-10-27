// W6.21 · Расчёты вкладки «Замер» (эталон design-2026-10-19 «Ремонт и стройка.dc.html» :849–854 pnum, measOf;
// :1646 площадь помещения, :1678 итоги; контрольные числа DoR repair.md §2.6: пол кв. 42 46,82 м², стены 134,24 м²,
// периметр 53,2 м, санузел 3,74 / 19,66).
import { describe, expect, it } from 'vitest';

import {
  type RoomDraft,
  fmtNum,
  measureOf,
  newRoom,
  parseDecimal,
  quantityString,
  roomFloor,
  roomWalls,
  toDraft,
  toPut,
} from './calc.ts';

const room = (name: string, l: string, w: string, h: string, o: string): RoomDraft => ({
  name,
  l,
  w,
  h,
  o,
});

describe('parseDecimal: разбор ввода (pnum эталона)', () => {
  it.each([
    ['3.5', 3.5],
    ['3,5', 3.5],
    [' 1 234,5 ', 1234.5],
    ['', 0],
    ['abc', 0],
    ['-2', -2],
  ])('%j → %d', (raw, n) => {
    expect(parseDecimal(raw)).toBe(n);
  });
});

describe('fmtNum: одна цифра после запятой (num эталона)', () => {
  it.each([
    [46.82, '46,8'],
    [134.24, '134,2'],
    [0, '0'],
    [3.74, '3,7'],
    [1234.56, '1 234,6'],
  ])('%d → %s', (n, s) => {
    expect(fmtNum(n)).toBe(s);
  });
});

describe('площади помещения', () => {
  it('пол = длина × ширина; стены = периметр × высота − проёмы', () => {
    const r = room('Кухня', '4', '3', '2.7', '3');
    expect(roomFloor(r)).toBe(12);
    expect(roomWalls(r)).toBeCloseTo(2 * 7 * 2.7 - 3, 6);
  });
  it('стены не уходят в минус', () => {
    expect(roomWalls(room('Кладовка', '1', '1', '1', '50'))).toBe(0);
  });
  it('запятая и мусор в полях считаются как в эталоне', () => {
    const r = room('Комната', '4,5', 'x', '2,7', '');
    expect(roomFloor(r)).toBe(0);
    expect(roomWalls(r)).toBeCloseTo(2 * 4.5 * 2.7, 6);
  });
});

describe('measureOf: итоги замера', () => {
  const rooms: RoomDraft[] = [
    room('Комната', '4.2', '3.6', '2.7', '4.5'),
    room('Санузел', '1.7', '2.2', '2.7', '1.8'),
  ];
  it('пол, стены, периметр и санузлы раздельно', () => {
    const m = measureOf(rooms);
    expect(m.floor).toBeCloseTo(4.2 * 3.6 + 1.7 * 2.2, 6);
    expect(m.bathFloor).toBeCloseTo(3.74, 6);
    expect(m.bathWalls).toBeCloseTo(2 * 3.9 * 2.7 - 1.8, 6);
    expect(m.perimeter).toBeCloseTo(2 * 7.8 + 2 * 3.9, 6);
  });
  it('санузел — по флагу wet, без флага — по имени «Санузел…»', () => {
    const flagged = measureOf([{ ...room('Ванная', '2', '2', '2.5', '0'), wet: true }]);
    expect(flagged.bathFloor).toBe(4);
    expect(measureOf([room('санузел 2', '2', '2', '2.5', '0')]).bathFloor).toBe(4);
    expect(measureOf([room('Ванная', '2', '2', '2.5', '0')]).bathFloor).toBe(0);
  });
  it('пустой замер — нули', () => {
    expect(measureOf([])).toEqual({
      floor: 0,
      walls: 0,
      perimeter: 0,
      bathFloor: 0,
      bathWalls: 0,
      bathPerimeter: 0,
    });
  });
});

describe('quantityString: Quantity контракта', () => {
  it.each([
    [3, '3'],
    [3.5, '3.5'],
    [0.1 + 0.2, '0.3'],
    [-1, '0'],
    [Number.NaN, '0'],
    [1e21, '0'],
    [2.1234567, '2.123457'],
  ])('%d → %s', (n, s) => {
    expect(quantityString(n)).toBe(s);
  });
});

describe('черновик ↔ тело putMeasurement', () => {
  it('toDraft: размеры с запятой для отображения, wet и id сохраняются', () => {
    const d = toDraft([
      {
        id: 'r1',
        name: 'Кухня',
        lengthM: '4',
        widthM: '3.5',
        heightM: '2.7',
        openingsM2: '3.2',
        wet: false,
      },
    ]);
    expect(d).toEqual([
      { id: 'r1', name: 'Кухня', l: '4', w: '3,5', h: '2,7', o: '3,2', wet: false },
    ]);
  });
  it('toPut: Quantity-строки, wet пишется только когда задан', () => {
    const put = toPut([
      { id: 'r1', name: ' Кухня ', l: '4', w: '3,5', h: '2.7', o: '', wet: true },
      room('Коридор', '3.0', '1.4', '2.7', '3.2'),
    ]);
    expect(put).toEqual({
      rooms: [
        { name: 'Кухня', lengthM: '4', widthM: '3.5', heightM: '2.7', openingsM2: '0', wet: true },
        { name: 'Коридор', lengthM: '3', widthM: '1.4', heightM: '2.7', openingsM2: '3.2' },
      ],
    });
  });
  it('newRoom: «Коридор» 3,0 × 1,4 × 2,7, проёмы 3,2 (:1679)', () => {
    expect(newRoom()).toEqual({ name: 'Коридор', l: '3.0', w: '1.4', h: '2.7', o: '3.2' });
  });
});
