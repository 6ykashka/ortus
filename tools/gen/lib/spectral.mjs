// Запуск Spectral CLI с правилами api/.spectral.yaml. Словари правил вшиты в модуль
// api/spectral/functions/_dictionaries.gen.js, каталог запуска не важен; cwd — корень только для
// относительных путей в выводе.
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';
import { abs, ROOT, SPECTRAL_RULESET } from './paths.mjs';

const CLI = abs('node_modules/@stoplight/spectral-cli/dist/index.js');

/**
 * @param {string[]} files абсолютные пути документов
 * @returns {{code: string, severity: number, message: string, source: string, path: string[]}[]}
 */
export function runSpectral(files) {
  const args = [
    CLI,
    'lint',
    ...files.map((f) => relative(ROOT, f)),
    '--ruleset',
    relative(ROOT, SPECTRAL_RULESET),
  ];
  const r = spawnSync(process.execPath, [...args, '-f', 'json', '--quiet'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  const out = r.stdout.trim();
  if (!out.startsWith('[')) {
    throw new Error(
      `Spectral не выдал JSON (exit ${r.status}): ${(r.stderr || out).slice(0, 2000)}`,
    );
  }
  return JSON.parse(out).map((x) => ({
    ...x,
    source: relative(ROOT, x.source).replaceAll('\\', '/'),
  }));
}

/** Severity Spectral: 0 — error, 1 — warn, 2 — info, 3 — hint. */
export const ERROR = 0;
