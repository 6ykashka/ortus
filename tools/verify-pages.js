// verify-pages: напоминает (или требует), чтобы для изменённых страниц был свежий evidence
// проходки verification-protocol.md §1–§4 в docs/plan/evidence/<key>/.
//
//   node tools/verify-pages.js [--check] [--base main] [--hook]
//
// Изменённые файлы — `git diff --name-only <merge-base>..HEAD` и `git status --porcelain`;
// ключи страниц — по глобам `paths` реестра tools/page-keys.json. Evidence свежий, если есть все
// REQUIRED_EVIDENCE и каждый файл не старше последнего изменения путей страницы.
// Коды: 0 — напоминание (stdout); 2 — VERIFY_PAGES_BLOCK=1 и не stop_hook_active (Claude Code
// продолжает сессию, текст в stderr); --check (pre-push/CI) — 1 при устаревании;
// --hook читает JSON Stop-хука из stdin, при stop_hook_active — всегда 0 (защита от цикла).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY_PATH = 'tools/page-keys.json';
export const EVIDENCE_DIR = 'docs/plan/evidence';
export const REQUIRED_EVIDENCE = [
  '390.png',
  '768.png',
  '1440.png',
  'snapshot.txt',
  'console.txt',
  'network.txt',
];
const HINT =
  'выполните verification-protocol.md §1–§4 и положите снимки в docs/plan/evidence/<key>/';

/** Глоб с `**`, `*`, `?`, `{a,b}` → RegExp по пути с прямыми слешами. */
export function globToRegExp(glob) {
  let re = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i += 1;
      if (glob[i + 1] === '/') {
        i += 1;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      braces += 1;
      re += '(?:';
    } else if (c === '}' && braces > 0) {
      braces -= 1;
      re += ')';
    } else if (c === ',' && braces > 0) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Ключи страниц, чьи пути затронуты; без повторов, по алфавиту. */
export function keysForPaths(paths, registry) {
  const keys = new Set();
  for (const page of registry.pages) {
    const res = page.paths.map(globToRegExp);
    if (paths.some((p) => res.some((re) => re.test(p.split('\\').join('/'))))) keys.add(page.key);
  }
  return [...keys].sort();
}

/** Проверка схемы реестра; возвращает список ошибок. */
export function validateRegistry(registry) {
  const errors = [];
  if (registry?.version !== 1) errors.push('version: ожидается 1');
  if (!Array.isArray(registry?.pages)) return [...errors, 'pages: ожидается массив'];
  const seen = new Set();
  for (const [i, p] of registry.pages.entries()) {
    const at = `pages[${i}]${p?.key ? ` (${p.key})` : ''}`;
    if (typeof p?.key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p.key)) errors.push(`${at}: key`);
    else if (seen.has(p.key)) errors.push(`${at}: дубликат ключа`);
    seen.add(p?.key);
    if (!Number.isInteger(p?.stage) || p.stage < 1) errors.push(`${at}: stage ≥ 1`);
    if (!Array.isArray(p?.paths) || p.paths.length === 0)
      errors.push(`${at}: paths — непустой массив`);
    if (!(
      p?.reference === null ||
      (typeof p?.reference === 'string' && p.reference.endsWith('.dc.html'))
    )) {
      errors.push(`${at}: reference — файл .dc.html или null`);
    }
  }
  return errors;
}

const mtimeOf = (file) => (existsSync(file) ? statSync(file).mtimeMs : undefined);

/** Свежесть evidence ключа относительно момента последнего изменения страницы. */
export function isFresh(dir, sinceMs) {
  if (!existsSync(dir)) return { fresh: false, reason: `нет папки ${dir}` };
  const missing = REQUIRED_EVIDENCE.filter((f) => mtimeOf(join(dir, f)) === undefined);
  if (missing.length) return { fresh: false, reason: `нет файлов: ${missing.join(', ')}` };
  const stale = REQUIRED_EVIDENCE.filter((f) => mtimeOf(join(dir, f)) < sinceMs);
  if (stale.length)
    return { fresh: false, reason: `старше изменения страницы: ${stale.join(', ')}` };
  return { fresh: true, reason: '' };
}

