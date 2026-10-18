// Проверка сценариев k6 без стенда (W0.16 → W2.47): k6 inspect всех стадий и smoke-прогон против API-двойника.
// Запуск из корня: node backend/test/load/check-k6.mjs [--inspect-only]
// Коды выхода: 0 — всё прошло; 1 — провал проверки; 2 — нет Docker.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
  FLOWS,
  K6_IMAGE,
  STAGE_NAMES,
  buildOptions,
  paramValues,
  personasFor,
  requestsForPlanning,
  requestsPerManagerIteration,
  requestsPerShift,
  tripsPerDriver,
} from './lib/model.js';
import { startFakeApi } from './test/fake-api.mjs';

export { K6_IMAGE };
const SLOT = 8; // план §8: двойник W0.16 — слот 8, API исполнителя 8100 + слот
const PORT = Number(process.env.FAKE_API_PORT ?? 8100 + SLOT);

const here = dirname(fileURLToPath(import.meta.url));
const profile = JSON.parse(readFileSync(join(here, 'profile.json'), 'utf8'));
const failures = [];

function docker(args, { quiet = false } = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!quiet && r.stderr) process.stderr.write(tail(r.stderr, 60));
  return r;
}

function tail(text, lines) {
  return text.split('\n').slice(-lines).join('\n');
}

function expect(cond, message) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${message}`);
  if (!cond) failures.push(message);
}

const mount = ['-v', `${here}:/scripts:ro`];

function inspect(stage) {
  const r = docker(
    // Переменные — флагом k6 -e: inspect не видит окружение контейнера.
    ['run', '--rm', ...mount, K6_IMAGE, 'inspect', '-e', `LOAD_STAGE=${stage}`, '/scripts/main.js'],
    { quiet: true },
  );
  if (r.status !== 0) {
    expect(false, `k6 inspect ${stage}: exit ${r.status}\n${tail(r.stderr || r.stdout, 30)}`);
    return;
  }
  const got = JSON.parse(r.stdout);
  const want = buildOptions(profile, stage);
  expect(
    isDeepStrictEqual(Object.keys(got.scenarios ?? {}).sort(), Object.keys(want.scenarios).sort()),
    `k6 inspect ${stage}: сценарии ${Object.keys(got.scenarios ?? {}).join(', ')}`,
  );
  for (const [name, s] of Object.entries(want.scenarios)) {
    const g = got.scenarios?.[name] ?? {};
    const keys = ['executor', 'exec', 'vus', 'iterations', 'rate', 'preAllocatedVUs', 'maxVUs'];
    const same = keys.every((k) => s[k] === undefined || g[k] === s[k]);
    expect(same, `k6 inspect ${stage}: ${name} = ${s.executor}, exec ${s.exec}`);
  }
  expect(
    isDeepStrictEqual(
      Object.keys(got.thresholds ?? {}).sort(),
      Object.keys(want.thresholds).sort(),
    ),
    `k6 inspect ${stage}: пороги ${Object.keys(got.thresholds ?? {}).length}`,
  );
}

/** Dev-вход только local и compose (PD-18, Q-102): init k6 обязан упасть на адресе stage. */
function refuseRemoteDevLogin() {
  const r = docker(
    [
      'run',
      '--rm',
      ...mount,
      K6_IMAGE,
      'inspect',
      '-e',
      'LOAD_STAGE=pilot',
      '-e',
      'BASE_URL=https://stage.example',
      '/scripts/main.js',
    ],
    { quiet: true },
  );
  const out = `${r.stdout}\n${r.stderr}`;
  expect(
    r.status !== 0 && out.includes('dev-вход'),
    `dev-вход на BASE_URL=https://stage.example отклонён в init: exit ${r.status}`,
  );
}

function sameCounts(actual = {}, expected, label) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  const diff = [...keys].filter((k) => (actual[k] ?? 0) !== (expected[k] ?? 0));
  expect(
    diff.length === 0,
    `${label}: запросы по операциям совпадают с моделью` +
      (diff.length
        ? ` — расхождение ${diff.map((k) => `${k}: ${actual[k] ?? 0} ≠ ${expected[k] ?? 0}`)}`
        : ''),
  );
}

const times = (byOp, n) => Object.fromEntries(Object.entries(byOp).map(([k, c]) => [k, c * n]));

