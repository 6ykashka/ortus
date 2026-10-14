// Remove <style data-omelette-injected>…</style> and <script data-omelette-injected>…</script> blocks
// that the Claude Design "serve" layer injects into HTML files, restoring the canonical source.
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(root).filter((p) => p.endsWith('.html'))) {
  const src = fs.readFileSync(f, 'utf8');
  const out = src
    .replace(/<style data-omelette-injected>[\s\S]*?<\/style>/g, '')
    .replace(/<script data-omelette-injected>[\s\S]*?<\/script>\n?/g, '');
  if (out !== src) {
    fs.writeFileSync(f, out);
    console.log(`stripped ${path.relative(root, f)}: ${Buffer.byteLength(src)} -> ${Buffer.byteLength(out)} bytes`);
  }
}
