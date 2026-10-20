// Кейсы контрактной дельты W2.71 (0.6.3-stage2): S2-20 «Машина для временного водителя» — решение владельца 19.10
// по Q-W2.32-1 (design/docs/29-temporary-driver-vehicle.md, макеты 1a–1g). Сюжет на сиде логистики 14.10: Котова
// («Север Логистик») публикует Илью Васильева в пул с обычной машиной Mercedes Sprinter (v6); владелец запрашивает его
// на рейс «Юг Транс» 14:00–18:00 с машиной: «Ставим нашу машину» Isuzu Elf (v5) + «Можно взять свою обычную»;
// Котова одобряет с машиной — две брони до 13:30; Васильев выбирает Sprinter, бронь Isuzu снимается. Примеры —
// tools/gen/examples-w271.mjs; срок выбора, «Только водителя», «Требует решения», «Оставить …», свой водитель.
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const MSK = 'Europe/Moscow';
/** Окно рейса «Юг Транс» — 14:00–18:00 по Москве; срок выбора — 13:30 (TD-02). */
const W = { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK };
const CHOOSE_UNTIL = '2026-10-01T10:30:00Z';

type Body = Record<string, unknown> & {
  id?: string;
  revision?: number;
  state?: string;
  items?: Body[];
  vehicle?: Record<string, unknown> & {
    hostVehicle?: Record<string, unknown>;
    homeVehicle?: Record<string, unknown>;
  };
  chosen?: Body;
  released?: Body[];
};
const body = (r: Reply): Body => r.body as Body;

const transfers = (ctx: CaseContext) => `${ctx.alta}/fleet/driver-transfer-requests`;
const reservations = (ctx: CaseContext) => `${ctx.alta}/fleet/reservations`;
const choose = (ctx: CaseContext, id: unknown) => `${reservations(ctx)}/${String(id)}/choose`;

async function ready(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  return {
    driver: await ctx.as('driver'),
    manager: await ctx.as('manager'),
    owner: await ctx.as('owner'),
  };
}

/** Котова публикует Илью Васильева на 14:00–18:00 с обычной машиной (по умолчанию — Mercedes Sprinter v6). */
const publish = (ctx: CaseContext, who: Session, usual: string | null = ctx.A('v6')) =>
  who.post(`${ctx.alta}/fleet/driver-pool/publications`, {
    driverMemberId: ctx.A('m-vasiliev'),
    homeOrgUnitId: ctx.A('f-msk-sever'),
    freeWindow: W,
    qualifications: ['Кат. B'],
    terms: 'По соглашению фирм группы',
    ...(usual ? { usualVehicleId: usual } : {}),
  });

