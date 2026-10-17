// W2.25 · Ключи подписей домена «Главной» (`HomeTextKey`) есть в словаре `home` @ortus/texts и дают строки эталона.
import { home } from '@ortus/texts';
import { describe, expect, it } from 'vitest';

import { HOME_TEXT_KEYS, textOf } from './texts.ts';

describe('подписи «Главной» по ключам домена', () => {
  it('каждый ключ HomeTextKey — строка словаря home', () => {
    for (const key of HOME_TEXT_KEYS) {
      const value = key
        .split('.')
        .reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], home);
      expect(typeof value, key).toBe('string');
    }
  });

  it('textOf собирает строку по ключу и аргументам', () => {
    expect(
      textOf({
        key: 'queue.defectText',
        args: { zone: 'Стёкла', description: 'Скол', driver: 'Илья Васильев' },
      }),
    ).toBe('Стёкла: Скол · Илья Васильев');
    expect(textOf({ key: 'queue.chips.today', args: { time: '14:00' } })).toBe('Сегодня 14:00');
    expect(textOf({ key: 'work.repair' })).toBe('Ремонт и стройка');
    expect(
      textOf({ key: 'trips.sub', args: { driver: 'без водителя', vehicle: 'машина не выбрана' } }),
    ).toBe('без водителя · машина не выбрана');
    expect(textOf('46')).toBe('46');
  });
});
