// Кейсы контрактного PR этапа 6 (W6.00, 0.12.0-stage6): «Ремонт и стройка» на сиде эталона «Альты» (data.ts, seed.ts) и
// пресете repairs-ready («Ремонт и стройка» подключён, сегодня 20.10.2026): шесть объектов — кв. 42 (смета v1 и v2,
// допработа ДР-1, график, документы, заявки, подрядчик, ссылка кабинета), кв. 117, кв. 210, кофейня без прораба, сданный дом
// и черновик «Дом 120 м², Истра». Дарья Зимина — владелец, Алексей Соколов — прораб своих объектов, Марина Котова —
// менеджер логистики без ключей repairs (403 шлюза). Примеры — tools/gen/examples-w600.mjs.
import { expect } from 'vitest';

import { SIGN_CODE } from '../../../src/msw/repairs/cabinet.ts';
import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type B = Record<string, unknown> & {
  items?: Record<string, unknown>[];
  revision?: number;
  version?: number;
  state?: string;
  status?: string;
  reason?: string;
  code?: string;
  id?: string;
  url?: string;
  proposalId?: string;
  document?: Record<string, unknown>;
  lines?: Record<string, unknown>[];
  sections?: Record<string, unknown>[];
  stages?: Record<string, unknown>[];
};
const body = (r: Reply): B => r.body as B;

const R = (ctx: CaseContext, rest: string) => `${ctx.alta}/repairs/${rest}`;
const P = (ctx: CaseContext, id: string, rest = '') =>
  `${ctx.alta}/repairs/projects/${ctx.A(id)}${rest ? `/${rest}` : ''}`;
const MISSING = '00000000-0000-5000-8000-0000000000aa';
const PHOTO = '00000000-0000-5000-8000-0000000000f1';
const TOKEN = (ctx: CaseContext) => `cab-${ctx.A('cl-42')}`;
const PUB = (ctx: CaseContext, rest = '') =>
  `/api/v1/public/client/${TOKEN(ctx)}${rest ? `/${rest}` : ''}`;
const mny = (rub: number) => ({ amountMinor: rub * 100, currency: 'RUB' });

/** Пресет «Ремонт и стройка подключён» и сессия персонажа. */
async function as(ctx: CaseContext, persona = 'owner'): Promise<Session> {
  ctx.server.applyPreset('repairs-ready');
  return ctx.as(persona);
}

/** Прораб отмечает 10 м² «Подготовки стен» кв. 42 (материал — шпаклёвка) и возвращает отметку. */
async function submitMark(ctx: CaseContext, f: Session, volume = '10') {
  const r = await f.post(R(ctx, 'work-logs'), {
    projectId: ctx.A('obj-42'),
    workDate: '2026-10-20',
    timeZone: 'Europe/Moscow',
    lines: [{ workId: ctx.A('w1'), quantity: volume, unit: 'm2' }],
    evidenceFileIds: [PHOTO],
    crewWorkerIds: [ctx.A('obj-42:k1'), ctx.A('obj-42:k2')],
    materials: [{ priceItemId: ctx.A('m-plaster'), quantity: '4' }],
  });
  return r;
}

/** Допсоглашение по ДР-1: версия 3 кв. 42 (черновик), 13 050 ₽ к договору. */
async function changeDraft(ctx: CaseContext, s: Session) {
  return s.post(P(ctx, 'obj-42', 'estimates'), {
    kind: 'change',
    changeOrderIds: [ctx.A('ДР-1')],
  });
}

