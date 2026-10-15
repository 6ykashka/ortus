#!/usr/bin/env node
// W0.06 · CLI стенда compose. Без зависимостей: Node 22, docker compose v2, go.
// W0.17 · `all` (стенд одной командой, П-5), проверка портов перед up (код 3, П-6), слоты 0…20.
//
//   node deploy/compose/stand.mjs all [--slot <N>] [--force]  init (если нет .env) → up → migrate → seed
//   node deploy/compose/stand.mjs init --slot <N> [--force]   .env для слота N (UTF-8 без BOM)
//   node deploy/compose/stand.mjs up [--profile test|keycloak|init ...] [svc ...]
//   node deploy/compose/stand.mjs down [-v]
//   node deploy/compose/stand.mjs ps | config | logs [svc]
//   node deploy/compose/stand.mjs bucket                       одноразовый minio-init (бакет S3_BUCKET)
//   node deploy/compose/stand.mjs migrate [args...]            go run ./cmd/migrate (по умолчанию: all up)
//   node deploy/compose/stand.mjs seed [args...]               go run ./cmd/seed
// Общий флаг: --env <путь> (не --env-file: Node 22 сам разбирает --env-file в любом месте argv) (по умолчанию .env в корне репозитория).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const COMPOSE_FILE = join('deploy', 'compose', 'docker-compose.yml');

/** Опубликованные порты стенда на слоте 0. На слоте N — база + 100 × N (план §3.6). */
export const PORTS = Object.freeze({
  POSTGRES_PORT: 5432,
  PG_TEST_PORT: 5433,
  MINIO_PORT: 9000,
  MINIO_CONSOLE_PORT: 9001,
  MAILPIT_UI_PORT: 8025,
  SMTP_PORT: 1025,
  OTEL_GRPC_PORT: 4317,
  OTEL_HTTP_PORT: 4318,
  OTEL_HEALTH_PORT: 13133,
  KEYCLOAK_PORT: 8081,
});

/**
 * База слота N ≥ 1, если она отличается от порта слота 0 (W0.17, П-6). Со старыми базами на слотах
 * 0…20 MinIO попадал на 10000/10001 (слот 10) и 11001 (слот 20) — на машине разработчика они заняты,
 * а OTLP — на 5217/5218 и 6117/6118 (Vite и проверяющий слотов 17–18, план §3.6).
 */
export const SLOT_BASE = Object.freeze({
  MINIO_PORT: 19000,
  MINIO_CONSOLE_PORT: 19001,
  OTEL_GRPC_PORT: 14317,
  OTEL_HTTP_PORT: 14318,
});

/** Порты приложения на слоте 0 (скелет) и у агента слота N (план §3.6). */
const APP_PORTS = { vite: { base: 5173, slot: 5200 }, api: { base: 8080, slot: 8100 } };

export const MAX_SLOT = 20;

function checkSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    throw new RangeError(`slot должен быть целым 0…${MAX_SLOT}, получено ${slot}`);
  }
}

/** Порт переменной на слоте: слот 0 — скелет, слот N — база слота + 100 × N. */
const slotPort = (key, slot) =>
  slot === 0 ? PORTS[key] : (SLOT_BASE[key] ?? PORTS[key]) + 100 * slot;

/** Порты стенда для слота. */
export function portsForSlot(slot) {
  checkSlot(slot);
  return Object.fromEntries(Object.keys(PORTS).map((k) => [k, slotPort(k, slot)]));
}

/** Сервисы compose: профиль и переменные опубликованных портов (сверяется с compose тестом). */
export const SERVICES = Object.freeze({
  postgres: { ports: ['POSTGRES_PORT'] },
  'postgres-test': { profile: 'test', ports: ['PG_TEST_PORT'] },
  minio: { ports: ['MINIO_PORT', 'MINIO_CONSOLE_PORT'] },
  'minio-init': { profile: 'init', ports: [] },
  mailpit: { ports: ['MAILPIT_UI_PORT', 'SMTP_PORT'] },
  'otel-collector': { ports: ['OTEL_GRPC_PORT', 'OTEL_HTTP_PORT', 'OTEL_HEALTH_PORT'] },
  keycloak: { profile: 'keycloak', ports: ['KEYCLOAK_PORT'] },
});

