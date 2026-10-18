// W2.26 · Домен «Данные» (`core-data`, S2-16): подписи и шаблоны страницы дословно по эталону design-stage-2
// «Ортус CRM.dc.html» pg.data :1960–1979, dataVM :4179–4208 (статические строки сверяет domains.test.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { data, format } from '../src/index.ts';

describe('data: подписи pg.data', () => {
  it('статические подписи эталона', () => {
    assert.equal(
      data.intro,
      'Каталог записей модулей. Это представление исходных сущностей с теми же правами, а не редактируемая копия. Изменения — в карточке модуля.',
    );
    assert.equal(data.setsAria, 'Наборы данных');
    assert.equal(data.filter, 'Фильтр');
    assert.equal(data.filterPlaceholder, 'По любому видимому полю');
    assert.equal(data.view, 'Вид');
    assert.equal(data.noView, 'Без сохранённого вида');
    assert.equal(data.saveView, 'Сохранить вид');
    assert.equal(data.export, 'Выгрузить');
    assert.equal(data.viewSaved, 'Вид сохранён · личный');
    assert.equal(data.emptyFiltered, 'По фильтру ничего не найдено');
    assert.equal(data.emptyScope, 'В вашей области записей нет');
    assert.equal(data.updated, 'Обновлено: только что');
    assert.equal(data.scopeNote, 'Строки ограничены вашей областью доступа');
    assert.equal(data.none, '—');
  });
});

describe('data: шаблоны dataVM', () => {
  const cases = [
    [':4202', data.viewName, { set: 'Поездки', q: '211' }, 'Поездки: «211»'],
    [
      ':4203',
      data.exportToast,
      { set: 'Поездки', n: 2 },
      'Выгрузка «Поездки»: 2 строк, фильтр и права зафиксированы. В демо файл не создаётся',
    ],
    [
      ':1977',
      data.source,
      { source: 'Логистика · fleet.trips' },
      'Источник: Логистика · fleet.trips',
    ],
    [
      ':4185',
      data.sourceOf,
      { module: 'Логистика', dataset: 'fleet.vehicles' },
      'Логистика · fleet.vehicles',
    ],
    [
      ':4206',
      data.hiddenField,
      { label: 'Начисление' },
      'Поле «Начисление» скрыто правами и не участвует в фильтре, сортировке и выгрузке',
    ],
  ];
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => {
      assert.equal(typeof msg, 'string', `${src}: ключ словаря не найден`);
      assert.equal(format(msg, values), expected);
    });
  }
});
