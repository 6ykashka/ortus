// Кейсы W2.62 (Q-W2.32-5, Q-W2.32-6): сценарный сервер отвечает как backend `main` (+ W2.60) в двух местах журни
// выхода этапа 2. (1) AC-12, draining «Логистики» (modulesreg: activity.go FleetTrips, gate.go finishOnly,
// service.go settle, availability.go): «Затронет сейчас» перечисляет рейсы, отключение при начатом рейсе — draining,
// новые рейсы и брони — 403 module_read_only, завершение начатого открыто, после последнего процесса — read_only.
// (2) AC-06, роль «Временный водитель» (fleet/pool W2.57, Q-W2.07-1 «только рейс»): одобрение запроса пула назначает
// системную роль в области self на окно и в области resource на машину рейса; машина рейса — в осмотре; после окна —
// только продолжение начатого рейса (D09); после приёмки — как несуществующий id. Тимур Ахмедов своих ролей в сиде не
// имеет (функция «Водитель» — рабочий профиль), поэтому кейсы идут на узкой роли без домашней.
import { expect } from 'vitest';

import type { Reply, Session } from '../client.ts';
import { type CaseContext, cases } from '../types.ts';

const NOW = '2026-10-01T07:30:00Z';
const MSK = 'Europe/Moscow';
const ROLES = ['front', 'rear', 'left', 'right', 'odometer'] as const;
const W208 = { startsAt: '2026-10-01T06:00:00Z', endsAt: '2026-10-01T10:00:00Z', timeZone: MSK };
/** Окно перевода и рейса «Юг Транс» — 14:00–18:00 по Москве. */
const W = { startsAt: '2026-10-01T11:00:00Z', endsAt: '2026-10-01T15:00:00Z', timeZone: MSK };
const IN_WINDOW = '2026-10-01T11:30:00Z';
const AFTER_WINDOW = '2026-10-01T15:10:00Z';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const DRAINING = 'Модуль «Логистика» отключается: можно только завершить начатую работу.';

type Body = Record<string, unknown> & {
  id?: string;
  revision?: number;
  state?: string;
  status?: string;
  items?: Body[];
  grant?: Record<string, unknown>;
};
const body = (r: Reply): Body => r.body as Body;

/** Ответ Problem без полей конкретного запроса. */
const problem = (r: Reply): Record<string, unknown> => {
  const b = { ...body(r) };
  delete b.instance;
  delete b.requestId;
  delete b.traceId;
  return { status: r.status, ...b };
};

/** Готовые файлы организации (`ready`): фото осмотра (как после загрузки и проверки, W1.09). */
function readyFiles(ctx: CaseContext, prefix: string, n: number): string[] {
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
      status: 'ready',
      createdAt: NOW,
    });
    return id;
  });
}

const fleet = (ctx: CaseContext) => `${ctx.alta}/fleet`;
const planUrl = (ctx: CaseContext, id: unknown) => `${fleet(ctx)}/trip-plans/${String(id)}`;
const tripUrl = (ctx: CaseContext, id: unknown) => `${fleet(ctx)}/trips/${String(id)}`;
const moduleUrl = (ctx: CaseContext) => `${ctx.alta}/modules/fleet`;

/** Ревизия рейса (TripPlan.revision) для If-Match. */
const rev = async (s: Session, url: string): Promise<number> =>
  Number(body(await s.get(url)).revision);

/** Осмотр `kind` машины `vehicle` по брони (выезд) или рейсу (сдача) с пятью готовыми фото. */
async function inspect(
  ctx: CaseContext,
  s: Session,
  o: { kind: 'departure' | 'return'; vehicle: string; odometerKm: string } & Record<
    string,
    unknown
  >,
): Promise<Reply> {
  const { kind, vehicle, odometerKm, ...extra } = o;
  const list = body(
    await s.get(`${fleet(ctx)}/inspection-checklist?vehicleId=${vehicle}&kind=${kind}`),
  );
  const files = readyFiles(ctx, kind, ROLES.length);
  return s.post(`${fleet(ctx)}/inspections`, {
    checklistVersionId: list.versionId,
    vehicleId: vehicle,
    kind,
    odometerKm,
    fuelPercent: 50,
    checks: (list.items ?? []).map((i) => ({ key: i.key, result: 'pass' })),
    photos: ROLES.map((role, i) => ({ role, fileId: files[i], capturedAt: NOW })),
    capturedAt: NOW,
    ...extra,
  });
}

