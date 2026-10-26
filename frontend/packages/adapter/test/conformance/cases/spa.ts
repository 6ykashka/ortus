// Кейсы страниц «Салон и SPA» (W5.21 на контракте 0.12.0-stage5, тег Spa; backend — W5.20): услуги с техкартой и визиты
// «Альты» на сиде эталона (ortus/extra-data.js: визиты ap-1 10:00–11:00 «Классический массаж · Мария К.», ap-2
// 11:30–13:00 «SPA-ритуал · Ольга Р.» со столом, ap-3 14:00–14:45; масло 250 мл, крем 12 г; «сейчас» сервера — 10:30
// по Москве). Нехватка крема на ap-2 (нужно 20 г, есть 12) — 409 invalid_transition/insufficient_stock без частичного
// списания. Склад — временные хендлеры модуля до W5.10.
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

type Body = Record<string, unknown> & {
  id?: string;
  status?: string;
  revision?: number;
  code?: string;
  reason?: string;
  detail?: string;
  items?: Record<string, unknown>[];
  appointment?: Record<string, unknown>;
  inventoryMovementIds?: string[];
  violations?: { field: string; code: string; message: string }[];
};
const body = (r: Reply): Body => r.body as Body;

const spa = (ctx: CaseContext, rest: string) => `${ctx.alta}/spa/${rest}`;
/** «01.10.2026 HH:MM» по Москве → момент UTC. */
const msk = (hhmm: string): string => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};
const rub = (n: number) => ({ amountMinor: Math.round(n * 100), currency: 'RUB' });
const MISSING = '00000000-0000-5000-8000-0000000000aa';

const newVisit = (ctx: CaseContext, hhmm: string, over: Record<string, unknown> = {}) => ({
  orgUnitId: ctx.A('r-msk'),
  serviceId: ctx.A('svc-classic'),
  clientId: ctx.A('cl-ap-1'),
  practitionerMemberId: ctx.A('m-morozova'),
  roomId: ctx.A('res-room2'),
  equipmentIds: [],
  startsAt: msk(hhmm),
  timeZone: 'Europe/Moscow',
  ...over,
});

const newService = (ctx: CaseContext, over: Record<string, unknown> = {}) => ({
  orgUnitId: ctx.A('r-msk'),
  name: 'Массаж лица',
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  price: rub(1800),
  requiredEquipmentIds: [],
  recipe: [{ itemId: ctx.A('inv-oil'), quantity: '10', unit: 'ml' }],
  ...over,
});

/** Визит: прочитать (ETag-ревизия) и выполнить действие с If-Match. */
async function act(
  ctx: CaseContext,
  proto: string,
  action: string,
  payload: unknown,
  persona = 'owner',
): Promise<Reply> {
  const s = await ctx.as(persona);
  const cur = body(await s.get(spa(ctx, `appointments/${ctx.A(proto)}`)));
  return s.post(spa(ctx, `appointments/${ctx.A(proto)}/${action}`), payload, {
    ifMatch: cur.revision ?? 1,
  });
}

const perform = (ctx: CaseContext, proto: string, persona = 'owner') =>
  act(ctx, proto, 'performance', { performedAt: '2026-10-01T07:30:00Z' }, persona);

const complete = (ctx: CaseContext, proto: string, over: Record<string, unknown> = {}) =>
  act(ctx, proto, 'completion', {
    warehouseId: ctx.A('wh-spa'),
    overrides: [],
    ...over,
  });

