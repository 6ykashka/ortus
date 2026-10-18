// Примеры стюарда контракта этапа 2, часть 1 (W2.51, 0.6.0-stage2): пул водителей (S2-14) и наборы «Данных»
// (S2-16). Подключается в tools/gen/examples-seed.mjs после примеров W2.40. Сюжеты на сиде логистики 14.10
// (mock-data.js:222–228 — пул «Водитель #104» «Юг Транс», «Водитель #117» «Восток Карго»); их воспроизводят кейсы
// conformance adapter/test/conformance/cases/pool.ts и cases/data.ts (PD-43):
// — Марина Котова («Север Логистик») видит пул на окно Р-211, «Запросить на рейс Р-211» Водителя #104, повтор — 409;
// — владелец одобряет запрос: временное назначение на рейс Р-211 до 18:00 (scheduled до начала окна);
// — Котова публикует Илью Васильева в пул на 14:00–18:00; окно, пересекающее его рейс Р-208, — 409;
// — владелец видит и снимает публикации фирм; Котова чужую публикацию не видит — 404;
// — «Данные»: каталог наборов Котовой («Автомобили», «Поездки», «Расходы»), выборка «Поездки» с числом строк.
// Время — UTC (сид — Москва, UTC+3), сейчас 2026-10-01 10:30 по Москве.

const MSK = 'Europe/Moscow';
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};
const win = (from, to) => ({ startsAt: at(from), endsAt: at(to), timeZone: MSK });
/** Время публикации водителей сида (08:00 по Москве) — как сервер MSW (fleet/state.ts). */
const SEED_PUBLISHED_AT = '2026-10-01T05:00:00Z';
const TERMS = 'По соглашению фирм группы';

/** Подписи состояний и категорий: models.js VEHICLE_STATE, TRIP_STATE, EXPENSE_CAT; W2.40 (D-12 комплекта). */
const VEHICLE_STATUS = [
  ['available', 'Свободна'],
  ['reserved', 'Забронирована'],
  ['in_use', 'На маршруте'],
  ['blocked', 'Проверяется'],
  ['maintenance', 'Недоступна'],
];
const TRIP_STATE = [
  ['planned', 'Запланирован'],
  ['assigned', 'Машина назначена'],
  ['inspection', 'Осмотр перед выездом'],
  ['defect_review', 'Дефект на проверке'],
  ['on_route', 'В рейсе'],
  ['returning', 'Сдача машины'],
  ['submitted', 'Ожидает приёмки'],
  ['rework', 'На доработке'],
  ['accepted', 'Принят'],
];
const EXPENSE_KIND = [
  ['fuel', 'Топливо'],
  ['wash', 'Мойка'],
  ['parking', 'Парковка'],
  ['toll', 'Платная дорога'],
  ['tire_service', 'Шиномонтаж и мелкий ремонт'],
  ['other', 'Прочее'],
];
const EXPENSE_STATUS = [
  ['claimed', 'Заявлен водителем'],
  ['accepted', 'Принят'],
];

const TEXT_OPS = ['eq', 'ne', 'in', 'contains'];
const CHOICE_OPS = ['eq', 'ne', 'in'];
const NUMBER_OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'];
const options = (list) => list.map(([key, label]) => ({ key, label }));

/** FieldDescriptor — поля в порядке схемы (так же строит сервер MSW, msw/data/catalog.ts). */
const field = (key, label, valueType, extra = {}) => {
  const ops = { text: TEXT_OPS, choices: CHOICE_OPS }[valueType] ?? NUMBER_OPS;
  const nullable = extra.nullable ?? false;
  return {
    key,
    label,
    valueType,
    nullable,
    filterOperators: nullable ? [...ops, 'is_null'] : ops,
    sortable: true,
    aggregatable: valueType === 'decimal' || valueType === 'money',
    sensitivity: extra.sensitivity ?? 'standard',
    ...(extra.options ? { options: options(extra.options) } : {}),
  };
};

