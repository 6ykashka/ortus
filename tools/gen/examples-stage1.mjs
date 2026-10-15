// Примеры операций этапа 1 (W0.08, бриф docs/plan/v2/ws/W0.08.md §4.1) на сиде прототипа 14.10.
// Подключается в tools/gen/examples-seed.mjs: `node tools/gen/examples-seed.mjs` пересобирает и их.
// Сюжеты: Олеся Петрова (m-petrova, приглашена) принимает приглашение в «Альта Групп»; Анна Морозова
// переключается на «SPA «Лотос»»; входящие владельца; группы «Диспетчеры Север» и «Водители Север»;
// передача владения Котовой; «Почему доступно» для Котовой с ролью на проект (PD-53); импорт водителей.
// Новые объекты примеров — область `<организация>:example` (PD-30), как в examples-seed.mjs.

/** @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело */
export function stage1Examples(h) {
  const {
    id,
    membershipId,
    problem,
    me,
    tenantContext,
    grantsOf,
    allTenant,
    scopeOf,
    page,
    catalog,
    SEED,
    NOW,
  } = h;
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const alta = SEED.alta;
  const ALTA_ID = id('platform', 't-alta');
  const account = (accId) => SEED.accounts.find((a) => a[0] === accId);
  const created = '2026-09-30T15:12:00Z';

  // Auth — ответы-редиректы без тела: только примеры ошибок.
  add(
    'startLogin',
    'malformed_request',
    problem('malformed_request', 'returnTo должен быть относительным путём приложения.'),
  );
  add(
    'startLogin',
    'dependency_unavailable',
    problem('dependency_unavailable', 'Сервис входа временно недоступен. Повторите позже.'),
  );
  add(
    'completeLogin',
    'session_expired',
    problem('session_expired', 'Ссылка входа устарела. Войдите снова.'),
  );
  add(
    'completeLogin',
    'forbidden_action',
    problem('forbidden_action', 'Вход для этого аккаунта заблокирован оператором платформы.'),
  );
  add('getCsrfToken', 'ok', {
    csrfToken: 'q7N2c9Vt4LmX8pR1sK5wZ3yH6dJ0fB2e',
    headerName: 'X-CSRF-Token',
    expiresAt: '2026-10-01T15:30:00Z',
  });
  add('getCsrfToken', 'session_expired', problem('session_expired', 'Сессия истекла.'));
  add('logout', 'ok', {
    endSessionUrl:
      'https://id.example.invalid/realms/ortus/protocol/openid-connect/logout?client_id=ortus-web',
  });
  add('logout', 'csrf_failed', problem('csrf_failed', 'Перезагрузите страницу и повторите.'));
  const preview = {
    tenantName: 'Альта Групп',
    invitedEmailMasked: 'o•••••@alta.example',
    status: 'pending',
    expiresAt: '2026-10-08T07:30:00Z',
  };
  add('inspectInvitation', 'ok', preview);
  add('inspectInvitation', 'expired', { ...preview, status: 'expired' });
  add('inspectInvitation', 'not_found', problem('not_found', 'Приглашение не найдено.'));
  add('acceptInvitation', 'ok', {
    tenantId: ALTA_ID,
    membershipId: membershipId('t-alta', 'm-petrova'),
    tenantName: 'Альта Групп',
    membershipStatus: 'active',
  });
  add(
    'acceptInvitation',
    'forbidden_action',
    problem(
      'forbidden_action',
      'Приглашение отправлено на другой адрес. Войдите под o•••••@alta.example.',
    ),
  );
  add(
    'acceptInvitation',
    'public_token_expired',
    problem('public_token_expired', 'Срок приглашения истёк. Попросите владельца прислать новое.'),
  );
  add(
    'acceptInvitation',
    'seats_exhausted',
    problem(
      'seats_exhausted',
      'Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.',
    ),
  );

  // Context — переключатель бизнеса и входящие.
  add('selectTenant', 'ok', {
    ...me('acc-4', [
      tenantContext('t-alta', 'm-morozova', grantsOf('t-alta', 'm-morozova')),
      tenantContext('t-lotos', 'm-morozova', [
        {
          keys: [
            'spa.appointments.read',
            'spa.appointments.create',
            'calendar.bookings.read',
            'calendar.bookings.manage',
            'knowledge.read',
          ],
          scope: scopeOf('t-lotos', { type: 'self' }),
        },
      ]),
    ]),
    lastTenantId: id('platform', 't-lotos'),
  });
  add('selectTenant', 'not_found', problem('not_found', 'Организация не найдена среди ваших.'));
  const note = (key, kind, severity, title, at, extra = {}) => ({
    id: id('t-alta:example', key),
    tenantId: ALTA_ID,
    kind,
    severity,
    title,
    createdAt: at,
    readAt: null,
    ...extra,
  });
  add('listMyNotifications', 'ok', {
    items: [
      note(
        'n-invite-accepted',
        'members.invitation.accepted',
        'info',
        'Олеся Петрова приняла приглашение',
        '2026-10-01T07:12:00Z',
        {
          object: {
            moduleKey: 'members',
            entityType: 'member',
            entityId: id('t-alta', 'm-petrova'),
          },
          link: '/users',
        },
      ),
      note(
        'n-trial-extended',
        'platform.trial.extended',
        'warning',
        'Оператор платформы продлил пробный период на 14 дней',
        '2026-10-01T06:40:00Z',
        { link: '/billing' },
      ),
      note(
        'n-module-spa',
        'modules.module.enabled',
        'info',
        'Подключён модуль «Салон и SPA»',
        '2026-09-30T16:02:00Z',
        { readAt: '2026-09-30T16:05:00Z', link: '/modules' },
      ),
    ],
    nextCursor: null,
    unreadCount: 2,
  });
  add('listMyNotifications', 'empty', { items: [], nextCursor: null, unreadCount: 0 });
  add(
    'listMyNotifications',
    'not_found',
    problem('not_found', 'Организация не найдена среди ваших.'),
  );
  add('getMyNotificationSummary', 'ok', {
    totalUnread: 2,
    tenants: [{ tenantId: ALTA_ID, unreadCount: 2, latestAt: '2026-10-01T07:12:00Z' }],
  });
  add('getMyNotificationSummary', 'session_expired', problem('session_expired', 'Сессия истекла.'));
  add('markMyNotificationsRead', 'ok', { tenantId: ALTA_ID, unreadCount: 0 });
  add(
    'markMyNotificationsRead',
    'validation_failed',
    problem('validation_failed', 'Укажите либо список уведомлений, либо момент upTo.', {
      violations: [
        { field: 'upTo', code: 'exclusive', message: 'Нельзя вместе с notificationIds' },
      ],
    }),
  );

  // Access — группы.
  const units = Object.fromEntries(alta.firms.map(([uid]) => [uid, id('t-alta', uid)]));
  const groupDto = (gid, patch = {}) => ({
    id: id('t-alta', gid),
    name: alta.groups[gid],
    description: '',
    homeUnitId: units['f-msk-sever'],
    memberIds: alta.groupMembers[gid].map((m) => id('t-alta', m)),
    hiddenMemberCount: 0,
    assignmentCount: alta.assignments.filter(([, p]) => p === gid).length,
    revision: 1,
    createdAt: created,
    ...patch,
  });
  add('listGroups', 'ok', page([groupDto('g-disp'), groupDto('g-drv')]));
  add(
    'listGroups',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать участников.'),
  );
  add('createGroup', 'ok', {
    id: id('t-alta:example', 'g-smr-log'),
    name: 'Логисты Самара',
    description: 'Менеджеры фирм региона Самара',
    homeUnitId: id('t-alta', 'r-smr'),
    memberIds: [],
    hiddenMemberCount: 0,
    assignmentCount: 0,
    revision: 1,
    createdAt: NOW,
  });
  add(
    'createGroup',
    'validation_failed',
    problem('validation_failed', 'Группа с таким названием уже есть.', {
      violations: [
        { field: 'name', code: 'already_exists', message: 'Группа с таким названием уже есть' },
      ],
    }),
  );
  add('getGroup', 'ok', groupDto('g-drv'));
  add('getGroup', 'not_found', problem('not_found', 'Группа не найдена.'));
  add('updateGroup', 'ok', groupDto('g-disp', { name: 'Диспетчеры Москва · Север', revision: 2 }));
  add(
    'updateGroup',
    'revision_mismatch',
    problem('revision_mismatch', 'Группу уже изменили. Обновите и повторите.'),
  );
  add(
    'deleteGroup',
    'invalid_transition',
    problem(
      'invalid_transition',
      'У группы «Водители Север» есть назначения ролей. Сначала снимите их.',
    ),
  );
  add(
    'deleteGroup',
    'revision_mismatch',
    problem('revision_mismatch', 'Группу уже изменили. Обновите и повторите.'),
  );
  add(
    'setGroupMembers',
    'ok',
    groupDto('g-drv', {
      memberIds: ['m-vasiliev', 'm-gromov', 'm-akhmedov'].map((m) => id('t-alta', m)),
      revision: 2,
    }),
  );
  add(
    'setGroupMembers',
    'delegation_exceeds_grant',
    problem(
      'delegation_exceeds_grant',
      'Группа даёт роль «Водитель» в фирме «Север Логистик», а у вас нет права назначать её там.',
    ),
  );
  add(
    'setGroupMembers',
    'separation_of_duties_conflict',
    problem(
      'separation_of_duties_conflict',
      'Функция «Водитель» несовместима с правом на начисления (правило MVP).',
    ),
  );

  // Access — владельцы.
  const owner = (mid, since) => {
    const m = alta.members.find((x) => x[0] === mid);
    const a = account(m[1]);
    return { memberId: id('t-alta', mid), displayName: a[1], email: a[2], since };
  };
  add('listOwners', 'ok', { items: [owner('m-owner', created)] });
  add(
    'listOwners',
    'forbidden_action',
    problem('forbidden_action', 'Ни одна роль не разрешает просматривать участников.'),
  );
  add('transferOwnership', 'ok', { items: [owner('m-owner', created), owner('m-kotova', NOW)] });
  add(
    'transferOwnership',
    'validation_failed',
    problem('validation_failed', 'Подтверждение не совпадает с почтой получателя.', {
      violations: [
        {
          field: 'confirmation',
          code: 'mismatch',
          message: 'Введите почту m.kotova@alta.example',
        },
      ],
    }),
  );
  add(
    'transferOwnership',
    'session_expired',
    problem(
      'session_expired',
      'Для передачи владения войдите снова: вход был больше 10 минут назад.',
    ),
  );
  add(
    'transferOwnership',
    'invalid_transition',
    problem('invalid_transition', 'Владельцем может стать только активный участник.'),
  );
  add(
    'revokeOwnership',
    'last_owner_required',
    problem('last_owner_required', 'Нельзя снять последнего владельца'),
  );

  // Access — «Почему доступно» (PD-53: роль на проект не даёт права без объекта).
  const pm = catalog.role_templates.project_manager.actions;
  if (!pm.includes('tasks.update')) throw new Error('project_manager без tasks.update');
  const ap1 = alta.assignments.find((a) => a[0] === 'ap1');
  const checks = (failed, detail) =>
    [
      'tenant-membership-and-binding',
      'tenant-state',
      'module-installation',
      'plan-entitlement',
      'separation-of-duties',
      'permission',
    ].map((check) =>
      check === failed ? { check, passed: false, detail } : { check, passed: true },
    );
  add('explainAccess', 'ok', {
    memberId: id('t-alta', 'm-kotova'),
    permission: 'tasks.update',
    allowed: false,
    decisiveCheck: 'permission',
    denyCode: 'forbidden_action',
    checks: checks(
      'permission',
      'Право есть только в роли на проект: без задачи этого проекта оно не действует (PD-53).',
    ),
    grants: [
      {
        assignmentId: id('t-alta', ap1[0]),
        roleId: id('t-alta', ap1[2]),
        roleName: 'Руководитель проекта',
        via: 'direct',
        scope: scopeOf('t-alta', ap1[3]),
        matches: false,
        mismatch: 'object_scope_without_object',
      },
    ],
    hiddenGrants: false,
    policyVersion: '2026-10-01T07:30:00Z.1',
  });
  add('explainAccess', 'allowed', {
    memberId: id('t-alta', 'm-owner'),
    permission: 'members.invite',
    allowed: true,
    decisiveCheck: 'permission',
    checks: checks(null),
    grants: [
      {
        assignmentId: id('t-alta', 'a1'),
        roleId: id('t-alta', 'r-owner'),
        roleName: 'Владелец бизнеса',
        via: 'direct',
        scope: allTenant('t-alta')[0].scope,
        matches: true,
      },
    ],
    hiddenGrants: false,
    policyVersion: '2026-10-01T07:30:00Z.1',
  });
  add('explainAccess', 'not_found', problem('not_found', 'Участник не найден.'));

  // Access — импорт CSV людей (S1-10).
  const sever = units['f-msk-sever'];
  const rows = [
    {
      line: 2,
      action: 'create',
      fullName: 'Семён Лапин',
      email: 's.lapin@alta.example',
      phone: '+7 916 555-01-02',
      orgUnitId: sever,
      workProfile: 'driver',
      errors: [],
    },
    {
      line: 3,
      action: 'update',
      fullName: 'Илья Васильев',
      email: 'i.vasiliev@alta.example',
      orgUnitId: sever,
      workProfile: 'driver',
      memberId: id('t-alta', 'm-vasiliev'),
      errors: [],
    },
    {
      line: 4,
      action: 'error',
      fullName: 'Пётр Карпов',
      email: 'p.karpov@',
      errors: [{ field: 'email', code: 'format', message: 'Неверный адрес почты' }],
    },
  ];
  const imp = {
    id: id('t-alta:example', 'imp-drivers-sever'),
    state: 'previewed',
    fileName: 'Водители Север.csv',
    defaultOrgUnitId: sever,
    totals: { rows: 3, create: 1, update: 1, skip: 0, error: 1, invited: 0 },
    rows,
    createdAt: NOW,
    expiresAt: '2026-10-02T07:30:00Z',
    revision: 1,
  };
  add('createPeopleImport', 'ok', imp);
  add(
    'createPeopleImport',
    'payload_too_large',
    problem('payload_too_large', 'Файл больше 1 МБ или 2000 строк. Разделите его на части.'),
  );
  add(
    'createPeopleImport',
    'validation_failed',
    problem('validation_failed', 'В файле нет обязательной колонки full_name.', {
      violations: [
        { field: 'csv', code: 'missing_column', message: 'Нет колонки full_name (ФИО)' },
      ],
    }),
  );
  add('getPeopleImport', 'ok', imp);
  add('getPeopleImport', 'not_found', problem('not_found', 'Импорт не найден или истёк.'));
  add('commitPeopleImport', 'ok', {
    ...imp,
    state: 'committed',
    totals: { rows: 3, create: 1, update: 1, skip: 1, error: 0, invited: 1 },
    rows: [
      { ...rows[0], memberId: id('t-alta:example', 'm-lapin') },
      rows[1],
      { ...rows[2], action: 'skip' },
    ],
    committedAt: '2026-10-01T07:34:00Z',
    revision: 2,
  });
  add(
    'commitPeopleImport',
    'seats_exhausted',
    problem(
      'seats_exhausted',
      'Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.',
    ),
  );
  add(
    'commitPeopleImport',
    'invalid_transition',
    problem('invalid_transition', 'Импорт уже применён.'),
  );

  // Files — сессия загрузки (S1-20).
  add('getUploadSession', 'ok', {
    uploadId: id('t-alta:example', 'upload-insp-208-front'),
    fileId: id('t-alta', 'file-insp-208-front'),
    state: 'completed',
    purpose: 'inspection',
    owner: {
      moduleKey: 'fleet',
      entityType: 'reservation',
      entityId: id('t-alta:example', 'res-208'),
    },
    sizeBytes: 2457600,
    reservedBytes: 2457600,
    ticketExpiresAt: '2026-10-01T06:20:00Z',
    sessionExpiresAt: '2026-10-01T07:05:00Z',
    fileStatus: 'quarantined',
    createdAt: '2026-10-01T06:05:00Z',
  });
  add('getUploadSession', 'not_found', problem('not_found', 'Загрузка не найдена или истекла.'));
  add(
    'abortUpload',
    'invalid_transition',
    problem('invalid_transition', 'Загрузка уже завершена: файл на проверке.'),
  );
  return ex;
}
