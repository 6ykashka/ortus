// W0.04 · Конвейер CI (design/docs/14-engineering.md «Конвейер CI»): job, порядок, охрана шагов.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { importIfExists, runNode } from './_util.mjs';

const SCRIPT = 'tools/ci/pipeline.mjs';
const mod = await importIfExists(SCRIPT);

function need() {
  assert.ok(mod, `${SCRIPT} ещё не существует`);
  return mod;
}

const STUB_SCRIPTS = {
  lint: 'pnpm run format:check && pnpm run lint:js && pnpm run lint:go',
  test: 'pnpm run test:repo',
  gen: 'node tools/repo/stub-target.mjs gen W0.09',
};

/** Контекст «пустого main после W0.03»: ни одного целевого каталога чужих WS. */
function fakeCtx(over = {}) {
  return {
    root: '/repo',
    ci: false,
    platform: 'linux',
    env: {},
    scripts: STUB_SCRIPTS,
    exists: () => false,
    hasGo: () => false,
    goTagged: () => false,
    dockerfiles: () => [],
    hasDocker: () => true,
    snapshot: () => new Map(),
    pnpm: (...args) => ['pnpm', ...args],
    node: (...args) => ['node', ...args],
    ...over,
  };
}

const step = (jobId, stepId) => {
  const job = need().JOBS.find((j) => j.id === jobId);
  assert.ok(job, `нет job ${jobId}`);
  const s = job.steps.find((x) => x.id === stepId);
  assert.ok(s, `нет шага ${jobId}/${stepId}`);
  return s;
};

const quiet = { log() {}, error() {} };

describe('JOBS: порядок конвейера', () => {
  it('job по 14-engineering: lint → contract → unit → integration → isolation → build → e2e; e2e-stand после build (W0.17)', () => {
    const { JOBS } = need();
    assert.deepEqual(
      JOBS.map((j) => j.id),
      ['lint', 'contract', 'unit', 'integration', 'isolation', 'build', 'e2e', 'e2e-stand'],
    );
    const chain = JOBS.slice(0, 7);
    chain.forEach((j, i) => assert.deepEqual(j.needs, i === 0 ? [] : [chain[i - 1].id], j.id));
    assert.deepEqual(JOBS[7].needs, ['build']);
  });

  it('у каждого шага есть id и владелец', () => {
    for (const j of need().JOBS) {
      assert.ok(j.steps.length > 0, j.id);
      for (const s of j.steps) {
        assert.match(s.id, /^[a-z0-9-]+$/);
        assert.ok(s.owner, `${j.id}/${s.id} без владельца`);
      }
    }
  });

  it('обязательные шаги на месте', () => {
    for (const [j, s] of [
      ['lint', 'lint'],
      ['lint', 'actionlint'],
      ['lint', 'spectral'],
      ['contract', 'openapi-validate'],
      ['contract', 'permissions'],
      ['contract', 'migrations'],
      ['contract', 'codegen-drift'],
      ['unit', 'check-icu'],
      ['unit', 'typecheck'],
      ['unit', 'test'],
      ['integration', 'go-integration'],
      ['isolation', 'go-isolation'],
      ['isolation', 'go-concurrency'],
      ['build', 'build'],
      ['build', 'images'],
      ['e2e', 'e2e'],
      ['unit', 'check-decisions'],
      ['unit', 'allowlist-lint'],
      ['unit', 'mcp-check'],
      ['build', 'storybook'],
      ['build', 'check-k6'],
      ['e2e-stand', 'e2e-stand'],
    ]) {
      step(j, s);
    }
  });
});

describe('охрана шагов на пустом main', () => {
  const cases = [
    ['lint', 'spectral', /нет api\/openapi\/ortus\.yaml/, 'W0.07'],
    ['contract', 'openapi-validate', /нет api\/openapi\/ortus\.yaml/, 'W0.07'],
    ['contract', 'permissions', /нет api\/openapi/, 'W0.07'],
    ['contract', 'migrations', /нет backend\/migrations/, 'W0.06'],
    ['contract', 'codegen-drift', /gen — заглушка/, 'W0.09'],
    ['integration', 'go-integration', /integration/, 'W0.06'],
    ['isolation', 'go-isolation', /нет backend\/test\/isolation/, 'W0.15'],
    ['isolation', 'go-concurrency', /нет backend\/test\/concurrency/, 'W2.30'],
    ['e2e', 'e2e', /playwright\.config\.ts/, 'W0.05'],
    ['unit', 'check-decisions', /renumber-decisions/, 'W0.00'],
    ['unit', 'allowlist-lint', /allowlist-lint/, 'W0.05'],
    ['unit', 'mcp-check', /mcp:check/, 'W0.05'],
    ['build', 'storybook', /storybook:build/, 'W0.10'],
    ['build', 'check-k6', /check-k6/, 'W0.16'],
    ['e2e-stand', 'e2e-stand', /playwright\.config\.ts/, 'W0.17'],
  ];
  for (const [j, s, reason, owner] of cases) {
    it(`${j}/${s} пропускается с причиной и владельцем ${owner}`, () => {
      const st = step(j, s);
      const p = st.plan(fakeCtx());
      assert.ok(p.skip, `${j}/${s} должен пропускаться, получено ${JSON.stringify(p)}`);
      assert.match(p.skip, reason);
      assert.match(st.owner, new RegExp(owner.replace('.', '\\.')));
    });
  }

  it('неохраняемые шаги выполняются: lint, check-icu, typecheck, test, build', () => {
    assert.deepEqual(step('lint', 'lint').plan(fakeCtx()).cmds, [['pnpm', 'run', 'lint']]);
    assert.deepEqual(step('unit', 'check-icu').plan(fakeCtx()).cmds, [
      ['node', 'tools/ci/check-icu.mjs'],
    ]);
    assert.deepEqual(step('unit', 'typecheck').plan(fakeCtx()).cmds, [
      ['pnpm', 'run', 'typecheck'],
    ]);
    assert.deepEqual(step('unit', 'test').plan(fakeCtx()).cmds, [['pnpm', 'run', 'test']]);
    assert.deepEqual(step('build', 'build').plan(fakeCtx()).cmds, [['pnpm', 'run', 'build']]);
  });
});

