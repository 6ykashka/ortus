// Одноразовая раскладка OpenAPI 0.1 по тегам (W0.07, PD-56). Остаётся в репозитории для
// воспроизводимости: `node tools/gen/openapi-split.mjs` из design/docs/v0.1 пишет api/openapi/
// (ortus.yaml, paths/<tag>.yaml, components/<группа>/<вид>.yaml). После раскладки исходником
// контракта считается api/openapi/; повторный запуск затрёт правки стюарда — только с --force.
import { existsSync, rmSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KINDS } from './lib/bundle.mjs';
import { listOperations } from './lib/inventory.mjs';
import { OPENAPI_DIR, SOURCE_0_1 } from './lib/paths.mjs';
import { collectRefs, fragment, mapRefs, parseRef } from './lib/refs.mjs';
import { readYaml, renderYaml, writeText } from './lib/yaml-io.mjs';

export const tagSlug = (tag) => tag.toLowerCase();

/** `#/components/<вид>/<Имя>/…` → { kind, name, rest } */
function componentOf(ref) {
  const { file, tokens } = parseRef(ref);
  if (file || tokens[0] !== 'components' || tokens.length < 3) {
    throw new Error(`неожиданная ссылка в 0.1: ${ref}`);
  }
  return { kind: tokens[1], name: tokens[2], rest: tokens.slice(3) };
}

/**
 * Раскладывает документ 0.1.
 * @returns {Map<string, {value: object, header: string}>} относительный путь в api/openapi → содержимое
 */
export function splitSpec(src) {
  const ops = listOperations(src);
  const pathTag = new Map();
  for (const o of ops) {
    if (o.op.tags?.length !== 1) throw new Error(`${o.operationId}: ровно один тег`);
    const prev = pathTag.get(o.path);
    if (prev && prev !== o.tag) throw new Error(`путь ${o.path}: операции разных тегов`);
    pathTag.set(o.path, o.tag);
  }

  // Замыкание ссылок по компонентам: какие схемы нужны каждому тегу.
  const comp = src.components;
  const deps = (kind, name) => collectRefs(comp[kind][name]).map(componentOf);
  const usage = new Map(); // schemas/<Имя> → Set<tag>
  for (const [p, item] of Object.entries(src.paths)) {
    const tag = pathTag.get(p);
    const seen = new Set();
    const queue = collectRefs(item).map(componentOf);
    while (queue.length) {
      const { kind, name } = queue.shift();
      const key = `${kind}/${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (kind === 'schemas') {
        if (!usage.has(name)) usage.set(name, new Set());
        usage.get(name).add(tag);
      }
      queue.push(...deps(kind, name));
    }
  }
  const groupOf = (kind, name) => {
    if (kind !== 'schemas') return 'common';
    const tags = usage.get(name);
    return tags && tags.size === 1 ? tagSlug([...tags][0]) : 'common';
  };

  /** Ссылка 0.1 → относительная ссылка из файла `fromFile` (posix, от api/openapi). */
  const relRef = (fromFile) => (ref) => {
    const { kind, name, rest } = componentOf(ref);
    const target = `components/${groupOf(kind, name)}/${kind}.yaml`;
    let rel = posix.relative(posix.dirname(fromFile), target);
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel + fragment([name, ...rest]);
  };

  const files = new Map();
  const put = (file, value, header) => files.set(file, { value, header });

  for (const tag of src.tags.map((t) => t.name)) {
    const file = `paths/${tagSlug(tag)}.yaml`;
    const value = {};
    for (const [p, item] of Object.entries(src.paths)) {
      if (pathTag.get(p) === tag) value[p] = mapRefs(item, relRef(file));
    }
    put(
      file,
      value,
      `Контракт Ортус · тег ${tag}: пути и операции. Пишет только стюард контракта (план v2 §3.5).`,
    );
  }

  const buckets = new Map();
  for (const kind of KINDS) {
    for (const [name, value] of Object.entries(comp[kind] ?? {})) {
      const file = `components/${groupOf(kind, name)}/${kind}.yaml`;
      if (!buckets.has(file)) buckets.set(file, {});
      buckets.get(file)[name] = mapRefs(value, relRef(file));
    }
  }
  for (const [file, value] of [...buckets].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const group = file.split('/')[1];
    const what =
      group === 'common'
        ? 'общие компоненты (используются несколькими тегами)'
        : `компоненты тега ${group}`;
    put(file, value, `Контракт Ортус · ${what}. Пишет только стюард контракта (план v2 §3.5).`);
  }

  const root = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'components') continue;
    root[k] =
      k === 'paths'
        ? Object.fromEntries(
            Object.keys(v).map((p) => [
              p,
              { $ref: `paths/${tagSlug(pathTag.get(p))}.yaml${fragment([p])}` },
            ]),
          )
        : v;
  }
  put(
    'ortus.yaml',
    root,
    [
      'Контракт Ортус CRM — корень раскладки OpenAPI по тегам (PD-56, W0.07).',
      'Пути — paths/<tag>.yaml, компоненты — components/<группа>/<вид>.yaml.',
      'Бандл: node tools/gen/contract.mjs → api/dist/ortus.bundle.yaml.',
    ].join('\n'),
  );
  return files;
}

export async function writeSplit(files, outDir = OPENAPI_DIR) {
  for (const [file, { value, header }] of files) {
    const path = join(outDir, file);
    writeText(path, await renderYaml(value, path, header));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const force = process.argv.includes('--force');
  if (existsSync(join(OPENAPI_DIR, 'ortus.yaml')) && !force) {
    console.error(
      'api/openapi/ortus.yaml уже есть: раскладка затрёт правки стюарда. Запуск с --force.',
    );
    process.exit(2);
  }
  for (const d of ['paths', 'components'])
    rmSync(join(OPENAPI_DIR, d), { recursive: true, force: true });
  const files = splitSpec(readYaml(SOURCE_0_1));
  await writeSplit(files);
  console.log(`раскладка 0.1: ${files.size} файлов в api/openapi/`);
}
