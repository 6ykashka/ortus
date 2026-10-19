// Кейсы контрактного PR 5 этапа 4 (W4.06, 0.7.0-stage4): «Данные» (W4.50) — сохранённые виды набора (DATA-03:
// личный и общий, поля, скрытые правами смотрящего, вырезаются) и выгрузка заданием с журналом (07-ux-and-data §3:
// снимок, срок, повторная проверка прав при скачивании, отзыв). Сюжет — Марина Котова («Север Логистик», пресет
// logistics-ready) сохраняет вид «Поездки: «Р-208»» (dtViews эталона) и выгружает «Поездки» по нему.
// Примеры — tools/gen/examples-w406.mjs (listDatasetViews/*, createDatasetView/*, … revokeDatasetExportJob/*).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Body = Record<string, unknown> & {
  id?: string;
  items?: Record<string, unknown>[];
  state?: string;
  revision?: number;
  hiddenFieldLabels?: string[];
  query?: { filters: { fieldKey: string }[]; select?: string[] };
};
const body = (r: Reply): Body => r.body as Body;

const views = (ctx: CaseContext) => `${ctx.alta}/datasets/fleet.trips/views`;
const jobs = (ctx: CaseContext) => `${ctx.alta}/data/export-jobs`;
const startJob = (ctx: CaseContext) => `${ctx.alta}/datasets/fleet.trips/export-jobs`;

const VIEW = { name: 'Поездки: «Р-208»', query: { filters: [], search: 'Р-208', sort: [] } };
const SPEC = { select: ['trip', 'driverName', 'state'], filters: [], search: 'Р-208', sort: [] };

async function manager(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  return ctx.as('manager');
}

type OrgState = {
  roles: { proto: string; permissions: string[] }[];
  policyVersion: number;
};
const alta = (ctx: CaseContext) => ctx.server.state().orgs[ctx.P('t-alta')] as unknown as OrgState;
function dropKey(ctx: CaseContext, key: string): void {
  const role = alta(ctx).roles.find((r) => r.proto === 'r-manager');
  if (!role) throw new Error('нет роли r-manager');
  role.permissions = role.permissions.filter((k) => k !== key);
  alta(ctx).policyVersion++;
}

