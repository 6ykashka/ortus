#!/usr/bin/env node
// W2.90 · Стенд показа 18.10 одной командой: compose слота (postgres, MinIO, Mailpit, OTel) → бакет → migrate →
// `seed demo` (базовый сид + «Логистика» в «Альте» и Марина Котова — менеджер логистики, как пресет MSW
// logistics-ready) → cmd/api (APP_ENV=e2e, dev-вход персонажей) и cmd/worker (проверка фото, уведомления) → дальше:
//   --e2e    Playwright `e2e/journeys/stage2` в режиме stand, затем остановка и `down -v` (прогон исполнителя);
//   --serve  Vite в режиме e2e (адаптер http) для показа; Ctrl+C останавливает Vite, cmd/api и cmd/worker, стенд
//            остаётся (снять — `node deploy/compose/stand.mjs down -v --env <файл>`).
//
//   node docs/demo/demo-stand.mjs --slot 12 --e2e [--keep]
//   node docs/demo/demo-stand.mjs --slot 0 --serve [--env .env]
//
// Порты — план v2 §3.6 (tools/ci/e2e-stand.mjs): Vite 5200+slot, API 8100+slot, эталон 4100+slot. Логи и env-файл —
// .claude/tmp/demo-stand/s<slot>/ (каталог не в git). Слот 0 — стенд показа: только по решению интегратора.
// Коды: 0 — готово, 1 — шаг или тесты упали, 2 — аргументы.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_SLOT, parseEnv } from '../../deploy/compose/stand.mjs';
import {
  apiEnv,
  appPorts,
  playwrightEnv,
  startLogged,
  verdict,
  workerEnv,
} from '../../tools/ci/e2e-stand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAND = join(ROOT, 'deploy', 'compose', 'stand.mjs');
const READY_TIMEOUT_MS = 60_000;

const log = (m) => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`${m}\n`);

/** Аргументы: слот, режим, env-файл, --keep. */
export function parseArgs(argv) {
  const at = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const raw = at('--slot');
  const slot = Number(raw);
  if (raw === undefined || !/^\d+$/.test(raw) || slot > MAX_SLOT) {
    throw new RangeError(`--slot <0…${MAX_SLOT}> обязателен, получено «${raw ?? ''}»`);
  }
  const modes = ['--e2e', '--serve'].filter((m) => argv.includes(m));
  if (modes.length !== 1) throw new RangeError('нужен ровно один режим: --e2e или --serve');
  const out = join(ROOT, '.claude', 'tmp', 'demo-stand', `s${slot}`);
  const env = at('--env');
  return {
    slot,
    mode: modes[0].slice(2),
    keep: argv.includes('--keep'),
    out,
    envFile: env ? resolve(env) : join(out, 'stand.env'),
    ownEnv: !env,
  };
}

/** Хост MinIO из S3_ENDPOINT стенда: браузер кладёт фото по presigned URL этого хоста. */
export function storageHost(standEnv) {
  try {
    return new URL(standEnv.S3_ENDPOINT).host;
  } catch {
    return '';
  }
}

