// W4.80 · Контрактная дельта стюарда этапа 4 (0.11.1-stage4, номер версии согласует интегратор), только описания и
// примеры: наборы «Данных» этапа 4 эталона design-2026-10-19 (dataVM :4189) — «Ответы на осмотр» (forms.responses) и
// «Задачи» (tasks). Новых операций, схем, прав, кодов ошибок и миграций нет. Критика выхода этапа 4, П-1.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { checkExamples, loadExamples } from './lib/examples.mjs';
import { abs } from './lib/paths.mjs';
import { loadDeltas } from './lib/source-diff.mjs';

const doc = bundle();
const dataset = doc.components.schemas.Dataset;
const examples = loadExamples();
const ex = (op, name) => examples.get(op)?.get(name);

describe('контракт 0.11.1-stage4 (W4.80): наборы «Данных» этапа 4', () => {
  it('описание Dataset.id — наборы forms.responses и tasks с полями, правом, entityType и recordId', () => {
    const d = dataset.properties.id.description;
    for (const s of [
      'W4.80',
      'forms.responses «Ответы на осмотр»',
      'response «Ответ»',
      'object «Объект»',
      'author «Автор»',
      'version «Версия формы»',
      'fuel «Топливо»',
      'permission forms.responses.read',
      'entityType form_response',
      '{formId}:{responseId}',
      'tasks «Задачи»',
      'task «Задача»',
      'assignee «Исполнитель»',
      'status «Статус»',
      'due «Срок»',
      'permission tasks.read',
      'entityType task',
    ]) {
      assert.ok(d.includes(s), `нет «${s}» в описании Dataset.id`);
    }
  });

  it('дельта описания Dataset.id и версии — с источником W4.80; версия не ниже 0.11.1', () => {
    const deltas = loadDeltas();
    const id = deltas.find(
      (x) => x.pointer === '/components/schemas/Dataset/properties/id/description',
    );
    assert.match(id.source, /W4\.80/);
    assert.match(deltas.find((x) => x.pointer === '/info/version').source, /W4\.80/);
    const m = /^0\.(\d+)\.(\d+)-stage\d+$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    const [minor, patch] = [Number(m[1]), Number(m[2])];
    assert.ok(minor > 11 || (minor === 11 && patch >= 1), doc.info.version);
  });

  it('журнал контракта — раздел W4.80', () => {
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.\d+\.\d+-stage4 — W4\.80/m);
  });

  it('примеры: каталог логиста с пятью наборами, выборки «Задачи» и «Ответы на осмотр»', () => {
    const cat = ex('listDatasets', 'ok');
    assert.deepEqual(
      cat.items.map((d) => d.id),
      ['fleet.vehicles', 'fleet.trips', 'fleet.expenses', 'forms.responses', 'tasks'],
    );
    const [responses, tasks] = cat.items.slice(3);
    assert.deepEqual(
      [responses.moduleKey, responses.name, responses.entityType, responses.permissionKey],
      ['forms', 'Ответы на осмотр', 'form_response', 'forms.responses.read'],
    );
    assert.deepEqual(
      [tasks.moduleKey, tasks.name, tasks.entityType, tasks.permissionKey],
      ['tasks', 'Задачи', 'task', 'tasks.read'],
    );
    const cell = (row, key) => row.cells.find((c) => c.fieldKey === key)?.value;
    const r = ex('queryDataset', 'responses');
    assert.equal(r.rows.length, 2);
    assert.deepEqual(cell(r.rows[1], 'fuel'), { type: 'text', value: '¾' });
    assert.match(r.rows[0].recordId, /^[0-9a-f-]{36}:[0-9a-f-]{36}$/);
    const t = ex('queryDataset', 'tasks');
    assert.deepEqual(cell(t.rows[0], 'task'), {
      type: 'text',
      value: 'T-61 · Проверить осмотр Р-196',
    });
    assert.deepEqual(cell(t.rows[0], 'due'), { type: 'date', value: '2026-09-27' });
  });

  it('примеры валидны по схемам бандла', () => {
    assert.deepEqual(checkExamples(doc, examples), []);
  });
});
