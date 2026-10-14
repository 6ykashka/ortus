import { describe, expect, it } from 'vitest';
import {
  DEMO,
  TZ,
  chatMinutes,
  ddmm,
  ddmmHHMM,
  ddmmyyyy,
  demoClock,
  driftClock,
  fixedClock,
  hhmm,
  manualClock,
  minutesSince,
  plusDaysDdMm,
  systemClock,
} from './clock.ts';

describe('Clock: демо-«сейчас» и часовой пояс', () => {
  it('часовой пояс домена — Europe/Moscow, хост в тестах — America/New_York', () => {
    expect(TZ).toBe('Europe/Moscow');
    const host = globalThis as { process?: { env: Record<string, string | undefined> } };
    expect(host.process?.env.TZ).toBe('America/New_York');
  });

  it('пять демо-«сейчас» эталона 14.10', () => {
    expect(DEMO).toEqual({
      now: '2026-10-01T10:30:00+03:00',
      cashDay: '01.10',
      kbToday: '01.10.2026',
      docToday: '01.10.2026',
      chatNow: 665,
      svcBase: '2026-10-01T16:24:00+03:00',
    });
  });

  it('форматтеры на демо-часах дают время Москвы при любом TZ хоста', () => {
    const c = fixedClock(DEMO.now);
    expect(hhmm(c)).toBe('10:30');
    expect(ddmm(c)).toBe('01.10');
    expect(ddmmyyyy(c)).toBe('01.10.2026');
    expect(ddmmHHMM(c)).toBe('01.10 10:30');
    expect(plusDaysDdMm(c, 7)).toBe('08.10');
    expect(plusDaysDdMm(c, 31)).toBe('01.11');
  });

  it('demoClock = fixedClock(DEMO.now)', () => {
    expect(demoClock.now().toISOString()).toBe('2026-10-01T07:30:00.000Z');
    expect(ddmm(demoClock)).toBe(DEMO.cashDay);
    expect(ddmmyyyy(demoClock)).toBe(DEMO.kbToday);
  });

  it('ведущий ноль, как toLocaleTimeString(ru-RU, 2-digit)', () => {
    expect(hhmm(fixedClock('2026-10-01T09:05:00+03:00'))).toBe('09:05');
    expect(hhmm(fixedClock('2026-10-01T00:00:00+03:00'))).toBe('00:00');
    expect(hhmm(fixedClock('2026-09-30T21:00:00Z'))).toBe('00:00');
  });

  it('минуты чатов: 11:05 первого октября = 665 = DEMO.chatNow', () => {
    expect(chatMinutes(fixedClock('2026-10-01T11:05:00+03:00'))).toBe(DEMO.chatNow);
    expect(minutesSince(fixedClock('2026-10-02T00:10:00+03:00'), '2026-10-01')).toBe(1450);
  });

  it('fixedClock возвращает новый Date на каждый вызов', () => {
    const c = fixedClock(DEMO.now);
    const a = c.now();
    a.setFullYear(2000);
    expect(c.now().getUTCFullYear()).toBe(2026);
  });

  it('manualClock: set и advance', () => {
    const c = manualClock(DEMO.now);
    c.advance(5 * 60_000);
    expect(hhmm(c)).toBe('10:35');
    c.set('2026-10-02T08:00:00+03:00');
    expect(ddmmHHMM(c)).toBe('02.10 08:00');
  });

  it('driftClock: база обращений плюс реальный дрейф', () => {
    const real = manualClock('2030-01-01T00:00:00Z');
    const c = driftClock(DEMO.svcBase, real);
    expect(ddmmHHMM(c)).toBe('01.10 16:24');
    real.advance(90 * 60_000);
    expect(ddmmHHMM(c)).toBe('01.10 17:54');
  });

  it('systemClock отдаёт текущий Date', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  it('некорректная строка времени — ошибка', () => {
    expect(() => fixedClock('не время')).toThrow(/время/);
  });
});
