// W2.52 (контракт 0.6.1-stage2, возврат 1) · Тексты ошибок справочника категорий расходов (D-12 комплекта, W2.41) и
// перемещения машины (W2.42) — одна строка для примера контракта, MSW и экранов W2.41, W2.42, W2.22: экраны берут
// текст отсюда, а не дублируют его. В эталоне этих текстов нет (no-reference, Q-W2.52-2, Q-W2.52-5).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { errors, format, logisticsDriver } from '../src/index.ts';
import { readJson, readText, ROOT } from './_util.mjs';

const example = (op, name) => readJson(join(ROOT, 'api/openapi/examples', op, `${name}.json`));
const msw = (file) => readText(join(ROOT, 'frontend/packages/adapter/src/msw/fleet', file));

describe('справочник категорий расходов (W2.41)', () => {
  const t = errors.mock.logistics.expenseCategory;

  it('тексты отказов справочника и расхода', () => {
    assert.deepEqual(t, {
      unknown: 'Категория расхода не найдена',
      archived: 'Категория в архиве — выберите другую',
      duplicate: 'Такая категория уже есть',
      otherNotArchivable: 'Категорию «Прочее» нельзя убрать.',
      commentRequired: 'Для категории «{label}» добавьте комментарий',
    });
  });

  it('«комментарий обязателен» по категории даёт для «Прочее» текст W2.40', () => {
    assert.equal(
      format(t.commentRequired, { label: logisticsDriver.expenseKinds.other }),
      errors.mock.logistics.expenseOtherComment,
    );
  });

  it('совпадают с примерами контракта и с MSW', () => {
    const dup = example('createExpenseCategory', 'validation_failed');
    assert.equal(dup.violations[0].message, t.duplicate);
    assert.equal(dup.detail, `${t.duplicate}.`);
    assert.equal(
      example('archiveExpenseCategory', 'invalid_transition').detail,
      t.otherNotArchivable,
    );
    const src = msw('expenses.ts');
    for (const s of [t.unknown, t.archived, t.duplicate, t.otherNotArchivable]) {
      assert.ok(src.includes(s), `MSW expenses.ts: нет «${s}»`);
    }
    assert.ok(
      src.includes('`Для категории «${label}» добавьте комментарий`'),
      'MSW: шаблон комментария',
    );
  });
});

describe('перемещение машины (W2.42)', () => {
  const t = errors.mock.logistics.vehicleMove;

  it('та же фирма, машина занята рейсом', () => {
    assert.deepEqual(t, {
      sameUnit: 'Машина уже в этой фирме',
      busy: 'Машина занята рейсом — перемещение после его закрытия.',
    });
    assert.equal(example('moveVehicle', 'validation_failed').violations[0].message, t.sameUnit);
    const src = msw('vehicles.ts');
    for (const s of Object.values(t)) assert.ok(src.includes(s), `MSW vehicles.ts: нет «${s}»`);
  });
});
