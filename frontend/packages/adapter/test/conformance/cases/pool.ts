// Кейсы стюарда контракта этапа 2, часть 1 (W2.51, 0.6.0-stage2): межфирменный пул водителей «Альты» (S2-14,
// AUTH-06/07, AC-06) — каталог пула, «Запросить на рейс», решение фирмы-источника, публикация и снятие водителя,
// временное назначение со сроком, автозавершение, closing по D09 и 404 временному водителю после срока.
// Примеры — tools/gen/examples-w251.mjs; каждой операции экрана logistics-pool — кейс успеха и ошибки.
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const MSK = 'Europe/Moscow';
/** Окно Р-211 «Охлаждённая продукция» — 14:00–18:00 по Москве. */
const W211 = { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK };
/** Часть окна Р-211 внутри свободного окна Водителя #117 (15:00–20:00 по Москве) — 15:00–18:00. */
const W117 = { startsAt: '2026-10-01T12:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK };

type Body = Record<string, unknown> & {
  id?: string;
  revision?: number;
  status?: string;
  state?: string;
  items?: Body[];
  grant?: Record<string, unknown>;
};
const body = (r: Reply): Body => r.body as Body;

const pool = (ctx: CaseContext) => `${ctx.alta}/fleet/driver-pool`;
const pubs = (ctx: CaseContext) => `${ctx.alta}/fleet/driver-pool/publications`;
const transfers = (ctx: CaseContext) => `${ctx.alta}/fleet/driver-transfer-requests`;

async function ready(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  return {
    driver: await ctx.as('driver'),
    manager: await ctx.as('manager'),
    owner: await ctx.as('owner'),
  };
}

/** «Запросить на рейс Р-211» Водителя #104 «Юг Транс» от имени `who` (логист «Север Логистик» или владелец). */
const request104 = (ctx: CaseContext, who: Session, extra: Record<string, unknown> = {}) =>
  who.post(transfers(ctx), {
    driverMemberId: ctx.A('d-104'),
    sourceOrgUnitId: ctx.A('f-msk-yug'),
    targetOrgUnitId: ctx.A('f-msk-sever'),
    window: W211,
    reason: 'Запрос на рейс Р-211',
    tripId: ctx.A('Р-211'),
    ...extra,
  });

/** Котова публикует Илью Васильева («Север Логистик») на 14:00–18:00. */
const publishVasiliev = (ctx: CaseContext, who: Session, window = W211) =>
  who.post(pubs(ctx), {
    driverMemberId: ctx.A('m-vasiliev'),
    homeOrgUnitId: ctx.A('f-msk-sever'),
    freeWindow: window,
    qualifications: ['Кат. B'],
    terms: 'По соглашению фирм группы',
  });

/** Рейс «Юг Транс» на окно 14:00–18:00 (создаёт владелец) — для временного водителя из «Север Логистик». */
async function yugTrip(ctx: CaseContext, owner: Session): Promise<Body> {
  const r = await owner.post(`${ctx.alta}/fleet/trip-plans`, {
    orgUnitId: ctx.A('f-msk-yug'),
    title: 'Сборный груз',
    plannedWindow: W211,
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

/**
 * Временный водитель: Котова публикует Васильева (свободное окно free — по умолчанию окно Р-211), владелец
 * запрашивает его на рейс «Юг Транс» и одобряет.
 */
async function temporaryDriver(ctx: CaseContext, free = W211) {
  const s = await ready(ctx);
  const trip = await yugTrip(ctx, s.owner);
  const pub = body(await publishVasiliev(ctx, s.manager, free));
  const req = body(
    await s.owner.post(transfers(ctx), {
      driverMemberId: ctx.A('m-vasiliev'),
      sourceOrgUnitId: ctx.A('f-msk-sever'),
      targetOrgUnitId: ctx.A('f-msk-yug'),
      window: W211,
      reason: `Запрос на рейс ${String(trip.number)}`,
      tripId: trip.id,
    }),
  );
  const approved = await s.owner.post(
    `${transfers(ctx)}/${req.id ?? ''}/decision`,
    { decision: 'approve' },
    { ifMatch: 1 },
  );
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { ...s, trip, pub, transfer: body(approved) };
}

const planUrl = (ctx: CaseContext, id: unknown) => `${ctx.alta}/fleet/trip-plans/${String(id)}`;
const fleetState = (ctx: CaseContext) => {
  const org = ctx.server.state().orgs[ctx.P('t-alta')] as unknown as {
    fleet: {
      trips: {
        id: string;
        state: string;
        returnedAt?: string;
        acceptedAt?: string;
        driverMemberId?: string;
        vehicleId?: string;
      }[];
    };
  };
  return org.fleet;
};

/** Строка рейса сценарного сервера (для перевода рейса в нужное состояние). */
const tripRow = (ctx: CaseContext, id: unknown) => {
  const row = fleetState(ctx).trips.find((t) => t.id === id);
  if (!row) throw new Error('нет рейса');
  return row;
};

/** W2.57: конец окна Р-211 после продления — 19:00 по Москве (конец свободного окна Водителя #104). */
const EXTENDED = '2026-10-01T16:00:00Z';

/** Временный водитель на рейсе «Юг Транс» с машиной «Юг Транс» (v5), назначенной владельцем на рейс. */
async function temporaryDriverWithVehicle(ctx: CaseContext) {
  const s = await temporaryDriver(ctx);
  const plan = await s.owner.get(planUrl(ctx, s.trip.id));
  const r = await s.owner.put(
    `${ctx.alta}/fleet/trips/${String(s.trip.id)}/vehicle`,
    { vehicleId: ctx.A('v5') },
    { ifMatch: body(plan).revision },
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return s;
}

export const poolCases = cases('pool')([
  // Каталог пула (listAvailableDrivers).
  {
    title: 'каталог пула на окно Р-211: псевдонимы, квалификации, домашняя фирма, ссылка каталога',
    operationId: 'listAvailableDrivers',
    expect: 'success',
    example: 'listAvailableDrivers/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(
          `${pool(ctx)}?availableFrom=2026-10-01T11:00:00Z&availableUntil=2026-10-01T15:00:00Z`,
        ),
        'listAvailableDrivers/ok',
      );
    },
  },
  {
    title: 'без начала интервала — 400',
    operationId: 'listAvailableDrivers',
    expect: 'error',
    example: 'listAvailableDrivers/malformed_request',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(`${pool(ctx)}?availableUntil=2026-10-01T15:00:00Z`),
        'listAvailableDrivers/malformed_request',
      );
    },
  },
  {
    title:
      'своих водителей логист в каталоге не видит; снятый и занятый водитель из каталога уходят',
    operationId: 'listAvailableDrivers',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await publishVasiliev(ctx, manager);
      const q = `${pool(ctx)}?availableFrom=2026-10-01T11:00:00Z&availableUntil=2026-10-01T15:00:00Z`;
      const names = async (s: Session) => body(await s.get(q)).items?.map((d) => d.displayName);
      expect(await names(manager)).toEqual(['Водитель #104', 'Водитель #117']);
      expect(await names(owner)).toEqual(['Водитель #104', 'Водитель #117', 'Водитель #118']);
      await owner.post(`${pubs(ctx)}/${ctx.A('pool-d-117')}/withdrawal`, {}, { ifMatch: 1 });
      const req = body(await request104(ctx, manager));
      await owner.post(
        `${transfers(ctx)}/${req.id ?? ''}/decision`,
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      expect(await names(manager)).toEqual([]);
    },
  },

  // «Запросить на рейс» (requestDriverTransfer).
  {
    title:
      '«Запросить на рейс Р-211» Водителя #104: фирма, рейс, комментарий и автор — для фирмы-источника',
    operationId: 'requestDriverTransfer',
    expect: 'success',
    example: 'requestDriverTransfer/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(await request104(ctx, manager), 'requestDriverTransfer/ok', 201);
    },
  },
  {
    title: 'второй открытый запрос на того же водителя (другой рейс) — 409 «Запрос уже отправлен»',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    example: 'requestDriverTransfer/invalid_transition',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      await request104(ctx, manager);
      ctx.expectExample(
        await request104(ctx, manager, { tripId: undefined, reason: 'Подмена на день' }),
        'requestDriverTransfer/invalid_transition',
      );
    },
  },
  {
    title: 'снятый с публикации водитель — 404 «Водитель не опубликован в пуле»',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await owner.post(`${pubs(ctx)}/${ctx.A('pool-d-104')}/withdrawal`, {}, { ifMatch: 1 });
      const r = await request104(ctx, manager);
      ctx.expectProblem(r, 'not_found');
      expect(body(r).detail).toBe('Водитель не опубликован в пуле.');
    },
  },

  // Запросы пула (listDriverTransfers, getDriverTransfer).
  {
    title: 'исходящий запрос логиста фирмы-получателя',
    operationId: 'listDriverTransfers',
    expect: 'success',
    example: 'listDriverTransfers/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      await request104(ctx, manager);
      ctx.expectExample(await manager.get(transfers(ctx)), 'listDriverTransfers/ok');
    },
  },
  {
    title: 'фильтры direction и status: входящий запрос фирмы-источника',
    operationId: 'listDriverTransfers',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await publishVasiliev(ctx, manager);
      const trip = await yugTrip(ctx, owner);
      await owner.post(transfers(ctx), {
        driverMemberId: ctx.A('m-vasiliev'),
        sourceOrgUnitId: ctx.A('f-msk-sever'),
        targetOrgUnitId: ctx.A('f-msk-yug'),
        window: W211,
        reason: 'Запрос на рейс',
        tripId: trip.id,
      });
      await request104(ctx, manager);
      const ids = async (q: string) =>
        body(await manager.get(`${transfers(ctx)}${q}`)).items?.map((x) => x.sourceOrgUnitName);
      expect(await ids('?direction=incoming')).toEqual(['Север Логистик']);
      expect(await ids('?direction=outgoing')).toEqual(['Юг Транс']);
      expect(await ids('?status=requested&status=approved')).toHaveLength(2);
      expect(await ids('?status=approved')).toEqual([]);
      ctx.expectProblem(
        await manager.get(`${transfers(ctx)}?direction=sideways`),
        'malformed_request',
      );
    },
  },
  {
    title: 'водителю запросы пула закрыты — 403',
    operationId: 'listDriverTransfers',
    expect: 'error',
    example: 'listDriverTransfers/forbidden_action',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(await driver.get(transfers(ctx)), 'listDriverTransfers/forbidden_action');
    },
  },
  {
    title: 'запрос по id — с ревизией',
    operationId: 'getDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      const r = await manager.get(`${transfers(ctx)}/${req.id ?? ''}`);
      expect(r.status).toBe(200);
      expect(body(r)).toEqual(req);
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'чужой фирме запрос не виден — 404',
    operationId: 'getDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const req = body(
        await owner.post(transfers(ctx), {
          driverMemberId: ctx.A('d-117'),
          sourceOrgUnitId: ctx.A('f-msk-vostok'),
          targetOrgUnitId: ctx.A('f-msk-yug'),
          window: W117,
          reason: 'Подмена',
        }),
      );
      ctx.expectProblem(await manager.get(`${transfers(ctx)}/${req.id ?? ''}`), 'not_found');
    },
  },

  // Решение фирмы-источника и временное назначение (decideDriverTransfer).
  {
    title: 'владелец одобряет: временное назначение на рейс Р-211 до 18:00, до окна — scheduled',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    example: 'decideDriverTransfer/ok',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      ctx.expectExample(
        await owner.post(
          `${transfers(ctx)}/${req.id ?? ''}/decision`,
          { decision: 'approve' },
          { ifMatch: 1 },
        ),
        'decideDriverTransfer/ok',
      );
      expect(body(await owner.get(planUrl(ctx, ctx.A('Р-211'))))).toMatchObject({
        driverMemberId: ctx.A('d-104'),
        driverDisplayName: 'Водитель #104 · временно',
      });
    },
  },
  {
    title: 'логист фирмы-получателя не решает за фирму-источник — 403',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    example: 'decideDriverTransfer/forbidden_action',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      ctx.expectExample(
        await manager.post(
          `${transfers(ctx)}/${req.id ?? ''}/decision`,
          { decision: 'approve' },
          { ifMatch: 1 },
        ),
        'decideDriverTransfer/forbidden_action',
      );
    },
  },
  {
    title: 'менеджер фирмы-источника отклоняет входящий запрос с комментарием',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      await publishVasiliev(ctx, manager);
      const trip = await yugTrip(ctx, owner);
      const req = body(
        await owner.post(transfers(ctx), {
          driverMemberId: ctx.A('m-vasiliev'),
          sourceOrgUnitId: ctx.A('f-msk-sever'),
          targetOrgUnitId: ctx.A('f-msk-yug'),
          window: W211,
          reason: 'Запрос на рейс',
          tripId: trip.id,
        }),
      );
      const r = await manager.post(
        `${transfers(ctx)}/${req.id ?? ''}/decision`,
        { decision: 'reject', comment: 'Водитель нужен на своём рейсе' },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({
        status: 'rejected',
        revision: 2,
        decidedByMemberId: ctx.A('m-kotova'),
        decisionComment: 'Водитель нужен на своём рейсе',
      });
      expect(body(r).grant).toBeUndefined();
    },
  },
  {
    title: 'водитель уже временно назначен на пересекающееся окно — 409 resources_unavailable',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { owner, trip } = await temporaryDriver(ctx);
      const other = await yugTrip(ctx, owner);
      // Публикация уже без открытого запроса: новый запрос на тот же срок — на другой рейс.
      const req = body(
        await owner.post(transfers(ctx), {
          driverMemberId: ctx.A('m-vasiliev'),
          sourceOrgUnitId: ctx.A('f-msk-sever'),
          targetOrgUnitId: ctx.A('f-msk-yug'),
          window: W211,
          reason: `Запрос на рейс ${String(other.number)}`,
          tripId: other.id,
        }),
      );
      expect(trip.id).not.toBe(other.id);
      const r = await owner.post(
        `${transfers(ctx)}/${req.id ?? ''}/decision`,
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'resources_unavailable');
      expect(body(r).detail).toBe('Водитель уже назначен в это время.');
    },
  },
  {
    title:
      'отзыв одобрения фирмой-источником: revoked с автором отзыва, рейс до старта без водителя',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner, driver, trip, transfer } = await temporaryDriver(ctx);
      // Отзывает Котова («Север Логистик» — фирма Васильева), одобрял владелец.
      const r = await manager.post(
        `${transfers(ctx)}/${String(transfer.id)}/decision`,
        { decision: 'revoke' },
        { ifMatch: 2 },
      );
      expect(body(r)).toMatchObject({
        status: 'revoked',
        revision: 3,
        decidedByMemberId: ctx.A('m-owner'),
        revokedByMemberId: ctx.A('m-kotova'),
        completedAt: '2026-10-01T07:30:00Z',
        grant: { state: 'ended', endReason: 'revoked', endedAt: '2026-10-01T07:30:00Z' },
      });
      expect(body(await owner.get(planUrl(ctx, trip.id))).driverMemberId).toBeUndefined();
      ctx.expectProblem(await driver.get(planUrl(ctx, trip.id)), 'not_found');
    },
  },

  // Временное назначение и автозавершение (AUTH-07, D09, AC-06).
  {
    title: 'AC-06: временный водитель видит рейс в окне; после срока — completed и 404',
    operationId: 'getDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, trip, transfer } = await temporaryDriver(ctx);
      const url = `${transfers(ctx)}/${String(transfer.id)}`;
      expect(transfer.grant).toMatchObject({
        orgUnitId: ctx.A('f-msk-yug'),
        tripId: trip.id,
        state: 'scheduled',
      });
      expect((await driver.get(planUrl(ctx, trip.id))).status).toBe(200);
      ctx.server.setNow('2026-10-01T12:00:00Z');
      expect(body(await owner.get(url)).grant).toMatchObject({ state: 'active' });
      expect((await driver.get(planUrl(ctx, trip.id))).status).toBe(200);
      ctx.server.setNow('2026-10-01T15:20:00Z');
      expect(body(await owner.get(url))).toMatchObject({
        status: 'completed',
        completedAt: '2026-10-01T15:00:00Z',
        grant: { state: 'ended', endReason: 'completed', endedAt: '2026-10-01T15:00:00Z' },
      });
      ctx.expectProblem(await driver.get(planUrl(ctx, trip.id)), 'not_found');
      // Рейс не начат до конца окна — новая работа за пределами срока не допускается (AUTH-07).
      expect(body(await owner.get(planUrl(ctx, trip.id))).driverMemberId).toBeUndefined();
    },
  },
  {
    title:
      'D09: рейс идёт после конца окна — closing; сдача и доработка — тоже closing; после приёмки — completed',
    operationId: 'getDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, trip, transfer } = await temporaryDriver(ctx);
      const url = `${transfers(ctx)}/${String(transfer.id)}`;
      const row = fleetState(ctx).trips.find((t) => t.id === trip.id);
      if (!row) throw new Error('нет рейса');
      row.state = 'on_route';
      ctx.server.setNow('2026-10-01T15:10:00Z');
      expect(body(await owner.get(url))).toMatchObject({
        status: 'approved',
        grant: { state: 'closing' },
      });
      expect((await driver.get(planUrl(ctx, trip.id))).status).toBe(200);
      // Сдана после конца окна: приёмка ещё может вернуть рейс на доработку — назначение держится.
      row.state = 'submitted';
      row.returnedAt = '2026-10-01T15:20:00Z';
      ctx.server.setNow('2026-10-01T15:25:00Z');
      expect(body(await owner.get(url))).toMatchObject({
        status: 'approved',
        grant: { state: 'closing' },
      });
      row.state = 'rework';
      ctx.server.setNow('2026-10-01T15:26:00Z');
      expect(body(await owner.get(url)).grant).toMatchObject({ state: 'closing' });
      expect((await driver.get(planUrl(ctx, trip.id))).status).toBe(200);
      row.state = 'accepted';
      row.acceptedAt = '2026-10-01T15:27:00Z';
      ctx.server.setNow('2026-10-01T15:28:00Z');
      expect(body(await owner.get(url))).toMatchObject({
        status: 'completed',
        completedAt: '2026-10-01T15:27:00Z',
        grant: { state: 'ended', endReason: 'completed', endedAt: '2026-10-01T15:27:00Z' },
      });
      ctx.expectProblem(await driver.get(planUrl(ctx, trip.id)), 'not_found');
    },
  },
  {
    title: 'нерешённый запрос к началу окна истекает (expired)',
    operationId: 'getDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      ctx.server.setNow('2026-10-01T11:00:00Z');
      expect(body(await manager.get(`${transfers(ctx)}/${req.id ?? ''}`))).toMatchObject({
        status: 'expired',
        revision: 2,
      });
    },
  },

  // Публикация фирмой-источником.
  {
    title: 'владелец видит публикации фирм группы — сначала позднее окно',
    operationId: 'listDriverPoolPublications',
    expect: 'success',
    example: 'listDriverPoolPublications/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      ctx.expectExample(await owner.get(pubs(ctx)), 'listDriverPoolPublications/ok');
    },
  },
  {
    title: 'логист видит публикации своей фирмы; фильтры state и homeOrgUnitId',
    operationId: 'listDriverPoolPublications',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      expect(body(await manager.get(pubs(ctx))).items).toEqual([]);
      await publishVasiliev(ctx, manager);
      expect(body(await manager.get(pubs(ctx))).items?.map((p) => p.displayName)).toEqual([
        'Водитель #118',
      ]);
      const yug = `${pubs(ctx)}?homeOrgUnitId=${ctx.A('f-msk-yug')}`;
      expect(body(await owner.get(yug)).items?.map((p) => p.displayName)).toEqual([
        'Водитель #104',
      ]);
      expect(body(await owner.get(`${pubs(ctx)}?state=withdrawn`)).items).toEqual([]);
      ctx.server.setNow('2026-10-01T17:30:00Z');
      const later = await ctx.as('owner'); // сессия 8 ч истекла
      expect(
        body(await later.get(`${pubs(ctx)}?state=expired`)).items?.map((p) => p.displayName),
      ).toEqual(['Водитель #117', 'Водитель #118', 'Водитель #104']);
    },
  },
  {
    title: 'водителю публикации пула закрыты — 403',
    operationId: 'listDriverPoolPublications',
    expect: 'error',
    example: 'listDriverPoolPublications/forbidden_action',
    run: async (ctx) => {
      const { driver } = await ready(ctx);
      ctx.expectExample(await driver.get(pubs(ctx)), 'listDriverPoolPublications/forbidden_action');
    },
  },
  {
    title: 'публикация по id с ревизией',
    operationId: 'getDriverPoolPublication',
    expect: 'success',
    example: 'getDriverPoolPublication/ok',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const r = await owner.get(`${pubs(ctx)}/${ctx.A('pool-d-104')}`);
      ctx.expectExample(r, 'getDriverPoolPublication/ok');
      expect(r.headers.get('ETag')).toBe('"rev-1"');
    },
  },
  {
    title: 'публикация чужой фирмы — 404, как несуществующая',
    operationId: 'getDriverPoolPublication',
    expect: 'error',
    example: 'getDriverPoolPublication/not_found',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await manager.get(`${pubs(ctx)}/${ctx.A('pool-d-104')}`),
        'getDriverPoolPublication/not_found',
      );
    },
  },
  {
    title: 'Котова публикует Илью Васильева на 14:00–18:00: псевдоним «Водитель #118»',
    operationId: 'publishDriverToPool',
    expect: 'success',
    example: 'publishDriverToPool/ok',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(await publishVasiliev(ctx, manager), 'publishDriverToPool/ok', 201);
    },
  },
  {
    title: 'окно пересекает рейс водителя Р-208 — 409 resources_unavailable',
    operationId: 'publishDriverToPool',
    expect: 'error',
    example: 'publishDriverToPool/resources_unavailable',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      ctx.expectExample(
        await publishVasiliev(ctx, manager, {
          startsAt: '2026-10-01T09:00:00Z',
          endsAt: '2026-10-01T11:00:00Z',
          timeZone: MSK,
        }),
        'publishDriverToPool/resources_unavailable',
      );
    },
  },
  {
    title:
      'повторная публикация на пересекающееся окно — 409; не водитель — 422; чужая (невидимая) фирма — 422',
    operationId: 'publishDriverToPool',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      await publishVasiliev(ctx, manager);
      const again = await publishVasiliev(ctx, manager);
      ctx.expectProblem(again, 'resources_unavailable');
      expect(body(again).detail).toBe('Водитель уже опубликован в пуле на это время.');
      const notDriver = await manager.post(pubs(ctx), {
        driverMemberId: ctx.A('m-kotova'),
        homeOrgUnitId: ctx.A('f-msk-sever'),
        freeWindow: W211,
        qualifications: [],
      });
      ctx.expectProblem(notDriver, 'validation_failed');
      expect((body(notDriver).violations as { field: string }[])[0]?.field).toBe('driverMemberId');
      const past = await publishVasiliev(ctx, manager, {
        startsAt: '2026-10-01T03:00:00Z',
        endsAt: '2026-10-01T05:00:00Z',
        timeZone: MSK,
      });
      ctx.expectProblem(past, 'validation_failed');
      const foreign = await manager.post(pubs(ctx), {
        driverMemberId: ctx.A('m-vasiliev'),
        homeOrgUnitId: ctx.A('f-msk-yug'),
        freeWindow: W211,
        qualifications: ['Кат. B'],
      });
      // Возврат 2: «Юг Транс» Котова не видит (org_units.read) — ответ как несуществующей фирме, не 403.
      ctx.expectProblem(foreign, 'validation_failed');
      expect((body(foreign).violations as { field: string }[])[0]?.field).toBe('homeOrgUnitId');
    },
  },
  {
    title: 'владелец снимает Водителя #117: открытые запросы истекают',
    operationId: 'withdrawDriverPoolPublication',
    expect: 'success',
    example: 'withdrawDriverPoolPublication/ok',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const req = body(
        await manager.post(transfers(ctx), {
          driverMemberId: ctx.A('d-117'),
          sourceOrgUnitId: ctx.A('f-msk-vostok'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window: W117,
          reason: 'Запрос на рейс Р-211',
          tripId: ctx.A('Р-211'),
        }),
      );
      ctx.expectExample(
        await owner.post(`${pubs(ctx)}/${ctx.A('pool-d-117')}/withdrawal`, {}, { ifMatch: 1 }),
        'withdrawDriverPoolPublication/ok',
      );
      expect(body(await manager.get(`${transfers(ctx)}/${req.id ?? ''}`))).toMatchObject({
        status: 'expired',
        revision: 2,
      });
    },
  },
  {
    title: 'повторное снятие — 409 «Водитель уже снят из пула»',
    operationId: 'withdrawDriverPoolPublication',
    expect: 'error',
    example: 'withdrawDriverPoolPublication/invalid_transition',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const url = `${pubs(ctx)}/${ctx.A('pool-d-117')}/withdrawal`;
      await owner.post(url, {}, { ifMatch: 1 });
      ctx.expectExample(
        await owner.post(url, { comment: 'Ещё раз' }, { ifMatch: 2 }),
        'withdrawDriverPoolPublication/invalid_transition',
      );
    },
  },
  {
    title: 'снятие без If-Match — 428; логист фирмы-получателя чужую публикацию не снимает — 404',
    operationId: 'withdrawDriverPoolPublication',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const url = `${pubs(ctx)}/${ctx.A('pool-d-117')}/withdrawal`;
      ctx.expectProblem(await owner.post(url, {}), 'revision_required');
      ctx.expectProblem(await manager.post(url, {}, { ifMatch: 1 }), 'not_found');
    },
  },

  // Возврат 1 (ревью W2.51): временное назначение ограничено рейсом фирмы-получателя и окном публикации.
  {
    title: 'рейс другой фирмы, чем фирма-получатель, — 422 (поле tripId)',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      // Владелец видит Р-211 «Север Логистик», но просит водителя для «Восток Карго».
      const r = await request104(ctx, owner, { targetOrgUnitId: ctx.A('f-msk-vostok') });
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations).toEqual([
        { field: 'tripId', code: 'org_unit', message: 'Рейс другой фирмы' },
      ]);
    },
  },
  {
    title:
      'окно запроса вне свободного окна публикации — 422 (поле window); внутри окна — запрос принят',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const ask = (window: typeof W211) =>
        manager.post(transfers(ctx), {
          driverMemberId: ctx.A('d-117'),
          sourceOrgUnitId: ctx.A('f-msk-vostok'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window,
          reason: 'Запрос на рейс Р-211',
          tripId: ctx.A('Р-211'),
        });
      // Водитель #117 свободен с 15:00, рейс Р-211 — с 14:00.
      const r = await ask(W211);
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations).toEqual([
        { field: 'window', code: 'outside_free_window', message: 'Вне свободного окна водителя' },
      ]);
      const ok = await ask(W117);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(body(ok)).toMatchObject({ publicationId: ctx.A('pool-d-117'), window: W117 });
    },
  },
  {
    title: 'publicationId карточки каталога: запрос по ней; публикация другого водителя — 404',
    operationId: 'requestDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const wrong = await request104(ctx, manager, { publicationId: ctx.A('pool-d-117') });
      ctx.expectProblem(wrong, 'not_found');
      expect(body(wrong).detail).toBe('Водитель не опубликован в пуле.');
      const r = await request104(ctx, manager, { publicationId: ctx.A('pool-d-104') });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(body(r).publicationId).toBe(ctx.A('pool-d-104'));
    },
  },
  {
    title: 'одобрение второго запроса на рейс, у которого уже есть водитель, — 409',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const first = body(await request104(ctx, manager));
      const second = body(
        await manager.post(transfers(ctx), {
          driverMemberId: ctx.A('d-117'),
          sourceOrgUnitId: ctx.A('f-msk-vostok'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window: W117,
          reason: 'Запрос на рейс Р-211',
          tripId: ctx.A('Р-211'),
        }),
      );
      const decide = (id: unknown) =>
        owner.post(
          `${transfers(ctx)}/${String(id)}/decision`,
          { decision: 'approve' },
          { ifMatch: 1 },
        );
      expect((await decide(first.id)).status).toBe(200);
      const r = await decide(second.id);
      ctx.expectProblem(r, 'invalid_transition');
      expect(body(r).detail).toBe('У рейса уже есть водитель.');
      const still = body(await manager.get(`${transfers(ctx)}/${String(second.id)}`));
      expect(still).toMatchObject({ status: 'requested', revision: 1 });
      expect(still.grant).toBeUndefined();
    },
  },
  {
    title: 'одобрение запроса на отменённый или начатый рейс — 409',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      const row = fleetState(ctx).trips.find((t) => t.id === ctx.A('Р-211'));
      if (!row) throw new Error('нет рейса');
      row.state = 'cancelled';
      const r = await owner.post(
        `${transfers(ctx)}/${req.id ?? ''}/decision`,
        { decision: 'approve' },
        { ifMatch: 1 },
      );
      ctx.expectProblem(r, 'invalid_transition');
      expect(body(r).detail).toBe('Рейс уже начат или закрыт.');
    },
  },
  {
    title: 'снятие с комментарием: комментарий и автор снятия — в публикации',
    operationId: 'withdrawDriverPoolPublication',
    expect: 'success',
    run: async (ctx) => {
      const { owner } = await ready(ctx);
      const r = await owner.post(
        `${pubs(ctx)}/${ctx.A('pool-d-117')}/withdrawal`,
        { comment: 'Водитель нужен на своём рейсе' },
        { ifMatch: 1 },
      );
      expect(body(r)).toMatchObject({
        state: 'withdrawn',
        withdrawnByMemberId: ctx.A('m-owner'),
        withdrawalComment: 'Водитель нужен на своём рейсе',
      });
      expect(body(await owner.get(`${pubs(ctx)}/${ctx.A('pool-d-117')}`))).toEqual(body(r));
    },
  },
  {
    title: 'неизвестный и не свой сотрудник — одинаковый 422: ответ не выдаёт состав группы',
    operationId: 'publishDriverToPool',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const publish = (driverMemberId: string) =>
        manager.post(pubs(ctx), {
          driverMemberId,
          homeOrgUnitId: ctx.A('f-msk-sever'),
          freeWindow: W211,
          qualifications: ['Кат. B'],
        });
      const unknown = await publish(ctx.A('m-nobody'));
      const other = await publish(ctx.A('m-akhmedov'));
      ctx.expectProblem(unknown, 'validation_failed');
      ctx.expectProblem(other, 'validation_failed');
      expect(body(unknown).detail).toBe(body(other).detail);
      expect(body(unknown).violations).toEqual(body(other).violations);
    },
  },
  {
    title: 'окно пересекает истёкшую (не снятую) публикацию водителя — 409, как в tenant 0014',
    operationId: 'publishDriverToPool',
    expect: 'error',
    run: async (ctx) => {
      const { manager } = await ready(ctx);
      const first = await publishVasiliev(ctx, manager, {
        startsAt: '2026-10-01T10:00:00Z',
        endsAt: '2026-10-01T10:30:00Z',
        timeZone: MSK,
      });
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      ctx.server.setNow('2026-10-01T10:45:00Z');
      const later = await ctx.as('manager');
      const r = await publishVasiliev(ctx, later, {
        startsAt: '2026-10-01T10:15:00Z',
        endsAt: '2026-10-01T11:00:00Z',
        timeZone: MSK,
      });
      ctx.expectProblem(r, 'resources_unavailable');
      expect(body(r).detail).toBe('Водитель уже опубликован в пуле на это время.');
    },
  },

  // Возврат 2 (ревью W2.51): без publicationId — одно правило контракта и MSW (вариант А); порядок проверок публикации.
  {
    title:
      'без publicationId: окно не пересекает freeWindow — 422 window, а не 404; без активной публикации — 404',
    operationId: 'requestDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const ask = (window: typeof W211) =>
        manager.post(transfers(ctx), {
          driverMemberId: ctx.A('d-117'),
          sourceOrgUnitId: ctx.A('f-msk-vostok'),
          targetOrgUnitId: ctx.A('f-msk-sever'),
          window,
          reason: 'Подмена на утро',
        });
      // Водитель #117 свободен 15:00–20:00 по Москве; утро 10:00–12:00 его окна не касается.
      const morning = {
        startsAt: '2026-10-01T07:00:00Z',
        endsAt: '2026-10-01T09:00:00Z',
        timeZone: MSK,
      };
      const r = await ask(morning);
      ctx.expectProblem(r, 'validation_failed');
      expect(body(r).violations).toEqual([
        { field: 'window', code: 'outside_free_window', message: 'Вне свободного окна водителя' },
      ]);
      await owner.post(`${pubs(ctx)}/${ctx.A('pool-d-117')}/withdrawal`, {}, { ifMatch: 1 });
      const gone = await ask(W117);
      ctx.expectProblem(gone, 'not_found');
      expect(body(gone).detail).toBe('Водитель не опубликован в пуле.');
    },
  },
  {
    title:
      'неизвестная и невидимая фирма — одинаковый 422 homeOrgUnitId; водителю без права — 403; владельцу — 422',
    operationId: 'publishDriverToPool',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner, driver } = await ready(ctx);
      const publish = (who: Session, homeOrgUnitId: string) =>
        who.post(pubs(ctx), {
          driverMemberId: ctx.A('m-vasiliev'),
          homeOrgUnitId,
          freeWindow: W211,
          qualifications: ['Кат. B'],
        });
      // Котова видит только «Север Логистик»: «Юг Транс» для неё — как несуществующая фирма (AC-01).
      const unknown = await publish(manager, ctx.A('f-nowhere'));
      const foreign = await publish(manager, ctx.A('f-msk-yug'));
      ctx.expectProblem(unknown, 'validation_failed');
      ctx.expectProblem(foreign, 'validation_failed');
      expect(body(unknown).detail).toBe('Подразделение не найдено.');
      expect(body(foreign).detail).toBe(body(unknown).detail);
      expect(body(foreign).violations).toEqual(body(unknown).violations);
      expect((body(unknown).violations as { field: string }[])[0]?.field).toBe('homeOrgUnitId');
      // Права публикации нет ни в одной фирме — 403 до разбора тела, как шлюз.
      ctx.expectProblem(await publish(driver, ctx.A('f-nowhere')), 'forbidden_action');
      ctx.expectProblem(await publish(driver, ctx.A('f-msk-sever')), 'forbidden_action');
      const byOwner = await publish(owner, ctx.A('f-nowhere'));
      ctx.expectProblem(byOwner, 'validation_failed');
      expect(body(byOwner).violations).toEqual(body(unknown).violations);
    },
  },
  // W2.57 (решение Q-W2.07-1 «только рейс»; D09, 08-domain-scenarios §4.6 п. 7–8, AC-06).
  {
    title:
      'продление: владелец продлевает Р-211 до 19:00 — window.endsAt, grant.validUntil, ревизия 3',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    example: 'decideDriverTransfer/extended',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      const url = `${transfers(ctx)}/${req.id ?? ''}/decision`;
      await owner.post(url, { decision: 'approve' }, { ifMatch: 1 });
      ctx.expectExample(
        await owner.post(url, { decision: 'extend', endsAt: EXTENDED }, { ifMatch: 2 }),
        'decideDriverTransfer/extended',
      );
    },
  },
  {
    title:
      'продление: без endsAt и endsAt без extend — 422; не одобренный — 409; не позже конца, вне свободного окна — 422; получатель — 403',
    operationId: 'decideDriverTransfer',
    expect: 'error',
    run: async (ctx) => {
      const { manager, owner } = await ready(ctx);
      const req = body(await request104(ctx, manager));
      const url = `${transfers(ctx)}/${req.id ?? ''}/decision`;
      const detail = async (r: Promise<Reply>, code: string, text: string) => {
        const got = await r;
        ctx.expectProblem(got, code);
        expect(body(got).detail).toBe(text);
        return got;
      };
      await detail(
        owner.post(url, { decision: 'extend' }, { ifMatch: 1 }),
        'validation_failed',
        'Проверьте срок.',
      );
      await detail(
        owner.post(url, { decision: 'approve', endsAt: EXTENDED }, { ifMatch: 1 }),
        'validation_failed',
        'Проверьте срок.',
      );
      await detail(
        owner.post(url, { decision: 'extend', endsAt: EXTENDED }, { ifMatch: 1 }),
        'invalid_transition',
        'Запрос уже рассмотрен.',
      );
      await owner.post(url, { decision: 'approve' }, { ifMatch: 1 });
      await detail(
        owner.post(url, { decision: 'extend', endsAt: W211.endsAt }, { ifMatch: 2 }),
        'validation_failed',
        'Проверьте срок.',
      );
      const outside = await detail(
        owner.post(url, { decision: 'extend', endsAt: '2026-10-01T17:00:00Z' }, { ifMatch: 2 }),
        'validation_failed',
        'Срок вне свободного окна водителя.',
      );
      expect(body(outside).violations).toEqual([
        { field: 'window', code: 'outside_free_window', message: 'Вне свободного окна водителя' },
      ]);
      ctx.expectProblem(
        await manager.post(url, { decision: 'extend', endsAt: EXTENDED }, { ifMatch: 2 }),
        'forbidden_action',
      );
    },
  },
  {
    title:
      'D09: закрывающий рейс после окна — просрочка, пока не сдан; продление снова делает назначение active',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      // Свободное окно Васильева — до 20:00 по Москве: продление до 19:00 внутри него.
      const { owner, trip, transfer } = await temporaryDriver(ctx, {
        ...W211,
        endsAt: '2026-10-01T17:00:00Z',
      });
      const url = `${transfers(ctx)}/${String(transfer.id)}`;
      const row = tripRow(ctx, trip.id);
      row.state = 'on_route';
      ctx.server.setNow('2026-10-01T15:10:00Z');
      expect(body(await owner.get(url)).grant).toMatchObject({ state: 'closing', overdue: true });
      row.state = 'submitted';
      expect(body(await owner.get(url)).grant).toMatchObject({ state: 'closing', overdue: false });
      row.state = 'rework';
      const extended = await owner.post(
        `${url}/decision`,
        { decision: 'extend', endsAt: '2026-10-01T16:00:00Z' },
        { ifMatch: 2 },
      );
      expect(extended.status, JSON.stringify(extended.body)).toBe(200);
      expect(body(extended)).toMatchObject({ status: 'approved', revision: 3 });
      expect(body(extended).grant).toMatchObject({
        state: 'active',
        validUntil: '2026-10-01T16:00:00Z',
      });
      expect(body(extended).grant?.overdue).toBeUndefined();
    },
  },
  {
    title:
      'отзыв начатого рейса — revoked, продолжение (closing) до приёмки, водитель на рейсе; приёмка — ended',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { manager, owner, driver, trip, transfer } = await temporaryDriver(ctx);
      const row = tripRow(ctx, trip.id);
      row.state = 'on_route';
      ctx.server.setNow('2026-10-01T12:00:00Z');
      const r = await manager.post(
        `${transfers(ctx)}/${String(transfer.id)}/decision`,
        { decision: 'revoke' },
        { ifMatch: 2 },
      );
      expect(body(r)).toMatchObject({
        status: 'revoked',
        revision: 3,
        completedAt: '2026-10-01T12:00:00Z',
        grant: { state: 'closing', overdue: true },
      });
      expect(row.driverMemberId).toBe(ctx.A('m-vasiliev'));
      expect((await driver.get(planUrl(ctx, trip.id))).status).toBe(200);
      row.state = 'accepted';
      row.acceptedAt = '2026-10-01T13:00:00Z';
      ctx.server.setNow('2026-10-01T13:05:00Z');
      expect(body(await owner.get(`${transfers(ctx)}/${String(transfer.id)}`))).toMatchObject({
        status: 'revoked',
        grant: { state: 'ended', endReason: 'revoked', endedAt: '2026-10-01T13:00:00Z' },
      });
      ctx.expectProblem(await driver.get(planUrl(ctx, trip.id)), 'not_found');
    },
  },
  {
    title:
      'продолжение (D09): временному водителю — рейс и расходы; бронь и старт после окна — 404',
    operationId: 'reserveVehicle',
    expect: 'error',
    run: async (ctx) => {
      const { driver, trip } = await temporaryDriverWithVehicle(ctx);
      const row = tripRow(ctx, trip.id);
      row.state = 'on_route';
      ctx.server.setNow('2026-10-01T15:10:00Z');
      expect((await driver.get(planUrl(ctx, trip.id))).status).toBe(200);
      expect((await driver.get(`${ctx.alta}/fleet/trips/${String(trip.id)}/expenses`)).status).toBe(
        200,
      );
      const reserve = await driver.post(`${ctx.alta}/fleet/reservations`, {
        vehicleId: ctx.A('v5'),
        driverMemberId: ctx.A('m-vasiliev'),
        tripId: trip.id,
        window: { startsAt: '2026-10-01T15:30:00Z', endsAt: '2026-10-01T16:00:00Z', timeZone: MSK },
      });
      ctx.expectProblem(reserve, 'not_found');
      expect(body(reserve).detail).toBe('Рейс не найден.');
    },
  },
  {
    title:
      'машина рейса: временному водителю в окне — только забронированная машина фирмы; после окна — нет',
    operationId: 'listVehicles',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, transfer } = await temporaryDriverWithVehicle(ctx);
      ctx.server.setNow('2026-10-01T12:00:00Z');
      const ids = async () =>
        (body(await driver.get(`${ctx.alta}/fleet/vehicles`)).items ?? []).map((v) => v.id);
      expect(await ids()).toContain(ctx.A('v5'));
      expect(body(await owner.get(`${transfers(ctx)}/${String(transfer.id)}`)).grant).toMatchObject(
        {
          state: 'active',
          vehicleId: ctx.A('v5'),
        },
      );
      ctx.server.setNow('2026-10-01T15:10:00Z');
      expect(await ids()).not.toContain(ctx.A('v5'));
    },
  },
  {
    title: 'приёмка в окне и снятие водителя с рейса гасят назначение сразу (Q-W2.07-14)',
    operationId: 'getDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const { owner, driver, trip, transfer } = await temporaryDriver(ctx);
      const url = `${transfers(ctx)}/${String(transfer.id)}`;
      const row = tripRow(ctx, trip.id);
      ctx.server.setNow('2026-10-01T12:00:00Z');
      delete row.driverMemberId;
      expect(body(await owner.get(url))).toMatchObject({
        status: 'completed',
        completedAt: '2026-10-01T12:00:00Z',
        grant: { state: 'ended', endReason: 'completed', endedAt: '2026-10-01T12:00:00Z' },
      });
      ctx.expectProblem(await driver.get(planUrl(ctx, trip.id)), 'not_found');
    },
  },
  // W2.57, возврат 3 (Q-W2.57-9): AC-06 по тегу Files — как files.Hider backend.
  {
    title:
      'AC-06 · файлы: фото рейса перевода — водителю в окне и в продолжении; после приёмки — 404, загрузка — 404',
    operationId: 'getFile',
    expect: 'error',
    run: async (ctx) => {
      const { driver, trip } = await temporaryDriver(ctx);
      ctx.server.setNow('2026-10-01T12:00:00Z');
      const upload = () =>
        driver.post(`${ctx.alta}/files/uploads`, {
          fileName: 'Спереди.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 2048,
          sha256: 'a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
          purpose: 'inspection',
          owner: { moduleKey: 'fleet', entityType: 'trip', entityId: String(trip.id) },
        });
      const ticket = await upload();
      expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
      const file = `${ctx.alta}/files/${String(body(ticket).fileId)}`;
      expect((await driver.get(file)).status).toBe(200);
      const row = tripRow(ctx, trip.id);
      row.state = 'on_route';
      ctx.server.setNow('2026-10-01T15:10:00Z');
      expect((await driver.get(file)).status).toBe(200);
      expect((await upload()).status).toBe(201);
      row.state = 'accepted';
      row.acceptedAt = '2026-10-01T15:12:00Z';
      ctx.server.setNow('2026-10-01T15:15:00Z');
      ctx.expectProblem(await driver.get(file), 'not_found');
      ctx.expectProblem(await driver.get(`${file}/download`), 'not_found');
      ctx.expectProblem(await upload(), 'not_found');
    },
  },
]);
