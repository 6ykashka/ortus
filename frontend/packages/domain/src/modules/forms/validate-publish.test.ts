// Проверки публикации формы 14.10 (api.js:559–565, B §2.3 «Изменённые методы ядра»).
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../core/errors/index.ts';
import { nextVersionFields, validatePublish } from './validate-publish.ts';
import type { FormDef, FormField } from './types.ts';

const f = (id: string, type: FormField['type'], label: string, x: Partial<FormField> = {}) =>
  ({ id, type, label, required: false, ...x }) as FormField;

const OK: FormField[] = [
  f('q-odo', 'int', 'Пробег'),
  f('q-fuel', 'choice', 'Топливо', { options: [{ id: 'o1', label: '¼' }] }),
];

function err(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiError) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error('ошибки нет');
}

describe('validatePublish: тексты 14.10', () => {
  it.each<[string, FormDef | FormField[] | null | undefined, string]>([
    ['нет определения', undefined, 'В форме нет ни одного вопроса'],
    ['null', null, 'В форме нет ни одного вопроса'],
    ['пустой список', { pages: null, fields: [] }, 'В форме нет ни одного вопроса'],
    [
      'только текстовые блоки',
      [f('s-1', 'statement', 'Прочитайте правила')],
      'В форме нет ни одного вопроса',
    ],
    ['пустой текст вопроса', [f('q-1', 'text', '   ')], 'У вопроса нет текста'],
    [
      'пустой текст у текстового блока тоже ошибка',
      [f('q-1', 'text', 'Имя'), f('s-1', 'statement', '')],
      'У вопроса нет текста',
    ],
    [
      'выбор без вариантов',
      [f('q-1', 'choice', 'Топливо')],
      'У вопроса «Топливо» нет вариантов ответа',
    ],
    [
      'варианты из пустых строк',
      [f('q-1', 'multi', 'Чек-лист', { options: ['  ', ''] })],
      'У вопроса «Чек-лист» нет вариантов ответа',
    ],
    [
      'список с пустыми подписями',
      [f('q-1', 'select', 'Фирма', { options: [{ id: 'o1', label: ' ' }] })],
      'У вопроса «Фирма» нет вариантов ответа',
    ],
    [
      'повтор id',
      [f('q-1', 'text', 'Имя'), f('q-1', 'text', 'Фамилия')],
      'Повторяется идентификатор вопроса q-1',
    ],
  ])('%s', (_n, def, message) => {
    expect(err(() => validatePublish(def))).toEqual({ code: 'validation', message });
  });

  it('текст вопроса проверяется раньше вариантов', () => {
    const def = [f('q-1', 'choice', 'Топливо'), f('q-2', 'text', '')];
    expect(err(() => validatePublish(def)).message).toBe('У вопроса нет текста');
  });

  it.each([
    ['person', 'Наставник'],
    ['unit', 'Фирма'],
    ['ref', 'Объект'],
  ] as const)('публичная форма не спрашивает %s', (type, label) => {
    const def = [f('q-1', 'text', 'Имя'), f('q-2', type, label)];
    expect(err(() => validatePublish(def, { access: 'public' }))).toEqual({
      code: 'validation',
      message:
        'Публичная форма не может спрашивать «' +
        label +
        '»: справочники CRM гостю не показываются',
    });
    expect(validatePublish(def, { access: 'internal' })).toHaveLength(2);
    expect(validatePublish(def)).toHaveLength(2);
  });

  it('справочники CRM проверяются раньше повтора id', () => {
    const def = [f('q-1', 'person', 'Наставник'), f('q-1', 'text', 'Имя')];
    expect(err(() => validatePublish(def, { access: 'public' })).message).toMatch(/^Публичная/);
  });

  it('варианты строкой и объектом принимаются', () => {
    const def = [
      f('q-1', 'choice', 'Топливо', { options: ['¼', '½'] }),
      f('q-2', 'multi', 'Чек-лист', { options: [{ id: 'o1', label: 'Кузов' }] }),
    ];
    expect(validatePublish(def).map((x) => x.id)).toEqual(['q-1', 'q-2']);
  });

  it('массив полей (старый формат) и {pages, fields} дают одни и те же вопросы', () => {
    expect(validatePublish(OK)).toEqual(OK);
    expect(validatePublish({ pages: [{ id: 'p1', title: 'Стр.' }], fields: OK })).toEqual(OK);
  });

  it('{pages} без fields — нет вопросов', () => {
    const def = { pages: [{ id: 'p1', title: 'Стр.' }] } as unknown as FormDef;
    expect(err(() => validatePublish(def)).message).toBe('В форме нет ни одного вопроса');
  });
});

describe('nextVersionFields: неизменяемые версии', () => {
  it('вопрос сменил тип — новый id с суффиксом версии, старые ответы не путаются', () => {
    const prev = [f('q-odo', 'number', 'Пробег'), f('q-fuel-t', 'text', 'Топливо')];
    const next = [f('q-odo', 'int', 'Пробег'), f('q-fuel-t', 'text', 'Топливо, уровень')];
    expect(nextVersionFields(next, prev, 4).map((x) => x.id)).toEqual(['q-odo-v4', 'q-fuel-t']);
  });

  it('новые вопросы и первая версия — без суффикса', () => {
    expect(nextVersionFields(OK, [], 1).map((x) => x.id)).toEqual(['q-odo', 'q-fuel']);
  });

  it('копия: вход не меняется', () => {
    const next = [f('q-odo', 'int', 'Пробег')];
    const out = nextVersionFields(next, [f('q-odo', 'number', 'Пробег')], 2);
    expect(next[0]?.id).toBe('q-odo');
    expect(out[0]).not.toBe(next[0]);
  });
});
