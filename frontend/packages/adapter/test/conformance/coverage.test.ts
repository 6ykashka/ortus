// Покрытие conformance (W0.13, B §5.3 P4): у каждой из 62 операций этапа 1 есть кейс успеха и кейс ошибки;
// каждый пример этих операций воспроизводится кейсом или записан в deviations.ts с причиной.
import { describe, expect, it } from 'vitest';

import { contract } from '../../src/msw/contract/index.ts';
import { ALL_CASES } from './cases/index.ts';
import { DEVIATIONS } from './deviations.ts';

const stage1 = contract.operations.filter((o) => o.stage1);
const examples = stage1.flatMap((o) =>
  Object.keys(contract.examples[o.id] ?? {}).map((n) => `${o.id}/${n}`),
);

describe('покрытие conformance', () => {
  it('62 операции этапа 1, у каждой — кейс успеха и кейс ошибки', () => {
    expect(stage1).toHaveLength(62);
    const missing = stage1.flatMap((o) =>
      (['success', 'error'] as const)
        .filter((kind) => !ALL_CASES.some((c) => c.operationId === o.id && c.expect === kind))
        .map((kind) => `${o.id}: нет кейса ${kind}`),
    );
    expect(missing).toEqual([]);
  });

  it('каждый пример этапа 1 воспроизведён кейсом или записан в deviations.ts', () => {
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