describe('шаги включаются, когда появляется цель', () => {
  const has =
    (...paths) =>
    (rel) =>
      paths.includes(rel);

  it('spectral: свой скрипт lint:api важнее; иначе dlx с правилами api/spectral.yaml или умолчанием', () => {
    const st = step('lint', 'spectral');
    const own = st.plan(
      fakeCtx({ exists: has('api/openapi/ortus.yaml'), scripts: { 'lint:api': 'x' } }),
    );
    assert.deepEqual(own.cmds, [['pnpm', 'run', 'lint:api']]);
    const dflt = st.plan(fakeCtx({ exists: has('api/openapi/ortus.yaml') })).cmds[0].join(' ');
    assert.match(
      dflt,
      /--package=@stoplight\/spectral-cli@6\.16\.3 dlx spectral lint api\/openapi\/ortus\.yaml/,
    );
    assert.match(dflt, /--ruleset tools\/ci\/spectral\.default\.yaml/);
    const ruleset = st.plan(
      fakeCtx({ exists: has('api/openapi/ortus.yaml', 'api/spectral.yaml') }),
    );
    assert.match(ruleset.cmds[0].join(' '), /--ruleset api\/spectral\.yaml/);
  });

  it('openapi-validate: redocly с точной версией', () => {
    const p = step('contract', 'openapi-validate').plan(
      fakeCtx({ exists: has('api/openapi/ortus.yaml') }),
    );
    assert.match(
      p.cmds[0].join(' '),
      /--package=@redocly\/cli@2\.57\.0 dlx redocly lint api\/openapi\/ortus\.yaml --extends minimal/,
    );
  });

  it('permissions и migrations вызывают свои скрипты', () => {
    assert.deepEqual(
      step('contract', 'permissions').plan(fakeCtx({ exists: has('api/openapi') })).cmds,
      [['node', 'tools/ci/check-permissions.mjs']],
    );
    assert.deepEqual(
      step('contract', 'migrations').plan(fakeCtx({ exists: has('backend/migrations') })).cmds,
      [['node', 'tools/ci/check-migrations.mjs']],
    );
  });

  it('integration: есть тег integration → go test -tags integration', () => {
    const p = step('integration', 'go-integration').plan(
      fakeCtx({ goTagged: (t) => t === 'integration' }),
    );
    assert.deepEqual(p.cmds, [
      ['go', '-C', 'backend', 'test', '-tags', 'integration', '-count=1', './...'],
    ]);
  });

  it('isolation блокирующий: эндпоинты есть, набора нет → ошибка, а не пропуск', () => {
    const st = step('isolation', 'go-isolation');
    for (const dir of ['backend/internal/api', 'backend/cmd/api']) {
      const p = st.plan(fakeCtx({ hasGo: (rel) => rel === dir }));
      assert.ok(p.fail, `${dir}: ожидалась ошибка, получено ${JSON.stringify(p)}`);
      assert.match(p.fail, /эндпоинт/);
    }
  });

  it('isolation: набор есть → go test -tags isolation ./test/isolation/...', () => {
    const p = step('isolation', 'go-isolation').plan(
      fakeCtx({ hasGo: (rel) => rel === 'backend/test/isolation' }),
    );
    assert.deepEqual(p.cmds, [
      ['go', '-C', 'backend', 'test', '-tags', 'isolation', '-count=1', './test/isolation/...'],
    ]);
  });

  it('concurrency: набор есть → go test -tags concurrency', () => {
    const p = step('isolation', 'go-concurrency').plan(
      fakeCtx({ hasGo: (rel) => rel === 'backend/test/concurrency' }),
    );
    assert.deepEqual(p.cmds, [
      ['go', '-C', 'backend', 'test', '-tags', 'concurrency', '-count=1', './test/concurrency/...'],
    ]);
  });

  it('images: docker build для каждого Dockerfile; имя образа из файла или каталога', () => {
    const p = step('build', 'images').plan(
      fakeCtx({
        dockerfiles: () => [
          'backend/Dockerfile',
          'deploy/images/tools.Dockerfile',
          'frontend/apps/web/web.Dockerfile',
        ],
      }),
    );
    assert.deepEqual(p.cmds, [
      ['docker', 'build', '-f', 'backend/Dockerfile', '-t', 'ortus-backend:ci', '.'],
      ['docker', 'build', '-f', 'deploy/images/tools.Dockerfile', '-t', 'ortus-tools:ci', '.'],
      ['docker', 'build', '-f', 'frontend/apps/web/web.Dockerfile', '-t', 'ortus-web:ci', '.'],
    ]);
  });

  it('images (W1.01, Q-W0.04-4): нет обязательного Dockerfile — шаг падает, а не пропускается', () => {
    const st = step('build', 'images');
    assert.match(st.owner, /W1\.01/);
    for (const files of [[], ['backend/Dockerfile'], ['frontend/apps/web/web.Dockerfile']]) {
      for (const ctx of [
        fakeCtx({ dockerfiles: () => files }),
        fakeCtx({ dockerfiles: () => files, hasDocker: () => false }),
      ]) {
        const p = st.plan(ctx);
        assert.ok(
          p.fail,
          `${JSON.stringify(files)}: ожидалась ошибка, получено ${JSON.stringify(p)}`,
        );
        assert.match(p.fail, /Dockerfile/);
      }
    }
    assert.deepEqual(need().REQUIRED_IMAGES, {
      'backend/Dockerfile': 'ortus-backend',
      'frontend/apps/web/web.Dockerfile': 'ortus-web',
    });
  });

  it('Docker нет: локально — пропуск, в CI — ошибка (actionlint, images)', () => {
    const local = fakeCtx({
      hasDocker: () => false,
      exists: has('.github/workflows'),
      dockerfiles: () => ['backend/Dockerfile', 'frontend/apps/web/web.Dockerfile'],
    });
    const ci = { ...local, ci: true };
    for (const [j, s] of [
      ['lint', 'actionlint'],
      ['build', 'images'],
    ]) {
      assert.match(step(j, s).plan(local).skip ?? '', /Docker/, `${j}/${s} локально`);
      assert.match(step(j, s).plan(ci).fail ?? '', /Docker/, `${j}/${s} в CI`);
    }
  });

  it('actionlint: образ с точной версией, монтирует корень', () => {
    const p = step('lint', 'actionlint').plan(fakeCtx({ exists: has('.github/workflows') }));
    assert.deepEqual(p.cmds, [
      [
        'docker',
        'run',
        '--rm',
        '-v',
        '/repo:/repo',
        '-w',
        '/repo',
        'rhysd/actionlint:1.7.12',
        '-color',
      ],
    ]);
  });

  it('e2e: playwright.config.ts и скрипт e2e → e2e:install (если есть) и e2e', () => {
    const p = step('e2e', 'e2e').plan(
      fakeCtx({
        exists: has('frontend/apps/web/playwright.config.ts'),
        scripts: { e2e: 'x', 'e2e:install': 'y' },
      }),
    );
    assert.deepEqual(p.cmds, [
      ['pnpm', 'run', 'e2e:install'],
      ['pnpm', 'run', 'e2e'],
    ]);
  });
});