/** Строка рейса сценарного сервера (для перевода рейса в нужное состояние). */
function tripRow(ctx: CaseContext, id: string) {
  const org = ctx.server.state().orgs[ctx.P('t-alta')] as unknown as {
    fleet: { trips: { id: string; state: string; driverMemberId?: string }[] };
  };
  const row = org.fleet.trips.find((t) => t.id === id);
  if (!row) throw new Error('нет рейса');
  return row;
}

// ---------------------------------------------------------------------------------------------
// (1) Draining «Логистики» (AC-12)

/** «Логистика» подключена; Илья Васильев выехал на Р-208 (бронь ГАЗели, осмотр с пятью фото, старт). */
async function shiftOnRoute(ctx: CaseContext) {
  ctx.server.applyPreset('logistics-ready');
  const driver = await ctx.as('driver');
  const manager = await ctx.as('manager');
  const owner = await ctx.as('owner');
  const res = body(
    await driver.post(`${fleet(ctx)}/reservations`, {
      vehicleId: ctx.A('v1'),
      driverMemberId: ctx.A('m-vasiliev'),
      window: W208,
      tripId: ctx.A('Р-208'),
    }),
  );
  const dep = await inspect(ctx, driver, {
    kind: 'departure',
    vehicle: ctx.A('v1'),
    odometerKm: '84500',
    reservationId: res.id,
  });
  expect(dep.status, JSON.stringify(dep.body)).toBe(201);
  const start = await driver.post(`${fleet(ctx)}/trips`, {
    reservationId: res.id,
    departureInspectionId: body(dep).id,
  });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  return { driver, manager, owner, reservationId: res.id as string };
}

/** Владелец отключает «Логистику» (диалог «Отключить модуль» — retainedAccess history_read). */
async function disable(ctx: CaseContext, owner: Session): Promise<Reply> {
  const cur = body(await owner.get(moduleUrl(ctx)));
  return owner.put(
    moduleUrl(ctx),
    { enabled: false, retainedAccess: 'history_read' },
    { ifMatch: cur.revision },
  );
}

const moduleState = async (ctx: CaseContext, owner: Session) =>
  body(await owner.get(moduleUrl(ctx))).state;

/** Рейс в пути при отключении: draining. */
async function draining(ctx: CaseContext) {
  const s = await shiftOnRoute(ctx);
  const r = await disable(ctx, s.owner);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return s;
}

/** «Завершить рейс» и осмотр при сдаче Р-208 (ГАЗель, пробег 84 560). */
async function finishRoute(ctx: CaseContext, driver: Session) {
  const url = tripUrl(ctx, ctx.A('Р-208'));
  const done = await driver.post(`${url}/route-completion`, undefined, {
    ifMatch: await rev(driver, planUrl(ctx, ctx.A('Р-208'))),
  });
  const ret = await inspect(ctx, driver, {
    kind: 'return',
    vehicle: ctx.A('v1'),
    odometerKm: '84560',
    tripId: ctx.A('Р-208'),
  });
  return { done, ret };
}

// ---------------------------------------------------------------------------------------------
// (2) Временный водитель (AC-06)

/**
 * Ахмедов — в «Север Логистик» (своей роли нет), владелец публикует его в пул на 14:00–18:00, создаёт рейс «Юг Транс»
 * и запрашивает его на рейс; `approve` — одобряет. Часы — 10:30 по Москве (до окна).
 */
