// Покрытие conformance (W0.13, B §5.3 P4): у каждой операции этапа 1 (0.3.0-stage1 — 62, дальше больше) есть кейс успеха и кейс ошибки;
// каждый пример этих операций воспроизводится кейсом или записан в deviations.ts с причиной.
import { describe, expect, it } from 'vitest';

import { contract } from '../../src/msw/contract/index.ts';
import { ALL_CASES } from './cases/index.ts';
import { DEVIATIONS } from './deviations.ts';

const stage1 = contract.operations.filter((o) => o.stage1);
/** W2.00: операции тегов Fleet, Earnings, Home на экранах этапа 2 (screens.yaml). */
const stage2 = contract.operations.filter((o) => o.stage2);
/** W4.06, W4.07: операции тегов Calendar и Branding на экранах этапа 4 (core-calendar, company-branding). */
const stage4 = contract.operations.filter((o) => o.stage4);
/** W5.00: операции тега Cash на экранах кассы этапа 5 (screens.yaml). */
const stage5 = contract.operations.filter((o) => o.stage5);
const examples = [...stage1, ...stage2, ...stage4, ...stage5].flatMap((o) =>
  Object.keys(contract.examples[o.id] ?? {}).map((n) => `${o.id}/${n}`),
);

describe('покрытие conformance', () => {
  it('операции этапа 1 (не меньше 62), у каждой — кейс успеха и кейс ошибки', () => {
    expect(stage1.length).toBeGreaterThanOrEqual(62);
    const missing = stage1.flatMap((o) =>
      (['success', 'error'] as const)
        .filter((kind) => !ALL_CASES.some((c) => c.operationId === o.id && c.expect === kind))
        .map((kind) => `${o.id}: нет кейса ${kind}`),
    );
    expect(missing).toEqual([]);
  });

  it('операции экранов этапа 2 (W2.00, не меньше 28), у каждой — кейс успеха и кейс ошибки', () => {
    expect(stage2.length).toBeGreaterThanOrEqual(28);
    const missing = stage2.flatMap((o) =>
      (['success', 'error'] as const)
        .filter((kind) => !ALL_CASES.some((c) => c.operationId === o.id && c.expect === kind))
        .map((kind) => `${o.id}: нет кейса ${kind}`),
    );
    expect(missing).toEqual([]);
  });

  it('операции экранов этапа 4 тегов Calendar (W4.06) и Branding (W4.07), у каждой — кейс успеха и кейс ошибки', () => {
    expect(stage4.length).toBeGreaterThanOrEqual(5);
    const missing = stage4.flatMap((o) =>
      (['success', 'error'] as const)
        .filter((kind) => !ALL_CASES.some((c) => c.operationId === o.id && c.expect === kind))
        .map((kind) => `${o.id}: нет кейса ${kind}`),
    );
    expect(missing).toEqual([]);
  });

  it('операции экранов кассы этапа 5 (W5.00, не меньше 26), у каждой — кейс успеха и кейс ошибки', () => {
    expect(stage5.length).toBeGreaterThanOrEqual(26);
    const missing = stage5.flatMap((o) =>
      (['success', 'error'] as const)
        .filter((kind) => !ALL_CASES.some((c) => c.operationId === o.id && c.expect === kind))
        .map((kind) => `: нет кейса ${kind}`),
    );
    expect(missing).toEqual([]);
  });

  it('каждый пример этапов 1, 2, 4 и 5 воспроизведён кейсом или записан в deviations.ts', () => {
    const covered = new Set(ALL_CASES.flatMap((c) => (c.example ? [c.example] : [])));
    const scenario = new Set(DEVIATIONS.filter((d) => d.kind === 'scenario').map((d) => d.example));
    expect(examples.filter((e) => !covered.has(e) && !scenario.has(e))).toEqual([]);
  });

  it('расхождения ссылаются на существующие примеры, у каждого — причина', () => {
    for (const d of DEVIATIONS) {
      expect(examples, d.example).toContain(d.example);
      expect(d.reason.length, d.example).toBeGreaterThan(20);
      if (d.kind !== 'scenario') {
        expect(
          ALL_CASES.some((c) => c.example === d.example),
          d.example,
        ).toBe(true);
      }
    }
  });

  it('кейсы — операций контракта, id уникальны', () => {
    const ids = new Set(contract.operations.map((o) => o.id));
    expect(ALL_CASES.filter((c) => !ids.has(c.operationId)).map((c) => c.id)).toEqual([]);
    const caseIds = ALL_CASES.map((c) => c.id);
    expect(caseIds.filter((id, i) => caseIds.indexOf(id) !== i)).toEqual([]);
  });
});