async function smoke() {
  // Сводка — во временном каталоге вне репозитория (prettier --check не видит вложенный .gitignore).
  const resultsDir = mkdtempSync(join(tmpdir(), 'ortus-k6-'));
  // mkdtemp создаёт 0700, а k6 в контейнере работает не от uid раннера: на Linux без этого сводка не пишется.
  chmodSync(resultsDir, 0o777);
  const iterations = profile.stages.smoke.iterations;
  const personas = personasFor(profile, 'smoke');
  // По смене на приёмке на каждую итерацию менеджера; водители — участники для планирования в setup().
  const api = await startFakeApi({
    port: PORT,
    pendingTrips: iterations,
    drivers: personas.drivers,
  });
  try {
    const r = await new Promise((resolve) => {
      const args = [
        'run',
        '--rm',
        '--add-host=host.docker.internal:host-gateway',
        ...mount,
        '-v',
        `${resultsDir}:/results`,
        K6_IMAGE,
        'run',
        '-e',
        'LOAD_STAGE=smoke',
        '-e',
        `BASE_URL=http://host.docker.internal:${PORT}`,
        '--quiet',
        '--summary-export',
        '/results/smoke-summary.json',
        '/scripts/main.js',
      ];
      // spawnSync заблокировал бы цикл событий, а двойник живёт в этом же процессе.
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (status) => resolve({ status, out }));
    });
    console.log(tail(r.out, 60));
    expect(r.status === 0, `k6 run smoke: exit ${r.status} (99 — провал порогов)`);

    let summary = {};
    try {
      summary = JSON.parse(readFileSync(join(resultsDir, 'smoke-summary.json'), 'utf8'));
    } catch (err) {
      expect(false, `сводка smoke-summary.json не прочитана: ${err.code ?? err.message}`);
    }
    const checks = summary.metrics?.checks ?? {};
    expect(
      checks.fails === 0 && checks.passes > 0,
      `checks: ${checks.passes} прошло, ${checks.fails} провалено`,
    );
    // Rate http_req_failed по всем тенантам: шумный в пороги не входит, но его 401 тоже ловим.
    const failed = summary.metrics?.http_req_failed ?? {};
    expect(
      failed.value === 0,
      `http_req_failed (пилот и шумный): ${failed.passes} неуспешных из ${(failed.passes ?? 0) + (failed.fails ?? 0)}`,
    );

    // Объём: каждая итерация каждого сценария дошла до конца, ни одна не прервана молча; каждая приёмка прошла.
    for (const flow of FLOWS) {
      const done = summary.metrics?.[`flow_completed{flow:${flow}}`]?.count;
      expect(done === iterations, `flow_completed{flow:${flow}}: ${done} из ${iterations}`);
    }
    const aborted = summary.metrics?.flow_aborted?.count ?? 0;
    expect(aborted === 0, `flow_aborted: ${aborted}`);
    const reviewed = summary.metrics?.trips_reviewed?.count;
    expect(reviewed === iterations, `trips_reviewed: ${reviewed} из ${iterations}`);

    const stats = api.state.stats;
    const v = paramValues(profile, 'smoke');
    const planning = requestsForPlanning({
      drivers: personas.drivers.length,
      tripsPerDriver: tripsPerDriver(profile, 'smoke'),
    });
    sameCounts(
      stats[personas.planner],
      { ...planning.byOp, auth: planning.auth },
      `setup() (${personas.planner}): планирование рейсов`,
    );
    // Каждый сценарий — iterations итераций на одном VU: сессия обязана пережить итерацию.
    const shift = requestsPerShift(profile, 'smoke');
    for (const persona of personas.drivers) {
      sameCounts(
        stats[persona],
        { ...shift.byOp, auth: shift.auth, transfer: shift.transfer },
        `driverShift (${persona})`,
      );
    }
    const mgr = requestsPerManagerIteration(profile, 'smoke', { review: true });
    sameCounts(
      stats[personas.managers[0]],
      {
        ...times(mgr.byOp, iterations),
        getMyContext: 1,
        auth: 1,
        transfer: mgr.transfer * iterations,
      },
      `managerShift (${personas.managers[0]}, ${iterations} итерации с приёмкой, вход один раз)`,
    );
    sameCounts(
      stats[personas.noisy],
      {
        auth: 2, // по входу на VU сценариев noisyExport и noisyUploads
        getMyContext: 2,
        listTripPlans: iterations * v.noisyExportPages + 1, // выгрузка + владелец фото один раз на VU
        initiateUpload: iterations,
        transfer: iterations,
        completeUpload: iterations,
      },
      `noisyExport + noisyUploads (${personas.noisy}, ${iterations} итерации)`,
    );
  } finally {
    await api.close();
    rmSync(resultsDir, { recursive: true, force: true });
  }
}

const version = docker(['version', '--format', '{{.Server.Version}}'], { quiet: true });
if (version.status !== 0) {
  console.error('Docker недоступен: k6 запускается только из образа', K6_IMAGE);
  process.exit(2);
}
console.log(`Docker ${version.stdout.trim()}, образ ${K6_IMAGE}`);
for (const stage of STAGE_NAMES) inspect(stage);
refuseRemoteDevLogin();
if (!process.argv.includes('--inspect-only')) await smoke();

if (failures.length) {
  console.error(`\nПровалено проверок: ${failures.length}`);
  process.exit(1);
}
console.log('\nВсе проверки k6 прошли');
