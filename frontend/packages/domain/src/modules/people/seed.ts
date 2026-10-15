// Сид людей и оргструктуры (mock-data.js 14.10:42–82, 84–188). ID участников «Лотоса» намеренно
// совпадают с «Альтой» (m-owner, m-morozova): идентификаторы живут внутри своей БД.
import type { Assignment, Group, Member, Role, Unit } from '../../core/types/index.ts';
import type { Platform } from '../platform/types.ts';

export interface OrgPeople {
  units: Unit[];
  members: Member[];
  groups: Group[];
  roles: Role[];
  assignments: Assignment[];
}

const FIN0 = (): Role['finance'] => ({ read: false, manage: false });

const FIRMS: readonly (readonly [string, string, string])[] = [
  ['f-msk-sever', 'r-msk', 'Север Логистик'],
  ['f-msk-yug', 'r-msk', 'Юг Транс'],
  ['f-msk-vostok', 'r-msk', 'Восток Карго'],
  ['f-msk-centr', 'r-msk', 'Центр Экспресс'],
  ['f-smr-volga', 'r-smr', 'Волга Логистик'],
  ['f-smr-truck', 'r-smr', 'Самара Трак'],
  ['f-smr-zhig', 'r-smr', 'Жигули Карго'],
  ['f-smr-priv', 'r-smr', 'Приволжье Сервис'],
  ['f-spb-neva', 'r-spb', 'Нева Логистик'],
  ['f-spb-baltic', 'r-spb', 'Балтик Транс'],
  ['f-spb-ohta', 'r-spb', 'Охта Карго'],
  ['f-spb-pulk', 'r-spb', 'Пулково Экспресс'],
];

/** Роли «Альты» сырого сида 14.10: 5 базовых и 4 роли проекта (назначаются с областью `project`). */
function altaRoles(): Role[] {
  return [
    {
      id: 'r-owner',
      name: 'Владелец бизнеса',
      kind: 'system',
      all: true,
      actions: {},
      finance: { read: true, manage: true },
    },
    {
      id: 'r-manager',
      name: 'Менеджер логистики',
      kind: 'template',
      actions: {
        logistics: ['view', 'create', 'edit', 'review', 'export'],
        calendar: ['view', 'create', 'edit'],
        tasks: ['view', 'create', 'edit'],
        forms: ['view', 'review'],
        data: ['view', 'export'],
        files: ['view'],
        knowledge: ['view'],
      },
      finance: { read: true, manage: false },
    },
    {
      id: 'r-driver',
      name: 'Водитель',
      kind: 'template',
      professional: 'driver',
      actions: {
        logistics: ['view', 'create'],
        forms: ['view', 'create'],
        calendar: ['view'],
        files: ['create'],
        knowledge: ['view'],
      },
      finance: FIN0(),
    },
    {
      id: 'r-therapist',
      name: 'Массажист',
      kind: 'template',
      actions: { spa: ['view', 'create'], calendar: ['view', 'edit'], knowledge: ['view'] },
      finance: FIN0(),
    },
    {
      id: 'r-foreman',
      name: 'Прораб',
      kind: 'template',
      actions: {
        repair: ['view', 'create'],
        tasks: ['view', 'create'],
        files: ['create'],
        knowledge: ['view'],
      },
      finance: FIN0(),
    },
    ...projectRoles(),
  ];
}

function projectRoles(): Role[] {
  return [
    {
      id: 'r-pm',
      name: 'Руководитель проекта',
      kind: 'template',
      project: true,
      actions: { tasks: ['view', 'create', 'edit', 'review', 'settings'] },
      finance: FIN0(),
    },
    {
      id: 'r-approver',
      name: 'Согласующий',
      kind: 'template',
      project: true,
      actions: { tasks: ['view', 'review'] },
      finance: FIN0(),
    },
    {
      id: 'r-exec',
      name: 'Исполнитель',
      kind: 'template',
      project: true,
      actions: { tasks: ['view', 'create', 'edit'] },
      finance: FIN0(),
    },
    {
      id: 'r-viewer',
      name: 'Наблюдатель',
      kind: 'template',
      project: true,
      actions: { tasks: ['view'] },
      finance: FIN0(),
    },
  ];
}

