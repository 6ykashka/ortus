// Сид «Задач и проектов»: сырые проекты и задачи организаций (mock-data.js 14.10:75–79, 276–287)
// и стадия сида `normProjects` (api.js:23–36): проекты с процессом получают уровень доступа,
// процесс, правила и журнал; у LOG — задачи T-65 и T-66, правила ar-1/ar-2 и два запуска.
// Стадия идёт первой в `SEED_STAGES` ядра; у «Лотоса» её нет (`seedStagesFor`).
import type { Automation, AutomationRun, Project, Task } from './types.ts';
import { buildWf, projectsOf } from './workflow.ts';

export interface TasksSeed {
  projects: Project[];
  tasks: Task[];
}

const t = (o: Partial<Task> & Pick<Task, 'id' | 'title' | 'assignee' | 'status'>): Task => ({
  priority: 'normal',
  due: '—',
  project: 'fleet',
  checklist: [],
  comments: [],
  links: [],
  ...o,
});

function alta(): TasksSeed {
  return {
    projects: [
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
    ],
    tasks: [
      t({
        id: 'T-61',
        title: 'Проверить осмотр Р-196',
        assignee: 'Марина Котова',
        status: 'Готово',
        source: 'R-1012',
        rule: 'au-1 · v1',
        due: '27.09',
        checklist: [
          { t: 'Сверить фото с прошлым осмотром', d: true },
          { t: 'Проверить пробег', d: true },
        ],
        comments: [{ by: 'Марина Котова', at: '27.09 10:12', text: 'Замечаний нет.' }],
        links: [
          { kind: 'response', id: 'R-1012', label: 'Ответ R-1012' },
          { kind: 'trip', id: 'Р-196', label: 'Рейс Р-196' },
        ],
      }),
      t({
        id: 'T-58',
        title: 'Записать ГАЗон Next на плановое ТО',
        assignee: 'Марина Котова',
        status: 'В работе',
        priority: 'high',
        due: '02.10',
        checklist: [
          { t: 'Согласовать дату с сервисом', d: true },
          { t: 'Перенести рейсы на другие машины', d: false },
          { t: 'Отметить недоступность в календаре', d: false },
        ],
        links: [{ kind: 'vehicle', id: 'v4', label: 'ГАЗон Next Е 905 НА 77' }],
      }),
      t({
        id: 'T-63',
        title: 'Обновить регламент приёмки смены',
        assignee: 'Дарья Зимина',
        status: 'На проверке',
        due: '03.10',
        checklist: [{ t: 'Добавить фото одометра', d: true }],
        comments: [{ by: 'Дарья Зимина', at: '30.09 17:40', text: 'Передаю на проверку Марине.' }],
        links: [{ kind: 'form', id: 'fm-insp', label: 'Форма «Осмотр машины»' }],
      }),
      t({
        id: 'L-31',
        title: 'Квартира 64 м², Химки',
        assignee: 'Дарья Зимина',
        status: 'Новая',
        priority: 'high',
        due: '03.10',
        project: 'leads',
        lead: { client: 'Пётр Фомин', source: 'Сайт', sum: null },
        checklist: [{ t: 'Перезвонить и назначить замер', d: false }],
      }),
      t({
        id: 'L-29',
        title: 'Дом 120 м², Истра',
        assignee: 'Алексей Соколов',
        status: 'Замер',
        due: '22.10',
        project: 'leads',
        lead: { client: 'Сергей Ветров', source: 'Рекомендация', sum: null },
        checklist: [{ t: 'Замер 22.10 в 11:00', d: false }],
      }),
      t({
        id: 'L-27',
        title: 'Квартира 51 м², Люберцы',
        assignee: 'Дарья Зимина',
        status: 'Смета',
        due: '10.10',
        project: 'leads',
        lead: { client: 'Мария Кравец', source: 'Авито', sum: 980000 },
      }),
      t({
        id: 'L-24',
        title: 'Офис 90 м², Сокол',
        assignee: 'Дарья Зимина',
        status: 'Договор',
        priority: 'high',
        due: '05.10',
        project: 'leads',
        lead: { client: 'ООО «Вектор»', source: 'Сайт', sum: 1640000 },
      }),
      t({
        id: 'L-18',
        title: 'ЖК Речной · квартира 42',
        assignee: 'Алексей Соколов',
        status: 'Объект',
        due: '01.10',
        project: 'leads',
        lead: { client: 'Ольга Смирнова', source: 'Сайт', sum: 1186000 },
      }),
      t({
        id: 'T-64',
        title: 'Найти водителя на рейс Р-211',
        assignee: 'Марина Котова',
        status: 'Новая',
        priority: 'urgent',
        due: '01.10',
        links: [{ kind: 'trip', id: 'Р-211', label: 'Рейс Р-211' }],
      }),
    ],
  };
}