describe('W0.17: плановые гейты (П-4) и e2e-stand (П-1)', () => {
  const has =
    (...paths) =>
    (rel) =>
      paths.includes(rel);
  const scripts = {
    ...STUB_SCRIPTS,
    'allowlist-lint': 'x',
    'mcp:check': 'x',
    'storybook:build': 'x',
    'check-k6': 'x',
    'check-decisions': 'x',
    'e2e:stand': 'x',
    'e2e:install': 'y',
  };

  it('check-decisions, allowlist-lint, mcp-check — свои скрипты package.json', () => {
    const ctx = fakeCtx({
      scripts,
      exists: has('docs/plan/scripts/renumber-decisions.mjs', '.mcp.json'),
    });
    assert.deepEqual(step('unit', 'check-decisions').plan(ctx).cmds, [
      ['pnpm', 'run', 'check-decisions'],
    ]);
    assert.deepEqual(step('unit', 'allowlist-lint').plan(ctx).cmds, [
      ['pnpm', 'run', 'allowlist-lint'],
    ]);
    assert.deepEqual(step('unit', 'mcp-check').plan(ctx).cmds, [['pnpm', 'run', 'mcp:check']]);
  });

  it('storybook: storybook:build @ortus/ui; check-k6: Docker — локально пропуск, в CI ошибка', () => {
    const ctx = fakeCtx({ scripts, exists: has('backend/test/load/check-k6.mjs') });
    assert.deepEqual(step('build', 'storybook').plan(ctx).cmds, [
      ['pnpm', 'run', 'storybook:build'],
    ]);
    assert.deepEqual(step('build', 'check-k6').plan(ctx).cmds, [['pnpm', 'run', 'check-k6']]);
    const noDocker = { ...ctx, hasDocker: () => false };
    assert.match(step('build', 'check-k6').plan(noDocker).skip ?? '', /Docker/);
    assert.match(step('build', 'check-k6').plan({ ...noDocker, ci: true }).fail ?? '', /Docker/);
  });

  it('e2e-stand: локально без ORTUS_SLOT — пропуск (слот 0 — общий стенд интегратора)', () => {
    const ctx = fakeCtx({ scripts, exists: has('frontend/apps/web/playwright.config.ts') });
    assert.match(step('e2e-stand', 'e2e-stand').plan(ctx).skip ?? '', /ORTUS_SLOT/);
  });

  it('e2e-stand: слот задан или CI → e2e:install и e2e:stand', () => {
    const base = { scripts, exists: has('frontend/apps/web/playwright.config.ts') };
    for (const ctx of [fakeCtx({ ...base, slot: '18' }), fakeCtx({ ...base, ci: true })]) {
      assert.deepEqual(step('e2e-stand', 'e2e-stand').plan(ctx).cmds, [
        ['pnpm', 'run', 'e2e:install'],
        ['pnpm', 'run', 'e2e:stand'],
      ]);
    }
  });

  it('e2e-stand: без Docker — локально пропуск, в CI ошибка', () => {
    const ctx = fakeCtx({
      scripts,
      slot: '18',
      hasDocker: () => false,
      exists: has('frontend/apps/web/playwright.config.ts'),
    });
    assert.match(step('e2e-stand', 'e2e-stand').plan(ctx).skip ?? '', /Docker/);
    assert.match(step('e2e-stand', 'e2e-stand').plan({ ...ctx, ci: true }).fail ?? '', /Docker/);
  });

  it('makeContext: слот из ORTUS_SLOT', () => {
    assert.equal(need().makeContext(undefined, { ORTUS_SLOT: '18' }).slot, '18');
    assert.equal(need().makeContext(undefined, {}).slot, undefined);
  });
});

