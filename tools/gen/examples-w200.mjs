// Примеры контракта этапа 2 (W2.00, 0.5.0-stage2) на сиде логистики прототипа 14.10 (mock-data.js:189–230).
// Подключается в tools/gen/examples-seed.mjs после примеров W1.00: пересборка пишет и их.
// Сюжеты (их воспроизводят кейсы conformance adapter/test/conformance/cases/fleet.ts, PD-43):
// — «Логистика» подключена, Марина Котова — «Менеджер логистики» в «Север Логистик» (пресет logistics-ready);
// — рейсы Р-208 «Северный маршрут» (водитель Илья Васильев) и Р-211 «Охлаждённая продукция» (без водителя);
// — логист назначает ГАЗель Next на Р-208, Hyundai Porter не проходит по массе и объёму;
// — смена Р-208: бронь ГАЗели водителем, осмотр выезда, старт, «Завершить рейс»; вариант с критическим
//   дефектом «Стёкла: Скол» — очередь менеджера и решение «разрешить выезд»; приёмка — начисление 4 500 ₽;
// — «Требует решения»: владелец «Альты» без логистики (пробный период, сотрудники без роли), Котова с
//   логистикой (Р-211 без водителя).
// Единицы контракта: масса в кг, длина в м, время — UTC (сид — Москва, UTC+3). Новые объекты — область
// `t-alta:example` (UUID любого нового объекта сервера совпадает с ними по порядку появления).

const MSK = 'Europe/Moscow';
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};
const kg = (t) => String(Math.round(t * 1000));

/** Рейсы сида «Альты» (mock-data.js:201–211). */
const TRIPS = [
  {
    id: 'Р-208',
    title: 'Северный маршрут',
    window: ['09:00', '13:00'],
    distanceKm: 46,
    driver: ['m-vasiliev', 'Илья Васильев'],
    cargo: { kind: 'Сухой груз · 14 паллет-мест', weightT: 1.1, volumeM3: 12, lengthM: 3.0 },
    stops: [
      ['09:00', 'Склад № 1, Лобня', 'load', 1.1, 12],
      ['10:15', 'Химки, ул. Заводская, 8', 'unload', 0.7, 8],
      ['11:30', 'Долгопрудный, Лихачёвский пр., 4', 'unload', 0.4, 4],
    ],
  },
  {
    id: 'Р-211',
    title: 'Охлаждённая продукция',
    window: ['14:00', '18:00'],
    distanceKm: 31,
    driver: null,
    cargo: {
      kind: 'Молочная продукция · +2…+6 °C',
      weightT: 0.6,
      volumeM3: 7,
      lengthM: 2.4,
      temp: [2, 6],
    },
    stops: [
      ['14:00', 'Склад № 1, Лобня', 'load', 0.6, 7],
      ['15:10', 'Мытищи, ул. Колпакова, 2', 'unload', 0.35, 4],
      ['16:20', 'Королёв, пр. Космонавтов, 20', 'unload', 0.25, 3],
    ],
  },
];

