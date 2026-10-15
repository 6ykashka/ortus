// W0.06 · Стенд compose: env по слоту, .env.example по скелету, структура docker-compose.yml.
// Запуск: node --test deploy/compose/stand.test.mjs  (docker нужен только для блока «docker compose config»).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import * as stand from './stand.mjs';

// Через пространство имён: red-прогон W0.17 падает на утверждениях, а не на импорте.
const { PORTS, composeArgs, parseEnv, portsForSlot, renderEnv } = stand;
const SLOT_BASE = stand.SLOT_BASE ?? {};
const MAX_SLOT = stand.MAX_SLOT;
const missing = (name) => () => assert.fail(`stand.mjs не экспортирует ${name}`);
const servicesFor = stand.servicesFor ?? missing('servicesFor');
const plannedPorts = stand.plannedPorts ?? missing('plannedPorts');
const ownPorts = stand.ownPorts ?? missing('ownPorts');
const probePort = stand.probePort ?? missing('probePort');
const busyPortsMessage = stand.busyPortsMessage ?? missing('busyPortsMessage');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const COMPOSE = join(HERE, 'docker-compose.yml');
const EXAMPLE = join(HERE, '.env.example');
const SKELETON = join(ROOT, 'design', 'docs', 'repo-skeleton', '.env.example');
const STAND = join(HERE, 'stand.mjs');

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const example = read(EXAMPLE);