/** Наборы этапа 2 — описание Dataset.id контракта; `earnings` — только с fleet.earnings.read. */
export const DATASETS = [
  {
    id: 'fleet.vehicles',
    name: 'Автомобили',
    permissionKey: 'fleet.vehicles.read',
    entityType: 'vehicle',
    fields: [
      field('displayName', 'Машина', 'text'),
      field('registrationNumber', 'Номер', 'text'),
      field('orgUnitName', 'Фирма', 'text'),
      field('status', 'Состояние', 'choices', { options: VEHICLE_STATUS }),
      field('volumeM3', 'Объём, м³', 'decimal'),
    ],
    defaultSort: [{ fieldKey: 'displayName', direction: 'asc' }],
  },
  {
    id: 'fleet.trips',
    name: 'Поездки',
    permissionKey: 'fleet.trips.read',
    entityType: 'trip',
    fields: [
      field('trip', 'Рейс', 'text'),
      field('driverName', 'Водитель', 'text', { nullable: true }),
      field('state', 'Статус', 'choices', { options: TRIP_STATE }),
      field('mileageKm', 'Пробег, км', 'decimal', { nullable: true }),
      field('earnings', 'Начисление', 'money', { nullable: true, sensitivity: 'financial' }),
    ],
    defaultSort: [{ fieldKey: 'trip', direction: 'asc' }],
  },
  {
    id: 'fleet.expenses',
    name: 'Расходы',
    permissionKey: 'fleet.expenses.read',
    entityType: 'expense',
    fields: [
      field('trip', 'Рейс', 'text'),
      field('kind', 'Категория', 'choices', { options: EXPENSE_KIND }),
      field('occurredOn', 'Дата', 'date'),
      field('amount', 'Сумма', 'money'),
      field('status', 'Статус', 'choices', { options: EXPENSE_STATUS }),
    ],
    defaultSort: [{ fieldKey: 'occurredOn', direction: 'desc' }],
  },
];