/** Рейс «Юг Транс» на 14:00–18:00 (создаёт владелец): сухой груз 0,5 т, 6 м³, 2 м. */
async function yugTrip(ctx: CaseContext, owner: Session): Promise<Body> {
  const r = await owner.post(`${ctx.alta}/fleet/trip-plans`, {
    orgUnitId: ctx.A('f-msk-yug'),
    title: 'Сборный груз',
    plannedWindow: W,
    distanceKm: '35',
    cargo: {
      description: 'Сухой груз · 6 паллет-мест',
      weightKg: '500',
      volumeM3: '6',
      lengthM: '2',
    },
    stops: [
      {
        sequence: 1,
        op: 'load',
        address: 'Склад № 1, Лобня',
        plannedAt: '2026-10-01T11:00:00Z',
        weightKg: '500',
        volumeM3: '6',
      },
      {
        sequence: 2,
        op: 'unload',
        address: 'Химки, ул. Заводская, 8',
        plannedAt: '2026-10-01T12:30:00Z',
        weightKg: '500',
        volumeM3: '6',
      },
    ],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return body(r);
}

/** Владелец запрашивает Васильева на рейс «Юг Транс» с машиной `vehicle` (по умолчанию — Isuzu Elf + обычная). */
const request = (
  ctx: CaseContext,
  owner: Session,
  trip: Body,
  vehicle: Record<string, unknown> | null = { mode: 'host_or_home', hostVehicleId: ctx.A('v5') },
) =>
  owner.post(transfers(ctx), {
    driverMemberId: ctx.A('m-vasiliev'),
    sourceOrgUnitId: ctx.A('f-msk-sever'),
    targetOrgUnitId: ctx.A('f-msk-yug'),
    window: W,
    reason: `Запрос на рейс ${String(trip.number)}`,
    tripId: trip.id,
    ...(vehicle ? { vehicle } : {}),
  });

/** Публикация, рейс и запрос с машиной `vehicle`; без `decision` — до решения. */
async function offered(
  ctx: CaseContext,
  vehicle: Record<string, unknown> | null = { mode: 'host_or_home', hostVehicleId: ctx.A('v5') },
  decision: string | null = 'approve',
) {
  const s = await ready(ctx);
  expect((await publish(ctx, s.manager)).status).toBe(201);
  const trip = await yugTrip(ctx, s.owner);
  const req = await request(ctx, s.owner, trip, vehicle);
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  if (!decision) return { ...s, trip, transfer: body(req) };
  const decided = await s.manager.post(
    `${transfers(ctx)}/${String(body(req).id)}/decision`,
    { decision },
    { ifMatch: 1 },
  );
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  return { ...s, trip, transfer: body(decided) };
}

/** Брони водителя на рейс: по виду машины предложения. */
async function offers(ctx: CaseContext, who: Session, tripId: unknown) {
  const list = (body(await who.get(reservations(ctx))).items ?? []).filter(
    (r) => r.tripId === tripId,
  );
  return {
    host: list.find((r) => r.offerKind === 'host'),
    usual: list.find((r) => r.offerKind === 'usual'),
    all: list,
  };
}

const vehicleIds = async (ctx: CaseContext, who: Session) =>
  (body(await who.get(`${ctx.alta}/fleet/vehicles`)).items ?? []).map((v) => v.id);

const queue = async (ctx: CaseContext, who: Session) =>
  (
    body(await who.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}&limit=50`)).items ?? []
  ).map((i) => i.kind);

export const vehicleOfferCases = cases('vehicle-offer')([
  // Публикация с обычной машиной (правило 1, TD-01).
  {
    title: 'Котова публикует Васильева с обычной машиной Mercedes Sprinter',
    operationId: 'publishDriverToPool',
    expect: 'success',
    example: 'publishDriverToPool/usual_vehicle',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(await publish(ctx, manager), 'publishDriverToPool/usual_vehicle', 201);
    },
  },
  {
    title: 'обычная машина чужой фирмы и неизвестная — одинаковый 422 (поле usualVehicleId)',
    operationId: 'publishDriverToPool',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const foreign = await publish(ctx, manager, ctx.A('v5'));
      ctx.expectProblem(foreign, 'validation_failed');
      const unknown = await publish(ctx, manager, ctx.A('v-nowhere'));
      ctx.expectProblem(unknown, 'validation_failed');
      expect(body(foreign).violations).toEqual(body(unknown).violations);
      expect(body(foreign).violations).toEqual([
        { field: 'usualVehicleId', code: 'vehicle', message: 'Нужна машина фирмы водителя' },
      ]);
    },
  },

  // Каталог: обычная машина и её совместимость с рейсом (правило 2).
  {
    title: 'каталог для рейса: обычная машина водителя, совместимость и свободна на окно',
    operationId: 'listAvailableDrivers',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await publish(ctx, manager);
      const trip = await yugTrip(ctx, owner);
      const q = `availableFrom=${W.startsAt}&availableUntil=${W.endsAt}`;
      const items = body(
        await owner.get(`${ctx.alta}/fleet/driver-pool?${q}&tripId=${String(trip.id)}`),
      ).items;
      const card = items?.find((x) => x.driverMemberId === ctx.A('m-vasiliev'));
      expect(card?.usualVehicle).toMatchObject({
        vehicleId: ctx.A('v6'),
        displayName: 'Mercedes Sprinter',
        registrationNumber: 'Т 771 ЕХ 77',
        bodyType: 'van',
        fit: { ok: true, reasons: [] },
        freeForWindow: true,
      });
      const plain = body(await owner.get(`${ctx.alta}/fleet/driver-pool?${q}`)).items;
      const without = plain?.find((x) => x.driverMemberId === ctx.A('m-vasiliev'))?.usualVehicle as
        Record<string, unknown> | undefined;
      expect(without?.fit).toBeUndefined();
      expect(items?.find((x) => x.driverMemberId === ctx.A('d-104'))?.usualVehicle).toBeUndefined();
      ctx.expectProblem(
        await owner.get(`${ctx.alta}/fleet/driver-pool?${q}&tripId=${ctx.A('v5')}`),
        'not_found',
      );
    },
  },

  // Запрос с машиной (1a).
  {
    title:
      'запрос с машиной: «Ставим нашу машину» Isuzu Elf + «Можно взять свою обычную» — без броней',
    operationId: 'requestDriverTransfer',
    expect: 'success',
    example: 'requestDriverTransfer/vehicle',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await publish(ctx, manager);
      const trip = await yugTrip(ctx, owner);
      ctx.expectExample(await request(ctx, owner, trip), 'requestDriverTransfer/vehicle', 201);
      expect((body(await owner.get(reservations(ctx))).items ?? []).length).toBe(0);
    },
  },
  {
    title: 'машина без охлаждения на рейс +2…+6 °C — 409 vehicle_incompatible с причинами',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    example: 'requestDriverTransfer/vehicle_incompatible',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.post(transfers(ctx), {
          driverMemberId: ctx.A('d-104'),
          sourceOrgUnitId: ctx.A('f-msk-yug'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window: W,
          reason: 'Запрос на рейс Р-211',
          tripId: ctx.A('Р-211'),
          vehicle: { mode: 'host', hostVehicleId: ctx.A('v1') },
        }),
        'requestDriverTransfer/vehicle_incompatible',
      );
    },
  },
  {
    title:
      'режим машины: без обычной — 422 vehicle.mode; host без машины и home с машиной — 422; чужая машина — 404',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await publish(ctx, manager, null);
      const trip = await yugTrip(ctx, owner);
      const field = async (r: Promise<Reply>, f: string, code: string) => {
        const got = await r;
        ctx.expectProblem(got, 'validation_failed');
        expect((body(got).violations as { field: string; code: string }[])[0]).toMatchObject({
          field: f,
          code,
        });
      };
      await field(request(ctx, owner, trip, { mode: 'home' }), 'vehicle.mode', 'usual_vehicle');
      await field(request(ctx, owner, trip, { mode: 'host' }), 'vehicle.hostVehicleId', 'required');
      await field(
        request(ctx, owner, trip, { mode: 'home', hostVehicleId: ctx.A('v5') }),
        'vehicle.hostVehicleId',
        'home',
      );
      ctx.expectProblem(
        await request(ctx, owner, trip, { mode: 'host', hostVehicleId: ctx.A('v1') }),
        'not_found',
      );
    },
  },

  // Решение фирмы водителя (1b) и брони при одобрении.
  {
    title: 'Котова одобряет с машиной: назначение и две брони до 13:30 в одной группе',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    example: 'decideDriverTransfer/approved_with_vehicle',
    run: async (ctx) => {
      const { manager, driver, transfer, trip } = await offered(ctx, undefined, null);
      ctx.expectExample(
        await manager.post(
          `${transfers(ctx)}/${String(transfer.id)}/decision`,
          { decision: 'approve' },
          { ifMatch: 1 },
        ),
        'decideDriverTransfer/approved_with_vehicle',
      );
      const o = await offers(ctx, driver, trip.id);
      expect(o.all).toHaveLength(2);
      expect(o.host).toMatchObject({
        state: 'held',
        chooseUntil: CHOOSE_UNTIL,
        holdExpiresAt: CHOOSE_UNTIL,
      });
      expect(o.usual?.offerGroupId).toBe(o.host?.offerGroupId);
    },
  },
  {
    title: '«Отклонить» без причины — 422 comment; с причиной — rejected, броней нет',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    example: 'decideDriverTransfer/validation_failed',
    run: async (ctx) => {
      const { manager, owner, transfer } = await offered(ctx, undefined, null);
      const url = `${transfers(ctx)}/${String(transfer.id)}/decision`;
      ctx.expectExample(
        await manager.post(url, { decision: 'reject', comment: '  ' }, { ifMatch: 1 }),
        'decideDriverTransfer/validation_failed',
      );
      const rejected = await manager.post(
        url,
        { decision: 'reject', comment: 'Водитель нужен на своём рейсе' },
        { ifMatch: 1 },
      );
      expect(body(rejected)).toMatchObject({
        status: 'rejected',
        decisionComment: 'Водитель нужен на своём рейсе',
      });
      expect((body(await owner.get(reservations(ctx))).items ?? []).length).toBe(0);
    },
  },
  {
    title: '«Только водителя»: обычная не бронируется, машина фирмы рейса — сразу confirmed',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { driver, trip, transfer } = await offered(ctx, undefined, 'approve_driver_only');
      expect(transfer.vehicle).toMatchObject({ homeDecision: 'declined' });
      expect(transfer.vehicle?.chooseUntil).toBeUndefined();
      expect(transfer.vehicle?.hostVehicle).toMatchObject({ reservationState: 'confirmed' });
      expect(transfer.vehicle?.homeVehicle?.reservationId).toBeUndefined();
      const o = await offers(ctx, driver, trip.id);
      expect(o.all.map((r) => r.offerKind)).toEqual(['host']);
      expect(o.host).toMatchObject({ state: 'confirmed', holdExpiresAt: W.endsAt });
    },
  },
  {
    title: '«Только водителя» без запрошенной обычной машины — 422 decision',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, transfer } = await offered(
        ctx,
        { mode: 'host', hostVehicleId: ctx.A('v5') },
        null,
      );
      const r = await manager.post(
        `${transfers(ctx)}/${String(transfer.id)}/decision`,
        { decision: 'approve_driver_only' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'validation_failed');
      expect((body(r).violations as { field: string }[])[0]?.field).toBe('decision');
    },
  },
  {
    title:
      '«Своя машина водителя» одобрена только водителем — нет машины, рейс в «Требует решения»',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, trip } = await offered(ctx, { mode: 'home' }, 'approve_driver_only');
      expect((await offers(ctx, driver, trip.id)).all).toHaveLength(0);
      expect(await queue(ctx, owner)).toContain('fleet.trip_without_vehicle');
      // «Поставить машину»: логист назначает машину — confirmed, пункт уходит.
      const plan = body(await owner.get(`${ctx.alta}/fleet/trip-plans/${String(trip.id)}`));
      const put = await owner.put(
        `${ctx.alta}/fleet/trips/${String(trip.id)}/vehicle`,
        { vehicleId: ctx.A('v5') },
        { ifMatch: plan.revision },
      );
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect((await offers(ctx, driver, trip.id)).host).toMatchObject({ state: 'confirmed' });
      expect(await queue(ctx, owner)).not.toContain('fleet.trip_without_vehicle');
    },
  },

  // Выбор водителем (1c, 1d).
  {
    title: 'Васильев берёт свою обычную Mercedes Sprinter: бронь Isuzu Elf снимается сразу',
    operationId: 'chooseReservation',
    expect: 'success',
    example: 'chooseReservation/ok',
    run: async (ctx) => {
      const { driver, owner, trip, transfer } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      ctx.expectExample(await driver.post(choose(ctx, o.usual?.id)), 'chooseReservation/ok');
      expect(
        body(await owner.get(`${ctx.alta}/fleet/trip-plans/${String(trip.id)}`)),
      ).toMatchObject({
        state: 'assigned',
        vehicleId: ctx.A('v6'),
        reservationId: o.usual?.id,
      });
      const after = body(await owner.get(`${transfers(ctx)}/${String(transfer.id)}`));
      expect(after.vehicle?.homeVehicle).toMatchObject({ reservationState: 'confirmed' });
      expect(after.vehicle?.hostVehicle).toMatchObject({
        reservationState: 'released',
        releaseReason: 'chosen',
      });
    },
  },
  {
    title: 'второй выбор и выбор после срока — 409 offer_closed, данные не меняются',
    operationId: 'chooseReservation',
    expect: 'error',
    example: 'chooseReservation/offer_closed',
    run: async (ctx) => {
      const { driver, trip } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      expect((await driver.post(choose(ctx, o.usual?.id))).status).toBe(200);
      ctx.expectExample(
        await driver.post(choose(ctx, o.host?.id)),
        'chooseReservation/offer_closed',
      );
      expect((await offers(ctx, driver, trip.id)).usual).toMatchObject({ state: 'confirmed' });
    },
  },
  {
    title: 'бронь не предложена водителю или чужого рейса — 404, как несуществующая',
    operationId: 'chooseReservation',
    expect: 'error',
    example: 'chooseReservation/not_found',
    run: async (ctx) => {
      const { driver, manager, trip } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      ctx.expectExample(
        await driver.post(choose(ctx, ctx.A('v-nowhere'))),
        'chooseReservation/not_found',
      );
      // Котова (логист «Север Логистик») — бронь рейса «Юг Транс» вне её области: 404.
      ctx.expectProblem(await manager.post(choose(ctx, o.host?.id)), 'not_found');
    },
  },
  {
    title: 'повтор выбора с тем же Idempotency-Key — тот же 200',
    operationId: 'chooseReservation',
    expect: 'success',
    run: async (ctx) => {
      const { driver, trip } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      const key = 'choose-0001-w271-same-key';
      const first = await driver.post(choose(ctx, o.usual?.id), undefined, { idempotencyKey: key });
      const again = await driver.post(choose(ctx, o.usual?.id), undefined, { idempotencyKey: key });
      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
    },
  },
  {
    title:
      'срок выбора прошёл: машина логиста подтверждена, обычная снята (deadline), её фирме — уведомление',
    operationId: 'chooseReservation',
    expect: 'error',
    run: async (ctx) => {
      const { driver, manager, trip } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      ctx.server.setNow('2026-10-01T10:31:00Z');
      ctx.expectProblem(await driver.post(choose(ctx, o.usual?.id)), 'offer_closed');
      const after = await offers(ctx, driver, trip.id);
      expect(after.host).toMatchObject({ state: 'confirmed', chosenAt: CHOOSE_UNTIL });
      expect(after.usual).toMatchObject({
        state: 'released',
        releaseReason: 'deadline',
        releasedAt: CHOOSE_UNTIL,
      });
      const inbox = body(await manager.get(`/api/v1/me/notifications?tenantId=${ctx.P('t-alta')}`));
      expect(
        (inbox.items ?? []).some(
          (n) =>
            n.kind === 'fleet.reservation.released' &&
            String(n.title).startsWith('Машина Mercedes Sprinter Т 771 ЕХ 77 освобождена'),
        ),
      ).toBe(true);
    },
  },
  {
    title: '«Оставить Isuzu Elf» логиста фирмы рейса: обычная снята с причиной manager',
    operationId: 'chooseReservation',
    expect: 'success',
    run: async (ctx) => {
      const { driver, owner, trip } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      const r = await owner.post(choose(ctx, o.host?.id));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(body(r).chosen).toMatchObject({ state: 'confirmed', vehicleId: ctx.A('v5') });
      expect(body(r).released?.[0]).toMatchObject({ releaseReason: 'manager' });
    },
  },
  {
    title: 'за 15 минут до срока — «водитель ещё не выбрал машину» у логиста; после выбора — нет',
    operationId: 'getMyDecisionQueue',
    expect: 'success',
    run: async (ctx) => {
      const { driver, owner, trip } = await offered(ctx);
      expect(await queue(ctx, owner)).not.toContain('fleet.vehicle_choice_pending');
      ctx.server.setNow('2026-10-01T10:20:00Z');
      const items = body(
        await owner.get(`/api/v1/me/decisions?tenantId=${ctx.P('t-alta')}&limit=50`),
      ).items;
      const pending = items?.find((i) => i.kind === 'fleet.vehicle_choice_pending');
      expect(pending).toMatchObject({
        tone: 'warn',
        params: {
          chooseUntil: CHOOSE_UNTIL,
          hostVehicle: 'Isuzu Elf · К 120 РУ 77',
          homeVehicle: 'Mercedes Sprinter · Т 771 ЕХ 77',
        },
      });
      expect(await queue(ctx, owner)).not.toContain('fleet.trip_without_vehicle');
      const o = await offers(ctx, driver, trip.id);
      await driver.post(choose(ctx, o.usual?.id));
      expect(await queue(ctx, owner)).not.toContain('fleet.vehicle_choice_pending');
    },
  },

  // Временный водитель: машины, бронь, осмотр и старт.
  {
    title: 'временный водитель видит только предложенные машины; после выбора — только выбранную',
    operationId: 'listVehicles',
    expect: 'success',
    run: async (ctx) => {
      const { driver, trip } = await offered(ctx);
      const before = await vehicleIds(ctx, driver);
      expect(before).toContain(ctx.A('v5'));
      expect(before).toContain(ctx.A('v6'));
      // Других машин фирмы рейса («Юг Транс») нет; машины своей фирмы он видит по домашней роли.
      const o = await offers(ctx, driver, trip.id);
      await driver.post(choose(ctx, o.usual?.id));
      const after = await vehicleIds(ctx, driver);
      expect(after).toContain(ctx.A('v6'));
      expect(after).not.toContain(ctx.A('v5'));
    },
  },
  {
    title: 'временный водитель не бронирует на рейс перевода — 403; до выбора осмотр и старт — 409',
    operationId: 'reserveVehicle',
    expect: 'error',
    run: async (ctx) => {
      const { driver, trip } = await offered(ctx);
      ctx.expectProblem(
        await driver.post(reservations(ctx), {
          vehicleId: ctx.A('v5'),
          driverMemberId: ctx.A('m-vasiliev'),
          tripId: trip.id,
          window: W,
        }),
        'forbidden_action',
      );
      const o = await offers(ctx, driver, trip.id);
      const start = await driver.post(`${ctx.alta}/fleet/trips`, {
        reservationId: o.host?.id,
        departureInspectionId: o.host?.id,
      });
      ctx.expectProblem(start, 'invalid_transition');
      expect(body(start).detail).toBe('Сначала выберите машину.');
    },
  },
  {
    title: 'брони водителя — предложенные ему на рейс',
    operationId: 'listReservations',
    expect: 'success',
    run: async (ctx) => {
      const { driver, trip } = await offered(ctx);
      const o = await offers(ctx, driver, trip.id);
      expect(o.all.every((r) => r.offeredToMemberId === ctx.A('m-vasiliev'))).toBe(true);
    },
  },
  {
    title: 'список броней без сессии — 401',
    operationId: 'listReservations',
    expect: 'error',
    run: async (ctx) => {
      ctx.expectProblem(await ctx.anon().get(reservations(ctx)), 'session_expired');
    },
  },
  {
    title: 'перевод кончился до рейса — брони сняты (transfer_ended), машины свободны',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner, driver, trip, transfer } = await offered(ctx);
      const r = await manager.post(
        `${transfers(ctx)}/${String(transfer.id)}/decision`,
        { decision: 'revoke' },
        { ifMatch: transfer.revision },
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const list = (body(await owner.get(reservations(ctx))).items ?? []).filter(
        (x) => x.tripId === trip.id,
      );
      expect(list.map((x) => x.releaseReason)).toEqual(['transfer_ended', 'transfer_ended']);
      expect(await vehicleIds(ctx, driver)).not.toContain(ctx.A('v5'));
    },
  },

  // Свой водитель (правило 9, Q-W2.70-6): логист предлагает две машины.
  {
    title:
      'свой водитель: логист ставит ГАЗель Next и вторую Mercedes Sprinter — водитель выбирает',
    operationId: 'assignTripVehicle',
    expect: 'success',
    run: async (ctx) => {
      // Логист — владелец: назначения пресета действуют с 10:30, а сюжет начинается в 08:00.
      const { owner, driver } = await ready(ctx);
      const assign = async () => {
        const url = `${ctx.alta}/fleet/trip-plans/${ctx.A('Р-208')}`;
        const plan = body(await owner.get(url));
        const r = await owner.put(
          `${ctx.alta}/fleet/trips/${ctx.A('Р-208')}/vehicle`,
          { vehicleId: ctx.A('v1'), alternativeVehicleId: ctx.A('v6') },
          { ifMatch: plan.revision },
        );
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        return offers(ctx, driver, ctx.A('Р-208'));
      };
      // Окно Р-208 — 09:00–13:00 по Москве: в 08:00 срок выбора (08:30) не прошёл — две брони до него.
      ctx.server.setNow('2026-10-01T05:00:00Z');
      const o = await assign();
      expect(o.host).toMatchObject({ state: 'held', chooseUntil: '2026-10-01T05:30:00Z' });
      expect(o.usual).toMatchObject({ state: 'held', vehicleId: ctx.A('v6') });
      const r = await driver.post(choose(ctx, o.usual?.id));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      // Логист меняет машину после выбора (правило 8) — в 10:30 срок прошёл: сразу машина логиста.
      ctx.server.setNow('2026-10-01T07:30:00Z');
      const again = await assign();
      expect(again.all.filter((x) => x.state === 'confirmed').map((x) => x.vehicleId)).toEqual([
        ctx.A('v1'),
      ]);
    },
  },
  {
    title: 'вторая машина — та же или без водителя рейса — 422 alternativeVehicleId',
    operationId: 'assignTripVehicle',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const put = async (trip: string, vehicleId: string, alt: string) => {
        const plan = body(await manager.get(`${ctx.alta}/fleet/trip-plans/${ctx.A(trip)}`));
        return manager.put(
          `${ctx.alta}/fleet/trips/${ctx.A(trip)}/vehicle`,
          { vehicleId: ctx.A(vehicleId), alternativeVehicleId: ctx.A(alt) },
          { ifMatch: plan.revision },
        );
      };
      const same = await put('Р-208', 'v1', 'v1');
      ctx.expectProblem(same, 'validation_failed');
      expect((body(same).violations as { code: string }[])[0]?.code).toBe('same');
      const noDriver = await put('Р-211', 'v2', 'v6');
      ctx.expectProblem(noDriver, 'validation_failed');
      expect((body(noDriver).violations as { code: string }[])[0]?.code).toBe('driver');
    },
  },
]);
