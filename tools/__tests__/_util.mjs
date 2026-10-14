// Общие помощники тестов tools/ (W0.05). Не тест: в glob `*.test.mjs` не попадает.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const abs = (rel) => join(ROOT, rel);

export const read = (rel, enc = 'utf8') => readFileSync(abs(rel), enc);

export const tempDir = (prefix = 'ortus-tools-') => mkdtempSync(join(tmpdir(), prefix));

/**
 * Импортирует модуль tools/ и не падает на ошибке загрузки: красный тест должен падать
 * на утверждении о публичном имени, а не на импорте (tdd-protocol.md §1).
 */
export async function load(rel) {
  try {
    return await import(pathToFileURL(abs(rel)).href);
  } catch (err) {
    return { __loadError: err };
  }
}

/** Запускает `node <script> …args` в корне репозитория. */
export function runNode(script, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [abs(script), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
