// Общие помощники тестов CI (W0.04). Не тест: в glob `*.test.mjs` не попадает.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const abs = (rel) => join(ROOT, rel);

export const read = (rel) => readFileSync(abs(rel), 'utf8');

/** Импортирует модуль tools/ci/<name>, если он есть; иначе null (red-фаза: тест падает на assert). */
export async function importIfExists(rel) {
  return existsSync(abs(rel)) ? import(pathToFileURL(abs(rel)).href) : null;
}

/** Временное дерево файлов: { 'a/b.txt': 'text' } → путь к корню. Удаляется через cleanup(). */
export function tempTree(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ortus-ci-'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Запускает node-скрипт tools/ci; возвращает { status, stdout, stderr }. */
export function runNode(script, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [abs(script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
