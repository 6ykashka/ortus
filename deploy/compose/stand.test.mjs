// W0.06 · Стенд compose: env по слоту, .env.example по скелету, структура docker-compose.yml.
// Запуск: node --test deploy/compose/stand.test.mjs  (docker нужен только для блока «docker compose config»).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PORTS, composeArgs, parseEnv, portsForSlot, renderEnv } from './stand.mjs';

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

  it('слот 7 — +700 к каждому порту', () => {
    const p = portsForSlot(7);
    for (const [k, base] of Object.entries(PORTS)) assert.equal(p[k], base + 700, k);
  });

  it('слот вне 0…10 или не целый — ошибка', () => {
    for (const bad of [-1, 11, 1.5, Number.NaN]) assert.throws(() => portsForSlot(bad), /slot/);
  });

  it('порты слотов 1…10 не пересекаются со слотами-соседями и с портами §3.6', () => {
    const reserved = new Set();
    for (let s = 1; s <= 10; s++)
      [5200, 6100, 7200, 8100, 4100].forEach((b) => reserved.add(b + s));
    reserved.add(4173).add(4174);
    const seen = new Map();
    for (let s = 0; s <= 10; s++) {
      for (const [k, port] of Object.entries(portsForSlot(s))) {
        assert.ok(!reserved.has(port), `слот ${s} ${k}=${port} занят §3.6`);
        assert.ok(!seen.has(port), `слот ${s} ${k}=${port} совпал с ${seen.get(port)}`);
        seen.set(port, `слот ${s} ${k}`);
      }
    }
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
    assert.equal(e.S3_ENDPOINT, 'http://localhost:9700');
    assert.equal(e.OIDC_ISSUER, 'http://localhost:8781/realms/ortus');
    assert.equal(e.OPERATOR_OIDC_ISSUER, 'http://localhost:8781/realms/ortus-operators');
    assert.equal(e.OTEL_EXPORTER_OTLP_ENDPOINT, 'http://localhost:5017');
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