const tmp = mkdtempSync(join(tmpdir(), 'ortus-stand-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('порты по слоту (план §3.6: сдвиг 100 × slot)', () => {
  it('слот 0 — стандартные порты скелета', () => {
    assert.deepEqual(portsForSlot(0), {
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
  });

  it('слот 7 — +700 к базе слота; MinIO и OTLP — от своих баз (W0.17)', () => {
    const p = portsForSlot(7);
    for (const [k, base] of Object.entries(PORTS)) {
      assert.equal(p[k], (SLOT_BASE[k] ?? base) + 700, k);
    }
    assert.equal(p.POSTGRES_PORT, 6132);
    assert.equal(p.MINIO_PORT, 19700);
    assert.equal(p.MINIO_CONSOLE_PORT, 19701);
    assert.equal(p.OTEL_GRPC_PORT, 15017);
    assert.equal(p.OTEL_HTTP_PORT, 15018);
  });

  it('слот 10 — MinIO не на 10000 (П-6: порт занят на машине разработчика)', () => {
    assert.equal(portsForSlot(10).MINIO_PORT, 20000);
    assert.equal(portsForSlot(10).MINIO_CONSOLE_PORT, 20001);
  });

  it('слот вне 0…20 или не целый — ошибка', () => {
    assert.equal(MAX_SLOT, 20);
    for (const bad of [-1, 21, 1.5, Number.NaN]) assert.throws(() => portsForSlot(bad), /slot/);
  });

  it('порты слотов 0…20 не пересекаются между собой, с §3.6 и с занятыми 10000, 11001', () => {
    const reserved = new Set([4173, 4174, 10000, 11001]);
    for (let s = 1; s <= 20; s++)
      [5200, 6100, 7200, 8100, 4100].forEach((b) => reserved.add(b + s));
    const seen = new Map();
    for (let s = 0; s <= 20; s++) {
      for (const [k, port] of Object.entries(portsForSlot(s))) {
        assert.ok(!reserved.has(port), `слот ${s} ${k}=${port} занят`);
        assert.ok(!seen.has(port), `слот ${s} ${k}=${port} совпал с ${seen.get(port)}`);
        assert.ok(port > 1024 && port < 49152, `слот ${s} ${k}=${port} вне 1025…49151`);
        seen.set(port, `слот ${s} ${k}`);
      }
    }
  });
});

describe('проверка портов перед up (П-6)', () => {
  it('сервисы по умолчанию и по профилям; явный список сервисов важнее', () => {
    assert.deepEqual(servicesFor([], []), ['postgres', 'minio', 'mailpit', 'otel-collector']);
    assert.deepEqual(servicesFor(['test', 'keycloak'], []), [
      'postgres',
      'postgres-test',
      'minio',
      'mailpit',
      'otel-collector',
      'keycloak',
    ]);
    assert.deepEqual(servicesFor([], ['postgres']), ['postgres']);
  });

  it('plannedPorts — порты из env для выбранных сервисов', () => {
    const env = parseEnv(renderEnv(example, 18));
    assert.deepEqual(plannedPorts(env, ['postgres', 'minio']), [
      { key: 'POSTGRES_PORT', service: 'postgres', port: 7232 },
      { key: 'MINIO_PORT', service: 'minio', port: 20800 },
      { key: 'MINIO_CONSOLE_PORT', service: 'minio', port: 20801 },
    ]);
  });

  it('ownPorts — опубликованные порты своего проекта из docker compose ps (NDJSON и массив)', () => {
    const a = { Publishers: [{ PublishedPort: 7232 }, { PublishedPort: 0 }] };
    const b = { Publishers: [{ PublishedPort: 20800 }, { PublishedPort: 20801 }] };
    const nd = `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`;
    assert.deepEqual(
      [...ownPorts(nd)].sort((x, y) => x - y),
      [7232, 20800, 20801],
    );
    assert.deepEqual(
      [...ownPorts(JSON.stringify([a, b]))].sort((x, y) => x - y),
      [7232, 20800, 20801],
    );
    assert.deepEqual([...ownPorts('')], []);
  });

  it('probePort: занятый порт — false, свободный — true', async () => {
    const srv = createServer();
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    try {
      assert.equal(await probePort(port), false);
    } finally {
      await new Promise((r) => srv.close(r));
    }
    assert.equal(await probePort(port), true);
  });

  it('busyPortsMessage называет адрес, переменную, сервис, проект и как найти процесс', () => {
    const msg = busyPortsMessage('ortus-s10', [
      { key: 'MINIO_PORT', service: 'minio', port: 10000 },
    ]);
    assert.match(msg, /ortus-s10/);
    assert.match(msg, /127\.0\.0\.1:10000 +MINIO_PORT \(minio\)/);
    assert.match(msg, /init --slot <N> --force/);
    assert.match(msg, /Get-NetTCPConnection -State Listen -LocalPort 10000/);
  });
});

describe('.env.example', () => {
  it('первая строка — как в скелете', () => {
    assert.equal(
      example.split('\n')[0],
      '# Ортус · пример конфигурации локального стенда. Реальные секреты сюда не попадают.',
    );
  });

  it('все ключи скелета на месте и с теми же значениями', () => {
    const skel = parseEnv(read(SKELETON));
    const ours = parseEnv(example);
    assert.ok(Object.keys(skel).length >= 30, 'скелет прочитан');
    for (const [k, v] of Object.entries(skel)) assert.equal(ours[k], v, k);
  });

  it('объявлены переменные стенда, портов, ролей БД и приложения', () => {
    const ours = parseEnv(example);
    for (const k of [
      'COMPOSE_PROJECT_NAME',
      ...Object.keys(PORTS),
      'APP_ENV',
      'HTTP_ADDR',
      'AUTH_PROVIDER',
      'KC_ADMIN',
      'KC_ADMIN_PASS',
      'TEST_DB_URL',
      'PG_SUPER_URL',
      'MIGRATOR_DB_URL',
      'TENANT_DB_URL',
      'PG_MIGRATOR_PASS',
      'PG_API_PASS',
      'PG_WORKER_PASS',
      'PG_PROVISIONER_PASS',
    ]) {
      assert.ok(k in ours, `нет ${k}`);
    }
    assert.equal(ours.COMPOSE_PROJECT_NAME, 'ortus');
    assert.equal(ours.HTTP_ADDR, '127.0.0.1:8080');
    assert.match(ours.CONTROL_DB_URL, new RegExp(`^postgres://ortus_api:${ours.PG_API_PASS}@`));
    assert.match(
      ours.MIGRATOR_DB_URL,
      new RegExp(`^postgres://ortus_migrator:${ours.PG_MIGRATOR_PASS}@`),
    );
    // Секрет tenant_routing.secret_ref (env:TENANT_DB_URL): пул API открывает tenant DB ролью ortus_api, не мигратором.
    assert.match(
      ours.TENANT_DB_URL,
      new RegExp(`^postgres://ortus_api:${ours.PG_API_PASS}@localhost:5432/\\?`),
    );
  });

  it('у каждой переменной есть комментарий (в строке или строкой выше)', () => {
    const lines = example.split('\n');
    lines.forEach((line, i) => {
      if (!/^[A-Z][A-Z0-9_]*=/.test(line)) return;
      const inline = /\s#\s/.test(line);
      const above = i > 0 && /^#/.test(lines[i - 1]);
      assert.ok(inline || above, `без комментария: ${line}`);
    });
  });

  it('секреты — только заглушки', () => {
    const ours = parseEnv(example);
    for (const [k, v] of Object.entries(ours)) {
      if (/PASS|SECRET/.test(k)) assert.match(v, /^change-me(-local)?$/, k);
    }
  });
});

describe('renderEnv — .env для слота', () => {
  it('слот 0 — файл без изменений', () => {
    assert.equal(renderEnv(example, 0), example);
  });

  it('слот 7 — имя проекта, порты, адреса', () => {
    const e = parseEnv(renderEnv(example, 7));
    assert.equal(e.COMPOSE_PROJECT_NAME, 'ortus-s7');
    assert.equal(e.POSTGRES_PORT, '6132');
    assert.equal(e.SMTP_PORT, '1725');
    assert.equal(e.HTTP_ADDR, '127.0.0.1:8107');
    assert.equal(e.OIDC_REDIRECT_URL, 'http://localhost:5207/auth/callback');
    assert.equal(e.ALLOWED_ORIGINS, 'http://localhost:5207');
    assert.equal(e.TENANT_DB_HOST, 'localhost:6132');
    assert.match(e.CONTROL_DB_URL, /@localhost:6132\/ortus_control\?/);
    assert.match(e.MIGRATOR_DB_URL, /@localhost:6132\/ortus_control\?/);
    assert.match(e.PG_SUPER_URL, /@localhost:6132\/ortus_control\?/);
    assert.match(e.TENANT_DB_URL, /@localhost:6132\/\?/);
    assert.match(e.TEST_DB_URL, /@127\.0\.0\.1:6133\//);
    assert.equal(e.S3_ENDPOINT, 'http://localhost:19700');
    assert.equal(e.OIDC_ISSUER, 'http://localhost:8781/realms/ortus');
    assert.equal(e.OPERATOR_OIDC_ISSUER, 'http://localhost:8781/realms/ortus-operators');
    assert.equal(e.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://localhost:15017');
  });

  it('слот 18 — проект ortus-s18, порты по базам слота, приложение 8118/5218', () => {
    const e = parseEnv(renderEnv(example, 18));
    assert.equal(e.COMPOSE_PROJECT_NAME, 'ortus-s18');
    assert.equal(e.POSTGRES_PORT, '7232');
    assert.equal(e.MINIO_PORT, '20800');
    assert.equal(e.HTTP_ADDR, '127.0.0.1:8118');
    assert.equal(e.S3_ENDPOINT, 'http://localhost:20800');
    assert.equal(e.OIDC_REDIRECT_URL, 'http://localhost:5218/auth/callback');
    assert.equal(e.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://localhost:16117');
    assert.match(e.CONTROL_DB_URL, /@localhost:7232\/ortus_control\?/);
  });

  it('слот 7 — в адресах не осталось базовых портов', () => {
    const text = renderEnv(example, 7);
    for (const port of [...Object.values(PORTS), 5173, 8080]) {
      assert.doesNotMatch(text, new RegExp(`(localhost|127\\.0\\.0\\.1):${port}\\b`), String(port));
    }
  });
});

describe('composeArgs', () => {
  it('имя проекта из env, compose-файл и env-файл явно', () => {
    assert.deepEqual(composeArgs({ COMPOSE_PROJECT_NAME: 'ortus-s7' }, '.env', ['ps']), [
      'compose',
      '-p',
      'ortus-s7',
      '-f',
      join('deploy', 'compose', 'docker-compose.yml'),
      '--env-file',
      '.env',
      'ps',
    ]);
  });
});

describe('stand.mjs CLI', () => {
  it('без .env — код 2 и подсказка init --slot', () => {
    const r = spawnSync(process.execPath, [STAND, 'ps', '--env', join(tmp, 'nope.env')], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /stand\.mjs init --slot/);
  });

  it('init --slot 7 пишет .env без BOM и не перезаписывает без --force', () => {
    const f = join(tmp, 'slot7.env');
    const run = (...a) =>
      spawnSync(process.execPath, [STAND, 'init', '--slot', '7', '--env', f, ...a], {
        encoding: 'utf8',
      });
    assert.equal(run().status, 0);
    const buf = readFileSync(f);
    assert.notDeepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(parseEnv(buf.toString('utf8')).COMPOSE_PROJECT_NAME, 'ortus-s7');
    const again = run();
    assert.equal(again.status, 2);
    assert.match(again.stderr, /--force/);
    assert.equal(run('--force').status, 0);
  });

  it('init --slot 18 и 20 — допустимы; 21 — код 2', () => {
    const f = join(tmp, 'slot18.env');
    const run = (slot) =>
      spawnSync(process.execPath, [STAND, 'init', '--slot', slot, '--env', f, '--force'], {
        encoding: 'utf8',
      });
    assert.equal(run('18').status, 0);
    assert.equal(parseEnv(readFileSync(f, 'utf8')).COMPOSE_PROJECT_NAME, 'ortus-s18');
    assert.equal(run('20').status, 0);
    assert.equal(run('21').status, 2);
  });

  it('up: порт слота занят другим процессом — код 3 и понятная ошибка до docker compose up', async () => {
    const srv = createServer();
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    const f = join(tmp, 'busy.env');
    // Последнее значение ключа побеждает (parseEnv, как docker compose --env-file).
    writeFileSync(f, `${example}\nCOMPOSE_PROJECT_NAME=ortus-w017-probe\nPOSTGRES_PORT=${port}\n`);
    try {
      const r = await new Promise((resolveRun) => {
        const child = spawn(process.execPath, [STAND, 'up', 'postgres', '--env', f], {
          env: { ...process.env, ORTUS_SLOT: '' },
        });
        let stderr = '';
        child.stderr.on('data', (d) => (stderr += d));
        child.on('close', (status) => resolveRun({ status, stderr }));
      });
      assert.equal(r.status, 3, r.stderr);
      assert.match(r.stderr, new RegExp(`127\\.0\\.0\\.1:${port} +POSTGRES_PORT \\(postgres\\)`));
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });

  it('all без .env и без слота — код 2 и подсказка stand -- --slot', () => {
    const r = spawnSync(process.execPath, [STAND, 'all', '--env', join(tmp, 'none.env')], {
      encoding: 'utf8',
      env: { ...process.env, ORTUS_SLOT: '' },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--slot/);
  });

  it('all: .env другого слота без --force — код 2, файл не меняется', () => {
    const f = join(tmp, 'other.env');
    writeFileSync(f, renderEnv(example, 7));
    const r = spawnSync(process.execPath, [STAND, 'all', '--slot', '8', '--env', f], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /ortus-s7/);
    assert.match(r.stderr, /--force/);
    assert.equal(parseEnv(readFileSync(f, 'utf8')).COMPOSE_PROJECT_NAME, 'ortus-s7');
  });
});

const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
const hasDocker = docker.status === 0;

/** docker compose config --format json для env-файла и профилей. */
function config(envText, profiles = []) {
  const f = join(tmp, `cfg-${Math.random().toString(16).slice(2)}.env`);
  writeFileSync(f, envText);
  const args = ['compose', '-f', COMPOSE, '--env-file', f];
  for (const p of profiles) args.push('--profile', p);
  args.push('config', '--format', 'json');
  const r = spawnSync('docker', args, {
    encoding: 'utf8',
    env: { ...process.env, COMPOSE_PROFILES: '' },
  });
  return { status: r.status, stderr: r.stderr, json: r.status === 0 ? JSON.parse(r.stdout) : null };
}

describe(
  'docker-compose.yml (docker compose config)',
  { skip: !hasDocker && 'docker не найден' },
  () => {
    const ALL = ['test', 'keycloak', 'init'];

    it('без профилей — postgres, minio, mailpit, otel-collector', () => {
      const c = config(example);
      assert.equal(c.status, 0, c.stderr);
      assert.deepEqual(Object.keys(c.json.services).sort(), [
        'mailpit',
        'minio',
        'otel-collector',
        'postgres',
      ]);
    });

    it('профили добавляют ровно postgres-test, keycloak, minio-init', () => {
      for (const [p, svc] of [
        ['test', 'postgres-test'],
        ['keycloak', 'keycloak'],
        ['init', 'minio-init'],
      ]) {
        const c = config(example, [p]);
        assert.equal(c.status, 0, c.stderr);
        assert.deepEqual(
          Object.keys(c.json.services).sort(),
          ['mailpit', 'minio', 'otel-collector', 'postgres', svc].sort(),
          p,
        );
      }
    });

    it('все опубликованные порты — на 127.0.0.1, слот 0 — стандартные', () => {
      const c = config(example, ALL);
      const published = [];
      for (const s of Object.values(c.json.services)) {
        for (const p of s.ports ?? []) {
          assert.equal(p.host_ip, '127.0.0.1');
          published.push(Number(p.published));
        }
      }
      assert.deepEqual(
        published.sort((a, b) => a - b),
        Object.values(PORTS).sort((a, b) => a - b),
      );
    });

    it('слот 7 — порты сдвинуты на 700, имя проекта ortus-s7', () => {
      const c = config(renderEnv(example, 7), ALL);
      assert.equal(c.status, 0, c.stderr);
      assert.equal(c.json.name, 'ortus-s7');
      const published = Object.values(c.json.services).flatMap((s) =>
        (s.ports ?? []).map((p) => Number(p.published)),
      );
      assert.deepEqual(
        published.sort((a, b) => a - b),
        Object.values(portsForSlot(7)).sort((a, b) => a - b),
      );
    });

    it('карта сервисов stand.mjs (проверка портов) совпадает с compose: сервисы, профили, порты', () => {
      const env = parseEnv(renderEnv(example, 18));
      const c = config(renderEnv(example, 18), ALL);
      assert.equal(c.status, 0, c.stderr);
      const names = Object.keys(c.json.services).sort();
      assert.deepEqual(servicesFor(ALL, []).sort(), names);
      for (const name of names) {
        const s = c.json.services[name];
        const published = (s.ports ?? []).map((p) => Number(p.published)).sort((a, b) => a - b);
        const planned = plannedPorts(env, [name])
          .map((p) => p.port)
          .sort((a, b) => a - b);
        assert.deepEqual(planned, published, name);
      }
      assert.deepEqual(
        servicesFor([], []).sort(),
        Object.keys(config(example).json.services).sort(),
      );
    });

    it('каждый образ — тег и digest; postgres-test на том же образе, что postgres', () => {
      const c = config(example, ALL);
      for (const [name, s] of Object.entries(c.json.services)) {
        assert.match(s.image, /^[^@\s]+:[^@\s:]+@sha256:[0-9a-f]{64}$/, name);
        assert.doesNotMatch(s.image, /:latest@/, name);
      }
      assert.match(c.json.services.postgres.image, /^postgres:17\.\d+@sha256:/);
      assert.equal(c.json.services['postgres-test'].image, c.json.services.postgres.image);
    });

    it('healthcheck у postgres, postgres-test, minio, mailpit, keycloak', () => {
      const c = config(example, ALL);
      for (const name of ['postgres', 'postgres-test', 'minio', 'mailpit', 'keycloak']) {
        assert.ok(c.json.services[name].healthcheck?.test?.length, name);
      }
    });

    it('postgres-test: tmpfs и fsync=off; minio-init одноразовый; keycloak — импорт realm только чтение', () => {
      const c = config(example, ALL);
      const t = c.json.services['postgres-test'];
      assert.deepEqual(t.profiles, ['test']);
      assert.ok((t.tmpfs ?? []).some((x) => x.startsWith('/var/lib/postgresql/data')));
      assert.match(t.command.join(' '), /fsync=off/);
      const init = c.json.services['minio-init'];
      assert.deepEqual(init.profiles, ['init']);
      assert.equal(init.restart, 'no');
      assert.equal(init.depends_on.minio.condition, 'service_healthy');
      const kc = c.json.services.keycloak;
      assert.deepEqual(kc.profiles, ['keycloak']);
      assert.equal(kc.volumes[0].target, '/opt/keycloak/data/import');
      assert.equal(kc.volumes[0].read_only, true);
    });

    it('без секретов — отказ «required variable … is missing a value»', () => {
      const noSecrets = example
        .split('\n')
        .filter((l) => !/^(PG_SUPERUSER|PG_SUPERPASS)=/.test(l))
        .join('\n');
      const c = config(noSecrets);
      assert.notEqual(c.status, 0);
      assert.match(c.stderr, /required variable PG_SUPER(USER|PASS) is missing a value/);
    });
  },
);
