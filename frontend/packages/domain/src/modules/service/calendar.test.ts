// Рабочий календарь направления (service.js 19.10 `addWork`, `workBetween`; Q-W4.00-service-10:
// праздники и часовой пояс). Часы — Europe/Moscow, не зависят от TZ машины (vitest гоняет под New_York).
import { describe, expect, it } from 'vitest';
import {
  addWorkMinutes,
  CAL,
  dayStartMs,
  isWorkDay,
  weekdayOf,
  workBetween,
  type WorkCalendar,
} from './calendar.ts';

/** Московское время 2026: `ms(день, месяц, час, минута)`. */
const ms = (d: number, mo: number, h: number, mi: number): number =>
  Date.UTC(2026, mo - 1, d, h - 3, mi);

describe('календари сида = CAL эталона', () => {
  it('три календаря с подписями дословно', () => {
    expect(CAL.spa).toEqual({
      days: [0, 1, 2, 3, 4, 5, 6],
      from: 600,
      to: 1260,
      label: 'ежедневно 10:00–21:00',
    });
    expect(CAL.rep).toEqual({
      days: [0, 1, 2, 3, 4],
      from: 540,
      to: 1140,
      label: 'пн–пт 9:00–19:00',
    });
    expect(CAL.log).toEqual({
      days: [0, 1, 2, 3, 4, 5, 6],
      from: 480,
      to: 1200,
      label: 'ежедневно 8:00–20:00',
    });
  });
});

describe('день недели и начало дня по поясу календаря', () => {
  it('1 октября 2026 — четверг (пн = 0)', () => {
    expect(weekdayOf(ms(1, 10, 12, 0), 180 * 60_000)).toBe(3);
    expect(weekdayOf(ms(4, 10, 12, 0), 180 * 60_000)).toBe(6);
    expect(weekdayOf(ms(5, 10, 0, 0), 180 * 60_000)).toBe(0);
  });

  it('начало дня — московская полночь; 00:30 мск ещё «новый» день, 23:59 — прежний', () => {
    expect(dayStartMs(ms(1, 10, 16, 24), 180 * 60_000)).toBe(ms(1, 10, 0, 0));
    expect(dayStartMs(ms(2, 10, 0, 30), 180 * 60_000)).toBe(ms(2, 10, 0, 0));
    expect(dayStartMs(ms(1, 10, 23, 59), 180 * 60_000)).toBe(ms(1, 10, 0, 0));
  });

  it('isWorkDay: выходной по дням и праздник из списка', () => {
    const cal: WorkCalendar = { ...CAL.rep, holidays: ['2026-10-05'] };
    expect(isWorkDay(CAL.rep, ms(3, 10, 12, 0))).toBe(false); // суббота
    expect(isWorkDay(CAL.rep, ms(5, 10, 12, 0))).toBe(true);
    expect(isWorkDay(cal, ms(5, 10, 12, 0))).toBe(false);
    expect(isWorkDay(cal, ms(6, 10, 12, 0))).toBe(true);
  });
});

