#!/usr/bin/env node
// W0.04 · Конвейер CI — единственный источник шагов для .github/workflows/ci.yml и для
// локального `corepack pnpm run ci:local` (Windows без make и bash).
//
// Порядок job — design/docs/14-engineering.md «Конвейер CI» без деплоя:
//   lint → contract → unit → integration → isolation → build → e2e; build → e2e-stand (W0.17)
// В ci.yml job e2e — матрица шардов e2e-shard и итоговая e2e (W1.53, workflowJobs).
// Шаг, чьей цели ещё нет (OpenAPI — W0.07, миграции — W0.06, gen — W0.09, изоляция — W0.15,
// Playwright — W0.05), пропускается с причиной и владельцем. Владельцу не нужно
// править CI: шаг включается сам, когда появляется файл. Исключение — изоляция: как только в
// репозитории есть эндпоинты, отсутствие набора изоляции — ошибка (job блокирующая); и образы: без
// backend/Dockerfile и frontend/apps/web/web.Dockerfile шаг build/images падает (W1.01).
//
// CLI: node tools/ci/pipeline.mjs --job <id> | --all | --list  [--dry-run]
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Закреплённые версии внешних инструментов (менять — через интегратора). */
export const TOOLS = {
  actionlint: 'rhysd/actionlint:1.7.12',
  spectral: '@stoplight/spectral-cli@6.16.3',
  redocly: '@redocly/cli@2.57.0',
};

const SPEC = 'api/openapi/ortus.yaml';
const DECISIONS = 'docs/plan/scripts/renumber-decisions.mjs';
const CHECK_K6 = 'backend/test/load/check-k6.mjs';
const PLAYWRIGHT_CONFIG = 'frontend/apps/web/playwright.config.ts';
const STUB_RE = /stub-target\.mjs/;

const go = (...args) => ['go', '-C', 'backend', ...args];

/** W1.46: число пакетов `go test -p` в job integration; на win32 без env — WIN_GO_TEST_P. */
export const GO_TEST_P_ENV = 'ORTUS_GO_TEST_P';
const WIN_GO_TEST_P = '4';

/**
 * W1.46 (П-10): канал Docker Desktop, который testcontainers находит сам (`client.DefaultDockerHost`). Без
 * DOCKER_HOST он проверяет канал через `os.Stat`, а при параллельном старте пакетов `Stat` получает «All pipe
 * instances are busy» — провайдер падает с «rootless Docker is not supported on Windows». С DOCKER_HOST проверка
 * идёт через `docker info` по каналу с ожиданием свободного экземпляра.
 */
export const WIN_DOCKER_HOST = 'npipe:////./pipe/docker_engine';

/**
 * W1.46 (доделка 16.10): все пакеты одного `go test` — одна сессия testcontainers с общим ryuk. ryuk завершается
 * через RYUK_RECONNECTION_TIMEOUT (по умолчанию 10 с) без соединений, а при `-p 4` на нагруженной машине пауза
 * между пакетами (сборка, линковка) бывает дольше. Пакет, нашедший умирающий ryuk, ждёт его 60 с и падает
 * («wait for reaper …: context deadline exceeded») или теряет защиту своих контейнеров («Reaper handshake failed»).
 *
 * W2.83: то же на раннере ubuntu GitHub — пакеты одного `go test ./...` делят один ryuk, и пакеты `access/groups`,
 * `access/roles`, `data/fleet`, `files` падали «wait for reaper» (прогон 40120489895), поэтому таймаут — на любой
 * платформе. Имя WIN_RYUK_RECONNECTION_TIMEOUT — прежнее (W1.46).
 */
export const RYUK_RECONNECTION_TIMEOUT = '5m';
export const WIN_RYUK_RECONNECTION_TIMEOUT = RYUK_RECONNECTION_TIMEOUT;
const RYUK_TIMEOUT_ENVS = ['RYUK_RECONNECTION_TIMEOUT', 'TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT'];

