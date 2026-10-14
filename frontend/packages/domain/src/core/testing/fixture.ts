// Тестовая фикстура ядра: срез сида «Альты» 14.10 (mock-data.js:84–188) плюс объектные роли и
// назначения, которые добавляют install-функции модулей (knowledge.js:13–16, 285–287; chats.js:33–37,
// 248–251; documents.js:28–30, 502; cash.js:263–266; service.js:210–212). Полный сид — W0.12.
// Каждый вызов возвращает новую копию: тесты могут её менять.
import type { CoreDb, Role } from '../types/index.ts';

export interface FixtureDb extends CoreDb {
  knowledge: { spaces: { id: string; name: string }[]; pages: { id: string; title: string }[] };
  docs: { folders: { id: string; name: string }[]; items: { id: string; title: string }[] };
  chats: { items: { id: string; title?: string }[] };
  cash: { accounts: { id: string; name: string }[] };
  service: { directions: { id: string; name: string; project: string }[] };
  repair: { objects: { id: string; name: string; foreman: string | null; foremanId?: string }[] };
}

const FIN0 = { read: false, manage: false };

const FIRMS: [string, string, string][] = [
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

const ROLES: Role[] = [
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
    finance: FIN0,
  },
  {
    id: 'r-therapist',
    name: 'Массажист',
    kind: 'template',
    actions: { spa: ['view', 'create'], calendar: ['view', 'edit'], knowledge: ['view'] },
    finance: FIN0,
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
    finance: FIN0,
  },
  {
    id: 'r-pm',
    name: 'Руководитель проекта',
    kind: 'template',
    project: true,
    actions: { tasks: ['view', 'create', 'edit', 'review', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-approver',
    name: 'Согласующий',
    kind: 'template',
    project: true,
    actions: { tasks: ['view', 'review'] },
    finance: FIN0,
  },
  {
    id: 'r-exec',
    name: 'Исполнитель',
    kind: 'template',
    project: true,
    actions: { tasks: ['view', 'create', 'edit'] },
    finance: FIN0,
  },
  {
    id: 'r-viewer',
    name: 'Наблюдатель',
    kind: 'template',
    project: true,
    actions: { tasks: ['view'] },
    finance: FIN0,
  },
  {
    id: 'r-kb-lead',
    name: 'Руководитель пространства',
    kind: 'template',
    space: true,
    actions: { knowledge: ['view', 'create', 'edit', 'review', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-kb-editor',
    name: 'Редактор',
    kind: 'template',
    space: true,
    actions: { knowledge: ['view', 'create', 'edit', 'review'] },
    finance: FIN0,
  },
  {
    id: 'r-kb-author',
    name: 'Автор',
    kind: 'template',
    space: true,
    actions: { knowledge: ['view', 'create'] },
    finance: FIN0,
  },
  {
    id: 'r-doc-manage',
    name: 'Документы · управляет доступом',
    kind: 'template',
    folderRole: true,
    actions: { docs: ['view', 'create', 'edit', 'export', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-owner',
    name: 'Владелец чата',
    kind: 'template',
    chatRole: 'owner',
    actions: { chat: ['view', 'create', 'review', 'settings'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-reader',
    name: 'Читатель чата',
    kind: 'template',
    chatRole: 'reader',
    actions: { chat: ['view'] },
    finance: FIN0,
  },
  {
    id: 'r-chat-creator',
    name: 'Чаты · создаёт группы',
    kind: 'template',
    actions: { chat: ['view', 'create', 'edit'] },
    finance: FIN0,
  },
  {
    id: 'r-agent',
    name: 'Специалист по обращениям',
    kind: 'template',
    project: true,
    actions: { service: ['view', 'create', 'edit', 'review'] },
    finance: FIN0,
  },
  {
    id: 'r-cashier',
    name: 'Кассир салона',
    kind: 'template',
    actions: { cash: ['view', 'create', 'edit'] },
    cash: { balance: false, self: false, out: 1000, refund: 3000, advance: 0 },
    finance: FIN0,
  },
];

export function altaFixture(): FixtureDb {
  const db: FixtureDb = {
    tenantId: 't-alta',
    seq: 100,
    units: [
      { id: 'r-msk', type: 'region', name: 'Москва' },
      { id: 'r-smr', type: 'region', name: 'Самара' },
      { id: 'r-spb', type: 'region', name: 'Санкт-Петербург' },
      ...FIRMS.map(([id, parent, name]) => ({ id, type: 'firm' as const, parent, name })),
    ],
    modules: { logistics: { enabled: false }, spa: { enabled: true }, repair: { enabled: false } },
    members: [
      { id: 'm-owner', name: 'Дарья Зимина', status: 'active', title: 'Владелец' },
      { id: 'm-kotova', name: 'Марина Котова', status: 'active', title: 'Логист' },
      {
        id: 'm-vasiliev',
        name: 'Илья Васильев',
        status: 'active',
        title: 'Водитель',
        function: 'driver',
      },
      { id: 'm-morozova', name: 'Анна Морозова', status: 'active', title: 'Массажист' },
      { id: 'm-sokolov', name: 'Алексей Соколов', status: 'active', title: 'Прораб' },
      { id: 'm-petrova', name: 'Олеся Петрова', status: 'invited', title: 'Диспетчер' },
      {
        id: 'm-gromov',
        name: 'Кирилл Громов',
        status: 'blocked',
        title: 'Водитель',
        function: 'driver',
      },
      {
        id: 'm-kotelnikova',
        name: 'Вера Котельникова',
        status: 'active',
        title: 'Диспетчер · Самара',
      },
      {
        id: 'm-akhmedov',
        name: 'Тимур Ахмедов',
        status: 'active',
        title: 'Водитель',
        function: 'driver',
      },
      { id: 'm-ilyin', name: 'Сергей Ильин', status: 'invited', title: 'Бухгалтер' },
    ],
    groups: [
      { id: 'g-disp', name: 'Диспетчеры Север', members: ['m-kotova', 'm-petrova'] },
      { id: 'g-drv', name: 'Водители Север', members: ['m-vasiliev', 'm-gromov'] },
    ],
    roles: ROLES.map((r) => structuredClone(r)),
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
      {
        id: 'as-svc1',
        member: 'm-kotova',
        role: 'r-agent',
        scope: { type: 'project', id: 'svc-grz' },
      },
      {
        id: 'as-svc2',
        member: 'm-kotelnikova',
        role: 'r-agent',
        scope: { type: 'project', id: 'svc-grz' },
      },
      {
        id: 'akb-1',
        member: 'm-kotova',
        role: 'r-kb-lead',
        scope: { type: 'space', id: 'sp-log' },
      },
      {
        id: 'akb-2',
        member: 'm-kotelnikova',
        role: 'r-kb-editor',
        scope: { type: 'space', id: 'sp-log' },
      },
      {
        id: 'akb-3',
        member: 'm-kotova',
        role: 'r-kb-author',
        scope: { type: 'space', id: 'sp-gen' },
      },
      {
        id: 'adoc-1',
        member: 'm-kotova',
        role: 'r-doc-manage',
        scope: { type: 'folder', id: 'fd-log' },
      },
      {
        id: 'ach-1',
        member: 'm-kotova',
        role: 'r-chat-owner',
        scope: { type: 'chat', id: 'ch-drv' },
      },
      {
        id: 'ach-2',
        member: 'm-kotelnikova',
        role: 'r-chat-reader',
        scope: { type: 'chat', id: 'ch-drv' },
      },
      {
        id: 'ach-4',
        member: 'm-kotova',
        role: 'r-chat-creator',
        scope: { type: 'firm', id: 'f-msk-sever' },
      },
      {
        id: 'a-cash1',
        member: 'm-morozova',
        role: 'r-cashier',
        scope: { type: 'account', id: 'ca-spa' },
      },
    ],
    events: [],
    projects: [
      { id: 'fleet', key: 'LOG', name: 'Логистика · Север', unit: 'f-msk-sever' },
      { id: 'leads', key: 'ЗАЯ', name: 'Заявки · Ремонт', flow: 'leads', unit: 'f-msk-sever' },
    ],
    knowledge: {
      spaces: [
        { id: 'sp-log', name: 'Логистика' },
        { id: 'sp-spa', name: 'Салон и SPA' },
        { id: 'sp-own', name: 'Руководство' },
      ],
      pages: [{ id: 'kb-1', title: 'Регламент приёмки смены' }],
    },
    docs: {
      folders: [{ id: 'fd-log', name: 'Север Логистик' }],
      items: [{ id: 'doc-l1', title: 'Правила записи и отмены визитов' }],
    },
    chats: { items: [{ id: 'ch-drv', title: 'Водители · Север Логистик' }, { id: 'ch-dm' }] },
    cash: { accounts: [{ id: 'ca-spa', name: 'Касса салона · ресепшен' }] },
    service: { directions: [{ id: 'd-grz', name: 'Грузоперевозки', project: 'svc-grz' }] },
    repair: {
      objects: [
        { id: 'obj-42', name: 'ЖК Речной · квартира 42', foreman: 'Алексей Соколов' },
        { id: 'obj-45', name: 'Кофейня на Покровке', foreman: null },
        {
          id: 'obj-99',
          name: 'Объект с прорабом по id',
          foreman: 'Другое ФИО',
          foremanId: 'm-sokolov',
        },
      ],
    },
  };
  return db;
}

/** Та же «Альта» с включённой логистикой (`modules.logistics.enabled = true`). */
export function altaWithLogistics(): FixtureDb {
  const db = altaFixture();
  db.modules.logistics = { enabled: true };
  return db;
}
