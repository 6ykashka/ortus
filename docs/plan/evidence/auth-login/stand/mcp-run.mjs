// Драйвер @playwright/mcp по stdio (как tools/mcp-check.js): node mcp-run.mjs <worktree> <steps.json> [outDir]
// steps.json — массив {tool, args}; печатает текст ответа каждого шага.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [WT, stepsFile, outDir] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const child = spawn(
  process.execPath,
  [
    join(WT, 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js'),
    '--browser', 'chromium', '--headless', '--isolated',
    '--output-dir', outDir ?? join(WT, '.playwright-mcp', '5210'),
  ],
  { cwd: WT, stdio: ['pipe', 'pipe', 'pipe'] },
);
const pending = new Map();
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    const w = pending.get(m.id);
    if (w) { pending.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
  }
});
let stderr = '';
child.stderr.on('data', (c) => { stderr += c; });
child.on('exit', (code) => {
  for (const w of pending.values()) w.rej(new Error(`mcp exited ${code}`));
  pending.clear();
});
let id = 1;
const rpc = (method, params) => new Promise((res, rej) => {
  const n = id++;
  pending.set(n, { res, rej });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
});
try {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'w1.22-walk', version: '1' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  for (const s of steps) {
    const args = { ...(s.args ?? {}) };
    if (s.codeFile) args.code = readFileSync(s.codeFile, 'utf8');
    const r = await rpc('tools/call', { name: s.tool, arguments: args });
    const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    process.stdout.write(`=== ${s.tool}${r.isError ? ' (ERROR)' : ''}\n${text}\n`);
  }
} catch (e) {
  process.stdout.write(`FAILED: ${e.message}\n${stderr.slice(-2000)}\n`);
  process.exitCode = 1;
} finally {
  child.kill();
}