/** Сервисы, которые запустит `up`: явный список или все без профиля + из включённых профилей. */
export function servicesFor(profiles, names) {
  if (names.length) return [...names];
  return Object.entries(SERVICES)
    .filter(([, s]) => !s.profile || profiles.includes(s.profile))
    .map(([name]) => name);
}

/** Опубликованные порты выбранных сервисов по значениям env (как подставит compose). */
export function plannedPorts(env, services) {
  return services.flatMap((service) =>
    (SERVICES[service]?.ports ?? []).map((key) => ({
      key,
      service,
      port: Number(env[key] ?? PORTS[key]),
    })),
  );
}

/** Порты, которые уже публикует свой проект: вывод `docker compose ps --format json` (NDJSON или массив). */
export function ownPorts(psOutput) {
  const text = psOutput.trim();
  if (!text) return new Set();
  const rows = text.startsWith('[')
    ? JSON.parse(text)
    : text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l));
  return new Set(
    rows.flatMap((r) => (r.Publishers ?? []).map((p) => p.PublishedPort).filter((p) => p > 0)),
  );
}

/**
 * Свободен ли порт на 127.0.0.1: занять его самим (EADDRINUSE, EACCES — занят или исключён
 * Hyper-V) и проверить, что к нему никто не принимает соединения (сокет на 0.0.0.0 у другого процесса).
 */
export async function probePort(port, host = '127.0.0.1') {
  const { createServer, connect } = await import('node:net');
  const canListen = await new Promise((done) => {
    const srv = createServer();
    srv.once('error', () => done(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => done(true)));
  });
  if (!canListen) return false;
  const accepts = await new Promise((done) => {
    const sock = connect({ port, host });
    const finish = (v) => {
      sock.destroy();
      done(v);
    };
    sock.setTimeout(500, () => finish(false));
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
  });
  return !accepts;
}

/** Текст ошибки «порты заняты»: адрес, переменная, сервис и как найти процесс. */
export function busyPortsMessage(project, busy) {
  const lines = busy.map((b) => `  127.0.0.1:${b.port}  ${b.key} (${b.service})`);
  const first = busy[0]?.port ?? '<порт>';
  return [
    `stand: порты стенда «${project}» заняты другими процессами:`,
    ...lines,
    'Освободите порты или возьмите другой слот: node deploy/compose/stand.mjs init --slot <N> --force',
    `Кто держит порт: Windows — Get-NetTCPConnection -State Listen -LocalPort ${first} | Select-Object OwningProcess;`,
    `  Linux/macOS — lsof -nP -iTCP:${first} -sTCP:LISTEN. Исключённые диапазоны Windows: netsh int ipv4 show excludedportrange protocol=tcp`,
  ].join('\n');
}

/** Разбор dotenv в духе docker compose: KEY=value, комментарий « #…» после значения отбрасывается. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(raw);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

/** Значение переменной для слота: имя проекта, порты, адреса с портами стенда и приложения. */
function valueForSlot(key, value, slot) {
  if (slot === 0) return value;
  if (key === 'COMPOSE_PROJECT_NAME') return `ortus-s${slot}`;
  if (key in PORTS) return String(slotPort(key, slot));
  if (key === 'HTTP_ADDR') return `127.0.0.1:${APP_PORTS.api.slot + slot}`;
  const shift = new Map(Object.keys(PORTS).map((k) => [PORTS[k], slotPort(k, slot)]));
  shift.set(APP_PORTS.vite.base, APP_PORTS.vite.slot + slot);
  shift.set(APP_PORTS.api.base, APP_PORTS.api.slot + slot);
  return value.replace(/\b(localhost|127\.0\.0\.1):(\d+)\b/g, (all, host, port) => {
    const to = shift.get(Number(port));
    return to === undefined ? all : `${host}:${to}`;
  });
}