/**
 * Окружение Go-тестов с Docker, если оно не задано: таймаут ryuk — на любой платформе (W2.83), канал Docker Desktop
 * — только на win32.
 */
function dockerEnv(ctx) {
  const env = {};
  if (ctx.platform === 'win32' && !ctx.env?.DOCKER_HOST) env.DOCKER_HOST = WIN_DOCKER_HOST;
  if (!RYUK_TIMEOUT_ENVS.some((k) => ctx.env?.[k])) {
    env.RYUK_RECONNECTION_TIMEOUT = RYUK_RECONNECTION_TIMEOUT;
  }
  return Object.keys(env).length ? env : undefined;
}

/** `-p` job integration: env ORTUS_GO_TEST_P, иначе 4 на win32; { fail } при неверном значении. */
function goTestP(ctx) {
  const raw = ctx.env?.[GO_TEST_P_ENV];
  if (raw === undefined || raw === '') {
    return ctx.platform === 'win32' ? { args: ['-p', WIN_GO_TEST_P] } : { args: [] };
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    return { fail: `${GO_TEST_P_ENV}=${JSON.stringify(raw)}: нужно целое число ≥ 1` };
  }
  return { args: ['-p', raw] };
}

/** План Go-шага с Docker: команды и, если нужно, окружение. */
const withDockerEnv = (ctx, cmds) => {
  const env = dockerEnv(ctx);
  return env ? { cmds, env } : { cmds };
};

/**
 * W1.46: зависший Docker — не «нет Docker»: пропуск скрыл бы, что шаг не проверен, поэтому fail с причиной. В
 * --dry-run команды не запускаются, проверять нечего — пропуск с той же причиной (возврат 16.10 №1).
 */
function hungDocker(ctx) {
  const hung = ctx.dockerHung?.();
  if (!hung) return null;
  return ctx.dryRun ? { skip: `${hung} (--dry-run)` } : { fail: hung };
}

function dockerGuard(ctx) {
  if (ctx.hasDocker()) return null;
  return (
    hungDocker(ctx) ?? (ctx.ci ? { fail: 'нет Docker на раннере CI' } : { skip: 'нет Docker' })
  );
}

/**
 * План Go-шага с Docker: при зависшем Docker `go test` не запускается (иначе он висит или падает по таймаутам
 * testcontainers без понятной причины). Отсутствующий Docker, как и раньше, решают сами тесты.
 */
const goDockerStep = (ctx, cmds) => hungDocker(ctx) ?? withDockerEnv(ctx, cmds);

/**
 * W1.53 (П-16): шард Playwright job e2e — env `E2E_SHARD=<i>/<N>`, аргумент `--shard=<i>/<N>` команды
 * `pnpm run e2e`. Без env (локальный `ci:local`) — весь набор.
 */
export const E2E_SHARD_ENV = 'E2E_SHARD';

/**
 * W1.53: число шардов матрицы `e2e-shard` в ci.yml (workflow.test.mjs сверяет). Один воркер в CI (e2e-kit) —
 * ≈ 2,4–2,9 с на строку; 1122 строки этапа 1 / 6 ≈ 10–11,5 мин шарда с накладными, после этапа 2 — до 13,5.
 */
export const E2E_SHARDS = 20;

/**
 * W4.86: после этапа 4 набор mock — 3835 строк в 121 spec; один воркер в CI даёт ≈ 13,6 строки/мин (run 40181927311:
 * 272 строки за 20 мин). 20 шардов ≈ 192 строки ≈ 14 мин + установка ≈ 17 мин при лимите job 25 мин.
 */

/**
 * W4.86: число шардов матрицы `e2e-stand-shard` (каждый — свой compose, cmd/api и cmd/worker на раннере). Набор @stand —
 * 372 строки: в CI один воркер прошёл 185 за 40 мин (≈ 4,6 строки/мин), локально весь набор идёт 94 мин. 8 шардов ≈ 47
 * строк ≈ 10 мин + подъём стенда ≈ 6 мин при лимите job 30 мин.
 */
