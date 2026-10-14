// Хук commit-msg (W0.03): сообщение коммита не должно начинаться с BOM.
// PowerShell 5.1 `Out-File`/`Set-Content -Encoding utf8` пишет BOM, и заголовок перестаёт
// разбираться как Conventional Commits. Пишите файл так:
//   [IO.File]::WriteAllText($f, $m, (New-Object Text.UTF8Encoding $false)); git commit -F $f
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BOM = [0xef, 0xbb, 0xbf];

/** @param {Buffer} buf @returns {{ok: true} | {ok: false, reason: string}} */
export function checkBom(buf) {
  if (BOM.every((b, i) => buf[i] === b)) {
    return {
      ok: false,
      reason: 'Сообщение коммита начинается с BOM (EF BB BF): пишите файл UTF-8 без BOM',
    };
  }
  return { ok: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/repo/commit-msg-bom.mjs <файл сообщения>');
    process.exit(2);
  }
  const r = checkBom(readFileSync(file));
  if (!r.ok) {
    console.error(r.reason);
    process.exit(1);
  }
}
