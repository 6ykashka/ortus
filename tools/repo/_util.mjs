// Общие помощники тестов каркаса репозитория (W0.03). Не тест: в glob `*.test.mjs` не попадает.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const abs = (rel) => join(ROOT, rel);

export const exists = (rel) => existsSync(abs(rel));

export function read(rel) {
  return readFileSync(abs(rel), 'utf8');
}

export function readJson(rel) {
  return JSON.parse(read(rel));
}

/** Запускает команду в корне репозитория; возвращает { status, stdout, stderr }. */
export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function git(...args) {
  return run('git', ['-c', 'core.quotepath=off', ...args]);
}
