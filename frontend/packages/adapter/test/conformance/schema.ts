// Схемная проверка ответов conformance (W0.13): ajv 2020-12 по бандлу api/dist/ortus.bundle.yaml — тело ответа
// по схеме объявленного статуса операции (application/json или application/problem+json), статус объявлен,
// у успеха с ETag в контракте — заголовок ETag, у всех ответов — X-Request-Id и Cache-Control.
import { readFileSync } from 'node:fs';

import type { ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

import { operation } from '../../src/msw/contract/index.ts';
import type { Reply } from './client.ts';

const BUNDLE = new URL('../../../../../api/dist/ortus.bundle.yaml', import.meta.url);

interface Doc {
  paths: Record<
    string,
    Record<string, { operationId?: string; responses?: Record<string, unknown> }>
  >;
  components: { responses: Record<string, Response> };
}
interface Media {
  schema?: unknown;
}
interface Response {
  $ref?: string;
  content?: Record<string, Media>;
}

const doc = YAML.parse(readFileSync(BUNDLE, 'utf8'), { maxAliasCount: -1 }) as Doc;

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
addFormats(ajv);
for (const f of ['int32', 'int64', 'float', 'double', 'byte', 'binary', 'password']) {
  ajv.addFormat(f, true);
}
ajv.addSchema(structuredClone(doc), 'ortus');

const responsesOf = new Map<string, Record<string, unknown>>();
for (const item of Object.values(doc.paths)) {
  for (const op of Object.values(item)) {
    if (op?.operationId) responsesOf.set(op.operationId, op.responses ?? {});
  }
}

const cache = new Map<string, ValidateFunction | null>();
const problem = ajv.compile({ $ref: 'ortus#/components/schemas/Problem' });

function validatorOf(opId: string, status: number): ValidateFunction | null | undefined {
  const key = `${opId}:${status}`;
  if (cache.has(key)) return cache.get(key);
  const responses = responsesOf.get(opId) ?? {};
  let r = (responses[String(status)] ?? responses.default) as Response | undefined;
  if (!r) return undefined;
  if (r.$ref) r = doc.components.responses[r.$ref.split('/').pop() ?? ''];
  const media = r?.content?.['application/json'] ?? r?.content?.['application/problem+json'];
  const v = media?.schema
    ? ajv.compile(
        JSON.parse(JSON.stringify(media.schema).replaceAll('"$ref":"#/', '"$ref":"ortus#/')),
      )
    : null;
  cache.set(key, v);
  return v;
}

/** Нарушения контракта в ответе (пустой список — ответ соответствует OpenAPI). */
export function checkReply(r: Reply): string[] {
  if (!r.operationId || r.status === 0) return [];
  const where = `${r.operationId} ${r.status}`;
  const errors: string[] = [];
  const op = operation(r.operationId);
  if (r.status === 501 && !op.stage1) {
    // Операции этапов 2+ до своих владельцев отвечают 501, как стенд (W0.09): тело — Problem.
    if (!problem(r.body)) errors.push(`${where}: ${ajv.errorsText(problem.errors)}`);
    return errors;
  }
  const v = validatorOf(r.operationId, r.status);
  if (v === undefined) {
    errors.push(`${where}: статус не объявлен в контракте`);
  } else if (v === null) {
    if (r.body !== undefined) errors.push(`${where}: у ответа нет тела по контракту`);
  } else if (!v(r.body)) {
    errors.push(`${where}: ${ajv.errorsText(v.errors)}`);
  }
  if (!r.headers.get('X-Request-Id')) errors.push(`${where}: нет X-Request-Id`);
  if (r.headers.get('Cache-Control') !== 'private, no-store') {
    errors.push(`${where}: Cache-Control не private, no-store`);
  }
  if (op.etag && r.status === op.success && !/^"rev-\d+"$/.test(r.headers.get('ETag') ?? '')) {
    errors.push(`${where}: нет ETag`);
  }
  return errors;
}
