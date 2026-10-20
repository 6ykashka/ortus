// W4.41 · Время календаря: сутки и неделя в поясе ресурса (CAL-05 — UTC и пояс IANA), ЧЧ:ММ эталона (M.hm),
// строка даты и пояса «Четверг, 1 октября 2026 · Москва (UTC+3)», подписи недели (no-reference, Q-W4.06-4).
import { describe, expect, it } from 'vitest';

import {
  addDays,
  cityOf,
  clock,
  dateTitle,
  dayHead,
  dayShort,
  dayStart,
  hm,
  isIsoDate,
  localDate,
  mondayOf,
  msToNextDay,
  offsetLabel,
  weekTitle,
} from './time.ts';

const MSK = 'Europe/Moscow';
/** 01.10.2026 10:30 по Москве — часы e2e (CLOCK харнесса). */
const NOW = Date.parse('2026-10-01T07:30:00Z');

describe('сутки в поясе', () => {
  it('дата момента в поясе: полночь UTC — ещё 1 октября по Москве, 21:00 UTC — уже 2 октября', () => {
    expect(localDate(NOW, MSK)).toBe('2026-10-01');
    expect(localDate(Date.parse('2026-10-01T21:00:00Z'), MSK)).toBe('2026-10-02');
    expect(localDate(Date.parse('2026-10-01T20:59:00Z'), MSK)).toBe('2026-10-01');
    expect(localDate(Date.parse('2026-10-01T23:30:00Z'), 'Asia/Vladivostok')).toBe('2026-10-02');
  });

  it('начало суток — местная полночь (Москва UTC+3, Самара UTC+4, UTC)', () => {
    expect(new Date(dayStart('2026-10-01', MSK)).toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(new Date(dayStart('2026-10-01', 'Europe/Samara')).toISOString()).toBe(
      '2026-09-30T20:00:00.000Z',
    );
    expect(new Date(dayStart('2026-10-01', 'UTC')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('переход на зимнее время (Берлин, 25.10.2026): сутки — 25 часов', () => {
    const a = dayStart('2026-10-25', 'Europe/Berlin');
    const b = dayStart('2026-10-26', 'Europe/Berlin');
    expect(new Date(a).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect((b - a) / 3_600_000).toBe(25);
  });

  it('дни и понедельник недели', () => {
    expect(addDays('2026-10-01', 1)).toBe('2026-10-02');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(mondayOf('2026-10-01')).toBe('2026-09-28');
    expect(mondayOf('2026-09-28')).toBe('2026-09-28');
    expect(mondayOf('2026-10-04')).toBe('2026-09-28');
  });

  // Возврат 1: смена «сегодня» на открытой странице — таймер до местной полуночи.
  it('до следующей местной полуночи: 23:59 по Москве — минута, 10:30 — 13,5 часа', () => {
    expect(msToNextDay(Date.parse('2026-10-01T20:59:00Z'), MSK)).toBe(60_000);
    expect(msToNextDay(NOW, MSK)).toBe(13.5 * 3_600_000);
    expect(msToNextDay(Date.parse('2026-10-24T22:00:00Z'), 'Europe/Berlin')).toBe(25 * 3_600_000);
  });

  it('дата параметра ?date= — только ГГГГ-ММ-ДД существующего дня', () => {
    expect(isIsoDate('2026-10-02')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('02.10.2026')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
    expect(isIsoDate(20261002)).toBe(false);
  });
});

describe('ЧЧ:ММ', () => {
  it('M.hm эталона: дробные часы', () => {
    expect(hm(8)).toBe('08:00');
    expect(hm(19.75)).toBe('19:45');
    expect(hm(11.5)).toBe('11:30');
    expect(hm(13.25)).toBe('13:15');
  });

  it('время момента в поясе', () => {
    expect(clock(NOW, MSK)).toBe('10:30');
    expect(clock(Date.parse('2026-10-01T06:00:00Z'), MSK)).toBe('09:00');
    expect(clock(Date.parse('2026-10-01T06:00:00Z'), 'Europe/Samara')).toBe('10:00');
  });
});

describe('строка даты и пояса', () => {
  it('«Четверг, 1 октября 2026» — дата по часам (эталон пишет «Среда», Q-61)', () => {
    expect(dateTitle('2026-10-01')).toBe('Четверг, 1 октября 2026');
    expect(dateTitle('2026-10-02')).toBe('Пятница, 2 октября 2026');
  });

  it('город и смещение пояса: «Москва», «+3»', () => {
    expect(cityOf(MSK)).toBe('Москва');
    expect(offsetLabel(MSK, NOW)).toBe('+3');
    expect(offsetLabel('Europe/Samara', NOW)).toBe('+4');
    expect(offsetLabel('Asia/Kolkata', NOW)).toBe('+5:30');
    expect(offsetLabel('UTC', NOW)).toBe('+0');
    expect(cityOf('Europe/Samara')).toBe('Самара');
    expect(cityOf('America/New_York')).toBe('America/New_York');
  });

  it('неделя (no-reference): заголовок, столбцы дней, короткая дата блока', () => {
    expect(weekTitle('2026-09-28')).toBe('28 сентября — 4 октября 2026');
    expect(weekTitle('2026-12-28')).toBe('28 декабря 2026 — 3 января 2027');
    expect(dayHead('2026-09-28')).toBe('Пн, 28.09');
    expect(dayHead('2026-10-04')).toBe('Вс, 04.10');
    expect(dayShort('2026-10-01')).toBe('чт 01.10');
  });
});