/** Текст .env для слота из .env.example: меняются только значения, комментарии и порядок сохраняются. */
export function renderEnv(exampleText, slot) {
  checkSlot(slot);
  return exampleText
    .split('\n')
    .map((line) => {
      const m = /^([A-Z][A-Z0-9_]*)=(\S*)(.*)$/.exec(line);
      if (!m) return line;
      const next = valueForSlot(m[1], m[2], slot);
      return next === m[2] ? line : `${m[1]}=${next}${m[3]}`;
    })
    .join('\n');
}

/** Аргументы docker для команды compose: имя проекта и файлы — явно. */
export function composeArgs(env, envFile, rest) {
  return [
    'compose',
    '-p',
    env.COMPOSE_PROJECT_NAME || 'ortus',
    '-f',
    COMPOSE_FILE,
    '--env-file',
    envFile,
    ...rest,
  ];
}

const USAGE = `stand.mjs — локальный стенд Ортус (deploy/compose)
  all [--slot <N>] [--force]     одной командой: init (если нет .env) → up → migrate → seed (pnpm run stand)
  init --slot <N> [--force]      .env для слота N (0…${MAX_SLOT}): ortus-s<N>, порты база слота + 100 × N
  up [--profile <p> ...] [svc]   проверка портов (код 3, если заняты) и docker compose up -d --wait
                                 (профили: test, keycloak, init)
  down [-v]                      остановить (-v — удалить тома)
  ps | config | logs [svc]       состояние, итоговая конфигурация, логи
  bucket                         создать бакет S3_BUCKET (одноразовый minio-init)
  migrate [args]                 go -C backend run ./cmd/migrate (по умолчанию: all up)
  seed [args]                    go -C backend run ./cmd/seed
  --env <путь>                   по умолчанию .env в корне репозитория`;

function fail(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}

function loadEnv(envFile) {
  if (!existsSync(envFile)) {
    fail(
      2,
      `нет файла ${envFile}. Создайте его: node deploy/compose/stand.mjs init --slot <N> (слот 0 — общий стенд интегратора)`,
    );
  }
  return parseEnv(readFileSync(envFile, 'utf8'));
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  if (r.error) fail(4, `${cmd}: ${r.error.message}`);
  return r.status ?? 1;
}

const projectOf = (slot) => (slot === 0 ? 'ortus' : `ortus-s${slot}`);

function writeSlotEnv(envFile, slot) {
  const example = readFileSync(join(HERE, '.env.example'), 'utf8');
  writeFileSync(envFile, renderEnv(example, slot), { encoding: 'utf8' });
  process.stdout.write(`${envFile}: слот ${slot}, проект ${projectOf(slot)}\n`);
}

function parseSlot(raw, where) {
  const slot = Number(raw);
  try {
    checkSlot(slot);
  } catch (e) {
    fail(2, `${where}: ${e.message}`);
  }
  return slot;
}

function init(args, envFile) {
  const slot = parseSlot(takeFlag(args, '--slot'), 'init');
  const force = args.includes('--force');
  if (existsSync(envFile) && !force) fail(2, `init: ${envFile} уже есть; перезаписать — --force`);
  writeSlotEnv(envFile, slot);
  return 0;
}

/** Проверка портов перед `up`: занятые чужими процессами → код 3 до docker compose up. */
async function checkPorts(env, envFile, profiles, services) {
  const ps = spawnSync(
    'docker',
    composeArgs(env, envFile, ['--profile', '*', 'ps', '--format', 'json']),
    { cwd: ROOT, encoding: 'utf8' },
  );
  let own = new Set();
  try {
    if (ps.status === 0) own = ownPorts(ps.stdout ?? '');
  } catch {
    own = new Set();
  }
  const busy = [];
  for (const p of plannedPorts(env, servicesFor(profiles, services))) {
    if (own.has(p.port)) continue;
    if (!(await probePort(p.port))) busy.push(p);
  }
  if (busy.length) fail(3, busyPortsMessage(env.COMPOSE_PROJECT_NAME || 'ortus', busy));
}