function exec(argv, env = process.env) {
  const [cmd, ...args] = argv;
  const shell = process.platform === 'win32' && !isAbsolute(cmd) && /^(corepack|pnpm)$/.test(cmd);
  const quoted = shell ? args.map((a) => (/[\s,"&|<>^]/.test(a) ? `"${a}"` : a)) : args;
  const r = spawnSync(cmd, quoted, { cwd: ROOT, stdio: 'inherit', env, shell });
  if (r.error) {
    err(`${cmd}: ${r.error.message}`);
    return 127;
  }
  return r.status ?? 1;
}

const stand = (o, ...args) => exec([process.execPath, STAND, ...args, '--env', o.envFile]);

async function waitReady(url, exit) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = null;
  exit.then((c) => (exited = c));
  while (Date.now() < deadline) {
    if (exited !== null) return `завершился с кодом ${exited}`;
    try {
      if ((await fetch(url)).status === 200) return '';
    } catch {
      // ещё не слушает
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return `нет 200 за ${READY_TIMEOUT_MS / 1000} с`;
}

async function stop(p, name) {
  if (!p || p.child.exitCode !== null) return;
  p.child.kill();
  await Promise.race([p.exit, new Promise((r) => setTimeout(r, 5_000))]);
  log(`${name} остановлен`);
}

/** Стенд слота с сидом показа, cmd/api и cmd/worker; возвращает процессы и env стенда. */
async function bringUp(o) {
  mkdirSync(o.out, { recursive: true });
  if (o.ownEnv) {
    const c = exec([process.execPath, STAND, 'init', '--slot', String(o.slot), '--force', '--env', o.envFile]);
    if (c !== 0) return { code: c };
  } else if (!existsSync(o.envFile)) {
    err(`нет env-файла ${o.envFile}`);
    return { code: 2 };
  }
  for (const step of [['up'], ['bucket'], ['migrate'], ['seed', 'demo']]) {
    log(`▶ demo-stand/${step.join(' ')}`);
    const c = stand(o, ...step);
    if (c !== 0) return { code: c, failed: step.join(' ') };
  }
  const exe = process.platform === 'win32' ? '.exe' : '';
  const bins = { api: join(o.out, `api${exe}`), worker: join(o.out, `worker${exe}`) };
  for (const [name, bin] of Object.entries(bins)) {
    log(`▶ demo-stand/build ${name}`);
    const c = exec(['go', '-C', 'backend', 'build', '-o', bin, `./cmd/${name}`]);
    if (c !== 0) return { code: c, failed: `build ${name}` };
  }
  const standEnv = parseEnv(readFileSync(o.envFile, 'utf8'));
  const procs = {};
  procs.api = startLogged(bins.api, [], {
    logFile: join(o.out, 'api.log'),
    cwd: ROOT,
    env: { ...process.env, ...apiEnv(standEnv, o.slot) },
  });
  const { api, vite } = appPorts(o.slot);
  const why = await waitReady(`http://127.0.0.1:${api}/readyz`, procs.api.exit);
  if (why) {
    err(`cmd/api ${why}; лог ${join(o.out, 'api.log')}`);
    return { code: 1, procs, failed: 'readyz' };
  }
  procs.worker = startLogged(bins.worker, ['run'], {
    logFile: join(o.out, 'worker.log'),
    cwd: ROOT,
    env: { ...process.env, ...workerEnv(standEnv) },
  });
  log(`cmd/api 127.0.0.1:${api}, cmd/worker; логи — ${o.out}; Vite будет на 127.0.0.1:${vite}`);
  return { code: 0, procs, standEnv };
}

function runPlaywright(o, standEnv) {
  const jsonFile = join(o.out, 'playwright.json');
  rmSync(jsonFile, { force: true });
  const env = playwrightEnv(process.env, o.slot, jsonFile, standEnv);
  const minio = storageHost(standEnv);
  env.E2E_ALLOW_HOSTS = [env.E2E_ALLOW_HOSTS, minio].filter(Boolean).join(',');
  env.E2E_OWN_REFERENCE = '1';
  const code = exec(
    [
      'corepack',
      'pnpm',
      '--filter',
      '@ortus/web',
      'exec',
      'playwright',
      'test',
      'e2e/journeys/stage2',
      '--grep',
      '@stand',
      '--workers=1',
      '--reporter=list,json',
    ],
    env,
  );
  let report = null;
  try {
    report = JSON.parse(readFileSync(jsonFile, 'utf8'));
  } catch {
    report = null;
  }
  const v = verdict(report);
  log(`demo-stand: @stand пройдено ${v.passed}, пропущено ${v.skipped}, упало ${v.failed}`);
  // Пропуски ожидаемы: путь водителя — один проект (390), приёмка — fixme до W2.06.
  return code !== 0 || v.failed > 0 || v.passed === 0 ? 1 : 0;
}

function serveVite(o) {
  const { vite, api } = appPorts(o.slot);
  const dev = join(ROOT, 'frontend', 'apps', 'web', 'scripts', 'dev.mjs');
  const env = {
    ...process.env,
    VITE_ADAPTER: 'http',
    ORTUS_API_ORIGIN: `http://127.0.0.1:${api}`,
    ORTUS_SLOT: String(o.slot),
  };
  return startLogged(
    process.execPath,
    [dev, '--mode', 'e2e', '--host', '127.0.0.1', '--port', String(vite), '--strictPort'],
    { logFile: join(o.out, 'vite.log'), cwd: ROOT, env },
  );
}

export async function main(argv = process.argv.slice(2)) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`demo-stand: ${e.message}`);
    return 2;
  }
  const up = await bringUp(o);
  const procs = up.procs ?? {};
  let code = up.code;
  if (code !== 0) err(`✖ demo-stand: шаг ${up.failed ?? 'init'} — код ${code}`);
  if (code === 0 && o.mode === 'e2e') code = runPlaywright(o, up.standEnv);
  if (code === 0 && o.mode === 'serve') {
    procs.vite = serveVite(o);
    const { vite } = appPorts(o.slot);
    log(
      [
        `Показ: http://127.0.0.1:${vite}/?persona=<персонаж> (owner, manager, driver, operator, owner@t-lotos)`,
        'Остановить — Ctrl+C (стенд остаётся; снять — stand.mjs down -v --env <файл>).',
      ].join('\n'),
    );
    await new Promise((done) => {
      process.once('SIGINT', done);
      process.once('SIGTERM', done);
      procs.vite.exit.then(done);
    });
  }
  await stop(procs.vite, 'Vite');
  await stop(procs.worker, 'cmd/worker');
  await stop(procs.api, 'cmd/api');
  if (o.mode === 'e2e' && !o.keep && existsSync(o.envFile)) {
    log('▶ demo-stand/down -v');
    stand(o, 'down', '-v');
  }
  log(code === 0 ? '✔ demo-stand: готово' : `✖ demo-stand: код ${code}`);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