/** @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело */
export function stage2w251Examples({ id, problem, page, NOW }) {
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const A = (x) => id('t-alta', x);
  const E = (x) => id('t-alta:example', x);

  // Пул водителей (S2-14): публикации сида.
  const SEED_POOL = [
    [
      'd-104',
      'Водитель #104',
      'f-msk-yug',
      'Юг Транс',
      ['Кат. C', 'рефрижератор'],
      ['13:00', '19:00'],
    ],
    ['d-117', 'Водитель #117', 'f-msk-vostok', 'Восток Карго', ['Кат. B'], ['15:00', '20:00']],
  ];
  const availability = ([d, label, unit, unitName, qual, [from, to]]) => ({
    driverMemberId: A(d),
    displayName: label,
    homeOrgUnitId: A(unit),
    qualifications: qual,
    freeWindow: win(from, to),
    terms: TERMS,
    publicationId: A(`pool-${d}`),
    homeOrgUnitName: unitName,
  });
  const publication = ([d, label, unit, unitName, qual, [from, to]], patch = {}) => {
    const { revision = 1, ...rest } = patch;
    return {
      id: A(`pool-${d}`),
      driverMemberId: A(d),
      displayName: label,
      homeOrgUnitId: A(unit),
      homeOrgUnitName: unitName,
      qualifications: qual,
      freeWindow: win(from, to),
      terms: TERMS,
      state: 'active',
      publishedAt: SEED_PUBLISHED_AT,
      ...rest,
      revision,
    };
  };
  const [P104, P117] = SEED_POOL;

  add('listAvailableDrivers', 'ok', page([availability(P104), availability(P117)]));
  add(
    'listAvailableDrivers',
    'malformed_request',
    problem('malformed_request', 'Нужен параметр availableFrom.'),
  );

  // «Запросить на рейс Р-211» (modal-driver-request): срок — окно рейса 14:00–18:00.
  const transfer = (patch = {}) => {
    const { revision = 1, ...rest } = patch;
    return {
      id: E('transfer-211-d104'),
      driverMemberId: A('d-104'),
      sourceOrgUnitId: A('f-msk-yug'),
      targetOrgUnitId: A('f-msk-sever'),
      window: win('14:00', '18:00'),
      status: 'requested',
      revision,
      tripId: A('Р-211'),
      publicationId: A('pool-d-104'),
      driverDisplayName: 'Водитель #104',
      sourceOrgUnitName: 'Юг Транс',
      targetOrgUnitName: 'Север Логистик',
      tripNumber: 'Р-211',
      reason: 'Запрос на рейс Р-211',
      requestedByMemberId: A('m-kotova'),
      requestedAt: NOW,
      ...rest,
    };
  };
  add('requestDriverTransfer', 'ok', transfer());
  add(
    'requestDriverTransfer',
    'invalid_transition',
    problem('invalid_transition', 'Запрос уже отправлен'),
  );
  add('listDriverTransfers', 'ok', page([transfer()]));
  add(
    'listDriverTransfers',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает видеть запросы пула.'),
  );
  add(
    'decideDriverTransfer',
    'ok',
    transfer({
      status: 'approved',
      revision: 2,
      decidedByMemberId: A('m-owner'),
      decidedAt: NOW,
      grant: {
        assignmentId: E('grant-211-d104'),
        orgUnitId: A('f-msk-sever'),
        tripId: A('Р-211'),
        validFrom: at('14:00'),
        validUntil: at('18:00'),
        state: 'scheduled',
      },
    }),
  );
  add(
    'decideDriverTransfer',
    'forbidden_action',
    problem('forbidden_action', 'Решает менеджер фирмы-источника или владелец.'),
  );

  // Публикация фирмой-источником (S2-14, AUTH-06).
  add('listDriverPoolPublications', 'ok', page([publication(P117), publication(P104)]));
  add(
    'listDriverPoolPublications',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает видеть публикации пула.'),
  );
  add('getDriverPoolPublication', 'ok', publication(P104));
  add('getDriverPoolPublication', 'not_found', problem('not_found', 'Публикация не найдена.'));
  add('publishDriverToPool', 'ok', {
    id: E('pool-vasiliev'),
    driverMemberId: A('m-vasiliev'),
    driverDisplayName: 'Илья Васильев',
    displayName: 'Водитель #118',
    homeOrgUnitId: A('f-msk-sever'),
    homeOrgUnitName: 'Север Логистик',
    qualifications: ['Кат. B'],
    freeWindow: win('14:00', '18:00'),
    terms: TERMS,
    state: 'active',
    publishedByMemberId: A('m-kotova'),
    publishedAt: NOW,
    revision: 1,
  });
  add(
    'publishDriverToPool',
    'resources_unavailable',
    problem('resources_unavailable', 'Водитель занят в это время: рейс Р-208.'),
  );
  add(
    'withdrawDriverPoolPublication',
    'ok',
    publication(P117, {
      state: 'withdrawn',
      withdrawnAt: NOW,
      withdrawnByMemberId: A('m-owner'),
      revision: 2,
    }),
  );
  add(
    'withdrawDriverPoolPublication',
    'invalid_transition',
    problem('invalid_transition', 'Водитель уже снят из пула.'),
  );

  // «Данные» (S2-16, AC-14): каталог Котовой — data.export и fleet.earnings.read есть, скрытых полей нет.
  add('listDatasets', 'ok', {
    items: DATASETS.map((d) => ({
      id: d.id,
      moduleKey: 'fleet',
      name: d.name,
      fields: d.fields,
      allowedAggregations: ['count', 'sum', 'avg', 'min', 'max'],
      permissionVersion: '2',
      permissionKey: d.permissionKey,
      entityType: d.entityType,
      exportAllowed: true,
      hiddenFieldLabels: [],
      defaultSort: d.defaultSort,
    })),
  });
  add(
    'listDatasets',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает видеть наборы данных.'),
  );
  const text = (value) => ({ type: 'text', value });
  const nil = { type: 'null', value: null };
  add('queryDataset', 'ok', {
    rows: [
      {
        recordId: A('Р-208'),
        cells: [
          { fieldKey: 'trip', value: text('Р-208 · Северный маршрут') },
          { fieldKey: 'driverName', value: text('Илья Васильев') },
          { fieldKey: 'state', value: { type: 'choices', value: ['planned'] } },
          { fieldKey: 'mileageKm', value: nil },
        ],
      },
      {
        recordId: A('Р-211'),
        cells: [
          { fieldKey: 'trip', value: text('Р-211 · Охлаждённая продукция') },
          { fieldKey: 'driverName', value: nil },
          { fieldKey: 'state', value: { type: 'choices', value: ['planned'] } },
          { fieldKey: 'mileageKm', value: nil },
        ],
      },
    ],
    nextCursor: null,
    schemaVersion: '2',
    visibleCount: 2,
  });
  add(
    'queryDataset',
    'validation_failed',
    problem('validation_failed', 'Поле недоступно: plate.', {
      violations: [{ field: 'select[0]', code: 'unknown_field', message: 'Поле недоступно' }],
    }),
  );
  return ex;
}
