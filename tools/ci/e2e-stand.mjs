#!/usr/bin/env node
// W0.17 · e2e-stand (критика этапа 0, П-1): браузерный путь `/me/context` сквозь стек в CI.
//
//   стенд compose (только postgres) → migrate → seed → cmd/api (APP_ENV=e2e, dev-вход)
//   → Playwright `--grep @stand` (Vite и эталон поднимает харнесс W0.05) → down -v (всегда).
//
// CLI:
//   node tools/ci/e2e-stand.mjs [--slot N] [--keep]   прогон; --keep оставляет env-файл стенда
//   node tools/ci/e2e-stand.mjs --down [--slot N]      только остановка (шаг `if: always()` в CI)
// Слот: --slot, иначе ORTUS_SLOT, иначе в CI 0; локально без слота — код 2: слот 0 — общий стенд
// интегратора, а скрипт удаляет тома своего проекта. Порты — план v2 §3.6 и deploy/compose/stand.mjs.
// Итог: ≥ 1 пройденный тест, 0 пропущенных, 0 упавших (JSON-отчёт Playwright), иначе код 1.
// Коды: 0 — зелёный, 1 — шаг или тесты упали, 2 — аргументы, 3 — порт приложения занят.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_SLOT, parseEnv, probePort } from '../../deploy/compose/stand.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAND = join(ROOT, 'deploy', 'compose', 'stand.mjs');
const READY_TIMEOUT_MS = 60_000;

/** Слот: --slot → ORTUS_SLOT → 0 в CI → null (локально без слота). */
export function resolveSlot(argv, env) {
  const i = argv.indexOf('--slot');
  const raw = i >= 0 ? argv[i + 1] : env.ORTUS_SLOT;
  if (raw === undefined || raw === '') return env.CI === 'true' ? 0 : null;
  const slot = Number(raw);
  if (!/^\d+$/.test(String(raw)) || slot > MAX_SLOT) {
    throw new RangeError(`слот должен быть целым 0…${MAX_SLOT}, получено «${raw}»`);
  }
  return slot;
}

/** Порты приложения слота (план v2 §3.6). */
export const appPorts = (slot) => ({ vite: 5200 + slot, api: 8100 + slot, reference: 4100 + slot });

/** env-файл стенда e2e — вне репозитория: корневой .env исполнителя не трогается. */
export const standEnvFile = (slot, dir = tmpdir()) => join(dir, `ortus-e2e-stand-s${slot}.env`);

/** Окружение cmd/api: env стенда + режим e2e, dev-вход, адрес и Origin по слоту. */
export function apiEnv(standEnv, slot) {
  const { vite, api } = appPorts(slot);
  return {
    ...standEnv,
    APP_ENV: 'e2e',
    AUTH_PROVIDER: 'dev',
    HTTP_ADDR: `127.0.0.1:${api}`,
    ALLOWED_ORIGINS: `http://127.0.0.1:${vite},http://localhost:${vite}`,
  };
}

/** Окружение Playwright: режим stand и явные порты; ORTUS_SLOT — слот стенда (e2e-kit и stand.mjs принимают 0…20). */
export function playwrightEnv(baseEnv, slot, jsonFile) {
  const { vite, api, reference } = appPorts(slot);
  const env = {
    ...baseEnv,
    E2E_MODE: 'stand',
    E2E_FRESH_SERVER: '1',
    PORT: String(vite),
    HTTP_ADDR: `127.0.0.1:${api}`,
    REFERENCE_PORT: String(reference),
    PLAYWRIGHT_JSON_OUTPUT_FILE: jsonFile,
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    PLAYWRIGHT_HTML_OPEN: 'never',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  };
  env.ORTUS_SLOT = String(slot);
  return env;
}

export const playwrightArgs = () => [
  '--filter',
  '@ortus/web',
  'exec',
  'playwright',
  'test',
  '--grep',
  '@stand',
  '--reporter=list,json,html',
];

