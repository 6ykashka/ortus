#!/usr/bin/env node
// W2.47 · Прогон-дым k6 на стенде compose своего слота: стенд (postgres, MinIO, Mailpit, OTel) → бакет → migrate →
// `seed demo` («Логистика» в «Альте») → cmd/api (APP_ENV=e2e, dev-вход; presigned URL на host.docker.internal) и
// cmd/worker (проверка фото) → k6 LOAD_STAGE=stand в Docker (Илья Васильев проходит две смены подряд — Р-208 сида и
// рейс, который планирует setup(); Дарья Зимина принимает обе) → остановка процессов → `down -v` (всегда, кроме --keep).
//
//   node backend/test/load/stand-smoke.mjs --slot 7 [--keep] [--out <каталог>]
//
// Порты — план v2 §3.6: API 8100 + слот, Origin — Vite 5200 + слот. Слот 0 (стенд интегратора и показа) не берётся.
// Логи cmd/api, cmd/worker, вывод и сводка k6, env-файл — .claude/tmp/load-stand/s<слот>/ (каталог не в git) или
// --out (из worktree — каталог в .claude/tmp основного репозитория).
// Коды: 0 — пороги и сводка зелёные; 1 — шаг, пороги или сводка упали; 2 — аргументы или нет Docker.
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_SLOT, parseEnv } from '../../../deploy/compose/stand.mjs';
import { apiEnv, appPorts, startLogged, workerEnv } from '../../../tools/ci/e2e-stand.mjs';
import { FLOW_ABORTED, K6_IMAGE, buildVolumeThresholds } from './lib/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const STAND = join(ROOT, 'deploy', 'compose', 'stand.mjs');
const READY_TIMEOUT_MS = 60_000;
const DOCKER_TIMEOUT_MS = 120_000;
const K6_TIMEOUT_MS = 10 * 60_000;
const STAGE = 'stand';

const log = (m) => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`${m}\n`);

/** Аргументы: слот 1…MAX_SLOT, --keep. */
export function parseArgs(argv) {
  const i = argv.indexOf('--slot');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  const slot = Number(raw);
  if (raw === undefined || !/^\d+$/.test(raw) || slot > MAX_SLOT) {
    throw new RangeError(`--slot <1…${MAX_SLOT}> обязателен, получено «${raw ?? ''}»`);
  }
  if (slot === 0) {
    throw new RangeError(
      'слот 0 — общий стенд интегратора и стенд показа: возьмите свой слот (план v2 §3.6)',
    );
  }
  const j = argv.indexOf('--out');
  if (j >= 0 && !argv[j + 1]) throw new RangeError('--out <каталог> — без каталога');
  const out =
    j >= 0 ? resolve(argv[j + 1]) : join(ROOT, '.claude', 'tmp', 'load-stand', `s${slot}`);
  return { slot, keep: argv.includes('--keep'), out, envFile: join(out, 'stand.env') };
}

/**
 * Окружение cmd/api: как у e2e-stand (режим e2e, dev-вход, адрес и Origin слота) плюс S3_PUBLIC_ENDPOINT на
 * host.docker.internal: k6 в контейнере кладёт фото и скачивает их по presigned URL этого хоста, а подпись SigV4
 * считается по нему же. Сервер ходит в MinIO по S3_ENDPOINT (127.0.0.1).
 */
export function apiEnvFor(standEnv, slot) {
  if (!standEnv.S3_ENDPOINT) throw new Error('S3_ENDPOINT не задан в env стенда');
  const pub = new URL(standEnv.S3_ENDPOINT);
  pub.hostname = 'host.docker.internal';
  return { ...apiEnv(standEnv, slot), S3_PUBLIC_ENDPOINT: pub.origin };
}

/** Аргументы docker: k6 стадии stand против API слота; сводка — в каталог прогона. */
export function k6Args({ slot, scripts, results, runId }) {
  const { api, vite } = appPorts(slot);
  return [
    'run',
    '--rm',
    '--add-host=host.docker.internal:host-gateway',
    '-v',
    `${scripts}:/scripts:ro`,
    '-v',
    `${results}:/results`,
    K6_IMAGE,
    'run',
    '-e',
    `LOAD_STAGE=${STAGE}`,
    '-e',
    `BASE_URL=http://host.docker.internal:${api}`,
    '-e',
    `ORIGIN=http://127.0.0.1:${vite}`,
    '-e',
    `RUN_ID=${runId}`,
    '--summary-export',
    '/results/stand-summary.json',
    '/scripts/main.js',
  ];
}

/** Итог сводки k6: проверки, ошибки HTTP, пороги объёма стадии stand, прерванные итерации. */
export function summaryVerdict(summary, profile) {
  const m = (summary && summary.metrics) || {};
  const lines = [];
  const expect = (cond, text) => lines.push(`${cond ? 'ok  ' : 'FAIL'} ${text}`);
  const checks = m.checks || {};
  expect(
    checks.fails === 0 && checks.passes > 0,
    `checks: ${checks.passes} прошло, ${checks.fails} провалено`,
  );
  const failed = m.http_req_failed || {};
  expect(
    failed.value === 0,
    `http_req_failed: ${failed.passes} неуспешных из ${(failed.passes ?? 0) + (failed.fails ?? 0)}`,
  );
  for (const [key, [rule]] of Object.entries(buildVolumeThresholds(profile, STAGE))) {
    const min = Number(rule.replace('count>=', ''));
    const got = m[key]?.count ?? 0;
    expect(got >= min, `${key}: ${got} (порог ${min})`);
  }
  const aborted = m[FLOW_ABORTED]?.count ?? 0;
  expect(aborted === 0, `${FLOW_ABORTED}: ${aborted}`);
  // Стенд разработчика — не оборудование целей (latencyGate: false): p95 пилота только наблюдается.
  const targets = { read: profile.targets.readP95Ms, write: profile.targets.writeP95Ms };
  for (const [kind, target] of Object.entries(targets)) {
    const p95 = m[`http_req_duration{tenant:pilot,kind:${kind}}`]?.['p(95)'];
    if (p95 !== undefined) {
      lines.push(`info p95 ${kind}: ${Math.round(p95)} мс (цель stage < ${target} мс)`);
    }
  }
  return { ok: !lines.some((l) => l.startsWith('FAIL')), lines };
}