/** Запрос подписи документа офисом и подпись заказчиком по коду из SMS. */
async function signDoc(ctx: CaseContext, s: Session, docId: string): Promise<void> {
  await s.post(R(ctx, `documents/${docId}/sign-requests`));
  const r = await ctx.anon().post(PUB(ctx, `documents/${docId}/sign`), { smsCode: SIGN_CODE });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** Черновик «Дом 120 м², Истра»: смета по шаблону «под ключ · дом», отправлена, ссылка выпущена, заказчик согласовал. */
async function draftApproved(ctx: CaseContext, s: Session) {
  const e = await s.post(P(ctx, 'obj-50', 'estimate-drafts'), { templateId: ctx.A('tpl-house') });
  const sent = body(
    await s.post(P(ctx, 'obj-50', 'estimates/1/send'), undefined, {
      ifMatch: body(e).revision as number,
    }),
  );
  const link = body(await s.post(P(ctx, 'obj-50', 'client-link')));
  const token = String(link.url).split('/').pop() ?? '';
  const a = await ctx.anon().post(`/api/v1/public/client/${token}/estimates/1/approve`);
  return { e, sent, link, token, approved: a };
}

export const repairsCases = cases('repairs')([
  // ── Объекты ──
  {
    title: 'владелец видит шесть объектов: «Требует решения» первым, сдача и черновик внизу',
    operationId: 'listRepairProjects',
    expect: 'success',
    example: 'listRepairProjects/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(R(ctx, 'projects'));
      ctx.expectExample(r, 'listRepairProjects/ok');
      expect(body(r).items).toHaveLength(6);
    },
  },
  {
    title:
      'прораб — только свои объекты без черновика и без сумм; фильтры «Активные», «Сданы», поиск',
    operationId: 'listRepairProjects',
    expect: 'success',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      const r = await f.get(R(ctx, 'projects'));
      const items = body(r).items ?? [];
      expect(items.map((x) => x.name)).not.toContain('Дом 120 м², Истра');
      expect(items.every((x) => x.budget === undefined && x.clientPhone === undefined)).toBe(true);
      const o = await as(ctx);
      const names = async (q: string) =>
        (body(await o.get(R(ctx, `projects?${q}`))).items ?? []).map((x) => x.name);
      expect(await names('filter=draft')).toEqual(['Дом 120 м², Истра']);
      expect(await names('filter=done')).toEqual(['Дом на Лесной · Мытищи']);
      expect((await names('filter=active')).length).toBe(4);
      expect(await names('q=Ольга')).toEqual(['ЖК Речной · квартира 42']);
      const todo = await names('filter=todo');
      expect(todo).toContain('ЖК Речной · квартира 42');
    },
  },
  {
    title: 'неизвестный фильтр — 400',
    operationId: 'listRepairProjects',
    expect: 'error',
    example: 'listRepairProjects/malformed_request',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, 'projects?filter=archived')),
        'listRepairProjects/malformed_request',
      );
    },
  },
  {
    title: 'объект-черновик из заявки: без прораба, пустой замер, пустая смета',
    operationId: 'createRepairProject',
    expect: 'success',
    example: 'createRepairProject/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, 'projects'), {
        orgUnitId: ctx.A('f-msk-sever'),
        name: 'Квартира 64 м², Химки',
        address: 'Химки, ул. Ленинградская, 12, кв. 31',
        kind: 'капитальный ремонт',
        clientName: 'Пётр Фомин',
        leadTaskId: ctx.A('L-30'),
        workers: [],
      });
      ctx.expectExample(r, 'createRepairProject/created');
      expect(body(r).status).toBe('draft');
      expect(body(r).foremanMemberId).toBeNull();
    },
  },
  {
    title: 'подразделения нет в организации — 422, одна заявка — один объект',
    operationId: 'createRepairProject',
    expect: 'error',
    example: 'createRepairProject/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      const bad = await s.post(R(ctx, 'projects'), {
        orgUnitId: MISSING,
        name: 'Объект',
        address: 'Адрес',
        workers: [],
      });
      ctx.expectExample(bad, 'createRepairProject/validation_failed');
      const dup = await s.post(R(ctx, 'projects'), {
        orgUnitId: ctx.A('f-msk-sever'),
        name: 'Ещё один',
        address: 'Адрес',
        leadTaskId: ctx.A('L-29'),
        workers: [],
      });
      expect(dup.status).toBe(409);
    },
  },
  {
    title: 'шапка объекта: готовность по принятым объёмам, сдача и прогноз',
    operationId: 'getRepairProject',
    expect: 'success',
    example: 'getRepairProject/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42')), 'getRepairProject/ok');
    },
  },
  {
    title: 'черновик прорабу — как несуществующий',
    operationId: 'getRepairProject',
    expect: 'error',
    example: 'getRepairProject/not_found',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      ctx.expectExample(await f.get(P(ctx, 'obj-50')), 'getRepairProject/not_found');
    },
  },
  {
    title: 'правка срока сдачи по ревизии объекта',
    operationId: 'updateRepairProject',
    expect: 'success',
    example: 'updateRepairProject/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.patch(P(ctx, 'obj-42'), { dueOn: '2026-11-30' }, { ifMatch: 1 });
      ctx.expectExample(r, 'updateRepairProject/ok');
    },
  },
  {
    title: 'сданный объект не правится; устаревшая ревизия — 412',
    operationId: 'updateRepairProject',
    expect: 'error',
    example: 'updateRepairProject/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(P(ctx, 'obj-27'), { clientName: 'Андрей Кузнецов' }, { ifMatch: 1 }),
        'updateRepairProject/invalid_transition',
      );
      expect(
        (await s.patch(P(ctx, 'obj-42'), { dueOn: '2026-11-30' }, { ifMatch: 7 })).status,
      ).toBe(412);
    },
  },
  {
    title: 'обзор 1a: очередь «Требует решения», объёмы, фото, люди, «Деньги», лента',
    operationId: 'getRepairProjectOverview',
    expect: 'success',
    example: 'getRepairProjectOverview/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'overview'));
      ctx.expectExample(r, 'getRepairProjectOverview/ok');
      const f = await ctx.as('foreman');
      const mine = body(await f.get(P(ctx, 'obj-42', 'overview')));
      expect(mine.money).toBeUndefined();
      expect((mine.decisions as { kind: string }[]).map((d) => d.kind)).toContain(
        'work_log_missing',
      );
    },
  },
  {
    title: 'объекта нет в организации — 404',
    operationId: 'getRepairProjectOverview',
    expect: 'error',
    example: 'getRepairProjectOverview/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/overview`)),
        'getRepairProjectOverview/not_found',
      );
    },
  },
  {
    title: 'назначить прораба кофейне на Покровке: объект появляется в списке прораба',
    operationId: 'assignRepairForeman',
    expect: 'success',
    example: 'assignRepairForeman/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-45', 'foreman'), { foremanMemberId: ctx.A('m-sokolov') });
      ctx.expectExample(r, 'assignRepairForeman/ok');
      const f = await ctx.as('foreman');
      const names = (body(await f.get(R(ctx, 'projects'))).items ?? []).map((x) => x.name);
      expect(names).toContain('Кофейня на Покровке');
    },
  },
  {
    title: 'прораб уже назначен — 409 «Прораб уже назначен: …»',
    operationId: 'assignRepairForeman',
    expect: 'error',
    example: 'assignRepairForeman/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-42', 'foreman'), { foremanMemberId: ctx.A('m-kotova') });
      ctx.expectExample(r, 'assignRepairForeman/invalid_transition');
      expect(body(r).reason).toBe('foreman_already_assigned');
    },
  },
  {
    title: 'черновик → в работу после согласованной сметы (заказчик согласовал в кабинете)',
    operationId: 'activateRepairProject',
    expect: 'success',
    example: 'activateRepairProject/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = await draftApproved(ctx, s);
      expect(d.approved.status, JSON.stringify(d.approved.body)).toBe(200);
      const p = body(await s.get(P(ctx, 'obj-50')));
      const r = await s.post(P(ctx, 'obj-50', 'activate'), undefined, {
        ifMatch: p.revision as number,
      });
      ctx.expectExample(r, 'activateRepairProject/ok');
      expect(body(r).status).toBe('active');
    },
  },
  {
    title: 'не черновик и без согласованной версии — 409',
    operationId: 'activateRepairProject',
    expect: 'error',
    example: 'activateRepairProject/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-42', 'activate'), undefined, { ifMatch: 1 }),
        'activateRepairProject/invalid_transition',
      );
      const r = await s.post(P(ctx, 'obj-50', 'activate'), undefined, { ifMatch: 1 });
      expect(body(r).reason).toBe('repair_estimate_not_approved');
    },
  },
  {
    title: 'объёмы работ кв. 42: план, принятый факт, на приёмке',
    operationId: 'listRepairWorks',
    expect: 'success',
    example: 'listRepairWorks/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'works')), 'listRepairWorks/ok');
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'listRepairWorks',
    expect: 'error',
    example: 'listRepairWorks/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/works`)),
        'listRepairWorks/not_found',
      );
    },
  },

  // ── Отметки и приёмка ──
  {
    title: 'владелец видит отметки: WL-09 на проверке, остальные приняты; фильтры',
    operationId: 'listWorkLogs',
    expect: 'success',
    example: 'listWorkLogs/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(R(ctx, 'work-logs')), 'listWorkLogs/ok');
      const pending = body(await s.get(R(ctx, 'work-logs?status=submitted'))).items ?? [];
      expect(pending.map((x) => x.number)).toEqual(['WL-09']);
      const one = body(await s.get(R(ctx, `work-logs?projectId=${ctx.A('obj-42')}`))).items ?? [];
      expect(one).toHaveLength(1);
    },
  },
  {
    title: 'неизвестный статус — 400',
    operationId: 'listWorkLogs',
    expect: 'error',
    example: 'listWorkLogs/malformed_request',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, 'work-logs?status=draft')),
        'listWorkLogs/malformed_request',
      );
    },
  },
  {
    title: 'прораб отправляет отметку на приёмку: WL-12, «На проверке», факт не растёт',
    operationId: 'submitWorkLog',
    expect: 'success',
    example: 'submitWorkLog/created',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      const r = await submitMark(ctx, f);
      ctx.expectExample(r, 'submitWorkLog/created');
      const works = body(await f.get(P(ctx, 'obj-42', 'works'))).items ?? [];
      expect(works[0]).toMatchObject({ fact: '58', pending: '10' });
    },
  },
  {
    title: 'объём выше плана на 10 % — 422, не прораб объекта — 403, нет работников и фото — 422',
    operationId: 'submitWorkLog',
    expect: 'error',
    example: 'submitWorkLog/validation_failed',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      const over = await submitMark(ctx, f, '60');
      ctx.expectExample(over, 'submitWorkLog/validation_failed');
      expect(body(over).reason).toBe('work_volume_exceeds_plan');
      const crew = await f.post(R(ctx, 'work-logs'), {
        projectId: ctx.A('obj-42'),
        workDate: '2026-10-20',
        timeZone: 'Europe/Moscow',
        lines: [{ workId: ctx.A('w1'), quantity: '5', unit: 'm2' }],
        evidenceFileIds: [PHOTO],
        crewWorkerIds: [],
      });
      expect(crew.status).toBe(422);
      const noPhoto = await f.post(R(ctx, 'work-logs'), {
        projectId: ctx.A('obj-42'),
        workDate: '2026-10-20',
        timeZone: 'Europe/Moscow',
        lines: [{ workId: ctx.A('w1'), quantity: '5', unit: 'm2' }],
        evidenceFileIds: [],
        crewWorkerIds: [ctx.A('obj-42:k1')],
      });
      expect(noPhoto.status).toBe(422);
      const o = await ctx.as('owner');
      expect((await submitMark(ctx, o)).status).toBe(403);
      const sold = await f.post(R(ctx, 'work-logs'), {
        projectId: ctx.A('obj-27'),
        workDate: '2026-10-20',
        timeZone: 'Europe/Moscow',
        lines: [{ workId: ctx.A('w13'), quantity: '1', unit: 'm2' }],
        evidenceFileIds: [PHOTO],
        crewWorkerIds: [ctx.A('obj-27:k1')],
      });
      expect(body(sold).reason).toBe('project_handed_over');
    },
  },
  {
    title: 'принять объём отметки WL-09: факт растёт на 18 м², материалы списаны',
    operationId: 'acceptWorkLog',
    expect: 'success',
    example: 'acceptWorkLog/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, `work-logs/${ctx.A('WL-09')}/accept`), undefined, {
        ifMatch: 1,
      });
      ctx.expectExample(r, 'acceptWorkLog/ok');
      const w = (body(await s.get(P(ctx, 'obj-38', 'works'))).items ?? []).find(
        (x) => x.name === 'Укладка ламината',
      );
      expect(w).toMatchObject({ fact: '58', pending: '0' });
    },
  },
  {
    title: 'повторная приёмка — 409 «Отметка уже обработана», прораб не принимает',
    operationId: 'acceptWorkLog',
    expect: 'error',
    example: 'acceptWorkLog/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, `work-logs/${ctx.A('WL-11')}/accept`), undefined, {
        ifMatch: 1,
      });
      ctx.expectExample(r, 'acceptWorkLog/invalid_transition');
      expect(body(r).reason).toBe('work_log_already_reviewed');
      const f = await ctx.as('foreman');
      expect(
        (await f.post(R(ctx, `work-logs/${ctx.A('WL-09')}/accept`), undefined, { ifMatch: 1 }))
          .status,
      ).toBe(403);
    },
  },
  {
    title: 'вернуть отметку прорабу с причиной (RS-09): статус rejected, причину видит прораб',
    operationId: 'returnWorkLog',
    expect: 'success',
    example: 'returnWorkLog/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(
        R(ctx, `work-logs/${ctx.A('WL-09')}/return`),
        { reason: 'Не видно объём на фото' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'returnWorkLog/ok');
      const f = await ctx.as('foreman');
      const mine = (body(await f.get(R(ctx, 'work-logs?status=rejected'))).items ?? [])[0];
      expect(mine?.returnReason).toBe('Не видно объём на фото');
    },
  },
  {
    title: 'возврат уже принятой отметки — 409',
    operationId: 'returnWorkLog',
    expect: 'error',
    example: 'returnWorkLog/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(
          R(ctx, `work-logs/${ctx.A('WL-11')}/return`),
          { reason: 'Ошибка в объёме' },
          { ifMatch: 1 },
        ),
        'returnWorkLog/invalid_transition',
      );
    },
  },

  // ── Допработы ──
  {
    title: 'допработы кв. 42: ДР-1 ждёт оценки',
    operationId: 'listChangeOrders',
    expect: 'success',
    example: 'listChangeOrders/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'change-orders')), 'listChangeOrders/ok');
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'listChangeOrders',
    expect: 'error',
    example: 'listChangeOrders/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/change-orders`)),
        'listChangeOrders/not_found',
      );
    },
  },
  {
    title: 'прораб предлагает допработу без цен: ДР-2, «Ждёт оценки офиса»',
    operationId: 'proposeChangeOrder',
    expect: 'success',
    example: 'proposeChangeOrder/created',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      const r = await f.post(P(ctx, 'obj-42', 'change-orders'), {
        title: 'Выровнять откос окна в спальне',
        quantity: '3',
        unit: 'm2',
        photoFileIds: [PHOTO],
        note: 'Откос косой, нужна шпаклёвка',
      });
      ctx.expectExample(r, 'proposeChangeOrder/created');
      expect(JSON.stringify(r.body)).not.toMatch(/price|sum|amount/);
    },
  },
  {
    title: 'сданный объект — «Объект сдан: допработы по нему не принимаются» (409)',
    operationId: 'proposeChangeOrder',
    expect: 'error',
    example: 'proposeChangeOrder/invalid_transition',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      const r = await f.post(P(ctx, 'obj-27', 'change-orders'), {
        title: 'Подкрасить плинтус',
        quantity: '2',
        unit: 'm',
        photoFileIds: [PHOTO],
      });
      ctx.expectExample(r, 'proposeChangeOrder/invalid_transition');
      expect(body(r).reason).toBe('project_handed_over');
    },
  },
  {
    title: 'офис отклоняет допработу с причиной; прораб видит причину',
    operationId: 'rejectChangeOrder',
    expect: 'success',
    example: 'rejectChangeOrder/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(
        R(ctx, `change-orders/${ctx.A('ДР-1')}/reject`),
        { reason: 'client_refused' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'rejectChangeOrder/ok');
      const f = await ctx.as('foreman');
      const mine = (body(await f.get(P(ctx, 'obj-42', 'change-orders'))).items ?? [])[0];
      expect(mine).toMatchObject({ status: 'rejected', rejectReason: 'client_refused' });
    },
  },
  {
    title: 'повторный отказ — 409 change_order_closed',
    operationId: 'rejectChangeOrder',
    expect: 'error',
    example: 'rejectChangeOrder/change_order_closed',
    run: async (ctx) => {
      const s = await as(ctx);
      await s.post(
        R(ctx, `change-orders/${ctx.A('ДР-1')}/reject`),
        { reason: 'warranty' },
        { ifMatch: 1 },
      );
      ctx.expectExample(
        await s.post(
          R(ctx, `change-orders/${ctx.A('ДР-1')}/reject`),
          { reason: 'warranty' },
          { ifMatch: 2 },
        ),
        'rejectChangeOrder/change_order_closed',
      );
    },
  },

  // ── Замер ──
  {
    title: 'замер кв. 42: 4 помещения, итоги пола и стен',
    operationId: 'getMeasurement',
    expect: 'success',
    example: 'getMeasurement/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'measurement'));
      ctx.expectExample(r, 'getMeasurement/ok');
      expect(body(r).totals).toMatchObject({
        floorM2: '46.82',
        wallsM2: '134.24',
        perimeterM: '53.2',
      });
    },
  },
  {
    title: 'черновик прорабу — 404',
    operationId: 'getMeasurement',
    expect: 'error',
    example: 'getMeasurement/not_found',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      ctx.expectExample(await f.get(P(ctx, 'obj-50', 'measurement')), 'getMeasurement/not_found');
    },
  },
  {
    title: 'новая версия замера пересчитывает черновик сметы, согласованная версия не меняется',
    operationId: 'putMeasurement',
    expect: 'success',
    example: 'putMeasurement/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      expect(d.state).toBe('draft');
      const before = JSON.stringify(body(await s.get(P(ctx, 'obj-42', 'estimates/2'))).lines);
      const r = await s.put(
        P(ctx, 'obj-42', 'measurement'),
        {
          rooms: [
            { name: 'Гостиная', lengthM: '5.4', widthM: '3.8', heightM: '2.7', openingsM2: '3.6' },
            { name: 'Спальня', lengthM: '4.1', widthM: '3.2', heightM: '2.7', openingsM2: '2.4' },
            { name: 'Кухня', lengthM: '3.4', widthM: '3', heightM: '2.7', openingsM2: '2' },
            { name: 'Санузел', lengthM: '2.2', widthM: '1.7', heightM: '2.7', openingsM2: '1.4' },
          ],
        },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'putMeasurement/ok');
      expect(body(r).version).toBe(2);
      expect(JSON.stringify(body(await s.get(P(ctx, 'obj-42', 'estimates/2'))).lines)).toBe(before);
    },
  },
  {
    title: 'устаревшая ревизия замера — 412',
    operationId: 'putMeasurement',
    expect: 'error',
    example: 'putMeasurement/revision_mismatch',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.put(P(ctx, 'obj-42', 'measurement'), { rooms: [] }, { ifMatch: 5 }),
        'putMeasurement/revision_mismatch',
      );
    },
  },

  // ── Сметы ──
  {
    title: 'версии кв. 42: v1 «заменена», v2 «действует» на 438 175 ₽',
    operationId: 'listEstimates',
    expect: 'success',
    example: 'listEstimates/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'estimates'));
      ctx.expectExample(r, 'listEstimates/ok');
      const totals = (body(r).items ?? []).map(
        (e) => (e.total as { amountMinor: number }).amountMinor / 100,
      );
      expect(totals).toEqual([404418, 438175]);
    },
  },
  {
    title: 'прораб без финансов — 403: сметы закрыты',
    operationId: 'listEstimates',
    expect: 'error',
    example: 'listEstimates/forbidden_action',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      ctx.expectExample(
        await f.get(P(ctx, 'obj-42', 'estimates')),
        'listEstimates/forbidden_action',
      );
    },
  },
  {
    title: 'версия 2 с разделами и строками по формулам замера',
    operationId: 'getEstimate',
    expect: 'success',
    example: 'getEstimate/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'estimates/2'));
      ctx.expectExample(r, 'getEstimate/ok');
      expect(body(r).lines).toHaveLength(14);
    },
  },
  {
    title: 'версии 9 нет — 404',
    operationId: 'getEstimate',
    expect: 'error',
    example: 'getEstimate/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'estimates/9')), 'getEstimate/not_found');
    },
  },
  {
    title: 'черновик дома в Истре по шаблону «Ремонт под ключ · дом»: 1 078 533 ₽ по замеру',
    operationId: 'createEstimateFromTemplate',
    expect: 'success',
    example: 'createEstimateFromTemplate/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-50', 'estimate-drafts'), {
        templateId: ctx.A('tpl-house'),
      });
      ctx.expectExample(r, 'createEstimateFromTemplate/created');
      expect((body(r).total as { amountMinor: number }).amountMinor).toBe(107853300);
    },
  },
  {
    title: 'черновик уже есть — 409 estimate_draft_exists',
    operationId: 'createEstimateFromTemplate',
    expect: 'error',
    example: 'createEstimateFromTemplate/estimate_draft_exists',
    run: async (ctx) => {
      const s = await as(ctx);
      await s.post(P(ctx, 'obj-50', 'estimate-drafts'), { templateId: ctx.A('tpl-house') });
      ctx.expectExample(
        await s.post(P(ctx, 'obj-50', 'estimate-drafts'), { templateId: ctx.A('tpl-cap') }),
        'createEstimateFromTemplate/estimate_draft_exists',
      );
    },
  },
  {
    title:
      'допсоглашение по ДР-1: версия 3, раздел «Допработы · ДР-1», +13 050 ₽, допработа «Оценивается в смете»',
    operationId: 'createEstimateRevision',
    expect: 'success',
    example: 'createEstimateRevision/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await changeDraft(ctx, s);
      ctx.expectExample(r, 'createEstimateRevision/created');
      expect((body(r).total as { amountMinor: number }).amountMinor).toBe(43817500 + 1305000);
      const co = (body(await s.get(P(ctx, 'obj-42', 'change-orders'))).items ?? [])[0];
      expect(co?.status).toBe('priced');
    },
  },
  {
    title: 'второй черновик — 409; правка до договора — только revision (422)',
    operationId: 'createEstimateRevision',
    expect: 'error',
    example: 'createEstimateRevision/estimate_draft_exists',
    run: async (ctx) => {
      const s = await as(ctx);
      const bad = await s.post(P(ctx, 'obj-42', 'estimates'), { kind: 'revision' });
      expect(bad.status).toBe(422);
      await changeDraft(ctx, s);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-42', 'estimates'), { kind: 'change' }),
        'createEstimateRevision/estimate_draft_exists',
      );
    },
  },
  {
    title: 'правка черновика пакетом: строка из справочника, объём вручную, скидка 5 %',
    operationId: 'updateEstimateDraft',
    expect: 'success',
    example: 'updateEstimateDraft/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      const sec = (d.sections ?? [])[0]?.id as string;
      const line = (d.lines ?? [])[0]?.id as string;
      const r = await s.patch(
        P(ctx, 'obj-42', 'estimates/3'),
        {
          addLines: [{ sectionId: sec, priceItemId: ctx.A('p-plumb'), quantity: '2' }],
          lines: [{ id: line, quantity: '50' }],
          discountPct: 5,
        },
        { ifMatch: d.revision as number },
      );
      ctx.expectExample(r, 'updateEstimateDraft/ok');
      expect(body(r).discountPct).toBe(5);
    },
  },
  {
    title: 'согласованная версия не правится — 409 estimate_version_locked',
    operationId: 'updateEstimateDraft',
    expect: 'error',
    example: 'updateEstimateDraft/estimate_version_locked',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(P(ctx, 'obj-42', 'estimates/2'), { discountPct: 3 }, { ifMatch: 1 }),
        'updateEstimateDraft/estimate_version_locked',
      );
    },
  },
  {
    title:
      'отправка допсоглашения заказчику: версия «у заказчика», документ ждёт подписи, допработа «Допсоглашение у заказчика»',
    operationId: 'sendEstimate',
    expect: 'success',
    example: 'sendEstimate/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      const r = await s.post(P(ctx, 'obj-42', 'estimates/3/send'), undefined, {
        ifMatch: d.revision as number,
      });
      ctx.expectExample(r, 'sendEstimate/ok');
      const docs = (body(await s.get(P(ctx, 'obj-42', 'documents'))).items ?? []).map(
        (x) => x.title,
      );
      expect(docs).toContain('Допсоглашение № 1 · ДР-1');
    },
  },
  {
    title: 'повторная отправка — 409',
    operationId: 'sendEstimate',
    expect: 'error',
    example: 'sendEstimate/estimate_version_locked',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      const sent = body(
        await s.post(P(ctx, 'obj-42', 'estimates/3/send'), undefined, {
          ifMatch: d.revision as number,
        }),
      );
      ctx.expectExample(
        await s.post(P(ctx, 'obj-42', 'estimates/3/send'), undefined, {
          ifMatch: sent.revision as number,
        }),
        'sendEstimate/estimate_version_locked',
      );
    },
  },
  {
    title:
      'отзыв отправки: версия снова черновик, документ допсоглашения убран, допработа вернулась в «оценивается»',
    operationId: 'recallEstimate',
    expect: 'success',
    example: 'recallEstimate/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      const sent = body(
        await s.post(P(ctx, 'obj-42', 'estimates/3/send'), undefined, {
          ifMatch: d.revision as number,
        }),
      );
      const r = await s.post(P(ctx, 'obj-42', 'estimates/3/recall'), undefined, {
        ifMatch: sent.revision as number,
      });
      ctx.expectExample(r, 'recallEstimate/ok');
      expect(body(r).state).toBe('draft');
    },
  },
  {
    title: 'согласованную версию отозвать нельзя — 409',
    operationId: 'recallEstimate',
    expect: 'error',
    example: 'recallEstimate/estimate_version_locked',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-42', 'estimates/2/recall'), undefined, { ifMatch: 1 }),
        'recallEstimate/estimate_version_locked',
      );
    },
  },
  {
    title: 'удаление черновика возвращает допработу в «Ждёт оценки офиса»',
    operationId: 'deleteEstimateDraft',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      const r = await s.delete(P(ctx, 'obj-42', 'estimates/3'), { ifMatch: d.revision as number });
      expect(r.status).toBe(204);
      const co = (body(await s.get(P(ctx, 'obj-42', 'change-orders'))).items ?? [])[0];
      expect(co?.status).toBe('proposed');
    },
  },
  {
    title: 'согласованную версию удалить нельзя — 409',
    operationId: 'deleteEstimateDraft',
    expect: 'error',
    example: 'deleteEstimateDraft/estimate_version_locked',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.delete(P(ctx, 'obj-42', 'estimates/2'), { ifMatch: 1 }),
        'deleteEstimateDraft/estimate_version_locked',
      );
    },
  },
  {
    title:
      'сравнение v1 и v2: добавлено «Сборка щитка», изменено 6 точек электрики, замена ламината',
    operationId: 'diffEstimates',
    expect: 'success',
    example: 'diffEstimates/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'estimates/1/diff?to=2'));
      ctx.expectExample(r, 'diffEstimates/ok');
      const rows = (body(r).rows ?? []) as { change: string }[];
      expect(rows.filter((x) => x.change === 'added').length).toBeGreaterThanOrEqual(1);
      expect((body(r).delta as { amountMinor: number }).amountMinor).toBe(43817500 - 40441800);
    },
  },
  {
    title: 'сравнение с несуществующей версией — 404',
    operationId: 'diffEstimates',
    expect: 'error',
    example: 'diffEstimates/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(P(ctx, 'obj-42', 'estimates/1/diff?to=9')),
        'diffEstimates/not_found',
      );
    },
  },
  {
    title:
      'сохранить объект как шаблон: строки действующей версии с формулами и части исходного шаблона',
    operationId: 'saveProjectAsTemplate',
    expect: 'success',
    example: 'saveProjectAsTemplate/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-42', 'save-as-template'), {
        name: 'Квартира как на Речной',
      });
      ctx.expectExample(r, 'saveProjectAsTemplate/created');
      expect(body(r).source).toBe('own');
    },
  },
  {
    title: 'без согласованной версии — 409 repair_estimate_not_approved',
    operationId: 'saveProjectAsTemplate',
    expect: 'error',
    example: 'saveProjectAsTemplate/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-50', 'save-as-template'), {});
      ctx.expectExample(r, 'saveProjectAsTemplate/invalid_transition');
      expect(body(r).reason).toBe('repair_estimate_not_approved');
    },
  },

  // ── Справочник и шаблоны ──
  {
    title: 'справочник: 23 позиции по разделам; поиск и «Материалы»',
    operationId: 'listPriceItems',
    expect: 'success',
    example: 'listPriceItems/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(R(ctx, 'price-items'));
      ctx.expectExample(r, 'listPriceItems/ok');
      expect(body(r).items).toHaveLength(23);
      expect(body(await s.get(R(ctx, 'price-items?kind=material'))).items).toHaveLength(8);
      expect(body(await s.get(R(ctx, 'price-items?q=ламинат'))).items).toHaveLength(3);
    },
  },
  {
    title: 'неизвестный вид позиции — 400',
    operationId: 'listPriceItems',
    expect: 'error',
    example: 'listPriceItems/malformed_request',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, 'price-items?kind=service')),
        'listPriceItems/malformed_request',
      );
    },
  },
  {
    title: 'новая позиция «Монтаж дверного блока»',
    operationId: 'createPriceItem',
    expect: 'success',
    example: 'createPriceItem/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, 'price-items'), {
        section: 'Полы',
        name: 'Монтаж дверного блока',
        unit: 'piece',
        kind: 'work',
        price: mny(4200),
      });
      ctx.expectExample(r, 'createPriceItem/created');
    },
  },
  {
    title: 'такая позиция уже есть, цена больше нуля',
    operationId: 'createPriceItem',
    expect: 'error',
    example: 'createPriceItem/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      const dup = await s.post(R(ctx, 'price-items'), {
        section: 'Стены',
        name: 'штукатурка по маякам',
        unit: 'm2',
        kind: 'work',
        price: mny(700),
      });
      ctx.expectExample(dup, 'createPriceItem/validation_failed');
      expect(body(dup).reason).toBe('price_item_duplicate');
      const zero = await s.post(R(ctx, 'price-items'), {
        section: 'Стены',
        name: 'Новая работа',
        unit: 'm2',
        kind: 'work',
        price: { amountMinor: 0, currency: 'RUB' },
      });
      expect(zero.status).toBe(422);
    },
  },
  {
    title: 'новая цена попадает только в новые черновики: согласованная версия не меняется',
    operationId: 'updatePriceItem',
    expect: 'success',
    example: 'updatePriceItem/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.patch(
        R(ctx, `price-items/${ctx.A('p-plaster')}`),
        { price: mny(700) },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updatePriceItem/ok');
      const total = (
        body(await s.get(P(ctx, 'obj-42', 'estimates/2'))).total as { amountMinor: number }
      ).amountMinor;
      expect(total).toBe(43817500);
    },
  },
  {
    title: 'переименование в занятое название — 422',
    operationId: 'updatePriceItem',
    expect: 'error',
    example: 'updatePriceItem/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(
          R(ctx, `price-items/${ctx.A('p-plaster')}`),
          { name: 'Шпаклёвка и покраска' },
          { ifMatch: 1 },
        ),
        'updatePriceItem/validation_failed',
      );
    },
  },
  {
    title: 'четыре шаблона: три копии Ортуса и «Ремонт под ключ · дом»',
    operationId: 'listTemplates',
    expect: 'success',
    example: 'listTemplates/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(R(ctx, 'templates'));
      ctx.expectExample(r, 'listTemplates/ok');
      expect(body(r).items).toHaveLength(4);
    },
  },
  {
    title: 'прораб без каталога и без сметы — 403',
    operationId: 'listTemplates',
    expect: 'error',
    example: 'listTemplates/forbidden_action',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      ctx.expectExample(await f.get(R(ctx, 'templates')), 'listTemplates/forbidden_action');
    },
  },
  {
    title:
      'шаблон «Капитальный ремонт квартиры»: строки, технология, документы, чек-лист, материалы',
    operationId: 'getTemplate',
    expect: 'success',
    example: 'getTemplate/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(R(ctx, `templates/${ctx.A('tpl-cap')}`)), 'getTemplate/ok');
    },
  },
  {
    title: 'шаблона нет — 404',
    operationId: 'getTemplate',
    expect: 'error',
    example: 'getTemplate/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(R(ctx, `templates/${MISSING}`)), 'getTemplate/not_found');
    },
  },
  {
    title: 'правка шаблона: название и гарантия; уже созданные сметы не меняются',
    operationId: 'updateTemplate',
    expect: 'success',
    example: 'updateTemplate/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.patch(
        R(ctx, `templates/${ctx.A('tpl-house')}`),
        { name: 'Ремонт дома под ключ', warrantyMonths: 36 },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'updateTemplate/ok');
    },
  },
  {
    title: 'строка шаблона без количества и формулы или с неизвестной позицией — 422',
    operationId: 'updateTemplate',
    expect: 'error',
    example: 'updateTemplate/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(
          R(ctx, `templates/${ctx.A('tpl-house')}`),
          { lines: [{ priceItemId: MISSING, section: 'Полы', quantity: '1' }] },
          { ifMatch: 1 },
        ),
        'updateTemplate/validation_failed',
      );
    },
  },
  {
    title: 'копия шаблона — «Свой · копия»',
    operationId: 'copyTemplate',
    expect: 'success',
    example: 'copyTemplate/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, `templates/${ctx.A('tpl-cap')}/copy`), {});
      ctx.expectExample(r, 'copyTemplate/created');
      expect(body(r).source).toBe('own');
    },
  },
  {
    title: 'копия несуществующего — 404',
    operationId: 'copyTemplate',
    expect: 'error',
    example: 'copyTemplate/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(R(ctx, `templates/${MISSING}/copy`), {}),
        'copyTemplate/not_found',
      );
    },
  },

  // ── График ──
  {
    title: 'график кв. 42: этапы, связи, базовый план 27.11, прогноз, запас, журнал',
    operationId: 'getSchedule',
    expect: 'success',
    example: 'getSchedule/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'schedule'));
      ctx.expectExample(r, 'getSchedule/ok');
      expect(body(r).stages).toHaveLength(10);
      expect(JSON.stringify(r.body)).not.toMatch(/amountMinor/);
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'getSchedule',
    expect: 'error',
    example: 'getSchedule/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/schedule`)),
        'getSchedule/not_found',
      );
    },
  },
  {
    title: 'график из сметы и технологии шаблона: этапы, связи, веха сдачи',
    operationId: 'createScheduleFromEstimate',
    expect: 'success',
    example: 'createScheduleFromEstimate/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-38', 'schedule/from-estimate'), { estimateVersion: 1 });
      ctx.expectExample(r, 'createScheduleFromEstimate/created');
      expect((body(r).stages ?? []).length).toBeGreaterThan(5);
    },
  },
  {
    title: 'график уже собран — 409; версия не согласована — repair_estimate_not_approved',
    operationId: 'createScheduleFromEstimate',
    expect: 'error',
    example: 'createScheduleFromEstimate/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-42', 'schedule/from-estimate'), { estimateVersion: 2 }),
        'createScheduleFromEstimate/invalid_transition',
      );
      const old = await s.post(P(ctx, 'obj-42', 'schedule/from-estimate'), { estimateVersion: 1 });
      expect(body(old).reason).toBe('repair_estimate_not_approved');
    },
  },
  {
    title:
      'предпросмотр: стяжка на 2 раб. дня позже — сдвиг следом идущих этапов, прогноз, кого уведомят; ничего не записано',
    operationId: 'previewScheduleChange',
    expect: 'success',
    example: 'previewScheduleChange/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const before = JSON.stringify((await s.get(P(ctx, 'obj-42', 'schedule'))).body);
      const r = await s.post(P(ctx, 'obj-42', 'schedule/preview'), {
        changes: [{ stageId: ctx.A('obj-42:s4'), offsetWd: 2 }],
      });
      ctx.expectExample(r, 'previewScheduleChange/ok');
      expect((body(r).moved as unknown[]).length).toBeGreaterThan(0);
      expect(JSON.stringify((await s.get(P(ctx, 'obj-42', 'schedule'))).body)).toBe(before);
    },
  },
  {
    title: 'закрытый этап не сдвигается — 409 schedule_stage_locked',
    operationId: 'previewScheduleChange',
    expect: 'error',
    example: 'previewScheduleChange/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-42', 'schedule/preview'), {
        changes: [{ stageId: ctx.A('obj-42:s1'), offsetWd: 1 }],
      });
      ctx.expectExample(r, 'previewScheduleChange/invalid_transition');
      expect(body(r).reason).toBe('schedule_stage_locked');
    },
  },
  {
    title: 'перенос с причиной: журнал, ревизия графика, прогноз сдачи',
    operationId: 'applyScheduleChange',
    expect: 'success',
    example: 'applyScheduleChange/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(
        P(ctx, 'obj-42', 'schedule/changes'),
        { changes: [{ stageId: ctx.A('obj-42:s4'), offsetWd: 2 }], reason: 'material_delay' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'applyScheduleChange/ok');
      expect(body(r).revision).toBe(2);
    },
  },
  {
    title: 'выполненный этап — 409; без причины тело не проходит (422)',
    operationId: 'applyScheduleChange',
    expect: 'error',
    example: 'applyScheduleChange/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const locked = await s.post(
        P(ctx, 'obj-42', 'schedule/changes'),
        { changes: [{ stageId: ctx.A('obj-42:s1'), durationWd: 7 }], reason: 'rework' },
        { ifMatch: 1 },
      );
      ctx.expectExample(locked, 'applyScheduleChange/invalid_transition');
      const noReason = await s.post(
        P(ctx, 'obj-42', 'schedule/changes'),
        { changes: [{ stageId: ctx.A('obj-42:s4'), offsetWd: 1 }] },
        { ifMatch: 1 },
      );
      expect(noReason.status).toBe(422);
    },
  },
  {
    title: 'исполнитель этапа «Плитка в санузле» без причины, запись в журнал',
    operationId: 'setScheduleStageExecutor',
    expect: 'success',
    example: 'setScheduleStageExecutor/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.patch(
        P(ctx, 'obj-42', `schedule/stages/${ctx.A('obj-42:s6')}`),
        { executorName: 'Рустам Каримов' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'setScheduleStageExecutor/ok');
      const sch = body(await s.get(P(ctx, 'obj-42', 'schedule')));
      expect((sch.issues as { kind: string }[]).some((x) => x.kind === 'no_executor')).toBe(false);
    },
  },
  {
    title: 'этапа нет — 404',
    operationId: 'setScheduleStageExecutor',
    expect: 'error',
    example: 'setScheduleStageExecutor/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.patch(
          P(ctx, 'obj-42', `schedule/stages/${MISSING}`),
          { executorName: 'Кто-то' },
          { ifMatch: 1 },
        ),
        'setScheduleStageExecutor/not_found',
      );
    },
  },
  {
    title: 'новый базовый план после подписанного допсоглашения № 1',
    operationId: 'createScheduleBaseline',
    expect: 'success',
    example: 'createScheduleBaseline/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      await s.post(P(ctx, 'obj-42', 'estimates/3/send'), undefined, {
        ifMatch: d.revision as number,
      });
      const docs = body(await s.get(P(ctx, 'obj-42', 'documents'))).items ?? [];
      const agr = docs.find((x) => x.kind === 'agreement')?.id as string;
      await signDoc(ctx, s, agr);
      const r = await s.post(
        P(ctx, 'obj-42', 'schedule/baselines'),
        { agreementNo: 1 },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'createScheduleBaseline/created');
      expect((body(r).baseline as { version: number }).version).toBe(2);
    },
  },
  {
    title: 'допсоглашения с таким номером нет — 422',
    operationId: 'createScheduleBaseline',
    expect: 'error',
    example: 'createScheduleBaseline/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-42', 'schedule/baselines'), { agreementNo: 7 }, { ifMatch: 1 }),
        'createScheduleBaseline/validation_failed',
      );
    },
  },

  // ── Документы и сдача ──
  {
    title: 'документы кв. 42: договор подписан, аванс оплачен, акты',
    operationId: 'listRepairDocuments',
    expect: 'success',
    example: 'listRepairDocuments/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'documents')), 'listRepairDocuments/ok');
      const f = await ctx.as('foreman');
      expect(JSON.stringify((await f.get(P(ctx, 'obj-42', 'documents'))).body)).not.toMatch(
        /amountMinor/,
      );
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'listRepairDocuments',
    expect: 'error',
    example: 'listRepairDocuments/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/documents`)),
        'listRepairDocuments/not_found',
      );
    },
  },
  {
    title: 'запрос подписи акта № 1: код в SMS заказчику, самого кода в ответе нет',
    operationId: 'requestDocumentSignature',
    expect: 'success',
    example: 'requestDocumentSignature/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, `documents/${ctx.A('doc-42-act1')}/sign-requests`));
      ctx.expectExample(r, 'requestDocumentSignature/created');
      expect(JSON.stringify(r.body)).not.toContain(SIGN_CODE);
    },
  },
  {
    title: 'подписанный договор — 409 repair_document_state',
    operationId: 'requestDocumentSignature',
    expect: 'error',
    example: 'requestDocumentSignature/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(R(ctx, `documents/${ctx.A('doc-42-contract')}/sign-requests`)),
        'requestDocumentSignature/invalid_transition',
      );
    },
  },
  {
    title:
      'сдача объекта после подписанного акта сдачи: гарантия 24 месяца, ссылка кабинета закрыта',
    operationId: 'handOverRepairProject',
    expect: 'success',
    example: 'handOverRepairProject/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      await signDoc(ctx, s, ctx.A('doc-42-handover'));
      const r = await s.post(
        P(ctx, 'obj-42', 'hand-over'),
        { actDocumentId: ctx.A('doc-42-handover') },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'handOverRepairProject/ok');
      expect(body(r).warrantyUntil).toBe('2028-10-20');
      expect((await ctx.anon().get(PUB(ctx))).status).toBe(410);
    },
  },
  {
    title: 'акт сдачи не подписан — 409 repair_act_not_signed',
    operationId: 'handOverRepairProject',
    expect: 'error',
    example: 'handOverRepairProject/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(
        P(ctx, 'obj-42', 'hand-over'),
        { actDocumentId: ctx.A('doc-42-handover') },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'handOverRepairProject/invalid_transition');
      expect(body(r).reason).toBe('repair_act_not_signed');
    },
  },

  // ── Снабжение ──
  {
    title: 'заявки всех объектов: ждут решения — первыми; по состоянию и объекту',
    operationId: 'listSupplyRequests',
    expect: 'success',
    example: 'listSupplyRequests/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(R(ctx, 'supply-requests'));
      ctx.expectExample(r, 'listSupplyRequests/ok');
      expect(body(r).items).toHaveLength(9);
      expect(body(await s.get(R(ctx, 'supply-requests?state=request'))).items).toHaveLength(7);
      expect(
        body(await s.get(R(ctx, `supply-requests?projectId=${ctx.A('obj-45')}`))).items,
      ).toHaveLength(2);
      const f = await ctx.as('foreman');
      const mine = body(await f.get(R(ctx, 'supply-requests'))).items ?? [];
      expect(mine.every((x) => x.cost === undefined)).toBe(true);
    },
  },
  {
    title: 'неизвестное состояние — 400',
    operationId: 'listSupplyRequests',
    expect: 'error',
    example: 'listSupplyRequests/malformed_request',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, 'supply-requests?state=lost')),
        'listSupplyRequests/malformed_request',
      );
    },
  },
  {
    title: 'прораб просит грунтовку: З-26, «Ждёт решения снабжения»',
    operationId: 'createSupplyRequest',
    expect: 'success',
    example: 'createSupplyRequest/created',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      const r = await f.post(P(ctx, 'obj-42', 'supply-requests'), {
        priceItemId: ctx.A('m-primer'),
        quantity: '20',
        needBy: '2026-10-28',
      });
      ctx.expectExample(r, 'createSupplyRequest/created');
    },
  },
  {
    title: 'работа вместо материала — 422; не прораб объекта — 403',
    operationId: 'createSupplyRequest',
    expect: 'error',
    example: 'createSupplyRequest/validation_failed',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      ctx.expectExample(
        await f.post(P(ctx, 'obj-42', 'supply-requests'), {
          priceItemId: ctx.A('p-paint'),
          quantity: '5',
          needBy: '2026-10-28',
        }),
        'createSupplyRequest/validation_failed',
      );
      const o = await ctx.as('owner');
      expect(
        (
          await o.post(P(ctx, 'obj-42', 'supply-requests'), {
            priceItemId: ctx.A('m-primer'),
            quantity: '5',
            needBy: '2026-10-28',
          })
        ).status,
      ).toBe(403);
    },
  },
  {
    title: 'решение «со склада»: плинтус кв. 117 резервируется на «Москва · Отрадное»',
    operationId: 'reserveSupplyRequest',
    expect: 'success',
    example: 'reserveSupplyRequest/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(
        R(ctx, `supply-requests/${ctx.A('sup-21')}/reserve`),
        { warehouseId: ctx.A('wh-msk') },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'reserveSupplyRequest/ok');
      expect(body(r).state).toBe('reserved');
    },
  },
  {
    title: 'на складе нет — 409 repair_stock_insufficient («На складах нет»)',
    operationId: 'reserveSupplyRequest',
    expect: 'error',
    example: 'reserveSupplyRequest/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(
        R(ctx, `supply-requests/${ctx.A('sup-24')}/reserve`),
        { warehouseId: ctx.A('wh-mo') },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'reserveSupplyRequest/invalid_transition');
      expect(body(r).reason).toBe('repair_stock_insufficient');
    },
  },
  {
    title:
      'кладовщик выдал зарезервированное: остаток объекта растёт, расход по средней цене склада',
    operationId: 'issueSupplyRequest',
    expect: 'success',
    example: 'issueSupplyRequest/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      await s.post(
        R(ctx, `supply-requests/${ctx.A('sup-21')}/reserve`),
        { warehouseId: ctx.A('wh-msk') },
        { ifMatch: 1 },
      );
      const r = await s.post(R(ctx, `supply-requests/${ctx.A('sup-21')}/issue`), undefined, {
        ifMatch: 2,
      });
      ctx.expectExample(r, 'issueSupplyRequest/ok');
      expect((body(r).cost as { amountMinor: number }).amountMinor).toBe(42 * 26500);
    },
  },
  {
    title: 'выдача без резерва — 409 repair_supply_state',
    operationId: 'issueSupplyRequest',
    expect: 'error',
    example: 'issueSupplyRequest/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(R(ctx, `supply-requests/${ctx.A('sup-22')}/issue`), undefined, { ifMatch: 1 }),
        'issueSupplyRequest/invalid_transition',
      );
    },
  },
  {
    title: 'списать на объект закупленный кабель',
    operationId: 'consumeSupplyRequest',
    expect: 'success',
    example: 'consumeSupplyRequest/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, `supply-requests/${ctx.A('sup-13')}/consume`), undefined, {
        ifMatch: 1,
      });
      ctx.expectExample(r, 'consumeSupplyRequest/ok');
      expect(body(r).state).toBe('used');
    },
  },
  {
    title: 'заявка ещё не выдана и не закуплена — 409',
    operationId: 'consumeSupplyRequest',
    expect: 'error',
    example: 'consumeSupplyRequest/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(R(ctx, `supply-requests/${ctx.A('sup-14')}/consume`), undefined, {
          ifMatch: 1,
        }),
        'consumeSupplyRequest/invalid_transition',
      );
    },
  },
  {
    title: 'одна закупка на два объекта: керамогранит и краска кофейни — цены по умолчанию',
    operationId: 'createPurchase',
    expect: 'success',
    example: 'createPurchase/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, 'purchases'), {
        supplier: 'КерамТорг',
        lines: [
          { supplyRequestId: ctx.A('sup-24') },
          { supplyRequestId: ctx.A('sup-15'), price: mny(1750) },
        ],
      });
      ctx.expectExample(r, 'createPurchase/created');
      expect(body(r).number).toBe('ЗК-7');
      const asked = body(await s.get(R(ctx, 'supply-requests?state=ordered'))).items ?? [];
      expect(asked).toHaveLength(2);
    },
  },
  {
    title: 'заявка уже использована — 409 repair_supply_state',
    operationId: 'createPurchase',
    expect: 'error',
    example: 'createPurchase/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(R(ctx, 'purchases'), {
          supplier: 'ПолМаркет',
          lines: [{ supplyRequestId: ctx.A('sup-12') }],
        }),
        'createPurchase/invalid_transition',
      );
    },
  },
  {
    title: 'закупки: ЗК-6 получена',
    operationId: 'listPurchases',
    expect: 'success',
    example: 'listPurchases/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(R(ctx, 'purchases')), 'listPurchases/ok');
    },
  },
  {
    title: 'неверный курсор — 400',
    operationId: 'listPurchases',
    expect: 'error',
    example: 'listPurchases/malformed_request',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, 'purchases?cursor=%%%')),
        'listPurchases/malformed_request',
      );
    },
  },
  {
    title: 'получение по чеку QR: заявки «Закуплено», остатки объектов растут',
    operationId: 'receivePurchase',
    expect: 'success',
    example: 'receivePurchase/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const p = body(
        await s.post(R(ctx, 'purchases'), {
          supplier: 'КерамТорг',
          lines: [{ supplyRequestId: ctx.A('sup-24') }],
        }),
      );
      const r = await s.post(
        R(ctx, `purchases/${p.id}/receive`),
        { receiptQr: 't=20261020T1100&s=126000.00&fn=9960440300000001&i=2&fp=2&n=1' },
        { ifMatch: p.revision as number },
      );
      ctx.expectExample(r, 'receivePurchase/ok');
      const st = (body(await s.get(R(ctx, 'project-stock'))).items ?? []).find(
        (x) => x.projectId === ctx.A('obj-45'),
      );
      expect(st).toMatchObject({ quantity: '70' });
    },
  },
  {
    title: 'повторное получение — 409 repair_purchase_state',
    operationId: 'receivePurchase',
    expect: 'error',
    example: 'receivePurchase/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(
          R(ctx, `purchases/${ctx.A('ЗК-6')}/receive`),
          { receiptQr: 'dup' },
          { ifMatch: 2 },
        ),
        'receivePurchase/invalid_transition',
      );
    },
  },
  {
    title: 'остатки на объектах: сданный дом и кв. 210',
    operationId: 'listProjectStock',
    expect: 'success',
    example: 'listProjectStock/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(R(ctx, 'project-stock'));
      ctx.expectExample(r, 'listProjectStock/ok');
      expect(body(r).items).toHaveLength(3);
    },
  },
  {
    title: 'менеджер логистики без снабжения — 403 шлюза',
    operationId: 'listProjectStock',
    expect: 'error',
    example: 'listProjectStock/forbidden_action',
    run: async (ctx) => {
      const m = await as(ctx, 'manager');
      ctx.expectExample(await m.get(R(ctx, 'project-stock')), 'listProjectStock/forbidden_action');
    },
  },
  {
    title: 'возврат плитки сданного дома на склад «Мытищи»: расходы объекта уменьшаются',
    operationId: 'returnProjectStock',
    expect: 'success',
    example: 'returnProjectStock/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-27', 'stock/return'), {
        warehouseId: ctx.A('wh-mo'),
        items: [{ priceItemId: ctx.A('m-tile'), quantity: '4' }],
      });
      ctx.expectExample(r, 'returnProjectStock/ok');
      expect((body(r).movementIds as string[]).length).toBe(1);
    },
  },
  {
    title: 'больше, чем на объекте — 409 repair_stock_insufficient',
    operationId: 'returnProjectStock',
    expect: 'error',
    example: 'returnProjectStock/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-27', 'stock/return'), {
          warehouseId: ctx.A('wh-mo'),
          items: [{ priceItemId: ctx.A('m-tile'), quantity: '40' }],
        }),
        'returnProjectStock/invalid_transition',
      );
    },
  },
  {
    title: 'перемещение плитки на кофейню: заявка на тот же материал уменьшается',
    operationId: 'transferProjectStock',
    expect: 'success',
    example: 'transferProjectStock/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-27', 'stock/transfer'), {
        toProjectId: ctx.A('obj-45'),
        items: [{ priceItemId: ctx.A('m-tile'), quantity: '4' }],
      });
      ctx.expectExample(r, 'transferProjectStock/ok');
      const req = (
        body(await s.get(R(ctx, `supply-requests?projectId=${ctx.A('obj-45')}`))).items ?? []
      ).find((x) => x.number === 'З-24');
      expect(req?.quantity).toBe('66');
    },
  },
  {
    title: 'перемещение на тот же объект — 422',
    operationId: 'transferProjectStock',
    expect: 'error',
    example: 'transferProjectStock/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-27', 'stock/transfer'), {
          toProjectId: ctx.A('obj-27'),
          items: [{ priceItemId: ctx.A('m-tile'), quantity: '1' }],
        }),
        'transferProjectStock/validation_failed',
      );
    },
  },

  // ── Финансы, бригада, подрядчики, ссылка кабинета ──
  {
    title: 'финансы кв. 42: договор 438 175 ₽, аванс 30 % — 131 453 ₽, расходы, маржа 27 %',
    operationId: 'getProjectFinance',
    expect: 'success',
    example: 'getProjectFinance/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.get(P(ctx, 'obj-42', 'finance'));
      ctx.expectExample(r, 'getProjectFinance/ok');
      expect(body(r)).toMatchObject({
        contract: { amountMinor: 43817500 },
        received: { amountMinor: 13145300 },
        marginPlan: { amountMinor: 11830725 },
      });
    },
  },
  {
    title: 'прораб — 403: деньги объекта закрыты',
    operationId: 'getProjectFinance',
    expect: 'error',
    example: 'getProjectFinance/forbidden_action',
    run: async (ctx) => {
      const f = await as(ctx, 'foreman');
      ctx.expectExample(
        await f.get(P(ctx, 'obj-42', 'finance')),
        'getProjectFinance/forbidden_action',
      );
    },
  },
  {
    title: 'начисления бригаде: ждут закрытия акта № 1',
    operationId: 'listCrewAccruals',
    expect: 'success',
    example: 'listCrewAccruals/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'accruals')), 'listCrewAccruals/ok');
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'listCrewAccruals',
    expect: 'error',
    example: 'listCrewAccruals/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/accruals`)),
        'listCrewAccruals/not_found',
      );
    },
  },
  {
    title: 'начислить по подписанному акту № 1: «Ждёт закрытия акта» → «Начислено»',
    operationId: 'accrueByAct',
    expect: 'success',
    example: 'accrueByAct/created',
    run: async (ctx) => {
      const s = await as(ctx);
      await signDoc(ctx, s, ctx.A('doc-42-act1'));
      const r = await s.post(R(ctx, `acts/${ctx.A('doc-42-act1')}/accruals`));
      ctx.expectExample(r, 'accrueByAct/created');
      expect((body(r).items ?? []).every((x) => x.state === 'accrued')).toBe(true);
    },
  },
  {
    title: 'акт не подписан — 409 repair_act_not_signed',
    operationId: 'accrueByAct',
    expect: 'error',
    example: 'accrueByAct/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(R(ctx, `acts/${ctx.A('doc-42-act1')}/accruals`));
      ctx.expectExample(r, 'accrueByAct/invalid_transition');
      expect(body(r).reason).toBe('repair_act_not_signed');
    },
  },
  {
    title: 'выплата — предложение операции в кассу, начисления «Отправлено в кассу»',
    operationId: 'payoutAccruals',
    expect: 'success',
    example: 'payoutAccruals/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      await signDoc(ctx, s, ctx.A('doc-42-act1'));
      const acc = body(await s.post(R(ctx, `acts/${ctx.A('doc-42-act1')}/accruals`))).items ?? [];
      const r = await s.post(R(ctx, 'accruals/payout'), {
        accrualIds: acc.map((x) => x.id as string),
      });
      ctx.expectExample(r, 'payoutAccruals/ok');
      expect((body(r).accruals as { state: string }[]).every((x) => x.state === 'proposed')).toBe(
        true,
      );
    },
  },
  {
    title: 'ещё не начисленное к выплате не принимается — 409',
    operationId: 'payoutAccruals',
    expect: 'error',
    example: 'payoutAccruals/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(R(ctx, 'accruals/payout'), { accrualIds: [ctx.A('acc-42-k1')] }),
        'payoutAccruals/invalid_transition',
      );
    },
  },
  {
    title: 'подрядчик кв. 42: доступ до 31.10',
    operationId: 'listSubcontractors',
    expect: 'success',
    example: 'listSubcontractors/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'subcontractors')), 'listSubcontractors/ok');
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'listSubcontractors',
    expect: 'error',
    example: 'listSubcontractors/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/subcontractors`)),
        'listSubcontractors/not_found',
      );
    },
  },
  {
    title: 'закрыть доступ подрядчика, снова открыть до 15.11',
    operationId: 'setSubcontractorAccess',
    expect: 'success',
    example: 'setSubcontractorAccess/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const off = await s.put(P(ctx, 'obj-42', `subcontractors/${ctx.A('sub-42')}`), {
        active: false,
      });
      expect(body(off).active).toBe(false);
      const on = await s.put(P(ctx, 'obj-42', `subcontractors/${ctx.A('sub-42')}`), {
        active: true,
        until: '2026-11-15',
      });
      ctx.expectExample(on, 'setSubcontractorAccess/ok');
    },
  },
  {
    title: 'открыть без срока — 422',
    operationId: 'setSubcontractorAccess',
    expect: 'error',
    example: 'setSubcontractorAccess/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.put(P(ctx, 'obj-42', `subcontractors/${ctx.A('sub-42')}`), { active: true }),
        'setSubcontractorAccess/validation_failed',
      );
    },
  },
  {
    title: 'ссылка кабинета кв. 42: отправлена 01.10, действует',
    operationId: 'getClientLink',
    expect: 'success',
    example: 'getClientLink/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(await s.get(P(ctx, 'obj-42', 'client-link')), 'getClientLink/ok');
    },
  },
  {
    title: 'объекта нет — 404',
    operationId: 'getClientLink',
    expect: 'error',
    example: 'getClientLink/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.get(R(ctx, `projects/${MISSING}/client-link`)),
        'getClientLink/not_found',
      );
    },
  },
  {
    title: 'новая ссылка: токен один раз в URL, прежняя перестаёт работать',
    operationId: 'issueClientLink',
    expect: 'success',
    example: 'issueClientLink/created',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.post(P(ctx, 'obj-42', 'client-link'));
      ctx.expectExample(r, 'issueClientLink/created');
      expect((await ctx.anon().get(PUB(ctx))).status).toBe(410);
      const token = String(body(r).url).split('/').pop() ?? '';
      expect((await ctx.anon().get(`/api/v1/public/client/${token}`)).status).toBe(200);
      expect(JSON.stringify((await s.get(P(ctx, 'obj-42', 'client-link'))).body)).not.toContain(
        token,
      );
    },
  },
  {
    title: 'сданный объект — кабинет закрыт (409)',
    operationId: 'issueClientLink',
    expect: 'error',
    example: 'issueClientLink/invalid_transition',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.post(P(ctx, 'obj-27', 'client-link')),
        'issueClientLink/invalid_transition',
      );
    },
  },
  {
    title: 'отозвать ссылку в один клик: по старой ссылке кабинет не открывается',
    operationId: 'revokeClientLink',
    expect: 'success',
    run: async (ctx) => {
      const s = await as(ctx);
      const r = await s.delete(P(ctx, 'obj-42', 'client-link'));
      expect(r.status).toBe(204);
      expect((await ctx.anon().get(PUB(ctx))).status).toBe(410);
    },
  },
  {
    title: 'действующей ссылки нет — 404',
    operationId: 'revokeClientLink',
    expect: 'error',
    example: 'revokeClientLink/not_found',
    run: async (ctx) => {
      const s = await as(ctx);
      ctx.expectExample(
        await s.delete(P(ctx, 'obj-45', 'client-link')),
        'revokeClientLink/not_found',
      );
    },
  },

  // ── Публичный кабинет заказчика ──
  {
    title:
      'кабинет по личной ссылке: готовность по закрытым актам, этапы, фото принятых отметок, документы, оплачено',
    operationId: 'getClientCabinet',
    expect: 'success',
    example: 'getClientCabinet/ok',
    run: async (ctx) => {
      const r = await ctx.anon().get(PUB(ctx));
      ctx.expectExample(r, 'getClientCabinet/ok');
    },
  },
  {
    title: 'неизвестная ссылка — 404; отозванная — 410 public_token_expired',
    operationId: 'getClientCabinet',
    expect: 'error',
    example: 'getClientCabinet/public_token_expired',
    run: async (ctx) => {
      const unknown = await ctx.anon().get(`/api/v1/public/client/${'x'.repeat(40)}`);
      expect(unknown.status).toBe(404);
      const s = await as(ctx);
      await s.delete(P(ctx, 'obj-42', 'client-link'));
      ctx.expectExample(await ctx.anon().get(PUB(ctx)), 'getClientCabinet/public_token_expired');
    },
  },
  {
    title: 'заказчик согласует отправленную смету дома в Истре: версия «согласована»',
    operationId: 'approveEstimateByClient',
    expect: 'success',
    example: 'approveEstimateByClient/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = await draftApproved(ctx, s);
      ctx.expectExample(d.approved, 'approveEstimateByClient/ok');
      expect(body(d.approved).state).toBe('approved');
    },
  },
  {
    title: 'версия не отправлена или это допсоглашение — 409',
    operationId: 'approveEstimateByClient',
    expect: 'error',
    example: 'approveEstimateByClient/invalid_transition',
    run: async (ctx) => {
      ctx.server.applyPreset('repairs-ready');
      ctx.expectExample(
        await ctx.anon().post(PUB(ctx, 'estimates/2/approve')),
        'approveEstimateByClient/invalid_transition',
      );
    },
  },
  {
    title:
      'заказчик подписывает допсоглашение кодом из SMS: версия действует, допработа подписана, работа — прорабу',
    operationId: 'signDocumentByClient',
    expect: 'success',
    example: 'signDocumentByClient/ok',
    run: async (ctx) => {
      const s = await as(ctx);
      const d = body(await changeDraft(ctx, s));
      await s.post(P(ctx, 'obj-42', 'estimates/3/send'), undefined, {
        ifMatch: d.revision as number,
      });
      const agr = (body(await s.get(P(ctx, 'obj-42', 'documents'))).items ?? []).find(
        (x) => x.kind === 'agreement',
      )?.id as string;
      await s.post(R(ctx, `documents/${agr}/sign-requests`));
      const r = await ctx.anon().post(PUB(ctx, `documents/${agr}/sign`), { smsCode: SIGN_CODE });
      ctx.expectExample(r, 'signDocumentByClient/ok');
      expect(body(await s.get(P(ctx, 'obj-42', 'estimates/3'))).state).toBe('approved');
      expect((body(await s.get(P(ctx, 'obj-42', 'change-orders'))).items ?? [])[0]?.status).toBe(
        'signed',
      );
      const works = (body(await s.get(P(ctx, 'obj-42', 'works'))).items ?? []).map((w) => w.name);
      expect(works).toContain('Перенос розеток на кухне');
    },
  },
  {
    title: 'неверный код — 422 sms_code_invalid; документ не ждёт подписи — 409',
    operationId: 'signDocumentByClient',
    expect: 'error',
    example: 'signDocumentByClient/validation_failed',
    run: async (ctx) => {
      const s = await as(ctx);
      await s.post(R(ctx, `documents/${ctx.A('doc-42-act1')}/sign-requests`));
      const bad = await ctx
        .anon()
        .post(PUB(ctx, `documents/${ctx.A('doc-42-act1')}/sign`), { smsCode: '000000' });
      ctx.expectExample(bad, 'signDocumentByClient/validation_failed');
      expect(body(bad).reason).toBe('sms_code_invalid');
      const state = await ctx
        .anon()
        .post(PUB(ctx, `documents/${ctx.A('doc-42-act2')}/sign`), { smsCode: SIGN_CODE });
      expect(state.status).toBe(409);
    },
  },
]);
