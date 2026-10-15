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
    const r = runNode(SCRIPT, ['--dry-run', '--all']);
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
