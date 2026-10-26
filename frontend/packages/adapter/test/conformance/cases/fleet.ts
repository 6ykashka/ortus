// Кейсы контракта этапа 2 (W2.00, 0.5.0-stage2): логистика «Альты» по сиду 14.10 — рейс от плана до приёмки,
// назначение и бронь машины, осмотры с фото, блокирующий дефект и очередь менеджера (S2-17), расходы, сдача,
// приёмка с доработкой (S2-10), начисления (S2-12, AC-05), пул водителей (S2-14), «Требует решения» (S2-18).
// Каждой операции экранов этапа 2 (тегов Fleet, Earnings, Home) — кейс успеха и кейс ошибки (coverage.test.ts).
// Фото и чеки — готовые файлы в состоянии сервера (как после загрузки и проверки, W1.09).
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const NOW = '2026-10-01T07:30:00Z';
const MSK = 'Europe/Moscow';
const ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;
const W208 = { startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T10:00:00Z', timeZone: MSK };

interface Item {
  id: string;
  key?: string;
  label?: string;
  revision?: number;
  state?: string;
  status?: string;
}
type Body = Record<string, unknown> & { items?: Item[]; id?: string; revision?: number };
const body = (r: Reply): Body => r.body as Body;

/** Готовые файлы организации (`ready`): фото осмотра и чеки. */
function readyFiles(ctx: CaseContext, prefix: string, n: number, status = 'ready'): string[] {
  const org = ctx.server.state().orgs[ctx.P('t-alta')];
  if (!org) throw new Error('нет «Альты»');
  return Array.from({ length: n }, (_, i) => {
    const id = `5e2a7c10-0000-4000-8000-${String(org.files.length + 1).padStart(12, '0')}`;
    org.files.push({
      id,
      fileName: `${prefix}-${i + 1}.jpg`,
      contentType: 'image/jpeg',
      sizeBytes: 2457600,
      sha256: 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
      status: status as 'ready',
      createdAt: NOW,
    });
    return id;
  });
}

const tripUrl = (ctx: CaseContext, trip = 'Р-208') => `${ctx.alta}/fleet/trips/${ctx.A(trip)}`;
const planUrl = (ctx: CaseContext, trip = 'Р-208') => `${ctx.alta}/fleet/trip-plans/${ctx.A(trip)}`;

async function ready(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  return { driver: await ctx.as('driver'), manager: await ctx.as('manager') };
}

async function reserve(ctx: CaseContext, driver: Session, vehicle = 'v1'): Promise<Reply> {
  return driver.post(`${ctx.alta}/fleet/reservations`, {
    vehicleId: ctx.A(vehicle),
    driverMemberId: ctx.A('m-vasiliev'),
    window: W208,
    tripId: ctx.A('Р-208'),
  });
}

async function inspect(
  ctx: CaseContext,
  driver: Session,
  kind: 'departure' | 'return',
  extra: Record<string, unknown> = {},
): Promise<Reply> {
  const list = body(
    await driver.get(
      `${ctx.alta}/fleet/inspection-checklist?vehicleId=${ctx.A('v1')}&kind=${kind}`,
    ),
  );
  const files = readyFiles(ctx, kind, ROLES.length);
  return driver.post(`${ctx.alta}/fleet/inspections`, {
    checklistVersionId: list.versionId,
    vehicleId: ctx.A('v1'),
    kind,
    odometerKm: kind === 'departure' ? '84500' : '84560',
    fuelPercent: 50,
    checks: (list.items ?? []).map((i) => ({ key: i.key, result: 'pass' })),
    photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: NOW })),
    capturedAt: NOW,
    ...extra,
  });
}

/** Бронь ГАЗели водителем и осмотр выезда; `defect` — критический «Стёкла: Скол». */
async function departure(ctx: CaseContext, driver: Session, defect = false) {
  const res = body(await reserve(ctx, driver));
  const extra: Record<string, unknown> = { reservationId: res.id };
  if (defect) extra.defects = [{ zone: 'Стёкла', description: 'Скол', severity: 'blocking' }];
  const insp = body(await inspect(ctx, driver, 'departure', extra));
  return { reservationId: res.id as string, inspectionId: insp.id as string };
}

/** Смена Р-208 до «В рейсе». */
async function onRoute(ctx: CaseContext, driver: Session) {
  const d = await departure(ctx, driver);
  const trip = await driver.post(`${ctx.alta}/fleet/trips`, {
    reservationId: d.reservationId,
    departureInspectionId: d.inspectionId,
  });
  return { ...d, trip: body(trip) };
}

/** Смена Р-208 до «Ожидает приёмки». */
async function submitted(ctx: CaseContext, driver: Session) {
  const d = await onRoute(ctx, driver);
  await driver.post(`${tripUrl(ctx)}/route-completion`, undefined, { ifMatch: 4 });
  const ret = body(await inspect(ctx, driver, 'return', { tripId: ctx.A('Р-208') }));
  const r = await driver.patch(
    tripUrl(ctx),
    { action: 'return', returnInspectionId: ret.id },
    { ifMatch: 6 },
  );
  return { ...d, returnInspectionId: ret.id as string, reply: r };
}

/** Расход «Топливо 2 500 ₽» с чеком. */
async function expense(ctx: CaseContext, driver: Session): Promise<Reply> {
  const [receipt] = readyFiles(ctx, 'receipt', 1);
  return driver.post(`${tripUrl(ctx)}/expenses`, {
    kind: 'fuel',
    occurredAt: NOW,
    amount: { amountMinor: 250000, currency: 'RUB' },
    receiptFileIds: [receipt],
    comment: 'АЗС на Ленинградском шоссе',
  });
}

