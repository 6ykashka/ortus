// Кейсы W4.80 (0.11.1-stage4, FollowUp критики выхода этапа 4, П-1): наборы «Данных» этапа 4 эталона
// design-2026-10-19 (dataVM :4189) — «Ответы на осмотр» (forms.responses: ответы формы «Осмотр машины», видимость как
// listFormResponses) и «Задачи» (tasks: видимость как listTasks). Модули «Задачи» и «Формы» — модули ядра: их наборы
// есть и без «Логистики». Примеры — tools/gen/examples-w480.mjs (queryDataset/tasks, queryDataset/responses,
// listDatasets/ok — каталог логиста с пятью наборами).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

interface Row {
  recordId: string;
  cells: { fieldKey: string; value: { type: string; value: unknown } }[];
}
interface Dataset {
  id: string;
  moduleKey: string;
  name: string;
  entityType?: string;
  permissionKey?: string;
  exportAllowed?: boolean;
  fields: { key: string; label: string; valueType: string }[];
}
type Body = Record<string, unknown> & { items?: Dataset[]; rows?: Row[]; visibleCount?: number };
const body = (r: Reply): Body => r.body as Body;

const datasets = (ctx: CaseContext) => `${ctx.alta}/datasets`;
const query = (ctx: CaseContext, id: string) => `${ctx.alta}/datasets/${id}/query`;
const texts = (r: Row) =>
  r.cells.map((c) => (c.value.type === 'null' ? '—' : String(c.value.value)));

type OrgState = { roles: { proto: string; permissions: string[] }[] };
const alta = (ctx: CaseContext) => ctx.server.state().orgs[ctx.P('t-alta')] as unknown as OrgState;

/** Снять ключ со всех ролей «Альты» (как правка ролей владельцем): у логиста и роль проекта LOG. */
function dropKey(ctx: CaseContext, key: string): void {
  for (const role of alta(ctx).roles) role.permissions = role.permissions.filter((k) => k !== key);
}

const RESPONSES = ['response', 'object', 'author', 'version', 'fuel'];
const TASKS = ['task', 'assignee', 'status', 'due'];

export const dataW480Cases = cases('data')([
  {
    title: 'каталог логиста: после «Расходов» — «Ответы на осмотр» и «Задачи» с полями эталона',
    operationId: 'listDatasets',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const manager = await ctx.as('manager');
      const items = body(await manager.get(datasets(ctx))).items ?? [];
      expect(items.map((d) => d.id)).toEqual([
        'fleet.vehicles',
        'fleet.trips',
        'fleet.expenses',
        'forms.responses',
        'tasks',
      ]);
      const [responses, tasks] = items.slice(3);
      expect([responses?.moduleKey, responses?.name, responses?.entityType]).toEqual([
        'forms',
        'Ответы на осмотр',
        'form_response',
      ]);
      expect(responses?.permissionKey).toBe('forms.responses.read');
      expect(responses?.fields.map((f) => f.label)).toEqual([
        'Ответ',
        'Объект',
        'Автор',
        'Версия формы',
        'Топливо',
      ]);
      expect([tasks?.moduleKey, tasks?.name, tasks?.entityType, tasks?.permissionKey]).toEqual([
        'tasks',
        'Задачи',
        'task',
        'tasks.read',
      ]);
      expect(tasks?.fields.map((f) => [f.label, f.valueType])).toEqual([
        ['Задача', 'text'],
        ['Исполнитель', 'text'],
        ['Статус', 'text'],
        ['Срок', 'date'],
      ]);
    },
  },
  {
    title:
      '«Ответы на осмотр» владельца: R-0988 и R-1012, топливо — q-fuel-t или вариант q-fuel версии ответа',
    operationId: 'queryDataset',
    expect: 'success',
    example: 'queryDataset/responses',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const owner = await ctx.as('owner');
      const r = await owner.post(query(ctx, 'forms.responses'), {
        select: RESPONSES,
        filters: [],
        sort: [],
        limit: 50,
        includeCount: true,
      });
      ctx.expectExample(r, 'queryDataset/responses');
      expect(body(r).rows?.map(texts)).toEqual([
        ['R-0988', 'Рейс Р-171', 'Кирилл Громов', 'v2', 'почти полный'],
        ['R-1012', 'Рейс Р-196', 'Илья Васильев', 'v3', '¾'],
      ]);
    },
  },
  {
    title: '«Задачи» владельца: 11 задач «Альты», поиск «осмотр» — T-61 со сроком 27.09',
    operationId: 'queryDataset',
    expect: 'success',
    example: 'queryDataset/tasks',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const owner = await ctx.as('owner');
      const all = body(
        await owner.post(query(ctx, 'tasks'), {
          select: ['task'],
          filters: [],
          sort: [],
          limit: 50,
          includeCount: true,
        }),
      );
      expect(all.visibleCount).toBe(11);
      const r = await owner.post(query(ctx, 'tasks'), {
        select: TASKS,
        filters: [],
        sort: [],
        limit: 50,
        includeCount: true,
        search: 'осмотр',
      });
      ctx.expectExample(r, 'queryDataset/tasks');
      expect(body(r).rows?.map(texts)).toEqual([
        ['T-61 · Проверить осмотр Р-196', 'Марина Котова', 'Готово', '2026-09-27'],
      ]);
    },
  },
  {
    title: 'без forms.responses.read и tasks.read наборов нет в каталоге, выборка — 403',
    operationId: 'queryDataset',
    expect: 'error',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const manager = await ctx.as('manager');
      dropKey(ctx, 'forms.responses.read');
      dropKey(ctx, 'tasks.read');
      expect(body(await manager.get(datasets(ctx))).items?.map((d) => d.id)).toEqual([
        'fleet.vehicles',
        'fleet.trips',
        'fleet.expenses',
      ]);
      for (const [id, select] of [
        ['forms.responses', 'response'],
        ['tasks', 'task'],
      ] as const) {
        ctx.expectProblem(
          await manager.post(query(ctx, id), {
            select: [select],
            filters: [],
            sort: [],
            limit: 50,
          }),
          'forbidden_action',
        );
      }
    },
  },
  {
    title: 'логист: ответы о рейсах своей области и задачи своих проектов',
    operationId: 'queryDataset',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const manager = await ctx.as('manager');
      const tasks = body(
        await manager.post(query(ctx, 'tasks'), {
          select: ['task'],
          filters: [],
          sort: [],
          limit: 50,
          search: 'T-6',
        }),
      );
      expect(tasks.rows?.map(texts)).toEqual([
        ['T-61 · Проверить осмотр Р-196'],
        ['T-63 · Обновить регламент приёмки смены'],
        ['T-64 · Найти водителя на рейс Р-211'],
        ['T-65 · Заменить шины на ГАЗон Next (зимние)'],
        ['T-66 · Подготовить парк к зиме'],
      ]);
      const responses = body(
        await manager.post(query(ctx, 'forms.responses'), {
          select: ['response'],
          filters: [],
          sort: [],
          limit: 50,
        }),
      );
      // Рейсы ответов сида (Р-171, Р-196) прошли — их нет; логист видит их с fleet.trips.read (Q-W4.21-17).
      expect(responses.rows?.map(texts)).toEqual([['R-0988'], ['R-1012']]);
    },
  },
]);
