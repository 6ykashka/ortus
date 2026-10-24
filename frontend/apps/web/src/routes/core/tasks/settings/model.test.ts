// W4.13 · Модель вкладок проекта (эталон design-2026-10-19 «Задачи и проекты.dc.html» :439–489, models.js :181–213):
// глаголы «Что может», строки «Участников», кандидаты и «Проверить доступ», черновик процесса (статусы перед первым
// «Готово», удаление статуса с переходами, «Кто может», согласование), строки и правила переходов, текст правил и
// журнала автоматизации.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  accessDesc,
  addStatus,
  addTransition,
  approvalPatch,
  approverNames,
  candidates,
  checkPeople,
  checkText,
  defaultCheckMember,
  defaultRole,
  draftOf,
  hasStatus,
  initials,
  memberRows,
  pathOf,
  removeStatus,
  removeTransition,
  roleCaps,
  ruleMeta,
  ruleText,
  rulesOf,
  runLine,
  stamp,
  toggleWho,
  verbLabels,
  versionChip,
  whoOf,
} from './model.ts';

type S = components['schemas'];

const ACT_PM = [
  'tasks.projects.read',
  'tasks.projects.manage',
  'tasks.read',
  'tasks.create',
  'tasks.update',
  'tasks.transition',
  'tasks.approve',
  'tasks.members.manage',
  'tasks.workflow.manage',
  'tasks.automation.manage',
];
const ACT_EXEC = [
  'tasks.projects.read',
  'tasks.read',
  'tasks.create',
  'tasks.update',
  'tasks.transition',
];

const member = (o: Partial<S['TaskProjectMember']>): S['TaskProjectMember'] => ({
  memberId: 'm1',
  displayName: 'Марина Котова',
  roleName: 'Руководитель проекта',
  source: 'assigned',
  via: 'Назначен в проекте',
  actions: ACT_PM,
  editable: true,
  ...o,
});

const ROWS: S['TaskProjectMember'][] = [
  member({
    memberId: 'owner',
    displayName: 'Дарья Зимина',
    roleName: 'Владелец бизнеса',
    source: 'system',
    via: 'Системная роль, вся организация',
    editable: false,
  }),
  member({ memberId: 'kotova', roleId: 'r-pm' }),
  member({
    memberId: 'vasiliev',
    displayName: 'Илья Васильев',
    roleId: 'r-exec',
    roleName: 'Исполнитель',
    source: 'group',
    via: 'Назначен через группу «Водители Север»',
    actions: ACT_EXEC,
    functionNotes: ['финансы скрыты'],
    editable: false,
  }),
  member({
    memberId: 'kotelnikova',
    displayName: 'Вера Котельникова',
    roleId: 'r-approver',
    roleName: 'Согласующий',
    actions: ['tasks.projects.read', 'tasks.read', 'tasks.approve'],
  }),
];

const ROLES: S['TaskProjectRole'][] = [
  { roleId: 'r-pm', name: 'Руководитель проекта', actions: ACT_PM },
  {
    roleId: 'r-approver',
    name: 'Согласующий',
    actions: ['tasks.projects.read', 'tasks.read', 'tasks.approve'],
  },
  { roleId: 'r-exec', name: 'Исполнитель', actions: ACT_EXEC },
  { roleId: 'r-viewer', name: 'Наблюдатель', actions: ['tasks.projects.read', 'tasks.read'] },
];

