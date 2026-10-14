// Распаковывает ortus-design-bundle.json (RPC GetFile Claude Design) в каталог байт-в-байт.
//   node tools/design-unpack-bundle.js <bundle.json> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [bundlePath, outDir] = process.argv.slice(2);
if (!bundlePath || !outDir) {
  console.error('usage: node tools/design-unpack-bundle.js <bundle.json> <outDir>');
  process.exit(2);
}

const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
const rows = [];
let total = 0;
for (const [rel, f] of Object.entries(bundle.files)) {
  const buf = Buffer.from(f.content, 'base64');
  const target = join(outDir, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buf);
  const lines = f.contentType?.startsWith('image/') ? 0 : buf.toString('utf8').split('\n').length;
  rows.push({ rel, bytes: buf.length, declared: f.size, lines, ok: buf.length === f.size });
  total += buf.length;
}
rows.sort((a, b) => a.rel.localeCompare(b.rel));
for (const r of rows) {
  const mark = r.ok ? 'OK ' : 'DIFF';
  const note = r.ok ? '' : ` (declared ${r.declared})`;
  console.log(
    `${mark} ${String(r.bytes).padStart(8)} b ${String(r.lines).padStart(6)} ln  ${r.rel}${note}`,
  );
}
console.log(
  `files: ${rows.length}, bytes: ${total}, size mismatches: ${rows.filter((r) => !r.ok).length}`,
);
