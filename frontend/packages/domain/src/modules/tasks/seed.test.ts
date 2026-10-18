import { describe, expect, it } from 'vitest';
import { normProjects, tasksSeed } from './seed.ts';
import type { Project, Task } from './types.ts';
import { buildWf } from './workflow.ts';

const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const byId = <T extends { id: string }>(xs: readonly T[], id: string): T => {
  const x = xs.find((y) => y.id === id);
  if (!x) throw new Error(id);
  return x;
};

describe('tasksSeed: проекты и задачи сырого сида (mock-data.js 14.10)', () => {
  it('«Альта»: «Логистика · Север» и воронка «Заявки · Ремонт», 9 задач', () => {
    const s = tasksSeed('t-alta');
    expect(s.projects).toEqual([
      {
        id: 'fleet',
        key: 'LOG',
        name: 'Логистика · Север',
        unit: 'f-msk-sever',
        owner: 'Марина Котова',
      },
      {
        id: 'leads',
        key: 'ЗАЯ',
        name: 'Заявки · Ремонт',
        flow: 'leads',
        unit: 'f-msk-sever',
        owner: 'Дарья Зимина',
      },
    ]);
    expect(ids(s.tasks)).toEqual([
      'T-61',
      'T-58',
      'T-63',
      'L-31',
      'L-29',
      'L-27',
      'L-24',
      'L-18',
      'T-64',
    ]);
    expect(byId(s.tasks, 'T-61')).toMatchObject({
      source: 'R-1012',
      rule: 'au-1 · v1',
      status: 'Готово',
      links: [
        { kind: 'response', id: 'R-1012', label: 'Ответ R-1012' },
        { kind: 'trip', id: 'Р-196', label: 'Рейс Р-196' },
      ],
    });
    expect(byId(s.tasks, 'L-24').lead).toEqual({
      client: 'ООО «Вектор»',
      source: 'Сайт',
      sum: 1640000,
    });
    expect(byId(s.tasks, 'T-64')).toMatchObject({ priority: 'urgent', assignee: 'Марина Котова' });
  });

  it('«Лотос»: салон на Тверской и две задачи; новая организация — пусто', () => {
    const s = tasksSeed('t-lotos');
    expect(s.projects).toEqual([
      {
        id: 'salon',
        key: 'SPA',
        name: 'Салон · Тверская',
        unit: 'f-lotos-tver',
        owner: 'Ирина Белова',
      },
    ]);
    expect(s.tasks.map((t) => [t.id, t.status, t.due])).toEqual([
      ['T-7', 'В работе', '03.10'],
      ['T-8', 'Новая', '10.10'],
    ]);
    expect(tasksSeed('t-new')).toEqual({ projects: [], tasks: [] });
  });

  it('каждый вызов — новые объекты', () => {
    const a = tasksSeed('t-alta');
    a.tasks.length = 0;
    expect(tasksSeed('t-alta').tasks).toHaveLength(9);
  });
});