describe('«Участники»', () => {
  it('описание уровня доступа; «Закрытый» — без владельца бизнеса (TP-03)', () => {
    expect(accessDesc('open')).toBe('Все с правом «Задачи» в области видят и работают с задачами');
    expect(accessDesc('limited')).toBe(
      'Все в области видят; создают и меняют задачи участники проекта',
    );
    expect(accessDesc('closed')).toBe('Только участники проекта');
  });

  it('инициалы — первые буквы двух слов (ini эталона)', () => {
    expect(initials('Марина Котова')).toBe('МК');
    expect(initials('Илья')).toBe('И');
    expect(initials('')).toBe('?');
  });

  it('«Что может» — глаголы VERB_LABEL по действиям; у водителя — «финансы скрыты»', () => {
    expect(verbLabels(ACT_PM)).toEqual([
      'Читать',
      'Создавать',
      'Менять статус',
      'Согласовывать',
      'Настраивать',
    ]);
    expect(verbLabels(ACT_EXEC, ['финансы скрыты'])).toEqual([
      'Читать',
      'Создавать',
      'Менять статус',
      'финансы скрыты',
    ]);
    expect(verbLabels([])).toEqual([]);
  });

  it('строки: правка роли — у назначенной в проекте при «Настраивать»; себя не исключить', () => {
    const rows = memberRows(ROWS, { canEdit: true, meId: 'kotova' });
    expect(rows.map((r) => [r.name, r.editable, r.canDel, r.muted])).toEqual([
      ['Дарья Зимина', false, false, true],
      ['Марина Котова', true, false, false],
      ['Илья Васильев', false, false, false],
      ['Вера Котельникова', true, true, false],
    ]);
    expect(rows[2]?.caps).toEqual(['Читать', 'Создавать', 'Менять статус', 'финансы скрыты']);
    expect(rows[1]?.ini).toBe('МК');
    const ro = memberRows(ROWS, { canEdit: false, meId: 'owner' });
    expect(ro.every((r) => !r.editable && !r.canDel)).toBe(true);
  });

  it('кандидаты — не заблокированные без своей роли в проекте (унаследованный и системный — да)', () => {
    const people: S['Member'][] = [
      {
        id: 'owner',
        displayName: 'Дарья Зимина',
        status: 'active',
        orgUnitIds: [],
        revision: 1,
        workProfiles: [],
      },
      {
        id: 'kotova',
        displayName: 'Марина Котова',
        status: 'active',
        orgUnitIds: [],
        revision: 1,
        workProfiles: [],
      },
      {
        id: 'vasiliev',
        displayName: 'Илья Васильев',
        status: 'active',
        orgUnitIds: [],
        revision: 1,
        workProfiles: [],
      },
      {
        id: 'sokolov',
        displayName: 'Алексей Соколов',
        status: 'active',
        orgUnitIds: [],
        revision: 1,
        workProfiles: [],
      },
      {
        id: 'blocked',
        displayName: 'Олег Блок',
        status: 'suspended',
        orgUnitIds: [],
        revision: 1,
        workProfiles: [],
      },
      {
        id: 'inv',
        displayName: 'Новый Сотрудник',
        status: 'invited',
        orgUnitIds: [],
        revision: 1,
        workProfiles: [],
      },
    ];
    expect(candidates(people, ROWS)).toEqual([
      { value: 'owner', label: 'Дарья Зимина' },
      { value: 'sokolov', label: 'Алексей Соколов' },
      { value: 'inv', label: 'Новый Сотрудник' },
    ]);
    // Без списка сотрудников (нет members.read) — участники проекта без своей роли.
    expect(candidates(null, ROWS)).toEqual([{ value: 'owner', label: 'Дарья Зимина' }]);
    expect(checkPeople(people, ROWS).map((x) => x.label)).toEqual([
      'Дарья Зимина',
      'Марина Котова',
      'Илья Васильев',
      'Алексей Соколов',
      'Новый Сотрудник',
    ]);
    expect(checkPeople(null, ROWS).map((x) => x.value)).toEqual([
      'owner',
      'kotova',
      'vasiliev',
      'kotelnikova',
    ]);
  });

  it('по умолчанию: проверяется первый не системный участник, роль — «Исполнитель»', () => {
    expect(defaultCheckMember(ROWS)).toBe('kotova');
    expect(defaultCheckMember([])).toBeUndefined();
    expect(defaultRole(ROLES)).toBe('r-exec');
    expect(defaultRole([])).toBeUndefined();
  });

  it('«Роли проекта» — глаголы роли через запятую', () => {
    expect(ROLES.map(roleCaps)).toEqual([
      'Читать, Создавать, Менять статус, Согласовывать, Настраивать',
      'Читать, Согласовывать',
      'Читать, Создавать, Менять статус',
      'Читать',
    ]);
  });

  it('ответ «Проверить доступ»', () => {
    expect(
      checkText('Марина Котова', {
        memberId: 'kotova',
        action: 'tasks.approve',
        allowed: true,
        roleName: 'Руководитель проекта',
        via: 'Назначен в проекте',
      }),
    ).toBe('Марина Котова может: назначен в проекте (роль «Руководитель проекта»)');
    expect(
      checkText('Илья Васильев', {
        memberId: 'vasiliev',
        action: 'tasks.approve',
        allowed: false,
        reason: 'роль «Исполнитель» не даёт «Согласовывать»',
      }),
    ).toBe('Илья Васильев не может: роль «Исполнитель» не даёт «Согласовывать»');
  });
});