export const fleetCases = cases('fleet')([
  // Рейс от плана до приёмки (TripPlan, Q-45).
  {
    title: 'владелец видит рейсы сида Р-208 и Р-211 в состоянии «Запланирован»',
    operationId: 'listTripPlans',
    expect: 'success',
    example: 'listTripPlans/ok',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const owner = await ctx.as('owner');
      ctx.expectExample(await owner.get(`${ctx.alta}/fleet/trip-plans`), 'listTripPlans/ok');
    },
  },
  {
    title: 'водитель видит только свои рейсы (D22): Р-211 без водителя скрыт',
    operationId: 'listTripPlans',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await driver.get(`${ctx.alta}/fleet/trip-plans?state=planned`);
      expect(body(r).items?.map((t) => t.id)).toEqual([ctx.A('Р-208')]);
      const none = await driver.get(`${ctx.alta}/fleet/trip-plans?state=accepted`);
      expect(body(none).items).toEqual([]);
    },
  },
  {
    title: 'без права на рейсы — 403 forbidden_action',
    operationId: 'listTripPlans',
    expect: 'error',
    example: 'listTripPlans/forbidden_action',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const therapist = await ctx.as('acc-4');
      ctx.expectExample(
        await therapist.get(`${ctx.alta}/fleet/trip-plans`),
        'listTripPlans/forbidden_action',
      );
    },
  },
  {
    title: 'логист планирует рейс Р-212 с водителем Ахмедовым',
    operationId: 'createTripPlan',
    expect: 'success',
    example: 'createTripPlan/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = await manager.post(`${ctx.alta}/fleet/trip-plans`, {
        orgUnitId: ctx.A('f-msk-sever'),
        title: 'Возврат тары',
        plannedWindow: {
          startsAt: '2026-10-01T13:00:00Z',
          endsAt: '2026-10-01T15:00:00Z',
          timeZone: MSK,
        },
        distanceKm: '22',
        cargo: {
          description: 'Пустые паллеты · 10 мест',
          weightKg: '300',
          volumeM3: '8',
          lengthM: '2.4',
        },
        stops: [
          {
            sequence: 1,
            op: 'load',
            address: 'Химки, ул. Заводская, 8',
            plannedAt: '2026-10-01T13:00:00Z',
            weightKg: '300',
            volumeM3: '8',
          },
          {
            sequence: 2,
            op: 'unload',
            address: 'Склад № 1, Лобня',
            plannedAt: '2026-10-01T14:00:00Z',
            weightKg: '300',
            volumeM3: '8',
          },
        ],
        driverMemberId: ctx.A('m-akhmedov'),
      });
      ctx.expectExample(r, 'createTripPlan/ok');
    },
  },
  {
    title: 'выгрузка больше, чем в кузове, — 422 с полем точки',
    operationId: 'createTripPlan',
    expect: 'error',
    example: 'createTripPlan/validation_failed',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const stop = (sequence: number, op: string, weightKg: string) => ({
        sequence,
        op,
        address: sequence === 1 ? 'Химки, ул. Заводская, 8' : 'Склад № 1, Лобня',
        weightKg,
        volumeM3: '8',
      });
      const r = await manager.post(`${ctx.alta}/fleet/trip-plans`, {
        orgUnitId: ctx.A('f-msk-sever'),
        title: 'Возврат тары',
        plannedWindow: {
          startsAt: '2026-10-01T13:00:00Z',
          endsAt: '2026-10-01T15:00:00Z',
          timeZone: MSK,
        },
        cargo: { description: 'Пустые паллеты', weightKg: '300', volumeM3: '8', lengthM: '2.4' },
        stops: [stop(1, 'load', '300'), stop(2, 'unload', '500')],
      });
      ctx.expectExample(r, 'createTripPlan/validation_failed');
    },
  },
  {
    title: 'водитель открывает свой рейс Р-208',
    operationId: 'getTripPlan',
    expect: 'success',
    example: 'getTripPlan/ok',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await driver.get(planUrl(ctx));
      ctx.expectExample(r, 'getTripPlan/ok');
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'чужой рейс водителю — 404, как несуществующий',
    operationId: 'getTripPlan',
    expect: 'error',
    example: 'getTripPlan/not_found',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(await driver.get(planUrl(ctx, 'Р-211')), 'getTripPlan/not_found');
    },
  },
  {
    title: 'логист назначает ГАЗель Next на Р-208: «Машина назначена», бронь до 11:00',
    operationId: 'assignTripVehicle',
    expect: 'success',
    example: 'assignTripVehicle/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = await manager.put(
        `${tripUrl(ctx)}/vehicle`,
        { vehicleId: ctx.A('v1') },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'assignTripVehicle/ok');
      const vehicles = body(await manager.get(`${ctx.alta}/fleet/vehicles`));
      expect(vehicles.items?.find((v) => v.id === ctx.A('v1'))).toMatchObject({
        status: 'reserved',
        heldByTripId: ctx.A('Р-208'),
      });
    },
  },
  {
    title: 'Hyundai Porter не проходит по массе и объёму — 409 vehicle_incompatible с причинами',
    operationId: 'assignTripVehicle',
    expect: 'error',
    example: 'assignTripVehicle/vehicle_incompatible',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = await manager.put(
        `${tripUrl(ctx)}/vehicle`,
        { vehicleId: ctx.A('v3') },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'assignTripVehicle/vehicle_incompatible');
      const stale = await manager.put(
        `${tripUrl(ctx)}/vehicle`,
        { vehicleId: ctx.A('v1') },
        { ifMatch: 7 },
      );
      ctx.expectProblem(stale, 'revision_mismatch');
    },
  },
  {
    title: '«Завершить рейс»: «В рейсе» → «Сдача машины»',
    operationId: 'finishTripRoute',
    expect: 'success',
    example: 'finishTripRoute/ok',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      await onRoute(ctx, driver);
      const r = await driver.post(`${tripUrl(ctx)}/route-completion`, undefined, { ifMatch: 4 });
      ctx.expectExample(r, 'finishTripRoute/ok');
    },
  },
  {
    title: 'рейс не в пути — 409 invalid_transition',
    operationId: 'finishTripRoute',
    expect: 'error',
    example: 'finishTripRoute/invalid_transition',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await driver.post(`${tripUrl(ctx)}/route-completion`, undefined, { ifMatch: 1 });
      ctx.expectExample(r, 'finishTripRoute/invalid_transition');
    },
  },

  // Блокирующий дефект: очередь менеджера и решение (S2-17).
  {
    title: 'критический дефект при выезде — в очереди менеджера, рейс «Дефект на проверке»',
    operationId: 'listInspectionDefects',
    expect: 'success',
    example: 'listInspectionDefects/ok',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const d = await departure(ctx, driver, true);
      ctx.expectExample(
        await manager.get(`${ctx.alta}/fleet/defects?state=in_review`),
        'listInspectionDefects/ok',
      );
      const plan = body(await driver.get(planUrl(ctx)));
      expect(plan).toMatchObject({ state: 'defect_review', departureInspectionId: d.inspectionId });
      const v = body(await manager.get(`${ctx.alta}/fleet/vehicles`)).items?.find(
        (x) => x.id === ctx.A('v1'),
      );
      expect(v).toMatchObject({
        status: 'maintenance',
        statusNote: 'критический дефект на проверке',
      });
    },
  },
  {
    title: 'водителю очередь дефектов закрыта — 403',
    operationId: 'listInspectionDefects',
    expect: 'error',
    example: 'listInspectionDefects/forbidden_action',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(
        await driver.get(`${ctx.alta}/fleet/defects`),
        'listInspectionDefects/forbidden_action',
      );
    },
  },
  {
    title: 'водитель видит дефект своего осмотра',
    operationId: 'getInspectionDefect',
    expect: 'success',
    example: 'getInspectionDefect/ok',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await departure(ctx, driver, true);
      const [d] = body(await manager.get(`${ctx.alta}/fleet/defects`)).items ?? [];
      ctx.expectExample(
        await driver.get(`${ctx.alta}/fleet/defects/${d?.id ?? ''}`),
        'getInspectionDefect/ok',
      );
    },
  },
  {
    title: 'несуществующий дефект — 404',
    operationId: 'getInspectionDefect',
    expect: 'error',
    example: 'getInspectionDefect/not_found',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(`${ctx.alta}/fleet/defects/${ctx.A('defect-missing')}`),
        'getInspectionDefect/not_found',
      );
    },
  },
  {
    title: '«Дефект некритичный — разрешить выезд»: рейс к осмотру, водитель стартует',
    operationId: 'decideInspectionDefect',
    expect: 'success',
    example: 'decideInspectionDefect/ok',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const d = await departure(ctx, driver, true);
      const [defect] = body(await manager.get(`${ctx.alta}/fleet/defects`)).items ?? [];
      const r = await manager.post(
        `${ctx.alta}/fleet/defects/${defect?.id ?? ''}/decision`,
        { decision: 'allow_departure' },
        { ifMatch: 1 },
      );
      ctx.expectExample(r, 'decideInspectionDefect/ok');
      expect(body(await driver.get(planUrl(ctx))).state).toBe('inspection');
      const trip = await driver.post(`${ctx.alta}/fleet/trips`, {
        reservationId: d.reservationId,
        departureInspectionId: d.inspectionId,
      });
      expect(trip.status).toBe(201);
      const inbox = await driver.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}`);
      expect(JSON.stringify(inbox.body)).toContain('Менеджер разрешил выезд');
    },
  },
  {
    title: '«Подтвердить неисправность»: машина снята с рейса, рейс снова «Запланирован»',
    operationId: 'decideInspectionDefect',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await departure(ctx, driver, true);
      const [defect] = body(await manager.get(`${ctx.alta}/fleet/defects`)).items ?? [];
      const r = await manager.post(
        `${ctx.alta}/fleet/defects/${defect?.id ?? ''}/decision`,
        { decision: 'confirm_out_of_service', comment: 'Трещина в зоне обзора' },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({ state: 'confirmed_out_of_service' });
      const plan = body(await driver.get(planUrl(ctx)));
      expect(plan.state).toBe('planned');
      expect(plan).not.toHaveProperty('vehicleId');
      const v = body(await manager.get(`${ctx.alta}/fleet/vehicles`)).items?.find(
        (x) => x.id === ctx.A('v1'),
      );
      expect(v).toMatchObject({ status: 'maintenance', statusNote: 'неисправность подтверждена' });
    },
  },
  {
    title: 'повторное решение — 409 invalid_transition («Дефект уже решён»)',
    operationId: 'decideInspectionDefect',
    expect: 'error',
    example: 'decideInspectionDefect/invalid_transition',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await departure(ctx, driver, true);
      const [defect] = body(await manager.get(`${ctx.alta}/fleet/defects`)).items ?? [];
      const url = `${ctx.alta}/fleet/defects/${defect?.id ?? ''}/decision`;
      await manager.post(url, { decision: 'allow_departure' }, { ifMatch: 1 });
      ctx.expectExample(
        await manager.post(url, { decision: 'confirm_out_of_service' }, { ifMatch: 2 }),
        'decideInspectionDefect/invalid_transition',
      );
    },
  },
  {
    title: 'с открытым блокирующим дефектом старт рейса — 409 blocking_defect_open',
    operationId: 'startTrip',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const d = await departure(ctx, driver, true);
      const r = await driver.post(`${ctx.alta}/fleet/trips`, {
        reservationId: d.reservationId,
        departureInspectionId: d.inspectionId,
      });
      ctx.expectProblem(r, 'blocking_defect_open');
    },
  },

  // Машины, бронь, осмотры, старт.
  {
    title: 'водитель видит машины своей фирмы: кузов «Тент», склад, «Плановое ТО до 03.10»',
    operationId: 'listVehicles',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const items = body(await driver.get(`${ctx.alta}/fleet/vehicles`)).items ?? [];
      expect(items.map((v) => v.id)).toEqual(['v1', 'v6', 'v2', 'v3', 'v4'].map(ctx.A));
      expect(items[0]).toMatchObject({
        displayName: 'ГАЗель Next',
        registrationNumber: 'А 412 МР 77',
        bodyType: 'tent',
        status: 'available',
        depot: 'Склад № 1',
        odometerKm: '84370',
      });
      expect(items[4]).toMatchObject({ status: 'maintenance', statusNote: 'Плановое ТО до 03.10' });
      const free = await driver.get(
        `${ctx.alta}/fleet/vehicles?availableFrom=${W208.startsAt}&availableUntil=${W208.endsAt}`,
      );
      expect(body(free).items?.map((v) => v.id)).not.toContain(ctx.A('v4'));
    },
  },
  {
    title: 'одна граница интервала доступности — 422',
    operationId: 'listVehicles',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await driver.get(`${ctx.alta}/fleet/vehicles?availableFrom=${W208.startsAt}`);
      ctx.expectProblem(r, 'validation_failed');
    },
  },
  {
    title:
      'водитель бронирует ГАЗель на Р-208: бронь подтверждена сервером, рейс «Осмотр перед выездом»',
    operationId: 'reserveVehicle',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await reserve(ctx, driver);
      expect(r.status).toBe(201);
      expect(body(r)).toMatchObject({
        state: 'held',
        tripId: ctx.A('Р-208'),
        holdExpiresAt: '2026-10-01T08:00:00Z',
      });
      expect(body(await driver.get(planUrl(ctx)))).toMatchObject({
        state: 'inspection',
        vehicleId: ctx.A('v1'),
        reservationId: body(r).id,
      });
    },
  },
  {
    title: 'неподходящая машина — 409 vehicle_incompatible; занятая — 409 reservation_overlap',
    operationId: 'reserveVehicle',
    expect: 'error',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const r = await reserve(ctx, driver, 'v3');
      ctx.expectProblem(r, 'vehicle_incompatible');
      expect(body(r).detail).toBe(
        'Машина не подходит рейсу: Грузоподъёмность: 0,9 т, нужно от 1,1 т; Объём: 9 м³, нужно от 12 м³',
      );
      // Mercedes Sprinter подходит Р-208, но держится за другим рейсом (Р-212 логиста).
      const r212 = body(
        await manager.post(`${ctx.alta}/fleet/trip-plans`, {
          orgUnitId: ctx.A('f-msk-sever'),
          title: 'Возврат тары',
          plannedWindow: W208,
          cargo: { description: 'Пустые паллеты', weightKg: '300', volumeM3: '8', lengthM: '2.4' },
          stops: [
            {
              sequence: 1,
              op: 'load',
              address: 'Склад № 1, Лобня',
              weightKg: '300',
              volumeM3: '8',
            },
          ],
        }),
      );
      await manager.put(
        `${ctx.alta}/fleet/trips/${r212.id ?? ''}/vehicle`,
        { vehicleId: ctx.A('v6') },
        { ifMatch: 1 },
      );
      ctx.expectProblem(await reserve(ctx, driver, 'v6'), 'reservation_overlap');
    },
  },
  {
    title: '«Отменить бронь» — менеджер снимает бронь: машина в пуле, рейс «Запланирован»',
    operationId: 'releaseReservation',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const res = body(await reserve(ctx, driver));
      const url = `${ctx.alta}/fleet/reservations/${res.id ?? ''}`;
      // Шаблон «Водитель» каталога прав (api/permissions.yaml) не содержит fleet.reservations.manage:
      // снять бронь водитель не может (вопрос W2.00 — расхождение с кнопкой эталона).
      ctx.expectProblem(
        await driver.patch(url, { action: 'release' }, { ifMatch: 1 }),
        'forbidden_action',
      );
      const r = await manager.patch(url, { action: 'release' }, { ifMatch: 1 });
      expect(body(r)).toMatchObject({ state: 'released', revision: 2 });
      expect(body(await driver.get(planUrl(ctx))).state).toBe('planned');
    },
  },
  {
    title: 'повторная отмена — 409 invalid_transition',
    operationId: 'releaseReservation',
    expect: 'error',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const res = body(await reserve(ctx, driver));
      const url = `${ctx.alta}/fleet/reservations/${res.id ?? ''}`;
      await manager.patch(url, { action: 'release' }, { ifMatch: 1 });
      ctx.expectProblem(
        await manager.patch(url, { action: 'release' }, { ifMatch: 2 }),
        'invalid_transition',
      );
    },
  },
  {
    title: 'чек-лист выезда: три пункта эталона и пять ракурсов',
    operationId: 'getInspectionChecklist',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = body(
        await driver.get(
          `${ctx.alta}/fleet/inspection-checklist?vehicleId=${ctx.A('v1')}&kind=departure`,
        ),
      );
      expect(r.items?.map((i) => i.label)).toEqual([
        'Кузов и стёкла осмотрены',
        'Шины и световые приборы исправны',
        'Документы и комплект на месте',
      ]);
      expect(r.requiredPhotoRoles).toEqual([...ROLES]);
    },
  },
  {
    title: 'чек-лист чужой машины — 404',
    operationId: 'getInspectionChecklist',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const r = await driver.get(
        `${ctx.alta}/fleet/inspection-checklist?vehicleId=${ctx.A('v5')}&kind=departure`,
      );
      ctx.expectProblem(r, 'not_found');
    },
  },
  {
    title: 'осмотр выезда с пятью готовыми фото принят сервером',
    operationId: 'submitInspection',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const d = await departure(ctx, driver);
      const r = await driver.get(`${ctx.alta}/fleet/inspections/${d.inspectionId}`);
      expect(body(r)).toMatchObject({
        status: 'submitted',
        kind: 'departure',
        tripId: ctx.A('Р-208'),
        attempt: 1,
        defects: [],
      });
      expect(body(await driver.get(planUrl(ctx))).departureInspectionId).toBe(d.inspectionId);
    },
  },
  {
    title:
      'фото не загружено — 409 photo_not_ready; пробег меньше начального — 422 odometer_decrease',
    operationId: 'submitInspection',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const res = body(await reserve(ctx, driver));
      const list = body(
        await driver.get(
          `${ctx.alta}/fleet/inspection-checklist?vehicleId=${ctx.A('v1')}&kind=departure`,
        ),
      );
      const files = [...readyFiles(ctx, 'dep', 4), ...readyFiles(ctx, 'dep', 1, 'quarantined')];
      const payload = {
        checklistVersionId: list.versionId,
        vehicleId: ctx.A('v1'),
        reservationId: res.id,
        kind: 'departure',
        odometerKm: '84500',
        fuelPercent: 50,
        checks: (list.items ?? []).map((i) => ({ key: i.key, result: 'pass' })),
        photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: NOW })),
        capturedAt: NOW,
      };
      const notReady = await driver.post(`${ctx.alta}/fleet/inspections`, payload);
      ctx.expectProblem(notReady, 'photo_not_ready');
      expect(body(notReady).detail).toBe('Не все фото загружены на сервер');
      const ok = readyFiles(ctx, 'dep', 5);
      const low = await driver.post(`${ctx.alta}/fleet/inspections`, {
        ...payload,
        odometerKm: '84000',
        photos: ROLES.map((role, i) => ({ role, fileId: ok[i], capturedAt: NOW })),
      });
      ctx.expectProblem(low, 'odometer_decrease');
      // int() эталона: toLocaleString('ru-RU') — разделитель групп U+00A0.
      expect(body(low).detail).toBe('Пробег не может быть меньше 84 370 км');
    },
  },
  {
    title: 'менеджер открывает осмотр смены',
    operationId: 'getInspection',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const d = await departure(ctx, driver);
      const r = await manager.get(`${ctx.alta}/fleet/inspections/${d.inspectionId}`);
      expect(body(r)).toMatchObject({ id: d.inspectionId, memberId: ctx.A('m-vasiliev') });
    },
  },
  {
    title: 'несуществующий осмотр — 404',
    operationId: 'getInspection',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectProblem(
        await manager.get(`${ctx.alta}/fleet/inspections/${ctx.A('insp-missing')}`),
        'not_found',
      );
    },
  },
  {
    title: '«Выехать на маршрут»: бронь потреблена, рейс «В рейсе»',
    operationId: 'startTrip',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      const d = await onRoute(ctx, driver);
      expect(d.trip).toMatchObject({
        status: 'in_progress',
        startedAt: NOW,
        vehicleId: ctx.A('v1'),
      });
      expect(body(await driver.get(planUrl(ctx))).state).toBe('on_route');
      const res = body(await driver.get(`${ctx.alta}/fleet/reservations/${d.reservationId}`));
      expect(res.state).toBe('consumed');
    },
  },

  // Расходы, сдача, приёмка.
  {
    title: 'расход «Топливо 2 500 ₽» с чеком принят сервером',
    operationId: 'createTripExpense',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      await onRoute(ctx, driver);
      const r = await expense(ctx, driver);
      expect(r.status).toBe(201);
      expect(body(r)).toMatchObject({
        kind: 'fuel',
        reviewState: 'pending',
        comment: 'АЗС на Ленинградском шоссе',
      });
    },
  },
  {
    title: 'нулевая сумма — 422 amount_invalid «Сумма должна быть больше нуля»; без чека — 422',
    operationId: 'createTripExpense',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      await onRoute(ctx, driver);
      const [receipt] = readyFiles(ctx, 'receipt', 1);
      const zero = await driver.post(`${tripUrl(ctx)}/expenses`, {
        kind: 'wash',
        occurredAt: NOW,
        amount: { amountMinor: 0, currency: 'RUB' },
        receiptFileIds: [receipt],
      });
      ctx.expectProblem(zero, 'amount_invalid');
      expect(body(zero).detail).toBe('Сумма должна быть больше нуля');
      const noReceipt = await driver.post(`${tripUrl(ctx)}/expenses`, {
        kind: 'wash',
        occurredAt: NOW,
        amount: { amountMinor: 40000, currency: 'RUB' },
        receiptFileIds: [],
      });
      ctx.expectProblem(noReceipt, 'validation_failed');
    },
  },
  // W2.40 (0.5.1-stage2): категории по ответу владельца 17.10 на D-12 комплекта — шесть кодов, у «прочее»
  // комментарий обязателен (422 validation_failed, поле comment).
  {
    title:
      'расход «Шиномонтаж и мелкий ремонт» (tire_service) принят; «Прочее» с комментарием — тоже',
    operationId: 'createTripExpense',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      await onRoute(ctx, driver);
      for (const [kind, comment] of [
        ['tire_service', undefined],
        ['other', 'Ремень генератора'],
      ] as const) {
        const [receipt] = readyFiles(ctx, 'receipt', 1);
        const r = await driver.post(`${tripUrl(ctx)}/expenses`, {
          kind,
          occurredAt: NOW,
          amount: { amountMinor: 180000, currency: 'RUB' },
          receiptFileIds: [receipt],
          ...(comment ? { comment } : {}),
        });
        expect(r.status, kind).toBe(201);
        expect(body(r)).toMatchObject({ kind, reviewState: 'pending' });
      }
    },
  },
  {
    title: '«Прочее» без комментария — 422 validation_failed с полем comment',
    operationId: 'createTripExpense',
    expect: 'error',
    example: 'createTripExpense/validation_failed',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      await onRoute(ctx, driver);
      const [receipt] = readyFiles(ctx, 'receipt', 1);
      const other = (comment?: string) =>
        driver.post(`${tripUrl(ctx)}/expenses`, {
          kind: 'other',
          occurredAt: NOW,
          amount: { amountMinor: 50000, currency: 'RUB' },
          receiptFileIds: [receipt],
          ...(comment === undefined ? {} : { comment }),
        });
      ctx.expectExample(await other(), 'createTripExpense/validation_failed');
      const blank = await other('   ');
      ctx.expectProblem(blank, 'validation_failed');
      expect(body(blank).violations).toEqual([
        {
          field: 'comment',
          code: 'required',
          message: 'Для категории «Прочее» добавьте комментарий',
        },
      ]);
      expect(body(await driver.get(`${tripUrl(ctx)}/expenses`)).items).toHaveLength(0);
    },
  },
  {
    title: 'расходы смены видят водитель и менеджер',
    operationId: 'listTripExpenses',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await onRoute(ctx, driver);
      await expense(ctx, driver);
      for (const s of [driver, manager]) {
        expect(body(await s.get(`${tripUrl(ctx)}/expenses`)).items).toHaveLength(1);
      }
    },
  },
  {
    title: 'расходы чужого рейса водителю — 404',
    operationId: 'listTripExpenses',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectProblem(await driver.get(`${tripUrl(ctx, 'Р-211')}/expenses`), 'not_found');
    },
  },
  {
    title: '«Сдать машину»: смена «Ожидает приёмки», машина «Проверяется»',
    operationId: 'returnTrip',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      const s = await submitted(ctx, driver);
      expect(body(s.reply)).toMatchObject({ status: 'returned_pending_review', returnedAt: NOW });
      expect(body(await driver.get(planUrl(ctx)))).toMatchObject({
        state: 'submitted',
        returnInspectionId: s.returnInspectionId,
      });
      const v = body(await manager.get(`${ctx.alta}/fleet/vehicles`)).items?.find(
        (x) => x.id === ctx.A('v1'),
      );
      expect(v?.status).toBe('blocked');
    },
  },
  {
    title: 'сдача до «Завершить рейс» — 409 invalid_transition',
    operationId: 'returnTrip',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      await onRoute(ctx, driver);
      const r = await driver.patch(
        tripUrl(ctx),
        { action: 'return', returnInspectionId: ctx.A('insp-missing') },
        { ifMatch: 4 },
      );
      ctx.expectProblem(r, 'invalid_transition');
    },
  },
  {
    title: '«Вернуть на доработку» с разделами; повторная сдача — снова «Ожидает приёмки»',
    operationId: 'reviewTrip',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await submitted(ctx, driver);
      const r = await manager.post(
        `${tripUrl(ctx)}/review`,
        {
          decision: 'rework',
          comment: 'Переснимите фото слева — не виден бампер',
          steps: ['photos'],
        },
        { ifMatch: 7 },
      );
      expect(body(r).status).toBe('in_progress');
      const plan = body(await driver.get(planUrl(ctx)));
      expect(plan).toMatchObject({
        state: 'rework',
        lastReview: { decision: 'rework', steps: ['photos'], attempt: 1 },
      });
      const ret = body(await inspect(ctx, driver, 'return', { tripId: ctx.A('Р-208') }));
      expect(ret.attempt).toBe(2);
      const again = await driver.patch(
        tripUrl(ctx),
        { action: 'return', returnInspectionId: ret.id },
        { ifMatch: 9 },
      );
      expect(body(again).status).toBe('returned_pending_review');
    },
  },
  {
    title: '«Принять смену»: машина свободна, пробег обновлён, начисление создано',
    operationId: 'reviewTrip',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await submitted(ctx, driver);
      const r = await manager.post(
        `${tripUrl(ctx)}/review`,
        { decision: 'approve' },
        { ifMatch: 7 },
      );
      expect(body(r).status).toBe('approved');
      const v = body(await manager.get(`${ctx.alta}/fleet/vehicles`)).items?.find(
        (x) => x.id === ctx.A('v1'),
      );
      expect(v).toMatchObject({ status: 'available', odometerKm: '84560' });
      expect(body(await driver.get(planUrl(ctx))).state).toBe('accepted');
      const earn = await manager.get(`${tripUrl(ctx)}/earnings`);
      expect(body(earn)).toMatchObject({ amount: { amountMinor: 450000, currency: 'RUB' } });
    },
  },
  {
    title: 'доработка без замечаний и разделов — 422 с текстами эталона; повторная приёмка — 409',
    operationId: 'reviewTrip',
    expect: 'error',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await submitted(ctx, driver);
      const bad = await manager.post(
        `${tripUrl(ctx)}/review`,
        { decision: 'rework' },
        { ifMatch: 7 },
      );
      ctx.expectProblem(bad, 'validation_failed');
      expect(body(bad).violations).toEqual([
        { field: 'comment', code: 'required', message: 'Опишите, что нужно исправить' },
        { field: 'steps', code: 'required', message: 'Отметьте хотя бы один раздел для доработки' },
      ]);
      await manager.post(`${tripUrl(ctx)}/review`, { decision: 'approve' }, { ifMatch: 7 });
      const twice = await manager.post(
        `${tripUrl(ctx)}/review`,
        { decision: 'approve' },
        { ifMatch: 8 },
      );
      ctx.expectProblem(twice, 'invalid_transition');
      expect(body(twice).detail).toBe('Смена уже обработана');
    },
  },
  {
    title: 'менеджер подтверждает расход',
    operationId: 'reviewTripExpense',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await onRoute(ctx, driver);
      const x = body(await expense(ctx, driver));
      const r = await manager.post(
        `${tripUrl(ctx)}/expenses/${x.id ?? ''}/review`,
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({ reviewState: 'approved', revision: 2 });
    },
  },
  {
    title: 'водитель не проверяет расходы — 403; повторная проверка — 409',
    operationId: 'reviewTripExpense',
    expect: 'error',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await onRoute(ctx, driver);
      const x = body(await expense(ctx, driver));
      const url = `${tripUrl(ctx)}/expenses/${x.id ?? ''}/review`;
      ctx.expectProblem(
        await driver.post(url, { decision: 'approve' }, { ifMatch: 1 }),
        'forbidden_action',
      );
      await manager.post(url, { decision: 'reject', comment: 'Чек нечитаем' }, { ifMatch: 1 });
      ctx.expectProblem(
        await manager.post(url, { decision: 'approve' }, { ifMatch: 2 }),
        'invalid_transition',
      );
    },
  },

  // Начисления (S2-12, AC-05).
  {
    title: 'принятая смена Р-208 — начисление 4 500 ₽ в списке менеджера',
    operationId: 'listTripEarnings',
    expect: 'success',
    example: 'listTripEarnings/ok',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await submitted(ctx, driver);
      await manager.post(`${tripUrl(ctx)}/review`, { decision: 'approve' }, { ifMatch: 7 });
      ctx.expectExample(await manager.get(`${ctx.alta}/fleet/earnings`), 'listTripEarnings/ok');
    },
  },
  {
    title: 'водителю начисления закрыты — 403',
    operationId: 'listTripEarnings',
    expect: 'error',
    example: 'listTripEarnings/forbidden_action',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(
        await driver.get(`${ctx.alta}/fleet/earnings`),
        'listTripEarnings/forbidden_action',
      );
    },
  },
  {
    title: 'начисление по рейсу видит менеджер с правом fleet.earnings.read',
    operationId: 'getTripEarnings',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await submitted(ctx, driver);
      await manager.post(`${tripUrl(ctx)}/review`, { decision: 'approve' }, { ifMatch: 7 });
      const r = await manager.get(`${tripUrl(ctx)}/earnings`);
      expect(body(r)).toMatchObject({
        tripId: ctx.A('Р-208'),
        driverMemberId: ctx.A('m-vasiliev'),
      });
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'водителю начисление своего рейса закрыто; до приёмки начисления нет — 404',
    operationId: 'getTripEarnings',
    expect: 'error',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      ctx.expectProblem(await driver.get(`${tripUrl(ctx)}/earnings`), 'forbidden_action');
      ctx.expectProblem(await manager.get(`${tripUrl(ctx)}/earnings`), 'not_found');
    },
  },
  {
    title: 'владелец исправляет начисление',
    operationId: 'setTripEarnings',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await submitted(ctx, driver);
      await manager.post(`${tripUrl(ctx)}/review`, { decision: 'approve' }, { ifMatch: 7 });
      const owner = await ctx.as('owner');
      const r = await owner.put(
        `${tripUrl(ctx)}/earnings`,
        { amount: { amountMinor: 480000, currency: 'RUB' }, calculationNote: 'Доплата за простой' },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({ amount: { amountMinor: 480000 }, revision: 2 });
    },
  },
  {
    title: 'менеджеру без fleet.earnings.manage правка начисления закрыта — 403',
    operationId: 'setTripEarnings',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = await manager.put(
        `${tripUrl(ctx)}/earnings`,
        { amount: { amountMinor: 480000, currency: 'RUB' } },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'forbidden_action');
    },
  },

  // Пул водителей (S2-14).
  {
    title: 'свободные водители пула на окно рейса Р-211',
    operationId: 'listAvailableDrivers',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = body(
        await manager.get(
          `${ctx.alta}/fleet/driver-pool?availableFrom=2026-10-01T11:00:00Z&availableUntil=2026-10-01T15:00:00Z`,
        ),
      );
      expect(r.items?.map((d) => (d as unknown as { displayName: string }).displayName)).toEqual([
        'Водитель #104',
        'Водитель #117',
      ]);
      expect(r.items?.[0]).toMatchObject({
        qualifications: ['Кат. C', 'рефрижератор'],
        terms: 'По соглашению фирм группы',
      });
    },
  },
  {
    title: 'без интервала — 400',
    operationId: 'listAvailableDrivers',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectProblem(await manager.get(`${ctx.alta}/fleet/driver-pool`), 'malformed_request');
    },
  },
  {
    title: '«Запросить на рейс Р-211» Водителя #104 из «Юг Транс»',
    operationId: 'requestDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const r = await manager.post(`${ctx.alta}/fleet/driver-transfer-requests`, {
        driverMemberId: ctx.A('d-104'),
        sourceOrgUnitId: ctx.A('f-msk-yug'),
        targetOrgUnitId: ctx.A('f-msk-sever'),
        window: { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK },
        reason: 'Запрос на рейс Р-211',
        tripId: ctx.A('Р-211'),
      });
      expect(r.status).toBe(201);
      expect(body(r)).toMatchObject({ status: 'requested', tripId: ctx.A('Р-211') });
    },
  },
  {
    title: 'повторный запрос — 409 «Запрос уже отправлен»',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const req = {
        driverMemberId: ctx.A('d-104'),
        sourceOrgUnitId: ctx.A('f-msk-yug'),
        targetOrgUnitId: ctx.A('f-msk-sever'),
        window: { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK },
        reason: 'Запрос на рейс Р-211',
        tripId: ctx.A('Р-211'),
      };
      await manager.post(`${ctx.alta}/fleet/driver-transfer-requests`, req);
      const r = await manager.post(`${ctx.alta}/fleet/driver-transfer-requests`, req);
      ctx.expectProblem(r, 'invalid_transition');
      expect(body(r).detail).toBe('Запрос уже отправлен');
    },
  },
  {
    title: 'запросы пула видит логист фирмы-получателя',
    operationId: 'listDriverTransfers',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      await manager.post(`${ctx.alta}/fleet/driver-transfer-requests`, {
        driverMemberId: ctx.A('d-117'),
        sourceOrgUnitId: ctx.A('f-msk-vostok'),
        targetOrgUnitId: ctx.A('f-msk-sever'),
        window: { startsAt: '2026-10-01T12:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK },
        reason: 'Запрос на рейс Р-211',
      });
      expect(
        body(await manager.get(`${ctx.alta}/fleet/driver-transfer-requests`)).items,
      ).toHaveLength(1);
    },
  },
  {
    title: 'водителю запросы пула закрыты — 403',
    operationId: 'listDriverTransfers',
    expect: 'error',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectProblem(
        await driver.get(`${ctx.alta}/fleet/driver-transfer-requests`),
        'forbidden_action',
      );
    },
  },
  {
    title: 'фирма-владелец одобряет: водитель временно назначен на рейс Р-211',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const req = body(
        await manager.post(`${ctx.alta}/fleet/driver-transfer-requests`, {
          driverMemberId: ctx.A('d-104'),
          sourceOrgUnitId: ctx.A('f-msk-yug'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window: {
            startsAt: '2026-10-01T11:00:00Z',
            endsAt: '2026-10-01T15:00:00Z',
            timeZone: MSK,
          },
          reason: 'Запрос на рейс Р-211',
          tripId: ctx.A('Р-211'),
        }),
      );
      const owner = await ctx.as('owner');
      const r = await owner.post(
        `${ctx.alta}/fleet/driver-transfer-requests/${req.id ?? ''}/decision`,
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({ status: 'approved', revision: 2 });
      expect(body(await owner.get(planUrl(ctx, 'Р-211')))).toMatchObject({
        driverMemberId: ctx.A('d-104'),
        driverDisplayName: 'Водитель #104 · временно',
      });
    },
  },
  {
    title: 'логист фирмы-получателя не решает за фирму-источник — 403',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const req = body(
        await manager.post(`${ctx.alta}/fleet/driver-transfer-requests`, {
          driverMemberId: ctx.A('d-104'),
          sourceOrgUnitId: ctx.A('f-msk-yug'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window: {
            startsAt: '2026-10-01T11:00:00Z',
            endsAt: '2026-10-01T15:00:00Z',
            timeZone: MSK,
          },
          reason: 'Запрос на рейс Р-211',
        }),
      );
      const r = await manager.post(
        `${ctx.alta}/fleet/driver-transfer-requests/${req.id ?? ''}/decision`,
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'forbidden_action');
    },
  },

  // «Требует решения» (S2-18).
  {
    title: 'владелец «Альты» без логистики: пробный период и сотрудники без роли',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    example: 'getMyDecisionQueue/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}`),
        'getMyDecisionQueue/ok',
      );
    },
  },
  {
    title: 'логист с «Логистикой»: рейс Р-211 без водителя',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    example: 'getMyDecisionQueue/manager',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}`),
        'getMyDecisionQueue/manager',
      );
    },
  },
  {
    title: 'блокирующий дефект — первая карточка (danger), сданная смена — warn',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager } = await ready(ctx);
      await departure(ctx, driver, true);
      const q = body(await manager.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}&limit=1`));
      // Дефект, рейс без водителя и (W4.81) срочная T-64 Котовой; источник логистики — первым среди danger.
      expect(q).toMatchObject({ total: 3 });
      expect(q.items?.[0]).toMatchObject({
        kind: 'fleet.blocking_defect',
        tone: 'danger',
        params: {
          tripNumber: 'Р-208',
          zone: 'Стёкла',
          description: 'Скол',
          driverName: 'Илья Васильев',
        },
      });
    },
  },
  {
    title: 'чужая организация — 404',
    operationId: 'getMyDecisionQueue',
    expect: 'error',
    example: 'getMyDecisionQueue/not_found',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-lotos')}`),
        'getMyDecisionQueue/not_found',
      );
    },
  },

  // W4.81 (0.11.1-stage4): задачи на «Главной» — источник задач и сводка задач (homeVM :4081–4084, :4113).
  {
    title: 'логист без роли: срочная T-64 — tasks.task_new (danger), срок 01.10',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      const q = body(await manager.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}`));
      expect(q).toMatchObject({ total: 1 });
      expect(q.items?.[0]).toMatchObject({
        key: `tasks.task_new:${ctx.A('T-64')}`,
        kind: 'tasks.task_new',
        moduleKey: 'tasks',
        tone: 'danger',
        object: { moduleKey: 'tasks', entityType: 'task', entityId: ctx.A('T-64') },
        params: {
          taskKey: 'T-64',
          title: 'Найти водителя на рейс Р-211',
          projectId: ctx.A('fleet'),
          dueAt: '2026-10-01T21:00:00Z',
        },
      });
    },
  },
  {
    title: 'задача правила формы «Осмотр машины» — fromForm у карточки исполнителя',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    run: async (ctx) => {
      ctx.server.applyPreset('logistics-ready');
      const owner = await ctx.as('owner');
      const forms = body(await owner.get(`${ctx.alta}/forms?limit=200`)) as {
        items: { id: string; name: string }[];
      };
      const form = forms.items.find((f) => f.name === 'Осмотр машины')?.id ?? '';
      const versions = body(await owner.get(`${ctx.alta}/forms/${form}/versions`)) as {
        items: { id: string; number: number }[];
      };
      const files = readyFiles(ctx, 'form', 1);
      const r = await owner.post(`${ctx.alta}/forms/${form}/responses`, {
        versionId: versions.items.find((v) => v.number === 3)?.id,
        answers: [
          { fieldKey: 'q-photos', value: { type: 'files', value: files } },
          { fieldKey: 'q-odo', value: { type: 'decimal', value: '85000' } },
          { fieldKey: 'q-fuel', value: { type: 'choices', value: ['o4'] } },
          { fieldKey: 'q-checks', value: { type: 'choices', value: ['o1', 'o2', 'o3'] } },
          { fieldKey: 'q-defect', value: { type: 'boolean', value: false } },
        ],
      });
      expect(r.status).toBe(201);
      const manager = await ctx.as('manager');
      const q = body(await manager.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}`));
      const cards = (q.items ?? []) as unknown as {
        kind: string;
        params: Record<string, string>;
      }[];
      const fromForm = cards.filter(
        (c) => c.kind === 'tasks.task_new' && c.params.fromForm === 'true',
      );
      expect(fromForm).toHaveLength(1);
      expect(fromForm[0]?.params.title).toMatch(/^Проверить осмотр/);
    },
  },
  {
    title: 'сводка задач владельца «Альты»: Новые 2, В работе 2, На проверке 2, своих новых нет',
    operationId: 'getMyTaskSummary',
    expect: 'success',
    example: 'getMyTaskSummary/ok',
    run: async (ctx) => {
      const owner = await ctx.as('owner');
      ctx.expectExample(
        await owner.get(`/api/v1/me/task-summary?tenantId=${ctx.P('t-alta')}`),
        'getMyTaskSummary/ok',
      );
    },
  },
  {
    title: 'сводка задач логиста: Новые 1, В работе 2, На проверке 2, бейдж 1',
    operationId: 'getMyTaskSummary',
    expect: 'success',
    example: 'getMyTaskSummary/manager',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(`/api/v1/me/task-summary?tenantId=${ctx.P('t-alta')}`),
        'getMyTaskSummary/manager',
      );
    },
  },
  {
    title: 'сводка задач чужой организации — 404',
    operationId: 'getMyTaskSummary',
    expect: 'error',
    example: 'getMyTaskSummary/not_found',
    run: async (ctx) => {
      const manager = await ctx.as('manager');
      ctx.expectExample(
        await manager.get(`/api/v1/me/task-summary?tenantId=${ctx.P('t-lotos')}`),
        'getMyTaskSummary/not_found',
      );
    },
  },
]);
