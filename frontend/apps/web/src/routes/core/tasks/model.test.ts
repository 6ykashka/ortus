// W4.12 · Модель «Задач и проектов» по логике эталона design-2026-10-19 «Задачи и проекты.dc.html»: строки проектов
// (:360–362), ключ по названию (autoKey :524), шапка (:378), колонки и карточки доски (:411–413, cardRel :499), срок
// «ДД.ММ» (:408, Р-17), размер и проверка файла (fsize :515, pickFiles :517–521), кандидаты связей (parentOpts :494–498,
// relVM :512), время истории и голосов.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  autoKey,
  cardOf,
  childOptions,
  clockOf,
  columnsOf,
  dueAtOf,
  dueLabel,
  fileIcon,
  fileReason,
  fileSize,
  firstTodo,
  initials,
  labelsOf,
  parentOptions,
  projectRows,
  projectSub,
  projectUnit,
  unitName,
} from './model.ts';

type S = components['schemas'];

const UNITS = new Map([['u-north', 'Север Логистик']]);

const project = (o: Partial<S['Project']> = {}): S['Project'] => ({
  id: 'p-log',
  name: 'Логистика · Север',
  orgUnitId: 'u-north',
  key: 'LOG',
  status: 'active',
  workflowKey: 'approval',
  revision: 1,
  access: 'limited',
  flow: 'tasks',
  ownerDisplayName: 'Марина Котова',
  workflow: { version: 1, hasDraft: false },
  counts: { members: 3, open: 5 },
  ...o,
});

const task = (o: Partial<S['Task']> & Pick<S['Task'], 'id' | 'title'>): S['Task'] => ({
  projectId: 'p-log',
  status: 's1',
  statusName: 'Новая',
  statusCategory: 'todo',
  relatedObjects: [],
  customFields: [],
  revision: 1,
  key: o.id.toUpperCase(),
  priority: 'normal',
  children: { total: 0, done: 0, hidden: 0 },
  ...o,
});

const STATUSES: S['TaskWorkflowStatus'][] = [
  { id: 's1', name: 'Новая', category: 'todo' },
  { id: 's2', name: 'В работе', category: 'progress' },
  { id: 's3', name: 'На проверке', category: 'progress' },
  { id: 's4', name: 'Готово', category: 'done' },
  { id: 's5', name: 'Отменена', category: 'done' },
];

describe('строки проектов (:360–362)', () => {
  it('проект с процессом: ключ, «{владелец} · процесс v{N}», область, доступ, людей, открыто', () => {
    const [row] = projectRows([project()], UNITS);
    expect(row).toEqual({
      id: 'p-log',
      key: 'LOG',
      name: 'Логистика · Север',
      sub: 'Марина Котова · процесс v1',
      unit: 'Север Логистик',
      access: 'limited',
      accessLabel: 'Ограниченный',
      accessIcon: 'visibility',
      people: '3',
      open: '5',
      funnel: false,
    });
  });

  it('воронка: «· воронка заявок», «Воронка», людей «—»; без процесса — «процесс не настроен»', () => {
    const rows = projectRows(
      [
        project({
          id: 'p-leads',
          key: 'ЗАЯ',
          flow: 'leads',
          ownerDisplayName: 'Дарья Зимина',
          workflow: undefined,
          counts: { members: 0, open: 4 },
          access: undefined,
        }),
        project({ id: 'p-x', orgUnitId: null, workflow: undefined, access: 'open' }),
        project({ id: 'p-y', access: 'closed' }),
      ],
      UNITS,
    );
    expect(rows.map((r) => [r.sub, r.accessLabel, r.accessIcon, r.people, r.unit])).toEqual([
      ['Дарья Зимина · воронка заявок', 'Воронка', 'filter_alt', '—', 'Север Логистик'],
      ['Марина Котова · процесс не настроен', 'Открытый', 'public', '—', 'Вся организация'],
      ['Марина Котова · процесс v1', 'Закрытый', 'lock', '3', 'Север Логистик'],
    ]);
    expect(rows[0]?.funnel).toBe(true);
  });

  it('неизвестное подразделение — «—»; null — «Вся организация»', () => {
    expect(unitName('u-x', UNITS)).toBe('—');
    expect(unitName(null, UNITS)).toBe('Вся организация');
  });

  it('область проекта: название из listOrgUnits, иначе orgUnitName ответа проекта (Q-W4.12-10), иначе «—»', () => {
    const withName = { ...project({ orgUnitId: 'u-x' }), orgUnitName: 'Север Логистик' };
    expect(projectUnit(withName, new Map())).toBe('Север Логистик');
    expect(projectUnit(project(), UNITS)).toBe('Север Логистик');
    expect(projectUnit(project({ orgUnitId: 'u-x' }), UNITS)).toBe('—');
    expect(projectUnit(project({ orgUnitId: null }), new Map())).toBe('Вся организация');
    expect(projectRows([withName], new Map())[0]?.unit).toBe('Север Логистик');
  });

  it('шапка проекта: «{область} · {уровень} проект · процесс v{N}» строчными (:378)', () => {
    expect(projectSub(project(), 'Север Логистик')).toBe(
      'Север Логистик · ограниченный проект · процесс v1',
    );
    expect(projectSub(project({ access: 'closed', workflow: undefined }), 'Вся организация')).toBe(
      'Вся организация · закрытый проект',
    );
  });
});

