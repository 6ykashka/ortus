// Примеры контрактной дельты W4.80 (0.11.1-stage4, стюард этапа 4): наборы «Данных» модулей ядра этапа 4 эталона
// design-2026-10-19 (dataVM :4189) — «Ответы на осмотр» (forms.responses) и «Задачи» (tasks). Подключается в
// tools/gen/examples-seed.mjs после примеров W4.05. Сюжеты — снимки сценарного сервера MSW (msw/data/core.ts) на пресете
// logistics-ready, их воспроизводят кейсы conformance adapter/test/conformance/cases/data-w480.ts:
// — каталог Марины Котовой (listDatasets/ok W2.51) — после «Расходов» «Ответы на осмотр» и «Задачи»;
// — «Ответы на осмотр» владельца: R-0988 (v2, «почти полный» — текст q-fuel-t) и R-1012 (v3, «¾» — вариант q-fuel);
// — «Задачи» владельца по поиску «осмотр»: T-61 «Проверить осмотр Р-196» со сроком 27.09.

const TEXT_OPS = ['eq', 'ne', 'in', 'contains'];
const DATE_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];

/** FieldDescriptor наборов модулей ядра (как msw/data/core.ts и data/forms, data/tasks backend). */
const field = (key, label, valueType, nullable = false) => {
  const ops = valueType === 'text' ? TEXT_OPS : DATE_OPS;
  return {
    key,
    label,
    valueType,
    nullable,
    filterOperators: nullable ? [...ops, 'is_null'] : ops,
    sortable: true,
    aggregatable: false,
    sensitivity: 'standard',
  };
};

/** Наборы этапа 4 — описание Dataset.id контракта 0.11.1-stage4. */
export const CORE_DATASETS = [
  {
    id: 'forms.responses',
    moduleKey: 'forms',
    name: 'Ответы на осмотр',
    permissionKey: 'forms.responses.read',
    entityType: 'form_response',
    fields: [
      field('response', 'Ответ', 'text'),
      field('object', 'Объект', 'text', true),
      field('author', 'Автор', 'text', true),
      field('version', 'Версия формы', 'text'),
      field('fuel', 'Топливо', 'text', true),
    ],
    defaultSort: [{ fieldKey: 'response', direction: 'asc' }],
  },
  {
    id: 'tasks',
    moduleKey: 'tasks',
    name: 'Задачи',
    permissionKey: 'tasks.read',
    entityType: 'task',
    fields: [
      field('task', 'Задача', 'text'),
      field('assignee', 'Исполнитель', 'text', true),
      field('status', 'Статус', 'text'),
      field('due', 'Срок', 'date', true),
    ],
    defaultSort: [{ fieldKey: 'task', direction: 'asc' }],
  },
];

/**
 * @param {{ id: (scope: string, protoId: string) => string, prior: Record<string, Record<string, any>> }} deps
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage4w480Examples({ id, prior }) {
  const A = (x) => id('t-alta', x);
  const catalog = prior.listDatasets.ok;
  const text = (value) => ({ type: 'text', value });
  const response = (proto, object, author, version, fuel) => ({
    recordId: `${A('fm-insp')}:${A(proto)}`,
    cells: [
      { fieldKey: 'response', value: text(proto) },
      { fieldKey: 'object', value: text(object) },
      { fieldKey: 'author', value: text(author) },
      { fieldKey: 'version', value: text(version) },
      { fieldKey: 'fuel', value: text(fuel) },
    ],
  });
  return {
    listDatasets: {
      ok: {
        items: [
          ...catalog.items,
          ...CORE_DATASETS.map((d) => ({
            id: d.id,
            moduleKey: d.moduleKey,
            name: d.name,
            fields: d.fields,
            allowedAggregations: ['count', 'sum', 'avg', 'min', 'max'],
            permissionVersion: catalog.items[0].permissionVersion,
            permissionKey: d.permissionKey,
            entityType: d.entityType,
            exportAllowed: true,
            hiddenFieldLabels: [],
            defaultSort: d.defaultSort,
          })),
        ],
      },
    },
    queryDataset: {
      responses: {
        rows: [
          response('R-0988', 'Рейс Р-171', 'Кирилл Громов', 'v2', 'почти полный'),
          response('R-1012', 'Рейс Р-196', 'Илья Васильев', 'v3', '¾'),
        ],
        nextCursor: null,
        schemaVersion: '2',
        visibleCount: 2,
      },
      tasks: {
        rows: [
          {
            recordId: A('T-61'),
            cells: [
              { fieldKey: 'task', value: text('T-61 · Проверить осмотр Р-196') },
              { fieldKey: 'assignee', value: text('Марина Котова') },
              { fieldKey: 'status', value: text('Готово') },
              { fieldKey: 'due', value: { type: 'date', value: '2026-09-27' } },
            ],
          },
        ],
        nextCursor: null,
        schemaVersion: '2',
        visibleCount: 1,
      },
    },
  };
}
