// W6.21 · Расчёты вкладки «Замер» (эталон design-2026-10-19 «Ремонт и стройка.dc.html» :849 pnum, :850–854 measOf,
// :1646 площади помещения). Размеры в полях ввода — строки (запятая допустима), расчёт — числами; в запрос
// putMeasurement уходят Quantity-строки контракта.
import type { components } from '@ortus/api-client';

type S = components['schemas'];

/** Помещение в поле ввода: размеры — как набрал человек. */
export interface RoomDraft {
  id?: string;
  name: string;
  l: string;
  w: string;
  h: string;
  o: string;
  wet?: boolean;
}

export interface MeasureTotals {
  floor: number;
  walls: number;
  perimeter: number;
  bathFloor: number;
  bathWalls: number;
  bathPerimeter: number;
}

/** pnum эталона: пробелы убираются, запятая — разделитель; нечисло — 0. */
export function parseDecimal(raw: string): number {
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** num эталона: одна цифра после запятой, разряды неразрывным пробелом. */
export const fmtNum = (n: number): string =>
  (Math.round(n * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export const roomFloor = (r: RoomDraft): number => parseDecimal(r.l) * parseDecimal(r.w);

const roomPerimeter = (r: RoomDraft): number => 2 * (parseDecimal(r.l) + parseDecimal(r.w));

export const roomWalls = (r: RoomDraft): number =>
  Math.max(0, roomPerimeter(r) * parseDecimal(r.h) - parseDecimal(r.o));

/** Санузел: флаг сервера, без него — имя «Санузел…» (measOf эталона). */
export const isWet = (r: RoomDraft): boolean => r.wet ?? /^санузел/i.test(r.name);

export function measureOf(rooms: readonly RoomDraft[]): MeasureTotals {
  const m: MeasureTotals = {
    floor: 0,
    walls: 0,
    perimeter: 0,
    bathFloor: 0,
    bathWalls: 0,
    bathPerimeter: 0,
  };
  for (const r of rooms) {
    const f = roomFloor(r);
    const w = roomWalls(r);
    const p = roomPerimeter(r);
    m.floor += f;
    m.walls += w;
    m.perimeter += p;
    if (isWet(r)) {
      m.bathFloor += f;
      m.bathWalls += w;
      m.bathPerimeter += p;
    }
  }
  return m;
}

/** Quantity контракта: неотрицательное число до 6 знаков, без экспоненты; прочее — «0». */
export function quantityString(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n >= 1e15) return '0';
  const s = (Math.round(n * 1e6) / 1e6).toString();
  return /e/i.test(s) ? '0' : s;
}

const show = (q: string): string => q.replace('.', ',');

export function toDraft(rooms: readonly S['MeasurementRoom'][]): RoomDraft[] {
  return rooms.map((r) => ({
    id: r.id,
    name: r.name,
    l: show(r.lengthM),
    w: show(r.widthM),
    h: show(r.heightM),
    o: show(r.openingsM2),
    ...(r.wet === undefined ? {} : { wet: r.wet }),
  }));
}

export function toPut(rooms: readonly RoomDraft[]): S['MeasurementPut'] {
  return {
    rooms: rooms.map((r) => ({
      name: r.name.trim(),
      lengthM: quantityString(parseDecimal(r.l)),
      widthM: quantityString(parseDecimal(r.w)),
      heightM: quantityString(parseDecimal(r.h)),
      openingsM2: quantityString(parseDecimal(r.o)),
      ...(r.wet === undefined ? {} : { wet: r.wet }),
    })),
  };
}

/** «Добавить помещение» всегда добавляет «Коридор» (:1679). */
export const newRoom = (): RoomDraft => ({
  name: 'Коридор',
  l: '3.0',
  w: '1.4',
  h: '2.7',
  o: '3.2',
});