/** Итог JSON-отчёта: пройден хотя бы один тест, нет пропусков и падений. */
export function verdict(report) {
  const s = report?.stats;
  if (!s)
    return { ok: false, passed: 0, skipped: 0, failed: 0, reason: 'нет JSON-отчёта Playwright' };
  const passed = (s.expected ?? 0) + (s.flaky ?? 0);
  const skipped = s.skipped ?? 0;
  const failed = s.unexpected ?? 0;
  let reason = '';
  if (failed) reason = `упало ${failed}`;
  else if (skipped) reason = `пропущено ${skipped}: @stand не должен пропускаться в режиме stand`;
  else if (!passed) reason = 'тестов @stand не найдено';
  return { ok: !reason, passed, skipped, failed, reason };
}

const stand = (...args) => [process.execPath, STAND, ...args];

/** Шаги прогона: main — по очереди до первой ошибки, always — всегда (остановка). */
export function stepsFor(slot, envFile) {
  const binDir = tmpdir();
  const apiBin = join(
    binDir,
    `ortus-e2e-api-s${slot}${process.platform === 'win32' ? '.exe' : ''}`,
  );
  return {
    apiBin,
    main: [
      { id: 'init', argv: stand('init', '--slot', String(slot), '--force', '--env', envFile) },
      { id: 'ports', fn: () => checkAppPorts(slot) },
      { id: 'up', argv: stand('up', 'postgres', '--env', envFile) },
      { id: 'migrate', argv: stand('migrate', '--env', envFile) },
      { id: 'seed', argv: stand('seed', '--env', envFile) },
      { id: 'build-api', argv: ['go', '-C', 'backend', 'build', '-o', apiBin, './cmd/api'] },
      { id: 'start-api', fn: (st) => startApi(st, slot, envFile, apiBin) },
      { id: 'readyz', fn: (st) => waitReady(st, slot) },
      { id: 'playwright', fn: () => runPlaywright(slot) },
    ],
    always: [
      { id: 'stop-api', fn: (st) => stopApi(st) },
      { id: 'down', argv: stand('down', '-v', '--env', envFile), when: () => existsSync(envFile) },
    ],
  };
}

const log = (m) => process.stdout.write(`${m}\n`);
const err = (m) => process.stderr.write(`${m}\n`);