function lotos(): TasksSeed {
  return {
    projects: [
      {
        id: 'salon',
        key: 'SPA',
        name: 'Салон · Тверская',
        unit: 'f-lotos-tver',
        owner: 'Ирина Белова',
      },
    ],
    tasks: [
      t({
        id: 'T-7',
        title: 'Заказать масло для массажа',
        assignee: 'Ирина Белова',
        status: 'В работе',
        due: '03.10',
        project: 'salon',
      }),
      t({
        id: 'T-8',
        title: 'График мастеров на ноябрь',
        assignee: 'Ирина Белова',
        status: 'Новая',
        priority: 'high',
        due: '10.10',
        project: 'salon',
      }),
    ],
  };
}

const SEEDS: Readonly<Record<string, () => TasksSeed>> = { 't-alta': alta, 't-lotos': lotos };

/** Сырые проекты и задачи организации; новая организация — без них. Каждый вызов — новые объекты. */
export const tasksSeed = (tenantId: string): TasksSeed =>
  SEEDS[tenantId]?.() ?? { projects: [], tasks: [] };

/** Демо проекта LOG: «Заменить шины» ждёт согласования, автор сам согласовать не может. */
function fleetDemo(): { tasks: Task[]; automations: Automation[]; runs: AutomationRun[] } {
  const ar1 = 'Срочная задача → назначить руководителю проекта';
  return {
    tasks: [
      t({
        id: 'T-66',
        title: 'Подготовить парк к зиме',
        description:
          'Шины, антифриз и проверка аккумуляторов по всем машинам фирмы «Север» до 15.10.',
        labels: ['зима'],
        files: [],
        assignee: 'Марина Котова',
        author: 'Марина Котова',
        authorId: 'm-kotova',
        status: 'В работе',
        priority: 'high',
        due: '15.10',
        comments: [
          {
            by: 'Марина Котова',
            at: '09:30',
            text: 'Собрала в одну задачу всё, что нужно сделать до холодов',
          },
        ],
      }),
      t({
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
      }),
    ],
    automations: [
      {
        id: 'ar-1',
        name: ar1,
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
    ],
    runs: [
      {
        at: '09:12',
        rule: 'ar-1',
        name: ar1,
        rv: 1,
        res: 'ok',
        text: 'T-64 назначена: Марина Котова',
        task: 'T-64',
      },
      {
        at: '08:40',
        rule: 'ar-1',
        name: ar1,
        rv: 1,
        res: 'stopped',
        text: 'T-63: приоритет «Обычный» — условие не выполнено',
        task: 'T-63',
      },
    ],
  };
}

/** Стадия сида `normProjects`: идемпотентна (демо LOG добавляется, только если T-65 ещё нет). */
export function normProjects(d: { projects?: readonly unknown[]; tasks?: Task[] }): void {
  const tasks = (d.tasks ??= []);
  for (const p of projectsOf(d)) {
    if (p.flow === 'leads') continue;
    p.access ??= 'limited';
    p.automations ??= [];
    p.runs ??= [];
    p.wf ??= buildWf(p.id === 'fleet' ? 'approval' : 'simple');
    if (p.id !== 'fleet' || tasks.some((x) => x.id === 'T-65')) continue;
    const demo = fleetDemo();
    tasks.unshift(...demo.tasks);
    for (const id of ['T-65', 'T-58']) {
      const x = tasks.find((y) => y.id === id);
      if (x) x.parent = 'T-66';
    }
    p.automations = demo.automations;
    p.runs = demo.runs;
  }
}
