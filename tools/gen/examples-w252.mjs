// Примеры стюарда контракта этапа 2, часть 2 (W2.52, 0.6.1-stage2): ответы владельца продукта 17.10 — справочник
// категорий расходов (D-12 комплекта), история машины (модель данных п. 2), антифрод фото (п. 4), чек-лист в формате формы
// (D-30 комплекта), поля задачи у дефекта (D-29), заменители интеграций (D-11). Подключается в tools/gen/examples-seed.mjs после
// примеров W2.51. Сюжеты на сиде логистики 14.10 «Альты» воспроизводят кейсы conformance
// adapter/test/conformance/cases/stage2b.ts (PD-43):
// — владелец видит шесть категорий посева, добавляет «Ремни и стяжки», «Мойка» второй раз — 422, архивирует
//   «Платная дорога», «Прочее» не архивируется — 409;
// — Котова видит историю ГАЗели (одна фирма с 01.09), владелец переводит Mercedes Sprinter в «Юг Транс»;
// — водитель получает чек-лист выезда с определением формы и отправляет осмотр Р-208 с пятью фото (время сервера);
// — Котова берёт критический дефект «Стёкла: Скол» на себя со сроком 12:00;
// — владелец загружает CSV машин (новая, обновление ГАЗели, строка с ошибкой) и применяет его с пропуском ошибок;
// — Котова выгружает «Поездки» в CSV.
// Время — UTC (сид — Москва, UTC+3), сейчас 2026-10-01 10:30 по Москве.

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};
/** Посев справочника и первые периоды машин сида (msw/fleet/state.ts SEED_SINCE). */
export const SEED_SINCE = '2026-09-01T06:00:00Z';

/** Категории посева (ответ владельца 17.10 на D-12 комплекта; подписи — W2.40). */
export const SEED_CATEGORIES = [
  ['fuel', 'Топливо', false],
  ['wash', 'Мойка', false],
  ['parking', 'Парковка', false],
  ['toll', 'Платная дорога', false],
  ['tire_service', 'Шиномонтаж и мелкий ремонт', false],
  ['other', 'Прочее', true],
];

/** Варианты пункта чек-листа в форме (InspectionCheck.result). ВРЕМЕННЫЕ подписи до решения Q-W2.52-8 (нет в эталоне). */
const CHECK_OPTIONS = [
  { key: 'pass', label: 'Исправно' },
  { key: 'fail', label: 'Неисправно' },
  { key: 'not_applicable', label: 'Не применимо' },
];
/** Стороны фото (PHOTO_SIDES эталона) → роли контракта. */
const PHOTO_FIELDS = [
  ['front', 'Спереди'],
  ['rear', 'Сзади'],
  ['left', 'Слева'],
  ['right', 'Справа'],
  ['odometer', 'Одометр'],
];
const DEP_CHECKS = [
  ['body', 'Кузов и стёкла осмотрены'],
  ['tires', 'Шины и световые приборы исправны'],
  ['docs', 'Документы и комплект на месте'],
];

