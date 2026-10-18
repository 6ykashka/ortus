// Кейсы стюарда контракта этапа 2, часть 1 (W2.51, 0.6.0-stage2): «Данные» (S2-16, AC-14) — наборы «Автомобили»,
// «Поездки», «Расходы» «Альты» с правами набора и полей: колонки, фильтры, поиск по видимым полям, сортировка,
// пагинация, число видимых строк, группировка; поле «Начисление» — только с правом начислений (AC-05).
// Примеры — tools/gen/examples-w251.mjs (listDatasets/*, queryDataset/*).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

interface Row {
  recordId: string;
  cells: { fieldKey: string; value: { type: string; value: unknown } }[];
}
interface Dataset {
  id: string;
  fields: { key: string }[];
  hiddenFieldLabels?: string[];
  exportAllowed?: boolean;
}
type Body = Record<string, unknown> & {
  items?: Dataset[];
  rows?: Row[];
  nextCursor?: string | null;
  visibleCount?: number;
};
const body = (r: Reply): Body => r.body as Body;

const datasets = (ctx: CaseContext) => `${ctx.alta}/datasets`;
const query = (ctx: CaseContext, id: string) => `${ctx.alta}/datasets/${id}/query`;
const cell = (r: Row, key: string) => r.cells.find((c) => c.fieldKey === key)?.value.value;

async function ready(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  return { driver: await ctx.as('driver'), manager: await ctx.as('manager') };
}

type OrgState = {
  roles: { proto: string; permissions: string[] }[];
  fleet: { expenses: unknown[] };
};
const alta = (ctx: CaseContext) => ctx.server.state().orgs[ctx.P('t-alta')] as unknown as OrgState;

/** Снять ключ с роли «Менеджер логистики» сида (как правка роли владельцем). */
function dropKey(ctx: CaseContext, key: string): void {
  const role = alta(ctx).roles.find((r) => r.proto === 'r-manager');
  if (!role) throw new Error('нет роли r-manager');
  role.permissions = role.permissions.filter((k) => k !== key);
}

