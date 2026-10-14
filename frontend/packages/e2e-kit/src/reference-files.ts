// Список файлов эталона `.dc.html` (корень каталога эталона или git-ссылки снимка этапа).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Файлы меньше этого размера — пустые заготовки (`design/Ortus CRM.dc.html`, 206 байт). */
export const MIN_REFERENCE_BYTES = 1024;

export interface ReferenceFilesOptions {
  repoRoot: string;
  dir: string;
  ref?: string | undefined;
}

/** Имена `.dc.html` верхнего уровня каталога эталона, отсортированные. */
export function listReferenceFiles(o: ReferenceFilesOptions): string[] {
  const abs = resolve(o.repoRoot, o.dir);
  if (o.ref) {
    const out = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-tree', '-l', o.ref, './'], {
      cwd: abs,
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .map((line) => /^\d+ blob \w+\s+(\d+)\t(.+)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .filter((m) => m[2]?.endsWith('.dc.html') && Number(m[1]) >= MIN_REFERENCE_BYTES)
      .map((m) => m[2] as string)
      .sort();
  }
  return readdirSync(abs)
    .filter((f) => f.endsWith('.dc.html') && statSync(join(abs, f)).size >= MIN_REFERENCE_BYTES)
    .sort();
}