/** Оргструктура и люди «Альты Групп»: 3 региона × 4 фирмы, 10 участников. */
export function altaPeople(): OrgPeople {
  return {
    units: [
      { id: 'r-msk', type: 'region', name: 'Москва' },
      { id: 'r-smr', type: 'region', name: 'Самара' },
      { id: 'r-spb', type: 'region', name: 'Санкт-Петербург' },
      ...FIRMS.map(([id, parent, name]): Unit => ({ id, type: 'firm', parent, name })),
    ],
    members: [
      {
        id: 'm-owner',
        name: 'Дарья Зимина',
        email: 'd.zimina@alta.example',
        status: 'active',
        title: 'Владелец',
      },
      {
        id: 'm-kotova',
        name: 'Марина Котова',
        email: 'm.kotova@alta.example',
        status: 'active',
        title: 'Логист',
      },
      {
        id: 'm-vasiliev',
        name: 'Илья Васильев',
        email: 'i.vasiliev@alta.example',
        status: 'active',
        title: 'Водитель',
        function: 'driver',
      },
      {
        id: 'm-morozova',
        name: 'Анна Морозова',
        email: 'a.morozova@alta.example',
        status: 'active',
        title: 'Массажист',
      },
      {
        id: 'm-sokolov',
        name: 'Алексей Соколов',
        email: 'a.sokolov@alta.example',
        status: 'active',
        title: 'Прораб',
      },
      {
        id: 'm-petrova',
        name: 'Олеся Петрова',
        email: 'o.petrova@alta.example',
        status: 'invited',
        title: 'Диспетчер',
        invitedNote: 'Приглашение до 06.10',
      },
      {
        id: 'm-gromov',
        name: 'Кирилл Громов',
        email: 'k.gromov@alta.example',
        status: 'blocked',
        title: 'Водитель',
        function: 'driver',
      },
      {
        id: 'm-kotelnikova',
        name: 'Вера Котельникова',
        email: 'v.kotelnikova@alta.example',
        status: 'active',
        title: 'Диспетчер · Самара',
      },
      {
        id: 'm-akhmedov',
        name: 'Тимур Ахмедов',
        email: 't.akhmedov@alta.example',
        status: 'active',
        title: 'Водитель',
        function: 'driver',
      },
      {
        id: 'm-ilyin',
        name: 'Сергей Ильин',
        email: 's.ilyin@alta.example',
        status: 'invited',
        title: 'Бухгалтер',
        invitedNote: 'Приглашение до 07.10',
      },
    ],
    groups: [
      { id: 'g-disp', name: 'Диспетчеры Север', members: ['m-kotova', 'm-petrova'] },
      { id: 'g-drv', name: 'Водители Север', members: ['m-vasiliev', 'm-gromov'] },
    ],
    roles: altaRoles(),
    assignments: [
      { id: 'a1', member: 'm-owner', role: 'r-owner', scope: { type: 'tenant' } },
      { id: 'ap1', member: 'm-kotova', role: 'r-pm', scope: { type: 'project', id: 'fleet' } },
      {
        id: 'ap2',
        member: 'm-vasiliev',
        role: 'r-exec',
        scope: { type: 'project', id: 'fleet' },
        via: 'группу «Водители Север»',
      },
      {
        id: 'ap3',
        member: 'm-kotelnikova',
        role: 'r-approver',
        scope: { type: 'project', id: 'fleet' },
      },
      {
        id: 'a2',
        member: 'm-vasiliev',
        role: 'r-driver',
        scope: { type: 'firm', id: 'f-msk-sever' },
        via: 'группа «Водители Север»',
      },
      { id: 'a3', member: 'm-morozova', role: 'r-therapist', scope: { type: 'self' } },
      { id: 'a4', member: 'm-sokolov', role: 'r-foreman', scope: { type: 'self' } },
    ],
  };
}

const LOTOS_TITLES = ['Массажист', 'Массажист', 'Косметолог', 'Администратор'];
const TVER = 'f-lotos-tver';
const ARB = 'f-lotos-arb';

/**
 * Люди SPA «Лотос»: владелец, массажист «Альты» по совместительству и персонал из общего каталога
 * аккаунтов (`acc-g*` после `fillAccounts`); персонал чередуется по салонам, каждый четвёртый —
 * администратор салона «Арбат».
 */
export function lotosPeople(platform: Platform): OrgPeople {
  const staff = platform.accounts
    .filter(
      (a) =>
        a.memberships.some((m) => m.tenantId === 't-lotos') &&
        a.id !== 'acc-11' &&
        a.id !== 'acc-4',
    )
    .map((a, i) => ({
      member: {
        id: 'm-l' + (i + 1),
        name: a.name,
        email: a.email,
        status: 'active',
        title: LOTOS_TITLES[i % 4] ?? '',
      } satisfies Member,
      firm: i % 2 ? ARB : TVER,
    }));
  const isAdmin = (x: (typeof staff)[number]) => x.member.title === 'Администратор';
  const base = altaRoles();
  const role = (id: string): Role[] => base.filter((r) => r.id === id);
  return {
    units: [
      { id: 'r-msk', type: 'region', name: 'Москва' },
      { id: TVER, type: 'firm', parent: 'r-msk', name: 'Лотос · Тверская' },
      { id: ARB, type: 'firm', parent: 'r-msk', name: 'Лотос · Арбат' },
    ],
    members: [
      {
        id: 'm-owner',
        name: 'Ирина Белова',
        email: 'owner@lotos-spa.example',
        status: 'active',
        title: 'Владелец',
      },
      {
        id: 'm-morozova',
        name: 'Анна Морозова',
        email: 'a.morozova@alta.example',
        status: 'active',
        title: 'Массажист · Тверская',
      },
      ...staff.map((x) => x.member),
    ],
    groups: [
      {
        id: 'g-tver',
        name: 'Мастера Тверская',
        members: [
          'm-morozova',
          ...staff.filter((x) => x.firm === TVER && !isAdmin(x)).map((x) => x.member.id),
        ],
      },
    ],
    roles: [
      ...role('r-owner'),
      ...role('r-therapist'),
      {
        id: 'r-admin',
        name: 'Администратор салона',
        kind: 'custom',
        actions: {
          spa: ['view', 'create', 'edit', 'review'],
          calendar: ['view', 'create', 'edit'],
          tasks: ['view', 'create', 'edit'],
          knowledge: ['view'],
          files: ['view', 'create'],
        },
        finance: FIN0(),
      },
      ...base.filter((r) => r.project),
    ],
    assignments: [
      { id: 'la1', member: 'm-owner', role: 'r-owner', scope: { type: 'tenant' } },
      { id: 'la2', member: 'm-morozova', role: 'r-therapist', scope: { type: 'self' } },
      ...staff.map((x, i): Assignment =>
        isAdmin(x)
          ? {
              id: 'lb' + i,
              member: x.member.id,
              role: 'r-admin',
              scope: { type: 'firm', id: x.firm },
            }
          : { id: 'lb' + i, member: x.member.id, role: 'r-therapist', scope: { type: 'self' } },
      ),
    ],
  };
}
