// mcp-check: проверка Playwright MCP из .mcp.json без перезапуска сессии Claude Code.
//
//   node tools/mcp-check.js [--url <адрес>] [--expect <текст>]
//
// Запускает сервер по .mcp.json (stdio, JSON-RPC построчно), выполняет initialize и tools/list,
// сверяет инструменты verification-protocol.md §4. С --url — browser_navigate и browser_snapshot
// (нужен браузер: `corepack pnpm run mcp:install`); --expect — текст, который должен быть в снимке.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_TOOLS = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_select_option',
  'browser_resize',
  'browser_console_messages',
  'browser_network_requests',
  'browser_take_screenshot',
];

/** Раскрывает `${VAR}` и `${VAR:-default}` в аргументах, как Claude Code в .mcp.json. */
export function expandArgs(args, env) {
  return args.map((a) =>
    a.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
      (_, name, def) => env[name] || def || '',
    ),
  );
}

/** Клиент MCP по stdio: запрос → ответ по id. */
function startServer(server, env, cwd) {
  const child = spawn(server.command, expandArgs(server.args ?? [], env), {
    cwd,
    env: { ...env, ...server.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buf = '';
  let stderr = '';
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
      const waiter = pending.get(msg.id);
      if (waiter) {
        pending.delete(msg.id);
        if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else waiter.resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  let nextId = 1;
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  return {
    request(method, params) {
      const id = nextId++;
      send({ jsonrpc: '2.0', id, method, params });
      return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },
    stderr: () => stderr,
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

const withTimeout = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`mcp-check: таймаут ${ms} мс (${what})`)), ms).unref(),
    ),
  ]);

const textOf = (result) =>
  (result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

/**
 * Запускает сервер playwright из .mcp.json и проверяет его.
 * @param {{ url?: string, timeoutMs?: number, env?: NodeJS.ProcessEnv, root?: string }} o
 */
export async function checkServer(o = {}) {
  const root = o.root ?? ROOT;
  const cfg = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
  const server = cfg.mcpServers?.playwright;
  if (!server) throw new Error('mcp-check: в .mcp.json нет сервера playwright');
  const timeoutMs = o.timeoutMs ?? 60_000;
  const client = startServer(server, o.env ?? process.env, root);
  try {
    const init = await withTimeout(
      client.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ortus-mcp-check', version: '1.0.0' },
      }),
      timeoutMs,
      'initialize',
    );
    client.notify('notifications/initialized', {});
    const list = await withTimeout(client.request('tools/list', {}), timeoutMs, 'tools/list');
    const tools = (list.tools ?? []).map((t) => t.name);
    const result = {
      serverName: init.serverInfo?.name ?? '',
      serverVersion: init.serverInfo?.version ?? '',
      tools,
      missing: REQUIRED_TOOLS.filter((t) => !tools.includes(t)),
      snapshot: '',
    };
    if (o.url) {
      await withTimeout(
        client.request('tools/call', { name: 'browser_navigate', arguments: { url: o.url } }),
        timeoutMs,
        'browser_navigate',
      );
      const snap = await withTimeout(
        client.request('tools/call', { name: 'browser_snapshot', arguments: {} }),
        timeoutMs,
        'browser_snapshot',
      );
      result.snapshot = textOf(snap);
    }
    return result;
  } catch (err) {
    const tail = client.stderr().trim().split('\n').slice(-5).join('\n');
    throw new Error(`${err.message}${tail ? `\nstderr сервера:\n${tail}` : ''}`, { cause: err });
  } finally {
    client.close();
  }
}

async function main(argv) {
  const at = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const url = at('--url');
  const expectText = at('--expect');
  const r = await checkServer({ url });
  console.log(
    `mcp-check: сервер ${r.serverName} ${r.serverVersion}, инструментов ${r.tools.length}`,
  );
  if (r.missing.length) {
    console.error(`mcp-check: нет инструментов: ${r.missing.join(', ')}`);
    return 1;
  }
  console.log(`mcp-check: есть все ${REQUIRED_TOOLS.length} инструментов verification-protocol §4`);
  if (url) {
    const lines = r.snapshot.split('\n');
    console.log(`mcp-check: browser_snapshot ${url} — ${lines.length} строк:`);
    console.log(lines.slice(0, 40).join('\n'));
    if (expectText && !r.snapshot.includes(expectText)) {
      console.error(`mcp-check: в снимке нет «${expectText}»`);
      return 1;
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err.message);
      process.exitCode = 1;
    },
  );
}
