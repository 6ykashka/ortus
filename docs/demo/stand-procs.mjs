#!/usr/bin/env node
// Показ 18.10 · процессы стенда показа отвязанно от окна: cmd/api, cmd/worker, Vite (адаптер http), эталон, запасной
// mock. В отличие от `demo-stand.mjs --serve` процессы не завязаны на окно PowerShell: закрыли окно — стенд работает.
// Первый подъём compose — `stand.mjs init/up/bucket/migrate/seed demo` (см. 2026-10-18.md); `reseed` пересоздаёт
// базу и сид показа с перезапуском cmd/api и cmd/worker (Vite, эталон и mock не трогает).
//
//   node docs/demo/stand-procs.mjs start  --env <stand.env> [--slot 0] [--only api,worker,vite,reference,mock]
//   node docs/demo/stand-procs.mjs reseed --env <stand.env> [--slot 0]
//   node docs/demo/stand-procs.mjs stop   [--slot 0] [--only …]
//   node docs/demo/stand-procs.mjs status [--slot 0]
//
// Логи и PID — .claude/tmp/demo/ (слот 0) или .claude/tmp/demo/s<слот>/: api.log, worker.log, vite.log,
// reference.log, mock.log, procs.json. Порты: Vite 5200+slot, API 8100+slot, эталон 4173, mock 5180.
// Коды: 0 — готово, 1 — процесс не поднялся, 2 — аргументы.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_SLOT, parseEnv } from '../../deploy/compose/stand.mjs';
import { apiEnv, appPorts, workerEnv } from '../../tools/ci/e2e-stand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NAMES = ['api', 'worker', 'vite', 'reference', 'mock'];
export const REFERENCE_PORT = 4173;
export const MOCK_PORT = 5180;
const READY_TIMEOUT_MS = 120_000;

const log = (m) => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`${m}\n`);

/** Аргументы: команда, слот, env-файл, набор процессов, каталог логов. */
export function parseArgs(argv) {
  const [cmd] = argv;
  if (!['start', 'stop', 'status', 'reseed'].includes(cmd)) {
    throw new RangeError('команда: start | stop | status | reseed');
  }
  const at = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = at('--slot') ?? '0';
  const slot = Number(raw);
  if (!/^\d+$/.test(raw) || slot > MAX_SLOT) throw new RangeError(`--slot 0…${MAX_SLOT}, получено «${raw}»`);
  const only = at('--only') ? at('--only').split(',').map((s) => s.trim()) : NAMES;
  const unknown = only.filter((n) => !NAMES.includes(n));
  if (unknown.length) throw new RangeError(`неизвестные процессы: ${unknown.join(', ')}`);
  const env = at('--env');
  if ((cmd === 'start' || cmd === 'reseed') && !env) throw new RangeError(`${cmd}: нужен --env <файл стенда>`);
  const out = join(ROOT, '.claude', 'tmp', 'demo', ...(slot === 0 ? [] : [`s${slot}`]));
  return { cmd, slot, only, envFile: env ? resolve(env) : undefined, out };
}

/** Что запускать: команда, аргументы, env, адрес готовности. */
export function plan(name, { slot, standEnv, out }) {
  const { vite, api } = appPorts(slot);
  const exe = process.platform === 'win32' ? '.exe' : '';
  const dev = join(ROOT, 'frontend', 'apps', 'web', 'scripts', 'dev.mjs');
  const web = (adapter, port, extra = {}) => ({
    cmd: process.execPath,
    args: [dev, '--mode', 'e2e', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    env: { ...process.env, VITE_ADAPTER: adapter, ORTUS_SLOT: String(slot), ...extra },
    ready: `http://127.0.0.1:${port}/`,
  });
  switch (name) {
    case 'api':
      return {
        build: './cmd/api',
        cmd: join(out, `api${exe}`),
        args: [],
        env: { ...process.env, ...apiEnv(standEnv, slot) },
        ready: `http://127.0.0.1:${api}/readyz`,
      };
    case 'worker':
      return {
        build: './cmd/worker',
        cmd: join(out, `worker${exe}`),
        args: ['run'],
        env: { ...process.env, ...workerEnv(standEnv) },
        ready: '',
      };
    case 'vite':
      return web('http', vite, { ORTUS_API_ORIGIN: `http://127.0.0.1:${api}` });
    case 'mock':
      return web('mock', MOCK_PORT);
    case 'reference':
      return {
        cmd: process.execPath,
        args: [join(ROOT, 'tools', 'design-preview.js'), 'design', String(REFERENCE_PORT), '--offline'],
        env: process.env,
        ready: `http://127.0.0.1:${REFERENCE_PORT}/`,
      };
    default:
      throw new RangeError(name);
  }
}

const pidsFile = (o) => join(o.out, 'procs.json');
const readPids = (o) => {
  try {
    return JSON.parse(readFileSync(pidsFile(o), 'utf8'));
  } catch {
    return {};
  }
};

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGTERM');
}