function pnpmArgv(env = process.env) {
  const execpath = env.npm_execpath ?? '';
  if (/pnpm\.c?js$/.test(execpath)) return [process.execPath, execpath];
  return env.CI === 'true' ? ['pnpm'] : ['corepack', 'pnpm'];
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

async function checkAppPorts(slot) {
  const busy = [];
  for (const [name, port] of Object.entries(appPorts(slot))) {
    if (!(await probePort(port))) busy.push(`  127.0.0.1:${port}  ${name}`);
  }
  if (!busy.length) return 0;
  err(
    [
      `e2e-stand: порты приложения слота ${slot} заняты (план v2 §3.6):`,
      ...busy,
      'Остановите свой Vite/API/эталон этого слота или возьмите другой слот (--slot N).',
    ].join('\n'),
  );
  return 3;
}

function startApi(st, slot, envFile, apiBin) {
  st.apiLog = join(tmpdir(), `ortus-e2e-api-s${slot}.log`);
  const out = createWriteStream(st.apiLog);
  const env = { ...process.env, ...apiEnv(parseEnv(readFileSync(envFile, 'utf8')), slot) };
  st.api = spawn(apiBin, [], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  st.api.stdout.pipe(out);
  st.api.stderr.pipe(out);
  st.apiExit = new Promise((done) => st.api.once('exit', (code) => done(code ?? 1)));
  log(`cmd/api: pid ${st.api.pid}, ${env.HTTP_ADDR}, лог ${st.apiLog}`);
  return 0;
}

async function waitReady(st, slot) {
  const url = `http://127.0.0.1:${appPorts(slot).api}/readyz`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = null;
  st.apiExit.then((c) => (exited = c));
  while (Date.now() < deadline) {
    if (exited !== null) {
      err(`cmd/api завершился с кодом ${exited} до готовности`);
      return dumpApiLog(st, 1);
    }
    try {
      const r = await fetch(url);
      if (r.status === 200) {
        log(`GET ${url} → 200`);
        return 0;
      }
    } catch {
      // ещё не слушает
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  err(`GET ${url}: нет 200 за ${READY_TIMEOUT_MS / 1000} с`);
  return dumpApiLog(st, 1);
}

function dumpApiLog(st, code) {
  if (st.apiLog && existsSync(st.apiLog)) {
    const lines = readFileSync(st.apiLog, 'utf8').trimEnd().split('\n');
    err(`--- последние строки лога cmd/api (${st.apiLog}) ---`);
    err(lines.slice(-40).join('\n'));
  }
  return code;
}

function runPlaywright(slot) {
  const jsonFile = join(tmpdir(), `ortus-e2e-stand-s${slot}.json`);
  rmSync(jsonFile, { force: true });
  const code = exec(
    [...pnpmArgv(), ...playwrightArgs()],
    playwrightEnv(process.env, slot, jsonFile),
  );
  let report;
  try {
    report = JSON.parse(readFileSync(jsonFile, 'utf8'));
  } catch {
    report = null;
  }
  const v = verdict(report);
  log(
    `e2e-stand: @stand пройдено ${v.passed}, пропущено ${v.skipped}, упало ${v.failed}` +
      (v.reason ? ` — ${v.reason}` : ''),
  );
  if (code !== 0) return code;
  return v.ok ? 0 : 1;
}

async function stopApi(st) {
  if (!st.api || st.api.exitCode !== null) return 0;
  st.api.kill();
  await Promise.race([st.apiExit, new Promise((r) => setTimeout(r, 5_000))]);
  log('cmd/api остановлен');
  return 0;
}

async function runStep(s, st) {
  log(`▶ e2e-stand/${s.id}`);
  return s.argv ? exec(s.argv) : s.fn(st);
}

/** Прогон: main до первой ошибки, затем always в любом случае. */
export async function runStand(slot, { keep = false } = {}) {
  const envFile = standEnvFile(slot);
  const { main, always } = stepsFor(slot, envFile);
  const st = {};
  let code = 0;
  try {
    for (const s of main) {
      code = await runStep(s, st);
      if (code !== 0) {
        err(`✖ e2e-stand/${s.id}: код ${code}`);
        break;
      }
    }
  } finally {
    for (const s of always) {
      if (s.when && !s.when()) continue;
      const c = await runStep(s, st);
      if (c !== 0) err(`✖ e2e-stand/${s.id}: код ${c} (остановка)`);
    }
    if (!keep) rmSync(envFile, { force: true });
  }
  log(code === 0 ? '✔ e2e-stand: зелёный' : `✖ e2e-stand: код ${code}`);
  return code;
}

/** Только остановка стенда слота (шаг always в CI): env-файл восстанавливается при необходимости. */
export function downStand(slot) {
  const envFile = standEnvFile(slot);
  if (!existsSync(envFile)) {
    const c = exec(stand('init', '--slot', String(slot), '--force', '--env', envFile));
    if (c !== 0) return c;
  }
  const code = exec(stand('down', '-v', '--env', envFile));
  rmSync(envFile, { force: true });
  return code;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let slot;
  try {
    slot = resolveSlot(argv, env);
  } catch (e) {
    err(`e2e-stand: ${e.message}`);
    return 2;
  }
  if (slot === null) {
    err(
      'e2e-stand: не задан слот. Локально: $env:ORTUS_SLOT=<N> (1…20) или --slot <N>; ' +
        'слот 0 — общий стенд интегратора (в CI — по умолчанию).',
    );
    return 2;
  }
  if (argv.includes('--down')) return downStand(slot);
  return runStand(slot, { keep: argv.includes('--keep') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