export const E2E_STAND_SHARDS = 8;

/** Текущий этап плана для сроков `expires: stage-N` в allowlist-lint (env ORTUS_STAGE важнее). */
export const CURRENT_STAGE = 4;

/** `E2E_SHARD`: пусто → весь набор; `<i>/<N>` (1 ≤ i ≤ N, без ведущих нулей) → `--shard`; иначе { fail }. */
export function parseShard(raw) {
  if (raw === undefined || raw === '') return { args: [] };
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(raw);
  if (!m || Number(m[1]) > Number(m[2])) {
    return { fail: `${E2E_SHARD_ENV}=${JSON.stringify(raw)}: нужно «<i>/<N>», 1 ≤ i ≤ N` };
  }
  return { args: [`--shard=${raw}`] };
}

/**
 * W1.53: раскладка job ci.yml по JOBS. Job e2e идёт матрицей `e2e-shard` (E2E_SHARDS шардов), а итоговая job
 * с прежним id и именем `e2e` (gate) только сводит результат матрицы: имя обязательной проверки не меняется.
 */
export function workflowJobs(jobs = JOBS) {
  return jobs.flatMap((j) => {
    if (j.id === 'e2e') {
      return [
        { id: 'e2e-shard', needs: j.needs, pipelineJob: j.id, shards: E2E_SHARDS },
        { id: 'e2e', needs: ['e2e-shard'], gate: 'e2e-shard' },
      ];
    }
    if (j.id === 'e2e-stand') {
      return [
        { id: 'e2e-stand-shard', needs: j.needs, pipelineJob: j.id, shards: E2E_STAND_SHARDS },
        { id: 'e2e-stand', needs: ['e2e-stand-shard'], gate: 'e2e-stand-shard' },
      ];
    }
    return [{ id: j.id, needs: j.needs, pipelineJob: j.id }];
  });
}

/** Обязательные образы (W1.01): Dockerfile → имя образа. Контекст сборки — корень репозитория. */
export const REQUIRED_IMAGES = {
  'backend/Dockerfile': 'ortus-backend',
  'frontend/apps/web/web.Dockerfile': 'ortus-web',
};

/** Имя образа: «web.Dockerfile» → web, «backend/Dockerfile» → backend. */
const imageName = (file) => {
  const base = basename(file);
  return base === 'Dockerfile' ? basename(dirname(file)) : base.replace(/\.Dockerfile$/, '');
};

/** Дрейф codegen: файлы, изменённые или созданные `gen` относительно состояния до него. */
function codegenDrift(ctx) {
  return (exec, log) => {
    const before = ctx.snapshot();
    const code = exec(ctx.pnpm('run', 'gen'));
    if (code !== 0) return code;
    const after = ctx.snapshot();
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((p) => before.get(p) !== after.get(p))
      .sort();
    if (changed.length === 0) return 0;
    log.error(
      'дрейф codegen: `pnpm run gen` изменил файлы — выполните его и закоммитьте результат:',
    );
    for (const p of changed) log.error(`  ${p}`);
    return 1;
  };
}

