// Кейсы второго контрактного PR этапа 1 (W1.00, 0.4.0-stage1): команды оператора и журнал платформы,
// список файлов, разбивка места, предпросмотр отключения модуля, билет канала реального времени, карточка
// без аккаунта, функции с периодом, перенос подразделения, tenantState в /me/context.
import { expect } from 'vitest';

import { type CaseContext, cases } from '../types.ts';

const T = '/api/v1/platform/tenants';
const AUDIT = '/api/v1/platform/audit-events';
const MISSING = '00000000-0000-5000-8000-000000000000';
const REASON = 'Неоплата счёта за октябрь';

interface AuditPage {
  items: { action: string; reason?: string; target: { type: string; tenantId?: string } }[];
}

interface MovePreview {
  affectedPeople: { memberId: string; displayName: string; change: string }[];
  assignmentsGainingScope: number;
  hiddenCount: number;
}

/**
 * Руководитель филиала: Котова (персонаж manager) получает роль с org_units.manage и members.read на регион
 * «Москва» с потомками; Котельникова («Диспетчер · Самара», вне области Котовой) — «Менеджера логистики»
 * в «Юг Транс». Перенос «Север Логистик» под «Юг Транс» даёт Котельниковой доступ к «Северу».
 */
async function branchManager(ctx: CaseContext) {
  const owner = await ctx.as('owner');
  const role = (
    await owner.post(`${ctx.alta}/roles`, {
      name: 'Руководитель филиала',
      permissions: ['org_units.manage', 'members.read'],
    })
  ).body as { id: string };
  const assign = (memberId: string, roleId: string, unit: string) =>
    owner.post(`${ctx.alta}/assignments`, {
      principalType: 'member',
      principalId: memberId,
      roleId,
      scope: { kind: 'org_unit', resourceIds: [unit], includeDescendants: true },
    });
  expect((await assign(ctx.A('m-kotova'), role.id, ctx.A('r-msk'))).status).toBe(201);
  expect(
    (await assign(ctx.A('m-kotelnikova'), ctx.A('r-manager'), ctx.A('f-msk-yug'))).status,
  ).toBe(201);
  return { owner, manager: await ctx.as('manager') };
}

const movePreview = (ctx: CaseContext, unit: string, parent?: string) =>
  `${ctx.alta}/org-units/${ctx.A(unit)}/move-preview${parent ? `?parentId=${ctx.A(parent)}` : ''}`;

