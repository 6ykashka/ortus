// W2.40 · Контракт этапа 2 для показа 18.10 (0.5.1-stage2), только добавления: категории расходов по ответу
// владельца продукта 17.10 на D-12 комплекта (шесть кодов, у «прочее» комментарий обязателен) и юрлицо рейса
// (TripPlan.legalEntityId — nullable, только чтение; tenant 0013). Бриф docs/plan/v2/ws/W2.40.md §4.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { loadExamples } from './lib/examples.mjs';
import { abs, SOURCE_0_1 } from './lib/paths.mjs';
import { parsePointer } from './lib/refs.mjs';
import { checkAgainstSource, loadDeltas } from './lib/source-diff.mjs';
import { readYaml } from './lib/yaml-io.mjs';

/** Порядок — как в ответе владельца: топливо, мойка, парковка, платная дорога, шиномонтаж, прочее. */
const KINDS = ['fuel', 'wash', 'parking', 'toll', 'tire_service', 'other'];
const OTHER_COMMENT = 'Для категории «Прочее» добавьте комментарий';

const doc = bundle();
const source = readYaml(SOURCE_0_1);
const schemas = doc.components.schemas;
const at = (root, ptr) => parsePointer(ptr).reduce((cur, t) => cur?.[t], root);
const w240 = loadDeltas().filter((d) => /W2\.40/.test(d.source));

describe('контракт 0.5.1-stage2 (W2.40): категории расходов и юрлицо рейса', () => {
  // W2.52 (0.6.1-stage2, справочник тенанта W2.41): перечисление снято, kind — код справочника; шесть кодов посева
  // остаются валидными (examples и описание поля).
  it('категории расходов — шесть кодов посева в TripExpenseCreate и TripExpense', () => {
    for (const s of ['TripExpenseCreate', 'TripExpense']) {
      assert.deepEqual(schemas[s].properties.kind.examples, KINDS, s);
      assert.equal(schemas[s].properties.kind.enum, undefined, s);
    }
  });

  it('«прочее» требует комментарий: правило и текст 422 — в описаниях полей, описание схемы 0.1 не меняется', () => {
    const p = schemas.TripExpenseCreate.properties;
    assert.equal(
      schemas.TripExpenseCreate.description,
      source.components.schemas.TripExpenseCreate.description,
    );
    assert.match(p.kind.description, /tire_service/);
    assert.match(p.kind.description, /Шиномонтаж и мелкий ремонт/);
    assert.match(p.kind.description, /D-12 комплекта/);
    assert.match(p.comment.description, /other/);
    assert.match(p.comment.description, /422 validation_failed/);
    assert.ok(p.comment.description.includes(OTHER_COMMENT), 'текст ошибки поля comment');
    assert.deepEqual(schemas.TripExpenseCreate.required, [
      'kind',
      'occurredAt',
      'amount',
      'receiptFileIds',
    ]);
  });

  it('TripPlan.legalEntityId — nullable uuid, только чтение, необязательное; Trip 0.1 и TripPlanCreate без поля', () => {
    const f = schemas.TripPlan.properties.legalEntityId;
    assert.ok(f, 'нет TripPlan.legalEntityId');
    assert.deepEqual(f.type, ['string', 'null']);
    assert.equal(f.format, 'uuid');
    assert.equal(f.readOnly, true);
    assert.match(f.description, /org\.legal_entities/);
    assert.ok(!schemas.TripPlan.required.includes('legalEntityId'));
    assert.ok(!('legalEntityId' in schemas.Trip.properties), 'Trip 0.1 не меняется');
    assert.ok(!('legalEntityId' in schemas.TripPlanCreate.properties), 'только чтение');
  });

  it('дельты W2.40: enum — надмножество 0.1, описания полей — только добавление; аддитивность бандла', () => {
    assert.deepEqual(checkAgainstSource(doc, source, loadDeltas()).errors, []);
    const want = [
      // W2.52: дельта перечисления W2.40 — общая с W2.52 на всё поле kind (код справочника).
      ['/components/schemas/TripExpenseCreate/properties/kind', 'change'],
      ['/components/schemas/TripExpense/properties/kind', 'change'],
      ['/components/schemas/TripExpenseCreate/properties/kind/description', 'add'],
      ['/components/schemas/TripExpenseCreate/properties/comment/description', 'add'],
    ];
    for (const [ptr, kind] of want) {
      const d = w240.find((x) => x.pointer === ptr);
      assert.ok(d, `нет дельты W2.40 ${ptr}`);
      assert.equal(d.kind, kind, ptr);
    }
    for (const d of w240.filter((x) => x.kind === 'change' && x.pointer.endsWith('/enum'))) {
      const was = at(source, d.pointer);
      const now = at(doc, d.pointer);
      assert.ok(
        was.every((v) => now.includes(v)) && now.length > was.length,
        `${d.pointer}: не надмножество`,
      );
    }
    assert.match(loadDeltas().find((x) => x.pointer === '/info/version').source, /W2\.40/);
  });

  it('пример createTripExpense/validation_failed — «прочее» без комментария, поле comment', () => {
    const ex = loadExamples().get('createTripExpense')?.get('validation_failed');
    assert.ok(ex, 'нет примера');
    assert.equal(ex.status, 422);
    assert.deepEqual(ex.violations, [
      { field: 'comment', code: 'required', message: OTHER_COMMENT },
    ]);
  });

  it('реестр миграций api/README.md: tenant 0013 выдан W2.40', () => {
    const readme = readFileSync(abs('api/README.md'), 'utf8');
    assert.match(
      readme,
      /\|\s*tenant\s*\|\s*0013\s*\|\s*`0013_fleet_expense_kinds_trip_legal_entity\.sql`[^|]*\|\s*W2\.40/,
    );
    // Резерв этапа 2 после 0013 — очередь: следующие стюарды (W2.51 — 0014, W2.57 — 0018) сдвигают его начало.
    assert.match(readme, /\|\s*tenant\s*\|\s*(001[4-8]–)?0019\s*\|/);
  });

  // W2.51 поднимает минор (0.6.0-stage2), W4.02 — этап (0.7.0-stage4): проверяется «не ниже 0.5.1-stage2».
  it('версия контракта — не ниже 0.5.1-stage2', () => {
    const m = /^0\.(\d+)\.(\d+)-stage[2-9]$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    const [minor, patch] = [Number(m[1]), Number(m[2])];
    assert.ok(minor > 5 || (minor === 5 && patch >= 1), doc.info.version);
  });
});
