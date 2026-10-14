import { describe, expect, it } from 'vitest';
import {
  emailOk,
  gb,
  hasPdn,
  hm,
  initials,
  int,
  maskPdn,
  maskPhone,
  num,
  plural,
  pluralN,
  rub,
  shortName,
  signRub,
} from './format.ts';

const NBSP = ' ';

describe('format: числа и суммы', () => {
  it('num заменяет точку запятой', () => {
    expect(num(1.5)).toBe('1,5');
    expect(num(12)).toBe('12');
  });

  it('int группирует разряды неразрывным пробелом (ru-RU)', () => {
    const s = int(84370);
    expect(s).toBe('84' + NBSP + '370');
    expect(s.charCodeAt(2)).toBe(0xa0);
  });

  it.each([
    [4500, '4' + NBSP + '500 ₽'],
    [1600.5, '1' + NBSP + '600,5 ₽'],
    [2500, '2' + NBSP + '500 ₽'],
    [0, '0 ₽'],
  ])('rub(%s) = %s (как models.js: обычный пробел перед ₽)', (n, want) => {
    expect(rub(n)).toBe(want);
  });

  it.each([
    [1500, '+1' + NBSP + '500' + NBSP + '₽'],
    [-650, '−650' + NBSP + '₽'],
    [0, '0' + NBSP + '₽'],
  ])('signRub(%s) = %s (как cash.js: знак «−» и NBSP)', (n, want) => {
    expect(signRub(n)).toBe(want);
  });

  it.each([
    [950, '950 МБ'],
    [12.34, '12,3 МБ'],
    [1000, '1 ГБ'],
    [1234, '1,2 ГБ'],
  ])('gb(%s МБ) = %s', (mb, want) => {
    expect(gb(mb)).toBe(want);
  });
});

describe('format: склонение', () => {
  it.each([
    [1, 'пункт'],
    [2, 'пункта'],
    [5, 'пунктов'],
    [11, 'пунктов'],
    [12, 'пунктов'],
    [21, 'пункт'],
    [22, 'пункта'],
    [112, 'пунктов'],
    [0, 'пунктов'],
  ])('plural(%s) = %s', (n, want) => {
    expect(plural(n, 'пункт', 'пункта', 'пунктов')).toBe(want);
  });

  it('pluralN — число и форма, как в модулях эталона', () => {
    expect(pluralN(3, 'файл', 'файла', 'файлов')).toBe('3 файла');
    expect(pluralN(11, 'файл', 'файла', 'файлов')).toBe('11 файлов');
    expect(pluralN(1, 'файл', 'файла', 'файлов')).toBe('1 файл');
  });
});

describe('format: время, имена, почта', () => {
  it.each([
    [8.25, '08:15'],
    [13.25, '13:15'],
    [14.75, '14:45'],
    [9, '09:00'],
  ])('hm(%s) = %s', (t, want) => {
    expect(hm(t)).toBe(want);
  });

  it('shortName: инициал имени и фамилия', () => {
    expect(shortName('Дарья Зимина')).toBe('Д. Зимина');
    expect(shortName('Анна  Петровна Морозова')).toBe('А. Петровна Морозова');
    expect(shortName('Котова')).toBe('Котова');
    expect(shortName('')).toBe('—');
    expect(shortName(undefined)).toBe('—');
  });

  it('initials: две первые буквы', () => {
    expect(initials('Дарья Зимина')).toBe('ДЗ');
    expect(initials('Водитель #104 · временно')).toBe('В#');
  });

  it.each([
    ['a@b.co', true],
    [' a@b.co ', true],
    ['a@b', false],
    ['a b@c.d', false],
  ])('emailOk(%j) = %s', (s, want) => {
    expect(emailOk(s)).toBe(want);
  });
});

describe('format: маски персональных данных', () => {
  it('maskPhone оставляет две последние цифры', () => {
    expect(maskPhone('+7 916 123-45-67')).toBe('+7 ••• •••-••-67');
    expect(maskPhone('12')).toBe('•••');
    expect(maskPhone(null)).toBe('•••');
  });

  it('maskPdn маскирует телефоны в тексте', () => {
    expect(maskPdn('Звоните 8 (916) 123-45-67 или +7 900 000 11 22')).toBe(
      'Звоните +7 ••• •••-••-67 или +7 ••• •••-••-22',
    );
    expect(maskPdn('без телефона')).toBe('без телефона');
    expect(maskPdn(undefined)).toBe('');
  });

  it('hasPdn находит телефон и не залипает на lastIndex', () => {
    expect(hasPdn('+7 916 123-45-67')).toBe(true);
    expect(hasPdn('+7 916 123-45-67')).toBe(true);
    expect(hasPdn('нет')).toBe(false);
    expect(hasPdn(null)).toBe(false);
  });
});
