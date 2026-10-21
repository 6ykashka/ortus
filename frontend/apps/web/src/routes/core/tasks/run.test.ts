// W4.12 · Текст отказа «Задач» для формы и тоста: сообщение модуля дословно. У 422 validation_failed — сообщение
// поля (violations[0].message): `detail` проверки схемы сценарного сервера берётся из примера операции (правило
// W0.13) и может не совпадать с полем («Ключ LOG уже занят» на ключ «1AB»).
import { ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { detailOf } from './run.ts';

const problem = (o: Record<string, unknown>) =>
  new ProblemError(422, {
    type: 'about:blank',
    title: 'Ошибки полей',
    status: 422,
    code: 'validation_failed',
    requestId: 'r',
    ...o,
  } as never);

describe('detailOf', () => {
  it('validation_failed — сообщение первого поля, а не detail примера', () => {
    expect(
      detailOf(
        problem({
          detail: 'Ключ LOG уже занят',
          violations: [
            {
              field: 'key',
              code: 'format',
              message: 'Ключ — 2–6 заглавных букв или цифр, первая — буква',
            },
          ],
        }),
      ),
    ).toBe('Ключ — 2–6 заглавных букв или цифр, первая — буква');
  });

  it('без полей — detail сервера; без detail — текст оболочки по коду', () => {
    expect(detailOf(problem({ detail: 'Тема — не короче 3 символов' }))).toBe(
      'Тема — не короче 3 символов',
    );
    expect(detailOf(new TypeError('Failed to fetch'))).toBe(
      'Нет связи с сервером. Операция не выполнена.',
    );
  });
});