export const JOBS = [
  {
    id: 'lint',
    needs: [],
    steps: [
      {
        id: 'lint',
        owner: 'W0.03',
        plan: (ctx) => ({ cmds: [ctx.pnpm('run', 'lint')] }),
      },
      {
        id: 'actionlint',
        owner: 'W0.04',
        plan: (ctx) => {
          if (!ctx.exists('.github/workflows')) return { skip: 'нет .github/workflows' };
          return (
            dockerGuard(ctx) ?? {
              cmds: [
                [
                  'docker',
                  'run',
                  '--rm',
                  '-v',
                  `${ctx.root}:/repo`,
                  '-w',
                  '/repo',
                  TOOLS.actionlint,
                  '-color',
                ],
              ],
            }
          );
        },
      },
      {
        id: 'spectral',
        owner: 'W0.07',
        plan: (ctx) => {
          if (!ctx.exists(SPEC)) return { skip: `нет ${SPEC}` };
          if (ctx.scripts['lint:api']) return { cmds: [ctx.pnpm('run', 'lint:api')] };
          const ruleset = ctx.exists('api/spectral.yaml')
            ? 'api/spectral.yaml'
            : 'tools/ci/spectral.default.yaml';
          return {
            cmds: [
              ctx.pnpm(
                `--package=${TOOLS.spectral}`,
                'dlx',
                'spectral',
                'lint',
                SPEC,
                '--ruleset',
                ruleset,
                '--fail-severity',
                'error',
              ),
            ],
          };
        },
      },
    ],
  },
  {
    id: 'contract',
    needs: ['lint'],
    steps: [
      {
        id: 'openapi-validate',
        owner: 'W0.07',
        plan: (ctx) => {
          if (!ctx.exists(SPEC)) return { skip: `нет ${SPEC}` };
          if (ctx.scripts['validate:api']) return { cmds: [ctx.pnpm('run', 'validate:api')] };
          return {
            cmds: [
              ctx.pnpm(
                `--package=${TOOLS.redocly}`,
                'dlx',
                'redocly',
                'lint',
                SPEC,
                '--extends',
                'minimal',
              ),
            ],
          };
        },
      },
      {
        id: 'permissions',
        owner: 'W0.07',
        plan: (ctx) =>
          ctx.exists('api/openapi')
            ? { cmds: [ctx.node('tools/ci/check-permissions.mjs')] }
            : { skip: 'нет api/openapi' },
      },
      {
        id: 'migrations',
        owner: 'W0.06, стюард',
        plan: (ctx) =>
          ctx.exists('backend/migrations')
            ? { cmds: [ctx.node('tools/ci/check-migrations.mjs')] }
            : { skip: 'нет backend/migrations' },
      },
      {
        id: 'codegen-drift',
        owner: 'W0.09',
        plan: (ctx) => {
          const gen = ctx.scripts.gen;
          if (!gen) return { skip: 'нет скрипта gen' };
          if (STUB_RE.test(gen)) return { skip: 'скрипт gen — заглушка' };
          return { fn: codegenDrift(ctx) };
        },
      },
    ],
  },
  {
    id: 'unit',
    needs: ['contract'],
    steps: [
      {
        id: 'check-icu',
        owner: 'W0.04',
        plan: (ctx) => ({ cmds: [ctx.node('tools/ci/check-icu.mjs')] }),
      },
      {
        id: 'typecheck',
        owner: 'пакеты',
        plan: (ctx) => ({ cmds: [ctx.pnpm('run', 'typecheck')] }),
      },
      { id: 'test', owner: 'все WS', plan: (ctx) => ({ cmds: [ctx.pnpm('run', 'test')] }) },
      {
        id: 'check-decisions',
        owner: 'W0.00, W0.17',
        plan: (ctx) =>
          ctx.exists(DECISIONS) && ctx.scripts['check-decisions']
            ? { cmds: [ctx.pnpm('run', 'check-decisions')] }
            : { skip: `нет ${DECISIONS} или скрипта check-decisions` },
      },
      {
        id: 'allowlist-lint',
        owner: 'W0.05',
        plan: (ctx) =>
          ctx.scripts['allowlist-lint']
            ? {
                cmds: [ctx.pnpm('run', 'allowlist-lint')],
                // W4.86: без этапа allowlist-lint считал этап 0 и не проверял сроки expires.
                env: { ORTUS_STAGE: ctx.env?.ORTUS_STAGE || String(CURRENT_STAGE) },
              }
            : { skip: 'нет скрипта allowlist-lint' },
      },
      {
        // Без --url: initialize + tools/list сервера из .mcp.json, без сети и браузера.
        id: 'mcp-check',
        owner: 'W0.05',
        plan: (ctx) =>
          ctx.scripts['mcp:check'] && ctx.exists('.mcp.json')
            ? { cmds: [ctx.pnpm('run', 'mcp:check')] }
            : { skip: 'нет скрипта mcp:check или .mcp.json' },
      },
    ],
  },
  {
    id: 'integration',
    needs: ['unit'],
    steps: [
      {
        id: 'go-integration',
        owner: 'W0.06, W0.09, модули Б',
        // W1.46: на win32 — -p 4 (ORTUS_GO_TEST_P) и DOCKER_HOST; таймаут ryuk — везде (W2.83), см. dockerEnv.
        plan: (ctx) => {
          if (!ctx.goTagged('integration')) return { skip: 'нет Go-тестов с тегом integration' };
          const p = goTestP(ctx);
          if (p.fail) return { fail: p.fail };
          return goDockerStep(ctx, [
            go('test', '-tags', 'integration', '-count=1', ...p.args, './...'),
          ]);
        },
      },
    ],
  },
  {
    id: 'isolation',
    needs: ['integration'],
    steps: [
      {
        id: 'go-isolation',
        owner: 'W0.15',
        plan: (ctx) => {
          if (ctx.hasGo('backend/test/isolation')) {
            return goDockerStep(ctx, [
              go('test', '-tags', 'isolation', '-count=1', './test/isolation/...'),
            ]);
          }
          const endpoints = ['backend/internal/api', 'backend/cmd/api'].filter((d) => ctx.hasGo(d));
          if (endpoints.length) {
            return {
              fail:
                `есть эндпоинты (${endpoints.join(', ')}), а набора изоляции backend/test/isolation нет — ` +
                'job изоляции блокирующая с первого эндпоинта (план v2 §4 W0.04, правило 3 плана 27)',
            };
          }
          return { skip: 'нет backend/test/isolation и эндпоинтов' };
        },
      },
      {
        id: 'go-concurrency',
        owner: 'W2.30 (дорожка Т)',
        plan: (ctx) =>
          ctx.hasGo('backend/test/concurrency')
            ? goDockerStep(ctx, [
                go('test', '-tags', 'concurrency', '-count=1', './test/concurrency/...'),
              ])
            : { skip: 'нет backend/test/concurrency' },
      },
    ],
  },
  {
    id: 'build',
    needs: ['isolation'],
    steps: [
      { id: 'build', owner: 'пакеты', plan: (ctx) => ({ cmds: [ctx.pnpm('run', 'build')] }) },
      {
        id: 'storybook',
        owner: 'W0.10',
        plan: (ctx) =>
          ctx.scripts['storybook:build']
            ? { cmds: [ctx.pnpm('run', 'storybook:build')] }
            : { skip: 'нет скрипта storybook:build' },
      },
      {
        id: 'check-k6',
        owner: 'W0.16',
        plan: (ctx) => {
          if (!ctx.exists(CHECK_K6) || !ctx.scripts['check-k6'])
            return { skip: `нет ${CHECK_K6} или скрипта check-k6` };
          return dockerGuard(ctx) ?? { cmds: [ctx.pnpm('run', 'check-k6')] };
        },
      },
      {
        // W1.01 (S0-02, критика П-3, Q-W0.04-4): образы ortus-backend и ortus-web обязательны — без
        // Dockerfile шаг падает, а не пропускается. Остальные Dockerfile из backend/, frontend/apps/, deploy/
        // собираются тоже.
        id: 'images',
        owner: 'W1.01',
        plan: (ctx) => {
          const files = ctx.dockerfiles();
          const missing = Object.keys(REQUIRED_IMAGES).filter((f) => !files.includes(f));
          if (missing.length) {
            return {
              fail: `нет ${missing.join(', ')} — образы ${Object.values(REQUIRED_IMAGES).join(', ')} обязательны`,
            };
          }
          return (
            dockerGuard(ctx) ?? {
              cmds: files.map((f) => [
                'docker',
                'build',
                '-f',
                f,
                '-t',
                `ortus-${imageName(f)}:ci`,
                '.',
              ]),
            }
          );
        },
      },
    ],
  },
  {
    id: 'e2e',
    needs: ['build'],
    steps: [
      {
        id: 'e2e',
        owner: 'W0.05',
        plan: (ctx) => {
          if (!ctx.exists('frontend/apps/web/playwright.config.ts')) {
            return { skip: 'нет frontend/apps/web/playwright.config.ts' };
          }
          if (!ctx.scripts.e2e) return { skip: 'нет скрипта e2e в package.json' };
          // W1.53: шард из env E2E_SHARD (матрица e2e-shard в CI); pnpm 9 передаёт аргумент до playwright test.
          const shard = parseShard(ctx.env?.[E2E_SHARD_ENV]);
          if (shard.fail) return { fail: shard.fail };
          const install = ctx.scripts['e2e:install'] ? [ctx.pnpm('run', 'e2e:install')] : [];
          return { cmds: [...install, ctx.pnpm('run', 'e2e', ...shard.args)] };
        },
      },
    ],
  },
  {
    // W0.17 (П-1): браузерный путь /me/context сквозь стек — compose, migrate, seed, cmd/api, @stand.
    id: 'e2e-stand',
    needs: ['build'],
    steps: [
      {
        id: 'e2e-stand',
        owner: 'W0.17',
        plan: (ctx) => {
          if (!ctx.exists(PLAYWRIGHT_CONFIG)) return { skip: `нет ${PLAYWRIGHT_CONFIG}` };
          if (!ctx.scripts['e2e:stand']) return { skip: 'нет скрипта e2e:stand в package.json' };
          const guard = dockerGuard(ctx);
          if (guard) return guard;
          if (!ctx.ci && !ctx.slot) {
            return {
              skip:
                'ORTUS_SLOT не задан: локально стенд поднимается на слоте исполнителя (1…20), ' +
                'слот 0 — общий стенд интегратора',
            };
          }
          // W4.86: шард — env E2E_SHARD=<i>/<N>; e2e-stand.mjs читает его сам и передаёт --shard Playwright.
          const shard = parseShard(ctx.env?.[E2E_SHARD_ENV]);
          if (shard.fail) return { fail: shard.fail };
          const install = ctx.scripts['e2e:install'] ? [ctx.pnpm('run', 'e2e:install')] : [];
          return { cmds: [...install, ctx.pnpm('run', 'e2e:stand')] };
        },
      },
    ],
  },
];

