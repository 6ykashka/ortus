// W2.25 · Ключи подписей домена «Главной» (`HomeTextKey`) есть в словаре `home` @ortus/texts и дают строки эталона.
// W4.81: «Задача» и «На проверке» задач — строки словарей `tasks` и `knowledge` (одна строка — один файл).
import { home } from '@ortus/texts';
import { describe, expect, it } from 'vitest';

import { HOME_TEXT_KEYS, OTHER_DICTIONARY_KEYS, textOf } from './texts.ts';

describe('подписи «Главной» по ключам домена', () => {
  it('каждый ключ HomeTextKey — строка словаря home или подпись другого домена', () => {
    for (const key of HOME_TEXT_KEYS) {
      const value = key
        .split('.')
        .reduce<unknown>((n, k) => (n as Record<string, unknown>)?.[k], home);
      expect(typeof value === 'string' || OTHER_DICTIONARY_KEYS.includes(key), key).toBe(true);
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

  it('W4.81 · задачи: «T-64 · …», «Срок 01.10 · создана из ответа формы», чипы, «Открыть», карточка «Задачи» (:4083, :4113)', () => {
    expect(textOf({ key: 'queue.task', args: { key: 'T-64', title: 'Найти водителя' } })).toBe(
      'T-64 · Найти водителя',
    );
    expect(textOf({ key: 'queue.taskDue', args: { due: '01.10', form: 'no' } })).toBe('Срок 01.10');
    expect(textOf({ key: 'queue.taskDue', args: { due: '01.10', form: 'yes' } })).toBe(
      'Срок 01.10 · создана из ответа формы',
    );
    expect(
      ['queue.chips.task', 'queue.chips.taskReview', 'queue.actions.open'].map((key) =>
        textOf({ key: key as 'queue.chips.task' }),
      ),
    ).toEqual(['Задача', 'На проверке', 'Открыть']);
    expect(
      ['work.tasks', 'work.tasksNew', 'work.tasksProgress', 'work.tasksReview'].map((key) =>
        textOf({ key: key as 'work.tasks' }),
      ),
    ).toEqual(['Задачи', 'Новые', 'В работе', 'На проверке']);
  });
});