export const dataCases = cases('data')([
  {
    title:
      'каталог логиста: «Автомобили», «Поездки», «Расходы» с полями, правом набора и выгрузкой',
    operationId: 'listDatasets',
    expect: 'success',
    example: 'listDatasets/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(await manager.get(datasets(ctx)), 'listDatasets/ok');
    },
  },
  {
    title:
      'без права начислений поле «Начисление» скрыто: подпись в hiddenFieldLabels, выборка — 422',
    operationId: 'listDatasets',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      dropKey(ctx, 'fleet.earnings.read');
      dropKey(ctx, 'data.export');
      const trips = body(await manager.get(datasets(ctx))).items?.find(
        (d) => d.id === 'fleet.trips',
      );
      expect(trips?.fields.map((f) => f.key)).toEqual(['trip', 'driverName', 'state', 'mileageKm']);
      expect(trips?.hiddenFieldLabels).toEqual(['Начисление']);
      expect(trips?.exportAllowed).toBe(false);
      const r = await manager.post(query(ctx, 'fleet.trips'), {
        select: ['trip'],
        filters: [{ fieldKey: 'earnings', operator: 'is_null', values: [] }],
        sort: [],
        limit: 50,
      });
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).detail).toBe('Поле недоступно: earnings.');
    },
  },
  {
    title: 'без права набора набор не виден; «Логистика» не подключена — наборов логистики нет',
    operationId: 'listDatasets',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      expect(body(await owner.get(datasets(ctx))).items).toEqual([]);
      const { manager } = await ready(ctx);
      dropKey(ctx, 'fleet.expenses.read');
      expect(body(await manager.get(datasets(ctx))).items?.map((d) => d.id)).toEqual([
        'fleet.vehicles',
        'fleet.trips',
      ]);
      ctx.expectProblem(
        await manager.post(query(ctx, 'fleet.expenses'), {
          select: ['trip'],
          filters: [],
          sort: [],
          limit: 50,
        }),
        'forbidden_action',
      );
    },
  },
  {
    title: 'водителю «Данные» закрыты — 403',
    operationId: 'listDatasets',
    expect: 'error',
    example: 'listDatasets/forbidden_action',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(await driver.get(datasets(ctx)), 'listDatasets/forbidden_action');
    },
  },
  {
    title: '«Поездки» логиста: рейсы «Север Логистик», число видимых строк',
    operationId: 'queryDataset',
    expect: 'success',
    example: 'queryDataset/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.post(query(ctx, 'fleet.trips'), {
          select: ['trip', 'driverName', 'state', 'mileageKm'],
          filters: [],
          sort: [],
          limit: 50,
          includeCount: true,
        }),
        'queryDataset/ok',
      );
    },
  },
  {
    title: 'неизвестное поле — 422, как скрытое',
    operationId: 'queryDataset',
    expect: 'error',
    example: 'queryDataset/validation_failed',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.post(query(ctx, 'fleet.trips'), {
          select: ['plate'],
          filters: [],
          sort: [],
          limit: 50,
        }),
        'queryDataset/validation_failed',
      );
    },
  },
  {
    title: 'неизвестный набор — 404',
    operationId: 'queryDataset',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = await manager.post(query(ctx, 'fleet.earnings'), {
        select: ['trip'],
        filters: [],
        sort: [],
        limit: 50,
      });
      ctx.expectProblem(r, 'not_found');
      expect(body(r).detail).toBe('Набор не найден.');
    },
  },
  {
    title: '«Автомобили»: фильтр состояния, поиск «газ», сортировка, страницы по курсору',
    operationId: 'queryDataset',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const q = (extra: Record<string, unknown>) =>
        manager
          .post(query(ctx, 'fleet.vehicles'), {
            select: ['displayName', 'status', 'volumeM3'],
            filters: [],
            sort: [],
            limit: 50,
            ...extra,
          })
          .then(body);
      const names = (b: Body) => b.rows?.map((r) => cell(r, 'displayName'));
      // Область «Север Логистик»: пять машин из семи сида.
      const all = await q({ includeCount: true });
      expect(all.visibleCount).toBe(5);
      // Порядок — localeCompare 'ru' (как dataVM эталона): кириллица раньше латиницы.
      expect(names(all)).toEqual([
        'ГАЗель Next',
        'ГАЗон Next',
        'Ford Transit',
        'Hyundai Porter',
        'Mercedes Sprinter',
      ]);
      expect(names(await q({ search: 'газ' }))).toEqual(['ГАЗель Next', 'ГАЗон Next']);
      const free = await q({
        search: 'газ',
        filters: [
          { fieldKey: 'status', operator: 'eq', values: [{ type: 'text', value: 'available' }] },
        ],
      });
      expect(names(free)).toEqual(['ГАЗель Next']);
      const bigFirst = await q({ sort: [{ fieldKey: 'volumeM3', direction: 'desc' }], limit: 2 });
      expect(names(bigFirst)).toEqual(['ГАЗон Next', 'ГАЗель Next']);
      expect(bigFirst.nextCursor).toBeTruthy();
      const next = await q({
        sort: [{ fieldKey: 'volumeM3', direction: 'desc' }],
        limit: 2,
        cursor: bigFirst.nextCursor,
      });
      expect(names(next)).toEqual(['Mercedes Sprinter', 'Ford Transit']);
      const big = await q({
        filters: [
          { fieldKey: 'volumeM3', operator: 'gte', values: [{ type: 'decimal', value: '14' }] },
        ],
      });
      expect(names(big)).toEqual(['ГАЗель Next', 'ГАЗон Next', 'Mercedes Sprinter']);
    },
  },
  {
    title: '«Расходы»: категория, дата, сумма и статус; «Поездки» — группировка по статусу',
    operationId: 'queryDataset',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      alta(ctx).fleet.expenses.push({
        id: '5e2a7c10-0000-4000-8000-0000000000e1',
        tripId: ctx.A('Р-208'),
        kind: 'fuel',
        occurredAt: '2026-10-01T07:15:00Z',
        amount: { amountMinor: 250000, currency: 'RUB' },
        receiptFileIds: [],
        reviewState: 'pending',
        revision: 1,
      });
      const ex = body(
        await manager.post(query(ctx, 'fleet.expenses'), {
          select: ['trip', 'kind', 'occurredOn', 'amount', 'status'],
          filters: [],
          sort: [],
          limit: 50,
        }),
      );
      expect(ex.rows).toEqual([
        {
          recordId: '5e2a7c10-0000-4000-8000-0000000000e1',
          cells: [
            { fieldKey: 'trip', value: { type: 'text', value: 'Р-208' } },
            { fieldKey: 'kind', value: { type: 'choices', value: ['fuel'] } },
            { fieldKey: 'occurredOn', value: { type: 'date', value: '2026-10-01' } },
            {
              fieldKey: 'amount',
              value: { type: 'money', value: { amountMinor: 250000, currency: 'RUB' } },
            },
            { fieldKey: 'status', value: { type: 'choices', value: ['claimed'] } },
          ],
        },
      ]);
      const grouped = body(
        await manager.post(query(ctx, 'fleet.trips'), {
          select: ['state', 'trips'],
          filters: [],
          sort: [],
          groupBy: ['state'],
          aggregates: [{ function: 'count', alias: 'trips' }],
          limit: 50,
        }),
      );
      expect(grouped.rows?.map((r) => [cell(r, 'state'), cell(r, 'trips')])).toEqual([
        [['planned'], '2'],
      ]);
    },
  },
  {
    title: 'курсор привязан к набору и выборке: другая сортировка или другой набор — 400',
    operationId: 'queryDataset',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const q = (id: string, extra: Record<string, unknown>) =>
        manager.post(query(ctx, id), {
          select: ['displayName'],
          filters: [],
          sort: [{ fieldKey: 'displayName', direction: 'desc' }],
          limit: 2,
          ...extra,
        });
      const cursor = body(await q('fleet.vehicles', {})).nextCursor;
      expect(cursor).toBeTruthy();
      // Тот же запрос с другим select и limit продолжает выборку.
      const more = await q('fleet.vehicles', { select: ['status'], limit: 3, cursor });
      expect(more.status).toBe(200);
      for (const r of [
        await q('fleet.vehicles', {
          sort: [{ fieldKey: 'displayName', direction: 'asc' }],
          cursor,
        }),
        await q('fleet.vehicles', { search: 'газ', cursor }),
        await q('fleet.trips', { select: ['trip'], sort: [], cursor }),
      ]) {
        ctx.expectProblem(r, 'malformed_request');
        expect(body(r).detail).toBe('Курсор не подходит к выборке.');
      }
    },
  },
]);