function realGit(root) {
  return (args) =>
    execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
}

const lines = (s) =>
  s
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);

function changedFiles(git, base) {
  let mergeBase;
  try {
    mergeBase = git(['merge-base', base, 'HEAD']).trim();
  } catch {
    mergeBase = undefined;
  }
  const committed = mergeBase ? lines(git(['diff', '--name-only', `${mergeBase}..HEAD`])) : [];
  const dirty = lines(git(['status', '--porcelain', '--untracked-files=all'])).map((l) => {
    const path = l.slice(3);
    return path.includes(' -> ') ? path.split(' -> ')[1] : path;
  });
  return { mergeBase, committed, dirty };
}

/** Момент последнего изменения файлов страницы: коммит в ветке или mtime незакоммиченного файла. */
function lastChange(files, changes, git, root) {
  let since = 0;
  const committed = files.filter((f) => changes.committed.includes(f));
  if (committed.length && changes.mergeBase) {
    const ts = Number(
      git(['log', '-1', '--format=%ct', `${changes.mergeBase}..HEAD`, '--', ...committed]).trim(),
    );
    if (Number.isFinite(ts)) since = Math.max(since, ts * 1000);
  }
  for (const f of files.filter((x) => changes.dirty.includes(x))) {
    since = Math.max(since, mtimeOf(join(root, f)) ?? Date.now());
  }
  return since;
}

function parseHookInput(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

/**
 * Логика без побочных эффектов ввода-вывода (для тестов): возвращает код и тексты.
 * @param {{ argv: string[], env: Record<string,string|undefined>, stdin: string,
 *   registry?: object, git?: (args: string[]) => string, root?: string }} o
 */
export function main(o) {
  const root = o.root ?? ROOT;
  const argv = o.argv ?? [];
  const check = argv.includes('--check');
  const hook = argv.includes('--hook');
  const baseIdx = argv.indexOf('--base');
  const base = baseIdx >= 0 ? argv[baseIdx + 1] : 'main';
  const input = hook ? parseHookInput(o.stdin) : {};
  const out = (stdout, code = 0, stderr = '') => ({ code, stdout, stderr });

  const registry = o.registry ?? JSON.parse(readFileSync(join(root, REGISTRY_PATH), 'utf8'));
  const problems = validateRegistry(registry);
  if (problems.length)
    return out('', 1, `verify-pages: ${REGISTRY_PATH}: ${problems.join('; ')}\n`);
  if (registry.pages.length === 0) {
    return out(`verify-pages: нет страниц в реестре ${REGISTRY_PATH} — проверять нечего\n`);
  }

  const git = o.git ?? realGit(root);
  const changes = changedFiles(git, base);
  const all = [...new Set([...changes.committed, ...changes.dirty])];
  const keys = keysForPaths(all, registry);
  if (keys.length === 0) return out('verify-pages: изменённых страниц нет\n');

  const stale = [];
  for (const key of keys) {
    const page = registry.pages.find((p) => p.key === key);
    const files = all.filter((f) => keysForPaths([f], { pages: [page] }).length > 0);
    const since = lastChange(files, changes, git, root);
    const r = isFresh(join(root, EVIDENCE_DIR, key), since);
    if (!r.fresh) stale.push(`${key} (${r.reason})`);
  }
  if (stale.length === 0) return out(`verify-pages: evidence свежий: ${keys.join(', ')}\n`);

  const text = `verify-pages: нет свежего evidence для: ${stale.join(', ')} — ${HINT}\n`;
  if (input.stop_hook_active === true) return out(text);
  if (check) return out('', 1, text);
  if (o.env?.VERIFY_PAGES_BLOCK === '1') return out('', 2, text);
  return out(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const stdin = argv.includes('--hook') ? readFileSync(0, 'utf8') : '';
  const r = main({ argv, env: process.env, stdin });
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
