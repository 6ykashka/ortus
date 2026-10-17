// Клиент Playwright MCP по stdio (как tools/mcp-check.js) для проходки W1.24: сервер из .mcp.json,
// вызовы инструментов, поиск ref по роли и подписи в снимке дерева доступности, журнал хода проходки.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ROOT = process.env.W124_ROOT;
const PORT = process.env.PORT ?? '5212';

export function startMcp() {
  const cfg = JSON.parse(readFileSync(join(ROOT, '.mcp.json'), 'utf8')).mcpServers.playwright;
  const args = cfg.args.map((a) => a.replace('${PORT:-5200}', PORT));
  const child = spawn(cfg.command, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
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
        if (msg.error) w.reject(new Error(msg.error.message));
        else w.resolve(msg.result);
      }
    }
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  let id = 1;
  const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
  const request = (method, params) => {
    const n = id++;
    send({ jsonrpc: '2.0', id: n, method, params });
    return new Promise((res, rej) => {
      pending.set(n, { resolve: res, reject: rej });
      setTimeout(() => rej(new Error(`таймаут ${method} ${JSON.stringify(params).slice(0, 120)}\n${stderr.slice(-500)}`)), 90_000).unref();
    });
  };
  return {
    async init() {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'w124-walk', version: '1.0.0' },
      });
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      const list = await request('tools/list', {});
      return list.tools.map((t) => t.name);
    },
    async call(name, args = {}) {
      const r = await request('tools/call', { name, arguments: args });
      const text = (r.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      if (r.isError) throw new Error(`${name}: ${text}`);
      return text;
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

/** Строка снимка `- role "name" [ref=eN]` → ref (n-я по счёту). */
export function refOf(snapshot, role, name, n = 0) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`- '?${role} "${esc}"[^\\n]*?\\[ref=([a-z0-9]+)\\]`, 'g');
  const all = [...snapshot.matchAll(re)].map((m) => m[1]);
  if (!all[n]) throw new Error(`нет ${role} «${name}» (#${n}) в снимке`);
  return all[n];
}

/** Журнал проходки и файлы evidence страницы. */
export function evidence(key) {
  const dir = join(ROOT, 'docs', 'plan', 'evidence', key);
  mkdirSync(dir, { recursive: true });
  const log = [];
  return {
    dir,
    step(text) {
      log.push(text);
      console.log(text);
    },
    save(name, text) {
      writeFileSync(join(dir, name), text);
    },
    /** Скриншот MCP (файл в --output-dir сервера) → evidence. */
    async shot(mcp, name, fullPage = false) {
      const text = await mcp.call('browser_take_screenshot', { filename: name.split('/').at(-1), fullPage, type: 'png', scale: 'css' });
      try {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        renameSync(join(ROOT, name.split('/').at(-1)), join(dir, name));
      } catch (e) {
        log.push(`(скриншот ${name}: ${e.message}; ответ: ${text.slice(0, 200)})`);
      }
    },
    log,
  };
}

/** Снимок дерева без шума: секция Page Snapshot ответа инструмента. */
export function snapshotOf(text) {
  const i = text.indexOf('```yaml');
  if (i < 0) return text;
  const j = text.indexOf('```', i + 7);
  return text.slice(i + 7, j).trim();
}