async function up(args, envFile) {
  const env = loadEnv(envFile);
  const profiles = [];
  for (let p = takeFlag(args, '--profile'); p; p = takeFlag(args, '--profile')) profiles.push(p);
  const services = args.filter((a) => !a.startsWith('-'));
  await checkPorts(env, envFile, profiles, services);
  return run(
    'docker',
    composeArgs(env, envFile, [
      ...profiles.flatMap((p) => ['--profile', p]),
      'up',
      '-d',
      '--wait',
      ...args,
    ]),
  );
}

/** П-5: стенд одной командой — init (если нужно) → проверка портов → up → migrate → seed. */
async function all(args, envFile) {
  const rawSlot = takeFlag(args, '--slot') ?? (process.env.ORTUS_SLOT || undefined);
  const force = args.includes('--force');
  const slot = rawSlot === undefined ? undefined : parseSlot(rawSlot, 'stand');
  if (!existsSync(envFile) || force) {
    if (slot === undefined) {
      fail(
        2,
        `stand: нет ${envFile} и не задан слот. Запуск: corepack pnpm run stand -- --slot <N> (или ORTUS_SLOT=<N>; 0 — общий стенд интегратора)`,
      );
    }
    writeSlotEnv(envFile, slot);
  } else if (slot !== undefined) {
    const have = parseEnv(readFileSync(envFile, 'utf8')).COMPOSE_PROJECT_NAME;
    if (have !== projectOf(slot)) {
      fail(
        2,
        `stand: ${envFile} — проект ${have}, а запрошен слот ${slot} (${projectOf(slot)}); перезаписать — --force`,
      );
    }
  }
  const env = loadEnv(envFile);
  const steps = [
    ['up', () => up([], envFile)],
    ['migrate', () => run('go', ['-C', 'backend', 'run', './cmd/migrate', 'all', 'up'], env)],
    ['seed', () => run('go', ['-C', 'backend', 'run', './cmd/seed'], env)],
  ];
  for (const [name, step] of steps) {
    process.stdout.write(`stand: ${name} (${env.COMPOSE_PROJECT_NAME})\n`);
    const code = await step();
    if (code !== 0) {
      process.stderr.write(`stand: шаг ${name} завершился с кодом ${code}\n`);
      return code;
    }
  }
  process.stdout.write(
    `stand: готов (${env.COMPOSE_PROJECT_NAME}); остановить с удалением томов — corepack pnpm run stand:down\n`,
  );
  return 0;
}

async function main(argv) {
  const args = [...argv];
  const envFile = resolve(takeFlag(args, '--env') ?? join(ROOT, '.env'));
  const cmd = args.shift();
  switch (cmd) {
    case 'init':
      return init(args, envFile);
    case 'up':
      return up(args, envFile);
    case 'all':
      return all(args, envFile);
    case 'down':
      return run(
        'docker',
        composeArgs(loadEnv(envFile), envFile, ['--profile', '*', 'down', ...args]),
      );
    case 'ps':
    case 'config':
    case 'logs':
      return run('docker', composeArgs(loadEnv(envFile), envFile, [cmd, ...args]));
    case 'bucket':
      return run(
        'docker',
        composeArgs(loadEnv(envFile), envFile, ['--profile', 'init', 'run', '--rm', 'minio-init']),
      );
    case 'migrate': {
      const env = loadEnv(envFile);
      return run(
        'go',
        ['-C', 'backend', 'run', './cmd/migrate', ...(args.length ? args : ['all', 'up'])],
        env,
      );
    }
    case 'seed':
      return run('go', ['-C', 'backend', 'run', './cmd/seed', ...args], loadEnv(envFile));
    default:
      process.stderr.write(`${USAGE}\n`);
      return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
