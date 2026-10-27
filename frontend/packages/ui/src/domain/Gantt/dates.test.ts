// W6.23 · Возврат 1: подписи месяцев шкалы дословно по эталону («Ремонт и стройка.dc.html» :939–940, :1186):
// полное название — «Ноябрь», год — только у первого месяца шкалы («Октябрь 2026»); короткое — «нояб.», «дек.», «март».
import { describe, expect, it } from 'vitest';

import { monthName } from './dates';

describe('monthName: подписи эталона', () => {
  it('полное название без года; год — у первого месяца шкалы', () => {
    expect(monthName(10, 2026, false, false)).toBe('Ноябрь');
    expect(monthName(11, 2026, false, false)).toBe('Декабрь');
    expect(monthName(9, 2026, false, true)).toBe('Октябрь 2026');
  });

  it('короткое название — как MONS эталона, с точкой', () => {
    const short = Array.from({ length: 12 }, (_, m) => monthName(m, 2026, true, false));
    expect(short).toEqual([
      'янв.',
      'февр.',
      'март',
      'апр.',
      'май',
      'июнь',
      'июль',
      'авг.',
      'сент.',
      'окт.',
      'нояб.',
      'дек.',
    ]);
  });
});
