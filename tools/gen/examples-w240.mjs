// Примеры аддитивного PR стюарда этапа 2 (W2.40, 0.5.1-stage2) — ответ владельца продукта 17.10 на D-12 комплекта.
// Подключается в tools/gen/examples-seed.mjs после примеров W2.00. Сюжет воспроизводит кейс conformance
// adapter/test/conformance/cases/fleet-w240.ts (PD-43): водитель Р-208 в рейсе добавляет расход «Прочее» без
// комментария — 422 validation_failed с полем comment.

/** Текст ошибки поля comment — `@ortus/texts` errors.mock.logistics.expenseOtherComment. */
export const OTHER_COMMENT = 'Для категории «Прочее» добавьте комментарий';

/** @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело */
export function stage2w240Examples({ problem }) {
  return {
    createTripExpense: {
      validation_failed: problem('validation_failed', OTHER_COMMENT, {
        violations: [{ field: 'comment', code: 'required', message: OTHER_COMMENT }],
      }),
    },
  };
}
