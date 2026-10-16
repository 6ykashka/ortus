// Verifier MCP client: drives @playwright/mcp over stdio (same as tools/mcp-check.js).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const WT = process.env.WT;
const OUT = process.env.MCP_OUT; // .playwright-mcp/6103
const EV = process.env.EV;
mkdirSync(EV, { recursive: true });

export function start() {
  const child = spawn(
    'node',
    [
      join(WT, 'frontend/packages/e2e-kit/node_modules/@playwright/mcp/cli.js'),
      '--browser', 'chromium', '--headless', '--isolated', '--output-dir', OUT,
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
  child.stderr.on('data', () => {});
  let id = 1;
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  const request = (method, params) => {
    const i = id++;
    send({ jsonrpc: '2.0', id: i, method, params });
    return new Promise((res, rej) => pending.set(i, { res, rej }));
  };
  const log = [];
  const api = {
    async init() {
      await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verifier', version: '1' } });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    },
    request,
    async call(name, args = {}) {
      const r = await request('tools/call', { name, arguments: args });
      const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      log.push(`### ${name} ${JSON.stringify(args)}\n${text}\n`);
      if (r.isError) throw new Error(`${name}: ${text}`);
      return text;
    },
    log,
    save(file) { writeFileSync(join(EV, file), log.join('\n'), 'utf8'); },
    close() { child.kill(); },
  };
  return api;
}

/** ref of the first snapshot line with role and exact quoted name. */
export function ref(snapshot, role, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`- ${role} "${esc}"[^\\n]*\\[ref=([a-z0-9]+)\\]`);
  const m = re.exec(snapshot);
  if (!m) throw new Error(`no ${role} "${name}" in snapshot`);
  return m[1];
}

export function snapPart(text) {
  const i = text.indexOf('```yaml');
  if (i < 0) return text;
  const j = text.indexOf('```', i + 7);
  return text.slice(i + 7, j).trim();
}