describe('W1.46: Go-тесты с Docker на Windows (П-10, П-12)', () => {
  const WIN_HOST = 'npipe:////./pipe/docker_engine';
  // Доделка 16.10: ryuk сессии живёт, пока пакеты по очереди собираются и линкуются.
  const RYUK = { RYUK_RECONNECTION_TIMEOUT: '5m' };
  const WIN_ENV = { DOCKER_HOST: WIN_HOST, ...RYUK };
  const integration = (over) =>
    step('integration', 'go-integration').plan(
      fakeCtx({ goTagged: (t) => t === 'integration', ...over }),
    );
  const tagged = (over) => fakeCtx({ hasGo: (rel) => rel.startsWith('backend/test/'), ...over });

  it('integration на win32: -p 4 и DOCKER_HOST на канал docker_engine', () => {
    const p = integration({ platform: 'win32' });
    assert.deepEqual(p.cmds, [
      ['go', '-C', 'backend', 'test', '-tags', 'integration', '-count=1', '-p', '4', './...'],
    ]);
    assert.deepEqual(p.env, WIN_ENV);
    assert.equal(need().GO_TEST_P_ENV, 'ORTUS_GO_TEST_P');
    assert.equal(need().WIN_DOCKER_HOST, WIN_HOST);
  });

  it('ORTUS_GO_TEST_P задаёт -p на любой платформе', () => {
    for (const platform of ['win32', 'linux']) {
      const p = integration({ platform, env: { ORTUS_GO_TEST_P: '2' } });
      assert.deepEqual(
        p.cmds[0],
        ['go', '-C', 'backend', 'test', '-tags', 'integration', '-count=1', '-p', '2', './...'],
        platform,
      );
    }
  });

  it('неверный ORTUS_GO_TEST_P — шаг падает с причиной, а не идёт с -p по умолчанию', () => {
    for (const bad of ['0', '-1', 'abc', '2.5', ' ']) {
      const p = integration({ platform: 'win32', env: { ORTUS_GO_TEST_P: bad } });
      assert.match(p.fail ?? '', /ORTUS_GO_TEST_P/, JSON.stringify(bad));
    }
  });

  it('linux без env: команда прежняя, без DOCKER_HOST', () => {
    const p = integration({ platform: 'linux' });
    assert.deepEqual(p.cmds, [
      ['go', '-C', 'backend', 'test', '-tags', 'integration', '-count=1', './...'],
    ]);
    assert.equal(p.env?.DOCKER_HOST, undefined);
  });

  // W2.83: на раннере ubuntu пакеты одного `go test ./...` тоже делят один ryuk — он умирал через 10 с без
  // соединений, следующий пакет падал «wait for reaper …: context deadline exceeded» (прогон 40120489895).
  it('на linux ryuk тоже ждёт следующий пакет 5 минут; заданный таймаут (оба имени) не перекрывается', () => {
    assert.deepEqual(integration({ platform: 'linux' }).env, RYUK);
    for (const name of ['RYUK_RECONNECTION_TIMEOUT', 'TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT']) {
      assert.equal(integration({ platform: 'linux', env: { [name]: '30s' } }).env, undefined, name);
    }
  });

  it('заданный DOCKER_HOST не перекрывается', () => {
    const p = integration({ platform: 'win32', env: { DOCKER_HOST: 'tcp://127.0.0.1:2375' } });
    assert.deepEqual(p.env, RYUK);
  });

  it('на win32 ryuk ждёт следующий пакет 5 минут; заданный таймаут (оба имени) не перекрывается', () => {
    assert.equal(need().WIN_RYUK_RECONNECTION_TIMEOUT, '5m');
    for (const name of ['RYUK_RECONNECTION_TIMEOUT', 'TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT']) {
      const p = integration({ platform: 'win32', env: { [name]: '30s' } });
      assert.deepEqual(p.env, { DOCKER_HOST: WIN_HOST }, name);
    }
    const own = integration({
      platform: 'win32',
      env: { DOCKER_HOST: 'tcp://127.0.0.1:2375', RYUK_RECONNECTION_TIMEOUT: '30s' },
    });
    assert.equal(own.env, undefined);
  });

  it('isolation и concurrency на win32 тоже получают DOCKER_HOST (без -p), на linux — только таймаут ryuk', () => {
    for (const [j, s] of [
      ['isolation', 'go-isolation'],
      ['isolation', 'go-concurrency'],
    ]) {
      const p = step(j, s).plan(tagged({ platform: 'win32' }));
      assert.deepEqual(p.env, WIN_ENV, `${j}/${s}`);
      assert.ok(!p.cmds[0].includes('-p'), `${j}/${s}: ${p.cmds[0].join(' ')}`);
      assert.deepEqual(step(j, s).plan(tagged({ platform: 'linux' })).env, RYUK, `${j}/${s}`);
    }
  });

  it('runJob передаёт env шага в exec', () => {
    const job = {
      id: 'x',
      needs: [],
      steps: [{ id: 'a', owner: 'W1.46', plan: () => ({ cmds: [['a'], ['b']], env: { K: 'v' } }) }],
    };
    const seen = [];
    need().runJob(job, fakeCtx(), (argv, env) => (seen.push([argv[0], env]), 0), quiet);
    assert.deepEqual(seen, [
      ['a', { K: 'v' }],
      ['b', { K: 'v' }],
    ]);
  });

  it('makeExec добавляет env к окружению процесса команды', () => {
    const exec = need().makeExec(need().ROOT);
    const probe = [
      process.execPath,
      '-e',
      'process.exit(process.env.W146_PROBE === "ok" && process.env.PATH !== undefined ? 0 : 3)',
    ];
    assert.equal(exec(probe, { W146_PROBE: 'ok' }), 0);
    assert.equal(exec(probe), 3);
  });

  it('makeContext: платформа процесса и env', () => {
    const ctx = need().makeContext(undefined, { ORTUS_GO_TEST_P: '3' });
    assert.equal(ctx.platform, process.platform);
    assert.equal(ctx.env.ORTUS_GO_TEST_P, '3');
  });

  // Доделка 16.10: зависший Docker Desktop не отвечает на `docker version` — конвейер и `test` висели без конца.
  it('probeDocker: docker version с таймаутом; зависший Docker — hung с причиной, а не вечное ожидание', () => {
    const { probeDocker, DOCKER_PROBE_TIMEOUT_MS } = need();
    assert.equal(DOCKER_PROBE_TIMEOUT_MS, 60_000);
    const calls = [];
    const spawn = (r) => (cmd, args, opts) => (calls.push([cmd, args, opts?.timeout]), r);
    assert.deepEqual(probeDocker(spawn({ status: 0, stdout: '27.4.0\n' })), { ok: true });
    assert.deepEqual(calls, [['docker', ['version', '--format', '{{.Server.Version}}'], 60_000]]);
    const timeout = Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const hung = probeDocker(spawn({ status: null, error: timeout }));
    assert.equal(hung.ok, false);
    assert.match(hung.hung ?? '', /docker version.*60 с/);
    const enoent = Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' });
    assert.deepEqual(probeDocker(spawn({ status: null, error: enoent })), { ok: false });
    assert.deepEqual(probeDocker(spawn({ status: 1 })), { ok: false });
  });

  // Возврат 16.10 №2 (minor 4): при зависшем Docker каждый процесс конвейера ждал 60 с без возможности сократить.
  it('probeDocker: таймаут задаётся вторым аргументом и попадает в причину', () => {
    const { probeDocker } = need();
    const calls = [];
    const timeout = Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const spawn = (cmd, args, opts) => (
      calls.push(opts?.timeout),
      { status: null, error: timeout }
    );
    const hung = probeDocker(spawn, 5_000);
    assert.deepEqual(calls, [5_000]);
    assert.match(hung.hung ?? '', /docker version не ответил за 5 с — Docker завис/);
  });

  it('dockerProbeTimeoutMs: ORTUS_DOCKER_PROBE_TIMEOUT_MS — целое > 0, иначе 60 с', () => {
    const { dockerProbeTimeoutMs } = need();
    assert.equal(dockerProbeTimeoutMs({}), 60_000);
    assert.equal(dockerProbeTimeoutMs({ ORTUS_DOCKER_PROBE_TIMEOUT_MS: '5000' }), 5_000);
    for (const bad of ['', '0', '-1', 'abc', '1.5', '5s']) {
      assert.equal(dockerProbeTimeoutMs({ ORTUS_DOCKER_PROBE_TIMEOUT_MS: bad }), 60_000, bad);
    }
  });

  it('makeContext: таймаут проверки Docker берётся из env', () => {
    const { makeContext } = need();
    assert.equal(makeContext(undefined, {}).dockerProbeTimeoutMs, 60_000);
    const ctx = makeContext(undefined, { ORTUS_DOCKER_PROBE_TIMEOUT_MS: '7000' });
    assert.equal(ctx.dockerProbeTimeoutMs, 7_000);
  });

  it('Docker завис: шаги с охраной Docker падают с причиной и локально, а не пропускаются', () => {
    const local = fakeCtx({
      hasDocker: () => false,
      dockerHung: () => 'docker version не ответил за 60 с',
      exists: (rel) => rel === '.github/workflows',
      dockerfiles: () => ['backend/Dockerfile', 'frontend/apps/web/web.Dockerfile'],
    });
    for (const [j, s] of [
      ['lint', 'actionlint'],
      ['build', 'images'],
    ]) {
      const p = step(j, s).plan(local);
      assert.match(p.fail ?? '', /не ответил/, `${j}/${s}: ${JSON.stringify(p)}`);
    }
  });

  // Возврат 16.10 №1: Go-шаги с Docker при зависшем Docker не запускают `go test`, а сразу падают с причиной.
  const HUNG = 'docker version не ответил за 60 с — Docker завис';
  const GO_DOCKER_STEPS = [
    ['integration', 'go-integration'],
    ['isolation', 'go-isolation'],
    ['isolation', 'go-concurrency'],
  ];
  const goCtx = (over) =>
    fakeCtx({
      platform: 'win32',
      goTagged: (t) => t === 'integration',
      hasGo: (rel) => rel.startsWith('backend/test/'),
      ...over,
    });

  it('Docker завис: go-integration, go-isolation, go-concurrency падают с причиной без запуска go test', () => {
    for (const [j, s] of GO_DOCKER_STEPS) {
      const p = step(j, s).plan(goCtx({ hasDocker: () => false, dockerHung: () => HUNG }));
      assert.equal(p.fail, HUNG, `${j}/${s}: ${JSON.stringify(p)}`);
      assert.equal(p.cmds, undefined, `${j}/${s}`);
    }
  });

  it('Docker отвечает или его нет: Go-шаги с Docker по-прежнему запускают go test', () => {
    for (const over of [{}, { hasDocker: () => false, dockerHung: () => undefined }]) {
      for (const [j, s] of GO_DOCKER_STEPS) {
        const p = step(j, s).plan(goCtx(over));
        assert.equal(p.cmds?.[0]?.[0], 'go', `${j}/${s}: ${JSON.stringify(p)}`);
      }
    }
  });

  it('Go-шаг без цели не опрашивает Docker (пропуск без docker version)', () => {
    const dockerHung = () => assert.fail('dockerHung не должен вызываться');
    for (const [j, s] of GO_DOCKER_STEPS) {
      assert.ok(step(j, s).plan(fakeCtx({ dockerHung })).skip, `${j}/${s}`);
    }
  });

  it('--dry-run: зависший Docker — пропуск с причиной, а не ошибка (команды всё равно не запускаются)', () => {
    const ctx = goCtx({
      dryRun: true,
      hasDocker: () => false,
      dockerHung: () => HUNG,
      slot: '9',
      scripts: { ...STUB_SCRIPTS, 'check-k6': 'x', 'e2e:stand': 'x' },
      exists: (rel) =>
        [
          '.github/workflows',
          'backend/test/load/check-k6.mjs',
          'frontend/apps/web/playwright.config.ts',
        ].includes(rel),
      dockerfiles: () => ['backend/Dockerfile', 'frontend/apps/web/web.Dockerfile'],
    });
    for (const [j, s] of [
      ['lint', 'actionlint'],
      ['build', 'check-k6'],
      ['build', 'images'],
      ['e2e-stand', 'e2e-stand'],
      ...GO_DOCKER_STEPS,
    ]) {
      const p = step(j, s).plan(ctx);
      assert.equal(p.fail, undefined, `${j}/${s}: ${JSON.stringify(p)}`);
      assert.match(p.skip ?? '', /не ответил.*--dry-run/, `${j}/${s}: ${JSON.stringify(p)}`);
    }
  });

  it('runJob с dryRun передаёт плану ctx.dryRun; без dryRun — нет', () => {
    const seen = [];
    const job = {
      id: 'x',
      needs: [],
      steps: [{ id: 'a', owner: 'W1.46', plan: (c) => (seen.push(c.dryRun), { skip: 'x' }) }],
    };
    need().runJob(job, fakeCtx(), () => 0, quiet, { dryRun: true });
    need().runJob(job, fakeCtx(), () => 0, quiet);
    assert.deepEqual(seen, [true, undefined]);
  });
});

