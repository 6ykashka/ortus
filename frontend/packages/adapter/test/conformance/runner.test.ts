// Раннер conformance (W0.13, B §5.3 P4): кейсы модулей против сценарного сервера за msw/node. После каждого
// кейса: все ответы соответствуют OpenAPI (ajv), операция кейса ответила успехом или ошибкой, как заявлено,
// заявленный пример сверен. Примеры, которые сервер даёт только сценарием, сверяются через X-Test-Scenario.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { operation } from '../../src/msw/contract/index.ts';
import { ALL_CASES } from './cases/index.ts';
import { DEVIATIONS } from './deviations.ts';
import { createHarness } from './harness.ts';

const h = createHarness();

beforeAll(() => h.listen());
afterAll(() => h.close());
beforeEach(() => h.reset());

const modules = [...new Set(ALL_CASES.map((c) => c.module))];

for (const module of modules) {
  describe(`conformance: ${module}`, () => {
    for (const c of ALL_CASES.filter((x) => x.module === module)) {
      it(`${c.operationId}: ${c.title}`, async () => {
        await c.run(h.ctx);
        expect(h.schemaErrors, 'ответы вне контракта').toEqual([]);
        const hit = h.replies.some(
          (r) =>
            r.operationId === c.operationId &&
            (c.expect === 'success' ? r.status >= 200 && r.status < 400 : r.status >= 400),
        );
        expect(hit, `${c.operationId}: нет ответа «${c.expect}»`).toBe(true);
        if (c.example) expect(h.checkedExamples).toContain(c.example);
      });
    }
  });
}

describe('conformance: примеры, которые сервер отдаёт только сценарием', () => {
  for (const d of DEVIATIONS.filter((x) => x.kind === 'scenario')) {
    it(`${d.example}: X-Test-Scenario`, async () => {
      const [opId = '', code = ''] = d.example.split('/');
      const op = operation(opId);
      const path = op.path
        .replace('{tenantId}', h.ctx.P('t-alta'))
        .replace(/\{[^}]+\}/g, '00000000-0000-5000-8000-000000000000');
      const r = await h.ctx.anon().request(op.method, path, { scenario: `${opId}=${code}` });
      h.ctx.expectExample(r, d.example);
      expect(h.schemaErrors).toEqual([]);
    });
  }
});
