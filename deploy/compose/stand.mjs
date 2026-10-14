#!/usr/bin/env node
// W0.06 · CLI стенда compose. Без зависимостей: Node 22, docker compose v2, go.
//
//   node deploy/compose/stand.mjs init --slot <N> [--force]   .env для слота N (UTF-8 без BOM)
//   node deploy/compose/stand.mjs up [--profile test|keycloak|init ...]
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

/** Порты приложения на слоте 0 (скелет) и у агента слота N (план §3.6). */
const APP_PORTS = { vite: { base: 5173, slot: 5200 }, api: { base: 8080, slot: 8100 } };

const MAX_SLOT = 10;

function checkSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    throw new RangeError(`slot должен быть целым 0…${MAX_SLOT}, получено ${slot}`);
  }
}

/** Порты стенда для слота. */
export function portsForSlot(slot) {
  checkSlot(slot);
  return Object.fromEntries(Object.entries(PORTS).map(([k, base]) => [k, base + 100 * slot]));
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
  if (key in PORTS) return String(PORTS[key] + 100 * slot);
  if (key === 'HTTP_ADDR') return `127.0.0.1:${APP_PORTS.api.slot + slot}`;
  const shift = new Map(Object.values(PORTS).map((p) => [p, p + 100 * slot]));
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
  init --slot <N> [--force]      .env для слота N: ortus-s<N>, порты + 100 × N
  up [--profile <p> ...]         docker compose up -d --wait (профили: test, keycloak, init)
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

function init(args, envFile) {
  const slot = Number(takeFlag(args, '--slot'));
  const force = args.includes('--force');
  try {
    checkSlot(slot);
  } catch (e) {
    fail(2, `init: ${e.message}`);
  }
  if (existsSync(envFile) && !force) fail(2, `init: ${envFile} уже есть; перезаписать — --force`);
  const example = readFileSync(join(HERE, '.env.example'), 'utf8');
  writeFileSync(envFile, renderEnv(example, slot), { encoding: 'utf8' });
  process.stdout.write(
    `${envFile}: слот ${slot}, проект ${slot === 0 ? 'ortus' : `ortus-s${slot}`}\n`,
  );
  return 0;
}

function main(argv) {
  const args = [...argv];
  const envFile = resolve(takeFlag(args, '--env') ?? join(ROOT, '.env'));
  const cmd = args.shift();
  switch (cmd) {
    case 'init':
      return init(args, envFile);
    case 'up': {
      const env = loadEnv(envFile);
      const profiles = [];
      for (let p = takeFlag(args, '--profile'); p; p = takeFlag(args, '--profile'))
        profiles.push('--profile', p);
      return run('docker', composeArgs(env, envFile, [...profiles, 'up', '-d', '--wait', ...args]));
    }
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
  process.exit(main(process.argv.slice(2)));
}
