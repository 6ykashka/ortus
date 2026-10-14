// W0.04 · Нумерация миграций: уникальны, без дыр, в блоках этапов (план v2 §3.5, PD-59).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importIfExists, read, runNode, tempTree } from './_util.mjs';

const SCRIPT = 'tools/ci/check-migrations.mjs';
const mod = await importIfExists(SCRIPT);

function need() {
  assert.ok(mod, `${SCRIPT} ещё не существует`);
  return mod;
}

const V02 = {
  control: ['0001_init.sql', '0002_billing.sql', '0003_branding.sql'],
  tenant: ['0001_core.sql', '0002_fleet.sql'],
};

describe('checkMigrations: нумерация миграций', () => {
  it('базовые миграции v0.2 (control 0001–0003, tenant 0001–0002) проходят', () => {
    const r = need().checkMigrations(V02);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.counts, { control: 3, tenant: 2 });
  });

  it('пустые каталоги — не ошибка', () => {
    assert.deepEqual(need().checkMigrations({ control: [], tenant: [] }).errors, []);
  });

  it('повтор номера в одной БД — ошибка с именами обоих файлов', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '0003_a.sql', '0003_b.sql'],
    });
    assert.deepEqual(r.errors, ['tenant: номер 0003 повторяется: 0003_a.sql, 0003_b.sql']);
  });

  it('одинаковый номер в control и tenant — не повтор (разные БД)', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '0003_x.sql'],
    });
    assert.deepEqual(r.errors, []);
  });

  it('дыра внутри блока этапа — ошибка', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '0003_a.sql', '0005_c.sql'],
    });
    assert.deepEqual(r.errors, ['tenant: дыра — нет 0004 (блок этапа 1: 0003–0009)']);
  });

  it('незанятый хвост блока этапа 1 и начало блока этапа 2 — не дыра', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '0003_a.sql', '0004_b.sql', '0010_fleet_defects.sql'],
    });
    assert.deepEqual(r.errors, []);
  });

  it('пустой ранний блок при занятом позднем — ошибка', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '0010_fleet_defects.sql'],
    });
    assert.deepEqual(r.errors, [
      'tenant: блок этапа 1 (0003–0009) пуст, а занят блок этапа 2 (0010–0019)',
    ]);
  });

  it('пропущенная 0001 — дыра в блоке этапа 0', () => {
    const r = need().checkMigrations({ control: V02.control, tenant: ['0002_fleet.sql'] });
    assert.deepEqual(r.errors, ['tenant: дыра — нет 0001 (блок этапа 0: 0001–0002)']);
  });

  it('номер вне блоков этапов — ошибка', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '0075_x.sql'],
    });
    assert.ok(
      r.errors.includes('tenant: 0075_x.sql вне блоков этапов (план §3.5)'),
      r.errors.join('\n'),
    );
  });

  it('номер 0000 — вне блоков', () => {
    const r = need().checkMigrations({
      control: ['0000_x.sql', ...V02.control],
      tenant: V02.tenant,
    });
    assert.deepEqual(r.errors, ['control: 0000_x.sql вне блоков этапов (план §3.5)']);
  });

  it('control после 0003 — открытый блок, номера подряд', () => {
    const ok = need().checkMigrations({
      control: [...V02.control, '0004_x.sql', '0005_y.sql'],
      tenant: [],
    });
    assert.deepEqual(ok.errors, []);
    const hole = need().checkMigrations({ control: [...V02.control, '0005_y.sql'], tenant: [] });
    assert.deepEqual(hole.errors, ['control: дыра — нет 0004 (блок этапа 1+: 0004–9999)']);
  });

  it('имя не по шаблону NNNN_<slug>.sql — ошибка', () => {
    const r = need().checkMigrations({
      control: V02.control,
      tenant: [...V02.tenant, '3_x.sql', '0003-X.sql', '0003_Core.sql'],
    });
    assert.deepEqual(r.errors, [
      'tenant/3_x.sql: имя не по шаблону NNNN_<slug>.sql',
      'tenant/0003-X.sql: имя не по шаблону NNNN_<slug>.sql',
      'tenant/0003_Core.sql: имя не по шаблону NNNN_<slug>.sql',
    ]);
  });
});

describe('listMigrations: что считается миграцией', () => {
  it('берёт только *.sql верхнего уровня: drafts/, embed.go, README.md не считаются', () => {
    const t = tempTree({
      'tenant/0001_core.sql': '-- +goose Up',
      'tenant/0002_fleet.sql': '-- +goose Up',
      'tenant/drafts/notifications.sql': '-- draft',
      'tenant/embed.go': 'package tenant',
      'tenant/README.md': '#',
    });
    try {
      assert.deepEqual(need().listMigrations(`${t.root}/tenant`), [
        '0001_core.sql',
        '0002_fleet.sql',
      ]);
      assert.deepEqual(need().listMigrations(`${t.root}/control`), []);
    } finally {
      t.cleanup();
    }
  });
});

describe('check-migrations CLI', () => {
  it('нет backend/migrations — пропуск, exit 0', () => {
    const t = tempTree({ 'README.md': '#' });
    try {
      const r = runNode(SCRIPT, ['--root', t.root]);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /migrations: нет backend\/migrations — пропуск/);
    } finally {
      t.cleanup();
    }
  });

  it('корректное дерево — exit 0 и сводка', () => {
    const t = tempTree({
      'backend/migrations/control/0001_init.sql': '',
      'backend/migrations/control/0002_billing.sql': '',
      'backend/migrations/control/0003_branding.sql': '',
      'backend/migrations/tenant/0001_core.sql': '',
      'backend/migrations/tenant/0002_fleet.sql': '',
    });
    try {
      const r = runNode(SCRIPT, ['--root', t.root]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /migrations: control 3, tenant 2 — ок/);
    } finally {
      t.cleanup();
    }
  });

  it('дыра — exit 1 и сообщение в stderr', () => {
    const t = tempTree({
      'backend/migrations/tenant/0001_core.sql': '',
      'backend/migrations/tenant/0002_fleet.sql': '',
      'backend/migrations/tenant/0003_x.sql': '',
      'backend/migrations/tenant/0005_y.sql': '',
    });
    try {
      const r = runNode(SCRIPT, ['--root', t.root]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /tenant: дыра — нет 0004 \(блок этапа 1: 0003–0009\)/);
    } finally {
      t.cleanup();
    }
  });
});

describe('блоки этапов совпадают с планом', () => {
  it('TENANT_BLOCKS этапов 1–7 = строка «Резерв блоков» §3.5 плана v2', () => {
    const line = read('docs/plan/v2/00-parallel-plan.md')
      .split('\n')
      .find((l) => l.includes('Резерв блоков'));
    assert.ok(line, 'в плане нет строки «Резерв блоков»');
    const fromPlan = [...line.matchAll(/этап (\d+): (\d{4})–(\d{4})/g)].map((m) => ({
      stage: Number(m[1]),
      from: Number(m[2]),
      to: Number(m[3]),
    }));
    assert.ok(fromPlan.length >= 6, line);
    const ours = need().TENANT_BLOCKS.filter((b) => b.stage !== 0);
    assert.deepEqual(ours, fromPlan);
  });
});
