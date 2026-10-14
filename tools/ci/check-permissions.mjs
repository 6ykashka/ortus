#!/usr/bin/env node
// W0.04 · «Каждый x-permissions есть в каталоге» (design/docs/14-engineering.md «Поток контракта» п.2).
//
// Спецификация — все *.yaml|*.yml под api/openapi/ (корень и paths/<tag>.yaml по PD-56),
// каталоги examples/ не читаются. Каталог — api/permissions.yaml: ключ действия — ключ
// отображения `actions` на любой глубине (modules.<m>.actions.<key>, раздел на модуль).
// prototype_renames — только подсказка для старых имён прототипа.
//
// CLI: node tools/ci/check-permissions.mjs [--root <каталог репозитория>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LineCounter, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml';

export const CATALOG = 'api/permissions.yaml';
export const SPEC_DIR = 'api/openapi';
const SKIP_DIRS = new Set(['examples', 'node_modules']);

function parse(text, file) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  const errors = doc.errors.map((e) => `${file}: YAML: ${e.message.split('\n')[0]}`);
  const lineOf = (node) => lineCounter.linePos(node?.range?.[0] ?? 0).line;
  return { doc, errors, lineOf };
}

const keyOf = (pair) => (isScalar(pair.key) ? String(pair.key.value) : null);

/** Ключи каталога: Map<ключ, строка>, подсказки переименований и ошибки. */
export function catalogKeys(text, file = CATALOG) {
  const { doc, errors, lineOf } = parse(text, file);
  const keys = new Map();
  const renames = new Map();
  if (errors.length) return { keys, renames, errors };

  visit(doc, {
    Pair(_, pair) {
      const name = keyOf(pair);
      if (name === 'actions' && isMap(pair.value)) {
        for (const item of pair.value.items) {
          const key = keyOf(item);
          if (key === null) continue;
          const line = lineOf(item.key);
          if (keys.has(key)) {
            errors.push(
              `${file}:${line}: ключ «${key}» объявлен дважды (первый раз — строка ${keys.get(key)})`,
            );
          } else {
            keys.set(key, line);
          }
        }
        return visit.SKIP;
      }
      if (name === 'prototype_renames' && isMap(pair.value)) {
        for (const item of pair.value.items) {
          const v = item.value;
          const to = isSeq(v) ? v.items.map((x) => String(x.value)) : [String(v?.value)];
          renames.set(keyOf(item), to);
        }
        return visit.SKIP;
      }
      return undefined;
    },
  });

  if (keys.size === 0 && errors.length === 0) {
    errors.push(`${file}: в каталоге нет ни одного ключа действий (отображения actions)`);
  }
  return { keys, renames, errors };
}

/** Ссылки x-permissions файла спецификации: [{ key, file, line }] и ошибки формы. */
export function findXPermissions(text, file) {
  const { doc, errors, lineOf } = parse(text, file);
  const refs = [];
  if (errors.length) return { refs, errors };

  visit(doc, {
    Pair(_, pair) {
      if (keyOf(pair) !== 'x-permissions') return undefined;
      const v = pair.value;
      const ok = isSeq(v) && v.items.every((x) => isScalar(x) && typeof x.value === 'string');
      if (!ok) {
        errors.push(`${file}:${lineOf(pair.key)}: x-permissions должен быть списком строк`);
      } else {
        for (const x of v.items) refs.push({ key: x.value, file, line: lineOf(x) });
      }
      return visit.SKIP;
    },
  });
  return { refs, errors };
}

function specFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...specFiles(p));
    } else if (/\.ya?ml$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** Проверка дерева api/ в root. */
export function checkPermissions({ root = process.cwd() } = {}) {
  const specDir = join(root, SPEC_DIR);
  if (!existsSync(specDir))
    return { skipped: `нет ${SPEC_DIR}`, errors: [], refs: 0, files: 0, keys: 0 };

  const catalogPath = join(root, CATALOG);
  if (!existsSync(catalogPath)) {
    return { errors: [`${CATALOG}: каталог прав не найден`], refs: 0, files: 0, keys: 0 };
  }
  const catalog = catalogKeys(readFileSync(catalogPath, 'utf8'), CATALOG);
  const errors = [...catalog.errors];

  const rel = (p) => relative(root, p).split(sep).join('/');
  const files = specFiles(specDir).sort((a, b) => rel(a).localeCompare(rel(b), 'en'));
  let refs = 0;
  for (const p of files) {
    const r = findXPermissions(readFileSync(p, 'utf8'), rel(p));
    errors.push(...r.errors);
    refs += r.refs.length;
    for (const ref of r.refs) {
      if (catalog.keys.has(ref.key)) continue;
      const hint = catalog.renames.get(ref.key);
      const tail = hint ? ` (имя прототипа; в каталоге: ${hint.join(', ')})` : '';
      errors.push(`${ref.file}:${ref.line}: x-permissions «${ref.key}» нет в ${CATALOG}${tail}`);
    }
  }
  return { errors, refs, files: files.length, keys: catalog.keys.size };
}

export function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--root');
  const r = checkPermissions({ root: resolve(i >= 0 ? argv[i + 1] : process.cwd()) });
  if (r.skipped) {
    console.log(`permissions: ${r.skipped} — пропуск`);
    return 0;
  }
  if (r.errors.length) {
    for (const e of r.errors) console.error(e);
    console.error(`permissions: ошибок ${r.errors.length}`);
    return 1;
  }
  console.log(`permissions: ${r.refs} ссылок в ${r.files} файлах, каталог ${r.keys} ключей — ок`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