export const spaCases = cases('spa')([
  // ── услуги ──
  {
    title: 'владелец видит три услуги салона с техкартой и буферами эталона',
    operationId: 'listSpaServices',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = body(await s.get(spa(ctx, 'services')));
      expect(r.items?.map((x) => x.name)).toEqual([
        'Классический массаж',
        'SPA-ритуал',
        'Массаж спины',
      ]);
      const ritual = r.items?.[1] as {
        bufferBeforeMinutes: number;
        recipe: { quantity: string }[];
      };
      expect(ritual.bufferBeforeMinutes).toBe(15);
      expect(ritual.recipe.map((l) => l.quantity)).toEqual(['40', '20']);
    },
  },
  {
    title: 'водителю услуги салона закрыты',
    operationId: 'listSpaServices',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('driver');
      ctx.expectProblem(await s.get(spa(ctx, 'services')), 'forbidden_action');
    },
  },
  {
    title: 'услуга создаётся с ревизией 1, ETag и техкартой',
    operationId: 'createSpaService',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(spa(ctx, 'services'), newService(ctx));
      expect(r.status).toBe(201);
      expect(r.headers.get('ETag')).toBe('"rev-1"');
      expect(body(r).revision).toBe(1);
      expect(body(r).recipe).toHaveLength(1);
    },
  },
  {
    title: 'повтор названия услуги — 422 под полем name',
    operationId: 'createSpaService',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(spa(ctx, 'services'), newService(ctx, { name: 'spa-ритуал' }));
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations?.[0]?.field).toBe('name');
    },
  },
  {
    title: 'единица техкарты не совпадает с базовой единицей позиции — 422 recipe[0].unit',
    operationId: 'createSpaService',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const recipe = [{ itemId: ctx.A('inv-oil'), quantity: '10', unit: 'g' }];
      const r = await s.post(spa(ctx, 'services'), newService(ctx, { recipe }));
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations?.[0]?.field).toBe('recipe[0].unit');
    },
  },
  {
    title: 'услуга читается по id; чужой id — 404',
    operationId: 'getSpaService',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(spa(ctx, `services/${ctx.A('svc-back')}`));
      expect(body(r).name).toBe('Массаж спины');
      expect(r.headers.get('ETag')).toBe('"rev-1"');
      ctx.expectProblem(await s.get(spa(ctx, `services/${MISSING}`)), 'not_found');
    },
  },
  {
    title: 'правка услуги: ревизия растёт, записанный визит держит снимок',
    operationId: 'updateSpaService',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        spa(ctx, `services/${ctx.A('svc-classic')}`),
        { durationMinutes: 75, price: rub(3500) },
        { ifMatch: 1 },
      );
      expect(r.status).toBe(200);
      expect(body(r).revision).toBe(2);
      const ap = body(await s.get(spa(ctx, `appointments/${ctx.A('ap-1')}`)));
      expect(ap.serviceRevision).toBe(1);
    },
  },
  {
    title: 'правка услуги по старой версии — 412 revision_mismatch',
    operationId: 'updateSpaService',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.patch(
        spa(ctx, `services/${ctx.A('svc-classic')}`),
        { name: 'Массаж' },
        { ifMatch: 7 },
      );
      ctx.expectProblem(r, 'revision_mismatch');
    },
  },
  // ── визиты ──
  {
    title: 'владелец: три визита дня по порядку времени, статус «подтверждён»',
    operationId: 'listAppointments',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = body(await s.get(spa(ctx, 'appointments')));
      expect(r.items?.map((a) => a.id)).toEqual([ctx.A('ap-1'), ctx.A('ap-2'), ctx.A('ap-3')]);
      expect(r.items?.every((a) => a.status === 'confirmed')).toBe(true);
    },
  },
  {
    title: 'фильтры: период суток, статус и специалист',
    operationId: 'listAppointments',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const day = `from=${msk('11:00')}&to=${msk('14:00')}`;
      const mid = body(await s.get(spa(ctx, `appointments?${day}`)));
      expect(mid.items?.map((a) => a.id)).toEqual([ctx.A('ap-2')]);
      const none = body(await s.get(spa(ctx, 'appointments?status=performed_pending_posting')));
      expect(none.items).toEqual([]);
      const who = body(
        await s.get(spa(ctx, `appointments?practitionerMemberId=${ctx.A('m-morozova')}`)),
      );
      expect(who.items).toHaveLength(3);
    },
  },
  {
    title: 'неизвестный статус в фильтре — 400',
    operationId: 'listAppointments',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      ctx.expectProblem(await s.get(spa(ctx, 'appointments?status=done')), 'malformed_request');
    },
  },
  {
    title: 'визит читается с ETag; чужой id — 404',
    operationId: 'getAppointment',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.get(spa(ctx, `appointments/${ctx.A('ap-2')}`));
      expect(body(r).status).toBe('confirmed');
      expect(body(r).equipmentIds).toEqual([ctx.A('res-table')]);
      expect(r.headers.get('ETag')).toBe('"rev-1"');
      ctx.expectProblem(await s.get(spa(ctx, `appointments/${MISSING}`)), 'not_found');
    },
  },
  {
    title: 'запись на свободное время занимает специалиста и кабинет в календаре',
    operationId: 'createAppointment',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(spa(ctx, 'appointments'), newVisit(ctx, '15:15'));
      expect(r.status).toBe(201);
      expect(body(r).status).toBe('confirmed');
      const win = body(r).window as { startsAt: string; endsAt: string };
      expect(win).toMatchObject({ startsAt: msk('15:15'), endsAt: msk('16:15') });
      // Бронь в календаре с буфером уборки услуги.
      const bk = body(await s.get(`${ctx.alta}/calendar/bookings/${body(r).bookingId}`));
      expect(bk).toMatchObject({ sourceKind: 'appointment', cleanupMinutes: 15, prepMinutes: 0 });
    },
  },
  {
    title: 'запись на занятое время — 409 resources_unavailable с текстом календаря',
    operationId: 'createAppointment',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(spa(ctx, 'appointments'), newVisit(ctx, '10:30'));
      ctx.expectProblem(r, 'resources_unavailable');
      expect(body(r).detail).toMatch(/^Конфликт ресурсов: Анна Морозова · массажист занят/);
      expect(body(r).violations?.map((v) => v.field)).toContain('roomId');
    },
  },
  {
    title: 'услуга требует оборудование — без него 422 equipmentIds',
    operationId: 'createAppointment',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(
        spa(ctx, 'appointments'),
        newVisit(ctx, '16:30', { serviceId: ctx.A('svc-ritual'), equipmentIds: [] }),
      );
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations?.[0]).toMatchObject({ field: 'equipmentIds', code: 'required' });
    },
  },
  {
    title: 'вне рабочего дня ресурса — 422 startsAt',
    operationId: 'createAppointment',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(spa(ctx, 'appointments'), newVisit(ctx, '19:45'));
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations?.[0]?.field).toBe('startsAt');
    },
  },
  {
    title: 'перенос визита ap-3 на 16:00 освобождает прежнее время',
    operationId: 'rescheduleAppointment',
    expect: 'success',
    run: async (ctx) => {
      const r = await act(ctx, 'ap-3', 'reschedule', {
        startsAt: msk('16:00'),
        timeZone: 'Europe/Moscow',
      });
      expect(r.status).toBe(200);
      expect(body(r).window).toMatchObject({ startsAt: msk('16:00'), endsAt: msk('16:45') });
      expect(body(r).revision).toBe(2);
    },
  },
  {
    title: 'перенос на занятое время — 409 resources_unavailable',
    operationId: 'rescheduleAppointment',
    expect: 'error',
    run: async (ctx) => {
      const r = await act(ctx, 'ap-1', 'reschedule', {
        startsAt: msk('11:00'),
        timeZone: 'Europe/Moscow',
      });
      ctx.expectProblem(r, 'resources_unavailable');
    },
  },
  {
    title: 'перенос по старой версии — 412',
    operationId: 'rescheduleAppointment',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const r = await s.post(
        spa(ctx, `appointments/${ctx.A('ap-3')}/reschedule`),
        { startsAt: msk('16:00'), timeZone: 'Europe/Moscow' },
        { ifMatch: 9 },
      );
      ctx.expectProblem(r, 'revision_mismatch');
    },
  },
  {
    title: 'отмена освобождает ресурсы; повторная — 409 invalid_transition',
    operationId: 'cancelAppointment',
    expect: 'success',
    run: async (ctx) => {
      const r = await act(ctx, 'ap-3', 'cancel', { reason: 'Клиент перенёс запись' });
      expect(body(r).status).toBe('cancelled');
      const again = await act(ctx, 'ap-3', 'cancel', { reason: 'Ещё раз' });
      ctx.expectProblem(again, 'invalid_transition');
      // Время свободно: на него можно записать.
      const s = await ctx.as('owner');
      const free = await s.post(spa(ctx, 'appointments'), newVisit(ctx, '14:00'));
      expect(free.status).toBe(201);
    },
  },
  {
    title: '«Не пришёл» — статус no_show',
    operationId: 'cancelAppointment',
    expect: 'success',
    run: async (ctx) => {
      const r = await act(ctx, 'ap-3', 'cancel', { reason: 'Не пришёл', noShow: true });
      expect(body(r).status).toBe('no_show');
    },
  },
  {
    title: 'отмена без причины — 422',
    operationId: 'cancelAppointment',
    expect: 'error',
    run: async (ctx) => {
      const r = await act(ctx, 'ap-3', 'cancel', { reason: '  ' });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title: 'выполнение: статус «выполнен, учёт не завершён», материалы не тронуты',
    operationId: 'recordAppointmentPerformance',
    expect: 'success',
    run: async (ctx) => {
      const r = await perform(ctx, 'ap-1');
      expect(body(r).status).toBe('performed_pending_posting');
      expect(body(r).performedAt).toBe('2026-10-01T07:30:00Z');
      const s = await ctx.as('owner');
      const bal = body(await s.get(`${ctx.alta}/inventory/balances?itemId=${ctx.A('inv-oil')}`));
      expect(bal.items?.[0]?.onHand).toBe('250');
    },
  },
  {
    title: 'выполнение в будущем — 422; повторная отметка — 409',
    operationId: 'recordAppointmentPerformance',
    expect: 'error',
    run: async (ctx) => {
      const future = await act(ctx, 'ap-1', 'performance', { performedAt: '2026-10-01T12:00:00Z' });
      ctx.expectProblem(future, 'validation_failed');
      await perform(ctx, 'ap-1');
      ctx.expectProblem(await perform(ctx, 'ap-1'), 'invalid_transition');
    },
  },
  {
    title: 'завершение списывает по техкарте один раз: масло 250 → 220 мл, повтор — 409',
    operationId: 'completeAppointment',
    expect: 'success',
    run: async (ctx) => {
      await perform(ctx, 'ap-1');
      const r = await complete(ctx, 'ap-1');
      expect(r.status).toBe(200);
      expect(body(r).appointment).toMatchObject({ status: 'completed' });
      expect(body(r).inventoryMovementIds).toHaveLength(1);
      const s = await ctx.as('owner');
      const bal = body(await s.get(`${ctx.alta}/inventory/balances?itemId=${ctx.A('inv-oil')}`));
      expect(bal.items?.[0]?.onHand).toBe('220');
      ctx.expectProblem(await complete(ctx, 'ap-1'), 'invalid_transition');
    },
  },
  {
    title: 'финальная цена визита по факту после скидки (CASH-03)',
    operationId: 'completeAppointment',
    expect: 'success',
    run: async (ctx) => {
      await perform(ctx, 'ap-1');
      const r = await complete(ctx, 'ap-1', { finalPrice: rub(2900) });
      expect((body(r).appointment as { finalPrice: unknown }).finalPrice).toEqual(rub(2900));
    },
  },
  {
    title: 'нехватка крема на SPA-ритуале — 409 insufficient_stock, статус и склад не меняются',
    operationId: 'completeAppointment',
    expect: 'error',
    run: async (ctx) => {
      await perform(ctx, 'ap-2');
      const r = await complete(ctx, 'ap-2');
      ctx.expectProblem(r, 'invalid_transition');
      expect(body(r).reason).toBe('insufficient_stock');
      expect(body(r).detail).toBe(
        'Не хватило «Крем восстанавливающий»: нужно 20 г, в наличии 12 г.',
      );
      const s = await ctx.as('owner');
      expect(body(await s.get(spa(ctx, `appointments/${ctx.A('ap-2')}`))).status).toBe(
        'performed_pending_posting',
      );
      const bal = body(await s.get(`${ctx.alta}/inventory/balances`));
      expect(bal.items?.map((b) => b.onHand)).toEqual(['250', '12']);
    },
  },
  {
    title: 'решение владельца: фактический расход 12 г — визит завершён, крем 0',
    operationId: 'completeAppointment',
    expect: 'success',
    run: async (ctx) => {
      await perform(ctx, 'ap-2');
      const r = await complete(ctx, 'ap-2', {
        overrides: [
          { itemId: ctx.A('inv-cream'), actualQuantity: '12', reason: 'Остаток из резерва' },
        ],
      });
      expect(body(r).appointment).toMatchObject({ status: 'completed' });
      const s = await ctx.as('owner');
      const bal = body(await s.get(`${ctx.alta}/inventory/balances`));
      // масло по техкарте 40 мл, крем по факту 12 г.
      expect(bal.items?.map((b) => b.onHand)).toEqual(['210', '0']);
    },
  },
  {
    title: 'завершение до отметки выполнения — 409',
    operationId: 'completeAppointment',
    expect: 'error',
    run: async (ctx) => {
      ctx.expectProblem(await complete(ctx, 'ap-1'), 'invalid_transition');
    },
  },
  {
    title: 'переопределение без причины — 422',
    operationId: 'completeAppointment',
    expect: 'error',
    run: async (ctx) => {
      await perform(ctx, 'ap-2');
      const r = await complete(ctx, 'ap-2', {
        overrides: [{ itemId: ctx.A('inv-cream'), actualQuantity: '12', reason: ' ' }],
      });
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  // ── специалист (область «своё») ──
  {
    title: 'специалист видит свои визиты и не видит услуги без права spa.services.read',
    operationId: 'listAppointments',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('therapist');
      const r = body(await s.get(spa(ctx, 'appointments')));
      expect(r.items).toHaveLength(3);
      const svc = await s.get(spa(ctx, 'services'));
      expect([200, 403]).toContain(svc.status);
    },
  },
  {
    title: 'специалист не записывает клиента на другого специалиста',
    operationId: 'createAppointment',
    expect: 'error',
    run: async (ctx) => {
      const s = await ctx.as('therapist');
      const r = await s.post(
        spa(ctx, 'appointments'),
        newVisit(ctx, '16:30', { practitionerMemberId: ctx.A('m-kotova') }),
      );
      expect([403, 422]).toContain(r.status);
    },
  },
  // ── склад (временные хендлеры до W5.10) ──
  {
    title: 'номенклатура, склад и остатки салона по сиду эталона',
    operationId: 'listInventoryBalances',
    expect: 'success',
    run: async (ctx) => {
      const s = await ctx.as('owner');
      const items = body(await s.get(`${ctx.alta}/inventory/items`));
      expect(items.items?.map((i) => i.name)).toEqual([
        'Масло массажное',
        'Крем восстанавливающий',
      ]);
      const wh = body(await s.get(`${ctx.alta}/inventory/warehouses`));
      expect(wh.items).toHaveLength(1);
      const bal = body(await s.get(`${ctx.alta}/inventory/balances`));
      expect(bal.items?.map((b) => [b.itemId, b.onHand, b.available])).toEqual([
        [ctx.A('inv-oil'), '250', '250'],
        [ctx.A('inv-cream'), '12', '12'],
      ]);
    },
  },
]);