const WF: S['TaskWorkflow'] = {
  projectId: 'p',
  version: 1,
  fixed: false,
  revision: 3,
  statuses: [
    { id: 's1', name: 'Новая', category: 'todo' },
    { id: 's2', name: 'В работе', category: 'progress' },
    { id: 's3', name: 'На проверке', category: 'progress' },
    { id: 's4', name: 'Готово', category: 'done' },
    { id: 's5', name: 'Отменена', category: 'done' },
  ],
  transitions: [
    {
      key: 't1',
      name: 'Взять в работу',
      from: ['s1'],
      to: 's2',
      who: [],
      notAuthor: false,
      commentRequired: false,
      checklistClosed: false,
      childrenDone: false,
      assignAuthor: false,
    },
    {
      key: 't3',
      name: 'Согласовать',
      from: ['s3'],
      to: 's4',
      who: [],
      notAuthor: true,
      approval: { mode: 'any', rejectTo: 's2' },
      commentRequired: false,
      checklistClosed: true,
      childrenDone: true,
      assignAuthor: true,
    },
    {
      key: 't5',
      name: 'Отменить',
      from: ['*'],
      to: 's5',
      who: ['project_manager'],
      notAuthor: false,
      commentRequired: true,
      checklistClosed: false,
      childrenDone: false,
      assignAuthor: false,
    },
  ],
};

describe('«Процесс»', () => {
  it('черновик или опубликованная версия; чип версии', () => {
    expect(draftOf(WF).statuses).toHaveLength(5);
    expect(versionChip(WF)).toEqual({ text: 'Действует v1', draft: false });
    const withDraft = {
      ...WF,
      draft: { statuses: WF.statuses.slice(0, 4), transitions: [] },
    };
    expect(draftOf(withDraft).statuses).toHaveLength(4);
    expect(versionChip(withDraft)).toEqual({ text: 'Черновик · действует v1', draft: true });
  });

  it('новый статус — перед первым «Готово»; «Готово» — в конец; дубль без учёта регистра', () => {
    const d = draftOf(WF);
    expect(addStatus(d, 'Ждёт запчасть', 'progress', 'sx').statuses.map((s) => s.name)).toEqual([
      'Новая',
      'В работе',
      'На проверке',
      'Ждёт запчасть',
      'Готово',
      'Отменена',
    ]);
    expect(addStatus(d, 'Архив', 'done', 'sy').statuses.at(-1)).toEqual({
      id: 'sy',
      name: 'Архив',
      category: 'done',
    });
    expect(hasStatus(d, 'в работе')).toBe(true);
    expect(hasStatus(d, 'Пауза')).toBe(false);
  });

  it('удаление статуса убирает переходы в него и его из «откуда»; пустые переходы — тоже', () => {
    const d = removeStatus(draftOf(WF), 's1');
    expect(d.statuses.map((s) => s.id)).toEqual(['s2', 's3', 's4', 's5']);
    expect(d.transitions.map((t) => t.key)).toEqual(['t3', 't5']);
    const d2 = removeStatus(draftOf(WF), 's5');
    expect(d2.transitions.map((t) => t.key)).toEqual(['t1', 't3']);
  });

  it('путь, «кто», правила перехода', () => {
    const d = draftOf(WF);
    const [t1, t3, t5] = d.transitions as [
      S['TaskWorkflowTransition'],
      S['TaskWorkflowTransition'],
      S['TaskWorkflowTransition'],
    ];
    expect(pathOf(d, t1)).toBe('Новая → В работе');
    expect(pathOf(d, t5)).toBe('Любой → Отменена');
    expect(whoOf(t1)).toBe('Все с «Менять статус»');
    expect(whoOf(t3)).toBe('Согласующие');
    expect(whoOf(t5)).toBe('руководитель проекта');
    expect(rulesOf(t1)).toEqual(['Без правил']);
    expect(rulesOf(t3)).toEqual([
      'Согласование: один',
      'Не автор',
      'Чек-лист',
      'Подзадачи',
      'На автора',
    ]);
    expect(rulesOf(t5)).toEqual(['Комментарий']);
    expect(rulesOf({ ...t3, approval: { mode: 'all', rejectTo: 's2' } })[0]).toBe(
      'Согласование: все',
    );
  });

  it('добавить и удалить переход; «Кто может» — переключение', () => {
    const d = addTransition(draftOf(WF), { name: 'Пауза', from: '*', to: 's2' }, 'tx');
    expect(d.transitions.at(-1)).toEqual({
      key: 'tx',
      name: 'Пауза',
      from: ['*'],
      to: 's2',
      who: [],
      notAuthor: false,
      commentRequired: false,
      checklistClosed: false,
      childrenDone: false,
      assignAuthor: false,
    });
    expect(removeTransition(d, 'tx').transitions).toHaveLength(3);
    const t5 = WF.transitions[2] as S['TaskWorkflowTransition'];
    expect(toggleWho(t5, 'project_manager')).toEqual({ who: [] });
    expect(toggleWho(t5, 'author')).toEqual({ who: ['project_manager', 'author'] });
  });

  it('согласование: включить — «достаточно одного», возврат в первый статус «откуда»', () => {
    const d = draftOf(WF);
    const t1 = WF.transitions[0] as S['TaskWorkflowTransition'];
    expect(approvalPatch(d, t1, true)).toEqual({ approval: { mode: 'any', rejectTo: 's1' } });
    const t5 = WF.transitions[2] as S['TaskWorkflowTransition'];
    expect(approvalPatch(d, t5, true)).toEqual({ approval: { mode: 'any', rejectTo: 's1' } });
    expect(approvalPatch(d, t1, false)).toEqual({ approval: undefined });
  });

  it('согласующие — активные участники с «Согласовывать»; никого — «пока никого»', () => {
    expect(approverNames(ROWS)).toBe('Дарья Зимина, Марина Котова, Вера Котельникова');
    expect(approverNames([])).toBe('пока никого');
  });
});

