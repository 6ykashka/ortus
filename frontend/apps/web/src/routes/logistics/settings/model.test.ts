// W2.41 · Модель справочника категорий расходов (D-12 комплекта, ответ владельца 17.10; ExpenseCategory контракта
// 0.6.1-stage2): активные и архив в порядке каталога, проверка названия, ETag архивации из revision (Q-W2.41-1),
// подписи кодов для «Приёмки смен» и «Данных», варианты формы водителя (до загрузки — шесть кодов посева),
// ошибка сервера под полем (422 duplicate).
import { type components, ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  activeOptions,
  archivedSince,
  canArchive,
  categoryETag,
  labelsOf,
  nameError,
  SEED_OPTIONS,
  serverFieldError,
  split,
} from './model.ts';

type S = components['schemas'];

const cat = (o: Partial<S['ExpenseCategory']> & Pick<S['ExpenseCategory'], 'code' | 'label'>) =>
  ({
    commentRequired: false,
    seeded: true,
    state: 'active',
    createdAt: '2026-10-01T00:00:00Z',
    revision: 1,
    ...o,
  }) as S['ExpenseCategory'];

const LIST: S['ExpenseCategory'][] = [
  cat({ code: 'fuel', label: 'Топливо' }),
  cat({
    code: 'wash',
    label: 'Мойка',
    state: 'archived',
    archivedAt: '2026-10-02T21:30:00Z',
    revision: 2,
  }),
  cat({ code: 'other', label: 'Прочее', commentRequired: true }),
  cat({ code: 'custom_1', label: 'Стоянка на ночь', seeded: false, commentRequired: true }),
];

describe('справочник категорий: список', () => {
  it('активные и архивные — в порядке каталога сервера', () => {
    const { active, archived } = split(LIST);
    expect(active.map((c) => c.code)).toEqual(['fuel', 'other', 'custom_1']);
    expect(archived.map((c) => c.code)).toEqual(['wash']);
  });

  it('«Прочее» и архивная не убираются в архив', () => {
    expect(LIST.map(canArchive)).toEqual([true, false, false, true]);
  });

  it('дата архивации — по Москве', () => {
    expect(archivedSince(LIST[1] as S['ExpenseCategory'])).toBe('В архиве с 03.10.2026');
    expect(archivedSince(LIST[0] as S['ExpenseCategory'])).toBe('');
  });

  it('If-Match архивации — "rev-<revision>" (как MSW и сервер, Q-W2.41-1)', () => {
    expect(categoryETag(LIST[1] as S['ExpenseCategory'])).toBe('"rev-2"');
  });
});

describe('справочник категорий: форма', () => {
  it('пустое название — ошибка поля', () => {
    expect(nameError('')).toBe('Укажите название категории');
    expect(nameError('   ')).toBe('Укажите название категории');
    expect(nameError(' Стоянка ')).toBeNull();
  });

  it('422 с нарушением label или code — текст под полем; прочие ошибки — нет', () => {
    const dup = new ProblemError(422, {
      type: 'about:blank',
      title: 'Validation failed',
      status: 422,
      code: 'validation_failed',
      detail: 'Такая категория уже есть.',
      violations: [{ field: 'label', code: 'duplicate', message: 'Такая категория уже есть' }],
    } as never);
    expect(serverFieldError(dup)).toBe('Такая категория уже есть');
    expect(serverFieldError(new ProblemError(429))).toBeNull();
    expect(serverFieldError(new TypeError('Failed to fetch'))).toBeNull();
  });

  // Возврат 1 W2.41: сервер (problem.Body) отдаёт 422 только с detail, без violations — так приходят дубль, длина
  // и формат кода; без этого на стенде ошибка не видна ни под полем, ни тостом (тост `run` подавлен quiet).
  it('422 сервера без violations — detail под полем без точки в конце (как MSW и проверка до отправки)', () => {
    const bare = (detail?: string) =>
      new ProblemError(422, {
        type: 'https://docs.ortus.example/errors/validation_failed',
        title: 'Validation failed',
        status: 422,
        code: 'validation_failed',
        ...(detail === undefined ? {} : { detail }),
        requestId: 'req-1',
      } as never);
    expect(serverFieldError(bare('Такая категория уже есть.'))).toBe('Такая категория уже есть');
    expect(serverFieldError(bare('Укажите название категории.'))).toBe(
      'Укажите название категории',
    );
    expect(serverFieldError(bare('Название — не длиннее 100 символов.'))).toBe(
      'Название — не длиннее 100 символов',
    );
    expect(serverFieldError(bare())).toBe('Проверьте заполнение полей.');
    expect(serverFieldError(bare('   '))).toBe('Проверьте заполнение полей.');
  });
});

describe('справочник категорий: подписи и варианты для расходов', () => {
  it('подписи кодов — с архивными', () => {
    const m = labelsOf(LIST);
    expect(m.get('wash')).toBe('Мойка');
    expect(m.get('custom_1')).toBe('Стоянка на ночь');
    expect(labelsOf(undefined).size).toBe(0);
  });

  it('варианты формы водителя — активные по порядку; до загрузки — шесть кодов посева', () => {
    expect(activeOptions(LIST)).toEqual([
      { code: 'fuel', label: 'Топливо', commentRequired: false },
      { code: 'other', label: 'Прочее', commentRequired: true },
      { code: 'custom_1', label: 'Стоянка на ночь', commentRequired: true },
    ]);
    expect(activeOptions(undefined)).toBe(SEED_OPTIONS);
    expect(SEED_OPTIONS.map((o) => o.label)).toEqual([
      'Топливо',
      'Мойка',
      'Парковка',
      'Платная дорога',
      'Шиномонтаж и мелкий ремонт',
      'Прочее',
    ]);
    expect(SEED_OPTIONS.filter((o) => o.commentRequired).map((o) => o.code)).toEqual(['other']);
  });
});