describe('addWorkMinutes(start, mins, cal)', () => {
  it.each([
    ['внутри дня, ежедневно 10–21', ms(1, 10, 16, 24), 120, CAL.spa, ms(1, 10, 18, 24)],
    ['переносится на утро следующего дня', ms(1, 10, 20, 0), 120, CAL.spa, ms(2, 10, 11, 0)],
    ['до открытия — от открытия', ms(1, 10, 7, 0), 30, CAL.rep, ms(1, 10, 9, 30)],
    [
      'после закрытия — от открытия следующего рабочего',
      ms(1, 10, 19, 30),
      30,
      CAL.rep,
      ms(2, 10, 9, 30),
    ],
    ['пятница → понедельник', ms(2, 10, 18, 0), 120, CAL.rep, ms(5, 10, 10, 0)],
    ['старт в субботу', ms(3, 10, 12, 0), 30, CAL.rep, ms(5, 10, 9, 30)],
    ['ровно до закрытия', ms(1, 10, 18, 0), 60, CAL.rep, ms(1, 10, 19, 0)],
    ['ноль минут — старт, если открыто', ms(1, 10, 12, 0), 0, CAL.rep, ms(1, 10, 12, 0)],
    [
      'несколько суток: 1320 мин (22 ч) в 10–21',
      ms(1, 10, 16, 24),
      1320,
      CAL.spa,
      ms(3, 10, 16, 24),
    ],
  ])('%s', (_name, start, mins, cal, want) => {
    expect(addWorkMinutes(start, mins, cal)).toBe(want);
  });

  it('праздник пропускается как выходной (Q-W4.00-service-10)', () => {
    const cal: WorkCalendar = { ...CAL.rep, holidays: ['2026-10-05'] };
    expect(addWorkMinutes(ms(2, 10, 18, 0), 120, cal)).toBe(ms(6, 10, 10, 0));
  });

  it('другой пояс: Самара UTC+4, рабочий день 10:00 по Самаре = 06:00 UTC', () => {
    const cal: WorkCalendar = { ...CAL.spa, utcOffsetMin: 240 };
    expect(addWorkMinutes(Date.UTC(2026, 9, 1, 6, 0), 60, cal)).toBe(Date.UTC(2026, 9, 1, 7, 0));
    // 20:30 по Самаре = 16:30 UTC; до закрытия 30 мин, остальное — на следующий день с 10:00 (06:00 UTC)
    expect(addWorkMinutes(Date.UTC(2026, 9, 1, 16, 30), 60, cal)).toBe(Date.UTC(2026, 9, 2, 6, 30));
  });

  it('календарь без рабочих дней: лимит 500 суток, не зависает', () => {
    const none: WorkCalendar = { days: [], from: 600, to: 1260, label: '—' };
    const start = ms(1, 10, 12, 0);
    const end = addWorkMinutes(start, 30, none);
    expect(end).toBeGreaterThan(start);
    expect(end - dayStartMs(start, 180 * 60_000)).toBe(500 * 86_400_000);
  });
});

describe('workBetween(a, b, cal)', () => {
  it.each([
    ['в пределах дня', ms(1, 10, 16, 24), ms(1, 10, 18, 24), CAL.spa, 120],
    ['через ночь', ms(1, 10, 20, 0), ms(2, 10, 11, 0), CAL.spa, 120],
    ['пятница → понедельник', ms(2, 10, 18, 0), ms(5, 10, 10, 0), CAL.rep, 120],
    ['b <= a', ms(2, 10, 12, 0), ms(1, 10, 12, 0), CAL.rep, 0],
    ['равные точки', ms(1, 10, 12, 0), ms(1, 10, 12, 0), CAL.rep, 0],
    ['только выходные', ms(3, 10, 8, 0), ms(4, 10, 20, 0), CAL.rep, 0],
    ['целый рабочий день 9–19', ms(1, 10, 0, 0), ms(2, 10, 0, 0), CAL.rep, 600],
  ])('%s', (_name, a, b, cal, want) => {
    expect(workBetween(a, b, cal)).toBe(want);
  });

  it('праздник не считается', () => {
    const cal: WorkCalendar = { ...CAL.rep, holidays: ['2026-10-05'] };
    expect(workBetween(ms(2, 10, 18, 0), ms(6, 10, 10, 0), cal)).toBe(120);
    expect(workBetween(ms(2, 10, 18, 0), ms(5, 10, 10, 0), cal)).toBe(60);
  });

  it('округляет до минуты', () => {
    expect(workBetween(ms(1, 10, 12, 0), ms(1, 10, 12, 0) + 90_000, CAL.rep)).toBe(2);
  });

  it('согласован с addWorkMinutes: workBetween(a, add(a, n)) = n', () => {
    for (const cal of [CAL.spa, CAL.rep, CAL.log]) {
      for (const n of [1, 59, 120, 660, 1320, 6000]) {
        const a = ms(1, 10, 16, 24);
        expect(workBetween(a, addWorkMinutes(a, n, cal), cal)).toBe(n);
      }
    }
  });
});
