// Подписи сроков и времени «Обращений» (service.js 19.10:45–64), время — по Москве.
import { describe, expect, it } from 'vitest';
import { CAL } from './calendar.ts';
import { dayLabel, dueText, dur, fillTemplate, hm, span, when } from './format.ts';

const ms = (d: number, mo: number, h: number, mi: number): number =>
  Date.UTC(2026, mo - 1, d, h - 3, mi);

describe('hm, dayLabel', () => {
  it('час без ведущего нуля, минуты с нулём', () => {
    expect(hm(ms(1, 10, 16, 24))).toBe('16:24');
    expect(hm(ms(1, 10, 9, 5))).toBe('9:05');
    expect(hm(ms(1, 10, 0, 0))).toBe('0:00');
  });

  it('день и месяц в родительном падеже', () => {
    expect(dayLabel(ms(1, 10, 12, 0))).toBe('1 октября');
    expect(dayLabel(ms(30, 9, 12, 0))).toBe('30 сентября');
    expect(dayLabel(ms(31, 12, 12, 0))).toBe('31 декабря');
  });

  it('пояс календаря: Самара UTC+4', () => {
    expect(hm(Date.UTC(2026, 9, 1, 6, 0), 240 * 60_000)).toBe('10:00');
    expect(hm(Date.UTC(2026, 9, 1, 6, 0))).toBe('9:00');
  });
});

describe('when(ms, now)', () => {
  const now = ms(1, 10, 16, 24);
  it.each([
    [ms(1, 10, 9, 5), 'сегодня, 9:05'],
    [ms(30, 9, 15, 40), 'вчера, 15:40'],
    [ms(26, 9, 14, 20), '26 сентября, 14:20'],
    [ms(2, 10, 8, 0), '2 октября, 8:00'],
  ])('%s', (at, want) => {
    expect(when(at, now)).toBe(want);
  });

  it('граница суток по Москве, а не по UTC', () => {
    expect(when(ms(1, 10, 0, 10), ms(1, 10, 1, 0))).toBe('сегодня, 0:10');
    expect(when(ms(30, 9, 23, 50), ms(1, 10, 0, 5))).toBe('вчера, 23:50');
  });
});

describe('dueText(ms, now)', () => {
  const now = ms(1, 10, 16, 24);
  it('сегодня — время; ближе 3 суток — день и время; дальше — только день', () => {
    expect(dueText(ms(1, 10, 18, 24), now)).toBe('18:24');
    expect(dueText(ms(2, 10, 10, 30), now)).toBe('2 октября, 10:30');
    expect(dueText(ms(10, 10, 10, 30), now)).toBe('10 октября');
  });

  it('просроченный срок в прошлом дне — день и время', () => {
    expect(dueText(ms(30, 9, 10, 0), now)).toBe('30 сентября, 10:00');
  });
});

describe('dur(mins, cal) — рабочее время', () => {
  it.each([
    [0, undefined, '0 мин'],
    [48, undefined, '48 мин'],
    [60, CAL.spa, '1 ч'],
    [220, CAL.spa, '3 ч 40 мин'],
    [659, CAL.spa, '10 ч 59 мин'],
    [660, CAL.spa, '1 день'],
    [1320, CAL.spa, '2 дня'],
    [5 * 660, CAL.spa, '5 дней'],
    [6000, CAL.rep, '10 раб. дней'],
    [600, CAL.rep, '1 раб. день'],
    [1440, undefined, '1 день'],
    [-5, CAL.rep, '0 мин'],
    [47.6, CAL.rep, '48 мин'],
  ])('%s мин → «%s»', (mins, cal, want) => {
    expect(dur(mins, cal)).toBe(want);
  });

  it('11 и 21 дни — склонение', () => {
    expect(dur(11 * 660, CAL.spa)).toBe('11 дней');
    expect(dur(21 * 660, CAL.spa)).toBe('21 день');
  });
});

describe('span(mins) — календарная длительность просрочки', () => {
  it.each([
    [5, '5 мин'],
    [125, '2 ч 5 мин'],
    [120, '2 ч'],
    [1440, '1 день'],
    [3000, '2 дня'],
    [7300, '5 дней'],
  ])('%s → «%s»', (mins, want) => {
    expect(span(mins)).toBe(want);
  });
});

describe('fillTemplate — подстановка в шаблон ответа', () => {
  it('{имя}, {номер}, {срок}', () => {
    expect(
      fillTemplate('{имя}, приняли ваше обращение {номер}. Ответим {срок}.', {
        name: 'Наталья Гусева',
        key: 'ГРЗ-57',
        until: 'до 11:00',
      }),
    ).toBe('Наталья, приняли ваше обращение ГРЗ-57. Ответим до 11:00.');
  });

  it('«был до …» превращается в «до …», пустой срок — «в течение рабочего дня»', () => {
    expect(fillTemplate('Ответим {срок}', { name: 'А Б', key: 'К-1', until: 'был до 10:00' })).toBe(
      'Ответим до 10:00',
    );
    expect(fillTemplate('Ответим {срок}', { name: 'А Б', key: 'К-1', until: '' })).toBe(
      'Ответим в течение рабочего дня',
    );
  });

  it('заменяется только первое вхождение — как в эталоне (String.replace)', () => {
    expect(fillTemplate('{имя} {имя}', { name: 'Олег', key: 'К', until: '' })).toBe('Олег {имя}');
  });

  it('клиент без имени — пустая подстановка', () => {
    expect(fillTemplate('{имя}!', { name: '', key: 'К', until: '' })).toBe('!');
  });
});
