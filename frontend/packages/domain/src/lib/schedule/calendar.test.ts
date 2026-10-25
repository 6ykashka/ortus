// Рабочий календарь графика (design/Ремонт и стройка.dc.html:936–954, W6.10). Контрольные числа
// сняты прогоном дословной копии расчёта эталона: старт 05.10.2026 (пн), праздник 04.11 (день 30).
import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../core/clock.ts';
import { createCalendar, dayCount, REPAIR_CALENDAR, todayIndex } from './calendar.ts';

const cal = createCalendar({ start: '2026-10-05', holidays: [30], today: 15 });

describe('рабочие дни', () => {
  it.each([
    [0, true],
    [4, true],
    [5, false],
    [6, false],
    [7, true],
    [30, false],
    [-1, false],
    [-3, true],
  ])('isW(%i) = %s', (d, ok) => {
    expect(cal.isW(d)).toBe(ok);
  });

  it.each([
    [5, 7],
    [6, 7],
    [30, 31],
    [4, 4],
  ])('fw(%i) = %i: вперёд до рабочего', (d, r) => {
    expect(cal.fw(d)).toBe(r);
  });

  it.each([
    [5, 4],
    [6, 4],
    [30, 29],
    [29, 29],
  ])('pw(%i) = %i: назад до рабочего', (d, r) => {
    expect(cal.pw(d)).toBe(r);
  });

  it.each([
    [0, 5, 4],
    [28, 3, 31],
    [29, 3, 32],
    [0, 1, 0],
  ])('addW(%i, %i) = %i: конец этапа включительно', (s, n, r) => {
    expect(cal.addW(s, n)).toBe(r);
  });

  it.each([
    [34, 3, 31],
    [31, 2, 29],
    [10, 1, 10],
  ])('subW(%i, %i) = %i: начало по концу', (e, n, r) => {
    expect(cal.subW(e, n)).toBe(r);
  });

  it.each([
    [4, 2, 8],
    [29, 1, 31],
    [3, 0, 3],
  ])('shW(%i, %i) = %i: сдвиг на рабочие дни', (d, n, r) => {
    expect(cal.shW(d, n)).toBe(r);
  });

  it.each([
    [0, 7, 5],
    [20, 31, 8],
    [29, 31, 1],
    [15, 15, 0],
    [10, 3, 0],
  ])('wdIn(%i, %i) = %i: рабочих дней после a до b включительно', (a, b, r) => {
    expect(cal.wdIn(a, b)).toBe(r);
  });
});

describe('даты и подписи', () => {
  it('dt и dtw: день 0 — 05.10, пн; 53 — 27.11, пт; 30 — 04.11, ср', () => {
    expect(cal.dt(0)).toBe('05.10');
    expect(cal.dtw(0)).toBe('05.10, пн');
    expect(cal.dt(53)).toBe('27.11');
    expect(cal.dtw(53)).toBe('27.11, пт');
    expect(cal.dtw(30)).toBe('04.11, ср');
    expect(cal.dtw(-1)).toBe('04.10, вс');
  });

  it('день и месяц словами: «4 ноября», диапазон недели', () => {
    expect(cal.dayMonth(30)).toBe('4 ноября');
    expect(cal.range(14, 18)).toBe('19–23 октября');
    expect(cal.range(28, 32)).toBe('2–6 ноября');
    expect(cal.range(24, 35)).toBe('29 октября – 9 ноября');
  });

  it('склонения: «1 раб. день», «2 раб. дня», «5 раб. дней», «11 дней», «паузой»', () => {
    expect(cal.wdn(1)).toBe('1 раб. день');
    expect(cal.wdn(2)).toBe('2 раб. дня');
    expect(cal.wdn(5)).toBe('5 раб. дней');
    expect(cal.dn(11)).toBe('11 дней');
    expect(cal.dn(21)).toBe('21 день');
    expect(cal.lagTxt(-3)).toBe('раньше на 3 дня');
    expect(cal.lagTxt(0)).toBe('сразу');
    expect(cal.lagTxt(5)).toBe('пауза 5 дней');
  });

  it('dateParts: год, месяц (0–11), число', () => {
    expect(cal.dateParts(0)).toEqual({ year: 2026, month: 9, day: 5 });
    expect(cal.dateParts(57)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(cal.dateParts(90)).toEqual({ year: 2027, month: 0, day: 3 });
  });

  it('weekday и isHoliday', () => {
    expect(cal.weekday(0)).toBe(0);
    expect(cal.weekday(6)).toBe(6);
    expect(cal.weekday(7)).toBe(0);
    expect(cal.isHoliday(30)).toBe(true);
    expect(cal.isHoliday(31)).toBe(false);
  });

  it('понедельник недели дня: 15 → 14, 14 → 14, 20 → 14, 21 → 21', () => {
    expect([15, 14, 20, 21].map((d) => cal.weekStart(d))).toEqual([14, 14, 14, 21]);
  });
});

describe('«сегодня» от часов домена (Q-W4.00-repair-15)', () => {
  it('календарь ремонта: старт 05.10, сегодня 20.10 = день 15', () => {
    expect(REPAIR_CALENDAR.cfg).toEqual({ start: '2026-10-05', holidays: [30], today: 15 });
    expect(todayIndex('2026-10-05', fixedClock('2026-10-20T09:00:00+03:00'))).toBe(15);
  });

  it('полночь по Москве, не по поясу машины', () => {
    expect(todayIndex('2026-10-05', fixedClock('2026-10-20T00:30:00+03:00'))).toBe(15);
    expect(todayIndex('2026-10-05', fixedClock('2026-10-19T23:30:00+03:00'))).toBe(14);
    expect(todayIndex('2026-10-05', fixedClock('2026-10-04T12:00:00+03:00'))).toBe(-1);
  });

  it('dayCount: дней между датами', () => {
    expect(dayCount('2026-10-05', '2026-11-27')).toBe(53);
    expect(dayCount('2026-11-27', '2026-10-05')).toBe(-53);
  });

  it('не ISO-дата — ошибка', () => {
    expect(() => createCalendar({ start: '05.10.2026', holidays: [], today: 0 })).toThrow(
      /ГГГГ-ММ-ДД/,
    );
  });

  it('индекс дня по дате «ДД.ММ»: 27.11 → 53, 04.11 → 30', () => {
    expect(cal.indexOf('27.11')).toBe(53);
    expect(cal.indexOf('04.11')).toBe(30);
    expect(cal.indexOf('xx')).toBeNull();
  });
});