describe('ключ по названию (autoKey :524)', () => {
  it.each([
    ['Ремонт · ЖК Речной', 'РЖР'],
    ['Логистика', 'ЛОГ'],
    ['Склад северный восток запад юг', 'ССВЗ'],
    ['  ', ''],
    ['Fleet 2', 'F2'],
  ])('%s → %s', (name, key) => expect(autoKey(name)).toBe(key));
});

describe('доска (:411–413, cardRel :499)', () => {
  const tasks = [
    task({
      id: 't-66',
      key: 'T-66',
      title: 'Подготовить парк к зиме',
      status: 's2',
      statusName: 'В работе',
      statusCategory: 'progress',
      priority: 'high',
      dueAt: '2026-10-15T21:00:00Z',
      assigneeDisplayName: 'Марина Котова',
      children: { total: 2, done: 0, hidden: 0 },
    }),
    task({
      id: 't-65',
      key: 'T-65',
      title: 'Заменить шины на ГАЗон Next (зимние)',
      status: 's3',
      statusName: 'На проверке',
      statusCategory: 'progress',
      priority: 'high',
      dueAt: '2026-10-10T21:00:00Z',
      assigneeDisplayName: 'Илья Васильев',
      parentTaskId: 't-66',
      parent: { taskId: 't-66', state: 'visible', key: 'T-66', title: 'Подготовить парк к зиме' },
      approval: {
        transitionKey: 't3',
        transitionName: 'Согласовать',
        mode: 'any',
        workflowVersion: 1,
        approvers: [],
        canApprove: true,
        canReject: true,
      },
    }),
    task({ id: 't-64', key: 'T-64', title: 'Найти водителя', priority: 'urgent' }),
  ];

  it('колонки — статусы процесса по порядку, счётчики, карточки своих статусов', () => {
    const cols = columnsOf(STATUSES, tasks);
    expect(cols.map((c) => [c.name, c.category, c.count])).toEqual([
      ['Новая', 'todo', 1],
      ['В работе', 'progress', 1],
      ['На проверке', 'progress', 1],
      ['Готово', 'done', 0],
      ['Отменена', 'done', 0],
    ]);
    expect(cols[2]?.cards.map((c) => c.key)).toEqual(['T-65']);
  });

  it('карточка: связь ↳ родитель или ☰ готово/всего, согласование, приоритет, срок, инициалы', () => {
    expect(cardOf(tasks[1] as S['Task'])).toEqual({
      id: 't-65',
      key: 'T-65',
      title: 'Заменить шины на ГАЗон Next (зимние)',
      rel: '↳ T-66',
      appr: 'Ждёт вас',
      priority: 'high',
      priorityLabel: 'Высокий',
      due: '10.10',
      initials: 'ИВ',
      who: 'Илья Васильев',
    });
    const t66 = cardOf(tasks[0] as S['Task']);
    expect([t66.rel, t66.appr, t66.due]).toEqual(['☰ 0/2', null, '15.10']);
    const t64 = cardOf(tasks[2] as S['Task']);
    expect([t64.rel, t64.priorityLabel, t64.due, t64.initials]).toEqual([null, 'Срочно', '', '?']);
  });

  it('согласование, которое ждёт не меня, — «На согласовании»; скрытый родитель — без номера', () => {
    const t = task({
      id: 't-1',
      title: 'Т',
      parent: { state: 'hidden' },
      approval: {
        transitionKey: 't3',
        transitionName: 'Согласовать',
        mode: 'all',
        workflowVersion: 1,
        approvers: [],
        canApprove: false,
        canReject: false,
      },
    });
    expect([cardOf(t).rel, cardOf(t).appr]).toEqual([null, 'На согласовании']);
  });

  it('первый статус категории «К выполнению» (:397)', () => {
    expect(firstTodo(STATUSES)?.name).toBe('Новая');
    expect(firstTodo([{ id: 'a', name: 'А', category: 'progress' }])?.name).toBe('А');
  });
});

