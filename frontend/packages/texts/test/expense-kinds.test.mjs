// W2.40 · Подписи категорий расходов по ответу владельца продукта 17.10 на D-12 комплекта (ADR-0013) и текст
// ошибки «прочее без комментария» — одна строка для MSW, примера контракта и экрана водителя (W2.22).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { errors, logisticsDriver } from '../src/index.ts';
import { ROOT } from './_util.mjs';

describe('категории расходов (контракт 0.5.1-stage2)', () => {
  it('шесть кодов TripExpenseCreate.kind в порядке ответа владельца, подписи дословно', () => {
    assert.deepEqual(logisticsDriver.expenseKinds, {
      fuel: 'Топливо',
      wash: 'Мойка',
      parking: 'Парковка',
      toll: 'Платная дорога',
      tire_service: 'Шиномонтаж и мелкий ремонт',
      other: 'Прочее',
    });
  });

  it('«прочее» без комментария — текст словаря совпадает с примером контракта createTripExpense', () => {
    const msg = errors.mock.logistics.expenseOtherComment;
    assert.equal(msg, `Для категории «${logisticsDriver.expenseKinds.other}» добавьте комментарий`);
    const example = JSON.parse(
      readFileSync(
        join(ROOT, 'api/openapi/examples/createTripExpense/validation_failed.json'),
        'utf8',
      ),
    );
    assert.equal(example.detail, msg);
    assert.deepEqual(example.violations, [{ field: 'comment', code: 'required', message: msg }]);
  });
});