describe('codegen-drift', () => {
  const real = { ...STUB_SCRIPTS, gen: 'node tools/gen/run.mjs' };

  it('настоящий gen без изменений файлов → 0', () => {
    const st = step('contract', 'codegen-drift');
    const p = st.plan(fakeCtx({ scripts: real }));
    assert.equal(typeof p.fn, 'function');
    const calls = [];
    const code = p.fn((argv) => (calls.push(argv), 0), quiet);
    assert.equal(code, 0);
    assert.deepEqual(calls, [['pnpm', 'run', 'gen']]);
  });

  it('gen изменил или создал файлы → 1 и список файлов', () => {
    let n = 0;
    const snaps = [
      new Map([['README.md', 'a']]),
      new Map([
        ['README.md', 'a'],
        ['backend/internal/api/me/server.gen.go', 'b'],
      ]),
    ];
    const ctx = fakeCtx({ scripts: real, snapshot: () => snaps[n++] });
    const errors = [];
    const code = step('contract', 'codegen-drift')
      .plan(ctx)
      .fn(() => 0, { log() {}, error: (m) => errors.push(m) });
    assert.equal(code, 1);
    assert.match(errors.join('\n'), /backend\/internal\/api\/me\/server\.gen\.go/);
  });
});

describe('runJob', () => {
  it('упавший шаг не останавливает остальные, итог job — 1; пропуск не валит', () => {
    const job = {
      id: 'x',
      needs: [],
      steps: [
        { id: 'a', owner: 'W0.04', plan: () => ({ cmds: [['a']] }) },
        { id: 'b', owner: 'W0.04', plan: () => ({ skip: 'нет b' }) },
        { id: 'c', owner: 'W0.04', plan: () => ({ cmds: [['c']] }) },
      ],
    };
    const ran = [];
    const r = need().runJob(
      job,
      fakeCtx(),
      (argv) => (ran.push(argv[0]), argv[0] === 'a' ? 1 : 0),
      quiet,
    );
    assert.equal(r.code, 1);
    assert.deepEqual(ran, ['a', 'c']);
    assert.deepEqual(
      r.results.map((x) => x.status),
      ['fail', 'skip', 'ok'],
    );
  });

  it('fail из охраны — шаг упал без запуска команд', () => {
    const job = {
      id: 'x',
      needs: [],
      steps: [{ id: 'a', owner: 'W0.15', plan: () => ({ fail: 'нет набора' }) }],
    };
    const r = need().runJob(job, fakeCtx(), () => assert.fail('не должен запускаться'), quiet);
    assert.equal(r.code, 1);
  });

  it('команды шага идут по очереди до первой ошибки', () => {
    const job = {
      id: 'x',
      needs: [],
      steps: [{ id: 'a', owner: 'W0.04', plan: () => ({ cmds: [['1'], ['2'], ['3']] }) }],
    };
    const ran = [];
    need().runJob(job, fakeCtx(), (argv) => (ran.push(argv[0]), argv[0] === '2' ? 1 : 0), quiet);
    assert.deepEqual(ran, ['1', '2']);
  });
});

