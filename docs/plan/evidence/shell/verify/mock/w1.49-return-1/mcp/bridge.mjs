// Мост HTTP -> Playwright MCP (stdio), как tools/mcp-check.js: POST /call {name, args} -> текст результата.
// Аргументы: <корень worktree> <порт моста> <PORT приложения для каталога вывода> <файл журнала>
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [ROOT, BRIDGE_PORT, APP_PORT, LOG] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')).mcpServers.playwright;
const env = { ...process.env, PORT: APP_PORT };
const args = cfg.args.map((a) =>
  a.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, n, d) => env[n] || d || ''),
);
const child = spawn(cfg.command, args, { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    const w = pending.get(msg.id);
    if (w) {
      pending.delete(msg.id);
      if (msg.error) w.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else w.resolve(msg.result);
    }
  }
});
child.stderr.on('data', (d) => appendFileSync(LOG, `[stderr] ${d}`));
child.on('exit', (c) => {
  appendFileSync(LOG, `[exit] ${c}\n`);
  process.exit(1);
});
let id = 1;
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
const request = (method, params) => {
  const i = id++;
  send({ jsonrpc: '2.0', id: i, method, params });
  return new Promise((res, rej) => {
    pending.set(i, { resolve: res, reject: rej });
    setTimeout(() => rej(new Error(`таймаут ${method}`)), 120_000).unref();
  });
};
await request('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'verifier-w1.49', version: '1.0.0' },
});
send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
const text = (r) =>
  (r?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (d) => (body += d));
  req.on('end', async () => {
    try {
      const { name, args: a = {} } = JSON.parse(body || '{}');
      if (name === '__quit') {
        res.end('bye');
        child.kill();
        process.exit(0);
      }
      const r = name === '__tools' ? await request('tools/list', {}) : await request('tools/call', { name, arguments: a });
      const out = name === '__tools' ? r.tools.map((t) => t.name).join('\n') : (r.isError ? 'ERROR: ' : '') + text(r);
      appendFileSync(LOG, `\n### ${name} ${JSON.stringify(a)}\n${out}\n`);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(out);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(e));
    }
  });
}).listen(Number(BRIDGE_PORT), '127.0.0.1');
appendFileSync(LOG, `bridge on ${BRIDGE_PORT}\n`);
