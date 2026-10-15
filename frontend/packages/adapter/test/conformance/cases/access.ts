// Кейсы тега Access (W0.13): участники и приглашения, роли, назначения, оргструктура, группы, владельцы,
// «Почему доступно», импорт CSV. Правила: SoD «Водитель» ↔ начисления, последний владелец, делегирование.
import { expect } from 'vitest';

import type { Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const MISSING = '00000000-0000-5000-8000-000000000000';
const SCOPE_SEVER = (ctx: CaseContext) => ({
  kind: 'org_unit',
  resourceIds: [ctx.A('f-msk-sever')],
  includeDescendants: true,
});

const CSV = [
  'full_name,email,phone,work_profile',
  'Семён Лапин,s.lapin@alta.example,+7 916 555-01-02,driver',
  'Илья Васильев,i.vasiliev@alta.example,,driver',
  'Пётр Карпов,p.karpov@,,',
].join('\n');

async function createImport(ctx: CaseContext, s: Session) {
  return s.post(`${ctx.alta}/people-imports`, {
    fileName: 'Водители Север.csv',
    csv: CSV,
    defaultOrgUnitId: ctx.A('f-msk-sever'),
  });
}

/** Котова — «Менеджер логистики» в «Север Логистик» (пример createAssignment/ok). */
async function kotovaManager(ctx: CaseContext, owner: Session) {
  return owner.post(`${ctx.alta}/assignments`, {
    principalType: 'member',
    principalId: ctx.A('m-kotova'),
    roleId: ctx.A('r-manager'),
    scope: SCOPE_SEVER(ctx),
  });
}

export const accessCases = cases('access')([
  // ── участники ───────────────────────────────────────────────────────────────────────────────
  {
    title: 'участники «Альты»',
    operationId: 'listMembers',
    expect: 'success',
    example: 'listMembers/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/members`), 'listMembers/ok');
      const sever = (await s.get(`${ctx.alta}/members?orgUnitId=${ctx.A('f-msk-sever')}`)).body as {
        items: { displayName: string }[];
      };
      expect(sever.items.map((m) => m.displayName)).toEqual(['Илья Васильев', 'Кирилл Громов']);
    },
  },
  {
    title: 'логисту участники закрыты',
    operationId: 'listMembers',
    expect: 'error',
    example: 'listMembers/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/members`), 'listMembers/forbidden_action');
    },
  },
  {
    title: 'менеджер логистики видит участников своей фирмы',
    operationId: 'listMembers',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const s = await ctx.as('manager');
      const r = (await s.get(`${ctx.alta}/members`)).body as { items: { displayName: string }[] };
      expect(r.items.map((m) => m.displayName)).toEqual(['Илья Васильев', 'Кирилл Громов']);
    },
  },
  {
    title: 'приглашение Ивана Тестова',
    operationId: 'inviteMember',
    expect: 'success',
    example: 'inviteMember/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/invitations`, {
        email: 'i.testov@alta.example',
        displayName: 'Иван Тестов',
        orgUnitIds: [ctx.A('f-msk-sever')],
        roleAssignments: [{ roleId: ctx.A('r-driver'), scope: SCOPE_SEVER(ctx) }],
      });
      ctx.expectExample(r, 'inviteMember/ok', 201);
      const members = (await s.get(`${ctx.alta}/members`)).body as {
        items: { displayName: string; status: string }[];
      };
      expect(members.items.at(-1)).toMatchObject({ displayName: 'Иван Тестов', status: 'invited' });
    },
  },
  {
    title: 'почта уже есть среди участников',
    operationId: 'inviteMember',
    expect: 'error',
    example: 'inviteMember/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/invitations`, {
        email: 'm.kotova@alta.example',
        orgUnitIds: [],
        roleAssignments: [],
      });
      ctx.expectExample(r, 'inviteMember/validation_failed');
    },
  },
  {
    title: 'мест нет — 409 seats_exhausted',
    operationId: 'inviteMember',
    expect: 'error',
    run: async (ctx) => {
      ctx.server.applyPreset('seats-full');
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/invitations`, {
        email: 'n.novikov@alta.example',
        orgUnitIds: [],
        roleAssignments: [],
      });
      ctx.expectProblem(r, 'seats_exhausted');
      expect((r.body as { detail: string }).detail).toBe(
        'Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.',
      );
    },
  },
  {
    title: 'карточка Марины Котовой',
    operationId: 'getMember',
    expect: 'success',
    example: 'getMember/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/members/${ctx.A('m-kotova')}`), 'getMember/ok');
    },
  },
  {
    title: 'неизвестный участник',
    operationId: 'getMember',
    expect: 'error',
    example: 'getMember/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/members/${MISSING}`), 'getMember/not_found');
    },
  },
  {
    title: 'Кирилл Громов снова активен',
    operationId: 'updateMember',
    expect: 'success',
    example: 'updateMember/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/members/${ctx.A('m-gromov')}`,
        { status: 'active' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateMember/ok');
      const gromov = await ctx.as('acc-7');
      expect((await gromov.get(`${ctx.alta}/members`)).status).toBe(403);
    },
  },
  {
    title: 'устаревшая карточка',
    operationId: 'updateMember',
    expect: 'error',
    example: 'updateMember/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/members/${ctx.A('m-gromov')}`,
        { status: 'active' },
        { ifMatch: 4 },
      );
      ctx.expectExample(r, 'updateMember/revision_mismatch');
    },
  },
  {
    title: 'функция «Водитель» логисту с начислениями — SoD',
    operationId: 'updateMember',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await kotovaManager(ctx, s);
      const r = await s.patch(
        `${ctx.alta}/members/${ctx.A('m-kotova')}`,
        { workProfiles: ['driver'] },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'separation_of_duties_conflict');
    },
  },
  {
    title: 'последнего владельца не приостановить',
    operationId: 'updateMember',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/members/${ctx.A('m-owner')}`,
        { status: 'suspended' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'last_owner_required');
    },
  },
  // ── роли ────────────────────────────────────────────────────────────────────────────────────
  {
    title: 'роли «Альты»',
    operationId: 'listRoles',
    expect: 'success',
    example: 'listRoles/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/roles`), 'listRoles/ok');
    },
  },
  {
    title: 'логисту роли закрыты',
    operationId: 'listRoles',
    expect: 'error',
    example: 'listRoles/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/roles`), 'listRoles/forbidden_action');
    },
  },
  {
    title: 'новая роль «Диспетчер»',
    operationId: 'createRole',
    expect: 'success',
    example: 'createRole/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/roles`, {
        name: 'Диспетчер',
        description: 'Видит машины, рейсы и маршруты своей области',
        permissions: [
          'fleet.vehicles.read',
          'fleet.trips.read',
          'fleet.routes.read',
          'calendar.bookings.read',
        ],
      });
      ctx.expectExample(r, 'createRole/ok', 201);
    },
  },
  {
    title: 'роль без названия',
    operationId: 'createRole',
    expect: 'error',
    example: 'createRole/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/roles`, { name: '', permissions: ['fleet.trips.read'] });
      ctx.expectExample(r, 'createRole/validation_failed');
    },
  },
  {
    title: 'право вне каталога',
    operationId: 'createRole',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/roles`, { name: 'X', permissions: ['fleet.teleport'] });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'роль «Менеджер логистики»',
    operationId: 'getRole',
    expect: 'success',
    example: 'getRole/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/roles/${ctx.A('r-manager')}`), 'getRole/ok');
    },
  },
  {
    title: 'неизвестная роль',
    operationId: 'getRole',
    expect: 'error',
    example: 'getRole/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/roles/${MISSING}`), 'getRole/not_found');
    },
  },
  {
    title: 'переименование роли «Водитель»',
    operationId: 'updateRole',
    expect: 'success',
    example: 'updateRole/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/roles/${ctx.A('r-driver')}`,
        { name: 'Водитель (Север)' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateRole/ok');
    },
  },
  {
    title: 'начисления в роли «Водитель» — SoD',
    operationId: 'updateRole',
    expect: 'error',
    example: 'updateRole/separation_of_duties_conflict',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const role = (await s.get(`${ctx.alta}/roles/${ctx.A('r-driver')}`)).body as {
        permissions: string[];
      };
      const r = await s.patch(
        `${ctx.alta}/roles/${ctx.A('r-driver')}`,
        { permissions: [...role.permissions, 'fleet.earnings.read'] },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateRole/separation_of_duties_conflict');
    },
  },
  {
    title: 'удаление новой роли',
    operationId: 'deleteRole',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const role = (await s.post(`${ctx.alta}/roles`, { name: 'Временная', permissions: [] }))
        .body as { id: string };
      const r = await s.delete(`${ctx.alta}/roles/${role.id}`, { ifMatch: 1 });
      expect(r.status).toBe(204);
      expect(r.body).toBeUndefined();
      ctx.expectProblem(await s.get(`${ctx.alta}/roles/${role.id}`), 'not_found');
    },
  },
  {
    title: 'системную роль нельзя удалить',
    operationId: 'deleteRole',
    expect: 'error',
    example: 'deleteRole/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/roles/${ctx.A('r-owner')}`, { ifMatch: 1 });
      ctx.expectExample(r, 'deleteRole/invalid_transition');
    },
  },
  {
    title: 'удаление устаревшей роли',
    operationId: 'deleteRole',
    expect: 'error',
    example: 'deleteRole/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/roles/${ctx.A('r-viewer')}`, { ifMatch: 3 });
      ctx.expectExample(r, 'deleteRole/revision_mismatch');
    },
  },
  // ── назначения ──────────────────────────────────────────────────────────────────────────────
  {
    title: 'назначения «Альты»',
    operationId: 'listAssignments',
    expect: 'success',
    example: 'listAssignments/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/assignments`), 'listAssignments/ok');
    },
  },
  {
    title: 'логисту назначения закрыты',
    operationId: 'listAssignments',
    expect: 'error',
    example: 'listAssignments/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/assignments`), 'listAssignments/forbidden_action');
    },
  },
  {
    title: 'Котова — менеджер логистики в «Север Логистик»',
    operationId: 'createAssignment',
    expect: 'success',
    example: 'createAssignment/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await kotovaManager(ctx, s), 'createAssignment/ok', 201);
      const kotova = await ctx.as('manager');
      expect((await kotova.get(`${ctx.alta}/members`)).status).toBe(200);
    },
  },
  {
    title: 'начисления водителю — SoD',
    operationId: 'createAssignment',
    expect: 'error',
    example: 'createAssignment/separation_of_duties_conflict',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-vasiliev'),
        roleId: ctx.A('r-manager'),
        scope: SCOPE_SEVER(ctx),
      });
      ctx.expectExample(r, 'createAssignment/separation_of_duties_conflict');
    },
  },
  {
    title: 'делегирование сверх своего права',
    operationId: 'createAssignment',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const hr = (
        await owner.post(`${ctx.alta}/roles`, {
          name: 'Кадровик',
          permissions: ['members.read', 'roles.read', 'roles.assign'],
        })
      ).body as { id: string };
      await owner.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-kotova'),
        roleId: hr.id,
        scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
      });
      const kotova = await ctx.as('manager');
      const r = await kotova.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-akhmedov'),
        roleId: ctx.A('r-driver'),
        scope: SCOPE_SEVER(ctx),
      });
      ctx.expectProblem(r, 'delegation_exceeds_grant');
    },
  },
  {
    title: 'снятие назначения массажистки',
    operationId: 'revokeAssignment',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/assignments/${ctx.A('a3')}`);
      expect(r.status).toBe(204);
      const list = (await s.get(`${ctx.alta}/assignments`)).body as { items: { id: string }[] };
      expect(list.items.map((a) => a.id)).not.toContain(ctx.A('a3'));
    },
  },
  {
    title: 'роль последнего владельца',
    operationId: 'revokeAssignment',
    expect: 'error',
    example: 'revokeAssignment/last_owner_required',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/assignments/${ctx.A('a1')}`);
      ctx.expectExample(r, 'revokeAssignment/last_owner_required');
    },
  },
  // ── оргструктура ────────────────────────────────────────────────────────────────────────────
  {
    title: 'регионы и фирмы «Альты»',
    operationId: 'listOrgUnits',
    expect: 'success',
    example: 'listOrgUnits/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/org-units`), 'listOrgUnits/ok');
    },
  },
  {
    title: 'логисту структура закрыта',
    operationId: 'listOrgUnits',
    expect: 'error',
    example: 'listOrgUnits/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/org-units`), 'listOrgUnits/forbidden_action');
    },
  },
  {
    title: 'новая фирма «Запад Логистик»',
    operationId: 'createOrgUnit',
    expect: 'success',
    example: 'createOrgUnit/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/org-units`, {
        parentId: ctx.A('r-msk'),
        name: 'Запад Логистик',
        kind: 'company',
      });
      ctx.expectExample(r, 'createOrgUnit/ok', 201);
    },
  },
  {
    title: 'фирма без названия',
    operationId: 'createOrgUnit',
    expect: 'error',
    example: 'createOrgUnit/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/org-units`, {
        parentId: ctx.A('r-msk'),
        name: '',
        kind: 'company',
      });
      ctx.expectExample(r, 'createOrgUnit/validation_failed');
    },
  },
  {
    title: 'фирма «Север Логистик»',
    operationId: 'getOrgUnit',
    expect: 'success',
    example: 'getOrgUnit/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(
        await s.get(`${ctx.alta}/org-units/${ctx.A('f-msk-sever')}`),
        'getOrgUnit/ok',
      );
    },
  },
  {
    title: 'неизвестное подразделение',
    operationId: 'getOrgUnit',
    expect: 'error',
    example: 'getOrgUnit/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/org-units/${MISSING}`), 'getOrgUnit/not_found');
    },
  },
  {
    title: 'переименование «Север Логистик»',
    operationId: 'updateOrgUnit',
    expect: 'success',
    example: 'updateOrgUnit/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/org-units/${ctx.A('f-msk-sever')}`,
        { name: 'Север Логистик · Лобня' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateOrgUnit/ok');
    },
  },
  {
    title: 'устаревшая структура',
    operationId: 'updateOrgUnit',
    expect: 'error',
    example: 'updateOrgUnit/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/org-units/${ctx.A('f-msk-sever')}`,
        { name: 'Север' },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'updateOrgUnit/revision_mismatch');
    },
  },
  // ── группы ──────────────────────────────────────────────────────────────────────────────────
  {
    title: 'группы «Альты»',
    operationId: 'listGroups',
    expect: 'success',
    example: 'listGroups/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/groups`), 'listGroups/ok');
    },
  },
  {
    title: 'логисту группы закрыты',
    operationId: 'listGroups',
    expect: 'error',
    example: 'listGroups/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/groups`), 'listGroups/forbidden_action');
    },
  },
  {
    title: 'новая группа «Логисты Самара»',
    operationId: 'createGroup',
    expect: 'success',
    example: 'createGroup/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/groups`, {
        name: 'Логисты Самара',
        description: 'Менеджеры фирм региона Самара',
        homeUnitId: ctx.A('r-smr'),
      });
      ctx.expectExample(r, 'createGroup/ok', 201);
    },
  },
  {
    title: 'группа с занятым названием',
    operationId: 'createGroup',
    expect: 'error',
    example: 'createGroup/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/groups`, { name: 'Водители Север', homeUnitId: null });
      ctx.expectExample(r, 'createGroup/validation_failed');
    },
  },
  {
    title: 'группа «Водители Север»',
    operationId: 'getGroup',
    expect: 'success',
    example: 'getGroup/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/groups/${ctx.A('g-drv')}`), 'getGroup/ok');
    },
  },
  {
    title: 'неизвестная группа',
    operationId: 'getGroup',
    expect: 'error',
    example: 'getGroup/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/groups/${MISSING}`), 'getGroup/not_found');
    },
  },
  {
    title: 'переименование «Диспетчеры Север»',
    operationId: 'updateGroup',
    expect: 'success',
    example: 'updateGroup/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/groups/${ctx.A('g-disp')}`,
        { name: 'Диспетчеры Москва · Север' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateGroup/ok');
    },
  },
  {
    title: 'устаревшая группа',
    operationId: 'updateGroup',
    expect: 'error',
    example: 'updateGroup/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        `${ctx.alta}/groups/${ctx.A('g-disp')}`,
        { name: 'Диспетчеры' },
        { ifMatch: 5 },
      );
      ctx.expectExample(r, 'updateGroup/revision_mismatch');
    },
  },
  {
    title: 'удаление группы без назначений',
    operationId: 'deleteGroup',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/groups/${ctx.A('g-disp')}`, { ifMatch: 1 });
      expect(r.status).toBe(204);
      ctx.expectProblem(await s.get(`${ctx.alta}/groups/${ctx.A('g-disp')}`), 'not_found');
    },
  },
  {
    title: 'группа с назначениями',
    operationId: 'deleteGroup',
    expect: 'error',
    example: 'deleteGroup/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/groups/${ctx.A('g-drv')}`, { ifMatch: 1 });
      ctx.expectExample(r, 'deleteGroup/invalid_transition');
    },
  },
  {
    title: 'удаление устаревшей группы',
    operationId: 'deleteGroup',
    expect: 'error',
    example: 'deleteGroup/revision_mismatch',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/groups/${ctx.A('g-disp')}`, { ifMatch: 9 });
      ctx.expectExample(r, 'deleteGroup/revision_mismatch');
    },
  },
  {
    title: 'Тимур Ахмедов — в «Водители Север»',
    operationId: 'setGroupMembers',
    expect: 'success',
    example: 'setGroupMembers/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.put(
        `${ctx.alta}/groups/${ctx.A('g-drv')}/members`,
        { memberIds: ['m-vasiliev', 'm-gromov', 'm-akhmedov'].map(ctx.A) },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'setGroupMembers/ok');
    },
  },
  {
    title: 'состав группы без права назначать её роли',
    operationId: 'setGroupMembers',
    expect: 'error',
    example: 'setGroupMembers/delegation_exceeds_grant',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const hr = (
        await owner.post(`${ctx.alta}/roles`, {
          name: 'Кадровик',
          permissions: ['members.read', 'members.manage'],
        })
      ).body as { id: string };
      await owner.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-kotova'),
        roleId: hr.id,
        scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
      });
      const kotova = await ctx.as('manager');
      const r = await kotova.put(
        `${ctx.alta}/groups/${ctx.A('g-drv')}/members`,
        { memberIds: ['m-vasiliev', 'm-gromov', 'm-akhmedov'].map(ctx.A) },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'setGroupMembers/delegation_exceeds_grant');
    },
  },
  {
    title: 'логист с начислениями в группе водителей — SoD',
    operationId: 'setGroupMembers',
    expect: 'error',
    example: 'setGroupMembers/separation_of_duties_conflict',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await kotovaManager(ctx, s);
      const r = await s.put(
        `${ctx.alta}/groups/${ctx.A('g-drv')}/members`,
        { memberIds: ['m-vasiliev', 'm-gromov', 'm-kotova'].map(ctx.A) },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'setGroupMembers/separation_of_duties_conflict');
    },
  },
  // ── владельцы ───────────────────────────────────────────────────────────────────────────────
  {
    title: 'владельцы «Альты»',
    operationId: 'listOwners',
    expect: 'success',
    example: 'listOwners/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await s.get(`${ctx.alta}/owners`), 'listOwners/ok');
    },
  },
  {
    title: 'логисту владельцы закрыты',
    operationId: 'listOwners',
    expect: 'error',
    example: 'listOwners/forbidden_action',
    run: async (ctx) => {
      const s = await ctx.as('manager');
      ctx.expectExample(await s.get(`${ctx.alta}/owners`), 'listOwners/forbidden_action');
    },
  },
  {
    title: 'Котова — второй владелец',
    operationId: 'transferOwnership',
    expect: 'success',
    example: 'transferOwnership/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/owners/transfers`, {
        toMemberId: ctx.A('m-kotova'),
        keepCurrentOwner: true,
        confirmation: 'm.kotova@alta.example',
        reason: 'Второй владелец на время отпуска',
      });
      ctx.expectExample(r, 'transferOwnership/ok');
      const kotova = await ctx.as('manager');
      expect((await kotova.get(`${ctx.alta}/subscription`)).status).toBe(200);
    },
  },
  {
    title: 'передача владения целиком',
    operationId: 'transferOwnership',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/owners/transfers`, {
        toMemberId: ctx.A('m-kotova'),
        keepCurrentOwner: false,
        confirmation: 'm.kotova@alta.example',
        reason: 'Продажа бизнеса',
      });
      expect((r.body as { items: { memberId: string }[] }).items.map((o) => o.memberId)).toEqual([
        ctx.A('m-kotova'),
      ]);
      const change = await s.patch(
        `${ctx.alta}/subscription`,
        { action: 'change_plan', planKey: 'team' },
        { ifMatch: 2 },
      );
      ctx.expectProblem(change, 'forbidden_action');
    },
  },
  {
    title: 'подтверждение не совпадает',
    operationId: 'transferOwnership',
    expect: 'error',
    example: 'transferOwnership/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/owners/transfers`, {
        toMemberId: ctx.A('m-kotova'),
        keepCurrentOwner: true,
        confirmation: 'kotova@alta.example',
        reason: 'Второй владелец на время отпуска',
      });
      ctx.expectExample(r, 'transferOwnership/validation_failed');
    },
  },
  {
    title: 'вход больше 10 минут назад',
    operationId: 'transferOwnership',
    expect: 'error',
    example: 'transferOwnership/session_expired',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.server.setNow('2026-10-01T07:41:00Z');
      const r = await s.post(`${ctx.alta}/owners/transfers`, {
        toMemberId: ctx.A('m-kotova'),
        keepCurrentOwner: true,
        confirmation: 'm.kotova@alta.example',
        reason: 'Второй владелец на время отпуска',
      });
      ctx.expectExample(r, 'transferOwnership/session_expired');
    },
  },
  {
    title: 'владельцем — только активный участник',
    operationId: 'transferOwnership',
    expect: 'error',
    example: 'transferOwnership/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/owners/transfers`, {
        toMemberId: ctx.A('m-petrova'),
        keepCurrentOwner: true,
        confirmation: 'o.petrova@alta.example',
        reason: 'Второй владелец на время отпуска',
      });
      ctx.expectExample(r, 'transferOwnership/invalid_transition');
    },
  },
  {
    title: 'снятие одного из двух владельцев',
    operationId: 'revokeOwnership',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      await s.post(`${ctx.alta}/owners/transfers`, {
        toMemberId: ctx.A('m-kotova'),
        keepCurrentOwner: true,
        confirmation: 'm.kotova@alta.example',
        reason: 'Второй владелец на время отпуска',
      });
      const r = await s.delete(`${ctx.alta}/owners/${ctx.A('m-kotova')}`);
      expect(r.status).toBe(204);
      const owners = (await s.get(`${ctx.alta}/owners`)).body as { items: unknown[] };
      expect(owners.items).toHaveLength(1);
    },
  },
  {
    title: 'последнего владельца не снять',
    operationId: 'revokeOwnership',
    expect: 'error',
    example: 'revokeOwnership/last_owner_required',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.delete(`${ctx.alta}/owners/${ctx.A('m-owner')}`);
      ctx.expectExample(r, 'revokeOwnership/last_owner_required');
    },
  },
  // ── «Почему доступно» ───────────────────────────────────────────────────────────────────────
  {
    title: 'роль на проект без объекта не даёт права (PD-53)',
    operationId: 'explainAccess',
    expect: 'success',
    example: 'explainAccess/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(
        `${ctx.alta}/access/explanation?memberId=${ctx.A('m-kotova')}&permission=tasks.update`,
      );
      ctx.expectExample(r, 'explainAccess/ok');
    },
  },
  {
    title: 'владелец приглашает',
    operationId: 'explainAccess',
    expect: 'success',
    example: 'explainAccess/allowed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(
        `${ctx.alta}/access/explanation?memberId=${ctx.A('m-owner')}&permission=members.invite`,
      );
      ctx.expectExample(r, 'explainAccess/allowed');
    },
  },
  {
    title: 'начисления водителю запрещает SoD, логистика не подключена',
    operationId: 'explainAccess',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(
        `${ctx.alta}/access/explanation?memberId=${ctx.A('m-vasiliev')}&permission=fleet.earnings.read`,
      );
      expect(r.body).toMatchObject({ allowed: false, decisiveCheck: 'module-installation' });
    },
  },
  {
    title: 'неизвестный участник',
    operationId: 'explainAccess',
    expect: 'error',
    example: 'explainAccess/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(
        `${ctx.alta}/access/explanation?memberId=${MISSING}&permission=members.read`,
      );
      ctx.expectExample(r, 'explainAccess/not_found');
    },
  },
  // ── импорт CSV ──────────────────────────────────────────────────────────────────────────────
  {
    title: 'предпросмотр импорта водителей',
    operationId: 'createPeopleImport',
    expect: 'success',
    example: 'createPeopleImport/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectExample(await createImport(ctx, s), 'createPeopleImport/ok', 201);
    },
  },
  {
    title: 'нет колонки full_name',
    operationId: 'createPeopleImport',
    expect: 'error',
    example: 'createPeopleImport/validation_failed',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(`${ctx.alta}/people-imports`, {
        fileName: 'Водители.csv',
        csv: 'email,phone\ns.lapin@alta.example,',
        defaultOrgUnitId: ctx.A('f-msk-sever'),
      });
      ctx.expectExample(r, 'createPeopleImport/validation_failed');
    },
  },
  {
    title: 'больше 2000 строк',
    operationId: 'createPeopleImport',
    expect: 'error',
    example: 'createPeopleImport/payload_too_large',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const rows = Array.from({ length: 2001 }, (_, i) => `Сотрудник ${i},s${i}@alta.example`);
      const r = await s.post(`${ctx.alta}/people-imports`, {
        fileName: 'Все.csv',
        csv: ['full_name,email', ...rows].join('\n'),
        defaultOrgUnitId: ctx.A('f-msk-sever'),
      });
      ctx.expectExample(r, 'createPeopleImport/payload_too_large');
    },
  },
  {
    title: 'импорт по id',
    operationId: 'getPeopleImport',
    expect: 'success',
    example: 'getPeopleImport/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const imp = (await createImport(ctx, s)).body as { id: string };
      ctx.expectExample(await s.get(`${ctx.alta}/people-imports/${imp.id}`), 'getPeopleImport/ok');
    },
  },
  {
    title: 'истёкший импорт',
    operationId: 'getPeopleImport',
    expect: 'error',
    example: 'getPeopleImport/not_found',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const imp = (await createImport(ctx, s)).body as { id: string };
      ctx.server.setNow('2026-10-01T07:31:00Z');
      expect((await s.get(`${ctx.alta}/people-imports/${imp.id}`)).status).toBe(200);
      ctx.server.setNow('2026-10-02T07:30:00Z');
      const later = await ctx.as('owner');
      ctx.expectExample(
        await later.get(`${ctx.alta}/people-imports/${imp.id}`),
        'getPeopleImport/not_found',
      );
    },
  },
  {
    title: 'применение импорта с приглашениями',
    operationId: 'commitPeopleImport',
    expect: 'success',
    example: 'commitPeopleImport/ok',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const imp = (await createImport(ctx, s)).body as { id: string };
      ctx.server.setNow('2026-10-01T07:34:00Z');
      const r = await s.post(
        `${ctx.alta}/people-imports/${imp.id}/commit`,
        { skipInvalidRows: true, sendInvitations: true },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'commitPeopleImport/ok');
      const members = (await s.get(`${ctx.alta}/members`)).body as {
        items: { displayName: string; status: string; workProfiles: string[] }[];
      };
      expect(members.items.at(-1)).toMatchObject({
        displayName: 'Семён Лапин',
        status: 'invited',
        workProfiles: ['driver'],
      });
    },
  },
  {
    title: 'мест нет',
    operationId: 'commitPeopleImport',
    expect: 'error',
    example: 'commitPeopleImport/seats_exhausted',
    run: async (ctx) => {
      ctx.server.applyPreset('seats-full');
      const s = await ctx.as('owner');
      const imp = (await createImport(ctx, s)).body as { id: string };
      const r = await s.post(
        `${ctx.alta}/people-imports/${imp.id}/commit`,
        { skipInvalidRows: true, sendInvitations: true },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'commitPeopleImport/seats_exhausted');
    },
  },
  {
    title: 'повторное применение',
    operationId: 'commitPeopleImport',
    expect: 'error',
    example: 'commitPeopleImport/invalid_transition',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const imp = (await createImport(ctx, s)).body as { id: string };
      const url = `${ctx.alta}/people-imports/${imp.id}/commit`;
      await s.post(url, { skipInvalidRows: true, sendInvitations: false }, { ifMatch: 1 });
      const r = await s.post(
        url,
        { skipInvalidRows: true, sendInvitations: false },
        { ifMatch: 2 },
      );
      ctx.expectExample(r, 'commitPeopleImport/invalid_transition');
    },
  },
  {
    title: 'приглашения из файла требуют права приглашать (x-field-permissions)',
    operationId: 'commitPeopleImport',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const hr = (
        await owner.post(`${ctx.alta}/roles`, {
          name: 'Кадровик',
          permissions: ['members.read', 'members.manage'],
        })
      ).body as { id: string };
      await owner.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-kotova'),
        roleId: hr.id,
        scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
      });
      const kotova = await ctx.as('manager');
      const imp = (await createImport(ctx, kotova)).body as { id: string };
      const r = await kotova.post(
        `${ctx.alta}/people-imports/${imp.id}/commit`,
        { skipInvalidRows: true, sendInvitations: true },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'forbidden_action');
    },
  },
]);
