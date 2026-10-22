// W4.61 · Форматирование страниц шага 4.6 (models.js rub/num/plural, usageVM gb/days, opVM :3546 полосы).
import { describe, expect, it } from 'vitest';

import {
  barTone,
  calendarDays,
  gb,
  markLetter,
  mskDate,
  mskLastDay,
  mskStamp,
  plural,
  rub,
  rubMinor,
  shortName,
  tenantChip,
} from './format.ts';

const NB = ' ';

describe('деньги и объёмы', () => {
  it('рубли — разряды неразрывным пробелом и «₽» (M.rub)', () => {
    expect(rub(3900)).toBe(`3${NB}900 ₽`);
    expect(rub(152640)).toBe(`152${NB}640 ₽`);
    expect(rub(800)).toBe('800 ₽');
  });

  it('копейки контракта → рубли', () => {
    expect(rubMinor(1192000)).toBe(`11${NB}920 ₽`);
  });

  it('гигабайты — один знак после запятой, целые без дробной части (usageVM gb)', () => {
    expect(gb(49606872269)).toBe('46,2');
    expect(gb(67645734912)).toBe('63');
    expect(gb(0)).toBe('0');
  });

  it('склонение по числу (M.plural)', () => {
    const p = (n: number) => plural(n, 'подписка', 'подписки', 'подписок');
    expect([1, 2, 5, 11, 21, 0].map(p)).toEqual([
      'подписка',
      'подписки',
      'подписок',
      'подписок',
      'подписка',
      'подписок',
    ]);
  });
});

describe('даты по Москве', () => {
  it('начало действия — день начала', () => {
    expect(mskDate('2026-09-30T21:00:00Z')).toBe('01.10.2026');
  });

  it('конец — исключающая граница: последний день периода', () => {
    expect(mskLastDay('2026-10-13T21:00:00Z')).toBe('13.10.2026');
    expect(mskLastDay('2026-09-30T21:00:00Z')).toBe('30.09.2026');
  });

  it('метка «ДД.ММ ЧЧ:ММ»', () => {
    expect(mskStamp('2026-09-29T13:40:00Z')).toBe('29.09 16:40');
    expect(mskStamp('2026-09-30T16:05:00Z')).toBe('30.09 19:05');
  });

  it('календарные дни между датами по Москве (usageVM days)', () => {
    expect(calendarDays('2026-09-18T20:51:00Z', '2026-10-01T07:30:00Z')).toBe(13);
    expect(calendarDays('2026-10-01T06:12:00Z', '2026-10-01T07:30:00Z')).toBe(0);
    expect(calendarDays('2026-09-30T16:05:00Z', '2026-10-01T07:30:00Z')).toBe(1);
  });
});

describe('подписи', () => {
  it('сокращённое имя автора: «Евгения Лаптева» → «Е. Лаптева»', () => {
    expect(shortName('Евгения Лаптева')).toBe('Е. Лаптева');
    expect(shortName('Система')).toBe('Система');
  });

  it('буква знака: короткое имя или название, только буквы и цифры (accountsVM :3634)', () => {
    expect(markLetter('SPA «Лотос»', 'Лотос')).toBe('Л');
    expect(markLetter('Альта Групп')).toBe('А');
    expect(markLetter('«»')).toBe('·');
  });

  it('чип статуса организации (TENANT_STATE; grace и read_only — «Ограничен»)', () => {
    expect(tenantChip('trial')).toEqual({
      label: 'Пробный период',
      tone: 'info',
      icon: 'hourglass_top',
    });
    expect(tenantChip('read_only')).toEqual({
      label: 'Ограничен',
      tone: 'warn',
      icon: 'lock_clock',
    });
    expect(tenantChip('grace').label).toBe('Ограничен');
    expect(tenantChip('suspended')).toEqual({
      label: 'Приостановлен',
      tone: 'danger',
      icon: 'pause_circle',
    });
    expect(tenantChip('active').label).toBe('Действует');
  });

  it('цвет полосы: ≥ 100 % — danger, от порога — warn, иначе акцент', () => {
    expect(barTone(100, 85)).toBe('danger');
    expect(barTone(85, 85)).toBe('warn');
    expect(barTone(84.9, 85)).toBe('accent');
    // «Места» владельца — строго больше 80 % (billingVM :3930).
    expect(barTone(80, 80, true)).toBe('accent');
    expect(barTone(90, 80, true)).toBe('warn');
  });
});