describe('normProjects: процесс, доступ и демо проекта LOG (api.js:23–36)', () => {
  const norm = () => {
    const s = tasksSeed('t-alta');
    normProjects(s);
    return s;
  };

  it('проекты с процессом: «ограниченный», процесс с согласованием у LOG; «Заявки» не трогаются', () => {
    const s = norm();
    const fleet = byId(s.projects as Project[], 'fleet');
    expect(fleet).toMatchObject({ access: 'limited', wf: buildWf('approval') });
    expect(byId(s.projects as Project[], 'leads')).toEqual(tasksSeed('t-alta').projects[1]);
  });

  it('T-65 и T-66 сверху; T-65 и T-58 — подзадачи T-66', () => {
    const s = norm();
    expect(ids(s.tasks).slice(0, 3)).toEqual(['T-66', 'T-65', 'T-61']);
    expect(s.tasks).toHaveLength(11);
    expect(byId(s.tasks, 'T-65')).toEqual({
      id: 'T-65',
      title: 'Заменить шины на ГАЗон Next (зимние)',
      description:
        'Комплект зимних шин 215/75 R17.5, 6 шт., с шиномонтажом.\nСезонная замена до 15.10. Счёт поставщика во вложении.',
      labels: ['шины', 'закупка'],
      files: [
        {
          id: 'f-1',
          name: 'Счёт № 418 от 07.10.pdf',
          size: 184320,
          type: 'application/pdf',
          url: null,
          by: 'Илья Васильев',
          byId: 'm-vasiliev',
          at: '10:41',
        },
      ],
      assignee: 'Илья Васильев',
      author: 'Илья Васильев',
      authorId: 'm-vasiliev',
      status: 'На проверке',
      priority: 'high',
      due: '10.10',
      project: 'fleet',
      checklist: [
        { t: 'Счёт приложен', d: true },
        { t: 'Сезонность подтверждена', d: true },
      ],
      comments: [
        {
          by: 'Илья Васильев',
          at: '10:42',
          text: 'Сумма 48 600 ₽, счёт во вложении. Прошу согласовать.',
        },
      ],
      links: [],
      parent: 'T-66',
    } satisfies Task);
    expect(byId(s.tasks, 'T-66')).toMatchObject({
      title: 'Подготовить парк к зиме',
      author: 'Марина Котова',
      authorId: 'm-kotova',
      status: 'В работе',
      due: '15.10',
      files: [],
    });
    expect(byId(s.tasks, 'T-58').parent).toBe('T-66');
    expect(byId(s.tasks, 'T-61').parent).toBeUndefined();
  });

  it('правила ar-1 (включено) и ar-2 (выключено), журнал из двух запусков', () => {
    const fleet = byId(norm().projects as Project[], 'fleet');
    expect(fleet.automations).toEqual([
      {
        id: 'ar-1',
        name: 'Срочная задача → назначить руководителю проекта',
        trigger: 'created',
        to: null,
        cond: { priority: 'urgent' },
        action: { kind: 'assign', value: 'Марина Котова' },
        on: true,
        version: 1,
        by: 'Марина Котова',
        byId: 'm-kotova',
      },
      {
        id: 'ar-2',
        name: 'Задача готова → напомнить про путевой лист',
        trigger: 'status',
        to: 's4',
        cond: null,
        action: { kind: 'comment', value: 'Проверьте, что путевой лист сдан в бухгалтерию' },
        on: false,
        version: 1,
        by: 'Дарья Зимина',
        byId: 'm-owner',
      },
    ]);
    expect(fleet.runs).toEqual([
      {
        at: '09:12',
        rule: 'ar-1',
        name: 'Срочная задача → назначить руководителю проекта',
        rv: 1,
        res: 'ok',
        text: 'T-64 назначена: Марина Котова',
        task: 'T-64',
      },
      {
        at: '08:40',
        rule: 'ar-1',
        name: 'Срочная задача → назначить руководителю проекта',
        rv: 1,
        res: 'stopped',
        text: 'T-63: приоритет «Обычный» — условие не выполнено',
        task: 'T-63',
      },
    ]);
  });

  it('повторный запуск ничего не меняет', () => {
    const s = norm();
    const before = structuredClone(s);
    normProjects(s);
    expect(s).toEqual(before);
  });

  it('другие проекты получают простой процесс; заданные доступ, процесс и правила сохраняются', () => {
    const own: Project = {
      id: 'pj-7',
      key: 'ОФИС',
      name: 'Офис',
      owner: 'Дарья Зимина',
      access: 'open',
      wf: { ...buildWf('approval'), v: 4 },
    };
    const s = { projects: [{ id: 'salon', key: 'SPA', name: 'Салон', owner: 'x' }, own] };
    normProjects(s);
    expect(s.projects[0]).toMatchObject({
      access: 'limited',
      wf: buildWf('simple'),
      automations: [],
      runs: [],
    });
    expect(s.projects[1]).toMatchObject({ access: 'open', automations: [], runs: [] });
    expect((s.projects[1] as Project).wf?.v).toBe(4);
    expect((s as { tasks?: Task[] }).tasks).toEqual([]);
  });
});
