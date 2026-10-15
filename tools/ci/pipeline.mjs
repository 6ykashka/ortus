#!/usr/bin/env node
// W0.04 · Конвейер CI — единственный источник шагов для .github/workflows/ci.yml и для
// локального `corepack pnpm run ci:local` (Windows без make и bash).
//
// Порядок job — design/docs/14-engineering.md «Конвейер CI» без деплоя:
//   lint → contract → unit → integration → isolation → build → e2e; build → e2e-stand (W0.17)
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

function dockerGuard(ctx) {
  if (ctx.hasDocker()) return null;
  return ctx.ci ? { fail: 'нет Docker на раннере CI' } : { skip: 'нет Docker' };
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
            ? { cmds: [ctx.pnpm('run', 'allowlist-lint')] }
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
        plan: (ctx) =>
          ctx.goTagged('integration')
            ? { cmds: [go('test', '-tags', 'integration', '-count=1', './...')] }
            : { skip: 'нет Go-тестов с тегом integration' },
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
            return { cmds: [go('test', '-tags', 'isolation', '-count=1', './test/isolation/...')] };
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
            ? { cmds: [go('test', '-tags', 'concurrency', '-count=1', './test/concurrency/...')] }
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
          const install = ctx.scripts['e2e:install'] ? [ctx.pnpm('run', 'e2e:install')] : [];
          return { cmds: [...install, ctx.pnpm('run', 'e2e')] };
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

function hasDockerCli() {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  });
  return !r.error && r.status === 0;
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
  return {
    root,
    ci,
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
    hasDocker: () => (docker ??= hasDockerCli()),
    snapshot: () => gitSnapshot(root),
    pnpm,
    node: (...a) => [process.execPath, ...a],
  };
}

const WIN_SHELL_BINS = new Set(['corepack', 'pnpm', 'npx']);

/** Запуск команды с выводом в консоль; на Windows .cmd-обёртки — через shell. */
export function makeExec(root) {
  return (argv) => {
    const [cmd, ...args] = argv;
    const shell = process.platform === 'win32' && !isAbsolute(cmd) && WIN_SHELL_BINS.has(cmd);
    const quoted = shell
      ? args.map((a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
      : args;
    const r = spawnSync(cmd, quoted, { cwd: root, stdio: 'inherit', shell });
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
  for (const s of job.steps) {
    const tag = `${job.id}/${s.id}`;
    const p = s.plan(ctx);
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
      for (const argv of p.cmds) {
        log.log(`▶ ${tag}: ${show(argv)}`);
        if (!dryRun) code = exec(argv);
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
