// Кейсы контрактного PR 5 этапа 4 (W4.06, 0.7.0-stage4): «Календарь ресурсов» (W4.40, W4.41) на сиде календаря
// «Альты» 14.10 (extra-data.js): ресурсы, брони дня, перенос «Классический массаж · Мария К.» на 11:00 — конфликт
// эталона, на 08:00 — успех, «Перерыв» — запрет переноса, свободные слоты для всех ресурсов брони («08:00», «08:15»,
// «08:30» — moveBooking/freeSlots эталона). Примеры — tools/gen/examples-w406.mjs (listCalendarResources/*,
// listCalendarBookings/*, updateCalendarBooking/*, findCalendarAvailability/*).
import { expect } from 'vitest';

import type { Reply } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

interface Booking {
  id: string;
  title: string;
  window: { startsAt: string; endsAt: string };
  resources: { kind: string; resourceId: string }[];
  rescheduleLock?: string;
  revision: number;
}
type Body = Record<string, unknown> & {
  items?: (Booking & { name?: string })[];
  slots?: { window: { startsAt: string } }[];
  violations?: { field: string; code: string; message: string }[];
};
const body = (r: Reply): Body => r.body as Body;

const cal = (ctx: CaseContext, rest: string) => `${ctx.alta}/calendar/${rest}`;
/** «01.10.2026 HH:MM» по Москве → момент UTC. */
const msk = (hhmm: string): string => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 9, 1, h - 3, m)).toISOString().replace('.000Z', 'Z');
};
const win = (from: string, to: string) => ({
  startsAt: msk(from),
  endsAt: msk(to),
  timeZone: 'Europe/Moscow',
});
const massage = (ctx: CaseContext) => ctx.A('b-a1');

/** Состояние «Альты» сценарного сервера: календарь (после первого чтения) и роли. */
type AltaState = {
  calendar?: { bookings: { proto: string; resourceIds: string[] }[] };
  roles: { proto: string; permissions: string[] }[];
  policyVersion: number;
};
const alta = (ctx: CaseContext) => ctx.server.state().orgs[ctx.P('t-alta')] as unknown as AltaState;
const resources = (ctx: CaseContext) => [
  { kind: 'member', resourceId: ctx.A('res-am') },
  { kind: 'room', resourceId: ctx.A('res-room2') },
];

/** Перенос брони «Классический массаж · Мария К.» (10:00–11:00) на начало `hhmm` (длительность та же). */
async function move(ctx: CaseContext, hhmm: string, persona = 'owner') {
  const s = await ctx.as(persona);
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const end = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return s.patch(
    cal(ctx, `bookings/${massage(ctx)}`),
    { action: 'reschedule', window: win(hhmm, end), resources: resources(ctx) },
    { ifMatch: 1 },
  );
}

const slotsQuery = (ctx: CaseContext, exclude = massage(ctx)) => ({
  orgUnitId: ctx.A('r-msk'),
  window: win('08:00', '20:00'),
  durationMinutes: 60,
  stepMinutes: 15,
  requirements: [
    { kind: 'member', resourceIds: [ctx.A('res-am')], requiredCount: 1 },
    { kind: 'room', resourceIds: [ctx.A('res-room2')], requiredCount: 1 },
  ],
  excludeBookingId: exclude,
  prepMinutes: 0,
  cleanupMinutes: 15,
  maxSlots: 3,
});

