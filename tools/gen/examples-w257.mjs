// Примеры контрактной дельты W2.57 (0.6.2-stage2, решение Q-W2.07-1): продление временного назначения. Подключается в
// tools/gen/examples-seed.mjs после примеров W2.52. Сюжет на сиде логистики 14.10 — запрос Водителя #104 «Юг Транс» на
// рейс Р-211 «Север Логистик», одобренный владельцем (decideDriverTransfer/ok W2.51): владелец продлевает окно 14:00–18:00
// до 19:00 по Москве (конец свободного окна публикации — 19:00). Его воспроизводит кейс conformance
// adapter/test/conformance/cases/pool.ts (PD-43). Время — UTC (сид — Москва, UTC+3).

/** Новый конец окна Р-211 — 19:00 по Москве. */
export const EXTENDED_UNTIL = '2026-10-01T16:00:00Z';

/**
 * @param {{ prior: Record<string, Record<string, unknown>> }} deps примеры, собранные раньше (W2.51)
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage2w257Examples({ prior }) {
  const approved = prior.decideDriverTransfer?.ok;
  if (!approved) throw new Error('examples-w257: нет decideDriverTransfer/ok (W2.51)');
  const extended = structuredClone(approved);
  extended.window.endsAt = EXTENDED_UNTIL;
  extended.revision = approved.revision + 1;
  extended.grant.validUntil = EXTENDED_UNTIL;
  return { decideDriverTransfer: { extended } };
}