// Только служебные каталоги: Go-пакет вполне может называться build или dist.
const IGNORED_DIRS = new Set(['node_modules', '.git']);

function walk(dir, visit) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) walk(join(dir, e.name), visit);
    } else {
      visit(join(dir, e.name), e.name);
    }
  }
}

/** W1.46 (доделка 16.10): сколько ждать `docker version`; зависший Docker Desktop не отвечает вовсе. */
export const DOCKER_PROBE_TIMEOUT_MS = 60_000;

/**
 * W1.46 (возврат 16.10 №2): таймаут проверки Docker из `ORTUS_DOCKER_PROBE_TIMEOUT_MS` (целое число мс > 0), иначе
 * DOCKER_PROBE_TIMEOUT_MS. Сокращает ожидание `test` и pre-push, когда Docker завис.
 */
export function dockerProbeTimeoutMs(env = process.env) {
  const raw = env.ORTUS_DOCKER_PROBE_TIMEOUT_MS ?? '';
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : DOCKER_PROBE_TIMEOUT_MS;
}

/** Проверка Docker: { ok } или { ok: false, hung } — `docker version` не ответил за timeoutMs. */
export function probeDocker(spawn = spawnSync, timeoutMs = DOCKER_PROBE_TIMEOUT_MS) {
  const r = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  if (r.error?.code === 'ETIMEDOUT') {
    return {
      ok: false,
      hung: `docker version не ответил за ${timeoutMs / 1000} с — Docker завис`,
    };
  }
  return r.error || r.status !== 0 ? { ok: false } : { ok: true };
}