export const stage1bCases = cases('stage1b')([
  // Platform — команды оператора с причиной (S1-04).
  {
    title: 'оператор приостанавливает «Альту»',
    operationId: 'suspendPlatformTenant',
    expect: 'success',
    example: 'suspendPlatformTenant/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(
        `${T}/${ctx.P('t-alta')}/suspend`,
        { reason: REASON },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'suspendPlatformTenant/ok');
      const audit = (await op.get(AUDIT)).body as AuditPage;
      expect(audit.items[0]).toMatchObject({
        action: 'tenant.suspended',
        reason: REASON,
        target: { tenantId: ctx.P('t-alta') },
      });
      const owner = await ctx.as('owner');
      const me = (await owner.get('/api/v1/me/context')).body as {
        tenants: { tenantState?: { status: string } }[];
      };
      expect(me.tenants[0]?.tenantState?.status).toBe('suspended');
    },
  },
  {
    title: 'приостановленную «Карго Сити» не приостановить повторно',
    operationId: 'suspendPlatformTenant',
    expect: 'error',
    example: 'suspendPlatformTenant/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(
        `${T}/${ctx.P('t-cargo')}/suspend`,
        { reason: REASON },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'suspendPlatformTenant/invalid_transition');
    },
  },
  {
    title: 'приостановка без причины',
    operationId: 'suspendPlatformTenant',
    expect: 'error',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(`${T}/${ctx.P('t-alta')}/suspend`, {}, { ifMatch: 1 });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'оператор возобновляет «Карго Сити»',
    operationId: 'resumePlatformTenant',
    expect: 'success',
    example: 'resumePlatformTenant/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(
        `${T}/${ctx.P('t-cargo')}/resume`,
        { reason: 'Оплата получена, доступ возобновлён' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'resumePlatformTenant/ok');
    },
  },
  {
    title: 'неприостановленную «Альту» не возобновить',
    operationId: 'resumePlatformTenant',
    expect: 'error',
    example: 'resumePlatformTenant/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(`${T}/${ctx.P('t-alta')}/resume`, { reason: REASON }, { ifMatch: 1 });
      ctx.expectExample(r, 'resumePlatformTenant/invalid_transition');
    },
  },
  {
    title: 'оператор продлевает пробный период «Альты» на 14 дней',
    operationId: 'extendPlatformTrial',
    expect: 'success',
    example: 'extendPlatformTrial/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const r = await op.post(
        `${T}/${ctx.P('t-alta')}/trial-extensions`,
        { days: 14, reason: 'Клиент просит ещё две недели на пилот' },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'extendPlatformTrial/ok');
      // Продление меняет подписку: строка журнала — цель subscription (PlatformAuditTarget, W1.11).
      const audit = (await op.get(AUDIT)).body as AuditPage;
      expect(audit.items[0]).toMatchObject({
        action: 'subscription.trial_extended',
        target: { type: 'subscription', tenantId: ctx.P('t-alta') },
      });
      const owner = await ctx.as('owner');
      const sub = (await owner.get(`${ctx.alta}/subscription`)).body;
      expect(sub).toMatchObject({ trialEndsAt: '2026-10-27T21:00:00Z', revision: 3 });
    },
  },
  {
    title: 'оплаченную подписку «Лотоса» не продлить как пробную',
    operationId: 'extendPlatformTrial',
    expect: 'error',
    example: 'extendPlatformTrial/invalid_transition',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      const url = `${T}/${ctx.P('t-lotos')}/subscription`;
      const { revision } = (await op.get(url)).body as { revision: number };
      const r = await op.post(
        `${T}/${ctx.P('t-lotos')}/trial-extensions`,
        { days: 14, reason: REASON },
        { ifMatch: revision },
      );
      ctx.expectExample(r, 'extendPlatformTrial/invalid_transition');
    },
  },
  {
    title: 'журнал действий платформы на старте',
    operationId: 'listPlatformAuditEvents',
    expect: 'success',
    example: 'listPlatformAuditEvents/ok',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(await op.get(AUDIT), 'listPlatformAuditEvents/ok');
      const alta = (await op.get(`${AUDIT}?tenantId=${ctx.P('t-alta')}`)).body as AuditPage;
      expect(alta.items.map((x) => x.action)).toEqual(['subscription.trial_started']);
    },
  },
  {
    title: 'журнал неизвестной организации',
    operationId: 'listPlatformAuditEvents',
    expect: 'error',
    example: 'listPlatformAuditEvents/not_found',
    run: async (ctx) => {
      const op = await ctx.as('operator');
      ctx.expectExample(
        await op.get(`${AUDIT}?tenantId=${MISSING}`),
        'listPlatformAuditEvents/not_found',
      );
    },
  },

  // Files — список файлов (S1-21).
  {
    title: 'файлы «Альты» у владельца',
    operationId: 'listFiles',
    expect: 'success',
    example: 'listFiles/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(await owner.get(`${ctx.alta}/files`), 'listFiles/ok');
      const none = (await owner.get(`${ctx.alta}/files?status=rejected`)).body as {
        items: unknown[];
      };
      expect(none.items).toEqual([]);
    },
  },
  {
    title: 'массажисту файлы не открыть',
    operationId: 'listFiles',
    expect: 'error',
    example: 'listFiles/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('therapist');
      ctx.expectExample(await s.get(`${ctx.alta}/files`), 'listFiles/forbidden_action');
    },
  },

  // Billing — разбивка места (S1-22).
  {
    title: 'разбивка места «Альты»',
    operationId: 'getStorageBreakdown',
    expect: 'success',
    example: 'getStorageBreakdown/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(await owner.get(`${ctx.alta}/storage/breakdown`), 'getStorageBreakdown/ok');
      const usage = (await owner.get(`${ctx.alta}/storage`)).body as { committedBytes: number };
      const b = (await owner.get(`${ctx.alta}/storage/breakdown`)).body as {
        groups: { bytes: number }[];
        modules: { bytes: number }[];
      };
      const sum = (xs: { bytes: number }[]) => xs.reduce((n, x) => n + x.bytes, 0);
      expect(sum(b.groups)).toBe(usage.committedBytes);
      expect(sum(b.modules)).toBe(usage.committedBytes);
    },
  },
  {
    title: 'менеджеру разбивка места закрыта',
    operationId: 'getStorageBreakdown',
    expect: 'error',
    example: 'getStorageBreakdown/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(
        await s.get(`${ctx.alta}/storage/breakdown`),
        'getStorageBreakdown/forbidden_action',
      );
    },
  },

  // Modules — «Затронет сейчас» (S1-18).
  {
    title: 'отключение «Салона и SPA»: активных процессов нет',
    operationId: 'previewModuleDeactivation',
    expect: 'success',
    example: 'previewModuleDeactivation/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(`${ctx.alta}/modules/spa/deactivation-preview`);
      ctx.expectExample(r, 'previewModuleDeactivation/ok');
      const spa = (await owner.get(`${ctx.alta}/modules/spa`)).body as { state: string };
      expect(spa.state).toBe('active');
    },
  },
  {
    title: 'неподключённую «Логистику» не отключить',
    operationId: 'previewModuleDeactivation',
    expect: 'error',
    example: 'previewModuleDeactivation/module_not_installed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(`${ctx.alta}/modules/fleet/deactivation-preview`);
      ctx.expectExample(r, 'previewModuleDeactivation/module_not_installed');
    },
  },
  {
    title: 'неизвестный модуль — 404',
    operationId: 'previewModuleDeactivation',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectProblem(
        await owner.get(`${ctx.alta}/modules/zoo/deactivation-preview`),
        'not_found',
      );
    },
  },

  // Auth — билет канала реального времени (ADR-0015).
  {
    title: 'билет канала на 60 секунд',
    operationId: 'createRealtimeTicket',
    expect: 'success',
    example: 'createRealtimeTicket/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post('/api/v1/auth/realtime-tickets');
      ctx.expectExample(r, 'createRealtimeTicket/ok', 201);
    },
  },
  {
    title: 'билет не повторяется по Idempotency-Key: каждый вызов — новый билет',
    operationId: 'createRealtimeTicket',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const key = 'realtime-ticket-key-000001';
      const o = { idempotencyKey: key, headers: { 'Idempotency-Key': key } };
      const a = await owner.post('/api/v1/auth/realtime-tickets', undefined, o);
      const b = await owner.post('/api/v1/auth/realtime-tickets', undefined, o);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(b.headers.get('Idempotency-Replayed')).toBeNull();
      const ticket = (x: { body: unknown }) => (x.body as { ticket: string }).ticket;
      expect(ticket(b)).not.toBe(ticket(a));
    },
  },
  {
    title: 'билет без CSRF-токена',
    operationId: 'createRealtimeTicket',
    expect: 'error',
    example: 'createRealtimeTicket/csrf_failed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post('/api/v1/auth/realtime-tickets', undefined, { csrf: false });
      ctx.expectExample(r, 'createRealtimeTicket/csrf_failed');
    },
  },
  {
    title: 'билет без сессии — 401',
    operationId: 'createRealtimeTicket',
    expect: 'error',
    run: async (ctx) => {
      ctx.expectProblem(await ctx.anon().post('/api/v1/auth/realtime-tickets'), 'session_expired');
    },
  },

  // Access — карточка без аккаунта (S1-09).
  {
    title: 'карточка без входа «Олег Смирнов» не занимает место',
    operationId: 'createMember',
    expect: 'success',
    example: 'createMember/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post(`${ctx.alta}/members`, {
        displayName: 'Олег Смирнов',
        orgUnitIds: [ctx.A('f-msk-sever')],
      });
      ctx.expectExample(r, 'createMember/ok', 201);
      // Мест у «Альты» 9 из 10: карточка места не заняла — последнее место ещё можно отдать приглашению.
      const invite = await owner.post(`${ctx.alta}/invitations`, {
        email: 'i.testov@alta.example',
        displayName: 'Иван Тестов',
        orgUnitIds: [ctx.A('f-msk-sever')],
        roleAssignments: [],
      });
      expect(invite.status).toBe(201);
      const list = (await owner.get(`${ctx.alta}/members?limit=200`)).body as {
        items: { displayName: string }[];
      };
      expect(list.items.map((m) => m.displayName)).toContain('Олег Смирнов');
    },
  },
  {
    title: 'карточка без подразделения',
    operationId: 'createMember',
    expect: 'error',
    example: 'createMember/validation_failed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post(`${ctx.alta}/members`, {
        displayName: 'Олег Смирнов',
        orgUnitIds: [],
      });
      ctx.expectExample(r, 'createMember/validation_failed');
    },
  },

  // Access — функции с периодом (S1-09, AUTH-05).
  {
    title: 'функции водителя Васильева',
    operationId: 'listWorkProfiles',
    expect: 'success',
    example: 'listWorkProfiles/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(`${ctx.alta}/members/${ctx.A('m-vasiliev')}/work-profiles`);
      ctx.expectExample(r, 'listWorkProfiles/ok');
    },
  },
  {
    title: 'функции неизвестного сотрудника',
    operationId: 'listWorkProfiles',
    expect: 'error',
    example: 'listWorkProfiles/not_found',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(`${ctx.alta}/members/${MISSING}/work-profiles`);
      ctx.expectExample(r, 'listWorkProfiles/not_found');
    },
  },
  {
    title: 'Котельникова получает функцию «менеджер»',
    operationId: 'createWorkProfile',
    expect: 'success',
    example: 'createWorkProfile/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post(`${ctx.alta}/members/${ctx.A('m-kotelnikova')}/work-profiles`, {
        function: 'manager',
        validFrom: '2026-10-01T07:30:00Z',
      });
      ctx.expectExample(r, 'createWorkProfile/ok', 201);
      const m = (await owner.get(`${ctx.alta}/members/${ctx.A('m-kotelnikova')}`)).body as {
        workProfiles: string[];
      };
      expect(m.workProfiles).toContain('manager');
    },
  },
  {
    title: 'вторая функция «Водитель» в тот же период',
    operationId: 'createWorkProfile',
    expect: 'error',
    example: 'createWorkProfile/invalid_transition',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.post(`${ctx.alta}/members/${ctx.A('m-vasiliev')}/work-profiles`, {
        function: 'driver',
        validFrom: '2026-10-05T06:00:00Z',
      });
      ctx.expectExample(r, 'createWorkProfile/invalid_transition');
    },
  },
  {
    title: 'функция водителя заканчивается 31 октября',
    operationId: 'updateWorkProfile',
    expect: 'success',
    example: 'updateWorkProfile/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const url = `${ctx.alta}/members/${ctx.A('m-vasiliev')}/work-profiles/${ctx.A('work:m-vasiliev:driver')}`;
      const r = await owner.patch(url, { validUntil: '2026-10-31T21:00:00Z' }, { ifMatch: 1 });
      ctx.expectExample(r, 'updateWorkProfile/ok');
    },
  },
  {
    title: 'устаревшая ревизия функции',
    operationId: 'updateWorkProfile',
    expect: 'error',
    example: 'updateWorkProfile/revision_mismatch',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const url = `${ctx.alta}/members/${ctx.A('m-vasiliev')}/work-profiles/${ctx.A('work:m-vasiliev:driver')}`;
      const r = await owner.patch(url, { validUntil: '2026-10-31T21:00:00Z' }, { ifMatch: 7 });
      ctx.expectExample(r, 'updateWorkProfile/revision_mismatch');
    },
  },

  // Access — перенос подразделения (S1-08).
  {
    title: 'перенос «Север Логистик» в «Санкт-Петербург»',
    operationId: 'previewOrgUnitMove',
    expect: 'success',
    example: 'previewOrgUnitMove/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(
        `${ctx.alta}/org-units/${ctx.A('f-msk-sever')}/move-preview?parentId=${ctx.A('r-spb')}`,
      );
      ctx.expectExample(r, 'previewOrgUnitMove/ok');
      const unit = (await owner.get(`${ctx.alta}/org-units/${ctx.A('f-msk-sever')}`)).body as {
        parentId: string;
      };
      expect(unit.parentId).toBe(ctx.A('r-msk'));
    },
  },
  {
    title: 'перенос региона внутрь своей фирмы',
    operationId: 'previewOrgUnitMove',
    expect: 'error',
    example: 'previewOrgUnitMove/validation_failed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(
        `${ctx.alta}/org-units/${ctx.A('r-msk')}/move-preview?parentId=${ctx.A('f-msk-sever')}`,
      );
      ctx.expectExample(r, 'previewOrgUnitMove/validation_failed');
    },
  },
  {
    title: 'руководитель филиала: перенос в чужой регион и на верхний уровень — 403',
    operationId: 'previewOrgUnitMove',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await branchManager(ctx);
      ctx.expectProblem(
        await manager.get(movePreview(ctx, 'f-msk-sever', 'r-spb')),
        'forbidden_action',
      );
      ctx.expectProblem(await manager.get(movePreview(ctx, 'f-msk-sever')), 'forbidden_action');
    },
  },
  {
    title: 'руководитель филиала: люди вне его области — только в hiddenCount',
    operationId: 'previewOrgUnitMove',
    expect: 'success',
    run: async (ctx) => {
      const { owner, manager } = await branchManager(ctx);
      const all = (await owner.get(movePreview(ctx, 'f-msk-sever', 'f-msk-yug')))
        .body as MovePreview;
      expect(all.affectedPeople).toEqual([
        expect.objectContaining({ displayName: 'Вера Котельникова', change: 'gains' }),
      ]);
      expect(all.hiddenCount).toBe(0);
      const r = await manager.get(movePreview(ctx, 'f-msk-sever', 'f-msk-yug'));
      expect(r.status).toBe(200);
      const mine = r.body as MovePreview;
      expect(mine.affectedPeople).toEqual([]);
      expect(mine.hiddenCount).toBe(1);
    },
  },
  {
    // Ревью W1.00 (возврат 2): hiddenCount считает людей, а не назначения — иначе счёт подсказывает,
    // сколько назначений у человека вне области действующего.
    title: 'человек с двумя назначениями на новом предке — в hiddenCount один раз',
    operationId: 'previewOrgUnitMove',
    expect: 'success',
    run: async (ctx) => {
      const { owner, manager } = await branchManager(ctx);
      const second = (
        await owner.post(`${ctx.alta}/roles`, {
          name: 'Наставник филиала',
          permissions: ['members.read'],
        })
      ).body as { id: string };
      const r2 = await owner.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-kotelnikova'),
        roleId: second.id,
        scope: { kind: 'org_unit', resourceIds: [ctx.A('f-msk-yug')], includeDescendants: true },
      });
      expect(r2.status).toBe(201);
      const all = (await owner.get(movePreview(ctx, 'f-msk-sever', 'f-msk-yug')))
        .body as MovePreview;
      expect(all.assignmentsGainingScope).toBe(2);
      expect(all.affectedPeople).toHaveLength(2);
      expect(new Set(all.affectedPeople.map((p) => p.memberId)).size).toBe(1);
      expect(all.hiddenCount).toBe(0);
      const mine = (await manager.get(movePreview(ctx, 'f-msk-sever', 'f-msk-yug')))
        .body as MovePreview;
      expect(mine.affectedPeople).toEqual([]);
      expect(mine.hiddenCount).toBe(1);
    },
  },
]);