export const dataW406Cases = cases('data-w406')([
  {
    title: '«Сохранить вид»: личный вид «Поездки: «Р-208»» — 201',
    operationId: 'createDatasetView',
    expect: 'success',
    example: 'createDatasetView/created',
    run: async (ctx) => {
      const m = await manager(ctx);
      ctx.expectExample(await m.post(views(ctx), VIEW), 'createDatasetView/created');
    },
  },
  {
    title: 'то же имя у автора — 422 «Вид с таким именем уже есть.»',
    operationId: 'createDatasetView',
    expect: 'error',
    example: 'createDatasetView/validation_failed',
    run: async (ctx) => {
      const m = await manager(ctx);
      await m.post(views(ctx), VIEW);
      ctx.expectExample(
        await m.post(views(ctx), { ...VIEW, name: 'поездки: «р-208»' }),
        'createDatasetView/validation_failed',
      );
    },
  },
  {
    title: 'общий вид без права выгрузки — 403; владелец публикует общий',
    operationId: 'createDatasetView',
    expect: 'error',
    run: async (ctx) => {
      const m = await manager(ctx);
      dropKey(ctx, 'data.export');
      ctx.expectProblem(
        await m.post(views(ctx), { ...VIEW, visibility: 'shared' }),
        'forbidden_action',
      );
      const owner = await ctx.as('owner');
      const r = await owner.post(views(ctx), {
        ...VIEW,
        name: 'Рейсы Север',
        visibility: 'shared',
      });
      expect([r.status, body(r).visibility]).toEqual([201, 'shared']);
      const list = body(await m.get(views(ctx))).items?.map((v) => v.name);
      expect(list).toEqual(['Рейсы Север']);
    },
  },
  {
    title: '«Вид»: свои личные и общие виды набора',
    operationId: 'listDatasetViews',
    expect: 'success',
    example: 'listDatasetViews/ok',
    run: async (ctx) => {
      const m = await manager(ctx);
      await m.post(views(ctx), VIEW);
      ctx.expectExample(await m.get(views(ctx)), 'listDatasetViews/ok');
      const owner = await ctx.as('owner');
      expect(body(await owner.get(views(ctx))).items).toEqual([]);
    },
  },
  {
    title: 'поле, скрытое правами, вырезается из вида: «Начисление» в hiddenFieldLabels',
    operationId: 'listDatasetViews',
    expect: 'success',
    run: async (ctx) => {
      const m = await manager(ctx);
      await m.post(views(ctx), {
        name: 'С начислением',
        query: {
          select: ['trip', 'earnings'],
          filters: [{ fieldKey: 'earnings', operator: 'is_null', values: [] }],
          sort: [{ fieldKey: 'earnings', direction: 'desc' }],
        },
      });
      dropKey(ctx, 'fleet.earnings.read');
      const v = body(await m.get(views(ctx))).items?.[0] as Body;
      expect(v.hiddenFieldLabels).toEqual(['Начисление']);
      expect(v.query).toEqual({ select: ['trip'], filters: [], sort: [] });
    },
  },
  {
    title: 'водителю «Данные» закрыты — 403',
    operationId: 'listDatasetViews',
    expect: 'error',
    example: 'listDatasetViews/forbidden_action',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const driver = await ctx.as('driver');
      ctx.expectExample(await driver.get(views(ctx)), 'listDatasetViews/forbidden_action');
    },
  },
  {
    title: 'переименование вида — ревизия 2',
    operationId: 'updateDatasetView',
    expect: 'success',
    example: 'updateDatasetView/ok',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(views(ctx), VIEW)).id;
      ctx.expectExample(
        await m.patch(`${views(ctx)}/${id}`, { name: 'Рейс Р-208' }, { ifMatch: 1 }),
        'updateDatasetView/ok',
      );
    },
  },
  {
    title: 'чужая ревизия — 412',
    operationId: 'updateDatasetView',
    expect: 'error',
    example: 'updateDatasetView/revision_mismatch',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(views(ctx), VIEW)).id;
      ctx.expectExample(
        await m.patch(`${views(ctx)}/${id}`, { name: 'Рейс Р-208' }, { ifMatch: 5 }),
        'updateDatasetView/revision_mismatch',
      );
    },
  },
  {
    title: 'удаление своего вида — 204, вида больше нет',
    operationId: 'deleteDatasetView',
    expect: 'success',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(views(ctx), VIEW)).id;
      expect((await m.delete(`${views(ctx)}/${id}`, { ifMatch: 1 })).status).toBe(204);
      expect(body(await m.get(views(ctx))).items).toEqual([]);
    },
  },
  {
    title: 'личный вид другого участника не раскрывается — 404',
    operationId: 'deleteDatasetView',
    expect: 'error',
    example: 'deleteDatasetView/not_found',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(views(ctx), VIEW)).id;
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.delete(`${views(ctx)}/${id}`, { ifMatch: 1 }),
        'deleteDatasetView/not_found',
      );
    },
  },
  {
    title: '«Выгрузить» заданием: 202, задание в очереди, снимок фиксирует колонки',
    operationId: 'createDatasetExportJob',
    expect: 'success',
    example: 'createDatasetExportJob/queued',
    run: async (ctx) => {
      const m = await manager(ctx);
      ctx.expectExample(await m.post(startJob(ctx), SPEC), 'createDatasetExportJob/queued');
    },
  },
  {
    title: 'четвёртое активное задание — 429 «Дождитесь завершения начатых выгрузок.»',
    operationId: 'createDatasetExportJob',
    expect: 'error',
    example: 'createDatasetExportJob/rate_limited',
    run: async (ctx) => {
      const m = await manager(ctx);
      for (let i = 0; i < 3; i++) await m.post(startJob(ctx), SPEC);
      ctx.expectExample(await m.post(startJob(ctx), SPEC), 'createDatasetExportJob/rate_limited');
    },
  },
  {
    title: 'журнал: своё задание готово — строки, файл, срок 24 ч; владелец видит журнал всех',
    operationId: 'listDatasetExportJobs',
    expect: 'success',
    example: 'listDatasetExportJobs/ok',
    run: async (ctx) => {
      const m = await manager(ctx);
      await m.post(startJob(ctx), SPEC);
      ctx.expectExample(await m.get(jobs(ctx)), 'listDatasetExportJobs/ok');
      const owner = await ctx.as('owner');
      expect(body(await owner.get(jobs(ctx))).items).toHaveLength(1);
      expect(body(await owner.get(`${jobs(ctx)}?state=revoked`)).items).toEqual([]);
    },
  },
  {
    title: 'водителю журнал выгрузок закрыт — 403',
    operationId: 'listDatasetExportJobs',
    expect: 'error',
    example: 'listDatasetExportJobs/forbidden_action',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const driver = await ctx.as('driver');
      ctx.expectExample(await driver.get(jobs(ctx)), 'listDatasetExportJobs/forbidden_action');
    },
  },
  {
    title: 'карточка задания — готово, ETag ревизии',
    operationId: 'getDatasetExportJob',
    expect: 'success',
    example: 'getDatasetExportJob/ready',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(startJob(ctx), SPEC)).id;
      const r = await m.get(`${jobs(ctx)}/${id}`);
      ctx.expectExample(r, 'getDatasetExportJob/ready');
      expect(r.headers.get('ETag')).toBe('"rev-2"');
    },
  },
  {
    title: 'задание другого участника не раскрывается — 404',
    operationId: 'getDatasetExportJob',
    expect: 'error',
    example: 'getDatasetExportJob/not_found',
    run: async (ctx) => {
      const m = await manager(ctx);
      ctx.expectExample(
        await m.get(`${jobs(ctx)}/${ctx.A('job-missing')}`),
        'getDatasetExportJob/not_found',
      );
    },
  },
  {
    title: 'ссылка на файл — 5 минут; файл — CSV с BOM; владельцу ссылку не дают',
    operationId: 'getDatasetExportDownload',
    expect: 'success',
    example: 'getDatasetExportDownload/ok',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(startJob(ctx), SPEC)).id;
      const r = await m.get(`${jobs(ctx)}/${id}/download`);
      ctx.expectExample(r, 'getDatasetExportDownload/ok');
      const file = await fetch(String(body(r).downloadUrl));
      expect(file.status).toBe(200);
      const bytes = new Uint8Array(await file.arrayBuffer());
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM — Excel открывает UTF-8
      expect(new TextDecoder().decode(bytes)).toBe(
        'Рейс;Водитель;Статус\r\nР-208 · Северный маршрут;Илья Васильев;Запланирован\r\n',
      );
      const owner = await ctx.as('owner');
      ctx.expectProblem(await owner.get(`${jobs(ctx)}/${id}/download`), 'not_found');
    },
  },
  {
    // Возврат 1: ссылка хранилища mock — подписанная и короткая, как presigned GET стенда.
    title: 'ссылка на файл подписана: без подписи, с чужой подписью и после expiresAt — 403',
    operationId: 'getDatasetExportDownload',
    expect: 'success',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(startJob(ctx), SPEC)).id;
      const r = await m.get(`${jobs(ctx)}/${id}/download`);
      expect(r.status).toBe(200);
      const url = new URL(String(body(r).downloadUrl));
      expect(url.searchParams.get('signature')).toMatch(/^[0-9a-f-]{36}$/);
      expect((await fetch(`${url.origin}${url.pathname}`)).status).toBe(403);
      const forged = new URL(url);
      forged.searchParams.set('signature', '00000000-0000-4000-8000-000000000000');
      expect((await fetch(forged)).status).toBe(403);
      expect((await fetch(url)).status).toBe(200);
      ctx.server.setNow(new Date(Date.parse(String(body(r).expiresAt)) + 1000).toISOString());
      expect((await fetch(url)).status).toBe(403);
      const again = await (await ctx.as('manager')).get(`${jobs(ctx)}/${id}/download`);
      expect((await fetch(String(body(again).downloadUrl))).status).toBe(200);
    },
  },
  {
    title: 'права сузились после задания — отзыв при скачивании (permissions_changed)',
    operationId: 'getDatasetExportDownload',
    expect: 'error',
    example: 'getDatasetExportDownload/invalid_transition',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(startJob(ctx), SPEC)).id;
      dropKey(ctx, 'fleet.earnings.read');
      ctx.expectExample(
        await m.get(`${jobs(ctx)}/${id}/download`),
        'getDatasetExportDownload/invalid_transition',
      );
      const j = body(await m.get(`${jobs(ctx)}/${id}`));
      expect([j.state, j.revokeReason]).toEqual(['revoked', 'permissions_changed']);
    },
  },
  {
    title: 'автор отзывает готовое задание — файл удалён, строка журнала осталась',
    operationId: 'revokeDatasetExportJob',
    expect: 'success',
    example: 'revokeDatasetExportJob/ok',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(startJob(ctx), SPEC)).id;
      ctx.expectExample(
        await m.post(`${jobs(ctx)}/${id}/revoke`, undefined, { ifMatch: 2 }),
        'revokeDatasetExportJob/ok',
      );
    },
  },
  {
    title: 'повторный отзыв — 409 «Выгрузка уже завершена.»',
    operationId: 'revokeDatasetExportJob',
    expect: 'error',
    example: 'revokeDatasetExportJob/invalid_transition',
    run: async (ctx) => {
      const m = await manager(ctx);
      const id = body(await m.post(startJob(ctx), SPEC)).id;
      await m.post(`${jobs(ctx)}/${id}/revoke`, undefined, { ifMatch: 2 });
      ctx.expectExample(
        await m.post(`${jobs(ctx)}/${id}/revoke`, undefined, { ifMatch: 3 }),
        'revokeDatasetExportJob/invalid_transition',
      );
    },
  },
]);
