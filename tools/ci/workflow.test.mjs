// W0.04 · .github/workflows/ci.yml соответствует конвейеру tools/ci/pipeline.mjs.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse } from 'yaml';
import { abs, importIfExists, read } from './_util.mjs';

const WORKFLOW = '.github/workflows/ci.yml';
const pipeline = await importIfExists('tools/ci/pipeline.mjs');

function load() {
  assert.ok(existsSync(abs(WORKFLOW)), `${WORKFLOW} ещё не существует`);
  return { text: read(WORKFLOW), wf: parse(read(WORKFLOW)) };
}

const allSteps = (wf) => Object.values(wf.jobs).flatMap((j) => j.steps ?? []);

/** W1.53: job workflow по раскладке pipeline.mjs; итоговые (gate) не запускают конвейер. */
const planned = () => pipeline.workflowJobs();
const runners = (wf) => planned().filter((j) => !j.gate && wf.jobs[j.id]);

describe('ci.yml: job и порядок', () => {
  it('id job и needs совпадают с workflowJobs() из pipeline.mjs', () => {
    const { wf } = load();
    assert.deepEqual(
      Object.keys(wf.jobs),
      planned().map((j) => j.id),
    );
    for (const j of planned()) {
      const needs = wf.jobs[j.id].needs ?? [];
      assert.deepEqual([needs].flat(), j.needs, `needs у ${j.id}`);
    }
  });

  it('каждая job, кроме итоговой, вызывает node tools/ci/pipeline.mjs --job <pipeline-job>', () => {
    const { wf } = load();
    for (const j of runners(wf)) {
      const runs = wf.jobs[j.id].steps.map((s) => s.run ?? '');
      assert.ok(
        runs.some((r) => r.trim() === `node tools/ci/pipeline.mjs --job ${j.pipelineJob}`),
        `${j.id}: нет шага pipeline.mjs --job ${j.pipelineJob}`,
      );
    }
  });

  it('каждая job, кроме итоговой, ставит зависимости по lock-файлу и Node из .nvmrc', () => {
    const { wf } = load();
    for (const { id } of runners(wf)) {
      const job = wf.jobs[id];
      const runs = job.steps.map((s) => s.run ?? '').join('\n');
      assert.match(runs, /corepack enable/, id);
      assert.match(runs, /pnpm install --frozen-lockfile/, id);
      const node = job.steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
      assert.equal(node?.with?.['node-version-file'], '.nvmrc', id);
    }
  });

  it('Go из backend/go.mod там, где нужен Go', () => {
    const { wf } = load();
    for (const id of ['lint', 'unit', 'integration', 'isolation', 'build', 'e2e-stand']) {
      const goStep = wf.jobs[id].steps.find((s) => s.uses?.startsWith('actions/setup-go@'));
      assert.equal(goStep?.with?.['go-version-file'], 'backend/go.mod', id);
    }
  });
});