describe('runAll', () => {
  it('job идут по порядку, первая упавшая останавливает конвейер', () => {
    const jobs = [
      { id: 'a', needs: [], steps: [{ id: 's', owner: 'W', plan: () => ({ cmds: [['a']] }) }] },
      { id: 'b', needs: ['a'], steps: [{ id: 's', owner: 'W', plan: () => ({ cmds: [['b']] }) }] },
      { id: 'c', needs: ['b'], steps: [{ id: 's', owner: 'W', plan: () => ({ cmds: [['c']] }) }] },
    ];
    const ran = [];
    const code = need().runAll(
      fakeCtx(),
      (argv) => (ran.push(argv[0]), argv[0] === 'b' ? 1 : 0),
      quiet,
      jobs,
    );
    assert.equal(code, 1);
    assert.deepEqual(ran, ['a', 'b']);
  });
});

describe('CLI на этом репозитории', () => {
  it('--list печатает все job', () => {
    const r = runNode(SCRIPT, ['--list']);
    assert.equal(r.status, 0, r.stderr);
    for (const id of [
      'lint',
      'contract',
      'unit',
      'integration',
      'isolation',
      'build',
      'e2e',
      'e2e-stand',
    ]) {
      assert.match(r.stdout, new RegExp(`^${id}`, 'm'));
    }
  });

  it('--dry-run --all: охрана вычисляется, ничего не запускается, exit 0', () => {
    // Зависший Docker даёт в --dry-run пропуск, поэтому короткий таймаут не меняет итог, а тест не ждёт 60 с.
    const env = { ...process.env, ORTUS_DOCKER_PROBE_TIMEOUT_MS: '5000' };
    const r = runNode(SCRIPT, ['--dry-run', '--all'], { env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /(⏭|▶) contract\/permissions: /);
    assert.match(r.stdout, /▶ unit\/check-icu: /);
  });

  it('неизвестная job → exit 2', () => {
    const r = runNode(SCRIPT, ['--job', 'nope']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /неизвестная job «nope»/);
  });
});

describe('образы этого репозитория (W1.01)', () => {
  const files = need().makeContext().dockerfiles();
  const read = (p) => readFileSync(join(need().ROOT, p), 'utf8');
  const froms = (text) => [...text.matchAll(/^FROM\s+(\S+)/gim)].map((m) => m[1]);

  it('backend/Dockerfile и frontend/apps/web/web.Dockerfile на месте', () => {
    for (const f of Object.keys(need().REQUIRED_IMAGES)) assert.ok(files.includes(f), f);
  });

  it('базовые образы закреплены по digest с тегом версии', () => {
    for (const f of files) {
      const images = froms(read(f)).filter((img) => !/^[a-z0-9_-]+$/i.test(img)); // имя стадии — не образ
      assert.ok(images.length > 0, `${f}: нет FROM`);
      for (const img of images)
        assert.match(img, /^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/, `${f}: ${img}`);
    }
  });

  it('backend: distroless, non-root, бинари cmd/api, cmd/migrate, cmd/worker, cmd/provisioner', () => {
    const text = read('backend/Dockerfile');
    const last = froms(text).at(-1);
    assert.match(last, /^gcr\.io\/distroless\/static[^:]*:nonroot@/);
    assert.match(text, /^USER\s+nonroot(:nonroot)?\s*$/m);
    for (const cmd of ['api', 'migrate', 'worker', 'provisioner'])
      assert.match(text, new RegExp(`\\./cmd/${cmd}\\b`));
    assert.match(text, /^ENTRYPOINT\s+\["\/app\/api"\]/m);
  });

  it('web: статическая сборка @ortus/web, раздача non-root', () => {
    const text = read('frontend/apps/web/web.Dockerfile');
    assert.match(text, /--filter\s+@ortus\/web/);
    assert.match(froms(text).at(-1), /nginx-unprivileged/);
    assert.match(text, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
  });

  it('у каждого Dockerfile свой .dockerignore без node_modules в контексте', () => {
    for (const f of files) {
      const ignore = `${f}.dockerignore`;
      assert.ok(existsSync(join(need().ROOT, ignore)), ignore);
      assert.match(read(ignore), /node_modules/);
    }
  });
});

describe('W1.53: шардирование job e2e (П-16)', () => {
  const e2eCtx = (env = {}) =>
    fakeCtx({
      env,
      exists: (rel) => rel === 'frontend/apps/web/playwright.config.ts',
      scripts: { e2e: 'x', 'e2e:install': 'y' },
    });

  it('parseShard: пусто — без аргументов, i/N — --shard=i/N', () => {
    const { parseShard } = need();
    assert.deepEqual(parseShard(undefined), { args: [] });
    assert.deepEqual(parseShard(''), { args: [] });
    for (const s of ['1/4', '4/4', '6/6', '3/12']) {
      assert.deepEqual(parseShard(s), { args: [`--shard=${s}`] }, s);
    }
  });

  it('parseShard: неверное значение — fail с именем env', () => {
    const { parseShard, E2E_SHARD_ENV } = need();
    assert.equal(E2E_SHARD_ENV, 'E2E_SHARD');
    for (const s of ['0/4', '5/4', '1/0', 'a/b', '1-4', ' 1/4', '01/4', '1/4/2', '1/', '/4']) {
      const r = parseShard(s);
      assert.ok(r.fail, `${JSON.stringify(s)} → ${JSON.stringify(r)}`);
      assert.match(r.fail, /E2E_SHARD/);
      assert.equal(r.args, undefined);
    }
  });

  it('e2e: E2E_SHARD=2/6 → pnpm run e2e --shard=2/6', () => {
    const p = step('e2e', 'e2e').plan(e2eCtx({ E2E_SHARD: '2/6' }));
    assert.deepEqual(p.cmds, [
      ['pnpm', 'run', 'e2e:install'],
      ['pnpm', 'run', 'e2e', '--shard=2/6'],
    ]);
  });

  it('e2e: без E2E_SHARD (ci:local) — прежняя команда', () => {
    for (const env of [{}, { E2E_SHARD: '' }]) {
      assert.deepEqual(step('e2e', 'e2e').plan(e2eCtx(env)).cmds, [
        ['pnpm', 'run', 'e2e:install'],
        ['pnpm', 'run', 'e2e'],
      ]);
    }
  });

  it('e2e: неверный E2E_SHARD — fail без команд', () => {
    const p = step('e2e', 'e2e').plan(e2eCtx({ E2E_SHARD: '7/6' }));
    assert.match(p.fail ?? '', /E2E_SHARD/);
    assert.equal(p.cmds, undefined);
  });

  it('runJob: шаг e2e с E2E_SHARD вызывает exec с --shard', () => {
    const job = need().JOBS.find((j) => j.id === 'e2e');
    const calls = [];
    const r = need().runJob(
      job,
      e2eCtx({ E2E_SHARD: '1/6' }),
      (argv) => {
        calls.push(argv);
        return 0;
      },
      quiet,
    );
    assert.equal(r.code, 0);
    assert.deepEqual(calls.at(-1), ['pnpm', 'run', 'e2e', '--shard=1/6']);
  });

  it('E2E_SHARDS — целое ≥ 2', () => {
    const { E2E_SHARDS } = need();
    assert.ok(Number.isInteger(E2E_SHARDS) && E2E_SHARDS >= 2, String(E2E_SHARDS));
  });

  it('workflowJobs: e2e → матрица e2e-shard и итоговая e2e, остальные — как JOBS', () => {
    const { workflowJobs, JOBS, E2E_SHARDS } = need();
    const wj = workflowJobs();
    assert.deepEqual(
      wj.map((j) => j.id),
      [
        'lint',
        'contract',
        'unit',
        'integration',
        'isolation',
        'build',
        'e2e-shard',
        'e2e',
        'e2e-stand',
      ],
    );
    const by = Object.fromEntries(wj.map((j) => [j.id, j]));
    for (const j of JOBS.filter((x) => x.id !== 'e2e')) {
      assert.deepEqual(by[j.id], { id: j.id, needs: j.needs, pipelineJob: j.id }, j.id);
    }
    assert.deepEqual(by['e2e-shard'], {
      id: 'e2e-shard',
      needs: ['build'],
      pipelineJob: 'e2e',
      shards: E2E_SHARDS,
    });
    assert.deepEqual(by.e2e, { id: 'e2e', needs: ['e2e-shard'], gate: 'e2e-shard' });
  });
});
