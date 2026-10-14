// Записывает src/tokens.css и src/tokens.ts из design/docs/design-system/tokens.json и prototype.json.
// `node scripts/build.mjs --check` — только проверка: код 1, если файлы устарели.
import { readFileSync, writeFileSync } from 'node:fs';
import { OUT_CSS, OUT_TS, generate, readTokens } from './generate.mjs';

const { base, prototype } = readTokens();
const { css, ts } = generate(base, prototype);
const check = process.argv.includes('--check');
let stale = 0;

for (const [file, content] of [
  [OUT_CSS, css],
  [OUT_TS, ts],
]) {
  let current;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = '';
  }
  if (current === content) continue;
  stale += 1;
  if (check) {
    console.error(`устарел: ${file}`);
  } else {
    writeFileSync(file, content, 'utf8');
    console.log(`записан: ${file}`);
  }
}

if (check && stale > 0) process.exit(1);