async function temporary(ctx: CaseContext, approve = true) {
  ctx.server.applyPreset('logistics-ready');
  const owner = await ctx.as('owner');
  const akh = ctx.A('m-akhmedov');
  const sever = ctx.A('f-msk-sever');
  const yug = ctx.A('f-msk-yug');
  const m = await owner.patch(
    `${ctx.alta}/members/${akh}`,
    { orgUnitIds: [sever] },
    { ifMatch: 1 },
  );
  expect(m.status, JSON.stringify(m.body)).toBe(200);
  const pub = await owner.post(`${fleet(ctx)}/driver-pool/publications`, {
    driverMemberId: akh,
    homeOrgUnitId: sever,
    freeWindow: W,
    qualifications: ['Кат. B'],
    terms: 'По соглашению фирм группы',
  });
  expect(pub.status, JSON.stringify(pub.body)).toBe(201);
  const trip = await owner.post(`${fleet(ctx)}/trip-plans`, {
    orgUnitId: yug,
    title: 'Сборный груз',
    plannedWindow: W,
    distanceKm: '35',
    cargo: {
      description: 'Сухой груз · 5 паллет-мест',
      weightKg: '400',
      volumeM3: '5',
      lengthM: '2',
    },
    stops: [
      { sequence: 1, op: 'load', address: 'Склад № 1, Лобня', weightKg: '400', volumeM3: '5' },
      {
        sequence: 2,
        op: 'unload',
        address: 'Химки, ул. Заводская, 8',
        weightKg: '400',
        volumeM3: '5',
      },
    ],
  });
  expect(trip.status, JSON.stringify(trip.body)).toBe(201);
  const req = await owner.post(`${fleet(ctx)}/driver-transfer-requests`, {
    driverMemberId: akh,
    sourceOrgUnitId: sever,
    targetOrgUnitId: yug,
    window: W,
    reason: `Запрос на рейс ${String(body(trip).number)}`,
    tripId: body(trip).id,
  });
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  let transfer = body(req);
  if (approve) {
    const r = await owner.post(
      `${fleet(ctx)}/driver-transfer-requests/${String(transfer.id)}/decision`,
      { decision: 'approve' },
      { ifMatch: 1 },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    transfer = body(r);
  }
  return { owner, akh, sever, yug, trip: body(trip), transfer };
}

/** В окне: владелец ставит Isuzu Elf (v5) на рейс и бронирует её за временного водителя. */
async function withVehicle(ctx: CaseContext) {
  const s = await temporary(ctx);
  ctx.server.setNow(IN_WINDOW);
  const put = await s.owner.put(
    `${tripUrl(ctx, s.trip.id)}/vehicle`,
    { vehicleId: ctx.A('v5') },
    { ifMatch: await rev(s.owner, planUrl(ctx, s.trip.id)) },
  );
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  const res = await s.owner.post(`${fleet(ctx)}/reservations`, {
    vehicleId: ctx.A('v5'),
    driverMemberId: s.akh,
    window: W,
    tripId: s.trip.id,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const driver = await ctx.as('acc-9');
  return { ...s, driver, reservationId: String(body(res).id) };
}

/** Временный водитель в окне выехал на Isuzu Elf (осмотр перед выездом с пятью фото, старт). */
async function departed(ctx: CaseContext) {
  const s = await withVehicle(ctx);
  const dep = await inspect(ctx, s.driver, {
    kind: 'departure',
    vehicle: ctx.A('v5'),
    odometerKm: '98330',
    reservationId: s.reservationId,
  });
  expect(dep.status, JSON.stringify(dep.body)).toBe(201);
  const start = await s.driver.post(`${fleet(ctx)}/trips`, {
    reservationId: s.reservationId,
    departureInspectionId: body(dep).id,
  });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  return s;
}

/** После окна начатый рейс сдан: «Завершить рейс», осмотр при сдаче, сдача (`given` — выехавший водитель). */
async function returnedAfterWindow(ctx: CaseContext, given?: Awaited<ReturnType<typeof departed>>) {
  const s = given ?? (await departed(ctx));
  ctx.server.setNow(AFTER_WINDOW);
  const done = await s.driver.post(`${tripUrl(ctx, s.trip.id)}/route-completion`, undefined, {
    ifMatch: await rev(s.driver, planUrl(ctx, s.trip.id)),
  });
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  const ret = await inspect(ctx, s.driver, {
    kind: 'return',
    vehicle: ctx.A('v5'),
    odometerKm: '98380',
    tripId: s.trip.id,
  });
  expect(ret.status, JSON.stringify(ret.body)).toBe(201);
  const r = await s.driver.patch(
    tripUrl(ctx, s.trip.id),
    { action: 'return', returnInspectionId: body(ret).id },
    { ifMatch: await rev(s.driver, planUrl(ctx, s.trip.id)) },
  );
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return s;
}

const ids = (r: Reply): string[] => (body(r).items ?? []).map((x) => String(x.id));

/** Назначения водителя `member` роли «Временный водитель». */
async function temporaryAssignments(ctx: CaseContext, owner: Session, member: string) {
  const roles = body(await owner.get(`${ctx.alta}/roles?limit=200`)).items ?? [];
  const role = roles.find((r) => r.name === 'Временный водитель');
  const list = body(await owner.get(`${ctx.alta}/assignments?limit=200`)).items ?? [];
  return {
    role,
    rows: list.filter((a) => a.principalId === member && a.roleId === role?.id),
  };
}

export const w262Cases = cases('w262')([
  // (1) Draining «Логистики» (AC-12, Q-W2.32-5).
  {
    title:
      '«Затронет сейчас»: начатый рейс — «можно завершить», назначенный — закрывается; начатые первыми',
    operationId: 'previewModuleDeactivation',
    expect: 'success',
    run: async (ctx) => {
      const { owner } = await shiftOnRoute(ctx);
      const r211 = tripRow(ctx, ctx.A('Р-211'));
      r211.state = 'assigned';
      r211.driverMemberId = ctx.A('m-akhmedov');
      const r = await owner.get(`${moduleUrl(ctx)}/deactivation-preview`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(body(r)).toEqual({
        moduleKey: 'fleet',
        retainedAccess: 'history_read',
        activeItems: [
          {
            kind: 'active_process',
            object: { moduleKey: 'fleet', entityType: 'trip', entityId: ctx.A('Р-208') },
            title: 'Рейс Р-208',
            state: 'on_route',
            assigneeName: 'Илья Васильев',
            effect: 'finish_allowed',
          },
          {
            kind: 'active_process',
            object: { moduleKey: 'fleet', entityType: 'trip', entityId: ctx.A('Р-211') },
            title: 'Рейс Р-211',
            state: 'assigned',
            assigneeName: 'Тимур Ахмедов',
            effect: 'closed',
          },
        ],
        hiddenCount: 0,
        generatedAt: NOW,
      });
    },
  },
  {
    title:
      'при draining предпросмотр открыт; после перехода в «только чтение» — 403 module_not_installed',
    operationId: 'previewModuleDeactivation',
    expect: 'error',
    run: async (ctx) => {
      const { owner, driver, manager } = await draining(ctx);
      const open = await owner.get(`${moduleUrl(ctx)}/deactivation-preview`);
      expect(open.status, JSON.stringify(open.body)).toBe(200);
      expect(body(open).activeItems).toHaveLength(1);
      const { ret } = await finishRoute(ctx, driver);
      await driver.patch(
        tripUrl(ctx, ctx.A('Р-208')),
        { action: 'return', returnInspectionId: body(ret).id },
        { ifMatch: await rev(driver, planUrl(ctx, ctx.A('Р-208'))) },
      );
      await manager.post(
        `${tripUrl(ctx, ctx.A('Р-208'))}/review`,
        { decision: 'approve' },
        { ifMatch: await rev(manager, planUrl(ctx, ctx.A('Р-208'))) },
      );
      ctx.expectProblem(
        await owner.get(`${moduleUrl(ctx)}/deactivation-preview`),
        'module_not_installed',
      );
    },
  },
  {
    title: 'отключение при рейсе в пути — draining; без начатых рейсов — сразу «только чтение»',
    operationId: 'setModuleInstallation',
    expect: 'success',
    run: async (ctx) => {
      const { owner } = await shiftOnRoute(ctx);
      const r = await disable(ctx, owner);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(body(r).state).toBe('draining');
      expect(await moduleState(ctx, owner)).toBe('draining');
      const list = body(await owner.get(`${ctx.alta}/modules`)).items ?? [];
      expect(list.find((x) => x.moduleKey === 'fleet')?.state).toBe('draining');
      // Включение из draining — снова active.
      const on = await owner.put(moduleUrl(ctx), { enabled: true }, { ifMatch: body(r).revision });
      expect(body(on).state).toBe('active');
      // Без начатых рейсов (Р-208 отменять нечем — переводим строку) отключение — сразу read_only.
      tripRow(ctx, ctx.A('Р-208')).state = 'cancelled';
      const off = await disable(ctx, owner);
      expect(body(off).state).toBe('read_only');
    },
  },
  {
    title: 'draining: новый рейс — 403 module_read_only «…можно только завершить начатую работу.»',
    operationId: 'createTripPlan',
    expect: 'error',
    run: async (ctx) => {
      const { owner } = await draining(ctx);
      const r = await owner.post(`${fleet(ctx)}/trip-plans`, {
        orgUnitId: ctx.A('f-msk-sever'),
        title: 'После отключения',
        plannedWindow: W,
        cargo: { description: 'Сухой груз', weightKg: '500', volumeM3: '5', lengthM: '2' },
        stops: [
          { sequence: 1, op: 'load', address: 'Склад № 1, Лобня', weightKg: '500', volumeM3: '5' },
          { sequence: 2, op: 'unload', address: 'Химки', weightKg: '500', volumeM3: '5' },
        ],
      });
      ctx.expectProblem(r, 'module_read_only');
      expect(body(r).detail).toBe(DRAINING);
    },
  },
  {
    title: 'draining: новая бронь — 403 module_read_only',
    operationId: 'reserveVehicle',
    expect: 'error',
    run: async (ctx) => {
      const { owner } = await draining(ctx);
      const r = await owner.post(`${fleet(ctx)}/reservations`, {
        vehicleId: ctx.A('v2'),
        driverMemberId: ctx.A('m-vasiliev'),
        window: W,
      });
      ctx.expectProblem(r, 'module_read_only');
      expect(body(r).detail).toBe(DRAINING);
    },
  },
  {
    title: 'draining: «Завершить рейс» начатой смены открыт (W2.60)',
    operationId: 'finishTripRoute',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await draining(ctx);
      const { done } = await finishRoute(ctx, driver);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(body(done).state).toBe('returning');
    },
  },
  {
    title: 'draining: осмотр при сдаче открыт, осмотр перед выездом — 403 module_read_only',
    operationId: 'submitInspection',
    expect: 'error',
    run: async (ctx) => {
      const { driver, owner } = await draining(ctx);
      const { ret } = await finishRoute(ctx, driver);
      expect(ret.status, JSON.stringify(ret.body)).toBe(201);
      // Осмотр перед выездом — новая работа: шлюз пропускает осмотр, хендлер закрывает выезд до поиска брони.
      const dep = await inspect(ctx, owner, {
        kind: 'departure',
        vehicle: ctx.A('v1'),
        odometerKm: '84600',
        reservationId: UNKNOWN,
      });
      ctx.expectProblem(dep, 'module_read_only');
      expect(body(dep).detail).toBe(DRAINING);
    },
  },
  {
    title: 'draining: сдача и приёмка начатой смены; после неё модуль — «только чтение»',
    operationId: 'reviewTrip',
    expect: 'success',
    run: async (ctx) => {
      const { driver, manager, owner } = await draining(ctx);
      const { ret } = await finishRoute(ctx, driver);
      const back = await driver.patch(
        tripUrl(ctx, ctx.A('Р-208')),
        { action: 'return', returnInspectionId: body(ret).id },
        { ifMatch: await rev(driver, planUrl(ctx, ctx.A('Р-208'))) },
      );
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(await moduleState(ctx, owner)).toBe('draining');
      const ok = await manager.post(
        `${tripUrl(ctx, ctx.A('Р-208'))}/review`,
        { decision: 'approve' },
        { ifMatch: await rev(manager, planUrl(ctx, ctx.A('Р-208'))) },
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await moduleState(ctx, owner)).toBe('read_only');
      ctx.expectProblem(
        await owner.post(`${fleet(ctx)}/reservations`, {
          vehicleId: ctx.A('v2'),
          driverMemberId: ctx.A('m-vasiliev'),
          window: W,
        }),
        'module_read_only',
      );
    },
  },
  {
    title: '/me/context при draining: «Логистика» — draining · finish_only · draining',
    operationId: 'getMyContext',
    expect: 'success',
    run: async (ctx) => {
      const { driver } = await draining(ctx);
      const me = body(await driver.get('/api/v1/me/context')) as unknown as {
        tenants: { tenantId: string; modules: Record<string, unknown>[] }[];
      };
      const alta = me.tenants.find((t) => t.tenantId === ctx.P('t-alta'));
      expect(alta?.modules.find((m) => m.moduleKey === 'fleet')).toEqual({
        moduleKey: 'fleet',
        state: 'draining',
        accessMode: 'finish_only',
        reason: 'draining',
      });
    },
  },

  // (2) Роль «Временный водитель» (AC-06, Q-W2.32-6).
  {
    title: 'одобрение назначает роль «Временный водитель»: self на окно, resource — машина рейса',
    operationId: 'decideDriverTransfer',
    expect: 'success',
    run: async (ctx) => {
      const s = await withVehicle(ctx);
      const { role, rows } = await temporaryAssignments(ctx, s.owner, s.akh);
      expect(role).toMatchObject({ name: 'Временный водитель', builtIn: true });
      expect([...((role?.permissions as string[]) ?? [])].sort()).toEqual(
        [
          'files.read',
          'files.upload',
          'fleet.vehicles.read',
          'fleet.reservations.read',
          'fleet.reservations.choose',
          'fleet.inspections.read',
          'fleet.inspections.submit',
          'fleet.trips.read',
          'fleet.trips.start',
          'fleet.trips.return',
          'fleet.routes.read',
          'fleet.expenses.read',
          'fleet.expenses.create',
        ].sort(),
      );
      const self = rows.find((a) => (a.scope as { kind: string }).kind === 'self');
      expect(self).toMatchObject({
        id: s.transfer.grant?.assignmentId,
        principalType: 'member',
        scope: { kind: 'self', resourceIds: [], includeDescendants: false },
        validFrom: W.startsAt,
        validUntil: W.endsAt,
        state: 'active',
      });
      const car = rows.find((a) => (a.scope as { kind: string }).kind === 'resource_pool');
      expect(car).toMatchObject({
        scope: { kind: 'resource_pool', resourceIds: [ctx.A('v5')], includeDescendants: false },
        validFrom: W.startsAt,
        validUntil: W.endsAt,
        state: 'active',
      });
      // /me/context временного водителя: права роли в области self.
      const me = body(await s.driver.get('/api/v1/me/context')) as unknown as {
        tenants: { tenantId: string; capabilities: { permission: string; scope: unknown }[] }[];
      };
      const caps = me.tenants.find((t) => t.tenantId === ctx.P('t-alta'))?.capabilities ?? [];
      expect(caps).toContainEqual({
        permission: 'fleet.trips.read',
        scope: { kind: 'self', resourceIds: [], includeDescendants: false },
      });
    },
  },
  {
    title: 'роль «Временный водитель» вручную не назначают — 409 invalid_transition',
    operationId: 'createAssignment',
    expect: 'error',
    run: async (ctx) => {
      const s = await temporary(ctx);
      const { role } = await temporaryAssignments(ctx, s.owner, s.akh);
      const r = await s.owner.post(`${ctx.alta}/assignments`, {
        principalType: 'member',
        principalId: ctx.A('m-kotelnikova'),
        roleId: role?.id,
        scope: { kind: 'self', resourceIds: [], includeDescendants: false },
      });
      ctx.expectProblem(r, 'invalid_transition');
    },
  },
  {
    title: 'в окне временный водитель без своей роли видит рейс перевода и ровно машину рейса',
    operationId: 'listVehicles',
    expect: 'success',
    run: async (ctx) => {
      const s = await withVehicle(ctx);
      expect(ids(await s.driver.get(`${fleet(ctx)}/vehicles?limit=200`))).toEqual([ctx.A('v5')]);
      expect(ids(await s.driver.get(`${fleet(ctx)}/trip-plans?limit=200`))).toEqual([
        String(s.trip.id),
      ]);
    },
  },
  {
    title:
      'до окна у временного водителя без своей роли прав нет — 403, как у несуществующего рейса',
    operationId: 'getTripPlan',
    expect: 'error',
    run: async (ctx) => {
      const s = await temporary(ctx);
      const driver = await ctx.as('acc-9');
      const hidden = await driver.get(planUrl(ctx, s.trip.id));
      ctx.expectProblem(hidden, 'forbidden_action');
      expect(problem(hidden)).toEqual(problem(await driver.get(planUrl(ctx, UNKNOWN))));
    },
  },
  {
    title: 'в окне чек-лист машины рейса другой фирмы открыт временному водителю',
    operationId: 'getInspectionChecklist',
    expect: 'success',
    run: async (ctx) => {
      const s = await withVehicle(ctx);
      const r = await s.driver.get(
        `${fleet(ctx)}/inspection-checklist?vehicleId=${ctx.A('v5')}&kind=departure`,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(body(r).kind).toBe('departure');
      // Чужая машина фирмы рейса (не машина рейса) — как несуществующая.
      ctx.expectProblem(
        await s.driver.get(
          `${fleet(ctx)}/inspection-checklist?vehicleId=${ctx.A('v1')}&kind=departure`,
        ),
        'not_found',
      );
    },
  },
  {
    title: 'в окне осмотр перед выездом и выезд временного водителя на машине рейса',
    operationId: 'submitInspection',
    expect: 'success',
    run: async (ctx) => {
      const s = await departed(ctx);
      expect(body(await s.driver.get(planUrl(ctx, s.trip.id))).state).toBe('on_route');
    },
  },
  {
    title: 'после окна у начатого рейса — продолжение: рейс и сдача открыты, машины и бронь — 403',
    operationId: 'returnTrip',
    expect: 'success',
    run: async (ctx) => {
      const s = await departed(ctx);
      ctx.server.setNow(AFTER_WINDOW);
      const plan = await s.driver.get(planUrl(ctx, s.trip.id));
      expect(body(plan).state).toBe('on_route');
      ctx.expectProblem(await s.driver.get(`${fleet(ctx)}/vehicles?limit=200`), 'forbidden_action');
      ctx.expectProblem(
        await s.driver.post(`${fleet(ctx)}/reservations`, {
          vehicleId: ctx.A('v5'),
          driverMemberId: s.akh,
          window: W,
          tripId: s.trip.id,
        }),
        'forbidden_action',
      );
      const { rows } = await temporaryAssignments(ctx, s.owner, s.akh);
      expect(rows.find((a) => (a.scope as { kind: string }).kind === 'self')).not.toHaveProperty(
        'validUntil',
      );
      expect(rows.find((a) => (a.scope as { kind: string }).kind === 'resource_pool')?.state).toBe(
        'expired',
      );
      await returnedAfterWindow(ctx, s);
      expect(body(await s.driver.get(planUrl(ctx, s.trip.id))).state).toBe('submitted');
    },
  },
  {
    title: 'после приёмки рейс временному водителю — как несуществующий id; назначение expired',
    operationId: 'getTripPlan',
    expect: 'success',
    run: async (ctx) => {
      const s = await returnedAfterWindow(ctx);
      const ok = await s.owner.post(
        `${tripUrl(ctx, s.trip.id)}/review`,
        { decision: 'approve' },
        { ifMatch: await rev(s.owner, planUrl(ctx, s.trip.id)) },
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const hidden = await s.driver.get(planUrl(ctx, s.trip.id));
      expect(problem(hidden)).toEqual(problem(await s.driver.get(planUrl(ctx, UNKNOWN))));
      expect(JSON.stringify(hidden.body)).not.toContain(String(s.trip.number));
      const { rows } = await temporaryAssignments(ctx, s.owner, s.akh);
      expect(rows.map((a) => a.state)).toEqual(['expired', 'expired']);
      // Владелец рейс видит.
      expect(body(await s.owner.get(planUrl(ctx, s.trip.id))).state).toBe('accepted');
    },
  },
  {
    title:
      'не начатый к концу окна рейс — назначение кончилось, рейсов временному водителю нет (403)',
    operationId: 'listTripPlans',
    expect: 'error',
    run: async (ctx) => {
      const s = await withVehicle(ctx);
      ctx.server.setNow(AFTER_WINDOW);
      ctx.expectProblem(
        await s.driver.get(`${fleet(ctx)}/trip-plans?limit=200`),
        'forbidden_action',
      );
      const { rows } = await temporaryAssignments(ctx, s.owner, s.akh);
      expect(rows.find((a) => (a.scope as { kind: string }).kind === 'self')?.state).toBe(
        'expired',
      );
    },
  },
]);
