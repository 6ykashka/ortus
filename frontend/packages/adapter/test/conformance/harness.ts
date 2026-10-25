// Цель conformance режима mock (W0.13): сценарный сервер за msw/node — запросы идут обычным `fetch`, как
// у приложения. Каждый ответ проверяется по OpenAPI (schema.ts); кейс получает CaseContext.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { seedUuid } from '@ortus/domain/seed';
import { expect } from 'vitest';

import { contract, example } from '../../src/msw/contract/index.ts';
import { createNodeServer } from '../../src/msw/node.ts';
import { Client, type Reply } from './client.ts';
import { prepare, snapshot } from './compare.ts';
import { deviationOf } from './deviations.ts';
import { checkReply } from './schema.ts';
import type { CaseContext } from './types.ts';

export const BASE = 'http://127.0.0.1:5217';

/**
 * Пересъёмка примеров (PD-43, `corepack pnpm --filter @ortus/adapter run examples -- --write`): пример без
 * расхождения, который сервер отдаёт иначе, переписывается снимком ответа; путь пишется в журнал для Prettier.
 */
const WRITE = process.env.ORTUS_EXAMPLES_WRITE === '1';
const EXAMPLES = new URL('../../../../../api/openapi/examples/', import.meta.url);

function writeExample(op: string, name: string, body: unknown): void {
  const file = new URL(`${op}/${name}.json`, EXAMPLES);
  mkdirSync(fileURLToPath(new URL(op, EXAMPLES)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  const log = process.env.ORTUS_EXAMPLES_LOG;
  if (log) appendFileSync(log, `${fileURLToPath(file)}\n`, 'utf8');
}

const sorted = (node: unknown): unknown =>
  Array.isArray(node)
    ? node.map(sorted)
    : node && typeof node === 'object'
      ? Object.fromEntries(
          Object.keys(node)
            .sort()
            .map((k) => [k, sorted((node as Record<string, unknown>)[k])]),
        )
      : node;

export interface Harness {
  ctx: CaseContext;
  replies: Reply[];
  schemaErrors: string[];
  checkedExamples: string[];
  listen(): void;
  close(): void;
  reset(): void;
}

export function createHarness(): Harness {
  const { server: msw, scenario } = createNodeServer();
  const replies: Reply[] = [];
  const schemaErrors: string[] = [];
  const checkedExamples: string[] = [];
  const api = new Client({ base: BASE, fetch: (r) => fetch(r) }, [
    (r) => {
      replies.push(r);
      schemaErrors.push(...checkReply(r));
    },
  ]);
  const P = (id: string) => seedUuid('platform', id);
  const ctx: CaseContext = {
    api,
    as: (persona) => api.as(persona),
    anon: () => api.anon(),
    server: scenario,
    P,
    A: (id) => seedUuid('t-alta', id),
    L: (id) => seedUuid('t-lotos', id),
    alta: `/api/v1/tenants/${P('t-alta')}`,
    lotos: `/api/v1/tenants/${P('t-lotos')}`,
    example: (name) => {
      const [op = '', n = ''] = name.split('/');
      const body = example(op, n);
      if (body === undefined) throw new Error(`нет примера ${name}`);
      return structuredClone(body);
    },
    expectExample: (reply, name, status) => {
      const [op = '', n = ''] = name.split('/');
      // W6.00: пример, которого ещё нет, при пересъёмке записывается снимком ответа (первая съёмка тега).
      if (WRITE && example(op, n) === undefined) {
        const problemName = n in contract.errors;
        const wanted =
          status ??
          (problemName
            ? contract.errors[n]?.status
            : contract.operations.find((o) => o.id === op)?.success);
        expect(reply.status, `${name}: ${JSON.stringify(reply.body)}`).toBe(wanted);
        writeExample(op, n, reply.body);
        checkedExamples.push(name);
        return;
      }
      const body = ctx.example(name) as { status?: number };
      const problem = n in contract.errors;
      const want =
        status ?? (problem ? body.status : contract.operations.find((o) => o.id === op)?.success);
      expect(reply.status, `${name}: ${JSON.stringify(reply.body)}`).toBe(want);
      const deviation = deviationOf(name);
      const { expected, actual } = prepare(body, reply.body, deviation);
      if (
        WRITE &&
        !deviation &&
        JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))
      ) {
        writeExample(op, n, snapshot(body, reply.body));
      } else {
        expect(actual, name).toEqual(expected);
      }
      checkedExamples.push(name);
    },
    expectProblem: (reply, code) => {
      expect(reply.body, `${reply.operationId} ${reply.status}`).toMatchObject({ code });
      expect(reply.status).toBe(contract.errors[code]?.status);
    },
  };
  return {
    ctx,
    replies,
    schemaErrors,
    checkedExamples,
    listen: () => msw.listen({ onUnhandledRequest: 'error' }),
    close: () => msw.close(),
    reset: () => {
      scenario.reset();
      replies.length = 0;
      schemaErrors.length = 0;
      checkedExamples.length = 0;
    },
  };
}
