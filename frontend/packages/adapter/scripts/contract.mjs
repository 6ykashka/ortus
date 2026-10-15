// Выжимка контракта для сценарного сервера (W0.13): src/msw/contract/contract.gen.json.
//   node scripts/contract.mjs          — (пере)записать
//   node scripts/contract.mjs --check  — сравнить без записи; exit 1 при дрейфе
// Источники (только чтение, пишет стюард): api/dist/ortus.bundle.yaml (0.3.0-stage1), api/errors.yaml,
// api/permissions.yaml, api/openapi/examples/** и seed-ids.yaml. Браузер YAML не читает: сервер берёт всё отсюда.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as prettier from 'prettier';
import YAML from 'yaml';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(PKG, '..', '..', '..');

export const OUT = join(PKG, 'src', 'msw', 'contract', 'contract.gen.json');

/** Теги этапа 1 (W0.08): ядро 0.1 и Auth — у их операций есть примеры (CORE_TAGS генератора W0.07). */
export const STAGE1_TAGS = ['Context', 'Auth', 'Platform', 'Billing', 'Access', 'Modules', 'Files'];

const METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

const readYaml = (path) => YAML.parse(readFileSync(path, 'utf8'), { maxAliasCount: -1 });

const paramName = (doc, p) =>
  p.$ref ? doc.components.parameters[p.$ref.split('/').pop()]?.name : p.name;

const responseOf = (doc, r) => (r?.$ref ? doc.components.responses[r.$ref.split('/').pop()] : r);

/** Ключевые слова JSON Schema, которые проверяет валидатор тела запроса (src/msw/core/validate.ts). */
const KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'oneOf',
  'anyOf',
  'allOf',
  'minProperties',
]);

/** Схема тела без $ref (ссылки раскрыты), только проверяемые ключевые слова. */
function inline(doc, schema, seen = new Set()) {
  if (Array.isArray(schema)) return schema.map((s) => inline(doc, s, seen));
  if (!schema || typeof schema !== 'object') return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    if (seen.has(name)) return {};
    return inline(doc, doc.components.schemas[name], new Set([...seen, name]));
  }
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!KEYWORDS.has(k)) continue;
    if (k === 'properties') {
      out[k] = Object.fromEntries(Object.entries(v).map(([p, s]) => [p, inline(doc, s, seen)]));
    } else if (['items', 'additionalProperties', 'oneOf', 'anyOf', 'allOf'].includes(k)) {
      out[k] = inline(doc, v, seen);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function operations(doc) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const method = m.toUpperCase();
      const names = (op.parameters ?? []).map((p) => paramName(doc, p));
      const statuses = Object.keys(op.responses)
        .filter((s) => /^\d{3}$/.test(s))
        .map(Number);
      const success = statuses.find((s) => s >= 200 && s < 400);
      const ok = responseOf(doc, op.responses[String(success)]);
      const body = ok?.content?.['application/json'];
      const request = op.requestBody?.content?.['application/json']?.schema;
      const o = {
        id: op.operationId,
        method,
        path,
        tag: op.tags?.[0] ?? '',
        stage1: STAGE1_TAGS.includes(op.tags?.[0]),
        permissions: op['x-permissions'] ?? [],
        mode: op['x-permissions-mode'] ?? 'all',
        scope: op['x-scope'] ?? '',
        public: Array.isArray(op.security) && op.security.length === 0,
        mutating: !SAFE.has(method),
        ifMatch: names.includes('If-Match'),
        idempotent: names.includes('Idempotency-Key'),
        statuses,
        success,
        successBody: Boolean(body?.schema),
        etag: 'ETag' in (ok?.headers ?? {}),
      };
      if (op['x-field-permissions']) o.fieldPermissions = op['x-field-permissions'];
      if (request) o.request = inline(doc, request);
      out.push(o);
    }
  }
  return out;
}

function errors(registry) {
  return Object.fromEntries(
    Object.entries(registry.codes).map(([code, e]) => [
      code,
      { status: e.status, title: e.title, retryable: e.retryable },
    ]),
  );
}

function permissions(catalog) {
  const actions = [];
  const modules = {};
  for (const [module, m] of Object.entries(catalog.modules)) {
    modules[module] = {
      label: m.label,
      dependsOn: m.depends_on ?? [],
      system: Boolean(m.system),
      actions: Object.keys(m.actions ?? {}),
    };
    for (const [key, a] of Object.entries(m.actions ?? {})) {
      const x = { key, module, label: a.label, scopes: a.scopes ?? [] };
      if (a.level) x.level = a.level;
      if (a.sensitivity) x.sensitivity = a.sensitivity;
      if (a.owner_only) x.ownerOnly = true;
      actions.push(x);
    }
  }
  const roleTemplates = {};
  for (const [name, t] of Object.entries(catalog.role_templates ?? {})) {
    const x = {
      label: t.label,
      actions: t.actions ?? [],
      optionalRestricted: t.optional_restricted ?? [],
    };
    if (t.kind) x.kind = t.kind;
    if (t.default_scope) x.defaultScope = t.default_scope;
    if (t.work_function) x.workFunction = t.work_function;
    roleTemplates[name] = x;
  }
  const renames = Object.fromEntries(
    Object.entries(catalog.prototype_renames ?? {}).map(([k, v]) => [
      k,
      v === null ? [] : [v].flat(),
    ]),
  );
  return { actions, modules, roleTemplates, renames };
}

function examples(dir, ops) {
  const out = {};
  for (const o of ops.filter((x) => x.stage1)) {
    const d = join(dir, o.id);
    if (!existsSync(d)) continue;
    out[o.id] = Object.fromEntries(
      readdirSync(d)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(d, f), 'utf8'))]),
    );
  }
  return out;
}

/** Выжимка контракта из каталога `api/` репозитория `root`. */
export function buildContract(root = ROOT) {
  const doc = readYaml(join(root, 'api', 'dist', 'ortus.bundle.yaml'));
  const ops = operations(doc);
  const exDir = join(root, 'api', 'openapi', 'examples');
  return {
    version: doc.info.version,
    operations: ops,
    errors: errors(readYaml(join(root, 'api', 'errors.yaml'))),
    permissions: permissions(readYaml(join(root, 'api', 'permissions.yaml'))),
    examples: examples(exDir, ops),
    seedIds: readYaml(join(exDir, 'seed-ids.yaml')).ids,
  };
}

/** Текст файла: JSON в формате Prettier репозитория (его же проверяет `prettier --check .`). */
export async function renderContract(contract) {
  const config = (await prettier.resolveConfig(OUT)) ?? {};
  return prettier.format(JSON.stringify(contract), { ...config, filepath: OUT });
}

async function main() {
  const text = await renderContract(buildContract());
  const check = process.argv.includes('--check');
  const actual = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (check) {
    if (actual !== text) {
      console.error('contract.gen.json устарел: corepack pnpm --filter @ortus/adapter run gen');
      return 1;
    }
    console.log('contract.gen.json свежий');
    return 0;
  }
  if (actual !== text) writeFileSync(OUT, text, 'utf8');
  console.log(`contract.gen.json: ${actual === text ? 'без изменений' : 'записан'}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main();
}