/**
 * `prior` — примеры, собранные до W2.52: completeUpload/ok загружает тот же файл, что файл сида «Р-208 · спереди.jpg»
 * (тот же sha256), — с W2.52 ответ несёт предупреждение о повторе (антифрод фото, не отказ).
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage2w252Examples({ id, problem, page, NOW, prior }) {
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const A = (x) => id('t-alta', x);
  const E = (x) => id('t-alta:example', x);

  // Антифрод фото (модель данных п. 4, W2.43): повтор загруженного файла по sha256.
  const seedFile = prior.getFile.ok;
  add('completeUpload', 'ok', {
    ...prior.completeUpload.ok,
    duplicateWarning: {
      code: 'duplicate_sha256',
      firstSeenAt: seedFile.createdAt,
      previousCount: 1,
      sameOwner: true,
    },
  });

  // Справочник категорий расходов (D-12 комплекта, W2.41).
  const category = ([code, label, commentRequired], patch = {}) => {
    const { revision = 1, ...rest } = patch;
    return {
      code,
      label,
      commentRequired,
      seeded: true,
      state: 'active',
      createdAt: SEED_SINCE,
      ...rest,
      revision,
    };
  };
  add('listExpenseCategories', 'ok', page(SEED_CATEGORIES.map((c) => category(c))));
  add(
    'listExpenseCategories',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает видеть расходы.'),
  );
  add('createExpenseCategory', 'ok', {
    code: 'custom_1',
    label: 'Ремни и стяжки',
    commentRequired: false,
    seeded: false,
    state: 'active',
    createdAt: NOW,
    revision: 1,
  });
  add(
    'createExpenseCategory',
    'validation_failed',
    problem('validation_failed', 'Такая категория уже есть.', {
      violations: [{ field: 'label', code: 'duplicate', message: 'Такая категория уже есть' }],
    }),
  );
  add(
    'archiveExpenseCategory',
    'ok',
    category(SEED_CATEGORIES[3], {
      state: 'archived',
      archivedAt: NOW,
      archivedByMemberId: A('m-owner'),
      revision: 2,
    }),
  );
  add(
    'archiveExpenseCategory',
    'invalid_transition',
    problem('invalid_transition', 'Категорию «Прочее» нельзя убрать.'),
  );

  // История машины (модель данных п. 2, W2.42).
  add(
    'listVehicleAssignments',
    'ok',
    page([
      {
        id: A('assignment-v1'),
        vehicleId: A('v1'),
        orgUnitId: A('f-msk-sever'),
        orgUnitName: 'Север Логистик',
        validFrom: SEED_SINCE,
        validTo: null,
      },
    ]),
  );
  add('listVehicleAssignments', 'not_found', problem('not_found', 'Машина не найдена.'));
  add('moveVehicle', 'ok', {
    id: A('v6'),
    orgUnitId: A('f-msk-yug'),
    registrationNumber: 'Т 771 ЕХ 77',
    displayName: 'Mercedes Sprinter',
    bodyType: 'van',
    capacity: {
      payloadKg: '1600',
      volumeM3: '14',
      cargoLengthM: '4.3',
      cargoWidthM: '2',
      cargoHeightM: '2',
    },
    equipment: [],
    status: 'available',
    odometerKm: '120544',
    revision: 2,
    depot: 'Склад № 1',
    orgUnitSince: NOW,
  });
  add(
    'moveVehicle',
    'validation_failed',
    problem('validation_failed', 'Машина уже в этой фирме.', {
      violations: [{ field: 'orgUnitId', code: 'same_unit', message: 'Машина уже в этой фирме' }],
    }),
  );

  // Чек-лист выезда — определение формы (D-30 комплекта, W2.45); осмотр с серверным временем фото (W2.43).
  const definition = {
    title: 'Осмотр перед выездом',
    description: '',
    fields: [
      ...DEP_CHECKS.map(([key, label]) => ({
        key,
        label,
        type: 'single_choice',
        required: true,
        options: CHECK_OPTIONS,
      })),
      ...PHOTO_FIELDS.map(([role, label]) => ({
        key: `photo_${role}`,
        label,
        type: 'file',
        required: true,
        maxFiles: 1,
        allowedMimeTypes: ['image/jpeg'],
        maxFileBytes: 20971520,
      })),
    ],
    visibility: [],
    confirmationText: '',
  };
  add('getInspectionChecklist', 'ok', {
    versionId: A('checklist:departure:1'),
    kind: 'departure',
    items: DEP_CHECKS.map(([key, label]) => ({
      key,
      label,
      required: true,
      failureBlocksRelease: false,
    })),
    requiredPhotoRoles: PHOTO_FIELDS.map(([role]) => role),
    definition,
  });
  add('getInspectionChecklist', 'not_found', problem('not_found', 'Машина не найдена.'));
  add('submitInspection', 'ok', {
    checklistVersionId: A('checklist:departure:1'),
    id: E('insp-208-dep'),
    vehicleId: A('v1'),
    memberId: A('m-vasiliev'),
    kind: 'departure',
    status: 'submitted',
    odometerKm: '84500',
    fuelPercent: 50,
    checks: DEP_CHECKS.map(([key]) => ({ key, result: 'pass' })),
    photos: PHOTO_FIELDS.map(([role]) => ({
      role,
      fileId: E(`photo-208-${role}`),
      capturedAt: NOW,
      serverCapturedAt: NOW,
    })),
    capturedAt: NOW,
    submittedAt: NOW,
    revision: 1,
    tripId: A('Р-208'),
    attempt: 1,
    defects: [],
  });
  add(
    'submitInspection',
    'photo_not_ready',
    problem('photo_not_ready', 'Не все фото загружены на сервер'),
  );

  // Поля задачи у дефекта в очереди (D-29 комплекта, W2.46): «Стёкла: Скол» Р-208, срок 12:00.
  add('assignInspectionDefect', 'ok', {
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
    tripNumber: 'Р-208',
    vehicleDisplayName: 'ГАЗель Next',
    registrationNumber: 'А 412 МР 77',
    driverDisplayName: 'Илья Васильев',
    revision: 2,
    assigneeMemberId: A('m-kotova'),
    assigneeDisplayName: 'Марина Котова',
    dueAt: at('12:00'),
    assignedByMemberId: A('m-kotova'),
    assignedAt: NOW,
  });
  add(
    'assignInspectionDefect',
    'invalid_transition',
    problem('invalid_transition', 'Дефект уже решён.'),
  );

  // Импорт CSV машин (D-11 комплекта, W2.50): новая машина, обновление ГАЗели, строка с неизвестным кузовом.
  const SEVER = A('f-msk-sever');
  const rows = (committed) => [
    {
      line: 2,
      action: 'create',
      registrationNumber: 'Х 101 АМ 77',
      displayName: 'Ford Transit Custom',
      orgUnitId: SEVER,
      ...(committed ? { vehicleId: E('vehicle-import-new') } : {}),
      errors: [],
    },
    {
      line: 3,
      action: 'update',
      registrationNumber: 'А 412 МР 77',
      displayName: 'ГАЗель Next',
      orgUnitId: SEVER,
      vehicleId: A('v1'),
      errors: [],
    },
    {
      line: 4,
      action: committed ? 'skip' : 'error',
      registrationNumber: 'В 999 ТТ 77',
      displayName: 'Самосвал',
      errors: [{ field: 'body_type', code: 'unknown', message: 'Неизвестный тип кузова' }],
    },
  ];
  const vehicleImport = (committed) => ({
    id: E('vehicle-import'),
    state: committed ? 'committed' : 'previewed',
    fileName: 'mashiny.csv',
    defaultOrgUnitId: SEVER,
    totals: committed
      ? { rows: 3, create: 1, update: 1, skip: 1, error: 0 }
      : { rows: 3, create: 1, update: 1, skip: 0, error: 1 },
    rows: rows(committed),
    createdAt: NOW,
    expiresAt: '2026-10-02T07:30:00Z',
    ...(committed ? { committedAt: NOW } : {}),
    revision: committed ? 2 : 1,
  });
  add('createVehicleImport', 'ok', vehicleImport(false));
  add(
    'createVehicleImport',
    'validation_failed',
    problem('validation_failed', 'В файле нет обязательной колонки registration_number.', {
      violations: [
        {
          field: 'csv',
          code: 'missing_column',
          message: 'Нет колонки registration_number (госномер)',
        },
      ],
    }),
  );
  add('getVehicleImport', 'ok', vehicleImport(false));
  add('getVehicleImport', 'not_found', problem('not_found', 'Импорт не найден.'));
  add('commitVehicleImport', 'ok', vehicleImport(true));
  add(
    'commitVehicleImport',
    'validation_failed',
    problem('validation_failed', 'В файле есть строки с ошибками: исправьте их или пропустите.', {
      violations: [{ field: 'rows[4]', code: 'invalid', message: 'Неизвестный тип кузова' }],
    }),
  );

  // Выгрузка CSV (D-11 комплекта, W2.50): «Поездки» Котовой — разделитель «;», CRLF, подписи вариантов.
  add('exportDataset', 'ok', {
    datasetId: 'fleet.trips',
    fileName: 'Поездки-2026-10-01.csv',
    contentType: 'text/csv; charset=utf-8',
    content: [
      'Рейс;Водитель;Статус;Пробег, км',
      'Р-208 · Северный маршрут;Илья Васильев;Запланирован;',
      'Р-211 · Охлаждённая продукция;;Запланирован;',
      '',
    ].join('\r\n'),
    rowCount: 2,
    rowLimit: 10000,
    truncated: false,
    generatedAt: NOW,
  });
  add(
    'exportDataset',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает выгружать данные.'),
  );
  return ex;
}