function exec(argv, { env = process.env, logFile, timeout } = {}) {
  const [cmd, ...args] = argv;
  let fd;
  const stdio = logFile ? ['ignore', (fd = openSync(logFile, 'w')), fd] : 'inherit';
  try {
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio, env, timeout });
    if (r.error) {
      err(`${cmd}: ${r.error.message}`);
      return 127;
    }
    return r.status ?? 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
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

function tailOf(file, lines) {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** Стенд слота с сидом demo, cmd/api и cmd/worker. */
async function bringUp(o, procs) {
  mkdirSync(o.out, { recursive: true });
  const init = exec([
    process.execPath,
    STAND,
    'init',
    '--slot',
    String(o.slot),
    '--force',
    '--env',
    o.envFile,
  ]);
  if (init !== 0) return `init — код ${init}`;
  for (const step of [['up'], ['bucket'], ['migrate'], ['seed', 'demo']]) {
    log(`▶ load-stand/${step.join(' ')}`);
    const c = stand(o, ...step);
    if (c !== 0) return `${step.join(' ')} — код ${c}`;
  }
  const exe = process.platform === 'win32' ? '.exe' : '';
  const bins = { api: join(o.out, `api${exe}`), worker: join(o.out, `worker${exe}`) };
  for (const [name, bin] of Object.entries(bins)) {
    log(`▶ load-stand/build ${name}`);
    const c = exec(['go', '-C', 'backend', 'build', '-o', bin, `./cmd/${name}`]);
    if (c !== 0) return `build ${name} — код ${c}`;
  }
  const standEnv = parseEnv(readFileSync(o.envFile, 'utf8'));
  procs.api = startLogged(bins.api, [], {
    logFile: join(o.out, 'api.log'),
    cwd: ROOT,
    env: { ...process.env, ...apiEnvFor(standEnv, o.slot) },
  });
  const { api } = appPorts(o.slot);
  const why = await waitReady(`http://127.0.0.1:${api}/readyz`, procs.api.exit);
  if (why) return `cmd/api ${why}; лог ${join(o.out, 'api.log')}`;
  procs.worker = startLogged(bins.worker, ['run'], {
    logFile: join(o.out, 'worker.log'),
    cwd: ROOT,
    env: { ...process.env, ...workerEnv(standEnv) },
  });
  log(`cmd/api 127.0.0.1:${api}, cmd/worker; логи — ${o.out}`);
  return '';
}

/** k6 в Docker: вывод — в k6.log, сводка — stand-summary.json. */
function runK6(o, profile) {
  const summaryFile = join(o.out, 'stand-summary.json');
  rmSync(summaryFile, { force: true });
  const k6Log = join(o.out, 'k6.log');
  log(`▶ load-stand/k6 ${STAGE} (вывод — ${k6Log})`);
  const code = exec(
    [
      'docker',
      ...k6Args({ slot: o.slot, scripts: HERE, results: o.out, runId: Date.now().toString(36) }),
    ],
    { logFile: k6Log, timeout: K6_TIMEOUT_MS },
  );
  log(tailOf(k6Log, 45));
  log(`k6 run ${STAGE}: exit ${code} (99 — провал порогов)`);
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
  } catch {
    summary = null;
  }
  const v = summaryVerdict(summary, profile);
  for (const l of v.lines) log(l);
  return code === 0 && v.ok ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`load-stand: ${e.message}`);
    return 2;
  }
  const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: DOCKER_TIMEOUT_MS,
  });
  if (docker.status !== 0) {
    err(`load-stand: Docker не ответил за ${DOCKER_TIMEOUT_MS / 1000} с`);
    return 2;
  }
  log(`Docker ${docker.stdout.trim()}, образ ${K6_IMAGE}, слот ${o.slot}`);
  const profile = JSON.parse(readFileSync(join(HERE, 'profile.json'), 'utf8'));
  const procs = {};
  let code = 1;
  try {
    const failed = await bringUp(o, procs);
    if (failed) err(`✖ load-stand: ${failed}`);
    else code = runK6(o, profile);
  } finally {
    await stop(procs.worker, 'cmd/worker');
    await stop(procs.api, 'cmd/api');
    if (!o.keep) {
      log('▶ load-stand/down -v');
      stand(o, 'down', '-v');
    }
  }
  if (code !== 0) {
    for (const name of ['api', 'worker']) {
      const t = tailOf(join(o.out, `${name}.log`), 20);
      if (t) err(`--- cmd/${name} (последние строки):\n${t}`);
    }
  }
  log(code === 0 ? '✔ load-stand: готово' : `✖ load-stand: код ${code}`);
  return code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