async function waitReady(url, pid) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!alive(pid)) return 'процесс завершился';
    try {
      const r = await fetch(url);
      if (r.status < 500) return '';
    } catch {
      // ещё не слушает
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return `нет ответа за ${READY_TIMEOUT_MS / 1000} с`;
}

async function start(o) {
  mkdirSync(o.out, { recursive: true });
  const standEnv = parseEnv(readFileSync(o.envFile, 'utf8'));
  const pids = readPids(o);
  for (const name of NAMES.filter((n) => o.only.includes(n))) {
    if (alive(pids[name])) {
      log(`${name}: уже запущен (pid ${pids[name]})`);
      continue;
    }
    const p = plan(name, { slot: o.slot, standEnv, out: o.out });
    if (p.build) {
      const b = spawnSync('go', ['-C', 'backend', 'build', '-o', p.cmd, p.build], { cwd: ROOT, stdio: 'inherit' });
      if (b.status !== 0) {
        err(`${name}: go build — код ${b.status}`);
        return 1;
      }
    }
    const logFile = join(o.out, `${name}.log`);
    const fd = openSync(logFile, 'w');
    let child;
    try {
      child = spawn(p.cmd, p.args, {
        cwd: ROOT,
        env: p.env,
        stdio: ['ignore', fd, fd],
        detached: true,
        windowsHide: true,
      });
    } finally {
      closeSync(fd);
    }
    child.unref();
    pids[name] = child.pid;
    writeFileSync(pidsFile(o), JSON.stringify(pids, null, 2));
    const why = p.ready ? await waitReady(p.ready, child.pid) : '';
    if (why) {
      err(`✖ ${name}: ${why}; лог ${logFile}`);
      return 1;
    }
    log(`✔ ${name}: pid ${child.pid}${p.ready ? `, ${p.ready}` : ''}; лог ${logFile}`);
  }
  return 0;
}

function stop(o) {
  const pids = readPids(o);
  for (const name of o.only) {
    if (!pids[name]) continue;
    killTree(pids[name]);
    log(`${name}: остановлен (pid ${pids[name]})`);
    delete pids[name];
  }
  if (existsSync(pidsFile(o))) writeFileSync(pidsFile(o), JSON.stringify(pids, null, 2));
  return 0;
}

function status(o) {
  const pids = readPids(o);
  for (const name of NAMES) log(`${name}: ${alive(pids[name]) ? `работает (pid ${pids[name]})` : 'не запущен'}`);
  return 0;
}

/** Шаги пересоздания стенда: путь водителя одноразовый, окна рейсов считаются от запуска сида. */
export const RESEED_STEPS = [['down', '-v'], ['up'], ['bucket'], ['migrate'], ['seed', 'demo']];

/** cmd/api и cmd/worker стоп → compose down -v → up → bucket → migrate → seed demo → cmd/api и cmd/worker старт. */
async function reseed(o) {
  stop({ ...o, only: ['api', 'worker'] });
  const stand = join(ROOT, 'deploy', 'compose', 'stand.mjs');
  for (const s of RESEED_STEPS) {
    log(`▶ stand ${s.join(' ')}`);
    const r = spawnSync(process.execPath, [stand, ...s, '--env', o.envFile], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) {
      err(`✖ stand ${s.join(' ')} — код ${r.status}`);
      return 1;
    }
  }
  return start({ ...o, only: ['api', 'worker'] });
}

export async function main(argv = process.argv.slice(2)) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`stand-procs: ${e.message}`);
    return 2;
  }
  if (o.cmd === 'reseed') return reseed(o);
  if (o.cmd === 'start') return start(o);
  if (o.cmd === 'stop') return stop(o);
  return status(o);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