/** Снимок рабочего дерева: путь → sha1 содержимого для изменённых и новых файлов. */
function gitSnapshot(root) {
  const r = spawnSync(
    'git',
    ['-c', 'core.quotepath=off', 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) throw new Error(`git status: ${r.stderr}`);
  const entries = r.stdout.split('\0').filter(Boolean);
  const snap = new Map();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const path = e.slice(3);
    if (e[0] === 'R' || e[0] === 'C') i++; // за переименованием следует исходный путь
    const abs = join(root, path);
    snap.set(
      path,
      existsSync(abs) ? createHash('sha1').update(readFileSync(abs)).digest('hex') : 'deleted',
    );
  }
  return snap;
}

/** Реальный контекст: файлы репозитория, скрипты package.json, Docker, способ вызвать pnpm. */
export function makeContext(root = ROOT, env = process.env) {
  const rel = (p) => relative(root, p).split(sep).join('/');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const ci = env.CI === 'true';
  const execpath = env.npm_execpath ?? '';
  let pnpm;
  if (/pnpm\.c?js$/.test(execpath)) pnpm = (...a) => [process.execPath, execpath, ...a];
  else if (ci) pnpm = (...a) => ['pnpm', ...a];
  else pnpm = (...a) => ['corepack', 'pnpm', ...a];

  let docker;
  const dockerProbe = dockerProbeTimeoutMs(env);
  return {
    root,
    ci,
    platform: process.platform,
    env,
    slot: env.ORTUS_SLOT || undefined,
    scripts: pkg.scripts ?? {},
    exists: (p) => existsSync(join(root, p)),
    hasGo: (dir) => {
      let found = false;
      walk(join(root, dir), (_, name) => (found ||= name.endsWith('.go')));
      return found;
    },
    goTagged: (tag) => {
      const re = new RegExp(`^//go:build\\s+.*\\b${tag}\\b`, 'm');
      let found = false;
      walk(join(root, 'backend'), (p, name) => {
        if (!found && name.endsWith('.go')) found = re.test(readFileSync(p, 'utf8'));
      });
      return found;
    },
    dockerfiles: () => {
      const out = [];
      for (const d of ['backend', 'frontend/apps', 'deploy']) {
        walk(join(root, d), (p, name) => {
          if (name === 'Dockerfile' || name.endsWith('.Dockerfile')) out.push(rel(p));
        });
      }
      return out.sort();
    },
    dockerProbeTimeoutMs: dockerProbe,
    hasDocker: () => (docker ??= probeDocker(spawnSync, dockerProbe)).ok,
    dockerHung: () => (docker ??= probeDocker(spawnSync, dockerProbe)).hung,
    snapshot: () => gitSnapshot(root),
    pnpm,
    node: (...a) => [process.execPath, ...a],
  };
}

