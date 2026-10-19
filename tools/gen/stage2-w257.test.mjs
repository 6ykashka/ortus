// W2.57 · Стюард контрактной дельты 0.6.2-stage2: временный водитель «только рейс» — решение владельца продукта
// Q-W2.07-1 от 18.10 (уточнение S2-14; AUTH-07, 08-domain-scenarios §4.6 п. 5–8, 02-architecture §7 п. 5, D09; приёмка
// AC-06). Системная узкая роль «Временный водитель» (role_templates.temporary_driver), продление временного назначения
// решением extend, просрочка и машина рейса в TemporaryDriverGrant, описания запроса, решения и назначения — «только
// рейс, кроме продолжения начатого рейса (D09)» (Q-W2.07-18, Q-W2.51-15). Новых операций, ключей прав, кодов ошибок,
// тегов и значений x-scope нет. Бриф docs/plan/v2/ws/W2.57.md §2.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { operationsById } from './lib/inventory.mjs';
import { abs, ERRORS_PATH, SOURCE_0_1 } from './lib/paths.mjs';
import { flattenActions, loadCatalog } from './lib/permissions.mjs';
import { parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const ops = operationsById(doc);
const op = (id) => ops.get(id)?.op;
const schemas = doc.components.schemas;
const src = source.components.schemas;
const name = (ref) => ref?.split('/').pop();
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const was = (id) => {
  const o = ops.get(id);
  return source.paths[o.path][o.method].description;
};
const w257 = loadDeltas().filter((d) => /W2\.57/.test(d.source));

/** Состав роли «Временный водитель» — решение Q-W2.07-1 (бриф W2.57 §2 п. 1). */
const TEMPORARY = [
  'files.read',
  'files.upload',
  'fleet.vehicles.read',
  'fleet.reservations.read',
  'fleet.inspections.read',
  'fleet.inspections.submit',
  'fleet.trips.read',
  'fleet.trips.start',
  'fleet.trips.return',
  'fleet.routes.read',
  'fleet.expenses.read',
  'fleet.expenses.create',
];

/** Шаблон «Водитель» 11 не меняется: узкая роль — отдельная системная. */
const DRIVER = [
  'files.read',
  'files.upload',
  'tasks.read',
  'knowledge.read',
  'calendar.availability.read',
  'fleet.vehicles.read',
  'fleet.reservations.read',
  'fleet.reservations.create',
  'fleet.inspections.read',
  'fleet.inspections.submit',
  'fleet.trips.read',
  'fleet.trips.start',
  'fleet.trips.return',
  'fleet.routes.read',
  'fleet.expenses.read',
  'fleet.expenses.create',
];

describe('контракт 0.6.2-stage2 (W2.57): роль «Временный водитель»', () => {
  const catalog = loadCatalog();
  const t = catalog.role_templates.temporary_driver;

  it('системная, функция «Водитель», область self, не назначается вручную — только переводом', () => {
    assert.ok(t, 'role_templates.temporary_driver');
    assert.equal(t.label, 'Временный водитель');
    assert.equal(t.kind, 'system');
    assert.equal(t.default_scope, 'self');
    assert.equal(t.work_function, 'driver');
    assert.match(t.note ?? '', /decideDriverTransfer/);
    assert.match(t.note ?? '', /source = 'transfer'|source transfer/);
  });

  it('состав: рейсы, осмотры, расходы, маршруты, брони — чтение, файлы рейса; машина — в области resource', () => {
    assert.deepEqual([...t.actions].sort(), [...TEMPORARY].sort());
    assert.deepEqual(t.resource_actions, ['fleet.vehicles.read']);
    const actions = flattenActions(catalog);
    for (const k of t.actions) assert.ok(actions.has(k), k);
    // Области каталога допускают назначение: self — у всех действий, кроме машины; машина — resource.
    for (const k of t.actions.filter((x) => !t.resource_actions.includes(x))) {
      assert.ok(actions.get(k).scopes.includes('self'), `${k}: self`);
    }
    assert.ok(actions.get('fleet.vehicles.read').scopes.includes('resource'));
  });

  it('без задач, базы знаний, календаря, начислений, создания и снятия броней', () => {
    const banned = t.actions.filter(
      (k) =>
        /^(tasks|knowledge|calendar)\./.test(k) ||
        k.startsWith('fleet.earnings.') ||
        k === 'fleet.reservations.create' ||
        k === 'fleet.reservations.manage',
    );
    assert.deepEqual(banned, []);
    assert.equal(t.optional_restricted, undefined);
  });

  it('шаблон «Водитель» 11 не меняется; новых ключей прав и кодов ошибок нет', () => {
    assert.deepEqual(catalog.role_templates.driver.actions, DRIVER);
    assert.equal(catalog.role_templates.driver.default_scope, 'self');
    assert.equal(flattenActions(catalog).size, 123);
    assert.equal(Object.keys(readYaml(ERRORS_PATH).codes).length, 52);
  });
});

describe('контракт 0.6.2-stage2 (W2.57): продление и описания «только рейс»', () => {
  it('DriverTransferDecision: решение extend с новым концом окна (endsAt), значения 0.1 сохранены', () => {
    const d = schemas.DriverTransferDecision;
    assert.deepEqual(d.properties.decision.enum, [
      ...src.DriverTransferDecision.properties.decision.enum,
      'extend',
    ]);
    assert.equal(name(d.properties.endsAt?.$ref), 'Instant');
    assert.match(d.properties.endsAt.description, /extend/);
    assert.match(d.properties.endsAt.description, /422 validation_failed/);
    assert.deepEqual(d.required, src.DriverTransferDecision.required, 'required 0.1');
    assert.ok(d.description.startsWith(src.DriverTransferDecision.description), 'текст 0.1');
    assert.match(d.description, /extend/);
  });

  it('decideDriverTransfer: продление — тем же порядком проверок, что одобрение, правом фирмы-источника', () => {
    const d = op('decideDriverTransfer').description;
    assert.ok(d.startsWith(was('decideDriverTransfer')), 'текст 0.1');
    for (const w of [
      'extend',
      'endsAt',
      'fleet.driver_transfers.approve',
      'outside_free_window',
      'Окно уже прошло.',
      'resources_unavailable',
      'If-Match',
      'closing',
    ]) {
      assert.ok(d.includes(w), `decideDriverTransfer: ${w}`);
    }
    // Правила W2.51 на месте.
    for (const w of ['409 invalid_transition', 'already has a driver', 'resources_unavailable']) {
      assert.ok(d.includes(w), `decideDriverTransfer (W2.51): ${w}`);
    }
    assert.match(d, /serializ/i);
    assert.match(d, /temporary_driver|«Временный водитель»/);
  });

  it('requestDriverTransfer: назначение — только рейс и его машина в окне, кроме продолжения начатого рейса (D09)', () => {
    const d = op('requestDriverTransfer').description;
    assert.ok(d.startsWith(was('requestDriverTransfer')), 'текст 0.1');
    assert.match(d, /except the continuation of a started trip \(D09\)/);
    assert.doesNotMatch(d, /never exceeds the trip of targetOrgUnitId and window\.$/);
    assert.match(schemas.DriverTransferCreate.properties.tripId.description, /only/);
  });

  it('TemporaryDriverGrant: роль temporary_driver в области self, машина рейса, просрочка, продолжение по D09', () => {
    const g = schemas.TemporaryDriverGrant;
    assert.deepEqual(g.required, ['assignmentId', 'orgUnitId', 'validFrom', 'validUntil', 'state']);
    assert.deepEqual(g.properties.state.enum, ['scheduled', 'active', 'closing', 'ended']);
    assert.equal(g.properties.overdue?.type, 'boolean');
    assert.match(g.properties.overdue.description, /not handed over/);
    assert.equal(name(g.properties.vehicleId?.$ref), 'Id');
    assert.match(g.properties.vehicleId.description, /resource/);
    assert.match(g.properties.assignmentId.description, /temporary_driver/);
    assert.match(g.properties.assignmentId.description, /self/);
    assert.match(g.properties.tripId.description, /D09/);
    assert.match(g.properties.validUntil.description, /extend/);
    const state = g.properties.state.description;
    for (const w of [
      'revoked',
      'on_route',
      'submitted',
      'rework',
      'accepted or cancelled',
      'D09',
    ]) {
      assert.ok(state.includes(w), `TemporaryDriverGrant.state: ${w}`);
    }
    assert.match(g.description, /«Временный водитель»/);
    assert.match(g.description, /tasks/);
  });

  it('DriverTransfer.status: отзыв начатого рейса оставляет продолжение, продление — решение extend', () => {
    const s = schemas.DriverTransfer.properties.status.description;
    for (const w of [
      'completed',
      'expired',
      'closing',
      'AC-06',
      'D09',
      'AUTH-07',
      'accepted or cancelled',
      'rework',
      'extend',
      'taken off',
    ]) {
      assert.ok(s.includes(w), `DriverTransfer.status: ${w}`);
    }
  });
});

describe('контракт 0.6.2-stage2 (W2.57): аддитивность, примеры, журнал, миграция, версия', () => {
  it('дельты W2.57: endsAt — add; перечисление решения — надмножество; описания — с текстом 0.1 в начале', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const pointers = new Set(w257.map((d) => d.pointer));
    const base = '/components/schemas/DriverTransferDecision';
    for (const p of [
      `${base}/properties/decision/enum`,
      `${base}/properties/endsAt`,
      `${base}/description`,
    ]) {
      assert.ok(pointers.has(p), `дельта ${p}`);
    }
    for (const d of w257.filter((x) => x.kind === 'change' && x.pointer !== '/info/version')) {
      const before = at(source, d.pointer);
      const now = at(doc, d.pointer);
      if (d.pointer.endsWith('/enum')) {
        assert.ok(
          before.every((v) => now.includes(v)) && now.length > before.length,
          `${d.pointer}: не надмножество`,
        );
      } else {
        assert.match(d.pointer, /\/description$/, `${d.pointer}: change не по описанию`);
        assert.ok(
          typeof before === 'string' && now.startsWith(before) && now.length > before.length,
          `${d.pointer}: описание 0.1 не сохранено в начале`,
        );
      }
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W2\.57/);
  });

  it('примеры валидны; продление — пример успеха решения', () => {
    const examples = loadExamples();
    assert.deepEqual(checkExamples(doc, examples), []);
    const extended = examples.get('decideDriverTransfer')?.get('extended');
    assert.ok(extended, 'decideDriverTransfer/extended');
    assert.equal(extended.status, 'approved');
    assert.ok(
      extended.window.endsAt > examples.get('decideDriverTransfer').get('ok').window.endsAt,
    );
    assert.equal(extended.grant.validUntil, extended.window.endsAt);
  });

  it('журнал api/CHANGELOG.md и api/README.md: раздел 0.6.2-stage2, миграция tenant 0018 выдана W2.57', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.6\.2-stage2 — W2\.57/m);
    assert.ok(
      log.indexOf('## 0.6.2-stage2') < log.indexOf('## 0.6.1-stage2'),
      'новый раздел — сверху',
    );
    assert.match(log, /Q-W2\.07-1/);
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(readme, /## Этап 2, W2\.57 \(`0\.6\.2-stage2`\)/);
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0018\s*\|\s*`0018_fleet_driver_transfer_vehicle_grant\.sql`[^|]*\|\s*W2\.57/,
    );
    assert.match(readme, /\|\s*tenant\s*\|\s*0019\s*\|/);
  });

  it('версия контракта — 0.6.2-stage2', () => {
    assert.equal(doc.info.version, '0.6.2-stage2');
  });
});
