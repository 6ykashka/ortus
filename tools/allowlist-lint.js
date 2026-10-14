// allowlist-lint: проверяет файлы allowlist расхождений с эталоном (D-50, план v2 §3.7).
//
//   node tools/allowlist-lint.js [--stage N] [<каталог>…]
//
// По умолчанию — frontend/apps/web/e2e/visual/allowlist; этап — --stage, иначе ORTUS_STAGE, иначе 0.
// Код 0 — ошибок нет (предупреждения допустимы), 1 — есть ошибки, 2 — неверные аргументы.
// Разбор строк — общий с харнессом: frontend/packages/e2e-kit/src/allowlist.ts (Node снимает типы).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  formatAllowError,
  lintAllowlist,
  parseAllowlist,
} from '../frontend/packages/e2e-kit/src/allowlist.ts';

export const DEFAULT_DIR = 'frontend/apps/web/e2e/visual/allowlist';

function parseArgs(argv, env) {
  const dirs = [];
  let stage = env.ORTUS_STAGE ? Number(env.ORTUS_STAGE) : 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--stage') stage = Number(argv[(i += 1)]);
    else dirs.push(argv[i]);
  }
  if (!Number.isInteger(stage) || stage < 0) throw new Error('--stage: ожидается целое ≥ 0');
  return { stage, dirs: dirs.length ? dirs : [DEFAULT_DIR] };
}

const mdFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => join(dir, e.name))
        .sort()
    : [];

/** Проверяет каталоги; возвращает сводку и найденные проблемы. */
export function lintDirs(dirs, stage, cwd = process.cwd()) {
  const files = dirs.flatMap((d) => mdFiles(resolve(cwd, d)));
  let entries = 0;
  const problems = [];
  for (const file of files) {
    const rel = relative(cwd, file).split('\\').join('/');
    const parsed = parseAllowlist(readFileSync(file, 'utf8'), rel);
    entries += parsed.entries.length;
    problems.push(...parsed.errors, ...lintAllowlist(parsed.entries, { stage }));
  }
  problems.sort((a, b) => (a.file ?? '').localeCompare(b.file ?? '') || a.line - b.line);
  return { files: files.length, entries, problems };
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv, process.env);
  } catch (err) {
    console.error(`allowlist-lint: ${err.message}`);
    return 2;
  }
  const { files, entries, problems } = lintDirs(args.dirs, args.stage);
  for (const p of problems) console.error(formatAllowError(p));
  const errors = problems.filter((p) => p.level === 'error').length;
  const warnings = problems.length - errors;
  console.log(
    `allowlist-lint: файлов ${files}, записей ${entries}, ошибок ${errors}, предупреждений ${warnings} (этап ${args.stage})`,
  );
  return errors > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
