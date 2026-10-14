// Unpack ortus-design-bundle.json (from the Claude Design GetFile RPC) into a directory, byte-exact.
// usage: node unpack-bundle.js <bundle.json> <outDir>
const fs = require('fs');
const path = require('path');
const [bundlePath, outDir] = process.argv.slice(2);
const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const rows = [];
let total = 0;
for (const [rel, f] of Object.entries(bundle.files)) {
  const buf = Buffer.from(f.content, 'base64');
  const target = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buf);
  const lines = f.contentType && f.contentType.startsWith('image/') ? 0 : buf.toString('utf8').split('\n').length;
  rows.push({ rel, bytes: buf.length, declared: f.size, lines, ok: buf.length === f.size });
  total += buf.length;
}
rows.sort((a, b) => a.rel.localeCompare(b.rel));
for (const r of rows) console.log(`${r.ok ? 'OK ' : 'DIFF'} ${String(r.bytes).padStart(8)} b ${String(r.lines).padStart(6)} ln  ${r.rel}${r.ok ? '' : ' (declared ' + r.declared + ')'}`);
console.log(`files: ${rows.length}, bytes: ${total}, size mismatches: ${rows.filter((r) => !r.ok).length}`);
