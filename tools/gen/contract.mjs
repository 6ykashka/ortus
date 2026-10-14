// Конвейер контракта Ортус (W0.07).
//   node tools/gen/contract.mjs          — сгенерировать производные файлы и бандл api/dist/ortus.bundle.yaml
//   node tools/gen/contract.mjs --check  — все проверки контракта без записи; exit 1 при ошибке
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundle, serializeBundle } from './lib/bundle.mjs';
import {
  checkBundleProblem,
  checkRegistry,
  loadRegistry,
  PROBLEM_CODE_FILE,
  renderProblemCode,
} from './lib/errors.mjs';
import { checkCoverage, checkExamples, checkSeedIds, loadExamples } from './lib/examples.mjs';
import { listOperations } from './lib/inventory.mjs';
import { abs, BUNDLE_PATH, ROOT, SCREENS_PATH, SEED_IDS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { checkScreens } from './lib/screens.mjs';
import { checkCatalog, flattenActions, loadCatalog } from './lib/permissions.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { validateOpenApi } from './lib/validate.mjs';
import { ERROR, runSpectral } from './lib/spectral.mjs';
import { format, readJson, readYaml, writeText } from './lib/yaml-io.mjs';

/** Операций в OpenAPI 0.1 (C «Сводка»: проверено выгрузкой operationId). */
export const SOURCE_OPERATIONS = 118;

/** Ключи прав прототипа 14.10 (выписка из ortus/models.js). */
const PROTOTYPE_PERM_KEYS = abs('tools/gen/fixtures/prototype-perm-keys-14.10.json');

const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');

/**
 * Словари правил Spectral — ES-модуль рядом с функциями (импортирует _dictionaries.js): правила
 * не читают файлов и не зависят от каталога запуска Spectral.
 */
export const DICTIONARIES_FILE = abs('api/spectral/functions/_dictionaries.gen.js');

/** Производные файлы исходника (генерируются до бандла): [путь, текст]. */
export async function derivedFiles() {
  const registry = loadRegistry();
  const dictionaries = {
    permissions: [...flattenActions(loadCatalog()).keys()].sort(),
    problemCodes: Object.keys(registry.codes),
  };
  const js =
    '// Сгенерировано node tools/gen/contract.mjs из api/permissions.yaml и api/errors.yaml.\n' +
    '// Руками не править: словари правил Spectral (api/spectral/functions/_dictionaries.js).\n' +
    `export default ${JSON.stringify(dictionaries, null, 2)};\n`;
  return [
    [PROBLEM_CODE_FILE, await renderProblemCode(registry)],
    [DICTIONARIES_FILE, await format(js, DICTIONARIES_FILE)],
  ];
}

/** Проверки контракта: [имя, () => { errors: string[], summary?: string }]. */
export function checks(ctx) {
  const { doc, files } = ctx;
  return [
    [
      'drift',
      () => {
        const errors = [];
        for (const [path, text] of files) {
          const actual = existsSync(path) ? readFileSync(path, 'utf8') : null;
          if (actual !== text) {
            errors.push(`${rel(path)} устарел: запустите node tools/gen/contract.mjs`);
          }
        }
        return { errors, summary: `${files.length} generated files clean` };
      },
    ],
    [
      'source',
      () => {
        const source = readYaml(SOURCE_0_1);
        const deltas = loadDeltas();
        const { errors } = checkAgainstSource(doc, source, deltas);
        const ids = new Set(listOperations(doc).map((o) => o.operationId));
        const missing = listOperations(source).filter((o) => !ids.has(o.operationId));
        const total = listOperations(source).length;
        if (total !== SOURCE_OPERATIONS) errors.push(`в 0.1 ${total} операций, ожидалось 118`);
        for (const o of missing) errors.push(`операция 0.1 пропала: ${o.operationId}`);
        return { errors, summary: `${total} operations of 0.1 preserved, ${deltas.length} deltas` };
      },
    ],
    [
      'validate',
      async () => {
        const { errors, version } = await validateOpenApi(doc);
        return { errors, summary: `OpenAPI ${version} schema valid` };
      },
    ],
    [
      'errors',
      () => {
        const registry = loadRegistry();
        const errors = [...checkRegistry(registry), ...checkBundleProblem(doc, registry)];
        return {
          errors,
          summary: `${Object.keys(registry.codes).length} codes = enum ProblemCode`,
        };
      },
    ],
    [
      'permissions',
      () => {
        const catalog = loadCatalog();
        const prototypeKeys = readJson(PROTOTYPE_PERM_KEYS).keys;
        const errors = checkCatalog(catalog, doc, prototypeKeys);
        const n = errors.length ? '?' : flattenActions(catalog).size;
        return {
          errors,
          summary: `${n} permissions; every x-permissions, x-field-permissions in catalog`,
        };
      },
    ],
    [
      'examples',
      () => {
        const examples = loadExamples();
        const errors = [
          ...checkExamples(doc, examples),
          ...checkCoverage(doc, examples),
          ...checkSeedIds(examples, readYaml(SEED_IDS_PATH)),
        ];
        const n = [...examples.values()].reduce((s, m) => s + m.size, 0);
        return {
          errors,
          summary: `${n} examples for ${examples.size} operations valid (ajv 2020-12)`,
        };
      },
    ],
    [
      'screens',
      () => {
        const screens = readYaml(SCREENS_PATH);
        const errors = checkScreens(doc, screens);
        return { errors, summary: `${Object.keys(screens.screens).length} screens` };
      },
    ],
    [
      'spectral',
      () => {
        const results = runSpectral([BUNDLE_PATH]);
        const errors = results
          .filter((r) => r.severity === ERROR)
          .map((r) => `${r.code} ${r.path.join('.')}: ${r.message}`);
        const warnings = results.length - errors.length;
        return { errors, summary: `0 errors, ${warnings} warnings (api/.spectral.yaml)` };
      },
    ],
  ];
}

export async function run({ check }) {
  const derived = await derivedFiles();
  if (!check) for (const [path, text] of derived) writeText(path, text);
  const doc = bundle();
  const files = [...derived, [BUNDLE_PATH, await serializeBundle(doc)]];
  if (!check) {
    writeText(BUNDLE_PATH, files.at(-1)[1]);
    for (const [path] of files) console.log(`wrote ${rel(path)}`);
    console.log(`bundle: ${listOperations(doc).length} operations`);
    return 0;
  }
  let failed = 0;
  for (const [name, fn] of checks({ doc, files })) {
    const { errors, summary } = await fn();
    if (errors.length) {
      failed++;
      console.error(`FAIL ${name}:`);
      for (const e of errors) console.error(`  - ${e}`);
    } else {
      console.log(`ok   ${name}${summary ? `: ${summary}` : ''}`);
    }
  }
  if (failed) {
    console.error(`FAIL: ${failed} check(s)`);
    return 1;
  }
  const examples = [...loadExamples().values()].reduce((s, m) => s + m.size, 0);
  const counts = [
    `${listOperations(doc).length} operations`,
    `${Object.keys(doc.paths).length} paths`,
    `${doc.tags.length} tags`,
    `${Object.keys(loadRegistry().codes).length} codes`,
    `${flattenActions(loadCatalog()).size} permissions`,
    `${examples} examples`,
    `${Object.keys(readYaml(SCREENS_PATH).screens).length} screens`,
  ];
  console.log(`OK: ${counts.join(', ')}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run({ check: process.argv.includes('--check') });
}