export const calendarCases = cases('calendar')([
  {
    title:
      'ресурсы «Альты» владельца: сотрудники, кабинеты, оборудование; машин без «Логистики» нет',
    operationId: 'listCalendarResources',
    expect: 'success',
    example: 'listCalendarResources/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(await owner.get(cal(ctx, 'resources')), 'listCalendarResources/ok');
    },
  },
  {
    title:
      'фильтр вида и «Логистика» подключена — машины видит владелец, менеджер — машины своей фирмы',
    operationId: 'listCalendarResources',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const owner = await ctx.as('owner');
      const names = (r: Reply) => body(r).items?.map((x) => x.name);
      expect(names(await owner.get(cal(ctx, 'resources?kind=vehicle')))).toEqual([
        'ГАЗель Next · А 412 МР',
        'ГАЗон Next · Е 905 НА',
        'Mercedes Sprinter · Т 771 ЕХ',
      ]);
      const manager = await ctx.as('manager');
      expect(names(await manager.get(cal(ctx, 'resources')))).toEqual([
        'ГАЗель Next · А 412 МР',
        'ГАЗон Next · Е 905 НА',
        'Mercedes Sprinter · Т 771 ЕХ',
        'Илья Васильев · водитель',
      ]);
    },
  },
  {
    title: 'водителю календарь ресурсов закрыт — 403',
    operationId: 'listCalendarResources',
    expect: 'error',
    example: 'listCalendarResources/forbidden_action',
    run: async (ctx) => {
      const driver = await ctx.as('driver');
      ctx.expectExample(
        await driver.get(cal(ctx, 'resources')),
        'listCalendarResources/forbidden_action',
      );
    },
  },
  {
    title: 'брони текущего дня: визиты и перерыв с буферами; рейс и ТО без «Логистики» не видны',
    operationId: 'listCalendarBookings',
    expect: 'success',
    example: 'listCalendarBookings/day',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(await owner.get(cal(ctx, 'bookings')), 'listCalendarBookings/day');
    },
  },
  {
    title:
      'неделя и фильтры: окно from/to, вид, ресурс; рейс и ТО — с «Логистикой», запрет переноса',
    operationId: 'listCalendarBookings',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const owner = await ctx.as('owner');
      const q = `from=${msk('00:00')}&to=${encodeURIComponent(new Date(Date.parse(msk('00:00')) + 7 * 86_400_000).toISOString().replace('.000Z', 'Z'))}`;
      const week = body(await owner.get(cal(ctx, `bookings?${q}`))).items ?? [];
      expect(week.map((b) => [b.title, b.rescheduleLock ?? null])).toEqual([
        ['Плановое ТО', 'vehicle_card'],
        ['Рейс Р-208', 'source_module'],
        ['Классический массаж · Мария К.', null],
        ['SPA-ритуал · Ольга Р.', null],
        ['Перерыв', 'specialist_schedule'],
        ['Массаж спины · Екатерина Л.', null],
      ]);
      const rooms = body(await owner.get(cal(ctx, 'bookings?kind=room'))).items ?? [];
      expect(rooms.map((b) => b.title)).toEqual([
        'Классический массаж · Мария К.',
        'SPA-ритуал · Ольга Р.',
        'Массаж спины · Екатерина Л.',
      ]);
      const table = body(
        await owner.get(cal(ctx, `bookings?resourceId=${ctx.A('res-table')}`)),
      ).items;
      expect(table?.map((b) => b.title)).toEqual(['SPA-ритуал · Ольга Р.']);
    },
  },
  {
    title: 'массажист видит свои брони и ресурсы, переносит визит, перерыв — нет',
    operationId: 'listCalendarBookings',
    expect: 'success',
    run: async (ctx) => {
      const t = await ctx.as('therapist');
      const items = body(await t.get(cal(ctx, 'bookings'))).items ?? [];
      expect(items.map((b) => [b.title, b.rescheduleLock ?? null])).toEqual([
        ['Классический массаж · Мария К.', null],
        ['SPA-ритуал · Ольга Р.', null],
        ['Перерыв', 'specialist_schedule'],
        ['Массаж спины · Екатерина Л.', null],
      ]);
      const res = body(await t.get(cal(ctx, 'resources'))).items?.map((r) => r.name);
      expect(res).toEqual(['Анна Морозова · массажист', 'Кабинет № 2', 'Стол с подогревом']);
    },
  },
  {
    title: 'окно длиннее недели — 422',
    operationId: 'listCalendarBookings',
    expect: 'error',
    example: 'listCalendarBookings/validation_failed',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const q = `from=${msk('00:00')}&to=2026-10-09T21:00:00Z`;
      ctx.expectExample(
        await owner.get(cal(ctx, `bookings?${q}`)),
        'listCalendarBookings/validation_failed',
      );
    },
  },
  {
    title: 'бронь: подготовка, уборка, занятость, вид источника',
    operationId: 'getCalendarBooking',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const r = await owner.get(cal(ctx, `bookings/${ctx.A('b-a2')}`));
      expect(r.status).toBe(200);
      expect(r.headers.get('ETag')).toBe('"rev-1"');
      expect(r.body).toMatchObject({
        title: 'SPA-ритуал · Ольга Р.',
        prepMinutes: 15,
        cleanupMinutes: 15,
        occupied: { startsAt: msk('11:15'), endsAt: msk('13:15') },
        sourceKind: 'appointment',
      });
    },
  },
  {
    title: 'бронь рейса без «Логистики» не раскрывается — 404',
    operationId: 'getCalendarBooking',
    expect: 'error',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectProblem(await owner.get(cal(ctx, `bookings/${ctx.A('b-208')}`)), 'not_found');
    },
  },
  {
    title: 'перенос визита на 08:00: все ресурсы свободны с уборкой, ревизия 2',
    operationId: 'updateCalendarBooking',
    expect: 'success',
    example: 'updateCalendarBooking/ok',
    run: async (ctx) => {
      ctx.expectExample(await move(ctx, '08:00'), 'updateCalendarBooking/ok');
    },
  },
  {
    title: 'перенос на 11:00 — конфликт ресурсов эталона, ничего не меняется',
    operationId: 'updateCalendarBooking',
    expect: 'error',
    example: 'updateCalendarBooking/resources_unavailable',
    run: async (ctx) => {
      ctx.expectExample(await move(ctx, '11:00'), 'updateCalendarBooking/resources_unavailable');
      const owner = await ctx.as('owner');
      const b = body(await owner.get(cal(ctx, `bookings/${massage(ctx)}`)));
      expect([b.revision, (b.window as Booking['window']).startsAt]).toEqual([1, msk('10:00')]);
    },
  },
  {
    // Возврат 1: bookingConflicts эталона (models.js:395) — пункт на пару «другая бронь × общий ресурс», брони в
    // порядке создания (сид: b-a2, b-a3, b-br), ресурсы — в порядке другой брони; ресурс двух броней назван дважды.
    title:
      'перенос на 13:00 — пункт конфликта на каждую пару «бронь × ресурс», как bookingConflicts',
    operationId: 'updateCalendarBooking',
    expect: 'error',
    run: async (ctx) => {
      const r = await move(ctx, '13:00');
      ctx.expectProblem(r, 'resources_unavailable');
      expect(body(r).detail).toBe(
        'Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); ' +
          'Кабинет № 2 занят («SPA-ритуал · Ольга Р.»); ' +
          'Анна Морозова · массажист занят («Массаж спины · Екатерина Л.»); ' +
          'Кабинет № 2 занят («Массаж спины · Екатерина Л.»); ' +
          'Анна Морозова · массажист занят («Перерыв»)',
      );
      expect(body(r).violations?.map((v) => [v.field, v.code])).toEqual([
        ['resources[0]', 'busy'],
        ['resources[1]', 'busy'],
        ['resources[0]', 'busy'],
        ['resources[1]', 'busy'],
        ['resources[0]', 'busy'],
      ]);
    },
  },
  {
    // Возврат 1: Booking.resources — только видимые участнику ресурсы; бронь со скрытым ресурсом — permission.
    title: 'скрытый ресурс брони не раскрывается: в resources только видимые, перенос — permission',
    operationId: 'getCalendarBooking',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const manager = await ctx.as('manager');
      const url = cal(ctx, `bookings/${ctx.A('b-208')}`);
      expect((await manager.get(url)).status).toBe(200);
      const org = alta(ctx);
      const trip = org.calendar?.bookings.find((b) => b.proto === 'b-208');
      if (!trip) throw new Error('нет брони b-208');
      trip.resourceIds = [...trip.resourceIds, ctx.A('res-room2')];
      const role = org.roles.find((x) => x.proto === 'r-manager');
      if (!role) throw new Error('нет роли r-manager');
      role.permissions = [...role.permissions, 'calendar.bookings.manage'];
      org.policyVersion++;
      const visible = [{ kind: 'member', resourceId: ctx.A('res-iv') }];
      const one = body(await manager.get(url)) as unknown as Booking;
      expect([one.resources, one.rescheduleLock]).toEqual([visible, 'permission']);
      const listed = (body(await manager.get(cal(ctx, 'bookings'))).items ?? []).find(
        (b) => b.id === ctx.A('b-208'),
      );
      expect([listed?.resources, listed?.rescheduleLock]).toEqual([visible, 'permission']);
      const owner = body(await (await ctx.as('owner')).get(url)) as unknown as Booking;
      expect(owner.resources.map((x) => x.resourceId)).toEqual([
        ctx.A('res-iv'),
        ctx.A('res-room2'),
      ]);
    },
  },
  {
    // Возврат 1: «своё» в области self расширяют только подтверждённые брони, не закончившиеся до текущих суток.
    title: 'массажист: отменённая и прошлая бронь не открывают ей ресурсы',
    operationId: 'listCalendarResources',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const cancel = await owner.patch(
        cal(ctx, `bookings/${ctx.A('b-a2')}`),
        { action: 'cancel' },
        { ifMatch: 1 },
      );
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      const names = async () =>
        body(await (await ctx.as('therapist')).get(cal(ctx, 'resources'))).items?.map(
          (r) => r.name,
        );
      expect(await names()).toEqual(['Анна Морозова · массажист', 'Кабинет № 2']);
      ctx.server.setNow('2026-10-02T07:30:00Z');
      expect(await names()).toEqual(['Анна Морозова · массажист']);
    },
  },
  {
    title: '«Перерыв» в календаре не переносится — 409 с текстом эталона',
    operationId: 'updateCalendarBooking',
    expect: 'error',
    example: 'updateCalendarBooking/invalid_transition',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.patch(
          cal(ctx, `bookings/${ctx.A('b-br')}`),
          {
            action: 'reschedule',
            window: win('15:00', '15:45'),
            resources: [{ kind: 'member', resourceId: ctx.A('res-am') }],
          },
          { ifMatch: 1 },
        ),
        'updateCalendarBooking/invalid_transition',
      );
    },
  },
  {
    title: 'перенос вне рабочего дня — 422; менеджеру без права «Изменять» — 403',
    operationId: 'updateCalendarBooking',
    expect: 'error',
    run: async (ctx) => {
      const late = await move(ctx, '19:30');
      ctx.expectProblem(late, 'validation_failed');
      expect(body(late).detail).toBe('Время вне рабочего дня ресурса.');
      ctx.server.applyPreset('logistics-ready');
      const manager = await ctx.as('manager');
      const r = await manager.patch(
        cal(ctx, `bookings/${ctx.A('b-208')}`),
        {
          action: 'reschedule',
          window: win('14:00', '18:00'),
          resources: [{ kind: 'member', resourceId: ctx.A('res-iv') }],
        },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'forbidden_action');
    },
  },
  {
    title: 'свободные слоты для всех ресурсов переноса: 08:00, 08:15, 08:30',
    operationId: 'findCalendarAvailability',
    expect: 'success',
    example: 'findCalendarAvailability/reschedule',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.post(cal(ctx, 'availability'), slotsQuery(ctx)),
        'findCalendarAvailability/reschedule',
      );
    },
  },
  {
    title: 'слоты «SPA-ритуала» (подготовка и уборка, стол): 08:15, 15:15, 15:30 эталона',
    operationId: 'findCalendarAvailability',
    expect: 'success',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      const q = {
        ...slotsQuery(ctx, ctx.A('b-a2')),
        durationMinutes: 90,
        prepMinutes: 15,
        requirements: [
          ...slotsQuery(ctx).requirements,
          { kind: 'equipment', resourceIds: [ctx.A('res-table')], requiredCount: 1 },
        ],
      };
      const slots = body(await owner.post(cal(ctx, 'availability'), q)).slots;
      expect(slots?.map((s) => s.window.startsAt)).toEqual([
        msk('08:15'),
        msk('15:15'),
        msk('15:30'),
      ]);
    },
  },
  {
    title: 'неизвестная бронь переноса — 404',
    operationId: 'findCalendarAvailability',
    expect: 'error',
    example: 'findCalendarAvailability/not_found',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.post(cal(ctx, 'availability'), slotsQuery(ctx, ctx.A('b-missing'))),
        'findCalendarAvailability/not_found',
      );
    },
  },
]);
