#!/usr/bin/env node
// W0.17 · e2e-stand (критика этапа 0, П-1): браузерный путь `/me/context` сквозь стек в CI.
//
//   стенд compose (postgres, mailpit) → migrate → seed → cmd/api (APP_ENV=e2e, dev-вход, SMTP Mailpit)
//   → Playwright `--grep @stand` (Vite и эталон поднимает харнесс W0.05) → down -v (всегда).
// W1.51: лог cmd/api — прямо в файл (Q-W1.23-20: pipe при Playwright в spawnSync никто не читал, cmd/api
// вставал на записи лога), путь лога печатается при падении; почта стенда — Mailpit (Q-W1.23-21, Q-W1.41-7).
//
// CLI:
//   node tools/ci/e2e-stand.mjs [--slot N] [--keep]   прогон; --keep оставляет env-файл стенда
//   node tools/ci/e2e-stand.mjs --down [--slot N]      только остановка (шаг `if: always()` в CI)
// Слот: --slot, иначе ORTUS_SLOT, иначе в CI 0; локально без слота — код 2: слот 0 — общий стенд
// интегратора, а скрипт удаляет тома своего проекта. Порты — план v2 §3.6 и deploy/compose/stand.mjs.
// Итог: ≥ 1 пройденный тест, 0 пропущенных, 0 упавших (JSON-отчёт Playwright), иначе код 1.
// Коды: 0 — зелёный, 1 — шаг или тесты упали, 2 — аргументы, 3 — порт приложения занят.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MAX_SLOT, parseEnv, portsForSlot, probePort } from '../../deploy/compose/stand.mjs';

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

/** Опубликованный порт сервиса стенда: из env-файла стенда, иначе по слоту (deploy/compose/stand.mjs). */
const standPort = (standEnv, key, slot) => String(standEnv[key] || portsForSlot(slot)[key]);

/** API Mailpit слота (`/api/v1/messages`): порт веб-интерфейса, только loopback. */
export const mailpitURL = (standEnv, slot) =>
  `http://127.0.0.1:${standPort(standEnv, 'MAILPIT_UI_PORT', slot)}`;

/**
 * Окружение cmd/api: env стенда + режим e2e, dev-вход, адрес и Origin по слоту; почта — SMTP Mailpit
 * слота на 127.0.0.1 (Mailpit опубликован только на IPv4 loopback, а `localhost` бывает `::1`),
 * ссылки писем — на origin харнесса (`http://127.0.0.1:<Vite>`, e2e-kit appURL).
 */
export function apiEnv(standEnv, slot) {
  const { vite, api } = appPorts(slot);
  return {
    ...standEnv,
    APP_ENV: 'e2e',
    AUTH_PROVIDER: 'dev',
    HTTP_ADDR: `127.0.0.1:${api}`,
    ALLOWED_ORIGINS: `http://127.0.0.1:${vite},http://localhost:${vite}`,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: standPort(standEnv, 'SMTP_PORT', slot),
    PUBLIC_ORIGIN: `http://127.0.0.1:${vite}`,
  };
}

/**
 * Окружение Playwright: режим stand и явные порты; ORTUS_SLOT — слот стенда (e2e-kit и stand.mjs принимают 0…20).
 * E2E_MAILPIT_URL — API Mailpit для spec с письмами; его хост добавляется к E2E_ALLOW_HOSTS.
 */
export function playwrightEnv(baseEnv, slot, jsonFile, standEnv = {}) {
  const { vite, api, reference } = appPorts(slot);
  const mailpit = mailpitURL(standEnv, slot);
  const allow = (baseEnv.E2E_ALLOW_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const env = {
    ...baseEnv,
    E2E_MODE: 'stand',
    E2E_FRESH_SERVER: '1',
    PORT: String(vite),
    HTTP_ADDR: `127.0.0.1:${api}`,
    REFERENCE_PORT: String(reference),
    E2E_MAILPIT_URL: mailpit,
    E2E_ALLOW_HOSTS: [...new Set([...allow, new URL(mailpit).host])].join(','),
    PLAYWRIGHT_JSON_OUTPUT_FILE: jsonFile,
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonFile,
    PLAYWRIGHT_HTML_OPEN: 'never',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  };
  env.ORTUS_SLOT = String(slot);
  return env;
}

/**
 * stdio cmd/api: журнал — прямо в файл (дескриптор), не канал. Playwright идёт через spawnSync,
 * цикл событий родителя стоит, и канал stdout никто не читает: после 64 КиБ журнала API
 * блокируется на записи лога и перестаёт отвечать (Q-W1.22-12).
 */
export const apiStdio = (fd) => ['ignore', fd, fd];

/**
 * Дочерний процесс с stdout и stderr прямо в файл (Q-W1.23-20). Родитель не держит pipe: пока он стоит
 * в spawnSync (Playwright), ребёнок пишет лог без ограничения буфера и не блокируется на записи.
 */
export function startLogged(cmd, args, { logFile, cwd, env }) {
  const fd = openSync(logFile, 'w');
  let child;
  try {
    child = spawn(cmd, args, { cwd, env, stdio: apiStdio(fd) });
  } finally {
    closeSync(fd); // у ребёнка своя копия дескриптора
  }
  const exit = new Promise((done) => {
    child.once('exit', (code) => done(code ?? 1));
    child.once('error', () => done(127));
  });
  return { child, exit };
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
      { id: 'up', argv: stand('up', 'postgres', 'mailpit', '--env', envFile) },
      { id: 'migrate', argv: stand('migrate', '--env', envFile) },
      { id: 'seed', argv: stand('seed', '--env', envFile) },
      { id: 'build-api', argv: ['go', '-C', 'backend', 'build', '-o', apiBin, './cmd/api'] },
      { id: 'start-api', fn: (st) => startApi(st, slot, envFile, apiBin) },
      { id: 'readyz', fn: (st) => waitReady(st, slot) },
      { id: 'playwright', fn: () => runPlaywright(slot, envFile) },
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
  const env = { ...process.env, ...apiEnv(parseEnv(readFileSync(envFile, 'utf8')), slot) };
  const { child, exit } = startLogged(apiBin, [], { logFile: st.apiLog, cwd: ROOT, env });
  st.api = child;
  st.apiExit = exit;
  log(
    `cmd/api: pid ${st.api.pid}, ${env.HTTP_ADDR}, SMTP ${env.SMTP_HOST}:${env.SMTP_PORT}, ` +
      `PUBLIC_ORIGIN ${env.PUBLIC_ORIGIN}, лог ${st.apiLog}`,
  );
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
      return 1;
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
  return 1;
}

/** При падении любого шага после старта cmd/api: путь лога и его последние строки. */
function dumpApiLog(st) {
  if (!st.apiLog) return;
  err(`лог cmd/api: ${st.apiLog}`);
  if (!existsSync(st.apiLog)) return;
  const lines = readFileSync(st.apiLog, 'utf8').trimEnd().split(/\r?\n/);
  err(`--- последние строки лога cmd/api (${st.apiLog}) ---`);
  err(lines.slice(-40).join('\n'));
}

function runPlaywright(slot, envFile) {
  const jsonFile = join(tmpdir(), `ortus-e2e-stand-s${slot}.json`);
  rmSync(jsonFile, { force: true });
  const standEnv = parseEnv(readFileSync(envFile, 'utf8'));
  const env = playwrightEnv(process.env, slot, jsonFile, standEnv);
  log(`Playwright: E2E_MAILPIT_URL ${env.E2E_MAILPIT_URL}`);
  const code = exec([...pnpmArgv(), ...playwrightArgs()], env);
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
        dumpApiLog(st);
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
