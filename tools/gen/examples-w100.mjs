// Примеры второго контрактного PR этапа 1 (W1.00, 0.4.0-stage1) на сиде прототипа 14.10.
// Подключается в tools/gen/examples-seed.mjs после примеров W0.08: пересборка пишет и их.
// Сюжеты: оператор Евгения Лаптева приостанавливает «Альту» и возобновляет «Карго Сити» (в состояние подписки), продлевает
// пробный период «Альты» на 14 дней (как кнопка эталона); журнал действий — две строки эталона на старте
// (mock-data.js platform.audit); список файлов владельца «Альты» — фото осмотра Р-208 из примера getFile;
// разбивка места «Альты» — группы эталона «Фото осмотров и отчётов» 31,4 ГБ, «Документы» 9,8 ГБ,
// «Вложения задач и форм» 3,1 ГБ, «Прочее» — остаток до committedBytes getStorageUsage; отключение «Салона и
// SPA» — «Активных процессов нет»; билет канала реального времени (ADR-0015).
// Счётчики файлов в разбивке — оценка генератора: в эталоне их нет.

const GiB = 1024 ** 3;

/** @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело */
export function stage1bExamples(h, built) {
  const { id, problem, page, tenantDto, subscription, SEED, NOW, storage } = h;
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const [ALTA, , , CARGO] = SEED.tenants;
  const operator = {
    kind: 'operator',
    accountId: id('platform', `account:${SEED.operator.id}`),
    displayName: SEED.operator.name,
  };

  // Platform — команды оператора с причиной (S1-04).
  add('suspendPlatformTenant', 'ok', tenantDto(ALTA, { status: 'suspended', revision: 2 }));
  add(
    'suspendPlatformTenant',
    'invalid_transition',
    problem('invalid_transition', 'Организация уже приостановлена.'),
  );
  // Возобновление возвращает состояние подписки: у «Карго Сити» оплата до 15.09 просрочена (past_due) → grace.
  add('resumePlatformTenant', 'ok', tenantDto(CARGO, { status: 'grace', revision: 2 }));
  add(
    'resumePlatformTenant',
    'invalid_transition',
    problem('invalid_transition', 'Организация не приостановлена.'),
  );
  add(
    'extendPlatformTrial',
    'ok',
    subscription({ trialEndsAt: '2026-10-27T21:00:00Z', revision: 3 }),
  );
  add(
    'extendPlatformTrial',
    'invalid_transition',
    problem('invalid_transition', 'Подписка оплачена: пробный период не продлевается.'),
  );

  // Журнал действий (эталон: «30.09 18:12 · Е. Лаптева», «21.09 09:00 · Система»).
  // subscription.* меняют подписку: цель subscription (id подписки контракт не раскрывает), организация — в tenantId.
  const subscriptionTarget = (t) => ({
    type: 'subscription',
    tenantId: id('platform', t.id),
    name: t.name,
  });
  add(
    'listPlatformAuditEvents',
    'ok',
    page([
      {
        id: '2',
        at: '2026-09-30T15:12:00Z',
        action: 'subscription.trial_started',
        actor: operator,
        target: subscriptionTarget(ALTA),
        result: 'ok',
        details: { days: '14', quotaBytes: String(ALTA.quotaGb * GiB) },
      },
      {
        id: '1',
        at: '2026-09-21T06:00:00Z',
        action: 'subscription.trial_ended',
        actor: { kind: 'system' },
        target: subscriptionTarget(SEED.tenants[2]),
        result: 'ok',
        details: { toStatus: 'read_only' },
      },
    ]),
  );
  add('listPlatformAuditEvents', 'not_found', problem('not_found', 'Организация не найдена.'));

  // Files — список файлов «Альты» (S1-21): файл и сессия загрузки примеров W0.07/W0.08.
  const file = built.getFile.ok;
  const upload = built.getUploadSession.ok;
  add('listFiles', 'ok', page([{ file, purpose: upload.purpose, owner: upload.owner }]));
  add(
    'listFiles',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает открывать файлы.'),
  );

  // Billing — разбивка места «Альты» (S1-22).
  const committedBytes = Math.round((storage.attachments + storage.database) * GiB);
  const photos = Math.round(31.4 * GiB);
  const documents = Math.round(9.8 * GiB);
  const attachments = Math.round(3.1 * GiB);
  const other = committedBytes - photos - documents - attachments;
  const counts = { photos: 1840, documents: 212, attachments: 96, other: 0 };
  const bytes = { photos, documents, attachments, other };
  const MODULE_OF = { photos: 'fleet', documents: 'files', attachments: 'tasks', other: 'core' };
  add('getStorageBreakdown', 'ok', {
    committedBytes,
    groups: Object.keys(bytes).map((key) => ({ key, bytes: bytes[key], fileCount: counts[key] })),
    modules: Object.keys(bytes).map((key) => ({
      moduleKey: MODULE_OF[key],
      bytes: bytes[key],
      fileCount: counts[key],
    })),
    measuredAt: NOW,
    consistency: 'estimated',
  });
  add(
    'getStorageBreakdown',
    'forbidden_action',
    problem('forbidden_action', 'Место организации видит владелец бизнеса.'),
  );

  // Modules — «Затронет сейчас» для «Салона и SPA» (эталон: «Активных процессов нет»).
  add('previewModuleDeactivation', 'ok', {
    moduleKey: 'spa',
    retainedAccess: 'history_read',
    activeItems: [],
    hiddenCount: 0,
    generatedAt: NOW,
  });
  add(
    'previewModuleDeactivation',
    'module_not_installed',
    problem('module_not_installed', 'Модуль «Логистика» не подключён организацией.'),
  );

  // Auth — билет канала реального времени (ADR-0015): 60 секунд, пинг каждые 25 секунд.
  add('createRealtimeTicket', 'ok', {
    // Билет режима mock — «rt1.» + новый UUID (сверка conformance маскирует новые UUID по порядку).
    ticket: `rt1.${id('platform', 'example:realtime-ticket')}`,
    path: '/api/v1/realtime',
    protocol: 'ortus.realtime.v1',
    expiresAt: '2026-10-01T07:31:00Z',
    heartbeatSeconds: 25,
  });
  add(
    'createRealtimeTicket',
    'csrf_failed',
    problem('csrf_failed', 'Перезагрузите страницу и повторите.'),
  );
  // Access — карточка без аккаунта (S1-09): бригада эталона («Олег Смирнов · карточка без входа»).
  add('createMember', 'ok', {
    id: id('t-alta:example', 'm-smirnov'),
    displayName: 'Олег Смирнов',
    status: 'active',
    orgUnitIds: [id('t-alta', 'f-msk-sever')],
    revision: 1,
    workProfiles: [],
  });
  add(
    'createMember',
    'validation_failed',
    problem('validation_failed', 'Выберите подразделение сотрудника.', {
      violations: [
        { field: 'orgUnitIds', code: 'length', message: 'Выберите хотя бы одно подразделение' },
      ],
    }),
  );

  // Функции с периодом (AUTH-05): водитель Илья Васильев — как Go-сид W0.06 (с 01.09.2026 МСК).
  const SEPT = '2026-08-31T21:00:00Z';
  const vasilievDriver = {
    id: id('t-alta', 'work:m-vasiliev:driver'),
    function: 'driver',
    validFrom: SEPT,
    validUntil: null,
    state: 'active',
    revision: 1,
  };
  add('listWorkProfiles', 'ok', { memberId: id('t-alta', 'm-vasiliev'), items: [vasilievDriver] });
  add('listWorkProfiles', 'not_found', problem('not_found', 'Сотрудник не найден.'));
  add('createWorkProfile', 'ok', {
    id: id('t-alta:example', 'work-kotelnikova-manager'),
    function: 'manager',
    validFrom: NOW,
    validUntil: null,
    state: 'active',
    revision: 1,
  });
  add(
    'createWorkProfile',
    'invalid_transition',
    problem('invalid_transition', 'У сотрудника уже есть функция «Водитель» в этот период.'),
  );
  add('updateWorkProfile', 'ok', {
    ...vasilievDriver,
    validUntil: '2026-10-31T21:00:00Z',
    revision: 2,
  });
  add(
    'updateWorkProfile',
    'revision_mismatch',
    problem('revision_mismatch', 'Функцию сотрудника уже изменили. Обновите и повторите.'),
  );

  // Перенос «Север Логистик» из «Москвы» в «Санкт-Петербург» (S1-08): назначений на регионы в сиде нет —
  // доступ ни у кого не меняется; дома в фирме — двое водителей группы «Водители Север».
  add('previewOrgUnitMove', 'ok', {
    orgUnitId: id('t-alta', 'f-msk-sever'),
    fromParentId: id('t-alta', 'r-msk'),
    toParentId: id('t-alta', 'r-spb'),
    descendantUnitCount: 0,
    memberCount: 2,
    assignmentsLosingScope: 0,
    assignmentsGainingScope: 0,
    affectedPeople: [],
    hiddenCount: 0,
  });
  add(
    'previewOrgUnitMove',
    'validation_failed',
    problem('validation_failed', 'Нельзя перенести подразделение внутрь самого себя.', {
      violations: [
        {
          field: 'parentId',
          code: 'cycle',
          message: 'Подразделение не может стать потомком самого себя',
        },
      ],
    }),
  );
  return ex;
}