const WIN_SHELL_BINS = new Set(['corepack', 'pnpm', 'npx']);

/**
 * Запуск команды с выводом в консоль; на Windows .cmd-обёртки — через shell. env шага (W1.46) добавляется к
 * окружению процесса.
 */
export function makeExec(root) {
  return (argv, env) => {
    const [cmd, ...args] = argv;
    const shell = process.platform === 'win32' && !isAbsolute(cmd) && WIN_SHELL_BINS.has(cmd);
    const quoted = shell
      ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
      : args;
    const r = spawnSync(cmd, quoted, {
      cwd: root,
      stdio: 'inherit',
      shell,
      env: env ? { ...process.env, ...env } : process.env,
    });
    if (r.error) {
      console.error(`${cmd}: ${r.error.message}`);
      return 127;
    }
    return r.status ?? 1;
  };
}

const show = (argv) =>
  (/pnpm\.c?js$/.test(argv[1] ?? '') ? ['pnpm', ...argv.slice(2)] : argv)
    .map((a, i) =>
      i < 2 && isAbsolute(a) && /(node(\.exe)?|\.c?js)$/i.test(a)
        ? basename(a).replace(/\.exe$/i, '')
        : a,
    )
    .join(' ');

/** Выполняет шаги одной job; упавший шаг не останавливает остальные. */
export function runJob(job, ctx, exec, log = console, { dryRun = false } = {}) {
  const results = [];
  // Возврат 16.10 №1: план знает о --dry-run (зависший Docker — пропуск, а не ошибка).
  const planCtx = dryRun ? { ...ctx, dryRun: true } : ctx;
  for (const s of job.steps) {
    const tag = `${job.id}/${s.id}`;
    const p = s.plan(planCtx);
    if (p.skip) {
      log.log(`⏭ ${tag}: пропуск: ${p.skip} (владелец ${s.owner})`);
      results.push({ step: s.id, status: 'skip', reason: p.skip });
      continue;
    }
    if (p.fail) {
      log.error(`✖ ${tag}: ${p.fail}`);
      results.push({ step: s.id, status: 'fail', reason: p.fail });
      continue;
    }
    let code = 0;
    if (p.fn) {
      log.log(`▶ ${tag}: (проверка скриптом pipeline.mjs)`);
      if (!dryRun) code = p.fn(exec, log);
    } else {
      const env = p.env
        ? ` (env ${Object.entries(p.env)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')})`
        : '';
      for (const argv of p.cmds) {
        log.log(`▶ ${tag}: ${show(argv)}${env}`);
        if (!dryRun) code = p.env ? exec(argv, p.env) : exec(argv);
        if (code !== 0) break;
      }
    }
    if (code === 0) {
      if (!dryRun) log.log(`✔ ${tag}`);
      results.push({ step: s.id, status: 'ok' });
    } else {
      log.error(`✖ ${tag}: код ${code}`);
      results.push({ step: s.id, status: 'fail', reason: `код ${code}` });
    }
  }
  const failed = results.filter((r) => r.status === 'fail').map((r) => r.step);
  log.log(`■ ${job.id}: ${failed.length ? `упала (${failed.join(', ')})` : 'ок'}`);
  return { code: failed.length ? 1 : 0, results };
}