describe('срок (:408, Р-17)', () => {
  it('«ДД.ММ» по Москве: конец дня сида — тот же день', () => {
    expect(dueLabel('2026-10-10T21:00:00Z')).toBe('10.10');
    expect(dueLabel('2026-10-01T09:00:00Z')).toBe('01.10');
    expect(dueLabel(undefined)).toBe('');
  });
  it('дата формы → конец дня по Москве (начало следующих суток)', () => {
    expect(dueAtOf('2026-10-10')).toBe('2026-10-10T21:00:00Z');
    expect(dueAtOf('')).toBeUndefined();
  });
});

describe('инициалы, метки', () => {
  it('инициалы — первые буквы двух слов, без имени — «?» (:320)', () => {
    expect(initials('Илья Васильев')).toBe('ИВ');
    expect(initials('Котова')).toBe('К');
    expect(initials(undefined)).toBe('?');
  });
  it('метки «через запятую» — без пустых', () => {
    expect(labelsOf(' Зима, закупка ,, ')).toEqual(['Зима', 'закупка']);
    expect(labelsOf('')).toEqual([]);
  });
});

describe('файлы (fsize :515, pickFiles :517–521, fileVM :516)', () => {
  it('размер: КБ до 1 МБ (не меньше 1), дальше МБ с запятой', () => {
    expect(fileSize(184320)).toBe('180 КБ');
    expect(fileSize(10)).toBe('1 КБ');
    expect(fileSize(1572864)).toBe('1,5 МБ');
  });
  it('причины: 30 файлов, 20 МБ, пустой, тип', () => {
    expect(fileReason({ size: 100, type: 'application/pdf' }, 0)).toBeNull();
    expect(fileReason({ size: 100, type: 'image/png' }, 30)).toBe('tooMany');
    expect(fileReason({ size: 21 * 1048576, type: 'image/png' }, 0)).toBe('tooBig');
    expect(fileReason({ size: 0, type: 'text/plain' }, 0)).toBe('empty');
    expect(fileReason({ size: 5, type: 'application/x-msdownload' }, 0)).toBe('type');
    expect(fileReason({ size: 5, type: 'application/zip' }, 0)).toBeNull();
    expect(
      fileReason(
        {
          size: 5,
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        0,
      ),
    ).toBeNull();
  });
  it('иконка по типу', () => {
    expect(fileIcon('application/pdf')).toBe('picture_as_pdf');
    expect(fileIcon('image/jpeg')).toBe('image');
    expect(fileIcon('application/vnd.ms-excel')).toBe('table_chart');
    expect(fileIcon('text/plain')).toBe('description');
  });
});

describe('кандидаты связей (parentOpts :494–498, relVM :512)', () => {
  const all = [
    task({ id: 'a', key: 'T-1', title: 'Корень' }),
    task({ id: 'b', key: 'T-2', title: 'Дочерняя', parentTaskId: 'a' }),
    task({ id: 'c', key: 'T-3', title: 'Внучка', parentTaskId: 'b' }),
    task({ id: 'd', key: 'T-4', title: 'Готовая', statusCategory: 'done' }),
    task({ id: 'e', key: 'T-5', title: 'x'.repeat(70) }),
  ];

  it('«Входит в задачу»: незавершённые, кроме самой задачи и её потомков; тема до 60 символов', () => {
    expect(parentOptions(all, null).map((o) => o.label)).toEqual([
      'T-1 · Корень',
      'T-2 · Дочерняя',
      'T-3 · Внучка',
      `T-5 · ${'x'.repeat(60)}`,
    ]);
    expect(parentOptions(all, all[0] as S['Task']).map((o) => o.value)).toEqual(['e']);
  });

  it('«Добавить существующую…»: без предков и без задач, у которых уже есть родитель', () => {
    expect(childOptions(all, all[2] as S['Task']).map((o) => o.value)).toEqual(['e']);
    expect(childOptions(all, all[0] as S['Task']).map((o) => o.value)).toEqual(['e']);
  });
});

describe('время истории и голосов', () => {
  const now = Date.parse('2026-10-01T10:30:00+03:00');
  it('сегодня — «ЧЧ:ММ», другой день — «ДД.ММ ЧЧ:ММ» по Москве', () => {
    expect(clockOf('2026-10-01T07:42:00Z', now)).toBe('10:42');
    expect(clockOf('2026-09-27T07:12:00Z', now)).toBe('27.09 10:12');
  });
});
