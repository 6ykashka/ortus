// Примеры ответов api/openapi/examples/<operationId>/<имя>.json (W0.07, бриф §4.6) и их проверка:
// ajv 2020-12 по схеме ответа из бандла, Problem-примеры — code = имя файла, статус из реестра.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadRegistry } from './errors.mjs';
import { operationsById } from './inventory.mjs';
import { EXAMPLES_DIR } from './paths.mjs';
import { NAMESPACE_URL, uuidv5 } from './uuid.mjs';
import { readJson } from './yaml-io.mjs';

/** Теги ядра: платформа, компания (доступ, модули, подписка), файлы, контекст, вход (W0.08). */
export const CORE_TAGS = ['Context', 'Auth', 'Platform', 'Billing', 'Access', 'Modules', 'Files'];

/** Персонажи пилота для getMyContext (прототип: демо-панель, PD-54 — вход ?persona=). */
export const PERSONAS = [
  'owner',
  'manager',
  'driver',
  'therapist',
  'foreman',
  'operator',
  'owner-lotos',
];

/** Идентификатор сида → UUID: v5 в пространстве URL от «ortus:<область>:<id прототипа>» (PD-30). */
export const seedUuid = (scope, id) => uuidv5(NAMESPACE_URL, `ortus:${scope}:${id}`);

/** @returns {Map<string, Map<string, unknown>>} operationId → имя примера → тело */
export function loadExamples(dir = EXAMPLES_DIR) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const files = readdirSync(join(dir, d.name)).filter((f) => f.endsWith('.json'));
    out.set(
      d.name,
      new Map(files.sort().map((f) => [f.slice(0, -5), readJson(join(dir, d.name, f))])),
    );
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Все строки-UUID в теле примера. */
export function collectUuids(node, out = []) {
  if (typeof node === 'string') {
    if (UUID_RE.test(node)) out.push(node);
  } else if (Array.isArray(node)) node.forEach((x) => collectUuids(x, out));
  else if (node && typeof node === 'object')
    Object.values(node).forEach((x) => collectUuids(x, out));
  return out;
}

function makeAjv(doc) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats(ajv);
  for (const f of ['int32', 'int64', 'float', 'double', 'byte', 'binary', 'password']) {
    ajv.addFormat(f, true);
  }
  ajv.addSchema(structuredClone(doc), 'ortus');
  return ajv;
}

const schemaOf = (doc, response) => {
  const r = response?.$ref ? doc.components.responses[response.$ref.split('/').pop()] : response;
  const content = r?.content ?? {};
  const media = content['application/json'] ?? content['application/problem+json'];
  return media?.schema;
};

/** Ссылки `#/…` схемы ответа → `ortus#/…` (схема бандла добавлена в ajv под id ortus). */
const rebase = (schema) =>
  JSON.parse(JSON.stringify(schema).replaceAll('"$ref":"#/', '"$ref":"ortus#/'));

/**
 * Покрытие ядра: у операции тегов CORE_TAGS есть пример ошибки и пример успеха, если у ответа
 * успеха есть тело (204 и редиректы 3xx входа — без тела, пример успеха не нужен).
 */
export function checkCoverage(doc, examples, registry = loadRegistry()) {
  const errors = [];
  for (const o of operationsById(doc).values()) {
    if (!CORE_TAGS.includes(o.tag)) continue;
    const names = [...(examples.get(o.operationId)?.keys() ?? [])];
    const problems = names.filter((n) => n in registry.codes);
    const success = Object.keys(o.op.responses).find((s) => /^[23]/.test(s));
    if (schemaOf(doc, o.op.responses[success]) && problems.length === names.length) {
      errors.push(`${o.operationId}: нет примера успеха`);
    }
    if (!problems.length) errors.push(`${o.operationId}: нет примера ошибки`);
  }
  const me = [...(examples.get('getMyContext')?.keys() ?? [])];
  for (const p of PERSONAS) if (!me.includes(p)) errors.push(`getMyContext: нет персонажа ${p}`);
  return errors;
}

/** UUID примеров — только из seed-ids.yaml, и карта воспроизводится UUID v5. */
export function checkSeedIds(examples, seed) {
  const errors = [];
  if (seed.namespace !== NAMESPACE_URL) errors.push(`seed-ids: namespace ≠ ${NAMESPACE_URL}`);
  const known = new Set();
  for (const [scope, map] of Object.entries(seed.ids ?? {})) {
    for (const [protoId, uuid] of Object.entries(map)) {
      if (uuid !== seedUuid(scope, protoId)) errors.push(`seed-ids: ${scope}:${protoId} ≠ UUID v5`);
      known.add(uuid);
    }
  }
  for (const [op, ex] of examples) {
    for (const [name, body] of ex) {
      for (const u of collectUuids(body)) {
        if (!known.has(u)) errors.push(`${op}/${name}: UUID ${u} нет в seed-ids.yaml`);
      }
    }
  }
  return errors;
}

/**
 * @param {object} doc бандл
 * @param {Map<string, Map<string, unknown>>} examples
 * @returns {string[]} ошибки «<operationId>/<имя>: …»
 */
export function checkExamples(doc, examples, registry = loadRegistry()) {
  const errors = [];
  const ops = operationsById(doc);
  const ajv = makeAjv(doc);
  const problem = ajv.compile({ $ref: 'ortus#/components/schemas/Problem' });
  for (const [opId, ex] of examples) {
    const o = ops.get(opId);
    if (!o) {
      errors.push(`${opId}: операции нет в бандле`);
      continue;
    }
    const success = Object.keys(o.op.responses).find((s) => /^2/.test(s));
    const successSchema = schemaOf(doc, o.op.responses[success]);
    const validateSuccess = successSchema ? ajv.compile(rebase(successSchema)) : null;
    for (const [name, body] of ex) {
      const where = `${opId}/${name}`;
      const entry = registry.codes[name];
      if (entry) {
        if (!problem(body)) errors.push(`${where}: не Problem — ${ajv.errorsText(problem.errors)}`);
        if (body?.code !== name) errors.push(`${where}: code ${body?.code} ≠ имени файла`);
        if (body?.status !== entry.status) {
          errors.push(`${where}: status ${body?.status} ≠ ${entry.status} из errors.yaml`);
        }
        if (!(String(entry.status) in o.op.responses) && !('default' in o.op.responses)) {
          errors.push(`${where}: операция не объявляет ответ ${entry.status}`);
        }
        continue;
      }
      if (!validateSuccess) {
        errors.push(`${where}: у ответа ${success} нет тела — пример успеха не нужен`);
        continue;
      }
      if (!validateSuccess(body)) {
        errors.push(`${where}: ${ajv.errorsText(validateSuccess.errors)}`);
      }
    }
  }
  return errors;
}