describe('«Автоматизация»', () => {
  const rule = (o: Partial<S['TaskAutomation']>): S['TaskAutomation'] => ({
    id: 'r1',
    projectId: 'p',
    name: 'Срочная задача → назначить руководителю проекта',
    trigger: { kind: 'created' },
    condition: { priority: 'urgent' },
    action: { kind: 'assign', memberId: 'kotova' },
    enabled: true,
    version: 1,
    authorMemberId: 'kotova',
    authorDisplayName: 'Марина Котова',
    runCount: 2,
    revision: 1,
    ...o,
  });
  const names = new Map([['kotova', 'Марина Котова']]);

  it('текст правила эталона', () => {
    expect(ruleText(rule({}), WF.statuses, names)).toBe(
      'Когда задача создана, если приоритет «Срочно» → назначить на Марина Котова',
    );
    expect(
      ruleText(
        rule({
          trigger: { kind: 'status_entered', statusId: 's4' },
          condition: undefined,
          action: { kind: 'comment', text: 'Проверьте путевой лист' },
        }),
        WF.statuses,
        names,
      ),
    ).toBe('Когда задача перешла в «Готово» → комментарий «Проверьте путевой лист»');
    expect(
      ruleText(
        rule({ condition: undefined, action: { kind: 'set_priority', priority: 'high' } }),
        WF.statuses,
        names,
      ),
    ).toBe('Когда задача создана → приоритет «Высокий»');
  });

  it('мета правила', () => {
    expect(ruleMeta(rule({}))).toBe('От имени Марина Котова · v1 · запусков: 2');
  });

  it('время: сегодня — ЧЧ:ММ, иначе ДД.ММ ЧЧ:ММ (Москва)', () => {
    const now = Date.parse('2026-10-01T07:30:00Z');
    expect(stamp('2026-10-01T06:12:00Z', now)).toBe('09:12');
    expect(stamp('2026-09-27T07:12:00Z', now)).toBe('27.09 10:12');
  });

  it('строка журнала: иконка и тон результата', () => {
    const now = Date.parse('2026-10-01T07:30:00Z');
    const run: S['TaskAutomationRun'] = {
      id: 'x',
      at: '2026-10-01T06:12:00Z',
      automationId: 'r1',
      automationName: 'Правило',
      automationVersion: 1,
      result: 'ok',
      text: 'T-64 назначена: Марина Котова',
    };
    expect(runLine(run, now)).toEqual({
      text: 'T-64 назначена: Марина Котова',
      meta: '09:12 · Правило v1',
      icon: 'check_circle',
      tone: 'ok',
    });
    expect(runLine({ ...run, result: 'stopped' }, now).icon).toBe('do_not_disturb_on');
    expect(runLine({ ...run, result: 'error' }, now)).toMatchObject({
      icon: 'error',
      tone: 'error',
    });
  });
});