/** Все job по порядку needs; первая упавшая останавливает конвейер (как needs в Actions). */
export function runAll(ctx, exec, log = console, jobs = JOBS, opts = {}) {
  for (const job of jobs) {
    const r = runJob(job, ctx, exec, log, opts);
    if (r.code !== 0) {
      log.error(`конвейер остановлен на job «${job.id}»`);
      return r.code;
    }
  }
  log.log(
    opts.dryRun
      ? 'конвейер (--dry-run): охрана вычислена, команды не запускались'
      : 'конвейер: все job зелёные',
  );
  return 0;
}

const USAGE = 'usage: node tools/ci/pipeline.mjs --job <id> | --all | --list  [--dry-run]';

export function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  if (argv.includes('--list')) {
    for (const j of JOBS) {
      console.log(`${j.id}${j.needs.length ? ` (needs: ${j.needs.join(', ')})` : ''}`);
      for (const s of j.steps) console.log(`  ${s.id} — ${s.owner}`);
    }
    return 0;
  }
  const ctx = makeContext(resolve(ROOT));
  const exec = makeExec(ctx.root);
  if (argv.includes('--all')) return runAll(ctx, exec, console, JOBS, { dryRun });
  const i = argv.indexOf('--job');
  if (i >= 0) {
    const id = argv[i + 1];
    const job = JOBS.find((j) => j.id === id);
    if (!job) {
      console.error(`неизвестная job «${id}»; есть: ${JOBS.map((j) => j.id).join(', ')}`);
      return 2;
    }
    return runJob(job, ctx, exec, console, { dryRun }).code;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main();
}