describe('ci.yml: триггеры, права, надёжность', () => {
  it('pull_request и push в main', () => {
    const { wf } = load();
    assert.ok('pull_request' in wf.on);
    assert.deepEqual(wf.on.push.branches, ['main']);
  });

  it('минимальные права: contents: read', () => {
    assert.deepEqual(load().wf.permissions, { contents: 'read' });
  });

  it('concurrency с отменой предыдущего прогона', () => {
    const { wf } = load();
    assert.match(wf.concurrency.group, /github\.ref/);
    assert.equal(wf.concurrency['cancel-in-progress'], true);
  });

  it('ни одна job и ни один шаг не continue-on-error — изоляция блокирующая', () => {
    const { wf, text } = load();
    assert.doesNotMatch(text, /continue-on-error/);
    assert.ok(wf.jobs.isolation, 'нет job isolation');
    assert.equal(wf.jobs.isolation.if, undefined, 'job isolation не должна иметь условия');
  });

  it('каждая сторонняя action закреплена полным SHA с комментарием версии', () => {
    const { wf, text } = load();
    const uses = allSteps(wf)
      .map((s) => s.uses)
      .filter(Boolean);
    assert.ok(uses.length > 0);
    for (const u of uses) {
      assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
      const line = text.split('\n').find((l) => l.includes(u));
      assert.match(line, /# v\d+\.\d+\.\d+/, `${u}: нет комментария версии`);
    }
  });

  it('golangci-lint той же версии, что в CLAUDE.md', () => {
    const { wf } = load();
    const v = wf.env.GOLANGCI_LINT_VERSION;
    assert.match(v, /^v2\.\d+\.\d+$/);
    assert.ok(read('CLAUDE.md').includes(v), `CLAUDE.md не упоминает ${v}`);
  });
});

describe('ci.yml: e2e-stand (W0.17, П-1)', () => {
  it('job e2e-stand после build; стенд останавливается шагом if: always()', () => {
    const { wf } = load();
    const job = wf.jobs['e2e-stand'];
    assert.ok(job, 'нет job e2e-stand');
    assert.deepEqual([job.needs].flat(), ['build']);
    const runIdx = job.steps.findIndex(
      (s) => (s.run ?? '').trim() === 'node tools/ci/pipeline.mjs --job e2e-stand',
    );
    const down = job.steps.findIndex(
      (s) => s.if === 'always()' && (s.run ?? '').trim() === 'node tools/ci/e2e-stand.mjs --down',
    );
    assert.ok(runIdx >= 0 && down > runIdx, 'остановка стенда — после прогона и всегда');
    assert.ok(job['timeout-minutes'] <= 60);
  });
});

describe('ci.yml: шарды e2e (W1.53, П-16)', () => {
  const E2E_NAME = 'e2e (Playwright, режим mock)';
  const shardJob = (wf) => wf.jobs['e2e-shard'];

  it('e2e-shard: матрица shard = 1…E2E_SHARDS, fail-fast: false, после build', () => {
    const { wf } = load();
    const job = shardJob(wf);
    assert.ok(job, 'нет job e2e-shard');
    const n = pipeline.E2E_SHARDS;
    assert.deepEqual(
      job.strategy?.matrix?.shard,
      Array.from({ length: n }, (_, i) => i + 1),
    );
    assert.equal(job.strategy['fail-fast'], false);
    assert.deepEqual([job.needs].flat(), ['build']);
  });

  it('e2e-shard: E2E_SHARD = ${{ matrix.shard }}/N на шаге pipeline.mjs --job e2e', () => {
    const { wf } = load();
    const run = shardJob(wf).steps.find(
      (s) => (s.run ?? '').trim() === 'node tools/ci/pipeline.mjs --job e2e',
    );
    assert.ok(run, 'нет шага pipeline.mjs --job e2e');
    assert.equal(run.env?.E2E_SHARD, `\${{ matrix.shard }}/${pipeline.E2E_SHARDS}`);
  });

  it('e2e-shard: шард не дольше 20 мин; имя с номером шарда и не совпадает с итоговой', () => {
    const { wf } = load();
    const job = shardJob(wf);
    assert.ok(job['timeout-minutes'] <= 20, `timeout-minutes ${job['timeout-minutes']}`);
    assert.match(job.name, /\$\{\{ matrix\.shard \}\}/);
    assert.notEqual(job.name, E2E_NAME);
    assert.match(job.name, /Playwright, режим mock/);
  });

  it('e2e-shard: артефакт playwright-report и test-results с уникальным именем шарда', () => {
    const { wf } = load();
    const up = shardJob(wf).steps.filter((s) => s.uses?.startsWith('actions/upload-artifact@'));
    assert.equal(up.length, 1);
    const [a] = up;
    assert.match(a.with.name, /\$\{\{ matrix\.shard \}\}/);
    assert.match(a.with.path, /frontend\/apps\/web\/playwright-report\//);
    assert.match(a.with.path, /frontend\/apps\/web\/test-results\//);
    assert.equal(a.if, 'failure()');
    const names = allSteps(wf)
      .filter((s) => s.uses?.startsWith('actions/upload-artifact@'))
      .map((s) => s.with.name);
    assert.equal(new Set(names).size, names.length, `имена артефактов: ${names.join(', ')}`);
    assert.ok(!names.includes('playwright-report'), 'общее имя playwright-report у шардов');
  });

  it('итоговая e2e: прежнее имя, needs e2e-shard, не отменена — падает, если шарды не success', () => {
    const { wf } = load();
    const job = wf.jobs.e2e;
    assert.equal(job.name, E2E_NAME);
    assert.deepEqual([job.needs].flat(), ['e2e-shard']);
    assert.match(String(job.if), /!cancelled\(\)/);
    assert.ok(job['timeout-minutes'] <= 10);
    const text = job.steps.map((s) => `${JSON.stringify(s.env ?? {})}\n${s.run ?? ''}`).join('\n');
    assert.match(text, /needs\.e2e-shard\.result/);
    assert.match(text, /success/);
    assert.doesNotMatch(text, /pipeline\.mjs/);
  });
});

describe('package.json: локальный эквивалент', () => {
  it('ci:local, ci:job, test:ci; test вызывает test:ci', () => {
    const { scripts } = JSON.parse(read('package.json'));
    assert.equal(scripts['ci:local'], 'node tools/ci/pipeline.mjs --all');
    assert.equal(scripts['ci:job'], 'node tools/ci/pipeline.mjs --job');
    assert.equal(scripts['test:ci'], 'node --test "tools/ci/*.test.mjs"');
    assert.match(scripts.test, /pnpm run test:ci/);
  });

  it('W0.17: стенд одной командой, e2e-stand и плановые гейты (П-4, П-5)', () => {
    const { scripts } = JSON.parse(read('package.json'));
    assert.equal(scripts.stand, 'node deploy/compose/stand.mjs all');
    assert.equal(scripts['stand:down'], 'node deploy/compose/stand.mjs down -v');
    assert.equal(scripts['e2e:stand'], 'node tools/ci/e2e-stand.mjs');
    assert.equal(scripts['test:plan'], 'node --test "docs/plan/scripts/*.test.mjs"');
    assert.equal(scripts['test:adr'], 'node --test "docs/adr/*.test.mjs"');
    assert.equal(scripts['test:load'], 'node --test "backend/test/load/test/*.test.mjs"');
    assert.equal(scripts['check-k6'], 'node backend/test/load/check-k6.mjs');
    assert.equal(
      scripts['check-decisions'],
      'node docs/plan/scripts/renumber-decisions.mjs --check',
    );
    assert.equal(scripts['storybook:build'], 'pnpm --filter @ortus/ui run storybook:build');
    for (const s of ['test:plan', 'test:adr', 'test:load']) {
      assert.match(scripts.test, new RegExp(`pnpm run ${s}\\b`), `test без ${s}`);
    }
  });
});
