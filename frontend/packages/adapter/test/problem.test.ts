// Problem сценарного сервера (W0.13) и машиночитаемая причина Problem.reason контракта 0.7.0-stage4 (W4.02): тело — как
// пример transitionTask/invalid_transition (api/openapi/examples), причина — после requestId, только из реестра кода
// (codes.<code>.reasons api/errors.yaml), у кода без причин поля нет.
import { describe, expect, it } from 'vitest';

import { ProblemError, problemBody } from '../src/msw/core/problem.ts';

describe('Problem.reason (W4.02)', () => {
  it('причина отказа перехода — после requestId, как в примере контракта', () => {
    const body = problemBody(
      new ProblemError('invalid_transition', 'Сначала закройте чек-лист', {
        reason: 'checklist_open',
      }),
      '01J9Z4QK8M6T2V5X7Y9A1B3C5D',
    );
    expect(JSON.stringify(body)).toBe(
      JSON.stringify({
        type: 'https://docs.ortus.example/errors/invalid_transition',
        title: 'Переход статуса не разрешён',
        status: 409,
        code: 'invalid_transition',
        detail: 'Сначала закройте чек-лист',
        requestId: '01J9Z4QK8M6T2V5X7Y9A1B3C5D',
        reason: 'checklist_open',
      }),
    );
  });

  it('без причины поля reason нет', () => {
    const body = problemBody(new ProblemError('invalid_transition', 'Перечитайте задачу'), 'rid');
    expect(body).not.toHaveProperty('reason');
  });

  it('причины нет в реестре кода — поле не отдаётся (ошибка мока, не контракт)', () => {
    const body = problemBody(
      new ProblemError('forbidden_action', 'Нет права', { reason: 'checklist_open' }),
      'rid',
    );
    expect(body).not.toHaveProperty('reason');
  });
});
