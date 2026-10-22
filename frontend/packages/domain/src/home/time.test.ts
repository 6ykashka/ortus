// W2.80 · Часовой пояс подписей «Главной»: московский (core/clock TZ), не пояс браузера или CI. Форматтеры
// берут пояс параметром — результат не зависит от TZ процесса (проверка — под UTC и Владивостоком).
import { afterEach, describe, expect, it } from 'vitest';

import { TZ } from '../core/clock.ts';
import { ddmmyyyy, dayKey, HOME_TIME_ZONE, hhmm, hourOf } from './time.ts';

// Пакет домена без типов Node (как core/clock.test.ts); TZ процесса по умолчанию — America/New_York (vitest.config.ts).
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env;
const saved = env.TZ;
afterEach(() => {
  if (saved === undefined) delete env.TZ;
  else env.TZ = saved;
});

describe('HOME_TIME_ZONE', () => {
  it('— пояс домена Europe/Moscow', () => {
    expect(HOME_TIME_ZONE).toBe('Europe/Moscow');
    expect(HOME_TIME_ZONE).toBe(TZ);
  });

  for (const zone of ['UTC', 'Asia/Vladivostok']) {
    it(`${zone}: время, час, дата и ключ дня — по Москве`, () => {
      env.TZ = zone;
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
      const at = new Date('2026-10-01T11:00:00Z');
      expect(hhmm(at, HOME_TIME_ZONE)).toBe('14:00');
      expect(hourOf(at, HOME_TIME_ZONE)).toBe(14);
      const late = new Date('2026-10-01T21:30:00Z');
      expect(ddmmyyyy(late, HOME_TIME_ZONE)).toBe('02.10.2026');
      expect(dayKey(late, HOME_TIME_ZONE)).toBe('2026-10-02');
    });
  }
});