/** @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело */
export function stage2Examples(h) {
  const { id, problem, page, NOW } = h;
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const A = (x) => id('t-alta', x);
  const E = (x) => id('t-alta:example', x);
  const window = ([from, to]) => ({ startsAt: at(from), endsAt: at(to), timeZone: MSK });
  const cargo = (c) => ({
    description: c.kind,
    weightKg: kg(c.weightT),
    volumeM3: String(c.volumeM3),
    lengthM: String(c.lengthM),
    ...(c.temp ? { temperatureMinC: String(c.temp[0]), temperatureMaxC: String(c.temp[1]) } : {}),
  });
  const stop = ([time, address, op, w, v], i) => ({
    sequence: i + 1,
    op,
    address,
    plannedAt: at(time),
    weightKg: kg(w),
    volumeM3: String(v),
  });
  /** TripPlan — поля в порядке схемы (так же строит сервер MSW). */
  const plan = (t, patch = {}) => {
    const { revision = 1, ...rest } = patch;
    return {
      id: A(t.id),
      number: t.id,
      title: t.title,
      orgUnitId: A('f-msk-sever'),
      state: 'planned',
      plannedWindow: window(t.window),
      distanceKm: String(t.distanceKm),
      cargo: cargo(t.cargo),
      stops: t.stops.map(stop),
      ...(t.driver ? { driverMemberId: A(t.driver[0]), driverDisplayName: t.driver[1] } : {}),
      ...rest,
      revision,
    };
  };
  const [R208, R211] = TRIPS;
  const hold = '2026-10-01T08:00:00Z'; // сейчас + 30 минут (LogisticsSettings.reservationTtlMinutes)

  // Рейс от плана до приёмки (Q-45, S2-13).
  add('listTripPlans', 'ok', page([plan(R208), plan(R211)]));
  add(
    'listTripPlans',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает видеть рейсы.'),
  );
  const r212 = {
    id: 'Р-212',
    title: 'Возврат тары',
    window: ['16:00', '18:00'],
    distanceKm: 22,
    driver: ['m-akhmedov', 'Тимур Ахмедов'],
    cargo: { kind: 'Пустые паллеты · 10 мест', weightT: 0.3, volumeM3: 8, lengthM: 2.4 },
    stops: [
      ['16:00', 'Химки, ул. Заводская, 8', 'load', 0.3, 8],
      ['17:00', 'Склад № 1, Лобня', 'unload', 0.3, 8],
    ],
  };
  add('createTripPlan', 'ok', { ...plan(r212), id: E('trip-r212') });
  add(
    'createTripPlan',
    'validation_failed',
    problem('validation_failed', 'Проверьте точки рейса.', {
      violations: [
        {
          field: 'stops[1].weightKg',
          code: 'load',
          message: 'Выгрузка больше, чем в кузове после предыдущей точки',
        },
      ],
    }),
  );
  add('getTripPlan', 'ok', plan(R208));
  add('getTripPlan', 'not_found', problem('not_found', 'Рейс не найден.'));
  add(
    'assignTripVehicle',
    'ok',
    plan(R208, {
      state: 'assigned',
      vehicleId: A('v1'),
      reservationId: E('reservation-208'),
      holdExpiresAt: hold,
      revision: 2,
    }),
  );
  const porter = [
    ['payload', 'Грузоподъёмность: 0,9 т, нужно от 1,1 т'],
    ['volume', 'Объём: 9 м³, нужно от 12 м³'],
  ];
  add(
    'assignTripVehicle',
    'vehicle_incompatible',
    problem('vehicle_incompatible', `Нельзя назначить: ${porter.map((p) => p[1]).join('; ')}`, {
      violations: porter.map(([code, message]) => ({ field: 'vehicleId', code, message })),
    }),
  );
  add(
    'finishTripRoute',
    'ok',
    plan(R208, {
      state: 'returning',
      vehicleId: A('v1'),
      reservationId: E('reservation-208'),
      holdExpiresAt: hold,
      departureInspectionId: E('insp-208-dep'),
      startedAt: NOW,
      routeCompletedAt: NOW,
      revision: 5,
    }),
  );
  add(
    'finishTripRoute',
    'invalid_transition',
    problem('invalid_transition', 'Рейс ещё не в пути.'),
  );

  // Блокирующий дефект (S2-17, D-29 комплекта): «Стёкла: Скол» на осмотре выезда Р-208.
  const defect = (patch = {}) => {
    const { revision = 1, ...rest } = patch;
    return {
      id: E('defect-208-glass'),
      vehicleId: A('v1'),
      inspectionId: E('insp-208-dep'),
      tripId: A('Р-208'),
      zone: 'Стёкла',
      description: 'Скол',
      severity: 'blocking',
      state: 'in_review',
      reportedAt: NOW,
      reportedByMemberId: A('m-vasiliev'),
      ...rest,
      tripNumber: 'Р-208',
      vehicleDisplayName: 'ГАЗель Next',
      registrationNumber: 'А 412 МР 77',
      driverDisplayName: 'Илья Васильев',
      revision,
    };
  };
  add('listInspectionDefects', 'ok', page([defect()]));
  add(
    'listInspectionDefects',
    'forbidden_action',
    problem('forbidden_action', 'Очередь дефектов видит менеджер с правом решать по дефектам.'),
  );
  add('getInspectionDefect', 'ok', defect());
  add('getInspectionDefect', 'not_found', problem('not_found', 'Дефект не найден.'));
  add(
    'decideInspectionDefect',
    'ok',
    defect({
      state: 'resolved',
      decision: 'allow_departure',
      decidedByMemberId: A('m-kotova'),
      decidedAt: NOW,
      revision: 2,
    }),
  );
  add(
    'decideInspectionDefect',
    'invalid_transition',
    problem('invalid_transition', 'Дефект уже решён.'),
  );

  // Начисления отдельным маршрутом (S2-12, AC-05): смена Р-208 принята — 4 500 ₽ (trip.earnings сида).
  add(
    'listTripEarnings',
    'ok',
    page([
      {
        tripId: A('Р-208'),
        driverMemberId: A('m-vasiliev'),
        amount: { amountMinor: 450000, currency: 'RUB' },
        updatedByMemberId: A('m-kotova'),
        updatedAt: NOW,
        revision: 1,
      },
    ]),
  );
  add(
    'listTripEarnings',
    'forbidden_action',
    problem(
      'forbidden_action',
      'Начисления видят владелец и менеджер с правом fleet.earnings.read.',
    ),
  );

  // «Требует решения» (S2-18).
  const alta = id('platform', 't-alta');
  add('getMyDecisionQueue', 'ok', {
    tenantId: alta,
    items: [
      {
        key: `tenant.trial_ending:${alta}`,
        kind: 'tenant.trial_ending',
        moduleKey: 'billing',
        tone: 'neutral',
        params: { daysLeft: '12', trialEndsAt: '2026-10-13T21:00:00Z' },
      },
      {
        key: `access.members_without_role:${alta}`,
        kind: 'access.members_without_role',
        moduleKey: 'members',
        tone: 'neutral',
        params: { count: '3', names: 'Марина Котова, Вера Котельникова, Тимур Ахмедов' },
      },
    ],
    total: 2,
    generatedAt: NOW,
  });
  add('getMyDecisionQueue', 'manager', {
    tenantId: alta,
    items: [
      {
        key: `fleet.trip_without_driver:${A('Р-211')}`,
        kind: 'fleet.trip_without_driver',
        moduleKey: 'fleet',
        tone: 'info',
        object: { moduleKey: 'fleet', entityType: 'trip', entityId: A('Р-211') },
        params: {
          tripNumber: 'Р-211',
          title: R211.title,
          cargo: R211.cargo.kind,
          startsAt: at(R211.window[0]),
        },
      },
    ],
    total: 1,
    generatedAt: NOW,
  });
  add('getMyDecisionQueue', 'not_found', problem('not_found', 'Организация не найдена.'));
  return ex;
}
