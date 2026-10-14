// Удаляет блоки <style data-omelette-injected>…</style> и <script data-omelette-injected>…</script>,
// которые слой выдачи Claude Design вставляет в HTML, и возвращает канонический исходник.
//   node tools/design-strip-injected.js <dir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/design-strip-injected.js <dir>');
  process.exit(2);
}

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
  );

for (const f of walk(root).filter((p) => p.endsWith('.html'))) {
  const src = readFileSync(f, 'utf8');
  const out = src
    .replace(/<style data-omelette-injected>[\s\S]*?<\/style>/g, '')
    .replace(/<script data-omelette-injected>[\s\S]*?<\/script>\n?/g, '');
  if (out !== src) {
    writeFileSync(f, out);
    console.log(
      `stripped ${relative(root, f)}: ${Buffer.byteLength(src)} -> ${Buffer.byteLength(out)} bytes`,
    );
  }
}
